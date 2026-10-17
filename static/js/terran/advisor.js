// Advisor transmissions: BW-style chat lines above the console, plus the
// portrait "talking" for a moment. Lines fade after a few seconds.
const MAX = 5;
let log = null;
let portrait = null;
let talkTimer = 0;

export function bindPortrait(el) { portrait = el; }

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
  if (portrait && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    portrait.classList.remove('talk');
    void portrait.offsetWidth; // restart the finite animation
    portrait.classList.add('talk');
    clearTimeout(talkTimer);
    talkTimer = setTimeout(() => portrait.classList.remove('talk'), 2400);
  }
}
