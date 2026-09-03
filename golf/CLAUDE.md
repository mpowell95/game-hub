# Golf — CLAUDE.md

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file. Rules 4 and 5 do real work in this game: see "Stored shape" below.

## Status: BEING REBUILT (Stage A complete, 2026-09-03)

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
| — | The hole-data format, written down before anything is built against it | next |
| B | Core loop: tilemap, ball + shadow, HUD, aim ladder, clubs, meters, three-tap, flight | not started |
| C | Lies, hazards and drops, putting with break, result banner, scorecard, preview scroll | not started |
| D | Stats wiring, strings EN/ES, this file, `sw.js`, the test suites, release | not started |

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
- **Course keys are frozen the moment one round is recorded.** `pinevalley3` today.
  `pinevalley9` when holes 4-9 ship. **They are never merged and never compared** - a 3-hole best
  and a 9-hole best are not the same measurement (rule 4) - and `pinevalley3` is never repurposed
  into the 9-hole key (rule 5). Every screen that shows one names which it is showing.

**Queued for Stage D (Matt, 2026-09-03):** My Stats' "Best rounds" table shows raw STROKES while
the leaderboard shows the same round as a score to par. Make My Stats show to-par too, so the two
screens agree, and keep lifetime points as its separate "Skill level" line. Not done yet.

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
