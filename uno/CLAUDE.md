# Uno (`uno/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Built 2026-07-24 per `HANDOFF-UNO.md` (root, kept for the ruleset rationale). 2-4 players, solo vs AI.
In-hub `module:`, immersive since 2026-10-23. `isInProgress()` is always `false` (autosave/resume built in).
Play screen overhauled 2026-10-23 (see "The play screen"). Played end to end headless that day: 4 full
games through the real screen (deal, plays, the wild chooser, draws, win card, rematch) at 2 and 3
players, in the hub and standalone, no errors; not yet checked by eye on a real phone.

## Layout & responsibilities

```
uno/js/game.js     pure engine (no DOM, no Math.random, injected rng, presetDeck hook)
uno/js/ai.js        pure AI: easy/medium/hard, samples only from the engine's legal-move list
uno/js/ui.js        DOM, setup screen, render loop, hub init/destroy contract
uno/js/strings.js   { en, es } - every user-visible string
uno/js/test.js      headless engine assertions (node uno/js/test.js), in tools/run-all-tests.mjs
uno/css/uno.css     all styles, .un- prefixed, every rule descendant-scoped under .un-root
uno/index.html      standalone host (same init() as in-hub)
```

## Matt's ruleset (decided 2026-07-24 — do not re-litigate)

- **Draw until you can play**, then you MUST play the card you drew. A pending +2 stack you cannot
  answer is the one exception: you draw the accumulated penalty as a single lump and are skipped
  (penalty draws are never draw-until-playable).
- **+2 stacking ON** (any +2 answers a +2, passing the total on). **Wild +4 does NOT stack** and is
  not a legal response to a pending +2 stack; it is always legal on an ordinary turn
  (`pendingDraw === 0`), no challenge mechanic.
- **Jump-in OFF. 7-0 swap OFF.**
- Standard elsewhere: 108 cards, 7 dealt, Reverse acts as Skip with 2 players, win by emptying your
  hand, single-hand games with a rematch.
- **Deliberate simplifications**: no Wild +4 challenge; "Uno!" is automatic, a persistent badge on
  any seat at exactly one card (computed from `hand.length === 1` each render, no catch/penalty).
- **First card**: a flipped Wild +4 is returned and reflipped; any other action card applies to the
  opener (skip/+2 target them); a Wild lets the opener pick the colour, no self-skip.
- Deck exhaustion mid-draw reshuffles the discard (minus its top card); wilds exist in every
  reshuffle, so draw-until-playable terminates.

## Engine notes (`game.js`, correctness-critical)

- **MP-lockstep-clean by construction**: no `Math.random` (rng injected), a `presetDeck` hook, every
  change an explicit action (`play(pi, cardId, color?)` / `draw(pi)` / `chooseColor(pi, color)`),
  whole state plain JSON via `snapshot()`/`UnoGame.fromSnapshot()`.
- **Turn advance is one primitive, `_advance(steps)`** over `(currentPlayer + direction + n) % n`.
  Skip = 2. Reverse with 2 players = advance 2 and does **not** flip `direction` (flipping and
  advancing 1 lands on the OTHER player, an ordinary pass); do not "simplify" this. Wild+4 draws its
  victim (`peekNext(1)`) 4 cards, then advances 2 from the ORIGINAL player.
- **`chooseColor` is a distinct action from `play`** (`phase` `'chooseColor'`, `pendingWild` names who
  owes a colour), used for the first-card-flip Wild; `play(pi, cardId, color)` in one call is the
  ordinary UI path.
- **`getLegalMoves(playerIndex)` is the single legality implementation** (AI and UI both read it):
  `pendingDraw > 0` restricts to `+2` cards (any colour) and reports `drawIsPenalty`/`penaltyAmount`;
  else `_matches()` (colour, number, action kind, or wild).
- **`totalCardCount()` must always read 108** (`test.js` checks after reshuffles and 60 random games).
- **`_flipFirstCard()` is stated RELATIVE to `this._startPlayer`** (constructor option, default 0),
  never seat 0: number opens on `startPlayer`; skip/reverse(2p)/+2 target `startPlayer` and open on
  `(startPlayer+1)%n`; reverse at 3+ flips direction and opens on `(startPlayer-1+n)%n`; a first-flip
  wild is chosen by `startPlayer`, who still opens. **Do not add a first-card path that reads `0` for
  "the opener"**: the original build hardcoded seat 0 and the human opened ~70% of hands (86 tests
  passed with the bug present).

## AI notes (`ai.js`)

Ids `easy`/`medium`/`hard` (tiers 1-3 in `js/difficulty-tiers.js`). Every decision comes from
`game.getLegalMoves()` as a plain replayable `{ type: 'play'|'draw', cardId?, color? }`.
`chooseAction` is a pure function of `game`/`playerIndex`/`difficulty`/`rng` plus one optional
read-only `memory`.

- **Easy**: uniform-random over legal cards. **Do not add heuristics to its branch.** Wild colour is
  `pickWildColor` (hand majority) for every difficulty.
