// Telemetry graph registry: one 1h ring per card, canvas draw + hover tooltip.
import { $ } from '../dom.js';
import { procsStart, procsStop } from './procs.js';

const WINDOW = 3600; // seconds shown per graph

const fmtW = (w) => (w == null ? '—' : w < 10 ? w.toFixed(2) : w.toFixed(1));

function hexToRgba(hex, a) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function accentOf(card) {
  const c = getComputedStyle(card).getPropertyValue('--accent').trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : '#72a7ff';
}

// One graph per card: ring of per-second values anchored at `start` (unix s).
function makeGraph(cardId, canvasId, scale, fmt, tickFmt) {
  return {
    card: $(cardId), canvas: $(canvasId), scale, fmt, tickFmt,
    start: null, vals: [], loaded: false, loading: false,
    hover: -1, tip: null,
  };
}

export const graphs = {
  cpu: makeGraph('tele-card-cpu', 'tele-cpu-graph', { ymin: 0, ymax: 100 },
    (v) => `${v.toFixed(1)}%`, (v) => `${Math.round(v)}`),
  mem: makeGraph('tele-card-mem', 'tele-mem-graph', { ymin: 0, ymax: null }, // ymax = total GB, live
    (v) => `${v.toFixed(2)} GB`, (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}`),
  pwr: makeGraph('tele-card-pwr', 'tele-pwr-graph', { ymin: 0, autoMax: true, minSpan: 10 },
    (v) => `${fmtW(v)} W`, (v) => `${fmtW(v)}`),
};

function fmtClockSec(tsSec) {
  const d = new Date(tsSec * 1000);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function tipText(g, idx) {
  const v = g.vals[idx];
  const ts = g.start + idx;
  const ago = Math.max(0, Math.round(Date.now() / 1000) - ts);
  const agoTxt = ago < 90 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
  if (v == null || !isFinite(v)) return `${fmtClockSec(ts)} · no data`;
  return `${fmtClockSec(ts)} · ${g.fmt(v)} (${agoTxt})`;
}

export function placeTip(g) {
  const tip = g.tip;
  if (!tip || g.hover < 0) return;
  const rect = g.canvas.getBoundingClientRect();
  const n = g.vals.length;
  const GUT = 38, PR = 6;
  tip.textContent = tipText(g, g.hover);
  tip.classList.add('show');
  const px = n < 2 ? GUT : (g.hover / (n - 1)) * (rect.width - GUT - PR) + GUT;
  const tw = tip.offsetWidth || 120;
  tip.style.left = '0';
  tip.style.top = '2px';
  tip.style.transform = `translate(${Math.min(Math.max(px + 10, 2), Math.max(2, rect.width - tw - 2))}px, 0)`;
}

// Tooltip divs + hover tracking per graph
for (const key of Object.keys(graphs)) {
  const g = graphs[key];
  const wrap = g.canvas.parentElement; // .tele-graph
  const tip = document.createElement('div');
  tip.className = 'graph-tip';
  wrap.appendChild(tip);
  g.tip = tip;
  g.canvas.addEventListener('pointermove', (e) => {
    if (!g.loaded || !g.vals.length) return;
    const rect = g.canvas.getBoundingClientRect();
    const GUT = 38, PR = 6;
    const n = g.vals.length;
    const x = e.clientX - rect.left;
    const frac = (x - GUT) / Math.max(1, rect.width - GUT - PR);
    let idx = Math.round(frac * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    // snap to the nearest real sample so gaps still read out something useful
    if (g.vals[idx] == null) {
      for (let d = 1; d <= 30; d++) {
        if (idx - d >= 0 && g.vals[idx - d] != null) { idx = idx - d; break; }
        if (idx + d < n && g.vals[idx + d] != null) { idx = idx + d; break; }
      }
    }
    g.hover = idx;
    drawGraph(g);
    placeTip(g);
  });
  g.canvas.addEventListener('mouseleave', () => {
    g.hover = -1;
    if (g.tip) g.tip.classList.remove('show');
    drawGraph(g);
  });
}

export function feed(g, tsSec, val) {
  if (!g.loaded || g.start == null || tsSec == null) return;
  const idx = tsSec - g.start;
  if (idx < 0) return;
  while (g.vals.length <= idx) g.vals.push(null);
  g.vals[idx] = (val == null || !isFinite(val)) ? null : val;
  if (g.vals.length > WINDOW + 1) {
    const drop = g.vals.length - (WINDOW + 1);
    g.vals.splice(0, drop);
    g.start += drop;
    if (g.hover >= 0) g.hover = Math.max(-1, g.hover - drop);
  }
}

export function drawGraph(g) {
  const cv = g.canvas;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const vals = g.vals, n = vals.length;
  let lo = Infinity, hi = -Infinity, last = -1;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; last = i; }
  }
  if (!isFinite(lo)) return; // no data yet — leave blank

  let ymin = g.scale.ymin != null ? g.scale.ymin : lo;
  let ymax = g.scale.ymax != null ? g.scale.ymax : hi;
  if (g.scale.autoMax) ymax = Math.max(hi * 1.2, g.scale.minSpan || 1);
  const span = Math.max(ymax - ymin, g.scale.minSpan || 1e-6);
  if (ymax - ymin < span) { const m = (ymin + ymax) / 2; ymin = m - span / 2; ymax = m + span / 2; }

  const GUT = 38, PR = 6, PT = 10, PB = 6;
  const X = (i) => (n < 2 ? GUT + (w - GUT - PR) / 2 : GUT + (i / (n - 1)) * (w - GUT - PR));
  const Y = (v) => h - PB - ((v - ymin) / (ymax - ymin)) * (h - PT - PB);

  // y-axis scale on the far left: gridlines + tick labels
  let ticks;
  if (g.canvas.id === 'tele-cpu-graph') {
    ticks = [0, 25, 50, 75, 100];
  } else {
    ticks = [ymin, ymin + span / 3, ymin + (2 * span) / 3, ymax];
  }
  ctx.font = '9px "FiraCode Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const y = Y(Math.min(Math.max(t, ymin), ymax));
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(GUT, y);
    ctx.lineTo(w - 2, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(144,152,184,0.95)';
    ctx.textAlign = 'left';
    ctx.fillText(g.tickFmt ? g.tickFmt(t) : String(Math.round(t)), 2, Math.min(Math.max(y, 6), h - 6));
  }

  const accent = accentOf(g.card);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexToRgba(accent, 0.30));
  grad.addColorStop(1, hexToRgba(accent, 0));

  // contiguous non-null runs (gaps stay broken)
  const runs = [];
  let run = null;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v != null && isFinite(v)) {
      if (!run) { run = []; runs.push(run); }
      run.push(i);
    } else run = null;
  }

  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const r of runs) {
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(X(r[0]), h - PB);
    for (const i of r) ctx.lineTo(X(i), Y(vals[i]));
    ctx.lineTo(X(r[r.length - 1]), h - PB);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.shadowColor = accent;
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(X(r[0]), Y(vals[r[0]]));
    for (let k = 1; k < r.length; k++) ctx.lineTo(X(r[k]), Y(vals[r[k]]));
    ctx.strokeStyle = accent;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // hover crosshair (cursor readout)
  if (g.hover >= 0 && g.hover < n && vals[g.hover] != null && isFinite(vals[g.hover])) {
    const hx = X(g.hover), hy = Y(vals[g.hover]);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, PT - 4);
    ctx.lineTo(hx, h - PB);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(hx, hy, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // live dot on the newest point
  if (last >= 0) {
    ctx.beginPath();
    ctx.arc(X(last), Y(vals[last]), 2.8, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

export async function ensureHistory(g, key) {
  if (g.loaded || g.loading) return;
  g.loading = true;
  try {
    const res = await fetch(`/api/stats/history?seconds=${WINDOW}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const h = await res.json();
    g.start = h.start;
    g.vals = (h[key] || []).slice(0, WINDOW + 1);
    if (key === 'mem_used') {
      for (let i = 0; i < g.vals.length; i++) {
        if (g.vals[i] != null) g.vals[i] = g.vals[i] / 1073741824;
      }
      if (h.mem_total) g.scale.ymax = h.mem_total / 1073741824;
    }
    g.loaded = true;
  } catch (err) { /* retry on next expand */ }
  g.loading = false;
  drawGraph(g);
}

export function toggle(cardId, key) {
  const g = graphs[key];
  const open = g.card.classList.toggle('expanded');
  g.card.setAttribute('aria-expanded', String(open));
  if (open) {
    ensureHistory(g, key === 'cpu' ? 'cpu' : key === 'mem' ? 'mem_used' : 'pwr');
    requestAnimationFrame(() => drawGraph(g));
    if (key === 'mem') procsStart();
  } else {
    g.hover = -1;
    if (g.tip) g.tip.classList.remove('show');
    if (key === 'mem') procsStop();
  }
}

for (const [cardId, key] of [['tele-card-cpu', 'cpu'], ['tele-card-mem', 'mem'], ['tele-card-pwr', 'pwr']]) {
  const g = graphs[key];
  g.card.addEventListener('click', (e) => {
    if (e.target.closest('button, .tele-procs')) return; // badges, tabs, proc table manage themselves
    toggle(cardId, key);
  });
  g.card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(cardId, key); }
  });
}
window.addEventListener('resize', () => {
  for (const key of Object.keys(graphs)) {
    if (graphs[key].card.classList.contains('expanded')) drawGraph(graphs[key]);
  }
});

export { fmtW, WINDOW };
