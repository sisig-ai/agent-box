// Attention: the first time a view is focused, draw the eye to cards/bars that
// changed since the last visit, and fly cards that moved lanes across the board.
// Seen state is persisted per browser in localStorage, keyed by card signature,
// so filtered-out cards stay unseen until they are actually shown.
const PREFIX = 'macmini.attention.v1.';
const MEMORY = new Map();
// The latest snapshot each view handed us (id, signature, lane), so Esc can
// mark exactly what is on screen as read without re-fetching anything.
const LATEST = new Map();
const reduceMotion = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

const COLORS = ['#e8ebef', '#c6a96a', '#93b8a0', '#8c95a1', '#e8ebef'];
const DITHER = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2' shape-rendering='crispEdges'%3E%3Cpath fill='%23e8ebef' fill-opacity='.5' d='M0 0h1v1H0zM1 1h1v1H1z'/%3E%3C/svg%3E\")";

function read(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) return JSON.parse(raw);
  } catch { /* storage blocked */ }
  return MEMORY.get(key) || null;
}

function write(key, state) {
  MEMORY.set(key, state);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(state)); } catch { /* storage blocked */ }
}

function text(value, max = 26) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function remember(key, entries, allIds) {
  const prev = LATEST.get(key);
  LATEST.set(key, {
    entries: entries.map((entry) => ({ id: entry.id, sig: entry.sig, lane: entry.lane })),
    allIds: allIds || prev?.allIds || null,
  });
}

function rememberOne(key, id, sig, lane) {
  const snap = LATEST.get(key);
  const entry = snap?.entries.find((item) => String(item.id) === String(id));
  if (!entry) return;
  entry.sig = sig;
  if (lane != null) entry.lane = lane;
}

function square(rect, colour, size) {
  const p = document.createElement('i');
  p.className = 'attention-p';
  p.style.left = `${rect.left + Math.random() * rect.width}px`;
  p.style.top = `${rect.top + Math.random() * rect.height}px`;
  p.style.width = p.style.height = `${size}px`;
  p.style.backgroundColor = colour;
  p.style.backgroundImage = Math.random() < 0.55 ? DITHER : 'none';
  return p;
}

// A dithered pixel burst radiating from a rectangle. Fixed positioning keeps
// particles clear of the lane's scroll clipping.
function burst(rect, count = 16) {
  if (reduceMotion.matches || !rect.width) return;
  const layer = document.createElement('div');
  layer.className = 'attention-fx';
  document.body.append(layer);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const reach = 34 + Math.random() * 96;
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach - 26;
    const p = square(rect, COLORS[i % COLORS.length], [2, 3, 4, 5][i % 4]);
    layer.append(p);
    const anim = p.animate([
      { transform: 'translate(0, 0)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.6}px)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
    ], {
      duration: 620 + Math.random() * 520,
      delay: Math.random() * 180,
      easing: `steps(${4 + Math.floor(Math.random() * 4)}, end)`,
      fill: 'both',
    });
    anim.onfinish = () => p.remove();
    // Every fourth pixel gets a fainter twin so the burst reads as a tiny trail.
    if (i % 4 === 0) {
      const q = p.cloneNode();
      q.style.opacity = '0.45';
      layer.append(q);
      const twin = q.animate([
        { transform: 'translate(0, 0)', opacity: 0.45 },
        { transform: `translate(${dx * 0.72}px, ${dy * 0.72}px)`, opacity: 0 },
      ], {
        duration: 720 + Math.random() * 420,
        delay: 40 + Math.random() * 120,
        easing: `steps(${4 + Math.floor(Math.random() * 3)}, end)`,
        fill: 'both',
      });
      twin.onfinish = () => q.remove();
    }
  }
  setTimeout(() => layer.remove(), 1800);
}

function sweep(host, cls) {
  const wrap = document.createElement('span');
  wrap.className = 'attention-sweep-wrap';
  const band = document.createElement('i');
  band.className = `attention-sweep ${cls || ''}`;
  band.style.backgroundImage = DITHER;
  wrap.append(band);
  host.append(wrap);
  setTimeout(() => wrap.remove(), 1700);
}

function flash(entry, opts) {
  const el = entry.el;
  if (!el || !el.isConnected) return;
  el.classList.add('attention-hit');
  sweep(el);
  const rect = el.getBoundingClientRect();
  burst(rect, 26);
  setTimeout(() => el.classList.remove('attention-hit'), 1700);

  const meter = opts.meter?.(el);
  if (meter) {
    meter.classList.add('attention-meter');
    sweep(meter, 'is-meter');
    burst(meter.getBoundingClientRect(), 14);
    setTimeout(() => meter.classList.remove('attention-meter'), 1700);
  }
}

function laneAnchor(laneEl) {
  if (!laneEl) return null;
  const head = laneEl.querySelector('.kb-lane-head') || laneEl;
  const r = head.getBoundingClientRect();
  if (!r.width) return null;
  return {
    left: Math.max(6, Math.min(window.innerWidth - 180, r.left + 12)),
    top: r.top + Math.min(26, r.height - 4),
    width: 120,
    height: 18,
  };
}

