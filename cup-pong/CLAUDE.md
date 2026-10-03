# Cup Pong — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them. **Stage 1 stores nothing at all** (no
> settings key, no stats, no save), so there is nothing here yet to lose.

A clone of GamePigeon's Cup Pong (the iMessage game), as an in-hub module. The spec is
**`docs/CUP-PONG-BRIEF.md`** - read it before changing anything here. It builds in five stages;
this file says which are done.

## Where it stands (2026-09-28)

| Stage | What | State |
|---|---|---|
| 1 | Table + throw: three.js + cannon-es, the camera, flick to throw, cups vanish when made, rack as hex cells. Solo practice only | **Done.** Matt, 2026-09-28, after the third throw build: *"It feels good now, start stage 2"* |
| 2 | Rules (brief section 3, confirmed below), settings, Gentleman's, vs CPU, rebuttal, stats | **Built 2026-09-28, deployed devOnly, waiting on Matt's play-test.** The Reracks setting (brief 4a) moved to stage 3, see "Stage 2" below |
| 3 | Rerack: presets, then custom | **Built and deployed 2026-09-28**: presets, then "Make your own" (Matt: *"build custom rerack next"*). See "Make your own" below |
| 4 | Bounce shots | **Built 2026-09-28, then turned OFF by Matt the same day** (a bounced make is one cup). See "Bounce shots" below |
| 5 | Challenges + push | **Built and deployed 2026-09-28** (Matt: *"I don't see multiplayer? You should be able to challenge someone just like connect 4 hoops"*). See "Challenges" below. **Rules published and `cupPongTurnPush` deployed, both 2026-09-28** |
| + | **Solo: clear the rack in the fewest throws**, with a leaderboard (Matt's ask, 2026-09-28) | **Built and deployed 2026-09-28** - see "Solo" below |

### The GamePigeon rules, CONFIRMED by Matt 2026-09-27 ("1-7: yes")

1. 10 cups per side, triangle 4-3-2-1, point toward the shooter. **Yes.**
2. Each turn is 2 throws. A made cup disappears. **Yes.**
3. Balls back: make both throws in a turn and you get 2 more throws. Repeats. **Yes.**
4. Same cup twice cannot happen (a made cup vanishes at once). **Yes.**
5. Heating up / on fire IS in GamePigeon: cups on 2 turns in a row = heating up, the 3rd = on
   fire, shoot until you miss. **Yes.**
6. Win: clear all the opponent's cups. **Yes.**
7. Ball physics: rims, rolling round a rim and out, bouncing off table and cups, off the table.
   **Yes.**

### Matt's first feel check (2026-09-27): "the flick doesn't feel right"

He sent two screen recordings of real GamePigeon (Dropbox, `/Claude Code Refs/ScreenRecording_
09-27-2026 16-04-24_1.MOV` and its `(1)` twin). Stage 1's first build had been designed without a
reference and was wrong in almost every visible way: a camera low behind the shooter, a wood table,
red cups, the ball hanging in the air near the lens, a slow high lob. The second pass rebuilt it
from the recordings - see "The look" and "The throw" below. Aim: he was "not sure".

## Stage 2: a match against the computer (2026-09-28)

**The setup screen** (hub skin, `css/ui.css` primitives): Play the computer (Easy / Medium / Hard,
each with its shape from `js/difficulty-tiers.js`), Gentleman's On/Off, **Play**, and **Solo**
(stage 1's practice table, recorded since 2026-09-28 - see "Solo" below).

**Setup** also has **Reracks** (0 / 1 / 2 / 3 / unlimited, default 2, per player per game), since
2026-09-28 when the rerack itself shipped.

**`js/match.js` decides everything**, as events: `made`, `miss`, `ballsBack`, `heatingUp`, `onFire`,
`cooled`, `removed`, `rackCleared`, `rebuttal`, `overtime`, `gentlemans`, `rerack`, `islandCalled`,
`islandPick`, `picked`, `turnOver`, `win`. The screen only announces them.

### The rules as Matt set them (2026-09-28, second round, his words where quoted)

The first stage 2 build guessed at several of these; every guess below was corrected by Matt and is
now his rule. `node cup-pong/js/test.js` has a check for each, his own counter-example included.

- **Heating up and on fire are PER BALL.** *"it has to be the first ball that gets 2 in a row for
  heating up and 3 in a row for on fire. and on fire means you get that ball back and shoot until
  you miss."* His counter-example: ball 1 in, ball 2 out, next turn ball 1 out, ball 2 in, is NOT
  heating up. Each ball keeps its own streak across turns, and **every throw of that ball counts,
  balls-back throws included** (asked and answered the same day). The 3rd make in a row lights it;
  that ball then comes straight back after every make, and a miss cools it (streak to 0) and passes
  to the other ball. The ball itself shows it: amber at 2 in a row, flame orange from 3
  (`setBallHeat`), and the bar says "Ball 1 heating up" / "Ball 1 on fire".
- **Balls back**: both balls' last throws of the pair were makes. It repeats.
  **A fire run keeps balls back** (Matt, 2026-09-30: *"I should get to shoot my made fire shot until
  I miss, then we get balls back and each get another shot"*): the miss that ends a fire run does
  not undo that ball's make in the pair, so the fire ball shoots until it misses and THEN the balls
  come back if the other ball made its shot too. Before, that miss passed the turn. Frozen per
  challenge as `rules.fb` (`Match({ fireBallsBack })`); an older challenge replays as it was.
  **A bonus throw** (`{ k: 'x' }` in a challenge log, `match.grantExtra()`): Matt asked for one in
  his match vs King of Games (`mun9hjrulielgqfw`) to make up for the fire turn above, which could
  not be replayed under the new rule because King had already played after it. The entry is for a
  SIDE (`by`) and may sit anywhere in the log (`applyEntry` handles it before the turn checks); it
  waits in `match.bonus[side]` and is taken at that side's next normal turn, thrown first as ball 2
  (no streak, never counts toward balls back, no island call), then the normal pair. No screen
  offers it: it was written into that one match by hand, on Matt's request, after a full backup. The
  other player's phone applies it SILENTLY (Matt: *"Don't explain anything on his phone"*).
- **The last cup**: *"if I have 1 cup left to hit, and I make it with my first ball, I still get to
  shoot the second ball. If I make that ball too (so both balls are in the same cup) i win the game
  and the other team does NOT get a rebuttal."* The cup STAYS on the table while a ball is left to
  throw at it (`lastCup`); the "Last cup! Same cup wins" notice says so. A miss then removes it and
  the rebuttal follows. This is the one exception to "a made cup is gone at once".
  **Balls back count as balls left** (Matt, 2026-09-29: *"I just beat king of games by hitting the
  last two cups. But I didn't get the balls back to shoot again and end the game. It just gave him
  the rebuttal"*): the last cup made by the pair's second ball, the first having gone in too, stands
  and the balls come back; a ball in it wins with no rebuttal, both missing removes it and the
  rebuttal follows. Frozen per challenge as `rules.lc` (`Match({ lastCupBack })`): a challenge made
  before has no `lc` and replays as it was played, so a finished match is never re-scored.
- **The rebuttal**: *"rebuttals is 2 shots as well - each person gets to shoot. And if the first
  ball hits a cup, they get that ball back"*. Both balls, each shooting until it misses. Clear
  everything: overtime. Both missed: the side that cleared wins.
- **Overtime**: 3 cups a side in a 2-1 triangle on the BACK rows (`OVERTIME_CELLS`), streaks reset,
  the side that cleared first shoots first, and at its end a rebuttal applies again. Matt: *"nice
  overtime."* and *"there should be NO reracks or gentlemans allowed in OT"*.

### Gentleman's, Rerack and Island are BUTTONS (2026-09-28)

Matt: *"Gentleman's did work automatically. nice. But let's make it an option. rerack should be like
that too. when it's available, theres a button on the left..."* So all three are the shooter's
options, pill buttons stacked on the LEFT edge of the table (`.cp-opts`), each shown only while it
is on offer and gone after the turn's first throw:

- **Gentleman's**: the rack being shot at is down to 2 cups not already in a line, the setting is
  On, not overtime. Free. The cups slide into the line. **Also in a REBUTTAL, any time a ball is in hand** (Matt,
  2026-10-01: a rebuttal make left 2 cups, "Gentleman's is offered" should happen before the ball
  that comes back). A normal turn still offers it only before the turn's first throw.
- **Rerack (n)**: before the turn's first throw, one a turn, not in a rebuttal or overtime, while
  the shooter has reracks left. Opens a sheet of the presets for that many cups (`rack.js RERACKS`,
  each drawn top-down), and the cups slide into the one tapped. **Make your own** is the last tile
  of the same sheet (built 2026-09-28, see below).
- **Island**: *"if a cup is not touching any other cups, you can call island (once per game). and if
  you hit that cup, you get 2 cups. The opposing player can choose the second cup. If there are
  multiple available islands, you must call the specific one."* The button calls the only island
  at once, or rings every island in yellow and asks you to tap the one you are calling. **Calling
  spends it, hit or miss** (Matt, 2026-09-28). **A call is for ONE ball** (Matt, 2026-09-29: *"You
  should be able to call island for one ball and not the other. It shouldn't auto apply to the
  second ball"*): the engine always cleared `called` after the next throw, but the yellow ring stayed
  on the cup after a miss, so it looked live for ball 2. `showEvents` now takes it off once a throw
  has used the call, and the button can be used before ball 2 alone. **EACH BALL IS ITS OWN PLAYER**
  (Matt, same day: *"each 'player' gets to call island once per game - and it does NOT have to be at
  the same time as the other 'player'"*): `islandUsed[side]` is `[ball1, ball2]`, so a side has TWO
  calls a game, each for the ball about to be thrown, on any turns. An older saved match's single
  flag reads as both used. Challenge logs only gained permission, so every stored log still replays;
  a phone still on the old build would refuse a log with a second call until it updates (the hub
  updates itself on the next load). Hit it and the defender owes a second cup: the
  computer picks at once (its loneliest cup); when you defend, the camera turns to your cups and you
  tap one. Allowed in overtime (Matt ruled out only reracks and Gentleman's there); not in a
  rebuttal.

**Make your own (2026-09-28, brief 4c).** The last tile on the rerack sheet opens the rack drawn
top-down on its own hex grid (`showCustomRack` in `ui.js`): all 28 cells of `AREA`, far row at the
top, dashed rings for free spots. Drag a cup onto a spot, or tap a cup (thick yellow ring) and then
a spot. It snaps to the nearest free cell, so two cups can never share one and nothing drawn can be
off the rack area; cups need not touch. **Done** (disabled until a cup has moved) spends the rerack
through `match.rerackCustom(cells)`, which checks the cells again (`isCell` + `validRack`) and keeps
every cup's id. **Cancel** goes back to the presets with the rerack unspent. The cups open on the
cells nearest where they stand (a Line preset sits on spots, off the grid). A full rack of 10 still
cannot be reracked (`canRerack`). In a challenge it is the log entry
`{k:'r', key:'custom', cells:[{c,r}...]}`, one cell per standing cup in rack order, and replays like
any rerack. The computer still only uses presets.

**Every rerack stands AGAINST THE BACK WALL (Matt, 2026-09-29):** *"please edit the reracks (custom
and the presets) so that everything is set against the back wall. Right now you can do custom rerack
and move everything closer to you. Like I just did a 3-2 rerack, but left the back row empty so it's
all closer. that shouldn't be possible."*
- **Presets**: the shape's BACK row stands on the rack's back row (`shape(rows, back)` in `rack.js`;
  lines too, `backLine`). `test.js` checks every preset starts at the back row and is legal.
- **Make your own**: at least one cup must be on the back row. The grid draws the back wall as a
  brown strip along its top; while the back row is empty the line under the title reads
  "⚠ Put a cup on the back row" and Done stays off. `match.rerackCustom` refuses it too.
- **The Gentleman's line is not a rerack** and keeps its own placement (front cup on the point).
- **Old challenges keep the old placement**: `rules.bk` (written on every new challenge) turns this
  on; a challenge made before has none and replays with the 2026-09-28 rule (front row on the
  triangle's point, custom anywhere), so its cups stand where its players saw them. `Match({
  backRack })`, default on; `presetsFor(n, back)`.

**The computer** takes Gentleman's whenever offered, reracks when a preset has at least 2 more
touching pairs than what is standing (a tidier target), and calls the first island it sees and aims
at it (`cpuOptions`, `cpuIsland`, `cpuPick`).

**The two ends of the table.** Your turn uses the fitted camera. The computer's turn glides the
camera to the other end, behind your own RED cups, looking back at it (the recording shows the
opponent's balls coming at you over your cups). Every rack and every throw is kept in the
SHOOTER'S frame; `render.js toWorld` turns side `a` (yours) half round for drawing. Physics never
needs to know whose throw it is.

**The spare ball**: while a pair still has a throw after this one, a greyed ball sits at the left
edge, as in the recording.

**The computer** (`js/cpu.js`) aims at a cup with the same launch point, angle, gravity and drag as
`physics.js`, then adds a Gaussian error to power and heading. Easy and Medium pick a cup at random;
Hard picks the cup with the most neighbours. The throw goes through the real physics, so its makes
and misses are real. **Measured** (`node cup-pong/js/test.js`, and 30-match simulations per
pairing, 2026-09-28):

| | sPower | sAim | make rate over whole matches | vs the next level |
|---|---|---|---|---|
| Easy | 0.30 | 0.080 | ~13% | lost 29 of 30 to Medium |
| Medium | 0.15 | 0.040 | ~20% | lost 29 of 30 to Hard |
| Hard | 0.06 | 0.025 | ~37% | won 30 of 30 against Easy |

Perfect aim (no error) lands in the cup it aimed at for all 10 cups. **Whether Easy loses to a new
player and Hard is hard is Matt's to say** - the sigmas are the only knob, in `SKILL`.

## Bounce shots (2026-09-28, brief 5d): OFF

**TURNED OFF by Matt, 2026-09-28, an hour after they shipped:** *"actually in real life you can hit a
bounced ball away from the table, preventing it from going into a cup. We won't be able to do that in
turn based multiplayer. so maybe we shouldn't include it."* Off everywhere, the computer included
(you cannot swat there either): **a bounced make is one cup, like any other.** Balls still bounce in
(that is physics). The rule below stays in `match.js` behind `bounce` (default **false**) and is on
only for a challenge stored with `rules.bo: true` - the few made while it was live (v1012), whose
logs may hold the owed cups a bounce made. `createGame` no longer writes `bo`. Do not turn it back on
without Matt.

What it did while it was on: a ball that touches the TABLE and then goes in counts for **2 cups**: the one it went in, plus one
the defender picks. `bounced` comes from the physics (`tableHits > 0` when the cup is made), never
a guess. In `match.js` it is one more "extra" cup beside island's, so **an island hit by a bounce
is 3 cups** (two picks).

- **Vs the computer**: you tap your cup ("Bounce! Tap one of your cups to remove", or "Tap 2 of
  your cups" for an island bounce); the computer picks its loneliest cup (`cpuPick`), as for island.
- **In a challenge** the extra cup is **OWED**, exactly like island (`owed[side]`, taken at the
  defender's next turn). Owed cups that are every cup left clear the rack at once.
- **Extra cups that are every cup left** (vs the computer): they all go, no pick (`extraCleared`).
- **Not in a rebuttal** (as island), and **never the last cup** with a ball still to throw (there
  is no second cup; the last-cup rule applies). Solo counts every make as one cup.
- **Frozen per challenge**: `rules.bo`, read only (see above). (`rules.bk`, the back-wall rerack
  rule, is frozen the same way - see "Every rerack stands against the back wall".) `Match({ bounce })`, default off.
- `test.js` asserts bounce-ins stay POSSIBLE (at least 5% of the soft-throw sweep; 89 of 403 on
  2026-09-28), so an arc change that loses them fails.


## Series and Straight up (challenges, 2026-09-30)

Matt: *"Make it so you can challenge someone to a series (same as connect 4 hoops). And add a
challenge mode that is "straight up" and has no gentleman's, no reracks, no balls back, no heating
up or fire, no bouncing. It's just 10 cups in the starting rack and whoever can get them all first
with no assists at all."*

- **The challenge screen** (`mp-ui.js terms`): Series (1 game / Best of 3 / Best of 5) and Rules
  (Classic / Straight up). Straight up hides the Gentleman's and Reracks rows and shows one line
  instead, since it has no assists to choose.
- **Straight up** is `rules.su` on the match and `Match({ straight: true })`: two balls a turn, a
  made cup is gone, the turn passes after both, and **the first side to clear the rack wins on the
  spot**. No Gentleman's, reracks, balls back, heating up / fire, island, bounce bonus, last-cup
  rule, rebuttal or overtime. **The "no rebuttal" part is a reading of "whoever can get them all
  first", not Matt's words** - confirm it with him if it ever comes up.
- **A series is Hoops' model** (hoops4/CLAUDE.md, "A series, and the terms of a challenge"): each
  game is its own match linked by `seriesOf`, with `series`, `seriesNo` and `seriesWins` (by SIDE)
  on the document, all OPTIONAL (an old challenge reads as a single game). `seriesAfter` is pure.
  The index rows carry `series`, `seriesNo`, `seriesOf` and `su`, so lists can say "Game 2 of 3 ·
  Straight up".
- **The next game is a BUTTON, only for whoever LOST the last one** (`seriesStarter`), so the two
  phones never both create it: on the Game Over card ("Start game 2") and in the multiplayer home's
  Your turn list; the winner sees "Series 1-0 · Ana starts game 2". `nextInSeries` swaps the sides
  AND the score (Hoops' 2026-09-23 bug), and whoever did not shoot first last game shoots first.
  When the other person shoots first, `createGame({ first: 'them' })` makes them side 'a' and writes
  both rows at once; otherwise the game reaches them when the first turn ends, like any challenge.
- **Straight up is impossible to miss** (Matt, 2026-10-01: *"Make it clear when you've been
  challenged to a straight up match. Maybe something written on the table? Something that comes
  across the screen?"*): a banner sweeps across the screen every time such a match is opened
  ("STRAIGHT UP / No assists. First to sink all 10 wins", `sweepBanner`, fades under reduced
  motion), the words are painted on the felt for the whole match (`render.setTableText`, one
  upright copy between the waiting ball and the rack; both camera views look the same way down the
  table, so a mirrored second copy read upside down and was removed), and the setup screen's Your
  turn row says "Straight up". The launcher bubble and the push text do not say it yet.
- The HUD's second line adds "Game 2 of 3" and "Straight up". A finished series' card offers
  Challenge again with the same rules and length.
- Verified in two browser profiles against the local stand-in database: the terms screen, a
  straight-up best of 3 created and stored (`su`, `gent: false`, `rr: 0`), no option buttons in
  play, the owed "Start game 2" for the loser and the waiting line for the winner, game 2 with the
  sides and score swapped, and both end cards. `test-cuppong-mp.mjs` plays a straight-up game to the
  end through the rules and starts game 2 (49 checks).

## Solo: clear the rack in the fewest throws (2026-09-28)

Matt: *"it'd be cool to have a solo mode or challenge mode where it's just the full rack and
there's a leaderboard for who can clear the full rack with the fewest throws. No reracks or
anything, no opponent."*

- **It REPLACED Practice** (same table, same 10-cup triangle): one ball a throw, no balls back, no
  heating up, no reracks, no islands, no opponent. Two buttons that played identically and differed
  only in whether it counted would be a choice nobody needs.
- **Only a CLEARED rack is recorded**, once, by `recordCupPongSolo(throws)` in `js/game-stats.js`.
  Giving up part way (New rack, Change settings, leaving) records nothing, so `isInProgress()` is
  `true` while a solo rack has had a throw and still has cups.
- **Stored in the `cp` sub-counter** of `games.cuppong`: `{ soloRacks, soloThrows, soloBest }`.
  `soloBest` is a FEWEST with **0 = never cleared** (Battleship's `fewestShotsWin` convention); a
  real clear is at least 10. All three surfaces of the three-edit rule: `ensureCp`/`recordCupPongSolo`
  (game-stats.js), `cupPongScreen` (My Stats: a Solo block above the vs-computer record), and the
  `cuppong` branch in `js/players-agg.js`, which takes the min of NON-ZERO bests only
  (`players-agg.test.mjs` pins it). Matches vs the computer stay in `total`/`byDiff`: a solo clear
  is not a win over anyone, so it never touches them.
- **The leaderboard**: Cup Pong's board has its own first sort, **Fewest throws** (`'fewest'` in
  `js/leaderboard-ui.js`, the way Skeeball has `'high'`), so the board OPENS on it. It lists exactly
  the people with a cleared solo rack, lowest first; equal bests share a rank, the one with more racks cleared drawn first; no tier
  chip and no difficulty filter (a solo rack has no difficulty). Wins / Games / Name still list the
  match players as before. The By Game row's leader is still the wins leader.
- The setup's Solo row shows your best on the right; the cleared card says **New best!** when that rack set it.

## The setup screen (2026-09-28, second layout)

Matt: *"the Solo option at the bottom is bad. There are too many words and it's still not clear what
it is."* Now Hoops' layout: **Your turn** (a card listing every match waiting on you, only when there
is one), **Multiplayer** (a card row with an arrow), **Play the computer** (difficulty, Gentleman's,
Reracks, Play), **Solo** (a card row: "Solo / Clear all 10 cups", your best on the right, an
arrow). The Reracks hint line went to keep it on one short phone (`check-no-scroll.mjs cup-pong`,
390x664). With the Your turn card showing it can scroll inside itself, contained, like Hoops'.

## Challenges: turn by turn, by player code (2026-09-28)

Brief 5b, built on Hoops' model with no code shared. Files: `js/mp.js` (data), `js/mp-ui.js`
(screens), `js/alert.js` (launcher), and the match itself in `js/ui.js` (`mpBegin` and the methods
under "CHALLENGES").

- **The node**: `cuppong/games/<id>` + `cuppong/index/<CODE>/<id>`. The challenger is side `'a'` and
  shoots first; the challenge is DELIVERED when the challenger's first turn ends (the other person's
  row is written then), Hoops' 2026-09-23 lesson.
- **A match is a LOG, never a snapshot.** Each entry is one action: a throw `{k:'t', p, a, m, b}`
  (launch vector AND the recorded cup it went in, `''` for a miss, bounced), Gentleman's `{k:'g'}`, a
  rerack `{k:'r', key}` (a custom one also carries `cells`), an island call `{k:'i', id}`, an owed cup given up `{k:'o', id}`.
  `validateGame` REPLAYS the whole log through `match.js` and refuses the whole document if any entry
  does not replay, or if the stored result is one the log did not produce (a resignation excepted).
- **Written as it happens, one action at a time** (`appendLog`, idempotent on retry, a log that has
  moved on differently is a conflict and never overwritten). A closed app loses nothing and cannot
  take a throw back. Unsent throws are kept in `gamehub.cuppong.outbox.v1` and sent before the match
  is next opened. The index rows change only when the turn passes or the match ends, which is what
  the push function watches.
- **Where a send goes in the log (fixed 2026-10-02).** Matt made two cups against King of Games and
  got "Could not send that" while the screen said "Sent!". The send's position (`base`) was counted
  when the match OPENED, so throws taken after watching the other person's turn land live were
  refused as "moved on". Now: `mpFlush` uses `applied - pending.length` (what the board has shown);
  `appendLog` steps past the OTHER side's entries after `base` (the full rules replay still has to
  accept the result, so nothing out of turn gets in); `drainOutbox` keeps refused throws (only an
  over match drops them); and the waiting line says "Not sent yet" while any are unsent.
- **Replay**: opening a match shows the other person's latest run of actions with real flights from
  their vectors; **the recorded outcome decides each one**, whatever the local flight does (brief 5b).
  How far this phone has shown is `gamehub.cuppong.shown.v1`. While it is their turn the match is
  WATCHED, so their throws play out live.
- **This phone is always side `'a'` locally** (`buildLocal`, `toLocal`/`toStored`): its own red cups
  near the camera, whichever side it holds in the stored match.
- **The island in a challenge: the second cup is OWED** (Matt chose it, 2026-09-28: "They pick at
  their turn"). `match.js` `async: true` counts `owed[side]`; at the start of their next turn the
  owing player taps one of their own cups before anything else (`askOwed`, "Tap one of your cups to
  give up"). If the owed cups are every cup left, the rack is cleared on the spot (then the rebuttal).
  Bounce shots used the same mechanism while they were on (see "Bounce shots").
- **Rules are frozen per challenge**: Gentleman's and Reracks are chosen on the challenge screen
  (defaults from your own setup) and stored on the match.
- **Results**: `recordResult('cuppong', 'mp', won)` once per phone, whoever ended it
  (`gamehub.cuppong.counted.v1` ledger, Hoops' "counted on BOTH phones, exactly once"). A match that
  ended while you were away shows a GAME OVER popup (`gamehub.cuppong.unseenResults.v1`) and the
  launcher's 'over' bubble.
- **Quit** (pause menu) is a resignation: asks first, counts as a loss, deletes nothing.
- **Screens**: Multiplayer home (Challenge someone, Notify me while off, Your turn, Their turn,
  History), the picker (by player code, Hoops' `opponentsFrom`), the terms screen, History (record
  per opponent by code, each finished match with a word and a mark).
- **Launcher**: `js/hub.js`'s Cup Pong entry declares `alerts: () => import('../cup-pong/js/alert.js')`
  (a third registrant after Hoops and Skeeball). A tapped bubble or notification opens that match
  (`armOpen`/`takeOpen`, sessionStorage `gamehub.cuppong.open.v1`).
- **Push**: `cupPongTurnPush` on `cuppong/index/{code}/{id}`, deciding from the row alone
  (`decideCupPong`: a challenge, your turn, "rebuttal time", they won / they quit; never your own
  write, via the row's `lastBy`). The payload carries `match`, and `sw.js` also reads a
  `cuppong-<id>` tag.
- **Rules: PUBLISHED by Matt on 2026-09-28** (the full file from main, with `"cuppong"` added).
- **`cupPongTurnPush` DEPLOYED by Matt on 2026-09-28** ("deploy complete", from his laptop, the
  other four functions updated in the same run). A real phone-to-phone notification is not yet
  confirmed.

Verified 2026-09-28 in two separate browser profiles against a local stand-in for the Realtime
Database (the sandbox cannot reach Firebase): challenge, delivery on turn end, the replay, live
turns both ways, the launcher bubble, a notification-style `?open=cuppong&match=<id>` load, a
seeded island leaving Ana owing a cup and her giving it up, a quit, and the result counted once.
Real Firebase on real phones is unverified. `node test-cuppong-mp.mjs` covers the data layer
against an in-memory database (49 checks, the custom rerack and a series included).

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../cup-pong/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `cuppong`, **no `released` date** (Matt releases it from the admin page; that day gets the date) |
| Stats id | `cuppong`: plain `recordResult('cuppong', difficulty, won)` once per finished match vs the computer, difficulty `easy`/`medium`/`hard` (`mp` is reserved for challenges, stage 5). Solo racks: `recordCupPongSolo(throws)` into the **`cp` sub-counter** (see "Solo"). Registered 2026-09-28 in `js/game-stats.js` `GAMES`, `js/leaderboard-ui.js` `GAME_META` (on the board even while admin-only, `OFF_THE_BOARD` stays empty) and `js/game-stats-ui.js` `TABS` (devOnly, Air Hockey's shape), label `game_title_cuppong` in `js/strings.js` |
| CSS root / prefix | `.cp-root` / `.cp-` |
| Settings key | `gamehub.cuppong.v1`: `{ diff, gentlemans, nextFirst }` - preferences only, saved on every selection. `nextFirst` alternates after each finished match (the repo's turn-based default) |
| `isInProgress()` | the NO MID-GAME RESUME meaning (Hoops' class): `true` while a match vs the computer has had a throw and is not over, because a match is not persisted; same for a solo rack with a throw taken and cups left. A challenge answers `false`: it lives in Firebase |
| Tile art | `GAME_ART.cuppong` in `js/game-art.js` |
| Strings | `js/strings.js`, `{ en, es }`, `makeT` at render time |

## Files

| File | Role |
|---|---|
| `js/geom.js` | every size, once, in metres: table, cup, ball, the throw band, the camera. Pure |
| `js/rack.js` | **the rack model** (below). Pure |
| `js/physics.js` | the ball, simulated by cannon-es (`skeeball/js/vendor/`, not copied). DOM-free |
| `js/render.js` | three.js scene from `geom.js`'s numbers |
| `js/ui.js` | the shell, the flick, the loop, the module contract |
| `js/strings.js` | EN/ES |
| `js/match.js` | **the rules of a match**, pure: turns, balls back, heating up / on fire, rebuttal, overtime, Gentleman's. Everything comes back as events |
| `js/cpu.js` | **the computer**, pure: aims with the same ballistics, misses by a skill-sized Gaussian error |
| `js/mp.js` | **challenges**: the `cuppong/` node, log validation by replay, verified writes, the outbox, ledger, seen/shown maps |
| `js/mp-ui.js` | the multiplayer screens (home, picker, terms, history, Game Over popup). DOM only |
| `js/alert.js` | the launcher's bubble for challenges (`check`/`watch`/`armOpen`) |
| `js/test.js` | `node cup-pong/js/test.js` - ~50 checks, ~25 s. Not in `sw.js` (dev only) |
| `css/cup-pong.css` | every rule under `.cp-root` |

## The rack is a set of hex cells (brief 4c: "build this first")

`js/rack.js`. A rack is `[{ id, c, r }]`. The grid is **doubled-width hex coordinates**: `r` is the
row (0 = furthest from the shooter), `c` counts HALF cup-widths, and a cell is real only when
`c + r` is odd - that parity is what shifts every other row by half a cup. The pitch IS one cup
across (plus 2 mm, so two cups' collision walls never overlap), so neighbouring cells are
touching cups. `cellXZ` turns a cup into table metres; the physics and the renderer only ever see
`{ id, x, z }` from `cupsXZ`. A cup keeps its id (`k0`..`k9`) for the whole game; a rerack will
move ids to new cells.

**A cup may instead sit at an exact SPOT, `{ id, u, v }` in cup-widths.** Straight lines toward the
shooter cannot live on a hex grid (touching cups one behind the other are 1 cup-width apart along
the table; hex rows are 0.866 apart), and that covers the Gentleman's and the Line presets. Matt,
2026-09-27: *"do whatever you have to do so that these racks are possible and look correct and are
placed correctly."* So `line2` (the Gentleman's), `line3` and `line4` are spots: centred, touching,
front cup exactly where the triangle's point stands, except `line4`, which is deeper than the
triangle and so has its back cup on the back row instead. `validRack` checks overlap and the area in
METRES, so cells and spots are checked against each other correctly. Custom racks (stage 3) snap to
cells; only the line shapes need spots.

`AREA` (|c| <= 5, r 0..4) is the rack area. The triangle is `PRESETS.tri10`.

## The throw (rebuilt 2026-09-27 from the recordings)

- **The ball waits ON THE TABLE at mid-court** (z = 0), where the recording serves it - not in the
  air in front of the camera.
- **The flick is skeeball's** (`skeeball/js/swipe.js`, imported, never copied): speed in
  screen-heights per second clocked with `e.timeStamp`, and its measured natural range
  (`SWIPE_SLOW` 0.65 -> power 0, `SWIPE_FAST` 4.20 -> power 1). Power is NOT clamped.
- **Power -> launch speed** is `THROW.minSpeed`/`maxSpeed` (1.87 / 3.64 m/s), interpolated as energy
  (v^2), at a fixed 1.00 rad under `GRAVITY` 6.5. Power 0 lands ~0.46 m on, power 0.55 reaches the
  middle of the rack, power ~0.65 and up flies off the end. The rack spans roughly power 0.35-0.65.
- **THE ARC WAS FITTED TO THE RECORDING, and it took three builds (2026-09-27/28).** The GamePigeon
  ball is a HIGH, FLOATY LOB: at 15 fps it climbs ABOVE the rack on screen, peaks over the front
  cups around frame 8, and drops in at ~0.67 s. Build 1 designed an arc with no reference; build 2
  read that peak as an overshoot and flattened the throw to 0.55 rad (Matt: *"It goes too low. It's
  like a straight line and I can barely get it to hit the top of a cup"*). Build 3 fitted launch
  angle, speed AND gravity to 11 frames of the ball's screen path, with one extra constraint: the
  ball must be AT THE RACK when the recording shows it there. **Without that constraint the fit
  cheats** - from this steep camera a near-vertical toss that never leaves mid-court traces the
  same path up the screen. Result: 1.00 rad, 3.05 m/s, gravity 6.5, every frame within ~0.02 of
  the screen, and the same trace measured again in the real browser matches.
- **Gravity is 6.5, not 9.81, on purpose** (`GRAVITY` in `geom.js`). No real-gravity arc matched
  both the path and the timing. Do not "correct" it.
- **AIM FOLLOWS THE FINGER** (`aimFromSwipe` in `ui.js`). The flick's direction on screen is carried
  up from the waiting ball to the rack's row on screen, that point is unprojected onto the table,
  and the heading is the line from the ball to it. A flick that points at a cup sends the ball at
  that cup, on any phone. The first build multiplied the flick's angle by 0.24 instead, so the
  ball went somewhere other than where the finger pointed.

**If the throw still feels wrong**, in order: `minSpeed`/`maxSpeed` (everything short or long),
`elev` and `GRAVITY` together (too flat, too loopy, too quick or too slow) - and re-fit to the
recording rather than guessing; the fitting scripts are described above. Aim has no knob any more: it is where you point. The "Power / Aim"
line bottom right shows the last throw so a report can quote numbers; remove it once the throw is
settled.

**Measured in a real browser:** scripted touch flicks through the real pad throw the ball, and aim
follows the flick. The harness CANNOT measure power: SwiftShader delays each synthetic touch event
by 35-200 ms, so every scripted flick reads as a slow push. Only a real hand can judge the band.

## The physics

- **Real geometry.** Each cup is ONE static body holding 20 wall boxes round a cone (9.5 cm top,
  6 cm base, 12 cm tall), 40 small spheres along the rim so it is round to the ball, and a base.
  The table is a box. The ball is a 40 mm, 2.7 g sphere.
- **Made = all of the ball below the rim plane, inside the wall.** Nothing gets there except over
  the rim, because the walls are solid. It is decided, never predicted.
- **1/480 s step, not skeeball's 1/240.** At 1/240 a fast ball can move past a 6 mm wall's
  mid-plane in one step and be pushed out the wrong side, through the cup.
- **Air drag** (quadratic, `DRAG_K`) and **rolling resistance** on the table (`ROLL_DECEL` in
  `physics.js`). Without the second, a slowly rolling miss never stopped and ran to the 6 s cap.
- A throw ends as `made` (with `bounced`: it touched the table first - one cup, see "Bounce shots"), `off`
  (fell off the table) or `miss` (came to rest, including on top of the cups).
- **No magnetism, ever** (skeeball's ban). Nothing steers the ball.

Measured on the lob (build 3), 858-throw power x aim grid over the full rack: every one of the 10
cups is made, ~20% of the even sweep scores, and plenty of throws touch a cup and stay out; none
reaches the time cap.

**BOUNCE SHOTS (2026-09-28).** Matt: *"It's impossible to bounce the ball in."* Measured on a
power sweep: a ball only bounced in when it first landed within ~30 cm of the front cup; land any
shorter and the rebound carried it over every cup. Two levers were measured, not guessed: **table
grip does nothing** (0.22 vs 0.5 vs 0.8, identical to the throw), and **less bounce is worse**
(0.65 halved the bounce-ins, 0.45 made them zero - the ball cannot get back over a 12 cm rim). More
bounce widens the band: `MAT.tableRest` 0.78 -> **0.88** (a ping pong ball on a hard table really
is ~0.9) makes landings up to ~50 cm short bounce in, and soft throws that bounce in went 40 -> 89
of 403. Direct scoring barely moved. `test.js` prints the bounce count as `info`; stage 4 (bounce
shots count double, brief 5d) turns it into an assertion.

**The table's bounce, turned DOWN (2026-10-02): `MAT.tableRest` 0.88 -> 0.65.** Matt asked how much
likelier a bounce shot is to go in, counting only balls that come down ONTO the cups (first cup
contact at the rim, or a clean drop) on a full rack: bounced 47.8% against regular 41.9%. Told the
number, he said *"Why didn't you fix that??"* - a bounced ball must not beat a regular throw. Swept
on the same 7,881-throw grid (regular throws 950/2267 = 41.9% at every value):

| tableRest | bounced balls that went in | vs regular |
|---|---|---|
| 0.88 (was) | 942/1969 = 47.8% | 1.14x |
| 0.75 | 696/1342 = 51.9% | 1.24x |
| 0.70 | 485/1172 = 41.4% | even |
| **0.65 (shipped)** | **334/926 = 36.1%** | **0.86x** |
| 0.60 | 204/687 = 29.7% | 0.71x |
| 0.45 | 0/198 | impossible again |

Not monotonic, so never interpolate: re-measure (`rim-grid` probe, described here, run per value).
Bounce-ins stay possible but rarer (soft-throw sweep 16 of 403, was 89); `test.js`'s floor is now
2%. The computer and regular throws are unaffected. Solo bests already set stand as they are.

**Closer to even (2026-10-03): `tableRest` 0.65 -> 0.68, plus `tableSkid` 0.9.** Matt: *"Make a
bounced ball closer to a regular throw."* **The grid above was misleading**: a regular grid of
throws at regularly spaced cups ALIASES, and random throws put 0.65 at 0.80x, not 0.86x (and a
6-cup rack at 1.12x). `tableFric` changes nothing on a bounce in cannon-es, so a new lever:
`MAT.tableSkid`, the share of forward speed a ball keeps through each table bounce (physics.js's
collide handler), which is what lets a bounced ball drop into a small rack instead of skimming it.
Measured with random throws at random leftover racks (1-10 cups), only balls that come down onto
a cup, regular throws untouched at every setting:

| tableRest / skid | bounced vs regular (seed 777, 40k) | (seed 4242, 80k) |
|---|---|---|
| 0.65 / none (was) | 0.80x | - |
| 0.65 / 0.9 | 0.86x | - |
| **0.68 / 0.9 (shipped)** | **0.91x** | **0.98x** (every rack size 0.92-1.05x) |
| 0.70 / 0.9 | 0.97x | 1.01x (too close to "more often") |

Probe: random throws (power -0.30..0.80, aim +-0.14) at a random 1-10 cup subset, mulberry32
seeded. **Never use `(seed * 1103515245 + 12345) & 0x7fffffff` in JS**: the multiply passes 2^53
and the stream is garbage (it moved the full-rack result by 6 points).

**Bounce better (2026-10-03, later): `tableRest` 0.95, `tableRestLater` 0.68, `tableSkid` 0.6.**
Matt: *"Feels like more than 4% less"*, then *"I want the ball to bounce better."* He was right:
the table above counts only balls that come DOWN onto a cup. Counting every ball that touches a
cup at all, 2 in 3 bounced balls hit a cup's SIDE (a low ball skimming off the table) against 1 in
8 regular throws, and a bounce went in 11% against 28%. The ball now leaves the table steeper (a
livelier first bounce that keeps 60% of its forward speed); every LATER table bounce is dead
(0.68), or a ball dribbling on a 0.95 table hit the 6 s cap. Every-touch counting, random racks:

| setting | bounced | regular |
|---|---|---|
| 0.68 / skid 0.9 (was) | 11.1% | 28.4% |
| **0.95 / 0.6 + later 0.68 (shipped)** | **24.7%** | **29.1%** (10 cups 33/38, 1-3 cups 17/20) |

Swept tableRest 0.80-1.0 x skid 0.4-0.9: nothing realistic passed ~0.90x (1.0 is a perfectly
elastic table). Side effect, accepted: counting only balls that come down onto a cup, a bounce now
goes in MORE (42% vs 33%). `test.js`'s "not a gimme" check was split: regular makes under 25% of
the sweep (18.6%), everything under 30% (25.2%; bounce-ins went 19 -> 56 of 858).

## The look and the camera (fitted to the recording, 2026-09-27)

**The camera is FITTED, not designed.** `CAMERA` in `geom.js`: 1.305 m above the table, over
z = 0.803 (the near half), pitched 44 degrees down, 41.8 degree vertical field on a 1:2 screen. A
search over camera height, distance, pitch, field, table width and serve spot matched seven things
read off a GamePigeon frame: where the far edge sits (22% down), how wide it is (79% of the
screen), where the side edges leave the screen, where the ball sits (82% down) and how big it is,
where the rack's point and back row sit, and the rack's width (46%). `resize()` keeps that WIDTH
on a taller phone and that HEIGHT on anything wider.

**The table is 0.72 m wide**, not a real 0.61: the same fit says GamePigeon's table is wider
relative to its cups, and this is a clone of that.

The rest, from the recording: green felt (matte - a specular one washed out to grey) with a white
border and a white centre line down its length and NO crosswise line; the opponent's cups BLUE
(`LOOK.cups.blue`; your own will be red) with white insides that glow slightly so they read white;
a striped brown wall over a strip of dark panelling behind the far end (an UNLIT backdrop, because
the key light stands behind it); a pale plank floor just below the table, so it shows beside the
far end; black legs; the light high behind the far end on the right, so shadows fall toward the
player's left. **The inside of a cup is SHADED** (a gradient, light at the rim to dark at the
bottom, `_insideTex`): Matt, 2026-09-28, *"they almost look like they're filled solid with white"* -
the first cut lit the inside a flat white. **A made cup lifts out and is carried off** up and to the right, fading - not a
sink. No word pops up for a make or a miss (GamePigeon shows none; "Balls Back" is stage 2).

Headless Chromium is SwiftShader, so `render.js` turns shadows off there: screenshots from the
container never show them. A phone does. **`window.__cpHardGL = true`** (set before the game loads) forces the real
renderer anyway, shadows included, for a screenshot probe; the game never sets it.

## Tests

- `node cup-pong/js/test.js` - the rack model, the rules of a match, the computer and the real physics.
- `node test-game-conventions.mjs` - the shared checklist.
- `node check-no-scroll.mjs cup-pong` - no game in the hub may scroll.

## The Tuesday question (a joke for one player, 2026-10-03)

Matt: *"anytime King of games plays me back, it says Tuesdays > Mondays then asks yes or no, but
the no button doesn't work. when he clicks yes, it says Correct! then he can shoot."* `TUESDAY` in
`ui.js` (King of Games `3VN33`, only in matches against Matt `QZCC4`): `mpResume` asks before his
turn (`askTuesday`), keyed per match and log position so it shows once per turn (again on a
mid-turn reopen). "No" only shakes. Nothing is written anywhere; delete `TUESDAY`, `tuesdayOwed`,
`askTuesday`, the `.cp-tuesday` CSS and the `tuesday*` strings to retire it.
