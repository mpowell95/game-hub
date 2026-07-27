# Filler (`filler/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Flood-fill duel vs AI (color-pick your corner, grow to capture the majority). Pure engine (`filler/js/game.js`) + `ai.js` + `ui.js`, no worker. Settings in `gamehub.filler.v1` (the gen-3 key convention); results via `recordResult('filler', ...)`. Still on the old flat/segmented setup screen, not the accordion pattern. `ai.js`'s `pro()` tier (2026-07-22) restricts candidates to the max-immediate-capture-gain colors first, breaking ties with the deep-lookahead value - it used to weigh a "small frontier bonus" across the WHOLE option set, which could (and, ~59% of pro-vs-pro seeded games, did) outscore an actually-available capture, including the specific color that would close the board, causing the AI to stall forever until the dry-move guard force-ended the game unfilled. `game.js`'s `generateColors()` also runs a post-generation `debiasNeighborPair` pass on both starting corners: a corner's two neighbor tiles aren't adjacent to each other, so nothing previously stopped them from coincidentally sharing a color and letting one first move capture both (~24% of boards, symmetric, before the fix).

i18n: `filler/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Color ids (0-5) and difficulty keys (`beginner`/`intermediate`/`pro`) stay canonical; only their display labels translate.

**How-to-play redo (2026-07-24, HANDOFF-FB2-HOWTO2 item 3):** the old diagram (arrows threading
through a 3x3 tile grid) read as a mystery line (Matt: "I don't get the line running through the
squares"). `_floodDiagram()` in `ui.js` is now a BEFORE → AFTER pair of small 2x2 boards with a
fat arrow between them — left board shows your territory plus two outlined-not-yet-owned cells,
right board shows them joined, a dot on the arrow marks the picked color. The win-condition bullet
was also corrected against `game.js`: the engine ends on board-full-or-dry-move-limit and awards
whoever has strictly more territory (`s.counts[P1] > s.counts[P2]`), never on crossing half early
— the old bullet's "first to own more than half wins" was wrong.

### Settings: `gamehub.filler.v1` additive field, ski-slope shapes, Restart (2026-07-23, batch 8)

`gamehub.filler.v1` gained a second field, `nextStarter` (`P1`/`P2`, additive - `level` is unchanged
and still frozen vocabulary). No new setup-screen row: who opens is silently alternated every game
(new game, rematch, and the new Restart button, all via `startGame()`), flipped and persisted
immediately so it survives leaving mid-game (mirrors `mancala/js/ui.js`'s `startGame()` alternation).
The engine (`game.js`) always constructs a fresh game with `turn: P1`; when it's the AI's turn to
open, `ui.js` sets `this.state.turn = P2` right after construction and schedules `aiMove()` after the
usual `AI_THINK_MS` pause, same as any other AI turn. No new announcement banner: the existing
per-turn status line (`refresh()`, "Your turn" / "{opp} is thinking...") already reads `s.turn` and
announces who's up as soon as the game renders.

The difficulty segmented buttons render a ski-slope shape (`diffShapeSVG`/`tierOf`, imported from
`js/difficulty-tiers.js`) before each label, ~1em, via `.filler .lb-dshape` sizing rules in
`filler.css`. Stored difficulty ids (`beginner`/`intermediate`/`pro`) are untouched - display only.

A confirm-guarded **Restart** button (`data-role="restart"`) sits in the mid-game footer next to
"How to play" and "New game" (which still returns to setup, unchanged). It follows Connect Four's
`confirmDestructive`/`resetConfirms` tap-again-to-confirm pattern (`fl-ghost.is-confirm` styling,
`tap_again_confirm` string), guards on `this.state.over` rather than Connect Four's `game.isOver()`,
and on confirm calls `startGame()` directly (same board size, same settings, counts as a new game
for the alternation above) rather than returning to setup.

### Autosave/resume (2026-07-23, batch 9, `HANDOFF-FB-RESUME.md`)

`gamehub.filler.save.v1` (new key, separate from the settings key above) holds at most one
in-progress game: board colors, owners, whose turn, both players' current colors/counts, move
counters, and the difficulty level, snapshotted after every settled move (`saveGame()`, both in
`humanMove()` and `aiMove()`) and as a belt-and-braces write in `destroy()`, mirroring
`mancala/js/ui.js`'s `saveGame`/`loadGame`/`clearGame` pattern exactly. On mount, `init()` restores
straight into the live game screen with no setup step and no "resume?" dialog; a malformed or
non-standard save (wrong shape, wrong tile count, a starting corner that doesn't belong to its own
player) is treated as no save (`loadGame()` returns `null`) rather than crashing the module.
Cleared only in `startGame()` (a genuinely new game: Start, Rematch, and the Restart button all go
through it) and implicitly by `saveGame()` itself once `state.over` is true - never on hub
navigation or plain `destroy()`, which is the entire point. `isInProgress()` is flipped to the
"autosave built in" meaning from root CLAUDE.md and always returns `false` for SOLO play: leaving
mid-game costs nothing, so the hub's leave-confirm no longer fires. Stats recording is untouched - a
resumed game records exactly as an uninterrupted one, since `finish()` reads directly off
`this.state`/`this.level` regardless of whether the game was ever interrupted.

## Multiplayer (roadmap phase 2, web-session pass only - see the status line at the end)

Two human seats over the shared `js/net.js` room protocol (`js/CLAUDE.md`'s "Multiplayer
lockstep - invariants", extended by "The third consumer: Tic Tac Toe" and "The fourth consumer:
Mancala" - Filler is the fifth). `js/net.js` itself is untouched - 2 human seats, host 0 / guest
1. Extending the protocol to 2-4 players is roadmap phase 3 and does not apply here (Filler is
inherently 2-player).

**Status line (web-session pass): protocol proven headlessly against `FakeRoom`
(`test-mp-lockstep.mjs`, F1-F6, all five `js/CLAUDE.md:271` invariants ported and green). No real
room has ever been created - a cloud session cannot reach Firebase. Real-room behaviour is
unverified** until `HANDOFF-MP-LOCAL-MACHINE.md`'s Category B pass runs on two real devices.

### Seats

**Host = P1 (bottom-left corner), guest = P2 (top-right corner), fixed for the whole room.**
`_localSeat()` returns `this.mp ? this.mp.localSeat : P1`. This follows Mancala's deviation from
the Tic Tac Toe template, not Tic Tac Toe's own model, for the same reason Mancala states: P1/P2
are NOT interchangeable marks here, they are physically different fixed corners of the shared
board (`P1_START`/`P2_START`), like a real board's fixed seating - only who OPENS a given game
alternates (`mp.nextDealer`), never who sits where. `names()` is seat-aware: each device always
sees its own identity at the corner its seat physically occupies (host at p1/bottom-left, guest
at p2/top-right), never assumed - the HUD cards, the corner flags, and the color-holder emoji in
`refresh()` all read through `names()`, never `this.humanName`/`this.oppName` directly once `mp`
is set.

### Seeding: round.deck carries the seed, not room config

`generateColors(rng)`/`newGame(rng)` already took an injectable `rng` before this pass (used for
the corner-neighbor fairness debias), so no new engine hook was needed - only a seeded PRNG
(`mulberry32`, in `ui.js`) and a place to transmit the seed. **Deviation from the handoff doc's
literal wording, stated explicitly**: `HANDOFF-MP-WEB-SESSION.md` said "transmit the SEED in room
config", but this room hosts a REMATCH SERIES (a new board seed every game, not one for the whole
room) and `room.config` is fixed once at `createRoom` - so the seed rides `round.deck` instead,
the exact field Chinchón uses for its own per-round deck order. The board itself is NEVER
transmitted; both sides call `newGame(mulberry32(seed))` locally and reach byte-identical boards
(verified offline: two engines seeded from the same 32-bit int hash identically). The host rolls
a fresh `Math.random()`-derived seed every game (`_mpStartNextGame`), never reusing one.

### One room hosts a rematch series, same vocabulary as Tic Tac Toe/Mancala

`round.n` is the game number; `round.dealer` is the seat that opens that game, alternated by the
HOST every game via `mp.nextDealer` (`_mpStartNextGame()`, mirroring solo's
`nextStarter`/`startGame()` alternation). Sides themselves never swap - host stays P1/bottom-left,
guest stays P2/top-right for the whole room; only which seat the FIRST move belongs to varies.
`mp.series` (`{wins:[0,p1wins,p2wins], draws}`, indexed DIRECTLY by seat value since P1=1/P2=2 in
`game.js` - index 0 is simply unused, stated explicitly in `_mpNewState`'s comment rather than
subtracting 1 everywhere) tracks the running tally and is shown on the game-over card
(`_seriesLine()`); `mp.lastScoredGame` is the idempotence guard for `_mpAfterGameEnd()` (`finish()`
can run more than once for the same game - an overlay re-render, a restore). Both ride the MP
snapshot/save, so a host that restores mid-series keeps alternating and a restoring device's
series survives intact (the `initMatch`-zeroing failure shape from `js/CLAUDE.md`'s invariant 5,
translated to this game). The MP game-over overlay's Host sees "Play Again" (`mp-next-game`, calls
`_mpStartNextGame()`); the Guest sees a waiting message and Leave. `writeResult` is deliberately
unused, so `status:'ended'` still means "somebody abandoned the room".

### Remote moves are ANIMATED and PACED, not instant-snapped - the same async-delivery race Mancala found

Move delivery (`_mpTryDeliverNextMove`/`_mpApplyNextEntry`) re-uses the real flood-fill ripple
(`animateMove`) for a delivered remote move, then waits a settle beat (`MP_DELIVER_SETTLE_MS`)
before even checking for the next entry - the same reasoning as `mancala/js/ui.js`'s animated sow:
better UX, and the whole point of routing input through the existing render path instead of a
second instant-snap one. This makes delivery ASYNC and SEQUENTIAL, unlike Tic Tac Toe's fully
synchronous drain loop, and opens the exact race `mancala/CLAUDE.md` documents: a room update
carrying the next move can land in the microtask gap opened by the settle-await, right after the
drain loop's own "nothing left to apply" check already read a stale cache - the entry would then
sit undelivered until some UNRELATED room update happened to trigger a new drain, which might
never come. Fixed with `mp.redeliverRequested`, set whenever the room-update handler refreshes
the move-log cache and checked by the drain loop before it releases `mp.delivering` (see the
comments on both) - ported here explicitly per `js/CLAUDE.md`'s note that Dots and Boxes (the
next roadmap candidate) should check for exactly this shape too.

`game.js`'s `applyMove(s, color)` **mutates its argument** (unlike Mancala's pure `applyMove`),
so both the local-move path (`_mpAfterLocalMove`) and the remote-entry path
(`_mpApplyNextEntry`) speculate on a `cloneGame(this.state)` clone and only commit it to
`this.state` once the hash agrees - a mismatch is discarded before it can ever corrupt the live
board.

### The divergence latch is explicit

Same reasoning as every flag-driven game on the roadmap: on a hash mismatch the host takes the
seq and publishes a snapshot; the guest latches (`mp.awaitingRecovery`) until that snapshot lands,
or every subsequent room update would re-deliver the same entry onto the already-diverged state
and burn the recovery-attempt budget before the host's answer could arrive.

### Keys and files

- **`filler/js/hash.js`** - FNV-1a state hash, same construction as `mancala/js/hash.js`.
  `colors`/`owner` stay positional (never sorted, and flattened from `Uint8Array` via
  `Array.from()` before hashing/JSON - a typed array serializes as an object, not an array, which
  would silently change the hash's input shape between a fresh game and one rebuilt from a
  restored plain-JSON snapshot).
- **`gamehub.filler.mp.v1`** - a THIRD key, alongside the settings key (`gamehub.filler.v1`) and
  the solo autosave (`gamehub.filler.save.v1`). Follows Chinchón's/Tic Tac Toe's/Mancala's
  separate-key choice, not Escoba's mp-sub-object shape. Permanent (THE LAW rule 5).
- Room `config` carries nothing (`{}`); the per-game seed rides `round.deck` instead (see above).

### Which invariant checks apply (`js/CLAUDE.md:271`, probes F1-F6 in `test-mp-lockstep.mjs`)

1. **Decide the game end on `state.over`, never `state.winner`** - `winner` is `0` (no real seat)
   at the exact moment a stalemate-guard TIE ends, and this policy space is tie-prone (a
   first-legal-color policy never seeks captures). F2.
2. **Nothing device-relative is ever transmitted** - `_mpSnapshot()` carries the absolute board
   plus seat-indexed `nextDealer`/`series` only, and `_mpApplyRecovery` re-derives this device's
   own seat from `_localSeat()`, never from the payload. F3.
3. **Ported DIRECTLY, not by analogy** (this room hosts a rematch series from the start, unlike
   Mancala's original single-game shape): `net.js`'s `startRound` clears `moves` atomically with
   the record, `_mpApplyRoundRecord` rebuilds the cache from THAT snapshot and resets
   `appliedSeq` to 0, and every entry carries its own game number. F4.
4. **Autosave AFTER the move's own MP bookkeeping** - `_afterMove`'s save runs once the seq has
   been reserved/advanced, so a rejoin replays only genuinely new entries. F5.
5. **A boundary restore keeps the series and awaits the host's record** - the series tally is
   carried through untouched and a restoring guest relies on the ordinary `_mpOnRoomUpdate`
   `roundN > gameNum` branch rather than deriving a next game locally. F6.

### `isInProgress()` - the exception within the exception

Solo still returns `false` (autosave/resume, leaving is lossless). **MP returns `true` for as
long as a room is joined**, including between games while the opponent waits on the host: leaving
is consequential for them even though this device could rejoin. Same split as every other MP game
on the roadmap.

### Stats

Both devices record their own result independently and that is not double-counting
(`gamehub.stats` is keyed per PLAYER). `_statsCommitted` is set before any write and is the
idempotence guard. **MP results record under the `'mp'` difficulty bucket** (`MP_DIFFICULTY`),
settled by Tic Tac Toe (`js/CLAUDE.md`) - not the local setup's last AI-difficulty setting.
`recordHeadToHead('filler', opp, won)` runs alongside, guarded so it can never block the ordinary
result. An abandoned or desynced game is deliberately NOT recorded - it was not played to a
conclusion.

### Known limitations (path A, by design)

- Exactly 2 human seats - not a constraint of this game (it is 2-player anyway), stated so a
  phase-3 reader knows nothing here needs revisiting.
- A move appended while offline advances the local seq with nothing written to the room, leaving
  a gap the peer waits on; recovery is the backstop. Flagged for the local pass.
- The 4-character room code is not case- or lookalike-proofed beyond `net.js`'s own alphabet.
- **Unverified without a real network** (flagged for `HANDOFF-MP-LOCAL-MACHINE.md`): the
  `MP_DELIVER_SETTLE_MS` pacing beat's real-world feel over actual latency, and the seed-based
  board-generation round trip over a real Firebase round-trip (proven correct offline against
  the real engine, never against a real room).
