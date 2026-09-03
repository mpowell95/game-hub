# Pixel Pro Golf — reference spec for an exact clone

**Purpose.** This document is the complete written record of a commercial mobile golf game
("Pixel Pro Golf"), reconstructed frame by frame from two screen recordings. The session that
implements the clone will **not** have access to the videos. Everything the implementer needs is
here.

**Source material**
| Clip | Length | Resolution | Frame rate | Contents |
|---|---|---|---|---|
| `setup-screens.mp4` | 54.50 s | 1206 × 2622 portrait | 60 fps | title → career → course card → tutorials → practice hole select |
| `hole-1.mp4` | 79.04 s | 1206 × 2622 portrait | 60 fps | one complete par-4 hole, three shots, birdie, scorecard |

**Method.** Frames were extracted with the `claude-video-vision` MCP server (ffmpeg under the hood)
at 0.5–2 fps for the survey, then re-sampled at 4–30 fps over every window where measured
frame-to-frame motion was high. Colours, geometry and timings below were measured off the native
1206 × 2622 frames unless a line says otherwise.

## How to read the confidence markers

Every non-obvious claim carries one of these. **Do not silently upgrade an inference to a fact.**

- **[MEASURED]** — read directly off frames, or computed from pixel data. Trust the number.
- **[OBSERVED]** — clearly visible and unambiguous, but not numerically measured.
- **[INFERRED]** — a reasonable reading of the evidence that could be wrong. Flagged individually.
- **[UNKNOWN]** — never visible in either clip. The implementer must decide. **These are listed
  together in §14 so nothing gets quietly invented.**

---

# 1. Overview and core game loop

A single-player, top-down, pixel-art golf game for portrait phones. The player aims with two arrow
buttons, picks a club, and hits the ball with a **three-tap swing** against a circular meter. The
camera follows the ball, the ball comes to rest, and the loop repeats until the ball is holed.

```
title
  └─ career (player home: ranking, tour, winnings, equipment)
       └─ play  →  course card (Pine Valley, 3 holes)
            ├─ play      →  the tournament round      [not shown in either clip]
            └─ practice  →  tutorial modals  →  practice hole select  →  play a single hole
                                                                            └─ hole complete
                                                                                 └─ round scorecard
                                                                                      ├─ quit
                                                                                      └─ restart
```

**The per-shot loop, which is the heart of the game:**

1. Camera sits on the ball. HUD shows par, shot number, distance to the hole, wind, club.
2. Player may free-scroll the view up the hole to look at the green, then release back to the ball.
3. Player nudges aim left/right with `<` / `>`, and changes club with `^` / `v` if the auto-pick is wrong.
4. Player taps **swing** — the power tick starts sweeping around the ring.
5. Player taps again to lock power.
6. Player taps a third time to stop the accuracy slider.
7. Ball launches, camera tracks it, ball lands and rolls to rest.
8. Distance, shot number and club update. Repeat.
9. On holing out: a full-screen result banner, then the round scorecard.

---

# 2. Screen-by-screen setup flow

All screens sit over **live, full-bleed background artwork** — there is no flat-colour UI screen
anywhere in the game. Panels and buttons float on top of the painting.

## 2.1 Title screen — `setup-screens.mp4` 0:00–0:06

**Logo.** The words `PIXEL PRO GOLF` stacked in chunky pixel block letters:
- `PIXEL` — dark charcoal/grey blocks
- `PRO` — orange
- `GOLF` — green gingham/plaid fill, with **a white golf ball used as the letter O** [OBSERVED]

**Mascots.** Two pixel golfers flank the logo. Left: white cap, grey polo, leaning on a club.
Right: white cap, red polo, darker skin, mid-swing pose. [OBSERVED]

**Background.** A painted pixel golf landscape: deep blue sky with a dotted dither gradient, pink
cherry-blossom clouds, snow-capped mountains, layered green hills, a river/lake, sand bunkers, small
red pin flags. [OBSERVED]

**Buttons** — every one is a pixel-outlined rounded rectangle: orange fill, white pixel text, dark
outline, hard (non-blurred) drop shadow.

