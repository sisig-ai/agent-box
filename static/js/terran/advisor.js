// Advisor transmissions: BW-style chat lines above the console. While a line
// is on screen the adjutant portrait/chip get a `talking` class (a static
// label/glow cue in CSS; the image never changes). Lines fade after a few
// seconds; at most MAX are shown.
const MAX = 5;
let log = null;
let portraits = [];
let talkUntil = 0;
let talkTimer = 0;

export function bindPortraits(els) { portraits = [...els]; }

function talk(ms) {
  if (!portraits.length) return;
  talkUntil = Math.max(talkUntil, Date.now() + ms);
  for (const p of portraits) p.classList.add('talking');
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => {
    for (const p of portraits) p.classList.remove('talking');
  }, talkUntil - Date.now());
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
