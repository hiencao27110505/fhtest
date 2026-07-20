/* FamilyHub — offline-first service worker */
const CACHE_NAME = 'familyhub-v125';
/* Photos live in their own cache, deliberately NOT tied to CACHE_NAME. Folding
   them together would throw every photo away on each app release, which is the
   exact re-download this cache exists to prevent. Nothing here ever goes stale:
   a storage path embeds a timestamp and a random suffix and is never overwritten,
   so a given URL always means the same bytes.

   The -v2 suffix moves only when the cache's own semantics change, not per
   release. It moved once, from unsuffixed, to drop entries stored as opaque
   responses — see mediaFirst. The activate sweep deletes the old name for us. */
const MEDIA_CACHE = 'familyhub-media-v2';
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
  // Key by URL string rather than the Request. The gallery's <img> and the
  // Memories mosaic's CSS background-image fetch the same photo in different
  // modes, and they must resolve to ONE entry — keying by Request invites a
  // second copy of every photo.
  const key = req.url;
  const hit = await cache.match(key);
  if (hit) return hit;

  /* Always fetch CORS, whatever mode the caller used. Supabase returns
     access-control-allow-origin:* unconditionally, so this works for the CSS
     background tiles too, and a cors response satisfies a no-cors request fine —
     it is strictly more permissive. The point is that the response is not opaque:
     Chromium pads opaque cache entries by megabytes each regardless of real size,
     so a few hundred 60KB photos can be accounted as gigabytes and evicted long
     before real disk use warrants it. An opaque response also hides its status,
     which means a 404 or a 500 gets cached as though it were a photo. */
  try {
    const res = await fetch(key, { mode: 'cors', credentials: 'omit' });
    if (res && res.ok) {
      cache.put(key, res.clone()).then(() => trimMedia(cache)).catch(() => {});
      return res;
    }
    // A real error response: hand it back, but never store it, and don't retry as
    // no-cors — that would only convert a known failure into an opaque one.
    if (res) return res;
  } catch (e) { /* CORS itself failed — fall through */ }

  // Network blip, or something upstream stripping the header. Degrade to exactly
  // the previous behaviour (opaque, padded) rather than showing a broken photo.
  const plain = await fetch(req);
  if (plain && (plain.ok || plain.type === 'opaque')) {
    cache.put(key, plain.clone()).then(() => trimMedia(cache)).catch(() => {});
  }
  return plain;
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
