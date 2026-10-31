"""Per-connection session loop: message dispatch + push cadence.

Each browser tab opens one connection (`GET /ws/shell?id=<sid>`) and the
server pushes a pane snapshot whenever the tmux pane changes — plus an
immediate push after every input/key — so keystroke echo is a single round
trip instead of a poll cycle. Persistence lives in host tmux, so this process
is disposable: clients reconnect and reattach to the same session.

Thread-per-connection is right-sized for tailnet use; the pane is the unit of
truth, so an idle shell costs one cheap capture per IDLE_INTERVAL and zero
bytes on the wire.
"""

import contextlib
import json
import select
import socket
import struct
import time

from dashboard.shell.tmux import (
    capture_pane,
    ensure_session,
    kill_session,
    parse_dims,
    paste_text,
    resize_session,
    send_key,
)
from dashboard.ws.frames import (
    ConnDead,
    ProtocolError,
    recv_message,
    send_frame,
    send_text,
)
from dashboard.ws.handshake import HandshakeError, do_handshake
from dashboard.ws.server import STOP, log

BURST_INTERVAL = 0.05  # snapshot cadence right after input (echo + redraws)
IDLE_INTERVAL = 0.30  # ... then back off when the pane is quiet
BURST_AFTER_INPUT = 1.5  # seconds of fast polling after each input/key
PING_EVERY = 25.0  # server heartbeat (browsers auto-pong)
REAP_AFTER = 120.0  # drop connections silent this long


def snap_key(snap):
    if snap.get("error"):
        return ("error", snap["error"])
    if not snap.get("alive"):
        return ("gone",)
    return (
        "alive",
        snap["text"],
        snap["cursor_x"],
        snap["cursor_y"],
        snap["cols"],
        snap["rows"],
        snap["cmd"],
    )


def handle_message(sock, sid, raw):
    """One client message. Returns (saw_input, reset_push)."""
    try:
        msg = json.loads(raw)
    except ValueError:
        send_text(sock, {"t": "error", "error": "invalid JSON"})
        return False, False
    if not isinstance(msg, dict):
        send_text(sock, {"t": "error", "error": "invalid message"})
        return False, False
    t = msg.get("t")

    if t == "input":
        status, err = paste_text(sid, msg.get("text", ""))
        if status != "ok":
            send_text(sock, {"t": "error", "error": err})
            return False, False
        return True, False

    if t == "key":
        status, err = send_key(sid, msg.get("key", ""))
        if status != "ok":
            send_text(sock, {"t": "error", "error": err})
            return False, False
        return True, False

    if t == "resize":
        dims = parse_dims(msg.get("cols"), msg.get("rows"))
        if dims is None:
            send_text(sock, {"t": "error", "error": "cols/rows must be numbers"})
            return False, False
        status, _ = resize_session(sid, *dims)
        if status != "ok":
            send_text(sock, {"t": "error", "error": "no such shell session"})
            return False, False
        return True, False

    if t == "new":
        # Preserve the current pty size across the recreate when known.
        snap = capture_pane(sid)
        dims = (snap.get("cols", 100), snap.get("rows", 30)) if snap.get("alive") else (100, 30)
        kill_session(sid)
        status, info = ensure_session(sid, *dims)
        if status != "ok":
            send_text(sock, {"t": "error", "error": info})
            return False, False
        send_text(sock, {"t": "hello", **info})
        return True, True

    send_text(sock, {"t": "error", "error": "unknown message"})
    return False, False


def handle_conn(sock, addr):
    try:
        sid = do_handshake(sock)
    except HandshakeError as e:
        with contextlib.suppress(OSError):
            sock.sendall(f"HTTP/1.1 {e.code} {e.message}\r\nContent-Length: 0\r\n\r\n".encode())
        sock.close()
        return
    except OSError:
        sock.close()
        return

    log(f"open {addr[0]} sid={sid}")
    sock.settimeout(30)
    status, info = ensure_session(sid, 100, 30)
    try:
        if status == "ok":
            send_text(sock, {"t": "hello", **info})
        else:
            send_text(
                sock, {"t": "hello", "id": sid, "cols": 100, "rows": 30, "cwd": "~", "warn": info}
            )
    except ConnDead:
        sock.close()
        return

    last_sent = None
    last_input = 0.0
    last_ping = time.monotonic()
    last_recv = time.monotonic()
    next_poll = 0.0
    try:
        while not STOP.is_set():
            now = time.monotonic()
            interval = BURST_INTERVAL if (now - last_input) < BURST_AFTER_INPUT else IDLE_INTERVAL
            try:
                r, _, _ = select.select([sock], [], [], max(0.0, min(next_poll - now, 5.0)))
            except (OSError, ValueError):
                break
            now = time.monotonic()
            if r:
                try:
                    kind, payload = recv_message(sock)
                except ProtocolError as pe:
                    with contextlib.suppress(ConnDead):
                        send_frame(sock, 0x8, struct.pack("!H", pe.code))
                    break
                last_recv = now
                if kind == "close":
                    with contextlib.suppress(ConnDead):
                        send_frame(sock, 0x8, payload[:125])
                    break
                if kind == "pong":
                    continue
                saw, reset = handle_message(sock, sid, payload)
                if saw:
                    last_input = time.monotonic()
                    next_poll = 0.0  # capture immediately: echo is one round trip
                if reset:
                    last_sent = None
            now = time.monotonic()
            if now >= next_poll:
                # Capture every tick but send only on change: the pane is
                # the unit of truth (ordered TCP, nothing gets missed), so
                # an idle shell costs one cheap capture per IDLE_INTERVAL
                # and zero bytes / zero repaints on the wire.
                try:
                    snap = capture_pane(sid)
                    key = snap_key(snap)
                    if key != last_sent:
                        if snap.get("error"):
                            send_text(sock, {"t": "error", "error": snap["error"]})
                        elif snap["alive"]:
                            send_text(sock, {"t": "pane", **snap})
                        else:
                            send_text(sock, {"t": "pane", "id": sid, "alive": False})
                        last_sent = key
                except ConnDead:
                    break
                next_poll = time.monotonic() + interval
            now = time.monotonic()
            if now - last_ping > PING_EVERY:
                try:
                    send_frame(sock, 0x9, b"")
                except ConnDead:
                    break
                last_ping = now
            if now - last_recv > REAP_AFTER:
                log(f"reap silent sid={sid}")
                break
    except ConnDead:
        pass
    finally:
        with contextlib.suppress(OSError):
            sock.shutdown(socket.SHUT_RDWR)
        sock.close()
        log(f"close sid={sid}")
