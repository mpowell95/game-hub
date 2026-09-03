# Golf Part 9: playtest fixes and the swing rebuild

Read `GOLF-HANDOFF.md`, `golf/DECISIONS.md`, and every file under `golf/js/` before starting.
This document replaces §2 (meters), §10.2 (camera), §13.1 (layout), §13.2 and §13.6 (strings)
of `GOLF-HANDOFF.md`, and amends §7.3 and §10.1. When done, rewrite those sections of the repo's
`GOLF-HANDOFF.md` to match; delete the old §2 entirely.

Four sub-parts, in order, each with its own acceptance. Stop and report after each.

| Sub-part | Scope | Model |
|---|---|---|
| 9A | Layout and safe area, visuals, aiming camera, overhead map | Sonnet 5 |
| 9B | Sidespin in physics + fixture regeneration | Opus 5 (touches frozen physics) |
| 9C | The 3-click swing replacing the three meters | Sonnet 5 |
| 9D | Playtest pass on device with Matt | Sonnet 5 |

---

## 9A. Layout, visuals, camera, overhead map

### 9A.1 Safe area and the hub back button (bug)

Observed: the hub's floating back pill covers scorecard cells 1 and 2, and the top strip sits
under the iOS status bar.

- `.gf-root` gets `padding-top: env(safe-area-inset-top, 0px)` and
  `padding-bottom: env(safe-area-inset-bottom, 0px)`. All band heights are measured below
  that padding. `index.html` already has `viewport-fit=cover`; confirm the hub shell does too.
- Find how the hub positions its floating back button for immersive games (read `js/hub.js`
  and `css/ui.css`; Battleship and Skeeball live with it). The game's top strip reserves the
  left 104 px for it: hole label centered in the remaining width, wind at right. Nothing of the
  game's draws in that 104 × 56 box. If the hub instead expects the game to render the back
  affordance itself, do that inside the box and remove any duplicate.
- Scorecard strip moves fully below the top strip; verify with `getBoundingClientRect()` on a
  real phone-sized viewport that no scorecard cell overlaps the back pill.

### 9A.2 Sky and lighting

- Sky is always daytime. Remove the dark-mode sky palette. Gradient `#7fb8ff` at the zenith to
  `#dceeff` at the horizon, plus a soft sun disc (white sprite, radius 6 m at 400 m, additive).
  Dark mode still governs the HUD bands only.
- Add `scene.fog = new THREE.Fog(0xdceeff, 180, 700)` so distance reads.
- Directional light intensity 1.3, hemisphere 0.7.

### 9A.3 Trees and ground

- Tree geometry: cone radius 3.2, height 9, on a trunk radius 0.35 height 2.2. Scale range
  0.9 to 1.4.
- Placement, in `terrain.js`: keep the existing random rough placement (`trees.count`), and
  ADD a fairway belt: walk the fairway path in 12 m steps and place a tree on each side at a
  lateral offset of `width/2 + 8 + rng × 6` m, skipping any position that lands on
  GREEN/FRINGE/SAND/WATER/TEE or within 20 m of the pin. Seeded from `rng(seed + 11)`.
  Belt trees are visual only, like all trees.
- Ground: rough vertex color darkens to `#3f6a2e`; fairway stripe contrast to ±6%; add a
  low-frequency color noise (±4% brightness, 9 m wavelength, seeded) on rough and fairway so
  the ground stops reading as flat paint.

### 9A.4 Aiming camera

Replaces §10.2's `address` and `putt` states.

| State | Position (ball B, aim direction â, up ŷ) | LookAt | Notes |
|---|---|---|---|
| address | `B - 16â + 9ŷ` | `B + 70â + 0ŷ` | FOV 50. Landing zone and hazards readable |
| putt | `B - 5â + 3ŷ` | `B + 12â` | FOV 50 |
| flight | `lerp(cam, B - 10â + 5ŷ, 0.06)`, lookAt `B + 0.6ŷ` | ball | unchanged shape, higher |
| rest | `B - 16p̂ + 9ŷ` | `B + 70p̂` | p̂ = ball to pin |
| intro | unchanged | | plays every hole, tap skips |

Camera stays above `heightAt + 1.0`. When the aim direction changes (drag or map tap), the
camera orbits to the new `â` with a 0.25 s ease; the ball stays fixed on screen at 30% up from
the bottom of the view.

Drag-to-aim: a horizontal drag ANYWHERE in the view (not just the upper half) rotates `â` at
0.12° per px. On `pointerdown` in the view, show a 1 px aim line from the ball to 200 m and a
landing ring at the selected club's carry, both at full opacity; they stay visible through the
swing and hide at launch. Aim line: `#ffffff` opacity 0.9, 2 px wide (use a thin
`TubeGeometry` or a ribbon quad, not `THREE.Line`, so width renders on mobile). Landing ring:
`RingGeometry(2.0, 2.6, 40)` `#ffce3a` opacity 0.85, laid on the terrain at the predicted carry
point along `â`, at `club.targetCarry × LIE[lie].speed` metres from the ball.

### 9A.5 Overhead map inset

