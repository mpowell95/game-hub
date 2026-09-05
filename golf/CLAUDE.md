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
- ~~**The putter switches the distance readout to feet** while it is merely SELECTED, off the green
  (measured: "759.5 Ft" for a 253.2 yd shot). Ours only switches when the ball is on the green.~~
  FIXED 2026-09-04: the readout follows the CLUB, the camera zoom still follows the LIE.
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
- The aim step is 1.0 deg a tap since 2026-09-04, auto-repeating on a ramp from 4/s to 16/s after
  400 ms, capped at +/- 60 deg.
- There is still nothing between a lob wedge (50 yds) and the putter. Matt, asked: *"that's fine if
  the other stuff is fixed."* Revisit only if the short game still feels thin.

## The measuring pass (2026-09-04) - and the meter's scale was wrong

Six things were built from guesses rather than from the footage. This pass measured all six before
any of them got implemented a second time. **One of the answers invalidates a number this file has
asserted since the one-needle rewrite.**

### THE ARC IS ~206 DEGREES, NOT 221, AND THE GREEN STRIPE IS THE 100 % MARK

Matt: *"We need line indicators of where the 25% 50% 75% and 100% powers are. The 100 has the green
line, which is good."* He is describing tick marks - and he is right that they exist, which is how
this was caught.

The band carries **short tick marks at 25 / 50 / 75**, in a light tint rather than white, which is
why an earlier scan with a `> 225` white threshold found nothing. Scanned by LUMINANCE across the
band on the putt frame (the only one with clean green behind the meter rather than a sand bunker),
the profile has three sharp peaks against flat noise:

```
139 deg  ###########################################  <- 25 %
191 deg  ##################################           <- 50 %
243 deg  ############################################ <- 75 %
   everything else sits at 40-55 with no structure
```

Spacing 52.6 and 51.4 deg per 25 %. **That puts zero at ~87 deg and 100 % at ~295 deg: a 206-degree
arc.** Ours draws 90 -> 311, a 221-degree arc, so **our meter is about 7 % too long in angle**.

The consequences are not cosmetic:

| | this file used to say | measured |
|---|---|---|
| 100 % | 311 deg | **~295 deg** |
| the thin green stripe (292-296 deg) | a 91-93 % "sweet spot" short of full | **the 100 % LINE itself** |
| the over-swing block (311-338 deg) | 100-112 % | **107-120 %** |
| `SWING_MAX` | 1.12 | **~1.21** |

And every power in the four-clip shot ledger shifts up about 7 %, which makes the ledger read far
more sensibly - the player is aiming AT the green 100 % line and landing just either side of it:

| shot | marker | old reading | measured |
|---|---|---|---|
| 1 driver | 292 deg | 91.4 % | **98 %** |
| 2 3 wood | 299 deg | 94.6 % | **102 %** |
| 3 7 iron | 193 deg | 46.6 % | **50 %** |
| 4 putter | 149 deg | 26.7 % | **29 %** |

**Where the old number came from:** 311 deg was assumed to be 100 % because that is where the
over-swing block starts, and "the block starts at 100 %" felt obvious. It is not what the ticks
say. The block starts at about 107 %, with a plain buffer between the 100 % line and the danger.

### The other five

- **THE GOLFER DOES NOT MOVE.** Matt: *"the little guy runs forward. it's very strange."* Measured
  across the whole swing animation in clip 3 (frames 800-860): **the sprite's head sits on the same
  pixel in every frame.** Only the club swings. Ours draws the golfer at the BALL's position and
  keeps drawing it for 260 ms after the ball leaves, so it chases the ball down the fairway. The
  sprite itself: about 12 x 20 art pixels - white cap with a dark brim, tan face, light shirt with a
  gold band at the waist, grey trousers, and a club that sweeps through in front of it.
  (Implemented in Batch 4 - see "The golfer stands still" below, which re-measured the TIMING at
  the frame level and corrected one number this bullet got wrong.)
