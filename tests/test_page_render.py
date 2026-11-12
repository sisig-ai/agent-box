"""The UI is a Next.js static export served from frontend/out.

The htpy page modules are gone; the server serves the built SPA from
``frontend/out`` (503 with a build hint when it is missing) and falls back
to ``static/`` for site-root files like the manifest and llm.txt.
"""

import pathlib


def test_index_serves_the_built_frontend(client):
    r = client.get("/")
    assert r.status_code == 200
    body = r.data
    assert body.lower().startswith(b"<!doctype html>")
    # a Next.js export references its chunks
    assert b"_next" in body


def test_index_alias_serves_the_same_page(client):
    assert client.get("/").data == client.get("/index.html").data


def test_no_html_files_ship_in_the_app_source():
    # static/ still carries no page of its own — the page lives in frontend/
    html = [p for p in pathlib.Path("static").rglob("*.html")]
    assert html == []


def test_root_files_still_served_from_static(client):
    for asset in ("/llm.txt", "/manifest.webmanifest"):
        assert client.get(asset).status_code == 200


def test_api_paths_are_not_swallowed_by_the_spa_fallback(client):
    r = client.get("/api/does-not-exist")
    assert r.status_code == 404
    assert r.get_json() == {"error": "not found"}
