// Docs view: prefix-keyed text store with metadata and full-text search.
// List on the left (filtered by path or search query), editor on the right.
// A doc's prefix is its identity: it is editable while creating, read-only once
// the doc exists, so a rename can never orphan or clobber another entry.
import { armDelete } from '../kanban/edit.js?v=kanban29';

const $ = (id) => document.getElementById(id);
const DEBOUNCE_MS = 180;
const SEARCH_MIN = 2;
const LIST_LIMIT = 200;

const SCOPE_KEY = 'docs.prefix';
const TREE_KEY = 'docs.collapsed';
const VIEW_KEY = 'docs.view';
const SORT_KEY = 'docs.sort';

const state = {
  started: false,
  all: [], // every doc, for the tree
  collapsed: new Set(),
  view: 'tree', // 'tree' (default) or 'flat'
  sort: { key: 'updated', dir: -1 },
  docs: [],
  hits: new Map(),
  prefixQ: '',
  searching: false,
  semantic: new Map(),
  semanticNote: '',
  q: '',
  prefix: '',
  current: null, // {prefix, author, tags, content, created_at, updated_at, revision} or null (new)
  dirty: false,
  timer: 0,
  seq: 0,
};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const docPath = (prefix) => '/api/docs/' + prefix.split('/').map(encodeURIComponent).join('/');
const tagLabel = (tags) => (tags || []).join(' · ');
const fmtTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
};

function setStatus(text, isError) {
  const node = $('docs-status');
  node.textContent = text;
  node.classList.toggle('err', !!isError);
}

// Hit snippets carry the server's \x01…\x02 markers; render them as <mark>.
function marked(text) {
  const frag = document.createDocumentFragment();
  String(text || '').split(/\x01|\x02/).forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const mark = el('mark', 'docs-hl', part);
      frag.append(mark);
    } else {
      frag.append(document.createTextNode(part));
    }
  });
  return frag;
}

// Prefixes are paths: a/b/c.md nests a > b > c.md. Folders first, then leaves.
function buildTree(docs) {
  const root = { folders: new Map(), docs: [] };
  for (const doc of docs) {
    const parts = doc.prefix.split('/');
    const name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), docs: [] });
      node = node.folders.get(part);
    }
    node.docs.push({ ...doc, name });
  }
  return root;
}

function treeCount(node) {
  let total = node.docs.length;
  for (const child of node.folders.values()) total += treeCount(child);
  return total;
}

function renderTree() {
  const host = $('docs-tree');
  const root = buildTree(state.all);
  const build = (node, path, depth) => {
    const list = el('ul', 'docs-tree-list');
    const folders = [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, child] of folders) {
      const full = path ? `${path}/${name}` : name;
      const open = !state.collapsed.has(full);
      const item = el('li', 'docs-tree-folder');
      const row = el('div', 'docs-tree-row');
      row.style.paddingLeft = `${depth * 0.8}rem`;
      const twist = el('button', 'docs-tree-twist', open ? '▾' : '▸');
      twist.title = open ? 'Collapse' : 'Expand';
      twist.addEventListener('click', (e) => {
        e.stopPropagation();
        if (open) state.collapsed.add(full); else state.collapsed.delete(full);
        saveCollapsed();
        renderTree();
      });
      const label = el('button', 'docs-tree-name', name);
      label.title = `Scope to ${full}/`;
      if (state.prefix === full) label.classList.add('scoped');
      label.addEventListener('click', () => setScope(state.prefix === full ? '' : full));
      row.append(twist, label, el('span', 'docs-tree-count', String(treeCount(child))));
      item.append(row);
      if (open) item.append(build(child, full, depth + 1));
      list.append(item);
    }
    const leaves = node.docs.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const doc of leaves) {
      const item = el('li', 'docs-tree-doc');
      const row = el('div', 'docs-tree-row');
      row.style.paddingLeft = `${depth * 0.8 + 1.1}rem`;
      const leaf = el('button', 'docs-tree-name is-doc', doc.name);
      leaf.title = doc.prefix;
      if (state.current && state.current.prefix === doc.prefix) leaf.classList.add('open');
      leaf.addEventListener('click', () => selectDoc(doc.prefix));
      row.append(el('span', 'docs-tree-twist', '·'), leaf);
      item.append(row);
      list.append(item);
    }
    return list;
  };
  host.replaceChildren(build(root, '', 0));
  $('docs-tree-empty').hidden = state.all.length > 0;
}

