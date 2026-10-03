"""Native macOS shell backend: local tmux, rooted in ~.

Used by both the Flask HTTP API (dashboard.shell.api) and the websocket
gateway (dashboard.ws) so the two transports behave identically. Stdlib only —
no third-party deps: subprocess against the local tmux server.

Persistence lives in host tmux, so every caller stays stateless: any
process can operate on any shell session.

All tmux invocations are direct argv lists (no ``sh -c`` string
interpolation), so a validation bug can never turn a session id into a shell
command.
"""

import contextlib
import re
import secrets
import subprocess
import time
from pathlib import Path

SHELL_HOME = str(Path.home())
SHELL_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")

# Key names accepted by the shell key endpoint/message, mapped to tmux args.
SHELL_KEYS = {
    "Enter": "Enter",
    "Backspace": "BSpace",
    "Tab": "Tab",
    "Escape": "Escape",
    "Up": "Up",
    "Down": "Down",
    "Left": "Left",
    "Right": "Right",
    "Home": "Home",
    "End": "End",
    "PageUp": "PageUp",
    "PageDown": "PageDown",
    "Delete": "DC",
    "Insert": "IC",
    "C-c": "C-c",
    "C-d": "C-d",
    "C-l": "C-l",
    "C-u": "C-u",
    "C-k": "C-k",
    "C-a": "C-a",
    "C-e": "C-e",
    "C-r": "C-r",
    "C-w": "C-w",
    "C-z": "C-z",
}

INPUT_MAX = 4096  # max chars per input message (stdin-piped, no quoting)


def check_shell_id(raw):
    sid = str(raw or "").strip()
    return sid if SHELL_ID_RE.match(sid) else None


def new_shell_id():
    return secrets.token_hex(6)


def shell_session_name(sid):
    return f"dash-{sid}"


def parse_dims(cols, rows):
    """Clamp cols/rows to the pty range. Returns (cols, rows) or None."""
    try:
        return max(20, min(int(cols), 300)), max(5, min(int(rows), 100))
    except (TypeError, ValueError):
        return None


# tmux stderr fragments meaning "that session isn't there" (vs a real error).
# tmux 3.x reports a bad `-t` target as session/pane/window depending on the
# subcommand, so match the shared prefix.
_TMUX_GONE = ("can't find ", "no server running", "failed to connect to server")


def tmux_gone(output):
    return any(frag in output for frag in _TMUX_GONE)


