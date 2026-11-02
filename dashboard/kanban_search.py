"""Full-text search over Ops Board cards (SQLite FTS5).

``kanban_fts`` holds one document per card (``comment_id = 0``: title, body,
opname + owner in ``tags``) and one per comment (empty title, body, author in
``tags``), so one query covers everything a card carries. Triggers on
``kanban_card`` and ``kanban_comment`` keep the index in step with every write
— API, MCP, or direct SQL. At this board size a rebuild is cheap, so
``init_schema`` simply rebuilds when the row count drifts (old database, or a
write that bypassed the triggers).

Matching is word/prefix based and safe for arbitrary input: every term is
quoted, so FTS5 operators in the query are literals; each term gets a ``*``
prefix. ``-word`` excludes, ``"two words"`` is an exact phrase. Highlights in
the returned strings are wrapped in ``MARK_OPEN`` / ``MARK_CLOSE``.
"""

import re

from .kanban import KanbanError

MARK_OPEN, MARK_CLOSE = "\x01", "\x02"
MAX_QUERY = 200
MAX_TERMS = 16
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
_MATCH_ORDER = ("title", "body", "comment", "meta")

_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS kanban_fts USING fts5(
    card_id UNINDEXED,
    comment_id UNINDEXED,
    title,
    body,
    tags,
    tokenize = 'unicode61 remove_diacritics 2'
)
"""

_TAGS = "trim(coalesce({t}.opname, '') || ' ' || coalesce({t}.owner, ''))"

_TRIGGERS = (
    # One card row (comment_id 0). UPDATE replaces it in place.
    f"""
    CREATE TRIGGER IF NOT EXISTS kanban_fts_card_ai AFTER INSERT ON kanban_card BEGIN
        INSERT INTO kanban_fts (card_id, comment_id, title, body, tags)
        VALUES (new.id, 0, new.title, new.body, {_TAGS.format(t="new")});
    END
    """,
    f"""
    CREATE TRIGGER IF NOT EXISTS kanban_fts_card_au AFTER UPDATE OF title, body, opname, owner
    ON kanban_card BEGIN
        DELETE FROM kanban_fts WHERE card_id = new.id AND comment_id = 0;
        INSERT INTO kanban_fts (card_id, comment_id, title, body, tags)
        VALUES (new.id, 0, new.title, new.body, {_TAGS.format(t="new")});
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS kanban_fts_card_ad AFTER DELETE ON kanban_card BEGIN
        DELETE FROM kanban_fts WHERE card_id = old.id;
    END
    """,
    # Comments are immutable, so insert/delete is enough.
    """
    CREATE TRIGGER IF NOT EXISTS kanban_fts_comment_ai AFTER INSERT ON kanban_comment BEGIN
        INSERT INTO kanban_fts (card_id, comment_id, title, body, tags)
        VALUES (new.card_id, new.id, '', new.body, coalesce(new.author, ''));
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS kanban_fts_comment_ad AFTER DELETE ON kanban_comment BEGIN
        DELETE FROM kanban_fts WHERE comment_id = old.id;
    END
    """,
)


def init_schema(conn):
    """Create the FTS table + triggers, and rebuild when the index looks stale."""
    conn.execute(_SCHEMA)
    for statement in _TRIGGERS:
        conn.execute(statement)
    indexed = conn.execute("SELECT count(*) FROM kanban_fts").fetchone()[0]
    expected = conn.execute("SELECT count(*) FROM kanban_card").fetchone()[0]
    expected += conn.execute("SELECT count(*) FROM kanban_comment").fetchone()[0]
    if indexed != expected:
        rebuild(conn)


def rebuild(conn):
    """Recreate every document from the source tables."""
    conn.execute("DELETE FROM kanban_fts")
    conn.execute(
        "INSERT INTO kanban_fts (card_id, comment_id, title, body, tags)"
        f" SELECT id, 0, title, body, {_TAGS.format(t='kanban_card')} FROM kanban_card"
    )
    conn.execute(
        "INSERT INTO kanban_fts (card_id, comment_id, title, body, tags)"
        " SELECT card_id, id, '', body, coalesce(author, '') FROM kanban_comment"
    )


_TOKEN_RE = re.compile(r'"([^"]*)"|(\S+)')
_WORD = re.compile(r"\w")


def match_expr(query):
    """A quoted, prefix-matched FTS5 expression for free text; None if empty."""
    terms, excludes = [], []
    for quoted, bare in _TOKEN_RE.findall((query or "")[:MAX_QUERY]):
        quoted = quoted or None  # findall gives '' for a group that did not match
        raw = (quoted if quoted is not None else bare).strip()
        negate = False
        if quoted is None and raw.startswith("-") and len(raw) > 1:
            negate, raw = True, raw[1:]
        if not raw.strip() or not _WORD.search(raw):
            continue
        atom = '"' + raw.replace('"', '""') + '"'
        if len(atom) < 3:  # a lone quote pair would match everything
            continue
        (excludes if negate else terms).append(atom + "*")
    if not terms:
        return None
    expr = " AND ".join(terms[:MAX_TERMS])
    for atom in excludes[:MAX_TERMS]:
        expr += " NOT " + atom
    return expr


def _where(archived, lane_id, owner, opname):
    """The shared filter clause for the MATCH query and its count twin."""
    clauses, args = ["kanban_fts MATCH ?"], []
    if archived == "exclude":
        clauses.append("c.archived_at IS NULL")
    elif archived == "only":
        clauses.append("c.archived_at IS NOT NULL")
    if lane_id is not None:
        clauses.append("c.lane_id = ?")
        args.append(lane_id)
    if owner == "":
        clauses.append("c.owner IS NULL")
    elif owner is not None:
        clauses.append("c.owner = ? COLLATE NOCASE")
        args.append(owner)
    if opname == "":
        clauses.append("c.opname IS NULL")
    elif opname is not None:
        clauses.append("c.opname = ? COLLATE NOCASE")
        args.append(opname)
    return " AND ".join(clauses), args


def _clean_limit(limit):
    if isinstance(limit, bool) or not isinstance(limit, int):
        return DEFAULT_LIMIT
    return max(1, min(limit, MAX_LIMIT))


_FROM = (
    " FROM kanban_fts JOIN kanban_card c ON c.id = kanban_fts.card_id"
    " JOIN kanban_lane l ON l.id = c.lane_id"
)

_SELECT = (
    "SELECT kanban_fts.card_id, kanban_fts.comment_id,"
    " bm25(kanban_fts, 0.0, 0.0, 10.0, 1.0, 3.0) AS rank,"
    f" snippet(kanban_fts, 2, '{MARK_OPEN}', '{MARK_CLOSE}', '…', 12) AS title_snip,"
    f" snippet(kanban_fts, 3, '{MARK_OPEN}', '{MARK_CLOSE}', '…', 18) AS body_snip,"
    f" snippet(kanban_fts, 4, '{MARK_OPEN}', '{MARK_CLOSE}', '…', 8) AS tags_snip,"
    " c.title, c.lane_id, l.name AS lane, c.owner, c.opname, c.archived_at, c.updated_at"
)


def search(
    conn,
    query,
    archived="exclude",
    lane_id=None,
    owner=None,
    opname=None,
    limit=DEFAULT_LIMIT,
):
    """Cards matching ``query``, best first, with matched fields and one snippet.

    ``archived`` is exclude/include/only; ``owner``/``opname`` follow the board
    conventions (None = no filter, "" = only empty values). Raises
    ``KanbanError`` for a query with no searchable word in it."""
    query = (query or "").strip()
    expr = match_expr(query)
    if expr is None:
        raise KanbanError("q needs at least one searchable word")
    if archived not in ("exclude", "include", "only"):
        raise KanbanError("archived must be one of: exclude, include, only")
    limit = _clean_limit(limit)
    where, args = _where(archived, lane_id, owner, opname)
    total = conn.execute(
        "SELECT count(DISTINCT kanban_fts.card_id)" + _FROM + " WHERE " + where,
        (expr, *args),
    ).fetchone()[0]
    # Rows are documents, not cards: fetch extra so one card's comments cannot
    # crowd the real matches out of the window.
    rows = conn.execute(
        _SELECT + _FROM + " WHERE " + where + " ORDER BY rank, kanban_fts.comment_id LIMIT ?",
        (expr, *args, min(max(limit * 4, 100), 1000)),
    ).fetchall()
    cards = _collect(rows)
    out = cards[:limit]
    return {
        "query": query,
        "total": total,
        "count": len(out),
        "truncated": total > len(out),
        "cards": out,
    }


def _collect(rows):
    """Group documents by card, keeping the best rank and one useful snippet."""
    found, order = {}, []
    for row in rows:
        card_id = row["card_id"]
        entry = found.get(card_id)
        if entry is None:
            entry = {
                "card_id": card_id,
                "title": row["title"],
                "title_marked": row["title"],
                "lane": row["lane"],
                "lane_id": row["lane_id"],
                "owner": row["owner"],
                "opname": row["opname"],
                "archived_at": row["archived_at"],
                "updated_at": row["updated_at"],
                "matched": set(),
                "snippets": {},
                "score": round(-row["rank"], 4),
            }
            found[card_id] = entry
            order.append(entry)
        title_hit = MARK_OPEN in (row["title_snip"] or "")
        body_hit = MARK_OPEN in (row["body_snip"] or "")
        if title_hit:
            entry["matched"].add("title")
            entry["title_marked"] = row["title_snip"]
        if MARK_OPEN in (row["tags_snip"] or ""):
            entry["matched"].add("meta")
        if body_hit:
            kind = "comment" if row["comment_id"] else "body"
            entry["matched"].add(kind)
            entry["snippets"].setdefault(kind, row["body_snip"])
    for entry in order:
        matched = entry["matched"]
        entry["matched"] = [name for name in _MATCH_ORDER if name in matched]
        source = "body" if "body" in entry["snippets"] else None
        if source is None and "comment" in entry["snippets"]:
            source = "comment"
        entry["snippet"] = entry["snippets"].get(source) if source else None
        entry["snippet_source"] = source
        del entry["snippets"]
    return order
