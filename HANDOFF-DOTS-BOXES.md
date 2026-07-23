# HANDOFF — Dots and Boxes

**Target executor:** Sonnet, **high** effort. See "Why high" at the bottom.
**Scope:** one new in-hub module game, `dots-boxes/`, solo vs AI, three board sizes.
**Estimated size:** ~1,600 LOC across 6 files. Layout risk: low (regular lattice), but tap
targets need deliberate care — see section 6.

Read `CLAUDE.md` first, in full — THE LAW, the module contract, the "Adding a game" checklist.

**Use `tic-tac-toe/` as your structural template.** It shipped 2026-07-21, it is the newest
game in the repo, and it was built against a handoff written from the same contract as this
one. Its file layout, module contract implementation, stats recorder, and integration edits
are all current-convention. When this document says "follow the existing pattern," Tic Tac
Toe is the pattern.

---

## 0. Naming — settled, do not deviate

| Thing | Value | Precedent |
|---|---|---|
| Folder | `dots-boxes/` | `nuts-bolts/` (the "&"/"and" is dropped) |
| Hub registry `id` | `'dots-boxes'` | `'nuts-bolts'`, `'tic-tac-toe'` (dashed) |
| **Stats game key** | **`'dotsboxes'`** | `'nutsbolts'`, `'tictactoe'` (**no dashes**) |
| Display title | `Dots and Boxes` | spelled out in full for the player |
| CSS prefix | `db` → `.db-root`, `.db-*`, `--db-*` | free; taken are `br cc cf eb fl mc nb pay ttt` |
| Settings key | `gamehub.dotsboxes.v1` | gen-3 convention |
| Accent color | `#7048a8` | verify on the hub grid that it reads distinctly from Monopoly Deal's `#6a4cff`; adjust darker if not |

**The dashed-vs-undashed split is the easiest way to break this build.** `recordResult` and
`recordDotsBoxes` guard with `if (GAMES.indexOf(gameId) < 0) return null;` — an unknown id
fails silently, no error, no console warning, stats simply never accumulate.

---

## 1. Files to create

```
dots-boxes/index.html          standalone page (must also be in sw.js ASSETS)
dots-boxes/css/dots-boxes.css  all rules descendant-scoped under .db-root
dots-boxes/js/game.js          pure engine, no DOM
dots-boxes/js/ai.js            pure AI, no DOM — the hard file, see section 5
dots-boxes/js/ui.js            DOM + hub module contract
dots-boxes/js/test.js          headless node assertions
```

Keep `game.js` and `ai.js` DOM-free and pure. That is the repo's deliberate seam and it is
what makes `test.js` possible.

---

## 2. Patterns to copy — per axis

The settings **key** (a localStorage name, invisible) and the settings **screen** (the setup
UI) are separate axes with different best examples. Do not infer one from the other.

| Axis | Copy from | Notes |
|---|---|---|
| **Setup screen** | **Escoba** `escoba/js/ui.js:294-330` | the accordion (`_setupExpanded`, `data-action="toggle-row"`, `eb-summary-row`). Matt's stated preference. Filler's flat segmented screen is an acceptable fallback. **Do not copy Mancala's or Connect Four's screens** — explicitly rejected. |
| CSS scoping | **Mancala** `mancala/css/mancala.css` | 0 unscoped rules. Every rule `.db-root .db-x`, never bare `.db-x`. **Cited for CSS only — not its screen.** |
| Settings key | **Filler / Tic Tac Toe** | `gamehub.dotsboxes.v1` |
| Stylesheet injection | **Filler** `filler/js/ui.js:44-55` | `ensureStylesheet()` via `new URL('../css/dots-boxes.css', import.meta.url)` |
| Everything structural | **Tic Tac Toe** | newest, cleanest, same contract |

---

## 3. Rules

- A grid of dots. On your turn you draw one line between two horizontally or vertically
  adjacent dots.
- Completing the fourth side of a 1×1 box claims that box **and grants another turn.** A
  single turn can therefore capture many boxes in a row (a chain).
- If your line completes no box, the turn passes.
- The game ends when every line is drawn. Most boxes wins.
- **A tie is possible** on even box counts. It must be handled and recorded (section 7.2).

### Board sizes (a setting, not a difficulty)

