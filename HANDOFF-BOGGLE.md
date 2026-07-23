# HANDOFF — Boggle

**Target executor:** Sonnet, **high** effort. See "Why high" at the bottom.
**Scope:** one new in-hub module game, `boggle/`, timed word search vs AI.
**Estimated size:** ~1,500 LOC across 7 files, **plus a ~1.6MB word-list asset**.
Layout risk: none (4×4 grid). The dictionary is the novel part — see section 5.

Read `CLAUDE.md` first, in full — THE LAW, the module contract, the "Adding a game" checklist.

**Use `tic-tac-toe/` as your structural template** (shipped 2026-07-21, newest and cleanest).
`dots-boxes/` was in progress when this was written; if it has landed, prefer it as the
template since it is newer still.

### The one idea that makes this game cheap

**Boggle needs no game-playing AI.** Solve the board exhaustively against the dictionary and
you get, from one algorithm: the scoring word list, the end-of-round reveal, *and* the
opponent (a difficulty-scaled subset of what the solver found). Do not write a search-based
AI. The solver is the AI.

---

## 0. Naming — settled, do not deviate

| Thing | Value | Precedent |
|---|---|---|
| Folder | `boggle/` | single word, no dashes needed |
| Hub registry `id` | `'boggle'` | — |
| Stats game key | `'boggle'` | same here (no dashes to drop) |
| Display title | `Boggle` | the repo already ships trademarked display names by settled decision (see CLAUDE.md's Monopoly Deal section). Do not re-litigate. |
| CSS prefix | `bg` → `.bg-root`, `.bg-*`, `--bg-*` | verified free |
| Settings key | `gamehub.boggle.v1` | gen-3 convention |
| Accent color | `#1f3864` | navy; verified distinct from all 11 in use |

---

## 1. Files to create

```
boggle/index.html            standalone page
boggle/css/boggle.css        all rules descendant-scoped under .bg-root
boggle/js/game.js            pure engine: board generation, adjacency, scoring
boggle/js/dict.js            word-list loader + trie + prefix pruning
boggle/js/solver.js          exhaustive board solve (this is also the AI's source)
boggle/js/ai.js              difficulty-scaled selection from solver output
boggle/js/ui.js              DOM + hub module contract
boggle/js/test.js            headless node assertions
boggle/data/words.txt        the dictionary (see section 5)
boggle/data/CREDITS.md       license attribution
```

Keep `game.js`, `dict.js`, `solver.js`, `ai.js` DOM-free and pure.

---

## 2. Patterns to copy — per axis

Settings **key** (a localStorage name, invisible) and settings **screen** (the setup UI) are
separate axes with different best examples. Do not infer one from the other.

| Axis | Copy from | Notes |
|---|---|---|
| **Setup screen** | **Escoba** `escoba/js/ui.js:294-330` | the accordion. Matt's stated preference. Filler's flat screen is an acceptable fallback. **Do not copy Mancala's or Connect Four's** — explicitly rejected. |
| **How to play** | **Tic Tac Toe** `tic-tac-toe/js/ui.js:366-420` | and section 8 of this document, which is now the repo convention |
| CSS scoping | **Mancala** `mancala/css/mancala.css` | 0 unscoped rules. `.bg-root .bg-x`, never bare `.bg-x`. **CSS only — not its screen.** |
| Settings key | **Filler / Tic Tac Toe** | `gamehub.boggle.v1` |
| Stylesheet injection | **Filler** `filler/js/ui.js:44-55` | `ensureStylesheet()` via `new URL(...)` |
| Everything structural | **Tic Tac Toe** | newest, same contract |

---

## 3. Rules

- 4×4 grid of letter tiles, shaken from a fixed set of 16 dice (section 4).
- Find words by connecting **adjacent** tiles, including **diagonally**.
- **A tile may not be reused within a single word.**
- Minimum word length 3.
- `Qu` is one tile that counts as two letters.

**Scoring** (standard):

| Length | Points |
|---|---|
| 3-4 | 1 |
| 5 | 2 |
| 6 | 3 |
| 7 | 5 |
| 8+ | 11 |

### Round structure

One timed round on a shared board. The human finds words against the clock. When time
expires, the solver reveals everything on the board, and the AI's score is computed from its
difficulty-scaled subset. Higher score wins.

**No duplicate cancellation.** Real Boggle cancels words both players found; against a solver
that would gut the human's score every round. You score what you found, the AI scores what it
found, highest total wins. Say so on the how-to-play screen.

### Settings

- **Timer:** 2 / 3 / 5 minutes. Default 3.
- **Difficulty:** beginner / intermediate / pro (section 6).

Both persist in `gamehub.boggle.v1`. Difficulty is the stats tier because `profile.skill`
maps 1:1 onto those three labels and `DIFF_META` expects them. The timer is not a tier.

---

## 4. Board generation — use the real dice

**Do not generate random letters.** Random boards are frequently unplayable. Classic Boggle
uses 16 specific dice, tuned over decades. Use them verbatim:

```
AAEEGN  ABBJOO  ACHOPS  AFFKPS
AOOTTW  CIMOTU  DEILRX  DELRVY
DISTTY  EEGHNW  EEINSU  EHRTVW
EIOSST  ELRTTY  HIMNQu  HLNNRZ
```

Shuffle the 16 dice into the 16 positions, then pick a random face from each. The `Qu` face
on `HIMNQu` is a single tile displaying "Qu".

Adjacency is 8-way. A path may not revisit a tile.

---

## 5. Dictionary (`dict.js` + `data/words.txt`) — the novel part

### Source

Use **ENABLE** (Enhanced North American Benchmark Lexicon), ~172,000 words. It is **public
domain**, which is why it and not TWL or Collins/SOWPODS — those are copyrighted by
Merriam-Webster/NASPA and Collins respectively and must not be shipped.

Prepare it as: uppercase, one word per line, filtered to length 3-16, sorted. Write
`boggle/data/CREDITS.md` naming the source and its public-domain status. The card decks
(`chinchon/decks/*/CREDITS.md`) are the precedent for asset attribution in this repo.

### Loading

- Fetch once, lazily, on first game start. Cache the parsed structure in module scope so
  hub navigation does not rebuild it.
- Show a brief loading state. It is fast but not instant.
- The file is ~1.6MB raw; GitHub Pages gzips text automatically, so the transfer is roughly
  450-500KB, and the service worker precaches it after first visit. This repo already ships
  ~1.5MB of card images, so the budget is in line with precedent.

### Structure — measure before committing

Build a **trie of nested `Map`s**, once, lazily. You need prefix pruning or the DFS explodes.

**Do not build a `Set` of every prefix** — that is simpler but duplicates ~400k strings and
is too memory-hungry for a phone.

**Checkpoint:** measure trie build time and report it. Target under ~500ms on a mid-range
device. If it materially exceeds that, fall back to a trimmed list (drop words longer than
12 letters, which are effectively unfindable on 4×4) and re-measure. Say what you measured
in your final report — do not assert it is fine without a number.

### Two uses, one structure

- **Human input validation:** is this word in the dictionary, and not already found.
- **Solver pruning:** is this prefix a live path.

---

## 6. Solver (`solver.js`) and AI (`ai.js`)

### Solver

DFS from each of the 16 tiles, 8-way, no tile reuse, pruning the moment the accumulated
prefix leaves the trie. Record a word when the path is ≥3 letters and terminal in the trie.

Return each word **with its path**, since the end-of-round reveal should be able to trace
words on the board.

`Qu` advances the string by two characters in one step. This is the classic implementation
bug in Boggle solvers — get it wrong and every Q word is missed or malformed. Test it
explicitly.

Target: full 4×4 solve in well under 100ms with pruning.

### AI

The AI does not search. It samples from the solver's output.

| Tier | Behavior |
|---|---|
| **Beginner** | ~20% of found words, biased toward 3-4 letter words |
| **Intermediate** | ~45%, unbiased sample |
| **Pro** | ~70%, biased toward longer, higher-scoring words |

Sampling must be deterministic given a seed so `test.js` can assert tier ordering.

**Known limitation, document it in a comment:** ENABLE contains many obscure words a human
would never find, so at Pro the AI can score on words that feel unfair. The clean fix is a
second, smaller "common words" list that the AI draws from while the full list still
validates human finds. That is a future refinement, not this milestone — the length bias is
a reasonable proxy for now.

---

## 7. UI (`ui.js` + CSS)

### Input

**Tap letters in sequence.** Each tile is a real `<button>`; tapping appends it to the
current path. Tapping the last-selected tile again removes it. A submit control (or tapping
a "check" button) commits the word.

Tap-sequence beats drag-tracing here: it works with real buttons, so it is focusable and
screen-reader addressable, and it does not fight the browser's touch handling. Draw the
selected path as a connecting overlay line so it still reads like tracing.

Only tiles adjacent to the current path end should be selectable. Disable the rest so an
illegal path cannot be built at all.

### Screen

- The 4×4 grid, large tap targets (tiles are naturally big — no risk here).
- Countdown timer, prominent.
- Running score and the list of words found so far.
- End of round: your words vs the AI's, scores, and the full solve available to browse.
  Seeing every word you missed is the most satisfying part of Boggle — do not omit it.

### Accessibility and copy

- **Matt is red/green colorblind.** Selected-path state, valid-word feedback, and
  invalid-word feedback must never be color-only. Use outline weight, a glyph (✓ / ✗), and
  motion.
- Each tile button gets an aria-label with its letter and grid position.
- No em dashes in user-facing copy.
- Respect `prefers-reduced-motion` for the path animation.

### Win/lose popup

Per the repo convention (section 8), the end-of-round result popup **must have a close (X)
in the top-right corner** so it can be dismissed without forcing a rematch.

---

## 8. How to play — repo convention, follow exactly

This pattern was worked out on Tic Tac Toe's screen and is now the repo standard. It has
also been added to `CLAUDE.md`. Reference implementation: `tic-tac-toe/js/ui.js:366-420`.

**Skip anything the player already knows.** Explain only the genuinely non-obvious mechanic.
Most people know Boggle is "find words in a letter grid" — do not re-explain that.

**For Boggle the non-obvious mechanic is the adjacency path plus the no-reuse rule.**

Structure, top to bottom:

1. **One short bold sentence** stating the goal.
   → *"Find as many words as you can before time runs out."*
2. **A small SVG diagram** showing the confusing mechanic directly. Do not describe it in
   prose if you can show it.
   → A 4×4 grid with a word's path traced through adjacent tiles, **including at least one
   diagonal step**, drawn as a connected line with direction. Mark one already-used tile
   clearly as unavailable.
3. **A caption** under the diagram stating the rule in plain words.
   → *"Letters must touch, including corners. You cannot use the same tile twice in one word."*
4. **A concrete one-line example in "X = Y" format.**
   → *"Tiles touching corner to corner = still connected"*
5. **Remaining edge cases**, each its own plain sentence. No bullets unless there are 3+.
   → *"Qu is one tile that counts as two letters."*
   → *"Longer words score much more: three letters is 1 point, eight letters is 11."*
   → *"Words you both find still count for both of you."*

Rules for the whole screen:

- **Every line of text must fit on a single row.** Do not guess a font-size — measure the
  actual rendered width against the container's real available width, size down until it
  fits, then lock it with `white-space: nowrap`.
- **Spacing must be explicit**, not left to collapse between unrelated rules. One flex
  container with a fixed `gap`, or hard-coded margins.
- **The diagram must carry meaning through shape, outline, and arrows — not color alone.**

---

## 9. Integration — seven touchpoints, all silent on failure

Tic Tac Toe and Dots and Boxes both did all seven. Diff either commit for exact shapes.

### 9.1 `js/hub.js`

```js
{
  id: 'boggle',
  title: 'Boggle',
  blurb: 'Shake the grid, race the clock. Link touching letters into as many words as you can.',
  module: '../boggle/js/ui.js',
  accent: '#1f3864',
  art: `<svg viewBox="…" aria-hidden="true"> … </svg>`,   // see art note below
},
```

Do not set `immersive: true`.

**Ordering note:** array position is irrelevant. As of this writing the launcher sorts
alphabetically by `title`. A favorites feature (`HANDOFF-HUB-FAVORITES-TILES.md`) may land
first and change that to *favorites first, alphabetical within each group* — either way you
do not place the entry, so nothing changes for you.

### The art viewBox — check before you draw

The hub is mid-migration from square tiles to landscape ones. **Check which state the repo is
in first:**

```bash
grep -c '0 0 160 90' js/hub.js
```

| Result | What to supply |
|---|---|
| **0** — square tiles still live | `viewBox="0 0 120 120"`, matching the other games. It will be recomposed later along with everything else. |
| **> 0** — landscape has landed | `viewBox="0 0 160 90"`, composed to fill the frame, with a full-bleed `<rect width="160" height="90">` background. |

**If landscape has landed, do not crop square art to fit.** Composing for the frame is the
requirement; `preserveAspectRatio="slice"` was tried and rejected because it bisects shapes at
the frame edge.

**Boggle is one of the three games flagged as genuinely hard to compose wide** (with Parchís
and Tic Tac Toe), because a 4×4 letter grid is inherently square. Suggested approach: the 4×4
grid at full tile height, sitting left or centered, with loose letter tiles spilling into the
horizontal space — or a traced word path extending sideways out of the grid. Do not stretch
the grid to fill the width. **If neither reads well, stop and show it rather than shipping
something distorted.**

### 9.2 `js/game-stats.js`

Add `'boggle'` to the `GAMES` array (**line 74**).

Add `recordBoggle(difficulty, won, extras)`, modeled on `recordDotsBoxes` (**line 470**) —
the newest recorder and the closest match, since it also carries an explicit `tied` plus
`Math.max`-only bests. `recordTicTacToe` (line 447) is the same shape.
Sub-counter at `st.games.boggle.bg`:

```js
bg: {
  played: 0, won: 0, lost: 0, tied: 0,      // tied stored EXPLICITLY
  words: 0,                                  // cumulative words found (additive)
  bestScore: 0,                              // Math.max only
  longestWord: { word: '', len: 0 },         // replaced only when len increases
}
```

`extras` = `{ words, score, longestWord }`.

Write `ensureBg(g)` alongside `ensureCc`/`ensureEs`/`ensureNb`/`ensureTt`/`ensureDb` and
call it from the same place (**line 229**, next to `ensureDb(st.games.dotsboxes)`).

**Ties are first-class**, same as Tic Tac Toe and Dots and Boxes — scores can match. Pass
`won === null`; increment `played` and `tied` only. `total`/`byDiff` keep the shared
`{played, won, lost}` bucket — do **not** modify `bucket()` or `bumpTotals()`.

**`bestScore` and `longestWord` are bests: they only ever improve** (THE LAW rule 2). Never
overwrite `longestWord` with a shorter one, even on a winning round.

### 9.3 `js/game-stats-ui.js`

THE LAW rule 1 — stored is not enough, data must be VISIBLE.

```js
{ id: 'boggle', label: 'Boggle', accent: '#1f3864' },
```

Add `boggleScreen(rec)` and wire into the dispatcher (~line 222). Model on `escobaScreen`:
`recordScreen('boggle', rec)` plus tallies for **Won / Lost / Tied**, **Best score**,
**Words found**, and **Longest word** (show the actual word, it is the most personal stat
in the game).

### 9.4 `js/leaderboard-ui.js`

```js
{ id: 'boggle', label: 'Boggle', accent: '#1f3864' },
```

### 9.5 `js/players-agg.js` — no change

Boggle is competitive (real win/loss vs the AI's score). It must **not** go in `SOLO`.
Adding it to `GAMES` is sufficient. Verify `players-agg.test.mjs` still passes.

### 9.6 `sw.js` — ASSETS + CACHE bump

```js
'./boggle/',
'./boggle/index.html',
'./boggle/css/boggle.css',
'./boggle/js/ui.js',
'./boggle/js/game.js',
'./boggle/js/dict.js',
'./boggle/js/solver.js',
'./boggle/js/ai.js',
'./boggle/data/words.txt',
```

**`data/words.txt` must be precached** or the game is broken offline. It is the one asset
here that is not code, and it is easy to forget.

Do not add `test.js` or `CREDITS.md`.

**Bump `CACHE`** at `sw.js:9`: currently `'game-hub-v154'` → `'game-hub-v155'`. Verify the
current value first; Dots and Boxes may have bumped it again.

### 9.7 `run-all-tests.mjs`

Add `{ file: 'boggle/js/test.js' },` to `SUITES` (~line 19).

---

## 10. Module contract

```js
export function init(container) { }
export function destroy() { }
export function isInProgress() { }
export default { init, destroy, isInProgress };
```

- Module-level `let instance`; `init` replaces any prior.
- **`destroy()` must clear the round timer.** This game has a live countdown — a leaked
  interval keeps ticking after navigation. Leak-free teardown matters more here than in the
  previous two games.
- **`isInProgress()`:** **no mid-game resume.** Return `true` while a timed round is
  running. A round is 2-5 minutes and the timer cannot meaningfully pause across a hub
  navigation. Put that reasoning in a comment — CLAUDE.md requires it.
- Must run standalone from `boggle/index.html`. Copy `tic-tac-toe/index.html`.

---

## 11. Profile integration

`loadProfile()` from `js/profile-store.js`, read once at setup.

- Precedence: saved settings > profile > defaults.
- Never write it back.
- `profile.name`/`emoji` for the human; first `profile.opponents` entry for the AI's
  name/emoji and `skill` (1/2/3 → beginner/intermediate/pro).
- try/catch; a malformed profile must never crash the game.

---

## 12. Tests (`boggle/js/test.js`)

Headless node, no DOM, no dependencies. Node ≥22.7.

Load a small fixture word list, not the full 1.6MB file, so the suite stays fast.

**Board + scoring**
- All 16 dice are used exactly once per shake; every tile shows a face from its own die
- Scoring table is exact at lengths 3, 4, 5, 6, 7, 8, and 9
- Adjacency accepts all 8 directions and rejects non-adjacent steps
- A path reusing a tile is rejected

**Solver**
- On a hand-built board with a known small dictionary, the solver finds exactly the expected
  word set — no more, no less
- **`Qu` handling:** a board containing the Qu tile finds `QUIT` (or similar) and does not
  find `QIT`. This is the classic solver bug; assert it directly.
- Words shorter than 3 letters are never returned
- Every returned word's path is valid: adjacent, no reuse, spells the word

**AI**
- Beginner < Intermediate < Pro in expected score on the same board, over a seeded sample
- Every AI word is a real solver hit (the AI can never invent a word)

**Dictionary**
- Prefix pruning is correct: a prefix in the trie continues, one not in it stops

---

## 13. Acceptance checklist

- [ ] `node boggle/js/test.js` green, including the Qu assertion
- [ ] `node validate-sw-assets.mjs` green (confirms `data/words.txt` is listed)
- [ ] `node run-all-tests.mjs` green, all suites
- [ ] Standalone `http://localhost:8123/boggle/` works
- [ ] Hub card appears, alphabetically placed, art renders
- [ ] **Trie build time measured and reported with an actual number**
- [ ] Full board solve completes in <100ms
- [ ] Offline: load once, go offline, game still starts (proves `words.txt` is precached)
- [ ] Only tiles adjacent to the path end are selectable; illegal paths cannot be built
- [ ] Win a round. Confirm `games.boggle.total` and `bg.won`, `bg.words`, `bg.bestScore`,
      `bg.longestWord` all updated; both bests only rose
- [ ] Force a tied score. Confirm `bg.played` and `bg.tied` incremented, `won`/`lost` did not
- [ ] Play a round with a lower score than your best. Confirm `bestScore` did **not** drop
- [ ] My Stats shows Won / Lost / **Tied**, Best score, Words found, Longest word
- [ ] Leaderboard tab exists and ranks
- [ ] How-to-play screen follows section 8 exactly: bold goal line, SVG diagram with a
      diagonal step, caption, "X = Y" example, edge cases as plain sentences
- [ ] **Every how-to-play line fits on one row at 375px**, verified by measuring rendered
      width, not by guessing a font size
- [ ] End-of-round popup has a close (X) in the top-right
- [ ] hub → game → back mid-round: timer stops, no leaked interval, no console errors
- [ ] No em dashes in user-facing copy
- [ ] `sw.js` CACHE bumped
- [ ] CLAUDE.md updated (section 14)

---

## 14. CLAUDE.md

THE LAW rule 9: a milestone is not done until CLAUDE.md reflects it.

1. Add a **Boggle** row to the games table: in-hub `module:`, real Boggle dice, the
   solver-is-the-AI design, the ENABLE dictionary and its public-domain status, settings key
   `gamehub.boggle.v1`, results via `recordBoggle`.
2. Note the `bg` sub-counter shape in the `js/game-stats.js` description alongside
   `grid`/`cc`/`es`/`nb`/`tt`/`db` — including that `tied` is explicit and `bestScore` /
   `longestWord` are bests-only.
3. Note in the games table row that Boggle is the first game to ship a large **non-image
   data asset** (`data/words.txt`) that must be precached, since that is a new pattern other
   word games would follow.

The "Adding a game" template paragraph and the how-to-play convention are already correct.
Do not re-edit them, and do not add game creation dates to CLAUDE.md — considered and
rejected.

---

## 15. Out of scope

- Multiplayer. No `js/net.js` import.
- Pass-and-play, or two humans on one board.
- Mid-round save/resume.
- Board sizes other than 4×4 (no 5×5 Big Boggle).
- A second "common words" list for the AI (noted as a future refinement in section 6).
- Any change to Firebase, identity, or `database.rules.json`.
- Any rename of an existing folder or storage key (THE LAW rule 5).
- Restructuring any existing game's setup or how-to-play screen.

If you think one of these is necessary, stop and say so rather than building it.

---

## Why high effort

The engine and the seven integration edits are routine now. Three things argue for high:

1. **The dictionary is a genuinely new pattern for this repo.** No existing game ships a
   large non-image data asset. Getting it wrong is not a crash — it is a game that works in
   dev and silently breaks offline, or a trie that takes three seconds to build on a phone.
   The measurement checkpoint in section 5 exists because "it seemed fine" is not an answer.
2. **The `Qu` tile is a real trap.** Every naive Boggle solver mishandles it, and the bug is
   invisible unless tested for directly — the board still works, it just quietly never finds
   Q words.
3. **The how-to-play screen has an explicit measure-don't-guess requirement** (section 8).
   Sizing text by eye until it "looks right" is exactly what that convention exists to
   prevent, and it is the kind of instruction a lower tier tends to satisfy approximately.

At ~1,500 LOC the medium/high delta is small, and two of these three failure modes are
invisible in a dev environment.
