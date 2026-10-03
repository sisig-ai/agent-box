"""Date/week helpers — all dates are YYYY-MM-DD in the host's local timezone."""

import re
from datetime import date, datetime, timedelta

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def today_str() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d")


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def normalize_date(raw):
    """Return a valid YYYY-MM-DD string, or None."""
    if not raw:
        return today_str()
    s = str(raw).strip()
    return s if DATE_RE.match(s) else None


def week_start_for(date_str):
    """Return the Monday (YYYY-MM-DD) of the week containing date_str, or of today.

    Returns None for a well-formed but impossible date (``2026-02-30``), so the
    caller can reject it with a 400 instead of raising ValueError.
    """
    if not date_str or not DATE_RE.match(date_str):
        date_str = today_str()
    try:
        day = date.fromisoformat(date_str)
    except ValueError:
        return None
    return (day - timedelta(days=day.weekday())).isoformat()


def normalize_week(raw):
    """Return a valid YYYY-MM-DD week-start (Monday), or None."""
    if not raw:
        return week_start_for(None)
    s = str(raw).strip()
    if not DATE_RE.match(s):
        return None
    return week_start_for(s)
