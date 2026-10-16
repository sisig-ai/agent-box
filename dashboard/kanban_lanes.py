"""Kanban lane writes: create, rename/reorder, delete (with card hand-off)."""

from . import db
from .dates import now_iso
from .kanban import (
    _WRITE_LOCK,
    KanbanError,
    _lane_card_ids,
    _place,
    _write_order,
    find_lane,
    lanes,
    require_lane,
)

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
    """Delete a lane. Cards (visible or archived) block it unless ``force`` deletes
    them or ``target`` receives them (visible cards go to the bottom)."""
    with _WRITE_LOCK, db.get_db() as conn:
        lane = find_lane(conn, ref)
        if lane is None:
            raise KanbanError("lane not found", 404)
        ids = _lane_card_ids(conn, lane["id"])
        archived = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM kanban_card WHERE lane_id = ? AND archived_at IS NOT NULL",
                (lane["id"],),
            ).fetchall()
        ]
        moved_to = None
        if (ids or archived) and target is not None:
            dest = require_lane(conn, target, label="target lane")
            if dest["id"] == lane["id"]:
                raise KanbanError("target lane must differ from the lane being deleted", 400)
            _write_order(conn, dest["id"], _lane_card_ids(conn, dest["id"]) + ids)
            conn.execute(
                "UPDATE kanban_card SET lane_id = ? WHERE lane_id = ?", (dest["id"], lane["id"])
            )
            moved_to = dest["name"]
        elif (ids or archived) and force:
            conn.execute("DELETE FROM kanban_card WHERE lane_id = ?", (lane["id"],))
        elif ids or archived:
            raise KanbanError(
                f"lane {lane['name']!r} has {len(ids)} card(s) and {len(archived)} archived"
                " card(s); pass ?target=<lane> to move them or ?force=1 to delete them",
                409,
            )
        conn.execute("DELETE FROM kanban_lane WHERE id = ?", (lane["id"],))
        _reorder_lanes_compact(conn)
        return {
            "deleted": lane["name"],
            "id": lane["id"],
            "cards": len(ids),
            "archived_cards": len(archived),
            "moved_to": moved_to,
        }


def _reorder_lanes_compact(conn):
    rows = conn.execute("SELECT id FROM kanban_lane ORDER BY position, id").fetchall()
    conn.executemany(
        "UPDATE kanban_lane SET position = ? WHERE id = ?",
        [(i, r["id"]) for i, r in enumerate(rows)],
    )
