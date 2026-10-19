// Boot: import the page modules in the same order the inline IIFEs ran.
// (Module scripts are deferred and evaluate in import order, so init order —
// and therefore every implicit dependency — is preserved.)
import './warpfield.js';
import './stack.js?v=clockpill1';
import './telemetry/poll.js';
import './router.js?v=kanban6';
import './notes/brief.js?v=sitrep2';
import './notes/schedule.js';
import './gmgn.js?v=gmgn13';
import './terran/console.js?v=terran7';
