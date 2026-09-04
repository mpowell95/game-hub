# Golf — CLAUDE.md

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file. Rules 4 and 5 do real work in this game: see "Stored shape" below.

## Status: BEING REBUILT (Stage B + two courses of eighteen holes, 2026-09-04)

**`golf-reference-spec.md` at the repo root is the only spec.** Read it in full before touching
anything here. It is the written record of a commercial mobile golf game reconstructed from five
screen recordings, plus the decisions that turn it into the game we are actually building. Where
it is silent, ask, or decide and write it down there.

The 3D game that used to live in this folder — three.js + cannon-es rigid bodies, aim/power/spin
on three separate meters, Modified Stableford scoring, a course called Harbor Links — **is gone.**
Matt's verdict on it: *"It's terrible and this is a MAJOR overhaul... I don't trust anything that
the current build does."* Do not carry its decisions, tuning numbers, physics constants, course
design or UI forward, and do not go looking for them in git history to "restore" something.

Deleted in Stage A: `js/render.js`, `camera.js`, `terrain.js`, `minimap.js`, `physics.js`,
`flight.js`, `meters.js`, `game.js`, `clubs.js`, `test.js`, `js/vendor/` (cannon-es + two three.js
bundles, ~1.1 MB), `courses/`, `tools/`, `DECISIONS.md`, `docs/GOLF-HANDOFF.md`,
`docs/GOLF-PART9.md`. **The three deleted documents were specs for the old game and would mislead
the next session; that is why they went rather than being left "for reference".**

What is here now is a placeholder: `js/ui.js` renders one screen saying the game is being rebuilt,
and keeps the three module-contract exports so nothing in the repo carries a broken import.

### Where the rebuild is

| Stage | Contents | State |
|---|---|---|
| A | Clear the ground; the leaderboard metric, sort and filter change | **done** |
| — | The hole-data format, written down before anything is built against it | **done** |
| B | Core loop: tilemap, ball + shadow, HUD, aim ladder, clubs, meters, three-tap, flight, putting | **done** |
| C | Hazards and the drop prompt, the result banner, the scorecard, the round | **the round is done**; the drop prompt and the sunburst banner are not |
| D | Stats wiring, this file, `sw.js`, the full test sweep, release | **stats are wired**; My Stats' to-par display is not |
| — | Thirty-three more holes: Pine Valley 4-18, and Red Mesa, a whole second course | **done** |

**Stage B is the playtest checkpoint**: Matt plays it and judges the feel of the swing, the aim and
the flight before Stage C is built on top of them. Expect the numbers below to move.

The stages map onto `golf-reference-spec.md` §16's phases, with three approved changes: the
leaderboard metric change moved forward into Stage A, the `test-visual.mjs` entry gets written at
the start of Stage B, and the hole-data format is decided before Stage B rather than during it.

## Harbor Links is gone from the product, but its keys are not

Matt: *"I do not want to see 'harbor' anywhere in the hub. No mention of it ever."* So: no course
named harbor, no `courses/harbor/`, no harbor string in any UI, no harbor row in My Stats, no
harbor entry in the admin page's per-course config, no mention in user-facing copy in either
language.

**The one thing that is NOT deleted: the stored stats keys.** THE LAW rule 5 is that old keys are
never deleted and never repurposed, and it holds even for keys everyone believes are empty. So
`gf.practice.harbor` and `bestRoundByCourse.harbor` are simply **never written and never read**
again. They are not removed from `ensureGf`'s shape, and no cleanup code goes hunting for them. An
empty key nobody reads shows nothing to anybody, which satisfies "no mention of harbor" with no
destructive write.

**This was verified, not assumed** (2026-09-03, `golf-reference-spec.md` §16 Phase 0). A full RTDB
backup was taken and read: of 218 player device records, 11 carry a `stats.games.golf` key and all
11 are the all-zero skeleton `ensureGf` writes on first sync. Zero non-zero values, zero
`bestRoundByCourse` entries, zero `gf.practice` entries, zero occurrences of the string "harbor"
anywhere in the database, and nothing in `archive/players`. Matt confirmed the same on his own
phone's My Stats. **There is no golf history in existence to lose.**

## Names — frozen forever (THE LAW rule 5)

| Thing | Value |
|---|---|
| Folder | `golf/` |
| Stats id | `'golf'` |
| Settings key | `gamehub.golf.v1` |
| Recorder | `recordGolf(difficulty, extras)` |
| CSS root / prefix | `.gf-root` / `.gf-` |
| Hub integration | in-hub `module: '../golf/js/ui.js'`, `immersive: true` |

**Do not mint `gamehub.golf.save.v1`.** `gamehub.golf.v1` already exists and already holds the
round. A second store would create two sources of truth.

## Stored shape

`ensureGf()` in `js/game-stats.js` owns it, and it is unchanged by the rewrite:
`rounds, holes, strokes, points, birdies, eagles, aces, longestDriveYd, bestRoundByCourse, practice`.
Changes are **additive only**. `js/players-agg.js` already has the matching merge branch, including
the per-key `Math.min` for `bestRoundByCourse`.

- **`points` keeps being written.** Modified Stableford points are a pure function of (hole score,
  par), and the new stroke-play game knows both, so the lifetime counter stays truthful with no
  fabrication and nothing has to be archived as a dead legacy value. It is My Stats' "Skill level".
- **`bestRoundByCourse` stores STROKES**, keyed by course, `Math.min` per key. The leaderboard
  subtracts par at display time; the stored value is never a to-par number.
- **Course keys are frozen the moment one round is recorded**, and there are eight of them now:
  `pinevalley3` / `pinevalley9` / `pinevalley9b` / `pinevalley18`, and the same four for
  `redmesa`. **They are never merged and never compared** - a 3-hole best and an 18-hole best are
  not the same measurement (rule 4) - and `pinevalley3` was never repurposed into anything (rule
  5). Every screen that shows one names which it is showing.

  **The frozen key falls out of the rule rather than out of a lookup table.** `roundKey()` in
  `golf/js/rounds.js` is `` `${course.id}${round.suffix}` ``; the course id is `pinevalley` and the
  quick round's suffix is `3`, so `pinevalley3` - frozen back when Pine Valley WAS three holes -
  comes out unchanged with no special case to remember. `golf/js/test.js` asserts it.

**Queued for Stage D (Matt, 2026-09-03):** My Stats' "Best rounds" table shows raw STROKES while
the leaderboard shows the same round as a score to par. Make My Stats show to-par too, so the two
screens agree, and keep lifetime points as its separate "Skill level" line. Not done yet. (The
game's OWN setup screen already shows to-par, so it and the leaderboard agree; My Stats is the
odd one out.)

**Also noted, not changed:** `recordGolf` sets its win/loss flag from `points >= 0`, a leftover
from the Modified Stableford era, so an over-par round records a `lost`. Golf is in
`players-agg.js`'s `SOLO` set and no screen shows a golf W/L record - the board number is the best
round and My Stats shows rounds/average/birdies - so nothing displays it. It became visible only
now, because this is the first build that ever CALLS the recorder. Left alone deliberately: it is
a shared recorder, the value is stored and shown by nothing, and rule 5 says an old field is not
repurposed on a whim.

## The leaderboard number changed in Stage A

Matt, 2026-09-03: golf's board number is the player's **best round on a named course, as a score
to par, lowest wins** - not the lifetime Stableford total it used to be. `gf.points` is still
written and still shown on My Stats, so nothing was hidden by this; it was re-ranked.

It is the only metric on the whole leaderboard where **lower wins** and where **good values are
<= 0**, which broke two assumptions baked in everywhere:

- Every sort site compared `b - a`. Sorted that way, a stroke score puts the WORST golfer in the
  family on top, and it looks plausible enough to go unnoticed for weeks.
- `gameListHTML` filtered leaders with `metric > 0`, which drops level par (0) and every
  under-par round - a stored best that no screen shows reads as deleted (rule 1).

So the extractor, the sort direction at all six of its call sites (four in `sortRows`, the game
list, and `rankMap`, which numbers the rank badges) and the filter changed **in one commit** with a
test. The maths is in `js/leaderboard-rank.js` - pure and headless-testable, which is why it lives
there rather than in the DOM file - and `test-leaderboard-rank.mjs` covers it.

## Who can play it right now

**Nobody but a dev profile, and that is deliberate.** The adminConfig override
`adminConfig/v1/games/golf` is `live: false` (set 2026-09-03), and `js/hub.js` filters the launcher
on `isGameLive(g.id, !g.devOnly) || dev`. Matt: *"The default should be testing mode. So only I can
see or play it."*

**No `devOnly` flag was added on top of this, on purpose.** Two switches for one decision is how a
game ends up shipped hidden by accident. Releasing golf to the family is a tap on the admin page,
not a deploy.

