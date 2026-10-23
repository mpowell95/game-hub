# Cup Pong — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

A clone of GamePigeon's Cup Pong, as an in-hub module (three.js + cannon-es). The spec is
**`docs/CUP-PONG-BRIEF.md`**: read it before changing anything here.

## Where it stands (2026-09-28, last full status)

All five stages are built: 1 table + throw (done), 2 rules/settings/Gentleman's/vs CPU/rebuttal/stats,
3 rerack (presets + "Make your own"), 4 bounce shots (**built then turned OFF by Matt**, below), 5
challenges + push (**rules branch `cuppong` PUBLISHED and `cupPongTurnPush` DEPLOYED by Matt,
2026-09-28; notifications confirmed 2026-10-05**), plus **Solo** (fewest throws to clear the rack).
Hub: `devOnly` and **no `released` date** (Matt releases it from the admin page; that day gets the
date). Folder `cup-pong/`, hub id and stats id `cuppong`.

### The GamePigeon rules, CONFIRMED by Matt 2026-09-27

10 cups a side in a 4-3-2-1 triangle pointing at the shooter; 2 throws a turn; a made cup vanishes
at once; both throws made = balls back (2 more, repeats); cups on 2 turns running = heating up, 3rd =
on fire (shoot until you miss); win = clear the opponent's cups; real ball physics (rims, rolling,
bouncing).

## Stage 2: a match against the computer (2026-09-28)

Setup (hub skin, `css/ui.css`): Play the computer (Easy/Medium/Hard with `js/difficulty-tiers.js`
shapes), Gentleman's On/Off, **Reracks** (0/1/2/3/unlimited, default 2), **Play**, **Solo**.
**`js/match.js` decides everything**, as events (`made`, `miss`, `ballsBack`, `heatingUp`, `onFire`,
`cooled`, `removed`, `rackCleared`, `rebuttal`, `overtime`, `gentlemans`, `rerack`, `islandCalled`,
`islandPick`, `picked`, `turnOver`, `win`); the screen only announces them.

### The rules as Matt set them (2026-09-28; `node cup-pong/js/test.js` checks each)

- **Heating up / on fire are PER BALL**: the first ball's 2 in a row = heating up, 3 = on fire (that
  ball comes straight back after every make; a miss cools it and passes to the other ball). **Every
  throw of that ball counts, balls-back throws included.** Ball 1 in, 2 out, next turn 1 out, 2 in is
  NOT heating up. Amber at 2, flame orange from 3 (`setBallHeat`).
