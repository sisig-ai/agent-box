// Advisor transmissions: BW-style chat lines above the console, and the
// adjutant portrait "talking" (idle/talk frames alternating) while a line is
// on screen. Lines fade after a few seconds; at most MAX are shown.
const MAX = 5;
const FRAME_MS = 180;
let log = null;
let portraits = [];
let talkUntil = 0;
let talkTimer = 0;

export function bindPortraits(els) { portraits = [...els]; }

function setTalking(on, open) {
  for (const p of portraits) {
    p.classList.toggle('talking', on);
    p.classList.toggle('mouth-open', on && open);
  }
}

// Talk while any advisor line is visible. Reduced motion: hold the talk
// frame steadily instead of flickering.
function talk(ms) {
  if (!portraits.length) return;
  talkUntil = Math.max(talkUntil, Date.now() + ms);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setTalking(true, true);
    clearTimeout(talkTimer);
    talkTimer = setTimeout(() => setTalking(false, false), talkUntil - Date.now());
    return;
  }
  if (talkTimer) return;
  let open = true;
  const tick = () => {
    if (Date.now() >= talkUntil || document.hidden) {
      talkTimer = 0;
      setTalking(false, false);
      return;
    }
    setTalking(true, open);
    open = !open;
    talkTimer = setTimeout(tick, FRAME_MS);
  };
  tick();
}

// `html` is our own static markup; callers escape any page-derived text.
export function advise(html, kind = 'info', ms = 6500) {
  log ||= document.getElementById('tr-msgs');
  if (!log) return;
  const line = document.createElement('div');
  line.className = `tr-msg ${kind}`;
  const who = kind === 'err' ? 'Alert' : kind === 'warn' ? 'Warning' : 'Adjutant';
  line.innerHTML = `<b>${who}:</b> ${html}`;
  log.appendChild(line);
  while (log.children.length > MAX) log.firstElementChild.remove();
  setTimeout(() => line.classList.add('fade'), ms);
  setTimeout(() => line.remove(), ms + 700);
  talk(ms);
}
