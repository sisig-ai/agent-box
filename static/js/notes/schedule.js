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

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const DOW = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
  const EMPTY_HTML = '<p class="schedule-empty">// no schedule for this week yet</p>';

  // Split markdown into heading blocks. `mapped[i]` records that a block lands
  // in column i, so a week of headings with no items still renders the grid.
  function parse(content, weekStr) {
    const [wy, wm, wd] = weekStr.split('-').map(Number);
    const mondayUTC = Date.UTC(wy, wm - 1, wd);
    const cells = [[], [], [], [], [], [], []];
    const mapped = [false, false, false, false, false, false, false];
    const extraLines = [];

    function itemsOf(lines) {
      const out = [];
      for (const line of lines) {
        const m = line.match(/^[-*]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
        if (!m) continue;
        let text = m[1].trim();
        let done = false;
        const cb = text.match(/^\[([ xX])\]\s*(.*)$/);
        if (cb) {
          done = cb[1].toLowerCase() === 'x';
          text = cb[2].trim();
        }
        out.push({ text, done });
      }
      return out;
    }

    const isItemLine = (line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);

    // Column for a heading: explicit month-day first, weekday name second.
    // Out-of-week dates (and non-day headings) return -1 and stay in extra.
    function columnFor(heading) {
      if (/^week\s+of\b/i.test(heading)) return -1;
      const dm = heading.match(/([a-z]{3,9})\.?\s+(\d{1,2})\b/i);
      if (dm) {
        const mon = MONTHS[dm[1].slice(0, 3).toLowerCase()];
        if (mon !== undefined) {
          const day = Number(dm[2]);
          let year = wy;
          if (mon === 0 && wm === 12) year = wy + 1;
          if (mon === 11 && wm === 1) year = wy - 1;
          const off = Math.round((Date.UTC(year, mon, day) - mondayUTC) / 86400000);
          return off >= 0 && off <= 6 ? off : -1;
        }
      }
      const dw = heading.match(/\b(su[n]|mo[n]|tu[e]|we[d]|th[u]|fr[i]|sa[t])/i);
      if (dw) return (DOW[dw[1].slice(0, 2).toLowerCase()] + 6) % 7;
      return -1;
    }

    const blocks = [];
    let cur = null;
    for (const line of content.split(/\r?\n/)) {
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        cur = { raw: line, heading: h[2].trim(), lines: [] };
        blocks.push(cur);
      } else if (cur) {
        cur.lines.push(line);
      } else {
        cur = { raw: null, heading: null, lines: [line] };
        blocks.push(cur);
      }
    }

    for (const block of blocks) {
      if (block.heading === null) {
        extraLines.push(...block.lines);
        continue;
      }
      const col = columnFor(block.heading);
      const items = itemsOf(block.lines);
      const isEmpty = items.length === 0 || items.every((it) => it.text.toLowerCase() === 'none');
      // Non-item lines (day paragraphs, wrapped continuation, nested bullets)
      // stay visible in the sanitized markdown block.
      const residual = block.lines.filter((l) => l.trim() && !isItemLine(l));
      if (col === -1) {
        extraLines.push(block.raw, ...block.lines);
        continue;
      }
      if (residual.length) extraLines.push(block.raw, ...residual);
      if (isEmpty) {
        mapped[col] = true;
      } else {
        cells[col].push(...items);
        mapped[col] = true;
      }
    }

    return { cells, mapped, extra: extraLines.join('\n').trim() };
  }

  function render(content) {
    if (!content || !content.trim()) {
      preview.innerHTML = EMPTY_HTML;
      return;
    }
    if (typeof marked === 'undefined') {
      preview.innerHTML = '<p class="schedule-empty">// marked.js failed to load</p>';
      return;
    }
    const parsed = parse(content, currentWeek);
    if (!parsed.mapped.some(Boolean) && !parsed.extra) {
      preview.innerHTML = EMPTY_HTML;
      return;
    }

    const [wy, wm, wd] = currentWeek.split('-').map(Number);
    const [ty, tm, td] = todayStr().split('-').map(Number);
    const todayOff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(wy, wm - 1, wd)) / 86400000);

    preview.textContent = '';

    if (parsed.mapped.some(Boolean)) {
      const wrap = document.createElement('div');
      wrap.className = 'schedule-calendar';

      const dow = document.createElement('div');
      dow.className = 'cal-dow';
      for (const name of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
        const cell = document.createElement('div');
        cell.className = 'cal-dow-cell';
        cell.textContent = name;
        dow.appendChild(cell);
      }
      wrap.appendChild(dow);

      const days = document.createElement('div');
      days.className = 'cal-days';
      for (let i = 0; i < 7; i++) {
        const day = document.createElement('div');
        day.className = 'cal-day';
        if (i >= 5) day.classList.add('cal-weekend');
        if (i === todayOff) day.classList.add('cal-today');

        const num = document.createElement('div');
        num.className = 'cal-num';
        num.textContent = String(new Date(Date.UTC(wy, wm - 1, wd + i)).getUTCDate());
        day.appendChild(num);

        const events = document.createElement('div');
        events.className = 'cal-events';
        const list = parsed.cells[i];
        if (!list.length) {
          const none = document.createElement('div');
          none.className = 'cal-event cal-event-empty';
          none.textContent = '—';
          events.appendChild(none);
        } else {
          for (const item of list) {
            const row = document.createElement('div');
            row.className = item.done ? 'cal-event cal-event-done' : 'cal-event';
            row.textContent = item.text;
            events.appendChild(row);
          }
        }
        day.appendChild(events);
        days.appendChild(day);
      }
      wrap.appendChild(days);
      preview.appendChild(wrap);
    }

    if (parsed.extra) {
      const extra = document.createElement('div');
      extra.className = 'schedule-extra';
      preview.appendChild(extra);
      renderMarkdown(extra, parsed.extra);
    }
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
