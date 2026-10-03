# Refactor Tracker: macmini arr-dashboard

Running tracker for the work planned in `REFACTOR_PLAN.md`. Update as work proceeds:
check items off, log commits and decisions at the bottom, and keep the status block current.

---

## Status

| Field | Value |
|---|---|
| Phase | In progress |
| Current milestone | M2 complete — M3 not started |
| Last updated | 2026-10-03 (M2: app.py 927→8 SLOC behind a `create_app()` factory; `dashboard/` package; collector decoupled from Flask; SQLite `flask.g` reuse + WAL; `ensure_session` capture-retry) |
| Blocking on | — (M2 code gate met; service restart via `launchctl kickstart` and manual browser smoke pending for the human) |

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked/issue

---

## Milestones

### M0 — Git baseline & safety net
- [x] `git init` + `.gitignore` (`data/`, `.venv/`, `__pycache__/`, `*.pyc`, `.DS_Store`, `deploy/rehearsal-pids.json`, `*.log`)
- [x] Baseline commit of the tree as-is (`e3d1128`, 28 files, no source edits)
- [x] Smoke checklist recorded (four tabs, graphs, alerts, terminal echo/resize/reconnect, files CRUD/upload)
- [x] `verify.py` green before and after the baseline commit
- [x] **Gate:** `git status` clean at baseline, `data/` + `.venv/` untracked/ignored, `verify.py` passes

Manual browser smoke checklist — for the human, not performed by the agent
(baseline reference for M4 "UI smoke identical to M0"):
- [ ] Four tabs (`Brief`, `Stack`, `Files`, `Shell`) switch via the header nav
- [ ] Graphs render and update on the 1s telemetry poll
- [ ] Alerts show/clear correctly
- [ ] Terminal: echo latency, resize, reconnect (WS backoff)
- [ ] Files: CRUD + upload

### M1 — Best practices, latent bugs, tooling
- [x] Safe `?limit=` parsing (400 instead of 500 on garbage input) — `parse_limit()`; defaults 30/20, caps 365/104 preserved
- [x] Replace `assert` table-whitelist with explicit validation — `validate_note_table()` raises `ValueError`, survives `python -O`
- [x] Clean imports (unused `secrets`/`subprocess` in app.py, `os` in shell_common, `Path`/`time` in telemetry_collector; mid-file `import json` moved to top)
- [x] Single `sanitizeHtml()` for both markdown previews (DOMParser denylist: script/style/iframe/object/embed/link/meta/base/form, `on*=` handlers, `javascript:`/`data:`/`vbscript:` URLs; task-list checkboxes kept)
- [x] `MAX_CONTENT_LENGTH` upload bound — `DASH_MAX_UPLOAD_MB`, default 1024 MB, clean 413 `{"error": …}`
- [x] Env-overridable config (`DASH_DATA_DIR`, `DASH_DB_PATH`, `DASH_FS_HOME`; defaults identical)
- [x] `pyproject.toml` (ruff lint + format, py3.11, line-length 100, `deploy/` excluded) + `[tool.pytest.ini_options]`
- [x] `requirements-dev.txt` (pytest 9.1.1, ruff 0.16.10 pinned) + `Makefile` (`check` / `run` / `verify` / `sloc`)
- [x] `verify.py` reads env before importing `app` (no more module-global monkeypatching); all assertions kept
- [x] `ruff check .` + `ruff format --check .` clean; `make check` exits 0 (SLOC gate non-strict until M2/M4)
- [x] **Gate:** `ruff check .` clean, `verify.py` green — manual browser smoke **pending for the human**

### M2 — Backend decomposition (app.py 927 → package)
- [x] `dashboard/config.py`, `db.py`, `dates.py` extracted (`ecbc023`)
- [x] `notes.py` + `notes_api.py` extracted (`4eb17e9`)
- [x] `telemetry_store.py` + `telemetry_api.py` extracted; collector no longer imports Flask (`0de0d59`)
- [x] `fs.py` + `fs_api.py` extracted (`e048d2c`; helpers split into `fs_paths.py` to stay ≤300 SLOC)
- [x] `shell/api.py` extracted (routes only; backend still root `shell_common` until M3) (`13dae63`)
- [x] `create_app()` factory; root `app.py` → thin gunicorn entry (8 SLOC) (`e6d7a3d`)
- [x] SQLite: `flask.g` connection reuse + teardown close, WAL at init, `busy_timeout=5000`, `synchronous=NORMAL`
- [x] `ensure_session`: `sleep(0.6)` → bounded capture-retry (`7b641e0`)
- [x] **Gate:** llm.txt unchanged (scratch-server smoke matched every shape), `wc -l` gate passes for all Python except `shell_ws.py`/`static/index.html` (M3/M4 scope), `gunicorn --check-config app:app` passes. Service restart (`launchctl kickstart`, no plist edits) + manual browser smoke pending for the human

