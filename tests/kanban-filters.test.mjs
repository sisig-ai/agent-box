// The board's stackable filters: AND between conditions, OR inside one.
// Ported from static/js/kanban/filters.js to the React lib (same rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NONE,
  activeOp,
  hasOp,
  matches,
  setOpFilter,
  valueLabel,
} from '../frontend/src/lib/filters.ts';

const laneOf = (card) => card.lane_id;
const card = (over = {}) => ({
  lane_id: 1,
  owner: 'box',
  opname: 'valhalla',
  updated_at: '2026-11-12T08:00:00+08:00',
  ...over,
});
const cond = (field, values, negate = false) => ({ field, negate, values });

test('no filter matches everything', () => {
  assert.equal(matches([], card(), laneOf), true);
});

test('one condition, values OR inside it', () => {
  const byLane = cond('lane', ['1', '2']);
  assert.equal(matches([byLane], card({ lane_id: 1 }), laneOf), true);
  assert.equal(matches([byLane], card({ lane_id: 2 }), laneOf), true);
  assert.equal(matches([byLane], card({ lane_id: 3 }), laneOf), false);
});

test('two conditions AND together', () => {
  const byLane = cond('lane', ['1']);
  const byOwner = cond('author', ['box']);
  assert.equal(matches([byLane, byOwner], card(), laneOf), true);
  assert.equal(matches([byLane, byOwner], card({ owner: 'hermes' }), laneOf), false);
});

test('negate inverts one condition', () => {
  const notOwner = cond('author', ['box'], true);
  assert.equal(matches([notOwner], card({ owner: 'hermes' }), laneOf), true);
  assert.equal(matches([notOwner], card(), laneOf), false);
});

test('author compare is case-insensitive; NONE means unassigned', () => {
  const byOwner = cond('author', ['BOX']);
  assert.equal(matches([byOwner], card(), laneOf), true);
  const noneSet = cond('author', [NONE]);
  assert.equal(matches([noneSet], card({ owner: null }), laneOf), true);
  assert.equal(matches([noneSet], card(), laneOf), false);
});

test('op filter behaves like author', () => {
  const byOp = cond('op', ['valhalla']);
  assert.equal(matches([byOp], card(), laneOf), true);
  assert.equal(matches([byOp], card({ opname: null }), laneOf), false);
  const noneOp = cond('op', [NONE]);
  assert.equal(matches([noneOp], card({ opname: null }), laneOf), true);
});

test('updated presets: today / last:7 / on:date', () => {
  const now = new Date('2026-11-12T12:00:00');
  const today = card({ updated_at: '2026-11-12T09:00:00+08:00' });
  const yesterday = card({ updated_at: '2026-11-11T09:00:00+08:00' });
  const lastWeek = card({ updated_at: '2026-11-06T09:00:00+08:00' });
  const longAgo = card({ updated_at: '2026-09-01T09:00:00+08:00' });

  const isToday = cond('updated', ['today']);
  assert.equal(matches([isToday], today, laneOf, now), true);
  assert.equal(matches([isToday], yesterday, laneOf, now), false);

  const last7 = cond('updated', ['last:7']);
  assert.equal(matches([last7], lastWeek, laneOf, now), true);
  assert.equal(matches([last7], longAgo, laneOf, now), false);

  const onDay = cond('updated', ['on:2026-11-11']);
  assert.equal(matches([onDay], yesterday, laneOf, now), true);
  assert.equal(matches([onDay], today, laneOf, now), false);
});

test('activeOp reads the single non-negated op condition', () => {
  assert.equal(activeOp([cond('op', ['valhalla'])]), 'valhalla');
  assert.equal(activeOp([cond('op', [NONE])]), '');
  assert.equal(activeOp([cond('op', ['a', 'b'])]), '');
  assert.equal(activeOp([cond('op', ['valhalla'], true)]), '');
  assert.equal(activeOp([]), '');
});

test('hasOp compares case-insensitively', () => {
  assert.equal(hasOp([cond('op', ['Valhalla'])], 'VALHALLA'), true);
  assert.equal(hasOp([], 'valhalla'), false);
});

test('setOpFilter replaces the op condition, keeping the rest', () => {
  const byLane = cond('lane', ['1']);
  const byOp = cond('op', ['old']);
  const next = setOpFilter([byLane, byOp], 'valhalla');
  assert.equal(next.length, 2);
  assert.deepEqual(next[0], byLane);
  assert.deepEqual(next[1], cond('op', ['valhalla']));

  const cleared = setOpFilter([byLane, cond('op', ['x'])], '');
  assert.equal(cleared.length, 1);
});

test('valueLabel renders the sentinel and author forms', () => {
  assert.equal(valueLabel(cond('author', [NONE]), NONE), 'unassigned');
  assert.equal(valueLabel(cond('author', ['box']), 'box'), '@box');
  assert.equal(valueLabel(cond('op', [NONE]), NONE), 'no op');
});
