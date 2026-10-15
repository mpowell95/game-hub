# Escoba (`escoba/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Spanish fishing/capture game (Escoba/Scopa family): capture table cards summing to **15** with one hand
card; clearing the table is an **escoba**. Fournier rules from a PDF Matt supplied (no in-repo copy).
2-3 players vs AI solo, **2-4 humans online** ("Multiplayer at 2-4 seats"), **in-hub `module:`**,
**immersive**. Card faces are **not** its own asset: it reuses the shared **Anita** deck from
`chinchon/decks/anita/` directly (no registry, picker or copied files; `cards.js`'s `BASE` resolves
`../../chinchon/decks/anita/`, so it rides Chinchón's `sw.js` precache; there is no `escoba/decks/`).

## Layout & responsibilities

```
escoba/js/deck.js    pure card data: SUITS, makeDeck(mode), shuffle, captureValue, captureOptions, sumValues
escoba/js/game.js    async turn/round/match state machine + agent interface (no DOM); snapshot()/fromSnapshot()
escoba/js/ai.js      synchronous AIAgent, three tiers (random / greedy / card-counting)
escoba/js/ui.js      DOM, HumanAgent, render loop, modals, broom sequencing, hub init/destroy contract
escoba/js/cards.js   card-face renderer only (no registry)
escoba/js/test.js    headless engine assertions incl. snapshot/resume round-trip (node >= 22.7), not deployed
escoba/css/escoba.css all styles, .eb- prefixed, scoped under .eb-root
escoba/img/broom-sprite.webp  10-frame sweep spritesheet (480x360/frame), the only asset it owns
escoba/index.html    standalone host (calls init() directly)
```

## Hub integration

- **`immersive: true`** (floating back button; `.hub-main` gets extra top padding while active).
- **`isInProgress()` is `false` for all solo play** (persisted on every state-changing event); **`true`
  while an MP match is live and unfinished** (`instance.mp && !_matchEnded`). The in-game menu's "Quit
  to setup" is a separate deliberate abandon: warns and clears the save.

## Key design decisions

- **Agent-driven engine, same pattern as Chinchón.** The engine `await`s `player.agent.chooseMove(view)`;
  all pacing (AI delays, escoba banner, broom) lives in the UI's awaited `game.onEvent(type, payload)`
  hook, never in the engine.
- **Two numbering modes, one deck shape**: `spanish` (default: ranks 1-7 + figures 10/11/12 counting
  8/9/10) and `american` (1-9 + Sota). `deck.js makeDeck(mode)` is the only place the mode matters.
  **American only sticks when explicitly chosen** (`deckModeChosen` flag in `escoba-settings`; the
  loader migrates an unflagged American back to Spanish). Default stays Spanish, American is opt-in.
- **Zero-layout-shift UI, an explicit rule.** No sentence in gameplay explains what to do; every region
  below the top bar has fixed geometry; transient state (running sum, opponent-move announcement,
  last-hand flag) lives in a reserved fixed-height slot or an absolutely-positioned overlay inside the
  fixed-height mat, never in flow content.
- **Resume via engine snapshot, not UI replay.** `Game.snapshot()`/`fromSnapshot()` serialize the whole
  match; `runTurnLoop(startTurn)` re-enters at the saved player (`_nextTurn`, checkpointed at the top of
  each iteration and before each turn). `ui.js` autosaves to `localStorage['escoba-save']` after every
  state-changing event; setup offers "Resume game".

## Multiplayer at 2-4 seats (2026-08-11)

(Full story: CLAUDE-HISTORY.md.) Chinchón's phase-3 seat model (`js/CLAUDE.md`, "The ninth consumer")
ported; `js/net.js` and the engine needed **zero** changes (`game.js` loops `this.players` everywhere;
40 cards divide evenly at 4 seats; the under-10-cards bonus and whitewash are `twoPlayer`-gated).

- **Humans only.** An unfilled seat is never played by an AI; **Start stays disabled until every seat is
  filled** (`_mpHostStart` re-checks).
- **`mp.seat` (integer) replaced the host/guest binary**; the room's seat index IS the engine's player
  id. `mp.isHost` is `seat === 0`; `=== 'guest'` became `!mp.isHost`; `mp.localSeat` is an alias.
- `_makeRemoteAgent(seatId)` closes over its own seat (recovery must address the authoring seat;
  `_mpAfterPlay` passes `p.id`). `_mpBuildPlayers(room, mySeat, count)` builds the table in seat order
  on every device, `isHuman` only for our own seat (invariant 2); names/avatars are cosmetic (`hash.js`
  hashes cards and scores, never names).
- **`config.seats` rides the room config** so a joining/REJOINING device can size its players. The MP
  autosave has `seat` and still writes `role`; a rejoin on a different seat than the save claims is
  abandoned. **`mpSeats` is a SEPARATE setting from solo's `count`** (solo tops out at 3 with two AI
  identities).