`js/admin-config.js`'s per-COURSE resolvers (`resolveCourseMode` and friends) still exist and are
still tested, but have **no caller** while the game is rebuilt, and `js/admin-ui.js` has never had a
per-course section at all. Releasing an individual course will need that section written.

## The hole-data format

**Decided before Stage B, deliberately.** Nothing is built against this until it is written down:
the renderer, the lie lookup, the collision test and the putting break all read the same objects,
and discovering the shape while writing the first of them is how four files end up disagreeing.

**Where it lives:** `golf/courses/pinevalley.js`, one module exporting one course object with its
holes. (`golf/courses/` was deleted in Stage A - that was the HARBOR content and the old registry.
The directory coming back with new contents is fine and is not a partial revert.) It splits into a
file per hole only if one file becomes unwieldy.

### Units and axes, stated once

- **Everything is in YARDS**, including tree heights and ball height. One unit throughout, so no
  call site ever converts. (The deleted 3D game used metres. This does not.)
- **`x` runs across the hole, positive RIGHT. `y` runs up the hole, positive AWAY FROM THE TEE.**
  The tee sits near `y = 0`; the pin has the largest `y`. The view is top-down and north-up with no
  rotation, so screen-up is `+y` always, and the camera only ever pans.
- **Positions are `[x, y]` pairs.** Polygons are arrays of those, simple (never self-intersecting),
  winding order irrelevant (containment is a ray cast, so either direction works).

### The hole object

| Field | Type | What it is |
|---|---|---|
| `n` | int | Hole number, 1-3 today |
| `par` | int | 4, 3, 5 |
| `cardYards` | float | The number on the scorecard and the course card. **Authored, not derived** - see "Two different yardages" below |
| `tee` | `[x,y]` | Where the ball is teed |
| `pin` | `[x,y]` | The hole. Must lie inside `green.poly` |
| `bounds` | `{minX,maxX,minY,maxY}` | The camera's limits and the render extent. Explicit, not derived from the polygons, so the camera can stop with a margin rather than exactly on the last edge |
| `base` | surface kind | What the ground is anywhere no polygon covers |
| `surfaces` | ordered array | The polygons, painted and tested in order (below) |
| `green` | `{poly, slope}` | The putting surface and its break grid (below) |
| `treeTypes` | array | The specimen table for this course |
| `trees` | array | Individually placed trees |
| `treeBelts` | array | Polygons filled with trees procedurally |
| `decor` | array | Art only, never consulted for anything (below) |

### Surfaces: one ordered list, painted and tested the same way

`surfaces` is an ordered array of `{kind, poly}`. **Later entries paint over earlier ones AND win
the lie lookup.** That is one rule serving both, and it is the point: what the player sees is what
they are standing on. A separate collision map that could drift from the art is exactly how a game
starts lying about a lie.

Anything covered by no polygon is `base`. That is what makes hole 2 nearly free: `base: 'water'`
plus a green and a bunker IS an island green.

`kind` is a **closed set**, and each value is a row in the lie table (`golf-reference-spec.md`
§21.2). The table itself lives in code, not in hole data, so tuning it never touches a course:

| `kind` | Power cap | Straight-zone width |
|---|---|---|
| `tee` | 100 % | 100 % |
| `fairway` | 100 % | 100 % |
| `lightRough` | 92 % | 85 % |
| `heavyRough` | 82 % | 65 % |
| `fairwayBunker` | 88 % | 55 % |
| `greensideBunker` | 75 % | 50 % |
| `trees` | 85 % | 80 % |
| `green` | putting | - |
| `water` | penalty: drop at the edge, +1 | - |

**The two bunker kinds are authored, never derived from distance to the pin.** Deriving them would
hide a rule that changes how a shot plays inside a threshold nobody can see.

### Trees are TWO separate things, and both are needed

1. **The `trees` SURFACE** - a polygon, in `surfaces`, giving the 85 % / 80 % lie. This is what
   "the ball is in the woods" means for the swing.
2. **Tree OBJECTS** - `trees` and `treeBelts`, which physically block a ball in flight.

A ball can be on the trees surface and have a clear swing, or be on the fairway and still have a
trunk in the way. Conflating them would lose the dilemma the spec is built around.

An object is `{x, y, type}` where `type` indexes `treeTypes`. A type is
`{name, trunk, canopy, height}`, all yards:

- **`trunk`** - radius. Blocks the ball at **any** height.
- **`canopy`** - radius, wider. Blocks a ball travelling **below `height`**.
- **`height`** - where the canopy stops. Ball height comes from the club's loft, so a long iron
  punched low risks the trunk while a wedge clears the canopy and gives up the yardage. That is the
  whole mechanic, with no extra UI.

`treeBelts` is `{poly, type, spacing, seed}` - the belts lining a hole are hundreds of trees and
must not be hundreds of hand-written entries. **At load a belt expands into ordinary tree objects**
using a stated PRNG seeded by `seed`, so it is deterministic: the same belt is the same trees on
every device and in every test run. After expansion there is one flat tree list and one collision
path; the two authoring forms are a convenience, never two behaviours. **A belt does not imply the
`trees` surface** - paint that polygon too if the lie should be woods.

### The green and its slope grid

`green` is `{poly, slope}`. `slope` is `{cols, rows, cells}`:

- The grid covers the **axis-aligned bounding box of `poly`**, divided `cols` x `rows`.
- **`cells[0]` is the cell at the LOWEST x and the LOWEST y** - the front-left corner, front being
  the side nearest the tee. Row-major: index `r * cols + c`. Getting this flipped puts every break
  backwards while looking entirely plausible, so it is written down rather than inferred.
- Each cell is `[dx, dy]`, each in **-1..+1**, pointing **DOWNHILL** - the direction a ball at rest
  would roll. Magnitude is steepness, 0 dead flat.
- A rolling ball takes a lateral acceleration of `k * gradient`, with `k` tuned so a 20 ft putt
  across a half-strength slope breaks about one cup width (~4 in). `k` is a tuning constant in
  code, not hole data.

**The tick marks drawn on the green are GENERATED FROM `cells`, never hand-drawn.** If the art and
the grid can disagree, the read lies to the player, and a putting game whose green lies is worse
than one with no read at all.

8 x 8 is the default. A bigger green may use a finer grid; the format does not care.

### Two different yardages, on purpose

- **`cardYards`** is the hole's length as a scorecard states it, measured along the playing
  centreline. Hole 3's 608.6 is a dogleg measurement and does not reconcile with any straight line.
- **The HUD's "distance to the hole" is straight-line 2-D from the ball to the pin**, recomputed
  every shot. §10.3's arithmetic forces this: 360.7 − 251.6 ≠ 136.0, because the shot finished
  offline.

On hole 1 they happen to agree (the tee and pin below are exactly 360.70 apart). **On hole 3 they
will differ by a lot, and that is correct** - every real scorecard differs from every real
rangefinder. Do not "fix" it by deriving one from the other.

### `decor` never affects play

Art-only polygons: the cart path, a flower bed, a mown pattern. `{kind, poly}`, painted after the
surfaces, consulted by nothing. A path that changed the lie would have to be a surface with a lie
row; keeping decor incapable of it means art can be added freely without a physics review.

### What the validator asserts

`validateHole()` in `golf/js/holes.js` (written at the start of Stage B, run by the engine test and
at load in dev):

- `pin` lies inside `green.poly`; `tee` lies inside a `tee` surface polygon.
- Every polygon has >= 3 points; every point is inside `bounds`.
- Every `surfaces[].kind` is in the closed set above; `base` is too.
- `slope.cells.length === cols * rows`, and every component is within -1..+1.
- `cardYards > 0`, `par` in 3..5.
- Every `trees[].type` and `treeBelts[].type` indexes a real `treeTypes` entry.
- The pin is reachable: `cardYards` is within the ladder's three-shot reach for the par.

A hole that fails validation must fail loudly at load. A malformed green silently flattens the
break, which is the kind of bug that gets diagnosed as "putting feels wrong" for a week.

### Worked example: Pine Valley hole 1

Par 4, 360.7 yds. Gentle double dogleg (right, then back left), water left of the tee, tree belts
pinching the drive landing area, a bunker short-left of the green and another to its right, water
hard along the green's left and back edges. The stock ladder plays it as a drive (215) plus a
6 iron (139), landing 359 up the hole against a pin at 365.5 - a good pair of shots leaves a putt,
not a tap-in.

