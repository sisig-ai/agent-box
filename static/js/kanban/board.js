// Ops Board tab (internal id: kanban): lanes as columns, cards with inline edit, HTML5 drag and drop,
// and a 3s poll (only while the tab is visible and nobody is mid-edit/drag) so
// changes agents make through /api/opsboard show up on their own. Clicking a
// card opens the detail modal (detail.js); #/kanban/card-<id> deep-links it.
// Cards may carry an `opname` (operation name): shown as a chip; the header
// "op" filter (or clicking a chip) narrows the board to one operation.
import { api } from './api.js?v=owner1';
import { inlineEdit, armDelete } from './edit.js?v=kanban20';
import { closeCard, openCard, openId, setupDetail, syncFromBoard } from './detail.js?v=docs4';
import * as search from './search.js?v=owner1';
import * as attention from '../attention.js?v=attention7';
import { createGrouping } from './group.js?v=docs4';
import { appendDocRefs } from './docrefs.js?v=docs4';
import { laneMatch, paintLaneFilter, restoreLane, storeLane } from './lanefilter.js?v=lanefilter1';
import { paintUpdatedFilter, updatedLabel, updatedMatch } from './updatedfilter.js?v=updatedfilter1';

const POLL_MS = 3000;
const $ = (id) => document.getElementById(id);
const GROUP_KEY = 'opsboard.group';
const OP_KEY = 'opsboard.opname';
const OWNER_KEY = 'opsboard.owner';
const UPDATED_KEY = 'opsboard.updated'; // '' | 'today' | 'YYYY-MM-DD'
const NO_OP = '__none__'; // filter value for cards without an opname
const NO_OWNER = '__none__'; // filter value for cards without an owner
const state = { data: null, archived: null, archivedLoad: null, sig: '', searchSig: '', searchQ: '', busy: 0, dragId: null, dragEnd: 0, started: false, op: '', owner: '', updated: '', lane: '', group: 'lane', laneNames: {} };
let attentionPending = false;
let unreadCards = new Set();
try { state.op = localStorage.getItem(OP_KEY) || ''; } catch { /* storage blocked */ }
try { state.owner = localStorage.getItem(OWNER_KEY) || ''; } catch { /* storage blocked */ }
try { state.updated = localStorage.getItem(UPDATED_KEY) || ''; } catch { /* storage blocked */ }
state.lane = restoreLane();
try { state.group = localStorage.getItem(GROUP_KEY) === 'owner' ? 'owner' : 'lane'; } catch { /* storage blocked */ }
const opKey = (v) => (v || '').trim().toLowerCase();

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function setStatus(msg, isError) {
  const s = $('kanban-status');
  s.textContent = msg;
  s.classList.toggle('err', !!isError);
}

// Esc marked the board read: say so before the next 3s sync overwrites it.
document.addEventListener('attention:dismissed', (e) => {
  if (document.body.dataset.view !== 'kanban') return;
  const n = e.detail?.count || 0;
  setStatus(n ? `marked ${n} card${n === 1 ? '' : 's'} read` : 'all caught up');
});

export async function refresh(force) {
  if (state.busy && !force) return;
  try {
    const data = await api.board();
    const sig = JSON.stringify(data);
    state.data = data;
    if (force) state.archived = null;
    if (search.active()) {
      await ensureArchived();
      await search.refresh();
    } else {
      state.archived = null;
    }
    const searchSig = search.sig();
    const changed = sig !== state.sig || searchSig !== state.searchSig || force;
    state.sig = sig;
    state.searchSig = searchSig;
    if (changed) render();
    syncFromBoard(state.archived ? data.cards.concat(state.archived) : data.cards);
    setStatus(`synced ${new Date().toLocaleTimeString([], { hour12: false })}`);
  } catch (e) {
    setStatus(`sync failed: ${e.message}`, true);
  }
}

// Archived cards are not in the board payload; fetch them once per search and
// keep the batch until a mutation (force refresh) or the query is cleared.
async function ensureArchived() {
  if (!search.active()) { state.archived = null; return; }
  if (state.archived) return;
  if (!state.archivedLoad) {
    state.archivedLoad = api.archived()
      .then((rows) => { state.archived = rows; })
      .catch(() => { state.archived = []; })
      .finally(() => { state.archivedLoad = null; });
  }
  await state.archivedLoad;
}

async function mutate(fn) {
  try { await fn(); } catch (e) { setStatus(e.message, true); }
  await refresh(true);
}

