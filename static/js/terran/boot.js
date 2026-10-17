// Mission briefing splash: once per browser session. Tap/any key skips it;
// reduced-motion users get the static frame for a moment, no typing.
const LINES = [
  'ESTABLISHING UPLINK TO MACMINI ............ OK',
  'SYNCING SECTOR TELEMETRY .................. OK',
  'LOADING STRUCTURE MANIFEST ................ OK',
  'BARRACKS PRODUCTION QUEUES ................ OK',
  'ADJUTANT ONLINE. WELCOME BACK, COMMANDER.',
];

export function initBoot(overlay, logEl, onDone) {
  const root = document.documentElement;
  if (!overlay) return;
  if (root.classList.contains('tr-booted')) { overlay.remove(); return; }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  overlay.classList.add('show');
  let done = false;
  const timers = [];
  const finish = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    try { sessionStorage.setItem('tr-booted', '1'); } catch (e) { /* private mode */ }
    root.classList.add('tr-booted');
    overlay.classList.add('out');
    setTimeout(() => overlay.remove(), still ? 0 : 450);
    window.removeEventListener('keydown', finish, true);
    if (onDone) onDone();
  };
  if (still) {
    logEl.textContent = LINES.join('\n');
    timers.push(setTimeout(finish, 1200));
  } else {
    LINES.forEach((line, i) => timers.push(setTimeout(() => { logEl.textContent += (i ? '\n' : '') + line; }, 250 + i * 330)));
    timers.push(setTimeout(finish, 250 + LINES.length * 330 + 900));
  }
  overlay.addEventListener('pointerdown', finish);
  window.addEventListener('keydown', finish, true);
}
