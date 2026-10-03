# Refactor Tracker: macmini arr-dashboard

Running tracker for the work planned in `REFACTOR_PLAN.md`. Update as work proceeds:
check items off, log commits and decisions at the bottom, and keep the status block current.

---

## Status

| Field | Value |
|---|---|
| Phase | Complete |
| Current milestone | M7 complete — refactor closed (M0–M7) |
| Last updated | 2026-10-03 (M7: README rewritten, llm.txt synced, Dockerfile COPY corrected, caches purged, fresh-clone smoke green from `7d04ed4`; 184 tests; `make check` green) |
| Blocking on | — (nothing; services restarted post-M7 and the manual browser smoke passed 2026-10-03) |

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
(baseline reference for M4 "UI smoke identical to M0"; the automated M4/M7 headless-Chrome and
fresh-clone smokes cover the automated portion):
- [x] Four tabs (`Brief`, `Stack`, `Files`, `Shell`) switch via the header nav — human pass 2026-10-03
- [x] Graphs render and update on the 1s telemetry poll — human pass 2026-10-03
- [x] Alerts show/clear correctly — human pass 2026-10-03
- [x] Terminal: echo latency, resize, reconnect (WS backoff) — human pass 2026-10-03
- [x] Files: CRUD + upload — human pass 2026-10-03

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
- [x] `shell_common.py` → `dashboard/shell/tmux.py` with argv-list subprocess calls (`41df4f7`)
- [x] `paste_text`: nested-sh exit-code dance → three explicit tmux calls (`41df4f7`)
- [x] `shell_ws.py` → `dashboard/ws/{frames,handshake,session,server}.py` (`df4dfe9`)
- [x] Root `shell_ws.py` → thin `serve()` runner (12 SLOC) (`df4dfe9`)
- [x] Unit tests: frame round-trip over socketpair, handshake parsing (23 tests) (`2d3c86d`)
- [x] **Gate:** live terminal e2e (echo latency, resize, New, kill, WS reconnect with backoff) — scratch gateway on `127.0.0.1:5598`, sid `m3e2e1`: hello → `echo m3ok` pane → key `C-l` → resize 90×25 → `new` (recreated, dims preserved) → clean close → reconnect reattached; `verify.py` green at every commit (throwaway worktree); `make check` 0; `make sloc STRICT=1` fails only on `static/index.html` (M4 scope)

### M4 — Frontend decomposition (no-build ES modules)
- [x] CSS → `static/css/*.css` (section-marker splits, `<link>` order preserved) — smoke before any JS (`34da8f3`)
- [x] JS IIFEs → `static/js/**` ES modules in existing init order (`80a7394`)
- [x] `router.js` uses dynamic `import()`; `window.shellEnsure/fsEnsure/currentView` globals deleted (`3059a52`)
- [x] Shared `dom.js` (`$`, `esc`, change-gated `setTxt`/`setBar`) + `notes/markdown.js` (M1 sanitizer + render helper)
- [x] `marked.min.js` stays vendored classic script (`window.marked`) loaded before the modules
- [x] Lazy dynamic `import()` for shell/files routes (promise cached; second visit a no-op)
- [x] **Gate:** UI smoke identical to M0 baseline, zero console errors, SLOC gate on every css/js file
  (`make sloc STRICT=1` fully green; headless Chrome smoke against scratch gunicorn `:5599`: 25/25
  checks, JS console errors=0 warnings=0 exceptions=0)

