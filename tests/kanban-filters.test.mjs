// The board's stackable filters: AND between conditions, OR inside one.
// The DOM half is covered by the browser probe; these are the pure rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NONE,
  activeOp,
  describe as describeChip,
  hasOp,
  matches,
  setOpFilter,
} from '../static/js/kanban/filters.js';

const laneOf = (card) => card.lane_id;
const now = new Date('2026-11-03T12:00:00+08:00');
const card = (over) => ({ lane_id: 3, owner: 'Cody', opname: 'CCE-1', updated_at: '2026-11-03T09:00:00+08:00', ...over });

test('bare filters match everything', () => {
  assert.equal(matches([], card(), laneOf, now), true);
});

test('conditions AND together', () => {
  const filters = [
    { field: 'lane', negate: false, values: ['3'] },
    { field: 'author', negate: false, values: ['Cody'] },
  ];
  assert.equal(matches(filters, card(), laneOf, now), true);
  assert.equal(matches(filters, card({ lane_id: 4 }), laneOf, now), false);
  assert.equal(matches(filters, card({ owner: 'Ann' }), laneOf, now), false);
});

test('values inside one condition OR together', () => {
  const filters = [{ field: 'lane', negate: false, values: ['3', '7'] }];
  assert.equal(matches(filters, card({ lane_id: 3 }), laneOf, now), true);
  assert.equal(matches(filters, card({ lane_id: 7 }), laneOf, now), true);
  assert.equal(matches(filters, card({ lane_id: 5 }), laneOf, now), false);
});

test('negate flips the whole condition', () => {
  const filters = [{ field: 'author', negate: true, values: ['Cody'] }];
  assert.equal(matches(filters, card(), laneOf, now), false);
  assert.equal(matches(filters, card({ owner: 'Ann' }), laneOf, now), true);
  assert.equal(matches(filters, card({ owner: '' }), laneOf, now), true);
});

test('author and op match case-insensitively', () => {
  assert.equal(matches([{ field: 'author', negate: false, values: ['cody'] }], card(), laneOf, now), true);
  assert.equal(matches([{ field: 'op', negate: false, values: ['cce-1'] }], card(), laneOf, now), true);
});

test('the unassigned value matches what has no owner or op', () => {
  const author = [{ field: 'author', negate: false, values: [NONE] }];
  assert.equal(matches(author, card({ owner: '' }), laneOf, now), true);
  assert.equal(matches(author, card(), laneOf, now), false);
  const op = [{ field: 'op', negate: false, values: [NONE] }];
  assert.equal(matches(op, card({ opname: '' }), laneOf, now), true);
  assert.equal(matches(op, card(), laneOf, now), false);
});

test('lane uses the lane the card is rendered in', () => {
  const done = (c) => (c.archived_at ? 4 : c.lane_id);
  const filters = [{ field: 'lane', negate: false, values: ['4'] }];
  assert.equal(matches(filters, card({ archived_at: '2026-11-01T00:00:00+08:00' }), done, now), true);
  assert.equal(matches(filters, card({ archived_at: '2026-11-01T00:00:00+08:00' }), laneOf, now), false);
});

test('updated presets read the card date against now', () => {
  const one = (value) => [{ field: 'updated', negate: false, values: [value] }];
  assert.equal(matches(one('today'), card(), laneOf, now), true);
  assert.equal(matches(one('today'), card({ updated_at: '2026-11-01T09:00:00+08:00' }), laneOf, now), false);
  assert.equal(matches(one('last:7'), card({ updated_at: '2026-11-01T09:00:00+08:00' }), laneOf, now), true);
  assert.equal(matches(one('last:7'), card({ updated_at: '2026-10-01T09:00:00+08:00' }), laneOf, now), false);
  assert.equal(matches(one('on:2026-10-01'), card({ updated_at: '2026-10-01T09:00:00+08:00' }), laneOf, now), true);
  assert.equal(matches(one('before:2026-10-01'), card({ updated_at: '2026-09-30T09:00:00+08:00' }), laneOf, now), true);
  assert.equal(matches(one('after:2026-10-01'), card({ updated_at: '2026-10-02T09:00:00+08:00' }), laneOf, now), true);
  assert.equal(matches(one('today'), card({ updated_at: 'not a date' }), laneOf, now), false);
});

test('describe reads like the chip', () => {
  const ctx = { laneNames: { 3: 'In Progress' } };
  assert.equal(
    describeChip({ field: 'lane', negate: false, values: ['3'] }, ctx),
    'lane is In Progress',
  );
  assert.equal(
    describeChip({ field: 'author', negate: true, values: ['Cody', 'Ann'] }, ctx),
    'author is not @Cody, @Ann',
  );
  assert.equal(
    describeChip({ field: 'op', negate: false, values: [NONE] }, ctx),
    'op is no op',
  );
  assert.equal(
    describeChip({ field: 'updated', negate: false, values: ['last:7'] }, ctx),
    'updated is in the last 7 days',
  );
});

test('the op chip replaces the op condition and leaves the rest alone', () => {
  const lane = { field: 'lane', negate: false, values: ['3'] };
  const withOp = setOpFilter([lane], 'CCE-1');
  assert.deepEqual(withOp, [lane, { field: 'op', negate: false, values: ['CCE-1'] }]);
  assert.deepEqual(setOpFilter(withOp, 'CCE-2'), [lane, { field: 'op', negate: false, values: ['CCE-2'] }]);
  assert.deepEqual(setOpFilter(withOp, ''), [lane]);
  assert.equal(activeOp(withOp), 'CCE-1');
  assert.equal(hasOp(withOp, 'cce-1'), true);
  assert.equal(hasOp([lane], 'CCE-1'), false);
});
