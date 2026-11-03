"""Tables: schema, typed cells, formulas, refs, rollups, archive, MCP."""


def new_table(client, name="Tasks", columns=()):
    created = client.post("/api/tables", json={"name": name}).get_json()
    for spec in columns:
        r = client.post(f"/api/tables/{name}/columns", json=spec)
        assert r.status_code == 201, r.get_json()
    return created


def test_table_crud_and_archive(client):
    table = new_table(client)
    assert table["name"] == "Tasks"
    assert client.get("/api/tables").get_json()["tables"][0]["record_count"] == 0
    assert client.post("/api/tables", json={"name": "tasks"}).status_code == 409
    renamed = client.patch("/api/tables/Tasks", json={"name": "Jobs"}).get_json()
    assert renamed["name"] == "Jobs"
    archived = client.patch("/api/tables/Jobs", json={"archived": True}).get_json()
    assert archived["archived_at"]
    assert client.get("/api/tables").get_json()["tables"] == []
    assert len(client.get("/api/tables?include_archived=1").get_json()["tables"]) == 1
    assert client.delete("/api/tables/Jobs").status_code == 200
    assert client.get("/api/tables").get_json()["tables"] == []


def test_column_types_validate_their_config(client):
    new_table(client)
    select = client.post(
        "/api/tables/Tasks/columns",
        json={
            "name": "Status",
            "type": "string",
            "subtype": "select",
            "config": {"options": ["todo", "done"]},
        },
    )
    assert select.status_code == 201
    assert select.get_json()["config"]["options"] == ["todo", "done"]
    assert (
        client.post("/api/tables/Tasks/columns", json={"name": "Bad", "type": "list"}).status_code
        == 400
    )
    assert (
        client.post(
            "/api/tables/Tasks/columns", json={"name": "F", "type": "formula", "config": {}}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/tables/Tasks/columns",
            json={"name": "R", "type": "ref", "config": {"table_id": 999}},
        ).status_code
        == 404
    )


def test_typed_cells_round_trip(client):
    new_table(
        client,
        columns=[
            {"name": "Title", "type": "string"},
            {"name": "Done", "type": "bool"},
            {"name": "Pages", "type": "number", "subtype": "int"},
            {"name": "Link", "type": "url"},
            {
                "name": "Tags",
                "type": "string",
                "subtype": "multi_select",
                "config": {"options": ["a", "b"]},
            },
            {"name": "When", "type": "timestamp"},
        ],
    )
    record = client.post(
        "/api/tables/Tasks/records",
        json={
            "values": {
                "Title": "Dune",
                "Done": True,
                "Pages": "412",
                "Link": "https://dune.example",
                "Tags": ["a", "b"],
                "When": "2026-11-03T10:00:00+08:00",
            }
        },
    ).get_json()
    assert record["values"]["Pages"] == 412
    assert record["values"]["Tags"] == ["a", "b"]

    bad = client.patch(
        f"/api/tables/Tasks/records/{record['id']}", json={"values": {"Link": "not a url"}}
    )
    assert bad.status_code == 400
    assert (
        client.patch(
            f"/api/tables/Tasks/records/{record['id']}", json={"values": {"Tags": ["c"]}}
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/tables/Tasks/records/{record['id']}", json={"values": {"Pages": "many"}}
        ).status_code
        == 400
    )


def test_unknown_columns_and_computed_writes_are_rejected(client):
    new_table(
        client,
        columns=[
            {"name": "Title", "type": "string"},
            {"name": "Double", "type": "formula", "config": {"expression": "1 + 1"}},
        ],
    )
    assert client.post("/api/tables/Tasks/records", json={"values": {"Nope": 1}}).status_code == 400
    record = client.post("/api/tables/Tasks/records", json={"values": {"Title": "x"}}).get_json()
    assert record["values"]["Double"] == 2
    assert (
        client.patch(
            f"/api/tables/Tasks/records/{record['id']}", json={"values": {"Double": 5}}
        ).status_code
        == 400
    )


def test_formula_references_other_cells(client):
    new_table(
        client,
        columns=[
            {"name": "Title", "type": "string"},
            {"name": "Pages", "type": "number", "subtype": "int"},
            {
                "name": "Label",
                "type": "formula",
                "config": {"expression": 'CONCAT({Title}, " (", {Pages}, "p)")'},
            },
            {"name": "Long", "type": "formula", "config": {"expression": "{Pages} > 300"}},
        ],
    )
    record = client.post(
        "/api/tables/Tasks/records", json={"values": {"Title": "Dune", "Pages": 412}}
    ).get_json()
    assert record["values"]["Label"] == "Dune (412p)"
    assert record["values"]["Long"] is True