| Position | Label (verbatim, lowercase as shown) | Notes |
|---|---|---|
| top right | `merch` | with a t-shirt icon |
| centre, largest | `career` | primary call to action |
| grey sub-panel titled `more courses` | `packs` · `VIP` | two buttons inside the panel |
| row | `tournaments` · `online` · `iMessage` | |
| row | `settings` · `shop` | plus four full-colour social icons: Discord, Twitter/X, Instagram, Facebook |
| bottom strip | `Pixel Pro Baseball` `[get]` · `Pixel Pro Winte…` `[get]` | horizontally scrollable cross-promo on a dark green hatched panel; `get` buttons are blue; the second title is **clipped mid-word** |

## 2.2 Career home / player home — 0:07–0:15

Reached by tapping `career`. Same painted background, logo gone.

- **Top-left:** small orange back button `<`.
- **Top-right:** orange `Game Center` button (two lines of text).
- **Centre:** the player's pixel avatar (white cap, grey polo and trousers, leaning on a club),
  drawn **standing on top of / overlapping** the stat panel below it. This overlap is deliberate and
  is used again on the practice-select and scorecard screens — it is a signature of the game's look.
- Small orange `edit` button to the right of the avatar (character editor). [OBSERVED]
- Stacked grey diagonally-hatched panels, centred, of varying widths, slightly overlapping:

| Panel content (verbatim) |
|---|
| `WORLD RANKING` |
| `20,073` (very large pixel digits, own inset panel) |
| `Current tour` / `Local Tournament` |

- Large orange `play` button overlapping the bottom of the panel stack.
- Amber/yellow hatched panel: `Winnings` / `$0`.
- Orange button: `update equipment`.
- The same cross-promo strip pinned to the bottom.

## 2.3 Course card — 0:16–0:19

- Top-left orange `<`.
- Dark charcoal **breadcrumb pill**: `Career`.
- Grey pill: `Local Tournament`, with a **gold star badge overlapping its top-right corner**.
- Light grey panel with the course name: `Pine Valley` (large pixel text, white with a dark outline).
- **Map thumbnail** — a framed, top-down pixel rendering of the whole course (green fairways, darker
  tree clusters, blue water, cream bunkers, mown-grass texture), inside a dark border frame. Four
  pieces of metadata are overlaid **in the thumbnail's own corners**, not listed beneath it:

| Corner | Text (verbatim) |
|---|---|
| top-left | `3 hole` |
| top-right | `Ranking points: 2,700` (yellow badge) |
| bottom-left | `Best: -, top place: -` |

  The dashes are literal — they are what the game shows before you have a record on the course.
- Grey description panel: `Wide fairways and still conditions.` then `Prize: $1,000`.
- Two buttons side by side: orange **`play`** (primary) and a smaller, darker dark-red **`practice`**.
  `practice` is visibly de-emphasised — smaller box, smaller text, muted fill.
- A sliver of the next course's card is visible at the right screen edge → the course list is a
  **horizontal carousel**. [OBSERVED]

## 2.4 Tutorial modals — 0:20–0:44

Tapping `practice` loads the play screen, dims it to roughly 70 % black, and shows four modals in
sequence. Each modal is a grey diagonally-hatched panel with centred white pixel text, an
illustration of the swing meter above the text, and a small orange `OK` button at the
**bottom-left** (not centred, not right).

**Modal 1** — illustration: the C-ring with ticks 25 / 50 / 75 / 100 and an orange arrow sweeping up
the arc.
> `Tap "swing" once to begin your stroke - the white line will move up as the power increases.`

**Modal 2** — illustration: the same ring with the marker near 100 and a red/orange/green block.
> `Tap again to set the power. Be careful, over 100% will make accuracy harder.`

**Modal 3** — illustration: the ring plus a red-green-red accuracy bar with an orange pointer.
> `Finally, tap to stop your swing. Closer to the middle will mean a more accurate shot.`

**Modal 4** — illustration: two small meter diagrams stacked, each showing the top of the arc
(75 / 100) with a dashed-outline box highlighting the 100 zone and an orange triangle pointer outside
it; the coloured band differs between the two diagrams.
> `For shots over 100%, tap the top of the meter to switch between power or precision.`

Modal 4 has **two** buttons: orange `OK` and a wider orange `don't show again`.

**Note for the clone:** the same tutorial set replays on the actual hole seconds after being
dismissed on the loading screen (modals 1–3 appear again at 0:47–0:53). This is a **bug in the
original**, not a feature — see §13.

## 2.5 Practice hole select — 0:45–0:47

Background is the course seen from above, darkened.