- **THE SLOPE MARKERS ARE ARROWHEADS, AND THEY ARE A DARKER TINT OF THE GREEN.** Two strokes making
  a chevron - a `V` pointing downhill, or the same glyph rotated onto a diagonal. **Fixed size**,
  laid on a regular grid, each glyph about a fifth of the grid spacing, and drawn in a darker shade
  of the putting surface rather than in white. Ours draws a line segment whose LENGTH is the slope
  magnitude, which on real hole data is 1 to 4 pixels - so it renders as the field of dots Matt
  reported, with no readable direction. The fix is a fixed-size arrowhead oriented downhill.
- **THE LIE READOUT IS A PICTURE, NOT A WORD.** An isometric block of the surface itself - a top
  face in that surface's own colour and speckle, a brown soil face beneath it, a black outline -
  with a large dimpled ball sitting on top, overhanging the front edge and casting a small shadow.
  About 60 x 49 CSS px with a 37 px ball. Ours prints the word "Green" in a panel.
- **FLIGHT.** Clip 1's drive: the ball is in motion for **4.53 s** in total (frames 585 to ~857) for
  a 247 yd carry. The split between air and run-out is derived from the camera's pan rate falling
  off around frame 788, which is suggestive but not solid - the camera can ease independently of the
  ball - so only the total is quoted as measured. Ours gives that shot 5.02 s of flight alone.
- **WIND.** The panel reads `wind`, an arrow glyph, and a bare number, and it is **0.9 with the arrow
  pointing down-left in all four clips, unchanged for the whole hole**. Its EFFECT could not be
  isolated: the only shot with a clean before/after is shot 1, which finished essentially on line,
  so the footage gives a magnitude of "not enough to matter at 0.9". Building wind needs either a
  clip with a strong wind or a decision from Matt about how much it should move a ball. Ours
  currently has no wind at all - not in `resolveShot`, not anywhere; the HUD prints a hardcoded 0.

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

## The bag and the HUD (2026-09-04)

Batch 3 of the playtest list. Six changes, all of them about the controls rather than the physics.

**The wedges are spelled out.** `pitch wedge` / `sand wedge` / `lob wedge`, not `p wedge`. In
Spanish the first one is `pitching wedge`, which is what it is actually called there.

**The club ladder WRAPS.** Matt: *"if I press up all the way to driver, it should cycle back to the
Lob Wedge. same for the other direction."* It used to CLAMP at both ends, so the only way back from
the driver was thirteen taps the other way, and holding the button just sat there doing nothing -
which reads as a broken control, not as a limit. `stepClub` is a modulo now.

**THE PUTTER CAN BE TAKEN FROM THE FAIRWAY AND THE TEE.** Matt: *"You should make the putter
available when on the fairway and fringe. Not the rough. But long putts from off the green (from
the fairway or fringe) should be possible."*

This needed one predicate split into three, because `isPuttable` was gating five different things
at once - the auto-pick, the club lock, how the shot resolves, whether the distance reads in feet,
and the camera's zoom - and the new rule pulls them apart:

| question | answer | what it drives |
|---|---|---|
| `mustPutt(lie)` | green, fringe | the auto-pick, the locked ladder, the camera zoom |
| `canPutt(lie)` | + fairway, tee | whether the putter is IN the ladder at all |
| `_putting()` (ui) | the club in hand IS the putter | how the shot resolves, the aim ladder, feet vs yards |

`isPuttable` is still exported as an alias for `mustPutt` so nothing breaks silently. The putter
sits at the SHORT end of a fairway ladder - one step down from the lob wedge - and the wrap past it
comes back to the driver. A putter carried onto a lie that cannot hold one (the ball ran into
rough) hands the bag back rather than swinging a putter out of the cabbage.

**And a putt now knows what it is rolling over.** `PUTT_DRAG` in `shot.js` is a per-surface
multiple of `PUTT_DECEL`: green 1.00, fringe 1.55, fairway and tee 1.90, worse for everything else.
**DECIDED, NOT MEASURED, and labelled as such in the file** - the reference is never once seen
putting from off the green, so there is no footage to measure; the ORDERING is real golf's and that
is the part that matters.

