"""Tables: records, cells, and the computed column pipeline.

Records are JSON objects keyed by column name. Formula and rollup columns are
computed here on read, with a cycle guard; ref cells hold record ids and rollups
aggregate a target column over those records.
"""

import json

from . import db, table_formula
from .dates import now_iso
from .table_types import COMPUTED, clean_cell_multi, fail
from .tables import _WRITE_LOCK, _column, _json, resolve_table

# ---------------- records ----------------


def _columns(conn, table_id):
    return [
        _column(row)
        for row in conn.execute(
            "SELECT * FROM db_column WHERE table_id = ? ORDER BY position, id", (table_id,)
        ).fetchall()
    ]


def _cells_by_row(conn, rows, columns):
    by_id = {column["id"]: column for column in columns}
    out = {row["id"]: {} for row in rows}
    if not rows:
        return out
    ids = tuple(row["id"] for row in rows)
    marks = ",".join("?" for _ in ids)
    for cell in conn.execute(
        f"SELECT row_id, column_id, value FROM db_cell WHERE row_id IN ({marks})", ids
    ).fetchall():
        column = by_id.get(cell["column_id"])
        if column is not None:
            out[cell["row_id"]][column["name"]] = _json(cell["value"], None)
    return out


def _ref_lookup(conn, columns, values):
    """Resolve LOOKUP(refvalue, column) against the ref column's target table."""

    def lookup(value, column_name):
        ids = value if isinstance(value, list) else [value]
        ids = [v for v in ids if isinstance(v, int) and not isinstance(v, bool)]
        if not ids:
            return []
        for column in columns:
            if column["type"] != "ref":
                continue
            table_id = (column.get("config") or {}).get("table_id")
            if not table_id:
                continue
            target = resolve_table(conn, table_id)
            marks = ",".join("?" for _ in ids)
            found = conn.execute(
                f"SELECT 1 FROM db_row WHERE table_id = ? AND id IN ({marks})",
                (target["id"], *ids),
            ).fetchone()
            if not found:
                continue
            target_columns = _columns(conn, target["id"])
            match = next(
                (c for c in target_columns if c["name"].lower() == column_name.lower()), None
            )
            if match is None:
                fail(f"LOOKUP: no column “{column_name}” in {target['name']}", 400)
            target_rows = conn.execute(
                f"SELECT * FROM db_row WHERE table_id = ? AND id IN ({marks})",
                (target["id"], *ids),
            ).fetchall()
            cells = _cells_by_row(conn, target_rows, target_columns)
            return [cells[row["id"]].get(match["name"]) for row in target_rows]
        return []

    return lookup


def _rollup(conn, column, columns, cells):
    config = column.get("config") or {}
    ref_column = next(
        (
            c
            for c in columns
            if c["name"].lower() == str(config.get("ref_column", "")).lower()
            or str(c["id"]) == str(config.get("ref_column"))
        ),
        None,
    )
    if ref_column is None or ref_column["type"] != "ref":
        return None
    ids = cells.get(ref_column["name"])
    ids = ids if isinstance(ids, list) else ([ids] if isinstance(ids, int) else [])
    if not ids:
        return (
            []
            if config.get("aggregate") == "list"
            else 0
            if config.get("aggregate") in ("count", "sum")
            else None
        )
    target = resolve_table(conn, (ref_column.get("config") or {}).get("table_id"))
    target_columns = _columns(conn, target["id"])
    target_column = next(
        (
            c
            for c in target_columns
            if c["name"].lower() == str(config.get("target_column", "")).lower()
        ),
        None,
    )
    if target_column is None:
        fail(f"rollup target column “{config.get('target_column')}” is missing", 400)
    marks = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT * FROM db_row WHERE table_id = ? AND id IN ({marks})",
        (target["id"], *ids),
    ).fetchall()
    cells_by_row = _cells_by_row(conn, rows, target_columns)
    collected = [cells_by_row[row["id"]].get(target_column["name"]) for row in rows]
    collected = [value for value in collected if value is not None]
    aggregate = config.get("aggregate", "count")
    if aggregate == "count":
        return len(collected)
    if aggregate == "list":
        return collected
    if aggregate == "concat":
        return ", ".join(str(value) for value in collected)
    numbers = []
    for value in collected:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        numbers.append(value)
    if not numbers:
        return 0 if aggregate == "sum" else None
    if aggregate == "sum":
        return sum(numbers)
    if aggregate == "avg":
        return sum(numbers) / len(numbers)
    return min(numbers) if aggregate == "min" else max(numbers)


def _values_for(conn, table, columns, row, cells):
    """Stored values plus computed formula/rollup values, with a cycle guard."""
    values = dict(cells)
    cache, visiting = {}, set()

    def computed(column):
        name = column["name"]
        if name in values:
            return values[name]
        if name in cache:
            return cache[name]
        if name in visiting:
            fail(f"formula cycle at “{name}”", 400)
        visiting.add(name)
        if column["type"] == "rollup":
            result = _rollup(conn, column, columns, values)
        else:
            expression = (column.get("config") or {}).get("expression", "")
            lookup = _ref_lookup(conn, columns, values)

            def resolve(ref_name):
                match = next((c for c in columns if c["name"].lower() == ref_name.lower()), None)
                if match is None:
                    fail(f"formula references unknown column “{ref_name}”", 400)
                if match["type"] in COMPUTED:
                    return computed(match)
                return values.get(match["name"])

            result = table_formula.evaluate_expression(expression, resolve, lookup)
        visiting.discard(name)
        cache[name] = result
        return result

    for column in columns:
        if column["type"] in COMPUTED:
            values[column["name"]] = computed(column)
    return values


