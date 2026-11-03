"""MCP tools: Tables (Airtable-shaped stores).

Records are plain JSON objects keyed by column name, so an agent can send
``{"Title": "Dune", "Read": true}`` without any DDL or cell ids.
"""

from .. import table_records, tables
from ..table_types import TableError
from .protocol import ToolError, tool_spec

TABLE_REF = {"type": "string", "description": "Table name (case-insensitive) or numeric id."}
COLUMN_REF = {"type": "string", "description": "Column name (case-insensitive) or numeric id."}
VALUES = {
    "type": "object",
    "description": (
        "Object keyed by column name. Types: bool = true/false; string = text; "
        "select = one option; multi_select = list of options; timestamp = ISO 8601; "
        "number = number; url = absolute http(s) URL; ref = record id (or list when "
        "the column allows multiple). Formula and rollup columns are read-only."
    ),
    "additionalProperties": True,
}
COLUMN_SPEC = {
    "type": "object",
    "description": (
        "One column to create: {name, type, subtype?, config?}. Types: bool, string "
        "(subtype text|select|multi_select), timestamp, number (subtype int|float), "
        "url, formula (config.expression), ref (config.table_id, config.multiple?), "
        "rollup (config.table_id, config.ref_column, config.target_column, "
        "config.aggregate = count|sum|avg|min|max|concat|list)."
    ),
    "properties": {
        "name": {"type": "string"},
        "type": {"type": "string"},
        "subtype": {"type": "string"},
        "config": {"type": "object"},
    },
    "required": ["name", "type"],
}


