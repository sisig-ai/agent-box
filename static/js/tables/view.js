// Tables: an Airtable-shaped grid over /api/tables.
// Alpine component; cells patch on commit, columns and tables live in dialogs.

import Alpine from '../alpine.js';
import { openModal } from '../modal.js';
import { api } from './api.js?v=tables5';
import { cellActions } from './cells.js?v=tables5';
import { columnActions } from './columns.js?v=tables5';

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
    page: { limit: 100, total: 0, hasMore: false, loading: false },
    orderBy: null,
    order: 'asc',
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
        const data = await this.fetchPage(ref, 0);
        this.current = data.id;
        this.columns = data.columns || [];
        this.records = data.records || [];
        this.page = {
          limit: data.limit || this.page.limit,
          total: data.total || 0,
          hasMore: !!data.has_more,
          loading: false,
        };
        this.menuColumn = null;
        if (announce) this.status = `opened ${data.name}`;
      } catch (err) {
        this.failed = true;
        this.status = `open failed: ${err.message}`;
      }
    },

    // One page from the direct table endpoint (same one non-agent clients use).
    fetchPage(ref, offset) {
      const params = new URLSearchParams({
        limit: String(this.page.limit),
        offset: String(offset),
        order: this.order,
      });
      if (this.orderBy) params.set('order_by', this.orderBy);
      if (this.showArchived) params.set('include_archived', '1');
      return api(`/api/tables/${encodeURIComponent(ref)}?${params}`);
    },

    async loadMore() {
      if (!this.table || this.page.loading || !this.page.hasMore) return;
      this.page.loading = true;
      try {
        const data = await this.fetchPage(this.current, this.records.length);
        this.records = this.records.concat(data.records || []);
        this.page.total = data.total || this.records.length;
        this.page.hasMore = !!data.has_more;
        this.status = `loaded ${this.records.length} of ${this.page.total}`;
      } catch (err) {
        this.failed = true;
        this.status = `load failed: ${err.message}`;
      } finally {
        this.page.loading = false;
      }
    },

    onScroll(event) {
      const el = event.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) this.loadMore();
    },

    sortBy(column) {
      if (column.computed) return;
      if (this.orderBy === column.name) this.order = this.order === 'asc' ? 'desc' : 'asc';
      else {
        this.orderBy = column.name;
        this.order = 'asc';
      }
      this.openTable(this.current, false);
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
        const record = await api(`/api/tables/${this.table.id}`, {
          method: 'POST',
          body: JSON.stringify({ values: {} }),
        });
        this.page.total += 1;
        if (this.orderBy) await this.openTable(this.current, false);
        else this.records.push(record);
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
        await this.openTable(this.current, false);
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
        this.page.total = Math.max(0, this.page.total - 1);
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
