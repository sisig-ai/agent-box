// Progress Bars view: shared 0-100 bars, nested children, k-v fields.
// Alpine component: state, dialog and polling live here; the card tree is a
// recursion, which Alpine templates cannot express, so it is built as an HTML
// string from one pure function and bound with x-html.

import Alpine from '../alpine.js';
import { esc } from '../dom.js';
import { openModal } from '../modal.js';
import * as attention from '../attention.js?v=attention8';

const API = '/api/progress';
const POLL_MS = 10000;

let instance = null;

const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
const pctText = (n) => {
  const v = clamp(n);
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
};

function flatten(list, depth = 0, out = []) {
  for (const bar of list || []) {
    out.push({ ...bar, _depth: depth });
    flatten(bar.children || [], depth + 1, out);
  }
  return out;
}

function subtreeIds(bar) {
  return flatten([bar]).map((node) => node.id);
}

function fieldsHtml(fields) {
  const entries = Object.entries(fields || {});
  if (!entries.length) return '';
  const pairs = entries.map(([key, value]) => {
    const shown = value === null || value === undefined || value === '' ? '—' : value;
    return `<dt>${esc(key)}</dt><dd>${esc(shown)}</dd>`;
  });
  return `<dl class="pb-fields">${pairs.join('')}</dl>`;
}

function cardHtml(bar, depth = 0) {
  const kids = bar.children || [];
  const done = clamp(bar.percent) >= 100;
  const archived = !!bar.archived_at;
  return `
<article class="pb-card${done ? ' is-done' : ''}${archived ? ' is-archived' : ''}" data-id="${bar.id}" data-depth="${depth}">
  <div class="pb-card-head">
    <div class="pb-heading">
      <span class="pb-name">${esc(bar.title)}</span>
      ${bar.owner ? `<span class="pb-owner">${esc(bar.owner)}</span>` : ''}
      ${done ? '<span class="pb-done-tag">done</span>' : ''}
      ${archived ? '<span class="kb-badge kb-badge-archived">archived</span>' : ''}
    </div>
    <div class="pb-actions">
      ${archived ? '' : `<button type="button" class="pb-act" data-act="child" data-id="${bar.id}" title="Add a nested bar">+ child</button>`}
      ${archived ? '' : `<button type="button" class="pb-act" data-act="edit" data-id="${bar.id}" title="Edit this bar">edit</button>`}
      ${archived
        ? `<button type="button" class="pb-act" data-act="restore" data-id="${bar.id}" title="Restore this bar and its nested bars">restore</button>`
        : `<button type="button" class="pb-act" data-act="archive" data-id="${bar.id}" title="Archive this bar and its nested bars">archive</button>`}
      <button type="button" class="pb-act" data-act="delete" data-id="${bar.id}" title="Delete this bar">del</button>
    </div>
  </div>
  <div class="pb-meter-row">
    <span class="pb-pct">${pctText(bar.percent)}</span>
    <span class="pb-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${clamp(bar.percent)}" aria-label="${esc(bar.title)}"><i style="width:${clamp(bar.percent)}%"></i></span>
  </div>
  ${fieldsHtml(bar.fields)}
  ${kids.length ? `<div class="pb-children">${kids.map((kid) => cardHtml(kid, depth + 1)).join('')}</div>` : ''}
</article>`;
}

function barSignature(bar) {
  return [bar.updated_at, bar.title, bar.percent, bar.owner, bar.archived_at, JSON.stringify(bar.fields || {})].join('|');
}

