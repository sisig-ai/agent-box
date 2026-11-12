// The filter menu's commit semantics, ported to the React FilterBar: the
// negate ("is"/"is not") choice survives until a value is ticked, and a
// condition commits as soon as one value is chosen. The pure matching rules
// live in kanban-filters.test.mjs; this covers the add/edit/remove flow as
// the component implements it (list = filters, commit = onChange payload).
import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror of the component's commit() — kept in sync by review; the component
// owns the real copy (src/components/views/kanban/filter-bar.tsx).
function commit(filters, { editIndex = null, field = 'author', values = [], negate = false }) {
  const list = filters.map((cond) => ({ ...cond, values: [...cond.values] }));
  let closedMenu = false;
  if (editIndex == null) {
    if (!values.length) return { list: filters, closedMenu };
    list.push({ field, negate, values });
  } else if (values.length) {
    list[editIndex] = { field, negate, values };
  } else {
    list.splice(editIndex, 1);
    closedMenu = true;
  }
  return { list, closedMenu };
}

test('a new condition commits as soon as one value is ticked', () => {
  const { list } = commit([], { values: ['box'] });
  assert.deepEqual(list, [{ field: 'author', negate: false, values: ['box'] }]);
});

test('negate set before any value survives until the value is ticked', () => {
  const { list } = commit([], { negate: true, values: ['hermes'] });
  assert.equal(list[0].negate, true);
  assert.deepEqual(list[0].values, ['hermes']);
});

test('ticking a second value adds it to the same condition', () => {
  const first = [{ field: 'author', negate: false, values: ['box'] }];
  const { list } = commit(first, { editIndex: 0, field: 'author', values: ['box', 'hermes'] });
  assert.deepEqual(list[0].values, ['box', 'hermes']);
  assert.equal(list.length, 1);
});

test('unticking every value removes the condition and closes the menu', () => {
  const one = [{ field: 'author', negate: false, values: ['box'] }];
  const { list, closedMenu } = commit(one, { editIndex: 0, field: 'author', values: [] });
  assert.deepEqual(list, []);
  assert.equal(closedMenu, true);
});

test('editing keeps position and updates negate', () => {
  const two = [
    { field: 'lane', negate: false, values: ['1'] },
    { field: 'op', negate: false, values: ['valhalla'] },
  ];
  const { list } = commit(two, { editIndex: 1, field: 'op', values: ['valhalla'], negate: true });
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { field: 'lane', negate: false, values: ['1'] });
  assert.equal(list[1].negate, true);
});
