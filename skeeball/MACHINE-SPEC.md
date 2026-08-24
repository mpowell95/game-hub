# Building a Skeeball machine

Every machine is a copy of THE CLASSIC with a different board face, its own objectives, and its
own colours.

**Part 1** is fixed. Copy those values exactly.
**Part 2** is the board face. Different every time.
**Part 3** is objectives. Different every time.
**Part 4** is colour. Different every time.
**Part 5** is wiring it in and checking it.

Rule ids in headings are the ids `test-skeeball-machine-spec.mjs` reports and the keys a waiver
uses. Waivers are section 20.

---

# PART 1 — THE MACHINE

Identical on every machine. Copy it.

**The tables below are written as X-multiples; `boards.js` writes most of them as raw metres**
(`bedThick: 0.06`, `humpLen: 0.42`, `boardLen: 1.3818`, and so on). The two are equivalent — every
multiple in Part 1 converts to the metre in the file — and writing `X * n` instead is equally fine.
Outside the holes there is no rule either way. Inside them there is: see section 1.

## 1 · The unit — `unit.holes`

```js
const X = 1.00 / 6.875;   // boardW / 6.875 = 0.1454545… m on THE CLASSIC
```

`boardW` is the anchor, and on THE CLASSIC it is **`1.00` metre** — the one raw number the machine
hangs off. Change it and every other measurement moves with it.

Only the holes' `u`, `v`, `r` and `ringD` are REQUIRED to be `X * n`; that is what `unit.holes`
checks. A raw metre there stops the layout scaling when the board is resized. `0` is fine for a
centred `u`.

```js
c50: { u: 0, v: X * 7.1875, r: X * 0.5, value: 50, ringD: X * 1.4375 },
```

## 2 · Ball — `ball.ratio`

| | |
|---|---|
| `ballR` | `0.350X` |
| `ballMass` | `0.18` |

Size the machine, not the ball. The one shipped exception is POPONGO's ping-pong ball
(`0.28X`, under a `ball.ratio` waiver Matt asked for by name): its real game's cup-to-ball
ratio was unreachable any other way, because a 3-across cup row caps cup size against the
rails. A waiver, not a precedent — the next machine starts at `0.350X`.

## 3 · Cabinet — `board.dims`

| | |
|---|---|
| `boardW` | `6.875X` |
| `boardLen` | `9.500X` |
| `boardTilt` | `45°` (`0.7854` rad) |
| `boardLipY` | `2.8875X` |
| `backboardH` | `5.500X` |
| `railH` | `0.6875X` |

Allowed: tilt `40°`–`50°`, `boardLen` `8.5X`–`10.5X`.

## 4 · Lane — `lane.dims`

| | |
|---|---|
| `laneLen` | `9.625X` |
| `laneW` | `4.875X` |
| `bedThick` | `0.4125X` |
| `laneRailH` | `0.34375X` |

`laneW` must be narrower than `boardW`.

## 5 · Ramp — `ramp.angles`

| | |
|---|---|
| `humpLen` | `2.8875X` |
| `humpAngles` | `10.7°, 21.3°, 32.0°, 42.7°, 53.3°, 64.0°` |

Six segments, each steeper than the last. The final one is the launch angle: allowed `55°`–`70°`.

**Those degrees are rounded. Copy the radians, not the degrees:**

```js
humpAngles: [0.1862, 0.3723, 0.5585, 0.7447, 0.9308, 1.117],
```

Converting the rounded degrees back does not reproduce them — `10.7°` is `0.18675` rad, and the
file says `0.1862`.

Re-run `node sight.mjs` after changing the ramp, the cabinet or the camera.

## 6 · Trough — `trough.dims`

| | |
|---|---|
| `troughLen` | `1.5469X` |
| `troughDepth` | `1.0313X` |

The trough scores `0`.

`troughTenHalfW` is read by nothing. THE CLASSIC keeps its `0.26` because old saved racks
reference it (THE LAW rule 5 — old keys are never deleted). **A new machine omits it entirely.**

## 7 · Bounce and grip — `mat.single`, `mat.complete`

Write exactly one `mat` block. If two appear side by side, JavaScript keeps only the last one and
throws the other away without saying so. Every value in the first stops working and nothing
reports it.

