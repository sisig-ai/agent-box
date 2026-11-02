"""HTTP blueprint for the MCP access log.

Canonical: ``/api/logs``. One row per ``tools/call``: timestamp, tool (action),
entity id, outcome, duration and a trimmed argument summary.
"""

from flask import Blueprint, jsonify, request

from . import access_log
from .access_log import LogError

bp = Blueprint("logs", __name__)


@bp.errorhandler(LogError)
def log_error(exc):
    return jsonify({"error": exc.message}), exc.status


@bp.get("/api/logs")
def logs_list():
    """GET /api/logs?limit=200&tool=&entity=&ok=1 — newest first."""
    ok_param = request.args.get("ok")
    ok = None
    if ok_param in ("0", "1"):
        ok = ok_param == "1"
    try:
        limit = int(request.args.get("limit", 200))
    except (TypeError, ValueError):
        raise LogError("limit must be a number") from None
    return jsonify(
        access_log.list_entries(
            limit=limit,
            tool=request.args.get("tool") or None,
            entity=request.args.get("entity") or None,
            ok=ok,
        )
    )
