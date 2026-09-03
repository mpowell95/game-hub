# Golf — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below
> overrides them. The field this game actually touches is `gf`/`gf.practice` inside
> `js/game-stats.js`'s per-player store — read "Stats and the practice bucket" below before
> changing `recordGolf` or `ensureGf`.

A 3D physics golf game (cannon-es + three.js), built to `GOLF-HANDOFF.md` across eight parts
(2026-09-02). Nine holes, one course so far (Harbor Links). Aim, power and spin are each set by
tapping a "stop the bar" meter mid-sweep; the ball's flight runs through a real rigid-body
simulation, not a lookup table. Modified Stableford scoring. Solo — no opponent.

The spec this game is built to is **`golf/docs/GOLF-HANDOFF.md`** (moved into the repo 2026-09-03;
it and `golf/docs/GOLF-PART9.md` are the copies to read and update). Full build history, every
physics-tuning number and why it landed there, every course-target
move, and the Part-by-part reports live in **`golf/DECISIONS.md`** — this file is the standing
reference for a session working in this folder, not a rebuild of that log. Read `DECISIONS.md`
before changing anything the sections below flag as tuned/frozen/decided.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../golf/js/ui.js'`, `immersive: true`, hub id `golf` (§14 of the handoff) |
| Stats id | `golf` (recorder `recordGolf`, sub-counter `gf`) |
| CSS root / prefix | `.gf-root` / `.gf-` |
| Settings key | `gamehub.golf.v1` — `{ difficulty, lastCourse, round }` |
| Strings | `golf/js/strings.js` (EN/ES, `makeT`); shared-file `gs_golf_*`/`lb_unit_points`/`game_title_golf` keys are in `js/strings.js`, not here |
| `released` | **unset on purpose.** Part 8 ships with the GAME LIVE but the one course in admin-config's TESTING state (see below) — `released` gets a real date the day Matt flips Harbor Links to Open, not before. Setting it now would badge a game nobody but the dev profile can actually play. |

**`.gf-root` is ONE persistent wrapper**, created once in `GolfGame`'s constructor and never
recreated — `_renderSetup()`/`_enterPlay()`/`_showRoundSummary()` each clear and rebuild its
CHILD content only. Putting `.gf-root` and a screen class (`.gf-setup`/`.gf-play`) on the SAME
element was tried first and is wrong: `golf.css` uses the repo's descendant-scoping convention
(`.gf-root .gf-setup`), which never matches two classes on one node. See
`DECISIONS.md#part4-scope`.

**`isInProgress()` always returns `false`.** Leaving mid-round is lossless: the round autosaves
after every resolved shot and every hole change (§13.7), and the setup screen offers Resume.
Never change this to the "literal in-progress" meaning other immersive games use without also
checking whether that breaks the resume flow's own assumptions.

## Layout: who owns what

The split is load-bearing, same reason it is in every other physics game here: the first eight
files are pure and DOM-free, which is what lets `golf/js/test.js` drive real shots — and, since
Part 6, a full fixture replay — headless under Node.

| File | Owns |
|---|---|
| `js/terrain.js` | hole JSON → height grid + surface grid (rasterizer) + samplers. Seeded `rng` (mulberry32), `S` (surface enum), `build`/`heightAt`/`surfaceAt`. |
| `js/flight.js` | pure aerodynamics helpers `physics.js` calls into (lift/drag coefficients). |
| `js/physics.js` | `simulateShot(terrain, input) → { samples, events, rest, lie, outcome, carryM, totalM }`. **Frozen since Part 2 — see below.** |
| `js/clubs.js` | the club table, lie speed/spin modifiers, `autoSelectClub`, `selectableClubs`, target-carry constants. |
| `js/meters.js` | the stop-the-bar maths (`pos(t,T)`), input mapping (`aimDeg`/`power01`/`spin01`), and `DIFF` (per-difficulty meter timings + sweet band + wind max). |
| `js/game.js` | **every round RULE** — strokes, water/OB penalties, max strokes, the wind roll, the points table, hole-to-hole advance, round create/restore. Pure, no DOM, no `Math.random`. See "The ui.js / game.js split" below. |
| `js/render.js` | three.js scene: terrain mesh, water, trees, ball, trail, flag, aim-target overlay, theme-aware sky. `Renderer` class; one fresh `<canvas>` per mount (see "WebGL canvas lifetime" below). |
| `js/camera.js` | `CameraRig` — the intro/address/putt/flight/rest state machine, cubic-ease tweens. Pure THREE.Camera math, no DOM. **Part 9A**: 50° HORIZONTAL fov (`applyHFov`, re-derived per aspect on resize), high poses (`B - 16â + 9ŷ` for a full shot, `B - 5â + 3ŷ` for a putt), the ball pinned at 30% up from the bottom of the view by deriving the PITCH from that rule (`_lookFor30`) rather than from the nominal lookAt, and `aimTo()` - a 0.25 s orbit whenever â changes. Clearance floor `heightAt + 1.0`. |
| `js/minimap.js` | **Part 9A.** The overhead map inset: a 2D canvas, hole surface grid rotated so tee→pin is vertical (pin at top), fitted to 116 × 156, colours from `render.js`'s exported `COL`, OB as the panel background; ball / pin / aim line / landing ring overlays; tap or drag → bearing from the ball through the inverse of the same transform. **Its x axis is mirrored relative to world x on purpose** - a three.js camera looking along +z has world +x on its LEFT, so drawing +x to the map's left is what makes "tap left of the fairway" rotate the 3D view left. Base raster built once per hole; overlays redraw only when `(ball, aimDeg, carryM, pin)` change. |
| `js/ui.js` | the DOM shell: HUD paint, tap capture, the shot-loop state machine, autosave, the module contract, and (Part 8) the `recordGolf`/course-mode call sites. The ONLY file besides `render.js`/`camera.js` that touches three.js, and the only one that touches the DOM at all. |
| `courses/registry.js`, `courses/harbor/course.js` | `COURSES` array; Harbor Links' nine hole definitions (tee/pin/target/fairway/green/bunkers/water/hills/trees, all metres in the hole's own frame). |
| `courses/harbor/fixture.json` | generated by `tools/refixture.mjs`; test 8's replay data. Regenerating it is a deliberate act (§15) — the commit that does it must say what physics change caused it. |