| surface | `fric` | `rest` | what it covers |
|---|---|---|---|
| `board` | `0.62` | `0.08` | the scoring face, the trough |
| `wood` | `0.30` | `0.22` | lane bed, ramp |
| `wall` | `0.04` | `0.42` | side rails, ramp rails, trough end face, the flare |
| `ring` | `0.06` | `0.18` | rings and cup collars, 10 through 50 |
| `ring100` | `0.06` | `0.18` | the two corner rings |
| `dead` | `0.24` | `0.10` | backboard, kicker, containment walls |

`fric` is grip: 0 slides, 1 grabs. Allowed `0`–`1`.
`rest` is bounce: 0 is dead, 1 returns as fast as it arrived. Allowed `0`–`0.6`.

Always write `ring100Fric` and `ring100Rest`. Leave them out and the corner rings do not fall back
to `ringFric` / `ringRest` — they use the built-in defaults in `physics.js` instead.

## 8 · Throwing — `throw.range`

| | |
|---|---|
| `minSpeed` | `2.60` m/s |
| `maxSpeed` | `6.60` m/s |
| `aimMax` | `0.45` rad |

Power is spent as energy, not speed:

```
speed = sqrt(minSpeed² + power × (maxSpeed² − minSpeed²))
```

Power has no upper bound, but it is floored at `−0.75` (`physics.js` `startThrow`), so the square
root always has something to work with. Under `0` falls short of the board; over `1` climbs the
backboard and leaves the machine.

Aim turns the launch without changing its speed:

```
a = clamp(aim, −1, 1) × aimMax
v = (sin(a) × speed, 0, −cos(a) × speed)
```

`minSpeed` under `maxSpeed`. `aimMax` between `0.30` and `0.60`, wide enough to hit a side wall on
purpose. A comfortable flick must land in the middle of the speed range — never set `minSpeed` and
`maxSpeed` to the nearest and furthest holes.

Swipe reading lives in `js/swipe.js` and is shared by every machine: `SWIPE_SLOW 0.65`,
`SWIPE_FAST 4.20`, `MIN_UP_PX 20`.

Speed is **the faster of two readings**, not one (`swipeSpeed()`):

- the **release window** — the first sample within `200 ms` of the end, to the end, as 2-D
  distance over elapsed time. Discarded (counted as `0`) if that window finished DOWNWARD.
- the **whole gesture** — first sample to last, the same way.

`max` of the two, then divided by `max(320, windowH)` so a phone and a desktop feel alike. A
gesture that did not travel at least `MIN_UP_PX` upward overall is not a swipe at all and reads
as nothing.

## 9 · Scoring a ball

Capture is only tested when the ball is AT FACE LEVEL and on the board: `h < ballR × 1.9`, and
`v` between `0` and `boardLen`. Off the face, nothing can be scored.

There it is a kinematic question, never a "centre over the hole" one: **in the time this ball
takes to cross the mouth, does it fall far enough to be past the lip?**

```
rEff  = hole.r − ballR × 0.28        the mouth, shrunk by the ball's own width
d     = distance from the ball to the hole centre     (no capture unless d < rEff)
cross = rEff + sqrt(rEff² − d²)      how much mouth is left in front of it, along its own line

vFace = the ball's speed ACROSS the face
hDot  = the ball's speed INTO the face   (+ away from it, − into it)
gPerp = 9.82 × cos(boardTilt)        gravity's pull perpendicular to the face
need  = ballR × captureDrop          how far it must drop to count as fallen IN

tDrop = (hDot + sqrt(hDot² + 2 × gPerp × need)) / gPerp

drops in if  vFace × tDrop ≤ cross
```

Two things follow, and they are the whole feel of the machine:

- **`captureDrop` sets a DISTANCE, not a time** — a fraction of the ball's radius. Bigger means
  further to fall, which means harder to fall in. It is the ladder's master knob.
- **The ball's own speed into the face counts.** `hDot` is in `tDrop`, so a ball arriving out of
  the air drops in at speeds a rolling ball skims straight across at. That is what makes distance
  up the slope choose the cup, instead of the first mouth a roll reaches swallowing everything.
- **On a COLLARED hole, "past the lip" means below the RIM plane**, not the face plane: when the
  hole has a `collarH`, `need` grows by `max(0, h − collarH)` (the `needH` term in `physics.js`),
  so a fast ball clipping across a cup's mouth is not scored for what would really be a far-rim
  bounce. Flush holes keep the numbers above exactly. Same honesty in the emergencies: on a cup
  board a jammed or capped ball resolves as the trough's zero — the watchdog never walks a ball
  into a mouth there.

