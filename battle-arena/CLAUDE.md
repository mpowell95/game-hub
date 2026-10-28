# Battle Arena — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md`.

A match-3 monster battle (mechanics only from "Match Monsters"; every creature, name and picture is
our own). THE SPEC: `docs/BATTLE-ARENA-SPEC.md`. Phase 1 (built 2026-10-24): vs computer, admin only.
Phase 2 (built 2026-10-24): online, turn-by-turn challenges AND live rooms (see "Online").

## Files

`js/engine.js` the rules: pure, no DOM/clock/Math.random; a match is ONE JSON object (RNG state
inside, mulberry32), `apply(state, move) -> {ok, state, events, error}` never mutates its input;
moves `{type:'swap', a, b}` / `{type:'evolve', mon}`; `events` (listed at the file's end) drive every
animation · `js/monsters.js` roster, unlock thresholds, `unlockedIds(wins)` · `js/cpu.js` Easy (any
legal swap) / Medium (best first-step clear) / Hard (plays each swap out + follow-up, avoids handing
over a special); `chooseTeam` · `js/art.js` all SVG: 12 monsters x normal/evolved (120 box, facing
right, no ids/gradients), gems (shape + icon per element) · `js/attacks.js` every monster's own special
attack + the evolution scene (presentation only, one particle canvas) · `js/ui.js` home, draft, card, battle,
module contract · `js/strings.js` EN/ES (move names `sp_<id>[_evo]`) · `js/test.js` (dev only) ·
online: `js/online.js` (pure: entries, replay, mirror, hash) · `js/mp.js` (challenges) · `js/live.js`
(live rooms over `js/net.js`) · `js/online-ui.js` (screens + the two links, lazy) · `js/alert.js` (launcher).

## Rules we decided (not in the spec, or changed from it)

- **Berries are a sixth tile that MATCHES like a gem** (3+ in a line; each counts toward evolving), as
  the reference shows ("3 🍒" by the counter); ~10% of new tiles, but **never more than 4 on the board**
  (`MAX_BERRIES`: they charge nothing, so unmatched ones piled up to 11; Matt, 2026-10-24). **Bombs**: a match
  orthogonally NEXT TO one sets it off (the reference's stage text). Blast and special-cleared gems
  charge the mover; a bomb at 0 charges nobody.
- **Move timer 25 s, reset after every move: LIVE ONLINE ONLY, never vs the computer** (Matt,
  2026-10-24; per-move as in the reference). On only for a live room's link (`this.timed`); at 0 sends `{type:'pass'}`.
- **No idle hint** (no wiggling tiles; Matt turned it off, 2026-10-24).
- **Any adjacent swap is a move**, a line or not (Matt, 2026-10-24: "clearly allowed in the original").
- **Extra moves: EVERY match of 4+ tiles gives one, no cap** (Matt, 2026-10-24: "Every 4+ should give
  me another turn"; a straight 4/5 or an L/T, `matchGroups`). A 5+ also heals the mover 5 (`FIVE_HEAL`).
- **Evolving is a MOVE** (rec3 2:49): with 4 berries the mover may tap a monster ("Evolve!"); it costs
  one move, heals nothing, berries back to 0. Never automatic; with no move left it waits.
- Specials pair damage with a board clear that charges the caster, as the reference's do (Flare: a
  column, Electroclaw: a 2x2): Emberkit clears a column (`col`), Zapup a 2x2 (`block`), Sproutle
  hits AND heals (like Heal Leaf).
- The Garden's grapes cost the matcher 5 HP (rec3 1:28): a GARDEN stage rule, not ours (the bravomike
  match's cherries cost nothing). Add it with a Garden arena.
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
with the big monster + lunge + THAT MONSTER'S OWN ATTACK + hit flash + "-N DMG" by the HP, a turn = a white banner
"<name>'s turn", evolving = the evolution scene, a win = losers faint + Victory card.

**Every monster has its own attack (2026-10-28, Matt: "every attack looks the same: an energy ball... This is
where the game must stand out"; mockup approved "those are sick").** `js/attacks.js` `ATTACKS[id]`: Emberkit
leaps + fire pillars; Sproutle vines; Driplet water jet (evolved: a wave across the stage); Zapup zips + sky
lightning; Gloomite a shadow maw snaps shut; Pebbleop falls as a boulder (evolved: three); Cinderwing swoops
breathing fire; Thornpaw thorn ring + leaf storm onto the board; Frostling ice shards (evolved: icicles) + ice
blocks; Stormhorn chain lightning ending on its partner; Hexowl a hex seal slams down; Prismote rainbow beams.
Evolved = the same attack, bigger, plus an extra. Evolving: energy in, white glow, a ball of light cracks open,
the new form, its name slammed on. Reduced motion skips both. A new monster needs an `ATTACKS` entry.
**Verify any change by recording a match** (Playwright `recordVideo`) and reading the frames; the
first build's flat UI passed every test.

**Layout (v3, 2026-10-24, from rec3's frames):** no boxed panels; berries over HP (big, outlined) +
avatar with name / "Your Turn", the other team LEFT; MOVES hexes + label centre; STAGE button (the
arena's rule); the arena behind the whole screen (wall SVG + CSS floor + tanks under the back
monsters) with the board see-through on top, DIMMED on the other side's turn; banners at the
arena/board seam, move names blue; steel doors after the stage reveal; the ending on the stage
(VICTORY/DEFEAT, a white "<name> wins!" strip, the losers' monsters in tears).

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../battle-arena/js/ui.js'`, `alerts: alert.js`, `immersive: true`, `devOnly: true`, no `released`; `LIVE_MP_GAMES` / `LIVE_GAMES` / `SOURCES` |
| Stats id | `battlearena`: `recordResult('battlearena', 'easy'\|'medium'\|'hard', won)` once per finished match. In `js/game-stats.js` `GAMES`, `js/leaderboard-ui.js` `GAME_META`, `js/game-stats-ui.js` `TABS` + `HUB_ID`, label `game_title_battlearena` |
| Unlocks | DERIVED from `loadStats().games.battlearena.total.won` at read time; never stored. Testers get the 6 starters, the rest by wins (Matt, 2026-10-28). A locked tile shows wins still to go; a win that crosses a threshold shows "New monster!" (`showUnlock`) |
| TEST MODE | `TEST_MODE` in `ui.js`: a "TEST" tag on every screen (`.ba-root.is-test::after`) and "(TEST)" in the push title (`functions/decide.js` `BATTLE_TEXT`). Matt, 2026-10-28: testers "know it's in test mode... always clearly present". **Remove both at release.** Open it to chosen players: Admin > games > Battle Arena (`ALLOW_PICKER`) |
| CSS | `.ba-root` / `.ba-` (every rule under `.ba-root`); battle screen dark in both themes |
| Settings | `gamehub.battlearena.v1`: `{ diff, team, nextFirst, tips }` (preferences only) |
| Save | `gamehub.battlearena.save.v1`: `{ v:1, diff, state }`, written BEFORE each move's animation; removed only after the result is recorded. A save whose last move won is resumed and recorded on the next mount. Menu > New match / Home abandons (nothing recorded) |
| `isInProgress()` | AUTOSAVE meaning: always `false` (leaving is lossless) |
| Tile art | `GAME_ART['battle-arena']` (simplified Emberkit vs Driplet) |
| Test hook | `window.__baTest` (read by headless drivers only) |

## Online (2026-10-24)

Story: `CLAUDE-HISTORY.md`, same heading. Home's **Online** button (badge = your-turn count) opens:
Challenge · Host / Join · your challenges. The battle screen is the SAME screen: the other person on the
LEFT by profile name + emoji, their moves played exactly like the computer's (`ui.js remoteEntry` ->
`pumpRemote`: tiles light up, then the same `step` + `commit` + `play(events)`).

- **A match online = a seed + two teams + a list of moves** (`online.js`); every phone replays it.
  Stored frame: side 'a' = engine side 0 (challenger / host). **Side 'b' sees a MIRROR** (`mirror`, teams
  swapped, board untouched) so its player is always on the right; every rule still runs on the stored
  frame (`ui.step`). `this.canon` = stored, `this.state` = screen.
- **Challenges** (`mp.js`, Darts' model): node `battlearena/games|index|chat`. The challenger drafts and
  moves first; the other drafts on first open (`draftTeam`, own unlocks; not an answer, does not move
  `updated`). b's monsters are never read on a's first turn (`PLACEHOLDER_TEAM`, proven in the test).
  Written move by move (`appendLog`, verified, outbox); delivered when a's first turn ends; cancel /
  decline / resign / 3-day expiry; **no move clock**. `recordResult('battlearena', 'mp', won)`, never h2h.
  Push `battleArenaTurnPush` (`decideBattleArena`), in `REMINDER_GAMES` and the Remind bell.
- **Live rooms** (`live.js`): host drafts -> code -> guest types it, drafts, joins with `guest.team`;
  host publishes `round.deck = {seed, a, b}`, **host moves first**; `moves/<seq>` lockstep with an FNV
  hash, recovery from the host. **25 s per move, reset each move** (`link.timed`; both phones show it,
  only the mover's phone passes). **Leaving = resigning** (a `{k:'r'}` move); closing the app is not
  leaving (`gamehub.battlearena.room.v1` rejoins). "Claim win" after 90 s of silence. Records 'mp' +
  `recordHeadToHead`, once (`gamehub.battlearena.liveCounted.v1`).
- **Chat** in both (`createMatchChat`, button in `.ba-chatslot` under the hub chip): challenges at
  `battlearena/chat/<id>`, live via `net.sendReaction`.
- Never touches the vs-computer save, settings' `nextFirst` or its clock-free play.

## Tests

`node battle-arena/js/test.js` (rules, determinism/replay, a 300-match AI soak; `--soak=N`);
`node tools/check-no-scroll.mjs battle-arena` (help, draft + card, battle via `EXTRA_SCREENS`);
`node tools/test-game-conventions.mjs`; `node tools/test-battlearena-mp.mjs` (online: replay, placeholder,
mirror, a full challenge and a full live match, cancel/decline/resign/expire, gate, structure). Two-phone
recording: a mocked Firebase SDK served to two Playwright pages (2026-10-24, see CLAUDE-HISTORY.md).
`test-battlearena-mp.mjs` was FLAKY (about 1 run in 3) until 2026-10-28: its computer moves were random and a lucky
chain of 4+ matches sometimes KO'd the receiver in the challenger's FIRST turn (a legal finish: about 1 first turn in 90
for the hard computer, 1 in 3,000 medium, never easy). Now its challenge turns are seeded (repeatable), the lifecycle
matches use fixed seeds, and seed 1041 tests the first-turn knockout on purpose (the receiver gets it as a loss).
