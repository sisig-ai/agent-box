"""Gunicorn entry point: the LaunchDaemon runs ``gunicorn app:app`` from here."""

from dashboard import create_app

app = create_app()
