"""Filesystem paths and tunables, all env-overridable.

``DASH_DATA_DIR`` / ``DASH_DB_PATH`` / ``DASH_FS_HOME`` redirect the mutable
runtime state so tests and ``verify.py`` can point at a throwaway tree instead
of patching module globals.
"""

import os
from pathlib import Path


def env_path(name, default):
    """Path from an env var (tilde-expanded), or the given default."""
    raw = os.environ.get(name)
    return Path(raw).expanduser() if raw else default


def env_int(name, default):
    """Positive int from an env var, or the given default on garbage."""
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = env_path("DASH_DATA_DIR", BASE_DIR / "data")
DB_PATH = env_path("DASH_DB_PATH", DATA_DIR / "briefs.db")
FS_HOME = env_path("DASH_FS_HOME", Path.home())

# Bound request bodies so /api/fs/upload can't take unbounded payloads.
# Env-tunable in MB; an over-limit body surfaces as a clean 413 JSON error.
MAX_UPLOAD_MB = env_int("DASH_MAX_UPLOAD_MB", 1024)

# Local embeddings for Docs semantic search: an Ollama instance on this box.
# The model is small (nomic-embed-text is 274 MB, 768-d) and runs offline.
OLLAMA_URL = os.environ.get("DASH_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
EMBED_MODEL = os.environ.get("DASH_EMBED_MODEL", "nomic-embed-text")
EMBED_TIMEOUT_S = env_int("DASH_EMBED_TIMEOUT_S", 60)

# Telemetry ring-buffer window (seconds); /api/stats/history caps here too.
TELEMETRY_RETENTION_S = 3900
