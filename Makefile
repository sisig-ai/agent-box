# macmini arr-dashboard developer tasks.
#
# SLOC gate: no tracked source file may exceed $(SLOC_LIMIT) lines. Strict by
# default now that the M2/M4 decomposition landed — `make check` fails on any
# over-budget file. `make sloc SLOC_STRICT=0` lists violations and still exits 0.

PYTHON     ?= .venv/bin/python
RUFF       ?= .venv/bin/ruff
PYTEST     ?= .venv/bin/pytest
UVICORN    ?= .venv/bin/uvicorn
TSC        ?= frontend/node_modules/.bin/tsc
NEXT       ?= frontend/node_modules/.bin/next
SLOC_LIMIT ?= 400
SLOC_STRICT ?= 1
# Files that predate the budget get an explicit ceiling instead of an exclusion,
# so they still fail if they grow. Keep these numbers honest: lowering them is
# the point. The Next.js view modules are component-sized like the old page
# panels; the biggest (tables, docs, telemetry) carry explicit ceilings.
SLOC_EXEMPT ?= dashboard/progress.py:500 \
	dashboard/mcp/tools_board.py:450 \
	dashboard/mcp/tools_docs.py:450 \
	frontend/src/components/views/tables-view.tsx:1400 \
	frontend/src/components/views/kanban-view.tsx:1100 \
	frontend/src/components/views/docs-view.tsx:1000 \
	frontend/src/components/views/telemetry-cards.tsx:950 \
	frontend/src/components/views/files-view.tsx:750 \
	frontend/src/components/views/sitrep-view.tsx:500 \
	frontend/src/components/views/progress-view.tsx:550 \
	frontend/src/components/views/kanban/card-modal.tsx:650 \
	frontend/src/components/views/kanban.css:1200 \
	frontend/src/components/views/telemetry.css:800 \
	frontend/src/components/docs.css:800 \
	frontend/src/components/tables.css:700 \
	frontend/src/components/sitrep.css:600 \
	frontend/src/components/files.css:600

NPM        ?= npm

.PHONY: check lint lint-js build-frontend format test run verify sloc

# Full gate: backend lint + format, frontend typecheck, tests on both sides, budget.
check:
	$(RUFF) check .
	$(RUFF) format --check .
	$(MAKE) lint-js
	$(PYTEST)
	node --test tests/*.test.mjs
	$(MAKE) sloc

lint:
	$(RUFF) check .
	$(RUFF) format --check .

# The UI is a Next.js static export; its gate is the TypeScript compiler.
lint-js:
	@test -x "$(TSC)" || { echo "lint-js: run \`cd frontend && npm install\` first"; exit 1; }
	cd frontend && node_modules/.bin/tsc --noEmit -p tsconfig.json

# Build the static export the ASGI app serves from frontend/out.
build-frontend:
	cd frontend && npm run build

format:
	$(RUFF) check --fix .
	$(RUFF) format .

test:
	$(PYTEST)
	node --test tests/*.test.mjs

# Run the same way the LaunchDaemon does.
run:
	$(UVICORN) app:app --host 0.0.0.0 --port 5555 --workers 1

# Kept as an alias for old muscle memory; the load-bearing gate is `make check`.
verify: test

sloc:
	@limit=$(SLOC_LIMIT); over=0; \
	files=$$( (git ls-files '*.py' '*.js' '*.css' '*.html' '*.tsx' '*.ts'; \
		git ls-files --others --exclude-standard -- 'frontend/src/*.ts' 'frontend/src/*.tsx' 'frontend/src/*.css') \
		| grep -vE '^(deploy/|static/vendor/|static/fonts/|\.venv/|__pycache__/)' | sort -u \
		| while read -r f; do [ -f "$$f" ] && echo "$$f"; done); \
	for f in $$files; do \
		case "$$f" in \
			frontend/src/components/block/*) continue;; \
		esac; \
		n=$$(wc -l < "$$f" | tr -d ' '); \
		f_limit=$$limit; \
		for pair in $(SLOC_EXEMPT); do \
			case "$$pair" in \
				"$$f":*) f_limit=$${pair##*:} ;; \
			esac; \
		done; \
		if [ "$$n" -gt "$$f_limit" ]; then \
			echo "  $$n  $$f  (limit $$f_limit)"; over=1; \
		fi; \
	done; \
	if [ "$$over" -eq 1 ]; then \
		if [ "$(SLOC_STRICT)" != "0" ]; then \
			echo "sloc: FAIL — files over $$limit lines (SLOC_STRICT=0 to warn only)"; exit 1; \
		else \
			echo "sloc: over-budget files listed above (SLOC_STRICT=0)"; \
		fi; \
	else \
		echo "sloc: all tracked source files <= $$limit lines"; \
	fi
