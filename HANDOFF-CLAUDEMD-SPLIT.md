# Handoff: split CLAUDE.md into root + per-game files

**Audience: a Sonnet 5 session executing a decided plan.** Every judgment call below is already
made and justified. Your job is moving content and applying enumerated fixes — not improving prose,
not consolidating, not making new placement decisions. If something seems wrong or ambiguous that
this doc doesn't cover, STOP and ask Matt rather than resolving it yourself. That instruction is
load-bearing: this repo's documented recurring failure mode is a session "improving" things in
transit (see the STOP section of `HANDOFF-LEADERBOARD-CORRECTION.md` for what that cost).

**Recommended effort level: default (medium). Low is acceptable. Do NOT run this at high effort.**
Reasoning: the audit and every placement decision are done (by an Opus session, against real code,
2026-07-23). What remains is verbatim moves, seven enumerated text fixes, two script re-runs, and a
completeness check. Higher effort adds nothing to a move-and-verify task and actively raises the
risk that matters here — the temptation to rewrite, reorganize, or "fix" content beyond the
enumerated list. The one place care is needed is the completeness check (step 7), and that is
procedural, not clever.

## Why this split

Claude Code eagerly loads the root `CLAUDE.md` into EVERY session on every message. The current
file is 1,502 lines (836 hand-written + 666 generated THE-LAW repeats), most of it per-game detail
that's dead weight in any session not touching that game. Claude Code auto-discovers `CLAUDE.md`
files in subdirectories and loads them lazily — only when working with files in that directory.
`escoba/CLAUDE.md` already exists and is the in-repo model for what a per-game file looks like.

Target: root holds only what is true regardless of which game is being worked on. Each game's
detail lives in `<game>/CLAUDE.md`.

## Line-number warning

All line numbers below refer to `CLAUDE.md` as of commit `97a8f5b` (1,502 lines on disk). They are
correct at handoff time but shift the moment editing starts — each finding also quotes an exact
searchable phrase; trust the phrase over the number if they ever disagree. `escoba/CLAUDE.md` line
numbers refer to that file today (249 lines).

---

## Part 1 — Audit findings (apply these fixes DURING the move, not before or after)

An Opus session verified every substantive claim in `CLAUDE.md` against the current code on
2026-07-23. Seven findings. Everything NOT listed here was checked and held up — see "What was
verified clean" at the bottom, and do not re-litigate it.

### Fix 1 — "All seven in-hub module games" is stale; there are ten

- **Where:** line 322, the module-contract section: "All seven in-hub module games (Connect Four,
  Chinchón, Escoba, Filler, Mancala, Nuts & Bolts, Ball Run) export all three".
