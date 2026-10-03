"""Landing/static routes and the unknown-API 404 shape."""

import json


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert b"<html" in r.data.lower()


def test_index_html_alias(client):
    assert client.get("/index.html").status_code == 200


def test_config_json_served(client):
    r = client.get("/config.json")
    assert r.status_code == 200
    assert isinstance(json.loads(r.data), dict)


def test_static_js_and_css_served(client):
    assert client.get("/static/js/main.js").status_code == 200
    assert client.get("/static/css/base.css").status_code == 200


def test_unknown_api_is_404(client):
    assert client.get("/api/does-not-exist").status_code == 404
