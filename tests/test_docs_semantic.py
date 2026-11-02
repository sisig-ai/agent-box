"""Docs semantic search: chunking, cosine, vector storage, staleness.

The Ollama call is monkeypatched everywhere here, so the suite never needs the
model (or the network) to pass.
"""

import pytest

from dashboard import docs, docs_embed


def fake_vectors(texts):
    """Deterministic 4-d vectors: word presence mapped onto axes."""
    out = []
    for text in texts:
        low = text.lower()
        out.append([
            1.0 if "tuya" in low else 0.0,
            1.0 if "tapo" in low else 0.0,
            1.0 if "handoff" in low else 0.0,
            0.5 if "camera" in low else 0.0,
        ])
    return out


@pytest.fixture(autouse=True)
def offline_embeddings(monkeypatch):
    monkeypatch.setattr(docs_embed, "embed_texts", fake_vectors)
    monkeypatch.setattr(docs_embed, "_AUTO_INDEX", False)  # no worker in tests


def index(client):
    """Embed every doc synchronously (the worker is disabled)."""
    from dashboard import db

    conn = db.connect()
    try:
        for row in conn.execute("SELECT id FROM doc").fetchall():
            docs_embed.index_doc(conn, row["id"])
    finally:
        conn.close()


def test_chunk_respects_paragraphs_and_size():
    text = "\n\n".join(["a" * 900, "b" * 900, "c" * 200])
    pieces = docs_embed.chunk(text)
    assert len(pieces) == 3  # two 900-char paragraphs force a split; overlap carries
    assert all(len(piece) <= docs_embed.CHUNK_CHARS + docs_embed.CHUNK_OVERLAP for piece in pieces)
    assert pieces[0] == "a" * 900
    assert docs_embed.chunk("") == []
    # a single oversized paragraph still gets split
    hard = docs_embed.chunk("x" * 5000)
    assert len(hard) == 5
    assert [len(piece) for piece in hard] == [1200, 1200, 1200, 1200, 1000]


def test_cosine_is_dot_product_on_normalised_vectors():
    assert docs_embed.cosine([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert docs_embed.cosine([1.0, 0.0], [0.0, 1.0]) == 0.0
    assert docs_embed.cosine([1.0], [1.0, 0.0]) == 0.0  # mismatched dims


def test_index_and_semantic_search(client):
    docs.put("notes/plugs.md", content="the tuya plugs in the office", author="box")
    docs.put("notes/cam.md", content="the tapo camera in the bedroom", author="box")
    assert docs_embed.pending_count() == 2
    index(client)
    assert docs_embed.pending_count() == 0

    result = client.get("/api/docs/semantic?q=tuya plugs").get_json()
    assert result["model"]
    assert result["hits"][0]["prefix"] == "notes/plugs.md"
    assert result["hits"][0]["score"] > result["hits"][1]["score"]
    assert result["indexed"] == 2 and result["pending"] == 0
    assert result["hits"][0]["excerpt"]


def test_semantic_matches_without_shared_words(client):
    docs.put("notes/a.md", content="handoff notes about doctrine")
    index(client)
    # the query shares no token with the doc, but the vector still ranks it
    hits = client.get("/api/docs/semantic?q=handoff").get_json()["hits"]
    assert hits and hits[0]["prefix"] == "notes/a.md"


def test_reindex_after_edit_and_model_change(client, monkeypatch):
    docs.put("notes/x.md", content="tuya body")
    index(client)
    assert docs_embed.pending_count() == 0

    docs.put("notes/x.md", content="tapo body")
    assert docs_embed.pending_count() == 1
    index(client)
    assert docs_embed.pending_count() == 0

    monkeypatch.setattr(docs_embed.config, "EMBED_MODEL", "other-model")
    assert docs_embed.pending_count() == 1
    queued = client.post("/api/docs/reindex").get_json()
    assert queued["queued"] >= 1


def test_delete_drops_vectors(client):
    docs.put("notes/gone.md", content="tuya")
    index(client)
    assert client.delete("/api/docs/notes/gone.md").status_code == 200
    assert client.get("/api/docs/semantic?q=tuya").get_json()["hits"] == []


def test_semantic_unavailable_is_503(client, monkeypatch):
    docs.put("notes/y.md", content="tuya")

    def boom(_texts):
        raise docs_embed.EmbedError("ollama unreachable")

    monkeypatch.setattr(docs_embed, "embed_texts", boom)
    r = client.get("/api/docs/semantic?q=anything")
    assert r.status_code == 503
    assert r.get_json()["available"] is False


def test_index_status(client):
    docs.put("a.md", content="tuya")
    docs.put("b.md", content="tapo")
    index(client)
    status = client.get("/api/docs/index").get_json()
    assert status["total"] == 2
    assert status["pending"] == 0
    assert status["model"] == docs_embed.config.EMBED_MODEL


def test_mcp_semantic_and_reindex(client):
    def call(name, arguments):
        payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                   "params": {"name": name, "arguments": arguments}}
        return client.post("/mcp", json=payload).get_json()["result"]

    docs.put("mcp/one.md", content="tuya devices on the lan")
    index(client)
    hits = call("semantic_search_docs", {"q": "tuya"})["structuredContent"]["hits"]
    assert hits[0]["prefix"] == "mcp/one.md"
    assert call("reindex_docs", {})["structuredContent"]["model"]
