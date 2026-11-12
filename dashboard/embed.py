"""Local embeddings shared by Docs and Ops Board search.

One Ollama call per batch, plus the chunking, cosine and blob helpers both
indexes use. The vector tables stay separate (docs chunks, card chunks) because
their rows join different parents; only this part is common.
"""

import array
import hashlib
import json
import math
import re
import urllib.error
import urllib.request
from datetime import datetime

import numpy as np

from . import config

# Default ordering for semantic hits. Relevance leads, and a fresh item gets a
# bounded nudge so a slightly older, slightly better match can lose to a current
# one: rank = score + 0.1 * exp(-age_days / 30). At zero age the boost is 0.10,
# at 30 days 0.037, at 90 days 0.005, so it breaks ties without overruling the
# vector score. Callers can ask for pure "score" or "recent" instead.
RECENCY_WEIGHT = 0.10
RECENCY_TAU_DAYS = 30
SORTS = ("blend", "score", "recent")

CHUNK_CHARS = 1200
CHUNK_OVERLAP = 200
MAX_CHUNKS = 60
DEFAULT_MIN_SCORE = 0.35
EXCERPT_CHARS = 280


class EmbedError(Exception):
    """Embedding backend unavailable or answering with garbage."""


# ---------------------------------------------------------------- embedding


def document_input(text):
    """Text as the model expects a document: task prefix plus the chunk."""
    return config.EMBED_DOC_PREFIX + text


def query_input(text):
    """Text as the model expects a query: task prefix plus the question."""
    return config.EMBED_QUERY_PREFIX + text


def embed_texts(texts):
    """Return one vector per text from the configured Ollama model."""
    if not texts:
        return []
    body = json.dumps({"model": config.EMBED_MODEL, "input": list(texts)}).encode()
    request = urllib.request.Request(
        f"{config.OLLAMA_URL}/api/embed",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.EMBED_TIMEOUT_S) as response:
            payload = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:200]
        raise EmbedError(f"ollama answered {error.code}: {detail}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise EmbedError(
            f"ollama unreachable at {config.OLLAMA_URL} ({type(error).__name__}); "
            f"start it with `ollama serve` and `ollama pull {config.EMBED_MODEL}`"
        ) from None
    except ValueError as error:
        raise EmbedError(f"ollama returned invalid JSON: {error}") from None
    vectors = payload.get("embeddings")
    if not isinstance(vectors, list) or len(vectors) != len(texts):
        raise EmbedError("ollama returned no embeddings")
    return vectors


def chunk(text):
    """Split content into overlapping windows that respect paragraph breaks."""
    clean = (text or "").strip()
    if not clean:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", clean) if p.strip()]
    chunks, current = [], ""
    for paragraph in paragraphs:
        while len(paragraph) > CHUNK_CHARS:
            head, paragraph = paragraph[:CHUNK_CHARS], paragraph[CHUNK_CHARS - CHUNK_OVERLAP :]
            if current:
                chunks.append(current)
                current = ""
            chunks.append(head)
        if not current:
            current = paragraph
        elif len(current) + 2 + len(paragraph) <= CHUNK_CHARS:
            current += "\n\n" + paragraph
        else:
            chunks.append(current)
            tail = current[-CHUNK_OVERLAP:]
            current = tail + "\n\n" + paragraph
    if current:
        chunks.append(current)
    return chunks[:MAX_CHUNKS]


def age_days(updated_at, now=None):
    """Age of an ISO timestamp in days; 0 for anything in the future or broken."""
    try:
        stamp = datetime.fromisoformat(str(updated_at))
    except (TypeError, ValueError):
        return 0.0
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=datetime.now().astimezone().tzinfo)
    now = now or datetime.now().astimezone()
    return max(0.0, (now - stamp).total_seconds() / 86400)


def blend_rank(score, updated_at, now=None, weight=RECENCY_WEIGHT, tau_days=RECENCY_TAU_DAYS):
    """Semantic score plus an exponential age nudge (see RECENCY_WEIGHT)."""
    return score + weight * math.exp(-age_days(updated_at, now) / tau_days)


def order_hits(hits, sort="blend", now=None, recency_weight=None, recency_tau_days=None):
    """Annotate hits with ``rank`` and return them in the requested order."""
    if sort not in SORTS:
        sort = "blend"
    weight = RECENCY_WEIGHT if recency_weight is None else float(recency_weight)
    tau = RECENCY_TAU_DAYS if recency_tau_days is None else float(recency_tau_days)
    for hit in hits:
        hit["rank"] = round(blend_rank(hit["score"], hit.get("updated_at"), now, weight, tau), 4)
    if sort == "recent":
        return sorted(hits, key=lambda hit: str(hit.get("updated_at") or ""), reverse=True)
    if sort == "score":
        return sorted(hits, key=lambda hit: hit["score"], reverse=True)
    return sorted(hits, key=lambda hit: (hit["rank"], hit["score"]), reverse=True)


def cosine(a, b):
    """Dot product of two L2-normalised vectors (Ollama normalises)."""
    if len(a) != len(b):
        return 0.0
    # numpy dot is ~10x faster than pure-Python zip-sum for 768-d vectors
    return float(np.dot(a, b))


def content_hash(text):
    return hashlib.sha256((text or "").encode()).hexdigest()


def _pack(vector):
    return array.array("f", [float(x) for x in vector]).tobytes()


def _unpack(blob):
    values = array.array("f")
    values.frombytes(blob)
    return values


def pack(vector):
    return _pack(vector)


def unpack(blob):
    return _unpack(blob)
