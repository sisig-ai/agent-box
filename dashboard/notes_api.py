"""Daily Sitrep and Weekly Schedule API (FastAPI).

Canonical: /api/sitrep[/list]; /api/brief[/list] stay as deprecated aliases on
the same handlers.
"""

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from . import notes
from .api_kit import error
from .dates import normalize_date, normalize_week

router = APIRouter()


def parse_limit(raw, default, maximum):
    """Parse a ?limit= value. None means non-numeric garbage (400)."""
    if raw is None:
        return default
    try:
        return min(int(raw), maximum)
    except (TypeError, ValueError):
        return None


@router.get("/api/sitrep")
@router.get("/api/brief")
async def brief_get(date: str | None = None):
    """The day's entry (defaults to today)."""
    day = normalize_date(date)
    if day is None:
        return error("date must be YYYY-MM-DD")
    row = await run_in_threadpool(notes.fetch_brief, day)
    if row is None:
        return {"date": day, "content": ""}
    return row


@router.get("/api/sitrep/list")
@router.get("/api/brief/list")
async def brief_list(limit: str | None = None):
    """Most recent days first."""
    size = parse_limit(limit, 30, 365)
    if size is None:
        return error("limit must be a number")
    return await run_in_threadpool(notes.list_briefs, size)


@router.put("/api/sitrep")
@router.put("/api/brief")
@router.post("/api/sitrep")
@router.post("/api/brief")
async def brief_upsert(request: Request):
    """Create or replace that day's entry."""
    body = await _json(request)
    if "content" not in body:
        return error("content is required")
    day = normalize_date(body.get("date"))
    if day is None:
        return error("date must be YYYY-MM-DD")
    return await run_in_threadpool(notes.upsert_brief, day, body["content"])


@router.delete("/api/sitrep")
@router.delete("/api/brief")
async def brief_delete(date: str | None = None):
    """Remove that day's entry."""
    day = normalize_date(date)
    if day is None:
        return error("date must be YYYY-MM-DD")
    if not await run_in_threadpool(notes.delete_brief, day):
        return error("no entry for that date", 404)
    return {"deleted": day}


@router.get("/api/schedule")
async def schedule_get(week: str | None = None):
    """The week's entry; week_start coerces to that week's Monday."""
    start = normalize_week(week)
    if start is None:
        return error("week must be YYYY-MM-DD")
    row = await run_in_threadpool(notes.fetch_schedule, start)
    if row is None:
        return {"week_start": start, "content": ""}
    return row


@router.get("/api/schedule/list")
async def schedule_list(limit: str | None = None):
    """Most recent weeks first."""
    size = parse_limit(limit, 20, 104)
    if size is None:
        return error("limit must be a number")
    return await run_in_threadpool(notes.list_schedules, size)


@router.put("/api/schedule")
@router.post("/api/schedule")
async def schedule_upsert(request: Request):
    body = await _json(request)
    if "content" not in body:
        return error("content is required")
    start = normalize_week(body.get("week"))
    if start is None:
        return error("week must be YYYY-MM-DD")
    return await run_in_threadpool(notes.upsert_schedule, start, body["content"])


@router.delete("/api/schedule")
async def schedule_delete(week: str | None = None):
    start = normalize_week(week)
    if start is None:
        return error("week must be YYYY-MM-DD")
    if not await run_in_threadpool(notes.delete_schedule, start):
        return error("no entry for that week", 404)
    return {"deleted": start}


async def _json(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}