The pace a stroke needs is normalised against `avgPuttDrag` - the drag averaged over the ground the
ball is ABOUT to cross, sampled along the aim line - not against the lie it sits on. Normalising
against the lie alone was measurably wrong in both directions: a full-power putt from the collar was
given enough pace for 60 ft of collar, reached the green after 6 yds and ran **85 ft**; one from the
fairway came up short. With the path averaged, a full-power putt covers 59-60 ft from the green, the
fringe, and the fairway alike, which is what makes the meter mean one thing everywhere.

**The club tile carries a yardage.** `driver / 215 yds`, `putter / 60 ft`. It is the LIE-ADJUSTED
full-power carry, so it drops as the lie worsens - which turns the `Power: 82%` line above it into
something the player can act on rather than just read. The reference's tile has a number; ours had
none, so the only way to learn what a 6 iron was worth from here was to swing it.

**Aim is 1.0 deg a tap, and holding accelerates.** It was 1.5 deg, which at 215 yds moves the
landing 5.6 yds - too coarse to place a drive between two trees. 1.0 deg is 3.8 yds at driver range
and about nine INCHES at wedge range. Holding used to auto-repeat at a flat 8 a second, which is the
worst of both: too fast to place the aim by holding, too slow to cross the arc. It now starts at 4 a
second and ramps to 16 over a second of holding (`HOLD_SLOW_MS` / `HOLD_FAST_MS` / `HOLD_RAMP_MS`),
so a full sweep of the +/-60 deg arc takes about 5 s and a walk from the driver to the lob wedge
about 1.5 s. The repeat is a self-rescheduling `setTimeout`, not a `setInterval`, because the gap
changes on every tick.

**How far the last shot went was already there** and stays where the reference puts it: the hub of
the swing ring. What was wrong with it was WHEN - it used to be written in `_fire`, so the third tap
printed the outcome while the ball was still in the air. It is written in `_settleShot` now.

Covered by `golf/js/test.js` section 6b (twelve assertions on the three predicates, the ladder in
all three lie classes, and the drag ordering) and by `test-visual.mjs`'s play probe, which drives
the real DOM tee-to-cup.

## The golfer stands still, and the view does not slide (2026-09-04)

Batch 4. Two complaints, both about motion the player did not ask for.

**"When I first press Swing, the entire screen moves to show the golfer."** Matt's full sentence:
*"That's not what the reference clips do either. It's [too] much to focus on the power/aim task
when you're moving the whole screen around."*

This was a side effect of a fix. The free look used to snap back the moment the finger lifted,
which was its own bug (*"it still does not let me move around the map of the hole"*), so it was
changed to HOLD where you leave it and return on a tap or when a swing begins. Returning "when a
swing begins" was an eased glide - `previewDx *= 0.78` a frame, about half a second from a
110-yard look - and it starts on the same frame as the backswing. So the one moment in the game
that needs a still screen got the whole course sliding across it.

The swing now SNAPS the view home; a tap on the course still eases, because that one is a
deliberate come-back gesture with nothing else happening and the glide is what makes it read as
the camera travelling rather than as the hole teleporting.

**"The little guy runs forward."** He was drawn at `st.ball` - the LIVE ball - and kept on screen
for 260 ms after impact, so for a quarter of a second he was re-drawn at the flying ball's position
every frame and slid down the fairway behind his own shot. He is drawn at `golferAt` now, which is
the ball's ADDRESS position (`this.ball` is not touched until `_settleShot`, so it already held the
right value). He is also no longer hidden: the reference keeps drawing him and lets the camera pan
off, which is what a golfer watching his own shot looks like.

### The swing animation, re-measured - and one number in Batch 2 was wrong

Batch 2 recorded *"the golfer swinging 815-849"* from a whole-frame motion measure. That is the
window in which SOMETHING changed, not the animation. Re-measured two ways at once over a 130x190
crop around him in clip 3 - the cap's centroid, and the changed-pixel count frame to frame:

| frames | changed px/frame | what it is |
|---|---|---|
| 770-814 | 4-6 (noise) | **completely static.** Identical cap centroid to two decimal places in all 45 frames |
| 815, 816, 819, 820 | 924, 747, 1192, 953 | the swing: **four sprites over ~100 ms** |
| 817, 818, 821-846 | 6-19 | static again, at a new pose, **held ~440 ms** |
| 847+ | 1200-2700 | the camera pans; the cap tracks off screen at a steady 1.9 px a frame |

