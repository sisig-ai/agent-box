"""Access logs panel."""

from htpy import (
    button,
    div,
    h2,
    option,
    p,
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


def logs() -> object:
    return section(
        ".logs",
        **{"data-tabpanel": "logs", "x-ignore": True},
        id="logs-view",
        **{"aria-label": "Access logs"},
    )[
        div(".logs-head")[
            div(".logs-title")[
                h2["Access Logs"],
                span(".logs-sub")[
                    "every MCP invocation, newest first · ", __import__("htpy").code["/mcp"]
                ],
            ],
            div(".logs-actions")[
                __import__("htpy").label(".logs-filter")[
                    "tool",
                    __import__("htpy").select(
                        id="logs-tool",
                        **{
                            "aria-label": "Filter by tool",
                            "x-model": "tool",
                            "@change": "refresh()",
                            ":class": "{ active: !!tool }",
                        },
                    )[
                        option(value="")["all tools"],
                        template(**{"x-for": "name in tools", ":key": "name"})[
                            option(**{":value": "name", "x-text": "name"})[""],
                        ],
                    ],
                ],
                __import__("htpy").label(".logs-filter")[
                    "result",
                    __import__("htpy").select(
                        id="logs-ok",
                        **{
                            "aria-label": "Filter by outcome",
                            "x-model": "ok",
                            "@change": "refresh()",
                            ":class": "{ active: !!ok }",
                        },
                    )[
                        option(value="")["all"],
                        option(value="1")["ok"],
                        option(value="0")["error"],
                    ],
                ],
                button(
                    ".brief-btn",
                    id="logs-refresh",
                    title="Reload the log",
                    **{"@click": "refresh()"},
                )["⟳ refresh"],
            ],
        ],
        div(".logs-body", **{"x-ref": "body"})[
            table(".logs-table")[
                thead[
                    tr[
                        th(".lg-time")["time"],
                        th(".lg-action")["action"],
                        th(".lg-entity")["entity"],
                        th(".lg-ms")["ms"],
                        th(".lg-status")["result"],
                        th(".lg-args")["request"],
                    ]
                ],
                tbody(id="logs-rows")[
                    template(**{"x-for": "(entry, index) in rows", ":key": "index"})[
                        tr(
                            **{
                                ":class": "entry.ok ? 'lg-ok' : 'lg-err'",
                                ":title": "rowTitle(entry)",
                            }
                        )[
                            td(".lg-time")[
                                span(".lg-clock", **{"x-text": "clock(entry.ts)"})[""],
                                span(".lg-day", **{"x-text": "day(entry.ts)"})[""],
                            ],
                            td(".lg-action", **{"x-text": "entry.tool"})[""],
                            td(".lg-entity", **{"x-text": "entry.entity || '—'"})[""],
                            td(".lg-ms", **{"x-text": "entry.ms"})[""],
                            td(".lg-status")[
                                span(
                                    ".lg-pill",
                                    **{
                                        ":class": "entry.ok ? 'ok' : 'err'",
                                        "x-text": "entry.ok ? 'ok' : 'err'",
                                    },
                                )[""],
                            ],
                            td(
                                ".lg-args",
                                **{
                                    "x-text": "entry.error ? 'error: ' + entry.error : (entry.args || '')",
                                },
                            )[""],
                        ],
                    ],
                ],
            ],
            p(".logs-empty", id="logs-empty", **{"x-show": "!rows.length"})["no calls logged yet"],
        ],
        div(".logs-status")[
            span(id="logs-status", **{":class": "{ err: failed }", "x-text": "status"})["loading…"],
            span(id="logs-count", **{"x-text": "summary"})[""],
        ],
    ]
