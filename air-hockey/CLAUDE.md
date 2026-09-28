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
| 1 | Table, mallet, puck, goals, first to 7, one simple computer | **Done 2026-09-27.** Matt's feel check: *"the computer is probably a little too hard. Other than that it's great. proceed"* |
| 2 | Easy / Medium / Hard tuned, stats, setup screen, how to play | **Done 2026-09-27, deployed devOnly** |
| 3 | Latency test for online (brief §5), numbers to Matt | **Done 2026-09-27.** Matt ran it on two devices: *"numbers look good, go ahead with stage 4"* (2026-09-28; he did not paste the numbers) |
| 4 | Live online, if stage 3 says it works | **Done 2026-09-28, deployed devOnly** (see "Online play (stage 4)") |

## Stats and settings (stage 2)

- **`recordResult('airhockey', difficulty, won)`** when a match ENDS at 7: `'easy'`/`'medium'`/
  `'hard'` vs the computer (`'mp'` is reserved for online, stage 4). total/byDiff only, no
  sub-counter, so `js/players-agg.js` needs no branch. **A match left before 7 records nothing**
  (quit, Back, hub back): it was neither won nor lost. A refused write logs loudly (rule 6).
- Wired in all four registries: `GAMES` in `js/game-stats.js`, `TABS` in `js/game-stats-ui.js`
  (**`devOnly: true`**, Pinball's reasoning: admin-only since birth, so nobody else can have plays)
  plus `HUB_ID` `airhockey -> air-hockey`, `GAME_META` in `js/leaderboard-ui.js`, and
  `game_title_airhockey` in `js/strings.js`. My Stats uses the generic wins/losses screen
  (`recordScreen`). **When Matt releases it, drop `devOnly` from the TABS row too.**
- **Rule 1 on the game's own screens:** the setup card and the result card both show "Vs <level>:
  N won, M lost", read from the stats store.
- **`gamehub.airhockey.v1`**: `{ difficulty }`, saved the moment a level is tapped. No saved
  choice -> the profile's first opponent skill (1/2/3) -> Medium.

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
| `js/ai.js` | the computer's mallet: chooses a target, physics moves it. `LEVELS` easy/medium/hard, `DIFFS` |
| `js/render.js` | canvas drawing. The table is painted once per layout/theme to an offscreen canvas; a frame is one `drawImage` plus three circles |
| `js/ui.js` | setup (difficulty), how to play, pause and result cards, score row, input, sound, the clock, recording the result |
| `js/strings.js` | `{ en, es }` |
| `css/air-hockey.css` | everything under `.ah-root`; cards and buttons are `css/ui.css`'s `.gh-modal` / `.gh-btn` |
| `js/test.js` | headless engine probe, `node air-hockey/js/test.js` (not deployed) |
| `js/live.js` | the real-time channel, puck ownership, goals, rounds and rematch (stages 3-4) |
| `net-test.html` + `js/net-test.js` | the stage 3 latency test page. Dev tool, not on the launcher; in `ASSETS` so it is validated and cached |

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

## The computer

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

**Tuning, round 2 (2026-09-28) - read this before touching a level.** Matt, on the stage 2
levels: *"the computer player is way too good. i haven't been able to score a single goal, even on
easy."* Stage 2 had been tuned against scripted players that run the SAME AI code (go behind the
puck, drive through it at a target), which aim like machines: they beat Easy 8/8 while a real thumb
could not score. `js/test.js` now holds the levels to the **CHASER**, a beginner's thumb: sees the
puck late (0.3 s), chases it, whacks it roughly upward, no aiming. Against the stage 2 Easy the
CHASER scored 1.4 goals a match and never won, which matches what Matt saw, so it is the yardstick.

**The cause was DEFENCE, not attack.** The mallet waited in front of the MIDDLE of its goal (72
units wide plus the puck's 44 covers about two thirds of the 170 mouth) and slid across at its full
attack speed. Three per-level knobs now shape the defence (`ai.js`):

- `guard`: how fast it moves when defending or getting back (was the attack speed)
- `shade`: how far it follows the puck sideways while waiting; 1 = all the way, which leaves the
  far side of the goal open (was a fixed 0.3)
- `home`: how far out it waits (was 105 for every level)

| Level | attack / guard speed, react | shade, home | vs CHASER: computer's share, beginner wins |
|---|---|---|---|
| Easy | 430 / 200, 0.38 s | 0.95, 170 | 42%, 7/10 |
| Medium | 650 / 280, 0.28 s | 0.8, 145 | 47%, 6/10 |
| Hard | 840 / 450, 0.21 s | 0.55, 125 | 76%, 0/10 (still ~2 goals a match) |
| (stage 2 Easy) | 600 / 600, 0.26 s | 0.3, 105 | 83%, 0/10 |
| (stage 2 Medium) | 840 / 840, 0.19 s | 0.3, 105 | 89%, 0/10 |

The response is steep; move one knob a little at a time and re-run `node air-hockey/js/test.js`
(its 3b block asserts the bars). The CHASER is still a bot: if Matt says a level feels wrong, his
word beats these numbers, and the CHASER should be made to reproduce what he saw first (as here).

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

## Online: the stage 3 latency test (2026-09-27)

**`https://mpowell95.github.io/game-hub/air-hockey/net-test.html`** on two devices: Create on one,
type its code and Join on the other. A robot plays each side (touching the table hands that side
to your finger). The numbers under the table: round trip, gap between updates, how far the puck
jumps when a phone takes it over, and a pass count.

**The protocol (`js/live.js`), in brief** (the file header has the full version): each phone
overwrites `rooms/<CODE>/ah/s<side>` 20 times a second; the lobby is `js/net.js`'s
createRoom / joinRoom / heartbeat / leaveRoom. Whoever's half the puck is in OWNS it and runs its
physics; crossing the centre line hands it over (`o`, handoff counter `h`), and the handover state
is RE-SENT on every message until the other phone's messages show it took it (the channel is a
value, not a queue, so one handoff message can be overtaken). The non-owner shows a GHOST: the
last state stepped forward with the real table physics, jumps smoothed over 0.1 s, and held at the
centre line until the handover arrives. Only the scored-on phone decides a goal (goal counter
`g`). The round trip is timed by an echoed ping on ONE clock, so no clock sync is needed.
`physics.js` has one addition for it: `match.puckRemote` (mallets move, the puck is left alone).

