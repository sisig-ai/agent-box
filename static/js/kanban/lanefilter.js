// Header "Lane" filter: narrow the board to one swimlane.
//
// Archived cards are shown in Done whichever lane they came from, so the
// filter compares the lane the board actually renders the card in, not the
// lane stored on the row.

const LANE_KEY = 'opsboard.lane';

export function laneMatch(state, card, doneId) {
  if (!state.lane) return true;
  const shown = card.archived_at && doneId != null ? doneId : card.lane_id;
  return String(shown) === String(state.lane);
}

export function restoreLane() {
  try { return localStorage.getItem(LANE_KEY) || ''; } catch { return ''; }
}

export function storeLane(lane) {
  try {
    if (lane) localStorage.setItem(LANE_KEY, lane);
    else localStorage.removeItem(LANE_KEY);
  } catch { /* storage blocked */ }
}

// Every lane stays listed, even an empty one, so the choice does not vanish
// while a lane is being renamed or emptied.
export function paintLaneFilter(ctx) {
  const { el, $, state, lanes, onChange } = ctx;
  let sel = $('kanban-lane');
  if (!sel) {
    const wrap = el('label', 'kb-op-filter kb-lane-filter');
    wrap.title = 'Show only cards in this lane';
    wrap.append(el('span', 'kb-op-filter-lbl', 'Lane'));
    sel = el('select');
    sel.id = 'kanban-lane';
    sel.addEventListener('change', () => onChange(sel.value));
    wrap.append(sel);
    const author = $('kanban-owner');
    const anchor = author ? author.closest('label') : $('kanban-add-lane');
    anchor.before(wrap);
  }
  if (document.activeElement === sel) return; // never rebuild an open dropdown
  const rows = lanes.map((lane) => [String(lane.id), lane.name]);
  if (state.lane && !rows.some(([id]) => id === String(state.lane))) {
    rows.push([String(state.lane), `lane ${state.lane}`]);
  }
  const opts = [['', 'All lanes'], ...rows];
  sel.replaceChildren(...opts.map(([value, label]) => {
    const o = el('option', '', label);
    o.value = value;
    o.selected = value === String(state.lane || '');
    return o;
  }));
  sel.classList.toggle('active', !!state.lane);
}
