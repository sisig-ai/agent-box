"""HTTP blueprint for Progress Bars.

Canonical: /api/progress. No auth, same as the rest of the dashboard: local
stack, tailnet only. Errors are JSON ``{"error": "..."}`` with 400 / 404 / 409.
"""

from flask import Blueprint, jsonify, request

from . import progress
from .progress import ProgressError

bp = Blueprint("progress", __name__)

CREATE_FIELDS = ("title", "percent", "parent_id", "fields", "owner", "position")
UPDATE_FIELDS = CREATE_FIELDS + ("add_fields", "remove_fields", "archived")
TRUTHY = {"1", "true", "yes", "on"}


@bp.errorhandler(ProgressError)
def progress_error(exc):
    return jsonify({"error": exc.message}), exc.status


def json_body(allowed):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ProgressError("request body must be a JSON object (Content-Type: application/json)")
    unknown = sorted(set(body) - set(allowed))
    if unknown:
        raise ProgressError(
            f"unknown field(s): {', '.join(unknown)}; allowed: {', '.join(allowed)}"
        )
    return body


@bp.get("/api/progress")
def progress_list():
    """GET /api/progress — roots with nested children (children always included).

    ``?archived=exclude`` (default) hides archived bars and their subtree,
    ``include`` returns everything, ``only`` returns the archived tree.
    """
    mode = progress.clean_archived(request.args.get("archived"))
    bars = progress.tree(mode)
    _live, archived = progress.counts()
    return jsonify({"bars": bars, "count": progress.count(mode), "archived_count": archived})


@bp.get("/api/progress/flat")
def progress_flat():
    """GET /api/progress/flat — every bar in one list (no children nesting)."""
    mode = progress.clean_archived(request.args.get("archived"))
    bars = progress.flat(mode)
    _live, archived = progress.counts()
    return jsonify({"bars": bars, "count": len(bars), "archived_count": archived})


@bp.get("/api/progress/<int:bar_id>")
def progress_get(bar_id):
    bar = progress.fetch(bar_id)
    if bar is None:
        raise ProgressError(f"no progress bar with id {bar_id}", 404)
    return jsonify(bar)


@bp.post("/api/progress")
def progress_create():
    body = json_body(CREATE_FIELDS)
    if "title" not in body:
        raise ProgressError("title is required")
    bar = progress.create(
        body["title"],
        percent=body.get("percent"),
        parent_id=body.get("parent_id"),
        fields=body.get("fields"),
        owner=body.get("owner"),
        position=body.get("position"),
    )
    return jsonify(bar), 201


@bp.patch("/api/progress/<int:bar_id>")
def progress_update(bar_id):
    body = json_body(UPDATE_FIELDS)
    archived = body.pop("archived", None)
    if archived is not None and not isinstance(archived, bool):
        raise ProgressError("archived must be true or false")
    bar = progress.update(bar_id, body) if body else progress.fetch(bar_id)
    if archived is not None:
        bar = progress.archive(bar_id, archived)
    if bar is None:
        raise ProgressError(f"no progress bar with id {bar_id}", 404)
    return jsonify(bar)


@bp.delete("/api/progress/<int:bar_id>")
def progress_delete(bar_id):
    cascade = str(request.args.get("cascade", "")).lower() in TRUTHY
    deleted = progress.delete(bar_id, cascade=cascade)
    return jsonify({"deleted": bar_id, "deleted_count": deleted})
