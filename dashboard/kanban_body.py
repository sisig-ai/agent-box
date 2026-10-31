"""Kanban card body helpers: the markdown ``body`` summary fields.

Board listings carry ``has_body``, a one-line ``body_preview`` (first
non-blank line, markdown markers stripped), and ``body_tasks`` (task-list
checkbox counts) so the UI can badge cards without shipping every body on each
3 s poll. The full body comes from ``GET /api/kanban/cards/:id`` or
``?include_body=1``.
"""

import re

PREVIEW_MAX = 140
_TASK_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]", re.MULTILINE)
_HEAD_RE = re.compile(r"^\s*#{1,6}\s+")
_LINK_RE = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_EMPH_RE = re.compile(r"(\*\*|__|~~|`)")
_LEAD_RE = re.compile(r"^\s*(?:>\s*|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?)*")


def preview(body):
    """First prose line (lead markers stripped); a heading only if there is no prose."""
    heading, fenced = "", False
    for raw in body.splitlines():
        if raw.lstrip().startswith(("```", "~~~")):
            fenced = not fenced
            continue
        if fenced or not raw.strip() or set(raw.strip()) <= set("-*_=|: "):
            continue
        if _HEAD_RE.match(raw):
            heading = heading or _HEAD_RE.sub("", raw).strip()
            continue
        line = _LEAD_RE.sub("", raw).strip()
        if line:
            return clip(line)
    return clip(heading)


def clip(text):
    text = _EMPH_RE.sub("", _LINK_RE.sub(r"\1", text)).strip()
    return text[: PREVIEW_MAX - 1] + "…" if len(text) > PREVIEW_MAX else text


def with_body_summary(row, include_body=True):
    """Card dict plus ``has_body`` / ``body_preview`` / ``body_tasks``; drops
    ``body`` itself unless ``include_body`` (board listings stay light)."""
    out = dict(row)
    body = out.get("body") or ""
    out["body"] = body
    out["has_body"] = bool(body.strip())
    out["body_preview"] = preview(body)
    tasks = _TASK_RE.findall(body)
    done = sum(1 for t in tasks if t != " ")
    out["body_tasks"] = {"done": done, "total": len(tasks)} if tasks else None
    if not include_body:
        del out["body"]
    return out