- **Head-to-head records EVERY opponent** (`_commitStats` loops `mp.opps`); `won` means "finished ahead
  of the whole table", not pairwise.
- **Leaving mid-match ends the match for the whole table** (a decision: the engine cannot drop a seat
  without divergence). Backing out of the LOBBY frees only that seat (`net.vacateSeat`); only the host
  leaving takes the room.
- `.eb-opp-n3` re-lays the opponent pill at 3 opponents (name on its own line, hand-count fan dropped).
- Tests: `tools/test-mp-lockstep.mjs` E5 (four-seat full match, hashes identical, each device owns its seat,
  whole-deck check) and E6 (desync -> recovery to the pleading seat only). **Not verified on real
  devices.**

## Multiplayer results are recorded, and cannot be lost (2026-08-11)

Matt: *"Make it so that is impossible. Nothing should ever be able to be lost. That's the rule."*

1. **Bucket**: MP records under `MP_DIFFICULTY` (`'mp'`), not `opp0.difficulty || 'normal'` (a remote
   seat has none, so online matches were filed as Intermediate wins over the AI). `tierOf('mp')` is null.
2. **Historical matches**: `splitEscobaMp()` in `js/game-stats.js` moves them once per store using
   `h2h.escoba` as evidence (written by the same `_commitStats` call); totals untouched, clamped,
   verified by re-read, pre-migration numbers archived on `escoba.esMpSplit`, never pruned. **Matches
   older than head-to-head capture are deliberately left alone** (cannot be told apart; splitting would
   be fabrication, rule 4). Verified on the REAL records of the five devices with h2h history
   (`tools/test-stats-replay.mjs` scenario D, rule 7).
3. **Structural**: `game.js`'s `checkMatchEnd()` fires a synchronous **`onDecided`** hook in the same
   statement that sets `winner`, before any `emit`/await/abort check; `_bindGame` points it at
   `_commitStats`. The escoba tally lives in the engine (`player.matchEscobas`, folded in `scoreRound()`);
   `_matchEscobasNow()` reads it, `_seedMatchEscobas()` carries an older save's number. A failed WRITE is
   queued (`persistOrQueue` -> `gamehub.pendingResults.v1`), wired into `recordEscoba` and
   `recordHeadToHead`. Probes: `tools/test-mp-lockstep.mjs` E7/E8, `tools/test-stats-replay.mjs` D/E/F.

**Where it shows**: My Stats has an Escoba **Multiplayer** block (reads `byDiff.mp`, hidden for a
solo-only player); the leaderboard's Escoba board shows an **MP** chip per player (`js/CLAUDE.md`,
"Multiplayer on the leaderboard").

## Rules engine notes (correctness-critical)

- Capture value vs printed rank diverges only in `spanish`: `captureValue(rank, mode)`; every other rule
  reasons in **capture value**, so it is mode-agnostic.
- **Escoba scoring is additive** (1 point per escoba regardless of others); "most cards/coins/sevens"
  are strict sole-max (ties score nobody). The round table never highlights the Escobas row.
