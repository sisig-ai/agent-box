// Advisor transmissions: BW-style chat lines above the console. Lines fade
// after a few seconds; at most MAX are on screen.
const MAX = 5;
let log = null;

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
}
