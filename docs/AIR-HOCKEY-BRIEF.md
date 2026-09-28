# Air Hockey — build brief

Written 2026-09-27 from Matt's answers. For the session(s) that BUILD it. **Build it after Cup
Pong** (`docs/CUP-PONG-BRIEF.md`), not alongside it, unless Matt says otherwise.

> **THE LAW applies.** Root `CLAUDE.md` is always loaded. Nothing here overrides it.

## 0. Read first, in this order

1. Root `CLAUDE.md` (auto-loaded), especially "Before you build: USE WHAT EXISTS".
2. `docs/BUILDING-A-GAME.md`: Part 0 (UX floor) and Part 1 (module contract and the "Adding a
   game" checklist). The `game-ui` skill loads it.
3. `brick-blitz/CLAUDE.md` and `brick-blitz/js/game.js`: the newest 2D canvas action game here
   (canvas setup, device-pixel scaling, the frame loop, touch drag).
4. `js/CLAUDE.md`, the multiplayer lockstep invariants, and `js/net.js`: the room layer. Live Air
   Hockey needs something net.js does not have yet (see §5).
5. `holdem/` (Texas Hold'em): the newest game that added its own child under `rooms/<CODE>/`.

## 1. Matt's decisions (2026-09-27)

| Question | Answer |
|---|---|
| Look | **Top-down 2D.** The whole table on screen, portrait, your goal at the bottom |
| Modes | **Vs computer** and **live online.** No pass-and-play on one phone, no turn-by-turn |
| Win rule | **First to 7** goals. Not a setting |

Anything not in this table is the building session's call, kept simple and classic: a real arcade
air hockey table, not a variant.

## 2. Hub integration

| Thing | Value |
|---|---|
| Folder | `air-hockey/` |
| Hub id / stats id | stats id `airhockey`. **Hub id is `air-hockey`** (= the folder, which the dev tools assume; changed in stage 1, see `air-hockey/CLAUDE.md`) |
| Registry | `module: '../air-hockey/js/ui.js'`, `immersive: true`, `devOnly: true`, NO `released` date until Matt releases it from the admin page |
| CSS root / prefix | `.ah-root` / `.ah-` (checked 2026-09-27: unused) |
| Settings key | `gamehub.airhockey.v1` (last difficulty picked) |
| Stats | `recordResult('airhockey', difficulty, won)`: `'easy'`/`'medium'`/`'hard'` vs CPU, `'mp'` online. Add the `GAME_META` row in `js/leaderboard-ui.js` even while admin-only (`OFF_THE_BOARD` must stay empty) |
| `isInProgress()` | true while a match is under way; nothing is persisted (Hoops' "no mid-game resume" class) |
| Tile art | `GAME_ART['air-hockey']` in `js/game-art.js` |
| Strings | `air-hockey/js/strings.js`, `{en, es}`, via `makeT` |

Every row of the "Use what exists" table applies (`onViewportResize`, `js/theme.js`,
`requireName()`, `css/ui.css` for setup and menus, shape markers, not color alone, for anything
colored, no em dashes, X on the win/lose popup). Run `node test-game-conventions.mjs` before every
commit.

## 3. The game

- **Table**: portrait rectangle with rounded corners, center line, center circle, a goal slot in
  the middle of each end. Fits the screen by measurement (Part 0), never scrolls.
- **Mallet**: your mallet follows your finger with a small offset so the thumb does not cover it.
  It stays in your half. Touch anywhere in your half to grab it. `touch-action: none` on the
  canvas; `touchmove` bound to the game root, never `document`.
- **Puck**: low friction (it glides), bounces off the walls with a little energy loss, has a top
  speed. Mallet-to-puck hits pass on the mallet's velocity, so a fast swipe is a hard shot.
- **Physics**: write it by hand (circles and walls; no library needed). Fixed time step
  (for example 120 Hz) with sub-steps, and **swept collision so a fast puck cannot pass through a
  mallet or a wall**. Read "Preventing physics tunnelling through thin geometry" in `docs/BUILDING-A-GAME.md` first.
- **Goals**: puck fully in the slot scores. Short goal flash, score update, then the puck is
  placed on the side of the player **who was scored on**, still, for them to serve.
- **Stuck puck**: if the puck sits still in one half for about 5 s, it moves to that player
  (standard rule: the player on that side must play it).
- **Win**: first to 7. Win/lose popup with X, Rematch, and Back.
- **Feel** (SOUND REMOVED 2026-09-28, Matt: "it should not make any sound ever"; see `air-hockey/CLAUDE.md`): ~~a hit sound and~~ a small screen flash on goals (`game-audio` skill; respect
  reduced motion). Frame rate is the priority: no per-frame DOM updates or allocations.

## 4. Vs computer

Easy / Medium / Hard. The CPU mallet is the same physics body as yours, moved by an AI with a
**speed limit and a reaction delay**, both scaled by difficulty:

- **Defend**: when the puck is heading at its goal, move between the puck and the goal.
- **Attack**: when the puck is slow on its side, hit it at an angle toward your goal (Hard also uses
  bank shots off the side walls).
- **Return home**: otherwise drift back to its goal.

Tune with a headless sim (CPU vs CPU and CPU vs a scripted "average player") so Easy loses to a new
player and Hard is hard. Hoops' `test.js` is the pattern for a headless game test.

## 5. Live online (the hard part)

**Nothing in this repo does real-time play yet.** `js/net.js` sends a move log in lockstep (turn
games). Air hockey has to send positions many times a second over Firebase, with delays of roughly
100 to 300 ms (not measured here; measure it). Plan for it:

- **Lobby**: reuse `js/net.js` for create room / join by code / heartbeat / leave, exactly as the
  other games do. Invite-by-code, like Pool or Hoops live.
- **The live channel**: a new child under the room, `rooms/<CODE>/ah/`. `rooms` already allows any
  signed-in write (checked 2026-09-27), so **no rules change and nothing for Matt to publish.**
  Keep it inside `air-hockey/js/` (for example `live.js`); do not add a real-time layer to
  `js/net.js` unless Matt approves it.
- **Who is in charge of the puck**: whoever's half the puck is in runs its physics and sends it
  (position + velocity + a counter). When it crosses the center line, the other phone takes over.
  Each phone always runs its own mallet locally (no lag on your own mallet).
- **Send rate**: mallet and puck about 15 to 20 times a second. The other phone smooths between
  updates and predicts ahead using velocity, so it does not look jumpy.
- **Goals and score**: only the phone of the player who was scored on decides a goal, and writes it
  with the new score and a goal number, so a goal is never counted twice.
- **Clean up**: stop all listeners and writes in `destroy()`; the leak rules in Part 1 apply.
- **Disconnects**: if the other phone stops sending for a few seconds, pause with "Waiting for
  <name>..."; after about 30 s offer "End match" (no result recorded).

**Build a latency test before the real thing** (stage 3 below): two browsers, a puck passed back
and forth, delay measured. If it is not playable, **tell Matt with the numbers** before going
further. Do not ship a laggy online mode quietly.

## 6. Stages

Each stage ends deployed live (root `CLAUDE.md`), game still `devOnly`.

1. **Table, mallet, puck, goals, first to 7** against a simple CPU. **Stop for Matt's feel check**
   (mallet control, puck speed).
2. **Vs computer** at three levels, tuned; stats recording; setup screen; how to play.
3. **Latency test** for online (§5). Report the numbers to Matt.
4. **Live online**, if stage 3 says it works.

Subagents: follow root `CLAUDE.md`, "Subagents: save USAGE". Physics and networking are Opus-level;
screens and CSS can go to Sonnet.

## 7. Before calling any stage done

- `node validate-sw-assets.mjs`, `node test-game-conventions.mjs`, this game's headless test,
  `players-agg.test.mjs`.
- Visual check per `VISUAL-PROCESS.md` on a phone-size screen, light and dark.
- Bump `CACHE` in `sw.js` past what is on `main` right now.
- Write `air-hockey/CLAUDE.md` (rule 9) and add the row to the root games table.
- Deploy and confirm the Pages run succeeded before telling Matt it is live.
