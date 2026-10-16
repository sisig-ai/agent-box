const CACHE = "gmgn-shell-9";
const SHELL = [
  "/?app=gmgn",
  "/gmgn",
  "/static/css/base.css",
  "/static/css/gmgn.css?v=gmgn9",
  "/static/js/main.js?v=gmgn9",
  "/static/js/gmgn.js?v=gmgn9",
  "/static/js/gmgn-days.js?v=gmgn9",
  "/static/css/gmgn-days.css?v=gmgn9",
  "/icons/icon-192.png",
  "/icons/apple-touch-icon.png",
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
