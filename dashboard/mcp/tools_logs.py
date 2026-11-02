"""MCP tool: read the access log (one row per tools/call)."""

from .. import access_log
from .protocol import tool_spec

TOOLS = {
    "list_access_logs": {
        "spec": tool_spec(
            "list_access_logs",
            "List Access Logs",
            "Recent MCP invocations, newest first: timestamp, tool, entity id, "
            "outcome, duration and a trimmed argument summary. Use it to see what "
            "agents have been doing on this host, or to check whether a call landed.",
            {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 1000,
                    "default": 100,
                    "description": "Rows to return.",
                },
                "tool": {
                    "type": "string",
                    "description": "Only rows for this tool name (e.g. put_doc).",
                },
                "entity": {
                    "type": "string",
                    "description": "Only rows whose entity id contains this text.",
                },
                "ok": {
                    "type": "boolean",
                    "description": "true for successful calls only, false for failures only.",
                },
            },
            [],
            read_only=True,
        ),
        "handler": lambda args: access_log.list_entries(
            limit=args.get("limit") or 100,
            tool=args.get("tool") or None,
            entity=args.get("entity") or None,
            ok=args.get("ok") if isinstance(args.get("ok"), bool) else None,
        ),
    },
}
