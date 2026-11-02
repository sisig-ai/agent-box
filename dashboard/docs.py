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
import re
import threading

from . import db
from .dates import now_iso
from .kanban_search import MARK_CLOSE, MARK_OPEN, match_expr

PREFIX_MAX = 400
CONTENT_MAX = 2_000_000
AUTHOR_MAX = 120
TAG_MAX = 60
TAGS_MAX = 24
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
_SEGMENT_BAD = re.compile(r"[\x00-\x1f\x7f]")
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


class DocsError(Exception):
    """A request the store refuses; ``status`` is the HTTP code to return."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


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


# ---------------------------------------------------------------- validation


def clean_prefix(raw):
    """Normalise a doc key: no leading/trailing slash, no empty or dot segments."""
    if not isinstance(raw, str):
        raise DocsError("prefix must be a string")
    prefix = raw.strip().strip("/")
    if not prefix:
        raise DocsError("prefix is required")
    if len(prefix) > PREFIX_MAX:
        raise DocsError(f"prefix must be {PREFIX_MAX} characters or fewer")
    for segment in prefix.split("/"):
        if segment in ("", ".", ".."):
            raise DocsError("prefix segments must be non-empty and not '.' or '..'")
        if _SEGMENT_BAD.search(segment):
            raise DocsError("prefix must not contain control characters")
    return prefix


def clean_content(raw):
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise DocsError("content must be a string")
    if len(raw) > CONTENT_MAX:
        raise DocsError(f"content must be {CONTENT_MAX} characters or fewer")
    return raw


def clean_author(raw):
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise DocsError("author must be a string")
    author = raw.strip()
    if len(author) > AUTHOR_MAX:
        raise DocsError(f"author must be {AUTHOR_MAX} characters or fewer")
    return author or None


def clean_tags(raw):
    """Accept a list, or a comma/space separated string; keep order, drop dupes."""
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [part for part in re.split(r"[,\n]", raw)]
    if not isinstance(raw, list):
        raise DocsError("tags must be a list of strings")
    tags, seen = [], set()
    for item in raw:
        if not isinstance(item, str):
            raise DocsError("tags must be strings")
        tag = item.strip()
        if not tag:
            continue
        if len(tag) > TAG_MAX:
            raise DocsError(f"each tag must be {TAG_MAX} characters or fewer")
        if tag.lower() in seen:
            continue
        seen.add(tag.lower())
        tags.append(tag)
    if len(tags) > TAGS_MAX:
        raise DocsError(f"at most {TAGS_MAX} tags")
    return tags


def clean_limit(raw, default=DEFAULT_LIMIT, maximum=MAX_LIMIT):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(1, min(value, maximum))


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
            row = conn.execute("SELECT * FROM doc WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return _row(row), True
        if create_only:
            raise DocsError(f"doc already exists at prefix {prefix}", 409)
        with conn:
            conn.execute(
                "UPDATE doc SET content = ?, author = ?, tags = ?, revision = revision + 1,"
                " updated_at = ? WHERE id = ?",
                (content, author, json.dumps(tags), stamp, existing["id"]),
            )
        row = conn.execute("SELECT * FROM doc WHERE id = ?", (existing["id"],)).fetchone()
        return _row(row), False


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


def search(query, prefix=None, limit=DEFAULT_LIMIT):
    """Full-text search over prefix, content, tags and author."""
    expr = match_expr((query or "").strip())
    if expr is None:
        raise DocsError("q needs at least one searchable word")
    limit = clean_limit(limit)
    clauses, args = ["doc_fts MATCH ?"], []
    if prefix:
        clean = clean_prefix(prefix)
        clauses.append("(d.prefix = ? OR d.prefix LIKE ? ESCAPE '\\')")
        args.extend([clean, f"{clean.replace('%', chr(92) + '%').replace('_', chr(92) + '_')}/%"])
    where = " WHERE " + " AND ".join(clauses)
    conn = db.get_db()
    rows = conn.execute(_SELECT + where + " ORDER BY rank LIMIT ?", (expr, *args, limit)).fetchall()
    total = conn.execute(
        "SELECT count(*) FROM doc_fts JOIN doc d ON d.id = doc_fts.doc_id" + where, (expr, *args)
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