- Top-left orange `quit`.
- Light grey hatched panel: `Pine Valley`, a blank line, then `Select practice hole:`.
- **Scorecard grid** — dark frame, alternating row shading (dark grey / light grey / white / dark /
  grey / white):

| Row | Contents |
|---|---|
| 1 | hole numbers as **green tappable buttons**: `1` `2` `3`, then six empty columns |
| 2 | par per hole: `4` `3` `5` |
| 3 | your score per hole: `-` `-` `-` |
| 4–6 | empty (other players / totals) |

  **The grid is drawn nine columns wide even though the course has three holes.** Keep this — it is
  what makes every course use one layout.
- Below the grid, a white scoreboard panel, first row: `1` `You` … right-aligned `even`, with
  `(0,0)` in small grey underneath.
- The player avatar stands to the **left** of the grid, overlapping it.

---

# 3. The play screen — layout and HUD

## 3.1 Canvas and coordinate system

- Recording is **1206 × 2622 px** [MEASURED]. That is a 3× device, so the logical canvas is
  **402 × 874 pt** [INFERRED from the 3× assumption — the recording never states its scale factor].
  All pixel figures below are in **recording pixels**; divide by 3 for logical points.
- Aspect ratio 1 : 2.174. The game is portrait-only; no landscape layout was ever shown. [OBSERVED]
- The HUD is **corner-anchored and floats directly over the course art**. There are no letterbox
  bars, no solid header, no solid footer. [OBSERVED]

## 3.2 Measured HUD geometry

All boxes below were located by pixel-scanning a native frame (`hole-1.mp4` @ 54 s). **[MEASURED]**

| Element | x range | y range | Size (px) |
|---|---|---|---|
| `card` button (orange) | 72 – 251 | 252 – 345 | 180 × 94 |
| `par / shot / practice` panel (dark) | 66 – 348 | 408 – 665 | 283 × 258 |
| flag icon + hole number | ≈ 300 – 380 | ≈ 250 – 350 | small, right of `card` |
| aim `<` (orange) | 72 – 173 | 2052 – 2145 | 102 × 94 |
| `aim` label (dark pill) | ≈ 185 – 395 | 2052 – 2145 | ≈ 210 × 94 |
| aim `>` (orange) | 408 – 509 | 2052 – 2145 | 102 × 94 |
| club `^` (orange) | 408 – 509 | 2202 – 2295 | 102 × 94 |
| club `v` (orange) | 408 – 509 | 2346 – 2439 | 102 × 94 |
| club tile (dark, club sprite + name) | ≈ 60 – 395 | ≈ 2190 – 2450 | ≈ 335 × 260 |
| **`swing` button (orange)** | **858 – 1139** | **2286 – 2439** | **282 × 154** |
| power meter incl. its `25`/`50`/`75`/`100` labels and accuracy bar | 798 – 1145 | 1782 – 2387 | 348 × 606 |

Derived facts worth preserving:
- Every small square control is **102 × 94 px** (34 × 31 pt) — comfortably above a 44 pt tap target
  once padding is included. [MEASURED]
- The top HUD starts at **y = 246–252**, i.e. roughly 250 px (83 pt) of top inset is left clear for
  the status bar / notch. [MEASURED]
- The `swing` button's bottom edge is at **y = 2439**, leaving **183 px** (61 pt) of bottom inset
  clear for the home indicator. [MEASURED]
- Aim controls, club controls and the swing button all sit in the **bottom 25 %** of the screen —
  the thumb zone. Nothing interactive is in the top half except `card`.

## 3.3 HUD contents, corner by corner

**Top-left cluster**
- Orange `card` button — opens the scorecard.
- Red pixel **flag icon carrying the hole number** (`1`).
- Dark hatched panel, three lines:
  - `par 4`
  - `shot 1` (increments per stroke)
  - `practice` (third line is the mode label, rendered in dimmer grey than the two above)

**Top-centre**
- A small framed **lie tile** showing the ball on its current surface — ball on a tee peg over a
  grass/soil block on the tee; ball on plain grass in the fairway. [OBSERVED]
- Directly beneath it, the **distance to the hole**, white pixel text, one decimal place:
  `360.7 yds` → `136.0 yds` → `17.0 ft`.

**Top-right**
- Dark hatched panel labelled `wind`, containing a large grey **direction arrow glyph** and, below
  it, the speed as a bare number: `0`.
