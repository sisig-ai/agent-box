"""HTTP blueprint for the GMGN loop tab. Reads the runner feed script."""

import json
import os
import subprocess
import time
from pathlib import Path

from flask import Blueprint, jsonify

bp = Blueprint("gmgn", __name__)

FEED_SCRIPT = Path(os.environ.get(
    "GMGN_FEED_SCRIPT",
    str(Path.home() / ".hermes/skills/gmgn-migrated-loop/scripts/feed.py"),
))
_CACHE = {"at": 0.0, "body": None}


def load_feed():
    now = time.time()
    if _CACHE["body"] is not None and now - _CACHE["at"] < 8:
        return _CACHE["body"], None
    if not FEED_SCRIPT.is_file():
        return None, "feed script missing"
    try:
        proc = subprocess.run(
            ["python3", str(FEED_SCRIPT)],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, str(exc)
    if proc.returncode != 0:
        return None, (proc.stderr or "feed script failed")[-400:]
    try:
        body = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None, "feed script did not return json"
    _CACHE["at"] = now
    _CACHE["body"] = body
    return body, None


@bp.get("/api/gmgn")
def gmgn_feed():
    body, error = load_feed()
    if error:
        return jsonify({"error": error}), 503
    return jsonify(body)
