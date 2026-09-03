# Golf: implementation handoff

Read this whole file before writing any code. Everything is decided. Do not redesign, do not
substitute your own approach, do not "improve" the constants. Where a number is marked
**(tune)**, the tuning procedure is written out and you follow it. Where something is unclear,
stop and ask; do not guess.

Companion file: `HANDOFF-NEWGAME-REFERENCE.md` (hub conventions). Where it and this file
disagree, this file wins for golf-specific things and the reference wins for hub conventions.

Work is split into **Parts 1 to 8** (§14). Each part has acceptance checks. Stop at the end of
every part and report; do not start the next part until told to.

---

## 1. Identity

| Key | Value |
|---|---|
| Title | `{ en: 'Golf', es: 'Golf' }` |
| Hub id, stats id, folder | `golf` |
| CSS prefix / root | `.gf-root`, classes `.gf-*`, vars `--gf-*` |
| Settings key | `gamehub.golf.v1` |
| Accent | `#2E7D4F` |
| `immersive` | `true` |
| Multiplayer | none |
| Opponent | none |

Player experience summary: one 9-hole course, stroke play, three tap-to-stop meters per shot
(aim, power, spin; spin skipped on putts), Modified Stableford points per hole summed into a
lifetime "skill level" stat. Portrait only.

---

## 2. Files

```
golf/
  index.html
  CLAUDE.md
  DECISIONS.md
  css/golf.css
  js/
    ui.js          DOM shell, HUD, tap capture, playback, autosave. The ONLY file that touches the DOM
                   except render.js/camera.js which touch three.js.
    game.js        pure: round state, stroke and point rules, serialize
    meters.js      pure: bar motion and input mapping
    clubs.js       pure: club table, lie modifiers, auto-select
    terrain.js     pure: hole JSON -> height grid + surface grid (rasterizer) + samplers
    flight.js      pure: aerodynamic force per step
    physics.js     pure (Node-safe): cannon-es world, full-shot simulation -> trajectory
    render.js      three.js scene: terrain mesh, props, ball, flag, trail
    camera.js      camera state machine
    strings.js     { en, es }
    test.js        headless tests
    vendor/
      three.module.min.js   copied from skeeball/js/vendor/
      three.core.min.js     copied from skeeball/js/vendor/
      cannon-es.js          copied from skeeball/js/vendor/
  courses/
    registry.js
    harbor/course.js       course 1, nine holes as JS objects (§9)
    harbor/fixture.json    replay fixture (§12)
  tools/
    preview.html           renders any hole JSON in 3D, no game shell
    sweep-carry.mjs        prints carry/roll per club per power on flat ground
    refixture.mjs          regenerates fixture.json for a course
```

Copy the three vendor files byte-for-byte from `skeeball/js/vendor/`. Do not import across
folders.

Import style everywhere: `import * as THREE from './vendor/three.module.min.js'` and
`import * as CANNON from './vendor/cannon-es.js'` (match whatever import form Skeeball uses for
the same files; check `skeeball/js/machines/classic/physics.js` and copy it exactly).

`physics.js`, `flight.js`, `terrain.js`, `game.js`, `meters.js`, `clubs.js` must run in plain
Node with no DOM. `test.js` imports them directly.

---

## 3. Units and coordinates

- Internal units: metres, seconds, kilograms, radians. UI shows yards (`yd = m / 0.9144`),
  rounded to whole yards, and mph for wind (`mph = m/s × 2.23694`).
- World axes: +y up. Each hole has its own frame: tee at `(0, 0)` in the xz plane, +z points
  from tee toward the pin along the first fairway segment. Hole JSON coordinates are `[x, z]`
  in metres in this frame.
- Ball: radius `0.02134`, mass `0.04593`, cross-section area `0.001432`.
- Cup radius `0.054`.

---

## 4. Meters (`meters.js`)

Pure functions. No timers, no DOM. `ui.js` calls `pos(tNow - tStart, T)` each frame to draw the
marker and calls the same function once at tap time to read the value.

```js
// Marker position 0..1 over time. Sine ease so the ends are slower and reachable.
export function pos(t, T) {            // t seconds since bar started, T = one left->right pass
  return 0.5 - 0.5 * Math.cos(Math.PI * t / T);
}
export function aimDeg(p, rangeDeg) { return (p - 0.5) * 2 * rangeDeg; }   // -range..+range
export function power01(p) { return p; }                                   // 0..1
export function spin01(p) { return (p - 0.5) * 2; }                        // -1 back .. +1 top
```

Per-difficulty constants (seconds per pass, degrees, sweet band):

```js
export const DIFF = {
  casual:   { aimT: 1.6, powerT: 1.4, spinT: 1.4, aimRange: 10, puttRange: 5, sweet: [0.88, 1.0], windMax: 2.7 },
  standard: { aimT: 1.1, powerT: 1.0, spinT: 1.0, aimRange: 12, puttRange: 6, sweet: [0.92, 1.0], windMax: 5.4 },
  pro:      { aimT: 0.8, powerT: 0.7, spinT: 0.7, aimRange: 14, puttRange: 7, sweet: [0.95, 1.0], windMax: 8.9 },
};
```
(`windMax` in m/s: 6 / 12 / 20 mph.)

Sequence per shot: aim bar starts moving on address. Tap 1 freezes it. Power bar starts 150 ms
later. Tap 2 freezes it. If the shot is a putt, fire now. Otherwise spin bar starts 150 ms later;
tap 3 freezes it and fires. A tap during the 150 ms gap is ignored.

Mishit rule: if `power01 < 0.6`, add lateral error `err = (0.6 - power01) × 4°` in a direction
chosen by the shot's seeded RNG (§7.4). Applied in `physics.js` when building the launch vector.

---

## 5. Clubs (`clubs.js`)

```js
export const CLUBS = [
  { id: 'dr',  name: { en: 'Driver',  es: 'Driver' },  speed: 71.93, launch: 12, spin: 2600 },
  { id: '3w',  name: { en: '3 Wood',  es: 'Madera 3' }, speed: 60.09, launch: 14, spin: 3200 },
  { id: '5i',  name: { en: '5 Iron',  es: 'Hierro 5' }, speed: 51.07, launch: 18, spin: 5000 },
  { id: '7i',  name: { en: '7 Iron',  es: 'Hierro 7' }, speed: 45.39, launch: 21, spin: 6500 },
  { id: '9i',  name: { en: '9 Iron',  es: 'Hierro 9' }, speed: 40.37, launch: 25, spin: 8000 },
  { id: 'pw',  name: { en: 'Wedge',   es: 'Wedge' },   speed: 35.10, launch: 30, spin: 9500 },
  { id: 'sw',  name: { en: 'Sand W',  es: 'Sand W' },  speed: 29.01, launch: 38, spin: 10000 },
  { id: 'pt',  name: { en: 'Putter',  es: 'Putter' },  speed: 6.5, launch: 0, spin: 0 },
];
```
`speed` = ball speed in m/s at `power01 = 1` **(tune, Part 1 - DONE, see DECISIONS.md; the first
pass's >120 m/s values were the symptom of the spinAxis sign bug below, not a real result - these
are the re-tuned values after that fix, all realistic 25-72 m/s golf ball speeds)**.
`launch` = degrees above horizontal. `spin` = backspin rpm at spin01 = 0 (the "straight" middle).

Target carries after tuning (flat ground, no wind, power 1.0, spin bar centered):
Driver 240 m, 3W 205, 5i 170, 7i 145, 9i 123, PW 100, SW 73. Putter 100% = 36 m roll on flat
green. Tune `speed` per club until `sweep-carry.mjs` reports carry within ±5% of these.

Lie modifiers (applied to `speed` and `spin`):

```js
export const LIE = {
  tee:     { speed: 1.00, spin: 1.00 },
  fairway: { speed: 1.00, spin: 1.00 },
  fringe:  { speed: 1.00, spin: 0.90 },
  rough:   { speed: 0.85, spin: 0.60 },
  sand:    { speed: 0.70, spin: 0.50 },   // if club is not 'sw' or 'pw', speed 0.55 instead
  green:   { speed: 1.00, spin: 1.00 },   // putter only
};
```

