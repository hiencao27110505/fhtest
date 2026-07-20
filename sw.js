/* FamilyHub — offline-first service worker */
const CACHE_NAME = 'familyhub-v122';
/* Photos live in their own cache, and its name is deliberately UNVERSIONED.
   Folding them into CACHE_NAME would throw every photo away on each app release,
   which is the exact re-download this cache exists to prevent. Nothing here ever
   goes stale: a storage path embeds a timestamp and a random suffix and is never
   overwritten, so a given URL always means the same bytes. */
const MEDIA_CACHE = 'familyhub-media';
const MEDIA_PREFIX = '/storage/v1/object/public/';
const MEDIA_MAX = 400;                      // ~400 photos, then evict oldest-first
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
      // MEDIA_CACHE must survive the sweep — it is not versioned, so it would
      // otherwise be deleted on every release.
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== MEDIA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Cache-first, no revalidation, because these bytes cannot change. Survives
   HTTP-cache eviction, which is what made reopening the app re-fetch photos it
   had already loaded — Supabase serves the existing objects with max-age=3600,
   so anything older than an hour cost a round trip per photo just to be told
   nothing had changed. */
async function mediaFirst(req) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // <img> and CSS background-image issue no-cors requests, so success here is an
  // opaque response (status 0). Opaque is still cacheable and still renders; only
  // res.ok would wrongly reject it.
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone()).then(() => trimMedia(cache)).catch(() => {});
  }
  return res;
}

// Cache API preserves insertion order, so the oldest entries are simply the first.
async function trimMedia(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= MEDIA_MAX) return;
    await Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map((k) => cache.delete(k)));
  } catch (e) {}
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Photos are the one cross-origin exception: immutable paths, so caching them
  // can't serve anything stale. This must come BEFORE the bail-out below.
  if (url.pathname.startsWith(MEDIA_PREFIX)) { e.respondWith(mediaFirst(req)); return; }
  // Only manage SAME-ORIGIN requests otherwise. Never touch cross-origin calls
  // (Supabase REST/RPC, Google, fonts): cache-first there froze API GETs at their
  // first response, so every write appeared to revert after loadFamilyData re-read.
  // Let them go straight to the network — always fresh.
  if (url.origin !== self.location.origin) return;
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
