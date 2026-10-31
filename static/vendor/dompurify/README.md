# DOMPurify

- Version: 3.2.6
- Source: https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js
- License: Apache-2.0 OR MPL-2.0 (see `LICENSE`)

Vendored file: `purify.min.js` (UMD; sets `window.DOMPurify`).

The Kanban card modal (`static/js/kanban/markdown.js`) loads it lazily on first
open and sanitizes every rendered card body with it (falling back to the
denylist sanitizer in `static/js/notes/markdown.js` if the script fails to load).
`/static/vendor/` is served immutable, so an upgrade must change the asset URL:
bump `PURIFY_VERSION` in `static/js/kanban/markdown.js`.
