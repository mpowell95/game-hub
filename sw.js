// sw.js — shared service worker for the Game Hub. Precaches the app shell and
// every game module's assets so the whole hub works offline.
//
// NETWORK-FIRST for code: a freshly deployed hub is always served when online
// (the old cache-first strategy left clients stuck on stale builds until they
// manually cleared the cache). The cache is only a fallback when offline.
//
// Bump CACHE when any precached asset changes to roll the cache over.
const CACHE = 'game-hub-v449';

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
  './js/mp-code-copy.js',
  './js/mp-reactions.js',
  './js/mp-reactions-ui.js',
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
  './skeeball/flick-test.html',
  './skeeball/css/skeeball.css',
  './skeeball/js/ui.js',
  './skeeball/js/swipe.js',
  './skeeball/js/game.js',
  './skeeball/js/goals.js',
  './skeeball/js/boards.js',
  './skeeball/js/engines.js',
  './skeeball/js/machines/classic/physics.js',
  './skeeball/js/machines/classic/machine.js',
  './skeeball/js/machines/classic/render.js',
  './skeeball/js/machines/popongo/physics.js',
  './skeeball/js/machines/popongo/machine.js',
  './skeeball/js/machines/popongo/render.js',
  './skeeball/js/machines/basketball/physics.js',
  './skeeball/js/machines/basketball/machine.js',
  './skeeball/js/machines/basketball/render.js',
  './skeeball/js/vendor/cannon-es.js',
  './skeeball/js/vendor/three.module.min.js',
  './skeeball/js/vendor/three.core.min.js',
  './skeeball/js/strings.js',
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

