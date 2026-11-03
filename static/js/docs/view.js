// Docs explorer: prefix tree, flat list, search, and the editor.
// Alpine component. The tree and the flat list are computed row arrays, so
// both render with one x-for instead of nested createElement calls.

import Alpine from '../alpine.js';
import { armDelete } from '../kanban/edit.js?v=kanban29';
import { paintBacklinks } from './backlinks.js?v=alpine6';
import { docPath, fmtTime, tagLabel } from './format.js?v=alpine6';

const SEARCH_MIN = 2;
const LIST_LIMIT = 200;

const SCOPE_KEY = 'docs.prefix';
const TREE_KEY = 'docs.collapsed';
const VIEW_KEY = 'docs.view';
const SORT_KEY = 'docs.sort';
const AUTHOR_KEY = 'docs.author';
const NO_AUTHOR = '__none__';

// Hit snippets carry the server's \x01…\x02 markers; split them into runs.
export function markedParts(text) {
  return String(text || '')
    .split(/\x01|\x02/)
    .map((part, i) => ({ text: part, mark: i % 2 === 1 }))
    .filter((part) => part.text);
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function docsView(openPrefix = '') {
  return {
    openPrefix,
    all: [],
    tree: null,
    folderDocs: {},
    collapsed: [],
    view: 'tree',
    sort: { key: 'updated', dir: -1 },
    hits: {},
    semantic: {},
    semanticNote: '',
    q: '',
    prefixQ: '',
    prefix: '',
    author: '',
    authors: [],
    current: null,
    dirty: false,
    seq: 0,
    searchTimer: 0,
    status: 'loading…',
    statusError: false,
    editorOpen: false,
    form: { prefix: '', author: '', tags: '', content: '' },
    docStatus: '',
    backlinks: null,

    init() {
      this.restore();
      this.loadAuthors().catch(() => {});
      this.refresh().then(() => { if (this.openPrefix) this.selectDoc(this.openPrefix); });
      this.onBeforeUnload = (event) => {
        if (this.dirty) { event.preventDefault(); event.returnValue = ''; }
      };
      window.addEventListener('beforeunload', this.onBeforeUnload);
    },

    destroy() {
      clearTimeout(this.searchTimer);
      window.removeEventListener('beforeunload', this.onBeforeUnload);
    },

    restore() {
      try {
        this.prefix = localStorage.getItem(SCOPE_KEY) || '';
        this.author = localStorage.getItem(AUTHOR_KEY) || '';
        const savedView = localStorage.getItem(VIEW_KEY);
        if (savedView === 'flat' || savedView === 'tree') this.view = savedView;
        const savedSort = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
        if (savedSort && ['prefix', 'updated', 'author'].includes(savedSort.key)) {
          this.sort = { key: savedSort.key, dir: savedSort.dir === 1 ? 1 : -1 };
        }
        const savedCollapsed = JSON.parse(localStorage.getItem(TREE_KEY) || '[]');
        if (Array.isArray(savedCollapsed)) this.collapsed = savedCollapsed.map(String);
      } catch { /* storage blocked */ }
    },

    setStatus(text, isError) {
      this.status = text;
      this.statusError = !!isError;
    },

    // ---- authors ----
    async loadAuthors() {
      const data = await api('/api/docs/authors');
      this.authors = data.authors || [];
    },

    get authorOptions() {
      const out = [{ value: '', label: 'all authors' }];
      for (const entry of this.authors) {
        if (entry.author) out.push({ value: entry.author, label: `${entry.author} (${entry.count})` });
      }
      if (this.authors.some((entry) => !entry.author)) out.push({ value: NO_AUTHOR, label: '— no author —' });
      if (this.author && !out.some((option) => option.value === this.author)) {
        out.push({ value: this.author, label: this.author });
      }
      return out;
    },

    // '' = every author, '__none__' = docs with no author, else that name.
    get authorParam() {
      return this.author === NO_AUTHOR ? '' : (this.author || undefined);
    },

    setAuthor(value) {
      this.author = value || '';
      try {
        if (this.author) localStorage.setItem(AUTHOR_KEY, this.author);
        else localStorage.removeItem(AUTHOR_KEY);
      } catch { /* storage blocked */ }
      this.loadList();
      if (this.searching) this.runSearch();
    },

    // ---- view + sort ----
    setView(view) {
      this.view = view === 'flat' ? 'flat' : 'tree';
      try { localStorage.setItem(VIEW_KEY, this.view); } catch { /* storage blocked */ }
    },

    setSort(key) {
      if (this.sort.key === key) this.sort.dir = -this.sort.dir;
      else this.sort = { key, dir: key === 'updated' ? -1 : 1 };
      try { localStorage.setItem(SORT_KEY, JSON.stringify(this.sort)); } catch { /* storage blocked */ }
    },

    get sortedDocs() {
      const { key, dir } = this.sort;
      const value = (doc) => {
        if (key === 'prefix') return doc.prefix.toLowerCase();
        if (key === 'author') return (doc.author || '').toLowerCase();
        return new Date(doc.updated_at).getTime() || 0;
      };
      return this.all.slice().sort((a, b) => {
        const left = value(a);
        const right = value(b);
        if (left === right) return a.prefix.localeCompare(b.prefix);
        return (left < right ? -1 : 1) * dir;
      });
    },

    // ---- tree ----
    setScope(prefix) {
      this.prefix = prefix || '';
      try {
        if (this.prefix) localStorage.setItem(SCOPE_KEY, this.prefix);
        else localStorage.removeItem(SCOPE_KEY);
      } catch { /* storage blocked */ }
      if (this.q || this.prefixQ) this.runSearch();
    },

    isCollapsed(path) {
      return this.collapsed.includes(path);
    },

    toggleFolder(path) {
      this.collapsed = this.isCollapsed(path)
        ? this.collapsed.filter((entry) => entry !== path)
        : [...this.collapsed, path];
      try { localStorage.setItem(TREE_KEY, JSON.stringify(this.collapsed)); } catch { /* storage blocked */ }
    },

    // Flatten the server tree into rows, skipping collapsed subtrees.
    get treeRows() {
      if (!this.tree) return [];
      const rows = [];
      const walk = (folders, depth) => {
        for (const folder of folders || []) {
          const open = !this.isCollapsed(folder.path);
          rows.push({
            kind: 'folder',
            key: `f:${folder.path}`,
            path: folder.path,
            name: folder.name,
            depth,
            total: folder.total,
            open,
            scoped: this.prefix === folder.path,
          });
          if (!open) continue;
          walk(folder.folders, depth + 1);
          const cached = this.folderDocs[folder.path];
          const docs = cached || folder.docs || [];
          for (const doc of docs) rows.push(this.docRow(doc, depth + 1));
          const more = cached ? 0 : folder.more;
          if (more > 0) {
            rows.push({ kind: 'more', key: `m:${folder.path}`, path: folder.path, depth, more });
          }
        }
      };
      walk(this.tree.folders, 0);
      for (const doc of this.tree.docs || []) rows.push(this.docRow({ ...doc, name: doc.prefix }, 0));
      if (this.tree.more > 0) rows.push({ kind: 'more', key: 'm:root', path: '', depth: 0, more: this.tree.more });
      return rows;
    },

    docRow(doc, depth) {
      return {
        kind: 'doc',
        key: `d:${doc.prefix}`,
        prefix: doc.prefix,
        name: doc.name || doc.prefix.split('/').pop(),
        author: doc.author,
        cards: doc.card_count || 0,
        depth,
        selected: !!this.current && this.current.prefix === doc.prefix,
      };
    },

    async showMore(row) {
      try {
        if (row.path) {
          const data = await api(`/api/docs?${new URLSearchParams({ prefix: row.path, limit: String(LIST_LIMIT) })}`);
          const docs = data.docs
            .map((doc) => ({ ...doc, name: doc.prefix.split('/').pop() }))
            .sort((a, b) => a.name.localeCompare(b.name));
          this.folderDocs = { ...this.folderDocs, [row.path]: docs };
        } else {
          const data = await api(`/api/docs?${new URLSearchParams({ limit: String(LIST_LIMIT) })}`);
          const roots = data.docs
            .filter((doc) => !doc.prefix.includes('/'))
            .map((doc) => ({ ...doc, name: doc.prefix }))
            .sort((a, b) => a.name.localeCompare(b.name));
          this.tree = { ...this.tree, docs: roots, more: 0 };
        }
      } catch (err) {
        this.setStatus(`load failed: ${err.message}`, true);
      }
    },

    // ---- list + search ----
    get searching() {
      return this.q.length >= SEARCH_MIN || this.prefixQ.length > 0;
    },

    get listRows() {
      if (this.searching) {
        const exact = Object.values(this.hits).map((hit) => ({ ...hit, kind: 'exact' }));
        const seen = new Set(exact.map((hit) => hit.prefix));
        const semantic = Object.values(this.semantic)
          .filter((hit) => !seen.has(hit.prefix))
          .map((hit) => ({ ...hit, kind: 'semantic' }));
        return [...exact, ...semantic];
      }
      const base = this.prefix
        ? this.all.filter((doc) => doc.prefix === this.prefix || doc.prefix.startsWith(`${this.prefix}/`))
        : this.all;
      return this.view === 'flat' ? this.sortedDocs : base;
    },

    get semanticRows() {
      if (!this.searching) return [];
      const seen = new Set(Object.keys(this.hits));
      return Object.values(this.semantic).filter((hit) => !seen.has(hit.prefix));
    },

    // In flat mode the list is one line per doc; in tree mode it is cards.
    get flatMode() {
      return this.view === 'flat' && !this.searching;
    },

    get listVisible() {
      return this.view === 'flat' || this.searching || !!this.prefix;
    },

    get emptyListText() {
      if (this.searching) {
        return this.q ? `no exact matches for “${this.q}”` : `no docs under prefix “${this.prefixQ}”`;
      }
      return 'no docs yet';
    },

    get countText() {
      const total = this.all.length;
      if (this.searching) {
        const exact = Object.keys(this.hits).length;
        const semantic = this.semanticRows.length;
        return `${exact} exact${semantic ? ` · ${semantic} semantic` : ''} · ${total} doc${total === 1 ? '' : 's'}`;
      }
      if (this.view === 'flat') return `${total} doc${total === 1 ? '' : 's'} · sorted by ${this.sort.key}`;
      return `${total} doc${total === 1 ? '' : 's'}${this.prefix ? ` under ${this.prefix}` : ''}`;
    },

    async loadList() {
      const listParams = new URLSearchParams({ limit: String(LIST_LIMIT) });
      const treeParams = new URLSearchParams({ per: '5' });
      if (this.authorParam !== undefined) {
        listParams.set('author', this.authorParam);
        treeParams.set('author', this.authorParam);
      }
      const [list, tree] = await Promise.all([
        api(`/api/docs?${listParams}`),
        api(`/api/docs/tree?${treeParams}`),
      ]);
      this.all = list.docs || [];
      this.tree = tree;
      this.folderDocs = {};
    },

    async refresh() {
      try {
        await this.loadList();
        this.setStatus(`synced ${new Date().toLocaleTimeString([], { hour12: false })}`);
      } catch (err) {
        this.setStatus(`load failed: ${err.message}`, true);
      }
    },

    onSearchInput() {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.runSearch(), 180);
    },

    async runSearch() {
      const q = this.q.trim();
      const prefixQ = this.prefixQ.trim();
      this.q = q;
      this.prefixQ = prefixQ;
      if (!this.searching) {
        this.hits = {};
        this.semantic = {};
        this.semanticNote = '';
        return;
      }
      this.semantic = {};
      this.semanticNote = '';
      const seq = ++this.seq;
      try {
        const params = new URLSearchParams({ q, limit: String(LIST_LIMIT) });
        if (this.prefix) params.set('prefix', this.prefix);
        if (prefixQ) params.set('prefix_q', prefixQ);
        if (this.authorParam !== undefined) params.set('author', this.authorParam);
        const data = await api(`/api/docs/search?${params}`);
        if (seq !== this.seq) return;
        this.hits = Object.fromEntries(data.hits.map((hit) => [hit.prefix, hit]));
        this.setStatus(`${data.count} of ${data.total} exact match${prefixQ ? ` · prefix ${prefixQ}` : ''}`);
        this.loadSemantic(q, seq);
      } catch (err) {
        if (seq !== this.seq) return;
        this.hits = {};
        this.setStatus(`search failed: ${err.message}`, true);
      }
    },

    async loadSemantic(q, seq) {
      if (!q) return;
      try {
        const params = new URLSearchParams({ q, limit: '10' });
        if (this.prefix) params.set('prefix', this.prefix);
        if (this.prefixQ) params.set('prefix_q', this.prefixQ);
        if (this.authorParam !== undefined) params.set('author', this.authorParam);
        const data = await api(`/api/docs/semantic?${params}`);
        if (seq !== this.seq) return;
        this.semantic = Object.fromEntries(data.hits.map((hit) => [hit.prefix, hit]));
        this.setStatus(
          `${Object.keys(this.hits).length} exact · ${data.hits.length} semantic · ${data.took_ms}ms`
          + (data.pending ? ` · ${data.pending} unindexed` : ''),
        );
      } catch (err) {
        if (seq !== this.seq) return;
        this.semantic = {};
        this.semanticNote = `semantic unavailable · ${err.message}`;
        this.setStatus(`exact only · ${err.message}`, true);
      }
    },

    clearSearch() {
      this.q = '';
      this.prefixQ = '';
      this.hits = {};
      this.semantic = {};
      this.setStatus(`cleared · ${this.all.length} docs`);
    },

    // ---- editor ----
    async selectDoc(prefix) {
      if (this.dirty && this.current && !window.confirm('Discard unsaved changes?')) return;
      try {
        const doc = await api(docPath(prefix));
        this.fillEditor(doc);
        this.setStatus(`opened ${doc.prefix}`);
      } catch (err) {
        this.setStatus(`open failed: ${err.message}`, true);
      }
    },

    fillEditor(doc) {
      this.current = doc;
      this.form = {
        prefix: doc ? doc.prefix : '',
        author: doc?.author || '',
        tags: (doc?.tags || []).join(', '),
        content: doc?.content || '',
      };
      this.dirty = false;
      this.editorOpen = true;
      this.backlinks = doc;
      this.docStatus = doc
        ? `rev ${doc.revision} · created ${fmtTime(doc.created_at)} · updated ${fmtTime(doc.updated_at)}`
        : 'new doc';
      this.$nextTick(() => {
        if (doc) paintBacklinks(this.$refs.backlinks, doc, (tag, cls, text) => {
          const node = document.createElement(tag);
          if (cls) node.className = cls;
          if (text !== undefined) node.textContent = text;
          return node;
        });
        else this.$refs.backlinks.replaceChildren();
      });
    },

    startNew() {
      if (this.dirty && this.current && !window.confirm('Discard unsaved changes?')) return;
      this.fillEditor(null);
      this.$nextTick(() => this.$refs.prefix?.focus());
    },

    markDirty() {
      if (!this.current && !this.form.prefix.trim()) return;
      if (!this.dirty) {
        this.dirty = true;
        this.docStatus = 'unsaved changes';
      }
    },

    async save() {
      const prefix = this.form.prefix.trim().replace(/^\/+|\/+$/g, '');
      if (!prefix) {
        this.setStatus('prefix is required', true);
        this.$refs.prefix?.focus();
        return;
      }
      const body = {
        content: this.form.content,
        author: this.form.author.trim() || null,
        tags: this.form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      };
      try {
        const doc = await api(docPath(prefix), { method: 'PUT', body: JSON.stringify(body) });
        this.fillEditor(doc);
        this.setStatus(`saved ${doc.prefix} · rev ${doc.revision}`);
        await this.refresh();
        if (this.q || this.prefixQ) await this.runSearch();
      } catch (err) {
        this.setStatus(`save failed: ${err.message}`, true);
      }
    },

    async remove() {
      if (!this.current) return;
      const prefix = this.current.prefix;
      try {
        await api(docPath(prefix), { method: 'DELETE' });
        this.current = null;
        this.editorOpen = false;
        this.q = '';
        this.hits = {};
        this.setStatus(`deleted ${prefix}`);
        await this.refresh();
      } catch (err) {
        this.setStatus(`delete failed: ${err.message}`, true);
      }
    },

    armDelete(button) {
      armDelete(button, () => this.remove());
    },

    onEditorKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        this.save();
      }
    },

    onEscape(event) {
      if (document.body.dataset.view !== 'docs') return;
      const active = document.activeElement;
      if (event.key === 'Escape' && (active === this.$refs.search || active === this.$refs.prefixQ)) {
        this.clearSearch();
      }
    },

    markedParts,
    docPath,
    fmtTime,
    tagLabel,
  };
}

export function mount(el, openPrefix = '') {
  if (!el) return;
  if (el.dataset.mounted) {
    const view = el._x_dataStack?.[0];
    view?.refresh().then(() => { if (openPrefix) view.selectDoc(openPrefix); });
    return;
  }
  el.dataset.mounted = '1';
  Alpine.data('docsView', () => docsView(openPrefix));
  delete el._x_ignore;
  delete el._x_ignoreSelf;
  Alpine.mutateDom(() => {
    el.removeAttribute('x-ignore');
    el.setAttribute('x-data', 'docsView');
  });
  Alpine.initTree(el);
}
