"""Progress Bars: nested percentage bars with arbitrary key/value fields.

A bar is a row. ``parent_id`` makes the tree, ``percent`` is 0-100 and stored as
REAL so batches can report fractions, and ``fields`` is a JSON object of free-form
k-v pairs shown on the card. Writes take a process lock (one gunicorn worker,
many threads); deletes walk the subtree by hand because SQLite foreign keys are
not enforced on these connections.
"""

import json
import math
import threading

from . import db
from .dates import now_iso

_TITLE_MAX = 200
_OWNER_MAX = 100
_FIELD_MAX = 100
_KEY_MAX = 60
_VALUE_MAX = 500
_FIELDS_JSON_MAX = 32_000
_DEPTH_MAX = 8
_WRITE_LOCK = threading.Lock()


class ProgressError(Exception):
    """A request the store refuses; ``status`` is the HTTP code to return."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def init_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS progress_bar (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT NOT NULL,
            percent    REAL NOT NULL DEFAULT 0,
            parent_id  INTEGER,
            position   INTEGER NOT NULL DEFAULT 0,
            fields     TEXT NOT NULL DEFAULT '{}',
            owner      TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS progress_bar_parent"
        " ON progress_bar (parent_id, position, id)"
    )


# ---------------- validation ----------------


def clean_title(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise ProgressError("title is required and must be a non-empty string")
    title = raw.strip()
    if len(title) > _TITLE_MAX:
        raise ProgressError(f"title must be at most {_TITLE_MAX} characters")
    return title


def clean_percent(raw, default=0.0):
    """A finite 0-100 number, rounded to 2 decimals; ``None`` means default."""
    if raw is None:
        return default
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        raise ProgressError("percent must be a number between 0 and 100")
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ProgressError("percent must be a number between 0 and 100") from None
    if not math.isfinite(value) or value < 0 or value > 100:
        raise ProgressError("percent must be a number between 0 and 100")
    return round(value, 2)


def clean_owner(raw):
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ProgressError("owner must be a string or null")
    owner = raw.strip()
    if len(owner) > _OWNER_MAX:
        raise ProgressError(f"owner must be at most {_OWNER_MAX} characters")
    return owner or None


def clean_fields(raw):
    """A flat JSON object of scalar values; order is preserved."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ProgressError("fields must be a JSON object of key/value pairs")
    if len(raw) > _FIELD_MAX:
        raise ProgressError(f"at most {_FIELD_MAX} fields are allowed")
    out = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.strip():
            raise ProgressError("field names must be non-empty strings")
        name = key.strip()
        if len(name) > _KEY_MAX:
            raise ProgressError(f"field names must be at most {_KEY_MAX} characters")
        if isinstance(value, (dict, list)):
            raise ProgressError(f"field {name!r} must be a plain string or number")
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise ProgressError(f"field {name!r} must be a plain string or number")
        if isinstance(value, str) and len(value) > _VALUE_MAX:
            raise ProgressError(f"field {name!r} must be at most {_VALUE_MAX} characters")
        out[name] = value
    if len(json.dumps(out, ensure_ascii=False)) > _FIELDS_JSON_MAX:
        raise ProgressError("fields payload is too large")
    return out


def clean_position(raw, default=None):
    if raw is None:
        return default
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        raise ProgressError("position must be a non-negative integer")
    return raw


def clean_id(raw, label="id"):
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        raise ProgressError(f"{label} must be a positive integer")
    return raw


def clean_remove_fields(raw):
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(isinstance(k, str) for k in raw):
        raise ProgressError("remove_fields must be a list of field names")
    return [k.strip() for k in raw if k.strip()]


# ---------------- reads ----------------


def _row(row):
    data = dict(row)
    try:
        data["fields"] = json.loads(data.get("fields") or "{}")
    except (TypeError, ValueError):
        data["fields"] = {}
    return data


def _all(conn):
    rows = conn.execute(
        "SELECT id, title, percent, parent_id, position, fields, owner,"
        " created_at, updated_at FROM progress_bar ORDER BY position, id"
    ).fetchall()
    return [_row(row) for row in rows]


def _tree(rows):
    nodes = {}
    for row in rows:
        nodes[row["id"]] = {**row, "children": []}
    roots = []
    for row in rows:
        node = nodes[row["id"]]
        parent = nodes.get(row["parent_id"])
        if parent is None:
            roots.append(node)
        else:
            parent["children"].append(node)
    for node in nodes.values():
        node["child_count"] = len(node["children"])
    return roots


def flat():
    return _all(db.get_db())


def tree():
    return _tree(_all(db.get_db()))


def count():
    with db.get_db() as conn:
        return conn.execute("SELECT COUNT(*) FROM progress_bar").fetchone()[0]


def fetch(bar_id):
    """One bar with its nested ``children`` (recursive); None when absent."""
    bar_id = clean_id(bar_id)
    rows = _all(db.get_db())
    roots = _tree(rows)
    stack = list(roots)
    while stack:
        node = stack.pop()
        if node["id"] == bar_id:
            return node
        stack.extend(node["children"])
    return None


def require(bar_id):
    bar = fetch(bar_id)
    if bar is None:
        raise ProgressError(f"no progress bar with id {bar_id}", 404)
    return bar


# ---------------- write helpers ----------------


def _row_by_id(conn, bar_id):
    return conn.execute("SELECT * FROM progress_bar WHERE id = ?", (bar_id,)).fetchone()