### M3 — WebSocket gateway split + shell hardening
- [ ] `shell_common.py` → `dashboard/shell/tmux.py` with argv-list subprocess calls
- [ ] `paste_text`: nested-sh exit-code dance → three explicit tmux calls
- [ ] `shell_ws.py` → `dashboard/ws/{frames,handshake,session,server}.py`
- [ ] Root `shell_ws.py` → thin `serve()` runner
- [ ] Unit tests: frame round-trip over socketpair, handshake parsing
- [ ] **Gate:** live terminal e2e (echo latency, resize, New, kill, WS reconnect with backoff)

### M4 — Frontend decomposition (no-build ES modules)
- [ ] CSS → `static/css/*.css` (section-marker splits, `<link>` order preserved) — smoke before any JS
- [ ] JS IIFEs → `static/js/**` ES modules in existing init order
- [ ] `router.js` uses imports; `window.shellEnsure/fsEnsure/currentView` globals deleted
- [ ] Shared `dom.js` + `notes/markdown.js` (sanitizer)
- [ ] `marked.min.js` stays vendored classic script (`window.marked`)
- [ ] Lazy dynamic `import()` for shell/files routes
- [ ] **Gate:** UI smoke identical to M0 baseline, zero console errors, SLOC gate on every css/js file

### M5 — Test suite (pytest + ruff green)
- [ ] `tests/conftest.py` (tmp `DATA_DIR`/`FS_HOME` via env config)
- [ ] `test_notes_api`, `test_schedule_api`
- [ ] `test_telemetry` (ring buffer, dense history nulls, stale→503)
- [ ] `test_fs_api` (traversal, delete guards, upload collision→409, symlink delete)
- [ ] `test_shell_api` (bad-ID rejection, dims clamping)
- [ ] `test_ws_frames`, `test_handshake`
- [ ] `test_macos_metrics` (missing power ≠ 0 W)
- [ ] `test_tmux` (mocked `subprocess.run`: gone-detection, error mapping)
- [ ] `verify.py` assertions migrated; `verify.py` deleted; README updated
- [ ] **Gate:** `make check` green; every llm.txt route has ≥1 test

### M6 — Performance pass
- [ ] `/api/stats`: parsed-JSON cache keyed on `(mtime, size)` — measure before/after
- [ ] `/api/stats/history`: 1s TTL cache keyed by `seconds` + compact JSON — measure payload
- [ ] `/api/fs/list`: entry cap (2,000) + `truncated` flag
- [ ] Static: `immutable` for fonts/vendor, `no-cache` for `index.html`/`config.json`; optional gzip
- [ ] Frontend regression check: 1s poll gating, change-gated writes, idle pause, `?freezebg=1` probe
- [ ] **Gate:** before/after numbers recorded for stats latency, history size, echo round-trip, idle tab CPU; no regressions

### M7 — Closeout: git-commit ready
- [ ] README rewritten (layout, make targets, services note)
- [ ] `static/llm.txt` consistency pass (`truncated` field, sanitizer note)
- [ ] `__pycache__` purged; `git status --ignored` dry-run audit
- [ ] Full `make check`; fresh-clone smoke (venv → `make check` → `make run`)
- [ ] Optional annotated tag
- [ ] **Gate:** fresh clone works from README alone; `git status` clean; every file ≤ 300 SLOC

---

## Known-issue register (found during code study)

