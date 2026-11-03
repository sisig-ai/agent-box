"""Tables: Airtable-shaped stores (tables, columns, rows, cells).

Columns are typed (see table_types); formula and rollup columns are computed on
read. Records are addressed by id, cells by column name, so agents can send
plain JSON: ``{"Name": "x", "Done": false}``. SQLite work stays synchronous; the
router runs these calls in the threadpool.
"""

import json
import threading

from . import db
from .dates import now_iso
from .table_types import (
    COMPUTED,
    clean_config,
    clean_name,
    clean_type,
    fail,
)

_WRITE_LOCK = threading.Lock()


def _json(raw, default):
    try:
        return json.loads(raw) if raw else default
    except (TypeError, ValueError):
        return default


def init_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS db_table (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
            description TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            archived_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS db_column (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id   INTEGER NOT NULL,
            name       TEXT NOT NULL COLLATE NOCASE,
            type       TEXT NOT NULL,
            subtype    TEXT,
            config     TEXT NOT NULL DEFAULT '{}',
            position   INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (table_id, name)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS db_row (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            table_id    INTEGER NOT NULL,
            position    INTEGER NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            archived_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS db_cell (
            row_id    INTEGER NOT NULL,
            column_id INTEGER NOT NULL,
            value     TEXT NOT NULL,
            PRIMARY KEY (row_id, column_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS db_row_table ON db_row (table_id, position)")
    conn.execute("CREATE INDEX IF NOT EXISTS db_column_table ON db_column (table_id, position)")


# ---------------- tables ----------------


def _table_row(row, conn):
    counts = conn.execute(
        "SELECT (SELECT count(*) FROM db_column WHERE table_id = ?) AS cols,"
        " (SELECT count(*) FROM db_row WHERE table_id = ? AND archived_at IS NULL) AS rows",
        (row["id"], row["id"]),
    ).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "archived_at": row["archived_at"],
        "column_count": counts["cols"],
        "record_count": counts["rows"],
    }


def list_tables(include_archived=False):
    conn = db.get_db()
    sql = "SELECT * FROM db_table"
    if not include_archived:
        sql += " WHERE archived_at IS NULL"
    rows = conn.execute(sql + " ORDER BY name COLLATE NOCASE").fetchall()
    return {"tables": [_table_row(row, conn) for row in rows]}


def resolve_table(conn, ref):
    """A table by numeric id or name (case-insensitive); 404 when missing."""
    if isinstance(ref, bool) or ref is None:
        fail("table is required")
    row = None
    if isinstance(ref, int) or str(ref).isdigit():
        row = conn.execute("SELECT * FROM db_table WHERE id = ?", (int(ref),)).fetchone()
    if row is None:
        row = conn.execute(
            "SELECT * FROM db_table WHERE name = ? COLLATE NOCASE", (str(ref).strip(),)
        ).fetchone()
    if row is None:
        fail(f"no table named or numbered {ref}", 404)
    return row


def get_table(ref):
    conn = db.get_db()
    row = resolve_table(conn, ref)
    return {**_table_row(row, conn), "columns": list_columns(ref)["columns"]}


def create_table(name, description=None):
    name = clean_name(name, "table name", 80)
    conn = db.get_db()
    stamp = now_iso()
    with _WRITE_LOCK, conn:
        if conn.execute("SELECT 1 FROM db_table WHERE name = ? COLLATE NOCASE", (name,)).fetchone():
            fail(f"a table named “{name}” already exists", 409)
        cur = conn.execute(
            "INSERT INTO db_table (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (name, (description or "").strip(), stamp, stamp),
        )
        table_id = cur.lastrowid
    return get_table(table_id)


def update_table(ref, name=None, description=None, archived=None):
    conn = db.get_db()
    row = resolve_table(conn, ref)
    fields = {}
    if name is not None:
        name = clean_name(name, "table name", 80)
        clash = conn.execute(
            "SELECT 1 FROM db_table WHERE name = ? COLLATE NOCASE AND id != ?", (name, row["id"])
        ).fetchone()
        if clash:
            fail(f"a table named “{name}” already exists", 409)
        fields["name"] = name
    if description is not None:
        fields["description"] = str(description).strip()
    if archived is not None:
        if not isinstance(archived, bool):
            fail("archived must be true or false")
        fields["archived_at"] = now_iso() if archived else None
    if not fields:
        fail("nothing to update: pass name, description or archived")
    fields["updated_at"] = now_iso()
    sets = ", ".join(f"{key} = ?" for key in fields)
    with _WRITE_LOCK, conn:
        conn.execute(f"UPDATE db_table SET {sets} WHERE id = ?", (*fields.values(), row["id"]))
    return get_table(row["id"])


def delete_table(ref):
    conn = db.get_db()
    row = resolve_table(conn, ref)
    with _WRITE_LOCK, conn:
        conn.execute(
            "DELETE FROM db_cell WHERE column_id IN (SELECT id FROM db_column WHERE table_id = ?)",
            (row["id"],),
        )
        conn.execute(
            "DELETE FROM db_cell WHERE row_id IN (SELECT id FROM db_row WHERE table_id = ?)",
            (row["id"],),
        )
        conn.execute("DELETE FROM db_column WHERE table_id = ?", (row["id"],))
        conn.execute("DELETE FROM db_row WHERE table_id = ?", (row["id"],))
        conn.execute("DELETE FROM db_table WHERE id = ?", (row["id"],))
    return {"deleted": row["id"], "name": row["name"]}


# ---------------- columns ----------------


def _column(row):
    config = _json(row["config"], {})
    return {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "subtype": row["subtype"],
        "config": config,
        "position": row["position"],
        "computed": row["type"] in COMPUTED,
    }


def list_columns(table_ref):
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    rows = conn.execute(
        "SELECT * FROM db_column WHERE table_id = ? ORDER BY position, id", (table["id"],)
    ).fetchall()
    return {"columns": [_column(row) for row in rows]}


def resolve_column(conn, table_id, ref):
    if isinstance(ref, bool) or ref is None:
        fail("column is required")
    row = None
    if isinstance(ref, int) or str(ref).isdigit():
        row = conn.execute(
            "SELECT * FROM db_column WHERE table_id = ? AND id = ?", (table_id, int(ref))
        ).fetchone()
    if row is None:
        row = conn.execute(
            "SELECT * FROM db_column WHERE table_id = ? AND name = ? COLLATE NOCASE",
            (table_id, str(ref).strip()),
        ).fetchone()
    if row is None:
        fail(f"no column named or numbered {ref}", 404)
    return row


def create_column(table_ref, name, column_type, subtype=None, config=None, position=None):
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    name = clean_name(name, "column name", 60)
    kind, subtype = clean_type(column_type, subtype)
    config = clean_config(kind, subtype, config, conn)
    if position is not None and (isinstance(position, bool) or not isinstance(position, int)):
        fail("position must be an integer")
    with _WRITE_LOCK, conn:
        if conn.execute(
            "SELECT 1 FROM db_column WHERE table_id = ? AND name = ? COLLATE NOCASE",
            (table["id"], name),
        ).fetchone():
            fail(f"a column named “{name}” already exists", 409)
        next_pos = conn.execute(
            "SELECT coalesce(max(position), -1) + 1 FROM db_column WHERE table_id = ?",
            (table["id"],),
        ).fetchone()[0]
        stamp = now_iso()
        cur = conn.execute(
            "INSERT INTO db_column"
            " (table_id, name, type, subtype, config, position, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                table["id"],
                name,
                kind,
                subtype,
                json.dumps(config),
                position if position is not None else next_pos,
                stamp,
                stamp,
            ),
        )
        column_id = cur.lastrowid
        conn.execute("UPDATE db_table SET updated_at = ? WHERE id = ?", (stamp, table["id"]))
    return _column(conn.execute("SELECT * FROM db_column WHERE id = ?", (column_id,)).fetchone())


def update_column(
    table_ref,
    col_ref,
    name=None,
    column_type=None,
    subtype=None,
    config=None,
    position=None,
    clear_values=False,
):
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    row = resolve_column(conn, table["id"], col_ref)
    fields, changed_type = {}, False
    if name is not None:
        name = clean_name(name, "column name", 60)
        clash = conn.execute(
            "SELECT 1 FROM db_column WHERE table_id = ? AND name = ? COLLATE NOCASE AND id != ?",
            (table["id"], name, row["id"]),
        ).fetchone()
        if clash:
            fail(f"a column named “{name}” already exists", 409)
        fields["name"] = name
    if column_type is not None or subtype is not None or config is not None:
        kind = column_type or row["type"]
        # A new type without a subtype takes that type's default, not the old
        # column's subtype (string/select -> number/text would be rejected).
        sub = subtype if subtype is not None else (row["subtype"] if kind == row["type"] else None)
        kind, sub = clean_type(kind, sub)
        cfg = clean_config(
            kind, sub, config if config is not None else _json(row["config"], {}), conn
        )
        changed_type = (
            kind != row["type"] or sub != row["subtype"] or cfg != _json(row["config"], {})
        )
        fields.update({"type": kind, "subtype": sub, "config": json.dumps(cfg)})
    if position is not None:
        if isinstance(position, bool) or not isinstance(position, int):
            fail("position must be an integer")
        fields["position"] = position
    if not fields:
        fail("nothing to update: pass name, type, config or position")
    cells = conn.execute(
        "SELECT count(*) FROM db_cell WHERE column_id = ?", (row["id"],)
    ).fetchone()[0]
    if changed_type and cells and not clear_values:
        fail("changing a column type clears its values; pass clear_values=true", 409)
    fields["updated_at"] = now_iso()
    sets = ", ".join(f"{key} = ?" for key in fields)
    with _WRITE_LOCK, conn:
        conn.execute(f"UPDATE db_column SET {sets} WHERE id = ?", (*fields.values(), row["id"]))
        if changed_type and cells:
            conn.execute("DELETE FROM db_cell WHERE column_id = ?", (row["id"],))
        conn.execute(
            "UPDATE db_table SET updated_at = ? WHERE id = ?", (fields["updated_at"], table["id"])
        )
    return _column(conn.execute("SELECT * FROM db_column WHERE id = ?", (row["id"],)).fetchone())


def delete_column(table_ref, col_ref):
    conn = db.get_db()
    table = resolve_table(conn, table_ref)
    row = resolve_column(conn, table["id"], col_ref)
    with _WRITE_LOCK, conn:
        conn.execute("DELETE FROM db_cell WHERE column_id = ?", (row["id"],))
        conn.execute("DELETE FROM db_column WHERE id = ?", (row["id"],))
        conn.execute("UPDATE db_table SET updated_at = ? WHERE id = ?", (now_iso(), table["id"]))
    return {"deleted": row["id"], "name": row["name"]}
