"""MCP endpoint (/mcp): handshake, tool catalogue, and representative calls."""

import json

import pytest

from dashboard import create_app


@pytest.fixture
def client():
    return create_app().test_client()


def rpc(client, method, params=None, request_id=1):
    payload = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        payload["params"] = params
    response = client.post("/mcp", json=payload)
    assert response.status_code == 200, response.data
    return response.get_json()


def call(client, tool, **arguments):
    body = rpc(client, "tools/call", {"name": tool, "arguments": arguments})
    return body["result"]


def data(result):
    assert "isError" not in result, result["content"][0]["text"]
    return result["structuredContent"]


def test_initialize_advertises_protocol_and_capabilities(client):
    body = rpc(
        client,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "0"},
        },
    )
    result = body["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["capabilities"] == {"tools": {"listChanged": False}}
    assert result["serverInfo"]["name"] == "agent-box-control"
    assert "Daily Sitrep" in result["instructions"]


def test_unknown_protocol_version_falls_back_to_current(client):
    body = rpc(client, "initialize", {"protocolVersion": "1999-01-01"})
    assert body["result"]["protocolVersion"] == "2025-06-18"


def test_initialized_notification_gets_202_with_no_body(client):
    response = client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert response.status_code == 202
    assert response.data == b""


def test_tools_list_covers_board_comments_lanes_and_notes(client):
    tools = rpc(client, "tools/list")["result"]["tools"]
    names = {tool["name"] for tool in tools}
    assert names == {
        "board_overview",
        "list_cards",
        "list_archived",
        "get_card",
        "search_cards",
        "list_opnames",
        "create_card",
        "update_card",
        "delete_card",
        "archive_done",
        "list_lanes",
        "create_lane",
        "update_lane",
        "delete_lane",
        "list_comments",
        "add_comment",
        "delete_comment",
        "get_sitrep",
        "list_sitreps",
        "put_sitrep",
        "delete_sitrep",
        "get_schedule",
        "list_schedules",
        "put_schedule",
        "delete_schedule",
        "list_progress_bars",
        "get_progress_bar",
        "create_progress_bar",
        "update_progress_bar",
        "delete_progress_bar",
    }
    for tool in tools:
        assert tool["description"]
        assert tool["inputSchema"]["type"] == "object"
        assert tool["inputSchema"]["additionalProperties"] is False


def test_card_crud_comments_and_archive_round_trip(client):
    created = data(
        call(
            client,
            "create_card",
            title="Wire the MCP server",
            owner="Forge",
            body="## Goal\nShip it",
        )
    )
    card_id = created["id"]
    assert created["status"] == "Backlog"
    assert created["body"].startswith("## Goal")

    fetched = data(call(client, "get_card", id=card_id))
    assert fetched["comments"] == []

    moved = data(
        call(client, "update_card", id=card_id, status="In Progress", position=0, opname="Op MCP")
    )
    assert moved["status"] == "In Progress"
    assert moved["opname"] == "Op MCP"

    board = data(call(client, "board_overview", status="in progress"))
    assert [card["id"] for card in board["cards"]] == [card_id]

    comment = data(call(client, "add_comment", card_id=card_id, author="Forge", body="started"))
    assert comment["author"] == "Forge"
    assert len(data(call(client, "list_comments", card_id=card_id))["comments"]) == 1

    data(call(client, "update_card", id=card_id, archived=True))
    assert data(call(client, "list_archived"))["cards"][0]["id"] == card_id
    assert data(call(client, "board_overview"))["cards"] == []

    data(call(client, "update_card", id=card_id, archived=False, status="Done"))
    assert data(call(client, "list_cards", status="done"))["cards"][0]["id"] == card_id

    archived = data(call(client, "archive_done"))
    assert archived["archived"] == 1 and archived["lane"] == "Done"

    deleted = data(call(client, "delete_card", id=card_id))
    assert deleted["deleted"] is True


def test_search_cards_finds_titles_bodies_and_comments(client):
    first = data(
        call(client, "create_card", title="Rotate the vault key", body="## Goal\nobsidian")
    )
    second = data(call(client, "create_card", title="Buy milk"))
    data(call(client, "add_comment", card_id=second["id"], author="Forge", body="vault key stale"))

    found = data(call(client, "search_cards", q="vault"))
    assert [card["card_id"] for card in found["cards"]] == [first["id"], second["id"]]
    assert "\x01vault\x02" in found["cards"][0]["title_marked"]
    assert found["cards"][1]["snippet_source"] == "comment"
    assert found["total"] == 2

    milk = data(call(client, "search_cards", q="milk", status="backlog"))
    assert milk["cards"][0]["card_id"] == second["id"]
    assert data(call(client, "search_cards", q="nothinghere"))["total"] == 0

    blank = call(client, "search_cards", q="  ")
    assert blank["isError"] is True
    bad_status = call(client, "search_cards", q="vault", status="Nowhere")
    assert bad_status["isError"] is True


def test_author_alias_filters_like_owner(client):
    a = data(call(client, "create_card", title="alias card a", owner="Forge"))
    b = data(call(client, "create_card", title="alias card b", owner="Operator"))
    loose = data(call(client, "create_card", title="alias card loose"))

    assert [c["id"] for c in data(call(client, "list_cards", author="forge"))["cards"]] == [a["id"]]
    overview = data(call(client, "board_overview", author="operator"))
    assert [c["id"] for c in overview["cards"]] == [b["id"]]
    assert [c["id"] for c in data(call(client, "list_cards", author=""))["cards"]] == [loose["id"]]
    assert [
        c["card_id"]
        for c in data(call(client, "search_cards", q="alias card", author="Forge"))["cards"]
    ] == [a["id"]]
    both = call(client, "list_cards", owner="forge", author="operator")
    assert both["isError"] is True


def test_lane_crud(client):
    lane = data(call(client, "create_lane", name="QA", position=1))
    assert lane["name"] == "QA"
    renamed = data(call(client, "update_lane", lane="QA", name="Review"))
    assert renamed["name"] == "Review"
    assert [row["name"] for row in data(call(client, "list_lanes"))["lanes"]].count("Review") == 1
    removed = data(call(client, "delete_lane", lane="Review"))
    assert removed["deleted"] == "Review"


def test_sitrep_crud(client):
    written = data(call(client, "put_sitrep", date="2026-10-30", content="# Sitrep\n\n- [ ] ship"))
    assert written["content"].startswith("# Sitrep")

    assert data(call(client, "get_sitrep", date="2026-10-30"))["content"] == written["content"]
    assert data(call(client, "get_sitrep", date="2026-10-31"))["content"] == ""
    assert data(call(client, "list_sitreps"))["sitreps"][0]["date"] == "2026-10-30"

    assert data(call(client, "delete_sitrep", date="2026-10-30"))["deleted"] == "2026-10-30"


def test_schedule_crud_coerces_week_to_monday(client):
    written = data(call(client, "put_schedule", week="2026-10-30", content="- Monday standup"))
    assert written["week_start"] == "2026-10-26"
    assert data(call(client, "get_schedule", week="2026-10-26"))["content"] == "- Monday standup"
    assert data(call(client, "list_schedules"))["schedules"][0]["week_start"] == "2026-10-26"
    assert data(call(client, "delete_schedule", week="2026-10-26"))["deleted"] == "2026-10-26"


def test_tool_errors_are_iserror_results(client):
    unknown = rpc(client, "tools/call", {"name": "no_such_tool", "arguments": {}})
    assert unknown["error"]["code"] == -32602
    assert "unknown tool" in unknown["error"]["message"]

    invalid = call(client, "create_card", title="   ")
    assert invalid["isError"] is True
    assert "title" in invalid["content"][0]["text"]

    missing = call(client, "get_card", id=999)
    assert missing["isError"] is True and "card not found" in missing["content"][0]["text"]


def test_protocol_errors(client):
    body = rpc(client, "resources/list")
    assert body["error"]["code"] == -32601

    response = client.post("/mcp", data="{", content_type="application/json")
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == -32700

    response = client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/call"})
    assert response.status_code == 200
    assert response.get_json()["error"]["code"] == -32602


def test_get_and_delete_are_refused_without_sessions(client):
    assert client.get("/mcp").status_code == 405
    assert client.delete("/mcp").status_code == 405


def test_batch_and_text_payload(client):
    batch = [
        {"jsonrpc": "2.0", "id": 1, "method": "ping"},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    ]
    response = client.post("/mcp", json=batch)
    assert response.status_code == 200
    replies = response.get_json()
    assert [item["id"] for item in replies] == [1, 2]

    single = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "list_lanes"}},
    )
    payload = single.get_json()["result"]
    assert json.loads(payload["content"][0]["text"])["lanes"]


