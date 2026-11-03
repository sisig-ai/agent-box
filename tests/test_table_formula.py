"""Formula engine: parsing, evaluation, references and failure modes."""

import pytest

from dashboard.table_formula import evaluate_expression
from dashboard.table_types import TableError

CELLS = {
    "Title": "Dune",
    "Pages": 412,
    "Done": True,
    "Score": 4.5,
    "When": "2026-11-03T10:00:00+08:00",
}


def resolve(name):
    if name not in CELLS:
        raise TableError(f"formula references unknown column “{name}”")
    return CELLS[name]


def run(expression):
    return evaluate_expression(expression, resolve)


def test_arithmetic_and_precedence():
    assert run("{Pages} * 2 + 1") == 825
    assert run("(2 + 3) * 4") == 20
    assert run("10 % 3") == 1
    assert run("7 / 2") == 3.5
    assert run("7 / 0") is None


def test_strings_booleans_and_comparisons():
    assert run('CONCAT({Title}, " (", {Pages}, "p)")') == "Dune (412p)"
    assert run('IF({Done}, "done", "open")') == "done"
    assert run("{Pages} > 400 && {Done}") is True
    assert run("{Score} >= 4.5") is True
    assert run("NOT {Done}") is False
    assert run('UPPER(TRIM("  x  "))') == "X"


def test_dates_compare_chronologically():
    assert run("YEAR({When})") == 2026
    assert run('{When} > "2026-01-01T00:00:00+08:00"') is True


def test_missing_reference_is_reported():
    with pytest.raises(TableError, match="unknown column"):
        run("{Nope} + 1")


def test_bad_syntax_is_reported():
    with pytest.raises(TableError):
        run("1 +")


def test_numeric_helpers():
    assert run("ROUND(2.345, 2)") == 2.35
    assert run("MIN(3, 1, 2)") == 1
    assert run("MAX(1, 2, 3)") == 3


def test_lookup_resolves_through_the_callback():
    def lookup(value, column):
        assert value == 7 and column == "Name"
        return ["Acme"]

    assert evaluate_expression('LOOKUP(7, "Name")', resolve, lookup) == ["Acme"]
    assert evaluate_expression('COUNT(LOOKUP(7, "Name"))', resolve, lookup) == 1
