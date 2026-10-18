// sw.js — shared service worker for the Game Hub. Precaches the app shell and
// every game module's assets so the whole hub works offline.
//
// NETWORK-FIRST for code: a freshly deployed hub is always served when online
// (the old cache-first strategy left clients stuck on stale builds until they
// manually cleared the cache). The cache is only a fallback when offline.
//
// Bump CACHE when any precached asset changes to roll the cache over.
const CACHE = 'game-hub-v1194';

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
  './js/no-zoom.js',
  './js/a2hs.js',
  './js/favorites.js',
  './js/launcher-sort.js',
  './js/new-badge.js',
  './js/i18n.js',
  './js/theme.js',
  './js/layout.js',
  './js/viewport.js',
  './js/strings.js',
  './js/profile-store.js',
  // Emoji picker (2026-08-25). emoji.js is validation only (~2 KB) and emoji-data.js is the
  // browsable set (~13 KB), both small enough to be shell. The two search-keyword files are ~65 KB
  // EACH and are deliberately kept OUT of the atomic shell - see isShellAsset below.
  './js/emoji.js',
  './js/emoji-data.js',
  './js/emoji-search-en.js',
  './js/emoji-search-es.js',
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
  // Player-to-player messages (2026-08-31). SHELL for the same reason the bug report is: messages.js
  // is imported by the launcher on every load (the profile pill's badge, and the outbox drain), and
  // a message written offline has to be able to queue itself on the device that is offline.
  './js/messages.js',
  './js/messages-ui.js',
  './js/hub-messages.js',
  './js/challenges.js',
  './js/challenges-ui.js',
  './js/challenge-life.js',
  './js/challenges-strings.js',
  './js/mp-records.js',
  './js/push.js',
  // Baseball's career sync (BB-0-phase-0-handoff.md step 9). SHELL for the same reason: it must be
  // reachable offline the moment a career-mode game imports it, on the same device that just
  // played offline.
  './js/career-store.js',
  // The admin control page and the app-wide config it reads. admin-config.js is SHELL because every
  // device reads it on every launcher render (it decides which game cards exist); admin-ui.js sits
  // beside it because it is tiny and only Matt ever imports it.
  './js/admin-config.js',
  './js/admin-ui.js',
  // The read-time correction layer. SHELL because the leaderboard, My Stats and Skeeball all apply
  // it while painting - a device without it would show scores the rest of the family no longer does.
  './js/stats-corrections.js',
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
  './img/layout-comfortable.jpg',
  './img/layout-comfortable-dark.jpg',
  './img/layout-comfortable-es.jpg',
  './img/layout-comfortable-es-dark.jpg',
  './img/layout-compact.jpg',
  './img/layout-compact-dark.jpg',
  './img/layout-compact-es.jpg',
  './img/layout-compact-es-dark.jpg',
  './js/players-agg.js',
  './js/game-art.js',
  './js/hidden-players.js',
  './js/leaderboard-ui.js',
  './js/leaderboard-rank.js',
  './js/arrow-maze-time.js',
  './js/gridlock-points.js',
  './js/gridlock-v1map.js',
  './js/difficulty-tiers.js',
  './js/net.js',
  './js/online-gate.js',
  './js/mp-code-copy.js',
  './js/mp-reactions.js',
  './js/mp-reactions-ui.js',
  './js/match-chat.js',
  './js/match-chat-ui.js',
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
  './minesweeper/',
  './minesweeper/index.html',
  './minesweeper/css/minesweeper.css',
  './minesweeper/js/ui.js',
  './minesweeper/js/engine.js',
  './minesweeper/js/strings.js',
  './contexto/',
  './contexto/index.html',
  './contexto/css/contexto.css',
  './contexto/js/ui.js',
  './contexto/js/engine.js',
  './contexto/js/strings.js',
  './contexto/data/en.json',
  './contexto/data/en.bin',
  './contexto/data/es.json',
  './contexto/data/es.bin',
  './murdoku/',
  './murdoku/index.html',
  './murdoku/css/murdoku.css',
  './murdoku/js/ui.js',
  './murdoku/js/engine.js',
  './murdoku/js/strings.js',
  './way-out/',
  './way-out/index.html',
  './way-out/css/way-out.css',
  './way-out/js/ui.js',
  './way-out/js/engine.js',
  './way-out/js/strings.js',
  './gridlock/',
  './gridlock/index.html',
  './gridlock/css/gridlock.css',
  './gridlock/js/ui.js',
  './gridlock/js/engine.js',
  './gridlock/js/art.js',
  './gridlock/js/levels.js',
  './gridlock/js/strings.js',
  './flick-soccer/',
  './flick-soccer/index.html',
  './flick-soccer/css/flick-soccer.css',
  './flick-soccer/js/ui.js',
  './flick-soccer/js/engine.js',
  './flick-soccer/js/ai.js',
  './flick-soccer/js/render.js',
  './flick-soccer/js/strings.js',
  './flick-soccer/js/mp.js',
  './flick-soccer/js/mp-ui.js',
  './flick-soccer/js/alert.js',
  './archery/',
  './archery/index.html',
  './archery/css/archery.css',
  './archery/js/ui.js',
  './archery/js/engine.js',
  './archery/js/render.js',
  './archery/js/bow3d.js',
  './archery/js/strings.js',
  './archery/js/mp.js',
  './archery/js/mp-ui.js',
  './archery/js/alert.js',
  './darts/',
  './darts/index.html',
  './darts/css/darts.css',
  './darts/js/ui.js',
  './darts/js/engine.js',
  './darts/js/render.js',
  './darts/js/flight.js',
  './darts/js/strings.js',
  './darts/js/mp.js',
  './darts/js/mp-ui.js',
  './darts/js/alert.js',
  './sudoku/',
  './sudoku/index.html',
  './sudoku/css/sudoku.css',
  './sudoku/js/ui.js',
  './sudoku/js/game.js',
  './sudoku/js/generator.js',
  './sudoku/js/solver.js',
  './sudoku/js/strings.js',
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
  './boggle/data/words-es.txt',
  './snake/',
  './snake/index.html',
  './snake/css/snake.css',
  './snake/js/ui.js',
  './snake/js/game.js',
  './snake/js/strings.js',
  './brick-blitz/',
  './brick-blitz/index.html',
  './brick-blitz/css/brick-blitz.css',
  './brick-blitz/js/ui.js',
  './brick-blitz/js/game.js',
  './brick-blitz/js/strings.js',
  './air-hockey/',
  './air-hockey/index.html',
  './air-hockey/css/air-hockey.css',
  './air-hockey/js/ui.js',
  './air-hockey/js/physics.js',
  './air-hockey/js/ai.js',
  './air-hockey/js/render.js',
  './air-hockey/js/strings.js',
  './air-hockey/js/live.js',
  './air-hockey/js/net-test.js',
  './air-hockey/net-test.html',
  './holdem/',
  './holdem/index.html',
  './holdem/css/holdem.css',
  './holdem/js/ui.js',
  './holdem/js/engine.js',
  './holdem/js/ai.js',
  './holdem/js/table.js',
  './holdem/js/net-table.js',
  './holdem/js/strings.js',
  // Hill Climb (2026-08-02). Note test.js is deliberately NOT listed: it is a node-only engine
  // suite, never loaded by the page (same convention as every other game's test file).

  // pinball2: the new engine and its editor. Not a hub game yet (no GAMES entry) - step 2 of the
  // plan in docs/PINBALL2-PLAN.md, which is the bare box the ball feel is judged on.
  './pinball2/index.html',
  './pinball2/editor/index.html',
  './pinball2/editor/editor.js',
  './pinball2/machines/testbox/config.js',
  './pinball2/machines/testbox/physics.js',
  './pinball2/machines/testbox/table.js',
  './pinball2/machines/testbox/tables/boardwalk.js',
  './pinball2/machines/testbox/render.js',
  './pinball2/probes/checks.js',
  // PIER NINE: the first table in here that is a GAME rather than a physics test bed. Still not a
  // hub entry and still no stats id (pinball2/CLAUDE.md).
  './pinball2/machines/testbox/tables/piernine.js',
  './pinball2/piernine/index.html',
  './pinball2/piernine/game.js',
  './pinball2/piernine/rules.js',
  './pinball2/piernine/style.css',
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
  './skeeball/trajectory.html',
  './skeeball/trajectory-map.json',
  './skeeball/css/skeeball.css',
  './skeeball/js/ui.js',
  './skeeball/js/swipe.js',

  // Cup Pong. Like Hoops, it imports skeeball's vendored three.js and cannon-es.
  './cup-pong/index.html',
  './cup-pong/css/cup-pong.css',
  './cup-pong/js/ui.js',
  './cup-pong/js/geom.js',
  './cup-pong/js/rack.js',
  './cup-pong/js/physics.js',
  './cup-pong/js/render.js',
  './cup-pong/js/strings.js',
  './cup-pong/js/match.js',
  './cup-pong/js/mp.js',
  './cup-pong/js/mp-ui.js',
  './cup-pong/js/alert.js',
  './cup-pong/js/cpu.js',

  // Connect 4 Hoops. Its engine imports skeeball's vendored three.js and cannon-es rather than
  // carrying a second copy, so nothing new is added for those.
  './hoops4/index.html',
  './hoops4/css/hoops4.css',
  './hoops4/js/ui.js',
  './hoops4/js/boarddef.js',
  './hoops4/js/machine.js',
  './hoops4/js/physics.js',
  './hoops4/js/render.js',
  './hoops4/js/game.js',
  './hoops4/js/cpu.js',
  './hoops4/js/mp.js',
  './hoops4/js/mp-ui.js',
  './hoops4/js/alert.js',
  './hoops4/js/strings.js',
  './skeeball/js/game.js',
  './skeeball/js/goals.js',
  './skeeball/js/challenge.js',
  './skeeball/js/challenge-ui.js',
  './skeeball/js/alert.js',
  './skeeball/js/boards.js',
  './skeeball/js/engines.js',
  './skeeball/js/picstore.js',
  './skeeball/js/machines/classic/physics.js',
  './skeeball/js/machines/classic/machine.js',
  './skeeball/js/machines/classic/render.js',
  './skeeball/js/machines/popongo/physics.js',
  './skeeball/js/machines/popongo/machine.js',
  './skeeball/js/machines/popongo/render.js',
  './skeeball/js/machines/basketball/physics.js',
  './skeeball/js/machines/basketball/machine.js',
  './skeeball/js/machines/basketball/render.js',
  './skeeball/js/machines/brickcity/physics.js',
  './skeeball/js/machines/brickcity/machine.js',
  './skeeball/js/machines/brickcity/render.js',
  './skeeball/js/machines/runaway/physics.js',
  './skeeball/js/machines/runaway/machine.js',
  './skeeball/js/machines/runaway/render.js',
  './skeeball/js/vendor/cannon-es.js',
  './skeeball/js/vendor/three.module.min.js',
  './skeeball/js/vendor/three.core.min.js',
  './skeeball/js/strings.js',
  // Golf. The 3D stack it used to carry - three.js, cannon-es and the nine modules around them,
  // ~1.1 MB of this precache - is gone; what is here is the 2D game. golf/js/test.js is the
  // engine suite and golf/CLAUDE.md is documentation: neither is fetched by a running client, so
  // neither belongs in this list.
  './golf/',
  './golf/index.html',
  './golf/css/golf.css',
  './golf/js/ui.js',
  './golf/js/strings.js',
  './golf/js/holes.js',
  './golf/js/obstacles.js',
  './golf/js/club-art.js',
  './golf/js/clubs.js',
  './golf/js/swing.js',
  './golf/js/shot.js',
  './golf/js/render.js',
  './golf/js/holegen.js',
  './golf/js/rounds.js',
  './golf/js/board.js',
  './golf/js/save.js',
  './golf/js/progress.js',
  './golf/js/tutorial.js',
  './golf/courses/pinevalley.js',
  './golf/courses/redmesa.js',
  './golf/courses/oasissands.js',
  './golf/courses/coralkeys.js',
  './golf/courses/tutorial.js',

  // Baseball, phase 0 (BB-0-phase-0-handoff.md): a devOnly placeholder tile, no game yet.
  './baseball/',
  './baseball/index.html',
  './baseball/css/baseball.css',
  './baseball/js/ui.js',
  './baseball/js/field.js',
  './baseball/js/ring.js',
  './baseball/js/strings.js',
  './baseball/js/rig.js',
  './baseball/js/actors.js',
  './baseball/js/poses.js',
  './baseball/js/vendor/three.core.min.js',
  './baseball/js/vendor/three.module.min.js',
  './baseball/js/vendor/GLTFLoader.js',
  './baseball/js/vendor/SkeletonUtils.js',
  './baseball/js/vendor/BufferGeometryUtils.js',
  // stage 4 (docs/BASEBALL-3D-BUILD.md section 3.6): the 3D model + its four team-skin textures.
  // Plain REST tier, not LAZY - unlike Boggle's word lists this is the PRIMARY visual for the live
  // play screen (baseball/js/ui.js loads it the moment the game mounts, at the setup screen, never
  // waiting for a first play to justify it), so warming it with the rest of the game's files is the
  // right default. `validate-sw-assets.mjs`/REST_MANIFEST and the CACHE bump are the orchestrator's
  // job at ship time (docs/BASEBALL-3D-BUILD.md section 0), not this stage's.
  './baseball/models/player.glb',
  './baseball/models/skins/skaterMaleA.png',
  './baseball/models/skins/criminalMaleA.png',
  './baseball/models/skins/skaterFemaleA.png',
  './baseball/models/skins/cyborgFemaleA.png',
  './baseball/js/engine/rng.js',
  './baseball/js/engine/settings.js',
  './baseball/js/engine/pitch.js',
  './baseball/js/engine/swing.js',
  './baseball/js/engine/outcomes.js',
  './baseball/js/engine/liveplay.js',
  './baseball/js/engine/bases.js',
  './baseball/js/engine/game.js',
  './baseball/js/engine/agents.js',
  './baseball/js/engine/teams.js',
  './baseball/js/engine/zones.js',
  './baseball/js/engine/season.js',
  './baseball/js/engine/career.js',
  './baseball/js/career-io.js',
  './baseball/js/build.js',
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
// The emoji picker's per-language keyword indexes are ~65 KB each and are imported only when a
// player types in the search box. They live under ./js/ because they are modules, but the SHELL is
// re-downloaded in full on every CACHE bump - i.e. on every deploy - so putting 130 KB of search
// data in it would re-pay for them a dozen times a day for a feature used a handful of times ever.
// In REST they carry a content hash and get carried forward untouched across a bump instead.
const NON_SHELL_JS = /^\.\/js\/emoji-search-[a-z]{2}\.js$/;

