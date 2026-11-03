"""Live host telemetry: CPU, memory plus the process table, and power."""

from htpy import button, canvas, div, i, section, span, table, tbody, th, thead, tr


def _card(card_id: str, label: str, aria: str, *body: object) -> object:
    return div(
        ".tele-card",
        id=card_id,
        role="button",
        tabindex="0",
        **{"aria-expanded": "false", "aria-label": aria},
    )[
        div(".tele-label")[span[label], span(".tele-live")[i, "live"]],
        *body,
    ]


def telemetry() -> object:
    return section(".telemetry", id="telemetry", **{"aria-label": "Live host telemetry"})[
        div(
            ".tele-card",
            id="tele-card-cpu",
            role="button",
            tabindex="0",
            **{"aria-expanded": "false", "aria-label": "CPU — activate to expand 1 hour graph"},
        )[
            div(".tele-label")[span["cpu"], span(".tele-live")[i, "live"]],
            div(".tele-duo")[
                div(".tele-half")[
                    div(".tele-main")[span(id="tele-cpu-util")["—"], span(".tele-unit")["%"]],
                    div(".tele-sub")["util · 0–100%"],
                    div(".tele-bar", title="Utilization (0–100%)")[i(id="tele-cpu-bar")],
                ],
                div(".tele-half.is-temp")[
                    div(".tele-main")[span(id="tele-cpu-temp")["—"], span(".tele-unit")["°C"]],
                    div(".tele-sub", id="tele-cpu-temp-src")["pkg · 30–100 °C"],
                    div(".tele-bar", title="Package temp (30–100 °C)")[i(id="tele-cpu-temp-bar")],
                ],
            ],
            div(".tele-graph")[canvas(id="tele-cpu-graph")],
        ],
        div(
            ".tele-card",
            id="tele-card-mem",
            role="button",
            tabindex="0",
            **{
                "aria-expanded": "false",
                "aria-label": "Memory — activate to expand 1 hour graph and the process list",
            },
        )[
            div(".tele-label")[span["memory"], span(".tele-live")[i, "live"]],
            div(".tele-main")[
                span(id="tele-mem-used")["—"], span(".tele-unit", id="tele-mem-total")["/ — GB"]
            ],
            div(".tele-sub", id="tele-mem-free")["free —"],
            div(".tele-bar")[i(id="tele-mem-bar")],
            div(".tele-graph")[
                canvas(id="tele-mem-graph"),
                div(".tele-procs", id="tele-procs")[
                    div(".procs-bar")[
                        span(".procs-title")["proc table"],
                        span(".procs-meta", id="procs-meta")["loading…"],
                    ],
                    div(".procs-scroll")[
                        table(".procs-table")[
                            thead[
                                tr[
                                    th(".p-pid")["pid"],
                                    th(".p-name")["process"],
                                    th(".p-num")[
                                        button(
                                            ".procs-sort",
                                            type="button",
                                            **{"data-sort": "cpu", "aria-sort": "none"},
                                        )["cpu%"]
                                    ],
                                    th(".p-num")[
                                        button(
                                            ".procs-sort",
                                            type="button",
                                            **{"data-sort": "rss", "aria-sort": "none"},
                                        )["mem"]
                                    ],
                                    th(".p-sig")["signal"],
                                ]
                            ],
                            tbody(id="procs-body")[""],
                        ]
                    ],
                ],
            ],
        ],
        div(
            ".tele-card",
            id="tele-card-pwr",
            role="button",
            tabindex="0",
            **{"aria-expanded": "false", "aria-label": "Power — activate to expand 1 hour graph"},
        )[
            div(".tele-label")[
                span["power"],
                span(".tele-right")[
                    span(".tele-live")[i, "live"],
                    button(
                        ".pwr-badge",
                        id="tele-pwr-badge",
                        title="Dismiss power alert",
                        **{"aria-label": "Dismiss power alert"},
                    )[
                        "⚠",
                        span(id="tele-pwr-badge-text")[""],
                        span(".pwr-x", **{"aria-hidden": "true"})["×"],
                    ],
                ],
            ],
            div(".tele-main")[span(id="tele-pwr-total")["—"], span(".tele-unit")["W"]],
            div(".tele-sub", id="tele-pwr-split")["cpu — · gpu —"],
            div(".tele-bar")[i(id="tele-pwr-bar")],
            div(".tele-graph", **{"data-ptab": "graph"})[
                canvas(id="tele-pwr-graph"),
                div(".tele-tabs", role="tablist", **{"aria-label": "Power views"})[
                    button(
                        ".tele-tab.active",
                        **{"data-ptab": "graph"},
                        role="tab",
                        **{"aria-selected": "true"},
                    )["[graph]"],
                    button(
                        ".tele-tab",
                        **{"data-ptab": "alerts"},
                        role="tab",
                        **{"aria-selected": "false"},
                    )[
                        "[alerts",
                        span(id="tele-pwr-alert-count")[""],
                        "]",
                    ],
                ],
                div(".tele-alerts", id="tele-pwr-alerts", **{"aria-live": "polite"})[""],
            ],
        ],
    ]
