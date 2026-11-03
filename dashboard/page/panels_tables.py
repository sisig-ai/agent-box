"""Tables panel: Airtable-shaped grid over /api/tables."""

from htpy import (
    aside,
    button,
    div,
    h2,
    h3,
    input,
    option,
    p,
    section,
    select,
    span,
    table,
    tbody,
    td,
    template,
    th,
    thead,
    tr,
)


def _cell() -> object:
    return td(
        ".tbl-cell",
        **{":class": "{ computed: column.computed, editing: isEditing(record, column) }"},
        **{"@click": "!isEditing(record, column) && beginEdit(record, column)"},
    )[
        template(
            **{"x-if": "isEditing(record, column) && column.type === 'select'"},
        )[
            select(
                ".tbl-cell-input",
                **{
                    "x-model": "draft",
                    "@change": "commitEdit(record, column)",
                    "@blur": "commitEdit(record, column)",
                },
            )[
                template(**{"x-for": "option in (column.config.options || [])", ":key": "option"})[
                    option(**{":value": "option", "x-text": "option"})[""],
                ],
            ],
        ],
        template(**{"x-if": "isEditing(record, column) && column.type !== 'select'"})[
            input(
                ".tbl-cell-input",
                **{
                    "x-model": "draft",
                    "@blur": "commitEdit(record, column)",
                    "@keydown.enter.prevent": "commitEdit(record, column)",
                    "@keydown.escape.prevent": "cancelEdit()",
                },
            ),
        ],
        template(**{"x-if": "!isEditing(record, column)"})[
            span(
                ".tbl-value",
                **{
                    ":class": "{ tick: column.type === 'bool' && record.values[column.name] }",
                    "x-text": "column.type === 'bool' ? (record.values[column.name] ? '✓' : '—') "
                    ": display(record, column)",
                },
            )[""],
        ],
    ]


def _grid() -> object:
    return div(".tbl-grid-wrap")[
        table(".tbl-grid", id="tbl-grid")[
            thead[
                tr[
                    template(**{"x-for": "column in columns", ":key": "column.id"})[
                        th(
                            ".tbl-th",
                            **{
                                ":title": "column.type + ' column'",
                                ":class": "{ computed: column.computed }",
                            },
                        )[
                            template(**{"x-if": "editingColumn === column.id"})[
                                input(
                                    ".tbl-th-input",
                                    **{
                                        "x-model": "columnNameDraft",
                                        "@blur": "commitColumnName(column)",
                                        "@keydown.enter.prevent": "commitColumnName(column)",
                                        "@keydown.escape.prevent": "cancelColumnRename()",
                                    },
                                    maxlength="60",
                                ),
                            ],
                            template(**{"x-if": "editingColumn !== column.id"})[
                                span(
                                    ".tbl-th-name",
                                    title="Click to rename",
                                    **{
                                        "x-text": "column.name",
                                        "@click": "startColumnRename(column)",
                                    },
                                )[""],
                            ],
                            span(".tbl-th-type", **{"x-text": "column.subtype || column.type"})[""],
                            button(
                                ".tbl-th-edit",
                                type="button",
                                title="Edit column",
                                **{"@click": "openColumnDialog(column)"},
                            )["✎"],
                            button(
                                ".tbl-th-del",
                                type="button",
                                title="Delete column",
                                **{"x-show": "!column.computed", "@click": "deleteColumn(column)"},
                            )["×"],
                        ],
                    ],
                    th(".tbl-th-add")[
                        button(
                            ".tbl-add-col",
                            type="button",
                            title="Add a column",
                            **{"@click": "openColumnDialog()"},
                        )["+ column"],
                    ],
                ],
            ],
            tbody[
                template(**{"x-for": "record in records", ":key": "record.id"})[
                    tr(".tbl-row", **{":class": "{ archived: !!record.archived_at }"})[
                        template(**{"x-for": "column in columns", ":key": "column.id"})[_cell()],
                        td(".tbl-row-menu")[
                            button(
                                ".tbl-icon",
                                type="button",
                                title="Archive / restore record",
                                **{
                                    "@click": "archiveRecord(record)",
                                    "x-text": "record.archived_at ? '⟲' : '⌫'",
                                },
                            )[""],
                            button(
                                ".tbl-icon.danger",
                                type="button",
                                title="Delete record",
                                **{"@click": "deleteRecord(record)"},
                            )["×"],
                        ],
                    ],
                ],
            ],
        ],
        p(".tbl-empty", **{"x-show": "!records.length"})["no records yet — “+ row” starts one"],
    ]