- **Scoring stacks**: all four 7s = `allSevens` (3) AND `sevens` (1) = 4; `guindis` (lone 7 of Oros)
  only fires when `allSevens` didn't. `cardsBonus` (opponent under 10 cards) is 2-player only.
- **Whitewash**: capturing zero cards all round loses the match outright, 2-player only (`_whitewash` in
  `scoreRound()`), checked before the target-score win in `checkMatchEnd()`.
- **Removed: the dealer's-luck opening escoba (2026-08-31).** Matt: *"I don't like that rule... it
  should just be deleted."* The opening table is always played against. **Do not re-add it as "the real
  rules"**; `escoba/js/test.js` has a `[KNOWN-BUG PROBE]` asserting no `initialEscoba` event is ever
  emitted and nobody holds an escoba before a card is played.
- **Every `deal` is a resumable checkpoint, the round's first included.**
- **`finishRoundAfterPlay()` orders things deliberately**: score, `checkMatchEnd()`, advance the dealer
  for the next round, THEN emit `roundScored`, so a snapshot while the round-end modal shows already has
  the next dealer/winner state.

## UI/CSS architecture

- **Overhang budget** (`--eb-lift-overhang`, `--eb-badge-overhang`, `--eb-hand-lift-overhang`): selected
  cards and value badges bleed outside their box; `.eb-table`/`.eb-hand` reserve padding sized to these
  constants and the mat's fixed-height formula includes them. Hinted-card dashed outline at `inset: -2px`.
- **The mat is a fixed floor, not a ceiling**: `.eb-mat` uses `min-height`, `flex: 1 1 auto`; `.eb-table`
  keeps a hard `height` (two card rows). `.eb-game`'s `min-height: calc(100dvh - Npx)` is an empirically
  tuned chrome budget (hub-immersive at 390x844): re-measure with `scrollHeight` vs `innerHeight` if the
  budget changes.
- **Mat-anchored overlays** (inside the fixed-height mat, never reflow): running sum `.eb-sum-chip`,
  persistent last-hand chip `.eb-lasthand-chip` (`#ffce3a` + bold + icon, never colour alone), broom
  `.eb-broom`. The opponent-move announcement is a **dedicated fixed-height flow row**
  (`.eb-announce-row`), not an overlay.
- **Broom sweep** (`_startBroomSweep`): 10-frame spritesheet via `steps(9)`; `left` animated separately
  for the across-felt travel; only on `play` events with `payload.escoba === true`; captured cards get
  `is-swept`; skipped under reduced motion. The in-house preview browser forces reduced motion, so the
  live sweep can only be confirmed on a real device.
- **The hand is reconciled, never rebuilt (2026-09-28)**: `_syncHand()` keeps one `.eb-hand-slot` per
  card id (`this._handSlots`), toggles `is-selected`, FLIPs the SLOT (the card's own `transform` is the
  selection lift); a slot's card is rebuilt only if its signature (capture value + Value-badges setting)
  changed. **Do not go back to innerHTML for the hand.** Card flights are `_fly()` clones in the fixed
  `.eb-flight` layer (z-index 200, under every modal): a **deal** renders new cards hidden
  (`is-arriving`, `this._arriving`), saves the checkpoint, flies each from the stock; a **play** hides the
  source and flies the card to its table cell, landing with `is-flown`. Off under reduced motion and
  during a rejoining guest's `replayMode` (`_flightsOn()`); a flight never resolves once `_dead`.
- **Round comparison table is one shared column grid**, not a table element: every row declares
  `grid-template-columns: var(--eb-score-cols)` (`minmax(0, 1.3fr) repeat(var(--eb-players), minmax(0,
  1fr))`, set once on the wrapper), no `subgrid`; the total-score band is horizontal-padding-free so its
  numbers stay aligned.

## Settings & persistence

