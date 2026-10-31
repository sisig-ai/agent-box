// ANSI SGR snapshot renderer for the shell terminal.
// Turns tmux capture-pane output into escaped HTML; `paint` also drops
// the block cursor marker at the reported tmux cell.
import { esc } from '../dom.js';

/* Minimal SGR renderer: colours / bold / underline / reverse. */
export function renderAnsi(text) {
  const out = [];
  let open = 0;
  const pushSpan = (style) => { out.push(`<span style="${style}">`); open++; };
  const closeAll = () => { while (open-- > 0) out.push('</span>'); open = 0; };
  const applyCodes = (codes) => {
    if (!codes.length || (codes.length === 1 && codes[0] === 0)) { closeAll(); return; }
    let style = '';
    for (const c of codes) {
      if (c === 0) { closeAll(); }
      else if (c === 1) style += 'font-weight:700;';
      else if (c === 2) style += 'opacity:0.65;';
      else if (c === 3) style += 'font-style:italic;';
      else if (c === 4) style += 'text-decoration:underline;';
      else if (c === 7) style += 'filter:invert(1);';
      else if (c === 9) style += 'text-decoration:line-through;';
      else if (c >= 30 && c <= 37) style += `color:var(--term${c - 30},#c8c8d0);`;
      else if (c >= 90 && c <= 97) style += `color:var(--term${c - 90}b,#fff);`;
      else if (c >= 40 && c <= 47) style += `background:var(--termbg${c - 40},transparent);`;
      else if (c >= 100 && c <= 107) style += `background:var(--termbg${c - 100}b,transparent);`;
    }
    if (style) pushSpan(style);
  };
  // Strip non-SGR escapes (cursor motion etc. — capture-pane is a snapshot,
  // so absolute positioning codes carry no meaning here).
  const clean = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
                    .replace(/\x1b[()][0-9A-B]/g, '')
                    .replace(/\x1b[=>]/g, '');
  const re = /\x1b\[([0-9;?]*)?([A-Za-z])/g;
  let last = 0, m;
  while ((m = re.exec(clean))) {
    out.push(esc(clean.slice(last, m.index)));
    const params = (m[1] || '').split(';').filter(s => s !== '' && s !== '?').map(Number);
    if (m[2] === 'm') applyCodes(params);
    // swallow all other CSI sequences (K, J, H, …)
    last = re.lastIndex;
  }
  out.push(esc(clean.slice(last)));
  closeAll();
  return out.join('');
}

export function paint(screen, term, alive, text, cx, cy) {
  // Insert a private-use marker at the tmux cursor cell, then render
  // ANSI colours around it. Cell counting ignores escape sequences;
  // wide glyphs may drift the block by a cell — best effort.
  const MARK = '';
  let marked = text;
  if (alive) {
    const plain = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
                      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
    const lines = plain.split('\n');
    if (cy >= 0 && cy < lines.length) {
      const rawLines = text.split('\n');
      const raw = rawLines[cy] || '';
      let cells = 0, idx = 0, inEsc = false;
      while (idx < raw.length && cells < cx) {
        if (raw[idx] === '\x1b') {
          const m = raw.slice(idx).match(/^\x1b\[[0-9;?]*[A-Za-z]/) ||
                    raw.slice(idx).match(/^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/) ||
                    raw.slice(idx).match(/^\x1b[()][0-9A-B]/) ||
                    raw.slice(idx).match(/^\x1b[=>]/);
          idx += m ? m[0].length : 1;
          continue;
        }
        cells++;
        idx += (raw.codePointAt(idx) > 0xFFFF) ? 2 : 1;
      }
      rawLines[cy] = raw.slice(0, idx) + MARK + raw.slice(idx);
      marked = rawLines.join('\n');
    } else {
      marked = text + MARK;
    }
  }
  let html = renderAnsi(marked.replace(/\s+$/, ''));
  if (html.includes(MARK)) {
    html = html.split(MARK).join('<span class="t-cursor"> </span>');
  } else if (alive) {
    html += '<span class="t-cursor"> </span>';
  }
  screen.innerHTML = html;
  term.scrollTop = term.scrollHeight;
}
