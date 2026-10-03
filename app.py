import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "briefs.db"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---------------- Daily Brief persistence ----------------

def get_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_brief (
                date       TEXT PRIMARY KEY,
                content    TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS weekly_schedule (
                week_start TEXT PRIMARY KEY,
                content    TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS telemetry (
                ts        INTEGER PRIMARY KEY,
                cpu_util  REAL,
                cpu_temp  REAL,
                mem_used  INTEGER,
                mem_total INTEGER,
                pwr_cpu   REAL,
                pwr_gpu   REAL,
                pwr_total REAL
            )
            """
        )


def today_str() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d")


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def normalize_date(raw):
    """Return a valid YYYY-MM-DD string, or None."""
    if not raw:
        return today_str()
    s = str(raw).strip()
    return s if DATE_RE.match(s) else None


# ---------------- Daily-note table (daily_brief) ----------------
# One-markdown-entry-per-day store.

NOTE_TABLES = {"daily_brief"}


def fetch_note(table, date):
    assert table in NOTE_TABLES
    with get_db() as conn:
        row = conn.execute(
            f"SELECT date, content, created_at, updated_at FROM {table} WHERE date = ?",
            (date,),
        ).fetchone()
    return dict(row) if row else None


def upsert_note(table, date, content):
    assert table in NOTE_TABLES
    with get_db() as conn:
        conn.execute(
            f"""
            INSERT INTO {table} (date, content, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                content = excluded.content,
                updated_at = excluded.updated_at
            """,
            (date, content, now_iso(), now_iso()),
        )
    return fetch_note(table, date)


def delete_note(table, date):
    assert table in NOTE_TABLES
    with get_db() as conn:
        cur = conn.execute(f"DELETE FROM {table} WHERE date = ?", (date,))
    return cur.rowcount > 0


def list_notes(table, limit):
    assert table in NOTE_TABLES
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT date, content, created_at, updated_at FROM {table} ORDER BY date DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def fetch_brief(date):
    return fetch_note("daily_brief", date)


def upsert_brief(date, content):
    return upsert_note("daily_brief", date, content)


def delete_brief(date):
    return delete_note("daily_brief", date)


# ---------------- Weekly Schedule persistence ----------------

def week_start_for(date_str):
    """Return the Monday (YYYY-MM-DD) of the week containing date_str, or of today."""
    if not date_str or not DATE_RE.match(date_str):
        date_str = today_str()
    y, m, d = map(int, date_str.split("-"))
    return (date(y, m, d) - timedelta(days=date(y, m, d).weekday())).isoformat()


def normalize_week(raw):
    """Return a valid YYYY-MM-DD week-start (Monday), or None."""
    if not raw:
        return week_start_for(None)
    s = str(raw).strip()
    if not DATE_RE.match(s):
        return None
    return week_start_for(s)


def fetch_schedule(week):
    with get_db() as conn:
        row = conn.execute(
            "SELECT week_start, content, created_at, updated_at FROM weekly_schedule WHERE week_start = ?",
            (week,),
        ).fetchone()
    return dict(row) if row else None


def upsert_schedule(week, content):
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO weekly_schedule (week_start, content, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(week_start) DO UPDATE SET
                content = excluded.content,
                updated_at = excluded.updated_at
            """,
            (week, content, now_iso(), now_iso()),
        )
    return fetch_schedule(week)


def delete_schedule(week):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM weekly_schedule WHERE week_start = ?", (week,))
    return cur.rowcount > 0


init_db()


# ---------------- Daily Brief API ----------------
# No auth: local stack, exposed only over the tailnet.

@app.get("/api/brief")
def brief_get():
    """GET /api/brief?date=YYYY-MM-DD (defaults to today)."""
    date = normalize_date(request.args.get("date"))
    if date is None:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400
    row = fetch_brief(date)
    if row is None:
        return jsonify({"date": date, "content": ""}), 200
    return jsonify(row)


@app.get("/api/brief/list")
def brief_list():
    """GET /api/brief/list?limit=N — most recent days first."""
    limit = min(int(request.args.get("limit", 30)), 365)
    return jsonify(list_notes("daily_brief", limit))


@app.put("/api/brief")
@app.post("/api/brief")
def brief_upsert():
    """PUT /api/brief with JSON {"date"?, "content"} — create or replace that day's entry."""
    body = request.get_json(silent=True) or {}
    if "content" not in body:
        return jsonify({"error": "content is required"}), 400
    date = normalize_date(body.get("date"))
    if date is None:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400
    return jsonify(upsert_brief(date, body["content"]))


@app.delete("/api/brief")
def brief_delete():
    """DELETE /api/brief?date=YYYY-MM-DD — remove that day's entry."""
    date = normalize_date(request.args.get("date"))
    if date is None:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400
    if not delete_brief(date):
        return jsonify({"error": "no entry for that date"}), 404
    return jsonify({"deleted": date}), 200


# ---------------- Weekly Schedule API ----------------

@app.get("/api/schedule")
def schedule_get():
    """GET /api/schedule?week=YYYY-MM-DD — week_start is coerced to that week's Monday (defaults to this week)."""
    week = normalize_week(request.args.get("week"))
    if week is None:
        return jsonify({"error": "week must be YYYY-MM-DD"}), 400
    row = fetch_schedule(week)
    if row is None:
        return jsonify({"week_start": week, "content": ""}), 200
    return jsonify(row)


@app.get("/api/schedule/list")
def schedule_list():
    """GET /api/schedule/list?limit=N — most recent weeks first."""
    limit = min(int(request.args.get("limit", 20)), 104)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT week_start, content, created_at, updated_at FROM weekly_schedule ORDER BY week_start DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.put("/api/schedule")
@app.post("/api/schedule")
def schedule_upsert():
    """PUT/POST /api/schedule with JSON {"week"?, "content"} — create or replace that week's entry."""
    body = request.get_json(silent=True) or {}
    if "content" not in body:
        return jsonify({"error": "content is required"}), 400
    week = normalize_week(body.get("week"))
    if week is None:
        return jsonify({"error": "week must be YYYY-MM-DD"}), 400
    return jsonify(upsert_schedule(week, body["content"]))


@app.delete("/api/schedule")
def schedule_delete():
    """DELETE /api/schedule?week=YYYY-MM-DD — remove that week's entry."""
    week = normalize_week(request.args.get("week"))
    if week is None:
        return jsonify({"error": "week must be YYYY-MM-DD"}), 400
    if not delete_schedule(week):
        return jsonify({"error": "no entry for that week"}), 404
    return jsonify({"deleted": week}), 200


# ---------------- Native macOS telemetry ----------------
# A single background collector reads Apple Silicon IOReport/SMC via macmon.
# Browser requests read its latest snapshot; history continues while tabs close.
import json

TELEMETRY_RETENTION_S = 3900
_TELE_LAST_WRITE = {"t": 0.0}

@app.get("/api/stats")
def stats():
    try:
        snapshot = json.loads((DATA_DIR / "latest-stats.json").read_text())
        age = time.time() - datetime.fromisoformat(snapshot["t"]).timestamp()
        snapshot["stale"] = age > 5
        if snapshot["stale"]:
            return jsonify({"error": "Telemetry sampler is reconnecting", "stale": True}), 503
        return jsonify(snapshot)
    except (OSError, ValueError, KeyError):
        return jsonify({"error": "Telemetry sampler is starting", "stale": True}), 503


def record_telemetry_snapshot(cpu_util, temp_c, mem, cpu_w, gpu_w, total_w):
    """Append one per-second row to the telemetry ring buffer (shared sqlite).

    Called on every /api/stats hit; the ts-second PRIMARY KEY dedupes the
    occasional same-second hit from another gunicorn worker.
    """
    now = time.time()
    if now - _TELE_LAST_WRITE["t"] < 1.0:
        return
    _TELE_LAST_WRITE["t"] = now
    ts = int(now)
    try:
        with get_db() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO telemetry
                   (ts, cpu_util, cpu_temp, mem_used, mem_total, pwr_cpu, pwr_gpu, pwr_total)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (ts, cpu_util, temp_c,
                 mem["used_bytes"] if mem else None,
                 mem["total_bytes"] if mem else None,
                 cpu_w, gpu_w, total_w),
            )
            conn.execute("DELETE FROM telemetry WHERE ts < ?", (ts - TELEMETRY_RETENTION_S,))
    except sqlite3.Error:
        pass


@app.get("/api/stats/history")
def stats_history():
    """GET /api/stats/history?seconds=3600 — dense per-second series for the graphs.

    Returns {start, step, count} plus one array per metric; null = no sample
    (tab hidden, dashboard restarted). max 3900s (retention window).
    """
    try:
        seconds = max(60, min(int(request.args.get("seconds", 3600)), TELEMETRY_RETENTION_S))
    except (TypeError, ValueError):
        seconds = 3600
    now = int(time.time())
    start = now - seconds
    n = seconds + 1
    cpu = [None] * n
    temp = [None] * n
    mem_used = [None] * n
    pwr = [None] * n
    pwr_cpu = [None] * n
    pwr_gpu = [None] * n
    mem_total = None
    try:
        with get_db() as conn:
            rows = conn.execute(
                """SELECT ts, cpu_util, cpu_temp, mem_used, mem_total,
                          pwr_cpu, pwr_gpu, pwr_total
                   FROM telemetry WHERE ts >= ? ORDER BY ts""",
                (start,),
            ).fetchall()
    except sqlite3.Error:
        rows = []
    for r in rows:
        i = r["ts"] - start
        if 0 <= i < n:
            cpu[i] = r["cpu_util"]
            temp[i] = r["cpu_temp"]
            mem_used[i] = r["mem_used"]
            pwr[i] = r["pwr_total"]
            pwr_cpu[i] = r["pwr_cpu"]
            pwr_gpu[i] = r["pwr_gpu"]
            if r["mem_total"]:
                mem_total = r["mem_total"]
    return jsonify({
        "start": start, "step": 1, "count": n,
        "cpu": cpu, "temp": temp,
        "mem_used": mem_used, "mem_total": mem_total,
        "pwr": pwr, "pwr_cpu": pwr_cpu, "pwr_gpu": pwr_gpu,
    })


# ---------------- Web shell (host tty in ~) ----------------
# Interactive shell tab: each browser session owns a tmux session on the host
# (started with cwd ~). Flask stays stateless — any gunicorn worker can proxy
# any shell session, since persistence lives in host tmux, not in this process.
# Backend lives in shell_common (shared with the websocket gateway); the
# routes below are thin HTTP wrappers. No extra deps: stdlib subprocess +
# local tmux process under the dashboard user.

from shell_common import (
    check_shell_id,
    new_shell_id,
    parse_dims,
    capture_pane,
    ensure_session,
    kill_session,
    list_sessions,
    paste_text,
    resize_session,
    send_key,
)


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


# ---------------- Filesystem explorer (host fs, opens at ~) ----------------
# Classic SFTP-style browser over the host filesystem. Pure Python path/file
# ops (no shell interpolation), so a crafted path can never become a command.
# No chroot: the Shell tab already runs a full tty as this user, so confining
# this to ~ would buy no real isolation. Paths are lexically normalised rather
# than resolved, so operating on a symlink affects the link, not its target.

FS_HOME = Path.home()

try:
    import grp as _grp
    import pwd as _pwd
except ImportError:  # non-POSIX — owner/group names simply stay blank
    _pwd = _grp = None


def fs_norm(raw):
    """Requested path -> absolute, lexically normalised Path. Empty -> ~."""
    if raw is None or not str(raw).strip():
        return Path(FS_HOME)
    s = str(raw).strip()
    s = s.replace("\x00", "")  # embedded NULs raise ValueError, not OSError
    if s == "~":
        s = str(FS_HOME)
    elif s.startswith("~/"):
        s = str(FS_HOME) + s[1:]
    if not os.path.isabs(s):
        s = os.path.join(str(FS_HOME), s)
    return Path(os.path.normpath(s))


def fs_safe_name(raw):
    """One path component (no separators/traversal). None when unsafe/empty."""
    name = os.path.basename(str(raw or "").replace("\\", "/")).strip()
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        return None
    return name


def fs_entry(path):
    """Stat one path (without following a final symlink). None if unreadable."""
    try:
        st = path.lstat()
    except OSError:
        return None
    is_link = stat.S_ISLNK(st.st_mode)
    try:
        is_dir = path.is_dir() if is_link else stat.S_ISDIR(st.st_mode)
        is_reg = path.is_file() if is_link else stat.S_ISREG(st.st_mode)
    except OSError:
        is_dir = is_reg = False
    kind = "link" if is_link else ("dir" if is_dir else ("file" if is_reg else "other"))
    return {
        "name": path.name or str(path),
        "path": str(path),
        "type": kind,
        "is_dir": is_dir,
        "is_link": is_link,
        "size": st.st_size,
        "mtime": st.st_mtime,
        "mode": stat.filemode(st.st_mode),
        "hidden": path.name.startswith("."),
        "readable": os.access(path, os.R_OK),
        "writable": os.access(path, os.W_OK),
    }


def fs_places():
    """Sidebar shortcut locations, only the ones that exist."""
    candidates = [
        ("Home", FS_HOME),
        ("Desktop", FS_HOME / "Desktop"),
        ("Documents", FS_HOME / "Documents"),
        ("Downloads", FS_HOME / "Downloads"),
        ("Root", Path("/")),
        ("Volumes", Path("/Volumes")),
        ("Temp", Path(tempfile.gettempdir())),
    ]
    seen, places = set(), []
    for name, path in candidates:
        try:
            exists = path.is_dir()
        except OSError:
            exists = False
        key = str(path)
        if exists and key not in seen:
            seen.add(key)
            places.append({"name": name, "path": key})
    return places


def fs_error(msg, code):
    return jsonify({"error": msg}), code


def fs_body_path(body):
    """Resolve a create target from {path} or {parent, name}. None on bad input."""
    if body.get("path"):
        return fs_norm(body["path"])
    parent = body.get("parent")
    name = fs_safe_name(body.get("name"))
    if parent is not None and name:
        return fs_norm(parent) / name
    return None


@app.get("/api/fs/list")
def fs_list():
    """GET /api/fs/list?path=… — directory contents (defaults to ~)."""
    p = fs_norm(request.args.get("path"))
    if not p.exists():
        return fs_error("no such path", 404)
    if not p.is_dir():
        return fs_error("not a directory", 400)
    try:
        with os.scandir(p) as it:
            entries = [e for e in (fs_entry(p / n.name) for n in it) if e is not None]
    except NotADirectoryError:
        return fs_error("not a directory", 400)
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"sorry, could not read that directory ({exc.strerror})", 500)
    # Folders first, then case-insensitive by name. Hidden entries are returned
    # tagged so the UI can toggle them without re-fetching.
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    parent = None if p.parent == p else str(p.parent)
    return jsonify({
        "path": str(p),
        "name": p.name or "/",
        "parent": parent,
        "home": str(FS_HOME),
        "places": fs_places(),
        "entries": entries,
        "total": len(entries),
    })