| Label | Boxes | Edges | Tie possible |
|---|---|---|---|
| Small | 3×3 = 9 | 24 | no (odd) |
| Medium | 4×4 = 16 | 40 | **yes** |
| Large | 5×5 = 25 | 60 | no (odd) |

Default Medium. Persist in `gamehub.dotsboxes.v1`.

**Board size is not the difficulty tier.** AI skill is (section 5), because `profile.skill`
maps 1:1 onto beginner/intermediate/pro and the stats screen's `DIFF_META` expects those
labels. Keep the two settings independent.

---

## 4. Engine (`game.js`)

Suggested representation — use it or something equivalent, but keep it pure:

```js
// rows x cols BOXES. Dots are (rows+1) x (cols+1).
hEdges[r][c]   // r in 0..rows,     c in 0..cols-1   horizontal segments
vEdges[r][c]   // r in 0..rows-1,   c in 0..cols     vertical segments
boxes[r][c]    // null | 0 | 1      owner
```

Required surface:

- `newGame(rows, cols)` 
- `legalMoves(state)` → every undrawn edge
- `applyMove(state, edge)` → draws it, claims any box that reached 4 sides, returns
  `{ claimed: n, again: bool }`. `again` is true iff `claimed > 0`.
- `edgeCount(state, r, c)` → drawn sides of box (r,c), 0-4
- `isOver(state)`, `score(state)` → `{ p0, p1 }`

**The extra-turn rule is the whole game.** Get it wrong and nothing above it works. A move
that claims 2 boxes at once (an edge completing boxes on both sides) still grants exactly
one extra turn, not two.

---

## 5. AI (`ai.js`) — the hard part, read this section twice

Difficulty tiers must use **`beginner` / `intermediate` / `pro`** so `DIFF_META`
(`js/game-stats-ui.js:40-44`) renders them. Do not invent tier names.

### The warning that matters most

**A greedy AI that always captures every available box plays badly.** It will take a short
chain, then be forced to open a long one, and hand over the game. This is not a subtle
inefficiency — it is the difference between a Pro tier that feels smart and one that
Intermediate human players beat routinely.

The fix is the **double-cross**, and it is the core of competent Dots and Boxes. Implement
it. Do not substitute a deeper search for it; search alone will not find it reliably at
these board sizes.

### Concepts the AI needs

- **Capturable box** — a box with 3 drawn edges. Free to take.
- **Safe move** — an edge that creates no 3-sided box. Playing safe moves as long as they
  exist is the opening game.
- **Chain** — a maximal run of connected boxes each having exactly 2 drawn edges. Opening
  one end causes the entire run to fall. Length = box count.
- **Loop** — a closed chain (a cycle). Minimum 4 boxes. Double-crossing a loop costs 4
  boxes, not 2.
- **Short chain** = length 1-2. **Long chain** = length ≥ 3.
- **Double-cross (hard-hearted handout)** — when capturing a chain, deliberately take all
  but the last 2 boxes (all but 4 for a loop) and play the "double-dealing" move that
  leaves those boxes to the opponent. You sacrifice 2 boxes; in exchange the opponent must
  open the next chain. That control is worth far more than 2 boxes in any long endgame.
- **Loony position** — when all that remains is chains and loops, control decides the game.

### Chain detection

Build the "open graph": nodes are boxes plus one virtual outer node (the board edge); links
are undrawn edges. A box with exactly 2 drawn edges has degree 2. Walk from each degree-2
box through its open neighbors to trace a chain; a walk that returns to its start is a loop.
Cache per position; recompute after each move.

### Tiers

| Tier | Behavior |
|---|---|
| **Beginner** | Capture any available box (take all). Otherwise a random legal edge. No safe-move preference. |
| **Intermediate** | Capture all available boxes. Otherwise play a safe move if one exists. If none, open the **shortest** chain to minimize the gift. **No double-cross** — always takes everything. |
| **Pro** | Intermediate, plus: (a) full double-cross logic in loony positions — take all but 2 of a chain (all but 4 of a loop) and double-deal, **unless** taking everything wins the game outright on box count; (b) when forced to open, prefer short chains before long ones; (c) exact alpha-beta solve when ≤ 14 edges remain, which makes the true endgame perfect and is cheap at that size. |

