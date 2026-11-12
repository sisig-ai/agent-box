"""Vector search over Ops Board cards.

Same model and maths as Docs (``dashboard.embed``), different parent: chunks of
``title + body + opname + owner`` per card, stored in ``kanban_embedding`` and
scored against the query. Indexing runs on a background worker after each card
write, so a save never waits on Ollama; a failed embed leaves ``embed_hash``
NULL and the next write or reindex retries.

Comments are not embedded: they are the running log, and the board's own FTS
already reaches them.
"""

import queue
import threading

from . import config, db
from .dates import now_iso
from .embed import (
    DEFAULT_MIN_SCORE,
    EXCERPT_CHARS,
    EmbedError,
    chunk,
    content_hash,
    cosine,
    document_input,
    embed_texts,
    order_hits,
    pack,
    query_input,
    unpack,
)

_AUTO_INDEX = True
_QUEUE = queue.Queue()
_WORKER = None
_WORKER_LOCK = threading.Lock()


def init_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kanban_embedding (
            card_id    INTEGER NOT NULL,
            chunk      INTEGER NOT NULL,
            model      TEXT NOT NULL,
            dim        INTEGER NOT NULL,
            vector     BLOB NOT NULL,
            text       TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (card_id, chunk, model)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS kanban_embedding_model ON kanban_embedding (model)")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(kanban_card)")}
    if "embed_hash" not in columns:
        conn.execute("ALTER TABLE kanban_card ADD COLUMN embed_hash TEXT")
    if "embed_model" not in columns:
        conn.execute("ALTER TABLE kanban_card ADD COLUMN embed_model TEXT")
    if "embed_at" not in columns:
        conn.execute("ALTER TABLE kanban_card ADD COLUMN embed_at TEXT")


def card_text(title, body, opname, owner):
    """The text a card contributes to the index, in a stable order."""
    parts = [title or "", body or ""]
    meta = " ".join(part for part in (opname, f"@{owner}" if owner else "") if part)
    if meta:
        parts.append(meta)
    return "\n\n".join(part for part in parts if part.strip())


def drop(card_id, conn=None):
    own = conn is None
    conn = conn or db.connect()
    try:
        with conn:
            conn.execute("DELETE FROM kanban_embedding WHERE card_id = ?", (card_id,))
    finally:
        if own:
            conn.close()


def index_card(conn, card_id, model=None):
    """Chunk and embed one card, replacing its stored vectors."""
    model = model or config.EMBED_MODEL
    row = conn.execute(
        "SELECT title, body, opname, owner FROM kanban_card WHERE id = ?", (card_id,)
    ).fetchone()
    if row is None:
        return 0
    text = card_text(row["title"], row["body"], row["opname"], row["owner"])
    pieces = chunk(text)
    stamp = now_iso()
    if not pieces:
        with conn:
            conn.execute(
                "DELETE FROM kanban_embedding WHERE card_id = ? AND model = ?", (card_id, model)
            )
            conn.execute(
                "UPDATE kanban_card SET embed_hash = ?, embed_model = ?, embed_at = ? WHERE id = ?",
                (input_hash(text), model, stamp, card_id),
            )
        return 0
    vectors = embed_texts([document_input(piece) for piece in pieces])
    with conn:
        conn.execute(
            "DELETE FROM kanban_embedding WHERE card_id = ? AND model = ?", (card_id, model)
        )
        conn.executemany(
            "INSERT INTO kanban_embedding (card_id, chunk, model, dim, vector, text, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (card_id, index, model, len(vector), pack(vector), piece, stamp)
                for index, (piece, vector) in enumerate(zip(pieces, vectors, strict=True))
            ],
        )
        conn.execute(
            "UPDATE kanban_card SET embed_hash = ?, embed_model = ?, embed_at = ? WHERE id = ?",
            (input_hash(text), model, stamp, card_id),
        )
    return len(pieces)


def input_hash(text):
    """Hash of what the model actually sees, so a prefix change invalidates too."""
    return content_hash(document_input(text))


def needs_index(row, model=None):
    model = model or config.EMBED_MODEL
    text = card_text(row["title"], row["body"], row["opname"], row["owner"])
    return row["embed_model"] != model or row["embed_hash"] != input_hash(text)


def pending_count():
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT title, body, opname, owner, embed_hash, embed_model FROM kanban_card"
            " WHERE parent_id IS NULL"
        )
        return sum(1 for row in rows if needs_index(row))
    finally:
        conn.close()


