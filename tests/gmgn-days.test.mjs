import test from 'node:test';
import assert from 'node:assert/strict';
import { dayPages } from '../static/js/gmgn-days.js';

const event = (date, id) => ({ ts: Date.parse(date) / 1000, id });

test('manila midnight and year boundary produce distinct newest-first pages', () => {
  const before = event('2025-12-31T15:59:59Z', 'before');
  const after = event('2025-12-31T16:00:00Z', 'after');
  const page = dayPages([before, after]);
  assert.deepEqual(page.keys, ['2026-01-01', '2025-12-31']);
  assert.deepEqual(page.events, [after]);
  assert.equal(page.newer, null);
  assert.equal(page.older, '2025-12-31');
  const last = dayPages([before, after], page.older);
  assert.deepEqual(last.events, [before]);
  assert.equal(last.newer, '2026-01-01');
  assert.equal(last.older, null);
});

test('mixed second and millisecond timestamps sort by actual time without changing input', () => {
  const early = event('2026-10-15T17:00:00Z', 'early');
  const middle = { ...event('2026-10-15T18:00:00Z', 'middle') };
  middle.ts *= 1000;
  const late = event('2026-10-15T19:00:00Z', 'late');
  const input = [middle, early, late];
  assert.deepEqual(dayPages(input).events, [late, middle, early]);
  assert.deepEqual(input, [middle, early, late]);
});

test('unusable dates stay reachable after every dated entry', () => {
  const dated = event('2026-10-15T17:00:00Z', 'dated');
  const unknown = [undefined, null, '', 'invalid', 0, -1, Infinity, 1e30].map((ts) => ({ ts }));
  const input = [...unknown, dated];
  const first = dayPages(input);
  assert.equal(first.total, 9);
  assert.deepEqual(first.keys, ['2026-10-16', 'unknown']);
  assert.deepEqual(dayPages(input, first.older).events, unknown);
  assert.deepEqual(dayPages(unknown).events, unknown);
});

test('refresh retains the selected date while newer days arrive', () => {
  const old = event('2026-10-14T17:00:00Z', 'old');
  const current = event('2026-10-15T17:00:00Z', 'current');
  const next = event('2026-10-16T17:00:00Z', 'next');
  const selected = dayPages([old, current], '2026-10-15');
  const refreshed = dayPages([old, current, next], selected.key);
  assert.equal(refreshed.key, '2026-10-15');
  assert.deepEqual(refreshed.events, [old]);
  assert.equal(refreshed.newer, '2026-10-16');
  assert.equal(dayPages([current, next], refreshed.key).key, '2026-10-17');
});

test('empty data clears selection and the next feed starts at its newest day', () => {
  const empty = dayPages([], '2026-10-15');
  assert.deepEqual(empty, { keys: [], key: null, events: [], total: 0, newer: null, older: null });
  const loaded = dayPages([event('2026-10-15T17:00:00Z', 'loaded')], empty.key);
  assert.equal(loaded.key, '2026-10-16');
});
