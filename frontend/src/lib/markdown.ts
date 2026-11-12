// Markdown rendering with sanitization, shared by every preview.
// Uses DOMParser denylist (same policy as the old sanitizeHtml): strip
// active content but keep innocuous markup, notably task checkboxes.

import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  body.querySelectorAll("script, style, iframe, object, embed, link, meta, base, form")
    .forEach((el) => el.remove());
  const urlAttrs = ["href", "src", "xlink:href"];
  body.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) { el.removeAttribute(attr.name); continue; }
      if (urlAttrs.includes(name)) {
        const value = attr.value.replace(/[\u0000- ]+/g, "").toLowerCase();
        if (/^(javascript|data|vbscript):/.test(value)) el.removeAttribute(attr.name);
      }
    }
  });
  return body.innerHTML;
}

export function renderMarkdown(md: string): string {
  return sanitizeHtml(marked.parse(md, { async: false }) as string);
}

/* ----- task-list ("- [ ]") helpers: pure string functions ----- */

const FENCE = /^\s{0,3}(?:>\s*)*(```|~~~)/;
const TASK = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])(?=\s)/;

export function taskLines(md: string): number[] {
  const out: number[] = [];
  let fenced = false;
  (md || "").split("\n").forEach((line, i) => {
    if (FENCE.test(line)) { fenced = !fenced; return; }
    if (!fenced && TASK.test(line)) out.push(i);
  });
  return out;
}

function setLine(lines: string[], i: number, checked: boolean): string {
  lines[i] = lines[i].replace(TASK, (_, a: string, _b: string, c: string) => `${a}${checked ? "x" : " "}${c}`);
  return lines.join("\n");
}

export function toggleTask(md: string, n: number, checked: boolean): string | null {
  const idx = taskLines(md)[n];
  if (idx === undefined) return null;
  return setLine((md || "").split("\n"), idx, checked);
}

const key = (line: string) => line.replace(TASK, "$1?$3").trim();

export function rebaseToggle(base: string, fresh: string, n: number, checked: boolean): string | null {
  const bLines = (base || "").split("\n");
  const bTasks = taskLines(base);
  if (bTasks[n] === undefined) return null;
  const k = key(bLines[bTasks[n]]);
  const occurrence = bTasks.slice(0, n).filter((i) => key(bLines[i]) === k).length;
  const fLines = (fresh || "").split("\n");
  const matches = taskLines(fresh).filter((i) => key(fLines[i]) === k);
  const bCount = bTasks.filter((i) => key(bLines[i]) === k).length;
  if (matches.length !== bCount || matches[occurrence] === undefined) return null;
  return setLine(fLines, matches[occurrence], checked);
}

/* ----- weekly schedule parsing: headings mapped onto Mon-Sun columns ----- */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const DOW: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

const isItemLine = (line: string) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);

export interface ScheduleItem { text: string; done: boolean }
export interface ScheduleDay { label: string; items: ScheduleItem[] }
export interface ParsedSchedule { mapped: boolean; days: ScheduleDay[]; extra: string }

function itemsOf(lines: string[]): ScheduleItem[] {
  const out: ScheduleItem[] = [];
  for (const line of lines) {
    const m = line.match(/^[-*]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
    if (!m) continue;
    let text = m[1].trim();
    let done = false;
    const cb = text.match(/^\[([ xX])\]\s*(.*)$/);
    if (cb) {
      done = cb[1].toLowerCase() === "x";
      text = cb[2].trim();
    }
    out.push({ text, done });
  }
  return out;
}

function weekdayColumn(heading: string): number {
  const dw = heading.match(/\b(su[n]|mo[n]|tu[e]|we[d]|th[u]|fr[i]|sa[t])/i);
  if (!dw) return -1;
  return (DOW[dw[1].slice(0, 2).toLowerCase()] + 6) % 7;
}

export function parseSchedule(content: string, mondayStr: string): ParsedSchedule {
  const [wy, wm, wd] = mondayStr.split("-").map(Number);
  const mondayUTC = Date.UTC(wy, wm - 1, wd);
  const cells: ScheduleItem[][] = [[], [], [], [], [], [], []];
  const mapped = [false, false, false, false, false, false, false];
  const extraLines: string[] = [];

  const columnForDay = (heading: string): number => {
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

  const blocks: { raw: string | null; heading: string | null; lines: string[] }[] = [];
  let cur: { raw: string | null; heading: string | null; lines: string[] } | null = null;
  for (const line of (content || "").split(/\r?\n/)) {
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
    const isEmpty = items.length === 0 || items.every((it) => it.text.toLowerCase() === "none");
    const residual = block.lines.filter((l) => l.trim() && !isItemLine(l));
    if (col === -1) {
      extraLines.push(block.raw || "", ...block.lines);
      continue;
    }
    if (residual.length) extraLines.push(block.raw || "", ...residual);
    if (!isEmpty) cells[col].push(...items);
    mapped[col] = true;
  }

  const labels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(wy, wm - 1, wd + i);
    labels.push(d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }));
  }

  return {
    mapped: mapped.some(Boolean),
    days: cells.map((items, i) => ({ label: labels[i], items })),
    extra: extraLines.join("\n").trim(),
  };
}

/* ----- search hit markers: split \x01…\x02 into runs ----- */

export interface MarkedPart { text: string; mark: boolean }

export function markedParts(text: string | null | undefined): MarkedPart[] {
  return String(text || "")
    .split(/\x01|\x02/)
    .map((part, i) => ({ text: part, mark: i % 2 === 1 }))
    .filter((part) => part.text);
}
