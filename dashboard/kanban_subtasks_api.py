"""Subtask routes for Ops Board cards (FastAPI)."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import kanban_subtasks
from .kanban import KanbanError
from .kanban_api import clean_body, clean_docs, clean_status, clean_title, json_body, parse_card_id

router = APIRouter()


@router.get("/api/opsboard/cards/{card_id}/subtasks")
@router.get("/api/kanban/cards/{card_id}/subtasks")
async def subtasks_list(card_id: str, include_archived: str = ""):
    return await run_in_threadpool(
        kanban_subtasks.list_subtasks,
        parse_card_id(card_id),
        include_archived.strip().lower() in {"1", "true", "yes", "on"},
    )


@router.post("/api/opsboard/cards/{card_id}/subtasks")
@router.post("/api/kanban/cards/{card_id}/subtasks")
async def subtask_create(card_id: str, request: Request):
    body = await json_body(request, ("title", "body", "lane", "docs"))
    subtask = await run_in_threadpool(
        kanban_subtasks.create,
        parse_card_id(card_id),
        clean_title(body.get("title")),
        clean_body(body.get("body")),
        body.get("lane") or None,
        clean_docs(body.get("docs")) if body.get("docs") is not None else None,
    )
    return JSONResponse(status_code=201, content=subtask)


@router.patch("/api/opsboard/cards/{card_id}/subtasks/{subtask_id}")
@router.patch("/api/kanban/cards/{card_id}/subtasks/{subtask_id}")
async def subtask_update(card_id: str, subtask_id: str, request: Request):
    body = await json_body(request, ("title", "body", "lane", "docs", "archived"))
    changes = {}
    if "title" in body:
        changes["title"] = clean_title(body["title"])
    if "body" in body:
        changes["body"] = clean_body(body["body"])
    if "lane" in body:
        changes["status"] = clean_status(body["lane"])
    if "docs" in body:
        changes["docs"] = clean_docs(body["docs"])
    if "archived" in body:
        if not isinstance(body["archived"], bool):
            raise KanbanError("archived must be true or false")
        changes["archived"] = body["archived"]
    return await run_in_threadpool(
        kanban_subtasks.update, parse_card_id(card_id), parse_card_id(subtask_id), changes
    )


@router.delete("/api/opsboard/cards/{card_id}/subtasks/{subtask_id}")
@router.delete("/api/kanban/cards/{card_id}/subtasks/{subtask_id}")
async def subtask_delete(card_id: str, subtask_id: str):
    gone = await run_in_threadpool(
        kanban_subtasks.delete, parse_card_id(card_id), parse_card_id(subtask_id)
    )
    return {"deleted": gone["id"], "subtask": gone}
