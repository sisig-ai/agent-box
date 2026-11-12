"use client";

// Tables: an Airtable-shaped grid over /api/tables. Ported from the old
// Alpine tables view (static/js/tables/{view,cells,columns,views}.js and
// dashboard/page/panels_tables*.py): sidebar table list, sticky-header grid
// with click-to-edit cells, the column dialog with per-type extras, saved
// views and infinite scroll.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  tablesApi,
  type TableColumn,
  type TableInfo,
  type TablePage,
  type TableRecord,
  type TableView,
  type TableViewConfig,
} from "@/lib/api";
import { useModal } from "@/components/modal-provider";
import { DashboardButton } from "@/components/block/dashboard-shell";
import "../tables.css";

const PAGE_LIMIT = 100;
const LOAD_MORE_PX = 120;

const TYPES: [string, string][] = [
  ["string", "string"],
  ["number", "number"],
  ["bool", "bool"],
  ["timestamp", "timestamp"],
  ["url", "url"],
  ["select", "select"],
  ["multi_select", "multi-select"],
  ["ref", "ref"],
  ["rollup", "rollup"],
  ["formula", "formula"],
];

const AGGREGATES = ["count", "sum", "avg", "min", "max", "concat", "list"];

const OPS: [string, string][] = [
  ["eq", "is"],
  ["neq", "is not"],
  ["contains", "contains"],
  ["starts_with", "starts with"],
  ["gt", ">"],
  ["gte", ">="],
  ["lt", "<"],
  ["lte", "<="],
  ["is_empty", "is empty"],
  ["is_not_empty", "is not empty"],
];

/* ---------- column dialog draft ---------- */

interface ColumnDraft {
  name: string;
  type: string;
  subtype: string;
  options: string;
  expression: string;
  targetTable: string;
  multiple: boolean;
  refColumn: string;
  targetColumn: string;
  aggregate: string;
  requireHttps: boolean;
}

function emptyDraft(tables: TableInfo[], current: number | null, columns: TableColumn[]): ColumnDraft {
  return {
    name: "",
    type: "string",
    subtype: "text",
    options: "",
    expression: "",
    targetTable: String(tables.find((t) => t.id !== current)?.id ?? ""),
    multiple: false,
    refColumn: columns.find((c) => c.type === "ref")?.name || "",
    targetColumn: "",
    aggregate: "count",
    requireHttps: false,
  };
}

// Map a stored column back onto the dialog's pseudo-types (string+subtype
// becomes the subtype as the type, so editing keeps what was chosen).
function draftFromColumn(column: TableColumn): ColumnDraft {
  const cfg = (column.config || {}) as {
    options?: string[];
    expression?: string;
    table_id?: number;
    multiple?: boolean;
    ref_column?: string;
    target_column?: string;
    aggregate?: string;
    require_https?: boolean;
  };
  const subtype = column.subtype || "";
  let type = column.type;
  if (column.type === "string" && subtype) type = subtype;
  return {
    name: column.name,
    type,
    subtype: column.type === "number" ? subtype || "float" : subtype || "text",
    options: (cfg.options || []).join(", "),
    expression: cfg.expression || "",
    targetTable: cfg.table_id != null ? String(cfg.table_id) : "",
    multiple: !!cfg.multiple,
    refColumn: cfg.ref_column || "",
    targetColumn: cfg.target_column || "",
    aggregate: cfg.aggregate || "count",
    requireHttps: !!cfg.require_https,
  };
}

function columnConfig(draft: ColumnDraft): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (draft.type === "select" || draft.type === "multi_select") {
    config.options = draft.options.split(",").map((o) => o.trim()).filter(Boolean);
  }
  if (draft.type === "url" && draft.requireHttps) config.require_https = true;
  if (draft.type === "formula") config.expression = draft.expression;
  if (draft.type === "ref") {
    config.table_id = Number(draft.targetTable);
    config.multiple = !!draft.multiple;
  }
  if (draft.type === "rollup") {
    config.table_id = Number(draft.targetTable);
    config.ref_column = draft.refColumn;
    config.target_column = draft.targetColumn;
    config.aggregate = draft.aggregate;
  }
  return config;
}

function columnPayload(draft: ColumnDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: draft.name.trim(),
    type: draft.type,
    config: columnConfig(draft),
  };
  if (draft.type === "select" || draft.type === "multi_select") payload.type = "string";
  if (payload.type === "string") {
    const sub = draft.type === "string" ? draft.subtype : draft.type;
    payload.subtype = ["text", "select", "multi_select"].includes(sub) ? sub : "text";
  }
  if (payload.type === "number") payload.subtype = draft.subtype === "int" ? "int" : "float";
  return payload;
}

/* ---------- view dialog draft ---------- */

interface FilterDraft {
  column: string;
  op: string;
  value: string;
}

