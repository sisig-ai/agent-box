"""Local embeddings shared by Docs and Ops Board search.

One Ollama call per batch, plus the chunking, cosine and blob helpers both
indexes use. The vector tables stay separate (docs chunks, card chunks) because
their rows join different parents; only this part is common.
"""

import array
import hashlib
import json
import re
import urllib.error
import urllib.request

from . import config

CHUNK_CHARS = 1200
CHUNK_OVERLAP = 200
MAX_CHUNKS = 60
EXCERPT_CHARS = 280


class EmbedError(Exception):
    """Embedding backend unavailable or answering with garbage."""


# ---------------------------------------------------------------- embedding


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


def cosine(a, b):
    """Dot product of two L2-normalised vectors (Ollama normalises)."""
    if len(a) != len(b):
        return 0.0
    return float(sum(x * y for x, y in zip(a, b, strict=False)))


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
