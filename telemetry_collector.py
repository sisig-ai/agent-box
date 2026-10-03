"""Thin launcher for the native telemetry sampler (plist-stable entrypoint).

The sampler loop lives in ``dashboard/collector.py``; this file stays at the
repo root because the LaunchDaemon runs ``python telemetry_collector.py``.
"""

from dashboard.collector import main

if __name__ == "__main__":
    main()