def tmux_run(args, input_bytes=None, timeout=15):
    """Run one tmux argv list. Returns CompletedProcess. No shell involved."""
    return subprocess.run(
        ["tmux", *args],
        input=input_bytes,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def tmux_has(sess):
    r = tmux_run(["has-session", "-t", sess])
    return r.returncode == 0


def ensure_session(sid, cols=80, rows=24):
    """Create the host tmux session (cwd ~) unless it exists.

    Returns ("ok", info) or ("error", message). info matches the old
    POST /api/shell/new response: {id, session, cols, rows, cwd}.
    """
    sess = shell_session_name(sid)
    try:
        if not tmux_has(sess):
            r = tmux_run(
                [
                    "new-session",
                    "-d",
                    "-s",
                    sess,
                    "-x",
                    str(cols),
                    "-y",
                    str(rows),
                    "-c",
                    SHELL_HOME,
                    "/bin/zsh",
                    "-l",
                ]
            )
            if r.returncode != 0:
                err = (
                    r.stderr.decode(errors="replace")
                    or r.stdout.decode(errors="replace")
                    or "tmux new-session failed"
                ).strip()
                return "error", err[-500:]
            # Wait for the login shell to paint its first frame. Polling the pane
            # is faster than a fixed sleep and avoids a blank first frame.
            deadline = time.monotonic() + 1.0
            while time.monotonic() < deadline:
                snap = capture_pane(sid)
                if snap.get("alive") and (snap.get("text") or "").strip():
                    break
                time.sleep(0.05)
    except subprocess.TimeoutExpired:
        return "error", "shell command timed out"
    return "ok", {"id": sid, "session": sess, "cols": cols, "rows": rows, "cwd": "~"}


def capture_pane(sid):
    """Snapshot of the visible pane. Dict with alive/text/cursor/dims/cmd.

    On host command timeout returns {"alive": False, "error": ...}; when the session
    is gone returns {"alive": False}. Same shape as GET /api/shell/pane.
    """
    sess = shell_session_name(sid)
    try:
        # Two explicit calls: capture-pane is the liveness gate. NOTE:
        # `tmux display-message -p` echoes its format string verbatim (rc 0)
        # when the session is missing, so it must never be the probe.
        r = tmux_run(["capture-pane", "-e", "-p", "-t", sess])
    except subprocess.TimeoutExpired:
        return {"id": sid, "alive": False, "error": "shell command timed out"}
    out = r.stdout.decode(errors="replace")
    if r.returncode != 0 or "no server running" in out:
        return {"id": sid, "alive": False}
    text = out
    try:
        m = tmux_run(
            [
                "display-message",
                "-p",
                "-t",
                sess,
                "#{cursor_x} #{cursor_y} #{pane_width} #{pane_height} #{pane_current_command}",
            ]
        )
    except subprocess.TimeoutExpired:
        return {"id": sid, "alive": False, "error": "shell command timed out"}
    if m.returncode != 0:
        return {"id": sid, "alive": False}
    parts = m.stdout.decode(errors="replace").strip().split()
    try:
        cx, cy, cols, rows = map(int, parts[:4])
    except (ValueError, IndexError):
        cx, cy, cols, rows = 0, 0, 80, 24
    cmd = parts[4] if len(parts) > 4 else ""
    return {
        "id": sid,
        "alive": True,
        "text": text,
        "cursor_x": cx,
        "cursor_y": cy,
        "cols": cols,
        "rows": rows,
        "cmd": cmd,
    }


def paste_text(sid, text):
    """Type literal text (stdin-piped, no shell quoting).

    Returns ("ok", None), ("bad", msg), ("gone", msg) or ("error", msg).
    Three explicit tmux calls: load-buffer (input on stdin), paste-buffer
    (its rc is the one that matters), delete-buffer (best-effort cleanup).
    """
    if not isinstance(text, str) or not text:
        return "bad", "id and non-empty text required"
    if len(text) > INPUT_MAX:
        return "bad", f"text too long (max {INPUT_MAX})"
    sess = shell_session_name(sid)
    buf = f"buf-{sid}"
    try:
        # rc intentionally ignored: a stale session surfaces from paste-buffer.
        tmux_run(["load-buffer", "-b", buf, "-"], input_bytes=text.encode())
        r = tmux_run(["paste-buffer", "-b", buf, "-t", sess])
    except subprocess.TimeoutExpired:
        return "error", "shell command timed out"
    with contextlib.suppress(subprocess.TimeoutExpired, OSError):
        tmux_run(["delete-buffer", "-b", buf])  # best-effort cleanup
    if r.returncode != 0:
        err = (r.stderr.decode(errors="replace") or "paste failed").strip()
        if tmux_gone(err):
            return "gone", "no such shell session"
        return "error", err[-300:]
    return "ok", None


def send_key(sid, key):
    """Send one allowlisted special key. Same status shape as paste_text."""
    arg = SHELL_KEYS.get(key or "")
    if arg is None:
        return "bad", "unknown shell id or key"
    try:
        r = tmux_run(["send-keys", "-t", shell_session_name(sid), arg])
    except subprocess.TimeoutExpired:
        return "error", "shell command timed out"
    if r.returncode != 0:
        if tmux_gone(r.stderr.decode(errors="replace")):
            return "gone", "no such shell session"
        return "error", "send-keys failed"
    return "ok", None


def resize_session(sid, cols, rows):
    """Resize the pty. ("ok", {cols, rows}) or ("gone"/"error", msg)."""
    try:
        r = tmux_run(
            ["resize-window", "-t", shell_session_name(sid), "-x", str(cols), "-y", str(rows)]
        )
    except subprocess.TimeoutExpired:
        return "error", "shell command timed out"
    if r.returncode != 0:
        return "gone", "no such shell session"
    return "ok", {"cols": cols, "rows": rows}


def kill_session(sid):
    """Destroy the host tmux session. ("ok", {id}) or ("error", msg)."""
    try:
        tmux_run(["kill-session", "-t", shell_session_name(sid)])
    except subprocess.TimeoutExpired:
        return "error", "shell command timed out"
    return "ok", {"id": sid}


def list_sessions():
    """Dashboard-owned host shell sessions. Returns {"sessions": [...]}."""
    try:
        r = tmux_run(
            [
                "ls",
                "-F",
                "#{session_name} #{session_created} #{?session_attached,attached,detached}",
            ]
        )
    except subprocess.TimeoutExpired:
        return None
    sessions = []
    for line in r.stdout.decode(errors="replace").splitlines():
        name, _, rest = line.partition(" ")
        if name.startswith("dash-") and SHELL_ID_RE.match(name[5:]):
            sessions.append({"id": name[5:], "session": name, "info": rest})
    return {"sessions": sessions}
