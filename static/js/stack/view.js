// Stack view: the service grid, scanned with a text filter.
// Alpine component; the card markup lives in index.html. The router mounts it
// on first visit to #/ (the landing tab).

import Alpine from '../alpine.js';
import { loadConfig } from '../config.js';

// Well-known ports for the bundled *arr stack, used when a service has no URL.
const PORTS = {
  plex: { port: 32400, path: '/web' },
  sonarr: { port: 8989 }, radarr: { port: 7878 }, prowlarr: { port: 9696 },
  deluge: { port: 8112 }, bazarr: { port: 6767 }, lidarr: { port: 8686 },
  readarr: { port: 8787 }, jellyfin: { port: 8096 }, overseerr: { port: 5055 },
  tautulli: { port: 8181 }, transmission: { port: 9091 },
  qbittorrent: { port: 8080 }, flaresolverr: { port: 8191 },
};

const host = window.location.hostname;

function resolve(service) {
  if (service.url && !service.url.includes('localhost')) {
    let port = '';
    try { port = new URL(service.url).port; } catch { /* leave blank */ }
    return { url: service.url, port };
  }
  if (service.port) {
    return { url: `http://${host}:${service.port}${service.path || ''}`, port: String(service.port) };
  }
  const known = PORTS[String(service.icon || service.name).toLowerCase()];
  if (known) return { url: `http://${host}:${known.port}${known.path || ''}`, port: String(known.port) };
  return { url: service.url || '#', port: '' };
}

// Text monogram: two initials for a multi-word name, first two letters otherwise.
function glyph(service) {
  const words = String(service.name || '?').trim().split(/\s+/);
  const text = words.length > 1
    ? words.slice(0, 2).map((w) => w[0]).join('')
    : String(service.name || '?').trim().slice(0, 2);
  return text;
}

export function stackView() {
  return {
    services: [],
    query: '',
    failed: false,

    init() {
      loadConfig()
        .then((config) => {
          this.services = (config.services || []).map((service) => {
            const { url, port } = resolve(service);
            return {
              ...service,
              url,
              port,
              glyph: glyph(service),
              search: `${service.name} ${service.description || ''} ${port}`.toLowerCase(),
            };
          });
        })
        .catch(() => { this.failed = true; });
    },

    get visible() {
      const q = this.query.trim().toLowerCase();
      if (!q) return this.services;
      return this.services.filter((service) => service.search.includes(q));
    },

    get emptyText() {
      if (this.failed) return '// no contact with config.json';
      if (!this.services.length) return '// scanning…';
      const q = this.query.trim();
      return q ? `// no system matches "${q}"` : '// nothing to show';
    },

    cardStyle(service, index) {
      return `--i: ${index}${service.color ? `; --accent: ${service.color}` : ''}`;
    },

    openFirst() {
      const first = this.visible[0];
      if (first) window.open(first.url, '_blank', 'noopener');
    },

    // "/" focuses the scanner from anywhere on this view; Escape clears it.
    onKey(event) {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (event.key === '/' && document.body.dataset.view === 'stack' && !typing) {
        event.preventDefault();
        this.$refs.search.focus();
      }
    },
  };
}

export function mount(el) {
  if (!el || el.dataset.mounted) return;
  el.dataset.mounted = '1';
  Alpine.data('stackView', stackView);
  // mutateDom stops Alpine's observer for the attribute write, so the subtree
  // is initialised once, here, instead of twice (observer + initTree).
  // x-ignore also sets an in-memory flag during the first walk; clear both or
  // the walker keeps skipping the subtree.
  delete el._x_ignore;
  delete el._x_ignoreSelf;
  Alpine.mutateDom(() => {
    el.removeAttribute('x-ignore');
    el.setAttribute('x-data', 'stackView');
  });
  Alpine.initTree(el);
}