def reindex_all(limit=None):
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT id, title, body, opname, owner, embed_hash, embed_model FROM kanban_card"
            " WHERE parent_id IS NULL"
        ).fetchall()
        stale = [row["id"] for row in rows if needs_index(row)]
    finally:
        conn.close()
    if limit is not None:
        stale = stale[:limit]
    for card_id in stale:
        enqueue(card_id)
    return len(stale)


def enqueue(card_id):
    if not _AUTO_INDEX:
        return
    _start_worker()
    _QUEUE.put(int(card_id))


def _start_worker():
    global _WORKER
    if _WORKER is not None and _WORKER.is_alive():
        return
    with _WORKER_LOCK:
        if _WORKER is not None and _WORKER.is_alive():
            return
        _WORKER = threading.Thread(target=_work, name="cards-embed", daemon=True)
        _WORKER.start()


def _work():
    while True:
        card_id = _QUEUE.get()
        conn = db.connect()
        try:
            index_card(conn, card_id)
        except EmbedError:
            pass  # Ollama down: the next write or reindex retries
        except Exception:  # noqa: BLE001 - the worker must survive any card
            pass
        finally:
            conn.close()
            _QUEUE.task_done()


def search(
    query,
    limit=15,
    archived="exclude",
    lane_id=None,
    owner=None,
    opname=None,
    sort="blend",
    conn=None,
    min_score=None,
    recency_weight=None,
    recency_tau_days=None,
):
    """Cosine-rank card chunks; best chunk per card wins."""
    query = (query or "").strip()
    if not query:
        raise EmbedError("q is required")
    vector = embed_texts([query_input(query)])[0]
    own = conn is None
    conn = conn or db.connect()
    try:
        clauses, args = ["e.model = ?", "c.parent_id IS NULL"], [config.EMBED_MODEL]
        if archived == "exclude":
            clauses.append("c.archived_at IS NULL")
        elif archived == "only":
            clauses.append("c.archived_at IS NOT NULL")
        if not any(clause.startswith("c.parent_id") for clause in clauses):
            clauses.append("c.parent_id IS NULL")
        if lane_id is not None:
            clauses.append("c.lane_id = ?")
            args.append(lane_id)
        if owner:
            clauses.append("c.owner = ? COLLATE NOCASE")
            args.append(owner)
        if opname:
            clauses.append("c.opname = ? COLLATE NOCASE")
            args.append(opname)
        rows = conn.execute(
            "SELECT e.card_id, e.vector, e.text, c.title, c.owner, c.opname, c.lane_id,"
            " c.archived_at, c.updated_at, l.name AS lane"
            " FROM kanban_embedding e"
            " JOIN kanban_card c ON c.id = e.card_id"
            " JOIN kanban_lane l ON l.id = c.lane_id"
            " WHERE " + " AND ".join(clauses),
            args,
        ).fetchall()
        indexed = conn.execute(
            "SELECT count(DISTINCT card_id) FROM kanban_embedding WHERE model = ?",
            (config.EMBED_MODEL,),
        ).fetchone()[0]
        total = conn.execute("SELECT count(*) FROM kanban_card").fetchone()[0]
    finally:
        if own:
            conn.close()

    threshold = DEFAULT_MIN_SCORE if min_score is None else float(min_score)
    best = {}
    for row in rows:
        score = cosine(vector, unpack(row["vector"]))
        if score < threshold:
            continue
        current = best.get(row["card_id"])
        if current is None or score > current["score"]:
            best[row["card_id"]] = {
                "id": row["card_id"],
                "title": row["title"],
                "lane": row["lane"],
                "lane_id": row["lane_id"],
                "owner": row["owner"],
                "opname": row["opname"],
                "archived_at": row["archived_at"],
                "updated_at": row["updated_at"],
                "score": round(score, 4),
                "excerpt": " ".join((row["text"] or "").split())[:EXCERPT_CHARS],
            }
    ranked = order_hits(
        list(best.values()),
        sort,
        recency_weight=recency_weight,
        recency_tau_days=recency_tau_days,
    )
    hits = ranked[: max(1, min(int(limit or 15), 200))]
    return {
        "q": query,
        "model": config.EMBED_MODEL,
        "hits": hits,
        "count": len(hits),
        "indexed": indexed,
        "total": total,
        "pending": max(0, total - indexed),
    }
