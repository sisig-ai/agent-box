// Columns and table-level actions: the column dialog, rename, archive, delete.

import { openModal } from '../modal.js';
import { api } from './api.js?v=tables5';

export const columnActions = {
  startColumnRename(column) {
    this.editingColumn = column.id;
    this.columnNameDraft = column.name;
    this.$nextTick(() => {
      const input = this.$el.querySelector('.tbl-th-input');
      if (input) {
        input.focus();
        input.select();
      }
    });
  },

  async commitColumnName(column) {
    if (this.editingColumn !== column.id) return;
    this.editingColumn = null;
    const value = this.columnNameDraft.trim();
    if (!value || value === column.name) return;
    try {
      await api(`/api/tables/${this.table.id}/columns/${column.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: value }),
      });
      await this.openTable(this.current);
    } catch (err) {
      this.failed = true;
      this.status = `rename failed: ${err.message}`;
    }
  },

  cancelColumnRename() {
    this.editingColumn = null;
  },

  // ---- column dialog ----
  openColumnDialog(column = null) {
    this.columnEditing = column || null;
    this.columnDraft = column
      ? this.draftFromColumn(column)
      : {
          name: '',
          type: 'string',
          subtype: 'text',
          options: '',
          expression: '',
          targetTable: this.tables.find((t) => t.id !== this.current)?.id || '',
          multiple: false,
          refColumn: this.columns.find((c) => c.type === 'ref')?.name || '',
          targetColumn: '',
          aggregate: 'count',
          requireHttps: false,
        };
    this.columnOpen = true;
    this.$nextTick(() => {
      this.$refs.columnDialog?.showModal();
      this.$refs.columnName?.focus();
    });
  },

  // Map a stored column back onto the dialog's pseudo-types.
  draftFromColumn(column) {
    const config = column.config || {};
    const subtype = column.subtype || '';
    let type = column.type;
    if (column.type === 'string' && subtype) type = subtype;
    return {
      name: column.name,
      type,
      subtype: column.type === 'number' ? subtype || 'float' : subtype || 'text',
      options: (config.options || []).join(', '),
      expression: config.expression || '',
      targetTable: config.table_id != null ? String(config.table_id) : '',
      multiple: !!config.multiple,
      refColumn: config.ref_column || '',
      targetColumn: config.target_column || '',
      aggregate: config.aggregate || 'count',
      requireHttps: !!config.require_https,
    };
  },

  columnPayload() {
    const draft = this.columnDraft;
    const payload = { name: draft.name.trim(), type: draft.type, config: this.columnConfig() };
    if (draft.type === 'select' || draft.type === 'multi_select') payload.type = 'string';
    if (payload.type === 'string') {
      const sub = draft.type === 'string' ? draft.subtype : draft.type;
      payload.subtype = ['text', 'select', 'multi_select'].includes(sub) ? sub : 'text';
    }
    if (payload.type === 'number') payload.subtype = draft.subtype === 'int' ? 'int' : 'float';
    return payload;
  },

  columnConfig() {
    const draft = this.columnDraft;
    const config = {};
    if (draft.type === 'select' || draft.type === 'multi_select') {
      config.options = draft.options.split(',').map((o) => o.trim()).filter(Boolean);
    }
    if (draft.type === 'url' && draft.requireHttps) config.require_https = true;
    if (draft.type === 'formula') config.expression = draft.expression;
    if (draft.type === 'ref') {
      config.table_id = Number(draft.targetTable);
      config.multiple = !!draft.multiple;
    }
    if (draft.type === 'rollup') {
      config.table_id = Number(draft.targetTable);
      config.ref_column = draft.refColumn;
      config.target_column = draft.targetColumn;
      config.aggregate = draft.aggregate;
    }
    return config;
  },

  async saveColumn() {
    const draft = this.columnDraft;
    if (!draft.name.trim() || !this.table) return;
    const payload = this.columnPayload();
    const editing = this.columnEditing;
    try {
      if (editing) {
        await this.patchColumn(editing, payload);
      } else {
        await api(`/api/tables/${this.table.id}/columns`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      this.columnOpen = false;
      this.$refs.columnDialog?.close();
      await this.openTable(this.current);
    } catch (err) {
      if (editing && /clear_values/.test(err.message)) {
        const ok = await openModal({
          title: 'change column type?',
          text: `“${editing.name}” holds values that do not fit the new type. They will be cleared.`,
          ok: 'change and clear',
          danger: true,
        });
        if (!ok) return;
        try {
          await this.patchColumn(editing, payload, true);
          this.columnOpen = false;
          this.$refs.columnDialog?.close();
          await this.openTable(this.current);
          return;
        } catch (retry) {
          this.failed = true;
          this.status = `column failed: ${retry.message}`;
          return;
        }
      }
      this.failed = true;
      this.status = `column failed: ${err.message}`;
    }
  },

  async patchColumn(column, payload, clearValues = false) {
    return api(`/api/tables/${this.table.id}/columns/${column.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, ...(clearValues ? { clear_values: true } : {}) }),
    });
  },

  async deleteColumn(column) {
    if (!this.table) return;
    const ok = await openModal({
      title: 'delete column',
      text: `“${column.name}” and its values in every row will be deleted.`,
      ok: 'delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/tables/${this.table.id}/columns/${column.id}`, { method: 'DELETE' });
      await this.openTable(this.current);
    } catch (err) {
      this.failed = true;
      this.status = `delete failed: ${err.message}`;
    }
  },

  // ---- tables ----
  openTableDialog() {
    this.tableDraft = { name: '', description: '' };
    this.tableOpen = true;
    this.$nextTick(() => {
      this.$refs.tableDialog?.showModal();
      this.$refs.tableName?.focus();
    });
  },

  async createTable() {
    const name = this.tableDraft.name.trim();
    if (!name) return;
    try {
      const table = await api('/api/tables', {
        method: 'POST',
        body: JSON.stringify({ name, description: this.tableDraft.description }),
      });
      this.tableOpen = false;
      this.$refs.tableDialog?.close();
      await this.load();
      await this.openTable(table.id);
    } catch (err) {
      this.failed = true;
      this.status = `create failed: ${err.message}`;
    }
  },

  startTableRename() {
    if (!this.table) return;
    this.tableNameEditing = true;
    this.tableNameDraft = this.table.name;
    this.$nextTick(() => {
      const input = this.$el.querySelector('.tbl-name-input');
      if (input) {
        input.focus();
        input.select();
      }
    });
  },

  async commitTableName() {
    if (!this.tableNameEditing) return;
    this.tableNameEditing = false;
    const value = this.tableNameDraft.trim();
    if (!this.table || !value || value === this.table.name) return;
    try {
      await api(`/api/tables/${this.table.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: value }),
      });
      await this.load();
    } catch (err) {
      this.failed = true;
      this.status = `rename failed: ${err.message}`;
    }
  },

  async toggleArchive() {
    const table = this.table;
    if (!table) return;
    try {
      await api(`/api/tables/${table.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: !table.archived_at }),
      });
      this.status = table.archived_at ? `restored ${table.name}` : `archived ${table.name}`;
      this.current = null;
      await this.load();
    } catch (err) {
      this.failed = true;
      this.status = `archive failed: ${err.message}`;
    }
  },

  async deleteTable() {
    const table = this.table;
    if (!table) return;
    const ok = await openModal({
      title: 'delete table',
      text: `“${table.name}”, its columns and all ${table.record_count} records will be deleted.`,
      ok: 'delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/tables/${table.id}`, { method: 'DELETE' });
      this.current = null;
      await this.load();
      this.status = `deleted ${table.name}`;
    } catch (err) {
      this.failed = true;
      this.status = `delete failed: ${err.message}`;
    }
  },

  toggleArchived() {
    this.showArchived = !this.showArchived;
    this.load();
  },
};
