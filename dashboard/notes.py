"""Daily Brief + Weekly Schedule persistence (SQLite via ``dashboard.db``)."""

from . import db
from .dates import now_iso

# One-markdown-entry-per-day store. The whitelist makes table interpolation safe.
NOTE_TABLES = {"daily_brief"}


def validate_note_table(table):
    """Explicit whitelist check — an assert would vanish under python -O."""
    if table not in NOTE_TABLES:
        raise ValueError(f"unknown note table: {table}")
    return table


def fetch_note(table, date):
    table = validate_note_table(table)
    with db.get_db() as conn:
        row = conn.execute(
            f"SELECT date, content, created_at, updated_at FROM {table} WHERE date = ?",
            (date,),
        ).fetchone()
    return dict(row) if row else None


def upsert_note(table, date, content):
    table = validate_note_table(table)
    with db.get_db() as conn:
        conn.execute(
            f"""
            INSERT INTO {table} (date, content, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                content = excluded.content,
                updated_at = excluded.updated_at
            """,
            (date, content, now_iso(), now_iso()),
        )
    return fetch_note(table, date)


def delete_note(table, date):
    table = validate_note_table(table)
    with db.get_db() as conn:
        cur = conn.execute(f"DELETE FROM {table} WHERE date = ?", (date,))
    return cur.rowcount > 0


def list_notes(table, limit):
    table = validate_note_table(table)
    with db.get_db() as conn:
        rows = conn.execute(
            f"SELECT date, content, created_at, updated_at FROM {table} ORDER BY date DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def fetch_brief(date):
    return fetch_note("daily_brief", date)


def upsert_brief(date, content):
    return upsert_note("daily_brief", date, content)


def delete_brief(date):
    return delete_note("daily_brief", date)


def list_briefs(limit):
    return list_notes("daily_brief", limit)


def fetch_schedule(week):
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT week_start, content, created_at, updated_at FROM weekly_schedule"
            " WHERE week_start = ?",
            (week,),
        ).fetchone()
    return dict(row) if row else None


def upsert_schedule(week, content):
    with db.get_db() as conn:
        conn.execute(
            """
            INSERT INTO weekly_schedule (week_start, content, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(week_start) DO UPDATE SET
                content = excluded.content,
                updated_at = excluded.updated_at
            """,
            (week, content, now_iso(), now_iso()),
        )
    return fetch_schedule(week)


def delete_schedule(week):
    with db.get_db() as conn:
        cur = conn.execute("DELETE FROM weekly_schedule WHERE week_start = ?", (week,))
    return cur.rowcount > 0


def list_schedules(limit):
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT week_start, content, created_at, updated_at FROM weekly_schedule"
            " ORDER BY week_start DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]
