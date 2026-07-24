# Uno (`uno/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Built 2026-07-24 per `HANDOFF-UNO.md` (root, kept for the ruleset rationale). 2-4 players,
solo vs AI. Hub integration: in-hub `module:`, not immersive. `isInProgress()` uses the
"autosave/resume built in" meaning: always `false` — see "Autosave/resume" below.

## Layout & responsibilities

```
uno/js/game.js     pure engine (no DOM, no Math.random, injected rng, presetDeck hook)
uno/js/ai.js        pure AI: easy/medium/hard, samples only from the engine's legal-move list
uno/js/ui.js        DOM, setup screen, render loop, hub init/destroy contract
uno/js/strings.js   { en, es } - every user-visible string
uno/js/test.js      headless engine assertions (node uno/js/test.js), in run-all-tests.mjs
uno/css/uno.css     all styles, .un- prefixed, every rule descendant-scoped under .un-root
uno/index.html      standalone host (same init() as in-hub)
```

## Matt's ruleset (decided 2026-07-24 — do not re-litigate)

- **Draw rule: draw until you can play**, then you MUST play the card you drew. A pending
  +2 stack you cannot answer is the one exception: you draw the accumulated penalty as a
  single lump and are skipped — penalty draws are never draw-until-playable.
- **+2 stacking ON**: any +2 answers a +2, passing the accumulated total on; whoever can't
  (or chooses not to) answer draws the whole pile and is skipped. **Wild +4 does NOT
  stack** and is not a legal response to a pending +2 stack — it is always a legal move on
  an ordinary turn (`pendingDraw === 0`) instead, no challenge mechanic.
- **Jump-in: OFF.** No out-of-turn play of identical cards, ever.
- **7-0 swap: OFF.** No hand swapping/rotation.
- Standard elsewhere: 108-card deck, 7 cards dealt, Reverse acts as Skip with 2 players,
  win by emptying your hand, single-hand games with a rematch.
