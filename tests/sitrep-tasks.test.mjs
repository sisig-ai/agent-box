import test from 'node:test';
import assert from 'node:assert/strict';
import { taskLines, toggleTask, rebaseToggle } from '../static/js/notes/tasks.js';

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
  assert.equal(on.split('\n')[4], '- [ ] in code, not a checkbox');
  assert.equal(toggleTask(on, 0, false), md);
  assert.equal(toggleTask(md, 1, false).split('\n')[2], '  - [ ] nested');
  assert.equal(toggleTask(md, 2, true).split('\n')[6], '1. [x] ordered');
  assert.equal(toggleTask(md, 3, true).split('\n')[7], '> - [x] quoted');
  assert.equal(toggleTask(md, 4, false).split('\n')[9], '* [ ] star');
  assert.equal(toggleTask(md, 5, true), null);
});

test('rebaseToggle applies the tick to a newer server copy by item text', () => {
  const fresh = '# Rewritten\n- [ ] new item\n- [ ] alpha\n- [ ] beta';
  assert.equal(rebaseToggle(md, fresh, 0, true), '# Rewritten\n- [ ] new item\n- [x] alpha\n- [ ] beta');
  assert.equal(rebaseToggle(md, '- [ ] gone', 0, true), null);
});

test('rebaseToggle keeps duplicate items apart by occurrence', () => {
  const base = '- [ ] dup\n- [ ] dup';
  assert.equal(rebaseToggle(base, '- [ ] x\n- [ ] dup\n- [ ] dup', 1, true), '- [ ] x\n- [ ] dup\n- [x] dup');
  assert.equal(rebaseToggle(base, '- [ ] dup', 1, true), null);
});

test('checkbox numbering matches what the vendored marked actually renders', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const src = await readFile(new URL('../static/vendor/marked.min.js', import.meta.url), 'utf8');
  const ctx = { globalThis: {}, window: {} };
  ctx.self = ctx.globalThis;
  vm.runInNewContext(src, ctx);
  const marked = ctx.marked || ctx.globalThis.marked || ctx.window.marked;
  assert.ok(marked, 'marked loaded');
  const samples = [md, '- [ ]\n- [ ]no space\n- [x] ok', '~~~\n- [ ] x\n~~~\n- [ ] y', ''];
  for (const s of samples) {
    const html = marked.parse(s, { gfm: true, breaks: true });
    const rendered = (html.match(/<input[^>]*type="checkbox"/g) || []).length;
    assert.equal(rendered, taskLines(s).length, `count mismatch for ${JSON.stringify(s)}`);
  }
});
