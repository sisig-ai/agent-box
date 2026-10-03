"""Date/week helpers: ISO format, default/garbage handling, Monday coercion."""

import re
from datetime import datetime, timedelta

from dashboard.dates import normalize_date, normalize_week, now_iso, today_str, week_start_for


def test_today_str_is_iso_date():
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", today_str())


def test_now_iso_is_second_resolution():
    value = now_iso()
    assert "." not in value  # timespec="seconds": no fractional part
    datetime.fromisoformat(value)


def test_normalize_date_empty_defaults_to_today():
    assert normalize_date(None) == today_str()
    assert normalize_date("") == today_str()


def test_normalize_date_valid_passthrough_and_strip():
    assert normalize_date("2026-10-01") == "2026-10-01"
    assert normalize_date(" 2026-10-01 ") == "2026-10-01"


def test_normalize_date_garbage_is_none():
    assert normalize_date("2026/10/01") is None
    assert normalize_date("garbage") is None
    assert normalize_date(20261001) is None


def test_week_start_for_monday_coercion():
    assert week_start_for("2026-10-01") == "2026-09-28"  # Thursday -> Monday
    assert week_start_for("2026-09-28") == "2026-09-28"  # already Monday


def test_week_start_for_bad_input_uses_today():
    today = datetime.now().astimezone().date()
    expected = (today - timedelta(days=today.weekday())).isoformat()
    assert week_start_for(None) == expected
    assert week_start_for("garbage") == expected


def test_normalize_week():
    assert normalize_week("2026-10-01") == "2026-09-28"
    assert normalize_week(None) == week_start_for(None)
    assert normalize_week("garbage") is None
