# Macmini dashboard

Native macOS copy of the Komurin dashboard. Served at http://macmini:5555,
with the live terminal WebSocket on tailnet port 5556. The stack contains the
Coins.ph agent on port 7777. Brief, Schedule, search, terminal, a filesystem
explorer, graphs, and power alert interactions are retained with a blue/violet
theme.

Location: /Users/kixpanganiban/quick-arr-stack/arr-dashboard
Python environment: .venv (Python 3.11)
System packages: Homebrew macmon 0.8.2 and tmux 3.7c.
Python package versions: requirements.lock.txt.

macos_metrics.py maps macOS host CPU/memory counters and native macmon sensor
readings to the original API. System power uses Apple's SMC system-power sensor.
Its estimate covers the device and is not a wall-plug measurement. Component
power values remain null when IOReport counters are unavailable. The Mac alert
threshold is 80 W; the bar spans 100 W, and the expanded graph scales dynamically.
Telemetry is recorded once per second even with no browser open. History retains
3900 seconds. Stale samples return HTTP 503 rather than appearing live.

The 29 daily briefs and 5 schedules were copied using SQLite's consistent backup
API. Linux telemetry was excluded from the copy.
The dashboard has its own data/briefs.db and does not edit the Coins.ph ledgers.

The shell uses local tmux and zsh under kixpanganiban, beginning in that user's
home. Both HTTP session operations and the live WebSocket transport are retained.
HTTP and WebSocket listeners bind the Mac's tailnet address 100.64.149.91.

The Files tab (`#/files`) is an SFTP-style browser over the host filesystem,
opening at `~` and backed by `/api/fs/*` in app.py. It lists, navigates, and
inspects entries, and supports new folder/file, upload, download, rename, and
delete. Paths are normalised in Python (no shell interpolation) and destructive
deletes refuse `~`, `/`, and their ancestors. Like the shell, it runs as the
dashboard user, so it can reach the whole filesystem.

Native boot service definitions are prepared in deploy/:
- dev.macmini.dashboard.web
- dev.macmini.dashboard.shell
- dev.macmini.dashboard.telemetry

Install the validated services with:
sudo /bin/bash /Users/kixpanganiban/quick-arr-stack/arr-dashboard/deploy/install-services.sh

The installer stops only known temporary dashboard processes as their user,
checks both ports, and installs root-owned LaunchDaemons which run as
kixpanganiban. RunAtLoad and KeepAlive start them at boot and restart on exit.
Logs are in /Users/kixpanganiban/Library/Logs/macmini-dashboard/.

Inspect:
launchctl print system/dev.macmini.dashboard.web
launchctl print system/dev.macmini.dashboard.shell
launchctl print system/dev.macmini.dashboard.telemetry

Run the full local gate (lint + format + tests + SLOC):
make check

The original container recipe is retained as Dockerfile.linux-source for
reference. Deployment on this Mac uses the native services above.
