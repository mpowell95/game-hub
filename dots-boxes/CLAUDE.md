# Dots and Boxes (`dots-boxes/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Draw an edge on a lattice of dots; complete a box's 4th side to claim it and go again, so one turn can chain-capture many boxes. Three board sizes, a setting independent of difficulty: Small (3x3 boxes), Medium (4x4, the only size where an even box count makes a tie possible), Large (10x10, since 2026-07-23 — was 5x5; 220 edges, an 11x11 dot lattice). Pure engine (`dots-boxes/js/game.js`, edges as `{type:'h'\|'v', r, c}`) + `ai.js`, no DOM, same synchronous shape as Filler/Mancala/Tic Tac Toe. Three shared-vocabulary tiers: Beginner takes any free box then plays randomly; Intermediate takes every free box and prefers safe moves, opening the shortest chain when forced, but never sacrifices; **Pro adds the double-cross** (`ai.js`'s `pickCaptureOrDoubleCross`) — when eating a chain/loop, it takes all but the last 2 boxes (last 4 of a loop) and plays the "hard-hearted handout" instead, trading a small sacrifice for forcing the opponent to open the next chain, UNLESS taking everything already wins the game outright on box count or it's the last region left on the board. Pro also solves the endgame exactly via alpha-beta once ≤14 edges remain (a deadline-guarded search, falling back to the heuristic on abort) — **this threshold is an edge-count, not a board-size, cap**, so Large's endgame solve costs exactly the same as Small/Medium's (measured worst move time at Large/Pro: 381ms, bounded by the solver's own 380ms deadline; heuristic-path moves on a fresh Large board measured ~1ms). No board-size cap on the exact solver was needed.

