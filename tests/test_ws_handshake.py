"""Handshake: HTTP Upgrade parsing over a socketpair.

Plain pytest — no Flask, no network. ``do_handshake`` runs in a worker thread
so the test can send the request and read the raw HTTP response.
"""

import socket
import threading

import pytest

from dashboard.ws.handshake import GUID, HandshakeError, do_handshake

# RFC 6455 §1.3 sample: this key must yield this accept string.
RFC_KEY = "dGhlIHNhbXBsZSBub25jZQ=="
RFC_ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="


def _request(path="/ws/shell?id=abc123", **headers):
    h = {
        "Host": "macmini",
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": RFC_KEY,
    }
    h.update(headers)
    lines = [f"GET {path} HTTP/1.1"]
    for k, v in h.items():
        if v is not None:
            lines.append(f"{k}: {v}")
    return ("\r\n".join(lines) + "\r\n\r\n").encode()


def _handshake(request_bytes):
    """Drive one handshake. Returns (result_dict, raw_response_bytes)."""
    server, client = socket.socketpair()
    result = {}

    def run():
        try:
            result["sid"] = do_handshake(server)
        except HandshakeError as e:
            result["error"] = e
        finally:
            server.close()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    try:
        client.sendall(request_bytes)
        client.shutdown(socket.SHUT_WR)
    except OSError:
        pass
    resp = b""
    try:
        while b"\r\n\r\n" not in resp:
            chunk = client.recv(4096)
            if not chunk:
                break
            resp += chunk
    except OSError:
        pass
    thread.join(timeout=5)
    client.close()
    return result, resp


def test_happy_path_returns_sid_and_101():
    result, resp = _handshake(_request())
    assert result.get("sid") == "abc123"
    assert resp.startswith(b"HTTP/1.1 101 Switching Protocols\r\n")
    assert f"Sec-WebSocket-Accept: {RFC_ACCEPT}\r\n".encode() in resp
    assert b"Upgrade: websocket\r\n" in resp
    assert b"Connection: Upgrade\r\n" in resp


def test_guid_is_rfc6455_constant():
    assert GUID == "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def test_bad_shell_id_falls_back_to_400():
    # A valid path but an id the regex rejects.
    result, _ = _handshake(_request(path="/ws/shell?id=bad;command"))
    assert result["error"].code == 400


def test_missing_sid_is_400():
    result, _ = _handshake(_request(path="/ws/shell"))
    assert result["error"].code == 400


def test_wrong_path_is_404():
    result, _ = _handshake(_request(path="/nope?id=abc123"))
    assert result["error"].code == 404


def test_missing_key_is_400():
    result, _ = _handshake(_request(**{"Sec-WebSocket-Key": None}))
    assert result["error"].code == 400


def test_non_upgrade_is_400():
    result, _ = _handshake(_request(Upgrade=None))
    assert result["error"].code == 400


def test_wrong_version_is_426():
    result, _ = _handshake(_request(**{"Sec-WebSocket-Version": "8"}))
    assert result["error"].code == 426


def test_oversized_headers_is_431():
    # No CRLFCRLF terminator; the server gives up once > 16384 bytes.
    request = b"GET /ws/shell?id=abc123 HTTP/1.1\r\nX-Pad: " + b"a" * 17000
    result, _ = _handshake(request)
    assert result["error"].code == 431


def test_empty_request_is_400():
    result, _ = _handshake(b"")
    assert result["error"].code == 400


def test_handshake_timeout_is_408():
    server, client = socket.socketpair()
    server.settimeout(0.2)
    try:
        with pytest.raises(HandshakeError) as exc:
            do_handshake(server)
        assert exc.value.code == 408
    finally:
        server.close()
        client.close()
