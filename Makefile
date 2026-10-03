# macmini arr-dashboard developer tasks.
#
# SLOC gate: no tracked source file may exceed $(SLOC_LIMIT) lines. Until M2/M4
# decompose app.py and static/index.html the gate runs NON-STRICT by default —
# `make sloc` prints every over-budget file and still exits 0. `make sloc
# STRICT=1` exits non-zero on any violation. After M2/M4 lands, flip the
# default to strict (make check will then fail on an over-budget file).

PYTHON     ?= .venv/bin/python
RUFF       ?= .venv/bin/ruff
PYTEST     ?= .venv/bin/pytest
GUNICORN   ?= .venv/bin/gunicorn
SLOC_LIMIT ?= 300
STRICT     ?=

.PHONY: check lint format test run verify sloc

# Full gate: lint + format check + tests + SLOC budget.
check:
	$(RUFF) check .
	$(RUFF) format --check .
	$(PYTEST) || test $$? -eq 5
	$(MAKE) sloc

lint:
	$(RUFF) check .

format:
	$(RUFF) format .

test:
	$(PYTEST) || test $$? -eq 5

# Run the same way the LaunchDaemon does.
run:
	$(GUNICORN) --workers 1 --threads 8 --bind 0.0.0.0:5555 app:app

verify:
	$(PYTHON) verify.py

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
		if [ -n "$(STRICT)" ]; then \
			echo "sloc: FAIL — files over $$limit lines (STRICT=1)"; exit 1; \
		else \
			echo "sloc: over-budget files listed above (non-strict; strict by default after M2/M4)"; \
		fi; \
	else \
		echo "sloc: all tracked source files <= $$limit lines"; \
	fi
