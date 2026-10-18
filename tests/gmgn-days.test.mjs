import test from 'node:test';
import assert from 'node:assert/strict';
import { dayPages } from '../static/js/gmgn-days.js';

const event = (date, id) => ({ ts: Date.parse(date) / 1000, id });

test('manila midnight and year boundary produce distinct newest-first pages', () => {
  const before = event('2025-12-31T15:59:59Z', 'before');
  const after = event('2025-12-31T16:00:00Z', 'after');
  const now = Date.parse('2026-01-01T04:00:00Z');
  const page = dayPages([before, after], undefined, now);
  assert.deepEqual(page.keys, ['2026-01-01', '2025-12-31']);
  assert.deepEqual(page.events, [after]);
  assert.equal(page.newer, null);
  assert.equal(page.older, '2025-12-31');
  const last = dayPages([before, after], page.older, now);
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
  const now = Date.parse('2026-10-16T04:00:00Z');
  assert.deepEqual(dayPages(input, undefined, now).events, [late, middle, early]);
  assert.deepEqual(input, [middle, early, late]);
});

test('unusable dates stay reachable after every dated entry', () => {
  const dated = event('2026-10-15T17:00:00Z', 'dated');
  const unknown = [undefined, null, '', 'invalid', 0, -1, Infinity, 1e30].map((ts) => ({ ts }));
  const input = [...unknown, dated];
  const now = Date.parse('2026-10-16T04:00:00Z');
  const first = dayPages(input, undefined, now);
  assert.equal(first.total, 9);
  assert.deepEqual(first.keys, ['2026-10-16', 'unknown']);
  assert.deepEqual(dayPages(input, first.older, now).events, unknown);
  assert.deepEqual(dayPages(unknown, undefined, now).events, unknown);
});

test('refresh retains the selected date while newer days arrive', () => {
  const old = event('2026-10-14T17:00:00Z', 'old');
  const current = event('2026-10-15T17:00:00Z', 'current');
  const next = event('2026-10-16T17:00:00Z', 'next');
  const now = Date.parse('2026-10-17T04:00:00Z');
  const selected = dayPages([old, current], '2026-10-15', now);
  const refreshed = dayPages([old, current, next], selected.key, now);
  assert.equal(refreshed.key, '2026-10-15');
  assert.deepEqual(refreshed.events, [old]);
  assert.equal(refreshed.newer, '2026-10-16');
  assert.equal(dayPages([current, next], refreshed.key, now).key, '2026-10-17');
});

test('empty data clears selection and the next feed starts at its newest day', () => {
  const now = Date.parse('2026-10-15T17:00:00Z');
  const empty = dayPages([], '2026-10-15', now);
  assert.deepEqual(empty, {
    keys: [], key: null, events: [], total: 0, newer: null, older: null, today: '2026-10-16',
  });
  const loaded = dayPages([event('2026-10-15T17:00:00Z', 'loaded')], empty.key, now);
  assert.equal(loaded.key, '2026-10-16');
});

test('today is selectable when it has no closes', () => {
  const yesterday = event('2026-10-17T13:00:00Z', 'yesterday');
  const now = Date.parse('2026-10-18T00:22:00Z');
  const page = dayPages([yesterday], undefined, now);
  assert.equal(page.keys[0], '2026-10-18');
  assert.equal(page.key, '2026-10-17');
  assert.equal(page.newer, '2026-10-18');
  const today = dayPages([yesterday], '2026-10-18', now);
  assert.equal(today.key, '2026-10-18');
  assert.deepEqual(today.events, []);
  assert.equal(today.older, '2026-10-17');
  assert.equal(today.newer, null);
});
