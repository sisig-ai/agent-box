"""Progress Bars API (FastAPI).

Canonical: /api/progress. No auth, same as the rest of the dashboard.
Errors are JSON ``{"error": "..."}`` with 400 / 404 / 409.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import progress
from .api_kit import error, json_body
from .progress import ProgressError

router = APIRouter()

CREATE_FIELDS = ("title", "percent", "parent_id", "fields", "owner", "position")
UPDATE_FIELDS = CREATE_FIELDS + ("add_fields", "remove_fields", "archived")
TRUTHY = {"1", "true", "yes", "on"}


async def _body(request: Request, allowed: tuple[str, ...]) -> dict:
    body = await json_body(request)
    if body is None:
        raise ProgressError("request body must be a JSON object (Content-Type: application/json)")
    if "__unknown__" in body:
        unknown = body["__unknown__"]
        raise ProgressError(
            f"unknown field(s): {', '.join(unknown)}; allowed: {', '.join(allowed)}"
        )
    return body


@router.get("/api/progress")
async def progress_list(archived: str | None = None):
    """Roots with nested children; archived=exclude (default) | include | only."""
    mode = progress.clean_archived(archived)
    bars = await run_in_threadpool(progress.tree, mode)
    _live, archived_count = await run_in_threadpool(progress.counts)
    count = await run_in_threadpool(progress.count, mode)
    return {"bars": bars, "count": count, "archived_count": archived_count}


@router.get("/api/progress/flat")
async def progress_flat(archived: str | None = None):
    """Every bar in one list (no children nesting)."""
    mode = progress.clean_archived(archived)
    bars = await run_in_threadpool(progress.flat, mode)
    _live, archived_count = await run_in_threadpool(progress.counts)
    return {"bars": bars, "count": len(bars), "archived_count": archived_count}


@router.get("/api/progress/{bar_id}")
async def progress_get(bar_id: int):
    bar = await run_in_threadpool(progress.fetch, bar_id)
    if bar is None:
        return error(f"no progress bar with id {bar_id}", 404)
    return bar


@router.post("/api/progress")
async def progress_create(request: Request):
    try:
        body = await _body(request, CREATE_FIELDS)
        if "title" not in body:
            raise ProgressError("title is required")
        bar = await run_in_threadpool(
            progress.create,
            body["title"],
            percent=body.get("percent"),
            parent_id=body.get("parent_id"),
            fields=body.get("fields"),
            owner=body.get("owner"),
            position=body.get("position"),
        )
    except ProgressError as exc:
        return error(exc.message, exc.status)
    return JSONResponse(status_code=201, content=bar)


@router.patch("/api/progress/{bar_id}")
async def progress_update(bar_id: int, request: Request):
    try:
        body = await _body(request, UPDATE_FIELDS)
        archived = body.pop("archived", None)
        if archived is not None and not isinstance(archived, bool):
            raise ProgressError("archived must be true or false")
        bar = (
            await run_in_threadpool(progress.update, bar_id, body)
            if body
            else await run_in_threadpool(progress.fetch, bar_id)
        )
        if archived is not None:
            bar = await run_in_threadpool(progress.archive, bar_id, archived)
        if bar is None:
            raise ProgressError(f"no progress bar with id {bar_id}", 404)
    except ProgressError as exc:
        return error(exc.message, exc.status)
    return bar


@router.post("/api/progress/archive-done")
async def progress_archive_done():
    """Archive every bar at 100% and its subtree."""
    try:
        return await run_in_threadpool(progress.archive_done)
    except ProgressError as exc:
        return error(exc.message, exc.status)


@router.delete("/api/progress/{bar_id}")
async def progress_delete(bar_id: int, cascade: str | None = None):
    wanted = str(cascade or "").lower() in TRUTHY
    try:
        deleted = await run_in_threadpool(progress.delete, bar_id, cascade=wanted)
    except ProgressError as exc:
        return error(exc.message, exc.status)
    return {"deleted": bar_id, "deleted_count": deleted}
