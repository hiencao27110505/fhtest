/* FamilyHub — offline-first service worker */
const CACHE_NAME = 'familyhub-v107';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Only manage SAME-ORIGIN requests. Never touch cross-origin calls (Supabase
  // REST/RPC/Storage, Google, fonts): cache-first there froze API GETs at their
  // first response, so every write appeared to revert after loadFamilyData re-read.
  // Let them go straight to the network — always fresh.
  if (new URL(req.url).origin !== self.location.origin) return;
  // Network-first for the document so edits show up; cache fallback offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // Cache-first for everything else.
  e.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