@app.get("/api/fs/stat")
def fs_stat():
    """GET /api/fs/stat?path=… — one entry plus owner/permissions/mime detail."""
    p = fs_norm(request.args.get("path"))
    info = fs_entry(p)
    if info is None:
        return fs_error("no such path", 404)
    if info["is_link"]:
        try:
            info["link_target"] = os.readlink(p)
        except OSError:
            info["link_target"] = None
    info["mime"] = mimetypes.guess_type(p.name)[0] or (
        "inode/directory" if info["is_dir"] else "application/octet-stream"
    )
    info["mtime_iso"] = datetime.fromtimestamp(info["mtime"]).astimezone().isoformat(timespec="seconds")
    if info["type"] != "link":
        try:
            st = p.stat()
            info["ctime"] = st.st_ctime
            info["ctime_iso"] = datetime.fromtimestamp(st.st_ctime).astimezone().isoformat(timespec="seconds")
            if hasattr(st, "st_birthtime"):
                info["btime"] = st.st_birthtime
                info["btime_iso"] = datetime.fromtimestamp(st.st_birthtime).astimezone().isoformat(timespec="seconds")
            info["uid"] = st.st_uid
            info["gid"] = st.st_gid
            if _pwd is not None:
                try:
                    info["owner"] = _pwd.getpwuid(st.st_uid).pw_name
                except KeyError:
                    pass
            if _grp is not None:
                try:
                    info["group"] = _grp.getgrgid(st.st_gid).gr_name
                except KeyError:
                    pass
        except OSError:
            pass
    return jsonify(info)


