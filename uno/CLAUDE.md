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
color? }` action, replayable for a future MP host. **`chooseAction` is a pure function of
`game`/`playerIndex`/`difficulty`/`rng`** plus ONE optional read-only side channel, `memory`
(below), so the whole AI stays headless-testable with no DOM.

- **Easy** is uniform-random over legal cards (untouched — do not add heuristics to its
  branch). Wild colour still comes from `pickWildColor` (hand majority) for every difficulty.
- **Medium** (`pickCard`, difficulty `'medium'`) prefers the hand's majority colour, dumps
  non-number cards when an opponent is at ≤2 cards, and holds wilds until nothing else is
  legal (they're naturally last since the `wilds` fallback is only reached once `nonWild` is
  empty).
- **Hard is a light Monte-Carlo planner** (`planHard`), NOT a pure heuristic. For each legal
  move it plays out `HARD_ROLLOUTS` (=3) quick self-vs-self games with `UnoGame.fromSnapshot`
  and keeps the move with the best win rate; clones share the caller's `rng`, so the search
  is a pure, reproducible function of the seed. The **rollout policy is `pickCard` at
  difficulty `'hard'`** — a shaped heuristic that carries every behaviour the FB4 QA asked for
  and drives every simulated line: answer an active +2 stack with a +2 (never eat the pile);
  in 2p, spend Skip/Reverse the instant they're legal (Reverse acts as Skip, so each is a
  risk-free extra turn toward emptying the hand — the single biggest heads-up lever); hold a
  lone +2 unless punishing a low opponent or holding two+ (a solo +2 the opponent must answer
  can start a stacking war you then lose); in 3-4p, only spend an action card when the seat it
  would structurally hit (the NEXT player — a Skip/Reverse cannot be aimed at an arbitrary
  seat in this engine, see `_advance`) is the lowest-card opponent at ≤2, otherwise hold the
  weapons and play a number, majority colour first.
- **Wild-colour memory** (`memory.byPlayer`, Hard-only, optional): `pickWildColor` takes an
  `avoid` set of colours OPPONENTS have forced with a wild; it's a mild tie-break (−1 vs a
  colour-strength weight of ×2), so it only ever breaks a tie between equally-strong colours —
  never strands the AI in a weak colour to spite an opponent (that variant measured *worse*).
  `ui.js` builds `memory` from the engine's `colorChosen` events; omit it and play is
  identical bar that tweak.

**Why a planner and not just the heuristic (measured, do not re-litigate):** a *pure*-heuristic
Hard topped out at ~52% vs Medium in the 500-game harness — Medium's majority-colour play is
already strong, so the tempo/targeting edges only bought ~2 points, short of the 55% bar. The
Monte-Carlo probe (`test.js`) showed the game is NOT luck-capped (even 20 random rollouts win
~88% vs Medium), so Hard was rebuilt as the rollout planner. **Measured 2026-07-25 over 500
seeded 2p games each, seat parity alternated to cancel the opener advantage: Hard beats Easy
85.0%, Hard beats Medium 85.8%** (thresholds 65% / 55%). These are asserted in `test.js` and
fail the suite if they regress — if you touch `ai.js`, re-run `node uno/js/test.js` and update
these numbers here.

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
- **The wild colour chooser blanks the turn-status line while it's open** (FB4 QA fix,
  2026-07-25). `.un-colorchoose` is `position:absolute; inset:-10px` inside the
  `position:relative` `.un-mat`, so its "Choose a color" heading used to overlap the
  `.un-status` line ("Your turn") sitting directly above the mat. `renderGame` now renders
  `.un-status` empty whenever `chooserOpen` (`showFirstCardChooser || showCardWildChooser`) —
  the chooser is a modal dialog, so the status text is redundant while it's up. Covers both
  chooser cases (first-card wild and a mid-hand wild tap) and both languages (the status is
  blanked, not translated). `.un-status` keeps its `min-height` so layout doesn't jump.
- **Penalty-draw toast + a prominent pending badge** (FB4 QA, 2026-07-25). The engine already
  emits `penaltyDraw {playerIndex, amount}` (a +2-stack lump, a Wild+4 victim, or a first-card
  +2); `ui.js` wires `onEvent` on both the `new UnoGame` and `fromSnapshot` paths to
  `_onEngineEvent`, which sets a short-lived `this._penaltyToast` ("You drew {n}" for the
  human / "{name} drew {n}" for an AI) and a `PENALTY_TOAST_MS` (2200) timer that clears it and
  re-renders. `renderGame` shows it as a `.un-toast` banner; it's transient UI, never
  snapshotted. The pending-stack badge (`.un-pendingbadge`) moved out of the draw-pile button
  to a `.un-mat` child, centred at the top of the mat and enlarged (15px), so a growing stack
  can't be missed. A pending stack and an open colour chooser can never coexist (a +2 stack
  restricts legal plays to +2s only — `getLegalMoves` with `pendingDraw>0` — so no wild, hence
  no colour choice), so the two absolutely-positioned elements never collide.
- **Play-direction indicator (3-4 players only)** (FB4 QA, 2026-07-25). A small curved arrow
  (`dirArrowSVG`, mirrored for the two directions, `currentColor`, the `js/difficulty-tiers.js`
  inline-SVG style) sits top-right of `.un-mat` with an aria-label (`direction_cw`/
  `direction_ccw`). Rendered only when `this.seats.length > 2` (2p Reverse acts as Skip, so
  direction is meaningless) and flips straight off `g.direction` (`1` = clockwise). Independent
  of the `.un-oppchip.is-turn` active-player highlight.
- **The "Uno!" indicator is a persistent computed badge, not a timed toast.** Any seat
  (human or AI) with exactly one card shows a small "UNO!" chip next to their name/count,
  recomputed every render straight from `hand.length === 1` — simpler and more robust
  against re-renders than a timer-based banner, and satisfies the handoff's "a banner when
  any player reaches one card, no catch/penalty mechanic" without extra state to track.

## Visual rebuild (2026-07-25, per `UNO-DESIGN-SPEC.md` + `HANDOFF-UNO-VISUAL.md`)

Landing in sessions: UN-1 tokens + UN-3 fan (this section), UN-2/UN-5 card face and
fixed geometry, UN-4 motion (below), UN-8 multi-row fan + UN-9 opponent chip ellipsis
(session 3.5, two defects found in real device testing), UN-10..13 flat-row alignment,
opponent chip restructure, the dark mat, and viewport fill (session 3.6, four MORE
defects found in real iPhone testing - see "The fan", "Fixed geometry", and "The mat and
viewport fill" below), UN-6 hand sort (not yet landed - no `handSort` control exists in
`ui.js` as of this writing). The spec (repo root) is the contract for all of it.

### The token system (UN-1)

`uno/css/uno.css` has exactly two token blocks: `.un-root` (all tokens, light chrome values)
and `:root.gh-dark .un-root` (chrome overrides ONLY). **Every rule outside those blocks
consumes tokens - zero literal colors, shadows, radii, or font-sizes.** Gate, run it after any
CSS edit: `grep -nE "rgba?\(|#[0-9a-fA-F]{3,6}" uno/css/uno.css` must hit token blocks only.

- The four card hues + `--un-accent` are the locked hub palette (colorblind pairing,
  contractual). `--un-wild` moved `#2b2b33` → `#23232C` per spec §2 (not one of the four).
