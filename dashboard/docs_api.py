"""HTTP blueprint for Docs: an S3-ish text store keyed by prefix (path).

Canonical: ``/api/docs``. The prefix is the object key, so reads and writes
address it directly: ``PUT /api/docs/notes/handoff.md`` creates or replaces,
``GET`` reads, ``DELETE`` removes. Listings return metadata only unless
``?content=1`` is passed, and ``/api/docs/search`` runs the FTS5 index.

No auth: local stack, exposed only over the tailnet.
"""

from flask import Blueprint, jsonify, request

from . import docs, docs_embed
from .docs import DocsError
from .docs_embed import EmbedError

bp = Blueprint("docs", __name__)

FIELDS = ("prefix", "content", "author", "tags")


@bp.errorhandler(DocsError)
def docs_error(exc):
    return jsonify({"error": exc.message}), exc.status


@bp.get("/api/docs")
def docs_list():
    """Metadata for every doc, newest update first. ``?prefix=`` filters a path."""
    prefix = request.args.get("prefix") or None
    limit = docs.clean_limit(request.args.get("limit"))
    try:
        offset = int(request.args.get("offset", 0))
    except (TypeError, ValueError):
        raise DocsError("offset must be a number") from None
    with_content = str(request.args.get("content", "")).lower() in ("1", "true", "yes")
    return jsonify(docs.listing(prefix, limit=limit, offset=offset, with_content=with_content))


@bp.get("/api/docs/prefixes")
def docs_prefixes():
    """Directories that hold docs, with direct and recursive counts."""
    return jsonify({"prefixes": docs.prefixes(), "tags": docs.tags()})


@bp.get("/api/docs/search")
def docs_search():
    """GET /api/docs/search?q=...&prefix=...&limit=N — FTS5 with snippets."""
    return jsonify(
        docs.search(
            request.args.get("q", ""),
            prefix=request.args.get("prefix") or None,
            prefix_q=docs.clean_prefix_query(request.args.get("prefix_q")),
            limit=docs.clean_limit(request.args.get("limit")),
        )
    )


@bp.get("/api/docs/semantic")
def docs_semantic():
    """GET /api/docs/semantic?q=...&prefix=...&limit=N — cosine over local vectors."""
    try:
        result = docs_embed.search(
            request.args.get("q", ""),
            prefix=(
                docs.clean_prefix(request.args["prefix"]) if request.args.get("prefix") else None
            ),
            prefix_q=docs.clean_prefix_query(request.args.get("prefix_q")),
            limit=docs.clean_limit(request.args.get("limit"), default=10),
        )
    except EmbedError as exc:
        return jsonify({"error": str(exc), "available": False}), 503
    return jsonify(result)


@bp.get("/api/docs/index")
def docs_index_status():
    """How much of the corpus carries vectors for the configured model."""
    total = docs.listing(limit=1)["total"]
    return jsonify(
        {
            "model": docs_embed.config.EMBED_MODEL,
            "ollama": docs_embed.config.OLLAMA_URL,
            "pending": docs_embed.pending_count(),
            "total": total,
            "available": True,
        }
    )


@bp.post("/api/docs/reindex")
def docs_reindex():
    """Queue every doc whose vectors are missing, stale, or from another model."""
    queued = docs_embed.reindex_all()
    return jsonify({"queued": queued, "model": docs_embed.config.EMBED_MODEL})


@bp.get("/api/docs/<path:prefix>")
def docs_get(prefix):
    doc = docs.fetch(prefix)
    if doc is None:
        raise DocsError(f"no doc at prefix {docs.clean_prefix(prefix)}", 404)
    return jsonify(doc)


@bp.put("/api/docs/<path:prefix>")
def docs_put(prefix):
    """Create or replace one doc. Body: {"content", "author", "tags"}."""
    body = request.get_json(silent=True)
    if body is None:
        body = {}
    if not isinstance(body, dict):
        raise DocsError("request body must be a JSON object")
    unknown = sorted(set(body) - set(FIELDS))
    if unknown:
        raise DocsError(f"unknown field(s): {', '.join(unknown)}; allowed: {', '.join(FIELDS)}")
    doc, created = docs.put(
        prefix,
        content=body.get("content"),
        author=body.get("author"),
        tags=body.get("tags"),
    )
    return jsonify(doc), 201 if created else 200


@bp.post("/api/docs")
def docs_create():
    """Create a doc from a JSON body that carries its own prefix."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise DocsError("request body must be a JSON object")
    unknown = sorted(set(body) - set(FIELDS))
    if unknown:
        raise DocsError(f"unknown field(s): {', '.join(unknown)}; allowed: {', '.join(FIELDS)}")
    if "prefix" not in body:
        raise DocsError("prefix is required")
    doc, created = docs.put(
        body["prefix"],
        content=body.get("content"),
        author=body.get("author"),
        tags=body.get("tags"),
        create_only=True,
    )
    return jsonify(doc), 201 if created else 200


@bp.patch("/api/docs/<path:prefix>")
def docs_patch(prefix):
    """Update only the fields present in the body (content, author, tags)."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise DocsError("request body must be a JSON object")
    unknown = sorted(set(body) - {"content", "author", "tags"})
    if unknown:
        raise DocsError(f"unknown field(s): {', '.join(unknown)}; allowed: content, author, tags")
    return jsonify(docs.patch(prefix, body))


@bp.delete("/api/docs/<path:prefix>")
def docs_delete(prefix):
    deleted = docs.delete(prefix)
    return jsonify({"deleted": deleted})
