# HANDOFF-FB-SNAKE: scroll leak, wrap-around mode, bigger food, bigger play area

**Batch 5 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: medium-high.** Decisions made; execute,
verify, commit. Read `snake/CLAUDE.md` first (note: the survey found its D-pad section is
stale — code default is `compass` with six styles; trust the code, and fix the doc while
you're there, THE LAW rule 9).

## 1. Scroll leak during play (Matt: "I accidentally scrolled a bit while playing Snake")

Verified cause: the board wrap has `touch-action:none` (`snake/css/snake.css:96`) but the
D-pad does not — `.sn-pad` has no touch-action, its buttons use `touch-action:manipulation`
(`snake.css:183`), and the pad's `pointerdown` only preventDefaults when a `[data-dir]` button
is hit (`snake/js/ui.js:244-248`). A vertical drag starting on the pad backdrop, the 10px gaps
between buttons, or drifting off a held button can pan the page mid-run.

Fix: `touch-action: none` on the whole `.sn-pad` container (and keep the buttons'
`manipulation` or drop it — the container rule wins for gesture starts). While a run is live
(`this.game && !this.game.over && !paused`), also preventDefault non-passive `touchmove` on
the game screen root so nothing inside the immersive view scrolls; release it on game over /
destroy (leak-free per the module contract). Do not touch the setup screen's scrolling.

## 2. Wrap-around walls mode (Ana's request, via Matt: snake exits one wall, re-enters the opposite one, "like pac man")

- `snake/js/game.js:71-74` is the wall-death check. Add a `wrap` boolean to the Game config:
  when true, the head coordinate wraps modulo `COLS`/`ROWS` instead of setting `over`.
  Self-collision still kills. Keep the change inside the pure engine + its tests.
- Setup gains a **Walls** row: `Walls on` (classic, default) / `Walls off` (wrap). Persist as
  `walls: 'on'|'off'` in `gamehub.snake.v1` (additive field; existing saves without it read
  as 'on'). Strings EN+ES (e.g. es `Con paredes` / `Sin paredes`), no explanation prose.
- **Stats decision (THE LAW rule 5 — do not improvise a new difficulty id):** wrap games
  record under the SAME difficulty ids (`easy/medium/hard` speed tiers). Wrap is a rule
  variant, not a tier — same as how Escoba's rule toggles don't fork its stats. `recordSnake`
  and `sn` sub-counter are untouched; best-length comparisons stay one pool. If Matt later
  wants wrap ranked separately that is a product decision, not this batch.
- The draw loop needs no change beyond the head never being out of bounds; verify the eat/grow
  path and food spawning are coordinate-agnostic.

## 3. Bigger food + bigger play area (Ana: food is too small; lower the board's bottom edge — "There's plenty of space while keeping the dpad still fully visible")

Verified constants: the canvas reserves a fixed 280px below for pad+HUD
(`_sizeCanvas`, `snake/js/ui.js:252-267`: `availH = max(200, innerHeight - wrapTop - 280)`),
then `_centerGame` (`:290-297`) splits leftover space above/below, leaving dead space; food is
a hollow circle of radius `cell/2 - 2.5` with `lineWidth = max(2, floor(cell/5))`
(`ui.js:398-405`).

- **Food:** draw it filled (not hollow) at radius `cell/2 - 1.5`. Filled + larger reads at a
  glance; keep the existing food color (it already contrasts with the snake by shape+fill,
  which satisfies the colorblind rule — the snake is square cells, food is a round dot).
- **Play area:** measure the ACTUAL pad+HUD height at layout time (the pad element's
  `offsetHeight` + HUD + margins) instead of the fixed 280px, and stop pre-splitting leftover
  space above the board — give leftover rows to the board by letting `cell` be bound by width
  on phones but extending ROWS' pixel budget downward until the pad's real top edge, with a
  12-16px gap. The D-pad must remain fully visible and un-overlapped at 375x812 (mobile
  preset) and on a real iPhone. If `_centerGame`'s top-centering fights this, remove the
  bottom half of its split (top margin only).
- Do NOT change `COLS`/`ROWS` (15x17) — grid size changes the game and the best-length
  leaderboard semantics. This is a pixel-budget change only.

## Verification

1. `node run-all-tests.mjs` green; add engine test cases for wrap (all four walls, and
   self-collision still fatal with wrap on).
2. Browser at mobile preset (375x812): start a run, drag vertically starting on the pad
   backdrop and between buttons — page must not move; wrap mode exits right wall and enters
   left at the same row (and top/bottom same column); food visibly larger; board bottom sits
   just above the pad with no overlap. Preview quirk memory: screenshots of overlays can time
   out and motion is reduced — verify via computed styles/read_page where needed, and tell
   Matt what to confirm on a real phone (scroll lock and pad feel).
3. Stats: finish one wrap run and one classic run; `sn` counters and best length both advance
   in My Stats (rule 1: visible, not just stored).
4. EN+ES strings; `node test-i18n-strings.mjs` green.
5. `sw.js` CACHE bump as the LAST edit before commit. Update `snake/CLAUDE.md` (wrap mode,
   pad touch-action, the stale D-pad default) — rule 9.
