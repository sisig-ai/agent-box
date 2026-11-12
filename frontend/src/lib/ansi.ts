"use client";

// ANSI SGR snapshot renderer for the shell terminal. Ported verbatim in
// behaviour from static/js/shell/ansi.js: renders tmux capture-pane output
// into HTML, drops a block cursor at the reported tmux cell.

const esc = (s: string) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderAnsi(text: string): string {
  const out: string[] = [];
  let open = 0;
  const pushSpan = (style: string) => { out.push(`<span style="${style}">`); open++; };
  const closeAll = () => { while (open-- > 0) out.push("</span>"); open = 0; };
  const applyCodes = (codes: number[]) => {
    if (!codes.length || (codes.length === 1 && codes[0] === 0)) { closeAll(); return; }
    let style = "";
    for (const c of codes) {
      if (c === 0) { closeAll(); }
      else if (c === 1) style += "font-weight:700;";
      else if (c === 2) style += "opacity:0.65;";
      else if (c === 3) style += "font-style:italic;";
      else if (c === 4) style += "text-decoration:underline;";
      else if (c === 7) style += "filter:invert(1);";
      else if (c === 9) style += "text-decoration:line-through;";
      else if (c >= 30 && c <= 37) style += `color:var(--term${c - 30},#c8c8d0);`;
      else if (c >= 90 && c <= 97) style += `color:var(--term${c - 90}b,#fff);`;
      else if (c >= 40 && c <= 47) style += `background:var(--termbg${c - 40},transparent);`;
      else if (c >= 100 && c <= 107) style += `background:var(--termbg${c - 100}b,transparent);`;
    }
    if (style) pushSpan(style);
  };
  const clean = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
                    .replace(/\x1b[()][0-9A-B]/g, "")
                    .replace(/\x1b[=>]/g, "");
  const re = /\x1b\[([0-9;?]*)?([A-Za-z])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    out.push(esc(clean.slice(last, m.index)));
    const params = (m[1] || "").split(";").filter((s) => s !== "" && s !== "?").map(Number);
    if (m[2] === "m") applyCodes(params);
    last = re.lastIndex;
  }
  out.push(esc(clean.slice(last)));
  closeAll();
  return out.join("");
}

const MARK = "﻿";

export function paint(text: string, alive: boolean, cx: number, cy: number): string {
  let marked = text;
  if (alive) {
    const lines = text.split("\n");
    if (cy >= 0 && cy < lines.length) {
      const rawLines = text.split("\n");
      const raw = rawLines[cy] || "";
      let cells = 0;
      let idx = 0;
      while (idx < raw.length && cells < cx) {
        if (raw[idx] === "\x1b") {
          const m = raw.slice(idx).match(/^\x1b\[[0-9;?]*[A-Za-z]/) ||
                    raw.slice(idx).match(/^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/) ||
                    raw.slice(idx).match(/^\x1b[()][0-9A-B]/) ||
                    raw.slice(idx).match(/^\x1b[=>]/);
          idx += m ? m[0].length : 1;
          continue;
        }
        cells++;
        idx += (raw.codePointAt(idx) || 0) > 0xffff ? 2 : 1;
      }
      rawLines[cy] = raw.slice(0, idx) + MARK + raw.slice(idx);
      marked = rawLines.join("\n");
    } else {
      marked = text + MARK;
    }
  }
  let html = renderAnsi(marked.replace(/\s+$/, ""));
  if (html.includes(MARK)) {
    html = html.split(MARK).join('<span class="t-cursor"> </span>');
  } else if (alive) {
    html += '<span class="t-cursor"> </span>';
  }
  return html;
}
