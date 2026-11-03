// Docs view: prefix-keyed text store with metadata and full-text search.
// List on the left (filtered by path or search query), editor on the right.
// A doc's prefix is its identity: it is editable while creating, read-only once
// the doc exists, so a rename can never orphan or clobber another entry.
import { armDelete } from '../kanban/edit.js?v=kanban29';
import { createTree } from './tree.js?v=docs4';
import { paintBacklinks } from './backlinks.js?v=author3';
import { flatRow, sortHeader, sortedDocs } from './flatlist.js?v=author3';
import { docPath, fmtTime, tagLabel } from './format.js?v=author3';

const $ = (id) => document.getElementById(id);
const DEBOUNCE_MS = 180;
const SEARCH_MIN = 2;
const LIST_LIMIT = 200;

const SCOPE_KEY = 'docs.prefix';
const TREE_KEY = 'docs.collapsed';
const VIEW_KEY = 'docs.view';
const SORT_KEY = 'docs.sort';
const AUTHOR_KEY = 'docs.author';
const NO_AUTHOR = '__none__';

const state = {
  started: false,
  all: [], // flat list + search scoping
  tree: null, // server-built tree (folders, counts, five docs each)
  folderDocs: new Map(), // folder path -> every doc in it, once "show more" is used
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
  author: '',
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

function setScope(prefix) {
  state.prefix = prefix || '';
  try {
    if (state.prefix) localStorage.setItem(SCOPE_KEY, state.prefix);
    else localStorage.removeItem(SCOPE_KEY);
  } catch { /* storage blocked */ }
  applyScope();
  tree.render();
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
    state.author = localStorage.getItem(AUTHOR_KEY) || '';
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'flat' || saved === 'tree') state.view = saved;
    const sort = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
    if (sort && ['prefix', 'updated', 'author'].includes(sort.key)) {
      state.sort = { key: sort.key, dir: sort.dir === 1 ? 1 : -1 };
    }
  } catch { /* storage blocked */ }
}

// '' = every author, '__none__' = docs with no author, anything else = that name.
function authorParam() {
  return state.author === NO_AUTHOR ? '' : (state.author || undefined);
}

function paintAuthors(list) {
  const sel = $('docs-author');
  if (!sel || document.activeElement === sel) return;
  const options = [['', 'all authors'], ...list
    .filter((entry) => entry.author)
    .map((entry) => [entry.author, `${entry.author} (${entry.count})`])];
  if (list.some((entry) => !entry.author)) options.push([NO_AUTHOR, '— no author —']);
  if (state.author && !options.some(([value]) => value === state.author)) {
    options.push([state.author, state.author]);
  }
  sel.replaceChildren(...options.map(([value, label]) => {
    const option = el('option', '', label);
    option.value = value;
    option.selected = value === state.author;
    return option;
  }));
  sel.classList.toggle('active', !!state.author);
}

async function loadAuthors() {
  const data = await api('/api/docs/authors');
  paintAuthors(data.authors || []);
}

function setAuthor(author) {
  state.author = author || '';
  $('docs-author').classList.toggle('active', !!state.author);
  try {
    if (state.author) localStorage.setItem(AUTHOR_KEY, state.author);
    else localStorage.removeItem(AUTHOR_KEY);
  } catch { /* storage blocked */ }
  loadList();
  if (state.searching) runSearch();
}

function setView(view) {
  state.view = view === 'flat' ? 'flat' : 'tree';
  try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* storage blocked */ }
  paintView();
  tree.render();
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

const tree = createTree({
  el, api, state, $, setStatus, selectDoc, setScope, LIST_LIMIT,
});

function renderList() {
  const list = $('docs-list');
  const searching = state.searching;
  const flat = state.view === 'flat';
  // Flat mode always lists every doc (sorted); search results take over both views.
  const base = flat ? sortedDocs(state, state.all) : state.docs;
  const rows = searching ? [...state.hits.values()] : base;
  const semantic = searching
    ? [...state.semantic.values()].filter((hit) => !state.hits.has(hit.prefix))
    : [];
  // Flat mode is a one-line-per-doc listing; search results stay as cards.
  const nodes = flat && !searching
    ? [sortHeader(state, el, setSort), ...rows.map((doc) => flatRow(doc, state, el, fmtTime, tagLabel, selectDoc))]
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
  // Two shapes of the same corpus: the flat list for sorting and scoped views,
  // and the server-built tree so the explorer never needs every doc row.
  const author = authorParam();
  const listParams = new URLSearchParams({ limit: String(LIST_LIMIT) });
  const treeParams = new URLSearchParams({ per: '5' });
  if (author !== undefined) {
    listParams.set('author', author);
    treeParams.set('author', author);
  }
  const [list, treeData] = await Promise.all([
    api(`/api/docs?${listParams}`),
    api(`/api/docs/tree?${treeParams}`),
  ]);
  state.all = list.docs;
  state.tree = treeData;
  state.folderDocs.clear();
  applyScope();
  tree.render();
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
    if (authorParam() !== undefined) params.set('author', authorParam());
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
    if (authorParam() !== undefined) params.set('author', authorParam());
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
  paintBacklinks($('doc-backlinks'), doc, el);
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
    tree.render();
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
  tree.render();
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
  $('docs-author').addEventListener('change', (e) => setAuthor(e.target.value));
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

export function initDocs(openPrefix = '') {
  if (state.started) {
    refresh().then(() => { if (openPrefix) selectDoc(openPrefix); });
    return;
  }
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
  loadAuthors().catch(() => {});
  refresh().then(() => { if (openPrefix) selectDoc(openPrefix); });
}
