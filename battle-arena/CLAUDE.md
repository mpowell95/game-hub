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
- **Extra moves: ONE PER TURN** (Matt, 2026-10-28: "limit extra turns to 1"; from 2026-10-24 it was every 4+, no
  cap, and a lucky chain could knock out a whole team in one turn): the first 4+ match of a turn (a straight 4/5 or
  an L/T, `matchGroups`) gives +1 move, marked by `extraUsed` (cleared by `endTurn`). A 5+ still heals the mover 5
  every time (`FIVE_HEAL`).
- **A fair start** (Matt, 2026-10-28: a first-turn knockout "should never be possible", nor starting your first turn
  on 1 HP): a side with `turns` 0, or bitten by a curse as its first turn starts, cannot go below `OPENING_FLOOR`
  (40, half its HP; `damage`, event `floored`). Not in How to play since 2026-11-13. No new state field; no stored online
  match or open room existed when both rules went in. Before: ~1 in 90 hard openings was a KO, one turn ran 220 moves.
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
- **Two monsters of one element SHARE the gems (rules v3, 2026-11-14; Matt: "it's insane that you're letting that count as 6! It
  can't be +3 for both of them")**: the fuller one (energy / cost) first, ties by seat, what its full bar cannot hold spills to the
  other (`engine.js charge`, `cpu.js gainsFor`). v1/v2 matches keep the old rule (each got every gem). The computer never drafts
  the player's monsters.
- **Team HP is a flat 80 for every team, max 80 (Matt, 2026-10-24: "everyone starts at 80").
  Monsters have NO HP of their own.** Evolve heals 5, capped at 80. Soak: ~7.7 turns per side (8.4 with one extra move a turn, 2026-10-28).
- **RULES VERSION 2 (2026-11-14, the rebalance): see "Rebalance" at the end; the numbers below are version 1's history.** Balance (soak-tuned 2026-10-24, from the spec's first guess): Emberkit cost 7→6; Driplet 5/10→8/14 dmg; Pebbleop shield 5/10→8/12; Thornpaw convert
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
| Look (2026-10-29) | Matt: home and Online "lackluster". Every screen outside a match wears the arena in BOTH themes (`art.js lobbyBG`; `--bas-*` dark always): home = logo + two random unlocked monsters "VS" on the floor, menu on the floor; one yellow `.ba-bigbtn` per screen, `.ba-steelbtn` for the rest |
| Monsters (2026-10-29) | Home > Monsters (`renderMonsters`): all 12, unlocked in full (tap = the card: both forms side by side, each one's special); LOCKED = black silhouette + lock + wins to go, no name/element, its card the same ("???"). The draft's locked tiles and cards are silhouettes too (`tileHTML`) |
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
matches use fixed seeds. Seed 1041's opening used to KO the receiver; it now checks the receiver keeps 40+ HP, on its turn.

## Challenges: 7 days, then forfeit (2026-10-29)

- 7 days, then forfeit; one count per person: root `CLAUDE.md`, "Cancel, decline, resign, expire". Cleaned moves drop `at`, so `validateGame` keeps `ats` for the turn clock; `forceEnd(winner, 'timeout')`; "Timed out" (`timedOut`). Live-room `mp` counts carry no id.

## Quitting and easier settings (2026-10-29)

The menu's New match / Home after the player's first move (`pm` in the save) = ONE loss, asked twice (`recorded`). Leaving the hub is not quitting (the save resumes). Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29: quitting and easier settings"; `node tools/test-quit-loss.mjs`.

## Second pass (2026-10-29)

- Live rooms: the leave is now ARMED at your first move too (`js/live-leave.js`), so a phone that never comes back loses (before, only a rejoin replayed the claim); `countLive` checks the shared ledger, and a rejoin whose loss was already settled resigns. Vs the computer: quitting is a loss from the board shown (`pm` true at start); a new match over a set-aside save records it first (`settleSavedMatch`: the loss, or the win its last move owed), Fight asks twice.
- Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29 (second pass): leaving live rooms, quitting once dealt".

## Home tabs (2026-11-07, the Cup Pong way)

Home = **Online | Computer** tabs (`renderHome(tab, note)`, `showTab`, `fillOnline`); Monsters and How to play sit under both. Online = Matches (Play pill on your turn; rows dropped until the screen fits, the rest counted) + Challenge (Anyone = picker, then the 4 most recent people, one tap = draft for that person) + Host / Join (their own screens, unchanged); `fillOnline` in `js/online-ui.js`. The old Online screen is gone: every "back" is `home(ui, note)` = `renderHome('online', note)`. Opens on Online when a match is going, else Computer; a tapped tab wins (`this._tab`). Badge = matches on your turn. TEST tag kept. Layout only.

## Fits on a short phone (2026-11-08)

`fitHome()` (ui.js): on a short phone the Online tab ran off the bottom (Unai's 360x668 Android) and How to play sat on the iPhone home bar. Step by step until the menu fits: the monster art shrinks to 64px, then goes; then `.ba-home.is-tight` (logo level with the Hub button, smaller gaps); then the logo shrinks to half at most. Buttons never change. Re-run on every tab switch, the Online list filling, and resize. `tools/review-setup-cards.cjs battle-arena`.

## Release review (2026-11-13)

Matt: "do a full exhaustive thorough review of Battle Arena to get it ready to be released". Fixed (story: `CLAUDE-HISTORY.md`):
- **Every way out records a decided match** (`recordOutcome`, from `finish`, the menu's New match / Home and `destroy`): the winning move animates with the winner already set, and leaving then dropped the result.
- **Live: a resign or claim ends the room with the loser's forfeit** (`resign` → `LL.leaveWithForfeit`; `onRoom` reads `forfeitsOf` first, `decide`), and an 'r' by this phone's own side (a claim against it) is applied. Before: a move in flight overwrote the claim and both phones could win.
- **Live recovery works**: the host's state travels as a JSON string (Firebase sorted keys and dropped nulls, so it never hashed the same); the HOST keeps its own result of a guest move it cannot match and pushes it (`publishRecovery(true)`; it used to freeze).
- **Hub "Leave?" in a live room** = `quitCostsLoss`/`leaveMatch`/`isInProgress` (after your first move: "Counts as a loss", resigns).
- **A challenge win counts once its last move is on the server** (`owed`); the outbox drain no longer wipes a move queued meanwhile; `mp.js writesAllowed` asks `automationBlocks`.
- **Mode + detail**: online results carry `first` and `via` (`ch`/`live`, `onlineMode`); index rows carry `tm` (the team) so a launcher count has one; every result has `detail` (`matchDetail`: moves, turns, hp, foeHp, evolved, end).
- Screens: text floor 15px (`fitText` floor, HUD names grow outward), help lines wrap at 17px (`text-wrap: balance`), the card's X works, end card keeps the profile name's case, Online tab says so when it cannot load.
- **Rules versions now exist (2026-11-14, `rv`)**: absent = v1; **any later change to a number or rule must add a version (monsters.js `OLD`, bump `RULES_VERSION`) and keep every older one**, or open challenges stop replaying.
- Left as is: the 25 s live clock runs under the hub's covers (no `onCovered`: the other phone is waiting); `battlearena` rules let an existing log entry be rewritten (same as every challenge game).

**Release checklist (only on Matt's "release it")**: `TEST_MODE` false (`ui.js`) + the `is-test` CSS; "(TEST)" off `functions/decide.js` `BATTLE_TEXT`; `devOnly` off `js/hub.js` (add `released`) and `js/game-stats-ui.js` TABS; `battlearena` out of `ADMIN_ONLY`; (`CARRY_TEST.battlearena` is ALREADY set, below); `./battle-arena/js/attacks.js` into `sw.js` ASSETS; `tools/validate-sw-assets.mjs`, CACHE bump; root CLAUDE.md games table.

## Test plays count (2026-11-13, Matt: "have test plays count. and have plays from non-admins count")

`CARRY_TEST.battlearena` with its own combiner `combineCopiedRecords` (`js/game-stats.js`), carried at the release
(every phone's store once, stamp `carried.battlearena`; `players-agg` combines an unstamped record at read time;
`testH2h` too, `CARRY_H2H`). NOT added: the test record started as a COPY of the real one (only real data: Matt's phone,
real 6 played, test 7), so each number takes the larger of the two (= the test record; `lo` the smaller). Admins and
testers alike: every player's test plays count. Nothing happens before the release (`isTestGame`).
`node tools/test-battlearena-carry.mjs`. Read-time Records (`mp-records.js`) read raw `h2h`: an unopened phone shows its
old head-to-head until it next opens (none exists today).

## Back step + second UI/UX review (2026-11-13, Matt: "make sure it has the swipe to go back feature we added to all of the screens in the new leaderboard")

- **One back step, four ways in** (`ui.js` `armBack` / `backStep` / `goBack`, export `back()`): a left-to-right swipe on any menu
  screen (the leaderboard's recognizer and numbers: 28px edge strip left to the phone, 8px lock, 56px or a 30px flick), the
  phone's back gesture (`js/back-stack.js`), the hub's top-left button ("‹ Back" via `gamehub:backlabel`) and the screen's own
  back arrow / X (the step CLICKS them). Levels: home and battle 0, Monsters / draft / online screens 1, each popup +1 (topmost
  first). In a battle with nothing open a swipe is a board move and the step is the hub's. A `MutationObserver` keeps history in
  step. `node tools/test-battlearena-back.mjs` (real touch swipes, needs a dev server).
- Review fixes: difficulty buttons 44px; Evolve pill 15px; the HUD clears the hub's "‹ Hub" (`.ba-hubspace` 84px, `.ba-who` 46px);
  How to play is an outlined 17px button; help lines share one left edge with an icon or dot gutter; the menu's other actions are
  outlined; one X look on every popup. Kept on purpose: the home is the game's own full-bleed arena (not a centred card), no
  heading on the Host draft (same draft as vs the computer). The end card's "Better luck next time, <name>" line shows ONLY on a
  loss (Matt, 2026-11-13: "should be shown. But only on a loss").

## Launcher tile (2026-11-13, Matt: "C is the best. go with it.")

`GAME_ART['battle-arena']` (`js/game-art.js`) = option C of `docs/mockups/battle-arena-tile/` (built by its `build.mjs` from
`art.js`'s real monsters and gems): Emberkit and Driplet on their tanks over a gem board, three fire gems lit, energy flying to
Emberkit. A new tile is drawn from the game's own art, never a hand-made copy of it.

## Matt's iPhone notes (2026-11-13)

- **Home centred on a tall phone** (`spreadHome`, after `fitHome`): the spare room under the menu (measured with the TALLER
  tab, so the tabs never move) grows the monsters up to 150px, then half the rest goes above the hero (`--ba-lift`). The
  hero's 2px art margin is not "overflow" (`+ 6` in `over()`; it made every phone take the short-phone path).
- **"Your Turn" takes the name's place** (same slot and size, no floating pill); the numbers column sits level with the
  avatar (`.ba-team` `align-items: flex-start`) so that line never touches the HP.
- **The shield is a bubble** over each monster of the shielded team, with a shield chip and the number on the side facing
  the other team (`paintShield`; follows the shield / damage events mid-move, `_inPlay`; pops in, wobbles on a soaked hit,
  bursts at 0). The HUD's small shield badge is gone.
- **A match opens behind SHUT doors**: renderBattle puts them up on the first frame, `stageIntro` shows "Boiler Room" on
  them, then they open (it used to show the board, then the name, then close and open the doors).

## How to play is pictures (2026-11-13, Matt: "try to use images like some other How to Play screens")

The goal line, then 4 rows, each a small scene drawn from the game's own gems and monsters + a 3-5 word caption
(`HELP_PICS` in `ui.js`): swap to match 3 → monster charges; full bar → special; 4 berries → evolved; 3 gems by a bomb →
boom. 25 words EN, 24 ES (was 84/88). Not in How to play (rules unchanged): match 4/5, the 40 HP opening floor, a bomb at 0
(on the stage card), turn 20. **Bombs are still in the game** (`BOMB_RATE` 2.5%, `MAX_BOMBS` 2); none was ever removed.

## Matt's notes, 2026-11-14

- **End card: Play again / New team / Home** (full width under the two). Home = the setup screen (Computer tab); the match is
  already recorded, so it costs nothing. Matt: Play again "started a new game immediately... It was only back to hub", and leaving
  a started match is a loss.
- **Every monster is its element's colour** (Matt: "make the colors of the monsters match the thing they eat"). Only Pebbleop was off
  (grey stone, a FIRE monster): now a red-hot rock with yellow cracks, both forms (`art.js`). Art only; the engine is untouched.
- **Element gems bigger EVERYWHERE** (Matt: "Make the things they eat bigger"; then "Why are these so small? I've already told you
  these need to be bigger" about the battle's energy bars, which the first pass missed): 28px on every draft tile, 30px on Monsters,
  **48px on each battle energy bar** (was 32px, the gem inside ~22px). A size request applies to EVERY screen showing that thing.
- **Monsters = 3 across x 4 down, powers in WORDS** (Matt: "Some names are cut off. The hints for their powers are not clear at
  all. Make it 3x4 instead of 4x3"; the icon chips are gone). Each base monster's effects, one short line each (`tileLines`,
  strings `tx_*`: "11 damage", "Column clear", "+1 to partner"; the card keeps the full `fx_*` wording), measured to fit a
  third-width tile on a 360px phone in both languages (`.ba-dex` padding 6px there). The art takes the height left.
- **Battle top bar in two rows** (Matt circled the old one: numbers against the Hub and menu buttons, his side's numbers missing
  once both monsters evolved, TEST on top of MOVES). Row 1 (`.ba-hubrow`, level with the hub's button): hub space, chat (online),
  TEST, the stage button (now the bomb icon, no word), menu. Row 2 (`.ba-teamrow`): each team = avatar OUTSIDE, name over
  "HP ♥ berries 🍒" (HP nearest the avatar, so a hidden berries count leaves no gap); the move hexes between them, no "MOVES"
  word; a live room's clock = clock icon + seconds under the hexes. Narrow phones (≤380px) a little smaller.
- **End card**: the overlay is near-opaque (the HUD and board no longer show through), the losers' panel solid, the X sits exactly
  on the menu button's spot, and a lone Done (online) spans the full width.
- **Stage card**: two picture rows like How to play (`stageBomb`, `stageZero`); it had borrowed How to play's "Match next to it:
  boom." where "it" meant nothing.
- **Admin phones keep old Battle Arena code until the page reloads** (the open page holds the imported modules; held-back files
  give no update). Matt saw the grey Pebbleop 13 minutes after it shipped. A CACHE bump (v1559) reloads admin devices; players get
  a near-empty update.
- **HP never moves** (Matt: "once I recover both my monster guys and didn't need any more berries, my health moved up"): HP and
  berries share one line, HP nearest the avatar, so a hidden berries count moves nothing (measured: same x/y before and after).

## Rebalance: rules version 2, weakest first (2026-11-14, Matt: "Yes rebalance them. At least reorder them weakest in the first batch, then better ones get unlocked")

- **A match carries `rv`** (`engine.newMatch({ rv })`; absent = 1). `monsters.js`: `MONSTERS` = the current numbers,
  `V1` = 2026-11-13's numbers, FROZEN; `costOf(id, rv)` / `specialOf(id, evo, rv)`; the engine and the computer pass the
  match's `rv`. New vs-computer matches, challenges (`doc.rv`, kept by `validateGame`) and live rooms (`round.deck.rv`,
  `matchOf`) are stamped `RULES_VERSION` (2); saves, open challenges and rooms from before replay on v1, unchanged
  (`tools/test-battlearena-mp.mjs` "rules:", `battle-arena/js/test.js` "rules v2"). Screens outside a match show v2; a
  match's own card and energy bars show its version.
- **Win rates, every 2-monster team vs every other team** (`/tmp` tuner, same AI both sides): v1 27-68%; v2 45-55% on
  medium (8,910 matches) and hard (5,940). v2 numbers: Thornpaw cost 5, convert 4 heal 7 (evo 5/10); Sproutle dmg 9 heal 6
  (14/10); Driplet dmg 12 (18); Cinderwing dmg 11 (16); Frostling dmg 7 (11); Stormhorn dmg 12 (17); Emberkit cost 7 dmg 11
  (17); Pebbleop cost 7 dmg 12 shield 9 (17/13); Hexowl dmg 8 (13); Gloomite dmg 12 (17); Zapup dmg 4 (8); Prismote cost
  16 dmg 18 (27). Thornpaw's convert is touchy: convert 5 at cost 5-6 won 61-77% on hard.
- **Unlock order = weakest first**: starters Thornpaw, Sproutle, Driplet, Cinderwing, Frostling, Stormhorn; then Emberkit 3
  wins, Pebbleop 6, Hexowl 10, Gloomite 15, Zapup 20, Prismote 30 (`MONSTERS` order = the Monsters screen's order).
  Unlocks stay DERIVED from wins (nothing stored, nothing lost); testers who had Emberkit, Zapup, Gloomite or Pebbleop as
  starters now unlock them by wins. A saved team or Play again with a now-locked monster goes to the team pick.
- **The team pick (draft) = the Monsters screen's tiles** (Matt: "Why does this screen suck? We just redid the other one so it
  made sense. Fix this one."): 3 x 4, name + power words on each (`tileHTML(m, true)`, `.ba-draft` rules shared by both screens);
  the picked tile's teal hexagon stays inside the art box (it covered the name). Short phones (height <= 740px) drop the two big
  pick hexes (a picked tile keeps its ring and tick) so the pictures keep ~33px; Matt's 402x874 keeps both (art 64-68px).
- **Rules version 3 (same day)**: the sharing rule above + a retune for it (same-element pairs lost their double charge, so the fire
  trio dipped and Prismote rose): Thornpaw heal 8 (evo 11), Cinderwing dmg 12 (17), Emberkit dmg 12 (18), Pebbleop dmg 13 (18),
  Prismote cost 17 dmg 17 (26). Every monster 47-54% (medium 5,940 + hard 2,970 matches). `V2` frozen beside `V1`. Unlock order
  kept: under v3 the six starters and the rest are within a point or two, so reshuffling testers' unlocks would be noise.
- **A team never has two monsters of one element** (Matt, same day: "You shouldn't be able to choose 2 of the same"): the draft dims
  a picked monster's element-mates (`.is-taken`) and picking one SWAPS it in; Random, a saved team (`oneOfEach`) and the computer
  (`chooseTeam`) obey it. Not enforced on stored matches (`cleanTeam`), so no old match or challenge breaks. The v3 sharing rule
  stays for old matches. Balance without same-element teams: every monster 46-53% (medium 4,752 + hard 2,376), no retune.
- **Hard no longer peeks** (Matt: "are you just calculating it so the robot gets luckier than me?"). I built it wrong: Hard played
  each swap out on the REAL state, and the match's seed decides what falls in, so it knew every cascade before choosing (old code
  changed its pick on 25 of 40 boards when only the hidden seed changed; it beat Medium 84%). Now `hardMove` (cpu.js) looks ahead
  only on GUESSED falls (its own seed, 2 guesses averaged) and plans its whole turn (best 4 first moves x best 4 second moves).
  Test: "no peeking", the same move on 40/40 boards whatever is about to fall. Fair Hard beats Medium ~55% (300 matches; every
  look-ahead size tried was 50-56%): match-3 is mostly luck once nobody sees the future. Nothing is ever rigged: the falls are
  the match's seeded RNG, the same for both sides.
- **Every attack visibly hits BOTH of the other team's monsters** (Matt: "Make sure when a monster attacks, it attacks both of the
  opposing monsters"; damage was always team HP). Driplet's jet now splits onto both; Pebbleop drops a boulder on each (evolved: a
  third between them); the rest already did. The boulder and its chips are Pebbleop's red-hot rock now. A new attack must hit both.
- **Starters cover all five gem colours** (Matt: "NONE of the monsters use that other piece? They only use the leaf, fire, water, and
  electricity???"): weakest-first left both shadow monsters locked. Hexowl is now a starter and Frostling opens at 10 wins (they
  were within a point of each other). Starters: Thornpaw, Sproutle, Driplet, Cinderwing, Hexowl, Stormhorn. A test keeps it so.
