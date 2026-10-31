"""Full-text search over the Ops Board: /api/opsboard/search (SQLite FTS5)."""


def add(client, title, **extra):
    r = client.post("/api/opsboard/cards", json={"title": title, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def find(client, q, **params):
    r = client.get("/api/opsboard/search", query_string={"q": q, **params})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def ids(body):
    return [card["card_id"] for card in body["cards"]]


def test_query_is_required_and_normalised(client):
    for bad in ("", "   ", "!!!", "-"):
        r = client.get("/api/opsboard/search", query_string={"q": bad})
        assert r.status_code == 400, bad
    card = add(client, "  rotate keys  ")
    body = find(client, "   keys    now  ")
    # "now" is absent, so the ANDed query finds nothing, but the echo is clean.
    assert body["query"] == "keys now" and ids(body) == []
    assert ids(find(client, "keys")) == [card["id"]]


def test_empty_board_returns_no_matches(client):
    body = find(client, "anything")
    assert body == {"query": "anything", "total": 0, "count": 0, "truncated": False, "cards": []}


def test_matches_title_and_marks_the_hit(client):
    card = add(client, "Obsidian vault key rotation")
    add(client, "Weekly groceries")
    body = find(client, "obsidian")
    assert ids(body) == [card["id"]]
    hit = body["cards"][0]
    assert hit["matched"] == ["title"]
    assert "\x01Obsidian\x02" in hit["title_marked"]
    assert hit["lane"] == "Backlog" and hit["lane_id"] == card["lane_id"]
    assert hit["snippet"] is None and body["total"] == 1


def test_matches_body_with_prefix_and_snippet(client):
    card = add(
        client,
        "Cleanup",
        body="## Goal\nRotate the Obsidian vault key\n\n- [ ] ask Operator",
    )
    hit = find(client, "vault")["cards"][0]
    assert hit["card_id"] == card["id"]
    assert "body" in hit["matched"]
    assert hit["snippet_source"] == "body"
    assert "\x01vault\x02" in hit["snippet"]
    # prefix matching: "obsid" still finds "Obsidian"
    assert [c["card_id"] for c in find(client, "obsid")["cards"]] == [card["id"]]


def test_matches_comments(client):
    card = add(client, "Investigate dashboard")
    client.post(
        f"/api/opsboard/cards/{card['id']}/comments",
        json={"author": "Forge", "body": "the gunicorn bind address was stale"},
    )
    add(client, "Unrelated")
    hit = find(client, "gunicorn")["cards"][0]
    assert hit["card_id"] == card["id"]
    assert hit["matched"] == ["comment"]
    assert hit["snippet_source"] == "comment"
    assert "\x01gunicorn\x02" in hit["snippet"]
    # the comment author is searchable too, via the same card
    assert ids(find(client, "Forge")) == [card["id"]]


def test_matches_opname_and_owner(client):
    card = add(client, "Plan the drop", owner="runtime", opname="Operation Valhalla")
    hit = find(client, "valhalla")["cards"][0]
    assert hit["card_id"] == card["id"] and hit["matched"] == ["meta"]
    assert hit["opname"] == "Operation Valhalla"
    assert ids(find(client, "runtime")) == [card["id"]]


def test_title_hits_outrank_body_hits(client):
    body_card = add(client, "Notes", body="obsidian sync is slow")
    title_card = add(client, "Obsidian sync is slow")
    assert ids(find(client, "obsidian")) == [title_card["id"], body_card["id"]]


def test_phrases_and_exclusions(client):
    add(client, "Vault key rotation", body="rotate the vault key today")
    add(client, "Vault draft", body="vault key planning")
    phrase = find(client, '"vault key"')
    assert len(phrase["cards"]) == 2
    excluded = find(client, "vault -draft")
    assert [c["title"] for c in excluded["cards"]] == ["Vault key rotation"]
    # FTS5 operators in user input are literals, never syntax errors
    assert find(client, "vault OR draft")["total"] == 0
    assert find(client, "vault AND")["total"] == 0  # "AND" is searched as a word
    assert find(client, '"unbalanced')["total"] == 0


def test_archived_filter(client):
    live = add(client, "obsidian live")
    gone = add(client, "obsidian archived")
    client.patch(f"/api/opsboard/cards/{gone['id']}", json={"archived": True})
    assert ids(find(client, "obsidian")) == [live["id"]]
    assert ids(find(client, "obsidian", archived="include")) == [live["id"], gone["id"]]
    assert ids(find(client, "obsidian", archived="only")) == [gone["id"]]
    assert ids(find(client, "obsidian", include_archived="1")) == [live["id"], gone["id"]]
    r = client.get("/api/opsboard/search", query_string={"q": "x", "archived": "maybe"})
    assert r.status_code == 400


def test_filters_by_lane_owner_opname(client):
    mine = add(client, "obsidian done", owner="forge", opname="Op A", status="Done")
    add(client, "obsidian elsewhere", owner="operator", opname="Op B")
    assert ids(find(client, "obsidian", status="done")) == [mine["id"]]
    assert ids(find(client, "obsidian", owner="FORGE")) == [mine["id"]]
    assert ids(find(client, "obsidian", opname="op a")) == [mine["id"]]
    assert find(client, "obsidian", owner="nobody")["total"] == 0
    r = client.get("/api/opsboard/search", query_string={"q": "x", "status": "nowhere"})
    assert r.status_code == 400


def test_limit_and_truncation(client):
    for i in range(3):
        add(client, f"obsidian {i}")
    body = find(client, "obsidian", limit="1")
    assert body["count"] == 1 and body["total"] == 3 and body["truncated"] is True
    assert find(client, "obsidian", limit="200")["truncated"] is False
    for bad in ("0", "abc", "999"):
        r = client.get("/api/opsboard/search", query_string={"q": "x", "limit": bad})
        if bad == "999":
            assert r.status_code == 200  # clamped to the maximum
        else:
            assert r.status_code == 400


def test_index_follows_writes(client):
    card = add(client, "obsidian alpha")
    other = find(client, "alpha")
    assert ids(other) == [card["id"]]
    client.patch(f"/api/opsboard/cards/{card['id']}", json={"title": "obsidian beta"})
    assert find(client, "alpha")["total"] == 0
    assert ids(find(client, "beta")) == [card["id"]]
    client.patch(f"/api/opsboard/cards/{card['id']}", json={"body": "hidden gamma word"})
    assert ids(find(client, "gamma")) == [card["id"]]
    comment = client.post(
        f"/api/opsboard/cards/{card['id']}/comments", json={"author": "forge", "body": "delta"}
    ).get_json()
    assert ids(find(client, "delta")) == [card["id"]]
    client.delete(f"/api/opsboard/cards/{card['id']}/comments/{comment['id']}")
    assert find(client, "delta")["total"] == 0
    client.delete(f"/api/opsboard/cards/{card['id']}")
    assert find(client, "gamma")["total"] == 0


def test_deprecated_alias_matches_canonical(client):
    add(client, "obsidian alias check")
    canonical = client.get("/api/opsboard/search", query_string={"q": "obsidian"}).get_json()
    alias = client.get("/api/kanban/search", query_string={"q": "obsidian"})
    assert alias.status_code == 200 and alias.get_json() == canonical
