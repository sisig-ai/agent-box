"""MCP tools: Daily Sitrep and Weekly Schedule markdown notes."""

from .. import notes
from ..dates import normalize_date, normalize_week
from .protocol import ToolError, tool_spec

SITREP_LIST_DEFAULT, SITREP_LIST_MAX = 30, 365
SCHEDULE_LIST_DEFAULT, SCHEDULE_LIST_MAX = 20, 104

DATE = {
    "type": "string",
    "description": "YYYY-MM-DD in Manila time; omit for today.",
}
WEEK = {
    "type": "string",
    "description": "Any YYYY-MM-DD in the week; coerced to that week's Monday. Omit for this week.",
}
CONTENT = {
    "type": "string",
    "description": "Markdown. Actionable sitrep items belong on their own '- [ ] ' task lines.",
}


def _date(raw):
    value = normalize_date(raw)
    if value is None:
        raise ToolError("date must be YYYY-MM-DD")
    return value


def _week(raw):
    value = normalize_week(raw)
    if value is None:
        raise ToolError("week must be YYYY-MM-DD")
    return value


def _content(args):
    raw = args.get("content")
    if not isinstance(raw, str):
        raise ToolError("content must be a markdown string")
    return raw


def _limit(args, default, maximum):
    raw = args.get("limit")
    if raw is None:
        return default
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        raise ToolError("limit must be a positive integer")
    return min(raw, maximum)


# ---------------- Daily Sitrep ----------------


def get_sitrep(args):
    date = _date(args.get("date"))
    return notes.fetch_brief(date) or {"date": date, "content": ""}


def list_sitreps(args):
    return {"sitreps": notes.list_briefs(_limit(args, SITREP_LIST_DEFAULT, SITREP_LIST_MAX))}


def put_sitrep(args):
    return notes.upsert_brief(_date(args.get("date")), _content(args))


def delete_sitrep(args):
    date = _date(args.get("date"))
    if not notes.delete_brief(date):
        raise ToolError(f"no sitrep entry for {date}")
    return {"deleted": date}


# ---------------- Weekly Schedule ----------------


def get_schedule(args):
    week = _week(args.get("week"))
    return notes.fetch_schedule(week) or {"week_start": week, "content": ""}


def list_schedules(args):
    limit = _limit(args, SCHEDULE_LIST_DEFAULT, SCHEDULE_LIST_MAX)
    return {"schedules": notes.list_schedules(limit)}


def put_schedule(args):
    return notes.upsert_schedule(_week(args.get("week")), _content(args))


def delete_schedule(args):
    week = _week(args.get("week"))
    if not notes.delete_schedule(week):
        raise ToolError(f"no schedule entry for week {week}")
    return {"deleted": week}


TOOLS = {
    "get_sitrep": {
        "spec": tool_spec(
            "get_sitrep",
            "Get the Daily Sitrep",
            "One day's sitrep markdown. Returns empty content when no entry exists yet.",
            {"date": DATE},
            read_only=True,
        ),
        "handler": get_sitrep,
    },
    "list_sitreps": {
        "spec": tool_spec(
            "list_sitreps",
            "List Daily Sitreps",
            "Recent sitrep entries, newest first.",
            {"limit": {"type": "integer", "minimum": 1, "maximum": SITREP_LIST_MAX}},
            read_only=True,
        ),
        "handler": list_sitreps,
    },
    "put_sitrep": {
        "spec": tool_spec(
            "put_sitrep",
            "Write the Daily Sitrep",
            "Create or replace a day's sitrep. Read it first and keep already-ticked "
            "'- [x]' items ticked when rewriting.",
            {"date": DATE, "content": CONTENT},
            ["content"],
        ),
        "handler": put_sitrep,
    },
    "delete_sitrep": {
        "spec": tool_spec(
            "delete_sitrep",
            "Delete the Daily Sitrep",
            "Remove one day's sitrep entry.",
            {"date": DATE},
            destructive=True,
        ),
        "handler": delete_sitrep,
    },
    "get_schedule": {
        "spec": tool_spec(
            "get_schedule",
            "Get the weekly schedule",
            "One week's schedule markdown, keyed by that week's Monday.",
            {"week": WEEK},
            read_only=True,
        ),
        "handler": get_schedule,
    },
    "list_schedules": {
        "spec": tool_spec(
            "list_schedules",
            "List weekly schedules",
            "Recent schedule entries, newest week first.",
            {"limit": {"type": "integer", "minimum": 1, "maximum": SCHEDULE_LIST_MAX}},
            read_only=True,
        ),
        "handler": list_schedules,
    },
    "put_schedule": {
        "spec": tool_spec(
            "put_schedule",
            "Write the weekly schedule",
            "Create or replace the schedule for a week (any date in that week).",
            {"week": WEEK, "content": CONTENT},
            ["content"],
        ),
        "handler": put_schedule,
    },
    "delete_schedule": {
        "spec": tool_spec(
            "delete_schedule",
            "Delete the weekly schedule",
            "Remove one week's schedule entry.",
            {"week": WEEK},
            destructive=True,
        ),
        "handler": delete_schedule,
    },
}
