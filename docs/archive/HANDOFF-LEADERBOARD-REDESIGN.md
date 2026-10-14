# Handoff: leaderboard redesign — wins-only, unified chrome, difficulty pills

**Audience: a Sonnet 5 session. Recommended effort: medium.** The design is fully decided (Matt
approved the third round of mockups, 2026-07-23); this doc specifies every screen, value, and
edge. Medium, not low, because it's a real UI rebuild over data with correctness edges (legacy
buckets, solo games, the visibility rule) — not high, because zero design decisions remain. If
something is genuinely ambiguous beyond this doc, stop and ask Matt.

## ⛔ SEQUENCING GATE — status and coordination rules

**The hard gate is CLEARED** (confirmed by Matt, 2026-07-23): the i18n extraction session
(`HANDOFF-I18N-EXTRACTION.md`) finished Phase 2 (My Stats + Leaderboards overlays) and is now in
its per-game phases (Phase 9, Connect Four, at last check) — `js/leaderboard-ui.js` and the
`lb_`/`gs_` keys in `js/strings.js` are committed and stable. This redesign builds ON those
extracted `t()` keys. Verify with `git log --oneline -15` that the Phase 2 commit exists before
starting; ask Matt if it's not obvious.

**That session may still be running in this same working tree** (game folders + closeout). Two
coordination rules while it is:

1. **`sw.js` CACHE**: both sessions bump it. Never hold a dirty `sw.js` edit — apply the bump as
   the LAST edit before each commit, reading the then-current `game-hub-vN` and writing `N+1`.
   If `sw.js` (or any file) shows uncommitted changes you didn't make, the other session is
   mid-phase: wait for its commit, don't touch the file.
2. **`js/CLAUDE.md`**: the i18n closeout edits its "Language support" section; this redesign
   edits its leaderboard section. Different sections, no textual overlap — but apply the same
   dirty-file rule before editing.

## What Matt approved (the design, in words — the mockups live in a chat he saw; you don't need them)

The Leaderboard overlay's current per-game screens stack four dense tables and Matt (the app's
own builder) couldn't find anything. The approved redesign:

1. **Wins only, everywhere on the leaderboard.** No `W-L`, no losses, no win-rate columns.
   Each row leads with ONE big tabular number (wins, or the game's solo metric) with a small
   muted unit/context line under or beside it. Losses and full records REMAIN visible in
   My Stats — that surface is what satisfies THE LAW rule 1 for the raw breakdown; the
   leaderboard becomes the bragging wall. Do not remove anything from My Stats.
2. **The rating is retired from display — not from the repo.** Matt: "drop the rating for now…
   keep the work on it somewhere in the repo for later." `js/leaderboard-rank.js` and
   `test-leaderboard-rank.mjs` stay exactly where they are, untouched and green (the UI still
   imports its `record`/`cmp`/`tierRows`/`tierMix` helpers; `rankPlayers`/`ratePlayer`/
   `soloRating` simply lose their UI caller). No rating number, no `*provisional` note, no
   rating explainer note anywhere in the overlay.
3. **A unified chrome spec** shared by the hub top bar, the Leaderboard overlay, and the My
   Stats overlay (all three; Matt called out that the banners were clearly built independently):
   - Title band: **44px** tall — 17px/600-weight title text, vertically centered.
     ("Matt's Game Hub" / "Leaderboard" / "Game stats" all identical size.)
   - Control band: **36px** tall — the segmented pills (12px text, 999px radius).
   - Filter band (only where filtering exists): **34px** tall — the difficulty pills.
   - Same horizontal padding on all bands on a given screen.
   Implement as CSS custom properties in `css/hub.css` `:root` — `--gh-band-title: 44px;
   --gh-band-controls: 36px; --gh-band-filter: 34px;` — consumed by hub.css and by both
   overlays' injected CSS (they render inside the hub page, so the vars are in scope; keep a
   literal fallback in `var(--gh-band-title, 44px)` form since Escoba-style standalone pages
   never open these overlays but defensive costs nothing).
4. **Segment renames**: Standings → **By Player** (`lb_by_player`), Games → **By Game**
   (`lb_by_game`). Spanish: "Por jugador" / "Por juego".
