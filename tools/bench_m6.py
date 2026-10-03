#!/usr/bin/env python3
"""M6 perf bench: seed a scratch dataset, then time the hot endpoints.

Seed (caller sets DASH_DATA_DIR / DASH_DB_PATH / DASH_FS_HOME)::

    .venv/bin/python tools/bench_m6.py seed --dir "$SCRATCH/home/big" --files 5000 --rows 3900

Run against a scratch gunicorn (never the live service)::

    .venv/bin/python tools/bench_m6.py run --dir "$SCRATCH/home/big"

The seeded ``latest-stats.json`` carries a timestamp one hour in the future so
the file never goes stale during a run; the parse cost is unaffected.
"""

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def _seed(args):
    sys.path.insert(0, str(REPO))
    from dashboard import config, db

    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    db.init_db()
    now = int(time.time())
    conn = db.connect()
    try:
        with conn:
            for i in range(args.rows):
                ts = now - (args.rows - 1 - i)
                conn.execute(
                    "INSERT OR REPLACE INTO telemetry"
                    " (ts, cpu_util, cpu_temp, mem_used, mem_total,"
                    " pwr_cpu, pwr_gpu, pwr_total)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (ts, 10.0 + (i % 90), 40.0, 1_000_000 + i, 8_000_000, 5.0, 15.0, 20.0),
                )
    finally:
        conn.close()
    stamp = datetime.fromtimestamp(time.time() + 3600).astimezone().isoformat(timespec="seconds")
    (config.DATA_DIR / "latest-stats.json").write_text(
        json.dumps({"t": stamp, "cpu": {"util_percent": 12.5}})
    )
    big = Path(args.dir)
    big.mkdir(parents=True, exist_ok=True)
    for i in range(args.files):
        (big / f"f{i:05d}.dat").touch()
    print(f"seeded {args.rows} telemetry rows, {args.files} files in {big}")


def _fetch(url, timeout):
    t0 = time.perf_counter()
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        body = resp.read()
    return (time.perf_counter() - t0) * 1000.0, len(body)


def _pct(values, p):
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round(p * (len(ordered) - 1)))))
    return ordered[idx]


def _measure(url, requests, warmups, timeout):
    for _ in range(warmups):
        _fetch(url, timeout)
    latencies = []
    size = 0
    for _ in range(requests):
        ms, size = _fetch(url, timeout)
        latencies.append(ms)
    return latencies, size


def _run(args):
    base = args.base_url.rstrip("/")
    targets = [
        ("/api/stats", f"{base}/api/stats"),
        ("/api/stats/history?seconds=3600", f"{base}/api/stats/history?seconds=3600"),
        ("/api/fs/list large dir", f"{base}/api/fs/list?path={args.dir}"),
    ]
    print("| endpoint | p50 ms | p95 ms | response bytes |")
    print("|---|---|---|---|")
    for label, url in targets:
        lat, size = _measure(url, args.requests, args.warmups, args.timeout)
        print(f"| {label} | {_pct(lat, 0.50):.2f} | {_pct(lat, 0.95):.2f} | {size} |")


def _main():
    parser = argparse.ArgumentParser(description="M6 perf bench (seed + run).")
    sub = parser.add_subparsers(dest="command", required=True)

    seed = sub.add_parser("seed", help="create scratch telemetry + a large directory")
    seed.add_argument("--dir", required=True, help="large directory to create for fs/list")
    seed.add_argument("--files", type=int, default=5000)
    seed.add_argument("--rows", type=int, default=3900)
    seed.set_defaults(func=_seed)

    run = sub.add_parser("run", help="time the hot endpoints of a running scratch server")
    run.add_argument("--base-url", default="http://127.0.0.1:5599")
    run.add_argument("--dir", required=True, help="path polled through /api/fs/list")
    run.add_argument("--requests", type=int, default=200)
    run.add_argument("--warmups", type=int, default=5)
    run.add_argument("--timeout", type=float, default=10.0)
    run.set_defaults(func=_run)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    _main()