def _ancestors(conn, bar_id):
    """Ids above ``bar_id`` (nearest first). A cycle stops the walk."""
    out, seen = [], {bar_id}
    row = _row_by_id(conn, bar_id)
    while row is not None and row["parent_id"] is not None:
        parent = row["parent_id"]
        if parent in seen:
            break
        out.append(parent)
        seen.add(parent)
        row = _row_by_id(conn, parent)
    return out


def _check_parent(conn, parent_id, bar_id=None):
    """Validate a parent link: exists, is not self, is not a descendant, depth ok."""
    if parent_id is None:
        return None
    parent_id = clean_id(parent_id, "parent_id")
    parent = _row_by_id(conn, parent_id)
    if parent is None:
        raise ProgressError(f"no progress bar with id {parent_id}", 404)
    if bar_id is not None:
        if parent_id == bar_id:
            raise ProgressError("a bar cannot be its own parent")
        if bar_id in _ancestors(conn, parent_id):
            raise ProgressError("that parent is inside this bar's subtree (cycle)")
    if len(_ancestors(conn, parent_id)) + 1 >= _DEPTH_MAX:
        raise ProgressError(f"nesting is limited to {_DEPTH_MAX} levels")
    return parent_id


def _next_position(conn, parent_id):
    row = conn.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM progress_bar"
        " WHERE parent_id IS ?",
        (parent_id,),
    ).fetchone()
    return row[0]


def _subtree_ids(conn, bar_id):
    ids, stack = [], [bar_id]
    while stack:
        current = stack.pop()
        ids.append(current)
        stack.extend(
            r[0]
            for r in conn.execute(
                "SELECT id FROM progress_bar WHERE parent_id = ?", (current,)
            ).fetchall()
        )
    return ids


# ---------------- writes ----------------


def create(title, percent=None, parent_id=None, fields=None, owner=None, position=None):
    title = clean_title(title)
    value = clean_percent(percent)
    fields = clean_fields(fields)
    owner = clean_owner(owner)
    with _WRITE_LOCK:
        conn = db.get_db()
        parent_id = _check_parent(conn, parent_id)
        pos = clean_position(position)
        stamp = now_iso()
        with conn:
            if pos is None:
                pos = _next_position(conn, parent_id)
            cur = conn.execute(
                "INSERT INTO progress_bar"
                " (title, percent, parent_id, position, fields, owner, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    title,
                    value,
                    parent_id,
                    pos,
                    json.dumps(fields, ensure_ascii=False),
                    owner,
                    stamp,
                    stamp,
                ),
            )
            new_id = cur.lastrowid
    return fetch(new_id)


def update(bar_id, changes):
    """Patch one bar. ``fields`` replaces the map; ``add_fields`` merges;
    ``remove_fields`` deletes keys (applied in that order)."""
    bar_id = clean_id(bar_id)
    with _WRITE_LOCK:
        conn = db.get_db()
        row = _row_by_id(conn, bar_id)
        if row is None:
            raise ProgressError(f"no progress bar with id {bar_id}", 404)
        sets, args = [], []

        if "title" in changes:
            sets.append("title = ?")
            args.append(clean_title(changes["title"]))
        if "percent" in changes:
            sets.append("percent = ?")
            args.append(clean_percent(changes["percent"]))
        if "owner" in changes:
            sets.append("owner = ?")
            args.append(clean_owner(changes["owner"]))
        if "position" in changes:
            pos = clean_position(changes["position"])
            if pos is None:
                raise ProgressError("position must be a non-negative integer")
            sets.append("position = ?")
            args.append(pos)
        if "parent_id" in changes:
            parent_id = _check_parent(conn, changes["parent_id"], bar_id)
            sets.append("parent_id = ?")
            args.append(parent_id)

        fields = None
        if "fields" in changes:
            fields = clean_fields(changes["fields"])
        if "add_fields" in changes:
            base = fields if fields is not None else _row(row)["fields"]
            base.update(clean_fields(changes["add_fields"]))
            fields = base
        remove = clean_remove_fields(changes.get("remove_fields"))
        if remove:
            base = fields if fields is not None else _row(row)["fields"]
            for key in remove:
                base.pop(key, None)
            fields = base
        if fields is not None:
            sets.append("fields = ?")
            args.append(json.dumps(clean_fields(fields), ensure_ascii=False))

        if not sets:
            return fetch(bar_id)
        sets.append("updated_at = ?")
        args.append(now_iso())
        args.append(bar_id)
        with conn:
            conn.execute(f"UPDATE progress_bar SET {', '.join(sets)} WHERE id = ?", args)
    return fetch(bar_id)


def delete(bar_id, cascade=False):
    """Delete a bar. With children it requires ``cascade``; returns the count."""
    bar_id = clean_id(bar_id)
    with _WRITE_LOCK:
        conn = db.get_db()
        if _row_by_id(conn, bar_id) is None:
            raise ProgressError(f"no progress bar with id {bar_id}", 404)
        ids = _subtree_ids(conn, bar_id)
        if len(ids) > 1 and not cascade:
            raise ProgressError(
                f"bar {bar_id} has {len(ids) - 1} nested bar(s);"
                " pass cascade=true to delete them all",
                409,
            )
        with conn:
            conn.execute(
                f"DELETE FROM progress_bar WHERE id IN ({','.join('?' * len(ids))})", ids
            )
    return len(ids)
