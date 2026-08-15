// sw.js — shared service worker for the Game Hub. Precaches the app shell and
// every game module's assets so the whole hub works offline.
//
// NETWORK-FIRST for code: a freshly deployed hub is always served when online
// (the old cache-first strategy left clients stuck on stale builds until they
// manually cleared the cache). The cache is only a fallback when offline.
//
// Bump CACHE when any precached asset changes to roll the cache over.
const CACHE = 'game-hub-v329';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/hub.css',
  './css/name-gate.css',
  // The shared UI layer (2026-08-01). Injected by whichever surface opts in, not linked from
  // index.html, so it needs listing here in its own right to survive offline.
  './css/ui.css',
  './js/hub.js',
  './js/name-gate.js',
  './js/name-gate-auto.js',
  './js/a2hs.js',
  './js/favorites.js',
  './js/new-badge.js',
  './js/i18n.js',
  './js/theme.js',
  './js/viewport.js',
  './js/strings.js',
  './js/profile-store.js',
  './js/firebase-config.js',
  './js/game-stats.js',
  './js/arcade-scores.js',
  './js/game-stats-global.js',
  './js/game-stats-ui.js',
  './js/stats-net.js',
  './js/firebase-boot.js',
  './js/device-report.js',
  // Report a bug (2026-08-11) + the launcher announcement that introduces it. All five are shell
  // assets (they live under js/), so they install atomically with the hub itself - the report form
  // has to work on the exact device that is having trouble, including offline, where it queues the
  // report locally and sends it on the next connection.
  './js/error-log.js',
  './js/bug-report.js',
  './js/bug-report-ui.js',
  './js/announce.js',
  './js/announce-ui.js',
  // Shared by stats-net.js (mirrors it to players/<id>/device on every sync) and bug-report.js,
  // so it is genuinely app-shell: without it the hub cannot boot offline.
  './js/install-state.js',
  // The announcement's "here is where the button lives" pictures. Deliberately NOT under ./icons/
  // (which isShellAsset treats as shell): they are a one-time popup's illustrations, so they belong
  // in the best-effort REST tier where a bad path cannot strand an install. announce-ui.js removes
  // any figure whose image fails to load, so a device that has not warmed them yet still gets a
  // working popup.
  './img/where-hub.jpg',
  './img/where-hub-dark.jpg',
  './img/where-hub-es.jpg',
  './img/where-hub-es-dark.jpg',
  './img/where-profile.jpg',
  './img/where-profile-dark.jpg',
  './img/where-profile-es.jpg',
  './img/where-profile-es-dark.jpg',
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
  './filler/js/hash.js',
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
  './mancala/js/howto.js',
  './mancala/js/ui.js',
  './mancala/js/hash.js',
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
  './tic-tac-toe/js/hash.js',
  './tic-tac-toe/js/strings.js',
  // Dots and Boxes module
  './dots-boxes/',
  './dots-boxes/index.html',
  './dots-boxes/css/dots-boxes.css',
  './dots-boxes/js/ui.js',
  './dots-boxes/js/game.js',
  './dots-boxes/js/ai.js',
  './dots-boxes/js/hash.js',
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
  './boggle/js/mp-round.js',
  './boggle/data/words.txt',
  './snake/',
  './snake/index.html',
  './snake/css/snake.css',
  './snake/js/ui.js',
  './snake/js/game.js',
  './snake/js/strings.js',
  // Hill Climb (2026-08-02). Note test.js is deliberately NOT listed: it is a node-only engine
  // suite, never loaded by the page (same convention as every other game's test file).
  './pinball/',
  './pinball/index.html',
  './pinball/css/pinball.css',
  './pinball/js/ui.js',
  './pinball/js/game.js',
  './pinball/js/physics.js',
  './pinball/js/table.js',
  './pinball/js/render.js',
  './pinball/js/store.js',
  './pinball/js/strings.js',
  './hill-climb/',
  './hill-climb/index.html',
  './hill-climb/css/hill-climb.css',
  './hill-climb/js/ui.js',
  './hill-climb/js/physics.js',
  './hill-climb/js/terrain.js',
  './hill-climb/js/render.js',
  './hill-climb/js/catalog.js',
  './hill-climb/js/store.js',
  './hill-climb/js/strings.js',
  // Skeeball (2026-08-11). test.js is deliberately NOT listed: node-only engine suite, never
  // loaded by the page (same convention as every other game's test file).
  './skeeball/',
  './skeeball/index.html',
  './skeeball/css/skeeball.css',
  './skeeball/js/ui.js',
  './skeeball/js/game.js',
  './skeeball/js/physics.js',
  './skeeball/js/howto.js',
  './skeeball/js/boards.js',
  './skeeball/js/render.js',
  './skeeball/js/machine.js',
  './skeeball/js/vendor/cannon-es.js',
  './skeeball/js/vendor/three.module.min.js',
  './skeeball/js/vendor/three.core.min.js',
  './skeeball/js/strings.js',
  './skeeball_old/',
  './skeeball_old/index.html',
  './skeeball_old/css/skeeball_old.css',
  './skeeball_old/js/ui.js',
  './skeeball_old/js/game.js',
  './skeeball_old/js/physics.js',
  './skeeball_old/js/howto.js',
  './skeeball_old/js/boards.js',
  './skeeball_old/js/render.js',
  './skeeball_old/js/strings.js',
  // Snake v2 (devOnly preview, 2026-08-01): the card renders only for isDevProfile(), but the
  // FILES must be precached like any other deployed page or the preview breaks offline. It has
  // no game.js or strings.js of its own on purpose - it imports Snake's (see snake-v2/CLAUDE.md),
  // and both are already listed above.
  './snake-v2/',
  './snake-v2/index.html',
  './snake-v2/css/snake-v2.css',
  './snake-v2/js/ui.js',
  './snake-v2/js/strings.js',
  './dominoes/',
  './dominoes/index.html',
  './dominoes/css/dominoes.css',
  './dominoes/js/ui.js',
  './dominoes/js/game.js',
  './dominoes/js/board.js',
  './dominoes/js/ai.js',
  './dominoes/js/tiles.js',
  './dominoes/js/tutorial.js',
  './dominoes/js/strings.js',
  './uno/',
  './uno/index.html',
  './uno/css/uno.css',
  './uno/js/ui.js',
  './uno/js/game.js',
  './uno/js/ai.js',
  './uno/js/strings.js',
  // Yahtzee module
  './pool/css/pool.css',
  './pool/index.html',
  './pool/js/ai.js',
  './pool/js/hash.js',
  './pool/js/physics.js',
  './pool/js/rng.js',
  './pool/js/rules.js',
  './pool/js/strings.js',
  './pool/js/table.js',
  './pool/js/ui.js',
  './pool/js/worker.js',
  './yahtzee/',
  './yahtzee/index.html',
  './yahtzee/css/yahtzee.css',
  './yahtzee/js/howto.js',
  './yahtzee/js/strings.js',
  './yahtzee/js/ui.js',
  './yahtzee/js/hash.js',
  // Battleship (2026-08-04). Note test.js is deliberately NOT listed: it is a node-only engine
  // suite, never loaded by the page (same convention as every other game's test file).
  './battleship/',
  './battleship/index.html',
  './battleship/css/battleship.css',
  './battleship/js/ui.js',
  './battleship/js/game.js',
  './battleship/js/fleet.js',
  './battleship/js/ai.js',
  './battleship/js/hash.js',
  './battleship/js/ship-art.js',
  './battleship/js/strings.js',
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

