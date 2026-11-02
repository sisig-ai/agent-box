"""Process list + signal endpoint: sort, guards, real SIGTERM."""

import os
import subprocess
import sys

import psutil


def test_list_shape_and_sort(client):
    r = client.get("/api/procs?sort=rss&order=desc&limit=20")
    assert r.status_code == 200
    data = r.get_json()
    assert data["sort"] == "rss" and data["order"] == "desc"
    assert data["count"] == len(data["procs"]) <= 20
    assert data["total"] >= data["count"] >= 1
    keys = [p["rss_bytes"] for p in data["procs"]]
    assert keys == sorted(keys, reverse=True)
    row = data["procs"][0]
    assert {
        "pid",
        "name",
        "cmdline",
        "rss_bytes",
        "cpu_percent",
        "mem_percent",
        "user",
        "status",
        "protected",
    } <= set(row)


def test_cpu_sort_and_own_pid(client):
    r = client.get("/api/procs?sort=cpu&order=desc&limit=500")
    assert r.status_code == 200
    data = r.get_json()
    rows = data["procs"]
    assert [p["cpu_percent"] for p in rows] == sorted(
        (p["cpu_percent"] for p in rows), reverse=True
    )
    mine = [p for p in rows if p["pid"] == os.getpid()]
    if mine:  # the test process can fall outside the top 500 on a busy host
        assert mine[0]["protected"] is True


def test_bad_query_is_400(client):
    assert client.get("/api/procs?sort=nope").status_code == 400
    assert client.get("/api/procs?order=sideways").status_code == 400
    assert client.get("/api/procs?limit=lots").status_code == 400


def test_signal_body_validation(client):
    assert client.post("/api/procs/1/signal", json={"signal": "HUP"}).status_code == 400
    assert client.post("/api/procs/1/signal", data="x").status_code == 400
    assert client.post("/api/procs/1/signal", json={}).status_code == 400


def test_signal_refuses_self_and_init(client):
    for pid in (1, os.getpid()):
        r = client.post(f"/api/procs/{pid}/signal", json={"signal": "KILL"})
        assert r.status_code == 403, pid
        assert "refusing" in r.get_json()["error"]


def test_signal_missing_pid_is_404(client):
    r = client.post("/api/procs/4000000/signal", json={"signal": "TERM"})
    assert r.status_code == 404


def test_signal_terminates_a_child(client):
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        assert psutil.pid_exists(child.pid)
        r = client.post(f"/api/procs/{child.pid}/signal", json={"signal": "TERM"})
        assert r.status_code == 200
        body = r.get_json()
        assert body["pid"] == child.pid and body["signal"] == "TERM" and body["sent"] is True
        assert child.wait(timeout=5) is not None
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)


def test_kill_terminates_a_child(client):
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        r = client.post(f"/api/procs/{child.pid}/signal", json={"signal": "KILL"})
        assert r.status_code == 200
        assert child.wait(timeout=5) is not None
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)


def test_unknown_api_still_404(client):
    assert client.get("/api/procs/nope").status_code == 404