function isShellAsset(p) {
  if (NON_SHELL_JS.test(p)) return false;
  return p === './' || p === './index.html' || p === './manifest.webmanifest'
    || p.startsWith('./css/') || p.startsWith('./js/')
    || p.startsWith('./icons/') || p.startsWith('./profile/');
}
const SHELL = ASSETS.filter(isShellAsset);
const REST = ASSETS.filter((p) => !isShellAsset(p));

// --- the LAZY tier: in ASSETS, but never downloaded until somebody opens the game (2026-09-11) --
//
// Matt, on Boggle's two word lists: "Can we make the dictionary only download when you go to play
// the game? Seems like a lot for most people to download when they'll never use it ever."
//
// He is right about the size. Measured against this ASSETS list: the REST tier is 11.92 MB across
// 255 files, and `boggle/data/words.txt` + `words-es.txt` are 3.23 MB of it - 27% of everything a
// device warms, for ONE game, paid by every install whether or not anyone ever taps Boggle.
//
// A third tier is the honest fix, because the other two both do the wrong thing here. Leaving them
// in REST downloads 3.23 MB nobody asked for. Taking them OUT OF ASSETS ENTIRELY would stop the
// download, but it would also drop them out of `REST_MANIFEST` and `CACHE_FIRST_PATHS` - so a
// player who DOES play Boggle would re-download 1.6 MB on their next open after every single
// deploy (this repo deploys ~13 times a day), which is worse for them than today.
//
// So a LAZY path stays in ASSETS and keeps everything that membership buys - validate-sw-assets.mjs
// still fails a deploy if the file is missing, it still carries a content hash, it is still served
// cache-first and cached on demand by the fetch handler - and loses exactly one thing: warmRest()
// never FETCHES it. It still CARRIES IT FORWARD across a CACHE bump if this device already has a
// copy, which is the whole point: pay once, on first play, then never again.
//
// THE COST, AND IT IS REAL: a device that has never opened Boggle can no longer play it OFFLINE.
// The first round has to be started with a connection. After that it is cached like anything else.
// Boggle already renders an honest, translated "couldn't load the dictionary, check your
// connection" screen (`renderLoadError` / the `load_error` string) because the fetch was always
// lazy at the JS level, so the failure path this opens up is one that already existed and is
// already handled - it just becomes reachable for a first-time offline player.
//
// ONLY put a file here if it is BOTH large AND useless to anyone not playing that one game. Game
// CODE must never be lazy: a game's modules are what the launcher tile opens, they are small, and
// making them lazy would just move the 2026-09-01 cache-first win back off a phone.
// Contexto's word models (2026-09-28) are the same case: ~3.7 MB per language, useless to anyone
// not playing it. The game shows its own "couldn't load the words" screen with Retry (and retries
// on `online`), so a first-time offline player gets an honest answer.
const LAZY_REST = /^\.\/(boggle\/data\/words[a-z-]*\.txt|contexto\/data\/[a-z]+\.(json|bin))$/;
const isLazyAsset = (p) => LAZY_REST.test(p);

