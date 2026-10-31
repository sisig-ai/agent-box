"""Deprecated /api/brief and /api/kanban aliases keep working after the rename.

Canonical routes are /api/sitrep and /api/opsboard; the old prefixes are bound to
the same view functions so other bots' routines keep running mid-transition.
"""


def test_brief_alias_reads_sitrep_writes(client):
    r = client.put("/api/sitrep", json={"date": "2026-10-01", "content": "new"})
    assert r.status_code == 200
    assert client.get("/api/brief", query_string={"date": "2026-10-01"}).get_json() == r.get_json()


def test_brief_alias_all_methods(client):
    assert client.put("/api/brief", json={"date": "2026-10-02", "content": "a"}).status_code == 200
    assert client.post("/api/brief", json={"date": "2026-10-03", "content": "b"}).status_code == 200
    got = client.get("/api/sitrep", query_string={"date": "2026-10-03"}).get_json()
    assert got["content"] == "b"
    assert client.get("/api/brief/list").get_json() == client.get("/api/sitrep/list").get_json()
    assert client.delete("/api/brief", query_string={"date": "2026-10-02"}).status_code == 200
    assert (
        client.get("/api/sitrep", query_string={"date": "2026-10-02"}).get_json()["content"] == ""
    )
    assert client.get("/api/brief", query_string={"date": "garbage"}).status_code == 400


def test_brief_alias_default_shape_matches(client):
    old, new = client.get("/api/brief"), client.get("/api/sitrep")
    assert old.status_code == new.status_code == 200
    assert old.get_json() == new.get_json()


def test_kanban_alias_board_shape_matches(client):
    old, new = client.get("/api/kanban"), client.get("/api/opsboard")
    assert old.status_code == new.status_code == 200
    assert old.get_json() == new.get_json()
    assert set(new.get_json()) == {"lanes", "cards"}


def test_kanban_alias_card_lifecycle(client):
    r = client.post("/api/kanban/cards", json={"title": "via alias", "owner": "bot"})
    assert r.status_code == 201
    cid = r.get_json()["id"]
    assert client.get(f"/api/opsboard/cards/{cid}").get_json()["title"] == "via alias"
    assert client.patch(f"/api/kanban/cards/{cid}", json={"status": "done"}).status_code == 200
    assert client.get(f"/api/kanban/cards/{cid}").get_json()["status"] == "Done"
    assert (
        client.get("/api/kanban/cards").get_json() == client.get("/api/opsboard/cards").get_json()
    )
    assert client.post("/api/kanban/archive-done").get_json()["ids"] == [cid]
    archived = client.get("/api/kanban/archived").get_json()
    assert archived == client.get("/api/opsboard/archived").get_json()
    assert [c["id"] for c in archived] == [cid]
    assert client.delete(f"/api/kanban/cards/{cid}").status_code == 200
    assert client.get(f"/api/opsboard/cards/{cid}").status_code == 404


def test_kanban_alias_lanes(client):
    assert (
        client.get("/api/kanban/lanes").get_json() == client.get("/api/opsboard/lanes").get_json()
    )
    assert client.post("/api/kanban/lanes", json={"name": "Review"}).status_code == 201
    assert client.patch("/api/kanban/lanes/review", json={"name": "QA"}).status_code == 200
    assert "QA" in [lane["name"] for lane in client.get("/api/opsboard/lanes").get_json()]
    assert client.delete("/api/kanban/lanes/qa").status_code == 200
    assert (
        client.post("/api/kanban/cards", json={"title": "x", "status": "Nowhere"}).status_code
        == 400
    )


def test_ui_uses_new_names_and_routes(client):
    page = client.get("/").data.decode()
    assert "Daily Sitrep" in page and "Ops Board" in page
    assert "Daily Brief" not in page and "Kanban" not in page
    assert 'id="view-btn-brief"' in page and 'id="view-btn-kanban"' in page
    assert "/api/opsboard" in client.get("/static/js/kanban/api.js").data.decode()
    assert "'/api/sitrep'" in client.get("/static/js/notes/brief.js").data.decode()


def test_llm_txt_documents_canonical_and_deprecated(client):
    doc = client.get("/llm.txt").data.decode()
    assert "/api/sitrep" in doc and "/api/opsboard" in doc
    assert "Deprecated aliases" in doc and "/api/brief" in doc and "/api/kanban" in doc