So relative to the third tap (frame 799), and against `WINDUP_MS` of 850:

- **265 ms of nothing at all.** Not the club, not the body.
- **~85 ms of animation**, four frames.
- **~500 ms holding the finish**, then the ball leaves.

It is a quick flourish and a long hold, not a smooth arc. `POSE_STILL_MS` / `POSE_BACK_MS` /
`POSE_THRU_MS` in `ui.js` are those numbers, and `drawGolfer` gained a fourth pose (the finish) for
the half-second it is actually on screen.

**And the golfer must not animate during the SWING METER.** Ours played the backswing pose from the
first tap. The reference sprite is byte-identical for the whole meter and for 265 ms after the third
tap - the 45-frame static run above starts well before tap 3 and runs straight through it.

`golf/js/test.js` section 12c pins all of it: both KNOWN-BUG PROBEs read the shipped `ui.js` and
`render.js` as text, because both defects are about WHICH VALUE a line uses and no engine call could
have caught either. It also reads the three pose constants out of the file and fails if they drift
outside the measured windows, so a retune needs a new measurement rather than a guess.

## What the ball does when it lands, and the wind (2026-09-05)

Batch 5. Three items, and one of them is a whole missing force.

### It bounces, then it rolls

Matt: *"the roll looks unnatural... it lands then slides. it doesn't look like it's rolling, and it
almost never bounces."*

Both halves of that were ONE mistake. `groundPoint` was a single smooth deceleration curve for the
whole run-out (`1 - (1-p)^2`) with a sine wave laid on top for height. So the ball's forward speed
never changed abruptly at any point, which is exactly what sliding looks like, and the wave's peaks
did not line up with anything the distance was doing.

A real ball does two different things one after the other, and they have to be two different curves:

- **While it is in the air it does not slow down.** Each hop is now LINEAR in distance and a
  parabola in height. The step change in speed at each landing is the whole reason a bounce reads
  as a bounce from directly overhead, where the only height cue is the shadow gap.
- **Once it is rolling it decelerates smoothly** to a stop.

Three hops with geometrically decaying length (`HOP_DECAY` 0.55) carry `HOP_SHARE` (55 %) of the
run-out in `HOP_TIME` (35 %) of its duration; the roll carries the rest.

**The hop was also too small to SEE.** It was `apex * 0.10` decayed - about 4 px on a 393 px phone
against a 6 px ball, under the renderer's own `lift > 1` shadow gate for most of its arc. It is
`apex * 0.14 + 0.8` yd now, **measured at 14.3 px for a driver**, and capped at a third of the
run-out so a lob wedge that runs 2.9 yds does not leap 4 yds into the air (its hop measures
0.96 yd).

`landedOn` kills the hops where a ball does not bounce: sand swallows it and heavy rough traps it,
so those roll from a standing start.

### Roll SPEED by surface, not just roll distance