@app.get("/api/fs/download")
def fs_download():
    """GET /api/fs/download?path=… — stream one file as an attachment."""
    p = fs_norm(request.args.get("path"))
    if not p.exists():
        return fs_error("no such file", 404)
    if p.is_dir():
        return fs_error("cannot download a directory", 400)
    if not os.access(p, os.R_OK):
        return fs_error("permission denied", 403)
    return send_file(p, as_attachment=True, download_name=p.name, conditional=True)


@app.post("/api/fs/upload")
def fs_upload():
    """POST /api/fs/upload — multipart {path: target dir, file: […], overwrite?}."""
    target = fs_norm(request.form.get("path"))
    if not target.is_dir():
        return fs_error("upload target is not a directory", 400)
    overwrite = str(request.form.get("overwrite", "")).lower() in ("1", "true", "yes")
    incoming = []
    for f in request.files.getlist("file"):
        name = fs_safe_name(f.filename)
        if not name:
            return fs_error("invalid file name", 400)
        incoming.append((name, f))
    if not incoming:
        return fs_error("no files in the request", 400)
    if not overwrite:
        for name, _ in incoming:
            if (target / name).exists():
                return fs_error(f"already exists: {name}", 409)
    for name, _ in incoming:
        if (target / name).is_dir():
            return fs_error(f"a directory is named {name}", 409)
    saved = []
    try:
        for name, f in incoming:
            dest = target / name
            f.save(dest)
            saved.append(str(dest))
    except OSError as exc:
        return fs_error(f"upload failed: {exc.strerror or exc}", 500)
    return jsonify({"saved": saved, "count": len(saved)})


