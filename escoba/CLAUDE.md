# Escoba (`escoba/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — the nine full rules repeat throughout the root `CLAUDE.md`, which is always
> loaded alongside this file. Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Spanish fishing/capture game (the Escoba/Scopa family): capture table cards that sum to
**15** with one card from your hand; clearing the whole table is an **escoba** ("broom").
Built to the Fournier rules in the PDF Matt supplied (no in-repo copy; see "Rules
implemented" below for the parts that mattered for correctness). 2-3 players vs AI,
**in-hub `module:`**, **immersive** (see "Hub integration"). Card faces are **not** its
own asset: it reuses the shared **Anita** deck from `chinchon/decks/anita/` directly
(no deck registry, no picker, no copied files, one fewer thing to keep in sync).

## Layout & responsibilities

```
escoba/js/deck.js    pure card data: SUITS, makeDeck(mode), shuffle, captureValue, captureOptions, sumValues
escoba/js/game.js    async turn/round/match state machine + agent interface (no DOM); snapshot()/fromSnapshot()
escoba/js/ai.js      synchronous AIAgent, three tiers (random / greedy / card-counting)
escoba/js/ui.js      DOM, HumanAgent, render loop, modals, broom sequencing, hub init/destroy contract
escoba/js/cards.js   card-face renderer only (no registry): reads chinchon/decks/anita/ via a relative URL
escoba/js/test.js    headless engine assertions incl. a snapshot/resume round-trip (node), not deployed/precached
escoba/css/escoba.css all styles, .eb- prefixed, scoped under .eb-root
escoba/img/broom-sprite.webp  10-frame sweep spritesheet (480x360/frame), the only asset this module owns
escoba/index.html    standalone host (calls init() directly, same contract as in-hub)
```

There is no `escoba/decks/`: unlike Chinchón, this game deliberately ships **zero** card
art of its own. `cards.js`'s `BASE` constant resolves `../../chinchon/decks/anita/`
relative to the module, so it rides on whatever Chinchón's `sw.js` precache already
covers: if Anita's asset set ever changes, Escoba needs nothing extra.

## Hub integration

- **`immersive: true`** on its `GAMES` entry in `js/hub.js`. Escoba's own setup/game
  screens already show a title and a way back, so the hub's own header row would be
  pure wasted space; immersive mode collapses it to a small floating back button (see
  `hub-top-immersive` in `css/hub.css`) instead of a sticky full bar, and `.hub-main`
  gets extra top padding while it's active so that floating button never overlaps the
  game's own content. This is opt-in per game; every other game's hub chrome is untouched.
- **`isInProgress()` returns `false` for all solo play** — Escoba persists the live match on every state-changing engine event (see "Resume
  via engine snapshot" below), so leaving via the hub's own `‹ Hub` button never loses solo
  progress, and the hub's "you'll lose your progress" confirm would be actively wrong. The one
  exception is multiplayer: it returns `true` while an MP match is live and unfinished
  (`instance.mp && !_matchEnded`), because leaving mid-MP genuinely abandons the room. The in-game
  menu's own "Quit to setup" is a separate, deliberate abandon: it warns and clears the save.

## Key design decisions

- **Agent-driven engine, same pattern as Chinchón.** The engine `await`s
  `player.agent.chooseMove(view)` uniformly; the AI resolves instantly, the human agent
  (in `ui.js`) resolves a promise on tap. All pacing (AI "thinking" delays, the escoba
  banner, the broom sequence) lives in the UI's awaited `game.onEvent(type, payload)`
  hook, never in the engine. `game.js` has zero DOM/timing concerns.
- **Two numbering modes, one deck shape.** `spanish` (default: ranks 1-7 + figures 10/11/
  12 counting 8/9/10) and `american` (ranks 1-9 + Sota, every card counts what's printed,
  no Caballo/Rey) both deal exactly one card of each capture value 1-10 per suit, so the
  capture math, scoring, and AI are mode-agnostic: `deck.js`'s `makeDeck(mode)` is the
  only place the mode matters. **American only sticks when explicitly chosen** (a
  `deckModeChosen` flag in `escoba-settings`): an earlier build defaulted to American and
  wrote it as if it were a choice, so the loader now migrates that back to Spanish unless
  the flag is set. Matt is Ana's Spanish-deck-literate; American exists for players who
  don't already know the traditional Sota/Caballo/Rey mapping (see the `card-values-as-
  printed` memory: default stays Spanish, American is opt-in, never the default).
- **Zero-layout-shift UI, an explicit design rule, not an accident.** No sentence in
  gameplay ever explains what to do (the active-player ring + the action button's own
  label are the whole instruction); every region below the top bar has fixed geometry.
  Transient state (the running capture sum, opponent-move announcements, the last-hand
  flag) lives either in an always-reserved fixed-height slot or an absolutely-positioned
  overlay inside the fixed-height mat, never in flow content that could push siblings
  around. This was retrofitted twice (see "Scope status"): once to remove instructional
  text and give the mat/hand/actions fixed heights, and again to fix the clipping that
  fixed-height introduced (see "Overhang budget" below).
- **Resume via engine snapshot, not UI-side replay.** `Game.snapshot()`/
  `Game.fromSnapshot()` serialize/restore the *entire* match (config, round, dealer,
  table, stock, every player's hand/captured/score); cards are already plain JSON-safe
  objects, no id-based rehydration needed. `playRound()`'s turn loop is split out as
  `runTurnLoop(startTurn)` so a restored mid-round match re-enters at the saved player
  index (`_nextTurn`, checkpointed at the top of each loop iteration and again right
  before a turn plays out) instead of replaying the round from scratch. The UI
  (`ui.js`) autosaves to `localStorage['escoba-save']` after every state-changing event
  and offers "Resume game" from setup when a save exists. See "Rules engine notes" for
  the exact safe/unsafe checkpoints.

## Rules engine notes (correctness-critical)

- **Capture value vs. printed rank** only diverges in `spanish` mode:
  `captureValue(rank, mode)` returns `rank` directly in `american`, and maps figures
  (10/11/12 → 8/9/10) in `spanish`. Every other rule (escoba, scoring, AI) reasons purely
  in **capture value**, never rank, so it's mode-agnostic by construction.
- **Escoba scoring is additive, not compared**: unlike "most cards"/"most coins"/"most
  sevens" (each computed via a strict sole-max, ties score nobody), each player's escoba
  count scores 1 point per escoba regardless of the other players' counts. The UI's round
  comparison table (see "Round comparison table" below) deliberately never highlights the
  Escobas row for this reason.
- **Scoring stacks in a specific way**: a player with all four 7s gets `allSevens` (3pts)
  **and** `sevens` (1pt, "most 7s", trivially true if you have all four), i.e. 4 points
  total, not 3. `guindis` (the lone 7-of-Oros point) only fires when `allSevens` didn't
  (mutually exclusive on that one line, but `sevens`/"most" stacks with either).
  `cardsBonus` (opponent under 10 cards) only applies in 2-player matches.
- **Whitewash**: a player who captures zero cards all round loses the match outright,
  2-player only (`_whitewash` in `scoreRound()`), checked before the normal target-score
  win condition in `checkMatchEnd()`.
- **Initial-table escoba** (the dealer's opening 4 cards summing to 15 or 30) is resolved
  synchronously before the turn loop starts, so `_nextTurn` is already correctly set to
  `(dealer+1)%n` by the time its `initialEscoba` event fires, so a snapshot taken there is
  safe to resume from via the ordinary turn-loop path.
- **The UI intentionally never snapshots the very first `deal` of a round** (`payload.
  first === true`): the initial-escoba check runs synchronously right after with no
  further `await`, so there's no useful mid-step there, and resuming from that instant
  would skip the initial-escoba check entirely (the resume path only replays the turn
  loop, not the first-deal setup). `test.js`'s resume test mirrors this exclusion.
- **`finishRoundAfterPlay()` orders things deliberately** for resume correctness: it
  scores the round, resolves `checkMatchEnd()`, and advances the dealer for the *next*
  round **before** emitting `roundScored`, so a snapshot taken while the round-end modal
  is showing already has the dealer/winner state a fresh restore should continue from,
  and the normal `playMatch()` while-loop (not a special "between-rounds" resume path)
  handles it correctly on its own.

## UI/CSS architecture

- **Overhang budget system** (`--eb-lift-overhang`, `--eb-badge-overhang`, `--eb-hand-
  lift-overhang` in `escoba.css`): selected cards lift and ring *outside* their own box,
  and every card's value badge bleeds past its corner. Rather than patch each clipping
  symptom, `.eb-table`/`.eb-hand` reserve padding sized to these named constants up
  front, and the mat's own fixed-height formula includes them so two full card rows
  still fit. The hinted-card dashed outline sits at `inset: -2px` (just inside the card),
  not floating outside it, specifically so two adjacent hinted cards can't collide: the
  6px table gap alone is enough clearance at that inset.
- **The mat is a fixed floor, not a fixed ceiling.** `.eb-mat` uses `min-height` (not
  `height`) and `flex: 1 1 auto` inside `.eb-game`'s column so it absorbs any leftover
  viewport height on a taller phone (extra felt, not a dead gap below the actions row).
  `.eb-table`'s own height stays a **hard** `height` (always exactly two card rows'
  worth) regardless of how tall the mat grows, so table-card layout never changes shape.
  The `.eb-game` container's own `min-height: calc(100dvh - Npx)` constant is a rough,
  empirically-tuned chrome budget (calibrated against the *hub-immersive* context at
  390x844, its primary target): if the overall vertical budget changes again (font
  sizes, card sizing, hub chrome), re-measure via `document.documentElement.scrollHeight`
  vs `window.innerHeight` rather than guessing; that constant is the one thing in this
  file not derived from a principled formula.
- **Mat-anchored overlays, each solving a "feedback lives where the eyes already are"
  problem**: the running capture sum (`.eb-sum-chip`, bottom-center), the persistent
  "last hand" state flag (`.eb-lasthand-chip`, top-right, `#ffce3a` + bold text + icon,
  never color alone, stays lit for the rest of the round rather than fading), and the
  broom sweep (`.eb-broom`) all live absolutely-positioned *inside* the fixed-height mat,
  so none of them can ever cause a reflow. The opponent-move announcement is the one
  exception: it's a **dedicated fixed-height flow row** between the top bar and the mat
  (`.eb-announce-row`), not an overlay on the mat, because it's tall enough that overlap-
  based placement collided with the card zone at the mat's actual proportions: the row
  always occupies the same space, only the pill's opacity/transform inside it changes.
- **Broom sweep** (`_startBroomSweep`/`.eb-broom` in `ui.js`/`escoba.css`): a 10-frame
  spritesheet cycled via `steps(9)` on `background-position`. The sprite's own baked-in
  motion reads as an in-place swish/dust flourish, not a true left-edge-to-right-edge
  traversal (confirmed by inspecting the actual asset), so the container's `left`
  property is animated separately to supply the real across-the-felt travel; the two
  animations run concurrently at the same duration (`BROOM_MS`). Triggered on `play`
  events where `payload.escoba === true` and on `initialEscoba` (which re-shows the
  swept cards briefly since the engine already moved them into the dealer's pile before
  the event fires). Captured cards get a directional `is-swept` exit (fly right +
  rotate + fade) instead of the plain `is-taken` lift-and-fade, timed so cards start
  flying ~150ms into the sweep and the escoba banner pops ~450ms in. Skipped entirely
  under `prefers-reduced-motion` (falls back to the ordinary capture exit). **Note**:
  the in-house preview browser forces `prefers-reduced-motion: reduce` regardless of any
  page setting, so the live sweep can only be confirmed on a real device; verify there
  before assuming a broom-adjacent change looks right.
- **Round comparison table is one shared column grid**, not a table element: every row
  (`eb-score-head`, `eb-score-row` xN, `eb-score-points-row`, `eb-score-total-row`)
  independently declares `grid-template-columns: var(--eb-score-cols)`, where
  `--eb-score-cols` (`minmax(0, 1.3fr) repeat(var(--eb-players), minmax(0, 1fr))`) is set
  once on the wrapper and inherited via normal CSS custom-property inheritance. Because
  every track's minimum is `0` (a bare fr-share, not content-sized), independently-
  declared grids with the same template and the same container width compute pixel-
  identical column positions regardless of each row's own label length; this deliberately
  avoids CSS `subgrid` (correct browser support isn't guaranteed everywhere
  this hub needs to run). The total-score band is intentionally horizontal-padding-free
  for the same reason: any inset there shifts its numbers out of line with the rows
  above it, which is exactly what the acceptance bar for this table was about.

## Settings & persistence

- **`escoba-settings`** (last-used setup): `count`, `humanName`, `humanAvatar`,
  `aiNames`, `aiDifficulty`, `targetScore`, `deckMode`, `deckModeChosen`. Precedence is
  last-used > shared hub profile > built-in default, same as every other game module.
- **`escoba-save`** (resumable match, schema `v: 1`): `{ v, matchEscobas, snap }`, where
  `snap` is exactly `Game.snapshot()`'s output plus a `midRound` flag. Cleared on
  `matchEnd` and on the in-game menu's "Quit to setup"/"New game"; **never** cleared by
  `destroy()` (that's the whole point: navigating away via the hub must preserve it).
- **MP invariants (July 2026 hardening — full list + rationale in the root CLAUDE.md,
  "Multiplayer lockstep — invariants"; regression tripwires in `test-mp-lockstep.mjs`):**
  the `'play'` hook saves AFTER `_mpAfterPlay` so the autosave's `mp.seq` matches the
  play already in its snapshot; `_mpApplyRecovery` remaps the transmitted snapshot's
  device-relative `isHuman` flags by seat (`mp.localSeat`) before rebuilding; and a
  guest restoring or recovering from a round-BOUNDARY snapshot (`midRound:false`)
  awaits the host's published round record (`_mpAwaitNextRound`) before playing, so
  the next round's deck+dealer come from the host, never a stale `presetDeck`.
- **`recordEscoba(difficulty, won, { escobas })`** in `js/game-stats.js` feeds the shared
  per-device stats (`gamehub.stats`), tab `escoba` in the Stats overlay
  (`js/game-stats-ui.js`).

## Known open items

- A `TypeError: Cannot read properties of null (reading 'avatar')` was seen once in
  `_renderMatchModal` during manual testing with a hand-built synthetic snapshot (an AI
  with an unrealistically sparse hand): `showMatchModal()` was reached with
  `this.game.winner` still `null`. Not reproduced from a normal game or the 25k-check
  automated suite in `test.js`, and not chased further (out of scope for the session
  that found it: engine work wasn't on the table that day). Worth a look if it ever
  recurs from ordinary play: it would mean `checkMatchEnd()` let `matchEnd` fire without
  a winner under some real, reachable condition, not just a hand-rolled test state.
- The broom sweep's *feel* (timing, whether the travel distance/size reads right) has
  only been confirmed by geometry (bounding-rect math) and code review, never by eye, for
  the reduced-motion reason above.

## Scope status

- **Initial build:** full Fournier ruleset (capture-to-15, escobas incl. the dealer's
  initial-table escoba, last-cards/leftover sweep, complete round scoring incl. guindis/
  all-sevens/all-coins/under-10 bonus, whitewash instant win), three AI tiers, 2-3
  players, play to 21 or 31, reusing the Anita deck. Round-end modal, match modal with a
  cumulative-score chart, How to Play sheet, profile prefill.
- **Numbering fix:** added the `american` mode after Matt couldn't parse the traditional
  Sota/Caballo/Rey capture-value mapping mid-game; briefly defaulted to American, then
  reverted the default to Spanish per Matt's explicit call (American stays opt-in).
- **Professional polish pass:** removed all instructional/status text, gave every region
  fixed geometry (zero layout shift), moved the running toast off the page-bottom onto a
  mat-anchored/reserved-row system, rebuilt the round modal as a comparison table,
  added a close (X) + Results/New-game reopen on the match modal, and added the whole
  resume/snapshot system described above. Also gave the hub shell its `immersive` mode
  (an opt-in, not escoba-specific in itself, but escoba is its first and so-far-only user).
- **Broom + round-2 fixes:** added the sweep animation and directional capture exit;
  fixed the clipping the fixed-geometry pass had introduced (the overhang-budget
  system); rebuilt the round modal's alignment as a single shared grid; redesigned the
  top bar (big score anchor, mini card-back fan, full-word round/target, the persistent
  last-hand chip); added the mat-anchored running-sum chip and over-15 tap rejection;
  and re-tuned the vertical space budget to fill the viewport without a dead band.
  Along the way, fixed a latent (pre-existing, not introduced that session) bug where
  `startGame()`/`_resumeGame()` never aborted a previously-live `this.game`, letting a
  zombie match loop keep calling the same UI instance's `onEvent` after "New game" from
  the in-game menu.
- **Roadmap (not built):** 4-player team play is out of scope (Escoba's team variant
  wasn't part of what Matt asked for); no sound; the whitewash/null-winner item above.

## Tests

```
node escoba/js/test.js
```
Deck construction (both numbering modes), ~85 full AI-vs-AI matches' worth of capture/
escoba/scoring invariants, and a kill-and-resume round-trip (JSON-serialized, mirroring
`localStorage`, up to 3 resumes per match). Run requires Node >= 22.7 (ESM syntax
detection; there is no package.json), same as Chinchón's `test.js`/`sim.js`.
