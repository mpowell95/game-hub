# Pixel Pro Golf — reference spec, and the build spec for our version

**Purpose.** This document is the complete written record of a commercial mobile golf game
("Pixel Pro Golf"), reconstructed frame by frame from five screen recordings, PLUS the decisions
that turn it into the game we are actually building. The session that implements it will **not**
have access to the videos.

**Read **READ THIS FIRST** and section 0 before anything else** — a golf game already exists in this
repo, and several of our decisions deliberately depart from the reference.

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

# READ THIS FIRST — this document supersedes every existing golf document

A golf game already exists in this repo at `golf/`. **It is being replaced, not extended.**

**Ignore all instruction in all existing golf documents.** Specifically and without exception:

- `golf/CLAUDE.md`
- `golf/DECISIONS.md`
- `golf/docs/GOLF-HANDOFF.md`
- `golf/docs/GOLF-PART9.md`
- any other file under `golf/` that reads as a spec, a decision log or a handoff

Those describe a **different game**: 3D, three.js + cannon-es rigid-body physics, aim/power/spin on
three separate meters, Modified Stableford scoring, on a course called Harbor Links. Matt's
verdict on it: *"It's terrible and this is a MAJOR overhaul... I don't trust anything that the
current build does."* Do not carry its decisions, its tuning numbers, its physics constants, its
course design or its UI forward. Do not treat its "frozen"/"tuned"/"decided" markers as binding —
they were decided for a game that is going away.

**This file is the only spec.** Where it is silent, ask, or decide and write it down here.

When the rewrite lands, those four documents must be deleted or rewritten, so the next session
after this one is not misled the same way.

## Harbor Links is gone

The old course, Harbor Links (`harbor`), is **removed from the product entirely.** Matt:
*"I could never even finish a single test hole because it sucked so much. It simply wasn't
playable. It's only ever been in test mode. There is no data for it. I do not want to see 'harbor'
anywhere in the hub. No mention of it ever."*

So: no course named harbor, no `courses/harbor/`, no harbor string in any UI, no harbor row in My
Stats, no harbor entry in the admin page's per-course testing config, no mention in any user-facing
copy in either language.

**The one thing that is NOT deleted: stored stats keys.** THE LAW rule 5 is that old keys are never
deleted and never repurposed, and the rule holds even for keys everyone believes are empty. So
`gf.practice.harbor` and `bestRoundByCourse.harbor` are simply **never written and never read**
again. They are not removed from `ensureGf`'s shape, and no cleanup code goes hunting for them. An
empty key that nobody reads shows nothing to anybody, which satisfies "no mention of harbor" without
a destructive write.

**Verify before building, do not assume.** Matt is confident there is no harbor data, and the course
only ever ran in testing mode (which routes to `gf.practice`, a bucket reachable by no counter, no
best and no leaderboard). That is almost certainly right. It still gets checked, because THE LAW's
own wording is *"You must never delete or lose or risk deleting or losing any player data. You must
always verify this."* The check: read `players/*/stats/games/golf` out of Firebase (see
`backups/rtdb-backup.mjs`) and look at `gamehub.stats` on a real device. If every golf record is
genuinely empty, proceed. **If anything is found, stop and tell Matt before writing a line of code.**


## How to read the confidence markers

Every non-obvious claim carries one of these. **Do not silently upgrade an inference to a fact.**

- **[MEASURED]** — read directly off frames, or computed from pixel data. Trust the number.
- **[OBSERVED]** — clearly visible and unambiguous, but not numerically measured.
- **[INFERRED]** — a reasonable reading of the evidence that could be wrong. Flagged individually.
- **[UNKNOWN]** — never visible in any clip. The implementer must decide. **These are listed
  together in §14 so nothing gets quietly invented.**

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
| **Scoring goal** | Track the player's best round score. **While the course is 3 holes, that is a best-of-3; it becomes a best-of-9 when holes 4-9 ship.** A 3-hole best and a 9-hole best are NOT comparable (THE LAW rule 4), so they must be stored under **different keys** — e.g. `bestRoundByCourse['pinevalley3']` and later `['pinevalley9']` — never merged, and the leaderboard names which it is showing. |
| **World ranking** | Renamed **skill level**. **Starts at 0 and counts UP** as the player improves (the original counted down from 20,073). |
| **Cash** | Deferred. Prize money exists in the reference, but the economy is NOT in this build (see below). |
| **Shop** | Deferred to a later phase. When it ships it sells **clubs only, not clothing** — clubs with real stats (more distance, tighter accuracy). **This build ships the STOCK bag only** (21.3, left-hand column); no shop UI, no prize money, no upgrade tiers. |
| **Practice mode** | Keep. Single-hole practice alongside the full round. |
| **Audio** | **None.** Do not add sound. Do not spend time on it. |
| **Hub integration** | In-hub `module:`, `immersive: true` (full screen, hub chrome hidden), like Skeeball. |
| **Names (frozen forever — THE LAW rule 5)** | folder `golf/` · stats id `'golf'` · settings key `gamehub.golf.v1` · recorder `recordGolf` |

**Later additions to these decisions (2026-09-03):**

