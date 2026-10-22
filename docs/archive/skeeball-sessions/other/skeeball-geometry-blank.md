# Skeeball geometry — blank worksheet

Fill in whatever you want changed. **Leave a row blank to keep it as it is** — I'll only touch
rows you write in. Rows marked *(derived)* are calculated from other rows, so you can't set them
directly; write in the rows they come from instead, or just tell me the derived number you want
and I'll work backwards.

Units are metres unless the row says otherwise. Angles: write degrees or radians, whichever you
prefer, just say which.

---

## Coordinate system (reference — nothing to fill in)

| Term | Meaning |
|---|---|
| Unit | metres |
| `y` | height above the lane surface |
| `z` | depth — 0 at the player's end, more negative going away |
| `u` | left/right across the board face, 0 = centreline |
| `v` | distance **up the slope** from the board's bottom edge |

---

## Ball

| Property | Your value | Code key |
|---|---|---|
| Radius | | `ballR` |
| Diameter | *(derived)* | — |
| Mass (kg) | | `ballMass` |
| On-screen diameter, at the serve (px) | *(derived)* | — |
| On-screen diameter, over the board (px) | *(derived)* | — |
| Start position (y, z) | | `physics.js` `startThrow` |

---

## Lane and ramp

| Property | Your value | Code key |
|---|---|---|
| Lane length (flat section) | | `laneLen` |
| Lane width | | `laneW` |
| Ball start → ramp foot | *(derived)* | — |
| Ball start → ramp crest | *(derived)* | — |
| Ramp length | | `humpLen` |
| Number of ramp segments | | `humpAngles.length` |
| Segment 1 angle | | `humpAngles[0]` |
| Segment 2 angle | | `humpAngles[1]` |
| Segment 3 angle | | `humpAngles[2]` |
| Segment 4 angle | | `humpAngles[3]` |
| Segment 5 angle | | `humpAngles[4]` |
| Segment 6 angle — **the launch angle** | | `humpAngles[last]` |
| Ramp crest height | *(derived)* | — |
| Ramp crest position (z) | *(derived)* | — |

> Note: the launch angle must stay **greater than the board angle** or the ball cannot get airborne
> at any power. Everything else here is free.

---

## The gap between ramp and board

| Property | Your value | Code key |
|---|---|---|
| Horizontal gap | | `troughLen` |
| Vertical offset (board lip above/below crest) | *(derived)* | — |
| Straight-line gap | *(derived)* | — |
| Gap in ball diameters | *(derived)* | — |
| Trough depth (the pit in between) | | `troughDepth` |

---

## Board

| Property | Your value | Code key |
|---|---|---|
| Angle from horizontal | | `boardTilt` |
| Length up the slope | | `boardLen` |
| Width | | `boardW` |
| Bottom edge position (y, z) | | `boardLipY` sets y |
| Top edge position (y, z) | *(derived)* | — |
| Side rail height | | `railH` |
| Big painted circle — centre (v) | | `ring.v` |
| Big painted circle — radius | | `ring.R` |
| Big painted circle — is it a solid wall? | | `ring.solid` |
| Wall height, if solid | | `ringH` |

---

## Holes

| Hole | `u` | `v` | Radius | Ring height | Value |
|---|---|---|---|---|---|
| 20 | | | | | 20 |
| 30 | | | | | 30 |
| 40 | | | | | 40 |
| 50 | | | | | 50 |
| 100 left | | | | | 100 |
| 100 right | | | | | 100 |
| *(add a row for another hole if you want one)* | | | | | |

| Related property | Your value | Code key |
|---|---|---|
| Hole diameter ÷ ball diameter | *(derived)* | — |
| Spacing between centre cups | *(derived)* | — |
| Effective capture radius (ball's **centre** must be within this) | *(derived)* | `r − 0.28 × ballR` |
| Capture speed margin | | `captureDrop` |
| Ring wall thickness (if height > 0) | | `collarThick` |
| Front-lip lowness (if height > 0; fraction of full height) | | `lipLowFrac` |
| 10-slot half-width in the trough | | `troughTenHalfW` |

---

## Aim

Two stages: the swipe becomes an `aim` value, then that value scales to a launch angle.

**Stage 1 — swipe → aim** (`ui.js`)

```
raw = clamp( swipe angle ÷ ______ , −1, +1 )
aim = sign(raw) × raw ^ ______
```

**Stage 2 — aim → launch angle** (`physics.js`)

```
launch angle = aim × ______
```

| Property | Your value | Code key |
|---|---|---|
| Swipe angle needed for full aim | | `ui.js` divisor |
| Maximum launch deflection | | `aimMax` |
| Response curve exponent (1 = linear, 2 = squared) | | `ui.js` |

| Swipe angle off vertical | `aim` value | Launch angle off centre |
|---|---|---|
| 5° | *(derived)* | *(derived)* |
| 11° | *(derived)* | *(derived)* |
| 15° | *(derived)* | *(derived)* |
| 19° | *(derived)* | *(derived)* |
| 22° and beyond | *(derived)* | *(derived)* |

---

## Throw power

| Property | Your value | Code key |
|---|---|---|
| Launch speed at power 0 (m/s) | | `minSpeed` |
| Launch speed at power 1 (m/s) | | `maxSpeed` |
| Interpolation (by speed, or by energy/v²) | | `physics.js` `startThrow` |

---

## Anything else

Free text — describe what you want and I'll find the numbers.

```




```
