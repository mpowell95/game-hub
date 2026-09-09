# HANDOFF — Golf, the last three jobs before release

Written 2026-09-09 and refreshed the same day, at the end of a session that shipped the tutorial,
the pause menu and the HUD layout. **Read `golf/CLAUDE.md` in full before touching anything** — it is long, and it is the
record of every decision that has been reversed once already. Read the root `CLAUDE.md` too; THE
LAW governs job A completely.

## Where things stand

Golf is **feature-complete and live on `main`** (v729 at the time of writing), but it is still
`adminConfig/v1/games/golf → live: false`, so only a dev profile can see it. Releasing it is **one
tap on the admin page**, not a deploy.

**Only Pine Valley ships at launch** (Matt, 2026-09-09). That is already the code default —
`COURSE_OPEN_BY_DEFAULT = { pinevalley: true, redmesa: false, oasissands: false }` in
`golf/js/progress.js`. Nothing to change.

**Matt's decision on sequencing:** ship without resume, then build it. The unlock ladder means day
one the only playable thing is a 3-hole round (about five minutes) — losing one is a shrug. To
reach the 18-hole round a player must first beat six 3-hole sets and both nines, which is days or
weeks away. Do not delay the launch for job A; do finish it before anyone gets near a long round.

---

## Job A — a round survives leaving the app (THE LAW)

**There is no mid-round save. At all.** `gamehub.golf.v1` (`SETTINGS_KEY` in `golf/js/ui.js`) holds
only the last-used course, round and length. `_recordRound` writes nothing until a round is
COMPLETE, so closing the app on the fifteenth hole of an eighteen destroys the whole round.