| Topic | Decision |
|---|---|
| **Meter colours** | Keep the reference's red/green exactly. Revisit only if it proves unreadable in play. |
| **Leaderboard number** | The player's **best round score, lowest wins** — best-of-3 today, best-of-9 once the course is complete, under separate keys (see Scoring goal). Skill points may replace it later. |
| **Tap-target floor** | A suggestion, not a rule (see 18.2 for why). |
| **Ball flight time** | `0.9s + distance/60` (a 215 yd drive ~4.5s, a wedge ~1.7s), plus **tap to skip**. The reference's 7.5s drive is too slow. |
| **Putting** | Implement a gentle break driven by the green's slope grid. |
| **Skill points / shop economy / prize money** | Leave EMPTY and TBD. Build the gameplay first. This is the single answer; the rows above defer to it. |
| **Club distances** | APPROVED, see 21.3. Stock driver **215 yds**, not the reference's measured 287 - that figure left no room for upgrades and made a 360 yd par 4 play as a drive and a wedge. |

**Consequences to keep in mind while building:**
- The scorecard screen loses its opponent scoreboard panel. Keep the grid, the totals and the avatar.
- The `(1,0)` mystery number is moot — it lived in the opponent scoreboard. Do not implement it.
- `best -` (the HUD's third line in tournament mode) becomes the player's own best for that hole.
- Club upgrades change balance: the club ladder must be designed as a *base* bag that purchased
  clubs improve on.


---

# 1. Overview and core game loop

A single-player, top-down, pixel-art golf game for portrait phones. The player aims with two arrow
buttons, picks a club, and hits the ball with a **three-tap swing** against a circular meter. The
camera follows the ball, the ball comes to rest, and the loop repeats until the ball is holed.

**The reference's flow** (tournament mode is CUT in ours — see section 0):

```
title
  └─ career (player home: ranking, tour, winnings, equipment)
       └─ play  →  course card (Pine Valley, 3 holes)
            ├─ play      →  the tournament round, vs 3 AI opponents        [CUT in ours]
            └─ practice  →  tutorial modals  →  practice hole select  →  play a single hole
                                                                            └─ hole complete
                                                                                 └─ round scorecard
```

**Ours:**

```
hub tile
  └─ course card (Pine Valley, 3 holes)
       ├─ play      →  full round of 3 holes  →  round scorecard  →  quit / restart
       └─ practice  →  hole select  →  play a single hole  →  scorecard
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

> **REFERENCE ONLY, except 2.3 and 2.5.** Our game is launched from the Game Hub tile, so there is
> **no title screen and no career screen** — 2.1, 2.2 and everything they contain (`merch`, `packs`,
> `VIP`, `tournaments`, `online`, `iMessage`, `Game Center`, `WORLD RANKING`, the cross-promo strip)
> is **NOT BUILT**. It is documented because the art direction, panel styling and button treatment
> are worth copying. **2.3 (course card)** and **2.5 (hole select)** ARE built. On **2.4 (tutorial
> modals)**: modals 1-3 ship, rewritten in our own words and shown once; **modal 4 is cut** with the
> power/precision toggle (§5.4).

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
  tree clusters, blue water, cream bunkers, mown-grass texture), inside a dark border frame. Metadata is overlaid **in the thumbnail's own corners**, not listed beneath it. Three corners carry
  text (the fourth, bottom-right, is empty), and one of them holds two values:

| Corner | Text (verbatim) |
|---|---|
| top-left | `3 hole` |
| top-right | `Ranking points: 2,700` (yellow badge) |
| bottom-left | `Best: -, top place: -` |

  The dashes are literal — they are what the game shows before you have a record on the course.
  **For our build:** `3 hole` and `Best: -` carry over. `Ranking points` and `top place` are
  tournament fields and are **cut**; `Prize:` belongs to the deferred economy.
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

**These are REFERENCE MEASUREMENTS, not a layout spec.** They record where the original put things
on one specific 1206 x 2622 phone. **Do not hard-code them.** Our game must fit two phone heights,
standalone and mounted inside the hub's chrome (~138 px of it) — see 19.C — so lay the HUD out in
**proportions of the viewport** and use the table for the intent: which corner, roughly what size
relative to the screen, and what sits next to what.

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
- Every small square control is **102 × 94 px**, which at 3x is **34 × 31 pt** — **BELOW** the
  44 pt guideline on both axes. [MEASURED] (An earlier draft of this line said "comfortably above",
  which was simply wrong and contradicted 18.2.) The guideline is a suggestion here, not a rule
  (18.2), but if you want the taps to feel right, keep the visual box at this size and extend the
  hit area with transparent padding.
- The top HUD starts at **y = 246–252**, i.e. roughly 250 px (83 pt) of top inset is left clear for
  the status bar / notch. [MEASURED]
- The `swing` button's bottom edge is at **y = 2439**, leaving **183 px** (61 pt) of bottom inset
  clear for the home indicator. [MEASURED]
- Aim controls, club controls and the swing button all sit in the **bottom 25 %** of the screen —
  the thumb zone. Nothing interactive is in the top half except `card`. **This is the part to
  reproduce**, in proportions; the absolute pixel values are documentation.
- **Note on the two overlapping boxes:** the swing button (x 858-1139, y 2286-2439) sits inside the
  power meter's measured bounding box (x 798-1145, y 1782-2387). The meter box was measured
  including its `25`/`50`/`75`/`100` labels and the accuracy bar at its foot, so it over-reports;
  the ring itself stops above the button. Treat the ring, the accuracy bar and the button as three
  separate elements stacked bottom-right, not as one box.

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
  [OBSERVED across all five clips]
- Each tap rotates the aim by a small fixed increment. The reference's exact per-tap angle was
  **not** measurable. **DECIDED for our build (ours, not measured): 1.5 deg per tap, press-and-hold
  auto-repeats at 8 taps/second after a 400 ms delay, and aim is limited to +/- 60 deg from the line
  to the hole.** 1.5 deg at 215 yds moves the landing point about 5.6 yds — fine enough to aim at a
  pin, coarse enough that ten taps means something.
- The aim line is drawn as a **row of small red square markers** running from the ball up the hole.
  **These are NOT decoration and NOT evenly spaced filler — they are a POWER LADDER. Read 21.1
  before building the aim line.** In short: dots at 25 / 50 / 75 / 100 % of the selected club's
  distance, the line turning red past the fourth, and a fifth dot marking the over-100 risk zone.
  On the green they become smaller red dots.
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
- **The meter is STATIC until you tap.** Over a 24-second idle stretch (`Holes 1&2.mp4`, 8-32 s,
  no swing in progress) the marker does not move at all. Tap 1 starts the sweep, exactly as the
  tutorial says. [MEASURED — re-verified 2026-09-03]
- It reaches the top (touching the green segment beside the red over-100 block) in **≈ 0.75 s** from
  the bottom. [MEASURED over 17.40–18.13 s at 15 fps, which falls between tap 1 at 16.57 s and tap 2
  at 18.13 s — see §8]
- **It then reverses and sweeps back down.** It is a **ping-pong oscillation**, not a one-way fill
  that stops at the top. [MEASURED — the tick was tracked frame by frame at 15 fps and 20 fps
  across the full cycle]
- Full cycle (up and back down) ≈ **1.5 s**, assuming it comes down at the same rate it goes up.
  **[INFERRED — the up-sweep is measured; a complete down-sweep was never timed end to end.]** An
  earlier draft stated 1.4 s as measured, which was not supportable: 0.75 s up implies ~1.5 s
  symmetric, and nothing in the footage establishes an asymmetric return.
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

**But note:** the band DOES narrow on a bad **lie** — see 21.2. That is a different cause (the
surface you are playing from, not how hard you are swinging) and it IS implemented.

## 5.4 The over-100 sub-mode

Tutorial modal 4 states that for shots over 100 %, tapping the **top of the meter** toggles between
**power** and **precision**. This toggle was **never exercised** in any of the five clips, so its
visual state, its effect and its tap target are all unverified. [UNKNOWN beyond the tutorial text]

**DECIDED: the toggle is CUT from our build.** Over-100 % is a plain risk band — +10 % distance and
1.5x the mishit angle (§20), nothing to toggle. Building an unverified sub-mode from one sentence of
tutorial text would be guesswork, and the risk band already gives the over-swing its meaning. Drop
tutorial modal 4 with it.

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

**Shot 1 (driver) — CORRECTED 2026-09-03.** An earlier draft listed 19.40 / 20.00 / 20.15 s. That
scan began at 17.0 s, missed the real first tap at 16.57 s, and so mislabelled taps 2 and 3 as 1
and 2. Re-scanned from 12 s:

| Event | Time | Gap |
|---|---|---|
| tap 1 (begin stroke) | **16.57 s** | — |
| tap 2 (lock power) | **18.13 s** | 1.56 s after tap 1 |
| tap 3 (stop accuracy) | **19.17 s** | 1.04 s after tap 2 |
| ball launches | ≈ 20.5 s | |
| button disabled (dark) | 20.57 – 21.97 s (**1.40 s**) | |

Each tap darkens the button for only **33-67 ms**.

**Shot 2 (7 iron):** taps detected at 45.50 s and 45.60-45.90 s, launch ≈ 46.0 s, button disabled
46.00 - 47.33 s (**1.33 s**). **Only two taps were separable here** — the third falls inside the
45.60-45.90 window or was missed by the scan. Shot 1 is the reliable sample.

**Around the hole-out:** button disabled 74.43 - 75.97 s (**1.54 s**). Note this starts ~2.4 s after
the ball is recorded as at rest (≈72 s in §9.2); the two were measured by different methods and the
resting time is the rougher of the two. The ~1.4 s input lock is the figure to build to.

**What this means for the clone:**
- The full sequence takes about **2.6 seconds** (16.57 → 19.17 s on shot 1). **CORRECTED** — an
  earlier draft said "well under one second" and called it a twitch input, which came from the
  mislabelled tap table above. It is deliberate rather than frantic: roughly one full meter cycle to
  choose your power, then about a second to stop the accuracy slider.
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

In the first two clips: `driver`, `9 iron`, `6 iron`, `7 iron`, `putter`. **Superseded** — the full
list across all five clips is in 17.2, and **the bag to build is the approved ladder in 21.3.**

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

**Unit switching:** the readout is in **yards** off the green and **feet** on the green.
**DECIDED: switch on SURFACE, not on distance** — feet whenever the ball lies on the green, yards
everywhere else. That matches both observations (`136.0 yds` in the fairway, `17.0 ft` on the green),
it is what real golf apps do, and it needs no threshold constant to guess at.

## 10.4 Wind

- Wind read `0` in **every frame of all five clips**, and the course description said
  `Wide fairways and still conditions.`
- **The effect of non-zero wind was never observed.** [UNKNOWN]
- **DECIDED for our build: wind is always 0 on holes 1-3.** Render the panel with a calm state (no
  arrow — see §13 flaw 4) and add no wind term to the flight model. Non-zero wind is a later feature
  and needs its own design pass. This keeps the HUD honest instead of shipping a readout that
  does nothing.

## 10.5 Hazards

Visible on the hole: **water** (left of the tee, and along the green's left and back edges),
**bunkers** (one short-left of the green, one right of it), **trees** lining both sides and pinching
the landing area, and **rough** outside the fairway. A ball DOES finish in the trees on hole 3 (`Hole 3.mp4`, 49-51 s) and the game prompts for a drop —
see 21.2 for the full rule, the verbatim text and the per-lie power model. Bunker and water lies are
still never entered in any clip.

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

**Superseded** — holes 2 and 3 were played in the later clips and are documented in 17.1: hole 2 is
a 181.0 yd par 3 with an island green, hole 3 a 608.6 yd par 5.

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

## 12.3 The round scorecard — PRACTICE / single-hole version

**There are TWO scorecard layouts in the reference.** This is the one seen after a single practice
hole. The full-round version is in 17.7 and differs (a `continue` button, a round total, `best:` and
`top place:` lines, a round restart icon). Build both, and note that `top place:` is a tournament
field — **cut it**, along with the opponent scoreboard.

- Orange `quit` (left) and orange `restart` (right) at the top.
- Grey hatched panel: `Pine Valley`, then `PRACTICE`.
- The nine-column grid:
  - hole row `1` `2` `3` — the played hole now dimmed
  - par row `4` `3` `5`
  - score row `3` `-` `-`, with the `3` **in a green-filled cell** (under-par colour coding)
- White scoreboard row: `1` `You`, right-aligned `-1`, with `(1,0)` in small grey beneath it.
- The **full-size player avatar** stands to the left, overlapping the card.

`(1,0)` is never explained on screen and stayed ambiguous to the end. **It is CUT** — it lived in
the opponent scoreboard, and there are no opponents. Do not implement it.

## 12.4 Progression systems glimpsed but never used

`WORLD RANKING 20,073`, `Winnings $0`, `update equipment`, `Ranking points: 2,700`, `Prize: $1,000`,
`packs`, `VIP`, `shop`, `merch`, `tournaments`, `online`, `iMessage`, `Game Center`.
**Partly superseded** — the character/shop editor and the full post-round economy were captured in
the later clips; see 17.5 and 17.8. The rest were never opened, and are cut by decision anyway.

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
7. **A ~7.5 s ball flight with no skip.** **DECIDED:** flight time is `0.9s + distance/60` (a 215 yd
   drive ~4.5 s, a wedge ~1.7 s) **plus tap to skip.** See section 20.
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
- The over-100% **power vs precision** toggle: its visual state, its tap target, its effect.
- Wind: units, arrow semantics, strength of effect. Wind read `0` in all five clips.
- ~~Hazard rules~~ — **RESOLVED.** The prompt is observed and transcribed, and Matt has specified
  the drop line, the water rule, the per-lie power caps and the tree-collision model. See 21.2.

- Score banners other than `Birdie!` and `New course best`.
- Holes 4-9 - out of scope for now, ours to design later.
- Whether the device scale factor is genuinely 3x (assumed for the pt conversions in section 3.1).

**Decided, so no longer open:**

- The club ladder — approved, 21.3.
- The mishit penalty — designed, 17.9.
- Lies, drops, water and tree collisions — specified, 21.2.
- Flight time, putting break, skill/shop economy — see the decisions table in section 0.

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

Unhurried. Long preview scrolls, no timers, no pressure anywhere. **The only timed thing in the
entire game is the swing meter itself.** The reference's ball flight was 7.5 s; **ours is ~4.5 s for
a drive with tap-to-skip** (section 20). The rhythm to keep is the contrast: a slow, relaxed frame
around one deliberate, timed moment of input — about 2.6 s of it (§8), not a frantic one.

---

# 16. Build order

**This is a REWRITE of an existing game, not a new one.** Read section 19 first for what already
exists and must be kept. Everything under `golf/` that renders or simulates is being replaced;
the hub entry, the stats plumbing and the leaderboard row are being kept.

## Phase 0 — before writing any code

1. **Verify there is no player golf data.** Read `players/*/stats/games/golf` from Firebase (see
   `backups/rtdb-backup.mjs`) and check `gamehub.stats` on a real device. Expected: empty, because
   Harbor Links only ever ran in testing mode. **If anything is found, stop and tell Matt.**
2. **Take a backup** (`node backups/rtdb-backup.mjs`) regardless of what step 1 finds.

## Phase 1 — clear the ground

3. Delete the 3D stack. **The full list, verified against the repo:**
   `golf/js/render.js`, `camera.js`, `terrain.js`, `minimap.js`, `physics.js`, `flight.js`,
   `meters.js`, `game.js`, `clubs.js`, `test.js`, `golf/courses/`, `golf/tools/`, and
   **`golf/js/vendor/`** (cannon-es 13,023 lines + two three.js files, ~1.1 MB).
   `golf/css/golf.css` is rewritten, not deleted.
   **`run-all-tests.mjs:44` registers `golf/js/test.js` and MUST be updated in the same commit**, or
   the whole suite fails on a missing file. `golf/js/test.js` imports six of the files above, and
   `game.js` imports two more — deleting piecemeal leaves broken imports.
4. Delete `DECISIONS.md`, `docs/GOLF-HANDOFF.md`, `docs/GOLF-PART9.md`. They describe the old game
   and will mislead the next session if left in place.
5. Remove every trace of **Harbor Links** from the product. **The references live in five shared
   files outside `golf/`, verified against the repo:**
   - **`js/game-stats.js:1405`** — `const courseId = e.courseId || 'harbor';`. **This one matters
     most:** leave it and a testing-mode Pine Valley round writes `gf.practice.harbor`, which
     violates this spec's own "never written again" rule. Change the default to the new course id.
   - **`js/game-stats-ui.js:575`** — `const GOLF_COURSES = { harbor: 'Harbor Links' };`. Leave it and
     a Pine Valley best renders as "PINE-VALLEY". Replace the entry.
   - **`js/hub.js:388`** — a comment referencing `golf.courses.harbor`.
   - **`js/admin-config.js:17,37`** — harbor in the config shape/comments.
   - **`sw.js:315-316`** (ASSETS) and **`sw.js:676-677`** (REST_MANIFEST) — the harbor course files.
   - **`test-admin-config.mjs:117-134`** uses `'harbor'` as a throwaway course id in 12 assertions.
     **Leave this file alone** — it is a test fixture, not a product reference.
   **Do not delete the stored stats keys** (see READ THIS FIRST).

6. **Unlock the course, or the game ships padlocked.** `js/admin-config.js:200` —
   `resolveCourseTesting` returns **testing (locked) when no override exists**, so every course
   defaults to locked, and `golf/js/ui.js:135-141` hides the tile behind a padlock for any
   non-dev profile. **`js/admin-ui.js` contains no golf or per-course section at all**, so there is
   no in-app way to unlock it. Without a fix here the family taps the tile and cannot play.
   **This needs Matt's decision** — flip the default to open for golf, add a per-course section to
   the admin page, or write a one-off override. **Do not ship until it is resolved.**
   (An earlier draft of this spec told the implementer to *remove* an "admin per-course testing
   entry". No such entry exists.)

7. **Decide whether golf stays visible during the rewrite.** The hub tile is **not** `devOnly`
   (`js/hub.js:385-402`), so golf is live to every player right now. Mid-rewrite `main` would carry a
   half-deleted module behind a tappable tile. Either add `devOnly: true` for the duration and remove
   it at release, or keep every commit playable.

## Phase 2 — the core loop, playable as early as possible

6. Portrait canvas, top-down scrolling tilemap, north-up, no rotation.
7. Hole data for Pine Valley 1-3 (17.1): fairway, rough, green, bunkers, water, trees, tee, pin.
8. Ball as one white pixel plus an offset dark shadow pixel. Height drives the offset. Nothing else.
9. HUD at the measured geometry in 3.2, corner-anchored, floating over the art.
10. Aim: `<` / `>`, and **the five-dot power ladder on the aim line** (21.1) — 25/50/75/100 % plus
    the red risk dot past 100.
11. Club tile with club-head sprites, `^` / `v`, auto-selection by lie and distance, using the
    approved ladder (21.3).
12. **Power ring: ping-pong oscillation, ~0.75 s bottom to top, ~1.5 s full cycle. Static until tap 1.**
13. **Accuracy bar: ping-pong slider, red/orange/green/orange/red, stop in the green for straight.**
14. **Three-tap input (~2.6 s total, NOT sub-second), button darkens 33-67 ms on press, input locked ~1.4 s after the shot.**
15. Ball flight (`0.9s + distance/60`, tap to skip), camera tracking, landing, roll, rest.
16. Lies: power caps **and** the visibly narrowed accuracy band (21.2), with the two-line readout.
17. Hazards: the `In the trees` prompt, drop-along-the-line for +1, water dropped at the edge,
    and tree trunks/canopies that actually block the ball (21.2).
18. Putting on the same controls, static camera, ~2.5 s decelerating roll, feet not yards, gentle
    break from the slope grid.
19. Result banner, rotating sunburst, ~2.5 s, self-clearing; cross-fade (~0.5 s) to the scorecard.
20. Scorecard: nine-column grid, par row, score row, green cell for under par, avatar overlapping.
21. Pre-shot free scroll with the lie tile and yardage fading to ~40 %.

## Phase 3 — wiring and release

22. **Stats:** keep writing `points` (Stableford is a pure function of hole score and par — see "What changes" item 3 in section 19),
    write the new course's `bestRoundByCourse` key, leave harbor's keys untouched.
23. **Leaderboard:** switch `golfPointsAt` to best round **and fix the sort direction in the same
    commit** (19.A). Add a test that fails if the sort is wrong.
24. **`golf/js/strings.js`:** rewrite EN **and ES**, every visible string through `t()` at render time.
25. **`golf/CLAUDE.md`:** rewrite from scratch for the new game. **Also add a Golf row to the games
    table in the ROOT `CLAUDE.md`** — it has none today (THE LAW rule 9: a milestone is not done
    until CLAUDE.md reflects it). Row: in-hub `module:`, immersive · `.gf-root` / `.gf-` ·
    `gamehub.golf.v1` · `recordGolf`.
26. **`sw.js`:** drop the deleted files from `ASSETS`, add the new ones, bump `CACHE` past
    `origin/main`, run `node validate-sw-assets.mjs`.
27. **Tests.** `node test-game-conventions.mjs`, then `node test-visual.mjs golf`. Fix failures in
    the game; do not add golf to `KNOWN_GAPS`. **Also run these three, which the earlier draft
    omitted and which cover exactly what this rewrite touches:**
    - **`players-agg.test.mjs`** — its structural probe requires every sub-counter key in
      `game-stats.js` to have BOTH a `players-agg.js` branch and a My Stats renderer. Any change to
      `ensureGf`'s shape trips it. (Good news: `js/players-agg.js:343-375` **already has** a golf
      branch, including the `Math.min` merge for `bestRoundByCourse` — that gap does not exist.)
    - **`test-admin-config.mjs`** — 12 assertions using harbor as a course id.
    - **`test-recorder-contract.mjs`** — covers the recorder surface.
28. **Deploy means LIVE on `main`** — merge, confirm the pages build succeeded, then say so.

## Deliberately NOT in scope

Skill points, the club shop economy, prize money, holes 4-9. Left empty and TBD by decision until
the gameplay is right.

---

*(Sections 17 onwards were added after later clips and later decisions. Where an earlier section
disagrees with a later one, the later one wins — the conflicts found on review are now marked
"superseded" in place.)*

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

**SUPERSEDED — the bag to build is the approved ladder in 21.3**, whose stock driver is 215 yds.
The 287 figure is reference data only and is deliberately NOT our stock number.

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

For our version (skill level starting at 0, counting up), the equivalent would be **+2,700 skill
points for the round**, scaled by how well the player scored. **This is for a LATER PHASE** — the
skill/economy system is deferred (section 0). Recorded here so the number is not lost.

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
- **Green zone — the middle 40 % of the bar** (from 30 % to 70 % of its width): offline angle =
  `off x 1.5 deg`. Effectively straight.
- **Orange zone — the next 20 % on each side** (10-30 % and 70-90 %): angle ramps `1.5 deg` to `4 deg`.
- **Red zone — the outer 10 % on each side** (0-10 % and 90-100 %): angle ramps `4 deg` to `8 deg`,
  and the shot also loses **10 % of its distance**.

40 + 20 + 20 + 10 + 10 = **100 %**. (An earlier draft used 40/30/15, which sums to 130 % and cannot
be laid out.)
- Marker **left** of centre pulls the ball left; **right** pushes it right.
- Over 100% power multiplies the resulting angle by **1.5**, which is what makes overswinging risky
  and matches the tutorial's warning.
- The ball should **curve** toward its miss over the flight rather than launching on a straight
  offset line - it reads far better and is how the genre does it.

At the stock driver's 215 yds, a full red miss (8 deg) lands about **30 yds offline**: punishing,
recoverable, not round-ending.

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

**A note on units, because they are easy to conflate:** `docs/BUILDING-A-GAME.md:33` states the
rule in **CSS px** ("Tap targets are 44x44px minimum, with a documented exception"), and it already
carries a sanctioned way to depart from it — dots-boxes' `--db-tap`, which measures the alternative
and documents why. The reference's controls are 102 x 94 **device** px, which is 34 x 31 pt at 3x.
Compare like with like before concluding anything.

**Recommended fix:** keep the reference's visual box size, but extend the *hit area* to at least
44 x 44 with transparent padding. The layout looks identical and the control becomes reachable.
Do not simply shrink-copy the original's geometry.

## 18.3 Minimum text size

Part 0 sets an **11 px floor**. Several reference readouts are drawn very small — the `(0,0)`
sub-line, the greyed third line of the par panel, the meter's `25`/`50`/`75`/`100` tick labels.
Check each against the floor at render size; shorten strings rather than going below it.

---

# 19. Game Hub integration — MOST OF THIS ALREADY EXISTS

**Correction to an earlier draft of this document.** This section previously told the implementer to
create the hub entry, the stats plumbing and the leaderboard row from scratch. That was written
without checking the repo, and it was wrong: golf is **already fully wired in**. Creating any of it
again would duplicate or clobber working code.

## What already exists — KEEP IT, do not recreate it

| Thing | Where | Status |
|---|---|---|
| Hub tile | `js/hub.js` `GAMES`, `id: 'golf'`, `module: '../golf/js/ui.js'` | **exists — keep** |
| Tile art | `GAME_ART["golf"]` in `js/game-art.js` | **exists — keep** |
| Stats id | `'golf'` in `js/game-stats.js`'s `GAMES` list | **exists — frozen forever** |
| Counter shape | `ensureGf()` — `rounds, holes, strokes, points, birdies, eagles, aces, longestDriveYd, bestRoundByCourse, practice` | **exists — additive changes only** |
| Writer | `recordGolf(difficulty, extras)` | **exists — keep the signature** |
| Testing bucket | `gf.practice`, courseId-keyed | **exists — keep** |
| Leaderboard row | `GAME_META` `{ id: 'golf', labelKey: 'game_title_golf' }` in `js/leaderboard-ui.js` | **exists — keep** |
| Leaderboard metric | `golfPointsAt(g)` returning lifetime Stableford `gf.points` | **exists — CHANGES, see below** |
| Strings | `golf/js/strings.js`, EN + ES | **exists — rewrite contents, keep the module** |
| Settings key | `gamehub.golf.v1` | **check before use; do not mint a second one** |

## What changes

1. **Everything under `golf/` that renders or simulates.** `render.js`, `camera.js`, `terrain.js`,
   `minimap.js`, `physics.js`, `flight.js`, `meters.js`, `courses/`, and the three.js + cannon-es
   vendor files all go. The new game is 2D top-down with a parabola and a shadow offset; none of a
   3D rigid-body stack survives that change, and bending it to fit would cost more than writing the
   parabola.
2. **`golfPointsAt` switches from lifetime Stableford points to the player's best round** (Matt's
   call). **Change the sort direction in the same commit** - see 19.A.
3. **`points` keeps being written.** Modified Stableford points are a pure function of (hole score,
   par), and the new stroke-play game knows both, so it can keep the lifetime counter truthful with
   no fabrication. Nothing has to be archived as a dead legacy value.
4. **`sw.js`**: remove the deleted files from `ASSETS`, add the new ones, bump `CACHE` past
   `origin/main`, run `node validate-sw-assets.mjs`. Dropping ~13,000 lines of vendor physics is a
   large precache win.
5. **`golf/CLAUDE.md`** is rewritten from scratch for the new game. `DECISIONS.md`,
   `docs/GOLF-HANDOFF.md` and `docs/GOLF-PART9.md` are deleted.

## 19.A The sort-direction trap

The leaderboard sorts every game **descending**, which is correct for Stableford points (more is
better) and **wrong** for a stroke score (less is better). Switching the metric without switching
the sort puts **the worst golfer in the family at the top of the board**, and it will look plausible
enough to go unnoticed for weeks. Change both together, and add a test.

Related: `bestRoundByCourse` is keyed by course. The leaderboard must show a named course's best,
not a blind maximum across keys, or it will one day compare two courses that were never comparable
(THE LAW rule 4).

## 19.B Round persistence and `isInProgress()`

A 9-hole round is long, so abandoning mid-round must not lose it.
- **Do NOT mint `gamehub.golf.save.v1`.** `gamehub.golf.v1` already exists and already holds the
  round (`golf/js/ui.js:29,53,57` — `{ difficulty, lastCourse, round }`). Keep using that one key;
  a second store would create two sources of truth. Per THE LAW rule 5, do not repurpose the
  existing `.round` field — write the new round shape into it, or add a sibling field beside it.
- Autosave (hole, shot count, ball position, per-hole scores) after every stroke.
- `isInProgress()` returns true whenever a round is part-played, so the hub warns before unmounting.
  **It currently returns a hard `false`** (`golf/js/ui.js:977`) — that must change.
- The reference's `quit` / `restart` buttons map to: `quit` = leave, keep the save; `restart` =
  discard and re-tee. Confirm before `restart` — it destroys progress.

## 19.C Other repo rules that bite here

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

- **Club distances: use the APPROVED ladder in 21.3** — stock driver **215 yds**, not the
  reference's measured 287. That 287 was recorded with an unknown, possibly upgraded bag and is
  deliberately not the stock number. (An earlier draft of this section told the implementer to
  design the bag beneath 287; that is superseded.)
- **Distance = clubCarry × (power ÷ 100) × lieFactor**, where `lieFactor` is the lie's percentage
  from 21.2. **`lieFactor` SCALES THE RESULT — it does not clamp the meter.** The player can still
  swing to 100 % (and past it) in a bunker; the ball simply travels 88 % as far. The aim-line dots
  scale by the same factor, so they keep telling the truth.
- **Over 100 % adds up to +10 %** distance and multiplies the mishit angle by 1.5 (§17.9). +10 % is
  what the "Dot 5 (risk)" column in 21.3 is computed from. (An earlier draft said +8 % here, which
  contradicted that column.)
- **`clubCarry` is CARRY, not total.** Roll is added afterwards, per the surface below. The five aim
  dots mark **where the ball lands**, so on a fairway the ball finishes slightly past dot 4.
- **Flight time — DECIDED:** `0.9 s + distance / 60`. Against the approved ladder that is a **215 yd
  drive in ~4.5 s** and a **50 yd wedge in ~1.7 s**. The reference's 7.5 s drive is too slow.
  **A tap skips to the landing.**
- **Roll** after landing: fairway ≈ 8 % of carry, green ≈ 2 %, rough ≈ 3 %, bunker ≈ 0.
- **Putting**: distance = `power ÷ 100 × maxPuttFeet`, with **`maxPuttFeet` = 60 ft** at full power
  (ours; the reference never showed a putter's range). Decelerating over ≈ 2.5 s [MEASURED reference
  roll]. The putter is deliberately absent from the 21.3 yardage ladder because it is measured in
  feet, not yards.
- **Green slope and break — DECIDED, ours.** Store the green as a coarse grid (say 8 x 8 cells over
  the green's bounding box), each cell holding a 2-D gradient vector in the range -1..+1. Apply a
  lateral acceleration of `k x gradient` to the rolling ball, with **k tuned so a 20 ft putt across
  a half-strength slope breaks about one cup width (~4 in)**. That is the feel to aim for; the exact
  constant is a tuning job, not a spec value. The drawn tick grid must match the stored gradients,
  or the read lies to the player.
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

## 21.2 Obstacles, drops and lies — OBSERVED, and fully specified

**Correction to an earlier claim in this document.** A previous pass asserted that no ball ever
entered a hazard and that the drop prompt "never happens on screen". **Both were wrong.** It happens
in `Hole 3.mp4` at **49-51 s**: the tee shot finishes behind a lone tree in the fairway and the game
prompts. The earlier sampling ran at 0.5-2 fps with samples at 0:30 and 1:00, and the prompt sits in
the gap — so the honest statement was always "I did not see it", never "it did not happen".

### The prompt, verbatim [MEASURED from frames at 49-51 s]

Full-screen banner, large white pixel text over the standard rotating sunburst:

```
In the trees
```

Then a modal — a **dark navy hatched panel**, distinct from the grey hatched tutorial modals — with
centred white pixel text:

```
In the trees, would you like to take a drop or play from your lie?
```

Two orange buttons, **stacked vertically**, full width of the panel:

```
Take a drop
Play from lie
```

### The lie is communicated by ART, not by numbers [OBSERVED]

After choosing `Play from lie`, the top-centre lie tile redraws: the ball sits **nestled in tall
grass tufts** instead of on its tee peg. That tile is the reference's ONLY indication of a bad lie —
there is no percentage, no label, no warning text anywhere on screen.

### Rules for the clone (Matt's design; the reference only supplied the prompt)

**Every bad lie does two things: it caps distance, and it narrows the margin for error.** Both are
shown to the player before they swing. Readout in the HUD:

```
Bunker
Power: 88%
```

| Lie | Power cap | Straight-zone width | Intent |
|---|---|---|---|
| Tee / fairway | **100 %** | **100 %** | baseline |
| Light rough | **92 %** | **85 %** | barely costs distance, slightly twitchy |
| Heavy rough | **82 %** | **65 %** | real distance loss, hard to control |
| Fairway bunker | **88 %** | **55 %** | nearly full distance, half the margin for error |
| Greenside bunker | **75 %** | **50 %** | short and fiddly by design |
| Trees / woods | **85 %** | **80 %** | the trunk is the real penalty, not the numbers |

*(Proposed values, not measured. Tune by feel — the shape matters more than the exact numbers.)*

**The design principle here: sand costs you CONTROL, not distance.** A real bunker shot is not
short, it is unpredictable, and the table is built to feel that way. Heavy rough is the opposite -
it genuinely eats distance.

### What changes on screen, and what does not

**The accuracy meter's green band visibly narrows** by the "straight-zone width" above. The marker
still sweeps at the same speed, so a smaller target is simply harder to hit. No new widget, no new
mechanic, and the player can see the shot is hard *before* committing to it.

**Everything else is unchanged.** The power ring's sweep speed and its 1.4 s cycle, the aim line,
and its five dots all render exactly as normal. The dots simply describe the reduced distances -
they always tell the truth about where a perfect strike lands.

**Decided (Matt, 2026-09-03): SHOW the narrowed band; do not hide it.** The alternative - leaving
the band looking normal while secretly punishing the same stop position harder - was considered and
rejected, because it reads as the game cheating: the player stops the marker in the green and the
ball goes sideways anyway. A visibly smaller green band communicates the difficulty with no text at
all. This is a deliberate, narrow exception to the "do not change the swing visuals" rule, which
governs the POWER cap specifically.

### Trees also physically block the ball

Being in the woods is not only a power cap: **the ball can hit a trunk or a branch and not get out.**
Model it with the height system that already exists for the ball's shadow:

- Each tree has a **trunk** — narrow, blocks the ball at any height — and a **canopy** — wider,
  blocks only balls travelling below canopy height.
- The ball's height at the tree comes from the club's loft.
- So the player faces the real dilemma with no extra UI: **punch low with a long iron** for distance
  while risking the trunk, or **loft a wedge** over the canopy and give up most of the yardage.

### Taking a drop

- Draw a line from **where the ball was struck** to **where it now lies**.
- The player may drop **anywhere along that line**.
- Cost is **+1 stroke regardless of where** on the line they drop.

(Real golf draws that line from the flag; this version is simpler to reason about on a phone and is
the one to build.)

### Water

**No choice is offered** — water is automatic. **Drop at the water's edge, +1 stroke.**

## 21.3 The club ladder — APPROVED (Matt, 2026-09-03)

**These are the numbers to build.** Anchored on hole design rather than on the reference's measured
287 yd drive, which was recorded with an unknown - possibly upgraded - bag and left no headroom for
the shop.

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

**Only the STOCK column ships in this build.** The "fully upgraded" column exists to show the ladder
has somewhere to go, and is roughly +25 % spread over four notional tiers (stock, pro, tour,
champion) that would each also tighten the accuracy band. **The two intermediate tiers and the band
multipliers are deliberately not specified** — they belong to the shop phase, which is deferred. How the real holes then play for a beginner: hole 1 (360.7, par 4) is drive plus a
6 iron; hole 2 (181, par 3) is a slightly stretched 2 iron over water; hole 3 (608.6, par 5) is a
genuine three-shot hole. Fully upgraded, hole 1 becomes drive plus a wedge - the progression is
felt on the same ground.

**These are design values, not measurements.** Only the reference's ~287 yd drive was measured, and
it is deliberately NOT used as the stock number.

