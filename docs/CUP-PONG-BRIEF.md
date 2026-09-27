# Cup Pong — build brief

Written 2026-09-27 from Matt's request. For the session(s) that BUILD it. Air Hockey comes after
this and is a separate game and a separate brief; do not start it here.

> **THE LAW applies.** Root `CLAUDE.md` is always loaded. Nothing here overrides it.

## 0. Read first, in this order

1. Root `CLAUDE.md` (auto-loaded), especially "Before you build: USE WHAT EXISTS".
2. `docs/BUILDING-A-GAME.md` — Part 0 (UX floor) and Part 1 (module contract + "Adding a game"
   checklist). The `game-ui` skill loads it.
3. `hoops4/CLAUDE.md` and `docs/HOOPS4-HANDOFF.md` — the closest existing game: three.js +
   cannon-es physics, CPU, turn-by-turn challenges by PLAYER CODE, push, launcher alert.
4. `skeeball/CLAUDE.md`, "Challenges", and `skeeball/js/swipe.js` — the flick-to-throw input and
   the second challenge implementation.

## 1. The goal

**A clone of GamePigeon's Cup Pong** (the iMessage game), as an in-hub module. Same look and feel:
portrait, first-person view from your end of the table, the opponent's triangle of red cups at the
far end, flick the ball up the screen to throw. Everything below that is not in "Matt's changes"
is there to match GamePigeon, not to improve on it.

**The GamePigeon details in §3 are NOT verified.** They came from memory and one weak web source.
Matt plays it. Before building rules, list §3 back to Matt and get a yes/no on each line (one
message, not one per rule). Ask him for a screen recording of GamePigeon if the look is unclear.

## 2. Hub integration

