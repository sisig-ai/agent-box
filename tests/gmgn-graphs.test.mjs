import test from 'node:test';
import assert from 'node:assert/strict';
import { pnlSeries, WINDOWS } from '../static/js/gmgn-graphs.js';

const end = 1792149427;
const trade = (ts, pnl_sol) => ({ kind: 'trade', ts, pnl_sol });

test('card windows include both endpoints with the required sample spacing', () => {
  for (const [key, duration, interval, count] of [
    ['h12', 43200, 1800, 25], ['d1', 86400, 3600, 25], ['d7', 604800, 43200, 15],
  ]) {
    const points = pnlSeries([], end, WINDOWS[key]);
    assert.equal(points.length, count);
    assert.equal(points[0].ts, end - duration);
    assert.equal(points.at(-1).ts, end);
    assert.ok(points.every((point, i) => i === 0 || point.ts - points[i - 1].ts === interval));
    assert.ok(points.every((point) => point.value === 0));
  }
});

test('cumulative sums include exact boundaries once and retain flat periods', () => {
  const start = end - 43200;
  const input = [trade(end, -1), trade(start + 1801, 3), trade(start, 2), trade(start - 1, 99),
    trade(start + 1800, -0.5), trade(end + 1, 99)];
  const original = input.slice();
  const points = pnlSeries(input, end, WINDOWS.h12);
  assert.deepEqual(points.slice(0, 4).map((point) => point.value), [2, 1.5, 4.5, 4.5]);
  assert.equal(points.at(-2).value, 4.5);
  assert.equal(points.at(-1).value, 3.5);
  assert.deepEqual(input, original);
});

test('mixed timestamp units and numeric pnl strings retain the actual result', () => {
  const points = pnlSeries([trade(end * 1000, '0.2'), trade(end - 1800, -0.1), trade(end, 0)], end * 1000, WINDOWS.h12);
  assert.equal(points.at(-2).value, -0.1);
  assert.equal(points.at(-1).value, 0.1);
});

test('stops, opens, unusable timestamps, and missing or nonfinite pnl contribute nothing', () => {
  const events = [
    { ...trade(end, 1), kind: 'stop' }, { ...trade(end, 2), kind: 'open' },
    ...[undefined, null, 0, -1, 'bad', 1e30].map((ts) => trade(ts, 3)),
    ...[undefined, null, '', ' ', true, {}, Infinity, NaN, 'bad'].map((pnl) => trade(end, pnl)),
    trade(end + 1, 10), trade(end - 604801, 10), trade(end, -2),
  ];
  for (const window of Object.values(WINDOWS)) {
    const points = pnlSeries(events, end, window);
    assert.ok(points.slice(0, -1).every((point) => point.value === 0));
    assert.equal(points.at(-1).value, -2);
  }
});

test('positive and negative recorded histories keep their signs without rescaling', () => {
  assert.equal(pnlSeries([trade(end, 7)], end, WINDOWS.d1).at(-1).value, 7);
  assert.equal(pnlSeries([trade(end, -9)], end, WINDOWS.d1).at(-1).value, -9);
  assert.equal(pnlSeries([trade(end, -9), trade(end, 9)], end, WINDOWS.d1).at(-1).value, 0);
});

test('missing or invalid feed metadata returns an unavailable result', () => {
  for (const generated of [undefined, null, 0, -1, 'bad', Infinity, 1e30]) {
    assert.equal(pnlSeries([], generated, WINDOWS.d1), null);
  }
  assert.equal(pnlSeries(undefined, end, WINDOWS.d1), null);
  assert.equal(pnlSeries({}, end, WINDOWS.d1), null);
});