- **Theme-invariant by design (spec §2, decided): `--un-table` and every card token** (rim,
  edge, medallion, gloss, numeral shade, card ink, back stripe, the three shadows). Dark mode
  overrides chrome only (`--un-bg/surface/ink/muted/border`). Do not add card tokens to the
  dark block.
- Shadows are a three-state stack (`--un-sh-rest/raised/lift`); no component improvises its
  own shadow.
- Chrome-only extension tokens (`--un-t-title/heading/body/small/tiny/emoji/x/oppcount`,
  `--un-r-ctl/badge`, `--un-on-accent`, `--un-unochip-ink`, `--un-scrim`, `--un-card-ink`,
  `--un-back-stripe`) exist so setup/overlay rules carry no literals; they are not part of the
  spec §3/§4 scales and are commented as such in the file. `--un-t-oppcount` (16px) is UN-11's
  addition, for the opponent chip's count line - no existing scale value was 16px.
- **`--un-mat-muted` (UN-12) is theme-invariant, matching dark-theme chrome's `--un-muted`**
  value exactly - added because the chrome `--un-muted` flips to a DARK color in light mode
  (`#6B7686`) and fails contrast against the always-dark `--un-table` mat there (measured
  3.71:1, below WCAG AA's 4.5:1 for normal text; light-mode chrome `--un-ink` on the mat is
  1.09:1, unreadable). Anything painted directly on `.un-mat` (currently `.un-pilecount`,
  `.un-dir`) uses this, never the chrome `--un-ink`/`--un-muted`. If a future rule needs
  bright (not muted) text on the mat, add a `--un-mat-ink` the same way - don't reach for the
  chrome `--un-ink`.
- Cards are `--un-card-w/h` = 62x92 (`box-sizing: border-box`), small cards 48x71.

### The fan (UN-3, multi-row since UN-8, flat since UN-10) - geometry

`fanLayout(n, {W=62, H=92, STEP=32, ROW_PITCH=58, A=452, RESERVED_H=150})` in `ui.js` is pure
and holds every constant; nothing else in the codebase knows the formulas (spec §5): cards
wrap into balanced rows (`PER_ROW = max(1, floor((A-24-W)/STEP)+1)`, `rows = ceil(n/PER_ROW)`,
`perRow = ceil(n/rows)` - never fill-then-spill, e.g. 13 cards is 7+6, not 12+1), then
`x=(j-c)*STEP`, `y=r*ROW_PITCH`, `rot=(j-c)*min(1.8, 14/max(1,rowN-1))`,
`z=r*100+j` (lower rows paint in front) for card index `j` within row `r`, and
`fit=min(1, RESERVED_H/needH)` with `needH=H+ROW_PITCH*(rows-1)`. **`STEP` (32) is just over
half of `W` (62), and the fan scales uniformly, so the exposed fraction of every overlapped
card is a constant `STEP/W ≈ 51.6%` regardless of `fit` - "at least 50% of every card visible"
is a proportional guarantee, not something checked at a few hand sizes.** Only height
(`RESERVED_H`) drives `fit`; `PER_ROW` is derived from the measured width, so width fits by
construction and two full rows (n up to `2*PER_ROW`) render at full 62px card size before a
3rd row triggers any scale-down.

