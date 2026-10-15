# Archery — build brief

Written 2026-10-14 from Matt's request: *"Analyze it and plan to create a 1 to 1 exact clone of it."*
"It" is a 34-second iPhone screen recording of Snapchat's archery game (Snap Games, played in a chat
against a friend), in Matt's Dropbox: `/Claude Code Refs/ScreenRecording_10-13-2026 23-31-02_1.MP4`.
For the session(s) that BUILD it. Matt's answers to the open questions are in §4 (same day).

> **THE LAW applies.** Root `CLAUDE.md` is always loaded. Nothing here overrides it.

## 0. Read first, in this order

1. Root `CLAUDE.md`, especially "Before you build: USE WHAT EXISTS", "The Challenges screen" and
   "Cancel, decline, resign, expire".
2. `docs/BUILDING-A-GAME.md`, Part 0 (UX floor) and Part 1 (module contract, "Adding a game").
3. `cup-pong/CLAUDE.md` and `docs/CUP-PONG-BRIEF.md`: the closest existing game (three.js
   first-person, CPU levels, turn-by-turn challenges by PLAYER CODE, push, launcher alert).
4. `darts/CLAUDE.md`, "Online challenges": the cleanest challenge implementation to copy.

## 1. The goal, and the one limit on "exact"

**Same game, same screens, same timing, same feel.** Everything in §2 is there to be matched.

**Not copied: their art, name or faces.** The bow, arm, stadium and target are drawn by us (a
standard 10-ring archery target is generic and fine). The game is called **Archery** (Matt). Bitmoji
avatars become each player's profile emoji. No sound (root `CLAUDE.md`).

## 2. What the recording shows

Every time below was read off frames **0.25 s apart** (so ± 0.13 s); the three hard cuts were found
by scene detection and are exact to the frame (2.20, 15.15, 21.69 s). The video is round 2 of 3.

### The screen (portrait, full-bleed, `immersive: true`)

| Element | Where | Look |
|---|---|---|
| Round pill | top centre | white pill, black bold "ROUND 2/3" |
| Arrow tiles | under the pill | 3 square tiles in one bar; **blue** = yours, **red** = the opponent's replay; "?" until that arrow is shot, then its score |
| Wind card | left, about 45% down | white rounded square with a blue arrow showing wind direction (down-left in the video), "WIND 3.1" under it; one value for the whole round |
| Score banners | left, under wind | red banner (opponent: avatar + running total, e.g. 42), "VS" badge, blue banner (you: avatar + total, e.g. 24) |
| Scene | full screen | first-person on a grass lane, white lane lines converging on a target on a wooden easel far away; stadium stands with crowd, roof canopy, sky with clouds, a blue barrier wall behind the target |
| Bow | right half | blue recurve held in the left hand, arm in a sleeve coming in from bottom-left, arrow nocked, a round **sight scope** on the riser |
| Leaves | anywhere | small green leaves drifting across the screen in the wind direction, a few on screen at any time |

### The turn, second by second