// Distinct opnames on the board (first spelling wins), alphabetical.
function boardOps(cards) {
  const seen = new Map();
  for (const c of cards) if (c.opname && !seen.has(opKey(c.opname))) seen.set(opKey(c.opname), c.opname);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function setOp(op) {
  state.op = op || '';
  try { if (state.op) localStorage.setItem(OP_KEY, state.op); else localStorage.removeItem(OP_KEY); } catch { /* ignore */ }
  if (state.data) render();
}

function setOwner(owner) {
  state.owner = owner || '';
  try { if (state.owner) localStorage.setItem(OWNER_KEY, state.owner); else localStorage.removeItem(OWNER_KEY); } catch { /* ignore */ }
  if (state.data) render();
}

function setLane(lane) {
  state.lane = lane ? String(lane) : '';
  storeLane(state.lane);
  if (state.data) render();
}

function setUpdated(value) {
  state.updated = value || '';
  try { if (state.updated) localStorage.setItem(UPDATED_KEY, state.updated); else localStorage.removeItem(UPDATED_KEY); } catch { /* ignore */ }
  if (state.data) render();
}

function boardOwners(cards) {
  const seen = new Map();
  for (const c of cards) if (c.owner && !seen.has(opKey(c.owner))) seen.set(opKey(c.owner), c.owner);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// Header "Author" filter: All authors / each card owner / (unassigned).
function paintOwnerFilter(cards) {
  let sel = $('kanban-owner');
  if (!sel) {
    const wrap = el('label', 'kb-op-filter kb-owner-filter');
    wrap.title = 'Filter the board by author (card owner)';
    wrap.append(el('span', 'kb-op-filter-lbl', 'Author'));
    sel = el('select');
    sel.id = 'kanban-owner';
    sel.addEventListener('change', () => setOwner(sel.value));
    wrap.append(sel);
    $('kanban-add-lane').before(wrap);
  }
  const owners = boardOwners(cards);
  if (document.activeElement === sel) return; // never rebuild an open dropdown
  if (state.owner && state.owner !== NO_OWNER && !owners.some((o) => opKey(o) === opKey(state.owner))) owners.push(state.owner);
  const opts = [['', 'All authors'], ...owners.map((o) => [o, o]), [NO_OWNER, '— unassigned —']];
  sel.replaceChildren(...opts.map(([v, label]) => {
    const o = el('option', '', label);
    o.value = v;
    o.selected = v === NO_OWNER ? state.owner === v : opKey(v) === opKey(state.owner);
    return o;
  }));
  sel.classList.toggle('active', !!state.owner);
}

function opMatch(card) {
  if (!state.op) return true;
  if (state.op === NO_OP) return !card.opname;
  return opKey(card.opname) === opKey(state.op);
}

function ownerMatch(card) {
  if (!state.owner) return true;
  if (state.owner === NO_OWNER) return !card.owner;
  return opKey(card.owner) === opKey(state.owner);
}

// Header "op" filter: All ops / each opname / (no op). Built in JS so index.html stays untouched.
function paintOpFilter(cards) {
  let sel = $('kanban-opname');
  if (!sel) {
    const wrap = el('label', 'kb-op-filter');
    wrap.title = 'Filter the board by operation (opname)';
    wrap.append(el('span', 'kb-op-filter-lbl', 'Op'));
    sel = el('select');
    sel.id = 'kanban-opname';
    sel.addEventListener('change', () => setOp(sel.value));
    wrap.append(sel);
    $('kanban-refresh').before(wrap);
  }
  const ops = boardOps(cards);
  if (document.activeElement === sel) return; // never rebuild an open dropdown
  if (state.op && state.op !== NO_OP && !ops.some((o) => opKey(o) === opKey(state.op))) ops.push(state.op);
  const opts = [['', 'All ops'], ...ops.map((o) => [o, o]), [NO_OP, '— no op —']];
  sel.replaceChildren(...opts.map(([v, label]) => {
    const o = el('option', '', label);
    o.value = v;
    o.selected = v === NO_OP ? state.op === v : opKey(v) === opKey(state.op);
    return o;
  }));
  sel.classList.toggle('active', !!state.op);
  let list = $('kb-opname-list');
  if (!list) { list = el('datalist'); list.id = 'kb-opname-list'; document.body.append(list); }
  list.replaceChildren(...boardOps(cards).map((o) => { const n = el('option'); n.value = o; return n; }));
}

const grouping = createGrouping({ el, state, $, render: () => render(), renderCard });

function render() {
  const { lanes, cards: all } = state.data;
  unreadCards = attention.unreadIds('kanban', (all || [])
    .filter((card) => !card.archived_at)
    .map((card) => ({ id: card.id, sig: cardSignature(card), lane: card.lane_id })));
  // A deeply-linked or already-open card counts as read as soon as the board
  // can see it; the comment fetch handles the per-comment shimmer.
  const opened = openId();
  if (opened != null) {
    const openCardData = (all || []).find((card) => card.id === opened);
    if (openCardData && unreadCards.has(opened)) markCardRead(openCardData);
  }
  const pool = state.archived ? all.concat(state.archived) : all;
  const done = lanes.find((lane) => lane.name.toLowerCase() === 'done');
  const laneOf = (card) => (card.archived_at && done ? done.id : card.lane_id);
  paintUpdatedFilter({ el, $, state, onChange: setUpdated });
  paintOpFilter(pool);
  paintOwnerFilter(pool);
  paintLaneFilter({ el, $, state, lanes, onChange: setLane });
  const cards = search
    .filter(pool.filter(opMatch).filter(ownerMatch).filter((card) => updatedMatch(state, card)))
    .filter((card) => laneMatch(state, card, done ? done.id : null));
  // live matches first; a stable sort keeps the server's relevance order inside each group
  cards.sort((a, b) => (a.archived_at ? 1 : 0) - (b.archived_at ? 1 : 0));
  const board = $('kanban-board');
  board.classList.toggle('op-filtered', !!state.op);
  board.classList.toggle('searching', search.active());
  // Re-rendering replaces the lane nodes, which would reset each lane's own
  // scroll; carry the offsets across so a 3s poll never yanks the view.
  const laneScroll = new Map();
  board.querySelectorAll('.kb-cards').forEach((list) => {
    if (list.scrollTop) laneScroll.set(String(list.dataset.laneId), list.scrollTop);
  });
  state.laneNames = Object.fromEntries(lanes.map((lane) => [lane.id, lane.name]));
  if (state.group === 'owner') {
    board.classList.add('by-owner');
    board.replaceChildren(...grouping.ownerColumns(cards).map(grouping.renderOwnerColumn));
  } else {
    board.classList.remove('by-owner');
    board.replaceChildren(...lanes.map((lane) => renderLane(lane, cards.filter((c) => laneOf(c) === lane.id))));
  }
  if (laneScroll.size) {
    board.querySelectorAll('.kb-cards').forEach((list) => {
      const y = laneScroll.get(String(list.dataset.laneId));
      if (y) list.scrollTop = y;
    });
  }
  const archivedCount = lanes.reduce((n, l) => n + (l.archived_count || 0), 0);
  const total = pool.length;
  const shown = cards.length === total ? `${total}` : `${cards.length}/${total}`;
  const unit = state.group === 'owner'
    ? `${grouping.ownerColumns(cards).length} owners`
    : `${lanes.length} lanes`;
  $('kanban-count').textContent = `${shown} card${total === 1 ? '' : 's'} · ${unit}`
    + (archivedCount ? ` · ${archivedCount} archived` : '')
    + (state.op ? ` · op: ${state.op === NO_OP ? 'none' : state.op}` : '')
    + (state.owner ? ` · author: ${state.owner === NO_OWNER ? 'none' : state.owner}` : '')
    + (state.lane ? ` · lane: ${state.laneNames[state.lane] || state.lane}` : '')
    + (state.updated ? ` · updated: ${updatedLabel(state)}` : '')
    + (search.active() ? ` · ${search.note()}` : '');
  if (!lanes.length) board.append(el('div', 'kb-empty', 'No lanes yet — add one with + Lane.'));
  else if (search.active() && !cards.length) board.append(el('div', 'kb-empty', `No cards match “${search.query()}”.`));
  // A new query brings its first hit's lane into view (archived hits live in Done).
  const q = search.active() ? search.query() : '';
  if (q !== state.searchQ) {
    state.searchQ = q;
    if (q && cards.length) {
      const first = board.querySelector(`.kb-lane[data-lane-id="${laneOf(cards[0])}"]`);
      first?.scrollIntoView({ block: 'nearest', inline: 'start' });
    }
  }
  runAttention();
}

// Signature catches content changes even when two writes land in the same
// second (updated_at has one-second resolution), and movement catches lanes.
function cardSignature(card) {
  return [
    card.updated_at, card.title, card.owner, card.opname, card.archived_at,
    card.comment_count || 0, card.body_preview || '',
    card.body_tasks ? `${card.body_tasks.done}/${card.body_tasks.total}` : '',
  ].join('|');
}

// First focus of the board since the last visit: shimmer what changed, and
// fly cards that changed lane from their old lane to the new one.
function runAttention() {
  if (!attentionPending || !state.data) return;
  attentionPending = false;
  const laneNames = new Map(state.data.lanes.map((lane) => [lane.id, lane.name]));
  const nodes = new Map();
  document.querySelectorAll('#kanban-board .kb-card[data-id]').forEach((node) => {
    nodes.set(Number(node.dataset.id), node);
  });
  const entries = (state.data.cards || [])
    .filter((card) => !card.archived_at)
    .map((card) => ({
      id: card.id,
      el: nodes.get(card.id) || null,
      sig: cardSignature(card),
      lane: card.lane_id,
    }));
  attention.visit('kanban', entries, {
    allIds: (state.data.cards || []).filter((card) => !card.archived_at).map((card) => card.id),
    laneName: (id) => laneNames.get(Number(id)),
    laneEl: (id) => document.querySelector(`.kb-lane[data-lane-id="${id}"]`),
    keepUnread: true,
  });
}

// Clicking a card is the "I read this" signal: clear its persistent shimmer and
// remember the exact signature that was shown.
function markCardRead(card, fresh) {
  const latest = fresh ? card : ((state.data?.cards || []).find((c) => c.id === card.id) || card);
  attention.markRead('kanban', latest.id, cardSignature(latest), latest.lane_id);
  unreadCards.delete(latest.id);
  const node = document.querySelector(`.kb-card[data-id="${latest.id}"]`);
  if (!node) return;
  node.classList.remove('attention-unread');
  node.querySelectorAll('.attention-sweep-wrap.is-loop').forEach((wrap) => wrap.remove());
}

function renderLane(lane, cards) {
  const col = el('div', 'kb-lane');
  col.dataset.laneId = lane.id;
  const head = el('div', 'kb-lane-head');
  const name = el('span', 'kb-lane-name', lane.name);
  name.title = 'Click to rename';
  name.addEventListener('click', () => inlineEdit(name, lane.name, state, (v) =>
    v && v !== lane.name && mutate(() => api.patchLane(lane.id, { name: v }))));
  const del = el('button', 'kb-icon kb-lane-del', '×');
  del.disabled = cards.length > 0;
  del.title = cards.length ? 'Move or delete this lane’s cards first' : 'Delete empty lane';
  armDelete(del, () => mutate(() => api.deleteLane(lane.id)));
  head.append(name, el('span', 'kb-count', String(cards.length)));
  if (lane.name.toLowerCase() === 'done') head.append(renderArchiveDone(lane.card_count ?? cards.length));
  head.append(del);

  const list = el('div', 'kb-cards');
  list.dataset.laneId = lane.id;
  list.append(...cards.map(renderCard));
  wireDrop(list);

  col.append(head, list, renderAdd(lane));
  return col;
}

// "Archive Done": archives every card in the Done lane server-side (two-click confirm).
function renderArchiveDone(count) {
  const btn = el('button', 'kb-archive-btn', 'Archive Done');
  btn.disabled = count === 0;
  btn.title = count ? `Archive all ${count} card(s) in Done (click twice)` : 'Done is empty';
  armDelete(btn, () => mutate(async () => {
    const r = await api.archiveDone();
    setStatus(`archived ${r.archived} card${r.archived === 1 ? '' : 's'}`);
  }), `archive ${count}?`);
  return btn;
}

function renderCard(card) {
  const n = el('div', 'kb-card');
  // Dragging moves a card between lanes, so it is off while grouping by owner.
  n.draggable = state.group !== 'owner' && !search.active() && !card.archived_at;
  n.dataset.id = card.id;
  n.tabIndex = 0;
  n.title = card.archived_at ? 'Open archived card' : 'Open card';
  if (card.archived_at) n.classList.add('is-archived');
  const title = el('div', 'kb-card-title', card.title);
  if (card.opname) n.classList.add('has-op');
  const meta = el('div', 'kb-card-meta');
  const owner = el('span', card.owner ? 'kb-owner' : 'kb-owner none', card.owner ? `@${card.owner}` : '+ owner');
  owner.title = 'Click to set owner (blank clears)';
  owner.addEventListener('click', (e) => {
    e.stopPropagation();
    inlineEdit(owner, card.owner || '', state, (v) =>
      v !== (card.owner || '') && mutate(() => api.patchCard(card.id, { owner: v || null })));
  });
  meta.append(owner, ...bodyBadges(card));
  if (state.group === 'owner') {
    const lane = el('span', 'kb-badge kb-badge-lane', state.laneNames[card.lane_id] || '?');
    lane.title = 'Lane this card sits in';
    meta.append(lane);
  }
  if (card.archived_at) meta.append(el('span', 'kb-badge kb-badge-archived', 'archived'));
  const id = el('span', 'kb-id', `#${card.id}`);
  const del = el('button', 'kb-icon kb-del', '×');
  del.title = 'Delete card (click twice)';
  armDelete(del, () => mutate(() => api.deleteCard(card.id)));
  meta.append(id, del);
  if (card.opname) n.append(opChip(card.opname));
  n.append(title);
  if (card.body_preview) n.append(el('div', 'kb-card-preview', card.body_preview));
  n.append(meta);
  appendDocRefs(n, card);
  search.decorate(n, card);
  if (unreadCards.has(card.id)) {
    n.classList.add('attention-unread');
    const wrap = el('span', 'attention-sweep-wrap is-loop');
    wrap.append(el('i', 'attention-sweep'));
    n.append(wrap);
  }
  const open = () => {
    markCardRead(card);
    location.hash = `#/kanban/card-${card.id}`;
  };
  n.addEventListener('click', (e) => {
    // A drag never opens the card (some browsers emit a click right after dragend).
    if (state.dragId !== null || Date.now() - state.dragEnd < 350) return;
    if (e.target.closest('input, button, a, .kb-owner, .kb-opname')) return;
    open();
  });
  n.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === n) { e.preventDefault(); open(); }
  });
  n.addEventListener('dragstart', (e) => {
    state.dragId = card.id;
    state.busy++;
    n.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(card.id));
  });
  n.addEventListener('dragend', () => {
    n.classList.remove('dragging');
    document.querySelectorAll('.kb-cards.over').forEach((l) => l.classList.remove('over'));
    document.querySelectorAll('.kb-drop-mark').forEach((m) => m.remove());
    if (state.dragId !== null) { state.dragId = null; state.busy = Math.max(0, state.busy - 1); }
    state.dragEnd = Date.now();
  });
  return n;
}

