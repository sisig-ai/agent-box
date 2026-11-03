"""Saved table views: a named filter + ordering, applied on read only.

A view never touches rows; it is a config the records listing renders with:

    {"filters": [{"column": "Status", "op": "eq", "value": "done"}],
     "order_by": "Rank", "order": "desc"}

All filters AND together and apply to stored columns (computed columns are
refused, since they are evaluated after the SQL pass).
"""

import json

from . import db
from .dates import now_iso
from .table_types import COMPUTED, clean_name, fail

OPS = {"eq", "neq", "contains", "starts_with", "is_empty", "is_not_empty", "gt", "gte", "lt", "lte"}
NUMERIC = {"gt", "gte", "lt", "lte"}
_WRITE_LOCK = __import__("threading").Lock()


def init_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS db_view (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id   INTEGER NOT NULL,
            name       TEXT NOT NULL COLLATE NOCASE,
            config     TEXT NOT NULL DEFAULT '{}',
            position   INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (table_id, name)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS db_view_table ON db_view (table_id, position)")


def _view(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "config": json.loads(row["config"] or "{}"),
        "position": row["position"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def clean_config(conn, table_id, raw):
    """Validate a view config against the table's columns."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        fail("config must be an object")
    filters = raw.get("filters") or []
    if not isinstance(filters, list):
        fail("config.filters must be a list")
    cleaned = []
    for entry in filters:
        if not isinstance(entry, dict):
            fail("each filter must be an object with column, op and optional value")
        column = _column(conn, table_id, entry.get("column"))
        op = str(entry.get("op") or "eq").lower()
        if op not in OPS:
            fail(f"filter op must be one of: {', '.join(sorted(OPS))}")
        if column["type"] in COMPUTED:
            fail(f"cannot filter on computed column “{column['name']}” in a view")
        value = entry.get("value")
        if op not in ("is_empty", "is_not_empty") and value is None:
            fail(f"filter on “{column['name']}” needs a value")
        if op in NUMERIC:
            try:
                value = float(value)
            except (TypeError, ValueError):
                fail(f"filter op {op} needs a number")
        cleaned.append({"column": column["name"], "op": op, "value": value})
    order_by = raw.get("order_by") or None
    if order_by:
        order_by = _column(conn, table_id, order_by)["name"]
    order = str(raw.get("order") or "asc").lower()
    if order not in ("asc", "desc"):
        fail("config.order must be asc or desc")
    return {"filters": cleaned, "order_by": order_by, "order": order}


def _column(conn, table_id, ref):
    from .tables import resolve_column

    return dict(resolve_column(conn, table_id, ref))


def list_views(table_ref):
    from .tables import resolve_table

    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    rows = conn.execute(
        "SELECT * FROM db_view WHERE table_id = ? ORDER BY position, id", (table["id"],)
    ).fetchall()
    return {"views": [_view(row) for row in rows]}


def resolve_view(conn, table_id, ref):
    row = None
    if isinstance(ref, int) or str(ref).isdigit():
        row = conn.execute(
            "SELECT * FROM db_view WHERE table_id = ? AND id = ?", (table_id, int(ref))
        ).fetchone()
    if row is None:
        row = conn.execute(
            "SELECT * FROM db_view WHERE table_id = ? AND name = ? COLLATE NOCASE",
            (table_id, str(ref).strip()),
        ).fetchone()
    if row is None:
        fail(f"no view named or numbered {ref}", 404)
    return row


def create_view(table_ref, name, config=None):
    from .tables import resolve_table

    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    name = clean_name(name, "view name", 60)
    config = clean_config(conn, table["id"], config)
    with _WRITE_LOCK, conn:
        if conn.execute(
            "SELECT 1 FROM db_view WHERE table_id = ? AND name = ? COLLATE NOCASE",
            (table["id"], name),
        ).fetchone():
            fail(f"a view named “{name}” already exists", 409)
        position = conn.execute(
            "SELECT coalesce(max(position), -1) + 1 FROM db_view WHERE table_id = ?",
            (table["id"],),
        ).fetchone()[0]
        stamp = now_iso()
        cur = conn.execute(
            "INSERT INTO db_view (table_id, name, config, position, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (table["id"], name, json.dumps(config), position, stamp, stamp),
        )
        view_id = cur.lastrowid
    return _view(conn.execute("SELECT * FROM db_view WHERE id = ?", (view_id,)).fetchone())


def update_view(table_ref, ref, name=None, config=None, position=None):
    from .tables import resolve_table

    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    row = resolve_view(conn, table["id"], ref)
    fields = {}
    if name is not None:
        name = clean_name(name, "view name", 60)
        clash = conn.execute(
            "SELECT 1 FROM db_view WHERE table_id = ? AND name = ? COLLATE NOCASE AND id != ?",
            (table["id"], name, row["id"]),
        ).fetchone()
        if clash:
            fail(f"a view named “{name}” already exists", 409)
        fields["name"] = name
    if config is not None:
        fields["config"] = json.dumps(clean_config(conn, table["id"], config))
    if position is not None:
        if isinstance(position, bool) or not isinstance(position, int):
            fail("position must be an integer")
        fields["position"] = position
    if not fields:
        fail("nothing to update: pass name, config or position")
    fields["updated_at"] = now_iso()
    sets = ", ".join(f"{key} = ?" for key in fields)
    with _WRITE_LOCK, conn:
        conn.execute(f"UPDATE db_view SET {sets} WHERE id = ?", (*fields.values(), row["id"]))
    return _view(conn.execute("SELECT * FROM db_view WHERE id = ?", (row["id"],)).fetchone())


def delete_view(table_ref, ref):
    from .tables import resolve_table

    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    row = resolve_view(conn, table["id"], ref)
    with _WRITE_LOCK, conn:
        conn.execute("DELETE FROM db_view WHERE id = ?", (row["id"],))
    return {"deleted": row["id"], "name": row["name"]}


# ---------------- reading with a view ----------------


def build_filters(conn, table_id, filters):
    """(join sql, where sql, args) for ANDed cell filters; '' where when empty."""
    joins, clauses = [], []
    join_args, where_args = [], []
    for index, entry in enumerate(filters or []):
        column = _column(conn, table_id, entry["column"])
        op = entry["op"]
        alias = f"f{index}"
        joins.append(
            f"LEFT JOIN db_cell {alias} ON {alias}.row_id = r.id AND {alias}.column_id = ?"
        )
        join_args.append(column["id"])
        value = entry.get("value")
        expr = f"json_extract({alias}.value, '$')"
        empty = f"({alias}.value IS NULL OR {expr} IN ('', '[]'))"
        if op == "is_empty":
            clauses.append(empty)
        elif op == "is_not_empty":
            clauses.append(f"NOT {empty}")
        elif op == "contains":
            if column["type"] == "string" and column.get("subtype") == "multi_select":
                clauses.append(
                    f"EXISTS (SELECT 1 FROM json_each({alias}.value) WHERE json_each.value = ?)"
                )
                where_args.append(value)
            else:
                clauses.append(f"{expr} LIKE '%' || ? || '%'")
                where_args.append(value)
        elif op == "starts_with":
            clauses.append(f"{expr} LIKE ? || '%'")
            where_args.append(value)
        elif op in ("gt", "gte", "lt", "lte"):
            symbol = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            clauses.append(f"CAST({expr} AS REAL) {symbol} ?")
            where_args.append(value)
        else:
            if column["type"] in ("number", "bool"):
                clauses.append(f"CAST({expr} AS REAL) = ?")
                where_args.append(int(value) if isinstance(value, bool) else value)
            else:
                clauses.append(f"{expr} = ?")
                where_args.append(value)
    where = (" AND " + " AND ".join(clauses)) if clauses else ""
    return " ".join(joins), where, join_args, where_args


def apply_view(conn, table_id, ref):
    """Resolve a view to (filters, order_by, order)."""
    row = resolve_view(conn, table_id, ref)
    config = json.loads(row["config"] or "{}")
    return config.get("filters") or [], config.get("order_by"), config.get("order") or "asc"
