// Hash routing for the four views (Brief / Stack / Files / Shell).
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
function apply() {
  const v = current();
  document.body.dataset.view = v;
  for (const [k, b] of Object.entries(btns)) {
    if (b) b.classList.toggle('active', k === v);
  }
  if (v === 'shell' && window.shellEnsure) window.shellEnsure();
  if (v === 'files' && window.fsEnsure) window.fsEnsure();
}
window.currentView = current;
window.addEventListener('hashchange', apply);
apply();
