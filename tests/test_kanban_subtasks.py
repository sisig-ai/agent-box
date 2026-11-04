"""Subtasks: cards with a parent, hidden from the board."""


def make_card(client, title="parent", owner="Cody", opname="Op X", lane="Backlog"):
    return client.post(
        "/api/opsboard/cards",
        json={"title": title, "owner": owner, "opname": opname, "status": lane},
    ).get_json()


def add_subtask(client, parent, **body):
    payload = {"title": "step one", **body}
    return client.post(f"/api/opsboard/cards/{parent['id']}/subtasks", json=payload)


def test_create_inherits_owner_opname_and_lane(client):
    parent = make_card(client)
    r = add_subtask(client, parent, body="do it", docs=["specs/x.md"])
    assert r.status_code == 201, r.get_json()
    sub = r.get_json()
    assert sub["owner"] == "Cody"
    assert sub["opname"] == "Op X"
    assert sub["lane_id"] == parent["lane_id"]
    assert sub["body"] == "do it"
    assert sub["docs"] == ["specs/x.md"]
    assert sub["parent_id"] == parent["id"]

    listed = client.get(f"/api/opsboard/cards/{parent['id']}/subtasks").get_json()["subtasks"]
    assert [item["id"] for item in listed] == [sub["id"]]
    detail = client.get(f"/api/opsboard/cards/{parent['id']}").get_json()
    assert [item["id"] for item in detail["subtasks"]] == [sub["id"]]


def test_subtasks_stay_off_the_board_and_search(client):
    parent = make_card(client)
    add_subtask(client, parent, title="hidden child")
    board = client.get("/api/opsboard").get_json()["cards"]
    assert [card["id"] for card in board] == [parent["id"]]
    hits = client.get("/api/opsboard/search?q=hidden").get_json()["cards"]
    assert hits == []
    assert client.get("/api/opsboard/opnames").get_json()[0]["card_count"] == 1


def test_lane_is_optional_and_overridable(client):
    parent = make_card(client)
    sub = add_subtask(client, parent, lane="To Do").get_json()
    assert sub["status"] == "To Do"
    moved = client.patch(
        f"/api/opsboard/cards/{parent['id']}/subtasks/{sub['id']}", json={"lane": "Done"}
    ).get_json()
    assert moved["status"] == "Done"


def test_update_and_delete(client):
    parent = make_card(client)
    sub = add_subtask(client, parent).get_json()
    updated = client.patch(
        f"/api/opsboard/cards/{parent['id']}/subtasks/{sub['id']}",
        json={"title": "renamed", "body": "## Goal\nx", "docs": ["handoffs/y.md"]},
    ).get_json()
    assert updated["title"] == "renamed"
    assert updated["body"].startswith("## Goal")
    assert updated["docs"] == ["handoffs/y.md"]
    assert updated["owner"] == "Cody"  # inherited, not editable

    client.post(
        f"/api/opsboard/cards/{parent['id']}/comments", json={"author": "a", "body": "note"}
    )
    client.post(
        f"/api/opsboard/cards/{sub['id']}/comments", json={"author": "a", "body": "child note"}
    )
    assert len(client.get(f"/api/opsboard/cards/{sub['id']}/comments").get_json()) == 1

    assert (
        client.delete(f"/api/opsboard/cards/{parent['id']}/subtasks/{sub['id']}").status_code == 200
    )
    assert client.get(f"/api/opsboard/cards/{parent['id']}/subtasks").get_json()["subtasks"] == []
    assert client.get(f"/api/opsboard/cards/{sub['id']}").status_code == 404


def test_nesting_and_wrong_parent_are_refused(client):
    parent = make_card(client)
    sub = add_subtask(client, parent).get_json()
    nested = client.post(f"/api/opsboard/cards/{sub['id']}/subtasks", json={"title": "too deep"})
    assert nested.status_code == 400
    other = make_card(client, title="other")
    wrong = client.patch(
        f"/api/opsboard/cards/{other['id']}/subtasks/{sub['id']}", json={"title": "nope"}
    )
    assert wrong.status_code == 404


def test_deleting_the_parent_removes_subtasks(client):
    parent = make_card(client)
    sub = add_subtask(client, parent).get_json()
    client.delete(f"/api/opsboard/cards/{parent['id']}")
    assert client.get(f"/api/opsboard/cards/{sub['id']}").status_code == 404
    assert client.get("/api/opsboard").get_json()["cards"] == []


def test_mcp_subtask_round_trip(client):
    def rpc(name, arguments):
        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        result = client.post("/mcp", json=body).get_json()["result"]
        assert "isError" not in result, result["content"][0]["text"]
        return result["structuredContent"]

    card = rpc("create_card", {"title": "parent", "owner": "Cody", "opname": "Op X"})
    sub = rpc("create_subtask", {"card_id": card["id"], "title": "child", "body": "b"})
    assert sub["owner"] == "Cody" and sub["opname"] == "Op X"
    listed = rpc("list_subtasks", {"card_id": card["id"]})
    assert [item["id"] for item in listed["subtasks"]] == [sub["id"]]
    updated = rpc(
        "update_subtask",
        {
            "card_id": card["id"],
            "subtask_id": sub["id"],
            "title": "child 2",
            "docs": ["specs/z.md"],
        },
    )
    assert updated["title"] == "child 2" and updated["docs"] == ["specs/z.md"]
    rpc("delete_subtask", {"card_id": card["id"], "subtask_id": sub["id"]})
    assert rpc("list_subtasks", {"card_id": card["id"]})["subtasks"] == []
