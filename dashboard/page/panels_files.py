"""Files explorer panel."""

from htpy import (
    aside,
    button,
    dd,
    div,
    dl,
    dt,
    h2,
    h3,
    input,
    nav,
    section,
    span,
    table,
    tbody,
    td,
    template,
    th,
    thead,
    tr,
)

HEAD_BUTTONS = [
    ("files-up", "Up one level", "up()", "↑ up"),
    ("files-home", "Go to home directory", "goHome()", "~ home"),
    ("files-refresh", "Reload this folder", "refresh()", "⟳ refresh"),
]
SORT_COLUMNS = [
    ("name", "Name", "col-name"),
    ("size", "Size", "col-size"),
    ("mtime", "Modified", "col-date"),
    ("mode", "Mode", "col-mode"),
]


def _sort_header() -> object:
    cells = []
    for key, label, cls in SORT_COLUMNS:
        cells.append(
            th(
                f".{cls}",
                **{"@click": f"sortBy('{key}')"},
                **{":class": f"{{ sorted: isSorted('{key}'), asc: sortAsc('{key}') }}"},
            )[label]
        )
    cells.append(th(".col-actions", **{"aria-label": "Actions"})[""])
    return tr[*cells]


def _row() -> object:
    return template(**{"x-for": "entry in visible", ":key": "entry.path"})[
        tr(
            ".files-row",
            **{"x-bind:class": "{ selected: isSelected(entry) }"},
            **{
                "@click": "select(entry)",
                "@dblclick": "entry.is_dir ? cd(entry.path) : openEntry(entry)",
            },
        )[
            td[
                div(".files-name-cell")[
                    span(".files-icon", **{"x-text": "fileIcon(entry)"})[""],
                    span(".files-name", **{"x-text": "entry.name"})[""],
                    span(".files-link-note", **{"x-show": "entry.is_link"})["link"],
                ]
            ],
            td(".files-size", **{"x-text": "entry.is_dir ? '—' : fmtSize(entry.size)"})[""],
            td(".files-date", **{"x-text": "fmtTime(entry.mtime)"})[""],
            td(".files-mode", **{"x-text": "entry.mode"})[""],
            td(".files-actions-cell")[
                div(".files-row-actions")[
                    button(
                        ".files-act",
                        type="button",
                        title="Open folder",
                        **{"x-show": "entry.is_dir", "@click.stop": "cd(entry.path)"},
                    )["▸"],
                    button(
                        ".files-act",
                        type="button",
                        title="Open in editor",
                        **{"x-show": "!entry.is_dir", "@click.stop": "openEntry(entry)"},
                    )["⤢"],
                    button(
                        ".files-act",
                        type="button",
                        title="Download",
                        **{"x-show": "!entry.is_dir", "@click.stop": "download(entry)"},
                    )["⬇"],
                    button(
                        ".files-act",
                        type="button",
                        title="Rename",
                        **{"@click.stop": "rename(entry)"},
                    )["✎"],
                    button(
                        ".files-act.danger",
                        type="button",
                        title="Delete",
                        **{"@click.stop": "remove(entry)"},
                    )["✕"],
                ]
            ],
        ],
    ]