**UN-10: `y` has NO bow term any more** (it used to be `r*ROW_PITCH + min(8,(j-c)^2*0.4)` - the
`(j-c)^2*0.4` was a per-card parabolic dip within a row, capped at 8px). Every card in a row now
shares the exact same `y` - rows are flat lines, not shallow arcs. This is paired with a CSS
change (`transform-origin: 50% 100%` on `.un-fan .un-card`, was `50% 150%`): with a shared `y`
and rotation now pivoting at each card's own bottom edge instead of a point below the whole
hand, every card's bottom edge lands on the SAME line within its row regardless of its tilt.
Verified live (per-row `getBoundingClientRect().bottom` spread) at n=7/13/20/25: 1.4-2.9px
across every row, which is subpixel/rounded-corner noise, not misalignment. Why this mattered:
the OLD bow, combined with row 7's per-card lift (see "Motion system" below), made the two
currently-legal cards in a hand visibly float above the rest - reading as broken alignment
instead of a hint, which is exactly the defect UN-10 was opened for. **Keep the per-row
rotation and its 14° cap - only the vertical scatter was the bug.**

`_syncFan` passes the RAW measured `A = min(452, .un-hand clientWidth)` (the 24px edge
breathing room is subtracted INSIDE `fanLayout`, not by the caller - do not subtract it twice)
so the fan fits real phone widths, not just the 480px design shell; a `window` resize listener
re-renders (removed in `destroy()`). Note: the hub's preview browser does not dispatch
`resize` on viewport emulation - verify rotation refit on a real device, or dispatch the event
manually.

**Every card's `y` carries a `shiftY = RESERVED_H - needH` term - load-bearing, do not drop
it.** `.un-fan`'s `scale(fit)` has `transform-origin: 50% 100%` (the BOX's bottom - "a fan held
below the mat"). A point sitting exactly AT that origin doesn't move when scaled; anywhere
else does. Without `shiftY`, cards are laid out from `y=0` (the box's top) regardless of how
tall the unscaled content is, so a 3-row hand (`needH=208` > `RESERVED_H=150`) scales around a
point 58px below its own bottom edge and the scaled result drifts ~42px past the box's bottom
- verified live pre-fix (a synthetic 25-card save via `UnoGame.snapshot()`/localStorage
injection, since reaching n=25 through normal play takes many turns): `cardsMaxBottom` sat at
~465px against a `.un-hand` bottom of 418px. `shiftY` pins the content's bottom edge to
`RESERVED_H` BEFORE scaling (0 at exactly 2 rows, since `needH` already equals `RESERVED_H`;
positive at 1 row, bottom-aligning it instead of leaving it floating with empty space below;
negative at 3+ rows, starting the content above the box under `overflow: visible`), so after
the origin-anchored scale the bottom always lands within a few px of `RESERVED_H` (the small
residual was, before UN-10, mostly the row's own bow term - capped at 8px, scaled by `fit` -
plus rounding; UN-10 removed the bow entirely, so it's rounding/rotation-bbox noise only now).
Re-verified after the `shiftY` fix (and again after UN-10 removed the bow): 25-card save,
`cardsMaxBottom` within a few px of `.un-hand`'s own bottom, never the ~42px pre-fix drift.

`.un-hand` is a fixed 150px box (identical at every n - verified n=1/7/13/20/24/25/30), no
scroll container anywhere in the subtree, `overflow-x` banned from the file. `.un-fan .un-card`
has `top: 0` (not a positive offset) - 150px is exactly `needH` at 2 full rows
(`H=92 + ROW_PITCH=58`), so a 0 offset is what makes 2-row content fill the box height with no
overflow; do not reintroduce a static top offset without re-deriving `RESERVED_H` to match.
Cards are absolutely positioned in design space inside `.un-fan`; only `--fit` and per-card
`--x/--y/--rot/--z` ever change, so card count cannot affect layout. **Display order is the
REVERSED engine hand** (engine `draw()` pushes to the end; spec §5 wants the newest card at the
left end - UN-8 kept this convention unchanged, so with multiple rows a newly drawn card lands
at the left end of the TOP row, not the bottom row, since row 0 gets the smallest indices).
Paint order stays positional within a row (`z = r*100+j`, rightward cards on top within a row,
lower rows in front of upper rows), so each card's exposed sliver is its left edge and the
tapped sliver always plays the card under it. The reversal is presentation-only - every
`data-id` and `play()` call uses the card's real id. (UN-6's `sortedHand()` absorbs this
reversal as its `draw` mode.)

### The card face (UN-2) - pressed plastic, spec §7

`cardHTML()`'s button markup is, outermost in: card background + rim (both on `.un-card`
itself), gloss (`::before`, decorative only), the medallion, the numeral (`.un-face >
.un-glyph-big`), then the corner mark last (so it always paints on top - see below). No
new identifiers were renamed; `cardHTML`, `COLOR_META`, `shapeSVG`, `colorGlyphHTML`,
`cardFaceGlyph`, and `cardAriaLabel` keep their exact prior names and signatures, and
`cardAriaLabel()`'s output is byte-identical to before.