// Operation chip; click toggles the board filter to that op.
function opChip(opname) {
  const chip = el('button', 'kb-opname');
  chip.type = 'button';
  chip.append(el('span', 'kb-opname-ico', '◆'), el('span', 'kb-opname-txt', opname));
  const active = opKey(state.op) === opKey(opname);
  chip.classList.toggle('active', active);
  chip.title = active ? 'Show all ops' : `Show only ${opname}`;
  chip.addEventListener('click', (e) => { e.stopPropagation(); setOp(active ? '' : opname); });
  return chip;
}

// Small "has a description" / checklist badges for a card's meta row.
function bodyBadges(card) {
  const out = [];
  if (card.has_body) {
    const b = el('span', 'kb-badge kb-badge-body', '≡');
    b.title = 'Has a description';
    out.push(b);
  }
  const t = card.body_tasks;
  if (t && t.total) {
    const b = el('span', `kb-badge kb-badge-tasks${t.done === t.total ? ' done' : ''}`, `☑ ${t.done}/${t.total}`);
    b.title = `${t.done} of ${t.total} checklist items done`;
    out.push(b);
  }
  if (card.comment_count) {
    const b = el('span', 'kb-badge kb-badge-comments', `c:${card.comment_count}`);
    b.title = `${card.comment_count} comment${card.comment_count === 1 ? '' : 's'}`;
    out.push(b);
  }
  return out;
}

