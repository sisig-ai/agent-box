"""Docs explorer panel."""

from htpy import (
    button,
    code,
    div,
    h2,
    input,
    label,
    li,
    option,
    p,
    section,
    select,
    span,
    template,
    textarea,
    ul,
)

from .panels_docs_tree import tree_rows


def _list_row() -> object:
    return template(**{"x-for": "doc in listRows", ":key": "doc.prefix"})[
        li(
            **{
                ":class": "[flatMode ? 'docs-flat-row' : ('docs-item' + (doc.kind === 'semantic' ? ' is-semantic' : '')),"
                " { selected: current && current.prefix === doc.prefix }]",
                ":data-prefix": "doc.prefix",
                "@click": "selectDoc(doc.prefix)",
            }
        )[
            template(**{"x-if": "flatMode"})[
                span(".docs-flat-cell.is-prefix")[
                    span(".docs-flat-prefix", **{"x-text": "doc.prefix"})[""],
                    span(
                        ".docs-tree-cards",
                        **{"x-show": "doc.card_count", "x-text": "'⧉' + doc.card_count"},
                    )[""],
                    span(
                        ".docs-flat-tags",
                        **{"x-show": "doc.tags && doc.tags.length", "x-text": "tagLabel(doc.tags)"},
                    )[""],
                ],
            ],
            template(**{"x-if": "flatMode"})[
                span(".docs-flat-cell.is-updated", **{"x-text": "fmtTime(doc.updated_at)"})[""],
            ],
            template(**{"x-if": "flatMode"})[
                span(
                    ".docs-flat-cell.is-author", **{"x-text": "doc.author ? '@' + doc.author : '—'"}
                )[""],
            ],
            template(**{"x-if": "!flatMode"})[
                div(**{})[
                    span(".docs-item-head")[
                        span(".docs-item-name")[
                            template(
                                **{
                                    "x-for": "(part, i) in markedParts(doc.prefix_snip || doc.prefix)",
                                    ":key": "i",
                                }
                            )[
                                span(
                                    **{":class": "{ 'docs-hl': part.mark }", "x-text": "part.text"}
                                )[""],
                            ],
                        ],
                        span(
                            ".docs-score",
                            **{
                                "x-show": "doc.kind === 'semantic' && typeof doc.score === 'number'",
                                "x-text": "doc.score ? doc.score.toFixed(2) : ''",
                            },
                        )[""],
                    ],
                    template(**{"x-if": "doc.snippet || doc.excerpt"})[
                        p(".docs-item-snip")[
                            template(
                                **{
                                    "x-for": "(part, i) in markedParts(doc.snippet || doc.excerpt)",
                                    ":key": "i",
                                }
                            )[
                                span(
                                    **{":class": "{ 'docs-hl': part.mark }", "x-text": "part.text"}
                                )[""],
                            ],
                        ],
                    ],
                    span(".docs-item-meta")[
                        span(**{"x-text": "doc.author ? '@' + doc.author : '—'"})[""],
                        span(**{"x-text": "fmtTime(doc.updated_at)"})[""],
                        span(
                            ".docs-item-tags",
                            **{
                                "x-show": "doc.tags && doc.tags.length",
                                "x-text": "tagLabel(doc.tags)",
                            },
                        )[""],
                        span(
                            **{
                                "x-show": "!doc.tags || !doc.tags.length",
                                "x-text": "doc.size ? doc.size + 'b' : ''",
                            }
                        )[""],
                    ],
                ],
            ],
        ],
    ]


