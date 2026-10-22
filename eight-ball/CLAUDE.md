# Pool — eight-ball/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

8-ball pool, played the Flick Soccer way. Matt, 2026-10-22: *"Flick soccer is a great game. Please
make a Pool game that functions similarly. Admin only for now."* Its shape is Flick Soccer's
(`flick-soccer/CLAUDE.md`): own deterministic physics, pull back and let go, a computer that
SIMULATES its candidate shots, autosave with the rolling shot replayed, one setup card, the same
aiming-help-by-difficulty idea. Stage 1 = vs the computer and two players on one phone. **Online
challenges are not built yet** (Flick Soccer's stage 2 is the model when Matt asks).

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

## The rules (bar-room 8-ball, `settle` in engine.js)

- Solids 1-7 (coral, plain) vs stripes 9-15 (cyan, a white ball with a band: the band is the SHAPE,
  colourblind rule). Table open until the first clean pot after the break; that ball's group is the
  shooter's.
- Foul: cue ball potted; nothing hit; first ball hit not yours (any but the 8 while open; the 8 once
  your group is down); nothing potted and no ball reaching a cushion after the hit. The break fouls
  only by scratching or missing. **A foul = ball in hand anywhere** for the other player.
- Pot one of yours (any while open) with no foul and you go again.
- The 8: on the break it wins the rack (a scratch with it loses); later it wins only when it was your
  target and nothing was a foul, otherwise you lose the rack. No called pockets.
- **Racks to win 1/2/3** (setup card); the break alternates rack to rack, and match to match
  (`settings.nextBreaker`). The break is from the kitchen (behind the head string), cue ball in hand.

## Physics (engine.js) — correctness-critical

- Only `+ - * /` and `Math.sqrt` on the physics path (cross-device determinism, for a future online
  stage; Flick Soccer's reasoning). The rack shuffle is integer xorshift from `m.seed`.
- `DT` 1/240, `MAX_SPEED` 400 (the break x1.35 = 540, ~2.25 a step, under `R` 2.6): nothing tunnels.
- Skid then roll: each ball carries `r` (the speed its spin would roll it at). A centre hit starts
  with no roll and the cloth turns skid into roll (5/7 rule); collisions swap only `v`, so the cue
  ball follows or draws naturally. Spin (-1 draw .. 1 follow) sets the cue ball's starting `r`.
- **The drawn hole is the rule**: a ball whose centre is over a pocket's black circle (or past the
  line between its jaws) drops (`pocketOf`). Cushion segment ends are the jaws.
- `settle` nudges any two balls left a hair inside each other apart (`relax`).
- Measured: a lone full-power shot rolls ~520 units (2.6 lengths) in 5 s; a full break pots ~0.4.

## The screen

- **Aiming (pull back, Flick Soccer's gesture, widened for pool):** touch ANYWHERE on the table;
  the shot goes from the finger through the cue ball; strength is how far the finger moves away from
  the ball past the closest it came (never inside `PULL_SAFE_PX` 22px), `PULL_FULL_PX` 130px for
  full, shrinking where the screen edge comes first. A tap is never a shot; letting go in the home
  bar never shoots. Touching far from the ball gives a finer aim.
- **Ball in hand:** a touch ON the cue ball (within ~26px) picks it up; it follows the finger, a spot
  that is not allowed shows a dotted white ring, letting go there snaps to the nearest legal spot
  (`nearestPlace`). A touch anywhere else aims.
- **Aiming help by difficulty** (`AIDS`): Easy = line, ghost ball, object path, cue glance; Medium =
  line, ghost ball, short stub; Hard = a short line out of the cue ball. Pass and play is Medium.
- **Spin**: the cue-ball button top-right opens a pad (top / back spin); resets after every shot.
- Whose turn: the whole surround (salmon seat 0, sky seat 1), the scoreboard side's accent border +
  underline, the green halo on the cue ball. FOUL banner names the foul; "X wins the rack" between
  racks (the next rack is already saved underneath).
- Names are profile names (seat 1 in pass and play is "Player 2"). No sound.

## Settings and storage

| Key | What |
|---|---|
| `gamehub.eightball.v1` | `{ mode: 'cpu'|'pass', difficulty, racks: 1|2|3, nextBreaker }` |
| `gamehub.eightball.save.v1` | `{ mode, diff, match, shot? }` at rest; removed once the match is won |

## Stats

`recordResult('eightball', difficulty, won)`, vs the computer only, once per match (`match.recorded`).
`total`/`byDiff` only, so My Stats' generic screen draws it and `players-agg.js` needs no branch.

## The computer (ai.js)

| | shots tried | aim noise | plays position / fears the reply | spins |
|---|---|---|---|---|
| Easy | 30 | 0.016 rad | no; 40% picks from its top third | centre |
| Medium | 90 | 0.0065 | half | 0, ±0.5 |
| Hard | 190 | 0.0025 | yes | 0, ±0.3, ±0.6 |

Measured (2026-10-22): Hard beat Easy 10/10, Medium beat Easy 9/10, Hard beat Medium 7/10; plans
~15-65 ms average, slowest ~200 ms, run in 7 ms slices. **Not tuned against people yet**; Hard can
clear the table. Knobs: `LEVEL` in `ai.js`.

## Tests

- `node eight-ball/js/test.js`: 1500 random shots (on the table, no overlaps, all end), replay
  identical, every rule above, CPU-vs-CPU matches finish and Hard beats Easy.
- `node tools/check-no-scroll.mjs eight-ball`: setup, how to play, play, spin, result, standalone and
  hub, five phone sizes: 40 screens, 0 scroll (2026-10-22).
- Driven in Chromium at 390x844 and 360x724: a whole match vs Hard to the result (recorded once as a
  Hard loss, save cleared), pass and play, a foul and ball in hand, dragging the cue ball, Continue
  after a reload mid-shot (the shot replayed), Spanish, dark mode. Not yet played on a real phone.
