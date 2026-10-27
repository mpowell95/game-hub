# TODO

One list, by game. One line per item. When an item ships, delete its line in the same change.

## Hub (shared)

- **Turn-by-turn challenges in every multiplayer game** (Matt, 2026-10-18; order agreed; Battleship done 2026-10-27): Tic Tac Toe, Dots and Boxes, Mancala, Filler, Yahtzee; then Boggle (same letters, higher score); then Chinchón and Escoba (2 players first). Not Air Hockey or Hold'em. Each = challenge, cancel/decline/resign/expire, chat, alerts, push (Matt deploys), rules branch (Matt publishes). The Multiplayer screen picks each up via `SOURCES`.

- `tools/test-sw-update.mjs` fails 2 on `main` (seen 2026-10-27, not yet looked into): "a player's page is NOT reloaded mid-session" (the page reloaded) and "the pill says this page is behind" (chip `v552`).
- The emoji does not appear everywhere the name does: shared `chipHTML({name, emoji})` plus a sweep, immersive games last; paused by Matt (root CLAUDE.md, "The shared profile").
- Leaderboard: a best-metric board should rank on that best by default, not on the last-picked sort (check; branch `claude/skeeball-leaderboard-ui-9y2b8r` was deleted, head `e11818d`).
- **Matt:** say "release X" for any admin-only game already switched on for players on the admin page (e.g. Arrow Maze?), so it is saved on phones instead of re-downloaded each open (root CLAUDE.md, "Releasing a game").
- **Matt:** play online on two real phones for Battleship, Chinchón, Dots and Boxes, Filler, Mancala, Tic Tac Toe (check; each game's CLAUDE.md, "unverified"; `docs/archive/HANDOFF-MP-LOCAL-MACHINE.md`).
- App-speed plan, never built (2026-09-01, `docs/archive/skeeball-sessions/other/plan-spicy-dewdrop-v2-2026-09-01T1541.md`): Batch 2 (launch token, CSS gate into `hub.js`, tile pressed state, prefetch on pointerdown) and Batch 3 (no `width`/`height` in transitions, e.g. `escoba/css/escoba.css` `.eb-table-cell`; self-host Yahtzee's Google Fonts, `yahtzee/js/ui.js`) (check).
- Hub smoothness pass, reverted 2026-08-26 with PR #240 and never redone (commit `ad9f07d1`): drop `backdrop-filter` on `.hub-top`, the back button, `.gs-top`, the `.gh-overlay` scrim; cap Snake's devicePixelRatio (`snake/js/ui.js`); Pinball/Hill Climb cap 2.5 -> 2; Ball Run MSAA off at dpr >= 2 (check).
- `tools/test-match-chat.mjs` (in-match chat) fails about 1 run in 5 on main: "the other side can answer" verify race (check).

## Air Hockey

- **Matt:** check online play on two real phones (air-hockey/CLAUDE.md, "Not yet verified on two real phones") (check).

## Archery

- Real-phone feel: drag gain, ring drain and sway were set from video, not a thumb; expect Matt to tune.
- No best-of-3/5 series online.

## Arrow Maze

- Play-screen menu button touches the Hub button: back arrow stays top left, one row down under the Hub button, like Gridlock (`docs/BUILDING-A-GAME.md`, Part 0).

## Ball Run

- **Matt:** playtest every tuning number (cadences, gap lengths, apex cap, pickups, Orbital colours); should Splits/Jumps count toward the speed tier; should a missed-Jump fall read differently; a wider variant map was never scoped.

## Baseball

- Contact-grid `ratio`/`cross`/`ceiling` since R16; `lineDriveCenterDeg` vs `CARRY_PEAK_DEG` (sloppy timing beats perfect); Pitch Accuracy and the run-speed lever (`runSpeedV2`/`runFtSPerPt`): Matt's calls (needs a joint re-derivation with `CARRY_SCALE`).
- Cosmetic: Crouch (R12), `Walk` clip unmeasured, `hub.js` blurb, `careers` rules publication unconfirmed (check).

## Battleship

- Turn-by-turn (play by mail) challenges like Darts, if still wanted (check; asked 2026-08-29, scope Connect Four, Battleship, Mancala).

## Connect 4 Hoops

- Two bounce gaps in `test.js` `KNOWN_GAPS` stay red (41% of misses bounce vs 50%; 0.45 vs 0.50 m/s): ask Matt first, every lever costs scoring.
- Does a human swipe have the precision seven columns need? Only a playtest answers.
- Outer columns are easier than the middle (walls return wide balls into them): confirm it reads as skill.

## Connect Four

- Turn-by-turn (play by mail) challenges like Darts, if still wanted (check; asked 2026-08-29).

## Course Creator

- A true L-shaped green or ring of sand cannot be drawn (needs a two-outline feature).
- **Matt:** reset or re-import Red Mesa in your browser copy, it held pre-repair holes 6/7/9 (check; the editor loads from `localStorage`, not the file).
- Check: does **Open a draft... > Load** autosave over the loader's OWN cloud course when the course ids match? Offered 2026-09-24, not built: a read-only **View** beside Load, plus a separate "Make a copy" (`docs/archive/GOLF-SESSIONS.md`).
- Further look-only objects (fountain, lighthouse, windmill, ducks/deer, waterfall, walls, hills) only if Matt asks (Matt: flower beds only, no bridges).

## Escoba

- `TypeError ... (reading 'avatar')` in `_renderMatchModal` seen once on a synthetic snapshot (`this.game.winner` null); if it recurs, `checkMatchEnd()` fires `matchEnd` without a winner.
- **Matt:** watch the broom sweep by eye, only checked by geometry and code.

## Flick Soccer

- **Matt:** confirm a real challenge push arrives on a phone (flick-soccer/CLAUDE.md, "Notifications").

## Golf

- **Matt:** decide old leaderboard scores (set before 2026-09-10, physics since rebuilt): leave, label or void per player via `js/stats-corrections.js` (golf/CLAUDE.md, "Status").
- Oasis Sands hole 4 (par 5, 451 yd, reachable in two) is a named gap in `test.js` 15c, as are Oasis' easier closing three; fix before that course opens.
- HUD top row (`.gf-tl`/`.gf-tc`) overlaps on phones 360 px and narrower.
- Club upgrade tiers designed, not built (`clubs.js` `upgraded`; spec 21.3); must not turn every par 5 into an eagle look.
- Only 2 of 5 aim-ladder dots show with a driver (feel call); Red Mesa 1 pin sits at the bowl's low point; seven Red Mesa greens (Oasis worse) force a putt over 60 ft and need redrawing.
- Left alone: flight runs off wall clock (a stall teleports the ball), `LOCK_MS` swallows the first tap after a ball rests; unbuilt: AI-opponent result board, walking golfer, Oasis palm colour and greenside bunkers.

## Mancala

- Turn-by-turn (play by mail) challenges like Darts, if still wanted (check; asked 2026-08-29).

## Pinball 2

- BOARDWALK is Matt's to tune: three probes red (flippers move the ball under 300 mm on half the power range; r42 mouth takes no shot weak enough to roll out; tunnel probe's 6 of 2325 OFF TABLE, see `HANDOFF.md`).
- Remaining object types, one at a time with panel and probe: drop targets, spinner, rollover lanes, kicker/saucer, plunger.
- Robot player (phase 8); hub and stats entry only after Matt judges it, with a new id.

## Skeeball

- Show everyone's progress on the objectives, including machines not yet played: `playerBlocks()` in `js/admin-ui.js` skips them; admin page or leaderboard (asked 2026-08-29).
- Consider easier objectives, after the progress view; pacing may matter more than lower numbers (asked 2026-08-29).
- **Matt:** BRICK CITY, RUNAWAY and POPONGO are Testing by code default; release from the admin page when ready (check; the admin page may already override) (`skeeball/js/boards.js`).
- `tools/test-skeeball-machine-spec.mjs` should assert `SK_MACHINES` in `js/game-stats-ui.js` matches `skeeball/js/boards.js` (about 20 lines).
- `tools/test-visual.mjs skeeball` fails "CANNOT BE PLAYED": resuming a rack banked on another machine leaves the playfield dead (canvas 0x0); reproduced on main 2026-10-15 (check if real or a test gap).
- BRICK CITY, Matt's 2026-08-24 asks never built: penalty baskets "very red", best target obvious at a glance (pair colour with shape: colorblind rule); face to match the marquee sign (Matt deferred this one: do not start unasked) (`docs/archive/skeeball-sessions/MATT-2026-08-24-hotshot-brickcity-asks.txt`).
- Unanswered offers from the 2026-08-25/27 BRICK CITY sessions (`docs/archive/skeeball-sessions/brickcity-runaway-sessions/`): three cuts to `MACHINE-SPEC.md` Part 7 (BRICK CITY 26% table row, the draw-calls bullet, the duplicated comment header in `tools/test-skeeball-machine-spec.mjs`); a `tools/test-skeeball-perf.mjs` (WebGL contexts, one `_frame` per frame, textures back to baseline, idle draw-call ceiling); dead `ringSegments: 24` in the classic entry of `boards.js`; a per-machine "100s hit" counter (check).
- POPONGO: 84% of throws roll back to the trough (skeeball/CLAUDE.md, "POPONGO and the arrangement layer").

## Tic Tac Toe

- Hub at 390x664 with browser toolbars: the screen is 16px too tall and scrolls (`tools/test-visual.mjs tic-tac-toe`, reproduced on main 2026-10-15).

## Texas Hold'em

- Computers' hole cards can still be read in the save with developer tools (holdem/CLAUDE.md, "Two-tab trick closed").
- **Matt:** play online on real phones; only proven against a local stand-in (holdem/CLAUDE.md, "Verification status") (check).

## Yahtzee

- Add the "Nth consumer: Yahtzee" entry to `js/CLAUDE.md`'s lockstep section (yahtzee/CLAUDE.md, "Known gaps"; `js/CLAUDE.md` table, `net.js` row).

## Housekeeping (Matt's PC)

- Sam / Sam1 player records need merging when Sam is online; `fix-sam-merge.mjs` was untracked in the repo root (check).
- About 47 MB untracked: `skeeball/Machines/` and `skeeball/References/` should be gitignored not deleted; `.gitignore`'s `.claude/*` is root-anchored so `skeeball/.claude/` slips past (check).
- Ten dead July branches and three orphaned git worktrees (`gh-lb-wt`, `gh-main-check`, `gh-strip`) that `git worktree prune` cannot remove (check).
