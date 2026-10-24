# Battle Arena — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md`.

A match-3 monster battle (mechanics only from "Match Monsters"; every creature, name and picture is
our own). THE SPEC: `docs/BATTLE-ARENA-SPEC.md`. Phase 1 (built 2026-10-24): vs computer, admin only.
Phase 2 (later): live rooms + turn-by-turn challenges, which is why the engine is what it is.

## Files

`js/engine.js` the rules: pure, no DOM/clock/Math.random; a match is ONE JSON object (RNG state
inside, mulberry32), `apply(state, move) -> {ok, state, events, error}` never mutates its input;
moves `{type:'swap', a, b}` / `{type:'evolve', mon}`; `events` (listed at the file's end) drive every
animation · `js/monsters.js` roster, unlock thresholds, `unlockedIds(wins)` · `js/cpu.js` Easy (any
legal swap) / Medium (best first-step clear) / Hard (plays each swap out + follow-up, avoids handing
over a special); `chooseTeam` · `js/art.js` all SVG: 12 monsters x normal/evolved (120 box, facing
right, no ids/gradients), gems (shape + icon per element) · `js/ui.js` home, draft, card, battle,
module contract · `js/strings.js` EN/ES (move names `sp_<id>[_evo]`) · `js/test.js` (dev only).

## Rules we decided (not in the spec, or changed from it)

- **Berries are a sixth tile that MATCHES like a gem** (3+ in a line; each counts toward evolving), as
  the reference shows ("3 🍒" by the counter); ~10% of tiles (2026-10-24, v2). **Bombs**: a match
  orthogonally NEXT TO one sets it off (the reference's stage text). Blast and special-cleared gems
  charge the mover; a bomb at 0 charges nobody.
- **Turn timer 30 s** for the player (runs only while they can act, paused during animation and
  with any overlay open); at 0 the engine's `{type:'pass'}` ends the turn. Idle 8 s: a hint wiggles.
- Extra move: any 4+ line during the move's resolution (cascades included), once per turn.
- Specials fire after the board settles, seat order; a special that changes the board settles again.
- **Sudden death**: after each side's 20th turn heals do nothing (the soak found two healing teams
  out-healing each other past 3000 moves).
- Both monsters of one element both charge. The computer never drafts the player's monsters.
- **Team HP is a flat 80 for every team, max 80 (Matt, 2026-10-24: "everyone starts at 80").
  Monsters have NO HP of their own.** Evolve heals 5, capped at 80. Soak: ~7.7 turns per side.
- **Balance (soak-tuned 2026-10-24, from the spec's first guess)**: Emberkit cost 7→6; Driplet 5/10→8/14 dmg; Pebbleop shield 5/10→8/12; Thornpaw convert
  4/6→3/5; Frostling 10/15→8/12 dmg; Prismote cost 12→14.

## The battle screen (rebuilt 2026-10-24 after Matt: "in no way, shape, or form a clone")

Modelled on the reference recordings, beat by beat: team panels (avatar, HP, berries) over the arena,
move hexes + clock in the top row, the other team LEFT and the player RIGHT facing each other, bobbing.
Every engine event is animation: matched tiles glow then burst, ORBS fly to the monster they charge
(count pops over it), "EXTRA MOVE!" across the board, a special = dimmed stage + full-width banner
with the big monster + lunge + projectile + hit flash + "-N DMG" by the HP, a turn = a white banner
"<name>'s turn", 4 berries = full-screen evolution flicker, a win = losers faint + Victory card.
**Verify any change by recording a match** (Playwright `recordVideo`) and reading the frames; the
first build's flat UI passed every test.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../battle-arena/js/ui.js'`, `immersive: true`, `devOnly: true`, no `released` |
| Stats id | `battlearena`: `recordResult('battlearena', 'easy'\|'medium'\|'hard', won)` once per finished match. In `js/game-stats.js` `GAMES`, `js/leaderboard-ui.js` `GAME_META`, `js/game-stats-ui.js` `TABS` + `HUB_ID`, label `game_title_battlearena` |
| Unlocks | DERIVED from `loadStats().games.battlearena.total.won` at read time; never stored |
| CSS | `.ba-root` / `.ba-` (every rule under `.ba-root`); battle screen dark in both themes |
| Settings | `gamehub.battlearena.v1`: `{ diff, team, nextFirst, tips }` (preferences only) |
| Save | `gamehub.battlearena.save.v1`: `{ v:1, diff, state }`, written BEFORE each move's animation; removed only after the result is recorded. A save whose last move won is resumed and recorded on the next mount. Menu > New match / Home abandons (nothing recorded) |
| `isInProgress()` | AUTOSAVE meaning: always `false` (leaving is lossless) |
| Tile art | `GAME_ART['battle-arena']` (simplified Emberkit vs Driplet) |
| Test hook | `window.__baTest` (read by headless drivers only) |

## Tests

`node battle-arena/js/test.js` (rules, determinism/replay, a 300-match AI soak; `--soak=N`);
`node tools/check-no-scroll.mjs battle-arena` (help, draft + card, battle via `EXTRA_SCREENS`);
`node tools/test-game-conventions.mjs`.
