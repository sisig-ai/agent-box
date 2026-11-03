"""Docs embeddings: chunk each doc, embed through Ollama, score in Python.

Storage and scoring live here; the shared model and maths live in
``dashboard.embed``. Vectors sit in ``doc_embedding`` as float32 blobs.
"""

import json
import queue
import threading
import time

from . import config, db
from .dates import now_iso
from .embed import (
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

# Tests (and callers that want manual control) turn the background worker off:
# enqueue becomes a no-op and index_doc is called explicitly.
_AUTO_INDEX = True
_QUEUE = queue.Queue()
_WORKER = None
_WORKER_LOCK = threading.Lock()

# ---------------------------------------------------------------- storage


def init_schema(conn):
    """Create the vector table and the doc columns that track index state."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS doc_embedding (
            doc_id     INTEGER NOT NULL,
            chunk      INTEGER NOT NULL,
            model      TEXT NOT NULL,
            dim        INTEGER NOT NULL,
            vector     BLOB NOT NULL,
            text       TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (doc_id, chunk, model)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS doc_embedding_model ON doc_embedding (model)")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(doc)")}
    if "embed_hash" not in columns:
        conn.execute("ALTER TABLE doc ADD COLUMN embed_hash TEXT")
    if "embed_model" not in columns:
        conn.execute("ALTER TABLE doc ADD COLUMN embed_model TEXT")
    if "embed_at" not in columns:
        conn.execute("ALTER TABLE doc ADD COLUMN embed_at TEXT")


def drop(doc_id, conn=None):
    """Remove every stored vector for one doc (called on delete)."""
    own = conn is None
    conn = conn or db.connect()
    try:
        with conn:
            conn.execute("DELETE FROM doc_embedding WHERE doc_id = ?", (doc_id,))
    finally:
        if own:
            conn.close()


def index_doc(conn, doc_id, prefix=None, content=None, model=None):
    """Chunk and embed one doc, replacing its stored vectors. Returns chunk count."""
    model = model or config.EMBED_MODEL
    row = conn.execute("SELECT prefix, content FROM doc WHERE id = ?", (doc_id,)).fetchone()
    if row is None:
        return 0
    prefix = row["prefix"] if prefix is None else prefix
    content = row["content"] if content is None else content
    pieces = chunk(f"{prefix}\n\n{content}")
    if not pieces:
        with conn:
            conn.execute(
                "DELETE FROM doc_embedding WHERE doc_id = ? AND model = ?", (doc_id, model)
            )
            conn.execute(
                "UPDATE doc SET embed_hash = ?, embed_model = ?, embed_at = ? WHERE id = ?",
                (input_hash(content), model, now_iso(), doc_id),
            )
        return 0
    vectors = embed_texts([document_input(piece) for piece in pieces])
    stamp = now_iso()
    with conn:
        conn.execute("DELETE FROM doc_embedding WHERE doc_id = ? AND model = ?", (doc_id, model))
        conn.executemany(
            "INSERT INTO doc_embedding (doc_id, chunk, model, dim, vector, text, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (doc_id, index, model, len(vector), pack(vector), piece, stamp)
                for index, (piece, vector) in enumerate(zip(pieces, vectors, strict=True))
            ],
        )
        conn.execute(
            "UPDATE doc SET embed_hash = ?, embed_model = ?, embed_at = ? WHERE id = ?",
            (input_hash(content), model, stamp, doc_id),
        )
    return len(pieces)


def input_hash(content):
    """Hash of what the model actually sees, so a prefix change invalidates too."""
    return content_hash(document_input(content))


def should_index(content, embed_hash, embed_model, model=None):
    """True when new content (or a new model) makes the stored vectors stale."""
    model = model or config.EMBED_MODEL
    return embed_model != model or embed_hash != input_hash(content)


def needs_index(row, model=None):
    """True when a doc row is missing vectors, stale, or from another model."""
    return should_index(row["content"], row["embed_hash"], row["embed_model"], model)


def pending_count():
    conn = db.connect()
    try:
        rows = conn.execute("SELECT content, embed_hash, embed_model FROM doc").fetchall()
        return sum(1 for row in rows if needs_index(row))
    finally:
        conn.close()


def reindex_all(limit=None):
    """Queue every stale doc; returns how many were queued."""
    conn = db.connect()
    try:
        rows = conn.execute("SELECT id, content, embed_hash, embed_model FROM doc").fetchall()
        stale = [row["id"] for row in rows if needs_index(row)]
    finally:
        conn.close()
    if limit is not None:
        stale = stale[:limit]
    for doc_id in stale:
        enqueue(doc_id)
    return len(stale)


# ---------------------------------------------------------------- worker


def enqueue(doc_id):
    """Mark one doc for (re)indexing; the worker does the network call."""
    if not _AUTO_INDEX:
        return
    _start_worker()
    _QUEUE.put(int(doc_id))


def _start_worker():
    global _WORKER
    if _WORKER is not None and _WORKER.is_alive():
        return
    with _WORKER_LOCK:
        if _WORKER is not None and _WORKER.is_alive():
            return
        _WORKER = threading.Thread(target=_work, name="docs-embed", daemon=True)
        _WORKER.start()


def _work():
    while True:
        doc_id = _QUEUE.get()
        conn = db.connect()
        try:
            index_doc(conn, doc_id)
        except EmbedError:
            # Ollama down or model missing: leave embed_hash NULL so a later
            # reindex or edit retries. Writes must never fail because of this.
            pass
        except Exception:  # noqa: BLE001 - the worker must survive any doc
            pass
        finally:
            conn.close()
            _QUEUE.task_done()


def wait_idle(timeout=30):
    """Block until the queue drains (tests and reindex reports)."""
    deadline = time.time() + timeout
    while not _QUEUE.empty() and time.time() < deadline:
        time.sleep(0.02)
    time.sleep(0.05)


# ---------------------------------------------------------------- search


def search(query, prefix=None, prefix_q=None, limit=50, sort="blend", conn=None):
    """Cosine-rank chunks of the active model; best chunk per doc wins."""
    query = (query or "").strip()
    if not query:
        raise EmbedError("q is required")
    started = time.time()
    vector = embed_texts([query_input(query)])[0]
    own = conn is None
    conn = conn or db.connect()
    try:
        clauses, args = ["e.model = ?"], [config.EMBED_MODEL]
        if prefix:
            clauses.append("(d.prefix = ? OR d.prefix LIKE ? ESCAPE '\\')")
            escaped = prefix.replace("%", chr(92) + "%").replace("_", chr(92) + "_")
            args.extend([prefix, f"{escaped}/%"])
        if prefix_q:
            escaped = prefix_q.replace("%", chr(92) + "%").replace("_", chr(92) + "_")
            clauses.append("d.prefix LIKE ? ESCAPE '\\'")
            args.append(f"%{escaped}%")
        rows = conn.execute(
            "SELECT e.doc_id, e.vector, e.text, d.prefix, d.author, d.tags, d.updated_at,"
            " length(d.content) AS size"
            " FROM doc_embedding e JOIN doc d ON d.id = e.doc_id"
            " WHERE " + " AND ".join(clauses),
            args,
        ).fetchall()
        indexed = conn.execute(
            "SELECT count(DISTINCT doc_id) FROM doc_embedding WHERE model = ?",
            (config.EMBED_MODEL,),
        ).fetchone()[0]
        total = conn.execute("SELECT count(*) FROM doc").fetchone()[0]
    finally:
        if own:
            conn.close()

    best = {}
    for row in rows:
        score = cosine(vector, unpack(row["vector"]))
        current = best.get(row["doc_id"])
        if current is None or score > current["score"]:
            excerpt = " ".join((row["text"] or "").split())[:EXCERPT_CHARS]
            best[row["doc_id"]] = {
                "id": row["doc_id"],
                "prefix": row["prefix"],
                "author": row["author"],
                "tags": json.loads(row["tags"] or "[]"),
                "updated_at": row["updated_at"],
                "size": row["size"],
                "score": round(score, 4),
                "excerpt": excerpt,
            }
    ranked = order_hits(list(best.values()), sort)
    hits = ranked[: max(1, min(limit, 200))]
    return {
        "q": query,
        "model": config.EMBED_MODEL,
        "hits": hits,
        "count": len(hits),
        "indexed": indexed,
        "total": total,
        "pending": max(0, total - indexed),
        "took_ms": int((time.time() - started) * 1000),
    }