| Thing | Value |
|---|---|
| Folder | `cup-pong/` |
| Hub id / stats id | `cuppong` |
| Registry | `module: '../cup-pong/js/ui.js'`, `immersive: true`, `devOnly: true`, NO `released` date until Matt releases it (from the admin page, no commit needed) |
| CSS root / prefix | `.cp-root` / `.cp-` (checked 2026-09-27: `.cp-` is unused) |
| Settings key | `gamehub.cuppong.v1` |
| Stats | `recordResult('cuppong', difficulty, won)`; `'easy'`/`'medium'`/`'hard'` vs CPU, `'mp'` for a challenge (same convention as Hoops). Add the `GAME_META` row in `js/leaderboard-ui.js` even while admin-only (`OFF_THE_BOARD` must stay empty) |
| `isInProgress()` | true while a match is under way; vs-CPU is not persisted (Hoops' "no mid-game resume" class). Challenges live in Firebase so leaving one loses nothing |
| Tile art | `GAME_ART.cuppong` in `js/game-art.js` |
| Strings | `cup-pong/js/strings.js`, `{en, es}`, via `makeT` |

Every row of the "Use what exists" table applies (`onViewportResize`, `js/theme.js`,
`requireName()`, `css/ui.css` primitives for setup/menus, colorblind shape markers, no em dashes,
X on the win/lose popup). Run `node test-game-conventions.mjs` before every commit.

## 3. Base rules (GamePigeon) — CONFIRM WITH MATT BEFORE BUILDING

- 10 cups per side, triangle 4-3-2-1, point toward the shooter.
- Each turn is **2 throws**. A made cup disappears.
- **Balls back**: make both throws in a turn and you get 2 more throws. Repeats.
- **Same cup twice** (second ball into a cup the first already hit): unknown in GamePigeon, since a
  hit cup vanishes at once. Ask Matt; default is "not possible".
- **Heating up / on fire**: in house rules, making cups on 2 turns in a row is "heating up" and the
  3rd makes you "on fire" (shoot until you miss). **Unknown whether GamePigeon does this.** Ask.
- **Win**: clear all the opponent's cups.
- Ball physics: rims, rolling around a rim and out, bouncing off the table and off cups, falling
  off the table. The ball is real physics (cannon-es), not a canned animation.

## 4. Matt's changes

### 4a. Settings (setup screen)

- **Reracks**: `0`, `1`, `2`, `3`, `Unlimited`. Default `2` (the one web source says GamePigeon
  gives 2 in a 10-cup game; unverified). Count is **per player, per game**.
- **Gentleman's**: On / Off. Default On.
- Both are frozen when a match starts and carried inside a challenge, so both players play the
  same rules (Hoops does this with its shot rule).

### 4b. Gentleman's (Matt's definition, 2026-09-27)

> "When there's 2 cups left, you put them in a single line, one in front of the other."

- When a side drops to exactly 2 cups and Gentleman's is On, those 2 cups are placed in a single
  line pointing at the shooter: one centered at the front, one directly behind it, touching.
- It is automatic and free: it does **not** use a rerack. It happens at the start of the shooter's
  next turn, with a short slide animation so nobody thinks the cups teleported.
- If Matt later wants it to be a button the shooter chooses, that is a one-line change; build it
  as a rack preset (`line-2`) applied automatically so that stays cheap.

### 4c. Rerack

**Who**: the SHOOTER reracks the cups they are shooting at (the opponent's cups), at the start of
their own turn, before the first throw. Only while they have reracks left.

**The button**: a "Rerack" button on the HUD at turn start (hidden when 0 left), showing how many
remain. Tapping it opens the rerack sheet over the table view.

**Data model (build this first, everything else sits on it)**: a rack is a set of cells on a
**hex grid of touching cup positions** in the rack area. Presets and custom racks are the same
thing, just a list of cells, so the table, the physics, the challenge record and the replay all
read one format.

**Presets**: show only the shapes that fit the number of cups left. Starting list (tune with Matt;
GamePigeon names where known):

| Cups | Presets |
|---|---|
| 10 | Triangle 4-3-2-1 |
| 9 | Diamond 1-2-3-2-1? (Matt to confirm), 3-3-3 |
| 8 | Zipper 2-2-2-2 offset, 3-2-3 |
| 7 | Honeycomb 2-3-2 |
| 6 | Triangle 3-2-1, Zipper 2-2-2 offset, 3-3 wall |
| 5 | House 2-1-2? (confirm), 3-2 |
| 4 | Diamond 1-2-1, Triangle 3-1, Line 1-1-1-1, Square 2-2 offset |
| 3 | Triangle 2-1, Line 1-1-1 |
| 2 | Line 1-1 (the Gentleman's shape), Side by side |
| 1 | Center (front-center) |

**Custom**: in the same sheet, a "Make your own" mode. The cups are drawn top-down on the hex grid;
drag a cup to any empty cell. Rules:
- Snap to cells; no overlaps; must stay inside the rack area.
- Cups do not have to touch (Matt did not ask for that limit). If Matt wants "must touch", it is a
  one-function check.
- "Done" applies it; "Cancel" returns without using the rerack. Using a preset or custom both
  count as one rerack.
- Touch: `touch-action: none` on the drag surface; tap targets per Part 0.

## 5. Additions Matt approved (2026-09-27)

### 5a. Vs computer

Easy / Medium / Hard. The CPU is an aim error model, not a different physics: it picks a target
cup, computes the throw that lands in it, and adds noise scaled by skill. It uses reracks and
Gentleman's by the same rules. Tune so Easy loses to a new player and Hard is hard, with a headless
sim script (Hoops' `test.js` is the pattern). CPU racks: it picks presets only.

### 5b. Challenges + push (turn-by-turn, like Hoops and Skeeball)

- Addressed by PLAYER CODE. New top-level node `cuppong/games/<id>` + `cuppong/index/<CODE>/<id>`,
  mirroring `hoops/`. Copy the structure of `hoops4/js/mp.js` + `mp-ui.js`; do not share code
  with it (isolation, as Hoops did with Skeeball).
- A turn is the whole turn (both throws, plus balls back / rebuttal). Store each throw's launch
  vector AND its recorded outcome (which cup, or miss). When the other player opens the match,
  **replay the opponent's turn** from the vectors; if the local replay ever disagrees, the
  recorded outcome wins. Reracks and custom racks are part of the turn record.
- Launcher alert via the hub `alerts` hook (a `cup-pong/js/alert.js`, as Skeeball and Hoops have).
  Tapping a push opens THAT match (`armOpen`, see root `CLAUDE.md`, "A Hoops tap opens THAT match").
- History screen with a record per opponent, like Hoops.
- **Outside the game folder, each needs Matt:**
  1. `database.rules.json`: add `cuppong` (every branch is enumerated; root is `false`). Matt
     publishes it by hand. Also add it to `backups/rtdb-backup.mjs`'s `BRANCHES`.
  2. `functions/`: a `cupPongTurnPush` trigger + a pure `decideCupPong` in `functions/decide.js`,
     with tests in `test-push.mjs`. **Live only after Matt runs `firebase deploy --only
     functions`.** Give him the full deploy steps in chat (root `CLAUDE.md` says so).
  3. Run `backups/rtdb-backup.mjs` before any rules change.
  Record each of those as "not yet done, dated" in `cup-pong/CLAUDE.md` and close the line the
  moment Matt confirms.

### 5c. Rebuttal

When a shooter sinks the opponent's last cup, the opponent gets a **rebuttal**: they shoot until
they miss. If they clear every remaining cup, it goes to **overtime**: 3 cups each in a 2-1
triangle, normal rules, no reracks, Gentleman's still applies. Otherwise the shooter wins. In a
challenge, the rebuttal is the losing player's next turn (with a push saying so).

### 5d. Bounce shots

A throw that bounces off the table once and then goes in counts for **2 cups**: the one it landed
in plus one more, which **the defender picks**.
- Vs CPU: the CPU picks instantly (the cup that leaves the worst rack for you, on Hard).
- In a challenge the defender is not there. The second cup is **owed**: shown as a marked cup, and
  the defender removes one at the start of their next turn, before throwing. If the owed cups are
  enough to clear the rack, the shooter wins at once.
- **This async part is a design call, not Matt's words.** Show it to Matt before building 5d; the
  fallback is "the game picks the cup behind the hit one."
- Bounce detection comes from the physics contacts (table contact, then cup), not guessing.

## 6. How to build it (stages)

Each stage ends with a deploy so Matt can play it (root `CLAUDE.md`: a change is done only when
LIVE). Game stays `devOnly` until Matt releases it.

1. **Table + throw**: three.js scene, GamePigeon camera, cannon-es ball and cups (import from
   `skeeball/js/vendor/`, as Hoops does), flick input, cups vanish when made. Rack = hex-grid
   cells. Solo practice only. **Stop and get Matt's feel check** on the swipe before going on;
   measure the swipe (read `skeeball/js/swipe.js`, and its warnings about `e.timeStamp`), do not
   reason about it.
2. **Rules + settings + vs CPU**: §3 as Matt confirmed, §4a, §4b, §5a, §5c, stats recording.
3. **Rerack**: §4c, presets then custom.
4. **Bounce shots**: §5d (after Matt answers the async question).
5. **Challenges + push**: §5b, then the rules/function steps with Matt.

Subagents: follow root `CLAUDE.md`, "Subagents: save USAGE". Physics and challenge persistence are
Opus-level; screens and CSS can go to Sonnet.

## 7. Before calling any stage done

- `node validate-sw-assets.mjs`, `node test-game-conventions.mjs`, the Hoops-style headless test
  for this game, `players-agg.test.mjs` (the `GAME_META` row).
- Visual check per `VISUAL-PROCESS.md` on a phone-size viewport, light and dark.
- Bump `CACHE` in `sw.js` past what is on `main` right now.
- Write `cup-pong/CLAUDE.md` (rule 9) and add the row to the root games table.
- Deploy and verify the Pages run succeeded before telling Matt it is live.
