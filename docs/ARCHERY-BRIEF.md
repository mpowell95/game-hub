# Archery — build brief

Written 2026-10-14 from Matt's request: *"Analyze it and plan to create a 1 to 1 exact clone of it."*
"It" is a 34-second iPhone screen recording of Snapchat's archery game (Snap Games, played in a chat
against a friend), in Matt's Dropbox: `/Claude Code Refs/ScreenRecording_10-13-2026 23-31-02_1.MP4`.
For the session(s) that BUILD it.

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
standard 10-ring archery target is generic and fine). It is not called "Archery Master". Bitmoji
avatars become each player's profile emoji. No sound (root `CLAUDE.md`).

## 2. What the recording shows

Timings were read off frames every 0.5 s (so ± 0.25 s). Verify against the video, not this table.

### The screen (portrait, full-bleed, `immersive: true`)

| Element | Where | Look |
|---|---|---|
| Round pill | top centre | white pill, black bold "ROUND 2/3" |
| Arrow tiles | under the pill | 3 square tiles in one bar; **blue** = yours, **red** = the opponent's replay; "?" until that arrow is shot, then its score |
| Wind card | left, about 45% down | white rounded square with a blue arrow showing wind direction (down-left in the video), "WIND 3.1" under it; one value for the whole round |
| Score banners | left, under wind | red banner (opponent: avatar + running total, e.g. 42), "VS" badge, blue banner (you: avatar + total, e.g. 24) |
| Scene | full screen | first-person on a grass lane, white lane lines converging on a target on a wooden easel far away; stadium stands with crowd, roof canopy, sky with clouds, a blue barrier wall behind the target |
| Bow | right half | blue recurve held in the left hand, arm in a sleeve coming in from bottom-left, arrow nocked, a round **sight scope** on the riser |
| Leaves | anywhere | small green leaves drifting across the screen in the wind direction |

### One turn (one round = 3 arrows)

| Step | Time | What happens |
|---|---|---|
| 1. Replay | 2.5 to 3.5 s | Target close-up with the opponent's 3 arrows in it (red fletching), red tiles "6 8 4", a yellow **Your Turn** button |
| 2. Walk-in | ~1 s | fade, camera moves to the shooting line |
| 3. Idle | until touch | bow low, scope ring full green, a tutorial hand taps a pulsing yellow dot left of the grip ("touch and hold") |
| 4. Draw | ~0.5 s | on touch-and-hold the bow rises; the scope comes to the eye and shows the target **magnified** with a red crosshair |
| 5. Aim | held | drag moves the aim; the sight **sways on its own** (hand tremor) |
| 6. Gauge | held | a ring around the scope drains clockwise, green, turning **yellow** when low. Arrow 1 was held ~3 s (ring ~1/4 left), arrow 3 ~6 s (ring yellow, ~1/3 left) |
| 7. Release | ~0.7 s | lift finger: the arrow flies, camera follows from behind it, the arrow drifts with the wind |
| 8. Hit | ~1.5 s | cut to the target close-up, arrow stuck in it, a big yellow number with a black outline pops at the hit point inside a burst of yellow stars; the tile fills; your total counts up |
| 9. Next | | back to step 3. After arrow 3, the round's 3 arrows stay on screen and the turn is sent |

Arrows in the video: release at ~12.4 s scored **4**, ~19.0 s scored **8**, ~28.4 s scored **7**.
Total went 24 → 28 → 36 → 43 (opponent 42).

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
| Stats | `recordResult('archery', difficulty, won)`: `'easy'`/`'medium'`/`'hard'` vs computer, `'mp'` for a challenge. `GAME_META` row in `js/leaderboard-ui.js` from day one (`OFF_THE_BOARD` stays empty) |
| Tile art | `GAME_ART.archery` in `js/game-art.js` |
| Strings | `archery/js/strings.js` `{en, es}` via `makeT` |
| Engine | three.js from `skeeball/js/vendor/three.module.min.js`, as Cup Pong. **No physics engine**: arrow flight is a ballistic curve plus wind, solved in closed form |

Every row of "Use what exists" applies. Run `node test-game-conventions.mjs` before every commit.

### Files (Darts' split)

`engine.js` (pure: target rings, score at a point, match state) · `flight.js` (pure: aim + sway +
wind → hit point) · `cpu.js` · `render.js` (three.js scene, bow, cameras) · `ui.js` (screens,
input, HUD) · `mp.js` / `mp-ui.js` / `alert.js` (challenges) · `strings.js` · `test.js` (headless).

### The model under the feel

- **Aim** = a point on the target plane. Drag moves it (scaled so a thumb's travel covers about
  two target widths); sway adds a slow wander (two summed sines + noise), growing as the gauge
  drains.
- **Gauge** = hold time. Full for 0 s, empty at about 9 s (to fit "~1/4 left at 3 s" and "yellow
  at 6 s"; tune against the video).
- **Wind** = one random value per round (0.0 to ~6.0, one decimal, 8 directions), the same for
  both players in a challenge round. It shifts the hit point by a fixed amount per unit; the
  player has to aim off to allow for it.
- **Hit point → score** is pure maths, so a replay only needs the stored points.

### Modes

- **vs Computer**, Easy / Medium / Hard: the computer "shoots" a hit point from a spread around the
  centre, tighter per level, and its rounds play as the same replay you see in a challenge.
- **Online challenge**, the mode the video shows: turn-by-turn, one round (3 arrows) per turn,
  alternating, 3 rounds. The 6th challenge game: node `archery/games/<id>` + `archery/index/<CODE>/<id>`,
  stored arrows are `{x, y, score}` per arrow, `armOpen` / `armChallenge` / `myTurnCount` in
  `alert.js`, a `SOURCES` entry in `js/challenges.js`, cancel / decline / resign / 3-day expiry
  via `js/challenge-life.js`, gated by `js/online-gate.js`.
- **Matt's steps for online (he does these by hand)**: publish the `archery` rules branch;
  deploy a push function (`archeryTurnPush`) with `firebase deploy --only functions`.

### Stages (each one ends live on the hub, admin only)

1. **Scene and HUD.** Stadium, lane, target, bow, arm, leaves, all HUD elements in §2's places.
   Check side by side with frames from the video at the same moments.
2. **One arrow.** Touch-and-hold, draw, scope zoom, drag, sway, gauge, release, flight camera,
   hit cut-away with the number and stars. A practice round of 3.
3. **A match vs computer.** 3 rounds, replays, totals, result popup with an X, stats, tile art,
   EN/ES.
4. **Online challenges** and push.

`test.js` covers: score at every ring boundary, wind shift, gauge timing, CPU spread per level,
and a full 3-round match.

## 4. Unknowns: ask Matt in ONE message before stage 2

1. **Gauge empty**: what happens? (Auto-shoots, or sway gets wild, or the arrow is lost.) Not in
   the video.
2. **A tie** after 3 rounds: draw, or a shoot-off arrow?
3. **Who shoots first** in a round, and is round 1's replay shown to the second player?
4. **Wind**: same for both players in a round? (Assumed yes.)
5. **Distance**: does the target move further away by round? (All three arrows here were round 2.)
6. **Modes**: vs computer + online challenges, as above. Pass-and-play too?
7. **Name**: "Archery"?
