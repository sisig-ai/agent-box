// Boot: import the page modules in the same order the inline IIFEs ran.
// (Module scripts are deferred and evaluate in import order, so init order —
// and therefore every implicit dependency — is preserved.)
import './telemetry/poll.js';
import './router.js?v=author2';
import './notes/brief.js?v=sitrep2';
import './notes/schedule.js';
import './hotkeys.js?v=ascii2';
import Alpine from './alpine.js';
import { chrome } from './chrome.js?v=alpine2';

// One Alpine instance owns every x-data node. Views register and mount
// themselves from the router, so nothing waits on this call.
Alpine.data('chrome', chrome);
Alpine.start();

// The retired GMGN PWA registered a service worker; drop any leftover one.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.getRegistrations?.()
    .then((regs) => regs.forEach((reg) => reg.unregister()))
    .catch(() => {});
}
