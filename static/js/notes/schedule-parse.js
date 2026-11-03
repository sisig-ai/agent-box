// Weekly schedule parsing: markdown headings mapped onto Mon-Sun columns.
// Pure functions, no DOM, so the shape stays testable.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const DOW = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

const isItemLine = (line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);

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

// Weekday name in a heading ("Monday", "mon", "Tue") -> 0..6 from Monday.
function weekdayColumn(heading) {
  const dw = heading.match(/\b(su[n]|mo[n]|tu[e]|we[d]|th[u]|fr[i]|sa[t])/i);
  if (!dw) return -1;
  return (DOW[dw[1].slice(0, 2).toLowerCase()] + 6) % 7;
}

// parse(content, mondayStr) -> { mapped, days: [{items}], extra }
export function parseSchedule(content, mondayStr) {
  const [wy, wm, wd] = mondayStr.split('-').map(Number);
  const mondayUTC = Date.UTC(wy, wm - 1, wd);
  const cells = [[], [], [], [], [], [], []];
  const mapped = [false, false, false, false, false, false, false];
  const extraLines = [];

  // Explicit month-day first ("Nov 4"), then a weekday name.
  const columnForDay = (heading) => {
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
    return weekdayColumn(heading);
  };

  const blocks = [];
  let cur = null;
  for (const line of (content || '').split(/\r?\n/)) {
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
    const col = columnForDay(block.heading);
    const items = itemsOf(block.lines);
    const isEmpty = items.length === 0 || items.every((it) => it.text.toLowerCase() === 'none');
    const residual = block.lines.filter((l) => l.trim() && !isItemLine(l));
    if (col === -1) {
      extraLines.push(block.raw, ...block.lines);
      continue;
    }
    if (residual.length) extraLines.push(block.raw, ...residual);
    if (!isEmpty) cells[col].push(...items);
    mapped[col] = true;
  }

  const labels = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(wy, wm - 1, wd + i);
    labels.push(d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
  }

  return {
    mapped: mapped.some(Boolean),
    days: cells.map((items, i) => ({ label: labels[i], items })),
    extra: extraLines.join('\n').trim(),
  };
}