- A 2D `<canvas>` overlay inside `.gf-view`, top-right, 116 × 156 px, 8 px margin, 10 px
  radius, background `rgba(0,0,0,0.55)`. Fixed size, always present during address/putt,
  hidden during flight.
- Renders the hole's `surface` grid rotated so the tee-to-pin line is vertical (pin at top),
  cropped to the hole's bounds, one pixel per cell scaled to fit. Colors: use the `COL` table
  from `render.js`, OB drawn as the panel background.
- Overlays: ball (white dot 4 px), pin (a 5 px `#ffce3a` flag mark), the aim line from ball
  along `â` to the landing ring, the landing ring as a 4 px `#ffce3a` circle.
- Tap on the map sets `â` to the bearing from the ball to the tapped world point (invert the
  same transform). Drag on the map does the same continuously. The 3D camera orbits to match.
- Rendered by a new `golf/js/minimap.js`; pure drawing, takes `(terrain, ball, aimDeg,
  carryM, pin)`; redraws only when one of those changes.

### 9A acceptance
Screenshots at 393 × 852 (iPhone with notch) on the real hub: no overlap between the back pill
and any game element; sky visible and daytime in dark mode; trees line hole 1's fairway; from
the tee on hole 1 the water, both bunkers, and the green are all visible in the address view;
the minimap shows the hole with the aim line; tapping the minimap left of the fairway rotates
the view left. Zero layout shift toggling every overlay.

---

## 9B. Sidespin (Opus 5)

The curve on a missed impact tap needs sidespin, which the model does not have. This is the
one approved edit to frozen physics. A shot with `curve = 0` must produce bit-identical results
to today, so the existing fixture stays valid; add curved shots to it after.

- `simulateShot` input gains `curve01` in -1..+1 (negative = hook left for a right-hander,
  i.e. ball curves toward -x when travelling +z; positive = slice right).
- Spin axis: today `axis = travelDir × up` (pure backspin). New:
  `axis = normalize(rotateAboutY(travelDir × up, -curve01 × SIDE_TILT))` with `SIDE_TILT = 35°`.
  The Magnus force `spinAxis × vr` then has a lateral component. Verify direction: with
  `curve01 = +1` the ball's `x` at landing must be greater than with `curve01 = 0` (slices go
  +x when travelling +z). If it comes out reversed, flip the sign once and record it.
- Backspin magnitude for the vertical component uses `cos(tilt)` of the full omega, so a
  strongly curved shot flies a little lower and shorter. Expected: driver at `curve01 = 1`
  lands 25 to 45 m right of the straight shot and 5 to 15 m shorter. If outside that band,
  tune `SIDE_TILT` in 20 to 50 and record the final value.
- `SIDE_TILT` lives in `flight.js` next to `AIR`. `curve01` defaults to 0 everywhere, including
  the putter (ignored for putts).
- Tests: add test 3c (the band above) and a `curve01 = 0` bit-identity check against the
  existing fixture BEFORE regenerating. Then extend `refixture.mjs` with two curved driver
  shots per hole (`curve01 = ±0.6`) and regenerate. Five identical runs.
- Update `GOLF-HANDOFF.md` §7.3 and §12 in the repo.

---

## 9C. The 3-click swing

Deletes the three meters. `meters.js` is rewritten (still pure, still DOM-free).

### 9C.1 Controls on screen

Bottom band (was 133 px of meters) becomes a 64 px `.gf-ctl` band with four fixed slots,
left to right:

| Slot | Width | Content |
|---|---|---|
| Club | 96 px | club chip; tap opens the existing club row overlay |
| Distance | flex | pin distance, large, plus lie label under it in small text |
| Spin | 132 px | three-segment control, labels `Back` / `Straight` / `Top`; default `Straight`; disabled (dimmed, still occupying space) for putts |
| Swing | 88 px | a single round button with a golf-ball icon, labeled `Swing` under it. Not required: a tap anywhere in the view also advances the swing. The button exists so there's an obvious thing to press |

Reclaimed height goes to `.gf-view`. New reference bands at 393 × 773 (below the safe-area
padding): top 56, card 44, view remainder, bar removed (its contents moved into `.gf-ctl`),
ctl 64.

### 9C.2 The gauge

A vertical gauge inside `.gf-view`, right edge, 22 px wide, from 18% to 82% of the view height,
always present (dimmed when idle so nothing shifts). Elements, bottom to top:

- **Impact line** at the bottom: a 3 px `#ffce3a` bar across the gauge, with a 14 px tall
  sweet zone above it tinted `#ffce3a` at 25%.
- **Fill** rising from the impact line; height = power.
- **Marker**: a 4 px white bar that rides the top of the fill during the backswing and then
  falls back to the impact line on the downswing.
- **Power ticks**: a short tick at 100% (top) and at the auto-suggested power for the current
  club and pin distance (`suggested01 = clamp(distToPin / (club.targetCarry × LIE.speed), 0.2, 1)`),
  drawn in white at 60%. This replaces Golden Tee's "you're aiming here" feel for distance.
- **Labels**: the word `Power` vertically along the outside of the gauge, 11 px, 60% opacity.
  Single word, no sentences.