`geom.captureDrop` is `0.35` on THE CLASSIC. **Write it on every machine.** Leave it out and
`physics.js` silently falls back to `0.55` — a much harder machine — and no test catches it.

- A ball that stops on the face without dropping in is not scored. It rolls back to the trough and
  takes the trough's `0`.
- A ball that comes back down the ramp is not spent. Give it back, however hard it was thrown.
- Never steer a ball toward a hole. If a hole is too hard to hit, widen the geometry.
- Nothing spans the top of the machine. No ceiling, no canopy, no pane. A ball thrown hard enough
  leaves, comes down, and scores what it earns.

## 10 · The back wall

The four records — all-time, your best, today, last game — are painted on the back wall
automatically, the same on every machine. Do not build them.

---

# PART 2 — THE BOARD FACE

Matt decides how many holes, what they pay, and where they go. These are the rules for building
whatever he asks for.

## 11 · Where a hole can go — `holes.uniform`, `holes.inside`, `holes.spacing`, `holes.frozen`

A hole is `{ u, v, r, value, ringD }`, plus `ringOpen: true` if its ring is an arc. On a CUP
BOARD (see "The arrangement layer" below) a hole is `{ u, v, r, collarH }` instead — no `ringD`,
and no written `value`, because the value comes from the cup sitting in the slot.

`u` runs across the face: `0` at the centre, `±boardW/2` at the edges.
`v` runs up the face: `0` at the bottom edge, `boardLen` at the top.

- **NEVER CHANGE THE WIDTH OR DIAMETER OF A BASKET UNLESS MATT SPECIFICALLY TELLS YOU TO** (his
  rule, 2026-08-24, in those words). `r` is his number on every machine. Depth, position and paint
  are ordinary work; the mouth is not. See `skeeball/CLAUDE.md`'s hard rule.
- Every hole is the same size: `r = holeR = 0.500X`. — `holes.uniform`
- Every hole centre sits at least `holeR` from all four edges. — `holes.inside`
- Hole centres sit at least `1.30X` apart. — `holes.spacing`
- A hole id that has shipped is frozen. Never delete one, never change its `value` — the ids are
  written into saved games. To retire a hole, leave it where it is. — `holes.frozen`

**A value may be NEGATIVE.** BRICK CITY's bottom row pays `-20 / -10 / -20`; the rule above tests
that a hole HAS a value, not that the value is positive. Two consequences, both already handled,
so a second penalty machine needs no new code: `game.js` floors the rack score at 0 after every
ball (a rack can be eaten back to zero, never below it — which is what keeps the number on screen
and the number `recordSkeeball` files the same number), and `ui.js`'s landing popup prints the
sign (`signedValue`, a real minus). `game.js`'s `by(10)`/`by(20)`/`by(30)`/`by(40)` counters match
exact values, so penalty balls are counted by nothing — deliberate; those counters count points
earned. A machine that wants "penalties taken" gets its own counter and item 7's three edits.

### The arrangement layer — cup boards (POPONGO's pattern)

