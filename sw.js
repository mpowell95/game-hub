// sw.js — shared service worker for the Game Hub. Precaches the app shell and [docs/SW-NOTES.md #1]
// IMPORTANT UPDATES (2026-10-22, Matt: "push this update to everyone. make sure they all download it",
// then "flag important ones"). A phone whose page loaded a build OLDER than this number takes the new
// build at its next visit to the launcher (never mid-game), instead of waiting for a fresh open
// (js/hub.js, "FEWER UPDATES FOR PLAYERS"). Raise it to the new CACHE number on a deploy that every
// phone should get now; leave it alone for small fixes.
const IMPORTANT_SINCE = 1272;
const CACHE = 'game-hub-v1272';

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
  './js/tabbar-fix.js',
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
  // Report a bug (2026-08-11) + the launcher announcement that introduces it. All five are she... [docs/SW-NOTES.md #2]
  './js/error-log.js',
  './js/bug-report.js',
  './js/bug-report-ui.js',
  './js/announce.js',
  './js/announce-ui.js',
  // Player-to-player messages (2026-08-31). SHELL for the same reason the bug report is: messages.js
  // is imported by the launcher on every load (the profile pill's badge, and the outbox drain), and
  // a message written offline has to be able to queue itself on the device that is offline.
  './js/messages.js',
  './js/live-read.js',
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
  // The announcement's "here is where the button lives" pictures. Deliberately NOT under ./ico... [docs/SW-NOTES.md #3]
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
  './js/game-chat-history.js',
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
  // NOTE: the challenge celebration images (js/challenge/assets/*) are deliberately NOT [docs/SW-NOTES.md #4]
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
  './chinchon/js/mp.js',
  './chinchon/js/alert.js',
  './chinchon/js/ch-ui.js',
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
  './escoba/js/mp.js',
  './escoba/js/mp-ui.js',
  './escoba/js/alert.js',
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
  './spelling-bee/',
  './spelling-bee/index.html',
  './spelling-bee/css/spelling-bee.css',
  './spelling-bee/js/ui.js',
  './spelling-bee/js/engine.js',
  './spelling-bee/js/strings.js',
  './spelling-bee/js/board.js',
  './spelling-bee/data/bee.json',
  './spelling-bee/data/bee-es.json',
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
  './way-out/js/tricky.js',
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
  './archery/models/bow.bin',
  './eight-ball/',
  './eight-ball/index.html',
  './eight-ball/css/eight-ball.css',
  './eight-ball/js/ui.js',
  './eight-ball/js/engine.js',
  './eight-ball/js/ai.js',
  './eight-ball/js/render.js',
  './eight-ball/js/strings.js',
  './eight-ball/js/mp.js',
  './eight-ball/js/mp-ui.js',
  './eight-ball/js/alert.js',
  './battle-arena/',
  './battle-arena/index.html',
  './battle-arena/css/battle-arena.css',
  './battle-arena/js/ui.js',
  './battle-arena/js/engine.js',
  './battle-arena/js/monsters.js',
  './battle-arena/js/cpu.js',
  './battle-arena/js/art.js',
  './battle-arena/js/strings.js',
  './battle-arena/js/online.js',
  './battle-arena/js/mp.js',
  './battle-arena/js/live.js',
  './battle-arena/js/online-ui.js',
  './battle-arena/js/alert.js',
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
  // Golf. The 3D stack it used to carry - three.js, cannon-es and the nine modules around them... [docs/SW-NOTES.md #5]
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
  // stage 4 (docs/BASEBALL-3D-BUILD.md section 3.6): the 3D model + its four team-skin texture... [docs/SW-NOTES.md #6]
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
  './battleship/js/mp.js',
  './battleship/js/alert.js',
];

// NOTE: the Add-to-Home-Screen sheet's iOS step screenshots (icons/a2hs/*.png, [docs/SW-NOTES.md #7]

// Chinchón decks. [docs/SW-NOTES.md #8]
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

