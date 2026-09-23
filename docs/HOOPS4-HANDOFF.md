# Connect 4 Hoops — handoff

Written 2026-09-22, at CACHE **v906**, branch `claude/skee-ball-board-designs-39u6s7`.

This is a state-of-the-game document for a session picking up Connect 4 Hoops cold. It does not
replace `hoops4/CLAUDE.md` — that file is the real documentation and is auto-loaded the moment you
touch the folder. **Read that first.** This one tells you where the game actually stands, what is
left, and which things are settled so you do not spend a day re-opening them.

---

## 1. What the game is

Matt's idea, from photos of the real Bay Tek **CONNECT 4 HOOPS** cabinet: seven basketball hoops in
a row over a 7 x 6 Connect 4 board. Sink a hoop and your disc drops down that column. Four in a row
wins.

- In-hub module, `immersive: true`, hub id `hoops4`, **`devOnly: true`** (admin only — it can be
  released from the admin page with no commit; there is no `released` date yet on purpose).
- Real three.js + cannon-es physics, forked from Skeeball's BRICK CITY engine into
  `hoops4/js/{machine,physics,render}.js`. **Editing those cannot affect any Skeeball machine and
  vice versa. That isolation is the point — do not "share" them back.**
- The Connect 4 rules and the solver are NOT reimplemented: `js/game.js` imports
  `connect-four/js/board.js`, `js/cpu.js` imports `connect-four/js/ai.js`.

## 2. Where it stands

Working and live:

- Solo vs CPU at Easy / Medium / Hard, and pass-and-play.
- Two shot rules — shoot until you sink one, or one shot only — frozen per match.
- **Live multiplayer** over `js/net.js` (`rooms/<CODE>`).
- **Turn-by-turn multiplayer** over `hoops4/js/mp.js` (`hoops/games/<id>`), addressed by PLAYER
  CODE. **The Firebase rules for `hoops` were published by Matt on 2026-09-22 and this works.**
- Series (single / best of 3 / best of 5), an optional caption with a challenge, a terms screen
  before you send one.
- A launcher challenge alert (a speech bubble on the hub tile) and a full-screen challenge
  ceremony.
- A restructured setup screen (Play the computer / Multiplayer) and a visual How to Play.
- A square board with square cells, and a lit marquee.
- A skeeball-style hamburger Menu button opening a Paused sheet.
- The disc **falls down its column**, starting the instant the ball goes through the hoop.
- **Quick chat inside a match** (both protocols) and a **History** screen with a record per
  opponent (2026-09-22).

## 3. What is left

The one list is **`hoops4/CLAUDE.md`, "Still open"** at the foot of the file. Keep it there; two
mid-file "still to come" paragraphs went stale within a day and had to be consolidated into it.

1. ~~**Quick chat inside a match.**~~ **DONE 2026-09-22.** A 💬 button on the play HUD, left of
   Menu, in both protocols. Live rides `rooms/<CODE>/reactions` (the existing `net.sendReaction`,
   no net.js change, never the move log); turn-by-turn writes an OPTIONAL
   `hoops/games/<id>/chat/<key>` child, verified by re-read, that `validateGame` never refuses a
   match over. No rules change. `hoops4/CLAUDE.md`, "Quick chat inside a match".
2. ~~**Challenge history with records.**~~ **DONE 2026-09-22.** "History" on the multiplayer home:
   a record per opponent (by player code) and every finished match, opened read only. New finished
   index rows carry an optional `result`; old rows are worked out from their match.
   `hoops4/CLAUDE.md`, "Challenge history with records".
3. **The two bounce gaps `test.js` owes** (see §5). Do not touch without asking.
4. ~~**Matt's "perfect shot or 50-50" bounce.**~~ **CLOSED 2026-09-23: "leave the hoops as is."**
   Rimouts and a round rim stay in the code, OFF. Settled; do not re-open without him.

Also done 2026-09-22: the falling disc now starts when the ball is THROUGH the rim (not at
capture), and the thrown ball is a basketball in the board's exact red/yellow.

## 4. Settled — do not re-open these

Each of these cost real time and each is closed. If an audit says otherwise, the audit is wrong.