def test_progress_bar_crud_and_nesting(client):
    root = data(
        call(
            client,
            "create_progress_bar",
            title="1,000-document batch",
            percent=37.4,
            owner="Forge",
            fields={"done": 374, "total": 1000},
        )
    )
    assert root["percent"] == 37.4
    assert root["fields"] == {"done": 374, "total": 1000}

    child = data(
        call(
            client,
            "create_progress_bar",
            title="Budget",
            percent=36,
            parent_id=root["id"],
            fields={"spent": "$18.00", "budget": "$50.00"},
        )
    )
    assert child["parent_id"] == root["id"]

    tree = data(call(client, "list_progress_bars"))
    assert tree["count"] == 2
    assert [bar["id"] for bar in tree["bars"]] == [root["id"]]
    assert tree["bars"][0]["children"][0]["id"] == child["id"]

    updated = data(
        call(
            client,
            "update_progress_bar",
            id=root["id"],
            percent=50,
            add_fields={"cost": "$9.00"},
            remove_fields=["done"],
        )
    )
    assert updated["percent"] == 50
    assert updated["fields"] == {"total": 1000, "cost": "$9.00"}

    refused = call(client, "delete_progress_bar", id=root["id"])
    assert refused["isError"] is True
    removed = data(call(client, "delete_progress_bar", id=root["id"], cascade=True))
    assert removed["deleted_count"] == 2
    assert data(call(client, "list_progress_bars"))["bars"] == []

    bad = call(client, "create_progress_bar", title="bad", percent=140)
    assert bad["isError"] is True
