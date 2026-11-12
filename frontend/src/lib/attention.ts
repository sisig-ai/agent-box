"use client";

// Attention system: tracks which cards/bars changed since the last visit
// (localStorage, keyed by signature) and flags them as unread so the UI can
// shimmer them. Ported from static/js/attention.js with the same semantics,
// minus the pixel-burst fx (React state drives a CSS shimmer instead).

const PREFIX = "macmini.attention.v1.";

interface ItemState { s?: string; l?: number }
interface ViewState {
  v: number; primed: boolean; seenAt: string | null;
  items: Record<string, ItemState>; comments: Record<string, number>;
}

function read(key: string): ViewState | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) return JSON.parse(raw) as ViewState;
  } catch { /* storage blocked */ }
  return null;
}

function write(key: string, state: ViewState) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(state)); } catch { /* storage blocked */ }
}

export interface AttentionItem { id: number; sig: string; lane?: number }

// Card signature: every field whose change should count as "new".
export function cardSignature(card: Record<string, unknown>): string {
  const tasks = card.body_tasks as { done: number; total: number } | null | undefined;
  return [
    card.updated_at, card.title, card.owner, card.opname, card.archived_at,
    card.comment_count || 0, card.body_preview || "",
    tasks ? `${tasks.done}/${tasks.total}` : "",
  ].join("|");
}

export function barSignature(bar: { updated_at: string; title: string; percent: number; owner: string | null; archived_at: string | null; fields: Record<string, unknown> }): string {
  return [bar.updated_at, bar.title, bar.percent, bar.owner, bar.archived_at, JSON.stringify(bar.fields || {})].join("|");
}

// ids whose stored signature does not match: they stay "unread" until read.
export function unreadIds(key: string, entries: AttentionItem[]): Set<number> {
  const prev = read(key);
  if (!prev || !prev.primed) return new Set();
  const out = new Set<number>();
  for (const entry of entries) {
    const old = prev.items?.[String(entry.id)];
    if (!old || old.s !== entry.sig) out.add(entry.id);
  }
  return out;
}

// First visit seeds the baseline so nothing shimmers on load.
export function visit(key: string, entries: AttentionItem[], allIds?: number[]): void {
  const prev = read(key);
  const baseline = !prev || !prev.primed;
  const state: ViewState = {
    v: 1,
    primed: true,
    seenAt: new Date().toISOString(),
    items: baseline ? {} : { ...(prev?.items || {}) },
    comments: { ...(prev?.comments || {}) },
  };
  for (const entry of entries) {
    const rec = state.items[String(entry.id)] || (state.items[String(entry.id)] = {});
    rec.s = entry.sig;
    if (entry.lane != null) rec.l = entry.lane;
  }
  if (allIds) {
    const keep = new Set(allIds.map(String));
    for (const id of Object.keys(state.items)) if (!keep.has(id)) delete state.items[id];
    for (const id of Object.keys(state.comments)) if (!keep.has(id)) delete state.comments[id];
  }
  write(key, state);
}

export function markRead(key: string, id: number, sig: string, lane?: number): void {
  const prev = read(key) || { v: 1, primed: false, seenAt: null, items: {}, comments: {} };
  const state: ViewState = {
    v: 1,
    primed: prev.primed,
    seenAt: new Date().toISOString(),
    items: { ...(prev.items || {}) },
    comments: { ...(prev.comments || {}) },
  };
  state.items[String(id)] = { s: sig, ...(lane != null ? { l: lane } : {}) };
  write(key, state);
}

// Comments newer than the last read for this card; advances the watermark.
export function newComments(key: string, cardId: number, comments: { id: number }[]): number[] {
  const prev = read(key) || { v: 1, primed: false, seenAt: null, items: {}, comments: {} };
  const state: ViewState = {
    v: 1,
    primed: prev.primed,
    seenAt: prev.seenAt,
    items: { ...(prev.items || {}) },
    comments: { ...(prev.comments || {}) },
  };
  const ids = comments.map((c) => Number(c.id)).filter((id) => Number.isFinite(id));
  const max = ids.length ? Math.max(...ids) : null;
  const last = state.comments[String(cardId)];
  if (last == null) {
    if (max != null) state.comments[String(cardId)] = max;
    write(key, state);
    return [];
  }
  const unseen = comments.filter((c) => c.id > last).map((c) => c.id);
  if (max != null) state.comments[String(cardId)] = max;
  write(key, state);
  return unseen;
}

// Esc: everything on screen becomes read.
export function markAllRead(key: string, entries: AttentionItem[]): number {
  const prev = read(key);
  if (!prev) return 0;
  let cleared = 0;
  const state: ViewState = {
    v: 1,
    primed: prev.primed,
    seenAt: new Date().toISOString(),
    items: { ...(prev.items || {}) },
    comments: { ...(prev.comments || {}) },
  };
  for (const entry of entries) {
    const rec = state.items[String(entry.id)] || (state.items[String(entry.id)] = {});
    if (rec.s !== entry.sig) cleared += 1;
    rec.s = entry.sig;
    if (entry.lane != null) rec.l = entry.lane;
  }
  write(key, state);
  return cleared;
}
