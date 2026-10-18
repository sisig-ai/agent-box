// Terran console: selection readout, command-card hotkeys, advisor messages,
// sound/CRT toggles. Purely a presentation layer: it reads the DOM the other
// modules already maintain and never calls an API itself.
import { advise, bindPortraits } from './advisor.js?v=terran4';
import { initSound, blip } from './sound.js?v=terran1';
import { initBoot } from './boot.js?v=terran1';

const $ = (id) => document.getElementById(id);
const txt = (id) => { const n = $(id); return n ? n.textContent.trim() : ''; };
const WIRE = (n) => `/static/img/terran/wire-${n}.webp?v=terran1`;

// Each view is a "selected unit": name, rank line, wireframe, live stats.
const UNITS = {
  stack: {
    name: 'Command Center', wire: 'command', hello: 'Command Center online.',
    rank: () => 'Stack · structures',
    stats: () => [`<b>${document.querySelectorAll('#services .card:not([style*="none"])').length}</b> structures`, txt('count'), txt('host')],
  },
  brief: {
    name: 'Briefing Room', wire: 'marine', hello: 'Briefing room secured. Awaiting orders.',
    rank: () => txt('brief-date-label') || 'Daily brief',
    stats: () => [`log: <b>${txt('brief-save-state') || 'ready'}</b>`, txt('brief-wordcount'), txt('schedule-week-label')],
  },
  files: {
    name: 'Supply Depot', wire: 'command', hello: 'Supply depot manifest loaded.',
    rank: () => txt('files-path-label') || '~',
    stats: () => [txt('files-count'), txt('files-status')],
  },
  shell: {
    name: 'Comsat Uplink', wire: 'mech', hello: 'Uplink established. Terminal standing by.',
    rank: () => txt('shell-sess') || 'kixpanganiban@macmini',
    stats: () => [`link: <b>${txt('shell-state') || '…'}</b>`],
  },
  kanban: {
    name: 'Barracks', wire: 'marine', hello: 'Barracks ready. Production queues synced.',
    rank: () => 'Production queues',
    stats: () => [`<b>${txt('kanban-count') || '—'}</b>`, txt('kanban-status')],
  },
  gmgn: {
    name: 'Refinery', wire: 'mech', hello: 'Refinery output nominal.',
    rank: () => 'GMGN loop',
    stats: () => {
      const bal = document.querySelector('#gmgn-balance .value');
      return [`balance <b>${bal ? bal.textContent.trim() : '—'}</b>`, txt('gmgn-updated')];
    },
  },
};

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let lastView = '';
let lastStats = '';

function renderSelection() {
  const view = document.body.dataset.view || 'stack';
  const unit = UNITS[view] || UNITS.stack;
  if (view !== lastView) {
    $('tr-sel-name').textContent = unit.name;
    $('tr-wire-img').src = WIRE(unit.wire);
    if (lastView) { advise(unit.hello); blip('select'); }
    lastView = view;
    lastStats = '';
  }
  $('tr-sel-rank').textContent = unit.rank();
  // Raw strings from our own DOM; only <b> wrappers are markup, the rest is escaped.
  const html = unit.stats().filter(Boolean).map((s) => {
    const parts = s.split(/(<b>.*?<\/b>)/);
    return '<span>' + parts.map((p) => (p.startsWith('<b>') ? `<b>${esc(p.slice(3, -4))}</b>` : esc(p))).join('') + '</span>';
  }).join('');
  if (html !== lastStats) { $('tr-sel-stats').innerHTML = html; lastStats = html; }
}

/* ---------- Hotkeys: BW-style single letters on the command card ---------- */
function typing() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  const tag = a.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable
    || !!a.closest('.term, .CodeMirror, .kbd-backdrop, .fs-modal-backdrop');
}

function initHotkeys() {
  const keys = {};
  document.querySelectorAll('.tr-cmd [data-hotkey]').forEach((b) => { keys[b.dataset.hotkey] = b; });
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (document.body.classList.contains('kbd-open') || typing()) return;
    if (document.documentElement.classList.contains('gmgn-app')) return;
    const btn = keys[e.key.toLowerCase()] || (e.key === '?' ? keys['?'] : null);
    if (!btn) return;
    e.preventDefault();
    btn.classList.add('tr-pressed');
    setTimeout(() => btn.classList.remove('tr-pressed'), 140);
    btn.click();
  });
}

