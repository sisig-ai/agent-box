"""Dialogs for the Tables panel: new table and new/edit column."""

from htpy import button, dialog, div, form, h3, input, label, option, select, template, textarea


def table_dialog() -> object:
    return dialog(
        ".ascii-dialog",
        id="tables-new-dialog",
        **{"x-show": "tableOpen", "x-ref": "tableDialog", "@close": "tableOpen = false"},
    )[
        h3["new table"],
        form(**{"@submit.prevent": "createTable()"})[
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
                button(
                    ".brief-btn", type="submit", **{"x-text": "columnEditing ? 'save' : 'create'"}
                )["create"],
            ],
        ],
    ]


def column_dialog() -> object:
    return dialog(
        ".ascii-dialog",
        id="tables-column-dialog",
        **{"x-show": "columnOpen", "x-ref": "columnDialog", "@close": "columnOpen = false"},
    )[
        h3(**{"x-text": "columnEditing ? 'edit column' : 'new column'"})["new column"],
        form(**{"@submit.prevent": "saveColumn()"})[
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
                button(
                    ".brief-btn", type="submit", **{"x-text": "columnEditing ? 'save' : 'create'"}
                )["create"],
            ],
        ],
    ]
