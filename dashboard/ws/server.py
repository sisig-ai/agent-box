"""Websocket gateway server: config, accept loop, signal handling.

Run via the root `shell_ws.py` launcher (plist-stable) or import ``serve``.
"""

import os
import signal
import socket
import threading
import time

WS_HOST = os.environ.get("SHELL_WS_HOST", "0.0.0.0")
WS_PORT = int(os.environ.get("SHELL_WS_PORT", "5556"))
WS_PATH = "/ws/shell"

STOP = threading.Event()


def log(*args):
    print(f"[{time.strftime('%H:%M:%S')}]", *args, flush=True)


def serve():
    from dashboard.ws.session import handle_conn

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((WS_HOST, WS_PORT))
    srv.listen(50)
    srv.settimeout(1.0)
    log(f"shell-ws listening on {WS_HOST}:{WS_PORT}{WS_PATH} (backend local macOS tmux)")

    def on_signal(signum, _frame):
        log(f"signal {signum}, stopping")
        STOP.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    while not STOP.is_set():
        try:
            sock, addr = srv.accept()
        except TimeoutError:
            continue
        except OSError:
            break
        threading.Thread(target=handle_conn, args=(sock, addr), daemon=True).start()
    srv.close()
    log("stopped")
