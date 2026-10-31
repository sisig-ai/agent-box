// Files explorer: shared DOM refs + state, table/breadcrumb/places/info render.
import { $, esc } from '../dom.js';
import { cd, download, openEntry, renameEntry, deleteEntry } from './actions.js';

export const refs = {
  tbody: $('files-tbody'), listWrap: $('files-list-wrap'),
  breadcrumb: $('files-breadcrumb'), infoBody: $('files-info-body'),
  statusEl: $('files-status'), statusBar: $('files-status-bar'),
  countEl: $('files-count'), pathLabel: $('files-path-label'),
  emptyEl: $('files-empty'), uploadInput: $('files-upload-input'),
  placesBox: $('files-places'),
};

export const state = {
  cwd: null,          // current folder (absolute string)
  home: null,         // ~ path reported by the server
  parentPath: null,   // parent folder (null at the filesystem root)
  entries: [],        // entries of the current folder, as returned
  selected: null,     // selected entry
  sortKey: 'name', sortDir: 1,
  showHidden: true,   // reveal dotfiles (classic SFTP default)
  inited: false,
};

const fileIcon = (e) => {
  if (e.is_link) return 'l';
  if (e.is_dir) return 'd';
  return e.type === 'other' ? '?' : '-';
};

export function fmtSize(n) {
  if (n == null || isNaN(n)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? String(v) : v.toFixed(v >= 10 ? 0 : 1)) + ' ' + units[i];
}

export function fmtTime(sec) {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  if (isNaN(d)) return '';
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) +
         ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function setStatus(text, isError) {
  refs.statusEl.textContent = text;
  refs.statusBar.classList.toggle('error', !!isError);
}

function sorted() {
  const list = state.entries.slice();
  list.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1; // folders first
    let r;
    if (state.sortKey === 'size') r = (a.size || 0) - (b.size || 0);
    else if (state.sortKey === 'mtime') r = (a.mtime || 0) - (b.mtime || 0);
    else if (state.sortKey === 'mode') r = String(a.mode).localeCompare(String(b.mode));
    else r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return r * state.sortDir;
  });
  return list;
}

function updateSortHeaders() {
  document.querySelectorAll('.files-table thead th[data-sort]').forEach(th => {
    const on = th.dataset.sort === state.sortKey;
    th.classList.toggle('sorted', on);
    th.classList.toggle('asc', on && state.sortDir === 1);
  });
}

export function renderBreadcrumb() {
  refs.breadcrumb.innerHTML = '';
  if (!state.cwd) return;
  const makeCrumb = (label, target, isCurrent) => {
    const c = document.createElement('span');
    c.className = 'files-crumb' + (isCurrent ? ' current' : '');
    c.textContent = label;
    c.addEventListener('click', () => { if (!isCurrent) cd(target); });
    return c;
  };
  const sep = () => {
    const s = document.createElement('span');
    s.className = 'files-crumb-sep';
    s.textContent = '/';
    return s;
  };
  refs.breadcrumb.appendChild(makeCrumb('/', '/', state.cwd === '/'));
  let acc = '';
  const parts = state.cwd.split('/').filter(Boolean);
  parts.forEach((part, i) => {
    acc += '/' + part;
    refs.breadcrumb.appendChild(sep());
    refs.breadcrumb.appendChild(makeCrumb(part, acc, i === parts.length - 1));
  });
}

export function renderPlaces(places) {
  if (!refs.placesBox) return;
  refs.placesBox.innerHTML = '<h3>Places</h3>';
  (places || []).forEach(pl => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'files-place';
    const label = state.home && pl.path.startsWith(state.home) ? '~' + pl.path.slice(state.home.length) : pl.path;
    b.textContent = pl.name + '  ' + label;
    b.title = pl.path;
    b.dataset.path = pl.path;
    b.addEventListener('click', () => cd(pl.path));
    refs.placesBox.appendChild(b);
  });
  updatePlacesActive();
}

function updatePlacesActive() {
  document.querySelectorAll('.files-place').forEach(b => {
    b.classList.toggle('active', b.dataset.path === state.cwd);
  });
}