| # | Where | Issue | Fixed in |
|---|---|---|---|
| 1 | `app.py` brief_list / schedule_list | `int(request.args.get("limit", …))` raises → HTTP 500 on garbage input | fixed in M1 (`26e51cd`) |
| 2 | `app.py` `fetch_note`/`upsert_note`/`delete_note` | `assert` used for table whitelist — stripped under `python -O` | fixed in M1 (`26e51cd`) |
| 3 | `static/index.html` preview renderers (×2) | XSS sanitize = `<script>`-regex only; misses `onerror=`, `javascript:` | fixed in M1 (`26e51cd`) |
| 4 | `app.py` | Unused imports (`secrets`, …), `import json` mid-file | fixed in M1 (`26e51cd` + `fff7147` for shell_ws/shell_common) |
| 5 | `telemetry_collector.py` | Imports `app` → Flask + `init_db()` run in the sampler process | fixed in M2 (`0de0d59`): collector imports no Flask/app; loop moved to `dashboard/collector.py`; calls `dashboard.db.init_db()` explicitly |
| 6 | `shell_common.py` | `sh -c` string interpolation for subprocesses (safe today via regex, fragile pattern) | M3 |
| 7 | `shell_common.ensure_session` | Fixed `time.sleep(0.6)` blocks a worker thread | fixed in M2 (`7b641e0`): bounded capture-retry (~1s max, returns as soon as the pane paints) |
| 8 | `verify.py` | Tests by monkeypatching module globals (`app.DATA_DIR`, `app.FS_HOME`) | env-config fixed in M1 (`26e51cd`): env set before import; pytest migration in M5 |
| 9 | `app.py` `/api/stats` | Re-reads + re-parses `latest-stats.json` on every request | M6 |
| 10 | `app.py` `/api/fs/list` | Unbounded directory listing → potentially huge JSON | M6 |
| 11 | repo | No git repo, no `.gitignore`, no lint/format config, `__pycache__` present | M0 / M1 |

---

## Progress log

- **2026-10-03** — Plan drafted from full code study (`app.py` 855 SLOC, `shell_ws.py` 406,
  `shell_common.py` 214, `static/index.html` 4,067, plus collectors/deploy). Decisions locked:
  no-build ES modules; pytest + ruff. `REFACTOR_PLAN.md` + this tracker created. No code
  changes made.
- **2026-10-03** — **M0 done.** `git init` (branch `main`) + `.gitignore`; verified `data/`,
  `.venv/`, `__pycache__/` are ignored and unstaged; single baseline commit of the tree as-is
  (`e3d1128`, 28 files — no source edits). `verify.py` green before and after. `data/briefs.db`
  (+`-wal`/`-shm`) confirmed untracked. Manual browser smoke checklist recorded for the human.
- **2026-10-03** — **M1 done.** Bug fixes (safe `?limit=` → 400; explicit note-table validation;
  import cleanup), security (`sanitizeHtml()` shared by both previews; `MAX_CONTENT_LENGTH`),
  env-overridable config + `verify.py` stops monkeypatching, and tooling (`pyproject.toml`,
  `requirements-dev.txt`, `Makefile`, ruff lint/format over the Python sources). `verify.py`
  green before/after every step; `ruff check .` + `ruff format --check .` clean; `make check`
  exits 0 (SLOC gate non-strict). Sanitizer verified in headless Chrome against 19 cases
  (dangerous elements/handlers/schemes stripped; task-list checkboxes preserved). Commits
  `26e51cd` (fix) + `fff7147` (chore). Manual browser smoke remains for the human.
- **2026-10-03** — **M2 done (7 commits).** `app.py` 927 → 8 SLOC behind
  `dashboard.create_app()`; package split leaf-first (config/db/dates → notes → telemetry →
  fs → shell → factory). Collector (`0de0d59`) imports no Flask/app: loop lives in
  `dashboard/collector.py`, root `telemetry_collector.py` is a thin launcher, and the schema
  is created explicitly via `db.init_db()`. SQLite now reuses one connection per app context
  via `flask.g` (+teardown close) while `get_db()` still works outside a request; WAL is set
  once at init and `busy_timeout`/`synchronous=NORMAL` per connection. `ensure_session`'s
  fixed 0.6s sleep became a bounded capture-retry (`7b641e0`). `verify.py` green at every one
  of the 7 commits (checked in a throwaway worktree); `make check` exits 0; `make sloc
  STRICT=1` now fails only on `shell_ws.py` + `static/index.html` (M3/M4). Scratch gunicorn on
  `127.0.0.1:5599` matched every `llm.txt` shape (brief/schedule/stats/history/fs/shell) and a
  3s live collector run wrote 2 telemetry rows + `latest-stats.json` ({t, platform, cpu, mem,
  power}). Live service restart left for the human.

## Decision log

- **2026-10-03** — Frontend split = no-build ES modules (no bundler/npm; stack stays offline).
  Rationale: vendored `marked.min.js` already works as a classic script; deploy story unchanged.
