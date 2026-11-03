"""MCP access log endpoints (FastAPI).

One row per ``tools/call``: timestamp, tool, entity, outcome, duration and a
trimmed argument summary. SQLite work runs in the threadpool.
"""

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from . import access_log
from .access_log import LogError

router = APIRouter()


def _fail(exc: LogError):
    raise HTTPException(status_code=exc.status, detail=exc.message)


@router.get("/api/logs")
async def logs_list(
    limit: str = "200",
    tool: str | None = None,
    entity: str | None = None,
    ok: str | None = None,
):
    """Newest first; ``ok`` is 0 or 1, anything else means both."""
    try:
        size = int(limit)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="limit must be a number") from None
    outcome = None if ok not in ("0", "1") else ok == "1"
    try:
        return await run_in_threadpool(
            access_log.list_entries,
            limit=size,
            tool=tool or None,
            entity=entity or None,
            ok=outcome,
        )
    except LogError as exc:
        _fail(exc)


@router.post("/api/logs/rotate")
async def logs_rotate():
    """Force a new daily file and sweep anything past the retention window."""
    return await run_in_threadpool(access_log.rotate)
