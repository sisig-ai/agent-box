"""HTTP blueprint for the native telemetry endpoints."""

from flask import Blueprint, jsonify, request

from . import config, telemetry_store

bp = Blueprint("telemetry", __name__)


@bp.get("/api/stats")
def stats():
    snapshot, reason = telemetry_store.read_latest_stats()
    if reason == "reconnecting":
        return jsonify({"error": "Telemetry sampler is reconnecting", "stale": True}), 503
    if reason == "starting":
        return jsonify({"error": "Telemetry sampler is starting", "stale": True}), 503
    return jsonify(snapshot)


@bp.get("/api/stats/history")
def stats_history():
    """GET /api/stats/history?seconds=3600 — dense per-second series for the graphs.

    Returns {start, step, count} plus one array per metric; null = no sample
    (tab hidden, dashboard restarted). max 3900s (retention window).
    """
    try:
        seconds = max(60, min(int(request.args.get("seconds", 3600)), config.TELEMETRY_RETENTION_S))
    except (TypeError, ValueError):
        seconds = 3600
    return jsonify(telemetry_store.history_series(seconds))
