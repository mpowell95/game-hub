# Pixel Pro Golf — reference spec for an exact clone

**Purpose.** This document is the complete written record of a commercial mobile golf game
("Pixel Pro Golf"), reconstructed frame by frame from two screen recordings. The session that
implements the clone will **not** have access to the videos. Everything the implementer needs is
here.

**Source material** — five screen recordings in total.
| Clip | Length | Resolution | Frame rate | Contents |
|---|---|---|---|---|
| `setup-screens.mp4` | 54.50 s | 1206 × 2622 portrait | 60 fps | title → career → course card → tutorials → practice hole select |
| `hole-1.mp4` | 79.04 s | 1206 × 2622 portrait | 60 fps | one complete par-4 hole, three shots, birdie, scorecard |
| `Setup.mp4` | 40.73 s | 1206 × 2622 portrait | 60 fps | title → character editor → career → course card → round start (no audio track) |
| `Holes 1&2.mp4` | 140.55 s | 1206 × 2622 portrait | 60 fps | holes 1 and 2 played, ending on the scorecard (no audio track) |
| `Hole 3.mp4` | 151.37 s | 1206 × 2622 portrait | 60 fps | hole 3 (par 5) through the post-round banners to the career screen (no audio track) |

**Method.** Frames were extracted with the `claude-video-vision` MCP server (ffmpeg under the hood)
at 0.5–2 fps for the survey, then re-sampled at 4–30 fps over every window where measured
frame-to-frame motion was high. Colours, geometry and timings below were measured off the native
1206 × 2622 frames unless a line says otherwise.

---

# 0. PROJECT DECISIONS — these OVERRIDE the reference

Agreed with Matt on 2026-09-03. Where a decision here conflicts with the reference game
described below, **the decision wins**. The reference sections are kept so the implementer knows
what the original did and why.

| Topic | Decision |
|---|---|
| **Scope now** | **Build holes 1-3 only.** Holes 4-9 come later, once the mechanics are settled. |
| **Course** | Pine Valley, eventually 9 holes. The three documented holes become 1, 2, 3. |
| **Tournament mode** | **Cut entirely.** No AI opponents, no leaderboard column, no `K Thiago` / `W Moore` / `F Everett`. |
| **Scoring goal** | Track the player's **best 9-hole round score** (best 3-hole score until the course is complete). |
| **World ranking** | Renamed **skill level**. **Starts at 0 and counts UP** as the player improves (the original counted down from 20,073). |
| **Cash** | Keep. Prize money per round, as the original. |
| **Shop** | Keep, but **clubs only, not clothing.** Clubs have real stats: more distance, tighter accuracy. No hats, polos, skins, hair. |
| **Practice mode** | Keep. Single-hole practice alongside the full round. |
| **Audio** | **None.** Do not add sound. Do not spend time on it. |
| **Hub integration** | In-hub `module:`, `immersive: true` (full screen, hub chrome hidden), like Skeeball. |
| **Names (frozen forever — THE LAW rule 5)** | folder `golf/` · stats id `'golf'` · settings key `gamehub.golf.v1` · recorder `recordGolf` |

**Later additions to these decisions (2026-09-03):**

| Topic | Decision |
|---|---|
| **Meter colours** | Keep the reference's red/green exactly. Revisit only if it proves unreadable in play. |
| **Leaderboard number** | The player's **best 9-hole score** (lowest wins). Skill points may replace it later. |
| **Tap-target floor** | A suggestion, not a rule (see 18.2 for why). |
| **Club distances** | See 21.2. Stock driver **215 yds**, not the reference's measured 287 - that figure left no room for upgrades and made a 360 yd par 4 play as a drive and a wedge. |

