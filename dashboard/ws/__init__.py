"""Websocket gateway package for the dashboard host shell.

Stdlib only (socket/select/threading/json): no third-party deps, matching the
rest of the dashboard. The wire format lives in ``frames``, the HTTP Upgrade in
``handshake``, the per-connection loop in ``session``, and the accept/signal
loop in ``server``.
"""
