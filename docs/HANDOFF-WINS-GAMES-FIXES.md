# Handoff: wins games, difficulty and points fixes (2026-11-16)

**Written by a session, not by Matt.** Matt's words are quoted per game below; each quote is from 2026-11-16.

**Cleared: BUILD everything in this document.** Matt: "write the handoff", and per game "add to handoff" / "ok".
**NOT cleared for players, with one exception per game noted below:** a re-price of points people already have, and
any change to a computer player, reaches players only when Matt says "release it", "ship it", or "make it live for
everyone" (root `CLAUDE.md`). Build each one admin-only or unmerged, show Matt the before and after, and ask.
No popup or announcement unless Matt asks for one in words.

Background and every number's source: `docs/WINS-POINTS-REVIEW.md` (real plays to 2026-11-16).

## What Matt wants (his three rules for all of this)

1. "make the difficulties make sense and make the step up in difficulty fun, not to make it impossible."
2. "Make the point values make sense. I want players to be rewarded for playing well and more for playing well
   against difficult opponents."
3. "Anti-farming... If there is a flaw in the game... or if there's a flaw in my leaderboard system where 1 difficulty
   pays more points than it should etc., he WILL find it and he WILL exploit it."

## How to measure (read this first; two earlier mistakes came from getting it wrong)

- **Test the claim Matt makes, as he states it.** If your number disagrees with him, assume your measurement is
  counting the wrong thing and check what it counts before saying so.
- **Measure what a player aiming for the best shot gets, never random inputs.** Cup Pong's bounce advantage was
  missed four times because random throws mostly miss (`tools/test-cuppong-bounce.mjs` shows the right way).
- **Win rates come from real plays** (`node tools/read-farming.mjs --all`, `node tools/read-play-log.mjs <CODE>`,
  both need `GAMEHUB_READER` and `NODE_USE_ENV_PROXY=1`). A simulation is allowed for tuning a computer player (Matt
  asked for them for Monopoly Deal and Flick Soccer), but say plainly which numbers are simulated.
- **The target for a level** is points per game played (points for a win x real win rate) of about 0.9 to 1.4, and
  no level a person can win 90% of the time outside the 20-point limit.
- After each change ships, re-check real win rates after about two weeks and tell Matt.

## Old wins when a computer gets harder or easier ("the marker")

Matt approved this for Air Hockey ("yes do that") and it is the pattern for every game below that re-prices:

- Nothing stored is changed or deleted (THE LAW). Points are worked out when a board is shown (`js/lb-points.js`).
- From the fix on, each result's saved mode carries one more field saying it was played against the new computer
  (a `withMode` mode thunk, e.g. `cv: 2`; `js/game-stats.js`). Wins without it are "old".
- `js/lb-points.js` prices old and new wins differently by that field (see `capMode` / `dbFarm`, added today for
  Dots and Boxes, for the shape). A win before 2026-10-30 has no saved mode at all and counts as old.
- Add the new field to the game's stats screen grouping only if it reads oddly there; it must never split a
  leaderboard.
- Update the game's scores sheet (`js/lb-points-sheet.js`, built from the code's numbers) and `tools/test-lb-points.mjs`.

## The games

Each line says Difficulty or Points. "Real" numbers are wins / games by real people, all time, to 2026-11-16.

### Air Hockey
Matt: "Air hockey needs to be fixed." then, on re-pricing old wins, "yes do that."
- **Difficulty:** make Medium harder. Real: Medium 60/62 (97%, 4 people), Hard 4/15 (27%). Aim for about 55 to 65%.
- **Points:** old Medium wins pay 1, at most 20 points from them in total; new Medium wins (marker) pay 2, no limit.
  Easy joins the 20-point limit. King of Games 117 to 30, MattyIce 27 to 21; places unchanged.

### Cup Pong
Matt: "I think adding an expert is smart. And to get the desired 20% win rate, you should look at how many throws it
takes people to get all the cups typically on a hard game." On no reracks: "It shouldn't be worth twice as many
points, probably, but an extra point." On old wins: "leave it at 227."
- **Difficulty:** add Expert, aimed at about 1 win in 5. Real Hard games with no reracks (65 with throws saved,
  nearly all King of Games): wins took a median 25 throws (14 to 46); he cleared in 20 or fewer in 13 of 65. So an
  Expert computer that usually clears 10 cups in about 20 throws. That data predates today's table fix; re-read it.
