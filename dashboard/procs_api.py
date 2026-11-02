"""HTTP blueprint for the host process list and signals.

GET  /api/procs?sort=rss|cpu|pid|name&order=desc|asc&limit=40
POST /api/procs/<pid>/signal  {"signal": "TERM"|"KILL"}

The dashboard runs as the logged-in user, so the OS already refuses signals to
root and to other users' processes. Two extra guards live here: pid 1 and this
process's own ancestry (gunicorn master and up) are never signalled, so the UI
cannot kill launchd or the dashboard that serves it.
"""

import os
import signal as signal_module
import time
from datetime import datetime

import psutil
from flask import Blueprint, jsonify, request

bp = Blueprint("procs", __name__)

# psutil reports cpu_percent as the delta since the previous call on the same
# Process object, so the request primes every process, waits one short tick,
# and reads the delta. 120ms keeps the panel accurate on its first paint.
CPU_SAMPLE_S = 0.12
DEFAULT_LIMIT = 40
MAX_LIMIT = 500
SORTS = {"rss": "rss_bytes", "cpu": "cpu_percent", "pid": "pid", "name": "name"}
SIGNALS = {"TERM": signal_module.SIGTERM, "KILL": signal_module.SIGKILL}


def _protected():
    """PIDs the dashboard refuses to signal: init and its own ancestry."""
    pids = {0, 1, os.getpid(), os.getppid()}
    try:
        for parent in psutil.Process().parents():
            pids.add(parent.pid)
    except psutil.Error:
        pass
    return pids


def _prime_cpu(processes):
    for proc in processes:
        try:
            proc.cpu_percent(None)
        except psutil.Error:
            continue


def _row(proc, protected, total_bytes):
    try:
        with proc.oneshot():
            pid = proc.pid
            name = proc.name() or "?"
            username = proc.username()
            status = proc.status()
            rss = proc.memory_info().rss
            cpu = proc.cpu_percent(None)
            try:
                cmdline = " ".join(proc.cmdline())
            except psutil.Error:
                cmdline = ""
    except psutil.Error:
        return None
    return {
        "pid": pid,
        "ppid": proc.ppid(),
        "name": name,
        "user": username,
        "status": status,
        "cmdline": (cmdline or name)[:500],
        "rss_bytes": rss,
        "mem_percent": round(100 * rss / total_bytes, 1) if total_bytes else 0.0,
        "cpu_percent": round(max(0.0, cpu), 1),
        "protected": pid in protected,
    }


def process_rows():
    processes = list(psutil.process_iter())
    _prime_cpu(processes)
    time.sleep(CPU_SAMPLE_S)
    protected = _protected()
    total_bytes = psutil.virtual_memory().total
    rows = [row for row in (_row(proc, protected, total_bytes) for proc in processes) if row]
    return rows, protected


@bp.get("/api/procs")
def procs_list():
    """Live process snapshot, sorted server-side; default is top memory."""
    sort_key = request.args.get("sort", "rss").lower()
    if sort_key not in SORTS:
        return jsonify({"error": f"sort must be one of {', '.join(SORTS)}"}), 400
    order = request.args.get("order", "desc").lower()
    if order not in ("asc", "desc"):
        return jsonify({"error": "order must be asc or desc"}), 400
    try:
        limit = max(1, min(int(request.args.get("limit", DEFAULT_LIMIT)), MAX_LIMIT))
    except (TypeError, ValueError):
        return jsonify({"error": "limit must be an integer"}), 400

    rows, _protected_pids = process_rows()
    field = SORTS[sort_key]
    rows.sort(
        key=lambda row: row["name"].lower() if field == "name" else row[field],
        reverse=order == "desc",
    )
    return jsonify(
        {
            "t": datetime.now().astimezone().isoformat(timespec="seconds"),
            "sort": sort_key,
            "order": order,
            "total": len(rows),
            "count": min(len(rows), limit),
            "cpu_sample_s": CPU_SAMPLE_S,
            "procs": rows[:limit],
        }
    )


@bp.post("/api/procs/<int:pid>/signal")
def procs_signal(pid):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "request body must be a JSON object with a signal field"}), 400
    sig_name = str(body.get("signal", "")).upper()
    if sig_name not in SIGNALS:
        return jsonify({"error": "signal must be TERM or KILL"}), 400
    if pid in _protected():
        return jsonify(
            {
                "error": f"refusing to signal pid {pid}: init or part of the dashboard",
            }
        ), 403
    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return jsonify({"error": f"no process with pid {pid}"}), 404
    try:
        name = proc.name()
    except psutil.Error:
        name = "?"
    try:
        proc.send_signal(SIGNALS[sig_name])
    except psutil.NoSuchProcess:
        return jsonify({"error": f"no process with pid {pid}"}), 404
    except psutil.AccessDenied:
        return jsonify(
            {
                "error": f"permission denied for pid {pid} ({name}); it runs as another user",
            }
        ), 403
    return jsonify({"pid": pid, "name": name, "signal": sig_name, "sent": True})