const LAZY = REST.filter(isLazyAsset);
// What warmRest() actually downloads on a fresh install: REST minus the lazy tier.
const WARMED = REST.filter((p) => !isLazyAsset(p));

// --- HELD BACK: an admin-only game is warmed only onto phones that can see it (2026-10-14) -------
//
// Matt: "we have the users phone download everything... Should we change this?" About 4.8 MB of
// what every phone warmed was games only Matt could see (Baseball alone 2.7 MB) or no game at all
// (pinball2). HELD_BACK is GENERATED by validate-sw-assets.mjs (never hand-edit it): per `devOnly`
// hub id, the files in that game's folder that nothing outside a held-back folder imports. A
// challenge game's `alerts` module and everything it imports stay OUT of this list, because the
// hub loads them on every phone.
//
// warmRest() skips a held-back file unless this phone's hub has said it shows that game
// (`SHOWN_GAMES` message, stored at SHOWN_KEY and carried across a CACHE bump). So a game Matt
// releases from the admin page, with no commit, starts warming on each phone the next time its
// launcher paints. Like LAZY, the skip sits BELOW the carry-forward (a copy the phone already has
// is kept), the fetch handler still caches any of these on demand, and nothing is deleted.
// THE COST: a phone that cannot see a game cannot play it offline - which it could not open anyway.
//
// NO UPDATE FOR AN UNRELEASED GAME'S EDITS (Matt, same day: "can we make it so those version
// updates dont go to regular users?"). A held-back file has NO REST_MANIFEST hash and is served
// NETWORK-FIRST (DEV_FRESH_PATHS below), so editing one changes nothing in this file: no new worker,
// no CACHE bump, no reload on anyone's phone, while Matt (and anyone shown the game) still gets the
// new code on the next open. Only ADDING or REMOVING a file changes ASSETS, and so this file.
// The hub imports a challenge game's alerts module only for games on that phone's launcher, which
// is what lets those modules be held back too.
// __HELD_BACK_START__
const HELD_BACK = {
  'air-hockey': [
    './air-hockey/',
    './air-hockey/index.html',
    './air-hockey/css/air-hockey.css',
    './air-hockey/js/ui.js',
    './air-hockey/js/physics.js',
    './air-hockey/js/ai.js',
    './air-hockey/js/render.js',
    './air-hockey/js/strings.js',
    './air-hockey/js/live.js',
    './air-hockey/js/net-test.js',
    './air-hockey/net-test.html',
  ],
  'archery': [
    './archery/',
    './archery/index.html',
    './archery/css/archery.css',
    './archery/js/ui.js',
    './archery/js/engine.js',
    './archery/js/render.js',
    './archery/js/bow3d.js',
    './archery/js/strings.js',
    './archery/js/mp.js',
    './archery/js/mp-ui.js',
    './archery/js/alert.js',
  ],
  'baseball': [
    './baseball/',
    './baseball/index.html',
    './baseball/css/baseball.css',
    './baseball/js/ui.js',
    './baseball/js/field.js',
    './baseball/js/ring.js',
    './baseball/js/strings.js',
    './baseball/js/rig.js',
    './baseball/js/actors.js',
    './baseball/js/poses.js',
    './baseball/js/vendor/three.core.min.js',
    './baseball/js/vendor/three.module.min.js',
    './baseball/js/vendor/GLTFLoader.js',
    './baseball/js/vendor/SkeletonUtils.js',
    './baseball/js/vendor/BufferGeometryUtils.js',
    './baseball/models/player.glb',
    './baseball/models/skins/skaterMaleA.png',
    './baseball/models/skins/criminalMaleA.png',
    './baseball/models/skins/skaterFemaleA.png',
    './baseball/models/skins/cyborgFemaleA.png',
    './baseball/js/engine/rng.js',
    './baseball/js/engine/settings.js',
    './baseball/js/engine/pitch.js',
    './baseball/js/engine/swing.js',
    './baseball/js/engine/outcomes.js',
    './baseball/js/engine/liveplay.js',
    './baseball/js/engine/bases.js',
    './baseball/js/engine/game.js',
    './baseball/js/engine/agents.js',
    './baseball/js/engine/teams.js',
    './baseball/js/engine/zones.js',
    './baseball/js/engine/season.js',
    './baseball/js/engine/career.js',
    './baseball/js/career-io.js',
    './baseball/js/build.js',
  ],
  'cuppong': [
    './cup-pong/index.html',
    './cup-pong/css/cup-pong.css',
    './cup-pong/js/ui.js',
    './cup-pong/js/geom.js',
    './cup-pong/js/rack.js',
    './cup-pong/js/physics.js',
    './cup-pong/js/render.js',
    './cup-pong/js/strings.js',
    './cup-pong/js/match.js',
    './cup-pong/js/mp.js',
    './cup-pong/js/mp-ui.js',
    './cup-pong/js/alert.js',
    './cup-pong/js/cpu.js',
  ],
  'darts': [
    './darts/',
    './darts/index.html',
    './darts/css/darts.css',
    './darts/js/ui.js',
    './darts/js/engine.js',
    './darts/js/render.js',
    './darts/js/flight.js',
    './darts/js/strings.js',
    './darts/js/mp.js',
    './darts/js/mp-ui.js',
    './darts/js/alert.js',
  ],
  'flick-soccer': [
    './flick-soccer/',
    './flick-soccer/index.html',
    './flick-soccer/css/flick-soccer.css',
    './flick-soccer/js/ui.js',
    './flick-soccer/js/engine.js',
    './flick-soccer/js/ai.js',
    './flick-soccer/js/render.js',
    './flick-soccer/js/strings.js',
    './flick-soccer/js/mp.js',
    './flick-soccer/js/mp-ui.js',
    './flick-soccer/js/alert.js',
  ],
  'gridlock': [
    './gridlock/',
    './gridlock/index.html',
    './gridlock/css/gridlock.css',
    './gridlock/js/ui.js',
    './gridlock/js/engine.js',
    './gridlock/js/art.js',
    './gridlock/js/levels.js',
    './gridlock/js/strings.js',
  ],
  'hoops4': [
    './hoops4/index.html',
    './hoops4/css/hoops4.css',
    './hoops4/js/ui.js',
    './hoops4/js/boarddef.js',
    './hoops4/js/machine.js',
    './hoops4/js/physics.js',
    './hoops4/js/render.js',
    './hoops4/js/cpu.js',
    './hoops4/js/mp-ui.js',
    './hoops4/js/alert.js',
    './hoops4/js/strings.js',
  ],
  'pinball2': [
    './pinball2/index.html',
    './pinball2/editor/index.html',
    './pinball2/editor/editor.js',
    './pinball2/machines/testbox/config.js',
    './pinball2/machines/testbox/physics.js',
    './pinball2/machines/testbox/table.js',
    './pinball2/machines/testbox/tables/boardwalk.js',
    './pinball2/machines/testbox/render.js',
    './pinball2/probes/checks.js',
    './pinball2/machines/testbox/tables/piernine.js',
    './pinball2/piernine/index.html',
    './pinball2/piernine/game.js',
    './pinball2/piernine/rules.js',
    './pinball2/piernine/style.css',
  ],
  'way-out': [
    './way-out/',
    './way-out/index.html',
    './way-out/css/way-out.css',
    './way-out/js/ui.js',
    './way-out/js/engine.js',
    './way-out/js/strings.js',
  ],
};
// __HELD_BACK_END__
const HELD_BACK_OWNER = new Map();
for (const [id, paths] of Object.entries(HELD_BACK)) for (const p of paths) HELD_BACK_OWNER.set(p, id);
const SHOWN_KEY = './__shown-games__';

