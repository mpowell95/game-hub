# Snake v2 (`snake-v2/`) — a hidden preview, not a second game

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk, and you must always verify this. THE LAW and its nine working rules sit at
> the top of the root `CLAUDE.md`, always loaded alongside this file (full rationale:
> `js/CLAUDE.md`). This build RECORDS real stats — read "Stats" below before touching `_endRun()`.

Snake's **chrome** rebuilt on the shared UI layer (`css/ui.css`), so the new design can be held
side by side against the real Snake. Created 2026-08-01, in answer to *"do snake as a hidden copy."*

**It presents as the real game, not as a test page.** The first pass shipped with a "Preview" badge,
an explanatory notice, an in-game footnote and a line in the game-over modal. Matt, same day:
*"Delete all the garbage. I want to see what it would look like. Not a paragraph of you saying it's
a test page."* All of it is gone, and the title override is the only remaining tell. Do not
reintroduce preview chrome here.

The real `snake/` is untouched and still in the launcher. `poolv2/` beside `pool/` is the
precedent for a parallel version.

## What it shares with the real Snake, and why

Almost everything. The only thing this build owns is the chrome.

| Shared | How | Why |
|---|---|---|
| The engine | `import { Game, COLS, ROWS, TICK_MS, DIFFS } from '../../snake/js/game.js'` | `game.js` is pure (no DOM, no storage, no timers), so importing rather than copying makes rule divergence impossible. Snake's 49 engine assertions cover this build too, with no second suite to keep in step. |
| The dictionary | `./strings.js` spreads `../../snake/js/strings.js` and adds ~8 preview-only keys | A copy would guarantee drift the first time someone corrects a Spanish line. A fix in Snake's dictionary lands here automatically. |
| The board and D-pad CSS | the root element carries **both** `.sn-root` and `.sv-root`, and `snake/css/snake.css` is injected alongside | 62 pad rules and the LCD canvas are proven, fiddly, and not what is under review. |
| The canvas renderer | `_draw()` is byte-identical to Snake's | See below. |

**The board is deliberately untouched, and that is the point being demonstrated.** The shared
layer covers chrome; a game's play surface stays its own identity. If this build had restyled the
LCD screen too, it would be arguing the opposite of what `css/ui.css` is for.

## What changed

Every chrome surface, and nothing else:

| Surface | Real Snake | Here |
|---|---|---|
| Setup fields | `.sn-field` / `.sn-label` | `.gh-card` / `.gh-field__label` |
| Difficulty, Walls | `.sn-seg` + `.is-on` | `.gh-seg` / `.gh-seg__item[aria-pressed]` |
| Play / How to play | `.sn-play` / `.sn-howto` | `.gh-btn--primary` / `.gh-btn--ghost`, both `--block` |
| In-game HUD | `.sn-hud-cell` | `.gh-chip` (with `tabular-nums`, so climbing scores do not reflow) |
| Game-over, help | `.sn-modal` / `.sn-help` | `.gh-overlay` + `.gh-modal` + `.gh-modal__close` |

`snake-v2/css/snake-v2.css` is ~110 lines against `snake/css/snake.css`'s 270, and the difference
is almost entirely the chrome the shared layer now supplies. That ratio is the result worth
looking at.

## Hub integration

- **`module: '../snake-v2/js/ui.js'`**, `devOnly: true` in `js/hub.js`'s `GAMES`. `js/hub.js:308`
  filters the card unless `isDevProfile(profile.name)` passes (Matt or the tester). Verified in a
  browser, not assumed: an ordinary profile renders 13 cards with no `snake-v2` among them.
- Not immersive, same as Snake.
- **`isInProgress()` uses the LITERAL meaning**, same as Snake and Ball Run: `true` while a run is
  live and not over. A live-action run cannot meaningfully resume across a hub navigation. Do not
  "finish" this by adding a save key, for the same reason `snake/CLAUDE.md` says so.
- Standalone at `snake-v2/index.html`, name-gated before `init()` like every other standalone page.

## Stats — RECORDS, through Snake's own write path

`_endRun()` calls **`recordSnake(length, difficulty, walls)`** — the identical call, with the same
values from the same settings object, guarded by the same record-once `this.recorded` flag as
`snake/js/ui.js`. It is the same write path, not a second one.

**Why it changed.** The first pass deliberately recorded nothing, and said so on screen three
times, on the reasoning that a preview should not write into history it could never take back out.
Removing that notice removed the disclosure the design depended on — and a run that silently fails
to count is precisely THE LAW rule 1's failure shape: to a player, history no screen shows IS
deleted. With the notice gone, recording had to go on. Either pairing is defensible; **the one
combination that is not is silent non-recording**, so if a future session removes recording again,
it must put the notice back in the same commit.

Measured after the change, against a seeded real history: a full run took `sn.runs` 12 → 13,
`total.played` 12 → 13, and `runsByWalls.on` 0 → 1 (the run really was Walls on). Correct bucket,
correct counters, one increment.

## Settings

Reads `gamehub.snake.v1` for its opening defaults, writes **`gamehub.snakev2.v1`**.

Precedence: v2's own saved settings → the real Snake's saved settings → profile skill (1/2/3 →
easy/medium/hard) → medium. The extra step versus Snake's own `loadSettings()` is deliberate: the
preview should open looking like *your* Snake the first time, without ever writing back. Changing
the difficulty in a preview must not silently change the difficulty in the game you actually play.

New key, `gamehub.<game>.v1` form per the root checklist (hyphen dropped, matching
`gamehub.nutsbolts.v1` / `gamehub.dotsboxes.v1`). Nothing is repurposed, so rule 5 holds.

## Not in `sw.js`

Deliberately absent from `ASSETS` while under review, same as `css/ui.css` and `ui-kit/`. A single
`ASSETS` entry that 404s aborts `cache.addAll()` atomically and silently leaves the old worker
serving (root `CLAUDE.md`, the version-pill diagnostic). The cost is that this build does not work
offline, which is the right trade for a preview. `validate-sw-assets.mjs` warns about the new
files; **that warning is the intended state**, not a defect to silence.

## Tests

- `node snake/js/test.js` — Snake's 49 engine assertions cover this build too, because the engine
  is imported, not copied. No second engine suite exists and none should.
- `node test-i18n-strings.mjs` — `snake-v2/js/strings.js` is in the `DICTS` list. Green: 50 `en`
  keys, 0 missing from `es`.
- `node run-all-tests.mjs` — green, 25 suites, 0 failed.
- Browser (Playwright, Chromium, network fenced to localhost per the `js/CLAUDE.md` warning about
  seeding a browser that can reach the real Firebase): the setup screen opens on the real Snake's
  saved settings without having written its own key yet, carries no leftover preview wording, and
  the help modal's close (X) works; a full run to game-over increments the right counters and the
  right walls bucket, and leaves `gamehub.snake.v1` untouched; no console errors.

## If this direction is approved

The migration is Snake's own stylesheet, not this folder: `snake/js/ui.js` injects `css/ui.css`,
swaps its `.sn-btn`-family classes for `.gh-*`, and deletes the chrome half of `snake/css/snake.css`.
**`snake-v2/` is then deleted, not kept** — it is scaffolding, and a second Snake left in the tree
is exactly the kind of undocumented fork rule 9 exists to prevent. Its settings key
`gamehub.snakev2.v1` is orphaned in place rather than removed (rule 5).

Note that once this build records real runs, deleting it costs nothing: every run it recorded went
into `gamehub.stats`'s ordinary `snake` counters, indistinguishable from a run played in the real
Snake, so there is no v2-only history to strand.
