"""Tables panel: Airtable-shaped grid over /api/tables."""

from htpy import (
    aside,
    button,
    dialog,
    div,
    h2,
    h3,
    input,
    label,
    option,
    p,
    section,
    select,
    span,
    table,
    tbody,
    td,
    template,
    textarea,
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
                            span(".tbl-th-name", **{"x-text": "column.name"})[""],
                            span(".tbl-th-type", **{"x-text": "column.subtype || column.type"})[""],
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
        _table_dialog(),
        _column_dialog(),
    ]


def main_block() -> object:
    from htpy import main

    return main(".tbl-main")[
        div(".tbl-title")[
            h3(
                ".tbl-name",
                title="Click to rename",
                **{
                    "@click": "editTableName($event)",
                    "x-text": "table ? table.name : 'no table selected'",
                },
            )[""],
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


def _table_dialog() -> object:
    return dialog(
        ".ascii-dialog",
        id="tables-new-dialog",
        **{"x-show": "tableOpen", "x-ref": "tableDialog", "@close": "tableOpen = false"},
    )[
        h3["new table"],
        __import__("htpy").form(**{"@submit.prevent": "createTable()"})[
            label[
                "name",
                input(
                    type="text",
                    **{"x-model": "tableDraft.name", "x-ref": "tableName"},
                    maxlength="80",
                    placeholder="e.g. Vendors",
                ),
            ],
            label[
                "description (optional)",
                textarea(**{"x-model": "tableDraft.description"}, rows="2")[""],
            ],
            div(".tbl-dialog-actions")[
                button(".brief-btn", type="button", **{"@click": "$refs.tableDialog.close()"})[
                    "cancel"
                ],
                button(".brief-btn", type="submit")["create"],
            ],
        ],
    ]


def _column_dialog() -> object:
    return dialog(
        ".ascii-dialog",
        id="tables-column-dialog",
        **{"x-show": "columnOpen", "x-ref": "columnDialog", "@close": "columnOpen = false"},
    )[
        h3["new column"],
        __import__("htpy").form(**{"@submit.prevent": "createColumn()"})[
            label[
                "name",
                input(
                    type="text",
                    **{"x-model": "columnDraft.name", "x-ref": "columnName"},
                    maxlength="60",
                    placeholder="e.g. Status",
                ),
            ],
            label[
                "type",
                select(**{"x-model": "columnDraft.type"})[
                    template(**{"x-for": "pair in types", ":key": "pair[0]"})[
                        option(**{":value": "pair[0]", "x-text": "pair[1]"})[""],
                    ],
                ],
            ],
            label(**{"x-show": "columnDraft.type === 'string'"})[
                "string style",
                select(**{"x-model": "columnDraft.subtype"})[
                    option(value="text")["text"],
                    option(value="select")["select"],
                    option(value="multi_select")["multi-select"],
                ],
            ],
            label(**{"x-show": "columnDraft.type === 'number'"})[
                "number style",
                select(**{"x-model": "columnDraft.subtype"})[
                    option(value="float")["float"],
                    option(value="int")["integer"],
                ],
            ],
            label(
                **{"x-show": "columnDraft.type === 'select' || columnDraft.type === 'multi_select'"}
            )[
                "options (comma separated)",
                input(
                    type="text",
                    **{"x-model": "columnDraft.options"},
                    placeholder="todo, doing, done",
                ),
            ],
            label(**{"x-show": "columnDraft.type === 'url'"})[
                input(type="checkbox", **{"x-model": "columnDraft.requireHttps"}),
                " https only",
            ],
            label(**{"x-show": "columnDraft.type === 'formula'"})[
                "formula",
                input(
                    type="text",
                    **{"x-model": "columnDraft.expression"},
                    placeholder='IF({Done}, "✓ " + {Title}, {Title})',
                ),
            ],
            label(**{"x-show": "columnDraft.type === 'ref' || columnDraft.type === 'rollup'"})[
                "target table",
                select(**{"x-model": "columnDraft.targetTable"})[
                    template(**{"x-for": "item in tables", ":key": "item.id"})[
                        option(**{":value": "String(item.id)", "x-text": "item.name"})[""],
                    ],
                ],
            ],
            label(**{"x-show": "columnDraft.type === 'ref'"})[
                input(type="checkbox", **{"x-model": "columnDraft.multiple"}),
                " allow several records",
            ],
            label(**{"x-show": "columnDraft.type === 'rollup'"})[
                "ref column",
                input(type="text", **{"x-model": "columnDraft.refColumn"}, placeholder="Vendor"),
            ],
            label(**{"x-show": "columnDraft.type === 'rollup'"})[
                "target column",
                input(type="text", **{"x-model": "columnDraft.targetColumn"}, placeholder="Name"),
            ],
            label(**{"x-show": "columnDraft.type === 'rollup'"})[
                "aggregate",
                select(**{"x-model": "columnDraft.aggregate"})[
                    option(value="count")["count"],
                    option(value="sum")["sum"],
                    option(value="avg")["avg"],
                    option(value="min")["min"],
                    option(value="max")["max"],
                    option(value="concat")["concat"],
                    option(value="list")["list"],
                ],
            ],
            div(".tbl-dialog-actions")[
                button(".brief-btn", type="button", **{"@click": "$refs.columnDialog.close()"})[
                    "cancel"
                ],
                button(".brief-btn", type="submit")["create"],
            ],
        ],
    ]