```js
export const HOLE_1 = {
  n: 1,
  par: 4,
  cardYards: 360.7,          // tee -> pin here is exactly 360.70, so card and HUD agree on THIS hole
  tee: [0, 5],
  pin: [12, 365.5],
  bounds: { minX: -55, maxX: 55, minY: -15, maxY: 395 },
  base: 'heavyRough',

  surfaces: [
    // Painted and tested in this order; the last polygon containing the ball wins the lie.
    { kind: 'lightRough', poly: [
      [-27,10], [-23,60], [-19,110], [-13,160], [-11,200], [-15,250], [-23,300], [-20,340],
      [34,340], [31,300], [39,250], [43,200], [41,160], [35,110], [31,60], [27,10] ] },

    { kind: 'fairway', poly: [
      [-15,15], [-11,60], [-7,110], [-1,160], [1,200], [-3,250], [-11,300], [-8,335],
      [22,335], [19,300], [27,250], [31,200], [29,160], [23,110], [19,60], [15,15] ] },

    { kind: 'trees', poly: [
      [-30,20], [-26,120], [-16,190], [-14,230], [-22,300], [-23,340], [-48,340], [-48,20] ] },
    { kind: 'trees', poly: [
      [30,20], [33,80], [37,150], [38,210], [40,240], [45,300], [36,340], [48,340], [48,20] ] },

    // The lake left of the tee.
    { kind: 'water', poly: [ [-55,-10], [-24,-10], [-24,75], [-40,90], [-55,90] ] },

    // Water hard along the green's left edge and across its back.
    { kind: 'water', poly: [
      [-30,320], [-10,326], [-8,352], [-9,378], [-2,384], [16,386], [30,383], [40,378],
      [50,378], [50,395], [-30,395] ] },

    { kind: 'greensideBunker', poly: [
      [-7,340], [-5,345], [0,347], [5,345], [7,340], [5,335], [0,333], [-5,335] ] },
    { kind: 'greensideBunker', poly: [
      [26,358], [28,362], [32,364], [36,362], [38,358], [36,354], [32,352], [28,354] ] },

    // The green is a surface too, so the lie lookup needs no special case for it. Its polygon is
    // the same one `green.poly` names - written once, below, and referenced here at load.
    { kind: 'green', poly: 'green' },

    { kind: 'tee', poly: [ [-6,0], [6,0], [6,10], [-6,10] ] },
  ],

  green: {
    // 12-gon, centre [10, 362], radius 14. Bounding box x -4..24, y 348..376.
    poly: [
      [24,362], [22.1,369], [17,374.1], [10,376], [3,374.1], [-2.1,369],
      [-4,362], [-2.1,355], [3,349.9], [10,348], [17,349.9], [22.1,355] ],

    // Downhill vectors, back-to-front with a soft spine down the middle so each half sheds to its
    // own side, steepening toward the back where the water is. cells[0] is front-left; row-major.
    slope: { cols: 8, rows: 8, cells: [
      /* r0 y 348.0-351.5 */ [-0.12,-0.15], [-0.08,-0.15], [-0.05,-0.15], [-0.02,-0.15], [0.02,-0.15], [0.05,-0.15], [0.08,-0.15], [0.12,-0.15],
      /* r1 y 351.5-355.0 */ [-0.13,-0.20], [-0.09,-0.20], [-0.06,-0.20], [-0.02,-0.20], [0.02,-0.20], [0.06,-0.20], [0.09,-0.20], [0.13,-0.20],
      /* r2 y 355.0-358.5 */ [-0.15,-0.26], [-0.11,-0.26], [-0.06,-0.26], [-0.02,-0.26], [0.02,-0.26], [0.06,-0.26], [0.11,-0.26], [0.15,-0.26],
      /* r3 y 358.5-362.0 */ [-0.17,-0.32], [-0.12,-0.32], [-0.07,-0.32], [-0.02,-0.32], [0.02,-0.32], [0.07,-0.32], [0.12,-0.32], [0.17,-0.32],
      /* r4 y 362.0-365.5 */ [-0.18,-0.37], [-0.13,-0.37], [-0.08,-0.37], [-0.03,-0.37], [0.03,-0.37], [0.08,-0.37], [0.13,-0.37], [0.18,-0.37],
      /* r5 y 365.5-369.0 */ [-0.20,-0.43], [-0.14,-0.43], [-0.09,-0.43], [-0.03,-0.43], [0.03,-0.43], [0.09,-0.43], [0.14,-0.43], [0.20,-0.43],
      /* r6 y 369.0-372.5 */ [-0.22,-0.48], [-0.16,-0.48], [-0.09,-0.48], [-0.03,-0.48], [0.03,-0.48], [0.09,-0.48], [0.16,-0.48], [0.22,-0.48],
      /* r7 y 372.5-376.0 */ [-0.24,-0.54], [-0.17,-0.54], [-0.10,-0.54], [-0.03,-0.54], [0.03,-0.54], [0.10,-0.54], [0.17,-0.54], [0.24,-0.54],
    ] },
  },

  // Course-level in practice (every hole shares it); repeated per hole here for clarity.
  treeTypes: [
    { name: 'pine', trunk: 0.6, canopy: 4.5, height: 18 },   // tall and narrow: clearing it costs a club
    { name: 'oak',  trunk: 1.0, canopy: 8.0, height: 13 },   // wide and low: easier over, harder around
  ],

  // Individually placed specimens. Hole 1 has none that matter on their own; hole 3's lone fairway
  // tree - the one that triggers the drop prompt - is an entry in this same list.
  trees: [],

  treeBelts: [
    { poly: [ [-30,20], [-26,120], [-16,190], [-14,230], [-22,300], [-23,340], [-48,340], [-48,20] ],
      type: 0, spacing: 9, seed: 101 },
    { poly: [ [30,20], [33,80], [37,150], [38,210], [40,240], [45,300], [36,340], [48,340], [48,20] ],
      type: 0, spacing: 9, seed: 102 },
  ],

  decor: [
    // The cart path. Art only: it is not a surface, so it can never change how a shot plays.
    { kind: 'path', poly: [ [-34,10], [-31,10], [-27,120], [-19,200], [-27,300], [-30,340], [-33,340], [-30,300], [-22,200], [-30,120] ] },
  ],
};
```

**Two things in that example are worth calling out, because they are decisions rather than data:**

1. **`{ kind: 'green', poly: 'green' }`** - the green appears in `surfaces` so the lie lookup has no
   special case, but its polygon is written once, in `green.poly`, and referenced by name at load.
   Two copies of the same outline would eventually drift, and a green whose lie boundary differs
   from its drawn edge is the yards/feet readout flickering on the fringe.
2. **The tee polygon is painted LAST** even though it is at the bottom of the hole. Order is paint
   order, not geography: the tee box sits on top of whatever surrounds it.

## What Stage B built, and the shape of it

| File | Role |
|---|---|
| `js/holes.js` | geometry: containment, the lie lookup, deterministic belt expansion, slope sampling, `validateHole()` |
| `js/holegen.js` | the hole CONSTRUCTOR: a design spec in, the documented hole object out |
| `js/rounds.js` | the course list, the four round shapes, the frozen `bestRoundByCourse` keys, Stableford points |
| `courses/pinevalley.js` | holes 1-3 hand-authored, 4-18 from specs; par 72 |
| `courses/redmesa.js` | eighteen holes of high desert; par 71 |
| `js/clubs.js` | the approved stock ladder (spec 21.3), the lie table (21.2), the auto-pick |
| `js/swing.js` | the power ring, the accuracy bar, the mishit model, the three-tap state machine |
| `js/shot.js` | flight, the tree test, roll, and the putt with its slope break |
| `js/render.js` | the tilemap, the camera, the ball and its shadow, the aim ladder |
| `js/ui.js` | the DOM shell. **It owns no rule** - everything above is pure, which is why `js/test.js` can measure all of it headless |

**Every number that can be measured is measured, not eyeballed.** `node golf/js/test.js` is 102
assertions over the hole data, the bag, the meters, the mishit model, flight, roll and putting. Two
of them are marked `[KNOWN-BUG PROBE]` because they pin things a casual reading of the reference
gets backwards: the ring PING-PONGS rather than filling one way (a one-way fill makes a mistimed
tap give MAXIMUM power instead of low power, which inverts the whole risk model), and the accuracy
window does NOT narrow as power rises (it only looked that way at 15 fps; measured, the green pixel
count is pinned for the whole sweep).

### Three things Stage B decided that are worth not re-deriving

- **`apexYd` is quadratic in loft, not linear.** The first draft was `distance * (0.06 + loft*0.20)`,
  which reads fine until you try to hit a wedge over a tree: a wedge's distance is short, so its
  apex came out short too, and the one club that should climb steeply could not clear a canopy the
  driver could not get under either. That collapses the punch-low-or-loft-over choice into no choice
  at all. The engine test now throws a driver and a lob wedge at the same tree from the same spot.
