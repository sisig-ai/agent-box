"use client";

// Progress Bars view: shared 0-100 bars, nested children, k-v fields.
// Ported from static/js/progress/bars.js (the x-html recursive tree became
// a recursive React component; attention drives the unread shimmer).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { progressApi, type ProgressBar } from "@/lib/api";
import { barSignature } from "@/lib/attention";
import { useModal } from "@/components/modal-provider";
import { DashboardButton } from "@/components/block/dashboard-shell";
import { syncedAt } from "@/lib/format";
import "./progress.css";

const POLL_MS = 10000;

const clamp = (n: number) => Math.max(0, Math.min(100, Number(n) || 0));
const pctText = (n: number) => {
  const v = clamp(n);
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
};

interface FlatBar extends ProgressBar { _depth: number }

function flatten(list: ProgressBar[], depth = 0, out: FlatBar[] = []): FlatBar[] {
  for (const bar of list || []) {
    out.push({ ...bar, _depth: depth });
    flatten(bar.children || [], depth + 1, out);
  }
  return out;
}

function subtreeIds(bar: ProgressBar): number[] {
  return flatten([bar]).map((node) => node.id);
}

function findById(list: ProgressBar[], id: number): ProgressBar | null {
  for (const bar of list || []) {
    if (bar.id === id) return bar;
    const hit = findById(bar.children || [], id);
    if (hit) return hit;
  }
  return null;
}

/* ----- the recursive card tree ----- */

interface CardProps {
  bar: ProgressBar;
  depth: number;
  unread: Set<number>;
  onAction: (act: string, id: number) => void;
}

