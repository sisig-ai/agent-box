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


def test_fonts_and_vendor_are_immutable(client):
    font = client.get("/static/fonts/FiraCodeNerdFontMono-Regular.woff2")
    assert font.headers["Cache-Control"] == "public, max-age=31536000, immutable"
    vendor = client.get("/static/vendor/marked.min.js")
    assert vendor.headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_entry_points_are_no_cache(client):
    for path in ("/", "/index.html", "/config.json"):
        assert client.get(path).headers["Cache-Control"] == "no-cache"


def test_unknown_api_is_404(client):
    assert client.get("/api/does-not-exist").status_code == 404


def test_gmgn_pwa_entry(client):
    page = client.get("/gmgn")
    assert page.status_code == 200
    assert b"apple-mobile-web-app-capable" in page.data
    assert page.headers["Cache-Control"] == "no-cache"
    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert manifest.mimetype == "application/manifest+json"
    body = json.loads(manifest.data)
    assert body["display"] == "standalone"
    assert "app=gmgn" in body["start_url"]
    assert client.get("/sw.js").status_code == 200
    assert client.get("/icons/apple-touch-icon.png").status_code == 200