- The arrow is still drawn even when the speed is `0`. [OBSERVED] (see §13)

**Bottom-left**
- Aim row: orange `<` | dark `aim` label | orange `>`.
- Club tile: dark panel with a **pixel drawing of the actual club head** (driver = large grey wood;
  irons = angled blade; putter = flat blade) and the club's name beneath it, with orange `^` and `v`
  stacked to its right.

**Bottom-right**
- The power meter (§5) and the large orange `swing` button.
- Faint **dashed rectangles** are visible around the meter and the swing button — these appear to be
  debug/hit-area outlines left in the shipped build. [INFERRED — they are clearly dashed boxes, but
  their purpose is a guess.] **Do not reproduce them.**

## 3.4 Verbatim on-screen text, play screen

Every string seen during play, exactly as rendered:

```
card        par 4       shot 1      shot 2      shot 3      practice
wind        0           aim         driver      9 iron      6 iron
7 iron      putter      swing       quit        restart
360.7 yds   136.0 yds   17.0 ft     251.6 yds   149.1 yds
25   50   75   100
1    Pine Valley        PRACTICE    You         even        -1     (1,0)
Birdie!
```

---

# 4. Aiming

- **Two buttons only: `<` and `>`.** There is no drag-to-aim, no rotate gesture, no tap-the-map.
  [OBSERVED across both clips]
- Each tap rotates the aim by a small fixed increment — a few degrees. The exact per-tap angle was
  **not** measurable from the recordings. [UNKNOWN — see §14]
- The aim line is drawn as a **row of small red square markers** running from the ball up the hole,
  spaced at regular intervals and thinning with distance. On the green they become smaller red dots.
- A **red asterisk / star** marks the aim target point. It was seen sitting beside the pin while the
  player previewed the green.
- Faint grey `>` chevrons are scattered over the fairway — slope / roll direction indicators.
  [INFERRED: they look like slope arrows and appear in clusters, but nothing on screen labels them.]
- The green carries a regular **grid of small dark tick marks** — the putting-surface slope/grain
  read. [INFERRED, same reasoning.]
- **Aiming, scrolling and club changes are all free.** They consume no shot, no timer, no resource.
  The player re-aimed and previewed repeatedly with no penalty.

---

# 5. The power meter — the single most important mechanic

> **Correction, stated up front, because a coarse reading gets this wrong.** At 2 fps the meter
> looks static, and at 0.5 fps it looks like a one-way fill. It is neither. Both errors were made
> and then corrected by re-sampling at 15–20 fps. Build what this section says, not what a casual
> viewing suggests.

## 5.1 Shape

A **C-shaped open ring** ("power dial") in the bottom-right corner, opening to the right. It is a
thick band with:
- a white 1 px outline,
- a dark diagonally-hatched semi-transparent fill (the course art shows through it),
- tick labels **outside** the arc reading `25` (bottom), `50` (left), `75` (upper-left),
  `100` (top-right),
- a short **green segment** near the top of the arc just before 100,
- an **orange→red block beyond 100** — the over-swing zone,
- the **accuracy bar** at the foot of the ring (§6),
- a **yardage readout in the ring's hub** (§7).

## 5.2 Motion — MEASURED

- A **white radial tick line** crosses the ring band and travels **up** the arc: 25 → 50 → 75 → 100.
- It reaches the top (touching the green segment beside the red over-100 block) in **≈ 0.8 s** from
  the bottom. [MEASURED over 17.40–18.53 s at 15 fps]
- **It then reverses and sweeps back down.** It is a **ping-pong oscillation**, not a one-way fill
  that stops at the top. [MEASURED — the tick was tracked frame by frame at 15 fps and 20 fps
  across the full cycle]
- Full cycle (up and back down) ≈ **1.4 s**. [MEASURED]
- Consequence for feel: a mistimed tap gives you a **low** power reading rather than a maximum one,
  and waiting one more cycle costs nothing. This makes the meter forgiving in a way a one-way fill
  is not.

## 5.3 What is NOT true

**The accuracy window does not narrow as power rises.** This looked true when eyeballing a 15 fps
grid — the green block appeared to shrink as the tick climbed — and it was then measured directly:
the green pixel count inside the accuracy bar is pinned at **exactly 4220 px** for the entire power
sweep, and only fluctuates once the *camera* starts scrolling. The apparent narrowing was the
scrolling background bleeding through the semi-transparent panel. **Do not implement it.**
[MEASURED, and explicitly retracted]

