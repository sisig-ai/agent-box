"""Document skeleton: html, body, sidebar, header, footer, dialogs, scripts."""

from htpy import (
    a,
    body,
    button,
    code,
    dialog,
    div,
    footer,
    form,
    h1,
    h3,
    html,
    input,
    main,
    nav,
    p,
    pre,
    script,
    span,
)

from .head import document_head

VIEWS = [
    ("brief", "#/brief", "Daily Sitrep (b)", "[sitrep]"),
    ("stack", "#/", "Stack (s)", "[stack]"),
    ("files", "#/files", "Files (f)", "[files]"),
    ("shell", "#/shell", "Shell (t)", "[shell]"),
    ("kanban", "#/kanban", "Ops Board (k)", "[ops board]"),
    ("progress", "#/progress", "Progress Bars (p)", "[progress]"),
    ("docs", "#/docs", "Docs (d)", "[docs]"),
    ("tables", "#/tables", "Tables (a)", "[tables]"),
    ("logs", "#/logs", "Access logs (l)", "[logs]"),
]


def sidebar() -> object:
    return div(".side")[
        a(".home", href="#/")["macmini"],
        p(".by", id="count", **{"x-text": "count"})["loading…"],
        nav(".view-tabs", **{"aria-label": "Views"})[
            *[
                a(".view-btn", id=f"view-btn-{key}", href=href, title=title)[label]
                for key, href, title, label in VIEWS
            ]
        ],
        div(".side-foot")[
            p(".dim")["host"],
            p(id="host", **{"x-text": "host"})["—"],
            button(".linkbtn", id="keys-btn", type="button")["[keys]"],
        ],
    ]


def header_block() -> object:
    from htpy import header

    return header[
        div(".brand")[
            h1(id="title", **{"x-text": "title"})["macmini"],
            p(".subtitle", id="greeting", **{"x-text": "greeting"})["all systems standing by."],
        ],
        div(".readout", **{"aria-label": "Local time"})[
            span(".readout-time", id="readout-time", **{"x-text": "time"})["--:--"],
            span(".readout-meta")[
                span(id="readout-date", **{"x-text": "date"})[""],
                " ",
                span(".readout-tz", id="readout-tz", **{"x-text": "tz"})[""],
            ],
        ],
    ]


def page_footer() -> object:
    return footer(".foot")[
        span(".dim")["// edit ", code["config.json"], " to add systems"],
        span(".dim")["? keys · macmini:5555"],
    ]


def files_modal() -> object:
    return div(".fs-modal-backdrop", id="fs-modal", hidden=True)[
        div(
            ".fs-modal",
            role="dialog",
            **{"aria-modal": "true", "aria-labelledby": "fs-modal-title"},
        )[
            h3(id="fs-modal-title")["title"],
            p(id="fs-modal-text", hidden=True)[""],
            input(
                type="text",
                id="fs-modal-input",
                hidden=True,
                autocomplete="off",
                spellcheck="false",
            ),
            div(".fs-modal-actions")[
                button(".brief-btn", id="fs-modal-cancel")["cancel"],
                button(".brief-btn.fs-modal-ok", id="fs-modal-ok")["ok"],
            ],
        ],
    ]


def keys_dialog() -> object:
    return dialog(".ascii-dialog", id="keys-dialog", **{"aria-labelledby": "keys-title"})[
        h3(id="keys-title")["keys"],
        pre(".keys")[
            "\n b   sitrep        s   stack\n"
            " f   files         t   shell\n"
            " k   ops board     p   progress\n"
            " d   docs          a   tables\n"
            " l   access logs   /   search\n"
            " ?   this panel    esc close / clear / read"
            " esc close / clear / read"
        ],
        form(method="dialog")[button(".brief-btn")["close"]],
    ]


def tui_bar() -> object:
    return div(".tui-bar", **{"aria-hidden": "true"})[
        span(".tui-bar-id")["macmini@tty"],
        span(".tui-bar-keys")[
            "b sitrep · s stack · f files · t shell · k ops · p progress · a tables · ? keys"
        ],
        span(".tui-bar-cursor")["█"],
    ]


def document(*panels: object) -> str:
    page = html(lang="en")[
        document_head(),
        body(**{"data-view": "stack"})[
            div(".container", **{"x-data": "chrome"})[
                sidebar(),
                main(".page")[header_block(), *panels, page_footer()],
            ],
            files_modal(),
            keys_dialog(),
            tui_bar(),
            script(type="module", src="/static/js/main.js?v=alpine11"),
        ],
    ]
    return str(page)
