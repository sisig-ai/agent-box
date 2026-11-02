// Access logs: one nginx-style row per MCP tools/call.
// Polls only while the view is up; filters run server-side so the log can grow
// without the page holding all of it.
const $ = (id) => document.getElementById(id);
const POLL_MS = 4000;
const LIMIT = 300;

const state = { tool: '', ok: '', busy: false, started: false, timer: 0 };

async function api(path) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const day = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? ''
    : d.toLocaleDateString([], { month: 'short', day: '2-digit' });
};

function setStatus(text, isError) {
  const node = $('logs-status');
  node.textContent = text;
  node.classList.toggle('err', !!isError);
}

function row(entry) {
  const tr = el('tr', entry.ok ? 'lg-ok' : 'lg-err');
  tr.title = `${entry.ts}\n${entry.args || '(no arguments)'}${entry.error ? `\n\nerror: ${entry.error}` : ''}`;

  const time = el('td', 'lg-time');
  time.append(el('span', 'lg-clock', clock(entry.ts)), el('span', 'lg-day', day(entry.ts)));
  tr.append(time);
  tr.append(el('td', 'lg-action', entry.tool));
  tr.append(el('td', 'lg-entity', entry.entity || '—'));
  tr.append(el('td', 'lg-ms', String(entry.ms)));
  const status = el('td', 'lg-status');
  status.append(el('span', entry.ok ? 'lg-pill ok' : 'lg-pill err', entry.ok ? 'ok' : 'err'));
  tr.append(status);
  tr.append(el('td', 'lg-args', entry.error ? `error: ${entry.error}` : (entry.args || '')));
  return tr;
}

function paintTools(tools) {
  const sel = $('logs-tool');
  if (document.activeElement === sel) return; // never rebuild an open dropdown
  const current = state.tool;
  const options = [['', 'all tools'], ...tools.map((tool) => [tool, tool])];
  if (current && !tools.includes(current)) options.push([current, current]);
  sel.replaceChildren(...options.map(([value, label]) => {
    const option = el('option', '', label);
    option.value = value;
    option.selected = value === current;
    return option;
  }));
  sel.classList.toggle('active', !!current);
}

async function refresh() {
  if (state.busy) return;
  if (document.body.dataset.view !== 'logs') return;
  state.busy = true;
  try {
    const params = new URLSearchParams({ limit: String(LIMIT) });
    if (state.tool) params.set('tool', state.tool);
    if (state.ok) params.set('ok', state.ok);
    const data = await api(`/api/logs?${params}`);
    const body = $('logs-rows');
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    body.replaceChildren(...data.entries.map(row));
    paintTools(data.tools);
    $('logs-empty').hidden = data.entries.length > 0;
    const files = (data.files || []).length;
    $('logs-count').textContent =
      `${data.count} row${data.count === 1 ? '' : 's'} · ${data.total} total`
      + (state.tool ? ` · tool ${state.tool}` : '')
      + (state.ok ? ` · ${state.ok === '1' ? 'ok' : 'errors'}` : '')
      + ` · ${data.retention_days || 7}d`
      + (files ? ` · ${files} file${files === 1 ? '' : 's'}` : '');
    setStatus(`synced ${new Date().toLocaleTimeString([], { hour12: false })}`);
    if (atBottom) body.scrollTop = 0;
  } catch (err) {
    setStatus(`load failed: ${err.message}`, true);
  } finally {
    state.busy = false;
  }
}

function schedule() {
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (document.body.dataset.view === 'logs' && !document.hidden) refresh();
  }, POLL_MS);
}

function bind() {
  $('logs-tool').addEventListener('change', (e) => { state.tool = e.target.value; refresh(); });
  $('logs-ok').addEventListener('change', (e) => { state.ok = e.target.value; refresh(); });
  $('logs-refresh').addEventListener('click', () => refresh());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.body.dataset.view === 'logs') refresh();
  });
}

export function initLogs() {
  if (!state.started) {
    state.started = true;
    bind();
    schedule();
  }
  refresh();
}
