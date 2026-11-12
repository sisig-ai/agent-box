"""Ops Board API (FastAPI): lanes + cards.

Canonical routes live under /api/opsboard; /api/kanban/* stay as deprecated
aliases on the same handlers. Errors are ``{"error": "..."}`` with 400/404/409,
produced by the app-level KanbanError handler. SQLite work runs in the pool.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import db, kanban, kanban_embed, kanban_lanes, kanban_subtasks
from .kanban import KanbanError

router = APIRouter()

TITLE_MAX = 500
OWNER_MAX = 100
OPNAME_MAX = 100
BODY_MAX = 200_000
LANE_NAME_MAX = 60
TRUTHY = {"1", "true", "yes", "on", ""}


async def json_body(request: Request, allowed: tuple[str, ...]) -> dict:
    """The request's JSON object, rejecting non-objects and unknown keys."""
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise KanbanError("request body must be a JSON object (Content-Type: application/json)")
    unknown = sorted(set(body) - set(allowed))
    if unknown:
        raise KanbanError(f"unknown field(s): {', '.join(unknown)}; allowed: {', '.join(allowed)}")
    return body


def clean_title(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise KanbanError("title is required and must be a non-empty string")
    title = raw.strip()
    if len(title) > TITLE_MAX:
        raise KanbanError(f"title must be at most {TITLE_MAX} characters")
    return title


def clean_owner(raw):
    """Free-text owner; null or blank clears it."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise KanbanError("owner must be a string or null")
    owner = raw.strip()
    if len(owner) > OWNER_MAX:
        raise KanbanError(f"owner must be at most {OWNER_MAX} characters")
    return owner or None


def clean_opname(raw):
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise KanbanError("opname must be a string or null")
    opname = " ".join(raw.split())
    if len(opname) > OPNAME_MAX:
        raise KanbanError(f"opname must be at most {OPNAME_MAX} characters")
    return opname or None


def clean_body(raw):
    """Markdown body; null clears it. Stored verbatim (only \\r\\n -> \\n)."""
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise KanbanError("body must be a string (markdown) or null")
    body = raw.replace("\r\n", "\n")
    if len(body) > BODY_MAX:
        raise KanbanError(f"body must be at most {BODY_MAX} characters")
    return body if body.strip() else ""


def clean_docs(raw):
    """Doc prefixes this card points at; format checked, existence not.

    No count cap: a card may reference as many docs as it needs. Duplicates
    collapse; every entry must pass the docs prefix format check.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise KanbanError("docs must be a list of doc prefixes")
    from .docs import DocsError, clean_prefix

    refs, seen = [], set()
    for item in raw:
        if not isinstance(item, str):
            raise KanbanError("docs entries must be strings (doc prefixes)")
        try:
            prefix = clean_prefix(item)
        except DocsError as exc:
            raise KanbanError(f"docs: {exc.message}") from None
        if prefix in seen:
            continue
        seen.add(prefix)
        refs.append(prefix)
    return refs


def clean_status(raw):
    if isinstance(raw, bool) or not isinstance(raw, (str, int)) or not str(raw).strip():
        raise KanbanError("status must be a lane name (or lane id)")
    return raw


def clean_position(raw):
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        raise KanbanError("position must be a non-negative integer (0 = top)")
    return raw


def clean_lane_name(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise KanbanError("name is required and must be a non-empty string")
    name = " ".join(raw.split())
    if len(name) > LANE_NAME_MAX:
        raise KanbanError(f"name must be at most {LANE_NAME_MAX} characters")
    if name.isdigit():
        raise KanbanError("lane name cannot be only digits (it would clash with lane ids)")
    return name


def parse_card_id(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise KanbanError("card not found", 404) from None


def flag(params: dict, name: str) -> bool:
    raw = params.get(name)
    return raw is not None and raw.strip().lower() in TRUTHY


def filtered_board(params: dict, archived=None):
    """kanban.board() with the shared status/owner/opname/archived/body filters."""
    status = params.get("status")
    owner = params.get("owner")
    opname = params.get("opname")
    if archived is None:
        archived = "include" if flag(params, "include_archived") else "exclude"
    owner = owner.strip() if owner is not None else None
    opname = " ".join(opname.split()) if opname is not None else None
    return kanban.board(status or None, owner, archived, flag(params, "include_body"), opname)


async def _params(request: Request) -> dict:
    return dict(request.query_params)


@router.get("/api/opsboard")
@router.get("/api/kanban")
async def board_get(request: Request):
    """Lanes + cards; full markdown bodies only with include_body=1."""
    params = await _params(request)
    return await run_in_threadpool(filtered_board, params)


@router.get("/api/opsboard/cards")
@router.get("/api/kanban/cards")
async def cards_list(request: Request):
    params = await _params(request)
    return (await run_in_threadpool(filtered_board, params))["cards"]


@router.get("/api/opsboard/archived")
@router.get("/api/kanban/archived")
async def archived_list(request: Request):
    params = await _params(request)
    return (await run_in_threadpool(filtered_board, params, "only"))["cards"]


def _param_float(params: dict, key: str) -> float | None:
    raw = params.get(key)
    try:
        return float(raw) if raw is not None else None
    except (TypeError, ValueError):
        raise KanbanError(f"{key} must be a number") from None


def _semantic(params: dict):
    query = (params.get("q") or "").strip()
    if not query:
        raise KanbanError("q is required")
    archived = params.get("archived") or "exclude"
    if archived not in ("exclude", "include", "only"):
        raise KanbanError("archived must be one of: exclude, include, only")
    try:
        limit = max(1, min(int(params.get("limit", 15)), 200))
    except (TypeError, ValueError):
        raise KanbanError("limit must be a number") from None
    with db.get_db() as conn:
        status = params.get("status")
        lane_id = kanban.require_lane(conn, status)["id"] if status else None
        try:
            return kanban_embed.search(
                query,
                limit=limit,
                archived=archived,
                lane_id=lane_id,
                owner=params.get("owner") or None,
                opname=params.get("opname") or None,
                sort=params.get("sort") or "blend",
                conn=conn,
                min_score=_param_float(params, "min_score"),
                recency_weight=_param_float(params, "recency_weight"),
                recency_tau_days=_param_float(params, "recency_tau_days"),
            )
        except kanban_embed.EmbedError as exc:
            return JSONResponse(status_code=503, content={"error": str(exc), "available": False})


@router.get("/api/opsboard/semantic")
@router.get("/api/kanban/semantic")
async def opsboard_semantic(request: Request):
    """Meaning-based card search over the stored vectors."""
    return await run_in_threadpool(_semantic, await _params(request))


@router.post("/api/opsboard/reindex")
@router.post("/api/kanban/reindex")
async def opsboard_reindex():
    queued = await run_in_threadpool(kanban_embed.reindex_all)
    return {"queued": queued, "model": kanban_embed.config.EMBED_MODEL}


@router.get("/api/opsboard/opnames")
@router.get("/api/kanban/opnames")
async def opnames_list(request: Request):
    """Distinct opnames with counts; archived cards count by default."""
    raw = (await _params(request)).get("include_archived")
    archived = "exclude" if raw is not None and raw.strip().lower() not in TRUTHY else "include"
    return await run_in_threadpool(kanban.opnames, db.get_db(), archived)


@router.post("/api/opsboard/archive-done")
@router.post("/api/kanban/archive-done")
async def archive_done():
    return await run_in_threadpool(kanban.archive_lane, "Done")


@router.post("/api/opsboard/move-lane")
@router.post("/api/kanban/move-lane")
async def move_lane_route(request: Request):
    """Move every live card of one lane to the bottom of another, in order."""
    body = await json_body(request, ("from", "to"))
    names = []
    for key in ("from", "to"):
        raw = body.get(key)
        if not isinstance(raw, str) or not raw.strip():
            raise KanbanError(f"{key} is required and must be a non-empty lane name")
        names.append(raw.strip())
    return await run_in_threadpool(kanban.move_lane, names[0], names[1])


@router.post("/api/opsboard/cards")
@router.post("/api/kanban/cards")
async def card_create(request: Request):
    body = await json_body(
        request, ("title", "owner", "status", "position", "body", "opname", "docs")
    )
    status = clean_status(body["status"]) if body.get("status") not in (None, "") else None
    card = await run_in_threadpool(
        kanban.create_card,
        clean_title(body.get("title")),
        clean_owner(body.get("owner")),
        status,
        clean_position(body.get("position")),
        clean_body(body.get("body")),
        clean_opname(body.get("opname")),
        clean_docs(body.get("docs")),
    )
    return JSONResponse(status_code=201, content=card)


def _card_with_comments(raw_id):
    from .kanban_comments import comments

    conn, card_id = db.get_db(), parse_card_id(raw_id)
    return {
        **kanban.card(conn, card_id),
        "comments": comments(conn, card_id),
        "subtasks": kanban_subtasks.list_for(conn, card_id),
    }


@router.get("/api/opsboard/cards/{card_id}")
@router.get("/api/kanban/cards/{card_id}")
async def card_get(card_id: str):
    return await run_in_threadpool(_card_with_comments, card_id)


@router.patch("/api/opsboard/cards/{card_id}")
@router.patch("/api/kanban/cards/{card_id}")
async def card_patch(card_id: str, request: Request):
    card_id = parse_card_id(card_id)
    body = await json_body(
        request, ("title", "owner", "body", "opname", "status", "position", "archived", "docs")
    )
    if not body:
        raise KanbanError(
            "nothing to update; send any of title, owner, body, opname, status, position, archived"
        )
    changes = {}
    if "title" in body:
        changes["title"] = clean_title(body["title"])
    if "owner" in body:
        changes["owner"] = clean_owner(body["owner"])
    if "body" in body:
        changes["body"] = clean_body(body["body"])
    if "opname" in body:
        changes["opname"] = clean_opname(body["opname"])
    if "docs" in body:
        changes["docs"] = clean_docs(body["docs"])
    if "status" in body:
        changes["status"] = clean_status(body["status"])
    if "position" in body:
        changes["position"] = clean_position(body["position"])
    if "archived" in body:
        if not isinstance(body["archived"], bool):
            raise KanbanError("archived must be true or false")
        changes["archived"] = body["archived"]
    return await run_in_threadpool(kanban.update_card, card_id, changes)


@router.delete("/api/opsboard/cards/{card_id}")
@router.delete("/api/kanban/cards/{card_id}")
async def card_delete(card_id: str):
    card = await run_in_threadpool(kanban.delete_card, parse_card_id(card_id))
    return {"deleted": card["id"], "card": card}


@router.get("/api/opsboard/lanes")
@router.get("/api/kanban/lanes")
async def lanes_list():
    return await run_in_threadpool(kanban.lanes, db.get_db())


@router.post("/api/opsboard/lanes")
@router.post("/api/kanban/lanes")
async def lane_create(request: Request):
    body = await json_body(request, ("name", "position"))
    lane = await run_in_threadpool(
        kanban_lanes.create_lane,
        clean_lane_name(body.get("name")),
        clean_position(body.get("position")),
    )
    return JSONResponse(status_code=201, content=lane)


@router.patch("/api/opsboard/lanes/{lane_ref}")
@router.patch("/api/kanban/lanes/{lane_ref}")
async def lane_patch(lane_ref: str, request: Request):
    body = await json_body(request, ("name", "position"))
    if not body:
        raise KanbanError("nothing to update; send name and/or position")
    name = clean_lane_name(body["name"]) if "name" in body else None
    return await run_in_threadpool(
        kanban_lanes.update_lane, lane_ref, name, clean_position(body.get("position"))
    )


@router.delete("/api/opsboard/lanes/{lane_ref}")
@router.delete("/api/kanban/lanes/{lane_ref}")
async def lane_delete(lane_ref: str, request: Request):
    params = await _params(request)
    force = params.get("force")
    target = params.get("target") or params.get("move_to")
    return await run_in_threadpool(
        kanban_lanes.delete_lane,
        lane_ref,
        force=force is not None and force.lower() in TRUTHY,
        target=target or None,
    )