// --- two-tier precache -------------------------------------------------------------------------
// `cache.addAll(ASSETS)` on the whole list was ~8.8 MB across ~272 files, downloaded ATOMICALLY on
// every single deploy (CACHE is bumped essentially every commit). Two things went wrong with that:
//
//   1. Speed. The install storm competes with the foreground page for the same connection. On a
//      weak mobile signal the hub is visibly sluggish for as long as the storm lasts, because the
//      launcher's own module requests are queued behind ~272 precache requests, including the
//      1.6 MB Boggle dictionary and 672 KB of three.js for games the player has not opened.
//   2. Fragility. `addAll` is atomic, so ONE bad path aborted the whole install and the previous
//      worker kept serving the old build forever - the "version pill stuck at vN -> vN+1" failure
//      documented in the root CLAUDE.md. A missing card image could strand an entire deploy.
//
// So the list is split. SHELL is the hub itself (app shell + shared js/css + icons + profile): tiny,
// atomic, and genuinely required for the hub to boot offline. Everything else is warmed AFTER
// activation, best-effort, one file at a time with bounded concurrency, skipping whatever is already
// cached. A game whose warm gets interrupted is not broken - the fetch handler caches it on demand
// the first time it is opened online, and the next activation resumes the warm where it left off.
//
// validate-sw-assets.mjs still checks the full ASSETS list, so a 404'd path is still caught before
// deploy; it just no longer strands the build if one slips through.
function isShellAsset(p) {
  return p === './' || p === './index.html' || p === './manifest.webmanifest'
    || p.startsWith('./css/') || p.startsWith('./js/')
    || p.startsWith('./icons/') || p.startsWith('./profile/');
}
const SHELL = ASSETS.filter(isShellAsset);
const REST = ASSETS.filter((p) => !isShellAsset(p));

