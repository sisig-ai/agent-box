"""Filter bar markup for the Ops Board."""

from htpy import button, div, input, label, span, template

FILTER_FIELDS_JS = (
    "[{id:'lane',label:'Lane'},{id:'author',label:'Author'},"
    "{id:'op',label:'Op'},{id:'updated',label:'Updated'}]"
)
UPDATED_PRESETS_JS = (
    "[['today','today'],['last:7','in the last 7 days'],['last:30','in the last 30 days']]"
)


def filters_bar() -> object:
    return div(
        ".kb-filters",
        id="kanban-filters",
        **{":class": "{ active: filters.length }", "@click.stop": ""},
    )[
        template(**{"x-for": "(cond, index) in filters", ":key": "index"})[
            button(
                ".kb-chip",
                type="button",
                title="Edit this filter",
                **{"@click": "openFilterMenu(index)"},
            )[
                span(".kb-chip-field", **{"x-text": "fieldLabel(cond.field).toLowerCase()"})[""],
                span(".kb-chip-op", **{"x-text": "cond.negate ? 'is not' : 'is'"})[""],
                span(".kb-chip-value", **{"x-text": "chipValue(cond)"})[""],
                span(
                    ".kb-chip-x",
                    title="Remove this filter",
                    **{"@click.stop": "removeFilter(index)"},
                )["×"],
            ],
        ],
        button(
            ".kb-filter-add",
            type="button",
            title="Add a filter condition; conditions must all match",
            **{"@click": "filterStage ? closeFilterMenu() : openFilterMenu()"},
        )["+ filter"],
        div(".kb-fm", **{"x-show": "filterStage === 'field'"})[
            div(".kb-fm-title")["Filter by"],
            template(**{"x-for": f"f in {FILTER_FIELDS_JS}", ":key": "f.id"})[
                button(
                    ".kb-fm-field",
                    type="button",
                    **{"@click": "pickFilterField(f.id)", "x-text": "f.label"},
                )[""],
            ],
        ],
        div(".kb-fm", **{"x-show": "filterStage === 'values'"})[
            div(".kb-fm-head")[
                span(".kb-fm-title", **{"x-text": "filterMenuTitle()"})[""],
                button(
                    ".kb-fm-neg",
                    type="button",
                    title='Flip between "is" and "is not"',
                    **{
                        "@click": "toggleFilterNegate()",
                        "x-text": "filterNegate ? 'is not' : 'is'",
                    },
                )[""],
            ],
            div(".kb-fm-list", **{"x-show": "filterField !== 'updated'"})[
                template(**{"x-for": "option in filterValueOptions()", ":key": "option.value"})[
                    label(".kb-fm-opt")[
                        input(
                            type="checkbox",
                            **{
                                ":value": "option.value",
                                ":checked": "option.checked",
                                "@change": "toggleFilterValue(option.value)",
                            },
                        ),
                        span(**{"x-text": "option.label"})[""],
                    ],
                ],
            ],
            div(".kb-fm-list", **{"x-show": "filterField === 'updated'"})[
                template(**{"x-for": f"preset in {UPDATED_PRESETS_JS}", ":key": "preset[0]"})[
                    label(".kb-fm-opt")[
                        input(
                            type="radio",
                            name="kb-fm-updated",
                            **{
                                ":value": "preset[0]",
                                ":checked": "filterValues[0] === preset[0]",
                                "@change": "setUpdatedPreset(preset[0])",
                            },
                        ),
                        span(**{"x-text": "preset[1]"})[""],
                    ],
                ],
                div(".kb-fm-date")[
                    span(".kb-fm-title")["on"],
                    input(
                        type="date",
                        **{
                            ":value": "(filterValues[0] || '').startsWith('on:') "
                            "? filterValues[0].slice(3) : ''",
                            "@change": "setUpdatedPreset('on:' + $event.target.value)",
                        },
                    ),
                ],
            ],
        ],
    ]