def tables() -> object:
    return section(
        ".tables",
        **{"data-tabpanel": "tables", "x-ignore": True},
        id="tables-view",
        **{"aria-label": "Tables"},
    )[
        div(".tbl-head")[
            div(".tbl-heading")[
                h2["Tables"],
                span(".tbl-sub")[
                    "typed rows like a spreadsheet · bot and human friendly · ",
                    __import__("htpy").code["/api/tables"],
                ],
            ],
            div(".tbl-actions")[
                button(
                    ".brief-btn",
                    id="tables-archived",
                    title="Show or hide archived tables",
                    **{
                        "@click": "toggleArchived()",
                        "x-text": "showArchived ? 'live only' : 'archived'",
                    },
                )["archived"],
                button(
                    ".brief-btn",
                    id="tables-new",
                    title="Create a table",
                    **{"@click": "openTableDialog()"},
                )["+ table"],
                button(".brief-btn", id="tables-refresh", title="Reload", **{"@click": "load()"})[
                    "⟳ refresh"
                ],
            ],
        ],
        div(".tbl-body")[
            aside(".tbl-list", **{"aria-label": "Tables"})[
                template(**{"x-for": "item in visibleTables", ":key": "item.id"})[
                    button(
                        ".tbl-item",
                        type="button",
                        **{
                            ":class": "{ active: String(current) === String(item.id) }",
                            "@click": "openTable(item.id)",
                        },
                    )[
                        span(".tbl-item-name", **{"x-text": "item.name"})[""],
                        span(
                            ".tbl-item-meta",
                            **{
                                "x-text": "item.record_count + ' rows · ' + item.column_count + ' cols'"
                            },
                        )[""],
                    ],
                ],
                p(".tbl-none", **{"x-show": "!visibleTables.length"})["no tables yet"],
            ],
            main_block(),
        ],
        table_dialog(),
        column_dialog(),
    ]


def main_block() -> object:
    from htpy import main

    return main(".tbl-main")[
        div(".tbl-title")[
            template(**{"x-if": "!tableNameEditing"})[
                h3(
                    ".tbl-name",
                    title="Click to rename",
                    **{
                        "@click": "startTableRename()",
                        "x-text": "table ? table.name : 'no table selected'",
                    },
                )[""],
            ],
            template(**{"x-if": "tableNameEditing"})[
                input(
                    ".tbl-name-input",
                    **{
                        "x-model": "tableNameDraft",
                        "@blur": "commitTableName()",
                        "@keydown.enter.prevent": "commitTableName()",
                        "@keydown.escape.prevent": "tableNameEditing = false",
                    },
                    maxlength="80",
                ),
            ],
            span(
                ".tbl-counts",
                **{
                    "x-text": "table ? (records.length + ' rows · ' + columns.length + ' columns') : ''"
                },
            )[""],
            div(".tbl-title-actions")[
                button(
                    ".brief-btn",
                    type="button",
                    title="Archive or restore this table",
                    **{
                        "@click": "toggleArchive()",
                        "x-show": "!!table",
                        "x-text": "table && table.archived_at ? 'restore' : 'archive'",
                    },
                )["archive"],
                button(
                    ".brief-btn",
                    type="button",
                    title="Delete this table",
                    **{"@click": "deleteTable()", "x-show": "!!table"},
                )["delete"],
            ],
        ],
        _grid(),
        div(".tbl-foot")[
            button(
                ".brief-btn",
                id="tables-add-row",
                title="Add a record",
                **{"@click": "addRecord()", "x-show": "!!table"},
            )["+ row"],
            span(".tbl-status", **{":class": "{ err: failed }", "x-text": "status"})["loading…"],
        ],
    ]


from .panels_tables_dialogs import column_dialog, table_dialog  # noqa: E402
