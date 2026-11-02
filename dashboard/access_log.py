"""MCP access log: one row per ``tools/call``, nginx-style.

Every invocation is recorded with its timestamp, tool name, the entity it
touched (doc prefix, card id, lane, bar, date, week), whether it succeeded, how
long it took, and a trimmed argument summary. The table is capped: the oldest
rows fall off once it passes ``MAX_ROWS`` so the log cannot grow without bound.
"""

import threading

from . import db
from .dates import now_iso

MAX_ROWS = 20_000
SUMMARY_MAX = 240
VALUE_MAX = 80
_DELETE_EVERY = 250

_LOCK = threading.Lock()
_WRITES = {"n": 0}


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


def record(tool, arguments=None, ok=True, ms=0, error=None):
    """Append one access-log row. Never raises: logging must not fail a tool call."""
    try:
        conn = db.get_db()
        with _LOCK:
            with conn:
                conn.execute(
                    "INSERT INTO mcp_access_log (ts, tool, entity, ok, ms, args, error)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        now_iso(),
                        str(tool)[:120],
                        entity_for(tool, arguments),
                        1 if ok else 0,
                        max(0, int(ms)),
                        summarise(arguments),
                        (str(error)[:300] if error else None),
                    ),
                )
            _WRITES["n"] += 1
            if _WRITES["n"] % _DELETE_EVERY == 0:
                with conn:
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
    }
