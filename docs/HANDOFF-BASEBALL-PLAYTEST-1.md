# Baseball handoff: playtest 1 (2026-09-23)

Paste everything below the line into a fresh Claude Code session on `mpowell95/game-hub`. Start one
session per batch. Batches 1, 2 and 3 are independent and can run in any order (or in parallel
sessions). Batches 5 and 6 need batch 4 merged first.

---

You are continuing work on the Baseball game in the Game Hub repo (`baseball/`). This document is
the full brief: Matt's playtest of Little League career (live build `game-hub-v929`), what was
found in the code, and his decisions. Do the ONE batch you are told to do, then stop.

**Read first, and only this:** the top four entries of `baseball/CLAUDE.md` (grep `^## `), plus
whatever sections of it and `docs/BASEBALL-3D-BUILD.md` your batch names below. Grep for sections;
do not read whole files. No subagents unless they clearly cut usage (root `CLAUDE.md`, "Subagents").

## Rules that apply to every batch

- **Every rule in `docs/BASEBALL-DESIGN-DOC.md` is [Locked]** (Matt, 2026-09-23: "confirm them").
  Where this brief overrules one, it says so; update that line of the doc in the same commit, with
  "Matt, playtest 1, 2026-09-23".
- **No difficulty setting, no help for weaker players, ever** (`baseball/CLAUDE.md`, "No difficulty
  setting"). Do not propose one.
- **Ship it live**: PR, merge, confirm the `pages build and deployment` run succeeds, then tell Matt
  it is live (root `CLAUDE.md`). Bump `CACHE` in `sw.js` past what is on `main` RIGHT BEFORE merging
  (re-fetch main first), run `node validate-sw-assets.mjs`, commit `sw.js` + `version.json`.
- **Economy or difficulty changes are measured, never guessed**:
  `node sim-baseball-career.mjs --all-tiers --careers 200 --assert --perfect 400` (~1 min), all 8
  assertions must pass. Exception, Matt's own words: the batch 1 changeup change does NOT need it.
- **Suites** (start `node server.mjs` first): `node baseball/js/test.js`,
  `node test-baseball-career.mjs`, `BB_DEVICE_QUICK=1 node test-baseball-device.mjs`,
  `node test-visual.mjs baseball`, `node check-no-scroll.mjs baseball`,
  `node test-game-conventions.mjs`. All green at v929.
- **Fit**: career home and the play screen must fit 390x664 in the hub with no scroll
  (`check-no-scroll.mjs`). Career home had ~25px spare at v929.
- **Saved games**: a season in progress keeps the rules it started with (see how `standingsModel`
  and `parks` are snapshotted in `startSeason`, `engine/career.js`). Anything that changes how a
  game plays out must be snapshotted the same way, or a mid-season save changes under the player.
- **Every new animation is skippable with a tap** (Matt), and must never block input once skipped.
- **End every batch with an entry at the top of `baseball/CLAUDE.md`** (THE LAW rule 9) and mark the
  batch DONE in this file.
- Matt's style: succinct, plain words, PC only.

## Matt's decisions (2026-09-23)

1. Changeup from Little League for BOTH the player and the CPU. No simulator run needed.
2. Fielding: the fielder runs to the ball automatically; the player only times the catch and picks
   the throw.
3. Throwing arm uses the PITCHING skills, not a new skill: pitch Speed (`pitchSpd`) = how hard a
   fielder throws, pitch Accuracy (`pitchAcc`) = how accurate the throw is (low accuracy can throw
   wild). The player's own pitching skills for their team; each CPU player's own for theirs.
4. Base running is controlled by tapping a base on a BIGGER mini-map (the diamond widget).
5. Intro, half-inning swaps and batter walks are all skippable with a tap.

---

## Batch 1: quick fixes (one session)

1. **Changeup at Little League, both sides.** Overrules design doc section 11 ("Little League is
   fastball only", R11). `settings.js`: add `changeup` to `PITCH_UNLOCKS.little` (and
   `LEAGUE_UNLOCK_ADDS.little` if it drives it; grep), and give `little`'s CPU row `pitchMix` a
   changeup weight (High School's is `{ fastball: 3, changeup: 2, curveball: 2 }`; start near
   `{ fastball: 3, changeup: 1 }`). Update the unlock table in the design doc and the R18
   first-season block text if it lists pitches. No sim run (Matt).
2. **Early / Late / Perfect only when the PLAYER bats.** `ui.js`, the `'count'` event handler
   (~line 3037, `if (payload.timingWord) this._showPop(...)`) shows it on every swing. Gate it on
   the human batting (`this.playerSide` vs the half: the player bats in the top when away).
   Overrules design doc section 8 "Fooled feedback" (the CPU's fooled pop). Check the in-play
   branch (~line 3318) the same way.
3. **Scoreboard bases icon is unclear.** `basesSvg()` in `ui.js` (~line 4887): three 8px squares in
   a 40-unit viewBox with a subtle `is-on`. Make them bigger and unmistakable: an occupied base
   solid `#ffce3a` with a dark outline, an empty base an outline only (colour-blind safe: filled vs
   hollow, not hue). Keep the scoreboard's own size (fixed geometry); measure the fit. Its stale
   comment ("first base on the left") is wrong: index 0 draws on the right; fix the comment.
4. **Mini-map runner dots are tiny.** The diamond widget (`DIAMOND_PCT` ~line 4906 of `ui.js`,
   `.bb-diamond-*` in `baseball/css/baseball.css`). Make the dots clearly visible (much larger,
   outlined). Batch 5 will make the whole widget bigger and tappable; don't redesign it here.
5. **Big OUT.** On every out (strikeout, fly out, ground out, tag), a large "OUT" over the field for
   about a second (`_showPop` already has `v_out` for steals; a bigger variant). The batter
   walking off comes in batch 3; here the next batter can still just appear.
6. **Home runs ignore the wall's HEIGHT.** `outcomes.js` `resolveContact`: a fly/line is a homer if
   it would LAND past the fence (`distanceFt >= wallFt`); its height when it reaches the wall is
   never checked, so low line drives count as homers and the drawn ball flies through the wall.
   Matt: "it gives homeruns too easily... it should bounce off the wall and still be in play."
   - Compute the ball's height at the wall's distance from its launch angle and carry (keep it
     consistent with how `ui.js` draws the flight: `_battedApexFt`, `_flightMsFor`), and compare
     with the wall's height (8 ft, `WALL_RULE.baseHeightFt`, or a park's tall `walls`). Below it =
     off the wall, in play: a double, or a triple into a deep corner, per the existing depth rules.
     This generalises today's `tallWallExtraFt` tall-wall rule; fold that into it.
   - Until batch 4, the drawn ball stops at the wall and drops (as `wall-double` does now).
   - First measure the home run rate per league BEFORE the change (add a counter to the sim
     output if there is none), so "too easily" is a number. Then run the sim; all 8 assertions
     must pass. If they don't, report to Matt with the numbers; don't retune on your own.

## Batch 2: bunt rework (one session)

Matt: "if I hold it down, the bat should stay there. A bunt isn't a swing. When you bunt, you hold
the bat horizontal and move it up/down/side to side to hit the ball."

- Today Bunt is a toggle (`state.armedBunt`, `ui.js` ~line 2710 and ~4792) that turns the next
  swing tap into a bunt (`resolveBunt`, `outcomes.js`; the `Bunt` clip in `poses.js`).
- New: HOLD the Bunt button = the batter squares (`Bunt` clip) and a horizontal bat bar replaces
  the swing circle at the batting cursor. While held, the bar follows the cursor/pad. If the pitch
  crosses the bar, contact happens on its own (no timing tap); how centred it is decides the bunt's
  quality (fair/foul/pop-up) through `resolveBunt`. Release = pull the bat back (a take). Releasing
  after the pitch is past does nothing.
- Engine: `resolveBunt` takes contact from bat-vs-ball position instead of swing timing; keep its
  outcomes and deterministic seeding. CPU bunts are unchanged.
- Touch rules: the button needs `touch-action: none` while held and must not scroll the page.
- Update the design doc's bunt lines (section on steal/bunt/pickoff) and add device-test coverage.

## Batch 3: game flow animations (one session)

All of these are presentation; the engine and the game result do not change. All skippable.

1. **Dugouts**: `field.js` `buildStadium` has none. Add two simple dugouts (first- and third-base
   sides) as destinations. Home team on one side, visitors on the other.
2. **A Walk clip** (`poses.js`, hand-authored like `Run`), plus the actor movement to use it.
3. **Pre-game intro** (every game): an overhead view; the fielding team runs out of its dugout to
   positions; the first batter walks to the box; the umpire's "PLAY BALL!" pops big; the game
   starts. Keep it short (target 5-6 s; Matt has not set a number).
4. **After every out**: after batch 1's big OUT, the batter walks back to the dugout and the next
   batter walks to the plate. (On a hit, the batter is already running; the next batter walks up.)
   Short; tap skips.
5. **Half-inning and end-of-inning swap**: the fielding team jogs to its dugout, the other team
   jogs out. Replaces today's cross-fade (`_crossFadeSwap`). Short; tap skips.
6. Measure how much each adds to a full game and report the total to Matt.
- Check the device test's timing probes (`test-baseball-device.mjs`); they may need the new beats.

## Batch 4: live plays, engine and visuals (probably two sessions)

**This is the biggest job since R16.** It replaces how a ball in play is decided.

Matt: "the other team is getting to some of my hits in time to catch them, and they actually do
catch the ball, but then it'll say I got a hit... if it's caught, it's an out... allow the ball to
land on the ground, bounce, and roll... show the fielder running towards it and throwing the ball
in to the appropriate infield player or base... it needs to look like baseball." And from batch 1:
the ball must bounce off the wall and stay in play.

**The bug, as found:** the result is decided first, from abstract out zones (`outcomes.js`
`resolveContact`, `zones.js`), and `ui.js` `_animateFielderChase` (~line 3980) then sends the
nearest fielder to the landing spot, arriving `Math.max(naturalTime, flightTime)`: always exactly
when the ball lands, whatever the result. Runners advance by the awarded bases (`bases.js`
`advanceAll`); nothing is ever thrown.

**What to build:**
- A **live play** in the engine: from contact, simulate in time, deterministically (seeded, like
  everything else): ball flight, landing, bounce, roll, off-the-wall bounce; the nine fielders'
  positions and run speeds; catch (an out) or the fielder reaching the ball; the throw (speed from
  `pitchSpd`, accuracy from `pitchAcc`, time from distance; relay through the cutoff man);
  runners with speed from `hitSpd`; force outs and tags; the play ends when the ball is held in
  the infield with no runner going.
- **Decisions are automatic in this batch**, for both sides: CPU fielding (who takes it, where to
  throw) and base running (who goes, how far), for the player's runners too. Batches 5 and 6 hand
  the player's side over to the player.
- **The drawn play follows the engine's timeline**, never the reverse: `ui.js` draws what the
  engine decided, frame by frame. New clips as needed (Throw, Catch; `poses.js`).
- **Snapshot/resume**: `Game.snapshot()` is taken at pitch boundaries; a play must resolve before
  the next checkpoint (a resume mid-play restarts from the pitch boundary; decide and document).
- **Snapshot the new model per season** (`season.livePlays`, like `parks`); a season in progress
  keeps the zone model.
- **The simulator must run the live play** (it drives the real engine through `career.js`), then
  re-tune the leagues until all 8 assertions pass. This reopens locked economy values (R16/R19);
  report every number that moved to Matt. Design doc section 10 ("Out zones sit where fielders
  would stand") is overruled; rewrite it.
- **Speed and Accuracy now matter more** (running and throwing). Measure both with the sim and
  report.
- Split into two sessions if needed: engine + sim first (4a), drawing second (4b). Don't ship 4a
  on its own if it leaves the drawn play disagreeing with the result; ship them together, or keep
  4a behind the per-season snapshot flag until 4b lands.

## Batch 5: the player runs the bases (one or two sessions, after batch 4)

Matt: "if I hit the ball and it lands in the outfield, I have to click something to send the
batter to second, then again to third, then again to home. And I could change my mind halfway to a
base, so the batter would stop and run back to the previous base. The fielder would have to
actually throw the ball in and try to tag the runner (or a force play)... This would allow for
more strategy and make Speed matter a lot more."

- **Control (Matt's pick): tap a base on a BIGGER mini-map.** The diamond widget grows (fixed
  geometry: it must fit the play screen at 390x664 without moving anything else during play) and
  each base becomes a tap target (>= 44px). Tap the next base = the lead runner heading there goes;
  tap the base a runner just left = go back. Decide and document how multiple runners are
  addressed (e.g. tapping a base sends the runner nearest behind it).
- Forced runners must run; the batter always runs to first.
- The engine's live play takes the player's inputs as a new agent input (like `decideSwing`),
  deterministic from the inputs. The CPU fielding reacts (throws to the base being run to).
- The simulator needs a model base runner for the player (like `HUMAN_STEAL`): it must run, and
  it must be measured. Re-tune if the assertions move.

## Batch 6: the player plays the field (one or two sessions, after batch 4)

Matt: "if the ball is hit to an outfielder, I'd have to time pressing a button correctly in order
to catch it. If I mis-time it, I bobble it and it falls to the ground. And if the ball lands, I'd
choose where to throw it (cutoff man, directly to a base, all the way to home plate... a quicker
throw to the cutoff guy, a tiny bit slower to go to a base, and it's a far throw to home, so the
distance would have to be accounted for)."

- The fielder runs to the ball on its own (Matt's decision 2).
- **Catch**: a timing cue as the ball arrives; tap in the window = caught; mistimed = bobble, the
  ball drops and stays live. Window size: measure it with the sim's model fielder; start from the
  batting timing window's scale.
- **Throw**: after a catch or pick-up, buttons: Cutoff, 1B, 2B, 3B, Home. Throw time from distance
  and `pitchSpd`; accuracy from `pitchAcc` (Matt's decision 3). A slow choice costs time.
- The CPU runs the bases against it (batch 4's AI).
- The simulator needs a model fielder for the player; re-tune if the assertions move.

## Status

| Batch | Status |
|---|---|
| 1. Quick fixes | DONE (2026-09-23, v933; `baseball/CLAUDE.md` top entry) |
| 2. Bunt rework | DONE (2026-09-23, `game-hub-v934`; `baseball/CLAUDE.md` top entry) |
| 3. Game flow | not started |
| 4. Live plays | not started |
| 5. Player base running | not started (needs 4) |
| 6. Player fielding | not started (needs 4) |
