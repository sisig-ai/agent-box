"""Daily Sitrep API (/api/sitrep): lifecycle, aliases, validation, list ordering."""


def test_get_default_today_shape(client):
    from dashboard.dates import today_str

    r = client.get("/api/sitrep")
    assert r.status_code == 200
    assert r.get_json() == {"date": today_str(), "content": ""}


def test_get_explicit_date_missing_is_empty(client):
    r = client.get("/api/sitrep", query_string={"date": "2026-10-01"})
    assert r.status_code == 200
    assert r.get_json() == {"date": "2026-10-01", "content": ""}


def test_put_create_readback(client):
    r = client.put("/api/sitrep", json={"date": "2026-10-01", "content": "# Day\n\n- saved"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["date"] == "2026-10-01"
    assert body["content"] == "# Day\n\n- saved"
    assert body["created_at"] and body["updated_at"]
    got = client.get("/api/sitrep", query_string={"date": "2026-10-01"}).get_json()
    assert got["content"] == "# Day\n\n- saved"


def test_put_replace_keeps_created_at(client):
    first = client.put("/api/sitrep", json={"date": "2026-10-01", "content": "one"}).get_json()
    second = client.put("/api/sitrep", json={"date": "2026-10-01", "content": "two"}).get_json()
    assert second["content"] == "two"
    assert second["created_at"] == first["created_at"]


def test_post_alias_creates(client):
    r = client.post("/api/sitrep", json={"date": "2026-10-02", "content": "post"})
    assert r.status_code == 200
    got = client.get("/api/sitrep", query_string={"date": "2026-10-02"}).get_json()
    assert got["content"] == "post"


def test_delete_then_get_empty(client):
    client.put("/api/sitrep", json={"date": "2026-10-01", "content": "x"})
    r = client.delete("/api/sitrep", query_string={"date": "2026-10-01"})
    assert r.status_code == 200
    assert r.get_json() == {"deleted": "2026-10-01"}
    got = client.get("/api/sitrep", query_string={"date": "2026-10-01"}).get_json()
    assert got["content"] == ""


def test_delete_missing_is_404(client):
    r = client.delete("/api/sitrep", query_string={"date": "2026-10-01"})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no entry for that date"}


def test_put_without_content_is_400(client):
    r = client.put("/api/sitrep", json={"date": "2026-10-01"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "content is required"}


def test_bad_date_is_400(client):
    r = client.get("/api/sitrep", query_string={"date": "garbage"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "date must be YYYY-MM-DD"}
    r = client.put("/api/sitrep", json={"date": "garbage", "content": "x"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "date must be YYYY-MM-DD"}


def test_list_newest_first_and_limit(client):
    for day in ("2026-10-01", "2026-10-03", "2026-10-02"):
        client.put("/api/sitrep", json={"date": day, "content": day})
    rows = client.get("/api/sitrep/list").get_json()
    assert [r["date"] for r in rows] == ["2026-10-03", "2026-10-02", "2026-10-01"]
    limited = client.get("/api/sitrep/list", query_string={"limit": "1"}).get_json()
    assert [r["date"] for r in limited] == ["2026-10-03"]
    clamped = client.get("/api/sitrep/list", query_string={"limit": "99999"}).get_json()
    assert len(clamped) == 3  # clamped to max 365, three present


def test_list_garbage_limit_is_400(client):
    r = client.get("/api/sitrep/list", query_string={"limit": "abc"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "limit must be a number"}