def docs() -> object:
    return section(
        ".docs",
        **{"data-tabpanel": "docs", "x-ignore": True},
        id="docs-view",
        **{"aria-label": "Docs", "@keydown.window": "onEscape($event)"},
    )[
        div(".docs-head")[
            div(".docs-title")[
                h2["Docs"],
                span(".docs-sub")[
                    "prefix-keyed text store for handoffs, specs and long-horizon notes · ",
                    code["/api/docs"],
                ],
            ],
            div(".docs-actions")[
                div(".docs-searchbox", role="search")[
                    input(
                        id="docs-search",
                        type="search",
                        **{"x-ref": "search", "x-model": "q", "@input": "onSearchInput()"},
                        placeholder="search docs…",
                        autocomplete="off",
                        spellcheck="false",
                        **{
                            "aria-label": "Full-text search over prefixes, content, tags and authors"
                        },
                    ),
                    input(
                        id="docs-prefix-q",
                        type="search",
                        **{"x-ref": "prefixQ", "x-model": "prefixQ", "@input": "onSearchInput()"},
                        placeholder="prefix…",
                        autocomplete="off",
                        spellcheck="false",
                        **{
                            "aria-label": "Filter results by doc prefix, any part of the key",
                            "title": "Prefix search: any part of the doc key, e.g. card-389 or handoffs/",
                        },
                    ),
                    button(
                        id="docs-search-clear",
                        type="button",
                        title="Clear search",
                        **{"x-show": "q || prefixQ", "@click": "clearSearch()"},
                    )["×"],
                ],
                button(".brief-btn", id="docs-new", title="New doc", **{"@click": "startNew()"})[
                    "+ new"
                ],
                button(
                    ".brief-btn",
                    id="docs-refresh",
                    title="Reload the list",
                    **{"@click": "refresh()"},
                )["⟳ refresh"],
            ],
        ],
        div(".docs-body", **{":class": "{ 'is-flat': view === 'flat' }"})[
            div(".docs-list-wrap")[
                div(".docs-toolbar", role="group", **{"aria-label": "Explorer mode"})[
                    select(
                        ".docs-author",
                        id="docs-author",
                        **{
                            "aria-label": "Filter by author",
                            "title": "Only docs by this author",
                            ":class": "{ active: !!author }",
                            "x-model": "author",
                            "@change": "setAuthor(author)",
                        },
                    )[
                        template(**{"x-for": "option in authorOptions", ":key": "option.value"})[
                            option(**{":value": "option.value", "x-text": "option.label"})[""],
                        ],
                    ],
                    button(
                        ".docs-toggle",
                        id="docs-view-tree",
                        **{
                            ":class": "{ active: view === 'tree' }",
                            ":aria-pressed": "view === 'tree'",
                            "title": "Browse by prefix path",
                            "@click": "setView('tree')",
                        },
                    )["[tree]"],
                    button(
                        ".docs-toggle",
                        id="docs-view-flat",
                        **{
                            ":class": "{ active: view === 'flat' }",
                            ":aria-pressed": "view === 'flat'",
                            "title": "One list, sortable by prefix, updated or author",
                            "@click": "setView('flat')",
                        },
                    )["[flat]"],
                ],
                div(
                    ".docs-tree",
                    id="docs-tree",
                    **{"aria-label": "Prefix tree", "x-show": "view === 'tree'"},
                )[tree_rows()],
                p(
                    ".docs-tree-empty",
                    id="docs-tree-empty",
                    **{"x-show": "view === 'tree' && !all.length"},
                )["no docs yet"],
                ul(".docs-list", id="docs-list", **{"x-show": "listVisible"})[
                    li(".docs-flat-row.docs-flat-head", **{"x-show": "flatMode"})[
                        _sort_cell("prefix", "prefix"),
                        _sort_cell("updated", "updated"),
                        _sort_cell("author", "author"),
                    ],
                    _list_row(),
                    template(**{"x-if": "searching && (semanticRows.length || semanticNote)"})[
                        li(
                            ".docs-divider",
                            **{
                                "x-text": "'semantic' + (semanticRows.length ? ' · ' + semanticRows.length : '')"
                            },
                        )[""],
                    ],
                    template(**{"x-if": "searching && semanticNote"})[
                        li(".docs-divider-note", **{"x-text": "semanticNote"})[""],
                    ],
                ],
                p(
                    ".docs-empty-list",
                    id="docs-empty-list",
                    **{"x-show": "listVisible && !listRows.length", "x-text": "emptyListText"},
                )[""],
            ],
            div(".docs-editor", id="docs-editor", **{"x-show": "editorOpen"})[
                div(".docs-meta")[
                    label(".mono")[
                        "prefix",
                        input(
                            id="doc-prefix",
                            **{
                                "x-ref": "prefix",
                                "x-model": "form.prefix",
                                ":readonly": "!!current",
                                "@input": "markDirty()",
                            },
                            spellcheck="false",
                            placeholder="notes/handoff.md",
                        ),
                    ],
                    label(".mono")[
                        "author",
                        input(
                            id="doc-author",
                            **{"x-model": "form.author", "@input": "markDirty()"},
                            spellcheck="false",
                            placeholder="agent name",
                        ),
                    ],
                    label(".mono")[
                        "tags",
                        input(
                            id="doc-tags",
                            **{"x-model": "form.tags", "@input": "markDirty()"},
                            spellcheck="false",
                            placeholder="handoff, doctrine",
                        ),
                    ],
                ],
                div(
                    ".docs-backlinks",
                    id="doc-backlinks",
                    **{"x-ref": "backlinks", "x-show": "current"},
                )[""],
                textarea(
                    id="doc-content",
                    **{
                        "x-model": "form.content",
                        "@input": "markDirty()",
                        "@keydown": "onEditorKey($event)",
                    },
                    spellcheck="false",
                    placeholder="markdown…",
                )[""],
                div(".docs-editor-foot")[
                    span(".mono", id="doc-status", **{"x-text": "docStatus"})[""],
                    div(".docs-editor-actions")[
                        button(
                            ".brief-btn",
                            id="doc-delete",
                            title="Delete this doc (two clicks)",
                            **{"x-show": "!!current", "x-init": "armDelete($el)"},
                        )["delete"],
                        button(
                            ".brief-btn",
                            id="doc-save",
                            title="Save (Cmd/Ctrl+S)",
                            **{"@click": "save()"},
                        )["save"],
                    ],
                ],
            ],
            div(".docs-empty", id="docs-empty", **{"x-show": "!editorOpen"})[
                p(".mono")["select a doc from the list, or start one with + new"],
                p(".mono.dim")["prefix is the key: ", code["handoffs/2026-11-02-box-assistant.md"]],
            ],
        ],
        div(".docs-status")[
            span(id="docs-status", **{":class": "{ err: statusError }", "x-text": "status"})[
                "loading…"
            ],
            span(id="docs-count", **{"x-text": "countText"})[""],
        ],
    ]


def _sort_cell(key: str, label: str) -> object:
    return span(f".docs-flat-cell.is-{label}")[
        button(
            ".docs-sort",
            **{
                ":class": f"{{ active: sort.key === '{key}' }}",
                "@click": f"setSort('{key}')",
            },
        )[
            label,
            span(
                ".docs-sort-arrow",
                **{
                    "x-show": f"sort.key === '{key}'",
                    "x-text": "sort.dir === 1 ? '▲' : '▼'",
                },
            )[""],
        ],
    ]
