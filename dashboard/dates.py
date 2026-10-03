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
    """Return the Monday (YYYY-MM-DD) of the week containing date_str, or of today."""
    if not date_str or not DATE_RE.match(date_str):
        date_str = today_str()
    y, m, d = map(int, date_str.split("-"))
    return (date(y, m, d) - timedelta(days=date(y, m, d).weekday())).isoformat()


def normalize_week(raw):
    """Return a valid YYYY-MM-DD week-start (Monday), or None."""
    if not raw:
        return week_start_for(None)
    s = str(raw).strip()
    if not DATE_RE.match(s):
        return None
    return week_start_for(s)
