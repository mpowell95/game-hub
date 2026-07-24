# Tic Tac Toe (`tic-tac-toe/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Two variants, one segmented control in setup: **Classic** (3x3) and **Ultimate** (nine 3x3 boards nested in a 3x3 meta-board; the cell you play picks which board your opponent plays next, a resolved target board grants a free move, and a small board that fills with no winner is DEAD — counts for neither side, never playable again). Pure engine (`tic-tac-toe/js/game.js`) + `ai.js`, no DOM, same synchronous shape as Filler/Mancala (no async agent interface — a move has no multi-step resolution to pace). Three shared-vocabulary tiers (beginner/intermediate/pro) per variant: Classic Pro is **exhaustive minimax, unbeatable by design** (a perfect opponent can only draw it — intentional, not a bug); Ultimate Pro is iterative-deepening alpha-beta under a ~380ms budget (Mancala's Pro tier is the precedent for that number), with a 4-term eval (positional small-board ownership, meta-line potential, in-board two-in-a-row, and a heavily-weighted "send penalty" for handing the opponent a good board or a free move — the term that makes it play like Ultimate instead of nine unrelated games). Setup screen is Escoba's accordion pattern. Settings in `gamehub.tictactoe.v1`. Results via `recordTicTacToe(variant, difficulty, won)`: maintains the shared `total`/`byDiff` bucket (draws derived, like every other game) AND an explicit per-variant `tt.classic`/`tt.ultimate` `{played,won,lost,tied}` breakdown — `tied` is stored explicitly there (not derived) because this game is draw-heavy, especially Classic vs Pro; the Stats tab shows all six W/L/T numbers, never folded away.

The How-to-play screen pattern in the root CLAUDE.md was worked out on this game;
`openHelp()` in `js/ui.js` is its reference implementation.

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
