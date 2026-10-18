const CACHE = "gmgn-shell-18";
const SHELL = [
  "/?app=gmgn",
  "/gmgn",
  "/static/css/base.css",
  "/static/css/gmgn.css?v=gmgn11",
  "/static/js/main.js?v=terran6",
  "/static/js/gmgn.js?v=gmgn13",
  "/static/js/gmgn-days.js?v=gmgn13",
  "/static/css/gmgn-days.css?v=gmgn10",
  "/static/js/gmgn-graphs.js?v=gmgn13",
  "/static/js/gmgn-viewport.js?v=gmgn10",
  "/static/css/gmgn-graphs.css?v=gmgn10",
  "/icons/icon-192.png?v=terran1",
  "/icons/apple-touch-icon.png?v=terran1",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