Auto-select: on green → putter. Otherwise take `d = distanceToPin` (metres, straight line),
adjust `d += headwindComponent × 1.5` (headwind positive lengthens), then choose the club with
the smallest `targetCarry ≥ d`; if none (d > driver), driver. Player override: tapping the club
chip cycles a horizontal chip row; putter is selectable only on green or fringe.

---

## 6. Terrain (`terrain.js`)

### 6.1 Hole definition (input)

```js
{
  n: 1, par: 4, seed: 101,
  tee: [0, 0], pin: [8, 330], target: [2, 215],
  fairway: { path: [[0, 20], [0, 150], [6, 260], [8, 315]], width: 34 },
  green: { center: [8, 330], radius: 13, tilt: [0.0, -0.01] },
  fringe: 3,
  bunkers: [ { center: [-14, 318], radius: 6 }, { center: [22, 300], radius: 5 } ],
  water: [ { poly: [[-60, 60], [-30, 60], [-30, 130], [-60, 130]] } ],
  hills: [ { at: [40, 200], height: 4, radius: 45 }, { at: [-45, 260], height: 3, radius: 40 } ],
  trees: { count: 60 },
  intro: { from: [8, 40, 360], to: [0, 18, -25] }
}
```

`tee` also gets a tee box: a 6 × 6 m square of surface `tee` centered on it.

### 6.2 Grid

- Cell size `1.0` m. Bounds: the axis-aligned box around all geometry (path points ± width,
  green, bunkers, water polys, hills at 1.5 × radius) expanded by 35 m on every side, rounded
  outward to whole metres. Store `x0, z0, nx, nz`.
- `height: Float32Array(nx × nz)`, `surface: Uint8Array(nx × nz)`, index `i + j × nx` where
  `i` is along x, `j` along z.

Surface codes:

```js
export const S = { OB: 0, ROUGH: 1, FAIRWAY: 2, FRINGE: 3, GREEN: 4, SAND: 5, WATER: 6, TEE: 7 };
```

### 6.3 Rasterization order (later wins)

1. Everything = ROUGH.
2. Cells within 5 m of the bounds edge = OB.
3. Fairway: distance from cell center to the polyline `path` ≤ `width / 2` → FAIRWAY. Round
   caps at each vertex.
4. Water polygons (point-in-polygon) → WATER.
5. Green: distance to `green.center` ≤ `radius + fringe` → FRINGE; ≤ `radius` → GREEN.
6. Bunkers: distance ≤ radius → SAND.
7. Tee box → TEE.

### 6.4 Heights

Base: seeded value noise (§6.6), amplitude 0.6 m, wavelength 24 m, two octaves (second at half
wavelength, 0.4 amplitude). Add each hill: `height × exp(-(d² / (2 × (radius / 2.2)²)))` where
`d` is distance to `hill.at`.

Then flatten play surfaces (blend factor `k`, final = `k × flat + (1 - k) × rough`):
- Green and fringe: flat = plane through the green center's base height with slope `tilt`
  (`tilt = [dy/dx, dy/dz]`, metres per metre). `k = 1` inside the green, fading linearly to 0
  across the fringe band.
- Fairway: reduce noise amplitude by multiplying the noise term by 0.35 (hills still apply).
- Tee box: fully flat at its center's height.
- Bunkers: subtract a bowl `0.5 × (1 - d/radius)` m.
- Water: subtract 1.2 m flat.

### 6.5 Samplers

```js
export function heightAt(t, x, z)   // bilinear in the grid, clamps outside bounds
export function normalAt(t, x, z)   // from central differences, normalized
export function surfaceAt(t, x, z)  // nearest cell, OB outside bounds
export function build(holeDef)      // -> { x0, z0, nx, nz, cell:1, height, surface, def }
```

### 6.6 Seeded noise and RNG

One RNG everywhere, mulberry32:

```js
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
```
Value noise: lattice of random values from `rng(seed)` on a 24 m grid, bilinear interpolated
with smoothstep. Same seed → same terrain in Node and browser (float math is identical for
this arithmetic on all current engines; the fixture test guards it).

Trees: `count` positions drawn from `rng(seed + 7)` uniformly over the bounds, keeping only
those on ROUGH and at least 6 m from any FAIRWAY/GREEN/TEE cell and 8 m from any other tree.
Trees are visual only; no collision in this build.

---

## 7. Physics (`physics.js`, `flight.js`)

### 7.1 Design

A shot is simulated completely, up front, in one call, producing a trajectory. The UI then
plays the trajectory back. This makes Node and browser identical, makes fixtures trivial, and
means the render loop never steps physics.

```js
export function simulateShot(terrain, input) -> {
  samples: [{ t, x, y, z }],        // every 1/60 s
  events: [{ t, kind, x, z }],      // 'land', 'bounce', 'water', 'ob', 'hole', 'lip'
  rest: { x, y, z }, lie: S.*,     // where it stopped, surface there
  outcome: 'stop' | 'hole' | 'water' | 'ob',
  carryM, totalM                    // straight-line from start to first land, and to rest
}
// input = { from: {x,z}, dirDeg, clubId, lie, power01, spin01, wind: {x, z}, seed, curve01 }
//   curve01 (Part 9B): -1..+1, default 0. See §7.3 "Sidespin".
```

### 7.2 World

- `new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) })`, `world.solver.iterations = 10`,
  fixed step `dt = 1/960` (raised from the original 1/240 in Part 1: cannon-es has no continuous
  collision detection and sphere-vs-heightfield tunnels above ~10 m/s of impact speed at 1/240;
  see DECISIONS.md#heightfield-tunneling-and-dt). Samples are still recorded every 1/60 s (every
  16 steps at this rate). Max simulated time 20 s.
- Terrain body: `CANNON.Heightfield(matrix, { elementSize: 1 })`. The z-mapping IS mirrored (as
  this section warned it might be) - `matrix[i][j] = height[i + (nz-1-j) × nx]`, body `mass 0`,
  quaternion `setFromEuler(-Math.PI / 2, 0, 0)`, position `(x0, 0, z0 + (nz - 1))`. Passes the
  drop-test acceptance check (test 1) at all three grid points. See
  DECISIONS.md#heightfield-z-mirror.
- **Ground guard** (added in Part 1, on top of cannon-es's own contact - both stay on; cannon-es
  still handles rolling and slopes): after every `world.step`, if `ball.y < heightAt(ball.x,
  ball.z)` (the ball's CENTER at or below the surface - pen > radius, ~21mm; cannon's own contact
  settle penetrates a few mm, never that much, so this only fires on true tunneling and can't
  re-fire on the same contact once snapped back up): snap `ball.position.y = heightAt + radius`;
  `n = normalAt(ball.x, ball.z)`, `vn = v · n`, and if `vn < 0` set
  `v = v - (1 + SURF[surface].rest) * vn * n` (normal component only, tangential unchanged); emit
  `land`/`bounce` and apply `omega *= 0.4` once per airborne->grounded transition, exactly as
  below. An earlier, tighter threshold (`pen > 0.002`) fired on cannon-es's own multi-step bounce
  settle and double-applied restitution, causing energy gain; see
  DECISIONS.md#ground-guard-threshold.
- Ball body: `CANNON.Sphere(0.02134)`, mass `0.04593`, `linearDamping 0`, `angularDamping 0`.
  **`Body.applyForce(force, relativePoint)`'s second argument is relative to the body's CENTER OF
  MASS, not a world position - every force application (air force, roll resistance, the post-land
  spin force) must call `applyForce(force)` with no second argument (or an explicit zero Vec3),
  never `applyForce(force, ballBody.position)`. The latter creates a bogus torque of enormous
  magnitude (the "relative point" ends up hundreds of metres from center) and was the root cause
  of the erratic, energy-gaining bounces found while tuning Part 1. See
  DECISIONS.md#applyforce-relative-point-bug.
