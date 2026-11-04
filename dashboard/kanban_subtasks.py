"""Subtasks for board cards.

A subtask is a row in kanban_card with ``parent_id`` set: same storage, same
comments, same doc bindings, but hidden from the board (every board query
filters ``parent_id IS NULL``). A subtask inherits its parent's opname and owner
when it is created; a lane is optional and defaults to the parent's lane.
"""

from . import db, kanban
from .kanban import KanbanError


def _card(conn, card_id):
    return kanban.card(conn, card_id)


def list_for(conn, parent_id, include_archived=False):
    """Subtasks of one card, oldest first, each with docs and comment counts."""
    sql = "SELECT id FROM kanban_card WHERE parent_id = ?"
    if not include_archived:
        sql += " AND archived_at IS NULL"
    rows = conn.execute(sql + " ORDER BY id", (int(parent_id),)).fetchall()
    return [_card(conn, row["id"]) for row in rows]


def list_subtasks(parent_id, include_archived=False):
    conn = db.get_db()
    _card(conn, parent_id)  # 404 when the parent is gone
    return {"subtasks": list_for(conn, parent_id, include_archived)}


def create(parent_id, title, body=None, lane=None, docs=None):
    """Add a subtask; owner and opname come from the parent at this moment."""
    parent_id = int(parent_id)
    with kanban._WRITE_LOCK, db.get_db() as conn:
        parent = _card(conn, parent_id)
        if parent["parent_id"] is not None:
            raise KanbanError("that card is itself a subtask; subtasks do not nest")
        lane_id = kanban.require_lane(conn, lane)["id"] if lane else parent["lane_id"]
        stamp = kanban.now_iso()
        cur = conn.execute(
            "INSERT INTO kanban_card"
            " (title, owner, lane_id, position, created_at, updated_at, body, opname, parent_id)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                title,
                parent["owner"],
                lane_id,
                1 << 30,
                stamp,
                stamp,
                body or "",
                parent["opname"],
                parent_id,
            ),
        )
        subtask_id = cur.lastrowid
        from . import card_docs

        card_docs.set_refs(conn, subtask_id, docs or [])
        result = _card(conn, subtask_id)
    return result


def update(parent_id, subtask_id, changes):
    """Patch a subtask; only title, body, lane (status), docs and archived."""
    parent_id, subtask_id = int(parent_id), int(subtask_id)
    conn = db.get_db()
    row = _card(conn, subtask_id)
    if row["parent_id"] != parent_id:
        raise KanbanError("subtask not found under that card", 404)
    allowed = {
        key: value
        for key, value in changes.items()
        if key in ("title", "body", "status", "docs", "archived")
    }
    if not allowed:
        raise KanbanError("nothing to update: pass title, body, lane, docs or archived")
    # update_card takes the write lock itself; never call it while holding it.
    return kanban.update_card(subtask_id, allowed)


def delete(parent_id, subtask_id):
    parent_id, subtask_id = int(parent_id), int(subtask_id)
    conn = db.get_db()
    row = _card(conn, subtask_id)
    if row["parent_id"] != parent_id:
        raise KanbanError("subtask not found under that card", 404)
    return kanban.delete_card(subtask_id)  # takes the write lock itself
