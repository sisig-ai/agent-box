"""Docs store: prefix keys, metadata, replace semantics, FTS, deletion."""

import json


def put(client, prefix, **body):
    return client.put(f"/api/docs/{prefix}", json=body)


def test_create_and_read(client):
    r = put(
        client,
        "notes/handoff.md",
        content="alpha beta",
        author="box",
        tags=["handoff", "Doctrine", "handoff"],
    )
    assert r.status_code == 201
    doc = r.get_json()
    assert doc["prefix"] == "notes/handoff.md"
    assert doc["revision"] == 1
    assert doc["tags"] == ["handoff", "Doctrine"]
    assert doc["size"] == len("alpha beta")
    assert doc["created_at"] == doc["updated_at"]

    got = client.get("/api/docs/notes/handoff.md").get_json()
    assert got["content"] == "alpha beta"
    assert got["author"] == "box"


def test_replace_bumps_revision_and_keeps_prefix(client):
    first = put(client, "a/b", content="one", author="a", tags=["x"]).get_json()
    second = put(client, "a/b", content="two").get_json()
    assert second["id"] == first["id"]
    assert second["revision"] == 2
    assert second["content"] == "two"
    assert second["tags"] == []  # PUT replaces the whole object
    assert second["author"] is None
    assert second["updated_at"] >= first["updated_at"]


def test_create_only_conflicts(client):
    assert put(client, "dup", content="x").status_code == 201
    r = client.post("/api/docs", json={"prefix": "dup", "content": "y"})
    assert r.status_code == 409
    assert "already exists" in r.get_json()["error"]


def test_patch_keeps_other_fields(client):
    put(client, "p/q", content="body", author="box", tags=["keep"])
    r = client.patch("/api/docs/p/q", json={"content": "new body"})
    doc = r.get_json()
    assert doc["content"] == "new body"
    assert doc["author"] == "box"
    assert doc["tags"] == ["keep"]
    assert doc["revision"] == 2


def test_prefix_validation(client):
    assert client.get("/api/docs/../etc/passwd").status_code in (400, 404)
    assert client.put("/api/docs/a/../b", json={"content": "x"}).status_code == 400
    assert client.put("/api/docs/a/./b", json={"content": "x"}).status_code == 400
    assert client.put("/api/docs/%20%20", json={"content": "x"}).status_code in (400, 404)
    assert client.put("/api/docs/a//b", json={"content": "x"}).status_code == 400


def test_unknown_fields_rejected(client):
    r = client.put("/api/docs/x", json={"content": "a", "owner": "b"})
    assert r.status_code == 400
    assert "unknown field" in r.get_json()["error"]
    r = client.post("/api/docs", json={"prefix": "y", "nope": 1})
    assert r.status_code == 400


def test_listing_and_prefix_filter(client):
    put(client, "ops/a", content="1")
    put(client, "ops/deep/b", content="2")
    put(client, "misc/c", content="3")
    data = client.get("/api/docs").get_json()
    assert data["total"] == 3
    assert {d["prefix"] for d in data["docs"]} == {"ops/a", "ops/deep/b", "misc/c"}
    assert "content" not in data["docs"][0]

    nested = client.get("/api/docs?prefix=ops").get_json()
    assert {d["prefix"] for d in nested["docs"]} == {"ops/a", "ops/deep/b"}
    assert nested["total"] == 2

    with_content = client.get("/api/docs?content=1&limit=1").get_json()
    assert "content" in with_content["docs"][0]

    prefixes = client.get("/api/docs/prefixes").get_json()["prefixes"]
    paths = {p["prefix"]: p for p in prefixes}
    assert paths["ops"]["total"] == 2
    assert paths["ops/deep"]["direct"] == 1


def test_search_marks_and_filters(client):
    put(client, "notes/alpha.md", content="the quick brown fox", author="box", tags=["handoff"])
    put(client, "notes/beta.md", content="lazy dog", author="moose")
    hit = client.get("/api/docs/search?q=brown").get_json()
    assert hit["total"] == 1
    assert hit["hits"][0]["prefix"] == "notes/alpha.md"
    assert "\x01brown\x02" in hit["hits"][0]["snippet"]

    # prefix terms, tag terms and author terms all match
    assert client.get("/api/docs/search?q=notes").get_json()["total"] == 2
    assert client.get("/api/docs/search?q=handoff").get_json()["total"] == 1
    assert client.get("/api/docs/search?q=moose").get_json()["total"] == 1
    assert client.get("/api/docs/search?q=fox%20-dog").get_json()["total"] == 1
    assert client.get("/api/docs/search?q=-dog").status_code == 400  # needs a positive term

    scoped = client.get("/api/docs/search?q=dog&prefix=notes").get_json()
    assert scoped["total"] == 1
    assert client.get("/api/docs/search?q=%20").status_code == 400


