"""ASGI application (FastAPI).

Native routes are async and push their blocking work (SQLite, file IO, psutil)
to the threadpool. The Flask sub-app still serves the blueprints that have not
been converted; it is mounted last so FastAPI matches first. Converting a
blueprint means moving it above the mount and deleting it from legacy.py.
"""

import json

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.wsgi import WSGIMiddleware

from . import config, db
from .legacy import create_legacy_app
from .logs_api import router as logs_router
from .page import render_page
from .procs_api import router as procs_router
from .telemetry_api import router as telemetry_router


def create_app() -> FastAPI:
    app = FastAPI(title="agent-box", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def db_session(request: Request, call_next):
        """One SQLite connection per request, closed when the response is done."""
        session, token = db.open_session()
        try:
            return await call_next(request)
        finally:
            db.close_session(session, token)

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

    app.include_router(telemetry_router)
    app.include_router(logs_router)
    app.include_router(procs_router)

    @app.get("/")
    @app.get("/index.html")
    async def index():
        return HTMLResponse(render_page())

    @app.get("/config.json")
    async def config_json():
        return JSONResponse(json.loads((config.STATIC_DIR / "config.json").read_text()))

    legacy = create_legacy_app()
    app.state.legacy = legacy
    app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")
    app.mount("/", WSGIMiddleware(legacy), name="legacy")

    def test_client():
        from .testing import Client

        return Client(app)

    app.test_client = test_client
    return app


app = create_app()
