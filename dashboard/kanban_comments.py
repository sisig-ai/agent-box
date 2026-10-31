"""Ops Board card comments: a timestamped, append-only thread per card.

Rows live in ``kanban_comment`` (same SQLite DB as the cards). ``created_at``
is ISO 8601 with the host offset (Asia/Manila on agent-box). Deleting a card
deletes its comments.
"""

from . import db
from .dates import now_iso
from .kanban import _WRITE_LOCK, card

COMMENT_SQL = "SELECT id, card_id, author, body, created_at FROM kanban_comment"


def init_schema(conn):
    """Create the comment table (idempotent; additive for older databases)."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kanban_comment (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id    INTEGER NOT NULL REFERENCES kanban_card(id) ON DELETE CASCADE,
            author     TEXT NOT NULL,
            body       TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS kanban_comment_card ON kanban_comment (card_id, id)")


def _touch(conn, card_id, stamp):
    """Bump the card's updated_at so board pollers notice comment activity."""
    conn.execute("UPDATE kanban_card SET updated_at = ? WHERE id = ?", (stamp, card_id))


def comments(conn, card_id):
    """A card's comments, oldest first (404 if the card is missing)."""
    card(conn, card_id)
    rows = conn.execute(COMMENT_SQL + " WHERE card_id = ? ORDER BY id", (card_id,)).fetchall()
    return [dict(r) for r in rows]


def add_comment(card_id, author, body):
    with _WRITE_LOCK, db.get_db() as conn:
        card(conn, card_id)
        cur = conn.execute(
            "INSERT INTO kanban_comment (card_id, author, body, created_at) VALUES (?, ?, ?, ?)",
            (card_id, author, body, stamp := now_iso()),
        )
        _touch(conn, card_id, stamp)
        return dict(conn.execute(COMMENT_SQL + " WHERE id = ?", (cur.lastrowid,)).fetchone())


def delete_comment(card_id, comment_id):
    from .kanban import KanbanError

    with _WRITE_LOCK, db.get_db() as conn:
        card(conn, card_id)
        row = conn.execute(
            COMMENT_SQL + " WHERE id = ? AND card_id = ?", (comment_id, card_id)
        ).fetchone()
        if row is None:
            raise KanbanError("comment not found", 404)
        conn.execute("DELETE FROM kanban_comment WHERE id = ?", (comment_id,))
        _touch(conn, card_id, now_iso())
        return dict(row)
