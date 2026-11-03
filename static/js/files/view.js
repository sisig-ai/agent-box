// Files explorer: folder table, breadcrumb, places, details and the editor.
// Alpine component. CodeMirror stays imperative in editor.js, uploads still go
// through XHR for progress, and the entry actions are a mixin in actions.js.

import Alpine from '../alpine.js';
import { entryActions } from './actions.js';
import { openModal } from '../modal.js';
import { fileIcon, fmtSize, fmtTime, xhrUpload } from './format.js';

export function filesView() {
  return {
    cwd: null,
    home: null,
    parentPath: null,
    entries: [],
    places: [],
    selected: null,
    sortKey: 'name',
    sortDir: 1,
    showHidden: true,
    status: 'opening ~ …',
    statusError: false,
    dragging: false,
    info: null,
    editor: { open: false, name: '', path: '', dirty: false, status: '' },

    ...entryActions,
    fileIcon,
    fmtSize,
    fmtTime,

    init() {
      this.load(null);
      this.onKey = (event) => this.handleKey(event);
      document.addEventListener('keydown', this.onKey);
    },

    destroy() {
      document.removeEventListener('keydown', this.onKey);
    },

    // ---- data ----
    async load(path) {
      this.setStatus('loading…');
      const url = '/api/fs/list' + (path ? `?path=${encodeURIComponent(path)}` : '');
      try {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          this.setStatus(data.error || `could not open folder (${res.status})`, true);
          return false;
        }
        this.cwd = data.path;
        this.home = data.home;
        this.parentPath = data.parent;
        this.entries = data.entries || [];
        this.places = data.places || [];
        this.selected = null;
        this.info = null;
        this.setStatus(`opened ${this.cwd}`);
        return true;
      } catch {
        this.setStatus('network error', true);
        return false;
      }
    },

    setStatus(text, isError) {
      this.status = text;
      this.statusError = !!isError;
    },

    async api(url, method, body) {
      try {
        const opts = { method: method || 'GET' };
        if (body !== undefined) {
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          this.setStatus(data.error || `request failed (${res.status})`, true);
          return null;
        }
        return data;
      } catch {
        this.setStatus('network error', true);
        return null;
      }
    },

    // ---- navigation ----
    async cd(path) {
      if (!(await this.closeEditor())) return;
      await this.load(path);
    },

    up() {
      if (this.parentPath) this.cd(this.parentPath);
    },

    goHome() {
      if (this.home) this.cd(this.home);
    },

    async refresh() {
      if (this.cwd && await this.closeEditor()) await this.load(this.cwd);
    },

    // ---- table ----
    get visible() {
      const list = this.entries
        .filter((entry) => this.showHidden || !entry.hidden)
        .slice();
      const { sortKey, sortDir } = this;
      list.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        let r;
        if (sortKey === 'size') r = (a.size || 0) - (b.size || 0);
        else if (sortKey === 'mtime') r = (a.mtime || 0) - (b.mtime || 0);
        else if (sortKey === 'mode') r = String(a.mode).localeCompare(String(b.mode));
        else r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        return r * sortDir;
      });
      return list;
    },

    get countText() {
      const n = this.visible.length;
      return `${n} item${n === 1 ? '' : 's'}`;
    },

    get crumbs() {
      if (!this.cwd) return [];
      const out = [{ key: 'root', label: '/', path: '/', current: this.cwd === '/' }];
      let acc = '';
      const parts = this.cwd.split('/').filter(Boolean);
      parts.forEach((part, i) => {
        acc += `/${part}`;
        out.push({ key: `sep-${i}`, sep: true, label: '/' });
        out.push({ key: acc, label: part, path: acc, current: i === parts.length - 1 });
      });
      return out;
    },

    get placeLabel() {
      return (path) => (this.home && path.startsWith(this.home) ? `~${path.slice(this.home.length)}` : path);
    },

    sortBy(key) {
      if (this.sortKey === key) this.sortDir *= -1;
      else { this.sortKey = key; this.sortDir = 1; }
    },

    isSorted(key) {
      return this.sortKey === key;
    },

    sortAsc(key) {
      return this.sortKey === key && this.sortDir === 1;
    },

    toggleHidden() {
      this.showHidden = !this.showHidden;
    },

    // ---- upload ----
    async upload(files) {
      const list = Array.from(files || []);
      if (!list.length) return;
      let done = 0;
      for (const file of list) {
        const clash = this.entries.some((entry) => entry.name === file.name);
        let overwrite = false;
        if (clash) {
          const ok = await openModal({
            title: 'Overwrite file?',
            text: `“${file.name}” already exists in this folder.`,
            ok: 'Overwrite',
            danger: true,
          });
          if (!ok) continue;
          overwrite = true;
        }
        const res = await xhrUpload(this.cwd, file, overwrite, (pct) => {
          this.setStatus(`uploading ${file.name} — ${pct}%`);
        });
        if (res.error) { this.setStatus(res.error, true); continue; }
        done++;
      }
      this.$refs.upload.value = '';
      if (done) {
        await this.load(this.cwd);
        this.setStatus(`uploaded ${done} file${done === 1 ? '' : 's'}`);
      }
    },

    onDrop(event) {
      this.dragging = false;
      if (event.dataTransfer?.files?.length) this.upload(event.dataTransfer.files);
    },

    // ---- keyboard ----
    handleKey(event) {
      if (document.body.dataset.view !== 'files') return;
      if (!document.getElementById('fs-modal')?.hidden) return;
      if (this.editor.open) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'Backspace') { event.preventDefault(); this.up(); }
      else if (event.key === 'Enter' && this.selected) {
        event.preventDefault();
        if (this.selected.is_dir) this.cd(this.selected.path);
        else this.openEntry(this.selected);
      } else if (event.key === 'Delete' && this.selected) {
        event.preventDefault();
        this.remove(this.selected);
      } else if (event.key.toLowerCase() === 'r' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.refresh();
      }
    },
  };
}

export function mount(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  Alpine.data('filesView', filesView);
  delete el._x_ignore;
  delete el._x_ignoreSelf;
  Alpine.mutateDom(() => {
    el.removeAttribute('x-ignore');
    el.setAttribute('x-data', 'filesView');
  });
  Alpine.initTree(el);
}