- **`PUTT_DECEL` is DERIVED from the one measured putt, not guessed.** The reference's 17 ft putt
  rolled to rest in ~2.5 s, and constant deceleration gives `2 * (17/3) / 2.5^2 = 1.81 yd/s^2`.
  Everything else about putting falls out of it, including a 60 ft putt taking 4.7 s. `BREAK_K` is
  then tuned so a 20 ft putt across a half-strength slope breaks one cup width; the test measures
  exactly that.
- **`bounds` runs 45 yds BEHIND each tee.** The camera clamps itself inside bounds, so a hole that
  stopped at its own tee pinned the ball to the bottom edge of the screen, underneath the club tile
  and the aim row, for the whole tee shot.

### The fit bug, and why the probe went first

Matt asked for the `test-visual.mjs` fit probe at the START of this stage rather than the end. It
earned that immediately: measured in the hub, the game was **136px too tall at both phone heights**,
with the entire bottom control cluster - the club tile, the aim row, the meter and the swing button
- below the fold. Standalone it was clean, which is exactly the shape that shipped in Pool.

The cause was not the CSS. `_fit()` ran once in the constructor, and **the hub mounts the element
and THEN applies its own chrome**, so the first measurement was taken before the game had been
pushed 98px down the page. Nothing resizes the window afterwards, so there was no path back to the
truth. A `ResizeObserver` on the container is that path.

The measurement itself took two attempts, and the failed one is worth recording: collapsing the
game and reading `document.documentElement.scrollHeight` to find the gap below **does not work**,
because a standalone page's own `min-height: 100vh` wrapper makes that read as a full viewport of
chrome and collapses the game to its floor. What works is to take everything from the root's top to
the bottom of the viewport, then measure how far the PAGE overflows and give exactly that much
back - it never has to know which ancestor owns the gap (in the hub it is `.hub-main`, two levels
up). Measured after: 852/714/664/526 px of root across the four host-and-height combinations, with
nothing offscreen, no tap target under 44px and no text under 11px.

## The first playtest, and what it broke (2026-09-04)

Matt played Stage B on his phone and filmed it. **He took 24 shots on a par 4 and quit without
holing out.** Two screen recordings, watched frame by frame at 1 fps. The shot ledger:

`360.7 yds tee -> 149.0 fairway -> 17.5 HEAVY ROUGH -> 18.2 -> 15.8 ft -> 48.9 ft -> ... ->
2.6 ft -> 10.7 ft -> ... -> 7.9 ft -> putted OFF THE GREEN, 11.8 yds -> 2.2 ft -> 12.6 ft -> quit`

### 1. Putting had about ONE FRAME of tolerance, at every distance

`MAX_PUTT_FT` was a fixed 60 ft at full power. Required power was therefore LINEAR in distance
against an 825 ms sweep, which makes the tap window for +/- 1.5 ft a **constant +/- 19 ms - 1.1
frames at 60fps - whether the putt is 2 ft or 50 ft.** A 2.2 ft putt needed 3.7 % power, reached
28 ms after tap 1. It is not a hard shot, it is an impossible one.

It was first fixed by SCALING the range to the putt in hand (distance x 1.4, floored at 6 ft), so
every putt used the whole meter. **That worked and it was the wrong thing - see "The putter's range
is a constant" below.** The real cause was the 825 ms power ring, and that ring no longer exists.

### 2. THE TEST SUITE ASSERTED THE WRONG THING, and that is the lesson

`test.js` had asserted *"a 12 ft putt on hole 1 can actually be holed"* - by sweeping power values
in a loop until one dropped. **That proved the physics could hole a putt. It never asked whether a
person can stop the meter there.** 102 assertions were green and the game was unplayable.

Section 11b now measures the TAP WINDOW for every distance a player is expected to face and fails
under 3 frames. **When a mechanic is a timed input, test the input, not just the simulation.**

### 3. Only a putt could ever be holed

`resolveShot` never looked at the cup at all - only `simulatePutt` did - so a wedge, an iron or a
wood could roll straight over the hole and carry on. Matt: *"Anything can be holed. a 1 ft putt, a
30 ft putt, a 200 yard 3 wood shot. Anything. as long as it goes over the hole at a reasonable
speed (you can go over it if the ball is moving too fast)."* `cupCheck` and `rollWatchingCup` are
now the one rule both paths use, and a ball that DIES over the cup drops (the speed break used to
happen before the cup was ever tested, so a putt with exactly enough pace stopped on the lip).

### 4. Every green was ringed by heavy rough

Hole 1's light-rough corridor stopped at y=340 and the green starts at 348, so a missed green
landed in `base` - heavy rough, 82 % power and a 65 % accuracy band - on all four sides. There was
no collar anywhere on the course. A `fringe` surface (97 % / 94 %) now rings every green, and
**the putter is offered from it**: without that, a ball two feet off the green was handed the
shortest club in the bag, a 50 yd lob wedge. Section 11c fails if any green has heavy rough within
3 yds of its edge.

### 5. Free look could not be used at all

Matt: *"in the real game, i can move the map around to check it out, but when i tried in our game
things got messed up instantly."* Three causes: the preview camera was **never clamped** (a short
drag scrolled off the map into flat colour with no way to tell which way was back), it panned only
**vertically** (so a dogleg could not be followed), and `pointerleave` ended the drag when a thumb
neared the screen edge. Now two-axis, clamped to `bounds`, pointer-captured, and it eases back to
the ball instead of snapping.

### 6. The ring readout spoiled the shot

`lastShotYd` was set in `_fire()`, so the third tap printed how far the ball was ABOUT to go before
it had gone anywhere. It is set in `_settleShot()` now.

### 7. One club in hand, resolved in one place

Fixing the HUD's club display gave it its own auto-pick fallback while `_fire` still read the raw
field, so the tile could name one club while the shot swung another. `_activeClub()` is the single
resolver both use.

## The second playtest, and going back to the REFERENCE footage (2026-09-04)

Matt played again and listed ten problems. The important part is WHY most of them existed: the
first playtest analysis sampled at **1 frame per second**, which cannot contain a ball bouncing, a
meter sweeping, or a line's colour - and worse, the two clips watched were **Matt playing our
build**, not the reference. Answers about "how should it work" were inherited from a spec another
session wrote rather than measured. This pass went to the original recordings and measured them.

**How to watch these clips properly**: they are in Dropbox under `/Claude Code Refs/`. There is no
video skill and no ffmpeg in the container - fetch a static ffmpeg build, pull the clip, and
extract. **1 fps is only a survey.** Anything about motion needs 15-30 fps over a named window, and
anything about colour or a small glyph needs a FULL-RESOLUTION crop, not a downscaled contact
sheet.

### What the reference actually does

- **The ball spends half the shot ON THE GROUND.** Measured at 30 fps across the whole drive in
  `Pixel golf - hole 1.mp4`: swing animation 19.5-20.6 s, still to 21.5, ball climbing to 22.3,
  camera tracking the flight 22.3-25.0 (2.7 s), then **bounce and roll 25.0-28.4 (3.4 s)** with the
  motion decaying in stages, at rest 28.4. Ours stopped dead on touchdown. `ROLL_DECEL` (4.3 yd/s²)
  and `groundPoint()` in `shot.js` are that phase; `rollMs()` gives a driver's 17 yd rollout 2.8 s.
- **The putt's aim line runs PAST the cup.** At 67.0 s, a 17 ft putt shows dots continuing off the
  green and into the trees. They are a power ladder like any other shot's. Ours stopped the line at
  the hole, which left nothing to gauge power against.
- **Wind reads `wind` / an arrow glyph / a NUMBER.** Never the word "calm", which we invented.
- **The club tile is mostly picture** - a large club head across the tile with a big name beneath.
- **There IS a golfer**: white cap with a black outline, skin face, grey polo and trousers, a dark
  club. About 6 % of the screen's width, present at address and on the green.
- **The two numbers are both in the reference and both unlabelled**: top centre is distance to the
  hole, the ring's hub is the LAST SHOT. That is the spec's own flaw 5, and it is why Matt asked
  "42.2 feet... 6.7 ft. Which is it?". Ours now labels the hub one.
- **The meter's geometry was already right; its WEIGHT was not.** The original has a thick banded
  arc with a bold white outline and a diagonal hatch, chunky pixel tick numbers, a thin green
  stripe just before 100, a striped over-swing tab that juts past the arc's end, and the accuracy
  bar nested in the ring's own bottom opening.
- **At address the reference draws NO connecting line**, only discrete markers. The blue-to-100-
  then-red line with all-red dots is Matt's own design call, not a reference behaviour.

### And free look had to HOLD

