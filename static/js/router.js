// Hash routing for the views (Daily Sitrep / Stack / Files / Shell / Ops Board / GMGN;
// internal view ids stay brief / kanban so hash routes and element ids are unchanged).
// Ops Board (kanban) also owns #/kanban/card-<id>[/edit] and the short #card-<id> (card modal).
// Shell and Files are code-split via dynamic import(): their modules are
// fetched on first tab activation and the import promise is cached, so a
// second visit is a no-op. No window.* globals are involved.
const btns = {
  brief: document.getElementById('view-btn-brief'),
  stack: document.getElementById('view-btn-stack'),
  files: document.getElementById('view-btn-files'),
  shell: document.getElementById('view-btn-shell'),
  kanban: document.getElementById('view-btn-kanban'),
  gmgn: document.getElementById('view-btn-gmgn'),
};
function current() {
  const app = new URLSearchParams(location.search).get('app');
  if (app === 'gmgn' || location.pathname === '/gmgn') return 'gmgn';
  const h = location.hash;
  if (h === '#/brief') return 'brief';
  if (h === '#/files') return 'files';
  if (h === '#/shell') return 'shell';
  if (h === '#/kanban' || h.startsWith('#/kanban/') || /^#card-\d+/.test(h)) return 'kanban';
  if (h === '#/gmgn') return 'gmgn';
  return 'stack'; // default landing tab (also #/ and empty hash)
}
const lazy = {};
function ensure(v) {
  if (v === 'shell') {
    (lazy.shell ||= import('./shell/shell.js')).then(m => m.initShell());
  } else if (v === 'files') {
    (lazy.files ||= import('./files/actions.js')).then(m => m.initFiles());
  } else if (v === 'kanban') {
    (lazy.kanban ||= import('./kanban/board.js?v=kanban7')).then(m => m.initKanban());
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
