# Uno (`uno/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Built 2026-07-24 per `HANDOFF-UNO.md` (root, kept for the ruleset rationale). 2-4 players, solo vs AI.
In-hub `module:`, not immersive. `isInProgress()` is always `false` (autosave/resume built in).
Visual rebuild 2026-07-25 per `docs/archive/UNO-DESIGN-SPEC.md` + `docs/archive/HANDOFF-UNO-VISUAL.md`; computer speed, hand
sort and card travel 2026-09-28. Never click-tested end to end: the wild-colour chooser and win
overlay (manual pass if a report suggests that flow is broken); not yet checked by eye on a phone.

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
  (`g.phase === 'chooseColor' && g.pendingWild.isFirstCard`). `_onChooseColor` re-validates turn +
  hand membership; hand cards render disabled while a chooser is open; `startGame()` clears a stale
  `_pendingWildId`.
- **Colorblind-safe cards** (the non-negotiable rule): hub palette (yellow circle, blue triangle,
  vermilion square, teal diamond), shape in both corners and on the chooser chips, never hue alone.
  Colour names in copy stay Red/Yellow/Green/Blue (Rojo/Amarillo/Verde/Azul).
- **The chooser blanks `.un-status` while open** (`chooserOpen`; `.un-status` keeps its fixed height).
- **Penalty-draw toast**: the engine emits `penaltyDraw {playerIndex, amount}`; `_onEngineEvent` sets
  a transient `this._penaltyToast` (`PENALTY_TOAST_MS` 2200), never snapshotted. The pending badge
  (`.un-pendingbadge`) is a `.un-mat` child (a stack and a chooser can never coexist).
- **Play-direction arrow** (`dirArrowSVG`) only when `this.seats.length > 2`, off `g.direction`.

## Visual rebuild (2026-07-25) — what is in force

### The token system (UN-1)

`uno/css/uno.css` has exactly two token blocks: `.un-root` (all tokens) and `:root.gh-dark .un-root`
(chrome overrides ONLY). **Every rule outside them consumes tokens: zero literal colours, shadows,
radii or font-sizes.** Gate after any CSS edit: `grep -nE "rgba?\(|#[0-9a-fA-F]{3,6}" uno/css/uno.css`
must hit token blocks only.

- Four card hues + `--un-accent` are the locked hub palette. **Theme-invariant by design:
  `--un-table` and every card token** (rim, edge, medallion, gloss, numeral shade, card ink, back
  stripe, shadows); dark mode overrides chrome only (`--un-bg/surface/ink/muted/border`). Do not add
  card tokens to the dark block.
- Shadows are a three-state stack (`--un-sh-rest/raised/lift`); no component improvises its own.
- Cards `--un-card-w/h` = 62x92 (`border-box`), small cards 48x71.

### The fan (UN-3, multi-row since UN-8) - geometry

`fanLayout(n, {W=62, H=92, STEP=32, ROW_PITCH=58, A=452, RESERVED_H=150})` in `ui.js` is pure and
holds every constant. Balanced rows (`PER_ROW = max(1, floor((A-24-W)/STEP)+1)`, 13 cards is 7+6),
`x=(j-c)*STEP`, `y=r*ROW_PITCH + min(8,(j-c)^2*0.4)`, `z=r*100+j`, `fit=min(1, RESERVED_H/needH)`,
`needH=H+ROW_PITCH*(rows-1)`. `STEP/W ≈ 51.6%` so at least half of every overlapped card is visible
at any `fit`.

- `_syncFan` passes the RAW measured `A = min(452, .un-hand clientWidth)`; the 24px breathing room is
  subtracted INSIDE `fanLayout`, **do not subtract it twice**. A `window` resize listener re-renders
  (removed in `destroy()`).
- **Every card's `y` carries `shiftY = RESERVED_H - needH`: load-bearing, do not drop it** (the
  `scale(fit)` origin is the box bottom; without it a 3-row hand drifted ~42px past the box).
- `.un-hand` is a fixed 150px box, no scroll container, `overflow-x` banned. `.un-fan .un-card` has
  `top: 0`; do not add a static top offset without re-deriving `RESERVED_H`.
- **Display order is the REVERSED engine hand** (newest card at the left end of the TOP row);
  presentation only, every `data-id`/`play()` uses the real id. `sortedHand()` absorbs it as `draw` mode.

### The card face (UN-2)

- The rim is `box-shadow: inset` stacked onto `--un-sh-rest`, not a `border`. **`.un-card` is a
  `<button>`: keep the explicit `border: none`**; any card-like `<button>` that swaps a border for a
  shadow needs the same reset.
- `medallionHTML(card)` only calls `shapeSVG()` (the one shape function). Wild = four quadrant
  shapes (`scale(.5)` + translate) **clipped by CSS `clip-path: circle(47.5%)` on
  `.un-medallion-wild`, NOT an SVG `<clipPath id>`** (flight clones `cloneNode(true)` the card and an
  id-referenced clip lost its target mid-flight). Do not reintroduce an SVG clipPath for per-card
  cloned markup.
