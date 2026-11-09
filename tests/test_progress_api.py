"""Progress Bars REST API: CRUD, nesting, fields, validation, cascade delete."""


def create(client, title, **fields):
    return client.post("/api/progress", json={"title": title, **fields})


def test_create_list_and_get_tree(client):
    root = create(client, "Batch", percent=42.5, owner="Forge", fields={"done": 17, "note": "x"})
    assert root.status_code == 201
    root = root.get_json()
    assert root["percent"] == 42.5
    assert root["fields"] == {"done": 17, "note": "x"}
    assert root["children"] == []

    child = create(client, "Budget", percent=10, parent_id=root["id"]).get_json()
    assert child["parent_id"] == root["id"]

    listing = client.get("/api/progress").get_json()
    assert listing["count"] == 2
    assert [bar["id"] for bar in listing["bars"]] == [root["id"]]
    assert listing["bars"][0]["children"][0]["id"] == child["id"]
    assert listing["bars"][0]["child_count"] == 1

    one = client.get(f"/api/progress/{root['id']}").get_json()
    assert one["children"][0]["title"] == "Budget"

    flat = client.get("/api/progress/flat").get_json()
    assert [bar["id"] for bar in flat["bars"]] == [root["id"], child["id"]]


def test_update_percent_fields_and_position(client):
    bar = create(client, "Docs", percent=0, fields={"a": "1", "b": "2"}).get_json()
    patched = client.patch(
        f"/api/progress/{bar['id']}",
        json={"percent": 99.9, "add_fields": {"c": "3"}, "remove_fields": ["a"]},
    ).get_json()
    assert patched["percent"] == 99.9
    assert patched["fields"] == {"b": "2", "c": "3"}

    replaced = client.patch(f"/api/progress/{bar['id']}", json={"fields": {"only": 1}})
    assert replaced.get_json()["fields"] == {"only": 1}

    titled = client.patch(
        f"/api/progress/{bar['id']}", json={"title": "Docs v2", "owner": "Kix", "position": 3}
    ).get_json()
    assert (titled["title"], titled["owner"], titled["position"]) == ("Docs v2", "Kix", 3)


def test_archive_hides_subtree_and_restores(client):
    root = create(client, "Root").get_json()
    child = create(client, "Child", parent_id=root["id"]).get_json()
    create(client, "Other")

    archived = client.patch(f"/api/progress/{root['id']}", json={"archived": True})
    assert archived.status_code == 200
    payload = archived.get_json()
    assert payload["archived"] is True
    assert payload["archived_at"]
    assert payload["children"][0]["archived"] is True

    live = client.get("/api/progress").get_json()
    assert [bar["title"] for bar in live["bars"]] == ["Other"]
    assert (live["count"], live["archived_count"]) == (1, 2)

    only = client.get("/api/progress?archived=only").get_json()
    assert [bar["title"] for bar in only["bars"]] == ["Root"]
    assert only["bars"][0]["children"][0]["title"] == "Child"
    assert only["count"] == 2

    everything = client.get("/api/progress?archived=include").get_json()
    assert len(everything["bars"]) == 2
    assert everything["count"] == 3

    flat = client.get("/api/progress/flat?archived=only").get_json()
    assert [bar["title"] for bar in flat["bars"]] == ["Root", "Child"]

    restored = client.patch(f"/api/progress/{root['id']}", json={"archived": False}).get_json()
    assert restored["archived_at"] is None
    assert client.get("/api/progress").get_json()["count"] == 3
    assert client.get(f"/api/progress/{child['id']}").get_json()["archived"] is False


def test_archived_parent_refuses_children_and_bad_flag(client):
    root = create(client, "Root").get_json()
    client.patch(f"/api/progress/{root['id']}", json={"archived": True})

    assert client.get(f"/api/progress/{root['id']}").status_code == 200
    nested = create(client, "Nope", parent_id=root["id"])
    assert nested.status_code == 409
    assert "restore" in nested.get_json()["error"]
    assert client.patch(f"/api/progress/{root['id']}", json={"archived": "yes"}).status_code == 400


