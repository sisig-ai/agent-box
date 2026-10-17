// Minimap: the page is the battlefield. Blips are the cards/rows of the
// active view, the white box is the camera (viewport). Tap or drag to
// scroll there. Redraws only on scroll/resize/view change and a slow tick.
const BLIPS = {
  stack: '#services .card',
  brief: '.brief-preview h1, .brief-preview h2, .brief-preview h3, .brief-preview li, .cal-event',
  files: '.files-row',
  shell: '#term',
  kanban: '.kb-card',
  gmgn: '.gmgn-card, .gmgn-screen-card',
};
const NAMES = { stack: 'command', brief: 'briefing', files: 'depot', shell: 'uplink', kanban: 'barracks', gmgn: 'refinery' };

export function initMinimap(box, canvas, label) {
  if (!box || !canvas) return;
  const ctx = canvas.getContext('2d');
  const terrain = new Image();
  terrain.src = '/static/img/terran/map.webp?v=terran1';
  terrain.onload = () => draw();
  let queued = false;

  function geometry() {
    const doc = document.documentElement;
    return { w: Math.max(1, window.innerWidth), h: Math.max(doc.scrollHeight, window.innerHeight) };
  }

  function draw() {
    queued = false;
    if (document.hidden || box.offsetParent === null) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = box.clientWidth, ch = box.clientHeight;
    if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#010603';
    ctx.fillRect(0, 0, cw, ch);
    if (terrain.complete && terrain.naturalWidth) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(terrain, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }
    const g = geometry();
    const sx = cw / g.w, sy = ch / g.h;
    const view = document.body.dataset.view || 'stack';
    if (label) label.textContent = NAMES[view] || view;
    const sel = BLIPS[view];
    if (sel) {
      let n = 0;
      for (const el of document.querySelectorAll(sel)) {
        if (++n > 400) break;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const x = Math.min(cw - 3, Math.max(0, (r.left + window.scrollX) * sx));
        const y = (r.top + window.scrollY) * sy;
        const w = Math.max(3, Math.min(r.width * sx, cw - x));
        const h = Math.max(3, r.height * sy);
        ctx.fillStyle = el.classList.contains('selected') || el.classList.contains('dragging') ? '#f5d547' : '#3dff73';
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      }
    }
    // camera
    ctx.strokeStyle = '#eaffef';
    ctx.lineWidth = 1;
    const cy = window.scrollY * sy, chh = Math.max(4, window.innerHeight * sy);
    ctx.strokeRect(1.5, Math.round(cy) + 0.5, cw - 3, Math.min(ch - 1, Math.round(chh)) - 1);
  }

  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  window.addEventListener('hashchange', () => setTimeout(queue, 60));
  setInterval(queue, 2000);
  queue();

  // click/drag to move the camera
  let dragging = false;
  const jump = (e) => {
    const r = canvas.getBoundingClientRect();
    const g = geometry();
    const y = ((e.clientY - r.top) / r.height) * g.h - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, y), behavior: dragging === 'drag' ? 'auto' : 'smooth' });
  };
  box.addEventListener('pointerdown', (e) => { dragging = true; box.setPointerCapture(e.pointerId); jump(e); });
  box.addEventListener('pointermove', (e) => { if (dragging) { dragging = 'drag'; jump(e); } });
  const stop = () => { dragging = false; };
  box.addEventListener('pointerup', stop);
  box.addEventListener('pointercancel', stop);
}
