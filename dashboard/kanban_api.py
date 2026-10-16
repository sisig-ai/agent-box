"""HTTP blueprint for the Kanban board (lanes + cards).

No auth, same as the rest of the dashboard: local stack, tailnet only.
Errors are JSON ``{"error": "..."}`` with a 400 / 404 / 409 status.
"""

from flask import Blueprint, jsonify, request

from . import kanban
from .kanban import KanbanError

bp = Blueprint("kanban", __name__)

TITLE_MAX = 500
OWNER_MAX = 100
LANE_NAME_MAX = 60
TRUTHY = {"1", "true", "yes", "on", ""}


@bp.errorhandler(KanbanError)
def kanban_error(exc):
    return jsonify({"error": exc.message}), exc.status


def json_body(allowed):
    """The request's JSON object, rejecting non-objects and unknown keys."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise KanbanError("request body must be a JSON object (Content-Type: application/json)")
    unknown = sorted(set(body) - set(allowed))
    if unknown:
        raise KanbanError(f"unknown field(s): {', '.join(unknown)}; allowed: {', '.join(allowed)}")
    return body


def clean_title(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise KanbanError("title is required and must be a non-empty string")
    title = raw.strip()
    if len(title) > TITLE_MAX:
        raise KanbanError(f"title must be at most {TITLE_MAX} characters")
    return title


def clean_owner(raw):
    """Free-text owner; null or blank clears it."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise KanbanError("owner must be a string or null")
    owner = raw.strip()
    if len(owner) > OWNER_MAX:
        raise KanbanError(f"owner must be at most {OWNER_MAX} characters")
    return owner or None


def clean_status(raw):
    if isinstance(raw, bool) or not isinstance(raw, (str, int)) or not str(raw).strip():
        raise KanbanError("status must be a lane name (or lane id)")
    return raw


def clean_position(raw):
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        raise KanbanError("position must be a non-negative integer (0 = top)")
    return raw


def clean_lane_name(raw):
    if not isinstance(raw, str) or not raw.strip():
        raise KanbanError("name is required and must be a non-empty string")
    name = " ".join(raw.split())
    if len(name) > LANE_NAME_MAX:
        raise KanbanError(f"name must be at most {LANE_NAME_MAX} characters")
    if name.isdigit():
        raise KanbanError("lane name cannot be only digits (it would clash with lane ids)")
    return name


def parse_card_id(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise KanbanError("card not found", 404) from None


# ---------------- board ----------------


@bp.get("/api/kanban")
def board_get():
    """GET /api/kanban?status=&owner= — all lanes plus (filtered) cards."""
    status = request.args.get("status")
    owner = request.args.get("owner")
    return jsonify(kanban.board(status or None, owner.strip() if owner is not None else None))


# ---------------- cards ----------------


@bp.get("/api/kanban/cards")
def cards_list():
    """GET /api/kanban/cards — the cards array alone (same filters)."""
    status = request.args.get("status")
    owner = request.args.get("owner")
    return jsonify(
        kanban.board(status or None, owner.strip() if owner is not None else None)["cards"]
    )


@bp.post("/api/kanban/cards")
def card_create():
    body = json_body(("title", "owner", "status", "position"))
    status = clean_status(body["status"]) if body.get("status") not in (None, "") else None
    card = kanban.create_card(
        clean_title(body.get("title")),
        clean_owner(body.get("owner")),
        status,
        clean_position(body.get("position")),
    )
    return jsonify(card), 201


@bp.get("/api/kanban/cards/<card_id>")
def card_get(card_id):
    from . import db

    return jsonify(kanban.card(db.get_db(), parse_card_id(card_id)))


@bp.patch("/api/kanban/cards/<card_id>")
def card_patch(card_id):
    card_id = parse_card_id(card_id)
    body = json_body(("title", "owner", "status", "position"))
    if not body:
        raise KanbanError("nothing to update; send any of title, owner, status, position")
    changes = {}
    if "title" in body:
        changes["title"] = clean_title(body["title"])
    if "owner" in body:
        changes["owner"] = clean_owner(body["owner"])
    if "status" in body:
        changes["status"] = clean_status(body["status"])
    if "position" in body:
        changes["position"] = clean_position(body["position"])
    return jsonify(kanban.update_card(card_id, changes))


@bp.delete("/api/kanban/cards/<card_id>")
def card_delete(card_id):
    card = kanban.delete_card(parse_card_id(card_id))
    return jsonify({"deleted": card["id"], "card": card})


# ---------------- lanes ----------------


@bp.get("/api/kanban/lanes")
def lanes_list():
    from . import db

    return jsonify(kanban.lanes(db.get_db()))


@bp.post("/api/kanban/lanes")
def lane_create():
    body = json_body(("name", "position"))
    lane = kanban.create_lane(
        clean_lane_name(body.get("name")), clean_position(body.get("position"))
    )
    return jsonify(lane), 201


@bp.patch("/api/kanban/lanes/<lane_ref>")
def lane_patch(lane_ref):
    body = json_body(("name", "position"))
    if not body:
        raise KanbanError("nothing to update; send name and/or position")
    name = clean_lane_name(body["name"]) if "name" in body else None
    return jsonify(kanban.update_lane(lane_ref, name, clean_position(body.get("position"))))


@bp.delete("/api/kanban/lanes/<lane_ref>")
def lane_delete(lane_ref):
    force = request.args.get("force")
    target = request.args.get("target") or request.args.get("move_to")
    return jsonify(
        kanban.delete_lane(
            lane_ref,
            force=force is not None and force.lower() in TRUTHY,
            target=target or None,
        )
    )