Matt: *"the roll speed and distance should also depend on the surface type it's on."* The distance
already did (`clubs.js`'s `rollFactor`); the speed did not, so a ball running out on a green and one
dying in heavy rough took the same time to cover their different distances.

`rollMs(rollYd, kind)` now reuses **`PUTT_DRAG`** - the table Batch 3 added for putting off the
green - normalised so the FAIRWAY is 1.00 (the putting table is normalised on the green, because
that is where putts happen). One table for both, so a surface cannot be fast for a putt and slow for
a run-out. The same 20 yds: **green 4.20 s, fairway 3.05 s, heavy rough 1.88 s.**

### Wind, which did not exist at all

Matt: *"Do you have wind blow on any hole? I haven't seen it yet."* The panel was there, wired to a
hardcoded `0`. There was no wind term anywhere in `shot.js`.

**MEASURED off all four reference clips at full resolution:** the panel reads `wind`, then a CHUNKY
white arrow, then the speed as a bare number to one decimal - `0.9`, **identical in every frame of
every clip**, with no unit named. So the wind is a **constant for the hole**. The arrow is fat: a
broad head about two-thirds the glyph's width over a short stubby tail, pointing down-right in this
hole's footage. The stepped edges are the diagonal's own pixel stair-stepping, not a serration.

**The STRENGTH is decided, not measured, and `shot.js` says so in its own header.** The effect could
not be isolated from one clean shot at 0.9, which the Batch 2 pass already recorded. So it is
calibrated against what the PLAYER can do about it instead: full wind (2.0) straight across moves a
driver **12.0 yds**, which is 3.2 degrees at 215 yds - three taps of the aim arrow now that a tap is
1.0 degree. A correction, not a wall. Along the shot it is worth **5.6 %** either way on a driver.

- `windFor(hole)` is **deterministic per hole** and deliberately not per round: the reference's wind
  does not change during a hole, a hole that plays differently every visit cannot be learned, and a
  test that has to stub the weather is a test that stops covering the weather. Seeded from the hole
  number and its card yardage, which differ between the two courses, so **no hole data changed**.
  A hole may state its own `wind` field and that wins - nothing shipped does, but it is what lets a
  test assert a club's distance without the weather in the way.
- Speeds are 0.0-2.0 in tenths; **6 of the 36 holes are dead calm**, which is what makes a windy one
  register as windy. Eight compass points, all eight used.
- It is folded into the carry and the lateral offset **before** the tree test, not added to the
  landing point afterwards - a ball blown into a tree has to hit the tree.
- **Putts are unaffected.** Wind does not move a rolling ball meaningfully and it would make putting
  unreadable.

Every hole on both courses still finishes in par+2 or better with the weather on.

### And the HUD panels are hatched

Measured off the same wind-panel crop: the reference's panels are **translucent dark with fine
diagonal stripes** running the same way as the swing meter's band, plus a black outer edge and a
light inner rule. Ours were flat boxes, which is most of why the HUD sat ON the course rather than
over it. One CSS variable (`--gf-hatch`) on `.gf-panel`, so every panel matches at once.

Covered by `golf/js/test.js` sections **9b** (wind: determinism, range, the eight bearings, the
calm count, that a hole's own field wins, and the four calibration numbers), **9c** (the run-out:
monotonic, faster in the hops than in the roll, three decaying peaks, the hop measured in PIXELS
against the ball's own size, and no bounce out of sand or heavy rough) and **9d** (roll time by
surface). Section 9's club-distance assertions now run against a **calm clone of hole 1**, because
every one of them is about the club and the lie and hole 1's own 1.4 wind is worth about 6 yds on a
drive.

## Reading the course - and the meter's scale was wrong (2026-09-05)

Batch 6. Three items off the playtest list, plus the correction the Batch 2 measuring pass found and
parked.

### The arc is 208 degrees, not 221 - and everything on that page moved with it

The one-needle rewrite ASSUMED 100 % sat where the over-swing block starts (311 deg), because that
felt obvious. Matt pointed out the reference has tick marks at 25/50/75 and that *"the 100 has the
green line"*, and finding those ticks is what caught it: they are a LIGHT TINT rather than white, so
an earlier scan thresholded at >225 missed them entirely.

MEASURED by luminance across the band on the putt frame (the only one with clean green behind the
meter rather than a sand bunker): three sharp peaks against flat noise at **139.0 / 191.6 /
243.0 deg**, spaced 52.6 and 51.4 per 25 %. So the scale is **208 deg per 100 % with zero at 87**.

| | assumed | MEASURED |
|---|---|---|
| 100 % power | 311 deg | **295 deg** |
| the green stripe | 91-93 % power | **98.5-100.4 % - it IS the 100 % line** |
| the over-swing block | 100-112 % | **107.6-120.6 %, with a plain buffer before it** |
| `SWING_MAX` | 1.12 | **1.206** |
| the accuracy window | +/- 0.12 | **+/- 0.137** |

`BAR_HALF` fell out of the same regression: the 60 fps trace gives the bar marker as a linear
function of the needle's angle at -0.0175 per degree, so the bar is 57.1 deg of arc; at 2.08 deg per
1 % that is +/- 0.137, and the old 0.12 was that same 57.1 deg divided by the wrong 2.21.

**THE TEMPO CONSTANTS MOVED TOO, AND THE FEEL DID NOT.** Milliseconds per power unit are the
measured degrees-per-frame divided by the arc's width, so they all shrank about 6 %. The needle's
speed ON SCREEN is exactly what it always was; a power unit is simply 6 % less arc than we thought.
`UP_MS` / `DOWN_MS` are 1585 / 1080. (The per-club constants this paragraph used to list -
`TEMPO_BASE_MS` and friends - were removed the next day when the per-club tempo was reverted; see
"The tempo was never asked for" below.)

**The over-swing penalty is a ramp now, not a step.** It was a flat 1.5x on the miss angle for
anything past 100 %, which was fine while the top of the arc was 112 %; at 120.6 % a flat multiplier
makes "hold it to the top" worth 21 % more distance for a fixed price. It runs 1.0x at exactly 100 %
to `OVER_SWING_MAX_MUL` (2.0) at the top. **The ramp's endpoints are DECIDED, not measured** - the
footage shows where the danger band is drawn but never shows a shot struck inside it - and starting
the ramp at 100 rather than at the block's edge is the deliberately conservative reading, because
marking the buffer as free would make 107 % the obvious swing on every shot in the game.

> **STILL OPEN, and it is Matt's call:** even with the ramp, over-swinging is probably the dominant
> strategy. The mishit angle inside the green band is at most 1.5 deg and distance is linear in
> power, so 21 % more yards beats a few yards of miss on almost every shot. Making the block cost
> DISTANCE as well as accuracy is the obvious lever. It is not a thing to slip in under a rendering
> change, so it has not been.

### The tick lines exist

Matt: *"We need line indicators of where the 25% 50% 75% and 100% powers are. The 100 has the green
line, which is good. but the others need lines as well."* Three light-tint lines across the band at
the measured angles; the 100 % one is the green stripe. The tint is chosen to match "a light tint,
not white" rather than sampled - the meter sits over a sand bunker in three of the four clips, and
the fourth is the putt frame the angles came from, where the line's colour is mixed with the band.

`ARC_A0_DEG` and `ARC_DEG_PER_UNIT` live in **`swing.js`**, not in the painter: the scale is what
converts the needle's measured speed into power units, and two copies is how the meter and the model
drift apart while both look perfectly reasonable.

### The green's slope read is chevrons, and it is not in the map any more

Matt: *"all of the greens you've created have dots all over them. I think you mistook the arrows
indicating slope from the example game for decoration."*

Two separate mistakes:

1. **The glyph's LENGTH was the slope magnitude.** On real hole data that is 1 to 4 px, so it
   rendered as a field of dots with no readable direction. MEASURED off the reference's putt frame
   at 1:1: the glyph is a **FIXED 18-30 device px on a 96 x 96 px grid** (0.19 to 0.31 of the
   spacing, depending which way the chevron is turned) and the DIRECTION is the whole of what it
   encodes. Its colour is **(94,114,48) against a green of (174,199,82) - about 57 % of the
   surface's own brightness**, so it is derived from the palette rather than being a fourth green
   somebody has to keep in step.
2. **It was rasterised into the map** at `MAP_PPY` (2.4 px/yd), where a 3.5 yd slope cell is 8.4 px
   and a faithful glyph would be 1.6 px. There is no drawing that survives that. It is a
   **screen-space overlay** now (`drawSlope`), so it grows with the zoom - which is when it is used,
   since the camera tightens to 34 yds for a putt - and it is skipped entirely below 3.5 px.

A cell with no meaningful gradient gets no glyph: an arrow has to point somewhere, and "flat" is a
real thing for the read to say.

**`slopeGlyphAngle` is a named pure function with a test, not an expression inside a draw loop**,
because the screen y axis is flipped (`sy` is `cam.y - y`) and building the chevron straight from
the world gradient points every arrow UPHILL while looking entirely plausible - the exact failure
`holes.js` warns about for the grid itself.

### The lie readout is a picture

Ours printed the word "Green" in a panel. MEASURED off the reference at full resolution: an
**isometric block of the surface itself** - a top face in that surface's own colour with a lighter
speckle, a brown soil band across the bottom, a hard black outline with rounded corners - and a
large dimpled ball sitting on it, overhanging the top edge, with a soft shadow beneath it.

Proportions are measured off its own tile: the block is 1070 x 920 device px, the ball is 620 across
(0.58 of the width, 0.67 of the height), it overhangs the top by 26 % of itself, and the soil band is
the bottom 16 %. A first pass made the ball too big and there was almost no surface left to look at,
which is the whole point of the tile.

The colours are **not a second palette**: `fillsFor` is the same map the GROUND is painted from, so
the tile cannot show a green the course does not have, and a theme change carries it automatically.
The speckle, the shadow and the chevrons are all tints of that same colour. The lie's NAME survives
on the element's `aria-label` - a picture is the right readout for a glance and the wrong one for a
screen reader.

Covered by `golf/js/test.js` section **12d**: the chevron's flip (a KNOWN-BUG PROBE, since nothing
at runtime would notice), that the glyph is fixed-size and drawn per frame, the measured tick angles
against `ARC_A0_DEG`/`ARC_DEG_PER_UNIT`, the buffer before the block, that the meter reads the scale
from `swing.js` rather than keeping a copy, and that the lie tile is a picture painted from
`fillsFor`.

