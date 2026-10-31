// Task-list ("- [ ]" / "- [x]") helpers for the Daily Sitrep preview.
// Pure string functions (no DOM) so they run under `node --test` too.
// Mirrors kanban/markdown.js toggleTask: checkboxes are numbered in source
// order, skipping fenced code blocks, which is how marked renders them.

const FENCE = /^\s{0,3}(?:>\s*)*(```|~~~)/;
const TASK = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])(?=\s)/;

// Line indexes of every task-list item outside code fences, in order.
export function taskLines(md) {
  const out = [];
  let fenced = false;
  (md || '').split('\n').forEach((line, i) => {
    if (FENCE.test(line)) { fenced = !fenced; return; }
    if (!fenced && TASK.test(line)) out.push(i);
  });
  return out;
}

function setLine(lines, i, checked) {
  lines[i] = lines[i].replace(TASK, (_, a, _b, c) => `${a}${checked ? 'x' : ' '}${c}`);
  return lines.join('\n');
}

// Flip the n-th task checkbox. Returns the new markdown, or null if no such task.
export function toggleTask(md, n, checked) {
  const idx = taskLines(md)[n];
  if (idx === undefined) return null;
  return setLine((md || '').split('\n'), idx, checked);
}

// The task's text with its checkbox state blanked, used to find it again.
const key = (line) => line.replace(TASK, '$1?$3').trim();

// Apply "set task n of `base` to `checked`" onto `fresh` (the server's newer
// copy). Finds the same item by its text (same occurrence among duplicates).
// Returns the new markdown, or null when the item is gone or ambiguous.
export function rebaseToggle(base, fresh, n, checked) {
  const bLines = (base || '').split('\n');
  const bTasks = taskLines(base);
  if (bTasks[n] === undefined) return null;
  const k = key(bLines[bTasks[n]]);
  const occurrence = bTasks.slice(0, n).filter((i) => key(bLines[i]) === k).length;
  const fLines = (fresh || '').split('\n');
  const matches = taskLines(fresh).filter((i) => key(fLines[i]) === k);
  const bCount = bTasks.filter((i) => key(bLines[i]) === k).length;
  if (matches.length !== bCount || matches[occurrence] === undefined) return null;
  return setLine(fLines, matches[occurrence], checked);
}
