"""MCP search tools default to 15 rows; listings keep their own default."""

from dashboard import db, docs_embed


def rpc(client, name, arguments):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }
    return client.post("/mcp", json=payload).get_json()["result"]["structuredContent"]


def seed_docs(client, count=20, folder="bulk"):
    for index in range(count):
        client.put(
            f"/api/docs/{folder}/doc-{index:02d}.md",
            json={"content": f"alpha topic {index}", "author": "probe"},
        )


def seed_cards(client, count=20):
    for index in range(count):
        client.post(
            "/api/opsboard/cards",
            json={"title": f"bulk card {index}", "body": "alpha topic"},
        )


def test_search_docs_defaults_to_15(client):
    seed_docs(client)
    assert rpc(client, "search_docs", {"q": "alpha"})["count"] == 15
    assert rpc(client, "search_docs", {"q": "alpha", "limit": 3})["count"] == 3


def test_semantic_search_defaults_to_15(client, monkeypatch):
    def fake(texts):
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(docs_embed, "embed_texts", fake)
    seed_docs(client)
    conn = db.connect()
    try:
        for row in conn.execute("SELECT id FROM doc").fetchall():
            docs_embed.index_doc(conn, row["id"])
    finally:
        conn.close()

    assert rpc(client, "semantic_search_docs", {"q": "alpha"})["count"] == 15
    assert rpc(client, "semantic_search_docs", {"q": "alpha", "limit": 4})["count"] == 4


def test_search_cards_defaults_to_15(client):
    seed_cards(client)
    assert len(rpc(client, "search_cards", {"q": "alpha"})["cards"]) == 15
    assert len(rpc(client, "search_cards", {"q": "alpha", "limit": 2})["cards"]) == 2


def test_list_docs_keeps_the_listing_default(client):
    seed_docs(client, count=60)
    assert rpc(client, "list_docs", {})["count"] == 50
