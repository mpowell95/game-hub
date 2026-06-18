// sw.js — shared service worker for the Game Hub. Precaches the app shell and
// every game module's assets so the whole hub works offline.
//
// NETWORK-FIRST for code: a freshly deployed hub is always served when online
// (the old cache-first strategy left clients stuck on stale builds until they
// manually cleared the cache). The cache is only a fallback when offline.
//
// Bump CACHE when any precached asset changes to roll the cache over.
const CACHE = 'game-hub-v5';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/hub.css',
  './js/hub.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Connect Four module
  './connect-four/js/ui.js',
  './connect-four/js/worker.js',
  './connect-four/js/game.js',
  './connect-four/js/board.js',
  './connect-four/js/ai.js',
  './connect-four/css/connect-four.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    // Network-first: always try the network so a new deploy is served when
    // online; refresh the cache as we go for offline use.
    try {
      const res = await fetch(req);
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch (err) {
      // Offline (or fetch failed): fall back to cache, then the hub shell.
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