| Time (s) | What happens |
|---|---|
| 2.20 | Hard cut into the game: **replay** of the opponent's round. Target close-up with their 3 arrows in it (red fletching), red tiles "6 8 4", yellow **Your Turn** button |
| 2.20 to 4.00 | Replay holds (Matt tapped Your Turn at about 4.0) |
| 4.25 | Fade in to the shooting line: bow low, scope ring full green, tiles turn blue "? ? ?" |
| 4.75 to 9.25 | **Hint**: a hand taps a yellow dot left of the grip. The dot grows, peaks, fades, every **~1.9 s** (peaks at 5.4, 7.2, 9.0). Shown before arrow 1 only |
| ~9.4 | Touch and hold. **The draw takes under 0.25 s**: by 9.5 the bow is up and the scope is at the eye, showing the target magnified with a red crosshair |
| 9.5 to 12.3 | Aim: drag moves the sight, which also sways on its own. Ring drains (below) |
| ~12.4 | Release |
| 12.4 to 13.15 | **Flight, ~0.75 s**: the camera chases the arrow from just behind it; the target grows; the arrow curves with the wind |
| 13.15 | Cut to the target close-up, arrow stuck |
| 13.75 | **0.6 s later**: big yellow number with a black outline pops at the hit point; the tile fills "4"; your total counts 24 → 28 in the same frame |
| 13.75 to 14.5 | Yellow stars burst outward and fade |
| 15.15 | Cut back to the shooting line (close-up held **2.0 s** in all). No hint this time |
| ~16.4 / ~18.9 | Arrow 2: touch / release (held 2.5 s) |
| 19.0 to 19.75 | Flight; this time the camera **zooms on into the close-up without a cut** |
| 20.5 | "8" pops, total 28 → 36 |
| 21.69 | Cut back to the line |
| ~22.9 / ~28.1 | Arrow 3: touch / release (held 5.2 s; the ring went yellow) |
| 28.25 to 29.0 | Flight |
| 29.5 | "7" pops, total 36 → 43 |
| 29.5 to 30.75 | Round over: close-up holds with all 3 arrows and the stars fading, then the turn is sent (31.14, Snapchat's send screen) |

### The ring around the sight (measured on arrows 1 and 3)

- It is an arc **anchored at 12 o'clock running clockwise**; it shortens back towards 12.
- It stays full for about **0.4 s** after the touch, then drains.
- **It is not a plain timer.** Arrow 1 lost about 0.7 of the ring in 2.9 s while Matt was dragging
  the sight across; arrow 3 lost 0.5 in the first 2.3 s, then only 0.25 more in the last 2.3 s while
  he held nearly still. Best fit: it drains **about 0.3 a second while the aim moves and about 0.1
  a second while still**. Tune against the video.
- It turns **yellow below about 1/3** (arrow 3: green to yellow between 26.75 and 27.0).
- The sight keeps a small sway even when the finger is still.

### Scoring

Standard 10-ring face: yellow 10/9, red 8/7, blue 6/5, black 4/3, white 2/1, off the face 0.
3 rounds × 3 arrows, highest total wins: max 30 a round, 90 a match.

## 3. Our build

### Hub integration

| Thing | Value |
|---|---|
| Folder | `archery/` |
| Hub id / stats id | `archery` (checked 2026-10-14: unused) |
| Registry | `module: '../archery/js/ui.js'`, `immersive: true`, `devOnly: true`, no `released` date until Matt releases it from the admin page |
| CSS root / prefix | `.ar-root` / `.ar-` (checked 2026-10-14: unused) |
| Settings key | `gamehub.archery.v1` |
| Stats | `recordResult('archery', difficulty, won)`: `'easy'`/`'medium'`/`'hard'` vs computer, `'mp'` for a challenge, nothing for pass and play. `GAME_META` row in `js/leaderboard-ui.js` from day one (`OFF_THE_BOARD` stays empty) |
| Tile art | `GAME_ART.archery` in `js/game-art.js` |
| Strings | `archery/js/strings.js` `{en, es}` via `makeT` |
| Engine | three.js from `skeeball/js/vendor/three.module.min.js`, as Cup Pong. **No physics engine**: arrow flight is a ballistic curve plus wind, solved in closed form |

Every row of "Use what exists" applies. Run `node tools/test-game-conventions.mjs` before every commit.

### Files (Darts' split)

`engine.js` (pure: target rings, score at a point, match state, shoot-off) · `flight.js` (pure:
aim + sway + wind → hit point) · `cpu.js` · `render.js` (three.js scene, bow, arm, cameras) ·
`ui.js` (screens, input, HUD) · `mp.js` / `mp-ui.js` / `alert.js` (challenges) · `strings.js` ·
`test.js` (headless).

### The model under the feel

- **Aim** = a point on the target plane. Drag moves it (scaled so a thumb's travel covers about
  two target widths); sway adds a slow wander (two summed sines + noise), growing as the ring drains.
- **Ring** = stamina, per §2: full for 0.4 s, then ~0.3/s while the aim moves, ~0.1/s while still;
  yellow below 1/3.
- **Ring empty = PANIC (Matt).** The archer panics: the bow arm shakes hard for a moment, jerks up,
  and the arrow lets go on its own and **sails over the target**. Scores 0. The flight camera still
  follows it (over the target, into the wall or the stands) so the player sees what happened.
- **Wind** (Matt): one value per round, **the same for both players in that round, new each round,
  stronger each round**. Shown in mph with one decimal and an 8-way arrow. Round 1 of Matt's match
  was 1.5, round 2 was 3.1. Starting ranges: round 1 **0.5 to 2.0**, round 2 **2.0 to 4.0**,
  round 3 **4.0 to 6.0**; a shoot-off uses round 3's. The target never moves (Matt). Wind shifts
  the hit point by a fixed amount per mph, so the player has to aim off.
- **Hit point → score** is pure maths, so a replay only needs the stored points.

### Match rules (Matt)

- 3 rounds × 3 arrows.
- **The challenger shoots first in every round.** In a series, the next game is challenged by the
  other person, so they go first in that one.
- **Tie after 3 rounds: one more arrow each**, challenger first, same replay screens. If that ties
  too: closest to the centre wins (not decided by Matt; standard archery shoot-off rule, ask him if
  it ever matters). The shoot-off shows as "SHOOT-OFF" in the round pill.

### Modes

- **vs Computer**, Easy / Medium / Hard: the computer "shoots" a hit point from a spread around the
  centre, tighter per level, misjudging the wind more on Easy, and its rounds play as the same
  replay you see in a challenge. You go first.
- **2 players on one phone** (Matt: yes): the same match, a "Pass to <name>" screen between turns.
- **Online challenge**, the mode the video shows: turn-by-turn, one round (3 arrows) per turn. The
  6th challenge game: node `archery/games/<id>` + `archery/index/<CODE>/<id>`, each arrow stored as
  `{x, y, score}`, the wind per round stored by whoever creates that round, `armOpen` /
  `armChallenge` / `myTurnCount` in `alert.js`, a `SOURCES` entry in `js/challenges.js`, cancel /
  decline / resign / 3-day expiry via `js/challenge-life.js`, gated by `js/online-gate.js`.
- **Matt's steps for online (he does these by hand)**: publish the `archery` rules branch;
  deploy a push function (`archeryTurnPush`) with `firebase deploy --only functions`.

### Stages (each one ends live on the hub, admin only)

1. **Scene and HUD.** Stadium, lane, target, bow, arm, leaves, all HUD elements in §2's places.
   Check side by side with frames from the video at the same moments.
2. **One arrow.** Touch-and-hold, draw, scope zoom, drag, sway, ring, panic, release, flight
   camera, hit cut-away with the number and stars, all on §2's clock. A practice round of 3.
3. **A match.** 3 rounds, rising wind, replays, shoot-off, totals, result popup with an X, vs
   computer and 2 players, stats, tile art, EN/ES.
4. **Online challenges** and push.

`test.js` covers: score at every ring boundary, wind shift and the per-round ranges, the ring's
drain and the panic shot always scoring 0, CPU spread per level, a full match, and a shoot-off.

## 4. Matt's answers (2026-10-14)

1. Ring runs out: *"Make it so the animated person panics and shoots it over the target."*
2. Tie: *"One more arrow."*
3. *"The challenger shoots first. They go first each round. You can alternate on the next game."*
4. Wind the same for both: *"Yes. But it must vary per round."*
5. Target distance: *"No. But the wind gets more difficult. Round 1 of the match you saw was wind
   at 1.5mph."*
6. Two players on one phone: *"I guess."* (so yes)
7. Name "Archery": *"Yup."*