function BarCard({ bar, depth, unread, onAction }: CardProps) {
  const kids = bar.children || [];
  const done = clamp(bar.percent) >= 100;
  const archived = !!bar.archived_at;
  const fields = Object.entries(bar.fields || {});
  const isNew = unread.has(bar.id);

  return (
    <article
      className={`pb-card${done ? " is-done" : ""}${archived ? " is-archived" : ""}${isNew ? " attention-unread" : ""}`}
      data-id={bar.id}
    >
      <div className="pb-card-head">
        <div className="pb-heading">
          <span className="pb-name">{bar.title}</span>
          {bar.owner && <span className="pb-owner">{bar.owner}</span>}
          {done && <span className="pb-done-tag">done</span>}
          {archived && <span className="pb-archived-tag">archived</span>}
        </div>
        <div className="pb-actions">
          {!archived && (
            <>
              <button type="button" title="Add a nested bar" onClick={() => onAction("child", bar.id)}>+ child</button>
              <button type="button" title="Edit this bar" onClick={() => onAction("edit", bar.id)}>edit</button>
              <button type="button" title="Archive this bar and its nested bars" onClick={() => onAction("archive", bar.id)}>archive</button>
            </>
          )}
          {archived && (
            <button type="button" title="Restore this bar and its nested bars" onClick={() => onAction("restore", bar.id)}>restore</button>
          )}
          <button type="button" title="Delete this bar" onClick={() => onAction("delete", bar.id)}>del</button>
        </div>
      </div>
      <div className="pb-meter-row">
        <span className="pb-pct">{pctText(bar.percent)}</span>
        <span
          className="pb-meter"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamp(bar.percent)}
          aria-label={bar.title}
        >
          <i style={{ width: `${clamp(bar.percent)}%` }} />
        </span>
      </div>
      {fields.length > 0 && (
        <dl className="pb-fields">
          {fields.map(([key, value]) => (
            <div className="pb-field-pair" key={key}>
              <dt>{key}</dt>
              <dd>{value === null || value === undefined || value === "" ? "—" : String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {kids.length > 0 && (
        <div className="pb-children">
          {kids.map((kid) => (
            <BarCard key={kid.id} bar={kid} depth={depth + 1} unread={unread} onAction={onAction} />
          ))}
        </div>
      )}
    </article>
  );
}

/* ----- the edit dialog ----- */

interface BarForm { title: string; percent: string; owner: string; parent: string }

function BarDialog({ open, editingId, parentOptions, initial, initialFields, onClose, onSave }: {
  open: boolean;
  editingId: number | null;
  parentOptions: { id: number; label: string }[];
  initial: BarForm | null;
  initialFields: { key: string; value: string }[];
  onClose: () => void;
  onSave: (form: BarForm, fields: { key: string; value: string }[]) => Promise<string | null>;
}) {
  const [form, setForm] = useState<BarForm>({ title: "", percent: "", owner: "", parent: "" });
  const [fields, setFields] = useState<{ key: string; value: string }[]>([]);
  const [error, setError] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && initial) {
      setForm(initial);
      setFields(initialFields);
      setError("");
      setTimeout(() => keyRef.current?.focus(), 0);
    }
  }, [open, initial, initialFields]);

  if (!open) return null;

  return (
    <div className="pb-dialog-backdrop" onClick={onClose}>
      <div className="pb-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{editingId == null ? "new bar" : "edit bar"}</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const err = await onSave(form, fields);
            if (err) setError(err);
          }}
        >
          <label>
            title
            <input
              ref={keyRef}
              type="text"
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. 1,000-document enrichment batch"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <div className="pb-form-row">
            <label>
              percent
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                placeholder="0–100"
                value={form.percent}
                onChange={(e) => setForm({ ...form, percent: e.target.value })}
              />
            </label>
            <label>
              owner
              <input
                type="text"
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                placeholder="who is tracking this"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
              />
            </label>
          </div>
          <label>
            parent
            <select value={form.parent} onChange={(e) => setForm({ ...form, parent: e.target.value })}>
              <option value="">— none (top level) —</option>
              {parentOptions.map((node) => (
                <option key={node.id} value={String(node.id)}>{node.label}</option>
              ))}
            </select>
          </label>
          <fieldset className="pb-fieldset">
            <legend>fields — any key/value pairs shown on the card</legend>
            {fields.map((field, index) => (
              <div className="pb-field-row" key={index}>
                <input
                  type="text"
                  className="pb-field-key"
                  placeholder="field"
                  value={field.key}
                  onChange={(e) => {
                    const next = [...fields];
                    next[index] = { ...next[index], key: e.target.value };
                    setFields(next);
                  }}
                />
                <input
                  type="text"
                  className="pb-field-value"
                  placeholder="value"
                  value={field.value}
                  onChange={(e) => {
                    const next = [...fields];
                    next[index] = { ...next[index], value: e.target.value };
                    setFields(next);
                  }}
                />
                <button
                  type="button"
                  className="pb-field-del"
                  title="Remove this field"
                  onClick={() => setFields(fields.filter((_, i) => i !== index))}
                >×</button>
              </div>
            ))}
            <DashboardButton type="button" onClick={() => setFields([...fields, { key: "", value: "" }])}>
              + field
            </DashboardButton>
          </fieldset>
          {error && <p className="pb-error">{error}</p>}
          <div className="pb-dialog-actions">
            <DashboardButton type="button" variant="ghost" onClick={onClose}>cancel</DashboardButton>
            <DashboardButton type="submit">save</DashboardButton>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ----- the view ----- */

export function ProgressView({ active }: { active: boolean }) {
  const [bars, setBars] = useState<ProgressBar[]>([]);
  const [total, setTotal] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [status, setStatus] = useState("loading…");
  const [statusError, setStatusError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dialogForm, setDialogForm] = useState<BarForm | null>(null);
  const [dialogFields, setDialogFields] = useState<{ key: string; value: string }[]>([]);
  const [unread, setUnread] = useState<Set<number>>(new Set());
  const archiveArmed = useRef(false);
  const archiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openModal = useModal();

  const refresh = useCallback(async () => {
    try {
      const data = await progressApi.list(archivedOnly ? "only" : "exclude");
      setBars(data.bars || []);
      setTotal(data.count ?? flatten(data.bars || []).length);
      setArchivedCount(data.archived_count ?? 0);
      setStatus(`synced ${syncedAt()}`);
      setStatusError(false);
      // flag bars that changed since the last visit
      const flat = flatten(data.bars || []);
      const items = flat.map((bar) => ({ id: bar.id, sig: barSignature(bar) }));
      const unreadSet = archivedOnly ? new Set<number>() : new Set(
        [...unreadIdsLocal(items)].filter(Boolean),
      );
      setUnread(unreadSet);
    } catch (err) {
      setStatus(`load failed — ${(err as Error).message}`);
      setStatusError(true);
    }
  }, [archivedOnly]);

  // localStorage-backed unread tracking, scoped to this component
  const sigsRef = useRef<Map<number, string>>(new Map());
  const primedRef = useRef(false);
  const unreadIdsLocal = useCallback((items: { id: number; sig: string }[]) => {
    try {
      const raw = localStorage.getItem("macmini.attention.v1.progress");
      const prev = raw ? JSON.parse(raw) as { primed?: boolean; items?: Record<string, { s?: string }> } : null;
      if (!prev || !prev.primed) {
        // first visit: seed baseline, nothing unread
        const state = { v: 1, primed: true, seenAt: new Date().toISOString(), items: Object.fromEntries(items.map((i) => [String(i.id), { s: i.sig }])), comments: {} };
        localStorage.setItem("macmini.attention.v1.progress", JSON.stringify(state));
        primedRef.current = true;
        return [];
      }
      const out: number[] = [];
      for (const item of items) {
        const old = prev.items?.[String(item.id)];
        if (!old || old.s !== item.sig) out.push(item.id);
      }
      return out;
    } catch {
      return [];
    }
  }, []);

  // mark a bar read on interaction
  const markBarRead = useCallback((id: number, bar: ProgressBar) => {
    try {
      const raw = localStorage.getItem("macmini.attention.v1.progress");
      const prev = raw ? JSON.parse(raw) as { primed?: boolean; items?: Record<string, { s?: string }> } : { items: {} };
      const items = { ...(prev.items || {}) };
      items[String(id)] = { s: barSignature(bar) };
      localStorage.setItem("macmini.attention.v1.progress", JSON.stringify({ v: 1, primed: prev.primed ?? true, seenAt: new Date().toISOString(), items, comments: {} }));
    } catch { /* storage blocked */ }
    setUnread((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  // Esc marks everything on screen read
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (dialogOpen) return;
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      try {
        const raw = localStorage.getItem("macmini.attention.v1.progress");
        if (!raw) return;
        const prev = JSON.parse(raw) as { primed?: boolean; items?: Record<string, { s?: string }> };
        const flat = flatten(bars);
        const items = { ...(prev.items || {}) };
        for (const bar of flat) items[String(bar.id)] = { s: barSignature(bar) };
        localStorage.setItem("macmini.attention.v1.progress", JSON.stringify({ v: 1, primed: true, seenAt: new Date().toISOString(), items, comments: {} }));
      } catch { /* storage blocked */ }
      setUnread(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, bars, dialogOpen]);

  useEffect(() => {
    refresh();
    if (!active) return;
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, active]);

  const doneCount = useMemo(
    () => flatten(bars).filter((bar) => !bar.archived_at && clamp(bar.percent) >= 100).length,
    [bars],
  );

  const parentOptions = useMemo(() => {
    const edited = editingId == null ? null : findById(bars, editingId);
    const blocked = edited ? new Set(subtreeIds(edited)) : new Set<number>();
    return flatten(bars)
      .filter((node) => !blocked.has(node.id))
      .map((node) => ({ id: node.id, label: `${"· ".repeat(node._depth)}${node.title}` }));
  }, [bars, editingId]);

  const openDialog = useCallback((bar: ProgressBar | null, parentId: number | null = null) => {
    setEditingId(bar ? bar.id : null);
    setDialogForm({
      title: bar ? bar.title : "",
      percent: bar ? String(clamp(bar.percent)) : "",
      owner: (bar && bar.owner) || "",
      parent: (bar ? bar.parent_id : parentId) == null ? "" : String(bar ? bar.parent_id : parentId),
    });
    setDialogFields(Object.entries((bar && bar.fields) || {})
      .map(([key, value]) => ({ key, value: value == null ? "" : String(value) })));
    setDialogOpen(true);
  }, []);

  const saveDialog = useCallback(async (form: BarForm, fields: { key: string; value: string }[]): Promise<string | null> => {
    const title = form.title.trim();
    if (!title) return "title is required";
    const percent = form.percent === "" ? 0 : Number(form.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return "percent must be between 0 and 100";
    const fieldMap: Record<string, string> = {};
    for (const row of fields) {
      const key = (row.key || "").trim();
      if (key) fieldMap[key] = row.value;
    }
    const body = {
      title,
      percent,
      owner: form.owner.trim() || null,
      fields: fieldMap,
      parent_id: form.parent ? Number(form.parent) : null,
    };
    try {
      if (editingId != null) await progressApi.update(editingId, body);
      else await progressApi.create(body);
      setDialogOpen(false);
      await refresh();
      return null;
    } catch (err) {
      return `save failed — ${(err as Error).message}`;
    }
  }, [editingId, refresh]);

  const onAction = useCallback(async (act: string, id: number) => {
    const bar = findById(bars, id);
    if (!bar) return;
    markBarRead(id, bar);
    if (act === "edit") openDialog(bar);
    else if (act === "child") openDialog(null, id);
    else if (act === "archive" || act === "restore") {
      const archived = act === "archive";
      const count = flatten([bar]).length;
      try {
        await progressApi.update(id, { archived });
        await refresh();
        setStatus(
          archived
            ? `archived “${bar.title}”${count > 1 ? ` and ${count - 1} nested bar${count === 2 ? "" : "s"}` : ""}`
            : `restored “${bar.title}”${count > 1 ? ` and ${count - 1} nested bar${count === 2 ? "" : "s"}` : ""}`,
        );
      } catch (err) {
        setStatus(`${archived ? "archive" : "restore"} failed — ${(err as Error).message}`);
      }
    } else if (act === "delete") {
      const kids = flatten(bar.children || []).length;
      const ok = await openModal({
        title: "delete progress bar",
        text: kids
          ? `“${bar.title}” and its ${kids} nested bar${kids === 1 ? "" : "s"} will be deleted.`
          : `“${bar.title}” will be deleted.`,
        ok: "delete",
        danger: true,
      });
      if (!ok) return;
      try {
        await progressApi.remove(id, kids > 0);
        await refresh();
      } catch (err) {
        setStatus(`delete failed — ${(err as Error).message}`);
      }
    }
  }, [bars, markBarRead, openDialog, openModal, refresh]);

  const archiveDone = useCallback(async () => {
    if (doneCount === 0) return;
    if (!archiveArmed.current) {
      archiveArmed.current = true;
      if (archiveTimer.current) clearTimeout(archiveTimer.current);
      archiveTimer.current = setTimeout(() => { archiveArmed.current = false; }, 3000);
      return;
    }
    if (archiveTimer.current) clearTimeout(archiveTimer.current);
    archiveArmed.current = false;
    try {
      const data = await progressApi.archiveDone();
      await refresh();
      const n = data.archived || 0;
      setStatus(n ? `archived ${n} bar${n === 1 ? "" : "s"}` : "nothing at 100% to archive");
    } catch (err) {
      setStatus(`archive failed — ${(err as Error).message}`);
    }
  }, [doneCount, refresh]);

  const countText = archivedOnly
    ? `${bars.length} archived top-level · ${total} bar${total === 1 ? "" : "s"} · restore to bring them back`
    : `${bars.length} top-level · ${total} bar${total === 1 ? "" : "s"}`
      + (archivedCount ? ` · ${archivedCount} archived` : "")
      + " · shared with agents";

  return (
    <section className="progress" aria-label="Progress Bars">
      <div className="progress-head">
        <div className="progress-title">
          <h2>Progress Bars</h2>
          <span className="progress-sub">
            shared tracking for humans and agents · nested bars · k-v fields · <code>/api/progress</code>
          </span>
        </div>
        <div className="progress-actions">
          <DashboardButton
            onClick={archiveDone}
            disabled={doneCount === 0 || archivedOnly}
            title={doneCount === 0 ? "No bar is at 100% yet" : `Archive all ${doneCount} finished bar(s) and their children (click twice)`}
          >
            {archiveArmed.current ? `archive ${doneCount}?` : "archive done"}
          </DashboardButton>
          <DashboardButton
            onClick={() => { setArchivedOnly(!archivedOnly); }}
            title={archivedOnly ? "Back to live bars" : "Show archived bars"}
          >
            {archivedCount ? `archived ${archivedCount}` : "archived"}
          </DashboardButton>
          <DashboardButton onClick={() => openDialog(null)} title="Add a top-level progress bar">
            + bar
          </DashboardButton>
          <DashboardButton onClick={() => refresh()} title="Reload every bar">⟳ refresh</DashboardButton>
        </div>
      </div>
      <div className="progress-grid" id="progress-grid">
        {bars.length === 0 ? (
          <p className="pb-empty">
            {archivedOnly ? "// no archived progress bars" : "// no progress bars yet — [+ bar] to start one"}
          </p>
        ) : (
          bars.map((bar) => (
            <BarCard key={bar.id} bar={bar} depth={0} unread={unread} onAction={onAction} />
          ))
        )}
      </div>
      <div className="progress-status">
        <span className={statusError ? "err" : ""}>{status}</span>
        <span>{countText}</span>
      </div>
      <BarDialog
        open={dialogOpen}
        editingId={editingId}
        parentOptions={parentOptions}
        initial={dialogForm}
        initialFields={dialogFields}
        onClose={() => setDialogOpen(false)}
        onSave={saveDialog}
      />
    </section>
  );
}
