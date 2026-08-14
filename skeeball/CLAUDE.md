# Skeeball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below
> overrides them. This game's specific obligations are under "Persistence and THE LAW" — read
> that before touching anything that stores or records.

A realistic arcade skeeball alley, rebuilt **from scratch on 2026-08-13** (nothing of the
previous build — layout, art, physics, structure — was carried over or consulted). The previous
build was then kept in the hub as **Skeeball_old** (`skeeball_old/`, hub id `skeeball-old`;
Matt's ask, same day) for side-by-side comparison while this machine is tuned — see that
folder's CLAUDE.md for exactly what its rename changed. Both builds record into the SHARED
`skeeball` stats id, and both use the board id `classic`, so that machine's records (bests, the
daily map, the top-score panel) are one continuous bucket across the two builds — deliberate,
so no play is ever orphaned. One machine exists so far, **THE CLASSIC**: a boardwalk cabinet with a varnished oak
lane, the burnt-orange board with the white cup ladder, twin corner 100 cups, and a marquee. The
player swipes up the lane; the swipe's speed is the roll's power and its angle is the aim. Nine
balls to a rack.

**The board was rebuilt to the REAL classic layout on 2026-08-13** against reference photos Matt
provided, after the first version shipped a wrong "bullseye" board invented from memory — the
exact failure `VISUAL-PROCESS.md` exists to prevent (look at the picture before you write code;
if there is no picture, ask for one). That rule was read and skipped anyway; do not repeat this.
The photos and researched behavior now live in this file and in `boards.js`'s `scoring` comment.

