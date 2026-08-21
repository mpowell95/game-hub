# Skeeball machine spec

Every rule here is checked by `test-skeeball-machine-spec.mjs`, against **every** board in
`BOARDS`. Rule ids in headings are the ids the test reports and the keys a waiver uses.

To break a rule, see **Waivers** at the bottom. There is no other way.

---

## 1 · The unit — `unit.holes`

```
X = boardW / 6.875        // 0.145455 on THE CLASSIC
```

`boardW` is the anchor. Change it and `X` changes with it.

**Every `u`, `v`, `r` and `ringD` must be written as `X * n`** — never a raw metre value, or
the layout stops scaling when the board is resized. `0` is allowed for a centred `u`.

```js
c50: { u: 0, v: X * 7.1875, r: X * 0.5, value: 50, ringD: X * 1.4375 },
```

Everything else in `geom` may be written either way. Prefer `X` for anything that should move
when the board is resized; a raw value is fine for anything that should not.

---

## 2 · Ball — `ball.ratio`

| | |
|---|---|
| `ballR` | `0.350X` |
| `ballMass` | `0.18` |

`ballR` is fixed at `0.350X`. Size the machine, not the ball.

---

## 3 · Board — `board.dims`

| | |
|---|---|
| `boardW` | `6.875X` |
| `boardLen` | `9.500X` |
| `boardTilt` | `45°` (`0.7854` rad) |
| `boardLipY` | `2.8875X` |
| `backboardH` | `5.500X` |
| `railH` | `0.6875X` |

`boardW` defines `X`. Change `boardW` and every other value moves with it.

Tilt range: `40°`–`50°`. `boardLen` range: `8.5X`–`10.5X`.

---

## 4 · Lane — `lane.dims`

| | |
|---|---|
| `laneLen` | `9.625X` |
| `laneW` | `4.875X` |
| `bedThick` | `0.4125X` |
| `laneRailH` | `0.34375X` |

`laneW` must be less than `boardW`.

---

## 5 · Ramp — `ramp.angles`

| | |
|---|---|
| `humpLen` | `2.8875X` |
| `humpAngles` | `10.7°, 21.3°, 32.0°, 42.7°, 53.3°, 64.0°` |

Six segments. Strictly increasing. The last is the launch angle.

Launch angle range: `55°`–`70°`. Re-run `sight.mjs` after changing `humpLen`, the board, or the
camera.

---

## 6 · Trough — `trough.dims`

| | |
|---|---|
| `troughLen` | `1.5469X` |
| `troughDepth` | `1.0313X` |

The trough scores `0`. `troughTenHalfW` is retired — keep it, it does nothing.

---

## 7 · Holes — `holes.uniform`, `holes.inside`, `holes.spacing`, `holes.frozen`

Every hole: `{ u, v, r, value, ringD }`, plus `ringOpen: true` where the ring is an arc.

| id | `u` | `v` | `ringD` | value |
|---|---|---|---|---|
| `100L` | `-2.750X` | `8.750X` | `1.1900X` | 100 |
| `100R` | `2.750X` | `8.750X` | `1.1900X` | 100 |
| `c50` | `0` | `7.188X` | `1.4375X` | 50 |
| `c40` | `0` | `5.625X` | `1.5625X` | 40 |
| `c30` | `0` | `3.813X` | `1.8125X` | 30 |
| `h20` | `0` | `2.313X` | `4.8750X` | 20 |
| `h10` | `0` | `1.000X` | `7.1250X` | 10, `ringOpen` |

`u` is across the face, `0` at centre, range `±boardW/2`. `v` is up the face, `0` at the bottom
edge, `boardLen` at the top.

**Rules:**

- Every hole has `r = holeR = 0.500X`. No exceptions. — `holes.uniform`
- Every hole centre sits at least `holeR` from all four face edges. — `holes.inside`
- Neighbouring hole centres sit at least `1.30X` apart. — `holes.spacing`
- A hole id that has shipped is frozen. Never remove one, never change its `value`. Ids are
  written into `gamehub.skeeball.save.v1`. Retire by leaving it in place. — `holes.frozen`

---

## 8 · Rings — `rings.derived`, `rings.clipped`

| | |
|---|---|
| `ringH` | `1.000X` |
| `ringThick` | `0.1031X` |
| `collarThick` | `0.0825X` |
| `cupSegments` | `14` |
| `lipLowFrac` | `0.5` |
| `captureDrop` | `0.35` |

**`ringD` is the ring's INSIDE diameter** — the clear opening. Not the outer edge, not the
centreline.

**A ring is never concentric with its hole.** It is tangent at the hole's bottom:

```
R  = ringD / 2                 // inner radius
cu = hole.u                    // same across the face
cv = hole.v - hole.r + R       // centre sits (R - r) up-slope
```

This is the only placement rule. Do not hand-place a ring.

Segment count is computed, not configured:

```
Rwall = ringD / 2 + ringThick / 2
N     = max(20, ceil(2 * PI * Rwall / 0.04))
```

`geom.ringSegments` is **dead** — nothing reads it. Do not set it.

`machine.js` drops any segment falling outside the face.

