# Game Hub

A small, ad-free, installable PWA that hosts self-contained game modules. First
game: **Connect Four**, with a genuinely strong AI.

**Play:** https://mpowell95.github.io/game-hub/

## Games

- **Connect Four** — four difficulty tiers:
  - *Easy* — random, but always takes a win / blocks a loss
  - *Medium* / *Hard* — alpha-beta search (depth 5 / 9) with a positional heuristic
  - *Expert* — exact bitboard solver (Tromp/Pons style: non-losing move generation,
    transposition table, iterative-deepening null-window search) that plays the
    game-theoretically correct move once the position is tractable, falling back to
    a deep heuristic search under a time budget in the wide-open opening
- **Business Deal** — coming soon

## Architecture

```
game-hub/
├── index.html              # hub shell (launcher)
├── js/hub.js               # loads games via init(container) / destroy()
├── css/hub.css
├── manifest.webmanifest    # installable PWA
├── sw.js                   # service worker — full offline caching
├── icons/
└── connect-four/           # self-contained game module
    ├── index.html          # also runs standalone
    ├── js/ (board, game, ai, ui, worker)
    └── css/
```

Each game implements a tiny contract — `init(container)` / `destroy()` — so the hub
can mount and unmount it without a page reload. The Connect Four engine uses a
`BigInt` bitboard; the AI runs in a Web Worker so the board stays responsive while
Expert searches.

## Develop / run locally

ES modules and the module worker need to be served over HTTP (not `file://`):

```bash
node server.mjs           # http://localhost:8123
```

Run the headless engine/AI tests:

```bash
cd connect-four && node js/test.js     # or: npm test
```

Regenerate PWA icons:

```bash
node generate-icons.mjs
```