- **What's true:** TEN in-hub module games export all three (`export function init/destroy/
  isInProgress` grep-verified, 3 hits in each of the 10 `*/js/ui.js` files). The list omits
  Tic Tac Toe, Dots and Boxes, and Boggle, which shipped after it was written.
- **Replacement text:** "All ten in-hub module games (Connect Four, Chinchón, Escoba, Filler,
  Mancala, Nuts & Bolts, Ball Run, Tic Tac Toe, Dots and Boxes, Boggle) export all three;
  grep-verify before assuming otherwise:"

### Fix 2 — "Prefills today" list is badly stale; every game reads the profile now

- **Where:** lines 1089–1091, "Consuming it in a game": "Prefills today: **Connect Four** …,
  **Chinchón** …, **Monopoly Deal** …. **Parchís** wires up in its own R2-3 (see below)."
- **What's true:** all 11 game `ui.js` files import/read the profile (`loadProfile`/
  `profile-store` present in every `*/js/ui.js`), and Parchís's single-file build has its own
  `prefill()` reading `gamehub.profile` (see Fix 3). The three-game list describes July-middle
  state.
- **Replacement text:** "Prefills today: **every game**. All eleven in-repo game modules read the
  profile at setup (name/emoji/opponents/skill as each game's setup uses them), and Parchís's
  single-file build carries its own inlined reader (see `parchis/CLAUDE.md`). The per-game
  precedence rule above (own saved settings beat profile beats defaults) applies in each."

### Fix 3 — Parchís profile paragraph claims R2-3 "not yet built"; it shipped

- **Where:** lines 1498–1501, the Parchís section: "Parchís reads `gamehub.profile` in its own
  Phase R2-3 (setup + i18n) … That phase is not yet built or deployed, so the current build does
  not prefill; the hub already writes a compatible shape, so it will once R2-3 ships."
- **What's true:** `parchis/index.html` line 3206 has `readProfile()` reading `gamehub.profile`,
  and line 3264's `prefill()` uses it: human name from `profile.name`, opponent names and skills
  from `profile.opponents`. The current build DOES prefill. ("Do not add a reader on the hub side"
  remains correct.)
- **Replacement text (whole paragraph):** "**Profile:** Parchís prefills from `gamehub.profile`
  via its own inlined reader (`readProfile()`/`prefill()` in the built `index.html`; source in
  `../Parchís/src/`): human name from `profile.name`, opponent names and skills from
  `profile.opponents`. Its own last-used prefs (`parchis_r2_prefs`) take precedence, same as every
  other game. Do not add a reader on the hub side."

### Fix 4 — "the default deck stays `baraja-libre`" is stale; the default is `anita`

- **Where:** line 1398, Chinchón Pass 4: "`sw.js` precaches every anita asset; the default deck
  stays `baraja-libre`."
- **What's true:** `chinchon/js/cards.js:38` — `const DEFAULT_DECK = 'anita'`; and
  `chinchon/js/ui.js:22` — `const DEFAULT_DECK_ID = 'anita'`. The default deck is anita.
- **Replacement text:** "`sw.js` precaches every anita asset; the default deck is `anita`
  (`DEFAULT_DECK` in cards.js, `DEFAULT_DECK_ID` in ui.js — flip both to change it)."
- Related, optional, non-blocking: `chinchon/js/cards.js` lines 13–14 and 34 carry their own
  stale comments ("figure cards (10–12) fall back to baraja-libre until custom art is added" —
  contradicted three lines later where all 12 court cards join `ANITA_OWN`). Fixing those code
  comments is in scope if trivial, skippable if not.

### Fix 5 — Mancala's root class is `.mancala`, not `.mc-root`

- **Where:** line 441, the adding-a-game axis table: "every rule descendant-scoped under its root
  class (`.mc-root .mc-x`, never bare `.mc-x`)". Also line 456's checklist item 3 states the
  `.xx-root` convention with Mancala as the exemplar.
- **What's true:** the PRINCIPLE is right — `mancala/css/mancala.css` has 96 rules, all
  descendant-scoped, zero bare top-level `.mc-*` rules — but the root class is **`.mancala`**
  (see the file's own header comment), not `.mc-root`. Escoba does use the `.eb-root` style.
  So Mancala is the best example of the *scoping discipline* while not following the *naming*
  convention itself.
- **Replacement text (axis table cell):** "every rule descendant-scoped under its root class
  (`.mancala .mc-x`, never a bare top-level `.mc-x`). Its root class predates the `.xx-root`
  naming convention (it's `.mancala`, frozen); new games use `.xx-root` (Escoba's `.eb-root` is
  the naming model) with Mancala's descendant-scoping discipline. Escoba, Filler and Connect Four
  all carry large numbers of bare top-level prefixed rules — a prefix alone is not isolation."

### Fix 6 — "byte-identical in-scope copy" is not literally true, per the repo's own test

- **Where:** line 165 (shared-modules table, `js/game-stats-global.js` row: "**`business-deal/js/
  game-stats-global.js` is a byte-identical in-scope copy**"), line 916 ("and its byte-identical
  BD copy"), line 1070 (must-stay-synced item 3: "a byte-identical in-scope copy").
- **What's true:** the BD copy prepends a 15-line why-this-copy-exists header ending in the marker
  `// ---- everything below is the canonical file, verbatim ----`; the code AFTER the marker is
  the canonical file verbatim. `test-recorder-contract.mjs` (lines 66–84) enforces exactly that
  verbatim-after-marker property and its own comments explicitly call the CLAUDE.md
  "byte-identical" wording the inaccuracy.
