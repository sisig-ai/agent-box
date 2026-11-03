// Stackable board filters: one list of conditions joined by AND, with the
// values inside a condition joined by OR. Pure logic only: the component
// renders the chips and the menu from these helpers.

export const FIELDS = [
  { id: 'lane', label: 'Lane' },
  { id: 'author', label: 'Author' },
  { id: 'op', label: 'Op' },
  { id: 'updated', label: 'Updated' },
];

const KEY = 'opsboard.filters';
const LEGACY = { op: 'opsboard.opname', author: 'opsboard.owner', updated: 'opsboard.updated', lane: 'opsboard.lane' };
export const NONE = '__none__'; // value meaning "has no author" / "has no op"
export const UPDATED_PRESETS = [
  ['today', 'today'],
  ['last:7', 'in the last 7 days'],
  ['last:30', 'in the last 30 days'],
];

const norm = (v) => (v || '').trim().toLowerCase();

// ---- model ---------------------------------------------------------------

function cleanCondition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const field = String(raw.field || '');
  if (!FIELDS.some((f) => f.id === field)) return null;
  const values = Array.isArray(raw.values) ? raw.values.filter((v) => v !== '' && v != null).map(String) : [];
  if (!values.length) return null;
  return { field, negate: !!raw.negate, values: field === 'updated' ? values.slice(0, 1) : values };
}

function cleanList(raw) {
  return Array.isArray(raw) ? raw.map(cleanCondition).filter(Boolean) : [];
}

// The four single-value selects predate this list; fold them in once.
function migrateLegacy() {
  const out = [];
  for (const [field, key] of Object.entries(LEGACY)) {
    let value = '';
    try { value = localStorage.getItem(key) || ''; } catch { return out; }
    if (value) out.push({ field, negate: false, values: [value] });
  }
  return out;
}

export function loadFilters() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return cleanList(JSON.parse(raw));
  } catch { return []; }
  const migrated = cleanList(migrateLegacy());
  saveFilters(migrated);
  return migrated;
}

export function saveFilters(list) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
}

// ---- matching ------------------------------------------------------------

export function dayOf(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(n, now) {
  return dayOf(new Date(now.getTime() - n * 86400000));
}

// 'today' | 'last:7' | 'last:30' | 'on:YYYY-MM-DD' | 'before:…' | 'after:…'
function updatedMatches(value, iso, now) {
  const day = dayOf(iso);
  if (!day) return false;
  if (value === 'today') return day === dayOf(now);
  const [kind, arg] = value.includes(':') ? value.split(':') : [value, ''];
  if (kind === 'last') return day >= daysAgo(Number(arg) || 7, now) && day <= dayOf(now);
  if (kind === 'on') return day === arg;
  if (kind === 'before') return day < arg;
  if (kind === 'after') return day > arg;
  return true;
}

function valueMatches(field, value, card, laneOf, now) {
  if (field === 'lane') return String(laneOf(card)) === String(value);
  if (field === 'author') return value === NONE ? !card.owner : norm(card.owner) === norm(value);
  if (field === 'op') return value === NONE ? !card.opname : norm(card.opname) === norm(value);
  if (field === 'updated') return updatedMatches(value, card.updated_at, now);
  return true;
}

// `laneOf(card)` reports the lane the board renders the card in, so archived
// cards answer to Done. `now` is injectable for tests.
export function matches(filters, card, laneOf, now = new Date()) {
  return filters.every((cond) => {
    const hit = cond.values.some((value) => valueMatches(cond.field, value, card, laneOf, now));
    return cond.negate ? !hit : hit;
  });
}

// ---- labels --------------------------------------------------------------

export function valueLabel(condition, value, ctx = {}) {
  if (condition.field === 'lane') return ctx.laneNames?.[value] || value;
  if (value === NONE) return condition.field === 'author' ? 'unassigned' : 'no op';
  if (condition.field === 'author') return `@${value}`;
  if (condition.field === 'updated') {
    const preset = UPDATED_PRESETS.find(([id]) => id === value);
    if (preset) return preset[1];
    const [kind, arg] = value.includes(':') ? value.split(':') : [value, ''];
    if (kind === 'on') return `on ${arg}`;
    if (kind === 'before') return `before ${arg}`;
    if (kind === 'after') return `after ${arg}`;
    return value;
  }
  return value;
}

export function describe(condition, ctx) {
  const field = FIELDS.find((f) => f.id === condition.field)?.label.toLowerCase() || condition.field;
  const values = condition.values.map((v) => valueLabel(condition, v, ctx));
  return `${field} ${condition.negate ? 'is not' : 'is'} ${values.join(', ')}`;
}

// Values on the board right now, so the menu never offers an empty lane or a
// name with nothing to show. Saved values that vanished stay listed.
export function fieldValues(field, ctx = {}, selected = []) {
  const seen = new Map();
  const add = (v) => { if (v && !seen.has(norm(v))) seen.set(norm(v), v); };
  if (field === 'lane') {
    const rows = (ctx.lanes || []).map((lane) => [String(lane.id), lane.name]);
    const known = new Set(rows.map(([id]) => id));
    for (const value of selected) if (!known.has(value)) rows.push([value, value]);
    return rows;
  }
  if (field === 'author') {
    (ctx.cards || []).forEach((c) => add(c.owner));
    const rows = [...seen.values()]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((v) => [v, `@${v}`]);
    return [...rows, [NONE, '— unassigned —']];
  }
  (ctx.cards || []).forEach((c) => add(c.opname));
  const rows = [...seen.values()]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((v) => [v, v]);
  return [...rows, [NONE, '— no op —']];
}

export function activeOp(filters) {
  const cond = filters.find((c) => c.field === 'op' && !c.negate && c.values.length === 1);
  return cond && cond.values[0] !== NONE ? cond.values[0] : '';
}

export function hasOp(filters, opname) {
  return norm(activeOp(filters)) === norm(opname);
}

// Toggling an op chip replaces the op condition: one narrowing, not a pile.
export function setOpFilter(filters, opname) {
  const rest = filters.filter((c) => c.field !== 'op');
  return opname ? [...rest, { field: 'op', negate: false, values: [opname] }] : rest;
}