- **The rim is `box-shadow: inset`, stacked onto the same declaration as `--un-sh-rest`**
  (`.un-card`'s `box-shadow` is a 4-layer comma list: the ambient shadow, a 3px white inset
  rim, a 1px-wider black inset hairline). Deliberately not a real `border` - a border adds
  to the box model even under `border-box` sizing in a way that would have required
  re-deriving every fan/card dimension in spec §4. **Because `.un-card` is a `<button>`,
  removing the old literal `border` declaration let the browser's UA stylesheet's default
  button border show through** (a real regression caught by computed-style verification,
  not visible from reading the diff) - fixed with an explicit `border: none` alongside the
  box-shadow rim. Any future card-like `<button>` in this file needs the same explicit
  reset if its border is being replaced by a shadow.
- **The medallion is `medallionHTML(card)`, a new function that only calls `shapeSVG()`** -
  there is still exactly one shape-drawing function in the file. A colored card wraps a
  single `shapeSVG(COLOR_META[card.color].shape, 'var(--un-medallion)')` in a 12x12-viewBox
  `<svg class="un-medallion">`; CSS sizes it to 46px (36px on `.un-card-sm`) and applies the
  two-layer `drop-shadow()` filter from spec §7. Fill is the literal string
  `'var(--un-medallion)'` passed as the SVG `fill` attribute value (not a CSS rule) -
  presentation attributes accept `var()` in evergreen browsers, and this keeps
  `shapeSVG()`'s signature and every other caller (the corner glyph, the color chooser)
  completely unchanged.
- **Wild cards get a quartered medallion, not `.un-wildquad`** (that rule and its markup
  are deleted). `medallionHTML()` calls `shapeSVG()` four times - once per shape - each
  wrapped in `<g transform="translate(dx,dy) scale(.5)">` so the same 12x12-space shape
  lands centered in its quadrant (the algebra: `shapeSVG()`'s shapes are already centered
  on `(6,6)`; `scale(.5)` maps that to `(3,3)`, and `translate(6,0|0,6|6,6)` slides it to
  the other three quadrant centers), then the whole `<g>` is clipped to a circle via a
  per-card `<clipPath id="un-wildclip-{card.id}">` so it reads as one disc, not a square
  grid. The id is keyed off the real card id specifically so two simultaneously-rendered
  wild cards (a hand can hold two Wild+4s) never collide on the same DOM id.
- **`.un-corner-br` is gone** - both the CSS rule and the markup that used to render it
  twice per card. Top-left is the only corner mark now (spec §5: a buried fan card only
  ever exposes its left edge, so the bottom-right copy was dead weight). `.un-corner` keeps
  `z-index: 2`, one level above the numeral's `z-index: 1`, specifically so a future
  markup reorder can't accidentally let the medallion occlude the corner - the corner is
  the entire legibility story for a buried card and must never lose that fight.