## The course art pass (2026-09-05)

Batch 8, and every number in it is measured off the reference at 1:1 rather than eyeballed.

### The dark seam where two surfaces meet

Scanning a row straight across a fairway edge (s1-tee frame 30, y=1150, left to right out of the
rough):

| x | colour | what |
|---|---|---|
| 230-250 | (110,129,44) | heavy rough |
| **252-256** | **(98,119,41)** | **a darker line, ~5 device px - darker than BOTH sides** |
| 258-274 | (117,144,58) | a step lighter |
| 276-280 | (134,161,72) | another step |
| 282+ | (154,177,92) | fairway |

The line measures **0.87x the rough's own brightness**, so it is a DARKENING rather than a colour.
That is why it ships as translucent black (`SEAM_ALPHA`) and not as a fourth green: one rule then
covers every pair - sand on grass, water on grass, green on its collar - and the seam cannot be a
shade that disagrees with the surfaces either side of it, because it is made of them. It is stroked
OUTSIDE the clip so it lands on both.

### The rough has grass in it

Small `V` tuft glyphs in a lighter tint, roughly one every 3.4 yards and about 0.65 yd across.
Seeded per surface (`mulberry32`, the same reason `expandBelt` is seeded) so a hole grows the same
grass on every device and in every test run. The base's tufts are laid down BEFORE any surface is
painted over them, which is what makes it cheap: a tuft where the fairway will be is simply covered.

