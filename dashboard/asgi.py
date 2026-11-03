"""ASGI application (FastAPI).

Native routes are async and push their blocking work (SQLite, file IO, psutil)
to the threadpool. One middleware owns the request SQLite session; another
enforces the upload ceiling and the cache headers.
"""

import json

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .access_log import LogError
from .docs_api import router as docs_router
from .docs_keys import DocsError
from .fs_api import router as fs_router
from .fs_paths import FsError
from .kanban import KanbanError
from .kanban_api import router as board_router
from .kanban_comments_api import router as comment_router
from .kanban_search_api import router as board_search_router
from .logs_api import router as logs_router
from .mcp import router as mcp_router
from .notes_api import router as notes_router
from .page import render_page
from .procs_api import router as procs_router
from .progress import ProgressError
from .progress_api import router as progress_router
from .shell.api import router as shell_router
from .table_types import TableError
from .tables_api import router as tables_router
from .telemetry_api import router as telemetry_router


def create_app() -> FastAPI:
    app = FastAPI(title="agent-box", docs_url=None, redoc_url=None, openapi_url=None)
    db.init_db()  # idempotent; the schema must exist before the first request

    @app.middleware("http")
    async def db_session(request: Request, call_next):
        """One SQLite connection per request, closed when the response is done."""
        session, token = db.open_session()
        try:
            return await call_next(request)
        finally:
            db.close_session(session, token)

    @app.middleware("http")
    async def upload_limit(request: Request, call_next):
        """Refuse an oversized upload before the body is read into memory."""
        try:
            declared = int(request.headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        limit = config.MAX_UPLOAD_MB * 1024 * 1024
        if declared > limit:
            return JSONResponse(
                status_code=413,
                content={"error": f"upload too large (max {config.MAX_UPLOAD_MB} MB)"},
            )
        return await call_next(request)

    @app.middleware("http")
    async def cache_control(request: Request, call_next):
        """Long immutable cache for versioned assets; revalidate entry points."""
        response = await call_next(request)
        path = request.url.path
        if path.startswith(("/static/fonts/", "/static/vendor/")):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path in ("/", "/index.html", "/config.json"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    def domain_error(_request: Request, exc: Exception):
        return JSONResponse(
            status_code=getattr(exc, "status", 400),
            content={"error": getattr(exc, "message", str(exc))},
        )

    for error_cls in (LogError, DocsError, FsError, KanbanError, ProgressError, TableError):
        app.add_exception_handler(error_cls, domain_error)

    app.include_router(telemetry_router)
    app.include_router(logs_router)
    app.include_router(procs_router)
    app.include_router(progress_router)
    app.include_router(board_router)
    app.include_router(board_search_router)
    app.include_router(comment_router)
    app.include_router(mcp_router)
    app.include_router(notes_router)
    app.include_router(docs_router)
    app.include_router(fs_router)
    app.include_router(shell_router)
    app.include_router(tables_router)

    @app.get("/")
    @app.get("/index.html")
    async def index():
        return HTMLResponse(render_page())

    @app.get("/config.json")
    async def config_json():
        return JSONResponse(json.loads((config.STATIC_DIR / "config.json").read_text()))

    app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")

    @app.get("/{filename:path}")
    async def root_static(filename: str):
        """Files that live at the site root: manifest, sw.js, llms.txt, icons."""
        target = (config.STATIC_DIR / filename).resolve()
        if not str(target).startswith(str(config.STATIC_DIR.resolve())) or not target.is_file():
            return JSONResponse(status_code=404, content={"error": "not found"})
        return FileResponse(target)

    def test_client():
        from .testing import Client

        return Client(app)

    app.test_client = test_client
    return app


app = create_app()