### M5 — Test suite (pytest + ruff green)
- [x] `tests/conftest.py` (per-test tmp `DATA_DIR`/`DB_PATH`/`FS_HOME` via monkeypatched config constants; the `FS_HOME` bound imports in `dashboard.fs`/`fs_paths` patched too; telemetry throttle reset per test)
- [x] `test_notes_api`, `test_schedule_api`
- [x] `test_telemetry` (ring buffer + 1s throttle, retention delete, dense history nulls/offsets, mem_total, seconds clamp, stale→503)
- [x] `test_fs_api` (list/stat, mkdir/touch/rename/upload/download, home + root delete guards, symlink delete-removes-link)
- [x] `test_shell_api` (bad-ID rejection, status mapping, dims clamping; backend mocked)
- [x] `test_ws_frames`, `test_ws_handshake` (M3) + `test_ws_session` (dispatch, error frames)
- [x] `test_macos_metrics` (missing power ≠ 0 W, SMC/IOReport source, temp bounds, mem math)
- [x] `test_tmux` (mocked `subprocess.run`: argv shape, gone-detection, error mapping, timeouts)
- [x] `test_dates`, `test_static_and_routes`
- [x] `verify.py` assertions migrated; `verify.py` deleted; README points at `make check`; `make sloc` strict by default (`SLOC_STRICT=0` escape hatch)
- [x] **Gate:** `make check` green twice back to back (174 tests); every llm.txt route has ≥1 test; all files ≤300 SLOC

### M6 — Performance pass
- [x] `/api/stats`: parsed-JSON cache keyed on `(mtime_ns, size)` — parse only when the collector rewrites the file
- [x] `/api/stats/history`: cached payload keyed on `(seconds, current second, max ts, row count)` + compact JSON verified
- [x] `/api/fs/list`: entry cap (2,000) + additive `truncated` flag; `total` = entries returned
- [x] Static: `immutable` for fonts/vendor, `no-cache` for `index.html`/`config.json`; gzip dropped (no new deps)
- [x] Frontend regression check: no `static/` diff in M6, so the 1s poll, change-gated writes, idle pause, and `?freezebg=1` probe cannot regress; ws echo path untouched
- [x] Impossible well-formed week date (`2026-02-30`) rejected with the existing 400 instead of a 500
- [x] **Gate:** before/after tables recorded (baseline on the `def3c5f` worktree, same seed + scratch gunicorn `127.0.0.1:5599`); `make check` green twice; every file ≤300 SLOC

M6 bench (`tools/bench_m6.py run`, 200 requests, 5 warmups, one scratch server per arm; seed =
3900 telemetry rows + 466-byte `latest-stats.json` + a 5000-entry directory):

| endpoint | arm | p50 ms | p95 ms | response bytes |
|---|---|---|---|---|
| `/api/stats` | before | 0.47 | 0.61 | 445 |
| `/api/stats` | after | 0.46 | 0.58 | 445 |
| `/api/stats/history?seconds=3600` | before | 6.65 | 8.76 | 115,273 |
| `/api/stats/history?seconds=3600` | after | 2.23 | 2.54 | 115,203 |
| `/api/fs/list` (5000 entries) | before | 125.50 | 131.44 | 1,374,266 |
| `/api/fs/list` (5000 entries) | after | 123.09 | 129.70 | 550,082 |

`/api/stats` p50 is flat: at a 466-byte file the parse is far below the HTTP noise floor, so the
cache's win is the eliminated file read + parse per request, not latency (pinned by the
`test_stats_parse_is_cached_between_requests` count). History p50 drops ~3×; fs/list payload drops
2.5× while latency stays flat (the scan/stat of all 5000 entries dominates, and the sort-then-slice
order is required to keep the listing deterministic).

### M7 — Closeout: git-commit ready
- [x] README rewritten for the modular layout: intro + ports, layout map (root entry points,
      `dashboard/`, `static/`, `tests/`, `deploy/`), `make check`/`run`/`test`/`lint`/`format`,
      env vars (`DASH_DATA_DIR`, `DASH_DB_PATH`, `DASH_FS_HOME`, `DASH_MAX_UPLOAD_MB`), services
      section (install + kickstart + inspect + logs), `data/` + SQLite note, legacy label on the
      Dockerfile (`8aa69a8`)
- [x] `static/llm.txt` consistency pass: `/api/fs/list` `truncated` + `total` semantics, sanitizer
      note, schedule 400-on-impossible-week line (`72b87a3`)
