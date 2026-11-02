// Process table inside the memory panel: top processes by memory or CPU,
// with SIGTERM / SIGKILL per pid. Polls only while the memory card is open.
import { $ } from '../dom.js';
import { openModal } from '../modal.js';

const LIMIT = 40;
const POLL_MS = 2000;

const tbody = $('procs-body');
const meta = $('procs-meta');
const sortButtons = Array.from(document.querySelectorAll('.procs-sort'));

let sortKey = 'rss';
let sortOrder = 'desc';
let open = false;
let inflight = false;
let queued = false;
let timer = null;
let errorShown = false;

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const gib = bytes / 1073741824;
  if (gib >= 1) return `${gib.toFixed(2)}G`;
  return `${Math.round(bytes / 1048576)}M`;
}

function setMeta(text, bad) {
  if (!meta) return;
  meta.textContent = text;
  meta.classList.toggle('is-bad', !!bad);
}

function syncSortButtons() {
  for (const btn of sortButtons) {
    const active = btn.dataset.sort === sortKey;
    btn.setAttribute('aria-pressed', String(active));
    btn.textContent = active
      ? `${btn.dataset.sort === 'rss' ? 'mem' : 'cpu%'} ${sortOrder === 'desc' ? '▼' : '▲'}`
      : (btn.dataset.sort === 'rss' ? 'mem' : 'cpu%');
  }
}

function cell(text, cls, title) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  if (title) td.title = title;
  return td;
}

function signalButton(row, sig) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'p-signal';
  btn.dataset.sig = sig;
  btn.textContent = sig === 'KILL' ? 'kill' : 'term';
  btn.title = row.protected
    ? `pid ${row.pid} is init or the dashboard itself: refused`
    : `send SIG${sig} to pid ${row.pid}`;
  btn.disabled = row.protected;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    sendSignal(row, sig);
  });
  return btn;
}

function renderRow(row) {
  const tr = document.createElement('tr');
  tr.appendChild(cell(String(row.pid), 'p-pid'));
  tr.appendChild(cell(row.name, 'p-name', row.cmdline));
  tr.appendChild(cell(row.cpu_percent.toFixed(1), 'p-num'));
  tr.appendChild(cell(fmtBytes(row.rss_bytes), 'p-num', `${row.user} · ${row.status} · ${row.mem_percent}% of ram`));
  const sig = cell('', 'p-sig');
  sig.appendChild(signalButton(row, 'TERM'));
  sig.appendChild(document.createTextNode(' '));
  sig.appendChild(signalButton(row, 'KILL'));
  tr.appendChild(sig);
  return tr;
}

function render(data) {
  if (!tbody) return;
  tbody.replaceChildren(...data.procs.map(renderRow));
  const shown = data.procs.length;
  setMeta(`${shown} of ${data.total} · ${data.sort === 'rss' ? 'mem' : data.sort === 'cpu' ? 'cpu' : data.sort} ${data.order} · ${data.cpu_sample_s}s sample`);
}

async function refresh() {
  if (!open) return;
  if (inflight) {
    queued = true; // a refresh landed mid-flight; rerun once it settles
    return;
  }
  if (document.hidden) return;
  inflight = true;
  try {
    const res = await fetch(`/api/procs?sort=${sortKey}&order=${sortOrder}&limit=${LIMIT}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data);
    errorShown = false;
  } catch (err) {
    if (!errorShown) setMeta(`procs unavailable · ${err.message}`, true);
    errorShown = true;
  } finally {
    inflight = false;
    if (queued) {
      queued = false;
      refresh();
    }
  }
}

async function sendSignal(row, sig) {
  const label = `SIG${sig}`;
  const ok = await openModal({
    title: `${label.toLowerCase()} → ${row.pid} ${row.name}`,
    text: `${row.cmdline.slice(0, 160)}\n\n${sig === 'KILL'
      ? 'SIGKILL cannot be caught or ignored: the process dies at once and unsaved work is lost.'
      : 'SIGTERM asks the process to exit cleanly; it may ignore the signal.'}`,
    ok: label,
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/procs/${row.pid}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal: sig }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setMeta(`${label} sent to ${row.pid} ${row.name}`);
  } catch (err) {
    setMeta(`${label} failed · ${err.message}`, true);
    errorShown = true;
  }
  // A killed pid disappears from the next snapshot; give it a moment to exit.
  setTimeout(refresh, sig === 'KILL' ? 350 : 900);
}

for (const btn of sortButtons) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const key = btn.dataset.sort;
    if (key === sortKey) {
      sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    } else {
      sortKey = key;
      sortOrder = 'desc';
    }
    syncSortButtons();
    setMeta(`sorting by ${key === 'rss' ? 'mem' : key} …`);
    refresh();
  });
}

export function procsStart() {
  open = true;
  syncSortButtons();
  setMeta('loading…');
  refresh();
  clearInterval(timer);
  timer = setInterval(refresh, POLL_MS);
}

export function procsStop() {
  open = false;
  clearInterval(timer);
  timer = null;
}

// A background tab keeps no timers running; catch up when it comes back.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && open) refresh();
});
