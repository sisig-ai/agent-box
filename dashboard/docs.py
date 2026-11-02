"""Docs: an S3-ish store of long-form text keyed by prefix (path).

A doc is one row in ``doc``: a slash-separated prefix that acts as the object
key, arbitrary text content, a free-text author, JSON tags, and created/updated
timestamps. Writes bump ``revision`` so agents can tell a rewrite from a read.

``doc_fts`` is a plain FTS5 index over prefix, content, tags and author, kept in
step by triggers; ``init_schema`` rebuilds it when the row counts drift. Search
reuses the Ops Board query parser (quoted terms, prefix match, ``-word`` to
exclude, ``"two words"`` for a phrase) so both surfaces behave the same.
"""

import json
import threading

from . import db, docs_embed
from .dates import now_iso
from .docs_keys import (
    DEFAULT_LIMIT,
    DocsError,
    clean_author,
    clean_content,
    clean_limit,
    clean_prefix,
    clean_prefix_query,
    clean_tags,
    prefix_filters,
)
from .kanban_search import MARK_CLOSE, MARK_OPEN, match_expr

_WRITE_LOCK = threading.Lock()

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS doc (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        prefix     TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        author     TEXT,
        tags       TEXT NOT NULL DEFAULT '[]',
        revision   INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS doc_prefix ON doc (prefix)",
    "CREATE INDEX IF NOT EXISTS doc_updated ON doc (updated_at DESC, id DESC)",
)

_FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(
    doc_id UNINDEXED,
    prefix,
    content,
    tags,
    author,
    tokenize = 'unicode61 remove_diacritics 2'
)
"""

_TRIGGERS = (
    """
    CREATE TRIGGER IF NOT EXISTS doc_fts_ai AFTER INSERT ON doc BEGIN
        INSERT INTO doc_fts (doc_id, prefix, content, tags, author)
        VALUES (new.id, new.prefix, new.content, new.tags, coalesce(new.author, ''));
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS doc_fts_au
    AFTER UPDATE OF prefix, content, tags, author ON doc BEGIN
        DELETE FROM doc_fts WHERE doc_id = new.id;
        INSERT INTO doc_fts (doc_id, prefix, content, tags, author)
        VALUES (new.id, new.prefix, new.content, new.tags, coalesce(new.author, ''));
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS doc_fts_ad AFTER DELETE ON doc BEGIN
        DELETE FROM doc_fts WHERE doc_id = old.id;
    END
    """,
)


def init_schema(conn):
    for statement in _SCHEMA:
        conn.execute(statement)
    conn.execute(_FTS)
    for statement in _TRIGGERS:
        conn.execute(statement)
    indexed = conn.execute("SELECT count(*) FROM doc_fts").fetchone()[0]
    expected = conn.execute("SELECT count(*) FROM doc").fetchone()[0]
    if indexed != expected:
        rebuild(conn)


def rebuild(conn):
    conn.execute("DELETE FROM doc_fts")
    conn.execute(
        "INSERT INTO doc_fts (doc_id, prefix, content, tags, author)"
        " SELECT id, prefix, content, tags, coalesce(author, '') FROM doc"
    )


# ---------------------------------------------------------------- serialising


def _row(row, with_content=True):
    doc = {
        "id": row["id"],
        "prefix": row["prefix"],
        "author": row["author"],
        "tags": json.loads(row["tags"] or "[]"),
        "revision": row["revision"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "size": len(row["content"] or ""),
    }
    if with_content:
        doc["content"] = row["content"]
    return doc


# ---------------------------------------------------------------- operations


def fetch(prefix):
    prefix = clean_prefix(prefix)
    conn = db.get_db()
    row = conn.execute("SELECT * FROM doc WHERE prefix = ?", (prefix,)).fetchone()
    return _row(row) if row else None


def put(prefix, content=None, author=None, tags=None, create_only=False):
    """Create or replace one doc by prefix. Returns (doc, created)."""
    prefix = clean_prefix(prefix)
    content = clean_content(content)
    author = clean_author(author)
    tags = clean_tags(tags)
    stamp = now_iso()
    with _WRITE_LOCK:
        conn = db.get_db()
        existing = conn.execute("SELECT * FROM doc WHERE prefix = ?", (prefix,)).fetchone()
        if existing is None:
            with conn:
                cursor = conn.execute(
                    "INSERT INTO doc"
                    " (prefix, content, author, tags, revision, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, 1, ?, ?)",
                    (prefix, content, author, json.dumps(tags), stamp, stamp),
                )
            doc_id = cursor.lastrowid
            created = True
        else:
            if create_only:
                raise DocsError(f"doc already exists at prefix {prefix}", 409)
            doc_id = existing["id"]
            with conn:
                conn.execute(
                    "UPDATE doc SET content = ?, author = ?, tags = ?,"
                    " revision = revision + 1, updated_at = ? WHERE id = ?",
                    (content, author, json.dumps(tags), stamp, doc_id),
                )
            created = False
        row = conn.execute("SELECT * FROM doc WHERE id = ?", (doc_id,)).fetchone()
    if created or docs_embed.should_index(content, row["embed_hash"], row["embed_model"]):
        docs_embed.enqueue(doc_id)
    return _row(row), created


def patch(prefix, changes):
    """Update only the given fields; missing keys keep their current value."""
    prefix = clean_prefix(prefix)
    current = fetch(prefix)
    if current is None:
        raise DocsError(f"no doc at prefix {prefix}", 404)
    content = changes.get("content", current["content"])
    author = changes.get("author", current["author"])
    tags = changes.get("tags", current["tags"])
    doc, _created = put(prefix, content, author, tags)
    return doc


def delete(prefix):
    prefix = clean_prefix(prefix)
    with _WRITE_LOCK:
        conn = db.get_db()
        row = conn.execute("SELECT id FROM doc WHERE prefix = ?", (prefix,)).fetchone()
        if row is None:
            raise DocsError(f"no doc at prefix {prefix}", 404)
        with conn:
            conn.execute("DELETE FROM doc WHERE id = ?", (row["id"],))
        docs_embed.drop(row["id"], conn)
    return prefix


def listing(prefix=None, limit=DEFAULT_LIMIT, offset=0, with_content=False):
    """Metadata for every doc, newest update first; ``prefix`` is a path filter."""
    conn = db.get_db()
    clauses, args = [], []
    if prefix:
        clean = clean_prefix(prefix)
        clauses.append("(prefix = ? OR prefix LIKE ? ESCAPE '\\')")
        args.extend([clean, f"{clean.replace('%', chr(92) + '%').replace('_', chr(92) + '_')}/%"])
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        "SELECT * FROM doc" + where + " ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
        (*args, limit, max(0, offset)),
    ).fetchall()
    total = conn.execute("SELECT count(*) FROM doc" + where, args).fetchone()[0]
    return {
        "docs": [_row(row, with_content) for row in rows],
        "count": len(rows),
        "total": total,
        "limit": limit,
        "offset": max(0, offset),
    }


def prefixes():
    """Every directory that holds docs, with a direct and a recursive count."""
    conn = db.get_db()
    rows = conn.execute("SELECT prefix FROM doc").fetchall()
    direct, nested = {}, {}
    for row in rows:
        parts = row["prefix"].split("/")[:-1]
        for index in range(1, len(parts) + 1):
            path = "/".join(parts[:index])
            nested[path] = nested.get(path, 0) + 1
        if parts:
            parent = "/".join(parts)
            direct[parent] = direct.get(parent, 0) + 1
    return [
        {"prefix": path, "direct": direct.get(path, 0), "total": nested.get(path, 0)}
        for path in sorted(nested)
    ]


def tree(per_folder=5, include_content=False):
    """One compact tree for the explorer: folders, counts, and the first N docs.

    Sending the whole corpus so the browser can build the tree does not scale,
    so the server does the grouping here: every folder reports its recursive
    count and at most ``per_folder`` docs (sorted by name), plus how many more
    it holds. The page then lazily fetches a folder's remainder only when the
    reader asks for it. Content is never included unless asked.
    """
    per_folder = max(1, min(int(per_folder or 5), 100))
    conn = db.get_db()
    rows = conn.execute(
        "SELECT id, prefix, author, tags, updated_at, length(content) AS size FROM doc"
    ).fetchall()

    folders = {}  # path -> {"docs": [...], "children": set()}
    root_docs = []

    def folder(path):
        if path not in folders:
            folders[path] = {"docs": [], "children": set()}
        return folders[path]

    for row in rows:
        parts = row["prefix"].split("/")
        name = parts[-1]
        parents = parts[:-1]
        entry = {
            "prefix": row["prefix"],
            "name": name,
            "author": row["author"],
            "tags": json.loads(row["tags"] or "[]"),
            "updated_at": row["updated_at"],
            "size": row["size"],
        }
        if not parents:
            root_docs.append(entry)
            continue
        for index in range(1, len(parents) + 1):
            child = "/".join(parents[:index])
            folder(child)
            if index > 1:  # the empty string is the root, not a folder
                folder("/".join(parents[: index - 1]))["children"].add(child)
        folder("/".join(parents))["docs"].append(entry)

    def count(path):
        node = folders.get(path) or {"docs": [], "children": set()}
        return len(node["docs"]) + sum(count(child) for child in node["children"])

    def build(path):
        node = folders.get(path) or {"docs": [], "children": set()}
        docs = sorted(node["docs"], key=lambda d: d["name"].lower())
        return {
            "path": path,
            "name": path.rsplit("/", 1)[-1],
            "total": count(path),
            "docs": docs[:per_folder],
            "more": max(0, len(docs) - per_folder),
            "folders": [build(child) for child in sorted(node["children"], key=str.lower)],
        }

    tops = sorted({path.split("/")[0] for path in folders}, key=str.lower)
    roots = sorted(root_docs, key=lambda d: d["name"].lower())
    return {
        "folders": [build(path) for path in tops],
        "docs": roots[:per_folder],
        "more": max(0, len(roots) - per_folder),
        "per_folder": per_folder,
        "total": len(rows),
    }


def tags():
    """Every tag in use, most frequent first."""
    conn = db.get_db()
    counts = {}
    for row in conn.execute("SELECT tags FROM doc"):
        for tag in json.loads(row["tags"] or "[]"):
            counts[tag] = counts.get(tag, 0) + 1
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    return [{"tag": tag, "count": n} for tag, n in ordered]


_SELECT = (
    "SELECT d.id, d.prefix, d.author, d.tags, d.revision, d.created_at, d.updated_at,"
    " length(d.content) AS size, bm25(doc_fts, 0.0, 8.0, 1.0, 4.0, 3.0) AS rank,"
    f" snippet(doc_fts, 2, '{MARK_OPEN}', '{MARK_CLOSE}', '…', 18) AS content_snip,"
    f" snippet(doc_fts, 1, '{MARK_OPEN}', '{MARK_CLOSE}', '…', 8) AS prefix_snip"
    " FROM doc_fts JOIN doc d ON d.id = doc_fts.doc_id"
)


def search(query, prefix=None, prefix_q=None, limit=DEFAULT_LIMIT):
    """Full-text search over prefix, content, tags and author.

    ``prefix`` scopes to a path and its descendants, ``prefix_q`` matches a
    substring of the prefix. With ``q`` empty and ``prefix_q`` set the result is
    a plain prefix listing, newest update first, so agents can browse a naming
    convention without inventing a keyword.
    """
    prefix_q = clean_prefix_query(prefix_q)
    expr = match_expr((query or "").strip())
    if expr is None and not prefix_q:
        raise DocsError("q needs at least one searchable word (or pass prefix_q)")
    limit = clean_limit(limit)
    clauses, args = [], []
    if expr is not None:
        clauses.append("doc_fts MATCH ?")
        args.append(expr)
    path_clauses, path_args = prefix_filters(prefix, prefix_q)
    clauses.extend(path_clauses)
    args.extend(path_args)
    where = " WHERE " + " AND ".join(clauses)
    conn = db.get_db()
    if expr is None:
        # Prefix-only search: no rank to order by, so list the newest first.
        rows = conn.execute(
            "SELECT d.id, d.prefix, d.author, d.tags, d.revision, d.created_at, d.updated_at,"
            " length(d.content) AS size, d.prefix AS prefix_snip, '' AS content_snip"
            " FROM doc d" + where + " ORDER BY d.updated_at DESC, d.id DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
        total = conn.execute("SELECT count(*) FROM doc d" + where, args).fetchone()[0]
    else:
        rows = conn.execute(_SELECT + where + " ORDER BY rank LIMIT ?", (*args, limit)).fetchall()
        total = conn.execute(
            "SELECT count(*) FROM doc_fts JOIN doc d ON d.id = doc_fts.doc_id" + where, args
        ).fetchone()[0]
    hits = []
    for row in rows:
        hits.append(
            {
                "id": row["id"],
                "prefix": row["prefix"],
                "author": row["author"],
                "tags": json.loads(row["tags"] or "[]"),
                "revision": row["revision"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "size": row["size"],
                "prefix_snip": row["prefix_snip"],
                "snippet": row["content_snip"],
            }
        )
    return {"q": query, "hits": hits, "count": len(hits), "total": total}
