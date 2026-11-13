"""Docs API (FastAPI): a prefix-keyed text store.

Canonical: ``/api/docs``. The prefix is the object key, so ``PUT
/api/docs/notes/handoff.md`` creates or replaces. Listings return metadata
unless ``?content=1``; ``/api/docs/search`` runs the FTS5 index.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import docs, docs_embed
from .api_kit import error
from .docs import DocsError
from .docs_embed import EmbedError

router = APIRouter()

FIELDS = ("prefix", "content", "author", "tags")
TRUTHY = ("1", "true", "yes")


@router.get("/api/docs")
async def docs_list(
    prefix: str | None = None,
    author: str | None = None,
    limit: str | None = None,
    offset: str = "0",
    content: str = "",
):
    """Metadata for every doc, newest update first; ``prefix`` filters a path."""
    try:
        start = int(offset)
    except (TypeError, ValueError):
        return error("offset must be a number")
    try:
        return await run_in_threadpool(
            docs.listing,
            prefix or None,
            author=author,
            limit=docs.clean_limit(limit),
            offset=start,
            with_content=str(content).lower() in TRUTHY,
        )
    except DocsError as exc:
        return error(exc.message, exc.status)


@router.get("/api/docs/tree")
async def docs_tree(per: str = "5", author: str | None = None):
    """Folders with counts and at most ``per`` docs each, plus remainder sizes."""
    try:
        per_folder = int(per)
    except (TypeError, ValueError):
        return error("per must be a number")
    return await run_in_threadpool(docs.tree, per_folder, author)


@router.get("/api/docs/authors")
async def docs_authors():
    return {"authors": await run_in_threadpool(docs.authors)}


@router.get("/api/docs/prefixes")
async def docs_prefixes():
    prefixes = await run_in_threadpool(docs.prefixes)
    tags = await run_in_threadpool(docs.tags)
    return {"prefixes": prefixes, "tags": tags}


@router.get("/api/docs/search")
async def docs_search(
    q: str = "",
    prefix: str | None = None,
    prefix_q: str | None = None,
    author: str | None = None,
    limit: str | None = None,
):
    """FTS5 over prefixes, content and tags, with snippets."""
    try:
        return await run_in_threadpool(
            docs.search,
            q,
            prefix=prefix or None,
            prefix_q=docs.clean_prefix_query(prefix_q),
            author=author,
            limit=docs.clean_limit(limit),
        )
    except DocsError as exc:
        return error(exc.message, exc.status)


@router.get("/api/docs/semantic")
async def docs_semantic(
    q: str = "",
    prefix: str | None = None,
    prefix_q: str | None = None,
    author: str | None = None,
    limit: str | None = None,
    sort: str = "blend",
    min_score: str | None = None,
    recency_weight: str | None = None,
    recency_tau_days: str | None = None,
):
    """Cosine over the local vectors; 503 when the embedder is unavailable."""
    try:
        cleaned = docs.clean_prefix(prefix) if prefix else None
        return await run_in_threadpool(
            docs_embed.search,
            q,
            prefix=cleaned,
            prefix_q=docs.clean_prefix_query(prefix_q),
            author=author,
            limit=docs.clean_limit(limit, default=10),
            sort=sort or "blend",
            min_score=float(min_score) if min_score is not None else None,
            recency_weight=float(recency_weight) if recency_weight is not None else None,
            recency_tau_days=float(recency_tau_days) if recency_tau_days is not None else None,
        )
    except EmbedError as exc:
        return JSONResponse(status_code=503, content={"error": str(exc), "available": False})
    except DocsError as exc:
        return error(exc.message, exc.status)


@router.get("/api/docs/search-unified")
async def docs_search_unified(
    q: str = "",
    prefix: str | None = None,
    prefix_q: str | None = None,
    author: str | None = None,
    limit: str | None = None,
    sort: str = "blend",
    min_score: str | None = None,
    recency_weight: str | None = None,
    recency_tau_days: str | None = None,
    semantic_limit: str | None = None,
    half_life_days: str | None = None,
):
    """One ranked list: weighted RRF over FTS + semantic ranks, decayed by age.

    ``semantic_limit`` caps the semantic-only additions below the exact hits;
    ``half_life_days`` (default 30) is the exponential age half-life — newer
    results bubble up, 0 disables the decay.
    """
    try:
        cleaned = docs.clean_prefix(prefix) if prefix else None
        half = None
        if half_life_days is not None:
            half = float(half_life_days)
            if not half >= 0:
                return error("half_life_days must be >= 0")
        return await run_in_threadpool(
            docs_embed.search_unified,
            q,
            prefix=cleaned,
            prefix_q=docs.clean_prefix_query(prefix_q),
            author=author,
            limit=docs.clean_limit(limit, default=10),
            sort=sort or "blend",
            min_score=float(min_score) if min_score is not None else None,
            recency_weight=float(recency_weight) if recency_weight is not None else None,
            recency_tau_days=float(recency_tau_days) if recency_tau_days is not None else None,
            semantic_limit=docs.clean_limit(semantic_limit, default=None)
            if semantic_limit
            else None,
            half_life_days=half,
        )
    except EmbedError as exc:
        return JSONResponse(status_code=503, content={"error": str(exc), "available": False})
    except DocsError as exc:
        return error(exc.message, exc.status)


@router.get("/api/docs/index")
async def docs_index_status():
    """How much of the corpus carries vectors for the configured model."""
    total = (await run_in_threadpool(docs.listing, limit=1))["total"]
    return {
        "model": docs_embed.config.EMBED_MODEL,
        "ollama": docs_embed.config.OLLAMA_URL,
        "pending": await run_in_threadpool(docs_embed.pending_count),
        "total": total,
        "available": True,
    }


@router.post("/api/docs/reindex")
async def docs_reindex():
    """Queue every doc whose vectors are missing, stale, or from another model."""
    queued = await run_in_threadpool(docs_embed.reindex_all)
    return {"queued": queued, "model": docs_embed.config.EMBED_MODEL}


@router.get("/api/docs/{prefix:path}")
async def docs_get(prefix: str):
    doc = await run_in_threadpool(docs.fetch, prefix)
    if doc is None:
        return error(f"no doc at prefix {docs.clean_prefix(prefix)}", 404)
    return doc


@router.put("/api/docs/{prefix:path}")
async def docs_put(prefix: str, request: Request):
    """Create or replace one doc. Body: content, author, tags."""
    body = await _object(request, FIELDS)
    if body is None:
        return error("request body must be a JSON object")
    try:
        doc, created = await run_in_threadpool(
            docs.put,
            prefix,
            content=body.get("content"),
            author=body.get("author"),
            tags=body.get("tags"),
        )
    except DocsError as exc:
        return error(exc.message, exc.status)
    return JSONResponse(status_code=201 if created else 200, content=doc)


@router.post("/api/docs")
async def docs_create(request: Request):
    """Create a doc from a body that carries its own prefix."""
    body = await _object(request, FIELDS)
    if body is None:
        return error("request body must be a JSON object")
    if "prefix" not in body:
        return error("prefix is required")
    try:
        doc, created = await run_in_threadpool(
            docs.put,
            body["prefix"],
            content=body.get("content"),
            author=body.get("author"),
            tags=body.get("tags"),
            create_only=True,
        )
    except DocsError as exc:
        return error(exc.message, exc.status)
    return JSONResponse(status_code=201 if created else 200, content=doc)


@router.patch("/api/docs/{prefix:path}")
async def docs_patch(prefix: str, request: Request):
    """Update only the fields present in the body."""
    body = await _object(request, ("content", "author", "tags"), label="content, author, tags")
    if body is None:
        return error("request body must be a JSON object")
    try:
        return await run_in_threadpool(docs.patch, prefix, body)
    except DocsError as exc:
        return error(exc.message, exc.status)


@router.delete("/api/docs/{prefix:path}")
async def docs_delete(prefix: str):
    try:
        return {"deleted": await run_in_threadpool(docs.delete, prefix)}
    except DocsError as exc:
        return error(exc.message, exc.status)


async def _object(request: Request, allowed: tuple[str, ...], label: str | None = None):
    try:
        body = await request.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    unknown = sorted(set(body) - set(allowed))
    if unknown:
        raise DocsError(
            f"unknown field(s): {', '.join(unknown)}; allowed: {label or ', '.join(allowed)}"
        )
    return body
