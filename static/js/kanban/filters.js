// Stackable board filters: one list of conditions joined by AND, with the
// values inside a condition joined by OR, the way Linear and ClickUp read them.
// Conditions live in localStorage as [{field, negate, values}] so a reload puts
// the same narrowing back.
//
// The pure half (matches, describe, setOpFilter) has no DOM access so the node
// suite can test it directly.

export const FIELDS = [
  { id: 'lane', label: 'Lane' },
  { id: 'author', label: 'Author' },
  { id: 'op', label: 'Op' },
  { id: 'updated', label: 'Updated' },
];

const KEY = 'opsboard.filters';
const LEGACY = { op: 'opsboard.opname', author: 'opsboard.owner', updated: 'opsboard.updated', lane: 'opsboard.lane' };
export const NONE = '__none__'; // value meaning "has no author" / "has no op"
const UPDATED_PRESETS = [
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

// The four single-value selects predate this list; fold them in once so a
// saved narrowing is not lost on deploy.
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
  const d = new Date(now.getTime() - n * 86400000);
  return dayOf(d);
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

// ---- UI ------------------------------------------------------------------

let editor = null; // { stage: 'field'|'values', index: number|null, field, values, negate }
let current = null; // last paint ctx, so document listeners can repaint

function closeEditor() {
  if (!editor) return;
  editor = null;
  if (current) paintFilters(current);
}

function openFieldPicker() {
  editor = { stage: 'field', index: null, field: 'lane', values: [], negate: false };
}

function openValues(ctx, condition, index) {
  editor = { stage: 'values', index, field: condition.field, values: [...condition.values], negate: !!condition.negate };
  paintFilters(ctx);
}

// Values are the ones on the board right now, so a filter never offers a lane
// or agent with nothing to show. A saved value that vanished stays listed and
// removable.
function fieldValues(ctx, field) {
  const seen = new Map();
  const add = (v) => { if (v && !seen.has(norm(v))) seen.set(norm(v), v); };
  if (field === 'lane') {
    const rows = ctx.lanes.map((lane) => [String(lane.id), lane.name]);
    const known = new Set(rows.map(([id]) => id));
    for (const value of editor?.values || []) if (!known.has(value)) rows.push([value, value]);
    return rows;
  }
  if (field === 'author') {
    ctx.cards.forEach((c) => add(c.owner));
    const rows = [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((v) => [v, `@${v}`]);
    return [...rows, [NONE, '— unassigned —']];
  }
  ctx.cards.forEach((c) => add(c.opname));
  const ops = [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((v) => [v, v]);
  return [...ops, [NONE, '— no op —']];
}

function commit(ctx, values, negate) {
  const list = ctx.state.filters.map((c) => ({ ...c, values: [...c.values] }));
  const draft = editor;
  if (draft.index == null) {
    if (!values.length) { editor = { ...draft, values, negate }; return; }
    list.push({ field: draft.field, negate, values });
    editor = { ...draft, index: list.length - 1, values, negate };
  } else if (values.length) {
    list[draft.index] = { field: draft.field, negate, values };
    editor = { ...draft, values, negate };
  } else {
    list.splice(draft.index, 1);
    editor = { ...draft, index: null, values, negate };
  }
  ctx.onChange(list);
}

function chip(el, condition, index, ctx) {
  const node = el('button', 'kb-chip');
  node.type = 'button';
  node.title = 'Edit this filter';
  node.append(
    el('span', 'kb-chip-field', FIELDS.find((f) => f.id === condition.field)?.label.toLowerCase()),
    el('span', 'kb-chip-op', condition.negate ? 'is not' : 'is'),
    el('span', 'kb-chip-value', condition.values.map((v) => valueLabel(condition, v, ctx)).join(', ')),
  );
  const x = el('span', 'kb-chip-x', '×');
  x.title = 'Remove this filter';
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = ctx.state.filters.filter((_, i) => i !== index);
    editor = null;
    ctx.onChange(list);
  });
  node.append(x);
  node.addEventListener('click', (e) => { e.stopPropagation(); openValues(ctx, condition, index); });
  return node;
}

function fieldMenu(el, ctx) {
  const box = el('div', 'kb-fm');
  box.append(el('div', 'kb-fm-title', 'Filter by'));
  for (const field of FIELDS) {
    const btn = el('button', 'kb-fm-field', field.label);
    btn.type = 'button';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editor = { stage: 'values', index: null, field: field.id, values: [], negate: false };
      paintFilters(ctx);
    });
    box.append(btn);
  }
  return box;
}