- **Points:** no reracks pays +1 (Hard 4), not x2; Expert pays 6. King of Games 295 to 227, still 1st. No other
  re-price of old Cup Pong wins.
- **Already live (v1616):** the table (rest 0.70 + a seeded kick, `cup-pong/js/physics.js` `TEST`, `tk` on new
  challenges). **Follow-up:** once people have thrown on it for a few days, split real throws into deliberate bounces
  (low power, first landing 10 cm or more in front of the front cup) and direct throws, by cups left, and show Matt.
  Before the fix: King of Games at 7-10 cups, bounce 62% (223/357), direct 43%.
- No-gentleman's has no data (every recorded game had it on). Do not price it.

### Connect Four
Matt: "Connect 4 medium: ok, add to handoff", "Connect 4 easy: ok".
- **Difficulty:** make Medium easier. Real: Medium 8/161 (5%, 13 people), Expert 2/26 (8%), Hard 2/7. Aim for 30 to
  50% at Medium. Leave Hard and Expert.
- **Points:** new Medium wins (marker) pay 3; the 8 old Medium wins keep 6 (Unai 4, MattyIce 2, King of Games 1,
  HDJ, Inc. 1). Easy goes under the 20-point limit (won 85%, one person has 85 of 119 wins): King of Games 115 to 50,
  still 1st.

### Boggle
Matt: "Boggle: yes, add to handoff", "boggle intermediate (should be renamed to medium for consistency)".
- **Difficulty:** all three computers easier. Real: Beginner 112/435 (26%), Intermediate 0/118 (9 people), Pro 0/1.
  Aim for about 50%, 25%, 10%.
- **Names:** show Easy / Medium / Hard. Stored keys (`beginner`, `intermediate`, `pro`) never change (THE LAW rule 5).
  Ask Matt whether to rename every other game that still shows Beginner / Intermediate / Pro.
- **Points:** unchanged (2 / 6 / 10). No old Medium or Hard wins exist.

### Flick Soccer
Matt: "Ok for flick soccer, have the handoff release it admin only for testing". **ADMIN DEVICES ONLY.**
- **Difficulty:** use the clean-goals computer (`flick-soccer/js/ai.js` `TEST_LEVEL`, `planTest`, `traceShot`, today
  only in admin Test mode) as the computer at all three levels, on the NORMAL pitch (no open nets), behind
  `isAdminDevice()`. Set Hard's aim so it scores on about 10 to 11% of turns.
- **Why:** on 1,499 real online positions (107 real goals, 6 people), people score on 7.1% of flicks (best person
  8.4%); today's Hard scores on 15.2%, Medium 8.9%, Easy 2.5%; Test Hard 7.7%. The gap is aim: Hard's aim error is
  0.013 rad; with 0.06 rad the same brain scores 7.9%. About 10% of Hard's goals are beyond any human goal on record
  (4+ other pieces or 3+ walls). Against the computer since Oct 30: people score on 2.7% of flicks at Hard, the
  computer on 11.3% of turns (466 games). Hard first to 3: 0 wins in 23. (Computer numbers are simulated on real
  positions.)
- **Points:** unchanged. Old Hard wins keep their points.
- **Ask Matt first:** the goal-mouth reset (proposed in place of open nets: when a shot ends with the ball resting
  in the goal mouth closer to the line than a piece can fit behind, move the ball straight out until one fits).
  He has not said yes or no. Do not build it without his word.

### Tic Tac Toe
Matt: "tic tac toe classic. OK." and, on an unbeatable level, "Skip".
- **Difficulty:** Classic Hard makes an occasional mistake, aiming for about 1 win in 10. Real: 0/52 (2 people).
- **Points:** unchanged (Hard 5). No "Unbeatable" level.

### Darts
Matt: "i think we should reprice them still." then "Darts: ok i guess".
- **Difficulty:** make Hard stronger, aiming for about 35% wins. Real: Easy 15/19 (79%), Medium 22/33 (67%), Hard
  322/538 (60%, one person).
- **Points:** old Hard wins pay 2; new Hard wins (marker) pay 3. King of Games 1,013 to 691, still 1st.
- Cricket in order and 101/201: 7 games since options were saved. Leave them.

