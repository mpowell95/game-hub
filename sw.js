// sw.js — shared service worker for the Game Hub. Precaches the app shell and
// every game module's assets so the whole hub works offline.
//
// NETWORK-FIRST for code: a freshly deployed hub is always served when online
// (the old cache-first strategy left clients stuck on stale builds until they
// manually cleared the cache). The cache is only a fallback when offline.
//
// Bump CACHE when any precached asset changes to roll the cache over.
const CACHE = 'game-hub-v195';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/hub.css',
  './js/hub.js',
  './js/a2hs.js',
  './js/favorites.js',
  './js/i18n.js',
  './js/strings.js',
  './js/profile-store.js',
  './js/firebase-config.js',
  './js/game-stats.js',
  './js/game-stats-global.js',
  './js/game-stats-ui.js',
  './js/stats-net.js',
  './js/firebase-boot.js',
  './js/device-report.js',
  './js/players-agg.js',
  './js/game-art.js',
  './js/leaderboard-ui.js',
  './js/leaderboard-rank.js',
  './js/difficulty-tiers.js',
  './js/net.js',
  // Profile page (profile project)
  './profile/',
  './profile/index.html',
  // Hidden challenge (M3b: retired, gift complete) - challenge-ui.js/unlock.js are now
  // unimported dead modules, kept precached only for reversibility; keepsake.js is the
  // one surviving read-only entry point (js/hub.js's Challenge button).
  './js/challenge/crypt.js',
  './js/challenge/secrets.js',
  './js/challenge/challenge-store.js',
  './js/challenge/hooks.js',
  './js/challenge/unlock.js',
  './js/challenge/reveal.js',
  './js/challenge/challenge-ui.js',
  './js/challenge/challenge-net.js',
  './js/challenge/keepsake.js',
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
  './connect-four/index.html',
  './connect-four/js/ui.js',
  './connect-four/js/worker.js',
  './connect-four/js/game.js',
  './connect-four/js/board.js',
  './connect-four/js/ai.js',
  './connect-four/js/strings.js',
  './connect-four/css/connect-four.css',
  // Chinchón module
  './chinchon/index.html',
  './chinchon/css/chinchon.css',
  './chinchon/js/deck.js',
  './chinchon/js/meld.js',
  './chinchon/js/cards.js',
  './chinchon/js/game.js',
  './chinchon/js/hash.js',
  './chinchon/js/ai.js',
  './chinchon/js/ui.js',
  './chinchon/js/strings.js',
  // Parchís (self-contained single file)
  './parchis/',
  './parchis/index.html',
  // Filler module
  './filler/',
  './filler/index.html',
  './filler/css/filler.css',
  './filler/js/ui.js',
  './filler/js/game.js',
  './filler/js/ai.js',
  './filler/js/strings.js',
  // Escoba module (card faces come from the shared Anita deck, precached below)
  './escoba/index.html',
  './escoba/css/escoba.css',
  './escoba/js/deck.js',
  './escoba/js/cards.js',
  './escoba/js/game.js',
  './escoba/js/hash.js',
  './escoba/js/ai.js',
  './escoba/js/ui.js',
  './escoba/js/strings.js',
  './escoba/img/broom-sprite.webp',
  // Mancala module
  './mancala/index.html',
  './mancala/css/mancala.css',
  './mancala/js/game.js',
  './mancala/js/ai.js',
  './mancala/js/ui.js',
  './mancala/js/strings.js',
  // Nuts & Bolts
  './nuts-bolts/',
  './nuts-bolts/index.html',
  './nuts-bolts/css/nuts-bolts.css',
  './nuts-bolts/js/ui.js',
  './nuts-bolts/js/game.js',
  './nuts-bolts/js/generator.js',
  './nuts-bolts/js/strings.js',
  // Tic Tac Toe module
  './tic-tac-toe/',
  './tic-tac-toe/index.html',
  './tic-tac-toe/css/tic-tac-toe.css',
  './tic-tac-toe/js/ui.js',
  './tic-tac-toe/js/game.js',
  './tic-tac-toe/js/ai.js',
  './tic-tac-toe/js/strings.js',
  // Dots and Boxes module
  './dots-boxes/',
  './dots-boxes/index.html',
  './dots-boxes/css/dots-boxes.css',
  './dots-boxes/js/ui.js',
  './dots-boxes/js/game.js',
  './dots-boxes/js/ai.js',
  './dots-boxes/js/strings.js',
  // Ball Run module
  './ball-run/index.html',
  './ball-run/css/ball-run.css',
  './ball-run/js/ui.js',
  './ball-run/js/config.js',
  './ball-run/js/track.js',
  './ball-run/js/sim.js',
  './ball-run/js/input.js',
  './ball-run/js/render.js',
  './ball-run/js/strings.js',
  './ball-run/vendor/three.module.min.js',
  // Boggle module (data/words.txt is the ~1.6MB dictionary the solver and human
  // input validation both need -- it must be precached or the game is broken
  // offline, same as any code asset)
  './boggle/',
  './boggle/index.html',
  './boggle/css/boggle.css',
  './boggle/js/ui.js',
  './boggle/js/strings.js',
  './boggle/js/game.js',
  './boggle/js/dict.js',
  './boggle/js/solver.js',
  './boggle/js/ai.js',
  './boggle/data/words.txt',
  './snake/',
  './snake/index.html',
  './snake/css/snake.css',
  './snake/js/ui.js',
  './snake/js/game.js',
  './snake/js/strings.js',
];

// NOTE: the Add-to-Home-Screen sheet's iOS step screenshots (icons/a2hs/*.png,
// referenced from js/a2hs.js) are deliberately NOT precached here yet — those
// files don't exist in the repo until real screenshots are supplied. The fetch
// handler below is cache-first for images, so once the files land, add their
// paths to ASSETS and bump CACHE (until then a missing image just fails to
// load and the <img> removes itself; the sheet still works, minus the picture).

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

// The hub header's version pill asks the ACTIVE worker which build it runs.
// Reply over the provided MessageChannel port so the answer reaches the caller
// even with multiple clients open.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ type: 'VERSION', cache: CACHE });
  }
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
    //
    // Fifth-playthrough fix: `fetch(req)` alone is NOT enough - the browser's own HTTP disk
    // cache sits between this handler and the wire, and a GET whose response carried a
    // cacheable Cache-Control/expiry can be satisfied straight out of that disk cache without
    // ever reaching the server, even though this code path is labeled "network-first". That is
    // exactly how a stats/leaderboard regression (a full deploy, CACHE bumped, SW re-activated)
    // still showed some shared js/ files running old code while other, less-recently-fetched
    // files picked up the new deploy immediately: whichever files happened to already be sitting
    // in a given device's HTTP cache with unexpired headers kept being served stale by the
    // browser itself, invisibly to this SW. `cache: 'reload'` on the Request forces the browser
    // to bypass its HTTP cache and revalidate with the server on every fetch, while still letting
    // the response populate that HTTP cache normally for next time.
    try {
      const res = await fetch(new Request(req, { cache: 'reload' }));
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