function saveCollapsed() {
  try { localStorage.setItem(TREE_KEY, JSON.stringify([...state.collapsed])); } catch { /* storage blocked */ }
}

function setScope(prefix) {
  state.prefix = prefix || '';
  try {
    if (state.prefix) localStorage.setItem(SCOPE_KEY, state.prefix);
    else localStorage.removeItem(SCOPE_KEY);
  } catch { /* storage blocked */ }
  applyScope();
  renderTree();
  if (state.q) runSearch();
}

function applyScope() {
  state.docs = state.prefix
    ? state.all.filter((doc) => doc.prefix === state.prefix || doc.prefix.startsWith(`${state.prefix}/`))
    : state.all;
  renderList();
}

function restoreView() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'flat' || saved === 'tree') state.view = saved;
    const sort = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
    if (sort && ['prefix', 'updated', 'author'].includes(sort.key)) {
      state.sort = { key: sort.key, dir: sort.dir === 1 ? 1 : -1 };
    }
  } catch { /* storage blocked */ }
}

function setView(view) {
  state.view = view === 'flat' ? 'flat' : 'tree';
  try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* storage blocked */ }
  paintView();
  renderTree();
  renderList();
}

function paintView() {
  const tree = $('docs-view-tree');
  const flat = $('docs-view-flat');
  if (!tree || !flat) return;
  tree.classList.toggle('active', state.view === 'tree');
  flat.classList.toggle('active', state.view === 'flat');
  tree.setAttribute('aria-pressed', String(state.view === 'tree'));
  flat.setAttribute('aria-pressed', String(state.view === 'flat'));
  $('docs-tree').hidden = state.view !== 'tree';
  $('docs-tree-empty').hidden = state.view !== 'tree' || state.all.length > 0;
  // Flat rows need more width than the tree does.
  $('docs-view').classList.toggle('is-flat', state.view === 'flat');
}

function setSort(key) {
  if (state.sort.key === key) state.sort.dir = -state.sort.dir;
  else state.sort = { key, dir: key === 'updated' ? -1 : 1 };
  try { localStorage.setItem(SORT_KEY, JSON.stringify(state.sort)); } catch { /* storage blocked */ }
  renderList();
}

function sortedDocs(docs) {
  const { key, dir } = state.sort;
  const value = (doc) => {
    if (key === 'prefix') return doc.prefix.toLowerCase();
    if (key === 'author') return (doc.author || '').toLowerCase();
    return new Date(doc.updated_at).getTime() || 0;
  };
  return docs.slice().sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === right) return a.prefix.localeCompare(b.prefix);
    return (left < right ? -1 : 1) * dir;
  });
}

function sortHeader() {
  const head = el('li', 'docs-flat-row docs-flat-head');
  for (const [key, label] of [['prefix', 'prefix'], ['updated', 'updated'], ['author', 'author']]) {
    const btn = el('button', 'docs-sort', label);
    btn.classList.toggle('active', state.sort.key === key);
    if (state.sort.key === key) {
      btn.append(el('span', 'docs-sort-arrow', state.sort.dir === 1 ? '▲' : '▼'));
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setSort(key);
    });
    const cell = el('span', `docs-flat-cell is-${key}`);
    cell.append(btn);
    head.append(cell);
  }
  return head;
}