- **Medium** (`pickCard`): majority colour, dumps non-number cards when an opponent is at <=2, holds wilds.
- **Hard is a light Monte-Carlo planner** (`planHard`), NOT a pure heuristic: `HARD_ROLLOUTS` (=3)
  self-vs-self playouts per legal move via `UnoGame.fromSnapshot`, best win rate wins; clones share
  the caller's `rng` (reproducible). Rollout policy is `pickCard` at `'hard'`: answer an active +2
  stack with a +2; in 2p spend Skip/Reverse the instant legal; hold a lone +2 unless punishing a low
  opponent or holding two+; in 3-4p spend an action card only when the NEXT player is the
  lowest-card opponent at <=2.
- **Wild-colour memory** (`memory.byPlayer`, Hard-only, optional): `avoid` set of colours opponents
  forced; a mild tie-break only (a stronger variant measured *worse*). `ui.js` builds it from
  `colorChosen` events.

**Measured, do not re-litigate:** a pure-heuristic Hard topped out ~52% vs Medium (short of the 55%
bar); even 20 random rollouts win ~88% vs Medium, so the game is not luck-capped. **2026-07-25, 500
seeded 2p games, seat parity alternated: Hard beats Easy 85.0%, Medium 85.8%** (thresholds 65% / 55%),
asserted in `test.js`. If you touch `ai.js`, re-run `node uno/js/test.js` and update these numbers.

## UI notes (`ui.js`)

- **Seat ASSIGNMENT is fixed: human is always engine index 0**, AI opponents fill 1..n-1 from the
  profile's `opponents` (name/emoji; difficulty is one global setup choice, not per seat).
- **`nextStarter` rotates who OPENS the hand, through every seat including the human's.**
  `startGame()` passes `startPlayer: this.nextStarter % this.players` and advances `nextStarter`
  BEFORE building the game (so the rotation survives leaving mid-game); persisted in
  `gamehub.uno.v1`. The first-card flip only randomizes which CARD starts the pile, never who acts.
  Do not conflate "seat 0 is the human" with "seat 0 opens".
- **`_afterStateChange()` decides busy/scheduling BEFORE rendering**: compute `pi`/`legal`/`autoDraw`
  and set `this.busy` first, then render, then schedule the next timer (otherwise legal cards render
  disabled one frame after an AI turn).
- **Draw-until-playable and penalty draws are auto-driven for BOTH human and AI** (`autoDraw =
  legal.mustDraw`, paced by `DRAW_STEP_MS`). The one human decision is drawing voluntarily despite
  holding a playable `+2`; only then is the draw pile tappable alongside a live card.
- **Wild colour is collected client-side** (`this._pendingWildId` + chooser overlay, then
  `game.play(HUMAN, id, color)`); `chooseColor()` is invoked from the UI only for the first-card wild
  (`g.phase === 'chooseColor' && g.pendingWild.isFirstCard`, human opener only). `_onChooseColor` re-validates turn +
  hand membership; hand cards render disabled while a chooser is open; `startGame()` clears a stale
  `_pendingWildId`.
- **Colorblind-safe cards** (the non-negotiable rule): hub palette (yellow circle, blue triangle,
  vermilion square, teal diamond), shape in both corners, in the oval and on the chooser, never hue alone.
  Colour names in copy stay Red/Yellow/Green/Blue (Rojo/Amarillo/Verde/Azul).
- **The chooser blanks `.un-status` while open** (`chooserOpen`; `.un-status` keeps its fixed height).
- **Penalty-draw toast**: the engine emits `penaltyDraw {playerIndex, amount}`; `_onEngineEvent` sets
  a transient `this._penaltyToast` (`PENALTY_TOAST_MS` 2200), never snapshotted, shown on the felt.
- **Play-direction arrow** (`dirArrowSVG`) only when `this.seats.length > 2`, off `g.direction`.

## The play screen (overhaul 2026-10-23) - what is in force

Matt: *"The cards don't move like any other game. They aren't displayed like any other game. And most
of the gameplay screen is dead space."* Rebuilt to match Chinchón/Escoba. The 2026-07-25 spec
(fan, UN-1..UN-9 geometry, keyframe flights) is retired; its text is in `CLAUDE-HISTORY.md`.

- **Immersive** (`js/hub.js`). Column: opponent pills + ☰ menu (52px) / green felt `flex: 1` / your
  chip + sort (44px) / the hand. `_fit()` sizes `.un-game` to the host by the Dominoes PROBE
  (2000px, `below = scrollHeight - top - PROBE`) and `_refitSoon()` re-fits after a resume.
- **Hand = `handLayout(n, {A, cw, maxH})`** (pure, exported): straight cards overlapped left to right,
  >= 38% of each showing, balanced rows, lower rows in front about half a card down; past two rows the
  card size steps down so the hand never exceeds `handMaxH`. Card nodes are keyed by id and reused
  (`_syncHand`), position is `--x/--y` with a 220ms transform transition, so relayout/sort SLIDES.
  Playable: lifted 14px + gold ring; unplayable on your turn: dimmed (position is the non-colour cue).
