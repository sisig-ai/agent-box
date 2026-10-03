"""handle_message dispatch with the tmux backend mocked (socketpair, no network)."""

import json
import socket
import struct

import pytest

import dashboard.ws.session as ws_session


def _read_exact(sock, n):
    buf = b""
    while len(buf) < n:
        buf += sock.recv(n - len(buf))
    return buf


def _read_text(sock):
    header = _read_exact(sock, 2)
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", _read_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", _read_exact(sock, 8))[0]
    return json.loads(_read_exact(sock, length).decode())


@pytest.fixture
def sock():
    server, client = socket.socketpair()
    yield server, client
    server.close()
    client.close()


def _send(sock_pair, message):
    server, client = sock_pair
    return ws_session.handle_message(server, "abc", json.dumps(message)), client


def test_input_happy_does_not_emit_a_frame(sock, monkeypatch):
    monkeypatch.setattr(ws_session, "paste_text", lambda sid, text: ("ok", None))
    assert ws_session.handle_message(sock[0], "abc", json.dumps({"t": "input", "text": "ls"})) == (
        True,
        False,
    )


def test_input_error_emits_error_frame(sock, monkeypatch):
    monkeypatch.setattr(
        ws_session, "paste_text", lambda sid, text: ("gone", "no such shell session")
    )
    result, client = _send(sock, {"t": "input", "text": "ls"})
    assert result == (False, False)
    assert _read_text(client) == {"t": "error", "error": "no such shell session"}


def test_key_happy_and_error(sock, monkeypatch):
    monkeypatch.setattr(ws_session, "send_key", lambda sid, key: ("ok", None))
    assert ws_session.handle_message(sock[0], "abc", json.dumps({"t": "key", "key": "Enter"})) == (
        True,
        False,
    )
    monkeypatch.setattr(ws_session, "send_key", lambda sid, key: ("bad", "unknown shell id or key"))
    result, client = _send(sock, {"t": "key", "key": "Nope"})
    assert result == (False, False)
    assert _read_text(client) == {"t": "error", "error": "unknown shell id or key"}


def test_resize_clamps_before_backend(sock, monkeypatch):
    captured = {}

    def fake_resize(sid, cols, rows):
        captured["dims"] = (cols, rows)
        return ("ok", {"cols": cols, "rows": rows})

    monkeypatch.setattr(ws_session, "resize_session", fake_resize)
    result = ws_session.handle_message(
        sock[0], "abc", json.dumps({"t": "resize", "cols": 9999, "rows": 1})
    )
    assert result == (True, False)
    assert captured["dims"] == (300, 5)


def test_resize_garbage_emits_error_frame(sock):
    result, client = _send(sock, {"t": "resize", "cols": None, "rows": None})
    assert result == (False, False)
    assert _read_text(client) == {"t": "error", "error": "cols/rows must be numbers"}


def test_resize_gone_emits_error_frame(sock, monkeypatch):
    monkeypatch.setattr(ws_session, "resize_session", lambda sid, cols, rows: ("gone", "x"))
    result, client = _send(sock, {"t": "resize", "cols": 80, "rows": 24})
    assert result == (False, False)
    assert _read_text(client) == {"t": "error", "error": "no such shell session"}


def test_new_recreates_and_preserves_dims(sock, monkeypatch):
    monkeypatch.setattr(
        ws_session, "capture_pane", lambda sid: {"id": sid, "alive": True, "cols": 120, "rows": 40}
    )
    killed = []

    def fake_kill(sid):
        killed.append(sid)
        return ("ok", {"id": sid})

    monkeypatch.setattr(ws_session, "kill_session", fake_kill)
    ensured = {}

    def fake_ensure(sid, cols, rows):
        ensured["dims"] = (cols, rows)
        return ("ok", {"id": sid, "session": f"dash-{sid}", "cols": cols, "rows": rows, "cwd": "~"})

    monkeypatch.setattr(ws_session, "ensure_session", fake_ensure)
    result, client = _send(sock, {"t": "new"})
    assert result == (True, True)
    assert killed == ["abc"]
    assert ensured["dims"] == (120, 40)
    assert _read_text(client) == {
        "t": "hello",
        "id": "abc",
        "session": "dash-abc",
        "cols": 120,
        "rows": 40,
        "cwd": "~",
    }


def test_new_uses_default_dims_when_pane_dead(sock, monkeypatch):
    monkeypatch.setattr(ws_session, "capture_pane", lambda sid: {"id": sid, "alive": False})
    monkeypatch.setattr(ws_session, "kill_session", lambda sid: ("ok", {"id": sid}))
    ensured = {}

    def fake_ensure(sid, cols, rows):
        ensured["dims"] = (cols, rows)
        return ("ok", {"id": sid, "session": f"dash-{sid}", "cols": cols, "rows": rows, "cwd": "~"})

    monkeypatch.setattr(ws_session, "ensure_session", fake_ensure)
    assert _send(sock, {"t": "new"})[0] == (True, True)
    assert ensured["dims"] == (100, 30)


def test_new_backend_error_emits_error_frame(sock, monkeypatch):
    monkeypatch.setattr(
        ws_session, "capture_pane", lambda sid: {"id": sid, "alive": True, "cols": 80, "rows": 24}
    )
    monkeypatch.setattr(ws_session, "kill_session", lambda sid: ("ok", {"id": sid}))
    monkeypatch.setattr(ws_session, "ensure_session", lambda sid, cols, rows: ("error", "boom"))
    result, client = _send(sock, {"t": "new"})
    assert result == (False, False)
    assert _read_text(client) == {"t": "error", "error": "boom"}


def test_unknown_message_emits_error_frame(sock):
    result, client = _send(sock, {"t": "nope"})
    assert result == (False, False)
    assert _read_text(client) == {"t": "error", "error": "unknown message"}


def test_invalid_json_emits_error_frame(sock):
    server, client = sock
    assert ws_session.handle_message(server, "abc", "{not json") == (False, False)
    assert _read_text(client) == {"t": "error", "error": "invalid JSON"}


def test_non_dict_message_emits_error_frame(sock):
    result, client = _send(sock, [1, 2])
    assert result == (False, False)
    assert _read_text(client) == {"t": "error", "error": "invalid message"}