// --- the shell's own split: always-fresh vs cache-first (2026-09-01) ----------------------------
//
// Matt: "fast loads, everywhere in the app". Measured on v546, a warm-cache launch of the hub sent
// 35 requests and 687 KB (~223 KB gzipped) to the server EVERY TIME, because the whole shell was
// network-first. Game code stopped doing that on 2026-09-01; this is the same fix for the app
// itself, with one deliberate carve-out.
//
// THE CARVE-OUT IS MATT'S CALL, not an implementation detail. Asked whether to cache the whole
// shell (which would make a new build reach a phone one launch later, exactly as game code already
// does) he chose to KEEP THE STATS CODE FRESH. So every module that reads or writes player data,
// or gates whether it is VISIBLE (THE LAW rule 1), stays network-first and is listed here by hand.
// Most of them are lazy-imported on a tap anyway, so keeping them fresh costs nothing at launch.
//
// GUARD: THIS IS AN ALLOW-LIST DERIVED FROM `ASSETS`, AND IT MUST STAY ONE.
// `sw.js` is not in ASSETS, so it can never reach the cache-first branch - by construction, not by
// a rule someone has to remember. Express this as a deny-list over same-origin paths instead and
// `sw.js` gets swallowed, and the breakage is live rather than theoretical: the network-first
// branch's background put already writes sw.js into the cache, so a deny-list WOULD find a copy
// and serve it. js/hub.js's version pill reads the deployed sw.js to learn the latest version, so
// a cached answer freezes the pill on "up to date" for ever and _forceUpdate() never reloads.
//
// GUARD: MEMBERSHIP IS PER FILE, NOT TRANSITIVE, AND THAT IS CORRECT. js/hub.js is cache-first and
// statically imports js/profile-store.js, which is network-first. ES modules are fetched per URL,
// so the graph is served from both places at once and each file gets the freshness it asked for.
// Do not "fix" this into a transitive closure - it would drag hub.js, name-gate.js and announce.js
// into the fresh list and delete the entire win. test-sw-strategy.mjs pins this.
const NETWORK_FIRST = [
  // Documents. Also excluded by req.mode !== 'navigate' below; belt and braces.
  './', './index.html', './profile/', './profile/index.html',
  // Reads or writes player data.
  './js/game-stats.js', './js/game-stats-global.js', './js/stats-net.js', './js/profile-store.js',
  './js/players-agg.js', './js/stats-corrections.js', './js/arcade-scores.js', './js/messages.js',
  // Baseball's career sync (BB-0-phase-0-handoff.md step 9): reads/writes players/<code>'s own
  // careers/ node, same freshness class as every other player-data module above.
  './js/career-store.js',
  './js/bug-report.js', './js/device-report.js', './js/admin-config.js', './js/error-log.js',
  './js/net.js', './js/install-state.js', './js/firebase-boot.js', './js/firebase-config.js',
  // Who may play online (2026-10-08, the play-yourself cheat): a device on a stale copy would let
  // an account in that Matt has shut out, or keep out one he has just let in.
  './js/online-gate.js',
  // Push notifications: stores this device's delivery address (pushSubs/<CODE>) and keeps a
  // gamehub.* record of it. Lazily imported, so fresh costs nothing at launch.
  './js/push.js',
  // Decides whether that data is SHOWN. A device on an old visibility gate hides history the rest
  // of the family can see, which is THE LAW rule 1 whether or not a byte was lost.
  './js/game-stats-ui.js', './js/leaderboard-ui.js', './js/messages-ui.js', './js/bug-report-ui.js',
  // Messages from the Game Hub itself (2026-10-14): the list of what was sent, and its read state
  // (gamehub.hubMessages.v1). Fresh, so a message sent by a deploy reaches the next open.
  './js/hub-messages.js',
  // The Challenges screen (2026-10-05): shows every challenge record; lazily imported, so fresh is free.
  './js/challenges.js', './js/challenges-ui.js', './js/challenges-strings.js',
  // The Multiplayer screen's Records for the live-room games (2026-10-18): reads players/ and the
  // local store's h2h; a stale copy would show a different record from the leaderboard.
  './js/mp-records.js',
  // How a challenge ends without a result (cancel, decline, expire; 2026-10-13): every challenge game
  // reads it to decide what a match is, so a stale copy would disagree with its game about a deadline.
  './js/challenge-life.js',
  // In-match quick chat (2026-10-14): writes `<node>/chat/<id>` and the gamehub.matchChatSeen.v1
  // marks. Its DOM half, js/match-chat-ui.js, touches no storage and stays cache-first.
  './js/match-chat.js',
  // leaderboard-rank.js is leaderboard-ui.js's OWN maths, split out only so it can be tested
  // headlessly. Leaving it cache-first while its only caller is network-first means a device can
  // run NEW ranking code against an OLD formatter for one launch - which is what happened on
  // 2026-09-21: Minesweeper's new best-time metric printed as a raw "34874", because the shipped
  // formatBoardMetric on that device predated the TIME_METRIC branch. A wrong NUMBER looks
  // plausible, which makes it worse than a missing label. This is a per-file decision, not the
  // transitive import-closure the guard forbids: the two are one unit that must not disagree, and
  // it costs nothing at launch (the leaderboard is lazily imported).
  './js/leaderboard-rank.js',
  // Arrow Maze's score (2026-10-13): what is stored, merged and SHOWN for every timed level.
  './js/arrow-maze-time.js',
  // Gridlock's ladder, stars and points (2026-10-14): what is stored, merged and SHOWN per level.
  './js/gridlock-points.js',
  // ...and where the first ladder's levels sit on ladder 2 (it decides which levels a player SEES as cleared).
  './js/gridlock-v1map.js',
  './js/admin-ui.js',
  // Retired, lazily loaded, and it clears `gamehub.challenge` on its tester-only reset path. Free
  // to keep fresh (nothing imports it at load) and it is a gamehub.* write, so the structural
  // guard in test-sw-strategy.mjs is right to insist.
  './js/challenge/challenge-ui.js',
];
const SHELL_CACHE_FIRST = SHELL.filter((p) => !NETWORK_FIRST.includes(p));

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
  './js/emoji-search-en.js': 'ee87f858cb',
  './js/emoji-search-es.js': '1594c6f049',
  './img/where-hub.jpg': 'f163453a0f',
  './img/where-hub-dark.jpg': 'ec03c35a3c',
  './img/where-hub-es.jpg': 'ea7411feb8',
  './img/where-hub-es-dark.jpg': '982a9aa682',
  './img/where-profile.jpg': '67836eadad',
  './img/where-profile-dark.jpg': '649eb0d5cb',
  './img/where-profile-es.jpg': '58ef56a483',
  './img/where-profile-es-dark.jpg': 'c8a436d45f',
  './img/layout-comfortable.jpg': '2ad7fa312c',
  './img/layout-comfortable-dark.jpg': 'baa363bdad',
  './img/layout-comfortable-es.jpg': 'a65f1f4a83',
  './img/layout-comfortable-es-dark.jpg': 'cb3a059591',
  './img/layout-compact.jpg': 'db98bcc07f',
  './img/layout-compact-dark.jpg': '242273151d',
  './img/layout-compact-es.jpg': '24e941516f',
  './img/layout-compact-es-dark.jpg': '00c18403ea',
  './connect-four/index.html': '7af02d64d6',
  './connect-four/js/ui.js': '07654b024d',
  './connect-four/js/worker.js': 'fee47efdaa',
  './connect-four/js/game.js': '2da8d12176',
  './connect-four/js/board.js': '9c92c88247',
  './connect-four/js/ai.js': '5c1a88bc39',
  './connect-four/js/strings.js': 'c75da9ca32',
  './connect-four/css/connect-four.css': '14251ccb03',
  './chinchon/index.html': '077ad16ca0',
  './chinchon/css/chinchon.css': 'cd3a013f19',
  './chinchon/js/deck.js': '2260c3f606',
  './chinchon/js/meld.js': '5166c4b913',
  './chinchon/js/cards.js': '8345ff44a9',
  './chinchon/js/game.js': 'ff23b6d017',
  './chinchon/js/hash.js': '9bbf5d8385',
  './chinchon/js/ai.js': 'd69864fbc2',
  './chinchon/js/ui.js': '0cd05fcba9',
  './chinchon/js/strings.js': '408386915e',
  './parchis/': 'ee4e32987e',
  './parchis/index.html': 'ee4e32987e',
  './filler/': '12eb5af876',
  './filler/index.html': '12eb5af876',
  './filler/css/filler.css': '89d92bcc00',
  './filler/js/ui.js': '26ebc691be',
  './filler/js/game.js': '90ce8fb511',
  './filler/js/ai.js': '7696a3c895',
  './filler/js/hash.js': '3491931082',
  './filler/js/strings.js': '979ddc00fc',
  './escoba/index.html': '83eeab5af3',
  './escoba/css/escoba.css': '775b3769cb',
  './escoba/js/deck.js': '82f42af6d3',
  './escoba/js/cards.js': 'bff122678a',
  './escoba/js/game.js': 'd86364718a',
  './escoba/js/hash.js': '032dbfed1a',
  './escoba/js/ai.js': '66a7d1f37a',
  './escoba/js/ui.js': 'bf7bc93ffb',
  './escoba/js/strings.js': 'afccb92f86',
  './escoba/img/broom-sprite.webp': 'c1a0f8a912',
  './mancala/index.html': 'bddd26c9cf',
  './mancala/css/mancala.css': 'b9f63a0db8',
  './mancala/js/game.js': 'd9dca9c8af',
  './mancala/js/ai.js': 'bab360f91d',
  './mancala/js/howto.js': '8dba5624b3',
  './mancala/js/ui.js': '28e5ab7e62',
  './mancala/js/hash.js': 'b4463cdbea',
  './mancala/js/strings.js': '0c41a1d1a7',
  './nuts-bolts/': '7ab25eee1d',
  './nuts-bolts/index.html': '7ab25eee1d',
  './minesweeper/': '122a4290ea',
  './minesweeper/index.html': '122a4290ea',
  './minesweeper/css/minesweeper.css': '2e3b6c93d5',
  './minesweeper/js/ui.js': '652fb1ea36',
  './minesweeper/js/engine.js': '764025ec21',
  './minesweeper/js/strings.js': 'db62f643f8',
  './contexto/': 'b0c9ee8e9d',
  './contexto/index.html': 'b0c9ee8e9d',
  './contexto/css/contexto.css': 'abcf107a31',
  './contexto/js/ui.js': '171dfe37bb',
  './contexto/js/engine.js': 'f19c3f8978',
  './contexto/js/strings.js': 'e3ddf5db70',
  './contexto/data/en.json': '551bf113af',
  './contexto/data/en.bin': '813c417b83',
  './contexto/data/es.json': 'e47cdfe189',
  './contexto/data/es.bin': 'b604406b23',
  './murdoku/': '05fbbc038a',
  './murdoku/index.html': '05fbbc038a',
  './murdoku/css/murdoku.css': 'ec84773045',
  './murdoku/js/ui.js': '49446a4207',
  './murdoku/js/engine.js': '46518c0de8',
  './murdoku/js/strings.js': 'e744e28e32',
  './sudoku/': '39055429fc',
  './sudoku/index.html': '39055429fc',
  './sudoku/css/sudoku.css': '146887ebaf',
  './sudoku/js/ui.js': 'f80f674a5c',
  './sudoku/js/game.js': 'a49c5bbb46',
  './sudoku/js/generator.js': '2d3d2c92f1',
  './sudoku/js/solver.js': 'c12fe83ae8',
  './sudoku/js/strings.js': 'ba44b32363',
  './nuts-bolts/css/nuts-bolts.css': '1015089346',
  './nuts-bolts/js/ui.js': 'adb14b4d29',
  './nuts-bolts/js/game.js': '5fc7b00493',
  './nuts-bolts/js/generator.js': '1ac4f71b79',
  './nuts-bolts/js/strings.js': 'd7ba835b23',
  './tic-tac-toe/': 'b541f43869',
  './tic-tac-toe/index.html': 'b541f43869',
  './tic-tac-toe/css/tic-tac-toe.css': '4950d82ac5',
  './tic-tac-toe/js/ui.js': '09f0b6e3d7',
  './tic-tac-toe/js/game.js': '5dd6dfd541',
  './tic-tac-toe/js/ai.js': 'ea779916ba',
  './tic-tac-toe/js/hash.js': 'fc3c1f6bac',
  './tic-tac-toe/js/strings.js': '73f3ae5574',
  './dots-boxes/': 'db0a41b47e',
  './dots-boxes/index.html': 'db0a41b47e',
  './dots-boxes/css/dots-boxes.css': 'f17de2de92',
  './dots-boxes/js/ui.js': '7badc618d2',
  './dots-boxes/js/game.js': 'cd0edd18d7',
  './dots-boxes/js/ai.js': '37b84eb6ff',
  './dots-boxes/js/hash.js': '4efa5d47bf',
  './dots-boxes/js/strings.js': 'a029594ba0',
  './ball-run/index.html': 'd92adb2397',
  './ball-run/css/ball-run.css': '4e83977223',
  './ball-run/js/ui.js': 'e8f19edb1e',
  './ball-run/js/config.js': '98ec5079f8',
  './ball-run/js/track.js': '7e7c04a63d',
  './ball-run/js/sim.js': 'c8340ae6c5',
  './ball-run/js/input.js': '7f41531072',
  './ball-run/js/render.js': '26c7f09478',
  './ball-run/js/strings.js': '861d6696a9',
  './ball-run/vendor/three.module.min.js': 'd719de9cf8',
  './boggle/': 'd0c04fdb10',
  './boggle/index.html': 'd0c04fdb10',
  './boggle/css/boggle.css': 'a28c01724c',
  './boggle/js/ui.js': 'fe4eb62063',
  './boggle/js/strings.js': '23479392ca',
  './boggle/js/game.js': '663b06d7a8',
  './boggle/js/dict.js': '20433bac4e',
  './boggle/js/solver.js': '94e9421d2c',
  './boggle/js/ai.js': '6b8f040514',
  './boggle/js/mp-round.js': 'a44ccf9426',
  './boggle/data/words.txt': '8df790b20b',
  './boggle/data/words-es.txt': '2c0210e78a',
  './snake/': 'f7b6207c85',
  './snake/index.html': 'f7b6207c85',
  './snake/css/snake.css': 'c109ec9312',
  './snake/js/ui.js': '438cb348fa',
  './snake/js/game.js': 'f69fbe6fe8',
  './snake/js/strings.js': '7d8a6ccce9',
  './brick-blitz/': '8f1267a3bb',
  './brick-blitz/index.html': '8f1267a3bb',
  './brick-blitz/css/brick-blitz.css': 'ab92a86eb8',
  './brick-blitz/js/ui.js': 'b62a23fe1c',
  './brick-blitz/js/game.js': 'ae87ee3447',
  './brick-blitz/js/strings.js': '00a75d8c6d',
  './holdem/': '11f6e0e99f',
  './holdem/index.html': '11f6e0e99f',
  './holdem/css/holdem.css': '1f9fda9318',
  './holdem/js/ui.js': 'd197ad72bf',
  './holdem/js/engine.js': 'b9e54a0c01',
  './holdem/js/ai.js': '3d8353f25c',
  './holdem/js/table.js': '1bd3d97111',
  './holdem/js/net-table.js': '287aa65964',
  './holdem/js/strings.js': 'e64024dbba',
  './hill-climb/': '692c1740cf',
  './hill-climb/index.html': '692c1740cf',
  './hill-climb/css/hill-climb.css': '3a56803147',
  './hill-climb/js/ui.js': '5d63239ec1',
  './hill-climb/js/physics.js': 'f9a9689016',
  './hill-climb/js/terrain.js': '5bc901c361',
  './hill-climb/js/render.js': '623cbf7db4',
  './hill-climb/js/catalog.js': 'af37e0755a',
  './hill-climb/js/store.js': 'ba8e06d2a7',
  './hill-climb/js/strings.js': '2e12d1e4cd',
  './skeeball/': '4563dfe45a',
  './skeeball/index.html': '4563dfe45a',
  './skeeball/flick-test.html': 'f310e43bb6',
  './skeeball/trajectory.html': '7b1b56365a',
  './skeeball/trajectory-map.json': 'fd7c177d36',
  './skeeball/css/skeeball.css': 'c50f746472',
  './skeeball/js/ui.js': 'd61994a581',
  './skeeball/js/swipe.js': 'c596f565de',
  './hoops4/js/game.js': '2e0010da15',
  './hoops4/js/mp.js': '8fc702be8a',
  './skeeball/js/game.js': '47f5932aaf',
  './skeeball/js/goals.js': '3289090081',
  './skeeball/js/challenge.js': '39c86ec1d4',
  './skeeball/js/challenge-ui.js': '3878c8a672',
  './skeeball/js/alert.js': 'c7fc8bef3b',
  './skeeball/js/boards.js': '8cf226684b',
  './skeeball/js/engines.js': '9d1dd1cf73',
  './skeeball/js/picstore.js': '59ba228dd4',
  './skeeball/js/machines/classic/physics.js': 'b912a8c325',
  './skeeball/js/machines/classic/machine.js': 'b54a000e56',
  './skeeball/js/machines/classic/render.js': '78407d2f5f',
  './skeeball/js/machines/popongo/physics.js': '94c33f8b00',
  './skeeball/js/machines/popongo/machine.js': '8d92102fe5',
  './skeeball/js/machines/popongo/render.js': 'fa6131bdd5',
  './skeeball/js/machines/basketball/physics.js': '0be92b613b',
  './skeeball/js/machines/basketball/machine.js': '3f7f45738b',
  './skeeball/js/machines/basketball/render.js': 'e4579e6a71',
  './skeeball/js/machines/brickcity/physics.js': 'f9dde01190',
  './skeeball/js/machines/brickcity/machine.js': '37b4fc044e',
  './skeeball/js/machines/brickcity/render.js': '4c3caf4e38',
  './skeeball/js/machines/runaway/physics.js': '853802b205',
  './skeeball/js/machines/runaway/machine.js': '5eb9e60730',
  './skeeball/js/machines/runaway/render.js': '7ddf36efc6',
  './skeeball/js/vendor/cannon-es.js': 'f0700cbd3a',
  './skeeball/js/vendor/three.module.min.js': '86bcee248b',
  './skeeball/js/vendor/three.core.min.js': '05b2609338',
  './skeeball/js/strings.js': 'b9122e4983',
  './golf/': '457d076497',
  './golf/index.html': '457d076497',
  './golf/css/golf.css': '8264a76361',
  './golf/js/ui.js': 'c668ae7251',
  './golf/js/strings.js': '1f268783ae',
  './golf/js/holes.js': '6011b2a797',
  './golf/js/obstacles.js': '96c7fbf66c',
  './golf/js/club-art.js': 'b501cf9342',
  './golf/js/clubs.js': '5de8b3cac0',
  './golf/js/swing.js': '50dfc9ca97',
  './golf/js/shot.js': '04cb5ce654',
  './golf/js/render.js': 'd9a7f0b4de',
  './golf/js/holegen.js': 'f5ad10ce1d',
  './golf/js/rounds.js': 'b6455879b1',
  './golf/js/board.js': 'f6c1612123',
  './golf/js/save.js': '0126d36c18',
  './golf/js/progress.js': '47d04c9fd5',
  './golf/js/tutorial.js': '750f5299f7',
  './golf/courses/pinevalley.js': 'aabb5248b9',
  './golf/courses/redmesa.js': 'c5eaf0e55b',
  './golf/courses/oasissands.js': 'b26e3a67c2',
  './golf/courses/coralkeys.js': 'ef13657708',
  './golf/courses/tutorial.js': '5f72833828',
  './dominoes/': '042b51de46',
  './dominoes/index.html': '042b51de46',
  './dominoes/css/dominoes.css': 'b7b65f248d',
  './dominoes/js/ui.js': '30b0e5a4b5',
  './dominoes/js/game.js': '99e5127583',
  './dominoes/js/board.js': 'bd0c13936b',
  './dominoes/js/ai.js': 'ddb3b3d4e7',
  './dominoes/js/tiles.js': '407c898f3a',
  './dominoes/js/tutorial.js': '50f99386a6',
  './dominoes/js/strings.js': 'a176750284',
  './uno/': '04dd53b92d',
  './uno/index.html': '04dd53b92d',
  './uno/css/uno.css': 'c30de5e6ae',
  './uno/js/ui.js': '56f575413f',
  './uno/js/game.js': '6ffaaf31b2',
  './uno/js/ai.js': '0edaa2fea7',
  './uno/js/strings.js': 'b9e08ff8e3',
  './yahtzee/': '8a3981aec3',
  './yahtzee/index.html': '8a3981aec3',
  './yahtzee/css/yahtzee.css': 'c091c6a113',
  './yahtzee/js/howto.js': '6b8bb92ca6',
  './yahtzee/js/strings.js': 'ce61d552c4',
  './yahtzee/js/ui.js': '8db19a62e2',
  './yahtzee/js/hash.js': '14b905be65',
  './battleship/': 'e96682ec6b',
  './battleship/index.html': 'e96682ec6b',
  './battleship/css/battleship.css': 'e0f411836a',
  './battleship/js/ui.js': 'bf46758ee5',
  './battleship/js/game.js': 'd60d57f119',
  './battleship/js/fleet.js': 'b2c03f8517',
  './battleship/js/ai.js': 'c31bd9837a',
  './battleship/js/hash.js': 'aed473aee9',
  './battleship/js/ship-art.js': '11ea9db668',
  './battleship/js/strings.js': 'fc697544c4',
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
// ONE-TIME FORCED REFETCH (2026-09-01). The surgical counterpart to PURGE_ALL_CACHES below: a
// cached entry that is stale under its CURRENT name is invisible to every check this worker makes
// (the manifest hash it is stored against is the correct one -- the BYTES are wrong), so it
// survives deploys indefinitely. Anything listed here is dropped from the current cache at the
// start of the warm, which then refetches it with `cache: 'reload'`. Cost is one file, not 8.4 MB.
// Entries can be removed once a deploy carrying them has shipped.
const FORCE_REFETCH = [
  './tic-tac-toe/css/tic-tac-toe.css',
];