- **Deliberate simplifications** (per the handoff): Wild +4 has no challenge/accusation
  mechanic (it needs hidden-hand reasoning that doesn't apply against AI); the "Uno!" call
  is automatic — a persistent badge on any player at exactly one card, no catch/penalty.
- **First-card rules**: a flipped Wild +4 is returned to the deck and reflipped (loops
  until non-Wild+4); any other action card applies to player 0 (skip/+2 target them, a
  Reverse behaves per the 2-player-acts-as-skip rule); a Wild lets player 0 (always the
  human — see "Seats" below) choose the color, with no skip of their own turn.
- **Deck exhaustion mid-draw** reshuffles the discard pile (minus its top card) into a new
  deck. Wilds exist in every reshuffle, so draw-until-playable always terminates.

## Engine notes (`game.js`, correctness-critical)

- **MP-lockstep-clean by construction**, even though this batch ships solo only: no
  `Math.random` inside the engine (rng is injected), a `presetDeck` hook (Chinchón's
  pattern) so a future host can transmit deals deterministically, every state change is an
  explicit action (`play(playerIndex, cardId, color?)` / `draw(playerIndex)` /
  `chooseColor(playerIndex, color)`) applied by one method each, and the whole state is
  plain JSON via `snapshot()`/`UnoGame.fromSnapshot()`.
- **Turn advance is one primitive, `_advance(steps)`**, computed as `steps` single hops
  around `(currentPlayer + direction + n) % n`. Skip = advance 2. Reverse with 2 players =
  advance 2 (lands back on the same player, i.e. the standard "acts as skip" reading) and
  does **not** flip `direction` — flipping direction and advancing 1 in a 2-player game
  mathematically lands on the OTHER player, which is just an ordinary pass, not a skip; do
  not "simplify" this by always flipping direction. Wild+4 draws its victim (`peekNext(1)`)
  4 cards, then advances 2 from the ORIGINAL current player - the intermediate hop of that
  advance is guaranteed to be the same victim regardless of direction, so the victim is
  drawn once and skipped in one coherent step.
- **`chooseColor` is a distinct action from `play`** so a wild card can be played without a
  color and resolved in a second call (`phase` becomes `'chooseColor'`, `pendingWild` names
  who owes a color) — used by the engine itself for the first-card-flip Wild case, where no
  one "played" the card. `ui.js` also accepts `play(pi, cardId, color)` in one call for the
  ordinary case (the UI collects the color client-side before submitting), so
  `chooseColor()` as a *separate UI-invoked action* only fires for the first-card scenario.
- **`getLegalMoves(playerIndex)`** is the single source of truth for what's playable, and
  branches once on `pendingDraw`: `pendingDraw > 0` restricts `canPlay` to the hand's `+2`
  cards (any color - stacking doesn't check color) and reports `drawIsPenalty`/
  `penaltyAmount`; `pendingDraw === 0` filters by `_matches()` (same color, same number
  regardless of color, same action kind regardless of color, or any wild). AI and UI both
  read this instead of re-deriving legality, so there is exactly one legality
  implementation in the whole game.
- **`totalCardCount()`** (deck + discard + every hand) must always read 108; `test.js`
  checks it after reshuffles and after each of 60 full random games.
- **`_flipFirstCard()`'s every branch is stated RELATIVE to `this._startPlayer`** (the
  constructor's `startPlayer` option, default 0), never relative to seat 0 literally: a
  number card opens on `startPlayer`; skip/reverse(2p)/+2 target `startPlayer` and open on
  `(startPlayer+1)%n`; reverse at 3+ players flips direction and opens on
  `(startPlayer-1+n)%n` (the seat immediately before `startPlayer` in the original order,
  since the flip acts as if a virtual player before `startPlayer` had played it); a first-
  flip wild is chosen by `startPlayer` itself, who then still opens (no self-skip). This is
  what lets `ui.js` rotate who opens each hand — see "UI notes" for why that matters and the
  bug this fixed.

## AI notes (`ai.js`)

Difficulty ids `easy`/`medium`/`hard` (already mapped to tiers 1-3 in
`js/difficulty-tiers.js`, so no new tier work was needed). Every decision comes from
`game.getLegalMoves()` — never invented — and is a plain `{ type: 'play'|'draw', cardId?,
color? }` action, replayable for a future MP host. Easy is uniform-random over legal
cards/colors. Medium+ prefers cards matching the hand's majority color, dumps non-number
cards when an opponent is at ≤2 cards, and holds wilds until nothing else is legal (they're
naturally last since `pickCard` only reaches the `wilds` fallback once `nonWild` is empty).
Hard additionally: always answers an active +2 stack with its own +2 if it has one (never
voluntarily eats the pile), and targets Skip/Reverse/+2 at whichever opponent is about to
move (`game.peekNext(1)`) when that opponent is also the lowest-card player.

## UI notes (`ui.js`)

- **Seat ASSIGNMENT is fixed: human is always engine index 0**, AI opponents fill 1..n-1
  from the shared profile's `opponents` (name/emoji; skill isn't consulted per-seat since
  difficulty is one global setup choice, not per-opponent - see "Setup screen" below). This
  keeps the engine's `startPlayer`-relative first-card rules simple to reason about and
  matches every other module game's P1-is-human convention. **Who OPENS the hand is a
  separate, genuinely rotating concept** - see `nextStarter` immediately below; do not
  conflate "seat 0 is always the human" with "seat 0 always opens," the two used to be
  wrongly coupled here (see "Corrected 2026-07-24" below).
- **`nextStarter` rotates who OPENS the hand, through every seat including the human's.**
  `UnoGame`'s constructor takes a `startPlayer` option (default 0); `_flipFirstCard()`
  computes every first-card effect RELATIVE to it (skip/reverse/+2/wild all target
  `startPlayer`, never seat 0 literally - see "Engine notes" above). `ui.js.startGame()`
  passes `startPlayer: this.nextStarter % this.players` and immediately advances
  `nextStarter` to the next seat, banked before the game is built so the rotation survives
  leaving mid-game (mirrors `mancala/js/ui.js`'s `startGame()` alternation). Persisted in
  `gamehub.uno.v1` alongside `players`/`difficulty`. **The first-card flip only randomizes
  which CARD starts the discard pile, never who acts on it** - `startPlayer` is the only
  thing that actually varies who opens.
- **Corrected 2026-07-24 (verification finding).** The first build hardcoded every
  first-card rule to seat 0 and had `nextStarter` rotate which PROFILE OPPONENT filled the
  AI seats instead - a misreading of "the engine already randomizes who opens" that
  conflated "which card flips" with "who acts on it." In reality the human (seat 0) opened
  essentially every hand except when the flipped card happened to be an action card that
  redirected control - roughly 70% of hands, not the ~1/n a rotating opener should give. Fixed
  by adding `startPlayer` to the engine (see "Engine notes") and repointing `nextStarter` at
  the actual opening seat; the AI-opponent-seat-shuffle idea was dropped rather than kept
  alongside it, to avoid two different things rotating under one persisted field.
- **The `_afterStateChange()` funnel decides busy/scheduling BEFORE rendering, not after.**
  An earlier draft called `renderGame()` first and updated `this.busy` afterward for the
  *next* call — which meant every render showed the PREVIOUS turn's busy state, so a
  human's legal cards rendered disabled for one extra frame right after an AI turn resolved
  (only visible by actually clicking through a game in-browser, not from the headless engine
  tests). Fixed by computing `pi`/`legal`/`autoDraw` and setting `this.busy` first, then
  rendering, then scheduling the next timer.
- **Draw-until-playable and penalty draws are both auto-driven for BOTH human and AI**, via
  one `autoDraw = legal.mustDraw` check in `_afterStateChange()`: if there is truly no
  legal card (or, during a pending stack, no `+2` to answer with), there is no real decision
  to make, so the UI drives the draw itself (paced by `DRAW_STEP_MS`) rather than waiting
  for a tap. The one real human decision during a pending stack is choosing to draw
  voluntarily despite HAVING a playable `+2` ("or chooses not to answer," per the ruleset) -
  that's the only case the draw pile renders tappable while a card is also live.
- **Wild color selection is collected client-side before the engine call.** Tapping a wild
  card in hand stores `this._pendingWildId` and shows the color-chooser overlay in place;
  picking a color calls `game.play(HUMAN, id, color)` in one shot. The engine's own
  `chooseColor()` action is only invoked from the UI for the first-card-wild case
  (`g.phase === 'chooseColor' && g.pendingWild.isFirstCard`), which the render function
  detects and shows the same overlay for automatically, no card tap involved.
- **Colorblind-safe cards** (Matt is red/green colorblind - the one non-negotiable visual
  rule, root CLAUDE.md): the four colors are the hub palette (yellow `#F2B705` circle, blue
  `#1F5FA8` triangle, vermilion `#E0532F` "red" square, teal `#178A7A` "green" diamond) and
  every card carries its shape in both corners; the wild color chooser shows shape+color
  chips, never hue alone. Card color names in copy stay Red/Yellow/Green/Blue (English) /
  Rojo/Amarillo/Verde/Azul (Spanish) even though the underlying hex/shape pairing is the
  hub's vermilion/teal convention.
- **The "Uno!" indicator is a persistent computed badge, not a timed toast.** Any seat
  (human or AI) with exactly one card shows a small "UNO!" chip next to their name/count,
  recomputed every render straight from `hand.length === 1` — simpler and more robust
  against re-renders than a timer-based banner, and satisfies the handoff's "a banner when
  any player reaches one card, no catch/penalty mechanic" without extra state to track.

### Autosave/resume

`gamehub.uno.save.v1`, batch-9 convention (silent restore on mount, no "resume?" dialog):
`{ v:1, at, seats, difficulty, snap: game.snapshot() }`. Snapshotted after every settled
engine action via the same `_afterStateChange()` funnel that renders and schedules the next
turn. A save older than 30 minutes, or one that fails a hard shape check (seat count,
matching player count in the snapshot, not already `phase === 'over'`, a known difficulty
id), is treated as no save and wiped rather than crashing the mount - mirrors
Filler's/Mancala's `loadGame()`. Cleared on match end (`finish()`) and on the setup screen
route (Restart, New game, quit-to-setup all end up rendering setup, which never reloads a
stale save since `loadGame()`/resume only run from the constructor). Never cleared on
`destroy()` or hub navigation. Listed in `js/device-report.js`'s `perGame` (`unoSettings`/
`unoSave`).

### Setup screen

Escoba's accordion pattern (`_row`/`_seg`, mirrors Tic Tac Toe's `_row`/`_seg`): two rows,
**Players** (2/3/4) and **Difficulty** (Easy/Medium/Hard with `diffShapeSVG`/`tierOf`
shapes, one global setting - not per-opponent, per the handoff). No per-opponent difficulty
picker like Escoba/Chinchón; simpler because Uno's AI difficulty doesn't need to vary by
seat for the game to read clearly at 2-4 players.