interface ViewDraft {
  name: string;
  orderBy: string;
  order: string;
  filters: FilterDraft[];
}

function viewConfig(draft: ViewDraft, columns: TableColumn[]): TableViewConfig {
  const filters: { column: string; op: string; value: unknown }[] = [];
  for (const filter of draft.filters) {
    if (!filter.column) continue;
    const column = columns.find((c) => c.name === filter.column);
    let value: unknown = filter.value;
    if (filter.op === "is_empty" || filter.op === "is_not_empty") value = null;
    else if (column?.type === "bool") value = String(filter.value).toLowerCase() === "true";
    else if (column?.type === "number") value = filter.value === "" ? null : Number(filter.value);
    else if (column?.type === "ref") value = filter.value === "" ? null : Number(filter.value);
    filters.push({ column: filter.column, op: filter.op, value });
  }
  return {
    filters,
    order_by: draft.orderBy || null,
    order: draft.order,
  };
}

/* ---------- cell rendering ---------- */

function display(record: TableRecord, column: TableColumn): string {
  const value = record.values[column.name];
  if (value === null || value === undefined || value === "") return "";
  if (column.type === "bool") return value ? "✓" : "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/* ---------- dialogs ---------- */

function DialogBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="tbl-dialog-backdrop" onClick={onClose}>
      <div className="tbl-dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function TableDialog({ initial, onClose, onSave }: {
  initial: { name: string; description: string };
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<string | null>;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <DialogBackdrop onClose={onClose}>
      <h3>new table</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const err = await onSave(form.name, form.description);
          if (err) setError(err);
        }}
      >
        <label>
          name
          <input
            ref={nameRef}
            type="text"
            maxLength={80}
            placeholder="e.g. Vendors"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          description (optional)
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        {error && <p className="tbl-error">{error}</p>}
        <div className="tbl-dialog-actions">
          <DashboardButton type="button" variant="ghost" onClick={onClose}>cancel</DashboardButton>
          <DashboardButton type="submit">create</DashboardButton>
        </div>
      </form>
    </DialogBackdrop>
  );
}

function ColumnDialog({ open, editing, draft, tables, onSave, onClose }: {
  open: boolean;
  editing: TableColumn | null;
  draft: ColumnDraft;
  tables: TableInfo[];
  onSave: (draft: ColumnDraft) => Promise<string | null>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ColumnDraft>(draft);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(draft);
      setError("");
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [open, draft]);

  if (!open) return null;

  return (
    <DialogBackdrop onClose={onClose}>
      <h3>{editing ? "edit column" : "new column"}</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const err = await onSave(form);
          if (err) setError(err);
          else onClose();
        }}
      >
        <label>
          name
          <input
            ref={nameRef}
            type="text"
            maxLength={60}
            placeholder="e.g. Status"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          type
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {form.type === "string" && (
          <label>
            string style
            <select value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })}>
              <option value="text">text</option>
              <option value="select">select</option>
              <option value="multi_select">multi-select</option>
            </select>
          </label>
        )}
        {form.type === "number" && (
          <label>
            number style
            <select value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })}>
              <option value="float">float</option>
              <option value="int">integer</option>
            </select>
          </label>
        )}
        {(form.type === "select" || form.type === "multi_select") && (
          <label>
            options (comma separated)
            <input
              type="text"
              placeholder="todo, doing, done"
              value={form.options}
              onChange={(e) => setForm({ ...form, options: e.target.value })}
            />
          </label>
        )}
        {form.type === "url" && (
          <label className="tbl-check">
            <input
              type="checkbox"
              checked={form.requireHttps}
              onChange={(e) => setForm({ ...form, requireHttps: e.target.checked })}
            />
            https only
          </label>
        )}
        {form.type === "formula" && (
          <label>
            formula
            <input
              type="text"
              placeholder='IF({Done}, "✓ " + {Title}, {Title})'
              value={form.expression}
              onChange={(e) => setForm({ ...form, expression: e.target.value })}
            />
          </label>
        )}
        {(form.type === "ref" || form.type === "rollup") && (
          <label>
            target table
            <select
              value={form.targetTable}
              onChange={(e) => setForm({ ...form, targetTable: e.target.value })}
            >
              {tables.map((item) => (
                <option key={item.id} value={String(item.id)}>{item.name}</option>
              ))}
            </select>
          </label>
        )}
        {form.type === "ref" && (
          <label className="tbl-check">
            <input
              type="checkbox"
              checked={form.multiple}
              onChange={(e) => setForm({ ...form, multiple: e.target.checked })}
            />
            allow several records
          </label>
        )}
        {form.type === "rollup" && (
          <>
            <label>
              ref column
              <input
                type="text"
                placeholder="Vendor"
                value={form.refColumn}
                onChange={(e) => setForm({ ...form, refColumn: e.target.value })}
              />
            </label>
            <label>
              target column
              <input
                type="text"
                placeholder="Name"
                value={form.targetColumn}
                onChange={(e) => setForm({ ...form, targetColumn: e.target.value })}
              />
            </label>
            <label>
              aggregate
              <select value={form.aggregate} onChange={(e) => setForm({ ...form, aggregate: e.target.value })}>
                {AGGREGATES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && <p className="tbl-error">{error}</p>}
        <div className="tbl-dialog-actions">
          <DashboardButton type="button" variant="ghost" onClick={onClose}>cancel</DashboardButton>
          <DashboardButton type="submit">{editing ? "save" : "create"}</DashboardButton>
        </div>
      </form>
    </DialogBackdrop>
  );
}

