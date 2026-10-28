# Connect 4 Hoops — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them. **Nothing in this folder stores anything
> earned**: `gamehub.hoops4.v1` holds one preference (the opponent) and nothing else, and the
> match itself is not persisted at all. Results go through the shared `recordResult('hoops4', …)`
> like every other game.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Matt's idea, 2026-09-21, from photos of the real Bay Tek **CONNECT 4 HOOPS** cabinet: seven
basketball hoops in a row over a 7 x 6 Connect 4 board. Sink a hoop and your disc drops down that
column. Four in a row wins. State: built, **admin only (`devOnly`)**, turn-by-turn multiplayer live
since 2026-09-22 (rules PUBLISHED by Matt 2026-09-22). Open items: "Still open" at the foot.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../hoops4/js/ui.js'`, `immersive: true`, released 2026-10-26, hub id `hoops4` |
| Stats id | `hoops4` — plain `recordResult(id, difficulty, won)`, **no sub-counter** (item 7's three-edit rule does not apply) |
| CSS root / prefix | `.h4-root` / `.h4-` |
| Settings key | `gamehub.hoops4.v1` (two preferences: the opponent, and `shots`: `'until'` \| `'one'`) |
| Multiplayer | LIVE via `js/net.js` (`rooms/<CODE>`); TURN BY TURN via `hoops4/js/mp.js` (`hoops/games/<id>`, a NEW top-level node) |
| Other keys (all conveniences, never history) | `gamehub.hoops4.outbox.v1` (moves waiting on a signal), `.shown.v1` (moves replayed per match), `.cerShown.v1` (card shown once per match), `.chatSeen.v1` (newest 60 matches), `.unshot.v1`, `.counted.v1` (result ledger), `.unseenResults.v1`, `.pushAsk.v1`, `.cpuOpen.v1` |
| Difficulty axis | CPU skill `easy`/`medium`/`hard`, plus `'mp'` for a multiplayer match (unmapped in `js/difficulty-tiers.js`, so `tierOf('mp')` is null). A two-players-on-one-phone match records nothing |
| `isInProgress()` | the **no mid-game resume** meaning; true while a match has a disc and is not over; false for `mp.kind === 'async'` (nothing can be lost; entering a challenge toasts that the match is saved) |

- **Released 2026-10-26** in code (`released: '2026-09-22'`, the admin switch day).
- It **has** a `GAME_META` row in `js/leaderboard-ui.js` even while admin-only (`OFF_THE_BOARD` in
  `tools/players-agg.test.mjs` is empty and must stay empty); `isGameOnLauncher` hides it from the board.
- **Difficulties are `Easy / Medium / Hard`** (the hub's words). Never invent new terminology.

## The three things it does NOT own

- The Connect 4 rules (`js/game.js` imports `connect-four/js/board.js`), the solver (`js/cpu.js`
  imports `connect-four/js/ai.js`), and three.js / cannon-es (from `skeeball/js/vendor/`).

## The engine is a COPY of skeeball's BRICK CITY, and that is the rule, not a shortcut

`js/machine.js`, `js/physics.js`, `js/render.js` are this game's own files and have diverged.
**Editing them cannot affect any skeeball machine, and a skeeball change does not reach here**
(`skeeball/CLAUDE.md`'s "every machine owns its own engine" hard rule). If you fix something
genuinely universal, say in the commit which copies you applied it to and which you did not.

## The cabinet, and why every number is what it is

`js/boarddef.js`. **Every value that differs from HOT SHOT was measured.** Tools (all answer to a
change here): `reference/hoops/sweep-speed.mjs` (launch band: `--scan`, `--band=min,max`);
`hoops4/js/test.js` (Matt's four requirements, headless, ~2 min); `reference/hoops/check-display.mjs`
(the machine as the PLAYER sees it, real browser: whole display on screen, nothing occluding incl.
panel corners and bottom-row end cells since a cell CENTRE is not a cell, column N under hoop N, a
real swipe reaches all seven; swipe result unstable run to run, 3/7-5/7, one red run is not a
regression); `probe-bounce.mjs` (does a miss bounce, WHICH WAY, which surfaces it touches; `--set k=v`);
`probe-aim.mjs` (how often a perfect aim lands in its column); `probe-rim.mjs` (where an arriving shot
ends up; capture/through timings). **A coarse grid lies: use 231+ throws (21 x 61 for decisions).**
`sweep-hoops-columns.mjs` is a kept feasibility record only.

- **Shape (settled after two wrong builds):** ONE step, display VERTICAL and BELOW the hoops, now
  square (`PANEL_L` 7.80X, `boardLipY` 0.39). Hoop shelf 4.0X tilt 0.10, hoops **0.75X from its BACK
  edge** (shelf DEEP, row at the BACK). **No apron in front of the display** (a parking spot). The
  board stands ABOVE the ramp crest with a 0.70 m gap in front (else the ramp hides the bottom row).
- **Camera** stands back (3.00 m back, 1.00 m up); the frame is capped by the cabinet's WIDTH (22.6%
  ceiling), so probes measure share of frame WIDTH, never "a quarter of the frame tall".
- **Width is set by the COLLARS** (MACHINE-SPEC 12: |u| + collar radius + 0.78X wall gap = 10.443X);
  holes stay pitch 1.30X, outer pair +/-3.90X.
- **Speed band** answers to the cabinet's DEPTH: now **6.35/6.80** (re-derived when the board went
  square). A band with dead low powers is a spec failure.
- **Rail chamfers** stay (square corners parked 29%); tilt 0.10 / friction 0.12 is best (steeper parks
  MORE). `test.js` asserts MEDIAN TIME TO RESOLVE A SHOT (3.0 s), not a watchdog rate. A parked ball
  resolves as an honest miss 0.6 s after it stops.
- **Fins** (45-degree-capped, narrower than the gap, never overhanging a rim, `inset`) are the only
  thing stopping a ball balancing across two rims. **A mouth's width is Matt's number; nothing may
  narrow one.** `RIM` is never changed without him.
- **Hoop rotation IS the tilt**, no offset (once drawn 90 degrees wrong). A hoop is HOT SHOT's
  `_wireBasket` PORTED, not adapted: orange rim + bottom ring + ribs, white net in THREE bands
  (`collarH > R * 0.9`), `_hoopBackboards()` (one InstancedMesh, cream arch with white box, bottomed at
  the rim), fins in the riser's blue. Judge looks at PLAY SIZE on a phone screenshot.
- **Marquee** is a lit sign from `boarddef.js`'s `look` block (own drawing code, nothing from skeeball):
  HOOPS big in bulb yellow (letter-spaced to CONNECT 4's width, `signWord`'s `trackTo`), small stacked
  "CONNECT / 4" tag, icons `ph * 0.30`, `mqH` **0.20**; **`MQH` is DERIVED from `mqH`**
  (`MQW * (mqH / (bw * 1.02))`). **The flare's top is pinned to the lip** (`flareTop = lipY - 0.002`).
- **Ball:** basketball wrap (`_basketballTex`) in the player's board colour, `MeshBasicMaterial`
  (UNLIT like the screen; texture also the emissive map), set per SHOT in `shoot()` (`setBallColor`).
  It stops being drawn at `through` (the falling disc IS the ball).
- **Disc** falls on the same `CanvasTexture` (`render.js` `startDrop`/`stepDrop`/`_dropY`, `setGrid`
  third arg), driven by the game's loop (no private rAF), target cell drawn EMPTY meanwhile and the
  win ring suppressed, clipped to its column's holes (falls BEHIND the face). `resolve()` defers
  `finish()`/`maybeCpu()` through `_whenLanded`; `start()` clears `_dropping`/`_afterDrop`.
  **The drop starts on `through`** (ball wholly below the rim, inside the mouth, moving down; sets
  `st.committed`), NOT `capture` (up to 1.9 ballR above the rim) nor `resolve()`. Predicted cell via
  `_dropOnCapture`/`_predicted`, never authoritative (`_paintShot` commits or cancels). `test.js` pins:
  through always scores in that column; every scored ball passes through; through -> resolved median
  under 0.2 s; ui.js never starts the drop on capture. "100% of the time" lives at `through`.

### "NOT VERY BOUNCY" WAS NEVER THE RIM (2026-09-22)

A lively rim over a dead floor feels dead. Shelf (0.58) and display panel (0.70, its OWN contact
material) have real restitution; fins and chamfers bounce like the rims; the trough and side rails
stay dead on purpose (a live rail makes outer columns catch-alls). `test.js` measures what fraction of
misses bounce and how hard (bars: >= 50%, mean best rebound >= 0.50 m/s); the old "rattled without
scoring" metric could never move, and a number that cannot move is worse than none.

### The bounce goes SIDEWAYS, not forwards (2026-09-22)

Matt: *"I want the bounce to add some randomness, not make the game measurably more difficult."*
- **`bounceSideways: 1.0`** (`boarddef.js`, `physics.js` section 0a): a forward-moving bounce off the
  shelf or hoop furniture has its horizontal velocity ROTATED onto the u axis (speed `hypot(vx,vz)`
  identical, vertical untouched, no energy added). **It is not magnetism** (MACHINE-SPEC 9): it never
  reads `G.holes`; direction is the sign of the drift the ball already had. `test.js` asserts
  structurally that it reads no hole position. Forward only.
- **`ringRest` 0.55** (was 0.72). The shelf's 0.10 forward tilt is load-bearing (flattening it doubles
  parking 6.1% -> 11.7%); front-edge departures are the tilt, not the bounce.
- `test.js` section 1b: lateral:forward ratio >= 2.0, redirect on, reads no hole position.

### THE SCORING RATE: every lever measured, and Matt's call (2026-09-22)

The ~28% number is the GRID's floor, not a player's (a scripted thumb landed 19 of 28). **MATT'S CALL,
ASKED AND ANSWERED: leave the hoops alone. This question is CLOSED.** A future session must not widen
the mouth, deaden the rim, or retune the band to chase a scoring number. Re-open only if he does.
Findings: only widening the mouth (x1.10) raised scoring without cost; levers do not stack;
`boardRest`, `deadRest` and the jitter pair move scoring by zero (lowering them is pure cost); a small
delta on a 21-aim-step grid is quantisation noise.

### Square, and what it cost (2026-09-22)

Matt: *"It should be a square. Not a short rectangle."* `PANEL_L` 4.80 -> 7.80X, `boardLipY` 0.52 ->
0.39, band re-derived (scored 29.2%, parked 2.44%, 7 of 7 columns reachable). **The cost is bounce,
a KNOWN GAP**: `test.js` has a `KNOWN_GAPS` map (two bounce bars deliberately red; a gap that starts
passing FAILS the run and says to delete the entry; never lower the bars). `deadRest` 0.50 (saturates).

### Matt's four requirements

Bouncier rims; "a little bit of unpredictability" (SEEDED per-throw scatter on the launch only;
seeded replays exactly); no balancing across two rims (the fins); once in a basket it goes down that
column 100% (`through`).

### The invisible tube / rimouts (2026-09-23)

The throat once stood 8 ballR above the rim (held balls in the first hoop touched, inflating scoring);
**removed on Matt's call** ("it should be able to freely bounce horizontally"). Shipped: `throatTop: 0`,
`rimout: true`, `rimSideways: 1`, `rimKeep: 0.6`. `test.js` pins that rimouts EXIST and the tube is gone.

### There is NO rimout on this machine - SUPERSEDED 2026-09-23

Rimouts are ON now (see above): the disc falls at `through`, which IS final, so a ball may bounce out
until it is below the rim.

### Rimouts and a round rim: built, measured, switched OFF - and Matt chose to leave the hoops as is (2026-09-23)

Knobs `rimCap`, `captureKeepsCollar`, `throatTop`, `rimSideways`, `rimKeep` exist (OFF except as above).
The "50-50 neighbour hoop" goal is unreachable by rim physics; Matt was offered cabinet changes and
chose **"leave the hoops as is." CLOSED. Do not re-open without him.** `rimKeep 0.35` with `ringRest
0.7` never settles: unsafe.

### A little harder (2026-09-23)

`captureDrop` moves nothing. `jitterAim` 0.013 -> **0.025**. `captureKeepsCollar` rejected (a perfect
shot must go in). Shot messages: 24px, bordered, tick/cross (shape not colour), 10px under the board's
bottom edge, MEASURED from the camera each `fit()` (`render.js` `boardBottomPx`); status messages 17px.

### Later physics changes (2026-09-24)

- **`aimReach: 0.39`** (boarddef, ui.js swipe handler only): an over-aimed swipe at an outer column
  falls off a cliff at the dead rail; the swipe is clamped at the sweet spot. Engine, jitter and
  `COLUMN_AIM` (the CPU) untouched.
- **`backWallKeep: 0.45`** (physics.js `BACK_PARTS`): the wall behind the hoops is softer (balls were
  bouncing back onto the ramp). Turning that rebound sideways was REJECTED. A bouncier side RAIL
  changes nothing (`wallRest`).
- **A full column's hoop is CAPPED:** `buildWorld(board, closed)`, `startThrow({ closed })`: a static
  cylinder LID filling the mouth, top FLUSH with the rim plane (`collarH`, a slab on top was rejected),
  edge at `H.r`, `0.6 x ballR` thick, rims' material; capture loop skips a closed hole. `ui.js
  closedHoles()` passes every column `canPlay` refuses on every shot (CPU and all protocols); picture:
  light-grey lid AND grey rim (`render.js setClosed`, called from `paintHud()` and on renderer build).
  `land()`'s `'full'` branch is kept. Unseeded probes pass nothing and are unchanged.
- **Back corners filled:** `backCornerChamfer` 1.00X (machine.js "THE BACK CORNERS"), a 45-degree wedge;
  the watchdog rate went 5.57% -> 0.00%.
- **SIDE WALLS:** `machine.js` "THE SIDE WALLS": a 2 cm plexiglass pane (`sideWallT: 0.02`) at the
  display's edge (`sideWallU: SCREEN_W / 2`) from below the shelf to the BOTTOM of the marquee (not the
  backboard top: it hid the sign), shelf front to back wall, rims' material (`matRing`). Outer columns
  are now the EASIEST (45 and 46 of 60 vs 29-37 in the middle): look here first if Matt says 1 and 7
  are too easy. Picture in `render.js _sideWalls` (the 'sideWall' part skips the generic box renderer).
  The black arrow shapes beside the outer hoops are the rail CHAMFERS.

## The rules of a match

- **Two shot rules** (`shots: 'until'` shoot until you sink one; `'one'` a miss passes the turn). It
  lives on the `Match` (`oneShot` in `js/game.js`) because both sides must agree: in a live room the
  HOST'S setting wins (room `config`); in turn-by-turn it is frozen on the match document. A shot into
  a FULL column takes the same path as a miss via one shared `_passTurn()`.
- A ball that rims out into the NEXT hoop still counts, in that column. Nothing steers a ball.
- The grid is a SCREEN (a `CanvasTexture`); physics only answers which hoop it went through.
- **A challenge's stored result must be its moves' result (2026-10-28, integrity)**: `validateGame` replays the
  columns (`js/replay.js`, shared with `js/integrity.js`) and refuses a match whose `over.winner` is not the
  four-in-a-row or the full board (resignation excepted). Before, any stored winner counted. 75 of 75 real matches agreed.

## Setup screen and Menu (2026-09-22/24)

- **Setup is one card and one door:** "Play the computer" (difficulty + shots per turn only, collapsible,
  state in `gamehub.hoops4.cpuOpen.v1`) and **Multiplayer** (a card row with `›`, same head style). Order:
  title, **Your turn** card (only when there is one; `ui.js _fillTurns()` reads `MP.readMyGames()`
  behind the painted screen, only with a player code; up to 4 rows then "+N more"), Multiplayer, Play
  the computer, How to play. A picture of the machine (`GAME_ART['hoops4']`) is shown, dropped on a
  short phone before any control (no game may scroll). `.h4-setup` scrolls with
  `overscroll-behavior: contain`. **Matt deleted all subtitles/taglines on setup and multiplayer
  screens: "DO NOT replace it."** Class clash: HUD turn label is `.h4-turn`, setup rows are `.h4-trow`.
- **`opponent: 'two'` is still a real stored value** (neither deleted nor rewritten, rule 5): the
  difficulty row shows Medium until picked again; Play passes `vsCpu: true` explicitly.
- **How to play** follows `docs/BUILDING-A-GAME.md`: a diagram of the one non-obvious mechanic (the
  hoop you sink decides the column; chosen hoop marked by outline + ball + arrow, never colour);
  single-row lines (shorten strings, never shrink type).
- **Turn label:** "<who>'s turn" (`turnYou`/`turnCpu` "Computer's turn"/`turnOf`; Spanish "Turno de la
  CPU"), a small basketball in that player's colour (never colour alone), centred between equal 96px
  reserves (116px in multiplayer, clearing the chat button), 19px; in multiplayer "Their turn" with
  the name on the line below.
- **HUD (multiplayer):** second line "vs <emoji> <name>" (16px) then "Game 2 of 3 · Series 1-0" (yours first,
  from `seriesWins`, the score BEFORE this game). Your colour is carried by the machine's tint
  (`render.setPlayerTint`, whole match, never follows the turn) and the pill's ball. **The tint is the
  ball's colour exactly** (`ballTone()`; background unlit, rails and side strips EMISSIVE). **Yellow's
  tint is mixed much further than red's (0.85 vs 0.42) on purpose: do not "equalise".**
- **Menu button is Skeeball's** (`.h4-menu` = `.sk-menu`'s box: absolute, `top: max(10px,
  env(safe-area-inset-top))`, `right: 12px`, 44x44, hamburger) opening `_showPause()` (ported from
  `skeeball/js/ui.js`, `.gh-overlay`/`.gh-modal`, X in the corner, Resume / New game / leave). The
  third button is this game's own destination (setup screen; "Back to multiplayer" in a turn-by-turn
  match). **New game is HIDDEN in any multiplayer match.** Leaving routes through `leaveMatch()`.
  **PAUSED MEANS PAUSED** (loop stopped while the sheet is up; `leaveMatch`'s cancel restarts it;
  `preserveDrawingBuffer` keeps the frame). HUD `padding-left: 76px` (hub chip) and
  `padding-right: 64px`.

### Two buttons in one place, and why a measurement said otherwise

Hub chip owns the top LEFT; Menu is far right; separation is HORIZONTAL (a notch cannot move that
axis). **A headless browser has no safe area: any claim about two fixed elements not colliding must
name or simulate the inset (~59px).** The probe asks `elementFromPoint` whether Menu is at its centre.

## Multiplayer: TWO protocols, on purpose (2026-09-22)

| | LIVE | TURN BY TURN |
|---|---|---|
| layer | `js/net.js`, `rooms/<CODE>` | `hoops4/js/mp.js`, `hoops/games/<id>` |
| addressed by | five-character room code | the other person's PLAYER CODE |
| quick chat | `rooms/<CODE>/reactions/<role>` (`net.sendReaction`) | `hoops/games/<id>/chat/<key>`, OPTIONAL |

`js/mp-ui.js` is the one screen both are reached from; DOM only, lazily imported.
- **ADDRESSED BY PLAYER CODE, never deviceId** (two-phone players).
- **A MOVE LOG, never a board snapshot.** `replay()` runs the log into a fresh `Match`.
  **`validateGame` is WHOLE-DOCUMENT REJECTION** (one bad entry replays differently on two phones).
  Log entries: landed shot `{by, col, shots}` (`shots` charges the misses that came first) and
  `{by, miss:true}` ONLY under one-shot.
- **Nothing is ever deleted.** Resign writes `over: {winner, why:'resign'}`. `mp.js` contains no delete.
- **Every write is verified by a fresh re-read** (rule 6); an unsendable move is QUEUED in
  `gamehub.hoops4.outbox.v1` and retried when the screen opens. A DENIED write is deliberately not
  retryable (never sits in the outbox).
- **`hoops` is a top-level node in `database.rules.json` and `backups/rtdb-backup.mjs`'s `BRANCHES`**
  (PUBLISHED by Matt 2026-09-22). If it is ever dropped from the published rules: `readMyGames()`
  returns `[]`, `createGame()` returns `{ ok:false, reason:'denied' }`. Live multiplayer needs no rules
  change (`rooms/` is enumerated). Both `rooms` and `hoops` are `auth != null` with no per-child
  validation, so `chat` and `reactions` need none either.
- **New optional fields must never refuse a match:** a required `series` would have made every
  existing match unplayable. Everything defaults (`series` 1, `seriesNo` 1, `seriesWins` 0-0, `seriesOf`
  the game's id, `caption` empty, `chat` absent). Tests use hand-written PRE-series and PRE-chat
  documents.
- Not built: no launcher badge (`countMyTurns` is exported and tested, nothing on the hub reads it);
  no rematch button on a finished async match; no outbox for chat (tap again); no launcher alert for
  chat (a chat line deliberately does not touch `updated`).
- Push: built 2026-09-23 (root `CLAUDE.md`, "Push notifications"); `createGame` stamps `by` so the
  maker is not notified. **A notification tap opens that match** (2026-09-24): `sw.js` reads the id
  from the tag `hoops-<id>`, `js/hub.js` calls `alert.js armOpen(id)`, `ui.js maybeCeremony` opens
  the board directly (no card); a finished match opens as read-only review and is marked result-seen.

### The challenge has to reach you on the LAUNCHER (2026-09-22)

- **`hoops4/js/alert.js` decides** (`decideAlert(rows, seen)`, pure, tested): a match id never seen =
  **challenge**; seen but `updated` past the acknowledged stamp with the turn on you = **turn**;
  finished = neither; a challenge outranks a turn; third kind `'over'` ("GAME OVER / You lost vs
  <name>") sits below a new challenge and above a turn. The seen map records a STAMP per match.
  **`js/hub.js` knows only that a registry entry may declare an `alerts` module**, imports it lazily
  AFTER the launcher has painted, guarded (a tile must never break the launcher).
- **alert.js is in `hoops4/` and not `js/`** because it writes a `gamehub.*` key (a cache-first SHELL
  module may not; `tools/test-sw-strategy.mjs`).
- The two states are told apart by WORDS ("{who} challenged you!" / "Your Turn!"), not colour. Bubble
  anchors by `is-col-left`/`is-col-right`, flips under on the top row (`is-below`).
- **The ceremony** (`showCeremony` in `ui.js`) is ARMED by the launcher and taken once on mount, never
  backfilled. Challenger is side 'a' (RED, shoots first). Veil must be opaque enough (white setup card
  behind). "Let's play" must not close the card before reading the match (`toast()` is silent off the
  game screen). A Skip button top right from frame one; a tap elsewhere jumps to the end (`is-still`).
- **The seen map lives in `mp.js`; `createGame`, `pushMove`, `resignGame` stamp it on success** so this
  device's own writes are never news. **`watchMyGames`** is a read-only live listener on
  `hoops/index/<you>`; `js/hub.js _watchGameAlerts` subscribes ONCE per game for the hub's life.
- **`_dismissGameAlert`/`showLauncher()` must re-render/re-ask**: `launch()` only HIDES the grid, so the
  bubble element came back; `_checkGameAlerts` must clear an alert that stopped being true. Three
  `[KNOWN-BUG PROBE]`s in `tools/test-hoops4-mp.mjs`.
- **Delivery moves to the FIRST SHOT:** shooting first, `createGame` writes only the sender's row
  (`writeRows(..., only)`); the first `pushMove` writes both (a first-shot miss under one-shot is a
  `passed` entry, so it delivers). `first: 'them'` is told at once. `armTurn(id, updated)` stamps the
  seen map one tick BEHIND so the sender is reminded ("Your turn vs <them>") until they shoot or close
  it. Quit before the first shot writes no row for the other person (now CALLED OFF). Matches made
  before this are re-armed ONCE by `alert.js rearmUnshot` (`UNSHOT_BEFORE` 2026-09-24,
  `gamehub.hoops4.unshot.v1`); the other person's row is left alone.
- **Names on the bubble:** `decideAlert` returns `names`; `_turnLine` writes "Your turn vs A", "vs A
  and B", "vs A, B and 2 more" (escaped: other people's names go into innerHTML).
- **Challenge list by CODE, not person:** `opponentsFrom` (mp.js, pure) lists codes; two codes collapse
  only when the identity graph joins them AND names match after aliasing (newest code wins).

### Live turns, replay, series

- **Live turns:** `MP.watchGame(id, cb)` (read-only, validated docs only); `_onAsyncGame` applies log
  entries past `mp.applied`, skipping this device's own (`_sendShot` bumps `applied` BEFORE the push).
- **Replay of the other person's shot (2026-09-30):** optional `t: [{p, a, s}]` (power, aim, seed; last
  `TRAIL_MAX` 6) on a move, recorded in `shoot()`, parsed by `trailFrom`. **A bad/missing trail never
  refuses a match.** The recorded move decides, never the flight (`_rpDropOk`). Plays once
  (`gamehub.hoops4.shown.v1`), `REPLAY_SPEED` 2.5, `.h4-skip` pill (`_rpSkip`), `busy` held throughout.
- **The series score is keyed by SIDE and sides swap each game:** `nextInSeries` passes `{a: st.wins.b,
  b: st.wins.a}`; `createGame` stamps `winsBySide: 2`; `validateGame` swaps a game 2 lacking it (on
  read, nothing rewritten). Owed series games appear in "Your turn" (`owedSeries`, mp-ui.js); ONE
  person gets **Start game N** (whoever LOST the last game; draw: side 'b'). A finished match opened
  from History offers "Next game" only when no later game exists.

### A series, and the terms of a challenge (2026-09-22)

Picking an opponent opens a TERMS screen (shots per turn defaulting to the challenger's setup choice,
single / best of 3 / best of 5, optional caption); a failed send keeps the form. **`seriesAfter(game)`
is pure and the ONLY place the rules live** (best of 3 needs two wins, best of 5 three; **a drawn board
gives nobody a win**, so a series also ends when it runs out of games). **The next game is started by a
BUTTON, never automatically** (`tools/test-hoops4-mp.mjs` asserts `pushMove`'s body never calls it). Sides
swap (`first: 'them'`). Terms shown on the accept card (read from the MATCH), as "Game 2 of 3" on HUD
and active rows, and the running score on the game-over card. Terms screen reuses `.h4-opt` WITH its
checkmark (selection never by tint alone); caption box is NOT `.h4-mp-input` (room-code style).

### Cancel, decline, expire (2026-10-13)

Root `CLAUDE.md`, "Cancel, decline, resign, expire". Until the receiver of game 1 has shot, the Quit
reads **Cancel** / **Decline** (pause sheet: "Cancel challenge" / "Decline challenge"); `cancelGame`
writes `over: { winner: 'none', why }` — **NOT `winner: null`, which here means a DRAW** — counted for
nobody. `resignGame` does the same on an open match. Challenges from 2026-10-13 carry `lapse: true` and
**expire 3 days after the first shot** (`pushMove` refuses `'expired'`). `validateGame` keeps `by`.
Called-off rows are stored `over: false` (deployed `decide()` would push "<you> won"). Opening a
called-off/expired match leaves for the multiplayer sheet with a note (`openMultiplayer(ui, { flash })`);
`finish()` never records one.

### The multiplayer home, reorganised, and Quit (2026-09-23)

`mp-ui.js viewHome`: one primary **Challenge someone**; **Host / Join / Pass & play** as three small
tiles; **Your turn** (first, accent bar) and **Waiting on them** with counts; **History ›** at the foot.
Row = name on one line with a small line ("Game 1 of 3"; "One shot only" only when that is the rule).
**Quit** on every row and the pause sheet of a turn-by-turn match = RESIGNATION (`MP.resignGame`; asks
first, counts as a loss, deletes nothing; history reads "Won, they resigned"). **A finished match is
counted on BOTH phones exactly once**: per-device ledger `gamehub.hoops4.counted.v1` (`markCounted`/
`recordFinished`), `finish()` counts via the STORED `over.winner`; rows WITHOUT a `result`
(pre-2026-09-22) and rows before `LEDGER_SINCE` (2026-09-23 03:15Z) are skipped, never guessed
(rule 2). **A match that ended while you were away is shown** by a Game Over POPUP (not a list
section; Matt rejected that): `gamehub.hoops4.unseenResults.v1` (`addUnseen`/`readUnseen`/
`markResultSeen`), `mp-ui showUnseenResults`; tapping the launcher bubble does NOT mark it seen, the
popup/X does; `finish()` marks a shown match.

### Quick chat inside a match (2026-09-22)

A chat button on the HUD (multiplayer only) opens a panel (last four lines, the player's palette from
`js/mp-reactions.js` / `gamehub.quickchat.v1`, one free-text line; receiver resolves presets in ITS
language). Wire payload `{ t, v }` (`e` emoji, `p` preset id, `c` free text). Button sits LEFT of Menu
(`right: 64px`; `.h4-hud.has-chat`), NOT `mp-reactions-ui.js`'s bottom-right button (middle of the
swipe pad). Who said what is never colour ("You:" / "Anita:", sender emoji + NAME on bubbles, unread
COUNT badge). Live: `rooms/<CODE>/reactions/<role>` (one slot per seat; first snapshot only ADOPTS
stamps). Turn-by-turn: `MP.sendChat` writes ONLY `hoops/games/<id>/chat/<key>` (`{by,t,v,at}`, key
`mintGameId() + side`), verified by re-read, newest 40 (`MAX_CHAT`). **THE MOVE LOG IS NEVER TOUCHED**
(live chat in `moves` would stall lockstep at the gap; chat never touches `updated`/`turn`/`over`/index
rows). **The chat field is OPTIONAL; a bad line is dropped (`chatFrom`), never a reason to refuse the
match.** `gamehub.hoops4.chatSeen.v1` marks "since you were last here". Later: chat cap 24 -> 120
(`MP.CHAT_MAXLEN`; `net.sendReaction` slice 120; display via `MP.cleanChat`, not `reactionText`); their
line is a big centred card (24px, no slide-in, 8 s; yours the small corner bubble); cards close on a tap
and repeats stack ("×5"); the palette accepts any `isEmoji()` emoji (max `EMOJI_MAX` 16). The profile page's Quick chat is ONE tap-to-move list per kind in `gamehub.quickchat.v1` order (not drag).

### Challenge history with records (2026-09-22)

**History** is the fifth row on the multiplayer home: a record per opponent (W/L/D from YOUR side) and
finished matches newest first (result as a WORD plus a SHAPE; never colour alone; newest 30). A screen,
not a schema change. `MP.recordsFrom(rows, myCode)` is pure and tested: **grouped by the opponent's
PLAYER CODE, never name**; result from the row's own `result`, else the MATCH (`MP.readGame`, newest 40,
`resultOf(game, side)`, never written back), else `unknown` (listed "Finished", counted played, in NO
win/loss/draw column). Since 2026-09-22 `rowFor` adds optional `result`/`why` to FINISHED index rows
only; nothing backfilled. **Tapping a finished match opens it READ ONLY** (`startAsync(game, { review:
true })`): nothing is recorded again (additive writes), no "Next game" unless no later game exists, and
a resigned match takes its headline from the stored `over.winner`. The list lives in `.h4-mp-body`
(`overscroll-behavior: contain`).

## The CPU's difficulty is SHOT ACCURACY, not search depth

`js/cpu.js`'s `COLUMN_AIM` is the measured mean aim per column; per-skill `spread` in those units
(neighbour gaps 0.12-0.16). **It shoots through the same physics the player does; nothing places a CPU
disc directly.**

## The swipe

`aimCurve: 1`, `aimDiv: 1.00` (departures from Skeeball's squared swipe, on purpose: squaring would
squeeze the outer columns). **`aimDiv` is the first number to tune if Matt finds the columns fiddly**
(pure input shaping). `aimReach: 0.39` clamp: see "Later physics changes".

## Still open

Open items: see the root TODO.md, "Connect 4 Hoops".
- Done: quick chat (2026-09-22), challenge history (2026-09-22), `hoops` rules published (2026-09-22),
  "50-50" bounce CLOSED (2026-09-23, "leave the hoops as is"), scoring rate CLOSED.
- Shipped-twice reminder: v953 was shipped twice by two PRs; bump CACHE past what is on `main` NOW.

## Testing

- `node hoops4/js/test.js` — engine probe, headless, ~2 min (`POWERS`/`AIMS` env set the grid). Probes: see the cabinet section.
- `node tools/test-game-conventions.mjs` — shared checklist; `node tools/check-no-scroll.mjs hoops4` — **no game in
  this hub may scroll**; `node tools/test-visual.mjs hoops4` — the only suite that LOOKS at it.
- `node tools/test-hoops4-mp.mjs` — the PURE halves of turn-by-turn multiplayer: whole-document rejection, the
  replay (position AND shot counts), turn rules under both shot modes, listing order and badge count,
  structural checks (every write verified, dev origin cannot write, `hoops` in `database.rules.json` and
  the backup script's list, `mp.js` has no delete, `pushMove` never calls `createGame`), the chat field
  (pre-chat document opens identically; garbage dropped), history maths. The Firebase write path and
  `js/mp-ui.js` are NOT covered, and the suite header says so.
