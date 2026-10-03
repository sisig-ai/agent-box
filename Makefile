# macmini arr-dashboard developer tasks.
#
# SLOC gate: no tracked source file may exceed $(SLOC_LIMIT) lines. Strict by
# default now that the M2/M4 decomposition landed — `make check` fails on any
# over-budget file. `make sloc SLOC_STRICT=0` lists violations and still exits 0.

PYTHON     ?= .venv/bin/python
RUFF       ?= .venv/bin/ruff
PYTEST     ?= .venv/bin/pytest
GUNICORN   ?= .venv/bin/gunicorn
SLOC_LIMIT ?= 300
SLOC_STRICT ?= 1

.PHONY: check lint format test run verify sloc

# Full gate: lint + format check + tests + SLOC budget.
check:
	$(RUFF) check .
	$(RUFF) format --check .
	$(PYTEST)
	$(MAKE) sloc

lint:
	$(RUFF) check .

format:
	$(RUFF) format .

test:
	$(PYTEST)

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
		if [ "$$n" -gt "$$limit" ]; then \
			echo "  $$n  $$f"; over=1; \
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