**Measured from the cloud session, NOT representative**: this container's proxy does not pass
WebSockets, so the Firebase SDK fell back to long-polling. Two browsers here, 60 s, robots:
round trip median ~380 ms (p90 ~450), update gap median ~45 ms, catch-up jump median ~110 units
(2.5 puck widths), ~60 passes a minute, 0 write failures. That is a worst case for the transport,
and it proves the protocol works (passes, goals, re-sent handovers). The deciding numbers are
Matt's, on real phones over WebSockets; he ran it and said go (stage table above).

## Online play (stage 4, 2026-09-28)

**Flow** (`ui.js`, "online" section): setup -> **Play online** -> **Create a game** (a 4-letter code
to share; the host waits on a narrow listener on `rooms/<CODE>/guest`, never `net.onRoom`, which
would fire on every live message) or type a code and **Join** (the room's `game` is read FIRST and
must be `'airhockey'`, because `net.joinRoom` writes the guest in before returning). Then a match
to 7 on `js/live.js`, the opponent's NAME in the score row. Result: `recordResult('airhockey',
'mp', won)` on both phones; the setup and online cards show "Online: N won, M lost".

- **Rematch = a new ROUND** (`rd`): each phone asks (`r = rd + 1`), and a round starts only on a
  phone that has asked AND seen the other ask. The LOSER serves. The result card shows "<name>
  wants a rematch" when they asked first, and "Waiting for <name>..." after you ask.
- **No pause online.** Hiding the tab just stops this phone's loop; the other phone freezes under
  **"Waiting for <name>..."** once nothing has arrived for 3 s (`QUIET_MS`), and resumes by itself
  when messages return. After 30 s quiet (`GIVE_UP_MS`) an **End match** button appears (no result).
- **Leaving** (Back, End match, the X, hub back, `destroy()`) calls `net.leaveRoom`, which marks the
  room `ended`; the other phone watches `rooms/<CODE>/status` and shows **"<name> left the match."**
  No result is recorded for a match that did not reach 7. `isInProgress()` is true in play and
  while waiting.
- **No persisted MP state** (no `gamehub.airhockey.mp.v1`): a live match cannot resume, like
  Yahtzee's.
- **Takeover without the centre-line pause** (fixes stage 3's known cost): the non-owner's ghost
  now carries on INTO its own half, and on takeover the phone keeps the puck it was SHOWING if it
  is within 90 units of the owner's handover state stepped forward (normal case: both ran the same
  table physics). A bigger gap (their mallet hit it before it crossed) snaps to theirs. Their hits
  and wall bounces still make sounds on your phone (from the ghost).

**Proof, and its limits** (js/CLAUDE.md, "Multiplayer process rules": never claim "multiplayer
works" without real devices):
- `js/test.js` section 6: two sessions over a FAKE network (40 and 150 ms each way, 30% jitter,
  older messages dropped when several are due), scripted players both sides, 4 matches + rematch
  each: both phones agree on every score, every goal and match end announced exactly once per
  phone, the puck NEVER owned by both, never owned by neither for more than 0.2 s, rematch reaches
  7 again on both.
- Two separate browser PROFILES against the REAL Firebase (long-polling, ~380 ms round trip, since
  this container blocks WebSockets), touch-swiping on both: create -> join, names in the score row,
  a match to 7 in 51 s with both screens agreeing (7-2 / 2-7), `mp` won on one and lost on the
  other, rematch handshake to 0-0, the guest taken offline -> host shows "Waiting for Guesty..."
  and recovers, the host closing the game -> guest shows "Hosty left the match."
- **Not yet verified on two real phones.** That is Matt's check.

## How to play

Per docs/BUILDING-A-GAME.md's pattern: one bold goal line, a diagram (your half shaded, the mallet
with a dotted line down to the finger, the puck heading for the goal: shapes and arrows, no colour
coding), then one line each: drag anywhere in your half, "Fast swipe = hard shot", all the way in,
scored-on serves, stuck puck. `_fitHelp()` measures each line and steps the font down to fit one
row, never below 11px. The diagram's height is `min(200px, 27dvh)` so the card fits a 320 x 568
phone with no scroll (it overflowed by 17px there at a fixed size).

## Tests

`node air-hockey/js/test.js` (tunnelling, puck stays on the table, matches end, both sides score,
the three levels in order against a new player, speed cap, swipe-to-shot, stuck puck; ~2 s),
`node players-agg.test.mjs` (the GAME_META row), `node test-game-conventions.mjs`,
`node validate-sw-assets.mjs`, `node check-no-scroll.mjs` (needs `node server.mjs`).
