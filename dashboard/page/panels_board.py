"""Ops Board panel: header controls, lanes, cards, owner columns."""

from htpy import (
    a,
    button,
    datalist,
    div,
    form,
    h2,
    i,
    input,
    option,
    section,
    span,
    template,
)

from .panels_card import card_modal
from .panels_filters import filters_bar


def _parts(source: str) -> object:
    # One root per x-for iteration: Alpine only clones the first child, so the
    # highlight rides on a class instead of a separate <mark> element.
    return template(**{"x-for": f"(part, i) in {source}", ":key": "i"})[
        span(**{":class": "{ 'kb-hl': part.mark }", "x-text": "part.text"})[""],
    ]


def _card_body() -> object:
    return div(
        ".kb-card",
        **{":data-id": "card.id", ":draggable": "canDrag(card)", "tabindex": "0"},
        **{
            ":class": "{ 'is-archived': !!card.archived_at, 'has-op': !!card.opname,"
            " 'kb-search-hit': !!cardHit(card) && !isSemantic(card),"
            " 'kb-semantic-hit': isSemantic(card), 'attention-unread': isUnread(card) }"
        },
        **{
            "@click": "onCardClick($event, card)",
            "@keydown.enter.self": "openCard(card)",
            "@dragstart": "onDragStart($event, card)",
            "@dragend": "onDragEnd($event)",
        },
    )[
        button(
            ".kb-opname",
            type="button",
            **{"x-show": "!!card.opname"},
            **{
                ":class": "{ active: isOpActive(card.opname) }",
                "@click.stop": "setOp(isOpActive(card.opname) ? '' : card.opname)",
            },
        )[
            span(".kb-opname-ico")["◆"],
            span(".kb-opname-txt", **{"x-text": "card.opname"})[""],
        ],
        div(".kb-card-title")[_parts("titleParts(card)")],
        div(
            ".kb-card-preview",
            **{
                "x-show": "card.body_preview && !cardSnippet(card)",
                "x-text": "card.body_preview",
            },
        )[""],
        div(".kb-card-snippet", **{"x-show": "!!cardSnippet(card)"})[
            span(
                ".kb-snippet-src",
                **{
                    "x-show": "cardSnippet(card)?.comment",
                    "title": "Matched a comment",
                },
            )["c:"],
            _parts("(cardSnippet(card)?.parts || [])"),
        ],
        div(".kb-card-meta")[
            span(
                ".kb-semantic-score",
                **{
                    "x-show": "isSemantic(card)",
                    "x-text": "'≈ ' + (cardSemantic(card)?.score || 0).toFixed(2)",
                    "title": "Matched by meaning, not by exact words",
                },
            )[""],
            span(
                ".kb-owner",
                **{
                    ":class": "{ none: !card.owner }",
                    "title": "Click to set owner (blank clears)",
                    "@click.stop": "editOwner($event, card)",
                    "x-text": "card.owner ? '@' + card.owner : '+ owner'",
                },
            )[""],
            span(
                ".kb-badge.kb-badge-body",
                **{"x-show": "card.has_body", "title": "Has a description"},
            )["≡"],
            span(
                ".kb-badge.kb-badge-tasks",
                **{
                    "x-show": "card.body_tasks && card.body_tasks.total",
                    ":class": "{ done: card.body_tasks && card.body_tasks.done "
                    "=== card.body_tasks.total }",
                    "x-text": "card.body_tasks ? '☑ ' + card.body_tasks.done + '/' "
                    "+ card.body_tasks.total : ''",
                },
            )[""],
            span(
                ".kb-badge.kb-badge-comments",
                **{
                    "x-show": "!!card.comment_count",
                    "x-text": "'c:' + card.comment_count",
                },
            )[""],
            span(
                ".kb-badge.kb-badge-subtasks",
                **{
                    "x-show": "!!card.subtask_count",
                    "title": "Open subtasks",
                    "x-text": "'↳' + card.subtask_count",
                },
            )[""],
            span(
                ".kb-badge.kb-badge-lane",
                **{
                    "x-show": "group === 'owner'",
                    "title": "Lane this card sits in",
                    "x-text": "laneNames[card.lane_id] || '?'",
                },
            )[""],
            span(".kb-badge.kb-badge-archived", **{"x-show": "!!card.archived_at"})["archived"],
            span(".kb-id", **{"x-text": "'#' + card.id"})[""],
            button(
                ".kb-icon.kb-del",
                title="Delete card (click twice)",
                **{"x-init": "armDelete($el, () => removeCard(card))"},
            )["×"],
        ],
        div(".kb-card-docs", **{"x-show": "(card.docs || []).length"})[
            template(**{"x-for": "prefix in (card.docs || [])", ":key": "prefix"})[
                a(
                    ".kb-doc",
                    **{
                        ":href": "'#/docs/' + prefix",
                        ":title": "'Open ' + prefix",
                        "@click.stop.prevent": "location.hash = '#/docs/' + prefix",
                        "x-text": "'↳ ' + prefix",
                    },
                )[""],
            ],
        ],
        span(".attention-sweep-wrap.is-loop", **{"x-show": "isUnread(card)"})[
            i(".attention-sweep")
        ],
    ]


