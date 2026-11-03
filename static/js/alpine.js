// Alpine 3, vendored so the dashboard never depends on a CDN at runtime.
//
// Alpine starts once from main.js and owns every node that carries x-data.
// The hash router stays the lazy loader: a view module registers its component
// with Alpine.data, sets x-data on its section, and calls Alpine.initTree. That
// keeps each view's component out of the initial bundle while the markup lives
// in index.html where Alpine can read it.
import Alpine from '../vendor/alpine-3.14.9.esm.js';

window.Alpine = Alpine;
export default Alpine;
