"""Cards referencing Docs: create, patch, list, validation, MCP."""


def create(client, **body):
    payload = {"title": "card with refs"}
    payload.update(body)
    return client.post("/api/opsboard/cards", json=payload)


def test_create_carries_docs(client):
    card = create(client, docs=["handoffs/a.md", "handoffs/a.md", "specs/b.md"]).get_json()
    assert card["docs"] == ["handoffs/a.md", "specs/b.md"]
    assert client.get(f"/api/opsboard/cards/{card['id']}").get_json()["docs"] == card["docs"]
    assert client.get("/api/opsboard").get_json()["cards"][0]["docs"] == card["docs"]


def test_patch_replaces_and_clears(client):
    card = create(client, docs=["specs/one.md"]).get_json()
    patched = client.patch(
        f"/api/opsboard/cards/{card['id']}", json={"docs": ["a/b.md", "c/d.md"]}
    ).get_json()
    assert patched["docs"] == ["a/b.md", "c/d.md"]

    cleared = client.patch(f"/api/opsboard/cards/{card['id']}", json={"docs": []}).get_json()
    assert cleared["docs"] == []


def test_references_need_not_exist_yet(client):
    card = create(client, docs=["handoffs/not-written-yet.md"]).get_json()
    assert card["docs"] == ["handoffs/not-written-yet.md"]


def test_validation(client):
    assert create(client, docs="handoffs/a.md").status_code == 400
    assert create(client, docs=[42]).status_code == 400
    assert create(client, docs=["../escape.md"]).status_code == 400
    too_many = [f"notes/{index}.md" for index in range(21)]
    assert create(client, docs=too_many).status_code == 400


def test_mcp_create_and_update_accept_docs(client):
    def call(name, arguments):
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        return client.post("/mcp", json=payload).get_json()["result"]["structuredContent"]

    card = call("create_card", {"title": "mcp refs", "docs": ["specs/x.md"]})
    assert card["docs"] == ["specs/x.md"]
    updated = call("update_card", {"id": card["id"], "docs": ["specs/y.md"]})
    assert updated["docs"] == ["specs/y.md"]
    assert call("get_card", {"id": card["id"]})["docs"] == ["specs/y.md"]
