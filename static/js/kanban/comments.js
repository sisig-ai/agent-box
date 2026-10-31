// Card comment thread for the detail modal: timestamped, author-attributed,
// markdown bodies, newest first (the newest post sits under the list head) +
// an add-comment box. Times render in Asia/Manila: relative ("30m ago",
// "2h ago") under 12 hours, absolute ("Oct 23 0812 manila") beyond, and the
// full timestamp (date, seconds, zone) in the tooltip either way.
import { api } from './api.js?v=kanban20';
import { renderBody } from './markdown.js?v=kanban20';
import * as attention from '../attention.js?v=attention7';

const ui = {};
const st = { id: null, sig: null, seq: 0, list: [], shown: 0, previewing: false, newIds: new Set() };
const AUTHOR_KEY = 'opsboard.commentAuthor';
const PAGE = 5;

// Esc dismisses the `new` markers on the open thread too; the watermarks have
// already advanced, so the repaint is permanent unless a newer comment lands.
document.addEventListener('attention:dismissed', () => {
  if (!st.newIds.size) return;
  st.newIds.clear();
  if (ui.list && st.list.length) paintList();
});

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });
const HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false });
const FULL = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Manila',
  year: 'numeric', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  timeZoneName: 'short',
});
const MIN = 60_000;
const HOUR = 60 * MIN;
const RELATIVE_LIMIT = 12 * HOUR;

export function manilaStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return `${DAY.format(d)} ${HM.format(d).replace(':', '')} manila`;
}

export function fullStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return FULL.format(d);
}

