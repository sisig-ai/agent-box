// Console sound effects, synthesized with WebAudio (no audio assets).
// OFF by default; the M command button / hotkey toggles and remembers it.
let ctx = null;
let on = false;
let lastHover = 0;

const VOICES = {
  hover: { f: 1400, to: 1100, t: 0.035, g: 0.025, type: 'square' },
  click: { f: 700, to: 300, t: 0.07, g: 0.06, type: 'square' },
  select: { f: 520, to: 880, t: 0.12, g: 0.05, type: 'triangle' },
  ready: { f: 660, to: 990, t: 0.18, g: 0.06, type: 'triangle' },
  alert: { f: 220, to: 180, t: 0.35, g: 0.07, type: 'sawtooth' },
};

export function blip(name) {
  if (!on || document.hidden) return;
  const v = VOICES[name] || VOICES.click;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = v.type;
    osc.frequency.setValueAtTime(v.f, t0);
    osc.frequency.exponentialRampToValueAtTime(v.to, t0 + v.t);
    gain.gain.setValueAtTime(v.g, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + v.t);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + v.t + 0.02);
  } catch (e) { /* audio unavailable: stay silent */ }
}

export function initSound(btn) {
  try { on = localStorage.getItem('tr-sound') === '1'; } catch (e) { on = false; }
  const sync = () => {
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('.tr-cmd-lbl').textContent = on ? 'Sound' : 'Muted';
    btn.querySelector('.tr-glyph').textContent = on ? '♪' : '×';
  };
  btn.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem('tr-sound', on ? '1' : '0'); } catch (e) { /* private mode */ }
    sync();
    blip('select');
  });
  sync();
  const targets = '.tr-cmd-btn, .card, .brief-btn, .tool-btn, .kb-card, .files-row, .tele-card';
  document.addEventListener('pointerover', (e) => {
    if (!on || e.pointerType !== 'mouse') return;
    const t = e.target.closest && e.target.closest(targets);
    if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
    const now = performance.now();
    if (now - lastHover > 60) { lastHover = now; blip('hover'); }
  });
  document.addEventListener('click', (e) => {
    if (on && e.target.closest && e.target.closest(targets) && !e.target.closest('#tr-sound')) blip('click');
  }, true);
}
