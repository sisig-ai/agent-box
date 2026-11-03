"""FastAPI host: native async routes, request DB session, Flask bridge."""

import asyncio

from dashboard import db
from dashboard.asgi import create_app


def test_page_and_config_are_native(client):
    assert client.get("/").status_code == 200
    assert client.get("/config.json").get_json()["services"]


def test_migrated_endpoints_are_async():
    from dashboard import logs_api, procs_api, telemetry_api

    endpoints = [
        telemetry_api.stats,
        telemetry_api.stats_history,
        logs_api.logs_list,
        logs_api.logs_rotate,
        procs_api.procs_list,
        procs_api.procs_signal,
    ]
    assert all(asyncio.iscoroutinefunction(fn) for fn in endpoints)
    create_app()


def test_legacy_paths_still_route_through_the_bridge(client):
    r = client.get("/api/fs/list")
    assert r.status_code == 200
    assert "entries" in r.get_json()


def test_request_session_is_one_connection_and_closes(env):
    session, token = db.open_session()
    first = db.get_db()
    assert db.get_db() is first
    db.close_session(session, token)
    assert session.conn is None
    again = db.get_db()
    try:
        assert again is not first
    finally:
        again.close()


def test_outside_a_request_get_db_returns_a_fresh_connection():
    conn = db.get_db()
    try:
        assert conn.execute("select 1").fetchone()[0] == 1
        assert db.get_db() is not conn
    finally:
        conn.close()