### Water does not meet the grass directly

Measured down a column through a shoreline (frame 30, x=560):

| device px | colour | what |
|---|---|---|
| ~6 | (158,179,73) -> (175,177,103) | a pale grass lip |
| ~12 | (117,58,56) -> (153,82,100) | **a red-brown DIRT BANK** |
| ~6 | (56,42,33) -> (51,46,72) | a near-black mud line |
| then | (14,77,119) / (25,144,231) / (17,109,188) | water, in horizontal BANDS |

So: `bank`, `bankMud`, `waterEdge` (the deep water hugging the shore) and `waterBand` are all new,
and `water` is now the BRIGHT ripple rather than the body.

**The ripples are deliberately fainter than the measurement.** That column was taken in shallow
water right at the shore, where the contrast is at its highest; drawn at that strength across a
whole pond it reads as a barcode - which is exactly what the first attempt looked like. Half alpha
over a 10 yd period is the same rhythm without the shout.

### Bunkers have a bank

A stepped darker-cream rim inside the sand's edge, which is what makes one read as a dish rather
than as a puddle of cream.

### Trees, rebuilt

Ours was a flat disc with a slightly darker rim. A 1:1 crop of the original shows four things, and
all four are what make a belt read as woodland rather than as a row of buttons:

- **a hard BLACK outline**, not a dark-green rim - that key line is what holds a canopy together
  against grass at this pixel size, the same trick the swing meter needs;