- **The scoring rate is 28.6% and stays there.** Every lever was swept on the full 231-throw grid.
  Only one raises scoring without a cost (widening the hoop mouth 10%: 31.6%, parked nearly
  halved, bounce intact) and **Matt was shown the table and chose to leave the hoops alone.**
  `boarddef.js` also says `RIM` is never changed without him, and the root `CLAUDE.md` says a
  mouth's width is his number. Everything else that scores higher pays in parked balls (3x–3.6x)
  or deadens the machine back to the "beanbag" he already rejected. `boardRest`, `deadRest` and the
  jitter pair are **not scoring levers at all** — zero movement at every value tested. The full
  table is in `hoops4/CLAUDE.md`, "THE SCORING RATE".
- **The grid number is not a player's number.** 28.6% is an even sweep of every power x aim
  combination, including ones no thumb produces. A scripted thumb aiming at columns landed
  **19 of 28**. Quote the right one for the question.
- **The cabinet is ONE STEP, the display is VERTICAL and BELOW the hoops.** Two earlier builds got
  this wrong in opposite directions (a grid two steps up a staircase; a panel raked 38° that was
  unreadable edge-on). Do not rake it, do not raise it.
- ~~**There is no rimout.**~~ **Reversed 2026-09-23 by Matt**: rimouts are on and the invisible
  tube above the rims is gone (*"it should be able to freely bounce horizontally"*). The disc falls
  at `through` (the ball wholly below the rim), which is final, so the board and physics agree.
- **Nothing may read `G.holes` to steer a ball.** The sideways-bounce redirect is a rotation of
  velocity the ball already had; `test.js` asserts structurally that it reads no hole position.
  This is the rule a future session would "improve" into magnetism.
- **The Monopoly-Deal-style split does not apply here, but the two-buttons-one-place rule does.**
  The hub's floating chip is a QUIT (top left); the game's Menu button is a pause (top right).
  They are separated HORIZONTALLY because a notch cannot move that axis — a headless browser has
  `env(safe-area-inset-top) === 0` and will tell you they do not overlap when they do.

## 5. The two known gaps, and why they are red on purpose

`hoops4/js/test.js` has a `KNOWN_GAPS` map. It currently owes two, both from the square board:

| bar | measured |
|---|---|
| a miss usually BOUNCES rather than thudding — 50% | **41%** |
| and the bounce is big enough to see — 0.50 m/s | **0.45 m/s** |

The bars are **not lowered**. The real number is measured and printed every run, the summary says
`2 KNOWN GAP(S) STILL OWED`, and **a gap whose check starts passing FAILS the run** and tells you
to delete the entry. A silently lowered bar is how a requirement disappears.

Matt's call was *"Ship square now, tune the bounce after you've felt it."* He has since played it,
and the thing he raised was the scoring rate, not the bounce — and that question is now closed.
**Every lever that restores bounce costs scoring, which is the axis he cared about. Ask him before
spending anything here.**

## 6. The instruments

All of these drive the REAL engine. None of them needs a browser unless noted.