def _card() -> object:
    return template(**{"x-for": "card in cardsFor(lane.id)", ":key": "card.id"})[_card_body()]


def _add_form() -> object:
    return form(
        ".kb-add-form",
        **{
            "x-show": "addArm(lane.id).open",
            ":data-lane-id": "lane.id",
            "@submit.prevent": "submitAdd(lane.id)",
            "@keydown.escape.prevent": "closeAdd(lane.id)",
        },
    )[
        input(**{"x-model": "addArm(lane.id).title"}, placeholder="Card title", maxlength="500"),
        input(
            ".kb-add-owner",
            **{"x-model": "addArm(lane.id).owner"},
            placeholder="owner (optional)",
            maxlength="100",
        ),
        input(
            ".kb-add-opname",
            **{"x-model": "addArm(lane.id).opname"},
            placeholder="opname (optional)",
            maxlength="100",
            list="kb-opname-list",
        ),
        div(".kb-add-actions")[
            button(".brief-btn", type="submit")["Add"],
            button(".brief-btn", type="button", **{"@click": "closeAdd(lane.id)"})["Cancel"],
        ],
    ]


def _lane() -> object:
    return template(
        **{"x-for": "lane in (group === 'lane' ? (data?.lanes || []) : [])", ":key": "lane.id"}
    )[
        div(".kb-lane", **{":data-lane-id": "lane.id"})[
            div(".kb-lane-head")[
                span(
                    ".kb-lane-name",
                    title="Click to rename",
                    **{"@click": "editLaneName($event, lane)", "x-text": "lane.name"},
                )[""],
                span(".kb-count", **{"x-text": "cardsFor(lane.id).length"})[""],
                button(
                    ".kb-archive-btn",
                    **{
                        "x-show": "lane.name.toLowerCase() === 'done'",
                        "@click": "archiveDone($event)",
                        ":disabled": "!(lane.card_count ?? cardsFor(lane.id).length)",
                        "title": "Archive all cards in Done (click twice)",
                    },
                )["Archive Done"],
                button(
                    ".kb-archive-btn.kb-move-done-btn",
                    **{
                        "x-show": "lane.name.toLowerCase() === 'waiting for command'",
                        "x-init": "armMoveToDone($el, lane)",
                        ":disabled": "!laneLiveCards(lane.id).length",
                        "title": "Move every card in this lane to Done (click twice)",
                    },
                )["Move to Done"],
                button(
                    ".kb-icon.kb-lane-del",
                    title="Delete empty lane",
                    **{
                        ":disabled": "cardsFor(lane.id).length > 0",
                        "x-init": "armDelete($el, () => deleteLane(lane))",
                    },
                )["×"],
            ],
            div(
                ".kb-cards",
                **{
                    ":data-lane-id": "lane.id",
                    "@dragover": "onDragOver($event)",
                    "@dragleave": "onDragLeave($event)",
                    "@drop": "onDrop($event, lane.id)",
                },
            )[_card()],
            div(".kb-add")[
                button(
                    ".kb-add-open",
                    type="button",
                    **{"x-show": "!addArm(lane.id).open", "@click": "openAdd(lane.id)"},
                )["+ Add card"],
                _add_form(),
            ],
        ],
    ]