// One line per doc in flat mode; the columns line up with sortHeader().
function flatRow(doc) {
  const row = el('li', 'docs-flat-row');
  row.dataset.prefix = doc.prefix;
  if (state.current && state.current.prefix === doc.prefix) row.classList.add('selected');
  const prefixCell = el('span', 'docs-flat-cell is-prefix');
  prefixCell.append(el('span', 'docs-flat-prefix', doc.prefix));
  if (doc.tags && doc.tags.length) prefixCell.append(el('span', 'docs-flat-tags', tagLabel(doc.tags)));
  row.append(prefixCell);
  row.append(el('span', 'docs-flat-cell is-updated', fmtTime(doc.updated_at)));
  row.append(el('span', 'docs-flat-cell is-author', doc.author ? `@${doc.author}` : '—'));
  row.title = `${doc.prefix}\n${doc.author || 'no author'} · ${fmtTime(doc.updated_at)}`;
  row.addEventListener('click', () => selectDoc(doc.prefix));
  return row;
}

function docRow(doc, kind) {
  const item = el('li', `docs-item${kind === 'semantic' ? ' is-semantic' : ''}`);
  item.dataset.prefix = doc.prefix;
  if (state.current && state.current.prefix === doc.prefix) item.classList.add('selected');
  const head = el('div', 'docs-item-head');
  const name = el('span', 'docs-item-name');
  name.append(marked(doc.prefix_snip || doc.prefix));
  head.append(name);
  if (kind === 'semantic' && typeof doc.score === 'number') {
    head.append(el('span', 'docs-score', doc.score.toFixed(2)));
  }
  item.append(head);
  const snippet = doc.snippet || doc.excerpt;
  if (snippet) {
    const snip = el('p', 'docs-item-snip');
    snip.append(marked(snippet));
    item.append(snip);
  }
  const meta = el('div', 'docs-item-meta');
  meta.append(el('span', '', doc.author ? `@${doc.author}` : '—'));
  meta.append(el('span', '', fmtTime(doc.updated_at)));
  if (doc.tags && doc.tags.length) meta.append(el('span', 'docs-item-tags', tagLabel(doc.tags)));
  else if (doc.size) meta.append(el('span', '', `${doc.size}b`));
  item.append(meta);
  item.addEventListener('click', () => selectDoc(doc.prefix));
  return item;
}

function renderList() {
  const list = $('docs-list');
  const searching = state.searching;
  const flat = state.view === 'flat';
  // Flat mode always lists every doc (sorted); search results take over both views.
  const base = flat ? sortedDocs(state.all) : state.docs;
  const rows = searching ? [...state.hits.values()] : base;
  const semantic = searching
    ? [...state.semantic.values()].filter((hit) => !state.hits.has(hit.prefix))
    : [];
  // Flat mode is a one-line-per-doc listing; search results stay as cards.
  const nodes = flat && !searching
    ? [sortHeader(), ...rows.map(flatRow)]
    : rows.map((doc) => docRow(doc, 'fts'));
  if (searching && (semantic.length || state.semanticNote)) {
    nodes.push(el('li', 'docs-divider', `semantic${semantic.length ? ` · ${semantic.length}` : ''}`));
    if (state.semanticNote) {
      nodes.push(el('li', 'docs-divider-note', state.semanticNote));
    }
    nodes.push(...semantic.map((doc) => docRow(doc, 'semantic')));
  }
  list.replaceChildren(...nodes);
  // Tree mode hides the list until it adds something (a scope or search
  // results); flat mode is the list.
  const listVisible = flat || searching || !!state.prefix;
  $('docs-list').hidden = !listVisible;
  $('docs-empty-list').hidden = !listVisible || rows.length + semantic.length > 0;
  const docs = state.docs.length;
  $('docs-count').textContent = searching
    ? `${rows.length} exact${semantic.length ? ` · ${semantic.length} semantic` : ''}`
      + ` · ${docs} doc${docs === 1 ? '' : 's'}`
    : flat
      ? `${state.all.length} doc${state.all.length === 1 ? '' : 's'} · sorted by ${state.sort.key}`
      : `${docs} doc${docs === 1 ? '' : 's'}`
        + (state.prefix ? ` under ${state.prefix}` : '');
  $('docs-empty-list').textContent = searching
    ? (state.q ? `no exact matches for “${state.q}”` : `no docs under prefix “${state.prefixQ}”`)
    : 'no docs yet';
}