def files() -> object:
    return section(
        ".files",
        **{"data-tabpanel": "files", "x-ignore": True},
        id="files-view",
        **{"aria-label": "Filesystem explorer"},
    )[
        div(".files-head")[
            div(".files-title")[
                h2["Files"],
                span(
                    ".files-path-label",
                    id="files-path-label",
                    **{"x-text": "cwd || '~'", ":title": "cwd || ''"},
                )["~"],
            ],
            div(".files-actions")[
                *[
                    button(".brief-btn", id=btn_id, title=title, **{"@click": action})[label]
                    for btn_id, title, action, label in HEAD_BUTTONS
                ],
                button(
                    ".brief-btn",
                    id="files-hidden",
                    title="Show or hide dotfiles",
                    **{":class": "{ toggled: showHidden }", "@click": "toggleHidden()"},
                )["◌ hidden"],
                button(
                    ".brief-btn",
                    id="files-mkdir",
                    title="Create a new folder",
                    **{"@click": "newFolder()"},
                )["+ folder"],
                button(
                    ".brief-btn",
                    id="files-touch",
                    title="Create a new empty file",
                    **{"@click": "newFile()"},
                )["+ file"],
                button(
                    ".brief-btn",
                    id="files-upload",
                    title="Upload files into this folder",
                    **{"@click": "$refs.upload.click()"},
                )["⬆ upload"],
                input(
                    type="file",
                    id="files-upload-input",
                    **{"x-ref": "upload", "@change": "upload($event.target.files)"},
                    multiple=True,
                    hidden=True,
                ),
            ],
        ],
        nav(
            ".files-breadcrumb",
            id="files-breadcrumb",
            **{"aria-label": "Current folder", "x-show": "!editor.open"},
        )[
            template(**{"x-for": "item in crumbs", ":key": "item.key"})[
                span(
                    **{
                        ":class": "item.sep ? 'files-crumb-sep' : ('files-crumb' + (item.current ? ' current' : ''))",
                        "x-text": "item.label",
                        "@click": "!item.sep && !item.current && cd(item.path)",
                    },
                )[""],
            ]
        ],
        div(".files-body")[
            div(".files-editor", id="files-editor", **{"x-show": "editor.open"})[
                div(".files-editor-head")[
                    span(".files-editor-name", id="files-editor-name", **{"x-text": "editor.name"})[
                        ""
                    ],
                    span(
                        ".files-editor-dirty", id="files-editor-dirty", **{"x-show": "editor.dirty"}
                    )["unsaved"],
                    div(".files-editor-actions")[
                        button(
                            ".brief-btn",
                            id="files-editor-save",
                            title="Save (Cmd/Ctrl+S)",
                            **{"@click": "saveEditor()"},
                        )["save"],
                        button(
                            ".brief-btn",
                            id="files-editor-download",
                            title="Download current content",
                            **{"@click": "downloadCurrent()"},
                        )["download"],
                        button(
                            ".brief-btn",
                            id="files-editor-close",
                            title="Close (Esc)",
                            **{"@click": "closeEditor()"},
                        )["close"],
                    ],
                ],
                div(".files-editor-host", id="files-editor-host", **{"x-ref": "host"})[""],
                div(
                    ".files-editor-status", id="files-editor-status", **{"x-text": "editor.status"}
                )[""],
            ],
            div(
                ".files-list-wrap",
                id="files-list-wrap",
                **{"x-show": "!editor.open"},
                **{
                    ":class": "{ dragover: dragging }",
                    "@dragover.prevent": "dragging = true",
                    "@dragleave.self": "dragging = false",
                    "@drop.prevent": "onDrop($event)",
                },
            )[
                table(".files-table")[
                    thead[_sort_header()],
                    tbody(id="files-tbody")[_row()],
                ],
                div(".files-empty", id="files-empty", **{"x-show": "!visible.length"})[
                    "// this folder is empty"
                ],
                div(".files-drop-hint")["drop to upload into this folder"],
            ],
            aside(".files-info", **{"aria-label": "Selection details", "x-show": "!editor.open"})[
                h3["details"],
                div(id="files-info-body")[
                    div(".files-info-empty", **{"x-show": "!info"})[
                        "click a file or folder to see its info"
                    ],
                    div(**{"x-show": "info"})[
                        div(".files-info-name")[
                            span(".files-icon", **{"x-text": "info?.icon"})[""],
                            span(**{"x-text": "info?.name"})[""],
                        ],
                        dl[
                            template(**{"x-for": "row in (info?.rows || [])", ":key": "row.k"})[
                                dt(**{"x-text": "row.k"})[""],
                                dd(**{"x-text": "row.v"})[""],
                            ]
                        ],
                    ],
                ],
                div(".files-places", id="files-places")[
                    h3["Places"],
                    template(**{"x-for": "place in places", ":key": "place.path"})[
                        button(
                            ".files-place",
                            type="button",
                            **{
                                ":class": "{ active: place.path === cwd }",
                                ":title": "place.path",
                                "@click": "cd(place.path)",
                                "x-text": "place.name + '  ' + placeLabel(place.path)",
                            },
                        )[""],
                    ],
                ],
            ],
        ],
        div(".files-status", id="files-status-bar", **{":class": "{ error: statusError }"})[
            span(id="files-status", **{"x-text": "status"})["opening ~ …"],
            span(id="files-count", **{"x-text": "countText"})[""],
        ],
    ]