- Flagstick: `CANNON.Cylinder` radius 0.006, height 2.1 at the pin, mass 0.
- One `ContactMaterial(ballMat, groundMat)` whose `restitution` and `friction` are overwritten
  every step from the surface under the ball:

```js
// grip added Part 2 (2026-09-02): fraction of TANGENTIAL velocity lost on every land/bounce
// impact, applied once at the transition regardless of whether cannon-es's own contact or the
// ground guard produced it. rest/roll reset to realistic starting points Part 2 and re-tuned
// alongside SPIN_BITE and SPIN_BRAKE (see §7.4) - the driver-vs-wedge rollout distinction is the
// spin terms' job, not a per-surface trade-off. Every rollout band in §12.1 test 3b passes at
// these values. Frozen (this object and every row) so a tuning script can never silently mutate
// shared state - see DECISIONS.md#reproducibility-part2.
export const SURF = {
  [S.OB]:      { rest: 0.30, fric: 0.60, roll: 0.10,    grip: 0.50 },
  [S.ROUGH]:   { rest: 0.25, fric: 0.70, roll: 0.80,    grip: 0.55 },
  [S.FAIRWAY]: { rest: 0.40, fric: 0.40, roll: 0.18,    grip: 0.35 },
  [S.FRINGE]:  { rest: 0.35, fric: 0.35, roll: 0.08,    grip: 0.35 },
  [S.GREEN]:   { rest: 0.35, fric: 0.30, roll: 0.03589, grip: 0.30 },
  [S.SAND]:    { rest: 0.08, fric: 0.90, roll: 0.30,    grip: 0.80 },
  [S.WATER]:   { rest: 0.00, fric: 1.00, roll: 1.00,    grip: 1.00 },
  [S.TEE]:     { rest: 0.40, fric: 0.40, roll: 0.18,    grip: 0.35 },
};
for (const key of Object.keys(SURF)) Object.freeze(SURF[key]);
Object.freeze(SURF);
```
`roll` is a rolling-resistance coefficient **(tune - DONE: GREEN Part 1 to the putter's 36m
target, FAIRWAY/TEE and ROUGH Part 2 to the rollout bands)**: while grounded, apply force
`-roll × m × g × v̂` (horizontal unit velocity), skipped when speed < 0.02.

Grounded test: `ball.y - heightAt(ball.x, ball.z) < radius + 0.01`.

### 7.3 Launch

```
speed = club.speed × LIE[lie].speed × power01
dir   = dirDeg + mishitErr                       (degrees, 0 = +z, positive = clockwise viewed from above)
v0    = speed × (sin(dir)·cos(launch), sin(launch), cos(dir)·cos(launch))
omega = (club.spin × LIE[lie].spin × (1 - 0.6 × spin01)) rpm → rad/s      (spin01 = -1 → 1.6×, +1 → 0.4×)
spin axis = horizontal, perpendicular to dir (pure backspin); positive = backspin.
  = travelDir x up, i.e. { x: -cos(dirRad), y: 0, z: sin(dirRad) } - the ORIGINAL formula here
  (cos(dirRad), 0, -sin(dirRad)) was this negated, which made backspin lift act as downforce.
  Caught 2026-09-02 when Matt asked for a real 70 m/s driver trajectory trace against known real
  driver numbers; see DECISIONS.md#spinaxis-sign-bug.

Sidespin (Part 9B, 2026-09-03 - the one approved edit to frozen physics):
  input gains curve01 in -1..+1 (default 0; -1 = hook, curves toward -x when travelling +z;
  +1 = slice, toward +x). tilt = curve01 x SIDE_TILT (flight.js, 22 deg, tuned - see below).
  spin axis = rotate(travelDir x up, about travelDir, by -tilt)
            = perp x cos(tilt) + up x sin(tilt)
            = { x: -cos(dirRad) x cos(tilt), y: sin(tilt), z: sin(dirRad) x cos(tilt) }
  so the Magnus force spinAxis x vr gains a LATERAL component (up x vr, horizontal, full |vr|,
  for the whole flight) and its vertical component scales by cos(tilt): a strongly curved shot
  flies lower and shorter. curve01 = 0 multiplies by cos(0) = 1 and adds sin(0) = 0 exactly, so
  every straight shot is bit-identical to the pre-9B model (test 8b). Putts ignore it.
  NOTE: GOLF-PART9.md wrote "rotateAboutY". A rotation about Y keeps the axis horizontal, and a
  horizontal axis crossed with a near-horizontal vr gives a lateral force of only sin(launch) x
  that size, which also flips sign on the descent - it cannot reach the 25-45 m band at any
  SIDE_TILT. The rotation is about the travel direction (the launch-monitor "spin axis tilt"),
  which is what the band was written for. See DECISIONS.md#part9b-sidespin.
```
Putter: `launch 0`, spin 0, `speed = 6.5 × power01`, and the ball starts grounded.

`SIDE_TILT` **(tune, Part 9B - DONE: 22)**. Band: driver at `curve01 = 1`, flat, power 1, no
wind, lands 25-45 m right of and 5-15 m shorter than the straight shot. The doc's starting 35
gave 48.0 / 26.2 (outside both); the sweep over 20-50 passes only from 20 to 26; 22 is the
centre of both bands (35.6 m right, 10.7 m short; the hook mirrors at 35.6 / 10.8).

Aim direction 0 is the target line; `ui.js` passes `dirDeg = targetBearingDeg + aimDeg`.

### 7.4 Air forces (`flight.js`), applied every step while not grounded

```js
export const AIR = { rho: 1.225, Cd: 0.24, ClMax: 0.25, spinDecayTau: 25 };
export function airForce(v, omega, spinAxis, wind) {
  const vr = v − wind;                             // relative air velocity (wind at ground level, constant)
  const s = |vr|;  if (s < 1e-6) return 0;
  const drag = −0.5 × rho × Cd × A × s × vr;
  const S = (r × omega) / s;                      // spin ratio
  const Cl = Math.min(ClMax, 1.55 × S);            // (tune, Part 1 - DONE: 1.55, re-tuned after
                                                     // the spinAxis sign bug fix (was 0.62, and
                                                     // the "apex barely moves" finding under that
                                                     // value was itself a symptom of the same bug
                                                     // - with lift acting as downforce, raising
                                                     // this made it WORSE). At 1.55, a 70 m/s
                                                     // driver gives ~233m carry, ~26m apex, ~6.5s
                                                     // hang, matching real driver numbers. See
                                                     // DECISIONS.md#spinaxis-sign-bug.
  const liftDir = normalize(spinAxis × vr);        // cross product; for backspin this points up-ish
  const lift = 0.5 × rho × Cl × A × s² × liftDir;
  return drag + lift;
}
```
Spin decays `omega *= exp(-dt / spinDecayTau)` in the air. On each ground contact
`omega *= SPIN_RETAIN` — **0.6 since Part 2**, raised from 0.4 because at 0.4 an iron's backspin
was spent across its own bounces before any grounded term could act on it.

**Spin bite at impact (added Part 2, 2026-09-02).** On every land/bounce event, after the `grip`
scaling and BEFORE the per-contact spin decay, tangential speed is reduced by
`min(|vt|, SPIN_BITE × omega)` — **`SPIN_BITE = 0.005`**, m/s of tangential speed per rad/s of
backspin, **(tune, Part 2)**. Clamped at `|vt|`, so a bite can stop the ball dead but never
reverse it. This is backspin biting the turf at the moment of contact, and it is what actually
separates a driver's rollout from a wedge's — the grounded brake below could not, because by the
time an iron settles into a continuous roll its spin is nearly gone. See
DECISIONS.md#spin-bite-part2.