### Stats

Generic path only, no bespoke sub-counter (deliberately, per the handoff, to avoid the
three-edit sub-counter trap in root CLAUDE.md's "Adding a game" item 7): `recordResult('uno',
difficulty, won)`. `'uno'` is registered in `js/game-stats.js`'s `GAMES` whitelist (or the
write silently no-ops), `js/game-stats-ui.js`'s `TABS`, and `js/leaderboard-ui.js`'s
`GAME_META` - both of the latter two exist post-FB2-STATS-NAV and must each carry the entry
independently (confirmed by reading the current code, not assumed from the pre-refactor
handoff). `game_title_uno` lives in `js/strings.js` (both languages) and in `uno/js/strings.js`'s
own `title` key. Art: `GAME_ART['uno']` in `js/game-art.js` (fanned cards, landscape
160x90). Head-to-head capture is MP-only and out of scope until Uno gets a multiplayer pass.

## Tests

```
node uno/js/test.js
```
97 assertions: deck composition (exact counts per color/kind), +2 stacking accumulation and
resolution, penalty draws being a single lump (not draw-until-playable), draw-until-playable
stopping at the first legal card and forcing its play, reshuffle-on-exhaustion preserving
the 108-card total, Reverse-as-Skip at 2 players vs. a real direction flip at 3+, every
first-card rule including the Wild+4 reflip **re-proven relative to a non-zero `startPlayer`
for every card kind** (number/skip/reverse at 2p and 4p/+2/wild, plus an end-to-end
`UnoGame` construction opening on the requested seat for all 3 seats of a 3-player game),
win detection, and 60 full AI-vs-AI random games (20 each at 2/3/4 players, seeded rng) all
terminating with the card count intact. Wired into `run-all-tests.mjs`.

## Verification (2026-07-24)

Browser-tested at 375x812: setup screen (both rows, Start), a live 2-player game (legal-card
highlighting, AI turns, draw-until-playable including a multi-draw AI turn), autosave/resume
across a hard reload, the how-to-play sheet, and dark mode (`:root.gh-dark .un-root`
resolving its overridden custom properties). Found and fixed two real bugs this way that
unit tests alone did not catch:

1. The busy-flag-before-render ordering (see "UI notes" above) — a stale render, not a
   wrong engine state, so headless assertions on engine state couldn't see it.
2. **The opener-alternation deviation** — first shipped with every first-card rule
   hardcoded to seat 0, so the human opened ~70% of hands regardless of `nextStarter`
   (see "UI notes"'s "Corrected 2026-07-24" note). Caught by a verification pass that
   actually started several games in a row and read the persisted `nextStarter`/opening
   seat back out of `localStorage`, not by code review or the original engine tests —
   the original 86 assertions all passed with the bug present, because they only ever
   constructed games with the (then-only) default seat-0 opener and had nothing to
   compare it against. The new relative-`startPlayer` tests above are the regression
   guard; do not add a first-card code path that reads `0` for "the opener" directly —
   read `this._startPlayer` (or take it as a parameter) instead.

The wild-color chooser and win overlay were verified by code review and are exercised
indirectly by `test.js`'s AI-vs-AI games (which choose wild colors and reach
`phase === 'over'` routinely) but not click-tested end-to-end in the browser this pass -
worth a manual pass if a report ever suggests that flow is broken.