- **Balls back** repeats. **A fire run keeps balls back** (2026-09-30): the miss that ends a fire run
  does not undo that ball's make in the pair. Frozen per challenge as `rules.fb`
  (`Match({ fireBallsBack })`). **A bonus throw** (`{ k: 'x' }` log entry, `match.grantExtra()`): a
  SIDE (`by`) entry anywhere in the log (`applyEntry` handles it before turn checks), waits in
  `match.bonus[side]`, thrown first as ball 2 at that side's next normal turn (no streak, never
  counts toward balls back, no island call). No screen offers it (written by hand into one match, on
  Matt's request, after a backup); the other phone applies it SILENTLY.
- **The last cup stays on the table while a ball is left to throw at it** (`lastCup`; "Last cup!
  Same cup wins"): both balls in it wins with NO rebuttal. **Balls back count as balls left**
  (2026-09-29); frozen per challenge as `rules.lc` (`Match({ lastCupBack })`), so a finished match is
  never re-scored.
- **The rebuttal**: 2 shots, each ball shooting until it misses. Clear everything = overtime; both
  missed = the side that cleared wins.
- **Overtime**: 3 cups a side, 2-1 triangle on the BACK rows (`OVERTIME_CELLS`), streaks reset, the
  side that cleared first shoots first, rebuttal applies again. **No reracks or Gentleman's in OT.**

### Gentleman's, Rerack and Island are BUTTONS (2026-09-28)

Pill buttons stacked on the LEFT edge (`.cp-opts`), each shown only while on offer, gone after the
turn's first throw:

- **Gentleman's**: the rack shot at is down to 2 cups not in a line, setting On, not overtime. Free.
  **Also in a REBUTTAL any time a ball is in hand.**
- **Rerack (n)**: before the first throw, once a turn, not in rebuttal/overtime, while reracks remain.
  Sheet of presets (`rack.js RERACKS`); **Make your own** is the last tile. A full rack of 10 cannot
  be reracked (`canRerack`).
- **Island**: a cup touching no other cup; **calling spends it, hit or miss**; hit = defender owes a
  second cup (CPU picks its loneliest). **A call is for ONE ball**; **EACH BALL IS ITS OWN PLAYER**:
  `islandUsed[side]` is `[ball1, ball2]` (two calls a game; an old save's single flag reads as both
  used). Allowed in overtime, not in a rebuttal. **ONLY THE CALLED CUP COUNTS** (2026-10-06): a called
  ball in any other cup is a MISS (`wrongCup`, "Not the island, no cup"), behind `islandOnly`
  (default on), challenges carry `rules.io`.
- **Make your own** (`showCustomRack` in `ui.js`): all 28 `AREA` cells on a hex grid; drag or tap a
  cup then a spot; snaps to the nearest free cell; **Done** (`match.rerackCustom(cells)`, which
  re-checks `isCell` + `validRack`, keeps ids). Challenge log: `{k:'r', key:'custom', cells:[{c,r}...]}`.
  The computer uses presets only.
- **Every rerack stands AGAINST THE BACK WALL** (2026-09-29): preset back row on the rack's back row
  (`shape(rows, back)`, `backLine`); custom needs at least one cup on the back row
  (`rerackCustom` refuses otherwise); Gentleman's line keeps its own placement. `rules.bk` (written on
  every new challenge) turns it on; older challenges replay the 2026-09-28 placement. `Match({
  backRack })`, `presetsFor(n, back)`.
- **Center** (Matt, 2026-10-23, "Why can't I center this?"): one cup left off-centre = a FREE Center button (no rerack spent, same distance, `canCenter`/`centerLast`, log `{k:'c'}`), when a Gentleman's would be on offer; not overtime or Straight up. The computer takes it too.
- **The computer**: takes Gentleman's whenever offered, reracks when a preset has >=2 more touching
  pairs, calls the first island and aims at it (`cpuOptions`, `cpuIsland`, `cpuPick`).

**Two ends of the table**: your turn uses the fitted camera; the computer's turn glides behind your
RED cups. Every rack and throw is kept in the SHOOTER'S frame; `render.js toWorld` turns side `a`
half round. Physics never knows whose throw it is. A greyed spare ball sits at the left edge.

**The computer** (`js/cpu.js`) aims with the same launch point, angle, gravity and drag as
`physics.js`, then adds Gaussian error (`SKILL`): Easy sPower 0.30/sAim 0.080 (~13% make), Medium
0.15/0.040 (~20%), Hard 0.06/0.025 (~37%); Easy/Medium pick a cup at random, Hard the cup with most
neighbours. The sigmas are the only knob; whether Easy loses to a new player is Matt's to say.

## Bounce shots (2026-09-28, brief 5d): OFF

(full story: CLAUDE-HISTORY.md)

**TURNED OFF by Matt, 2026-09-28** ("in real life you can hit a bounced ball away... We won't be able
to do that in turn based multiplayer"): **a bounced make is one cup, computer included.** The rule
stays in `match.js` behind `bounce` (default **false**), on only for a challenge stored with
`rules.bo: true` (made while it was live, v1012); `createGame` no longer writes `bo`. **Do not turn it
back on without Matt.** While on: a table-bounced make counted 2 cups (the defender picks the extra;
an island by bounce = 3), owed in challenges like island, never in a rebuttal or on the last cup.
`bounced` comes from the physics (`tableHits > 0`). `test.js` asserts bounce-ins stay POSSIBLE (>=2%
of the soft-throw sweep).

## Series and Straight up (challenges, 2026-09-30)

- Challenge screen (`mp-ui.js terms`): Series (1 / Best of 3 / Best of 5) and Rules (Classic /
  Straight up).
- **Straight up** = `rules.su` / `Match({ straight: true })`: 10 cups, two balls a turn, made cup
  gone, first side to clear wins on the spot; no Gentleman's, reracks, balls back, heating/fire,
  island, bounce, last-cup rule, rebuttal or overtime. **"No rebuttal" is a reading of "whoever can
  get them all first", not Matt's words: confirm with him if it comes up.** A banner sweeps across on
  every open (`sweepBanner`), the words are painted on the felt (`render.setTableText`, one upright
  copy only), and the Your turn row says "Straight up". Launcher bubble and push do not say it yet.
- **A series is Hoops' model** (`hoops4/CLAUDE.md`, "A series, and the terms of a challenge"): each
  game its own match linked by `seriesOf`; `series`, `seriesNo`, `seriesWins` (by SIDE) OPTIONAL;
  `seriesAfter` pure; index rows carry `series`, `seriesNo`, `seriesOf`, `su`.
- **The next game is a BUTTON only for whoever LOST** (`seriesStarter`), so phones never both create
  it; `nextInSeries` swaps the sides AND the score; whoever did not shoot first last game shoots
  first (`createGame({ first: 'them' })` writes both rows at once).

## Solo: clear the rack in the fewest throws (2026-09-28)

- **It REPLACED Practice**: one ball a throw, no balls back, no heating, no reracks, no islands, no
  opponent. **Only a CLEARED rack is recorded**, once, by `recordCupPongSolo(throws)`; giving up
  records nothing, so `isInProgress()` is `true` while a solo rack has had a throw and has cups left.
- **Stored in the `cp` sub-counter** of `games.cuppong`: `{ soloRacks, soloThrows, soloBest }`;
  `soloBest` is a FEWEST with **0 = never cleared** (a real clear is >= 10). The three-edit rule:
  `ensureCp`/`recordCupPongSolo` (game-stats.js), `cupPongScreen` (My Stats), the `cuppong` branch in
  `js/players-agg.js` (min of NON-ZERO bests only; `tools/players-agg.test.mjs` pins it). A solo clear is
  not a win over anyone.
- **Leaderboard**: first sort **Fewest throws** (`'fewest'` in `js/leaderboard-ui.js`), so the board
  OPENS on it; equal bests share a rank; no tier chip/difficulty filter. Wins / Games / Name list
  match players as before.

## The setup screen (2026-09-28, second layout)

Hoops' layout: **Your turn** card (only when a match waits), **Multiplayer**, **Play the computer**
(difficulty, Gentleman's, Reracks, Play), **Solo** (best on the right). Must fit 390x664
(`tools/check-no-scroll.mjs cup-pong`); Your turn can scroll inside itself, contained.

## Challenges: turn by turn, by player code (2026-09-28)

(full story: CLAUDE-HISTORY.md)

Files: `js/mp.js` (data), `js/mp-ui.js` (screens), `js/alert.js` (launcher), the match in `js/ui.js`
(`mpBegin`, methods under "CHALLENGES").

- **Node** `cuppong/games/<id>` + `cuppong/index/<CODE>/<id>`. The challenger is side `'a'` and shoots
  first; the challenge is DELIVERED when the challenger's first turn ends (Hoops' 2026-09-23 lesson).
- **A match is a LOG, never a snapshot.** Entries: throw `{k:'t', p, a, m, b}` (launch vector AND the
  recorded cup, `''` for a miss, bounced), `{k:'g'}`, `{k:'r', key}` (+ `cells` if custom), island
  `{k:'i', id}`, owed cup given up `{k:'o', id}`. `validateGame` REPLAYS the log through `match.js`
  and refuses the whole document if any entry does not replay or the stored result is not what the
  log produced (a resignation excepted).
- **Written one action at a time** (`appendLog`, idempotent on retry; a log that moved on differently
  is a conflict, never overwritten). Unsent throws live in `gamehub.cuppong.outbox.v1`. Index rows
  change only when the turn passes or the match ends (what the push function watches).
- **Where a send goes in the log (fixed 2026-10-02)**: `mpFlush` uses `applied - pending.length`;
  `appendLog` steps past the OTHER side's entries after `base` (the full replay still has to accept);
  `drainOutbox` keeps refused throws (only an over match drops them); the waiting line says "Not sent
  yet" while any are unsent.
- **Replay**: the other person's latest run plays with real flights from their vectors; **the
  recorded outcome decides each one**. Progress in `gamehub.cuppong.shown.v1`.
- **This phone is always side `'a'` locally** (`buildLocal`, `toLocal`/`toStored`).
- **The island's second cup is OWED** (`async: true` counts `owed[side]`; taken at the defender's
  next turn, `askOwed`); owed cups that are every cup left clear the rack at once.
- **Rules are frozen per challenge** (`rules.fb`, `lc`, `io`, `bk`, `bo`, `su`, `lapse`); an older
  challenge replays as it was played.
- **Results**: `recordResult('cuppong', 'mp', won)` once per phone (`gamehub.cuppong.counted.v1`); a
  match ended while away shows a GAME OVER popup (`gamehub.cuppong.unseenResults.v1`) and the 'over'
  bubble. **Quit** is a resignation (asks first, counts as a loss, deletes nothing).
- **Cancel, decline, expire (2026-10-13)**, root `CLAUDE.md` "Cancel, decline, resign, expire": until
  the receiver's first throw, Quit reads **Cancel challenge** / **Decline challenge** and calls game 1
  off for nobody (`cancelGame`; `resignGame` does the same on an open match). A challenge made from
  2026-10-13 (`lapse: true`) **expires 3 days after delivery**; a called-off game 1 owes no game 2.
- **Launcher**: `js/hub.js` declares `alerts: () => import('../cup-pong/js/alert.js')` (`armOpen`/
  `takeOpen`, sessionStorage `gamehub.cuppong.open.v1`). **Push**: `cupPongTurnPush` on
  `cuppong/index/{code}/{id}` (`decideCupPong`, from the row alone; never your own write via
  `lastBy`); payload carries `match`; `sw.js` also reads a `cuppong-<id>` tag.
- Tested by `node tools/test-cuppong-mp.mjs` (49 checks incl. a straight-up game and a series). Real phones
  on real Firebase have been played on by Matt and family.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../cup-pong/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `cuppong`, no `released` date |
| Stats id | `cuppong`: `recordResult('cuppong', difficulty, won)` once per finished match vs the computer (`easy`/`medium`/`hard`; `mp` is for challenges); solo via `recordCupPongSolo` into `cp`. Registered in `js/game-stats.js` `GAMES`, `js/leaderboard-ui.js` `GAME_META` (on the board even while admin-only; `OFF_THE_BOARD` stays empty), `js/game-stats-ui.js` `TABS`, label `game_title_cuppong` |
| CSS | `.cp-root` / `.cp-` |
| Settings key | `gamehub.cuppong.v1`: `{ diff, gentlemans, nextFirst }` (preferences; `nextFirst` alternates) |
| `isInProgress()` | NO MID-GAME RESUME meaning: `true` while a match vs the computer / a solo rack has had a throw and is not over; a challenge answers `false` (lives in Firebase) |
| Tile art | `GAME_ART.cuppong` |

## Files

`js/geom.js` every size in metres, camera (pure) · `js/rack.js` the rack model (pure) ·
`js/physics.js` cannon-es ball (`skeeball/js/vendor/`, not copied; DOM-free) · `js/render.js`
three.js scene · `js/ui.js` shell, flick, loop, module contract · `js/strings.js` EN/ES ·
`js/match.js` rules (pure, events) · `js/cpu.js` the computer (pure) · `js/mp.js` challenges data ·
`js/mp-ui.js` MP screens · `js/alert.js` launcher bubble · `js/test.js` (~50 checks, ~25 s, dev only,
not in `sw.js`) · `css/cup-pong.css` every rule under `.cp-root`.

## The rack is a set of hex cells

`js/rack.js`: a rack is `[{ id, c, r }]`, **doubled-width hex coordinates** (`r` row, 0 = furthest;
`c` counts half cup-widths; a cell is real only when `c + r` is odd). Pitch = one cup across (+2 mm).
A cup keeps its id (`k0`..`k9`) for the whole game. **A cup may instead sit at an exact SPOT `{ id,
u, v }`** (cup-widths) for the straight Gentleman's / Line presets (`line2`, `line3`, `line4`), which
cannot live on a hex grid; `validRack` checks overlap and area in METRES. `AREA` is |c| <= 5, r 0..4;
the triangle is `PRESETS.tri10`.

## The throw (fitted to the recordings, 2026-09-27/28)

- The ball waits ON THE TABLE at mid-court (z = 0). **The flick is skeeball's** (`skeeball/js/swipe.js`,
  imported, never copied; `SWIPE_SLOW` 0.65 -> power 0, `SWIPE_FAST` 4.20 -> power 1; power NOT clamped).
