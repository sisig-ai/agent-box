"""Shell HTTP blueprint: id validation, status mapping, dims clamping (backend mocked)."""

from types import SimpleNamespace

import pytest

import dashboard.shell.api as shell_api
from dashboard.shell.tmux import check_shell_id, parse_dims

BACKEND = (
    "ensure_session",
    "capture_pane",
    "paste_text",
    "send_key",
    "resize_session",
    "kill_session",
    "list_sessions",
)
BAD_ID = "bad;command"


@pytest.fixture
def mocks(monkeypatch):
    calls = {name: [] for name in BACKEND}
    state = {}
    for name in BACKEND:

        def make(fn_name):
            def fn(*args, **kwargs):
                calls[fn_name].append((args, kwargs))
                return state[fn_name]

            return fn

        monkeypatch.setattr(shell_api, name, make(name))
    return SimpleNamespace(calls=calls, state=state)


def test_parse_dims_clamps_and_rejects_garbage():
    assert parse_dims(1, 1) == (20, 5)
    assert parse_dims(9999, 9999) == (300, 100)
    assert parse_dims(100, 40) == (100, 40)
    assert parse_dims("x", 24) is None
    assert parse_dims(80, None) is None


def test_check_shell_id_allowlist():
    assert check_shell_id("abc_123-XYZ") == "abc_123-XYZ"
    assert check_shell_id(BAD_ID) is None
    assert check_shell_id("") is None
    assert check_shell_id("a" * 33) is None


# ---------------- /api/shell/new ----------------


def test_new_returns_backend_info(client, mocks):
    mocks.state["ensure_session"] = (
        "ok",
        {"id": "abc", "session": "dash-abc", "cols": 80, "rows": 24, "cwd": "~"},
    )
    r = client.post("/api/shell/new", json={"id": "abc", "cols": 80, "rows": 24})
    assert r.status_code == 200
    assert r.get_json()["session"] == "dash-abc"
    assert mocks.calls["ensure_session"] == [(("abc", 80, 24), {})]


def test_new_generates_id_when_invalid(client, mocks):
    mocks.state["ensure_session"] = (
        "ok",
        {"id": "gen", "session": "dash-gen", "cols": 80, "rows": 24, "cwd": "~"},
    )
    r = client.post("/api/shell/new", json={"id": BAD_ID})
    assert r.status_code == 200
    sid = mocks.calls["ensure_session"][0][0][0]
    assert sid != BAD_ID
    assert check_shell_id(sid)


def test_new_backend_error_is_500(client, mocks):
    mocks.state["ensure_session"] = ("error", "boom")
    r = client.post("/api/shell/new", json={})
    assert r.status_code == 500
    assert r.get_json() == {"error": "boom"}


# ---------------- /api/shell/pane ----------------


def test_pane_bad_id_is_404(client):
    r = client.get("/api/shell/pane", query_string={"id": BAD_ID})
    assert r.status_code == 404
    assert r.get_json() == {"error": "unknown shell id"}


def test_pane_alive(client, mocks):
    mocks.state["capture_pane"] = {
        "id": "abc",
        "alive": True,
        "text": "hi",
        "cursor_x": 0,
        "cursor_y": 0,
        "cols": 80,
        "rows": 24,
        "cmd": "zsh",
    }
    r = client.get("/api/shell/pane", query_string={"id": "abc"})
    assert r.status_code == 200
    assert r.get_json()["text"] == "hi"


def test_pane_gone_is_404(client, mocks):
    mocks.state["capture_pane"] = {"id": "abc", "alive": False}
    r = client.get("/api/shell/pane", query_string={"id": "abc"})
    assert r.status_code == 404
    assert r.get_json() == {"id": "abc", "alive": False}


def test_pane_timeout_is_504(client, mocks):
    mocks.state["capture_pane"] = {"id": "abc", "alive": False, "error": "shell command timed out"}
    r = client.get("/api/shell/pane", query_string={"id": "abc"})
    assert r.status_code == 504
    assert r.get_json() == {"error": "shell command timed out"}


