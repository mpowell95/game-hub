# Chinchón (`chinchon/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Hub integration: in-hub `module:`. `isInProgress()` is mode-split: **solo** returns `false` for a live
match (autosave/resume, "Solo autosave"); **MP** keeps the literal "no resume" meaning
(`instance.mp && instance._inProgress()`).

## Chinchón (`chinchon/`)

Spanish rummy (Rummy/Gin family): build runs/sets, keep your hand light, **close** when your leftover
is small; lowest cumulative score wins. Spec: `../ChinChon/docs/chinchon-game-spec.md`. Cards are a real
**Baraja Española** deck (CC BY-SA 3.0) rendered from `cards.js`; default deck is `anita`.

### Layout & responsibilities

```
chinchon/js/deck.js   pure card data: SUITS, SUIT_META, cardValue, makeDeck, shuffle, rankLadder/rankOrderMap
chinchon/js/meld.js   PURE rules engine (no DOM/state/RNG): candidate melds + exact-cover partition + scoring
chinchon/js/game.js   async turn/round/match state machine + agent interface (no DOM)
chinchon/js/ai.js     synchronous heuristic AIAgent (blunder-rate tiers)
chinchon/js/ui.js     DOM, HumanAgent, render loop, modals, avatar picker, hub init/destroy contract
chinchon/js/cards.js  card-face renderer + deck registry (image decks); preload + joker fallback
chinchon/js/test.js   headless engine assertions (node) - not deployed/precached
chinchon/js/sim.js    headless all-AI match simulation (node) - not deployed/precached
chinchon/decks/<id>/  per-deck card-face images (WebP: <suit>-<rank>, back) + CREDITS.md
```

### Key design decisions

- **No Web Worker**: the AI is light heuristic evaluation over `meld.js` (sub-ms on <=8 cards).
  `meld.js` and `game.js` stay **pure and DOM-free** as a seam.
- **Agent-driven engine**: the engine `await`s `player.agent.chooseDraw/chooseDiscard/decideClose(view)`;
  pacing lives only in the UI's awaited `game.onEvent(type, payload)` hook, never in the engine.
- **Config-driven**: `DEFAULT_CONFIG` (in `game.js`) holds all ~11 rules; the settings UI produces that object.

### UI notes (rules still in force)

- **Starting-dealer alternation (solo only)**: `startGame()` alternates the OPENING dealer (0/1), banked
  immediately in `chinchon-settings.nextStartDealer` (`Game`'s `startDealerIndex` option, consumed only by
  `initMatch()`; per-round rotation untouched; toast `toast_dealer`). **`_mpHostStart()`/
  `_mpGuestStartMatch()` never read it** (always seat 0; dealer rotation in MP is deterministic).
- **Difficulty labels** Easy/Medium/Hard are label-only (stored ids `easy`/`normal`/`hard`); the per-
  opponent picker renders `diffShapeSVG(tierOf(id))` (`.cc-root .lb-dshape`).
- **Auto-close on a fully melded hand**: `promptClose()` calls `meld.shouldAutoClose(hand, cfg)`
  (`classifyClosingHand(hand, cfg).leftover.length === 0`, pure); true for chinchón and double meld, it
  resolves `true` with no prompt. Prompt layer only: `game.js` flow, events and MP emission are
  byte-identical to a fast human tap. Partial closes (1-3 leftover) still prompt. `test.js` asserts it.
- The "Ana Banana" setup header is gone (the `anita` deck keeps that display name in the deck row).
- The players accordion row re-opening was NOT reproducible (`_setupExpanded` resets in `showSetup()`);
  if it recurs, get a screen recording.
- **Per-opponent difficulty selector**: `_seg()`'s index (`data-i`) lives on the WRAPPING `.cc-segmented`
  div; the click handler must use `a.closest('.cc-segmented').dataset.i` (reading it off the button gave
  `NaN`).
