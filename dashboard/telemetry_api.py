"""Telemetry endpoints (FastAPI). File reads run off the event loop."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import config, telemetry_store

router = APIRouter()


@router.get("/api/stats")
async def stats():
    snapshot, reason = await run_in_threadpool(telemetry_store.read_latest_stats)
    if reason in ("reconnecting", "starting"):
        return JSONResponse(
            status_code=503,
            content={"error": f"Telemetry sampler is {reason}", "stale": True},
        )
    return snapshot


@router.get("/api/stats/history")
async def stats_history(seconds: str = "3600"):
    """Dense per-second series for the graphs; null means no sample."""
    try:
        wanted = max(60, min(int(seconds), config.TELEMETRY_RETENTION_S))
    except (TypeError, ValueError):
        wanted = 3600
    return await run_in_threadpool(telemetry_store.history_series, wanted)