- **Replacement:** in all three places, change "byte-identical" to "verbatim-after-header" (e.g.
  "a verbatim-after-header in-scope copy — a 15-line header ending in a marker line, then the
  canonical file byte-for-byte; enforced by `test-recorder-contract.mjs`").

### Fix 7 — `escoba/CLAUDE.md` says `isInProgress()` "always returns false"; MP made that wrong

- **Where:** `escoba/CLAUDE.md` lines 38–43: "**`isInProgress()` always returns `false`.**"
- **What's true:** `escoba/js/ui.js:2212` — `return !!(instance && instance.mp &&
  !instance._matchEnded);` — false for all solo play (the documented reason stands), but TRUE
  during a live multiplayer match (leaving mid-MP genuinely abandons the room). The ROOT file's
  module-contract description of this is correct; the escoba file predates MP.
- **Replacement text (keep the rest of the bullet):** "**`isInProgress()` returns `false` for all
  solo play** — Escoba persists the live match on every state-changing engine event (see 'Resume
  via engine snapshot' below), so leaving via the hub's own `‹ Hub` button never loses solo
  progress, and the hub's 'you'll lose your progress' confirm would be actively wrong. The one
  exception is multiplayer: it returns `true` while an MP match is live and unfinished
  (`instance.mp && !_matchEnded`), because leaving mid-MP genuinely abandons the room. The in-game
  menu's own 'Quit to setup' is a separate, deliberate abandon: it warns and clears the save."

### What was verified clean (do not re-audit, do not "improve")

Checked against current code/git on 2026-07-23 and confirmed accurate: the three cited commits
(`d7f284b`, `a5571f3`, `7f3812b` — including the 01:04 timestamp); the version-pill/`GET_VERSION`
diagnostic; the `immersive` trio (Escoba, Mancala, Ball Run — hub.js lines 171/235/348); every
per-game mechanism claim spot-checked by symbol name (Connect Four `_statsDisqualified` /
`MIN_STONES_FOR_EXACT_ATTEMPT` / `evaluateColumnsBounded` / `chooseSearchTimed`; Chinchón
`PHONE_WIDTH_MAX` / `_handBreak` / `data-meld-num` / `--cc-hand-overlap`; Escoba `deckModeChosen` /
`escoba-save` / betty assets; Filler `debiasNeighborPair`; Nuts & Bolts `fitToViewport` /
`nb-size-l`; Ball Run `forceContextLoss` / `loseContext` / `teardownRun`; Tic Tac Toe `openHelp`;
Dots and Boxes `pickCaptureOrDoubleCross`; Boggle `shakePlayableBoard` / `BOARD_QUALITY` / `DICE`;
Monopoly Deal `jsn: true` payment routing + `creditorId` cache key); the difficulty-tier weights
and vocabularies; the leaderboard rating model (verified against `leaderboard-rank.js` line by
line); the sync-health mechanism and its "16 plays across 9 devices" figure (re-summed from a real
RTDB export); the Ana/Natalia and Whose-stats sections (written and verified this same day); the
profile contract and the BD profile-reader drift details (`'🧑'` at ui.js:86, `slice(0, 4)` at
ui.js:83); the anita deck owning all 48 faces + back; Monopoly Deal display naming (title, manifest
name/short_name, watermark); THE LAW's 10 copies being byte-identical; every dev-tooling table
entry (all scripts exist and ran green this session).

---

## Part 2 — The split plan

### Files after the split

- `CLAUDE.md` (root) — shrinks to the sections listed under "Root keeps" below.
- `escoba/CLAUDE.md` — already exists; gets Fix 7 only. Touch nothing else in it.
- **Eleven new files**: `chinchon/CLAUDE.md`, `parchis/CLAUDE.md`, `connect-four/CLAUDE.md`,
  `business-deal/CLAUDE.md`, `mancala/CLAUDE.md`, `filler/CLAUDE.md`, `nuts-bolts/CLAUDE.md`,
  `ball-run/CLAUDE.md`, `tic-tac-toe/CLAUDE.md`, `dots-boxes/CLAUDE.md`, `boggle/CLAUDE.md`.

### Root keeps (in this order, current line ranges cited)

| Section | Lines today | Action |
|---|---|---|
| `## Repo location (settled — do not change)` | 3–20 | keep verbatim |
| `## Monopoly Deal naming (settled — do not change)` | 22–45 | REPLACE with the condensed block below; full narrative moves to `business-deal/CLAUDE.md` |
| `## THE LAW` (canonical copy) | 47–111 | keep verbatim; generated repeats handled in step 6 |
| `## Run it` + version-pill diagnostic | 113–136 | keep verbatim |
| `## Architecture` + shared-modules table | 138–190 | keep verbatim, apply Fix 6 (line 165) |
| `### Multiplayer lockstep — invariants` | 262–299 | keep verbatim in root (decision + reasoning below) |
| `### Dev tooling` | 301–317 | keep verbatim |
| `### The module contract` | 319–361 | keep verbatim, apply Fix 1 (line 322) |
| `### Adding a game — checklist` | 433–505 | keep verbatim, apply Fix 5 (lines 441, 456-ish) and ADD checklist item 8 (text below) |
| `## The games` | 577–594 | REPLACE the whole table with the slim table below |
| `## The leaderboard's rating model` | 596–656 | keep verbatim |
| `### Sync health…` | 728–761 | keep verbatim |
| `### The Ana/Natalia correction` | 763–814 | keep verbatim |
| `### Whose stats are these` | 886–933 | keep verbatim |
| `### Head-to-head capture` | 935–947 | keep verbatim |
| `## The shared profile` through `### How-to-play screens` | 949–1139 | keep verbatim, apply Fix 2 (1089–1091) and Fix 6 (1070) |

