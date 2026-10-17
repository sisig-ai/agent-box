"""HTTP blueprint for the GMGN loop tab. Reads the runner feed script."""

import json
import os
import subprocess
import threading
import time
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from flask import Blueprint, jsonify

bp = Blueprint("gmgn", __name__)

FEED_SCRIPT = Path(os.environ.get(
    "GMGN_FEED_SCRIPT",
    str(Path.home() / ".hermes/skills/gmgn-migrated-loop/scripts/feed.py"),
))
_CACHE = {"at": 0.0, "body": None}
_BALANCE = {"at": 0.0, "body": None}
_BALANCE_LOCK = threading.Lock()
WALLET = os.environ.get(
    "GMGN_WALLET",
    "Djb7TeWb4Akm5vNevEe8qJ1B3jV3aN98prN2Ap2aKcgi",
)
SOL_MINT = "So11111111111111111111111111111111111111112"
BALANCE_TTL = 30


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


def quote_usd(sol, price):
    usd = (Decimal(str(sol)) * Decimal(str(price))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP,
    )
    return format(usd, "f")


def _cli_json(args):
    proc = subprocess.run(
        ["gmgn-cli", *args, "--raw"],
        capture_output=True,
        text=True,
        timeout=12,
        check=False,
    )
    if proc.returncode != 0:
        return None
    data = json.loads(proc.stdout)
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        return data["data"]
    return data


def load_balance(now=None):
    """Native SOL from portfolio stats, priced with wrapped-SOL. None on failure."""
    now = time.time() if now is None else now
    with _BALANCE_LOCK:
        cached = _BALANCE["body"]
        fresh = cached is not None and now - _BALANCE["at"] < BALANCE_TTL
    if fresh:
        return cached
    try:
        stats = _cli_json(["portfolio", "stats", "--chain", "sol", "--wallet", WALLET])
        token = _cli_json(["token", "info", "--chain", "sol", "--address", SOL_MINT])
        sol = stats["native_balance"]
        price = token["price"]["price"]
        body = {
            "sol": str(sol),
            "usd": quote_usd(sol, price),
            "price_usd": str(price),
            "as_of": int(now),
        }
    except (TypeError, KeyError, ValueError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        with _BALANCE_LOCK:
            if _BALANCE["body"] is not None and now - _BALANCE["at"] < 120:
                return _BALANCE["body"]
        return None
    with _BALANCE_LOCK:
        _BALANCE["at"] = now
        _BALANCE["body"] = body
    return body


@bp.get("/api/gmgn")
def gmgn_feed():
    body, error = load_feed()
    if error:
        return jsonify({"error": error}), 503
    body = dict(body)
    body["balance"] = load_balance()
    return jsonify(body)
