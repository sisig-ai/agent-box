"""PWA shell: manifest, standalone metadata, and the mobile stylesheet."""

import json


def test_manifest_served(client):
    r = client.get("/manifest.webmanifest")
    assert r.status_code == 200
    data = json.loads(r.data)
    assert data["display"] == "standalone"
    assert data["start_url"] == "/"
    assert data["icons"]


def test_index_has_pwa_metadata(client):
    html = client.get("/").data.decode()
    assert 'rel="manifest"' in html
    assert "apple-mobile-web-app-capable" in html
    assert "pwa.css" in html
    assert "serviceWorker" in html


def test_pwa_assets_served(client):
    assert client.get("/static/css/pwa.css").status_code == 200
    assert client.get("/sw.js").status_code == 200
