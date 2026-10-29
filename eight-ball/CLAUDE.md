# Pool — eight-ball/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

Pool, played the Flick Soccer way. Matt, 2026-10-22: *"Flick soccer is a great game. Please
make a Pool game that functions similarly. Admin only for now."* Its shape is Flick Soccer's
(`flick-soccer/CLAUDE.md`): own deterministic physics, pull back and let go, a computer that
SIMULATES its candidate shots, autosave with the rolling shot replayed, one setup card, aiming help
by difficulty.

**Stage 1 (live 2026-10-22, Matt's second review the same day):** three games (8-ball, 9-ball,
Cutthroat for three), three options (call shots, banks only, bar obstacles), a real numbered ball
set with a simple look, scoreboard trays, ball-in-hand lock-in, real pocket proportions, the
slingshot pull (since replaced by GamePigeon's table and meter). **Stage 2 (live 2026-10-22): turn-based online challenges, two OR THREE players**
(below, "Online challenges"). **Still to come (Matt's plan):** Stage 3 live rooms (3 seats for
Cutthroat; `js/net.js` N-seat), Stage 4 push notifications (no push function yet: a challenge
reaches the other phone through the launcher bubble and the Multiplayer screen only). Online quick chat is required (root CLAUDE.md). Ideas offered to Matt, not asked
for yet: Killer (2-6 players, lives), trick shot of the day, shot clock, replay of their shot.

## Not the archived Pool

`archive/pool/` is an older, different Pool (archived 2026-09-28). **This game reuses none of its
ids**: folder and hub id `eight-ball`, stats id `eightball`, keys `gamehub.eightball.*`, prefix
`.ep-`. The old `'pool'`/`'poolv2'` stats and `gamehub.pool*` keys stay that game's (THE LAW rule 5).
Its palette IS reused on purpose: Matt asked for that friendly look in 2026-08
(`reference/pool/SPEC.md`: pastel surround that is the turn colour, warm wood, bright cushion, flat
black pockets, coral and cyan groups).

## Hub integration

- **Test release (2026-10-23, Matt: "release this for Anita Bonita only"):** the admin page's Pool row
  has the WHO CAN SEE IT picker (`ALLOW_PICKER` in `js/admin-ui.js`); Matt taps her in
  (`adminConfig/v1/games/eight-ball/allow/<CODE>`; her codes K99MB, newest, and 89N3N). Still devOnly.
  Leaderboard stays difficulty-first with MP and level tabs (Matt: "of course differentiate by
  difficulty and mode").
- In-hub `module: '../eight-ball/js/ui.js'`, **immersive**, released 2026-10-26 (`released: '2026-10-23'`,
  the admin switch day). `GAME_META`, My Stats tab and `game_title_eightball` ship
  with it, so results recorded before release show the moment it is released.
- `isInProgress()` is `false`: the match is saved at every rest (`gamehub.eightball.save.v1`) and the
  setup card offers Continue. The shot is saved WITH the position the moment it is taken, so a kill
  or reload mid-roll replays that same shot on Continue; leaving through the menu plays it out first
  (`_settleNow`). A shot can never be taken back.

## Files

| File | Role |
|---|---|
| `js/engine.js` | table, balls, physics (`step`, `runToRest`), rules (`settle`, `nextRack`), aim geometry. Pure, deterministic |
| `js/ai.js` | the computer: ghost-ball candidates per target x pocket, each simulated with `play`; a generator run in slices |
| `js/render.js` | canvas: table (cached), balls, cue stick, aim guide, ball-in-hand marker, pot bursts; `ballSVG` |
| `js/ui.js` | setup, play screen, input, ball in hand, spin pad, turn flow, menus, autosave, stats, `window.__epTest` |
| `js/strings.js` | EN/ES |
| `js/mp.js` | online challenges: the node, validation by replay, verified writes, the outbox, counting once |
| `js/mp-ui.js` | the online screens (home, picker, challenge card, history, Game Over), lazily imported |
| `js/alert.js` | what the launcher says about challenges (bubble, Multiplayer count, armOpen/armChallenge) |
| `js/test.js` | `node eight-ball/js/test.js` (~30 s; not precached) |
| `css/eight-ball.css` | all styling, `.ep-root`-scoped, dark-mode token block at the end |

## The games (`settle` in engine.js; seats 2, 2, 3)

- **8-ball**: solids 1-7, stripes 9-15. Open table until the first COUNTING pot; that ball's group
  is the shooter's. **Rules 3 (2026-10-24, Matt: Moonis sank a solid off the break, "it says table
  open. Fix"): a clean break that pots a ball decides it too** (the first one in); rules 1-2 matches
  keep the WPA open table after the break. **Moonis's match** `mvltredyw03dt73j` (rules 2) was hand-fixed the same day (Matt: "just give
  him solids and the one he sank"): the doc's optional `fix: { after: 2, groups: ['b','a'] }` (`mp.js`
  `fixAfter`) decides the groups after that many shots, nothing else; backup taken first. The 8 must be called (always); it wins only as your target,
  clean and in the called pocket; otherwise you lose the rack. 8 on the break wins (loses with a
  scratch).
- **9-ball**: 1-9 in a diamond (1 front, 9 middle). First contact must be the lowest ball (the
  break too). Pot anything and go again; the 9 wins whenever it counts (combos, the break). A 9
  that drops on a foul or without counting is spotted.
- **Cutthroat** (3 players): seat 0 owns 1-5, seat 1 6-10, seat 2 11-15 (FIXED, not chosen by first
  pot: a simplification; tell Matt if he expects otherwise). Pot someone else's and go again; your
  own stays down and ends the turn. All 5 down = out (struck through on the scoreboard); last one
  in wins. A foul also brings one potted ball of each OTHER player back (spotted), which can bring
  an out player back in. Rack: 1 front, 6 and 11 in the back corners.
- **Fouls, every game:** cue ball potted; nothing hit; 8/9-ball also the wrong first ball.
  **No "no cushion" foul since RULES 2 (2026-10-23, Matt: "it shouldn't be a foul... drop it")**:
  each match keeps its rules version `rv` like its table (`RULES_NOW`; none = 1, where a shot that
  pots nothing and sends no ball to a cushion after the hit is a foul, WPA 6.3), online docs too. A foul = ball in hand anywhere for
  the next player. Turn order skips players who are out.
- **A pot only COUNTS** (keeps the turn, decides a group, wins with the 8/9) if it went into the
  called pocket when one was needed, and with banks only if it bounced off something first
  (`ev.kiss[i]`: a cushion, an obstacle or another object ball; or the cue ball kicked off a
  cushion before its first hit, `ev.cueRail`). A ball that drops without counting stays down.
- **Options** (`m.opts`): `call` (tap a pocket before every shot), `bank`, `obst`. Racks to win
  1/2/3; the break passes seat to seat, rack to rack and match to match.

## Physics (engine.js) — correctness-critical

- Only `+ - * /` and `Math.sqrt` on the physics path (cross-device determinism for the online
  stages; Flick Soccer's reasoning). The rack shuffle and the obstacles are integer xorshift from
  `m.seed`.
- **TABLE VERSIONS (2026-10-22).** Every match stores `tb` (none = 1) and keeps it to the end;
  `useTable(tb)` swaps the live `R`, `CORNER_G`, `SIDE_S`, `SEGS`, `POCKETS`, `TABLE` bindings, and
  every engine function taking a match calls it first (ui.js also each frame). Never change a
  table in place: an online match replays its log, so add a version. `test.js` pins a table-1
  replay to its pre-version fingerprint. Online docs carry `tb` too (`termsOf`; none = 1).
  - **Table 1** (the first): a 7-foot bar table, `R` 2.8, real WPA mouths (corner 2.05 balls, side
    2.2), holes `HOLE` 5.4 centred on the cloth's corners; a ball drops when its centre is over the
    hole or past the jaw line.
  - **Table 2** (live 2026-10-22 evening only, kept for matches started on it): a first measure
    of GamePigeon's that read the cushions' back edge as their end; its jaws were narrower than a
    ball, so a ball dropped before reaching the black (`rp` +2.8 corners, +1.0 sides). Matt: "make
    sure the invisible hole of the pocket matches the visual and that it doesn't suck balls in".
  - **Table 3 = GamePigeon's, measured at full size (2026-10-23)**: cloth 717 x 1444 px, ball 42,
    holes 84 (exactly 2 balls), cushion 30, wood 77; corner hole centres 21.5 px out past the cloth
    corner, side holes touching the cushion line; cushion noses end 47 px from a corner and 45 px
    either side of a side pocket, their backs 30 / 39 px, with the angled jaws between them as
    segments (`jawSegs`). **A ball drops only when its centre is over the black** (`rp` = `r`); one
    can hang in the darker mouth cloth. Measured catch width (scratch sweep, power 0.35): corners
    0.8-0.9 balls, sides 1.4 straight in, 0.4 at 60 degrees (tighter than table 1's real WPA
    mouths).
  - **Table 4 (2026-10-23, live an hour)**: table 3 with balls **25% bigger than GamePigeon's** (Anita, test
    playing: "these balls are very very tiny"; Matt: "do both. Just get it right"): ball 52.5 px of
    717 (7.3% of the cloth's width, ~13.7 across), holes still 2 balls, mouths and jaws scaled with
    the ball, cushions/rails/cloth unchanged; the rack has GamePigeon's small gaps (`rackGap`, 6% of
    a ball), obstacles kept further off it (`rackMid`, `rackKeep`). Catch width in balls is table
    3's. (Measured both racks at one scale: GamePigeon's ball IS 5.9% of its cloth, its number circle
    ~57% of the ball like ours; its loose rack made the balls look bigger.)
  - **Table 5 (2026-10-23 to 26)**: table 4's balls and rack on table 3's pockets, which are
    GamePigeon's exactly in proportion to the TABLE (Matt: "they seem too big still. measure the
    pockets in proportion to the table"; table 4 had scaled them with the ball, 25% too big). Hole
    84 px of 717 = 11.7% of the cloth's width (1.6 of our balls). Measured on screen at one scale:
    side opening 76 px, GamePigeon's 74. Harder than GamePigeon's (bigger balls, same holes): catch
    width corners ~0.4 balls, sides ~0.9 straight in; matches take ~2x the shots; Hard beat Easy in
    9-ball 5 of 8 (8 of 8 in 8-ball and Cutthroat), so `test.js` plays 8 games per level now.
  - **Table 6 (2026-10-26, live an hour)**: table 5 with the pocket MOUTHS opened halfway to GamePigeon's fit
    (Matt's 14, aimed at the hole's centre vs Ana, rattled off the far jaw; "make it better but not too
    easy"). Table 5 kept GamePigeon's noses in table pixels, so with our bigger ball the corner mouth was
    1.27 balls (GamePigeon 1.58), the side 1.71 (2.14). Noses and jaw backs moved out 12.5%: corner 1.42,
    side 1.93; holes and balls unchanged. Catch straight in: corners 0.64 balls (5: 0.46, GamePigeon
    0.83), sides 1.17 (0.95, 1.37). Option C (GamePigeon's 1.58) was shown to Matt and not chosen.
    For reference, a WPA table's mouths are ~2.0 (corner) and ~2.25 (side) balls.
  - **Table 7 (2026-10-26, today's)**: table 6 with hits taken AT THE MOMENT OF CONTACT (`TABLE.ccd`;
    Matt: "something was/is wrong with the game that you are not seeing"). Tables 1-6 bounced two balls
    from their OVERLAPPED centres (a step moves a ball up to ~2 units), which bent every cut shot: on
    table 5 at 60% power a 30-degree cut went ~1.8 degrees off (up to 3.8), at 80% a 45-degree cut ~5
    (up to 9), full power up to 17; straight shots were exact. The ghost-ball guide was right, the
    physics was not, so aimed balls missed; the computer never noticed (it simulates). `hitAtContact`
    winds both balls back to first touch, bounces there, moves on; cushion TIPS (jaw points) the same
    in `bounce(..., atTouch)`. Measured after: 0.00 degrees at every power and cut. Same mouths as 6.
  - `test.js` pins tables 1-6 to their old fingerprints (5 and 6: a real 31-shot online match), and
    checks table 7's object ball follows the guide exactly. Whole table on screen,
    `SIDE_K` 11.5% of the width free each side.
- `DT` 1/240, `MAX_SPEED` 400 (the break x1.35 = 540, ~2.25 a step, under `R`): nothing tunnels.
- Skid then roll: each ball carries `r` (the speed its spin would roll it at). A centre hit starts
  with no roll and the cloth turns skid into roll (5/7 rule); collisions swap only `v`, so the cue
  ball follows or draws naturally. Spin (-1 draw .. 1 follow) sets the cue ball's starting `r`.
- **Obstacles** (`makeObstacles`, from the rack seed): a spill (slows a ball crossing it) and two of
  a bottle lying down (capsule), a can (circle), a cigarette butt (thin capsule); bounce `E_OBST`
  0.6; kept clear of the rack, the head spot, the pockets and each other; never under a placed cue
  ball. Re-made each rack.
- `settle` nudges any two balls left a hair inside each other apart (`relax`).

## The screen

- **GamePigeon's controls (2026-10-22, replacing the slingshot):** a touch or drag on the table
  TURNS the cue round the cue ball by as much as the finger turns round it (2026-10-23, Matt's video
  of GamePigeon: "spin it around fully so you can drag from either side"). The turn = the finger's
  movement across the line to the ball over its distance, never under `AIM_NEAR_PX` (90), so close
  to the ball it turns slower; the first `AIM_DEAD_PX` (8) of wobble is ignored, so a tap never
  moves it (Matt: "it's jumping all over the place when I tap"). Each turn starts aimed at the
  nearest legal ball. The power is a
  meter LEFT of the table (`.ep-meter`, 47% of its height): drag DOWN from anywhere on it, let go to
  shoot, drag back to the top to cancel. Dimmed when it is not your shot. The cue on the table
  draws back with the power. Hard still shows the cue (no lines).
- **Ball in hand:** Easy, a touch ON the cue ball picks it up until the shot. **Medium, Hard and
  players sharing a phone must lock the spot in** with the green tick beside the ball (Matt: "in
  medium or hard you should have to lock in where you put the ball"); until then a drag ANYWHERE
  moves the ball. A spot that is not allowed shows a dotted white ring; letting go snaps to the
  nearest legal one (`nearestPlace`).
- **Calling:** while a call is needed the pockets pulse; a tap on one (generous: hole + 16px) calls
  it, another tap changes it. **Marks are drawn ONLY on the rail and cap behind a pocket** (clipped
  outside the cushion line; Matt, 2026-10-24, on the old ring and inward arrow: "all of it is in the
  way"): the called one a thick yellow ring round the back of the hole + a yellow chevron on the cap
  pointing at it; the others a pulsing dashed white ring; the meter does not shoot until a pocket is called. The
  computer shows its call while it aims.
- **Aiming help** (`AIDS`, Matt 2026-10-22): Easy = line to the first thing the cue ball meets, a
  ghost ball there, and the hit ball's path, short and FADING out (a hint, not the whole shot);
  Medium = line and ghost ball; Hard = nothing but the cue and the power ring. Easy and Medium also
  ring the balls you may hit first (not in Cutthroat: every ball is legal). Sharing a phone = Medium.
- **Balls**: a real set (1 yellow, 2 blue, 3 red, 4 purple, 5 orange, 6 green, 7 maroon, 8 black,
  9-15 striped), every ball's number in a white circle (Matt: "mostly just the number in a
  circle"). **Simple look** (setup card, ball pictures): one colour per group, number kept
  (8-ball coral solids / cyan stripes; Cutthroat the hub's yellow, blue, vermilion). 9-ball is
  always classic. `ballPaint` in render.js.
- **Scoreboard** (Matt: "a better indicator of what ball you are" and "how many you've gotten vs
  how many you have left"): one card per player; row one face, name, a white chip SOLIDS /
  STRIPES / THE 8 (hidden with three players: the numbers say it); row two that player's balls,
  potted ones faded and TICKED, the 8 after a divider. 9-ball: one shared row 1-9 under the cards,
  the next ball ringed and bigger. Surround = GamePigeon's soft grey (2026-10-23; was the turn
  colour), dark grey in dark mode; whose turn it is shows on the scoreboard.
- **The table's look (2026-10-23, Matt: "copy this one exactly... add texture to the felt")**:
  `render.js` `tableLayer`, GamePigeon's colours (`TABLE_ART`): grained mahogany rails, cream stone
  caps, cushions shaded across their width, felt with pixel grain and darker edges, darker cloth in
  each mouth, shadow under the table; balls lit from the top left with a soft shadow. Every table
  version is drawn this way.
- Spin pad (top / back), FOUL / OUT / "X wins the rack" banners. Names are profile names (pass and
  play: "Player 2", "Player 3"; the computers: the profile's first two opponents). No sound.

## Settings and storage

| Key | What |
|---|---|
| `gamehub.eightball.v1` | `{ game: '8'|'9'|'ct', mode: 'cpu'|'pass', difficulty, racks, opts: {call, bank, obst}, look: 'classic'|'simple', nextBreaker }` (game/opts/look added 2026-10-22, absent read as 8-ball, off, classic) |
| `gamehub.eightball.save.v2` | `{ mode, diff, match, shot? }` at rest (match v2: `mode`, `n`, `opts`, `out`, `obs`); removed once won |
| `gamehub.eightball.save.v1` | the first build's save (v1 match shape), **no longer read, never deleted** (rule 5) |

## Stats

`recordResult('eightball', difficulty, won)`, vs the computer only, once per match (`match.recorded`),
every game and option into the same buckets (Cutthroat: won = seat 0 was the last one in).
`total`/`byDiff` only, so My Stats' generic screen draws it and `players-agg.js` needs no branch.

## The computer (ai.js)

Candidates: ghost-ball pots per wanted ball x pocket (Cutthroat: everybody else's balls), bank
aims (the pocket mirrored in each cushion) when banks only is on, soft/firm safeties, random
fills; with the ball in hand, spots straight behind a ball lined up on a pocket. Each simulated;
`judge` scores win/rack, fouls (and the ball in hand they hand over), going again plus position,
what the next player is left; Cutthroat adds +500 per other player's ball down, -900 per own.

| | shots tried | aim noise | plays position / fears the reply | spins |
|---|---|---|---|---|
| Easy | 30 | 0.016 rad | no; 40% picks from its top third | centre |
| Medium | 90 | 0.0065 | half | 0, ±0.5 |
| Hard | 190 | 0.0025 | yes | 0, ±0.3, ±0.6 |

Measured 2026-10-22 (5-6 games each): Hard beat Easy every game in 8-ball and Cutthroat, 4/6 in
9-ball; every option combination finishes; plans ~35-70 ms average, slowest ~230 ms, in 7 ms
slices. **Not tuned against people yet.**

## Tests

- `node eight-ball/js/test.js` (44 checks, ~30 s): 1200 random shots across all three games and
  obstacles (on the table, no overlaps, nothing inside a can, all end); replay identical per game;
  every rule above (8/9/Cutthroat, call, bank, the foul put-back, out, racks); obstacles placed
  clear; computer matches finish in every game and with every option, Hard wins.
- `node tools/check-no-scroll.mjs eight-ball`: 40 screens, 0 scroll; the longest how-to (Cutthroat
  with every option, EN/ES) checked at 390x664, 360x724, 393x852: no scroll.
- Driven in Chromium: whole matches in Cutthroat (vs two Easy computers), 9-ball (Hard), 8-ball
  with call shots and obstacles (Medium), each recorded once; ball in hand dragged from far away,
  locked with the tick; full power off the bottom and left cushions; a tap never shoots. Not yet
  played on a real phone.

## Online challenges (Stage 2, 2026-10-22)

Matt: *"begin stage 2"* (turn-based online, 3-player Cutthroat included; "#2 is your call" = turn-
based Cutthroat goes in this stage). Flick Soccer's challenges are the model; no code shared.

- **Where:** the setup card's first row is **Multiplayer ›** ("N waiting on you"). Behind it:
  Challenge someone, the notify row, Your turn, Their turn, History. Pass and play stays on the
  setup card's opponent switch.
- **The challenge card:** who (one face; for Cutthroat a second "+ Add a player" picker), the game
  (8-Ball / 9-Ball / Cutthroat), racks, the three option chips, **Aiming help** (Easy / Medium /
  Hard for everybody in the match, stored as `aids`; Easy also frees the ball in hand), Send. Every
  choice is the setup card's own setting (`settings.game`, `racks`, `opts`, `aimHelp`).
- **THREE PLAYERS, a first for the hub's challenges:** a match keeps a list of players `p` (seat 0
  the challenger; seat = engine seat) instead of sides a/b. Every player gets an index row: `with`
  is the NEXT seat (fixed, so records group by one person), `with2` the other, `name` "Ana & Ben".
  `js/challenges.js` lists it with its own `action` reader (seats, not sides);
  `js/game-chat-history.js` reads two-player matches only (`sideOf` is null with three).
- **The first receiver (seat 1) breaks**, so every row is written at creation and the challenge
  waits on them at once. **Open** until any receiver has shot: the sender may cancel, any receiver
  may decline, and a decline calls it off for all three. Expires 3 days unanswered (`lapse`).
  **Resign** (once answered): you lose; with three, the other player with the most of their own
  balls on the table wins (`resignWinner`, ties to whoever shoots next).
- **The node:** `eightball/games/<id>` + `eightball/index/<CODE>/<id>` + `eightball/chat/<id>`. In
  `database.rules.json` (deployed by the Firebase workflow with the merge) and `backups/rtdb-backup.mjs`.
- **A match is a LOG of shots** `{ by: seat, dx, dy (6 dp), p (4), s (2), x, y (3, only with the
  ball in hand), c (pocket, when called) }` replayed from the match's `seed` (`termsOf`: mode, racks,
  opts, aids, seed). `validateGame` refuses the whole document if one shot does not replay. The
  shooting phone plays the ROUNDED shot, and **only a shot its own table accepted is ever written**:
  a ball-in-hand spot is rounded and then checked legal again (`_shoot`), because rounding once
  nudged a ball touching another a hair into it and every replay refused the shot (found by the
  three-phone test, 2026-10-22).
- Written at the moment of the shot (`appendLog`, verified by re-read, idempotent, a stale base is a
  conflict), kept in an outbox (`gamehub.eightball.outbox.v1`) until the server has it; drained on
  mount, `online`, leaving a match and every 6 s while anything waits.
- **Opening a match** replays silently up to the others' latest run, then PLAYS that run (cue placed,
  pocket called, cue drawn back, the shot rolls) through the computer's path (`this.cpu` with
  `replay`), every time while it is your turn; **Skip replay** rebuilds from the log. SENT! once per
  hand-over. Seen/shown/counted/unseen keys: `gamehub.eightball.{seen,shown,counted,unseenResults}.v1`.
- **Counting:** each finished match once per phone as `recordResult('eightball', 'mp', won)`.
- **Quick chat:** `js/match-chat.js` takes a third side `'c'` (2026-10-22) and `match-chat-ui.js`
  lets a line name its sender (`who`), so with three players each bubble says who spoke. Button on
  the top row left of spin and menu (`CHAT_PLACE`).
- **Tests:** `node tools/test-eightball-mp.mjs` (44 checks); `tools/test-challenges.mjs`. Driven in
  three Chromium "phones" on a shared stand-in database: Matt challenges Ana and Ben to Cutthroat,
  Ana locks her break spot and pulls, Matt's phone replays it, 15 shots later all three tables are
  identical to the bit, Ben's chat line pops on Matt's phone under Ben's name, Ben resigns and both
  others land on the result. Proven in one engine (V8) only; an iPhone against an Android phone is
  the real check.

## Challenges: 7 days, then forfeit (2026-10-29)

- 7 days, then forfeit: root `CLAUDE.md`, "Cancel, decline, resign, expire". **Cutthroat: the idle player loses and the winner is `resignWinner` on the table as the turn began** (`timeoutWinner`; rows carry `tw`); `over.by` = the idle seat; "{name} timed out". One count per person: `countResult(id, won, finishedAt)`. `tools/test-eightball-mp.mjs` times one out.

## The computer's plan is seeded (2026-10-29)

`planShot` takes `seededRng(match, seat)`: the match's own `seed` + the position, so quit and Continue before the computer shoots plans the SAME shot. `tools/test-ai-resume-seeds.mjs`.

## Quitting and easier settings (2026-10-29)

Play over a saved match vs the computer the player has shot in (`m.ps`) = ONE loss, asked twice; Quit keeps the save. A one-rack match records one step down (`statsDiff`, Matt's call). Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29: quitting and easier settings"; `node tools/test-quit-loss.mjs`.
