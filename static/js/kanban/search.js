// Full-text search for the Ops Board (internal id: kanban).
// The header box queries /api/opsboard/search (SQLite FTS5, so titles, bodies,
// comments, opnames and owners all match) and the results are applied as a
// board filter: matching cards get their title/snippet highlighted with the
// server's \x01…\x02 hit markers. Dragging is disabled while a query is active,
// because the visible order is no longer the lane order.
import { api } from './api.js?v=kanban20';

const DEBOUNCE_MS = 180;
const MIN_CHARS = 2;
const LIMIT = 200;
const HIT = '\x01';

let onChange = () => {};
const state = { q: '', cards: new Map(), total: 0, seq: 0, timer: 0, error: '' };

export const active = () => state.q !== '';
export const query = () => state.q;
export const sig = () => `${state.q}|${state.total}|${[...state.cards.keys()].sort((a, b) => a - b)}`;

// Text with the server's hit markers as <mark> nodes (never innerHTML: card and
// comment text is untrusted).
export function marked(text) {
  const frag = document.createDocumentFragment();
  String(text).split(/\x01|\x02/).forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const hit = document.createElement('mark');
      hit.className = 'kb-hl';
      hit.textContent = part;
      frag.append(hit);
    } else {
      frag.append(document.createTextNode(part));
    }
  });
  return frag;
}

function control() {
  const input = document.getElementById('kanban-search');
  const clear = document.getElementById('kanban-search-clear');
  if (input) input.classList.toggle('active', active());
  if (clear) clear.hidden = !input || !input.value;
}

async function run(query, notify = true) {
  const wanted = query.trim();
  const seq = ++state.seq;
  if (wanted.length < MIN_CHARS) {
    state.q = '';
    state.cards = new Map();
    state.total = 0;
    state.error = '';
    control();
    if (notify) onChange();
    return;
  }
  state.q = wanted;
  try {
    const res = await api.search(wanted, { limit: LIMIT, archived: 'include' });
    if (seq !== state.seq) return; // a newer query already answered
    state.cards = new Map((res.cards || []).map((r) => [r.card_id, r]));
    state.total = res.total ?? state.cards.size;
    state.error = '';
  } catch (e) {
    if (seq !== state.seq) return;
    state.cards = new Map();
    state.total = 0;
    state.error = e.message;
  }
  control();
  if (notify) onChange();
}

export function init(onUpdate) {
  onChange = onUpdate;
  const input = document.getElementById('kanban-search');
  const clear = document.getElementById('kanban-search-clear');
  if (!input) return;
  const schedule = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => run(input.value), DEBOUNCE_MS);
  };
  input.addEventListener('input', () => { control(); schedule(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      clearTimeout(state.timer);
      run('');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(state.timer);
      run(input.value);
    }
  });
  clear?.addEventListener('click', () => {
    input.value = '';
    clearTimeout(state.timer);
    run('');
    input.focus();
  });
}

// Re-run the active query without re-rendering (the board renders after this).
export async function refresh() {
  if (active()) await run(state.q, false);
}

export function filter(cards) {
  return active() ? cards.filter((c) => state.cards.has(c.id)) : cards;
}

// Title highlight + the matched line, replacing the plain body preview.
export function decorate(node, card) {
  const hit = state.cards.get(card.id);
  if (!active() || !hit) return;
  node.classList.add('kb-search-hit');
  const title = node.querySelector('.kb-card-title');
  if (title && (hit.title_marked || '').includes(HIT)) title.replaceChildren(marked(hit.title_marked));
  node.querySelector('.kb-card-preview')?.remove();
  if (!hit.snippet) return;
  const line = document.createElement('div');
  line.className = 'kb-card-snippet';
  if (hit.snippet_source === 'comment') {
    const src = document.createElement('span');
    src.className = 'kb-snippet-src';
    src.textContent = 'c:';
    src.title = 'Matched a comment';
    line.append(src);
  }
  line.append(marked(hit.snippet));
  title?.after(line);
}

// Extra text for the board's status line; '' when no search is running.
export function note() {
  if (!active()) return '';
  if (state.error) return `search failed: ${state.error}`;
  const n = state.total;
  const shown = state.cards.size;
  const archived = [...state.cards.values()].filter((r) => r.archived_at).length;
  return `search “${state.q}” · ${n} match${n === 1 ? '' : 'es'}`
    + (archived ? ` · ${archived} archived` : '')
    + (n > shown ? ` · showing ${shown}` : '');
}