// Index among the lane's other cards where a drop at clientY would land.
function dropIndex(list, y) {
  const others = [...list.querySelectorAll('.kb-card:not(.dragging)')];
  const i = others.findIndex((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return { index: i === -1 ? others.length : i, before: others[i] || null };
}

function wireDrop(list) {
  list.addEventListener('dragover', (e) => {
    if (state.dragId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    list.classList.add('over');
    const { before } = dropIndex(list, e.clientY);
    const mark = document.querySelector('.kb-drop-mark') || el('div', 'kb-drop-mark');
    if (before) list.insertBefore(mark, before); else list.append(mark);
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) {
      list.classList.remove('over');
      list.querySelector('.kb-drop-mark')?.remove();
    }
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = state.dragId;
    if (id === null) return;
    const { index } = dropIndex(list, e.clientY);
    const laneId = Number(list.dataset.laneId);
    const dragged = document.querySelector(`.kb-card[data-id="${id}"]`);
    const mark = list.querySelector('.kb-drop-mark');
    if (dragged && mark) mark.replaceWith(dragged); // optimistic move
    state.dragId = null;
    state.busy = Math.max(0, state.busy - 1);
    mutate(() => api.patchCard(id, { status: laneId, position: index }));
  });
}

function renderAdd(lane) {
  const wrap = el('div', 'kb-add');
  const open = el('button', 'kb-add-open', '+ Add card');
  const form = el('form', 'kb-add-form');
  form.hidden = true;
  const title = el('input');
  title.placeholder = 'Card title';
  title.maxLength = 500;
  const owner = el('input', 'kb-add-owner');
  owner.placeholder = 'owner (optional)';
  owner.maxLength = 100;
  const opname = el('input', 'kb-add-opname');
  opname.placeholder = 'opname (optional)';
  opname.maxLength = 100;
  opname.setAttribute('list', 'kb-opname-list');
  const actions = el('div', 'kb-add-actions');
  const ok = el('button', 'brief-btn', 'Add');
  ok.type = 'submit';
  const cancel = el('button', 'brief-btn', 'Cancel');
  cancel.type = 'button';
  actions.append(ok, cancel);
  form.append(title, owner, opname, actions);
  const close = () => { form.hidden = true; open.hidden = false; state.busy = Math.max(0, state.busy - 1); };
  open.addEventListener('click', () => {
    form.hidden = false; open.hidden = true; state.busy++;
    // A new card starts in the op you are filtered to.
    if (!opname.value && state.op && state.op !== NO_OP) opname.value = state.op;
    title.focus();
  });
  cancel.addEventListener('click', close);
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    close();
    const card = { title: t, owner: owner.value.trim() || null, status: lane.id };
    const op = opname.value.trim();
    if (op) card.opname = op;
    mutate(() => api.addCard(card));
  });
  wrap.append(open, form);
  return wrap;
}

