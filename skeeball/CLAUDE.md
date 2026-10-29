# Skeeball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below
> overrides them. This game's specific obligations are under "Persistence and THE LAW" — read
> that before touching anything that stores or records.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

**`skeeball/DECISIONS.md`** carries the full tuning history (measurements, rejected approaches);
source files keep only guards and short notes with `// See DECISIONS.md#anchor`. Read it before
touching physics, geometry, or the swipe/power curve. Per-machine docs: `MACHINE-BRICKCITY.md`
(BRICK CITY, nothing about it is written up here), `MACHINE-RUNAWAY.md`, `MACHINE-SPEC.md`.

## What it is, and state

A realistic arcade skeeball alley (three.js + cannon-es), rebuilt from scratch 2026-08-13. Swipe up the
lane: swipe speed is power, angle is aim. Nine balls to a rack. Five machines: **THE CLASSIC**
(`classic`), **HOT SHOT** (`basketball`), **HOT SHOT: BRICK CITY** (`brickcity`), **HOT SHOT: RUNAWAY**
(`runaway`), **POPONGO** (`popongo`). Solo, plus "beat my score" challenges (2026-09-24).
- **ADMIN ONLY (`devOnly: true`, no `released` date) since 2026-08-23** (Matt's ask), after work for one
  machine changed another. Re-releasing is four edits and three stop it being silently broken: drop
  `devOnly` in `js/hub.js`; add a FRESH `released` date (only input to the New pill); put the
  `GAME_META` row back in `js/leaderboard-ui.js`; take `skeeball` out of `tools/players-agg.test.mjs`'s
  `OFF_THE_BOARD`. Miss the row and every Skeeball win counts as ZERO (how Yahtzee shipped).
- The stats id has REAL family history (live a few hours on 2026-08-11 under the previous build, which
  recorded into the same `skeeball` id and board id `classic`). `skeeball_old/` was removed 2026-08-18.
- **The swipe-to-aim curve is per board**: `ui.js` reads `geom.aimCurve` as the exponent on the swipe
  angle (unset = 2); only BRICK CITY sets it (1).
- The board was rebuilt to the REAL classic layout against Matt's reference photos after a first
  version invented a "bullseye" board from memory: `VISUAL-PROCESS.md`, look at the picture before you
  write code; if there is none, ask.

## HARD RULE: never change the width of a basket

Matt, 2026-08-24: **"NEVER CHANGE THE WIDTH OR DIAMETER OF A BASKET UNLESS I SPECIFICALLY TELL YOU TO."**
A basket's `r` in `js/boards.js` (so its mouth) is HIS number on every machine: not a default, not
re-derived from a proportion, not traded for a nicer sweep. If a change would move a mouth and he has
not asked, the change is wrong; find another way or ask. Depth, position, colour and paint are
ordinary work.
- **Do not invent a rule and quote it back at him** (a "depth-to-mouth ratio" he never mentioned).
  A measurement recorded by an earlier session is data, not a constraint on what he may ask for.
- Measure the two things before explaining the difference between them (read the numbers out of
  `boards.js` first).
- **Matt ALWAYS speaks in DIAMETER**; `r` in `geom.holes` is a RADIUS, so halve what he gives you.
  Rim check any rim change owes: `gap = 8.28in - (rim diameter + 0.33in)` must stay above the 3in ball.

## HARD RULE: every machine owns its own engine

Matt, 2026-08-23: *"It's absolutely insane you've been editing 1 file for different games and silently
changing other machines."* Each machine has its OWN `physics.js`, `machine.js`, `render.js` under
`skeeball/js/machines/<board-id>/` (classic, popongo, basketball, brickcity, runaway). `js/engines.js`
maps a board id to its files and is the only thing that knows they exist. **Editing one machine's
folder cannot affect another; the isolation is the filesystem. Gating by flag is NOT the answer.**
(A shared capture-rule change moved 456 of 861 throws on THE CLASSIC, 12,240 -> 6,870 points.)
- A genuine engine bug is fixed once per machine that has it and the copies drift; **the drift is the
  point.** In the commit, say which machines you applied it to and which you deliberately did not.
- **Adding a machine:** `cp -r machines/classic machines/<id>`; add a row to `engines.js`; add the three
  files to `sw.js`'s `ASSETS` and bump `CACHE`; add the `boards.js` entry (frozen `id`, marquee `name`
  untranslated, `taglineKey` + `{en,es}`, `look`, `geom`, `unlock: { board: '<previous id>', ... }`).
  Obey `geom`'s spacing rule, re-run the sweep. **Read `MACHINE-SPEC.md` Part 7 first**;
  `tools/test-skeeball-machine-spec.mjs` enforces `perf.context`, `perf.probe`, `perf.shadow`,
  `perf.textures`, `perf.broadphase`. **Keep your `THREE.WebGLRenderer` in `this.renderer`**
  (`releaseRenderer()` calls `r.renderer.forceContextLoss()` by that name or you leak a context per rack).
  `ui.js` needs nothing; update this file's header.
- **Still shared** (`boards.js`, `game.js`, `goals.js`, `ui.js`): a change there reaches every machine.
  Before committing one, simulate a fixed grid (41 powers x 21 aims) on each machine before and after
  and diff the outcomes; a machine you did not mean to touch must come back identical.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../skeeball/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `skeeball` |
| Stats id | `skeeball` (`recordSkeeball`, sub-counter `sk`) — **pre-existing, frozen** |
| CSS root / prefix | `.sk-root` / `.sk-` |
| Settings key | `gamehub.skeeball.v1` (one preference: the selected machine) |
| Other keys | `gamehub.skeeball.save.v1` (legacy snapshot, see "No Resume"), `.lockpop.v1`, `.ceremonyowed.v1`, `.top.v1` (display cache), IndexedDB picstore |
| Difficulty axis | none — `byDiff` is keyed by BOARD ID |
| `isInProgress()` | always `false` (leaving IS the end of the rack and costs nothing) |

`immersive`: `.sk-root` is `position: fixed; inset: 0; z-index: 1`; `.sk-hud` has `padding-left: 76px`
and the gallery `padding-top: 84px` to clear the hub chip.

## Files

