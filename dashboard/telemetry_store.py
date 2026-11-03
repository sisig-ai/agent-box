"""Telemetry persistence, history queries, and latest-snapshot reading.

Written once per second by the standalone collector (``telemetry_collector.py``)
and read by the ``/api/stats*`` endpoints. The collector calls into this module
outside the request path, so nothing here may require an app context.
"""

import json
import sqlite3
import time
from datetime import datetime

from . import config, db

# Per-process throttle so a burst of samples can't hammer the shared database.
_TELE_LAST_WRITE = {"t": 0.0}

# Parsed latest-stats.json, keyed on the file's (mtime_ns, size) signature. A
# plain dict is enough under gunicorn --threads 8: the worst case is one
# redundant parse. The signature is only stored after a successful parse, so an
# unreadable file is retried on the next request.
_LATEST_STATS_CACHE = {"sig": None, "snapshot": None}

# Built history payload, keyed on (seconds, current second, telemetry version).
# When the clock ticks or a new row lands, the key changes and the payload
# rebuilds, so no stale response path exists. Plain dict, same thread argument
# as the stats cache.
_HISTORY_CACHE = {"key": None, "payload": None}


POWER_MAX_W = 500  # anything above this is a unit error, never a real reading


def _sane_power(value):
    if value is None:
        return None
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    return amount if 0 <= amount <= POWER_MAX_W else None


def record_telemetry_snapshot(cpu_util, temp_c, mem, cpu_w, gpu_w, total_w):
    """Append one per-second row to the telemetry ring buffer (shared sqlite).

    Called by the collector sampler; the ts-second PRIMARY KEY dedupes a
    same-second row written by a restarted sampler.
    """
    now = time.time()
    if now - _TELE_LAST_WRITE["t"] < 1.0:
        return
    _TELE_LAST_WRITE["t"] = now
    ts = int(now)
    conn = db.connect()
    try:
        with conn:
            conn.execute(
                """INSERT OR IGNORE INTO telemetry
                   (ts, cpu_util, cpu_temp, mem_used, mem_total, pwr_cpu, pwr_gpu, pwr_total)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    ts,
                    cpu_util,
                    temp_c,
                    mem["used_bytes"] if mem else None,
                    mem["total_bytes"] if mem else None,
                    _sane_power(cpu_w),
                    _sane_power(gpu_w),
                    _sane_power(total_w),
                ),
            )
            conn.execute("DELETE FROM telemetry WHERE ts < ?", (ts - config.TELEMETRY_RETENTION_S,))
    except sqlite3.Error:
        pass
    finally:
        conn.close()


def read_latest_stats():
    """Read the collector's latest snapshot file.

    Returns ``(snapshot, None)`` when fresh, or ``(None, reason)`` where reason
    is ``"reconnecting"`` (stale timestamp) or ``"starting"`` (unreadable/invalid)
    so the API layer can render the exact 503 payload. The parse is cached on the
    file's ``(mtime_ns, size)`` signature and reused until the collector rewrites it.
    """
    path = config.DATA_DIR / "latest-stats.json"
    try:
        st = path.stat()
    except OSError:
        return None, "starting"
    sig = (st.st_mtime_ns, st.st_size)
    if sig != _LATEST_STATS_CACHE["sig"]:
        try:
            _LATEST_STATS_CACHE["snapshot"] = json.loads(path.read_text())
        except (OSError, ValueError):
            _LATEST_STATS_CACHE["sig"] = None
            _LATEST_STATS_CACHE["snapshot"] = None
            return None, "starting"
        _LATEST_STATS_CACHE["sig"] = sig
    snapshot = _LATEST_STATS_CACHE["snapshot"]
    try:
        age = time.time() - datetime.fromisoformat(snapshot["t"]).timestamp()
    except (KeyError, TypeError, ValueError):
        return None, "starting"
    if age > 5:
        return None, "reconnecting"
    return {**snapshot, "stale": False}, None


def _telemetry_version():
    """Cheap ``(max ts, row count)`` probe; invalidates the history cache."""
    try:
        with db.get_db() as conn:
            row = conn.execute("SELECT MAX(ts), COUNT(*) FROM telemetry").fetchone()
    except sqlite3.Error:
        return None
    return (row[0], row[1])


def history_series(seconds):
    """Dense per-second series for the graphs; null = no sample.

    Returns ``{start, step, count}`` plus one array per metric. ``seconds`` is
    already clamped by the caller to the retention window. Identical multi-tab
    polls in one telemetry second reuse the cached payload; the key carries the
    current second plus the cheap version probe, so a new row invalidates at once.
    """
    now = int(time.time())
    cached = _HISTORY_CACHE
    key = (seconds, now, _telemetry_version())
    if cached["key"] != key:
        cached["payload"] = _build_history(seconds, now)
        cached["key"] = key
    return cached["payload"]


def _build_history(seconds, now):
    """Build the dense-array payload for one ``(seconds, now)`` pair."""
    start = now - seconds
    n = seconds + 1
    cpu = [None] * n
    temp = [None] * n
    mem_used = [None] * n
    pwr = [None] * n
    pwr_cpu = [None] * n
    pwr_gpu = [None] * n
    mem_total = None
    try:
        with db.get_db() as conn:
            rows = conn.execute(
                """SELECT ts, cpu_util, cpu_temp, mem_used, mem_total,
                          pwr_cpu, pwr_gpu, pwr_total
                   FROM telemetry WHERE ts >= ? ORDER BY ts""",
                (start,),
            ).fetchall()
    except sqlite3.Error:
        rows = []
    for r in rows:
        i = r["ts"] - start
        if 0 <= i < n:
            cpu[i] = r["cpu_util"]
            temp[i] = r["cpu_temp"]
            mem_used[i] = r["mem_used"]
            pwr[i] = r["pwr_total"]
            pwr_cpu[i] = r["pwr_cpu"]
            pwr_gpu[i] = r["pwr_gpu"]
            if r["mem_total"]:
                mem_total = r["mem_total"]
    return {
        "start": start,
        "step": 1,
        "count": n,
        "cpu": cpu,
        "temp": temp,
        "mem_used": mem_used,
        "mem_total": mem_total,
        "pwr": pwr,
        "pwr_cpu": pwr_cpu,
        "pwr_gpu": pwr_gpu,
    }
