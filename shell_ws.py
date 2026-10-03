#!/usr/bin/env python3
"""Websocket gateway for the dashboard host shell.

Push model: each browser tab opens one connection
(`GET /ws/shell?id=<sid>`) and the server pushes a pane snapshot whenever
the tmux pane changes — plus an immediate push after every input/key — so
keystroke echo is a single round trip instead of a poll cycle.

Same tmux-over-SSH backend as the HTTP API (shell_common): persistence
lives in host tmux, so this process is disposable — clients reconnect with
backoff and reattach to the same session.

Stdlib only (socket/select/threading/json): no third-party deps, matching
the rest of the dashboard. No auth: LAN/tailnet only, like /api/*.
"""

import base64
import contextlib
import hashlib
import json
import os
import select
import signal
import socket
import struct
import threading
import time
from urllib.parse import parse_qs, urlparse

from shell_common import (
    capture_pane,
    check_shell_id,
    ensure_session,
    kill_session,
    parse_dims,
    paste_text,
    resize_session,
    send_key,
)

WS_HOST = os.environ.get("SHELL_WS_HOST", "0.0.0.0")
WS_PORT = int(os.environ.get("SHELL_WS_PORT", "5556"))
WS_PATH = "/ws/shell"

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

BURST_INTERVAL = 0.05  # snapshot cadence right after input (echo + redraws)
IDLE_INTERVAL = 0.30  # ... then back off when the pane is quiet
BURST_AFTER_INPUT = 1.5  # seconds of fast polling after each input/key
PING_EVERY = 25.0  # server heartbeat (browsers auto-pong)
REAP_AFTER = 120.0  # drop connections silent this long
INBOUND_MAX = 1 << 20  # largest acceptable client message

STOP = threading.Event()


def log(*args):
    print(f"[{time.strftime('%H:%M:%S')}]", *args, flush=True)


class ConnDead(Exception):
    pass


class ProtocolError(Exception):
    def __init__(self, code=1002):
        super().__init__(f"ws protocol error {code}")
        self.code = code


class HandshakeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------- wire format ----------------


def send_frame(sock, opcode, payload: bytes):
    """Send one server frame (never masked). Raises ConnDead on failure."""
    header = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header += bytes([n])
    elif n < 65536:
        header += bytes([126]) + struct.pack("!H", n)
    else:
        header += bytes([127]) + struct.pack("!Q", n)
    try:
        sock.sendall(header + payload)
    except OSError:
        raise ConnDead() from None


def send_text(sock, obj):
    send_frame(sock, 0x1, json.dumps(obj, separators=(",", ":")).encode())


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        try:
            chunk = sock.recv(n - len(buf))
        except TimeoutError:
            raise ConnDead() from None
        if not chunk:
            raise ConnDead()
        buf += chunk
    return bytes(buf)


def recv_message(sock):
    """Next client message. Returns ("text", str) | ("pong", b"") | ("close", bytes).

    Handles fragmentation, answers ping with pong inline, and enforces
    masking (required of clients). Raises ConnDead or ProtocolError(code).
    """
    fragments = None
    while True:
        hdr = recv_exact(sock, 2)
        b1, b2 = hdr[0], hdr[1]
        fin, op = b1 & 0x80, b1 & 0x0F
        masked, length = b2 & 0x80, b2 & 0x7F
        if op in (0x3, 0x4, 0x5, 0x6, 0x7):
            raise ProtocolError(1002)
        if length == 126:
            length = struct.unpack("!H", recv_exact(sock, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", recv_exact(sock, 8))[0]
        if not masked:
            raise ProtocolError(1002)
        mask = recv_exact(sock, 4)
        if length > INBOUND_MAX:
            raise ProtocolError(1009)
        payload = recv_exact(sock, length)
        data = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        if op == 0x8:  # close: echo payload back, let the caller break
            return ("close", data)
        if op == 0x9:  # ping -> pong with identical payload
            send_frame(sock, 0xA, data)
            continue
        if op == 0xA:
            return ("pong", b"")
        if op == 0x2:
            raise ProtocolError(1003)
        if op == 0x1:
            fragments = [data]
        elif op == 0x0:
            if fragments is None:
                raise ProtocolError(1002)
            fragments.append(data)
        if sum(map(len, fragments)) > INBOUND_MAX:
            raise ProtocolError(1009)
        if fin:
            try:
                return ("text", b"".join(fragments).decode("utf-8"))
            except UnicodeDecodeError:
                raise ProtocolError(1007) from None


def do_handshake(sock):
    """HTTP Upgrade -> 101. Returns the validated shell id."""
    data = b""
    while b"\r\n\r\n" not in data:
        try:
            chunk = sock.recv(4096)
        except TimeoutError:
            raise HandshakeError(408, "handshake timeout") from None
        if not chunk:
            raise HandshakeError(400, "empty request")
        data += chunk
        if len(data) > 16384:
            raise HandshakeError(431, "headers too large")
    head = data.split(b"\r\n\r\n", 1)[0].decode("latin-1")
    lines = head.split("\r\n")
    parts = lines[0].split()
    if len(parts) < 2:
        raise HandshakeError(400, "bad request")
    method, target = parts[0], parts[1]
    hdr = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            hdr[k.strip().lower()] = v.strip()
    url = urlparse(target)
    if method.upper() != "GET" or url.path != WS_PATH:
        raise HandshakeError(404, "not found")
    if (
        hdr.get("upgrade", "").lower() != "websocket"
        or "upgrade" not in hdr.get("connection", "").lower()
    ):
        raise HandshakeError(400, "websocket upgrade required")
    if hdr.get("sec-websocket-version", "") != "13":
        raise HandshakeError(426, "upgrade required")
    key = hdr.get("sec-websocket-key", "")
    if not key:
        raise HandshakeError(400, "missing key")
    sid = check_shell_id(parse_qs(url.query).get("id", [""])[0])
    if sid is None:
        raise HandshakeError(400, "bad shell id")
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    sock.sendall(
        (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        ).encode()
    )
    return sid


# ---------------- session loop ----------------


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


def serve():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((WS_HOST, WS_PORT))
    srv.listen(50)
    srv.settimeout(1.0)
    log(f"shell-ws listening on {WS_HOST}:{WS_PORT}{WS_PATH} (backend local macOS tmux)")

    def on_signal(signum, _frame):
        log(f"signal {signum}, stopping")
        STOP.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    while not STOP.is_set():
        try:
            sock, addr = srv.accept()
        except TimeoutError:
            continue
        except OSError:
            break
        threading.Thread(target=handle_conn, args=(sock, addr), daemon=True).start()
    srv.close()
    log("stopped")


if __name__ == "__main__":
    serve()
