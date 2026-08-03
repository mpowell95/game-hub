# Connect Four (`connect-four/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Medium was unbeatable until 2026-08-03 (difficulty ladder retune)

Medium searched alpha-beta at depth 5 and always played the best move it found, so it was not a
middle rung at all. The hub's own recorded history is unambiguous: across every player, Connect
Four was **85-14 on Easy (86%) and 3-107 on Medium (2.7%)**, with Hard at 3 plays and Expert at 12
because effectively nobody got past Medium to reach them. Reproduced headlessly before changing
anything: the shipped Medium beat the Easy agent 100 games out of 100.

The fix is deliberately **not** just a shallower search - a perfect depth-3 player is still a
perfect player. It is the same shape Easy already used (`EASY_BLOCK_RATE`), applied one tier up:
`MEDIUM_DEPTH` 5 -> 3, plus `MEDIUM_DEPTH_SLIP_RATE` (0.8), the rate at which Medium plays a
merely-safe move instead of its best one. Medium stays tactically honest at every slip - it always
takes an immediate win, always blocks an immediate loss, and a slip is filtered so it never hands
over a win on the spot (`handsOpponentAWin`) - because a tier that overlooks a three-in-a-row reads
as broken rather than fair. `test.js`'s `medium takes immediate win` / `medium blocks immediate
threat` cases pin exactly those two invariants and still pass.

Both knobs are constructor options (`mediumSlipRate`, `mediumDepth`, mirroring `expertBudgetMs`)
so a bench can sweep them without editing the file; that sweep, against a stand-in calibrated to
the hub's real players, is how 0.8/depth-3 was chosen and the full grid is tabulated in `ai.js`
above the constant. Measured result: the stand-in goes from 0% to 31% against Medium, Easy is
untouched at ~77%, and Medium still takes 99% off a purely random opponent, so it is weaker
without being degenerate. **If this needs tuning again, re-run the sweep - do not guess a number**,
and re-measure Easy at the same time so the rungs stay ordered.

## Notes

AI in a Web Worker (`new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`) with a main-thread fallback; needs the worker for its multi-second Expert solver. `ui.js`'s `_statsDisqualified` flag (2026-07-22): set by a confirmed undo or by confirming "Show best moves" (one shared flag, reset per game in `startGame()` - a rematch that starts with hints still on from before is pre-disqualified, silently, no re-prompt); `recordConnect4` is skipped entirely for a disqualified game and the result banner says so. The exact solver (`expertSolve`/`chooseExpert`, bitboard negamax + transposition table) has always been correct on its own (`test.js`'s "expert value matches reference" suite); what WAS a real bug (2026-07-22, batch 10) was `evaluateColumns`' "Estimate" fallback for the hint panel - it burned half its budget on a Pass 1 exact-solve attempt that's hopeless below `MIN_STONES_FOR_EXACT_ATTEMPT` (12 stones, measured empirically), starving the heuristic fallback of the depth it needed, so the empty board read as losing on every column. Fixed by skipping that doomed attempt early and replacing the fallback with a bitboard depth-limited negamax (`evaluateColumnsBounded`/`negamaxBounded`, reusing the exact solver's own move-ordering/win-detection primitives plus a bitboard port of the window-scoring heuristic) - reaches roughly 3-6x the depth in the same wall-clock time, so the empty board now reads center-highest and positive within the existing 3s hint budget. Also backs Expert's opening-fallback move choice (`chooseSearchTimed`), replacing a separate, weaker Board-object search there too. Still labeled "Estimate (depth N)", never "Solved", unless the value is actually exact. Discs also carry a shape token per THE LAW rule 9 (`.cf-piece.p1`/`.p2::after`, batch 10): P1 a ring, P2 a diamond, tonal (a darker shade of the disc's own color) rather than a second competing hue.

**`AI.test()`'s empty-board estimate check is now depth-bounded, not time-bounded (2026-07-27).**
It used to call `evaluateColumns` with a 10s wall-clock budget, which failed roughly 1 in 5 runs
on loaded hardware — not because the AI was wrong, but because the heuristic eval genuinely
oscillates sign by ply parity this early in the game (the empty board's center score came back
negative at even plies, positive at odd ones), so a wall-clock-bounded search lands on either
side of that oscillation depending on how many plies finish in the time given. Raising the
budget doesn't fix a parity problem. Fixed by giving `evaluateColumnsBounded` an optional
`maxPlies` cap (exposed via `_internals`) so the test can search to a FIXED ply count —
`HARD_DEPTH` (9, the same depth Hard already searches to, not a new number) — instead of a time
budget: deterministic, lands on the positive side of the oscillation, and fast (well under a
second). Verified with `node connect-four/js/test.js` 10x in a row, all green.

i18n: `connect-four/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Difficulty
values (`easy`/`medium`/`hard`/`expert`, `ai.js`'s `Difficulty` enum) stay canonical; only display
labels translate. The hidden-challenge strings in `syncChallengeUi()` are translated too even
though unreachable (`challengeActive` is hardcoded `false`), for consistency if it's ever revived.

### Autosave/resume: `gamehub.connect4.save.v1` (2026-07-23, batch 9)

Silent autosave/resume, following the Escoba/Mancala pattern (`saveC4Game`/`loadC4Game`/
`clearC4Game` in `ui.js`, near `loadC4Settings`). Snapshots `{ history, firstPlayer, difficulty,
showBestMoves, statsDisqualified, humanHasMoved }` after every settled move, every undo, and every
hint-toggle flip; restores straight into the live game screen on mount (no setup screen, no
"resume?" dialog) via `resumeGame()`. If the save was interrupted mid AI-think, resume hands the
turn back to the AI immediately. A hint-assisted or undone game carries `_statsDisqualified`
through the resume unchanged, so it still records no W/L when it ends. Cleared on game end
(`endGame()`) and on menu "Quit to setup" (an explicit abandon); never cleared on hub navigation
or `destroy()` (`destroy()` instead does one last checkpoint save, since a move's `game.play()`
commits before its drop animation resolves). A corrupt or foreign save (bad shape, illegal replay,
already-over) is treated as "no save," never crashes the mount. `isInProgress()` now always
returns `false` for this reason (see its own comment) — the hub's "leave game?" confirm no longer
applies. Does not touch `SETTINGS_KEY` (who-goes-first stays a separate, persistent choice).

### How-to-play sheet (2026-07-24, batch D/FB3-HOWTO3)

Connect Four had no how-to-play entry point at all before this. Added the standard
repo-wide sheet (root CLAUDE.md pattern): goal line, one diagram, a caption, one bullet.
Reachable from the setup screen (`data-role="help-open"`, a `.cf-btn-ghost` under Start)
**and** the in-game menu (`data-role="menu-help"`, alongside Undo/Restart/Quit), for
parity with Tic Tac Toe. The overlay (`data-role="help-panel"`) mirrors the existing
`.cf-menu`/`.cf-menu-card` scrim+dialog shell used by the game menu and stats-confirm
panels, but with its own `data-role` so it never collides with either — `openHelp()`/
`closeHelp()`/`helpDiagram()` in `ui.js`, `.cf-help`/`.cf-x`/`.cf-diagram`/`.cf-dg-*` in
`connect-four.css`. Diagram: a 4-wide mini board showing a DIAGONAL four-in-a-row (the
non-obvious direction — rows/columns are self-evident) with the completing disc falling
down the last column (arrow) onto a dashed-outline target cell, plus a solid connecting
line through all four positions. Shape/outline/arrow carry the meaning, never color
alone. Says nothing about the Best Moves panel (its own captions already explain it).
Strings: `howto`/`help_lead`/`help_diagram_aria`/`help_caption`/`help_rule` in
`strings.js`.

### Settings: `gamehub.connect4.v1` (2026-07-23, batch 8)

Connect Four persisted nothing before this. New standard `gamehub.<game>.v1` key holding only
`{ firstMode: 'you'|'ai'|'alternate', nextStarter: 'you'|'ai' }` — who goes first. Devices with
no saved key default to `alternate` (Matt: "every turn based game... should alternate who goes
first by default"); any explicit saved `you`/`ai` choice from before this change (or chosen since)
always wins over that default. Under Alternate, `nextStarter` flips on every `startGame()` call
(new game, rematch, and menu Restart all call it) and is persisted immediately, mirroring
`mancala/js/ui.js`'s `startGame()` alternation pattern. No separate announcement UI was added —
the existing status line (`updateStatus()`, "Your move" / "{opp}'s move" / "{opp} is thinking…")
already communicates who opened, right after `startGame()` runs.

Difficulty labels: Easy/Medium/Hard/Expert (2026-07-24, batch A of the second feedback arc —
Matt's reversal of batch 8's Beginner/Intermediate/Pro/Expert rename); stored `Difficulty` enum
values (`easy`/`medium`/`hard`/`expert`) are unchanged, label-only. The difficulty and who-first
segmented buttons render a COLORED ski-slope shape (`diffShapeSVG`/`tierOf`, imported from
`js/difficulty-tiers.js` — the shape now carries an inline `fill` per tier, green/blue/black) before
the difficulty label, ~1em, via `.cf-root .lb-dshape` sizing rules in `connect-four.css`.
**Overflow fix (2026-07-24, corrected 2026-07-25):** the 2026-07-24 fix (`min-width:0` +
`white-space:nowrap` + an ellipsis fallback + a `max-width:400px` font step-down to 0.8rem) was
wrong: it papered over clipping with an ellipsis instead of preventing it, and the 400px
breakpoint excluded real devices — an iPhone 16 Pro's 402px viewport sits just above it, so
FB4 QA found "Ordenador"/"Difícil" still clipping to things like "M…" at that exact width, worse
in Spanish. Fixed 2026-07-25: `.cf-seg` no longer truncates at all (`overflow:hidden` /
`text-overflow:ellipsis` removed — a short setting word getting an ellipsis is data loss, not
overflow control). It's now `display:inline-flex; align-items:center; justify-content:center`
at every width. The narrow-phone media query moved from `max-width:400px` to `max-width:480px`
(covers the full 375-430px realistic phone range in one query) and, in addition to the existing
font step-down (now 0.68rem, `padding:8px 2px`), switches `.cf-seg` to `flex-direction:column`
so the difficulty row's `diffShapeSVG` icon stacks ABOVE its label instead of forcing icon+text
onto one line — same technique as `nuts-bolts/css/nuts-bolts.css`'s `.nb-segbtn-label` rule for
its own 4-track difficulty picker. `white-space` also switches to `normal` at that breakpoint as
a safety net (a label that still doesn't fit wraps to a second line rather than clipping or
overlapping its neighbor); the who-first row has no icon so this just centers its (short) text.
Verified with a real browser at 375/402/430px logical width, both languages, both rows (`.cf-seg`
`scrollWidth` vs `clientWidth` and each `.cf-segmented` row's own overflow, not just eyeballing
it): zero overflow anywhere, including "Experto" + its ski-slope icon and "Ordenador" (the longest
label in either language on either row).

### Hint panel: per-column exact/estimate mix (2026-07-23, batch 2 of the 2026-07-23 feedback arc)

`evaluateColumns` (`ai.js`) no longer gates the exact solver on a stone-count threshold. It runs
**two passes every call**, each on its own time slice so neither starves the other:
- **Pass 1** attempts an exact solve (`expertSolve`) for as many legal columns as fit in
  `exactBudgetMs` (default `DEFAULT_EXACT_ATTEMPT_BUDGET_MS` = 2500ms, worker path; the main-thread
  fallback in `ui.js` passes `INLINE_EXACT_ATTEMPT_MS` = 300ms instead, since that path blocks the
  UI thread). Columns proven before the deadline keep their exact value even if later columns
  time out — a proven result doesn't get discarded just because the position as a whole couldn't
  be fully solved this turn.
- **Pass 2** runs the bitboard depth-limited estimate (`evaluateColumnsBounded`) on whatever
  columns Pass 1 didn't prove, on its own full `budgetMs` (unaffected by however long Pass 1 took).
- Each returned `{ col, score, exact }` carries its own `exact` flag; the array-level `.exact` is
  true only when every column got proven. A turn can be fully solved, fully estimated, or a mix —
  `ui.js`'s `renderEvalRow` never labels a mixed row "Solved".
- The exact solver's transposition table (`transTable`, module scope in `ai.js`) is **persistent
  across the whole game** — every turn's Pass 1 attempt builds on the last, so the "when do numbers
  first appear" boundary shrinks as the game goes on instead of staying fixed at a hardcoded stone
  count. `worker.js`'s new `'newgame'` message (`clearTranspositionTable()`, called from
  `ui.js`'s `startGame()`) resets it for a fresh game/rematch.
- Measured cold (TT cleared before each solve — the worst case; a real session only gets faster
  than this): a single column's exact solve took 5.5-12.6s at 8 stones, 0.27-2.8s at 10 stones, and
  exceeded 25s at 6 stones. So most early turns still prove nothing within the budget, same
  practical effect as the old 12-stone gate — but the wasted attempts are not actually wasted,
  because the TT persists.
- `renderEvalRow` picks the single recommended column ("best") by: a proven win (exact, score > 0)
  always wins if one exists; else, if every column is exact this turn, compare exact scores
  directly; else, rank only the estimate columns (exact non-win scores use the Pons scale, which
  isn't comparable to the estimate's `evalBitboard`/`WIN_BASE` scale, so they're shown but not
  ranked against estimates).
- Caption copy (`strings.js`) is now honest about what it's showing: `eval_solved` (all columns
  proven) says "vs perfect play"; `eval_estimate` (any column unproven) says "Not solved yet · ★ =
  engine's guess" — no depth number, since depth isn't meaningful once some columns are exact. A
  new `eval_fallible` line ("The computer at this level can still make mistakes.") renders under
  the caption whenever every column's score is negative AND the difficulty is below Expert, so a
  losing-everywhere estimate (which the heuristic can still show near the opening — this is
  inherent depth-parity oscillation in the eval function, not a bug; see the AI.test() case 5
  comment in `ai.js`) doesn't read as hopeless against an AI that isn't actually perfect at that
  difficulty.
