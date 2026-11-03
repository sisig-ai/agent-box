// Entry actions for the files explorer: selection, details, download, the
// editor round trip, and create/rename/delete. Methods run with the Alpine
// component as `this`.

import { openModal } from '../modal.js';
import * as editor from './editor.js';
import { fileIcon, fmtSize, fmtTime } from './format.js';

export const entryActions = {
  // ---- selection + details ----
  async select(entry) {
    this.selected = entry;
    this.renderInfo(entry, null);
    try {
      const res = await fetch(`/api/fs/stat?path=${encodeURIComponent(entry.path)}`);
      if (!res.ok) return;
      const detail = await res.json();
      if (this.selected && this.selected.path === entry.path) this.renderInfo(entry, detail);
    } catch { /* details are optional */ }
  },

  isSelected(entry) {
    return !!this.selected && this.selected.path === entry.path;
  },

  renderInfo(entry, detail) {
    const rows = [];
    const add = (k, v) => { if (v != null && v !== '') rows.push({ k, v }); };
    add('Type', entry.is_link ? `symlink${entry.is_dir ? ' → folder' : ''}` : entry.type);
    if (detail && detail.link_target) add('Target', detail.link_target);
    if (!entry.is_dir) {
      const exact = Number(entry.size || 0);
      add('Size', exact < 1024 ? `${exact} B` : `${fmtSize(entry.size)} (${exact.toLocaleString()} B)`);
    }
    add('Modified', detail && detail.mtime_iso ? new Date(detail.mtime_iso).toLocaleString() : fmtTime(entry.mtime));
    if (detail && detail.btime_iso) add('Created', new Date(detail.btime_iso).toLocaleString());
    add('Mode', entry.mode);
    if (detail && detail.owner) add('Owner', detail.owner + (detail.group ? `:${detail.group}` : ''));
    if (detail && detail.mime) add('Mime', detail.mime);
    add('Access', [entry.readable ? 'read' : null, entry.writable ? 'write' : null].filter(Boolean).join(' · ') || 'none');
    add('Path', entry.path);
    this.info = { name: entry.name, icon: fileIcon(entry), rows };
  },

  // ---- editor ----
  async openEntry(entry) {
    if (!entry || entry.is_dir) { if (entry) this.cd(entry.path); return; }
    this.setStatus(`opening ${entry.name}…`);
    let res;
    try {
      res = await fetch(`/api/fs/read?path=${encodeURIComponent(entry.path)}`);
    } catch {
      this.setStatus('network error', true);
      return;
    }
    if (res.status === 413 || res.status === 415) {
      const d = await res.json().catch(() => ({}));
      this.setStatus(`${d.error || 'not editable'} — downloading ${entry.name}`);
      this.download(entry);
      return;
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      this.setStatus(d.error || `could not open file (${res.status})`, true);
      return;
    }
    const d = await res.json();
    this.editor = { open: true, name: d.name, path: d.path, dirty: false, status: d.path };
    this.setStatus(`editing ${d.name}`);
    this.$nextTick(async () => {
      const result = await editor.open(this.$refs.host, {
        path: d.path,
        name: d.name,
        text: d.text,
        onDirty: (dirty) => { this.editor.dirty = dirty; },
        onSave: () => this.saveEditor(),
        onClose: () => this.closeEditor(),
      });
      if (result.error) this.editor.status = result.error;
    });
  },

  async saveEditor() {
    if (!this.editor.open) return;
    const content = editor.value();
    this.editor.status = 'saving…';
    let res;
    try {
      res = await fetch('/api/fs/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.editor.path, content }),
      });
    } catch {
      this.editor.status = 'save failed — network error';
      this.setStatus('save failed — network error', true);
      return;
    }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = d.error || `save failed (${res.status})`;
      this.editor.status = msg;
      this.setStatus(msg, true);
      return;
    }
    editor.markSaved(content);
    this.editor.dirty = false;
    this.editor.status = `saved ${this.editor.name}`;
    this.setStatus(`saved ${this.editor.name}`);
  },

  async closeEditor() {
    if (!this.editor.open) return true;
    if (this.editor.dirty) {
      const ok = await openModal({
        title: 'Discard changes?',
        text: `“${this.editor.name}” has unsaved changes.`,
        ok: 'Discard',
        danger: true,
      });
      if (!ok) return false;
    }
    editor.destroy();
    this.editor = { open: false, name: '', path: '', dirty: false, status: '' };
    this.setStatus('editor closed');
    return true;
  },

  // ---- create / download ----
  async newFolder() {
    const name = await openModal({ title: 'New folder', input: true, value: 'untitled folder', ok: 'Create' });
    if (name == null) return;
    const r = await this.api('/api/fs/mkdir', 'POST', { parent: this.cwd, name });
    if (r) { await this.load(this.cwd); this.setStatus(`created folder ${r.name}`); }
  },

  async newFile() {
    const name = await openModal({ title: 'New empty file', input: true, value: 'untitled.txt', ok: 'Create' });
    if (name == null) return;
    const r = await this.api('/api/fs/touch', 'POST', { parent: this.cwd, name });
    if (r) { await this.load(this.cwd); this.setStatus(`created file ${r.name}`); }
  },

  download(entry) {
    if (!entry || entry.is_dir) return;
    const a = document.createElement('a');
    a.href = `/api/fs/download?path=${encodeURIComponent(entry.path)}`;
    a.download = entry.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.setStatus(`downloading ${entry.name}…`);
  },

  downloadCurrent() {
    if (!this.editor.open) return;
    const blob = new Blob([editor.value()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.editor.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  async rename(entry) {
    const name = await openModal({ title: 'Rename', input: true, value: entry.name, ok: 'Rename' });
    if (name == null || name === entry.name) return;
    const r = await this.api('/api/fs/rename', 'POST', { path: entry.path, name });
    if (r) { await this.load(this.cwd); this.setStatus(`renamed to ${r.name}`); }
  },

  async remove(entry) {
    const ok = await openModal({
      title: entry.is_dir ? 'Delete folder?' : `Delete ${entry.type === 'link' ? 'symlink' : 'file'}?`,
      text: entry.is_dir
        ? `“${entry.name}” and everything inside it will be deleted.`
        : `“${entry.name}” will be deleted.`,
      ok: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const r = await this.api(`/api/fs?path=${encodeURIComponent(entry.path)}`, 'DELETE');
    if (r) {
      if (this.selected && this.selected.path === entry.path) {
        this.selected = null;
        this.info = null;
      }
      await this.load(this.cwd);
      this.setStatus(`deleted ${entry.name}`);
    }
  },
};