// --- REST content manifest (2026-08-23) --------------------------------------------------------
// GENERATED by validate-sw-assets.mjs from the actual bytes on disk - do not edit by hand; the
// validator rewrites this block and test-sw-strategy.mjs FAILS when it drifts from disk.
//
// Why it exists: CACHE is bumped on essentially every commit (~13 deploys/day at the time this
// landed), and every bump rolled the cache name over, so warmRest() re-downloaded the ENTIRE
// ~11 MB REST tier on nearly every open of the hub - measured at 347 requests / 12.6 MB per
// deploy, saturating a phone's connection for the whole session. HTTP validators cannot fix
// this: GitHub Pages re-stamps every file's mtime (and therefore its ETag) on every deploy, so a
// conditional request 200s the full body even for a file that has not changed in weeks. Only a
// content hash carried in the worker itself can tell "unchanged" - warmRest() compares this
// manifest against the one the PREVIOUS deploy stored in its cache and copies unchanged files
// across instead of re-fetching them. Measured effect: a no-REST-change deploy went from 12.6 MB
// re-downloaded to ~1 MB (the shell install plus this file's own churn).
//
// If this manifest is STALE (a session edited a game file and deployed without running the
// validator), the cost is bounded and online play is unaffected: code files are still
// network-first at request time, so a stale carried copy is only ever served OFFLINE or past the
// deadline/latch, and the next validator run heals it.
// __REST_MANIFEST_START__
const REST_MANIFEST = {
  './img/where-hub.jpg': 'f163453a0f',
  './img/where-hub-dark.jpg': 'ec03c35a3c',
  './img/where-hub-es.jpg': 'ea7411feb8',
  './img/where-hub-es-dark.jpg': '982a9aa682',
  './img/where-profile.jpg': '67836eadad',
  './img/where-profile-dark.jpg': '649eb0d5cb',
  './img/where-profile-es.jpg': '58ef56a483',
  './img/where-profile-es-dark.jpg': 'c8a436d45f',
  './connect-four/index.html': '7af9956cad',
  './connect-four/js/ui.js': '89328ff02a',
  './connect-four/js/worker.js': 'a60e7c739c',
  './connect-four/js/game.js': '2da8d12176',
  './connect-four/js/board.js': '9c92c88247',
  './connect-four/js/ai.js': '2cfffc73fc',
  './connect-four/js/strings.js': '98fa3094e7',
  './connect-four/css/connect-four.css': '14251ccb03',
  './chinchon/index.html': '2ebfefb1ca',
  './chinchon/css/chinchon.css': 'e8328a5d55',
  './chinchon/js/deck.js': '2260c3f606',
  './chinchon/js/meld.js': '5166c4b913',
  './chinchon/js/cards.js': '8345ff44a9',
  './chinchon/js/game.js': 'ff23b6d017',
  './chinchon/js/hash.js': '9bbf5d8385',
  './chinchon/js/ai.js': 'd69864fbc2',
  './chinchon/js/ui.js': '75ce630507',
  './chinchon/js/strings.js': '18b7062090',
  './parchis/': 'b85bb36a1d',
  './parchis/index.html': 'b85bb36a1d',
  './filler/': '2c00e24a20',
  './filler/index.html': '2c00e24a20',
  './filler/css/filler.css': '8390f1997f',
  './filler/js/ui.js': 'f7ef9d3d4b',
  './filler/js/game.js': '90ce8fb511',
  './filler/js/ai.js': '7696a3c895',
  './filler/js/hash.js': 'e9abc9264f',
  './filler/js/strings.js': 'db61740da3',
  './escoba/index.html': 'cb66803018',
  './escoba/css/escoba.css': 'b21ccd642f',
  './escoba/js/deck.js': '82f42af6d3',
  './escoba/js/cards.js': 'bff122678a',
  './escoba/js/game.js': '6cace62af1',
  './escoba/js/hash.js': '032dbfed1a',
  './escoba/js/ai.js': '66a7d1f37a',
  './escoba/js/ui.js': '0ee1cf50bc',
  './escoba/js/strings.js': '9f4bca4ab2',
  './escoba/img/broom-sprite.webp': 'c1a0f8a912',
  './mancala/index.html': '13527d3dfc',
  './mancala/css/mancala.css': '6f92d852a3',
  './mancala/js/game.js': 'd9dca9c8af',
  './mancala/js/ai.js': 'bab360f91d',
  './mancala/js/howto.js': 'a9d2b6fa0c',
  './mancala/js/ui.js': '985601f835',
  './mancala/js/hash.js': '5f1c0a306b',
  './mancala/js/strings.js': 'b05ffe2a76',
  './nuts-bolts/': '116e343ef8',
  './nuts-bolts/index.html': '116e343ef8',
  './nuts-bolts/css/nuts-bolts.css': 'e5a74a7a3c',
  './nuts-bolts/js/ui.js': '844719cc96',
  './nuts-bolts/js/game.js': '9116062404',
  './nuts-bolts/js/generator.js': '137c26baa3',
  './nuts-bolts/js/strings.js': 'd7ba835b23',
  './tic-tac-toe/': '0dc36ccc43',
  './tic-tac-toe/index.html': '0dc36ccc43',
  './tic-tac-toe/css/tic-tac-toe.css': 'c4d16f41b6',
  './tic-tac-toe/js/ui.js': 'e8f0b0eef0',
  './tic-tac-toe/js/game.js': '5dd6dfd541',
  './tic-tac-toe/js/ai.js': '0e15362323',
  './tic-tac-toe/js/hash.js': 'fcb078047e',
  './tic-tac-toe/js/strings.js': '8b7b628f3d',
  './dots-boxes/': 'b85e1aa30d',
  './dots-boxes/index.html': 'b85e1aa30d',
  './dots-boxes/css/dots-boxes.css': '057f26f783',
  './dots-boxes/js/ui.js': '76a9b20084',
  './dots-boxes/js/game.js': 'cd0edd18d7',
  './dots-boxes/js/ai.js': '37b84eb6ff',
  './dots-boxes/js/hash.js': '602fe05103',
  './dots-boxes/js/strings.js': '901f6547a2',
  './ball-run/index.html': '34788144a9',
  './ball-run/css/ball-run.css': 'e9016fbe1a',
  './ball-run/js/ui.js': '66d9865179',
  './ball-run/js/config.js': 'c56cab07d6',
  './ball-run/js/track.js': '33517c1d75',
  './ball-run/js/sim.js': '95c4fdb2c9',
  './ball-run/js/input.js': '7f41531072',
  './ball-run/js/render.js': '927d6b3451',
  './ball-run/js/strings.js': '5a09bdf95b',
  './ball-run/vendor/three.module.min.js': 'd719de9cf8',
  './boggle/': '9c270fd012',
  './boggle/index.html': '9c270fd012',
  './boggle/css/boggle.css': '8958237d6f',
  './boggle/js/ui.js': 'cbc599a365',
  './boggle/js/strings.js': 'a4d3879908',
  './boggle/js/game.js': '352ab86078',
  './boggle/js/dict.js': '84e22408d9',
  './boggle/js/solver.js': 'be62d7a79f',
  './boggle/js/ai.js': '38b2d232a4',
  './boggle/js/mp-round.js': 'a44ccf9426',
  './boggle/data/words.txt': 'eccc092554',
  './snake/': '8acb3eb313',
  './snake/index.html': '8acb3eb313',
  './snake/css/snake.css': '577f1529ea',
  './snake/js/ui.js': '4a7abf5fdb',
  './snake/js/game.js': 'f69fbe6fe8',
  './snake/js/strings.js': '4f9182ff18',
  './pinball/': 'e4f7a53269',
  './pinball/index.html': 'e4f7a53269',
  './pinball/css/pinball.css': '44b6be1b37',
  './pinball/js/ui.js': 'dba8145687',
  './pinball/js/game.js': '0080173e93',
  './pinball/js/physics.js': '05af21396d',
  './pinball/js/table.js': 'db960c07d0',
  './pinball/js/render.js': 'a1a79ae45e',
  './pinball/js/store.js': 'db542283c1',
  './pinball/js/strings.js': 'f8278a836a',
  './hill-climb/': '11ee43cbcb',
  './hill-climb/index.html': '11ee43cbcb',
  './hill-climb/css/hill-climb.css': '0fa9d457ae',
  './hill-climb/js/ui.js': 'b2d6348dee',
  './hill-climb/js/physics.js': '823eab9770',
  './hill-climb/js/terrain.js': '790d01cca9',
  './hill-climb/js/render.js': '127bb65496',
  './hill-climb/js/catalog.js': '3503bfe16c',
  './hill-climb/js/store.js': '7c60626cd1',
  './hill-climb/js/strings.js': '46960514cd',
  './skeeball/': '607843c4fd',
  './skeeball/index.html': '607843c4fd',
  './skeeball/flick-test.html': 'f310e43bb6',
  './skeeball/css/skeeball.css': '489d1e169e',
  './skeeball/js/ui.js': '67f136a5d8',
  './skeeball/js/swipe.js': '7c0d8669b0',
  './skeeball/js/game.js': 'b38b371d82',
  './skeeball/js/goals.js': '6b0362f158',
  './skeeball/js/boards.js': '3b2ebc5531',
  './skeeball/js/engines.js': 'a1010368a4',
  './skeeball/js/machines/classic/physics.js': '34e971280d',
  './skeeball/js/machines/classic/machine.js': 'cb94006003',
  './skeeball/js/machines/classic/render.js': '9c669cad80',
  './skeeball/js/machines/popongo/physics.js': 'b96cb000d2',
  './skeeball/js/machines/popongo/machine.js': 'c9a7bec342',
  './skeeball/js/machines/popongo/render.js': '6265ca5116',
  './skeeball/js/machines/basketball/physics.js': 'b96cb000d2',
  './skeeball/js/machines/basketball/machine.js': 'c9a7bec342',
  './skeeball/js/machines/basketball/render.js': '6265ca5116',
  './skeeball/js/vendor/cannon-es.js': 'f83c8c5721',
  './skeeball/js/vendor/three.module.min.js': '1f065b8bf5',
  './skeeball/js/vendor/three.core.min.js': '46bfe481f2',
  './skeeball/js/strings.js': '19f67f1c6a',
  './dominoes/': 'f7098832ee',
  './dominoes/index.html': 'f7098832ee',
  './dominoes/css/dominoes.css': 'c5a84530fc',
  './dominoes/js/ui.js': '6fe65ac76c',
  './dominoes/js/game.js': '609a0f8243',
  './dominoes/js/board.js': 'de9a3fe781',
  './dominoes/js/ai.js': '88e356e17e',
  './dominoes/js/tiles.js': '6e50c21737',
  './dominoes/js/tutorial.js': '6f940f9987',
  './dominoes/js/strings.js': 'df94fa502b',
  './uno/': '39d76d2adc',
  './uno/index.html': '39d76d2adc',
  './uno/css/uno.css': 'e866134a59',
  './uno/js/ui.js': 'bcc152cb86',
  './uno/js/game.js': '6ffaaf31b2',
  './uno/js/ai.js': '0edaa2fea7',
  './uno/js/strings.js': 'bc01059b54',
  './pool/css/pool.css': '3d6ad88651',
  './pool/index.html': '14c21fc22d',
  './pool/js/ai.js': '203a40f854',
  './pool/js/hash.js': 'b992caf71d',
  './pool/js/physics.js': '36205c037d',
  './pool/js/rng.js': '072f2182ab',
  './pool/js/rules.js': '90b339c412',
  './pool/js/strings.js': 'f108a39b70',
  './pool/js/table.js': '46e0f7c924',
  './pool/js/ui.js': '588eae0e2c',
  './pool/js/worker.js': '72eb1dde70',
  './yahtzee/': '50772c3a05',
  './yahtzee/index.html': '50772c3a05',
  './yahtzee/css/yahtzee.css': 'cd8ef25281',
  './yahtzee/js/howto.js': 'b9b4124274',
  './yahtzee/js/strings.js': 'af87488625',
  './yahtzee/js/ui.js': '3c0eae9328',
  './yahtzee/js/hash.js': '14b905be65',
  './battleship/': 'd3a4c24375',
  './battleship/index.html': 'd3a4c24375',
  './battleship/css/battleship.css': '07b60be299',
  './battleship/js/ui.js': 'f22918e6f8',
  './battleship/js/game.js': '1794a71b2d',
  './battleship/js/fleet.js': '16100d8928',
  './battleship/js/ai.js': 'fc0e70b327',
  './battleship/js/hash.js': 'aec005e885',
  './battleship/js/ship-art.js': '20e53eb581',
  './battleship/js/strings.js': '56ef5b99aa',
  './chinchon/decks/baraja-libre/oros-1.webp': '740f863677',
  './chinchon/decks/baraja-libre/oros-2.webp': '1de2771991',
  './chinchon/decks/baraja-libre/oros-3.webp': '2f904d4399',
  './chinchon/decks/baraja-libre/oros-4.webp': 'a0995668fa',
  './chinchon/decks/baraja-libre/oros-5.webp': '5da8188491',
  './chinchon/decks/baraja-libre/oros-6.webp': '8281401fef',
  './chinchon/decks/baraja-libre/oros-7.webp': '52c56bb058',
  './chinchon/decks/baraja-libre/oros-8.webp': '79d7c78da8',
  './chinchon/decks/baraja-libre/oros-9.webp': '879e7cc4ee',
  './chinchon/decks/baraja-libre/oros-10.webp': 'de4464b8ec',
  './chinchon/decks/baraja-libre/oros-11.webp': 'e049bfa4ad',
  './chinchon/decks/baraja-libre/oros-12.webp': '936d04d5f4',
  './chinchon/decks/baraja-libre/copas-1.webp': '6be7ed754e',
  './chinchon/decks/baraja-libre/copas-2.webp': '3bf38eaa4a',
  './chinchon/decks/baraja-libre/copas-3.webp': '41f95cc185',
  './chinchon/decks/baraja-libre/copas-4.webp': '4fceabb976',
  './chinchon/decks/baraja-libre/copas-5.webp': '9fbb2e30c2',
  './chinchon/decks/baraja-libre/copas-6.webp': 'c2d2def4b6',
  './chinchon/decks/baraja-libre/copas-7.webp': 'dfa5233464',
  './chinchon/decks/baraja-libre/copas-8.webp': '291465a429',
  './chinchon/decks/baraja-libre/copas-9.webp': 'f4320c894a',
  './chinchon/decks/baraja-libre/copas-10.webp': '9c3dd7883e',
  './chinchon/decks/baraja-libre/copas-11.webp': '834dba27a1',
  './chinchon/decks/baraja-libre/copas-12.webp': 'f9c0f78aea',
  './chinchon/decks/baraja-libre/espadas-1.webp': 'dd6f245d27',
  './chinchon/decks/baraja-libre/espadas-2.webp': 'e563c92882',
  './chinchon/decks/baraja-libre/espadas-3.webp': 'c16169c594',
  './chinchon/decks/baraja-libre/espadas-4.webp': 'd628f47236',
  './chinchon/decks/baraja-libre/espadas-5.webp': '398d30a363',
  './chinchon/decks/baraja-libre/espadas-6.webp': '25ce557681',
  './chinchon/decks/baraja-libre/espadas-7.webp': '8012695fa9',
  './chinchon/decks/baraja-libre/espadas-8.webp': '3631eb626e',
  './chinchon/decks/baraja-libre/espadas-9.webp': '93d78ef161',
  './chinchon/decks/baraja-libre/espadas-10.webp': '9ec59ef5c9',
  './chinchon/decks/baraja-libre/espadas-11.webp': 'a23f415b3c',
  './chinchon/decks/baraja-libre/espadas-12.webp': 'f5994cd273',
  './chinchon/decks/baraja-libre/bastos-1.webp': '468ccf0687',
  './chinchon/decks/baraja-libre/bastos-2.webp': 'f1f5bd80d6',
  './chinchon/decks/baraja-libre/bastos-3.webp': '8a3df90a27',
  './chinchon/decks/baraja-libre/bastos-4.webp': 'd9269c30b1',
  './chinchon/decks/baraja-libre/bastos-5.webp': '553cc4d93d',
  './chinchon/decks/baraja-libre/bastos-6.webp': '2affd17a6e',
  './chinchon/decks/baraja-libre/bastos-7.webp': 'd66a4fc231',
  './chinchon/decks/baraja-libre/bastos-8.webp': '1dba3ab928',
  './chinchon/decks/baraja-libre/bastos-9.webp': 'a3cfa10a0e',
  './chinchon/decks/baraja-libre/bastos-10.webp': '7d78b057ff',
  './chinchon/decks/baraja-libre/bastos-11.webp': '7209bb7702',
  './chinchon/decks/baraja-libre/bastos-12.webp': '8e762a3aa3',
  './chinchon/decks/baraja-libre/back.webp': '202501b5f5',
  './chinchon/decks/anita/oros-1.webp': '19f22f92d3',
  './chinchon/decks/anita/oros-2.webp': '0537c54360',
  './chinchon/decks/anita/oros-3.webp': '32cbd10f79',
  './chinchon/decks/anita/oros-4.webp': 'ac509d66b9',
  './chinchon/decks/anita/oros-5.webp': 'b7170b18d8',
  './chinchon/decks/anita/oros-6.webp': 'e0a2f2bc85',
  './chinchon/decks/anita/oros-7.webp': '18f92c4024',
  './chinchon/decks/anita/oros-8.webp': '27c611f069',
  './chinchon/decks/anita/oros-9.webp': 'abcf0ab660',
  './chinchon/decks/anita/copas-1.webp': '4becb74847',
  './chinchon/decks/anita/copas-2.webp': '6a3006c255',
  './chinchon/decks/anita/copas-3.webp': 'fe10e2db35',
  './chinchon/decks/anita/copas-4.webp': 'd6e6195199',
  './chinchon/decks/anita/copas-5.webp': '0b2aedac0c',
  './chinchon/decks/anita/copas-6.webp': '1b68020f56',
  './chinchon/decks/anita/copas-7.webp': '9d1111b6b6',
  './chinchon/decks/anita/copas-8.webp': '045e1ed5b5',
  './chinchon/decks/anita/copas-9.webp': 'dabff58a23',
  './chinchon/decks/anita/espadas-1.webp': 'a8dcdceb1a',
  './chinchon/decks/anita/espadas-2.webp': 'dfe65e9f44',
  './chinchon/decks/anita/espadas-3.webp': '0044630f41',
  './chinchon/decks/anita/espadas-4.webp': '2960514c83',
  './chinchon/decks/anita/espadas-5.webp': 'da0fa71966',
  './chinchon/decks/anita/espadas-6.webp': 'a0f338ed3e',
  './chinchon/decks/anita/espadas-7.webp': '93afba1c38',
  './chinchon/decks/anita/espadas-8.webp': '9690c2ec58',
  './chinchon/decks/anita/espadas-9.webp': '5562e71da1',
  './chinchon/decks/anita/bastos-1.webp': '65c6a798c6',
  './chinchon/decks/anita/bastos-2.webp': '06226ce243',
  './chinchon/decks/anita/bastos-3.webp': '169cef687e',
  './chinchon/decks/anita/bastos-4.webp': '780ab33b47',
  './chinchon/decks/anita/bastos-5.webp': '8a05d00395',
  './chinchon/decks/anita/bastos-6.webp': 'e41c34ecb2',
  './chinchon/decks/anita/bastos-7.webp': '34f572b2af',
  './chinchon/decks/anita/bastos-8.webp': 'ea53c30395',
  './chinchon/decks/anita/bastos-9.webp': '3ecee8c47d',
  './chinchon/decks/anita/oros-10.webp': '0d11116a99',
  './chinchon/decks/anita/oros-11.webp': '9c3d3611ee',
  './chinchon/decks/anita/oros-12.webp': '8380265f6c',
  './chinchon/decks/anita/copas-10.webp': '18174db502',
  './chinchon/decks/anita/copas-11.webp': 'b04f1b84e4',
  './chinchon/decks/anita/copas-12.webp': 'aab6149f8f',
  './chinchon/decks/anita/espadas-10.webp': 'f56666bf44',
  './chinchon/decks/anita/espadas-11.webp': '6c73f1e748',
  './chinchon/decks/anita/espadas-12.webp': '291489bd7a',
  './chinchon/decks/anita/bastos-10.webp': '859c246d69',
  './chinchon/decks/anita/bastos-11.webp': 'bbf462e682',
  './chinchon/decks/anita/bastos-12.webp': 'c0293b2dd6',
  './chinchon/decks/anita/back.webp': '1edf151aa8',
  './chinchon/decks/anita/betty-win.webp': '620c0e03d7',
  './chinchon/decks/anita/betty-loss.webp': '29bba37d11',
};
// __REST_MANIFEST_END__

