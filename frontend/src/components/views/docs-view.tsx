"use client";

// Docs explorer: prefix tree, flat sortable list, dual search (exact FTS +
// semantic), and the editor with card backlinks. Ported from the old
// static/js/docs/{view,editor,backlinks}.js and static/css/docs.css.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  get,
  docsApi,
  type Doc,
  type DocHit,
  type DocMeta,
  type DocListResponse,
  type DocSearchResponse,
  type DocTree,
  type TreeFolder,
} from "@/lib/api";
import { markedParts } from "@/lib/markdown";
import { fmtTime, syncedAt } from "@/lib/format";
import { useModal } from "@/components/modal-provider";
import { DashboardButton } from "@/components/block/dashboard-shell";
import "../docs.css";

const SEARCH_MIN = 2;
const LIST_LIMIT = 200;
/** Semantic-only additions below the exact hits, per search. */
const SEMANTIC_LIMIT = 10;
const DEBOUNCE_MS = 180;
const ARM_MS = 3000;

const SCOPE_KEY = "docs.prefix";
const TREE_KEY = "docs.collapsed";
const VIEW_KEY = "docs.view";
const SORT_KEY = "docs.sort";
const AUTHOR_KEY = "docs.author";
const NO_AUTHOR = "__none__";

type SortKey = "prefix" | "updated" | "author";
type SortDir = 1 | -1;
interface SortState { key: SortKey; dir: SortDir }
type ViewMode = "tree" | "flat";
interface DocForm { prefix: string; author: string; tags: string; content: string }
interface AuthorEntry { author: string; count: number }
interface AuthorOption { value: string; label: string }
interface SearchOverride { q?: string; prefixQ?: string; scope?: string; author?: string }

type TreeDoc = { prefix: string; author: string | null; card_count?: number };

interface TreeRow {
  kind: "folder" | "doc" | "more";
  key: string;
  depth: number;
  path?: string;
  name?: string;
  total?: number;
  open?: boolean;
  scoped?: boolean;
  prefix?: string;
  author?: string | null;
  cards?: number;
  more?: number;
  selected?: boolean;
}

/* Author param semantics differ from qs(): "" means no filter, the sentinel
   becomes a present-but-empty `author=` (docs with no author). */
function docsQuery(params: Record<string, string | number | undefined>, author: string): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  if (author === NO_AUTHOR) search.set("author", "");
  else if (author) search.set("author", author);
  const text = search.toString();
  return text ? `?${text}` : "";
}

const lastSegment = (prefix: string) => prefix.split("/").pop() || prefix;
const tagLabel = (tags: string[] | null | undefined) => (tags || []).join(" · ");

/* ----- small shared pieces ----- */