# ---------------- input / key ----------------


def test_input_bad_id_is_400(client):
    r = client.post("/api/shell/input", json={"id": BAD_ID, "text": "no"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "id and non-empty text required"}


def test_key_bad_id_is_400(client):
    r = client.post("/api/shell/key", json={"id": BAD_ID, "key": "Enter"})
    assert r.status_code == 400
    assert r.get_json() == {"error": "unknown shell id or key"}


@pytest.mark.parametrize(
    "backend_status,code", [("ok", 200), ("bad", 400), ("gone", 404), ("error", 500)]
)
def test_input_status_mapping(client, mocks, backend_status, code):
    mocks.state["paste_text"] = (backend_status, None if backend_status == "ok" else "msg")
    r = client.post("/api/shell/input", json={"id": "abc", "text": "ls"})
    assert r.status_code == code


@pytest.mark.parametrize(
    "backend_status,code", [("ok", 200), ("bad", 400), ("gone", 404), ("error", 500)]
)
def test_key_status_mapping(client, mocks, backend_status, code):
    mocks.state["send_key"] = (backend_status, None if backend_status == "ok" else "msg")
    r = client.post("/api/shell/key", json={"id": "abc", "key": "Enter"})
    assert r.status_code == code


# ---------------- resize / kill ----------------


def test_resize_bad_id_is_400(client):
    r = client.post("/api/shell/resize", json={"id": BAD_ID, "cols": 80, "rows": 24})
    assert r.status_code == 400
    assert r.get_json() == {"error": "unknown shell id"}


def test_resize_garbage_dims_is_400(client):
    r = client.post("/api/shell/resize", json={"id": "abc", "cols": "x", "rows": 24})
    assert r.status_code == 400
    assert r.get_json() == {"error": "cols/rows must be numbers"}


def test_resize_ok_clamps_before_backend(client, mocks):
    mocks.state["resize_session"] = ("ok", {"cols": 300, "rows": 5})
    r = client.post("/api/shell/resize", json={"id": "abc", "cols": 9999, "rows": 1})
    assert r.status_code == 200
    assert r.get_json() == {"ok": True, "cols": 300, "rows": 5}
    assert mocks.calls["resize_session"] == [(("abc", 300, 5), {})]


def test_resize_gone_is_404(client, mocks):
    mocks.state["resize_session"] = ("gone", "no such shell session")
    r = client.post("/api/shell/resize", json={"id": "abc", "cols": 80, "rows": 24})
    assert r.status_code == 404


def test_kill_bad_id_is_400(client):
    r = client.post("/api/shell/kill", json={"id": BAD_ID})
    assert r.status_code == 400
    assert r.get_json() == {"error": "unknown shell id"}


def test_kill_ok(client, mocks):
    mocks.state["kill_session"] = ("ok", {"id": "abc"})
    r = client.post("/api/shell/kill", json={"id": "abc"})
    assert r.status_code == 200
    assert r.get_json() == {"ok": True, "id": "abc"}


def test_kill_error_is_504(client, mocks):
    mocks.state["kill_session"] = ("error", "shell command timed out")
    r = client.post("/api/shell/kill", json={"id": "abc"})
    assert r.status_code == 504


# ---------------- list ----------------


def test_list_ok(client, mocks):
    mocks.state["list_sessions"] = {"sessions": [{"id": "abc", "session": "dash-abc", "info": "x"}]}
    r = client.get("/api/shell/list")
    assert r.status_code == 200
    assert r.get_json()["sessions"][0]["id"] == "abc"


def test_list_timeout_is_504(client, mocks):
    mocks.state["list_sessions"] = None
    r = client.get("/api/shell/list")
    assert r.status_code == 504
    assert r.get_json() == {"error": "host command timed out"}
