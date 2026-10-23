// Card comment thread for the detail modal: timestamped, author-attributed,
// markdown bodies, oldest first (newest last) + an add-comment box.
// Times render in Asia/Manila, 24h, e.g. "Oct 23 0812 manila".
import { api } from './api.js?v=kanban7';
import { renderBody } from './markdown.js?v=kanban7';

const ui = {};
const st = { id: null, sig: null, seq: 0 };
const AUTHOR_KEY = 'opsboard.commentAuthor';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });
const HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false });
export function manilaStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return `${DAY.format(d)} ${HM.format(d).replace(':', '')} manila`;
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
  ui.author.value = localStorage.getItem(AUTHOR_KEY) || 'Kix';
  ui.text = el('textarea', 'kbc-text');
  ui.text.placeholder = 'Add a comment (markdown) — ⌘/Ctrl+Enter to post';
  ui.post = el('button', 'brief-btn kbc-post', 'Comment');
  ui.msg = el('span', 'kbd-msg kbc-msg');
  const row = el('div', 'kbc-row');
  row.append(ui.author, ui.msg, ui.post);
  form.append(ui.text, row);
  wrap.append(head, ui.list, form);
  ui.post.addEventListener('click', post);
  ui.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); post(); }
  });
  ui.list.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.kbc-del');
    if (btn) remove(Number(btn.dataset.id), btn);
  });
  return wrap;
}

function render(list) {
  ui.label.textContent = list.length ? `Comments (${list.length})` : 'Comments';
  if (!list.length) {
    ui.list.replaceChildren(el('p', 'kbd-empty', 'No comments yet.'));
    return;
  }
  ui.list.replaceChildren(...list.map((c) => {
    const item = el('div', 'kbc-item');
    const meta = el('div', 'kbc-meta');
    const when = el('span', 'kbc-time', manilaStamp(c.created_at));
    when.title = c.created_at;
    const del = el('button', 'kb-icon kbc-del', '×');
    del.title = 'Delete comment (click twice)';
    del.dataset.id = c.id;
    meta.append(el('span', 'kbc-author-name', c.author), when, del);
    const body = el('div', 'kbc-body kbd-md');
    renderBody(body, c.body, false);
    item.append(meta, body);
    return item;
  }));
}

async function load(id) {
  const seq = ++st.seq;
  try {
    const list = await api.comments(id);
    if (seq === st.seq && st.id === id) render(list);
  } catch (e) {
    if (seq === st.seq) ui.msg.textContent = e.message;
  }
}

// Called from the detail modal's paint(): refetch when the card or its comment count/updated_at changes.
export function paintComments(card) {
  if (!ui.list || !card) return;
  const sig = `${card.id}|${card.comment_count}|${card.updated_at}`;
  if (card.id !== st.id) { st.id = card.id; ui.list.replaceChildren(); ui.msg.textContent = ''; ui.text.value = ''; }
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