Time budget: ~380ms, matching Mancala's Pro tier. No Web Worker — chain analysis is cheap
and the optional endgame solve is bounded by the 14-edge cutoff.

**Condition (a)'s exception is not optional.** An AI that double-crosses when it could
simply take the last chain and win has thrown the game away on principle. Check the box
count before sacrificing.

---

## 6. UI (`ui.js` + CSS) — layout is low risk, tap targets are not

### Board construction

Use **CSS Grid with alternating tracks**, not SVG:

```
columns: dot, cell, dot, cell, ..., dot        (cols+1 dots, cols cells)
rows:    dot, cell, dot, cell, ..., dot        (rows+1 dots, rows cells)
```

Dots sit at even/even intersections. Horizontal edges span even-row/odd-column. Vertical
edges span odd-row/even-column. Box fills sit at odd/odd.

Grid was chosen over SVG deliberately: **every edge should be a real `<button>`** so it is
focusable, has an `aria-label`, and gets browser-native tap handling. That matches how every
other interactive game in this repo builds cells.

### Tap targets — the one real risk here

Edges are visually thin lines but need roughly 44px of touch area. Make the button fill its
whole grid track with transparent padding and render the visible line as an inner element or
pseudo-element. Do not size the button to the line.

**Verify this early.** Before building game logic, render a static Large (5×5) board at
375px width and confirm every edge is comfortably tappable and the board fits without
horizontal scroll. Rough budget at 375px: 6 dots × 10px + 5 cells × 56px = 340px. If it
does not fit, shrink cells before shrinking hit areas.

This is the proportionate version of "board first." It is a lattice, not Parchís geometry,
so it does not need a full mockup-and-approval cycle — but confirm it fits and taps cleanly
before anything depends on it.

### Colorblind safety — hard requirement

**Matt is red/green colorblind.** Box ownership must never be signaled by fill color alone.
Every claimed box carries the owner's **initial or emoji** as a glyph. Drawn edges must be
distinguishable from undrawn by thickness and opacity, not hue.

The forced consequence of a move (which boxes are now capturable) should be perceivable
without color — a border treatment or a subtle marker.

### Other UI requirements

- Live score, both players, always visible.
- The extra-turn rule must be legible: when a capture grants another turn, make it obvious
  whose turn it still is. This is the single most confusing rule for new players.
- Animate chain captures sequentially rather than all at once — a chain of 8 boxes falling
  one by one is the most satisfying moment in the game. Keep it fast (~60-80ms per box) and
  respect `prefers-reduced-motion`.
- No em dashes in user-facing copy (CLAUDE.md, copy conventions).

---

## 7. Integration — seven touchpoints, all silent on failure

Tic Tac Toe just did all seven. Diff its commit for the exact shape of each edit.

### 7.1 `js/hub.js` — GAMES registry

```js
{
  id: 'dots-boxes',
  title: 'Dots and Boxes',
  blurb: 'Draw lines, close boxes, chain your captures. Simple rules, deep endgame.',
  module: '../dots-boxes/js/ui.js',
  accent: '#7048a8',
  art: `<svg viewBox="0 0 120 120" aria-hidden="true"> ... </svg>`,
},
```

- Array position is irrelevant; the launcher sorts alphabetically by `title` (`js/hub.js:293`).
- Do **not** set `immersive: true` — this game uses the standard hub header.
- Art: a dot lattice with two or three edges drawn and one box filled reads instantly at
  tile size.

### 7.2 `js/game-stats.js` — GAMES array + recorder

Add `'dotsboxes'` to the `GAMES` array (line 65).

Add `recordDotsBoxes(difficulty, won, extras)`, modeled on `recordTicTacToe` (line ~429) and
`recordEscoba`. Sub-counter at `st.games.dotsboxes.db`:

```js
db: {
  played: 0, won: 0, lost: 0, tied: 0,   // tied stored EXPLICITLY
  boxes: 0,        // cumulative boxes claimed across all games (additive)
  bestChain: 0,    // longest single-turn capture run ever (Math.max only)
}
```

`extras` = `{ boxes, bestChain }` from the finished game.

Write `ensureDb(g)` alongside the existing `ensureCc`/`ensureEs`/`ensureNb`/`ensureTt`
helpers and call it from the same place (~line 211).