async function warmRest() {
  const cache = await caches.open(CACHE);
  for (const p of FORCE_REFETCH) {
    try { await cache.delete(p, { ignoreSearch: true }); } catch { /* nothing to drop */ }
  }
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
  // Which held-back games this phone's launcher shows (SHOWN_GAMES). Read from the old
  // generation too, so a CACHE bump keeps warming what the phone already plays.
  let shown = [];
  for (const c of [cache, ...oldCaches]) {
    try {
      const res = await c.match(SHOWN_KEY);
      if (res) {
        shown = await res.json();
        if (c !== cache) await cache.put(SHOWN_KEY, new Response(JSON.stringify(shown)));
        break;
      }
    } catch { /* unreadable: warm nothing held back, the launcher re-sends it */ }
  }
  const shownSet = new Set(Array.isArray(shown) ? shown : []);
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
        // A LAZY asset is never fetched by the warm - it is downloaded by the fetch handler the
        // first time the game that needs it actually asks for it, and cached on demand there. Note
        // this sits BELOW the carry-forward above on purpose: a device that already has the file
        // keeps it across every deploy for free. Not a failure, so it is not reported as one.
        if (isLazyAsset(path)) continue;
        const owner = HELD_BACK_OWNER.get(path);
        if (owner) {
          // A held-back file has no hash, so it is carried forward as it is: it is served
          // network-first, so an older copy is only ever the offline fallback.
          let copied = false;
          for (const c of oldCaches) {
            const prev = await c.match(path, { ignoreSearch: true });
            if (prev) { await cache.put(path, prev); carried++; copied = true; break; }
          }
          // A game this phone cannot see is not fetched (BELOW the carry-forward, like LAZY).
          if (copied || !shownSet.has(owner)) continue;
        }
        const res = await fetch(new Request(path, { cache: 'reload' }));
        if (res && res.ok) await cache.put(path, res.clone());
        else failed.push(path);
      } catch { failed.push(path); }
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
  if (failed.length) {
    console.warn(`[sw] ${CACHE}: ${failed.length}/${WARMED.length} non-shell assets could not be precached`
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

// ONE GAME'S FILES, NOW (2026-10-14). A Game Hub message's Play button (js/hub.js openGameFresh)
// opens a game right after a new build took over, which is exactly when warmRest() above has not
// reached that game yet: until it does, the game's CHANGED files are answered from the previous
// build's cache (the fetch handler's caches.match fallback). This does warmRest's job for one game
// folder, first: same carry-forward by content hash, same `cache: 'reload'`, same skip of LAZY data.
// Additive only - it puts files into the CURRENT cache and deletes nothing; warmRest later finds
// them present and skips them. HELD_BACK files are included: the person is opening this very game.
// Replies {ok, fetched, carried, failed}.
async function warmGame(dir) {
  const d = String(dir || '');
  if (!/^[a-z0-9-]{2,40}$/.test(d)) return { ok: false, fetched: 0, carried: 0, failed: 0 };
  const prefix = `./${d}/`;
  const queue = REST.filter((p) => p.startsWith(prefix) && !isLazyAsset(p));
  const cache = await caches.open(CACHE);
  const oldCaches = [];
  for (const k of await caches.keys()) {
    if (k !== CACHE && k.startsWith('game-hub-')) oldCaches.push(await caches.open(k));
  }
  let stored = null;
  for (const c of [cache, ...oldCaches]) {
    try { const res = await c.match(MANIFEST_KEY); if (res) { stored = await res.json(); break; } } catch { /* absent */ }
  }
  let fetched = 0, carried = 0, failed = 0;
  const worker = async () => {
    for (;;) {
      const path = queue.shift();
      if (path === undefined) return;
      try {
        if (await cache.match(path, { ignoreSearch: true })) continue;
        if (stored && stored[path] && REST_MANIFEST[path] && stored[path] === REST_MANIFEST[path]) {
          let copied = false;
          for (const c of oldCaches) {
            const prev = await c.match(path, { ignoreSearch: true });
            if (prev) { await cache.put(path, prev); carried++; copied = true; break; }
          }
          if (copied) continue;
        }
        const res = await fetch(new Request(path, { cache: 'reload' }));
        if (res && res.ok) { await cache.put(path, res.clone()); fetched++; } else failed++;
      } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
  return { ok: failed === 0, fetched, carried, failed };
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
  // The shell is ALWAYS fetched with `cache: 'reload'` (2026-10-14). Without it the browser's HTTP
  // disk cache may answer: GitHub Pages sends `max-age=600`, so a deploy landing within ten minutes
  // of the last one installed the PREVIOUS build's bytes under the NEW cache name - and a
  // cache-first shell module then served them for the whole build. Matt's phone showed the old
  // Arrow Maze tile at v1132 while the server had the new one (js/game-art.js). It costs nothing:
  // Pages re-stamps every ETag on every deploy, so an expired copy re-downloads in full anyway.
  // (Same reason with the purge on: a purge that re-imports the corruption it deleted is not a
  // recovery.)
  event.waitUntil(
    (async () => {
      if (PURGE_ALL_CACHES) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

// The hub header's version pill asks the ACTIVE worker which build it runs.
// Reply over the provided MessageChannel port so the answer reaches the caller
// even with multiple clients open.
// One warm at a time: activate starts one, and a SHOWN_GAMES change queues another behind it.
let _warmChain = Promise.resolve();
function queueWarm() {
  _warmChain = _warmChain.then(() => warmRest()).catch((err) => console.warn('[sw] precache warm failed', err));
  return _warmChain;
}

// The hub says which held-back games this phone's launcher shows (js/hub.js, after each launcher
// paint, only when the list changes). Stored in the current cache; a newly shown game is warmed now.
async function noteShownGames(ids) {
  const want = [...new Set(ids.filter((id) => typeof id === 'string' && HELD_BACK[id]))].sort();
  const cache = await caches.open(CACHE);
  let had = [];
  try { const res = await cache.match(SHOWN_KEY); if (res) had = await res.json(); } catch { /* treat as none */ }
  if (JSON.stringify(had) === JSON.stringify(want)) return;
  await cache.put(SHOWN_KEY, new Response(JSON.stringify(want)));
  if (want.some((id) => !had.includes(id))) await queueWarm();
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ type: 'VERSION', cache: CACHE });
  }
  if (event.data && event.data.type === 'SHOWN_GAMES' && Array.isArray(event.data.ids)) {
    event.waitUntil(noteShownGames(event.data.ids).catch((err) => console.warn('[sw] SHOWN_GAMES failed', err)));
  }
  if (event.data && event.data.type === 'WARM_GAME') {
    const port = event.ports && event.ports[0];
    const reply = (r) => { if (port) port.postMessage(Object.assign({ type: 'WARMED' }, r)); };
    event.waitUntil(warmGame(event.data.dir).then(reply, () => reply({ ok: false, failed: 1 })));
  }
});

// --- PUSH NOTIFICATIONS (2026-09-23) ------------------------------------------------------------
// Sent by functions/index.js (a Firebase Cloud Function; the only holder of the private key) to a
// device that turned them on through js/push.js. The payload is JSON {title, body, tag, url}.
//
// EVERY PUSH SHOWS A NOTIFICATION, WITHOUT EXCEPTION. Safari revokes the subscription of a site
// whose push arrives and shows nothing, and Chrome shows a generic one in its place. So a payload
// that will not parse still shows something honest rather than nothing.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  const title = String(d.title || 'Game Hub');
  const opts = {
    body: String(d.body || ''),
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    // One notification per match: a second turn in the same game replaces the first.
    tag: String(d.tag || 'game-hub'),
    renotify: true,
    data: { url: String(d.url || './'), game: String(d.game || ''), with: String(d.with || ''), name: String(d.name || ''), match: String(d.match || '') },
  };
  event.waitUntil(self.registration.showNotification(title, opts).then(syncBadge));
});

// TAP: bring the hub forward, onto the game the notification is about. An open window is told by
// message (it may be mid-game; js/hub.js decides what is safe); otherwise a fresh one opens on
// `?open=<game>`, which js/hub.js reads once after the launcher paints.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  syncBadge();
  const data = event.notification.data || {};
  // WHICH MATCH (2026-09-24). Matt: "when i click on the connect 4 hoops notification, it takes me
  // to the setup screen... It should take me directly to that game." The payload never named the
  // match, but the Cloud Function has always TAGGED it `hoops-<gameId>` (skeeball `skee-<id>`), so
  // the id is read from there - no function redeploy needed. `data.match` wins if a later payload
  // carries it. The hub validates it before use.
  const tag = String(event.notification.tag || '');
  // Cup Pong's payload names its match outright (`match`, 2026-09-28) and tags it `cuppong-<id>`.
  // Every challenge game's tag is `<node>-<matchId>` (2026-10-14: Darts, Flick Soccer and the rest
  // too, as a fallback should a payload ever arrive without `match`).
  const tagged = /^(?:hoops|cuppong|darts|flicksoccer|archery|skee)-([A-Za-z0-9_-]{4,40})$/.exec(tag);
  const match = String(data.match || (tagged ? tagged[1] : ''));
  const u0 = new URL(data.url || './', self.registration.scope);
  if (match) u0.searchParams.set('match', match);
  const url = u0.href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const scope = self.registration.scope;
    const bare = (u) => u.split(/[?#]/)[0];
    // The hub itself is told by message. Any other page of ours (the profile page, a standalone
    // game) is sent to the hub's URL instead, since only the hub knows how to open a game.
    const hub = wins.find((w) => bare(w.url) === scope || bare(w.url) === scope + 'index.html');
    if (hub) {
      try { await hub.focus(); } catch { /* iOS may refuse; the message still lands */ }
      hub.postMessage({ type: 'OPEN_GAME', game: data.game || '', with: data.with || '', name: data.name || '', match });
      return;
    }
    const ours = wins.find((w) => w.url.startsWith(scope));
    if (ours && typeof ours.navigate === 'function') {
      try { await ours.focus(); await ours.navigate(url); return; } catch { /* fall through to a new window */ }
    }
    await self.clients.openWindow(url);
  })());
});