5. **The difficulty pill row** sits directly under the By Player/By Game segments (and under
   the game-page header): five pills — **All, Beginner, Intermediate, Pro, Expert** — using the
   ski-slope shape language, single-select, restyled `aria-pressed` buttons:
   - All: no shape, just the word (`lb_diff_all`, es "Todas").
   - Beginner: green circle ● `#2e9e44`. Intermediate: blue square ■ `#1F5FA8` (the hub's
     colorblind-safe blue). Pro: black diamond ◆ `#1c2430`. Expert: TWO black diamonds.
   - Shapes are inline SVG (a local `diffShape(tier)` helper returning the svg string; circle /
     rounded square / rotated-square path / two paths). **Shape carries the meaning, color is
     secondary** — the repo's colorblind rule; the active pill is filled (shape white on the
     tier color; All fills `#1c2430`), inactive pills are outlined.
   - **Default: All.** (Matt's earlier "default medium" instruction predates the All pill; All
     as default is what fixes the problem that added the pill — a Beginner-only player must be
     visible on the DEFAULT screen, THE LAW rule 1. If Matt wants a different default at review,
     it's a one-line change.)
   - Selection is overlay-local state; it resets to All each time the overlay opens, and it is
     SHARED between By Player and By Game (one filter, both tabs), and passed into the game
     page when drilling in. Not persisted to localStorage.
   - Filtering maps stored `byDiff` buckets through `js/difficulty-tiers.js`'s `tierOf()`
     (READ-path; do not touch that module or `normDiff`). Tier 1=Beginner, 2=Intermediate,
     3=Pro, 4=Expert. **`unknown`/`legacy` buckets count in All only** — they belong to no
     tier by definition; All must include them so no historical play ever disappears from the
     default view.
   - The Expert pill renders only where tier-4 data can exist: on the game page, only if that
     game has any tier-4 bucket in the field (in practice Connect Four); on By Player / By
     Game, show it always (cross-game context) — simpler and harmless.

## Screen specs

### By Player (replaces Standings)

Card list, not a table. Each named player with any recorded play **at the selected filter**
(All = any play at all — the same `plays > 0` visibility as today, nobody currently visible may
become invisible):

- Card row: rank medal (26px circle: #1 gold `#f5c518`/text `#5c4a00`, #2 silver `#d9dee6`,
  #3 bronze `#e0b490`, 4+ plain `#f1f4f9`), 22px emoji avatar (existing `avatarHTML`), name
  (14px/600), right-aligned big wins number (20px/700, tabular) with "wins" (`lb_wins_unit`,
  es "victorias") and a muted context line `N games` (`lb_games_count`, es "{n} partidas").
- Under it, the **mini difficulty tiles** row (the element Matt loves): one small rounded tile
  per tier the player has played — shape icon + win count at that tier. When a specific pill is
  active, that tier's tile gets a 1.5px border in its tier color and the OTHERS stay muted;
  the card's big number = wins at that tier. Under All, no tile is highlighted and the big
  number = total wins. Tiles for never-played tiers are omitted (not shown as "—") on this tab.
- The viewer's own card keeps ONLY the existing self-highlight (1.5px accent border via
  `_meKey`) — **no "· you" text** (Matt: clutter).
- Wins are `record(total).wins` (draws-as-wins, as today) summed per tier bucket for filtered
  views; solo games (Nuts & Bolts, Ball Run, Snake) contribute their played-as-won counts the
  same way — a solve/run at a tier is a win at that tier. Known, accepted property: solo
  volume inflates win counts with no rating to discount it anymore; Matt is trading precision
  for legibility and may build a dedicated rating page later.
- Sort: wins desc → fewer games first on ties (better economy wins the tie) → `updatedAt` desc.
- No rating column, no tier-mix gradient bar (the mini tiles replace it), no notes.

### By Game (replaces Games)

Single-column list, one row per game (alphabetical by title, as everywhere):

- Row: the game's REAL tile art as a 46x26px rounded thumbnail, game title (14px/600), current
  leader's avatar+name muted underneath; right side a FIXED-WIDTH stack (min-width 56px,
  right-aligned): big number (16px/700 tabular) over a 10px muted unit label. Chevron. Matt's
  explicit note: the old free-form gray metric text made the column ragged — the stacked
  number/unit layout with fixed width is the fix; keep units to ONE word (`wins`, `obstacles`,
  `longest`, `solved` — `lb_unit_*` keys, es: `victorias`, `obstáculos`, `más larga`,
  `resueltos`).
- **Tile art single-source**: create `js/game-art.js` exporting `GAME_ART = { '<hub-id>':
  '<svg…>' }` by MOVING the `art:` strings out of `js/hub.js`'s GAMES registry (hub.js imports
  and references `GAME_ART[id]` — art lives in exactly one place). Leaderboard maps stats ids →
  hub ids: `connect4→connect-four`, `nutsbolts→nuts-bolts`, `tictactoe→tic-tac-toe`,
  `dotsboxes→dots-boxes`, `ballrun→ball-run`, `business→<Monopoly Deal's hub id>`, rest are
  equal — **verify every id against the actual GAMES registry before writing the map.** Add
  `js/game-art.js` to `sw.js` ASSETS. Do NOT import hub.js from leaderboard-ui (side-effectful
  module; the art module exists precisely to avoid that).
- Leader + number respect the filter: competitive games = most wins at that tier; Ball Run =
  best obstacles at that tier (`bestObstaclesByDiff`), Snake = best length (`bestLenByDiff`),
  Nuts & Bolts = solves at that tier (`byDiff[t].played`). All = overall bests/totals.
- A game with zero plays at the selected tier drops off the list; under All, every game shows
  (a never-played game keeps its row with a muted `lb_no_games_yet` line and no number).

### Game page (drill-in from By Game)