async function loadList() {
  // The tree needs every doc, so fetch once and scope client-side.
  const data = await api(`/api/docs?${new URLSearchParams({ limit: String(LIST_LIMIT) })}`);
  state.all = data.docs;
  applyScope();
  renderTree();
}

async function refresh() {
  try {
    await loadList();
    setStatus(`synced ${new Date().toLocaleTimeString([], { hour12: false })}`);
  } catch (err) {
    setStatus(`load failed: ${err.message}`, true);
  }
}

async function runSearch() {
  const q = $('docs-search').value.trim();
  const prefixQ = $('docs-prefix-q').value.trim();
  $('docs-search-clear').hidden = !q && !prefixQ;
  state.q = q;
  state.prefixQ = prefixQ;
  // Either box can drive a search: text, a prefix, or both.
  const active = q.length >= SEARCH_MIN || prefixQ.length > 0;
  state.searching = active;
  if (!active) {
    state.hits = new Map();
    state.semantic = new Map();
    state.semanticNote = '';
    renderList();
    return;
  }
  state.semantic = new Map();
  state.semanticNote = '';
  const seq = ++state.seq;
  try {
    const params = new URLSearchParams({ q, limit: String(LIST_LIMIT) });
    if (state.prefix) params.set('prefix', state.prefix);
    if (prefixQ) params.set('prefix_q', prefixQ);
    const data = await api(`/api/docs/search?${params}`);
    if (seq !== state.seq) return;
    state.hits = new Map(data.hits.map((hit) => [hit.prefix, hit]));
    renderList();
    setStatus(`${data.count} of ${data.total} exact match${prefixQ ? ` · prefix ${prefixQ}` : ''}`);
    loadSemantic(q, seq);
  } catch (err) {
    if (seq !== state.seq) return;
    state.hits = new Map();
    renderList();
    setStatus(`search failed: ${err.message}`, true);
  }
}

// Vector hits arrive after the exact ones and are appended below them.
async function loadSemantic(q, seq) {
  if (!q) return; // vectors need a query; a prefix-only search stays exact
  try {
    const params = new URLSearchParams({ q, limit: '10' });
    if (state.prefix) params.set('prefix', state.prefix);
    if (state.prefixQ) params.set('prefix_q', state.prefixQ);
    const data = await api(`/api/docs/semantic?${params}`);
    if (seq !== state.seq) return;
    state.semantic = new Map(data.hits.map((hit) => [hit.prefix, hit]));
    state.semanticNote = '';
    renderList();
    setStatus(
      `${state.hits.size} exact · ${data.hits.length} semantic · ${data.took_ms}ms`
      + (data.pending ? ` · ${data.pending} unindexed` : ''),
    );
  } catch (err) {
    if (seq !== state.seq) return;
    state.semantic = new Map();
    state.semanticNote = `semantic unavailable · ${err.message}`;
    renderList();
    setStatus(`exact only · ${err.message}`, true);
  }
}

function setEditorVisible(visible) {
  $('docs-editor').hidden = !visible;
  $('docs-empty').hidden = visible;
}

function fillEditor(doc) {
  $('doc-prefix').value = doc ? doc.prefix : '';
  $('doc-prefix').readOnly = !!doc;
  $('doc-author').value = doc?.author || '';
  $('doc-tags').value = (doc?.tags || []).join(', ');
  $('doc-content').value = doc?.content || '';
  $('doc-delete').hidden = !doc;
  $('doc-status').textContent = doc
    ? `rev ${doc.revision} · created ${fmtTime(doc.created_at)} · updated ${fmtTime(doc.updated_at)}`
    : 'new doc';
  $('doc-status').classList.remove('err');
  state.dirty = false;
}