export function progressView() {
  return {
    bars: [],
    total: 0,
    archivedCount: 0,
    archivedOnly: false,
    archiveArmed: false,
    archiveTimer: 0,
    status: 'loading…',
    failed: false,
    editingId: null,
    error: '',
    fields: [],
    form: { title: '', percent: '', owner: '', parent: '' },
    timer: 0,
    attentionPending: true,

    init() {
      instance = this;
      this.refresh();
      this.timer = setInterval(() => this.poll(), POLL_MS);
      this.onVisible = () => {
        if (!document.hidden && document.body.dataset.view === 'progress') this.enter();
      };
      document.addEventListener('visibilitychange', this.onVisible);
    },

    destroy() {
      clearInterval(this.timer);
      clearTimeout(this.archiveTimer);
      document.removeEventListener('visibilitychange', this.onVisible);
    },

    poll() {
      if (document.body.dataset.view !== 'progress') return;
      if (this.$refs.dialog?.open) return;
      this.refresh();
    },

    // Entering the tab refreshes and replays the attention pass over new data.
    enter() {
      this.attentionPending = true;
      return this.refresh();
    },

    get gridHtml() {
      if (!this.bars.length) {
        return this.archivedOnly
          ? '<p class="pb-empty">// no archived progress bars</p>'
          : '<p class="pb-empty">// no progress bars yet — [+ bar] to start one</p>';
      }
      return this.bars.map((bar) => cardHtml(bar)).join('');
    },

    get countText() {
      const roots = this.bars.length;
      if (this.archivedOnly) {
        return `${roots} archived top-level · ${this.total} bar${this.total === 1 ? '' : 's'} · restore to bring them back`;
      }
      return `${roots} top-level · ${this.total} bar${this.total === 1 ? '' : 's'}`
        + (this.archivedCount ? ` · ${this.archivedCount} archived` : '')
        + ' · shared with agents';
    },

    get archivedLabel() {
      return this.archivedCount ? `archived ${this.archivedCount}` : 'archived';
    },

    // Bulk archive: every live bar at 100% plus its subtree. Two-click arm,
    // same contract as the Ops Board's Archive Done.
    get doneCount() {
      return flatten(this.bars).filter((bar) => !bar.archived_at && clamp(bar.percent) >= 100)
        .length;
    },

    get archiveDisabled() {
      return this.doneCount === 0;
    },

    get archiveLabel() {
      return this.archiveArmed ? `archive ${this.doneCount}?` : 'archive done';
    },

    get archiveTitle() {
      return this.archiveDisabled
        ? 'No bar is at 100% yet'
        : `Archive all ${this.doneCount} finished bar(s) and their children (click twice)`;
    },

    archiveDone() {
      if (this.archiveDisabled) return;
      if (!this.archiveArmed) {
        this.archiveArmed = true;
        clearTimeout(this.archiveTimer);
        this.archiveTimer = setTimeout(() => {
          this.archiveArmed = false;
        }, 3000);
        return;
      }
      clearTimeout(this.archiveTimer);
      this.archiveArmed = false;
      return (async () => {
        try {
          const res = await fetch(`${API}/archive-done`, { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          await this.refresh();
          const n = data.archived || 0;
          this.status = n ? `archived ${n} bar${n === 1 ? '' : 's'}` : 'nothing at 100% to archive';
        } catch (err) {
          this.status = `archive failed — ${err.message}`;
        }
      })();
    },

    // Parent choices: every bar except the edited one and its descendants.
    get parentOptions() {
      const edited = this.editingId == null ? null : this.find(this.editingId);
      const blocked = edited ? new Set(subtreeIds(edited)) : new Set();
      return flatten(this.bars)
        .filter((node) => !blocked.has(node.id))
        .map((node) => ({ id: node.id, label: `${'· '.repeat(node._depth)}${node.title}` }));
    },

    find(id, list = this.bars) {
      for (const bar of list || []) {
        if (bar.id === id) return bar;
        const hit = this.find(id, bar.children || []);
        if (hit) return hit;
      }
      return null;
    },

    async refresh() {
      try {
        const url = this.archivedOnly ? `${API}?archived=only` : API;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        this.bars = data.bars || [];
        this.total = data.count ?? flatten(this.bars).length;
        this.archivedCount = data.archived_count ?? 0;
        this.failed = false;
        this.status = `synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        this.$nextTick(() => this.runAttention());
      } catch (err) {
        this.failed = true;
        this.status = `load failed — ${err.message}`;
      }
    },

    toggleArchived() {
      this.archivedOnly = !this.archivedOnly;
      if (!this.archivedOnly) this.attentionPending = true;
      return this.refresh();
    },

    // One delegated handler for every card button in the x-html tree.
    onAction(event) {
      const btn = event.target.closest('button[data-act]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const bar = this.find(id);
      const act = btn.dataset.act;
      if (act === 'edit' && bar) this.openDialog(bar);
      else if (act === 'child') this.openDialog(null, id);
      else if (act === 'archive') this.setArchived(id, true);
      else if (act === 'restore') this.setArchived(id, false);
      else if (act === 'delete') this.remove(id);
    },

    openDialog(bar, parentId = null) {
      this.editingId = bar ? bar.id : null;
      this.form.title = bar ? bar.title : '';
      this.form.percent = bar ? clamp(bar.percent) : '';
      this.form.owner = (bar && bar.owner) || '';
      const chosen = bar ? bar.parent_id : parentId;
      this.form.parent = chosen == null ? '' : String(chosen);
      this.fields = Object.entries((bar && bar.fields) || {})
        .map(([key, value]) => ({ key, value: value == null ? '' : String(value) }));
      this.error = '';
      this.$refs.dialog.showModal();
      this.$nextTick(() => this.$refs.title?.focus());
    },

    addField() {
      this.fields.push({ key: '', value: '' });
      this.$nextTick(() => {
        const rows = this.$el.querySelectorAll('.pb-field-row .pb-field-key');
        rows[rows.length - 1]?.focus();
      });
    },

    async save() {
      const title = this.form.title.trim();
      if (!title) { this.error = 'title is required'; return; }
      const percent = this.form.percent === '' ? 0 : Number(this.form.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        this.error = 'percent must be between 0 and 100';
        return;
      }
      const fields = {};
      for (const row of this.fields) {
        const key = (row.key || '').trim();
        if (key) fields[key] = row.value;
      }
      const body = {
        title,
        percent,
        owner: this.form.owner.trim() || null,
        fields,
        parent_id: this.form.parent ? Number(this.form.parent) : null,
      };
      const isEdit = this.editingId != null;
      try {
        const res = await fetch(isEdit ? `${API}/${this.editingId}` : API, {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.error = data.error || `HTTP ${res.status}`; return; }
        this.$refs.dialog.close();
        await this.refresh();
      } catch (err) {
        this.error = `save failed — ${err.message}`;
      }
    },

    async remove(id) {
      const bar = this.find(id);
      if (!bar) return;
      const kids = flatten(bar.children || []).length;
      const ok = await openModal({
        title: 'delete progress bar',
        text: kids
          ? `“${bar.title}” and its ${kids} nested bar${kids === 1 ? '' : 's'} will be deleted.`
          : `“${bar.title}” will be deleted.`,
        ok: 'delete',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await fetch(`${API}/${id}${kids ? '?cascade=1' : ''}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        await this.refresh();
      } catch (err) {
        this.status = `delete failed — ${err.message}`;
      }
    },

    async setArchived(id, archived) {
      const bar = this.find(id);
      if (!bar) return;
      const count = flatten([bar]).length;
      try {
        const res = await fetch(`${API}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await this.refresh();
        this.status = archived
          ? `archived “${bar.title}”${count > 1 ? ` and ${count - 1} nested bar${count === 2 ? '' : 's'}` : ''}`
          : `restored “${bar.title}”${count > 1 ? ` and ${count - 1} nested bar${count === 2 ? '' : 's'}` : ''}`;
      } catch (err) {
        this.status = `${archived ? 'archive' : 'restore'} failed — ${err.message}`;
      }
    },

    // Draw the eye to bars that changed since the last visit.
    runAttention() {
      if (this.archivedOnly || !this.attentionPending) return;
      this.attentionPending = false;
      const nodes = new Map();
      this.$el.querySelectorAll('#progress-grid .pb-card[data-id]').forEach((node) => {
        nodes.set(Number(node.dataset.id), node);
      });
      const items = flatten(this.bars)
        .map((bar) => ({ id: bar.id, el: nodes.get(bar.id), sig: barSignature(bar) }))
        .filter((item) => item.el);
      attention.visit('progress', items, {
        allIds: flatten(this.bars).map((bar) => bar.id),
        meter: (el) => el.querySelector('.pb-meter'),
      });
    },
  };
}

export function mount(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  Alpine.data('progressView', progressView);
  delete el._x_ignore;
  delete el._x_ignoreSelf;
  Alpine.mutateDom(() => {
    el.removeAttribute('x-ignore');
    el.setAttribute('x-data', 'progressView');
  });
  Alpine.initTree(el);
}

// Router hook: a second visit only replays the attention pass.
export function enter() {
  instance?.enter();
}
