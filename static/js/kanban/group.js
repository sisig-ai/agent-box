// Owner grouping for the Ops Board: one column per card owner, with the lane
// shown as a badge on each card. Shared state lives in board.js; this module
// only builds the columns and paints the header toggle.

const GROUP_KEY = 'opsboard.group';

export function createGrouping(ctx) {
  const { el, state, $, render, renderCard } = ctx;

function setGroup(group) {
  state.group = group === 'owner' ? 'owner' : 'lane';
  try { localStorage.setItem(GROUP_KEY, state.group); } catch { /* ignore */ }
  paintGroup();
  if (state.data) render();
}

// Header toggle: group the same cards by lane (default) or by owner.
function paintGroup() {
  const lane = $('kanban-group-lane');
  const owner = $('kanban-group-owner');
  if (!lane || !owner) return;
  lane.classList.toggle('active', state.group === 'lane');
  owner.classList.toggle('active', state.group === 'owner');
  lane.setAttribute('aria-pressed', String(state.group === 'lane'));
  owner.setAttribute('aria-pressed', String(state.group === 'owner'));
}

// Owner grouping: one column per owner (alphabetical, then unassigned).
function ownerColumns(cards) {
  const byOwner = new Map();
  for (const card of cards) {
    const key = (card.owner || '').trim();
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push(card);
  }
  const named = [...byOwner.keys()].filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const order = [...named, ...(byOwner.has('') ? [''] : [])];
  return order.map((key) => ({
    key,
    name: key ? `@${key}` : 'unassigned',
    cards: byOwner.get(key) || [],
  }));
}

function renderOwnerColumn(group) {
  const col = el('div', 'kb-lane kb-owner-col');
  col.dataset.owner = group.key;
  const head = el('div', 'kb-lane-head');
  head.append(el('span', 'kb-lane-name', group.name), el('span', 'kb-count', String(group.cards.length)));
  const list = el('div', 'kb-cards');
  list.append(...group.cards.map(renderCard));
  col.append(head, list);
  return col;
}


  return { ownerColumns, renderOwnerColumn, setGroup, paintGroup };
}
