"""Native telemetry sampler loop: macmon -> latest-stats.json + telemetry table.

Run by the telemetry LaunchDaemon via the thin root ``telemetry_collector.py``.
Deliberately imports no web framework: the DB schema is created explicitly through
``dashboard.db.init_db()`` because importing the web app used to do that as a
side effect (M2 decoupling, known-issue #5).
"""

import json
import os
import signal
import subprocess
import sys
import threading

import psutil

from . import config, db
from .macos_metrics import snapshot
from .telemetry_store import record_telemetry_snapshot

MACMON = "/opt/homebrew/bin/macmon"


def main():
    stop = threading.Event()
    process = None

    def shutdown(*_):
        stop.set()
        if process is not None and process.poll() is None:
            process.terminate()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    psutil.cpu_percent()  # Prime host-wide CPU tick deltas.
    os.umask(0o077)
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    db.init_db()  # Idempotent; the collector owns schema creation now.

    while not stop.is_set():
        process = subprocess.Popen(
            [MACMON, "pipe", "-s", "0", "-i", "1000"],
            stdout=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        try:
            for line in process.stdout:
                if stop.is_set():
                    break
                try:
                    sample = json.loads(line)
                    value = snapshot(sample)
                    temporary = config.DATA_DIR / "latest-stats.json.tmp"
                    temporary.write_text(json.dumps(value))
                    os.replace(temporary, config.DATA_DIR / "latest-stats.json")
                    record_telemetry_snapshot(
                        value["cpu"]["util_percent"],
                        value["cpu"]["temp_c"],
                        value["mem"],
                        value["power"]["cpu_w"],
                        value["power"]["gpu_w"],
                        value["power"]["total_w"],
                    )
                except (ValueError, OSError, KeyError) as error:
                    print(
                        f"Telemetry sample skipped: {type(error).__name__}",
                        file=sys.stderr,
                        flush=True,
                    )
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if not stop.is_set():
            print("Native sampler exited; reconnecting", file=sys.stderr, flush=True)
            stop.wait(2)
