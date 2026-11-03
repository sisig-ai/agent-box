"""Card detail modal markup for the Ops Board."""

from htpy import (
    a,
    button,
    datalist,
    div,
    h3,
    input,
    label,
    option,
    p,
    select,
    span,
    template,
    textarea,
)


def _comments() -> object:
    return div(".kbc-wrap")[
        div(".kbd-section")[
            span(
                ".kbd-section-label",
                **{"x-text": "comments.length ? 'Comments (' + comments.length + ')' : 'Comments'"},
            )[""],
        ],
        div(".kbc-list")[
            p(".kbd-empty", **{"x-show": "!comments.length"})["No comments yet."],
            template(**{"x-for": "comment in visibleComments", ":key": "comment.id"})[
                div(".kbc-item")[
                    div(".kbc-meta")[
                        span(".kbc-author-name", **{"x-text": "comment.author"})[""],
                        span(
                            ".kbc-time",
                            **{
                                ":title": "full(comment.created_at)",
                                "x-text": "rel(comment.created_at)",
                            },
                        )[""],
                        button(
                            ".kb-icon.kbc-del",
                            title="Delete comment (click twice)",
                            **{"@click": "deleteComment(comment, $el)"},
                        )["×"],
                    ],
                    div(".kbc-body.kbd-md", **{"x-html": "commentHtml(comment)"})[""],
                ],
            ],
            button(
                ".brief-btn.kbc-more",
                type="button",
                **{
                    "x-show": "moreComments",
                    "title": "Show the next 5 older comments",
                    "@click": "growComments()",
                    "x-text": "'Load More (' + moreComments + ')'",
                },
            )[""],
        ],
        div(".kbc-form")[
            textarea(
                ".kbc-text",
                **{
                    "x-model": "commentBody",
                    "x-show": "!commentPreview",
                    "@keydown.meta.enter.prevent": "postComment()",
                    "@keydown.ctrl.enter.prevent": "postComment()",
                },
                placeholder="Add a comment (markdown) — ⌘/Ctrl+Enter to post",
            )[""],
            div(
                ".kbc-preview.kbd-md",
                **{"x-show": "commentPreview", "x-html": "commentPreviewHtml"},
            )[""],
            div(".kbc-row")[
                input(
                    ".kbc-author",
                    **{"x-model": "commentAuthor"},
                    placeholder="author",
                    maxlength="100",
                ),
                span(".kbd-msg.kbc-msg", **{":class": "{ err: msgError }", "x-text": "msg"})[""],
                button(
                    ".tool-btn.kbc-preview-btn",
                    type="button",
                    title="Preview this comment as rendered markdown",
                    **{
                        ":class": "{ toggled: commentPreview }",
                        "@click": "commentPreview = !commentPreview",
                        "x-text": "commentPreview ? 'write' : 'preview'",
                    },
                )[""],
                button(".brief-btn.kbc-post", **{"@click": "postComment()"})["Comment"],
            ],
        ],
    ]


