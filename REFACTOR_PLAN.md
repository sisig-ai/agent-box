# Refactor Plan: macmini arr-dashboard

Status: **complete** (M0–M7 landed 2026-10-03). Track progress in `REFACTOR_TRACKER.md`.

Decisions locked in (2026-10-03):
- Frontend decomposition: **no-build ES modules** (no bundler, no npm, stays offline-friendly)
- Tooling: **pytest + ruff** (plus an SLOC gate in `make check`)
- Scope: plan + tracker only for now — no code edits are made until execution is green-lit

**Constraints honored:** every source file ends ≤ 300 SLOC · behavior, API surface, and deploy
wiring stay unchanged · all work lands as milestoned, reviewable commits.

**Hard invariants** (breaking these breaks the running stack):
1. **HTTP/WS API surface is frozen.** `static/llm.txt` is the contract (routes, payload shapes,
   date semantics, 503-stale behavior).
2. **Service entry points stay at the repo root.** The LaunchDaemons run `gunicorn app:app`,
   `python telemetry_collector.py`, `python shell_ws.py` from the project root — those three
   files must remain importable/executable exactly as named, so no `install-services.sh`
   reinstall is needed.
3. **`data/briefs.db` is never modified by the refactor and never committed.**
   29 briefs + 5 schedules live there.
4. FS delete guards (`~`, `/`, ancestors), shell-ID regex validation, and the
   tailnet-only/no-auth posture stay as-is.

---

## Target layout (SLOC budgets in brackets)

```
arr-dashboard/
├── app.py                     [~15]   gunicorn entry: app = create_app()
├── telemetry_collector.py     [~20]   thin runner (plist-stable)
├── shell_ws.py                [~10]   thin runner (plist-stable)
├── pyproject.toml             [new]   ruff config, pytest config, project meta
├── Makefile                   [new]   make check / make run / make sloc
├── requirements-dev.txt       [new]   pytest, ruff
├── .gitignore                 [new]
├── dashboard/                        application package
│   ├── __init__.py            [~45]   create_app(): config, blueprints, static routes
│   ├── config.py              [~45]   paths (env-overridable), retention/limit constants
│   ├── db.py                  [~75]   connect + schema, flask.g reuse, WAL/busy_timeout
│   ├── dates.py               [~40]   normalize_date / week helpers / today, now_iso
│   ├── notes.py               [~90]   daily_brief + weekly_schedule persistence
│   ├── notes_api.py           [~130]  /api/brief*, /api/schedule* blueprint
│   ├── telemetry_store.py     [~80]   ring-buffer write, history query, latest-stats read
│   ├── telemetry_api.py       [~65]   /api/stats, /api/stats/history
│   ├── macos_metrics.py       [~45]   moved from root (pure mapping)
│   ├── fs.py                  [~180]  path norm, entry metadata, places, fs ops
│   ├── fs_api.py              [~150]  /api/fs/* blueprint
│   ├── shell/
│   │   ├── tmux.py            [~185]  ex-shell_common: tmux backend, argv subprocess
│   │   └── api.py             [~115]  /api/shell/* blueprint
│   └── ws/
│       ├── frames.py          [~95]   frame encode/decode, masking, fragmentation
│       ├── handshake.py       [~65]   HTTP Upgrade → 101
│       ├── session.py         [~165]  message dispatch + push loop (burst/idle/ping/reap)
│       └── server.py          [~55]   accept loop, signals
├── tests/                     [new]   pytest suite (M5)
└── static/
    ├── index.html             [~250]  DOM only + <link>/<script type="module">
    ├── css/  base.css [~150] · header.css [~95] · telemetry.css [~200] ·
    │         power-alerts.css [~130] · scanner.css [~60] · fleet.css [~165] ·
    │         brief.css [~250] · schedule.css [~210] · shell.css [~165] ·
    │         files.css [~265] · modal.css [~85]
    └── js/
        ├── main.js    [~30]   ordered module imports + boot
        ├── dom.js     [~25]   $, esc, setTxt/setBar (change-gated writes)
        ├── warpfield.js       [~255]  starfield + idle/freezebg
        ├── stack.js           [~170]  icons, URLs, readout, grid render, scanner
        ├── router.js          [~35]   hash routes → direct module calls (kills window.* globals)
        ├── modal.js           [~65]   prompt/confirm
        ├── telemetry/ graphs.js [~230] · alerts.js [~95] · poll.js [~150]
        ├── shell/   ansi.js [~120] · shell.js [~185]
        ├── files/   api.js [~85] · render.js [~190] · actions.js [~130]
        └── notes/   markdown.js [~35] · note-panel.js [~230] · brief.js [~55] · schedule.js [~85]
```

The JS splits follow the existing `/* ===== … ===== */` IIFE seams almost 1:1 — this is
extraction, not rewriting. CSS splits follow the existing `/* ---------- … ---------- */`
section markers, `<link>` order preserved so the cascade doesn't shift.

---

## M0 — Git baseline & safety net
*Goal: rollback point before touching anything.*

