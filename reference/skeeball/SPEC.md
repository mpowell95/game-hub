# Skeeball — measurements taken off `Skeeball 1.MOV`

Source: `reference/skeeball/Skeeball 1.MOV`, 16.58s, 1206x2622 portrait, 60fps. A two-player
turn-based Skee-Ball inside a chat app (the top player pills, the `...` menu and the "Say hello..."
composer are the HOST APP's chrome, not the game — ignore them when cloning).

**Everything below is measured, not remembered.** Geometry is a fraction of the frame (W x H);
colors were sampled from the raw RGB of the frame at t=12.6s. Method: `ffmpeg -vf drawgrid` for a
10%/5% grid overlay, then a luminance-threshold scanline sweep to find edges, then per-pixel
sampling for hex values. Re-derivable — see `reference/README.md`'s ffmpeg recipes.

## What the reference DOES show

Five throws, two score popups (`120!`, `300!`), the multiplier badge in three different places, and
the turn handover ("claycors scored 660 points" / "Your Turn"). One camera, one lane, never moves.

## What it does NOT show — do not claim these match

No setup screen, no how-to screen, no round-transition screen, no end-of-match screen, no menu.
**The throw INPUT is never visible**: the recording only ever shows the ball already rolling, so
whether the real game uses a flick, a drag-and-release or a power meter is unknown. A flick up the
lane is our own choice, not a copy.

## Vertical structure (fractions of frame height)

| Band | y | Notes |
|---|---|---|
| Back wall | 0.00 – 0.28 | dark maroon, vertical gradient, lighter toward the bottom |
| Target board | 0.28 – 0.49 | the nested rings + the two corner cups |
| Lane | 0.49 – 1.00 | perspective trapezoid, runs off the bottom of the frame |

## The target board

Nested cream rings, each one higher up the frame and smaller than the one in front — the classic
skeeball ramp read as stacked ellipses. The number sits on the RIM FACE of its own ring.

| Element | Position | Size |
|---|---|---|
| `50` ring, top rim | y 0.287 | — |
| `50` ring, front lip | y 0.319 | — |
| `40` ring, front lip | y 0.359 | — |
| `30` ring, front lip | y 0.399 | — |
| `20` ring, front lip | y 0.433 | — |
| Outer apron front rim | y 0.475 | spans x 0.144 – 0.858 (**0.714 W**) |
| `10` label | y 0.443, x 0.50 | on the apron's front face, centered |
| `100` cup, left | centre x 0.259, y 0.305 | ~0.10 W wide, ~0.055 H tall |
| `100` cup, right | centre x 0.740, y 0.305 | same |

Ring pitch is even, ~0.040 H per step; the two `100` cups sit level with the `50`, hard against the
left and right edges of the board, as separate free-standing cylinders rather than part of the ring
stack. Ring openings read as thin dark ellipses (0.006 – 0.010 H tall) because the camera is nearly
level with the board.

## The lane

A trapezoid, essentially linear in y:

| y | Lane wood spans | Width |
|---|---|---|
| 0.49 (far, at the apron) | 0.253 – 0.746 | 0.493 W |
| 0.65 | 0.158 – 0.842 | 0.684 W |
| 0.86 (near, bottom) | 0.01 – 0.99 | 0.98 W |

So the near end is ~2x the far end. Rails sit OUTSIDE those edges: a yellow band carrying dark
diagonal hazard chevrons, ~0.07 W wide at the bottom, tapering with the lane. A thin dark navy
inner strip separates rail from wood. Beyond the rails, flat dark grey side walls.

## Colors (sampled hex)

| Element | Hex |
|---|---|
| Back wall, top | `#2F1518` |
| Back wall, bottom | `#602725` |
| Lane wood, far end | `#BC6942` |
| Lane wood, middle | `#9C5737` |
| Lane wood, near end | `#603622` |
| Rail yellow | `#FCFAAD` |
| Rail chevron dark | `#332A0A` |
| Rail inner navy strip | `#2B1E06` |
| Cream rim, lit face | `#FFF6E2` |
| Cream rim, top/shaded | `#EAE3B0` |
| Ring hole interior | `#48190C` |
| `10` apron floor | `#82421E` |
| Number text on rims | `#4A1710` |
| `100` cup face | `#EEDBB0` |
| Side wall grey | `#2E2E32` |

The lane's three wood values are one vertical gradient plus a dark vignette at the very bottom
edge, not three bands.

## The ball

Pale pink with darker pink speckles all over (reads as a sprinkled donut, deliberately cartoony
even in the reference). Diameter **0.068 W** at rest on the board apron, **~0.106 W** mid-lane —
i.e. it scales with the lane's own perspective, roughly 1.55x from far to near.

Balls not yet thrown queue as a vertical column on the LEFT rail, x ~0.02, y 0.60 – 0.78, drawn at
the near-end (large) size. Balls that came to rest without scoring sit on the apron in front of the
rings (two are visible at t=12.6s).

## The multiplier

A blue `x3` badge, white outline, bold, roughly 0.055 H tall. **It MOVES between throws** — seen
over the `40` ring, floating above the `50` ring, and over the LEFT `100` cup in three different
frames. It marks one target per throw; landing there is what produced the `300!` popup (100 x 3).

## Score feedback

On landing, a gold starburst plus the value in bold orange-red appears AT THE HOLE, e.g. `120!`,
`300!`, `+100`. Roughly 0.5s, then gone. Running total lives in the host app's player pill, so the
game itself shows no persistent score HUD in this recording — a clone needs its own.

## Turn handover

Full-width dark band across the lower half: "claycors scored 660 points", with the finishing
player's avatar over the board and a blue "Your Turn" pill appearing on the other player's pill.
`ROUND 1/3` sits bottom-right, small white caps, for the whole recording.

---

# The Collector's Edition machines (`IMG_3952`-`IMG_3960`, added 2026-08-11)

Nine screenshots of a DIFFERENT app from the recording above: the machine-select carousel of
"Skee-Ball Collector's Edition". **This is the real Skee-Ball brand look and it disagrees with the
video on almost every colour** - teal playfield and WHITE targets, not brown wood and cream. Matt's
instruction: make our board more like the CLASSIC one here. Where the two references conflict,
these images win for the board; the video still owns the lane's perspective and the throw feel.

## The nine machines

One unlocked (CLASSIC) and eight behind padlocks. **They are not recolours** - the target layout
itself changes, which is the strongest argument for boards being real content rather than skins:

| # | Board | Target layout |
|---|---|---|
| 3952 | **CLASSIC** (unlocked) | the standard: open oval ring + 4 stacked cups + two 100 tubes |
| 3953 | blue / gold stars | 30s and 50s inside star shapes, scattered across a wide field |
| 3954 | lime + magenta | ring stack again, different palette, 100 top-left only |
| 3955 | blue + gold cups | five cups scattered on a disc (10 / 50 20 50 / 50 / 10), no ring |
| 3956 | rainbow tiers | horizontal stepped bands, cups mounted on the SIDES at each tier |
| 3957 | Thanksgiving | turkeys scattered on a white field |
| 3958 | Christmas | targets hung on a tree, 100 at the top |
| 3959 | Easter | nests in grass (30/40/50/50), rabbit on the backboard |
| 3960 | Halloween | ring stack in orange, **and an LED `BALL  SCORE` marquee in the cabinet head** |

3960's marquee is worth calling out: it is exactly the "high score displayed at the top of the
machine" idea, and it means a score display in the cabinet head is authentic, not an invention.

## CLASSIC — measured (`IMG_3952`, 1206x2622)

Measured by luminance scanline over the raw RGB, same method as the video section. Pixel values are
in the source image; the ratios are what port.

**The camera looks noticeably further DOWN than the video's.** The 10 ring is an ellipse with
`height / width = 0.66`, where every ring in the video reads at about 0.30. That single number is
why the classic board looks like an open ring you can see into and the video's looks like stacked
bands, and it is the biggest single change needed.

| Element | Measurement |
|---|---|
| **10 ring** (open oval, not a bowl) | outer 236 x 156 px, centred (600, 1657). **ry/rx = 0.66** |
| ring tube thickness | ~38px, i.e. 0.16 x ring width |
| `50` cup | width 62 (0.26 x ring width), centre y 1550 |
| `40` cup | width 70 (0.30), centre y 1600 |
| `30` cup | width 78 (0.33), centre y 1650 |
| `20` cup | width 86 (0.36), centre y 1700 |
| cup pitch | an even 50px, i.e. 0.21 x ring width |
| `100` tubes | width ~36 (0.15 x ring width), height ~70, centres x 482 and 730, y ~1535 |
| where the 100s sit | **directly above the ring's widest points**, raised clear of it |
| white side rails | curved ramps at x ~427 and ~773 sweeping down to the lane |

The cups are open-topped white TUBES stacked up the middle, 20 nearest and 50 furthest, each
overlapping the one behind. The two 100 tubes stand free, taller and clear of the ring.

## CLASSIC — colours (sampled)

| Element | Hex |
|---|---|
| Playfield teal, lit centre | `#71A995` |
| Playfield teal, mid | `#618F7F` |
| Playfield teal, shaded | `#46655A` |
| Playfield teal, deep edge | `#334941` |
| Target white, lit | `#FFFFFF` |
| Target white, face | `#EDEAE8` |
| Target white, shaded | `#ACA7A6` |
| Target white, deep shade | `#7C8381` |
| Numbers | `#0A0A0A` (near black, not brown) |
| Cabinet side walls | `#111111` (black, ball-return mesh texture) |
| Cabinet inner trim | `#7D2324` deep red, darker `#4C191A` |
| Marquee panel | `#272424` with `#F1D98F` gold trim |
| Lane rail yellow | `#EBD653` |

The playfield carries a soft radial LIGHT in the middle (brightest around the ring, falling off to
the deep edge) - that gradient is doing a lot of the work and a flat teal looks wrong without it.

## Still not shown

Same as the video: no in-play screen for any of these machines, no unlock UI beyond the padlock and
chains, no score readout other than 3960's `BALL  SCORE` marquee. **How a board is unlocked is not
visible in any of these images** - our score-target rule is our own design, not a copy.