// APP ICON BADGE (2026-10-14). Matt: "Can we get badge notifications on the app icon when there's
// a notification?" The number is how many of our notifications are showing. Set only AFTER the
// notification is shown, and never throws, so a badge failure can never cost a notification.
// Supported: iPhone Home Screen app (iOS 16.4+), installed desktop Chrome/Edge; elsewhere a no-op.
// js/push.js clearShownNotifications() clears it when the hub opens.
async function syncBadge() {
  try {
    const nav = self.navigator;
    if (!nav || typeof nav.setAppBadge !== 'function') return;
    const shown = await self.registration.getNotifications().catch(() => null);
    // An unknown count (no getNotifications) after a push still badges: 1, never nothing.
    const n = shown ? shown.length : 1;
    if (n > 0) await nav.setAppBadge(n);
    else if (typeof nav.clearAppBadge === 'function') await nav.clearAppBadge();
  } catch { /* a badge is a nicety; the notification already showed */ }
}

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
      .then(() => { queueWarm(); })
  );
});

// Immutable static assets (images, fonts) — served cache-first so re-created
// <img> elements resolve instantly instead of waiting on a network round-trip
// (that latency made card boards flash blank on every re-render). These files
// are versioned by the CACHE bump on each deploy, so cache-first is always safe.
const STATIC_RE = /\.(webp|png|jpe?g|gif|svg|woff2?|ttf)$/i;