// Warm the non-shell tier. Best-effort by design, but never SILENTLY best-effort (THE LAW rule 6):
// whatever could not be cached is logged with its paths so a broken deploy is diagnosable from the
// console instead of only showing up as a game that mysteriously fails offline.
const WARM_CONCURRENCY = 6;
async function warmRest() {
  const cache = await caches.open(CACHE);
  const queue = REST.slice();
  const failed = [];
  const worker = async () => {
    for (;;) {
      const path = queue.shift();
      if (path === undefined) return;
      try {
        // Resumable: an entry already cached (by a previous warm, or on demand by the fetch
        // handler) costs one cache lookup instead of a network round trip.
        if (await cache.match(path, { ignoreSearch: true })) continue;
        const res = await fetch(new Request(path, { cache: 'reload' }));
        if (res && res.ok) await cache.put(path, res.clone());
        else failed.push(path);
      } catch { failed.push(path); }
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
  if (failed.length) {
    console.warn(`[sw] ${CACHE}: ${failed.length}/${REST.length} non-shell assets could not be precached`
      + ' (they will be cached on demand when first opened online):', failed);
  }
}

// ONE-TIME FULL PURGE (2026-08-04). Normally `activate` deletes only caches whose name DIFFERS
// from CACHE, which is right: it makes a deploy cheap and lets an interrupted warm resume. But it
// also means a cache entry that is stale, truncated or half-written under its CURRENT name is
// never re-fetched -- the worker keeps serving the bad copy forever, and a player whose hub renders
// nothing has no way to clear it from inside an app that will not start.
//
// That is the state Matt's phone reached: a blank hub in Chrome AND from the home-screen icon,
// while every file on the server returned 200 and the identical build ran fine everywhere it could
// be tested. So this build purges EVERY cache on activate, current name included, and rebuilds the
// shell from the network.
//
// Set back to false once a purge has shipped and the device is confirmed healthy. Leaving it on
// permanently would re-download ~8.8 MB on every single deploy, which is exactly the storm the
// two-tier precache exists to avoid. It is a recovery lever, not the steady state.
const PURGE_ALL_CACHES = false;

self.addEventListener('install', (event) => {
  // Only the shell blocks the install. The new build goes live as soon as the hub itself is safe
  // offline, instead of waiting on every card image of every game.
  //
  // With the purge on, the shell is fetched with `cache: 'reload'` so the HTTP disk cache cannot
  // hand back the same stale bytes the SW cache is being purged FOR. A purge that re-imports the
  // corruption it just deleted is not a recovery.
  event.waitUntil(
    (async () => {
      if (PURGE_ALL_CACHES) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      const cache = await caches.open(CACHE);
      await cache.addAll(PURGE_ALL_CACHES ? SHELL.map((u) => new Request(u, { cache: 'reload' })) : SHELL);
      await self.skipWaiting();
    })()
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
      // Warm the heavy tier only once the worker is claimed and serving. Deliberately NOT awaited
      // inside this waitUntil: functional events (every fetch the page makes) wait on the activate
      // handler's promise, so awaiting the warm here would block the very page load the split was
      // meant to speed up. Fire-and-forget is correct - if the worker is killed mid-warm, the next
      // activation resumes it and the fetch handler covers anything still missing.
      .then(() => { warmRest().catch((err) => console.warn('[sw] precache warm failed', err)); })
  );
});

// Immutable static assets (images, fonts) — served cache-first so re-created
// <img> elements resolve instantly instead of waiting on a network round-trip
// (that latency made card boards flash blank on every re-render). These files
// are versioned by the CACHE bump on each deploy, so cache-first is always safe.
const STATIC_RE = /\.(webp|png|jpe?g|gif|svg|woff2?|ttf)$/i;

// How long a code/markup request waits on the network before the cached copy is served instead.
// Long enough that a merely-average connection still wins the race (and the player keeps getting
// the freshest build), short enough that a bad one never makes the hub feel broken.
const NET_TIMEOUT_MS = 2500;
const TIMED_OUT = Symbol('timed-out');
function deadline(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), ms));
}

