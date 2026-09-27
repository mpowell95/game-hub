# Air Hockey (`air-hockey/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Top-down arcade air hockey, portrait, your goal at the bottom, first to 7. Built from
`docs/AIR-HOCKEY-BRIEF.md` (Matt's answers, 2026-09-27) in four stages; **read the brief before
starting a stage**. It holds the decisions (look, modes, win rule) and the online plan.

## Stage status

| Stage | What | Status |
|---|---|---|
| 1 | Table, mallet, puck, goals, first to 7, one simple computer | **Done 2026-09-27, deployed devOnly. Waiting on Matt's feel check** (mallet control, puck speed) |
| 2 | Easy / Medium / Hard tuned, stats, setup screen, how to play | not started |
| 3 | Latency test for online (brief §5), numbers to Matt | not started |
| 4 | Live online, if stage 3 says it works | not started |

Stage 1 deliberately has **no stats recording, no setup screen, no how-to-play and no settings
key**: those are stage 2 (brief §6). So there is no `recordResult`, no `GAME_META` row, no My Stats
tab and no `gamehub.airhockey.v1` yet, and nothing is stored anywhere. When stage 2 adds
`recordResult('airhockey', difficulty, won)`, it must add the `GAME_META` row in
`js/leaderboard-ui.js` in the same commit (`players-agg.test.mjs`'s `OFF_THE_BOARD` must stay empty).

## Hub integration

- In-hub `module:` (`air-hockey/js/ui.js`), **immersive**, **`devOnly: true`, no `released` date**
  (the admin page's live switch releases it; a `released` date goes on the day it really does).
- **Hub id `air-hockey`, not `airhockey`.** The brief said `airhockey` for both ids; the hub id was
  made the FOLDER name instead, as every other game does, because the dev tools (`check-no-scroll.mjs`,
  `test-visual.mjs`) launch a game by its folder name. The stats id stays `airhockey` (Brick
  Breaker's split: hub `brick-blitz`, stats `brickblitz`), so stage 2 maps it in `HUB_ID`
  (`js/game-stats-ui.js`). Tile art is `GAME_ART['air-hockey']`.
- `isInProgress()`: the LITERAL meaning (no mid-game resume, Snake/Hoops class): true while a
  match is playing, between goals or paused. Nothing is persisted mid-match.
- Root is `position: fixed; inset: 0` (Brick Breaker / Pinball pattern, avoids the `.hub-game`
  height trap). The score row starts at `max(safe-top, 46px)` with 96px clear on the left for the
  hub's floating back button; overlays pad their top by 96px for the same reason.

## Files

| File | Role |
|---|---|
| `js/physics.js` | the table, puck and mallets. Pure (no DOM, no clock, no per-step allocation), so the headless test runs the exact game code |
| `js/ai.js` | the computer's mallet: chooses a target, physics moves it. `LEVELS` easy/medium/hard (stage 1 plays `medium` only) |
| `js/render.js` | canvas drawing. The table is painted once per layout/theme to an offscreen canvas; a frame is one `drawImage` plus three circles |
| `js/ui.js` | start / pause / result cards, score row, touch and mouse input, sound, the clock |
| `js/strings.js` | `{ en, es }` |
| `css/air-hockey.css` | everything under `.ah-root`; cards and buttons are `css/ui.css`'s `.gh-modal` / `.gh-btn` |
| `js/test.js` | headless engine probe, `node air-hockey/js/test.js` (not deployed) |

## The physics (correctness-critical)

Logical units: the playing surface is 500 x 900, origin top-left, computer's goal at y = 0, yours
at y = 900. Puck radius 22, mallet 36, goal slot 170 wide, corners rounded at radius 70.

- **Fixed 240 Hz step**, `MAX_STEPS` 24 catch-up cap (a stalled tab cannot teleport the puck).
- **No tunnelling** (docs/BUILDING-A-GAME.md, "Preventing physics tunnelling"): the puck's top
  speed (2300) moves it 9.6 units a step, under its 22-unit radius, so walls and goal posts
  (points) cannot be stepped over. Mallet vs puck is **swept**: the exact time of contact inside
  the step is solved (circle vs moving circle, a quadratic), so a full-speed swing through a puck
  always hits it. `js/test.js` swings through a puck from 48 angles at three puck speeds.
- **Mallets are infinitely heavy.** A hit reflects the RELATIVE velocity about the contact normal
  (restitution 0.8), so the mallet's own speed is passed on: a fast swipe is a hard shot.
- **Mallet movement is interpolated across the frame.** A finger reports once a frame; each of the
  ~4 sub-steps aims at the matching fraction of the way from last frame's target to this one.
  Without that, the mallet would do all its moving in the first sub-step (a velocity spike, and a
  random hard shot) and sit still for the other three.
- A puck squeezed between a mallet and a wall: **the wall wins, the mallet gives way.**
- Goal = the puck ALL the way into the slot (`y + r < 0`). The slot's side walls continue the
  posts backwards; the posts are points while the puck is on the table side of the end line.
- After a goal: 1.2 s pause, then the puck is placed, still, in the half of the player **who was
  scored on**. Pausing keeps the mallets live.
- **Stuck puck**: nearly still (< 45 u/s) in one half for 5 s -> moved, still, to that half's serve
  spot (the player on that side must play it; brief §3). It also rescues a puck trapped in a
  corner where no mallet can reach behind it.
- Air friction 0.3/s exponential (it glides), walls keep 88% of the normal speed.

## The computer (stage 1)

`ai.js` works in the mallet's own frame (own goal at y = 0), so one routine drives either side
(the test plays it against a scripted player). A **speed limit** and a **reaction delay** make it
beatable: it re-reads the puck every `react` seconds and extrapolates in between, and each read
MISJUDGES the puck's sideways speed by up to `misread x |vy|`, so an angled or banked shot can beat
it. Behaviour: puck coming at it -> go to where the puck will cross its guard line (y = 105);
puck slow on its side -> get behind it and drive through toward the far goal (sometimes a bank
shot); otherwise wait at the guard line, shading toward the puck.

**Why the guard aims at the predicted crossing, not "between puck and goal":** the first version
stood on the line from its goal to the puck, and two of them played 60 s with zero goals. That
line follows the puck continuously, so the reaction delay never cost it anything.

Measured 2026-09-27 against the test's scripted "average player" (fast hands, 0.2 s reads, shoots
anywhere at the goal, banks a third of the time), 6 matches each: Easy 4 goals conceded 42,
**Medium (stage 1) 9 vs 42 - beatable, and it does score**, Hard 42 vs 0. Hard is untuned. Stage 2
tunes all three so Easy loses to a new player and Hard is hard (brief §4).

## Input

- **Your mallet sits 34 css px ABOVE your finger** (`FINGER_OFFSET_CSS`), so the thumb never covers
  it. Touch anywhere in your half (60 units of grace above the centre line) to grab it; it then
  travels to the finger at its capped speed. Letting go leaves it where it is.
- Mouse: the mallet follows the pointer, no offset, no press needed.
- Input lives on the stage (table plus margin) with pointer capture; `touch-action: none` on root,
  stage and canvas; the scroll guard is a root-scoped `touchmove` (never `document`).
- Esc / P pause. Leaving the tab pauses.

## Look

- Light: pale air-hole surface, navy rim, vermilion centre line, blue circle and goal creases,
  black puck. Dark (`:root.gh-dark`, repainted on `onThemeChange`): navy surface, yellow puck.
- **Shape markers, never colour alone**: your mallet has a TRIANGLE on its knob, the computer's a
  SQUARE; the score row wears the same shapes.
- Goal: a "Goal!" banner (pop animation) plus a short white flash on the table. Reduced motion
  drops the pop and the flash; the banner still shows. The puck keeps moving (Part 0: reduced
  motion thins garnish, never gameplay).
- Sound: a mallet clack (louder and higher for harder hits), a soft wall tick, a two-note goal horn.
  Web Audio, created on the first tap. No mute button yet.

## Tests

`node air-hockey/js/test.js` (tunnelling, puck stays on the table, matches end, both sides score,
speed cap, swipe-to-shot, stuck puck), `node test-game-conventions.mjs`,
`node validate-sw-assets.mjs`, `node check-no-scroll.mjs` (needs `node server.mjs`).
