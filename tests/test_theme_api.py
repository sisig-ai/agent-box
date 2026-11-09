"""Theme selection: the saved look reaches the first paint, and switching a
theme rewrites ``static/config.json`` without dropping the rest of the file."""

import json

import pytest


@pytest.fixture
def theme_files(tmp_path, monkeypatch):
    from dashboard import theme

    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"title": "macmini", "services": []}), encoding="utf-8")
    themes = tmp_path / "themes.json"
    themes.write_text(
        json.dumps(
            [
                {"id": "classic-386", "name": "Classic 386", "css": "/static/css/tui.css"},
                {"id": "board", "name": "Board", "css": "/static/css/themes/board.css"},
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(theme, "CONFIG_PATH", cfg)
    monkeypatch.setattr(theme, "THEMES_PATH", themes)
    return cfg


def test_index_carries_the_saved_theme(client, theme_files):
    theme_files.write_text(json.dumps({"theme": "board"}), encoding="utf-8")
    html = client.get("/").text
    assert 'data-theme="board"' in html
    assert 'href="/static/css/themes/board.css"' in html
    assert 'data-theme-css="board"' in html


def test_index_falls_back_on_unknown_theme(client, theme_files):
    theme_files.write_text(json.dumps({"theme": "neon-2077"}), encoding="utf-8")
    html = client.get("/").text
    assert 'data-theme="classic-386"' in html
    assert "/static/css/tui.css" in html


def test_index_falls_back_on_broken_config(client, theme_files):
    theme_files.write_text("{ not json", encoding="utf-8")
    assert 'data-theme="classic-386"' in client.get("/").text


def test_get_themes_marks_the_active_one(client, theme_files):
    res = client.get("/api/themes")
    assert res.status_code == 200
    body = res.get_json()
    assert [entry["id"] for entry in body["themes"]] == ["classic-386", "board"]
    assert body["active"] == "classic-386"

    theme_files.write_text(json.dumps({"theme": "board"}), encoding="utf-8")
    assert client.get("/api/themes").get_json()["active"] == "board"


def test_post_theme_persists_choice(client, theme_files):
    body = {"title": "macmini", "services": [{"name": "keep me"}]}
    theme_files.write_text(json.dumps(body), encoding="utf-8")

    res = client.post("/api/theme", json={"theme": "board"})

    assert res.status_code == 200
    assert res.get_json() == {"theme": "board"}
    saved = json.loads(theme_files.read_text(encoding="utf-8"))
    assert saved["theme"] == "board"
    assert saved["services"] == [{"name": "keep me"}]


def test_post_theme_rejects_unknown_id(client, theme_files):
    res = client.post("/api/theme", json={"theme": "does-not-exist"})
    assert res.status_code == 400
    assert "theme" not in json.loads(theme_files.read_text(encoding="utf-8"))


def test_post_theme_rejects_non_string(client, theme_files):
    assert client.post("/api/theme", json={"theme": {"id": "board"}}).status_code == 400
    assert client.post("/api/theme", json={"theme": ""}).status_code == 400
    assert client.post("/api/theme", json={}).status_code == 400