- A ring without `ringOpen` must lose **zero** segments. — `rings.clipped`
- A ring with `ringOpen` keeps only the half below its centre, and may lose more at the edges.

Count them:

```js
M.solids.filter(s => s.part === 'ringSeg' && s.ring === id).length
```

Baseline on THE CLASSIC: `100L` 20, `100R` 20, `c50` 20, `c40` 20, `c30` 22, `h20` 57, `h10` 33.

---

## 9 · Materials — `mat.complete`

All ten keys required.

| pair | fric | rest | governs |
|---|---|---|---|
| `board` | `0.62` | `0.08` | the scoring face |
| `wood` | `0.30` | `0.22` | lane bed, ramp |
| `wall` | `0.04` | `0.42` | side rails, backboard |
| `ring` | `0.06` | `0.18` | ring walls, cup collars |
| `dead` | `0.24` | `0.10` | trough, corner rings |

Friction range `0`–`1`. Restitution range `0`–`0.6`.

---

## 10 · Throwing — `throw.range`

| | |
|---|---|
| `minSpeed` | `2.60` m/s |
| `maxSpeed` | `6.60` m/s |
| `aimMax` | `0.45` rad |

Power is spent as **energy**, not speed:

```
speed = sqrt(minSpeed^2 + power * (maxSpeed^2 - minSpeed^2))
```

Power is not clamped. Below `0` falls short; above `1` climbs the backboard.

Launch velocity rotates, magnitude is preserved:

```
a = clamp(aim, -1, 1) * aimMax
v = (sin(a) * speed, 0, -cos(a) * speed)
```

**Rules:**

- `minSpeed < maxSpeed`.
- `aimMax` between `0.30` and `0.60` rad. Wide enough to hit a side wall on purpose.
- A comfortable flick must land in the **middle** of the speed range. Never bracket `minSpeed`
  and `maxSpeed` to the nearest and furthest holes.

Swipe constants live in `js/swipe.js` and are shared by every machine:

| | |
|---|---|
| `SWIPE_SLOW` | `0.65` screen-heights/sec → power 0 |
| `SWIPE_FAST` | `4.20` screen-heights/sec → power 1 |
| `MIN_UP_PX` | `20` |

Swipe speed is the gesture's **2-D** distance over time. The throw test is the upward component
only.

---

## 11 · Capture

A ball drops in when its face-plane distance to a hole centre is under `r - ballR * 0.28`, and it
is not travelling too fast for the remaining mouth:

```
cross = rEff + sqrt(rEff^2 - d^2)
capture if  vFace * captureDrop <= cross
```

A ball that stops on the face without falling through is **not** scored. It rolls back to the
trough and takes the trough's `0`.

A ball that returns to the near end of the lane is **not spent**. Give it back, however hard it
was thrown.

There is no magnetism. Never steer a ball toward a hole. Widen the geometry instead.

---

## 12 · Backboard stats

Four records, painted on the backboard, pushed in by `ui.js`:

```js
{ allTime, best, today, last }
```

`allTime` may carry a name. The other three are always this player's. The renderer never reads
storage or the network.

---

## 13 · Colours — `look.complete`

All twenty keys required, all `#rrggbb`.

| | |
|---|---|
| `wood`, `woodDark` | lane bed |
| `cabinet`, `cabinetEdge` | side panels |
| `face`, `faceEdge` | scoring face |
| `ring`, `ringLip` | ring wall, ring lip |
| `value`, `pocket` | painted numbers, hole interior |
| `marquee`, `marqueeText`, `bulb` | header sign |
| `glow` | score and effects |
| `wall` | room behind the machine |
| `net` | ball return |

---

## 14 · Board entry — `entry.complete`

```js
{
  id: 'frozen-slug',                        // never reused, never changed
  name: 'THE NAME',                         // proper noun, untranslated
  taglineKey: 'board_<id>_tag',             // + en and es strings
  unlock: { board: '<previous id>', score: N },
  look: { ... },                            // section 13
  geom: { ... },                            // sections 1-10
}
```

`unlock` is `null` only on the first machine.

Regenerate the hub tile after adding a board:

```bash
node gen-skeeball-tile.mjs
```

---

## 15 · Verification

Run all four. All must pass.

```bash
node skeeball/js/test.js --full
node test-skeeball-machine-spec.mjs
node test-skeeball-rings.mjs
node test-game-conventions.mjs
```

`skeeball/js/test.js` runs the reachability sweep and the soak against **every** board in the
list. A new machine is covered automatically. Reachability is a property of the whole layout, so
re-run it after any hole moves.

---

## Waivers

A rule may be broken only with a waiver in the board entry, keyed by rule id:

```js
specWaivers: {
  'holes.spacing': 'c40 and c50 sit 1.19X apart, under the 1.30X minimum. This board is '
    + 'deliberately short. Sweep re-run: every hole still scores across at least 4 '
    + 'consecutive swipe strengths.',
},
```

The test:

- **fails** if a rule is broken with no waiver
- **fails** if a waiver names a rule that is not actually broken
- **fails** if a reason is under 40 characters
- otherwise passes, and prints every waiver under `RULES BROKEN ON THIS MACHINE`

**Every waiver must be quoted in the PR body and in the message to Matt.** The test prints a
block ready to paste.
