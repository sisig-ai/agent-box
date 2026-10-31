// Power-usage alerts: localStorage log + badge, fed by the 1s telemetry tick.
import { $ } from '../dom.js';
import { fmtW } from './graphs.js';

const pwrCard = $('tele-card-pwr'), pwrBadge = $('tele-pwr-badge'),
      pwrBadgeText = $('tele-pwr-badge-text'), pwrAlertsEl = $('tele-pwr-alerts'),
      pwrAlertCount = $('tele-pwr-alert-count');

/* ----- Power usage alerts: log when a tick exceeds 80W (60s cooldown) ----- */
const PWR_ALERT_THRESHOLD_W = 80;
const PWR_ALERT_COOLDOWN_MS = 60000;
const PWR_ALERTS_KEY = 'agent-box-pwr-alerts-v1';
const PWR_ALERTS_MAX = 50;
let pwrAlerts = [];
try {
  const raw = JSON.parse(localStorage.getItem(PWR_ALERTS_KEY) || '[]');
  if (Array.isArray(raw)) pwrAlerts = raw.filter(a => a && typeof a.watts === 'number').slice(-PWR_ALERTS_MAX);
} catch (err) { pwrAlerts = []; }
let lastPwrAlertAt = pwrAlerts.length ? Date.parse(pwrAlerts[pwrAlerts.length - 1].t) || 0 : 0;
let pwrBadgeVisible = false;

function savePwrAlerts() {
  try { localStorage.setItem(PWR_ALERTS_KEY, JSON.stringify(pwrAlerts.slice(-PWR_ALERTS_MAX))); } catch (err) {}
}

function renderPwrBadge() {
  if (!pwrBadge) return;
  pwrBadge.classList.toggle('show', pwrBadgeVisible);
  if (pwrCard) pwrCard.classList.toggle('pwr-alert', pwrBadgeVisible);
}

const fmtClock = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

function renderPwrAlerts() {
  if (!pwrAlertsEl) return;
  if (pwrAlertCount) pwrAlertCount.textContent = pwrAlerts.length ? ` (${pwrAlerts.length})` : '';
  if (!pwrAlerts.length) {
    pwrAlertsEl.innerHTML = `<div class="tele-alerts-empty">// no power alerts — threshold ${PWR_ALERT_THRESHOLD_W}W</div>`;
    return;
  }
  const rows = pwrAlerts.slice().reverse().map(a => {
    const detail = [a.cpu_w != null ? `cpu ${fmtW(a.cpu_w)}` : null,
                    a.gpu_w != null ? `gpu ${fmtW(a.gpu_w)}` : null]
      .filter(Boolean).join(' · ');
    return `<div class="tele-alert-row"><span class="w">⚠ ${fmtW(a.watts)} W</span>` +
      `<span>${detail ? detail + ' W · ' : ''}<time>${fmtClock(a.t)}</time></span></div>`;
  }).join('');
  pwrAlertsEl.innerHTML = `<div class="tele-alerts-head"><span>${pwrAlerts.length} alert${pwrAlerts.length === 1 ? '' : 's'} · &gt;${PWR_ALERT_THRESHOLD_W}W</span>` +
    `<button class="tele-alerts-clear" id="tele-pwr-alerts-clear">Clear</button></div>` + rows;
  const clearBtn = $('tele-pwr-alerts-clear');
  if (clearBtn) clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pwrAlerts = [];
    savePwrAlerts();
    renderPwrAlerts();
  });
}

function logPwrAlert(watts, s) {
  const entry = {
    t: (s && s.t) || new Date().toISOString(),
    watts,
    cpu_w: s && s.power ? s.power.cpu_w : null,
    gpu_w: s && s.power ? s.power.gpu_w : null,
  };
  pwrAlerts.push(entry);
  if (pwrAlerts.length > PWR_ALERTS_MAX) pwrAlerts.splice(0, pwrAlerts.length - PWR_ALERTS_MAX);
  savePwrAlerts();
  lastPwrAlertAt = Date.now();
  pwrBadgeVisible = true;
  if (pwrBadgeText) pwrBadgeText.textContent = `HIGH ${fmtW(watts)}W`;
  renderPwrBadge();
  renderPwrAlerts();
  console.warn(`[power] usage above ${PWR_ALERT_THRESHOLD_W}W: ${fmtW(watts)}W`, entry);
}

export function maybePwrAlert(totalW, s) {
  if (totalW == null || !isFinite(totalW) || totalW <= PWR_ALERT_THRESHOLD_W) return;
  if (Date.now() - lastPwrAlertAt < PWR_ALERT_COOLDOWN_MS) return;
  logPwrAlert(totalW, s);
}

if (pwrBadge) pwrBadge.addEventListener('click', (e) => {
  e.stopPropagation();
  pwrBadgeVisible = false;
  renderPwrBadge();
});

renderPwrAlerts();
renderPwrBadge();
