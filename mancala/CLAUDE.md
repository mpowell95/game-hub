# Mancala (`mancala/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`, immersive.

## Notes

Kalah rules vs AI (3 tiers; Pro = iterative-deepening alpha-beta under a ~380ms budget) or pass-and-play. Pure engine (`mancala/js/game.js`) + `ai.js` + `ui.js`; stones are persistent DOM elements sown pit-to-pit with WAAPI arc flights (timeout-raced so a hidden tab never stalls a move; `?motion=1/0` overrides reduced-motion). Settings in `gamehub.mancala.v1`; results via `recordResult('mancala', ...)`. Reference screenshots in `mancala/reference/` (gitignored).

CSS: every rule is descendant-scoped under the root class `.mancala` (`.mancala .mc-x`) — the
scoping-discipline reference for the repo, though the root class itself predates the `.xx-root`
naming convention and stays as-is.

i18n: `mancala/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Difficulty keys
(`beginner`/`intermediate`/`pro`) and speed keys (`normal`/`slow`) stay canonical; only their
display labels translate. `AI_ROSTER` names (Lucía, Diego, …) are proper names and are not routed
through `t()`.

**Difficulty display (2026-07-24):** the setup screen's difficulty segmented control shows the
shared ski-slope shape (`diffShapeSVG`/`tierOf`, `js/difficulty-tiers.js`) before each label, same
shapes the leaderboard uses, sized ~1em via `.mancala .lb-dshape`. No prose hint existed here to
delete (unlike Boggle) — this is shapes-only.

**How-to-play overhaul (2026-07-24, HANDOFF-FB2-HOWTO2 item 1):** the old five prose `<section>`s
(board/turn/extra-turn/capture/end) are gone, replaced with the repo-wide pattern
(tic-tac-toe/CLAUDE.md): a goal line, one mini-board diagram (`_sowDiagram()` in `ui.js`) showing
the counterclockwise sow with a visible dashed hop over the opponent's mancala, a caption, an
"X = Y" example, and two rule bullets. Matt's own words: "must be completely overhauled... same
excess-prose issue."

**Trimmed further (2026-07-24, batch D/FB3-HOWTO3):** QA rated this sheet "borderline" —
a paragraph under the diagram (caption + a separate "X = Y" example line) plus a bold
line and two bullets. The caption and example are now ONE merged sentence (`help_caption`
in `strings.js`; the `help_example` key and its `<p class="mc-help-example">` render are
deleted, along with the now-unused `.mc-help-example` CSS rule in both the light and dark
blocks) — meaning preserved, not dropped: "Tap a pit to sow its stones counterclockwise,
one per pit (your mancala counts, your opponent's is skipped); land the last stone in
your own mancala to go again." The diagram itself and the two rule bullets are untouched.

## Multiplayer (roadmap phase 2, web-session pass only — see the status line at the end)

Two human seats over the shared `js/net.js` room protocol (`js/CLAUDE.md`'s "Multiplayer
lockstep — invariants", extended by "The third consumer: Tic Tac Toe" — Mancala is the fourth).
`js/net.js` itself is untouched. `mancala/js/ui.js:622`'s pre-existing `mode:'friend'` hot-seat
already proved two human-controlled seats work on this engine; MP is that plus routing seat 1's
input over the network instead of the same screen.

- **Host = P1 (bottom), guest = P2 (top), fixed for the whole room.** `_localSeat()` returns
  `this.mp ? this.mp.localSeat : P1`. **This deviates from the Tic Tac Toe template on purpose**:
  TTT's X/O marks are symmetric and get reassigned to whichever seat opens each game (its
  `marks[]` flips). Mancala's P1/P2 are NOT symmetric — they are physically different halves of
  the board (P1 owns pits 0-5/store 6, always rendered bottom; P2 owns 7-12/store 13, always
  rendered top) — so which side you sit on is fixed for the room, like a real board's fixed
  seating; only who moves FIRST would vary, and even that doesn't here (see below). `names()` is
  seat-aware: each device always sees its OWN identity at the physical position its seat renders
  at (host at bottom/p1, guest at top/p2), never assumed.
- **Single game per room, no rematch series.** Unlike Tic Tac Toe (one room hosts a SERIES of
  games via `round.n`), Mancala plays exactly one match per room; "Play Again" in MP just leaves
  the room. `round.n` is always 1, `round.dealer` is always P1 (the host) — there is no
  alternating starter to transmit, since sides never swap. `writeResult` is deliberately unused,
  so `status:'ended'` means "somebody abandoned the room" (same convention as Tic Tac Toe).
- **Remote moves are ANIMATED, not instant-snapped.** Move delivery
  (`_mpTryDeliverNextMove`/`_mpApplyNextEntry`) is async and re-uses the real `playMove()` sow
  animation for a delivered remote move — the whole point of routing input through the existing
  engine call instead of a second instant-snap rendering path. This makes delivery
  ASYNC/SEQUENTIAL (each move must finish animating before the next is applied), unlike Tic Tac
  Toe's fully synchronous drain loop. Recovery (`_mpApplyRecovery`) is the one exception: it
  snaps directly to the recovered board rather than animating a resync nobody asked to watch.
- **A real race this async shape opens, found and fixed while testing headlessly:** a room
  update carrying a fresh move can land in the microtask gap opened by awaiting one animated
  delivery, right after the drain loop's own "nothing left to apply" check already ran against a
  stale cache — the entry would then sit undelivered until some UNRELATED room update happened
  to trigger a new drain, which might never come. Fixed with an `mp.redeliverRequested` flag,
  set whenever `_mpOnRoomUpdate` refreshes the move-log cache, checked by the drain loop before
  it actually releases `mp.delivering` — see the comments on both. `test-mp-lockstep.mjs`'s M1
  reproduced this reliably (a fast, decisive game) before the fix; all M-series tests are green
  after it.
- **The divergence latch is explicit**, same reasoning as every flag-driven game on the roadmap:
  on a hash mismatch the host takes the seq and publishes a snapshot; the guest latches
  (`mp.awaitingRecovery`) until that snapshot lands, or every subsequent room update would
  re-deliver the same entry onto the already-diverged state and burn the recovery-attempt budget
  before the host's answer could arrive.
- **MP save key**: `gamehub.mancala.mp.v1`, a third key distinct from `gamehub.mancala.v1`
  (settings) and `gamehub.mancala.game.v1` (solo autosave) — permanent once shipped (THE LAW rule
  5). Follows Chinchón's/Tic Tac Toe's separate-key convention, not Escoba's mp-sub-object shape.
- **`isInProgress()`**: `false` for solo (autosave makes leaving lossless, unchanged), `true` for
  MP (leaving genuinely abandons a live opponent's room) — same "two legitimate meanings, one
  function" pattern as every other MP game.
- **MP results record under the `'mp'` difficulty bucket** (`MP_DIFFICULTY`), settled by Tic Tac
  Toe (`js/CLAUDE.md`) — not the local setup's last AI-tier setting. `recordHeadToHead('mancala',
  opp, won)` runs alongside, guarded so it can never block the ordinary result.
- **Invariant coverage**: all five `js/CLAUDE.md` invariants are ported into Mancala's own
  vocabulary in `test-mp-lockstep.mjs`'s M1-M6 block. Invariant 3 (a per-round consumption
  queue) has no literal analogue — Mancala hosts exactly one game per room, so there is no "next
  round" for anything to leak into — M4 states this explicitly rather than dropping the probe
  silently, the same way Tic Tac Toe's T5 does for the same invariant. Invariant 5 (round-
  boundary resume keeps scores) is ported by analogy in M6: restoring an ALREADY-FINISHED match
  must not re-run or re-initialize it (the equivalent of Chinchón's score-zeroing `initMatch`
  wipe, translated to "no phantom rematch begins").
- **New file**: `mancala/js/hash.js`, FNV-1a over `{ pits, turn, over, winner }` — `pits` stays
  positional (never sorted), same reasoning as Tic Tac Toe's board array.

**Status line (2026-07-27, web-session pass): protocol proven headlessly against `FakeRoom`, all
six M-series probes green (`test-mp-lockstep.mjs`); real-room behaviour is unverified.** Real
devices are required for `HANDOFF-MP-LOCAL-MACHINE.md`'s Category B pass — this environment
cannot reach Firebase at all (see that doc's "why these four categories can't move to the
cloud"). Nothing here has been played on a real phone yet.