- **`escoba-settings`** (frozen gen-1 key): `count` (SOLO table 2-3), `mpSeats` (ONLINE table 2-4, its own
  field), `humanName`, `humanAvatar`, `aiNames`, `aiDifficulty`, `targetScore`, `deckMode`,
  `deckModeChosen`, `assist`, `showValues`, `mode`. Precedence last-used > shared profile > default.
  Additive reads (no `mpSeats` defaults to 2; absent `showValues` means on).
- **`showValues`** (Value badges, 2026-08-11) is a pure display preference: NOT frozen into the match,
  per device, never sent over the room. The How-to diagram keeps its badges unconditionally. **Its
  control is `_valuePicker()`, not a segmented control, with no hint paragraph** (Matt: *"show the
  difference with an example card... always defer to visual instructions over prose"*): one real **Sota
  de oros** rendered both ways, value via `captureValue()`, selection by border plus check glyph.
  `--eb-card-ink` is the token for anything drawn ON a card face (fixed in both themes; the badge was
  invisible in dark mode on `--eb-ink`).
- **`escoba-save`** (schema `v: 1`): `{ v, matchEscobas, assist, snap }` plus MP-only `mp: { code, seat,
  role, seq, at }`; `snap` is `Game.snapshot()` plus `midRound`. Cleared on `matchEnd` and "Quit to
  setup"/"New game"; **never** by `destroy()`.
- **MP invariants** (full list `js/CLAUDE.md`, "Multiplayer lockstep — invariants"; tripwires in
  `tools/test-mp-lockstep.mjs`): the `'play'` hook saves AFTER `_mpAfterPlay`; `_mpApplyRecovery` remaps
  `isHuman` by seat (`mp.seat`); a guest restoring from a round-BOUNDARY snapshot (`midRound:false`)
  awaits the host's round record (`_mpAwaitNextRound`).
- **`recordEscoba(difficulty, won, { escobas })`** (tab `escoba`); `difficulty` is the AI tier solo and
  `'mp'` online; `recordHeadToHead('escoba', opp, won)` once per opponent, MP only.
- i18n: `escoba/js/strings.js`, `t()` at render time. Ids (`easy`/`normal`/`hard`, `spanish`/`american`,
  `solo`/`host`/`join`) stay canonical. Suits, Sota/Caballo/Rey, "Escoba" are identical in both
  dictionaries. Round-modal bonus footnotes come from `game.js` and stay English (known gap).

## How-to-play sheet (2026-07-24)

ONE sheet (`.eb-howto`, `max-width: 340px`, no internal scroll): goal line, one diagram (a played card +
two table cards summing to 15, `_openHowTo()`/`_howtoDiagram()`), caption, a 4-line scoring list, and a
figure-value note (`howto_figures_note`, only when `deckMode !== 'american'`: "Sota, Caballo and Rey
count 8, 9 and 10"). The old pager/table/accordion code and its strings are deleted. The 4 scoring lines
compress `scoreRound()`'s 8 items (escobas 1 each; most cards 1, +2 under-10 bonus 2-player; most oros 1,
+2 all 10; sevens 1 most, 3 for all four, or 1 for the lone 7 of Oros): re-verify against
`game.js scoreRound()` if the scoring changes.

## Known open items

- A `TypeError: Cannot read properties of null (reading 'avatar')` in `_renderMatchModal` was seen once
  with a hand-built synthetic snapshot (`showMatchModal()` reached with `this.game.winner` null). Not
  reproduced from a normal game or the 25k-check suite; if it recurs in ordinary play it means
  `checkMatchEnd()` let `matchEnd` fire without a winner under a reachable condition.
- The broom sweep's feel is confirmed only by geometry and code review, never by eye.
- Roadmap (not built): 4-player TEAM play is a rules change, out of scope; no sound.

## Tests

```
node escoba/js/test.js
node tools/test-mp-lockstep.mjs        # E1-E8
```
Deck construction (both modes), ~85 full AI-vs-AI matches of capture/escoba/scoring invariants, and a
JSON-serialized kill-and-resume round-trip (up to 3 resumes per match). Needs Node >= 22.7 (no package.json).
