# Game Hub Architecture & Connect Four Module — Spec

Status: planning only, not yet built. Intended as a future Claude Code kickoff
doc, in the same style as the Business Deal CLAUDE.md.

---

## 1. Hub Shell Architecture

Goal: evolve the existing single-game Business Deal PWA into a hub shell that
launches multiple self-contained game modules, similar in spirit to the
reference screenshot (grid of game cards, tap to launch, no ads).

### Proposed file structure

```
game-hub/
├── index.html          # Hub shell — game launcher grid
├── manifest.json        # Shared PWA manifest
├── sw.js                 # Shared service worker (caches all game assets)
├── css/
│   └── hub.css           # Shell styles (launcher grid, top nav)
├── js/
│   └── hub.js             # Game loader/router
├── icons/
│   └── ...                # Shared app icons
└── games/
    ├── business-deal/
    │   ├── js/ (deck.js, game.js, ai.js, ui.js)
    │   └── css/
    └── connect-four/
        ├── js/ (board.js, game.js, ai.js, ui.js)
        └── css/
```

### Module contract

Each game module exposes a minimal standard interface so the hub shell can
load/unload it into a single content area without a full page reload
(keeps the PWA offline-friendly and feeling like one app):

- `init(container)` — mount the game into a given DOM element
- `destroy()` — tear down listeners/state when the user backs out to the hub

### Hub home screen

Grid of game cards: title, art/icon, optional "NEW" badge — same pattern as
the reference screenshot. Tapping a card launches that module. Shared chrome
(top bar with back/menu) is consistent across all games. No ads anywhere.
Single shared PWA install/manifest for the whole hub.

### Shared settings pattern

A difficulty selector (Easy / Medium / Hard / Expert) is a reusable UI
pattern across games, but each game's AI defines what those tiers actually
mean internally.

---

## 2. Connect Four Module Spec

### Board representation

- Standard 7 columns × 6 rows.
- AI engine uses a **bitboard** representation (two bit-packed integers, one
  per player) for fast move generation and win checking — this is the
  standard approach for efficient Connect Four engines. In JS, this likely
  means using `BigInt` or two 32-bit-safe ints per player, since JS lacks
  native 64-bit integers.
- UI layer keeps a simple 2D array for rendering; converts to/from bitboard
  when calling the AI.

### Difficulty tiers

- **Easy** — random legal move, but always takes an immediate win if
  available, and always blocks an immediate opponent win.
- **Medium** — minimax + alpha-beta, depth ~4–6, heuristic eval (center
  column weighting, open-line counting, simple threat detection).
- **Hard** — same search, depth ~8–10, refined heuristic, center-out move
  ordering for better pruning efficiency.
- **Expert** — full alpha-beta search to the end of the remaining game
  (no fixed depth cap), with a transposition table (memoized by canonical
  board state) and center-out move ordering. No artificial weakening or
  randomization — it simply computes the game-theoretically correct move
  every time. This means: it is unbeatable when it holds the winning side
  of the position, and the only way to beat or draw it is for the human to
  also play perfectly — which is a property of the position, not a flaw to
  patch.
  - I believe this should run comfortably fast on a phone given Connect
    Four's small search space, but this is worth profiling once built —
    if early-game search (largest remaining tree) is too slow, a small
    precomputed opening book for the first few moves avoids deep search
    exactly when the tree is biggest.

### Win/scoring logic

- Standard 4-in-a-row check: horizontal, vertical, both diagonals.
- Terminal scoring favors faster forced wins and slower forced losses
  (so the AI doesn't drag out a loss or rush a win sloppily), draw = 0.

### UI/UX notes

- Drop-piece animation, column highlight on hover/tap, win-line highlight
  on the four connecting pieces.
- Difficulty selector and a "who goes first" toggle shown before each game
  — who moves first matters more in Connect Four than in most games, given
  it's a solved game.
- Skip any "engine evaluation" display for v1 — keep the board clean.

### Build session plan (for when this moves to Claude Code)

1. Bitboard engine: move generation, win detection, headless sanity tests.
2. AI engine: all four difficulty tiers + transposition table for Expert.
3. UI: board rendering, animations, difficulty/turn-order selection.
4. Integration: wire as a hub module, PWA polish.

---

## Open questions for later

- Exact heuristic weights for Medium/Hard tiers (will need tuning by play-
  testing, not something to lock in from first principles).
- Whether Easy/Medium tiers should also live under the same bitboard
  engine or use a simpler plain-array implementation for clarity.
