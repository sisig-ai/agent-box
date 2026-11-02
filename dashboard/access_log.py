"""MCP access log: one row per ``tools/call``, nginx-style.

Every invocation is recorded with its timestamp, tool name, the entity it
touched (doc prefix, card id, lane, bar, date, week), whether it succeeded, how
long it took, and a trimmed argument summary.

Storage is two copies of the same data: a rotated daily file
(``data/logs/access-YYYY-MM-DD.log``, one JSON object per line) and the
``mcp_access_log`` table that the page reads. Both keep
``config.MCP_LOG_RETENTION_DAYS`` days (7 by default): the writer starts a new
file at midnight and deletes whole files past the window, and the table is
pruned by timestamp on the same schedule. ``MAX_ROWS`` stays as a hard cap so
an extreme burst cannot fill the disk between sweeps.
"""

import contextlib
import json
import threading
from datetime import datetime, timedelta

from . import config, db
from .dates import now_iso, today_str

MAX_ROWS = 20_000
SUMMARY_MAX = 240
VALUE_MAX = 80
_DELETE_EVERY = 250
_PRUNE_EVERY = 50

_LOCK = threading.Lock()
_WRITES = {"n": 0}
_FILE = {"day": None, "handle": None}


def _today():
    """Indirection so tests can move the clock without freezing the process."""
    return today_str()


def log_path(day):
    return config.MCP_LOG_DIR / f"access-{day}.log"


class LogError(Exception):
    """A request the log refuses; ``status`` is the HTTP code to return."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def init_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mcp_access_log (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            ts      TEXT NOT NULL,
            tool    TEXT NOT NULL,
            entity  TEXT,
            ok      INTEGER NOT NULL DEFAULT 1,
            ms      INTEGER NOT NULL DEFAULT 0,
            args    TEXT NOT NULL DEFAULT '',
            error   TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS mcp_access_log_ts ON mcp_access_log (ts DESC, id DESC)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS mcp_access_log_tool ON mcp_access_log (tool)")


# Which argument names identify the thing a tool touched, best first.
_ENTITY_FIELDS = {
    "get_card": ("id",),
    "update_card": ("id",),
    "delete_card": ("id",),
    "list_comments": ("card_id",),
    "add_comment": ("card_id",),
    "delete_comment": ("card_id", "id"),
    "update_lane": ("id", "lane_id"),
    "delete_lane": ("id", "lane_id"),
    "list_cards": ("lane_id", "owner", "opname"),
    "put_doc": ("prefix",),
    "get_doc": ("prefix",),
    "patch_doc": ("prefix",),
    "delete_doc": ("prefix",),
    "semantic_search_docs": ("prefix", "q"),
    "search_docs": ("prefix", "q"),
    "list_docs": ("prefix",),
    "put_sitrep": ("date",),
    "delete_sitrep": ("date",),
    "get_sitrep": ("date",),
    "put_schedule": ("week",),
    "delete_schedule": ("week",),
    "get_schedule": ("week",),
    "get_progress_bar": ("id",),
    "update_progress_bar": ("id",),
    "delete_progress_bar": ("id",),
    "create_progress_bar": ("parent_id", "title"),
}
_FALLBACK_FIELDS = ("prefix", "id", "card_id", "lane_id", "date", "week", "q", "title", "name")


def entity_for(tool, arguments):
    """The id of the thing this call touched, as one short string."""
    if not isinstance(arguments, dict):
        return ""
    for field in _ENTITY_FIELDS.get(tool, ()) + _FALLBACK_FIELDS:
        value = arguments.get(field)
        if value is None or isinstance(value, (dict, list, bool)):
            continue
        text = str(value).strip()
        if text:
            return text[:160]
    return ""


def summarise(arguments):
    """Compact, secret-free-ish argument summary for the request column."""
    if not isinstance(arguments, dict):
        return ""
    parts = []
    for key, value in arguments.items():
        if isinstance(value, str):
            clean = " ".join(value.split())
            parts.append(f"{key}={clean[:VALUE_MAX]}" + ("…" if len(clean) > VALUE_MAX else ""))
        elif isinstance(value, (int, float, bool)) or value is None:
            parts.append(f"{key}={value}")
        elif isinstance(value, list):
            parts.append(f"{key}[{len(value)}]")
        elif isinstance(value, dict):
            parts.append(f"{key}{{{len(value)}}}")
    text = " ".join(parts)
    return text[:SUMMARY_MAX]


def _close_file():
    handle = _FILE.get("handle")
    _FILE["handle"] = None
    _FILE["day"] = None
    if handle is not None:
        with contextlib.suppress(OSError):
            handle.close()


def _rotate_files(day):
    """Start a new daily file and delete whole files outside the retention window."""
    cutoff = datetime.strptime(day, "%Y-%m-%d") - timedelta(days=config.MCP_LOG_RETENTION_DAYS)
    config.MCP_LOG_DIR.mkdir(parents=True, exist_ok=True)
    for path in config.MCP_LOG_DIR.glob("access-*.log"):
        stamp = path.stem.removeprefix("access-")
        try:
            too_old = datetime.strptime(stamp, "%Y-%m-%d") < cutoff
        except ValueError:
            continue
        if too_old:
            with contextlib.suppress(OSError):
                path.unlink()
    _close_file()
    # Long-lived handle: opened once per day and closed on the next rotation.
    _FILE["handle"] = open(log_path(day), "a", encoding="utf-8")  # noqa: SIM115
    _FILE["day"] = day


def _append_line(entry):
    """Append one JSON line to today's file, rotating when the day changes."""
    day = _today()
    if _FILE["day"] != day or _FILE["handle"] is None:
        _rotate_files(day)
    _FILE["handle"].write(json.dumps(entry, ensure_ascii=False) + "\n")
    _FILE["handle"].flush()


