// Boot: import the page modules in the same order the inline IIFEs ran.
// (Module scripts are deferred and evaluate in import order, so init order —
// and therefore every implicit dependency — is preserved.)
import './stack.js?v=clockpill1';
import './telemetry/poll.js';
import './router.js?v=kanban28';
import './notes/brief.js?v=sitrep2';
import './notes/schedule.js';
import './hotkeys.js?v=ascii2';

// The retired GMGN PWA registered a service worker; drop any leftover one.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.getRegistrations?.()
    .then((regs) => regs.forEach((reg) => reg.unregister()))
    .catch(() => {});
}
