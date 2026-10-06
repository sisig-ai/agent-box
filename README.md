# Macmini dashboard

Native macOS copy of the Komurin dashboard for the macmini host. The web UI
serves at http://macmini:5555 and the live terminal WebSocket on tailnet port
5556. The page is a service grid plus a Daily Brief markdown canvas, with a host
filesystem browser and an interactive shell. It also links three sibling
services: Coins.ph Agent (:7777), Hermes Agent (:9119), and Opencode (:4096).

Location: /Users/kixpanganiban/quick-arr-stack/arr-dashboard
Python: 3.11 in `.venv`. System packages: Homebrew macmon and tmux.

## Layout

- `app.py` — gunicorn entry point (`app = create_app()`).
- `shell_ws.py` — WebSocket gateway launcher (:5556).
- `telemetry_collector.py` — telemetry sampler launcher (one sample per second).
- `dashboard/` — application package: `config`, `db`, `dates`,
  `notes` + `notes_api`, `telemetry_store` + `telemetry_api`, `macos_metrics`,
  `fs_paths` + `fs` + `fs_api`, `shell/` (tmux backend + HTTP API), `ws/`
  (frames, handshake, session, server), and `collector`.
- `static/` — the UI: `index.html`, `css/`, no-build ES modules under `js/`,
  vendored `vendor/marked.min.js` and `vendor/codemirror/`, and fonts.
- `tests/` — pytest suite (hermetic; tmux and the collector are mocked).
- `deploy/` — LaunchDaemon plists, `install-services.sh`, rehearsal tooling,
  and the legacy `source-linux/` recipe.

The three root entry points stay at the repository root so the installed
LaunchDaemons keep working without a reinstall.

## Development

Run the full gate (ruff lint + format check + pytest + strict SLOC):

    make check

Other targets:

    make test    # pytest only
    make lint    # ruff check
    make format  # ruff format (writes)
    make run     # gunicorn on 0.0.0.0:5555, the same bind the web service uses

`make run` binds port 5555, which the installed web service already owns. To run
a scratch copy, bind another port instead:

    .venv/bin/gunicorn --workers 1 --threads 8 --bind 127.0.0.1:5599 app:app

## Configuration

Paths and limits are environment-overridable; the defaults match the installed
service.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DASH_DATA_DIR` | `data/` | Runtime state directory |
| `DASH_DB_PATH` | `<data>/briefs.db` | SQLite database path |
| `DASH_FS_HOME` | `$HOME` | Root for the Files browser and shell |
| `DASH_MAX_UPLOAD_MB` | `1024` | Upload body cap; larger requests get a 413 JSON error |

## Data

The dashboard keeps its own SQLite database at `data/briefs.db`, in WAL mode. It
holds the Daily Brief notes, the weekly schedules, and telemetry. It never edits
the Coins.ph ledgers. `data/` is git-ignored and survives updates.

`macos_metrics` maps macOS host CPU/memory counters and native macmon sensor
readings to the API. System power is Apple's SMC estimate for the device, not a
wall-plug measurement; component values stay null when IOReport counters are
unavailable. The Mac alert threshold is 80 W. Telemetry is recorded once per
second with no browser open, history retains 3900 seconds, and stale samples
return HTTP 503 rather than appearing live.

## Services

Native boot services are defined in `deploy/`:

- `dev.macmini.dashboard.web` — `gunicorn app:app` on the tailnet address :5555
- `dev.macmini.dashboard.shell` — `python shell_ws.py` on :5556
- `dev.macmini.dashboard.telemetry` — `python telemetry_collector.py`

Install the validated services with:

    sudo /bin/bash /Users/kixpanganiban/quick-arr-stack/arr-dashboard/deploy/install-services.sh

The installer stops only known temporary dashboard processes as their user,
checks both ports, and installs root-owned LaunchDaemons which run as
kixpanganiban. RunAtLoad and KeepAlive start them at boot and restart on exit.
Logs are in /Users/kixpanganiban/Library/Logs/macmini-dashboard/.

Code updates need no reinstall. Restart a service to pick up new code:

    sudo launchctl kickstart -k system/dev.macmini.dashboard.web
    sudo launchctl kickstart -k system/dev.macmini.dashboard.shell
    sudo launchctl kickstart -k system/dev.macmini.dashboard.telemetry

Inspect:

    launchctl print system/dev.macmini.dashboard.web

## API

`static/llm.txt` is the HTTP/WebSocket contract. The web app has no
authentication and binds the tailnet address only.

## Legacy

`Dockerfile.linux-source` is the original Linux container recipe, kept as an
unmaintained reference. Deployment on this Mac uses the native services above.