- `git init`; write `.gitignore`: `data/` (contains the private notes DB + WAL), `.venv/`,
  `__pycache__/`, `*.pyc`, `.DS_Store`, `deploy/rehearsal-pids.json`, `*.log`
- Baseline commit of the tree **as-is** — every later milestone is diffable against it
- Record the smoke checklist (four tabs, graphs, alerts, terminal echo/resize/reconnect,
  files CRUD/upload) and confirm `verify.py` is green before proceeding

**Accept:** `git status` clean, `data/` untracked, `verify.py` passes. **Commits:** 1.

## M1 — Best practices, latent bugs, tooling
*Goal: fix what's wrong before moving it, so refactors don't propagate bugs.*

- **Bug fixes:** `?limit=` handlers currently 500 on non-numeric input → parse safely, 400;
  `assert`-based table whitelisting is stripped under `python -O` → explicit validation;
  `import json` mid-file and unused imports (`secrets`, etc.) cleaned up
- **Security:** replace the `<script>`-stripping regex in both preview renderers with one
  `sanitizeHtml()` (strips `<script>/<style>`, `on*=` handlers, `javascript:`/`data:` URLs) —
  the current regex misses `<img onerror=…>`; add `MAX_CONTENT_LENGTH` to bound uploads
- **Testability:** config paths become env-overridable (`DASH_DATA_DIR`, `DASH_FS_HOME`,
  `DASH_DB_PATH`) so tests stop monkeypatching module globals (`verify.py`'s
  `app.DATA_DIR = …` trick dies in M5)
- **Tooling:** `pyproject.toml` with ruff (lint + format, py3.11, line-length 100),
  `requirements-dev.txt` (pytest, ruff), `Makefile` with `make check` (ruff + pytest + SLOC
  gate), `make run`, `make sloc`

**Accept:** `ruff check .` clean, verify.py green, manual smoke passes. **Commits:** ~2
(`fix: …`, `chore: tooling`).

## M2 — Backend decomposition (`app.py` 855 → package)
*Goal: one concern per file, app factory, zero deploy churn.*

Extract in leaf-first order so every step stays runnable:
1. `config.py`, `db.py`, `dates.py` (pure leaves)
2. `notes.py` + `notes_api.py` (brief + schedule)
3. `telemetry_store.py` + `telemetry_api.py` — **key decoupling:** `record_telemetry_snapshot`
   moves out of `app`, so `telemetry_collector.py` stops importing Flask + running `init_db()`
   in the sampler process
4. `fs.py` + `fs_api.py`
5. `shell/api.py` (routes only; backend stays in `shell_common` until M3)
6. `dashboard/__init__.py::create_app()` + root `app.py` reduced to `app = create_app()`

Perf/concurrency cleanups folded in here: SQLite connection reuse via `flask.g`, PRAGMAs
applied once at init (`WAL`, `busy_timeout`, `synchronous=NORMAL`), and `ensure_session`'s
fixed `sleep(0.6)` becomes a bounded capture-retry (faster and no false-negative first frame).

**Accept:** all endpoints byte-identical in shape (llm.txt unchanged), `wc -l` gate passes,
services restart against the new code **without touching the plists**
(`launchctl kickstart` is enough). **Commits:** ~6 (`refactor: extract db`,
`refactor: notes store+api`, …).

## M3 — WebSocket gateway split + shell backend hardening
*Goal: `shell_ws.py` 406 → thin runner; kill the shell-string subprocess pattern.*

- `shell_common.py` → `dashboard/shell/tmux.py`: build `subprocess.run` **argv lists** instead of
  interpolating into `sh -c` strings (today's inputs are regex-validated so it's not
  exploitable, but the pattern is one validation bug away from command injection);
  `paste_text`'s nested-sh exit-code dance becomes three explicit tmux calls
- `shell_ws.py` → `dashboard/ws/{frames,handshake,session,server}.py`; root `shell_ws.py`
  becomes `serve()` runner
- Preserved deliberately: burst/idle capture cadence (0.05s / 0.30s), send-only-on-change
  diffing, ping/reap timers, thread-per-connection (right-sized for tailnet use; document the
  tradeoff)

**Accept:** live terminal e2e (echo latency, resize, `New`, kill, WS reconnect with backoff),
new unit tests for frame round-trip over a socketpair + handshake parsing. **Commits:** ~3.

## M4 — Frontend decomposition (no-build ES modules)
*Goal: `index.html` 4,067 → ~250 DOM lines; behavior pixel-identical.*

1. CSS first (pure `<link>` swap, ordered to match current source order — no JS risk)
2. JS IIFEs → ES modules, extracted in the existing section order; `main.js` imports them in
   the same init sequence so nothing reorders
3. `router.js` calls `shell.init()/files.init()` via **imports** — deletes the
   `window.shellEnsure/fsEnsure/currentView` globals
4. Shared `dom.js` (`$`, `esc`, change-gated `setTxt`/`setBar`) and `notes/markdown.js`
   (the M1 sanitizer lives here and feeds both previews)
