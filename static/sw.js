/* macmini PWA shell: offline app shell for the Next.js static export.
   - never touches /api or /mcp requests (network only)
   - cache-first for hashed /_next/static chunks (immutable filenames)
   - network-first with cache fallback for the index and /config.json
   - navigation fallback: try network, fall back to the cached shell */
const CACHE = "macmini-next-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") return;
  if (url.pathname.startsWith("/ws/")) return;

  /* Hashed build assets: cache-first. The chunk name changes when content
     changes, so a cached hit is always the current build. */
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  /* Everything else same-origin GET: network-first, cache fallback. */
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === "navigate" || url.pathname === "/config.json")) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : undefined))),
  );
});
