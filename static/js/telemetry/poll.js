// Live telemetry: 1s /api/stats tick + power-tab wiring.
import { $, setTxt, setBar } from '../dom.js';
import { graphs, feed, drawGraph, placeTip, fmtW } from './graphs.js';
import { maybePwrAlert } from './alerts.js';

(() => {
  if (!$('telemetry')) return;

  const cpuUtil = $('tele-cpu-util'), cpuTemp = $('tele-cpu-temp'), cpuTempSrc = $('tele-cpu-temp-src'),
    cpuBar = $('tele-cpu-bar'), cpuTempBar = $('tele-cpu-temp-bar');
  const memUsed = $('tele-mem-used'), memTotal = $('tele-mem-total'),
        memFree = $('tele-mem-free'), memBar = $('tele-mem-bar');
  const pwrTotal = $('tele-pwr-total'), pwrSplit = $('tele-pwr-split'), pwrBar = $('tele-pwr-bar');

  document.querySelectorAll('#tele-card-pwr .tele-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = btn.dataset.ptab;
      const graph = btn.closest('.tele-graph');
      if (graph) graph.dataset.ptab = tab;
      document.querySelectorAll('#tele-card-pwr .tele-tab').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      if (tab === 'graph') requestAnimationFrame(() => drawGraph(graphs.pwr));
    });
  });

  const GiB = (b) => (b / 1073741824).toFixed(1);

  async function poll() {
    if (document.hidden) return; // skip ticks while tab is backgrounded
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = await res.json();
      const tsSec = Math.floor(new Date(s.t).getTime() / 1000);

      if (s.cpu && s.cpu.util_percent != null) {
        setTxt(cpuUtil, s.cpu.util_percent.toFixed(1));
        setBar(cpuBar, Math.round(Math.min(100, s.cpu.util_percent)) / 100);
        feed(graphs.cpu, tsSec, s.cpu.util_percent);
      } else if (s.cpu) {
        feed(graphs.cpu, tsSec, null);
      }
      if (s.cpu && s.cpu.temp_c != null) {
        setTxt(cpuTemp, s.cpu.temp_c.toFixed(1));
        if (cpuTempSrc) setTxt(cpuTempSrc, s.cpu.temp_source ? `${s.cpu.temp_source} · 30–100 °C` : 'CPU dies · 30–100 °C');
        const frac = Math.min(1, Math.max(0, (s.cpu.temp_c - 30) / (100 - 30)));
        setBar(cpuTempBar, Math.round(frac * 100) / 100);
      }
      if (s.mem) {
        setTxt(memUsed, GiB(s.mem.used_bytes));
        setTxt(memTotal, `/ ${GiB(s.mem.total_bytes)} GB`);
        setTxt(memFree, `available ${GiB(s.mem.available_bytes)} GB · ${s.mem.util_percent.toFixed(0)}% used`);
        setBar(memBar, Math.round(Math.min(100, s.mem.util_percent)) / 100);
        graphs.mem.scale.ymax = s.mem.total_bytes / 1073741824;
        feed(graphs.mem, tsSec, s.mem.used_bytes / 1073741824);
      }
      if (s.power) {
        setTxt(pwrTotal, s.power.total_w != null ? fmtW(s.power.total_w) : '—');
        const parts = [];
        if (s.power.cpu_w != null) parts.push(`cpu ${fmtW(s.power.cpu_w)}`);
        if (s.power.gpu_w != null) parts.push(`gpu ${fmtW(s.power.gpu_w)}`);
        if (s.power.ane_w != null) parts.push(`ane ${fmtW(s.power.ane_w)}`);
        setTxt(pwrSplit, s.power.source === 'Apple SMC' ? 'system · Apple SMC' : (parts.length ? parts.join(' · ') + ' W' : 'sampler unavailable'));
        pwrTotal.parentElement.title = s.power.note || '';
        setBar(pwrBar, s.power.total_w != null
          ? Math.round(Math.min(100, s.power.total_w / 100 * 100)) / 100
          : 0);
        feed(graphs.pwr, tsSec, s.power.total_w);
        maybePwrAlert(s.power.total_w, s);
      }

      for (const key of Object.keys(graphs)) {
        if (graphs[key].loaded && graphs[key].card.classList.contains('expanded')) {
          drawGraph(graphs[key]);
          if (graphs[key].hover >= 0 && graphs[key].tip &&
              graphs[key].tip.classList.contains('show')) {
            placeTip(graphs[key]);
          }
        }
      }
    } catch (err) {
      // keep last values on transient failure; next tick retries
    }
  }

  poll();
  setInterval(poll, 1000);
})();
