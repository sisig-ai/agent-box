"""Weekly Schedule API: lifecycle, Monday coercion, validation, list ordering."""

WEEK = "2026-10-01"
MONDAY = "2026-09-28"


def test_get_coerces_week_to_monday(client):
    r = client.get("/api/schedule", query_string={"week": WEEK})
    assert r.status_code == 200
    assert r.get_json() == {"week_start": MONDAY, "content": ""}


def test_get_default_week_is_current_monday(client):
    from dashboard.dates import week_start_for

    r = client.get("/api/schedule")
    assert r.status_code == 200
    assert r.get_json()["week_start"] == week_start_for(None)


def test_put_readback_stores_monday(client):
    r = client.put("/api/schedule", json={"week": WEEK, "content": "# Week"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["week_start"] == MONDAY
    assert body["content"] == "# Week"
    got = client.get("/api/schedule", query_string={"week": WEEK}).get_json()
    assert got["week_start"] == MONDAY
    assert got["content"] == "# Week"


def test_post_alias_creates(client):
    r = client.post("/api/schedule", json={"week": MONDAY, "content": "post"})
    assert r.status_code == 200
    got = client.get("/api/schedule", query_string={"week": MONDAY}).get_json()
    assert got["content"] == "post"


def test_delete_then_get_empty(client):
    client.put("/api/schedule", json={"week": WEEK, "content": "x"})
    r = client.delete("/api/schedule", query_string={"week": WEEK})
    assert r.status_code == 200
    assert r.get_json() == {"deleted": MONDAY}
    got = client.get("/api/schedule", query_string={"week": WEEK}).get_json()
    assert got["content"] == ""


def test_delete_missing_is_404(client):
    r = client.delete("/api/schedule", query_string={"week": WEEK})
    assert r.status_code == 404
    assert r.get_json() == {"error": "no entry for that week"}


def test_put_without_content_is_400(client):
    r = client.put("/api/schedule", json={"week": WEEK})
    assert r.status_code == 400
    assert r.get_json() == {"error": "content is required"}


def test_bad_week_is_400(client):
    r = client.get("/api/schedule", query_string={"week": "garbage"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "week must be YYYY-MM-DD"}
    r = client.put("/api/schedule", json={"week": "garbage", "content": "x"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "week must be YYYY-MM-DD"}


def test_list_newest_first_and_clamp(client):
    for week in ("2026-09-21", MONDAY, "2026-10-05"):
        client.put("/api/schedule", json={"week": week, "content": week})
    rows = client.get("/api/schedule/list").get_json()
    assert [r["week_start"] for r in rows] == ["2026-10-05", MONDAY, "2026-09-21"]
    clamped = client.get("/api/schedule/list", query_string={"limit": "99999"}).get_json()
    assert len(clamped) == 3  # clamped to max 104


def test_list_garbage_limit_is_400(client):
    r = client.get("/api/schedule/list", query_string={"limit": "abc"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "limit must be a number"}