function actionBtn(glyph, title, onClick, danger) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'files-act' + (danger ? ' danger' : '');
  b.textContent = glyph;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export function render() {
  const list = sorted().filter(e => state.showHidden || !e.hidden);
  refs.tbody.innerHTML = '';
  refs.emptyEl.hidden = list.length > 0;
  if (!list.length) refs.emptyEl.textContent = '// this folder is empty';

  const frag = document.createDocumentFragment();
  for (const e of list) {
    const tr = document.createElement('tr');
    tr.className = 'files-row';
    tr.dataset.path = e.path;
    if (state.selected && state.selected.path === e.path) tr.classList.add('selected');

    tr.innerHTML =
      '<td><div class="files-name-cell"><span class="files-icon">' + fileIcon(e) + '</span>' +
      '<span class="files-name">' + esc(e.name) + '</span>' +
      (e.is_link ? '<span class="files-link-note">link</span>' : '') + '</div></td>' +
      '<td class="files-size">' + (e.is_dir ? '—' : fmtSize(e.size)) + '</td>' +
      '<td class="files-date">' + fmtTime(e.mtime) + '</td>' +
      '<td class="files-mode">' + esc(e.mode) + '</td>' +
      '<td class="files-actions-cell"><div class="files-row-actions"></div></td>';

    const actions = tr.querySelector('.files-row-actions');
    if (e.is_dir) {
      actions.appendChild(actionBtn('▸', 'Open folder', (ev) => { ev.stopPropagation(); cd(e.path); }));
    } else {
      actions.appendChild(actionBtn('⤢', 'Open in editor', (ev) => { ev.stopPropagation(); openEntry(e); }));
      actions.appendChild(actionBtn('⬇', 'Download', (ev) => { ev.stopPropagation(); download(e); }));
    }
    actions.appendChild(actionBtn('✎', 'Rename', (ev) => { ev.stopPropagation(); renameEntry(e); }));
    actions.appendChild(actionBtn('✕', 'Delete', (ev) => { ev.stopPropagation(); deleteEntry(e); }, true));

    tr.addEventListener('click', () => selectEntry(e));
    tr.addEventListener('dblclick', () => { if (e.is_dir) cd(e.path); else openEntry(e); });
    frag.appendChild(tr);
  }
  refs.tbody.appendChild(frag);

  refs.countEl.textContent = list.length + ' item' + (list.length === 1 ? '' : 's');
  updateSortHeaders();
}

/* ----- Selection + details panel ----- */
export function clearSelection() {
  state.selected = null;
  refs.tbody.querySelectorAll('.files-row.selected').forEach(r => r.classList.remove('selected'));
  refs.infoBody.innerHTML = '<div class="files-info-empty">click a file or folder to see its info</div>';
}

function selectEntry(e) {
  state.selected = e;
  refs.tbody.querySelectorAll('.files-row').forEach(r =>
    r.classList.toggle('selected', r.dataset.path === e.path));
  renderInfo(e, null);
  fetch('/api/fs/stat?path=' + encodeURIComponent(e.path))
    .then(res => res.ok ? res.json() : null)
    .then(d => { if (d && state.selected && state.selected.path === e.path) renderInfo(e, d); })
    .catch(() => {});
}

function renderInfo(e, d) {
  const rows = [];
  const add = (k, v) => { if (v != null && v !== '') rows.push('<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'); };
  add('Type', e.is_link ? ('symlink' + (e.is_dir ? ' → folder' : '')) : e.type);
  if (d && d.link_target) add('Target', d.link_target);
  if (!e.is_dir) {
    const exact = Number(e.size || 0);
    add('Size', exact < 1024 ? exact + ' B' : fmtSize(e.size) + ' (' + exact.toLocaleString() + ' B)');
  }
  add('Modified', d && d.mtime_iso ? new Date(d.mtime_iso).toLocaleString() : fmtTime(e.mtime));
  if (d && d.btime_iso) add('Created', new Date(d.btime_iso).toLocaleString());
  add('Mode', e.mode);
  if (d && d.owner) add('Owner', d.owner + (d.group ? ':' + d.group : ''));
  if (d && d.mime) add('Mime', d.mime);
  add('Access', [e.readable ? 'read' : null, e.writable ? 'write' : null].filter(Boolean).join(' · ') || 'none');
  add('Path', e.path);
  refs.infoBody.innerHTML =
    '<div class="files-info-name"><span class="files-icon">' + fileIcon(e) + '</span>' + esc(e.name) + '</div>' +
    '<dl>' + rows.join('') + '</dl>';
}