// The REST tier's own paths, for the cache-first branch below.
//
// GAME CODE IS CACHE-FIRST (2026-09-01). Matt, on a screen recording from Anita's phone of
// opening Skeeball: "Why does it take so long? It needs to be better than this."
//
// Measured cause, with the whole game verifiably sitting in this cache already: opening Skeeball
// still sent 28 requests and 2,188 KB to the server. Network-first is why. `cache: 'reload'`
// below deliberately bypasses the browser's HTTP cache, and the cached copy is only served if the
// network LOSES the NET_TIMEOUT_MS race - so on any connection that is not outright bad, every
// module in a game's graph is re-downloaded in full on every single open. The deadline and the
// slow latch cap how BAD that gets; they do not stop it happening.
//
// The REST tier is exactly the right boundary for fixing it, and the boundary already exists:
//   - It is per-deploy versioned already. CACHE is bumped on essentially every commit, and
//     REST_MANIFEST (generated from the bytes on disk by validate-sw-assets.mjs, with
//     test-sw-strategy.mjs failing the deploy if it is stale) is what decides, file by file,
//     whether a deploy carries a copy forward or re-fetches it. A content hash is a better
//     freshness signal than an HTTP validator here - GitHub Pages re-stamps every ETag on every
//     deploy - so re-asking the network per request buys nothing it does not already have.
//   - THE SHELL WAS DELIBERATELY LEFT ALONE AT FIRST, AND IS NO LONGER (2026-09-01, same day).
//     It said here that index.html, css/, js/ and profile/ stay network-first "so every shared
//     module that touches player data keeps its freshness guarantee". Measuring the hub's own
//     launch showed what that cost: 35 requests and 687 KB on EVERY open of a warm app. Matt's
//     call was to split it rather than keep it - the data modules stay fresh by name, the rest is
//     cache-first. See NETWORK_FIRST above for the list and the two guards that hold it together.
//     Documents are still network-first either way, so a device still discovers a new deploy on
//     the very next hub load and the version pill keeps telling the truth.
//   - Navigations are excluded (see the handler), so a game's standalone index.html is still
//     fetched honestly.
//
// THE COST, ACCEPTED: on the first hub load after a deploy, a game opened before warmRest() has
// reached its files runs the PREVIOUS build's code for that one visit. That was already true
// offline and past the deadline; it is now briefly true online too. The warm finishes in seconds
// and the next open is the new build. Two point two megabytes per open, on a phone, was the worse
// bargain.
//
// pinball2 IS THE EXCEPTION, and it is excluded by path. Matt, 2026-09-11: "It's perfect when I open
// it within the Claude app. But when I open it in the chrome app it's the old one with the holes."
// The Claude app has no service worker registered, so it fetched the new build; Chrome had one, and
// cache-first handed it the previous build's physics from cache. The bargain above is the right one
// for a RELEASED game, where the code changes rarely and the saving is 2.2 MB per open. It is the
// wrong one for a tool that is being changed several times an hour and judged by how it plays: a
// stale build there is not a slower open, it is the wrong answer to "is this fixed yet". It goes
// back to network-first, which still falls back to the cache offline and past the deadline.
//
// (2026-10-14) Generalised: EVERY held-back file (pinball2 is one of them) is network-first, for
// the same reason - an admin-only game is the one being changed several times an hour. It is also
// what lets those edits ship with NO sw.js change: a held-back file carries no REST_MANIFEST hash,
// so a cache-first copy of it could never be told it was stale.
const DEV_FRESH_PATHS = new Set([...HELD_BACK_OWNER.keys()].map((p) => new URL(p, self.location.href).pathname));
const CACHE_FIRST_PATHS = new Set(
  [...REST, ...SHELL_CACHE_FIRST]
    .filter((p) => !HELD_BACK_OWNER.has(p))
    .map((p) => new URL(p, self.location.href).pathname));

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

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // THE HOLE EDITOR IS NOT PART OF THE APP (2026-09-23). It lives under this worker's scope, so its
  // page and every golf engine module it imports came through the handlers below - and the golf
  // engine is REST tier, CACHE-FIRST. A device holding an older render.js served it to a newer
  // editor, which imports an export that copy does not have: "doesn't provide an export named
  // 'TREE_FILL'", and the editor could not start. The editor is outside ASSETS, has no offline
  // promise to keep, and must always build holes with the golf code that is live now - so the
  // editor's page and everything it loads (a module import's referrer is the importing module)
  // go straight to the network, untouched by this worker.
  if (sameOrigin && (url.pathname.includes('/hole-editor/') || (req.referrer && new URL(req.referrer).pathname.includes('/hole-editor/')))) return;

  // Cache-first for immutable same-origin assets: images and fonts (which are versioned by the
  // CACHE bump, and whose network round-trip made card boards flash blank on every re-render),
  // every file in the REST tier - each game's own code and assets - and, since 2026-09-01, the
  // part of the SHELL that does not touch player data. See CACHE_FIRST_PATHS / NETWORK_FIRST above
  // for what is in each set and why the fresh half is hand-listed.
  // A navigation is never answered from here: a standalone game page is a document, and a
  // document is how a device finds out a new build exists.
  //
  // The CURRENT cache is consulted before the global caches.match (2026-08-23): while warmRest()
  // runs, the previous deploy's cache is still alive as a fallback, and caches.match searches
  // caches in CREATION order - so without this, an entry already refreshed into the new cache
  // would keep being answered by the older cache's stale copy until the warm finished.
  if (sameOrigin && req.mode !== 'navigate' && !DEV_FRESH_PATHS.has(url.pathname)
      && (STATIC_RE.test(url.pathname) || CACHE_FIRST_PATHS.has(url.pathname))) {
    event.respondWith((async () => {
      const cur = await caches.open(CACHE);
      const cached = (await cur.match(req, { ignoreSearch: true }))
        || (await caches.match(req, { ignoreSearch: true }));
      if (cached) return cached;
      try {
        // `cache: 'reload'` is LOAD-BEARING, for the same reason it is on the network-first path
        // below (the "fifth-playthrough fix"): the browser's own HTTP disk cache sits between this
        // handler and the wire, and Pages serves every file with `max-age=600`. A plain fetch()
        // here can be answered out of that disk cache with the PREVIOUS deploy's bytes, and this
        // line then writes them into the NEW cache under the new name -- where warmRest()'s
        // "already present, skip it" check leaves them for ever, and every later deploy CARRIES
        // THEM FORWARD, since the manifest hash they are stored against is the correct new one.
        // The result is a device whose version pill reads the new build while a game renders the
        // old one, with no way to clear it from inside the app. That shipped on 2026-09-01 with
        // the cache-first split and stranded Tic Tac Toe's board on one device.
        const res = await fetch(new Request(req, { cache: 'reload' }));
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