function addLane() {
  const btn = $('kanban-add-lane');
  const input = el('input', 'kb-lane-input');
  input.placeholder = 'Lane name';
  input.maxLength = 60;
  btn.replaceWith(input);
  state.busy++;
  input.focus();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    input.replaceWith(btn);
    state.busy = Math.max(0, state.busy - 1);
    const v = input.value.trim();
    if (save && v) mutate(() => api.addLane(v));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// Called by the router when the view is entered, and when the tab becomes
// visible again (refresh first so the diff includes what changed while away).
export function enterKanban(opts = {}) {
  attentionPending = true;
  if (!state.data) return; // the initial refresh lands here through render()
  if (opts.soft && state.busy) return; // mid-edit: the next render picks it up
  refresh(opts.soft ? undefined : true).finally(runAttention);
}

// #/kanban/card-<id>[/edit] (or the short #card-<id>) opens that card's modal.
function syncHash() {
  const m = location.hash.match(/^#(?:\/kanban\/)?card-(\d+)(\/edit)?$/);
  if (m) {
    const id = Number(m[1]);
    const card = (state.data?.cards || []).find((c) => c.id === id);
    if (card) markCardRead(card);
    openCard(id, { edit: !!m[2] });
  } else closeCard();
}

export function initKanban() {
  if (state.started) { refresh(); syncHash(); return; }
  state.started = true;
  setupDetail({
    lanes: () => state.data?.lanes || [],
    onChange: () => refresh(true),
    onRead: (card) => markCardRead(card, true),
    onClose: () => {
      if (openId() === null && /card-\d+/.test(location.hash)) history.replaceState(null, '', '#/kanban');
    },
  });
  window.addEventListener('hashchange', syncHash);
  $('kanban-refresh').addEventListener('click', () => refresh(true));
  $('kanban-group-lane').addEventListener('click', () => grouping.setGroup('lane'));
  $('kanban-group-owner').addEventListener('click', () => grouping.setGroup('owner'));
  grouping.paintGroup();
  $('kanban-add-lane').addEventListener('click', addLane);
  search.init(async () => {
    if (!state.data) return;
    await ensureArchived();
    render();
  });
  refresh(true).then(syncHash);
  setInterval(() => {
    if (document.body.dataset.view === 'kanban' && !document.hidden) refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.body.dataset.view === 'kanban') enterKanban({ soft: true });
  });
}
