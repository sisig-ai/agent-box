"""Ops Board card comments: CRUD, ordering, counts, aliases, cascade."""

import re

ISO_OFFSET = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")


def make(client, title="c"):
    r = client.post("/api/opsboard/cards", json={"title": title})
    assert r.status_code == 201
    return r.get_json()


def test_comment_crud_and_counts(client):
    card = make(client)
    cid = card["id"]
    assert card["comment_count"] == 0
    assert client.get(f"/api/opsboard/cards/{cid}/comments").get_json() == []
    r = client.post(
        f"/api/opsboard/cards/{cid}/comments", json={"author": "Forge", "body": "**hi**"}
    )
    assert r.status_code == 201
    c1 = r.get_json()
    assert set(c1) == {"id", "card_id", "author", "body", "created_at"}
    assert c1["card_id"] == cid and c1["author"] == "Forge" and c1["body"] == "**hi**"
    assert ISO_OFFSET.match(c1["created_at"])
    c2 = client.post(
        f"/api/kanban/cards/{cid}/comments", json={"author": "Kix", "body": "two"}
    ).get_json()
    listed = client.get(f"/api/opsboard/cards/{cid}/comments").get_json()
    assert [c["id"] for c in listed] == [c1["id"], c2["id"]]
    full = client.get(f"/api/opsboard/cards/{cid}").get_json()
    assert full["comment_count"] == 2 and [c["id"] for c in full["comments"]] == [
        c1["id"],
        c2["id"],
    ]
    assert client.get("/api/opsboard/cards").get_json()[0]["comment_count"] == 2
    r = client.delete(f"/api/opsboard/cards/{cid}/comments/{c1['id']}")
    assert r.status_code == 200 and r.get_json()["deleted"] == c1["id"]
    assert client.delete(f"/api/opsboard/cards/{cid}/comments/{c1['id']}").status_code == 404
    assert client.get(f"/api/opsboard/cards/{cid}").get_json()["comment_count"] == 1


def test_comment_validation(client):
    cid = make(client)["id"]
    url = f"/api/opsboard/cards/{cid}/comments"
    assert client.post(url, json={"author": "", "body": "x"}).status_code == 400
    assert client.post(url, json={"author": "a", "body": "  "}).status_code == 400
    assert client.post(url, json={"author": "a", "body": "x", "extra": 1}).status_code == 400
    assert (
        client.post(
            "/api/opsboard/cards/9999/comments", json={"author": "a", "body": "x"}
        ).status_code
        == 404
    )
    assert client.get("/api/opsboard/cards/9999/comments").status_code == 404


def test_card_delete_removes_comments(client):
    cid = make(client)["id"]
    client.post(f"/api/opsboard/cards/{cid}/comments", json={"author": "a", "body": "x"})
    assert client.delete(f"/api/opsboard/cards/{cid}").status_code == 200
    other = make(client)["id"]
    assert client.get(f"/api/opsboard/cards/{other}/comments").get_json() == []
