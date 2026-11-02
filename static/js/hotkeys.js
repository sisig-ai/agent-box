// Single-letter view hotkeys and the [keys] panel. Mirrors the sidebar tags;
// ignored while typing so the shell, editor and search fields keep their keys.
const ROUTES = { b: '#/brief', s: '#/', f: '#/files', t: '#/shell', k: '#/kanban', p: '#/progress' };

function typing(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable) return true;
  return !!a.closest('.term, .CodeMirror, dialog');
}

function openKeys() {
  const dialog = document.getElementById('keys-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

document.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  const route = ROUTES[e.key.toLowerCase()];
  if (route) {
    e.preventDefault();
    location.hash = route;
    return;
  }
  if (e.key === '/' && document.body.dataset.view === 'kanban') {
    const input = document.getElementById('kanban-search');
    if (input) {
      e.preventDefault();
      input.focus();
    }
    return;
  }
  if (e.key === '?') {
    e.preventDefault();
    openKeys();
  }
});

document.getElementById('keys-btn')?.addEventListener('click', openKeys);