- **2026-10-03** — Tooling = pytest + ruff + SLOC gate in `make check`.
- **2026-10-03** — Root entry points (`app.py`, `telemetry_collector.py`, `shell_ws.py`) frozen
  in place so the installed LaunchDaemons keep working without reinstallation.
- **2026-10-03** — **Resolves open-question #1 (provisional):** `deploy/*.py` is treated as
  untouched ops tooling and excluded from ruff lint/format (`[tool.ruff] exclude = ["deploy"]`).
  It is install/rehearsal scaffolding, not dashboard code; keeping it out of scope avoids
  churn in scripts the plan never touches. Revisit only if M7 housekeeping wants it linted.
- **2026-10-03** — Upload cap defaults to 1024 MB (`DASH_MAX_UPLOAD_MB`), generous enough not to
  disturb normal Files-tab uploads while bounding body size; over-limit requests get a plain
  413 `{"error": …}` via a Flask error handler.
- **2026-10-03 (M2)** — Collector loop lives in `dashboard/collector.py`; root
  `telemetry_collector.py` is a thin `main()` launcher. Keeps the plist entry point frozen and
  makes the sampler's import graph small; `main()` is guarded so importing the launcher never
  starts sampling.
- **2026-10-03 (M2)** — Flask is imported lazily inside `create_app()` and inside
  `db.get_db()`/`db.close_db()`. This keeps `import dashboard.collector` (and every submodule it
  pulls) Flask-free — the existing test client and gunicorn paths still import Flask normally.
- **2026-10-03 (M2)** — `db.get_db()` returns a `flask.g`-cached connection inside an app context
  (closed by `teardown_appcontext`) and a fresh connection with no app context, so the collector
  can use the DB directly. `record_telemetry_snapshot` opens `db.connect()`/closes explicitly.
- **2026-10-03 (M2)** — SQLite pragmas: `journal_mode=WAL` is persistent and set once in
  `init_db()`; `busy_timeout=5000` and `synchronous=NORMAL` are per-connection and applied in
  `connect()`.
- **2026-10-03 (M2)** — `fs.py` exceeded the 300-SLOC ceiling with helpers + operations, so the
  pure path/metadata helpers (`fs_norm`, `fs_safe_name`, `fs_entry`, `fs_places`, `fs_body_path`,
  `fs_error`) live in `dashboard/fs_paths.py` and the operations stay in `dashboard/fs.py`.
- **2026-10-03 (M2)** — `macos_metrics.py` moved to `dashboard/macos_metrics.py` (pure mapping,
  unchanged); the collector imports it from the package.

## Commit log

_(one entry per commit: `sha  milestone  message`)_

- `e3d112815a5a607e5f5bdce70aea759cd9ba56db`  **M0**  `chore: import macmini dashboard as-is (pre-refactor baseline)`
- `26e51cda3df46209306028ab6e842408cd4e6dc1`  **M1**  `fix: harden limit parsing, note-table validation, uploads, and config`
- `fff7147feda2e6d282f824fc2d54f8c2fbc3076d`  **M1**  `chore: add ruff/pytest tooling, Makefile, and format sources`
- `ecbc023f1aa89b5245d7d2e6930c257e73606357`  **M2**  `refactor: extract dashboard config/db/dates`
- `4eb17e928b382b64bf24e1f249381dc005b325dd`  **M2**  `refactor: extract notes store and api`
- `0de0d593bb399b74d2921bf7d0486d9de973a41b`  **M2**  `refactor: extract telemetry store and decouple collector`
- `e048d2cc693d15133a78222d72bb1669f35d702c`  **M2**  `refactor: extract filesystem module and api`
- `13dae634cb57c8bfa464435840e727c1bfd2b031`  **M2**  `refactor: extract shell api blueprint`
- `7b641e011e3c70e7e934e73d65bf767351ef4f81`  **M2**  `perf: replace ensure_session fixed sleep with bounded capture-retry`
- `e6d7a3d0aaf8a237c4ed177d376a0fa33ffe67a7`  **M2**  `refactor: add app factory and thin entrypoint`

## Open questions

- [x] **Decided (provisional, 2026-10-03, M1):** `deploy/*.py` (`prepare.py`, `stop-rehearsal.py`)
      stays untouched ops tooling and is excluded from ruff via `[tool.ruff] exclude = ["deploy"]`.
      Not deleted — left here as a record; revisit only if M7 housekeeping reopens it.
- [ ] Tag name preference at M7 closeout, if any?