| File | Role |
|---|---|
| `js/vendor/` | vendored cannon-es 0.20.0 + three.js r185 (Matt's explicit instruction 2026-08-13: *"vendor cannon-es and rebuild it on that... FIND AND USE IT"*). Committed, no build, in `sw.js` ASSETS. **Never hand-edit; upgrade via `npm pack` and copy dist** |
| `js/machines/<id>/machine.js` | that machine's GEOMETRY in metres, once; physics builds bodies from it and render builds meshes from it |
| `js/machines/<id>/physics.js` / `render.js` | cannon-es ball sim (deterministic, no rng) / three.js scene |
| `js/engines.js` | board id -> `{ physics, buildMachine, Renderer }`, loaded ON DEMAND (`loadEngine(id, { physics })`); `engineFor(id)` is synchronous and THROWS if not loaded (never falls back to the classic: substituting physics is the exact failure the HARD RULE prevents) |
| `js/boards.js` | machine registry: identity, look, `geom` block, unlock chain. Pure |
| `js/game.js` | rack rules: nine balls, scoring, events, recorder payload. Pure |
| `js/goals.js`, `js/howto.js`, `js/strings.js` | objectives, How To Play content, EN/ES |
| `js/ui.js`, `js/swipe.js` | DOM shell, swipe, records panel, hub module contract |
| `js/picstore.js` | IndexedDB machine-picture cache |
| `js/challenge.js`, `challenge-ui.js`, `alert.js` | challenges (data, screens, launcher bubble); `functions/decide.js` `decideSkee` = push |
| `js/test.js` | headless engine tests |

`machine.js`, `physics.js`, `boards.js`, `game.js` are DOM-free (load-bearing: node plays hundreds of throws).
`window.__skTest` (set in `init()`) is the read-only hook for headless drivers; the game never uses it.

## Setup screen and How To Play

Follow the documented references EXACTLY (Matt threw out two taste-based designs): setup follows
Escoba's order (title, stats line Best/Today/Top/Last, a collapsed `.gh-acc` "Machine" row with each
unlocked machine a card with four records, How-to-play link, ONE primary action) on `css/ui.css`'s
`.gh-*` primitives; How To Play follows `docs/BUILDING-A-GAME.md`'s five-part pattern (diagram: swipe
strength = landing height, three arcs told apart by dash AND numbered markers; "Half strength = the 50
cup"; every line measured onto ONE row by `_fitHelpLines`). **`skeeball.css` is two skins on purpose**
(setup/how-to: hub-light `--sks-*` tokens with `:root.gh-dark`; PLAY: warm dark arcade in both themes). Do
not unify them. Machine names are proper nouns, untranslated.

## The machine and its physics (cannon-es since 2026-08-13)

- **Real geometry** (lane, hump quarter-pipe, trough, tilted board, ring band, collars, rails, backboard,
  cage, glass, kick panel). Feel lives in `boards.js` `geom` and the ContactMaterials at the top of
  `physics.js`. Nothing scripts a reaction.
- **Hole capture is the one non-engine rule**: centre over an opening at face level AND slow enough to
  drop in (pure kinematics: in the time to cross the mouth, does it fall past the lip?) drops the board
  slab from its collision mask and GRAVITY takes it through. **CAPTURE IS A PREDICTION; ONLY PASSING
  THROUGH THE PLANE SCORES** (commit only when below the surface plane INSIDE the mouth; otherwise
  floor restored, `rimout`). A ball whose CENTRE is below the rim plane inside the mouth captures at
  any rattle speed. Points only for a ball that fully passes through.
- **The trough scores like the real slot**: centre band 10, corners 0.
- **NO MAGNETISM, EVER. A standing, permanent ban.** Balls are never curved toward holes or assisted
  (a "dish" was deleted 2026-08-14). Widen a power band in the GEOMETRY. Input shaping (swipe -> power/
  aim in `ui.js`) is fair game; the ball, once thrown, is not. A jammed ball scores ZERO and is gone
  (Matt, 2026-08-22), never walked into a cup.
- **The 100s are corner holes reached by AIMING** (aim >= ~0.9 at power >= 0.70).
- **The spacing rule** (`boards.js`): every gap between furniture is MERGED or wider than a ball plus
  margin. An in-between gap is a pocket and a three-contact pocket LOCKS the solver. A collar near a
  FLAT wall is a pocket even at zero gap: keep >= 0.78X wall gaps.
- **The watchdog** is displacement-anchored (never speed alone); speed is only a veto.
- Deterministic: fixed 1/240 step, fixed iterations, no rng; one fresh world per throw. Run `node
  skeeball/js/test.js` (see Testing) and `tools/tune-ladder.mjs` after touching `geom`; `tools/measure-reach.mjs`
  places holes on the measured reach curve (do not guess).
- If a future machine wants scatter, "thread a seeded rng through startThrow and keep simulateThrow
  deterministic - the test suite depends on it" (Hoops does exactly this).

## The 2026-08-14 rebuild: the camera, the throw, the cups, the trajectory

- **The camera stands BEHIND the ball** (0.42, 0.62); `resize()` derives the FOV from the two points that
  must always be visible (resting ball, marquee top). Never fit board width alone.
- **The ball FLIES. Read this before touching the ramp.** Launch angle must EXCEED `boardTilt` (range
  `R = 2 v² cos(t) sin(t − a) / (g cos²(a))`). Shape: launch 0.88 rad, six ramp segments (followable),
  ramp stays 0.30 long, and the BOARD is raised (`boardLipY` 0.07 -> 0.20) or the crest hides the 20 and
  10 (`tools/sight.mjs` must stay positive). **"Touched the scoring face" is not a virtue**; a metric pointing
  the wrong way was once optimised to 100%. Run `tools/measure-arc.mjs` after touching it.
- **Every number is painted on the BOARD** (stencilled into the field texture up-slope of its mouth,
  pre-stretched 1.9 along v); never a flat plate inside a curved wall.
- **The ball settles first, then the score**: `capture` only lights the rim; `+N`, burst and marquee wait
  for `ballDone`. **On a collared board the capture can be WRONG** (HOT SHOT breaks its prediction on
  28.8% of captures): `gutter` drops the pending capture, and a popup is drawn only when the ball
  finished in the hole it was predicted for, printing `ballDone`'s own value. `tools/test-skeeball-popup.mjs`.