function Marked({ text }: { text: string }) {
  const parts = useMemo(() => markedParts(text), [text]);
  return (
    <>
      {parts.map((part, i) =>
        part.mark
          ? <mark className="docs-hl" key={i}>{part.text}</mark>
          : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

/* One result row: search hits and (in scoped tree mode) plain list docs. */
interface ItemHit {
  prefix: string;
  author: string | null;
  tags: string[];
  updated_at: string;
  size: number;
  snippet?: string;
  excerpt?: string;
  score?: number;
  prefix_snip?: string;
  kind?: "exact" | "semantic";
}

function ItemRow({ hit, selected, onOpen }: { hit: ItemHit; selected: boolean; onOpen: (prefix: string) => void }) {
  const tags = hit.tags || [];
  const snip = hit.snippet || hit.excerpt || "";
  return (
    <li
      className={`docs-item${hit.kind === "semantic" ? " is-semantic" : ""}${selected ? " selected" : ""}`}
      data-prefix={hit.prefix}
      onClick={() => onOpen(hit.prefix)}
    >
      <div className="docs-item-head">
        <span className="docs-item-name"><Marked text={hit.prefix_snip || hit.prefix} /></span>
        {hit.kind === "semantic" && typeof hit.score === "number" && hit.score > 0 && (
          <span className="docs-score">{hit.score.toFixed(2)}</span>
        )}
      </div>
      {snip && <p className="docs-item-snip"><Marked text={snip} /></p>}
      <span className="docs-item-meta">
        <span>{hit.author ? `@${hit.author}` : "—"}</span>
        <span>{fmtTime(hit.updated_at)}</span>
        {tags.length > 0
          ? <span className="docs-item-tags">{tagLabel(tags)}</span>
          : hit.size ? <span>{hit.size}b</span> : null}
      </span>
    </li>
  );
}

/* One flat-table row: prefix + card chip + tags, updated, author. */
function FlatRow({ doc, selected, onOpen }: { doc: DocMeta; selected: boolean; onOpen: (prefix: string) => void }) {
  const tags = doc.tags || [];
  return (
    <li
      className={`docs-flat-row${selected ? " selected" : ""}`}
      data-prefix={doc.prefix}
      onClick={() => onOpen(doc.prefix)}
    >
      <span className="docs-flat-cell is-prefix">
        <span className="docs-flat-prefix">{doc.prefix}</span>
        {!!doc.card_count && <span className="docs-tree-cards">⧉{doc.card_count}</span>}
        {tags.length > 0 && <span className="docs-flat-tags">{tagLabel(tags)}</span>}
      </span>
      <span className="docs-flat-cell is-updated">{fmtTime(doc.updated_at)}</span>
      <span className="docs-flat-cell is-author">{doc.author ? `@${doc.author}` : "—"}</span>
    </li>
  );
}

/* ----- the view ----- */

export function DocsView({ openPrefix = "" }: { openPrefix?: string }) {
  const [all, setAll] = useState<DocMeta[]>([]);
  const [tree, setTree] = useState<DocTree | null>(null);
  const [folderDocs, setFolderDocs] = useState<Record<string, DocMeta[]>>({});
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("tree");
  const [sort, setSort] = useState<SortState>({ key: "updated", dir: -1 });
  const [q, setQ] = useState("");
  const [prefixQ, setPrefixQ] = useState("");
  /** One ranked list from /api/docs/search-unified: exact + semantic merged. */
  const [searchHits, setSearchHits] = useState<DocHit[]>([]);
  const [prefix, setPrefix] = useState("");
  const [author, setAuthor] = useState("");
  const [authors, setAuthors] = useState<AuthorEntry[]>([]);
  const [authorsFailed, setAuthorsFailed] = useState(false);
  const [current, setCurrent] = useState<Doc | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<DocForm>({ prefix: "", author: "", tags: "", content: "" });
  const [dirty, setDirty] = useState(false);
  const [docStatus, setDocStatus] = useState("");
  const [status, setStatusState] = useState("loading…");
  const [statusError, setStatusError] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const seqRef = useRef(0);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefixInputRef = useRef<HTMLInputElement>(null);
  const bootedRef = useRef(false);
  const openedOnceRef = useRef(false);

  const openModal = useModal();

  const setStatus = useCallback((text: string, isError = false) => {
    setStatusState(text);
    setStatusError(isError);
  }, []);

  /* ---- list + tree ---- */

  const listSeqRef = useRef(0);

  const loadList = useCallback(async (authorOverride?: string) => {
    const auth = authorOverride ?? author;
    const seq = ++listSeqRef.current;
    const [list, treeData] = await Promise.all([
      get<DocListResponse>(`/api/docs${docsQuery({ limit: LIST_LIMIT }, auth)}`),
      get<DocTree>(`/api/docs/tree${docsQuery({ per: 5 }, auth)}`),
    ]);
    if (seq !== listSeqRef.current) return;
    setAll(list.docs || []);
    setTree(treeData);
    setFolderDocs({});
  }, [author]);

  const refresh = useCallback(async (authorOverride?: string) => {
    try {
      await loadList(authorOverride);
      setStatus(`synced ${syncedAt()}`);
    } catch (err) {
      setStatus(`load failed: ${(err as Error).message}`, true);
    }
  }, [loadList, setStatus]);

  /* ---- search: one unified request, one ranked list ---- */

  const runSearch = useCallback(async (over: SearchOverride = {}) => {
    const qv = (over.q ?? q).trim();
    const pqv = (over.prefixQ ?? prefixQ).trim();
    const scope = over.scope ?? prefix;
    const auth = over.author ?? author;
    if (!(qv.length >= SEARCH_MIN || pqv.length > 0)) {
      setSearchHits([]);
      return;
    }
    const seq = ++seqRef.current;
    try {
      const params = {
        q: qv,
        limit: LIST_LIMIT,
        prefix: scope || undefined,
        prefix_q: pqv || undefined,
        // keep the old semantic budget: weak cosine tail is noise
        semantic_limit: SEMANTIC_LIMIT,
      };
      // The unified endpoint merges FTS and semantic hits into one ranked
      // set; if the embedder is down it degrades to exact-only on its own.
      const data = await get<DocSearchResponse>(
        `/api/docs/search-unified${docsQuery(params, auth)}`,
      );
      if (seq !== seqRef.current) return;
      const hits = data.hits || [];
      setSearchHits(hits);
      const exact = hits.filter((h) => h.kind !== "semantic").length;
      const semantic = hits.length - exact;
      setStatus(
        `${hits.length} result${hits.length === 1 ? "" : "s"}`
        + (semantic ? ` · ${exact} exact · ${semantic} semantic` : "")
        + ` · ${data.took_ms ?? 0}ms`
        + (pqv ? ` · prefix ${pqv}` : "")
        + (data.pending ? ` · ${data.pending} unindexed` : ""),
      );
    } catch (err) {
      if (seq !== seqRef.current) return;
      setSearchHits([]);
      setStatus(`search failed: ${(err as Error).message}`, true);
    }
  }, [q, prefixQ, prefix, author, setStatus]);

  const runSearchRef = useRef(runSearch);
  useEffect(() => { runSearchRef.current = runSearch; }, [runSearch]);

  // both inputs debounce; runSearch no-ops below the thresholds
  useEffect(() => {
    const timer = setTimeout(() => { runSearchRef.current(); }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, prefixQ]);

  const clearSearch = useCallback(() => {
    setQ("");
    setPrefixQ("");
    setSearchHits([]);
    setStatus(`cleared · ${all.length} docs`);
  }, [all.length, setStatus]);

  /* ---- editor ---- */

  const fillEditor = useCallback((doc: Doc | null) => {
    setCurrent(doc);
    setForm({
      prefix: doc ? doc.prefix : "",
      author: doc ? (doc.author || "") : "",
      tags: doc ? (doc.tags || []).join(", ") : "",
      content: doc ? (doc.content || "") : "",
    });
    setDirty(false);
    setEditorOpen(true);
    setDeleteArmed(false);
    setDocStatus(doc
      ? `rev ${doc.revision} · created ${fmtTime(doc.created_at)} · updated ${fmtTime(doc.updated_at)}`
      : "new doc");
  }, []);

  const confirmDiscard = useCallback(() => openModal({
    title: "Discard unsaved changes?",
    text: "the open doc has edits that are not saved yet.",
    ok: "discard",
    danger: true,
  }), [openModal]);

  const selectDoc = useCallback(async (docPrefix: string) => {
    if (dirty) {
      const ok = await confirmDiscard();
      if (ok !== true) return;
    }
    try {
      const doc = await docsApi.get(docPrefix);
      fillEditor(doc);
      setStatus(`opened ${doc.prefix}`);
    } catch (err) {
      setStatus(`open failed: ${(err as Error).message}`, true);
    }
  }, [dirty, confirmDiscard, fillEditor, setStatus]);

  const selectDocRef = useRef(selectDoc);
  useEffect(() => { selectDocRef.current = selectDoc; }, [selectDoc]);

  const startNew = useCallback(async () => {
    if (dirty) {
      const ok = await confirmDiscard();
      if (ok !== true) return;
    }
    fillEditor(null);
    setTimeout(() => prefixInputRef.current?.focus(), 0);
  }, [dirty, confirmDiscard, fillEditor]);

  const changeForm = useCallback((field: keyof DocForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      // a blank new draft is not dirty; anything else marks the editor
      const nextPrefix = field === "prefix" ? value : form.prefix;
      if (!current && !nextPrefix.trim()) return;
      setDirty(true);
      setDocStatus("unsaved changes");
    }, [current, form.prefix]);

  const save = useCallback(async () => {
    const docPrefix = form.prefix.trim().replace(/^\/+|\/+$/g, "");
    if (!docPrefix) {
      setStatus("prefix is required", true);
      prefixInputRef.current?.focus();
      return;
    }
    const body = {
      content: form.content,
      author: form.author.trim() || null,
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    };
    try {
      const doc = await docsApi.save(docPrefix, body);
      fillEditor(doc);
      setStatus(`saved ${doc.prefix} · rev ${doc.revision}`);
      await refresh();
      if (q || prefixQ) await runSearchRef.current();
    } catch (err) {
      setStatus(`save failed: ${(err as Error).message}`, true);
    }
  }, [form, fillEditor, refresh, setStatus, q, prefixQ]);

  const removeDoc = useCallback(async () => {
    if (!current) return;
    const docPrefix = current.prefix;
    try {
      await docsApi.remove(docPrefix);
      setCurrent(null);
      setEditorOpen(false);
      setQ("");
      setPrefixQ("");
      setSearchHits([]);
      setStatus(`deleted ${docPrefix}`);
      await refresh();
    } catch (err) {
      setStatus(`delete failed: ${(err as Error).message}`, true);
    }
  }, [current, refresh, setStatus]);

  // two-click armed delete: first click arms for 3s, second fires
  const onDeleteClick = useCallback(() => {
    if (deleteArmed) {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      setDeleteArmed(false);
      removeDoc();
      return;
    }
    setDeleteArmed(true);
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = setTimeout(() => setDeleteArmed(false), ARM_MS);
  }, [deleteArmed, removeDoc]);

  useEffect(() => () => {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
  }, []);

  const onEditorKey = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
    }
  }, [save]);

  // beforeunload guard while the editor is dirty
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /* ---- boot: restore prefs, load, honor the deep link ---- */

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    let savedAuthor = "";
    try {
      const savedPrefix = localStorage.getItem(SCOPE_KEY);
      if (savedPrefix) setPrefix(savedPrefix);
      savedAuthor = localStorage.getItem(AUTHOR_KEY) || "";
      if (savedAuthor) setAuthor(savedAuthor);
      const savedView = localStorage.getItem(VIEW_KEY);
      if (savedView === "flat" || savedView === "tree") setView(savedView);
      const savedSort = JSON.parse(localStorage.getItem(SORT_KEY) || "null") as SortState | null;
      if (savedSort && ["prefix", "updated", "author"].includes(savedSort.key)) {
        setSort({ key: savedSort.key, dir: savedSort.dir === 1 ? 1 : -1 });
      }
      const savedCollapsed = JSON.parse(localStorage.getItem(TREE_KEY) || "[]") as unknown;
      if (Array.isArray(savedCollapsed)) setCollapsed(savedCollapsed.map(String));
    } catch { /* storage blocked */ }
    refresh(savedAuthor).then(() => { if (openPrefix) selectDocRef.current(openPrefix); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hash deep link while the view stays mounted: #/docs/<prefix>
  useEffect(() => {
    if (!openedOnceRef.current) {
      openedOnceRef.current = true;
      return;
    }
    if (openPrefix) selectDocRef.current(openPrefix);
  }, [openPrefix]);

  // authors from the endpoint, or derived from the loaded list when it 404s
  useEffect(() => {
    let alive = true;
    get<{ authors: AuthorEntry[] }>("/api/docs/authors")
      .then((data) => { if (alive) setAuthors(data.authors || []); })
      .catch(() => { if (alive) setAuthorsFailed(true); });
    return () => { alive = false; };
  }, []);

  /* ---- derived ---- */

  // client-side fallback mirrors the server merge: case variants fold under
  // the most used spelling, '' counts unowned docs
  const derivedAuthors = useMemo<AuthorEntry[]>(() => {
    const merged = new Map<string, { spellings: Map<string, number>; count: number }>();
    for (const doc of all) {
      const name = doc.author || "";
      const key = name.toLowerCase();
      let entry = merged.get(key);
      if (!entry) { entry = { spellings: new Map(), count: 0 }; merged.set(key, entry); }
      entry.spellings.set(name, (entry.spellings.get(name) || 0) + 1);
      entry.count += 1;
    }
    const out: AuthorEntry[] = [];
    for (const entry of merged.values()) {
      const best = [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      out.push({ author: best, count: entry.count });
    }
    return out.sort((a, b) => a.author.toLowerCase().localeCompare(b.author.toLowerCase()));
  }, [all]);

  const authorOptions = useMemo<AuthorOption[]>(() => {
    const source = authorsFailed ? derivedAuthors : authors;
    const out: AuthorOption[] = [{ value: "", label: "all authors" }];
    for (const entry of source) {
      if (entry.author) out.push({ value: entry.author, label: `${entry.author} (${entry.count})` });
    }
    if (source.some((entry) => !entry.author)) out.push({ value: NO_AUTHOR, label: "— no author —" });
    if (author && !out.some((option) => option.value === author)) out.push({ value: author, label: author });
    return out;
  }, [authors, authorsFailed, derivedAuthors, author]);

  const searching = q.length >= SEARCH_MIN || prefixQ.length > 0;
  const flatMode = view === "flat" && !searching;
  const listVisible = view === "flat" || searching || !!prefix;

  const scopedDocs = useMemo(() => {
    if (!prefix) return all;
    return all.filter((doc) => doc.prefix === prefix || doc.prefix.startsWith(`${prefix}/`));
  }, [all, prefix]);

  const sortedDocs = useMemo(() => {
    const value = (doc: DocMeta) => {
      if (sort.key === "prefix") return doc.prefix.toLowerCase();
      if (sort.key === "author") return (doc.author || "").toLowerCase();
      return new Date(doc.updated_at).getTime() || 0;
    };
    return scopedDocs.slice().sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (left === right) return a.prefix.localeCompare(b.prefix);
      return (left < right ? -1 : 1) * sort.dir;
    });
  }, [scopedDocs, sort]);

  const treeRows = useMemo<TreeRow[]>(() => {
    if (!tree) return [];
    const rows: TreeRow[] = [];
    const docRow = (doc: TreeDoc, depth: number): TreeRow => ({
      kind: "doc",
      key: `d:${doc.prefix}`,
      prefix: doc.prefix,
      name: depth === 0 ? doc.prefix : lastSegment(doc.prefix),
      author: doc.author,
      cards: doc.card_count || 0,
      depth,
      selected: !!current && current.prefix === doc.prefix,
    });
    const walk = (folders: TreeFolder[] | undefined, depth: number) => {
      for (const folder of folders || []) {
        const open = !collapsed.includes(folder.path);
        rows.push({
          kind: "folder",
          key: `f:${folder.path}`,
          path: folder.path,
          name: folder.name,
          depth,
          total: folder.total,
          open,
          scoped: prefix === folder.path,
        });
        if (!open) continue;
        walk(folder.folders, depth + 1);
        const cached = folderDocs[folder.path];
        const docs = cached || folder.docs || [];
        for (const doc of docs) rows.push(docRow(doc, depth + 1));
        const more = cached ? 0 : folder.more;
        if (more > 0) rows.push({ kind: "more", key: `m:${folder.path}`, path: folder.path, depth, more });
      }
    };
    walk(tree.folders, 0);
    for (const doc of tree.docs || []) rows.push(docRow(doc, 0));
    if (tree.more > 0) rows.push({ kind: "more", key: "m:root", path: "", depth: 0, more: tree.more });
    return rows;
  }, [tree, collapsed, folderDocs, prefix, current]);

  const rowCount = searching
    ? searchHits.length
    : flatMode ? sortedDocs.length : scopedDocs.length;

  const countText = useMemo(() => {
    const total = all.length;
    const noun = total === 1 ? "doc" : "docs";
    if (searching) {
      const semantic = searchHits.filter((h) => h.kind === "semantic").length;
      const exact = searchHits.length - semantic;
      const parts = [`${exact} exact`, ...(semantic ? [`${semantic} semantic`] : [])];
      return `${parts.join(" · ")} · ${total} ${noun}`;
    }
    if (view === "flat") return `${total} ${noun} · sorted by ${sort.key}`;
    return `${total} ${noun}${prefix ? ` under ${prefix}` : ""}`;
  }, [all.length, searching, searchHits, view, sort.key, prefix]);

  const emptyListText = searching
    ? (q ? `no matches for “${q}”` : `no docs under prefix “${prefixQ}”`)
    : "no docs yet";

  /* ---- handlers ---- */

  const setViewMode = (mode: ViewMode) => {
    setView(mode);
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* storage blocked */ }
  };

  const setSortKey = (key: SortKey) => {
    setSort((prev) => {
      const next: SortState = prev.key === key
        ? { key, dir: prev.dir === 1 ? -1 : 1 }
        : { key, dir: key === "updated" ? -1 : 1 };
      try { localStorage.setItem(SORT_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  };

  const setScope = (next: string) => {
    setPrefix(next);
    try {
      if (next) localStorage.setItem(SCOPE_KEY, next);
      else localStorage.removeItem(SCOPE_KEY);
    } catch { /* storage blocked */ }
    if (q || prefixQ) runSearchRef.current({ scope: next });
  };

  const onAuthorChange = (value: string) => {
    setAuthor(value);
    try {
      if (value) localStorage.setItem(AUTHOR_KEY, value);
      else localStorage.removeItem(AUTHOR_KEY);
    } catch { /* storage blocked */ }
    loadList(value).catch((err) => setStatus(`load failed: ${(err as Error).message}`, true));
    if (q.length >= SEARCH_MIN || prefixQ.length > 0) runSearchRef.current({ author: value });
  };

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(path) ? prev.filter((entry) => entry !== path) : [...prev, path];
      try { localStorage.setItem(TREE_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  };

  const showMore = async (row: TreeRow) => {
    try {
      if (row.path) {
        const data = await docsApi.list({ prefix: row.path, limit: LIST_LIMIT });
        const docs = (data.docs || []).slice()
          .sort((a, b) => lastSegment(a.prefix).localeCompare(lastSegment(b.prefix)));
        setFolderDocs((prev) => ({ ...prev, [row.path as string]: docs }));
      } else {
        const data = await docsApi.list({ limit: LIST_LIMIT });
        const roots = (data.docs || [])
          .filter((doc) => !doc.prefix.includes("/"))
          .sort((a, b) => a.prefix.localeCompare(b.prefix));
        setTree((prev) => (prev ? { ...prev, docs: roots, more: 0 } : prev));
      }
    } catch (err) {
      setStatus(`load failed: ${(err as Error).message}`, true);
    }
  };

  const onSearchKey = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") clearSearch();
  }, [clearSearch]);

  const SortCell = ({ label, sortKey }: { label: string; sortKey: SortKey }) => (
    <span className={`docs-flat-cell is-${sortKey}`}>
      <button
        type="button"
        className={`docs-sort${sort.key === sortKey ? " active" : ""}`}
        onClick={() => setSortKey(sortKey)}
      >
        {label}
        {sort.key === sortKey && <span className="docs-sort-arrow">{sort.dir === 1 ? "▲" : "▼"}</span>}
      </button>
    </span>
  );

  const isSelected = (docPrefix: string) => !!current && current.prefix === docPrefix;

  return (
    <section className="docs" aria-label="Docs">
      <div className="docs-head">
        <div className="docs-searchbox" role="search">
          <input
            id="docs-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="search docs…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Full-text search over prefixes, content, tags and authors"
          />
          <input
            id="docs-prefix-q"
            type="search"
            value={prefixQ}
            onChange={(e) => setPrefixQ(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="prefix…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Filter results by doc prefix, any part of the key"
            title="Prefix search: any part of the doc key, e.g. card-389 or handoffs/"
          />
          {(q || prefixQ) && (
            <button type="button" id="docs-search-clear" title="Clear search" onClick={clearSearch}>×</button>
          )}
        </div>
        <div className="docs-actions">
          <DashboardButton id="docs-new" variant="secondary" size="sm" title="New doc" onClick={startNew}>
            + new
          </DashboardButton>
          <DashboardButton id="docs-refresh" variant="secondary" size="sm" title="Reload the list" onClick={() => refresh()}>
            ⟳ refresh
          </DashboardButton>
        </div>
      </div>

      <div className={`docs-body${view === "flat" ? " is-flat" : ""}`}>
        <div className="docs-list-wrap">
          <div className="docs-toolbar" role="group" aria-label="Explorer mode">
            <select
              id="docs-author"
              className={`docs-author${author ? " active" : ""}`}
              value={author}
              onChange={(e) => onAuthorChange(e.target.value)}
              aria-label="Filter by author"
              title="Only docs by this author"
            >
              {authorOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              type="button"
              id="docs-view-tree"
              className={`docs-toggle${view === "tree" ? " active" : ""}`}
              aria-pressed={view === "tree"}
              title="Browse by prefix path"
              onClick={() => setViewMode("tree")}
            >
              [tree]
            </button>
            <button
              type="button"
              id="docs-view-flat"
              className={`docs-toggle${view === "flat" ? " active" : ""}`}
              aria-pressed={view === "flat"}
              title="One list, sortable by prefix, updated or author"
              onClick={() => setViewMode("flat")}
            >
              [flat]
            </button>
          </div>

          <div className="docs-list-scroll">
            {view === "tree" && !searching && (
              <>
                <ul className="docs-tree-list" aria-label="Prefix tree">
                  {treeRows.map((row) => {
                    if (row.kind === "folder") {
                      return (
                        <li key={row.key} className="docs-tree-folder">
                          <div
                            className="docs-tree-row"
                            style={{ "--docs-depth": row.depth } as CSSProperties}
                          >
                            <button
                              type="button"
                              className="docs-tree-twist"
                              title={row.open ? "Collapse" : "Expand"}
                              onClick={() => toggleFolder(row.path as string)}
                            >
                              {row.open ? "▾" : "▸"}
                            </button>
                            <button
                              type="button"
                              className={`docs-tree-name${row.scoped ? " scoped" : ""}`}
                              title={`Scope to ${row.path}/`}
                              onClick={() => setScope(prefix === row.path ? "" : row.path as string)}
                            >
                              {row.name}
                            </button>
                            <span className="docs-tree-count">{row.total}</span>
                          </div>
                        </li>
                      );
                    }
                    if (row.kind === "doc") {
                      return (
                        <li key={row.key} className="docs-tree-doc">
                          <div
                            className="docs-tree-row is-leaf"
                            style={{ "--docs-depth": row.depth } as CSSProperties}
                          >
                            <span className="docs-tree-twist" aria-hidden>·</span>
                            <button
                              type="button"
                              className={`docs-tree-name is-doc${row.selected ? " open" : ""}`}
                              title={row.prefix + (row.author ? ` · @${row.author}` : "")}
                              onClick={() => selectDocRef.current(row.prefix as string)}
                            >
                              {row.name}
                            </button>
                            {!!row.cards && <span className="docs-tree-cards">⧉{row.cards}</span>}
                          </div>
                        </li>
                      );
                    }
                    return (
                      <li key={row.key} className="docs-tree-more-row">
                        <div
                          className="docs-tree-row is-leaf"
                          style={{ "--docs-depth": row.depth } as CSSProperties}
                        >
                          <button
                            type="button"
                            className="docs-tree-more"
                            onClick={() => showMore(row)}
                          >
                            {row.path ? `show ${row.more} more` : `show ${row.more} more at root`}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {all.length === 0 && <p className="docs-tree-empty">no docs yet</p>}
              </>
            )}

            {listVisible && (
              <ul className="docs-list" id="docs-list">
                {flatMode && (
                  <li className="docs-flat-row docs-flat-head">
                    <SortCell label="prefix" sortKey="prefix" />
                    <SortCell label="updated" sortKey="updated" />
                    <SortCell label="author" sortKey="author" />
                  </li>
                )}
                {searching ? (
                  searchHits.map((hit) => (
                    <ItemRow
                      key={hit.prefix}
                      hit={hit}
                      selected={isSelected(hit.prefix)}
                      onOpen={selectDoc}
                    />
                  ))
                ) : flatMode ? (
                  sortedDocs.map((doc) => (
                    <FlatRow key={doc.prefix} doc={doc} selected={isSelected(doc.prefix)} onOpen={selectDoc} />
                  ))
                ) : (
                  scopedDocs.map((doc) => (
                    <ItemRow key={doc.prefix} hit={doc} selected={isSelected(doc.prefix)} onOpen={selectDoc} />
                  ))
                )}
              </ul>
            )}
            {listVisible && rowCount === 0 && <p className="docs-empty-list">{emptyListText}</p>}
          </div>
        </div>

        {editorOpen ? (
          <div className="docs-editor" id="docs-editor" onKeyDown={onEditorKey}>
            <div className="docs-meta">
              <label className="mono">
                prefix
                <input
                  ref={prefixInputRef}
                  id="doc-prefix"
                  value={form.prefix}
                  readOnly={!!current}
                  onChange={changeForm("prefix")}
                  spellCheck={false}
                  placeholder="notes/handoff.md"
                />
              </label>
              <label className="mono">
                author
                <input
                  id="doc-author"
                  value={form.author}
                  onChange={changeForm("author")}
                  spellCheck={false}
                  placeholder="agent name"
                />
              </label>
              <label className="mono">
                tags
                <input
                  id="doc-tags"
                  value={form.tags}
                  onChange={changeForm("tags")}
                  spellCheck={false}
                  placeholder="handoff, doctrine"
                />
              </label>
            </div>

            {current && (current.cards || []).length > 0 && (
              <div className="docs-backlinks" id="doc-backlinks">
                <span className="docs-backlinks-label">cards · {(current.cards || []).length}</span>
                <div className="docs-backlink-list">
                  {(current.cards || []).map((card) => (
                    <a
                      key={card.id}
                      className="docs-backlink"
                      href={`#/kanban/card-${card.id}`}
                      title={`${card.title} · ${card.status}`}
                      onClick={(e) => {
                        e.preventDefault();
                        window.location.hash = `#/kanban/card-${card.id}`;
                      }}
                    >
                      #{card.id} {card.title}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <textarea
              id="doc-content"
              value={form.content}
              onChange={changeForm("content")}
              spellCheck={false}
              placeholder="markdown…"
            />

            <div className="docs-editor-foot">
              <span className="mono" id="doc-status">{docStatus}</span>
              <div className="docs-editor-actions">
                {current && (
                  <DashboardButton
                    id="doc-delete"
                    variant={deleteArmed ? "danger" : "ghost"}
                    size="sm"
                    title="Delete this doc (two clicks)"
                    onClick={onDeleteClick}
                  >
                    {deleteArmed ? "delete?" : "delete"}
                  </DashboardButton>
                )}
                <DashboardButton id="doc-save" variant="primary" size="sm" title="Save (Cmd/Ctrl+S)" onClick={save}>
                  save
                </DashboardButton>
              </div>
            </div>
          </div>
        ) : (
          <div className="docs-empty" id="docs-empty">
            <p className="mono">select a doc from the list, or start one with + new</p>
            <p className="mono dim">
              prefix is the key: <code>handoffs/2026-11-02-box-assistant.md</code>
            </p>
          </div>
        )}
      </div>

      <div className="docs-status">
        <span id="docs-status" className={statusError ? "err" : undefined}>{status}</span>
        <span id="docs-count">{countText}</span>
      </div>
    </section>
  );
}