- Power -> `THROW.minSpeed`/`maxSpeed` (1.87 / 3.64 m/s) as energy, fixed 1.00 rad, **`GRAVITY` 6.5,
  not 9.81, on purpose: do not "correct" it** (no real-gravity arc matched path and timing). The arc
  was fitted to 11 frames with the constraint that the ball is AT THE RACK when the recording shows it
  (without it the fit cheats). The rack spans roughly power 0.35-0.65.
- **AIM FOLLOWS THE FINGER** (`aimFromSwipe`): the flick direction is carried to the rack's row on
  screen, unprojected, heading = line from the ball to it. No aim knob.
- If it feels wrong, in order: `minSpeed`/`maxSpeed`, then `elev` and `GRAVITY` together, re-fitting
  to the recording. The "Power / Aim" line bottom right can be removed once settled. The harness
  CANNOT measure power (SwiftShader delays synthetic touches); only a real hand can judge.

## The physics

- Each cup is ONE static body: 20 wall boxes round a cone (9.5 cm top, 6 cm base, 12 cm tall), 40
  rim spheres, a base. Ball 40 mm, 2.7 g. **Made = all of the ball below the rim plane, inside the
  wall** (decided, never predicted).
- **1/480 s step, not skeeball's 1/240** (a fast ball tunnels a 6 mm wall at 1/240). Quadratic air
  drag (`DRAG_K`) and table rolling resistance (`ROLL_DECEL`; without it a miss ran to the 6 s cap).
