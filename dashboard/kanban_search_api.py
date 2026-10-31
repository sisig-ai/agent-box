"""HTTP route for Ops Board full-text search (registered on the kanban blueprint).

GET /api/opsboard/search?q=…&limit=&archived=&status=&owner=&opname=
(/api/kanban/search is the deprecated alias.)
"""

from flask import jsonify, request

from . import db, kanban, kanban_search
from .kanban import KanbanError
from .kanban_api import bp, flag


@bp.get("/api/opsboard/search")
@bp.get("/api/kanban/search")
def search_cards():
    """GET /api/opsboard/search?q=…&limit=50&archived=exclude&status=&owner=&opname=

    Full-text search (FTS5) over card titles, markdown bodies, comment threads,
    opnames and owners. Terms are ANDed; ``"two words"`` is a phrase, a word
    matches prefixes, ``-word`` excludes. Results are best-match first with
    ``matched`` fields and a highlighted ``snippet`` ('\\x01'/'\\x02' wrap a
    hit). Archived cards are excluded unless ``archived=include|only`` (or
    ``include_archived=1``)."""

    query = " ".join((request.args.get("q") or "").split())
    if not query:
        raise KanbanError('q is required (words, "a phrase", -excluded)')
    if len(query) > kanban_search.MAX_QUERY:
        raise KanbanError(f"q must be at most {kanban_search.MAX_QUERY} characters")
    archived = (request.args.get("archived") or "").strip().lower()
    if not archived:
        archived = "include" if flag("include_archived") else "exclude"
    if archived not in ("exclude", "include", "only"):
        raise KanbanError("archived must be one of: exclude, include, only")
    limit = kanban_search.DEFAULT_LIMIT
    if request.args.get("limit") is not None:
        try:
            limit = int(request.args["limit"])
        except ValueError:
            raise KanbanError("limit must be an integer") from None
        if limit < 1:
            raise KanbanError("limit must be a positive integer")
    status, owner, opname = (
        request.args.get("status"),
        request.args.get("owner"),
        request.args.get("opname"),
    )
    conn = db.get_db()
    lane_id = kanban.require_lane(conn, status.strip())["id"] if status and status.strip() else None
    return jsonify(
        kanban_search.search(
            conn,
            query,
            archived=archived,
            lane_id=lane_id,
            owner=owner.strip() if owner is not None else None,
            opname=" ".join(opname.split()) if opname is not None else None,
            limit=limit,
        )
    )
