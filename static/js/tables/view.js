// Tables: an Airtable-shaped grid over /api/tables.
// Alpine component; cells patch on commit, columns and tables live in dialogs.

import Alpine from '../alpine.js';
import { openModal } from '../modal.js';
import { inlineEdit } from '../kanban/edit.js?v=kanban29';

const TYPES = [
  ['string', 'string'],
  ['number', 'number'],
  ['bool', 'bool'],
  ['timestamp', 'timestamp'],
  ['url', 'url'],
  ['select', 'select'],
  ['multi_select', 'multi-select'],
  ['ref', 'ref'],
  ['rollup', 'rollup'],
  ['formula', 'formula'],
];

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function tablesView() {
  return {
    tables: [],
    current: null,
    columns: [],
    records: [],
    showArchived: false,
    status: 'loading…',
    failed: false,
    editing: null, // {record, column}
    draft: '',
    menuColumn: null,
    tableOpen: false,
    tableDraft: { name: '', description: '' },
    columnOpen: false,
    columnDraft: {
      name: '', type: 'string', subtype: 'text', options: '', expression: '',
      targetTable: '', multiple: false, refColumn: '', targetColumn: '', aggregate: 'count',
      requireHttps: false,
    },
    types: TYPES,

    init() {
      this.load();
    },

    // ---- data ----
    async load() {
      try {
        const data = await api(`/api/tables?include_archived=${this.showArchived ? 1 : 0}`);
        this.tables = data.tables || [];
        const keep = this.tables.find((table) => String(table.id) === String(this.current));
        if (keep) await this.openTable(keep.id, false);
        else if (this.tables.length) await this.openTable(this.tables[0].id, false);
        else {
          this.current = null;
          this.columns = [];
          this.records = [];
        }
        this.status = `synced ${new Date().toLocaleTimeString([], { hour12: false })}`;
        this.failed = false;
      } catch (err) {
        this.failed = true;
        this.status = `load failed: ${err.message}`;
      }
      return undefined;
    },

    async openTable(ref, announce = true) {
      try {
        const schema = await api(`/api/tables/${encodeURIComponent(ref)}`);
        const data = await api(
          `/api/tables/${encodeURIComponent(ref)}/records?include_archived=${this.showArchived ? 1 : 0}&limit=500`,
        );
        this.current = schema.id;
        this.columns = schema.columns || [];
        this.records = data.records || [];
        this.menuColumn = null;
        if (announce) this.status = `opened ${schema.name}`;
      } catch (err) {
        this.failed = true;
        this.status = `open failed: ${err.message}`;
      }
    },

    get table() {
      return this.tables.find((item) => String(item.id) === String(this.current)) || null;
    },

    get visibleTables() {
      return this.tables;
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

    editTableName(event) {
      const table = this.table;
      if (!table) return;
      inlineEdit(event.currentTarget, table.name, this, async (value) => {
        if (!value || value === table.name) return;
        try {
          await api(`/api/tables/${table.id}`, { method: 'PATCH', body: JSON.stringify({ name: value }) });
          await this.load();
        } catch (err) {
          this.failed = true;
          this.status = `rename failed: ${err.message}`;
        }
      });
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

    // ---- columns ----
    openColumnDialog() {
      this.columnDraft = {
        name: '', type: 'string', subtype: 'text', options: '', expression: '',
        targetTable: this.tables.find((t) => t.id !== this.current)?.id || '',
        multiple: false, refColumn: this.columns.find((c) => c.type === 'ref')?.name || '',
        targetColumn: '', aggregate: 'count', requireHttps: false,
      };
      this.columnOpen = true;
      this.$nextTick(() => {
        this.$refs.columnDialog?.showModal();
        this.$refs.columnName?.focus();
      });
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

    async createColumn() {
      const draft = this.columnDraft;
      if (!draft.name.trim() || !this.table) return;
      const payload = { name: draft.name.trim(), type: draft.type };
      if (draft.type === 'string') payload.subtype = draft.subtype;
      if (draft.type === 'number') payload.subtype = draft.subtype === 'int' ? 'int' : 'float';
      payload.config = this.columnConfig();
      try {
        await api(`/api/tables/${this.table.id}/columns`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        this.columnOpen = false;
        this.$refs.columnDialog?.close();
        await this.openTable(this.current);
      } catch (err) {
        this.failed = true;
        this.status = `column failed: ${err.message}`;
      }
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

    // ---- cells ----
    display(record, column) {
      const value = record.values[column.name];
      if (value === null || value === undefined || value === '') return '';
      if (column.type === 'bool') return value ? '✓' : '';
      if (Array.isArray(value)) return value.join(', ');
      return String(value);
    },

    isEditing(record, column) {
      return !!this.editing && this.editing.record === record.id && this.editing.column === column.name;
    },

    canEdit(column) {
      return !column.computed;
    },

    beginEdit(record, column) {
      if (!this.canEdit(column)) return;
      if (column.type === 'bool') {
        this.setCell(record, column, !record.values[column.name]);
        return;
      }
      this.editing = { record: record.id, column: column.name };
      let value = record.values[column.name];
      if (Array.isArray(value)) value = value.join(', ');
      this.draft = value === null || value === undefined ? '' : String(value);
      this.$nextTick(() => {
        const input = this.$el.querySelector('.tbl-cell-input');
        if (input) {
          input.focus();
          if (input.select) input.select();
        }
      });
    },

    cancelEdit() {
      this.editing = null;
    },

    commitEdit(record, column) {
      if (!this.editing) return;
      const raw = this.draft;
      this.editing = null;
      let value = raw;
      if (column.type === 'number') value = raw.trim() === '' ? null : Number(raw);
      else if (column.type === 'multi_select') value = raw.split(',').map((v) => v.trim()).filter(Boolean);
      else if (column.type === 'ref') value = raw.trim() === '' ? null : Number(raw);
      else if (column.type === 'timestamp') value = raw.trim() || null;
      else value = raw.trim() === '' ? null : raw;
      this.setCell(record, column, value);
    },

    async setCell(record, column, value) {
      if (!this.table) return;
      try {
        const updated = await api(
          `/api/tables/${this.table.id}/records/${record.id}`,
          { method: 'PATCH', body: JSON.stringify({ values: { [column.name]: value } }) },
        );
        const index = this.records.findIndex((row) => row.id === record.id);
        if (index >= 0) this.records[index] = updated;
        this.status = `saved ${column.name}`;
        this.failed = false;
      } catch (err) {
        this.failed = true;
        this.status = `${column.name}: ${err.message}`;
      }
    },

    // ---- records ----
    async addRecord() {
      if (!this.table) return;
      try {
        const record = await api(`/api/tables/${this.table.id}/records`, {
          method: 'POST',
          body: JSON.stringify({ values: {} }),
        });
        this.records.push(record);
        this.status = `added record #${record.id}`;
      } catch (err) {
        this.failed = true;
        this.status = `add failed: ${err.message}`;
      }
    },

    async archiveRecord(record) {
      if (!this.table) return;
      try {
        await api(`/api/tables/${this.table.id}/records/${record.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ archived: !record.archived_at }),
        });
        await this.openTable(this.current);
      } catch (err) {
        this.failed = true;
        this.status = `archive failed: ${err.message}`;
      }
    },

    async deleteRecord(record) {
      if (!this.table) return;
      const ok = await openModal({
        title: 'delete record',
        text: `Record #${record.id} will be deleted.`,
        ok: 'delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/tables/${this.table.id}/records/${record.id}`, { method: 'DELETE' });
        this.records = this.records.filter((row) => row.id !== record.id);
      } catch (err) {
        this.failed = true;
        this.status = `delete failed: ${err.message}`;
      }
    },
  };
}

export function mount(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  Alpine.data('tablesView', tablesView);
  delete el._x_ignore;
  delete el._x_ignoreSelf;
  Alpine.mutateDom(() => {
    el.removeAttribute('x-ignore');
    el.setAttribute('x-data', 'tablesView');
  });
  Alpine.initTree(el);
}
