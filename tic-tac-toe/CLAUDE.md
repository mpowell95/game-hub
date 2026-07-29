# Tic Tac Toe (`tic-tac-toe/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`. `isInProgress()` is mode-split (see "Multiplayer" below):
**solo** returns `false` (autosave/resume, leaving is lossless); **MP** returns `true` while a
room is joined, since leaving is consequential for the live opponent.

## Notes

Two variants, one segmented control in setup: **Classic** (3x3) and **Ultimate** (nine 3x3 boards nested in a 3x3 meta-board; the cell you play picks which board your opponent plays next, a resolved target board grants a free move, and a small board that fills with no winner is DEAD — counts for neither side, never playable again). Pure engine (`tic-tac-toe/js/game.js`) + `ai.js`, no DOM, same synchronous shape as Filler/Mancala (no async agent interface — a move has no multi-step resolution to pace). Three shared-vocabulary tiers (beginner/intermediate/pro) per variant: Classic Pro is **exhaustive minimax, unbeatable by design** (a perfect opponent can only draw it — intentional, not a bug); Ultimate Pro is iterative-deepening alpha-beta under a ~380ms budget (Mancala's Pro tier is the precedent for that number), with a 4-term eval (positional small-board ownership, meta-line potential, in-board two-in-a-row, and a heavily-weighted "send penalty" for handing the opponent a good board or a free move — the term that makes it play like Ultimate instead of nine unrelated games). Setup screen is Escoba's accordion pattern. Settings in `gamehub.tictactoe.v1`. Results via `recordTicTacToe(variant, difficulty, won)`: maintains the shared `total`/`byDiff` bucket (draws derived, like every other game) AND an explicit per-variant `tt.classic`/`tt.ultimate` `{played,won,lost,tied}` breakdown — `tied` is stored explicitly there (not derived) because this game is draw-heavy, especially Classic vs Pro; the Stats tab shows all six W/L/T numbers, never folded away.

**A tie is not a win, anywhere it is displayed (Matt, 2026-07-28: "Tictactoe ties are being counted
as wins. That's wrong.").** This game is where the repo-wide draws-as-wins display rule was most
obviously broken — Classic Pro is unbeatable by design, so a long stalemate streak rendered as a
winning streak on both the Leaderboard and My Stats. The fix is entirely in the shared read-time
transform (`record()`/`bucketsOf()` in `js/leaderboard-rank.js`, plus `ttVariantWins()` in
`js/leaderboard-ui.js` for this game's own Ultimate/Classic card); nothing this game stores changed,
and `recordTicTacToe` is byte-identical. Full rationale: `js/CLAUDE.md`, "The leaderboard's rating
model".

The How-to-play screen pattern in the root CLAUDE.md was worked out on this game;
`openHelp()` in `js/ui.js` is its reference implementation.

**Bug fix (2026-07-24, batch D/FB3-HOWTO3): the sheet always showed Ultimate's content,
even with Classic selected.** `openHelp()` now reads the variant at render time —
`this.state.variant` when a match is live (`this.view === 'game'`), else the pending
`this._setup.variant` — and branches to `_helpUltimateMarkup()` (unchanged) or the new
`_helpClassicMarkup()`. Classic gets a genuinely minimal sheet (root CLAUDE.md item 3:
"barely needs more than the diagram"): goal `Get three in a row.`, a small 3x3 diagram
(`_classicDiagram()`) with a diagonal three-in-a-row highlighted via an actual connecting
stroke (`.ttt-dg-winline`, never color alone — diagonal chosen because even in a 3x3 it's
the least obvious of the eight lines), one caption, no example, no bullets. Both the
setup-screen and in-game help buttons call the same `openHelp()`, so a match already in
progress always shows the variant actually being played, not whatever was last selected
in setup. New strings: `help_classic_lead`/`help_classic_diagram_aria`/
`help_classic_caption`.

i18n: `tic-tac-toe/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Variant keys
(`classic`/`ultimate`), difficulty keys (`beginner`/`intermediate`/`pro`), and marks (`X`/`O`) stay
canonical; only their display labels translate.

### Who goes first, and mid-game Restart (2026-07-23, batch 8)

`gamehub.tictactoe.v1` gained two additive fields, `firstMode: 'you'|'opponent'|'alternate'` and
`nextStarter: 'you'|'opponent'`, alongside the frozen `variant`/`difficulty`. The old boolean
`humanFirst` field is no longer written but is still read once, on load, as a fallback: any device
with a pre-existing save (the `humanFirst` key present at all) has it mapped to `firstMode`
`'you'`/`'opponent'` and treated as that device's standing choice; a device with **no** saved
settings yet defaults to `'alternate'` (Matt: every turn-based game should default to alternating
who goes first). Under Alternate, `startGame()` flips `nextStarter` and persists it immediately —
before the state is built — so the flip survives leaving mid-game; a rematch or the new mid-game
**Restart** button both call `startGame()`, so both count as a completed game for alternation,
same as Connect Four's menu-restart. No new announcement UI was added: the existing status line
(`_statusText()`, "Your turn" / "{opp}'s turn" / "{opp} is thinking...") already reflects who
opens, immediately after `startGame()` runs.

Restart (`data-role="restart"`, mid-game action row) is confirm-guarded exactly like Connect
Four's menu Restart/Quit (`confirmDestructive`/`resetConfirms` in `js/ui.js`, `.is-confirm` in the
CSS): a no-op single tap while a game is in progress arms a 3.5s "tap again to confirm" state,
immediate on a finished game.

The difficulty pills render a ski-slope shape (`diffShapeSVG`/`tierOf`, imported from
`js/difficulty-tiers.js`) before the label — `.ttt-root .lb-dshape` sizing rules in
`tic-tac-toe.css`, same pattern as Connect Four. The per-tier difficulty description paragraph
(`ttt-hint` under the difficulty row) was removed the same batch; the difficulty row now shows
only shape + name. The Ultimate/Classic variant row keeps its own explanatory hint
(`hint_variant_ultimate`/`hint_variant_classic`) — that one was never in scope, only the
difficulty explanation was.

### Autosave/resume (2026-07-23, batch 9, HANDOFF-FB-RESUME.md)

Silent autosave/resume, same pattern as `mancala/js/ui.js`'s `saveGame`/`loadGame`/`clearGame`.
Key `gamehub.tictactoe.save.v1` (separate from the frozen settings key above — never touched by
this feature). Checkpointed from the single post-move funnel (`_afterStateChange`), so it covers
both variants with one code path: `{v, variant, difficulty, humanMark, aiMark, state}`, where
`state` is the engine's own state object for whichever variant is live (Classic's `board` or
Ultimate's `boards`/`meta`), stored as-is since it's already plain JSON-safe data. `loadGame()`
validates the shape hard (variant, marks, difficulty, and the board/boards arrays are all
present and the right size, `state.over` false) — anything malformed or stale is treated as no
save, never a crash on mount. Restore is silent: straight onto the board via `resumeGame()`,
no "resume?" dialog; if the saved turn belongs to the AI, it moves on its own via the normal
`_afterStateChange` funnel. Cleared on game end (handled inside `saveGame()` itself once
`state.over`), on Restart/rematch (`startGame()` clears before building the new match), and on
"New game" mid-match (`renderSetup()` clears when navigating away from an unfinished game).
Never cleared on `destroy()` or hub navigation — that is the whole point. `isInProgress()` was
flipped to the "autosave/resume built in" meaning (root `CLAUDE.md`): it always returns `false`
now, so the hub's "leave game?" confirm no longer appears for this game. Stats recording is
untouched — a resumed match records exactly as an uninterrupted one, including ties.

## Multiplayer (2026-07-27, HANDOFF-MP-ROADMAP.md phase 1)

Two human devices over the shared `js/net.js` room protocol, both variants. **Phase 1 of the
roadmap: this is the game the repo's MP conventions were settled in**, so phases 2-4 copy from
here. `js/net.js` itself is untouched — 2 human seats, host 0 / guest 1. Extending the protocol
to 2-4 players is roadmap phase 3 and is not part of this.

**Status: the protocol is proven headlessly against `FakeRoom` (`test-mp-lockstep.mjs`, T1-T7,
all five invariant probes green). No real room has ever been created — a cloud session cannot
reach Firebase. Real-room behaviour is unverified** until
`HANDOFF-MP-LOCAL-MACHINE.md`'s Category B pass runs on two real devices; B2 (guest seat
identity) is the priority.

### Seats

`_localSeat()` was built in from the start, not retrofitted. `this.marks` is a two-entry
seat->mark array (`marks[0]` = the host's seat, `marks[1]` = the guest's); solo is the
degenerate case where the local human is seat 0, so `marks` is exactly the old
`humanMark`/`aiMark` pair with the seat made explicit. Everything "self" goes through
`_localSeat()` -> `_myMark()`/`_oppMark()`, including `_commitStats()`'s win/loss — **a guest
recording the host's result is a THE LAW rule 2 violation** (a loss written as a win is not
additive-safe). The old save key's `humanMark`/`aiMark` FIELD names are unchanged (rule 5); only
the in-memory representation generalized.

### How the room's vocabulary maps

This game has no rounds, no deck, no dealer and no rng, so `net.js`'s existing fields are
re-used rather than extended:

| `net.js` | Tic Tac Toe |
|---|---|
| a `round` record | ONE GAME of a rematch series in this room |
| `round.n` | the game number |
| `round.deck` | unused |
| `round.dealer` | the SEAT that plays X in that game (the "who opens" datum) |
| `writeResult` | **deliberately never called** — it sets `status:'ended'`, which would kill a room that is meant to host the next game. So `status:'ended'` means exactly one thing here: somebody abandoned the room |

The host is the only side that decides who opens (`_resolveStarter()`, the same
`firstMode`/`nextStarter` logic solo uses, so Alternate alternates across a series). The guest
NEVER derives it — it reads the published record. Both sides then start the game through the one
entry point, `_mpApplyRoundRecord()`.

### The remote seat is not an agent

Chinchón and Escoba's engines `await` a per-player `agent`, so their MP glue swaps in a
`_makeRemoteAgent()`. This engine is a synchronous `applyMove(state, move)` with the UI deciding
who acts, so the remote seat is a third kind of **turn owner in the UI's own dispatch**: where
solo schedules the AI on a timer (`_afterStateChange`'s `AI_THINK_MS` branch), MP renders and
waits for the next entry in the room's move log. `_isLegal()` is the single legality gate, read
by the local tap path AND by every remote move before it is applied — one gate for both seats is
what makes a network-driven seat safe.

### Keys and files

- **`tic-tac-toe/js/hash.js`** — FNV-1a state hash, same construction as `chinchon/js/hash.js`.
  Nothing is sorted (every array here is positional, unlike a hand of cards). Ultimate's derived
  routing state (`meta`, `forcedBoard`) is deliberately IN the hash: it is exactly where an
  Ultimate desync would hide.
- **`gamehub.tictactoe.mp.v1`** — a THIRD key, alongside the settings key and the solo autosave.
  Follows Chinchón's separate-key choice, not Escoba's mp-sub-object shape. Permanent (rule 5).
  Written after every settled move and again at a game's end; 30-minute rejoin window.
- Room `config` carries only `{ variant }`.

### Which invariant checks apply (`js/CLAUDE.md:271`, probes T1-T7 in `test-mp-lockstep.mjs`)

1. **Decide the game end on `state.over`, never `state.winner`** — `winner` is null at the exact
   moment a DRAW ends, and Classic is draw-heavy by construction. T2.
2. **Nothing device-relative is ever transmitted** — `_mpSnapshot()` carries the absolute board
   plus seat-indexed `xSeat`/`series` only, and `_mpApplyRecovery` re-derives this device's own
   mark from `_localSeat()`. Solved by construction rather than remapped on arrival. T4.
3. **Ported by analogy; the literal mechanism does not exist here** — there is no consumable
   randomness queue in a game with no rng. The failure shape (per-round consumption state leaking
   into the next round) maps onto the move log: `startRound` clears it atomically with the record,
   `_mpApplyRoundRecord` rebuilds the cache from that snapshot and resets `appliedSeq`, and every
   entry carries its game number. T5, which states the non-mapping in its own failure message.
4. **Autosave AFTER the move's own MP bookkeeping** — `_afterStateChange`'s save runs once the
   seq has been reserved/advanced, so a rejoin replays only genuinely new entries. T6.
5. **A boundary restore keeps the series and awaits the host's record** — the series tally is
   carried through untouched (the `initMatch`-wipe analogue) and a restoring guest blocks on
   `_mpAwaitNextGame()` rather than guessing who opens. T7.

Additionally: on a hash mismatch the **host takes the seq** (keeping its authoritative state and
publishing a snapshot) while the **guest latches** (`mp.awaitingRecovery`) until that snapshot
lands. Without the latch every room update re-delivers the same entry onto the diverged state and
burns the 3-attempt budget before the host can answer — see `js/CLAUDE.md`'s note that the
reference games are shielded from this only by their agent interface.

### `isInProgress()` — the exception within the exception

Solo still returns `false` (autosave/resume, leaving is lossless). **MP returns `true` for as
long as a room is joined**, including BETWEEN games while the opponent sits on the "waiting for
host" screen: leaving is consequential for them even though this device could rejoin. Same split
as `chinchon/js/ui.js:2441` and `escoba/js/ui.js:2124`.

### Stats

Both devices record their own result and that is not double-counting (`gamehub.stats` is keyed
per PLAYER). `_statsCommitted` is set before any write and is the idempotence guard. **MP results
record under a `'mp'` difficulty bucket**, not the local setup's last AI tier — a human opponent
has no AI tier. `tierOf('mp')` is null, so the play counts in every total and in the
leaderboard's All filter and claims no tier pill (`DIFF_META` in `js/game-stats-ui.js` gives it a
label). `recordHeadToHead('tictactoe', opp, won)` runs in MP only, inside a try/catch that can
never block the ordinary result. **An abandoned or desynced game is deliberately NOT recorded**:
it was not played to a conclusion, and inventing a win or loss for it would be fabricating
history. Games in the series that DID conclude were each recorded at their own end.

### Known limitations (path A, by design)

- Exactly 2 human seats. Not a constraint of this game (it is 2-player anyway), but stated so a
  phase-3 reader knows nothing here needs revisiting.
- A move appended while offline advances the local seq with nothing written to the room, leaving
  a gap the peer waits on. Chinchón and Escoba have the same property; recovery is the backstop.
  Flagged for the local pass.
- The 4-character room code is not case- or lookalike-proofed beyond `net.js`'s own alphabet.

---

## How-to-play screens — the repo-wide pattern (worked out here, 2026-07-21)

Reference implementation: `tic-tac-toe/js/ui.js` (`openHelp()`).

**Explain only the one genuinely non-obvious mechanic.** Skip anything the player already
knows — do not re-explain basic rules of a game everyone grew up with. For Tic Tac Toe that
meant explaining only Ultimate's "your cell picks their board" rule and nothing else.

Structure, top to bottom:

1. **One short bold sentence** stating the goal or win condition.
2. **A small SVG diagram** illustrating the confusing mechanic directly. If you can show it,
   do not describe it in prose. (Tic Tac Toe's: nine board outlines, one showing its own
   mini-grid with a marked cell, and an arrow curving to the board that cell sends the
   opponent to.)
3. **A caption** under the diagram stating the rule in plain words.
4. **A concrete one-line example in "X = Y" format** (e.g. "Play top right box = Opponent
   plays top right board").
5. **Any remaining edge cases**, each as its own plain sentence. No bullets unless there are
   three or more.

Rules for the whole screen:

- **Every line of text must fit on a single row.** Do not guess a font-size. Measure the
  actual rendered width against the container's real available width, size down until it
  fits, then lock it with `white-space: nowrap`.
- **Spacing between elements must be explicit and deliberate** — one flex container with a
  fixed `gap`, or hard-coded margins. Never leave it to collapse naturally between two
  unrelated rules.
- **The diagram must carry its meaning through shape, outline, and arrows, never color
  alone** (colorblind-safe, same as the palette rule above).

This pattern applies to EVERY game help screen, not just this one - it lives here because
`openHelp()` in this game's `js/ui.js` is the reference implementation the root file names.