- Only the top-left corner mark exists (`.un-corner`, `z-index: 2` above the numeral's 1); a buried
  card only exposes its left edge. Action glyphs use `.un-glyph-action` (26px). Small cards
  (`.un-card-sm`, how-to diagram only): numeral and corner hidden, medallion 36px.

### The `_syncFan` render exemption (UN-3c - load-bearing, do not "fix" back)

`renderGame()` does not rewrite the container as one string. `_ensureGameShell()` builds a persistent
skeleton once per entry into the game view; each render rebuilds the REGION CONTENTS and `_syncFan()`
reconciles card nodes in place, keyed by `data-id` (a re-inserted node or re-parented ancestor kills
CSS transitions). Invariants: every call is a FULL stateless reconciliation; card nodes are never
moved or reparented (position and paint order ride custom properties; DOM order diverges from
display order, accepted); removal is IMMEDIATE and flights use detached clones in a fixed layer;
`_syncFan` + `_buildCardEl` are the ONLY code that mutates card DOM outside a template string.
Consequences: overlays survive re-renders, so `startGame()` calls `closeOverlays()`; `renderSetup()`
rewrites the whole container and must null `_fanEl`/`_regions`.

### Fixed geometry (UN-5/UN-8/UN-9)

`.un-opponents` (58px since the face-down fans, was 44), `.un-status` (22), `.un-mat` (148),
`.un-handwrap` (170 = 150 fan + 20 UNO chip slot), `.un-bar` (40) are explicit `height` with
`box-sizing: border-box`. **`.un-unoslot` has an unconditional `height: 20px`** (it used to grow when
the chip appeared and shift the fan on the most dramatic moment). `.un-opponents` is `flex-wrap:
nowrap`; `.un-oppchip { flex: 1 1 0; min-width: 0 }` and `.un-oppname { min-width: 0; overflow: hidden;
text-overflow: ellipsis; white-space: nowrap }` (ellipsis needs `min-width: 0`).

### Motion system (UN-4) - spec §6

- Every duration/easing is a named token (`--un-dur-*`/`--un-ease-*`); no inline durations or
  `cubic-bezier(...)` literals. Penalty draws arrive `--un-draw-stagger` (90ms) apart.
- **Only one `transition` is active on `transform`**: rows 2 (relayout 260ms), 7 (legal lift 180ms)
  and 11 (press 120ms) are layered by cascade (`:active` > `.is-live` > base); a legal card being
  relaid-out animates at 180ms. Deliberate approximation.
- **Non-persistent regions (mat, opponents, UNO slot) use `@keyframes` gated by "did it change"
  flags**, never transitions: `_lastDiscardId` + `_discardRot` (rows 4/5), `_revealPending` (set by
  `startGame()`), `_lastPendingDraw` (row 8), `_lastHandLen` (row 10), `_aiPulsePi` (row 12 chip).
- **Flights (rows 1, 3, 6, 12) are fixed-position clones in `.un-flightlayer`** (built once in
  `_ensureGameShell()`); `_spawnFlight()` builds/animates/removes one (static inline left/top/size,
  only `transform` moves; removed on `animationend` with a `FLIGHT_SAFETY_MS` fallback). A newly
  inserted fan node is hidden (`un-card-entering`) until its clone lands. Row 3: clone the fan node
  BEFORE `g.play()`. Row 12: clone fresh from `cardHTML()`, capture the chip rect before `g.play()`.
- **`prefers-reduced-motion`**: blanket 0.01ms override, rows 8/10 keep a 120ms opacity-only fade,
  `.un-flightlayer` is `display: none`. `_spawnFlight()` checks `matchMedia` FIRST and resolves
  `onDone` synchronously (a hidden layer never fires `animationend`).
- Row 13 (sort) needs no code: `_syncFan` is keyed by id, so reordering animates via row 2.

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

## Computer speed, hand sort and card travel (2026-09-28)

- **Computer speed** Slow/Normal/Fast (`row_speed`), `pace` additive in `gamehub.uno.v1` (absent =
  Normal). `_aiMs()` scales only a computer's think pause and draw steps (x1.6 / x1 / x0.3).
- **Hand sort (UN-6)**: `sortedHand(hand, mode)`, modes `draw`/`color`/`rank`, applied to a COPY at
  render time (engine, `play()` ids and save never see it). Control `.un-sortbtn` (28px drawn,
  `::before` stretches the target past 44px; a fourth footer button wrapped every label).
- **A played card does not show on the pile before it lands**: `this._landing` holds ids in the air;
  `renderGame` draws that top card `visibility:hidden`; `_landDiscard()` reveals it. Every failure
  path of `_flyToDiscard`/`_flyFromChip` still lands.
- Discard is a stack (`.un-under` at remembered tilt `_rots`, `.un-top`). Computers' hands are visible
  face down (`.un-oppfan`, up to 8 backs + count); their draws fly (`_seenCounts` diff, `_flyToChip`),
  seeded from the snapshot on resume so nothing replays.

## Tests

```
node uno/js/test.js          # 99 assertions incl. AI win-rate harness (~10s extra)
node tools/test-i18n-strings.mjs; node tools/test-game-conventions.mjs; node tools/check-no-scroll.mjs uno
```
Covers deck composition, +2 stacking, penalty lump vs draw-until-playable, reshuffle total, Reverse as
Skip at 2p vs flip at 3+, every first-card rule **re-proven relative to a non-zero `startPlayer`**
(the regression guard for the opener bug), win detection, 60 AI-vs-AI games, and the 500-game
Hard-vs-Easy/Medium harness (>=65% / >=55%).
