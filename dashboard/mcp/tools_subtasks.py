"""MCP tools: board subtasks.

A subtask is a card with a parent: same storage, so it carries its own body,
comments and doc links, but it never appears on the board. Owner and opname are
inherited from the parent when the subtask is created.
"""

from .. import kanban_subtasks
from ..kanban import KanbanError
from ..kanban_api import clean_body, clean_docs, clean_status, clean_title, parse_card_id
from .protocol import ToolError, tool_spec

CARD_ID = {"type": "integer", "minimum": 1, "description": "Parent card id."}
SUBTASK_ID = {"type": "integer", "minimum": 1, "description": "Subtask card id."}
DOCS = {
    "type": "array",
    "items": {"type": "string"},
    "description": "Docs prefixes linked to this subtask (same format as cards).",
}


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except KanbanError as exc:
        raise ToolError(exc.message) from None


def list_subtasks(args):
    if "card_id" not in args:
        raise ToolError("card_id is required")
    return _wrap(
        kanban_subtasks.list_subtasks,
        parse_card_id(args["card_id"]),
        bool(args.get("include_archived")),
    )


def create_subtask(args):
    for key in ("card_id", "title"):
        if key not in args:
            raise ToolError(f"{key} is required")
    return _wrap(
        kanban_subtasks.create,
        parse_card_id(args["card_id"]),
        clean_title(args["title"]),
        clean_body(args.get("body")),
        args.get("lane") or None,
        clean_docs(args.get("docs")) if args.get("docs") is not None else None,
    )


def update_subtask(args):
    for key in ("card_id", "subtask_id"):
        if key not in args:
            raise ToolError(f"{key} is required")
    changes = {}
    if "title" in args:
        changes["title"] = clean_title(args["title"])
    if "body" in args:
        changes["body"] = clean_body(args["body"])
    if "lane" in args:
        changes["status"] = clean_status(args["lane"])
    if "docs" in args:
        changes["docs"] = clean_docs(args["docs"])
    if "archived" in args:
        if not isinstance(args["archived"], bool):
            raise ToolError("archived must be true or false")
        changes["archived"] = args["archived"]
    return _wrap(
        kanban_subtasks.update,
        parse_card_id(args["card_id"]),
        parse_card_id(args["subtask_id"]),
        changes,
    )


def delete_subtask(args):
    for key in ("card_id", "subtask_id"):
        if key not in args:
            raise ToolError(f"{key} is required")
    return _wrap(
        kanban_subtasks.delete,
        parse_card_id(args["card_id"]),
        parse_card_id(args["subtask_id"]),
    )


TOOLS = {
    "list_subtasks": {
        "spec": tool_spec(
            "list_subtasks",
            "List subtasks",
            "Subtasks of one card, oldest first, each with its lane, owner (inherited), "
            "body, docs and comment count.",
            {
                "card_id": CARD_ID,
                "include_archived": {"type": "boolean"},
            },
            ["card_id"],
            read_only=True,
        ),
        "handler": list_subtasks,
    },
    "create_subtask": {
        "spec": tool_spec(
            "create_subtask",
            "Create subtask",
            "Add a subtask under a card. Subtasks never appear on the board. Owner and "
            "opname are copied from the parent at creation; lane defaults to the parent's "
            "lane. The subtask has its own body, comments (use the card comment tools with "
            "its id) and doc links.",
            {
                "card_id": CARD_ID,
                "title": {"type": "string", "description": "Subtask title, max 500 chars."},
                "body": {
                    "type": "string",
                    "description": "Markdown body, same rules as cards.",
                },
                "lane": {
                    "type": "string",
                    "description": "Lane name or id; omit to inherit the parent's lane.",
                },
                "docs": DOCS,
            },
            ["card_id", "title"],
        ),
        "handler": create_subtask,
    },
    "update_subtask": {
        "spec": tool_spec(
            "update_subtask",
            "Update subtask",
            "Patch a subtask's title, body, lane, docs or archived flag. Owner and opname "
            "stay as inherited from the parent.",
            {
                "card_id": CARD_ID,
                "subtask_id": SUBTASK_ID,
                "title": {"type": "string"},
                "body": {"type": "string"},
                "lane": {"type": "string"},
                "docs": DOCS,
                "archived": {"type": "boolean"},
            },
            ["card_id", "subtask_id"],
        ),
        "handler": update_subtask,
    },
    "delete_subtask": {
        "spec": tool_spec(
            "delete_subtask",
            "Delete subtask",
            "Remove a subtask with its comments and doc links. The parent card stays.",
            {"card_id": CARD_ID, "subtask_id": SUBTASK_ID},
            ["card_id", "subtask_id"],
            destructive=True,
        ),
        "handler": delete_subtask,
    },
}
