"""HTTP routes for Ops Board card comments (registered on the kanban blueprint).

GET    /api/opsboard/cards/:id/comments             -> [comment, ...] oldest first
POST   /api/opsboard/cards/:id/comments {author, body} -> 201 + comment
DELETE /api/opsboard/cards/:id/comments/:commentId  -> {"deleted": id, "comment": {...}}
(/api/kanban/... aliases too.)
"""

from flask import jsonify

from . import db, kanban_comments
from .kanban import KanbanError
from .kanban_api import bp, json_body, parse_card_id

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


@bp.get("/api/opsboard/cards/<card_id>/comments")
@bp.get("/api/kanban/cards/<card_id>/comments")
def comments_list(card_id):
    return jsonify(kanban_comments.comments(db.get_db(), parse_card_id(card_id)))


@bp.post("/api/opsboard/cards/<card_id>/comments")
@bp.post("/api/kanban/cards/<card_id>/comments")
def comment_create(card_id):
    card_id = parse_card_id(card_id)
    body = json_body(("author", "body"))
    comment = kanban_comments.add_comment(
        card_id, clean_author(body.get("author")), clean_comment(body.get("body"))
    )
    return jsonify(comment), 201


@bp.delete("/api/opsboard/cards/<card_id>/comments/<comment_id>")
@bp.delete("/api/kanban/cards/<card_id>/comments/<comment_id>")
def comment_delete(card_id, comment_id):
    gone = kanban_comments.delete_comment(parse_card_id(card_id), parse_comment_id(comment_id))
    return jsonify({"deleted": gone["id"], "comment": gone})
