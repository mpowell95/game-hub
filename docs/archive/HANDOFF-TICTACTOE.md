# HANDOFF — Tic Tac Toe + Ultimate Tic Tac Toe

**Target executor:** Sonnet, **high** effort. See "Why high" at the bottom.
**Scope:** one new in-hub module game, `tic-tac-toe/`, with two variants (Classic 3×3 and
Ultimate 9×9-nested), fully integrated into hub, stats, and leaderboard.
**Estimated size:** ~1,750 LOC across ~5 files. Layout risk: none (nested CSS grid).

Read `CLAUDE.md` first, in full. It is the inherited context for this repo and it contains
THE LAW (player-data rules), the module contract, and the "Adding a game" checklist. This
document does not replace it; it specializes it for this game.

---

## 0. Naming — settled, do not deviate

These are not interchangeable. The repo has three different conventions and mixing them up
silently breaks things.

| Thing | Value | Precedent |
|---|---|---|
| Folder | `tic-tac-toe/` | `connect-four/`, `nuts-bolts/`, `ball-run/` (dashed) |
| Hub registry `id` | `'tic-tac-toe'` | `'connect-four'`, `'nuts-bolts'`, `'ball-run'` (dashed) |
| **Stats game key** | **`'tictactoe'`** | `'connect4'`, `'nutsbolts'`, `'ballrun'` (**no dashes**) |
| Display title | `Tic Tac Toe` | — |
| CSS prefix | `ttt` → `.ttt-root`, `.ttt-*`, `--ttt-*` | CLAUDE.md "Adding a game" #3 |
| Settings key | `gamehub.tictactoe.v1` | `gamehub.filler.v1` (gen-3 convention) |
| Accent color | `#0e7c86` | distinct from all nine existing accents |

**The dashed-vs-undashed split is the single easiest way to break this build.** The hub id
and the stats key are different strings. `recordResult`/`recordTicTacToe` will silently
`return null` on an unknown game id (see `js/game-stats.js`, `recordResult` guards with
`if (GAMES.indexOf(gameId) < 0) return null;`) — no error, no console warning, stats just
never accumulate. Verify by playing a game and re-reading `localStorage['gamehub.stats']`.

---

## 1. Files to create

```
tic-tac-toe/index.html            standalone page (must also be in sw.js ASSETS)
tic-tac-toe/css/tic-tac-toe.css   all rules scoped under .ttt-root
tic-tac-toe/js/game.js            pure engine, no DOM, both variants
tic-tac-toe/js/ai.js              pure AI, no DOM, both variants
tic-tac-toe/js/ui.js              DOM + hub module contract
tic-tac-toe/js/test.js            headless node assertions
```

Keep `game.js` and `ai.js` **DOM-free and pure**. That is the repo's deliberate seam
(CLAUDE.md, Chinchón "Key design decisions") and it is what makes `test.js` possible.

---

## 2. Patterns to copy — per axis, not per game

CLAUDE.md's "Adding a game — checklist" currently says:

> Copy Escoba's patterns, not Connect Four's or Filler's. Connect Four and Filler are the
> oldest games [...] Escoba is the reference for the setup-screen pattern, CSS scoping
> discipline, and the settings-key convention.

**That rule is wrong on two of its three claims. Do not follow it as written.** Filler is
not one of the old games, it uses the *current* settings-key convention, and Escoba is not
the CSS-scoping reference (CLAUDE.md itself names Mancala for that two paragraphs later).
Escoba earns exactly one of the three: the setup screen.

This has already been corrected in CLAUDE.md. The table below is the binding guidance.

### First: settings KEY and settings SCREEN are different axes

They are unrelated and their best examples are different games. Do not infer one from the
other.

- **Settings key** = the localStorage name a game saves under (`gamehub.filler.v1`). The
  player never sees it. Pure naming convention.
- **Settings screen** = the setup UI the player interacts with.

Citing a game for its storage key or its CSS scoping says **nothing** about whether its
screen is worth copying. Below, Mancala is cited for CSS only.