// --- two-tier precache --------------------------------------------------------------------... [docs/SW-NOTES.md #9]
const NON_SHELL_JS = /^\.\/js\/emoji-search-[a-z]{2}\.js$/;

function isShellAsset(p) {
  if (NON_SHELL_JS.test(p)) return false;
  return p === './' || p === './index.html' || p === './manifest.webmanifest'
    || p.startsWith('./css/') || p.startsWith('./js/')
    || p.startsWith('./icons/') || p.startsWith('./profile/');
}
const SHELL = ASSETS.filter(isShellAsset);
const REST = ASSETS.filter((p) => !isShellAsset(p));

// --- the LAZY tier: in ASSETS, but never downloaded until somebody opens the game (2026-09-... [docs/SW-NOTES.md #10]
const LAZY_REST = /^\.\/(boggle\/data\/words[a-z-]*\.txt|contexto\/data\/[a-z]+\.(json|bin)|spelling-bee\/data\/bee(-es)?\.json)$/;
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
  'archery': [
    './archery/',
    './archery/index.html',
    './archery/css/archery.css',
    './archery/js/ui.js',
    './archery/js/render.js',
    './archery/js/bow3d.js',
    './archery/js/strings.js',
    './archery/js/mp-ui.js',
    './archery/js/alert.js',
    './archery/models/bow.bin',
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
  'battle-arena': [
    './battle-arena/',
    './battle-arena/index.html',
    './battle-arena/css/battle-arena.css',
    './battle-arena/js/ui.js',
    './battle-arena/js/cpu.js',
    './battle-arena/js/art.js',
    './battle-arena/js/strings.js',
    './battle-arena/js/live.js',
    './battle-arena/js/online-ui.js',
    './battle-arena/js/alert.js',
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
};
// __HELD_BACK_END__
const HELD_BACK_OWNER = new Map();
for (const [id, paths] of Object.entries(HELD_BACK)) for (const p of paths) HELD_BACK_OWNER.set(p, id);
const SHOWN_KEY = './__shown-games__';
// HELD BACK BUT SWITCHED LIVE (2026-10-26). Matt: "me making the switch solves it instantly". A
// held-back game switched live on the admin page (js/hub.js `LIVE_HELD`) is served from the cache at
// once instead of network-first (Darts took ~4 s to open on his phone), and the hub's message on
// each page load refreshes ALL its files in the background, so the next open has the new code.
const LIVE_KEY = './__live-held__';

// --- the shell's own split: always-fresh vs cache-first (2026-09-01) ----------------------... [docs/SW-NOTES.md #11]
const NETWORK_FIRST = [
  // Documents. Also excluded by req.mode !== 'navigate' below; belt and braces.
  './', './index.html', './profile/', './profile/index.html',
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
// It holds the SHELL's hashes too (2026-10-22), for the install's carry-forward. Everything is
// cache-first now, so a STALE manifest (a session edited a file and deployed without running the
// validator) would keep a phone on the old copy until that file changes again:
// tools/test-sw-strategy.mjs fails on any stale entry, shell or rest.
// __REST_MANIFEST_START__
const REST_MANIFEST = {
  './manifest.webmanifest': 'cd3b726da1',
  './css/hub.css': '7ee4518a10',
  './css/name-gate.css': '91402215cc',
  './css/ui.css': '967c4f25e3',
  './js/hub.js': '684269a7b8',
  './js/name-gate.js': 'dffbdf06a1',
  './js/name-gate-auto.js': '2c296ba493',
  './js/no-zoom.js': 'adf92fcd05',
  './js/a2hs.js': '0dd98205a9',
  './js/favorites.js': '42997e1b0d',
  './js/launcher-sort.js': '5687e93cca',
  './js/new-badge.js': '5e6fb339ea',
  './js/i18n.js': '82070fcbe4',
  './js/theme.js': 'e8b40b1bc2',
  './js/layout.js': '2517577123',
  './js/tabbar-fix.js': 'ba4e290b37',
  './js/viewport.js': '756ba19ed9',
  './js/strings.js': '36c47e4048',
  './js/profile-store.js': '33523b1fdd',
  './js/emoji.js': 'a60ec09c12',
  './js/emoji-data.js': '7506ef6d21',
  './js/firebase-config.js': '66cb4bbdb3',
  './js/game-stats.js': '3c9804e43b',
  './js/arcade-scores.js': 'a0497ce069',
  './js/game-stats-global.js': 'd56d2b6377',
  './js/game-stats-ui.js': '5f22195a52',
  './js/stats-net.js': '1a6dfaeb0b',
  './js/firebase-boot.js': '8d10f6458c',
  './js/device-report.js': '22d5aec601',
  './js/error-log.js': '2ce0a7eaf3',
  './js/bug-report.js': 'f2c4625238',
  './js/bug-report-ui.js': '70d7e7b2a6',
  './js/announce.js': '6cce5c6cc6',
  './js/announce-ui.js': '0bdfcd673d',
  './js/messages.js': 'b8ebafec81',
  './js/live-read.js': '0c8419185d',
  './js/messages-ui.js': '5349424c2f',
  './js/hub-messages.js': 'c91ce9936a',
  './js/challenges.js': 'a0109139ff',
  './js/challenges-ui.js': '857219db28',
  './js/challenge-life.js': '44ab3fcbc6',
  './js/challenges-strings.js': 'd45ac6cd00',
  './js/mp-records.js': 'addbe2f5a3',
  './js/push.js': '59adfa5053',
  './js/career-store.js': 'a815a02653',
  './js/admin-config.js': '8036b5cae4',
  './js/admin-ui.js': 'b2b8a4ee61',
  './js/stats-corrections.js': 'cf8c62bb60',
  './js/install-state.js': '697e4dc90b',
  './js/players-agg.js': '494725a0a5',
  './js/game-art.js': 'ba73866754',
  './js/hidden-players.js': '8a870d0456',
  './js/leaderboard-ui.js': '3d7a34aaff',
  './js/leaderboard-rank.js': '7d0aed67b8',
  './js/arrow-maze-time.js': '5c84bf56fc',
  './js/gridlock-points.js': '8a4fcce246',
  './js/gridlock-v1map.js': 'f83ca3500e',
  './js/difficulty-tiers.js': 'b238c3023b',
  './js/net.js': 'd65b57c6b3',
  './js/online-gate.js': '4b30cbdfc2',
  './js/mp-code-copy.js': '2acdbe0e22',
  './js/mp-reactions.js': 'ce1900931d',
  './js/mp-reactions-ui.js': 'dce07d73bf',
  './js/match-chat.js': '784d478433',
  './js/match-chat-ui.js': '969116343f',
  './js/game-chat-history.js': '43f78e5de1',
  './js/challenge/crypt.js': '8d4c5fe938',
  './js/challenge/secrets.js': '0ddf67616f',
  './js/challenge/challenge-store.js': '0b930c4f9e',
  './js/challenge/hooks.js': '171bc1fe63',
  './js/challenge/unlock.js': '7594e38568',
  './js/challenge/reveal.js': 'f9efec6466',
  './js/challenge/challenge-ui.js': '45978222ae',
  './js/challenge/challenge-net.js': '96a5b3c1d9',
  './js/challenge/keepsake.js': '64c10179e7',
  './css/challenge.css': 'df2abacefe',
  './icons/icon.svg': '00cbd8397e',
  './icons/icon-192.png': 'ebd15e9db6',
  './icons/icon-512.png': 'a248f6c278',
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
  './chinchon/css/chinchon.css': '73c68eb13e',
  './chinchon/js/deck.js': '2260c3f606',
  './chinchon/js/meld.js': '5166c4b913',
  './chinchon/js/cards.js': '8345ff44a9',
  './chinchon/js/game.js': 'ff23b6d017',
  './chinchon/js/hash.js': '9bbf5d8385',
  './chinchon/js/ai.js': 'd69864fbc2',
  './chinchon/js/ui.js': 'e6c4e68852',
  './chinchon/js/mp.js': 'd5939c8d37',
  './chinchon/js/alert.js': '81226691f9',
  './chinchon/js/ch-ui.js': '9be86bf54a',
  './chinchon/js/strings.js': 'f20532e8b5',
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
  './escoba/css/escoba.css': 'd9cecbd6c8',
  './escoba/js/deck.js': '82f42af6d3',
  './escoba/js/cards.js': 'bff122678a',
  './escoba/js/game.js': 'd86364718a',
  './escoba/js/hash.js': '032dbfed1a',
  './escoba/js/ai.js': '66a7d1f37a',
  './escoba/js/ui.js': '8228059455',
  './escoba/js/mp.js': '8c6a63f54e',
  './escoba/js/mp-ui.js': '528aefa2f7',
  './escoba/js/alert.js': 'e82a10d729',
  './escoba/js/strings.js': 'f77944680f',
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
  './minesweeper/js/ui.js': 'a37654e78b',
  './minesweeper/js/engine.js': '764025ec21',
  './minesweeper/js/strings.js': '55517296e8',
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
  './spelling-bee/': 'ef847ee9c2',
  './spelling-bee/index.html': 'ef847ee9c2',
  './spelling-bee/css/spelling-bee.css': '3dd2b60bee',
  './spelling-bee/js/ui.js': 'a7935828a5',
  './spelling-bee/js/engine.js': '4fe494c0fd',
  './spelling-bee/js/strings.js': '749d844e99',
  './spelling-bee/js/board.js': 'cb1e14e8a9',
  './spelling-bee/data/bee.json': '1ac75a70d4',
  './spelling-bee/data/bee-es.json': '50e81e07c7',
  './murdoku/': '05fbbc038a',
  './murdoku/index.html': '05fbbc038a',
  './murdoku/css/murdoku.css': 'ec84773045',
  './murdoku/js/ui.js': '49446a4207',
  './murdoku/js/engine.js': '46518c0de8',
  './murdoku/js/strings.js': 'e744e28e32',
  './way-out/': '266cc82dc4',
  './way-out/index.html': '266cc82dc4',
  './way-out/css/way-out.css': '57ffd24975',
  './way-out/js/ui.js': '28caa7989d',
  './way-out/js/engine.js': 'a73ec75fbd',
  './way-out/js/strings.js': '0a72197767',
  './way-out/js/tricky.js': '0acb0a9350',
  './flick-soccer/': 'a15237aabc',
  './flick-soccer/index.html': 'a15237aabc',
  './flick-soccer/css/flick-soccer.css': 'b3b5c42958',
  './flick-soccer/js/ui.js': 'cacd0da86f',
  './flick-soccer/js/engine.js': '25217d5cb7',
  './flick-soccer/js/ai.js': 'c7ff2b0f5b',
  './flick-soccer/js/render.js': 'e9222e7e77',
  './flick-soccer/js/strings.js': '01e64e159f',
  './flick-soccer/js/mp.js': '31d0046b12',
  './flick-soccer/js/mp-ui.js': '0be9c195cc',
  './flick-soccer/js/alert.js': 'a8ca6b0b9e',
  './archery/js/engine.js': 'a7a170fc9d',
  './archery/js/mp.js': '2d04eae495',
  './eight-ball/': '91e30df217',
  './eight-ball/index.html': '91e30df217',
  './eight-ball/css/eight-ball.css': 'b1fe3b4efb',
  './eight-ball/js/ui.js': '37b262ab46',
  './eight-ball/js/engine.js': '79a8c4ab1f',
  './eight-ball/js/ai.js': '41a18ecd9b',
  './eight-ball/js/render.js': '517a0ff153',
  './eight-ball/js/strings.js': '3f0aa2edb9',
  './eight-ball/js/mp.js': '9da15467d8',
  './eight-ball/js/mp-ui.js': 'b79597954d',
  './eight-ball/js/alert.js': '24d28eb007',
  './battle-arena/js/engine.js': '8e390bbd63',
  './battle-arena/js/monsters.js': '00cecd68bc',
  './battle-arena/js/online.js': 'e715141fd7',
  './battle-arena/js/mp.js': '813b87356c',
  './darts/': '9565b5b35f',
  './darts/index.html': '9565b5b35f',
  './darts/css/darts.css': 'd4360f7631',
  './darts/js/ui.js': '3321bcc4d6',
  './darts/js/engine.js': '2d603f0ee2',
  './darts/js/render.js': 'd05671e727',
  './darts/js/flight.js': '60b3524662',
  './darts/js/strings.js': '844396d26a',
  './darts/js/mp.js': '81e6dd8ba9',
  './darts/js/mp-ui.js': 'aa1e3c1b56',
  './darts/js/alert.js': 'c8ce53e4a8',
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
  './air-hockey/': 'c4f7eb7ae7',
  './air-hockey/index.html': 'c4f7eb7ae7',
  './air-hockey/css/air-hockey.css': '4a9868313e',
  './air-hockey/js/ui.js': 'c58e7bfca7',
  './air-hockey/js/physics.js': 'a8e3192cef',
  './air-hockey/js/ai.js': '05aee99aee',
  './air-hockey/js/render.js': 'b056ca690e',
  './air-hockey/js/strings.js': '2f98208046',
  './air-hockey/js/live.js': '94988ac956',
  './air-hockey/js/net-test.js': '7037b18203',
  './air-hockey/net-test.html': 'c50ec11a90',
  './holdem/': '11f6e0e99f',
  './holdem/index.html': '11f6e0e99f',
  './holdem/css/holdem.css': '1f9fda9318',
  './holdem/js/ui.js': '31514ae2d7',
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
  './skeeball/js/ui.js': 'a2dc23cf10',
  './skeeball/js/swipe.js': 'c596f565de',
  './cup-pong/index.html': '698942a954',
  './cup-pong/css/cup-pong.css': 'd71937af33',
  './cup-pong/js/ui.js': '0daa0c79f4',
  './cup-pong/js/geom.js': 'b4007cdf47',
  './cup-pong/js/rack.js': 'e23be8d550',
  './cup-pong/js/physics.js': '108758b93f',
  './cup-pong/js/render.js': '905aee5064',
  './cup-pong/js/strings.js': 'cc6066dc26',
  './cup-pong/js/match.js': 'a7e6d50a1d',
  './cup-pong/js/mp.js': 'ff8d2917b2',
  './cup-pong/js/mp-ui.js': 'cf358d5147',
  './cup-pong/js/alert.js': 'd71546586b',
  './cup-pong/js/cpu.js': '03725812df',
  './hoops4/index.html': '533fd79845',
  './hoops4/css/hoops4.css': '38efeef410',
  './hoops4/js/ui.js': '677f1cd260',
  './hoops4/js/boarddef.js': 'd1214c250c',
  './hoops4/js/machine.js': '657e6330a1',
  './hoops4/js/physics.js': 'a5793407ee',
  './hoops4/js/render.js': '267329ba3c',
  './hoops4/js/game.js': '2e0010da15',
  './hoops4/js/cpu.js': 'f1b8a3e68b',
  './hoops4/js/mp.js': '8783f95060',
  './hoops4/js/mp-ui.js': '769eccbb9c',
  './hoops4/js/alert.js': '18ae0c4d78',
  './hoops4/js/strings.js': '8ffabf9682',
  './skeeball/js/game.js': '47f5932aaf',
  './skeeball/js/goals.js': '3289090081',
  './skeeball/js/challenge.js': '9fc771ac95',
  './skeeball/js/challenge-ui.js': 'c070feb545',
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
  './golf/js/ui.js': 'd9650d21e8',
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
  './golf/js/board.js': '4bdebaa52e',
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
  './uno/css/uno.css': '4a26c8d78b',
  './uno/js/ui.js': 'bcb6ff24f6',
  './uno/js/game.js': '6ffaaf31b2',
  './uno/js/ai.js': '8bc802a460',
  './uno/js/strings.js': 'f3abe15af1',
  './yahtzee/': '8a3981aec3',
  './yahtzee/index.html': '8a3981aec3',
  './yahtzee/css/yahtzee.css': 'c091c6a113',
  './yahtzee/js/howto.js': '6b8bb92ca6',
  './yahtzee/js/strings.js': 'ce61d552c4',
  './yahtzee/js/ui.js': '8db19a62e2',
  './yahtzee/js/hash.js': '14b905be65',
  './battleship/': 'e96682ec6b',
  './battleship/index.html': 'e96682ec6b',
  './battleship/css/battleship.css': 'bfd0572ee2',
  './battleship/js/ui.js': 'f42a99a053',
  './battleship/js/game.js': 'd60d57f119',
  './battleship/js/fleet.js': 'b2c03f8517',
  './battleship/js/ai.js': 'c31bd9837a',
  './battleship/js/hash.js': 'aed473aee9',
  './battleship/js/ship-art.js': '11ea9db668',
  './battleship/js/strings.js': '3652d8eeff',
  './battleship/js/mp.js': '86a1182dbd',
  './battleship/js/alert.js': '1703a8f589',
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

// Warm the non-shell tier. Best-effort by design, but never SILENTLY best-effort (THE LAW ru... [docs/SW-NOTES.md #12]
const WARM_CONCURRENCY = 6;
// ONE-TIME FORCED REFETCH (2026-09-01). The surgical counterpart to PURGE_ALL_CACHES below: ... [docs/SW-NOTES.md #13]
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
        // A LAZY asset is never fetched by the warm - it is downloaded by the fetch handler the [docs/SW-NOTES.md #14]
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
  // Record what this warm was built against, THEN retire every other cache. Order matters: the [docs/SW-NOTES.md #15]
  try { await cache.put(MANIFEST_KEY, new Response(JSON.stringify(REST_MANIFEST))); } catch { /* next deploy re-fetches */ }
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
}

// ONE GAME'S FILES, NOW (2026-10-14). A Game Hub message's Play button (js/hub.js openGameFr... [docs/SW-NOTES.md #16]
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

// ONE-TIME FULL PURGE (2026-08-04). Normally `activate` deletes only caches whose name DIFFE... [docs/SW-NOTES.md #17]
const PURGE_ALL_CACHES = false;

self.addEventListener('install', (event) => {
  // Only the shell blocks the install. The new build goes live as soon as the hub itself is sa... [docs/SW-NOTES.md #18]
  event.waitUntil(
    (async () => {
      if (PURGE_ALL_CACHES) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      const cache = await caches.open(CACHE);
      // ONLY THE CHANGED SHELL FILES ARE DOWNLOADED (2026-10-22). A shell file whose content hash [docs/SW-NOTES.md #19]
      const olds = [];
      for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('game-hub-')) olds.push(await caches.open(k));
      let stored = null;
      for (const c of olds) {
        try { const res = await c.match(MANIFEST_KEY); if (res) { stored = await res.json(); break; } } catch { /* absent */ }
      }
      const carry = [], fetchList = [];
      for (const p of SHELL) {
        if (stored && REST_MANIFEST[p] && stored[p] === REST_MANIFEST[p]) {
          let prev = null;
          for (const c of olds) { prev = await c.match(p, { ignoreSearch: true }); if (prev) break; }
          if (prev) { carry.push([p, prev]); continue; }
        }
        fetchList.push(p);
      }
      // Each body is read as it arrives: a response left unread holds its connection open, and
      // with ~60 at once the browser's per-host limit stalled the install for ever (found in a
      // real browser before this shipped). Held in memory (~1.6 MB at most) until all are in.
      const fetched = await Promise.all(fetchList.map(async (p) => {
        const res = await fetch(new Request(p, { cache: 'reload' }));
        if (!res || !res.ok) throw new Error(`[sw] shell install: ${p} answered ${res && res.status}`);
        const body = await res.blob();
        return [p, new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })];
      }));
      for (const [p, res] of carry.concat(fetched)) await cache.put(p, res);
      await self.skipWaiting();
    })()
  );
});

