"""Many-to-many binding between Ops Board cards and Docs.

A card can point at any number of docs, and a doc can be referenced by any number
of cards, so the relation lives in its own table rather than in a JSON column on
the card: ``card_doc(card_id, prefix)`` with both directions indexed. The card
payload still exposes ``docs: [...]`` and a doc exposes ``cards: [...]``.

Deleting either side removes the binding: a card delete drops its rows, a doc
delete drops rows that point at it.
"""

from .dates import now_iso


def init_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS card_doc (
            card_id    INTEGER NOT NULL,
            prefix     TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (card_id, prefix)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS card_doc_prefix ON card_doc (prefix)")
    _migrate_legacy(conn)


def _migrate_legacy(conn):
    """Copy any card.doc_refs JSON into the binding table, once."""
    columns = {row[1] for row in conn.execute("PRAGMA table_info(kanban_card)")}
    if "doc_refs" not in columns:
        return
    rows = conn.execute(
        "SELECT id, doc_refs FROM kanban_card WHERE doc_refs IS NOT NULL AND doc_refs != '[]'"
    ).fetchall()
    if not rows:
        return
    import json

    stamp = now_iso()
    for row in rows:
        try:
            refs = json.loads(row["doc_refs"])
        except (TypeError, ValueError):
            continue
        for prefix in refs if isinstance(refs, list) else []:
            if isinstance(prefix, str) and prefix:
                conn.execute(
                    "INSERT OR IGNORE INTO card_doc (card_id, prefix, created_at) VALUES (?, ?, ?)",
                    (row["id"], prefix, stamp),
                )
    # The column stays for old readers, but the table is the source of truth.
    conn.execute("UPDATE kanban_card SET doc_refs = '[]'")


def set_refs(conn, card_id, prefixes):
    """Replace a card's bindings. Caller owns the transaction."""
    conn.execute("DELETE FROM card_doc WHERE card_id = ?", (card_id,))
    stamp = now_iso()
    conn.executemany(
        "INSERT OR IGNORE INTO card_doc (card_id, prefix, created_at) VALUES (?, ?, ?)",
        [(card_id, prefix, stamp) for prefix in prefixes or []],
    )


def refs_for(conn, card_ids):
    """Map card id -> [prefix] for the given cards (one query)."""
    ids = list(card_ids)
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT card_id, prefix FROM card_doc WHERE card_id IN ({marks}) ORDER BY prefix",
        ids,
    ).fetchall()
    out = {}
    for row in rows:
        out.setdefault(row["card_id"], []).append(row["prefix"])
    return out


def cards_for(conn, prefix):
    """Card ids that reference one doc prefix, newest card first."""
    rows = conn.execute(
        "SELECT c.id, c.title, l.name AS status, c.updated_at"
        " FROM card_doc d JOIN kanban_card c ON c.id = d.card_id"
        " JOIN kanban_lane l ON l.id = c.lane_id"
        " WHERE d.prefix = ? ORDER BY c.updated_at DESC, c.id DESC",
        (prefix,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "status": row["status"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def counts_for(conn, prefixes):
    """Map doc prefix -> number of cards, for a listing badge."""
    values = [prefix for prefix in prefixes if prefix]
    if not values:
        return {}
    marks = ",".join("?" for _ in values)
    rows = conn.execute(
        f"SELECT prefix, count(*) AS n FROM card_doc WHERE prefix IN ({marks}) GROUP BY prefix",
        values,
    ).fetchall()
    return {row["prefix"]: row["n"] for row in rows}


def forget_card(conn, card_id):
    conn.execute("DELETE FROM card_doc WHERE card_id = ?", (card_id,))


def forget_prefix(conn, prefix):
    conn.execute("DELETE FROM card_doc WHERE prefix = ?", (prefix,))
