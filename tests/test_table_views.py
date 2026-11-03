"""Table views: saved filters and ordering, applied on read only."""


def setup_table(client):
    client.post("/api/tables", json={"name": "Tasks"})
    client.post("/api/tables/Tasks/columns", json={"name": "Title", "type": "string"})
    client.post("/api/tables/Tasks/columns", json={"name": "Done", "type": "bool"})
    client.post(
        "/api/tables/Tasks/columns", json={"name": "Rank", "type": "number", "subtype": "int"}
    )
    client.post(
        "/api/tables/Tasks/columns",
        json={
            "name": "Tags",
            "type": "string",
            "subtype": "multi_select",
            "config": {"options": ["a", "b"]},
        },
    )
    rows = [
        ("alpha", True, 3, ["a"]),
        ("beta", False, 1, ["b"]),
        ("gamma", True, 2, []),
    ]
    for title, done, rank, tags in rows:
        assert (
            client.post(
                "/api/tables/Tasks/records",
                json={"values": {"Title": title, "Done": done, "Rank": rank, "Tags": tags}},
            ).status_code
            == 201
        )


def titles(response):
    return [row["values"]["Title"] for row in response.get_json()["records"]]


def test_view_crud_and_duplicate_names(client):
    setup_table(client)
    created = client.post(
        "/api/tables/Tasks/views",
        json={
            "name": "Open",
            "config": {"filters": [{"column": "Done", "op": "eq", "value": False}]},
        },
    ).get_json()
    assert created["name"] == "Open"
    assert client.post("/api/tables/Tasks/views", json={"name": "open"}).status_code == 409
    renamed = client.patch("/api/tables/Tasks/views/Open", json={"name": "Todo"}).get_json()
    assert renamed["name"] == "Todo"
    assert [v["name"] for v in client.get("/api/tables/Tasks/views").get_json()["views"]] == [
        "Todo"
    ]
    client.delete("/api/tables/Tasks/views/Todo")
    assert client.get("/api/tables/Tasks/views").get_json()["views"] == []
    # deleting a view leaves rows alone
    assert len(client.get("/api/tables/Tasks/records").get_json()["records"]) == 3


def test_filters_cover_the_operators(client):
    setup_table(client)

    def add(name, filters):
        assert (
            client.post(
                "/api/tables/Tasks/views", json={"name": name, "config": {"filters": filters}}
            ).status_code
            == 201
        )

    add("open", [{"column": "Done", "op": "eq", "value": False}])
    add("contains", [{"column": "Title", "op": "contains", "value": "amm"}])
    add("starts", [{"column": "Title", "op": "starts_with", "value": "al"}])
    add("gt", [{"column": "Rank", "op": "gt", "value": 1}])
    add("lte", [{"column": "Rank", "op": "lte", "value": 2}])
    add("empty", [{"column": "Tags", "op": "is_empty"}])
    add("tag_b", [{"column": "Tags", "op": "contains", "value": "b"}])
    add(
        "both",
        [
            {"column": "Done", "op": "eq", "value": True},
            {"column": "Rank", "op": "gte", "value": 3},
        ],
    )

    assert titles(client.get("/api/tables/Tasks/records?view=open")) == ["beta"]
    assert titles(client.get("/api/tables/Tasks/records?view=contains")) == ["gamma"]
    assert titles(client.get("/api/tables/Tasks/records?view=starts")) == ["alpha"]
    assert sorted(titles(client.get("/api/tables/Tasks/records?view=gt"))) == ["alpha", "gamma"]
    assert sorted(titles(client.get("/api/tables/Tasks/records?view=lte"))) == ["beta", "gamma"]
    assert sorted(titles(client.get("/api/tables/Tasks/records?view=empty"))) == ["gamma"]
    assert titles(client.get("/api/tables/Tasks/records?view=tag_b")) == ["beta"]
    assert titles(client.get("/api/tables/Tasks/records?view=both")) == ["alpha"]


def test_view_ordering_and_request_override(client):
    setup_table(client)
    client.post(
        "/api/tables/Tasks/views",
        json={"name": "ByRank", "config": {"order_by": "Rank", "order": "desc"}},
    )
    assert titles(client.get("/api/tables/Tasks/records?view=ByRank")) == ["alpha", "gamma", "beta"]
    assert titles(client.get("/api/tables/Tasks/records?view=ByRank&order_by=Title&order=asc")) == [
        "alpha",
        "beta",
        "gamma",
    ]


def test_view_paging_reports_filtered_total(client):
    setup_table(client)
    client.post(
        "/api/tables/Tasks/views",
        json={
            "name": "Open",
            "config": {"filters": [{"column": "Done", "op": "eq", "value": True}]},
        },
    )
    page = client.get("/api/tables/Tasks/records?view=Open&limit=1").get_json()
    assert page["total"] == 2 and page["count"] == 1 and page["has_more"] is True
    second = client.get("/api/tables/Tasks/records?view=Open&limit=1&offset=1").get_json()
    assert second["has_more"] is False


def test_computed_columns_cannot_be_filtered(client):
    setup_table(client)
    client.post(
        "/api/tables/Tasks/columns",
        json={"name": "Len", "type": "formula", "config": {"expression": "LEN({Title})"}},
    )
    r = client.post(
        "/api/tables/Tasks/views",
        json={"name": "Bad", "config": {"filters": [{"column": "Len", "op": "gt", "value": 1}]}},
    )
    assert r.status_code == 400
    assert "computed" in r.get_json()["error"]


def test_direct_endpoint_applies_a_view(client):
    setup_table(client)
    table_id = client.get("/api/tables/Tasks").get_json()["id"]
    client.post(
        "/api/tables/Tasks/views",
        json={
            "name": "Open",
            "config": {"filters": [{"column": "Done", "op": "eq", "value": False}]},
        },
    )
    page = client.get(f"/api/tables/{table_id}?view=Open").get_json()
    assert [row["values"]["Title"] for row in page["records"]] == ["beta"]
    assert page["total"] == 1


def test_mcp_views_round_trip(client):
    def rpc(name, arguments):
        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        result = client.post("/mcp", json=body).get_json()["result"]
        assert "isError" not in result, result["content"][0]["text"]
        return result["structuredContent"]

    rpc(
        "create_table",
        {
            "name": "Marks",
            "columns": [{"name": "Name", "type": "string"}, {"name": "Score", "type": "number"}],
        },
    )
    for name, score in [("a", 1), ("b", 5), ("c", 3)]:
        rpc("create_record", {"table": "Marks", "values": {"Name": name, "Score": score}})
    view = rpc(
        "create_view",
        {
            "table": "Marks",
            "name": "High",
            "config": {
                "filters": [{"column": "Score", "op": "gte", "value": 3}],
                "order_by": "Score",
                "order": "desc",
            },
        },
    )
    assert view["name"] == "High"
    listed = rpc("list_records", {"table": "Marks", "view": "High"})
    assert [row["values"]["Name"] for row in listed["records"]] == ["b", "c"]
    rpc("update_view", {"table": "Marks", "view": "High", "name": "Top"})
    assert [v["name"] for v in rpc("list_views", {"table": "Marks"})["views"]] == ["Top"]
    rpc("delete_view", {"table": "Marks", "view": "Top"})
    assert rpc("list_views", {"table": "Marks"})["views"] == []
