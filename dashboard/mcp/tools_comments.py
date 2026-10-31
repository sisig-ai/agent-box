"""MCP tools: card comment threads."""

from .. import db, kanban_comments
from .protocol import ToolError, tool_spec

CARD_ID = {
    "type": "integer",
    "minimum": 1,
    "description": "Card id (the number in #/kanban/card-<id>).",
}
AUTHOR_MAX = 100
COMMENT_MAX = 20000


def _card_id(args):
    raw = args.get("card_id")
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ToolError("card_id must be the card's integer id")
    return raw


def list_comments(args):
    card_id = _card_id(args)
    with db.get_db() as conn:
        return {"comments": kanban_comments.comments(conn, card_id)}


def add_comment(args):
    card_id = _card_id(args)
    author = args.get("author")
    body = args.get("body")
    if not isinstance(author, str) or not author.strip():
        raise ToolError("author is required (use your agent name)")
    if not isinstance(body, str) or not body.strip():
        raise ToolError("body is required (markdown)")
    author = author.strip()
    if len(author) > AUTHOR_MAX:
        raise ToolError(f"author must be at most {AUTHOR_MAX} characters")
    if len(body) > COMMENT_MAX:
        raise ToolError(f"body must be at most {COMMENT_MAX} characters")
    return kanban_comments.add_comment(card_id, author, body)


def delete_comment(args):
    card_id = _card_id(args)
    raw = args.get("comment_id")
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ToolError("comment_id must be an integer")
    return {"deleted": kanban_comments.delete_comment(card_id, raw)}


TOOLS = {
    "list_comments": {
        "spec": tool_spec(
            "list_comments",
            "List card comments",
            "A card's comment thread, oldest first.",
            {"card_id": CARD_ID},
            ["card_id"],
            read_only=True,
        ),
        "handler": list_comments,
    },
    "add_comment": {
        "spec": tool_spec(
            "add_comment",
            "Add a card comment",
            "Append a timestamped progress note to a card. Prefer this over rewriting "
            "the body for short updates.",
            {
                "card_id": CARD_ID,
                "author": {"type": "string", "description": "Agent or person name, max 100 chars."},
                "body": {"type": "string", "description": "Markdown, max 20,000 chars."},
            },
            ["card_id", "author", "body"],
        ),
        "handler": add_comment,
    },
    "delete_comment": {
        "spec": tool_spec(
            "delete_comment",
            "Delete a card comment",
            "Remove one comment from a card's thread.",
            {
                "card_id": CARD_ID,
                "comment_id": {"type": "integer", "minimum": 1, "description": "Comment id."},
            },
            ["card_id", "comment_id"],
            destructive=True,
        ),
        "handler": delete_comment,
    },
}
