// Kanban tab: lanes as columns, cards with inline edit, HTML5 drag and drop,
// and a 3s poll (only while the tab is visible and nobody is mid-edit/drag) so
// changes agents make through /api/kanban show up on their own.
import { api } from './api.js?v=kanban2';
import { inlineEdit, armDelete } from './edit.js?v=kanban2';

const POLL_MS = 3000;
const $ = (id) => document.getElementById(id);
const state = { data: null, sig: '', busy: 0, dragId: null, started: false };

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

export async function refresh(force) {
  if (state.busy && !force) return;
  try {
    const data = await api.board();
    const sig = JSON.stringify(data);
    state.data = data;
    if (sig !== state.sig || force) { state.sig = sig; render(); }
    setStatus(`synced ${new Date().toLocaleTimeString([], { hour12: false })}`);
  } catch (e) {
    setStatus(`sync failed: ${e.message}`, true);
  }
}

async function mutate(fn) {
  try { await fn(); } catch (e) { setStatus(e.message, true); }
  await refresh(true);
}

function render() {
  const { lanes, cards } = state.data;
  const board = $('kanban-board');
  board.replaceChildren(...lanes.map((lane) => renderLane(lane, cards.filter((c) => c.lane_id === lane.id))));
  const archived = lanes.reduce((n, l) => n + (l.archived_count || 0), 0);
  $('kanban-count').textContent = `${cards.length} card${cards.length === 1 ? '' : 's'} · ${lanes.length} lanes`
    + (archived ? ` · ${archived} archived` : '');
  if (!lanes.length) board.append(el('div', 'kb-empty', 'No lanes yet — add one with + Lane.'));
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
  if (lane.name.toLowerCase() === 'done') head.append(renderArchiveDone(cards.length));
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
  n.draggable = true;
  n.dataset.id = card.id;
  const title = el('div', 'kb-card-title', card.title);
  title.title = 'Click to edit';
  title.addEventListener('click', () => inlineEdit(title, card.title, state, (v) =>
    v && v !== card.title && mutate(() => api.patchCard(card.id, { title: v }))));
  const meta = el('div', 'kb-card-meta');
  const owner = el('span', card.owner ? 'kb-owner' : 'kb-owner none', card.owner ? `@${card.owner}` : '+ owner');
  owner.title = 'Click to set owner (blank clears)';
  owner.addEventListener('click', () => inlineEdit(owner, card.owner || '', state, (v) =>
    v !== (card.owner || '') && mutate(() => api.patchCard(card.id, { owner: v || null }))));
  const id = el('span', 'kb-id', `#${card.id}`);
  const del = el('button', 'kb-icon kb-del', '×');
  del.title = 'Delete card (click twice)';
  armDelete(del, () => mutate(() => api.deleteCard(card.id)));
  meta.append(owner, id, del);
  n.append(title, meta);
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
  });
  return n;
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
  const actions = el('div', 'kb-add-actions');
  const ok = el('button', 'brief-btn', 'Add');
  ok.type = 'submit';
  const cancel = el('button', 'brief-btn', 'Cancel');
  cancel.type = 'button';
  actions.append(ok, cancel);
  form.append(title, owner, actions);
  const close = () => { form.hidden = true; open.hidden = false; state.busy = Math.max(0, state.busy - 1); };
  open.addEventListener('click', () => { form.hidden = false; open.hidden = true; state.busy++; title.focus(); });
  cancel.addEventListener('click', close);
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    close();
    mutate(() => api.addCard({ title: t, owner: owner.value.trim() || null, status: lane.id }));
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

export function initKanban() {
  if (state.started) { refresh(); return; }
  state.started = true;
  $('kanban-refresh').addEventListener('click', () => refresh(true));
  $('kanban-add-lane').addEventListener('click', addLane);
  refresh(true);
  setInterval(() => {
    if (document.body.dataset.view === 'kanban' && !document.hidden) refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.body.dataset.view === 'kanban') refresh();
  });
}
