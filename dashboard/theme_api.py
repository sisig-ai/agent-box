"""Theme API (FastAPI): list installed themes, save the choice."""

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from . import theme
from .api_kit import error, json_body
from .theme import ThemeError

router = APIRouter()


@router.get("/api/themes")
async def list_themes():
    """GET /api/themes — installed themes with the active one marked."""
    return {"themes": theme.themes(), "active": theme.read_theme()}


@router.post("/api/theme")
async def set_theme(request: Request):
    """POST /api/theme — persist ``{"theme": "<id>"}`` into config.json."""
    body = await json_body(request, ("theme",))
    if body is None or "theme" not in body:
        return error('request body must be JSON {"theme": "<id>"}')
    try:
        saved = await run_in_threadpool(theme.set_theme, body["theme"])
    except ThemeError as exc:
        return error(exc.message, exc.status)
    return {"theme": saved}
