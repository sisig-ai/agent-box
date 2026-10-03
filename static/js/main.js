// Boot: import the page modules in the same order the inline IIFEs ran.
// (Module scripts are deferred and evaluate in import order, so init order —
// and therefore every implicit dependency — is preserved.)
import './warpfield.js';
import './stack.js';
import './telemetry/poll.js';
import './router.js';
import './notes/brief.js';
import './notes/schedule.js';
