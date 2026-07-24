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

The difficulty picker's segmented buttons now show a ski-slope shape (`diffShapeSVG`/`tierOf`,
imported from `js/difficulty-tiers.js`, sized via `.db-root .lb-dshape`/`.lb-dshape-x2`) before
each Beginner/Intermediate/Pro label — the same shapes the leaderboard uses. The per-tier
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
leave-confirm no longer appears — leaving costs nothing.
