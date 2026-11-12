// Task-list ("- [ ]"/"- [x]") helpers for the Daily Sitrep preview, ported to
// the shared React lib. Fenced code blocks are skipped, matching marked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskLines, toggleTask, rebaseToggle } from '../frontend/src/lib/markdown.ts';

const md = [
  '# Sitrep',
  '- [ ] alpha',
  '  - [x] nested',
  '```',
  '- [ ] in code, not a checkbox',
  '```',
  '1. [ ] ordered',
  '> - [ ] quoted',
  '- plain bullet',
  '* [X] star',
].join('\n');

test('taskLines skips fenced code and finds -, *, ordered, nested, quoted items', () => {
  assert.deepEqual(taskLines(md), [1, 2, 6, 7, 9]);
  assert.deepEqual(taskLines(''), []);
});

test('toggleTask flips only the n-th item and leaves the rest byte-identical', () => {
  const on = toggleTask(md, 0, true);
  assert.equal(on.split('\n')[1], '- [x] alpha');
  assert.equal(on.split('\n')[2], '  - [x] nested');
  assert.equal(on.split('\n')[4], '- [ ] in code, not a checkbox');
  const off = toggleTask(md, 2, false);
  assert.equal(off.split('\n')[6], '1. [ ] ordered');
  const star = toggleTask(md, 4, false);
  assert.equal(star.split('\n')[9], '* [ ] star');
});

test('toggleTask returns null past the end or for a fenced item', () => {
  assert.equal(toggleTask(md, 5, true), null);
  const quoted = toggleTask(md, 3, true);
  assert.equal(quoted.split('\n')[7], '> - [x] quoted');
});

test('rebaseToggle applies the tick onto a fresh server copy', () => {
  const base = '- [ ] ship it\n- [ ] then rest';
  const fresh = '- [ ] ship it\n- [x] then rest (edited elsewhere)';
  const next = rebaseToggle(base, fresh, 0, true);
  assert.ok(next);
  assert.match(next, /- \[x\] ship it/);
  assert.match(next, /- \[x\] then rest/);
});

test('rebaseToggle refuses when the item is gone or ambiguous', () => {
  const base = '- [ ] a\n- [ ] a';
  const fresh = '- [ ] a';
  assert.equal(rebaseToggle(base, fresh, 0, true), null);
});

test('rebaseToggle targets the same occurrence among duplicates', () => {
  const base = '- [ ] a\n- [ ] a';
  const fresh = '- [ ] a\n- [ ] a';
  const next = rebaseToggle(base, fresh, 1, true);
  assert.ok(next);
  assert.deepEqual(next.split('\n'), ['- [ ] a', '- [x] a']);
});