### Copy per axis

| Axis | Copy from | Why |
|---|---|---|
| **Setup screen** | **Escoba** `escoba/js/ui.js:294-330` | the accordion (`_setupExpanded`, `data-action="toggle-row"`, `eb-summary-row`). Matt's stated preference and the newest screen in the repo. **Filler's flat/segmented screen is an acceptable fallback** for a game this small. |
| CSS scoping | **Mancala** `mancala/css/mancala.css` | 0 unscoped rules — every rule descendant-scoped: `.ttt-root .ttt-cell`, never bare `.ttt-cell`. **Cited for CSS only. Do not copy Mancala's setup screen.** |
| Settings key | **Filler** `gamehub.filler.v1` | the gen-3 convention; use `gamehub.tictactoe.v1` |
| Stylesheet injection | **Filler** `filler/js/ui.js:44-55` | `ensureStylesheet()` via `new URL('../css/tic-tac-toe.css', import.meta.url)`; copy this one helper |
| Module contract | **any in-hub game** | all seven implement it identically |

### Setup screens — Matt's explicit ranking

Stated directly, 2026-07-21. This is a preference call, not a technical one, and it
overrides any inference from code quality:

| Screen | Verdict |
|---|---|
| **Escoba** | **best — the model** |
| Filler | fine, acceptable for a small game |
| Mancala | **do not copy** |
| Connect Four | **do not copy** |

Do not restructure any existing game's screen as part of this work. This ranking governs
Tic Tac Toe's new screen only.

Settings loading: try/catch, malformed data falls back to defaults silently.

---

## 3. Game design

### Classic (3×3)

Standard rules. Human is X and moves first by default; make first-move a setting since
going second is a meaningfully different game.

### Ultimate (nested 3×3 of 3×3)

- The board is nine small boards arranged 3×3.
- The cell you play *within* a small board dictates which small board your opponent must
  play in next.
- If the dictated small board is already won or completely full, the opponent may play in
  **any** playable board (this is the "free move").
- Winning a small board claims that cell on the meta-board. Win three small boards in a
  meta-line to win the match.
- A small board that fills with no winner is dead — it counts for neither player and can
  never be played in again.

**Meta-board draw rule — pick one and document it in a comment:** when every small board is
resolved and no meta-line exists, the match is a draw. (There are variants that score by
count of small boards won. Do not implement those. Draw is simpler and standard.)

### Variant selection

A segmented control on the setup screen: **Classic | Ultimate**. Persist the choice in
`gamehub.tictactoe.v1`. Both variants share difficulty tiers.

---

## 4. AI spec — the part that needs real care

Difficulty tiers must map onto the repo's existing labels so `DIFF_META` in
`js/game-stats-ui.js:40-44` renders them. Use **`beginner` / `intermediate` / `pro`**
(these normalize to Beginner/Intermediate/Pro). Do not invent new tier names.

### Classic AI

| Tier | Behavior |
|---|---|
| Beginner | Random legal move, but take an immediate win if one exists |
| Intermediate | Take a win; block an immediate loss; otherwise prefer center > corner > edge |
| Pro | Full minimax. The game is small enough to solve exhaustively with no depth limit |

**Pro Classic is unbeatable by construction — a perfect player can only be drawn.** That is
correct, not a bug. Do not weaken it to make it winnable, and do not let a future session
"fix" it. Add a comment saying so. This is exactly why Ultimate exists.

### Ultimate AI — the real work

Move generation: if the forced board is playable, legal moves are its empty cells;
otherwise legal moves are every empty cell in every playable board.

Search: minimax with alpha-beta and **iterative deepening under a time budget**. Mancala's
Pro tier is the precedent — `~380ms` budget (CLAUDE.md, Mancala row). Reuse that number.
No Web Worker; stay on the main thread. Connect Four's worker exists for a multi-second
solver and this is nowhere near that.

Evaluation function — all four terms matter:

1. **Small-board ownership**, weighted positionally on the meta-board. Center small board
   is worth most, corners next, edges least. Mirrors classic TTT positional value.
2. **Meta-line potential.** Two small boards won in a meta-line with the third still
   playable is a large bonus. Same for the opponent, negated.
3. **Within unwon small boards**, standard TTT heuristic: two-in-a-row with an open third.
   Weight this well below meta-board terms.
4. **Send penalty.** A move is penalized by the quality of the position it sends the
   opponent into — and penalized heavily if it sends them to a resolved board, because
   that grants a free move.

**Term 4 is the one that makes it play like Ultimate rather than nine unrelated games.** An
AI without it will locally optimize each small board and hand over free moves constantly.
If you cut a corner, do not cut this one.

Tiers:

| Tier | Behavior |
|---|---|
| Beginner | Random legal move; take a small-board win if immediately available |
| Intermediate | Fixed depth 2-3, eval terms 1-3 only (no send penalty) |
| Pro | Iterative deepening to the time budget, all four eval terms |

---

## 5. Integration — seven touchpoints, all required

Miss any of these and the failure is silent. There is no error message for most of them.

### 5.1 `js/hub.js` — GAMES registry

Add an entry. Required fields: `id`, `title`, `blurb`, `module`, `accent`, `art`.

```js
{
  id: 'tic-tac-toe',
  title: 'Tic Tac Toe',
  blurb: 'Classic 3x3, or Ultimate: nine boards in one, where your move picks your opponent\'s board.',
  module: '../tic-tac-toe/js/ui.js',
  accent: '#0e7c86',
  art: `<svg viewBox="0 0 120 120" aria-hidden="true"> ... </svg>`,
},
```

- **Array position is irrelevant** — the launcher sorts alphabetically by `title` at render
  time (`js/hub.js:293`). Do not try to place it.
- Do **not** set `immersive: true`. That is for full-bleed games (Escoba, Mancala, Ball Run).
  This game wants the standard hub header.
- The `art` SVG should be a 120×120 inline SVG matching the visual weight of the existing
  nine. A board grid with an X and an O reads instantly at tile size.
- **No em dashes in `blurb` or any user-facing copy.** CLAUDE.md, "Accessibility + copy
  conventions." Use commas, colons, or parentheses.

### 5.2 `js/game-stats.js` — GAMES array + recorder

Add `'tictactoe'` to the `GAMES` array (currently line 55).

Then add a bespoke recorder. **Model it on `recordConnect4`** (line ~307), which is the
exact precedent: it maintains `total`/`byDiff` like `recordResult` *and* a game-specific
sub-counter.

```js
/** Tic Tac Toe: record a finished game, split by VARIANT. Maintains total/byDiff (as
 *  recordResult) AND the per-variant breakdown. `variant` is 'classic' or 'ultimate';
 *  `difficulty` is beginner/intermediate/pro. `won` is true, false, or null for a draw
 *  (draws are very common here, especially Classic vs Pro). Additive; never overwrites. */
export function recordTicTacToe(variant, difficulty, won) { ... }
```

Sub-counter shape, stored at `st.games.tictactoe.tt`:

```js
tt: {
  classic:  { played: 0, won: 0, lost: 0, tied: 0 },
  ultimate: { played: 0, won: 0, lost: 0, tied: 0 },
}
```

Write an `ensureTt(g)` normalizer alongside the existing `ensureCc`/`ensureEs`/`ensureNb`
helpers, and call it from the same place they are called (around line 186).

### Ties are a first-class category — this is a hard requirement

**Tic Tac Toe is draw-heavy.** Classic vs Pro is a draw essentially every game (see section
4). A stats screen showing only wins and losses would tell a player they played 40 games and
accomplished nothing. Ties must be **stored explicitly and displayed as their own category:
Won / Lost / Tied.**

Two layers, deliberately different:

- **`total` / `byDiff`** keep the shared `{played, won, lost}` bucket shape. Do **not** add
  `tied` here and do **not** modify `bucket()` or `bumpTotals()` — those are shared by all
  nine existing games, and a draw is exactly derivable as `played - won - lost`. Changing
  the shared shape is out of scope and risks every other game.
- **`tt.classic` / `tt.ultimate`** store `tied` explicitly. Game-specific dimensions are
  exactly what these sub-counters are for (Connect Four's `grid`, Escoba's `es`). Explicit
  storage here means the stats screen never has to derive it, and a future reader cannot
  mistake a tie for an un-recorded game.

Pass `won === null` to signal a draw — that is the existing `recordResult` contract. Inside
`recordTicTacToe`, `won === null` must increment `played` and `tied`, and must **not** touch
`won` or `lost`.

Recording a draw as a loss is a correctness bug, not a rounding error. THE LAW's
additive-writes rule will not catch it, because an incorrect increment is still an
increment. The acceptance checklist has an explicit draw test for this reason.

### 5.3 `js/game-stats-ui.js` — TABS + a screen

**This is THE LAW rule 1. Stored is not enough; data must be VISIBLE.** If you add the stats
key but not the tab, the data accumulates invisibly, which to a player is identical to
deleting it.

Add to `TABS` (line ~15):

```js
{ id: 'tictactoe', label: 'Tic Tac Toe', accent: '#0e7c86' },
```

Then add a `ticTacToeScreen(rec)` function and wire it into the dispatcher (line ~222,
alongside `if (id === 'connect4') return connect4Screen(rec);`). Model it on
`escobaScreen` (line ~169): call the shared `recordScreen('tictactoe', rec)` and append
the variant split as tallies.

**The screen must show Won / Lost / Tied for each variant separately.** Not won/lost with
ties folded away, and not a combined total. Ties are the most common outcome in Classic vs
Pro, so a screen that hides them misrepresents the player's whole history — THE LAW rule 1
is about exactly this: data that no screen shows is deleted, as far as a player is
concerned. Six numbers minimum: Classic W/L/T and Ultimate W/L/T.

### 5.4 `js/leaderboard-ui.js` — TABS

Add to `TABS` (line ~17):

```js
{ id: 'tictactoe', label: 'Tic Tac Toe', accent: '#0e7c86' },
```

Same accent as the other two registries. `ACCENT` is derived from this array, so one entry
covers it.

### 5.5 `js/players-agg.js` — no change needed

`COMPETITIVE` is computed as `GAMES.filter(g => !SOLO.has(g))`. Tic Tac Toe is competitive
(it has a real win/loss axis vs an opponent), so it must **not** go in the `SOLO` set.
Adding it to `GAMES` in `game-stats.js` is sufficient. **Verify** this by checking that
`aggregatePlayers` picks it up — `players-agg.test.mjs` should still pass.

### 5.6 `sw.js` — ASSETS + CACHE bump

Add all six new files:

```js
'./tic-tac-toe/',
'./tic-tac-toe/index.html',
'./tic-tac-toe/css/tic-tac-toe.css',
'./tic-tac-toe/js/ui.js',
'./tic-tac-toe/js/game.js',
'./tic-tac-toe/js/ai.js',
```

Do **not** add `test.js` — test files are not deployed or precached (Chinchón's `test.js`
and `sim.js` are excluded; follow that).

**Bump `CACHE`** at `sw.js:9`: `'game-hub-v152'` → `'game-hub-v153'`.

Failure mode if you skip the bump or miss a file: `cache.addAll()` is atomic. One 404
aborts the entire service worker install *silently*, the old worker keeps serving the old
build, and the only visible symptom is the hub's version pill stuck at `vN → vN+1`. See
CLAUDE.md, "Diagnostic: the version pill stuck at vN → vN+1."

### 5.7 `run-all-tests.mjs` — register the suite

Add `{ file: 'tic-tac-toe/js/test.js' },` to the `SUITES` array (line ~19), next to the
other per-game engine tests.

---

## 6. Module contract