- **a mottled two-tone canopy** - measured (104,105,22) as the body against (146,152,18) highlights,
  in clumps rather than dithered;
- **the highlight biased upper-left**, so a whole belt is lit from one direction;
- **a lumpy underside** rather than a clean arc.

**THE SILHOUETTE IS A UNION OF CIRCLES AND EVERY ONE FITS INSIDE `type.canopy`.** `shot.js`'s
`treeHit` tests the ball against that radius, and this renderer's whole contract is that what is
painted is what stops the ball - a bump sticking out past `r` would be a tree the ball flies through.
`treeShapes` is an exported pure function with a test on exactly that (measured 9.94 of 10), not four
literals inside a draw loop.

**And the key line is FILLED UNDER the canopy at a larger radius, never stroked over it.** Stroking a
multi-arc path outlines every SUB-path, so the first attempt drew a black ring around each bump and
the belt came out looking like a row of mushrooms. `test.js` carries that as a KNOWN-BUG PROBE.

Covered by `golf/js/test.js` section **12e**, including a check that BOTH themes define every new
palette key - a missing one paints `undefined`, which canvas silently ignores, so a desert hole
would simply lose its water.

## The tempo was never asked for, and the green zone was (2026-09-05)

Matt, on being told the per-club meter tempo had shipped: *"I did NOT instruct you to change
anything about tempo. I specifically stated to fix the width of the green zone in the aim/power
meter."*

He is right, and this is worth writing down as a process failure rather than as a tuning note.

### What happened

The per-club tempo came out of the **measuring pass**, not out of the playtest list. The needle was
tracked frame by frame across four reference shots and it plainly runs at different speeds for
different clubs - 2.18 deg/frame for a driver, 2.20 for a 3 wood, 1.78 for a 7 iron, 1.53 for the
putter, against our one fixed speed for the whole bag. Under the standing "measure everything and
reproduce it exactly" instruction that looked like a finding to ship.

**THE MEASUREMENT WAS RIGHT AND SHIPPING IT WAS STILL WRONG.** A measurement is a fact about the
reference; a change to how the game plays is a decision, and that decision was not on the list.
Worse, it was later offered as the answer to a request it does not answer:

- The complaint on the list is *"Driver off the fairway shouldn't be super easy to hit."*
- What the tempo change actually did was leave the driver about where it was and make the SHORT
  clubs and the putter SLOWER - so the half of the bag that was already easiest got easier.

**The rule: a measurement that nobody asked to act on goes in the docs, not in the build.** The
degrees-per-frame figures are kept in `clubs.js`'s `swingTempo` header for exactly that reason - the
next session to watch that footage will find them again and needs to know it was a decision not to
ship them, not an oversight.

### What the request actually was, and what it now does

`swingZone(club)` in `clubs.js`: a multiplier on the GREEN band that runs from `ZONE_DRIVER` (0.72)
at the top of the bag to 1.00 at the bottom, linearly by index. The putter gets the full band.

    driver off a fairway    39.2 % green
    lob wedge, same lie     54.5 %

It multiplies the LIE's zone rather than replacing it, and it **deliberately does not touch the
orange band** - orange's job is that a bad lie stays hittable, which is a property of where the ball
is sitting, not of what is being swung at it. Letting the club shrink orange too would make a driver
out of a bunker a coin flip. `test.js` section 8b asserts that separation, and still measures the
orange half-window in frames for every lie **with a driver in hand** - the worst case now available -
against the 3-frame floor the first playtest established.

### And the measurement points the other way, which is recorded rather than buried

Four reference shots at 60 fps: a driver off a tee and a putter on a green both measured **54.5 %**
green; a 3 wood from rough and a 7 iron from a bunker both measured **9.1 %** - byte-identical within
each pair, across very different clubs. On that evidence the reference's band tracks the LIE and not
the club at all.

Matt was told this and asked for it anyway. It is his game and it is a better rule than the
reference's - a driver that is exactly as forgiving as a wedge is the thing he noticed. Written down
so the next session does not "fix" it back to match the footage.

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