// Relative under 12 hours, absolute after that; clock skew reads as "just now".
export function relStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  const age = Date.now() - d.getTime();
  if (age < MIN) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MIN)}m ago`;
  if (age < RELATIVE_LIMIT) return `${Math.floor(age / HOUR)}h ago`;
  return manilaStamp(iso);
}

export function buildComments() {
  const wrap = el('div', 'kbc-wrap');
  const head = el('div', 'kbd-section');
  ui.label = el('span', 'kbd-section-label', 'Comments');
  head.append(ui.label);
  ui.list = el('div', 'kbc-list');
  const form = el('div', 'kbc-form');
  ui.author = el('input', 'kbc-author');
  ui.author.placeholder = 'author';
  ui.author.maxLength = 100;
  ui.author.value = localStorage.getItem(AUTHOR_KEY) || 'Operator';
  ui.text = el('textarea', 'kbc-text');
  ui.text.placeholder = 'Add a comment (markdown) — ⌘/Ctrl+Enter to post';
  ui.post = el('button', 'brief-btn kbc-post', 'Comment');
  ui.msg = el('span', 'kbd-msg kbc-msg');
  ui.previewBtn = el('button', 'tool-btn kbc-preview-btn', 'preview');
  ui.previewBtn.type = 'button';
  ui.previewBtn.title = 'Preview this comment as rendered markdown';
  ui.preview = el('div', 'kbc-preview kbd-md');
  ui.preview.hidden = true;
  const row = el('div', 'kbc-row');
  row.append(ui.author, ui.msg, ui.previewBtn, ui.post);
  form.append(ui.text, ui.preview, row);
  wrap.append(head, ui.list, form);
  ui.post.addEventListener('click', post);
  ui.previewBtn.addEventListener('click', () => setPreview(!st.previewing));
  ui.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); post(); }
  });
  ui.list.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.kbc-del');
    if (btn) remove(Number(btn.dataset.id), btn);
  });
  return wrap;
}

// Mirror the body editor's Preview/Edit: show the comment as it will render
// before posting. The textarea keeps the source either way.
function setPreview(on) {
  st.previewing = !!on;
  if (!ui.preview || !ui.text) return;
  ui.text.hidden = st.previewing;
  ui.preview.hidden = !st.previewing;
  ui.previewBtn.textContent = st.previewing ? 'write' : 'preview';
  ui.previewBtn.classList.toggle('toggled', st.previewing);
  if (!st.previewing) return;
  if (ui.text.value.trim()) renderBody(ui.preview, ui.text.value, false);
  else ui.preview.replaceChildren(el('p', 'kbd-empty', 'Nothing to preview yet.'));
}

// Newest first: the window starts at the 5 most recent posts and only grows
// when the "Load More" button is pressed.
function render(list) {
  const ts = (c) => {
    const t = Date.parse(c.created_at);
    return Number.isNaN(t) ? 0 : t;
  };
  st.list = list.slice().sort((a, b) => ts(b) - ts(a) || b.id - a.id);
  st.shown = Math.min(PAGE, st.list.length);
  paintList();
}

function commentCard(c) {
  const item = el('div', 'kbc-item');
  const meta = el('div', 'kbc-meta');
  const when = el('span', 'kbc-time', relStamp(c.created_at));
  when.title = fullStamp(c.created_at);
  const del = el('button', 'kb-icon kbc-del', '×');
  del.title = 'Delete comment (click twice)';
  del.dataset.id = c.id;
  meta.append(el('span', 'kbc-author-name', c.author), when, del);
  const body = el('div', 'kbc-body kbd-md');
  renderBody(body, c.body, false);
  const isNew = st.newIds.has(Number(c.id));
  if (isNew) {
    item.classList.add('is-new');
    meta.insertBefore(el('span', 'kbc-new', 'new'), del);
  }
  item.append(meta, body);
  if (isNew) {
    const wrap = el('span', 'attention-sweep-wrap is-comment');
    wrap.append(el('i', 'attention-sweep'));
    item.append(wrap);
  }
  return item;
}

function paintList() {
  const total = st.list.length;
  ui.label.textContent = total ? `Comments (${total})` : 'Comments';
  if (!total) {
    ui.list.replaceChildren(el('p', 'kbd-empty', 'No comments yet.'));
    return;
  }
  const out = st.list.slice(0, st.shown).map(commentCard);
  if (st.shown < total) {
    const more = el('button', 'brief-btn kbc-more', `Load More (${total - st.shown})`);
    more.type = 'button';
    more.title = 'Show the next 5 older comments';
    more.addEventListener('click', () => grow(PAGE));
    out.push(more);
  }
  ui.list.replaceChildren(...out);
}

function grow(n) {
  if (st.shown >= st.list.length) return;
  st.shown = Math.min(st.list.length, st.shown + n);
  paintList();
}

// Reopening a card starts from the 5 newest again.
export function resetComments() {
  st.sig = null;
  st.shown = PAGE;
  st.list = [];
  st.newIds = new Set();
  if (ui.list) ui.list.replaceChildren();
}

async function load(id) {
  const seq = ++st.seq;
  try {
    const list = await api.comments(id);
    if (seq === st.seq && st.id === id) {
      st.newIds = new Set(attention.newComments('kanban', id, list).map(Number));
      render(list);
    }
  } catch (e) {
    if (seq === st.seq) ui.msg.textContent = e.message;
  }
}

// Called from the detail modal's paint(): refetch when the card or its comment count/updated_at changes.
export function paintComments(card) {
  if (!ui.list || !card) return;
  const sig = `${card.id}|${card.comment_count}|${card.updated_at}`;
  if (card.id !== st.id) { st.id = card.id; ui.list.replaceChildren(); ui.msg.textContent = ''; ui.text.value = ''; setPreview(false); }
  if (sig === st.sig) return;
  st.sig = sig;
  load(card.id);
}

async function post() {
  const body = ui.text.value.trim();
  const author = ui.author.value.trim();
  if (!body || !author || st.id === null) { ui.msg.textContent = 'author and comment required'; return; }
  ui.post.disabled = true;
  try {
    await api.addComment(st.id, { author, body });
    localStorage.setItem(AUTHOR_KEY, author);
    ui.text.value = '';
    setPreview(false);
    ui.msg.textContent = '';
    await load(st.id);
  } catch (e) {
    ui.msg.textContent = e.message;
  } finally {
    ui.post.disabled = false;
  }
}

async function remove(commentId, btn) {
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    setTimeout(() => btn.classList.remove('armed'), 2500);
    return;
  }
  try {
    await api.deleteComment(st.id, commentId);
    await load(st.id);
  } catch (e) {
    ui.msg.textContent = e.message;
  }
}
