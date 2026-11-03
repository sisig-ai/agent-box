"""MCP tools: Tables (Airtable-shaped stores).

Records are plain JSON objects keyed by column name, so an agent can send
``{"Title": "Dune", "Read": true}`` without any DDL or cell ids.
"""

from .. import table_records, table_views, tables
from ..table_types import TableError
from .protocol import ToolError

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
VIEW_REF = {"type": "string", "description": "View name (case-insensitive) or numeric id."}
VIEW_CONFIG = {
    "type": "object",
    "description": (
        "A saved filter + ordering. filters is a list of {column, op, value} ANDed "
        "together; op = eq|neq|contains|starts_with|gt|gte|lt|lte|is_empty|"
        "is_not_empty. order_by is a stored column name (or position|id|"
        "created_at|updated_at) and order is asc|desc. A view never changes rows."
    ),
    "properties": {
        "filters": {"type": "array", "items": {"type": "object"}},
        "order_by": {"type": "string"},
        "order": {"type": "string", "enum": ["asc", "desc"]},
    },
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
        view=args.get("view") or None,
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


def list_views(args):
    if not args.get("table"):
        raise ToolError("table is required")
    return _wrap(table_views.list_views, args["table"])


def create_view(args):
    if not args.get("table") or not args.get("name"):
        raise ToolError("table and name are required")
    return _wrap(table_views.create_view, args["table"], args["name"], args.get("config"))


def update_view(args):
    if not args.get("table") or not args.get("view"):
        raise ToolError("table and view are required")
    if "name" not in args and "config" not in args:
        raise ToolError("nothing to update: pass name and/or config")
    return _wrap(
        table_views.update_view,
        args["table"],
        args["view"],
        name=args.get("name"),
        config=args.get("config") if "config" in args else None,
    )


def delete_view(args):
    if not args.get("table") or not args.get("view"):
        raise ToolError("table and view are required")
    return _wrap(table_views.delete_view, args["table"], args["view"])


from .tools_tables_specs import TOOLS  # noqa: E402,F401  (needs the handlers above)
