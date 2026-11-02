"""Access-log rotation: one file per day, seven-day retention in files and SQLite."""

from datetime import date, timedelta

from dashboard import access_log, config


def rpc(client, name, arguments):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }
    return client.post("/mcp", json=payload).get_json()["result"]


def test_rows_are_written_to_todays_file(client):
    rpc(client, "put_doc", {"prefix": "rot/a.md", "content": "x"})
    today = access_log._today()
    path = config.MCP_LOG_DIR / f"access-{today}.log"
    assert path.exists()
    lines = path.read_text().splitlines()
    assert len(lines) == 1
    assert '"tool": "put_doc"' in lines[0]
    assert "prefix=rot/a.md" in lines[0]


def test_day_rollover_starts_a_new_file(client, monkeypatch):
    access_log._close_file()
    monkeypatch.setattr(access_log, "_today", lambda: "2026-11-01")
    rpc(client, "put_doc", {"prefix": "day/one.md", "content": "x"})
    monkeypatch.setattr(access_log, "_today", lambda: "2026-11-02")
    rpc(client, "put_doc", {"prefix": "day/two.md", "content": "x"})
    names = sorted(path.name for path in config.MCP_LOG_DIR.glob("access-*.log"))
    assert names == ["access-2026-11-01.log", "access-2026-11-02.log"]
    assert "day/one.md" in (config.MCP_LOG_DIR / "access-2026-11-01.log").read_text()
    assert "day/two.md" in (config.MCP_LOG_DIR / "access-2026-11-02.log").read_text()
    access_log._close_file()


def test_files_outside_the_window_are_deleted(client, monkeypatch):
    config.MCP_LOG_DIR.mkdir(parents=True, exist_ok=True)
    today = date(2026, 11, 2)
    keep = today - timedelta(days=6)
    drop = today - timedelta(days=8)
    for day in (keep, drop):
        (config.MCP_LOG_DIR / f"access-{day.isoformat()}.log").write_text("{}\n")
    monkeypatch.setattr(access_log, "_today", lambda: today.isoformat())
    rpc(client, "put_doc", {"prefix": "window/a.md", "content": "x"})
    names = {path.name for path in config.MCP_LOG_DIR.glob("access-*.log")}
    assert f"access-{keep.isoformat()}.log" in names
    assert f"access-{drop.isoformat()}.log" not in names
    assert f"access-{today.isoformat()}.log" in names
    access_log._close_file()


def test_rows_older_than_the_window_are_pruned_from_sqlite(client):
    from dashboard import db

    rpc(client, "put_doc", {"prefix": "prune/keep.md", "content": "x"})
    conn = db.connect()
    try:
        with conn:
            conn.execute(
                "INSERT INTO mcp_access_log (ts, tool, entity, ok, ms, args, error)"
                " VALUES (datetime('now', '-30 days'), 'ancient_tool', 'old', 1, 1, '', NULL)"
            )
    finally:
        conn.close()

    entries = client.get("/api/logs").get_json()["entries"]
    assert all(entry["tool"] != "ancient_tool" for entry in entries)


def test_retention_is_reported(client):
    rpc(client, "put_doc", {"prefix": "rot/report.md", "content": "x"})
    data = client.get("/api/logs").get_json()
    assert data["retention_days"] == config.MCP_LOG_RETENTION_DAYS == 7
    assert data["files"]
    assert data["files"][0]["day"] == access_log._today()


def test_rotate_endpoint_forces_a_new_file(client, monkeypatch):
    monkeypatch.setattr(access_log, "_today", lambda: "2026-11-03")
    response = client.post("/api/logs/rotate").get_json()
    assert response == {"day": "2026-11-03", "retention_days": 7}
    assert (config.MCP_LOG_DIR / "access-2026-11-03.log").exists()
    access_log._close_file()
