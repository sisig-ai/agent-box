// Thin JSON client for the dashboard REST API (llm.txt is the contract).
// Every call resolves to the parsed body or throws Error carrying the
// server's {"error"} message.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} as Record<string, string> };
  if (body !== undefined) {
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(String(data.error || `${method} ${path} → HTTP ${res.status}`), res.status);
  return data as T;
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => call<T>("POST", path, body);
export const put = <T>(path: string, body?: unknown) => call<T>("PUT", path, body);
export const patch = <T>(path: string, body?: unknown) => call<T>("PATCH", path, body);
export const del = <T>(path: string) => call<T>("DELETE", path);

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

/* ---------- shared types ---------- */

export interface Lane { id: number; name: string; position: number; card_count: number; archived_count: number }
export interface CardTasks { done: number; total: number }
export interface Card {
  id: number; title: string; owner: string | null; status: string; lane_id: number;
  position: number; opname: string | null; body: string; has_body: boolean;
  body_preview: string; body_tasks: CardTasks; comment_count: number;
  subtask_count: number; docs: string[]; archived_at: string | null;
  parent_id: number | null; created_at: string; updated_at: string;
  subtasks?: Card[];
}
export interface BoardData { lanes: Lane[]; cards: Card[] }
export interface SearchHit {
  card_id: number; title: string; title_marked: string; snippet: string;
  snippet_source: string; lane_id: number; owner: string; opname: string;
  archived_at: string | null; updated_at: string;
}
export interface SearchResponse { cards: SearchHit[]; total: number; q: string }
export interface SemanticHit { id: number; title: string; score: number; lane_id: number; owner: string }
export interface SemanticResponse { hits: SemanticHit[]; count: number; took_ms: number; pending?: number }
export interface Comment {
  id: number; card_id: number; author: string; body: string;
  created_at: string;
}
export interface Subtask extends Card {}
export interface Opname { opname: string; count: number }

export interface ProgressBar {
  id: number; title: string; percent: number; owner: string | null;
  parent_id: number | null; fields: Record<string, string | number | null>;
  child_count: number; children?: ProgressBar[]; archived_at: string | null;
  created_at: string; updated_at: string;
}
export interface ProgressResponse { bars: ProgressBar[]; count: number; archived_count: number }

export interface DocMeta {
  prefix: string; author: string | null; tags: string[]; updated_at: string;
  created_at: string; size: number; revision: number; card_count: number;
  prefix_snip?: string;
}
export interface DocListResponse { docs: DocMeta[]; count: number; total: number }
export interface DocHit {
  prefix: string; author: string | null; tags: string[]; updated_at: string;
  size: number; snippet?: string; excerpt?: string; score?: number;
  prefix_snip?: string;
  /** "exact" (FTS) or "semantic" (embedder) — set by the unified search. */
  kind?: "exact" | "semantic";
}
export interface DocSearchResponse { hits: DocHit[]; count: number; total: number; took_ms?: number; pending?: number }
export interface Doc {
  prefix: string; content: string; author: string | null; tags: string[];
  created_at: string; updated_at: string; revision: number;
  cards?: { id: number; title: string; status: string }[];
}
export interface TreeFolder {
  path: string; name: string; total: number; more: number;
  folders?: TreeFolder[]; docs?: { prefix: string; author: string | null; card_count: number }[];
}
export interface DocTree { folders: TreeFolder[]; docs: { prefix: string; author: string | null }[]; more: number }

export interface TableColumn {
  id: number; name: string; type: string; subtype: string | null; position: number;
  computed: boolean; config?: Record<string, unknown>;
}
export interface TableRecord {
  id: number; values: Record<string, unknown>; created_at: string;
  updated_at: string; archived_at: string | null;
}
export interface TableViewConfig { filters: { column: string; op: string; value: unknown }[]; order_by?: string | null; order?: string }
export interface TableView { id: number; name: string; config: TableViewConfig }
export interface TableInfo {
  id: number; name: string; description: string | null; column_count: number;
  record_count: number; archived_at: string | null; created_at: string; updated_at: string;
}
export interface TablePage {
  id: number; name: string; columns: TableColumn[]; records: TableRecord[];
  total: number; count: number; limit: number; offset: number; has_more: boolean;
}

export interface LogEntry {
  ts: string; tool: string; entity: string | null; ok: boolean;
  ms: number; args: string | null; error: string | null;
}
export interface LogsResponse {
  entries: LogEntry[]; tools: string[]; count: number; total: number;
  files: string[]; retention_days: number;
}

export interface Stats {
  t: string; platform: string; stale: boolean;
  cpu: { util_percent: number | null; temp_c: number | null; temp_source: string | null };
  mem: { total_bytes: number; used_bytes: number; available_bytes: number; util_percent: number };
  power: { total_w: number | null; cpu_w: number | null; gpu_w: number | null; ane_w: number | null; source: string | null; note: string | null };
}
export interface History {
  start: number; seconds: number;
  cpu: (number | null)[]; mem_used: (number | null)[]; mem_total: number | null;
  pwr: (number | null)[];
}
export interface Proc {
  pid: number; name: string; user: string; status: string;
  rss_bytes: number; cpu_percent: number; mem_percent: number;
  cmdline: string; protected: boolean;
}
export interface ProcsResponse {
  procs: Proc[]; total: number; sort: string; order: string; cpu_sample_s: number;
}

export interface FsEntry {
  name: string; path: string; type: "dir" | "file" | "link" | "other";
  is_dir: boolean; is_link: boolean; hidden: boolean;
  size: number | null; mtime: number | null; mode: string;
  readable: boolean; writable: boolean;
}
export interface FsListResponse {
  path: string; parent: string | null; home: string;
  entries: FsEntry[]; places: { name: string; path: string }[];
  truncated?: boolean;
}
export interface FsStat {
  path: string; name: string; type: string; size: number; mtime_iso: string | null;
  btime_iso: string | null; mode: string; owner: string | null; group: string | null;
  mime: string | null; link_target: string | null; readable: boolean; writable: boolean;
}
export interface FsRead { path: string; name: string; size: number; text: string }

export interface SitrepEntry { date: string; content: string }
export interface ScheduleEntry { week: string; content: string }

export interface Theme { id: string; name: string; css: string }
export interface ThemesResponse { themes: Theme[]; active: string }

export interface ServiceConfig {
  name: string; description?: string; url?: string; port?: number; path?: string;
  icon?: string; color?: string;
}
export interface DashboardConfig {
  title?: string; services: ServiceConfig[]; theme?: string;
}

/* ---------- endpoint clients ---------- */

export const opsboardApi = {
  board: () => get<BoardData>("/api/opsboard"),
  search: (q: string, opts: { limit?: number; archived?: string } = {}) =>
    get<SearchResponse>(`/api/opsboard/search${qs({ q, limit: opts.limit ?? 200, archived: opts.archived })}`),
  semantic: (q: string, opts: { limit?: number; archived?: string } = {}) =>
    get<SemanticResponse>(`/api/opsboard/semantic${qs({ q, limit: opts.limit ?? 10, archived: opts.archived })}`),
  getCard: (id: number) => get<Card>(`/api/opsboard/cards/${id}`),
  archived: () => get<Card[]>("/api/opsboard/archived"),
  addCard: (card: Partial<Card> & { title: string }) => post<Card>("/api/opsboard/cards", card),
  patchCard: (id: number, changes: Partial<Card>) => patch<Card>(`/api/opsboard/cards/${id}`, changes),
  deleteCard: (id: number) => del<{ ok?: boolean }>(`/api/opsboard/cards/${id}`),
  comments: (id: number) => get<Comment[]>(`/api/opsboard/cards/${id}/comments`),
  addComment: (id: number, c: { author: string; body: string }) => post<Comment>(`/api/opsboard/cards/${id}/comments`, c),
  deleteComment: (id: number, cid: number) => del<{ ok?: boolean }>(`/api/opsboard/cards/${id}/comments/${cid}`),
  subtasks: (id: number) => get<Subtask[]>(`/api/opsboard/cards/${id}/subtasks`),
  addSubtask: (id: number, subtask: { title: string; lane?: string }) => post<Subtask>(`/api/opsboard/cards/${id}/subtasks`, subtask),
  patchSubtask: (id: number, subId: number, changes: Partial<Subtask>) => patch<Subtask>(`/api/opsboard/cards/${id}/subtasks/${subId}`, changes),
  deleteSubtask: (id: number, subId: number) => del<{ ok?: boolean }>(`/api/opsboard/cards/${id}/subtasks/${subId}`),
  opnames: () => get<Opname[]>("/api/opsboard/opnames"),
  archiveDone: () => post<{ archived: number }>("/api/opsboard/archive-done", {}),
  moveLane: (from: string, to: string) => post<{ moved: number; from: string; to: string }>("/api/opsboard/move-lane", { from, to }),
  addLane: (name: string, position?: number) => post<Lane>("/api/opsboard/lanes", { name, position }),
  patchLane: (id: number, changes: { name?: string; position?: number }) => patch<Lane>(`/api/opsboard/lanes/${id}`, changes),
  deleteLane: (id: number, target?: string, force?: boolean) =>
    del<{ ok?: boolean }>(`/api/opsboard/lanes/${id}${qs({ target, force: force ? 1 : undefined })}`),
};

export const progressApi = {
  list: (archived: "exclude" | "include" | "only" = "exclude") =>
    get<ProgressResponse>(`/api/progress${qs({ archived })}`),
  get: (id: number) => get<ProgressBar>(`/api/progress/${id}`),
  create: (bar: Partial<ProgressBar> & { title: string }) => post<ProgressBar>("/api/progress", bar),
  update: (id: number, changes: Record<string, unknown>) => patch<ProgressBar>(`/api/progress/${id}`, changes),
  remove: (id: number, cascade = false) => del<{ ok?: boolean }>(`/api/progress/${id}${cascade ? "?cascade=1" : ""}`),
  archiveDone: () => post<{ archived: number }>("/api/progress/archive-done", {}),
};

export const docsApi = {
  list: (opts: { prefix?: string; limit?: number; offset?: number; author?: string } = {}) =>
    get<DocListResponse>(`/api/docs${qs({ ...opts })}`),
  tree: (opts: { per?: number; author?: string } = {}) => get<DocTree>(`/api/docs/tree${qs({ ...opts })}`),
  get: (prefix: string) => get<Doc>(`/api/docs/${prefix.split("/").map(encodeURIComponent).join("/")}`),
  create: (prefix: string, body: { content: string; author?: string | null; tags?: string[] }) =>
    post<Doc>(`/api/docs/${prefix.split("/").map(encodeURIComponent).join("/")}`, body),
  save: (prefix: string, body: { content: string; author?: string | null; tags?: string[] }) =>
    put<Doc>(`/api/docs/${prefix.split("/").map(encodeURIComponent).join("/")}`, body),
  patchDoc: (prefix: string, body: { content?: string; author?: string | null; tags?: string[] }) =>
    patch<Doc>(`/api/docs/${prefix.split("/").map(encodeURIComponent).join("/")}`, body),
  remove: (prefix: string) => del<{ ok?: boolean }>(`/api/docs/${prefix.split("/").map(encodeURIComponent).join("/")}`),
  search: (opts: { q?: string; prefix?: string; prefix_q?: string; author?: string; limit?: number }) =>
    get<DocSearchResponse>(`/api/docs/search${qs({ ...opts })}`),
  semantic: (opts: { q: string; prefix?: string; prefix_q?: string; author?: string; sort?: string; limit?: number }) =>
    get<DocSearchResponse>(`/api/docs/semantic${qs({ ...opts })}`),
  /** One ranked list merging exact (FTS) and semantic hits. */
  unified: (opts: { q?: string; prefix?: string; prefix_q?: string; author?: string; sort?: string; limit?: number }) =>
    get<DocSearchResponse>(`/api/docs/search-unified${qs({ ...opts })}`),
  indexStatus: () => get<{ indexed: number; pending: number; total: number; model: string; available: boolean }>("/api/docs/index"),
  reindex: () => post<{ queued: number; model: string }>("/api/docs/reindex", {}),
};

export const tablesApi = {
  list: (opts: { include_archived?: boolean; order_by?: string; order?: string } = {}) =>
    get<{ tables: TableInfo[] }>(`/api/tables${qs({ include_archived: opts.include_archived ? 1 : undefined, order_by: opts.order_by, order: opts.order })}`),
  get: (ref: string | number, opts: { limit?: number; offset?: number; order_by?: string; order?: string; view?: string; include_archived?: boolean } = {}) =>
    get<TablePage>(`/api/tables/${encodeURIComponent(ref)}${qs({ limit: opts.limit, offset: opts.offset, order_by: opts.order_by, order: opts.order, view: opts.view, include_archived: opts.include_archived ? 1 : undefined })}`),
  create: (body: { name: string; description?: string; columns?: unknown[] }) => post<TableInfo>("/api/tables", body),
  update: (ref: string | number, body: Record<string, unknown>) => patch<TableInfo>(`/api/tables/${encodeURIComponent(ref)}`, body),
  remove: (ref: string | number) => del<{ ok?: boolean }>(`/api/tables/${encodeURIComponent(ref)}`),
  columns: (ref: string | number, opts: { order_by?: string } = {}) =>
    get<{ columns: TableColumn[] }>(`/api/tables/${encodeURIComponent(ref)}/columns${qs({ order_by: opts.order_by })}`),
  addColumn: (ref: string | number, body: Record<string, unknown>) => post<TableColumn>(`/api/tables/${encodeURIComponent(ref)}/columns`, body),
  patchColumn: (ref: string | number, colId: number, body: Record<string, unknown>) =>
    patch<TableColumn>(`/api/tables/${encodeURIComponent(ref)}/columns/${colId}`, body),
  deleteColumn: (ref: string | number, colId: number) => del<{ ok?: boolean }>(`/api/tables/${encodeURIComponent(ref)}/columns/${colId}`),
  records: (ref: string | number, opts: { limit?: number; offset?: number; order_by?: string; order?: string; view?: string; include_archived?: boolean } = {}) =>
    get<TablePage>(`/api/tables/${encodeURIComponent(ref)}/records${qs({ limit: opts.limit, offset: opts.offset, order_by: opts.order_by, order: opts.order, view: opts.view, include_archived: opts.include_archived ? 1 : undefined })}`),
  addRecord: (ref: string | number, body: { values: Record<string, unknown> }) => post<TableRecord>(`/api/tables/${encodeURIComponent(ref)}`, body),
  patchRecord: (ref: string | number, recId: number, body: { values?: Record<string, unknown>; archived?: boolean }) =>
    patch<TableRecord>(`/api/tables/${encodeURIComponent(ref)}/records/${recId}`, body),
  deleteRecord: (ref: string | number, recId: number) => del<{ ok?: boolean }>(`/api/tables/${encodeURIComponent(ref)}/records/${recId}`),
  views: (ref: string | number) => get<{ views: TableView[] }>(`/api/tables/${encodeURIComponent(ref)}/views`),
  createView: (ref: string | number, body: { name: string; config: TableViewConfig }) => post<TableView>(`/api/tables/${encodeURIComponent(ref)}/views`, body),
  patchView: (ref: string | number, viewId: number, body: { name: string; config: TableViewConfig }) =>
    patch<TableView>(`/api/tables/${encodeURIComponent(ref)}/views/${viewId}`, body),
  deleteView: (ref: string | number, viewId: number) => del<{ ok?: boolean }>(`/api/tables/${encodeURIComponent(ref)}/views/${viewId}`),
};

export const notesApi = {
  sitrep: (date?: string) => get<SitrepEntry>(`/api/sitrep${qs({ date })}`),
  sitrepList: (limit = 30) => get<SitrepEntry[]>(`/api/sitrep/list${qs({ limit })}`),
  putSitrep: (date: string, content: string) => put<SitrepEntry>("/api/sitrep", { date, content }),
  schedule: (week?: string) => get<ScheduleEntry>(`/api/schedule${qs({ week })}`),
  scheduleList: (limit = 20) => get<ScheduleEntry[]>(`/api/schedule/list${qs({ limit })}`),
  putSchedule: (week: string, content: string) => put<ScheduleEntry>("/api/schedule", { week, content }),
};

export const telemetryApi = {
  stats: () => get<Stats>("/api/stats"),
  history: (seconds = 3600) => get<History>(`/api/stats/history${qs({ seconds })}`),
  procs: (sort = "rss", order = "desc", limit = 40) =>
    get<ProcsResponse>(`/api/procs${qs({ sort, order, limit })}`),
  signal: (pid: number, signal: "TERM" | "KILL") =>
    post<{ ok?: boolean }>(`/api/procs/${pid}/signal`, { signal }),
};

export const fsApi = {
  list: (path?: string) => get<FsListResponse>(`/api/fs/list${qs({ path })}`),
  stat: (path: string) => get<FsStat>(`/api/fs/stat${qs({ path })}`),
  read: (path: string) => get<FsRead>(`/api/fs/read${qs({ path })}`),
  write: (path: string, content: string) => put<{ path: string }>("/api/fs/write", { path, content }),
  mkdir: (parent: string, name: string) => post<{ name: string; path: string }>("/api/fs/mkdir", { parent, name }),
  touch: (parent: string, name: string) => post<{ name: string; path: string }>("/api/fs/touch", { parent, name }),
  rename: (path: string, name: string) => post<{ name: string; path: string }>("/api/fs/rename", { path, name }),
  remove: (path: string) => del<{ ok?: boolean }>(`/api/fs${qs({ path })}`),
  upload: (cwd: string, files: FileList | File[], overwrite: boolean, onProgress?: (pct: number) => void) =>
    new Promise<{ ok?: boolean; error?: string }>((resolve) => {
      const fd = new FormData();
      fd.append("path", cwd);
      if (overwrite) fd.append("overwrite", "1");
      for (const file of Array.from(files)) fd.append("file", file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/fs/upload");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { /* keep {} */ }
        resolve(xhr.status >= 200 && xhr.status < 300
          ? (data as { ok?: boolean })
          : { error: String(data.error || `upload failed (${xhr.status})`) });
      };
      xhr.onerror = () => resolve({ error: "upload failed — network error" });
      xhr.send(fd);
    }),
};

export const logsApi = {
  list: (opts: { limit?: number; tool?: string; ok?: string } = {}) =>
    get<LogsResponse>(`/api/logs${qs({ limit: opts.limit ?? 300, tool: opts.tool, ok: opts.ok })}`),
  rotate: () => post<{ ok?: boolean }>("/api/logs/rotate", {}),
};

export const themeApi = {
  list: () => get<ThemesResponse>("/api/themes"),
  set: (themeId: string) => post<{ theme: string }>("/api/theme", { theme: themeId }),
};

export const configApi = {
  load: () => get<DashboardConfig>("/config.json"),
};