def _owner_column() -> object:
    return template(
        **{"x-for": "col in (group === 'owner' ? ownerColumns : [])", ":key": "col.key"}
    )[
        div(".kb-lane.kb-owner-col", **{":data-owner": "col.key"})[
            div(".kb-lane-head")[
                span(".kb-lane-name", **{"x-text": "col.name"})[""],
                span(".kb-count", **{"x-text": "col.cards.length"})[""],
            ],
            div(".kb-cards")[
                template(**{"x-for": "card in col.cards", ":key": "card.id"})[_card_body()],
            ],
        ],
    ]


def _op_datalist() -> object:
    return datalist(id="kb-opname-list")[
        template(
            **{
                "x-for": "op in [...new Set((data?.cards || []).map((c) => c.opname)"
                ".filter(Boolean))]",
                ":key": "op",
            }
        )[option(**{":value": "op"})[""]],
    ]


def board() -> object:
    return section(
        ".kanban",
        **{"data-tabpanel": "kanban", "x-ignore": True},
        id="kanban-view",
        **{"aria-label": "Ops Board"},
    )[
        div(".kanban-head")[
            div(".kanban-title")[
                h2["Ops Board"],
                span(".kanban-sub")[
                    "drag cards between lanes · click a card to open · agents: /api/opsboard"
                ],
            ],
            div(".kanban-actions")[
                div(".kb-group", role="group", **{"aria-label": "Group cards"})[
                    button(
                        ".kb-group-btn",
                        type="button",
                        id="kanban-group-lane",
                        **{
                            ":class": "{ active: group === 'lane' }",
                            ":aria-pressed": "group === 'lane'",
                            "title": "Group by lane (swimlane)",
                            "@click": "group = 'lane'; "
                            "localStorage.setItem('opsboard.group', 'lane')",
                        },
                    )["[by lane]"],
                    button(
                        ".kb-group-btn",
                        type="button",
                        id="kanban-group-owner",
                        **{
                            ":class": "{ active: group === 'owner' }",
                            ":aria-pressed": "group === 'owner'",
                            "title": "Group by owner, with the lane on each card",
                            "@click": "group = 'owner'; "
                            "localStorage.setItem('opsboard.group', 'owner')",
                        },
                    )["[by owner]"],
                ],
                div(".kb-search", role="search")[
                    input(
                        id="kanban-search",
                        type="search",
                        **{
                            "x-model": "q",
                            "@input": "onSearchInput()",
                            "@keydown.escape.prevent": "clearSearch()",
                            "@keydown.enter.prevent": "runSearch(q, true)",
                            ":class": "{ active: searching }",
                            "aria-label": "Full-text search over cards, bodies and comments",
                            "title": "Search titles, bodies, comments, opnames and owners "
                            "— Esc clears",
                        },
                        placeholder="search board…",
                        autocomplete="off",
                        spellcheck="false",
                    ),
                    button(
                        ".kb-search-clear",
                        type="button",
                        id="kanban-search-clear",
                        title="Clear search",
                        **{"x-show": "!!q", "@click": "clearSearch()"},
                    )["×"],
                ],
                filters_bar(),
                button(
                    ".brief-btn",
                    id="kanban-add-lane",
                    **{
                        "x-show": "!addLaneOpen",
                        "title": "Add a lane",
                        "@click": "addLaneOpen = true; $nextTick(() => $refs.laneDraft.focus())",
                    },
                )["+ lane"],
                input(
                    ".kb-lane-input",
                    **{
                        "x-ref": "laneDraft",
                        "x-show": "addLaneOpen",
                        "x-model": "laneDraft",
                        "@keydown.enter.prevent": "addLane()",
                        "@keydown.escape.prevent": "addLaneOpen = false; laneDraft = ''",
                        "@blur": "addLane()",
                    },
                    maxlength="60",
                    placeholder="Lane name",
                ),
                button(
                    ".brief-btn",
                    id="kanban-refresh",
                    title="Reload the board",
                    **{"@click": "refresh(true)"},
                )["⟳ refresh"],
            ],
        ],
        div(
            ".kanban-board",
            id="kanban-board",
            **{":class": "{ 'by-owner': group === 'owner', searching: searching }"},
        )[
            _lane(),
            _owner_column(),
        ],
        div(".kanban-status")[
            span(
                id="kanban-status",
                **{":class": "{ err: statusError }", "x-text": "status"},
            )["loading…"],
            span(id="kanban-count", **{"x-text": "countText"})[""],
        ],
        _op_datalist(),
        card_modal(),
    ]