- [x] `Dockerfile.linux-source` decision — **kept + minimally corrected**: COPY lines now match the
      package layout (`app.py`, `dashboard/`, `shell_ws.py`, `telemetry_collector.py`, `static/`);
      README labels it an unmaintained linux-era reference (`7d04ed4`)
- [x] `__pycache__`/`.pytest_cache`/`.ruff_cache` purged; `git status --ignored` audit clean
      (only `.venv/` + `data/` ignored; nothing untracked)
- [x] Full `make check` (184 tests) + fresh-clone smoke: fresh python3.11 venv, requirements
      install, `make check` green, scratch gunicorn on `127.0.0.1:5599` served `/`,
      `/config.json`, `/api/brief/list`, `/api/fs/list`, `/static/js/main.js` (all 200),
      impossible-week date → 400
- [x] Annotated tag — **none created** (optional item; Kix did not request one)
- [x] **Gate:** fresh clone works from README alone; `git status` clean; every file ≤ 300 SLOC

---

## Known-issue register (found during code study)

| # | Where | Issue | Fixed in |
|---|---|---|---|
| 1 | `app.py` brief_list / schedule_list | `int(request.args.get("limit", …))` raises → HTTP 500 on garbage input | fixed in M1 (`26e51cd`) |
| 2 | `app.py` `fetch_note`/`upsert_note`/`delete_note` | `assert` used for table whitelist — stripped under `python -O` | fixed in M1 (`26e51cd`) |
| 3 | `static/index.html` preview renderers (×2) | XSS sanitize = `<script>`-regex only; misses `onerror=`, `javascript:` | fixed in M1 (`26e51cd`) |
| 4 | `app.py` | Unused imports (`secrets`, …), `import json` mid-file | fixed in M1 (`26e51cd` + `fff7147` for shell_ws/shell_common) |
| 5 | `telemetry_collector.py` | Imports `app` → Flask + `init_db()` run in the sampler process | fixed in M2 (`0de0d59`): collector imports no Flask/app; loop moved to `dashboard/collector.py`; calls `dashboard.db.init_db()` explicitly |
| 6 | `shell_common.py` | `sh -c` string interpolation for subprocesses (safe today via regex, fragile pattern) | fixed in M3 (`41df4f7`): moved to `dashboard/shell/tmux.py`, all calls are direct argv lists (no shell); `capture_pane` = two explicit calls (capture-pane liveness gate + display-message), `paste_text` = load-buffer/paste-buffer/delete-buffer |
| 7 | `shell_common.ensure_session` | Fixed `time.sleep(0.6)` blocks a worker thread | fixed in M2 (`7b641e0`): bounded capture-retry (~1s max, returns as soon as the pane paints) |
| 8 | `verify.py` | Tests by monkeypatching module globals (`app.DATA_DIR`, `app.FS_HOME`) | fixed in M1 (`26e51cd`): env set before import; `verify.py` retired in M5 — assertions migrated to `tests/`, `verify.py` deleted |
| 9 | `app.py` `/api/stats` | Re-reads + re-parses `latest-stats.json` on every request | fixed in M6 (`5c3c213`): parsed dict cached on `(mtime_ns, size)` |
| 10 | `app.py` `/api/fs/list` | Unbounded directory listing → potentially huge JSON | fixed in M6 (`6451348`): 2,000-entry cap + `truncated` flag |
| 11 | repo | No git repo, no `.gitignore`, no lint/format config, `__pycache__` present | M0 / M1 |
| 12 | `dates.week_start_for` | Well-formed but impossible date (`2026-02-30`) raised `ValueError` → HTTP 500 on `/api/schedule` | fixed in M6 (`f1f378a`): `date.fromisoformat` guard → `None` → existing 400 |

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
- **2026-10-03** — **Human restarted the web + telemetry launchd services after M2** (web on
  `:5555`, telemetry collector) while M3 was being built; the shell service was **not** restarted
  and kept serving the pre-M3 code on `:5556`.