def card_modal() -> object:
    return div(
        ".kbd-backdrop",
        **{
            "x-data": "cardDetail",
            "x-ref": "backdrop",
            "x-show": "open",
            "@click": "closeFromBackdrop($event)",
        },
    )[
        div(
            ".kbd-modal",
            role="dialog",
            **{"aria-modal": "true", "aria-labelledby": "kbd-title", "@click.stop": ""},
        )[
            div(".kbd-head")[
                span(".kbd-id", **{"x-text": "id ? '#' + id : ''"})[""],
                h3(
                    ".kbd-title.kb-card-title",
                    id="kbd-title",
                    title="Click to edit the title",
                    **{
                        "@click": "card && editTitle($event)",
                        "x-text": "card?.title || 'loading…'",
                    },
                )[""],
                button(".kb-icon.kbd-close", title="Close (Esc)", **{"@click": "close()"})["×"],
            ],
            div(".kbd-meta")[
                label(".kbd-field")[
                    "Lane",
                    select(
                        ".kbd-status", **{"x-model": "form.status", "@change": "commitStatus()"}
                    )[
                        template(**{"x-for": "lane in lanes", ":key": "lane.id"})[
                            option(**{":value": "String(lane.id)", "x-text": "lane.name"})[""],
                        ],
                    ],
                ],
                label(".kbd-field")[
                    "Owner",
                    input(
                        ".kbd-owner",
                        **{
                            "x-model": "form.owner",
                            "maxlength": "100",
                            "@blur": "commitOwner()",
                            "@keydown.enter.prevent": "$event.target.blur()",
                        },
                        placeholder="unassigned",
                    ),
                ],
                label(".kbd-field.kbd-op-field")[
                    "Op",
                    input(
                        ".kbd-opname",
                        **{
                            "x-model": "form.opname",
                            "maxlength": "100",
                            "list": "kbd-opname-list",
                            "placeholder": "no operation",
                            ":class": "{ set: !!form.opname }",
                            "@blur": "commitOpname()",
                            "@keydown.enter.prevent": "$event.target.blur()",
                        },
                    ),
                    datalist(id="kbd-opname-list")[
                        template(**{"x-for": "op in opnames", ":key": "op.opname"})[
                            option(**{":value": "op.opname"})[""],
                        ],
                    ],
                ],
                span(
                    ".kbd-times",
                    **{
                        "x-text": "card ? ('created ' + fmt(card.created_at) + ' · updated ' + fmt(card.updated_at)"
                        " + (card.archived_at ? ' · archived ' + fmt(card.archived_at) : '')) : ''",
                    },
                )[""],
                button(
                    ".kb-archive-btn.kbd-archive",
                    **{
                        "@click": "toggleArchive()",
                        "x-text": "card?.archived_at ? 'Restore' : 'Archive'",
                    },
                )[""],
            ],
            div(".kbd-docs")[
                span(".kbd-section-label")["Docs"],
                div(".kbd-doc-list")[
                    template(**{"x-for": "prefix in (card?.docs || [])", ":key": "prefix"})[
                        a(
                            ".kbd-doc",
                            **{
                                ":href": "'#/docs/' + prefix",
                                ":title": "'Open ' + prefix",
                                "@click.prevent": "location.hash = '#/docs/' + prefix",
                                "x-text": "prefix",
                            },
                        )[""],
                    ],
                    span(".kbd-doc.none", **{"x-show": "!(card?.docs || []).length"})[
                        "no docs linked"
                    ],
                ],
                input(
                    ".kbd-doc-input",
                    **{
                        "x-model": "form.docs",
                        "placeholder": "doc prefixes, comma separated",
                        "title": "Docs this card points at: handoffs/x.md, specs/y.md (blank clears)",
                        "@change": "commitDocs()",
                        "@keydown.enter.prevent": "$event.target.blur()",
                    },
                ),
            ],
            div(".kbd-section")[
                span(".kbd-section-label")["Description"],
                button(
                    ".brief-btn.kbd-preview-toggle",
                    **{
                        "x-show": "editing",
                        ":class": "{ toggled: previewOn }",
                        "title": "Show/hide the live preview",
                        "@click": "previewOn = !previewOn",
                    },
                )["Preview"],
                button(
                    ".brief-btn.kbd-edit-btn",
                    **{"x-show": "!editing", "@click": "setEditing(true)"},
                )["✎ Edit"],
            ],
            div(
                ".kbd-view.kbd-md",
                **{"x-show": "!editing", "@change": "onBodyTask($event)", "x-html": "bodyHtml"},
            )[""],
            div(".kbd-editor", **{":class": "{ split: previewOn }", "x-show": "editing"})[
                textarea(
                    ".kbd-text",
                    **{
                        "x-ref": "body",
                        "x-model": "form.body",
                        "spellcheck": "false",
                        "placeholder": "Markdown: ## Goal, - [ ] tasks, fenced code, | tables |, [links](https://…)",
                        "@keydown.meta.enter.prevent": "saveBody()",
                        "@keydown.ctrl.enter.prevent": "saveBody()",
                    },
                )[""],
                div(".kbd-preview.kbd-md", **{"x-show": "previewOn", "x-html": "previewHtml"})[""],
            ],
            div(".kbd-foot", **{"x-show": "editing"})[
                span(".kbd-msg", **{":class": "{ err: msgError }", "x-text": "msg"})[""],
                div(".kbd-foot-actions")[
                    button(".brief-btn", **{"@click": "setEditing(false); setMsg('')"})["Cancel"],
                    button(
                        ".brief-btn.kbd-save",
                        title="Save (⌘/Ctrl+Enter)",
                        **{"@click": "saveBody()"},
                    )["Save"],
                ],
            ],
            _comments(),
        ],
    ]
