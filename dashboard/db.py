"""SQLite access: schema, request-scoped connection reuse, WAL settings.

The request connection lives in a context variable, so the same helper works
in an ASGI request: the middleware opens it, routers reuse it from the event
loop or a threadpool worker, and the middleware closes it.
Outside a request (collector, CLI, tests) each call returns a fresh connection.
"""

import contextvars
import sqlite3

from . import config

_session: contextvars.ContextVar = contextvars.ContextVar("db_session", default=None)


def connect():
    """A new fully configured connection; the caller owns its lifetime."""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    # One request may touch the connection from the event loop and from a
    # threadpool worker (sync library call); WAL plus busy_timeout keep that safe.
    conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


class RequestSession:
    """Per-request holder; the ASGI middleware closes whatever it opened."""

    __slots__ = ("conn",)

    def __init__(self):
        self.conn = None


def open_session() -> tuple[RequestSession, object]:
    """Install a request session for this context; returns it and the token."""
    session = RequestSession()
    return session, _session.set(session)


def close_session(session: RequestSession, token) -> None:
    _session.reset(token)
    conn, session.conn = session.conn, None
    if conn is not None:
        conn.close()


def get_db():
    """The request connection, or a fresh one outside a request."""
    session = _session.get()
    if session is None:
        return connect()
    if session.conn is None:
        session.conn = connect()
    return session.conn


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
            from .access_log import init_schema as init_log_schema
            from .docs import init_schema as init_docs_schema
            from .docs_embed import init_schema as init_embed_schema
            from .kanban import init_schema as init_kanban_schema
            from .progress import init_schema as init_progress_schema
            from .table_views import init_schema as init_view_schema
            from .tables import init_schema as init_tables_schema

            init_kanban_schema(conn)
            from .card_docs import init_schema as init_card_docs_schema
            from .kanban_embed import init_schema as init_card_embed_schema

            init_card_embed_schema(conn)
            init_card_docs_schema(conn)
            init_tables_schema(conn)
            init_view_schema(conn)
            # A retired trading-brief feature left its table behind; nothing
            # reads it, and it has never held a row.
            conn.execute("DROP TABLE IF EXISTS trading_brief")
            # Refresh planner statistics when something has drifted enough to
            # matter; a no-op on a settled database.
            conn.execute("PRAGMA optimize")
            init_progress_schema(conn)
            init_docs_schema(conn)
            init_embed_schema(conn)
            init_log_schema(conn)
    finally:
        conn.close()
