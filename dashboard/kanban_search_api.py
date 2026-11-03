"""Ops Board full-text search (FastAPI).

GET /api/opsboard/search?q=…&limit=&archived=&status=&owner=&opname=
(/api/kanban/search is the deprecated alias.)
"""

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from . import db, kanban, kanban_search
from .kanban import KanbanError

router = APIRouter()


def _search(params: dict):
    query = " ".join((params.get("q") or "").split())
    if not query:
        raise KanbanError('q is required (words, "a phrase", -excluded)')
    if len(query) > kanban_search.MAX_QUERY:
        raise KanbanError(f"q must be at most {kanban_search.MAX_QUERY} characters")
    archived = (params.get("archived") or "").strip().lower()
    if not archived:
        raw = params.get("include_archived")
        truthy = {"1", "true", "yes", "on", ""}
        archived = "include" if raw is not None and raw.strip().lower() in truthy else "exclude"
    if archived not in ("exclude", "include", "only"):
        raise KanbanError("archived must be one of: exclude, include, only")
    limit = kanban_search.DEFAULT_LIMIT
    if params.get("limit") is not None:
        try:
            limit = int(params["limit"])
        except ValueError:
            raise KanbanError("limit must be an integer") from None
        if limit < 1:
            raise KanbanError("limit must be a positive integer")
    status, owner, opname = params.get("status"), params.get("owner"), params.get("opname")
    conn = db.get_db()
    lane_id = kanban.require_lane(conn, status.strip())["id"] if status and status.strip() else None
    return kanban_search.search(
        conn,
        query,
        archived=archived,
        lane_id=lane_id,
        owner=owner.strip() if owner is not None else None,
        opname=" ".join(opname.split()) if opname is not None else None,
        limit=limit,
    )


@router.get("/api/opsboard/search")
@router.get("/api/kanban/search")
async def search_cards(request: Request):
    """FTS5 over titles, bodies, comments, opnames and owners."""
    return await run_in_threadpool(_search, dict(request.query_params))
