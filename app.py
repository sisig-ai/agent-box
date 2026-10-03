from flask import Flask, jsonify, request, send_from_directory

from dashboard.config import MAX_UPLOAD_MB, STATIC_DIR
from dashboard.db import init_db
from dashboard.fs_api import bp as fs_bp
from dashboard.notes_api import bp as notes_bp
from dashboard.telemetry_api import bp as telemetry_bp
from shell_common import (
    capture_pane,
    check_shell_id,
    ensure_session,
    kill_session,
    list_sessions,
    new_shell_id,
    parse_dims,
    paste_text,
    resize_session,
    send_key,
)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": f"upload too large (max {MAX_UPLOAD_MB} MB)"}), 413


init_db()
app.register_blueprint(notes_bp)
app.register_blueprint(telemetry_bp)
app.register_blueprint(fs_bp)


# ---------------- Web shell (host tty in ~) ----------------
# Interactive shell tab: each browser session owns a tmux session on the host
# (started with cwd ~). Flask stays stateless — any gunicorn worker can proxy
# any shell session, since persistence lives in host tmux, not in this process.
# Backend lives in shell_common (shared with the websocket gateway); the
# routes below are thin HTTP wrappers. No extra deps: stdlib subprocess +
# local tmux process under the dashboard user.


@app.post("/api/shell/new")
def shell_new():
    """Create (or attach to) a host tmux session starting in ~. JSON {id?, cols?, rows?}."""
    body = request.get_json(silent=True) or {}
    sid = check_shell_id(body.get("id")) or new_shell_id()
    dims = parse_dims(body.get("cols", 80), body.get("rows", 24)) or (80, 24)
    status, payload = ensure_session(sid, *dims)
    if status != "ok":
        return jsonify({"error": payload}), 500
    return jsonify(payload)


@app.get("/api/shell/pane")
def shell_pane():
    """Snapshot of the visible pane: {text, cursor_x, cursor_y, cols, rows, cmd, alive}."""
    sid = check_shell_id(request.args.get("id"))
    if sid is None:
        return jsonify({"error": "unknown shell id"}), 404
    snap = capture_pane(sid)
    if snap.get("error"):
        return jsonify({"error": snap["error"]}), 504
    if not snap["alive"]:
        return jsonify({"id": sid, "alive": False}), 404
    return jsonify(snap)


@app.post("/api/shell/input")
def shell_input():
    """Type literal text (stdin-piped, no shell quoting). JSON {id, text}."""
    body = request.get_json(silent=True) or {}
    sid = check_shell_id(body.get("id"))
    if sid is None:
        return jsonify({"error": "id and non-empty text required"}), 400
    status, msg = paste_text(sid, body.get("text", ""))
    if status == "ok":
        return jsonify({"ok": True})
    if status == "gone":
        return jsonify({"error": msg}), 404
    if status == "bad":
        return jsonify({"error": msg}), 400
    return jsonify({"error": msg}), 500


@app.post("/api/shell/key")
def shell_key():
    """Send one allowlisted special key (Enter, arrows, Ctrl-C, …). JSON {id, key}."""
    body = request.get_json(silent=True) or {}
    sid = check_shell_id(body.get("id"))
    if sid is None:
        return jsonify({"error": "unknown shell id or key"}), 400
    status, msg = send_key(sid, body.get("key", ""))
    if status == "ok":
        return jsonify({"ok": True})
    if status == "gone":
        return jsonify({"error": msg}), 404
    if status == "bad":
        return jsonify({"error": msg}), 400
    return jsonify({"error": msg}), 500


@app.post("/api/shell/resize")
def shell_resize():
    """Resize the pty. JSON {id, cols, rows}."""
    body = request.get_json(silent=True) or {}
    sid = check_shell_id(body.get("id"))
    if sid is None:
        return jsonify({"error": "unknown shell id"}), 400
    dims = parse_dims(body.get("cols", 80), body.get("rows", 24))
    if dims is None:
        return jsonify({"error": "cols/rows must be numbers"}), 400
    status, payload = resize_session(sid, *dims)
    if status != "ok":
        return jsonify({"error": payload}), 404
    return jsonify({"ok": True, "cols": payload["cols"], "rows": payload["rows"]})


@app.post("/api/shell/kill")
def shell_kill():
    """Destroy the host tmux session. JSON {id}."""
    body = request.get_json(silent=True) or {}
    sid = check_shell_id(body.get("id"))
    if sid is None:
        return jsonify({"error": "unknown shell id"}), 400
    status, payload = kill_session(sid)
    if status != "ok":
        return jsonify({"error": payload}), 504
    return jsonify({"ok": True, "id": sid})


@app.get("/api/shell/list")
def shell_list():
    """List dashboard-owned host shell sessions."""
    data = list_sessions()
    if data is None:
        return jsonify({"error": "host command timed out"}), 504
    return jsonify(data)


# ---------------- Landing page ----------------


@app.get("/")
@app.get("/index.html")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/config.json")
def config():
    return send_from_directory(STATIC_DIR, "config.json")


@app.get("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)
