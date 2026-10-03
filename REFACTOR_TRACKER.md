# Refactor Tracker: macmini arr-dashboard

Running tracker for the work planned in `REFACTOR_PLAN.md`. Update as work proceeds:
check items off, log commits and decisions at the bottom, and keep the status block current.

---

## Status

| Field | Value |
|---|---|
| Phase | Not started |
| Current milestone | — |
| Last updated | 2026-10-03 (plan written, no code changes yet) |
| Blocking on | Green light to execute |

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked/issue

---

## Milestones

### M0 — Git baseline & safety net
- [ ] `git init` + `.gitignore` (`data/`, `.venv/`, `__pycache__/`, `*.pyc`, `.DS_Store`, `deploy/rehearsal-pids.json`, `*.log`)
- [ ] Baseline commit of the tree as-is
- [ ] Smoke checklist recorded (four tabs, graphs, alerts, terminal echo/resize/reconnect, files CRUD/upload)
- [ ] `verify.py` green before proceeding
- [ ] **Gate:** `git status` clean, `data/` untracked, `verify.py` passes

### M1 — Best practices, latent bugs, tooling
- [ ] Safe `?limit=` parsing (400 instead of 500 on garbage input)
- [ ] Replace `assert` table-whitelist with explicit validation
- [ ] Clean imports (unused `secrets`, mid-file `import json`, etc.)
- [ ] Single `sanitizeHtml()` for both markdown previews (script/style, `on*=`, `javascript:`/`data:`)
- [ ] `MAX_CONTENT_LENGTH` upload bound
- [ ] Env-overridable config (`DASH_DATA_DIR`, `DASH_FS_HOME`, `DASH_DB_PATH`)
- [ ] `pyproject.toml` (ruff lint + format, py3.11, line-length 100)
- [ ] `requirements-dev.txt` (pytest, ruff) + `Makefile` (`check` / `run` / `sloc`)
- [ ] **Gate:** `ruff check .` clean, `verify.py` green, manual smoke passes

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
| 1 | `app.py` brief_list / schedule_list | `int(request.args.get("limit", …))` raises → HTTP 500 on garbage input | M1 |
| 2 | `app.py` `fetch_note`/`upsert_note`/`delete_note` | `assert` used for table whitelist — stripped under `python -O` | M1 |
| 3 | `static/index.html` preview renderers (×2) | XSS sanitize = `<script>`-regex only; misses `onerror=`, `javascript:` | M1 |
| 4 | `app.py` | Unused imports (`secrets`, …), `import json` mid-file | M1 |
| 5 | `telemetry_collector.py` | Imports `app` → Flask + `init_db()` run in the sampler process | M2 |
| 6 | `shell_common.py` | `sh -c` string interpolation for subprocesses (safe today via regex, fragile pattern) | M3 |
| 7 | `shell_common.ensure_session` | Fixed `time.sleep(0.6)` blocks a worker thread | M2 |
| 8 | `verify.py` | Tests by monkeypatching module globals (`app.DATA_DIR`, `app.FS_HOME`) | M1 env-config / M5 pytest |
| 9 | `app.py` `/api/stats` | Re-reads + re-parses `latest-stats.json` on every request | M6 |
| 10 | `app.py` `/api/fs/list` | Unbounded directory listing → potentially huge JSON | M6 |
| 11 | repo | No git repo, no `.gitignore`, no lint/format config, `__pycache__` present | M0 / M1 |

---

## Progress log

- **2026-10-03** — Plan drafted from full code study (`app.py` 855 SLOC, `shell_ws.py` 406,
  `shell_common.py` 214, `static/index.html` 4,067, plus collectors/deploy). Decisions locked:
  no-build ES modules; pytest + ruff. `REFACTOR_PLAN.md` + this tracker created. No code
  changes made.

## Decision log

- **2026-10-03** — Frontend split = no-build ES modules (no bundler/npm; stack stays offline).
  Rationale: vendored `marked.min.js` already works as a classic script; deploy story unchanged.
- **2026-10-03** — Tooling = pytest + ruff + SLOC gate in `make check`.
- **2026-10-03** — Root entry points (`app.py`, `telemetry_collector.py`, `shell_ws.py`) frozen
  in place so the installed LaunchDaemons keep working without reinstallation.

## Commit log

_(to be filled during execution — one entry per commit: `sha  milestone  message`)_

## Open questions

- [ ] Should `deploy/prepare.py` / `stop-rehearsal.py` be reformatted/ruff-cleaned too, or
      treated as untouched ops tooling? (Plan currently leaves them as-is.)
- [ ] Tag name preference at M7 closeout, if any?