function valueMenu(el, ctx) {
  const box = el('div', 'kb-fm');
  const head = el('div', 'kb-fm-head');
  const field = FIELDS.find((f) => f.id === editor.field)?.label.toLowerCase();
  head.append(el('span', 'kb-fm-title', field));
  const neg = el('button', 'kb-fm-neg', editor.negate ? 'is not' : 'is');
  neg.type = 'button';
  neg.title = 'Flip between "is" and "is not"';
  neg.addEventListener('click', (e) => {
    e.stopPropagation();
    editor = { ...editor, negate: !editor.negate };
    if (editor.index == null && !editor.values.length) { paintFilters(ctx); return; }
    commit(ctx, editor.values, editor.negate);
  });
  head.append(neg);
  box.append(head);

  if (editor.field === 'updated') {
    box.append(updatedMenu(el, ctx));
    return box;
  }

  const list = el('div', 'kb-fm-list');
  const rows = fieldValues(ctx, editor.field);
  for (const [value, label] of rows) {
    const row = el('label', 'kb-fm-opt');
    const box2 = el('input');
    box2.type = 'checkbox';
    box2.value = value;
    box2.checked = editor.values.includes(value);
    box2.addEventListener('change', () => {
      const values = box2.checked
        ? [...editor.values, value]
        : editor.values.filter((v) => v !== value);
      commit(ctx, values, editor.negate);
    });
    row.append(box2, el('span', '', label));
    list.append(row);
  }
  box.append(list);
  return box;
}

function updatedMenu(el, ctx) {
  const list = el('div', 'kb-fm-list');
  const pick = (value) => {
    editor = { ...editor, values: [value] };
    commit(ctx, [value], editor.negate);
  };
  for (const [value, label] of UPDATED_PRESETS) {
    const row = el('label', 'kb-fm-opt');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'kb-fm-updated';
    radio.checked = editor.values[0] === value;
    radio.addEventListener('change', () => pick(value));
    row.append(radio, el('span', '', label));
    list.append(row);
  }
  const onRow = el('div', 'kb-fm-date');
  const date = el('input');
  date.type = 'date';
  date.value = (editor.values[0] || '').startsWith('on:') ? editor.values[0].slice(3) : '';
  const apply = el('button', 'kb-fm-apply', 'on');
  apply.type = 'button';
  apply.addEventListener('click', (e) => {
    e.stopPropagation();
    if (date.value) pick(`on:${date.value}`);
  });
  onRow.append(el('span', 'kb-fm-title', 'on'), date, apply);
  list.append(onRow);
  return list;
}

function paintOpDatalist(el, ctx, $) {
  let list = $('kb-opname-list');
  if (!list) { list = el('datalist'); list.id = 'kb-opname-list'; document.body.append(list); }
  const seen = new Map();
  for (const c of ctx.cards) if (c.opname && !seen.has(norm(c.opname))) seen.set(norm(c.opname), c.opname);
  list.replaceChildren(...[...seen.values()].map((o) => { const n = el('option'); n.value = o; return n; }));
}

export function paintFilters(ctx) {
  const { el, $, state } = ctx;
  current = ctx;
  let bar = $('kanban-filters');
  if (!bar) {
    bar = el('div', 'kb-filters');
    bar.id = 'kanban-filters';
    // Clicks inside the bar belong to the bar: the document handler below
    // closes the editor only for a click somewhere else.
    bar.addEventListener('click', (e) => e.stopPropagation());
    $('kanban-add-lane').before(bar);
  }
  paintOpDatalist(el, ctx, $);
  const nodes = state.filters.map((cond, i) => chip(el, cond, i, ctx));
  const add = el('button', 'kb-filter-add', '+ filter');
  add.type = 'button';
  add.title = 'Add a filter condition; conditions must all match';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    if (editor) { closeEditor(); return; }
    openFieldPicker();
    paintFilters(ctx);
  });
  nodes.push(add);
  if (editor) nodes.push(editor.stage === 'field' ? fieldMenu(el, ctx) : valueMenu(el, ctx));
  bar.replaceChildren(...nodes);
  bar.classList.toggle('active', !!state.filters.length);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', () => closeEditor());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEditor(); });
}
