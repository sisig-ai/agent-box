import { seconds, createDayPager } from './gmgn-days.js?v=gmgn9';
// GMGN tab. Polls /api/gmgn only while this view is open.
const root = document.getElementById('gmgn-timeline');
const openRoot = document.getElementById('gmgn-open');
const openBlock = document.getElementById('gmgn-open-block');
const cards = {
  h12: document.getElementById('gmgn-h12'),
  d1: document.getElementById('gmgn-d1'),
  d7: document.getElementById('gmgn-d7'),
};
let busy = false;

function manilaParts(ts) {
  const when = seconds(ts);
  if (!when) return null;
  const date = new Date(when * 1000);
  const opts = { timeZone: 'Asia/Manila' };
  const day = new Intl.DateTimeFormat('en-GB', { ...opts, day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  const clock = new Intl.DateTimeFormat('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  const today = new Intl.DateTimeFormat('en-GB', { ...opts, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
  return { day, clock, today: day === today };
}

function manila(ts) {
  const parts = manilaParts(ts);
  if (!parts) return 'no time';
  return parts.today ? parts.clock : parts.day + ' ' + parts.clock;
}

function signed(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(digits);
}

function px(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '—';
  return '$' + n.toPrecision(4);
}

function move(entry, exit) {
  const a = Number(entry);
  const b = Number(exit);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return '';
  const pct = Math.round((b / a - 1) * 100);
  const sign = pct > 0 ? '+' : '';
  return sign + pct + '%';
}

function paintCard(node, row) {
  if (!node || !row) return;
  const value = node.querySelector('.value');
  const meta = node.querySelector('.meta');
  value.textContent = signed(row.sol, 4);
  value.className = 'value ' + (row.sol < 0 ? 'gmgn-neg' : 'gmgn-pos');
  node.classList.toggle('is-neg', row.sol < 0);
  node.classList.toggle('is-pos', row.sol > 0);
  meta.textContent = row.trades + ' closes';
}

function icon(event) {
  const letter = document.createElement('span');
  letter.className = 'gmgn-letter';
  letter.textContent = (event.symbol || '?').slice(0, 1);
  if (!event.address) return letter;
  const img = document.createElement('img');
  img.alt = '';
  img.src = 'https://dd.dexscreener.com/ds-data/tokens/solana/' + event.address + '.png?size=lg';
  img.addEventListener('error', () => img.replaceWith(letter));
  return img;
}

function row(event) {
  const line = document.createElement('article');
  if (event.kind === 'stop') {
    line.className = 'gmgn-trade gmgn-stop-card';
    const mark = document.createElement('span');
    mark.className = 'gmgn-letter';
    mark.textContent = '!';
    const text = document.createElement('span');
    text.textContent = 'historical stop — ' + (event.reason || 'stop');
    const time = document.createElement('span');
    time.textContent = seconds(event.ts) ? manila(event.ts) : 'time unknown';
    line.append(mark, text, time);
    return line;
  }
  const open = event.kind === 'open';
  const pct = open ? '' : move(event.entry, event.exit);
  const win = !open && event.pnl_sol >= 0;
  line.className = 'gmgn-trade' + (open ? ' gmgn-live' : '');
  const top = document.createElement('div');
  top.className = 'gmgn-trade-top';
  const left = document.createElement('div');
  left.className = 'gmgn-token';
  left.append(icon(event));
  const name = document.createElement('strong');
  name.textContent = event.symbol || (event.address || '').slice(0, 6) || '—';
  left.append(name);
  if (pct) {
    const pill = document.createElement('span');
    pill.className = 'gmgn-pill ' + (pct.startsWith('-') ? 'gmgn-neg' : 'gmgn-pos');
    pill.textContent = pct;
    left.append(pill);
  } else if (open) {
    const pill = document.createElement('span');
    pill.className = 'gmgn-pill';
    pill.textContent = 'open';
    left.append(pill);
  }
  const pnl = document.createElement('div');
  pnl.className = 'gmgn-pnl ' + (open ? '' : win ? 'gmgn-pos' : 'gmgn-neg');
  if (open) {
    pnl.textContent = event.sol == null ? '—' : Number(event.sol) + '';
  } else {
    pnl.textContent = signed(event.pnl_sol, 4);
  }
  const unit = document.createElement('small');
  unit.textContent = 'SOL';
  pnl.append(unit);
  top.append(left, pnl);
  const sub = document.createElement('div');
  sub.className = 'gmgn-trade-sub';
  const time = document.createElement('span');
  time.textContent = manila(event.ts);
  const size = document.createElement('span');
  size.textContent = event.sol == null ? '—' : Number(event.sol) + ' SOL';
  const prices = document.createElement('span');
  prices.textContent = open ? px(event.entry) : px(event.entry) + ' → ' + px(event.exit);
  sub.append(time, size, prices);
  line.append(top, sub);
  return line;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function paintScreen(body) {
  const box = document.getElementById('gmgn-screen');
  if (!box) return;
  box.replaceChildren();
  const screen = body.screen;
  const head = document.createElement('div');
  head.className = 'gmgn-screen-head';
  const title = document.createElement('span');
  title.textContent = 'latest screen';
  const meta = document.createElement('span');
  if (!screen) {
    meta.textContent = 'no scan yet';
    head.append(title, meta);
    box.append(head);
    return;
  }
  meta.textContent = manila(screen.scan_at) + ' · ' + screen.seen + ' seen · ' + screen.failed + ' fail · ' + screen.passed + ' pass';
  head.append(title, meta);
  box.append(head);
  const rows = (screen.rows || []).slice().sort((a, b) => {
    const rank = { fail: 0, skip: 1, pass: 2 };
    return (rank[a.result] ?? 3) - (rank[b.result] ?? 3);
  });
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'gmgn-empty';
    empty.textContent = 'scan saw no completed token under 3m';
    box.append(empty);
    return;
  }
  rows.forEach((item) => {
    const line = document.createElement('article');
    const result = item.result || '—';
    line.className = 'gmgn-screen-card gmgn-' + result;
    const top = document.createElement('div');
    top.className = 'gmgn-screen-top';
    const token = document.createElement('strong');
    token.textContent = item.symbol || (item.address || '').slice(0, 6) || '—';
    const pill = document.createElement('span');
    pill.className = 'gmgn-pill';
    pill.textContent = result;
    top.append(token, pill);
    const info = document.createElement('div');
    info.className = 'gmgn-screen-meta';
    const age = document.createElement('span');
    age.textContent = item.age_min == null ? '—' : item.age_min + 'm';
    const holders = document.createElement('span');
    holders.textContent = item.holder_count == null ? '—' : item.holder_count + ' holders';
    const volume = document.createElement('span');
    volume.textContent = money(item.volume_24h);
    const per = document.createElement('span');
    per.textContent = item.volume_per_holder == null ? '—' : '$' + Number(item.volume_per_holder).toFixed(1) + '/h';
    info.append(age, holders, volume, per);
    const why = document.createElement('div');
    why.className = 'gmgn-why';
    why.textContent = item.reason || '—';
    line.append(top, info, why);
    box.append(line);
  });
}

function paintList(node, events) {
  node.replaceChildren();
  events.forEach((event) => node.append(row(event)));
}

const paintTrades = createDayPager(root, paintList);

function paint(body) {
  paintCard(cards.h12, body.pnl && body.pnl.h12);
  paintCard(cards.d1, body.pnl && body.pnl.d1);
  paintCard(cards.d7, body.pnl && body.pnl.d7);
  const updated = document.getElementById('gmgn-updated');
  if (updated) updated.textContent = manila(body.generated_at);
  let status = document.getElementById('gmgn-runner-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'gmgn-runner-status';
    status.className = 'gmgn-screen-head';
    status.setAttribute('role', 'status');
    document.getElementById('gmgn-screen').before(status);
  }
  const live = body.runner_status || {};
  const labels = { running: 'running', stalled: 'stalled', buys_blocked: 'new buys blocked', not_running: 'not running', unknown: 'unknown' };
  status.textContent = 'runner: ' + (labels[live.state] || 'unknown')
    + (live.reason ? ' · ' + live.reason : '') + ' · checked ' + manila(live.checked_at);
  paintScreen(body);
  const opens = (body.open || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (openBlock) openBlock.hidden = opens.length === 0;
  if (openRoot) paintList(openRoot, opens);
  paintTrades(body.events || []);
}

async function poll() {
  if (document.body.dataset.view !== 'gmgn' || busy) return;
  busy = true;
  try {
    const res = await fetch('/api/gmgn', { cache: 'no-store' });
    if (!res.ok) return;
    paint(await res.json());
  } catch (_err) {
    // next tick retries
  } finally {
    busy = false;
  }
}

function installHint() {
  const el = document.getElementById('gmgn-install');
  if (!el) return;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  el.classList.toggle('is-on', ios && !standalone);
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

setInterval(poll, 15000);
window.addEventListener('hashchange', poll);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') poll();
});
installHint();
poll();
