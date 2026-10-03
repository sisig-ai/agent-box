# Refactor Tracker: macmini arr-dashboard

Running tracker for the work planned in `REFACTOR_PLAN.md`. Update as work proceeds:
check items off, log commits and decisions at the bottom, and keep the status block current.

---

## Status

| Field | Value |
|---|---|
| Phase | In progress |
| Current milestone | M1 complete — M2 not started |
| Last updated | 2026-10-03 (M1: bug/security/config fixes + ruff/pytest/Makefile tooling; `ruff check .` and `make check` clean, `verify.py` green; manual browser smoke pending for the human) |
| Blocking on | — (M1 gate met; manual browser smoke pending for the human) |

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

### M2 — Backend decomposition (app.py 855 → package)
- [ ] `dashboard/config.py`, `db.py`, `dates.py` extracted
- [ ] `notes.py` + `notes_api.py` extracted
- [ ] `telemetry_store.py` + `telemetry_api.py` extracted; collector no longer imports Flask
- [ ] `fs.py` + `fs_api.py` extracted
- [ ] `shell/api.py` extracted (routes only)
- [ ] `create_app()` factory; root `app.py` → thin gunicorn entry
- [ ] SQLite: `flask.g` connection reuse, PRAGMAs once at init, `synchronous=NORMAL`
- [ ] `ensure_session`: `sleep(0.6)` → bounded capture-retry
- [ ] **Gate:** llm.txt unchanged, `wc -l` gate passes, `launchctl kickstart` (no plist edits) restores all three services

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
| 5 | `telemetry_collector.py` | Imports `app` → Flask + `init_db()` run in the sampler process | M2 |
| 6 | `shell_common.py` | `sh -c` string interpolation for subprocesses (safe today via regex, fragile pattern) | M3 |
| 7 | `shell_common.ensure_session` | Fixed `time.sleep(0.6)` blocks a worker thread | M2 |
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

## Commit log

_(one entry per commit: `sha  milestone  message`)_

- `e3d112815a5a607e5f5bdce70aea759cd9ba56db`  **M0**  `chore: import macmini dashboard as-is (pre-refactor baseline)`
- `26e51cda3df46209306028ab6e842408cd4e6dc1`  **M1**  `fix: harden limit parsing, note-table validation, uploads, and config`
- `fff7147feda2e6d282f824fc2d54f8c2fbc3076d`  **M1**  `chore: add ruff/pytest tooling, Makefile, and format sources`

## Open questions

- [x] **Decided (provisional, 2026-10-03, M1):** `deploy/*.py` (`prepare.py`, `stop-rehearsal.py`)
      stays untouched ops tooling and is excluded from ruff via `[tool.ruff] exclude = ["deploy"]`.
      Not deleted — left here as a record; revisit only if M7 housekeeping reopens it.
- [ ] Tag name preference at M7 closeout, if any?