Today the only protection is a confirm on the two exits (`_quit`, and the result card's close) plus
`isInProgress()` returning `!!(this.hole && !this.recorded)` so the hub asks. **None of that
survives the app being closed or iOS evicting the tab**, which on a phone is routine.

### Rules that are not negotiable

1. **Do NOT mint a second storage key.** Root `CLAUDE.md` says so by name: *"Do not mint
   `gamehub.golf.save.v1`."* Extend `gamehub.golf.v1` with a `save` field instead. **Note the root
   doc's reason is stale** — it says that key "already holds the round", which it does not; it
   holds settings. The instruction still stands, the justification needs correcting when you touch
   it (rule 9).
2. **`_recordRound`'s complete-round guard stays exactly as it is.** A resumed round is still only
   recorded when every hole has a score. Recording a partial round would store, say, 12 strokes as
   an EIGHTEEN-hole best — and because bests are `Math.min` only (rule 2), that wrong number could
   never be corrected by playing better. It would sit at the top of the leaderboard for ever.
3. **Verify the write by fresh re-read** (rule 6), and **clear the save only after `_recordRound`
   has succeeded** — not when the round ends. `js/game-stats.js`'s `drainPendingResults` /
   `clearPendingResults` split is the reference pattern and the reason for it is written up there:
   clearing at drain time looks equivalent and drops the data in exactly the case the mechanism
   exists for.
4. **A half-written save must be unusable, not wrong.** Validate on read and treat anything
   malformed as "no save". A save that restores a round into a subtly wrong state is worse than no
   save, because the player will not notice until the score is stored.

### What has to be in it

Everything `_enterHole` and `_settleShot` set up, or the restored hole plays differently from the
one that was left:

`course.id`, `roundId`, `holeIdxs`, `pos`, `scores[]`, `roundStats`
(`birdies/eagles/aces/points/longestDriveYd`), `shotN`, `ball` (x,y), `aimRad`, the club in hand,
`recorded`, `newBest`, and `tutorialRun`.

Save on every beat that changes any of it: the end of `_settleShot`, `_enterHole`, `_startRound`,
and the hole advance in `_showHoleResult`.

### The restore UI already has a string waiting for it

`golf/js/strings.js` has **`resume: 'resume round'` / `'seguir vuelta'`** — an orphan key that
nothing calls. It was written for this and never wired. (It briefly collided with a second `resume`
key added for the pause menu; that one is `pause_resume` now, so this one is free and correct.)

Put a **Resume round** button on the setup screen when a save exists. Starting a different round
must discard it, and should say so.

### And when it is done

`isInProgress()` goes back to returning `false` **in the same commit** — root `CLAUDE.md` and
`golf/CLAUDE.md` both say so. With a save, leaving is lossless and the hub no longer needs to ask.

---

## Job B — a hole's maximum score is double par plus one

Matt, 2026-09-09: *"Double Par plus 1 should be each hole's max."*

Par 3 → **7**, par 4 → **9**, par 5 → **11**. This is real golf (equitable stroke control), so it
will not read as arbitrary.

- **The hole ENDS at the cap.** The player picks up; the game does not keep asking for shots it
  will not count. That is the half that makes it a feature rather than a clamp.
- **It applies to what is stored AND what is shown**: `gf.bestHole`, the round's stroke total,
  `stablefordPoints(strokes, par)` in `golf/js/rounds.js`, and the result card.
- **New scores only.** Existing records are never rewritten (rule 5). Nobody has much golf history —
  as of 2026-09-06 one device (`MattyIce`) had any at all — but check before assuming, because that
  changes the day someone plays.
- **It permanently bounds the "ball stuck in the trees" class of bug.** Every hole now ends. The one
  remaining case (`golf/js/test.js` section 15c: Pine Valley 13 hits the 14-shot ceiling on about 1
  run in 24) disappears by construction. Matt's standing correction applies here — that test player
  is significantly worse than a human and only searches ±45°, so it was never strong evidence about
  real play anyway.

**Watch out for `golf/js/test.js` section 12b.** It reads `ui.js` as text and pins that
`_showHoleResult` uses `this.shotN` with no `- 1`, and that it has exactly one caller. That probe
exists because every score in the game was once a stroke too low. Capping the score touches the
same line — update the probe deliberately and say why, do not delete it.

---

## Job C — the leaderboard

### C1. Golf's plays are "rounds", not "runs"

Golf is in `SOLO` in `js/players-agg.js`, so its plays are counted and labelled as **runs** on the
hub leaderboard and in My Stats. Matt wants the same treatment with a golf word: **rounds**.

**Do not rename globally.** `runs` is shared with Ball Run, Snake, Nuts & Bolts and Hill Climb, and
it is the right word for all four. Golf needs its own label only.

### C2. The hub board keeps ONE number

`GOLF_BOARD_COURSE = 'pinevalley3'` in `js/leaderboard-rank.js` — best 3-hole round on Pine Valley,
as a score to par, **lower wins**. It is the only metric on the whole leaderboard where lower is
better and good values are ≤ 0, and the sort direction, the `gameListHTML` filter and `rankMap` were
all changed for it. Leave it alone.

It is well chosen for launch: 1-3 is the first thing the ladder unlocks, so it is the one round
everybody will have, which is what makes it comparable.

### C3. The detailed boards go INSIDE golf

Matt: *"Since the golf leaderboard is likely a lot, maybe we have the more specific info within the
golf game itself?"* Yes — and there is precedent: **Skeeball** shows one number on the hub board and
the full picture on the machine's own backboard.

Build a leaderboard screen inside golf with tabs for **3 holes / front 9 / back 9 / 18**.

- The data already exists and already syncs. The round keys are frozen and stored today:
  `pinevalley3`, `pinevalley9` (front), `pinevalley9b` (back), `pinevalley18`, plus `pinevalley3b`
  ..`3f` for the other five 3-hole sets.
- Read it the way the hub board does: `readPlayersOnce()` (`js/stats-net.js`) →
  `aggregatePlayers()` (`js/players-agg.js`). Do not invent a second aggregation.
- Rank each tab by that key's stored strokes, displayed as a score to par. `GOLF_COURSE_PAR` in
  `js/leaderboard-rank.js` has the par for every round key — **and `golf/js/test.js` fails if that
  copy ever disagrees with the course data**, which is the link that keeps it honest.
- **A round key with no par row shows a dash, never a fabricated 0** (rule 4). `js/game-stats-ui.js`
  already does exactly this and is the pattern to copy.
- Never merge or compare different lengths. A 3-hole best and an 18-hole best are not the same
  measurement (rule 4) and every screen that shows one must name which it is showing.

---

## Done after this doc was first written

**None of the three jobs below has been started.** Everything since is tutorial polish, listed here
so nobody re-does it: the swing is now HELD on the aim and club steps (a refused tap flashes the
rings rather than doing nothing), the rings are thicker with a black key and clamped so they cannot
sit inside the rail, the putting card now fires from the FRINGE as well as the green (`mustPutt`,
not `lie === 'green'` - it was handing out a putter with no lesson), the bad-swing card's figures
are Matt's 25 and 45 with the curves deliberately not to scale, the closing card shows the pause
BUTTON and an arrow into the menu, and the club lesson sits on the second shot. Full write-ups are
in `golf/CLAUDE.md`; the lesson was played end to end afterwards at 46 checks, 0 failed.

### The tutorial rail

Matt, 2026-09-09: *"in my screenshot I made the text on the very bottom larger. Add that. But
extend it down. I don't want the bottom hud controls shifted up so make more room. And I don't want
this to impact non-tutorial holes."*

**Shipped.** The rail is 40 px (was 30) and its text 15 px (was 13), and the controls did **not**
move: measured before and after, `.gf-bl`/`.gf-br` sit 40 px above the root's bottom in both. The
bar grew into the 10 px strip of bare course that was already sitting between it and the controls.

**It cannot get taller than that without moving something, and here is the measurement.** The 40 px
under the game in the hub is `.hub-main.hub-main-immersive`'s own `padding-bottom` — it belongs to
the hub and to every other immersive game in it, so it is not golf's to take. Past 40 px the only
thing left to give is the controls' position, which is the one thing that was ruled out. If a
future session wants a taller bar it has to start there, with Matt.

**Non-tutorial holes are untouched by construction**: `data-tut="1"` is set only while the lesson is
running and the rail exists only then. Verified rather than assumed — on a practice hole the
controls sit at their ordinary 10 px inset with no rail and no `data-tut`.

Three things worth knowing if you touch that bar:

- **`--gf-rail-h` is one number and both rules read it.** The height and the controls' offset used
  to be written separately (`30px` against `10px + 30px`), which is how the 10 px gap appeared in
  the first place. The rail is `box-sizing: border-box` for the same reason: its 2 px gold top
  border sat outside a content-box height, so a 40 px bar rendered 42 and overlapped the controls
  by exactly the border.
- **The pips are a flex ITEM now, not an absolute one.** Held out of flow, the text had to be kept
  off them with hand-guessed side padding, and at 15 px the Spanish club card wrapped to three
  lines at 360 px and overflowed the bar. In the row they cannot overlap and the text gets whatever
  is actually left. This is the same flow-vs-absolute lesson as the HUD overlap below, applied
  where it was cheap.
- **The text is not `nowrap` with an ellipsis.** Clipping a tutorial instruction to make it fit is
  worse than any layout problem it solves. Two lines is 39 px inside a 40 px bar, so a long
  translation on a narrow phone wraps rather than disappearing. `es tut_club` was shortened to
  "Toca las flechas para cambiar de palo." so it is one line at 393 px.

`golf/js/test.js` section 20 pins the one-number rule and the flow layout as `[KNOWN-BUG PROBE]`s.

---

## Smaller, already known

1. **The top-left and top-centre HUD clusters overlap on narrow phones.** Measured gap between
   `.gf-tl`'s right edge and `.gf-tc`'s left: **+8 px at 393, +7 at 390, −8 at 360, −28 at 320.** A
   width problem, pre-existing, invisible to the suites because both drive golf at 393×852 and
   390×664 only — and those two are the same phone with and without browser toolbars, so the suite
   varies HEIGHT and has never varied width at all. A task is already queued for it.

   **Matt asked why we do not use flow layout, and was explicit that he was NOT asking for the
   change** — so do not do it as a side effect. For the record, the answer is that there is no real
   obstacle: the three top clusters could be one flex row with `space-between` and would then be
   incapable of overlapping. The tutorial's rings position from measured rectangles and do not care.

2. **`golf/CLAUDE.md` has a stale paragraph.** Near the top, under the stored shape, it says *"Queued
   for Stage D: My Stats' 'Best rounds' table shows raw STROKES while the leaderboard shows the same
   round as a score to par... Not done yet."* **It was done on 2026-09-06** —
   `js/game-stats-ui.js` shows to-par AND strokes side by side, with the reasoning in a comment
   right there. Delete the queued note (rule 9) so nobody rebuilds finished work.

3. **Red Mesa hole 1**: a putt aimed dead straight from 15–30 ft holes **100 %** of the time at any
   `BREAK_K`, because the pin sits at the low point of a `bowl` green and the slope funnels
   everything in. The fix is to move that pin off the low point, par untouched so stored `bestHole`
   keys keep their meaning — the same move Oasis Sands 3's pin got. Not launch-blocking: Red Mesa is
   not released.

4. **Oasis Sands palms have no species colour.** `TREE_FILL` in `golf/js/render.js` is keyed by tree
   type NAME and has `saguaro`/`paloverde`/`boulder` but not `palm`/`tall palm`/`scrub palm`, so all
   211 fall back to the theme default and paint Pine Valley's forest green on red desert. Three hex
   values, but they are art direction — Matt's call. Not launch-blocking; Oasis Sands is not
   released.

---

## How to work on this repo

- **Deploy discipline is not optional.** Any change means: commit, push, PR, **merge to `main`**, and
  **verify the `pages build and deployment` run completes with `conclusion: success`** before telling
  Matt anything is live. A branch is not a deploy. Root `CLAUDE.md` has the full rule and why it
  exists.
- **Bump `sw.js`'s `CACHE` past whatever is on `main` RIGHT NOW**, not past your working copy —
  two branches open at once will otherwise compute the same number and produce two different builds
  with one name. Then run `node validate-sw-assets.mjs` and commit `sw.js` + `version.json`.
- **Do NOT run `run-all-tests.mjs`.** Matt's instruction. Run what covers what you changed:
  - `node golf/js/test.js` — the engine suite (~10 min; it plays all 45 holes)
  - `node test-visual.mjs golf` — renders it, four fit checks, a play probe
  - `node check-no-scroll.mjs golf` — no game may scroll, page or inner
  - `node test-i18n-strings.mjs`, `node test-game-conventions.mjs`
  - `node validate-sw-assets.mjs` before every deploy
- **Measure, do not guess.** This game's whole documented history is measurements overturning
  confident readings — the meter's arc, the club tempo, the HUD's insets. If you are about to write a
  number, measure it first and write down how.
- **When you playtest, model a PERSON**: the club the game offers, the aim it hands you, and a thumb
  with real timing error. A harness that searches its options proves the physics can do something no
  player can make it do. And Matt's standing note: any simulated player here is **significantly worse
  than a human**, so treat its scores as a floor, never as evidence about the family.