- A throw ends `made` (with `bounced`), `off`, or `miss`. **No magnetism, ever.**
- **The table's bounce** (`MAT`, physics.js; full story and the sweep tables: CLAUDE-HISTORY.md): `tableRest` 0.95 on the first bounce, `tableRestLater`
  0.68 on later ones (a 0.95 table dribbled to the cap), `tableSkid` 0.6 (share of forward speed kept
  through each table bounce). Matt wanted a bounced ball to go in about as often as a regular throw;
  counting every touch with random racks, bounced 24.7% vs regular 29.1%. **The response is not
  monotonic and a regular grid of throws ALIASES: never interpolate, re-measure with random throws at
  random 1-10 cup racks, seeded mulberry32. Never use `(seed * 1103515245 + 12345) & 0x7fffffff` in
  JS** (the multiply passes 2^53). `test.js`: regular makes under 25% of the sweep, everything under
  30%, bounce-ins >= 2%. Table grip (`tableFric`) does nothing in cannon-es.

## The look and the camera (fitted, 2026-09-27)

`CAMERA` in `geom.js` is FITTED to a GamePigeon frame, not designed: 1.305 m above the table over z =
0.803, pitched 44 degrees, 41.8 degree vertical field on a 1:2 screen; `resize()` keeps that WIDTH on a
taller phone and that HEIGHT on anything wider. Table 0.72 m wide (the clone's proportions). Green
matte felt (a specular one washed to grey), white border and a lengthwise centre line only; opponent
cups BLUE (`LOOK.cups.blue`), yours red; cup insides SHADED (`_insideTex`, not flat white); a made cup
lifts out up-right, fading. No word pops up for a make or miss. Headless Chromium is SwiftShader, so
`render.js` turns shadows off there; **`window.__cpHardGL = true`** forces the real renderer for a
screenshot probe (the game never sets it).

## Tests

- `node cup-pong/js/test.js`; `node tools/test-cuppong-mp.mjs`; `node tools/test-game-conventions.mjs`;
  `node tools/check-no-scroll.mjs cup-pong`.

## The Tuesday question (retired 2026-10-19)

Removed at Matt's request; story in `CLAUDE-HISTORY.md`.

## Quick chat (2026-10-14)

A chat button on every challenge match (`mpMountChat` in `js/ui.js`, torn down in `teardownEngine`;
never solo or vs the computer): `js/match-chat-ui.js` + `js/match-chat.js`, lazy-imported. It sits
directly UNDER the Menu button (`CHAT_PLACE`, `right: 12px`, `top` = menu top + 52px) because the HUD's
second line runs wide; it lands on the far wall, never the flick pad. Node `cuppong/chat/<matchId>/
<key>` (sibling of `games/<id>`, so `watchGame`/`validateGame` never see chat); sends with the STORED
side (`mp.side`), never the local-frame `'a'`.
