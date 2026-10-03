"""Frames: server encode / client decode round-trips over a socketpair.

Plain pytest — no Flask, no network: ``socket.socketpair()`` gives an in-process
full-duplex pair. Client frames are built masked by hand, exactly as a browser
would send them.
"""

import socket
import struct
import threading

import pytest

from dashboard.ws.frames import (
    INBOUND_MAX,
    ProtocolError,
    recv_message,
    send_frame,
)

MASK = b"\x11\x22\x33\x44"


def _client_frame(opcode, payload=b"", fin=True, masked=True):
    """Build a raw client frame (masked by default, as browsers must)."""
    b1 = (0x80 if fin else 0x00) | opcode
    n = len(payload)
    if n < 126:
        header = bytes([b1, n | (0x80 if masked else 0)])
    elif n < 65536:
        header = bytes([b1, 126 | (0x80 if masked else 0)]) + struct.pack("!H", n)
    else:
        header = bytes([b1, 127 | (0x80 if masked else 0)]) + struct.pack("!Q", n)
    if not masked:
        return header + payload
    masked_payload = bytes(c ^ MASK[i % 4] for i, c in enumerate(payload))
    return header + MASK + masked_payload


def _server_side():
    server, client = socket.socketpair()
    return server, client


def _read_exact(sock, n):
    buf = b""
    while len(buf) < n:
        buf += sock.recv(n - len(buf))
    return buf


def test_send_frame_small_payload():
    server, client = _server_side()
    send_frame(server, 0x1, b"hello")
    assert _read_exact(client, 2) == bytes([0x81, 5])
    assert _read_exact(client, 5) == b"hello"


def test_send_frame_16bit_length():
    server, client = _server_side()
    payload = b"x" * 200
    send_frame(server, 0x1, payload)
    assert _read_exact(client, 2) == bytes([0x81, 126])
    assert struct.unpack("!H", _read_exact(client, 2))[0] == 200
    assert _read_exact(client, 200) == payload


def test_send_frame_64bit_length():
    server, client = _server_side()
    payload = b"y" * 70000
    # Send concurrently: 70 KB overflows the socketpair buffer, so the writer
    # must be draining while we read.
    sender = threading.Thread(target=send_frame, args=(server, 0x2, payload))
    sender.start()
    assert _read_exact(client, 2) == bytes([0x82, 127])
    assert struct.unpack("!Q", _read_exact(client, 8))[0] == 70000
    assert _read_exact(client, 70000) == payload
    sender.join(timeout=5)


def test_recv_text():
    server, client = _server_side()
    client.sendall(_client_frame(0x1, b"hi"))
    assert recv_message(server) == ("text", "hi")


def test_recv_fragmented_text():
    server, client = _server_side()
    client.sendall(_client_frame(0x1, b"he", fin=False))
    client.sendall(_client_frame(0x0, b"llo", fin=True))
    assert recv_message(server) == ("text", "hello")


def test_recv_ping_answered_with_pong_inline():
    server, client = _server_side()
    client.sendall(_client_frame(0x9, b"pingdata"))
    client.sendall(_client_frame(0x1, b"after"))
    # Ping is handled inline; the next data frame is the returned message.
    assert recv_message(server) == ("text", "after")
    assert _read_exact(client, 2) == bytes([0x8A, 8])
    assert _read_exact(client, 8) == b"pingdata"


def test_recv_pong():
    server, client = _server_side()
    client.sendall(_client_frame(0xA, b""))
    assert recv_message(server) == ("pong", b"")


def test_recv_close_echoes_payload():
    server, client = _server_side()
    client.sendall(_client_frame(0x8, b"bye"))
    assert recv_message(server) == ("close", b"bye")


def test_recv_unmasked_is_protocol_error_1002():
    server, client = _server_side()
    client.sendall(_client_frame(0x1, b"plain", masked=False))
    with pytest.raises(ProtocolError) as exc:
        recv_message(server)
    assert exc.value.code == 1002


def test_recv_binary_is_protocol_error_1003():
    server, client = _server_side()
    client.sendall(_client_frame(0x2, b"\x00\x01"))
    with pytest.raises(ProtocolError) as exc:
        recv_message(server)
    assert exc.value.code == 1003


def test_recv_oversize_is_protocol_error_1009():
    server, client = _server_side()
    # 64-bit length just over the limit; recv_message rejects before payload.
    header = bytes([0x81, 0xFF]) + struct.pack("!Q", INBOUND_MAX + 1)
    client.sendall(header + MASK)
    with pytest.raises(ProtocolError) as exc:
        recv_message(server)
    assert exc.value.code == 1009


def test_recv_bad_utf8_is_protocol_error_1007():
    server, client = _server_side()
    client.sendall(_client_frame(0x1, b"\xff\xfe"))
    with pytest.raises(ProtocolError) as exc:
        recv_message(server)
    assert exc.value.code == 1007
