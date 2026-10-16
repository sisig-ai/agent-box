"""Kanban card ``body``: create/patch/get, board summaries, migration."""

import sqlite3

from dashboard import config

BODY = "## Goal\n\nShip the **thing**.\n\n- [x] plan\n- [ ] build\n- [ ] test\n"


def add(client, title, **extra):
    r = client.post("/api/kanban/cards", json={"title": title, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def test_create_with_body_and_get_full(client):
    card = add(client, "t", body=BODY)
    assert card["body"] == BODY
    assert card["has_body"] is True
    assert card["body_preview"] == "Ship the thing."
    assert card["body_tasks"] == {"done": 1, "total": 3}
    got = client.get(f"/api/kanban/cards/{card['id']}").get_json()
    assert got["body"] == BODY


def test_board_lists_summary_not_body_unless_asked(client):
    add(client, "t", body=BODY)
    card = client.get("/api/kanban").get_json()["cards"][0]
    assert "body" not in card
    assert card["has_body"] and card["body_preview"]
    full = client.get("/api/kanban", query_string={"include_body": "1"}).get_json()["cards"][0]
    assert full["body"] == BODY
    assert client.get("/api/kanban/cards?include_body=1").get_json()[0]["body"] == BODY


def test_card_without_body_defaults(client):
    card = add(client, "plain")
    assert card["body"] == ""
    assert card["has_body"] is False
    assert card["body_preview"] == ""
    assert card["body_tasks"] is None


def test_patch_body_and_clear(client):
    card = add(client, "t", owner="kix")
    r = client.patch(f"/api/kanban/cards/{card['id']}", json={"body": "line1\r\nline2"})
    assert r.status_code == 200
    out = r.get_json()
    assert out["body"] == "line1\nline2"
    assert out["owner"] == "kix" and out["status"] == "Backlog" and out["position"] == 0
    assert (
        client.patch(f"/api/kanban/cards/{card['id']}", json={"body": None}).get_json()["body"]
        == ""
    )


def test_body_validation(client):
    assert client.post("/api/kanban/cards", json={"title": "t", "body": 5}).status_code == 400
    card = add(client, "t")
    r = client.patch(f"/api/kanban/cards/{card['id']}", json={"body": "x" * 200_001})
    assert r.status_code == 400


def test_preview_skips_headings_and_fences(client):
    body = "# Title\n\n```sh\nrm -rf /\n```\n\n> - [ ] first real line\n"
    assert add(client, "t", body=body)["body_preview"] == "first real line"
    assert add(client, "u", body="# Only a heading\n")["body_preview"] == "Only a heading"
    linked = add(client, "v", body="See [the docs](https://x.y) and `code`")
    assert linked["body_preview"] == "See the docs and code"


def test_migration_adds_body_and_keeps_cards(env):
    conn = sqlite3.connect(config.DB_PATH)
    conn.executescript(
        """
        CREATE TABLE kanban_lane (id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE, position INTEGER NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE kanban_card (id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL, owner TEXT, lane_id INTEGER NOT NULL,
          position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO kanban_lane VALUES (1, 'Backlog', 0, 'x', 'x');
        INSERT INTO kanban_card VALUES (1, 'old card', 'hermes', 1, 0, 'x', 'x');
        """
    )
    conn.commit()
    conn.close()
    from dashboard import create_app

    client = create_app().test_client()
    card = client.get("/api/kanban/cards/1").get_json()
    assert card["title"] == "old card" and card["owner"] == "hermes"
    assert card["body"] == "" and card["archived_at"] is None
    client.patch("/api/kanban/cards/1", json={"body": "now with a body"})
    assert client.get("/api/kanban").get_json()["cards"][0]["body_preview"] == "now with a body"