// The hub header's version pill asks the ACTIVE worker which build it runs. [docs/SW-NOTES.md #20]
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

// The held-back games switched live (LIVE_HELD), read once per worker life from the cache.
let _liveHeld = null;
function liveHeld() {
  if (!_liveHeld) {
    _liveHeld = (async () => {
      for (const name of [CACHE, ...(await caches.keys())]) {
        try {
          const res = await (await caches.open(name)).match(LIVE_KEY);
          if (res) return new Set(await res.json());
        } catch { /* unreadable: try the next */ }
      }
      return new Set();
    })().catch(() => new Set());
  }
  return _liveHeld;
}
const _heldRefreshedAt = new Map();
const HELD_REFRESH_MS = 2 * 60 * 1000;
async function noteLiveHeld(ids) {
  const want = [...new Set(ids.filter((id) => typeof id === 'string' && HELD_BACK[id]))].sort();
  _liveHeld = Promise.resolve(new Set(want));
  const cache = await caches.open(CACHE);
  await cache.put(LIVE_KEY, new Response(JSON.stringify(want)));
  // Refresh each live game's files as a SET, so a cached copy never mixes two builds for long.
  const queue = [];
  for (const id of want) {
    if (Date.now() - (_heldRefreshedAt.get(id) || 0) < HELD_REFRESH_MS) continue;
    _heldRefreshedAt.set(id, Date.now());
    queue.push(...HELD_BACK[id]);
  }
  const worker = async () => {
    for (let path; (path = queue.shift()) !== undefined;) {
      try {
        const res = await fetch(new Request(path, { cache: 'no-cache' }));
        if (res && res.ok) await cache.put(path, res);
      } catch { /* offline: the cached copy stays */ }
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ type: 'VERSION', cache: CACHE, important: IMPORTANT_SINCE });
  }
  if (event.data && event.data.type === 'LIVE_HELD' && Array.isArray(event.data.ids)) {
    event.waitUntil(noteLiveHeld(event.data.ids).catch((err) => console.warn('[sw] LIVE_HELD failed', err)));
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

// --- PUSH NOTIFICATIONS (2026-09-23) ------------------------------------------------------... [docs/SW-NOTES.md #21]
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
  // WHICH MATCH (2026-09-24). Matt: "when i click on the connect 4 hoops notification, it take... [docs/SW-NOTES.md #22]
  const tag = String(event.notification.tag || '');
  // Cup Pong's payload names its match outright (`match`, 2026-09-28) and tags it `cuppong-<id>`.
  // Every challenge game's tag is `<node>-<matchId>` (2026-10-14: Darts, Flick Soccer and the rest
  // too, as a fallback should a payload ever arrive without `match`).
  const tagged = /^(?:hoops|cuppong|darts|flicksoccer|archery|chinchon|escoba|skee)-([A-Za-z0-9_-]{4,40})$/.exec(tag);
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

// APP ICON BADGE (2026-10-14). Matt: "Can we get badge notifications on the app icon when th... [docs/SW-NOTES.md #23]
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
  // Old caches are NOT deleted here any more (2026-08-23). They are warmRest()'s copy source f... [docs/SW-NOTES.md #24]
  event.waitUntil(
    self.clients.claim()
      // Warm the heavy tier only once the worker is claimed and serving. Deliberately NOT awaited [docs/SW-NOTES.md #25]
      .then(() => { queueWarm(); })
  );
});