- End-game modal has a `.cc-sheet-x` close (just hides it); "New Game" is separate.
- **Each card keeps its row until the player drags it** (2026-10-23, Matt: "cards shouldn't move between
  the upper and lower levels unless i move them"): `_topIds` holds the TOP row's ids; `_handBreak` is
  derived from it. It was a COUNT, so a top-row discard pulled a bottom card up and a draw into a sorted
  hand re-sorted across the split. A drawn card ALWAYS goes on the right end of the bottom row (Matt,
  same day). Fresh deal or sort button = sorted, 3 top / 4 bottom; a row may
  hold 0-8. `--cc-hand-overlap` is computed per render when a row exceeds 4. A `PHONE_WIDTH_MAX` (699)
  guard keeps a wide desktop out of the row-fit logic.
- **Highlight-sets groups, it does not paint**: each melded card lifts (`translateY`, no layout shift)
  and gets a thin `#ffce3a` bar along its bottom edge; the numbered badge (`data-meld-num`, `::after`) is
  the non-colour differentiator between melds; non-melded cards dim (`grayscale(0.55)`/`opacity: 0.72`).
  Never both green and red (rule 9).

### How-to-play sheet (2026-07-24)

Reachable from setup (`data-action="help"`) and the in-game menu (`menu-help`); `_openHelp()`/
`_closeHelp()`/`_helpDiagram()` reuse `.cc-modal`/`.cc-scrim`/`.cc-sheet` under `data-role="help"`.
Diagram: a generic 7-card hand split into a run of 4 and a set of 3 (no suit vocabulary). Verified
against the engine: close threshold `DEFAULT_CONFIG.maxClose = 3` ("3 points or fewer", via `canClose()`),
`isDoubleMeld()` (7 cards = 3+4, -10, automatic close), `isChinchon()` (7 natural same-suit unbroken
ladder wins outright). Strings `howto`/`help_*` in `strings.js`. Re-verify if those rules change.

### Rules engine notes (correctness-critical)

- **Partition search**: `generateMelds` enumerates candidate sets/runs as bitmasks; a backtracking
  exact-cover finds the minimum-deadwood arrangement.
- **Run adjacency is positional in the config rank ladder, never `rank-1`**: 40-card ladder
  `[1..7,10,11,12]` makes **7 and 10 adjacent**; 48-card `[1..12]` does not. No wrap-around.
- **`figuresFaceValue` affects scoring values only, not adjacency** (`cardValue()` and `rankOrderMap()`
  are independent derivations).
- **`canClose` is about leftover COUNT, not just deadwood**: deadwood <= threshold with >= 2 leftover
  cards is not closeable. Threshold is inclusive (`<= maxClose`).
- **Scoring priority (strict)** in `classifyClosingHand`: chinchón -> double-meld (-10) -> six-and-one
  (leftover value) -> standard. Non-closers score standard deadwood. **Chinchón is natural-only.**
  Ace-of-Oros (if enabled as wild) is enumerated both as a wild and as its natural 1-of-oros.
- **Place-cards on ending** (`attachableCards`) applies only on a *normal* close, greedily chaining run
  extensions.

### Card decks (`cards.js` + `decks/`)

Faces are **images** through a deck registry (`DECKS`); default `anita` (`DEFAULT_DECK` in cards.js,
`DEFAULT_DECK_ID` in ui.js: flip both to change it); `baraja-libre` is CC BY-SA 3.0 (attribution in
`decks/baraja-libre/CREDITS.md` + a visible setup credit). `renderCardFace(card, opts)` builds
`<div class="cc-card"><img>`; assets `decks/<id>/<suit>-<rank>.webp` (`oros/copas/espadas/bastos`, 1-12) +
`back.webp`; jokers get a styled fallback. **Cards are opaque** (`object-fit: cover` on white); do NOT
rely on transparency. A registry entry may set `base` + `own: Set` (`ownerDeck()` resolves each face to
the deck holding the file); `anita` now owns all 48 faces + back. Escoba reuses `anita` directly.
**Adding a deck**: rasterize every card **at a fixed width and flatten onto white** (`resvg` ->
`sharp.flatten({background:'#fff'}).webp()`); do NOT crop to the content bbox or ship transparent cards;
~400px WebP; register in `cards.js`, add files to `sw.js` ASSETS, bump `CACHE`. The `anita` deck is a
personal friends deck (Ana + Matt court cards, Betty win/lose screens `decks/anita/betty-{win,loss}.webp`
gated in `ui.js`, deck picker `open-deck`/`pick-deck`/`close-deck`, `deck` persisted in
`chinchon-settings`).

Roadmap (not built): unify pip style with the court cards; one-undo; sound.

### Tests

```
node chinchon/js/test.js   # engine unit assertions (deck + meld), incl. shouldAutoClose and M2c turnEnd resume
node chinchon/js/sim.js    # 30 all-AI matches
node tools/test-mp-lockstep.mjs  # C1-C7
```
Needs Node >= 22.7 (no package.json).

i18n: `chinchon/js/strings.js`, `t()` at render time. Difficulty ids, rule/config values and MP protocol
fields stay canonical; only display labels translate. Suit terms, the gallery's rank names
(`galleryLabel()`), and "Chinchón" stay Spanish in both languages.

---

## An online match records under 'mp', not under an AI tier (2026-09-09)

`_commitStats` writes `MP_DIFFICULTY` ('mp') whenever `this.mp` is set (it used to file every online match
as a Medium win over a non-existent AI); solo still reads the opponent AI's tier. `tools/test-mp-lockstep.mjs`'s
C1 block mirrors the branch and fails if reverted. **NOT RETROACTIVE, deliberately** (rule 5): earlier
matches stay in `normal`.

## Hub notes

In-hub `module:`; Spanish rummy vs AI; no worker.

## Solo autosave (batch 9, 2026-07-23; mid-round in batch C, 2026-07-24)

Key `gamehub.chinchon.solo.v1`, separate from the frozen `chinchon-settings` and the MP key
`gamehub.chinchon.mp.v1` (none read or written by another's path). Shape `{ v: 1, at, snap:
this.game.snapshot() }`.

- **Written** at `'roundScored'` AND on `game.js`'s `'turnEnd'` event (emitted once a turn is genuinely
  complete). **Never save on `'turnStart'`**: `_nextTurn` is set to the NEXT player at the top of a turn,
  so a snapshot there resumes past whoever was about to act and skips their whole turn.
  `chinchon/js/test.js` M2c compares a `'turnEnd'` resume's full turn order against an uninterrupted run
  (`T4.2` alone would stay green with the bug). Never written for a concluded match.
- **Kept until the match ends** (2026-10-23, Matt: "just like all the other games"); the 30-minute limit
  is gone for solo (live-room saves keep it). The save also carries `counts` (this match's closes) so a
  resumed match records them; an older save without it starts them at 0.
- **Restored** silently on mount (`_trySoloRestore()`, called BEFORE `_tryRestoreMP()`; if it restores
  the MP restore is skipped). A malformed save is "no save" and wiped.
- **Cleared** on match end (solo branch), quitting to setup mid-match (`showSetup()`, `this.mp` falsy),
  and the menu's "new game" (`startGame()`). Never on hub navigation or `destroy()`.
- Every solo method no-ops when `this.mp` is set; no MP method reads `STORE_SOLO_SAVE`. Stats recording
  is untouched.

## Multiplayer at 3-4 seats (2026-07-28)

(Full story: CLAUDE-HISTORY.md.) The host picks the table size (2/3/4); the lobby lists every seat.
**Humans only**: an unfilled seat is never an AI and **Start stays disabled until every seat is filled**.
**The engine needed ZERO changes** (`game.js` loops `this.players` everywhere); the change is the network
layer and this file's MP glue.

- **`mp.seat` (integer) replaced the host/guest binary**; the room's seat index IS the engine's player id
  on every device. `mp.isHost` is `seat === 0`; `=== 'guest'` became `!mp.isHost`.
- **`_makeRemoteAgent(seatId)`** closes over its own seat (`_remotePlayer()` is gone; its first-remote-
  seat answer is wrong at 3+ seats because `p.id` steers recovery addressing).
- **`_mpBuildPlayers(room, mySeat, count)`** builds the table in seat order on every device, `isHuman`
  only for our own seat (invariant 2); names/avatars come from the roster and are cosmetic (`hash.js`
  hashes cards and scores).
- **`config.seats` rides the room config** so a joining/REJOINING device can size its players. The MP
  save has `seat` and still writes `role`; a rejoin on a different seat than the save claims is abandoned.
- **Head-to-head records EVERY opponent** (`_commitStats` loops `mp.opps`); `won` = finished ahead of the
  whole table, not pairwise.
- **Leaving mid-match ends the match for the whole table** (a decision). Backing out of the LOBBY frees
  only that seat (`net.vacateSeat`); only the host leaving takes the room.
- Two `js/net.js` fixes (transactional `joinSeat`, seat-addressed recovery): `js/CLAUDE.md`, "The ninth
  consumer".
- Tests: `tools/test-mp-lockstep.mjs` C5 (four-seat match, hashes identical), C6 (desync -> recovery to the
  authoring seat), C7 (per-seat recovery records cannot clobber each other). **Not verified on real
  devices.**

## MP invariants (July 2026 hardening — full list in `js/CLAUDE.md`, "Multiplayer lockstep — invariants")

Chinchón-side obligations: the engine decides the match end BEFORE emitting `roundScored` and announces
it as `payload.matchOver` (every MP gate keys on that, never `this.game.winner`); `config.presetStockResets`
is a shift()-consumed queue, never indexed by `resetsUsed`; `_mpApplyRecovery` remaps `isHuman` by seat;
a round-boundary snapshot (`midRound:false`) resumes via `_resumeNextRound` (never `initMatch()`, which
zeroes scores), a restoring guest awaiting the host's round record (`_mpAwaitNextRound`).

## The setup screen fits (2026-09-08, 2026-10-13)

Matt: *"I don't want any game in the gamehub to be scrollable at all. Everything MUST fit on a single
screen. Always."*

- **Sideways scroll was ONE line in `index.html`**: `body` is `display: flex`, so a flex item's default
  `min-width: auto` made `.cc-root` 452px wide at 390. **`#chinchon { min-width: 0 }`** fixes it.
- **Height** (hub at 390x664, 141px over): the two foot buttons share one row (Start game / How to play)
  on a short screen, tighter panel gaps/padding, mode chips and settings labels held to one line. **The
  seven summary rows stay at 42px** (tap targets). Scoped to `max-height: 760px` AND (since 2026-10-13,
  360x804 Unai's Android) `max-width: 380px` inside `.hub-main`. `tools/check-no-scroll.mjs` measures both.
- `.cc-game` (the hand and the mat) is a separate screen and still measures over in the hub
  (`tools/test-visual.mjs` known gaps); that needs a card-size pass with eyes on screenshots.

## Computer speed, face-down hands and card travel (2026-09-28)

- **Computer speed** Slow/Normal/Fast, `pace` in `chinchon-settings` (absent = Normal), inside the
  Difficulty row (a "Speed" line; row cost height). `_paceMs(ms, p)` scales only a computer's beats and
  only in SOLO.
- **Opponents' hands face down**: pill carries `.cc-opp-hand` (up to 4 backs + exact count) and
  `data-pid`.
- **Card travel** (`_fly`, fixed `.cc-flight` layer z-index 110 under every modal): draw from stock
  (back, turning face up) or discard into your hand / the drawer's pill; discard to the pile; the deal
  flies every card from the stock. **Read the start point BEFORE the render** (it replaces the discard's
  top node); the landing card stays hidden until its copy arrives (`this._arriving`); a computer's
  draw/discard awaits flight + beat together (`Promise.all`); the SOLO first turn waits for the deal;
  online never waits on a flight; a rejoining guest's `replayMode` skips them. No engine, save or
  protocol change. Not yet checked by eye on a phone or in a real online match.

## Smooth hand (2026-10-23, Matt: "choppy and rough")

- **Hand cards glide** (`_slideHand`, FLIP on `offsetLeft/Top`, `SLIDE_MS` 220) whenever a render moves
  them: draw, discard, sort, drag-drop. A dropped card glides from where the finger let go (`_dragLand`).
- **Drag onto the pile flies from the drop point** (`_dropFrom`); it used to snap back to the hand first.
- Grabbing a selected card keeps its lift; a yellow bar (`.cc-drop-mark`, in `.cc-flight`) shows where it
  will land, from the same `_dropResult` that `_applyDrop` applies.
- A stock draw turns face up on landing (`_turnUp`); a flown card skips the `is-new` bounce (`is-flown`).
- Hover lifts only under `@media (hover: hover)` (stuck raised on phones). `_setHTML` skips unchanged
  slots so the your-turn pulse no longer restarts on every tap. Engine, saves, protocol untouched.

## Turn-by-turn challenges (2026-10-18)

Matt: *"You should be able to challenge someone to turn by turn games in all multiplayer games too."*
Darts' challenges are the model (structure only). Story: `CLAUDE-HISTORY.md`, same heading.

- **Where**: the setup switch's fourth choice, **Challenge** (`mode: 'turns'` in `chinchon-settings`):
  New challenge, Your turn, Waiting (lists cut to fit). New challenge -> person -> length (**1 hand /
  50 points / 100 points**, one tap sends). Live rooms (Host / Join) are unchanged. Files:
  `js/mp.js` (data), `js/ch-ui.js` (screens, lazy), `js/alert.js` (launcher; `alerts:` on the hub
  entry), the `this.ch` block in `js/ui.js`. 2 players only.
- **Length on the engine, honestly**: 1 hand = `victoryCondition 'rounds'`, `roundsLimit 1`; 50/100 =
  the engine's own points ending (`scoreLimit`): the match ends once somebody is OVER it, lowest total
  wins. There is no "first to 50" in Chinchón. Equal totals (no chinchón) = a draw. Rules are the
  standard `DEFAULT_CONFIG` ones, STORED on the match (`rules`); placing cards is automatic.
- **A match is a seed + a log**: `chinchon/games/<id>` holds `seed`, `len`, `rules` and every decision
  (`{by, k:'draw', src}`, `{by, k:'discard', card}`, `{by, k:'close', yes}`); both phones replay
  `game.js` (UNCHANGED) with `seededRng(seed)` and the log; `validateGame` (async) refuses anything
  that does not replay. Seat 0 = the challenger (side a) and plays first (`startDealerIndex 1`).
  Written one decision at a time (`appendLog`, verified, outbox `gamehub.chinchon.ch.outbox.v1`);
  index rows change only when the turn passes or the match ends.
- **Hidden cards are NOT secret**: both hands follow from the stored seed, so dev tools can read the
  other hand. Accepted (Hold'em has the same limit); never describe it as hidden.
- **Stats**: once per phone through the ledger (`gamehub.chinchon.ch.counted.v1`) as
  `recordChinchon('mp', won|null, {closed, minusTen, chinchons})`, the live rooms' bucket. **Never
  `recordHeadToHead`** (the Multiplayer screen's Records reads challenges from the index; Games counts
  Chinchón's `mp` bucket once, `js/mp-records.js`). Never touches `chinchon-stats` or either autosave.
- Cancel / Decline / Resign / 3-day expiry per `js/challenge-life.js`; online gate like Darts. Quick
  chat at `chinchon/chat/<id>` (`CH_CHAT_PLACE`, left of the menu). `chinchonTurnPush` and the
  `chinchon` rules branch are live (rules 2026-10-18, function by the workflow 2026-10-21).
- Tests: `node tools/test-chinchon-mp.mjs`; `tools/check-no-scroll.mjs chinchon` measures the
  challenge home. **Not played on two real phones yet.**
