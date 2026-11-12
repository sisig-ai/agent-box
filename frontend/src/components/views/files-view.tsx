"use client";

// Files explorer: folder table + breadcrumb, details/places sidebar, inline
// text editor and uploads. Ported from static/js/files/{view,actions,editor}.js
// and dashboard/page/panels_files.py; the Alpine component became hooks, the
// CodeMirror host became a controlled <textarea>, and the XHR upload with
// progress lives in fsApi.upload.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ApiError, fsApi, type FsEntry, type FsListResponse } from "@/lib/api";
import { fmtSize } from "@/lib/format";
import { useModal, type ModalOptions } from "@/components/modal-provider";
import { DashboardButton } from "@/components/block/dashboard-shell";
import "@/components/files.css";

/* ---------- small helpers (old files/format.js) ---------- */

const fileIcon = (entry: FsEntry) => {
  if (entry.is_link) return "l";
  if (entry.is_dir) return "d";
  return entry.type === "other" ? "?" : "-";
};

// unix seconds -> "Nov 12, 2026, 09:41" style string (old fmtTime)
const fmtTime = (sec: number | null) => {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })} `
    + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const isoText = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

// "~" substitution for the header label
const tildePath = (path: string | null, home: string | null) => {
  if (!path) return "~";
  if (!home || path === home) return "~";
  return path.startsWith(home + "/") ? `~${path.slice(home.length)}` : path;
};

// place paths under ~ get the "~" prefix
const placeLabel = (path: string, home: string | null) => {
  if (!home) return path;
  if (path === home) return "~";
  return path.startsWith(home + "/") ? `~${path.slice(home.length)}` : path;
};

interface InfoRow { k: string; v: string }

interface InfoPanel {
  name: string;
  icon: string;
  rows: InfoRow[];
}

interface EditorState {
  open: boolean;
  name: string;
  path: string;
  text: string;
  savedText: string;
}

const SORT_COLS = ["name", "size", "mtime", "mode"] as const;
type SortKey = (typeof SORT_COLS)[number];

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  size: "Size",
  mtime: "Modified",
  mode: "Mode",
};

/* ---------- the view ---------- */

export function FilesView({ active = true }: { active?: boolean }) {
  const openModal = useModal();

  // folder state
  const [cwd, setCwd] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [places, setPlaces] = useState<FsListResponse["places"]>([]);
  const [truncated, setTruncated] = useState(false);

  // ui state
  const [selected, setSelected] = useState<FsEntry | null>(null);
  const [info, setInfo] = useState<InfoPanel | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState(1);
  const [showHidden, setShowHidden] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("opening ~ …");
  const [statusError, setStatusError] = useState(false);

  // editor state (open file)
  const [editor, setEditor] = useState<EditorState>({ open: false, name: "", path: "", text: "", savedText: "" });

  const uploadRef = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0); // guard stale load() responses
  const statSeq = useRef(0); // guard stale stat() responses
  const say = useCallback((text: string, isError = false) => {
    setStatus(text);
    setStatusError(isError);
  }, []);

  // prompt/confirm runs through openModal; while a modal is up it owns the keys
  const modalOpenRef = useRef(false);
  const modalOpen = useCallback(async (opts: ModalOptions) => {
    modalOpenRef.current = true;
    try {
      return await openModal(opts);
    } finally {
      modalOpenRef.current = false;
    }
  }, [openModal]);

  /* ----- data: list a folder ----- */

  const load = useCallback(async (path: string | null) => {
    const seq = ++loadSeq.current;
    say("loading…");
    try {
      const data = await fsApi.list(path ?? undefined);
      if (seq !== loadSeq.current) return false; // a newer load superseded us
      setCwd(data.path);
      setHome(data.home);
      setParentPath(data.parent);
      setEntries(data.entries || []);
      setPlaces(data.places || []);
      setTruncated(!!data.truncated);
      setSelected(null);
      setInfo(null);
      say(`opened ${data.path}`);
      return true;
    } catch (err) {
      if (seq !== loadSeq.current) return false;
      say(err instanceof Error ? err.message : "could not open folder", true);
      return false;
    }
  }, [say]);

  // load ~ on first mount
  useEffect(() => {
    load(null);
  }, [load]);

  /* ----- editor guard: returns true when safe to navigate ----- */

  const closeEditor = useCallback(async () => {
    if (!editor.open) return true;
    const dirty = editor.text !== editor.savedText;
    if (dirty) {
      const ok = await modalOpen({
        title: "Discard changes?",
        text: `"${editor.name}" has unsaved changes.`,
        ok: "Discard",
        danger: true,
      });
      if (!ok) return false;
    }
    setEditor({ open: false, name: "", path: "", text: "", savedText: "" });
    say("editor closed");
    return true;
  }, [editor.open, editor.name, editor.text, editor.savedText, modalOpen, say]);

  /* ----- navigation ----- */

  const cd = useCallback(async (path: string) => {
    if (!(await closeEditor())) return;
    await load(path);
  }, [closeEditor, load]);

  const goHome = useCallback(() => {
    if (home) void cd(home);
  }, [home, cd]);

  const up = useCallback(() => {
    if (parentPath) void cd(parentPath);
  }, [parentPath, cd]);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    if (!(await closeEditor())) return;
    await load(cwd);
  }, [cwd, closeEditor, load]);

  /* ----- table: visible rows ----- */

  const visible = useMemo(() => {
    const list = entries.filter((entry) => showHidden || !entry.hidden);
    const sorted = list.slice().sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let r: number;
      if (sortKey === "size") r = (a.size || 0) - (b.size || 0);
      else if (sortKey === "mtime") r = (a.mtime || 0) - (b.mtime || 0);
      else if (sortKey === "mode") r = String(a.mode).localeCompare(String(b.mode));
      else r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      return r * sortDir;
    });
    return sorted;
  }, [entries, showHidden, sortKey, sortDir]);

  const countText = useMemo(() => {
    const n = visible.length;
    return `${n} item${n === 1 ? "" : "s"}`;
  }, [visible.length]);

  const crumbs = useMemo(() => {
    if (!cwd) return [] as { key: string; sep?: boolean; label: string; path?: string; current?: boolean }[];
    const out: { key: string; sep?: boolean; label: string; path?: string; current?: boolean }[] = [
      { key: "root", label: "/", path: "/", current: cwd === "/" },
    ];
    let acc = "";
    const parts = cwd.split("/").filter(Boolean);
    parts.forEach((part, i) => {
      acc += `/${part}`;
      out.push({ key: `sep-${i}`, sep: true, label: "/" });
      out.push({ key: acc, label: part, path: acc, current: i === parts.length - 1 });
    });
    return out;
  }, [cwd]);

  const sortBy = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir((d) => -d);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }, [sortKey]);

  /* ----- selection + details ----- */

  const select = useCallback(async (entry: FsEntry) => {
    setSelected(entry);
    const seq = ++statSeq.current;
    // basic entry info first (old renderInfo(entry, null))
    const rows: InfoRow[] = [];
    const add = (k: string, v: string | null | undefined) => {
      if (v != null && v !== "") rows.push({ k, v });
    };
    add("Type", entry.is_link ? `symlink${entry.is_dir ? " → folder" : ""}` : entry.type);
    if (!entry.is_dir) {
      const exact = Number(entry.size || 0);
      add("Size", exact < 1024 ? `${exact} B` : `${fmtSize(entry.size)} (${exact.toLocaleString()} B)`);
    }
    add("Modified", fmtTime(entry.mtime));
    add("Mode", entry.mode);
    add("Access", [entry.readable ? "read" : null, entry.writable ? "write" : null].filter(Boolean).join(" · ") || "none");
    add("Path", entry.path);
    setInfo({ name: entry.name, icon: fileIcon(entry), rows });
    try {
      const detail = await fsApi.stat(entry.path);
      if (seq !== statSeq.current) return; // selection moved on
      if (!detail || detail.path !== entry.path) return;
      const full: InfoRow[] = [];
      const addFull = (k: string, v: string | null | undefined) => {
        if (v != null && v !== "") full.push({ k, v });
      };
      addFull("Type", entry.is_link ? `symlink${entry.is_dir ? " → folder" : ""}` : entry.type);
      if (detail.link_target) addFull("Target", detail.link_target);
      if (!entry.is_dir) {
        const exact = Number(entry.size ?? detail.size ?? 0);
        addFull("Size", exact < 1024 ? `${exact} B` : `${fmtSize(entry.size ?? detail.size)} (${exact.toLocaleString()} B)`);
      }
      addFull("Modified", detail.mtime_iso ? isoText(detail.mtime_iso) || fmtTime(entry.mtime) : fmtTime(entry.mtime));
      if (detail.btime_iso) addFull("Created", isoText(detail.btime_iso));
      addFull("Mode", entry.mode || detail.mode);
      if (detail.owner) addFull("Owner", detail.owner + (detail.group ? `:${detail.group}` : ""));
      if (detail.mime) addFull("Mime", detail.mime);
      addFull("Access", [entry.readable ? "read" : null, entry.writable ? "write" : null].filter(Boolean).join(" · ") || "none");
      addFull("Path", entry.path);
      setInfo({ name: entry.name, icon: fileIcon(entry), rows: full });
    } catch {
      // details are optional; basic entry info stays
    }
  }, []);

  /* ----- downloads ----- */

  const download = useCallback((entry: FsEntry) => {
    if (!entry || entry.is_dir) return;
    const a = document.createElement("a");
    a.href = `/api/fs/download?path=${encodeURIComponent(entry.path)}`;
    a.download = entry.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    say(`downloading ${entry.name}…`);
  }, [say]);

  const downloadCurrent = useCallback(() => {
    if (!editor.open) return;
    const blob = new Blob([editor.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = editor.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [editor.open, editor.name, editor.text]);

  /* ----- editor ----- */

  const openEntry = useCallback(async (entry: FsEntry) => {
    if (!entry || entry.is_dir) {
      if (entry) void cd(entry.path);
      return;
    }
    say(`opening ${entry.name}…`);
    try {
      const data = await fsApi.read(entry.path);
      setEditor({ open: true, name: data.name, path: data.path, text: data.text, savedText: data.text });
      say(`editing ${data.name}`);
    } catch (err) {
      // 413 (too large) / 415 (binary): auto-download instead
      if (err instanceof ApiError && (err.status === 413 || err.status === 415)) {
        say(`${err.message || "not editable"} — downloading ${entry.name}`);
        download(entry);
        return;
      }
      say(err instanceof Error ? err.message : `could not open file`, true);
    }
  }, [cd, download, say]);

  const saveEditor = useCallback(async () => {
    if (!editor.open) return;
    say(`saving ${editor.name}…`);
    try {
      await fsApi.write(editor.path, editor.text);
      setEditor((prev) => ({ ...prev, savedText: prev.text }));
      say(`saved ${editor.name}`);
    } catch (err) {
      say(err instanceof Error ? err.message : "save failed", true);
    }
  }, [editor.open, editor.name, editor.path, editor.text, say]);

  /* ----- create / rename / remove ----- */

  const newFolder = useCallback(async () => {
    if (!cwd) return;
    const name = await modalOpen({ title: "New folder", input: true, value: "untitled folder", ok: "Create" });
    if (typeof name !== "string" || !name) return;
    try {
      const r = await fsApi.mkdir(cwd, name);
      await load(cwd);
      say(`created folder ${r.name}`);
    } catch (err) {
      say(err instanceof Error ? err.message : "could not create folder", true);
    }
  }, [cwd, load, modalOpen, say]);

  const newFile = useCallback(async () => {
    if (!cwd) return;
    const name = await modalOpen({ title: "New empty file", input: true, value: "untitled.txt", ok: "Create" });
    if (typeof name !== "string" || !name) return;
    try {
      const r = await fsApi.touch(cwd, name);
      await load(cwd);
      say(`created file ${r.name}`);
    } catch (err) {
      say(err instanceof Error ? err.message : "could not create file", true);
    }
  }, [cwd, load, modalOpen, say]);

  const renameEntry = useCallback(async (entry: FsEntry) => {
    const name = await modalOpen({ title: "Rename", input: true, value: entry.name, ok: "Rename" });
    if (typeof name !== "string" || !name || name === entry.name) return;
    try {
      const r = await fsApi.rename(entry.path, name);
      await load(cwd);
      say(`renamed to ${r.name}`);
    } catch (err) {
      say(err instanceof Error ? err.message : "rename failed", true);
    }
  }, [cwd, load, modalOpen, say]);

  const removeEntry = useCallback(async (entry: FsEntry) => {
    const ok = await modalOpen({
      title: entry.is_dir ? "Delete folder?" : `Delete ${entry.type === "link" ? "symlink" : "file"}?`,
      text: entry.is_dir
        ? `"${entry.name}" and everything inside it will be deleted.`
        : `"${entry.name}" will be deleted.`,
      ok: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await fsApi.remove(entry.path);
      if (selected && selected.path === entry.path) {
        setSelected(null);
        setInfo(null);
      }
      await load(cwd);
      say(`deleted ${entry.name}`);
    } catch (err) {
      say(err instanceof Error ? err.message : "delete failed", true);
    }
  }, [cwd, load, modalOpen, say, selected]);

  /* ----- upload ----- */

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files || []);
    if (!list.length || !cwd) return;
    let done = 0;
    for (const file of list) {
      const clash = entries.some((entry) => entry.name === file.name);
      let overwrite = false;
      if (clash) {
        const ok = await modalOpen({
          title: "Overwrite file?",
          text: `"${file.name}" already exists in this folder.`,
          ok: "Overwrite",
          danger: true,
        });
        if (!ok) continue;
        overwrite = true;
      }
      const res = await fsApi.upload(cwd, [file], overwrite, (pct) => {
        say(`uploading ${file.name} — ${pct}%`);
      });
      if (res.error) {
        say(res.error, true);
        continue;
      }
      done++;
    }
    if (uploadRef.current) uploadRef.current.value = "";
    if (done) {
      await load(cwd);
      say(`uploaded ${done} file${done === 1 ? "" : "s"}`);
    }
  }, [cwd, entries, load, modalOpen, say]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer?.files?.length) void uploadFiles(event.dataTransfer.files);
  }, [uploadFiles]);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); // needed for the drop event to fire
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    // only clear when the pointer leaves the pane itself (old .self guard)
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDragging(false);
  }, []);

  /* ----- keyboard (view active, no modal, editor closed, not typing) ----- */

  // refs keep the latest values for the global handler without re-binding it
  const editorOpenRef = useRef(editor.open);
  editorOpenRef.current = editor.open;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (editorOpenRef.current) return; // the editor textarea handles its own keys
      if (modalOpenRef.current) return; // a prompt/confirm modal is open
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "Backspace") {
        event.preventDefault();
        up();
      } else if (event.key === "Enter" && selectedRef.current) {
        event.preventDefault();
        const entry = selectedRef.current;
        if (entry.is_dir) void cd(entry.path);
        else void openEntry(entry);
      } else if (event.key === "Delete" && selectedRef.current) {
        event.preventDefault();
        void removeEntry(selectedRef.current);
      } else if (event.key.toLowerCase() === "r" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cd, openEntry, refresh, removeEntry, up]);

  // editor textarea: Cmd/Ctrl+S saves, Esc closes (confirm when dirty).
  // a second Esc while the discard-confirm modal is up must not stack
  // another modal — the modal owns the keys until it resolves.
  const onEditorKey = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveEditor();
    } else if (event.key === "Escape" && !modalOpenRef.current) {
      event.preventDefault();
      void closeEditor();
    }
  }, [saveEditor, closeEditor]);

  /* ----- render ----- */

  const dirty = editor.open && editor.text !== editor.savedText;
  const atRoot = !parentPath;

  return (
    <div className="files-root">
      {/* header */}
      <div className="files-head">
        <div className="files-title">
          <h2>Files</h2>
          <span className="files-path-label" title={cwd || ""}>{tildePath(cwd, home)}</span>
        </div>
        <div className="files-actions">
          <DashboardButton variant="secondary" size="sm" title="Up one level" disabled={atRoot} onClick={up}>↑ up</DashboardButton>
          <DashboardButton variant="secondary" size="sm" title="Go to home directory" onClick={goHome}>~ home</DashboardButton>
          <DashboardButton variant="secondary" size="sm" title="Reload this folder" onClick={() => void refresh()}>⟳ refresh</DashboardButton>
          <DashboardButton
            variant="secondary"
            size="sm"
            title="Show or hide dotfiles"
            className={showHidden ? "files-armed" : undefined}
            onClick={() => setShowHidden((v) => !v)}
          >
            ◌ hidden
          </DashboardButton>
          <DashboardButton variant="secondary" size="sm" title="Create a new folder" onClick={() => void newFolder()}>+ folder</DashboardButton>
          <DashboardButton variant="secondary" size="sm" title="Create a new empty file" onClick={() => void newFile()}>+ file</DashboardButton>
          <DashboardButton variant="secondary" size="sm" title="Upload files into this folder" onClick={() => uploadRef.current?.click()}>⬆ upload</DashboardButton>
          <input
            ref={uploadRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void uploadFiles(e.target.files ?? []);
            }}
          />
        </div>
      </div>

      {/* breadcrumb (hidden while the editor is open) */}
      {!editor.open && (
        <nav className="files-breadcrumb" aria-label="Current folder">
          {crumbs.map((item) =>
            item.sep ? (
              <span key={item.key} className="files-crumb-sep">{item.label}</span>
            ) : (
              <span
                key={item.key}
                role={item.current ? undefined : "button"}
                tabIndex={item.current ? undefined : 0}
                className={`files-crumb${item.current ? " current" : ""}`}
                onClick={() => !item.current && item.path && void cd(item.path)}
                onKeyDown={(e) => {
                  if (!item.current && item.path && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    void cd(item.path);
                  }
                }}
              >
                {item.label}
              </span>
            ),
          )}
        </nav>
      )}

      {/* body: editor or list + sidebar */}
      <div className="files-body">
        {editor.open ? (
          <div className="files-editor">
            <div className="files-editor-head">
              <span className="files-editor-name">{editor.name}</span>
              {dirty && <span className="files-editor-dirty">unsaved</span>}
              <div className="files-editor-actions">
                <DashboardButton variant="secondary" size="sm" title="Save (Cmd/Ctrl+S)" onClick={() => void saveEditor()}>save</DashboardButton>
                <DashboardButton variant="secondary" size="sm" title="Download current content" onClick={downloadCurrent}>download</DashboardButton>
                <DashboardButton variant="secondary" size="sm" title="Close (Esc)" onClick={() => void closeEditor()}>close</DashboardButton>
              </div>
            </div>
            <textarea
              className="files-editor-host obsidian-dashboard-shell-scroll"
              value={editor.text}
              spellCheck={false}
              onChange={(e) => setEditor((prev) => ({ ...prev, text: e.target.value }))}
              onKeyDown={onEditorKey}
            />
          </div>
        ) : (
          <>
            <div
              className={`files-list-wrap${dragging ? " dragover" : ""}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <table className="files-table">
                <thead>
                  <tr>
                    {SORT_COLS.map((key) => (
                      <th
                        key={key}
                        className={`col-${key}${sortKey === key ? " files-sorted" : ""}${sortKey === key && sortDir === 1 ? " files-asc" : ""}`}
                        data-sort={key}
                        aria-sort={sortKey === key ? (sortDir === 1 ? "ascending" : "descending") : undefined}
                        onClick={() => sortBy(key)}
                      >
                        {SORT_LABELS[key]}
                      </th>
                    ))}
                    <th className="col-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => (
                    <tr
                      key={entry.path}
                      className={`files-row${selected?.path === entry.path ? " selected" : ""}`}
                      onClick={() => void select(entry)}
                      onDoubleClick={() => (entry.is_dir ? void cd(entry.path) : void openEntry(entry))}
                    >
                      <td>
                        <div className="files-name-cell">
                          <span className="files-icon">{fileIcon(entry)}</span>
                          <span className="files-name">{entry.name}</span>
                          {entry.is_link && <span className="files-link-note">link</span>}
                        </div>
                      </td>
                      <td className="files-size">{entry.is_dir ? "—" : fmtSize(entry.size)}</td>
                      <td className="files-date">{fmtTime(entry.mtime)}</td>
                      <td className="files-mode">{entry.mode}</td>
                      <td className="files-actions-cell">
                        <div className="files-row-actions">
                          {entry.is_dir ? (
                            <button type="button" className="files-act" title="Open folder" onClick={(e) => { e.stopPropagation(); void cd(entry.path); }}>▸</button>
                          ) : (
                            <button type="button" className="files-act" title="Open in editor" onClick={(e) => { e.stopPropagation(); void openEntry(entry); }}>⤢</button>
                          )}
                          {!entry.is_dir && (
                            <button type="button" className="files-act" title="Download" onClick={(e) => { e.stopPropagation(); download(entry); }}>⬇</button>
                          )}
                          <button type="button" className="files-act" title="Rename" onClick={(e) => { e.stopPropagation(); void renameEntry(entry); }}>✎</button>
                          <button type="button" className="files-act files-act-danger" title="Delete" onClick={(e) => { e.stopPropagation(); void removeEntry(entry); }}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 && (
                <div className="files-empty">// this folder is empty</div>
              )}
              {truncated && (
                <div className="files-empty">// listing truncated — open the folder directly for more</div>
              )}
              <div className="files-drop-hint">drop to upload into this folder</div>
            </div>

            {/* details + places sidebar */}
            <aside className="files-info" aria-label="Selection details">
              <h3>details</h3>
              {!info ? (
                <div className="files-info-empty">click a file or folder to see its info</div>
              ) : (
                <div>
                  <div className="files-info-name">
                    <span className="files-icon">{info.icon}</span>
                    <span>{info.name}</span>
                  </div>
                  <dl>
                    {info.rows.map((row) => (
                      <div key={row.k} className="files-info-row">
                        <dt>{row.k}</dt>
                        <dd>{row.v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <div className="files-places">
                <h3>Places</h3>
                {places.map((place) => (
                  <button
                    key={place.path}
                    type="button"
                    className={`files-place${place.path === cwd ? " active" : ""}`}
                    title={place.path}
                    onClick={() => void cd(place.path)}
                  >
                    <span className="files-place-name">{place.name}</span>
                    <span className="files-place-path">{placeLabel(place.path, home)}</span>
                  </button>
                ))}
              </div>
            </aside>
          </>
        )}
      </div>

      {/* status bar */}
      <div className={`files-status${statusError ? " error" : ""}`}>
        <span className="files-status-text">{status}</span>
        <span className="files-count">{countText}</span>
      </div>
    </div>
  );
}
