"""Shell endpoints (FastAPI).

Each browser session owns a tmux session on the host; persistence lives in
tmux, not in this process. The tmux helpers block on subprocess, so each call
runs in the threadpool.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from dashboard.shell.tmux import (
    capture_pane,
    check_shell_id,
    ensure_session,
    kill_session,
    list_sessions,
    new_shell_id,
    parse_dims,
    paste_text,
    resize_session,
    send_key,
)

router = APIRouter()


def error(message: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


async def _body(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


@router.post("/api/shell/new")
async def shell_new(request: Request):
    """Create (or attach to) a host tmux session starting in ~."""
    body = await _body(request)
    sid = check_shell_id(body.get("id")) or new_shell_id()
    dims = parse_dims(body.get("cols", 80), body.get("rows", 24)) or (80, 24)
    status, payload = await run_in_threadpool(ensure_session, sid, *dims)
    if status != "ok":
        return error(payload, 500)
    return payload


@router.get("/api/shell/pane")
async def shell_pane(id: str | None = None):
    """Snapshot of the visible pane."""
    sid = check_shell_id(id)
    if sid is None:
        return error("unknown shell id", 404)
    snap = await run_in_threadpool(capture_pane, sid)
    if snap.get("error"):
        return error(snap["error"], 504)
    if not snap["alive"]:
        return JSONResponse(status_code=404, content={"id": sid, "alive": False})
    return snap


@router.post("/api/shell/input")
async def shell_input(request: Request):
    """Type literal text (stdin-piped, no shell quoting)."""
    body = await _body(request)
    sid = check_shell_id(body.get("id"))
    if sid is None:
        return error("id and non-empty text required", 400)
    status, msg = await run_in_threadpool(paste_text, sid, body.get("text", ""))
    if status == "ok":
        return {"ok": True}
    return error(msg, {"gone": 404, "bad": 400}.get(status, 500))


@router.post("/api/shell/key")
async def shell_key(request: Request):
    """Send one allowlisted special key (Enter, arrows, Ctrl-C, …)."""
    body = await _body(request)
    sid = check_shell_id(body.get("id"))
    if sid is None:
        return error("unknown shell id or key", 400)
    status, msg = await run_in_threadpool(send_key, sid, body.get("key", ""))
    if status == "ok":
        return {"ok": True}
    return error(msg, {"gone": 404, "bad": 400}.get(status, 500))


@router.post("/api/shell/resize")
async def shell_resize(request: Request):
    """Resize the pty."""
    body = await _body(request)
    sid = check_shell_id(body.get("id"))
    if sid is None:
        return error("unknown shell id", 400)
    dims = parse_dims(body.get("cols", 80), body.get("rows", 24))
    if dims is None:
        return error("cols/rows must be numbers", 400)
    status, payload = await run_in_threadpool(resize_session, sid, *dims)
    if status != "ok":
        return error(payload, 404)
    return {"ok": True, "cols": payload["cols"], "rows": payload["rows"]}


@router.post("/api/shell/kill")
async def shell_kill(request: Request):
    """Destroy the host tmux session."""
    body = await _body(request)
    sid = check_shell_id(body.get("id"))
    if sid is None:
        return error("unknown shell id", 400)
    status, payload = await run_in_threadpool(kill_session, sid)
    if status != "ok":
        return error(payload, 504)
    return {"ok": True, "id": sid}


@router.get("/api/shell/list")
async def shell_list():
    """List dashboard-owned host shell sessions."""
    data = await run_in_threadpool(list_sessions)
    if data is None:
        return error("host command timed out", 504)
    return data