- Header band (44px): back pill (`lb_back_games`), the game's 40x23px art thumbnail, title.
- Difficulty pill row (34px), state carried in from the list.
- **Player cards, ALL in the approved style** (every card identical — Matt explicitly rejected
  a differently-styled champion card): medal, avatar, name, big wins-at-filter number + `N
  games` context, and the always-visible mini-tile row showing this game's tiers with the
  player's win count per tier — selected tier highlighted, never-played tiers on THIS tab shown
  muted with "—" (cards must align vertically, so the game page keeps constant tile counts per
  card; the game's own tier set defines the tiles: e.g. Snake easy/medium/hard, Connect Four
  +expert). No "plays up to X" line anywhere (Matt: delete). Self = border highlight only.
- Solo games use the same cards with their metric as the big number (best obstacles / longest
  snake / levels solved at the filter).
- The `tierTable` sections ("Your record by difficulty" / "Everyone, by difficulty") are
  **deleted** — the mini tiles replaced them. Delete `tierTable`/`fieldTierRows` if nothing
  else uses them.
- "Who leads what" chips stay, directly under the cards, restyled with tinted backgrounds
  (rotate a small fixed palette: amber `#fdf3e2`/`#8a5b00`, teal `#e5f3f0`/`#0d5c4d`, blue
  `#e8eff8`/`#173f6e` — text always the dark pair of its tint, never gray/black). Chips are
  filter-INDEPENDENT (lifetime numbers; several — Chinchón closes, Boggle words — have no
  per-tier storage). That's correct and deliberate; don't try to filter them.

## i18n

Every new label is a `js/strings.js` key in BOTH languages, added to whatever key convention
the i18n session established (`lb_` prefix). New keys at minimum: `lb_by_player`, `lb_by_game`,
`lb_diff_all`, `lb_wins_unit`, `lb_games_count`, `lb_unit_wins`, `lb_unit_obstacles`,
`lb_unit_longest`, `lb_unit_solved`. Difficulty names reuse the existing keys from the i18n
extraction (Principiante/Intermedio/Pro/Experto). `test-i18n-strings.mjs` must stay green
(placeholders matched, no orphaned es keys).

## What must NOT change

- `js/leaderboard-rank.js`, `test-leaderboard-rank.mjs` — untouched, still in `run-all-tests`.
- `js/players-agg.js`, `js/game-stats*.js`, `js/difficulty-tiers.js`, every recorder, every
  stored key/value — zero edits. This is a display rebuild.
- My Stats content (losses/records live there — rule 1 depends on it now more than ever).
- The hub launcher grid (tile art moves to `js/game-art.js` but the launcher must render
  pixel-identically).

## Execution order — three commits, no push

1. **Chrome spec**: `--gh-band-*` vars in hub.css; hub top bar, Leaderboard overlay, My Stats
   overlay all on the shared bands; segment renames. Verify: all three screens' title bands
   measure 44px and control bands 36px via `getBoundingClientRect` in the browser; hub
   launcher unchanged otherwise.
2. **`js/game-art.js`** (move, not copy — hub.js consumes it) + **By Game list** + **difficulty
   pills** (component + All-default filter state shared with By Player). Verify: launcher
   renders identically (its cards still show art); every By Game row shows its art thumb; the
   right column is a straight edge; filter switches recompute leaders; SW ASSETS + CACHE bump;
   `validate-sw-assets.mjs` clean.
3. **By Player cards + game page rebuild + rating removal.** Verify below.

## Verification (final commit)

- `node run-all-tests.mjs` all green — including `test-leaderboard-rank.mjs` (the module lives
  on) and `test-i18n-strings.mjs`.
- Browser, BOTH languages, using the localStorage snapshot/restore pattern (do NOT set a
  profile name — the test device is nameless on purpose; a named device syncs fake data to the
  real family leaderboard):
  - All three title bands 44px, control bands 36px (measure, don't eyeball).
  - Default view = All: every player currently on the live board is present (compare the row
    set against the pre-change board — nobody may vanish; THE LAW rule 1 is the acceptance
    bar, and Natalia's 8-play row is the canary).
  - Tapping Beginner/Intermediate/Pro/Expert re-ranks By Player and By Game with hand-checked
    numbers for at least one competitive game (Connect 4 vs the raw `byDiff` buckets) and one
    solo game (Snake `bestLenByDiff`).
  - Legacy/unknown buckets: a player whose only plays are `legacy` still appears under All
    with those wins counted, and under no tier pill.
  - Zero occurrences of a rating number, `provisional`, W-L pairs, or loss counts anywhere in
    the overlay (grep the rendered DOM text for `-` between digits as a cheap check).
  - No console errors; hub launcher pixel-equal (art module move is invisible).
- `js/CLAUDE.md` (rule 9): rewrite the leaderboard section — rating retired from display
  2026-07-23 by Matt's decision (module + tests intentionally kept for a possible future
  dedicated page), wins-only display with losses' visibility satisfied by My Stats, the chrome
  band spec, the pill filter semantics (All default, legacy-in-All-only), and `js/game-art.js`
  in the module table + root CLAUDE.md's slim table.

## Out of scope

Pushing; My Stats redesign; the hub launcher; a rating page (future, maybe); persisting the
filter; per-chip difficulty filtering; Monopoly Deal/Parchís/Boggle anything; every module
listed under "What must NOT change".