def test_archive_done_hides_finished_bars_and_their_subtree(client):
    live = create(client, "Live", percent=40).get_json()
    done = create(client, "Done", percent=100).get_json()
    kid = create(client, "Kid", percent=10, parent_id=done["id"]).get_json()
    leaf = create(client, "Leaf", percent=100, parent_id=kid["id"]).get_json()

    body = client.post("/api/progress/archive-done").get_json()
    assert body["archived"] == 3
    assert body["done"] == sorted([done["id"], leaf["id"]])
    assert sorted(body["ids"]) == sorted([done["id"], kid["id"], leaf["id"]])

    listing = client.get("/api/progress").get_json()
    assert [bar["id"] for bar in listing["bars"]] == [live["id"]]
    assert listing["count"] == 1
    assert listing["archived_count"] == 3

    both = client.get("/api/progress?archived=include").get_json()
    assert both["count"] == 4
    assert [bar["id"] for bar in both["bars"]] == [live["id"], done["id"]]
    assert both["bars"][1]["children"][0]["id"] == kid["id"]

    only = client.get("/api/progress?archived=only").get_json()
    assert [bar["id"] for bar in only["bars"]] == [done["id"]]
    assert only["bars"][0]["children"][0]["id"] == kid["id"]
    assert only["bars"][0]["children"][0]["children"][0]["id"] == leaf["id"]


def test_archive_done_is_idempotent_and_empty_when_nothing_is_finished(client):
    done = create(client, "Done", percent=100).get_json()
    assert client.post("/api/progress/archive-done").get_json()["archived"] == 1
    again = client.post("/api/progress/archive-done").get_json()
    assert again == {"archived": 0, "done": [], "ids": [], "archived_at": None}

    restored = client.patch(f"/api/progress/{done['id']}", json={"archived": False})
    assert restored.get_json()["archived_at"] is None
    assert client.get("/api/progress").get_json()["count"] == 1

    client.patch(f"/api/progress/{done['id']}", json={"percent": 50})
    create(client, "Half", percent=50)
    empty = client.post("/api/progress/archive-done").get_json()
    assert empty["archived"] == 0
    assert client.get("/api/progress").get_json()["count"] == 2


def test_validation_errors(client):
    assert create(client, "").status_code == 400
    assert create(client, "x", percent=-1).status_code == 400
    assert create(client, "x", percent=101).status_code == 400
    assert create(client, "x", percent="abc").status_code == 400
    assert create(client, "x", fields={"nested": {"a": 1}}).status_code == 400
    assert create(client, "x", fields={"a": ["b"]}).status_code == 400
    assert create(client, "x", parent_id=999).status_code == 404
    assert client.post("/api/progress", json={"nope": 1}).status_code == 400
    assert client.get("/api/progress/999").status_code == 404

    root = create(client, "Root").get_json()
    child = create(client, "Child", parent_id=root["id"]).get_json()
    cycle = client.patch(f"/api/progress/{root['id']}", json={"parent_id": child["id"]})
    assert cycle.status_code == 400
    assert "cycle" in cycle.get_json()["error"]
    self_parent = client.patch(f"/api/progress/{root['id']}", json={"parent_id": root["id"]})
    assert self_parent.status_code == 400


def test_move_bar_to_root_and_order(client):
    a = create(client, "A").get_json()
    b = create(client, "B", parent_id=a["id"]).get_json()
    moved = client.patch(f"/api/progress/{b['id']}", json={"parent_id": None}).get_json()
    assert moved["parent_id"] is None
    listing = client.get("/api/progress").get_json()
    assert [bar["title"] for bar in listing["bars"]] == ["A", "B"]


def test_delete_requires_cascade_then_removes_subtree(client):
    root = create(client, "Root").get_json()
    mid = create(client, "Mid", parent_id=root["id"]).get_json()
    leaf = create(client, "Leaf", parent_id=mid["id"]).get_json()

    refused = client.delete(f"/api/progress/{root['id']}")
    assert refused.status_code == 409
    assert "2 nested" in refused.get_json()["error"]

    deleted = client.delete(f"/api/progress/{root['id']}?cascade=1")
    assert deleted.get_json() == {"deleted": root["id"], "deleted_count": 3}
    assert client.get(f"/api/progress/{leaf['id']}").status_code == 404
    assert client.get("/api/progress").get_json()["bars"] == []


def test_position_appends_and_sorts(client):
    early = create(client, "early", position=0).get_json()
    first = create(client, "first").get_json()
    second = create(client, "second").get_json()
    assert (early["position"], first["position"], second["position"]) == (0, 1, 2)
    listing = client.get("/api/progress").get_json()
    assert [bar["title"] for bar in listing["bars"]] == ["early", "first", "second"]
