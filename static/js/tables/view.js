// Tables: an Airtable-shaped grid over /api/tables.
// Alpine component; cells patch on commit, columns and tables live in dialogs.

import Alpine from '../alpine.js';
import { openModal } from '../modal.js';
import { api } from './api.js?v=tables4';
import { cellActions } from './cells.js?v=tables4';
import { columnActions } from './columns.js?v=tables4';

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
    editingColumn: null,
    columnNameDraft: '',
    tableNameEditing: false,
    tableNameDraft: '',
    draft: '',
    menuColumn: null,
    tableOpen: false,
    tableDraft: { name: '', description: '' },
    columnOpen: false,
    columnEditing: null,
    columnDraft: {
      name: '', type: 'string', subtype: 'text', options: '', expression: '',
      targetTable: '', multiple: false, refColumn: '', targetColumn: '', aggregate: 'count',
      requireHttps: false,
    },
    types: TYPES,
    api,

    ...cellActions,
    ...columnActions,

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
    // ---- columns ----
    // Map a stored column back onto the dialog's pseudo-types.
    // ---- cells ----
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