Everything in root NOT listed above moves out or is generated:

- Lines 1211–1416 (`## Chinchón` + all its subsections) → `chinchon/CLAUDE.md`, with Fix 4.
- Lines 1488–end (`## Parchís`) → `parchis/CLAUDE.md`, with Fix 3.
- Every `## THE LAW` block OTHER than the canonical one at 47, plus its `<!-- BEGIN/END THE LAW -->`
  markers and `---` wrappers — do not hand-delete these; step 6's script regenerates them.

### Why the MP lockstep invariants STAY in root (decided; do not reopen)

The protocol lives in `js/net.js` — a shared root module — and its regression suite
(`test-mp-lockstep.mjs`) is root tooling. A session editing `js/net.js` alone never opens a game
folder, so lazily-loaded game files would never surface the invariants to exactly the session
that most needs them. `escoba/CLAUDE.md` (lines 185–192) already models the right pattern: the
full list + rationale lives in root, the game file carries a condensed game-side slice plus a
pointer. The new `chinchon/CLAUDE.md` mirrors that pattern (slice text provided below). Full-text
duplication into both game files was considered and rejected: it creates a three-way hand-sync
burden with no enforcement, whereas the real enforcement — the `[KNOWN-BUG PROBE]` tripwires in
`test-mp-lockstep.mjs` — exists regardless of where the prose lives.

### THE LAW in the new world (decided; flagged for Matt's review since it's his standing instruction)

Matt's instruction ("repeat THE LAW verbatim about every 10% of the file") was given about the
root CLAUDE.md, and `repeat-the-law.mjs` targets only that file. That stays exactly as is: root
keeps its canonical block, and step 6 re-runs the script so the 10 copies re-space over the
shorter file. Per-game files get NO full copies — the root file, with all 10 copies, is eagerly
loaded into every session alongside any per-game file, so THE LAW is always in context at full
strength. Instead, every per-game file (including existing `escoba/CLAUDE.md`) opens with this
exact header block, inserted as the first thing after the H1 title line:

```
> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — the nine full rules repeat throughout the root `CLAUDE.md`, which is always
> loaded alongside this file. Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.
```

If Matt wants full copies in per-game files instead, that's a one-word instruction at review time
— don't pre-empt it.

### Condensed Monopoly Deal naming block for root (replaces lines 22–45 verbatim)