// Immutable static assets (images, fonts) — served cache-first so re-created [docs/SW-NOTES.md #26]
const STATIC_RE = /\.(webp|png|jpe?g|gif|svg|woff2?|ttf)$/i;

// The REST tier's own paths, for the cache-first branch below. [docs/SW-NOTES.md #27]
// Held-back file pathname -> its hub id (the LIVE_HELD check in the fetch handler).
const HELD_PATH_OWNER = new Map([...HELD_BACK_OWNER].map(([p, id]) => [new URL(p, self.location.href).pathname, id]));
const DEV_FRESH_PATHS = new Set([...HELD_BACK_OWNER.keys()].map((p) => new URL(p, self.location.href).pathname));
const CACHE_FIRST_PATHS = new Set(
  [...REST, ...SHELL_CACHE_FIRST]
    .filter((p) => !HELD_BACK_OWNER.has(p))
    .map((p) => new URL(p, self.location.href).pathname));
// A NEW FILE IN AN UNRELEASED GAME NEEDS NO ASSETS ENTRY (2026-10-22): adding one to ASSETS ... [docs/SW-NOTES.md #28]
const HELD_DIRS = [...new Set([...HELD_BACK_OWNER.keys()].map((p) => p.replace(/^\.\//, '').split('/')[0]))]
  .map((d) => new URL(`./${d}/`, self.location.href).pathname);
const isDevFresh = (path) => DEV_FRESH_PATHS.has(path)
  || (!CACHE_FIRST_PATHS.has(path) && HELD_DIRS.some((d) => path.startsWith(d)));

// How long a code/markup request waits on the network before the cached copy is served instead.
// Long enough that a merely-average connection still wins the race (and the player keeps getting
// the freshest build), short enough that a bad one never makes the hub feel broken.
const NET_TIMEOUT_MS = 2500;
const TIMED_OUT = Symbol('timed-out');
function deadline(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), ms));
}

// "The network is bad right now" latch. [docs/SW-NOTES.md #29]
const SLOW_LATCH_MS = 10000;
let _slowUntil = 0;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // THE HOLE EDITOR IS NOT PART OF THE APP (2026-09-23). It lives under this worker's scope, s... [docs/SW-NOTES.md #30]
  if (sameOrigin && (url.pathname.includes('/hole-editor/') || (req.referrer && new URL(req.referrer).pathname.includes('/hole-editor/')))) return;

  // Cache-first for immutable same-origin assets: images and fonts (which are versioned by the [docs/SW-NOTES.md #31]
  if (sameOrigin && req.mode !== 'navigate' && !isDevFresh(url.pathname)
      && (STATIC_RE.test(url.pathname) || CACHE_FIRST_PATHS.has(url.pathname))) {
    event.respondWith((async () => {
      const cur = await caches.open(CACHE);
      const cached = (await cur.match(req, { ignoreSearch: true }))
        || (await caches.match(req, { ignoreSearch: true }));
      if (cached) return cached;
      try {
        // `cache: 'reload'` is LOAD-BEARING, for the same reason it is on the network-first path [docs/SW-NOTES.md #32]
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
    // Network-first WITH A DEADLINE, falling back to the cached copy. [docs/SW-NOTES.md #33]
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

    // A held-back game switched live: the cached copy at once; `net` refreshes it behind.
    const heldOwner = cached && sameOrigin ? HELD_PATH_OWNER.get(url.pathname) : null;
    if (heldOwner && (await liveHeld()).has(heldOwner)) return cached;

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
      // A 404/503 IS NOT AN ANSWER when we are holding a good copy (2026-08-11). [docs/SW-NOTES.md #34]
      if (!res || !res.ok) return cached;
      return res;
    } catch {
      return cached;   // offline, or the request failed outright
    }
  })());
});
