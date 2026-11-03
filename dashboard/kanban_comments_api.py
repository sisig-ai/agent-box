"""Ops Board card comments (FastAPI).

GET    /api/opsboard/cards/:id/comments
POST   /api/opsboard/cards/:id/comments {author, body}
DELETE /api/opsboard/cards/:id/comments/:commentId
(/api/kanban/... aliases too.)
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import db, kanban_comments
from .kanban import KanbanError
from .kanban_api import json_body, parse_card_id

router = APIRouter()

AUTHOR_MAX = 100
COMMENT_MAX = 20_000


def clean_author(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise KanbanError("author is required and must be a non-empty string")
    author = " ".join(raw.split())
    if len(author) > AUTHOR_MAX:
        raise KanbanError(f"author must be at most {AUTHOR_MAX} characters")
    return author


def clean_comment(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise KanbanError("body is required and must be a non-empty string (markdown)")
    body = raw.replace("\r\n", "\n").strip("\n")
    if len(body) > COMMENT_MAX:
        raise KanbanError(f"body must be at most {COMMENT_MAX} characters")
    return body


def parse_comment_id(raw):
    if not str(raw).isdigit():
        raise KanbanError("comment not found", 404)
    return int(raw)


@router.get("/api/opsboard/cards/{card_id}/comments")
@router.get("/api/kanban/cards/{card_id}/comments")
async def comments_list(card_id: str):
    cid = parse_card_id(card_id)
    return await run_in_threadpool(kanban_comments.comments, db.get_db(), cid)


@router.post("/api/opsboard/cards/{card_id}/comments")
@router.post("/api/kanban/cards/{card_id}/comments")
async def comment_create(card_id: str, request: Request):
    cid = parse_card_id(card_id)
    body = await json_body(request, ("author", "body"))
    comment = await run_in_threadpool(
        kanban_comments.add_comment,
        cid,
        clean_author(body.get("author")),
        clean_comment(body.get("body")),
    )
    return JSONResponse(status_code=201, content=comment)


@router.delete("/api/opsboard/cards/{card_id}/comments/{comment_id}")
@router.delete("/api/kanban/cards/{card_id}/comments/{comment_id}")
async def comment_delete(card_id: str, comment_id: str):
    gone = await run_in_threadpool(
        kanban_comments.delete_comment, parse_card_id(card_id), parse_comment_id(comment_id)
    )
    return {"deleted": gone["id"], "comment": gone}
