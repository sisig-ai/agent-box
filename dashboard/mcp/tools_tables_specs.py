"""Tool specs for Tables (kept apart so the handler module stays readable)."""

from .protocol import tool_spec
from .tools_tables import (
    COLUMN_REF,
    COLUMN_SPEC,
    ORDER,
    TABLE_REF,
    VALUES,
    VIEW_CONFIG,
    VIEW_REF,
    add_column,
    create_record,
    create_table,
    create_view,
    delete_column,
    delete_record,
    delete_table,
    delete_view,
    describe_table,
    get_record,
    list_records,
    list_tables,
    list_views,
    update_column,
    update_record,
    update_table,
    update_view,
)

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
                "view": {
                    "type": "string",
                    "description": "Apply a saved view (name or id): its filters and ordering.",
                },
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
    "list_views": {
        "spec": tool_spec(
            "list_views",
            "List views",
            "Saved filters and orderings for one table; applying one never changes rows.",
            {"table": TABLE_REF},
            ["table"],
            read_only=True,
        ),
        "handler": list_views,
    },
    "create_view": {
        "spec": tool_spec(
            "create_view",
            "Create view",
            "Save a named filter + ordering for a table.",
            {"table": TABLE_REF, "name": {"type": "string"}, "config": VIEW_CONFIG},
            ["table", "name"],
        ),
        "handler": create_view,
    },
    "update_view": {
        "spec": tool_spec(
            "update_view",
            "Update view",
            "Rename a view or replace its filters/ordering.",
            {
                "table": TABLE_REF,
                "view": VIEW_REF,
                "name": {"type": "string"},
                "config": VIEW_CONFIG,
            },
            ["table", "view"],
        ),
        "handler": update_view,
    },
    "delete_view": {
        "spec": tool_spec(
            "delete_view",
            "Delete view",
            "Remove a saved view; the rows it filtered stay untouched.",
            {"table": TABLE_REF, "view": VIEW_REF},
            ["table", "view"],
            destructive=True,
        ),
        "handler": delete_view,
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