@app.post("/api/fs/mkdir")
def fs_mkdir():
    """POST /api/fs/mkdir — JSON {path} or {parent, name}."""
    body = request.get_json(silent=True) or {}
    p = fs_body_path(body)
    if p is None:
        return fs_error("a name is required", 400)
    if p.exists():
        return fs_error("already exists", 409)
    try:
        p.mkdir(parents=True, exist_ok=False)
    except FileNotFoundError:
        return fs_error("parent directory does not exist", 404)
    except FileExistsError:
        return fs_error("already exists", 409)
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"could not create folder: {exc.strerror or exc}", 500)
    return jsonify(fs_entry(p))


@app.post("/api/fs/touch")
def fs_touch():
    """POST /api/fs/touch — JSON {path} or {parent, name}: create an empty file."""
    body = request.get_json(silent=True) or {}
    p = fs_body_path(body)
    if p is None:
        return fs_error("a name is required", 400)
    if p.exists():
        return fs_error("already exists", 409)
    if not p.parent.is_dir():
        return fs_error("parent directory does not exist", 404)
    try:
        with open(p, "x"):
            pass
    except FileExistsError:
        return fs_error("already exists", 409)
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"could not create file: {exc.strerror or exc}", 500)
    return jsonify(fs_entry(p))


@app.post("/api/fs/rename")
def fs_rename():
    """POST /api/fs/rename — JSON {path, name}: rename within the same folder."""
    body = request.get_json(silent=True) or {}
    src = fs_norm(body.get("path"))
    if not src.exists():
        return fs_error("no such path", 404)
    name = fs_safe_name(body.get("name"))
    if name is None:
        return fs_error("a valid new name is required", 400)
    dest = src.parent / name
    if dest == src:
        return jsonify(fs_entry(src))
    if dest.exists():
        return fs_error("already exists", 409)
    try:
        os.rename(src, dest)
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"could not rename: {exc.strerror or exc}", 500)
    return jsonify(fs_entry(dest))


@app.delete("/api/fs")
def fs_delete():
    """DELETE /api/fs?path=… — remove a file, symlink, or folder (recursive)."""
    p = fs_norm(request.args.get("path"))
    if p == FS_HOME:
        return fs_error("refusing to delete the home directory", 400)
    if not p.exists() and not p.is_symlink():
        return fs_error("no such path", 404)
    try:
        if p.is_symlink():
            p.unlink()  # remove the link, never what it points at
        else:
            real = p.resolve()
            if real.parent == real or real == FS_HOME or real in FS_HOME.parents:
                return fs_error("refusing to delete this path", 400)
            if p.is_dir():
                shutil.rmtree(p)
            else:
                p.unlink()
    except PermissionError:
        return fs_error("permission denied", 403)
    except OSError as exc:
        return fs_error(f"could not delete: {exc.strerror or exc}", 500)
    return jsonify({"deleted": str(p)})


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