// "The network is bad right now" latch.
//
// The deadline alone is charged PER REQUEST, and a hub cold start is a serial chain: index.html,
// then hub.js, then the modules hub.js imports, then the modules THEY import. Every hop pays the
// full deadline again, so on a genuinely bad link the deadline turned a 40s load into a 10s one -
// better, but still four separate 2.5s stalls for a build already sitting complete in the cache.
//
// Once ONE request has proven the connection is slower than the deadline, the rest of that page
// load should not each re-discover it. While this latch is hot, a request WITH a cached copy is
// served from cache immediately and revalidated in the background; a request with nothing cached is
// unaffected and still waits for the network. The latch expires on its own, so a connection that
// recovers goes straight back to network-first without needing an event to tell it so.
//
// Freshness cost is bounded and small: the cache is a coherent one-deploy snapshot (`activate`
// deletes every other cache), every latched response still revalidates in the background, and the
// hub's version pill continues to show and force-fix a newer deploy on tap.
const SLOW_LATCH_MS = 10000;
let _slowUntil = 0;

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
    // Network-first WITH A DEADLINE, falling back to the cached copy.
    //
    // Sixth-playthrough fix (the "sluggish on bad service" report): plain network-first only fell
    // back to cache when the fetch FAILED. A weak-but-alive mobile signal never fails - it just
    // takes many seconds per request, and `cache: 'reload'` below deliberately bypasses the
    // browser's own HTTP cache, so EVERY module in the graph paid that latency on every load. A
    // hub cold start is 15 blocking module requests plus index.html and hub.css; at a couple of
    // seconds each, serially resolved as the module graph unfolds, that is the sluggishness.
    //
    // Racing a NET_TIMEOUT_MS deadline fixes the bad-network case without touching the good-network
    // one: on a healthy connection the network still wins every race and freshness is unchanged. On
    // a slow one the player gets the cached copy immediately while the network response continues in
    // the background and refreshes the cache for next time.
    //
    // Consistency is preserved: `activate` deletes every non-current cache and `install` re-adds the
    // shell, so the cache this falls back to is a coherent snapshot of one deploy, not a mix. The
    // hub's version pill still surfaces "a newer build is deployed" and force-updates on tap.
    //
    // Requests with nothing cached to fall back on skip the race entirely and just wait - a deadline
    // would only turn a slow load into a failed one.
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
    // Kicked off first so the network is already in flight while the cache is consulted. The
    // background cache refresh is attached HERE rather than at the await site, so it still happens
    // on the slow path where the deadline fired and nobody is awaiting this promise any more.
    const net = fetch(new Request(req, { cache: 'reload' })).then((res) => {
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => { /* cache full/evicted */ });
      }
      return res;
    });
    // A rejection is handled at both await sites below, but on the deadline path neither of them is
    // still listening; without this the failure would surface as an unhandled rejection in the SW.
    net.catch(() => { /* handled below, or deliberately ignored on the deadline path */ });

    const cached = await caches.match(req, { ignoreSearch: true });

    if (!cached) {
      try {
        return await net;
      } catch (err) {
        // Offline (or fetch failed) with nothing cached: the hub shell is the last resort, and
        // only for a navigation.
        if (req.mode === 'navigate') {
          const shell = await caches.match('./');
          if (shell) return shell;
        }
        throw err;
      }
    }

    // A recent request already proved this connection is slower than the deadline: don't make this
    // one re-prove it. Serve the cached copy now; `net` is already in flight and refreshes the cache.
    if (Date.now() < _slowUntil) return cached;

    try {
      const res = await Promise.race([net, deadline(NET_TIMEOUT_MS)]);
      if (res === TIMED_OUT) {
        // The network lost the race: serve the cached copy now, and latch so the rest of this page
        // load skips straight to cache instead of stalling once per module in the graph.
        _slowUntil = Date.now() + SLOW_LATCH_MS;
        return cached;
      }
      // A 404/503 IS NOT AN ANSWER when we are holding a good copy (2026-08-11).
      //
      // Only a THROWN fetch counted as failure here, so an error RESPONSE was handed straight to
      // the page. GitHub Pages serves a redeploy by swapping the published tree, and a request
      // landing in that window can 404 for a moment - so opening the hub during a deploy could
      // hand the page a 404 for css/hub.css while a perfectly good copy sat in the cache one line
      // away. The result is the launcher rendered as raw unstyled HTML. Matt hit it minutes after
      // a deploy, on mobile data; a force-close fixed it, which is exactly what a transient
      // server error looks like.
      //
      // Falling back to the cached copy is also the right call for a genuinely removed file: this
      // is an offline-first app, and the cache is a coherent snapshot of one deploy that rolls
      // over when CACHE is bumped. `net` has already refreshed the cache above if the response
      // WAS ok, so nothing goes stale by doing this.
      if (!res || !res.ok) return cached;
      return res;
    } catch {
      return cached;   // offline, or the request failed outright
    }
  })());
});
