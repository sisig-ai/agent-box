"""Ops Board ``opname``: optional operation name on cards (additive field).

Covers create/patch/clear, the ?opname= filter on every listing, the
/api/opsboard/opnames rollup, the /api/kanban aliases, and the additive
migration of a database created before the column existed.
"""

import sqlite3

import pytest

OLD_CARD_KEYS = {
    "id",
    "title",
    "owner",
    "status",
    "lane_id",
    "position",
    "created_at",
    "updated_at",
    "archived_at",
    "has_body",
    "body_preview",
    "body_tasks",
}


def make(client, title, **extra):
    r = client.post("/api/opsboard/cards", json={"title": title, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def test_default_opname_is_null_and_payload_is_additive(client):
    card = make(client, "plain")
    assert card["opname"] is None
    listed = client.get("/api/opsboard/cards").get_json()[0]
    assert set(listed) == OLD_CARD_KEYS | {"opname", "comment_count", "docs"}
    full = client.get(f"/api/opsboard/cards/{card['id']}").get_json()
    assert set(full) == OLD_CARD_KEYS | {"opname", "comment_count", "body", "comments", "docs"}


def test_create_with_opname_normalises_whitespace(client):
    card = make(client, "valhalla", opname="  Operation   Valhalla ")
    assert card["opname"] == "Operation Valhalla"
    assert (
        client.get(f"/api/kanban/cards/{card['id']}").get_json()["opname"] == "Operation Valhalla"
    )


@pytest.mark.parametrize("prefix", ["/api/opsboard", "/api/kanban"])
@pytest.mark.parametrize("clear", [None, "", "   "])
def test_patch_sets_and_clears(client, prefix, clear):
    cid = make(client, "x")["id"]
    r = client.patch(f"{prefix}/cards/{cid}", json={"opname": "Operation Lightspeed"})
    assert r.status_code == 200 and r.get_json()["opname"] == "Operation Lightspeed"
    r = client.patch(f"{prefix}/cards/{cid}", json={"opname": clear})
    assert r.status_code == 200 and r.get_json()["opname"] is None


def test_patch_opname_leaves_other_fields_alone(client):
    card = make(client, "keep", owner="bot", body="# hi", status="To Do")
    after = client.patch(f"/api/opsboard/cards/{card['id']}", json={"opname": "Op"}).get_json()
    for key in ("title", "owner", "body", "status", "lane_id", "position", "archived_at"):
        assert after[key] == card[key]


def test_patch_other_fields_keeps_opname(client):
    cid = make(client, "keep", opname="Operation Eloquent Moon")["id"]
    after = client.patch(f"/api/opsboard/cards/{cid}", json={"status": "Done"}).get_json()
    assert after["opname"] == "Operation Eloquent Moon"


@pytest.mark.parametrize("bad", [5, True, ["a"], {"a": 1}, "x" * 101])
def test_rejects_bad_opname(client, bad):
    assert client.post("/api/opsboard/cards", json={"title": "t", "opname": bad}).status_code == 400
    cid = make(client, "t")["id"]
    assert client.patch(f"/api/opsboard/cards/{cid}", json={"opname": bad}).status_code == 400


def test_opname_filter_on_listings(client):
    a = make(client, "a", opname="Operation Lightspeed")["id"]
    b = make(client, "b", opname="operation lightspeed")["id"]
    c = make(client, "c", opname="Operation Eloquent Moon")["id"]
    d = make(client, "d")["id"]
    q = {"opname": "OPERATION LIGHTSPEED"}
    for prefix in ("/api/opsboard", "/api/kanban"):
        ids = [x["id"] for x in client.get(f"{prefix}/cards", query_string=q).get_json()]
        assert ids == [a, b]
        board = client.get(prefix, query_string=q).get_json()
        assert [x["id"] for x in board["cards"]] == [a, b] and board["lanes"]
        none = client.get(f"{prefix}/cards", query_string={"opname": ""}).get_json()
        assert [x["id"] for x in none] == [d]
    assert client.get("/api/opsboard/cards", query_string={"opname": "Nope"}).get_json() == []
    # filter composes with archive views
    client.patch(f"/api/opsboard/cards/{c}", json={"archived": True})
    q = {"opname": "operation eloquent moon"}
    assert client.get("/api/opsboard/cards", query_string=q).get_json() == []
    inc = client.get("/api/opsboard/cards", query_string={**q, "include_archived": 1}).get_json()
    assert [x["id"] for x in inc] == [c]
    assert [x["id"] for x in client.get("/api/kanban/archived", query_string=q).get_json()] == [c]


def test_opnames_rollup(client):
    assert client.get("/api/opsboard/opnames").get_json() == []
    make(client, "a", opname="Operation Lightspeed")
    make(client, "b", opname="Operation Lightspeed")
    z = make(client, "z", opname="Operation Eloquent Moon")["id"]
    make(client, "none")
    client.patch(f"/api/opsboard/cards/{z}", json={"archived": True})
    got = client.get("/api/opsboard/opnames").get_json()
    assert got == [
        {
            "opname": "Operation Eloquent Moon",
            "card_count": 1,
            "active_count": 0,
            "archived_count": 1,
        },
        {"opname": "Operation Lightspeed", "card_count": 2, "active_count": 2, "archived_count": 0},
    ]
    assert client.get("/api/kanban/opnames").get_json() == got
    live = client.get("/api/opsboard/opnames", query_string={"include_archived": "0"}).get_json()
    assert [o["opname"] for o in live] == ["Operation Lightspeed"]


def test_migrates_old_database(env):
    """A DB created before ``opname`` existed gains a nullable column, rows intact."""
    conn = sqlite3.connect(env.data / "briefs.db")
    conn.executescript(
        """
        CREATE TABLE kanban_lane (id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE, position INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE kanban_card (id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, owner TEXT, lane_id INTEGER NOT NULL,
            position INTEGER NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, archived_at TEXT, body TEXT NOT NULL DEFAULT '');
        INSERT INTO kanban_lane VALUES (1, 'Backlog', 0, 't', 't');
        INSERT INTO kanban_card VALUES (7, 'old card', 'kix', 1, 0, 't', 't', NULL, 'b');
        """
    )
    conn.commit()
    conn.close()
    from dashboard import create_app

    client = create_app().test_client()
    card = client.get("/api/opsboard/cards/7").get_json()
    assert card["title"] == "old card" and card["body"] == "b" and card["opname"] is None
    assert client.patch("/api/opsboard/cards/7", json={"opname": "Op"}).get_json()["opname"] == "Op"
    # idempotent: a second startup does not fail or reset the value
    again = create_app().test_client().get("/api/opsboard/cards/7").get_json()
    assert again["opname"] == "Op"


def test_ui_and_docs_mention_opname(client):
    assert "opname" in client.get("/static/js/kanban/board.js").data.decode()
    assert "opname" in client.get("/static/js/kanban/detail.js").data.decode()
    doc = client.get("/llm.txt").data.decode()
    assert "opname" in doc and "/api/opsboard/opnames" in doc
