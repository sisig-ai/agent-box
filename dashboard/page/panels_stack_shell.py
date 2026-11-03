"""Stack grid (services) and the host shell panel."""

from htpy import (
    a,
    button,
    div,
    input,
    p,
    pre,
    section,
    span,
    template,
)


def stack() -> object:
    return div(
        **{"data-tabpanel": "stack", "x-ignore": True},
        id="stack-view",
        **{"x-on:keydown.window": "onKey($event)"},
    )[
        div(".scanner")[
            span(".glyph")[">"],
            input(
                id="search",
                type="text",
                placeholder="scan for a system…",
                autocomplete="off",
                spellcheck="false",
                **{"aria-label": "Search services", "x-ref": "search", "x-model": "query"},
                **{
                    "@keydown.escape": "query = ''; $event.target.blur()",
                    "@keydown.enter": "openFirst()",
                },
            ),
            span(".kbd")["/"],
        ],
        div(".grid", id="services")[
            template(**{"x-for": "(service, index) in visible", ":key": "service.name"})[
                a(
                    ".card",
                    **{"x-bind:href": "service.url"},
                    target="_blank",
                    rel="noopener",
                    **{
                        "x-bind:style": "cardStyle(service, index)",
                        "x-bind:data-search": "service.search",
                    },
                )[
                    span(".pod.mono", **{"x-text": "service.glyph"})[""],
                    span(".info")[
                        span(".name", **{"x-text": "service.name"})[""],
                        span(".meta")[
                            span(".description", **{"x-text": "service.description || ''"})[""],
                            template(**{"x-if": "service.port"})[
                                span(".port", **{"x-text": "':' + service.port"})[""],
                            ],
                        ],
                    ],
                    span(".chevron")["→"],
                ],
            ],
            p(".empty", id="stack-empty", **{"x-show": "!visible.length", "x-text": "emptyText"})[
                ""
            ],
        ],
    ]


def shell() -> object:
    keys = [
        ("mod", "S", "Shift (sticky)", "⇧"),
        ("mod", "C", "Ctrl (sticky)", "ctrl"),
        ("mod", "M", "Alt (sticky)", "alt"),
        ("key", "Escape", "Esc", "esc"),
        ("key", "Tab", "Tab", "tab"),
        ("key", "Left", "Left", "←"),
        ("key", "Up", "Up", "↑"),
        ("key", "Down", "Down", "↓"),
        ("key", "Right", "Right", "→"),
    ]
    buttons = []
    for kind, value, title, label in keys:
        attr = "data-mod" if kind == "mod" else "data-key"
        buttons.append(
            button(
                ".key-btn" + (".mod" if kind == "mod" else ""),
                type="button",
                title=title,
                **{attr: value},
                **({"aria-pressed": "false"} if kind == "mod" else {}),
            )[label]
        )

    return section(
        ".shell",
        **{"data-tabpanel": "shell", "x-ignore": True},
        id="shell-view",
        **{"aria-label": "Host shell"},
    )[
        div(".shell-head")[
            div(".shell-title")[
                span(".shell-dot", id="shell-dot")[""],
                span["shell — kixpanganiban@macmini ", span(".dim")["~"]],
                span(".shell-sess", id="shell-sess")[""],
            ],
            div(".shell-actions")[
                button(".brief-btn", id="shell-fit", title="Resize pty to fit this window")["fit"],
                button(".brief-btn", id="shell-clear", title="Clear screen (Ctrl-L)")["clear"],
                button(".brief-btn", id="shell-reconnect", title="Reconnect (poll now)")[
                    "reconnect"
                ],
                button(".brief-btn", id="shell-new", title="Kill and start a fresh shell in ~")[
                    "new"
                ],
            ],
        ],
        div(".term-wrap")[
            div(
                ".term",
                id="term",
                tabindex="0",
                role="textbox",
                **{"aria-label": "Host shell terminal", "aria-multiline": "true"},
            )[pre(".term-screen", id="term-screen")["connecting…"],],
        ],
        div(".term-keys", id="term-keys", role="toolbar", **{"aria-label": "Terminal keys"})[
            *buttons
        ],
        div(".term-hint")[
            span["click terminal, then type — full tty on the host, starting in ~"],
            span(id="shell-state")["…"],
        ],
    ]