def _record(row, values):
    return {
        "id": row["id"],
        "position": row["position"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "archived_at": row["archived_at"],
        "values": values,
    }


def list_records(table_ref, include_archived=False, limit=100, offset=0):
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    columns = _columns(conn, table["id"])
    sql = "SELECT * FROM db_row WHERE table_id = ?"
    if not include_archived:
        sql += " AND archived_at IS NULL"
    rows = conn.execute(
        sql + " ORDER BY position, id LIMIT ? OFFSET ?",
        (table["id"], max(1, limit), max(0, offset)),
    ).fetchall()
    cells = _cells_by_row(conn, rows, columns)
    return {
        "records": [
            _record(row, _values_for(conn, table, columns, row, cells[row["id"]])) for row in rows
        ],
        "count": len(rows),
        "total": conn.execute(
            "SELECT count(*) FROM db_row WHERE table_id = ?"
            + ("" if include_archived else " AND archived_at IS NULL"),
            (table["id"],),
        ).fetchone()[0],
        "columns": columns,
    }


def get_record(table_ref, record_id):
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    columns = _columns(conn, table["id"])
    row = conn.execute(
        "SELECT * FROM db_row WHERE table_id = ? AND id = ?", (table["id"], int(record_id))
    ).fetchone()
    if row is None:
        fail(f"no record {record_id} in {table['name']}", 404)
    cells = _cells_by_row(conn, [row], columns)[row["id"]]
    return _record(row, _values_for(conn, table, columns, row, cells))


def _write_values(conn, table, columns, row_id, values):
    by_name = {column["name"].lower(): column for column in columns}
    for raw_name, raw_value in values.items():
        column = by_name.get(str(raw_name).strip().lower())
        if column is None:
            fail(f"{table['name']} has no column “{raw_name}”")
        value = clean_cell_multi(column, raw_value)
        if value is None:
            conn.execute(
                "DELETE FROM db_cell WHERE row_id = ? AND column_id = ?", (row_id, column["id"])
            )
            continue
        if column["type"] == "ref":
            _check_refs(conn, column, value)
        conn.execute(
            "INSERT INTO db_cell (row_id, column_id, value) VALUES (?, ?, ?)"
            " ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value",
            (row_id, column["id"], json.dumps(value)),
        )


def _check_refs(conn, column, value):
    config = column.get("config") or {}
    target = resolve_table(conn, config.get("table_id"))
    ids = value if isinstance(value, list) else [value]
    for record_id in ids:
        found = conn.execute(
            "SELECT 1 FROM db_row WHERE table_id = ? AND id = ?", (target["id"], record_id)
        ).fetchone()
        if not found:
            fail(f"“{column['name']}”: no record {record_id} in {target['name']}", 404)


def create_record(table_ref, values):
    if values is None:
        values = {}
    if not isinstance(values, dict):
        fail("values must be an object keyed by column name")
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    columns = _columns(conn, table["id"])
    stamp = now_iso()
    with _WRITE_LOCK, conn:
        position = conn.execute(
            "SELECT coalesce(max(position), -1) + 1 FROM db_row WHERE table_id = ?", (table["id"],)
        ).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO db_row (table_id, position, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (table["id"], position, stamp, stamp),
        )
        row_id = cur.lastrowid
        _write_values(conn, table, columns, row_id, values)
        conn.execute("UPDATE db_table SET updated_at = ? WHERE id = ?", (stamp, table["id"]))
    return get_record(table["id"], row_id)


def update_record(table_ref, record_id, values=None, archived=None):
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    columns = _columns(conn, table["id"])
    row = conn.execute(
        "SELECT * FROM db_row WHERE table_id = ? AND id = ?", (table["id"], int(record_id))
    ).fetchone()
    if row is None:
        fail(f"no record {record_id} in {table['name']}", 404)
    if values is not None and not isinstance(values, dict):
        fail("values must be an object keyed by column name")
    fields = {"updated_at": now_iso()}
    if archived is not None:
        if not isinstance(archived, bool):
            fail("archived must be true or false")
        fields["archived_at"] = now_iso() if archived else None
    with _WRITE_LOCK, conn:
        _write_values(conn, table, columns, row["id"], values or {})
        sets = ", ".join(f"{key} = ?" for key in fields)
        conn.execute(f"UPDATE db_row SET {sets} WHERE id = ?", (*fields.values(), row["id"]))
        conn.execute(
            "UPDATE db_table SET updated_at = ? WHERE id = ?", (fields["updated_at"], table["id"])
        )
    return get_record(table["id"], row["id"])


def delete_record(table_ref, record_id):
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    row = conn.execute(
        "SELECT * FROM db_row WHERE table_id = ? AND id = ?", (table["id"], int(record_id))
    ).fetchone()
    if row is None:
        fail(f"no record {record_id} in {table['name']}", 404)
    with _WRITE_LOCK, conn:
        conn.execute("DELETE FROM db_cell WHERE row_id = ?", (row["id"],))
        conn.execute("DELETE FROM db_row WHERE id = ?", (row["id"],))
        conn.execute("UPDATE db_table SET updated_at = ? WHERE id = ?", (now_iso(), table["id"]))
    return {"deleted": row["id"]}
