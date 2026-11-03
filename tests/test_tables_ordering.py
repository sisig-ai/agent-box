"""Tables: paging, ordering, and the direct per-table endpoint."""


def new_table(client, name="Tasks", columns=()):
    created = client.post("/api/tables", json={"name": name}).get_json()
    for spec in columns:
        assert client.post(f"/api/tables/{name}/columns", json=spec).status_code == 201
    return created


def test_record_pagination_and_ordering(client):
    new_table(
        client,
        columns=[{"name": "Title", "type": "string"}, {"name": "Score", "type": "number"}],
    )
    for title, score in [("e", 5), ("a", 1), ("c", 3), ("d", None), ("b", 2)]:
        client.post(
            "/api/tables/Tasks/records",
            json={"values": {"Title": title, "Score": score}},
        )
    first = client.get("/api/tables/Tasks/records?limit=2").get_json()
    assert first["count"] == 2 and first["total"] == 5 and first["has_more"] is True
    second = client.get("/api/tables/Tasks/records?limit=2&offset=2").get_json()
    last = client.get("/api/tables/Tasks/records?limit=2&offset=4").get_json()
    assert last["count"] == 1 and last["has_more"] is False
    titles = [
        row["values"]["Title"] for row in first["records"] + second["records"] + last["records"]
    ]
    assert titles == ["e", "a", "c", "d", "b"]  # insertion order by default

    desc = client.get("/api/tables/Tasks/records?order_by=Score&order=desc").get_json()
    assert [row["values"]["Score"] for row in desc["records"]] == [5, 3, 2, 1, None]
    asc = client.get("/api/tables/Tasks/records?order_by=Score").get_json()
    assert [row["values"]["Score"] for row in asc["records"]] == [1, 2, 3, 5, None]
    names = client.get("/api/tables/Tasks/records?order_by=Title&order=desc").get_json()
    assert [row["values"]["Title"] for row in names["records"]] == ["e", "d", "c", "b", "a"]
    assert client.get("/api/tables/Tasks/records?order_by=Nope").status_code == 404


def test_cannot_order_by_a_computed_column(client):
    new_table(
        client,
        columns=[
            {"name": "Title", "type": "string"},
            {"name": "Len", "type": "formula", "config": {"expression": "LEN({Title})"}},
        ],
    )
    r = client.get("/api/tables/Tasks/records?order_by=Len")
    assert r.status_code == 400
    assert "computed" in r.get_json()["error"]


def test_tables_and_columns_ordering(client):
    for name in ("Beta", "Alpha", "Gamma"):
        client.post("/api/tables", json={"name": name})
    client.post("/api/tables/Alpha/records", json={"values": {}})
    by_name = [t["name"] for t in client.get("/api/tables").get_json()["tables"]]
    assert by_name == ["Alpha", "Beta", "Gamma"]
    by_records = [
        t["name"]
        for t in client.get("/api/tables?order_by=records&order=desc").get_json()["tables"]
    ]
    assert by_records[0] == "Alpha"
    assert client.get("/api/tables?order_by=nope").status_code == 400

    client.post("/api/tables/Alpha/columns", json={"name": "Zed", "type": "string"})
    client.post("/api/tables/Alpha/columns", json={"name": "Abe", "type": "string"})
    names = [
        c["name"]
        for c in client.get("/api/tables/Alpha/columns?order_by=name").get_json()["columns"]
    ]
    assert names == ["Abe", "Zed"]
    positions = [c["name"] for c in client.get("/api/tables/Alpha/columns").get_json()["columns"]]
    assert positions == ["Zed", "Abe"]


def test_direct_table_endpoint_pages_and_appends(client):
    table = new_table(client, columns=[{"name": "Title", "type": "string"}])
    for title in ("one", "two", "three"):
        client.post("/api/tables/Tasks/records", json={"values": {"Title": title}})

    page = client.get(f"/api/tables/{table['id']}?limit=2&order_by=Title").get_json()
    assert page["name"] == "Tasks"
    assert [c["name"] for c in page["columns"]] == ["Title"]
    assert [r["values"]["Title"] for r in page["records"]] == ["one", "three"]
    assert page["total"] == 3 and page["has_more"] is True and page["order_by"] == "Title"

    appended = client.post(f"/api/tables/{table['id']}", json={"values": {"Title": "four"}})
    assert appended.status_code == 201
    assert appended.get_json()["values"]["Title"] == "four"

    rest = client.get(f"/api/tables/{table['id']}?offset=2&order_by=Title").get_json()
    assert [r["values"]["Title"] for r in rest["records"]] == ["three", "two"]
    assert rest["has_more"] is False