It eased back the instant the finger lifted, giving about half a second to look at a green 200 yds
away. The reference player scrolls up and studies the hole for twelve seconds. It now holds where
you leave it and returns on a TAP or when a swing begins.

### The meter's two real bugs (2026-09-04, "batch 1")

Matt put our screen beside the reference and listed every difference. The seven most
gameplay-affecting were all in the swing meter, and **six of them were two bugs wearing seven
faces**, not seven cosmetic misses:

1. **THE WHOLE METER RENDERED AT 40 % OPACITY** whenever the free look was more than half a yard
   off the ball (`globalAlpha = faded ? 0.4 : 1`). That was harmless while free look snapped back
   after half a second. The moment it started HOLDING where you leave it, the meter stayed dimmed
   for as long as the player studied the hole - so the green target band, the over-swing block and
   the 25/50/75/100 labels were washed out at exactly the moment they were about to be used. The
   reference fades the top-centre lie tile and yardage only, and never the meter. **The fade is
   gone from `_drawMeter` entirely.** This one bug is the washed-out accuracy bar, the dim tick
   numbers and most of "the whole thing looks faded".
2. **THE HATCH WAS PAINTED OVER A PIE, NOT THE BAND.** `ctx.clip()` clips to the region ENCLOSED by
   the current path, and the path was an arc - so clipping "to the ring" actually clipped to the
   whole chord behind it, and the hatch lightened a big wedge of course. That is the pale
   rectangle. It is a repeating `createPattern` used as the band's `strokeStyle` now, which is
   confined to the band by construction and cannot escape it.

The rest of the batch is weight, and each number is the reference's: band 19 -> 24 px, a thin
bright `#3fe04a` stripe at 94.5-100 %, the striped over-swing tab drawn `band + 12` wide so it
JUTS PAST the arc's end (a sliver inside the band cannot say "this is where the risk starts"),
tick labels at `800 13px` mono in white on a hard dark shadow, and the accuracy bar nested in the
ring's own bottom opening with saturated `#e01d10 / #f2801f / #3fe04a` and flared trapezoid ends.

**The meter canvas is also backed at `devicePixelRatio` now** (`METER_W` x `METER_H` logical, the
canvas element sized `* dpr` with a matching `setTransform`). It had been drawing at 1x into a
184x152 element, so a 3 px outline and 13 px tick numbers went to mush on a phone - which reads as
"washed out" too, and no amount of colour would have fixed it.

### The play probe could not hole a putt, and had not been able to since putting was fixed

`test-visual.mjs`'s golf PLAY probe tapped a fixed 260 ms for power on every swing. That was fine
when the putter's range was a fixed 60 ft; once `puttRangeFt()` scaled the range to the putt in
hand, the cup always sat near 71 % power and 260 ms is 34.7 %, so all fourteen attempts came up
short in exactly the same way. The probe now **computes the milliseconds the meter itself says the
putt needs** (`ft / puttRangeFt(ft) / RING_MAX * 825`) and walks either side of it, because the
harness's tap round-trip is worth tens of ms. It also taps 3 immediately after tap 2, which leaves
the accuracy bar near its centre instead of near its edge. Its success line reported `undefined`
for weeks because it returned `note` where `checkPlay` reads `why`.

### The view: 95 yards wide, and 34 on the green (2026-09-04)

Matt: *"Can you make the default view a little more zoomed out?"* `VIEW_W_YDS` 70 -> **95**.

70 framed the fairway and its rough and almost nothing else - measured on Pine Valley 1 at
393 x 852, the view was 152 yds deep, so a driver's landing area was off the top of the screen and
two of the five aim dots had nowhere to be drawn. At 95 the view is 206 yds deep and the tree belts
and the water down the left are both visible from the tee. **The ceiling is not taste, it is
`MAP_PPY`**: the map is rasterised at 2.4 px/yd, so past about 164 yds across it would be
DOWNscaled and start to shimmer. 95 leaves it upscaled 1.7x and the pixel-art look untouched.

**The green needed its own width, or this would have been a straight trade.** A putt is measured in
FEET; reading a 6 ft putt across 95 yards of screen is reading it across 2 % of the frame, with the
break (one cup width over 20 ft) sub-pixel. `VIEW_W_GREEN_YDS` is 34, eased in over about fifteen
frames as the ball settles, and on the green the camera also nearly CENTRES the ball (0.12 of a
half-height instead of 0.5) - the low framing exists to show a fairway the ball is about to fly up,
and on a putt it just spends the top half of the screen on whatever is behind the green.

**And it exposed a real bug in `makeCamera`.** `clamp()` closed over the CONSTRUCTOR's `halfW` and
`halfH` rather than reading `this.` - invisible for as long as the camera's scale could never
change, and wrong the instant `setWidth` existed. Tightening to the green left the clamp still
enforcing a 95-yard frame, so it dragged the view 30 yards off the ball and pinned the flag off the
top of the screen: measured, `cam.y` clamped to 332 against a ball at 363.5. If a future change
adds another camera scale, this is the line it will trip over.

One knock-on: a hole narrower than the view gets CENTRED rather than clamped, which is correct
(there is nothing to pan to) but leaves the free look with no sideways travel. `holegen.js`'s
minimum hole width went 76 -> 104 to match. Sideways pan is now small on every hole by design -
at 95 yards across you can already see both edges of the corridor - while the vertical pan, which
is the one that answers "where will this drive land", is untouched.

## THE SWING IS ONE NEEDLE, NOT TWO METERS (2026-09-04)

Matt filmed the reference's meter and ours and asked what was different. Both clips were measured
frame by frame at 60 fps - 201 and 203 frames, tracking the needle's angle and the accuracy bar's
marker in **every single frame**. The answer was not cosmetic:

```
frames   0-33    the needle is parked DEAD CENTRE IN THE ACCURACY BAR, at 89-90 deg
frames  33-127   it climbs the arc at 2.22 deg/frame - the backswing
frame  127       A MARKER IS PLANTED AT 297 deg AND STAYS THERE for the rest of the clip,
                 and the needle REVERSES
frames 130-188   it runs back down at 3.24 deg/frame - 1.46x faster - the downswing
frames 188-201   it STOPS at 96 deg and holds: a small miss, right of centre
```

And the clincher: **the accuracy bar's marker position is a linear function of the needle's angle**,
same slope (-0.0175 per degree) on the way up and on the way down. The bar is not a second meter.
**It is the same needle**, and the bar is a MAGNIFIED VIEW of the last ~12 % of arc either side of
zero. That is why it has to sit in the ring's mouth: it is the same scale, unrolled.

So the reference is the classic three-click swing, and ours now is too:

| tap | what it does |
|---|---|
| 1 | start the backswing |
| 2 | set POWER: a marker is planted where you stopped it, and the needle reverses |
| 3 | set ACCURACY: stop the needle as near zero as you can on the way back down |