/* ---------- Toggles ---------- */
function initToggles() {
  const crt = $('tr-crt');
  const syncCrt = () => {
    const on = !document.documentElement.classList.contains('tr-no-crt');
    crt.setAttribute('aria-pressed', String(on));
    crt.querySelector('.tr-cmd-lbl').textContent = on ? 'CRT on' : 'CRT off';
  };
  crt.addEventListener('click', () => {
    const off = document.documentElement.classList.toggle('tr-no-crt');
    try { localStorage.setItem('tr-crt', off ? '0' : '1'); } catch (e) { /* private mode */ }
    syncCrt();
    advise(off ? 'Scanlines disengaged.' : 'Scanlines engaged.');
  });
  syncCrt();
  $('tr-help').addEventListener('click', () => {
    advise('Hotkeys: <b>B</b>rief · <b>S</b>tack · <b>F</b>iles · <b>T</b> shell · <b>K</b>anban · <b>G</b>MGN', 'info', 9000);
    advise('<b>/</b> scan for a system · <b>M</b> sound · <b>C</b> scanlines', 'info', 9000);
  });
}

/* ---------- Advisor watchers: turn existing status text into transmissions ---------- */
function watch(id, fn, attr = false) {
  const n = $(id);
  if (!n) return;
  let prev = attr ? n.className : n.textContent;
  new MutationObserver(() => {
    const cur = attr ? n.className : n.textContent;
    if (cur !== prev) { const old = prev; prev = cur; fn(cur, old, n); }
  }).observe(n, { childList: true, characterData: true, subtree: true, attributes: attr });
}

function initWatchers() {
  let lastSaved = 0;
  // Only a real save (saving -> saved) counts; loading a day also lands on "saved".
  watch('brief-save-state', (cls, old) => {
    if (/error/.test(cls)) advise('Briefing log failed to transmit.', 'err');
    else if (/saved/.test(cls) && /saving/.test(old) && Date.now() - lastSaved > 30000) { lastSaved = Date.now(); advise('Briefing logged.'); }
  }, true);
  watch('kanban-status', (t) => {
    if (/fail|error/i.test(t)) advise(`Barracks: ${esc(t)}`, 'err');
    else if (/^archived/i.test(t)) advise(`Squad rotated out: ${esc(t)}.`);
  });
  const cardCount = (t) => parseInt(t, 10);
  watch('kanban-count', (t, old) => {
    const a = cardCount(old), b = cardCount(t);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) { advise('Unit ready.'); blip('ready'); }
  });
  watch('files-status-bar', (_t, _o, n) => {
    const s = $('files-status');
    if (s && s.classList.contains('error')) advise(`Depot: ${esc(s.textContent)}`, 'err');
  }, true);
  watch('shell-dot', (cls) => {
    if (document.body.dataset.view !== 'shell') return;
    if (/\boff\b/.test(cls)) advise('Uplink lost. Re-establishing…', 'warn');
  }, true);
  watch('tele-card-pwr', (cls, old) => {
    if (/pwr-alert/.test(cls) && !/pwr-alert/.test(old)) { advise('Warning: power surge detected.', 'warn'); blip('alert'); }
  }, true);
  // Sustained load: "not enough minerals" — at most once per 5 minutes each.
  const hot = { cpu: 0, mem: 0 }, said = { cpu: 0, mem: 0 };
  setInterval(() => {
    if (document.hidden) return;
    const cpu = parseFloat(txt('tele-cpu-util'));
    const m = /(\d+)% used/.exec(txt('tele-mem-free'));
    const mem = m ? Number(m[1]) : NaN;
    for (const [k, v, msg] of [['cpu', cpu, 'Not enough minerals. CPU above 90%.'], ['mem', mem, 'Insufficient vespene gas. Memory above 90%.']]) {
      hot[k] = v > 90 ? hot[k] + 1 : 0;
      if (hot[k] >= 8 && Date.now() - said[k] > 300000) { said[k] = Date.now(); advise(msg, 'warn'); }
    }
  }, 1000);
}

function init() {
  if (!$('tr-console')) return;
  bindPortraits(document.querySelectorAll('[data-adjutant]'));
  initSound($('tr-sound'));
  initHotkeys();
  initToggles();
  initWatchers();
  renderSelection();
  window.addEventListener('hashchange', () => requestAnimationFrame(renderSelection));
  setInterval(() => { if (!document.hidden) renderSelection(); }, 1000);
  initBoot($('tr-boot'), $('tr-boot-log'), () => advise(UNITS[document.body.dataset.view]?.hello || 'Welcome back, commander.'));
}

init();