| tool | the question it answers |
|---|---|
| `node hoops4/js/test.js` | Matt's four requirements as numbers, plus the known gaps. ~2 min. |
| `node reference/hoops/probe-bounce.mjs` | Does a miss bounce, which WAY, and what does it touch? `--set=k=v` measures a candidate without editing `boarddef.js`. 231 throws. |
| `node reference/hoops/probe-hole-radius.mjs` | Scoring vs the hoop mouth radius (the nested per-hole `r`, which `probe-bounce`'s flat `--set` cannot reach). Widening only. |
| `node reference/hoops/sweep-speed.mjs --scan` / `--band=min,max` | The launch speed band. Re-derive it after ANY change to the board's height or the hoop row's. |
| `node reference/hoops/check-display.mjs` | The machine as the PLAYER sees it, in a real browser. 11 checks. Needs `node server.mjs`. |
| `node test-hoops4-mp.mjs` | The pure halves of turn-by-turn multiplayer. |
| `node check-no-scroll.mjs hoops4` | No game in this hub may scroll. |
| `node test-visual.mjs hoops4` | The only suite that LOOKS at it. Writes a contact sheet — open it. |
| `node test-game-conventions.mjs` | The shared checklist. |

**Do NOT run `run-all-tests.mjs`** unless Matt asks for it by name (his instruction). Run the
suites covering what you changed, plus `validate-sw-assets.mjs` before every deploy.

### A COARSE GRID LIES

A 77-throw sweep (7 aim steps) was used once because it runs in seconds. It ranked a different
launch band best AND claimed the taller board outscored the short one. The real 231-throw grid
disagreed on both. **Aim resolution is exactly what a narrow hoop row is sensitive to.** A fast
sweep can rank bands roughly; it must never be the thing a decision is made on.

### A CENTRE IS NOT A CELL

`check-display.mjs` raycasts cell centres for occlusion. It reported **10/10 while the cabinet's
flare was covering both bottom corners of the grid**, because the bottom row's centres cleared it
even though the cells did not. It now also raycasts the panel's four corners and the outer lower
edge of the bottom row's end cells. When you add a geometry check, ask what it samples.

## 7. How to ship

**Asking for a change means LIVE on the deployed hub, not committed to a branch.** The sequence is
pre-authorised and does not need re-confirming:

1. Commit and push to the working branch.
2. Open a PR into `main`.
3. Merge it.
4. **Verify the `pages build and deployment` run for that merge SHA reaches
   `status: completed` / `conclusion: success`.** Merging starts the deploy; it does not finish it.
5. Only then say it is live — plainly, not "pushed" or "merged".

Before the push: bump `CACHE` in `sw.js` **past what is on `main` right now**, not past your
working copy (two open branches otherwise both compute the same number and produce a permanently
mixed build), then run `node validate-sw-assets.mjs`, which also rewrites `REST_MANIFEST` and
`version.json` — commit those.

## 8. Working habits Matt has asked for

- **Delegate to lower-model subagents.** Pass `model` explicitly on every `Agent` call or it
  inherits the most expensive one. Sonnet for screens, CSS, probes, docs, concretely specified
  stages; Opus for engine and architecture judgement; Haiku for mechanical work. Batch — one agent
  doing three related things beats three agents, since each re-pays the full CLAUDE.md load.
- **Answer him immediately when he asks what you are doing.** Mid-turn messages are not notes to
  fold into the final report.
- **Report about the game you were asked about.** Nothing else belongs in the reply.
- **No em dashes in user-facing copy.** He is red/green colourblind: never use hue alone.
- **A milestone is not done until CLAUDE.md reflects it** — and the inverse, learned the hard way
  on this game twice: **a line recording something Matt still owes is stale the moment he does it.**
  The `hoops` rules note said "NOT been published" for a day after he published them, and got
  quoted back at him as outstanding work.

## 9. Recent history, newest first

| CACHE | what |
|---|---|
| v923 | Opponent's move arrives live in an open match; "Your turn vs <names>"; the challenge card plays once per match |
| v922 | Multiplayer home reorganised; Quit (resign) on every game and in the pause sheet; finished matches counted on both phones |
| v921 | Own challenge no longer pops up as one received; the launcher bubble listens live |
| v920 | Release jitter 0.013 -> 0.025 (a perfect aim lands 78% -> 62%); big shot messages under the board |
| v917 | Invisible tube above the rims removed; rimouts on; rim bounces go sideways. Scored 29% -> 21% |
| v916 | Disc falls behind the board face (seen through the holes); thrown ball unlit, painted from the disc's own colours |
| v915 | Ball hidden once through the rim; "<who>'s turn" label clear of the Hub chip; HOOPS-first marquee |
| v913 | Disc falls on `through`; the thrown ball is a red/yellow basketball; rimout knobs (off) |
| v908 | Quick chat in a match; challenge History with records |
| v906 | The cabinet flare no longer covers the board's bottom corners; taller marquee |
| v905 | Skeeball-style Menu button + Paused sheet; the marquee rebuilt as a lit sign |
| v904 | The falling disc starts at the capture, not at the throw resolving |
| v903 | The disc falls down its column instead of teleporting |
| v902 | The board is square again |
| v901 | How to play, drawn instead of written |
| v900 | A series, and the terms of a challenge |