## Physics is frozen (Part 2 onward)

**Do not touch `js/physics.js` or `js/flight.js` without stopping to ask first.** Every constant
in both files has a test behind it (`test3`, `test3b`, `test4`, `test5` in `js/test.js`). The
handoff's own exception clause (retuning allowed with measured evidence against a stated sanity
band) was for Parts 1–2's tuning work specifically and does not carry forward. If a later change
seems to need a physics edit, that is a stop-and-ask, not something to decide alone — see
`DECISIONS.md#rollout-tuning-part2` for the full reasoning and `DECISIONS.md#spinaxis-sign-bug`
for the club-speed sanity floor (25–80 m/s) that exists because of a real bug once caught it
outside that band.

Course DATA can still change (a `target` move, a `fairway.width` widen) to fix reachability —
that is fixing the course, not the physics, and is how all five Part 2 target moves and the H3
knife-edge note happened. See `DECISIONS.md#course-fixes-part2b`.

**The one approved exception so far: Part 9B sidespin (2026-09-03).** `simulateShot` gained
`curve01` (-1 hook … +1 slice, default 0); the spin axis is tilted about the TRAVEL direction by
`curve01 × SIDE_TILT` (`flight.js`, **22°**, tuned to the doc's 25–45 m / 5–15 m driver band —
the doc's 35 gave 48 / 26). `curve01 = 0` is bit-identical to the pre-9B model (test 8b proved
it against the old fixture before it was regenerated); the fixture now carries two curved
driver shots per hole. `GOLF-PART9.md` said "rotateAboutY" — that keeps the axis horizontal and
cannot curve a ball; the rotation is about the travel direction, and `DECISIONS.md#part9b-sidespin`
has the reasoning and the whole SIDE_TILT sweep. Physics is frozen again from here.

## The ui.js / game.js split

