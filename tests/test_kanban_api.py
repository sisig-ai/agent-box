"""Kanban API: default lanes, card lifecycle, ordering, lanes, validation."""


def lane_names(client):
    return [lane["name"] for lane in client.get("/api/opsboard").get_json()["lanes"]]


def add(client, title, **extra):
    r = client.post("/api/opsboard/cards", json={"title": title, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def titles(client, status):
    cards = client.get("/api/opsboard", query_string={"status": status}).get_json()["cards"]
    return [c["title"] for c in cards]


def test_default_lanes_and_empty_board(client):
    body = client.get("/api/opsboard").get_json()
    assert [lane["name"] for lane in body["lanes"]] == ["Backlog", "To Do", "In Progress", "Done"]
    assert body["cards"] == []


def test_create_defaults_to_first_lane(client):
    card = add(client, "  write docs  ")
    assert card["title"] == "write docs"
    assert card["status"] == "Backlog"
    assert card["owner"] is None
    assert card["position"] == 0
    assert card["created_at"] and card["updated_at"]


def test_status_is_case_insensitive(client):
    card = add(client, "x", status="in progress", owner="runtime")
    assert card["status"] == "In Progress"
    assert card["owner"] == "runtime"


def test_get_patch_delete_card(client):
    card = add(client, "t")
    assert client.get(f"/api/opsboard/cards/{card['id']}").get_json()["title"] == "t"
    r = client.patch(f"/api/opsboard/cards/{card['id']}", json={"title": "t2", "owner": "operator"})
    assert r.status_code == 200
    assert r.get_json()["title"] == "t2" and r.get_json()["owner"] == "operator"
    r = client.patch(f"/api/opsboard/cards/{card['id']}", json={"owner": None})
    assert r.get_json()["owner"] is None
    assert client.delete(f"/api/opsboard/cards/{card['id']}").status_code == 200
    assert client.get(f"/api/opsboard/cards/{card['id']}").status_code == 404


def test_move_between_lanes_and_reorder(client):
    a, b, c = (add(client, n) for n in "abc")
    assert titles(client, "backlog") == ["a", "b", "c"]
    client.patch(f"/api/opsboard/cards/{c['id']}", json={"position": 0})
    assert titles(client, "backlog") == ["c", "a", "b"]
    moved = client.patch(f"/api/opsboard/cards/{a['id']}", json={"status": "DONE"}).get_json()
    assert moved["status"] == "Done" and moved["position"] == 0
    assert titles(client, "backlog") == ["c", "b"]
    client.patch(f"/api/opsboard/cards/{b['id']}", json={"status": "done", "position": 0})
    assert titles(client, "done") == ["b", "a"]
    positions = [x["position"] for x in client.get("/api/opsboard").get_json()["cards"]]
    assert positions == [0, 0, 1]


def test_filters(client):
    add(client, "a", owner="Hermes")
    add(client, "b", owner="operator", status="To Do")
    add(client, "c")
    by_owner = client.get("/api/opsboard", query_string={"owner": "runtime"}).get_json()
    assert [c["title"] for c in by_owner["cards"]] == ["a"]
    assert len(by_owner["lanes"]) == 4
    assert titles(client, "to do") == ["b"]
    assert client.get("/api/opsboard", query_string={"status": "nope"}).status_code == 400


def test_validation_errors(client):
    assert client.post("/api/opsboard/cards", json={"title": "  "}).status_code == 400
    assert client.post("/api/opsboard/cards", json={}).status_code == 400
    assert client.post("/api/opsboard/cards", data="x").status_code == 400
    r = client.post("/api/opsboard/cards", json={"title": "x", "status": "Nowhere"})
    assert r.status_code == 400 and "lanes are" in r.get_json()["error"]
    assert client.post("/api/opsboard/cards", json={"title": "x", "bogus": 1}).status_code == 400
    card = add(client, "x")
    url = f"/api/opsboard/cards/{card['id']}"
    assert client.patch(url, json={"position": -1}).status_code == 400
    assert client.patch(url, json={"position": "1"}).status_code == 400
    assert client.patch(url, json={}).status_code == 400
    assert client.patch("/api/opsboard/cards/999", json={"title": "y"}).status_code == 404
    assert client.get("/api/opsboard/cards/abc").status_code == 404


def test_lane_crud(client):
    r = client.post("/api/opsboard/lanes", json={"name": "Review", "position": 3})
    assert r.status_code == 201
    lane = r.get_json()
    assert lane_names(client) == ["Backlog", "To Do", "In Progress", "Review", "Done"]
    assert client.post("/api/opsboard/lanes", json={"name": "review"}).status_code == 409
    assert client.post("/api/opsboard/lanes", json={"name": "42"}).status_code == 400
    r = client.patch(f"/api/opsboard/lanes/{lane['id']}", json={"name": "QA"})
    assert r.get_json()["name"] == "QA"
    client.patch("/api/opsboard/lanes/qa", json={"position": 0})
    assert lane_names(client)[0] == "QA"
    assert client.delete(f"/api/opsboard/lanes/{lane['id']}").status_code == 200
    assert "QA" not in lane_names(client)
    assert client.delete("/api/opsboard/lanes/QA").status_code == 404


def test_delete_nonempty_lane(client):
    add(client, "a", status="To Do")
    add(client, "b", status="To Do")
    add(client, "z", status="Backlog")
    r = client.delete("/api/opsboard/lanes/to%20do")
    assert r.status_code == 409
    r = client.delete("/api/opsboard/lanes/To Do", query_string={"target": "backlog"})
    assert r.status_code == 200 and r.get_json()["moved_to"] == "Backlog"
    assert titles(client, "Backlog") == ["z", "a", "b"]
    r = client.delete("/api/opsboard/lanes/Backlog", query_string={"force": "1"})
    assert r.status_code == 200
    assert client.get("/api/opsboard").get_json()["cards"] == []


def test_renamed_lane_keeps_cards(client):
    card = add(client, "a", status="Done")
    client.patch("/api/opsboard/lanes/done", json={"name": "Shipped"})
    assert client.get(f"/api/opsboard/cards/{card['id']}").get_json()["status"] == "Shipped"


def test_kanban_tab_and_docs_served(client):
    page = client.get("/").data
    assert b'id="view-btn-kanban"' in page and b'data-tabpanel="kanban"' in page
    assert client.get("/static/js/kanban/board.js").status_code == 200
    assert b"/api/opsboard" in client.get("/llm.txt").data
