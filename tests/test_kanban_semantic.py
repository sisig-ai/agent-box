"""Ops Board semantic search: card vectors, API, MCP, staleness, deletion."""

import pytest

from dashboard import db, kanban_embed


def fake_vectors(texts):
    out = []
    for text in texts:
        low = text.lower()
        out.append(
            [
                1.0 if ("light" in low or "lamp" in low) else 0.0,
                1.0 if "relay" in low else 0.0,
                1.0 if "invoic" in low else 0.0,
                0.4 if "office" in low else 0.0,
            ]
        )
    return out


@pytest.fixture(autouse=True)
def offline_embeddings(monkeypatch):
    monkeypatch.setattr(kanban_embed, "embed_texts", fake_vectors)
    monkeypatch.setattr(kanban_embed, "_AUTO_INDEX", False)


def make_card(client, **body):
    payload = {"title": body.pop("title", "untitled"), "body": body.pop("body", "")}
    payload.update(body)
    return client.post("/api/opsboard/cards", json=payload).get_json()


def index_cards():
    conn = db.connect()
    try:
        for row in conn.execute("SELECT id FROM kanban_card").fetchall():
            kanban_embed.index_card(conn, row["id"])
    finally:
        conn.close()


def test_semantic_search_ranks_by_meaning(client):
    lights = make_card(client, title="office lamps", body="relay board and 220v wiring")
    billing = make_card(client, title="invoices", body="billing cycle for the quarter")
    assert kanban_embed.pending_count() == 2
    index_cards()
    assert kanban_embed.pending_count() == 0

    result = client.get("/api/opsboard/semantic?q=lighting%20control").get_json()
    assert result["hits"][0]["id"] == lights["id"]
    assert result["hits"][0]["score"] > result["hits"][1]["score"]
    assert result["hits"][0]["excerpt"]
    assert result["indexed"] == 2 and result["pending"] == 0
    assert billing["id"] in {hit["id"] for hit in result["hits"]}


def test_requires_a_query(client):
    assert client.get("/api/opsboard/semantic?q=").status_code == 400
    assert client.get("/api/opsboard/semantic").status_code == 400


def test_reindex_after_edit(client):
    card = make_card(client, title="office lamps", body="relay board")
    index_cards()
    assert kanban_embed.pending_count() == 0
    client.patch(f"/api/opsboard/cards/{card['id']}", json={"body": "invoice ledger"})
    assert kanban_embed.pending_count() == 1
    index_cards()
    assert kanban_embed.pending_count() == 0
    hits = client.get("/api/opsboard/semantic?q=invoice").get_json()["hits"]
    assert hits[0]["id"] == card["id"]


def test_delete_drops_vectors(client):
    card = make_card(client, title="office lamps", body="relay board")
    index_cards()
    assert client.delete(f"/api/opsboard/cards/{card['id']}").status_code == 200
    assert client.get("/api/opsboard/semantic?q=relay").get_json()["hits"] == []


def test_archived_filter(client):
    card = make_card(client, title="office lamps", body="relay board")
    index_cards()
    client.patch(f"/api/opsboard/cards/{card['id']}", json={"archived": True})
    assert client.get("/api/opsboard/semantic?q=relay").get_json()["count"] == 0
    only = client.get("/api/opsboard/semantic?q=relay&archived=only").get_json()
    assert [hit["id"] for hit in only["hits"]] == [card["id"]]


def test_unavailable_backend_is_503(client, monkeypatch):
    make_card(client, title="office lamps", body="relay board")

    def boom(_texts):
        raise kanban_embed.EmbedError("ollama unreachable")

    monkeypatch.setattr(kanban_embed, "embed_texts", boom)
    response = client.get("/api/opsboard/semantic?q=relay")
    assert response.status_code == 503
    assert response.get_json()["available"] is False


def test_mcp_tools(client):
    card = make_card(client, title="office lamps", body="relay board")

    def call(name, arguments):
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        return client.post("/mcp", json=payload).get_json()["result"]

    index_cards()
    hits = call("semantic_search_cards", {"q": "lighting control"})["structuredContent"]["hits"]
    assert hits[0]["id"] == card["id"]
    # the search-tool default applies here too
    assert (
        call("semantic_search_cards", {"q": "relay", "limit": 1})["structuredContent"]["count"] == 1
    )
    assert call("reindex_cards", {})["structuredContent"]["model"]
