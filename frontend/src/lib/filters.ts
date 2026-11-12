"use client";

// Board filters: stackable conditions joined by AND, values within a
// condition joined by OR. Ported from static/js/kanban/filters.js.

export const FIELDS = [
  { id: "lane", label: "Lane" },
  { id: "author", label: "Author" },
  { id: "op", label: "Op" },
  { id: "updated", label: "Updated" },
] as const;

const KEY = "opsboard.filters";
export const NONE = "__none__";
export const UPDATED_PRESETS: [string, string][] = [
  ["today", "today"],
  ["last:7", "in the last 7 days"],
  ["last:30", "in the last 30 days"],
];

const norm = (v: string | null | undefined) => (v || "").trim().toLowerCase();

export interface Condition { field: string; negate: boolean; values: string[] }

function cleanCondition(raw: unknown): Condition | null {
  if (!raw || typeof raw !== "object") return null;
  const field = String((raw as Condition).field || "");
  if (!FIELDS.some((f) => f.id === field)) return null;
  const values = Array.isArray((raw as Condition).values)
    ? (raw as Condition).values.filter((v) => v !== "" && v != null).map(String)
    : [];
  if (!values.length) return null;
  return { field, negate: !!(raw as Condition).negate, values: field === "updated" ? values.slice(0, 1) : values };
}

function cleanList(raw: unknown): Condition[] {
  return Array.isArray(raw) ? raw.map(cleanCondition).filter(Boolean) as Condition[] : [];
}

export function loadFilters(): Condition[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return cleanList(JSON.parse(raw));
  } catch { return []; }
  return [];
}

export function saveFilters(list: Condition[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
}

/* ---- matching ---- */

export function dayOf(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgo(n: number, now: Date): string {
  return dayOf(new Date(now.getTime() - n * 86400000));
}

function updatedMatches(value: string, iso: string, now: Date): boolean {
  const day = dayOf(iso);
  if (!day) return false;
  if (value === "today") return day === dayOf(now);
  const [kind, arg] = value.includes(":") ? value.split(":") : [value, ""];
  if (kind === "last") return day >= daysAgo(Number(arg) || 7, now) && day <= dayOf(now);
  if (kind === "on") return day === arg;
  if (kind === "before") return day < arg;
  if (kind === "after") return day > arg;
  return true;
}

export interface FilterCard { owner?: string | null; opname?: string | null; updated_at: string }

function valueMatches(field: string, value: string, card: FilterCard, laneOf: (c: FilterCard) => number | string, now: Date): boolean {
  if (field === "lane") return String(laneOf(card)) === String(value);
  if (field === "author") return value === NONE ? !card.owner : norm(card.owner) === norm(value);
  if (field === "op") return value === NONE ? !card.opname : norm(card.opname) === norm(value);
  if (field === "updated") return updatedMatches(value, card.updated_at, now);
  return true;
}

export function matches(
  filters: Condition[], card: FilterCard,
  laneOf: (c: FilterCard) => number | string, now = new Date(),
): boolean {
  return filters.every((cond) => {
    const hit = cond.values.some((value) => valueMatches(cond.field, value, card, laneOf, now));
    return cond.negate ? !hit : hit;
  });
}

/* ---- labels ---- */

export function valueLabel(condition: Condition, value: string, ctx: { laneNames?: Record<number, string> } = {}): string {
  if (condition.field === "lane") return ctx.laneNames?.[Number(value)] || value;
  if (value === NONE) return condition.field === "author" ? "unassigned" : "no op";
  if (condition.field === "author") return `@${value}`;
  if (condition.field === "updated") {
    const preset = UPDATED_PRESETS.find(([id]) => id === value);
    if (preset) return preset[1];
    const [kind, arg] = value.includes(":") ? value.split(":") : [value, ""];
    if (kind === "on") return `on ${arg}`;
    if (kind === "before") return `before ${arg}`;
    if (kind === "after") return `after ${arg}`;
    return value;
  }
  return value;
}

// Values on the board right now, so the menu never offers an empty lane.
export function fieldValues(
  field: string,
  ctx: { lanes?: { id: number; name: string }[]; cards?: { owner?: string | null; opname?: string | null }[] },
  selected: string[] = [],
): [string, string][] {
  const seen = new Map<string, string>();
  const add = (v: string) => { if (v && !seen.has(norm(v))) seen.set(norm(v), v); };
  if (field === "lane") {
    const rows = (ctx.lanes || []).map((lane) => [String(lane.id), lane.name] as [string, string]);
    const known = new Set(rows.map(([id]) => id));
    for (const value of selected) if (!known.has(value)) rows.push([value, value]);
    return rows;
  }
  if (field === "author") {
    (ctx.cards || []).forEach((c) => add(c.owner || ""));
    const rows = [...seen.values()]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((v) => [v, `@${v}`] as [string, string]);
    return [...rows, [NONE, "— unassigned —"]];
  }
  (ctx.cards || []).forEach((c) => add(c.opname || ""));
  const rows = [...seen.values()]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((v) => [v, v] as [string, string]);
  return [...rows, [NONE, "— no op —"]];
}

export function activeOp(filters: Condition[]): string {
  const cond = filters.find((c) => c.field === "op" && !c.negate && c.values.length === 1);
  return cond && cond.values[0] !== NONE ? cond.values[0] : "";
}

export function hasOp(filters: Condition[], opname: string): boolean {
  return norm(activeOp(filters)) === norm(opname);
}

export function setOpFilter(filters: Condition[], opname: string): Condition[] {
  const rest = filters.filter((c) => c.field !== "op");
  return opname ? [...rest, { field: "op", negate: false, values: [opname] }] : rest;
}