**Ties are first-class, same as Tic Tac Toe.** Medium (4×4) can end 8-8. Pass `won === null`
for a tie; increment `played` and `tied` only, never `won`/`lost`. `total`/`byDiff` keep the
shared `{played, won, lost}` bucket — do **not** modify `bucket()` or `bumpTotals()`, which
all ten existing games share.

**`bestChain` uses `Math.max` only.** THE LAW rule 2: bests only ever improve. Never
overwrite it with a lower value.

### 7.3 `js/game-stats-ui.js` — TABS + screen

THE LAW rule 1: stored is not enough, data must be VISIBLE.

```js
{ id: 'dotsboxes', label: 'Dots and Boxes', accent: '#7048a8' },
```

Add `dotsBoxesScreen(rec)` and wire it into the dispatcher (~line 222). Model on
`escobaScreen`: call `recordScreen('dotsboxes', rec)` and append tallies for **Won / Lost /
Tied**, plus **Boxes claimed** and **Longest chain**. Ties get their own labeled figure, not
folded away.

### 7.4 `js/leaderboard-ui.js` — TABS

```js
{ id: 'dotsboxes', label: 'Dots and Boxes', accent: '#7048a8' },
```

Same accent across all three registries. `ACCENT` derives from this array.

### 7.5 `js/players-agg.js` — no change

`COMPETITIVE = GAMES.filter(g => !SOLO.has(g))`. Dots and Boxes is competitive; it must
**not** go in `SOLO`. Adding it to `GAMES` is sufficient. Verify `players-agg.test.mjs`
still passes.

### 7.6 `sw.js` — ASSETS + CACHE bump

```js
'./dots-boxes/',
'./dots-boxes/index.html',
'./dots-boxes/css/dots-boxes.css',
'./dots-boxes/js/ui.js',
'./dots-boxes/js/game.js',
'./dots-boxes/js/ai.js',
```

Do not add `test.js` — test files are never precached.

**Bump `CACHE`** at `sw.js:9`: `'game-hub-v153'` → `'game-hub-v154'`.

`cache.addAll()` is atomic. One 404 aborts the whole SW install silently; the old worker
keeps serving the old build and the only symptom is the version pill stuck at `vN → vN+1`.

### 7.7 `run-all-tests.mjs` — register the suite

Add `{ file: 'dots-boxes/js/test.js' },` to `SUITES` (~line 19).

---

## 8. Module contract

```js
export function init(container) { }
export function destroy() { }
export function isInProgress() { }
export default { init, destroy, isInProgress };
```

- Module-level `let instance`; `init` replaces any prior instance.
- `destroy()` must be leak-free — clear every listener, timer, and pending AI/animation
  timeout. The hub reuses the container.
- **`isInProgress()` decision:** **no mid-game resume.** Return `true` while a game is
  actually in progress. A Large game runs a few minutes, which is short enough that
  autosave is not worth the complexity. Put that reasoning in a comment next to the
  function — CLAUDE.md requires it so the next session does not re-litigate.
- Must run standalone from `dots-boxes/index.html`. Copy `tic-tac-toe/index.html`.

---

## 9. Profile integration

`loadProfile()` from `js/profile-store.js`, read once at setup-screen load.

- Precedence: saved settings (`gamehub.dotsboxes.v1`) > profile > built-in defaults.
- Never write the profile back.
- `profile.name`/`emoji` for the human; first `profile.opponents` entry for the AI's
  name/emoji and `skill` (1/2/3 → beginner/intermediate/pro).
- The player's initial or emoji is what fills their claimed boxes — this is where profile
  identity actually shows up on screen.
- try/catch; a malformed profile must never crash the game.

---

## 10. Tests (`dots-boxes/js/test.js`)

Headless node, no DOM, no dependencies. `node dots-boxes/js/test.js`, Node ≥22.7.

**Engine**
- Drawing the 4th edge of a box claims it and grants another turn
- An edge completing boxes on **both** sides claims 2 and grants exactly **one** extra turn
- A move claiming nothing passes the turn
- Game ends only when every edge is drawn; final scores sum to the box count
- 4×4 can produce an 8-8 tie and reports it as a tie, not a win