**Admin only for now**, exactly like Pinball: the hub entry carries `devOnly: true`. Unlike
Pinball, the stats id already has REAL family history (the game was live for a couple of hours
on 2026-08-11 under the previous build), which drives every storage decision below.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../skeeball/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `skeeball` |
| Stats id | `skeeball` (recorder `recordSkeeball`, sub-counter `sk`) — **pre-existing, frozen** |
| CSS root / prefix | `.sk-root` / `.sk-` |
| Settings key | `gamehub.skeeball.v1` (one preference: the selected machine) |
| Save key | `gamehub.skeeball.save.v1` (the mid-rack snapshot) |
| Difficulty axis | none — `byDiff` is keyed by BOARD ID (Hill Climb's stages-as-the-axis precedent) |
| `isInProgress()` | the **autosave/resume** meaning: always `false`; see below |

`isInProgress()` returns `false` even mid-rack (Escoba's class of the contract, not Ball Run's):
the between-throws state is the stable state of skeeball, `ui.js` snapshots it to
`gamehub.skeeball.save.v1` after **every settled ball**. While a snapshot is banked the setup
screen offers BOTH actions: "Resume rack · N/9" (primary) AND "New game" (ghost) — never only
one. New game discards the snapshot (`clearSave()` before `_startGame(null)`): the snapshot is a
resume convenience, not earned history, and the player pressed the button that says so with
Resume sitting directly above it (Matt, 2026-08-13: a save must never trap the player into
resuming). A ball actually in flight resolves in under two seconds and is deliberately not part
of the saved state — the throw a player abandons mid-air was theirs to abandon, and the ball is
only spent when it settles, so resuming re-serves it.

`immersive: true`: `.sk-root` is `position: fixed; inset: 0` at `z-index: 1` (Pinball's shape),
so the hub's floating back button rides on top; `.sk-hud` carries `padding-left: 76px` and the
gallery `padding-top: 84px` to clear it.

## Files

| File | Role |
|---|---|
| `js/vendor/` | **vendored battle-tested libraries** (2026-08-13, Matt's explicit instruction - see below): `cannon-es.js` (rigid-body physics, ESM), `three.module.min.js` + `three.core.min.js` (renderer). Committed files, no build step, no network fetch. Never hand-edit them |
| `js/machine.js` | the machine's GEOMETRY, once, in metres: every floor, wall, band segment and collar as data. physics.js builds cannon bodies from it and render.js builds three meshes from it, so the wall you see IS the wall the ball hits |
| `js/boards.js` | the machine registry: identity, look tokens, the `geom` block (sizes, angles, launch speeds, hole layout), unlock chain. Pure |
| `js/physics.js` | the ball, simulated by cannon-es: materials/contact tuning, speed-aware hole capture, trough scoring, the watchdog (NO magnetism - see below). Deterministic, no rng |
| `js/game.js` | the rules of a rack: nine balls, scoring, the event stream, snapshot/restore, the recorder payload. Pure |
| `js/render.js` | the machine on screen, drawn by three.js: scene from machine.js + cosmetic dressing, lights/shadows, painted textures, ball mesh synced from the physics body |
| `js/howto.js` | the How To Play sheet content (repo pattern, `tic-tac-toe/CLAUDE.md`) |
| `js/strings.js` | the EN/ES dictionary |
| `js/ui.js` | DOM shell, the swipe, storage, records panel, the hub module contract |
| `js/test.js` | headless engine tests incl. the reachability sweep and the soak (wired into `run-all-tests.mjs`) |

`machine.js`, `boards.js`, `physics.js` and `game.js` are DOM-free and that is load-bearing:
`node skeeball/js/test.js` plays hundreds of throws in node (cannon-es runs fine there), and the
same determinism is why the tuning is testable at all.

## The vendored engines (the one "no dependencies" exception, and why)

Matt, 2026-08-13, after three rounds of hand-rolled physics kept failing his eye test and he was
told the good apps are built on general-purpose physics engines: *"Why didn't we use that from
the start??? Use ALL AVAILABLE resources like this. 'battle-tested' codes and scripts... are way
better and preferred by a TON over anything you build directly. Go - vendor cannon-es and
rebuild it on that... If any other things like this cannon-es thing exist - FIND AND USE IT."*

So `skeeball/js/vendor/` holds cannon-es 0.20.0 and three.js r185 as committed ES-module files.
This honors the repo's real constraints (static files, no build step, works offline - the three
files are in `sw.js`'s ASSETS) while bending the letter of "no dependencies" on Matt's explicit
instruction. The lesson generalizes: for solved hard problems (physics, 3D rendering), vendor
the proven library instead of imitating its output by hand. Do NOT hand-patch vendor files; to
upgrade, `npm pack <name>` and copy the dist build over.

## The setup screen and How To Play (rebuilt 2026-08-13 to the repo patterns)

The first versions of both were designed from scratch and Matt threw them out ("start the design
over" / "throw out 100% of it"). The rebuilds follow the documented references EXACTLY; a future
redesign starts from those documents, not from taste:

- **Setup** follows Escoba's page order (`escoba/js/ui.js`, the repo's setup reference): title →
  Resume button if a save exists → one stats line (Best · Today · Top · Last) → the settings card
  as a collapsed `.gh-acc` accordion row ("Machine / THE CLASSIC"; open it to pick a machine,
  each unlocked machine a card with its four records) → the How-to-play text link → ONE primary
  action (Play, or New game as a ghost when Resume is the primary). Built on `css/ui.css`'s
  `.gh-*` primitives (`ui.js` injects `css/ui.css` idempotently before its own sheet, the same
  marker `bug-report-ui.js` uses) — the accordion is `.gh-acc`, the buttons are `.gh-btn`; only
  the skeeball-specific bits (`.sk-statline`, `.sk-mrow`, `.sk-howto-link`) are local CSS.
- **How To Play** follows `tic-tac-toe/CLAUDE.md`'s five-part pattern, restated in `howto.js`'s
  header: one bold goal line, ONE diagram of the one non-obvious mechanic (swipe strength =
  landing height, drawn as a side view with three numbered arcs), a caption, an X = Y example
  ("Half strength = the 50 cup"), then the edge cases one sentence each. Every text line is
  measured and shrunk to fit ONE row before nowrap locks it (`_fitHelpLines` in `ui.js`); the
  arcs are told apart by dash pattern AND numbered markers, never colour alone.

## The machine and its physics (cannon-es since 2026-08-13)

The hand-rolled collision model went through two full rebuilds (decided-at-contact → emergent
face simulation) and still failed Matt's eye test: *"you can clearly tell it's being told to
react a certain way."* It was replaced wholesale by cannon-es (see "The vendored engines"), and
nothing scripts a reaction any more:

- **The machine is real geometry** (`machine.js`): lane, hump quarter-pipe (launch angle IS the
  last segment's angle), trough, tilted board slab (~32 degrees), ring band and cup collars as
  flush box-segment polygons, rails, tall backboard, the wire cage over the board, the front
  glass, a kick panel under the lip. The ball is a rigid sphere with mass and spin; rolling,
  hops, rim rattles and backboard reactions all come out of the contact solver.
- **The feel lives in exactly two places**: `boards.js`'s `geom` block (shapes, sizes, angles,
  launch speed range) and the four ContactMaterials at the top of `physics.js` (friction and
  restitution per surface pair - wood, board, slick steel walls, dead backboard/cage).
- **Hole capture is the one non-engine rule**, and it is what a hole IS: when the ball's centre
  is over an opening at face level AND IT IS SLOW ENOUGH TO DROP IN, its collision mask drops the
  board slab and GRAVITY takes it through the mouth. No teleport, no canned sink. The speed test
  (added 2026-08-14) is pure kinematics: in the time the ball takes to cross the mouth, does it
  fall far enough to be past the lip? Its own inward velocity counts, so a ball dropping into a
  cup goes in even at speed while a fast roll skims across and carries on UNCHANGED - not
  deflected, not slowed, not steered. That single test is what makes distance up the slope choose
  the cup, which is the whole game. Without it the first mouth a rolling ball crossed always
  swallowed it, so nothing above the bottom cup was reachable by rolling at all.
- **The trough scores like the real bottom slot**: centre band = 10, corners = 0. A dead lob
  rolls into the 10, exactly like the real machine; the honest zero is the corner.
- **NO MAGNETISM, EVER. This is a standing, permanent ban.** Balls never curve toward holes, are
  never corrected and are never assisted; a ball goes where it was thrown. A "dish" used to live
  in `physics.js` section 5 - a constant pull toward the 20's mouth for slow balls inside the
  ring, justified as modelling a real dished bowl - and it was deleted on 2026-08-14 because it
  was exactly that: a ball being steered into a hole it was not thrown at. A ball that runs out
  of speed on the slope now does the honest thing, rolls back down and feeds the 10. **If a power
  band needs widening, widen it in the GEOMETRY.** The input side (how a swipe becomes a power and
  an aim, in `ui.js`) is a different thing and is fair game; the ball, once thrown, is not.
- **The 100s are corner holes reached by AIMING**, never by a straight ball: full power plus a
  hard sideways fling (aim >= ~0.9 at power >= 0.70; 18 of 189 cells in the aim x power grid).
  Miss the angle and the ball is gone for 0 or 10 - that risk is what stops "slam it straight"
  from being the whole game, since a straight slam reliably banks the 50.
- **The spacing rule** (in `boards.js`, learned twice): every gap between two pieces of
  furniture is either MERGED or wider than a ball plus margin. An in-between gap is a pocket,
  and a three-contact pocket LOCKS the cannon solver completely - velocity writes get solved
  back to zero. Check every neighbour pair before moving any cup.
- **The watchdog** (displacement-anchored, never speed): a parked ball gets popped off the face
  like real chatter; a ball two pops cannot move is jammed and gets walked out slowly toward
  the nearest mouth. The 12s cap should be unreachable; the tests keep the whole emergency
  path under 2% of the sweep.

Deterministic: fixed 1/240 step, fixed solver iterations, naive broadphase (stable pair order),
no rng anywhere. One fresh world per throw, so nothing leaks between balls. Retune freely, but
run `node skeeball/js/test.js` first - the sweep pins reachability of every hole, the rollback,
the straight-power ladder (30 → 40 → 50), **no dead zone at either end of the dial**, **few flips
between adjacent power steps**, **harder-goes-further quarter by quarter**, **the 100 needing
power AND aim (and costing the ball when the angle is missed)**, real bounce events, and the
emergency path staying rare. `tune-ladder.mjs` and `measure-reach.mjs` at the repo root are the
bench tools those numbers came from; run `tune-ladder.mjs` after touching anything in `geom`.

The renderer (`render.js`, three.js) builds its scene from the SAME `machine.js` description,
plus paint. Reduced motion drops popup rise and particles, never the ball.

## The 2026-08-14 rebuild: the camera, the throw, the cups, the trajectory

A play review drove the shipped build through a real browser with real touch and measured four
things that no static check could see. Each fix below is a rule now.

### The camera stands BEHIND the ball

It used to sit at z = -0.34, which is past the serve spot at z = -0.12 - the camera was in front
of the ball. Measured: the ball waiting to be thrown projected to **y = -3875px on a 773px
canvas**, i.e. nowhere near the screen, and stayed off screen for the **first 250ms of every
throw**. Most of the lane was behind the viewer too, so the bottom 187px (22%) of the screen -
the part the player is told to swipe on - was a featureless brown field.

The camera is now at (0, 0.42, 0.62) looking down the lane, and `resize()` derives the FOV from
**the two points that must always be visible** (the resting ball, and the top of the marquee),
widening only if the board would be cut off sideways. Never go back to fitting the board's width
alone: on a tall phone that produces a vertical field too narrow to hold the thing at the near
end of it. Measured after: ball on screen at rest and for **0 of 70 flight frames off screen**;
featureless bottom band **27px (3%)**.

### The ball FLIES. Read this before touching the ramp.

**The launch angle must EXCEED `boardTilt`.** Range up the slope for a projectile onto an incline
is `R = 2 v² cos(t) sin(t − a) / (g cos²(a))`, zero at `t = a` and negative below it. A ball
launched shallower than the face it is flying at cannot get above that face: it meets the bottom
edge and rolls from there, at every power, forever. That is geometry, not tuning.

**This was got wrong twice, in opposite directions, and the second time shipped.** The original
build launched at 0.62 rad into a lively board and the ball sailed over *everything*: 31 of 51
throws never touched the face, 25 of 51 died against the back wall, and a real 50 spent part of
its flight above the backglass. Correcting that, the ramp was flattened to **0.30 rad against a
0.56 rad board** - and `tune-ladder.mjs --touch` reported it as *"101 of 101 touched the scoring
face"* and it was written up here as a win. Matt, next morning:

> *"The ball doesn't go in the air. It hits a tiny bump rather than a ramp that shoots it in the
> air. Regardless of how hard I throw the ball, it touches the very bottom of the scoring board
> 100% of the time. You have made it impossible for the ball to go off the ramp and land directly
> in a scoring hole."*

Measured: peak clearance over the face 0.6-3.5cm, airborne 0.00-0.01s, **0 of 21 throws first
touched the board above v = 0.10**. A metric pointing the wrong way had been optimised to 100%.
**"Touched the scoring face" is not a virtue** - dropping into a cup out of the air is the shot
skeeball is FOR. What the first build got wrong was the arc's SHAPE, never that an arc existed.

The shape that works, all four parts load-bearing together:

- **Launch 0.88 rad (50 degrees)**, clearing the board's tilt by 18.
- **Six ramp segments, not four.** With four the ball met the steep part too abruptly and the exit
  velocity scattered: 34 flips, 42% repeatable. Six give it room to track the surface: 6 flips,
  88%. A ramp's job is to be FOLLOWABLE, not just steep.
- **The ramp stays 0.30 long**, so its crest stands 0.186m up. Shortening it lowers the crest and
  ruins the launch (that was the 42% case).
- **So the BOARD is raised instead**: `boardLipY` 0.07 -> 0.20, which is how a real cabinet is
  built. At 0.07 the crest stood proud of the playfield and hid the 20 and the 10 completely from
  a camera behind the ball. `sight.mjs` measures that clearance - keep it positive whenever the
  ramp, the board or the camera moves.

Measured after: **21 of 21 throws get airborne**, peak clearance 8-29cm, 19 of 21 first touch the
board above v = 0.10, the landing point spreads 0.04 -> 0.97 monotonically with power, and **70 of
101 straight throws drop into a cup without touching the board at all**. Run `measure-arc.mjs`
after touching any of it: `tune-ladder.mjs` alone cannot see this defect, which is how it shipped.

### The dial is a ladder, and its bands were measured, not guessed

The shipped power→outcome map was noise: **43 of 100 adjacent 0.01 power steps flipped the
outcome, 30 of the 44 bands were one step wide**, and two real throws 0.002 of power apart - 0.6px
of thumb travel over the measurement window - scored 30 and 10. The softest 25 steps of the dial
all scored the floor, and so did 12 of the hardest.

What fixed it, in order of how much each was worth:

- **Every cup is FLUSH** (`collarH: 0`). Walls of 14-20mm read as nothing on screen and behaved
  as a step to a 50mm ball; crossing three of them on the way to the 50 scattered the outcome.
  Measured: 34 flips with 20mm walls, 17 with none, on otherwise identical geometry. This
  reverses the old "wall heights are a physics parameter, deepen them to read as cups" rule -
  the numbers live on the BOARD now, so nothing needs a wall to be legible.
- **The big ring is PAINT, not a wall** (`ring.solid: false`). As a 7.5cm band it fenced the cup
  cluster off completely: a rolling ball stopped dead on its front arc, and the only route to the
  30/40/50 was over the top through the air.
- **Power is spent as ENERGY** (`physics.js` interpolates v², not v). Distance up the face goes as
  the square of arrival speed, so a dial that was linear in speed was quadratic in the thing the
  player aims with.
- **`minSpeed`/`maxSpeed` bracket the LADDER**, nothing more: at minSpeed the ball just reaches
  the 20, at maxSpeed it just reaches the 100s' row. The old 1.0-7.4 window spent most of the
  player's range past the top of the board.
- **The hole positions sit on the measured reach curve.** `measure-reach.mjs` runs the engine with
  the holes taken OUT and records how far up the face each power setting gets; the four cups are
  placed on that curve at even intervals. Do not guess these.

Measured after: **14 flips, 15 bands, mean band 6.7 steps, no dead zone at either end**, every
value reachable, quarter-by-quarter means 23 < 31 < 43 < 50 (harder goes further), max flight
1.31s (was 3.99s). `tune-ladder.mjs` prints all of it against the old numbers; run it after
touching any of `geom`.

**One trade is deliberate and was measured both ways.** The old build asserted "max power scores
worse than mid power (overshoot has a price)". That cannot hold at the same time as "no dead zone
at the hard end": the topmost cup catches every overshoot, because the backboard is dead material
so a slammed ball rebounds slowly and falls back into the 50 from just above it. Every geometry
that DOES punish a slam punishes it off a cliff - shrinking the 50 until overshoots miss it turns
the top 26-32 steps of the dial into a flat 10, which is the defect the rebuild exists to remove.
So the price moved to the aim axis: a straight slam banks the 50 safely, and the 100 is worth
double but needs an angle that costs you the ball when missed.

### Every number is painted on the BOARD

Each cup used to wear a flat number panel placed at `z = radius * 0.995` - a flat plate set inside
a curved wall of that same radius. A plane cannot sit inside a cylinder without intersecting it,
so the wall cut a curved bite out of **every number on the board**: the 50, 40, 30, the ring's 20
and both 100s all rendered with their bottom halves missing. The mouth was laid flat on the face
while the tube was tilted -0.32 rad, so each black opening slid out from under its own cup and
read as a blob beside the next one down. And `if (!H.collarH) continue` left the 20 with no tube
and no number at all.

Now: values are stencilled into the field texture, up-slope of their own mouth, pre-stretched by
1.9 along v to survive the board's foreshortening. Nothing can occlude them because they are part
of the board. The corner 0s moved inboard to u = +/-0.30 and `resize()`'s fit margin clears them,
so they are no longer sliced by the frame edges. `_scallopedRim()` is kept for a future machine
that wants raised rims - it follows `machine.js`'s own per-segment height profile, so a wall that
IS drawn matches the wall the ball hits.

### The ball settles first, then the score

`capture` fires the instant the ball's centre crosses the mouth, ~325ms before it has finished
dropping through. Announcing there put the number on screen while the ball was still visibly
rattling. `capture` now only lights the rim; the `+N`, the burst and the marquee flash wait for
`ballDone`. Measured: capture at 853ms, settle at 1178ms, popup at 1178ms.

## The records panel (the four numbers every machine shows)

Per Matt's spec, each machine displays: the **top score by ANY player**, the current player's
**all-time best**, their **best today**, and **the score they just rolled**. Where each one lives:

- **Top score (anyone)**: derived at read time — `readPlayersOnce()` → `aggregatePlayers()` →
  `appWideBest(rows, 'skeeball', 'sk', boardId)` (`js/arcade-scores.js`; there is deliberately no
  shared `highscores/` node — see that file's header). Local history is merged over it so an
  unsynced device still shows its own truth. Async; the panel renders local-first and fills in.
- **Your best / today**: `bestOn` / `todayBestOn` over the player's own `sk.boards[boardId]`
  (the daily best is a date-keyed map that never resets — arcade-scores' header explains why).
- **Just rolled**: the rack-over sheet, plus a session-only "Last game" slot on the machine card
  (deliberately not persisted: the durable copies already live in the daily map and bests).

"NEW BEST" pills on the rack-over sheet compare against what stood BEFORE the rack was recorded.

## Persistence and THE LAW

**The stats id `skeeball` and sub-counter `sk` predate this rewrite and carry real plays.**
Everything this build writes goes through the SAME shared plumbing the old one used, so that
history keeps accumulating rather than being orphaned:

- `recordSkeeball(boardId, { score, balls, hundreds, fifties, bestThrow, at })` in
  `js/game-stats.js` — called exactly once per finished rack (`recorded` guard; every write in
  the store is additive, so a double call would silently inflate). `byDiff` buckets by board id;
  the first machine's id is **`classic`**, which is also `recordSkeeball`'s own fallback id —
  frozen forever (rule 5). Rename a machine's display name freely; never its id.
- Per-machine records and unlocks ride `sk.boards` / `sk.unlocked` via `js/arcade-scores.js`
  (counters add, bests `Math.max`, each DAY takes the max, unlocks union across devices).
- The frozen vs-computer fields (`sk.won`/`lost`/`tied`, from the pre-2026-08-11 build) are
  untouched: never incremented, never cleared, still shown by My Stats when non-zero.
- This game's own keys hold nothing earned: `gamehub.skeeball.v1` is one preference and
  `gamehub.skeeball.save.v1` is a mid-rack snapshot that is cleared only AFTER the rack it
  describes has been recorded to the shared store. Nothing in this folder's storage can lose
  anything, because nothing earned lives in it (Pinball's model).
- Item 7's three edits (`ensureSk`/`recordSkeeball`, the My Stats screen, the `players-agg.js`
  branch) all predate this rewrite and were left as they are; `players-agg.test.mjs` carries the
  regression case.

The leaderboard row is deliberately absent while the game is admin-only (`GAME_META` in
`js/leaderboard-ui.js` says so in place; `players-agg.test.mjs`'s `OFF_THE_BOARD` checks the
claim). The My Stats tab is deliberately PRESENT and not devOnly — family members may have real
plays from the hours the old build was live, and hiding the tab would make their own history
invisible (rule 1; the comment on the `TABS` row records this).

## Adding the next machine

1. Add an entry to `BOARDS` in `js/boards.js`: new frozen `id`, marquee `name` (a proper noun,
   untranslated), `taglineKey` (+ its `{en,es}` strings), `look`, `geom`, and
   `unlock: { board: '<previous id>', score: N }`. Obey `geom`'s spacing rule for every
   neighbour pair, and re-run the sweep - reachability is a property of the whole layout.
2. Run `node skeeball/js/test.js` — the sweep and soak run against every board in the list, and
   the unlock chain tests are already written (they currently exercise a synthetic future list).
3. `ui.js` needs nothing: the gallery, unlock checks (`unlocksEarned` → `unlockSkeeballBoard`),
   records panel and renderer are all board-generic. The unlock write is additive and merged as
   a union across devices, so a machine earned anywhere is earned everywhere.
4. Nothing in `sw.js` changes (no per-board assets). Update THIS file's header, which currently
   says one machine exists.

## Testing

- `node skeeball/js/test.js` — 41 assertions (~1 min; cannon runs every throw for real):
  determinism, the reachability sweep (every hole, the rollback, emergencies rare), the
  straight-power ladder (30 → 40 → 50) and overshoot-pays-on-average, the >2s rattle with real
  bounce events, statistical left/right symmetry (knife-edge throws may split - the solver
  iterates contacts in list order), a 250-throw soak (settles, in bounds, legal values only),
  the nine-ball rules through the real API, the recorder payload shape, snapshot/restore, and
  the unlock chain.
- `node test-game-conventions.mjs` — the shared checklist (viewport, touch, overlays, name gate,
  module contract, listener balance, dictionary, the layout-class collision rule).
- `node test-visual.mjs skeeball` — the only suite that LOOKS at it. Its PLAY probe swipes the
  real lane with real touch through full racks and asserts the score moved and the rack recorded.
  There is no separate MOTION probe for the same reason as Pinball: everything that moves is
  drawn into one canvas, so the canvas-sampling check lives inside the PLAY probe.

## Things a future session will want to know

- **No sound, no audio layer** — the arcade-cabinet precedent (Matt on Pinball, 2026-08-11:
  "Delete the sound option. No sound."). Nothing here constructs an AudioContext.
- **`skeeball.css` is two skins and the split is deliberate** (2026-08-13, the setup overhaul):
  the SETUP and HOW-TO screens belong to the hub — light `--sks-*` tokens on `.sk-root` with a
  `:root.gh-dark .sk-root` override, skeeball_old's lines 9-35 pattern — while the PLAY screen
  keeps the warm dark arcade look in both themes (Ball Run/Hill Climb/Pinball's class). The
  header comment in the CSS marks where one skin ends and the other begins. Do not "unify" them.
- The swipe measures the RELEASE flick (the last ~130ms), not the whole gesture — the wind-up is
  grip, not power. Power normalises against the stage height so a phone and a desktop feel
  alike. **Samples are clocked with `e.timeStamp`, never `performance.now()`** — under load the
  handlers run late and bunched, and handler-time clocking collapses a strong swipe into a
  dribble. That bug only shows on a busy main thread, which is exactly a cheap phone.
- `physics.js` has no randomness at all. If a future machine wants scatter, thread a seeded rng
  through `startThrow` and keep `simulateThrow` deterministic — the test suite depends on it.
- **Three WebGL lessons paid for in debugging time** (all in `render.js`, commented in place):
  a `position:absolute` canvas is a REPLACED element, so `inset:0` does not stretch it —
  `setSize(w, h, true)` must set the style or the frame is an unscaled top-left crop; software
  GL (SwiftShader — headless tests, GPU-less desktops) is detected up front and sheds shadows,
  antialiasing and resolution, or the main thread starves and even input dies; and
  `preserveDrawingBuffer: true` stays on because test-visual's play probe and Report a bug's
  screenshot both read the canvas, which is blank without it.
- `window.__skTest` (set in `init()`) is the read-only hook the headless drivers use to
  sequence real-touch play; the `__yzTest` precedent. Never used by the game itself.
- Machine names (`THE CLASSIC`) are proper nouns and stay untranslated, like STARHUB.
