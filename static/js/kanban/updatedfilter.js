// Header "Updated" filter: all time / today / one calendar day, by last update.

// Local calendar day of an ISO timestamp; '' when the value cannot be parsed.
function dayOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function today() { return dayOf(new Date().toISOString()); }

export function updatedMatch(state, card) {
  if (!state.updated) return true;
  const day = dayOf(card.updated_at);
  if (!day) return false;
  return state.updated === 'today' ? day === today() : day === state.updated;
}

export function updatedLabel(state) {
  if (!state.updated) return '';
  return state.updated === 'today' ? 'today' : state.updated;
}

// Header "Updated" filter: all time / today / one calendar day (last update).
export function paintUpdatedFilter(ctx) {
  const { el, $, state, onChange } = ctx;
  let sel = $('kanban-updated');
  let date = $('kanban-updated-date');
  if (!sel) {
    const wrap = el('label', 'kb-op-filter kb-updated-filter');
    wrap.title = 'Show cards by the day they were last updated';
    wrap.append(el('span', 'kb-op-filter-lbl', 'Updated'));
    sel = el('select');
    sel.id = 'kanban-updated';
    for (const [value, label] of [['', 'all time'], ['today', 'today'], ['date', 'date…']]) {
      const o = el('option', '', label);
      o.value = value;
      sel.append(o);
    }
    date = el('input');
    date.type = 'date';
    date.id = 'kanban-updated-date';
    date.title = 'Last updated on this day';
    date.hidden = true;
    sel.addEventListener('change', () => {
      if (sel.value === 'date') {
        if (!date.value) date.value = today();
        date.hidden = false;
        onChange(date.value);
        if (typeof date.showPicker === 'function') { try { date.showPicker(); } catch { /* needs a user gesture */ } }
      } else {
        date.hidden = true;
        onChange(sel.value);
      }
    });
    date.addEventListener('change', () => onChange(date.value));
    wrap.append(sel, date);
    const opFilter = $('kanban-opname');
    if (opFilter) opFilter.closest('label').before(wrap);
    else $('kanban-add-lane').before(wrap);
  }
  const mode = state.updated === 'today' ? 'today' : (state.updated ? 'date' : '');
  if (document.activeElement !== sel) sel.value = mode;
  if (document.activeElement !== date) {
    date.hidden = mode !== 'date';
    if (state.updated && state.updated !== 'today') date.value = state.updated;
  }
  sel.classList.toggle('active', !!mode);
  date.classList.toggle('active', mode === 'date');
}
