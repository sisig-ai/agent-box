"""HTTP Upgrade handshake for the websocket gateway.

Parses the request line + headers, validates path/version/key/shell id, and
writes the 101 response with the RFC 6455 ``Sec-WebSocket-Accept``. Failures
raise ``HandshakeError(code, message)`` so the caller can write a raw HTTP
error response (codes 400/404/408/426/431).
"""

import base64
import hashlib
from urllib.parse import parse_qs, urlparse

from dashboard.shell.tmux import check_shell_id
from dashboard.ws.server import WS_PATH

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class HandshakeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def do_handshake(sock):
    """HTTP Upgrade -> 101. Returns the validated shell id."""
    data = b""
    while b"\r\n\r\n" not in data:
        try:
            chunk = sock.recv(4096)
        except TimeoutError:
            raise HandshakeError(408, "handshake timeout") from None
        if not chunk:
            raise HandshakeError(400, "empty request")
        data += chunk
        if len(data) > 16384:
            raise HandshakeError(431, "headers too large")
    head = data.split(b"\r\n\r\n", 1)[0].decode("latin-1")
    lines = head.split("\r\n")
    parts = lines[0].split()
    if len(parts) < 2:
        raise HandshakeError(400, "bad request")
    method, target = parts[0], parts[1]
    hdr = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            hdr[k.strip().lower()] = v.strip()
    url = urlparse(target)
    if method.upper() != "GET" or url.path != WS_PATH:
        raise HandshakeError(404, "not found")
    if (
        hdr.get("upgrade", "").lower() != "websocket"
        or "upgrade" not in hdr.get("connection", "").lower()
    ):
        raise HandshakeError(400, "websocket upgrade required")
    if hdr.get("sec-websocket-version", "") != "13":
        raise HandshakeError(426, "upgrade required")
    key = hdr.get("sec-websocket-key", "")
    if not key:
        raise HandshakeError(400, "missing key")
    sid = check_shell_id(parse_qs(url.query).get("id", [""])[0])
    if sid is None:
        raise HandshakeError(400, "bad shell id")
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    sock.sendall(
        (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        ).encode()
    )
    return sid