```
## Monopoly Deal naming (settled — do not change)

The game displays as **Monopoly Deal** everywhere a player can see; the folder is
`business-deal/` and several internal identifiers use `business` / `bd`. **This split is
intentional and load-bearing — never "fix" it.** The stats id `'business'` keys every player's
history in `gamehub.stats` and `players/<deviceId>` (THE LAW rule 1); `business-deal/` is the
live PWA scope/URL; `bd-stats` and `gamehub.bd.pendingStats.v1` are frozen storage keys. A
directory name is not a display name. Full rationale and the enumerated identifiers:
`business-deal/CLAUDE.md`. If an audit calls this split "contradictory," the audit is mistaken.
This is closed.
```

### The slim games table for root (replaces lines 577–594 entirely)

```
## The games

One line per game; each game's full documentation lives in `<game>/CLAUDE.md` (auto-loaded when
working in that folder).

| Game | Integration | CSS root / prefix | Settings key | Stats recorder |
|---|---|---|---|---|
| Ball Run | in-hub `module:`, immersive | `.br-root` / `.br-` | `ballrun.*` (frozen gen-1 dotted keys) | `recordBallRun` |
| Boggle | in-hub `module:` | `.bg-root` / `.bg-` | `gamehub.boggle.v1` | `recordBoggle` |
| Chinchón | in-hub `module:` | `.cc-root` / `.cc-` (many rules still bare-prefixed) | `chinchon-settings` (frozen gen-1) | `recordChinchon` |
| Connect Four | in-hub `module:` | `.cf-root` / `.cf-` (many rules still bare-prefixed) | none (persists nothing — see its file) | `recordConnect4` |
| Dots and Boxes | in-hub `module:` | `.db-root` / `.db-` | `gamehub.dotsboxes.v1` | `recordDotsBoxes` |
| Escoba | in-hub `module:`, immersive | `.eb-root` / `.eb-` | `escoba-settings` (frozen gen-1) | `recordEscoba` |
| Filler | in-hub `module:` | `.filler` / `.fl-` (pre-convention root class, frozen) | `gamehub.filler.v1` | `recordResult('filler', …)` |
| Mancala | in-hub `module:`, immersive | `.mancala` / `.mc-` (pre-convention root class, frozen) | `gamehub.mancala.v1` | `recordResult('mancala', …)` |
| Monopoly Deal | launch-out `href:` (in-repo `business-deal/`, own nested SW) | n/a (own page) | its own keys | `window.__ghStats` → `'business'` |
| Nuts & Bolts | in-hub `module:` | `.nb-root` / `.nb-` | `gamehub.nutsbolts.v1` | `recordNutsBolts` |
| Parchís | launch-out `href:` (built from sibling `../Parchís/`) | n/a (own page) | `parchis_r2_prefs` | `window.__ghStats` → `'parchis'` |
| Tic Tac Toe | in-hub `module:` | `.ttt-root` / `.ttt-` | `gamehub.tictactoe.v1` | `recordTicTacToe` |
```

The root-class/prefix cells were verified against each game's actual CSS on 2026-07-23 (note
Tic Tac Toe is `.ttt-`, three letters, and Filler/Mancala use pre-convention full-word root
classes — real facts, not typos). Bare-rule counts, for context: Chinchón 246, Escoba 219,
Connect Four 99, Filler 68 top-level prefixed rules alongside whatever root class each has —
which is why the axis table's "a prefix alone is not isolation" warning names the worst of them.
If a later redesign adds or renames a root class, the table follows the code.

### New checklist item 8 for "Adding a game" (append after item 7, root)

```
8. **Create `<game>/CLAUDE.md`** — the game's own documentation, auto-loaded only when a session
   works inside that folder. Open it with the THE-LAW pointer block (copy it from any existing
   game file), then: hub integration (module/href, immersive or not, which `isInProgress()`
   meaning it uses and why), layout/responsibilities, key design decisions, correctness-critical
   engine notes, settings/persistence keys, tests. `escoba/CLAUDE.md` is the reference for depth
   and structure. Game-specific detail goes HERE, not in the root file — the root games table gets
   one row (integration, prefix, settings key, recorder) and nothing else.
```

### Per-game file construction

Every new file has the same skeleton, in this order:

