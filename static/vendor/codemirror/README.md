# CodeMirror 5

- Version: 5.65.16
- Source: https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/
- License: MIT (see https://codemirror.net/5/LICENSE)

Vendored files:

- `codemirror.min.js`, `codemirror.min.css`
- `addon/mode/simple.min.js` (required by the `dockerfile` and `rust` modes)
- `mode/`: markdown, javascript, python, shell, xml, css, yaml, sql, clike,
  toml, dockerfile, properties, go, rust, diff

The Files tab loads these lazily on first editor open (`static/js/files/editor.js`
builds the URLs from `CM_BASE` and `CM_VERSION`). `/static/vendor/` is served
immutable, so an upgrade must change the asset URLs — bump the `CM_VERSION`
constant in `static/js/files/editor.js`, which sets the `?v=` suffix.
