/* Host tty in ~ over websocket :5556.
   Push model: the server sends a pane snapshot whenever the tmux pane
   changes (plus an immediate push after every input/key) — same tmux
   backend as /api/shell, no polling. */
import { $ } from '../dom.js';
import { paint } from './ansi.js';

let ensureImpl = null;

// Entry point used by the view router (lazy). Idempotent: connect() no-ops
// while a socket is already open or connecting.
export function initShell() { if (ensureImpl) ensureImpl(); }

(() => {
  const term = $('term'), screen = $('term-screen'), dot = $('shell-dot'),
        sessEl = $('shell-sess'), stateEl = $('shell-state');
  if (!term || !screen) return;

  const LS_KEY = 'macmini-shell-session-id';
  let sid = (localStorage.getItem(LS_KEY) || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(sid)) {
    sid = [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(LS_KEY, sid); } catch (e) {}
  }

  let alive = false;

  function setState(txt, on) {
    if (stateEl) stateEl.textContent = txt;
    if (dot) {
      dot.classList.toggle('on', on === true);
      dot.classList.toggle('off', on === false);
    }
    if (sessEl) sessEl.textContent = sid ? `· ${sid}` : '';
  }

  /* ---------- Websocket transport (ws://host:5556/ws/shell) ---------- */
  const WS_PORT = 5556;
  let ws = null, wsRetry = 0, wsTimer = null, wantOpen = false;
  let pendingPane = null;

  function wsURL() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return `${proto}${location.hostname}:${WS_PORT}/ws/shell?id=${encodeURIComponent(sid)}`;
  }

  function wSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function onPane(p) {
    // Don't repaint background tabs; paint the latest on return.
    if (document.hidden) { pendingPane = p; return; }
    pendingPane = null;
    alive = !!p.alive;
    if (!alive) {
      setState('session dead — press New', false);
      if (screen.textContent.trim() === 'connecting…' || !screen.innerHTML.trim())
        screen.textContent = '// shell session not found — press New for a fresh shell in ~';
      return;
    }
    paint(screen, term, alive, p.text || '', p.cursor_x || 0, p.cursor_y || 0);
    setState(`connected · ${p.cols}×${p.rows}${p.cmd ? ' · ' + p.cmd : ''}`, true);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingPane) onPane(pendingPane);
  });

  function onServer(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'pane') onPane(m);
    else if (m.t === 'hello') {
      if (m.id) { sid = m.id; try { localStorage.setItem(LS_KEY, sid); } catch (e) {} }
      if (m.warn) setState(`connected with warning — ${m.warn}`, true);
    }
    else if (m.t === 'error') setState(`error — ${m.error || 'unknown'}`, false);
  }

  function scheduleReconnect() {
    if (!wantOpen) return;
    const delay = Math.min(500 * (2 ** wsRetry), 5000);
    wsRetry++;
    setState(wsRetry > 1 ? 'reconnecting…' : 'connecting…');
    clearTimeout(wsTimer);
    wsTimer = setTimeout(() => { if (wantOpen) connect(); }, delay);
  }

  function connect() {
    wantOpen = true;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    setState('connecting…');
    let sock;
    try { sock = new WebSocket(wsURL()); }
    catch (err) { scheduleReconnect(); return; }
    ws = sock;
    ws.onopen = () => { wsRetry = 0; };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (err) { return; }
      onServer(m);
    };
    ws.onclose = () => {
      if (ws === sock) ws = null;
      if (wantOpen) scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows with the reconnect */ };
  }

  function ensure() { connect(); }

  let typeTimer = null, typeBuf = '';
  function flushType() {
    if (!typeBuf) return;
    const text = typeBuf;
    typeBuf = '';
    wSend({ t: 'input', text }); // server pushes the fresh pane itself
  }
  function typeText(s) {
    typeBuf += s;
    clearTimeout(typeTimer);
    // Short batch window: keystrokes within one burst share a single
    // /api/shell/input call, and multiplexed SSH makes each call ~ms.
    typeTimer = setTimeout(flushType, 30);
  }
  function sendKey(key) {
    flushType();
    wSend({ t: 'key', key });
  }

  const KEYMAP = {
    Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Delete: 'Delete', Insert: 'Insert',
  };

  term.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'shell') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); sendKey('C-c'); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); sendKey('C-d'); return; }
    if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); sendKey('C-l'); return; }
    if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); sendKey('C-u'); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); sendKey('C-k'); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sendKey('C-a'); return; }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); sendKey('C-e'); return; }
    if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); sendKey('C-r'); return; }
    if (mod) return; // let browser handle the rest
    if (KEYMAP[e.key]) { e.preventDefault(); sendKey(KEYMAP[e.key]); return; }
    if (e.key.length === 1) { e.preventDefault(); typeText(e.key); return; }
  });

  // Mobile / IME fallback: hidden input captures what keydown misses.
  const ime = document.createElement('textarea');
  ime.setAttribute('aria-hidden', 'true');
  ime.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;top:0;left:0;pointer-events:none;';
  term.style.position = 'relative';
  term.appendChild(ime);
  ime.addEventListener('input', () => {
    if (ime.value) { typeText(ime.value); ime.value = ''; }
  });
  term.addEventListener('click', () => {
    term.focus({ preventScroll: true });
    if (matchMedia('(pointer:coarse)').matches) ime.focus({ preventScroll: true });
  });
  term.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text) typeText(text.slice(0, 4096));
  });

  function fit() {
    const w = term.clientWidth - 32; // padding
    // FiraCode Nerd Font Mono advance is 0.6em; at the 0.82rem terminal size
    // (≈13.1px on a 16px root) that is ≈7.9px per column.
    const cols = Math.max(20, Math.min(300, Math.floor(w / 7.9)));
    if (!wSend({ t: 'resize', cols, rows: 30 }))
      setState('not connected', false);
  }

  $('shell-fit').addEventListener('click', (e) => { e.stopPropagation(); fit(); });
  $('shell-clear').addEventListener('click', (e) => { e.stopPropagation(); sendKey('C-l'); term.focus(); });
  $('shell-reconnect').addEventListener('click', (e) => {
    e.stopPropagation();
    if (ws) { try { ws.close(); } catch (err) {} }
    wsRetry = 0;
    connect();
    term.focus();
  });
  $('shell-new').addEventListener('click', (e) => {
    e.stopPropagation();
    setState('starting fresh shell…');
    wSend({ t: 'new' }); // server kills + recreates (keeps pty size)
    term.focus();
  });

  ensureImpl = ensure;
})();