- **Numeral treatment** (`.un-glyph-big`): `text-shadow` + `-webkit-text-stroke` +
  `paint-order: stroke fill`, per spec §3, using a new token `--un-numeral-stroke`
  (numerically identical to `--un-medallion-lo` but kept distinct since they mean different
  things - a shadow depth vs. a text outline ink - and shouldn't move together by
  accident). Action glyphs (`+2`, `+4`, `⊘`, `⇄`, `★`) get `.un-glyph-action` at a literal
  `26px` (a size, not a color/shadow, so it's outside the UN-1 token-discipline gate) so
  they optically match the 34px digits per spec §3.
- **Small cards** (`.un-card-sm`, used only by the how-to diagram's `foreignObject`):
  `.un-face` (the numeral) is `display: none` and `.un-corner` stays hidden (pre-existing
  rule) - the medallion is the ENTIRE small-card read, sized down to 36px. Verified live:
  the diagram's three cards all resolve to `faceDisplay: none`, `cornerDisplay: none`,
  `medallionSize: 36x36`.

### The `_syncFan` render exemption (UN-3c - load-bearing, do not "fix" back)

`renderGame()` no longer rewrites the container as one HTML string. `_ensureGameShell()`
builds a persistent skeleton once per entry into the game view (region wrappers: opponents /
status / mat / toastslot / unoslot / hand+fan / bar); every render rebuilds the REGION
CONTENTS with the same template strings as before, and `_syncFan()` reconciles the fan's card
nodes in place, keyed by `data-id`.

**Why:** CSS transitions cannot animate across a rebuild - a re-inserted node has no
before-change style, so UN-4's whole motion system would silently do nothing. And that applies
to ANCESTORS too: re-attaching the fan into a freshly rebuilt parent detaches it, which kills
every running and future transition on its cards. So the exemption is necessarily the whole
game-screen skeleton, not just the fan node - "only the fan is exempt" is not literally
achievable with a single innerHTML render.

`_syncFan` invariants (drift-proof by construction):
- Every call is a FULL stateless reconciliation against the hand it is given - membership,
  position, and live/disabled state are recomputed each time, so rapid consecutive plays
  cannot desync it (verified: two same-tick taps, fan ids === engine ids).
- Card nodes are never moved or reparented once inserted (new nodes are appended; position and
  paint order ride entirely on custom properties), because insertBefore also kills transitions.
  DOM order therefore diverges from display order - accepted, tab order is the cost.
- Removal is IMMEDIATE. UN-4's flight animations must use detached clones in a fixed layer,
  never the live nodes.
- `_syncFan` (+ `_buildCardEl`, which builds nodes from the same `cardHTML()` string) is the
  ONLY code that mutates card DOM outside a render template string. Keep it that way.

Consequences handled: the end-of-match and help overlays now SURVIVE re-renders (they hang off
the persistent `.un-root`), so `startGame()` calls `closeOverlays()` explicitly; `renderSetup()`
still rewrites the whole container and must null `_fanEl`/`_regions`; `startGame()` also clears
a stale `_pendingWildId`, and hand cards render disabled while a color chooser is open (both
were latent stale-chooser bugs the persistent shell would have made easier to hit;
`_onChooseColor` additionally re-validates turn + hand membership before calling `play`).

### Fixed geometry (UN-5, heights updated by UN-8/UN-11/UN-13) - the reserved regions of spec §4

`.un-opponents` (52px, was 44px pre-UN-11), `.un-status` (22px, promoted from `min-height`),
`.un-handwrap` (170px), `.un-bar` (40px) are explicit `height`, not auto-sized - verified live
at every value (`getComputedStyle(el).height` read back exactly 52/22/170/40px). Regions with
padding also need `box-sizing: border-box`, or the literal spec height becomes the CONTENT
height and the padding adds on top of it. `.un-handwrap`'s 170px = `.un-hand`'s 150px fan
region (was 132px pre-UN-8) + the 20px UNO chip slot below it.

**`.un-mat` is the one exception since UN-13: `min-height: 148px` + `flex: 1 1 auto`, not a
hard `height`.** It still never shifts on game state (THE LAW) - see "The mat and viewport
fill" below for why a viewport-driven height is still zero-shift-safe.

**The UNO chip slot was the one that actually moved things.** `.un-unoslot` used to render
`''` or the chip markup with no CSS of its own, so its height was 0 until the moment a
player reached one card, at which point it grew to the chip's height and pushed the fan
down by that many px - a real, player-visible layout shift on the single most dramatic
moment of a close game. Fixed by giving `.un-unoslot` an unconditional `height: 20px`; the
JS (`r.uno.innerHTML = hand.length === 1 ? chipHTML : ''`) did not need to change at all -
reserving the box in CSS is sufficient regardless of what HTML string lands inside it.
Verified live: forcing chip markup into an empty slot mid-game left `.un-handwrap`'s
computed height at 170px before and after (both `.un-unoslot` and `.un-pendingbadge`'s host
are absolutely positioned or otherwise flow-inert, so they were never going to affect flow
height, but the fixed heights make that true by construction rather than by "the content
happens to already add up right"). Note this check predates UN-13: `.un-mat` was still a
hard `height: 148px` when it was verified; UN-13 changed `.un-mat` to `flex: 1 1 auto` +
`min-height: 148px`, which is a different (also zero-shift, see below) invariant, not a
regression of this one.

**UN-9: opponent chip ellipsis, not clip.** `.un-opponents` needed `flex-wrap: nowrap` (UN-5)
to hold its fixed height, but that alone let chips overflow the row at 4 players instead
of shrinking - the standard flexbox trap where a flex item won't shrink below its content
width (and `text-overflow: ellipsis` never triggers) without `min-width: 0`. Fixed with
`.un-oppchip { flex: 1 1 0; min-width: 0; }` (chips share the row equally and can shrink) and
`.un-oppname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
(replacing a fixed `max-width: 90px`, which clipped rather than ellipsizing and didn't scale
from 2 to 4 players). `.un-opponents` also got `padding: 0 4px` so a chip can never touch the
shell edge. Verified at 2/3/4 players and with a 20-character custom name: names ellipsize,
nothing crosses the shell edge.

`.un-opponents` also gained `flex-wrap: nowrap` (was `wrap`) - a wrapped second row of
chips would need MORE than the fixed height, which is exactly the shift the fixed height
exists to prevent.

**UN-11: UN-9's ellipsis fix wasn't enough - names still read as "Co…" at 4 players.**
`flex:1 1 0`/`min-width:0` stopped the raw clipping, but a single horizontal line of
`emoji + name + count` simply has no room for a full "Computer 1" once four chips share a
375px-wide row (confirmed on a real iPhone). The chip is now a **vertical two-line stack**
(name over count, `flex-direction: column`), which needs far less horizontal room per chip:
`.un-oppname` is `11px/700/--un-muted` (a caption), `.un-oppcount` is `16px/800/--un-ink`
(a plain bold number, no more pill background - the chip itself already reads as a pill).
The robot emoji is gone entirely (it cost ~28px of the horizontal budget for zero
information once every non-human seat already reads as a chip). `.un-oppname`'s
`min-width:0`/ellipsis rules are KEPT but now serve only as a fallback for an unusually
long custom name - the default "Computer 1/2/3" strings must render in full, verified live
at 4 players on a 375px viewport (`nameEl.scrollWidth > nameEl.clientWidth` was `false` for
all three). `.un-opponents` grew 44px → 52px to hold the two lines (still fixed at 2, 3, and
4 players - verified). The UNO badge (`.un-unochip`, shown at exactly one card) is
absolutely positioned (`.un-oppchip .un-unochip { position: absolute; top: -6px; right:
-6px; }`, mirroring `.un-colorchip`'s corner-badge pattern) rather than a third flow line,
so reaching one card never changes the chip's own height - THE LAW's zero-vertical-shift
rule extends to this row same as everywhere else. `.is-turn`'s `border-color` and motion
#12's pulse (both untouched by UN-11) still make the active opponent's chip distinguishable.

### The mat and viewport fill (UN-12/UN-13)

**UN-12: `.un-mat` renders `background: var(--un-table); border-radius: var(--un-r-sheet);`.**
Spec §2 always specified "the mat stays dark in both themes" and `--un-table` has existed,
theme-invariant, since UN-1 - but nothing ever actually painted it onto `.un-mat` until this
session. Real device testing found cards floating on the page with no visible playing
surface. Fixed by the one-line `background`/`border-radius` addition; verified live in both
themes (`getComputedStyle(mat).backgroundColor` reads the same `rgb(23, 28, 38)` regardless
of `.gh-dark`, confirming it's genuinely theme-invariant, not coincidentally matching).

**Contrast fallout: two rules inside the mat used the chrome `--un-muted`, which fails on
the mat's dark ground in light mode.** `.un-pilecount` and `.un-dir` (the play-direction
arrow) both painted text/icon color from `--un-muted`, which is `#6B7686` in light mode (a
medium-dark gray, chosen to read on the light chrome background) - measured 3.71:1 against
`--un-table`, below WCAG AA's 4.5:1 for normal text. Fixed by adding `--un-mat-muted`
(theme-invariant, `#8B98AC`, matching dark-theme chrome's `--un-muted` value) and pointing
both rules at it instead (see the token-system section above). Nothing else inside `.un-mat`
needed a color change: card numerals already use the theme-invariant `--un-card-ink`, the
pending badge uses `--un-on-accent` on its own colored background, and the wild-color
chooser overlay (`.un-colorchoose`) has its own opaque `--un-surface` background so it was
never affected by the mat's background regardless of theme.

**UN-13: `.un-shell.un-game` is `min-height: 100dvh; display: flex; flex-direction: column`,
and `.un-mat` absorbs the slack (`flex: 1 1 auto; min-height: 148px`, replacing its old hard
`height: 148px`).** Real device testing found a large dead band below the button bar and an
oversized gap between the piles and the hand - the shell simply wasn't filling the screen.
Scoped to `.un-game`, not the bare `.un-shell`, so the setup screen (which has no flexible
region to absorb extra height) is untouched. `dvh` (dynamic viewport height), not `vh`, so
mobile Safari/Chrome's address-bar show/hide doesn't clip content - a real difference on
iPhone, where this was actually found. Verified live at 375×667 and 375×812: shell height
matches `window.innerHeight` exactly at both, `document.body.scrollHeight` matches too (no
scroll), and `.un-bar`'s bottom sits exactly `.un-shell`'s own 20px bottom padding above the
viewport edge at both heights (no residual dead band) - only `.un-mat`'s computed height
differs between the two (329px vs 474px), every OTHER fixed region (opponents 52px, status
22px, hand 150px, handwrap 170px) reads byte-identical at both viewport heights.

**Why a viewport-driven `.un-mat` height doesn't violate THE LAW's zero-vertical-shift
rule.** The rule's actual invariant is "nothing shifts as a RESULT OF GAME STATE" (playing a
card, drawing, hand size changing) - not "every region is a literal CSS `height`". `.un-mat`'s
height is now a pure function of the viewport, fixed for the entire lifetime of the mount
(same caveat every other region already has: a resize/rotation can change things, and
`_syncFan`'s resize listener already re-renders for exactly that reason). No code path
changes `.un-mat`'s flex sizing in response to `g.phase`, hand length, pending draws, or
anything else engine-side - the pile contents stay `align-items:center; justify-content:
center` inside it regardless of how tall it grows, so they simply recentre rather than
shifting relative to any fixed reference point.

### Motion system (UN-4) - spec §6, all 13 rows plus 6a

Every duration/easing is a named token in `.un-root` (`--un-dur-*`/`--un-ease-*`), each
comment-tagged with the spec row it belongs to - grep `--un-dur-` in `uno.css` for the full
list. No rule anywhere in the file carries an inline duration or `cubic-bezier(...)`
literal. Row 9 (penalty draws arriving 90ms apart) was **not implemented** - it was
explicitly outside this session's assigned row order and is deferred, not forgotten; a
multi-card penalty draw currently pops in via row 6's single-card path with no stagger
between cards.

**The one real conflict with the render architecture: only one `transition` can be active
on `transform` at a time.** Rows 2 (relayout, 260ms) and 11 (press, 120ms) both animate the
SAME `transform` property on `.un-fan .un-card` (fan layout and the press dip/scale are two
extra terms folded into one `transform` value via `--un-lift`/`--un-press-scale`, not two
separate transforms - CSS only has one `transform` per element). Since a transition's
duration is resolved from whichever selector matches the element AFTER a style change, not
from what actually caused the change, the two rows can't each keep their own duration
independently; they're layered by cascade precedence instead - `:active` (row 11) beats the
bare `.un-fan .un-card` base rule (row 2), equal specificity broken by source order. Press
always wins since it's the most time-sensitive feedback.

**UN-10: row 7 no longer touches `transform` at all - it's `opacity` only**, so it isn't
part of the conflict above any more. `.is-illegal { opacity: .45; }` is the entire rule; the
base `.un-fan .un-card`'s `transition` list carries `opacity` permanently (at row 7's
duration/easing/stagger, `--un-dur-legal`/`--un-ease-legal`/`--un-legal-stagger`) since
nothing else ever contests that property the way rows 2/11 contest `transform`. Before
UN-10, row 7 set `--un-lift: -4px` on `.is-live` and WAS part of the three-way transform
conflict described above (it used to be `:active` beats `.is-live` beats the base rule) -
that history is why the transform-conflict paragraph above only mentions two rows now, not
three; do not "helpfully" re-add a `.is-live` transform rule without re-reading why it was
removed (spec §5/§6, UN-10: the lift, combined with the fan's now-removed bow, made legal
cards look like they'd popped out of alignment rather than been highlighted).

**Non-persistent regions (mat, opponents, UNO slot) need "did this just happen" flags,
not transitions.** Only the fan's cards get UN-3c's DOM-persistence exemption; the discard
pile, pending badge, opponent chips, and UNO chip are all rebuilt via `innerHTML` every
render like before. A CSS `transition` needs a persistent "before" style to animate from,
so rows 4/5/8/10/12(chip) are `@keyframes` animations instead (which play once from their
own 0% state on insertion, needing no prior DOM), gated by explicit "did the underlying
value actually change since the last render" checks in `renderGame()` so an unrelated
re-render (a toast firing, a different opponent's turn) never replays them:
- `_lastDiscardId` + `_discardRot` (rows 4/5) - a stable random rest tilt computed once per
  physical top card and reused across re-renders of the same top card; `_revealPending`
  (set only by `startGame()`) plus "is this card a wild" decide flip (row 5) vs. settle
  (row 4).
- `_lastPendingDraw` (row 8) - only pulses on an actual increase.
- `_lastHandLen` (row 10, per seat index) - only pops on the exact render a hand first
  drops to one card.
- `_aiPulsePi` (row 12's chip half) - an explicit flag set right when the AI plays and
  cleared by a timer, mirroring the existing `_penaltyToast`/`_penaltyTimer` pattern.

**Flight animations (rows 1, 3, 6, 12) are fixed-position clones in `.un-flightlayer`**, a
sibling of the fan/mat regions built once in `_ensureGameShell()` so a render never touches
it. `_spawnFlight()` is the one function that builds/positions/animates/removes a clone:
`getBoundingClientRect()` on the real source and destination nodes, `left/top/width/height`
set ONCE as static inline styles (never transitioned - only `transform` moves), then a
shared `un-fly` keyframe (`un-fly-play`/`un-fly-draw`/`un-fly-deal` just pick different
duration/easing/delay tokens) takes it from there to `translate(--fly-dx,--fly-dy)
rotate(--fly-rot) scale(--fly-scale)`. Removed on `animationend`, with a `later()` timeout
safety net (`FLIGHT_SAFETY_MS`) so a clone can never outlive a re-render if the event is
ever lost (a backgrounded tab, or - see below - reduced motion). Row 1's 55ms stagger and
row 6a's rim-glow both ride this same mechanism:
- Rows 1 (deal) and 6 (draw): a newly-inserted fan node is real from the start (it already
  carries its correct final `--x/--y/--rot`) but hidden (`un-card-entering`, opacity 0)
  until ITS OWN clone's flight finishes, so the "arrival" is masked by the clone rather
  than the real card popping into place mid-animation. Row 1 spawns all n clones at once,
  each with its own `--i`-keyed CSS `animation-delay` (pure CSS stagger, not a JS
  `setTimeout` loop) so reduced-motion's blanket delay override zeroes it out for free.
  Row 6a's glow only fires for a drawn card (`isDeal` false), never during the initial
  deal, which already tells the "this is new" story via the stagger.
- Row 3 (human plays): the fan's live card node is cloned BEFORE `g.play()` runs (capturing
  `sourceEl` first) - `_syncFan` removes the real node the instant the hand no longer
  contains it, so the clone must exist before that happens, not after.
- Row 12 (AI plays): opponent hands have no per-card DOM to clone from (only a count chip
  is rendered), so the clone is built fresh from `cardHTML()` instead of `cloneNode()`. The
  chip's rect is captured before `g.play()` runs too, since the opponents region rebuilds
  every render and the OLD chip element is gone (zero-rect) by the time the flight would
  otherwise read it.

**The wild medallion's clip-path was rebuilt for exactly this reason (do not revert).**
UN-2 originally clipped the quartered wild disc with an SVG `<clipPath id="un-wildclip-
{card.id}">` + `url(#...)`. SVG id references are document-global and (per real browser
behavior) can be resolved-and-cached by reference to a specific node; UN-4's flight clones
`cloneNode(true)` the whole card including that `<clipPath>`, and the ORIGINAL node is
removed from the fan the instant the hand changes - so a cloned wild card's clip-path could
lose its target mid-flight and render unclipped for a frame. Fixed by dropping the SVG
clipPath entirely and clipping via CSS `clip-path: circle(47.5%)` on `.un-medallion-wild`
instead (see `medallionHTML()`'s comment) - no id, no document-global scope, so cloning is
trivially safe. Verified: a Wild Draw Four's medallion stays circular through its entire
flight. If a future session reintroduces an SVG clipPath anywhere in this file for
per-card-cloned markup, re-read this note first.

**`prefers-reduced-motion: reduce`** (spec §6): a blanket `.un-root * { animation-duration:
0.01ms !important; transition-duration: 0.01ms !important; ...}` collapses every row to
imperceptible, with two named exceptions that keep a 120ms **opacity-only** fade (rows 8
and 10 - `animation-name` is overridden to a plain `un-fade-reduced` keyframe, dropping the
scale/bounce). `.un-flightlayer` is simply `display: none` - flights are decorative overlays
on top of state that's already fully correct the instant they'd spawn, so hiding them loses
no information. **This has one real consequence for rows 1/6/6a's entering-card mechanism:**
an element that never generates a box never fires `animationend`, so without a guard, a
newly drawn/dealt card would stay hidden until `_spawnFlight`'s safety-net timeout
(`FLIGHT_SAFETY_MS`, 900ms) instead of appearing instantly. `_spawnFlight()` checks
`matchMedia('(prefers-reduced-motion: reduce)')` FIRST and, if reduced motion is on, skips
spawning the clone entirely and resolves `onDone` synchronously - the real card is revealed
the same render frame it's created, with no dependence on any animation event.

**Row 13 (sort toggle) needed no new code at all - by construction, not by luck.**
`_syncFan` reconciles cards by `data-id`, not by array position, so ANY reordering of the
hand array fed to it (a future `sortedHand()`, per the deferred UN-6) will move the existing
persistent nodes to their new `--x/--y/--rot` and animate via row 2's transition exactly
like a hand-size change does today. There is no `handSort` control yet (session 4 adds
it) - this is a structural guarantee to build on, not a placeholder.

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
99 assertions: deck composition (exact counts per color/kind), +2 stacking accumulation and
resolution, penalty draws being a single lump (not draw-until-playable), draw-until-playable
stopping at the first legal card and forcing its play, reshuffle-on-exhaustion preserving
the 108-card total, Reverse-as-Skip at 2 players vs. a real direction flip at 3+, every
first-card rule including the Wild+4 reflip **re-proven relative to a non-zero `startPlayer`
for every card kind** (number/skip/reverse at 2p and 4p/+2/wild, plus an end-to-end
`UnoGame` construction opening on the requested seat for all 3 seats of a 3-player game),
win detection, and 60 full AI-vs-AI random games (20 each at 2/3/4 players, seeded rng) all
terminating with the card count intact. Wired into `run-all-tests.mjs`.

The final two assertions are the **AI win-rate harness** (`playMatchup`/`hardWinRate`): 500
seeded 2-player games per matchup, both seats driven by `chooseAction`, Hard's seat alternated
each game so the opener's tempo advantage cancels (neither seat gets "better" randomness — one
shared rng stream, only the difficulty label differs). It asserts Hard beats Easy ≥65% and
Medium ≥55%, and prints the actual rates (85.0% / 85.8% as of 2026-07-25 — see AI notes). The
harness adds ~10s to the suite (1000 games plus rollouts); that's expected.

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

## Verification (2026-07-25, UN-10..13)

Browser-tested via synthetic saves (`UnoGame.snapshot()` + a hand forced to n cards, written
directly to `gamehub.uno.save.v1` before mount - reaching n=25 through normal play takes many
turns) at 375×812 and 375×667:

- **Row alignment (UN-10):** per-row `getBoundingClientRect().bottom` spread at n=7/13/20/25
  was 1.4-2.9px across every row (subpixel/rounded-corner noise, not misalignment) - down
  from the pre-fix state where the bow term plus row 7's lift made legal cards visibly float.
- **Opponent chips (UN-11):** at 4 players, "Computer 1/2/3" all rendered in full
  (`nameEl.scrollWidth > nameEl.clientWidth` was `false` for all three); `.un-opponents`
  read exactly 52px.
- **The mat (UN-12):** `getComputedStyle(mat).backgroundColor` read the identical
  `rgb(23, 28, 38)` in both light and dark theme (theme toggled the CORRECT way - via
  `localStorage['gamehub.theme.v1']` before mount, not a raw `classList` hack, since
  `js/theme.js` re-derives the class from stored/OS preference on load and will silently
  overwrite a manually-added class). `.un-pilecount`'s color also read identically
  theme-invariant (`rgb(139, 152, 172)` = `--un-mat-muted`) in both themes.
  **Caveat:** `uno/index.html` (the standalone page) never imports `js/theme.js` and its
  `<body>` has a hardcoded light inline background - dark mode is a HUB-level concern only
  reachable by mounting through the real hub shell, not by loading the standalone page
  directly. Verification here stamped `.gh-dark` on `<html>` manually to simulate that,
  which is faithful for everything scoped under `.un-root` (what this session's binds
  cover) but does NOT exercise the standalone page's own non-`.un-root` chrome - that
  gap is pre-existing and out of scope, not introduced by this session.
- **Viewport fill (UN-13):** at both 375×667 and 375×812, shell height matched
  `window.innerHeight` exactly, `document.body.scrollHeight` matched too (no scroll), and
  `.un-bar`'s bottom sat exactly the shell's own 20px bottom padding above the viewport
  edge. Every fixed region (opponents/status/hand/handwrap) read byte-identical between the
  two heights; only `.un-mat` differed (329px vs 474px), confirming it's the sole flexible
  region and everything else is still hard-fixed.

`node run-all-tests.mjs` (19 suites) and `node validate-sw-assets.mjs` both clean - this
session touched only `uno/css/uno.css`, `uno/js/ui.js`'s `fanLayout()`/`_syncFan()`, and
`sw.js`'s cache version, none of which the engine/AI/lockstep test suites exercise.