// The warm records the manifest it stored under this synthetic cache key, so the NEXT deploy's
// warm can diff against what is actually in the cache it inherits. Never a real asset path.
const MANIFEST_KEY = './__rest-manifest__';

// Warm the non-shell tier. Best-effort by design, but never SILENTLY best-effort (THE LAW rule 6):
// whatever could not be cached is logged with its paths so a broken deploy is diagnosable from the
// console instead of only showing up as a game that mysteriously fails offline.
//
// Old caches are still alive while this runs (activate no longer deletes them - see the activate
// handler): they are BOTH the copy source for unchanged files AND the fetch handler's fallback,
// so a game opened mid-warm still serves from cache instead of queueing behind the warm on the
// network. This function deletes them itself once the new cache is complete.
const WARM_CONCURRENCY = 6;
async function warmRest() {
  const cache = await caches.open(CACHE);
  const oldCaches = [];
  for (const k of await caches.keys()) {
    if (k !== CACHE && k.startsWith('game-hub-')) oldCaches.push(await caches.open(k));
  }
  // The manifest the previous deploy's warm recorded. Checked in the new cache first (a completed
  // warm interrupted only before cleanup), then the caches it inherits. Absent on a fresh install
  // or the first deploy carrying this system - then everything simply fetches, as it always did.
  let stored = null;
  for (const c of [cache, ...oldCaches]) {
    try {
      const res = await c.match(MANIFEST_KEY);
      if (res) { stored = await res.json(); break; }
    } catch { /* unreadable marker: treat as absent */ }
  }
  const queue = REST.slice();
  const failed = [];
  let carried = 0;
  const worker = async () => {
    for (;;) {
      const path = queue.shift();
      if (path === undefined) return;
      try {
        // Already in the NEW cache (cached on demand by the fetch handler, or by an earlier pass
        // of this warm): one lookup, no network, no copy.
        if (await cache.match(path, { ignoreSearch: true })) continue;
        // Unchanged since the previous deploy (content hash match): carry the previous cache's
        // copy across instead of re-downloading it. Byte-identical to what a fetch would return,
        // so the "coherent snapshot of one deploy" property holds exactly as before.
        if (stored && stored[path] && REST_MANIFEST[path] && stored[path] === REST_MANIFEST[path]) {
          let copied = false;
          for (const c of oldCaches) {
            const prev = await c.match(path, { ignoreSearch: true });
            if (prev) { await cache.put(path, prev); carried++; copied = true; break; }
          }
          if (copied) continue;
          // No old copy to carry (interrupted previous warm): fall through to a real fetch.
        }
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
  // Record what this warm was built against, THEN retire every other cache. Order matters: the
  // old caches must survive until the new one is complete, or an interrupted warm would leave
  // devices with no fallback for whatever had not warmed yet - which was exactly the post-deploy
  // window the old delete-at-activate behaviour opened on every single deploy.
  try { await cache.put(MANIFEST_KEY, new Response(JSON.stringify(REST_MANIFEST))); } catch { /* next deploy re-fetches */ }
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
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
  // Old caches are NOT deleted here any more (2026-08-23). They are warmRest()'s copy source for
  // unchanged files AND the fetch handler's fallback while the warm runs, so deleting them at
  // activate opened a window on EVERY deploy (seconds on wifi, minutes on a phone) where games
  // had no cache at all and every request queued behind the warm on the network. warmRest()
  // deletes every non-current cache itself once the new cache is complete; if it is interrupted,
  // the next activation's warm finishes the job. At most one extra generation (~11 MB) lingers.
  event.waitUntil(
    self.clients.claim()
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
  //
  // The CURRENT cache is consulted before the global caches.match (2026-08-23): while warmRest()
  // runs, the previous deploy's cache is still alive as a fallback, and caches.match searches
  // caches in CREATION order - so without this, an entry already refreshed into the new cache
  // would keep being answered by the older cache's stale copy until the warm finished.
  if (sameOrigin && STATIC_RE.test(new URL(req.url).pathname)) {
    event.respondWith((async () => {
      const cur = await caches.open(CACHE);
      const cached = (await cur.match(req, { ignoreSearch: true }))
        || (await caches.match(req, { ignoreSearch: true }));
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

    // Current cache first, then any older generation still alive mid-warm (same creation-order
    // reasoning as the cache-first branch above).
    const cur = await caches.open(CACHE);
    const cached = (await cur.match(req, { ignoreSearch: true }))
      || (await caches.match(req, { ignoreSearch: true }));

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