**Replaced Part 2 (2026-09-02):** the flat "0.02 x m x g for 0.5s"
post-land force applied the same brake regardless of how much spin was actually left, so it could
never separate a driver's low backspin from a wedge's high backspin the way real rollout does. It
is now a **grounded backspin brake**, proportional to remaining spin: while grounded and
`omega > 0`, a horizontal force opposing travel of magnitude `m × SPIN_BRAKE × omega` (omega in
rad/s, SPIN_BRAKE in m/s² per rad/s, **(tune, Part 2) = 0.008**). While grounded, `omega` ALSO
decays fast on its own: `omega *= exp(-dt / 0.6)` (roughly a second of effect), on top of the
`*0.4` per-contact loss above. Backspin never goes negative in this model. This is what makes a
backspin wedge check up while a driver, with much less relative backspin, keeps rolling. See
DECISIONS.md#spin-brake-part2 for the tuning trace, including that 7-iron did not fall into its
own rollout band and the pass stopped there per instruction.

`A = 0.001432`, `r = 0.02134`.

### 7.5 Events and end conditions

Checked every step, in this order:
1. **Water**: grounded and `surfaceAt == WATER` → outcome `water`, `rest` = last sample where
   the surface was not WATER (walk `samples` backwards). Stop.
2. **OB**: grounded and `surfaceAt == OB` for 20 consecutive steps → outcome `ob`, rest = the
   shot's `from` position. Stop.
3. **Hole**: horizontal distance to cup center < 0.054 and grounded and speed < 1.6 → outcome
   `hole`. If speed ≥ 1.6 within that radius → event `lip`, apply an impulse deflecting the
   velocity 60° sideways and scaling it by 0.55, once per shot.
4. **Land**: first transition from airborne to grounded → event `land`, set `carryM`.
   Subsequent airborne→grounded transitions → `bounce`.
5. **Stop**: grounded and speed < 0.05 for 0.5 s continuous, or `t ≥ 20` → outcome `stop`.

`samples` are recorded every 4 steps (1/60 s). `rest` for `stop`/`hole` is the final position.

### 7.6 Determinism

No `Math.random` anywhere in `physics.js`, `flight.js`, `terrain.js`. The only randomness is
`rng(input.seed)`, used for the mishit direction. Fixed `dt`, no accumulator, no variable
substeps. The Part 1 acceptance check runs the same shot twice and asserts identical `rest`.

---

## 8. Round rules (`game.js`)

State object (the whole thing is what autosave writes):

```js
{
  v: 1, courseId: 'harbor', difficulty: 'standard', seed: 0,
  hole: 1,                        // 1..9
  strokes: [0,0,0,0,0,0,0,0,0],   // per hole
  points:  [null,...],            // per hole, null until holed
  ball: { x, z, lie },            // current ball, in the hole's frame
  wind: { x, z },                 // m/s, rolled once per hole
  club: null,                     // player override for this shot, null = auto
  phase: 'intro' | 'address' | 'flight' | 'summary'
}
```

Rules:
- Stroke count increments when a shot fires. Water: +1 penalty stroke, ball placed at `rest`
  (last dry point), lie from surface. OB: +1 penalty, ball back at `from`.
- Max per hole = `par + 4`; reaching it ends the hole with that stroke count.
- Wind per hole: magnitude `rng(seed + hole × 31)() × windMax`, direction uniform; if the hole
  def has `wind: {x, z}` use it instead.
- Points table (Modified Stableford), keyed by `strokes - par`:

```js
export const POINTS = { '-3': 8, '-2': 5, '-1': 2, '0': 0, '1': -1 };   // ≤ -3 → 8, ≥ 2 → -3
export function holePoints(strokes, par) {
  const d = strokes - par;
  if (d <= -3) return 8; if (d >= 2) return -3; return POINTS[String(d)];
}
```
A hole-in-one on a par 3 is `d = -2` → 5, which is what the table already gives.

Result words, keyed by `d`: `-3` albatross, `-2` eagle, `-1` birdie, `0` par, `1` bogey, `2`
double, `≥3` triple. `strokes === 1` → `ace` overrides.

Round total = sum of `points`. On finishing hole 9: `phase = 'summary'`, call `recordGolf`
(§11) exactly once, then clear the autosaved round.

---

## 9. Course 1: Harbor Links (`courses/harbor/course.js`)

`export default { id: 'harbor', name: { en: 'Harbor Links', es: 'Harbor Links' }, par: 36, holes: [...] }`

Nine hole definitions follow. All coordinates in metres in the hole's own frame (tee at origin,
+z toward the hole). `yards` is informational for the HUD; compute it from the path once and
hardcode.

```js
// H1  Par 4  ~360 yd  gentle dogleg right, water left of the landing zone
{ n: 1, par: 4, seed: 101, tee: [0,0], pin: [8,330], target: [2,215],
  fairway: { path: [[0,20],[0,150],[6,260],[8,315]], width: 34 },
  green: { center: [8,330], radius: 13, tilt: [0, -0.01] }, fringe: 3,
  bunkers: [{ center: [-14,318], radius: 6 }, { center: [22,300], radius: 5 }],
  water: [{ poly: [[-60,60],[-30,60],[-30,130],[-60,130]] }],
  hills: [{ at: [40,200], height: 4, radius: 45 }, { at: [-45,260], height: 3, radius: 40 }],
  trees: { count: 60 }, intro: { from: [8,40,360], to: [0,18,-25] } },

// H2  Par 3  ~165 yd  over water to a wide green
{ n: 2, par: 3, seed: 102, tee: [0,0], pin: [0,151], target: [0,151],
  fairway: { path: [[0,110],[0,140]], width: 26 },
  green: { center: [0,151], radius: 15, tilt: [0.005, 0] }, fringe: 3,
  bunkers: [{ center: [18,150], radius: 6 }],
  water: [{ poly: [[-40,20],[40,20],[40,100],[-40,100]] }],
  hills: [{ at: [0,190], height: 5, radius: 35 }],
  trees: { count: 40 }, intro: { from: [0,35,185], to: [0,15,-20] } },

// H3  Par 5  ~520 yd  straight, long, bunkers guard the second landing area
{ n: 3, par: 5, seed: 103, tee: [0,0], pin: [-6,475], target: [-4,320], // moved Part 2, see DECISIONS.md
  fairway: { path: [[0,20],[0,240],[-4,380],[-6,455]], width: 36 },
  green: { center: [-6,475], radius: 14, tilt: [0, -0.012] }, fringe: 3,
  bunkers: [{ center: [22,330], radius: 7 }, { center: [-26,350], radius: 7 }, { center: [-22,470], radius: 5 }],
  water: [],
  hills: [{ at: [50,150], height: 3, radius: 50 }, { at: [-55,420], height: 4, radius: 45 }],
  trees: { count: 80 }, intro: { from: [-6,45,510], to: [0,20,-30] } },

// H4  Par 4  ~400 yd  dogleg left around a hill, blind-ish second shot
{ n: 4, par: 4, seed: 104, tee: [0,0], pin: [-70,340], target: [-38,280], // moved Part 2, see DECISIONS.md
  fairway: { path: [[0,20],[-4,160],[-30,270],[-66,325]], width: 32 },
  green: { center: [-70,340], radius: 12, tilt: [-0.008, 0] }, fringe: 3,
  bunkers: [{ center: [-52,335], radius: 6 }, { center: [-88,352], radius: 5 }],
  water: [],
  hills: [{ at: [-70,220], height: 7, radius: 45 }, { at: [40,300], height: 3, radius: 50 }],
  trees: { count: 70 }, intro: { from: [-70,40,375], to: [0,18,-25] } },

// H5  Par 3  ~140 yd  elevated tee down to a small green ringed by sand
{ n: 5, par: 3, seed: 105, tee: [0,0], pin: [4,128], target: [0,120], // moved Part 2, see DECISIONS.md
  fairway: { path: [[0,80],[3,110]], width: 24 },
  green: { center: [4,128], radius: 11, tilt: [0, 0.008] }, fringe: 3,
  bunkers: [{ center: [-10,128], radius: 6 }, { center: [18,128], radius: 6 }, { center: [4,144], radius: 6 }],
  water: [],
  hills: [{ at: [0,-10], height: 9, radius: 40 }],
  trees: { count: 50 }, intro: { from: [4,30,160], to: [0,22,-20] } },

// H6  Par 4  ~330 yd  short, water right all the way, tempts a driver
{ n: 6, par: 4, seed: 106, tee: [0,0], pin: [10,300], target: [-2,208], // moved Part 2, see DECISIONS.md
  fairway: { path: [[0,20],[-2,140],[4,240],[9,285]], width: 30 },
  green: { center: [10,300], radius: 13, tilt: [0.01, 0] }, fringe: 3,
  bunkers: [{ center: [-8,290], radius: 6 }],
  water: [{ poly: [[30,40],[80,40],[80,330],[30,330]] }],
  hills: [{ at: [-50,180], height: 4, radius: 50 }],
  trees: { count: 45 }, intro: { from: [10,40,335], to: [0,18,-25] } },

// H7  Par 5  ~545 yd  double dogleg (right then left), risky cut over water on shot 2
{ n: 7, par: 5, seed: 107, tee: [0,0], pin: [-20,498], target: [22,300], // moved Part 2, see DECISIONS.md
  fairway: { path: [[0,20],[8,150],[30,270],[10,380],[-16,478]], width: 34 },
  green: { center: [-20,498], radius: 14, tilt: [0, -0.01] }, fringe: 3,
  bunkers: [{ center: [50,275], radius: 7 }, { center: [-6,480], radius: 6 }, { center: [-36,510], radius: 6 }],
  water: [{ poly: [[-40,290],[-5,290],[-5,360],[-40,360]] }],
  hills: [{ at: [-60,150], height: 4, radius: 55 }, { at: [70,420], height: 5, radius: 50 }],
  trees: { count: 90 }, intro: { from: [-20,50,535], to: [0,22,-30] } },

// H8  Par 4  ~380 yd  straight, green sits up on a plateau
{ n: 8, par: 4, seed: 108, tee: [0,0], pin: [2,348], target: [0,225],
  fairway: { path: [[0,20],[0,200],[2,330]], width: 34 },
  green: { center: [2,348], radius: 13, tilt: [0, 0.015] }, fringe: 3,
  bunkers: [{ center: [-16,340], radius: 6 }, { center: [20,340], radius: 6 }],
  water: [],
  hills: [{ at: [2,352], height: 6, radius: 32 }, { at: [55,120], height: 3, radius: 50 }],
  trees: { count: 60 }, intro: { from: [2,45,385], to: [0,18,-25] } },

// H9  Par 4  ~420 yd  long finisher, bunkers left, water short-right of green
{ n: 9, par: 4, seed: 109, tee: [0,0], pin: [-4,385], target: [-2,270], // moved Part 2, see DECISIONS.md
  fairway: { path: [[0,20],[0,220],[-3,365]], width: 34 },
  green: { center: [-4,385], radius: 14, tilt: [-0.006, -0.006] }, fringe: 3,
  bunkers: [{ center: [-26,250], radius: 8 }, { center: [-24,380], radius: 6 }],
  water: [{ poly: [[12,330],[45,330],[45,372],[12,372]] }],
  hills: [{ at: [45,180], height: 4, radius: 50 }, { at: [-60,330], height: 3, radius: 45 }],
  trees: { count: 70 }, intro: { from: [-4,45,420], to: [0,20,-28] } },
```