**Everything is on ONE scale, `pos`, in power units** (`golf/js/swing.js`): `0` is the accuracy
point (the bar's centre, a perfect strike), `1` is 100 % power, `SWING_MAX` (1.12) is the top of the
over-swing block, and `+/- BAR_HALF` (0.12) is the window the bar magnifies. The needle is drawn at
`ang(pos)` and lands inside the bar or on the band from the same expression, with no special case.

### What that changed, measured against measured

| | reference | old build | now |
|---|---|---|---|
| backswing 0 -> 100 % | 1.56 s | 0.75 s | **1.65 s** |
| downswing 100 % -> 0 | 1.07 s | 0.75 s | **1.15 s** |
| downswing vs backswing | 1.46x faster | identical | **1.43x faster** |
| over-swing zone | +11.7 % | +10 % | **+12 %** |
| accuracy green band | 54 % of the bar | 40 % | **54 %** |

**Holding past the top is not a free extra lap.** The old ring ping-ponged for ever, so a mistimed
tap cost nothing. Now the power is spent at `SWING_MAX` and the needle is already coming back down;
the next tap is the ACCURACY tap, not a second power tap. And if the needle runs off the bottom of
the bar with no third tap the shot fires anyway, at the worst accuracy the bar can express - a swing
that hangs waiting for a tap the player already failed to make is worse than a bad shot.

**Putting got easier, not harder.** The tap window for a putt is now the backswing's own rate, and
the backswing is more than twice as slow as the old ring: 2.2 ft went from 7.5 frames of tolerance
to 16.5, and a 40 ft putt from 3.2 to 7.1.

### The meter's look, measured rather than eyeballed

Every proportion in `_drawMeter` now comes off the reference:

- **band thickness / outer radius = 0.345** (measured 51/148 by radial cross-section).
- **Zero at 90 deg, 100 % at 311 deg, over-swing block 311-337 deg.**
- **The over-swing block does NOT jut outside the arc.** Measured radially at 324 deg its colour
  runs r90-r142, exactly the plain band's radii, with the outer white outline at 143-148 in both
  places. **The previous build drew it as a fan sticking a third of a radius past the edge, and
  this file said that was what the reference did. It was wrong** - read off a downscaled contact
  sheet instead of a cross-section.
- **The outline is BLACK OUTSIDE WHITE, on both edges.** Ours had no black at all, and that key is
  most of why the original stays crisp over grass.
- **The band is genuinely see-through**: it measures `#616736` over fairway green and `#474d32`
  over a dark patch. `rgba(75,75,50,0.78)` composites to exactly the first. It has to be punched
  through its own white rim with `destination-out` first, or it lands on 255 and comes out light
  grey - which is what the first attempt looked like.
- **The green stripe is at 91-93 % power and thin**, NOT adjacent to 100 %: the target is a shade
  under full, with the over-swing beyond it.
- **The bar's trapezoid is not decoration.** Its four corners are the band's inner and outer radii
  at the two ends of the accuracy window, so it really is the arc's first 12 % straightened out -
  which is also why the needle inside it is a radial line, exactly vertical only at dead centre.
- Colours, sampled: green `#01da04`, red `#fd0001`, orange `#f07c03`/`#fb8f20`, white `#fffdfc`.

**How to measure a clip like this**: dump every frame with ffmpeg, fit the ring's circle by scoring
candidate circles against white pixels, then per frame cluster the angles whose radial segment is
mostly white. That separates the sweeping needle from the arc's end caps and from the bar's own
outline - the first three attempts all mistook one for another and produced confident nonsense.

### The swing fired on RELEASE, and the camera hid the rollout (2026-09-04)

Matt, playing the one-needle build: *"the ball rolls a tiny bit after landing, but still not much.
It stops unnaturally short. And the power/aim meter feels delayed. I don't think it stops when i
click the swing button."* Three causes, all measured:

**1. THE SWING FIRED ON `pointerup`.** So the needle kept travelling for the whole duration of the
press. Measured against this build's own numbers: an ordinary 120 ms press is 0.104 power units on
the downswing against a `BAR_HALF` of 0.12 - **87 % of the accuracy half-window spent between
seeing the needle and the game reading it.** The player was aiming at where the needle would be.
It fires on `pointerdown` now, and it is timed by **`ev.timeStamp`** - the moment the input
actually happened - rather than by a `performance.now()` read inside the handler, which also
charges however long the event sat in the queue. Measured after: the gap between what the needle
showed and what the swing locked went from ~0.104 to **0.0015** power units.

**2. THE CAMERA TRACKED THE BALL THROUGH THE ROLLOUT**, so a 21 yd run-out moved the ball ZERO
pixels - the course slid past underneath it and the ball sat pinned to the middle of the screen.
The camera now stops dead at touchdown and the ball rolls across the frame. That is what the
reference does: its rollout was measured as frame-to-frame BALL movement decaying 4.5 -> 1.9 ->
0.66 -> 0, which is only possible with a stopped camera. A rollout is at most ~25 yds against a
95 yd view, so the ball cannot leave the frame.

**3. ROLL IGNORED THE CLUB.** `rollFactor` was the landing surface alone, so every club ran the
same 8 % of its carry: a driver 17 yds (real: 20-25) and a lob wedge 4 (real: about 1). Nothing in
the bag behaved like itself. Descent angle was the missing half, and `loft` already carries it, so
the multiplier `1.6 - 1.2 * loft` needed no new field and no new tuning surface. Measured totals on
a fairway now, against real golf:

| club | ours | real |
|---|---|---|
| driver | 236 | ~240 |
| 3 wood | 213 | ~213 |
| 5 iron | 158 | ~158 |
| 9 iron | 116 | ~114 |
| lob wedge | 52 | ~51 |

### The putter's range is a CONSTANT, and briefly was not (2026-09-04)

Matt: *"when i'm putting, regardless of how far the putt is, it changes the max distance i can hit
the putter so that 100% is equal to the hole. If i'm 30 feet away, a 100% power putt will go
exactly 30 feet. If i'm 2 feet away, a 100% power putt will go 2 feet."*

Substantively right. (Precisely it was `distance x 1.4` floored at 6 ft, so 30 ft gave a 42 ft range
with the hole at 71 % and 2 ft gave 6 ft with the hole at 33 %.) Either way **the scale moved under
the player**, so nothing learned on one putt transferred to the next: 60 % power was a different
putt every time. That is a rubber band, not a skill.

It was introduced to widen the tap window when a 2 ft putt needed 3.7 % of an 825 ms ring and could
only be stopped inside about one frame. **That cause is gone**: power is set on the three-click
BACKSWING now, at 1650 ms per power unit. So the range went back to being what it always should
have been - the putter's own stat, exactly like every other club's `carry`.

**Measured, by sweeping real putts through `simulatePutt` and counting the powers that actually
drop** (not by a stopping-distance proxy - the cup captures a ball ROLLING THROUGH it over a range
of speeds, so a proxy under-reports the window badly):

| putt | fixed 60 ft | scaled (old) |
|---|---|---|
| 1 ft | 9.5 frames | 95.8 |
| 4 ft | 9.3 | 46.5 |
| 10 ft | 9.3 | 33.3 |
| 25 ft | 9.5 | 16.2 |
| 40 ft | 9.3 | 10.1 |

**The window is now the same at every distance**, which is exactly what a fixed scale should buy,
and it is BETTER than the scaled version at the long end where putts are actually hard. The scaled
version only looked generous because it was spending the entire meter on a tap-in. Power is now
simply linear in distance: 2 ft = 3.3 %, 15 ft = 25 %, 30 ft = 50 %, 45 ft = 75 %.

A putt longer than 60 ft cannot be holed in one, and the aim ladder says so honestly by putting its
100 % dot short of the cup. Lagging it close is the right play, as in real golf. The ladder is also
now a fixed 60 ft, so its four dots always mean 15/30/45/60 ft - which is why the reference's own
putt dots run off the green and into the trees on a short putt.

`golf/js/test.js` section 11b measures the window by sweeping rather than modelling it, and carries
a `[KNOWN-BUG PROBE]` that the window must be the SAME at every distance.

## Four clips, one whole hole, measured at 60 fps (2026-09-04)

Matt filmed hole 2 of the reference - a 499.2 yd par 5 - in four clips that together are one
continuous hole, and asked what the rollout, the bounce, the sand and the putting actually do. All
4,243 frames were read: the needle's angle in every frame, the accuracy bar's colour bands counted
in pixels, the ball tracked by frame differencing, and the HUD read at full resolution.

**The shot ledger.** Power is the marker planted at tap 2, read off the arc (zero at 90 deg,
100 % at 311 deg); accuracy is where the needle stopped.

| # | club | lie | to pin | power | needle stopped | ring hub | result |
|---|---|---|---|---|---|---|---|
| 1 | driver | tee | 499.2 yd | 91.4 % | 9 deg early | 247.0 yd | -> 253.2 yd |
| 2 | 3 wood | rough | 253.2 yd | 94.6 % | 9 deg early | 196.0 yd | -> bunker, 25.0 yd |
| 3 | 7 iron | greenside bunker | 25.0 yd | 46.6 % | 12 deg early | 21.1 yd | -> 15.0 ft |
| 4 | putter | green | 15.0 ft | 26.7 % | 5 deg early | holed | **Birdie** |

**The ring's hub number is the CARRY, not the total, and shot 2 proves it with arithmetic that
needs no assumption.** A ball that starts 253.2 yds from the pin and finishes 25.0 from it must
have travelled at least 228.2 yds. The hub read 196.0. So 196.0 is not the total, and the ball ran
at least 32.2 yds after it came down - **>= 16.4 % of carry, against our 9.3 %.** (Shot 1 pulls the
other way: hub 247.0 against 246.0 yds of progress, which leaves no room for a run-out unless the
hole doglegs enough for the path to differ from the straight line. It plainly does dogleg, and that
cannot be measured from the footage, so shot 2 - the one that needs no assumption - is what the
roll number comes from.)

**The putter's range is a constant and 60 ft is right.** 15.0 ft holed at 26.7 % implies a full
range of 56 ft. An earlier read of that number as 19.0 ft (and so ~71 ft) was wrong - it came off a
downscaled crop; rendered at 6x the glyphs are unambiguous. `MAX_PUTT_FT` did not move.

### What changed, and the measurement behind each

| change | was | now | measured from |
|---|---|---|---|
| bad-lie accuracy band | worst lie 27 % green | **9.1 %** | 6 px of 66, bunker + rough, identical |
| the orange band | fixed 52 % of the remainder | **40 % clean, 30 % worst** | 12 px and 18 px of 66 |
| meter tempo | one speed, 1650/1150 | **per club, 1685/1140 to 2410/1865** | needle angle, 4 clubs |
| red-miss distance | flat 0.90 | **ramp 0.92 -> 0.60** | a red bunker 7 iron went 21.1 yds |
| roll (surface term) | 0.08 | **0.145** | shot 2's >= 32.2 yd run-out |
| tap 3 -> ball moves | instant | **850 ms** | clip 3: tap f799, ball away f850 |
| camera in the run-out | stopped dead at touchdown | **trails the ball** | pan decays 75k -> 36k -> 18k -> 0 px/frame |

**THE BANDS ARE SET BY THE LIE, NOT THE CLUB.** The player cycled s. wedge -> p. wedge -> 9 iron ->
8 iron -> 7 iron in the bunker and the bar never changed by a pixel. The one exception found:
switching to the PUTTER from the rough widened green from 9 % to 22 %.

**THE ARC NEVER CHANGES AT ALL.** Green stripe 292-296 deg (91.4-93.2 % power), over-swing block
311-338 deg (100-112.2 %), byte-identical on all four lies and every club. **No power cap is ever
shown** - the lie's distance penalty is invisible until the ball lands, exactly as ours works.

**FROM A BAD LIE YOU ARE NOT STRIKING IT PURE, YOU ARE AVOIDING RED.** That is what a 9 % green
band means, and it is the point rather than a cruelty: measured through our own numbers, the green
half-window from a bunker is **1.0 frame** and the orange half-window **4.2 frames** - which is the
reference's own geometry, and matches what its player did (orange from the rough, a fine 196 yd
3 wood; red from the bunker, a 7 iron that went 21). `test.js` section 8b prints the green/orange
window in frames for every lie in the game and **fails if ORANGE ever drops under 3 frames.** That
is the first-playtest lesson applied to the new bands: when a mechanic is a timed input, test the
input. If this proves too punishing, `LIES[].zone` in `clubs.js` is the only thing to raise.

