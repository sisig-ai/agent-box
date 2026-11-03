"""ASGI entry point: the LaunchDaemon runs ``uvicorn app:app`` from here."""

from dashboard import create_app

app = create_app()