Total par 36. If reachability tests fail on a hole, fix by adjusting that hole's `target`,
`width`, or a bunker position, and note the change in `DECISIONS.md`. Do not touch physics to
fix a course.

**H3 is on a knife edge** (Matt, 2026-09-02): its leg-2 reachability check passes at
`target: [-4,320]` but fails at neighbouring values as close as `[-4,316]` and `[-5,328]` -
full trace in `DECISIONS.md#course-fixes-part2b`. This is test fragility, not a playability
problem; a real player aims anywhere on the fairway, not at one exact pixel. If it ever flips
red again (Part 6's fixture work is the likely trigger), **widen H3's fairway to 40 rather than
move the target again** - chasing the target a third time is treating the symptom.

`courses/registry.js`:

```js
import harbor from './harbor/course.js';
export const COURSES = [harbor];
export function courseById(id) { return COURSES.find(c => c.id === id) || null; }
```

---

## 10. Rendering and camera

### 10.1 Renderer (`render.js`)

- `new THREE.WebGLRenderer({ antialias: true, alpha: false })`, `setPixelRatio(Math.min(2, devicePixelRatio))`,
  `shadowMap.enabled = true`, `shadowMap.type = THREE.PCFSoftShadowMap`, `shadowMap.autoUpdate = false`.
  Call `renderer.shadowMap.needsUpdate = true` only when the ball moved > 0.01 m or the camera
  moved since last frame.
- `destroy()`: cancel the animation frame, dispose every geometry/material/texture, then
  `renderer.forceContextLoss(); renderer.dispose();` and remove the canvas. Copy Skeeball's
  teardown order exactly.
- One `requestAnimationFrame` loop, started in `init()`, stopped in `destroy()`.
- **`init()` must create a FRESH `<canvas>` element on every mount, and `destroy()` must remove
  it from the DOM - never keep one `<canvas>` around and reuse it across a mount/unmount or
  dispose/recreate cycle.** A WebGL context released via `forceContextLoss()` can never be
  reissued on the same canvas element - the browser permanently marks that element as having had
  a context, and every later `new THREE.WebGLRenderer({ canvas })` on it fails with "Canvas has
  an existing context of a different type". Found in Part 3 when `tools/preview.html` reused one
  canvas across hole switches; same pattern Skeeball's `js/ui.js` already follows for the same
  reason. See DECISIONS.md#webgl-canvas-reuse-part3.

Scene:
- Sky (**rewritten Part 9A**): ALWAYS daytime. Large inverted sphere, two-color vertical gradient
  shader `#7fb8ff` at the zenith → `#dceeff` at the horizon, plus a soft sun disc (white
  radial-gradient sprite, radius 6 m at 400 m along the light direction, additive, no fog). There
  is no dark-mode sky palette any more - dark mode governs the HUD bands only; the course never
  goes night-blue. `render.js` no longer subscribes to the theme event at all.
- Fog (Part 9A): `scene.fog = new THREE.Fog(0xdceeff, 180, 700)` so distance reads. The sky
  shader has no fog chunk and is unaffected.
- Light (Part 9A intensities): `HemisphereLight(0xffffff, 0x556644, 0.7)` plus
  `DirectionalLight(0xffffff, 1.3)` at direction `(-0.4, 1, 0.3)` normalized × 300 m from scene
  center, `castShadow`, shadow camera ortho ±260 m, map 2048.
- Terrain: `PlaneGeometry(nx - 1, nz - 1, nx - 1, nz - 1)` rotated `-π/2` about x, vertices
  displaced by `height`. **Verified directly against the vendored three.js (Part 3), given
  Part 1's heightfield-mirroring history**: after `.rotateX(-Math.PI / 2)`, the position
  attribute's vertex index is exactly `i + j × nx` (local x is untouched by an x-axis rotation;
  local y - which runs from `+height/2` at row 0 down to `-height/2` at the last row - maps to
  world z = `-local_y`, so row index j increases monotonically with world z). Set each vertex's
  displaced Y directly to `height[i + j*nx]`, then position the mesh at
  `(x0 + (nx-1)/2, 0, z0 + (nz-1)/2)` to map that local grid back to terrain.js's own
  `(x0+i, z0+j)` convention exactly - no mirrored fallback needed, unlike the Heightfield in
  §7.2. See DECISIONS.md#camera-history. Vertex colors by surface:

```js
// exported from render.js since Part 9A - minimap.js draws from the same table
export const COL = { 0: '#5e7a45', 1: '#3f6a2e', 2: '#66a83f', 3: '#79b34a', 4: '#8fcf5a', 5: '#e6d3a0', 6: '#3d7fc6', 7: '#66a83f' };
```
  `MeshLambertMaterial({ vertexColors: true })`, receives shadow. Green gets stripes: alternate
  ±6% brightness on vertex color by `floor(z / 2) % 2` for GREEN cells only. Fairway gets the
  same at **±6%** (Part 9A, was 3%) by `floor((x + z) / 4) % 2`. **Rough and fairway both get a
  low-frequency colour noise (Part 9A): ±4% brightness, 9 m wavelength, `makeValueNoise(seed + 13,
  9)` from terrain.js (now exported), so the ground stops reading as flat paint.** ROUGH is
  `#3f6a2e` (Part 9A, was `#4f7a3a`). Water cells also get a flat blue plane at their height
  + 1.0 m with `opacity 0.85` so the surface reads as water.
