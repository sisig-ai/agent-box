// Tiny shared DOM helpers.

// Shorthand for document.getElementById.
export const $ = (id) => document.getElementById(id);

// HTML-escape text before it goes through innerHTML. Superset of what the
// terminal needs (also quotes) so one helper covers the tty and the files UI.
export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Change-gated DOM writes. Chrome invalidates layout+paint even when you
// assign an identical textContent/transform, and a 0.5 s transition turned
// every 1 Hz tick into ~30 vsync-rate compositor frames over a 5K viewport.
// Gate every write on an actual change; bars snap (1 Hz data needs no
// animation) and are quantized to 1% steps so sensor jitter doesn't repaint.
export function setTxt(el, s) {
  if (el.__t !== s) { el.__t = s; el.textContent = s; }
}

export function setBar(el, frac) {
  const t = `scaleX(${frac})`;
  if (el.__b !== t) { el.__b = t; el.style.transform = t; }
}
