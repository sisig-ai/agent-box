"""Kanban board persistence (SQLite via ``dashboard.db``).

Lanes are rows, so they can be added, renamed, reordered, and removed through
the API. Cards belong to one lane and carry a 0-based ``position`` inside it;
every write renumbers the affected lanes so positions stay contiguous. Writes
are serialised with a process lock (gunicorn runs one worker, many threads).
"""

import threading

from . import card_docs, db, kanban_embed
from .dates import now_iso
from .kanban_body import with_body_summary

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
            updated_at TEXT NOT NULL,
            archived_at TEXT,
            body       TEXT NOT NULL DEFAULT '',
            opname     TEXT
        )
        """
    )
    migrate(conn)
    from .kanban_comments import init_schema as init_comments
    from .kanban_search import init_schema as init_search

    init_comments(conn)
    init_search(conn)
    conn.execute("CREATE INDEX IF NOT EXISTS kanban_card_lane ON kanban_card (lane_id, position)")
    if not existed:
        stamp = now_iso()
        conn.executemany(
            "INSERT INTO kanban_lane (name, position, created_at, updated_at) VALUES (?, ?, ?, ?)",
            [(name, i, stamp, stamp) for i, name in enumerate(DEFAULT_LANES)],
        )


def migrate(conn):
    """Additive, idempotent migrations for databases created by older versions."""
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(kanban_card)").fetchall()}
    if "archived_at" not in columns:
        conn.execute("ALTER TABLE kanban_card ADD COLUMN archived_at TEXT")
    if "body" not in columns:
        conn.execute("ALTER TABLE kanban_card ADD COLUMN body TEXT NOT NULL DEFAULT ''")
    if "opname" not in columns:
        # Optional operation name ("Operation Valhalla"); nullable, so old rows stay valid.
        conn.execute("ALTER TABLE kanban_card ADD COLUMN opname TEXT")
    if "parent_id" not in columns:
        # Subtasks are cards with a parent; the board only lists parent_id IS NULL.
        conn.execute("ALTER TABLE kanban_card ADD COLUMN parent_id INTEGER")
    conn.execute("CREATE INDEX IF NOT EXISTS kanban_card_parent ON kanban_card (parent_id)")


# ---------------- reads ----------------

CARD_SQL = (
    "SELECT c.id, c.title, c.owner, l.name AS status, c.lane_id, c.position,"
    " c.created_at, c.updated_at, c.archived_at, c.body, c.opname, c.parent_id,"
    " (SELECT COUNT(*) FROM kanban_comment k WHERE k.card_id = c.id) AS comment_count,"
    " (SELECT COUNT(*) FROM kanban_card s WHERE s.parent_id = c.id AND s.archived_at IS NULL)"
    " AS subtask_count"
    " FROM kanban_card c JOIN kanban_lane l ON l.id = c.lane_id"
)


def lanes(conn):
    rows = conn.execute(
        "SELECT l.id, l.name, l.position, l.created_at, l.updated_at,"
        " (SELECT COUNT(*) FROM kanban_card c WHERE c.lane_id = l.id"
        "  AND c.archived_at IS NULL) AS card_count,"
        " (SELECT COUNT(*) FROM kanban_card c WHERE c.lane_id = l.id"
        "  AND c.archived_at IS NOT NULL) AS archived_count"
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


def cards(conn, lane_id=None, owner=None, archived="exclude", include_body=False, opname=None):
    """Cards in board order. ``archived``: "exclude" (default), "include", or "only".
    Full ``body`` only with ``include_body``; the summary fields are always set.
    ``opname``: None = no filter, "" = cards without an opname, else a
    case-insensitive exact match."""
    sql, args, where = CARD_SQL, [], ["c.parent_id IS NULL"]
    if archived == "exclude":
        where.append("c.archived_at IS NULL")
    elif archived == "only":
        where.append("c.archived_at IS NOT NULL")
    if lane_id is not None:
        where.append("c.lane_id = ?")
        args.append(lane_id)
    if owner == "":
        where.append("c.owner IS NULL")
    elif owner is not None:
        where.append("c.owner = ? COLLATE NOCASE")
        args.append(owner)
    if opname == "":
        where.append("c.opname IS NULL")
    elif opname is not None:
        where.append("c.opname = ? COLLATE NOCASE")
        args.append(opname)
    if where:
        sql += " WHERE " + " AND ".join(where)
    if archived == "only":
        sql += " ORDER BY c.archived_at DESC, c.id DESC"
    else:
        sql += " ORDER BY c.archived_at IS NOT NULL, l.position, l.id, c.position, c.id"
    rows = conn.execute(sql, args).fetchall()
    out = [with_body_summary(r, include_body) for r in rows]
    refs = card_docs.refs_for(conn, [item["id"] for item in out])
    for item in out:
        item["docs"] = refs.get(item["id"], [])
    return out


def card(conn, card_id):
    """One card, always with its full ``body``."""
    row = conn.execute(CARD_SQL + " WHERE c.id = ?", (card_id,)).fetchone()
    if row is None:
        raise KanbanError("card not found", 404)
    out = with_body_summary(row)
    out["docs"] = card_docs.refs_for(conn, [card_id]).get(card_id, [])
    return out


def board(status=None, owner=None, archived="exclude", include_body=False, opname=None):
    conn = db.get_db()
    lane_id = require_lane(conn, status)["id"] if status is not None else None
    return {
        "lanes": lanes(conn),
        "cards": cards(conn, lane_id, owner, archived, include_body, opname),
    }


def opnames(conn, archived="include"):
    """Distinct opnames with card counts, alphabetical (case-insensitive).

    Spelling variants that differ only by case are merged under the most
    recently updated spelling. ``archived`` as in ``cards()``."""
    where = ["c.opname IS NOT NULL", "c.parent_id IS NULL"]
    if archived == "exclude":
        where.append("c.archived_at IS NULL")
    elif archived == "only":
        where.append("c.archived_at IS NOT NULL")
    rows = conn.execute(
        "SELECT c.opname, c.archived_at, c.updated_at FROM kanban_card c WHERE "
        + " AND ".join(where)
        + " ORDER BY c.updated_at DESC, c.id DESC"
    ).fetchall()
    out = {}
    for r in rows:
        key = r["opname"].casefold()
        entry = out.setdefault(
            key, {"opname": r["opname"], "card_count": 0, "active_count": 0, "archived_count": 0}
        )
        entry["card_count"] += 1
        entry["archived_count" if r["archived_at"] else "active_count"] += 1
    return sorted(out.values(), key=lambda e: e["opname"].casefold())


# ---------------- ordering helpers ----------------


def _lane_card_ids(conn, lane_id, exclude=None):
    """Visible (non-archived) card ids of a lane, in order."""
    rows = conn.execute(
        "SELECT id FROM kanban_card WHERE lane_id = ? AND archived_at IS NULL"
        " AND parent_id IS NULL ORDER BY position, id",
        (lane_id,),
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


def create_card(title, owner=None, status=None, position=None, body="", opname=None, docs=None):
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
            "INSERT INTO kanban_card"
            " (title, owner, lane_id, position, created_at, updated_at, body, opname)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (title, owner, lane["id"], 1 << 30, stamp, stamp, body or "", opname),
        )
        new_id = cur.lastrowid
        ids = _place(_lane_card_ids(conn, lane["id"], exclude=new_id), new_id, position)
        _write_order(conn, lane["id"], ids)
        card_docs.set_refs(conn, new_id, docs or [])
        result = card(conn, new_id)
    kanban_embed.enqueue(new_id)
    return result


def update_card(card_id, changes):
    """Apply any of title / owner / body / opname / status / position / archived; returns the card.

    Archiving takes the card out of its lane's ordering (the visible cards are
    renumbered); unarchiving puts it back at ``position`` or the bottom.
    """
    with _WRITE_LOCK, db.get_db() as conn:
        current = card(conn, card_id)
        old_lane = current["lane_id"]
        was = current["archived_at"] is not None
        will = changes.get("archived", was)
        fields = {k: changes[k] for k in ("title", "owner", "body", "opname") if k in changes}
        docs = changes.get("docs")
        target = require_lane(conn, changes["status"])["id"] if "status" in changes else old_lane
        if will:
            if not was:
                fields["archived_at"] = now_iso()
                _write_order(conn, old_lane, _lane_card_ids(conn, old_lane, exclude=card_id))
            if target != old_lane:
                fields["lane_id"] = target
        elif was or "status" in changes or "position" in changes:
            if was:
                fields["archived_at"] = None
            position = changes.get("position")
            if position is None and target == old_lane and not was:
                position = current["position"]
            ids = _place(_lane_card_ids(conn, target, exclude=card_id), card_id, position)
            _write_order(conn, target, ids)
            if target != old_lane and not was:
                _write_order(conn, old_lane, _lane_card_ids(conn, old_lane))
        fields["updated_at"] = now_iso()
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE kanban_card SET {sets} WHERE id = ?", (*fields.values(), card_id))
        if docs is not None:
            card_docs.set_refs(conn, card_id, docs)
        result = card(conn, card_id)
    if {"title", "body", "opname", "owner"} & set(fields):
        kanban_embed.enqueue(card_id)
    return result


def archive_lane(lane_name="Done"):
    """Archive every visible card in the lane named ``lane_name`` (case-insensitive)."""
    with _WRITE_LOCK, db.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM kanban_lane WHERE name = ? COLLATE NOCASE", (lane_name,)
        ).fetchone()
        if row is None:
            raise KanbanError(f"no lane named {lane_name!r}", 404)
        ids = _lane_card_ids(conn, row["id"])
        stamp = now_iso()
        conn.executemany(
            "UPDATE kanban_card SET archived_at = ?, updated_at = ? WHERE id = ?",
            [(stamp, stamp, cid) for cid in ids],
        )
        return {"archived": len(ids), "ids": ids, "lane": row["name"], "archived_at": stamp}


def move_lane(from_name, to_name):
    """Move every visible card of one lane to the bottom of another, in order."""
    with _WRITE_LOCK, db.get_db() as conn:
        source = conn.execute(
            "SELECT * FROM kanban_lane WHERE name = ? COLLATE NOCASE", (from_name,)
        ).fetchone()
        target = conn.execute(
            "SELECT * FROM kanban_lane WHERE name = ? COLLATE NOCASE", (to_name,)
        ).fetchone()
        if source is None:
            raise KanbanError(f"no lane named {from_name!r}", 404)
        if target is None:
            raise KanbanError(f"no lane named {to_name!r}", 404)
        if source["id"] == target["id"]:
            raise KanbanError("source and target lane are the same", 400)
        ids = _lane_card_ids(conn, source["id"])
        if ids:
            _write_order(conn, target["id"], _lane_card_ids(conn, target["id"]) + ids)
            stamp = now_iso()
            conn.executemany(
                "UPDATE kanban_card SET updated_at = ? WHERE id = ?",
                [(stamp, cid) for cid in ids],
            )
        return {"moved": len(ids), "ids": ids, "from": source["name"], "to": target["name"]}


def delete_card(card_id):
    with _WRITE_LOCK, db.get_db() as conn:
        current = card(conn, card_id)
        children = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM kanban_card WHERE parent_id = ?", (card_id,)
            ).fetchall()
        ]
        for child in [*children, card_id]:
            conn.execute("DELETE FROM kanban_comment WHERE card_id = ?", (child,))
            card_docs.forget_card(conn, child)
            kanban_embed.drop(child, conn)
        if children:
            marks = ",".join("?" for _ in children)
            conn.execute(f"DELETE FROM kanban_card WHERE id IN ({marks})", children)
        conn.execute("DELETE FROM kanban_card WHERE id = ?", (card_id,))
        _write_order(conn, current["lane_id"], _lane_card_ids(conn, current["lane_id"]))
        return current