**Consequences to keep in mind while building:**
- The scorecard screen loses its opponent scoreboard panel. Keep the grid, the totals and the avatar.
- The `(1,0)` mystery number is moot — it lived in the opponent scoreboard. Do not implement it.
- `best -` (the HUD's third line in tournament mode) becomes the player's own best for that hole.
- Club upgrades change balance: the club ladder must be designed as a *base* bag that purchased
  clubs improve on.


## How to read the confidence markers

Every non-obvious claim carries one of these. **Do not silently upgrade an inference to a fact.**

- **[MEASURED]** — read directly off frames, or computed from pixel data. Trust the number.
- **[OBSERVED]** — clearly visible and unambiguous, but not numerically measured.
- **[INFERRED]** — a reasonable reading of the evidence that could be wrong. Flagged individually.
- **[UNKNOWN]** — never visible in any clip. The implementer must decide. **These are listed
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
8. ~~**No landing marker.**~~ **STRUCK - this was my error, not the game's.** The aim line's five
   red dots ARE the landing markers, calibrated to the power meter. See section 21.1.
9. **Tap-only aiming.** A drag on the map would be faster and more mobile-native.
10. **Dashed debug rectangles** around the meter and swing button appear to be left-in debug
    outlines. Do not reproduce.

---

# 14. Everything that is UNKNOWN

Revised after the second pass. Items resolved by clips 3-5, or removed by a project decision in
section 0, have been struck from this list.

**Still genuinely unknown, and the implementer must decide:**

- Per-tap aim increment (degrees).
- The full club list and each club's carry distance. The measured figures in 17.2 are individual
  swing distances, not club maximums - only the driver's ~287 yds full-power carry is usable.
- The over-100% **power vs precision** toggle: its visual state, its tap target, its effect.
- Wind: units, arrow semantics, strength of effect. Wind read `0` in all five clips.
- Hazard rules. The SHAPE is now known (section 21.2: obstructed lies offer drop-for-+1 or
  play-it-as-it-lies; water offers no choice), but three details are still needed:
  **(a)** where a drop places the ball - back at the previous spot, or beside where it lies;
  **(b)** what water costs and where it replays from - previous spot, or the water's edge;
  **(c)** whether playing from the trees caps power (a punch-out) or allows full power with the
  trees as real obstacles. Bunker and rough lies are also still unobserved.
- The yards-to-feet switch threshold (see section 12 for the recommended surface-based rule).
- Score banners other than `Birdie!` and `New course best`.
- The club shop's contents - ours to design (17.8).
- The mishit penalty - designed by us in 17.9, never observed.
- Holes 4-9 - out of scope for now, ours to design later.
- Whether the device scale factor is genuinely 3x (assumed for the pt conversions in section 3.1).

**Resolved since v1:**

- Holes 2 and 3 - documented in 17.1.
- Tournament mode - documented in 17.5, then cut by decision.
- Progression and economy - documented in 17.5 and 17.8.
- The "rocket" - it was the wind arrow (17.4).
- Sound - out of scope by decision; the three newer clips have no audio track at all.
- Golfer swing animation - a real multi-pose animation; exact frame count still uncounted but
  4 poses is a fine default.

**No longer applicable:**

- The meaning of `(1,0)` - it lived in the opponent scoreboard, which is cut. It stayed ambiguous
  to the end anyway: after three birdies it read `(3,0)`, which fits both "birdies, eagles" and
  "holes under par, holes over par".
- Multiplayer - not being built.

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

---

# 17. Second-pass findings (clips 3-5)

Three further recordings were analysed: `Setup.mp4` (0:41), `Holes 1&2.mp4` (2:20), `Hole 3.mp4`
(2:31), all 1206 x 2622 @ 60 fps. **All three have no audio track at all** (`has_audio: false`),
which is one reason audio is out of scope.

## 17.1 Holes 2 and 3 — now documented

| Hole | Par | Tee yardage | Character |
|---|---|---|---|
| 1 | 4 | **360.7 yds** | Gentle double dogleg, water left of the tee, bunker short-left of the green, water left and behind the green. |
| 2 | 3 | **181.0 yds** | **Island green.** The entire hole is water; a kidney-shaped green with one large bunker on its left sits in the middle. No fairway at all. |
| 3 | 5 | **608.6 yds** | Long dogleg. Trees pinch the tee shot, a **large lake crosses the fairway** as a mid-hole carry, bunkers guard the green right. |

Hole 3's 608.6 yds appears to be measured **along the dogleg centreline**, not straight to the pin -
the straight-line distances in the readout do not reconcile with a 608.6 straight hole. [INFERRED]

## 17.2 Clubs — bigger bag than first documented

Now seen: `driver`, `3 wood`, `2 iron`, `3 iron`, `4 iron`, `6 iron`, `7 iron`, `8 iron`, `9 iron`,
`p. wedge`, `putter`. Still no full-bag screen, so the list may be incomplete. [OBSERVED]

**Measured shot distances (hub readout):** driver 251.6 / 246.3 / **287.0**; 4 iron 174.3;
7 iron 149.1; 2 iron 144.8.

**These do NOT give a club ladder, and the implementer must not treat them as one.** The player
controls power, so each figure is that swing's distance, not the club's maximum - which is why the
2 iron's 144.8 sits *below* the 4 iron's 174.3. The only defensible reading is that **the driver's
full-power carry is around 287 yds**. Everything else in the bag must be designed. [MEASURED
values, explicitly NOT a ladder]

## 17.3 The hub yardage - revised

Still the **distance of the previous shot** (it changes per stroke, tracks stroke magnitude, and is
not the selected club's fixed range). But the arithmetic does **not** close cleanly: on hole 3 a
232.4 yds approach that travelled 144.8 yds left 60.7 yds, which is geometrically impossible for
straight-line distances. Most likely the hole yardage follows a dogleg centreline and/or the hub
reports carry while the ball also rolls. [INFERRED, with the discrepancy stated rather than
smoothed over.] For the clone: label it plainly, e.g. `last shot: 251.6 yds`.

## 17.4 The wind indicator - correction

Earlier I described a "rocket icon" appearing in hole 3. **It is the wind direction arrow**, the
same indicator as always; the panel simply renders in a light state there rather than dark. There
is no rocket and no boost mechanic. Wind still read `0` in every frame of all five clips, so wind's
actual effect remains unobserved.

## 17.5 The post-round sequence - fully documented

On completing the round, three full-screen sunburst banners play in sequence, same visual treatment
as `Birdie!`:

1. `Prize money:` / **`$1,000`**
2. `Your ranking jumped` / `2,700` / `to` / **`17,373`**
3. `You have been invited to` / `play in the` / **`Amateur Tour`**

**The ranking maths is exact and measured:** 20,073 - 2,700 = 17,373, and 2,700 is precisely the
`Ranking points: 2,700` shown on that course's card. So **a completed round moves your ranking by
the course's ranking-points value.** [MEASURED]

For our version (skill level starting at 0, counting up), the equivalent is **+2,700 skill points
for the round**, ideally scaled by how well the player scored.

Career screen after the round: `WORLD RANKING 17,373`, `Winnings $1,000`, and
`Current tour` / **`Amateur Tour`** (was `Local Tournament`). The tour ladder is real progression.

## 17.6 New result banner

**`New course best`** - three lines, same rotating sunburst, fires mid-hole the moment the score
becomes a personal best. Also seen: the HUD's third line switching from `best -` to `best 4` once a
best exists. [OBSERVED]

## 17.7 Scorecard screen - fuller picture

Header panel reads `Pine Valley` with the round total right-aligned (`-3`), then `best: -3` and
`top place: 1` beneath, and the word `SCORECARD` bottom-left of that panel. A small round **orange
restart icon button** (circular arrow) sits at the panel's right edge, and a wide orange
**`continue`** button sits below. Grid rows: holes `1 2 3`, pars `4 3 5`, scores `3 2 4` with every
under-par cell filled **green**. [OBSERVED]

## 17.8 Shop - structure and price scale

Categories: `physique`, `skin`, `hair`, `top`, `bottoms`, `hat`, `club`. Each opens a scrolling list
with a thumbnail, a name, a price, and an orange `buy` button; owned items show a flat `owned` chip.

Prices seen: `No hat` Free, `White cap` Free, `Red cap` $100, `Blue cap` $1,000; `Red polo` Free,
`Black polo` $1,000, `Gray polo` $1,500, `Blue polo` $1,750, `White polo` $2,000, `Orange polo`
$4,500. Physique offers `Male` / `Female`; skin offers `Skin 1` - `Skin 6`.

**The `club` tab was never opened**, so the original's club items, their prices and their stats are
unseen. Since we are keeping clubs and dropping clothing, **the entire club shop is ours to
design.** Useful takeaway: the original's price range runs roughly **$100 to $4,500**, against
$1,000 prize money per round - so a good item costs several rounds' winnings.

## 17.9 Mishit model - DESIGNED, not observed

Every shot in all five clips was struck cleanly, so the penalty for a bad accuracy stop was never
observed. Per Matt: invent something standard. Proposed model, entirely ours:

- Let `off` = the marker's distance from the bar's centre, normalised to 0.0 - 1.0.
- **Green zone** (centre ~40% of the bar): offline angle = `off x 1.5 deg`. Effectively straight.
- **Orange zone** (next ~30% each side): angle ramps `1.5 deg` to `4 deg`.
- **Red zone** (outer ~15% each side): angle ramps `4 deg` to `8 deg`, and the shot also loses
  **10% of its distance** (a mishit does not fly its full length).
- Marker **left** of centre pulls the ball left; **right** pushes it right.
- Over 100% power multiplies the resulting angle by **1.5**, which is what makes overswinging risky
  and matches the tutorial's warning.
- The ball should **curve** toward its miss over the flight rather than launching on a straight
  offset line - it reads far better and is how the genre does it.

At 250 yds, a full red miss lands roughly 35 yds offline: punishing, recoverable, not round-ending.

## 17.10 Tutorial art is misleading - do not copy it literally

Modal 1's illustration shows a single orange arrow sweeping **up** the arc, which is what led an
earlier reading of this footage astray. The real meter **oscillates up and back down** (section 5).
Draw the tutorial art to match the real behaviour.

---

# 18. Conflicts between the reference game and THIS repo's rules

The reference is a commercial iOS game. This repo has its own standards, and in three places
copying the original faithfully would **break** them. Resolve these deliberately.

## 18.1 The accuracy meter is red/green — and Matt is red/green colorblind

**This is the important one.** Root `CLAUDE.md`: *"Colorblind-safe (Matt is red/green colorblind):
wherever color is a choice, pair each hue with a shape marker, never hue alone."*

The reference's accuracy bar is `red | orange | GREEN | orange | red` — a pure hue-coded gauge
with no shape cue whatsoever, and hitting the green centre is **the single most important judgement
in the game**. The power ring has the same problem: its green "good" segment and its red over-100
block are distinguished by hue alone.

Copying this exactly would ship a core mechanic the primary player cannot reliably read.

**DECIDED (Matt, 2026-09-03): keep the original red/green colours.** Build the meter exactly as
the reference draws it. The concern below is recorded only so it can be revisited quickly if the
meter turns out to be hard to read in play — do not act on it unless asked.

~~Recommended fix — keep the shape, change the coding:~~ (held, not being built)
- Re-hue to the repo's colorblind-safe palette: **teal `#178A7A` centre, vermilion `#E0532F`
  flanks** (blue/orange-family contrast survives red/green colorblindness; yellow `#F2B705` is
  available for the middle band).
- **Add a shape marker at the safe centre** — a diamond or notch drawn on the bar, so the target
  is identifiable without any colour at all.
- Make the safe zone **visibly wider and lighter**, so brightness alone distinguishes it.
- On the power ring, mark 100 % with a **notch or tick**, not a colour change.

This is a deliberate, documented departure from "exact clone", and it needs Matt's blessing since
it changes how the meter looks. Everything else about the meter stays identical.

## 18.2 The reference's tap targets are small — treat this as a SUGGESTION, not a rule

**Provenance, because it matters (checked 2026-09-03):** `docs/BUILDING-A-GAME.md`'s "tap targets
are 44 x 44 px minimum" rule entered this repo on **2026-08-31 via PR #292, branch
`claude/pipes-game-visuals-q04as2`** - written into the standards doc by a Claude session doing
unrelated work on Pipes, and never agreed with Matt. He has since downgraded it: **it is a
suggestion here, not a binding rule.** (The number itself is Apple's published HIG minimum, so it
is not invented - but its status as repo law was never sanctioned.)

Measured from the reference frames: every small control (`<`, `>`, `^`, `v`) is **102 × 94 device
px**, which at 3× is **34 × 31 pt** — comfortably *under* the floor on both axes. The `card` button
at 180 × 94 px (60 × 31 pt) is under it on height too.

**Recommended fix:** keep the reference's visual box size, but extend the *hit area* to at least
44 × 44 pt with transparent padding. The layout looks identical and the control becomes reachable.
Do not simply shrink-copy the original's geometry.

## 18.3 Minimum text size

Part 0 sets an **11 px floor**. Several reference readouts are drawn very small — the `(0,0)`
sub-line, the greyed third line of the par panel, the meter's `25`/`50`/`75`/`100` tick labels.
Check each against the floor at render size; shorten strings rather than going below it.

---

# 19. Game Hub integration — the repo's own checklist, applied to golf

`docs/BUILDING-A-GAME.md` §"Adding a game" is mandatory here. Golf-specific answers:

1. **Folder** `golf/` with `index.html`, `css/golf.css`, `js/ui.js` plus engine modules.
2. **`ui.js` exports `init` / `destroy` / `isInProgress`**, and injects its stylesheet idempotently
   via `new URL('../css/golf.css', import.meta.url)`.
3. **CSS scoping:** root class `.gf-root`, every class `.gf-`, every custom property `--gf-`, and
   **every rule descendant-scoped** under `.gf-root` (`.gf-root .gf-meter`, never a bare
   `.gf-meter`). Mancala is the cleanest model in the repo; do not copy Connect Four or Filler,
   which are prefix-only.
4. **Settings key** `gamehub.golf.v1`. A separate `gamehub.golf.save.v1` for the in-progress round
   (see 19.1).
5. **`GAMES` entry in `js/hub.js`:** `module: '../golf/js/ui.js'`, `immersive: true`, plus
   `id, title, blurb, badge, accent, art`, and **`released: 'YYYY-MM-DD'`** — the actual go-live
   date, which drives the launcher's "New" pill. Art must be **landscape `viewBox="0 0 160 90"`**
   with a full-bleed background rect, composed for that frame (not a cropped square).
6. **`sw.js`:** add every golf file to `ASSETS`, **bump `CACHE` past what is on `origin/main` right
   now**, then run `node validate-sw-assets.mjs` before committing.
7. **Stats — the three-edit rule.** Golf stores a sub-counter, so it needs all three or it is a
   THE LAW rule 1 bug that is invisible on one device:
   - `js/game-stats.js` — `ensureGf()` + its call in `normalize()`, plus `recordGolf()`.
   - `js/game-stats-ui.js` — a My Stats screen that actually renders it.
   - `js/players-agg.js` — an explicit `else if (g === 'golf' && src.gf)` branch in
     `aggregatePlayers`, or every counter reads zero the moment a second device syncs.
   Counters add; **bests take `Math.max`, never a sum**.
   Suggested counters: `rounds`, `holes`, `bestRound` (lowest, so `Math.min` — document the
   exception loudly), `bestByHole`, `birdies`, `eagles`, `holesInOne`, `pars`.
8. **`GAME_META` row in `js/leaderboard-ui.js`** — `{ id: 'golf', labelKey: 'game_title_golf' }`,
   using the STATS id. This is a *different registry in a different file* from item 5 and it is the
   one that gets forgotten; a game missing here has every play counted as **zero on the
   leaderboard** while its own screen looks fine. That is exactly how Yahtzee shipped.
9. **`golf/CLAUDE.md`** — opening with the THE-LAW pointer block, then hub integration, layout,
   design decisions, engine notes, keys, tests. `escoba/CLAUDE.md` is the depth reference.
10. **`golf/js/strings.js` with `{ en, es }`** and every user-visible string through `t()`, called
    at RENDER time, never module scope. **This includes all the verbatim text in this spec** —
    `swing`, `aim`, `card`, `wind`, `par`, `shot`, `best`, `Birdie!`, `New course best`, the
    scorecard, the shop. `snake/js/strings.js` is the reference implementation.
11. **Run `node test-game-conventions.mjs`.** If it fails, fix the game — do **not** add golf to
    `KNOWN_GAPS`. Then `node test-visual.mjs golf` for the visual/fit checks.

## 19.1 Round persistence and `isInProgress()`

A 9-hole round is long, so abandoning mid-round must not lose it.
- Autosave the round (hole, shot count, ball position, per-hole scores) to
  `gamehub.golf.save.v1` after every stroke.
- `isInProgress()` returns true whenever a round is part-played, so the hub warns before unmounting.
- The reference's `quit` / `restart` buttons map to: `quit` = leave, keep the save; `restart` =
  discard and re-tee. Confirm before `restart` — it destroys progress.

## 19.2 Other repo rules that bite here

- **Use `onViewportResize(cb)` from `js/viewport.js`.** Never a raw `resize` /
  `orientationchange` / `visualViewport` listener — that is a mobile scroll-jank bug, and Hill
  Climb shipped it exactly once by not reading this rule.
- **Never put `touchmove` on `document` or `window`** — bind it to `.gf-root`. The swipe/scroll
  surface gets `touch-action: none`; tappable controls get `touch-action: manipulation`.
- **`overscroll-behavior: contain`** on any fixed overlay that scrolls (the shop list, the
  scorecard).
- **`safe-area-inset-bottom`** on the bottom control cluster. The reference already leaves 183 px
  (61 pt) of bottom inset — match that intent.
- **Immersive fit:** the game must fit ONE screen at both a tall and a short phone height, checked
  standalone *and* mounted in the hub's real chrome (~138 px of it). See `test-visual.mjs`'s `fit`
  checks and Part 3's "Fitting a screen to available viewport space, by measurement".
- **Animate only `transform`, `opacity`, `filter`, `box-shadow`.** Never `width`/`height`/`inset`.
- **`prefers-reduced-motion`**: cut the sunburst rays, screen shake and particles — but **keep the
  ball flying**. Per `pinball/CLAUDE.md`, reduced motion thins garnish, it does not freeze
  gameplay.
- **No em dashes in user-facing copy.** Commas, colons or parentheses.
- **The round-complete screen gets a close (X) top-right**, per the repo's win/lose popup rule.
- **Profile integration:** the player's name comes from `loadProfile()` (`js/profile-store.js`),
  defaults-only — golf prefills from it and never writes back. Since the character editor is cut,
  the golfer sprite should pick up the profile's colour rather than offering its own wardrobe.
- **Deploying means LIVE on `main`**, not a pushed branch. Root `CLAUDE.md` is emphatic about this.

---

# 20. Physics model — concrete numbers to build against

The reference was measured for *feel*, not for coefficients. The implementer needs actual numbers,
so here is a starting model. **All of this is ours, not measured from the reference**, except the
two anchors noted.

- **Full-power driver carry ≈ 287 yds** [MEASURED anchor]. Design the rest of the bag beneath it.
- **Distance = clubCarry × (power ÷ 100)**, with power over 100 adding up to +8 % and multiplying
  the mishit angle by 1.5 (§17.9).
- **Flight time**: the reference's drive took ≈ 7.5 s [MEASURED], which is slow. Recommend scaling
  time with distance — roughly `0.9 s + distance / 60` seconds — giving a driver ≈ 5.7 s and a
  wedge ≈ 2.5 s, then **let a tap skip to the landing** (flaw #7).
- **Roll** after landing: fairway ≈ 8 % of carry, green ≈ 2 %, rough ≈ 3 %, bunker ≈ 0.
- **Putting**: distance = `power × maxPuttFeet`, decelerating over ≈ 2.5 s [MEASURED reference
  roll]. Whether the green's slope grid actually breaks the putt was never observable — recommend
  implementing a gentle break, since the grid is drawn and players will expect it to mean something.
- **Ball height** for the shadow offset: a simple parabola over the flight, peak offset scaled by
  club loft. Nothing more elaborate is needed — the shadow gap is the only height cue.

---

# 21. Mechanics learned from Matt, not from the footage

Both of these come from Matt having actually played the game. Neither was visible in the
recordings, and one of them corrects a flaw I wrongly reported.

## 21.1 The aim line is a POWER LADDER — five dots, calibrated to the meter

**This is a core mechanic and it must be implemented.**

The red markers running up the aim line are not decoration and not merely a direction indicator.
They are **distance markers calibrated to the power meter**:

| Dot | Meaning |
|---|---|
| 1 | where the ball lands at **25 %** power |
| 2 | **50 %** |
| 3 | **75 %** |
| 4 | **100 %** - the selected club's full distance |
| 5 | the **risk zone**: past 100 %, where the meter's over-swing band reaches |

Past dot 4 **the line itself turns red** and continues to dot 5. None of the dots are labelled -
their spacing is the label.

**Each dot shows where the ball would land if struck perfectly at that power, with no wind.** It is
a *starting point*, not a promise: a mishit or wind moves the ball off it. That is exactly the
right contract - the player gets an honest plan and then has to execute it.

The dots update whenever the club changes, so **cycling clubs visibly re-scales the ladder on the
ground**. This is what makes club choice legible.

**CORRECTION.** Section 13 flaw #8 previously said "No landing marker. Nothing shows where the
selected club will actually land, so club choice is guesswork." **That was wrong** - the dots are
precisely that marker; I misread them as decoration. The flaw is struck.

## 21.2 Obstacles, drops and water

Never observed - every shot in all five clips finished on the tee, the fairway or the green, and no
ball entered a hazard. Recorded here from Matt's description:

- **Ball behind a tree / in the woods / otherwise obstructed** - the player is offered a **choice**:
  - **take a drop**, at a **+1 stroke penalty**, or
  - **play it as it lies**, risking the obstacle: hit the tree, or deliberately play out sideways
    or around it.
- **Water gives no choice.** It is an automatic penalty.

Three details still needed before this can be built, listed in section 14: where a drop places the
ball, what exactly water costs and where it replays from, and whether "play it as it lies" from
trees caps the available power (a punch-out) or allows full power with the trees as real physical
obstacles.

## 21.3 The club ladder (proposed 2026-09-03, pending final sign-off)

Anchored on hole design rather than on the reference's measured 287 yd drive, which was recorded
with an unknown - possibly upgraded - bag and left no headroom for the shop.

| Club | Stock | Fully upgraded | Dot 5 (risk, stock) |
|---|---|---|---|
| driver | 215 | 269 | 237 |
| 3 wood | 195 | 244 | 215 |
| 5 wood | 182 | 228 | 200 |
| 2 iron | 175 | 219 | 193 |
| 3 iron | 166 | 208 | 183 |
| 4 iron | 157 | 196 | 173 |
| 5 iron | 148 | 185 | 163 |
| 6 iron | 139 | 174 | 153 |
| 7 iron | 130 | 163 | 143 |
| 8 iron | 120 | 150 | 132 |
| 9 iron | 110 | 138 | 121 |
| p. wedge | 95 | 119 | 105 |
| s. wedge | 72 | 90 | 79 |
| l. wedge | 50 | 63 | 55 |

Roughly +25 % across four upgrade tiers (stock, pro, tour, champion), each tier also tightening the
accuracy band. How the real holes then play for a beginner: hole 1 (360.7, par 4) is drive plus a
6 iron; hole 2 (181, par 3) is a slightly stretched 2 iron over water; hole 3 (608.6, par 5) is a
genuine three-shot hole. Fully upgraded, hole 1 becomes drive plus a wedge - the progression is
felt on the same ground.

**These are design values, not measurements.** Only the reference's ~287 yd drive was measured, and
it is deliberately NOT used as the stock number.

