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

## 1 · The unit — `unit.holes`

```
X = boardW / 6.875        // 0.145455 on THE CLASSIC
```

`boardW` is the anchor. Change it and every other measurement moves with it.

Write `u`, `v`, `r` and `ringD` as `X * n`. A raw metre value stops the layout scaling when the
board is resized. `0` is fine for a centred `u`.

```js
c50: { u: 0, v: X * 7.1875, r: X * 0.5, value: 50, ringD: X * 1.4375 },
```

## 2 · Ball — `ball.ratio`

| | |
|---|---|
| `ballR` | `0.350X` |
| `ballMass` | `0.18` |

Size the machine, not the ball.

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

Re-run `node sight.mjs` after changing the ramp, the cabinet or the camera.

## 6 · Trough — `trough.dims`

| | |
|---|---|
| `troughLen` | `1.5469X` |
| `troughDepth` | `1.0313X` |

The trough scores `0`. `troughTenHalfW` does nothing; leave it alone.

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

Power is not capped. Under `0` falls short of the board; over `1` climbs the backboard and leaves
the machine.

Aim turns the launch without changing its speed:

```
a = clamp(aim, −1, 1) × aimMax
v = (sin(a) × speed, 0, −cos(a) × speed)
```

`minSpeed` under `maxSpeed`. `aimMax` between `0.30` and `0.60`, wide enough to hit a side wall on
purpose. A comfortable flick must land in the middle of the speed range — never set `minSpeed` and
`maxSpeed` to the nearest and furthest holes.

Swipe reading lives in `js/swipe.js` and is shared by every machine: `SWIPE_SLOW 0.65`,
`SWIPE_FAST 4.20`, `MIN_UP_PX 20`. Speed is the whole gesture's 2-D distance over time.

## 9 · Scoring a ball

A ball drops in when it is inside `r − ballR × 0.28` of a hole centre and slow enough for the
mouth still in front of it:

```
cross = rEff + sqrt(rEff² − d²)
drops in if  vFace × captureDrop ≤ cross
```

`captureDrop` is `0.35`.

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

A hole is `{ u, v, r, value, ringD }`, plus `ringOpen: true` if its ring is an arc.

`u` runs across the face: `0` at the centre, `±boardW/2` at the edges.
`v` runs up the face: `0` at the bottom edge, `boardLen` at the top.

- Every hole is the same size: `r = holeR = 0.500X`. — `holes.uniform`
- Every hole centre sits at least `holeR` from all four edges. — `holes.inside`
- Hole centres sit at least `1.30X` apart. — `holes.spacing`
- A hole id that has shipped is frozen. Never delete one, never change its `value` — the ids are
  written into saved games. To retire a hole, leave it where it is. — `holes.frozen`

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

`geom.ringSegments` is read by nothing. Do not set it.

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

## 13 · Painting the numbers

Numbers are painted wrapped around a ring wall, not flat on the board. Two positions exist:

- **Top of a ring** — the number curves over the ring's upper outside.
- **Bottom of a ring** — the number curves under the ring's lower outside.

Which ring carries which number is worked out automatically:

- For holes in the centre column, a hole's number goes on the **bottom of the ring above it**.
- The **topmost** hole in the column is the exception: its number goes on the **top of its own
  ring**.
- A hole off the centre line carries its own number on the **bottom of its own ring**.
- If a number is too wide to wrap around the ring it was given, it becomes a free-standing plate
  on the board instead. This happens on its own.

That is only the default. If Matt says where a number goes, it goes there — add the override to
the hole and build it. No override exists in the code today, so the first time he asks, you are
building it as well as using it.

---

# PART 3 — OBJECTIVES

**Every machine has its own objectives.** They are what unlocks the next machine, and Matt sets
them per board — never assume the previous machine's.

The fireworks and the tiles that show progress are shared by every machine. Only the objectives
themselves change. Colours of the tiles may change with the machine.

THE CLASSIC's, as an example of the shape: land five 100s, score 360 in a single game, score
10,000 points in total.

**The code does not support this yet.** `skeeball/js/goals.js` holds one global set of three,
hardcoded, with no board attached. Per-machine objectives have to be built before a second machine
can have its own.

---

# PART 4 — COLOUR — `look.complete`

All twenty keys, all `#rrggbb`.

| key | paints |
|---|---|
| `wood`, `woodDark` | lane bed |
| `cabinet`, `cabinetEdge` | side panels |
| `face`, `faceEdge` | the scoring face |
| `ring`, `ringLip` | ring wall, ring lip |
| `value`, `pocket` | painted numbers, hole interior |
| `marquee`, `marqueeText`, `bulb` | the header sign |
| `glow` | score and effects |
| `wall` | the room behind the machine |
| `net` | ball return |

---

# PART 5 — WIRING IT IN

## 14 · The board entry — `entry.complete`

```js
{
  id: 'frozen-slug',                        // never reused, never changed
  name: 'THE NAME',                         // proper noun, untranslated
  taglineKey: 'board_<id>_tag',             // + en and es strings
  unlock: { board: '<previous id>', score: N },
  look: { ... },                            // Part 4
  geom: { ... },                            // Parts 1 and 2
}
```

`unlock` is `null` only on the first machine.

## 15 · The hub tile

```bash
node gen-skeeball-tile.mjs
```

Regenerate it after adding a board. The tile is drawn from `boards.js`, never by hand.

## 16 · The setup screen

The picture of the machine on the setup screen is rendered from the board itself. A new machine
gets one with no extra work.

With more than one machine, the setup screen becomes a swipeable carousel: dots, arrows and a
side-swipe between machines. That code switches on by itself at two machines and **has never run
with more than one**. Check the dots, the arrows and the swipe by hand.

## 17 · A locked machine

A machine that has not been unlocked yet shows a locked slide instead of the normal one: the
machine greyed out behind a large lock, with only a sliver of the board visible — enough to make
the player curious, not enough to show what it is.

**This does not exist yet and has to be built.**

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

`skeeball/js/test.js` throws thousands of balls at every board in the list, so a new machine is
covered the moment it exists. It checks every hole can actually be scored, which depends on the
whole layout — re-run it after moving any hole.

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