- Trees (Part 9A geometry): `InstancedMesh` of a cone (`ConeGeometry(3.2, 9, 6)`, color `#2f6b32`)
  on a cylinder trunk (`CylinderGeometry(0.35, 0.35, 2.2, 5)`, `#5c4326`), one instance per tree
  position, scale `0.9 + 0.5 × rng` (0.9 to 1.4). Cast shadow. Positions come from
  `terrain.js`'s `buildTrees`: the §6.6 random rough placement PLUS (Part 9A) a **fairway belt** -
  walk the fairway path in 12 m steps and stand a tree on each side at a lateral offset of
  `width/2 + 8 + rng × 6` m, skipping any spot on GREEN/FRINGE/SAND/WATER/TEE (or FAIRWAY, a
  dogleg's inner corner) or within 20 m of the pin, seeded from `rng(seed + 11)`. Visual only.
- Ball: `SphereGeometry(0.02134 × 3, 12, 12)` (3× true size so it's visible), `#ffffff`,
  `MeshStandardMaterial`. Rendered size is a visual choice; physics uses the true radius.
- Trail: `THREE.Line` from the last 45 sample points, color `#ffffff`, opacity fades along
  the line (use `LineBasicMaterial` with vertex colors, white → transparent-ish grey).
- Flag: pole `CylinderGeometry(0.02, 0.02, 2.1)` white, flag a small `PlaneGeometry(0.6, 0.4)`
  colored `#ffce3a` attached at the top. Cup: `CircleGeometry(0.054)` `#111111` at
  `heightAt(pin) + 0.002`.
- Aim line + landing ring (**rewritten Part 9A**): shown on the first `pointerdown` in the view,
  kept through the swing, hidden at launch. Aim line: a 0.14 m-wide RIBBON quad strip hugging the
  terrain from the ball to 200 m along â, `#ffffff` opacity 0.9 - NOT a `THREE.Line`, whose width
  never renders on mobile GPUs. Landing ring: `RingGeometry(2.0, 2.6, 40)` `#ffce3a` opacity 0.85,
  laid on the terrain at `club.targetCarry × LIE[lie].speed` metres from the ball along â (the
  putter uses its 36 m roll). Predicted carry uses the club's full target carry - power is
  unknown at address.

### 10.2 Camera (`camera.js`) - rewritten Part 9A

`PerspectiveCamera(_, w/h, 0.1, 1500)` with a **50° HORIZONTAL** field of view: three.js's `fov`
is vertical, so `applyHFov(camera)` derives it from the aspect on every resize. States, all with
position and lookAt targets, tweened with `t' = 1 - (1 - t)³`:

| State | Position (ball B, aim direction â, up ŷ) | LookAt | Notes |
|---|---|---|---|
| intro | flies `hole.intro.from` → `hole.intro.to` | pin → tee | 1.6 s, tap skips; plays every hole |
| address | `B - 16â + 9ŷ` | nominally `B + 70â` | 0.6 s in. Landing zone and hazards readable |
| putt | `B - 5â + 3ŷ` | nominally `B + 12â` | 0.6 s in |
| flight | each frame: `lerp(cam, B - 10â + 5ŷ, 0.06)`; lookAt `B + 0.6ŷ` | ball | continuous |
| rest | `B - 16p̂ + 9ŷ`, p̂ = ball → pin | nominally `B + 70p̂` | 0.8 s |

**The ball is pinned at 30% up from the bottom of the view** at address/putt/rest. That rule
decides the camera's PITCH (`_lookFor30`): the nominal lookAt above puts the ball at exactly 30%
only at a phone's portrait aspect with the 50° horizontal FOV; deriving the pitch from the rule
holds it at every viewport. When â changes (drag or map tap) the camera orbits to the new pose
over 0.25 s (`aimTo`). Camera never goes below `heightAt(cam.x, cam.z) + 1.0`.

### 10.3 Aim direction - rewritten Part 9A

`ui.js` keeps `targetBearingDeg` for the current shot: initially the bearing from ball to
`hole.target` if the ball is more than 30 m from `hole.target`, else bearing to pin. A
horizontal drag ANYWHERE in the view (address or putt) rotates it by `0.12° per px`; a tap or
drag on the overhead map sets it to the bearing from the ball to the tapped world point. Every
aim change goes through one path (`_setAimDeg`): redraw the aim line/ring/minimap and orbit the
camera. Aim is locked once the swing starts. The aim bar still adds `aimDeg` on top at tap time
until 9C removes it.

### 10.4 Overhead map (`minimap.js`) - Part 9A

A 2D `<canvas>` inside `.gf-view`, top-right, 116 × 156 px, 8 px margin, 10 px radius,
background `rgba(0,0,0,0.55)`. Fixed size; present during address/putt, `visibility: hidden`
during flight (never `display`, so nothing reflows). Renders the hole's `surface` grid rotated so
the tee-to-pin line is vertical (pin at top), cropped to the terrain bounds, fitted to the panel
(one sample per destination pixel through the inverse transform), colours from `render.js`'s
exported `COL`, OB as the panel background. **The map's x axis is MIRRORED relative to world x**:
a three.js camera looking along +z has world +x on its left, so world +x is drawn to the map's
left - that is what makes "tap left of the fairway" rotate the 3D view left. Overlays: ball (white
4 px dot), pin (5 px `#ffce3a` flag), aim line ball → landing ring, landing ring (`#ffce3a`
circle). Tap/drag sets â through the same inverse transform. Pure drawing, redraws only when
`(ball, aimDeg, carryM, pin)` change; the base raster is built once per hole.

---

## 11. Stats

`js/game-stats.js`:

```js
function ensureGf(g) {
  if (!g.gf || typeof g.gf !== 'object') g.gf = {
    rounds: 0, holes: 0, strokes: 0, points: 0,
    birdies: 0, eagles: 0, aces: 0, longestDriveYd: 0, bestRoundByCourse: {}
  };
  for (const k of ['rounds','holes','strokes','points','birdies','eagles','aces','longestDriveYd'])
    if (!Number.isFinite(g.gf[k])) g.gf[k] = 0;
  if (!g.gf.bestRoundByCourse || typeof g.gf.bestRoundByCourse !== 'object') g.gf.bestRoundByCourse = {};
}
// call ensureGf(st.games.golf) from normalize() alongside the other ensureXx calls

export function recordGolf(difficulty, extras) {
  const st = loadStats();
  if (!st.games.golf) st.games.golf = {};
  const g = st.games.golf;
  const e = extras || {};
  bumpTotals(g, normDiff(difficulty), (e.points || 0) >= 0);
  ensureGf(g);
  g.gf.rounds += 1;
  g.gf.holes += e.holes || 0;
  g.gf.strokes += e.strokes || 0;
  g.gf.points += e.points || 0;
  g.gf.birdies += e.birdies || 0;
  g.gf.eagles += e.eagles || 0;
  g.gf.aces += e.aces || 0;
  g.gf.longestDriveYd = Math.max(g.gf.longestDriveYd, e.longestDriveYd || 0);
  if (e.courseId && Number.isFinite(e.strokes)) {
    const prev = g.gf.bestRoundByCourse[e.courseId];
    g.gf.bestRoundByCourse[e.courseId] = Number.isFinite(prev) ? Math.min(prev, e.strokes) : e.strokes;
  }
  saveStats(st);
}
```
(`loadStats`, `saveStats`, `bumpTotals`, `normDiff` are whatever the existing file names those
helpers; use the exact existing names.)

`longestDriveYd` = `carryM / 0.9144` of any tee shot with the driver or 3-wood that finished
on FAIRWAY, GREEN, FRINGE or TEE (not rough/sand/water).

`js/players-agg.js`, inside `aggregatePlayers()`'s per-game merge, a `gf` branch: sum
`rounds, holes, strokes, points, birdies, eagles, aces`; `longestDriveYd = Math.max`;
`bestRoundByCourse` merged key-by-key with `Math.min`.

`js/game-stats-ui.js`, My Stats card for golf, in this order: **Skill level** (`points`, large,
signed), Rounds, Avg strokes per round (`strokes / rounds`, one decimal, dash if 0 rounds),
Birdies, Eagles, Aces, Longest drive (yd), then one row per course in `bestRoundByCourse`
("Harbor Links: 39").

`js/leaderboard-ui.js` `GAME_META`: `{ id: 'golf', labelKey: 'game_title_golf' }`. The
leaderboard's per-game sort key for golf, if the file supports one, is `gf.points`.

---

## 12. Tests and tools

### 12.1 `golf/js/test.js` (run with `node golf/js/test.js`; also picked up by `run-all-tests.mjs`)

1. **Heightfield mapping**: build hole 1, drop a ball (zero velocity) at `(0,5,0)`, `(20,5,100)`,
   `(-30,5,250)`; assert `rest.y ≈ heightAt + 0.02134` within 0.01.
2. **Determinism**: same `simulateShot` input twice → `rest` identical (`===` on all three).
3. **Carry table**: flat terrain (a hole def with no hills, `hills: []`, huge fairway), each
   club at power 1, spin 0, no wind: `carryM` within ±5% of §5 targets. Putter: `totalM` on
   GREEN within ±5% of 36.
4. **Reachability, per hole**: from the tee with the auto-selected club at power 1.0 and
   aim 0 toward `target`: `rest` surface ∈ {FAIRWAY, FRINGE, GREEN}. Then from `target` with
   the auto-selected club at power 1.0 aimed at the pin: rest within 25 m of the pin and not
   WATER/OB.
5. **Putt sweep, per hole**: from 8 points on a 4 m circle around the pin, sweep power 0.05
   to 0.6 in 0.05 steps aimed straight at the cup: at least one holes out.
3c. **Sidespin** (Part 9B): flat hole, driver, fairway, power 1, no wind. `curve01 = +1` lands
   25-45 m right (+x) of the straight shot and 5-15 m shorter; `-1` mirrors within the same
   bands; a putt is bit-identical at `curve01` 0 and 1.
6. **Points table**: `holePoints` for `d = -3..3` → `8,5,2,0,-1,-3,-3`.
7. **Meters**: `pos(0,T)=0`, `pos(T,T)=1`, `pos(2T,T)=0` within 1e-9.
8. **Fixture replay**: for every course, for every shot in `fixture.json`, simulate and assert
   `rest` within 0.02 m of the recorded value. Any failure prints the hole, shot index, expected
   and actual.
8b. **Bit identity** (Part 9B): every fixture shot WITHOUT `curve01`, re-simulated with an explicit
   `curve01: 0`, must reproduce its recorded `rest` exactly (`===` on x, y, z). This is the guard
   that the sidespin edit left every straight shot untouched; it ran green against the pre-9B
   fixture BEFORE that fixture was regenerated.

Fixture format:

```json
{ "courseId": "harbor", "engine": 1,
  "shots": [ { "hole": 1, "input": { ...simulateShot input... }, "rest": [x, y, z], "outcome": "stop" } ] }
```
`refixture.mjs <courseId>` generates 8 shots per hole (tee shot with driver/3w/5i at power 1,
0.8, 0.6 at aim 0; one from `target` with the auto club; two putts from 3 m and 8 m; and, since
Part 9B, two curved driver tee shots at `curve01 = +0.6` and `-0.6`, appended after the six
straight ones so their indices never move) and writes the file. **Regenerating a fixture is a
deliberate act**; the commit that does it must say what physics change caused it and which
holes' outcomes changed.

### 12.2 `golf/tools/sweep-carry.mjs`

Prints a table: club × power (1.0, 0.9, 0.8, 0.7, 0.6) → carry m, total m, hang time s, apex m.
Then the same at spin01 = -1 and +1 for the driver, 7i, PW. Uses the flat test hole. Header line
prints the current `SPIN_BRAKE` value (added Part 2), so the table is self-describing about which
tuning pass produced it.

### 12.3 `golf/tools/preview.html`

Standalone page: `<select>` of holes from the registry, renders the terrain and props with
`render.js` and an orbit-style drag camera (write a 30-line drag orbit; do not import
OrbitControls). No physics, no game shell. Used to eyeball a hole.

---

## 13. UI

### 13.1 Layout (reference 393 × 773, immersive, every region fixed for the whole session)

```
  0 –  56  .gf-top      back affordance (left, hub's floating back pattern) · "Hole 1 · Par 4 · 360 yd" (center) · wind: arrow rotated to wind bearing + "8 mph" (right)
 56 – 100  .gf-card     nine cells 36 px wide: hole number top, strokes bottom once holed; cell tint by result (§13.3); a 10th cell at right shows round points, signed
100 – 590  .gf-view     the canvas. Overlays inside it, all absolutely positioned, fixed size:
                        .gf-dist  (top-left inside view, 12 px in): shot distance during flight, "137 yd", updates each frame from the sample's straight-line distance
                        .gf-flash (centered, 70% down, 220 × 44 px box, empty most of the time): result word or surface label, 700 ms in, hold 900 ms, 300 ms out
 590 – 640  .gf-bar     club chip (left, 88 px, tap opens .gf-clubs row in the same 50 px band, replacing the bar contents; tap a chip or outside to close) · pin distance "143 yd" (center, 28 px font) · lie label "Fairway" (right)
 640 – 773  .gf-meters  three .gf-meter rows, each 32 px tall, 10 px gap, 16 px side margins. Row = track (rounded, 8 px tall centered) + marker (4 × 24 px pill) + for power the sweet band (a lighter segment) + a 6 px triangle notch at the sweet band start + (2026-09-03) a label naming the meter (AIM / POWER / SPIN, `meter_*` strings, 11 px uppercase) in the row's top 12 px, above the track, so the row stays 32 px
```

Height budget is exact; use `100dvh` and scale the view region to absorb any difference on
other phone sizes, never the top/card/bar/meters bands.

**Safe area and the hub's back pill (Part 9A).** Every band height above is measured BELOW the
play screen's own padding: `.gf-play` (the `position: fixed` container - padding on the in-flow
`.gf-root` can never reach it) gets `padding-top: max(env(safe-area-inset-top, 0px),
var(--gf-hub-pad, 0px))` and `padding-bottom: env(safe-area-inset-bottom, 0px)`. The hub draws
its own floating back pill for immersive games at `max(safe-area-top, 54px)` × 10 px
(`css/hub.css` `.hub-top-immersive`); `ui.js` sets `--gf-hub-pad: 54px` when mounted in the hub
so the pill always lands inside the top strip's reserved box - on a notch phone AND a no-notch
one. The top strip reserves its **left 104 × 56 px** for it (`.gf-top__slot`): hole label
centred in the remaining width, wind at right, nothing of the game's draws in the box. Standalone
(`golf/index.html`, no hub), the game's own back button sits inside that box instead; in the hub
it is not rendered at all (no duplicate). The scorecard strip therefore sits fully below the pill.
Both `index.html`s carry `viewport-fit=cover`. The overhead map (§10.4) is absolutely positioned
inside `.gf-view`, fixed 116 × 156, and hides with `visibility`, so it can never shift a band.

### 13.2 States shown, never told

- Which meter is live: live row at full opacity with a moving marker; done rows at full opacity
  with a frozen marker; pending rows at 35% opacity with no marker. On green, the spin row is
  at 35% with no marker for the whole shot.
- Sweet-band hit (power tap inside the band): the power row's track pulses `#ffce3a` once,
  200 ms.
- Penalty: `.gf-flash` shows "Water +1" / "OB +1" in `#ffce3a`.
- No sentences anywhere. Ever.

### 13.3 Colors and shapes (colorblind rule: never hue alone)

Scorecard cell results: eagle or better `#ffce3a` with a filled circle; birdie a hollow circle;
par no mark; bogey a hollow square; double or worse a filled square. Tints are the hub's
`--gh-*` surface tokens; the shapes carry the meaning.

### 13.4 Setup screen (first open or after a round)

Standard hub boxed card, not immersive until "Play" is tapped: course tiles (name, par, best
score if any; locked courses greyed with a lock glyph), difficulty tier control using
`diffShapeSVG()`, Play button. If an autosaved round exists, the card shows a "Resume" primary
button and "New round" secondary instead.

### 13.5 Round summary

Table (hub `.gh-*` table styling): rows = 9 holes + Total; columns Hole, Par, Strokes, Pts.
Below: "Skill level  +12 → +19" (before → after, signed). Buttons: Play again, Back.

### 13.6 Strings (`strings.js`)

Keys, English values; provide Spanish for all:

```
title Golf · play Play · resume Resume · new_round New round · back Back · again Play again
hole Hole · par Par · yd yd · mph mph
lie_tee Tee · lie_fairway Fairway · lie_rough Rough · lie_fringe Fringe · lie_green Green · lie_sand Sand · lie_water Water · lie_ob OB
res_ace Ace · res_albatross Albatross · res_eagle Eagle · res_birdie Birdie · res_par Par · res_bogey Bogey · res_double Double · res_triple Triple
pen_water Water +1 · pen_ob OB +1
skill Skill level · strokes Strokes · pts Pts · total Total
diff_casual Casual · diff_standard Standard · diff_pro Pro
course_harbor Harbor Links · locked Locked
stats_rounds Rounds · stats_avg Avg strokes · stats_birdies Birdies · stats_eagles Eagles · stats_aces Aces · stats_drive Longest drive · stats_best Best round
```
Plus `game_title_golf` = Golf in the hub's shared strings file for `GAME_META`.

### 13.7 Persistence (`gamehub.golf.v1`)

```json
{ "difficulty": "standard", "lastCourse": "harbor", "round": null | <game.js state> }
```
Autosave the round after every `simulateShot` result is applied and after every hole change.
`isInProgress()` returns `false`.

### 13.8 Input binding

Tap capture on `.gf-view` and `.gf-meters` via `pointerdown` on the game root only. `.gf-view`
gets `touch-action: none` (it hosts the aim drag); everything else `touch-action: manipulation`.
Distinguish tap from drag: a `pointerup` within 8 px and 250 ms of `pointerdown` is a tap.
Aim drag only in `address` phase. Use `onViewportResize` from `js/viewport.js` for resize.

---

## 14. Parts, order, acceptance, and model

| Part | Scope | Files | Done when | Model |
|---|---|---|---|---|
| 1 | Physics core, no graphics | `terrain.js`, `flight.js`, `physics.js`, `clubs.js`, `meters.js`, `test.js` (tests 1,2,3,7), `sweep-carry.mjs`, vendor copy | Tests 1,2,3,7 pass; `sweep-carry` table printed in the report | Sonnet 5. **If test 3 can't be brought within ±5% by tuning `speed`, `roll`, `Cl` after two attempts, stop; Matt switches to Opus for this part** |
| 2 | Course 1 data + reachability | `courses/`, `test.js` tests 4,5 | Tests 4,5 pass on all 9 holes; any hole edits listed in `DECISIONS.md` | Sonnet 5 |
| 3 | Rendering + camera + preview | `render.js`, `camera.js`, `tools/preview.html`, `index.html` shell | `preview.html` shows every hole; ball flies with follow-cam on hole 1 in the standalone page | Sonnet 5. **If WebGL context leaks on repeated open/close (check `about:gpu` or console warnings) after one fix attempt, stop; Opus for teardown** |
| 4 | Meters + HUD + one playable hole | `ui.js`, `css/golf.css`, `strings.js` | Hole 1 playable start to finish; screenshot at 393×773 shows the §13.1 bands at exact pixel heights; zero layout shift verified by toggling every overlay | Sonnet 5 |
| 5 | Round rules, autosave, summary, setup | `game.js`, `ui.js` | Full 9 holes; close and reopen mid-round resumes at the same shot; test 6 passes | Sonnet 5 |
| 6 | Fixture + refixture | `refixture.mjs`, `fixture.json`, test 8 | Test 8 passes; `run-all-tests.mjs` green | Sonnet 5 |
| 7 | Hub wiring + stats | `js/hub.js`, `js/game-art.js`, `js/game-stats.js`, `js/game-stats-ui.js`, `js/players-agg.js`, `js/leaderboard-ui.js`, shared strings, `js/admin-config.js`, `sw.js` | `test-game-conventions.mjs` and `validate-sw-assets.mjs` pass; My Stats and leaderboard show golf; course release state flips from admin page | Sonnet 5 |
| 8 | Ship | `golf/CLAUDE.md`, `released` date, `CACHE` bump | Deployed as `testing`; Matt plays a round | Sonnet 5 |

Report format at the end of each part: what was built, test output pasted verbatim, any
deviation from this document with the reason, and any `DECISIONS.md` entries added. Nothing
else.

### Hub wiring specifics for Part 7

`GAMES` entry:

```js
{
  id: 'golf',
  released: 'YYYY-MM-DD',           // set on ship day (Part 8)
  title: { en: 'Golf', es: 'Golf' },
  blurb: { en: 'Nine holes. Stop the bar for aim, power and spin.',
           es: 'Nueve hoyos. Para la barra para apuntar, potencia y efecto.' },
  module: '../golf/js/ui.js',
  immersive: true,
  accent: '#2E7D4F',
  art: GAME_ART["golf"],
},
```

`GAME_ART.golf`: SVG, `viewBox="0 0 160 90"`, full-bleed rect `#2E7D4F`, a lighter fairway
shape curving from bottom-left to a green circle upper-right, a flag (`#ffce3a`) on the green,
a white ball bottom-left. Keep it to ~12 elements.

`js/admin-config.js`: add a `golf.courses` map, `{ harbor: 'testing' }` default, read by
`ui.js` at setup: `open` → playable, `unlockable` → playable if the previous course in
`COURSES` order has a `bestRoundByCourse` entry (any completed round), `testing` → visible only
to the dev profile and results recorded with `difficulty: 'practice'` (whatever bucket Skeeball
already uses for testing machines; use the same). Missing key → `testing`. Follow the exact
shape Skeeball's machine release state uses so the admin page's existing controls can be
extended with one more section rather than a new mechanism.

`sw.js` `ASSETS`: every path under `golf/` except `tools/` and `test.js`. Bump `CACHE` past
`origin/main`. Run `node validate-sw-assets.mjs`.

---

## 15. Things you must not do

- Edit any file outside the list in Part 7 and the `golf/` folder.
- Add a dependency, a build step, a bundler, or an `npm install`.
- Use `Math.random` in `terrain.js`, `physics.js`, `flight.js`, or `game.js`.
- Change a physics constant to make a course test pass (fix the course). **Exception (added
  2026-09-02): a constant may be retuned when a stated sanity band is violated, WITH EVIDENCE -
  e.g. Part 2's finding that a driver rolled ~500m past a 240m carry into OB, against no stated
  band anywhere claiming that was intended. This is not a loophole for "the course test is
  inconvenient" - the evidence and the violated band both have to be real and written down. See
  DECISIONS.md#rollout-tuning-part2.**
- Change a course to make a carry test pass (fix `speed`/`roll`/`Cl`).
- **Touch `physics.js` or `flight.js` from Part 3 onward.** Physics is frozen as of Part 2's end
  (2026-09-02) - every constant in both files now has a test behind it (`test3`, `test3b`, `test4`,
  `test5`). The §15 exception above was for Parts 1-2's tuning work specifically and does not
  carry forward: if a later part finds a reason it needs a physics change, that is a stop-and-ask,
  not something to decide alone.
- Add any instructional text to the UI.
- Let any layout band change height during play.
- Regenerate `fixture.json` without saying why in the commit message.
- Start the next part before being told.