**The meter is not one speed**, and the lie is not what changes it - the driver off a tee and the
3 wood out of rough measured identical, which rules the lie out and leaves the club. Two
regularities carry the fit across all four samples: the downswing is the backswing **minus about
545 ms** (not a fixed multiple), and the backswing is flat across the top of the bag then slows one
step at a time. `swingTempo()` in `clubs.js` is `1685 + max(0, index - 1) * 55`, which reproduces
driver 1685 (measured 1693), 3 wood 1685 (1678) and 7 iron 2070 (2070 exactly), with the putter its
own constant at 2410.

**The red-miss distance penalty is a ramp, not the measured number, and that is deliberate.**
Closing the reference's gap entirely would need about 0.45, but that single sample confounds three
unknowns - the mishit penalty, the greenside bunker's own distance factor, and the club's rating in
a bag that is plainly upgraded (see below). Attributing all of it to the mishit would be inventing a
number from one equation with three unknowns.

### The reference is playing an UPGRADED bag, and our stock ladder is the bottom of it

Converted to like-for-like (carry at 100 %, lie cap removed):

| club | implied 100 % carry | ours (stock) | ours (`upgraded`) |
|---|---|---|---|
| driver | 270.2 | 215 | **269** |
| 3 wood | 244 (at a 0.85 rough cap) | 195 | **244** |

That is not a coincidence, and `clubs.js`'s header already suspected it: the reference's earlier
measured 287 yd drive "was recorded with an unknown, possibly upgraded bag". **So the distances do
not conflict with ours - they are the top of a ladder whose bottom we already ship.** Two separate
jobs live here and they must not be confused: matching the reference's MECHANICS (done above, bag
and courses untouched) and matching its DISTANCES, which would mean shipping the club shop and
re-cutting all 36 holes, since every yardage is deliberately cut to the stock bag.

### Still unbuilt from this footage

- **The result screen.** The reference's hole-out popup shows the course name, the round's score,
  a scorecard (3 holes, par 3/5/4 - the same par 12 as our frozen `pinevalley3`), and **a
  leaderboard of named AI opponents playing the same round** (You -1, U Jett -1, D Clark -1,
  D Marcus even). We have no in-round opponents at all. Whole feature, not a tuning change.
- **The putter switches the distance readout to feet** while it is merely SELECTED, off the green
  (measured: "759.5 Ft" for a 253.2 yd shot). Ours only switches when the ball is on the green.
- **The auto-pick opens on a club that cannot reach** (a 2 iron for 253 yds). Ours picks the
  shortest club that CAN reach.
- **No driver appears in the list off the fairway**, only from the tee. Worth confirming.
- A golfer sprite that WALKS to the ball between shots.

### Two things a second, frame-sampled analysis got wrong, and why

A parallel pass over sampled key frames (about 1 sample per 25 real frames) reported that "the
power meter needle never moves, in any sequence, at any point" and that "no frame shows the ball
travelling". Both are sampling artifacts: the needle's whole sweep is ~2.8 s and the ball's flight
1.5-3 s, so at 2.5 fps every sample can land outside them. **Anything about motion in this game
needs 30-60 fps over a named window; a survey rate can only be trusted for layout.** That same pass
was right about two things this one had wrong (the 15.0 ft putt and the 253.2 yd readout), and it
found the result screen, which this one had stopped 20 frames short of.

### Still open for the next playtest

- **Only 2 of the 5 aim-ladder dots are on screen at address with a driver**, still. The view is
  95 yds wide now, which puts about 155 yds of hole ahead of the ball; the driver's dot 4 is at 215,
  so it takes 110+ yds of free look to reach. Zooming out far enough to show it would cost the
  pixel-art scale (see "The view" above). Probably wants the ball framed lower on a tee shot rather
  than a wider view, but that is a feel call.
- Flight is `0.9s + distance/60` with tap-to-skip, so a drive is ~4.5s. The reference's was 7.5s.
- The aim step is 1.5 deg a tap, auto-repeating at 8/s after 400ms, capped at +/- 60 deg.
- There is still nothing between a lob wedge (50 yds) and the putter. Matt, asked: *"that's fine if
  the other stuff is fixed."* Revisit only if the short game still feels thin.

## Two bugs that were ruining every game (2026-09-04)

Both found from one screenshot and one sentence, and both were one line.

### Every score was a stroke too low

Matt's screenshot: the HUD reads **"par 5 / shot 4"** and the result card reads **"Eagle! Holed in
3"**. Not hole-specific and not intermittent - **every score in the game was one stroke low**, and
an ace would have reported 0.

`_settleShot` has to return EARLY when the ball drops, so the hole can end. That early return sits
above its own `shotN += 1`, so the shot that goes in is never counted - which is correct, because
`shotN` is then already the number of the shot just played. `_showHoleResult` then subtracted one
MORE. It is `const strokes = this.shotN;` now.

**The stored bests were checked, not assumed** (THE LAW rule 1). A fresh RTDB read: 228 player
device records, 25 carrying a golf key, and **`bestRoundByCourse` empty on every one of them** -
no non-zero golf record exists anywhere. Golf is admin-only and Matt had only played practice
holes, which never touch the best. Nothing needed correcting. Had a scored round landed, the
too-good value could never have been fixed by playing better (rule 2), so this check is the one
that has to happen before the fix ships, not after.

`test.js` section 12b reads the shipped `ui.js` as text and fails if the `- 1` returns, and fails
if `_showHoleResult` ever gets a second caller - because "the shot just played" only means "the
shot that holed it" while the holed path is its only entry.

### The ball was bigger than the hole

Matt: *"the ball rolls over the hole without going in - and leaves a 1-3 ft putt after"*, and
separately *"the hole needs to be a little larger. it's a tiny tiny dot right now that does not get
bigger when you zoom into the green"*. **Those are one bug.** Measured at the green view (34 yds
across a 393 px screen, 11.6 px/yd):

| | radius |
|---|---|
| cup, as drawn | **2.8 px** (0.24 yd, and floored at 2.5 px so it never scaled) |
| ball sprite | **3.0 px** |
| capture (`CUP_CAPTURE_YD`) | **3.5 px** (0.30 yd) |

Two sprites that size visibly overlap out to about **0.52 yd** of centre separation, but capture
needs 0.30. Between those two numbers the ball plainly covers the hole on screen, does not drop,
and finishes one to three feet away - exactly the report.

The cup is now drawn at `CUP_CAPTURE_YD * cam.ppy`, **imported from `shot.js` rather than copied**,
so the hole you see and the hole that captures are the same number and cannot drift. It is bigger,
it scales with the zoom, and a ball that looks like it went in did. The floor stays only so the cup
is still visible at the 95-yard fairway view.

