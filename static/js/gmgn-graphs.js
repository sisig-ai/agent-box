import { seconds } from './gmgn-days.js?v=gmgn13';

export const WINDOWS = {
  h12: { duration: 43200, interval: 1800, label: '12h', sample: '30m' },
  d1: { duration: 86400, interval: 3600, label: '24h', sample: '1h' },
  d7: { duration: 604800, interval: 43200, label: '7d', sample: '12h' },
};

export function pnlSeries(events, generatedAt, window) {
  const end = seconds(generatedAt);
  if (end === null || !Array.isArray(events)) return null;
  const start = end - window.duration;
  const trades = events.filter((event) => event.kind === 'trade'
    && event.pnl_sol !== null && event.pnl_sol !== undefined
    && (typeof event.pnl_sol === 'number' || (typeof event.pnl_sol === 'string' && event.pnl_sol.trim() !== ''))
    && Number.isFinite(Number(event.pnl_sol)))
    .map((event) => ({ ts: seconds(event.ts), pnl: Number(event.pnl_sol) }))
    .filter((event) => event.ts !== null && event.ts >= start && event.ts <= end)
    .sort((a, b) => a.ts - b.ts);
  let sum = 0;
  let index = 0;
  const points = [];
  for (let ts = start; ts <= end; ts += window.interval) {
    while (index < trades.length && trades[index].ts <= ts) sum += trades[index++].pnl;
    points.push({ ts, value: sum });
  }
  return points;
}

const NS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function makeGraph(card, window) {
  const box = document.createElement('div');
  box.className = 'gmgn-graph';
  const svg = svgNode('svg', { viewBox: '0 0 240 72', preserveAspectRatio: 'none', role: 'img' });
  const title = svgNode('title');
  const id = card.id + '-fill';
  const defs = svgNode('defs');
  const gradient = svgNode('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.append(svgNode('stop', { offset: 0, 'stop-color': 'currentColor', 'stop-opacity': 0.25 }),
    svgNode('stop', { offset: 1, 'stop-color': 'currentColor', 'stop-opacity': 0.02 }));
  defs.append(gradient);
  const grid = svgNode('path', { d: 'M4 12H236M4 36H236M4 60H236', class: 'gmgn-graph-grid' });
  const fill = svgNode('path', { fill: 'url(#' + id + ')' });
  const line = svgNode('polyline', { class: 'gmgn-graph-line', 'vector-effect': 'non-scaling-stroke' });
  const dot = svgNode('circle', { r: 2.5, fill: 'currentColor' });
  svg.append(title, defs, grid, fill, line, dot);
  const note = document.createElement('div');
  note.className = 'gmgn-graph-note';
  box.append(svg, note);
  card.append(box);
  return (points) => {
    svg.style.display = points === null ? 'none' : '';
    note.textContent = points === null ? 'graph unavailable' : window.sample + ' points · sol';
    if (points === null) return;
    const values = points.map((point) => point.value);
    let low = Math.min(0, ...values);
    let high = Math.max(0, ...values);
    if (low === high) { low = -1; high = 1; }
    const y = (value) => 64 - (value - low) / (high - low) * 56;
    const coords = values.map((value, i) => [4 + i / (values.length - 1) * 232, y(value)]);
    const pairs = coords.map(([x, top]) => x.toFixed(2) + ',' + top.toFixed(2));
    const last = values[values.length - 1];
    title.textContent = window.label + ' cumulative recorded p/l: ' + last.toFixed(9) + ' sol, ' + points.length + ' points';
    box.classList.toggle('gmgn-neg', last < 0);
    box.classList.toggle('gmgn-pos', last >= 0);
    line.setAttribute('points', pairs.join(' '));
    fill.setAttribute('d', 'M4,' + y(0).toFixed(2) + 'L' + pairs.join('L') + 'L236,' + y(0).toFixed(2) + 'Z');
    dot.setAttribute('cx', coords[coords.length - 1][0]);
    dot.setAttribute('cy', coords[coords.length - 1][1]);
  };
}

export function createPnlGraphs(cards) {
  const painters = Object.entries(WINDOWS).map(([key, window]) => ({
    window, paint: makeGraph(cards[key], window),
  }));
  return (body) => painters.forEach(({ window, paint }) => paint(pnlSeries(body.events, body.generated_at, window)));
}