def test_index_follows_updates_and_deletes(client):
    put(client, "tmp/x", content="first word")
    put(client, "tmp/x", content="second word")
    assert client.get("/api/docs/search?q=first").get_json()["total"] == 0
    assert client.get("/api/docs/search?q=second").get_json()["total"] == 1

    assert client.delete("/api/docs/tmp/x").get_json()["deleted"] == "tmp/x"
    assert client.get("/api/docs/tmp/x").status_code == 404
    assert client.get("/api/docs/search?q=second").get_json()["total"] == 0
    assert client.delete("/api/docs/tmp/x").status_code == 404


def test_mcp_docs_round_trip(client):
    def call(name, arguments, id=1):
        payload = {
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        return client.post("/mcp", json=payload).get_json()["result"]

    created = call(
        "put_doc",
        {"prefix": "mcp/handoff.md", "content": "alpha gamma", "author": "box", "tags": ["x"]},
    )
    assert created["structuredContent"]["created"] is True

    fetched = call("get_doc", {"prefix": "mcp/handoff.md"})["structuredContent"]
    assert fetched["content"] == "alpha gamma"

    hits = call("search_docs", {"q": "gamma"})["structuredContent"]["hits"]
    assert hits[0]["prefix"] == "mcp/handoff.md"

    patched = call("patch_doc", {"prefix": "mcp/handoff.md", "tags": ["y", "z"]})[
        "structuredContent"
    ]
    assert patched["tags"] == ["y", "z"]
    assert patched["revision"] == 2

    listed = call("list_docs", {"prefix": "mcp"})["structuredContent"]
    assert listed["total"] == 1

    gone = call("delete_doc", {"prefix": "mcp/handoff.md"})["structuredContent"]
    assert gone["deleted"] == "mcp/handoff.md"

    missing = call("get_doc", {"prefix": "mcp/handoff.md"})
    assert missing["isError"] is True
    assert "no doc at prefix" in missing["content"][0]["text"]


def test_json_body_round_trip(client):
    """Content with newlines and unicode survives storage and listing."""
    text = "line one\nline two — ünïcode ✓\n"
    put(client, "u/utf8.md", content=text)
    assert client.get("/api/docs/u/utf8.md").get_json()["content"] == text
    row = json.loads(client.get("/api/docs?prefix=u&content=1").data)["docs"][0]
    assert row["content"] == text


def test_prefix_search_matches_any_part_of_the_key(client):
    put(client, "handoffs/card-389.md", content="alpha beta")
    put(client, "handoffs/card-390.md", content="alpha beta")
    put(client, "specs/card-389-spec.md", content="alpha beta")
    put(client, "notes/unrelated.md", content="alpha beta")

    hit = client.get("/api/docs/search?q=alpha&prefix_q=card-389").get_json()
    assert {row["prefix"] for row in hit["hits"]} == {
        "handoffs/card-389.md",
        "specs/card-389-spec.md",
    }

    scoped = client.get("/api/docs/search?q=alpha&prefix=handoffs&prefix_q=card-389").get_json()
    assert [row["prefix"] for row in scoped["hits"]] == ["handoffs/card-389.md"]


def test_prefix_only_search_lists_newest_first(client):
    put(client, "handoffs/old-card.md", content="x")
    put(client, "handoffs/new-card.md", content="y")
    listing = client.get("/api/docs/search?prefix_q=card").get_json()
    assert listing["total"] == 2
    assert [row["prefix"] for row in listing["hits"]][0] == "handoffs/new-card.md"
    assert listing["hits"][0]["snippet"] == ""

    empty = client.get("/api/docs/search").get_json()
    assert "error" in empty


def test_prefix_query_is_validated(client):
    assert client.get("/api/docs/search?prefix_q=" + "a" * 500).status_code == 400
