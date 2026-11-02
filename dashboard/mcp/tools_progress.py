"""MCP tools: Progress Bars (nested percentage bars with k-v fields)."""

from .. import progress
from ..progress import ProgressError
from .protocol import ToolError, tool_spec

BAR_ID = {
    "type": "integer",
    "minimum": 1,
    "description": "Progress bar id.",
}
PARENT = {
    "type": ["integer", "null"],
    "description": (
        "Parent bar id, or null/omitted for a top-level bar. Children render "
        "nested under their parent; nesting is capped at 8 levels."
    ),
}
PERCENT = {
    "type": "number",
    "minimum": 0,
    "maximum": 100,
    "description": "Completion, 0-100. Fractions are kept (e.g. 37.4).",
}
FIELDS = {
    "type": "object",
    "additionalProperties": {"type": ["string", "number", "boolean", "null"]},
    "description": (
        'Arbitrary key/value pairs shown on the card (e.g. {"done": 374, '
        '"total": 1000, "cost": "$18.00"}). At most 100 fields; values are '
        "plain strings or numbers."
    ),
}
OWNER = {
    "type": "string",
    "description": "Owner tag, usually the agent name. Null or '' clears it.",
}
POSITION = {
    "type": "integer",
    "minimum": 0,
    "description": "0-based order among siblings; omitted appends at the end.",
}
ARCHIVED = {
    "type": "boolean",
    "description": (
        "true archives this bar and every bar nested under it (hidden from the "
        "default listing, data kept); false restores that subtree. Reversible."
    ),
}
LIST_ARCHIVED = {
    "type": "string",
    "enum": ["exclude", "include", "only"],
    "default": "exclude",
    "description": (
        "exclude (default) returns live bars, include returns both, only returns "
        "the archived tree. Archived bars keep their nested children."
    ),
}


def _bar_id(args):
    raw = args.get("id")
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ToolError("id must be the progress bar's integer id")
    return raw


def list_progress_bars(args):
    try:
        mode = progress.clean_archived(args.get("archived"))
        bars = progress.flat(mode) if args.get("flat") else progress.tree(mode)
        _live, archived = progress.counts()
    except ProgressError as exc:
        raise ToolError(exc.message) from None
    return {
        "bars": bars,
        "count": progress.count(mode),
        "archived_count": archived,
    }


def get_progress_bar(args):
    bar = progress.fetch(_bar_id(args))
    if bar is None:
        raise ToolError(f"no progress bar with id {args.get('id')}")
    return bar


def create_progress_bar(args):
    try:
        return progress.create(
            args.get("title"),
            percent=args.get("percent"),
            parent_id=args.get("parent_id"),
            fields=args.get("fields"),
            owner=args.get("owner"),
            position=args.get("position"),
        )
    except ProgressError as exc:
        raise ToolError(exc.message) from None


def update_progress_bar(args):
    keys = (
        "title",
        "percent",
        "parent_id",
        "fields",
        "add_fields",
        "remove_fields",
        "owner",
        "position",
    )
    changes = {key: args[key] for key in keys if key in args}
    archived = args.get("archived")
    if not changes and archived is None:
        raise ToolError("nothing to update: pass at least one field")
    if archived is not None and not isinstance(archived, bool):
        raise ToolError("archived must be true or false")
    bar = None
    try:
        if changes:
            bar = progress.update(_bar_id(args), changes)
        if archived is not None:
            bar = progress.archive(_bar_id(args), archived)
    except ProgressError as exc:
        raise ToolError(exc.message) from None
    if bar is None:
        raise ToolError(f"no progress bar with id {args.get('id')}")
    return bar


def delete_progress_bar(args):
    cascade = bool(args.get("cascade"))
    try:
        deleted = progress.delete(_bar_id(args), cascade=cascade)
    except ProgressError as exc:
        raise ToolError(exc.message) from None
    return {"deleted": args.get("id"), "deleted_count": deleted}


TOOLS = {
    "list_progress_bars": {
        "spec": tool_spec(
            "list_progress_bars",
            "List Progress Bars",
            "Every Progress Bar, roots first with nested children (pass flat=true for "
            "one list). Bars carry title, percent (0-100), owner, arbitrary k-v "
            "fields, and child_count. Archived bars are excluded by default; pass "
            "archived='include' or 'only' to see them.",
            {
                "flat": {
                    "type": "boolean",
                    "default": False,
                    "description": "Return every bar in one flat list instead of a tree.",
                },
                "archived": LIST_ARCHIVED,
            },
            read_only=True,
        ),
        "handler": list_progress_bars,
    },
    "get_progress_bar": {
        "spec": tool_spec(
            "get_progress_bar",
            "Get a Progress Bar",
            "One bar with its nested children and fields.",
            {"id": BAR_ID},
            ["id"],
            read_only=True,
        ),
        "handler": get_progress_bar,
    },
    "create_progress_bar": {
        "spec": tool_spec(
            "create_progress_bar",
            "Create a Progress Bar",
            "Create a bar. Use parent_id to nest it under another bar (e.g. a "
            "budget child under a batch's completion bar). Use fields for any "
            "extra stats worth showing on the card.",
            {
                "title": {"type": "string", "description": "Short label for the bar."},
                "percent": PERCENT,
                "parent_id": PARENT,
                "fields": FIELDS,
                "owner": OWNER,
                "position": POSITION,
            },
            ["title"],
        ),
        "handler": create_progress_bar,
    },
    "update_progress_bar": {
        "spec": tool_spec(
            "update_progress_bar",
            "Update a Progress Bar",
            "Change any of title, percent, owner, parent_id or position. fields "
            "replaces the whole k-v map; add_fields merges keys; remove_fields "
            "drops keys. Set archived=true to hide this bar and its nested bars, "
            "or false to restore them. This is the tool to call as work progresses.",
            {
                "id": BAR_ID,
                "title": {"type": "string", "description": "New short label."},
                "percent": PERCENT,
                "parent_id": PARENT,
                "fields": FIELDS,
                "add_fields": FIELDS,
                "remove_fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Field names to delete.",
                },
                "owner": OWNER,
                "position": POSITION,
                "archived": ARCHIVED,
            },
            ["id"],
        ),
        "handler": update_progress_bar,
    },
    "delete_progress_bar": {
        "spec": tool_spec(
            "delete_progress_bar",
            "Delete a Progress Bar",
            "Delete a bar. If it has nested bars, pass cascade=true to delete the "
            "whole subtree; without it the call is refused with the child count.",
            {"id": BAR_ID, "cascade": {"type": "boolean", "default": False}},
            ["id"],
            destructive=True,
        ),
        "handler": delete_progress_bar,
    },
}