### Monopoly Deal
Matt: "it should be more difficult the more opponents you have", then "Monopoly deal: ok".
- **Difficulty:** computers stronger at bigger tables. Simulated (4,000 games per setup, computer vs computer): a
  Hard computer against 1 / 2 / 3 / 4 Medium computers wins 65 / 49 / 39 / 35%. Real: 73% against 4 (8/11, one
  person), 80% against 2 (8/10, one person). Levers in `business-deal/js/ai.js`: the difficulty table (about lines
  211-224) could scale with `view.opponents.length`; `respondToAction` (about line 537) never uses Just Say No
  against Debt Collector or Birthday and never defends a third player about to win; `threatOf` (about 326-336).
  Remember the `business-deal/sw.js` CACHE and the must-stay-synced copies (`js/CLAUDE.md`).
- **Points:** the multiplier for 1 to 4 computers becomes x1 / x1.3 / x1.6 / x1.9, in whole points Medium
  2 / 3 / 3 / 4 and Hard 3 / 4 / 5 / 6 (Easy 1 / 1 / 2 / 2). Applies to old and new wins. MattyIce 78 to 57 and takes
  1st; King of Games 83 to 51, 2nd. Tell Matt that he gains the gold here before it ships.

### Battleship
Matt: "Battleship: that sounds good." and "(This also needs a UI/UX overhaul. that's probably best done by a
different session...)".
- **Difficulty:** Hard stronger (about 40% wins), Medium a little stronger (about 60%). Real: Easy 11/11, Medium
  11/15, Hard 5/5 (31 games ever). Do it inside the separate look-and-feel session so the game changes once.
- **Points:** unchanged.

### Dots and Boxes
Matt: "I think it's more likely the difficulty or brain of the computer player needs to be updated vs the points
awarded. I think if you play perfectly, against any difficulty, you'll win 100% of the time", and on removing the
who-goes-first choice: "for non-admin, yes."
- **Difficulty** (`dots-boxes/js/ai.js`): Medium (`intermediateMove`) takes every capture and never double-crosses;
  teach it the double-cross about half the time, aiming for about 45% wins. Hard (`proMove`) plays random safe moves
  until 14 edges are left; on the small board (3x3) solve the whole game from move 1 (`bitMove` already does this for
  4x4 late), and on bigger boards play the opening by chain count and start the exact endgame earlier.
- **Who goes first:** players always alternate against the computer; admin devices keep the choice. Real: going
  second on the small board at Hard is won far more often than going first.
- **Points:** the table stays. **Live today (v1617):** Medium, small board, computer first pays 1 under the
  20-point limit (`js/lb-points.js` `dbFarm`), after 21 wins in 23 games in 7 minutes. When the new Medium ships, keep
  that price on old wins and give new wins (marker) the normal 3. The scores sheet still shows 3 for that setup;
  ask Matt whether to fix the sheet now.

## Already live today (not to rebuild)

- Cup Pong table fix and `tools/test-cuppong-bounce.mjs` (v1616).
- Dots and Boxes: the Went first / Went second table removed from its stats page (v1616); the farm re-price (v1617).
- `tools/read-farming.mjs`: run it before and after each change here, and weekly.

## Order I would do them in

1. Air Hockey, Connect Four, Darts (one computer each, plus the marker and a re-price).
2. Dots and Boxes brain (closes a live farm for good).
3. Cup Pong Expert and the +1.
4. Monopoly Deal.
5. Boggle, Tic Tac Toe.
6. Flick Soccer (admin only).
Battleship goes to its own session.

## Rules that apply

- THE LAW: nothing stored is deleted, lowered, or rewritten. Every re-price is read-time.
- Every result records its mode (`withMode`); a new field on a mode is not done until it is recorded and scanned
  (`tools/test-game-modes.mjs`).
- Never use Matt's code or name in a test. Test profile: test1, code `DREG5`. Times in US Eastern. No other player's
  code on any page.
- Shared files (`js/lb-points.js`, any game file of a released game) need `node tools/validate-sw-assets.mjs` and a
  `CACHE` bump past what is on `main`; verify the Pages run before saying "live".
- Subagents: only for big jobs, cheapest model that can do it; they never push.
- For each game, show Matt who moves on the board (names, places, medals) from fresh data before it ships.