## Two courses, thirty-six holes (2026-09-04)

Matt: *"build the remaining 6 holes in this 9 hole course and the back 9. Then you must build a
brand new 18 hole course with a completely different theme than the woodsy one we have now."*

**Pine Valley is eighteen holes of par 72 over 6,489 yards; Red Mesa is eighteen of par 71 over
6,140.** Holes 1-3 of Pine Valley are the hand-authored ones the reference footage documents and
are untouched. The other thirty-three are new.

### Holes are DESIGNED, not typed: `golf/js/holegen.js`

Each hand-authored hole is about sixty coordinate pairs, every one of which has to be re-checked
against the green's slope grid, the tree belts and the bounds whenever anything moves. That is
fine for three holes and impossible for thirty-six - and worse, it is impossible to REVIEW: a
corridor that pinches to nothing at the dogleg looks exactly like one that does not, in a wall of
numbers.

So a hole is now written as a design spec - a centreline, a fairway width profile, and hazards
placed as *"at 0.55 of the way round, 18 yards left"* - and `makeHole()` expands it:

- The centreline is a **Catmull-Rom spline resampled by arc length**, so `at: 0.9` really is 90 %
  of the way round the hole and a dogleg has no corner in its fairway edge.
- Corridors are **offset polygons** with a **backward-point guard**. That guard is load-bearing:
  on the inside of a bend the offsets crowd together and eventually march backwards, which turns
  the polygon into a bow tie - and a self-intersecting polygon makes the ray-cast lie lookup report
  "outside" for a ball plainly standing on the fairway.
- **`cardYards` is the measured centreline length** and `bounds` is measured from what was actually
  built, then padded (45 yds behind the tee, as before). Neither is authored, so neither can go
  stale when a bunker moves.
- **The collar is 6 yards on BOTH axes**, not a scaled-up copy of the green. Scaling proportionally
  looks equivalent and is not: Red Mesa 3's green is 18 x 10, which came out with 6 yards of collar
  across and 3.3 up the hole - so missing it long landed in the desert, a hazard the player was
  never shown.

**It emits the documented shape and nothing else.** A generated hole is an ordinary hole object;
`validateHole()` checks it like any other, and holes 1-3 stay perfectly valid beside it. This is
the trick `treeBelts` already plays - a compact authoring form expanding into the one runtime form
- one level up.

**One new field: `route`**, the playing line coarsened to a point every ~25 yards. Art and tests
only; no rule reads it, exactly like `decor`. It exists because "can this hole be finished?" is a
question a test can only answer by PLAYING the hole, and a test player that aims at the pin from a
dogleg tee walks straight into the trees and reports a good hole as broken. Holes 1-3 got one by
hand, taken off their own fairway midpoints.

### The softlock the 36-hole test found on its first run

`golf/js/test.js` section 14 plays every hole on both courses with clean strikes. It immediately
found a **shipping softlock**: a ball that finished under a tree canopy was blocked on the very
first sample of its next shot, dropped where it stood, and was blocked again - **for ever, with the
meter working perfectly and the ball travelling 0 yards every time.** Fourteen shots, zero yards,
on Pine Valley 3 and 10, where a hand-placed oak sits in the fairway. Hole 3 has had that oak since
Stage B.

`treeHit` now says that **where the ball already is cannot be an obstacle to leaving it**: a tree
the ball is basically touching (inside `trunk + 1.2` yds) is ignored outright, and a tree the ball
is merely UNDER still blocks with its trunk but not with its canopy. A blocked ball also drops two
yards SHORT of the contact point rather than on it, because a ball resting exactly on a trunk is a
ball whose next shot starts inside that trunk. The tree you are ten yards short of - the whole
point of hole 10 - is unchanged.

### Red Mesa is the opposite of Pine Valley on every axis the engine can express

Not a repaint. A second course only earns its place if it plays differently:

- **The ground is the hazard.** `base` is the desert floor and the turf is a narrow ribbon laid on
  top of it. On Pine Valley the fairway sits inside rough inside woods; here it simply stops.
- **The obstacles are not trees.** A **saguaro** (trunk 0.9, canopy 1.8, height 15) cannot be flown
  by anything in the bag, so it is a pillar to go round. A **palo verde** (0.7 / 6.5 / 8) is the
  reverse - trivial to fly with a wedge, impossible with a long iron. A **boulder** (3.2 / 3.2 /
  30) blocks at any height at all. Three genuinely different behaviours out of the same
  `{trunk, canopy, height}` triple the pines already used, with **no engine change**.
- **Shorter and tighter**: par 71 over 6,140 against par 72 over 6,489, with narrower corridors and
  far less rough between the turf and trouble.

**A theme is a PALETTE OVERLAY and nothing else** (`THEMES` in `render.js`) - no new surface kinds,
no new lie rows, no second renderer. A theme that needed its own surface kind would need its own
row in the lie table, its own validator entry and its own line in every test, for a colour. Tree
art is keyed by the TYPE'S NAME, which is why the type tables name their species; an unknown name
falls back to the theme's canopy, so adding a specimen is a data change.

### Yardages are cut to THE STOCK BAG, not to a real scorecard

Driver 215 + 3 wood 195 is the whole of a two-shot hole, so a par 4 over about 400 yards could not
be reached in regulation by anyone, ever - it would be a par 5 wearing a 4. Every hole on both
courses is reachable in regulation with clean strikes, and section 14 asserts it over all 36.

### The round, and what gets written

`golf/js/rounds.js` owns it. Four ways to play each course - **3 holes / front 9 / back 9 /
18 holes** - plus an unscored **practice hole**. One setup screen does the whole choice: course
chips swap the picture and the numbers in place, then a 2 x 2 of round buttons each showing that
round's par, yardage and the player's own best. Two courses of eighteen could have become course
list -> round list -> hole list, three taps deep before a ball is struck, and on a phone that is
where a game gets closed.

**The stats write is guarded three ways, and each guard is THE LAW:**

1. **Only a COMPLETE round is recorded.** Every hole in it must carry a score. Recording a round
   abandoned after three of eighteen holes would store 12 strokes as an EIGHTEEN-hole best, and
   because bests only ever improve (rule 2) that wrong number could never be corrected by playing
   better - it would sit at the top of the leaderboard for ever.
2. **A practice hole never touches `bestRoundByCourse`.** One hole is not a round.
3. **It runs once**, and **verifies by fresh re-read** (rule 6), logging loudly if the best did not
   land.

The difficulty bucket is the COURSE ID, following Skeeball's board-as-difficulty precedent: golf
has no computer opponent and no difficulty setting, so the course is the only honest axis.

### The leaderboard still ranks the three-hole round

`GOLF_BOARD_COURSE` stays `pinevalley3`, deliberately: it is the round a person on a phone actually
finishes, everyone has the course, and it was already the frozen key. Every other round is still
stored, still shown on My Stats and still reachable from a player's own leaderboard detail screen
(rule 1) - it is only the single number on the board that this names. Changing it is one line in
`js/leaderboard-rank.js`.

`GOLF_COURSE_PAR` there duplicates the eight round pars rather than importing the courses:
`js/leaderboard-rank.js` is in the service worker's network-first shell tier and is imported by the
hub's launcher path, so deriving them would drag ~60 KB of polygon data onto the critical path of
every hub load for eight integers. **`golf/js/test.js` fails if the copy ever disagrees with the
course data** - that test is the link that keeps it honest.

## Repo rules that bite in this game specifically

Read `docs/BUILDING-A-GAME.md` Part 0 (the UX floor) before touching any UI, and the game-ui skill's
guidance. The ones this game is most likely to get wrong:

- **`onViewportResize(cb)` from `js/viewport.js`**, never a raw `resize`/`orientationchange`/
  `visualViewport` listener. Hill Climb shipped that bug exactly once.
- **`touchmove` binds to `.gf-root`**, never to `document` or `window`. The swipe surface gets
  `touch-action: none`; tappable controls get `touch-action: manipulation`.
- **`overscroll-behavior: contain`** on any fixed overlay that scrolls (the scorecard).
- **Immersive fit:** one screen at a tall AND a short phone height, standalone AND mounted in the
  hub's real chrome (~138 px of it). `test-visual.mjs`'s `fit` checks. Golf has no entry in that
  suite yet - writing one is the first task of Stage B.
- **`prefers-reduced-motion`** thins garnish (sunburst rays, shake) and never freezes gameplay: the
  ball still flies.
- **No em dashes in user-facing copy.** The round-complete screen gets a close (X) top-right.
- **The player's name comes from `loadProfile()`, defaults-only.** Golf prefills from it and never
  writes back.
- **Every visible string goes through `t()` at RENDER time**, EN and ES, in `js/strings.js`.