- **Piles** sized per render from the felt's real height (`_sizePiles`), capped by width.
  Colour in force = a ring round the discard + a chip carrying its SHAPE; `+N` stack badge on the pile.
- **Card face is all em** (`font-size = --cw / 6`): tilted white oval, italic numeral in the card
  colour, faint shape in the oval, shape + value in BOTH corners; wild = four-hue oval with the four
  shapes; back = black card, red oval, "UNO". Cards are `<div role="button">` (Part 0), keyboard via `onKey`.
- **Card travel = Chinchón's `_fly`**: a copy in `.un-flight` (fixed), translate+scale via Web
  Animations, `FLY_MS` 340, `cubic-bezier(.25,.8,.35,1)`, deal gap 45ms round the table from the
  opener, then the first discard turns up. Stock cards fly face down and `_turnUp` on landing. A played
  card's pile slot stays hidden (`_landing`) until it lands, then a re-render shows it with its ring.
  A computer's draws fly to its pill (`_seenCounts` diff). Flights run under reduced motion (gameplay
  motion); only the turn pulse and pops are garnish. A fresh shell (resume) shows the hand silently.
- Menu (☰ bottom sheet): How to play, Restart (tap-again confirm), New game. Overlays are `position: fixed`.
- Token discipline still holds: colours only in the two token blocks (gate grep at the top of `uno.css`).
- **Names, never "You"**: the toast and win title use the profile name (`penalty_draw_opp`, `opp_wins`).
- **Fixed 2026-10-23: a first-card Wild owned by a COMPUTER froze the hand** (the chooser went to the
  human, `_onChooseColor` refused it). `_afterStateChange` now lets that computer pick
  (`pickWildColor`, now exported from `ai.js`; AI behaviour unchanged).

## Autosave/resume

`gamehub.uno.save.v1`: `{ v:1, at, seats, difficulty, snap: game.snapshot() }`, silent restore on
mount, snapshotted after every settled action via `_afterStateChange()`. A save older than 30 minutes
or failing the shape check (seat count, player count, not `phase === 'over'`, known difficulty) is
wiped, not crashed on. Cleared on match end (`finish()` ) and the setup route; never on `destroy()`.
Listed in `js/device-report.js` `perGame` (`unoSettings`/`unoSave`).

## Setup screen

Escoba-style accordion rows (`_row`/`_seg`): **Players** (2/3/4), **Difficulty** (Easy/Medium/Hard
with `diffShapeSVG`/`tierOf`, one global setting), **Computer speed**. `gamehub.uno.v1` carries
`players`, `difficulty`, `nextStarter`, `pace`, `handSort`; every write goes through `_saveSettings()`.

## Stats

Generic path only, no sub-counter: `recordResult('uno', difficulty, won)`. `'uno'` must be in
`js/game-stats.js` `GAMES` (or the write silently no-ops), `js/game-stats-ui.js` `TABS` and
`js/leaderboard-ui.js` `GAME_META`. Art: `GAME_ART['uno']`. Head-to-head is MP-only and out of scope
until Uno gets a multiplayer pass.

## Computer speed and hand sort (2026-09-28)

- **Computer speed** Slow/Normal/Fast (`row_speed`), `pace` additive in `gamehub.uno.v1` (absent =
  Normal). `_aiMs()` scales only a computer's think pause and draw steps (x1.6 / x1 / x0.3).
- **Hand sort**: `sortedHand(hand, mode)`, modes `draw`/`color`/`rank`, applied to a COPY at render
  time (engine, `play()` ids and save never see it). Button on your row, 44px.

## Tests

```
node uno/js/test.js          # 99 assertions incl. AI win-rate harness (~10s extra)
node tools/test-i18n-strings.mjs; node tools/test-game-conventions.mjs; node tools/check-no-scroll.mjs uno
```
Covers deck composition, +2 stacking, penalty lump vs draw-until-playable, reshuffle total, Reverse as
Skip at 2p vs flip at 3+, every first-card rule **re-proven relative to a non-zero `startPlayer`**
(the regression guard for the opener bug), win detection, 60 AI-vs-AI games, and the 500-game
Hard-vs-Easy/Medium harness (>=65% / >=55%).

## The computer's dice are seeded (2026-10-29)

`aiSeed` (per match, in `gamehub.uno.save.v1`): `chooseAction` and wild colours take `seededRng(seed, positionKey)`, the deal takes `seededRng(seed, 'deal')`, a restore seeds the engine's reshuffle from the save. `tools/test-ai-resume-seeds.mjs`.

## Quitting and easier settings (2026-10-29)

Restart / New game after the player's first play or draw (`moved` in the save) = ONE loss, asked twice; a hand found past its 30-minute save is that loss on load (it used to vanish). Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29: quitting and easier settings"; `node tools/test-quit-loss.mjs`.