- **The 2026-08-14 board rebuild (batches 3a/3b/3f) supersedes "The dial is a ladder"**: everything is a
  multiple of `X` (hole diameter); board 6.875x by 9.5x; three tangency rules (each hole touches its ring
  at ONE point, its bottom; 30-ring top touches 40-ring bottom; 40-ring top, 50-ring bottom, 20-ring top
  meet at one point). Matt's 4.875x diameter was kept and ring distance is 1.5x (his call, do not
  re-resolve). Cups are NOT flush: every ring is a WALL x tall; rings are not paint; a ring may hide its
  own mouth (his explicit OK, do not shrink rings or move the camera); the resting-position scoring rule
  is GONE. A ball must be `ringH + ballR` above the face on arrival; clearance at the 100s' row is NOT
  monotonic in speed: measure, never extrapolate. **Five `test.js` ladder-smoothness assertions are
  known-red for this board; do NOT loosen them.**

## POPONGO and the arrangement layer (2026-08-22)

- **Arrangement layer** (`boards.js`): SLOTS own geometry, CUPS own value/paint. Slot ids `top/uppL/uppR/
  midL/midC/midR/lowL/lowR/bot` and cup ids `g6`..`eqB` are FROZEN (they rode the old autosave; value
  frozen to id). Values stamped at module load; `game.js` scores through `cupAt()`. Player-facing
  rearrangement is deliberately deferred (Matt's call after he plays it).
- Deal re-dealt by measured difficulty 2026-08-27 (6 at `midL`, equalizer at `midR` and `top`, 4s at
  uppL/uppR, 2s lowL/lowR, 1s easy slots) and the ramp went to 70 degrees (`DECISIONS.md#popongo-
  rearrangement-and-the-70-degree-ramp-2026-08-27`). **Open: 84% of throws roll back to the trough.**
- **Equalizer** (`game.js _settle`): a black cup wipes what the previous ball EARNED this rack (never
  negative); `ballDone` carries `{eq, wiped}`. The PDF's "sticks between cups = 1 point" is NOT
  implemented (resting-position scoring is banned).
- **Goals are per-machine and count ONLY that machine's plays** (Matt: *"they should be completely
  distinct"*); `goals.js` `GOALS` map, each with `labelKey`/`defKey`. Only the classic's five-100s goal
  uses a global counter (`sk.hundreds`). POPONGO: all four colours in one rack (needs additive
  `sk.colorSweeps`, three edits done), 30+ in a game, 1,000 points.
- **Unlock is GOALS-BASED**: `{ board, goals: true }`, applied by `_earnedUnlocks` (after each rack) and
  `_ensureGoalUnlocks` (once per mount, retroactive, cross-device). `unlocksEarned()` stays score-only.
- Locked slide shows a CSS-cropped greyed sliver (`.sk-lock-peek`). **Dev bypass**: a dev profile ON AN ADMIN DEVICE
  (`isAdminDevice()`, 2026-10-29: a name alone is a hash anyone can type) sees every machine OPEN with a `TEST` chip.
- Ping-pong ball 0.28X (`ball.ratio` waived), cups 0.5625X, lattice t 1.63X / s 1.075X. Scoring on cup
  boards requires falling below the RIM plane (`needH`); a jammed ball resolves as the trough's zero
  (`st.cupBoard`). Renderer: collars take cup colour, value on `_cupPlate`; the classic's bottom-slot
  band is gated on `!board.cups`. Setup slides, game-over card, hub average are PER-BOARD numbers.
  **POPONGO is NOT given the back-wall scuff** (rescale first: its ball is 8.1 cm).

## HOT SHOT (2026-08-22)

- **Naming (settled 2026-08-24, do not "fix"):** displays as **HOT SHOT** (was BASKET FEVER); board id
  stays **`'basketball'`** and so does everything built on it (`sk.unlocked.basketball`, per-board bests,
  POPONGO's unlock parent, `dressing: 'basketball'`). A board id is not a display name (rule 5).
- **A real STAIRCASE** (`geom.steps`: three near-flat TREADS 2.475X/0.36 m leaning 0.10 rad toward the
  player, three VERTICAL risers 1.925X/0.28 m); face coordinates UNROLL (v runs up tread, riser, tread);
  `faceToWorld`/`worldToFace`/`tiltAt` are piecewise. **Risers are walls, never floors.** Each basket
  funnels into a hole in its TREAD, full-circle collar, mouth leans with its tread.
- **THE BASKETS SIT AT THE BACK OF EACH TREAD (0.75X from the back edge) — MATT'S EXPLICIT CALL
  2026-08-23, do not move them forward again** ("a horrible fix that creates significantly more
  problems"). Accepted: fast straight throws score via the wall. Small ball 0.28X waived; mouths 1.0X.
- Back wall `backboardH` 0.85, `deadRest` 0.32, `deadFric` 0.06, `wallRest` 0.15; ball is THE CLASSIC's
  0.75X diameter, back wall gets `backRest 0.60 / backFric 0`. Ramp 70 degrees, six steps.
- Rims: bottom/middle rows 4.25in, top 50s 4in, top 100 3.5in (check the gap rule above). Baskets are
  1.0X DEEP (**do not shallow the collar to "fix" scoring**; `boards.js` is the live copy). **DEPTH IS
  PER ROW** (*"all the hoops on a row should be the same height, regardless of the diameter"*; *"the top
  of the backboard should never go higher than the wall the basket is on"*).
- **Value cards are an ARCH, one size per row** (`absellipse`, `_backboardRow(ti)`, `TOP_REVEAL` 0.33in,
  `SIDE_GAP` 0.50in, width 1.5x widest rim clamped by pitch, `ARCH_MAX` 1.25). Matt: "I do not want the backboards to overlap each other.
  And I don't want them to ever be taller that the wall they're attached to." A semicircle's height IS half its width, so use an ellipse. **If you change this, RENDER
  IT AND LOOK.** Both `basketball` and `brickcity` carry it.
- Render: `dressing: 'basketball'` (orange wire basket, `_wireBasket`, white strands merged into ONE
  buffer per colour via `_mergedTubes`: do not go back to one mesh per wire; half-dome backboards bolted
  clear of the RIM; oak treads, blue risers; red neon from `railProfile`; yellow ball-return apron).
  **`_paintField`/`_paintLane` declare `SRGBColorSpace`** on HOT SHOT only (other machines' copies
  deliberately not changed). `colorSweep` is gated on `need > 1` (`game.js`).
- Goals (re-set 2026-08-25, total 20,000 on 2026-09-02): land in every basket (reads per-board `slots`),
  700+ in one game, 20,000 total. 20,000 not the 15,000 Matt wanted: a goal derives from the stored
  total, so a cut is retroactive (would hand an unlock for nothing). Read `sk.boards.basketball`.

## Four per-board counters (BRICK CITY, 2026-08-24/25)

`js/arcade-scores.js` per-board record, additive, default empty, per board on purpose: `slots` (SET of hole ids, merged by
union), `cleanRacks` (sum), `slotHits` (per-hole counts, sum), `perfectRacks` (sum). `game.js result()`
feeds them as `slotsHit`/`slotCounts`/`cleanRack`/`perfectRack`; slot fields list REAL holes only;
`cleanRack` gated on a penalty basket existing, `perfectRack` is not. `tools/test-stats-replay.mjs` scenarios
G and H prove old records load unchanged. BRICK CITY reads `slotHits`/`perfectRacks`; HOT SHOT reads `slots`.

## Where the three objectives sit (2026-08-24: one per rail, the total above the machine)

Signature goal in the left rail, single-game score in the right, **running total on a wide bar above the
machine, IN FLOW** (`.sk-gtotal-row`, a flex child between `.sk-rack` and `.sk-stage`). **Do not give this
bar `position: absolute` again**: a constant-offset bar sat across the marquee on staircase machines.
The renderer fits the machine to the stage height that is left; verified clear on all four at 375x667/
393x852/430x932. At 360px the rails leave ~207px: `max-width: 400px` shrinks to 11px (the repo floor);
**a longer third objective needs a re-measure** (nothing truncates).
- **An objective SAYS WHAT IT MEANS when you tap it**: `data-def` on every box, `_showGoalDefs` sheet,
  every goal has a `defKey`. Rails take taps (column `pointer-events: none`, only the box inside); the
  boxes end 193px above `.sk-swipe` (move rails or grow the box: re-measure both rects). The wide bar's
  hit area is 44px via a transparent `::after` overhang.
- **The objectives VANISH once the machine has nothing left to ask for** (decided ONCE in `_startGame`,
  `_goalsHidden = _goalsSpent()`; the ceremony keeps the boxes on screen then sets it itself). A TERMINAL
  machine is spent on all-three-met alone; anything unreadable answers NO. They stay reachable via a small
  **`Objectives ✓` chip** (`.sk-gdone`, `data-def` with NO id and no `data-goal`).

## The unlock ceremony (2026-08-25)

Third objective completes -> fireworks -> tiles turn gold, float to the middle, merge into a blob, shrink
to a point, a golden key grows out of it (all BEFORE the game-over card) -> the gallery lock pulses -> tap
-> key floats in, drives into the keyhole, turns, lock falls, sliver un-greys and GROWS into the machine
(3.7 s, `_popLock` and the `sk-lock-*` CSS timeline must stay in step).
- **THE ONE RULE: the key is theatre over an unlock already banked.** The earn writes `sk.unlocked` as
  always (`_rackOver` -> `_earnedUnlocks` -> `unlockSkeeballBoard`, additive); nothing in the ceremony
  grants anything.
- **`gamehub.skeeball.lockpop.v1`** (`{boardId: true}`, cosmetic) is ARMED by the ceremony and never
  backfilled; a wiped key can only SKIP a ceremony. `pending` requires `earned` (`_slideState`).
  `_slideState(b, sk, devAll)` is the single answer to "what is this slide" (testing/earned/released/
  pending/open).
- **Ceremony debt** `gamehub.skeeball.ceremonyowed.v1`: `_ensureGoalUnlocks` banks silently first, THEN
  arms the debt; `_checkOwedCeremony` (from `_checkGoalsNow`) fires when the round is on the PARENT machine,
  score > 0, `allGoalsMet` still true; debt cleared as the ceremony STARTS; `_goalsSpent()` answers NO
  while one is owed.
- Can fire on ball 3 while the unlock is banked at ball 9; nothing lost either way. **Silent under
  reduced motion**. **It ends on a TAP**, not a timer (`_showWhenQuiet` holds the card while `_ceremony`;
  60 s auto-dismiss backstop).
- Art `KEY_SVG`/`LOCK_SVG` in `ui.js`: the key is ONE path, `fill-rule="evenodd"`, aspect 106:58, teeth LEFT.
  Traps: expo-out easing, comma-separated `transform` animations (last `both` fill erases the others: ONE
  keyframe block) and `clip-path` growth (a WIPE); the key is pure scale, `linear`, paced by hand. Measure,
  don't eyeball. CSS timeline lives in one comment above `.sk-cer`; `ui.js` hands each tile its `--tx/--ty`.

## The records panel

Per machine: top score by ANY player (`readPlayersOnce()` -> `aggregatePlayers()` -> `appWideBest`; no shared
`highscores/` node), the player's best / best today (`bestOn`/`todayBestOn`), just rolled. "NEW BEST"
compares against what stood BEFORE the rack was recorded.

## Persistence and THE LAW

- **The Skeeball data in the store was TEST DATA (Matt, 2026-08-20) and was cleared 2026-08-22** by his
  request (`tools/clear-skeeball-stats.mjs`, full backup, re-read verified; every node with plays was Matt or
  MattyIce). **This does not license deleting anything**: never delete player data without Matt asking in
  so many words. The server half is not the whole job (`syncMyStats()` re-uploads any device's local
  store); the dev-only "Reset Skeeball stats" button is the device half.
- Stats id `skeeball` and sub-counter `sk` carry real history. `recordSkeeball(boardId, { score, balls,
  hundreds, fifties, bestThrow, at })` is called exactly ONCE per finished rack (`recorded` guard; writes
  are additive so a double call silently inflates). `byDiff` buckets by board id; the first machine's id
  is **`classic`** (also `recordSkeeball`'s fallback), frozen (rule 5). Rename display names freely,
  never ids.
- Per-machine records and unlocks ride `sk.boards`/`sk.unlocked` via `js/arcade-scores.js` (counters add,
  bests `Math.max`, each DAY the max, unlocks union). Frozen vs-computer fields `sk.won/lost/tied`:
  never incremented, never cleared, still shown by My Stats when non-zero.
- This game's own keys hold nothing earned. Item 7's three edits predate the rewrite; `tools/players-agg.test.mjs`
  carries the regression case. The My Stats tab is deliberately PRESENT and not devOnly (rule 1: family
  may have real plays from the hours the old build was live). The leaderboard row is OUT (no `GAME_META`
  entry; `skeeball` in `OFF_THE_BOARD`) while admin-only; nothing was lost, every play stays in each
  device's store and in `players/`.

## Releasing a machine from the admin page (2026-08-24)

Admin page (`js/admin-ui.js`, Matt only) sets a machine to **Open** (everyone, no unlock), **Unlockable**
(everyone who earns it) or **Testing** (dev profile only); `adminOnly` in `boards.js` is only the CODE
DEFAULT for Testing, resolved by `isBoardTesting(b.id, !!b.adminOnly)`. **Both unlock writers
(`_earnedUnlocks`, `_ensureGoalUnlocks`) consult it** and skip a Testing machine. The three `ui.js` gates:
`testing = isBoardTesting(...)`; `earned = !testing && isUnlocked(sk, b.id, DEFAULT_BOARD)`; `open = devAll
|| earned || (!testing && isBoardReleased(b.id))`. **It is an OR and the earned half is the player's own
store**: a release grants nothing permanent; Testing DECLINES TO HONOR an unlock while set and never
deletes it (rule 2). It never writes (`unlockSkeeballBoard()` only from real objective completion), and is
separate from the dev bypass. `tools/test-admin-config.mjs` asserts the three sites, both writers, no direct
`b.adminOnly` read, and no `isBoardReleased` near an unlock write.

## The unlock chain

```
THE CLASSIC -> HOT SHOT -> HOT SHOT: BRICK CITY -> HOT SHOT: RUNAWAY -> POPONGO
(always open)  (classic's   (hot shot's            (brick city's         (runaway's
                objectives)  objectives)            objectives)           objectives)
```
Every step is a goals unlock (`{ board, goals: true }`). **`js/boards.js` entries are the source of truth;
change the chain here and in `boards.js` and nowhere else** (per-machine sections describe FACES). RUNAWAY
and POPONGO swapped 2026-08-27 (Matt: *"Make runaway before popongo, duh"*; POPONGO is the TERMINAL
machine, `_goalsSpent()` asks whether a machine opens anything). **The GALLERY order is the `BOARDS`
array's order** (fixed 2026-09-02; `SK_MACHINES` in `js/game-stats-ui.js` is in the same order); nothing
derives an unlock from either list. Re-pointing the chain took nothing from anyone (rule 2: `sk.unlocked`
is an additive union set); `tools/test-stats-replay.mjs` scenario G carries the chain as data and replays real
records.

## The moving basket, and the one-shot face (2026-08-25, rebuilt 2026-08-26, HOT SHOT: RUNAWAY)

The first moving part in the repo. `runaway` opens with two still 100s on tread 3; landing in one CLOSES it
while its twin sweeps the width, and every basket landed in then closes too. Full record:
`MACHINE-RUNAWAY.md`.
- **Motion is pure functions in `js/machines/runaway/machine.js`** (`sweepU`, `sweepVel`, `holeU`,
  `holeVel`, `holeOffset`); no state, no clock, no `Date.now()`. `sweeps` is the rack state. **Never write
  a second copy.**
- **A moving collar is a KINEMATIC body, never a static one whose position you rewrite** (static body =
  velocity 0 = a teleporting wall). Set position AND velocity every substep. Both baskets that COULD move
  get kinematic bodies from the first frame (cannon-es cannot change type after build).
- **Capture against a moving mouth is measured RELATIVE TO THE MOUTH and latches on commit** (else a
  resting ball is swallowed by a passing mouth = magnet; or a sliding basket re-scores a 100 as a gutter).
- **CLOSING A BASKET IS TWO THINGS AND NEEDS BOTH**: `physics.js` does not build its collar AND the capture
  loop skips it (only the second = a bowl the ball can never leave).
- **`js/game.js` carries `machineT`, `closed`, `sweep`; `sweep` is SHARED BY REFERENCE** among two live
  sims and the renderer: mutate in place, never swap in a fresh one while a ball is live. `game.js` stays
  pure (accumulates the `dt` handed to `update()`). All three ride the autosave as ADDITIVE keys, inert on
  other machines; an old save resumes with a fresh face; `closed` is read back against the board's holes.
- **Reachability needs THREE axes** (power x aim x phase): `tools/sweep-mover.mjs` (`--stage open|run|endgame`,
  `--rung N`, `--ladder`, `--stage rows`) and `tools/test-runaway-capped.mjs`; re-run both after ANY change to
  that face, amplitude, ladder or materials.
- A moving basket needs its shelf to itself (a row's survivor moves only once every other basket in the
  row has CLOSED, and a closed basket has no collar). **The spec test's spacing rule exempts a pair only
  when both are in the SAME group**, not merely both movable. The lower rows' wall gap is already 0.7538X
  vs the spec's 0.78X; measured clean (0 walkouts), the sweep is the evidence.
- **A closed basket must be FLUSH** (a moving collar sweeps over it). **Nothing lying flat on this face
  can be seen**: signal a closed basket by its BACKBOARD left standing with no hoop; never paint flat on a
  tread.

## Testing racks, and voided scores (2026-08-24)

**A machine in Testing records to `sk.practice`**: `_rackOver` resolves `isBoardTesting` at record time and
passes `practice: true`; `recordSkeeball` then writes only `sk.practice.boards.<id>` and returns before
`bumpTotals`, lifetime counters, bests and unlock. Kept and shown as "Practice (not counted)" in My Stats
(rule 1). **Voided scores** are an admin overlay (`js/CLAUDE.md`, "Score corrections"): `myRecords()` runs
the board through `correctBoard()`; `appWideBest` is fed by `aggregatePlayers(..., corrections())`.

## Frame rate: why it got slower the longer you played (2026-08-26)

A dead-flat 100 ms canvas repaint was a THROTTLE, not CPU. Five causes, measured in a real browser:
1. **Every Renderer leaked its WebGL context** (`dispose()` leaves the context; only `forceContextLoss()`
   frees it; 16-context cap, 2 leaked per rack). `releaseRenderer(r)` in `ui.js` (dispose then
   `forceContextLoss()`, guarded) at all five teardown sites; it lives in `ui.js` on purpose (the budget
   is the PAGE's; the gallery builds every machine's picture first). The software-GL probe in each
   `render.js` is `isSoftGL()`, memoised per page, released through `WEBGL_lose_context` (the same edit
   in all five files: a resource bug, not engine sync).
2. **The render loop ran 2-4x**: `_startLoop()` is THE ONLY WAY the loop starts (idempotent,
   `if (this.raf) return`); `_frame` returns without re-arming when `this.disposed`. The pause sheet now
   actually pauses (`_showPause` stops the loop, `close()` starts it); game-over card and how-to keep
   rendering. The autosave-less frozen ball is handed back still owed (rule 2).
3. **Shadow map re-rendered every frame** (BRICK CITY): `shadowMap.autoUpdate = false`, `needsUpdate` for
   frames a caster moved; **gate on `live.length`, not `used`**; `used` CHANGING still counts.
4. **Every scoring popup leaked its texture** (BRICK CITY): `Material.dispose()` does not dispose
   textures; **dispose `.map` whenever you dispose a material here.** Burst particles too.
5. **Broadphase tested 20,100 pairs to find 200** (BRICK CITY): `BallBroadphase` walks the ball's own
   pairs in NaiveBroadphase's exact order (the solver depends on order); falls back to naive unless
   exactly one non-static body. Proven 861 throws, 0 differ.
- Not kept: MSAA off at dpr >= 2 (changes the outline; comment in `render.js`).
- **Scope vs the HARD RULE:** 1 and 2 are shared (`ui.js` + the probe helper); **3, 4, 5 are per-machine
  and NOT to be carried across "to keep them in sync".** RUNAWAY got 3, 4, 5 on 2026-08-27 with two
  differences: its broadphase guard counts DYNAMIC bodies (all its collars are KINEMATIC; **widen any
  machine body's mask and that stops being safe**; every machine body carries `collisionFilterMask:
  GROUP_BALL`), and **a SWEEPING BASKET DOES NOT CAST A SHADOW** (shadow pass fires once on each
  transition). **THE CLASSIC, POPONGO and HOT SHOT still leak popup textures and run the naive
  broadphase.**
- `node skeeball/js/test.js --full` finishes with one red (THE CLASSIC's "missing the corner costs the
  ball"), identical on a clean main; do not blame your diff.

## The ball stuck IN a BRICK CITY penalty basket (2026-08-26) - an invisible ledge, put there by machine.js

Collar boxes were placed by `faceToWorld` through `frameAt(v)`; the bottom row's two rearmost segments
had `pv` 0.3031 past the first tread's back edge 0.3000 and landed in the RISER's frame: a 5 cm bar
across the throat of every -20/-10/-20 basket, invisible (render skips `cupSeg` boxes). Also
`worldToFace` returns the NEAREST segment, so deep in a bottom-row basket it resolved to a riser frame.
**Both fixes are one sentence: ask each hole's question in THAT HOLE'S OWN frame** (`faceToWorldIn(fr,
u, v, h)` / `worldToFaceIn(fr, p)`; collar loop resolves `frameAt(H.v)` once per hole; `physics.js`
sections 1 and 2 use the hole's frame). **On a staircase, cross-check in world coordinates.** The 0.6 s
stall watchdog stays (it covers a ball parked on a TREAD); shortening it was the wrong fix. 10 of 12 moved
outcomes were against the player (the fix working). `node tools/test-brickcity-stall.mjs` (structural +
behavioural, born red).

## BRICK CITY: nothing held a ball in the basket it fell into (2026-09-04)

All in `machines/brickcity/physics.js`: (1) capture took the floor AND (since THE NET, 2026-09-02) the
collar, so nothing held the ball: **a THROAT** (mouth continued down through the tread, radius `r +
ballR`, on its OWN collision bit `throatBit` switched on by capture and off by rimout, running from the
RIM down, skipped by render); (2) rimout handed the floor back under a ball still inside the collar
(+10.4 m/s in one step): a rimout now needs the ball **wholly above the rim** (`fc.h > collarH + ballR *
1.05`), plus a **solver-artefact ceiling at `1.5 x maxSpeed`** (`st.clamped` should stay zero); (3) the
watchdog killed rolling balls: displacement anchor stays primary, **speed is only a VETO**, `anchor.t0`
bounds it (kills 77 -> 8). BRICK CITY only; no basket moved or resized. `node tools/test-brickcity-throat.mjs`
(born red 13/16; deliberately NOT in `tools/run-all-tests.mjs`, ~3.5 min), `tools/test-brickcity-corner100.mjs`,
`tools/test-brickcity-stall.mjs`, `tools/test-skeeball-capture-frame.mjs` stay green.

## The capture blind spot, closed on every machine (2026-08-26)

The `worldToFace` nearest-segment blind spot hit every stepped machine; HOT SHOT and RUNAWAY were fixed
separately per the HARD RULE (adds `worldToFaceIn` to `machine.js`, four lines in `physics.js` sections 1-2).
`tools/test-skeeball-capture-frame.mjs` is geometric (not a sweep), discovers machines from `BOARDS`, and has an
EMPTY `KNOWN_GAPS` (fails if an entry outlives its bug). RUNAWAY's mover still measures against
`holeU(G, id, t)` and the latched `st.capturedU`.

## The rack resumed on the wrong machine's engine (2026-09-01)

`_startGame` must resolve its board from the snapshot: `boardById(snap && snap.board ? snap.board :
this.settings.board)`; `restore()` resolves through the same `boardById`. A mount that throws lands on the
gallery (`_startGameInner`, caller catches, logs loudly, `_renderSetup()`). `skeeball/js/test.js` has a
`[KNOWN-BUG PROBE]` pair; `tools/test-visual.mjs` re-mounts in place (a reload would wipe `*.save.*` keys).

## The gallery drew each machine only when you reached it (2026-09-01)

- `MACHINE_IMG` cache is MODULE scope (cap 16, oldest evicted; key = board + every record baked in, so a
  stale picture cannot be served). `_prewarmNeighbours` draws the two neighbours at idle: NEIGHBOURS
  ONLY, STRICTLY SEQUENTIAL (never `Promise.all`: WebGL context budget), SETUP SCREEN ONLY (cancelled
  on `destroy()` and at the top of `_startGameInner`). A slide being drawn shows a quiet skeleton
  (`[data-painting]`, NOT animated; cleared only on success). `_machinesWorthPainting()` paints the
  selected slide.
- **`this.top` is seeded from `TOP_KEY` (`gamehub.skeeball.top.v1`)**: a display cache of other people's
  records, nothing scores/records/unlocks from it; **the live answer REPLACES it with deliberately no
  `Math.max`** (an admin void must be able to bring a record DOWN); an unanswered read (`answered` =
  `rows.length > 0`) never overwrites or is written back.
- `tools/measure-gallery.mjs` counts renders (1 of 5 slides painted -> 3; swiping 1 -> 0 renders; re-entry
  1 -> 0). Guarantee is ONE MACHINE AHEAD. `tools/test-visual.mjs` asserts a second slide is drawn without
  touching the carousel (bar `>= 2`).

## The machine picture survives the page now (2026-09-02)

`js/picstore.js` writes the picture to IndexedDB. EXACT KEY: painted as final, render skipped. OLDER KEY:
painted provisionally, replaced when the fresh render lands. **NOT localStorage** (`test.js` asserts the
module never touches it); it is a cache only (every path guarded, resolves null); **the read is
deadline-bounded (300 ms)** and a late hit never paints over a landed render; **`PIC_V` is the
invalidator: bump it whenever a session changes how a machine is DRAWN.**

## What tapping Skeeball used to cost (2026-09-01)

The module graph was 2,318 KB, re-downloaded every open, with five WebGL contexts drawn up front. Now:
**`engines.js` loads a machine's files on demand** (`loadEngine(id, { physics: false })` for pictures; the
carousel's settle handler warms physics); **the gallery draws ONE machine at a time**; **`ensureCSS()`
resolves when stylesheets have parsed** (root hidden by INLINE `visibility`, capped at `CSS_WAIT_CAP_MS`;
a 404 must never leave a blank rectangle; matches an existing `<link>` by resolved href); **`sw.js` serves
the REST tier cache-first** (root `CLAUDE.md`). Six node scripts `await loadEngine(...)` before `engineFor`
at module scope (`js/test.js`, `tools/sweep-mover.mjs`, `tools/test-brickcity-stall.mjs`, `tools/test-runaway-capped.mjs`,
`tools/test-skeeball-capture-frame.mjs`, `tools/test-skeeball-machine-spec.mjs`); a new one must too. Caveat,
accepted: the first hub load after a deploy may run the PREVIOUS build of a game opened before
`warmRest()` reaches it (~15 s).

## Testing

- `node skeeball/js/test.js` — 50 assertions at `--full`, 20 without. Heavy blocks are grouped:
  ```bash
  node skeeball/js/test.js          # cheap half only (what tools/run-all-tests.mjs runs)
  node skeeball/js/test.js --auto   # groups from what differs from origin/main
  node skeeball/js/test.js --mat    # or --reach --dial --ramp --holes
  node skeeball/js/test.js --full   # everything, minutes
  ```
  `reach` (41x21 sweep, settle cap, walkout rate) and `dial` answer to any physical change; `ramp` to
  ramp/lane/throw speeds; `mat` to bounce and grip; `holes` (statistical symmetry) to hole positions.
  Always run: determinism, nine-ball rules, recorder payload, snapshot/restore, unlock chain.
  **The old "harder-goes-further quarter-by-quarter" assertion was deleted 2026-08-21: do not re-add it.**
- `node tools/test-game-conventions.mjs`; `node tools/test-visual.mjs skeeball` (PLAY probe swipes real racks).
  **The PLAY probe is FLAKY, measured (2 of 3 on untouched main): "threw a full rack and the rack-over
  sheet never appeared" — re-run before believing it; a DIFFERENT failure message is real.**
- Others: `tools/test-skeeball-popup.mjs`, `tools/test-skeeball-capture-frame.mjs`, `tools/test-skeeball-machine-spec.mjs`,
  `test-brickcity-*.mjs`, `tools/test-runaway-capped.mjs`, `tools/sweep-mover.mjs`, `tools/measure-gallery.mjs`,
  `tools/tune-ladder.mjs`, `tools/measure-arc.mjs`, `tools/sight.mjs`, `tools/measure-reach.mjs`, `tools/test-skee-challenge.mjs`,
  `tools/test-admin-config.mjs`, `tools/test-stats-replay.mjs`.

## Things a future session will want to know

- **No sound, no audio layer** (Matt on Pinball, 2026-08-11: "Delete the sound option. No sound."). Nothing
  constructs an AudioContext (root `CLAUDE.md`: NO SOUND, EVER).
- The swipe takes **the faster of the release flick and the whole gesture** (`swipeSpeed()` in
  `js/swipe.js`); power normalises against stage height. **Samples are clocked with `e.timeStamp`, never
  `performance.now()`** (handlers run late and bunched under load).
- **Three WebGL lessons** (commented in `render.js`): a `position:absolute` canvas is a REPLACED element,
  `setSize(w, h, true)` must set the style; software GL (SwiftShader) is detected up front and sheds
  shadows/AA/resolution; `preserveDrawingBuffer: true` stays on (test-visual and Report a bug read the
  canvas).

## No Resume, and the carousel lands centred (2026-09-03)

**There is no Resume button** (Matt: *"you either finish or quit"*). The pause card's Resume (un-pause)
STAYS. **The carousel steps by the slide's own resting place** (`offsetLeft`, not `clientWidth`: slides
rest at 0/355/710/1065/1420 on a 375px phone with a 12px gap), a settle handler re-snaps after 140 ms
quiet, and the arrows move the selection directly (`applyIndex`).

## The rack ends when you leave, and the wall scuff got quiet (2026-09-03, second pass)

**There is no mid-rack snapshot**: `loadSave`/`writeSave` are gone; opening Skeeball always lands on the
machines. **A rack you walk out of is RECORDED, then over**: `_abandonRack()` is `_rackOver`'s recording
half (same `recordSkeeball` on the same `game.result()`), run from the pause card's **Quit**, **New game**
and from **`destroy()`**. `this.recorded` is the one-shot both paths share. A rack with nothing thrown
records nothing. `clearSave()` is KEPT as a sweep for old snapshots; the key is never repurposed (rule 5).
**The wall mark is a scuff**: a decal quad lying IN the back wall only (never side walls), first contact
once, soft near-black falling to 0, 11.5-17 cm, 2.0 s, `transparent`, `depthWrite: false`, `polygonOffset`.
Matt: *"Isn't there a way you can look online for the norms... before you just add stuff?"* Look it up.

## The back-wall scuff, on three machines now (2026-09-03)

BRICK CITY, HOT SHOT, RUNAWAY (copies, per the HARD RULE). Four pieces: (1) `physics.js` `wallMarked` flag
+ one emit on the FIRST `backboard` contact over 0.1 m/s (READ-ONLY); (2) `ui.js` `case 'wall'` asks
`typeof Rr.wallMarkAt === 'function'` first so a machine without the renderer half ignores it; (3)
`render.js` `WALL_MARK_LIFE`, `_wallMarks`, `_scuffTexture()`, `wallMarkAt()`, fade block, shadow-gate
entry, one `dispose()` line; (4) nothing else. **Re-measure the wall's own brightness per machine** (mark
`rgba(214,203,186)`). RUNAWAY's shadow gate is `live.length || used !== _shadowBalls || movers !==
_shadowMovers || _celebrateT` and it disposes through `disposeMat()`. POPONGO deliberately NOT done.

## Challenges: "beat my score" (2026-09-24, v2 the same day)

Matt: *"challenge someone to a game for the higher score?"*; *"You should not get to try again. It's 1
attempt only."*; *"send their score as is if they leave in the middle of a game."* Files: `js/challenge.js`
(`skeeChallenges/games/<id>` + `skeeChallenges/index/<CODE>/<id>`, validation, `decide`, rows, expiry, seen
map, per-game outbox; reuses `hoops4/js/mp.js` player-code helpers and `opponentsFrom`),
`js/challenge-ui.js`, `js/alert.js`, `functions/decide.js` `decideSkee`.
- **Formats:** 1, 3 or 5 games on one machine, or **All machines** (one game on every machine both can
  play); with more than one game the challenger picks **Most wins** (tied game counts for nobody; level on
  games goes to higher total; level on both = draw) or **Total score**.
- **TURNS ALTERNATE, ONE GAME PER TURN** (Matt: *"You have to alternate games - seeing each others
  scores"*): `nextStage()` passes the turn after every game; each hand-over gets its own 3 days (`expires`
  re-stamped); `decide()` ends most-wins the moment one side cannot be caught; a TOTAL settles only when
  both played every game. Each hand-over notifies; the result notifies whoever did NOT play the last game.
- **The result is RE-DERIVED on read, never trusted from storage** (`validateChallenge`, `rowResult`): a
  stored `winner: null` is DROPPED by Firebase, so a draw and a missing winner look identical on disk.
- **ONE ATTEMPT, LEAVING COUNTS, three layers:** (1) committed before the first ball (`_startGameInner`
  calls `CH.beginLeg` after the engine loaded; outbox entry score 0; `beginLeg` refuses a game with one);
  (2) saved after every ball (`_saveChallengeProgress`); (3) finalised on `_rackOver`, `_abandonRack`
  (BEFORE its nothing-thrown return: Play-then-leave counts 0), or `CH.finalizeStale()` on next mount. The
  server refuses a second score (`already-played`); the outbox is keyed challenge + SIDE + game (`not-yours`
  retryable); the pause card offers no New game during a challenge. **Since 2026-10-29 also on the SERVER**:
  `claimLeg` writes a write-once marker `games/<id>/<side>/started/<leg>` = `{at, k}` before the first ball (another
  storage cannot start it, "Started on another device."; never offline); no score 30 min after the marker = 0 on every
  phone (`START_GRACE_MS`, derived on read, stored by the next write, `settleTimedOut`).
- Racks are ordinary racks, **but `recordSkeeball(..., {challenge: true})` never writes `sk.unlocked`, a challenge rack
  runs no objective unlock, and objectives open the next machine only from one the player owns (`_ownsMachine`)**
  (2026-10-29: a challenge on a locked machine used to unlock it for good); challenge adds nothing else to `gamehub.stats`
  (counting wins = a new sub-counter and item 7). **Machines offered = `challengeBoards`: every machine
  the CHALLENGER can play, never one in Testing** (Matt's choice 2026-09-24); the other person plays it
  even if locked, and playing never writes `sk.unlocked`. Writes verified by fresh re-read; a dev origin
  never writes (`gamehub.devAllowSync.v1`); nothing deleted. `openChallenges(ui, { seed, seedGame })` and
  `__setBootForTest` are test seams only.
- **Cancel, decline, resign (2026-10-13)**, root `CLAUDE.md`, "Cancel, decline, resign, expire": the
  challenge page has **Cancel challenge**/**Decline challenge** while the other person has no score in
  (`isOpen`, `cancelChallenge`: `over: { winner: 'none', why }`) and **Resign** after (`resignChallenge`:
  `over: { winner: <other>, why: 'resign' }`, never re-derived from scores). Stored on rows as `over:
  false` + `ended` (else `decideSkee` pushes "it's a tie"), so no push is sent; a cancelled/declined
  challenge raises no bubble; per-turn 3-day expiry unchanged.
- **Rules PUBLISHED by Matt 2026-09-24; `skeeChallengePush` DEPLOYED by Matt 2026-09-25.** Nothing
  outstanding; a later `functions/` change needs his `firebase deploy --only functions`.
- Tests: `node tools/test-skee-challenge.mjs` (70).

## Quick chat (2026-10-14)

Chat button on every challenge (`_chatMount`/`_chatUnmount`/`_chatPlace`/`_chatDockTo` in `js/ui.js`;
`viewMatch` in `challenge-ui.js`): on the challenge page, during a challenge game and on the card after
it; gone on the gallery, list and ordinary racks. Panel `js/match-chat-ui.js`, data `js/match-chat.js`.
- **Its own host on `<body>`** (`.sk-chat-host`, fixed, z 5, `pointer-events: none`), NOT in `this.root`
  (screens rebuild with `root.innerHTML`; challenge sheets are z 60).
- Sits in the empty top row left of the menu button (`right: 64px`; 390x844 at [282,59,44,44]); on a
  challenge card it DOCKS 4px left of the card's close X (`_chatDockTo`; 320x568 [204,52]); card titles
  leave room (`sk-ch-title--chat`, `.sk-ch-over .sk-over-title`).
- Node: `skeeChallenges/chat/<challengeId>/<key>` (`CH.NODE`), sent with the STORED side from `CH.sideOf`.

## Challenges: 7 days, then forfeit (2026-10-29)

- 7 days, then forfeit: an ANSWERED challenge whose 3 days ran out on or after 2026-10-29 no longer expires: the player on turn has 7 days from the hand-over, then loses (`forfeitDeadline`, `isTimedOut`, `withTimeout` in `readChallenge`; rows `ff`; "Timed out"). Unanswered ones still expire at 3 days; one expired before stays expired. Skeeball challenges record no stats, so no id is noted.

## Challenge racks feed no objective (2026-10-29, second pass)

A challenge rack is recorded and shown like any rack, and beside it `sk.chg` (its share of the global goal counters) and `sk.chk[machine]` (that machine's record before its first challenge rack, plus every other rack since). Objectives read `goals.js goalStore()`, the record without challenge racks, so they cannot pre-earn the next machine. Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29 (second pass)"; `node tools/test-puzzle-holes.mjs [--browser]`.