- **2026-10-03** — **M3 done (3 commits).** `shell_common.py` (253 SLOC, root) fully moved to
  `dashboard/shell/tmux.py` (282 SLOC) with every tmux call now a direct argv list — no `sh -c`.
  `capture_pane` became two explicit calls (`capture-pane` is the liveness gate; `display-message`
  supplies cursor/dims/cmd) and `paste_text` became load-buffer → paste-buffer → best-effort
  delete-buffer, so paste-buffer's rc is the one propagated without a nested shell. `shell_ws.py`
  (413 SLOC) split into `dashboard/ws/{frames,handshake,session,server}.py` + a 12-SLOC root
  launcher; the protocol surface, cadence constants, close codes, hello fallback and log lines are
  byte-for-byte unchanged. 23 new unit tests (`tests/test_ws_frames.py`,
  `tests/test_ws_handshake.py`) run under plain pytest over `socket.socketpair()` — no Flask, no
  network. `make check` now runs pytest for real (exit-5 tolerance removed). `verify.py` green at
  all 3 commits (checked in a throwaway worktree); `gunicorn --check-config app:app` OK;
  `make sloc STRICT=1` now fails **only** on `static/index.html` (4,079; M4 scope). Scratch-port
  live e2e (`SHELL_WS_HOST=127.0.0.1 SHELL_WS_PORT=5598`) passed: hello → input `echo m3ok`
  pane → key `C-l` → resize 90×25 → `new` → clean close → reconnect reattached; only tmux session
  `dash-m3e2e1` was created and removed (before/after `tmux ls` identical). **Shell service restart
  still pending on the human:** `sudo launchctl kickstart -k system/dev.macmini.dashboard.shell`
  (plus manual browser smoke).

