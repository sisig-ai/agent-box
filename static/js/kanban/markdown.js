// Card-body markdown for the Kanban modal: vendored marked (window.marked,
// loaded as a classic script in index.html) + vendored DOMPurify (loaded
// lazily here). Bodies are agent/user authored and the stack has no auth, so
// every render goes through DOMPurify before innerHTML.
import { sanitizeHtml } from '../notes/markdown.js';

const PURIFY_VERSION = '3.2.6';
let purifyLoad = null;

export function loadPurify() {
  if (window.DOMPurify) return Promise.resolve(window.DOMPurify);
  purifyLoad ||= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `/static/vendor/dompurify/purify.min.js?v=${PURIFY_VERSION}`;
    s.onload = () => resolve(window.DOMPurify || null);
    s.onerror = () => resolve(null);
    document.head.append(s);
  });
  return purifyLoad;
}

function toHtml(md) {
  if (typeof marked === 'undefined') {
    const p = document.createElement('pre');
    p.textContent = md;
    return p.outerHTML;
  }
  return marked.parse(md, { gfm: true, breaks: true });
}

// Render `md` into `el`. Task checkboxes get data-task=<n> (their index among
// the body's task items) and stay enabled only when `interactive`.
export function renderBody(el, md, interactive) {
  const html = toHtml(md);
  const purify = window.DOMPurify;
  el.innerHTML = purify
    ? purify.sanitize(html, { FORBID_TAGS: ['style', 'form'], FORBID_ATTR: ['style'] })
    : sanitizeHtml(html);
  el.querySelectorAll('a[href]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  el.querySelectorAll('li input[type="checkbox"]').forEach((cb, i) => {
    cb.dataset.task = String(i);
    cb.disabled = !interactive;
  });
}

const FENCE = /^\s{0,3}(```|~~~)/;
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

// Flip the n-th task-list checkbox in the markdown source (code fences skipped,
// matching how marked numbers them). Returns the new source, or null.
export function toggleTask(md, n, checked) {
  const lines = md.split('\n');
  let fenced = false, seen = -1;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) { fenced = !fenced; continue; }
    if (fenced || !TASK.test(lines[i])) continue;
    if (++seen === n) {
      lines[i] = lines[i].replace(TASK, (_, a, _b, c) => `${a}${checked ? 'x' : ' '}${c}`);
      return lines.join('\n');
    }
  }
  return null;
}