**AI**
- Beginner/Intermediate/Pro all produce only legal moves
- Intermediate never plays an unsafe edge while a safe one exists
- **Pro double-crosses:** construct a loony endgame with one long chain remaining where
  taking everything loses but double-crossing wins, and assert Pro plays the double-deal
- **Pro's exception:** construct a position where taking the whole final chain wins
  outright, and assert Pro takes it all rather than sacrificing
- Pro beats Intermediate over ~50 games on Medium, by a clear margin
- ~50 AI-vs-AI games terminate with no exception (Chinchón's `sim.js` is the precedent)

The two Pro assertions are the ones that matter. They are the difference between a correct
implementation and a plausible one.

---

## 11. Acceptance checklist

- [ ] `node dots-boxes/js/test.js` green, including both Pro double-cross assertions
- [ ] `node validate-sw-assets.mjs` green
- [ ] `node run-all-tests.mjs` green, all suites
- [ ] Standalone `http://localhost:8123/dots-boxes/` works
- [ ] Hub card appears, alphabetically placed, art renders
- [ ] Large board at 375px width: fits with no horizontal scroll, every edge comfortably
      tappable
- [ ] Chain capture animates box by box and is fast
- [ ] Claimed boxes show an initial/emoji glyph, not color alone
- [ ] Win a game. Confirm `games.dotsboxes.total` and `db.won`, `db.boxes`, `db.bestChain`
      all updated; `bestChain` only ever rose
- [ ] Force an 8-8 tie on Medium. Confirm `db.played` and `db.tied` both incremented and
      `won`/`lost` did not move
- [ ] My Stats shows Won / Lost / **Tied** plus Boxes claimed and Longest chain
- [ ] Leaderboard tab exists and ranks
- [ ] hub → game → back → other game → back: no console errors, no leaked timers
- [ ] Pro responds within ~380ms mid-game
- [ ] Pro beats Intermediate consistently in manual play
- [ ] No em dashes in user-facing copy
- [ ] `sw.js` CACHE bumped to `v154`
- [ ] CLAUDE.md updated (section 12)

---

## 12. CLAUDE.md

THE LAW rule 9: a milestone is not done until CLAUDE.md reflects it.

1. Add a **Dots and Boxes** row to the games table: in-hub `module:`, three board sizes,
   AI tiers with a note that Pro implements chain analysis and the double-cross, settings
   key `gamehub.dotsboxes.v1`, results via `recordDotsBoxes`.
2. Note the `db` sub-counter shape in the `js/game-stats.js` description alongside
   `grid`/`cc`/`es`/`nb`/`tt` — including that `tied` is explicit and `bestChain` is
   `Math.max`-only.

The "Adding a game" template paragraph is already correct as of Tic Tac Toe. Do not re-edit
it, and do not add game creation dates to CLAUDE.md — that was considered and rejected.

---

## 13. Out of scope

- Multiplayer. No `js/net.js` import.
- Pass-and-play.
- Mid-game save/resume.
- Non-square boards, or sizes beyond the three listed.
- Any change to Firebase, identity, or `database.rules.json`.
- Any rename of an existing folder or storage key (THE LAW rule 5).
- Restructuring any existing game's setup screen.

If you think one of these is necessary, stop and say so rather than building it.

---

## Why high effort

The engine, UI, and the seven integration edits are routine — Tic Tac Toe established all of
it and medium would handle that half comfortably. The AI is why this needs high:

1. **Chain analysis and the double-cross are specialist knowledge, not general reasoning.**
   A session that does not know Dots and Boxes theory will confidently ship a greedy
   capture-everything AI, and it will look finished. It will also lose to any human who
   knows the double-cross, which is most adults who played this as kids. Section 5 specifies
   the algorithm precisely — **follow it literally rather than improvising a search.**
2. **The two Pro test assertions are load-bearing** and require constructing specific loony
   endgame positions by hand. That is fiddly work that a lower tier tends to stub out or
   approximate, which would leave the exact defect the tests exist to catch.
3. **Integration failures remain silent** — unknown stats id returns `null`, a missing
   stats-UI tab hides data with no error, a missed `sw.js` asset aborts the SW install with
   no symptom but a stuck version pill.

At ~1,600 LOC the medium/high cost delta is small, and the failure mode here is a game that
looks done and plays badly.
