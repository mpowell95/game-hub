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
| C | Hazards and the drop prompt, the result banner, the scorecard, the round | **the round and the drop prompt are done**; the sunburst banner is not |
| D | Stats wiring, this file, `sw.js`, the full test sweep, release | **done** (My Stats' to-par landed 2026-09-06); release is a tap on the admin page |
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

**My Stats shows a best round as a score TO PAR beside the strokes (asked 2026-09-03, done
2026-09-06).** This paragraph used to say "not done yet" and stayed that way for three days after
it shipped, which is how a doc starts costing time instead of saving it - a session reading it
would rebuild finished work. Par is subtracted at DISPLAY time in `js/game-stats-ui.js` from the
same `GOLF_COURSE_PAR` the board uses; the stored value stays STROKES, which is the frozen recorder
shape (rule 5), and the strokes column stays beside it because it is the number the game's own
scorecard shows (rule 1).

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
| 100 % power | 311 deg | **298 deg** (see the A0 correction below) |
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

## Zero is 90 degrees, and the tick scan was 3 degrees out (2026-09-05)

Matt, the day the corrected arc shipped: *"whoa wait - go in and look at the power/aim meter. You
moved it up and to the left and rotated it in an odd way."*

He was right, and the cause is one constant. The tick scan put zero at **87 deg**, and the accuracy
bar's corners are `ang(+/- BAR_HALF)` - so anything other than 90 TILTS THE WHOLE BAR. Measured on
our own render: the two ends came out 1.8 px apart in height, **3 degrees off level**, on a
horizontal pixel-art bar. It reads as broken.

**THE REFERENCE'S OWN BAR SETTLES IT.** Cropped at 1:1, the white line along the top of its
red/orange/green stripes runs **dead horizontal**. That is a far more robust observable than a
luminance scan around an annulus, because **it needs no estimate of where the ring's centre is** -
and an estimated centre is exactly what was wrong.

Against a 90-degree zero, every angle the scan produced is about 3 degrees low:

| | scan | expected at A0 = 90 |
|---|---|---|
| 25 % | 139.0 | 142 |
| 50 % | 191.6 | 194 |
| 75 % | 243.0 | 246 |
| the block's start | 311 | 314 |
| the arc's end | 338 | 341 |

**A CONSTANT offset across all five** - a rotated centre estimate, not a different scale.

**So the correction is `ARC_A0_DEG` alone, and nothing else moves.** Every percentage in the section
above is a DIFFERENCE of two angles that shared the same bias, so it cancels: `SWING_MAX` is still
120.6 % ((341-90)/2.08), `BLOCK_FROM` still 107.6 %, the green stripe still 98.6-100.5 % - the 100 %
line, which is what Matt said it was. And `ARC_DEG_PER_UNIT` is set by the tick SPACING (52.6 and
51.4 deg per 25 %), which a centre error of this size does not disturb at all.

**The tick labels did genuinely move**, and that part is the measurement, not the bug: on a 208-degree
arc the 100 sits at 298 deg where the old 221-degree build drew it at 311. What was wrong was the
tilt.

`golf/js/test.js` section 12d now carries a KNOWN-BUG PROBE on the geometry rather than only on the
angles: the bar's two ends must be at the same height and its midpoint must be under the ring's
centre, which is true if and only if zero is straight down. The scan's raw angles are still asserted,
with the +3 correction applied and named.

## The over-swing is a gamble now, not free money (2026-09-05)

Matt, after turning the dials himself: *"The max carry at the farthest past 100% and spot on should
only be 240-245. I want it to go 20-30 yards offline. high risk."*

### Why the multiplier could never have delivered that

`OVER_SWING_MAX_MUL` multiplies the miss. **The power is locked at tap 2 and the accuracy attempt
happens at tap 3**, so the multiplier is set in advance and applied to whatever miss follows - and a
PERFECT strike has no miss to multiply. Two times zero is zero, and so is four and a half times zero.

Measured, before this: a driver held to the top of the arc carried **259 yds against 215 for a clean
100 %, and went 0.0 yds offline.** So the best play on every full shot in the game was tap, wait,
tap - never using tap 2 at all, which is the tap the whole three-click mechanic is built around.

### The two rules that fix it

Both live in `swing.js`, both fire only past `BLOCK_FROM`, and both scale with how deep into the
block the swing went (`blockDepth`).

| | | |
|---|---|---|
| `BLOCK_KEEPS_DIST` | **0.40** | how much of the over-swing's extra power becomes yards |
| `BLOCK_SPRAY_DEG` | **5.9** | a push offline that does NOT care how well the ball was struck |
| `BLOCK_SPRAY_JITTER` | **0.20** | +/- 20 % on the spray, and it takes a random side |

Measured after, driver off a fairway, **dead-centre strike**:

| swing | carry | offline |
|---|---|---|
| 100 % | 215.0 | 0.0 |
| 107.6 % (the block's edge) | 231.3 | 0.0 |
| 112 % | 235.1 | 6.6 - 9.8 |
| 116 % | 238.6 | 12.8 - 19.1 |
| 120.6 % (the top) | **242.5** | **20.2 - 30.1** |

Both of Matt's numbers, hit: 240-245 of carry, 20-30 yards offline.

**THE SPRAY IS THE HALF THAT MATTERS**, because it is the only one a good player cannot out-skill.
The distance falloff alone would just make the over-swing a worse deal; the spray makes it a coin
flip. It takes a random SIDE, so the top of the arc is 20-30 yards left OR right rather than a
fixed, learnable push.

**ITS RANDOMNESS IS SEEDED FROM THE SHOT ITSELF** - the ball's position and the exact needle stop -
never from `Math.random`. The player cannot predict it, and `resolveShot` stays a pure function of
its inputs, which is what lets section 14 play out all 36 holes and get the same answer every run.
`test.js` asserts that purity directly.

Covered by `golf/js/test.js` section **8c**, including a KNOWN-BUG PROBE that a perfect strike at the
top goes 20-30 yds offline - it used to return exactly 0.0 at any power, which was the bug.

## The club art is Matt's, and it comes as ONE canvas (2026-09-05)

Three rounds of my own attempts came back wrong - *"None of the clubs are even shaped right, and the
putter has the club shaft coming out of the center of the club - which the example does NOT"*, then
*"Why did you guess at the shapes of the clubs and invent shapes?"*. Matt drew them himself in
Claude Design instead. Five heads for fourteen clubs, in `golf/js/club-art.js`:

| symbol | clubs |
|---|---|
| `driverArt` | driver |
| `woodArt` | 3 wood, 5 wood |
| `ironArt` | 2-9 iron |
| `wedgeArt` | pitch, sand, lob |
| `putterArt` | putter |

**THEY ARE DRAWN ON ONE SHARED CANVAS AND MUST STAY ON IT.** Measured bounding boxes: driver
165x167, wood 129x131, iron 125x127, wedge 132x135, putter 147x111. The driver's head really is
bigger than the 3 wood's and the wedge really is more lofted than the iron - but only if every
symbol renders through the SAME viewBox, which is why `CLUB_ART_VIEWBOX` (`4 6 176 178`, the union
of all five plus a margin) is one constant and not five. Giving a club its own box to "make it fit"
throws the bag's proportions away, and that was the complaint that started this.

**Every id in the defs is prefixed `gf-`.** They arrived named `steelFace`, `headClip`, `faceGlow`
and so on, which would sooner or later collide with another game's markup in the hub's single
document - and an SVG id collision is silent. It just paints the wrong thing.

**A CLUB CAN ALSO CARRY ITS OWN SIZE, and the two woods do.** Matt: *"make the 3 wood a little
bigger than the 5 wood. it's ok if you have to make the driver bigger as well so there's a clear
step down."* They share one drawing, so without `CLUB_SCALE` a 3 wood and a 5 wood were the same
picture with a different name. Driver 1.06, 3 wood 0.98, 5 wood 0.82, taken ABOUT THE ART'S CENTRE
so a club grows in place rather than drifting into a corner - rendered heights of 53.6 / 39.0 /
32.6 px in the 54 px tile, which reads as a ladder.

**The driver's 1.06 is the largest that still fits the viewBox**: scaled about the centre it lands
at x 4.2-179.6, y 7.0-183.7 against a box of x 4-180, y 6-184. Anything larger needs the viewBox
widened, which shrinks every OTHER club in the tile. Check that arithmetic before raising it. The
irons and wedges are deliberately all one size - there are eight irons and no sensible ladder to
draw between a 4 and a 5.

The defs are injected ONCE per play screen into a zero-size `<svg class="gf-artdefs">`; a tile is
then one `<use href="#gf-driverArt">`, so changing club costs a reference rather than re-parsing
19 KB of markup. The art area grew 42px -> 54px because the heads are near-square and the reference's
tile is mostly picture; `test-visual.mjs`'s fit checks at both phone heights and in both hosts are
what keep that honest.

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

## The fairways were rectangles, and the woods were ribbons (2026-09-05)

Matt: *"fix everything. AND the stuff you haven't mentioned yet. Your fairways and stuff are almost
perfect rectangles. So it's not challenging or fun. Look at the real holes. The fairways look more
natural. There are actual obstacles. It's challenging and fun."*

Two jobs, and the second is the bigger one. Everything below was MEASURED off s1-tee frame 30
(1206 x 2622, read at 1:1) before a line was changed, because the standing instruction on this
clone is that nothing gets guessed at twice.

### What the reference's ground actually does

Scanned every 8 rows across the fairway's own colour, from y=940 to y=2116:

| | reference | ours, before |
|---|---|---|
| fairway width along ONE hole | **106 -> 563 px, a 5.3 : 1 range** | <= 1.9 : 1 |
| how far the LEFT edge wandered | **sd 40 px** - a near-straight wall for 776 px | symmetric by construction |
| how far the RIGHT edge wandered | **sd 77 px** over the same run | identical to the left, always |
| mow stripe period | **48 px** = 16 dark / 32 light, ~3.8 yds | 14 yds |
| the mow pair | (155,177,92) / (148,171,83) - **7 levels, ~4 %** | 16 levels, ~9 % |
| a tree canopy | ~155 px, and the belt is **one mass 246 x 1040 px** | 9 yds at 9 yd spacing: touching at best |
| a tree's shadow | **1.2x the crown wide, 0.7x tall, 0.85x the ground's brightness** | none at all |
| chevrons on the FAIRWAY | **there are none.** Two mow tones plus shadows, nothing else | n/a |

That last row is a correction to my own earlier note, which listed fairway chevrons as an
unmeasured item. The fairway carries no glyphs; the chevrons are the GREEN's slope read and
nothing else.

### The corridor

`fwAt` fed BOTH sides of `corridor()`, so every fairway on the property was exactly symmetric about
its centreline, and the authored profiles ran 11-19 yds of half-width. A wavy line offset equally
both ways is a rectangle with a bend in it, which is precisely what Matt was looking at.

Three things fix it, and **only the first is a measurement** - the other two are design, said out
loud here so a later session does not go hunting for footage that supports them:

1. **`EDGE_WOBBLE`** - each side gets two sine waves at unrelated wavelengths, phases and
   amplitudes from the hole's own seed. Amplitude is a FRACTION of the corridor's width, so a 9 yd
   neck does not get a 6 yd wobble and close itself.
2. **`CURVE_ASYM`** - a bend is wider on the OUTSIDE. Real architecture: the outside is where the
   safe line finishes and the inside is the corner you are being tempted to cut. It also produces
   the measured signature directly, because a centreline that bends while one edge holds station IS
   an asymmetric corridor.
3. **`PINCH` at the LANDING ZONES** - the stock ladder says a drive carries 215 and a 3 wood 195, so
   a hole knows its own landing zones from its par and its length, and that is where the fairway is
   squeezed (Gaussian, not a step, so it necks and reopens rather than stepping through a doorway).
   **This is the whole of "challenging and fun": the shot you actually hit is the one defended.**

`fwL` / `fwR` override one side outright for a hole that wants a specific shape. Measured after:
the median hole's width now ranges **2.4 : 1** and the widest **5.4 : 1**, against <= 1.9 before.

### Hole 1 was hand-authored, and it was the worst one

Eight points a side at a **dead constant 15 yd half-width** - a 1.0 : 1 corridor, on the first hole
anybody plays. Its two corridor rings were re-cut against the same rule (neck to 9-10 at 215,
opening to 19-21 either side, the left edge swinging while the right holds), and it gained the
fairway bunker the generated holes now get automatically. Its centreline, water, green, slope grid
and greenside bunkers are untouched.

### And then three MORE offsets showed up behind it

The first overview render after the corridor fix made them obvious, and each is a rectangle one
step further out:

- **The rough was a perfect halo.** A constant `roughPad` added to a wandering fairway just traces
  it. It wanders on its own wavelengths now, per side.
- **A wood was a ribbon.** Both belt edges were a fixed offset from the rough, so however much the
  hole breathed the trees were a band of unvarying depth tracking it. The inner edge noses in and
  out on one wave and the depth swells on another - but the nose **stays outside the rough**,
  because letting it go negative put trees in the light rough on Pine Valley 15 and softlocked the
  ball there.
- **Every green was the same circle at a different size.** `greenPoly` drew a perfect 12-gon. It
  takes a seed now and `greenShape` returns twelve smoothed radius factors; **a green and its own
  fringe must share that seed**, or the collar crosses the putting surface and the lie lookup
  flickers along the seam.

### Obstacles where the ball goes

A hole that pinches at the landing zone and puts nothing in the pinch is asking the player to avoid
a colour. Every landing zone with no authored hazard within `DEFEND_NEAR` (38 yds) now gets a
fairway bunker dug into the OUTSIDE of the bend. It only ever ADDS, only where the author left a
gap, and `defend: false` opts out. Pine Valley went 13 fairway bunkers -> 17, Red Mesa 10 -> 23, and
all 36 holes are still finished in par+2 or better - which is what keeps "challenging" from quietly
becoming "unfair".

### Three bugs this pass found, all of which looked like the fix rather than a bug

- **2,812 cacti.** `BELT_PITCH` clamps a belt's spacing to its canopy so a wood closes into a wall.
  A saguaro's "canopy" is 1.8 yds - it is a pillar, not a crown - so the bare clamp turned Red Mesa
  10's two belts into a thicket at 2 yd centres that softlocked the ball. A belt may be closed up,
  **never past 55 % of the spacing its author chose**.
- **A ball standing in a wood could not play out of it.** `treeHit` already ignored the tree you are
  touching and the canopy you are under; once belts were closed up that stopped being enough,
  because a ball inside a belt is under one crown and ringed by the next. Which hole broke depended
  on the seed, so a pitch that happened to pass was luck. **`ESCAPE_YD`**: when the ball's own lie is
  `trees`, the canopies of the stand within 11 yds do not stop the shot. Trunks still do, the wood
  twenty yards ahead still does, and a ball on the fairway is completely unaffected. It is the
  punch-out the file already granted from under one tree, granted from under the stand.
- **`route` was the CENTRELINE, and the fairway had moved off it.** They were the same thing while
  every corridor was symmetric. Once the two edges got their own widths the centreline could sit
  well over toward one edge - invisible to a player, who aims at what they can see, but section
  14's test player aims down `route`, so Pine Valley 15 read as a hole that took ten shots with a
  perfectly playable corridor beside it. `route` is the MIDPOINT of the two edges now.

### The art half

- **The mow stripes**: 3.8 yd period, a third of it dark, on the measured pair. An earlier pass
  recorded the real pair and then widened the darker stripe on purpose, reasoning that seven levels
  "reads as flat at this pixel size". It does not read as flat, it reads as mown - and the widened
  version was 2.3x the contrast on 3.7x the width. Where two readings of the fairway's colour
  disagree, **this frame wins**: the geometry, the water column and the seam all came off it too, so
  the course is now sampled from one image rather than three.
- **Tree shadows**, which did not exist. Offset **by the tree's own `height`** (0.92 across, 0.16
  down) rather than by a fixed number of yards - a shadow that ignores the thing casting it makes a
  belt of mixed specimens look pasted on, and `height` is already there doing the canopy-clearance
  job. **Composited in ONE pass at `SHADOW_ALPHA`**: two overlapping shadows at 0.15 each would
  stack to 0.28 and a wood would come out blotched with its own darker seams.
- **The wood is drawn in three passes, not tree by tree.** Every black key, then every canopy over
  all of them, then the clumps. A per-tree loop paints the next tree's key over the last tree's
  finished canopy, which is the mushroom-ring bug this file already carries a probe for - reborn at
  every seam INSIDE the wood, where a probe on one tree's shapes could never see it. There is a
  second probe on the ordering now.
- **No trunks.** The view is straight down and the reference's canopies are a solid mass with no
  dark core; there is nothing to draw.

Covered by `golf/js/test.js` section 12e (the second key-ordering probe, the shadow offset and its
single composite, and the three stripe numbers) and section 14, which plays all 36 holes.

## Birdie-every-hole was the PUTTER, not the courses (2026-09-05)

Matt, after playing both courses hole by hole: *"There's not a single hole I can imagine myself
ever getting worse than a par on"* and *"I don't even know if there's a single hole here I wouldn't
birdie."* He listed twenty-four of the thirty-six holes as not challenging at all.

He was right about the symptom and the courses were not the main cause. **Measured first, before
anything was designed**: sweeping real putts through `simulatePutt` with a decent player's third
tap gave 3 ft 100 %, 10 ft 100 %, 20 ft 90 %, 30 ft 77 %, 40 ft 63 %. **Every green was a make**, so
any approach that finished on the putting surface was a birdie and no hole design could have
mattered. Two structural reasons, both in how the accuracy bar reached the ball:

1. **`ui.js` damped the putt's miss angle to a QUARTER** (`m.deg * 0.25`). The green band tops out
   at 1.5 deg, so a well-struck putt was off line by at most 0.4 deg - against a cup that captures
   at a FIXED 0.30 yds, which is 1.7 deg wide from 30 ft. The bar could not miss the hole.
2. **`distanceMul` was exactly 1.000 across the whole green band**, on putts AND full shots. Pace
   was perfect on every decent strike, and in real golf most missed putts are missed on speed.

The same flaw ran the approach game: a 130 yd shot finished within 13 yds of its target **94 % of
the time** and a 100 yd shot 95 %, against a scratch golfer's real 78 % and 88 %.

| | before | after |
|---|---|---|
| one-putt from 10 ft | 100 % | ~65 % |
| from 20 ft | 90 % | ~31 % |
| from 30 ft | 77 % | ~20 % |
| a hole's birdie rate | 90-100 % | 6-45 % |
| Pine Valley, a decent player | about **-18** vs par | about **level** |

Three constants, all named and all in `swing.js`, are the whole dial:

- **`PUTT_LINE_K` (3.6)** and **`PUTT_PACE` (0.06)**, applied by `puttMishit()`. Deliberately
  kinder than real golf (a tour pro is ~40 % from 10 ft); this is a family game and the first
  playtest's lesson was that a putt has to stay makeable.
- **`GREEN_DIST_LOSS` (0.09)** - how much distance a strike at the EDGE of the green band gives up.

**Two things that are load-bearing about how those work:**

- **A DEAD-CENTRE STRIKE IS STILL EXACTLY 1.000.** That is what keeps the over-swing calibration
  (240-245 yds of carry at the top of the arc, measured with Matt) untouched, and what keeps the
  middle of the bar worth aiming at.
- **THE DISTANCE ERROR IS TWO-SIDED.** A one-sided shortfall is a bias, not dispersion: a player
  clubs up once and it is gone. Measured, the first (one-sided) attempt made the game EASIER,
  because it cancelled the roll that used to carry an approach past the pin. Which SIDE of the bar
  you stop on now decides whether the strike is heavy or thin.

`golf/js/test.js` section 15b pins the conversion curve from both ends, and the `mishit` assertion
that used to read *"a green-zone stop costs no distance at all"* is now the dead-centre one.

## What a hole is allowed to do to you now (2026-09-05)

Matt: *"Holes must force layups. They must change directions with trees too tall to hit over, etc.
Like real courses. Each hole should be different."* Four things were added to `holegen.js`, and
each closes a gap that made every hole play the same way.

### Green complexes: `guard`

*"all the greens are still too similar. They're all circles and they're all perfectly open."* There
was no way to defend a green at all: the only hazards a hole could have were blobs the author
placed by hand at an arbitrary `at`/`side`, which in practice meant one or two bunkers vaguely
beside it on all thirty-six.

`guard` is a list of tokens placed **in the green's own frame** - `f` points back down the approach
so "front" is the side the ball comes from even on a dogleg, and `r` is right of that line.
Authoring a front bunker in world coordinates means re-deriving it every time the centreline moves,
which is how a hazard ends up behind a green and nobody notices.

`frontSand` · `frontJaws` (two bunkers with a lane between them) · `frontWater` · `frontTrees` ·
`leftSand` / `rightSand` / `backSand` · `ringSand` · `leftWater` / `rightWater` / `backWater` ·
`leftTrees` / `rightTrees`. They combine: hole 18 is `frontWater` + `backWater` + `ringSand`.

### Slope: named characters, not three numbers

*"Some should be flat, some should have slight breaks, some should have crazy breaks and some
should have multiple different directional breaks."* `slopeGrid` could only express ONE fall with a
spine spread across it, so every green broke the same way at a different strength.

`SLOPE_PRESETS` is a function of position IN the green, which is what lets a saddle shed two ways
and a crown shed four - a single `fall` vector cannot, whatever you scale it by:
`flat` · `gentle` · `spine` · `steep` · `saddle` · `crown` · `bowl` · `tier` · `leftShed` /
`rightShed` · `quarters`. All DESIGNED, not measured - the reference footage shows exactly one
green - and the `severe` ceiling is set by what the putter can still hold.

### `cross`: the thing that forces a lay-up

Every hazard used to be BESIDE the corridor, so the answer to all thirty-six holes was hit it as
far as you can, straight. A cross hazard spans the whole corridor, built from the same stations the
fairway is, so it reaches both edges however much the fairway wanders there.

**IT IS PLACED IN YARDS FROM THE TEE, NOT AS A FRACTION OF THE HOLE, and that distinction is the
mechanic.** A cross at 0.60 of a 396 yd par 4 sits at 238 yds - PAST a 215 yd drive. Measured, it
never came into play once and the hole played as if it were not there. **And a band a driver can
CARRY is not a lay-up either**: bands centred at 188-205 did almost nothing. They sit near 220 with
34 yds of depth now, so a drive lands in them and the choice is to stop short.

### `sentinels`: trees too tall to fly

MEASURED against the stock bag: the highest-peaking club in it is the **8 iron at 32.3 yds of apex**,
reached halfway through a 120 yd shot. So a canopy over ~34 yds is above every ball in the game from
every distance. Pine Valley gained a `sentinel` pine (canopy 9, height 40) and Red Mesa's boulder
went from height 30 to 40 - at 30 it could be flown at the top of an 8 iron's arc, which quietly
undid the one thing that obstacle exists to say. Used only at corners: a hole walled with them is
not a hole.

### And a difficulty ramp under all of it

`hardnessOf(n)` runs 0 at the opening hole to 1 at the last and moves four things at once - the
landing-zone pinch, the depth of rough before trouble, the green's size and how hard it breaks -
because moving any one alone just makes eighteen copies of one hole at different settings. Every
default is overridable; the ramp is the floor a hole is designed on top of, not the design.

**Two relief rules fell out of measuring it.** A **par 5** gets the pinch backed off, because three
accurate swings compound: at the full ramp Pine Valley 15 necked to 12 yds of fairway and played to
+1.36 with 78 % bogey-or-worse, which is not a hard hole, it is an unfair one. A **par 3** gets the
same relief for the opposite reason - it has no landing zone to defend and its corridor is
decoration.

### Measured, per block of three holes (24 rounds a hole, strokes vs par)

```
pinevalley   1-3 +0.4   4-6 +0.3   7-9 -0.5   10-12 +1.6   13-15 +2.4   16-18 +3.3
redmesa      1-3 -0.6   4-6 -0.3   7-9 +0.1   10-12 +1.2   13-15 -0.5   16-18 +0.6
```

`golf/js/test.js` section **15c** plays every hole rather than reading its spec, because difficulty
is an outcome of the whole design and no single field carries it. **It does not assert monotonicity**
and the reason is written into the test: at 24 rounds a block carries about +/-0.3 of noise, a hole
with water swings further than that on its own, and the probe FLATTERS hard holes because it
searches 45 shot options and always finds an escape a person would not. What it asserts is what the
design actually claims - the closing nine is harder than the opening nine, the closing block is
harder than the opening block, the back nine is harder than the front - plus a `[KNOWN-BUG PROBE]`
that **no hole plays a full shot under par**, which is the floor Matt complained about.

**Red Mesa's 13-15 was a dip, and it CLOSED ON 2026-09-08 without being designed at.** Green
guarding was tried here and moved it by less than the noise: in this engine what costs strokes is
DRIVING difficulty, because a missed fairway costs power and accuracy band on the next shot, while
a smaller green mostly costs a putt. What actually closed it was the playtest pass at the bottom of
this file - a green that runs out and a break worth reading are both worth MORE on the holes with
the most trouble around the green, which is what 13-15 has. Measured after: the course's six blocks
run **-0.1 / +1.4 / +2.3 / +2.5 / +2.3 / +3.4**, so 13-15 is level with 10-12 and the closing three
are the hardest on the course. The finding under it still stands and is the lever if the dip ever
comes back: narrower corridors and more trees, not more sand round the green.

## The penalty drop, which finally exists (2026-09-05)

A ball that finished in water simply STAYED there and was played from a water lie - the drop prompt
was left for Stage C. Once the courses gained real water that became a **shipping loop**: measured
on Pine Valley 3, 10 and 17, a ball in a pocket beside a lake had no dry shot at all, so every
attempt went back in and the hole ran to 16, 17 and **24** strokes. A player cannot get out of that
by playing better, which is the definition of a stuck ball.

`resolveShot` now drops the ball **where it last crossed dry ground on its own flight line** and
returns `penalty: 1`. Walking the flight backwards is what makes that the crossing point rather
than an arbitrary spot, and the shot's origin is the floor, so a drop can never finish behind where
it was struck from. The stroke is added by the caller (`ui.js`'s `_settleShot`), which keeps
`resolveShot` a pure function of its inputs - the property section 14 depends on.

**Pine Valley 3's lake also moved.** It is the hole's documented feature and it stays, but it began
at y=246, which once distance started to scatter left only ~30 yds of dry ground between a 215 yd
drive and the water: the hole measured **+2.98 with 48 % bogey-or-worse, on the third hole of the
course**, which is meant to be the gentlest golf on the property. Pulled back 16 yds and narrowed.

## Three lengths, then a course, then which holes (2026-09-05)

Matt: *"I want 3 modes: 3 hole, 9 hole, and 18 hole. That's the first selection. Then the second
selection should be the course. If I chose 3 holes, each course should be broken into 6 options of
3 holes. if 9 holes is chosen, 2 options, and 18 holes, just 1."*

**THE FROZEN KEYS SURVIVE THIS UNTOUCHED, and that is why the suffixes look the way they do.**
`roundKey` is `<course.id><suffix>`, so the four keys already in players' stores are exactly the
four rounds that already existed:

| holes | suffix | was |
|---|---|---|
| 1-3 | `3` | "Quick 3", now three-hole SET 1 - the same three holes, so the stored best still means precisely what it meant |
| 1-9 | `9` | the front nine, unchanged |
| 10-18 | `9b` | the back nine, unchanged |
| all 18 | `18` | unchanged |

The five new three-hole sets take new suffixes (`3b`..`3f`). Nothing renamed, nothing repurposed,
nothing compared across lengths (rules 4 and 5). `js/leaderboard-rank.js`'s `GOLF_COURSE_PAR` gained
their ten par rows, and `golf/js/test.js` fails if that copy ever disagrees with the course data.

It is still **ONE screen**, not three: length chips, then course chips, then the sets, each row
swapping what is under it in place. On a phone, three screens before a ball is struck is where a
game gets closed. With 18 selected there is one set, so its row is a single wide button - a chooser
with one option is not a choice and should not look like one.

**Practice on any hole of any course is unchanged**, and every hole is on that screen.

### Per-hole records

`gf.bestHole`, keyed `<courseId>:<holeNumber>` by `rounds.js`'s `holeKey`, `Math.min` per key.
Additive, with the matching merge branch in `js/players-agg.js` and a row on My Stats ("Best on each
hole" - one strip per course, eighteen numbers, a dash for a hole never played because the lowest
possible score is 1 and a zero would be a fabricated record).

Three decisions in it are THE LAW rather than taste:

- **It is keyed by course and hole, never by round.** The same hole played in a 3-hole set, a nine
  and an eighteen is one record; folding the round into the key would split it into nine and make a
  player's best on a hole depend on how they happened to be playing that day (rule 4).
- **It is written as the HOLE finishes, not with the round.** That is what makes it survive an
  abandoned round: quitting on the twelfth must not throw away the ace you made on the third
  (rule 1). The round best keeps its stricter complete-round guard.
- **A practice hole sets one too**, and it does it through a dedicated `holeOnly` path in
  `recordGolf` that touches nothing else. Routing it through the practice branch would have counted
  each of eighteen holes as a practice ROUND and invented a course row in My Stats for it.

## Oasis Sands is NOT built, and why

Matt: *"the folder golf/reference/oasis-sands has screenshots of every hole. Clone these holes.
EXACTLY. and add it to the hub."*

**That folder does not exist in this repository** - not on this branch, not on `main`, not in any
branch, and not anywhere in the commit history (checked with `git log --all`). The only golf
reference committed is `reference/golf/`, which holds the five club-art PNGs and a README. The
screenshots are still local on Matt's PC.

Cloning a course from screenshots nobody in the session can see would mean inventing eighteen holes
and calling them a clone, which is the exact failure the standing instruction on this rebuild
exists to prevent (*"EVERYTHING in the reference clips and images should be measured and reproduced
as EXACT clones... If you skipped anything else and just made stuff up or guessed, go back and redo
it now"*). So it is not started. **Commit and push the folder and it can be measured the same way
Pine Valley 1 was.**

## Short putts ran past the hole, and the scale was linear (2026-09-05)

Matt, within minutes of v625 going live: *"Short putts are impossible to make. It goes over the
hole."*

**Measured, and it was never about the line.** Sweeping every power a 2 ft putt can be struck with:

```
a 2 ft putt drops for any power between 2.0 % and 11.4 %
at 1585 ms per power unit that is 32 ms to 181 ms after the first tap
```

So the entire makeable window for a tap-in sat in the **first fifth of a second of the backswing**,
before the needle has visibly moved. The window itself was a respectable 8.9 frames wide - it was
in the wrong PLACE. Late by a fraction and the ball runs past the hole, which is exactly what he
described.

**This was not new**, and that is worth recording: the physics had not changed. What changed is
that he now FACES short putts. Before the putting fix earlier the same day, a 20 ft putt went in
90 % of the time and a 30-footer 77 %, so a tap-in was rare enough never to be noticed. Making the
first putt miss surfaced a flaw that had been shipping the whole time.

### The fix is a CURVE, not a shorter range

A linear scale cannot fix this: distance is proportional to power, so a 2 ft putt on a 60 ft range
needs 3.3 % of the meter however the meter is timed, and the first 3 % of anything is unhittable.
Making the range follow the putt in hand DOES fix it, and it is what an earlier build did - and it
was reverted on purpose, because a scale that moves under the player is a rubber band (Matt: *"if
i'm 2 feet away, a 100 % power putt will go 2 feet"*), so nothing learned on one putt transfers to
the next.

So the scale stays **fixed** and gets a **curve**: `distance = range * power ** PUTT_GAMMA`, with
`PUTT_GAMMA` 1.6. 100 % is still 60 ft on every green in the game.

| putt | linear power / when | curved power / when | make window |
|---|---|---|---|
| 2 ft | 3.3 % / 53 ms | **11.9 % / 189 ms** | 8.9 -> **16.5 frames** |
| 3 ft | 5.0 % / 79 ms | 15.4 % / 244 ms | 9.1 -> 14.8 |
| 10 ft | 16.7 % / 264 ms | 32.7 % / 518 ms | 8.9 -> 10.3 |
| 30 ft | 50.0 % / 793 ms | 64.8 % / 1027 ms | ~9 -> ~8 |
| 60 ft | 100 % / 1585 ms | 100 % / 1585 ms | - |

**The conversion rates barely moved** (3 ft 94 %, 10 ft 63 %, 20 ft 29 %, 30 ft 20 %), which is the
point: this is a timing fix, not a difficulty change.

**THE AIM LADDER USES THE SAME CURVE.** `render.js` draws the putt dots at `f ** PUTT_GAMMA` of the
range, because the dots are what a player gauges power against - dots at even distances over a
curved meter would put the "50 %" dot at 30 ft when 50 % power goes 20, and a putting read that
lies is worse than no read at all.

**`puttPowerFor(ft, rangeFt)` is the inverse, and it exists for the tests.** Nothing in the game
calls it - the player sets power by stopping the needle - but every test and probe that plays a
putt was computing `ft / rangeFt` by hand, and each of those was silently a different (much
shorter) putt once the curve landed. Four suites and `test-visual.mjs`'s play probe were wrong in
exactly that way until they were moved onto it.

### And one KNOWN-BUG PROBE had to be rewritten rather than deleted

Section 11b asserted *"the window is the SAME at every distance"*, which was a proxy for the real
invariant - the scale must not move under the player - and the curve makes it false by design. The
invariant is now asserted **directly** instead (a given power goes the same distance whatever putt
you are facing, and full power is still the putter's stated range), plus a new probe that the
tap-in has the WIDEST window rather than the tightest. The rubber-band incident it was written for
is still guarded; only the proxy changed.

## The green-shape and routing pilot: Pine Valley 14 (2026-09-06)

Matt asked for ONE hole to be taken through the whole plan before the other thirty-five, which was
the right call: two of the three findings below would have been repeated 36 times.

### What was wrong, measured first

```
hole 14 "Highwater", par 4, 389 yd
  bend 41 deg but only 15.7 yds of offset from the straight tee-to-pin line -> it wandered,
                                                                              it never turned
  green: 12-gon, radii 10.7-13.0 yd -> a 22 % ripple on a circle
```

### `GREEN_SHAPES`: seven families, as radius functions

See the block above `greenPoly` for why r(a) rather than drawn outlines, and for the honest limit
(a true L is not star-shaped, so `boomerang` reads as a fat L). `fringePoly` is the same function
plus a CONSTANT, never the shape drawn bigger - scaling a kidney scales its notch, and the collar
would then cut into the putting surface exactly where the notch is deepest.

**The amplitudes were set by LOOKING at all seven drawn side by side at one size**, which is the
only way to tell a peanut from a rounded rectangle. The first pass was too timid on four of the
seven - `wedge` was indistinguishable from `round`, `peanut` had no waist - and they were pushed.
`wedge` is still the least distinctive: it is a genuine teardrop (radii 3.5-16.9 yd) but its whole
bounding box is smaller than a round green's, so at a glance it reads as "a small round green".

**Two knock-ons that touch every green on both courses**, not just hole 14: outlines are sampled at
`GREEN_POINTS` (34) instead of 12, because at twelve a kidney's notch falls between vertices and
comes out as a lumpy disc; and the old seeded per-vertex wobble is now at a THIRD of its strength,
because at full strength it fought the shape it was meant to be roughening.

### The dogleg has to be AT the landing zone

The first attempt bent hole 14 at 300 yds and measured **40.8 yds** of offset - and still rendered
as a leaning strip, because a hole is about five times taller than it is wide on screen and a bend
that late has nowhere to show. Moved to the corner at ~215 yds, where the drive finishes:

```
  now: 395 yd, bend 107 deg, max offset 44.7 yd  (was 41 deg / 15.7 yd)
```

The offset barely moved; **where the bend sits is what made it read.** A dogleg has to send the
drive somewhere the approach does not.

The lake now sits in the ELBOW, on the inside of the bend, so cutting the corner costs something,
and the green is `long` turned **55 degrees across the approach** - the direct line meets it at its
narrowest, the safe line left looks down its length. Measured: **+0.10 -> +0.57 vs par, birdie rate
13 % -> 2 %, bogey-or-worse 23 % -> 47 %.** That is a big jump from a routing change alone and may
be too much; it is in the 13-15 block, which is meant to be hard, and it is Matt's call.

### And a test was measuring the wrong thing

Section 11c ("every green has a collar") stepped out from the green's BOUNDING BOX. That is fine for
a circle and nonsense for a green twice as long as it is wide: the box radius plus 3 is more than
ten yards outside the putting surface along the short axis, so the probe sampled open country and
reported a missing collar on a hole whose collar is a uniform 5.9 yds. It walks the green polygon's
own vertices now, which is what the sentence always claimed.

### The ponds: two wrong answers before the right one (2026-09-06)

Matt, on the hole 14 pilot: *"make the ponds not pointy and it's beautiful."* Then, on the fix:
*"now the ponds are too ovaly. Make them shaped more like natural bodies of water."*

**Both wrong answers were the same mistake** - treating the outline as noise to be tuned rather than
as a shape with a structure:

1. `blob()` originally drew n points with **each radius drawn fresh from 0.76-1.22**, so two
   neighbours 36 degrees apart could differ by 46 % of the radius. That is a spike by construction,
   and every lake and bunker on both courses had corners.
2. The obvious fix - smooth the radii round the ring, then two rounds of Chaikin corner-cutting -
   removed the SHAPE along with the spikes, because **averaging a ring of numbers kills its low
   frequencies as happily as its high ones**. Measured: radius variation collapsed from 0.76-1.22 to
   0.86-0.96. Smooth, and an oval.

**The structure is FREQUENCY.** A real pond has a handful of broad bays and headlands - variation
over a third of its perimeter - and nothing at all over ten degrees. So the radius is the first four
harmonics and no more:

```
r(a) = 1 + A1 cos(a + p1) + A2 cos(2a + p2) + A3 cos(3a + p3) + A4 cos(4a + p4)
```

Harmonic 1 pushes the whole shape off its own centre, which is what makes it read as asymmetric
rather than as a decorated circle; 2 is the long axis; 3 and 4 are the bays. **Cutting off at 4
means a spike is not expressible** - there is no wavelength short enough - so this needs no
smoothing pass and no corner-cutting at all. It is smooth BY CONSTRUCTION, which is why the Chaikin
helper the second attempt added is gone again.

Measured across five seeds: radius ratios **1.8 to 2.8** (the ovals were 1.4) with the sharpest
corner between 137 and 161 degrees. And because every radius is positive the polygon is star-shaped,
so it cannot self-intersect and the ray-cast lie lookup can never report "outside" for a ball
sitting in the water.

### `boomerang` and `wedge` are names I invented, and one of them does not work

Neither is a golf-architecture term. `wedge` is a teardrop; `boomerang` was an attempt at an
L-shaped green and came out a fat arrowhead, because r(a) cannot express a sharp inner corner (see
the caveat above `GREEN_SHAPES`). If a future session wants a real L it needs drawn outlines and a
polygon-offset routine for the fringe. Renaming `wedge` to `teardrop` and dropping `boomerang` is
the honest tidy-up; left as-is pending Matt's call.

## Hole 18, and the bug the green shapes hid (2026-09-06)

The second hole of the routing pass, and deliberately a **different question** from 14's. Hole 14
doglegs RIGHT around water sitting in the elbow, to a long green turned across the shot: the tee
shot is a bid and the approach collects the bill. Hole 18 bends LEFT and asks nothing of the drive
except that it stop short of the creek - the whole hole is the second shot, into a kidney green
whose notch faces the approach. **Two doglegs in a row would be a repeat; a dogleg and a lay-up is
a pair**, and that distinction is the whole reason to do these in batches rather than one at a time.

```
hole 14: 395 yd  bend 107 deg RIGHT  offset 44.7 yd  green 9.8-21.7 yd (long, 55 deg across)
hole 18: 381 yd  bend 109 deg LEFT   offset 39.1 yd  green 6.1-15.2 yd (kidney, notch 25 deg off)
```

The kidney's notch is turned 25 degrees off the approach rather than square to it. Square on, the
front of the green is simply missing and the hole stops being a question and becomes a wall.

### GUARDS WERE PLACED AT A FIXED RADIUS, AND SHAPED GREENS BROKE THAT

The green complexes were built at `greenR + 6 + a bit` from the pin, which is exactly right while
every green is a circle of radius `greenR`. The moment greens got SHAPES that distance stopped
meaning anything. Measured on hole 18's kidney, whose radius runs 6.1 to 15.2 yds: the six
`ringSand` bunkers finished between **9.2 and 20.2 yards past the putting surface** - six white
splashes floating in the rough rather than sand cut into the surround.

`gEdge(bearing, pad)` asks the same radius function the green is DRAWN from how far its edge is in
that direction, and places the hazard `edge + 6 + pad` out - so a bunker tucks into a bay and stands
off a headland. Measured across the 33 generated holes afterwards: **worst gap 10.4 yds, median
8.4** (centre to edge, against bunker radii of 6.5-7.5, so the sand's near edge bites into the
collar - which is what a real green complex does).

**This was invisible until a green was not round**, and it would have shipped on all 36. It is the
clearest argument for the pilot: the bug was in code the shape work never touched.

### And the cart path did not know the hole had moved

Hole 18's `decor` path ran straight up x=34-42 from the days when the hole did too. Once the routing
bent left it was a stripe of tarmac stranded 90 yards out in open country. Re-cut to follow the
hole - and then re-cut again, because the first version followed the CENTRELINE and ran straight
through the creek and the pond. It sits outside the corridor on the outside of the bend now.

### Measured

| | before | after |
|---|---|---|
| hole 14 | +0.10 vs par, 13 % birdie | **+0.62, 2 % birdie, 52 % bogey+** |
| hole 18 | -0.15, 30 % birdie | **+0.45, 17 % birdie, 45 % bogey+** |
| block 16-18 | +0.5 | **+1.3** |

### The families are five plus one, and `wedge`/`boomerang` are gone

`round` · `long` · `kidney` · `peanut` · `teardrop` · `clover`. Matt: *"What is 'wedge'? What is
'boomerang'?"* - neither was a golf term, both were names invented here, and a family name that
describes nothing is worse than no name. `wedge` became `teardrop` (which is what it is, and which
also stops it colliding with the CLUB vocabulary the player already has). `boomerang` was **dropped
rather than renamed**: it existed to be the L-shaped green and could not be one, because r(a) cannot
express a sharp inner corner - that corner is the one place a ray from the centre would cross the
outline twice, which is exactly what star-shaped rules out. A family that promises a shape it cannot
draw is a trap for the next session.

## The back nine, as a SET - and the softlock the set test found (2026-09-06)

Matt approved doing 10-18 in one batch rather than one at a time, and the reason is the whole
finding below: **variety is a property of the SET, not of a hole.** Every one of these nine reads
as a reasonable hole on its own. What was wrong only shows up with all nine drawn at one scale
beside each other, and two of the three problems were in code the hole specs never touched.

### The nine, as designed

| | routing | green | slope | the question it asks |
|---|---|---|---|---|
| 10 | S: right off the tee, back left | peanut | tier | an oak on the inside of the first bend |
| 11 | double dogleg, left then right | long / 25 deg | steep | the quarry across the second shot |
| 12 | straight par 3 | teardrop / 180 | bowl | all carry, target narrows the further you go |
| 13 | hard right, turn at 200 of 341 | clover / 40 | saddle | how much of the corner you take on |
| 14 | right, turn AT the landing zone | long / 55 deg | rightShed | water in the elbow |
| 15 | long gentle left, 574 yd | kidney / 200 | spine | placing the second shot |
| 16 | straight par 3, 135 yd | round | crown | a wedge and a nerve |
| 17 | late right - straight 240, then turn | peanut / 70 | quarters | the drive is placed, the approach is bent |
| 18 | left, turn at the landing zone | kidney / 25 | steep | stop short of the creek, then everything |

### EVERY CROSS HAZARD ON THE COURSE WAS AT EXACTLY 222 YARDS

Six holes carry a `cross` band and all six read `{ yd: 222, depth: 34 }`. That is not six hazards,
it is one hazard copied six times - and the tee shot on all six was therefore the same shot, which
is precisely the "every hole is the same" Matt was describing. It came from applying one measured
rule (*"a band a driver can CARRY is not a lay-up; they sit near 220"*) to every hole that got one,
without ever asking which SHOT each band was meant to interrogate.

Each is now placed where the shot with a decision in it actually lands:

| hole | | was | now | the shot it now asks about |
|---|---|---|---|---|
| 7 | par 5, 503 | 222 water | **408 water** | the go-for-it second shot lands at ~410 |
| 8 | par 4, 293 | 222 waste | **262 waste** | a stock drive is safe, going for the green is not |
| 11 | par 5, 556 | 222 waste | **300 waste** | carry the quarry on the second, or stop in front |
| 13 | par 4, 341 | 222 water | 222 water | unchanged - the drive stopping short IS this hole |
| 15 | par 5, 574 | 222 waste | **400 waste** | unreachable in two, so the second is a placement |
| 18 | par 4, 381 | 222 water | 222 water | unchanged - the creek off the tee IS this hole |

**11's own comment already said 300** (*"An old quarry floor crosses at 300 yards"*) while its code
said 222. The documentation was right and the data had drifted from it.

Two holes still share 222, and that is deliberate: they are the two holes whose identity is a
mandatory lay-up over water, at very different lengths (13 leaves a wedge, 18 a long iron).

### `frontTrees` was a WALL, and it closed two greens completely

Section 15c plays 24 rounds of every hole. On 17 it could not finish **7 of 24**, and on 10 **6 of
24** - not "took a lot of shots", but a ball that could not move at all, with all 45 of the probe's
club/aim/power options blocked, for ever.

Traced to one place, and it is the same spot in every failed run: a ball resting on the FAIRWAY
about 25 yards short of the green. `frontTrees` planted five trees in a continuous arc across the
green's whole front at `edge + 8`, which on a 10-yard green is a solid screen ~24 yards wide sitting
18-20 yards off the pin. **Nothing in the bag climbs 18 yards of pine in 25 yards of travel**, and
`ESCAPE_YD` could not help because that relief only fired when the ball's own lie was `trees` - this
ball was standing on cut grass.

It is now **two stands with a lane between them, at `edge + 30`**. Both halves are the fix:

- **The distance** makes the trap impossible rather than merely unlikely. The nearest a ball can
  stop short of the stand is ~45 yards from the pin, and from there every lofted club climbs over a
  canopy long before reaching one.
- **The lane** keeps it a question. A shot flown up the middle gets through; one leaked either side
  does not. A green with no way into it at all is closed, not defended.

Measured: hole 17 **+4.79 -> +1.38** vs par, hole 10 **+3.54 -> +1.21**, ceiling runs 7 and 6 -> 1
and 1.

### And a ball at the DRIPLINE could not play out either

Chasing the rest of the blocked runs found the same failure one step out. `treeHit` models a canopy
as a solid cylinder from the ground to `height`, which is not what a tree is - there is clear air
under the crown, which is exactly why the rules above already let a ball punch out from UNDERNEATH
one. It is just as true two yards outside it, and the model needs it to be, or it softlocks: **Pine
Valley 3's lone fairway oak blocked every shot from a ball resting 9.5 yards away on the fairway**,
in all 45 directions, permanently. Canopy 8, ball at 9.5: outside the crown by a yard and a half,
and therefore, to the model, a fly-over problem with no answer.

Two rules, both in `shot.js`:

- **`SKIRT_YD` (3)** - a canopy within `canopy + 3` yards is an under-the-branches question, not a
  fly-over one, whatever the ball is sitting on.
- **The wood is now recognised by WHAT IS AROUND THE BALL, not by the lie.** `inWood` was
  `surfaceAt(...) === 'trees'`, and the `trees` lie is painted from the belt POLYGON - so a ball
  that ran a yard past its edge onto light rough was surrounded by exactly the same stand and got
  none of the relief. Three or more canopies within reach now means the ball is inside a stand.

**Pine Valley 3's designed feature survives both**: the shot the hole is built around is played from
ten yards further back than that, where the oak blocks exactly as it always has. Measured, hole 3
went **+1.25 -> +0.13** - which is the softlock leaving, not the oak.

Blocked runs across 432 Pine Valley rounds: **13 -> 5**.

### Still open: five blocked runs remain, and they are deep inside the belts

Three distinct spots, all a ball that has run into a 26-yard-deep pine belt at 8-yard spacing. The
escape reaches 13 yards; the far half of the belt still blocks. A real player would chip out
SIDEWAYS, and the probe only searches +/-45 degrees off the target line, so part of this is the
probe rather than the game - but the game's own aim arc is +/-60 degrees, so it is not all of it.
The lever is belt DEPTH (26-30 on holes 13 and 17, against 18-22 elsewhere), not another escape
rule. **Not fixed, and it is pre-existing** - this pass reduced it, it did not create it.

### 17's first 240 yards were dead ground

On the contact sheet the hole was a plain tunnel with one auto-placed bunker in it: the whole hole
was its last hundred yards. The drive is now squeezed between two bunkers **staggered** either side
of where it lands - short-left and long-right - so the tee shot is a placement even though the
corner is still 100 yards further on. Authored rather than left to the auto-defend, which only ever
adds one, on the outside of the bend.

### Measured, per block of three

```
pinevalley   1-3 -0.7   4-6 +0.0   7-9 -0.3   10-12 +1.9   13-15 +2.7   16-18 +1.8
redmesa      1-3 -0.5   4-6 -0.2   7-9 +0.4   10-12 +1.2   13-15 -0.5   16-18 +0.6
```

### Two diagnostics were added to section 15c, and they are what found all of this

Both are env-gated so a normal run is unchanged:

- **`GF_PERHOLE=1`** prints every hole's average score against par, and - the important one - **how
  many of the 24 runs hit the 14-shot ceiling.** The block averages alone hid this completely: a
  block reading +5.4 looks like three hard holes and was in fact one unfinishable one.
- **`GF_TRACE=1`** prints each shot's club, where it finished and its lie, and names the exact
  coordinate a blocked ball was standing on. Every fix above came from reading that coordinate; the
  first three guesses at the cause (the sentinels, the belt density, the green guards) were all
  wrong, and all three looked plausible.

## The front nine, and the two things that only show up in a set (2026-09-06)

Same pass as the back nine, and it found the same class of bug: something wrong in code that no
hole spec touches, invisible until eighteen holes are drawn side by side.

### Holes 1-3 are NOT re-cut, and that is deliberate

They are the three holes the reference footage documents (`golf-reference-spec.md` §17.1) and the
standing instruction on this rebuild is that the reference is cloned rather than improved. They are
also the frozen `pinevalley3` round. Their centrelines, greens, slope grids and hazards stay as
authored; only hole 1's corridor was ever re-cut, back in the fairway pass, and its green was not.

**Matt asked for hole 3 to be swapped with an easier hole** (2026-09-06). It was not done, and the
reason is a measurement rather than a preference: he called it hard when it measured **+2.98** and
then **+1.25**, and both of those numbers were the OAK SOFTLOCK, not the hole. With that fixed
(see "The back nine, as a SET") hole 3 measures **+0.13**, in line with hole 1 (-0.21) and hole 2
(-0.58). The problem the swap was going to solve no longer exists, and the swap would cost the
reference fidelity of the opening three. **His call, and he was told; if he still wants it, do it.**

**The renumbering itself is safe from THE LAW's side, and that was CHECKED rather than assumed**
(rule 1, rule 8). A fresh RTDB read on 2026-09-06: **237 player device records, zero with
`gf.bestHole`, zero with `bestRoundByCourse`.** No golf record of any kind exists anywhere, so no
`pinevalley:<n>` key can be repurposed out from under a stored best. That check has to be re-run
before any future renumbering, because the moment one round is recorded it stops being true.

### What 4-9 got

| | routing, before | routing, now | green | slope |
|---|---|---|---|---|
| 4 | **straight** (4 yd of offset over 367) | LEFT, and the lean is set in the first 70 yards | teardrop / 0 | gentle |
| 5 | right, mid | unchanged | long / **90 - broadside** | tier |
| 6 | straight par 3 | unchanged | round | **flat** |
| 7 | right in its first third | RIGHT, and the corner is at 71-92 % | long / **0 - end-on** | saddle |
| 8 | **straight** (6 yd over 293) | LEFT late, the corner past the lay-up | clover / 30 | leftShed |
| 9 | left at the landing zone | unchanged | peanut / 140 | spine |

**The two `long` greens are the point of that family, not a repeat.** Hole 5 turns it 90 degrees so
the green is wide and shallow and the only miss that matters is long or short - which is the right
ask after a long iron, on the longest par 4 out here. Hole 7 turns it to 0 so the green is deep and
narrow and the miss that matters is left or right - which is the right ask after a shot that has
just carried water and bent round a corner. Same radius function, opposite question.

**Hole 6's green is the one genuinely FLAT green on the property.** It used to be `bowl`, which is
hole 12's, and a bowl is not kind - it is a different kind of unkind, because it feeds a good shot
away from a pin on the rim. `flat` is the only entry in `SLOPE_PRESETS` that asks nothing of the
read, and one hole out of thirty-six should be that hole.

### HOLE 8'S GREEN WAS HOLE 16'S, EXACTLY

`round` + `crown` + `ringSand`, radius 11 against 16's 10. Two greens on one course that are the
same idea at the same size are one green drawn twice, and neither was doing anything the other was
not. 16 keeps it - the Postage Stamp's whole point is that there is nothing clever about it - and 8
became a clover that sheds to one side, so a wedge in the wrong lobe leaves a putt across a notch.

**Nothing in a hole spec could have shown this.** Both holes read perfectly sensibly on their own
page; it took a table of all eighteen `greenShape`/`slope`/`guard` triples to see that two rows were
identical.

### CROSS HAZARDS WERE SLABS

Their two long edges always followed the corridor, but the **upstream and downstream faces were
straight lines** drawn between the first and last station in the depth window. So every creek and
waste band on both courses rendered as a hard-edged parallelogram laid across the hole - which is
the same *"almost perfect rectangles"* the fairways were pulled up for, one layer out. On hole 8's
re-cut, where the corridor bends through the band, it read as a car park.

Each face is now a low-frequency wave across the corridor, built the way `blob()` builds a pond:
**harmonics 1 and 2 only**, so there is no wavelength short enough to make a spike and no smoothing
pass is needed. The two faces carry their own phases, so the band's DEPTH varies rather than the
whole thing sliding up and down the hole, and the wave is floored at 0.35 of the half-depth so a
face can bulge but never shear through the other one. Seeded from the hole, so it is the same creek
on every device.

**It fixed six holes on the back nine as well as three on the front**, which is the argument for
fixing the generator rather than the hole.

One knock-on, and it is real: at a CORNER the two faces fan apart, so the stock 8-yard reach past
the rough put hole 8's cream sand out in open country beyond the tree belt. `over` is authorable per
hazard and that band uses 3. **A hazard drawn outside the hole is not a hazard, it is a mistake.**

### Hole 7 was the easiest hole on the property, and only length fixed it

At 523 yards it was reachable in two, so the probe laid up, wedged on and measured **-0.46** - the
lowest number on either course, on a course whose complaint was that everything was a birdie.

**Two fixes that did almost nothing are worth recording**, because they are the obvious ones:
necking the corridor to 9 yards through the lay-up zone moved it to -0.42, and putting a bunker
either side of where the lay-up finishes moved it to -0.42 as well. Neither works, and the reason is
in the probe: it takes the first DRY option that advances the ball, so a fairway bunker does not
deter it at all - it only costs power and accuracy on the NEXT shot, which on a par 5 with a wedge
left is nothing. This is the same finding `js/CLAUDE.md` records for Red Mesa 13-15: **in this
engine what costs strokes is driving difficulty and length, not green-side decoration.**

Lengthened to 559 so it is a genuine three-shot hole: **+0.04**. Pine Valley's par 5s are now 609,
559, 556 and 574 - all four unreachable in two, which is a real loss of variety and is written down
here rather than pretended away. A reachable par 5 needs its reward to cost something the probe can
feel, and that is a bigger job than this pass.

### Measured, per block of three

```
pinevalley   1-3 -0.7   4-6 +0.3   7-9 -0.3   10-12 +1.8   13-15 +2.5   16-18 +1.6
redmesa      1-3 -0.5   4-6 -0.2   7-9 +0.5   10-12 +1.2   13-15 -0.3   16-18 +0.6
```

Blocked (unfinishable) runs across 432 Pine Valley rounds: **5**, unchanged - all still deep inside
the 26-yard belts on 13 and 17. Still open, still pre-existing.

## The woods (2026-09-06)

Matt, having played both courses: *"The fairway is lined by extremely dense forest that's
impossible to hit out of on every single hole. And the tree line abruptly just ends on every hole."*

Both halves were `expandBelt` in `js/holes.js`, which filled a belt's polygon with a **jittered
uniform grid**: identical density from the fairway edge to the back of the wood and from the tee to
the green, dropping to zero at the polygon boundary in the space of one step.

### THE AUTHORED `spacing` WAS VERY NEARLY INERT, which is the whole of "every single hole"

The step was `max(spacing * 0.55, min(spacing, canopy * BELT_PITCH))`. For a pine (canopy 4.5) the
second term is **5.17**, so:

```
authored spacing   7   8   9  10  11  12
actual step      5.17 5.17 5.17 5.50 6.05 6.60
```

**7, 8 and 9 produced the identical wood** - and those three are what almost every belt on both
courses uses (23 of 33 on Pine Valley). An author turning the dial from 7 to 9 changed nothing at
all. That is not a subtle bug: it is a design control that was silently disconnected, and no
amount of re-authoring course data would have moved it.

`canopy * BELT_PITCH` is now a **floor on how tight** a belt may be closed - the thing it was
written for, keeping a wood a solid mass rather than a row of buttons - and the authored spacing
drives the step above it (`spacing * 0.72`). 7 is the wall it always was; 13 is open woodland you
can see and play through. The existing authored values already spread 7-12 on Pine Valley and 10-16
on Red Mesa, so the between-hole variety appeared the moment the dial was reconnected, with no
course data changed.

### The edge feathers, both ways

One continuous function of SIGNED distance to the belt's edge, so there is no seam at the boundary:

- **Inside**, the keep-rate ramps from `EDGE_KEEP` (0.68) at the boundary to 1 at `feather` yards
  in, so the first few yards of wood are scattered trunks a ball can be played through and only the
  core is a wall.
- **Outside**, it decays from the same 0.68 to nothing over `BELT_BLEED_YD` (15), so a wood **ends
  in strays** rather than at a ruled line - at its sides and, which is the visible half, at the tee
  and green ends of every belt.

`feather` is **a third of the belt's own depth**, capped at 9. A flat 13 was tried first and left a
24-yard belt with no core at all (the deepest point in a 24-yard band is 12 yards from an edge):
hole 12's entire left wall came out as **29 trees**. A feather has to be a fraction of the thing it
is feathering, so `holegen.js` passes the belt its `depth`.

### Three things the first version got wrong, all found by measuring

1. **STRAYS BLED TOWARD THE FAIRWAY AND MADE THE GAME HARDER.** Scattered specimens landed in the
   light rough on both sides of every hole, where nothing had blocked before: Pine Valley's closing
   block went **+1.6 -> +4.1** and four holes became unfinishable. Two guards, because one was not
   enough: `holegen.js` passes each belt its `inner` (fairway-facing) edge and a stray nearest that
   edge is dropped; and `treesOf` drops any stray landing on `fairway`, `lightRough`, `green`,
   `fringe` or `tee`. **The second guard exists because holes 1 and 3 are hand-authored and carry
   no `inner`** - a pine landed in hole 3's light rough 47 yards up the shot line and section 10's
   lob-wedge probe went from clearing the oak to being stopped by it, which is how it was found.
2. **CLEARINGS EXPOSED THE SLAB UNDERNEATH.** The density wave originally ran 0.10 to 1.0, which
   genuinely gave a wood thick stretches and near-clearings - and a clearing shows the belt polygon,
   which IS the `trees` lie surface and is painted as dark woodland ground. Holes 12 and 16 came out
   with a hard-edged dark rectangle sitting in open country: the same complaint being fixed, one
   layer down. The wave is a gentle texture now (0.76 to 1.0); between-hole variety comes from
   `spacing`, which is a real dial again.
3. **THE LIE SURFACE IS NOW INSET FROM THE TREE POLYGON**, which is a deliberate break with the
   "one polygon is both the belt and the lie surface" rule stated a few lines above it in
   `holegen.js`. It has to be, now that the wood feathers: wherever the trees thin the painted
   ground showed through. Inset (inner +2, outer -3, and 10 yards off each end) the ground always
   stops well inside the tree cover, so the edge of a wood reads as trees thinning into rough rather
   than as a shape ending. **The cost, accepted:** the outermost trees stand on rough rather than on
   the `trees` lie - which is what the edge of a wood is, and was already true of every bleed stray.

A HAND-AUTHORED belt (no `inner`) gets **neither feather nor bleed** - holes 1 and 3 only, the
reference clones, whose surfaces are not inset to suit. `inner` is the marker for "generated, and
the ground under this has been inset".

### Measured

| | before | after |
|---|---|---|
| trees, Pine Valley | 8,684 | **5,762** |
| trees, Red Mesa | 3,730 | **2,143** |
| unfinishable runs, 432 PV rounds | 5 | **0** |
| expansion, all 18 holes | 102 ms | 471 ms |

**The five stuck balls are gone**, which this pass was not aiming at: they were all deep inside the
26-yard belts on 13 and 17, and a wood you can play out of has no inside to be stuck in.

The expansion cost is a distance-to-polygon per candidate. It is paid **once per hole, at first
mount, and cached** on the hole (`treesOf`), so it is ~26 ms on a hole nobody is waiting on;
`test-visual.mjs`'s golf probe is unchanged at 14 passed.

### THE COURSES GOT EASIER, AND THAT IS THE TRADE

A wood you can play out of costs fewer strokes than one you cannot. Measured, per block of three:

```
                     before                          after
pinevalley   -0.1 +0.2 -0.3 +1.8 +2.5 +1.6    -0.6 +0.0 -0.1 +1.2 +0.8 +1.2
redmesa      -0.5 -0.2 +0.0 +0.3 -0.5 +0.8    -0.3 -0.3 +0.1 -0.2 -0.4 +0.5
```

Pine Valley's 13-15 block fell hardest (+2.5 -> +0.8), because holes 13 and 17 were the two with
26-30 yard belts and most of their difficulty was the wall. Every assertion in section 15c still
passes and no hole plays a full shot under par.

**If the difficulty is wanted back, the lever is corridor width and length, not tree density** -
which is the same finding `js/CLAUDE.md` records for Red Mesa 13-15 and this file records for hole
7. Putting the trees back would put the complaint back with them.

### Hole 3's tree line stopped at the pond (2026-09-06)

Matt: *"what's up with hole 3? why do the trees just completely stop after that pond? You can add
more, but you can add them sporadically."*

Both of its belts ended at y=250-300 and the hole runs to y=620 with the pin at 540, so **more than
half of the longest hole on the property was open country.** Not a generator bug: hole 3 is one of
the hand-authored reference clones and its belts were drawn for the first half and never finished.
Three separate things were wrong, and only the first is the one he asked about.

**1. The top half is now SPECIMENS, not a belt.** They are individual `trees` entries, so they block
a ball in flight and paint NO `trees` lie surface. That is the whole meaning of "sporadically" - a
sparse belt would have covered the top of the hole in dark woodland ground with a handful of trunks
standing on it, which is the slab problem the feather pass had already solved once. 46 of them,
placed by script against the hole's own geometry in clusters of one to four with the odd oak among
the pines, then written out as literals so they are reviewable and cannot move under a re-run.

**The placement rule that matters is DISTANCE FROM THE PLAYING LINE, not the surface.** A first pass
checked only that nothing landed on fairway, rough, sand or water, and that let clusters sit in
heavy rough eleven yards off the route: **hole 3 went +0.17 to +1.21 vs par.** That is a hazard, not
scenery, on the third hole of the course. With a 30-yard clearance from `route` it plays **+0.33**.

**2. The two belts stopped at a FLAT CUT, which is the abrupt end he has now reported twice.** They
are tapered to a rounded point now (left closing near y=347, right near y=274, both clear of the
pond at y 262-337). A hand-authored belt gets no feather and no bleed - its lie surface is not inset
to suit - so the taper has to be in the polygon itself.

**3. `NO_BELT_TREE` now applies to EVERY belt tree, not only to the strays outside the polygon.**
Rendering hole 3 showed pines growing out of the fairway bunker at y 166-186: the right belt has
clipped it since Stage B, and no rule caught it because those trees are INSIDE the belt polygon and
so were never strays. The set gained `water` and both bunker kinds. **Hand-placed `trees` entries
are never filtered** - hole 3's signature oak stands on the fairway on purpose, and an author who
writes a coordinate means it.

### Some trees are bigger than others (2026-09-06)

Matt: *"Make some trees bigger. Like their diameter and circumference. But keep them spread out and
stuff."*

Every tree in a belt was drawn at exactly its type's `canopy`, so a wood was **one crown stamped a
few hundred times.** That is most of what makes a belt read as wallpaper rather than as woodland,
and it is why the mottling, the seeded clumps and the upper-left highlight were all added to the
RENDERER and still were not enough - none of them changes the SILHOUETTE, which is what the eye
picks a repeat out of. `treeScale(rnd)` in `js/holes.js` gives each belt tree an `s` multiple:

```
12 %  1.30 - 1.80   mature specimens
28 %  1.02 - 1.28   a size up
38 %  0.82 - 1.00   ordinary
22 %  0.62 - 0.80   young
```

**THE DISTRIBUTION IS ROUGHLY CANOPY-AREA-NEUTRAL, which is the "keep them spread out" half.**
Coverage goes as the SQUARE of the scale, so a mix that merely averaged 1.0 would close a wood back
up by about a fifth and quietly undo the feather pass. Mean s^2 here is 1.09, and `BELT_SPREAD`
(sqrt of that, 1.044) takes it straight back out of the belt step - so the wood has big trees in it
and is exactly as open as it was measured to be.

**HEIGHTS ARE DELIBERATELY NOT SCALED.** A canopy's `height` is the fly-over gate the whole
punch-low-or-loft-over decision runs on, and it is tuned against the bag's measured apexes (the
8 iron's 32.3 yds). A wood of randomly unflyable trees would be a gameplay change wearing an art
change's clothes - which is the mistake "The tempo was never asked for" already records once.

**THE SIZE IS APPLIED IN THREE PLACES AND MUST STAY IN ALL THREE.** `render.js` draws the shadow and
the crown at `canopy * s`; `shot.js`'s `treeHit` tests `trunk * s` and `canopy * s`, and its
`near >= 3` escape reach scales too. This renderer's whole contract is that **what is painted is
what stops the ball** - applying the size in one file and not the other would give the game big
trees a ball flies straight through and small ones with invisible canopy, and nothing at runtime
would notice either.

So section 10 carries a PAIR of `[KNOWN-BUG PROBE]`s, and they fail whichever way the two files
drift apart: a ball 11 yards off line must be blocked by a 1.7x oak (canopy 8 -> 13.6) and must NOT
be blocked by the same oak unscaled or at 0.7x, and `render.js` is read as text and must carry the
multiple in BOTH tree passes. Verified born-red: reverting either file's scale turns the matching
probe red on its own.

**Measured:** Pine Valley 5,762 -> 5,298 trees and Red Mesa 2,143 -> 2,014 (the `BELT_SPREAD` step),
no unfinishable runs on either course, and the blocks recover some of what the thinning pass gave
away - bigger crowns block more:

```
                     before                          after
pinevalley   -0.6 +0.0 -0.1 +1.2 +0.8 +1.2    -0.4 +0.0 +0.0 +1.0 +1.5 +1.8
```

## The test hole video: five bugs, and the meter had no green band at all (2026-09-06)

Matt filmed a 3-hole round on Pine Valley 1-3 and asked what was wrong with it. Everything below is
measured off that clip, and the two biggest findings are things nobody had reported because they
look like the game working.

### THE ACCURACY BAR HAD NO GREEN BAND, FOR ANY CLUB, ON ANY LIE BUT THREE

He cycled the whole bag on one lie and said they felt identical. Scanning the bar pixel by pixel in
his own footage:

```
driver   green 0 px   orange 29   red 71        putter (on the green)  green 51   orange 20  red 28
3 wood   green 0       orange 29   red 72
2 iron   green 0       orange 29   red 72
7 iron   green 0       orange 30   red 71
s wedge  green 0       orange 31   red 69
l wedge  green 0       orange 31   red 70
```

**Zero, and within one pixel of each other.** `LIES[].zone` is 0.167-0.22 for rough, sand and trees
(the spec table's "85 %" is stale - it was retuned when the reference's 9.1 % bad-lie band was
measured), so `0.545 * zone * clubZone` gave a driver **8.6 %** of the bar and a lob wedge **12.0 %**
- 8.5 px against 11.9 px, with a 6 px needle drawn over the middle of both. Section 8b had been
printing the same fact for weeks: **a driver's green half-window from light rough is 0.8 frames**,
0.6 from heavy rough. Sub-frame at 60 fps. The suite only ever asserted a floor on ORANGE.

So `swingZone` shipped, was arithmetically correct, and was invisible. Three changes:

- **Three tiers, not a fourteen-step ramp** (Matt: *"1 difficulty setting for the driver and woods,
  another for irons, and a third for the wedges"*). `ZONE_WOODS` 0.62 / `ZONE_IRONS` 0.80 /
  `ZONE_WEDGES` 1.00, resolved by `clubTier()`.
- **`GREEN_FLOOR`, per tier** (woods 0.16, irons 0.21, wedges 0.26 of the bar). A clean lie is above
  it and is untouched; only a collapsed band is lifted. **It has to be per tier**: one floor would
  clamp all three to the same number on exactly the lies where they were already identical and
  rebuild the bug. Orange is untouched and still keyed on the lie alone.
- **The needle is 5/2, not 6/3.** At dpr 3 it was 18 device px of black key across the middle of a
  ~140 px bar, eating 18 px out of every band from the centre - which is where the band is.

**`bandsFor` and `mishit` both take the floor, from the same call site.** They always shared their
arguments and they must keep sharing them: the band a player aims at and the band that scores the
strike are the same object or the meter is lying. Measured in the real UI at dpr 3, all three from
one heavy-rough lie: **woods 8 px of green, irons 15, wedges 22** (was 0, 0, 0).

### THE LADDER NO LONGER RE-SCALES FOR THE LIE

`aimDots` was `club.carry * lieOf(lie).power`. Matt: *"The power/aim line should never change. It
should always be the same distance with the same spacing for the same club always... The game can't
adjust and tell someone exactly how hard to swing. It's a game. you have to learn and get better at
it."* He is overruling the rationale it shipped with ("it never lies about where a perfect strike
lands") and he is right that it was doing the player's thinking for them. The lie's cost is shown by
the `Power: 82%` readout; learning what that means is the skill. The old assertion demanded the old
behaviour and is now a `[KNOWN-BUG PROBE]` demanding the new one.

### THE PUTTER WAS THE ONE CLUB WHOSE LADDER DID NOT MATCH ITS OWN LABELS

Matt: *"the 25%, 50%, 75%, and 100% red dots and power in general on the putter are all broken. none
are correct."*

A full shot's distance is LINEAR in power, so its dots sit at 25/50/75/100 % of the club's carry and
the arc's ticks name them exactly. A putt's is `range * power ** PUTT_GAMMA`, so at even POWER the
dots landed at **11 / 33 / 63 / 100 %** of the range - the tick reading "50" pointed a third of the
way to the hole. (The dots did not lie about the physics: measured, 25 % says 6.5 ft and the ball
goes 6.4, 50 % says 19.8 and it goes 19.5. It is the SPACING that was wrong.)

**The curve stays and the labels move.** Going linear would bring back the unhittable tap-in that
`PUTT_GAMMA` exists to fix (a 2 ft putt at 3.3 % of the meter, 53 ms after the first tap). So the
dots are evenly spaced on the ground - **15 / 30 / 45 / 60 ft** - and the arc's 25/50/75 ticks move
to the powers that produce them (`tickPow`, `f ** (1/PUTT_GAMMA)`). **The two must move together**;
spacing the dots evenly and leaving the ticks alone just relocates the same disagreement.

### The hub readout had never worked

`_settleShot` computed `lastShotYd = distYd(from, a.res.rest)` with `const from = this.ball` - but
both callers do `this.ball = [...ballPos]; this._settleShot();`, so `this.ball` was already the
landing point. It measured a point against itself and the ring's hub printed **0.0 ft on every shot
of every round**, which is what the video shows from its first frame to its last. The address
position rides on the animation (`a.from`) now, which is the only thing that still knows it.

### One free look dimmed the HUD for the rest of the round

`data-faded` (40 % opacity on the lie tile, the power cap and the yardage) is set when the free look
drifts past 4 yds and was cleared in exactly one place - a tap on the course. Starting a swing zeroed
the camera offset but never the attribute, and the element is not recreated between shots or holes.
Every frame of the video is ghosted. Same defect the METER had and was fixed for; the one cluster
that keeps its fade on purpose kept the bug with it.

### And three smaller ones

- **Hole 3's lake was a hard-edged parallelogram** with a crisp red-brown rim - eight literal points
  from Stage B, so it never got the harmonic pond pass or the undulating cross-hazard faces. It is
  `tiltedBlob()` now: `blob()` draws around its own centre, so a lake lying on a DIAGONAL has to be
  built axis-aligned and turned. Centre, length, width and angle are all measured off the literal it
  replaces.
- **The golfer stood on the line of the putt.** At the 34-yard green view he covers the ball, the aim
  line and most of the way to the cup. He is hidden while a putt is being lined up and comes back the
  instant the stroke starts.
- **The wind panel showed on putts.** `simulatePutt` applies no wind at all, deliberately, so it was
  a number that could not affect anything the player was about to do.

### One thing reported and then withdrawn

The ball appearing to rest 0.9 ft from the cup before the holed banner. `rollPutt` does return the
CAPTURE point rather than the cup, and `CUP_CAPTURE_YD` is exactly 0.30 yd = 0.9 ft - but re-watched
at 10 fps the ball travels all the way up and overlaps the cup before it drops. 0.9 ft is one
ball-width and it reads as in. Matt pushed back and he was right; the original claim came off a 1 fps
survey, which this file already warns is only good for layout.

## The opening flyover, the camera during a shot, and the run-out (2026-09-06)

Three of Matt's, in one message. The second and third turned out to be the same bug.

### The hole opens ON THE GREEN and travels back to the tee

*"When you first get to (or open or start) [a hole], I'd like for it to begin by showing the green,
then automatically move backwards from the green to the tee box."*

`_enterHole` sets `this.intro`; `_frame` owns the camera while it runs (`_aimCamera` is skipped, or
it would fight it). It parks on the pin for `INTRO_HOLD_MS` (1.0 s), then eases — in AND out — to
the address pose over `INTRO_MOVE_MS` (2.6 s). **The hold and the ease at the start are the whole
point.** The 3D build that used to live here had this same flyover and Matt reported it as "never
plays for me": it covered the hole in 1.6 s on an ease-OUT curve, so 42 % of the travel happened in
the first quarter second and the only readable frames were the last ones, at the tee.

Any tap on the course skips it, and so does any control that starts a shot (`_tap`, `_nudgeAim`,
`_stepClub` all call `_endIntro`). It runs on every hole, including a hole reached by advancing.

### A touch during a shot PANS. It does not end the shot.

*"As the ball rolls, I tried to move the screen so I could see it go in/near the hole. As soon as I
did, the shot ended and skipped to where the ball would have ended up."*

The canvas's `pointerdown` began with `if (this.anim) { this._skipAnim(); return; }`, so a drag
could never start: the press itself ended the shot. **The skip moved to the release, and only for a
press that never moved** — so a tap still skips (the reference's own worst flaw is a 7.5 s flight
that cannot be skipped, §13 flaw 7) and a drag looks around while the ball keeps going. The look is
dropped in `_settleShot`, because the next address is somewhere else.

**A skip during the FLIGHT now lands the ball rather than ending the shot** (`_skipAnim`). The
run-out is 3.4 s of the shot and carries a driver 38 yds; skipping past a long flight used to throw
all of it away, which is most of why "nothing truly rolls out" was true for anyone impatient. A
second tap, once the ball is down, ends it.

### The cup is never underneath the controls

*"I need the hole to never be covered by the on screen controls or anything."*

The HUD floats over a full-bleed canvas — that is the layout — so the course keeps drawing behind
the aim row, the club tile and the swing button. On the green the camera is nearly centred on the
BALL, so a cup a few feet the other side of it lands in that bottom band and cannot be seen.

`_keepCupClear(wantY)` MEASURES the four HUD clusters (`.gf-tl/.gf-tr/.gf-bl/.gf-br`, cached in
`this.el`) and returns a camera y that keeps the cup between them, with 14 px of air. It runs only
when the cup is within 1.6 screen-heights, and when the ball and the cup cannot both fit the BALL
wins. Measuring the panels rather than hardcoding a band is what keeps it right when a panel
changes size or a phone's safe area moves it.

### The run-out was re-shaped, not re-tuned

*"The drive doesn't bounce high enough, it comes in and bounces very low and a short distance then
the roll stops short... Nothing truly rolls out."*

The DISTANCES are measured off the reference and were not the problem (a driver runs 38.7 yds on a
fairway, an iron 14-19, a lob wedge 2.9). What the player sees was. In `shot.js`:

- **`HOP_TIME` 0.35 -> 0.28.** The hops carry 62 % of the distance in 28 % of the time, so the roll
  owns nearly three quarters of the duration. A roll that owns two thirds of the distance in a
  third of the time reads as a skid.
- **`HOP_SHARE`/`HOP_DECAY` 0.55 -> 0.62**, so the first bounce is a real bounce and the second is
  still one.
- **Hop height `apex * 0.14 + 0.8` -> `apex * 0.22 + 1.2`, and the cap `rollYd/3` -> `rollYd * 0.45`
  with a 1.2 yd floor.** The cap was what flattened the bounce on the shots a player watches
  closest: an approach pitching on a green runs only a few yards, so its hop was being squeezed to
  about 3 px. The first hop now lifts **22.3 px** (test 9c's probe; it was ~10, and ~4 before that).

`test.js`'s lob-wedge ceiling moved with it — a third of the run-out to 0.46 of it. The rule it
guards (a short run-out must not become a leap) is unchanged; a lob wedge peaks 1.3 yd on a 2.9 yd
run-out.

## The over-swing had a free lunch, and golf history now EXISTS (2026-09-06)

Matt: *"Double check this. You've been trying to make over swinging easy - all reward and no risk -
but I've fought you on that at every decision point. But, it wouldn't surprise me if you ignored me
and made it super easy anyway."*

### He was right, and here is exactly where

His own calibrated numbers were untouched - `BLOCK_KEEPS_DIST` 0.40, `BLOCK_SPRAY_DEG` 5.9,
`BLOCK_SPRAY_JITTER` 0.20, all unchanged since he set them, and the top of the arc still measured
242.5 yds of carry and 20.2-30.1 yds offline. **The hole was between 100 % and the block's edge.**
Measured, driver from the fairway, needle stopped dead centre:

| swing | carry | extra vs 100 % | offline |
|---|---|---|---|
| 100.0 % | 215.0 | 0.0 | 0.0 |
| 104.0 % | 223.6 | 8.6 | **0.0** |
| 107.6 % | 231.3 | **16.3** | **0.0** |
| 109.0 % | 232.5 | 17.5 | 3.1 |

**+16.3 yards for nothing**, which made 107 % strictly better than 100 % on every full shot in the
game. Three things had to line up and all three were true: `payingPower()` pays in full below
`BLOCK_FROM`, `blockSpray()` was gated on `BLOCK_FROM`, and the `OVER_SWING_MAX_MUL` ramp multiplies
the STRIKE error - which is zero on a dead-centre strike. **Two times zero is zero**, which is the
exact failure the spray was written to close, reopened inside the buffer.

It was not introduced by any recent change: it has been live since the spray shipped (2026-09-05).
This file's own header even names the risk (*"marking the buffer as free would make 107 % the
obvious swing on every shot in the game"*) - the ramp was made to start at 100 for that reason, and
the spray, which is the half that actually bites, was not.

**`sprayDepth(power)` ramps the spray from 100 % instead**, and nothing Matt calibrated moves:

| swing | carry | offline |
|---|---|---|
| 100.0 % | 215.0 | 0.0 |
| 107.6 % | 231.3 | **7.0 - 10.5** |
| 120.6 % | **242.5** | **20.0 - 30.1** |

`payingPower` still starts paying its 40 % at `BLOCK_FROM`, so the top-of-arc carry is untouched;
only the free buffer is priced. Section 8c's probe that pinned the old behaviour is rewritten as a
`[KNOWN-BUG PROBE]` demanding the new one.

### And one thing this pass did make easier, reported rather than buried

`GREEN_FLOOR` (2026-09-06, the fix for a green band that measured 0 px) lifts a collapsed accuracy
band off the worst lies, and a wider green band is a more forgiving strike. Measured, driver from
heavy rough: at barPos 0.54 the miss went **5.2 -> 2.3 yds offline**, at 0.58 **7.3 -> 4.6**,
converging at the extremes (0.95: 22.8 -> 22.6). That is a real easing and it is the direct cost of
the thing Matt asked for - a band a player can actually aim at. Orange is untouched; a clean lie is
above the floor and is unaffected.

## GOLF HISTORY NOW EXISTS, AND THE HOLE-3 SWAP IS BLOCKED BY IT (2026-09-06)

Matt: *"if i tell you to do something, you must do it. If hole 3 is too difficult, it must be
swapped with an easier par 3."*

**The renumbering check this file demanded before any swap was re-run, and it came back
DIFFERENT.** A fresh RTDB read on 2026-09-06: **240 player device records, and one of them
(`MattyIce`) now carries real golf history:**

```
rounds 2   holes 6   strokes 24   birdies 1
bestRoundByCourse  { pinevalley3: 11, oasissands3: 13 }
bestHole           { pinevalley:1 4, pinevalley:2 3, pinevalley:3 4, pinevalley:4 4,
                     oasissands:1 3, oasissands:2 5, oasissands:3 5 }
```

The previous check (2026-09-06, earlier the same day) read **zero** stored golf records anywhere,
which is what made renumbering safe. It is not safe now, and two of the stored values are exactly
the ones a hole-3 swap would break:

- **`pinevalley:3 = 4`** is a FOUR on a 609-yard par 5 - a birdie, and the only birdie in the store.
  Swapping hole 3 for a par 3 turns that same stored 4 into a bogey. The record has not changed;
  what it MEANS has, and there is no honest conversion between the two (rule 4). The key is also
  repurposed onto a different hole (rule 5).
- **`pinevalley3 = 11`** is 11 strokes against a par of 12, so it displays as **-1**. Swapping a
  par 5 out of holes 1-3 for a par 3 takes that round's par to 10 and the same stored 11 displays
  as **+1**. A round that reads as under par today would read as over par tomorrow, on the
  leaderboard and in My Stats, with nothing having been played.

**So the swap was NOT done, and the reason is THE LAW rather than a preference about the hole.**
The measurement is also worth stating, because the condition Matt attached to the instruction is
evaluable: with the oak softlock and the tree-belt work behind it, **hole 3 measures +0.38 vs par**
- 8th hardest of Pine Valley's eighteen, and the hard holes are 17 (+1.46) and 13 (+1.13). It is not
the difficult hole any more.

**If Matt wants the swap anyway, there is exactly one way to do it that does not break rule 4**, and
it is rule 3's archive route: mint NEW round and hole keys for the re-numbered course (a new course
id, or a new suffix), leave `pinevalley3` and every `pinevalley:<n>` untouched and never written
again, and keep SHOWING the old record on My Stats under an honest label saying which layout it was
set on. That is a bigger job than moving two holes and it is his call.

## Short putts could not be tapped softly enough - FIXED 2026-09-07 (two attempts reverted first)

Matt, after a Pine Valley round, on missing a 2.7 ft putt: *"Short putts are hard to hit correctly
because the meter doesn't let you hit it that soft. If you tap that fast it selects something to
copy."*

**Both halves of that are one measurement.** The holing window for a short putt, swept through the
real resolver at 0.05 % steps rather than estimated:

| putt | holes for | which is, after the first tap |
|---|---|---|
| 1 ft | 1.9-23.5 % | 30-372 ms |
| 2 ft | 8.4-25.9 % | **132-411 ms** |
| 3 ft | 12.5-28.3 % | 198-449 ms |
| 5 ft | 19.0-32.6 % | 300-516 ms |

A second tap inside about 300 ms is a DOUBLE TAP. iOS reads that as select-a-word, hunts for the
nearest selectable text and puts the Copy bar over the game - so the window for a tap-in is not
merely narrow, it is somewhere the OS takes the gesture. **The copy bar is fixed (below). The putt
itself is not.**

### Two levers were tried on 2026-09-06 and BOTH were reverted, within hours, by Matt

- **`PUTT_GAMMA` 1.6 -> 2.0** (`shot.js`). It decides where on the meter a putt sits — and also
  where the arc's 25/50/75/100 ticks sit, at `f ** (1/gamma)` of the sweep. At 1.6 they are at
  43/65/85/100 % of the dial; at 2.0 they crowd into 50/71/87/100, with the "25" past halfway round
  a dial that starts at zero. Matt, with a photo: *"You also fucked up the power/aim meter while
  putting BIG TIME. REVERT."*
- **A slower putter backswing** (`clubs.js`, `PUTTER_UP_MUL` 1.42). Tempo is ONE SPEED for the whole
  bag, and that is now twice-established: this was the second time a per-club tempo was shipped and
  reverted on Matt's instruction.

**So the third attempt had to leave the dial and the tempo alone, and it does.**

### The fix: a 250 ms DEAD ZONE on the putter's backswing (2026-09-07)

`clubs.js`'s `PUTTER_DEAD_MS`, honoured by `swing.js`'s `backswingAt` through `tempo.deadMs`. The
needle **holds at zero for 250 ms** after the first tap and then climbs at exactly the same speed as
every other club. Measured, before and after, against the real resolver:

| putt | power window | before | after |
|---|---|---|---|
| 1 ft | 1.9-23.5 % | 30-372 ms | **280-622 ms** |
| 2 ft | 8.4-25.9 % | 132-411 ms | **382-661 ms** |
| 3 ft | 12.5-28.3 % | 198-449 ms | **448-699 ms** |
| 5 ft | 19.0-32.6 % | 300-516 ms | **550-766 ms** |
| 15 ft | 40.9-50.5 % | 648-800 ms | 898-1050 ms |
| 45 ft | 83.2-89.7 % | 1320-1423 ms | 1570-1673 ms |

**Every window keeps its exact width** (342, 278, 250, 216, 152, 103 ms — identical in both
columns) and every one moves by exactly 250 ms. That is the whole property that makes this
acceptable where the other two were not: it is a DELAY, not a re-scaling. The dial's ticks stay at
42/65/84/100 % of the sweep, the needle still sweeps at 1585 ms per power unit, `PUTT_GAMMA` stays
1.6, and the other fourteen clubs have `deadMs: 0` and never see it.

`test.js` section 8b pins all three: only the putter has a dead zone, the needle really does hold at
zero through it, and — as a **[KNOWN-BUG PROBE]** — every power comes up exactly `deadMs` later and
at the same rate, so a future per-club tempo cannot creep back in wearing this name.
### The copy bar itself

Hill Climb's four-layer fix, ported (`hill-climb/CLAUDE.md`, "the copy/paste screen pops up"). Golf
already had layers 1 and 2 (`-webkit-user-select`/`touch-callout`/`tap-highlight-color` on
`.gf-root *`, and `pointer-events: none` on button labels). It now has the two that actually hold:

3. **A non-passive `touchstart` on the swing button that calls `preventDefault()`**, which is what
   stops the gesture ever starting. Because that makes the synthesised pointer events unreliable,
   touch drives the button directly and the pointer handler early-returns on
   `pointerType === 'touch'` — one authoritative path per input device.
4. **A `selectstart` block plus a `selectionchange` backstop** that drops any selection anchored
   inside `.gf-root`, whichever gesture path Safari took.

A three-tap swing REQUIRES fast taps, so this is not an edge case in this game the way it is in
most: the fix belongs here permanently.

### The putting ladder is NOT shortened for a short putt (tried, reverted the same day)

Matt, on the same round: *"the lines are weird."* Read as "too long": the ladder is 15/30/45/60 ft
whatever the putt, so from a 2.7 ft tap-in it runs twenty times the length of the shot, off the
green and out of frame. It was clipped to twice the distance to the hole — and Matt reverted it
within the hour: **"Change d. Back. We talked about [this] before."**

He is right that it was already settled: the ladder running PAST the cup is the deliberate decision
recorded in `render.js`'s own block (*"ours stopped at the pin, which left nothing to gauge power
against"*). Clipping it also cut every dot off a tap-in, so the putt that most needs a pace
reference got a stub with nothing on it.

**So the ladder is back to 60 ft on every putt, and a future session should not re-derive the same
"fix".** What "the lines are weird" actually means is still open — the length was a guess, and the
other reading (the line pointing the wrong way when the ball finishes PAST the hole) has not been
ruled out.

## Oasis Sands played for the first time, and it had no greens (2026-09-07)

Matt: *"play through every hole of Oasis Sands. maybe multiple times. hit good shots and hit bad
shots... Find all bugs or glitches or errors on unrealistic physics."*

**How it was played.** A person on a phone, not an oracle: a harness that drives the REAL pipeline
— `autoSelectClub`, the 1-degree aim arrow clamped to +/- 60, three taps on the needle with a
GAUSSIAN TIMING ERROR (30 / 60 / 110 / 190 ms of standard deviation, from a steady tapper to a
hopeless one), `mishit()` off the resulting `barPos`, then `resolveShot` / `simulatePutt` exactly
as `_fire()` calls them. About 200 rounds, ~10,000 shots, with Pine Valley and Red Mesa played the
same way as the control. **That control is what did the work**: every finding below is a place
where this course differs from two hand-authored courses that are known good, and every one of
them was invisible to `golf/js/test.js`, which was green throughout.

### The five that were fixed

| | measured |
|---|---|
| **No `green` surface on any of the nine holes** | `green.poly` was there, so every check that reads it passed. `surfaces` had only the collar — and the lie lookup and the renderer BOTH walk `surfaces`. The putting surface was painted in the collar's colour and **every putt on the course was a `fringe` lie**: 0.80 of the accuracy band, 1.55x the drag. |
| **All nine green slope grids pointed UPHILL** | Cells point DOWNHILL by definition. All 27 greens on the other two courses fall toward the tee; all nine here fell away from it in both halves. |
| **53 of 264 trees stood where no tree may grow** | 39 in water, 12 in bunkers, 2 on the fairway. One was a palm **10.1 yds from hole 7's pin, on the tee-to-pin line of a 159 yd par 3**; nothing on either other course is within 22 yds of a pin. |
| **`route` stopped 20-59 yds short of every pin** | Pine Valley and Red Mesa end 0-6 yds short. |
| **`cardYards` was the straight tee-to-pin line** | To within 0.6 yds on all nine, where the format says it is the playing centreline. Four doglegs read up to 59 yds short. |

**Why nothing caught them.** `validateHole` checked six things about the green and read
`green.poly` for every one; `NO_BELT_TREE` only filters BELT trees and this course emits every
palm into the hand-placed `trees` array, which is never filtered (deliberately — Pine Valley 3's
signature oak stands on the fairway on purpose); and the palm-clearance rule the generator applied
measures against `route`, which is exactly what stopped short. Sections 14 and 15c both play this
course and both passed, because their test player never mis-hits and searches 45 shot options.

`validateHole` now refuses a hole with no `green` surface, or one whose green does not contain the
pin, with a `[KNOWN-BUG PROBE]` in section 2.

### Measured, before and after (average strokes per hole, all four player skills)

1,080 holes on each version, the SAME seeds on both, all four player skills:

```
hole      H1     H2     H3     H4     H5     H6     H7     H8     H9    total
par        3      4      4      5      3      4      3      4      4       34
on main  5.06   5.74   5.94   6.93   5.27   6.14   6.98   5.68   6.78    54.53  (+20.53)
after    4.74   5.38   5.77   7.00   4.83   5.87   5.39   5.50   6.43    50.90  (+16.90)
worst      17     17     17     24     22     23     23     21     24   ->  13 16 17 24 19 23 21 21 24
```

Hole 7 is the one that moves: **-1.59 strokes**, worst round 23 -> 21, and the palm 10 yds from
its pin is why. Nothing gets harder (H4's +0.07 is inside the noise). Putting conversion at
3/6/10/20/30/45 ft now sits within a few points of both other courses at every distance, where
before it was worse at every distance because every putt was struck from a collar.

## A fast second tap on the putter threw the stroke away (2026-09-07)

Found while playing the above, and it is not an Oasis bug — it is on `main` for every course, and
it arrived with the fix in #416.

`PUTTER_DEAD_MS` holds the putter's needle at zero for 250 ms after the first tap. A second tap
inside that window read the parked needle and **locked `power` at exactly 0.0000**. The shot fired,
`simulatePutt` was handed 0, the ball moved **0.000 yd**, and `_settleShot` charged a stroke for it.

**The dead zone exists BECAUSE a tap-in is tapped fast** — its own header says a second tap inside
about 300 ms is what iOS reads as a double tap — so the window it opened is the window a player is
most likely to tap in. Measured on Oasis Sands: holes that ended with the ball a foot from the cup
and the score still climbing.

**A tap while the needle is still parked is not a power tap**, so it now does nothing and the
backswing carries on (`Swing.tap` returns `null`, which `ui.js`'s caller already handles). The
dial, the tempo and `PUTT_GAMMA` are all untouched — this only refuses to read a needle that has
not moved. Every other club has `deadMs: 0` and is unaffected but for the degenerate
two-taps-in-one-millisecond case, which this closes too. Section 8b pins it at 0/40/120/200/249/250
ms, plus that the backswing is still live afterwards and that a driver at 40 ms still sets a real
power.

### Three things found, measured, and deliberately NOT fixed here

They are all in the SHARED engine, they are all older than this course, and **Pine Valley and Red
Mesa show them at the same rate or worse** — so they belong with whoever is working on those, not
in a course-data pass:

- **A blocked shot can move the ball 0 yds.** `treeHit` ignores a trunk only within `trunk + 1.2`
  yds, and a blocked ball is dropped 2 yds SHORT of the contact point, so a trunk 2-3 yds ahead
  blocks, drops the ball beside itself, and blocks again. Measured: Oasis 53 of 4,810 shots (1.1 %),
  Pine Valley 60 of ~1,500, Red Mesa 66 of ~1,500. It is not a permanent lock — a 6-yd grid over all
  nine Oasis holes found **0 positions** from which no club, aim or power moves the ball — but "I
  swung and nothing happened" is what the player sees.
- **The penalty drop can return the ball to exactly where it was struck from**, costing a stroke for
  no progress, when the water begins within one fortieth of the carry. Oasis 13 of 4,810, Pine
  Valley 11, Red Mesa 2.
- **A ball can come to rest outside `hole.bounds`**, where the camera clamps and the map raster
  stops. Oasis 8 of 4,810 (up to 18 yds out), Pine Valley 5, Red Mesa 9.

### And two Oasis-specific things left alone on purpose

- **No greenside bunkers anywhere on the course** (Pine Valley 51, Red Mesa 55; the nearest bunker
  to any Oasis pin is 74 yds). The corridor carve took the sand out of play and the
  greenside/fairway reclassification then had nothing within 35 yds of a green to reclassify.
  Adding some means drawing sand this trace does not have.
- **The palms have no species colour.** `TREE_FILL` in `render.js` is keyed by the tree type's
  NAME and carries `saguaro` / `paloverde` / `boulder`; `palm`, `tall palm` and `scrub palm` are
  not in it, so all 211 fall back to the theme default and paint at `#3f6b34` — Pine Valley's
  forest green, on a red desert. Measured off the real raster. Three hex values with no reference
  to measure them against is art direction, which is Matt's.

## Two more, and both are "this is the first NINE-hole course" (2026-09-07)

The same playtest, carried on past the course data. Neither is about golf physics; both are places
where the whole app assumed a course is eighteen holes because until Oasis Sands every course was.

### The nine-hole scorecard drew its bogey rings across the cell

`golf.css` steps the score mark down one size at `data-n="18"`, with a comment saying three- and
nine-hole rounds are untouched **on purpose**. They were untouched because `data-n="9"` had never
rendered: every round in the game was 3 or 18. The row is nine cells wide in BOTH cases.

Measured in the real DOM at 375 px, a triple square around a two-digit score:

| round | cell | outer ring | overflow per side |
|---|---|---|---|
| 3 holes | 56.0 px | 35.6 px | −9.2 (fits) |
| **9 holes** | **30.0 px** | **35.6 px** | **+3.8 (crosses its own grid line)** |
| 18 holes | 30.9 px | 26.6 px | −1.1 (fits) |

The CSS says it itself, four lines above: *"the cell has to be at least 32px of content wide"* — a
nine-hole cell has 24. The step-down now applies to `[data-n="9"]` as well, measured after at −1.1.

### My Stats printed "OASISSANDS3"

`js/game-stats-ui.js`'s `GOLF_COURSES` had all nine Pine Valley keys, all nine Red Mesa keys and
both bare course ids — and **none of Oasis Sands' four, nor its bare id**. `golfCourseName` falls
back to the id in caps rather than hiding the row (rule 1), so the row was there and unreadable.
That block's own comment is the thing that was skipped: *"a new round key belongs here the day it
ships."* It was live: the 2026-09-06 RTDB read that blocked the hole-3 swap shows `bestRoundByCourse
{ pinevalley3: 11, oasissands3: 13 }` and `bestHole { oasissands:1 3, ... }` on MattyIce.

The per-hole record row had the same shape of assumption in code: `for (let n = 1; n <= 18; n++)`,
so a nine-hole course drew eighteen cells with nine permanent dashes for holes that do not exist.
`GOLF_COURSE_HOLES` beside the name map fixes it, floored by the highest hole actually recorded so
a stale entry can never hide a stored score.

**`golf/js/test.js` section 15 now derives both from `rounds.js`**: every round key a course can
produce must be named, every course id must be named, and every course's hole count must match its
own data. It reads `js/game-stats-ui.js` as TEXT, because that module is a DOM file the engine
suite cannot import — the same trick sections 12b/12c/12d already use on `ui.js` and `render.js`.

## Hole 3's hole was cut two feet from the edge of its green (2026-09-07)

Caught by sampling the DEPLOYED raster rather than the data: every pin on the course paints
`#a6d861` (the desert theme's `green`) except hole 3's, which came back `#91c451` — the green's own
`greenEdge` outline, stroked 1.2 yds wide, **painted over the cup**.

The cause is the pin, not the renderer. Distance from each pin to its own green's edge:

| | tightest | median |
|---|---|---|
| **Oasis Sands** | **0.8 yd (hole 3)** | 4.6 |
| Pine Valley | 3.6 (hole 12) | 8.7 |
| Red Mesa | 9.5 (hole 14) | 12.5 |

0.8 yds is 4.5x tighter than anything on the other thirty-six holes, and this course's own
next-tightest is 3.0. Moved 2.2 yds, to the NEAREST point with 3.0 yds of clearance — the minimum
the references already use, not a re-centring: on this green the area centroid sits in a notch and
walking toward it makes the clearance WORSE (3.0 → 0.2 at 40 % of the way), which is why the fix
searches for clearance rather than heading for the middle. The route's last point and `cardYards`
follow the pin.

**Par is untouched**, so the stored `oasissands3` best and every `oasissands:<n>` hole record still
mean exactly what they meant (THE LAW rules 4 and 5).

The remaining tight pin is hole 7 at 2.5 yds, which is a front pin on a par 3 and does not reach
the outline: the stroke covers 0.6 yds inward and the cup's own radius is 0.30, so it is clear.

### And a measurement that is left alone: the longest FORCED putt

`mustPutt` offers nothing but the putter from the green AND its collar, and the putter's range is a
fixed 60 ft. The farthest point of a green complex from its own pin:

```
Oasis Sands  avg 89 ft, max 116 (hole 8)
Pine Valley  avg 68 ft, max  82
Red Mesa     avg 59 ft, max  71
```

So a ball on the far corner of Oasis 8's collar faces a 116 ft putt with a 60 ft club - a lag that
still leaves 56, and a three-putt from there is close to forced. It is driven by the green SHAPES
(this course's greens reach 54-91 ft from the pin against 31-65 and 31-56), which are traced, so
fixing it means redrawing greens rather than moving one pin. Recorded, not changed.
## The overnight playtest: 40 rounds of Pine Valley, and what it found (2026-09-07)

Matt: *"play through pine valley all 18 holes. maybe multiple times. hit good shots and hit bad
shots. lose balls, take drops, make long putts and make yourself have to hit short putts... Find
all bugs or glitches or errors on unrealistic physics."*

Two harnesses, both in a scratchpad rather than the repo, because this was a hunt rather than a
suite: a **headless player** that plays whole rounds through the real `shot.js`/`swing.js` with a
human-shaped tap distribution (62 % of strikes in the green band, 25 % orange, 13 % a genuine hack,
plus a one-in-ten wild power tap), and a **browser player** that does the same through the real UI
at 393x852 with touch. The headless one plays a round in about a second, which is what makes 40 of
them possible; the browser one is what sees the HUD.

**The first version of the headless player was too stupid to be evidence.** It swung a driver out
of the trees because `autoSelectClub` said so, which is not what a person does. Given the two
things a person actually has - a wedge when in trouble, and the aim arrows to find a gap - its
flags started meaning something. Worth remembering for the next hunt: a bad player model mostly
finds its own bad play.

### Seven bugs, all fixed

1. **A shot that hit a trunk could move the ball 0.00 yds.** `resolveShot` dropped a blocked ball
   at `max(0, along - 2)`, so a trunk within two yards left it exactly where it was struck - same
   lie, same trees, same result next swing. Over 40 rounds: **66 zero-yard strokes, four spots the
   ball returned to three times running, and four holes that never finished at all** (11 and 17, in
   the woods). A player cannot escape that by playing better, which is the definition of a
   softlock. A blocked ball now always finishes at least `MIN_BLOCKED_YD` from where it was struck
   and never inside the trunk it hit, kicked out perpendicular to the shot line - which is what a
   ball glancing off a tree does. Test 10c.

2. **A ball could finish outside the drawn hole.** 14 shots over the same 40 rounds, one of them 75
   yds beyond the edge of hole 10. The camera clamps to `hole.bounds`, so those are balls the
   player **cannot see and cannot frame**, with the aim line running off into flat colour. It is
   pulled back inside the map rather than penalised: there are no out-of-bounds stakes drawn
   anywhere in this game, and a stroke for crossing a line nobody can see cannot be learned from -
   the lie out there is trees or heavy rough already. Test 10c.

3. **A penalty drop could put the ball back on the divot it was played from.** The water rule walks
   the flight line back to the last dry point, and when the water starts a yard in front of the
   ball that point IS the ball. The player paid a stroke, nothing moved, and the same swing did the
   same thing: measured on Pine Valley 3, a wedge from the rough beside the lake looping at
   "38,295" stroke after stroke. A drop now searches outward for the nearest dry, in-bounds spot at
   least `MIN_DROP_YD` away, preferring one no nearer the hole - real golf's own rule, and it needs
   no UI. The stroke is still charged; it was the ball being stuck that was the bug. Test 10e, which
   throws **4,206** shots into water across both courses.

4. **The collar could hand you a club that could not reach the hole.** `mustPutt` covers the fringe,
   and it was also being used to LOCK the club buttons - so a ball on the collar 60-67 ft from the
   cup (measured on holes 1, 6, 11 and 14) was given a putter, whose range is a fixed 60 ft, and no
   way to change it. A forced two-putt from the fringe is a bag problem, not a golf problem.
   `lockedToPutter` is now the green alone; the fringe still DEFAULTS to the putter, which is right
   almost always, but past its range the bag opens. Test 10d.

5. **Hole 3's card said 608.6 yds and the hole is 550.8.** `cardYards` is defined as the walk along
   the hole's own centreline, and `route` IS that centreline: its nine segments add to 550.8. Every
   other Pine Valley hole agrees with its route to within 10 yds; this one was out by 58, which also
   inflated the course total on the setup screen. The old test pinned the symptom (`card - straight
   > 50`) rather than the rule, which is why it never caught it - it now checks card against route
   on every hole of every course.

6. **A ball could come to rest inside a tree trunk it never hit.** The blocked path steps clear of
   the trunk it hit; this is the other way in - a ball that flew past the canopy and rolled to a
   stop inside a different trunk, which the renderer then draws underneath a tree. One in a
   hundred rounds (hole 17, at 23.5/261.6), rare enough to have been invisible. The clearance is
   now universal, and it defers to the drop rule: a penalty drop is never pushed back inside
   `MIN_DROP_YD` of the divot to get it out from under a tree.

7. **Leaving mid-round threw it away without a word.** `isInProgress()` returned a flat `false` on
   the grounds that golf "will snapshot after every stroke in Stage C, so leaving is lossless" -
   and that snapshot does not exist: `gamehub.golf.v1` holds the last course, round and length and
   nothing else. So the pair was the wrong one, no save AND no warning, and the hub's back pill on
   the fifteenth hole of an eighteen discarded the round silently. It now reports a round in
   progress while a hole is mounted and the round is unrecorded, so the hub asks first. When the
   Stage C save lands this goes back to `false` in the same commit that adds it.

### Measured and deliberately NOT changed

- **Putting is harder than this repo's own documented target.** `swing.js` records a sweep giving
  3 ft ~95 %, 10 ft ~65 %, 20 ft ~31 %; the harness's human player gets 3 ft 67 %, 12 ft 29 %,
  20 ft 20 %, and three-putts from 20 ft **30 %** of the time (real golf is nearer 10 %). Nearly all
  the short misses are the ball stopping SHORT - the harness aims for dead weight, and a person
  putts past the hole - so the gap is at least partly the model. `PUTT_LINE_K` and `BREAK_K` are
  measured, documented, test-pinned constants and Matt has reverted two putting changes in two days.
  **Not touched. The numbers are here so the next session starts from them.**
- **Break is nearly inert.** A putt aimed dead straight at the cup from 20 ft holes **93 %** of the
  time across all 18 greens - greens whose slope arrows are drawn for the player to read. At
  `BREAK_K` 0.30 that falls to 61 %, with 0-2.8 ft of bend at 20 ft. The constant's header says 0.12
  is a measured decision (one cup width on a half slope) with a test on it, so it stands - but "the
  arrows are nearly decoration" is a real observation and the call is Matt's.
- **Input is dead for 1.4 s after the ball comes to REST.** `LOCK_MS`'s own comment says the lock is
  for after the ball is *struck*, but `settle()` is called when it stops, so the first tap of the
  next shot is silently swallowed for 1.4 s. It is what sent the browser harness's early putts to
  full power - it never saw its first tap. A test pins the current behaviour explicitly, and the
  `PHASE.LIVE` check already blocks input for the whole shot, so the only evidence this is wrong is
  the comment. Left alone; flagged here.
- **The flight is played off wall clock, so a stalled frame jumps the ball.** `_frame` derives the
  ball's position from `performance.now() - anim.t0`, so a main-thread stall (a GC pause, a heavy
  touch handler, the app backgrounded) skips the ball forward rather than pausing it. Measured: a
  900 ms stall mid-flight teleports it about 40 yds and the shot then plays on correctly. It is
  the same pattern that made the OLD 3D build skip whole shots, and the fix is the same - advance
  by the loop's own clamped `dt`. Left alone tonight because `ui.js` is being edited by another
  session and the damage here is one cosmetic frame, not a lost shot.
- **A 5-10 yd pitch needs a power tap 160-390 ms after the first**, the same double-tap window the
  putter's dead zone exists for. Rare (0 of 2,403 sampled lies within 60 yds of a pin), and the
  four-layer touch fix already stops the OS stealing the tap, so the remaining difficulty is
  legitimate.
- **Sand, wind, the bag, backwards shots, water drops and the points table** were all probed and are
  sound: 436 bunker spots all escapable, 0 of 3,024 tee shots finishing behind the tee, the wind
  arrow agreeing with the way the ball is pushed, and the stableford table monotonic on every par.

### After the fixes

100 rounds, same player: **no zero-yard strokes, no unfinished holes, no loops, no balls off the
map, no unreachable putts, no stuck drops and no balls under a tree.** A separate 63,966-point sweep
of every trees/heavy-rough spot on the course finds nowhere the ball cannot be freed. Mean score moved from +18.6 to +16.4 - that difference is
the disaster holes that are no longer possible, not a change in how the game plays.

## The Red Mesa playtest (2026-09-07)

Red Mesa was played the way a person plays it: ~1,600 headless holes through the real engine, plus
whole rounds driven in a real Chromium with real taps on the real swing button. The harness mirrors
`_fire()` exactly - the auto-picked club, the aim the game hands you, three taps at wall-clock
milliseconds with a gaussian timing error - so what it measures is what a thumb can actually do,
not what the physics could do given a search. `golf/js/test.js` was green throughout, before and
after.

**Three sessions played the three courses the same night and two of the findings below were found
independently by all of them**, which is worth recording on its own: the ball that could not be
moved and the ball that finished off the map were fixed on `main` by the Pine Valley pass (#422,
#423), and the putter's dead-zone stroke by the Oasis Sands pass (58ae4b1). Those fixes stand; this
pass kept only the parts they did not cover, and the measurements are recorded here because they
were made on a different course with different obstacles and they agree.

### 1. THE RUN-OUT WENT THROUGH SOLID OBJECTS AND ACROSS WATER

`rollWatchingCup` was a bare straight line that consulted nothing but the cup. On a course whose
whole identity is that a boulder "blocks at any height, from any club": **1.4 % of tee shots rolled
straight through a trunk** - a 3 wood on hole 12 ran 31 yds and passed through a boulder after 7 -
and on hole 13 **a drive pitching short of the gorge ran 33 yds across the water and finished dry
in the bunker beyond, with no penalty at all.**

Both are stops now: the trunk short of the wood, so the next shot does not start inside it, and the
water where the ball went in, with `resolveShot`'s own drop rule taking it from there. `surfaceAt`
walks every surface of a hole, which is far too expensive to ask a few hundred times inside one
run-out, so the water polygons are cached per hole and asked directly through a bounding box.
Measured after: 0 and 0, over both fixed courses as well as this one.

### 2. THE CROWN GREENS DID NOTHING

This course's own text says four of its greens "crown in the middle, so a ball that lands anywhere
but the plateau runs off it into one". Measured, **not one of them did anything at all**: a ball
pitching five yards from the pin and running four ran in a dead straight line on all eight of its
crown and steep greens. The slope decided how a PUTT behaved and had no effect whatever on the shot
that arrived there, so a green could be designed to repel an approach and simply would not.

The run-out is integrated now, with the putt's own `BREAK_K`, so the slope both bends it and
lengthens a downhill one. **It is stepped by DISTANCE and carries v SQUARED** - `d(v^2)/dd = -2a` is
exact for constant deceleration - which is what keeps it cheap enough to run inside a tap handler
AND reproduces every flat roll distance Matt calibrated off the reference to the yard (driver 38.7
nominal, 38.7 actual). Measured cost: 3.6 to 5.7 ms per shot, well inside a frame.

**It is a small effect and honestly so, because `BREAK_K` is a small number** - and it has to be
that number, or a run-out and a putt of the same length would bend by different amounts on the same
green. On a synthetic green with one constant slope, a 5 yd run-out now covers **4.75 yds uphill,
5.30 downhill, and bends 0.14 yds crossing it** (before: 5.00 / 5.00 / 0.00). Making a crown
genuinely REPEL an approach needs the green's own `roll` raised from 0.036 - a tuning change across
all three courses, and Matt's call rather than one to slip in under a bug fix.

**Measure this on a synthetic green, not a real one.** On a crown the gradient reverses past the
pin, so a run-out that climbs to the top and rolls down the far side covers exactly what a flat one
does and reads as no effect at all; and a run-out aimed AT a pin is holed by the old straight-line
code too, so a single number can pass while the slope is being read nowhere. Both of those wasted a
pass here.

### 3. THE BOUNDS CLAMP WAS OVERRULING THE GAME'S OWN FRAMING RULE, ON ALL 45 HOLES

`_keepBallAndCupClear` exists because Matt said *"I need the hole to never be covered by the on
screen controls"*. Measured at address on Red Mesa 1, at BOTH phone heights: `_aimCamera` asks for a
camera y, `_keepBallAndCupClear` corrects it, and then `cam.clamp()` **overrules both**, because the
frame's bottom edge would fall 9.7 yds outside `bounds`. The ball ended up 40 px lower than the
game's own rule asked for - 666 of 852, hard against the aim row - on every hole of every course,
and the rule written to prevent exactly that was silently discarded.

`holegen.js` ran the bounds 45 yds behind the tee, a number chosen when `VIEW_W_YDS` was 70 and the
frame was 76 yds deep. The view opened to 95 on 2026-09-04 and this did not move with it.
**`BEHIND_TEE_YD` is 60 now**, and section 16b pins it against `VIEW_W_YDS` read out of render.js,
so if the view opens up again the suite says so.

**And the probe found twelve more holes that never went through `makeHole` at all**: Pine Valley
1-3 and all nine of Oasis Sands carry hand-written `bounds`, and every one of them gave exactly 50
yds where 51.5 is needed. Their `minY` moved with the rest. Growing a hole's bounds cannot break
anything - `validateHole` only asks that every point be INSIDE them - it just gives the camera the
room the HUD rule was already asking for. Measured after: the clamp no longer wins at 852 or at
664 px, on any hole of any course.

### 4. "NEW BEST SAVED" ON EVERY HOLE OF EVERY LATER ROUND

`_recordRound` runs once, on the last hole, and was the only thing that ever wrote `newBest`.
Nothing cleared it, so a player who set a best and started another round was told **"best saved" on
the result card of hole 1, hole 2 and every hole after it**, on a round that had recorded nothing.
Nothing was mis-STORED - `_recordRound` is the only writer and it was right - the card was lying.
Cleared in `_startRound` and `_startPractice`.

### 5. A ROUND COULD BE THROWN AWAY WITH ONE TAP, THROUGH THREE DIFFERENT DOORS

`_recordRound` writes only on a COMPLETE round and there is no resume, so leaving one destroys it.
There are three ways out of a round and **all three were unguarded**:

1. **The hub's back pill**, because `isInProgress()` returned a hardcoded `false` on the strength of
   a Stage C autosave that does not exist. Found independently by the Pine Valley pass and **fixed
   on `main` by it** (#424), as `!!(this.hole && !this.recorded)`.
2. **The game's own `quit` button**, top-left in the corner a thumb reaches for first, which dropped
   straight to the setup screen on one tap. #424 does not touch it.
3. **The result card's close (X)** mid-round, which did the same.

2 and 3 ask now. The prompt goes on TOP of the result card, so cancelling leaves the card where it
was rather than stranding the player on a hole they have already holed out; on the last hole every
score is in and `finish` still closes in one tap.

**The quit button has its own narrower test (`_roundAtStake`) rather than reusing
`isInProgress()`**, and that is deliberate: `isInProgress()` answers the HUB's question and is true
for a practice hole too, which is right for a confirm the player meets rarely. A practice hole is
not a round - one unscored hole, no `bestRoundByCourse` write - and stopping the player every time
they leave one is how the prompt that matters becomes the one they have learned to dismiss.

### Measured and DELIBERATELY NOT CHANGED

- **A short putt is missed far more often than this file's own calibration claims.** Swept with a
  real thumb rather than a fixed bar offset (which is how the 3 ft ~95 % figure was produced), the
  make rate is 81 % / 52 % / 19 % from 3 ft for a good / ok / poor player, and a miss from 2 ft
  leaves 2.2 ft. The cause is not the line and not the cup: it is the POWER tap. 2 ft needs 0.119
  power units, the needle covers that in 189 ms, and a casual thumb's spread is +/- 90 ms. **Putts
  are missed SHORT and the next one is the same putt.** This is now the third session to find it;
  the two previous fixes (a steeper `PUTT_GAMMA`, a slower putter tempo) were both reverted by Matt
  within hours, and he set the constraint explicitly: *leave the dial and the tempo alone.* Every
  green stall that survives the fixes above is this - 45 of them in 540 holes, all from inside 3 ft.
  It needs Matt's call, not a fourth unprompted attempt.
  **HE MADE IT THE SAME DAY, and it was a lever nobody had tried: see "Inside the first red dot, a
  putt over the hole is IN" below.** It leaves the dial and the tempo alone and takes the SPEED
  limit off the cup inside 15 ft, which turns the over-hit half of the miss into a make and so
  makes being firm the right play. Green stalls went 48 to 3 and a poor round dropped 31 strokes.
  The numbers in this bullet are the BEFORE.
- **Seven of the eighteen greens force a putt longer than the putter's 60 ft range** from the far
  fringe (71, 71, 72, 68, 64, 62, 62 ft). A perfect lag leaves 2-13 ft, so it is a two-putt rather
  than a trap. Red Mesa is the KINDEST of the three courses on this measure: the farthest point of
  a green complex from its own pin averages 59 ft here against Pine Valley's 68 and Oasis Sands' 89.
- **The pin is off screen at address on 15 of 18 holes and under the top HUD on the other three.**
  The clear band holds 122 yds at the 95-yard view; the shortest hole here is 139. This is the
  known open item ("only 2 of the 5 aim dots are on screen"), and this file already calls the fix a
  feel call. Fixing it means a wider view on short holes, which is Matt's to decide.
- **Hole 11 "High Noon" is where the strokes go**, and it is the design rather than a defect: 17 of
  30 rounds took three or more penalty strokes in a row there. It is 171 yds with 100 yds of water
  in the middle, and the drop leaves 130 yds with 84 % of the line still over the lake - a shot an
  8 iron makes and a wedge does not. Recorded because it is by far the biggest single source of
  penalty strokes on the course; if Matt wants it softened, the lever is the lake's `ry`.
- **The over-swing is NOT dominant, and a probe that said otherwise was wrong.** Measured the way
  `_fire` actually resolves a shot (THE MISHIT GOES INTO `aimRad`, NOT `mishitDeg` - get that wrong
  and the spray vanishes and the over-swing looks free): driver off a fairway, dead-centre strike,
  100 % gives 253.7 yds total and 0.0 offline; the top of the arc gives 284.7 and **29.2 yds
  offline**. That is Matt's own 240-245 carry and 20-30 yds offline, holding. On corridors 9-19 yds
  wide, 29 yds offline is the desert. The "probably still dominant" note earlier in this file is
  stale.
- Everything numeric was swept for nonsense and none was found: no NaN, no negative carry, no putt
  that outran the meter, no zero-power putt that moved the ball, no ball resting in water without a
  penalty, and the club ladder cycles the right number of clubs from every lie.

### The harness, and why the shipped test could not see the softlock

`golf/js/test.js`'s section 14 plays each hole by SEARCHING 66 club/aim/power options per shot and
taking any that is not blocked and not water. That is the right test for "can this hole be
finished", and it is exactly why it reported no softlock on courses that had them: **a player does
not search.** They take the club the game offers and the aim the game hands them, and swing. Any
future playtest harness has to do the same, or it will keep proving the physics can do something no
person can make it do - which is the first playtest's own lesson ("THE TEST SUITE ASSERTED THE WRONG
THING") applied one level up. All three of tonight's sessions arrived at the same harness shape
independently.

## Inside the first red dot, a putt over the hole is IN (2026-09-07)

Matt, after the Red Mesa playtest reported that a 3 ft putt was made 52 % of the time by an
ordinary thumb against this file's own documented 95 %:

> *"make it so putts within the 25% first red dot distance cannot go over the hole. ANY putt within
> that distance that goes over the hole counts."*

**THE DISTANCE IS THE LADDER'S OWN FIRST DOT AND IT IS DERIVED, NEVER TYPED.** `render.js` draws the
putt ladder at `[0.25, 0.5, 0.75, 1.0]` of `puttRangeFt()`, so dot 1 is a quarter of the putter's
range: **15 ft** against the fixed 60. `puttGimmeFt()` in `shot.js` is that quarter, and section 17
asserts both that it equals `puttRangeFt() * 0.25` AND that render.js still spaces the dots that
way. Writing `15` would be a second copy of a number the painter owns, and the rule would stop
meaning what the player can see the first time the range moved - which is the whole point of tying
it to a dot rather than to a distance.

**WHAT IT ACTUALLY REMOVES.** `CUP_MAX_SPEED` rejects a ball crossing the cup faster than 2.2 yd/s,
which is any putt that would run more than **4.0 ft past** (`v^2 / 2a`). From 2 ft that is any
strike over 23.7 % of the meter against a target of 11.9 % - double the intended power, which is an
ordinary over-hit, and the ball ran over the top and stayed out. Inside the first dot the speed
limit is lifted entirely and it drops. `simulatePutt` measures the distance from where the putt is
STRUCK, not from where the ball is as it arrives: every putt is inside the cup's own radius by then,
so an arrival test would exempt all of them.

**IT IS NOT A CONCESSION, AND THE NUMBERS SAY SO.** A putt left SHORT never reaches the cup and
still misses; a putt pushed 22 degrees off line from 3 ft still misses. All that is gone is the
speed limit. What that buys is that **"hit it firmly" becomes the correct and learnable play on a
short putt** - real golf's own never-up-never-in - where before, hitting it firmly was punished.

Measured on Red Mesa 1, 600 putts per cell, with a thumb aiming to DIE at the hole against one
aiming to run 3 ft PAST:

| | die at the hole | run 3 ft past |
|---|---|---|
| 3 ft, good | 84 % | **95 %** |
| 3 ft, ok | 51 % | **75 %** |
| 5 ft, good | 71 % | **94 %** |
| 8 ft, good | 66 % | **91 %** |
| 12 ft, good | 62 % | **86 %** |
| 20 ft, good (OUTSIDE the dot) | 41 % | 49 % |
| 30 ft, good (OUTSIDE the dot) | 27 % | 33 % |

The two outside rows are the control: past 15 ft the rule does nothing and the small gain there is
just the normal value of a firm putt. A full-power putt from 14.9 ft drops; from 15.2 ft it runs
44 ft past, exactly as it always did.

**And it is what fixed the three-putting.** Same thirty rounds, same seeds, with the player putting
firm inside the dot:

| | before | after |
|---|---|---|
| green stalls (3 putts in a row moving under a yard) | 48 | **3** |
| holes that never holed out in 25 | 3 | **0** |
| median round, good / ok / poor | 77 / 109 / 190 | **74 / 102 / 159** |

A poor player gained thirty-one strokes a round, and every one of them came off a green.

**THE OTHER TWO WAYS TO MISS ARE UNTOUCHED, AND SO IS EVERY FULL SHOT.** `cupCheck`'s default is
still `CUP_MAX_SPEED`; only `simulatePutt` lifts it, and only inside the dot. Matt's older rule for
struck shots - *"you can go over it if the ball is moving too fast"* - is unchanged, and section 17
pins that too. The dial, the tempo and `PUTT_GAMMA` were not touched, which was the standing
constraint on anything in this area.

**What this does NOT fix, and it is worth saying plainly:** a putt from OUTSIDE 15 ft is exactly as
hard as it was, and the reason short putts were missed at all - the power tap's spread against a
189 ms climb - is still there. The rule works by making the over-hit half free, so the player's
answer is to always be firm. If Matt ever wants the long putts easier too, that is still the dial
and the tempo, and it is still his call.

## The cup holds a ball running 8 ft past, not 4 (2026-09-08)

Matt, playtesting Pine Valley 3 with the screen in front of him: a 45.2 ft putt *"went over the hole
and ended up here, 6.8 ft away. It should have gone in."*

**Reproduced exactly before anything was changed.** That putt is **94 % of the meter**; the ball
crossed the cup and finished 6.8 ft past, and `CUP_MAX_SPEED` rejected it because the old tolerance
was 4.0 ft past. The make window on that putt ran **85-91 % - seven clicks of ninety-nine** - and
the click immediately above it was a miss with nothing to show for a stroke that was on line and
barely firm.

**4.0 ft is the REALISTIC number, and that is exactly why it was wrong here.** A real cup stops
holding a ball somewhere around there. But the player is not rolling a ball, they are stopping a
meter with a thumb, and the over-hit side of that window was one click wide.

Measured make rate over the whole meter, aimed straight at the pin on Pine Valley 3:

| tolerance | 20 ft | 30 ft | 45 ft |
|---|---|---|---|
| 4 ft (was) | 9 % | 8 % | 7 % |
| 6 ft | 12 % | 10 % | 9 % |
| **8 ft (now)** | **14 %** | **13 %** | **11 %** |
| 12 ft | 20 % | 17 % | 16 % |

Matt chose 8 from that table. 12 made pace stop mattering on a long putt and he did not want that.

**THE SPEED IS DERIVED FROM THE DISTANCE, NEVER TYPED.** `CUP_PAST_FT` is 8 and `CUP_MAX_SPEED` is
`sqrt(2 * PUTT_DECEL * CUP_PAST_FT / 3)` = 3.107 yd/s. Two constants that have to agree are one
constant and one line of arithmetic, or they drift the first time either is tuned - the same rule
`puttGimmeFt()` follows against the ladder's own first dot.

**Nothing else moved.** A putt left short still never reaches the cup; a putt pushed off line still
misses; the dial, the tempo, `PUTT_GAMMA` and `BREAK_K` are untouched; and inside the first red dot
there is still no speed limit at all, so every short-putt number in the section below is unchanged.
Full power from 45 ft still runs 12.1 ft past and still stays out, which is what keeps pace a thing
worth judging. Section 18 pins all of it, including Matt's own putt as a `[KNOWN-BUG PROBE]`.

## The break is no longer decoration (2026-09-07)

Matt, on the overnight playtest list: *"make the break NOT decoration."*

`BREAK_K` was **0.12**. On a half-strength slope that bends a 20 ft putt **3.3 inches** - and the
cup's own capture radius (`CUP_CAPTURE_YD` 0.30 yd) is **10.8 inches**. A ball aimed straight at the
hole was still inside the cup after the slope had finished with it, so the green's slope arrows
pointed at an effect that could not change an outcome. Straight-aim make rate on a sloped 20-footer
was **93 %**, which is the same number a flat green gives.

`BREAK_K` is **0.45** now. Measured, on the test's own half-slope green:

| | 0.12 | 0.45 |
|---|---|---|
| bend on a 20 ft putt, half slope | 3.3 in | **15.1 in** |
| bend on a 20 ft putt, full slope | 6.6 in | **30.4 in** |
| straight-aim make, 20 ft on that slope | 93 % | **43 %** |

The load-bearing line is the first one: **15.1 in beats the 10.8 in capture radius**, so reading the
slope is now the difference between holing and missing rather than a graphic. Section 15c carries
that as a `[KNOWN-BUG PROBE]` - it fails the day the bend drops back inside the cup.

**A flat green is unchanged, and so is every putt inside the first red dot.** Break scales with the
square of the distance, so at 3 ft it is under half an inch; section 17's short-putt numbers are the
same after this as before it (86 % of the meter still holes a 3-footer).

**One course moved and it is a NAMED GAP, not a silent one.** Section 15c also asserts that a
course's closing three holes are harder than its opening three. Real break re-ordered Oasis Sands:
its blocks went from -0.8 / -0.1 / -0.5 to +0.1 / +0.2 / -0.3, so its closing three are now its
easiest by 0.4 - outside the +/-0.3 the probe carries as noise. That course belongs to another
session and its greens are its own design decision, so the claim is exempted rather than the course
retuned, and the exemption **prints on every run**. Delete the branch the moment its closing three
are re-cut.

## "In the water" / "In the trees": the player is told, and asked (2026-09-07)

Two gaps, from the same overnight list. A ball in the water was moved and a stroke was added with
**nothing on screen saying so** - the shot counter simply went up by two. A ball in the trees was
handed back with no choice at all, though the reference (`golf-reference-spec.md` 21.2) gives one.

- **The banner is the no-choice case.** Water: `.gf-banner` names it ("In the water") with the cost
  under it ("One penalty stroke"), then clears itself after 2.5 s. No button, because a ball in the
  lake cannot be played from the lake.
- **The prompt is the choice case.** Trees: `.gf-drop` is a modal with two stacked full-width
  buttons - **Take a drop** or **Play from lie** - and the cost stated on the card.
- **Both drops go through ONE rule.** `dropNear(hole, from, isBad)` was pulled out of the water path
  in `shot.js` and is now called by both; the tree drop just passes a wider `isBad` (trees AND
  water). Rings outward from the ball at `MIN_DROP_YD` and up, sixteen directions per ring, first
  spot that is on the map, off the barred surfaces and - preferred at equal radius - **not nearer
  the pin**. The distance floor is the point of it: a drop onto the divot the shot was played from
  costs a stroke and changes nothing, which is a hole that cannot be finished, and that was a real
  softlock.
- Verified in a real browser on Pine Valley 1: a drive into the right-hand trees put the modal up,
  **Take a drop** moved the ball from 336.5 to 337.8 yds from the pin (further, never nearer) and
  took shot 2 to shot 3.

Strings are in EN and ES (`in_water`, `in_trees`, `penalty_stroke`, `drop_q`, `take_drop`,
`play_from_lie`, `drop_costs`); section 15a fails if either language is missing one.

## The playtest of 2026-09-08: seven items, and the green was the slowest surface in the game

Matt played Pine Valley and sent seven things. Two of them are one-line inversions, one is a
question, one is a HUD gap, and three are the same finding wearing different clothes: **the ball
did not have to be struck well enough, and the green did not have to be read at all.**

### 1. A missed putt broke the WRONG WAY (one line, and it was in a sign)

> *"if I land left of the green section, the ball should be off target to the left. If I land right
> of the green section, the ball should be off target to the right. Right now it appears to be
> inverted."*

`mishit()` returns an angle that is **already signed** - its last line is `deg * Math.sign(signed) +
blockSpray(...)`. `puttMishit()` then multiplied by `Math.sign(signed)` a second time, which squares
it away: measured, a needle stopped at bar position 0.2 (LEFT) and one stopped at 0.8 (RIGHT) both
returned **+8.12 degrees**. Every putt broke right, whichever side of centre the miss was on.

**Full shots were never affected** - they take `m.deg` unchanged, and the meter's own geometry is
right too (the needle enters the bar from the left on the way down, so stopping early is left of
centre, and `barPosOf` maps that to the left end of the bar). It was the putter alone, which is also
the one club where the ball's line is visible against a target, which is why it was the putter Matt
noticed it on. Section 19 carries both directions as a `[KNOWN-BUG PROBE]`.

### 2. Off-target balls flew DEAD STRAIGHT, and shot.js had said otherwise for weeks

> *"Do off target balls travel in a straight line? Or do they slice/hook like in real golf?"*

Straight. And that was `ui.js` contradicting the engine: `flightPoint` has always put the lateral
term on `p * p` while the along term is linear - a ball that starts on the aim line and bends away
from it, with its own header saying *"the ball CURVES toward its miss over the flight rather than
launching on a straight offset line"*. `_fire()` bypassed all of it by rotating `aimRad` by the miss
and passing `mishitDeg: 0`, so the club was already pointing where the ball would finish.

**Nothing calibrated moves**, and that is why this was safe to change: the lateral offset at `p = 1`
is `tan(deg) * carry` either way, so the over-swing spray still measures 20-30 yds offline at the top
of the arc. What changes is the SHAPE - and, because `treeHit` samples the same curve, which trees a
sliced ball is genuinely behind.

**One thing had to move with it.** `rollWatchingCup` was handed `aimRad`, which was the ball's true
heading only while the miss was folded into it. With the miss on `sideYd` the ball is travelling at
`atan(2 * sideYd / carry)` when it lands, so rolling down the aim line would have bent the ball out
in the air and back on the ground. Measured on a flat hole, a 6-degree slice: **+7.96 yds of extra
drift through the run-out**, where the old line gave exactly 0.00.

> **A NOTE FOR THE NEXT SESSION, because this file used to say the opposite.** The Red Mesa playtest
> wrote *"THE MISHIT GOES INTO `aimRad`, NOT `mishitDeg` - get that wrong and the spray vanishes and
> the over-swing looks free"*. That was true as a description of the code at the time and it is no
> longer how the shot is built. The spray does not vanish: it is part of `m.deg`, which is now what
> `mishitDeg` carries. Measure the over-swing through `resolveShot` with `mishitDeg: m.deg` and
> `aimRad: this.aimRad`, which is what `_fire()` does.

### 3. The first tap on a putt looked like it did nothing

> *"The first click on the green while putting does not appear to work. I click swing and nothing
> happens. I have to click it a second time to start the swing."*

**The tap worked.** `PUTTER_DEAD_MS` holds the putter's needle at zero for 250 ms after tap 1, and
for those 250 ms the meter is byte-identical to its idle state - so the one club with a dead zone is
the one club that gives no sign it heard you. A second tap inside the window is then correctly
ignored (that guard exists because locking power at 0.0000 threw the stroke away), and the needle
starts climbing at about the moment the second tap lands, which is exactly the experience described.

**The dead zone is load-bearing and was not touched.** It is the third attempt at the short-putt
problem and the only one Matt did not revert - the two before it moved the dial (`PUTT_GAMMA`) and
the tempo, and both came back within hours. What it needed was feedback, not removal:

- **The swing button names the next tap** - `swing` / `set power` / `set aim` (EN and ES), painted
  from the render loop because the phase also changes without a tap (the backswing tops out; the
  needle runs off the bar and fires), and written only when the text actually changes.
- **`data-armed="1"` on the button** while a swing is live, which the CSS keys a colour and an inner
  gold rule off.
- **A charge ring inside the meter's hub** that sweeps once over the dead zone and completes as the
  needle starts to move. It is drawn inside the band's inner radius, so it cannot be confused with
  the needle or the planted power marker, and the other thirteen clubs have `deadMs: 0` and never
  enter the branch.

### 4 and 6. The break was still decoration on the holes people actually play

> *"I don't think any of the slopes on the green are real. The ball seems to always go straight."*
> *"I just played through all of Pine Valley and got a birdie on every single hole. I've been trying
> to get you to make it not so easy. Why aren't you achieving this?"*

`BREAK_K` went 0.12 -> 0.45 on 2026-09-07 for this exact complaint, and **that pass fixed the hard
greens and left the easy ones.** The number that shows it is not the bend, it is the make rate:
struck perfectly, aimed DEAD STRAIGHT at the cup, 15-30 ft, on Pine Valley's own greens:

```
hole            1     2     3     4     6     7     8    12    16    17
BREAK_K 0.45   70 %  67 %  67 %  88 %  100 % 17 %  28 %  94 %   5 %   0 %
BREAK_K 0.90   31 %  28 %  30 %  47 %  100 %  2 %  16 %  44 %   0 %   0 %
```

On the opening four holes - the ones a player meets first, and the ones Matt played through -
aiming straight at the hole was the right play two times in three. `BREAK_K` is **0.90**.

**Hole 6 stays at 100 % at every value and that is correct**: it is the one deliberately FLAT green
on the property, and a course needs one hole that asks nothing of the read.

**What reading the break is now WORTH**, measured over 40 rounds with a player who reads it
perfectly against the same player aiming straight: **0.6 strokes at 0.45, 2.4 strokes at 0.90.**
Before this the slope grids were worth about half a stroke a round, which is the definition of
decoration.

**A short putt is untouched**, because break grows with the square of the distance: at 3 ft it is
under an inch either way, and every number in section 17 (the first-red-dot rule) holds.

### 5. The green was the SLOWEST surface in the game

> *"Balls don't run out or bounce much on the green. Is this intentional?"*

It was not. `LIES.green.roll` was **0.036** - below the fringe's 0.072 and below both roughs' 0.054
- so a ball pitching on the putting surface stopped faster than one pitching in the cabbage. And it
contradicted `PUTT_DRAG` one file over, which `shot.js` says is deliberately shared so that *"a
surface cannot be fast for a putt and slow for a run-out"*: there the green is the FASTEST thing on
the course (1.00 against the fairway's 1.90). The green was the only row the two tables disagreed
about.

**It is also most of the answer to item 6.** An approach that stops dead where it lands turns a
green into a target that cannot be run through, so reaching one was worth a birdie and no hole
design could change that. Measured over 40 rounds of Pine Valley, same seeds, only this number
moving (strokes against par 72; "good" strikes 88 % of shots inside the green band, "expert" 96 %):

```
green.roll        0.036    0.070    0.090    0.110    0.150
good player       -1.6     +0.1       -      +2.2     +3.9
expert player     -6.2     -3.8       -      -1.1     +0.6
birdie-or-better  53 %     43 %       -      33 %     26 %
```

**0.090, with the fringe nudged to 0.075 so the ordering holds** (green > fringe > rough). That is
62 % of the fairway's 0.145: a green is short-cut and runs, but it is also softer than a summer
fairway and takes more out of the bounce, so it is not simply the faster of the two. A 7 iron now
releases about 9 yds on a green 20-30 yds deep, which means an approach has to be landed SHORT of
the pin - and `aimDots` shows CARRY, so that is a thing to learn rather than a thing the game does
for you.

`golf/js/test.js` section 19 pins the **ordering** rather than the value, so this can be retuned
without the inversion coming back.

### What the two changes did together

Pine Valley, 40 rounds a hole, same seeds, the same three player models. `read` is whether the
player plays the break rather than aiming at the cup:

```
                    before (0.036 / 0.45)      after (0.090 / 0.90)
casual  (70/23/7)        +6.3                       +13.3
good    (88/10)          -1.6                       +5.9   (+5.2 reading the break)
expert  (96/3.5)         -6.2                       +3.4   (+1.0 reading the break)
birdie-or-better, expert  53 %                        35 %
```

**The cost is stated rather than buried: a casual player is 7 strokes worse off.** Golf is still
`live: false` in `adminConfig`, so nobody but a dev profile sees it, and the two levers are the two
numbers above - `LIES.green.roll` in `clubs.js` and `BREAK_K` in `shot.js`. Nothing else moved to
get this, and in particular the dial, the tempo, `PUTT_GAMMA`, `CUP_CAPTURE_YD` and `CUP_PAST_FT`
were all left exactly where Matt set them.

### 7. The power cap did not say what it was for

> *"The % power bar isn't clear. It must say why. Rough, deep rough, bunker, etc."*

The lie tile has been a PICTURE since the reference measuring pass, and the word survived only on
its `aria-label` - so `Power: 82%` sat under a drawing with nothing in words saying what the 82 %
was FOR. The lie's name is now printed between them.

**On its own line, not appended to the percentage.** That pairing was tried and reverted once
already (*"on one line 'Heavy rough Power: 82%' grew wide enough to run into the flag and the quit
button"*, visible in Matt's own playtest footage), and the longest string here is the Spanish
`Rough alto`, which is longer still. The picture is unchanged and section 12d still asserts it.

### Found, measured, and NOT changed: Red Mesa 1 is a bowl with the pin at the bottom

A putt aimed dead straight from 15-30 ft holes **100 % of the time on that green at every value of
`BREAK_K` tried, up to 1.20** - the only green on either course that does not respond to the
constant at all. It is not flat (its cells average 0.23, the same as Pine Valley 1): it is the
`bowl` preset with the pin sitting at the bowl's low point, so the slope funnels every putt INTO
the hole and more break simply funnels harder.

The fix is to move that pin off the low point, the way Oasis Sands 3's pin was moved off its green's
edge - par untouched, so the stored `bestHole` keys still mean what they meant. It is a course-data
change on a hole nobody asked about, so it is recorded here rather than made. Pine Valley 12 is the
other `bowl` and does NOT have the problem (94 % -> 44 %), because its pin is off centre.

### What the 2026-09-08 pass left open, measured rather than remembered

Run after the change, 24 rounds a hole (`GF_PERHOLE=1 node golf/js/test.js`):

```
pinevalley per hole  1:-0.21 2:-0.42 3:+0.08 4:+0.29 5:+0.25 6:+0.17 7:+0.58 8:+0.63 9:+0.21
                    10:+1.25 11:+0.88 12:+0.25 13:+2.38 14:+2.38 15:+0.50 16:+0.79 17:+2.92 18:+0.58
redmesa    per hole  1:-0.17 2:+0.08 3:-0.04 4:+0.08 5:+1.04 6:+0.29 7:+0.00 8:+1.04 9:+1.25
                    10:+1.04 11:+0.42 12:+1.04 13:+0.67 14:+0.33 15:+1.29 16:+0.29 17:+0.96 18:+2.13
blocks     pinevalley  -0.5 +0.7 +1.4 +2.4 +5.3 +4.3
           redmesa     -0.1 +1.4 +2.3 +2.5 +2.3 +3.4
           oasissands  +1.0 +0.4 +1.8
```

**GREENS WHERE AIMING STRAIGHT AT THE CUP STILL HOLES HALF THE TIME OR MORE**, swept 15-30 ft at
BREAK_K 0.90 - this is the list to work from if the read should matter on more of them:

```
pinevalley   6: 100 %      (the one deliberately FLAT green - correct, leave it)
redmesa      1: 100 %   2: 67 %   3: 63 %
oasissands   5:  58 %
```

Every other green on all forty-five now needs a read. **Red Mesa 1 is the outlier and it is not a
bug**: its own spec says *"The green is the kindest out here: everything on it feeds toward the
middle"* - it is the `bowl` preset with the pin at the bowl's low point, so the slope funnels every
putt INTO the hole, and raising `BREAK_K` funnels it harder. Kind was the intent; holing from 30 ft
is past kind. Moving that pin off the low point is the fix (par untouched, so stored `bestHole`
keys keep their meaning - the same move Oasis Sands 3's pin got). 2 and 3 are `gentle` greens on
holes 2 and 3 of a course and are probably right as they are.

**Pine Valley 13 still hits the 14-shot ceiling on 1 of 24 runs**, down from the belts work but not
zero. Same cause as ever: a ball deep inside a 26-yard belt with the probe only searching +/-45
degrees. Pre-existing, not made worse by this pass.

## The setup screen shows every hole now, and the tiles line up (2026-09-08)

Matt, with a screenshot of the round picker: *"Remove the yardage from these tiles so all the words
and stuff are actually aligned. And get a photo of every hole, like the one that you have there, and
line them up left to right so you can see every hole."*

### The tiles were two different heights, and removing the yardage was only half of it

`round_meta` was `par {par} | {yds} yds`, which wrapped to two lines in a three-column grid, so the
top row of tiles was 64px tall and the bottom row 82. It is `par {par}` now.

**That alone did not fix it**, and this is the part worth recording rather than the string change.
MEASURED in the real DOM at 393px: with the yardage gone, `Holes 10-12` needs **100.3px** of a tile
that offers **101.7** - it fits by 1.4px, which the button's own border then takes back, so the
bottom row still wrapped and still stood 18px taller. A label that fits by a rounding error is not
fixed, it is about to break.

So the visible label is the **RANGE ALONE** (`10-12`), which needs 48px and leaves 53px of slack;
the heading directly above it already says "Which holes?", and the full phrase survives on the
button's `aria-label` so a screen reader still hears "Holes 10 to 12". `white-space: nowrap` on the
tile's own lines is the second half - it is what stops a future string quietly re-introducing the
ragged rows instead of overflowing where somebody would see it. Re-measured after: **all six tiles
64px.**

### Every hole, not just hole 1

The card's picture was ONE canvas showing hole 1, on a screen whose entire job is choosing which
three holes to play - so it said nothing about the other seventeen. It is a horizontal strip of
eighteen now, each thumbnail captioned `4 - par 4`, built by the same `buildMap` the game plays on
so the strip can never show a course the game does not have.

**Eighteen `buildMap` calls is not something a menu can pay for**, and two things make it
affordable:

- **The big map is dropped the instant it is downscaled.** `buildMap` rasterises at `MAP_PPY`
  (2.4 px/yd), so one hole is roughly 264 x 1128 px and eighteen held live would be about 21 MB of
  canvas. Only the ~10k-pixel thumbnail survives, and that is what goes in `_stripCache`.
- **A hole is only built when it scrolls into view**, via an `IntersectionObserver` with a 120px
  `rootMargin`. The cache is keyed by course AND hole AND size, so scrolling back, switching course
  and returning, or re-rendering the screen are all free.

**Measured** (`node measure-hole-strip.mjs`, real Chromium at 393x852): **7 thumbnails painted on
open, 18 after scrolling to the end (1.8 s of scrolling), 7 again after switching to Red Mesa**, no
page errors.

**AND IT NEVER LEAVES AN EMPTY BOX.** That is Part 0's own rule - name what replaces a placeholder
and when - and an unpainted canvas is precisely the "empty machine box" Skeeball shipped. The
observer is the path back to the truth where there is one; **where `IntersectionObserver` does not
exist at all, every hole is painted up front instead**, because a picture that costs a moment beats
a row of blank rectangles that never fill.

The strip carries `overscroll-behavior: contain` (root `CLAUDE.md`'s scroll rules - without it a
flick that reaches either end pans the launcher underneath), and `_dropStripObs()` is called on
every exit from the setup screen, because the observer holds a reference to all eighteen canvases
and leaving for a hole would otherwise park them alive until the next setup render.

### The course blurbs are one line, and that is a measured budget (2026-09-08)

Matt: *"make the course description only 1 line... shorten it. then do the same for the other two
courses."* All three wrapped to two lines on every phone.

**MEASURED in the real DOM** rather than counted in characters, which is what a proportional font
makes meaningless: the blurb line has **357px at a 393px viewport, 324px at 360px and 284px at
320px.** So 284px is the budget. The old strings ran 409-469px; the new ones run 238-273px and were
confirmed at ONE line at all three widths, in both languages.

| | was | now |
|---|---|---|
| Pine Valley | Parkland. Tree lined corridors and water on nine of the eighteen. | **Parkland. Tree lined, water on nine holes.** |
| Red Mesa | High desert. Narrow turf, saguaro, boulders and a lot of red dirt. | **High desert. Narrow turf, cactus and rock.** |
| Oasis Sands | Desert links. Wide waste sand, palm lines and water on six of the nine. | **Desert links. Waste sand, palms, water.** |

**It is deliberately NOT `white-space: nowrap`.** A translation that outgrew the line should wrap
where somebody can see it rather than clip; keeping the strings short is the fix, and the budget is
written above `blurb_pinevalley` in `js/strings.js` so the next one starts from it.

### `sheet-course.mjs`: every hole of a course as one image

Matt asked for all eighteen Pine Valley holes as a single collage so he could mark up the layout he
wants for the setup strip. It is a repo tool rather than a scratch script because a course is a SET
and this file has already recorded twice that set-level defects are invisible one hole at a time.
`node sheet-course.mjs [course]`, needs the dev server up.

**It also settled a question, and the answer is worth recording: NOTHING IN THE STRIP IS CROPPED.**
Every tile letterboxes the whole hole (`Math.min(cv.width / map.w, cv.height / map.h)`, the same
rule the sheet uses). Measured, the eighteen Pine Valley holes run **0.22 to 0.52** wide-to-tall
against a tile of **0.436**, so fifteen are letterboxed left and right and three (6, 13, 16) top and
bottom. What reads as "the beginning of the hole is cut off" is that a hole's map includes the 60
yds behind its tee (`BEHIND_TEE_YD`, which the camera needs), so there is a band of empty rough
below the tee box in every picture.

**And that is what the strip became.** Matt, off the sheet: *"your image actually looks better than
what I'm trying to make. But you waste a TON of space with the black. Fix that. and we don't need
labels. I don't want any text here at all."* See the section below.

## The hole strip became a grid: no black, no text, no scrolling (2026-09-08)

Matt, looking at `sheet-course.mjs`'s contact sheet beside the app: *"your image actually looks
better than what I'm trying to make. But you waste a TON of space with the black. Fix that. and we
don't need labels. I don't want any text here at all."* Plus, from the message before it, *"I
thought i'd be able to see all the holes without scrolling."*

### The black was letterboxing, and no single tile size could ever have removed it

The eighteen Pine Valley holes run **0.22 to 0.52** wide-to-tall. Any fixed tile aspect leaves bars
on roughly two thirds of them, whichever aspect is chosen - so this was never a matter of picking a
better number.

**The tile is not a box the hole is fitted into any more. It IS the hole's shape.** Every canvas is
drawn at its row's height and given its own width, from `holeAspect(h)` - straight off `bounds`,
which is exactly what `buildMap` rasterises, so the number and the picture cannot disagree. Nothing
is letterboxed and nothing is cropped.

### The rows are NINES, and their height is measured rather than picked

Left to `flex-wrap` the strip came out **9 / 8 / 1** on Pine Valley, with hole 18 stranded on a row
of its own - which reads as a mistake rather than as a layout. `holeRows()` chunks by nine instead,
which is also the right unit for golf: an eighteen shows its front nine over its back nine, and a
nine-hole course is one row.

`_sizeStripRows()` then gives each row the one height at which it exactly fills the width:
`(row width - the gaps) / the sum of that row's aspects`. Picking a height instead would leave a
ragged margin down the right of every row - the very waste this layout exists to remove - and it
would differ per course, because Red Mesa's holes are not Pine Valley's. Measured on Pine Valley at
393px: the front nine's aspects sum to 3.099 and the back nine's to 3.293, so the rows come out
**102px and 96px** and both end flush (measured overflow 0.0 and 0.0).

**`box-sizing: border-box` on the tile is load-bearing, not tidiness.** On content-box each tile's
1px border adds 2px the arithmetic never subtracted - 18px across a row of nine - which pushed the
last hole of each nine off the right edge of the screen. That was measured, not theorised.

### Measured after

| | |
|---|---|
| strip height | **207.6px** for all eighteen (was 302px for a scrolling row of one nine) |
| rows | 2, overflow **0.0px** and **0.0px** |
| the setup screen scrolls | **no** - `scrollHeight === clientHeight`, at 393x852 |
| blank tiles | **none**, on either eighteen-hole course |
| `test-visual.mjs golf` | 14/14, fits standalone AND in the hub at 852 and 664 |

**The captions are gone and there is no visible text in the strip at all.** Each canvas keeps an
`aria-label` (`4 - par 4`), which is not text on screen and is the only thing a screen reader would
otherwise have.

`_sizeStripRows()` is re-run from `_fit()`, because a rotation changes the row width and every row
would otherwise keep the height it was given in the old orientation. The thumbnails are then
repainted at the new size; `_stripCache` is keyed by size, so rotating back is free.

### One piece of empty space is DELIBERATELY still there

Every hole's map includes the **60 yds behind its tee** (`BEHIND_TEE_YD`, which the camera needs -
a hole whose bounds stopped at its own tee pinned the ball under the controls). So there is a band
of plain rough below each tee box. Trimming it would make every picture bigger for the same height
budget, and it was NOT done: Matt's previous message on this screen was *"you've made the hole
images wider than they should be by cutting off the beginning part of the hole"*, and cropping the
approach to the tee is exactly what that objects to. It is his call, not a tidy-up to slip in.

## The unlock ladder, and the tutorial hole (2026-09-08)

Matt: *"we're going to release Pine Valley as the only course to start with. And 9 holes and 18
holes need to be locked. They have to play a practice hole /tutorial, then holes 1-3 unlock. Then
when they've shot par or better, the next set of 3 will unlock, and so on. Once they've unlocked all
the 3 hole things, they can then play 9 hole rounds. Again, they play the front until they shoot par
or better, then the back unlocks, then when they shoot par or better, 18 holes unlocks."*

```
             the tutorial hole            ->  holes 1-3
   par or better on 1-3 / 4-6 / ... 13-15 ->  the next three
       all six three-hole sets UNLOCKED   ->  the front nine
        par or better on the front nine   ->  the back nine
        par or better on the back nine    ->  all eighteen
```

### NOTHING NEW IS STORED FOR ANY OF IT, and that is the whole design

A progression is earned data, so under THE LAW it can never be lost, never be rebuilt wrong, and
never disagree between a player's two phones. The obvious implementation - an `unlocked: [...]`
array written as the player goes - fails all three: it is a second source of truth that has to be
migrated and merged, and **a device syncing a stale copy would TAKE UNLOCKS AWAY**, which is rule 1.

So `golf/js/progress.js` DERIVES the ladder, every time, from records that already existed:

- a 3-hole set, a nine and an eighteen from **`gf.bestRoundByCourse`** - strokes per round key,
  already synced to `players/<id>`, already merged across devices with a per-key `Math.min`;
- the tutorial from **`gf.bestHole['tutorial:1']`**, an ordinary per-hole record written through the
  ordinary `holeOnly` path.

Three consequences worth stating, because they are the reason:

- A player who shot par on holes 1-3 on their old phone has set 2 open on a **brand-new phone** the
  moment stats sync, with no migration and no extra write.
- **An unlock cannot be lost by a merge**: `Math.min` on a stroke count only ever makes the
  requirement more satisfied.
- There is no new key to freeze or repurpose (rules 4 and 5), and `progress.js` could be deleted
  tomorrow without one stored byte becoming unreadable.

**`tutorial:1` IS frozen the moment anybody finishes the lesson.** Renaming the tutorial course id
or renumbering its hole would orphan that record and silently re-lock the game for every player who
has already done it. It has a row in `js/game-stats-ui.js`'s `GOLF_COURSES` and a length of 1 in
`GOLF_COURSE_HOLES`, so My Stats shows it honestly instead of printing "TUTORIAL" with seventeen
dashes (rule 1).

### Two readings of Matt's words, and which one shipped

*"Once they've UNLOCKED all the 3 hole things"* is implemented literally: the nines open when set 6
is unlocked, which is itself the reward for shooting par on set 5 - so the player has proved
something on five of the six, and set 6 need not be played. If he meant "beaten", `roundState`'s
`mode === 9` branch names the one line to change.

### Only Pine Valley, and the admin switch that was waiting for a caller

`COURSE_OPEN_BY_DEFAULT` in `progress.js` is `{ pinevalley: true }`. `js/admin-config.js`'s
per-course resolvers sit ON TOP of it, so releasing Red Mesa is a tap rather than a deploy - and
those resolvers have existed with **no caller at all** since 2026-09-03, waiting for exactly this.

**Use `courseTestingOverride`, NOT `isCourseTesting`, and the difference is a real bug this pass
hit.** `resolveCourseTesting` returns TRUE when nothing has been written ("Missing key -> testing"),
which was right when golf was a placeholder with no code-side default. It is wrong now: measured in
a browser, it hid ALL THREE courses and the picker rendered **zero chips**. The override reader
returns null when nothing is set, so an absent config changes nothing - which is the property every
switch in this repo is supposed to have.

### The tutorial hole

`golf/courses/tutorial.js`. An ORDINARY hole object that passes `validateHole()`, because a lesson
taught on a special-cased fake hole teaches the wrong game. A par 3 of **123 yards** (a stock 8
iron), **no trees, no water, no bunkers**, a big green with a tenth of a real green's break, and
`wind: { speed: 0 }` so the lesson never has to teach a correction before it has taught a swing. One
full shot and one putt is the whole game, and a par 3 is the only length that guarantees it.

It is a course-shaped object DELIBERATELY NOT IN `COURSES`: shaped like one so `ui.js` needs no
special case (`holeKey`, `paletteFor`, `buildMap` all read `this.course`), out of the array because
it has no rounds, no bests, no leaderboard row and no business in the picker.

### The lesson: `golf/js/tutorial.js`

Nine steps, `STEPS` is plain data with no DOM in it, and the `Coach` **never drives the game** - it
watches. `ui.js` calls `coach.event(kind)` at points it already had (a tap, a shot fired, a ball
settled, a hole holed) and the coach decides whether that was what the current step wanted. It
cannot swing, aim, change club or block a control.

**NO SCRIM, deliberately.** The obvious spotlight - a dark overlay with a hole cut over the control
- is wrong here: three of the nine steps are about the swing METER, which has to be read WHILE the
needle moves, and a scrim also hides the ball and the aim line. The highlight is a ring plus an
arrow and the course stays fully visible. The ring pulses by GLOW, never scale (the UX floor: it
sits on the swing button, the one control tapped three times in two seconds).

**THE LESSON CAN NEVER BE STRANDED**, and both ways it could were found by driving it in a browser
rather than by reading it:

1. **The swing can fire itself** - if the needle runs off the bar with no third tap, `_frame` fires
   the shot. The "tap a third time" step would have waited for ever on a tap the player had already
   failed to make. `_frame` now reports it.
2. **A hole in one skips `settled` entirely** - `_settleShot` returns early when the ball drops, on
   the one hole in the game short enough to ace.

So an event matches the first step FROM HERE ON that wants it, not just the current one. The lesson
only ever moves forward, and it can always be skipped (skipping ends the CARDS, not the hole - the
unlock reads the hole record, which only holing writes).

### Measured, driving the whole thing in a real browser

| | |
|---|---|
| a fresh profile | 0 of 9 rounds open, all three lengths locked, no practice button, no hole practisable |
| every locked tile | names what it is waiting for ("Par or better on 10-12") |
| the six round tiles | **all one height at 393, 360 and 320px**, locked or not |
| the lesson | steps 1-9 advanced in order; card, ring and arrow all inside the screen at every step |
| holing out | wrote `gf.bestHole = { "tutorial:1": 2 }` |
| the setup screen after | `quick3` OPEN, sets 2-6 locked, "1 of 9 unlocked", practice button appears |
| page errors | none |

`test-visual.mjs`'s golf PLAY probe **seeds the tutorial record** rather than playing the lesson: its
subject is the three-tap swing, and without the seed it would fail on a gate it is not testing. The
ladder has its own coverage in `golf/js/test.js` section 20.

## The setup screen scrolled, and the fit check could not see it (2026-09-08)

Matt, with a screen recording of the hub on his phone: *"Look at the scroll. I do not want a scroll
on these setup/golf landing pages."*

### The check was green and the screen scrolled, and both were true

`test-visual.mjs`'s `fit` check measures **the PAGE** - `documentElement.scrollHeight` against
`window.innerHeight`. `.gf-setup` is `position: absolute; inset: 0` with its own `overflow-y: auto`,
so it scrolls INSIDE ITSELF and the page never overflows at all. Every immersive game in this repo
is built that way, so the page measure could have missed the same bug in any of them.

The check now also walks the game's own root for any element with `overflow-y: auto|scroll` whose
`scrollHeight` exceeds its `clientHeight`. **Verified born red**: with the old 14px gap restored it
fails with *"the page fits but `gf-setup` scrolls INSIDE itself by 3px"*.

### What it actually cost, measured

At **390x664**, the shortest height this repo tests, with everything else on the screen summed:

```
H1 30 + lengths 52 + courses 82 + card 55 + rounds 159 + foot 117 + 84 gap + 36 padding = 615 of 664
```

That left **45px** for a strip of eighteen holes, and the strip wanted 206. Overflow: **82px** on the
three-hole mode, 44-46px on the nines and the eighteen. Zero at 393x852, which is why it had not
been caught by eye.

### The fix: the strip takes what is LEFT, and three cheap cuts pay for the rest

`_sizeStripRows` computed the height at which a row of nine exactly fills the WIDTH. That is still
the ideal and it is what a tall phone gets - but it is now a **ceiling**. Everything else on the
screen is measured, the strip is given the remainder, and when that is less than the rows want they
are scaled down together and end a little short of the full width (centred, so the slack is split).
A small side margin is a far smaller cost than a screen that scrolls.

**IT SUMS THE SIBLINGS RATHER THAN READING `scrollHeight` WITH THE STRIP COLLAPSED.** That was the
first attempt and it silently did nothing: `.gf-setup` is `inset: 0`, so its `scrollHeight` can never
fall below its own `clientHeight` - collapsing the rows still measured 664 of 664, `avail` came out
**-4**, and the strip kept its full size while the screen kept its 82px. Measured, not reasoned
about. The children's heights plus the flex gaps and the padding is the same number with no floor
under it, and it needs no reflow.

Three cuts pay for the remaining 65px, and they are the cheapest on the screen:

| | saves |
|---|---|
| the flex gap 14px -> 10px, six times | 24px |
| the padding 18px -> 14px, top and bottom | 8px |
| **the two foot buttons side by side instead of stacked** | ~50px |

Nothing loses information and nothing goes under the UX floor. With only one foot button (before the
tutorial is done, when practice is hidden) the row is a single full-width button anyway.

A **4px safety margin** on the available height is what takes the last 1-2px: each tile carries a 1px
border under `box-sizing: border-box` and the row heights are fractional, so what is drawn rounds up
against what was computed.

### Measured after: ZERO overflow everywhere

Every course x every length x both heights, standalone; and both hosts at both heights through
`test-visual.mjs`:

```
393x852   pinevalley / redmesa / oasissands, 3h 9h 18h   0px   (strip 208px)
390x664   pinevalley / redmesa / oasissands, 3h          0px   (strip 113px)
390x664   ... 9h                                          0px   (strip 183px)
390x664   ... 18h                                         0px   (strip 187px)
hole select (18 buttons), 393x852 and 390x664             0px
```

### `overflow: hidden`, and the argument that was wrong

This shipped for one build as `overflow-y: auto`, with the reasoning that a screen which CAN scroll
is safer than one that clips. Matt: *"I've told you several times before that I don't want any game
in the gamehub to be scrollable at all. Everything MUST fit on a single screen. Always."*

He is right, and it is his own long-standing rule - `docs/BUILDING-A-GAME.md` Part 0 has said "A
game screen that scrolls at all is a bug" since it was written. **`auto` does not make a screen
safe. It makes a screen that does not fit LOOK finished**, which is exactly how this one shipped
scrolling through a green suite. The safety net is the TEST, not the scrollbar: `check-no-scroll.mjs`
and `test-visual.mjs` both assert zero overflow, so `hidden` can never be quietly clipping.

## The tutorial is a par 4, and it stops talking during the swing (2026-09-09)

Matt played the first version: *"the tutorial is terrible. it should be a par 4. it is WAY too
wordy (per usual). You say hit 'swing' then it starts moving immediately, but more words appear.
you don't have time to read what to do next before the time has passed."*

Three complaints, and the third is a design error rather than a slow reader.

### NO CARD IS ON SCREEN WHILE THE NEEDLE IS MOVING

The first version had THREE cards across one swing - `swing1` ended on `tap-begin`, `swing2` on
`tap-power`, `swing3` on `fire` - so **each tap revealed the instruction for the next one.** The
backswing is 1585 ms per power unit and the downswing quicker, so the player had about a second to
find, read and act on a sentence that had not existed a moment earlier. **Shortening the sentence
does not fix that**: the words arrive after the moment they describe.

So the three taps are taught ONCE, before the first of them, and then the lesson goes quiet. During
a swing the swing button already names the next tap (`swing` / `set power` / `set aim`, painted from
the render loop) and the charge ring already shows the putter's dead zone - those are the whole
interface, and a card would only cover the meter it is talking about.

**The mechanism is a step with no card.** A step whose `key` is null renders nothing and just waits
for its event. That is what lets the lesson span three shots of a par 4 without ever putting words
over a swing: card, silence until the ball is on the green, card, silence until it drops, card.

`golf/js/test.js` section 20 carries it as a `[KNOWN-BUG PROBE]` - no card may wait on `tap-power`
or `fire` (a card that ends on one of those is a card that APPEARED mid-swing), and the step
following any card that ends on `tap-begin` must be silent. Nothing at runtime would notice either.

### `on-green`, not `settled`

A par 4's approach may take one shot or three. A putting card fired on `settled` would tell a player
standing in the fairway to putt, so `ui.js` reports a new event when the ball comes to rest ON the
putting surface and the lesson waits for that instead.

### Five cards, 25 words, no step counter, NO SKIP BUTTON

Matt, twice: *"it is WAY too wordy (per usual)"*, then *"still way too much text. I'm not reviewing
all of it."* Nine steps became five cards; the three swing cards ran 47 words between them and are
now five. **A card is read in the half second before a tap, so anything past a short sentence is not
read at all** - it is skipped, which is worse than not writing it. `golf/js/test.js` fails the build
if any card in either language grows past ten words.

The "Step 1 of 5" line is gone too - a line of text on every card to say a thing the player was not
asking.

**And there is no skip button** (Matt: *"get rid of the 'skip tutorial' button. that is NOT an
option - per what I've told you already"*). It offered an exit that led nowhere: the lesson is the
gate on holes 1-3, `progress.js` opens them off `bestHole['tutorial:1']`, and only holing out writes
that - so skipping stopped the cards and left the game locked. Five cards of under ten words is not
a thing that needs an escape hatch. A `[KNOWN-BUG PROBE]` fails if the button comes back.

The `club` card is gone as well - a par 4 teaches the club ladder by making you use it, which a par
3 never could, and that is most of the argument for the par change.

### THE PAR WAS SAFE TO CHANGE, AND IT WAS CHECKED (THE LAW rule 4)

A stored `tutorial:1` of 3 means a PAR on a par 3 and a BIRDIE on a par 4 - the same number silently
changing meaning, which is exactly what blocked the Pine Valley hole-3 swap. Fresh RTDB read,
2026-09-09: **255 player device records, 52 carrying a golf key, ZERO carrying any `tutorial:*`
record.** Nobody had finished the lesson, so there was no meaning to break. **Re-run that check
before touching this par again** - the moment one person completes it, `tutorial:1` is frozen.

The hole itself: 372 yards, straight, fairway wall to wall with a ring of light rough, no trees, no
water, no sand, dead calm, a big nearly flat green. The approved ladder carries a driver 215 and a
6 iron 139, so two clean strikes finish about 18 yards short of the pin - a putt, never a tap-in,
and never a lay-up to explain.

## The setup screen looks like golf, and the circle is gone (2026-09-09)

Matt, in one message: *"i hate the circle thing that appears when I go to putt. remove that thing."*
· *"On the landing/setup page, there's a lot of wasted space instead of increasing the size of the
holes. I don't like the color scheme at all either. it doesn't look golf like at all."* · *"Delete
'which holes?' There is no need for superfluous garbage clutter like this."* · *"Use ALL space
available."*

**THE CHARGE RING IS GONE.** It shipped that same day, a gold arc sweeping the meter's hub while
`PUTTER_DEAD_MS` held the needle at zero. The report it was written for - the putter's first tap
looking like it did nothing - is still closed by the OTHER half of that fix: the swing button's
label moves to "set power" on the frame the tap lands. That is a word where the player is already
looking; the ring was a new graphic on a dial they are trying to read. `test.js` section 19 carries
a `[KNOWN-BUG PROBE]` that it stays gone.

**THE HOLE PICTURES ARE NEARLY DOUBLE THE SIZE, and every pixel came from clutter.** The strip is
given whatever height the rest of the screen does not need (`_sizeStripRows`), so the way to make
the pictures bigger is to delete things, not to resize them. Measured at 390x664, strip height:

| | |
|---|---|
| before | **120px** |
| the `<h1>` course name, which the selected course chip already says | 150 |
| the "Which holes?" line | 172 |
| "Not open yet" -> "locked", so a course chip is one line instead of three | 196 |
| "Play the tutorial again" -> "tutorial", one line instead of two | **206px** |

**THE COLOURS: a cream scorecard on cut grass.** The screen was traffic-cone orange tiles on khaki.
The orange is the reference's own accent and it STAYS on the play screen, where it was measured
(`golf-reference-spec.md` 15.1) - but the setup screen was never in the footage and had inherited
the accent by default rather than by decision. Tiles are ivory with deep-green ink, the selected one
is the flag's gold (`#ffce3a`, the repo's standing selection accent, still paired with a border and
a weight change because colour alone may never carry a state), and a locked tile is dimmed grass so
it reads as "not yours yet" without being a fourth colour.

**THE GROUND COLOUR IS NOT IN `golf.css`.** `ui.js` writes it inline from the course palette
(`THEMES[...].setupA/setupB` in `render.js`), so a rule in the stylesheet is silently overridden -
which cost a round of measuring here. Change the palette. A comment in `golf.css` says so at the
point somebody would otherwise try.

## The lesson makes you USE the controls, and points at the dial (2026-09-09)

Matt: *"tutorial is still bad. Use arrows. point to where they should aim to hit on the power meter.
make them click buttons to aim. make them click buttons to change clubs."*

The cards described the controls; now the lesson waits for them to be worked. `_nudgeAim` and
`_stepClub` report `aim` and `club`, and the aim and club steps advance on nothing else - the ring
and the arrow stay on the control until it has actually been pressed. Reading "these arrows aim"
teaches nobody anything; pressing one does.

**TWO GOLD CARETS ON THE METER, and they are on screen BEFORE the first tap.** One outside the band
at 100 % power, pointing in at the green stripe; one at the accuracy bar's dead centre. That timing
is the whole constraint on this screen: the backswing is 1585 ms per power unit, so a mark REVEALED
while the needle is moving cannot be found and acted on, which is exactly how the three swing cards
failed. A mark that was already there is read at a glance - which is what an arrow is for and a
sentence is not. They are drawn only while a coach is live, so no other player ever sees them.

**A canvas triangle whose apex is at local `(0,-9)` points along `rotation - 90 deg`.** The first
render used `+`, so the band caret pointed away from the dial and landed on the "100" tick label.
Worth knowing before nudging that number.

### The forward search was a way past the gate

`event()` matches the first step FROM HERE ON that wants the kind, so the lesson can never strand on
an event it missed (the swing fires itself if the needle runs off the bar; a hole in one never sends
`settled`). Applied to a GATED step that search is a hole: measured in a browser, tapping the CLUB
arrow while the aim card was up matched the club step two ahead and **skipped the aim step
entirely** - the gate Matt had just asked for let you past without using it.

`SKIPPABLE` now names the events the lesson can legitimately miss (`fire`, `settled`, `on-green`,
`holed`) and only those skip forward. Anything the player TAPS ends the step that asked for it, or
nothing. A `[KNOWN-BUG PROBE]` fails if a control event joins that set.

## The lesson is a rail, not a stack of popups (2026-09-09)

Matt: *"i hate the pop ups. Create mockups of alternatives."* Six were drawn and he picked **E2** -
a thin rail welded to the bottom edge of the screen with a row of progress pips, and the game's own
controls riding up above it. Then, on the per-step mockups: *"i like the bottom rail with pips, but
it covers the buttons."*

### The rail is CSS-welded to the bottom. It is NOT positioned by JS.

The first build measured the tallest control cluster and placed the rail above it. `.gf-br` carries
the 150px meter, so the measurement put the rail at **y=390 - the middle of the screen**, directly
over the popup's own "got it" button. A lesson whose own button is unreachable is not a lesson.

So `.gf-tut__rail` is `bottom: 0` with `height: calc(30px + env(safe-area-inset-bottom))`, and
`.gf-root[data-tut="1"] .gf-bl, .gf-root[data-tut="1"] .gf-br` ride **30px up** while the lesson is
live. Both numbers are in one CSS block. `data-tut` is set when the coach is constructed and removed
when it finishes, so nothing about the layout survives the lesson.

`golf/js/test.js` section 20 asserts the ride-up rule structurally, because nothing at runtime would
notice a rail that has drifted back over a control.

### Three of the eleven steps are POPUPS, and each one paints the REAL meter

A card that says *"stop the needle near 100 %"* is describing a picture. The two swing lessons (**a
good swing** / **a bad swing**) and the putting lesson are popups precisely because they can SHOW
it: `_paintTutorialDial` calls the game's own `_drawMeter` with `still: true` and a list of `marks`,
so the dial in the card is the dial on the screen, drawn by the same code, and cannot drift from it.

- **a good swing** marks 100 % power and the bar's centre.
- **a bad swing** marks the top of the arc, 100 % in a second colour, and the END of the bar, beside
  a small chart of what each one costs. Matt: *"Add another different color arrow to #4 that is a
  100% power no tap and how offline that is vs the yellow with the max power."*
- **the putting dial** paints BOTH dials side by side (FULL SHOT / PUTTING), because `PUTT_GAMMA` is
  1.6 and the only honest way to say the ticks sit further round is to put the two dials together.

**A popup step renders PIPS ONLY in the rail** (`_railHTML(s, true)`). The first build printed the
popup's own text in the rail underneath it, which read as the app saying the same thing twice.

### The cards are five and three, and every one is under ten words

Matt, twice: *"still way too much text. I'm not reviewing all of it."* The suite fails the build if
a rail card passes ten words in either language, or a popup sixteen. There is **no skip button** and
a `[KNOWN-BUG PROBE]` fails if one comes back: skipping stopped the cards and left holes 1-3 locked,
because the unlock reads `bestHole['tutorial:1']` and only holing out writes it.

### The result card is the last lesson, not the end of it

The lesson's closing card is about the pause menu, and it has to come AFTER the round is scored - so
the result card's close **hands off** (`_coach('result-closed')`) instead of quitting, and the coach's
`onFinish` is what leaves the hole. On a tutorial run the card is titled "Tutorial complete" and
names the unlock once; the generic `unlockedNow` line is suppressed, or it printed twice.

`test.js` pins both branches of that close - the tutorial hand-off AND the ordinary `_quit`, which is
what asks before a round is thrown away. The old single-arrow regex was pinned to a shape, not to the
rule, and went red the day the shape moved.

## The pause menu, and quit moved into it (2026-09-09)

Matt, in the same message that approved the tutorial rework: *"I want to add a feature where
[players] can pause then report a bug from the pause menu. I want that to be at the end of the
tutorial but be part of. Something like this is a brand new game please report any bugs you
encounter in the pause menu."* The lesson's closing card was built first and says exactly that, so
the menu it names had to exist.

**PAUSED** · **resume** · **report a bug** · **quit**, three full-width 46px rows.

### It REPLACED the top-left quit button rather than joining it

That corner already holds a button and the flag, and this is an immersive game measured to fit one
screen at 390x664 - the setup screen shipped scrolling by 82px through a green suite, and a third
control in that row is exactly the kind of thing that fits by a rounding error. **Quit is a row in
the menu now**, which also puts one deliberate tap in front of the door that throws a round away.
`_quit()` still asks after it and that guard is untouched; `test.js` section 16a pins BOTH hops, so
the route cannot be quietly short-circuited back to a one-tap exit.

### A LIVE SWING IS CANCELLED, NOT PAUSED

`_frame` keeps running behind an overlay. A player who taps pause mid-backswing would have the
needle run off the bar, fire itself, and be charged a stroke for a shot nobody saw - which is the
one thing a pause menu must not do. `swing.settle()` puts the meter back to address with no stroke
and nothing lost. **A ball already in the AIR is left alone**: the shot is resolved either way, and
reaching into a running animation is the only version of this that could lose something. Measured
in a browser: `back` -> `idle`, `shotN` unchanged. A `[KNOWN-BUG PROBE]` pins the cancel.

### The report form is imported LAZILY, and preselected on golf

`js/bug-report-ui.js` pulls in the whole device-report and Firebase picture. An immersive game must
not carry that on its mount path for a button most rounds never press, so it is a dynamic import
inside the handler, with a loud `console.error` if it fails rather than a row that silently does
nothing. `openBugReport({ gameId: 'golf' })` takes the HUB id, so the form's own picker opens on
golf - measured: the `<select>` reads `golf` with the form on screen.

**This is the repo's first in-game entry point to Report a bug, and it is a deliberate exception to
the rule in `js/CLAUDE.md`** ("No in-game entry point, deliberately... a button there would fight
for space in exactly the games most likely to need one"). It costs no space because it is a row
inside a menu that had to exist anyway, and golf is the game currently most likely to need one.

### The menu and the tutorial's picture are one design

`.gf-pause__rows` and `PAUSE_ART` in `js/tutorial.js` share their shape, their heading and their
gold accent (`#ffce3a`, the repo's standing selection accent, paired with a border and a weight
change - never hue alone). The lesson shows a picture of this menu and then the player meets it; if
the two drift, the lesson is teaching a screen that does not exist.

### One duplicate key, found on the way

`golf/js/strings.js` had **two `resume` keys in the same object literal** - the setup screen's
`'resume round'` and the tutorial art's `'resume'` - and the later one silently won. Nothing was
calling the first one yet, so nothing was visibly broken, but `test-i18n-strings.mjs` cannot see a
duplicate key (the file is a JS object, not JSON) and the next person to wire "resume round" would
have got "resume". The pause menu's key is `pause_resume`.

## The tutorial playtest: two phantom strokes (2026-09-09)

Matt, after the pause menu shipped: *"test the game as thoroughly as possible."* Played with the
harness shape this file's own record insists on - **a person, not an oracle**: it takes the club
`autoSelectClub` offers and the aim the game hands it, stops the meter with a thumb carrying a
gaussian timing error (30 / 60 / 110 / 190 ms of standard deviation), and resolves the shot through
`_fire()`'s own call chain. About 1,300 holes headless, plus the whole lesson and the pause menu
driven in a real Chromium at 390x664.

### 1. A TAP COULD LOCK A POWER THE BALL DOES NOT MOVE ON, AND THE STROKE WAS CHARGED

`Swing.tap` refused a second tap only when the needle sat at EXACTLY zero. That closed the case it
was written for two days earlier (the putter's dead zone locking `power = 0.0000`) and left the
millisecond either side of it wide open. Measured through the real resolver:

```
putter, tap 2 at   251 ms  ->  power 0.00063   ball moves 0.000 ft
                   270 ms  ->  power 0.01262   ball moves 0.051 ft
                   300 ms  ->  power 0.03155   ball moves 0.227 ft
driver, tap 2 at     1 ms  ->  power 0.00063   ball moves 1.2 yds
```

The dead zone ends at 250 ms and a 2 ft putt holes for a tap 382-661 ms in, so **the window this
opened is the window a nervous thumb actually lands in.** It hit about 3 % of holes, almost all of
them on the two slower player models. It is the third appearance of "I swung and nothing happened",
and the first two were closed by rules that were too narrow.

**`MIN_TAP_POS` (0.027) is the needle's own drawn width, measured off the meter's geometry rather
than picked.** The needle's key is 5 CSS px (`needleAt(read.pos, 5, 2, ...)`), and the accuracy bar
is a trapezoid 33.4 px along its inner edge and 51.5 along its outer for the whole `2 * BAR_HALF`
window - so 5 px is 0.041 power units at the narrow end and 0.027 at the wide one. The floor is the
WIDE end: refuse only while the needle has CERTAINLY not moved by its own width anywhere on the
bar. `test.js` recomputes that from `ARC_A0_DEG` / `ARC_DEG_PER_UNIT` / `BAR_HALF` and fails if the
constant drifts from it, and separately fails if `ui.js` stops drawing the needle 5 px wide.

**REFUSING IS STRICTLY BETTER THAN FIRING.** The backswing carries on, so the next tap sets a
bigger power than the player meant - a bad shot, but a shot. The alternative is a stroke gone with
the ball where it was, which no amount of playing better avoids.

**One pinned assertion moved with the rule**, and it is named in the test: "a driver tap 40 ms in
still sets a real power" rested on "a club with `deadMs: 0` is only ever refused in the degenerate
same-millisecond case", which is exactly the reasoning that left the hole. A driver is now refused
for its first ~43 ms too. What the block still proves is the part that matters: a refused tap
leaves the backswing running.

### 2. THE PAUSE MENU LEFT THE SWING BUTTON DEAD FOR 1.4 SECONDS

`_pauseMenu` cancelled a live meter with `swing.settle()`, and settle carries `LOCK_MS` - the lock
after a ball has been STRUCK. Nothing is struck when a swing is cancelled, so the player resumed
and their first tap was swallowed. **Measured in a browser, and it is the clearest kind of
evidence**: with the menu opened mid-backswing and closed again, a tap on the swing button left the
phase reading `idle`; after the fix the same tap reads `back`. It is `reset()` now, guarded on
`!this.anim` so a ball already in the air keeps the phase and the lock `_settleShot` owns.

### What the sweep found nothing wrong with

Every failure class this file has a history of, over ~1,300 holes at four skill levels:

| | |
|---|---|
| strokes that moved the ball under 0.05 yd | **0** |
| balls resting outside `hole.bounds` | **0** |
| a ball returning to the same tenth of a yard three times | **0** |
| holes that never holed out | **0** |
| NaN or absent power | **0** |

**Pine Valley 3 was the one hole to hit a shot cap, and it is the cap.** 200 rounds by the worst
player on a 551-yard par 5 with a 60-shot ceiling: worst 32 strokes, **zero unfinished**.

### The tutorial hole plays like a lesson

```
expert  3.37 strokes  (-0.63 vs par 4)      ok    4.97  (+0.97)
good    3.82          (-0.18)               poor  7.43  (+3.43)
```

A good player makes par or better and a poor one is not stuck - which is what a first hole should
do. **The ball comes to rest on the green itself in 100 % of rounds at every skill level**, which
is the number that matters for the lesson rather than for the golf: the putting card waits on
`on-green`, and `on-green` is the green SURFACE, not the fringe. A round that never rested there
would take the later `holed` straight past the dial and putt cards through the forward search.

### The ladder was walked rather than reasoned about

Every gate opens exactly when it should - tutorial to set 1, par on each set to the next, set 6
UNLOCKED (not beaten) to the front nine, par on the front to the back, par on the back to
eighteen - and **no gate closes once open**, because every requirement reads a best and every best
is `Math.min` in `recordGolf`, in the `bestHole` fold and in `players-agg.js`'s merge. That is the
whole safety property of deriving the ladder instead of storing it, and it now has a walked
transcript rather than an argument.

### The pause menu, at every phase

Opened during the opening flyover, at address, mid-backswing, mid-downswing, with the ball in the
air, and over the result card. The meter is cancelled in the two swing cases with `shotN` unchanged;
a flight keeps running and lands underneath the menu, `shotN` 1 -> 2, ball moved - lossless; the
menu cannot open twice; and the ordinary quit route still asks, cancels back into the round and
confirms out to the setup screen.

## A lesson caret stands OFF the meter and points at it (2026-09-09)

Matt, with a screenshot of the bad-swing card: *"The small arrows on the power meter (on all
tutorial steps not just this one) are ON the meter rather than outside the meter pointing at a spot
on the meter."*

**They were, and the anchor looked right.** The caret was placed at `polar(OUT_R + 6, ang(v))` -
r 60, genuinely outside a band that runs 35 to 54 - and then the triangle was drawn from a local
shape whose points are at y = -9 and y = -19, both BACK along the pointing direction. So the
drawn arrow occupied **r 41 to 51: inside the band**, at every step that carries a mark. The bar
caret had the same fault one axis over - it anchored on `top()`, the bar's INNER edge, and drew
downward into the bar.

**It is built from its two ends now, not from an anchor plus a local shape.** `apex` is the point
being named and `base` is `CARET_LEN` further AWAY from it, so the caret cannot end up on the
wrong side of its own target however the rotation is read - which is exactly what the old form got
wrong twice, in two different directions, and what the comment above it confidently described
backwards.

```
band mark   apex  polar(OUT_R + CARET_GAP, ang(v))              r 57, just off the white rim
            base  polar(OUT_R + CARET_GAP + CARET_LEN, ang(v))  r 68
bar mark    apex  bot(barPosOf(v)) + CARET_GAP                  under the bar's OUTER edge
            base  CARET_LEN below that
```

`test.js` section 12d checks it as GEOMETRY rather than as a shape: both ends outside `OUT_R`, the
base further out than the apex, and the bar caret anchored on `bot()` and not `top()`.

### Only the tick a caret is under steps aside

The 100 % caret lands exactly where the "100" label is drawn (`OUT_R + 11`). The first fix pushed
ALL FOUR labels out whenever the lesson was running, and measured on the real canvas that put
**"75" 0.1 px from the top edge** at 13 px type - a clip waiting for a font metric to change, to
make room for a caret nowhere near it. A label moves only when a caret is within `CARET_NEAR`
(0.16 rad) of its own angle, which in practice is the 100 % mark and nothing else. Verified by
rendering: 75, 50 and 25 sit where they always did, and the live dial, the good-swing card and the
bad-swing card all fit their canvas.

## The club lesson moved to the second shot (2026-09-09)

Matt: *"I think we should move the change club tip to the second shot. As it is now, they'll change
clubs on the tee shot then have to change back. You actually have to change clubs for the second
shot."*

**He is right, and it made the one lesson that teaches a control by USING it teach a wrong move.**
The tutorial hole is a 372 yd par 4 and the driver is already the club you want there, so every tap
on those arrows was a change the player had to undo before they could play. Worse than pointless:
the ladder WRAPS, so a single "up" tap on the tee takes the driver round to the **putter** - caught
on camera by the probe written for this change, which putted from the tee and went nowhere.

After the drive the bag has genuinely moved on. Measured in a browser: the drive settles in the
fairway and `autoSelectClub` puts a **7 iron** in hand, so working the control is now the thing a
player would be doing anyway rather than something to reverse.

### It needed a silent step, not just a reorder

`club` following `swing` directly would put a card on screen the instant the first tap started the
backswing - the same defect the three-cards-per-swing version had, one step further on. So a silent
`after-drive` step waits on `settled` in between:

```
aim -> good -> bad -> swing -> after-drive(silent) -> club -> to-green(silent) -> dial -> putt ...
```

`settled` was already emitted by `_settleShot` and is already in `SKIPPABLE`, so nothing new is
sent and the lesson still cannot strand: a shot holed from anywhere takes `holed` forward past this
step and every step after it. The card count is unchanged at eight, so the pip row does not move.

`test.js` section 20 pins the ORDER as a `[KNOWN-BUG PROBE]` - the club step is after the swing
step, with a silent `settled` step between them - because nothing at runtime notices step order and
the old arrangement looked perfectly reasonable in the file.

## Playing it again: three more things (2026-09-09)

Matt: *"The club thing should only pop up once the ball has stopped moving. play through the
tutorial again and check for anything else off."* Played end to end at 390x664 with a sampler
running at animation-frame rate in the page, because polling from node is ~50 ms round trips and
the two events in question were one frame apart.

### 1. THE CARD APPEARED ON THE SAME FRAME THE BALL STOPPED

Measured before: the animation ended at **17898 ms** and the coach stepped to `club` at **17898** -
the same frame. Nothing was wrong with the numbers; there was simply no beat. The card arrived on
top of a ball that had, that instant, still been rolling, and the camera goes on easing in for
another **245 ms** after that, so the whole scene is moving under a card that has just appeared.

`SETTLE_CARD_MS` (700) gates the coach, and **only the coach**: `shotN`, the auto-pick, the HUD,
the banner and the drop prompt all still land on the settling frame, so nothing about playing the
hole is slowed. It matches the 700 ms the holed path already waits before its result card, so the
game has one beat rather than two different ones. `on-green` goes with it in the same order, or the
putting popup would overtake the card ahead of it.

Measured after: ball at rest 17776, camera still 18018, card 18485 - **709 ms after the ball stops
and 467 ms after the scene is completely still.**

### 2. THE RAIL VANISHED ON THE SILENT STEPS

`_render` returned early for a step with no key, so it drew nothing at all. But `data-tut` holds the
controls 30 px up for the WHOLE lesson - so an empty rail left a reserved strip of bare course under
them, and the progress pips blinked out for the two shots of the approach and came back for the
putting card. A silent step now draws the rail with **pips only** and no rings: the row is
continuous and the space it reserved is the space it uses.

`_pipsHTML` needed the other half of it. A silent step is not in `CARDS`, so `indexOf` returned -1
and every pip came out blank - the row would have been there saying nothing. Counting the cards
BEHIND it marks those done and lights the one AHEAD, which is what a waypoint between two cards
means.

### 3. THE HUD CALLED THE LESSON "PRACTICE"

The tutorial runs as `roundId: 'practice'` - one hole, no `bestRoundByCourse` write - which is right
for the recorder and wrong for the label. The result card said "Tutorial complete" while the panel
three inches above it had read **practice** for the whole lesson. `mode_tutorial` (EN and ES), keyed
on `tutorialRun`; an ordinary practice hole still says practice, verified in both languages.

### What was checked and was fine

Every step screenshotted and audited at 390x664: **33 checks, 0 failed** - nothing the lesson draws
falls off screen, no rail card or ring covers a control (a popup and the result card DO cover them,
which is what modal means), and nothing scrolls, page or inner. The ladder was re-checked from the
setup screen rather than from the module: a fresh player sees **0 of 6** three-hole sets with each
one naming what it waits for, the tutorial opens **1-3**, and par on 1-3 opens **4-6** and shows
"Best: E".

Two things that look wrong in a screenshot and are not: the HUD is dimmed behind the result card
(that is `.gf-result`'s own scrim, `rgba(6,12,4,0.62)`), and the ball rests **0.9 ft** from the cup
before the holed banner (that is `CUP_CAPTURE_YD`, one ball-width, already investigated and
withdrawn once).

**Still open, unchanged and pre-existing:** only 2 of the aim ladder's dots are on screen at address
with a driver, which this file already records as a feel call for Matt.

## The HUD was paying twice for chrome that was not there (2026-09-09)

Matt, with a screenshot of the live game beside an edit of his own: *"I moved the HUD higher up and
lower on the screen, creating more room for the golfer."* He was pointing at two paddings, and each
was guarding against something that does not exist.

### The top: a 46 px pad for a button that sits ABOVE the game

`ui.js` set `--gf-top-pad: 46px` whenever the game was mounted in the hub, with the comment *"the
hub's floating back button lives in the top-left, so the HUD's own top row moves down out from
under it."* **Measured in the real hub at 393x852: the back pill runs 54..89 and the game area
starts at 98.** It is above the game with 9 px to spare, and a scan of every positioned element
outside `.gf-root` found NOTHING overlapping the game rect at either phone height. 46 px of a 714 px
game area - 6.4 % of the screen - was reserved for a collision that cannot happen.

### The bottom: the home indicator, charged twice

Every bottom inset was `calc(10px + env(safe-area-inset-bottom))`. **`env()` is a VIEWPORT inset,
not an element one** - the same number wherever the element sits - and in the hub the game already
stops 40 px above the viewport bottom, so on a phone with a 34 px home indicator the controls were
pushed up by an inset the host had already paid.

### Both are MEASURED now, in `_fitInsets()`

- `--gf-top-pad` is `max(0, backPill.bottom - root.top) + 6`, so it is 0 when the pill is clear and
  exactly enough when it is not. Asking for `.hub-back` by name is a reach into the host, which is
  precisely why it is a measurement and not a constant: absent, hidden or clear, the pad is 0.
- `--gf-gap-b` is how far our own bottom edge already sits above the viewport, and the CSS does
  `--gf-safe-b: max(0px, calc(env(safe-area-inset-bottom) - var(--gf-gap-b, 0px)))`. Standalone the
  game is full bleed, the gap is 0, and the safe area is honoured in full exactly as before.

It runs BEFORE `_fit`'s no-op early return, because the insets depend on where we landed on the
page, not on whether our own height changed - a rotation can move the host's chrome without
resizing us at all.

**Measured after**, open course between the top and bottom clusters, tutorial hole:

| | before | after |
|---|---|---|
| hub 393x852 | 303 px | **349 px** |
| hub 390x664 | 115 px | **161 px** |
| standalone | 487 px | 487 px (unchanged - it never had the pad) |

`test-visual.mjs`'s four fit checks and `check-no-scroll.mjs` stay green in both hosts at both
heights.

### Found while measuring, NOT fixed here, and not caused by this

**The top-left and top-centre clusters overlap on narrow phones.** The gap between `.gf-tl`'s right
edge and `.gf-tc`'s left edge: **+8 px at 393, +7 px at 390, -8 px at 360, -28 px at 320.** It is a
WIDTH problem and it measures identically at a 46 px pad and a 0 px pad, so it is pre-existing and
untouched by this change. It is invisible to the suites because both of them drive golf at 393x852
and 390x664 only, and it starts below 390 - which is an iPhone SE and most of Android. Raised as
its own task rather than widened into this one.

## The bad-swing card was underselling its own lesson by four times (2026-09-09)

Matt, looking at the card: *"are those numbers accurate? a 20% increase in power would only result
in being 5 additional yards offline?"* No, and he caught it by arithmetic alone.

The card's two labels were **34** and **39 yds off** - hardcoded in `SLICE_SVG`. Re-measured through
the real resolver on the TUTORIAL HOLE (the hole the card is teaching on, and the only one with no
trees, water or sand to interfere), a driver from the tee with the needle at the END of the bar:

| | offline | mishit |
|---|---|---|
| 100 % power | **24.4 yds** | 8.0 deg |
| max power (1.206) | **45 yds** (29-46) | 10-22 deg |

So the real cost of 21 % more power is about **21 yards, not 5** - nearly DOUBLE the miss. The card
was making exactly the right point and quoting numbers that argued against it.

**Two reasons they were stale.** They were taken on a Pine Valley fairway, where a tree can stop
the ball and shorten the measurement; and they predate 2026-09-08, when the mishit moved out of
`aimRad` into `mishitDeg` so the ball CURVES, and `sprayDepth` began ramping the over-swing spray
from 100 % rather than from the block's edge.

**The max-power figure is a typical value, not a fixed one.** `blockSpray` takes a random side, so
the ball lands 29-46 yds off depending on whether the spray agrees with the mishit or partly
cancels it. 45 is the median.

**THE NUMBERS ON THE CARD ARE MATT'S, AND THEY ARE ILLUSTRATIVE - do not re-derive them.** They
were briefly wired to `resolveShot` so they could not go stale again; he then set them at **25 and
45** and asked for the solver to go. *"say 25 yards instead of 24 just because. So get rid of that
solver and just use 25 and 45."* It is a teaching card, not a readout, and a round 25 reads better
than 24.4. Section 20 now checks only that both figures are present and that the over-swing one is
plainly larger - the claim the card exists to make - with no engine call.

**The curves are deliberately NOT to scale** (Matt: *"doesn't have to be to scale, but show that
it's a lot more curve"*). Gold rises about 100 units against cyan's 22, far more than the 1.8x the
numbers say, because the card's job is to land the difference in a glance.

### And the random side is ONLY the over-swing

Matt, reading the same card: *"I noticed the over swing picks a random side. Didn't I specifically
tell you that left aim misses should curve left and right misses should curve right?"*

Both are true, and the line says so:

```js
const signedDeg = deg * Math.sign(signed || 1) + blockSpray(power, seed);
```

`deg * Math.sign(signed)` is his rule and it governs EVERY shot - stop left of the bar's centre and
the ball misses left, stop right and it misses right. `blockSpray` is added on top and is **zero at
or below 100 % power** (`sprayDepth` returns 0 there), so it exists only past 100 %. His read of
why: *"that's actually not a bad idea"* - an over-swing you cannot predict the side of is a gamble
you cannot out-skill, which is the whole point of the penalty.

**The honest caveat, so nobody is surprised by it:** past 100 % the spray can push a left miss to
the right, because it is added rather than aligned. Inside the ordinary swing the aim-side rule is
absolute.

## Five more from playing the lesson (2026-09-09)

### 1. THE SWING IS HELD UNTIL THE GATED CONTROL IS USED

Matt: *"you shouldn't be able to swing without first tapping the aim arrows."* The aim and club
steps already refused to ADVANCE on anything but their own control - but nothing stopped the player
swinging straight past them, so the one lesson that teaches by MAKING you use a control could be
walked around while its card sat there and the ball flew.

`Coach.blocksSwing()` is true only on a step that RINGS a control (a card with nothing to press
cannot be waiting on a press, which keeps every silent waypoint and every popup out of it by
construction), and `_tap` asks before starting a swing.

**A refused tap is never silent.** `nudge()` flashes the rings and pulses the rail; the class is
removed and re-added so it restarts on every attempt rather than only the first. A control that
quietly does nothing reads as broken - which is exactly the complaint the putter's dead zone got.

### 2. The rings are bigger

*"the aim, and the change club ones need to be more obvious."* 2 px of hairline at 28 % glow over a
busy pixel-art course was easy to read past. Now 3 px, a wider brighter halo, and a hard BLACK KEY
outside it - the same trick the swing meter and the tree canopies need to hold their shape against
grass. Reduced motion keeps the emphasis and drops only the movement: the ring holds its brightest
state and a refused swing still changes it.

### 3. THE PUTTING LESSON NEVER FIRED FROM THE FRINGE

*"the putting one didn't popup now when i'm putting from the fringe. It gave me the putter, but the
clues didn't come up."* `_settleShot` fired `on-green` on `_lie() === 'green'`, but `mustPutt` -
the predicate that HANDS the player the putter - is green **or fringe**. So the collar gave him a
club he had not been taught and no card explaining it.

It is `mustPutt(this._lie())` now. Still not `settled`: the fairway and the rough do not force a
putter, so a card there would tell a player standing in the fairway to putt.

### 4. The bad-swing line fits on one line

*"...exaggerates mishits"* - "Extra power exaggerates mishits.", measured at one line.

### 5. The putting card points at both 25s

*"put arrows pointing at the 25% on both meters on the putting info popup."* This is the card's
whole argument made visible: the two carets sit at obviously different angles, which is the thing
the sentence is claiming.

**The putting caret is NOT at power 0.25.** A putt travels `range * power ** PUTT_GAMMA`, so that
dial draws its 25 % tick at `0.25 ** (1 / PUTT_GAMMA)` - about 42 % of the way round - and a caret
at 0.25 would point at bare band a third of a turn short of the number it is naming. `PUTT_TICK_MARK`
derives it from `PUTT_GAMMA` rather than typing it, so it moves if the curve is ever retuned.

### 6. The closing card shows the ROUTE, not just the destination

*"The image should show the pause button and the pause menu with the report a bug option."* It drew
the menu alone, which says what to look for and not where it lives - and pause is a small word in a
corner a new player has had no reason to press. It now draws the button, an arrow down from it, and
the menu it opens with `report a bug` lit. The replica button is built from `.gf-btn`'s own colour
and the rows from `.gf-pause__row`'s, so the picture cannot drift from the thing.

It is a REPLICA, not the real control: a live button inside a lesson popup would be a second way to
press it. Heading and body are now "Please report bugs!" / "Tap pause mid-game, then Report a bug,
if you notice anything." (Matt wrote "Click"; every other string in this game says Tap.)

### The playthrough after those six: one thing left, and it was the rings

Played end to end again at 393x852 - **46 checks, 0 failed**. Every step in order, the swing held on
aim and club and free on the swing step, a held tap leaving `phase: idle` / `shotN: 1` with the
rings flashing, nothing drawn off screen, no rail card or ring covering a control, nothing
scrolling, no text under 11 px, and `bestHole['tutorial:1']` recorded at the end.

**The fringe case was forced rather than waited for**, since a normal approach lands on the green:
the ball was settled on the collar through the real `_settleShot`, and the lesson correctly went
`lie: fringe` -> putter in hand -> `dial` -> "The putting dial". That is the bug Matt reported,
verified in the exact situation.

**The one thing found: the lowest ring sat 5 px INSIDE the rail.** The controls sit exactly on the
rail's top edge (one number governs both), so `_place`'s 4 px outset had nowhere to go downward -
and a gold ring meeting the rail's gold top border reads as one muddy band rather than a ring.

Two fixes, and the second is the same trap the rail's own height had:

- `_place` drops the outset on whichever side would cross the rail rather than shrinking the ring
  all round, so the other three sides keep their full standoff.
- **The ring is `box-sizing: border-box`.** On content-box its 3 px border was added on top of the
  height `_place` sets, so a ring clamped to stop above the rail still crossed it by exactly the
  border. Measured: 5 px over -> 4 px over -> **2 px clear**.

Also measured and NOT a problem: the left aim ring's glow reaches to 1 px inside the root's left
edge. Tight, but not clipped.

## Three from the first day it was live (2026-09-09)

Matt, playing the released build. All three were MEASURED in a real browser before anything was
changed, and one of them turned out to need no change at all.

### 1. The putter's dead zone gave no sign it had heard you

> *"the putting double tap bug is back. I have to click swing twice to get it to start moving."*

**Measured, putter in hand, tap 1 at t=0:** the needle reads `pos 0` at t+43, t+125 and t+220, and
first passes `MIN_TAP_POS` at about **t+272**. `PUTTER_DEAD_MS` (250 ms) is why, and it exists for
a real, documented reason - see `clubs.js`, and note that the two obvious alternatives (a steeper
power curve, a slower putter) were both tried and both reverted because each visibly changed the
dial or the rhythm.

So for a quarter of a second the meter is stone dead, and **the only cue was the swing button's own
text label** changing to "Set power". Nobody watching the needle reads a caption on the button they
are tapping. `ui.js`'s own comment claimed a second cue - *"the charge ring in `_drawMeter` below"* -
and **there was no such code**: a comment describing a cue that was never written.

**The cost is not one wasted tap.** The instinctive second tap is refused by `MIN_TAP_POS`
(correctly - it would otherwise fire a 3 % putt and charge a stroke, which is the bug that rule
closed on 2026-09-09), so the player is left ONE TAP OUT OF STEP: their next tap sets POWER when
they believe it is setting accuracy. Every putt after the first mistimed one is wrong too.

Two cues, and neither touches the dial, the tempo, the dead zone or any power number:

- **The needle CHARGES.** `_chargeK()` is 1 at tap 1 and eases to 0 as the dead zone runs out;
  `_drawMeter` draws the needle GOLD and fat over that window, easing back to its normal white. It
  is unmistakably alive before it starts to climb. Off on the tutorial's still dial, which is handed
  a fabricated `read` and has no clock.
- **A refused tap KICKS the button** (`_refuseFlash`, `.gf-btn.is-refused`, 220 ms, motion only so
  it cannot be confused with the armed state; reduced-motion gets a gold outline instead).
  `swing.tap()` already returned `null` for "this tap did nothing" and nothing consumed it.

### 2. The aim arrows: a tap is fine now, a hold is coarse

> *"the aim arrows move the aim by a lot more than usual. I just hit the 2 iron and the 8 iron and a
> single click moved the aim spot by a lot."*

**MEASURED: nothing had changed it.** One tap was exactly **1.000 deg on every club** - driver,
5 wood, 7 iron - and the camera frame is the same 95 yds wide with the same 4.137 px/yd whatever is
in hand. The step had never been anything but 1.0.

**What changed is what you can SEE.** Reclaiming the HUD's dead chrome earlier the same day made the
canvas taller, and the frame's scale is set by its WIDTH - so a taller canvas shows further up the
hole. The aim ladder's far dot, the one that swings the most, stopped being off the top of the
screen on an iron. At a 2 iron's 175 yds, 1 deg is 3.1 yds of landing spot, and now you watch it
move.

A tap and a hold were being asked to be the same number and they want opposite things. They are
split now: **`AIM_STEP_DEG` 0.35** for a tap (1.07 yds at 175, the resolution an approach needs) and
**`AIM_STEP_HOLD_DEG` 1.4** once the repeat is at full speed, reached by handing `hold()`'s existing
ramp position `k` to the callback. Measured after: a held arrow crosses the whole 60 deg arc in
**3.6 s** (it was 5), and a tap is three times finer. Both ends got better. The club arrows
deliberately do NOT take the ramp - there are fourteen clubs, and one tap is one club.

### 3. The max-power drive that sprayed: working exactly as designed

> *"I used a max power drive on the tutorial and aimed in the green but it still spun and was off
> target. what's up with that?"*

Nothing. That is `blockSpray`, and it is the thing the bad-swing card teaches:

| power | spray | offline at 242 yds |
|---|---|---|
| 100 % | none | 0 |
| 105 % | 1.1-1.7 deg | 5-7 yds |
| 110 % | 2.3-3.4 deg | 10-15 yds |
| 120.6 % (top of the arc) | 4.7-7.1 deg | **20-30 yds** |

**"Max power" is 120.6 %, not 100 %** - the green line on the dial is 100, and the arc keeps going.
The spray is **ADDED, not multiplied**, and it picks its own side, which is the entire point of it:
a perfect accuracy tap has no miss to multiply, so without the addition an over-swing would be free
distance (measured 2026-09-06: +16.3 yds for nothing). A dead-centre strike at the top of the arc is
*supposed* to finish 20-30 yds offline. Aim is not the lever there; stopping at the green line is.

Left alone. If it should cost less, `BLOCK_SPRAY_DEG` is the one number to move, and that is Matt's
call to make rather than a session's.

## Job A: a round survives leaving the app (2026-09-09)

`HANDOFF-GOLF-LAUNCH.md`'s job A, and the only one of the three where a player LOSES something.

**There was no mid-round save at all.** `gamehub.golf.v1` held the last course, round and length;
`_recordRound` wrote nothing until a round was COMPLETE. So closing the app on the fifteenth hole
of an eighteen destroyed the whole round. The only protection was a confirm on the two deliberate
exits, and none of that survives iOS evicting the tab, which on a phone is routine.

### The shape

**One key, not two.** Root `CLAUDE.md` says so by name (*"Do not mint `gamehub.golf.save.v1`"*).
The save is a `save` FIELD on the settings object. That instruction's stated reason was wrong when
it was written - it said the key "already holds the round", which it did not, it held settings -
so the reason is corrected here (rule 9): one key per game is the convention, and a second is a
second thing to migrate, back up and reason about for ever. The instruction stands.

`golf/js/save.js` is the VALIDATOR, and it is its own module so it can be hammered headlessly:
`validateSave(raw, courses, rounds)` (pure), plus `resumePos` and `isComplete`. `ui.js` owns the
reading and writing, because it owns the storage key.

**Two departures from the handoff's field list, both NARROWING:**

- **`recorded` / `newBest` are not stored.** A save exists only while a round is unrecorded -
  `_recordRound` clears it on success - so a stored `recorded: true` is a state the code can never
  be in. Storing a flag whose only legal value is `false` invites restoring into a round the player
  has already been paid for.
- **`tutorialRun`, and practice holes generally, are not saved.** A practice hole is ONE UNSCORED
  HOLE: it writes no round best, its hole record lands the moment it is holed, and `_roundAtStake()`
  already refuses to stop the player for one. Nothing to lose, so nothing to save - and every line
  not written is a line that cannot restore a round wrong.

### When it is written, and when it is dropped

Saved on the four beats that change any of it: **entering a hole**, **the ball coming to REST**,
**a hole being scored** (before the result card goes up, since that card is a place people leave
from), and **a penalty drop** (which moves the ball and costs a stroke).

AT REST is load-bearing. `this.ball` while `this.anim` runs is a point on a flight path; a save
taken then would restore the ball into mid-air as if it were lying there.

**The clear is on the WRITE, not on the round's end.** `_recordRound` clears it after verifying the
best landed by fresh re-read. Clearing at the last putt looks equivalent and drops the round in
exactly the case the save exists for - `js/game-stats.js`'s `drainPendingResults` /
`clearPendingResults` split is the reference and says the same thing.

### Resuming

`_resumeSaved()` has three branches, and the hole at `pos` decides which:

| state of `scores[pos]` | what it means | what happens |
|---|---|---|
| every hole scored | the round finished, only the WRITE was lost | `_recordRound()` now, clear, back to setup with the result banked |
| `pos` already scored | killed with the hole's result card up | the NEXT hole, from its tee |
| `pos` unscored | killed mid-hole | that hole, with the ball, `shotN`, aim and club put back |

**`_resumeSaved` re-saves at the end, and that line is not optional.** `_enterHole` puts the ball on
the tee and saves THAT, so without it a resume silently rewinds the file on disk to the tee and a
second kill hands back a round the player has already partly replayed. Found by driving it in a
browser, and pinned by a `[KNOWN-BUG PROBE]` in `golf/js/test.js` section 22.

The setup screen offers a **Resume round** button above everything else, using `resume` - an orphan
string that had been sitting in `strings.js` since the setup screen was written with nothing calling
it. Its subtitle names the hole the resume will ACTUALLY land on (`resumePos`), not `pos`: a button
that said "hole 1 of 3" and then opened hole 2 would be a small lie on the one screen a returning
player uses to decide whether this is even their round.

Starting a round, a practice hole or the tutorial goes through `_askDiscard` first.

### Two things that changed with it, in the same commit

- **`isInProgress()` is `false` again**, as both `CLAUDE.md` files said it should be once the save
  existed. Leaving is lossless; the hub no longer needs to ask.
- **The in-game quit prompt only warns when the save did NOT land.** `_roundAtStake()` checks
  `saveOk` - the VERIFIED write, not the attempt - so a device that cannot write (storage full,
  private mode) still gets the old warning, which is exactly when it is true again. Warning about a
  loss that cannot happen is how a prompt becomes something people dismiss without reading, and
  then it is not there on the day it matters.

### What was checked

Driven end to end in a real Chromium at 393x852: a shot, a reload, resume (ball and `shotN`
byte-identical); a kill with the result card up (resumes on the next hole with the first hole's
score kept); a complete three-hole round (recorded, best landed, save cleared, no resume offered
after); and the discard prompt in all three of its outcomes. `golf/js/test.js` section 22 covers the
validator (24 refusals and tolerances), `resumePos`/`isComplete`, and every call site structurally.

## Job B: a hole's maximum score is double par plus one (2026-09-09)

Matt: *"Double Par plus 1 should be each hole's max."* Par 3 → **7**, par 4 → **9**, par 5 → **11**.
`maxStrokes(par)` in `golf/js/rounds.js`.

**It is real golf** - equitable stroke control, the rule that stops one disaster hole swallowing a
card - so it does not read as an arbitrary game limit the way a flat "ten shots and you are out"
would.

**THE HOLE ENDS AT THE CAP.** That is the half that makes it a feature rather than a clamp: a game
that keeps asking for shots it has already decided not to count is asking the player to work for
nothing. It also bounds the whole "ball stuck in the trees" class of bug by construction - every
hole now ends - which retires `golf/js/test.js` section 15c's 14-shot ceiling as a real-play
concern (that ceiling was only ever in the test harness's simulated player, never in the game).

### The mechanics, and the three things that are easy to get wrong

- **`shotN` is the shot ABOUT to be played**, so `shotN - 1` is how many have been used.
  `_capReached()` tests `shotN - 1 >= maxStrokes(par)`.
- **The score is the ALLOWANCE, not the counter.** A water penalty adds two strokes at once, so
  `shotN` can overshoot: measured in a browser, it reached **10 on a par 4** and the hole was worth
  **9**. `min(shotN, cap)` would give the same answer here and is still the wrong expression,
  because it hides that the hole is worth its allowance.
- **`pickedUp` is a flag, not a clamp**, because the CARD has to be able to say what happened. A 9
  labelled "Double bogey" on a hole nobody holed out is the game claiming a shot the player never
  played. The card reads **Picked up** / **Picked up at 9**.

### Two bugs found by driving it, both now `[KNOWN-BUG PROBE]`s

1. **The tutorial would have stalled.** The tutorial hole is a par 4, so its cap is 9 - reachable by
   a first-time player, which is exactly who is on it. The lesson's `sink` step waits on `'holed'`,
   so a capped hole left it waiting for a ball that was never going to drop. `_pickUp` fires
   `_coach('holed')`: to the lesson, that event means "the hole is over", not "the ball went in".
2. **The shot that hit the cap was not saved.** `_settleShot` returns at the cap without reaching
   its own `_saveRound`, so a kill inside the 700 ms before the card rewound the player one shot.
   `_pickUp` saves first, which also puts `shotN` past the allowance in the file - and that is what
   `_resumeSaved`'s own `_capReached()` check reads to finish the hole rather than re-offer a shot
   the cap says does not exist.

### What it does NOT touch

- **Existing records are never rewritten** (THE LAW rule 5). A stored 14 from before this shipped
  stays 14 and stays visible. New scores only.
- **Stableford is unchanged.** A capped score arrives already capped and lands in the same "double
  bogey or worse" bucket every blow-up has always landed in. The cap changes the number the hole
  cost, never how that number is valued.

### Section 12b was updated, deliberately

That `[KNOWN-BUG PROBE]` pins that the result screen never subtracts one from `shotN` (every score
in the game was once a stroke too low), and it required `_showHoleResult` to have exactly ONE
caller - because a second caller would have broken "shotN is the shot just played". There are two
now. The rule is preserved differently rather than dropped: the cap path never reads `shotN` for the
score at all, it uses the allowance, so the probe now requires every caller to be one of those two.
A third would have to prove for itself what `strokes` means.

## Two things the lesson never said (2026-09-09)

Both came from Ana's first round, relayed by Matt, and both were things the game DREW and never
named.

### 1. The red dots are the meter's own numbers, on the ground

> *"she had no idea that the 25/50/75/100 corresponded to red dots on the blue aim line."*

The dial has four numbered ticks. The ground has four red dots. That they are the SAME FOUR NUMBERS
- where this club lands the ball at that power - is the single most useful fact in the game, and it
was left to be guessed. A player who has not made the connection is reading the dial as an abstract
power gauge instead of as a distance picker.

A `dots` popup, **straight after `aim`**: that is the moment the player is looking at the line,
because they have just moved it, and it comes before the two swing popups because those talk about
the meter and this is what the meter's numbers MEAN on the ground.

It draws the REAL dial (`dial('plain')`) beside a schematic aim line. **`plain` is a new dial kind:
the full dial with NO caret.** `full` carries the gold arrow at 25 %, which on this card would say
"aim here" - the putting card's message two steps later, not this one's.

The line is schematic on purpose. The real one is drawn in perspective up a fairway, so a picture
trying to match it would be a worse diagram AND a second thing to keep in step with `render.js`.
The COLOURS are the real ones (`pal.aim`, `pal.aimLine`, and the line turning red past the 100 %
dot), because those are the part a player has to match by eye.

### 2. Greens are sloped

> *"i guess that the greens are sloped? that might need to be said too."*

They are, `render.js`'s `drawSlope` has always drawn the chevrons, and no card ever mentioned them -
so they read as texture rather than as the one thing that decides where to aim a putt.

A `slope` popup, **before the dial card rather than after**: this one is about reading the green the
ball has just landed on, which is what a player does first; the dial card is about how hard to hit
it, which is what they do second.

**The picture had to be redrawn once.** The first version put the chevrons pointing straight down
the screen with an uphill putt, and it was ambiguous - the break and the aim were both vertical, and
nothing said which caused which. It now shows the chevrons pointing ONE WAY, a blue aim line pointing
left of the cup, and the white ball path bending RIGHT into it. "The ball bends the way these point"
is the diagram, not the caption.

### What this cost

The lesson is 10 cards now rather than 8. The pips row was measured at 393, 360 and **320** px: no
overflow, and the rail text still fits on one line at all three.

## Job C: the leaderboard (2026-09-09)

`HANDOFF-GOLF-LAUNCH.md` job C, in three parts. C2 was "leave it alone" and was left alone.

### C1: golf's plays are ROUNDS, not runs

Golf sits in `SOLO` (`js/players-agg.js`) with Ball Run, Snake, Nuts & Bolts, Hill Climb, Pinball
and Skeeball, so its plays were counted into a tally labelled **Runs** in My Stats' overview.

**Not a global rename**, which is the whole point: `runs` is the right word for the other six. Golf
gets its own tally, counted separately in `overviewTotals` and shown as **Rounds** when it is above
zero. A round of golf is not a run at anything, and calling it one is the kind of small wrongness
that makes a screen feel like it was written for a different game.

Everywhere else golf already had its own word - `gs_golf_rounds` on its My Stats screen,
`lb_unit_golf_best` ("best round") on the hub board - so this was the one remaining site.

### C3: the detailed boards live INSIDE golf

`golf/js/board.js`. Matt: *"Since the golf leaderboard is likely a lot, maybe we have the more
specific info within the golf game itself?"* Skeeball set the precedent: one number on the hub
board, the full picture on the machine's own backboard.

Two rows of chips - **length** (3 / 9 / 18) then **which round** (1-3, 4-6 … front nine, back nine,
18) - and one ranked list. The chips are the setup screen's own two-level shape, because that is the
shape the player already knows.

- **It invents no data and no aggregation.** The round keys are frozen and already synced. People
  come from `readPlayersOnce()` → `aggregatePlayers()`, which is how the hub board reads them, and
  the number comes from `golfBestAt(group, roundKey)` - the same extractor with a different key. A
  second aggregation would be a second answer to "who has played what", and the two would drift.
- **Lengths are never merged or compared** (rule 4). Every list is ONE round key and the header
  names it and its par. A three-hole best and an eighteen-hole best are not the same measurement.
- **A round key with no par row is refused, not shown.** `golfBestAt` subtracts
  `GOLF_COURSE_PAR[key] || 0`, so on an unknown key it returns raw STROKES dressed as a score to par
  - a number that looks like a wonderful round. `hasPar()` checks the table before anything prints.
- **Never played is not zero.** A player with no score on the selected round is absent, and a round
  nobody has played says so.
- **A tie is a tie**: two players level are both 2nd and the next is 4th.
- Read is paid for by `ui.js` (`_openBoard`), not inside the module, so the button can say it is
  working - `readPlayersOnce` is a network call. Both modules are lazy: a player who never opens
  this screen never downloads it or the aggregation layer.
- **Looking at the board does not go through `_askDiscard`.** It is a screen you open and close, so
  a player checking where they stand mid-round must not be asked to throw that round away first.

### Three things found by driving it

1. **Level par printed `lb_golf_even`.** That is the HUB's string key; this module's `t` is built
   from `golf/js/strings.js`, so it resolved to nothing and printed itself. Golf owns `board_even`.
2. **`isMe` looked for a device id that groups do not carry.** An aggregated group has a device
   COUNT, not a list of ids. It matches on the identity key instead (`buildIdentity().keyFor`),
   which is how every other screen in this app answers "which of these rows is me".
3. **The chips shared `data-mode` / `data-round` with the setup screen**, which is still in the DOM
   behind the overlay - so a document-wide query found ITS chip, and the first driven tap landed on
   a locked button on a screen nobody could see. The handlers were scoped to the overlay and were
   never wrong; the NAMES were, and a name that is only safe because of where you happen to look it
   up is a trap for whoever debugs this next. They are `data-bmode` / `data-bround`.

Also: the overlay is fully opaque. At 94 % the setup screen's own "Best:" figures showed through a
screen that is itself a list of scores.

## "It's messed up for me": half a viewport, and two readings of it (2026-09-10)

TP sent Matt a screenshot: golf drawn into the TOP 40 % of his screen, the hub's background
filling the rest. Nobody else saw it, and no viewport size reproduces it - golf measures 95-96 %
fill at all six sizes tested, and `check-no-scroll.mjs` and `test-visual.mjs`'s `fit` probes were
green through the whole investigation.

**What the screenshot itself says.** Golf's bottom edge sat exactly where `_fit()` puts it if
`window.innerHeight` had reported about HALF the real viewport: 51 % at device pixel ratio 2,
51 % at 2.5, 51 % at 3. The answer being the same at every plausible DPR is what makes this a
finding rather than a guess - the arithmetic does not depend on knowing his phone. Half a viewport
is what Android split-screen gives you, and a foldable's cover screen is near enough.

**Why nothing recovered on its own.** `_fit()` is called by things that change SIZE. If the
viewport doubles while this page is not the one on screen, the resize can arrive before the game
exists, or not at all, and then nothing re-measures - the element's own size never changed.

**The fix is two readings of one number.** `_fit()` now takes the LARGER of
`window.innerHeight` and `document.documentElement.clientHeight`. They are two paths to the same
layout viewport, so one can be stale while the other is not, and larger is the safe direction:
too small is exactly what the report looks like, while too large is corrected on the very next
line, where the page's own overflow is measured and handed straight back. Plus a
`visibilitychange` re-fit (coming back to the app is a re-measure) and an underfill backstop: if
the fill lands under 88 %, ask again on the next frame and at 250/750/1500 ms, one burst per
episode, re-armed only when the fill comes good.

**The first version of the guard was worthless and the probe is why we know.** It compared the
fill against the same `innerHeight` it had been misled by, so with the height halved it computed
exactly 88 % and never fired. A guard cannot detect a lie using the liar as its yardstick. That is
what pushed the fix down to the measurement itself.

`_uf.mjs` (scratch) drove it: mount golf normally, make `innerHeight` report half, call `_fit()`
once, restore it and fire NO resize event at all. Before: 44 % fill and it stayed there. After:
96 %, unchanged throughout, because a stale `innerHeight` can no longer shrink the game at all.

**Not confirmed with TP.** He was never asked what phone he is on, whether the app was in
split-screen, or whether force-closing fixed it. The arithmetic is strong and the fix is cheap and
safe either way, but if it happens again, ask those three questions first.


## The strip, second look: the first measurement is taken before the game has its own CSS (2026-09-10)

The half-viewport theory in the section above was wrong, or at least not the whole story: it
happened on Matt's phone too, and his phone was not in split-screen. Matt: *"I think it's probably
your second bullet"* - the mount race.

**What the trace shows.** Instrumenting every `_fit()` call through a real mount in the hub:

```
FITLOG {"vh":950,"top":98,"shCollapsed":3053,"rootOverflowY":"visible"}   <- first fit
FITLOG {"vh":950,"top":98,"shCollapsed":950,"rootOverflowY":"hidden"}     <- and every one after
```

`golf.css` is a `<link>` appended to the head, which loads ASYNCHRONOUSLY, so the first `_fit()`
runs against a root with none of its own rules: `overflow-y` is `visible`, the setup screen's whole
content spills out of the collapsed root, and the PAGE measures 3,053 px against a 950 px viewport.
`_fit` reads that as "the page overflows by 2,103" and hands every pixel back, which floors the
game at its 320 px minimum. 320 px of game under a 98 px top bar is **44 % of the screen** - the
strip, to the pixel.

**And the hub was making the first reading worse.** `js/hub.js`'s `launch()` called `module.init()`
BEFORE unhiding `.hub-game`, so the first fit also ran inside a `display: none` box: measured
`top: 0`, `hidden: true`, page height 1,621 (the launcher's). Both halves are fixed - the chrome
now goes up before `init()`, and the import still runs first so the launcher, not an empty frame,
is what a player looks at while a game downloads.

**Why nothing recovered.** The ResizeObserver in the constructor watches the CONTAINER, and neither
a stylesheet applying nor a page-height change resizes the container. On the setup screen nothing
else asks for a fit either. So whatever the first reading said is what stays on screen.
`ensureCSS()` now takes a callback and `init()` re-fits on it.

**Honest limits.** This was never reproduced end to end: on this machine golf recovers to 96 % fill
in every probe, including one that delays `golf.css` by three seconds, because something in the
setup render asks for another fit within about a second. What is measured and certain is that the
FIRST reading is a floor reading, for two independent reasons, and that no mechanism existed to
correct it. If a strip is reported again, ask which screen and whether backing out to the hub and
reopening clears it - a reopen that clears it is this bug; a reopen that does not is the device
measuring its own viewport wrong, which is the section above.


## My Stats: a golf order, and an average that means something (2026-09-10)

Matt, looking at another player's golf record: *"Does this seem correct/what we want?"* Two things
were not.

**Best rounds were in alphabetical order.** The rows were sorted by their DISPLAY NAME, so "Pine
Valley (holes 10-12)" sorted above "(holes 4-6)" and the table read 18, back 9, front 9, 1-3,
10-12, 13-15, 16-18, 4-6, 7-9. `compareGolfRounds` in `js/game-stats-ui.js` now parses the round
key into its course and its length (`pinevalley3d` -> Pine Valley + the fourth three-hole set) and
sorts course by name, then 18, front 9, back 9, then each three-hole set from the first tee to the
last, the way a scorecard reads. A key the regex cannot parse keeps its row and lands at the end of
its course (rule 1).

**"Avg strokes" divided lifetime strokes by lifetime ROUNDS**, and a round here is three, nine or
eighteen holes - so it averaged a 3-hole round against an 18-hole one. On the record Matt sent it
read **16.4**, a number that describes nothing (21 rounds, mostly threes, one eighteen). It is now
**avg per hole**: `gf.holes` was already being counted, so this needed no new stored field, and
strokes per hole is the same measurement whatever length a player picks. A record from before holes
were counted shows a dash rather than a fabricated average (rule 4).

**Left alone on purpose:** the per-hole record row scrolls sideways and shows about eleven of the
eighteen on a phone. Matt: *"ignore"*.


## The fairway roll was 2.25x what Matt approved, and every drive was 22 yards long (2026-09-10)

Matt, looking at a player's record showing a **293 yd longest drive**: *"How tf is that possible? a
100% swing should only go 215."* Then, when the arithmetic came back: *"we agreed on a table with
precise and specific numbers for each club. And you just completely ignored that?"*

He had. `golf-reference-spec.md` §21.3 is dated 2026-09-03, is headed **APPROVED (Matt)**, and the
decisions above it say in one line: **"Roll after landing: fairway ~8 % of carry, green ~2 %, rough
~3 %, bunker 0."** `clubs.js` shipped `fairway.roll = 0.145`, which `rollFactor` then multiplies by
the club's loft term (1.24 for a driver) to **0.180**. Measured through the real engine:

| | Approved | Shipped |
|---|---|---|
| Clean 100 % drive | 215 + 17 = **232** | 215 + 39 = **254** |
| Max over-swing | 237 + 19 = **255** | 242 + 44 = **286** |
| ...with a max tailwind | n/a | **302** |

**The change was not even justified by its own reasoning.** `shot.js`'s rollout comment, written to
argue for MORE roll, says *"4.3 yd/s^2 puts a driver's 17 yd rollout at 2.8 s, which lands in the
reference's range"* - 17 yd is exactly the approved 8 %. The deceleration was set from the
reference and the DISTANCE was not.

**What changed.** `tee` and `fairway` roll: 0.145 -> **0.0645**, which times the driver's 1.24 loft
term is 0.080 exactly. Nothing else moved: the green (0.090) and the collar were raised LATER, by
Matt, against measured scoring, and those decisions stand over the spec's original 2 %. The swing
was not touched either - `BLOCK_KEEPS_DIST` and `BLOCK_SPRAY_DEG` are his own calibrated numbers, so
the over-swing still pays 12.8 % rather than the spec's 10 %, and a maxed drive is 262 rather than
255. Now: 100 % = **232.2**, max over-swing = **261.9**, with a full tailwind **276.2**.

**Two tests were pinning the drift and are retired here, not deleted.** A `[KNOWN-BUG PROBE]`
required a 3 wood to run out at least 16.4 % of its carry, measured off the reference footage - flatly
incompatible with the approved 8 %. Asked to choose, Matt chose the spec (*"yes, fix it to spec and
deploy"*), and the measurement is recorded as OVERRULED in the test file, with the note that a
reference bag running out 16 % may simply have been an upgraded one - the same doubt that already
keeps its 287 yd drive out of our stock ladder. What both probes now assert is the SHAPE they were
really about: a wood arrives shallow and runs, a wedge drops and sits.

**One knock-on, fixed here.** `groundPoint`'s hop had a 1.2 yd floor, added so an approach pitching
on a green still visibly bounced. With the shortest run-outs in the bag now around a yard, that
floor made a lob wedge **hop higher than it rolled** - a leap, the exact thing the cap exists to
prevent. The floor is gone; the green's own roll was not touched, so approach bounces on the putting
surface are unchanged (the floor only ever bound under 2.7 yd).

**What this does NOT fix, and it is Matt's call.** Every golf score already on the leaderboard was
set with drives running 22 yards further than the approved ladder gives. Matt: *"somebody has
already played every available hole and every available option. So now if he goes back, the game is
different. This changes what's fair to include in the Leaderboard."* Nothing here touches a stored
score (THE LAW), and no correction was applied. The options, unchosen as of this commit: leave them
and accept that pre-2026-09-10 bests are easier records; label them; or void them per player through
the same read-time overlay Skeeball uses (`js/stats-corrections.js`), which today has no golf path.

**The lesson, and it is the same one three sections of this file already record.** An APPROVED table
in the spec is a decision, not a starting point. When a later measurement disagrees with it, the
measurement goes in the doc and the decision goes to Matt - it does not quietly become the shipped
number. This one survived a week of playtests because the test suite had been updated to assert the
drifted value, so the thing that should have caught it was pinning it in place instead.


## The over-swing shrinks the target (2026-09-10)

Matt, on a 293 yd drive in a player's record and then on the meter itself: *"right now, it's
incredibly easy to hit a max over swing driver perfectly aimed off the tee. the green section is
huge."*

It was. A driver from the tee is `0.545 x 1.00 x 0.62` = **0.338**, so counting both sides of the
bar, **68 % of it was a perfect strike** - and it stayed exactly that wide whether the needle
stopped at 100 % or at the top of the arc. The only thing over-swinging cost was `blockSpray`, which
is random and lands after the fact. **The player's own input never got harder**, so holding for the
top of the arc was free in skill terms and just paid 27 more yards.

His fix: *"by over-swinging, the green aim section at the bottom of the power meter instantly got
smaller and more difficult to hit accurately."* `bandsFor` takes an `over` factor now, and
`overZone(power)` rides the curve `sprayDepth` already computes, so the band shrinks live as the
needle climbs past 100 % and stops the instant the player plants it:

| Power | Green band | Share of the bar |
|---|---|---|
| 100 % | 0.338 | 68 % (unchanged) |
| 107.6 % (block edge) | 0.258 | 52 % |
| 120.6 % (top of arc) | 0.122 | 24 % |

**The other candidate was the tempo** - Matt: *"maybe the white line thing speeds up and goes down
the meter faster?"* - and it was the wrong one twice over. A faster needle is a difficulty the player
cannot read, against this file's own rule ("a smaller target is simply a smaller target, and the
player can SEE it before committing"), and the tempo is something this repo has twice been told not
to touch.

**`OVER_ZONE_LOSS = 0.64` is Matt's number, picked by swinging it.** A bench copy of the real meter
was published as an artifact - the game's own `bandsFor`, `payingPower`, `blockSpray`, `mishit` and
tempo, with a slider on the shrink - so he could test it on his phone before anything shipped. Two
things that bench got wrong are worth remembering, because both were about INPUT rather than the
model: binding the swing to `click` (which arrives after touchend on a phone, so every tap read
late) and reading `performance.now()` inside the handler instead of the event's own timestamp. The
game does neither - see `evNow` and the touchstart binding in `ui.js`. He noticed immediately: *"It's
delayed or something so i can't tell the feel."*

**`OVER_MIN = 0.10`** stops a bad lie and a full over-swing together from shrinking the band under
the needle's own width - a driver from the trees at the top of the arc would otherwise compute
0.058, about 6 device px under a 6 px needle, which is the invisible-target bug `GREEN_FLOOR` exists
to prevent, reached from the other direction.

**One existing test had to be rewritten and it is worth knowing why.** Section 8c asserted that the
over-swing multiplies the miss by exactly 2x at the top of the arc, comparing bar position 0.9 at
both powers. With the band shrinking, 0.9 is an ORANGE stop at 100 % and a RED one at the top, so
the assertion was comparing the multiplier AND two different qualities of strike. The multiplier
never moved. It now measures halfway into the green band at each power, which is the same strike at
any width.


## Dead centre is dead straight, and nothing beats it for distance (2026-09-10)

Matt swept the aim a hundredth at a time at max power, from 0.21 into orange on one side to 0.21 on
the other, and asked whether the numbers made any sense. They did not. Three separate faults, all
now fixed in `mishit`.

**1. A perfect strike was punished.** `blockSpray` ADDED 4.7-7.1 deg of random push at the top of
the arc no matter how the ball was struck: measured, **0 of 4000 max-power drives finished within
5 yds of the aim line**. Matt: *"why are you penalizing perfectly aimed shots???? If the dead center
of the green aiming bar is hit - it SHOULD NOT be offline by 32 yards."*

It came from a misreading of his own 2026-09-05 note, and the misreading is worth recording because
a previous session built a whole mechanic on it:

> *"The max carry at the farthest past 100% and spot on should only be 240-245. I want it to go
> 20-30 yards offline. high risk."*

Read as one thought, "spot on" governs both clauses and a perfect max swing sprays. His correction:
*"That is NOT what that statement by me means... I want [a poorly aimed shot at max power] to go
20-30 yards offline."* The carry clause is about the carry; the offline clause is about a bad aim.
**The spray, `BLOCK_SPRAY_DEG`, `BLOCK_SPRAY_JITTER` and `mishit`'s `seed` argument are all deleted**
- a struck ball now carries no randomness whatsoever - and the 20-30 yds is delivered by the
over-swing's mishit ramp against a band that shrinks (`overZone`), both of which the player drives.
Measured at the top of the arc: mid-orange is 23 yds offline, the orange edge 34.

**2. The longest drive in the game was a MISS.** The green band's distance loss was SIGNED - left of
centre multiplied distance UP to 1.09, right multiplied DOWN to 0.91, the idea being heavy against
thin. So at max power a miss to the left went **285 yds against a perfect strike's 262**. It is now
symmetric: `1 - GREEN_DIST_LOSS * (off / green)`, peaking at 1.000 dead centre and only falling.

The note that argued for the signed version said a one-sided shortfall is "a bias a player clubs up
once to erase". It is not, once the loss depends on HOW FAR off the strike was: the size of the next
miss is unknown when the club is chosen, so there is nothing fixed to club out.

**3. The green/orange boundary was a cliff, and on one side it ran backwards.** Orange's distance
ramp restarted at 1.00 while green's had walked away from it, so crossing the edge lost 24 yds on
the left and **GAINED 23 yds on the right** - aiming worse made the ball go further. The bands hand
off continuously now: green 1.00 -> 0.91, orange 0.91 -> 0.83, red 0.83 -> 0.60 (the calibrated end
point, unmoved).

### The bug this created, and the test that caught it

Deleting the `seed` parameter silently repurposed the argument at that position: `mishit`'s fifth
parameter is now the green-band FLOOR, and `test.js`'s simulated player was still passing a seed
there. A floor of several million makes every strike land in "green" at `off / green` of nearly
zero, so **every shot came back perfect and the robot aced par 3s 24 times out of 24** - five holes
across the three courses averaging exactly par-2. Section 15c's `[KNOWN-BUG PROBE] no hole plays a
full shot under par` is what caught it. **Removing a parameter is not a safe refactor when callers
pass positionally**; the compiler cannot see it and the numbers still look plausible.

### Where the difficulty landed

With the caller fixed, Pine Valley's easiest hole is -0.13 and Red Mesa's -0.08, both comfortably
inside the guard. **Oasis Sands hole 4 sits at exactly -0.75 against a threshold of -0.75.** That
hole is a **par 5 of 451 yards** - a driver and a 3 wood cover 442, so it is reachable in two and
plays as a birdie hole. The physics change did not create that; it tipped a hole that was already
against the line. Open with Matt as of this commit: lengthen it, call it a par 4, or record it as a
named gap.

### The tool

A phone tool for this lives as an artifact: the meter with both needles DRAGGABLE (no swinging, no
timing), the ball's path from above, and sliders for the band shrink, the base band and the miss
multiplier. Its aim slider reads in Matt's own units, **-0.21 to +0.21**, minus left. It runs the
game's own model, verified against `mishit` at eleven aim positions to the digit - if the two ever
disagree the tool is worthless, which is why that check exists rather than a screenshot.


## 250 is the ceiling, and the free buffer under it is closed (2026-09-10)

Matt, reading the shot tool: *"those distances are still way too far. the farthest a max power drive
should ever go is 250 (with this club, right now. do not add this as some insane hard rule game
wide like you usually do)."* It was 262.

**The yards were coming from the 100 % to 107.6 % band, which paid IN FULL.** `payingPower` only
started diminishing at `BLOCK_FROM`, so the first 7.6 % past a clean swing was free distance - which
is the same free lunch a 2026-09-06 session measured at *"+16.3 yards for NOTHING"*. It closed that
with the random spray; the spray is gone (see the section above), so it is closed with the distance
instead. The return now diminishes from **100 %**, and `BLOCK_KEEPS_DIST` is 0.372:

| Power | Carry | Total |
|---|---|---|
| 100 % | 215.0 | 232.2 |
| 107.6 % (block edge) | 221.1 | 238.8 |
| 120.6 % (top of arc) | 231.5 | **250.0** |

**It is a multiplier, not a cap.** Nothing clamps a distance anywhere; every club keeps its own
ladder and the same curve applies to all of them, which is what Matt's parenthesis was about.
`BLOCK_FROM` still marks where the meter draws its orange and red block - that is a DRAWING, and the
distance curve no longer keys off it.

**And the answer to "what is the most offline a shot could be?": 45.4 yards.** Swept over every
power and every needle stop: the worst possible driver shot is a full red miss at the top of the arc
(16.0 deg), carrying 139 and finishing 155 from the tee. At a clean 100 % the worst is 20.9 yds
offline. The 12 fewer yards of carry did NOT move Oasis Sands hole 4, which still measures -0.75.
