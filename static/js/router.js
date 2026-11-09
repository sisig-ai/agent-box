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
  tables: document.getElementById('view-btn-tables'),
  logs: document.getElementById('view-btn-logs'),
};
function current() {
  const h = location.hash;
  if (h === '#/brief') return 'brief';
  if (h === '#/files') return 'files';
  if (h === '#/shell') return 'shell';
  if (h === '#/progress') return 'progress';
  if (h === '#/docs' || h.startsWith('#/docs/')) return 'docs';
  if (h === '#/tables') return 'tables';
  if (h === '#/logs') return 'logs';
  if (h === '#/kanban' || h.startsWith('#/kanban/') || /^#card-\d+/.test(h)) return 'kanban';
  return 'stack'; // default landing tab (also #/ and empty hash)
}
const lazy = {};
const KANBAN = './kanban/view.js?v=subtasks6';
const PROGRESS = './progress/bars.js?v=alpine4';
const DOCS = './docs/view.js?v=alpine6';
const TABLES = './tables/view.js?v=tables8';
const LOGS = './logs/view.js?v=alpine1';
const STACK = './stack/view.js?v=alpine2';
const BRIEF = './notes/brief.js?v=alpine5';
let lastView = null;
function ensure(v) {
  if (v === 'brief') {
    (lazy.brief ||= import(BRIEF)).then(m => m.mount(document.getElementById('brief')));
  } else if (v === 'stack') {
    (lazy.stack ||= import(STACK)).then(m => m.mount(document.getElementById('stack-view')));
  } else if (v === 'shell') {
    (lazy.shell ||= import('./shell/shell.js')).then(m => m.initShell());
  } else if (v === 'files') {
    (lazy.files ||= import('./files/view.js?v=alpine4')).then(m => m.mount(document.getElementById('files-view')));
  } else if (v === 'kanban') {
    (lazy.kanban ||= import(KANBAN)).then(m => m.mount(document.getElementById('kanban-view')));
  } else if (v === 'progress') {
    (lazy.progress ||= import(PROGRESS)).then(m => m.mount(document.getElementById('progress-view')));
  } else if (v === 'tables') {
    (lazy.tables ||= import(TABLES)).then(m => m.mount(document.getElementById('tables-view')));
  } else if (v === 'docs') {
    const docPrefix = decodeURIComponent(location.hash.replace(/^#\/docs\/?/, ''));
    (lazy.docs ||= import(DOCS)).then(m => m.mount(document.getElementById('docs-view'), docPrefix || ''));
  } else if (v === 'logs') {
    (lazy.logs ||= import(LOGS)).then(m => m.mount(document.getElementById('logs-view')));
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
    if (v === 'kanban') (lazy.kanban ||= import(KANBAN)).then(m => m.enter());
    else if (v === 'progress') (lazy.progress ||= import(PROGRESS)).then(m => m.enter());
    else if (v === 'docs') {
      const docPrefix = decodeURIComponent(location.hash.replace(/^#\/docs\/?/, ''));
      (lazy.docs ||= import(DOCS)).then(m => m.mount(document.getElementById('docs-view'), docPrefix || ''));
    }
  }
}
window.addEventListener('hashchange', apply);
apply();
