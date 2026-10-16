"""Kanban board persistence (SQLite via ``dashboard.db``).

Lanes are rows, so they can be added, renamed, reordered, and removed through
the API. Cards belong to one lane and carry a 0-based ``position`` inside it;
every write renumbers the affected lanes so positions stay contiguous. Writes
are serialised with a process lock (gunicorn runs one worker, many threads).
"""

import threading

from . import db
from .dates import now_iso

DEFAULT_LANES = ("Backlog", "To Do", "In Progress", "Done")
_WRITE_LOCK = threading.Lock()


class KanbanError(Exception):
    """A request the store refuses; ``status`` is the HTTP code to return."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def init_schema(conn):
    """Create the kanban tables; seed default lanes only on first creation."""
    existed = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kanban_lane'"
    ).fetchone()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kanban_lane (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
            position   INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kanban_card (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT NOT NULL,
            owner      TEXT,
            lane_id    INTEGER NOT NULL REFERENCES kanban_lane(id),
            position   INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS kanban_card_lane ON kanban_card (lane_id, position)")
    if not existed:
        stamp = now_iso()
        conn.executemany(
            "INSERT INTO kanban_lane (name, position, created_at, updated_at) VALUES (?, ?, ?, ?)",
            [(name, i, stamp, stamp) for i, name in enumerate(DEFAULT_LANES)],
        )


# ---------------- reads ----------------

CARD_SQL = (
    "SELECT c.id, c.title, c.owner, l.name AS status, c.lane_id, c.position,"
    " c.created_at, c.updated_at FROM kanban_card c JOIN kanban_lane l ON l.id = c.lane_id"
)


def lanes(conn):
    rows = conn.execute(
        "SELECT l.id, l.name, l.position, l.created_at, l.updated_at,"
        " (SELECT COUNT(*) FROM kanban_card c WHERE c.lane_id = l.id) AS card_count"
        " FROM kanban_lane l ORDER BY l.position, l.id"
    ).fetchall()
    return [dict(r) for r in rows]


def find_lane(conn, ref):
    """Resolve a lane by numeric id or by name (case-insensitive); None if absent."""
    if isinstance(ref, bool) or ref is None:
        return None
    if isinstance(ref, int) or (isinstance(ref, str) and ref.strip().isdigit()):
        row = conn.execute("SELECT * FROM kanban_lane WHERE id = ?", (int(ref),)).fetchone()
        if row:
            return dict(row)
    if isinstance(ref, str):
        row = conn.execute(
            "SELECT * FROM kanban_lane WHERE name = ? COLLATE NOCASE", (ref.strip(),)
        ).fetchone()
        return dict(row) if row else None
    return None


def require_lane(conn, ref, label="status"):
    lane = find_lane(conn, ref)
    if lane is None:
        names = ", ".join(lane["name"] for lane in lanes(conn))
        raise KanbanError(f"unknown {label} {ref!r}; lanes are: {names}", 400)
    return lane


def cards(conn, lane_id=None, owner=None):
    sql, args, where = CARD_SQL, [], []
    if lane_id is not None:
        where.append("c.lane_id = ?")
        args.append(lane_id)
    if owner == "":
        where.append("c.owner IS NULL")
    elif owner is not None:
        where.append("c.owner = ? COLLATE NOCASE")
        args.append(owner)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY l.position, l.id, c.position, c.id"
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def card(conn, card_id):
    row = conn.execute(CARD_SQL + " WHERE c.id = ?", (card_id,)).fetchone()
    if row is None:
        raise KanbanError("card not found", 404)
    return dict(row)


def board(status=None, owner=None):
    conn = db.get_db()
    lane_id = require_lane(conn, status)["id"] if status is not None else None
    return {"lanes": lanes(conn), "cards": cards(conn, lane_id, owner)}


# ---------------- ordering helpers ----------------


def _lane_card_ids(conn, lane_id, exclude=None):
    rows = conn.execute(
        "SELECT id FROM kanban_card WHERE lane_id = ? ORDER BY position, id", (lane_id,)
    ).fetchall()
    return [r["id"] for r in rows if r["id"] != exclude]


def _write_order(conn, lane_id, ids):
    conn.executemany(
        "UPDATE kanban_card SET lane_id = ?, position = ? WHERE id = ?",
        [(lane_id, i, cid) for i, cid in enumerate(ids)],
    )


def _place(ids, item, position):
    index = len(ids) if position is None else max(0, min(position, len(ids)))
    ids.insert(index, item)
    return ids


# ---------------- card writes ----------------


def create_card(title, owner=None, status=None, position=None):
    with _WRITE_LOCK, db.get_db() as conn:
        if status is None:
            first = conn.execute(
                "SELECT * FROM kanban_lane ORDER BY position, id LIMIT 1"
            ).fetchone()
            if first is None:
                raise KanbanError("the board has no lanes; create one first", 409)
            lane = dict(first)
        else:
            lane = require_lane(conn, status)
        stamp = now_iso()
        cur = conn.execute(
            "INSERT INTO kanban_card (title, owner, lane_id, position, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (title, owner, lane["id"], 1 << 30, stamp, stamp),
        )
        new_id = cur.lastrowid
        ids = _place(_lane_card_ids(conn, lane["id"], exclude=new_id), new_id, position)
        _write_order(conn, lane["id"], ids)
        return card(conn, new_id)


def update_card(card_id, changes):
    """Apply any of title / owner / status / position. Returns the updated card."""
    with _WRITE_LOCK, db.get_db() as conn:
        current = card(conn, card_id)
        fields = {k: changes[k] for k in ("title", "owner") if k in changes}
        if "status" in changes or "position" in changes:
            target = current["lane_id"]
            if "status" in changes:
                target = require_lane(conn, changes["status"])["id"]
            position = changes.get("position")
            if position is None and target == current["lane_id"]:
                position = current["position"]
            ids = _place(_lane_card_ids(conn, target, exclude=card_id), card_id, position)
            _write_order(conn, target, ids)
            if target != current["lane_id"]:
                _write_order(conn, current["lane_id"], _lane_card_ids(conn, current["lane_id"]))
        fields["updated_at"] = now_iso()
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE kanban_card SET {sets} WHERE id = ?", (*fields.values(), card_id))
        return card(conn, card_id)


def delete_card(card_id):
    with _WRITE_LOCK, db.get_db() as conn:
        current = card(conn, card_id)
        conn.execute("DELETE FROM kanban_card WHERE id = ?", (card_id,))
        _write_order(conn, current["lane_id"], _lane_card_ids(conn, current["lane_id"]))
        return current


# ---------------- lane writes ----------------


def _lane_out(conn, lane_id):
    return next(lane for lane in lanes(conn) if lane["id"] == lane_id)


def _reorder_lanes(conn, lane_id, position):
    rows = conn.execute("SELECT id FROM kanban_lane ORDER BY position, id").fetchall()
    ids = _place([r["id"] for r in rows if r["id"] != lane_id], lane_id, position)
    conn.executemany(
        "UPDATE kanban_lane SET position = ? WHERE id = ?", [(i, lid) for i, lid in enumerate(ids)]
    )


def _check_name_free(conn, name, lane_id=None):
    clash = find_lane(conn, name)
    if clash and clash["id"] != lane_id:
        raise KanbanError(f"a lane named {clash['name']!r} already exists", 409)


def create_lane(name, position=None):
    with _WRITE_LOCK, db.get_db() as conn:
        _check_name_free(conn, name)
        stamp = now_iso()
        cur = conn.execute(
            "INSERT INTO kanban_lane (name, position, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (name, 1 << 30, stamp, stamp),
        )
        _reorder_lanes(conn, cur.lastrowid, position)
        return _lane_out(conn, cur.lastrowid)


def update_lane(ref, name=None, position=None):
    with _WRITE_LOCK, db.get_db() as conn:
        lane = find_lane(conn, ref)
        if lane is None:
            raise KanbanError("lane not found", 404)
        if name is not None:
            _check_name_free(conn, name, lane["id"])
            conn.execute("UPDATE kanban_lane SET name = ? WHERE id = ?", (name, lane["id"]))
        if position is not None:
            _reorder_lanes(conn, lane["id"], position)
        conn.execute("UPDATE kanban_lane SET updated_at = ? WHERE id = ?", (now_iso(), lane["id"]))
        return _lane_out(conn, lane["id"])


def delete_lane(ref, force=False, target=None):
    """Delete a lane. Cards block it unless ``force`` (cards deleted) or ``target`` (moved)."""
    with _WRITE_LOCK, db.get_db() as conn:
        lane = find_lane(conn, ref)
        if lane is None:
            raise KanbanError("lane not found", 404)
        ids = _lane_card_ids(conn, lane["id"])
        moved_to = None
        if ids and target is not None:
            dest = require_lane(conn, target, label="target lane")
            if dest["id"] == lane["id"]:
                raise KanbanError("target lane must differ from the lane being deleted", 400)
            _write_order(conn, dest["id"], _lane_card_ids(conn, dest["id"]) + ids)
            moved_to = dest["name"]
        elif ids and force:
            conn.execute("DELETE FROM kanban_card WHERE lane_id = ?", (lane["id"],))
        elif ids:
            raise KanbanError(
                f"lane {lane['name']!r} has {len(ids)} card(s); pass ?target=<lane> to move"
                " them or ?force=1 to delete them",
                409,
            )
        conn.execute("DELETE FROM kanban_lane WHERE id = ?", (lane["id"],))
        _reorder_lanes_compact(conn)
        return {"deleted": lane["name"], "id": lane["id"], "cards": len(ids), "moved_to": moved_to}


def _reorder_lanes_compact(conn):
    rows = conn.execute("SELECT id FROM kanban_lane ORDER BY position, id").fetchall()
    conn.executemany(
        "UPDATE kanban_lane SET position = ? WHERE id = ?",
        [(i, r["id"]) for i, r in enumerate(rows)],
    )
