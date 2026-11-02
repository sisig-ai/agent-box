"""Shared fixtures: per-test isolated data dir + scratch filesystem home.

Every test runs with the mutable runtime state redirected to a ``tmp_path`` so
no test reads or writes the real ``data/`` directory. ``dashboard.config`` is
monkeypatched per test; the modules that bind ``FS_HOME`` at import time
(``dashboard.fs``, ``dashboard.fs_paths``) are patched too, because a
``from .config import FS_HOME`` copy does not follow the module attribute.
"""

import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from dashboard import config, docs_embed, fs_paths, telemetry_store
from dashboard import fs as fs_module


def _now_iso(age_seconds=0.0):
    stamp = datetime.now().astimezone() - timedelta(seconds=age_seconds)
    return stamp.isoformat()


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    """Redirect DATA_DIR / DB_PATH / FS_HOME to a per-test throwaway tree."""
    data = tmp_path / "data"
    home = tmp_path / "home"
    data.mkdir()
    home.mkdir()
    monkeypatch.setattr(config, "DATA_DIR", data)
    monkeypatch.setattr(config, "DB_PATH", data / "briefs.db")
    monkeypatch.setattr(config, "FS_HOME", home)
    monkeypatch.setattr(fs_paths, "FS_HOME", home)
    monkeypatch.setattr(fs_module, "FS_HOME", home)
    # Docs embeddings call a local Ollama; tests drive them explicitly instead.
    monkeypatch.setattr(docs_embed, "_AUTO_INDEX", False)
    monkeypatch.setattr(telemetry_store, "_TELE_LAST_WRITE", {"t": 0.0})
    monkeypatch.setattr(telemetry_store, "_LATEST_STATS_CACHE", {"sig": None, "snapshot": None})
    monkeypatch.setattr(telemetry_store, "_HISTORY_CACHE", {"key": None, "payload": None})
    return SimpleNamespace(data=data, home=home, tmp=tmp_path)


@pytest.fixture
def schema(env):
    """Create the SQLite schema in the throwaway database."""
    from dashboard.db import init_db

    init_db()


@pytest.fixture
def app(env):
    from dashboard import create_app

    return create_app()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def home(env):
    return env.home


@pytest.fixture
def stats_writer(env):
    """Write ``data/latest-stats.json`` with a controllable timestamp age."""
    path = env.data / "latest-stats.json"

    def write(age_seconds=0.0, **fields):
        snapshot = {"t": _now_iso(age_seconds), **fields}
        path.write_text(json.dumps(snapshot))
        return snapshot

    return write