## 5.4 The over-100 sub-mode

Tutorial modal 4 states that for shots over 100 %, tapping the **top of the meter** toggles between
**power** and **precision**. This toggle was **never exercised** in either recording, so its visual
state, its effect on ball flight, and where exactly the tap target is are all unverified.
[UNKNOWN beyond the tutorial text — see §14]

---

# 6. The accuracy meter

- A horizontal bar at the **foot of the ring**, banded left to right:
  **red | orange | GREEN (widest) | orange | red**, with a white vertical line as the marker.
- The white line **slides left and right and ping-pongs off the red ends**. [MEASURED — clearly
  visible frame by frame at 10 fps over 45.20–46.60 s, during shot 2's setup]
- Stopping the line in the green centre gives the straightest shot; the further out, the more the
  ball is pushed offline. [INFERRED from tutorial modal 3's wording — the clips never show a bad
  miss, so the magnitude of the penalty is unverified.]
- The two meters run in **separate phases**: while the accuracy line was sweeping during shot 2, the
  power tick sat parked at the top of the ring. [MEASURED]

---

# 7. The hub yardage readout

The centre of the ring displays a yardage. Values seen: `251.6 yds`, `149.1 yds`, `17.0 ft`.

This is **the distance the previous shot travelled**, not the selected club's range. Evidence:
- It stayed at `251.6 yds` while the club was changed from 6 iron to 7 iron — so it is not
  club-dependent. [MEASURED]
- It read `251.6 yds` after the drive, `149.1 yds` after the approach, `17.0 ft` after the putt —
  each matching the stroke just played. [MEASURED]
- It persisted at `251.6 yds` frame after frame **while the next shot was being aimed**, which is
  why it looks stale during setup. [MEASURED at 10 fps over 45.2–46.6 s]

Confidence: **[INFERRED]**, but from three consistent data points. The screen never labels the
number, which is itself a usability flaw worth fixing in the clone (§13).

---

# 8. The three-tap swing — exact timing

Tap timings were recovered by sampling the swing button's mean brightness at **30 fps** — the button
visibly darkens while held. **[MEASURED]**

**Shot 1 (driver):**
| Event | Time |
|---|---|
| tap 1 (begin stroke) | 19.40 s |
| tap 2 (lock power) | 20.00 s |
| tap 3 (stop accuracy) | 20.15 s |
| ball launches | ≈ 20.5 s |
| button disabled (dark) | 20.57 – 21.97 s (**1.40 s**) |

**Shot 2 (7 iron):**
| Event | Time |
|---|---|
| tap 1 | 45.50 s |
| tap 2 | 45.60 – 45.90 s |
| ball launches | ≈ 46.0 s |
| button disabled | 46.00 – 47.33 s (**1.33 s**) |

**Around the hole-out:** button disabled 74.43 – 75.97 s (**1.54 s**).

**What this means for the clone:**
- The entire three-tap sequence takes **well under one second** — 0.75 s on shot 1. It is a
  **twitch input**, not a leisurely one. If your clone's meter takes three seconds to cycle, it will
  feel nothing like the original.
- **Input is locked for ~1.4 s after every shot** while the ball is live. Reproduce this — it stops
  double-taps from queuing a second swing.
- The `swing` button renders a **darkened/pressed state** while held. [MEASURED — this is how the
  taps were detected at all]

---

# 9. Ball flight, physics feel, and the camera

## 9.1 Ball rendering

- In flight the ball is a **single white pixel**, with a **separate small dark-grey pixel for its
  shadow**, offset below it. **The gap between ball and shadow is the entire height model** — there
  is no arc line, no trail, no dotted trajectory, no height bar. [MEASURED — both sprites were
  isolated in zoomed crops]
- Reproduce this exactly. It is cheap, it reads perfectly at one pixel, and it is the single most
  transferable trick in the game.

## 9.2 Flight timing

| Shot | Club | Swing | Ball at rest | Flight duration |
|---|---|---|---|---|
| 1 | driver | 20.5 s | ≈ 28 s | **≈ 7.5 s** |
| 2 | 7 iron | 46.0 s | ≈ 57 s | ≈ 11 s incl. camera settle |
| 3 | putter | ≈ 69.5 s | ≈ 72 s | **≈ 2.5 s roll** |

The drive's ~7.5 s of scrolling is a long time for a phone game. It is the main thing worth changing
(§13).

## 9.3 Putting

- Same three-tap system, same ring, same `swing` button. **Putting is not a separate minigame** and
  introduces no new controls.
- The ball rolls as a single white pixel, **decelerating**, for ≈ 2.5 s. [MEASURED at 8 fps]
- **No shadow** while putting — the ball is on the deck. [MEASURED]
- The **camera does not move at all during a putt** — confirmed frame by frame. [MEASURED]
- The **pin disappears from the green** the moment the ball is holed. [OBSERVED]

## 9.4 Camera

| Phase | Behaviour |
|---|---|
| Aiming | Static on the ball. |
| Pre-shot preview | Player free-scrolls vertically up the hole to the green and back. Seen twice (0:07–0:09 and 0:32–0:44). |
| While previewing | The top-centre lie tile and yardage **fade to ≈ 40 % opacity**, then snap back to full when the view returns to the ball. [OBSERVED] A genuinely good idea — copy it. |
| During flight | Camera tracks the ball, scrolling the course past at flight speed. |
| After landing | Settles on the ball's resting position. |
| During a putt | Completely static. [MEASURED] |

There is **no rotation and no 3-D at any point**. The view is pure top-down, north-up. [OBSERVED]

## 9.5 The golfer sprite

- A small pixel golfer (white cap, grey polo) stands at the ball's position on the map.
- It plays a **real multi-pose swing animation** — backswing and through-swing poses step past as
  the camera begins to scroll. It is not a single static sprite that vanishes. [MEASURED at 10 fps
  over 20.3–21.5 s]
- The exact frame count of the animation was not resolvable. [UNKNOWN]

---

# 10. Clubs, distances, and wind

## 10.1 Clubs seen

`driver`, `9 iron`, `6 iron`, `7 iron`, `putter`. The full bag contents were never shown.
[UNKNOWN — see §14]

## 10.2 Auto-selection

The game **auto-picks a club after every shot** based on the lie and the remaining distance:
- 136.0 yds remaining → offered `6 iron`
- on the green → offered `putter`

The player can still override with `^` / `v` — they changed 6 iron to 7 iron by hand. This is a good
design: it removes the boring decision while keeping the interesting one. [OBSERVED]

## 10.3 Distances recorded

| Shot | Distance to hole before | Club | Distance travelled (hub readout) |
|---|---|---|---|
| 1 | 360.7 yds | driver | 251.6 yds |
| 2 | 136.0 yds | 7 iron | 149.1 yds |
| 3 | 17.0 ft | putter | 17.0 ft |

Note that 360.7 − 251.6 ≠ 136.0. The shot finished **offline**, so the straight-line distance to the
pin is not the tee distance minus the shot distance. Any clone must model position in 2-D, not as a
scalar "distance remaining". [INFERRED, but arithmetically forced.]

**Unit switching:** the readout is in **yards** off the green and **feet** on the green. `17.0 ft`
appeared as soon as the ball was putting-length from the hole. The exact switch threshold is
unverified. [OBSERVED; threshold UNKNOWN]

## 10.4 Wind

- Wind read `0` for the entire recorded hole, and the course description said
  `Wide fairways and still conditions.`
- **The effect of non-zero wind was therefore never observed.** The arrow glyph, the units of the
  number, and how strongly wind pushes the ball are all unverified. [UNKNOWN]

## 10.5 Hazards

Visible on the hole: **water** (left of the tee, and along the green's left and back edges),
**bunkers** (one short-left of the green, one right of it), **trees** lining both sides and pinching
the landing area, and **rough** outside the fairway. **No ball ever entered a hazard in either
recording**, so penalty strokes, drop rules, and the "in the trees" lie were never seen.
[UNKNOWN — see §14]

---

# 11. The hole itself — Pine Valley #1

- **Par 4, 360.7 yds from the tee.** [MEASURED from the readout]
- Tee box sits top-left, hard against **water**.
- Fairway runs away from the camera, curving right and then left — a gentle double dogleg.
- Tree blocks line both sides and pinch the landing area.
- One large cream bunker short-left of the green; a second to the green's right.
- The green is a rounded blob with **water hard along its left and back edges**.
- Fairway is mown in **vertical stripes** of two alternating greens; rough is a darker, flatter green
  with sparse tuft glyphs; the cart path is a dark grey-green ribbon.

Holes 2 and 3 exist (par 3 and par 5 per the scorecard) but were never played. [UNKNOWN]

---

# 12. Scoring, result, and progression

## 12.1 The result banner

On holing out:
- **`Birdie!`** in very large white pixel type across the middle of the screen.
- Behind it, a **white sunburst** — rays fanning out from the hole.
- **The rays rotate** between frames, and the text has a small vertical pop. It is an animated
  effect, not a still image. [MEASURED at 8 fps]
- The ball is still drawn on the green underneath the banner. [MEASURED]
- Duration ≈ **2.5 s**, then it fades out over ≈ 0.75 s.
- **No modal, no button, no dismiss.** It clears itself.
- Other score names (`Eagle!`, `Par`, `Bogey`, …) were never shown. [UNKNOWN]

## 12.2 Transition to the scorecard — MEASURED at 4 fps over 73.6–78.6 s

1. Banner fades out (≈ 0.75 s).
2. The whole card — title panel, grid, scoreboard, avatar — **cross-fades up from 0 % to 100 % over
   ≈ 0.5 s**, while the course behind it simultaneously darkens to a dim navy-green.
3. **Nothing slides in from an edge.** It is a cross-fade. Do not implement a slide.

## 12.3 The round scorecard

- Orange `quit` (left) and orange `restart` (right) at the top.
- Grey hatched panel: `Pine Valley`, then `PRACTICE`.
- The nine-column grid:
  - hole row `1` `2` `3` — the played hole now dimmed
  - par row `4` `3` `5`
  - score row `3` `-` `-`, with the `3` **in a green-filled cell** (under-par colour coding)
- White scoreboard row: `1` `You`, right-aligned `-1`, with `(1,0)` in small grey beneath it.
- The **full-size player avatar** stands to the left, overlapping the card.

The meaning of `(1,0)` is **not** explained anywhere on screen. Most likely holes played and
something else. [UNKNOWN]

## 12.4 Progression systems glimpsed but never used

`WORLD RANKING 20,073`, `Winnings $0`, `update equipment`, `Ranking points: 2,700`, `Prize: $1,000`,
`packs`, `VIP`, `shop`, `merch`, `tournaments`, `online`, `iMessage`, `Game Center`. None of these
screens were opened. [UNKNOWN]

---

# 13. Flaws in the original — fix these in the clone

Documented so the implementer does not faithfully reproduce a defect.

1. **Tutorial modals replay.** Four modals show while the practice hole loads, then modals 1–3 show
   *again* on the hole seconds later. Show them once.
2. **`practice` reads as disabled.** It is so much smaller and darker than `play` that it looks
   greyed out. Give it equal weight.
3. **Cross-promo strip clips mid-word** (`Pixel Pro Winte…`) and eats the bottom of both menu
   screens.
4. **The wind arrow is drawn at speed 0.** Hide the arrow, or show a "calm" state.
5. **The hub yardage is unlabelled**, so the number reads as stale or wrong. Label it
   (`last shot: 251.6 yds`).
6. **Low-contrast grey-on-grey text** — `Current tour`, `(0,0)`, the `practice` mode line.
7. **A ~7.5 s ball flight with no skip.** Add tap-to-speed-up or shorten the flight; over nine holes
   this is minutes of watching a dot.
8. **No landing marker.** Nothing shows where the selected club will actually land, so club choice
   is guesswork until the bag is memorised. A target ring at the club's carry distance would fix it.
9. **Tap-only aiming.** A drag on the map would be faster and more mobile-native.
10. **Dashed debug rectangles** around the meter and swing button appear to be left-in debug
    outlines. Do not reproduce.

---

# 14. Everything that is UNKNOWN

The implementer **must decide** these, because neither recording shows them. Do not present a guess
here as if it came from the reference.

- Per-tap aim increment (degrees).
- The full club list and each club's carry distance.
- The over-100 % **power vs precision** toggle: its visual state, its tap target, its effect.
- How much an off-centre accuracy stop pushes the ball offline.
- Wind: units, arrow semantics, and strength of effect.
- Hazard rules: water penalties, bunker lies, playing from trees or rough, out of bounds, drops.
- The yards→feet switch threshold.
- All score-name banners other than `Birdie!`.
- The meaning of `(1,0)` on the scoreboard.
- Holes 2 (par 3) and 3 (par 5) — layout unknown.
- The tournament round (`play` rather than `practice`) — never entered.
- Every progression screen: shop, packs, VIP, equipment, tournaments, online, Game Center, merch.
- Sound and music entirely — audio was skipped during analysis and is not documented at all.
- Multiplayer, if any.
- The golfer swing animation's frame count.
- Whether the device scale factor is genuinely 3× (assumed for the pt conversions in §3.1).

---

# 15. Art direction

## 15.1 Measured palette

Sampled by frequency from a native play-screen frame. **[MEASURED]**

| Role | Hex | Share of frame |
|---|---|---|
| Water | `#248cef` | 9.52 % |
| Fairway light stripe | `#aec944` | 2.15 % |
| Rough / dark green | `#85a330` | 2.02 % |
| Mid green | `#8caa34` | 1.88 % |
| Fairway light stripe (2) | `#b0cb46` | 1.36 % |
| Deep shadow green | `#6e812b` | 1.07 % |
| **UI accent orange** | **`#e54e00` / `#e64f00`** | 1.56 % combined |

Additional values from the observation notes, **[OBSERVED]** rather than pixel-sampled:
sand cream ≈ `#f0e4c8`; HUD panel fill is near-black with diagonal hatching and a 1 px white outline;
the flag is pure red; the accuracy bar bands are red / orange / green.

## 15.2 Style rules

- **16-bit SNES top-down look.** Chunky black outlines on trees, dithered speckle in sand, flat
  two-tone water with a lighter shoreline band, mown stripes on the fairway.
- **One pixel/bitmap font everywhere.** No anti-aliasing. Button labels are **lowercase**
  (`career`, `play`, `swing`, `aim`, `card`, `wind`, `quit`); some panel headings are uppercase
  (`WORLD RANKING`, `PRACTICE`).
- **One accent colour** — the orange — for every interactive control. Nothing else is orange.
- **Dark diagonally-hatched semi-transparent panels** for all readouts, with a white 1 px outline.
- **Hard drop shadows**, never blurred.
- **Everything animates in whole pixels.** Nothing tweens smoothly; the ball moves in integer steps.
- **Sprites overlap UI panels** (avatar on the career screen, on practice select, on the scorecard).
  This is the game's signature move and is nearly free to implement.

## 15.3 Feel

Unhurried. Long preview scrolls, a 7.5 s ball flight, no timers, no pressure anywhere. **The only
timed thing in the entire game is the swing meter itself** — and that is sub-second. The contrast
between a slow, relaxed frame and one twitchy moment of input is the whole rhythm of the game.

---

# 16. Implementation checklist

Ordered so that each step is playable before the next begins.

1. Portrait canvas, 402 × 874 pt logical, top-down scrolling tilemap, north-up, no rotation.
2. Hole data: fairway polygon, rough, green, bunkers, water, trees, tee position, pin position.
3. Ball as one white pixel + offset dark shadow pixel. Height drives the offset. Nothing else.
4. HUD at the measured geometry in §3.2. Corner-anchored, floating over the art.
5. Aim: `<` / `>` buttons, red square marker line, red star target.
6. Club tile with club-head sprites, `^` / `v`, and auto-selection by lie and distance.
7. **Power ring: ping-pong oscillation, 0.8 s bottom-to-top, ~1.4 s full cycle.**
8. **Accuracy bar: ping-pong slider, red/orange/green/orange/red, stop in the green for straight.**
9. **Three-tap input, sub-second total, button darkens on press, input locked ~1.4 s after the shot.**
10. Ball flight with camera tracking; landing, roll, rest.
11. Putting on the same controls, static camera, ~2.5 s decelerating roll, feet not yards.
12. Result banner: `Birdie!`, rotating sunburst, ~2.5 s, self-clearing.
13. Cross-fade (~0.5 s) to the scorecard with the course dimming behind it.
14. Scorecard: nine-column grid, par row, score row, green cell for under par, avatar overlapping.
15. Pre-shot free scroll with the lie tile and yardage fading to ~40 %.
16. Only then: menus, course card, tutorials, progression.

---

*Compiled from `setup-screens.mp4` and `hole-1.mp4` via frame extraction and pixel measurement.
Measured values are marked [MEASURED]; inferences and gaps are marked and listed in §14. Where this
document says a value is unknown, it is genuinely unknown — please decide it deliberately rather
than assuming it was omitted by accident.*
