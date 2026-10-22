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
slingshot pull. **Still to come, in this order (Matt's plan):** Stage 2 turn-based online
challenges INCLUDING 3-player Cutthroat (a 3-person challenge is new to the hub: every challenge
today is 2-person), Stage 3 live rooms (3 seats for Cutthroat; `js/net.js` N-seat), Stage 4 push
notifications. Online quick chat is required (root CLAUDE.md). Ideas offered to Matt, not asked
for yet: Killer (2-6 players, lives), trick shot of the day, shot clock, replay of their shot.

## Not the archived Pool

`archive/pool/` is an older, different Pool (archived 2026-09-28). **This game reuses none of its
ids**: folder and hub id `eight-ball`, stats id `eightball`, keys `gamehub.eightball.*`, prefix
`.ep-`. The old `'pool'`/`'poolv2'` stats and `gamehub.pool*` keys stay that game's (THE LAW rule 5).
Its palette IS reused on purpose: Matt asked for that friendly look in 2026-08
(`reference/pool/SPEC.md`: pastel surround that is the turn colour, warm wood, bright cushion, flat
black pockets, coral and cyan groups).

## Hub integration

- In-hub `module: '../eight-ball/js/ui.js'`, **immersive**, `devOnly: true` (admin only), no
  `released` (that is the release day). `GAME_META`, My Stats tab and `game_title_eightball` ship
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
| `js/test.js` | `node eight-ball/js/test.js` (~12 s; not precached) |
| `css/eight-ball.css` | all styling, `.ep-root`-scoped, dark-mode token block at the end |

## The games (`settle` in engine.js; seats 2, 2, 3)

- **8-ball**: solids 1-7, stripes 9-15. Open table until the first COUNTING pot after the break;
  that ball's group is the shooter's. The 8 must be called (always); it wins only as your target,
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
- **Fouls, every game:** cue ball potted; nothing hit; nothing potted and no ball reaching a
  cushion after the hit; 8/9-ball also the wrong first ball. A foul = ball in hand anywhere for
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
- **Proportions are a 7-foot bar table's**: `R` 2.8 on 100 wide (2.25" ball on 39" of cloth),
  corner mouths jaw to jaw 11.5 (2.05 balls), side mouths 12.4 (2.2 balls: real side pockets are a
  little WIDER). Every hole is drawn the same size (`HOLE` 5.4), and the drawn hole is the rule: a
  ball whose centre is over it, or past the line between the jaws (drawn dark, the throat), drops.
  (Matt, 2026-10-22: holes too big for the balls, corners bigger than sides.)
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

- **The pull is a SLINGSHOT from wherever the finger went down** (2026-10-22, replacing "through
  the cue ball"): the shot goes the opposite way to the pull; strength is the pull past
  `PULL_SAFE_PX` (18) over `PULL_FULL_PX` (130), shrinking only where the screen edge comes first
  in the pulled direction (never under 48). Started on the cue ball it is Flick Soccer's pull;
  started anywhere else it still works with the cue ball against a cushion or the bottom of the
  screen (measured: full power straight up off the bottom cushion, and right off the left one). A
  tap is never a shot; letting go in the home bar never shoots.
- **Ball in hand:** Easy, a touch ON the cue ball picks it up until the shot. **Medium, Hard and
  players sharing a phone must lock the spot in** with the green tick beside the ball (Matt: "in
  medium or hard you should have to lock in where you put the ball"); until then a drag ANYWHERE
  moves the ball. A spot that is not allowed shows a dotted white ring; letting go snaps to the
  nearest legal one (`nearestPlace`).
- **Calling:** while a call is needed the pockets pulse; a tap on one (generous: hole + 16px) calls
  it (yellow ring + arrow), another tap changes it; no aiming until a pocket is called. The
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
  the next ball ringed and bigger. Surround = turn colour (salmon, sky, mint).
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