`tic-tac-toe/js/ui.js` exports exactly three functions plus a default object:

```js
export function init(container) { /* mount into container */ }
export function destroy() { /* remove ALL listeners, stop timers, clear container */ }
export function isInProgress() { /* gates the hub's "leave game?" confirm */ }
export default { init, destroy, isInProgress };
```

- Module-level `let instance`; `init` replaces any prior instance.
- **`destroy()` must be leak-free.** The hub reuses the same container for the next game.
  Any `document`/`window` listener, any `setTimeout`, any pending AI timer must be cleared.
- **`isInProgress()` decision — make it and document it.** CLAUDE.md requires a comment
  next to this function saying which of the two legitimate meanings applies. For this game:
  **no mid-game resume**, so it returns `true` while a game is actually in progress. A
  Tic Tac Toe game is seconds long; autosave/resume would be over-engineering. Write that
  reasoning in the comment so the next session does not re-litigate it.
- The game must also run **standalone** from `tic-tac-toe/index.html`, calling the same
  `init(document.getElementById('tic-tac-toe'))`. Copy `filler/index.html` for the shape.

---

## 7. Profile integration

Read `gamehub.profile` via `loadProfile()` from `js/profile-store.js` at setup-screen load.

- **Precedence:** the game's own saved settings (`gamehub.tictactoe.v1`) beat the profile,
  which beats built-in defaults.
- **Never write the profile back.** Games are read-only consumers.
- Use `profile.name` / `profile.emoji` for the human's label, and the first entry of
  `profile.opponents` for the AI's name/emoji and its `skill` (1/2/3 maps 1:1 onto
  beginner/intermediate/pro).
- Wrap in try/catch. A missing or malformed profile must never crash the game.

---

## 8. Accessibility

- **Matt is red/green colorblind.** X and O are already distinct *shapes*, so this game is
  colorblind-safe by construction — but do not add any state that is signaled by hue alone
  (e.g. do not mark the forced small board with a green tint and nothing else). Use a
  border, a glow, plus a text label.
- The Ultimate forced-board highlight must be perceivable without color: a thick outline
  and dimming of non-playable boards.
- Cells are buttons with accessible names ("Row 2, column 3, empty" / "occupied by X").
- In Ultimate, announce the forced board in text somewhere visible, not just visually.

---

## 9. Tests — `tic-tac-toe/js/test.js`

Headless node assertions, no DOM, no dependencies. Run with `node tic-tac-toe/js/test.js`.
Node ≥22.7, no `package.json` in this repo.

Minimum coverage:

**Classic**
- All eight win lines detected, for both players
- Full board with no line is a draw
- Illegal move (occupied cell) is rejected
- Pro AI never loses: play it against a random opponent ~200 times, assert zero losses

**Ultimate**
- Move in small board `b`, cell `c` forces the opponent into small board `c`
- If board `c` is won, the opponent gets a free move (all playable boards legal)
- If board `c` is full-and-drawn, same free move
- Winning three small boards in a meta-line wins the match
- A drawn small board is dead: it counts for neither player on the meta-board, and no
  further moves into it are legal
