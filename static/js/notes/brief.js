// Daily Sitrep + weekly schedule. Alpine component; the markdown preview and
// the schedule extras are rendered HTML, so both bind with x-html.

import Alpine from '../alpine.js';
import { renderMarkdown } from './markdown.js';
import { taskLines, toggleTask, rebaseToggle } from './tasks.js';
import { parseSchedule } from './schedule-parse.js';

const pad = (n) => String(n).padStart(2, '0');

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function fmtDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

// Monday of the week containing dateStr.
function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() - (day - 1));
  return dt.toISOString().slice(0, 10);
}

function shiftWeek(weekStr, weeks) {
  const [y, m, d] = weekStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 7 * weeks)).toISOString().slice(0, 10);
}

function fmtWeek(weekStr) {
  const [y, m, d] = weekStr.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const fmt = (dt) => dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`;
}

const TOOLS = {
  h1: { line: '# ' },
  h2: { line: '## ' },
  h3: { line: '### ' },
  bold: { wrap: ['**', '**'], placeholder: 'bold text' },
  italic: { wrap: ['*', '*'], placeholder: 'italic text' },
  strike: { wrap: ['~~', '~~'], placeholder: 'struck text' },
  code: { wrap: ['`', '`'], placeholder: 'code' },
  codeblock: { wrap: ['\n```\n', '\n```\n'], placeholder: 'code block' },
  quote: { line: '> ' },
  ul: { line: '- ' },
  ol: { line: '1. ' },
  task: { line: '- [ ] ' },
  hr: { insert: '\n---\n' },
  link: { wrap: ['[', '](https://)'], placeholder: 'link text' },
  table: { insert: '\n| Column A | Column B |\n| --- | --- |\n| cell | cell |\n' },
};

export function briefView() {
  return {
    date: todayStr(),
    dateLabel: '',
    content: '',
    tab: 'preview',
    saveState: 'ready',
    saveClass: 'ready',
    wordText: '',
    dirty: false,
    lastSaved: '',
    saveTimer: null,
    scheduleWeek: weekStart(todayStr()),
    scheduleLabel: '',
    scheduleDays: [],
    scheduleExtra: '',
    scheduleMapped: false,
    scheduleEmpty: true,
    scheduleEmptyText: '// no schedule for this week yet',

    init() {
      this.load(this.date);
      this.loadSchedule(this.date);
      this.onBeforeUnload = () => {
        if (!this.dirty) return;
        navigator.sendBeacon('/api/sitrep', new Blob(
          [JSON.stringify({ date: this.date, content: this.content })],
          { type: 'application/json' },
        ));
      };
      window.addEventListener('beforeunload', this.onBeforeUnload);
    },

    destroy() {
      clearTimeout(this.saveTimer);
      window.removeEventListener('beforeunload', this.onBeforeUnload);
    },

    // ---- status + word count ----
    setSave(text, cls) {
      this.saveState = text;
      this.saveClass = cls;
      this.wordText = (() => {
        const t = this.content.trim();
        if (!t) return '';
        const words = t.split(/\s+/).filter(Boolean).length;
        return `${words} words · ${t.length} chars`;
      })();
    },

    get previewHtml() {
      if (typeof marked === 'undefined') {
        return '<p class="brief-empty">// marked.js failed to load — preview unavailable</p>';
      }
      if (!this.content.trim()) return '<p class="brief-empty">// nothing written yet</p>';
      const box = document.createElement('div');
      renderMarkdown(box, this.content);
      return box.innerHTML;
    },

    // ---- sitrep ----
    async load(dateStr) {
      if (this.dirty) await this.save();
      this.date = dateStr;
      this.dateLabel = fmtDayLabel(dateStr);
      this.setSave('loading…', 'ready');
      try {
        const res = await fetch(`/api/sitrep?date=${dateStr}`);
        const data = await res.json();
        this.content = data.content || '';
        this.lastSaved = this.content;
        this.dirty = false;
        this.setSave(`saved — ${data.content ? 'entry loaded' : 'no entry yet'}`, 'saved');
      } catch {
        this.setSave('load failed', 'error');
      }
    },

    async save() {
      const content = this.content;
      if (content === this.lastSaved && !this.dirty) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.setSave('saving…', 'saving');
      try {
        const res = await fetch('/api/sitrep', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: this.date, content }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.lastSaved = content;
        this.dirty = false;
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        this.setSave(`saved ${now}`, 'saved');
      } catch {
        this.setSave('save failed — retrying', 'error');
        this.dirty = true;
      }
    },

    onInput() {
      this.dirty = true;
      this.setSave('unsaved', 'ready');
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.save(), 900);
    },

    setTab(tab) {
      this.tab = tab;
    },

    // ---- toolbar ----
    onToolbar(event) {
      const btn = event.target.closest('button[data-md]');
      if (!btn) return;
      const spec = TOOLS[btn.dataset.md];
      if (spec) this.applyTool(spec);
    },

    applyTool(spec) {
      const el = this.$refs.editor;
      if (!el) return;
      if (spec.line) {
        const lineStart = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1;
        el.setRangeText(spec.line, lineStart, lineStart, 'end');
      } else if (spec.insert) {
        el.setRangeText(spec.insert, el.selectionStart, el.selectionStart, 'end');
      } else if (spec.wrap) {
        const [before, after] = spec.wrap;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const sel = el.value.slice(start, end) || (spec.placeholder || '');
        el.setRangeText(before + sel + after, start, end, 'end');
      }
      el.focus();
      this.onInput();
    },

    // ---- task checkbox in the preview ----
    async onPreviewChange(event) {
      const cb = event.target;
      if (!cb || cb.tagName !== 'INPUT' || cb.type !== 'checkbox') return;
      const boxes = Array.from(this.$refs.preview.querySelectorAll('li input[type="checkbox"]'));
      const n = boxes.indexOf(cb);
      const checked = cb.checked;
      const date = this.date;
      const base = this.content;
      if (n < 0 || boxes.length !== taskLines(base).length) {
        cb.checked = !checked;
        this.setSave('checkbox not mapped — tick it in Edit', 'error');
        return;
      }
      let next = null;
      if (this.dirty) {
        next = toggleTask(base, n, checked);
      } else {
        this.setSave('syncing…', 'saving');
        let fresh = base;
        try {
          const res = await fetch(`/api/sitrep?date=${date}`, { cache: 'no-store' });
          if (res.ok) fresh = (await res.json()).content || '';
        } catch { /* offline: use what we have */ }
        if (date !== this.date) return;
        if (this.content !== base) {
          next = toggleTask(this.content, n, checked);
        } else if (fresh === base) {
          next = toggleTask(base, n, checked);
        } else {
          next = rebaseToggle(base, fresh, n, checked);
          this.lastSaved = fresh;
          if (next === null) {
            this.content = fresh;
            this.setSave('sitrep changed elsewhere — reloaded, tick again', 'error');
            return;
          }
        }
      }
      if (next === null) { cb.checked = !checked; return; }
      this.content = next;
      this.dirty = true;
      await this.save();
    },

    prev() { this.load(shiftDate(this.date, -1)); },
    next() { this.load(shiftDate(this.date, 1)); },
    today() { this.load(todayStr()); },

    // ---- schedule ----
    async loadSchedule(dateStr) {
      this.scheduleWeek = weekStart(dateStr);
      this.scheduleLabel = fmtWeek(this.scheduleWeek);
      try {
        const res = await fetch(`/api/schedule?week=${this.scheduleWeek}`);
        const data = await res.json();
        this.applySchedule(data.content || '');
      } catch {
        this.scheduleEmpty = true;
        this.scheduleEmptyText = '// failed to load schedule';
      }
    },

    applySchedule(content) {
      if (!content.trim()) {
        this.scheduleEmpty = true;
        this.scheduleEmptyText = '// no schedule for this week yet';
        this.scheduleMapped = false;
        this.scheduleExtra = '';
        return;
      }
      if (typeof marked === 'undefined') {
        this.scheduleEmpty = true;
        this.scheduleEmptyText = '// marked.js failed to load';
        return;
      }
      const parsed = parseSchedule(content, this.scheduleWeek);
      this.scheduleMapped = parsed.mapped;
      this.scheduleDays = parsed.days;
      this.scheduleExtra = parsed.extra;
      this.scheduleEmpty = !parsed.mapped && !parsed.extra;
      this.scheduleEmptyText = '// no schedule for this week yet';
    },

    get todayOffset() {
      const [wy, wm, wd] = this.scheduleWeek.split('-').map(Number);
      const [ty, tm, td] = todayStr().split('-').map(Number);
      return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(wy, wm - 1, wd)) / 86400000);
    },

    get scheduleExtraHtml() {
      if (!this.scheduleExtra) return '';
      const box = document.createElement('div');
      renderMarkdown(box, this.scheduleExtra);
      return box.innerHTML;
    },

    weekPrev() { this.loadSchedule(shiftWeek(this.scheduleWeek, -1)); },
    weekNext() { this.loadSchedule(shiftWeek(this.scheduleWeek, 1)); },
    weekNow() { this.loadSchedule(todayStr()); },

    // Cmd/Ctrl+S, Cmd/Ctrl+B/I and Tab inside the textarea.
    onEditorKey(event) {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key === 's') { event.preventDefault(); this.save(); }
      if (mod && event.key === 'b') { event.preventDefault(); this.applyTool(TOOLS.bold); }
      if (mod && event.key === 'i') { event.preventDefault(); this.applyTool(TOOLS.italic); }
      if (event.key === 'Tab') {
        event.preventDefault();
        const el = event.target;
        el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
        this.onInput();
      }
    },
  };
}

export function mount(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  Alpine.data('briefView', briefView);
  delete el._x_ignore;
  delete el._x_ignoreSelf;
  Alpine.mutateDom(() => {
    el.removeAttribute('x-ignore');
    el.setAttribute('x-data', 'briefView');
  });
  Alpine.initTree(el);
}