### 9C.3 Sequence

`meters.js` exports pure functions of time; `ui.js` samples them each frame and on tap.

```
idle -> [tap 1] -> backswing -> [tap 2] -> downswing -> [tap 3] -> launch
```

- **Backswing**: fill rises from 0 to 1 over `T_up` seconds with `pos(t) = 1 - (1 - t/T_up)²`
  (fast start, eases at the top). If it reaches 1 with no tap, it holds at 1 for 0.35 s then
  falls back to 0 over 0.4 s and returns to idle (a "no shot" reset, no stroke counted).
- **Tap 2** freezes `power01 = pos(t)`. Minimum accepted power 0.05.
- **Downswing**: the marker falls from `power01` to 0 over `T_down × power01` seconds
  (constant speed, so a full swing takes `T_down`), then continues BELOW the impact line to
  -0.12 (drawn as the marker dropping past the bar) over the same speed. Tap 3 anywhere in
  the downswing records `miss = markerPos(t)` (positive = early, negative = late). No tap 3 by
  the time the marker reaches -0.12 counts as `miss = -0.12`.
- **Curve** from the miss: `curve01 = clamp(miss / MISS_FULL, -1, 1)` with `MISS_FULL = 0.12`,
  and the sign convention: early (positive miss) = hook (curve01 negative), late = slice.
  Inside the sweet zone (`|miss| ≤ SWEET`), `curve01 = 0`.
- **Accuracy** also nudges the launch direction: `dirDeg += curve01 × 3°` (a slice starts
  right and curves further right, like real golf).
- **Spin** from the segment control: `Back → spin01 = -1`, `Straight → 0`, `Top → +1`, fed to
  the existing `spin01` input unchanged. (No third meter; the brief's "spin vs straight"
  control is this segment.)
- **Putts**: two taps only. Tap 2 launches immediately with `curve01 = 0`; the downswing is
  cosmetic and cannot be tapped. Spin segment disabled.
- **Casual difficulty**: two taps for every shot (tap 2 launches, accuracy auto-perfect).
  Standard and Pro: three taps.

Timing per difficulty (`DIFF` in `meters.js`; the old fields are deleted):

| | T_up | T_down | SWEET (fraction of gauge) | aimRange kept? |
|---|---|---|---|---|
| Casual | 1.6 s | n/a | n/a | aim is by drag only; the aim meter is gone at every tier |
| Standard | 1.3 s | 0.55 s | 0.035 | |
| Pro | 1.0 s | 0.42 s | 0.020 | |

`windMax` values stay as they are.

### 9C.4 Feedback

- On tap 2: the fill's top edge flashes white once (120 ms).
- On tap 3 in the sweet zone: the impact line pulses `#ffce3a` (200 ms), and the gauge shows
  `Perfect` for 700 ms in the reserved feedback slot (same fixed box as before, just
  repositioned next to the gauge). Outside: `Hook` or `Slice` in white. A missed tap 3 shows
  `Slice`.
- During flight the shot-distance counter stays where it is; the gauge dims.

### 9C.5 Tap capture

`pointerdown` anywhere in `.gf-view` that is NOT a drag (same 8 px / 250 ms rule) and not on
the minimap advances the swing. The Swing button advances it too. During backswing and
downswing, drags are ignored (aim is locked once the swing starts).

### 9C.6 Persistence, tests, strings

- `gamehub.golf.v1` gains `spinDefault: 'straight'` (remembered between shots within a
  round, reset per round).
- `meters.js` tests replace test 7: `pos(0)=0`, `pos(T_up)=1`, marker reaches 0 at exactly
  `T_down × power01` after tap 2, `curve01` sign convention, sweet-zone zeroing, Casual is
  two-tap.
- Strings added: `swing Swing`, `power Power`, `spin_back Back`, `spin_straight Straight`,
  `spin_top Top`, `fb_perfect Perfect`, `fb_hook Hook`, `fb_slice Slice`, with Spanish
  `Swing / Potencia / Efecto atrás / Recto / Efecto adelante / Perfecto / Hook / Slice`.
  Remove every meter-era string that is no longer referenced.

### 9C acceptance
On the real hub at 393 × 852: hole 1 played through with three taps per full shot and two per
putt; a deliberately late third tap produces a visible slice on the minimap trail and in 3D;
Casual plays with two taps; the gauge, ctl band, and minimap never move; `node golf/js/test.js`
green; `GOLF-HANDOFF.md` sections rewritten as listed at the top of this file.

---

## 9D. Device playtest with Matt

Not a build step. After 9C deploys to testing, Matt plays a round and sends screenshots. The
checklist he'll be judging against:

1. Can I tell what to do on the tee without being told? (aim by drag/map, club, spin, swing)
2. Does a drive look like a drive from the high camera, and does the follow-cam sell the flight?
3. Is the impact tap fair at Standard? (should hit the sweet zone about 1 in 3 tries after a
   few holes)
4. Does the minimap match what the 3D view shows?
5. Does anything move?

Expect a 9E with numbers to adjust (`T_up`, `T_down`, `SWEET`, camera distances). Those are all
single constants by design.
