"""MCP tools: Ops Board (kanban) lanes/cards, archiving, operation names."""

from .. import db, kanban, kanban_comments, kanban_embed, kanban_search
from ..kanban_api import (
    clean_body,
    clean_opname,
    clean_owner,
    clean_position,
    clean_status,
    clean_title,
)
from .protocol import SEARCH_DEFAULT_LIMIT, ToolError, tool_spec
from .schema import (
    ARCHIVED,
    AUTHOR,
    BODY,
    CARD_ID,
    FILTER_PROPS,
    LANE_REF,
    OPNAME,
    OWNER,
    POSITION,
)


def _author(args):
    """The owner/author filter value; `author` is an alias for `owner`."""
    owner, author = args.get("owner"), args.get("author")
    if owner is not None and author is not None and owner != author:
        raise ToolError("pass either owner or author (aliases), not both")
    value = owner if owner is not None else author
    return value.strip() if isinstance(value, str) else None


def _filters(args):
    archived = args.get("archived") or "exclude"
    if archived not in ("exclude", "include", "only"):
        raise ToolError("archived must be one of: exclude, include, only")
    opname = args.get("opname")
    return {
        "status": args.get("status"),
        "owner": _author(args),
        "opname": " ".join(opname.split()) if isinstance(opname, str) else None,
        "archived": archived,
        "include_body": bool(args.get("include_body")),
    }


def _card_id(args):
    raw = args.get("id")
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ToolError("id must be the card's integer id")
    return raw


# ---------------- reads ----------------


def board_overview(args):
    return kanban.board(**_filters(args))


def list_cards(args):
    return {"cards": kanban.board(**_filters(args))["cards"]}


def list_archived(args):
    filters = _filters(args)
    filters["archived"] = "only"
    return {"cards": kanban.board(**filters)["cards"]}


def search_cards(args):
    query = args.get("q")
    if not isinstance(query, str) or not query.strip():
        raise ToolError('q is required (words, "a phrase", -excluded)')
    archived = args.get("archived") or "exclude"
    if archived not in ("exclude", "include", "only"):
        raise ToolError("archived must be one of: exclude, include, only")
    limit = args.get("limit", SEARCH_DEFAULT_LIMIT)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
        raise ToolError("limit must be an integer from 1 to 200")
    status = args.get("status")
    owner = _author(args)
    opname = args.get("opname")
    with db.get_db() as conn:
        lane_id = kanban.require_lane(conn, status)["id"] if status not in (None, "") else None
        return kanban_search.search(
            conn,
            query,
            archived=archived,
            lane_id=lane_id,
            owner=owner,
            opname=" ".join(opname.split()) if isinstance(opname, str) else None,
            limit=limit,
        )


def semantic_search_cards(args):
    query = args.get("q")
    if not isinstance(query, str) or not query.strip():
        raise ToolError("q is required")
    archived = args.get("archived") or "exclude"
    if archived not in ("exclude", "include", "only"):
        raise ToolError("archived must be one of: exclude, include, only")
    limit = args.get("limit", SEARCH_DEFAULT_LIMIT)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
        raise ToolError("limit must be an integer from 1 to 200")
    with db.get_db() as conn:
        status = args.get("status")
        lane_id = kanban.require_lane(conn, status)["id"] if status else None
        try:
            return kanban_embed.search(
                query,
                limit=limit,
                archived=archived,
                lane_id=lane_id,
                owner=_author(args),
                opname=args.get("opname") or None,
                conn=conn,
            )
        except kanban_embed.EmbedError as exc:
            raise ToolError(str(exc)) from None


def reindex_cards(_args):
    return {"queued": kanban_embed.reindex_all(), "model": kanban_embed.config.EMBED_MODEL}


def get_card(args):
    card_id = _card_id(args)
    with db.get_db() as conn:
        row = kanban.card(conn, card_id)
        row["comments"] = kanban_comments.comments(conn, card_id)
    return row


def list_opnames(args):
    archived = "exclude" if args.get("include_archived") is False else "include"
    with db.get_db() as conn:
        return {"opnames": kanban.opnames(conn, archived=archived)}


# ---------------- writes ----------------


def create_card(args):
    if "title" not in args:
        raise ToolError("title is required")
    return kanban.create_card(
        title=clean_title(args["title"]),
        owner=clean_owner(args.get("owner")),
        status=args.get("status"),
        position=clean_position(args.get("position")),
        body=clean_body(args.get("body")),
        opname=clean_opname(args.get("opname")),
    )


CLEANERS = {
    "title": clean_title,
    "owner": clean_owner,
    "body": clean_body,
    "opname": clean_opname,
    "status": clean_status,
    "position": clean_position,
}


def update_card(args):
    card_id = _card_id(args)
    changes = {key: clean(args[key]) for key, clean in CLEANERS.items() if key in args}
    if "archived" in args:
        if not isinstance(args["archived"], bool):
            raise ToolError("archived must be true or false")
        changes["archived"] = args["archived"]
    if not changes:
        raise ToolError(
            "nothing to update: pass at least one of title, owner, body, opname, "
            "status, position, archived"
        )
    return kanban.update_card(card_id, changes)


def delete_card(args):
    return {"deleted": True, "card": kanban.delete_card(_card_id(args))}


def archive_done(args):
    return kanban.archive_lane(args.get("lane") or "Done")


