// Weekly schedule side panel: markdown for the selected week.
import { $ } from '../dom.js';
import { renderMarkdown } from './markdown.js';

/* ================= Weekly Schedule ================= */
(() => {
  const preview = $('schedule-preview');
  const weekLabel = $('schedule-week-label');

  if (!preview) return; // schedule section missing — bail silently

  let currentWeek = null; // Monday (YYYY-MM-DD)

  const pad = (n) => String(n).padStart(2, '0');

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Monday of the week containing dateStr
  function weekStart(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = dt.getUTCDay() || 7; // Mon=1..Sun=7
    dt.setUTCDate(dt.getUTCDate() - (day - 1));
    return dt.toISOString().slice(0, 10);
  }

  function shiftWeek(weekStr, weeks) {
    const [y, m, d] = weekStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 7 * weeks));
    return dt.toISOString().slice(0, 10);
  }

  function fmtWeek(weekStr) {
    const [y, m, d] = weekStr.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(y, m - 1, d + 6);
    const sameMonth = start.getMonth() === end.getMonth();
    const fmt = (dt) => dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return sameMonth
      ? `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`
      : `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`;
  }

  function render(content) {
    if (!content || !content.trim()) {
      preview.innerHTML = '<p class="schedule-empty">// no schedule for this week yet</p>';
      return;
    }
    if (typeof marked === 'undefined') {
      preview.innerHTML = '<p class="schedule-empty">// marked.js failed to load</p>';
      return;
    }
    renderMarkdown(preview, content);
  }

  async function loadSchedule(weekStr) {
    currentWeek = weekStart(weekStr);
    weekLabel.textContent = fmtWeek(currentWeek);
    try {
      const res = await fetch(`/api/schedule?week=${currentWeek}`);
      const data = await res.json();
      render(data.content || '');
    } catch (err) {
      preview.innerHTML = '<p class="schedule-empty">// failed to load schedule</p>';
    }
  }

  $('sched-prev').addEventListener('click', () => loadSchedule(shiftWeek(currentWeek, -1)));
  $('sched-next').addEventListener('click', () => loadSchedule(shiftWeek(currentWeek, 1)));
  $('sched-now').addEventListener('click', () => loadSchedule(todayStr()));

  loadSchedule(todayStr());
})();
