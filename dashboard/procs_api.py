"""Host process list and signals (FastAPI).

psutil blocks (it primes cpu_percent, sleeps 120ms, then reads the delta), so
every call runs in the threadpool. Two guards stay: pid 1 and the dashboard's
own ancestry are never signalled.
"""

import os
import signal as signal_module
import time
from datetime import datetime

import psutil
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

router = APIRouter()

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


@router.get("/api/procs")
async def procs_list(sort: str = "rss", order: str = "desc", limit: str = str(DEFAULT_LIMIT)):
    """Live process snapshot, sorted server-side; default is top memory."""
    sort_key = sort.lower()
    if sort_key not in SORTS:
        return JSONResponse(
            status_code=400, content={"error": f"sort must be one of {', '.join(SORTS)}"}
        )
    direction = order.lower()
    if direction not in ("asc", "desc"):
        return JSONResponse(status_code=400, content={"error": "order must be asc or desc"})
    try:
        size = max(1, min(int(limit), MAX_LIMIT))
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"error": "limit must be an integer"})

    rows, _protected_pids = await run_in_threadpool(process_rows)
    field = SORTS[sort_key]
    rows.sort(
        key=lambda row: row["name"].lower() if field == "name" else row[field],
        reverse=direction == "desc",
    )
    return {
        "t": datetime.now().astimezone().isoformat(timespec="seconds"),
        "sort": sort_key,
        "order": direction,
        "total": len(rows),
        "count": min(len(rows), size),
        "cpu_sample_s": CPU_SAMPLE_S,
        "procs": rows[:size],
    }


@router.post("/api/procs/{pid}/signal")
async def procs_signal(pid: int, request: Request):
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        return JSONResponse(
            status_code=400,
            content={"error": "request body must be a JSON object with a signal field"},
        )
    sig_name = str(body.get("signal", "")).upper()
    if sig_name not in SIGNALS:
        return JSONResponse(status_code=400, content={"error": "signal must be TERM or KILL"})
    protected = await run_in_threadpool(_protected)
    if pid in protected:
        return JSONResponse(
            status_code=403,
            content={"error": f"refusing to signal pid {pid}: init or part of the dashboard"},
        )
    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return JSONResponse(status_code=404, content={"error": f"no process with pid {pid}"})
    try:
        name = proc.name()
    except psutil.Error:
        name = "?"
    try:
        proc.send_signal(SIGNALS[sig_name])
    except psutil.NoSuchProcess:
        return JSONResponse(status_code=404, content={"error": f"no process with pid {pid}"})
    except psutil.AccessDenied:
        return JSONResponse(
            status_code=403,
            content={"error": f"permission denied for pid {pid} ({name}); it runs as another user"},
        )
    return {"pid": pid, "name": name, "signal": sig_name, "sent": True}
