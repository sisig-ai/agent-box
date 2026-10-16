"""Kanban archiving: migration, archive-done, per-card archive, visibility, lanes."""

import sqlite3


def add(client, title, status="Backlog", **extra):
    r = client.post("/api/kanban/cards", json={"title": title, "status": status, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def visible(client, **params):
    return client.get("/api/kanban", query_string=params).get_json()["cards"]


def test_migration_adds_archived_at_without_data_loss(env):
    """A database created before archiving existed gains the column and keeps its cards."""
    conn = sqlite3.connect(env.data / "briefs.db")
    conn.executescript(
        """
        CREATE TABLE kanban_lane (id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE, position INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE kanban_card (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
            owner TEXT, lane_id INTEGER NOT NULL REFERENCES kanban_lane(id),
            position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO kanban_lane VALUES (1, 'Backlog', 0, 't', 't'), (2, 'Done', 1, 't', 't');
        INSERT INTO kanban_card VALUES (7, 'old card', 'Kyle Bot', 2, 0, 't', 't');
        """
    )
    conn.commit()
    conn.close()

    from dashboard import create_app

    client = create_app().test_client()
    create_app()  # a second startup is a no-op
    cards = visible(client)
    assert [(c["id"], c["title"], c["owner"], c["status"]) for c in cards] == [
        (7, "old card", "Kyle Bot", "Done")
    ]
    assert cards[0]["archived_at"] is None
    assert [lane["name"] for lane in client.get("/api/kanban").get_json()["lanes"]] == [
        "Backlog",
        "Done",
    ]


def test_archive_done_hides_done_cards(client):
    keep = add(client, "still working", "In Progress")
    d1 = add(client, "shipped 1", "Done")
    d2 = add(client, "shipped 2", "Done")
    r = client.post("/api/kanban/archive-done")
    assert r.status_code == 200
    body = r.get_json()
    assert body["archived"] == 2 and body["ids"] == [d1["id"], d2["id"]]
    assert [c["id"] for c in visible(client)] == [keep["id"]]
    assert [c["id"] for c in client.get("/api/kanban/cards").get_json()] == [keep["id"]]
    every = visible(client, include_archived="1")
    archived = [c for c in every if c["archived_at"]]
    assert {c["id"] for c in archived} == {d1["id"], d2["id"]}
    listed = client.get("/api/kanban/archived").get_json()
    assert {c["id"] for c in listed} == {d1["id"], d2["id"]}
    lanes = {lane["name"]: lane for lane in client.get("/api/kanban").get_json()["lanes"]}
    assert lanes["Done"]["card_count"] == 0 and lanes["Done"]["archived_count"] == 2
    # nothing left: a second call archives nothing
    again = client.post("/api/kanban/archive-done").get_json()
    assert again["archived"] == 0 and again["ids"] == []


def test_archive_done_finds_lane_case_insensitively(client):
    client.patch("/api/kanban/lanes/done", json={"name": "DONE"})
    add(client, "x", "done")
    assert client.post("/api/kanban/archive-done").get_json()["archived"] == 1


def test_archive_done_without_done_lane_is_404(client):
    client.delete("/api/kanban/lanes/done")
    r = client.post("/api/kanban/archive-done")
    assert r.status_code == 404 and "Done" in r.get_json()["error"]


def test_patch_archive_and_unarchive_keeps_positions_contiguous(client):
    a, b, c = (add(client, n, "To Do") for n in "abc")
    r = client.patch(f"/api/kanban/cards/{b['id']}", json={"archived": True})
    assert r.status_code == 200 and r.get_json()["archived_at"]
    todo = visible(client, status="to do")
    assert [(x["title"], x["position"]) for x in todo] == [("a", 0), ("c", 1)]
    # archived cards stay readable by id and editable
    got = client.get(f"/api/kanban/cards/{b['id']}").get_json()
    assert got["archived_at"] and got["title"] == "b"
    client.patch(f"/api/kanban/cards/{b['id']}", json={"title": "b2"})
    assert visible(client, status="to do")[1]["title"] == "c"
    # unarchive appends to the bottom of its lane
    r = client.patch(f"/api/kanban/cards/{b['id']}", json={"archived": False})
    assert r.get_json()["archived_at"] is None
    todo = visible(client, status="to do")
    assert [(x["title"], x["position"]) for x in todo] == [("a", 0), ("c", 1), ("b2", 2)]
    # unarchive into a lane at a position
    client.patch(f"/api/kanban/cards/{a['id']}", json={"archived": True})
    client.patch(
        f"/api/kanban/cards/{a['id']}", json={"archived": False, "status": "done", "position": 0}
    )
    assert [x["title"] for x in visible(client, status="done")] == ["a"]
    assert [(x["title"], x["position"]) for x in visible(client, status="to do")] == [
        ("c", 0),
        ("b2", 1),
    ]
    assert c["id"]


def test_new_cards_ignore_archived_positions(client):
    add(client, "old", "Done")
    client.post("/api/kanban/archive-done")
    fresh = add(client, "new", "Done")
    assert fresh["position"] == 0


def test_archived_must_be_boolean(client):
    card = add(client, "x")
    assert (
        client.patch(f"/api/kanban/cards/{card['id']}", json={"archived": "yes"}).status_code == 400
    )
    assert client.patch(f"/api/kanban/cards/{card['id']}", json={"archived": 1}).status_code == 400


def test_archived_filters_combine(client):
    add(client, "mine", "Done", owner="Zack Bot")
    add(client, "theirs", "Done", owner="Kyle Bot")
    client.post("/api/kanban/archive-done")
    mine = client.get("/api/kanban/archived", query_string={"owner": "zack bot"}).get_json()
    assert [c["title"] for c in mine] == ["mine"]
    assert visible(client, include_archived="1", owner="kyle bot")[0]["title"] == "theirs"
    assert visible(client, include_archived="0") == []


def test_lane_with_only_archived_cards_needs_target_or_force(client):
    client.post("/api/kanban/lanes", json={"name": "Review"})
    add(client, "r", "Review")
    card = visible(client, status="review")[0]
    client.patch(f"/api/kanban/cards/{card['id']}", json={"archived": True})
    r = client.delete("/api/kanban/lanes/review")
    assert r.status_code == 409 and "archived" in r.get_json()["error"]
    r = client.delete("/api/kanban/lanes/review", query_string={"target": "done"})
    assert r.status_code == 200 and r.get_json()["archived_cards"] == 1
    moved = client.get(f"/api/kanban/cards/{card['id']}").get_json()
    assert moved["status"] == "Done" and moved["archived_at"]
    assert visible(client, status="done") == []