- Match terminates: run ~50 AI-vs-AI matches, assert every one ends and none throws
  (Chinchón's `sim.js` is the precedent for this style of termination check)

---

## 10. Acceptance checklist

Do not report done until every line passes.

- [ ] `node tic-tac-toe/js/test.js` green
- [ ] `node validate-sw-assets.mjs` green (no 404s, no unlisted deployed files)
- [ ] `node run-all-tests.mjs` green, all suites, including the newly registered one
- [ ] `node server.mjs`, then load `http://localhost:8123/tic-tac-toe/` — standalone works
- [ ] Load `http://localhost:8123/` — the card appears, alphabetically placed, art renders
- [ ] Play a full Classic game to a win. Re-read `localStorage['gamehub.stats']` and confirm
      `games.tictactoe.total` and `games.tictactoe.tt.classic` both incremented
- [ ] Play a full Classic game to a **tie**. Confirm `tt.classic.played` AND
      `tt.classic.tied` both incremented, and `won`/`lost` did **not** move
- [ ] Confirm `total.played` also incremented on that tie, with `total.won`/`total.lost`
      unchanged (derived draw stays consistent: `played - won - lost`)
- [ ] Play a full Ultimate game. Confirm `games.tictactoe.tt.ultimate` incremented
- [ ] Open My Stats. The Tic Tac Toe tab exists and shows **six numbers**: Classic W/L/T
      and Ultimate W/L/T, with ties labeled as ties
- [ ] Open Leaderboards. The Tic Tac Toe tab exists and ranks correctly
- [ ] Navigate hub → game → back → a different game → back. No console errors, no leaked
      listeners, no stuck timers
- [ ] Confirm `destroy()` clears any pending AI `setTimeout`
- [ ] Pro Classic AI cannot be beaten (draw is the human's best result)
- [ ] Pro Ultimate AI responds within the ~380ms budget on a mid-game position
- [ ] No em dashes anywhere in user-facing copy
- [ ] `sw.js` `CACHE` bumped to `v153`
- [ ] **CLAUDE.md updated** — see below

---

## 11. CLAUDE.md is part of this milestone, not follow-up

THE LAW rule 9: *"A milestone is not done until CLAUDE.md reflects it."*

Required edits:

1. Add a **Tic Tac Toe** row to the games table ("The games" section), following the shape
   of the Filler and Mancala rows. State: in-hub `module:`, both variants, the AI approach
   per tier, settings key `gamehub.tictactoe.v1`, results via `recordTicTacToe`, and the
   note that Pro Classic is a solved/unbeatable minimax by design.
2. Note the `tt` sub-counter shape in the `js/game-stats.js` description, the same way
   `grid`/`cc`/`es`/`nb` are referenced — including that `tied` is stored explicitly there
   while `total`/`byDiff` keep the shared three-field bucket.
3. If you touched the shared-modules table (you will not, unless you add a module), update it.

**Already done, do not redo:** the "Adding a game — checklist" template paragraph has been
corrected to the per-axis table (setup screen from Escoba, CSS scoping from Mancala,
settings key from Filler), including an explicit note that the settings *key* and settings
*screen* are separate axes. Do not re-edit that paragraph, and in particular **do not add
game creation dates to CLAUDE.md** — that was considered and explicitly rejected.

The repo's team is a sequence of fresh sessions with no shared memory. Undocumented
conventions get re-derived and re-diverged. This is not paperwork.

---

## 12. Out of scope — do not build

- Multiplayer. No `js/net.js` import. This is solo-vs-AI only.
- Pass-and-play. (Mancala has it; this game does not need it in v1.)
- Mid-game save/resume. Games are seconds long.
- Any change to `database.rules.json`, Firebase paths, or the identity model.
- Any rename of an existing folder, stats key, or storage key. THE LAW rule 5.
- 4×4 or other board sizes. Classic and Ultimate only.

If you believe one of these is necessary, stop and say so rather than building it.

---

## Why high effort

The mechanical half of this job — engine, DOM, CSS, the seven integration edits — is
routine, and medium effort would very likely handle it. Two things argue for high:

1. **The Ultimate AI is genuine reasoning work.** Iterative-deepening alpha-beta with a
   four-term eval, where the distinctive term (send penalty) is the one a hurried
   implementation drops. Drop it and the AI is visibly bad in a way that is hard to
   attribute later.
2. **Every integration failure here is silent.** An unknown stats id returns `null` with no
   warning. A missing `game-stats-ui.js` tab hides data with no error. A missed `sw.js`
   asset aborts the SW install with no symptom except a stuck version pill. There is no
   red test for any of these unless you actively check — which is what the acceptance
   checklist is for.

At ~1,750 LOC the cost difference between medium and high is small in absolute terms, and
the failure modes are the quiet kind that surface days later. Run it high.
