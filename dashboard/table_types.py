"""Column types for Tables: validation and value coercion.

A column is one of bool, string (text/select/multi_select), timestamp, number
(int/float), url, formula, ref, rollup. Stored cells are JSON values; formula
and rollup cells are computed on read and refuse writes.
"""

from urllib.parse import urlparse

from .dates import now_iso

TYPES = {"bool", "string", "timestamp", "number", "url", "formula", "ref", "rollup"}
STRING_SUBTYPES = {"text", "select", "multi_select"}
NUMBER_SUBTYPES = {"int", "float"}
AGGREGATES = {"count", "sum", "avg", "min", "max", "concat", "list"}
COMPUTED = {"formula", "rollup"}


class TableError(Exception):
    """A request the Tables store refuses; ``status`` is the HTTP code."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def fail(message, status=400):
    raise TableError(message, status)


def clean_name(raw, label="name", maximum=80):
    if not isinstance(raw, str) or not raw.strip():
        fail(f"{label} is required and must be a non-empty string")
    name = " ".join(raw.split())
    if len(name) > maximum:
        fail(f"{label} must be at most {maximum} characters")
    return name


def clean_type(raw, subtype=None):
    if not isinstance(raw, str) or raw not in TYPES:
        fail(f"type must be one of: {', '.join(sorted(TYPES))}")
    if raw == "string":
        subtype = subtype or "text"
        if subtype not in STRING_SUBTYPES:
            fail(f"string subtype must be one of: {', '.join(sorted(STRING_SUBTYPES))}")
    elif raw == "number":
        subtype = subtype or "float"
        if subtype not in NUMBER_SUBTYPES:
            fail(f"number subtype must be one of: {', '.join(sorted(NUMBER_SUBTYPES))}")
    elif subtype is not None:
        fail(f"{raw} does not take a subtype")
    return raw, subtype


def clean_config(column_type, subtype, raw, conn=None):
    """Validate a column config. ref/rollup need a live table lookup, so conn is passed."""
    config = dict(raw or {}) if isinstance(raw, dict) else {}
    if raw is not None and not isinstance(raw, dict):
        fail("config must be an object")
    if column_type == "string" and subtype in ("select", "multi_select"):
        options = config.get("options", [])
        if not isinstance(options, list) or not all(
            isinstance(o, str) and o.strip() for o in options
        ):
            fail("select options must be a list of non-empty strings")
        config["options"] = list(dict.fromkeys(" ".join(o.split()) for o in options))
    if column_type == "url" and config.get("require_https") not in (None, True, False):
        fail("require_https must be true or false")
    if column_type == "formula":
        expression = config.get("expression")
        if not isinstance(expression, str) or not expression.strip():
            fail("formula columns need a config.expression")
        config["expression"] = expression.strip()
    if column_type in ("ref", "rollup"):
        target = config.get("table_id")
        if isinstance(target, bool) or not isinstance(target, int):
            fail("config.table_id must be the numeric id of another table")
        if conn is not None:
            row = conn.execute("SELECT 1 FROM db_table WHERE id = ?", (target,)).fetchone()
            if row is None:
                fail("config.table_id does not exist", 404)
        config["multiple"] = bool(config.get("multiple", False))
    if column_type == "rollup":
        ref = config.get("ref_column")
        if not isinstance(ref, str) or not ref.strip():
            fail("rollup columns need config.ref_column (name or id of a ref column)")
        config["ref_column"] = ref.strip()
        target_column = config.get("target_column")
        if not isinstance(target_column, str) or not target_column.strip():
            fail("rollup columns need config.target_column")
        config["target_column"] = target_column.strip()
        aggregate = config.get("aggregate", "count")
        if aggregate not in AGGREGATES:
            fail(f"aggregate must be one of: {', '.join(sorted(AGGREGATES))}")
        config["aggregate"] = aggregate
    return config


def _coerce_number(raw, subtype, name):
    if isinstance(raw, bool):
        fail(f"“{name}” is a number column; true/false is not a number")
    try:
        value = float(raw) if subtype == "float" else int(raw)
    except (TypeError, ValueError):
        fail(f"“{name}” needs a {'float' if subtype == 'float' else 'integer'}")
    return value


def _coerce_url(raw, name, config):
    if not isinstance(raw, str) or not raw.strip():
        fail(f"“{name}” needs a URL string")
    value = raw.strip()
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        fail(f"“{name}” must be an absolute http(s) URL")
    if config.get("require_https") and parsed.scheme != "https":
        fail(f"“{name}” must use https")
    return value


def coerce_cell(column, raw):
    """Validate one stored value against its column; None/'' clears."""
    kind, subtype, config = column["type"], column.get("subtype"), column.get("config") or {}
    name = column["name"]
    if kind in COMPUTED:
        fail(f"“{name}” is computed and cannot be written", 400)
    if raw is None or raw == "" or raw == []:
        return None
    if kind == "bool":
        if not isinstance(raw, bool):
            fail(f"“{name}” needs true or false")
        return raw
    if kind == "string":
        if not isinstance(raw, str):
            fail(f"“{name}” needs a string")
        value = raw.strip() if subtype == "select" else raw
        if subtype == "select":
            options = config.get("options", [])
            if value not in options:
                fail(f"“{name}” must be one of: {', '.join(options) or '(no options defined)'}")
        return value
    if kind == "timestamp":
        if not isinstance(raw, str) or not raw.strip():
            fail(f"“{name}” needs an ISO 8601 timestamp")
        from datetime import datetime

        try:
            datetime.fromisoformat(raw.strip())
        except ValueError:
            fail(f"“{name}” needs an ISO 8601 timestamp, e.g. {now_iso()}")
        return raw.strip()
    if kind == "number":
        return _coerce_number(raw, subtype or "float", name)
    if kind == "url":
        return _coerce_url(raw, name, config)
    if kind == "ref":
        return _coerce_ref(raw, name, config)
    fail(f"“{name}” has an unknown column type")
    return None


def _coerce_ref(raw, name, config):
    multiple = config.get("multiple", False)
    if multiple:
        if not isinstance(raw, list) or not all(
            isinstance(v, int) and not isinstance(v, bool) for v in raw
        ):
            fail(f"“{name}” needs a list of record ids")
        return list(dict.fromkeys(raw))
    if isinstance(raw, list):
        if len(raw) > 1:
            fail(f"“{name}” holds one record id; set multiple=true for lists")
        raw = raw[0] if raw else None
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int):
        fail(f"“{name}” needs a record id")
    return raw


def clean_cell_multi(column, raw):
    """multi_select keeps a list; every other type reuses coerce_cell."""
    if column["type"] == "string" and column.get("subtype") == "multi_select":
        if raw is None:
            return None
        if not isinstance(raw, list) or not all(isinstance(v, str) for v in raw):
            fail(f"“{column['name']}” needs a list of option strings")
        options = (column.get("config") or {}).get("options", [])
        chosen = []
        for value in raw:
            value = " ".join(value.split())
            if options and value not in options:
                fail(f"“{column['name']}” got “{value}”, not one of: {', '.join(options)}")
            if value and value not in chosen:
                chosen.append(value)
        return chosen or None
    return coerce_cell(column, raw)
