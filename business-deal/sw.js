/* =============================================================================
 * sw.js — Service worker for "Business Deal" / Monopoly Deal.
 *
 * NETWORK-FIRST for code so a freshly deployed build is always served when the
 * device is online (the old cache-first strategy left players stuck on stale
 * builds until they manually cleared the cache). The cache is only a fallback
 * for offline play. Bump CACHE on any asset change.
 * ===========================================================================*/
const CACHE = 'business-deal-hub-v26';

// Paths are relative so the app works from a GitHub Pages subfolder
// (e.g. /business-deal/) as well as the domain root.
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/deck.js',
  './js/game.js',
  './js/ai.js',
  './js/challenge-hook.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Tolerate individual asset failures so install never hard-fails.
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

// The page's "Reload" button posts SKIP_WAITING so a waiting worker takes over
// immediately (the page then reloads on controllerchange). Belt-and-suspenders
// alongside the install-time skipWaiting below.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Network-first: try the network, refresh the cache, fall back to cache only
  // when offline. Guarantees the latest deployed build whenever there's a
  // connection (no more "stuck on an old version").
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(event.request)) // offline → last cached copy
  );
});
