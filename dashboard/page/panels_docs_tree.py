"""Docs prefix tree rows."""

from htpy import button, div, li, span, template


def tree_rows() -> object:
    return template(**{"x-for": "row in treeRows", ":key": "row.key"})[
        li(
            **{
                ":class": "row.kind === 'folder' ? 'docs-tree-folder' : (row.kind === 'doc' "
                "? 'docs-tree-doc' : 'docs-tree-more-row')"
            }
        )[
            template(**{"x-if": "row.kind === 'folder'"})[
                div(".docs-tree-row", **{":style": "'padding-left: ' + (row.depth * 0.8) + 'rem'"})[
                    button(
                        ".docs-tree-twist",
                        **{
                            ":title": "row.open ? 'Collapse' : 'Expand'",
                            "@click.stop": "toggleFolder(row.path)",
                            "x-text": "row.open ? '▾' : '▸'",
                        },
                    )[""],
                    button(
                        ".docs-tree-name",
                        **{
                            ":class": "{ scoped: row.scoped }",
                            ":title": "'Scope to ' + row.path + '/'",
                            "@click": "setScope(prefix === row.path ? '' : row.path)",
                            "x-text": "row.name",
                        },
                    )[""],
                    span(".docs-tree-count", **{"x-text": "row.total"})[""],
                ],
            ],
            template(**{"x-if": "row.kind === 'doc'"})[
                div(
                    ".docs-tree-row",
                    **{":style": "'padding-left: ' + (row.depth * 0.8 + 1.1) + 'rem'"},
                )[
                    span(".docs-tree-twist")["·"],
                    button(
                        ".docs-tree-name.is-doc",
                        **{
                            ":class": "{ open: row.selected }",
                            ":title": "row.prefix + (row.author ? ' · @' + row.author : '')",
                            "@click": "selectDoc(row.prefix)",
                            "x-text": "row.name",
                        },
                    )[""],
                    span(
                        ".docs-tree-cards", **{"x-show": "row.cards", "x-text": "'⧉' + row.cards"}
                    )[""],
                ],
            ],
            template(**{"x-if": "row.kind === 'more'"})[
                div(
                    ".docs-tree-row",
                    **{":style": "'padding-left: ' + (row.depth * 0.8 + 1.1) + 'rem'"},
                )[
                    button(
                        ".docs-tree-more",
                        **{
                            "@click.stop": "showMore(row)",
                            "x-text": "row.path ? ('show ' + row.more + ' more') : ('show ' + row.more + ' more at root')",
                        },
                    )[""],
                ],
            ],
        ],
    ]