def _prune_db(conn):
    """Drop table rows older than the retention window."""
    conn.execute(
        "DELETE FROM mcp_access_log WHERE julianday(ts) < julianday('now', ?)",
        (f"-{config.MCP_LOG_RETENTION_DAYS} days",),
    )


def rotate():
    """Force a new daily file and sweep the old ones (called at day change and by the API)."""
    day = _today()
    with _LOCK:
        _rotate_files(day)
    return {"day": day, "retention_days": config.MCP_LOG_RETENTION_DAYS}


def files():
    """The retained daily files, newest first, with their line counts."""
    out = []
    for path in sorted(config.MCP_LOG_DIR.glob("access-*.log"), reverse=True):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        out.append({"name": path.name, "day": path.stem.removeprefix("access-"), "bytes": size})
    return out


def record(tool, arguments=None, ok=True, ms=0, error=None):
    """Append one access-log row. Never raises: logging must not fail a tool call."""
    entry = {
        "ts": now_iso(),
        "tool": str(tool)[:120],
        "entity": entity_for(tool, arguments),
        "ok": 1 if ok else 0,
        "ms": max(0, int(ms)),
        "args": summarise(arguments),
        "error": (str(error)[:300] if error else None),
    }
    with contextlib.suppress(OSError), _LOCK:
        _append_line(entry)
    try:
        conn = db.get_db()
        with _LOCK:
            with conn:
                conn.execute(
                    "INSERT INTO mcp_access_log (ts, tool, entity, ok, ms, args, error)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        entry["ts"],
                        entry["tool"],
                        entry["entity"],
                        entry["ok"],
                        entry["ms"],
                        entry["args"],
                        entry["error"],
                    ),
                )
            _WRITES["n"] += 1
            should_prune = _WRITES["n"] % _PRUNE_EVERY == 0
            if _WRITES["n"] % _DELETE_EVERY == 0 or should_prune:
                with conn:
                    if should_prune:
                        _prune_db(conn)
                    conn.execute(
                        "DELETE FROM mcp_access_log WHERE id <="
                        " (SELECT max(id) FROM mcp_access_log) - ?",
                        (MAX_ROWS,),
                    )
    except Exception:  # noqa: BLE001 - a logging failure must stay silent
        pass


def list_entries(limit=200, tool=None, entity=None, ok=None):
    """Newest first, optionally filtered by tool, entity or outcome."""
    limit = max(1, min(int(limit or 200), 1000))
    clauses, args = [], []
    if tool:
        clauses.append("tool = ?")
        args.append(tool)
    if entity:
        clauses.append("entity LIKE ?")
        args.append(f"%{entity}%")
    if ok is not None:
        clauses.append("ok = ?")
        args.append(1 if ok else 0)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    conn = db.get_db()
    # A read is a cheap moment to sweep: retention applies even when no call
    # has been written since the last visit.
    with conn:
        _prune_db(conn)
    rows = conn.execute(
        "SELECT id, ts, tool, entity, ok, ms, args, error FROM mcp_access_log"
        + where
        + " ORDER BY id DESC LIMIT ?",
        (*args, limit),
    ).fetchall()
    total = conn.execute("SELECT count(*) FROM mcp_access_log" + where, args).fetchone()[0]
    tools = [
        row["tool"]
        for row in conn.execute(
            "SELECT tool, count(*) AS n FROM mcp_access_log GROUP BY tool ORDER BY n DESC, tool"
        )
    ]
    return {
        "entries": [
            {
                "id": row["id"],
                "ts": row["ts"],
                "tool": row["tool"],
                "entity": row["entity"],
                "ok": bool(row["ok"]),
                "ms": row["ms"],
                "args": row["args"],
                "error": row["error"],
            }
            for row in rows
        ],
        "count": len(rows),
        "total": total,
        "tools": tools,
        "retention_days": config.MCP_LOG_RETENTION_DAYS,
        "files": files(),
    }
