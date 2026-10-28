# Word Weaver — word-weaver/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

A Wordscapes-style crossword (Matt, 2026-10-28). Swipe across a wheel of 3-7 letters to spell the grid's
words. Spanish title **Tejepalabras**. The story and the decisions: `CLAUDE-HISTORY.md`. Mockup:
`docs/mockups/wordscapes.html` (sunset sky, white tiles, translucent slots, white wheel, yellow `#f2b705` path).

## Hub integration

| | |
|---|---|
| Folder / hub id / stats id | `word-weaver/` / `word-weaver` / `wordweaver` |
| Entry | module `../word-weaver/js/ui.js`, **immersive**, prefix `.ww-root` / `.ww-` |
| Admin only | `devOnly: true`, `added: '2026-10-28'`, no `released` (the New pill's only input; Matt releases it from the admin page) |
| Recorder | `recordWordWeaver(level, { hints, extra })` in `js/game-stats.js`; points in `js/word-weaver-points.js` (the stats side, not this folder) |
| Settings key | `gamehub.wordweaver.v1` `{ band }`; save `gamehub.wordweaver.save.v2` (`.save.v1` read once, `.best.v1` no longer read) |
| `isInProgress()` | always `false`: every accepted word and hint is saved, leaving is lossless |

## Rules

- **Four difficulties, bands of ONE ladder** (`js/word-weaver-points.js`: `WW_TIERS`, `WW_BAND_START`
  Easy 1 / Medium 501 / Hard 1001 / Expert 1501, `wwBandOf`, `wwBandEnd`), each **played in order. No replays, no
  levels screen.** A band's next level = its attempt in progress, else its lowest level not completed on this phone
  (the stats store's `ww.lv`, plus the pending queue). Past the data's last level: "More levels soon"; a band's
  last level done: "<Band> done" with a Back button.
- **The setup screen is where the game opens** (Matt, 2026-10-28): title, the player's POINTS (`wwPoints`, the
  leaderboard number; the done screen keeps stars), the four difficulties (`diffShapeSVG` + name; selected = `#ffce3a`
  outline + check), one Play button ("Play <n>"), How to play. **Nothing else** (root CLAUDE.md, "as few words as
  possible"). The pick is saved in `gamehub.wordweaver.v1`.
- **The play screen's back arrow** to the setup screen is TOP LEFT on the row UNDER the Hub button, 16px below it
  (Gridlock's rule, `docs/BUILDING-A-GAME.md` Part 0); the chips and level number stay on the Hub button's row.
  Next on the done screen continues in the same band.
- Swipe (pointer events, `touch-action: none`): lift submits; sliding back onto the previous letter un-selects
  it. Grid word: its letters fly from the pill into the grid. Found again: that word flashes. Extra word (the
  level's `x`): the star chip bumps and counts; found again: it wiggles. Anything else: the pill shakes. Under 3
  letters: silent. **No sound, ever.**
- **Hints are unlimited.** One tap reveals one letter: the first unrevealed cell (top to bottom, left to right)
  of the shortest unfound grid word (ties: earlier in `w`; cells a found word already shows are skipped). Each
  reveal is one hint. A word whose letters are all showing counts as found (no swipe needed, as in Wordscapes). **Stars: 0 hints 3, 1 hint 2, 2+ 1.** Leaderboard = points (stars x Easy 1 / Medium 2 / Hard 3 / Expert 4; the stats agent's side).
- Level done = every grid word found. The done screen keeps the grid and shows "Level N", three star SHAPES
  (filled vs outline, never colour alone), the extra-words count (tap: the list) and Next.
- Desktop keyboard: letters type into the pill (wheel letters only, counts respected), Backspace, Enter
  submits, Space shuffles.
- Layout never scrolls: wheel 184-250px (a letter's touch area stays over 44px), grid cells measured to fit above it
  (`_layout`, `ResizeObserver` + `onViewportResize`), only the box the words fill is drawn. The sky is the look
  in light and dark; the sheets follow `.gh-dark`. The extras list inside its sheet scrolls (unbounded content).

## Data (GENERATED, never hand-edited)

`data/index.json` `{ v:1, count, chunk:250 }` and `data/levels-<k>.json` `{ v:1, first, levels }` (level n is in
chunk `floor((n-1)/250)`), written by `tools/build-word-weaver-data.mjs`. Level = `{ l, g:[rows,cols], w:[[WORD,r,c,'a'|'d'],...], x:[extras] }`.
`engine.js` refuses a level that does not add up (words off the grid, grid over 9x9) instead of drawing it wrong.

## Save, and where "recorded" lives (THE LAW)

- `gamehub.wordweaver.save.v2` = `{ easy, medium, hard, expert: attempt | null, migrated: 1 }`; attempt =
  `{ v:1, n, found, extra, hints, revealed:["r,c"], recorded }`, written after every accepted word and hint. Read back
  through `cleanState` (unknown words dropped, never throws). An attempt whose level is already completed
  (`ww.lv` or pending) is not used; one that is not completed always resumes.
- **`gamehub.wordweaver.save.v1`** (the first build's single save) is read ONCE into the band its `n` falls in, with
  its words, extra words, hints, revealed cells and `recorded` as stored; the band is also picked on the setup
  screen if no choice was saved. It is never written or deleted afterwards (THE LAW rules 3 and 5).
  `gamehub.wordweaver.best.v1` is no longer read or written; it stays as stored (rule 5).
- **The recorder runs FIRST** when the last word is found (before any animation); `recorded` is set only after it
  returned (Spelling Bee's pattern). A refusal is queued in `gamehub.wordweaver.pending.v1` and retried on every
  open; an entry is removed only after the recorder took it. A done level reloaded with `recorded:false` is
  recorded on open.
- The test seam `window.__wwTest` (`ui`, `level`, `state`, `submit(word)`, `hint()`) exists on localhost only.

## Files

| File | Role |
|---|---|
| `js/engine.js` | pure: loading (`loadIndex`, `loadLevel`), `cellsOf`, `checkWord`, `applyWord`, `hintCell`, `starsFor`, `isDone`, `cleanState` |
| `js/ui.js` | the setup screen, the play and done screens, the wheel, the sheets, the saves and migration, the module contract |
| `js/strings.js` | EN/ES, every string and aria-label |
| `js/test.js` | `node word-weaver/js/test.js`, engine against an in-file fixture (not precached) |
| `css/word-weaver.css` | all styling |
| `index.html` | standalone page (name gate before `init`) |

## Tests

`node word-weaver/js/test.js`, `node tools/test-game-conventions.mjs`, `node tools/check-no-scroll.mjs word-weaver`
(setup, How to play, Expert play, level done; needs data in `data/`), `node tools/test-i18n-strings.mjs`.
