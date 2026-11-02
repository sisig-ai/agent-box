"""MCP server for the Macmini control surface.

Streamable HTTP transport, stateless: one POST per JSON-RPC message (batches
also accepted) at ``/mcp``. There is no session id and no server-initiated
stream, so GET and DELETE answer 405 as the spec allows for such a server.
"""

import json

from flask import Blueprint, Response, request

from ..kanban import KanbanError
from ..progress import ProgressError
from . import protocol, registry
from .protocol import INVALID_PARAMS, RpcError, ToolError

bp = Blueprint("mcp", __name__)

SERVER_INFO = {
    "name": "macmini-control",
    "title": "Macmini Control Surface",
    "version": "1.0.0",
}

INSTRUCTIONS = (
    "Tools for Kix's macmini home server: an Ops Board (kanban lanes, cards with "
    "markdown bodies, threaded comments, operation names), a Daily Sitrep "
    "(one markdown entry per day in Asia/Manila) plus its weekly schedule, and "
    "shared Progress Bars (nested 0-100 bars with arbitrary k-v fields) for "
    "tracking batches and jobs visually. Dates are YYYY-MM-DD in Manila time and "
    "default to today. Use your agent name as owner/author so work stays "
    "attributable, prefer comments for short progress notes, and keep card bodies "
    "in the Goal / Context / Progress / Next steps shape. Move finished cards to "
    "Done rather than deleting them, and only archive lanes or delete things when "
    "the user asks."
)


def _json(payload, status=200):
    body = json.dumps(payload, ensure_ascii=False)
    return Response(body, status=status, mimetype="application/json")


def _error_content(message):
    return {"content": [{"type": "text", "text": message}], "isError": True}


def _initialize(request_id, params):
    version = protocol.negotiate_version(params.get("protocolVersion"))
    return protocol.result(
        request_id,
        {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": INSTRUCTIONS,
        },
    )


def _tool_result(request_id, data):
    text = json.dumps(data, ensure_ascii=False, indent=2, default=str)
    payload = {"content": [{"type": "text", "text": text}]}
    if isinstance(data, dict):
        payload["structuredContent"] = data
    return protocol.result(request_id, payload)


def _call_tool(request_id, params):
    name = params.get("name")
    arguments = params.get("arguments") or {}
    if not isinstance(name, str) or not name:
        raise RpcError(INVALID_PARAMS, "tools/call needs a tool name")
    if not isinstance(arguments, dict):
        raise RpcError(INVALID_PARAMS, "arguments must be a JSON object")
    try:
        data = registry.call(name, arguments)
    except ToolError as exc:
        return protocol.result(request_id, _error_content(str(exc)))
    except KanbanError as exc:
        return protocol.result(request_id, _error_content(exc.message))
    except ProgressError as exc:
        return protocol.result(request_id, _error_content(exc.message))
    return _tool_result(request_id, data)


def handle(message):
    """One JSON-RPC message -> reply dict, or None for a notification."""
    if not isinstance(message, dict):
        raise RpcError(protocol.INVALID_REQUEST, "each message must be a JSON-RPC object")
    request_id = message.get("id")
    method = message.get("method")
    params = message.get("params") or {}
    if not isinstance(method, str):
        raise RpcError(protocol.INVALID_REQUEST, "method must be a string")
    if not isinstance(params, dict):
        raise RpcError(protocol.INVALID_PARAMS, "params must be an object")
    if method.startswith("notifications/"):
        return None
    if method == "initialize":
        return _initialize(request_id, params)
    if method == "ping":
        return protocol.result(request_id, {})
    if method == "tools/list":
        return protocol.result(request_id, {"tools": registry.definitions()})
    if method == "tools/call":
        return _call_tool(request_id, params)
    raise RpcError(protocol.METHOD_NOT_FOUND, f"unknown method: {method}")


def _reply(message):
    request_id = message.get("id") if isinstance(message, dict) else None
    try:
        return handle(message)
    except RpcError as exc:
        return exc.payload(request_id)


@bp.post("/mcp")
def mcp_post():
    payload = request.get_json(silent=True)
    if payload is None:
        error = RpcError(protocol.PARSE_ERROR, "body must be JSON-RPC (application/json)")
        return _json(error.payload(None), 400)
    if isinstance(payload, list):
        if not payload:
            error = RpcError(protocol.INVALID_REQUEST, "empty batch")
            return _json(error.payload(None), 400)
        replies = [reply for reply in (_reply(item) for item in payload) if reply is not None]
        if not replies:
            return Response(status=202)
        return _json(replies)
    if not isinstance(payload, dict):
        error = RpcError(protocol.INVALID_REQUEST, "message must be a JSON object")
        return _json(error.payload(None), 400)
    reply = _reply(payload)
    if reply is None:
        return Response(status=202)
    return _json(reply)


@bp.get("/mcp")
def mcp_get():
    return _json({"error": "stateless MCP server: POST JSON-RPC to /mcp"}, 405)


@bp.delete("/mcp")
def mcp_delete():
    return _json({"error": "no MCP sessions to delete"}, 405)