1. `# <Game> (`<folder>/`)` title line.
2. The THE-LAW pointer block (exact text above).
3. A "Hub integration" line: module/href, immersive or not, which `isInProgress()` meaning it uses
   (copy the game's clause from the root module-contract section's two-meanings list — COPY, don't
   move; the contract's own examples stay in root).
4. The game's content, moved verbatim per the table below.

| New file | Content source (move verbatim, apply only the listed fixes) |
|---|---|
| `chinchon/CLAUDE.md` | Root lines 1211–1416 (`## Chinchón` through `### Tests`, headings demoted one level is NOT needed — keep `##`/`###` as-is under the new H1), with Fix 4 at line 1398. Then append the games-table Chinchón cell (line 582) as a "Hub notes" paragraph. Then append the MP-invariants slice below. |
| `parchis/CLAUDE.md` | Root lines 1488–end, with Fix 3. Then the games-table Parchís cell (line 584). |
| `connect-four/CLAUDE.md` | Games-table cell (line 581) reflowed: split at sentence boundaries into paragraphs under `## Notes`. No rewording. |
| `business-deal/CLAUDE.md` | The FULL original Monopoly Deal naming section (root lines 22–45, moved before root gets the condensed block) under `## Naming (settled — do not change)`, then the games-table cell (line 583) under `## Notes`, then a pointer: "The three must-stay-synced duplicates this game carries (profile reader, challenge crypto mirror, stats recorder) are documented in the root `CLAUDE.md` under 'Monopoly Deal's must-stay-synced duplicates' — the canonical halves live in root `js/`, so that list stays root-side." |
| `mancala/CLAUDE.md` | Games-table cell (line 586) under `## Notes`, plus one added sentence (verbatim): "CSS: every rule is descendant-scoped under the root class `.mancala` (`.mancala .mc-x`) — the scoping-discipline reference for the repo, though the root class itself predates the `.xx-root` naming convention and stays as-is." |
| `filler/CLAUDE.md` | Games-table cell (line 587) under `## Notes`. |
| `nuts-bolts/CLAUDE.md` | Games-table cell (line 588) under `## Notes`. |
| `ball-run/CLAUDE.md` | Games-table cell (line 589) under `## Notes`. |
| `tic-tac-toe/CLAUDE.md` | Games-table cell (line 590) under `## Notes`. Add (verbatim): "The How-to-play screen pattern in the root CLAUDE.md was worked out on this game; `openHelp()` in `js/ui.js` is its reference implementation." |
| `dots-boxes/CLAUDE.md` | Games-table cell (line 591) under `## Notes`. |
| `boggle/CLAUDE.md` | Games-table cell (line 592) under `## Notes`. |

"Reflowed" means: the table cell is already complete prose sentences — paste the text, break it
into paragraphs at sentence boundaries where topics shift, and change nothing else. Do not
summarize, do not reorder, do not modernize wording.

**Internal-pointer pass:** after moving, grep every moved block for "see below", "see above",
"(below)", "(above)", "this file", and "the games table" — each such phrase referred to a location
in the old single file and must be repointed to the section's new home (e.g. the Chinchón cell's
"See below." → "See the rest of this file."; a moved reference to a root section → "the root
CLAUDE.md's '<section>' section"). Also fix the two known cross-game pointers: the Nuts & Bolts
cell's "Chinchón (below) does the analogous thing with its own hand-row layout" → "(chinchon/
CLAUDE.md)", and the Escoba/anita references in the Chinchón deck section stay as-is (escoba's own
file already documents the dependency from its side).

### The MP-invariants slice for `chinchon/CLAUDE.md` (append verbatim, mirrors escoba's lines 185–192)

```
## MP invariants (July 2026 hardening — full list + rationale in the root CLAUDE.md,
"Multiplayer lockstep — invariants"; regression tripwires in `test-mp-lockstep.mjs`)

The Chinchón-side obligations: the engine decides the match end BEFORE emitting `roundScored` and
announces it as `payload.matchOver` — every MP gate keys on that field, never `this.game.winner`
(null at that moment for points/rounds endings); `config.presetStockResets` is a shift()-consumed
queue, never indexed by the per-round `resetsUsed` counter; `_mpApplyRecovery` remaps the
transmitted snapshot's device-relative `isHuman` flags by seat before rebuilding; and a
round-boundary snapshot (`midRound:false`) resumes via `_resumeNextRound` (never `initMatch()`,
which zeroes every score), with a restoring guest awaiting the host's published round record
(`_mpAwaitNextRound`) before playing.
```

