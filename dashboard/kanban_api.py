"""HTTP blueprint for the Ops Board (formerly Kanban): lanes + cards.

Canonical routes live under /api/opsboard; /api/kanban/* are deprecated
aliases bound to the same view functions (other bots still call them).

No auth, same as the rest of the dashboard: local stack, tailnet only.
Errors are JSON ``{"error": "..."}`` with a 400 / 404 / 409 status.
"""

from flask import Blueprint, jsonify, request

from . import db, kanban, kanban_embed, kanban_lanes
from .kanban import KanbanError

bp = Blueprint("kanban", __name__)

TITLE_MAX = 500
OWNER_MAX = 100
OPNAME_MAX = 100
BODY_MAX = 200_000
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


def clean_opname(raw):
    """Optional operation name ("Operation Valhalla"); null or blank clears it.
    Inner whitespace is collapsed so filters match predictably."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise KanbanError("opname must be a string or null")
    opname = " ".join(raw.split())
    if len(opname) > OPNAME_MAX:
        raise KanbanError(f"opname must be at most {OPNAME_MAX} characters")
    return opname or None


def clean_body(raw):
    """Markdown body; null clears it. Stored verbatim (only \r\n -> \n)."""
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise KanbanError("body must be a string (markdown) or null")
    body = raw.replace("\r\n", "\n")
    if len(body) > BODY_MAX:
        raise KanbanError(f"body must be at most {BODY_MAX} characters")
    return body if body.strip() else ""


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


def flag(name):
    raw = request.args.get(name)
    return raw is not None and raw.strip().lower() in TRUTHY


def filtered_board(archived=None):
    """kanban.board() with the shared ?status= / ?owner= / ?opname= /
    ?include_archived= / ?include_body= filters."""
    status = request.args.get("status")
    owner = request.args.get("owner")
    opname = request.args.get("opname")
    if archived is None:
        archived = "include" if flag("include_archived") else "exclude"
    owner = owner.strip() if owner is not None else None
    opname = " ".join(opname.split()) if opname is not None else None
    return kanban.board(status or None, owner, archived, flag("include_body"), opname)


# ---------------- board ----------------


@bp.get("/api/opsboard")
@bp.get("/api/kanban")
def board_get():
    """GET /api/kanban?status=&owner=&opname=&include_archived=&include_body= — lanes + cards.

    Cards carry ``has_body`` / ``body_preview`` / ``body_tasks``; the full
    markdown ``body`` only with ``?include_body=1`` (or GET /api/kanban/cards/:id)."""
    return jsonify(filtered_board())


# ---------------- cards ----------------


@bp.get("/api/opsboard/cards")
@bp.get("/api/kanban/cards")
def cards_list():
    """GET /api/kanban/cards — the cards array alone (same filters)."""
    return jsonify(filtered_board()["cards"])


@bp.get("/api/opsboard/archived")
@bp.get("/api/kanban/archived")
def archived_list():
    """GET /api/kanban/archived?status=&owner= — archived cards, newest first."""
    return jsonify(filtered_board("only")["cards"])


@bp.get("/api/opsboard/semantic")
@bp.get("/api/kanban/semantic")
def opsboard_semantic():
    """Meaning-based card search: embed the query, cosine-rank stored card vectors."""
    query = (request.args.get("q") or "").strip()
    if not query:
        raise KanbanError("q is required")
    archived = request.args.get("archived") or "exclude"
    if archived not in ("exclude", "include", "only"):
        raise KanbanError("archived must be one of: exclude, include, only")
    try:
        limit = max(1, min(int(request.args.get("limit", 15)), 200))
    except (TypeError, ValueError):
        raise KanbanError("limit must be a number") from None
    with db.get_db() as conn:
        status = request.args.get("status")
        lane_id = kanban.require_lane(conn, status)["id"] if status else None
        try:
            return jsonify(
                kanban_embed.search(
                    query,
                    limit=limit,
                    archived=archived,
                    lane_id=lane_id,
                    owner=request.args.get("owner") or None,
                    opname=request.args.get("opname") or None,
                    sort=request.args.get("sort") or "blend",
                    conn=conn,
                )
            )
        except kanban_embed.EmbedError as exc:
            return jsonify({"error": str(exc), "available": False}), 503


@bp.post("/api/opsboard/reindex")
@bp.post("/api/kanban/reindex")
def opsboard_reindex():
    """Queue every card whose vectors are missing, stale or from another model."""
    return jsonify({"queued": kanban_embed.reindex_all(), "model": kanban_embed.config.EMBED_MODEL})


@bp.get("/api/opsboard/opnames")
@bp.get("/api/kanban/opnames")
def opnames_list():
    """GET /api/opsboard/opnames?include_archived= — distinct opnames with counts.

    Archived cards count by default (``include_archived=0`` limits to the board)."""
    from . import db

    raw = request.args.get("include_archived")
    archived = "exclude" if raw is not None and raw.strip().lower() not in TRUTHY else "include"
    return jsonify(kanban.opnames(db.get_db(), archived))


@bp.post("/api/opsboard/archive-done")
@bp.post("/api/kanban/archive-done")
def archive_done():
    """POST /api/kanban/archive-done — archive every visible card in the Done lane."""
    return jsonify(kanban.archive_lane("Done"))


@bp.post("/api/opsboard/cards")
@bp.post("/api/kanban/cards")
def card_create():
    body = json_body(("title", "owner", "status", "position", "body", "opname"))
    status = clean_status(body["status"]) if body.get("status") not in (None, "") else None
    card = kanban.create_card(
        clean_title(body.get("title")),
        clean_owner(body.get("owner")),
        status,
        clean_position(body.get("position")),
        clean_body(body.get("body")),
        clean_opname(body.get("opname")),
    )
    return jsonify(card), 201


@bp.get("/api/opsboard/cards/<card_id>")
@bp.get("/api/kanban/cards/<card_id>")
def card_get(card_id):
    from . import db
    from .kanban_comments import comments

    conn, card_id = db.get_db(), parse_card_id(card_id)
    return jsonify({**kanban.card(conn, card_id), "comments": comments(conn, card_id)})


@bp.patch("/api/opsboard/cards/<card_id>")
@bp.patch("/api/kanban/cards/<card_id>")
def card_patch(card_id):
    card_id = parse_card_id(card_id)
    body = json_body(("title", "owner", "body", "opname", "status", "position", "archived"))
    if not body:
        raise KanbanError(
            "nothing to update; send any of title, owner, body, opname, status, position, archived"
        )
    changes = {}
    if "title" in body:
        changes["title"] = clean_title(body["title"])
    if "owner" in body:
        changes["owner"] = clean_owner(body["owner"])
    if "body" in body:
        changes["body"] = clean_body(body["body"])
    if "opname" in body:
        changes["opname"] = clean_opname(body["opname"])
    if "status" in body:
        changes["status"] = clean_status(body["status"])
    if "position" in body:
        changes["position"] = clean_position(body["position"])
    if "archived" in body:
        if not isinstance(body["archived"], bool):
            raise KanbanError("archived must be true or false")
        changes["archived"] = body["archived"]
    return jsonify(kanban.update_card(card_id, changes))


@bp.delete("/api/opsboard/cards/<card_id>")
@bp.delete("/api/kanban/cards/<card_id>")
def card_delete(card_id):
    card = kanban.delete_card(parse_card_id(card_id))
    return jsonify({"deleted": card["id"], "card": card})


# ---------------- lanes ----------------


@bp.get("/api/opsboard/lanes")
@bp.get("/api/kanban/lanes")
def lanes_list():
    from . import db

    return jsonify(kanban.lanes(db.get_db()))


@bp.post("/api/opsboard/lanes")
@bp.post("/api/kanban/lanes")
def lane_create():
    body = json_body(("name", "position"))
    lane = kanban_lanes.create_lane(
        clean_lane_name(body.get("name")), clean_position(body.get("position"))
    )
    return jsonify(lane), 201


@bp.patch("/api/opsboard/lanes/<lane_ref>")
@bp.patch("/api/kanban/lanes/<lane_ref>")
def lane_patch(lane_ref):
    body = json_body(("name", "position"))
    if not body:
        raise KanbanError("nothing to update; send name and/or position")
    name = clean_lane_name(body["name"]) if "name" in body else None
    return jsonify(kanban_lanes.update_lane(lane_ref, name, clean_position(body.get("position"))))


@bp.delete("/api/opsboard/lanes/<lane_ref>")
@bp.delete("/api/kanban/lanes/<lane_ref>")
def lane_delete(lane_ref):
    force = request.args.get("force")
    target = request.args.get("target") or request.args.get("move_to")
    return jsonify(
        kanban_lanes.delete_lane(
            lane_ref,
            force=force is not None and force.lower() in TRUTHY,
            target=target or None,
        )
    )


from . import (  # noqa: E402
    kanban_comments_api,  # noqa: F401  (registers comment routes on bp)
    kanban_search_api,  # noqa: F401  (registers search route on bp)
)
