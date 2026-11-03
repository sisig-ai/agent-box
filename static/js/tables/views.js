// Saved table views: pick one, see its filters and ordering, edit or delete it.

import { openModal } from '../modal.js';
import { api } from './api.js?v=tables8';

export const OPS = [
  ['eq', 'is'],
  ['neq', 'is not'],
  ['contains', 'contains'],
  ['starts_with', 'starts with'],
  ['gt', '>'],
  ['gte', '>='],
  ['lt', '<'],
  ['lte', '<='],
  ['is_empty', 'is empty'],
  ['is_not_empty', 'is not empty'],
];

export const viewActions = {
  ops: OPS,

  // Plain method, not a getter: spreading a mixin evaluates getters early.
  currentView() {
    return this.views.find((view) => view.name === this.view) || null;
  },

  async loadViews() {
    if (!this.table) {
      this.views = [];
      return;
    }
    try {
      const data = await api(`/api/tables/${this.table.id}/views`);
      this.views = data.views || [];
      // x-for rebuilds the options; re-apply the selection once they exist.
      this.$nextTick(() => {
        const select = this.$el.querySelector('.tbl-view-pick select');
        if (select) select.value = this.view;
      });
    } catch {
      this.views = [];
    }
  },

  applyView(name) {
    this.view = name || '';
    const config = this.currentView()?.config || {};
    this.orderBy = config.order_by || null;
    this.order = config.order || 'asc';
    if (this.table) this.openTable(this.current, false);
  },

  openViewDialog(view = null) {
    this.viewEditing = view || null;
    const config = view?.config || {};
    this.viewDraft = {
      name: view?.name || '',
      orderBy: config.order_by || '',
      order: config.order || 'asc',
      filters: (config.filters || []).map((filter) => ({
        column: filter.column,
        op: filter.op || 'eq',
        value: filter.value === null || filter.value === undefined ? '' : String(filter.value),
      })),
    };
    if (!this.viewDraft.filters.length) this.addFilter();
    this.viewOpen = true;
    this.$nextTick(() => {
      this.$refs.viewDialog?.showModal();
      this.$refs.viewName?.focus();
    });
  },

  addFilter() {
    this.viewDraft.filters.push({
      column: this.columns[0]?.name || '',
      op: 'eq',
      value: '',
    });
  },

  removeFilter(index) {
    this.viewDraft.filters.splice(index, 1);
  },

  // Filters send typed values: booleans as true/false, numbers as numbers.
  viewConfig() {
    const filters = [];
    for (const filter of this.viewDraft.filters) {
      if (!filter.column) continue;
      const column = this.columns.find((c) => c.name === filter.column);
      let value = filter.value;
      if (filter.op === 'is_empty' || filter.op === 'is_not_empty') value = null;
      else if (column?.type === 'bool') value = String(value).toLowerCase() === 'true';
      else if (column?.type === 'number') value = value === '' ? null : Number(value);
      else if (column?.type === 'ref') value = value === '' ? null : Number(value);
      filters.push({ column: filter.column, op: filter.op, value });
    }
    return {
      filters,
      order_by: this.viewDraft.orderBy || null,
      order: this.viewDraft.order,
    };
  },

  async saveView() {
    const name = this.viewDraft.name.trim();
    if (!name || !this.table) return;
    const payload = { name, config: this.viewConfig() };
    try {
      if (this.viewEditing) {
        await api(`/api/tables/${this.table.id}/views/${this.viewEditing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/api/tables/${this.table.id}/views`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      this.viewOpen = false;
      this.$refs.viewDialog?.close();
      this.view = name;
      await this.loadViews();
      this.applyView(name);
      this.status = `saved view ${name}`;
    } catch (err) {
      this.failed = true;
      this.status = `view failed: ${err.message}`;
    }
  },

  async deleteView(view) {
    if (!view || !this.table) return;
    const ok = await openModal({
      title: 'delete view',
      text: `“${view.name}” will be removed. The rows stay untouched.`,
      ok: 'delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/tables/${this.table.id}/views/${view.id}`, { method: 'DELETE' });
      if (this.view === view.name) {
        this.view = '';
        this.orderBy = null;
      }
      await this.loadViews();
      if (this.table) await this.openTable(this.current, false);
      this.status = `deleted view ${view.name}`;
    } catch (err) {
      this.failed = true;
      this.status = `view delete failed: ${err.message}`;
    }
  },
};