- **2026-10-03** — **M4 done (3 commits).** `static/index.html` 4,079 → **267 SLOC** (DOM only +
  11 ordered `<link>`s + classic `/static/vendor/marked.min.js` + `<script type="module"
  src="/static/js/main.js">`); `make sloc STRICT=1` is now **fully green** (largest source file
  `static/js/telemetry/graphs.js` at 289). **CSS** (`34da8f3`): the 1,765-line `<style>` block
  split 1:1 along its section markers into `static/css/{base,header,telemetry,power-alerts,
  scanner,fleet,brief,schedule,shell,files,modal}.css`, linked in original source order so the
  cascade cannot shift (brief/schedule split the Daily Brief block along its internal
  sub-markers; view-tabs joins shell.css, footer joins modal.css). Font `url()`s were the only
  values rewritten (to `/static/fonts/...`); counts byte-for-byte equal (1,184 `;`, 291 `{`,
  6 `@media`, 3 `@keyframes`, 3 `@font-face`). **JS** (`80a7394`): the ~2,050-line inline script
  extracted into 18 modules, `main.js` importing them in the exact IIFE order (warpfield → stack
  → telemetry/* → router → shell → files → notes/brief → schedule); `window.warp`, both
  localStorage keys, the `?freezebg=1` probe + `bgver` stamp, the 1s `document.hidden`-gated
  poll, `setTxt`/`setBar` memoization, sprite batching + 30/60fps budget + 30s idle pause all
  copied verbatim. **Lazy routes** (`3059a52`): `router.js` dynamic-`import()`s shell/files
  (promise cached) and the old `window.currentView/shellEnsure/fsEnsure` bridges are gone.
  **Verification** — `make check` + `verify.py` + `gunicorn --check-config app:app` green at all
  3 commits; 25/25-check headless-Chrome smoke against a scratch gunicorn on `127.0.0.1:5599`
  (throwaway `DASH_DATA_DIR`/`DASH_FS_HOME`) with a scratch WS gateway on `127.0.0.1:5556`:
  four hash routes incl. lazy tabs, stack grid + search, brief markdown preview with a clickable
  task checkbox that flips the source, autosave state, schedule Monday coercion, files listing +
  new-folder modal, shell `connecting…`→`connected`, telemetry cards + expand, computed-style
  sanity (body `rgb(5,8,20)`, `h1` gradient, FiraCode `fontFamily` + `document.fonts.check`
  true), and `/?freezebg=1` FROZEN tag — **JS console errors=0, warnings=0, uncaught
  exceptions=0** (only expected network 503s from the absent collector). Font URLs from the
  scratch server all 200 `font/woff2`. DOM completeness: **88/88** `id="..."` and **120/120**
  `class="..."` tokens from pre-M4 still present in markup+JS. Lazy behaviour confirmed: the
  shell/files modules are absent from the network log until their tab is first opened.

- **2026-10-03** — **M7 done (closeout, 3 commits).** README rewritten for the modular tree
  (`8aa69a8`); `static/llm.txt` synced with shipped behavior — `/api/fs/list` `truncated` + `total`
  semantics, markdown-preview sanitizer note, impossible-week 400 line (`72b87a3`);
  `Dockerfile.linux-source` COPY lines corrected to the package layout (`7d04ed4`). Housekeeping:
  `__pycache__`/`.pytest_cache`/`.ruff_cache` purged repo-wide and `git status --ignored` is clean
  (only `.venv/` + `data/`). **Fresh-clone smoke green from `7d04ed4`:** temp clone → python3.11
  venv → `pip install -r requirements.txt -r requirements-dev.txt` → `make check` (184 passed, SLOC
  green) → `make test`/`lint`/`format` (43 files unchanged, 0 diff) → scratch `gunicorn` on
  `127.0.0.1:5599` with throwaway `DASH_DATA_DIR`/`DASH_DB_PATH`/`DASH_FS_HOME` served `/`,
  `/config.json`, `/api/brief/list`, `/api/fs/list`, `/static/js/main.js` (all 200) and
  `week=2026-02-30` → 400; the scratch process was stopped and port 5599 is free. `make run` was
  **not** run verbatim — it binds `:5555`, which the live web service owns; the README scratch-bind
  command was run instead. No git tag (not requested). Human ops remaining: manual browser smoke and
  `sudo launchctl kickstart -k system/dev.macmini.dashboard.{web,shell}` to load the M6/M3 code.
- **2026-10-03** — **Session closed.** Kix restarted the web + shell services and ran the manual
  browser smoke: everything passes (four tabs, graphs, alerts, terminal, files). All gates are
  green and no work remains — refactor M0–M7 complete.

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
- **2026-10-03 (M3)** — tmux argv conversion: `capture_pane` uses **two** explicit calls rather
  than one `sh -c` chain — `tmux capture-pane -e -p -t S` is the liveness gate (it fails on a
  missing session) and only on success does `tmux display-message -p -t S '<format>'` run, because
  `display-message -p` echoes its format string with rc 0 on a missing session and can't be the
  probe. A timeout on either call still maps to `{"alive": False, "error": "shell command timed
  out"}`; a nonzero `display-message` rc falls back to gone. `paste_text` uses **three** calls —
  `load-buffer -b B -` (stdin, rc ignored), `paste-buffer -b B -t S` (its rc is authoritative),
  `delete-buffer -b B` (best-effort, failures suppressed) — which preserves the old nested-sh
  exit-code semantics without a shell. `SHELL_ID_RE`/`check_shell_id`/`parse_dims`/`tmux_gone`
  stay byte-identical and every return/status tuple is unchanged.
- **2026-10-03 (M3)** — ws package seam + import order: `server.py` owns `WS_HOST/WS_PORT/WS_PATH`
  and defines them before `serve()`; `serve()` imports `handle_conn` lazily, `session.py` imports
  `STOP`/`log` from `server`, and `handshake.py` imports `WS_PATH` from `server`. This keeps the
  constants in their planned homes without a circular import, and lets tests `import
  dashboard.ws.handshake` standalone.
- **2026-10-03 (M3)** — tests are stdlib-only over `socket.socketpair()` (plain pytest, no Flask,
  no network), matching the M3 acceptance scope (frame round-trip + handshake parsing; broader API
  tests remain M5). `pyproject.toml` got `pythonpath = ["."]` so the repo root is importable
  without an installed package; the new `tests/` dir makes pytest's `testpaths` real.
- **2026-10-03 (M3)** — Makefile exit-5 tolerance **removed** (`$(PYTEST) || test $$? -eq 5` →
  `$(PYTEST)`). It existed only while there were zero tests; now that tests exist, a pytest
  collection/exit-5 problem should fail `make check` instead of being silently tolerated. Noted
  here per the M3 task.
- **2026-10-03 (M4)** — Commit granularity = **3 commits**: (1) CSS-only extraction so cascade
  risk is isolated and smoke-tested before any JS moves; (2) the full JS extraction, which keeps
  `window.currentView/shellEnsure/fsEnsure` as temporary bridges so it is a pure, behavior-
  identical module move; (3) the small lazy-routes + globals-deletion diff. This avoids a broken
  intermediate state while keeping the `router` change reviewable on its own.
- **2026-10-03 (M4)** — Lazy routes: `router.js` uses `import()` with a cached promise
  (`lazy.shell ||= import(...)`), so the shell/files modules are fetched on first tab activation
  and a second visit only re-calls the (idempotent) `initShell`/`initFiles`. No build step.
  Direct landings on `#/shell`/`#/files` are covered by router's initial `apply()` even though
  the module boot is now async (a few-ms difference vs M0, invisible in practice).
- **2026-10-03 (M4)** — Telemetry shared state across the 3-way split: `graphs.js` owns the graph
  registry + `drawGraph`/`feed`/`placeTip`/`ensureHistory`/`toggle` **and** `fmtW`/`WINDOW`;
  `poll.js` imports `graphs`/`feed`/`drawGraph`/`placeTip`/`fmtW` and owns the 1s tick + DOM refs
  + power-tab wiring; `alerts.js` imports `fmtW` and owns the pwr-alert log/badge/`maybePwrAlert`.
  Nothing new is global — the only coupling is ES imports. Import order (`poll` imports `graphs`
  before `alerts`) guarantees the graphs module evaluates first, so the shared `fmtW` binding is
  initialized before `alerts` self-inits.
- **2026-10-03 (M4)** — Files split: `render.js` owns the DOM refs object + mutable `state` and
  every render helper (`setStatus`, table/breadcrumb/places/info/sort); `api.js` owns
  `api()`/`xhrUpload()`; `actions.js` owns navigation + create/rename/delete/upload/drag-drop and
  the one-time `initFiles()` wiring; `modal.js` is the shared promise modal. `render.js` ↔
  `actions.js` form a cycle, which is safe here because cross-references are only used inside
  deferred callbacks and the cross-module functions are hoisted declarations (initialized at
  module instantiation). Shared state moves via `export const state`/`refs`.
- **2026-10-03 (M4)** — `dom.js` exports one `esc` (the `&<>"` superset used by the files UI).
  The terminal's old `esc` only escaped `&<>`; the extra `"`→`&quot;` is a no-op for rendered
  text, so the ANSI output is visually identical while one helper covers both call sites.
- **2026-10-03 (M4)** — Asset paths are root-absolute `/static/...` for the new `<link>`s, the
  module `<script>`, the marked classic script, and the `<link rel="preload">`; extracted CSS
  `url()`s point at `/static/fonts/...` (relative CSS URLs would otherwise resolve against
  `/static/css/`). `marked.min.js` still runs as a classic script before the deferred modules,
  so `window.marked` is ready when the preview modules execute.
- **2026-10-03 (M4)** — Smoke harness: headless Chrome over the DevTools Protocol (Node 22
  globals, no npm/puppeteer) against a **scratch** gunicorn on `127.0.0.1:5599` with throwaway
  `DASH_DATA_DIR`/`DASH_DB_PATH`/`DASH_FS_HOME`, plus a scratch WS gateway bound to
  `127.0.0.1:5556` (the live shell service listens only on the tailscale IP `100.64.149.91:5556`,
  so it was never touched). The only tmux sessions created were `dash-*` ones from the smoke,
  all killed after; the four pre-existing sessions and all launchd services were left alone.
- **2026-10-03 (M5)** — `verify.py` retired in favor of a hermetic pytest suite (174 tests). The
  M1 env config is not needed: `tests/conftest.py` monkeypatches `dashboard.config.DATA_DIR` /
  `DB_PATH` / `FS_HOME` per test and also patches the two modules that bind `FS_HOME` at import
  time (`dashboard.fs`, `dashboard.fs_paths`); `_TELE_LAST_WRITE` is reset per test. No production
  seam was added — `create_app(config_overrides=…)` was **not** needed.
- **2026-10-03 (M5)** — Hermeticity: no real subprocess (tmux mocked at `dashboard.shell.tmux`,
  `dashboard.shell.api`, and `dashboard.ws.session`), no network (socketpair only), and no test
  reads `data/`; the app fixture builds a fresh schema in a `tmp_path` database. `make check`
  runs green twice back to back (the only prior state — the module-level telemetry throttle — is
  reset by the fixture, so there is no order dependence).
- **2026-10-03 (M5)** — Two spec premises did not hold and tests assert the real behavior:
  `fs.make_dir` uses `parents=True`, so a missing parent is created (200), not 404 — the 404
  case is `fs.touch_file`; and `POST /api/shell/new` auto-generates an id when the given one is
  invalid instead of rejecting it (only pane/input/key/resize/kill reject). Latent bug found and
  **not** fixed (test-only scope): `normalize_week("2026-02-30")` raises `ValueError` from
  `date(...)` → 500 on `/api/schedule` for a syntactically valid but impossible date; candidate
  for M6.
- **2026-10-03 (M5)** — `make sloc` is strict by default (`SLOC_STRICT ?= 1`); `make sloc
  SLOC_STRICT=0` still lists violations and exits 0. The old `verify` target is now an alias for
  `test`. `make check` includes tests/, so all test files are inside the 300-SLOC gate (largest
  is `tests/test_fs_api.py` at 296).

- **2026-10-03 (M6)** — Perf pass + the folded-in impossible-date fix. `/api/stats` caches the parsed
  snapshot on `(mtime_ns, size)`; `/api/stats/history` caches the built payload on `(seconds, current
  second, max ts, row count)` — the current second is in the key (a deviation from the plan's wording)
  because the payload's `start` shifts every second, and the version probe makes a new row invalidate
  at once. `/api/fs/list` sorts first, slices to 2,000, and adds `truncated`; `total` still means
  entries returned. Static headers: immutable for fonts/vendor, `no-cache` for `/`, `/index.html`,
  `/config.json`. `week_start_for` now returns `None` for a well-formed but impossible date, so
  `/api/schedule` answers 400 instead of 500. No frontend/ws/shell diff.
- **2026-10-03 (M6)** — Bench (`tools/bench_m6.py`, tracked): baseline captured on a `def3c5f`
  worktree with a scratch gunicorn on `127.0.0.1:5599`, same seed for both arms. History p50
  6.65 → 2.23 ms; fs/list payload 1,374,266 → 550,082 bytes (latency flat — the scan of all entries
  dominates and the deterministic sort-then-slice order is required); `/api/stats` flat at a 466-byte
  file because the parse is below the HTTP noise floor (the cache removes the read + parse per
  request). Tables in the M6 section. `make check` green twice (184 tests); all files ≤300 SLOC.
- **2026-10-03 (M6)** — Module-level caches (`_LATEST_STATS_CACHE`, `_HISTORY_CACHE`) are plain dicts
  (worst case under `--threads 8` is one redundant parse) and are reset per test in `conftest.py`
  alongside `_TELE_LAST_WRITE` for order independence. The bench seed writes a 466-byte snapshot so
  the measurement matches the collector's real output.
- **2026-10-03 (M7)** — `Dockerfile.linux-source` kept and minimally corrected rather than deleted:
  the historical Linux container recipe stays as a reference, but its COPY lines now match the
  package layout (`app.py`, `dashboard/`, `shell_ws.py`, `telemetry_collector.py`, `static/`), so it
  no longer describes a tree that does not exist. README labels it unmaintained. Resolves the
  M3/M5 open question.
- **2026-10-03 (M7)** — No git tag: the optional annotated tag was not requested by Kix; the
  milestone commits are the record.

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
- `41df4f71d5c654acae9aa3c2091920bcb40f3883`  **M3**  `refactor: move tmux backend to dashboard.shell.tmux with argv subprocess`
- `df4dfe9532e672b5715144c55b1777455e3723e2`  **M3**  `refactor: split websocket gateway into dashboard.ws modules`
- `2d3c86d8a6a66a0e4ea809d9f43e030f5b9b6810`  **M3**  `test: add websocket frame and handshake unit tests`
- `34da8f3198f5ff5cb566d6bc03ed78400655cc70`  **M4**  `refactor(css): extract stylesheets from index.html`
- `80a7394c8c10a27bcf2fb472e7f3fdcf24ec00e9`  **M4**  `refactor(js): extract page modules as ES modules`
- `3059a529cdb3215ef9920d4330bd2e17b9195ff1`  **M4**  `refactor(js): lazy-load shell/files routes and drop window globals`
- `76a65f00943be75acac5827cb7d7b7c889557427`  **M5**  `test: add pytest suite covering notes, schedule, telemetry, fs, shell, and metrics`
- `9809837583edc056af9ebf0ba9ecfd1eb2ad3aa3`  **M5**  `test: add ws session dispatch tests`
- `7272fadea556edc1812ff5218ae09123ccb2b595`  **M5**  `chore: retire verify.py and make sloc strict by default`
- `f1f378a3f1a43ac47c525873d581ec28508ef0a2`  **M6**  `fix: reject impossible week dates instead of erroring`
- `5c3c21331d8dd207d094339c3312bd39264c2163`  **M6**  `perf: cache parsed telemetry snapshots`
- `2523ce1f752b3c1676afb408860f68001aa91325`  **M6**  `perf: cache telemetry history responses`
- `645134848cc95e454a1d0c2c4c0071fbcd2cfdb0`  **M6**  `perf: cap directory listings`
- `cb782ee1377a536373a52b32d9766a306c7a69fe`  **M6**  `perf: add static cache-control headers`
- `ad6c9da7c1b19dd3f9f7a8cb57963012a5d8d943`  **M6**  `chore: seed a representative stats snapshot in the m6 bench`
- `8aa69a89d27140371271130f457d1dabd70f709c`  **M7**  `docs: rewrite readme for the modular layout`
- `72b87a32a44e2fc76e9c8fc71a6784bf0bac101e`  **M7**  `docs: sync api doc with shipped behavior`
- `7d04ed42f2211db7c29d8d9563f2239bc7b9bace`  **M7**  `chore: align dockerfile.linux-source copy lines with the package layout`

## Open questions

- [x] **Decided (provisional, 2026-10-03, M1):** `deploy/*.py` (`prepare.py`, `stop-rehearsal.py`)
      stays untouched ops tooling and is excluded from ruff via `[tool.ruff] exclude = ["deploy"]`.
      Not deleted — left here as a record; revisit only if M7 housekeeping reopens it.
- [x] **Decided (2026-10-03, M7):** no tag created — the optional annotated tag was not requested
      by Kix; the milestone commits are the record.
- [x] **Decided (2026-10-03, M7):** `Dockerfile.linux-source` kept and minimally corrected — its
      COPY lines now match the package layout. It stays as an unmaintained Linux-era reference;
      deployment uses the native LaunchDaemons.