// A small dithered pixel tag flies from the old lane header to the card's new
// home, stepping in 8-bit increments instead of easing smoothly.
function flyGhost(from, to, label) {
  const ghost = document.createElement('div');
  ghost.className = 'attention-ghost';
  ghost.textContent = label;
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  document.body.append(ghost);
  const dx = to.left + to.width / 2 - from.left - 24;
  const dy = to.top + Math.min(14, to.height / 2) - from.top;

  const anim = ghost.animate([
    { transform: 'translate(0, 0)', opacity: 0 },
    { transform: 'translate(0, 0)', opacity: 1, offset: 0.08 },
    { transform: `translate(${dx * 0.46}px, ${dy * 0.46 - 38}px)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx * 0.82}px, ${dy * 0.84 - 20}px)`, opacity: 1, offset: 0.82 },
    { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
  ], { duration: 940, easing: 'steps(8, end)', fill: 'both' });

  const timers = [0.28, 0.52, 0.74].map((at, i) => setTimeout(() => {
    burst(ghost.getBoundingClientRect(), 3);
  }, 940 * at + i * 30));
  anim.onfinish = () => {
    timers.forEach(clearTimeout);
    ghost.remove();
  };
  setTimeout(() => ghost.remove(), 1400);
}

function pulseLane(laneEl) {
  if (!laneEl) return;
  laneEl.classList.add('attention-lane');
  setTimeout(() => laneEl.classList.remove('attention-lane'), 1200);
}

function staticFlash(entry) {
  const el = entry.el;
  if (!el) return;
  el.classList.add('attention-static');
  setTimeout(() => el.classList.remove('attention-static'), 2600);
}

// Record this visit and animate what is new since the previous one.
// entries: [{ id, el, sig, lane? }] — only what is currently on screen.
// opts: { allIds, laneName?, laneEl?, meter? }
export function visit(key, entries, opts = {}) {
  const prev = read(key);
  const now = new Date().toISOString();
  remember(key, entries, opts.allIds);
  const baseline = !prev || !(prev.primed ?? !!prev.seenAt);
  const state = {
    v: 1,
    primed: true,
    seenAt: now,
    items: baseline ? {} : { ...(prev?.items || {}) },
    comments: { ...(prev?.comments || {}) },
  };

  const fresh = [];
  const moved = [];
  for (const entry of entries) {
    const shown = !!entry.el;
    if (!shown && !baseline) continue;
    const old = state.items[String(entry.id)];
    const isFresh = !baseline && shown && (!old || old.s !== entry.sig);
    if (isFresh) fresh.push(entry);
    if (!baseline && shown && old && entry.lane != null && old.l !== entry.lane) {
      moved.push({ entry, from: old.l });
    }
    if (shown || baseline) {
      const rec = state.items[String(entry.id)] || (state.items[String(entry.id)] = {});
      // keepUnread leaves the old signature in place so the card keeps glowing
      // until it is clicked; the lane is updated now so a move only flies once.
      if (baseline || !opts.keepUnread || !isFresh) rec.s = entry.sig;
      if (entry.lane != null) rec.l = entry.lane;
    }
  }

  if (opts.allIds) {
    const keep = new Set(opts.allIds.map(String));
    for (const id of Object.keys(state.items)) if (!keep.has(id)) delete state.items[id];
    for (const id of Object.keys(state.comments)) if (!keep.has(id)) delete state.comments[id];
  }
  write(key, state);
  if (baseline) return { baseline: true, fresh: 0, moved: 0 };

  const movedIds = new Set(moved.map((m) => m.entry.id));
  if (reduceMotion.matches) {
    [...fresh, ...moved.map((m) => m.entry)].forEach(staticFlash);
    return { baseline: false, fresh: fresh.length, moved: moved.length };
  }

  let slot = 0;
  // A day away can leave dozens of changed cards; keep the burst readable
  // instead of turning the whole board into confetti.
  for (const entry of fresh) {
    if (movedIds.has(entry.id)) continue;
    if (slot >= 14) break;
    const delay = 160 + slot * 90;
    slot += 1;
    setTimeout(() => flash(entry, opts), delay);
  }

  moved.slice(0, 6).forEach(({ entry, from }, i) => {
    const fromRect = laneAnchor(opts.laneEl?.(from));
    const toRect = entry.el.getBoundingClientRect();
    if (!fromRect) {
      setTimeout(() => flash(entry, opts), 260 + i * 120);
      return;
    }
    const fromName = text(opts.laneName?.(from) || `lane ${from}`, 18);
    const toName = text(opts.laneName?.(entry.lane) || `lane ${entry.lane}`, 18);
    setTimeout(() => {
      flyGhost(fromRect, toRect, `${fromName} → ${toName}`);
      setTimeout(() => {
        flash(entry, opts);
        pulseLane(opts.laneEl?.(entry.lane));
      }, 900);
    }, 220 + i * 150);
  });

  return { baseline: false, fresh: fresh.length, moved: moved.length };
}

// Cards whose stored signature no longer matches: these keep their persistent
// shimmer until markRead() is called from the card's click handler.
export function unreadIds(key, entries) {
  remember(key, entries);
  const prev = read(key);
  if (!prev || !(prev.primed ?? !!prev.seenAt)) return new Set();
  const out = new Set();
  for (const entry of entries) {
    const old = prev.items?.[String(entry.id)];
    if (!old || old.s !== entry.sig) out.add(entry.id);
  }
  return out;
}

// The card was opened: from now on it is read until its next change.
export function markRead(key, id, sig, lane) {
  const prev = read(key) || { v: 1, items: {}, comments: {} };
  const state = {
    v: 1,
    primed: prev.primed ?? !!prev.seenAt,
    seenAt: new Date().toISOString(),
    items: { ...(prev.items || {}) },
    comments: { ...(prev.comments || {}) },
  };
  state.items[String(id)] = { s: sig, ...(lane != null ? { l: lane } : {}) };
  write(key, state);
  rememberOne(key, id, sig, lane);
}

// Comments were fetched for an open card: return the ones newer than the last
// time this card was read, then advance the per-card watermark.
export function newComments(key, cardId, comments) {
  const prev = read(key) || { v: 1, seenAt: null, items: {}, comments: {} };
  const state = {
    v: 1,
    primed: prev.primed ?? !!prev.seenAt,
    seenAt: prev.seenAt || null,
    items: { ...(prev.items || {}) },
    comments: { ...(prev.comments || {}) },
  };
  const ids = comments.map((c) => Number(c.id)).filter((id) => Number.isFinite(id));
  const max = ids.length ? Math.max(...ids) : null;
  const last = state.comments[String(cardId)];
  if (last == null) {
    if (max != null) state.comments[String(cardId)] = max;
    write(key, state);
    return [];
  }
  const unseen = comments.filter((c) => Number(c.id) > last).map((c) => c.id);
  if (max != null) state.comments[String(cardId)] = max;
  write(key, state);
  return unseen;
}

// Strip every live attention effect from the page: looping card sweeps, the
// sweep wraps, pixel bursts, flying ghosts, lane pulses and comment `new`
// markers. Timers that fire later just re-remove or no-op.
function clearEffects() {
  document.querySelectorAll('.attention-unread').forEach((n) => n.classList.remove('attention-unread'));
  document.querySelectorAll('.attention-sweep-wrap').forEach((n) => n.remove());
  document.querySelectorAll('.attention-hit, .attention-meter, .attention-static, .attention-lane')
    .forEach((n) => n.classList.remove('attention-hit', 'attention-meter', 'attention-static', 'attention-lane'));
  document.querySelectorAll('.attention-fx, .attention-ghost').forEach((n) => n.remove());
  document.querySelectorAll('.kbc-item.is-new').forEach((n) => {
    n.classList.remove('is-new');
    n.querySelector('.kbc-new')?.remove();
  });
}

// Esc: everything currently on screen is read from now on. Store the current
// signature of every known item so nothing shimmers again until it changes.
export function markAllRead() {
  let cleared = 0;
  const now = new Date().toISOString();
  for (const [key, snap] of LATEST) {
    const prev = read(key);
    if (!prev) continue;
    const state = {
      v: 1,
      primed: prev.primed ?? !!prev.seenAt,
      seenAt: now,
      items: { ...(prev.items || {}) },
      comments: { ...(prev.comments || {}) },
    };
    for (const entry of snap.entries) {
      const rec = state.items[String(entry.id)] || (state.items[String(entry.id)] = {});
      if (rec.s !== entry.sig) cleared += 1;
      rec.s = entry.sig;
      if (entry.lane != null) rec.l = entry.lane;
    }
    if (snap.allIds) {
      const keep = new Set(snap.allIds.map(String));
      for (const id of Object.keys(state.items)) if (!keep.has(id)) delete state.items[id];
      for (const id of Object.keys(state.comments)) if (!keep.has(id)) delete state.comments[id];
    }
    write(key, state);
  }
  clearEffects();
  document.dispatchEvent(new CustomEvent('attention:dismissed', { detail: { count: cleared } }));
  return cleared;
}

// Esc anywhere in a view dismisses what is glowing there. Dialogs and inline
// editors keep their own Esc (close / cancel / clear search), so skip those.
function dismissKey(e) {
  if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (document.querySelector('dialog[open], .kbd-backdrop:not([hidden]), #fs-modal:not([hidden])')) return false;
  const a = document.activeElement;
  if (a && a !== document.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return false;
  return true;
}

document.addEventListener('keydown', (e) => {
  if (!dismissKey(e)) return;
  if (!LATEST.size) return;
  markAllRead();
});
