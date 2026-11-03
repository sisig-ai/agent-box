"""Shared JSON-schema fragments for the Ops Board tools (and the searches)."""

CARD_ID = {
    "type": "integer",
    "minimum": 1,
    "description": "Card id (the number in #/kanban/card-<id>).",
}
LANE_REF = {"type": "string", "description": "Lane name (case-insensitive) or numeric lane id."}
ARCHIVED = {
    "type": "string",
    "enum": ["exclude", "include", "only"],
    "default": "exclude",
    "description": "exclude = live cards, include = live then archived, only = archived.",
}
OWNER = {
    "type": "string",
    "description": (
        "Owner tag, usually the agent name (the board UI labels this Author). "
        "Empty string matches unowned cards in listings."
    ),
}
AUTHOR = {
    "type": "string",
    "description": (
        "Alias of owner for the board's Author filter: the same tag the UI shows "
        "as the card's author. Empty string matches unassigned cards."
    ),
}
OPNAME = {
    "type": "string",
    "description": (
        "Optional operation name grouping cards, e.g. 'Operation Valhalla'. "
        "Null or '' clears it; see list_opnames for existing spellings."
    ),
}
BODY = {
    "type": "string",
    "description": (
        "Markdown up to 200,000 chars. Agents should keep the Goal / Context / "
        "Agent / Progress / Next steps shape. Null clears it."
    ),
}
POSITION = {
    "type": "integer",
    "minimum": 0,
    "description": "0-based slot within the lane; 0 = top.",
}

DOCS = {
    "type": "array",
    "items": {"type": "string"},
    "description": (
        "Docs prefixes this card points at, e.g. ['handoffs/x.md', 'specs/y.md']. "
        "At most 20; duplicates collapse; the doc does not need to exist yet. "
        "An empty list clears the links."
    ),
}

SEMANTIC_SORT = {
    "type": "string",
    "enum": ["blend", "score", "recent"],
    "default": "blend",
    "description": (
        "Order for semantic hits. blend (default) is score plus a recency nudge "
        "(rank = score + 0.1 * exp(-age_days/30)), score is pure cosine, recent is "
        "newest update first."
    ),
}

FILTER_PROPS = {
    "status": LANE_REF,
    "owner": OWNER,
    "author": AUTHOR,
    "opname": OPNAME,
    "archived": ARCHIVED,
    "include_body": {
        "type": "boolean",
        "default": False,
        "description": "Include full markdown bodies (listings omit them by default).",
    },
}
