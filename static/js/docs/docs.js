// Docs view: prefix-keyed text store with metadata and full-text search.
// List on the left (filtered by path or search query), editor on the right.
// A doc's prefix is its identity: it is editable while creating, read-only once
// the doc exists, so a rename can never orphan or clobber another entry.
import { armDelete } from '../kanban/edit.js?v=kanban29';

const $ = (id) => document.getElementById(id);
const DEBOUNCE_MS = 180;
const SEARCH_MIN = 2;
const LIST_LIMIT = 200;
const HIT = '\x01';

const SCOPE_KEY = 'docs.prefix';
const TREE_KEY = 'docs.collapsed';

const state = {
  started: false,
  all: [], // every doc, for the tree
  collapsed: new Set(),
  docs: [],
  hits: new Map(),
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
  const searching = state.hits.size > 0 || (state.q.length >= SEARCH_MIN && state.q);
  const rows = searching ? [...state.hits.values()] : state.docs;
  const semantic = searching
    ? [...state.semantic.values()].filter((hit) => !state.hits.has(hit.prefix))
    : [];
  const nodes = rows.map((doc) => {
    const item = el('li', 'docs-item');
    item.dataset.prefix = doc.prefix;
    if (state.current && state.current.prefix === doc.prefix) item.classList.add('selected');
    const head = el('div', 'docs-item-head');
    const name = el('span', 'docs-item-name');
    name.append(marked(doc.prefix_snip || doc.prefix));
    head.append(name);
    item.append(head);
    if (doc.snippet) {
      const snip = el('p', 'docs-item-snip');
      snip.append(marked(doc.snippet));
      item.append(snip);
    }
    const meta = el('div', 'docs-item-meta');
    meta.append(el('span', '', doc.author ? `@${doc.author}` : '—'));
    meta.append(el('span', '', fmtTime(doc.updated_at)));
    if (doc.tags && doc.tags.length) meta.append(el('span', 'docs-item-tags', tagLabel(doc.tags)));
    else if (doc.size) meta.append(el('span', '', `${doc.size}b`));
    item.append(meta);
    return docRow(doc, 'fts');
  });
  if (searching && (semantic.length || state.semanticNote)) {
    nodes.push(el('li', 'docs-divider', `semantic${semantic.length ? ` · ${semantic.length}` : ''}`));
    if (state.semanticNote) {
      nodes.push(el('li', 'docs-divider-note', state.semanticNote));
    }
    nodes.push(...semantic.map((doc) => docRow(doc, 'semantic')));
  }
  list.replaceChildren(...nodes);
  // The tree already shows every doc, so the flat list only appears when it
  // adds something: a scoped folder or search results.
  const listVisible = searching || !!state.prefix;
  $('docs-list').hidden = !listVisible;
  $('docs-empty-list').hidden = !listVisible || rows.length + semantic.length > 0;
  const docs = state.docs.length;
  $('docs-count').textContent = searching
    ? `${rows.length} exact${semantic.length ? ` · ${semantic.length} semantic` : ''}`
      + ` · ${docs} doc${docs === 1 ? '' : 's'}`
    : `${docs} doc${docs === 1 ? '' : 's'}`
      + (state.prefix ? ` under ${state.prefix}` : '');
  $('docs-empty-list').textContent = searching
    ? `no exact matches for “${state.q}”`
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
  $('docs-search-clear').hidden = !q;
  state.q = q;
  if (q.length < SEARCH_MIN) {
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
    const data = await api(`/api/docs/search?${params}`);
    if (seq !== state.seq) return;
    state.hits = new Map(data.hits.map((hit) => [hit.prefix, hit]));
    renderList();
    setStatus(`${data.count} of ${data.total} exact match`);
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
  try {
    const params = new URLSearchParams({ q, limit: '10' });
    if (state.prefix) params.set('prefix', state.prefix);
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
  $('docs-search').addEventListener('input', () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(runSearch, DEBOUNCE_MS);
  });
  $('docs-search-clear').addEventListener('click', () => {
    $('docs-search').value = '';
    state.q = '';
    state.hits = new Map();
    $('docs-search-clear').hidden = true;
    renderList();
    $('docs-search').focus();
  });
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
    if (e.key === 'Escape' && document.activeElement === $('docs-search')) {
      $('docs-search').value = '';
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
  bind();
  setEditorVisible(false);
  refresh();
}
