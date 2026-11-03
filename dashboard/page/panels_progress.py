"""Progress bars panel and its edit dialog."""

from htpy import (
    button,
    dialog,
    div,
    fieldset,
    h2,
    h3,
    input,
    label,
    legend,
    option,
    p,
    section,
    select,
    span,
    template,
)


def _dialog() -> object:
    return dialog(
        ".ascii-dialog.progress-dialog",
        id="progress-dialog",
        **{"x-ref": "dialog"},
        **{"aria-labelledby": "progress-dialog-title", "@close": "editingId = null"},
    )[
        h3(id="progress-dialog-title", **{"x-text": "editingId == null ? 'new bar' : 'edit bar'"})[
            "new bar"
        ],
        __import__("htpy").form(id="progress-form", **{"@submit.prevent": "save()"})[
            label[
                "title",
                input(
                    type="text",
                    id="pb-title",
                    **{"x-ref": "title", "x-model": "form.title"},
                    maxlength="200",
                    autocomplete="off",
                    spellcheck="false",
                    placeholder="e.g. 1,000-document enrichment batch",
                ),
            ],
            div(".pb-form-row")[
                label[
                    "percent",
                    input(
                        type="number",
                        id="pb-percent",
                        **{"x-model": "form.percent"},
                        min="0",
                        max="100",
                        step="0.1",
                        placeholder="0–100",
                    ),
                ],
                label[
                    "owner",
                    input(
                        type="text",
                        id="pb-owner",
                        **{"x-model": "form.owner"},
                        maxlength="100",
                        autocomplete="off",
                        spellcheck="false",
                        placeholder="who is tracking this",
                    ),
                ],
            ],
            label[
                "parent",
                select(id="pb-parent", **{"x-model": "form.parent"})[
                    option(value="")["— none (top level) —"],
                    template(**{"x-for": "node in parentOptions", ":key": "node.id"})[
                        option(**{":value": "String(node.id)", "x-text": "node.label"})[""],
                    ],
                ],
            ],
            fieldset(".pb-fieldset")[
                legend["fields — any key/value pairs shown on the card"],
                div(id="pb-fields")[
                    template(**{"x-for": "(field, index) in fields", ":key": "index"})[
                        div(".pb-field-row")[
                            input(
                                type="text",
                                **{"class": "pb-field-key", "x-model": "field.key"},
                                placeholder="field",
                            ),
                            input(
                                type="text",
                                **{"class": "pb-field-value", "x-model": "field.value"},
                                placeholder="value",
                            ),
                            button(
                                ".pb-field-del",
                                type="button",
                                **{
                                    "@click": "fields.splice(index, 1)",
                                    "title": "Remove this field",
                                },
                            )["×"],
                        ],
                    ],
                ],
                button(".brief-btn", id="pb-add-field", type="button", **{"@click": "addField()"})[
                    "+ field"
                ],
            ],
            p(".pb-error", id="pb-error", **{"x-show": "!!error", "x-text": "error"})[""],
            div(".progress-dialog-actions")[
                button(
                    ".brief-btn",
                    id="pb-cancel",
                    type="button",
                    **{"@click": "$refs.dialog.close()"},
                )["cancel"],
                button(".brief-btn", id="pb-save", type="submit")["save"],
            ],
        ],
    ]


def progress() -> object:
    return section(
        ".progress",
        **{"data-tabpanel": "progress", "x-ignore": True},
        id="progress-view",
        **{"aria-label": "Progress Bars"},
    )[
        div(".progress-head")[
            div(".progress-title")[
                h2["Progress Bars"],
                span(".progress-sub")[
                    "shared tracking for humans and agents · nested bars · k-v fields · ",
                    __import__("htpy").code["/api/progress"],
                ],
            ],
            div(".progress-actions")[
                button(
                    ".brief-btn",
                    id="progress-archived",
                    **{
                        "@click": "toggleArchived()",
                        ":class": "{ toggled: archivedOnly }",
                        ":title": "archivedOnly ? 'Back to live bars' : 'Show archived bars'",
                        "x-text": "archivedLabel",
                    },
                )["archived"],
                button(
                    ".brief-btn",
                    id="progress-add",
                    title="Add a top-level progress bar",
                    **{"@click": "openDialog(null)"},
                )["+ bar"],
                button(
                    ".brief-btn",
                    id="progress-refresh",
                    title="Reload every bar",
                    **{"@click": "refresh()"},
                )["⟳ refresh"],
            ],
        ],
        div(
            ".progress-grid",
            id="progress-grid",
            **{"x-html": "gridHtml", "@click": "onAction($event)"},
        )[""],
        div(".progress-status")[
            span(id="progress-status", **{"x-text": "status"})["loading…"],
            span(id="progress-count", **{"x-text": "countText"})[""],
        ],
        _dialog(),
    ]
