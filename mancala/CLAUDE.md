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
(`docs/BUILDING-A-GAME.md`): a goal line, one mini-board diagram (`_sowDiagram()` in `ui.js`) showing
the counterclockwise sow with a visible dashed hop over the opponent's mancala, a caption, an
"X = Y" example, and two rule bullets. Matt's own words: "must be completely overhauled... same
excess-prose issue."

## The board is NEVER horizontal (2026-08-11 — settled, do not re-add)

Matt: *"Mancala should NEVER be horizontal."*

A `@media (min-width: 720px)` block in `mancala.css` used to flip the board to a "classic
horizontal" layout — two ROWS of pits between stores on the left and right — on any screen 720px
or wider. **It is deleted, not disabled.** The board is one shape at every width now: two COLUMNS
of pits, each store a wide bar across the top and bottom. Verified at 393, 800 and 1280px wide.

Two reasons it is worth keeping gone, beyond the instruction:

- A second layout is a second thing every future change has to be checked against, and nothing
  was checking it — no test ever opened this game above 720px.
- **It is what made the how-to carousel get built upside down.** A session reading this game's CSS
  finds the word "horizontal" with no way to tell it applied only to a width the hub (`.hub-main`,
  `max-width: 720px`) barely reaches. That is a trap for exactly the kind of session that most
  needs to know the board's shape.

If a wide-screen layout is ever wanted again it is a deliberate design pass, with the how-to
illustration following the same breakpoint — not a leftover media query.

## HOW TO PLAY — the animated carousel (2026-08-11)

**This REPLACED the static sheet described below.** Matt uploaded seven iPhone screen recordings
to `reference/mancala/` and asked for the same treatment Yahtzee had just had: *"Clone the how to
pages. Exactly. Animations included."* (How to actually watch a `.MOV` is in
`reference/README.md` — it is not something a session can just open.)

`js/howto.js`, six pages, the reference's own order and wording, with the same chrome as
`yahtzee/js/howto.js` because the reference app is the same one.

Three things from the recordings that are easy to miss:

1. **Seven recordings, six pages.** Two pages change their caption PART-WAY through their own
   animation — the sow page reads "…distributed counterclockwise…" while the stones travel and
   then "Each pit receives one stone…" as they land; the end page reads "The game ends when all
   six pits on one side are empty" and then "Any remaining stones on the other side…". The
   trailing ellipsis is the reference's own signal that it continues. Hence `PAGES[].parts`, and
   why `.mc-ht-caption` has a `min-height` — the card must not resize mid-story.
2. **The illustration panel is turn-coloured**, salmon while vermilion acts and blue while blue
   does. Our own board already does exactly this (`.mancala[data-turn]`), so the sheet is showing
   a real property of the game rather than decoration.
3. **The board is VERTICAL, in the reference and here — they match.** The illustration draws our
   own board: blue (you) down the LEFT column with your mancala as the bar across the BOTTOM,
   vermilion up the RIGHT column with theirs across the TOP, so `i + 1 mod 14` traces one real
   counterclockwise loop. Counts print outside each pit, the side the real board puts them on.

   **This was shipped WRONG once, and the reason is worth keeping.** The first cut drew a
   HORIZONTAL board — pits in two rows, stores left and right — and wrote a comment justifying it
   as a deliberate deviation from the reference. It was neither deliberate nor a deviation: it was
   inferred rather than looked at, **and the docs genuinely misled**. Both halves are true and the
   second one is the fixable half, so be exact about it:

   - `mancala.css` carried a comment reading *"landscape / desktop: classic horizontal board"*
     with nothing at the point of reading to say it applied only above 720px — a width the hub
     (`.hub-main`, `max-width: 720px`) barely reaches. Accurate in its own scope, and misleading
     to anyone who found it while looking for the board's shape. That is why the block was deleted
     rather than left with a warning comment: a doc that has to be read carefully to avoid being
     wrong-footed is still wrong-footing people.
   - This file's MP section says "always rendered bottom / top", which is CORRECT for the vertical
     board (your store IS the bar across the bottom) but is written about SEATS, not geometry, and
     reads as "two rows" to anyone scanning for layout.
   - `game.js` says nothing about geometry at all, which is right — the engine has no opinion.

   An intermediate version of this note claimed "nothing was misleading." That was an
   over-correction from an earlier version that blamed the docs entirely, and it was wrong: being
   accurate and being misleading are different properties, and this game's docs managed the first
   without the second. Opening the board would still have caught it in ten seconds, which is why
   VISUAL-PROCESS.md's first rule is a rule.

   Matt: *"our actual game is vertical. Why would the how to be horizontal??? That doesn't make
   any sense."*
   The layout is now measured off the running board (`[data-pit]` rects: 0-5 at x≈108 descending,
   6 as a bar at the bottom, 7-12 at x≈285 ascending, 13 as a bar at the top), which is the only
   way it should ever have been established. VISUAL-PROCESS.md's first rule, missed inside the
   very feature built to honour it.

**Built on demand and torn down on close**, matching this game's existing overlay idiom: Mancala
rewrites its whole root on every render, so a persistently-mounted sheet would be destroyed
underneath itself. `closeOverlays()` destroys the controller as well as removing the node — the
timelines own real timers and removing the node alone would leave them ticking against a detached
board.

