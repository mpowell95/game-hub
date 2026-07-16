// sw.js — shared service worker for the Game Hub. Precaches the app shell and
// every game module's assets so the whole hub works offline.
//
// NETWORK-FIRST for code: a freshly deployed hub is always served when online
// (the old cache-first strategy left clients stuck on stale builds until they
// manually cleared the cache). The cache is only a fallback when offline.
//
// Bump CACHE when any precached asset changes to roll the cache over.
const CACHE = 'game-hub-v99';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/hub.css',
  './js/hub.js',
  './js/profile-store.js',
  './js/firebase-config.js',
  './js/game-stats.js',
  './js/game-stats-global.js',
  './js/game-stats-ui.js',
  './js/stats-net.js',
  // Profile page (profile project)
  './profile/',
  './profile/index.html',
  // Hidden challenge - inert unless the active profile name matches the hashed trigger
  './js/challenge/crypt.js',
  './js/challenge/secrets.js',
  './js/challenge/challenge-store.js',
  './js/challenge/hooks.js',
  './js/challenge/unlock.js',
  './js/challenge/reveal.js',
  './js/challenge/challenge-ui.js',
  './js/challenge/challenge-net.js',
  './css/challenge.css',
  // NOTE: the challenge celebration images (js/challenge/assets/*) are deliberately NOT
  // precached. They are ~9 MB of one-person gift content; forcing every PWA installer to
  // download them would violate the "inert for everyone else" guardrail. The fetch handler
  // below is cache-first for images, so they cache on Ana's first online view and then
  // replay offline. The challenge redemption still works without them (image hidden on error).
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
  // Chinchón module
  './chinchon/index.html',
  './chinchon/css/chinchon.css',
  './chinchon/js/deck.js',
  './chinchon/js/meld.js',
  './chinchon/js/cards.js',
  './chinchon/js/game.js',
  './chinchon/js/ai.js',
  './chinchon/js/ui.js',
  // Parchís (self-contained single file)
  './parchis/',
  './parchis/index.html',
  // NOTE: Nuts & Bolts (nuts-bolts/*) is deliberately NOT precached while it is devOnly.
  // Only Matt and the tester can even see its card, so making every PWA installer download
  // it would be waste; and a wrong path here would reject the whole cache.addAll() and
  // break the precache for everyone. The network-first fetch handler still caches it at
  // runtime for whoever actually plays it. Add it here when the game is released.
];

// Chinchón decks.
//   baraja-libre  Baraja Española — 48 faces + back (CC BY-SA 3.0, see its CREDITS.md)
//   anita         Española skin — ships custom pips (all four suits, ranks 1–9) + a
//                 custom back (Ana's photo); the figures (10–12) fall back to
//                 baraja-libre at runtime. See chinchon/decks/anita/CREDITS.md.
for (const s of ['oros', 'copas', 'espadas', 'bastos'])
  for (let r = 1; r <= 12; r++) ASSETS.push(`./chinchon/decks/baraja-libre/${s}-${r}.webp`);
ASSETS.push('./chinchon/decks/baraja-libre/back.webp');
for (const s of ['oros', 'copas', 'espadas', 'bastos'])
  for (let r = 1; r <= 9; r++) ASSETS.push(`./chinchon/decks/anita/${s}-${r}.webp`);
// Illustrated court cards done so far (add each as its art lands).
for (const s of ['oros', 'copas', 'espadas', 'bastos']) for (const r of [10, 11, 12]) ASSETS.push(`./chinchon/decks/anita/${s}-${r}.webp`);
ASSETS.push('./chinchon/decks/anita/back.webp');
// Anita end-of-match "Betty reaction" art (win/loss screens).
ASSETS.push('./chinchon/decks/anita/betty-win.webp', './chinchon/decks/anita/betty-loss.webp');

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

// Immutable static assets (images, fonts) — served cache-first so re-created
// <img> elements resolve instantly instead of waiting on a network round-trip
// (that latency made card boards flash blank on every re-render). These files
// are versioned by the CACHE bump on each deploy, so cache-first is always safe.
const STATIC_RE = /\.(webp|png|jpe?g|gif|svg|woff2?|ttf)$/i;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const sameOrigin = new URL(req.url).origin === self.location.origin;

  // Cache-first for immutable same-origin assets.
  if (sameOrigin && STATIC_RE.test(new URL(req.url).pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      } catch (err) {
        const fallback = await caches.match(req, { ignoreSearch: true });
        if (fallback) return fallback;
        throw err;
      }
    })());
    return;
  }

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
