"""Bulk lane move: POST /api/opsboard/move-lane."""

WAITING = "Waiting for Command"


def add(client, title, status="Backlog", **extra):
    r = client.post("/api/opsboard/cards", json={"title": title, "status": status, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def visible(client, **params):
    return client.get("/api/opsboard", query_string=params).get_json()["cards"]


def lane_names(client):
    return [lane["name"] for lane in client.get("/api/opsboard/lanes").get_json()]


def ensure_lane(client, name):
    """Create the lane unless the fixture database already has it (case-insensitive)."""
    if name.casefold() not in {lane.casefold() for lane in lane_names(client)}:
        r = client.post("/api/opsboard/lanes", json={"name": name})
        assert r.status_code == 201, r.get_json()
    return name


def move(client, from_name, to_name):
    return client.post("/api/opsboard/move-lane", json={"from": from_name, "to": to_name})


def test_move_lane_appends_cards_to_done_in_order(client):
    ensure_lane(client, WAITING)
    ensure_lane(client, "Done")
    old = add(client, "already done", "Done")
    a, b, c = (add(client, title, WAITING) for title in ("first", "second", "third"))

    r = move(client, WAITING, "Done")
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["moved"] == 3
    assert body["ids"] == [a["id"], b["id"], c["id"]]
    assert body["from"] == WAITING and body["to"] == "Done"

    done = visible(client, status="Done")
    assert [card["title"] for card in done] == ["already done", "first", "second", "third"]
    assert all(card["archived_at"] is None for card in done)
    assert visible(client, status=WAITING) == []
    assert old["id"] == done[0]["id"]


def test_move_lane_matches_names_case_insensitively(client):
    ensure_lane(client, WAITING)
    add(client, "x", WAITING)
    r = move(client, "waiting for command", "done")
    assert r.status_code == 200 and r.get_json()["moved"] == 1


def test_move_lane_rejects_unknown_source(client):
    ensure_lane(client, WAITING)
    r = move(client, "Nowhere", "Done")
    assert r.status_code == 404
    assert "no lane named" in r.get_json()["error"]


def test_move_lane_rejects_unknown_target(client):
    ensure_lane(client, WAITING)
    r = move(client, WAITING, "Nowhere")
    assert r.status_code == 404
    assert "no lane named" in r.get_json()["error"]


def test_move_lane_rejects_same_lane(client):
    ensure_lane(client, WAITING)
    add(client, "x", WAITING)
    r = move(client, WAITING, WAITING)
    assert r.status_code == 400
    assert [card["title"] for card in visible(client, status=WAITING)] == ["x"]


def test_move_lane_skips_archived_source_cards(client):
    ensure_lane(client, WAITING)
    lanes = {lane["name"]: lane["id"] for lane in client.get("/api/opsboard/lanes").get_json()}
    keep = add(client, "live", WAITING)
    gone = add(client, "archived", WAITING)
    client.patch(f"/api/opsboard/cards/{gone['id']}", json={"archived": True})

    body = move(client, WAITING, "Done").get_json()
    assert body["moved"] == 1 and body["ids"] == [keep["id"]]
    assert [card["id"] for card in visible(client, status="Done")] == [keep["id"]]
    archived = next(c for c in visible(client, include_archived="1") if c["id"] == gone["id"])
    assert archived["lane_id"] == lanes[WAITING]


def test_move_lane_leaves_other_lanes_untouched(client):
    ensure_lane(client, WAITING)
    moving = add(client, "moving", WAITING)
    other = add(client, "elsewhere", "In Progress")
    body = move(client, WAITING, "Done").get_json()
    assert body["ids"] == [moving["id"]]
    assert [card["id"] for card in visible(client, status="In Progress")] == [other["id"]]