---

## Part 3 — Execution order

1. **Branchless, but commit in two steps** (this repo commits straight to main): first commit =
   the split + fixes; second commit = nothing (reserved — if the completeness check in step 7
   finds a dropped line, fix and amend nothing, make a follow-up commit). Do not push until step 8
   passes.
2. Create the 11 new files per the construction table. Move (don't copy) root content: after this
   step the moved sections must no longer exist in root.
3. Apply Fixes 1, 2, 5, 6 to the root sections that stay. Apply Fix 4 inside the new
   `chinchon/CLAUDE.md`, Fix 3 inside the new `parchis/CLAUDE.md`, Fix 7 inside
   `escoba/CLAUDE.md`. Add the THE-LAW pointer block to `escoba/CLAUDE.md` too (it predates the
   convention).
4. Replace the root games table with the slim table (verify the marked cells against the CSS
   first). Replace the Monopoly Deal naming section with the condensed block. Add checklist
   item 8.
5. Run the internal-pointer pass (grep list above) over every moved block.
6. `node repeat-the-law.mjs --write` — it strips every generated copy and re-spaces 10 copies over
   the now-shorter root. Confirm its output reports exactly 10 copies and that a `git diff` of
   root shows no MANGLED hand-written content around the insertion points.
7. **Completeness check (the step that actually matters):** write a throwaway script (scratchpad,
   not the repo) that (a) takes the pre-split root file at `97a8f5b` (`git show 97a8f5b:CLAUDE.md`),
   (b) strips the generated THE-LAW copies (reuse `repeat-the-law.mjs`'s marker logic — everything
   between `<!-- BEGIN THE LAW` and `<!-- END THE LAW` lines plus their `---` wrappers),
   (c) for every remaining non-blank line, asserts it appears verbatim in exactly one of {new
   root, the 12 per-game files} — EXCEPT lines belonging to the enumerated replacements (Fixes
   1–6, the two replaced root blocks, the slim table). The exception list is small and known;
   everything else must survive verbatim. Any unexplained missing line is a stop-the-line failure.
8. `node run-all-tests.mjs` — all green (nothing here should touch code, so anything red means a
   stray edit; investigate before proceeding). `node validate-sw-assets.mjs` — the new `.md` files
   do NOT go into `sw.js` ASSETS (they're not fetched by the app; the validator only checks
   `.js/.css/.html`), so its output should be unchanged.
9. Commit with a message that names this handoff doc. Push only after Matt has seen the diff or
   explicitly pre-approved.

## Explicitly out of scope

- Any content rewrite beyond the seven fixes and the enumerated replacement blocks.
- Consolidating or trimming THE LAW copies by hand (the script owns them).
- Touching `sw.js`, any game code, or any test EXCEPT the optional `cards.js` comment fix
  (Fix 4's rider) and nothing else.
- The `Game-Hub-Docs/` sibling folder, the `3am 7.22/` screenshots, other HANDOFF-*.md files.
- "While I'm here" improvements of any kind. The audit found seven problems; there are not
  secretly more waiting for a rewrite to fix them.

## Acceptance

Done means: root `CLAUDE.md` contains only the "Root keeps" sections plus 10 generated LAW copies;
12 per-game files exist with the pointer block; the seven fixes are applied and grep-confirmable
(`All ten in-hub`, `Prefills today: **every game**`, no remaining `byte-identical` near the BD
copy, no `does not prefill` in parchis/CLAUDE.md, `.mancala .mc-x` in the axis table, anita named
as default, escoba's isInProgress bullet mentions the MP exception); the completeness script
reports zero unexplained missing lines; `run-all-tests.mjs` is all green; and the whole diff
touches only `CLAUDE.md` files (plus optionally `chinchon/js/cards.js` comments).