def _wrap(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except TableError as exc:
        raise ToolError(exc.message) from None


ORDER = {
    "type": "string",
    "enum": ["asc", "desc"],
    "default": "asc",
    "description": "Sort direction.",
}


def list_tables(args):
    return _wrap(
        tables.list_tables,
        bool(args.get("include_archived")),
        args.get("order_by") or "name",
        args.get("order") or "asc",
    )


def describe_table(args):
    if not args.get("table"):
        raise ToolError("table is required")
    return _wrap(tables.get_table, args["table"])


def create_table(args):
    if not args.get("name"):
        raise ToolError("name is required")
    table = _wrap(tables.create_table, args["name"], args.get("description"))
    for spec in args.get("columns") or []:
        if not isinstance(spec, dict):
            raise ToolError("columns entries must be objects")
        _wrap(
            tables.create_column,
            table["id"],
            spec.get("name"),
            spec.get("type"),
            spec.get("subtype"),
            spec.get("config"),
        )
    return _wrap(tables.get_table, table["id"])


def update_table(args):
    if not args.get("table"):
        raise ToolError("table is required")
    return _wrap(
        tables.update_table,
        args["table"],
        name=args.get("name"),
        description=args.get("description"),
        archived=args.get("archived"),
    )


def delete_table(args):
    if not args.get("table"):
        raise ToolError("table is required")
    return _wrap(tables.delete_table, args["table"])


def add_column(args):
    for key in ("table", "name", "type"):
        if not args.get(key):
            raise ToolError(f"{key} is required")
    return _wrap(
        tables.create_column,
        args["table"],
        args["name"],
        args["type"],
        args.get("subtype"),
        args.get("config"),
        args.get("position"),
    )


def update_column(args):
    if not args.get("table") or not args.get("column"):
        raise ToolError("table and column are required")
    return _wrap(
        tables.update_column,
        args["table"],
        args["column"],
        name=args.get("name"),
        column_type=args.get("type"),
        subtype=args.get("subtype"),
        config=args.get("config"),
        position=args.get("position"),
        clear_values=bool(args.get("clear_values")),
    )


def delete_column(args):
    if not args.get("table") or not args.get("column"):
        raise ToolError("table and column are required")
    return _wrap(tables.delete_column, args["table"], args["column"])


def list_records(args):
    if not args.get("table"):
        raise ToolError("table is required")
    limit = args.get("limit", 100)
    offset = args.get("offset", 0)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
        raise ToolError("limit must be an integer from 1 to 500")
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ToolError("offset must be a non-negative integer")
    return _wrap(
        table_records.list_records,
        args["table"],
        include_archived=bool(args.get("include_archived")),
        limit=limit,
        offset=offset,
        order_by=args.get("order_by") or None,
        order=args.get("order") or "asc",
    )


def get_record(args):
    if not args.get("table") or args.get("record_id") is None:
        raise ToolError("table and record_id are required")
    return _wrap(table_records.get_record, args["table"], args["record_id"])


def create_record(args):
    if not args.get("table"):
        raise ToolError("table is required")
    values = args.get("values", args.get("record"))
    if not isinstance(values, dict):
        raise ToolError("values must be an object keyed by column name")
    return _wrap(table_records.create_record, args["table"], values)


def update_record(args):
    if not args.get("table") or args.get("record_id") is None:
        raise ToolError("table and record_id are required")
    values = args.get("values") if "values" in args else None
    archived = args.get("archived")
    if values is None and archived is None:
        raise ToolError("nothing to update: pass values and/or archived")
    if values is not None and not isinstance(values, dict):
        raise ToolError("values must be an object keyed by column name")
    return _wrap(
        table_records.update_record,
        args["table"],
        args["record_id"],
        values=values,
        archived=archived,
    )


def delete_record(args):
    if not args.get("table") or args.get("record_id") is None:
        raise ToolError("table and record_id are required")
    return _wrap(table_records.delete_record, args["table"], args["record_id"])


TOOLS = {
    "list_tables": {
        "spec": tool_spec(
            "list_tables",
            "List tables",
            "Every table with column and record counts. Archives excluded unless asked. "
            "order_by = name | updated | created | records.",
            {
                "include_archived": {"type": "boolean"},
                "order_by": {
                    "type": "string",
                    "enum": ["name", "updated", "created", "records"],
                },
                "order": ORDER,
            },
            read_only=True,
        ),
        "handler": list_tables,
    },
    "describe_table": {
        "spec": tool_spec(
            "describe_table",
            "Describe table",
            "One table with its columns, their types, config (select options, formulas) "
            "and counts.",
            {"table": TABLE_REF},
            ["table"],
            read_only=True,
        ),
        "handler": describe_table,
    },
    "create_table": {
        "spec": tool_spec(
            "create_table",
            "Create table",
            "Create a table, optionally with columns in the same call.",
            {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "columns": {"type": "array", "items": COLUMN_SPEC},
            },
            ["name"],
        ),
        "handler": create_table,
    },
    "update_table": {
        "spec": tool_spec(
            "update_table",
            "Update table",
            "Rename, describe, archive or restore a table.",
            {
                "table": TABLE_REF,
                "name": {"type": "string"},
                "description": {"type": "string"},
                "archived": {"type": "boolean"},
            },
            ["table"],
        ),
        "handler": update_table,
    },
    "delete_table": {
        "spec": tool_spec(
            "delete_table",
            "Delete table",
            "Delete a table and every column, row and cell in it. Irreversible.",
            {"table": TABLE_REF},
            ["table"],
            destructive=True,
        ),
        "handler": delete_table,
    },
    "add_column": {
        "spec": tool_spec(
            "add_column",
            "Add column",
            "Add one typed column; see the columns description for config shapes.",
            {
                "table": TABLE_REF,
                "name": {"type": "string"},
                "type": {"type": "string"},
                "subtype": {"type": "string"},
                "config": {"type": "object"},
                "position": {"type": "integer", "minimum": 0},
            },
            ["table", "name", "type"],
        ),
        "handler": add_column,
    },
    "update_column": {
        "spec": tool_spec(
            "update_column",
            "Update column",
            "Rename, retype, reconfigure or move a column. A type change clears its "
            "values unless clear_values is true.",
            {
                "table": TABLE_REF,
                "column": COLUMN_REF,
                "name": {"type": "string"},
                "type": {"type": "string"},
                "subtype": {"type": "string"},
                "config": {"type": "object"},
                "position": {"type": "integer", "minimum": 0},
                "clear_values": {"type": "boolean"},
            },
            ["table", "column"],
        ),
        "handler": update_column,
    },
    "delete_column": {
        "spec": tool_spec(
            "delete_column",
            "Delete column",
            "Remove a column and every cell in it. Irreversible.",
            {"table": TABLE_REF, "column": COLUMN_REF},
            ["table", "column"],
            destructive=True,
        ),
        "handler": delete_column,
    },
    "list_records": {
        "spec": tool_spec(
            "list_records",
            "List records",
            "One page of rows with values keyed by column name; computed columns are "
            "included. Returns total, count, has_more, limit and offset, so page with "
            "offset += limit.",
            {
                "table": TABLE_REF,
                "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
                "offset": {"type": "integer", "minimum": 0, "default": 0},
                "order_by": {
                    "type": "string",
                    "description": (
                        "Column name to sort by, or position | id | created_at | updated_at."
                    ),
                },
                "order": ORDER,
                "include_archived": {"type": "boolean"},
            },
            ["table"],
            read_only=True,
        ),
        "handler": list_records,
    },
    "get_record": {
        "spec": tool_spec(
            "get_record",
            "Get record",
            "One row by id, values keyed by column name.",
            {"table": TABLE_REF, "record_id": {"type": "integer"}},
            ["table", "record_id"],
            read_only=True,
        ),
        "handler": get_record,
    },
    "create_record": {
        "spec": tool_spec(
            "create_record",
            "Create record",
            "Add a row. values is an object keyed by column name.",
            {"table": TABLE_REF, "values": VALUES},
            ["table", "values"],
        ),
        "handler": create_record,
    },
    "update_record": {
        "spec": tool_spec(
            "update_record",
            "Update record",
            "Patch cells by column name and/or archive the row.",
            {
                "table": TABLE_REF,
                "record_id": {"type": "integer"},
                "values": VALUES,
                "archived": {"type": "boolean"},
            },
            ["table", "record_id"],
        ),
        "handler": update_record,
    },
    "delete_record": {
        "spec": tool_spec(
            "delete_record",
            "Delete record",
            "Remove a row and its cells. Irreversible.",
            {"table": TABLE_REF, "record_id": {"type": "integer"}},
            ["table", "record_id"],
            destructive=True,
        ),
        "handler": delete_record,
    },
}
