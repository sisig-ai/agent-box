#!/usr/bin/env python3
"""Thin launcher for the dashboard websocket gateway.

Implementation lives in ``dashboard.ws`` (server/frames/handshake/session).
Kept at the repo root so the installed LaunchDaemon's ``python shell_ws.py``
entry point keeps working unchanged.
"""

from dashboard.ws.server import serve

if __name__ == "__main__":
    serve()
