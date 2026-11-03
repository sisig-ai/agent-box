"""Cards and Docs are many-to-many: bindings, backlinks, cleanup, migration."""

import sqlite3

from dashboard import config, db


def bindings():
    conn = db.connect()
    try:
        return conn.execute(
            "SELECT card_id, prefix FROM card_doc ORDER BY card_id, prefix"
        ).fetchall()
    finally:
        conn.close()


def test_one_doc_many_cards_and_one_card_many_docs(client):
    client.put("/api/docs/specs/shared.md", json={"content": "shared"})
    client.put("/api/docs/specs/other.md", json={"content": "other"})
    first = client.post(
        "/api/opsboard/cards", json={"title": "a", "docs": ["specs/shared.md"]}
    ).get_json()
    second = client.post(
        "/api/opsboard/cards", json={"title": "b", "docs": ["specs/shared.md", "specs/other.md"]}
    ).get_json()

    doc = client.get("/api/docs/specs/shared.md").get_json()
    assert {card["id"] for card in doc["cards"]} == {first["id"], second["id"]}
    assert [card["title"] for card in doc["cards"]] == ["b", "a"]

    assert len(bindings()) == 3
    assert client.get(f"/api/opsboard/cards/{second['id']}").get_json()["docs"] == [
        "specs/other.md",
        "specs/shared.md",
    ]


def test_listing_and_tree_report_card_counts(client):
    client.put("/api/docs/specs/shared.md", json={"content": "shared"})
    client.post("/api/opsboard/cards", json={"title": "a", "docs": ["specs/shared.md"]})
    client.post("/api/opsboard/cards", json={"title": "b", "docs": ["specs/shared.md"]})

    listed = client.get("/api/docs").get_json()["docs"][0]
    assert listed["card_count"] == 2
    tree = client.get("/api/docs/tree").get_json()
    assert tree["folders"][0]["docs"][0]["card_count"] == 2


def test_deleting_either_side_drops_the_binding(client):
    client.put("/api/docs/specs/shared.md", json={"content": "shared"})
    card = client.post(
        "/api/opsboard/cards", json={"title": "a", "docs": ["specs/shared.md"]}
    ).get_json()
    other = client.post(
        "/api/opsboard/cards", json={"title": "b", "docs": ["specs/shared.md"]}
    ).get_json()

    client.delete(f"/api/opsboard/cards/{card['id']}")
    assert [row["card_id"] for row in bindings()] == [other["id"]]

    client.delete("/api/docs/specs/shared.md")
    assert bindings() == []
    assert client.get(f"/api/opsboard/cards/{other['id']}").get_json()["docs"] == []


def test_patch_replaces_bindings(client):
    client.put("/api/docs/specs/one.md", json={"content": "1"})
    client.put("/api/docs/specs/two.md", json={"content": "2"})
    card = client.post(
        "/api/opsboard/cards", json={"title": "a", "docs": ["specs/one.md"]}
    ).get_json()
    client.patch(f"/api/opsboard/cards/{card['id']}", json={"docs": ["specs/two.md"]})
    assert [row["prefix"] for row in bindings()] == ["specs/two.md"]
    assert client.get("/api/docs/specs/two.md").get_json()["cards"][0]["id"] == card["id"]
    assert client.get("/api/docs/specs/one.md").get_json()["cards"] == []


def test_legacy_json_column_is_migrated(client, env):
    """A database written before the join table keeps its links."""
    from dashboard import card_docs

    client.put("/api/docs/specs/legacy.md", json={"content": "old"})
    card = client.post("/api/opsboard/cards", json={"title": "legacy"}).get_json()
    conn = sqlite3.connect(config.DB_PATH)
    try:
        conn.execute(
            "UPDATE kanban_card SET doc_refs = ? WHERE id = ?",
            ('["specs/legacy.md"]', card["id"]),
        )
        conn.commit()
        conn.row_factory = sqlite3.Row
        with conn:
            card_docs._migrate_legacy(conn)
    finally:
        conn.close()
    assert [row["prefix"] for row in bindings()] == ["specs/legacy.md"]
    assert client.get(f"/api/opsboard/cards/{card['id']}").get_json()["docs"] == ["specs/legacy.md"]
