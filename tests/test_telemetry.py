"""Telemetry store + /api/stats: ring buffer, throttle, retention, dense history."""

import json
import os
import time
from types import SimpleNamespace

from dashboard import config, telemetry_store
from dashboard.db import connect
from dashboard.telemetry_store import history_series, record_telemetry_snapshot

COLUMNS = "ts, cpu_util, cpu_temp, mem_used, mem_total, pwr_cpu, pwr_gpu, pwr_total"


def _insert(ts, **values):
    row = [
        values.get(k)
        for k in (
            "cpu_util",
            "cpu_temp",
            "mem_used",
            "mem_total",
            "pwr_cpu",
            "pwr_gpu",
            "pwr_total",
        )
    ]
    conn = connect()
    try:
        with conn:
            conn.execute(
                f"INSERT OR REPLACE INTO telemetry ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?)",
                (ts, *row),
            )
    finally:
        conn.close()


def _timestamps():
    conn = connect()
    try:
        return [r["ts"] for r in conn.execute("SELECT ts FROM telemetry").fetchall()]
    finally:
        conn.close()


def test_record_snapshot_maps_and_throttles(schema):
    record_telemetry_snapshot(15.2, 42.1, {"used_bytes": 123, "total_bytes": 456}, 1.0, 2.0, 8.4)
    record_telemetry_snapshot(99.9, None, None, None, None, None)  # throttled (<1s)

    hist = history_series(60)
    assert 15.2 in hist["cpu"]
    assert 99.9 not in hist["cpu"]
    assert 42.1 in hist["temp"]
    assert 8.4 in hist["pwr"]
    assert 123 in hist["mem_used"]
    assert hist["mem_total"] == 456
    assert 1.0 in hist["pwr_cpu"]
    assert 2.0 in hist["pwr_gpu"]
    assert hist["step"] == 1
    assert hist["count"] == 61
    assert len(hist["cpu"]) == 61


def test_record_deletes_rows_older_than_retention(schema):
    old = int(time.time()) - config.TELEMETRY_RETENTION_S - 100
    _insert(old, cpu_util=1.0)
    record_telemetry_snapshot(2.0, None, None, None, None, None)
    assert old not in _timestamps()
    assert 2.0 in history_series(config.TELEMETRY_RETENTION_S)["cpu"]


def test_history_dense_offsets_and_null_gaps(schema):
    now = int(time.time())
    _insert(now - 30, cpu_util=5.0)
    _insert(now - 10, cpu_util=7.0)
    hist = history_series(60)
    start = hist["start"]
    assert hist["count"] == 61
    assert hist["cpu"][(now - 30) - start] == 5.0
    assert hist["cpu"][(now - 10) - start] == 7.0
    assert hist["cpu"][(now - 20) - start] is None  # gap carries a null


def test_history_mem_total_from_any_row(schema):
    now = int(time.time())
    _insert(now - 5, cpu_util=1.0, mem_used=10, mem_total=1000)
    assert history_series(60)["mem_total"] == 1000


def test_stats_missing_file_is_503_starting(client):
    r = client.get("/api/stats")
    assert r.status_code == 503
    assert r.get_json() == {"error": "Telemetry sampler is starting", "stale": True}


def test_stats_invalid_file_is_503_starting(client, env):
    (env.data / "latest-stats.json").write_text("not json")
    r = client.get("/api/stats")
    assert r.status_code == 503
    assert r.get_json() == {"error": "Telemetry sampler is starting", "stale": True}


def test_stats_fresh_is_200(client, stats_writer):
    stats_writer(age_seconds=0.0, cpu={"util_percent": 1.0})
    r = client.get("/api/stats")
    assert r.status_code == 200
    body = r.get_json()
    assert body["stale"] is False
    assert body["cpu"] == {"util_percent": 1.0}


def test_stats_stale_is_503_reconnecting(client, stats_writer):
    stats_writer(age_seconds=60.0, cpu={})
    r = client.get("/api/stats")
    assert r.status_code == 503
    assert r.get_json() == {"error": "Telemetry sampler is reconnecting", "stale": True}


def test_stats_parse_is_cached_between_requests(client, stats_writer, monkeypatch):
    stats_writer(age_seconds=0.0, cpu={"util_percent": 1.0})
    calls = []
    real_loads = telemetry_store.json.loads

    def counting_loads(text):
        calls.append(text)
        return real_loads(text)

    monkeypatch.setattr(telemetry_store, "json", SimpleNamespace(loads=counting_loads))
    first = client.get("/api/stats")
    second = client.get("/api/stats")
    assert first.status_code == 200 and second.status_code == 200
    assert first.get_json() == second.get_json()
    assert len(calls) == 1


def test_stats_cache_invalidated_on_rewrite(client, stats_writer, env):
    snapshot = stats_writer(age_seconds=0.0, cpu={"util_percent": 1.0})
    assert client.get("/api/stats").get_json()["cpu"] == {"util_percent": 1.0}
    path = env.data / "latest-stats.json"
    snapshot["cpu"] = {"util_percent": 2.0}
    path.write_text(json.dumps(snapshot))
    st = path.stat()
    os.utime(path, ns=(st.st_mtime_ns + 1_000_000, st.st_mtime_ns + 1_000_000))
    assert client.get("/api/stats").get_json()["cpu"] == {"util_percent": 2.0}


def test_stats_history_seconds_clamp(client):
    assert (
        client.get("/api/stats/history", query_string={"seconds": "10"}).get_json()["count"] == 61
    )
    maxed = client.get("/api/stats/history", query_string={"seconds": "999999"}).get_json()
    assert maxed["count"] == config.TELEMETRY_RETENTION_S + 1
    default = client.get("/api/stats/history", query_string={"seconds": "abc"}).get_json()
    assert default["count"] == 3601
    assert client.get("/api/stats/history").get_json()["count"] == 3601
