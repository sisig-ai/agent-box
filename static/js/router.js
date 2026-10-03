// Hash routing for the four views (Brief / Stack / Files / Shell).
// Shell and Files are code-split via dynamic import(): their modules are
// fetched on first tab activation and the import promise is cached, so a
// second visit is a no-op. No window.* globals are involved.
const btns = {
  brief: document.getElementById('view-btn-brief'),
  stack: document.getElementById('view-btn-stack'),
  files: document.getElementById('view-btn-files'),
  shell: document.getElementById('view-btn-shell'),
};
function current() {
  const h = location.hash;
  if (h === '#/brief') return 'brief';
  if (h === '#/files') return 'files';
  if (h === '#/shell') return 'shell';
  return 'stack'; // default landing tab (also #/ and empty hash)
}
const lazy = {};
function ensure(v) {
  if (v === 'shell') {
    (lazy.shell ||= import('./shell/shell.js')).then(m => m.initShell());
  } else if (v === 'files') {
    (lazy.files ||= import('./files/actions.js')).then(m => m.initFiles());
  }
}
function apply() {
  const v = current();
  document.body.dataset.view = v;
  for (const [k, b] of Object.entries(btns)) {
    if (b) b.classList.toggle('active', k === v);
  }
  ensure(v);
}
window.addEventListener('hashchange', apply);
apply();