**One bug worth keeping written down:** the first `sow()` computed a landed pit's new count as
`4 + drops`, which is right on a fresh board and wrong on every page that arranges the board
differently — the capture page starts a pit empty and rendered `5` where it should have said `1`.
It keeps a real `counts[]` model now. Derived-from-assumption arithmetic is the trap in any
animation that reuses one routine across differently-arranged setups.

`test-visual.mjs`'s `MOTION` probe watches `.mc-ht-stone` travel (250px over ~6s). The sow IS the
rule this sheet teaches, and a still diagram of it is precisely what the old sheet already had.

i18n from the first line: all captions are `ht_*` keys in `strings.js`, both languages, verified
in the browser (`Cada jugador tiene seis hoyos y una mancala…`).

### The static sheet this replaced (kept for the reasoning)

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
- **One room hosts a rematch SERIES, same vocabulary as Tic Tac Toe (2026-07-27, corrected — an
  earlier version of this file claimed "no rematch series" and "nothing to alternate," which was
  wrong: which SIDE you sit on and who MOVES FIRST are separate things).** `round.n` is the game
  number; `round.dealer` is the seat that opens that game, alternated by the HOST every game via
  `mp.nextDealer` (`_mpStartNextGame()`, the same pattern as solo's `nextStarter`/`startGame()` —
  Matt's rule that every turn-based game alternates who opens). **Sides themselves never swap** —
  host stays P1/bottom, guest stays P2/top for the whole room, exactly as before; only which seat
  the FIRST move belongs to varies game to game. `mp.series` (`{wins:[p1,p2], draws}`, seat-indexed
  since sides are fixed) tracks the running tally across the series and is shown on the game-over
  card (`_seriesLine()`); `mp.lastScoredGame` is the idempotence guard for `_mpAfterGameEnd()`
  (finish() can run more than once for the same game — an overlay re-render, a restore).
  `mp.nextDealer` and `mp.series` both ride the MP snapshot/save
  (`_mpSnapshot()`/`_mpSaveSnapshot()`/`_tryRestoreMP()`), so a host that restores mid-series keeps
  alternating instead of resetting to "host always opens," and a restoring device's series survives
  intact (same "carried through untouched" rule as Tic Tac Toe's restore — a wipe here would be the
  `initMatch`-zeroing failure shape from `js/CLAUDE.md`'s invariant 5, translated to this game's
  vocabulary). The MP game-over overlay's Host sees "Play Again" (`mp-next-game`, calls
  `_mpStartNextGame()`); the Guest sees a waiting message and Leave, same split as Tic Tac Toe's
  `isHost` branch. `writeResult` is deliberately unused, so `status:'ended'` still means "somebody
  abandoned the room" (unchanged).
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
  vocabulary in `test-mp-lockstep.mjs`'s M1-M6 block. **Invariant 3 (a per-round consumption
  queue) is now ported DIRECTLY, not by analogy** (corrected 2026-07-27 alongside the rematch
  series fix above — the earlier "no literal analogue, Mancala hosts exactly one game per room"
  reasoning no longer holds now that it doesn't): M4 mirrors Tic Tac Toe's T5, asserting game 2
  starts from a cleared move log, the dealer alternated, and every log entry is stamped with its
  own game number. Invariant 5 (round-boundary resume keeps scores) is ported by analogy in M6:
  restoring an already-finished game must not re-run or re-initialize it, and the series tally
  carried through the restore must match what it was before (the equivalent of Chinchón's
  score-zeroing `initMatch` wipe, translated to this game's vocabulary).
- **New file**: `mancala/js/hash.js`, FNV-1a over `{ pits, turn, over, winner }` — `pits` stays
  positional (never sorted), same reasoning as Tic Tac Toe's board array.

### Bug: solo results stopped recording after the first game of a session (fixed 2026-07-30)

Found by an audit of every game with a `_statsCommitted`-style idempotence guard, triggered by
the identical bug in Dots and Boxes (see `dots-boxes/CLAUDE.md`). Solo `startGame(mode)` never
reset `this._statsCommitted` back to `false` — only `_mpApplyRoundRecord` (the MP rematch path)
did. So every game after the first one played in a session (Play again, Restart, and New game all
call this same `startGame()` on the same instance, never a fresh one) silently recorded nothing at
all, win, loss or tie — `finish()`'s `if (!this._statsCommitted)` guard just skipped the write.
Fixed by adding the same reset `startGame()`'s MP counterpart already had. `test-mancala-stats.mjs`
(repo root) is the regression tripwire: plays three consecutive solo games in one mounted session
via the real (pure) engine and asserts the stats store's `played` count increments after every one
— confirmed red against the pre-fix code (stuck at `played=1`), green with the fix.

**Status line (2026-07-27, web-session pass): protocol proven headlessly against `FakeRoom`, all
six M-series probes green (`test-mp-lockstep.mjs`); real-room behaviour is unverified.** Real
devices are required for `HANDOFF-MP-LOCAL-MACHINE.md`'s Category B pass — this environment
cannot reach Firebase at all (see that doc's "why these four categories can't move to the
cloud"). Nothing here has been played on a real phone yet.
