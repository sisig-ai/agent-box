# macmini arr-dashboard developer tasks.
#
# SLOC gate: no tracked source file may exceed $(SLOC_LIMIT) lines. Strict by
# default now that the M2/M4 decomposition landed — `make check` fails on any
# over-budget file. `make sloc SLOC_STRICT=0` lists violations and still exits 0.

PYTHON     ?= .venv/bin/python
RUFF       ?= .venv/bin/ruff
PYTEST     ?= .venv/bin/pytest
GUNICORN   ?= .venv/bin/gunicorn
SLOC_LIMIT ?= 400
SLOC_STRICT ?= 1
# Files that predate the budget get an explicit ceiling instead of an exclusion,
# so they still fail if they grow. Keep these numbers honest: lowering them is
# the point. docs.js carries the explorer modes and the editor in one module and
# is the next split candidate; the cap moves only with a matching change.
SLOC_EXEMPT ?= static/js/kanban/board.js:530 static/index.html:560 \
	dashboard/progress.py:470 static/js/docs/docs.js:510

NPM        ?= npm
ESLINT     ?= npx eslint

.PHONY: check lint lint-js format test run verify sloc

# Full gate: backend lint + format, frontend lint, tests on both sides, budget.
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

lint-js:
	@test -d node_modules || { echo "lint-js: run \`npm ci\` first (eslint lives there)"; exit 1; }
	$(ESLINT) static/js tests --max-warnings 0

format:
	$(RUFF) check --fix .
	$(RUFF) format .
	$(NPM) run format

test:
	$(PYTEST)
	node --test tests/*.test.mjs

# Run the same way the LaunchDaemon does.
run:
	$(GUNICORN) --workers 1 --threads 8 --bind 0.0.0.0:5555 app:app

# Kept as an alias for old muscle memory; the load-bearing gate is `make check`.
verify: test

sloc:
	@limit=$(SLOC_LIMIT); over=0; \
	files=$$(git ls-files '*.py' '*.js' '*.css' '*.html' \
		| grep -vE '^(deploy/|static/vendor/|static/fonts/|\.venv/|__pycache__/)'); \
	for f in $$files; do \
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