function ViewDialog({ open, editing, draft, columns, onSave, onClose }: {
  open: boolean;
  editing: TableView | null;
  draft: ViewDraft;
  columns: TableColumn[];
  onSave: (draft: ViewDraft) => Promise<string | null>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ViewDraft>(draft);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(draft);
      setError("");
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [open, draft]);

  if (!open) return null;

  const setFilter = (index: number, patch: Partial<FilterDraft>) => {
    const filters = form.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter));
    setForm({ ...form, filters });
  };

  return (
    <DialogBackdrop onClose={onClose}>
      <h3>{editing ? "edit view" : "new view"}</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const err = await onSave(form);
          if (err) setError(err);
          else onClose();
        }}
      >
        <label>
          name
          <input
            ref={nameRef}
            type="text"
            maxLength={60}
            placeholder="e.g. Open items"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          order by
          <select value={form.orderBy} onChange={(e) => setForm({ ...form, orderBy: e.target.value })}>
            <option value="">insertion order</option>
            {columns.map((column) => (
              <option key={column.id} value={column.name} disabled={column.computed}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          direction
          <select value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })}>
            <option value="asc">asc</option>
            <option value="desc">desc</option>
          </select>
        </label>
        <div className="tbl-filters">
          {form.filters.map((filter, index) => (
            <div className="tbl-filter-row" key={index}>
              <select value={filter.column} onChange={(e) => setFilter(index, { column: e.target.value })}>
                {columns.map((column) => (
                  <option key={column.id} value={column.name} disabled={column.computed}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select value={filter.op} onChange={(e) => setFilter(index, { op: e.target.value })}>
                {OPS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              {filter.op !== "is_empty" && filter.op !== "is_not_empty" && (
                <input
                  type="text"
                  placeholder="value"
                  value={filter.value}
                  onChange={(e) => setFilter(index, { value: e.target.value })}
                />
              )}
              <button
                type="button"
                className="tbl-icon danger"
                title="Remove this filter"
                onClick={() => setForm({ ...form, filters: form.filters.filter((_, i) => i !== index) })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {error && <p className="tbl-error">{error}</p>}
        <div className="tbl-dialog-actions">
          <DashboardButton
            type="button"
            onClick={() => setForm({ ...form, filters: [...form.filters, { column: columns[0]?.name || "", op: "eq", value: "" }] })}
          >
            + filter
          </DashboardButton>
          <DashboardButton type="button" variant="ghost" onClick={onClose}>cancel</DashboardButton>
          <DashboardButton type="submit">{editing ? "save" : "create"}</DashboardButton>
        </div>
      </form>
    </DialogBackdrop>
  );
}

/* ---------- the view ---------- */

export function TablesView({ active = true }: { active?: boolean }) {
  void active; // no polling in this view; kept to match the dashboard call site
  const openModal = useModal();

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [records, setRecords] = useState<TableRecord[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [order, setOrder] = useState("asc");
  const [showArchived, setShowArchived] = useState(false);
  const [status, setStatusState] = useState("loading…");
  const [failed, setFailed] = useState(false);

  // inline editing state
  const [editingCell, setEditingCell] = useState<{ record: number; column: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [editingColumn, setEditingColumn] = useState<number | null>(null);
  const [columnNameDraft, setColumnNameDraft] = useState("");
  const [tableEditing, setTableEditing] = useState(false);
  const [tableNameDraft, setTableNameDraft] = useState("");

  // dialogs
  const [tableDialog, setTableDialog] = useState(false);
  const [columnDialog, setColumnDialog] = useState(false);
  const [columnEditing, setColumnEditing] = useState<TableColumn | null>(null);
  const [columnDraft, setColumnDraft] = useState<ColumnDraft | null>(null);
  const [views, setViews] = useState<TableView[]>([]);
  const [view, setView] = useState("");
  const [viewDialog, setViewDialog] = useState(false);
  const [viewEditing, setViewEditing] = useState<TableView | null>(null);
  const [viewDraft, setViewDraft] = useState<ViewDraft | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);

  /* Fetch params live in refs so a click handler can reset the view/sort and
     re-fetch in the same tick (the old Alpine component mutated `this`
     synchronously; plain state would still hold the stale closure). */
  const params = useRef({ current: null as number | null, view: "", orderBy: null as string | null, order: "asc", showArchived: false });
  params.current = { current, view, orderBy, order, showArchived };

  const more = useRef({ current: null as number | null, hasMore: false, loading: false, offset: 0 });

  const setStatus = useCallback((text: string, isError = false) => {
    setStatusState(text);
    setFailed(isError);
  }, []);

  const table = useMemo(
    () => tables.find((item) => String(item.id) === String(current)) || null,
    [tables, current],
  );

  const currentView = useMemo(
    () => views.find((item) => item.name === view) || null,
    [views, view],
  );

  /* ----- data ----- */

  const loadViews = useCallback(async (ref: number | null) => {
    if (ref == null) {
      setViews([]);
      return;
    }
    try {
      const data = await tablesApi.views(ref);
      setViews(data.views || []);
    } catch {
      setViews([]);
    }
  }, []);

  const openTable = useCallback(async (ref: number | string, announce = true, overrides?: Partial<{ view: string; orderBy: string | null; order: string }>) => {
    const p = params.current;
    const viewName = overrides?.view !== undefined ? overrides.view : p.view;
    const sortKey = overrides?.orderBy !== undefined ? overrides.orderBy : p.orderBy;
    const sortDir = overrides?.order !== undefined ? overrides.order : p.order;
    try {
      const data: TablePage = await tablesApi.get(ref, {
        limit: PAGE_LIMIT,
        offset: 0,
        order_by: sortKey ?? undefined,
        order: sortDir,
        view: viewName || undefined,
        include_archived: p.showArchived,
      });
      setCurrent(data.id);
      setColumns(data.columns || []);
      setRecords(data.records || []);
      setPageTotal(data.total || 0);
      setHasMore(!!data.has_more);
      more.current = { current: data.id, hasMore: !!data.has_more, loading: false, offset: (data.records || []).length };
      await loadViews(data.id);
      if (announce) setStatus(`opened ${data.name}`);
    } catch (err) {
      setStatus(`open failed: ${(err as Error).message}`, true);
    }
  }, [loadViews, setStatus]);

  const load = useCallback(async (currentOverride?: number | null) => {
    try {
      const data = await tablesApi.list({ include_archived: params.current.showArchived });
      const list = data.tables || [];
      setTables(list);
      const wanted = currentOverride !== undefined ? currentOverride : params.current.current;
      const keep = wanted != null ? list.find((item) => String(item.id) === String(wanted)) : undefined;
      if (keep) await openTable(keep.id, false);
      else if (list.length) await openTable(list[0].id, false);
      else {
        setCurrent(null);
        setColumns([]);
        setRecords([]);
        setViews([]);
      }
      setStatus(`synced ${new Date().toLocaleTimeString([], { hour12: false })}`);
    } catch (err) {
      setStatus(`load failed: ${(err as Error).message}`, true);
    }
  }, [openTable, setStatus]);

  /* ----- infinite scroll ----- */

  const loadMore = useCallback(async () => {
    const state = more.current;
    if (state.current == null || state.loading || !state.hasMore) return;
    state.loading = true;
    setPageLoading(true);
    const p = params.current;
    try {
      const data = await tablesApi.get(state.current, {
        limit: PAGE_LIMIT,
        offset: state.offset,
        order_by: p.orderBy ?? undefined,
        order: p.order,
        view: p.view || undefined,
        include_archived: p.showArchived,
      });
      setRecords((prev) => {
        const merged = prev.concat(data.records || []);
        state.offset = merged.length;
        return merged;
      });
      state.hasMore = !!data.has_more;
      setHasMore(!!data.has_more);
      setStatus(`loaded ${state.offset} of ${data.total}`);
    } catch (err) {
      setStatus(`load failed: ${(err as Error).message}`, true);
    } finally {
      state.loading = false;
      setPageLoading(false);
    }
  }, [setStatus]);

  const onGridScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_PX) void loadMore();
  }, [loadMore]);

  /* ----- sorting + views ----- */

  const sortBy = useCallback((column: TableColumn) => {
    if (column.computed || current == null) return;
    const nextOrderBy = column.name;
    const nextOrder = orderBy === column.name ? (order === "asc" ? "desc" : "asc") : "asc";
    setOrderBy(nextOrderBy);
    setOrder(nextOrder);
    params.current.orderBy = nextOrderBy;
    params.current.order = nextOrder;
    void openTable(current, false, { orderBy: nextOrderBy, order: nextOrder });
  }, [current, orderBy, order, openTable]);

  const applyView = useCallback((name: string) => {
    const config = (views.find((item) => item.name === name)?.config || {}) as Partial<TableViewConfig>;
    const nextOrderBy = config.order_by || null;
    const nextOrder = config.order || "asc";
    setView(name || "");
    setOrderBy(nextOrderBy);
    setOrder(nextOrder);
    params.current.view = name || "";
    params.current.orderBy = nextOrderBy;
    params.current.order = nextOrder;
    if (current != null) void openTable(current, false, { view: name || "", orderBy: nextOrderBy, order: nextOrder });
  }, [views, current, openTable]);

  /* ----- cells ----- */

  const setCell = useCallback(async (record: TableRecord, column: TableColumn, value: unknown) => {
    if (current == null) return;
    try {
      const updated = await tablesApi.patchRecord(current, record.id, { values: { [column.name]: value } });
      setRecords((prev) => prev.map((row) => (row.id === record.id ? updated : row)));
      setStatus(`saved ${column.name}`);
    } catch (err) {
      setStatus(`${column.name}: ${(err as Error).message}`, true);
    }
  }, [current, setStatus]);

  const beginEdit = useCallback((record: TableRecord, column: TableColumn) => {
    if (column.computed) return;
    if (column.type === "bool") {
      void setCell(record, column, !record.values[column.name]);
      return;
    }
    setEditingCell({ record: record.id, column: column.name });
    let value = record.values[column.name];
    if (Array.isArray(value)) value = value.join(", ");
    setDraft(value === null || value === undefined ? "" : String(value));
    setTimeout(() => {
      const input = gridRef.current?.querySelector<HTMLInputElement>(".tbl-cell-input");
      input?.focus();
      input?.select();
    }, 0);
  }, [setCell]);

  const commitEdit = useCallback((record: TableRecord, column: TableColumn) => {
    setEditingCell(null);
    const raw = draft;
    let value: unknown = raw;
    if (column.type === "number") value = raw.trim() === "" ? null : Number(raw);
    else if (column.type === "string" && column.subtype === "multi_select") value = raw.split(",").map((v) => v.trim()).filter(Boolean);
    else if (column.type === "ref") value = raw.trim() === "" ? null : Number(raw);
    else if (column.type === "timestamp") value = raw.trim() || null;
    else value = raw.trim() === "" ? null : raw;
    void setCell(record, column, value);
  }, [draft, setCell]);

  /* ----- records ----- */

  const addRecord = useCallback(async () => {
    if (current == null) return;
    try {
      const record = await tablesApi.addRecord(current, { values: {} });
      setPageTotal((n) => n + 1);
      if (orderBy) await openTable(current, false);
      else setRecords((prev) => [...prev, record]);
      setStatus(`added record #${record.id}`);
    } catch (err) {
      setStatus(`add failed: ${(err as Error).message}`, true);
    }
  }, [current, orderBy, openTable, setStatus]);

  const archiveRecord = useCallback(async (record: TableRecord) => {
    if (current == null) return;
    try {
      await tablesApi.patchRecord(current, record.id, { archived: !record.archived_at });
      await openTable(current, false);
    } catch (err) {
      setStatus(`archive failed: ${(err as Error).message}`, true);
    }
  }, [current, openTable, setStatus]);

  const deleteRecord = useCallback(async (record: TableRecord) => {
    if (current == null) return;
    const ok = await openModal({
      title: "delete record",
      text: `Record #${record.id} will be deleted.`,
      ok: "delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await tablesApi.deleteRecord(current, record.id);
      setRecords((prev) => prev.filter((row) => row.id !== record.id));
      setPageTotal((n) => Math.max(0, n - 1));
    } catch (err) {
      setStatus(`delete failed: ${(err as Error).message}`, true);
    }
  }, [current, openModal, setStatus]);

  /* ----- columns ----- */

  const commitColumnName = useCallback(async (column: TableColumn) => {
    if (editingColumn !== column.id) return;
    setEditingColumn(null);
    const value = columnNameDraft.trim();
    if (!value || value === column.name || current == null) return;
    try {
      await tablesApi.patchColumn(current, column.id, { name: value });
      await openTable(current, true);
    } catch (err) {
      setStatus(`rename failed: ${(err as Error).message}`, true);
    }
  }, [editingColumn, columnNameDraft, current, openTable, setStatus]);

  const openColumnDialog = useCallback((column: TableColumn | null) => {
    setColumnEditing(column);
    setColumnDraft(column ? draftFromColumn(column) : emptyDraft(tables, current, columns));
    setColumnDialog(true);
  }, [tables, current, columns]);

  // Save the dialog draft. A 400 mentioning clear_values prompts first, then
  // retries with clear_values: true (the old openModal flow).
  const saveColumn = useCallback(async (form: ColumnDraft): Promise<string | null> => {
    if (!form.name.trim() || current == null) return "name is required";
    const payload = columnPayload(form);
    const save = (clearValues: boolean) =>
      tablesApi.patchColumn(current, columnEditing!.id, { ...payload, ...(clearValues ? { clear_values: true } : {}) });
    try {
      if (columnEditing) await save(false);
      else await tablesApi.addColumn(current, payload);
      setColumnDialog(false);
      await openTable(current, true);
      return null;
    } catch (err) {
      const message = (err as Error).message;
      if (columnEditing && /clear_values/.test(message)) {
        const ok = await openModal({
          title: "change column type?",
          text: `“${columnEditing.name}” holds values that do not fit the new type. They will be cleared.`,
          ok: "change and clear",
          danger: true,
        });
        if (!ok) return null; // keep the dialog open, nothing changed
        try {
          await save(true);
          setColumnDialog(false);
          await openTable(current, true);
          return null;
        } catch (retry) {
          setStatus(`column failed: ${(retry as Error).message}`, true);
          return (retry as Error).message;
        }
      }
      setStatus(`column failed: ${message}`, true);
      return message;
    }
  }, [current, columnEditing, openTable, openModal, setStatus]);

  const deleteColumn = useCallback(async (column: TableColumn) => {
    if (current == null) return;
    const ok = await openModal({
      title: "delete column",
      text: `“${column.name}” and its values in every row will be deleted.`,
      ok: "delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await tablesApi.deleteColumn(current, column.id);
      await openTable(current, true);
    } catch (err) {
      setStatus(`delete failed: ${(err as Error).message}`, true);
    }
  }, [current, openModal, openTable, setStatus]);

  /* ----- tables ----- */

  const createTable = useCallback(async (name: string, description: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return "name is required";
    try {
      const created = await tablesApi.create({ name: trimmed, description });
      setTableDialog(false);
      await load(created.id);
      await openTable(created.id, true);
      return null;
    } catch (err) {
      return `create failed — ${(err as Error).message}`;
    }
  }, [load, openTable]);

  const commitTableName = useCallback(async () => {
    if (!tableEditing || current == null) return;
    setTableEditing(false);
    const value = tableNameDraft.trim();
    if (!value || !table || value === table.name) return;
    try {
      await tablesApi.update(current, { name: value });
      await load();
    } catch (err) {
      setStatus(`rename failed: ${(err as Error).message}`, true);
    }
  }, [tableEditing, current, tableNameDraft, table, load, setStatus]);

  const toggleArchive = useCallback(async () => {
    if (!table || current == null) return;
    try {
      await tablesApi.update(current, { archived: !table.archived_at });
      setStatus(table.archived_at ? `restored ${table.name}` : `archived ${table.name}`);
      await load(null);
    } catch (err) {
      setStatus(`archive failed: ${(err as Error).message}`, true);
    }
  }, [table, current, load, setStatus]);

  const deleteTable = useCallback(async () => {
    if (!table || current == null) return;
    const ok = await openModal({
      title: "delete table",
      text: `“${table.name}”, its columns and all ${table.record_count} records will be deleted.`,
      ok: "delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await tablesApi.remove(current);
      setView("");
      params.current.view = "";
      await load(null);
      setStatus(`deleted ${table.name}`);
    } catch (err) {
      setStatus(`delete failed: ${(err as Error).message}`, true);
    }
  }, [table, current, openModal, load, setStatus]);

  /* ----- saved views ----- */

  const openViewDialog = useCallback((viewItem: TableView | null) => {
    setViewEditing(viewItem);
    const config = (viewItem?.config || {}) as Partial<TableViewConfig>;
    const draftNext: ViewDraft = {
      name: viewItem?.name || "",
      orderBy: config.order_by || "",
      order: config.order || "asc",
      filters: (config.filters || []).map((filter) => ({
        column: filter.column,
        op: filter.op || "eq",
        value: filter.value === null || filter.value === undefined ? "" : String(filter.value),
      })),
    };
    if (!draftNext.filters.length) {
      draftNext.filters = [{ column: columns[0]?.name || "", op: "eq", value: "" }];
    }
    setViewDraft(draftNext);
    setViewDialog(true);
  }, [columns]);

  const saveView = useCallback(async (form: ViewDraft): Promise<string | null> => {
    const name = form.name.trim();
    if (!name || current == null) return "name is required";
    const config = viewConfig(form, columns);
    try {
      if (viewEditing) await tablesApi.patchView(current, viewEditing.id, { name, config });
      else await tablesApi.createView(current, { name, config });
      setViewDialog(false);
      setView(name);
      params.current.view = name;
      params.current.orderBy = config.order_by ?? null;
      params.current.order = config.order || "asc";
      await loadViews(current);
      await openTable(current, false, { view: name, orderBy: config.order_by ?? null, order: config.order || "asc" });
      setStatus(`saved view ${name}`);
      return null;
    } catch (err) {
      return `view failed — ${(err as Error).message}`;
    }
  }, [current, viewEditing, columns, loadViews, openTable, setStatus]);

  const deleteViewAction = useCallback(async (viewItem: TableView) => {
    if (!viewItem || current == null) return;
    const ok = await openModal({
      title: "delete view",
      text: `“${viewItem.name}” will be removed. The rows stay untouched.`,
      ok: "delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await tablesApi.deleteView(current, viewItem.id);
      if (view === viewItem.name) {
        setView("");
        setOrderBy(null);
        params.current.view = "";
        params.current.orderBy = null;
      }
      await loadViews(current);
      await openTable(current, false, { view: "", orderBy: null, order: "asc" });
      setStatus(`deleted view ${viewItem.name}`);
    } catch (err) {
      setStatus(`view delete failed: ${(err as Error).message}`, true);
    }
  }, [current, view, openModal, loadViews, openTable, setStatus]);

  /* ----- boot ----- */

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void load();
  }, [load]);

  /* ----- render ----- */

  const cellEditor = (record: TableRecord, column: TableColumn) => {
    if (editingCell?.record !== record.id || editingCell.column !== column.name) return null;
    if (column.type === "string" && column.subtype === "select") {
      const options = ((column.config || {}) as { options?: string[] }).options || [];
      return (
        <select
          className="tbl-cell-input"
          autoFocus
          value={String(record.values[column.name] ?? "")}
          onChange={(e) => {
            setEditingCell(null);
            void setCell(record, column, e.target.value === "" ? null : e.target.value);
          }}
          onBlur={() => setEditingCell(null)}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        className="tbl-cell-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commitEdit(record, column)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitEdit(record, column);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditingCell(null);
          }
        }}
      />
    );
  };

  return (
    <section className="tables" aria-label="Tables">
      <div className="tbl-head">
        <div className="tbl-heading">
          <h2>Tables</h2>
          <span className="tbl-sub">typed rows like a spreadsheet · bot and human friendly · <code>/api/tables</code></span>
        </div>
        <div className="tbl-actions">
          <DashboardButton
            size="sm"
            title="Show or hide archived tables"
            onClick={() => {
              params.current.showArchived = !params.current.showArchived;
              setShowArchived(params.current.showArchived);
              void load();
            }}
          >
            {showArchived ? "live only" : "archived"}
          </DashboardButton>
          <DashboardButton size="sm" title="Create a table" onClick={() => setTableDialog(true)}>+ table</DashboardButton>
          <DashboardButton size="sm" title="Reload" onClick={() => void load()}>⟳ refresh</DashboardButton>
        </div>
      </div>

      <div className="tbl-body">
        <aside className="tbl-list" aria-label="Tables">
          {tables.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tbl-item${String(current) === String(item.id) ? " active" : ""}${item.archived_at ? " is-archived" : ""}`}
              onClick={() => {
                if (String(item.id) !== String(current)) {
                  setView("");
                  setOrderBy(null);
                  setOrder("asc");
                  params.current.view = "";
                  params.current.orderBy = null;
                  params.current.order = "asc";
                }
                void openTable(item.id, true);
              }}
            >
              <span className="tbl-item-name">{item.name}</span>
              <span className="tbl-item-meta">{item.record_count} rows · {item.column_count} cols</span>
            </button>
          ))}
          {tables.length === 0 && <p className="tbl-none">no tables yet</p>}
        </aside>

        <main className="tbl-main">
          <div className="tbl-title">
            {tableEditing ? (
              <input
                className="tbl-name-input"
                maxLength={80}
                autoFocus
                value={tableNameDraft}
                onChange={(e) => setTableNameDraft(e.target.value)}
                onBlur={() => void commitTableName()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitTableName();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setTableEditing(false);
                  }
                }}
              />
            ) : (
              <h3
                className="tbl-name"
                title="Click to rename"
                onClick={() => {
                  if (!table) return;
                  setTableNameDraft(table.name);
                  setTableEditing(true);
                }}
              >
                {table ? table.name : "no table selected"}
              </h3>
            )}
            <span className="tbl-counts">
              {table ? `${records.length} rows · ${columns.length} columns` : ""}
            </span>
            <label className="tbl-view-pick" title="Saved views: filters and ordering only">
              view
              <select
                aria-label="Saved view"
                value={view}
                onChange={(e) => applyView(e.target.value)}
              >
                <option value="">all rows</option>
                {views.map((item) => (
                  <option key={item.id} value={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
            <DashboardButton size="sm" title="Save the current filter and ordering as a view" onClick={() => openViewDialog(null)}>
              + view
            </DashboardButton>
            {currentView && (
              <>
                <DashboardButton size="sm" title="Edit this view" onClick={() => openViewDialog(currentView)}>edit</DashboardButton>
                <DashboardButton size="sm" title="Delete this view (rows stay)" onClick={() => void deleteViewAction(currentView)}>del</DashboardButton>
              </>
            )}
            {table && (
              <span className="tbl-title-actions">
                <DashboardButton size="sm" title="Archive or restore this table" onClick={() => void toggleArchive()}>
                  {table.archived_at ? "restore" : "archive"}
                </DashboardButton>
                <DashboardButton size="sm" title="Delete this table" onClick={() => void deleteTable()}>delete</DashboardButton>
              </span>
            )}
          </div>

          <div className="tbl-grid-wrap obsidian-dashboard-shell-scroll" ref={gridRef} onScroll={onGridScroll}>
            <table className="tbl-grid">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      className={`tbl-th${column.computed ? " computed" : ""}`}
                      title={`${column.type} column`}
                    >
                      {editingColumn === column.id ? (
                        <input
                          className="tbl-th-input"
                          maxLength={60}
                          autoFocus
                          value={columnNameDraft}
                          onChange={(e) => setColumnNameDraft(e.target.value)}
                          onBlur={() => void commitColumnName(column)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void commitColumnName(column);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingColumn(null);
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="tbl-th-name"
                          title="Click to rename"
                          onClick={() => {
                            setEditingColumn(column.id);
                            setColumnNameDraft(column.name);
                          }}
                        >
                          {column.name}
                        </span>
                      )}
                      <span className="tbl-th-type">{column.subtype || column.type}</span>
                      <button
                        type="button"
                        className={`tbl-th-sort${orderBy === column.name ? " active" : ""}`}
                        title={`Sort by ${column.name}`}
                        disabled={column.computed}
                        onClick={() => sortBy(column)}
                      >
                        {orderBy === column.name ? (order === "asc" ? "▲" : "▼") : "⇅"}
                      </button>
                      <button
                        type="button"
                        className="tbl-th-edit"
                        title="Edit column"
                        onClick={() => openColumnDialog(column)}
                      >
                        ✎
                      </button>
                      {!column.computed && (
                        <button
                          type="button"
                          className="tbl-th-del"
                          title="Delete column"
                          onClick={() => void deleteColumn(column)}
                        >
                          ×
                        </button>
                      )}
                    </th>
                  ))}
                  <th className="tbl-th-add">
                    <button type="button" className="tbl-add-col" title="Add a column" onClick={() => openColumnDialog(null)}>
                      + column
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className={`tbl-row${record.archived_at ? " archived" : ""}`}>
                    {columns.map((column) => {
                      const editing = editingCell?.record === record.id && editingCell.column === column.name;
                      return (
                        <td
                          key={column.id}
                          className={`tbl-cell${column.computed ? " computed" : ""}${editing ? " editing" : ""}`}
                          onClick={() => {
                            if (!editing) beginEdit(record, column);
                          }}
                        >
                          {editing ? (
                            cellEditor(record, column)
                          ) : (
                            <span className={`tbl-value${column.type === "bool" && record.values[column.name] ? " tick" : ""}`}>
                              {column.type === "bool"
                                ? record.values[column.name] ? "✓" : "—"
                                : display(record, column)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="tbl-row-menu">
                      <button
                        type="button"
                        className="tbl-icon"
                        title="Archive / restore record"
                        onClick={() => void archiveRecord(record)}
                      >
                        {record.archived_at ? "⟲" : "⌫"}
                      </button>
                      <button
                        type="button"
                        className="tbl-icon danger"
                        title="Delete record"
                        onClick={() => void deleteRecord(record)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 && <p className="tbl-empty">no records yet — “+ row” starts one</p>}
          </div>

          <div className="tbl-foot">
            {table && (
              <DashboardButton size="sm" title="Add a record" onClick={() => void addRecord()}>+ row</DashboardButton>
            )}
            <span className="tbl-page">
              {pageTotal
                ? `${records.length} of ${pageTotal} rows`
                  + (hasMore ? " · scroll for more" : "")
                  + (pageLoading ? " · loading…" : "")
                : ""}
            </span>
            <span className={`tbl-status${failed ? " err" : ""}`}>{status}</span>
          </div>
        </main>
      </div>

      {tableDialog && (
        <TableDialog
          initial={{ name: "", description: "" }}
          onClose={() => setTableDialog(false)}
          onSave={createTable}
        />
      )}
      {columnDialog && columnDraft && (
        <ColumnDialog
          open={columnDialog}
          editing={columnEditing}
          draft={columnDraft}
          tables={tables}
          onSave={saveColumn}
          onClose={() => setColumnDialog(false)}
        />
      )}
      {viewDialog && viewDraft && (
        <ViewDialog
          open={viewDialog}
          editing={viewEditing}
          draft={viewDraft}
          columns={columns}
          onSave={saveView}
          onClose={() => setViewDialog(false)}
        />
      )}
    </section>
  );
}
