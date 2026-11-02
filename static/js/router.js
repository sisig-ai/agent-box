// Hash routing for the views (Daily Sitrep / Stack / Files / Shell / Ops Board /
// Progress Bars / Docs / Access Logs; internal view ids stay brief / kanban so hash routes and
// element ids are unchanged).
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
  progress: document.getElementById('view-btn-progress'),
  docs: document.getElementById('view-btn-docs'),
  logs: document.getElementById('view-btn-logs'),
};
function current() {
  const h = location.hash;
  if (h === '#/brief') return 'brief';
  if (h === '#/files') return 'files';
  if (h === '#/shell') return 'shell';
  if (h === '#/progress') return 'progress';
  if (h === '#/docs') return 'docs';
  if (h === '#/logs') return 'logs';
  if (h === '#/kanban' || h.startsWith('#/kanban/') || /^#card-\d+/.test(h)) return 'kanban';
  return 'stack'; // default landing tab (also #/ and empty hash)
}
const lazy = {};
const KANBAN = './kanban/board.js?v=kanban29';
const PROGRESS = './progress/bars.js?v=progress7';
const DOCS = './docs/docs.js?v=tree1';
const LOGS = './logs/logs.js?v=logs1';
let lastView = null;
function ensure(v) {
  if (v === 'shell') {
    (lazy.shell ||= import('./shell/shell.js')).then(m => m.initShell());
  } else if (v === 'files') {
    (lazy.files ||= import('./files/actions.js')).then(m => m.initFiles());
  } else if (v === 'kanban') {
    (lazy.kanban ||= import(KANBAN)).then(m => m.initKanban());
  } else if (v === 'progress') {
    (lazy.progress ||= import(PROGRESS)).then(m => m.initProgress());
  } else if (v === 'docs') {
    (lazy.docs ||= import(DOCS)).then(m => m.initDocs());
  } else if (v === 'logs') {
    (lazy.logs ||= import(LOGS)).then(m => m.initLogs());
  }
}
function apply() {
  const v = current();
  document.body.dataset.view = v;
  for (const [k, b] of Object.entries(btns)) {
    if (b) b.classList.toggle('active', k === v);
  }
  ensure(v);
  if (v !== lastView) {
    lastView = v;
    if (v === 'kanban') (lazy.kanban ||= import(KANBAN)).then(m => m.enterKanban());
    else if (v === 'progress') (lazy.progress ||= import(PROGRESS)).then(m => m.enterProgress());
    else if (v === 'docs') (lazy.docs ||= import(DOCS)).then(m => m.initDocs());
    else if (v === 'logs') (lazy.logs ||= import(LOGS)).then(m => m.initLogs());
  }
}
window.addEventListener('hashchange', apply);
apply();
