// Docs editor behaviour for the view component: select, fill, save, delete.
// Runs with the component as `this`.

import { armDelete } from '../kanban/edit.js?v=kanban29';
import { paintBacklinks } from './backlinks.js?v=alpine8';
import { docPath, fmtTime } from './format.js?v=alpine8';
import { api } from './lib.js';

export const editorActions = {
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
};
