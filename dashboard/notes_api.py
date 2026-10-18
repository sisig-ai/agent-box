"""HTTP blueprint for the Daily Sitrep (formerly Daily Brief) and Weekly Schedule endpoints.

Canonical: /api/sitrep[/list]. /api/brief[/list] are deprecated aliases bound to
the same view functions.

No auth: local stack, exposed only over the tailnet.
"""

from flask import Blueprint, jsonify, request

from . import notes
from .dates import normalize_date, normalize_week

bp = Blueprint("notes", __name__)


def parse_limit(raw, default, maximum):
    """Parse a ?limit= query value. None means non-numeric garbage (400)."""
    if raw is None:
        return default
    try:
        return min(int(raw), maximum)
    except (TypeError, ValueError):
        return None


# ---------------- Daily Sitrep API (/api/sitrep; /api/brief = deprecated alias) ----------------


@bp.get("/api/sitrep")
@bp.get("/api/brief")
def brief_get():
    """GET /api/brief?date=YYYY-MM-DD (defaults to today)."""
    date = normalize_date(request.args.get("date"))
    if date is None:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400
    row = notes.fetch_brief(date)
    if row is None:
        return jsonify({"date": date, "content": ""}), 200
    return jsonify(row)


@bp.get("/api/sitrep/list")
@bp.get("/api/brief/list")
def brief_list():
    """GET /api/brief/list?limit=N — most recent days first."""
    limit = parse_limit(request.args.get("limit"), 30, 365)
    if limit is None:
        return jsonify({"error": "limit must be a number"}), 400
    return jsonify(notes.list_briefs(limit))


@bp.put("/api/sitrep")
@bp.put("/api/brief")
@bp.post("/api/sitrep")
@bp.post("/api/brief")
def brief_upsert():
    """PUT /api/brief with JSON {"date"?, "content"} — create or replace that day's entry."""
    body = request.get_json(silent=True) or {}
    if "content" not in body:
        return jsonify({"error": "content is required"}), 400
    date = normalize_date(body.get("date"))
    if date is None:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400
    return jsonify(notes.upsert_brief(date, body["content"]))


@bp.delete("/api/sitrep")
@bp.delete("/api/brief")
def brief_delete():
    """DELETE /api/brief?date=YYYY-MM-DD — remove that day's entry."""
    date = normalize_date(request.args.get("date"))
    if date is None:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400
    if not notes.delete_brief(date):
        return jsonify({"error": "no entry for that date"}), 404
    return jsonify({"deleted": date}), 200


# ---------------- Weekly Schedule API ----------------


@bp.get("/api/schedule")
def schedule_get():
    """GET /api/schedule?week=YYYY-MM-DD — week_start coerces to that week's Monday."""
    week = normalize_week(request.args.get("week"))
    if week is None:
        return jsonify({"error": "week must be YYYY-MM-DD"}), 400
    row = notes.fetch_schedule(week)
    if row is None:
        return jsonify({"week_start": week, "content": ""}), 200
    return jsonify(row)


@bp.get("/api/schedule/list")
def schedule_list():
    """GET /api/schedule/list?limit=N — most recent weeks first."""
    limit = parse_limit(request.args.get("limit"), 20, 104)
    if limit is None:
        return jsonify({"error": "limit must be a number"}), 400
    return jsonify(notes.list_schedules(limit))


@bp.put("/api/schedule")
@bp.post("/api/schedule")
def schedule_upsert():
    """PUT/POST /api/schedule with JSON {"week"?, "content"} — upsert that week's entry."""
    body = request.get_json(silent=True) or {}
    if "content" not in body:
        return jsonify({"error": "content is required"}), 400
    week = normalize_week(body.get("week"))
    if week is None:
        return jsonify({"error": "week must be YYYY-MM-DD"}), 400
    return jsonify(notes.upsert_schedule(week, body["content"]))


@bp.delete("/api/schedule")
def schedule_delete():
    """DELETE /api/schedule?week=YYYY-MM-DD — remove that week's entry."""
    week = normalize_week(request.args.get("week"))
    if week is None:
        return jsonify({"error": "week must be YYYY-MM-DD"}), 400
    if not notes.delete_schedule(week):
        return jsonify({"error": "no entry for that week"}), 404
    return jsonify({"deleted": week}), 200