def test_refs_and_rollups(client):
    new_table(
        client,
        "Vendors",
        [
            {"name": "Name", "type": "string"},
            {"name": "Spend", "type": "number", "subtype": "float"},
        ],
    )
    vendor = client.post(
        "/api/tables/Vendors/records", json={"values": {"Name": "Acme", "Spend": 100}}
    ).get_json()
    vendor2 = client.post(
        "/api/tables/Vendors/records", json={"values": {"Name": "Globex", "Spend": 250}}
    ).get_json()
    vendor_table = client.get("/api/tables/Vendors").get_json()
    client.post("/api/tables", json={"name": "Orders"})
    client.post("/api/tables/Orders/columns", json={"name": "Label", "type": "string"})
    client.post(
        "/api/tables/Orders/columns",
        json={
            "name": "Vendors",
            "type": "ref",
            "config": {"table_id": vendor_table["id"], "multiple": True},
        },
    )
    client.post(
        "/api/tables/Orders/columns",
        json={
            "name": "Spend",
            "type": "rollup",
            "config": {
                "table_id": vendor_table["id"],
                "ref_column": "Vendors",
                "target_column": "Spend",
                "aggregate": "sum",
            },
        },
    )
    client.post(
        "/api/tables/Orders/columns",
        json={
            "name": "How many",
            "type": "rollup",
            "config": {
                "table_id": vendor_table["id"],
                "ref_column": "Vendors",
                "target_column": "Name",
                "aggregate": "count",
            },
        },
    )
    record = client.post(
        "/api/tables/Orders/records",
        json={"values": {"Label": "order", "Vendors": [vendor["id"], vendor2["id"]]}},
    ).get_json()
    assert record["values"]["Spend"] == 350
    assert record["values"]["How many"] == 2
    assert (
        client.post(
            "/api/tables/Orders/records", json={"values": {"Vendors": [999999]}}
        ).status_code
        == 404
    )


def test_record_archive_and_delete(client):
    new_table(client, columns=[{"name": "Title", "type": "string"}])
    record = client.post("/api/tables/Tasks/records", json={"values": {"Title": "x"}}).get_json()
    client.patch(f"/api/tables/Tasks/records/{record['id']}", json={"archived": True})
    assert client.get("/api/tables/Tasks/records").get_json()["records"] == []
    assert (
        len(client.get("/api/tables/Tasks/records?include_archived=1").get_json()["records"]) == 1
    )
    assert client.delete(f"/api/tables/Tasks/records/{record['id']}").status_code == 200
    assert client.get(f"/api/tables/Tasks/records/{record['id']}").status_code == 404


def test_mcp_tables_round_trip(client):
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

    table = rpc(
        "create_table",
        {
            "name": "Books",
            "columns": [
                {"name": "Title", "type": "string"},
                {"name": "Read", "type": "bool"},
                {
                    "name": "Status",
                    "type": "string",
                    "subtype": "select",
                    "config": {"options": ["todo", "done"]},
                },
                {
                    "name": "Label",
                    "type": "formula",
                    "config": {"expression": 'IF({Read}, "read", "unread")'},
                },
            ],
        },
    )
    assert [column["name"] for column in table["columns"]] == ["Title", "Read", "Status", "Label"]
    record = rpc(
        "create_record",
        {"table": "Books", "values": {"Title": "Dune", "Read": True, "Status": "done"}},
    )
    assert record["values"]["Label"] == "read"
    listed = rpc("list_records", {"table": "Books"})
    assert listed["records"][0]["values"]["Title"] == "Dune"
    rpc("update_record", {"table": "Books", "record_id": record["id"], "values": {"Read": False}})
    assert (
        rpc("get_record", {"table": "Books", "record_id": record["id"]})["values"]["Label"]
        == "unread"
    )
    assert rpc("describe_table", {"table": "Books"})["record_count"] == 1
    rpc("delete_record", {"table": "Books", "record_id": record["id"]})
    assert rpc("list_records", {"table": "Books"})["records"] == []


def test_llm_txt_documents_tables(client):
    text = client.get("/llm.txt").data.decode()
    assert "/api/tables" in text
    assert "rollup" in text and "formula" in text


def test_column_rename_and_reconfigure(client):
    new_table(client, columns=[{"name": "Title", "type": "string"}])
    client.post(
        "/api/tables/Tasks/columns",
        json={
            "name": "Status",
            "type": "string",
            "subtype": "select",
            "config": {"options": ["todo", "done"]},
        },
    )
    renamed = client.patch("/api/tables/Tasks/columns/Status", json={"name": "Stage"}).get_json()
    assert renamed["name"] == "Stage"
    wider = client.patch(
        "/api/tables/Tasks/columns/Stage",
        json={"config": {"options": ["todo", "doing", "done"]}},
    ).get_json()
    assert wider["config"]["options"] == ["todo", "doing", "done"]
    assert (
        client.patch("/api/tables/Tasks/columns/Stage", json={"name": "Title"}).status_code == 409
    )  # name clash with the existing Title column


def test_column_type_change_requires_clear_values(client):
    new_table(client, columns=[{"name": "Note", "type": "string"}])
    record = client.post("/api/tables/Tasks/records", json={"values": {"Note": "hello"}}).get_json()
    blocked = client.patch("/api/tables/Tasks/columns/Note", json={"type": "number"})
    assert blocked.status_code == 409
    assert "clear_values" in blocked.get_json()["error"]
    changed = client.patch(
        "/api/tables/Tasks/columns/Note", json={"type": "number", "clear_values": True}
    ).get_json()
    assert changed["type"] == "number"
    assert (
        client.get(f"/api/tables/Tasks/records/{record['id']}").get_json()["values"]["Note"] is None
    )


def test_mcp_update_column(client):
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

    rpc("create_table", {"name": "Marks", "columns": [{"name": "Score", "type": "string"}]})
    record = rpc("create_record", {"table": "Marks", "values": {"Score": "7"}})
    renamed = rpc(
        "update_column",
        {
            "table": "Marks",
            "column": "Score",
            "name": "Points",
            "type": "number",
            "subtype": "int",
            "clear_values": True,
        },
    )
    assert renamed["name"] == "Points" and renamed["type"] == "number"
    fetched = rpc("get_record", {"table": "Marks", "record_id": record["id"]})
    assert fetched["values"]["Points"] is None
    again = rpc(
        "update_record", {"table": "Marks", "record_id": record["id"], "values": {"Points": 9}}
    )
    assert again["values"]["Points"] == 9