TOOLS = {
    "board_overview": {
        "spec": tool_spec(
            "board_overview",
            "Ops Board overview",
            "Lanes plus cards, optionally filtered by lane, owner or operation name. "
            "Use this to see the whole board before picking work.",
            FILTER_PROPS,
            read_only=True,
        ),
        "handler": board_overview,
    },
    "list_cards": {
        "spec": tool_spec(
            "list_cards",
            "List cards",
            "Cards only (same filters as board_overview), without lane metadata.",
            FILTER_PROPS,
            read_only=True,
        ),
        "handler": list_cards,
    },
    "list_archived": {
        "spec": tool_spec(
            "list_archived",
            "List archived cards",
            "Archived cards, most recently archived first.",
            {k: v for k, v in FILTER_PROPS.items() if k != "archived"},
            read_only=True,
        ),
        "handler": list_archived,
    },
    "search_cards": {
        "spec": tool_spec(
            "search_cards",
            "Search cards",
            "Full-text search across card titles, markdown bodies, comment threads, "
            "opnames and owners. Terms are ANDed and match word prefixes; "
            '"two words" is a phrase, -word excludes. Results are best-match first, '
            "each with the fields that matched and a snippet whose hits are wrapped "
            "in \\x01 … \\x02. Searches live cards unless archived is include/only. "
            "Use it to find a card before creating a duplicate.",
            {
                "q": {
                    "type": "string",
                    "description": 'What to look for, e.g. "vault key" -draft or obsidian',
                },
                "status": LANE_REF,
                "owner": OWNER,
                "author": AUTHOR,
                "opname": OPNAME,
                "archived": ARCHIVED,
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200,
                    "default": SEARCH_DEFAULT_LIMIT,
                    "description": (f"Maximum cards to return (default {SEARCH_DEFAULT_LIMIT})."),
                },
            },
            ["q"],
            read_only=True,
        ),
        "handler": search_cards,
    },
    "semantic_search_cards": {
        "spec": tool_spec(
            "semantic_search_cards",
            "Semantic Search Cards",
            "Meaning-based card search: embeds the query with the local Ollama "
            "model and cosine-ranks stored card vectors (title, body, opname, "
            "owner). A hit does not need to share words with the query; best chunk "
            "per card wins, score 0-1. Use it when exact terms fail.",
            {
                "q": {"type": "string", "description": "What you are looking for, in plain words."},
                "status": LANE_REF,
                "owner": OWNER,
                "opname": OPNAME,
                "archived": ARCHIVED,
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200,
                    "default": SEARCH_DEFAULT_LIMIT,
                    "description": (f"Maximum cards to return (default {SEARCH_DEFAULT_LIMIT})."),
                },
            },
            ["q"],
            read_only=True,
        ),
        "handler": semantic_search_cards,
    },
    "reindex_cards": {
        "spec": tool_spec(
            "reindex_cards",
            "Reindex Cards",
            "Queue every card whose vectors are missing, stale or from another "
            "embedding model. Indexing already happens per write; this is for "
            "backfill and model changes.",
            {},
            [],
        ),
        "handler": reindex_cards,
    },
    "get_card": {
        "spec": tool_spec(
            "get_card",
            "Get one card",
            "One card with its full markdown body and its comment thread (oldest first).",
            {"id": CARD_ID},
            ["id"],
            read_only=True,
        ),
        "handler": get_card,
    },
    "list_opnames": {
        "spec": tool_spec(
            "list_opnames",
            "List operation names",
            "Distinct opnames with card counts, so new cards reuse an existing spelling.",
            {"include_archived": {"type": "boolean", "default": True}},
            read_only=True,
        ),
        "handler": list_opnames,
    },
    "create_card": {
        "spec": tool_spec(
            "create_card",
            "Create a card",
            "Add a card. status defaults to the first lane, position to the bottom.",
            {
                "title": {"type": "string", "description": "Card title, max 500 chars."},
                "owner": OWNER,
                "status": LANE_REF,
                "position": POSITION,
                "body": BODY,
                "opname": OPNAME,
            },
            ["title"],
        ),
        "handler": create_card,
    },
    "update_card": {
        "spec": tool_spec(
            "update_card",
            "Update a card",
            "Patch any subset of title, owner, body, opname, status, position, archived. "
            "Read the card first when replacing a body, then append to the progress log.",
            {
                "id": CARD_ID,
                "title": {"type": "string"},
                "owner": OWNER,
                "body": BODY,
                "opname": OPNAME,
                "status": LANE_REF,
                "position": POSITION,
                "archived": {
                    "type": "boolean",
                    "description": "true archives the card, false restores it to its lane.",
                },
            },
            ["id"],
        ),
        "handler": update_card,
    },
    "delete_card": {
        "spec": tool_spec(
            "delete_card",
            "Delete a card",
            "Delete a card and its comments. Prefer moving finished work to Done.",
            {"id": CARD_ID},
            ["id"],
            destructive=True,
        ),
        "handler": delete_card,
    },
    "archive_done": {
        "spec": tool_spec(
            "archive_done",
            "Archive the Done lane",
            "Archive every live card in Done. Sweeps everyone's cards, so only call it when asked.",
            {"lane": LANE_REF},
        ),
        "handler": archive_done,
    },
}