5. `marked.min.js` stays vendored as a classic script (`window.marked` read from modules) —
   no npm, fully offline
6. Lazy-route option: `router.js` uses dynamic `import()` so shell/files modules load on first
   tab open (small first-parse win, no build step)

Perf behaviors that must survive the split (regression checklist): `document.hidden` poll
gating, change-gated DOM writes, starfield sprite batching + 30fps cruise budget + idle pause
+ `?freezebg=1` probe.

**Accept:** full UI smoke identical to M0 baseline, zero console errors/warnings, DOM sanity
diff, SLOC gate on every css/js file. **Commits:** ~3 (`refactor(css): …`,
`refactor(js): extract telemetry`, …).

## M5 — Test suite (pytest + ruff green)
*Goal: `verify.py`'s smoke script becomes a real regression net.*

- `tests/conftest.py`: tmp `DATA_DIR`/`FS_HOME` fixtures via the M1 env config — no global
  monkeypatching
- `test_notes_api`, `test_schedule_api`, `test_telemetry` (ring buffer, dense history nulls,
  stale→503), `test_fs_api` (traversal attempts, home/root delete guards, upload
  collision→409, symlink delete-removes-link), `test_shell_api` (bad-ID rejection, dims
  clamping), `test_ws_frames`/`test_handshake`, `test_macos_metrics` (null-power semantics:
  missing ≠ 0 W)
- `test_tmux` with mocked `subprocess.run` (gone-detection, error mapping)
- Migrate every `verify.py` assertion, then delete `verify.py` and update the README check
  instructions

**Accept:** `make check` = ruff clean + pytest green + SLOC gate; every route in llm.txt's API
table has at least one test. **Commits:** ~2.

## M6 — Performance pass (measure, then tune)
*Goal: pay down the known hot paths with numbers attached.*

- **`/api/stats`:** cache the parsed `latest-stats.json` keyed on `(mtime, size)` — today every
  1s tick × every tab re-reads and re-parses the file
- **`/api/stats/history`:** 1s TTL cache keyed by `seconds` (multiple tabs poll identically) +
  ensure compact JSON; payload stays dense-array shaped (frontend depends on it)
- **`/api/fs/list`:** cap entries (e.g. 2,000) with a `truncated` flag so `/Volumes` or a
  node_modules dir can't return a 10 MB JSON blob
- **Static:** `Cache-Control: immutable` for fonts/vendor, `no-cache` for
  `index.html`/`config.json`; optional gzip for JSON/HTML (local tailnet — nice-to-have, not
  required)
- **Frontend:** verify post-split that the 1s poll, change-gating, and idle pause still hold;
  measure idle-tab CPU via the existing `?freezebg=1` probe

**Accept:** recorded before/after for `/api/stats` latency, history payload size, keystroke
echo round-trip, idle tab CPU — no regression anywhere, clear wins on the first two.
**Commits:** ~2.

## M7 — Closeout: git-commit ready
*Goal: a tree you'd be happy to push.*

- README rewrite: new layout, `make check`/`make run`, "services reinstall unchanged" note;
  `static/llm.txt` consistency pass (add `/api/fs/list` `truncated` field, sanitizer note)
- Housekeeping: `__pycache__` purged, `.gitignore` verified against a dry-run
  `git status --ignored`, full `make check`, fresh-clone smoke (venv → `make check` →
  `make run`)
- Commit series is already milestone-granular; optional annotated tag at the end

**Accept:** fresh clone works from README alone; `git status` clean; every file ≤ 300 SLOC.
**Commits:** ~2.

---

## Performance principles applied throughout

| Layer | Tactic |
|---|---|
| SQLite | WAL + one writer (the collector process) + per-second PK dedupe; `flask.g` connection reuse; cached reads for 1 Hz data |
| HTTP | bounded payloads, TTL caches for identical multi-tab polls, cache headers for static assets |
| Subprocess (tmux) | argv lists (no shell fork), capture-retry instead of fixed sleeps, send-only-on-change WS diffs |
| Frontend | no build step keeps the critical path trivial; lazy route modules; existing 1 Hz gating / sprite batching / idle pause preserved and regression-checked |
| WebSocket | documented burst/idle cadence retained (0.05s after input → 0.30s idle); thread-per-conn is fine at tailnet scale, cap documented |

## Top risks & mitigations

1. **Cascade/order regressions when splitting CSS** → split strictly along existing section
   markers, preserve `<link>` order, smoke the four tabs after the CSS-only commit before
   touching JS.
2. **JS init-order changes break implicit dependencies** → extract in source order, `main.js`
   imports in the same sequence; router runs last exactly as today.
3. **Behavioral drift in date semantics (Manila-local defaulting)** → `dates.py` tests pin
   `today_str`/`week_start_for` before the move.
4. **Accidental data exposure** → `data/` gitignored in M0 before anything is staged; final
   `git status --ignored` audit in M7.
5. **Deploy breakage** → root entry files never move (invariant #2); verify with
   `launchctl kickstart` after M2/M3 instead of a full reinstall.