The capturable-box highlight (dashed gold pulse, `is-capturable`) only renders at Beginner difficulty (`ui.js`'s `_boardHtml`) — Matt's ask was that Intermediate/Pro give no hint; the underlying `edgeCount(...) === 3` check itself is difficulty-agnostic, only the render gate is added. Board is CSS Grid with alternating dot/cell tracks, every edge a real `<button>` expanded past its thin dot-track to a tap target via a sized-then-negative-margined box. That tap target is `min(44px, dot+cell pitch)` (`--db-tap` in `dots-boxes.css`), not a flat 44px — Large's 220 edges can't fit 44px non-overlapping tap zones in the 540px shell, so the target is capped to the track's own pitch instead, which keeps zones from bleeding into a neighboring edge's hit area (verified at 375x812: `elementFromPoint` at every one of Large's 220 tap-target centers resolves back to that exact edge, 0 mismatches; a full Large game was played via simulated random taps to completion with no freeze and a correctly recorded result). Large's board/tap sizing is its own `data-size="large"` CSS rule (`--db-dot: 8px; --db-cell: 38px` desktop, `--db-dot: 6px; --db-cell: min(6.5vw, 38px)` at ≤600px) — do not reuse Small/Medium's per-cell sizing for it. Colorblind-safe: claimed boxes show the owner's emoji glyph, never color alone. Setup screen is Escoba's accordion pattern. Settings in `gamehub.dotsboxes.v1`. Results via `recordDotsBoxes(difficulty, won, extras)`: maintains the shared `total`/`byDiff` bucket AND a `db` breakdown (`{played,won,lost,tied,boxes,bestChain}`) — `tied` is explicit (Medium, and now Large, can end tied on an even box count; the setup screen no longer says so — Matt asked for the tie note gone), `boxes` is the human's cumulative claimed-box count (additive), `bestChain` is their longest single-turn capture run ever (`Math.max` only). `isInProgress()` is the no-mid-game-resume meaning: even a Large match runs only a few minutes, so autosave wasn't worth the complexity. The in-game button that opens the setup screen reads "Menu" / "Menú" (was "New game" — Matt found that button unclear); the end-of-game overlay's own "Play again" / "Change settings" buttons are unchanged.

i18n: `dots-boxes/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Size keys
(`small`/`medium`/`large`) and difficulty keys (`beginner`/`intermediate`/`pro`) stay canonical;
only their display labels translate.

### Bug: solo results stopped recording after the first game of a session (fixed 2026-07-30)

A player (TP) reported beating the computer "a bunch of times" with none of it showing on the
leaderboard. THE LAW rule 8: believed immediately, and the recording/aggregation/leaderboard-
display code was re-read end to end before touching anything — all of it was correct. The actual
bug was TP's own hunch: **solo `startGame()` (`ui.js`) never reset `this._statsCommitted` back to
`false`.** That flag is `_commitStats()`'s idempotence guard (`if (this._statsCommitted) return;`)
— it starts `false` in the constructor, flips `true` the moment ONE game's result is recorded, and
solo's `startGame()` had no line clearing it again. `startGame()` is the shared entry point for a
fresh game, "Play again" (`rematch`), Restart, and "Menu → Start" after change-settings — none of
them create a new instance (only leaving the hub and reopening the game does, via the constructor)
— so **every game after the first one played in a session recorded nothing at all**, win, loss or
tie, completely silently (`recordDotsBoxes` never even ran). A player who opens the game once and
plays several rematches in a row (the normal way to play) gets exactly one recorded result for the
whole session, no matter how many games they actually won. The multiplayer path
(`_mpApplyRoundRecord`) already reset this same flag for every game of a rematch series — it just
never got copied into solo's equivalent function, which is why this game alone had the bug (every
other game with a `_statsCommitted` guard — Chinchón, Escoba, Filler, Mancala, Tic Tac Toe — resets
it in its own new-game path already; grepped and confirmed before writing this section, not
assumed). Fix: `startGame()` now sets `this._statsCommitted = false` right alongside the rest of
its per-game reset block (`_lastCaptured`/`_lastEdge`/`_humanChainRun`/etc.), mirroring
`_mpApplyRoundRecord`. No stored data changed, no migration — this is a write-path bug fix, not a
display fix; games played before this landed were never recorded and cannot be recovered (there
was nothing stored to carry forward). `node run-all-tests.mjs` stays green (no test exercised a
second solo `startGame()` call in one session before this, which is exactly how the bug went
unnoticed by every existing suite).

### Most-recent-move glow (2026-07-28)

The most recently drawn edge, whoever drew it, pulses (`is-last`, a slow owner-colored halo —
`--db-human`/`--db-ai`, matching the line's own ownership color, since a halo is reinforcement
and must never compete with the colorblind-safe line-color/glyph read) so "where did they just
play?" is obvious at a glance. Driven by `_lastEdge`, a cosmetic UI field on the instance
(`{type, r, c}`) deliberately kept OUTSIDE `this.state` — `hash.js` and `validDbBoardState()`
never see it, so it can never affect the MP divergence check. Threaded through the same three
move sites as `_lastCaptured` (AI move, human tap, a delivered remote move), cleared wherever
`_lastCaptured` is cleared (constructor, `startGame()`, `_mpApplyRoundRecord()`), and persisted
as an additive `lastEdge` field in all three save/restore paths (solo autosave, MP autosave, MP
recovery snapshot) — a bad or missing value degrades to `null` via a shared `sanitizeEdge()`
validator and never invalidates the save it arrived in (a cosmetic highlight can never cost a
player a live match). Suppressed once `isOver(state)` so the final board sits calm behind the
game-over overlay. Under reduced motion the halo is held steady, not removed (`animation: none`
+ a static `box-shadow`) — killing it outright would drop the cue entirely for those players.

### First-move alternation, ski-slope shapes, dropped diff prose, Restart (2026-07-24, batch 8)

`gamehub.dotsboxes.v1` gained three fields, additive on top of the frozen `size`/`difficulty`/
`humanFirst` shape (`humanFirst` itself is still written every save, kept in step with the
resolved mode, so any old reader still sees a sane boolean): `firstMode` (`'you'|'opponent'|
'alternate'`) and `nextStarter` (`'you'|'opponent'`, meaningful only under Alternate). A device
with an explicit legacy `humanFirst` boolean already saved (from before this change) has that
choice honored as `'you'`/`'opponent'` and never silently switched to Alternate; a device with no
saved choice at all defaults to `'alternate'` — same rule, same day, as Connect Four's identical
`gamehub.connect4.v1` change. Under Alternate, `startGame()` consumes `nextStarter`, flips it, and
persists immediately (mirrors `mancala/js/ui.js`), so the flip survives leaving mid-game; every
call to `startGame()` (fresh game, rematch, and the new Restart button) counts as a new game for
alternation. `newGame()` always starts at seat 0, and `startGame()` maps whichever side is opening
to seat 0, so the existing status line already announces "Your turn" / "{opp}'s turn" correctly —
no new announcement UI was added.

The difficulty picker's segmented buttons now show a COLORED ski-slope shape (`diffShapeSVG`/
`tierOf`, imported from `js/difficulty-tiers.js`, sized via `.db-root .lb-dshape`/`.lb-dshape-x2`)
before each Easy/Medium/Hard label (2026-07-24, was Beginner/Intermediate/Pro — Matt's reversal
of batch 8's rename, label-only) — the same shapes the leaderboard uses. The per-tier
explanation paragraph that used to sit under the difficulty row (`db-hint`, describing what each
AI level does) is gone entirely, along with its `hint_diff_beginner`/`hint_diff_intermediate`/
`hint_diff_pro` string keys (Matt's ask: shape + name only, no prose). The board-size row's own
hint (`hint_size_boxes`, "{rows}×{cols} boxes.") is untouched — only the difficulty explanation
was removed.

A **Restart** button sits in the mid-game action row next to How to play / Menu, confirm-guarded
exactly like Connect Four's `confirmDestructive`/`resetConfirms` (`connect-four/js/ui.js`): a
first tap arms it ("Tap again to confirm", `.is-confirm` style, 3.5s auto-reset), a second tap
resets the board with the SAME settings (no trip through setup) and participates in the
alternation logic above like any other new game.

### Silent autosave/resume (2026-07-23, batch 9 of the feedback arc)

`gamehub.dotsboxes.save.v1` (new key, separate from the frozen `gamehub.dotsboxes.v1` settings
key) holds the ONE in-progress match: board size, difficulty, both edge grids (`hEdges`/`vEdges`),
`boxes`, `turn`, `drawnEdges`/`totalEdges`, `humanSeat`/`aiSeat`, and the in-flight chain counters
(`lastCaptured`, `humanChainRun`, `humanBestChainThisGame`). `ui.js`'s `saveGame`/`loadGame`/
`clearGame` mirror `mancala/js/ui.js`'s pattern exactly (do not invent a new shape). Checkpointed
after every settled move (`_afterStateChange`, both the human and AI branches) so leaving the hub,
reloading, or closing the PWA never loses a live match; restored straight onto the board on the
next mount (`_resumeGame`, called from the constructor before `renderSetup()` ever runs) with no
"resume?" dialog — if the AI was mid-turn (including mid-chain), it just keeps playing. `loadGame`
validates hard: the saved size must resolve to a real `SIZE_META` entry and every edge/box grid
must be exactly the shape that size implies, or the save is treated as absent (never crashes the
mount). Cleared on game end (`_afterStateChange`'s over branch, plus a belt-and-braces clear in
`finish()`) and on any new game (`startGame()`, covering fresh start, rematch, and Restart) —
never on hub navigation or `destroy()`, which is the entire point. `isInProgress()` flipped from
the literal "match live right now" meaning to the autosave/resume meaning (root CLAUDE.md's "two
legitimate meanings" paragraph): it now always returns `false` for solo play, so the hub's
leave-confirm no longer appears — leaving costs nothing. (Multiplayer below is the exception
within the exception: `true` for as long as a room is joined.)

## Multiplayer (roadmap phase 2, web-session pass only — see the status line at the end)

Two human seats over the shared `js/net.js` room protocol (`js/CLAUDE.md`'s "Multiplayer
lockstep — invariants", extended by "The third consumer: Tic Tac Toe" and "The fourth consumer:
Mancala" — Dots and Boxes is the fifth). `js/net.js` itself is untouched.

- **MOVE GRANULARITY, the one design decision this web session could not fully de-risk: ONE
  LOCKSTEP MOVE PER DRAWN EDGE**, matching `game.js`'s own `applyMove(state, edge)` grain — the
  simplest thing that can work, and explicitly NOT a whole chain capture batched into one move. A
  single real turn can chain-capture many boxes (completing a box's 4th side grants another
  move, see `game.js`'s header comment), so this means many rapid `appendMove` calls inside one
  turn — up to dozens on a Large board's endgame. That is a real latency question that cannot be
  settled without a network; it is flagged in the handoff for the local device pass, and if it
  proves too slow, the fix is to batch a whole chain's edges into one move payload (a bigger
  change, deferred until proven necessary).
- **Engine seat 0/1 is SYMMETRIC, unlike Mancala's physically different board halves** — a box
  can be claimed by either seat, so `humanSeat`/`aiSeat` (the ENGINE seats) are reassigned every
  game, the same "swappable marks" shape as Tic Tac Toe's `marks[]`, not Mancala's fixed-seat
  deviation. `_localSeat()` (host = network seat 0, guest = network seat 1) stays fixed for the
  whole room; `mp.dealer` is the NETWORK seat that plays ENGINE seat 0 (i.e. opens) in the
  CURRENT game, and `humanSeat = _localSeat() === mp.dealer ? 0 : 1` is recomputed every time a
  game starts (`_mpApplyRoundRecord`) or recovers (`_mpApplyRecovery`) — every existing render/
  game-logic path already reads `humanSeat`/`aiSeat`, so nothing else needed to change.
- **One room hosts a rematch SERIES**, same vocabulary as Tic Tac Toe/Mancala: `round.n` is the
  game number, `round.dealer` is the network seat that opens (see above), alternated by the HOST
  every game via `_resolveStarter()` (the same `firstMode`/`nextStarter` alternation logic solo
  already uses — `startGame()` and `_mpStartNextGame()` both call it). `mp.series`
  (`{wins:[seat0,seat1], draws}`, seat-indexed by NETWORK seat) tracks the running tally and is
  shown on the game-over card (`_seriesLine()`); `mp.lastScoredGame` is `_mpAfterGameEnd()`'s
  idempotence guard. `writeResult` is deliberately unused, so `status:'ended'` still means
  "somebody abandoned the room."
- **Remote edges are delivered ASYNC and PACED, not instant-snapped**: `_mpApplyNextEntry`
  applies the edge, renders it (so the capture pop can play), then `await`s a fixed
  `MP_DELIVER_STEP_MS` (260ms, matching the `is-claim` pop's own CSS duration) before the next
  entry in the log can be delivered — so a chain capture reads as a sequence of drawn edges,
  mirroring the AI's own `AI_CHAIN_STEP_MS` pacing instead of the whole chain snapping in at
  once. That `await` opens the same race Mancala's M1 probe caught: a room update carrying a
  fresh edge can land in the gap right after the drain loop's own "nothing left to apply" check
  already read a stale cache. `mp.redeliverRequested`, set by `_mpOnRoomUpdate` whenever it
  refreshes the move-log cache and checked by the drain loop before it releases
  `mp.delivering`, is the fix — same flag, same reasoning, as `mancala/js/ui.js`'s.
- **The divergence latch is explicit**, same reasoning as every flag-driven game on the roadmap:
  on a hash mismatch the host takes the seq and publishes a snapshot; the guest latches
  (`mp.awaitingRecovery`) until that snapshot lands, or every subsequent room update would
  re-deliver the same entry onto the already-diverged state and burn the recovery-attempt budget
  before the host's answer could arrive.
- **A boundary restore RE-SHOWS the finished game's overlay rather than deriving or
  auto-starting the next game** — `_tryRestoreMP` calls `this.finish()` on a non-`midGame` save,
  same shape as `mancala/js/ui.js`'s restore, deliberately NOT `tic-tac-toe/js/ui.js`'s
  auto-`_mpStartNextGame()`-on-restore shape (there is no settled convention here — see
  `HANDOFF-MP-WEB-SESSION.md`'s save-key note, which applies equally to this choice). The host
  sees "Play again" and decides when game N+1 starts, exactly as if it had never left; the guest
  just waits. `finish()`'s own `_statsCommitted` guard (already restored from the save) keeps
  this idempotent, so there is no separate `_mpAwaitNextGame()`/`_mpStartNextGame()` restore
  branch to get wrong.
- **MP save key**: `gamehub.dotsboxes.mp.v1`, a third key distinct from `gamehub.dotsboxes.v1`
  (settings) and `gamehub.dotsboxes.save.v1` (solo autosave) — permanent once shipped (THE LAW
  rule 5). Follows Chinchón's/Tic Tac Toe's/Mancala's separate-key convention, not Escoba's
  mp-sub-object shape. Room `config` carries only `{ size }` — the guest never picks a board
  size, it arrives from the host.
- **MP results record under the `'mp'` difficulty bucket** (`MP_DIFFICULTY`), settled by Tic Tac
  Toe (`js/CLAUDE.md`) — not the local setup's last AI-difficulty setting, and the capturable-box
  hint (Beginner-only in solo) never renders in MP regardless of the local setup's last
  difficulty, since there is no AI tier to key it off. `recordHeadToHead('dotsboxes', opp, won)`
  runs alongside, guarded so it can never block the ordinary result. The `db` sub-counter
  (`boxes`/`bestChain`) is recorded for MP matches exactly like solo — `js/players-agg.js`'s
  existing `db` branch needs no MP-specific change, since it already sums/maxes generically
  regardless of which difficulty bucket the play landed under.
- **Invariant coverage**: all five `js/CLAUDE.md` invariants are ported into Dots and Boxes' own
  vocabulary in `test-mp-lockstep.mjs`'s DB1-DB6 block, on a small fast 2x2 test board (12 edges,
  4 boxes) so the whole block runs quickly:
  - **Invariant 1 has no literal `winner` field to gate on in the first place** — `isOver(s)` is
    purely `drawnEdges >= totalEdges`, so DB2's probe states that non-mapping explicitly rather
    than pretending there was a `winner`-keyed gate to fix; the real equivalent mistake would be
    gating game-end on a derived proxy instead of `isOver(state)` directly, and DB2 proves the
    GUEST reaches the same tied conclusion as the host.
  - **Invariant 2** (DB3) is solved by construction, same as Tic Tac Toe/Mancala: `_mpSnapshot`
    transmits only `{ gameNum, dealer, state }` — nothing device-relative — and `humanSeat`/
    `aiSeat` are RE-DERIVED from `_localSeat()` + the snapshot's `dealer` on every recovery, never
    trusted from the payload.
  - **Invariant 3** (DB4) ports DIRECTLY, same as Mancala's post-rematch-series correction: game
    2's move-log cache and `appliedSeq` are provably reset at the exact instant of
    `_mpApplyRoundRecord` (captured via a harness-only `roundResets` probe, mirroring Tic Tac
    Toe's T5/Mancala's M4, to avoid a race against game 2's own first edge already having landed
    by the time a poll resolves).
  - **Invariant 4** (DB5) is a rejoin mid-CHAIN on purpose (not just mid-alternation), since a
    chain is exactly where an off-by-one seq would first show up in this game.
  - **Invariant 5** (DB6) is ported by analogy to this game's boundary-restore-re-shows-the-
    overlay shape (see above): the restored guest must recognize `isOver(state)` and stop, never
    re-run or re-initialize the game it restored, and the series tally must survive untouched.
- **New file**: `dots-boxes/js/hash.js`, FNV-1a over `{ rows, cols, hEdges, vEdges, boxes, turn,
  drawnEdges }` — every array stays positional (never sorted), same reasoning as Tic Tac Toe's
  board array and Mancala's pits array. `turn`/`drawnEdges` are included deliberately: they are
  exactly where a chain-capture desync would hide, since `applyMove()` only flips `turn` when a
  move claims nothing.

**Status line (web-session pass): protocol proven headlessly against `FakeRoom`, all six DB-series
probes green (`test-mp-lockstep.mjs`); real-room behaviour is unverified.** Real devices are
required for `HANDOFF-MP-LOCAL-MACHINE.md`'s Category B pass — this environment cannot reach
Firebase at all. **The per-edge move granularity under real chain-capture latency (Large board,
many rapid edges in one turn) is the one thing this pass could not de-risk and is flagged
explicitly for that pass** — see the handoff entry there. Nothing here has been played on a real
phone yet.
