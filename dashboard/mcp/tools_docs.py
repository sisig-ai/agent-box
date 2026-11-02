"""MCP tools: Docs (S3-ish text store keyed by prefix)."""

from .. import config, docs, docs_embed
from ..docs import DocsError
from ..docs_embed import EmbedError
from .protocol import ToolError, tool_spec

PREFIX = {
    "type": "string",
    "description": (
        "Object key, slash-separated like a path (e.g. 'notes/handoffs/2026-11-02.md'). "
        "No leading or trailing slash, no '.' or '..' segments. This is the "
        "identity of the doc."
    ),
}
CONTENT = {
    "type": "string",
    "description": "Full text of the doc (markdown is the expected shape).",
}
AUTHOR = {
    "type": "string",
    "description": "Free-text author, usually your agent name. Null or '' clears it.",
}
TAGS = {
    "type": "array",
    "items": {"type": "string"},
    "description": "Up to 24 tags, each 60 characters or fewer (e.g. ['handoff', 'doctrine']).",
}
LIMIT = {
    "type": "integer",
    "minimum": 1,
    "maximum": 200,
    "default": 50,
    "description": "Maximum rows to return.",
}
OFFSET = {
    "type": "integer",
    "minimum": 0,
    "default": 0,
    "description": "Rows to skip, for paging.",
}


def put_doc(args):
    prefix = args.get("prefix")
    if not prefix:
        raise ToolError("prefix is required")
    try:
        doc, created = docs.put(
            prefix,
            content=args.get("content", ""),
            author=args.get("author"),
            tags=args.get("tags"),
        )
    except DocsError as exc:
        raise ToolError(exc.message) from None
    return {"created": created, "doc": doc}


def get_doc(args):
    prefix = args.get("prefix")
    if not prefix:
        raise ToolError("prefix is required")
    try:
        doc = docs.fetch(prefix)
    except DocsError as exc:
        raise ToolError(exc.message) from None
    if doc is None:
        raise ToolError(f"no doc at prefix {prefix}")
    return doc


def patch_doc(args):
    prefix = args.get("prefix")
    if not prefix:
        raise ToolError("prefix is required")
    changes = {key: args[key] for key in ("content", "author", "tags") if key in args}
    if not changes:
        raise ToolError("nothing to update: pass content, author or tags")
    try:
        return docs.patch(prefix, changes)
    except DocsError as exc:
        raise ToolError(exc.message) from None


def list_docs(args):
    try:
        return docs.listing(
            args.get("prefix") or None,
            limit=docs.clean_limit(args.get("limit")),
            offset=int(args.get("offset") or 0),
        )
    except DocsError as exc:
        raise ToolError(exc.message) from None


def search_docs(args):
    query = (args.get("q") or "").strip()
    if not query:
        raise ToolError("q is required")
    try:
        return docs.search(
            query,
            prefix=args.get("prefix") or None,
            limit=docs.clean_limit(args.get("limit")),
        )
    except DocsError as exc:
        raise ToolError(exc.message) from None


def semantic_search_docs(args):
    query = (args.get("q") or "").strip()
    if not query:
        raise ToolError("q is required")
    prefix = args.get("prefix") or None
    if prefix:
        try:
            prefix = docs.clean_prefix(prefix)
        except DocsError as exc:
            raise ToolError(exc.message) from None
    try:
        return docs_embed.search(
            query,
            prefix=prefix,
            limit=docs.clean_limit(args.get("limit"), default=10),
        )
    except EmbedError as exc:
        raise ToolError(str(exc)) from None


def reindex_docs(_args):
    return {"queued": docs_embed.reindex_all(), "model": config.EMBED_MODEL}


def delete_doc(args):
    prefix = args.get("prefix")
    if not prefix:
        raise ToolError("prefix is required")
    try:
        return {"deleted": docs.delete(prefix)}
    except DocsError as exc:
        raise ToolError(exc.message) from None


TOOLS = {
    "put_doc": {
        "spec": tool_spec(
            "put_doc",
            "Put a Doc",
            "Create or replace a doc by prefix. Replacing bumps revision and "
            "updated_at and overwrites content, author and tags in full, so read "
            "first when you only mean to append. Use this for long-horizon notes, "
            "handoff briefs and specs.",
            {"prefix": PREFIX, "content": CONTENT, "author": AUTHOR, "tags": TAGS},
            ["prefix", "content"],
        ),
        "handler": put_doc,
    },
    "get_doc": {
        "spec": tool_spec(
            "get_doc",
            "Get a Doc",
            "One doc in full: content plus author, tags, revision, created_at, updated_at.",
            {"prefix": PREFIX},
            ["prefix"],
            read_only=True,
        ),
        "handler": get_doc,
    },
    "patch_doc": {
        "spec": tool_spec(
            "patch_doc",
            "Patch a Doc",
            "Update only the fields you pass (content, author, tags). Keeps the rest, "
            "bumps revision and updated_at.",
            {"prefix": PREFIX, "content": CONTENT, "author": AUTHOR, "tags": TAGS},
            ["prefix"],
        ),
        "handler": patch_doc,
    },
    "list_docs": {
        "spec": tool_spec(
            "list_docs",
            "List Docs",
            "Metadata for every doc (no content), newest update first. Pass prefix to "
            "narrow to a path and its descendants.",
            {"prefix": PREFIX, "limit": LIMIT, "offset": OFFSET},
            [],
            read_only=True,
        ),
        "handler": list_docs,
    },
    "search_docs": {
        "spec": tool_spec(
            "search_docs",
            "Search Docs",
            "Full-text search across prefix, content, tags and author. Terms are "
            'prefix-matched, -word excludes, "two words" is an exact phrase. Hits '
            "carry a snippet with \\u0001…\\u0002 around the match.",
            {
                "q": {"type": "string", "description": "Search terms."},
                "prefix": {
                    **PREFIX,
                    "description": "Optional path filter (that doc and its descendants).",
                },
                "limit": LIMIT,
            },
            ["q"],
            read_only=True,
        ),
        "handler": search_docs,
    },
    "semantic_search_docs": {
        "spec": tool_spec(
            "semantic_search_docs",
            "Semantic Search Docs",
            "Meaning-based search over Docs: embeds the query with the local "
            "Ollama model and cosine-ranks stored chunk vectors, so a hit does not "
            "need to share words with the query. Best chunk per doc wins, score "
            "0-1. Use it when exact terms fail; combine with search_docs.",
            {
                "q": {"type": "string", "description": "What you are looking for, in plain words."},
                "prefix": {
                    **PREFIX,
                    "description": "Optional path filter (that doc and its descendants).",
                },
                "limit": {**LIMIT, "default": 10},
            },
            ["q"],
            read_only=True,
        ),
        "handler": semantic_search_docs,
    },
    "reindex_docs": {
        "spec": tool_spec(
            "reindex_docs",
            "Reindex Docs",
            "Queue every doc whose vectors are missing, stale or from another "
            "embedding model. Runs in the background; indexing happens on each "
            "write anyway, so this is for backfill and model changes.",
            {},
            [],
        ),
        "handler": reindex_docs,
    },
    "delete_doc": {
        "spec": tool_spec(
            "delete_doc",
            "Delete a Doc",
            "Remove one doc by prefix. Irreversible: only delete when the user asks.",
            {"prefix": PREFIX},
            ["prefix"],
        ),
        "handler": delete_doc,
    },
}
