"""SQLite access: schema, request-scoped connection reuse, WAL settings.

Flask is imported lazily (inside ``get_db`` / ``close_db``) so the telemetry
collector can import this module without pulling Flask into the sampler
process; those helpers are only ever reached from a Flask request or teardown.
"""

import sqlite3

from . import config


def connect():
    """A new fully configured connection; the caller owns its lifetime."""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def get_db():
    """One connection per Flask app context; a fresh one outside a request.

    The collector calls into the DB directly (no app context), so this must not
    assume ``g`` exists.
    """
    from flask import g, has_app_context

    if has_app_context():
        if "db" not in g:
            g.db = connect()
        return g.db
    return connect()


def close_db(_error=None):
    """Teardown hook: close the request-scoped connection, if any."""
    from flask import g

    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    """Create the schema (idempotent); switch the database to WAL once."""
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_brief (
                    date       TEXT PRIMARY KEY,
                    content    TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS weekly_schedule (
                    week_start TEXT PRIMARY KEY,
                    content    TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS telemetry (
                    ts        INTEGER PRIMARY KEY,
                    cpu_util  REAL,
                    cpu_temp  REAL,
                    mem_used  INTEGER,
                    mem_total INTEGER,
                    pwr_cpu   REAL,
                    pwr_gpu   REAL,
                    pwr_total REAL
                )
                """
            )
    finally:
        conn.close()