async function selectDoc(prefix) {
  if (state.dirty && state.current && !confirm('Discard unsaved changes?')) return;
  try {
    const doc = await api(docPath(prefix));
    state.current = doc;
    fillEditor(doc);
    setEditorVisible(true);
    renderList();
    renderTree();
    $('doc-content').focus();
  } catch (err) {
    setStatus(`open failed: ${err.message}`, true);
  }
}

function startNew() {
  if (state.dirty && state.current && !confirm('Discard unsaved changes?')) return;
  state.current = null;
  fillEditor(null);
  setEditorVisible(true);
  renderTree();
  $('doc-prefix').focus();
}

async function save() {
  const prefix = $('doc-prefix').value.trim().replace(/^\/+|\/+$/g, '');
  if (!prefix) {
    setStatus('prefix is required', true);
    $('doc-prefix').focus();
    return;
  }
  const body = {
    content: $('doc-content').value,
    author: $('doc-author').value.trim() || null,
    tags: $('doc-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
  };
  try {
    const doc = await api(docPath(prefix), { method: 'PUT', body: JSON.stringify(body) });
    state.current = doc;
    fillEditor(doc);
    setStatus(`saved ${doc.prefix} · rev ${doc.revision}`);
    await refresh();
    if (state.q) await runSearch();
  } catch (err) {
    setStatus(`save failed: ${err.message}`, true);
  }
}

async function remove() {
  if (!state.current) return;
  const prefix = state.current.prefix;
  try {
    await api(docPath(prefix), { method: 'DELETE' });
    state.current = null;
    setEditorVisible(false);
    state.q = '';
    $('docs-search').value = '';
    $('docs-search-clear').hidden = true;
    state.hits = new Map();
    setStatus(`deleted ${prefix}`);
    await refresh();
  } catch (err) {
    setStatus(`delete failed: ${err.message}`, true);
  }
}

function markDirty() {
  if (!state.current && !$('doc-prefix').value) return;
  if (!state.dirty) {
    state.dirty = true;
    $('doc-status').textContent = 'unsaved changes';
  }
}

function bind() {
  for (const id of ['docs-search', 'docs-prefix-q']) {
    $(id).addEventListener('input', () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(runSearch, DEBOUNCE_MS);
    });
  }
  $('docs-search-clear').addEventListener('click', () => {
    $('docs-search').value = '';
    $('docs-prefix-q').value = '';
    state.q = '';
    state.prefixQ = '';
    state.searching = false;
    state.hits = new Map();
    state.semantic = new Map();
    $('docs-search-clear').hidden = true;
    renderList();
    setStatus(`cleared · ${state.all.length} docs`);
    $('docs-search').focus();
  });
  $('docs-view-tree').addEventListener('click', () => setView('tree'));
  $('docs-view-flat').addEventListener('click', () => setView('flat'));
  $('docs-new').addEventListener('click', startNew);
  $('docs-refresh').addEventListener('click', () => refresh());
  $('doc-save').addEventListener('click', save);
  armDelete($('doc-delete'), remove);
  for (const id of ['doc-prefix', 'doc-author', 'doc-tags', 'doc-content']) {
    $(id).addEventListener('input', markDirty);
  }
  $('doc-content').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'docs') return;
    if (e.key === 'Escape'
      && (document.activeElement === $('docs-search') || document.activeElement === $('docs-prefix-q'))) {
      $('docs-search-clear').click();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

export function initDocs() {
  if (state.started) { refresh(); return; }
  state.started = true;
  try { state.prefix = localStorage.getItem(SCOPE_KEY) || ''; } catch { /* storage blocked */ }
  try {
    const saved = JSON.parse(localStorage.getItem(TREE_KEY) || '[]');
    if (Array.isArray(saved)) state.collapsed = new Set(saved.map(String));
  } catch { /* storage blocked */ }
  restoreView();
  bind();
  paintView();
  setEditorVisible(false);
  refresh();
}
