"""MCP tools: Ops Board lanes (columns)."""

from .. import db, kanban, kanban_lanes
from ..kanban_api import clean_lane_name, clean_position
from .protocol import ToolError, tool_spec

LANE_REF = {"type": "string", "description": "Lane name (case-insensitive) or numeric lane id."}
POSITION = {"type": "integer", "minimum": 0, "description": "0-based column order; 0 = leftmost."}


def list_lanes(args):
    with db.get_db() as conn:
        return {"lanes": kanban.lanes(conn)}


def create_lane(args):
    if "name" not in args:
        raise ToolError("name is required")
    return kanban_lanes.create_lane(
        clean_lane_name(args["name"]),
        clean_position(args.get("position")),
    )


def update_lane(args):
    if "lane" not in args:
        raise ToolError("lane is required")
    name = clean_lane_name(args["name"]) if "name" in args else None
    position = clean_position(args.get("position")) if "position" in args else None
    if name is None and position is None:
        raise ToolError("nothing to update: pass name and/or position")
    return kanban_lanes.update_lane(args["lane"], name=name, position=position)


def delete_lane(args):
    if "lane" not in args:
        raise ToolError("lane is required")
    return kanban_lanes.delete_lane(
        args["lane"],
        force=bool(args.get("force")),
        target=args.get("target"),
    )


TOOLS = {
    "list_lanes": {
        "spec": tool_spec(
            "list_lanes",
            "List lanes",
            "Board columns in display order with live and archived card counts.",
            read_only=True,
        ),
        "handler": list_lanes,
    },
    "create_lane": {
        "spec": tool_spec(
            "create_lane",
            "Create a lane",
            "Add a column. Names are unique case-insensitively, max 60 chars, not all digits.",
            {
                "name": {"type": "string", "description": "Column name, e.g. 'Review'."},
                "position": POSITION,
            },
            ["name"],
        ),
        "handler": create_lane,
    },
    "update_lane": {
        "spec": tool_spec(
            "update_lane",
            "Update a lane",
            "Rename a column and/or move it. Cards follow a rename automatically.",
            {"lane": LANE_REF, "name": {"type": "string"}, "position": POSITION},
            ["lane"],
        ),
        "handler": update_lane,
    },
    "delete_lane": {
        "spec": tool_spec(
            "delete_lane",
            "Delete a lane",
            "Delete a column. Cards block it unless target names a lane to move them to, "
            "or force deletes them too. Don't delete lanes unless asked.",
            {
                "lane": LANE_REF,
                "target": {"type": "string", "description": "Lane that receives the cards."},
                "force": {
                    "type": "boolean",
                    "default": False,
                    "description": "Delete the lane's cards instead of moving them.",
                },
            },
            ["lane"],
            destructive=True,
        ),
        "handler": delete_lane,
    },
}
