// The filter menu's state machine: the negate ("is"/"is not") toggle must
// survive until a value is ticked, and commit as today once one is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterBar } from '../static/js/kanban/filter-bar.js';

// A bare menu state with the filter-bar methods bound on top and setFilters
// captured instead of writing to localStorage.
function menu(state = {}) {
  const inst = {
    filters: state.filters ?? [],
    filterField: state.filterField ?? 'author',
    filterIndex: state.filterIndex ?? null,
    filterValues: state.filterValues ?? [],
    filterNegate: state.filterNegate ?? false,
    saved: null,
    setFilters(list) {
      inst.saved = list;
      inst.filters = list;
    },
    toggleFilterNegate: filterBar.toggleFilterNegate,
    toggleFilterValue: filterBar.toggleFilterValue,
    commitFilter: filterBar.commitFilter,
  };
  return inst;
}

test('negate before the first value is kept in the menu, not committed', () => {
  const m = menu();
  m.toggleFilterNegate();
  assert.equal(m.filterNegate, true);
  assert.deepEqual(m.filters, []);
  assert.equal(m.saved, null);
  m.toggleFilterNegate();
  assert.equal(m.filterNegate, false);
  assert.equal(m.saved, null);
});

test('a negate chosen before the first value applies once a value is ticked', () => {
  const m = menu({ filterField: 'author' });
  m.toggleFilterNegate();
  m.toggleFilterValue('Cody');
  assert.equal(m.filterNegate, true);
  assert.deepEqual(m.filters, [{ field: 'author', negate: true, values: ['Cody'] }]);
});

test('negate after a committed value still flips the condition', () => {
  const m = menu({ filterField: 'author' });
  m.toggleFilterValue('Cody');
  assert.deepEqual(m.filters, [{ field: 'author', negate: false, values: ['Cody'] }]);
  m.toggleFilterNegate();
  assert.deepEqual(m.filters, [{ field: 'author', negate: true, values: ['Cody'] }]);
});
