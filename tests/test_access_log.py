"""MCP access log: recording, entity extraction, filters, cap, API, MCP tool."""

from dashboard import access_log


def rpc(client, name, arguments):
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": name, "arguments": arguments}}
    return client.post("/mcp", json=payload).get_json()["result"]


def test_records_entity_and_summary(client):
    rpc(client, "put_doc", {"prefix": "notes/a.md", "content": "x" * 500, "author": "box"})
    rpc(client, "create_card", {"title": "probe card", "owner": "box"})
    entries = client.get("/api/logs").get_json()["entries"]
    by_tool = {entry["tool"]: entry for entry in entries}
    assert by_tool["put_doc"]["entity"] == "notes/a.md"
    assert by_tool["create_card"]["entity"] == "probe card"
    # long content is summarised, not stored whole
    assert "content=" in by_tool["put_doc"]["args"]
    assert len(by_tool["put_doc"]["args"]) <= access_log.SUMMARY_MAX


def test_failures_are_logged_with_error(client):
    rpc(client, "get_doc", {"prefix": "missing/none.md"})
    entry = client.get("/api/logs?ok=0").get_json()["entries"][0]
    assert entry["ok"] is False
    assert entry["entity"] == "missing/none.md"
    assert "no doc at prefix" in entry["error"]


def test_filters_and_order(client):
    rpc(client, "put_doc", {"prefix": "one.md", "content": "a"})
    rpc(client, "put_doc", {"prefix": "two.md", "content": "b"})
    rpc(client, "list_docs", {})
    newest = client.get("/api/logs").get_json()["entries"][0]
    assert newest["tool"] == "list_docs"

    docs_only = client.get("/api/logs?tool=put_doc").get_json()
    assert docs_only["total"] == 2
    assert [entry["entity"] for entry in docs_only["entries"]] == ["two.md", "one.md"]

    scoped = client.get("/api/logs?entity=one").get_json()
    assert scoped["total"] == 1
    assert scoped["entries"][0]["entity"] == "one.md"


def test_limit_validation(client):
    assert client.get("/api/logs?limit=abc").status_code == 400
    assert client.get("/api/logs?limit=5").get_json()["count"] <= 5


def test_entity_for_known_tools():
    assert access_log.entity_for("update_card", {"id": 42, "title": "x"}) == "42"
    assert access_log.entity_for("delete_comment", {"card_id": 7, "id": 9}) == "7"
    sitrep = access_log.entity_for("put_sitrep", {"date": "2026-11-02", "content": "x"})
    assert sitrep == "2026-11-02"
    assert access_log.entity_for("put_schedule", {"week": "2026-11-02"}) == "2026-11-02"
    assert access_log.entity_for("unknown_tool", {"q": "search me"}) == "search me"
    assert access_log.entity_for("unknown_tool", {"flag": True}) == ""


def test_table_is_capped(client, monkeypatch):
    monkeypatch.setattr(access_log, "MAX_ROWS", 5)
    monkeypatch.setattr(access_log, "_DELETE_EVERY", 1)
    for index in range(8):
        rpc(client, "put_doc", {"prefix": f"cap/{index}.md", "content": "x"})
    entries = client.get("/api/logs?limit=100").get_json()
    assert entries["total"] == 5
    assert entries["entries"][0]["entity"] == "cap/7.md"


def test_mcp_tool_reads_the_log(client):
    rpc(client, "put_doc", {"prefix": "mcp-log.md", "content": "x"})
    result = rpc(client, "list_access_logs", {"limit": 5})["structuredContent"]
    assert any(entry["tool"] == "put_doc" and entry["entity"] == "mcp-log.md"
               for entry in result["entries"])
    assert result["tools"]
