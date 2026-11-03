"""Daily sitrep and weekly schedule panel."""

from htpy import (
    aside,
    b,
    button,
    div,
    h2,
    i,
    input,
    p,
    s,
    section,
    span,
    textarea,
)

TOOLBAR = [
    ("h1", "Heading 1", "H1"),
    ("h2", "Heading 2", "H2"),
    ("h3", "Heading 3", "H3"),
    (None, None, None),
    ("bold", "Bold (Ctrl/Cmd+B)", b["B"]),
    ("italic", "Italic (Ctrl/Cmd+I)", i["I"]),
    ("strike", "Strikethrough", s["S"]),
    (None, None, None),
    ("code", "Inline code", "</>"),
    ("codeblock", "Code block", "```"),
    ("quote", "Blockquote", "❝"),
    (None, None, None),
    ("ul", "Bullet list", "•"),
    ("ol", "Numbered list", "1."),
    ("task", "Task list", "☐"),
    ("hr", "Horizontal rule", "—"),
    (None, None, None),
    ("link", "Link", "link"),
    ("table", "Table", "tbl"),
]


def _toolbar() -> object:
    out = []
    for md, title, body in TOOLBAR:
        if md is None:
            out.append(span(".tool-sep"))
        else:
            out.append(button(".tool-btn", **{"data-md": md}, title=title)[body])
    return div(
        ".brief-toolbar",
        role="toolbar",
        **{"aria-label": "Markdown toolbar"},
        **{"x-show": "tab === 'edit'", "@click": "onToolbar($event)"},
    )[*out]


def sitrep() -> object:
    return section(
        ".brief",
        **{"data-tabpanel": "brief", "x-ignore": True},
        id="brief",
        **{"aria-label": "Daily Sitrep and weekly schedule"},
    )[
        div(".brief-main")[
            div(".brief-head")[
                div(".brief-title")[
                    h2["Daily Sitrep"],
                    span(".brief-date-label", id="brief-date-label", **{"x-text": "dateLabel"})[""],
                ],
                div(".brief-nav")[
                    button(
                        ".brief-btn",
                        id="brief-prev",
                        title="Previous day",
                        **{"aria-label": "Previous day", "@click": "prev()"},
                    )["‹"],
                    input(
                        type="date",
                        id="brief-date",
                        **{"aria-label": "Sitrep date", "x-model": "date", "@change": "load(date)"},
                    ),
                    button(
                        ".brief-btn",
                        id="brief-next",
                        title="Next day",
                        **{"aria-label": "Next day", "@click": "next()"},
                    )["›"],
                    button(
                        ".brief-btn",
                        id="brief-today",
                        title="Jump to today",
                        **{"aria-label": "Jump to today", "@click": "today()"},
                    )["today"],
                ],
            ],
            _toolbar(),
            div(".brief-tabs")[
                button(
                    ".tab-btn",
                    **{
                        "x-bind:class": "{ active: tab === 'preview' }",
                        "@click": "setTab('preview')",
                    },
                )["preview"],
                button(
                    ".tab-btn",
                    **{"x-bind:class": "{ active: tab === 'edit' }", "@click": "setTab('edit')"},
                )["edit"],
            ],
            div(".brief-panes")[
                textarea(
                    ".brief-editor",
                    id="brief-editor",
                    **{"x-ref": "editor", "x-show": "tab === 'edit'", "x-model": "content"},
                    **{"@input": "onInput()", "@keydown": "onEditorKey($event)"},
                    placeholder="type today's sitrep… markdown supported. saved automatically.",
                )[""],
                div(
                    ".brief-preview",
                    id="brief-preview",
                    **{"x-ref": "preview", "x-show": "tab === 'preview'"},
                    **{
                        "x-bind:class": "{ visible: tab === 'preview' }",
                        "@change": "onPreviewChange($event)",
                        "x-html": "previewHtml",
                    },
                )[""],
            ],
            div(".brief-status")[
                span(
                    ".brief-save-state",
                    id="brief-save-state",
                    **{"x-bind:class": "'brief-save-state ' + saveClass", "x-text": "saveState"},
                )["ready"],
                span(id="brief-wordcount", **{"x-text": "wordText"})[""],
            ],
        ],
        aside(".brief-schedule", id="brief-schedule", **{"aria-label": "Weekly schedule"})[
            div(".schedule-head")[
                div(".schedule-title")[
                    h2["Schedule"],
                    span(
                        ".schedule-week-label",
                        id="schedule-week-label",
                        **{"x-text": "scheduleLabel"},
                    )[""],
                ],
                div(".schedule-nav")[
                    button(
                        ".brief-btn",
                        id="sched-prev",
                        title="Previous week",
                        **{"aria-label": "Previous week", "@click": "weekPrev()"},
                    )["‹"],
                    button(
                        ".brief-btn",
                        id="sched-next",
                        title="Next week",
                        **{"aria-label": "Next week", "@click": "weekNext()"},
                    )["›"],
                    button(
                        ".brief-btn",
                        id="sched-now",
                        title="This week",
                        **{"aria-label": "This week", "@click": "weekNow()"},
                    )["now"],
                ],
            ],
            div(".schedule-preview", id="schedule-preview")[
                p(".schedule-empty", **{"x-show": "scheduleEmpty", "x-text": "scheduleEmptyText"})[
                    ""
                ],
                div(".schedule-calendar", **{"x-show": "!scheduleEmpty && scheduleMapped"})[
                    _schedule_rows(),
                ],
                div(
                    ".schedule-extra",
                    **{"x-show": "!!scheduleExtra", "x-html": "scheduleExtraHtml"},
                )[""],
            ],
        ],
    ]


def _schedule_rows() -> object:
    from htpy import template

    return template(**{"x-for": "(day, index) in scheduleDays", ":key": "day.label"})[
        div(".cal-row", **{"x-bind:class": "{ 'cal-today': index === todayOffset }"})[
            div(".cal-rowhead", **{"x-text": "day.label"})[""],
            template(**{"x-if": "!day.items.length"})[div(".cal-event.cal-event-empty")["—"],],
            template(**{"x-for": "(item, i) in day.items", ":key": "day.label + i"})[
                div(".cal-event", **{"x-bind:class": "{ done: item.done }", "x-text": "item.text"})[
                    ""
                ],
            ],
        ],
    ]
