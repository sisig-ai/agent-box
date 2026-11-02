"""Doc key and field validation: the rules a prefix, author and tags must pass.

Kept apart from the store so the API, the MCP tools and the embedding indexer
can validate without importing sqlite or Flask. ``DocsError`` lives here; the
store re-exports it so existing ``from .docs import DocsError`` keeps working.
"""

import re

PREFIX_MAX = 400
CONTENT_MAX = 2_000_000
AUTHOR_MAX = 120
TAG_MAX = 60
TAGS_MAX = 24
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
_SEGMENT_BAD = re.compile(r"[\x00-\x1f\x7f]")


class DocsError(Exception):
    """A request the store refuses; ``status`` is the HTTP code to return."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- validation


def clean_prefix(raw):
    """Normalise a doc key: no leading/trailing slash, no empty or dot segments."""
    if not isinstance(raw, str):
        raise DocsError("prefix must be a string")
    prefix = raw.strip().strip("/")
    if not prefix:
        raise DocsError("prefix is required")
    if len(prefix) > PREFIX_MAX:
        raise DocsError(f"prefix must be {PREFIX_MAX} characters or fewer")
    for segment in prefix.split("/"):
        if segment in ("", ".", ".."):
            raise DocsError("prefix segments must be non-empty and not '.' or '..'")
        if _SEGMENT_BAD.search(segment):
            raise DocsError("prefix must not contain control characters")
    return prefix


def clean_content(raw):
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise DocsError("content must be a string")
    if len(raw) > CONTENT_MAX:
        raise DocsError(f"content must be {CONTENT_MAX} characters or fewer")
    return raw


def clean_author(raw):
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise DocsError("author must be a string")
    author = raw.strip()
    if len(author) > AUTHOR_MAX:
        raise DocsError(f"author must be {AUTHOR_MAX} characters or fewer")
    return author or None


def clean_tags(raw):
    """Accept a list, or a comma/space separated string; keep order, drop dupes."""
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [part for part in re.split(r"[,\n]", raw)]
    if not isinstance(raw, list):
        raise DocsError("tags must be a list of strings")
    tags, seen = [], set()
    for item in raw:
        if not isinstance(item, str):
            raise DocsError("tags must be strings")
        tag = item.strip()
        if not tag:
            continue
        if len(tag) > TAG_MAX:
            raise DocsError(f"each tag must be {TAG_MAX} characters or fewer")
        if tag.lower() in seen:
            continue
        seen.add(tag.lower())
        tags.append(tag)
    if len(tags) > TAGS_MAX:
        raise DocsError(f"at most {TAGS_MAX} tags")
    return tags


def clean_limit(raw, default=DEFAULT_LIMIT, maximum=MAX_LIMIT):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(1, min(value, maximum))


def like_pattern(text):
    """Escape a user string for a LIKE ... ESCAPE '\\' pattern."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def clean_prefix_query(raw):
    """Substring to match against doc prefixes; '' / None means no filter."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise DocsError("prefix_q must be a string")
    text = raw.strip().lstrip("/")
    if not text:
        return None
    if len(text) > PREFIX_MAX:
        raise DocsError(f"prefix_q must be {PREFIX_MAX} characters or fewer")
    if _SEGMENT_BAD.search(text):
        raise DocsError("prefix_q must not contain control characters")
    return text


def prefix_filters(prefix, prefix_q):
    """SQL clauses + args for the path scope and the prefix substring."""
    clauses, args = [], []
    if prefix:
        clean = clean_prefix(prefix)
        clauses.append("(d.prefix = ? OR d.prefix LIKE ? ESCAPE '\\')")
        args.extend([clean, f"{like_pattern(clean)}/%"])
    if prefix_q:
        clauses.append("d.prefix LIKE ? ESCAPE '\\'")
        args.append(f"%{like_pattern(prefix_q)}%")
    return clauses, args
