"""WebSocket wire format: server frames, client-frame decode, close codes.

Stdlib only. Raises ``ConnDead`` when the socket is unusable and
``ProtocolError`` (carrying the RFC 6455 close code) on a malformed client
frame.
"""

import json
import struct

INBOUND_MAX = 1 << 20  # largest acceptable client message


class ConnDead(Exception):
    pass


class ProtocolError(Exception):
    def __init__(self, code=1002):
        super().__init__(f"ws protocol error {code}")
        self.code = code


def send_frame(sock, opcode, payload: bytes):
    """Send one server frame (never masked). Raises ConnDead on failure."""
    header = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header += bytes([n])
    elif n < 65536:
        header += bytes([126]) + struct.pack("!H", n)
    else:
        header += bytes([127]) + struct.pack("!Q", n)
    try:
        sock.sendall(header + payload)
    except OSError:
        raise ConnDead() from None


def send_text(sock, obj):
    send_frame(sock, 0x1, json.dumps(obj, separators=(",", ":")).encode())


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        try:
            chunk = sock.recv(n - len(buf))
        except TimeoutError:
            raise ConnDead() from None
        if not chunk:
            raise ConnDead()
        buf += chunk
    return bytes(buf)


def recv_message(sock):
    """Next client message. Returns ("text", str) | ("pong", b"") | ("close", bytes).

    Handles fragmentation, answers ping with pong inline, and enforces
    masking (required of clients). Raises ConnDead or ProtocolError(code).
    """
    fragments = None
    while True:
        hdr = recv_exact(sock, 2)
        b1, b2 = hdr[0], hdr[1]
        fin, op = b1 & 0x80, b1 & 0x0F
        masked, length = b2 & 0x80, b2 & 0x7F
        if op in (0x3, 0x4, 0x5, 0x6, 0x7):
            raise ProtocolError(1002)
        if length == 126:
            length = struct.unpack("!H", recv_exact(sock, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", recv_exact(sock, 8))[0]
        if not masked:
            raise ProtocolError(1002)
        mask = recv_exact(sock, 4)
        if length > INBOUND_MAX:
            raise ProtocolError(1009)
        payload = recv_exact(sock, length)
        data = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        if op == 0x8:  # close: echo payload back, let the caller break
            return ("close", data)
        if op == 0x9:  # ping -> pong with identical payload
            send_frame(sock, 0xA, data)
            continue
        if op == 0xA:
            return ("pong", b"")
        if op == 0x2:
            raise ProtocolError(1003)
        if op == 0x1:
            fragments = [data]
        elif op == 0x0:
            if fragments is None:
                raise ProtocolError(1002)
            fragments.append(data)
        if sum(map(len, fragments)) > INBOUND_MAX:
            raise ProtocolError(1009)
        if fin:
            try:
                return ("text", b"".join(fragments).decode("utf-8"))
            except UnicodeDecodeError:
                raise ProtocolError(1007) from None