`game.js` owns every round RULE: stroke counting, water/OB penalties, max strokes (`par + 4`),
the wind roll, the Modified Stableford points table and result words, hole-to-hole advance
(rolling the next hole's wind, placing the ball at its tee, resetting phase), and round
create/restore (`createRound`/`restoreRound`, validated same as `profile-store.js`'s reads).
`ui.js` calls it and paints; it never mutates `round.strokes/points/ball/wind/phase/hole` itself.

**What stays in `ui.js` on purpose, and is not a bug:** the moment-to-moment `round.phase`
choreography WITHIN a hole (`'intro' → 'address'/'putt'` on the camera tween ending or a skip
tap, `→ 'flight'` on `_fireShot()`, back on landing) is driven by camera-tween and meter-tap
TIMING that has no meaning without a renderer or a clock a human is tapping against — it cannot
run headlessly regardless of which file it lives in. `round.club`'s one direct write outside
`game.js` (`_toggleClubRow`'s manual pick) is the player's own choice being recorded, not a rule.

Full rationale and the two bugs found while doing the split (a stale persisted `phase:'flight'`
after a resolved shot; `round.club` being overwritten with the auto-selected id instead of
staying `null`): `DECISIONS.md#part5-scope`.

## Round-state shape (`gamehub.golf.v1`'s `round` field)

```js
{
  v: 1, courseId: 'harbor', difficulty: 'standard', seed: 0,
  hole: 1,                        // 1..9
  strokes: [0,0,0,0,0,0,0,0,0],   // per hole
  points:  [null,...],            // per hole, null until holed
  ball: { x, z, lie },            // current ball, in the hole's frame
  wind: { x, z },                 // m/s, rolled once per hole
  club: null,                     // player override for THIS shot, null = auto
  phase: 'intro' | 'address' | 'putt' | 'flight' | 'summary',
  practice: false,                // Part 8: frozen for the round's whole life - see below
}
```

`restoreRound` treats an unusable save as no save at all (§13.4's Play button, not Resume) —
never throws, never crashes a load. A save from before Part 8 has no `practice` field; it
defaults to `false`, never `true`, so an old save can never retroactively stop counting.

## Course release state and the practice bucket (Part 8, §14)

`js/admin-config.js`'s `golf.courses` map (added Part 8, mirrors `skeeball.boards` exactly)
gives each course three states, resolved by `courseMode(courseId)`:

| stored | mode | what a player sees |
|---|---|---|
| `open: true` | `open` | playable now, no unlock needed |
| `open: false, testing: false` | `unlockable` | playable if the PREVIOUS course in `COURSES` order has a `bestRoundByCourse` entry (any completed round) — the first course has no previous course, so it needs no prerequisite |
| `testing: true`, or the key is simply absent | `testing` | locked on the setup screen for everyone but the dev profile (`isDevProfile`); **rounds are recorded to the practice bucket, not the real counters** |

Unlike a Skeeball machine, a course has **no code-side `adminOnly` default** to fall back to —
`resolveCourseTesting` takes no `codeDefault` argument at all, because §14 says "missing key →
testing" unconditionally. Do not "fix" this to match `resolveBoardTesting`'s signature; it is a
deliberate difference, stated in `js/admin-config.js`'s own header comment.

**`practice` is decided ONCE, in `_startNewRound()`, and frozen on the round for its whole
lifetime** (persisted, same as difficulty/seed). Re-checking mid-round would let an admin's later
flip retarget where an in-progress round's numbers land, which is exactly the contamination this
mechanism exists to prevent. `recordGolf(difficulty, { ..., practice: true })` writes into
`gf.practice[courseId]` (mirrors `sk.practice.boards` exactly) and returns before touching
`total`/`byDiff`/any real `gf` counter — no rounds, no strokes, no points, no bests, no
leaderboard, nothing for `js/players-agg.js` to find outside its own dedicated merge branch.
Practice rounds are still SHOWN (THE LAW rule 1): `js/game-stats-ui.js`'s `golfScreen` renders
them on their own dashed, labelled "Practice (not counted)" row, below the real table, never
folded into it.

**Resuming an already-saved round is never blocked by the course's CURRENT lock state** —
locking only stops a NEW round from starting; it never takes back one already in progress. The
setup screen still shows the lock glyph and greys the tile, but a Resume button appears
regardless.

**Known gap, stated plainly:** `js/admin-ui.js` (the admin control page) needs no code change —
it imports `GAMES` from `js/hub.js` generically, so Golf's game-level live/testing toggle
appeared for free the moment its `GAMES` entry existed (Part 7). But there is **no button yet for
the per-COURSE open/unlockable/testing switch** — `setCourseMode` exists and is tested
(`test-admin-config.mjs`'s "the golf course state" block), but nothing in `js/admin-ui.js` calls
it. Today the only way to move Harbor Links out of `testing` is a direct call to
`setCourseMode('harbor', 'open')` from a signed-in browser (or a future admin-ui.js section,
mirroring its existing Skeeball-machine accordion).

## Two accepted, documented limitations

Neither is a THE LAW violation (no stroke or points number is ever wrong or lost); both are
narrow enough that fixing them was judged not worth the added state.

1. **`longestDriveYd` is UI-transient, not part of `game.js`'s round-state contract.** It is
   tracked in `GolfGame._roundLongestDriveYd`, reset to 0 at the start of every `_startNewRound()`
   and every `_resumeRound()`. Resuming a round therefore cannot recover a qualifying drive hit
   before the app was closed — the worst case is an undercounted `longestDriveYd` on the rare
   round that gets closed and reopened, never a wrong stroke or points number. See
   `DECISIONS.md#part8-scope`.
2. **A round that finishes hole 9 in the ~2–4 second window between the flash animation starting
   and the summary screen rendering can be closed before `recordGolf` ever runs**, because
   `applyShotResult` sets `phase: 'summary'` (and `_applyResult` autosaves it) synchronously,
   before the flash even plays — but `recordGolf` itself only runs once `_showRoundSummary()`
   is actually reached. A resume that lands on `phase === 'summary'` today falls through to
   `_beginAddress()` on an already-finished hole rather than re-entering the summary screen (and,
   deliberately, `_showRoundSummary()` was NOT given a resume entry point, to avoid the opposite
   bug — a resumed 'summary' phase double-calling `recordGolf`). Net effect: a round finished
   inside that narrow window can fail to ever record, never double-record. Pre-existing since
   Part 5; not fixed in Part 8 to keep that part's scope to what was asked.

## Part 9A: layout, visuals, aiming camera, overhead map (2026-09-03)

Matt's playtest fixes, from `GOLF-PART9.md` (9B sidespin and 9C the 3-click swing follow).
The full numbers are in `GOLF-HANDOFF.md` §10.1–10.4 and §13.1; what a session must not undo:

- **The sky is always daytime.** `#7fb8ff` → `#dceeff` plus an additive sun sprite, fog
  `0xdceeff, 180, 700`. There is no dark-mode sky palette and `render.js` no longer touches
  `js/theme.js` - dark mode governs the HUD bands only. Do not "restore" a night sky.
- **Safe area + the hub's back pill.** `.gf-play` (fixed) carries the safe-area padding;
  `ui.js` sets `--gf-hub-pad: 54px` when mounted in the hub so the pill (drawn by the hub at
  `max(safe-area-top, 54px)`) always lands inside the top strip's reserved left 104 × 56 box.
  The game's own back button renders ONLY standalone; in the hub the box is empty. Verified with
  `getBoundingClientRect()`: the pill at 10,54–80,91 overlaps no game element at 393 × 852.
- **Trees line the fairway** (`terrain.js` `buildTrees`, the belt from `rng(seed + 11)`), on
  bigger geometry (cone 3.2 × 9). Visual only; the fixture and every physics test are untouched.
- **Drag-to-aim works anywhere in the view**, address AND putt, 0.12°/px, and locks once the
  swing starts. The 3D aim line (a terrain-hugging ribbon, not a `THREE.Line` - line width never
  renders on mobile) and the `#ffce3a` landing ring appear on the first `pointerdown` and stay
  until launch; the minimap is up for the whole address. A `pointercancel` is never a tap (it
  used to advance the swing).
- **Every aim change goes through `_setAimDeg`** (view drag, map tap, map drag): bearing, then
  aim line/ring/minimap redraw, then `camRig.aimTo()`. Add a fourth aim input there, nowhere else.

## Tests and tools (`golf/`)

| File | Role |
|---|---|
| `js/test.js` | `node golf/js/test.js`. Tests 1–2 (heightfield, determinism), 3/3b (carry + rollout tables), 4/5 (reachability, putt sweep, per Harbor hole), 6 (points table, `game.js`), 7 (meter maths), 8 (fixture replay, ±0.02m). Wired into the repo-root `run-all-tests.mjs`. |
| `tools/refixture.mjs` | `node golf/tools/refixture.mjs harbor` — regenerates `courses/harbor/fixture.json`. 6 shots/hole, fixed inputs chosen for REPRODUCIBILITY, not for being good golf shots. |
| `tools/preview.html` | standalone hole viewer, no game shell — drag-orbit camera, "Fly demo shot" button. Mints a fresh `<canvas>` per hole switch (see below). |
| `tools/sweep-carry.mjs` | prints a carry/total/hang-time/apex table per club × power, ± spin at driver/7i/PW. Header line prints `SPIN_BRAKE` so a table is self-describing about which tuning pass produced it. |

`node run-all-tests.mjs` runs everything including golf's suite (~4.5 min total, mostly other
games) — per root `CLAUDE.md`, run it only when asked by name, not on your own initiative.

## WebGL canvas lifetime

`forceContextLoss()` (called by `Renderer.dispose()`) PERMANENTLY poisons the `<canvas>` element
it was called on — a second `new Renderer(canvas, ...)` on that same element throws "Canvas has
an existing context of a different type." `_enterPlay()` and `preview.html`'s `loadHole()` both
mint a FRESH `<canvas>` per mount/hole-switch for this reason, matching Skeeball's established
pattern. Never reuse a canvas across a dispose/recreate boundary. Full incident and verification:
`DECISIONS.md#webgl-canvas-reuse-part3`.

## Not yet done (deliberately, in scope order)

- **A second course.** `COURSES` and every course-relative resolver (`courseMode`'s prerequisite
  check, `bestRoundByCourse`, `GOLF_COURSES` name maps in `js/game-stats-ui.js`) are already
  written generically over `COURSES.length > 1`; only `courses/harbor/course.js`'s sibling data
  file and a `GOLF_COURSES` entry are missing.
- **The admin-ui.js course-mode button** (see "Known gap" above).
- **Round-summary polish**: no "this was practice" indicator on the summary screen itself for a
  dev profile testing a locked course (the practice/real split is answerable from My Stats
  instead — see the practice bucket section above).