A machine whose scoring furniture is movable in real life (POPONGO's nine identical cups) splits
the face into two layers, both on the board entry:

- `geom.holes` — the SLOTS. Named for POSITION (`top`, `midL`, `bot`, …), each `{ u, v, r,
  collarH }`. Slots own all geometry; their ids are frozen (they ride the autosave).
- `cups` + `arrangement` — the CUPS (`{ value, color, ink, label, effect? }`, ids like `g6`,
  `eqA`; values frozen per cup id) and which cup sits in which slot.

Hole values are STAMPED from the arrangement by the loop at the bottom of `boards.js`; never
write a `value` on a cup-board hole by hand — it would be overwritten. `game.js` scores through
`cupAt()`, and the renderer paints each collar in its cup's `color` with the `label` on an arc
inside the cup's far wall. All automatic; nothing to build per machine.

`effect: 'equalizer'` on a cup makes landing there wipe the points the previous ball earned this
rack (`game.js`; the popup shows `−N`). It is the only cup effect that exists.

Player-facing rearrangement is deferred on purpose. When Matt asks for it, it is a game-level
remap over these same slots plus a screen — never a geometry or physics change, because every
cup is the same shape. What custom layouts do to records and unlocks is his call at that point.

### The tangency stack — what binds, and what is just THE CLASSIC

`boards.js` names three tangency rules. Only the first one binds a new machine.

1. **Every ring touches its own hole at one point, the hole's bottom.** This binds every board and
   cannot be broken, because no board states a ring centre: `machine.js` derives it from the hole
   (section 12). There is nothing to get wrong.
2. **The 30 ring's top touches the 40 ring's bottom.**
3. **The 40 ring's top, the 50 ring's bottom and the 20 ring's top meet at one point.**

Rules 2 and 3 are **THE CLASSIC's own stack, not a constraint on your machine.** They hold exactly
on it — both touches land on `5.125X` and `6.6875X` respectively — because its centre column is
spaced `h(n+1) = h(n) + ringD(n)`, which makes hole spacing a consequence of ring diameters rather
than a free number.

**Nothing tests rules 2 or 3.** There is no tangency assertion in `skeeball/js/test.js`,
`test-skeeball-machine-spec.mjs` or `test-skeeball-rings.mjs`. (`boards.js`'s header says
`skeeball/js/test.js` asserts all three. It does not.) So a new machine may space its column
however Matt asks, and nothing will object — and equally, nothing is guarding THE CLASSIC's stack
from drifting if someone edits a diameter without moving the holes above it.

## 12 · Building a ring — `rings.derived`, `rings.clipped`

| | |
|---|---|
| `ringH` | `1.000X` |
| `ringThick` | `0.1031X` |
| `collarThick` | `0.0825X` |
| `cupSegments` | `14` |
| `lipLowFrac` | `0.5` |

`ringD` is the ring's inside diameter — the clear opening. Not the outer edge, not the middle of
the wall.

A ring is never centred on its hole. It touches the hole at the hole's lowest point, so the ring
sits up-slope:

```
R  = ringD / 2
cu = hole.u
cv = hole.v − hole.r + R
```

That is the only placement rule. Never position a ring by hand.

Segment count comes from the size, not from you:

```
Rwall = ringD / 2 + ringThick / 2
N     = max(20, ceil(2 × PI × Rwall / 0.04))
```

`geom.ringSegments` is read by nothing. Do not set it. THE CLASSIC carries a vestigial
`ringSegments: 24` — harmless, unread, and kept where it is; do not copy it into a new machine.

### Cups, collars and lips

Three of the numbers in the table are for CUPS, not rings, and do nothing on a flush board.

A ring is a wall up-slope of its hole. A **collar** is a wall standing on the hole itself:
`cupSegments` boxes, `collarThick` thick, in a circle right at the hole's edge and concentric
with it. A hole gets one only by asking: set `collarH` (the wall's height) on the hole. No hole
on THE CLASSIC sets it; every hole on POPONGO does (`X * 0.35` — measured: at `X * 0.5` its two
upper-diagonal slots were unreachable at every cell of the sweep).

- `collarThick` — the collar wall's thickness, `ringThick`'s counterpart.
- `cupSegments` — how many boxes a collar is built from. Fixed, unlike a ring's derived count,
  because every collar is hole-sized. Raise it only if a collar reads visibly faceted.
- `lipLowFrac` — the shape of a TILTED collar. Give the hole `lipLow: true` and its down-slope
  lip drops to `lipLowFrac × collarH` while the up-slope lip keeps full height, blending around
  the circle: a rolling ball rides in over the low front, an overshoot is caught by the tall
  back. Lower means easier entry from below. Without `lipLow` on the hole, the collar is a
  level rim and this number does nothing.

render.js draws the same height profile the physics boxes use, vertex for vertex
(`_scallopedRim`), so the rim you see is the rim the ball hits.

### Rings that cross each other

Rings may overlap. A big low ring passes straight through the ones above it — they are separate
walls and a ball meets whichever it reaches first. Never shrink a ring to avoid a neighbour.

If a ring is wide enough to close over a hole further up the board, give it `ringOpen: true`. That
keeps only the half below its own centre, so it reads as an arc across the bottom.

### Rings near the edge

`machine.js` deletes any wall segment falling outside the face.

- A ring without `ringOpen` must lose no segments. If it loses any, it is too wide for where its
  hole sits: move the hole inward or reduce `ringD`. — `rings.clipped`
- A ring with `ringOpen` may lose segments at the edges.

Count them:

```js
M.solids.filter(s => s.part === 'ringSeg' && s.ring === id).length
```

### Holes in the corners

A corner hole is reached by banking off the side wall, so its ring sits close to the edge. Keep
`ringD` small enough that no segment is deleted, and re-check after every move. A corner ring is
usually the tightest on the board.

### Never build a right-angled pocket

Three flat surfaces meeting at right angles, anywhere a ball can reach, will trap it. The physics
cannot push it back out. Angle one of the three, or leave a gap.

### A collar near a flat wall is a pocket even at zero gap

Merging furniture into a rail is legal for RING SEGMENTS (THE CLASSIC's corner 100s). It is NOT
legal for a collar: a curved collar wall and a flat rail converge gradually, so the pinch where
their gap is narrower than the ball extends far from the touch point, and a ball entering it
three-contact-locks the solver. Measured on POPONGO's first draft: 12% of ALL throws ended in
the watchdog's walkout, every one wedged there. Keep every collar at least a ball plus margin
(`0.78X` wall gap) off the rails — and off every other collar. See
DECISIONS.md#popongo-layout.

## 13 · Painting the numbers

Numbers are painted wrapped around a ring wall, not flat on the board. Two positions exist:

- **Bottom of a ring** — the number curves under the ring's lower OUTSIDE, facing the player.
- **Top of a ring** — the number is painted on the INSIDE of the ring's far wall, read through the
  ring's own mouth. Not over the outside of it.

Which ring carries which number is worked out automatically:

- For holes in the centre column, a hole's number goes on the **bottom of the ring above it**.
- The **topmost** hole in the column is the exception: its number goes on the **top of its own
  ring** — which is why that one is read through the mouth. Its ring is last in the stack, so
  nothing stands in front of its far wall.
- A hole off the centre line carries its own number on the **bottom of its own ring**.
- **The concave-arc fallback**, for a number that would wrap too far to read. A ring's outer wall
  curves away from the player at its edges, so past about `65°` of wrap a digit turns edge-on and
  disappears behind the ring's own silhouette. When the estimated wrap exceeds that, the number
  is not painted on the wall at all: it gets a short arc of its own, **concentric with that same
  ring, the same height as it, set `0.030` m in from the wall's centreline**, concave toward the
  player and spanning `±62°`. Cosmetic only, no physics body. This happens by itself; nothing to
  configure.

  **The fallback only ever applies to centre-column holes below the top one** — those are the only
  ones whose number is painted on somebody else's ring. An off-centre hole's number stays on its
  own ring's bottom however wide it is, and the topmost hole never needs the fallback because its
  far wall is free.

That is only the default. If Matt says where a number goes, it goes there — add the override to
the hole and build it. No override exists in the code today, so the first time he asks, you are
building it as well as using it.

---

# PART 3 — OBJECTIVES

**Every machine has its own objectives.** They are what unlocks the next machine, and Matt sets
them per board — never assume the previous machine's.

**Objectives are completely distinct per machine** (Matt, 2026-08-22): a machine's goals count
only THAT machine's plays. Score goals read the machine's own `sk.boards.<id>` record, never the
lifetime-global `sk` fields, which blend every machine.

The fireworks and the tiles that show progress are shared by every machine. Only the objectives
themselves change. Colours of the tiles may change with the machine.

THE CLASSIC's: land five 100s, score 360 in a single game, score 10,000 points in total.
POPONGO's: land all four cup colors in one game, score 30+ in a single game, 1,000 points in
total on the machine.

Per-machine objectives are supported (2026-08-22): add the machine's three to the `GOALS` map in
`skeeball/js/goals.js` — each goal carries a `labelKey` into `strings.js`, and the rails, the
game-over tiles and the fireworks are board-generic from there. A goal that needs a counter the
store does not keep yet (POPONGO's color sweep needed `sk.colorSweeps`) means the root
checklist's three-edit rule: `ensureSk`/`recordSkeeball` in `js/game-stats.js`, the sk branch in
`js/players-agg.js`, and a case in `players-agg.test.mjs` — miss the agg branch and the counter
zeroes the moment a second device syncs.

---

# PART 4 — COLOUR — `look.complete`

All sixteen keys, all `#rrggbb`. `look.complete` fails on any that is missing or malformed.

| key | paints |
|---|---|
| `wood`, `woodDark` | lane bed |
| `cabinet`, `cabinetEdge` | side panels |
| `face`, `faceEdge` | the scoring face |
| `ring`, `ringLip` | ring wall, ring lip |
| `value`, `pocket` | painted numbers, hole interior |
| `marquee`, `marqueeText`, `bulb` | the header sign |
| `wall` | the room behind the machine |
| `glow` | **nothing today** — required, but read by nothing in `skeeball/js` |
| `net` | **nothing today** — required, but read by nothing in `skeeball/js` |

`glow` and `net` still have to be there and still have to be valid hex: the rule checks all
sixteen. Give them sensible colours for the machine anyway, in case something starts reading them.

---

# PART 5 — WIRING IT IN

## 14 · The board entry — `entry.complete`

```js
{
  id: 'frozen-slug',                        // never reused, never changed
  name: 'THE NAME',                         // proper noun, untranslated
  taglineKey: 'board_<id>_tag',             // + en and es strings
  unlock: { board: '<previous id>', score: N },   // or { board: '<previous id>', goals: true }
  look: { ... },                            // Part 4
  geom: { ... },                            // Parts 1 and 2
  cups: { ... }, arrangement: { ... },      // cup boards only - see Part 2's arrangement layer
}
```

`unlock` is `null` only on the first machine. Two unlock shapes exist and `entry.complete`
accepts both: `{ board, score }` — reach that score in one game on that board — and
`{ board, goals: true }` — complete all three of that board's Part 3 objectives (POPONGO's
shape). The goals form is applied by `ui.js` (`_earnedUnlocks` after every recorded rack,
`_ensureGoalUnlocks` once per mount so goals completed earlier or on another device still open
it); `unlocksEarned()` in `boards.js` handles only score unlocks.

## 15 · The hub tile

```bash
node gen-skeeball-tile.mjs
```

Regenerate it after adding a board. The tile is drawn from `boards.js`, never by hand.

## 16 · The setup screen

The picture of the machine on the setup screen is rendered from the board itself. A new machine
gets one with no extra work.

With more than one machine, the setup screen becomes a swipeable carousel: dots, arrows and a
side-swipe between machines. It switched on for real when POPONGO landed (2026-08-22). Still
check the dots, the arrows and the swipe by hand after adding a machine.

## 17 · A locked machine

A machine that has not been unlocked yet shows a locked slide instead of the normal one: the
machine greyed out behind a large lock, with only a sliver of the board visible — enough to make
the player curious, not enough to show what it is.

Built (2026-08-22): the sliver is the machine's real render, cropped, greyed and blurred by
`.sk-lock-peek` in `skeeball.css` — how much it teases is that window's height and blur, nothing
in JS. The hint line under the lock states the unlock in words (score or goals, per section 14).

## 18 · Testing a board's shape

Give any test board a **new `id`**. Reuse an existing one and the engine hands back the old shape
from memory without saying so, and every number measured is wrong.

## 19 · Checks

Run all four.

```bash
node skeeball/js/test.js --full
node test-skeeball-machine-spec.mjs
node test-skeeball-rings.mjs
node test-game-conventions.mjs
```

`skeeball/js/test.js`'s cheap half (rules, snapshots, unlock chain, the recorder payload) runs
over every board, so a new machine's DATA is covered the moment it exists — but its heavy
physics groups (`--reach`, `--dial`, …) throw at `DEFAULT_BOARD` only. **A new board's
reachability is NOT tested automatically: sweep it yourself** — run `simulateThrow` over the
aim × power grid and require every hole capturable with zero `emergencyUsed` (POPONGO's build
used exactly this; DECISIONS.md#popongo-layout has the numbers a failing sweep produces).
Re-run after moving any hole: reachability is a property of the whole layout.

## 20 · Breaking a rule

You may only break a rule when Matt has told you to, for that machine. A deliberately bouncy
machine, or a rolling one instead of a bouncing one — his call, made in advance. Never your own
judgement during a build.

Record it in the board entry, keyed by rule id, naming the rule and the reason:

```js
specWaivers: {
  'mat.complete': 'Matt asked for a deliberately bouncy machine, 2026-08-22. wallRest 0.55, above '
    + 'the 0.6 ceiling on nothing else. Sweep re-run: every hole still scores.',
},
```

| you did this | what happens |
|---|---|
| broke a rule, wrote no waiver | the test stops you |
| broke a rule, wrote a proper waiver | allowed, and the reason is printed |
| wrote a waiver for a rule you did not break | the test stops you — delete it |
| wrote a reason under 40 characters | the test stops you — say why properly |

Waivers print at the end of the run under `RULES BROKEN ON THIS MACHINE`.

Copy that block into the pull request and into your message to Matt — the rule you broke and why.
