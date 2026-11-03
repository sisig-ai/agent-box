// Access logs: one nginx-style row per MCP tools/call, newest first.
// Alpine component: the markup lives in index.html, this file holds the data
// and the fetch. The router mounts it on first visit and Alpine polls only
// while the tab is up, so a hidden dashboard makes no requests.

import Alpine from '../alpine.js';

const POLL_MS = 4000;
const LIMIT = 300;

const clock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const day = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: '2-digit' });
};

async function get(path) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function logsView() {
  return {
    rows: [],
    tools: [],
    tool: '',
    ok: '',
    count: 0,
    total: 0,
    files: 0,
    retention: 7,
    status: 'loading…',
    failed: false,
    timer: 0,

    init() {
      this.refresh();
      this.timer = setInterval(() => this.poll(), POLL_MS);
      this.onVisible = () => { if (!document.hidden) this.poll(); };
      document.addEventListener('visibilitychange', this.onVisible);
    },

    destroy() {
      clearInterval(this.timer);
      document.removeEventListener('visibilitychange', this.onVisible);
    },

    // Poll only while the logs tab is the one on screen.
    poll() {
      if (document.body.dataset.view === 'logs' && !document.hidden) this.refresh();
    },

    clock,
    day,

    rowTitle(entry) {
      return `${entry.ts}\n${entry.args || '(no arguments)'}${entry.error ? `\n\nerror: ${entry.error}` : ''}`;
    },

    get summary() {
      return `${this.count} row${this.count === 1 ? '' : 's'} · ${this.total} total`
        + (this.tool ? ` · tool ${this.tool}` : '')
        + (this.ok ? ` · ${this.ok === '1' ? 'ok' : 'errors'}` : '')
        + ` · ${this.retention}d`
        + (this.files ? ` · ${this.files} file${this.files === 1 ? '' : 's'}` : '');
    },

    async refresh() {
      const params = new URLSearchParams({ limit: String(LIMIT) });
      if (this.tool) params.set('tool', this.tool);
      if (this.ok) params.set('ok', this.ok);
      try {
        const data = await get(`/api/logs?${params}`);
        const body = this.$refs.body;
        const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
        this.rows = data.entries || [];
        this.tools = data.tools || [];
        this.count = data.count || 0;
        this.total = data.total || 0;
        this.files = (data.files || []).length;
        this.retention = data.retention_days || 7;
        this.failed = false;
        this.status = `synced ${new Date().toLocaleTimeString([], { hour12: false })}`;
        if (atBottom) this.$nextTick(() => { body.scrollTop = 0; });
      } catch (err) {
        this.failed = true;
        this.status = `load failed: ${err.message}`;
      }
    },
  };
}

// Called by the router on first visit to #/logs.
export function mount(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  Alpine.data('logsView', logsView);
  el.setAttribute('x-data', 'logsView');
  Alpine.initTree(el);
}
