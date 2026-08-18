# Shared modules (`js/`) — deep documentation

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file. The full rules with their rationale and incident
> history are right below.

Everything here was moved verbatim out of the root `CLAUDE.md` on 2026-07-24 so it loads only
when a session actually works on these files. The root keeps the one-line module table and THE
LAW itself; this file holds the depth.

## THE LAW — the full working rules

The law itself is Matt's, two sentences, stated in the root `CLAUDE.md`. The nine rules below
were distilled from real incidents by working sessions (first codified 2026-07-19, commit
`3898a53`, the night after the Ball Run migration made Matt's history invisible; grown since,
one incident at a time). They are the enforcement detail behind the root's one-line versions.

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

---

### Shared modules (`js/`)

Everything below is imported by `hub.js` and/or the module games; a game's own `js/` files
never appear here. This table is the part the old architecture diagram omitted almost
entirely — keep it current when a module is added, split, or merged.

| Module | Role |
|---|---|
| `js/profile-store.js` | validated read/write of `gamehub.profile`; player-code helpers (`loadProfile`/`saveProfile`/`clearProfile`) |
| `js/favorites.js` | hub-only launcher favorites; `gamehub.favorites.v1`; ids are hub registry ids (`GAMES[].id`), never stats keys. Pure/DOM-free (`loadFavorites`/`isFavorite`/`toggleFavorite`); see "THE LAW does not govern favorites" below |
| `js/new-badge.js` | (2026-08-01) the launcher's "New" pill — see "The New badge" below. Pure date maths (`NEW_DAYS`/`parseReleaseDate`/`daysSinceRelease`/`isNewGame`), no storage, no DOM, `now` injectable |
| `js/i18n.js` | (2026-07-23) the EN/ES language layer — see "Language support" below |
| `js/theme.js` | (2026-07-24) the light/dark/auto theme layer — see "Theme support" below |
| `js/game-stats.js` | unified stats, keyed per PLAYER since 2026-07-23 (`statsKey()`/`statsId()`; see "Whose stats are these" — the device owner keeps `gamehub.stats`, anyone else gets `gamehub.stats.p.<CODE>`); one bespoke `recordX()` per game plus generic `recordResult`; a game with richer needs than played/won/lost carries its own sub-counter (`grid` Connect 4, `cc` Chinchón, `es` Escoba, `nb` Nuts & Bolts, `tt` Tic Tac Toe, `db` Dots and Boxes, `bg` Boggle, `yz` Yahtzee, `dm` Dominoes, `hc` Hill Climb, `sk` Skeeball) — `tt`/`db`/`bg`/`yz`/`dm`/`sk` all track `tied` explicitly rather than deriving it (each game can genuinely draw/tie — Dominoes because both players score the opponent's leftover pips at every round end, so both totals can pass the target in one settle and land equal), and `db`/`bg` each carry Math.max-only (or longer-only) bests per THE LAW rule 2; legacy-store folds, the Ball Run metric migration, and the Monopoly Deal pending-stats drain (see "The shared profile" section) |
| `js/game-stats-global.js` | a non-ESM "classic" port of `game-stats.js`'s recorder, exposed as `window.__ghStats` for Monopoly Deal and Parchís — a second, parallel implementation of the stats-write path. **`business-deal/js/game-stats-global.js` is a verbatim-after-header in-scope copy — a 15-line header ending in a marker line, then the canonical file byte-for-byte; enforced by `test-recorder-contract.mjs`** (see "The shared profile" section for why) |
| `js/firebase-boot.js` | the ONE place that boots the named `'stats'` Firebase app + anonymous auth; `stats-net.js` and `net.js` both call `getStatsApp()` so there is only ever one init in flight, never a race between them |
| `js/stats-net.js` | Firebase mirror of profile+stats to `players/<deviceId>`; username reservation registry; `syncHealth()` (see "Sync health") |
| `js/arcade-scores.js` | (2026-08-11) the shared high-score + unlock layer for the arcade-cabinet games (Skeeball now, Pinball next). Pure. Per-board all-time and **date-keyed daily** bests, unlocks, the cross-device merges, and `appWideBest` (derived from synced records - there is deliberately no shared `highscores/` node). The daily best is a MAP keyed by local day, never a value that resets: see its header and `test-arcade-scores.mjs` |
| `js/players-agg.js` | pure identity-graph aggregation (code ∪ name union-find) of synced devices into per-person rows. **A game's sub-counter needs an explicit branch here or it is silently dropped** — see "Adding a game" item 7 |
| `js/game-stats-ui.js` | "My Stats" overlay: a game-list drill-down (owns `gameListHTML`, reused by the leaderboard's player detail) + per-game tailored screens |
| `js/leaderboard-ui.js` | "Leaderboards" overlay; live `watchPlayers` subscription. DOM only — the ranking maths is in `leaderboard-rank.js`; read-only consumer of stored data. Owns one preference key of its own, `gamehub.lb.sort.v1` (the sort choice, alongside `gamehub.favorites.v1`/`gamehub.theme.v1`/`gamehub.lang.v1` — THE LAW rule 2's carve-out) |
| `js/leaderboard-rank.js` | pure, headless-testable ranking: wins are the stored `won` (a draw is NOT a win, 2026-07-28), difficulty-weighted Wilson rating, solo achievement scoring. See "The leaderboard's rating model" |
| `js/difficulty-tiers.js` | READ-path mapping of every game's difficulty vocabulary onto the shared 1-4 tier scale + weights. Deliberately separate from `normDiff()`, which is on the write path |
| `js/net.js` | multiplayer room layer (`rooms/<CODE>`, lockstep move log, heartbeat, recovery, SW-version match on join) used by Chinchón, Escoba, Tic Tac Toe, Mancala, Filler, Dots and Boxes, Pool and Boggle (Boggle's own protocol is NOT lockstep -- see the "eighth consumer" section below). **No longer 2-seat-only as of 2026-07-28** -- it grew an additive N-seat roster (`seats`/`maxSeats`, `joinSeat`, `vacateSeat`, per-seat recovery) that only Chinchón uses so far; see "The ninth consumer" |
| `js/name-gate.js` | (2026-07-31) the ONE "choose a name" gate, called by the hub AND every standalone game page (`await requireName()` before `init()`); `js/name-gate-auto.js` is the deferred-module form for the two classic-script apps. Undismissable by design — see "Nameless devices" below for why the app is not playable without a name |
| `js/a2hs.js` | add-to-home-screen bottom sheet; polls hub DOM state to avoid overlay collisions |
| `js/device-report.js` | (2026-07-22) the profile page's "Device details" diagnostic: `gatherDeviceReport()` reads every localStorage key this app has ever written (both by name - profile, stats, every game's own settings/saves/legacy stats - and exhaustively, a raw `{key, bytes}` dump of literally everything in `localStorage` so nothing is invisible to the page) plus two Firebase reads (`usernames/<name>` and `players/<deviceId>`) that catch a mixed-up profile immediately (registered owner disagrees with this device, or local/remote stats disagree). `uploadDeviceReport()` pushes the whole thing to its own new node, `deviceReports/<deviceId>/<pushId>` - see "The shared profile" for why this exists and why it deliberately excludes `js/challenge/` state |
| `js/install-state.js` | (2026-08-11) installed-app vs browser tab: `installState()` -> `{installed, mode, browser, device, a2hsDismissed}`. Dependency-free on purpose - `stats-net.js` and `bug-report.js` both need it and must not import each other (device-report.js already imports stats-net, so that graph would go circular). Checks BOTH `display-mode: standalone` and `navigator.standalone`, or half the family's iPhones file as "browser" |
| `js/bug-report.js` | (2026-08-11) the DATA half of Report a bug: `gatherEnvironment()` (device/browser/install-state/screen/network/storage/SW/GPU/recent-errors) plus the whole `gatherDeviceReport()` payload, `prepareScreenshot()`'s downscale-until-it-fits, the `bugReports/`+`bugReportShots/` write with a verifying re-read, and the offline outbox (`gamehub.bugreports.pending.v1`) the hub drains on load/reconnect/return-to-launcher. See "Report a bug" below |
| `js/bug-report-ui.js` | (2026-08-11) the SCREEN half: the player's form and Matt's inbox (`isAdmin` only, unread count in `gamehub.bugadmin.v1`). **The first shipped consumer of `css/ui.css`'s `.gh-*` primitives** — a new surface is the cheapest place to adopt that layer |
| `js/error-log.js` | (2026-08-11) last-20 ring buffer of uncaught errors, unhandled rejections and failed resource loads (`gamehub.errorlog.v1`), installed by `hub.js` at LOAD (not in the constructor) so it catches a game module failing to import. Read only by `bug-report.js` |
| `js/announce.js` | (2026-08-11) one-time launcher announcements: the entries (title/body/CTA as `{en,es}` on the entry), the seen-list (`gamehub.announce.v1`), and the pure `pendingAnnouncement()` decision. Reuses `new-badge.js`'s date parser; each entry's `until` retires it with no follow-up commit |
| `js/announce-ui.js` | (2026-08-11) the announcement popup: DOM only, `.gh-*` primitives, dismissal recorded on close by any route |
| `js/challenge/` | retired gift/challenge system (~10 modules + assets). Still load-bearing: `hub.js` and `game-stats-ui.js` import `isDevProfile`/`isChallengeActive`/`isAdmin` from `js/challenge/hooks.js` on every load, and `isDevProfile` (the gate for unreleased `devOnly` games) is built on the challenge's `secrets.js` hash list. Deleting this directory would break the hub shell. |

Firebase layer: one project (`js/firebase-config.js`), anonymous auth, RTDB rules
`auth != null` (known-intentional, effectively open since anyone can sign in anonymously).
Two client layers now share one bootstrap (`js/firebase-boot.js`, named app `'stats'`):
`stats-net.js` and `net.js`. `js/challenge/challenge-net.js` boots Firebase's separate
DEFAULT (unnamed) app and is untouched by the shared bootstrap — it was never part of the
init race that motivated it. Node ownership is disciplined by convention: stats-net touches
`players/` + `usernames/`, net.js touches `rooms/` only, challenge-net touches its own
nodes, device-report.js touches `deviceReports/` only (read of the first two, write of
the third), and bug-report.js touches `bugReports/` + `bugReportShots/` only (it READS
everything device-report.js reads, by calling it, and writes neither). Nothing enforces
this but comments.

---

### Language support (2026-07-23)

The hub is bilingual, English/Spanish, English the default and fallback. The design is
**Parchís's proven round-2 i18n promoted to a shared convention** — `window.ParchisI18n` in
`parchis/index.html` shipped the same t() semantics months earlier and is untouched by this.

- **`js/i18n.js`**: `getLang()`/`setLang()` over **`gamehub.lang.v1`** (`'en'|'es'`);
  `makeT(dict)` builds a `t(key, params)` with the chain *chosen language → English → the key
  itself* plus `{name}` placeholder substitution (a per-language FUNCTION value is the escape
  hatch for grammar that placeholders can't express); `setLang` stamps
  `document.documentElement.lang` and dispatches a `gamehub:lang` CustomEvent;
  `onLangChange(cb)` returns an unsubscribe. **(2026-07-23) The module ALSO stamps
  `document.documentElement.lang` from `getLang()` as a module-scope side effect at load**, not
  only inside `setLang()` — the HTML's hardcoded `lang="en"` otherwise misdeclared a Spanish
  session until the toggle was tapped that visit, which invited browser auto-translate (a
  contributing factor in Ana's 2026-07-23 Boggle report below: machine translation rewrites text
  nodes, including single-letter tiles into whole words).
- **The preference is deliberately NOT a `gamehub.profile` field**: the profile shape has
  hand-synced inlined readers in Monopoly Deal and Parchís (see "Monopoly Deal's must-stay-synced
  duplicates"), so extending it drags in those copies — and a profile reset shouldn't change the
  device's language. A preference, not history: THE LAW's rule-2 carve-out applies, same as
  favorites.
- **Dictionaries are per-game ES modules** (`<game>/js/strings.js`, `{ en, es }`), co-located
  with the game and added to `sw.js` ASSETS — they ride the module graph, so offline support is
  the ordinary precache, no fetches, no JSON, no SW logic.
- **The big extraction (HANDOFF-I18N-EXTRACTION.md) is complete (2026-07-24).** Translated:
  hub chrome (`js/strings.js`, `hub_` keys — top bar, first-run gate, confirm dialogs, card
  blurbs as `{en,es}` on each `GAMES` entry), the profile page (`pf_` keys, the one
  `data-i18n`/`data-i18n-placeholder`/`data-i18n-aria` attribute-driven surface — decision 4),
  My Stats (`gs_` keys) and Leaderboards (`lb_` keys), and all ten pre-Snake in-hub games
  (Filler, Mancala, Tic Tac Toe, Dots and Boxes, Nuts & Bolts, Ball Run, Connect Four, Escoba,
  Chinchón) each with its own `<game>/js/strings.js`. **Boggle's UI chrome joined them
  2026-07-23** (`boggle/js/strings.js`, see boggle/CLAUDE.md and "Known content caveat" below —
  its gameplay content stays English on purpose). Standing exclusions, unchanged from the
  handoff: **Monopoly Deal** and **Parchís** (each its own separate task — Parchís needs the
  sibling `../Parchís/` source rebuild to read `gamehub.lang.v1`), **`js/challenge/`** (retired,
  Matt's own words), and
  everywhere card-suit vocabulary (Oros/Copas/Espadas/Bastos) plus card-rank/figure names
  (Sota/Caballo/Rey) and proper/deck names (e.g. Chinchón's "Ana Banana", the AI roster names)
  appear — those are real vocabulary or proper nouns in both languages, never routed through
  `t()`. `js/difficulty-tiers.js`, `js/game-stats.js` (`normDiff`), and every `recordX()`
  recorder were zero-edit throughout: only DISPLAY labels translate, difficulty ids/stats keys/
  byDiff bucket names/event names stay canonical. `test-i18n-strings.mjs` is the drift tripwire
  (no orphaned `es` keys, matching `{placeholder}` tokens, no empty values) across every
  dictionary; add a new game's `strings.js` to its `DICTS` list when one is created.
- **Game titles translate (Matt, 2026-07-23 — Spain Spanish only, reversing the extraction
  handoff's original titles-stay decision).** Six differ: Conecta 4, Tres en Raya, Puntos y
  Cajas, Tuercas y Tornillos, Carrera de Bolas, Serpiente; the rest are proper/brand names in
  both languages. The name lives in THREE places that must stay in step: `js/strings.js`'s
  `game_title_<statsId>` keys (read by BOTH the leaderboard's `GAME_META` and My Stats' `TABS`,
  so those two can never disagree), the hub `GAMES` registry's `title: {en, es}` (resolved by
  `titleText()`, same pattern as blurbs), and each game's own `strings.js` `title`. Launcher and
  By Game sort alphabetically by the DISPLAYED title, resolved at render time
  (`gameMetaSorted()` in leaderboard-ui.js — never sort these at module scope, it freezes
  whichever language loaded first), so the order legitimately differs per language. Snake's own
  `snake/js/strings.js` es title says Serpiente too (landed 2026-07-23, once the D-pad session
  released the file).
- **Entry points**: the hub's first-run gate has an English/Español chooser (self-labeled, so it
  never needs translating; takes effect immediately, no Save); the hub top bar has a flag-knob
  toggle (`[data-role="lang"]`, `_paintLangToggle()` in hub.js — Matt's design, inline SVG)
  BETWEEN the title and the version pill, showing only the CURRENT language; tap to switch
  (re-renders the launcher). It hides in-game and in immersive mode, same as the version pill.
- **Live-switch policy**: language changes apply to newly rendered UI. Games read `t()` at
  render time and MAY subscribe via `onLangChange` for live re-labeling (Snake does); they are
  not required to.
- **Known content caveat**: Boggle's UI translates (as of 2026-07-23), but its gameplay
  dictionary and dice stay English — a real Spanish Boggle needs a Spanish word list and letter
  distribution (separate, larger task, deferred). The Spanish invalid-word feedback and the
  how-to-play sheet both say the dictionary is English, so this stays discoverable in-game.
  Parchís keeps its own in-game language setting (`parchis_r2_prefs.lang`), which
  wins over the hub preference on that page; wiring it to read `gamehub.lang.v1` as its default
  goes through the sibling `../Parchís/` source rebuild, deferred with the big extraction.

Reference implementation: `snake/` (born bilingual). New-game obligations: root CLAUDE.md,
"Adding a game" item 9.

---

### The New badge (2026-08-01)

Matt: *"Can we add a 'new' badge to games for the first few days they're live? I want to make
sure people see the new games."* A gold **NEW** / **NUEVO** pill on the launcher tile for
`NEW_DAYS` (7) days after the game's release date, then gone.

- **The whole feature is a read-time transform over one date literal.** `js/hub.js`'s `GAMES`
  entry carries `released: 'YYYY-MM-DD'`; `js/new-badge.js` answers `isNewGame(g)`. **Nothing is
  stored — no key, no per-device "seen" state, no expiry job.** That is deliberate: a badge is
  worth exactly zero storage-layer risk, and it means THE LAW has no surface here at all. It also
  means the pill retires itself, so nobody has to remember a follow-up commit (the failure mode
  that would otherwise leave "NEW" on a game for a year).
- **Dates parse as UTC midnight** and compare against the device clock, so a window edge can land
  up to a day off a given player's local midnight. Irrelevant at a week's scale; a local-midnight
  parse would just move the same fuzziness onto players in other timezones.
- **A FUTURE release date counts as new**, not as "not yet live" — the card only appears in the
  launcher once the game is registered, and a device with a slow clock must not be the one player
  who misses the announcement. A malformed or absent date is never new (safe default).
- **Only genuinely-new games get a date. Do NOT backfill.** The first draft of this gave every
  entry its folder's first-commit date, which badged six tiles at once — Filler, Mancala and Dots
  and Boxes had been live and played for a week, and announcing them drowned out Dominoes, the
  one game that had actually just shipped. Git dates are not release dates in this repo anyway
  (most of the early history lands on one import day, 2026-07-25). **Dominoes (2026-08-01) and
  Hill Climb (2026-08-02) are the only entries carrying a `released` date as of this milestone** —
  the two games that genuinely had just shipped when it landed.
- **Tags share one flex row.** `.hub-tags` (top-LEFT, opposite the favorite heart) replaced the
  single absolutely-positioned `.hub-soon-tag`, so a `devOnly` game that just landed shows Test
  and NEW side by side instead of one on top of the other.
- **The pill is `aria-hidden`; the card's `aria-label` says "New game." first.** `aria-label`
  replaces a tile's contents for a screen reader, so a visible-only pill would be silent.
  Colorblind rule holds by construction: the pill spells the word out, the gold (`#F2B705`, the
  palette's yellow) is emphasis and never the signal.
- **Not done, on purpose:** the launcher's ordering is untouched (favorites first, then
  alphabetical) — a new game does not jump the queue. If the pill alone turns out not to be
  enough, sorting new games to the top of "All games" is the next lever, and it changes a
  documented convention, so it should be Matt's call rather than a session's.

### Theme support (Phase 1, 2026-07-24 — HANDOFF-FB-THEME.md, batch 10)

Light/dark/auto, hub-wide. Matt: "chinchon has light/dark mode. Make that available
everywhere." **Chinchón was the only dark mode in the repo before this** (a local
`.cc-dark` class, `chinchon-settings.dark`) — it is now unified onto the shared module
below; every other in-hub game keeps its current light-only look until its own Phase 2 pass.

- **`js/theme.js`**: same shape as `js/i18n.js` — `getTheme()`/`setTheme()` over
  **`gamehub.theme.v1`** (`'light'|'dark'|'auto'`, default `'auto'`); `resolvedTheme(theme?)`
  resolves `'auto'` against `matchMedia('(prefers-color-scheme: dark)')`; `onThemeChange(cb)`
  returns an unsubscribe. `setTheme()` AND a module-load side effect both stamp **`.gh-dark`
  on `document.documentElement`** when the resolved theme is dark — that class is the ONE
  thing every surface's CSS keys off. While the stored mode is `'auto'`, a live
  `matchMedia` `'change'` listener re-stamps the class AND re-dispatches the
  `gamehub:theme` event on an OS-level theme switch, not only on an explicit tap — so a
  toggle icon showing the resolved theme (see below) stays correct without a page reload.
- **A preference, not history**: THE LAW's rule-2 carve-out applies, same as
  `js/i18n.js`'s language pref and `js/favorites.js` — deliberately not a `gamehub.profile`
  field, for the same reasons the language preference isn't (see "Language support" above).
- **CSS mechanism — the only source of truth is the `.gh-dark` class.** Every surface themes
  by overriding ITS OWN custom properties under `:root.gh-dark` (`css/hub.css`'s dark-mode
  block is the reference: it redefines `--hub-bg`/`--hub-surface`/`--hub-surface-2`/
  `--hub-ink`/`--hub-muted` and leaves `--hub-accent` alone). **No `prefers-color-scheme`
  media query anywhere in game CSS** — `'auto'` is resolved once, in JS, so the toggle
  always wins over the OS setting the instant it's tapped.
- **Phase 1 scope (this milestone): the shared module + hub chrome + the three overlays.**
  `css/hub.css`'s dark block covers the launcher shell, cards, and dialogs via the
  `--hub-*` variables; the Leaderboard (`js/leaderboard-ui.js`) and My Stats
  (`js/game-stats-ui.js`) overlays inherit those same variables for free (their injected
  stylesheets already read `var(--hub-surface, #fff)`-style fallbacks) — `hub.css` only
  needed a few extra `:root.gh-dark` overrides for the handful of spots those two files
  hardcode instead of using a variable (`.lb-top`/`.gs-top`'s light-only band tint, and
  `.lb-seg.is-active`/`.lb-pill`/`.lb-tile2.is-sel`, which are built on `--hub-ink` and
  would otherwise render near-illegible once `--hub-ink` flips to a pale color in dark
  mode). The profile page (`profile/index.html`) is themed the same way, being just
  another `css/hub.css` consumer with its own small inline `<style>` block (two literal
  `#fff` focus-state spots were switched to `var(--hub-surface)` for the same reason).
  **Every OTHER in-hub game keeps its current light-only look on a dark shell until its own
  Phase 2 pass** — each one gets its own `:root.gh-dark .xx-root` variable-override block in
  the game's own CSS, one small commit per game. Done so far: Snake, Mancala, Boggle, Dots
  and Boxes, Tic Tac Toe, Nuts & Bolts, Filler. Remaining, per the suggested order: Escoba,
  Ball Run, Connect Four. **Nuts & Bolts is a special case**: its whole UI (`.nb-root`) has
  always had its own permanently-dark workshop palette (`--nb-bg`/`--nb-surface`/etc.),
  unrelated to the hub toggle — no `:root.gh-dark .nb-root` block was needed, only the tier
  3/4 ski-slope shape fix, and that fix is applied UNCONDITIONALLY (not gated behind
  `:root.gh-dark`) since the shape is invisible on that dark backdrop in every hub theme.
- **Toggle**: hub top bar, `[data-role="theme"]`, next to the language knob
  (`js/hub.js`'s `_paintThemeToggle()`); cycles light → dark → auto → light. Icon shows the
  RESOLVED theme (☀️/🌙); a small "A" badge marks the stored mode specifically being
  `'auto'` (the icon alone can't distinguish "auto, currently resolving light" from a
  plain manual "light"). Subscribed once in the `Hub` constructor via `onThemeChange` (not
  per `render()`, which only rebinds the click handler) so the icon stays correct if the OS
  preference flips while `'auto'` is active. Hidden in-game/immersive, same visibility
  rules as the version pill and lang toggle. The profile page also has a plain
  Light/Dark/Auto segmented control (mirrors its Skill segmented control) — same
  `getTheme()`/`setTheme()` calls, no separate state.
- **Chinchón unification**: `js/theme.js` is now the source of truth for Chinchón's own
  dark mode. `_applyTheme()` toggles `.cc-dark` off `resolvedTheme() === 'dark'`, not the
  local `_setup.dark` field. Chinchón's own ☀️/🌙 button (header + menu) now calls the
  GLOBAL `setTheme('light'|'dark')` — an explicit flip, never `'auto'` (a two-icon button
  has no third state to land on) — so toggling it from inside Chinchón changes the whole
  hub's theme, matching Matt's ask. **One-time seed migration** (`ChinchonUI`'s
  constructor): if `chinchon-settings.dark` was `true` and `gamehub.theme.v1` is still
  unset on this device, seed the global key from it (`setTheme('dark')`) so a player who
  already had Chinchón's dark mode on doesn't see the rest of the hub flip to light under
  them. Read-only migration — **the legacy `chinchon-settings.dark` field itself is left
  in place, untouched** (THE LAW rule 5); `_setup.dark` keeps being written on every save
  (now just mirroring the resolved theme) as a harmless, no-longer-read legacy field rather
  than being deleted.
- **Colorblind palette**: the yellow/blue/vermilion/teal hues + shape markers (profile
  preferred-color swatches, difficulty tier pills, etc.) are unaffected by this milestone —
  none of Phase 1's overrides touch hue, only the neutral `--hub-*` surface/ink scale.
- **Verification**: `node run-all-tests.mjs` green (no headless test imports `document`, so
  `theme.js`'s DOM-touching code paths are guarded by the same try/catch pattern as
  `i18n.js`'s); `node test-i18n-strings.mjs` green (the new `hub_theme_*`/`pf_theme_h` keys
  have matching EN/ES pairs). Browser: cycling light/dark/auto updates the hub, both
  overlays, and the profile page instantly; reload persists; a device with
  `chinchon-settings.dark: true` and no `gamehub.theme.v1` yet resolves dark hub-wide on
  first load after this ships.

---

### Multiplayer lockstep — invariants (M1/M2b, hardened July 2026)

Chinchón, Escoba, Tic Tac Toe, Mancala, Filler and Dots and Boxes share one lockstep protocol over `js/net.js`
(`rooms/<CODE>`: a seq-keyed move log, per-round `round` records, a `recovery` field).
**All five invariants below survive the 3-4 seat extension unchanged** (2026-07-28, Chinchón
only — see "The ninth consumer"; **Escoba joined it 2026-08-11**, see `escoba/CLAUDE.md`'s
"Multiplayer at 2-4 seats"); invariant 2 is the only one whose IMPLEMENTATION moved, from
`role === 'host' ? 0 : 1` to `mp.seat`.
Both engines apply
the same decision stream and verify a FNV-1a state hash (`<game>/js/hash.js`) after
every applied remote move; the host is authoritative for desync recovery. Five
invariants below each encode a real bug found and fixed by `test-mp-lockstep.mjs`
(its [KNOWN-BUG PROBE] assertions are the regression tripwires — if one goes red, one
of these came back):

1. **Decide the match end BEFORE emitting `roundScored`.** Chinchón's engine announces
   it as `payload.matchOver`; every MP gate keys on that field, never on
   `this.game.winner` (null at that moment for points/rounds endings — gating on it
   deadlocked the guest at every normal match end and silently skipped its stats
   recording). Escoba's engine sets `winner` before emitting, so its `!winner` gate is
   equivalent. Any new event-hook gate about "does the match continue" must use the
   engine's pre-emit decision.
2. **Transmitted snapshots carry device-RELATIVE `isHuman` flags.** A snapshot's flags
   are the SENDER's perspective. Any receiver rebuilding from one (`_mpApplyRecovery`
   in both ui.js files) must remap agents by SEAT (host = id 0, guest = id 1, fixed at
   match start) and normalize the flags to itself. Trusting transmitted flags handed
   the guest's human agent to the host's seat, which made recovery — the safety net
   under everything else — unable to land.
3. **`config.presetStockResets` is a shift()-consumed queue** (Chinchón only), never an
   array indexed by the per-round `resetsUsed` counter; `_mpAwaitStockReset` proceeds
   when ANY entry is queued. Index-based consumption replayed round 1's shuffle order
   at round 2's first reset.
4. **Autosave AFTER the MP bookkeeping for the same event.** Escoba's `'play'` hook
   runs `_mpAfterPlay` (which advances `appliedSeq`) before `_saveSnapshot`, so the
   save's `mp.seq` matches the play already inside its snapshot. Saving first put the
   seq one low and every rejoin re-applied a move it already had.
5. **A round-boundary snapshot (`midRound:false`) resumes with the NEXT round, scores
   kept.** Chinchón's engine takes the `_resumeNextRound` branch in `playMatch()`
   (never `initMatch()`, which zeroes every score — a THE-LAW-class loss when both
   devices restored at once), and a restoring/recovering GUEST awaits the host's
   published round record (`_mpAwaitNextRound`) before playing, in both games — the
   next round's deck must come from the host, not a stale `presetDeck` or a local
   shuffle.

### The third consumer: Tic Tac Toe (2026-07-27, roadmap phase 1)

`HANDOFF-MP-ROADMAP.md` phase 1. **The conventions phases 2-4 copy were settled here**, in a
game that shares none of Chinchón's vocabulary — no rounds, no deck, no dealer, no rng, no
agent interface. `js/net.js` was NOT touched (2 human seats, host 0 / guest 1); the N-player
extension is phase 3 and is separate work. Read `tic-tac-toe/CLAUDE.md` for the full write-up
and `test-mp-lockstep.mjs`'s T1-T7 block for the executable form. What generalizes:

- **`_localSeat()` from the first line, not retrofitted.** `_localSeat()`/`_myMark()`/
  `_oppMark()`/`_seatOfMark()` replaced the old `humanMark`/`aiMark` fields with a
  seat-indexed `marks[]`, so solo (local human = seat 0) is the degenerate case of the MP
  model rather than a separate path.
- **A snapshot with NOTHING device-relative in it beats remapping after the fact.** Invariant
  2 is solved by construction: `_mpSnapshot()` transmits only the absolute board plus
  seat-indexed `xSeat`/`series`, and the receiver derives its own side from `_localSeat()`.
  Prefer this to Chinchón/Escoba's "trust nothing, remap on arrival" whenever a game's
  snapshot is being designed fresh.
- **Vocabulary mapping onto `net.js`'s existing fields, never new fields.** One room hosts a
  rematch SERIES: a `round` record is one game, `round.n` the game number, `round.deck`
  unused, `round.dealer` the seat that plays X. `writeResult` is deliberately unused (it sets
  `status:'ended'`, which would kill a room meant to host the next game), so `status:'ended'`
  means exactly "somebody abandoned the room".
- **Invariant 3 has no literal analogue and is ported by analogy, with the reason stated in
  the probe.** There is no consumable randomness queue in a game with no rng. The failure
  shape it encodes — per-round consumption state leaking into the next round — maps onto the
  move log: `startRound` clears `moves` atomically with the record, `_mpApplyRoundRecord`
  rebuilds the cache from that snapshot and resets `appliedSeq`, and every entry is stamped
  with its game number. A future game with no equivalent should say so as explicitly.
- **Divergence handling was tightened, and the reference games have the same latent hole.**
  On a hash mismatch the host TAKES the seq (keeping its authoritative state and publishing a
  snapshot) and the guest LATCHES (`mp.awaitingRecovery`) until that snapshot lands. Without
  the latch, every subsequent room update re-delivers the same entry onto the already-diverged
  state and burns the three-attempt budget before the host's answer can arrive. Chinchón and
  Escoba are shielded from this only by their agent interface consuming each delivery exactly
  once; a flag-driven game (i.e. every game left on the roadmap) needs the latch.
- **MP results record under a `'mp'` difficulty bucket** (`MP_DIFFICULTY` in
  `tic-tac-toe/js/ui.js`), not the local setup's last AI tier — the wart
  `HANDOFF-MP-WEB-SESSION.md` touchpoint 5 flags in both reference games. `tierOf('mp')` is
  null, so the play counts in every total and in the leaderboard's All filter and claims no
  tier pill; `DIFF_META` in `js/game-stats-ui.js` gives it a real label. Additive, LAW-safe,
  and the recommended default for the remaining games.

### The fourth consumer: Mancala (2026-07-27, roadmap phase 2)

`HANDOFF-MP-ROADMAP.md` phase 2, the easiest tier-2 game per `HANDOFF-MP-WEB-SESSION.md`
(`mancala/js/ui.js:622`'s pre-existing `mode:'friend'` hot-seat already proved two human-driven
seats work). `js/net.js` was NOT touched. Full write-up: `mancala/CLAUDE.md`; executable form:
`test-mp-lockstep.mjs`'s M1-M6 block. Two things generalize beyond what Tic Tac Toe already
established:

- **A symmetric-seat template does not always apply, and forcing it would be worse than
  deviating.** Tic Tac Toe's X/O marks are interchangeable, so its `marks[]` reassigns them to
  whichever seat opens each game. Mancala's P1/P2 are physically different halves of the board
  (fixed pit ranges, fixed rendered position), so `_localSeat()` fixes host=P1/guest=P2 for the
  whole room instead — closer to a real board's fixed seating than to Tic Tac Toe's swappable
  marks. **Read the game's own shape before copying a reference's seat model verbatim**; state
  the deviation explicitly where `_localSeat()` is defined, the way `mancala/js/ui.js` does.
- **An ASYNC delivery loop (a flag-driven game whose remote moves animate, not instant-snap)
  needs one MORE piece than the sync template: a redeliver-request flag.** Tic Tac Toe's drain
  loop is a tight synchronous `while`, so nothing can interleave mid-drain. Mancala's remote
  moves are routed through the real animated `playMove()` (better UX than a second instant-snap
  path — the reused animation is the whole point of "route input over the network instead of the
  same screen"), which makes the drain loop `await` between entries. That opens a real race,
  found by `test-mp-lockstep.mjs`'s M1 (a fast, decisive game hung reliably before the fix): a
  room update carrying the next move can land in the microtask gap right after the drain loop's
  own "nothing left to apply" check already read a stale cache, and the entry then sits
  undelivered until some UNRELATED room update happens to trigger a new drain — which may never
  come. Fixed with `mp.redeliverRequested`, set whenever the room-update handler refreshes the
  move-log cache and checked by the drain loop before it releases `mp.delivering` (see both
  comments in `mancala/js/ui.js`). **Any future game whose remote-move delivery is genuinely
  async (not just Tic Tac Toe's synchronous shape) needs this same flag** — Dots and Boxes'
  per-edge chain capture is the next candidate on the roadmap and should check for exactly this.

### The fifth consumer: Filler (2026-07-27, roadmap phase 2)

`HANDOFF-MP-WEB-SESSION.md`'s tier-2 lineup, the third of that tier to ship (after Mancala).
`js/net.js` was NOT touched. Full write-up: `filler/CLAUDE.md`; executable form:
`test-mp-lockstep.mjs`'s F1-F6 block. Two things worth stating beyond what Mancala already
established:

- **`applyMove` MUTATES its argument, unlike Mancala's/Tic Tac Toe's pure engines.** Both the
  local-move path (`_mpAfterLocalMove`) and the remote-entry path (`_mpApplyNextEntry`) speculate
  on a `cloneGame()` clone and only commit it to `this.state` once the hash agrees — a corrupted
  or illegal entry is discarded before it can ever touch the live board, rather than needing to
  be rolled back after the fact.
- **The redeliverRequested race generalizes past Mancala's animated-sow case.** Filler's remote
  moves are ANIMATED (the same flood-fill ripple a local move gets) and PACED (a settle beat runs
  before the drain loop even checks for the next entry), so this is a second, independently-found
  instance of the exact race `mancala/CLAUDE.md` documents: any game whose remote delivery is
  genuinely async — not just "has an await somewhere," but has a real gap between committing one
  entry and checking for the next — needs the `redeliverRequested` latch, confirming the earlier
  note that Dots and Boxes' per-edge chain capture should expect the same shape.
- **Seeding deviates from the handoff doc's literal wording, on purpose.** The doc said "transmit
  the SEED in room config"; Filler hosts a REMATCH SERIES (a fresh seed every game, not one for
  the whole room) and `room.config` is fixed once at `createRoom`, so the seed rides `round.deck`
  instead — the same field Chinchón uses for its own per-round deck order, and the first time any
  other game on the roadmap has given that field a real payload. The board itself is never
  transmitted; both sides call `newGame(mulberry32(seed))` and reach byte-identical boards.
- **Invariant 3 ports DIRECTLY, not by analogy** — unlike Mancala's original single-game shape
  (later corrected once its own rematch series shipped), Filler had a rematch series from the
  first line of this pass, so F4 mirrors Mancala's post-correction M4 almost line for line.
### The sixth consumer: Dots and Boxes (2026-07-27, roadmap phase 2)

`HANDOFF-MP-ROADMAP.md` phase 2. `js/net.js` was NOT touched. Full write-up: `dots-boxes/
CLAUDE.md`; executable form: `test-mp-lockstep.mjs`'s DB1-DB6 block. The prediction in the
Mancala section above was correct — this game needed `redeliverRequested` for exactly the stated
reason. What else generalizes or deviates:

- **MOVE GRANULARITY was this game's own open design question, decided web-session-only: ONE
  LOCKSTEP MOVE PER DRAWN EDGE**, matching `game.js`'s `applyMove(state, edge)` grain, never a
  whole chain capture batched into one move. A single real turn can chain-capture many boxes
  (completing a box's 4th side grants another move), so one turn is many rapid `appendMove`
  calls — up to dozens on a Large board's endgame. **This is the one thing a web session cannot
  fully de-risk**: whether that many rapid round-trips inside one turn is fast enough over a real
  network is a latency question, not a protocol question, and is flagged explicitly for the local
  device pass.
- **A THIRD seat-assignment shape, distinct from both Tic Tac Toe's and Mancala's.** Tic Tac
  Toe's X/O marks are symmetric and swap per game (`marks[]`); Mancala's P1/P2 are physically
  fixed board halves that never swap (`_localSeat()` deviation). Dots and Boxes' engine seat 0/1
  is symmetric like Tic Tac Toe's (a box can be claimed by either seat) — but this game has no
  per-seat "mark" object to swap, just plain `humanSeat`/`aiSeat` integers already used
  throughout the solo engine/render code. So `_localSeat()` (host = network seat 0, guest =
  network seat 1) stays fixed for the room, exactly like every other game, while a NEW field,
  `mp.dealer` (the network seat that plays engine seat 0 — i.e. opens — in the current game), is
  the thing that actually varies per game; `humanSeat = _localSeat() === mp.dealer ? 0 : 1` is
  recomputed at every game start/recovery. Net effect: solo's existing `humanSeat`/`aiSeat`
  fields needed zero changes to become MP-safe, only WHERE they get assigned changed — a cheaper
  retrofit than either reference game's seat model needed.
- **Invariant 1 has no literal `winner` field to gate on in this game at all** — `isOver(s)` is
  purely `drawnEdges >= totalEdges`, with no separate match-end flag that could lag behind a
  genuine tie the way Chinchón's points/rounds `winner` or a `s.over`-vs-`s.winner` split can.
  `test-mp-lockstep.mjs`'s DB2 states this non-mapping explicitly in its own probe message rather
  than inventing a `winner`-keyed gate that was never there to break, per the standing rule (see
  Tic Tac Toe's invariant 3 note above) that a future game with no literal analogue should say so.
- **A boundary restore RE-SHOWS the finished game's overlay, a third pattern beyond Tic Tac
  Toe's auto-`_mpStartNextGame()`-on-restore and Mancala's silent no-op-until-the-next-room-
  update.** `_tryRestoreMP` calls `this.finish()` directly on a non-`midGame` save (same
  reasoning as Mancala's restore, which this most resembles) — the host sees "Play again" and
  decides when game N+1 starts exactly as if it had never left, the guest just waits, and
  `finish()`'s own idempotence guard (`_statsCommitted`, already restored from the save) is the
  whole safety net, so there is no separate `_mpAwaitNextGame()`/`_mpStartNextGame()` restore
  branch to get wrong. **Confirms `HANDOFF-MP-WEB-SESSION.md`'s save-key note that there is no
  settled convention here** — a third game, a third answer, all correct for their own game's
  shape.

### The seventh consumer: Pool (physics build, not the MP roadmap doc)

Full write-up: `pool/CLAUDE.md`. `js/net.js` was NOT touched. Built alongside Pool's initial
implementation rather than as its own roadmap phase, so it deviates from the others in a way
worth stating plainly rather than forcing it into their vocabulary:

- **A "move" is shot PARAMETERS, not a discrete game move.** Every reference game above transmits
  something from its own finite move vocabulary (a mark, a pit index, an edge). Pool's engine is
  continuous physics, so what's transmitted is `{dir, power, offset, elevation}` plus an optional
  cue-ball placement — and this is exactly where `physics.js`'s determinism guarantee (same
  inputs, same fixed-step simulation, same result, every time — see that file's own header
  comment) stops being just a fairness requirement and becomes the entire reason lockstep is
  affordable here: nothing about a settled table ever needs to be transmitted, only the shot that
  produced it.
- **`round.dealer` is repurposed as "the seat that breaks,"** the same slot Tic Tac Toe uses for
  "the seat that plays X" and Dots and Boxes for `mp.dealer` — a third re-use of the same field
  for a third game's own "who opens" concept, not a new field.
- **No in-room rematch series** — one game per room, unlike every reference game's `round.n`
  series. A rematch is a fresh room. Kept out of scope for this first pass; the field is there
  (`round.n` is still written as `1`) if a series is added later.
- **The shooter still applies its own shot immediately** (same "don't make the mover wait on a
  round trip to see their own move" principle as every reference game), and the peer applies the
  identical params on delivery and verifies a state hash (`pool/js/hash.js`) — structurally the
  same mover-applies/peer-verifies shape as the others, just carrying physics parameters instead
  of a board move.
- **Status: unverified beyond inline reasoning.** No `test-mp-lockstep.mjs` block exists for this
  game yet (unlike all six reference games), and nothing has been played on two real devices or
  against a `FakeRoom` harness. Flagged honestly in `pool/CLAUDE.md` rather than claimed proven.

### The eighth consumer: Boggle (2026-07-28) — deliberately NOT lockstep

Full write-up: `boggle/CLAUDE.md`'s "Multiplayer" section. `js/net.js` gained exactly ONE new
function for this, `reportRoundResult` (see its own JSDoc in `js/net.js`) — every other consumer
above left `js/net.js` completely untouched, and this is the first genuine addition to its surface
since M1. Read this section before assuming Boggle's MP should look like the other seven; it
deliberately does not, for a reason none of them share:

- **There is no shared mutable state during play, so there is nothing to lockstep.** Every
  reference game above transmits moves from a finite vocabulary (a mark, a pit index, an edge, a
  shot's parameters) because one player's action changes a board the OTHER player's next action
  depends on — that dependency is exactly what a move log, a hash check, and a divergence-recovery
  protocol exist to keep in sync. A Boggle round has no such dependency: both players trace words
  on their OWN copy of the identical board, against their OWN copy of the clock, and nothing either
  one does — finding a word, missing one, running out the clock — can ever affect what the other
  one sees or can do. This game already has no duplicate-word cancellation between the human and
  the AI (see `boggle/CLAUDE.md`'s opening paragraph), and that property is exactly what makes a
  second human safe to play against with the same "no shared state" design: there was never
  anything here for two independent players to diverge ON. Building a move log, a state hash, and
  a recovery protocol for this game would faithfully implement invariants 1-5 above against a
  divergence that cannot occur — testing a failure mode this game's own design rules out.
- **The protocol is "simultaneous, independent, self-report" instead.** The host shakes a
  quality-gated board exactly as solo does (`shakePlayableBoard`) and publishes it; the guest
  never generates its own. Both sides then run their OWN local countdown and, when it ends, compute
  their OWN score locally and report it — `reportRoundResult` is the function that lets BOTH peers
  do this, which is precisely why none of the existing lockstep functions fit: `appendMove`
  assumes a shared, strictly-increasing seq that both sides apply to the SAME state (there is no
  such state here); `writeResult` is documented host-only and sets `status:'ended'`, which would
  kill a room meant to host the next round the instant either side's timer ran out. A round is
  "over" only once BOTH `hostResult` and `guestResult` have landed — checked by
  `boggle/js/mp-round.js`'s `bothResultsIn`, which requires each result to be stamped with the
  round's own number for exactly the reason DB1-style analogues elsewhere guard per-round state:
  `startRound` never clears the previous round's result fields, so without the round-number stamp
  a rematch's fresh round would read as "already both in" using stale data.
- **`round.deck`/`round.dealer` are repurposed again**, a fourth and fifth re-use of fields already
  reused by Chinchón (deck order), Filler (an rng seed), Tic Tac Toe (the seat that plays X), Dots
  and Boxes (`mp.dealer`, the seat that opens), and Pool (the seat that breaks): `round.deck` here
  carries the 16 shaken board FACES, and `round.dealer` carries the round's START TIMESTAMP (epoch
  ms) rather than a seat at all — Boggle has no "who opens" concept, but both sides do need to
  agree on exactly when the shared clock started, including after a rejoin, and deriving the end
  time from one shared number means neither side ever needs to persist its own remaining-time
  value locally.
- **No `test-mp-lockstep.mjs` block.** That harness replays a move log against a `FakeRoom`, and
  there is no move log here to replay. `boggle/js/mp-round.js` holds the pure, DOM-free
  round-timing and result-comparison helpers both peers share, and `test-boggle-mp.mjs` (repo
  root) is this game's dedicated, honestly-scoped stand-in — smaller than the other games'
  lockstep blocks because there is genuinely less to prove, not because less was checked. Forcing
  this game into `test-mp-lockstep.mjs`'s shape would have manufactured invariants to test rather
  than admit none of the lockstep-specific ones apply.
- **Status: unverified beyond inline reasoning and the headless pure-logic tests.** Like Pool's
  first pass, nothing has been played on two real devices. Flagged honestly in `boggle/CLAUDE.md`
  rather than claimed proven.

### The ninth consumer: Chinchón at 3-4 seats (2026-07-28) — the N-player extension

This is **phase 3**, the work the Tic Tac Toe section above deferred ("`js/net.js` was NOT
touched (2 human seats, host 0 / guest 1); the N-player extension is phase 3 and is separate
work"). Matt: "Chinchón only allows 2 players to play in multiplayer. It should be up to 4."
Only Chinchón uses it so far. Full game-side write-up: `chinchon/CLAUDE.md`'s "Multiplayer at
3-4 seats"; executable form: `test-mp-lockstep.mjs`'s C5-C7.

- **The extension is additive, and that is load-bearing rather than merely tidy.** Eight other
  games read `room.host`/`room.guest` directly and pass the literal strings `'host'`/`'guest'`
  to `heartbeat`/`leaveRoom`/`appendMove`. So an N-seat room adds NEW sibling fields (`seats`,
  `maxSeats`) and keeps `host`/`guest` populated — seat 0 mirrors to `host`, seat 1 to `guest`,
  including their `lastSeen` heartbeat stamps. Every pre-existing signature still means exactly
  what it meant: **omit the new argument and the behaviour is byte-identical.** `createRoom`
  gains `opts.seats`; `joinSeat`/`vacateSeat` are new exports rather than changes to
  `joinRoom`/`leaveRoom`; `heartbeat` accepts an integer where it accepted a path fragment;
  `writeRecovery`/`requestRecovery`/`clearRecovery` gain a trailing optional `seat`. **Zero edits
  were needed in escoba/, tic-tac-toe/, mancala/, filler/, dots-boxes/, pool/, poolv2/ or
  boggle/**, and C7 asserts the seatless legacy path still behaves as before.
- **Two genuine correctness bugs exist only at 3+ seats, and both were found by scoping rather
  than by symptoms** — worth stating because neither could ever reproduce on a 2-seat room, so
  no amount of playing the existing games would have surfaced them:
  1. **Seat claiming must be transactional.** `joinRoom` does `get` then `update`, which is safe
     when there is exactly one slot to win and hands two simultaneous joiners the same index
     once there are three. `joinSeat` claims via `runTransaction` (the Firebase database module
     is exposed wholesale by `firebase-boot.js`, so no new import) and then **re-reads the
     committed roster** to find where it actually landed — the updater may run several times,
     and its last-run local variable is not a statement of fact. Two devices holding the same
     engine player id diverge on the first move with no way back.
  2. **`recovery` was ONE shared field carrying two different shapes** — the host's answer
     `{state, seq}` and a guest's plea `{requested}` — which simply overwrite each other. With
     one guest that never mattered. With three, guest B's request clobbers the host's answer
     before guest A reads it, so guest A never resyncs, burns its three-attempt budget and drops
     to "Connection error". **This sits under the safety net every other MP guarantee depends
     on.** Now `recovery/requests/<seat>` and `recovery/answers/<seat>`: they cannot collide by
     construction, the host answers each pleading seat independently, and a healthy device never
     rebuilds from a snapshot addressed to somebody else. A guest forgets its dedupe stamp when
     its answer node goes absent, so an answer re-issued inside the same millisecond can't be
     mistaken for the spent one.
- **A departure ends the match for the whole table, deliberately.** `leaveRoom` was NOT changed.
  Chinchón's engine cannot drop a seat from a live match without every other device diverging on
  the next deal, and inventing that is a rules change, not a networking one. `vacateSeat` is the
  LOBBY-only counterpart — one person backing out before the match starts must not evict the
  other three, which is what the old unconditional `leaveRoom` in `_mpCancelLobby` did.
- **The seat index IS the engine's player id**, on every device, for the whole match. That one
  identity is what lets a device derive its whole side from `mp.seat`, and it makes invariant 2
  (device-relative `isHuman`) a one-line change rather than a redesign: `mySeat = mp.seat`
  instead of `role === 'host' ? 0 : 1`. **A game whose seats are not interchangeable would need
  more** — this worked cheaply because Chinchón's seats are symmetric, the way Tic Tac Toe's
  marks are and Mancala's board halves are not.
- **Invariants 1-5 survive N seats unchanged.** The one worth naming explicitly: the single
  `pendingResolve` slot is correct at four seats rather than lucky, because Chinchón is strictly
  turn-based, so the engine awaits exactly one agent at a time and only one remote seat can ever
  be mid-decision. **A game where several seats could act simultaneously would need a slot per
  seat** — say so there rather than copying this shape blind.
- **`test-mp-lockstep.mjs`'s `FakeRoom` is now N-seat** (`new FakeRoom(seatCount)`, default 2 so
  every pre-existing scenario builds the room it always did) with a monotonic stamp standing in
  for `Date.now()` on recovery records — a synchronous harness produces colliding millisecond
  stamps and would make the per-seat dedupe untestable. `ChinchonSide` is keyed by seat.
- **Status: headless only.** C5-C7 pass against a `FakeRoom`; nothing has been played by three
  or four real devices. Same honest caveat as Pool and Boggle.

### The eleventh consumer of the SEAT model: Escoba at 3-4 seats (2026-08-11)

Not a new consumer of `js/net.js` — Escoba has been a lockstep game since M1. This is the second
game to adopt the **N-seat** half of it, and the point worth recording here is that the phase-3
extension held its promise: **`js/net.js` needed zero changes**, and `joinSeat`/`vacateSeat`/the
seat-addressed `recovery/requests/<seat>` + `recovery/answers/<seat>` records were already there,
already tested, and simply unused by this game. The port was `mp.role` → `mp.seat`,
`_makeRemoteAgent()` → `_makeRemoteAgent(seatId)`, a roster-driven `_mpBuildPlayers`, a seat list in
both lobbies, and `mp.opp` → `mp.opps` for head-to-head. Escoba's engine, like Chinchón's, was
already N-generic and this was verified rather than assumed. Full write-up: `escoba/CLAUDE.md`;
executable form: `test-mp-lockstep.mjs`'s E5-E6.

The one thing Escoba's port adds to the shared record, because it is not seat-specific and every MP
game can hit it: **`_commitStats` must run when the ENGINE decides the match, not when the UI
finishes announcing it.** Escoba recorded the result in its `'matchEnd'` hook, several awaits after
`checkMatchEnd()` had already set `winner` — with a human tapping through the final round modal in
between. If the other player tapped through first and left, `net.leaveRoom` set the room to
`status:'ended'` with no `result`, the still-playing device read that as an abandon,
`_mpEndDueToOpponentLeft` aborted the engine, and `'matchEnd'` never fired: the winner's own win was
never written anywhere, on a coin flip, on every online match. THE LAW rule 1. The fix is to commit
at the decision point (`'roundScored'`, guarded on `winner`, before any await) and to guard both MP
end paths with a `_commitStatsIfDecided()`; `_statsCommitted` keeps it idempotent. `test-mp-lockstep`
E8 parks the host on its final round modal and kills the room underneath it — it was born red.
**Any MP game whose result-recording sits behind an awaited modal has this hole**; check yours.

### The tenth consumer: Battleship (2026-08-04) — the first hidden-information game

Full write-up: `battleship/CLAUDE.md`'s Multiplayer section; executable form:
`test-mp-lockstep.mjs`'s BS1-BS7 block. `js/net.js` was NOT touched. Read this section before
assuming Battleship's MP should look like any of the nine consumers above; it can't, for a reason
none of them share:

- **Every reference game above transmits moves from a finite vocabulary because one player's
  action changes a board the OTHER player's next action depends on, and both devices hold the
  SAME state.** Battleship is neither: there IS shared mutable state both sides must agree on
  (the two public shot grids, the turn, who's won), **and** there is state one side must never
  learn (the other side's fleet). That combination decides the whole protocol.
- **A shot is TWO log entries, not one.** The shooter appends `{k:'s', seat, r, c}`. The
  **defender** resolves it against its own LOCAL fleet (never transmitted, never part of the
  hashed `state` — it lives on `mp.myFleet`, a field outside the engine state entirely) and
  appends the authoritative `{k:'a', seat, r, c, result, shipId, sunk, fleetSunk, cells}`. Both
  devices apply the `'a'` entry and hash after it; the `'s'` entry itself never changes public
  state; its only role is to trigger the defender's resolution. **The mover does not apply its
  own move immediately** — uniquely among this repo's games — it shows a pending reticle and
  waits for the answer.
- **The hash excludes both fleets, structurally, not by discipline.** `battleship/js/hash.js`
  hashes only the two shot grids, shot counts, turn, `over`/`winner`. Each device holds one real
  fleet and one `null` in solo's `state.fleets`; in MP, `state.fleets` is never populated at all
  (always `[null, null]`), so there is nothing fleet-shaped in the hashed state to accidentally
  include in the first place.
- **Recovery deviates from invariant 2, on purpose.** The host's recovery snapshot is
  public-state-only (same shape as the MP autosave minus `myFleet`). The recovering device
  rebuilds its own secret fleet from **its own local MP save**
  (`gamehub.battleship.mp.v1`'s `myFleet` field), never from the network — there is nothing
  device-relative to remap in the snapshot at all (seats are fixed for the room, never swapped
  per game, unlike Tic Tac Toe's marks), so this is invariant 2 solved by construction, one step
  further than Tic Tac Toe's own "nothing device-relative" snapshot. **The honest failure case**:
  a device that lost its local save mid-match cannot recover its own fleet, and the match cannot
  continue there — shown plainly, the room left, never papered over with an invented fleet or a
  silent forfeit.
- **A THIRD kind of entry, `{k:'r', seat}`, exists for the one genuinely concurrent beat in the
  protocol.** Placement happens SIMULTANEOUSLY — both devices place privately and each announces
  readiness — unlike every other exchange here, which is strictly turn-based. This produces a new
  hazard none of the other nine consumers have: **two devices can legitimately write to the
  shared move log at the same time**, and `net.js`'s `appendMove` is a plain write, not a
  transaction, so two independent `++mp.appliedSeq` reservations WOULD collide on the same seq
  slot (found by this game's own lockstep test while it was being written). The fix: ready
  entries are exempted from the strict, single-writer-at-a-time seq stream entirely and live at
  FIXED, seat-derived slots (`seat + 1` — host always 1, guest always 2) that can never collide by
  construction; they're discovered by scanning the log for `k:'r'` entries, not by walking
  `appliedSeq + 1`. Once both are seen, `appliedSeq` is bumped past both reserved slots so the
  strict shot/answer stream — which genuinely is single-writer-per-turn, like every other MP game
  here — starts clean. **A future game with any other simultaneous (non-turn-based) action should
  expect the same hazard and the same fix**, not assume the existing single-counter pattern is
  safe by default.
- **Entry authorship validation is new to this game** (no previous consumer had an entry only one
  specific seat may write): a `'s'` entry is valid only from the seat whose turn it is; an `'a'`
  entry is valid only from the defender of the immediately preceding shot, referencing the same
  cell. A failed check is logged loudly and routed through the SAME divergence-recovery path as a
  hash mismatch, not silently dropped.
- **A divergence on the SHOOTER's own pending answer needs the shooter to un-stick itself, not
  just the recovering guest.** Every other game's divergence handling assumes the device that
  detects a mismatch is either the authoritative host (which just re-publishes and moves on) or a
  guest that will shortly consume a recovery snapshot and resume via the ordinary
  apply-recovery-then-continue path. Here, if the HOST is the one who detects the mismatch WHILE
  it was itself the shooter waiting on an answer, publishing the recovery snapshot alone leaves
  its own `busy` flag (and stale `lastShotSeat`/`lastShotRC` bookkeeping) permanently stuck,
  since the host never consumes its own recovery. The fix already lives in the general shape of
  `_mpOnDivergence`'s host branch: it must still route through the same `_afterStateChange` funnel
  that resets `busy` and re-renders an interactive board — exactly the ordinary post-move funnel,
  called on the divergence path too, not skipped because "nothing really happened."
- **Status: proven headlessly against `FakeRoom`; no real room has ever been created.** A cloud
  session cannot reach Firebase — same honest caveat every other consumer above carries.

---

## Report a bug (2026-08-11)

Matt: *"It needs to allow for uploads of screenshots... a text field to explain the problem, and it
must send all of the details from the phone so we know what's going on (the same as the device
details button in the profile, but with even more information. For example, we'd need the type of
phone they're playing on and the browser vs if it's added as a shortcut, etc.)."*

Five modules, two new Firebase nodes, three new local keys, one CLI reader. **THE LAW has no
surface here by construction**: every key and node is new, and nothing in the pipeline writes to a
stats key, a profile field or a `players/` record.

### Where a player finds it

The launcher's footer row (under the games, behind the divider) and the profile page, directly
above **Device details**. **No in-game entry point, deliberately** — the hub's chrome collapses
in-game and immersive games own the viewport, so a button there would fight for space in exactly
the games most likely to need one. The flow assumed is the real one: something breaks, the player
screenshots it, comes back out, and the form preselects **the game they were last in**
(`hub.js`'s `_lastGameId`, set before the module import so a game that fails to LOAD is still
preselected).

### What a report contains

Three layers, none a subset of another:

1. **What the player said** — the description and the game they picked. The picker is built from
   `game-stats-ui.js`'s `gameChoices()` (the same `TABS` + `game_title_*` keys My Stats and the
   leaderboard use), so it cannot drift and a new game appears in it automatically.
2. **`deviceReport`** — the ENTIRE Device Details payload, verbatim: identity, every localStorage
   key this app has written, the raw key dump, sync health, the two Firebase conflict reads. A bug
   report is a superset of that diagnostic, so nobody has to be told to press both buttons.
3. **`environment`** — what Device Details never knew, because it answers a different question
   ("whose history is this and did it sync", not "what is this person holding"): device and browser
   labels (UA-Client-Hints where available, UA-string patterns for iOS/Safari where not),
   **`displayMode` + `iosStandalone` + `installed`** (Matt's "browser vs added as a shortcut" ask —
   the media query and `navigator.standalone` are kept separate because iOS Safari only has the
   second), screen/viewport/DPR/orientation, theme + language + reduced-motion + timezone,
   connection (`effectiveType`/`rtt`/`downlink`/`saveData`), storage quota and usage, **which build
   the service worker is serving** (the version pill's own `GET_VERSION` message), its
   registrations and cache names, the **GPU renderer string** (what actually explains "the 3D games
   are choppy" for Ball Run / Pool / Hill Climb), and **`recentErrors`** from `js/error-log.js`.

**Every probe is guarded and records `null` on refusal** — Safari rejects the high-entropy UA call,
`performance.memory` is Chromium-only, `storage.estimate` is not universal. A diagnostic that can
fail to SEND is worse than one with a hole in it, so `buildBugReport` is wrapped at its call site
too: if gathering fails outright, the description is sent alone with a `gatherError` field.

### Screenshots

`prepareScreenshot()` downscales to a 1400px long edge and **steps JPEG quality down 0.78 → 0.36
until it fits** rather than refusing a 4 MB photo. Caps (3 shots, 900 KB each, 2.4 MB total) are
checked by the pure `fitsShotBudget()` BEFORE a shot is attached, so the player is told at pick
time instead of after a failed send. The canvas is painted white first: a dark-mode screenshot
re-encoded onto a transparent canvas renders black-on-black in some viewers.

They live in **`bugReportShots/<id>`, separate from `bugReports/<id>`**, so the inbox and
`read-bug-reports.mjs` can list every report without pulling megabytes they are not showing.
**If full-resolution images or more than three are ever needed, add Firebase Storage** rather than
raising these caps — RTDB is not a file store.

### The offline outbox — the part that matters most

A bug is usually reported from the phone that was just having trouble, which is the phone most
likely to be offline. So a failed send is **kept**: `queuePendingReport()` writes it to
`gamehub.bugreports.pending.v1` and `hub.js` drains it on load, on `online`, and on returning to
the launcher — the three moments stats sync already retries on. If the whole thing will not fit in
localStorage the TEXT is kept without the screenshots, `shotsDropped` is set, and **the
confirmation says so out loud** instead of quietly dropping the pictures.

`submitBugReport()` verifies by a fresh re-read before claiming success (rule 6's habit: a resolved
promise is not proof the data landed, and a report that silently evaporates is the one bug nobody
can report). A screenshot upload that fails after the record landed stamps `shotError` ON the
record rather than failing the send.

### How Matt is notified

**In-app plus the CLI. No email, no push — a platform limit, not an oversight.** Web Push needs a
server to send from; email needs an SMTP credential or a third-party form service, which would mean
a secret in a public repo or family bug reports routed through a stranger. What fits "static files,
no build step, no dependencies":

- **The hub's inbox.** For `isAdmin(profile.name)` only, the footer grows a **🐞 Bug reports** pill
  showing how many reports are newer than this device's last inbox open (`gamehub.bugadmin.v1`).
  It opens the list newest-first, each drilling into description, screenshots, environment summary
  and full JSON, with **Copy full report**, a **Reply** box, **Mark as done**, and **Delete**.
- **`node read-bug-reports.mjs`** — the same records in the terminal, and the only way to get the
  screenshots onto disk (`--shots`). `--deleted` includes ones cleared from the in-app inbox.

**If a real notification is ever wanted**, the smallest honest route is a Cloud Function on
`bugReports/` onCreate sending mail. That needs the Blaze plan and a deploy step this repo has
never had, so it is Matt's call, not a session's.

### Replying, and clearing the inbox (2026-08-13)

Matt, holding a report he had just fixed: *"how do I reply to the bug report to tell him it's fixed
and that all his wins counted, they didn't vanish? I must be able to delete the reports in my inbox
once addressed as well. There's a mark as done button, but it doesn't do anything, just unbolds it
and removes the new badge. He should have an inbox of sorts somewhere in his profile. and when I
reply, his profile should have a notification badge so he knows to click into it."*

**A reply is written TWICE, and the second write is the one that matters:**

| Path | What it is |
|---|---|
| `bugReports/<id>/reply` | the canonical answer, sitting on the report it answers (`{text, atMs, at}`) |
| `bugReplies/<reporterDeviceId>/<id>` | **the reporter's own inbox** — what their device actually reads |

The index is keyed by the deviceId **already stored on the report** (`reporter.deviceId`), which is
the whole reason this shape was chosen: the first reply Matt needed to send was to a report filed
two days before any of this existed, so anything depending on the reporting device having recorded
something locally would not have reached him. It also means a player's device reads one small node
of its own rather than downloading every report in the system to find the ones that are theirs —
the RTDB rules are `auth != null`, so the privacy here is the UI's shape, not an ACL.

`replyToBugReport` returns `{ ok, delivered }`. **`delivered:false` is not a failure** — it means
the reply saved on the report but that report carries no deviceId to index it under, so the player
will never see it. The UI says exactly that instead of a green tick over a message nobody will read.
The reply write also stamps `status:'done'`: answering a report IS handling it, and a second
required tap is how an inbox fills with things already dealt with.

**"Mark as done" now does something.** It always wrote `status`/`statusAt` — nothing read them, so
a handled report stayed exactly where it was, just un-bolded. Done reports now fold into a
`Show done (N)` disclosure below the open ones.

**Delete is a SOFT delete** (`deleted:true` + `deletedAtMs`), and deliberately so:
- Matt's inbox stops showing it (`visibleInInbox`), which is the whole of what he asked for.
- `read-bug-reports.mjs --deleted` still finds it.
- **The reporter's copy of any reply is untouched**, because it lives under `bugReplies/`, not here.
  Tidying the inbox can never take back something already said to a player.
- It is two taps (the button arms, then confirms) with an **Undo** afterwards. A hard delete would
  be the one irreversible button in this app, on a phone, sitting next to "Mark as done".

**The player's side** is `openMyReplies()` (js/bug-report-ui.js), reached from a **📬 Replies to
your reports** button in the profile page's footer — rendered always, not only when something is
waiting, so it is a place that exists rather than a control that appears and vanishes. It shows
their own words with Matt's answer under them. Opening it stamps `gamehub.bugreplies.seen.v1` from
**the newest reply's own timestamp, not from `Date.now()`** — a reply landing while the screen is
open is still unread next time rather than being silently skipped.

**The badge** is on the launcher's profile pill (`.hub-profile-mail`, painted by `_paintReplyBadge`
on load and on `online`). The pill has `overflow: hidden`, which would clip a corner dot, so the
badge rides inside it as a count and the accent border does the attention-getting: shape and number,
never hue alone.

Covered by `test-bug-report.mjs` (the pure halves: the reply clamp, reply-time ordering at real
epoch precision, the unread count, the seen stamp's round trip, and that `visibleInInbox` filters a
VIEW rather than the records). The Firebase and DOM halves are still not in a committed suite —
they were driven end to end in a real browser against a fake RTDB during the build (23 checks,
including that the reply indexes under the reporter's device id and that Delete needs two taps),
but that harness lives in a scratch directory, same gap the section below already admits.

### The announcement layer

`js/announce.js` (logic) + `js/announce-ui.js` (DOM). One entry, one id, shown once per device on
the launcher; its call-to-action opens the report form, so the announcement teaches the feature by
using it. The seen-list is a preference, rule 2's carve-out, same class as favorites/theme/language.

- **`until` is what retires it** — the New pill's self-cleaning idea (whose date parser this
  reuses). Without it, a phone left in a drawer opens to a stack of old news.
- **An entry may carry `shots`: pictures of where the thing it announces actually is.** Matt asked
  for these twice, and the second ask is the one to build to: **whole phone screens, side by side**,
  not tight crops of the button. He mocked it up by drawing on two of his own screenshots. The
  marks (a ring round the button, a thick arrow into it) are injected into the real page before the
  shot, so they are baked in and re-shooting after a redesign is a script run, not an image-editing
  session. **The recipe, since the script is not in the repo:** Playwright at 393x852, DSF 1, scroll
  to the bottom, inject an SVG ring + arrow, screenshot the whole viewport as JPEG q82. 1x JPEG
  because they render ~165 CSS px wide; a 2x PNG of a launcher is ~500 KB each for no visible gain.
  **Use a neutral stand-in profile and blank the sync code and device id before the shot** — these
  ship to everyone, and a real-looking code in a help picture is just an invitation to type it in.
- **Four files per shot**, resolved at render time by the same `textFor()` the title and body use:
  per THEME via `resolvedTheme()` (never a bare `matchMedia`, or an explicit light choice on a dark
  phone gets the wrong picture) and per LANGUAGE, because a Spanish popup pointing at a button
  labelled "Report a bug" is a picture of somebody else's app. They sit in `img/`, which
  `isShellAsset()` does NOT treat as shell, so a bad path lands in the non-atomic REST tier and can
  never strand an install; a figure whose image fails to load removes itself. `test-bug-report.mjs`
  asserts all eight paths exist, because a typo here is silent — the popup still opens, just with a
  hole in it. On a short phone the pictures are capped at `40vh` and cropped from the TOP
  (`object-position: bottom`), so the button, the arrow and both buttons stay above the fold.
- **A malformed date fails SAFE (shown, not hidden).** One that appears when it should not is a
  small mistake; one that silently never appears is invisible until somebody asks why nobody knew.
- **Adding the next one: append a NEW id.** Never re-use or renumber — devices that dismissed it
  would see it again, devices that never saw it would never get the new one. Title, body and CTA
  are `{en, es}` ON the entry (registry data stays co-located, i18n decision 3); everything else
  routes through `js/strings.js`'s `bug_*` / `ann_*` keys.
- Never shown over the name gate or a mounted game, and only once per page load.
- **The bug-report entry went fully live on 2026-08-11**, after Matt tested it on his own phone:
  the `adminOnly` line was deleted and nothing else changed, so every device got it fresh, exactly
  once. **`adminOnly: true` previews an entry to Matt alone** (`isAdmin`, checked in `hub.js`'s
  `_maybeAnnounce` before `showAnnouncement`, so a gated entry is never marked seen on anyone
  else's device and lands fresh for everyone the day the flag is deleted). The bug-report entry
  shipped gated on 2026-08-11 so Matt could test the real thing on his own phone first;
  `test-bug-report.mjs` prints a NOTE on every run naming any entry still gated, because the whole
  point of gating is that somebody has to remember to ungate it.

### Privacy, stated plainly

A report carries the player's name, code, device id, their whole local store and any screenshot
they attach, into an RTDB whose rules are `auth != null` — readable by anyone who can sign in
anonymously. **Not new** (`deviceReports/` and `players/` are the same), but it now includes
pictures, which is worth knowing before this points at anyone outside the family.

**The form itself says nothing about this, by decision.** It shipped with a "What gets sent with
this" fold (device, browser, mode, screen, connection, with real values) and a lead line; Matt had
both removed the same day — the form is reached by someone who is already annoyed, and it is now
four fields and a button. The announcement that introduces the feature still says the phone and app
details go along, and that is where the telling happens. Nothing about what is COLLECTED changed at
any point. **A future session re-adding a disclosure to the form is reversing a decision, not
filling a gap** — take it to Matt first.

### What is NOT covered by a test

`test-bug-report.mjs` covers the pure logic. The DOM halves and the Firebase write path are covered
only by a hand-driven browser pass (real Chromium at 393x852: announcement → CTA → form → attach a
screenshot through the real downscale path → send with Firebase blocked → the report is queued
locally with its environment, deviceReport and screenshot intact → reload → announcement gone,
pending note shown; repeated in dark mode and in Spanish). **No report has ever been written to the
real Firebase from this branch** — the same caveat every MP consumer above carries.

---

## Who is on the installed app, and who is in a browser tab (2026-08-11)

Matt: *"I found out 2 days ago that Ana never did that. She never saved it to her Home Screen...
She just dismissed the notice early on."* Every game here is built for the installed route, and
nothing anywhere recorded which route a person was actually on.

- **`js/stats-net.js`'s `syncMyStats()` now mirrors `installState()` to `players/<id>/device`.** It
  rides the EXISTING mirror rather than getting its own write, so every device answers on the beats
  it already syncs on (load, tab-hide, return-to-launcher, reconnect) instead of only the ones that
  file a bug report. Additive: a new child node, read by no gameplay or stats path, incapable of
  moving a counter.
- **It carries the BUILD too** (`device.build`, e.g. `v295`, from `appVersion()` - the same
  GET_VERSION message the version pill uses, so a report and the sync can never name different
  builds for one device). Matt asked whether the app auto-updates for people who never tap the
  pill: it does (`skipWaiting` + `clients.claim`, and the fetch handler is network-first), so
  nobody should be more than one launch behind. This turns "should" into a fact, and it is the
  only thing that catches a device whose SHELL INSTALL FAILED - that one sits on an old build
  indefinitely and looks completely normal from the outside. **This is why an auto-reload on
  `controllerchange` was NOT added**: it would fire on first-ever load (claim gives an
  uncontrolled page a controller), it can yank the app out from under someone mid-form, and it
  fixes nothing for the stranded case. Measure first.
- **`node read-install-state.mjs`** lists it, browser tabs first, and prints every build in the
  wild on the last line.
- **It is NOT retroactive, and the tool says so.** A device shows `(not seen yet)` until it next
  opens the hub on a build that has this. That is missing data, not a browser tab, and the two must
  never be reported as the same thing. There is no record of how anyone played before this shipped.
- **`a2hsDismissed` is in the object on purpose**: it distinguishes someone who was asked to install
  and said no (Ana's case) from someone who was never asked.

## The Device details button, retired (2026-08-11)

Matt: *"That was built specifically for a one time use. Now that we have the report a bug feature
it's redundant and obsolete."* Retired, not deleted:

- **`js/device-report.js` stays and is still load-bearing** - `gatherDeviceReport()` is layer 2 of
  every bug report. Only the profile page's BUTTON, its modal and its strings are gone.
- **`uploadDeviceReport()` is now dormant** with no caller. Left in place deliberately (same status
  as `leaderboard-rank.js`'s rating exports): do not delete it as "unused".
- **`deviceReports/` in Firebase is untouched**, and `read-device-reports.mjs` still reads it. The
  archive of what was already collected stays exactly where it is.
- The announcement's profile screenshot had to be re-shot, since it showed the button being removed.

## Hiding test/debug accounts from the leaderboard (2026-07-29, widened 2026-07-31)

`js/leaderboard-ui.js` decides who renders in `visibleRecords()` (device ids) and `isHiddenRow()`
(names), both read by `currentBody()`. Nothing here ever deletes anything (THE LAW rule 5) — a
hidden record's plays stay in Firebase and still show on that device's own My Stats; only the
shared leaderboard omits the row.

- **`HIDDEN_PREFIX`** — deviceId prefixes, for specific old records already identified by hand
  (`'4392d978'`, `'f8ad1b82'`, `'zzz-prev'`). Only hides devices that existed when the prefix was
  added; a fresh test pass (new browser/incognito/profile) mints a new deviceId every time, so this
  list does not stay ahead of new testing on its own.
- **`HIDDEN_NAMES` + `HIDDEN_NAME_PREFIX`** — profile names (case-insensitive, trimmed), for
  durable use: a name stays hidden no matter how many new device ids use it. The name rule was an
  exact set holding only `zzztest` until 2026-07-31, which is why **"Tester" kept coming back** —
  only the single device `4392d978` was hidden, so the same name in any new browser was a brand-new
  visible row. Matt: *"No test accounts should ever appear on the leaderboard."* It is now a PREFIX
  rule — any name starting with **`test`** (Test, Tester, test1, testing) or **`zzz`**, plus the
  exact names `qa`, `dev`, `demo`, `preview`, `prueba`. **The standing QA name is still `zzztest`**;
  reusing one name also makes `players-agg.js` collapse repeat test runs into one group rather than
  piling up rows. The rule is deliberately blunt — a real player is not called "Testxyz" — but it is
  a prefix, not a substring, so "Contest" and "Tess" are safe. Regression cases (both directions)
  are in `test-leaderboard-rank.mjs`'s "who is allowed on the board" block, which MIRRORS
  `isHiddenRow()`; keep the two in step.
- **Nameless devices are hidden too, as of 2026-07-31** — see "Nameless devices" below, which
  supersedes the 2026-07-30 entry in "Sync health". This is only safe because `js/name-gate.js`
  now makes a nameless device impossible to create; do not carry one change without the other.

If a new stray test/debug record turns up by device id instead (e.g. found via
`node backups/rtdb-backup.mjs` + a manual grep, the way "Zed99" and the `TestPlayer`/`Tester`/`TP`/
`You` records were found on 2026-07-29), add its id to `HIDDEN_PREFIX` rather than guessing a name
match — a name-only fix would miss it if the record used a different name.

### Nameless devices — the gate, and why hiding them is not rule 1 again (2026-07-31)

**This supersedes "Fixed (2026-07-30)" under "Sync health" below.** Both halves are load-bearing;
read them as one change.

Matt, seeing ~20 "Unnamed player" rows the day after the 07-30 fix shipped: *"The app should not be
playable without entering a name."*

What produced those rows: **the first-run gate only ever covered the hub.** Every game also ships a
standalone page (`<game>/index.html`, precached in `sw.js` and reachable by direct URL), plus
Monopoly Deal and Parchís as whole classic-script apps — all ungated. A device could play there
indefinitely, record real plays, and mirror them to `players/<statsId>` with `profile.name: ''`
(`stats-net.js` writes whatever the profile holds, and `hub.js` syncs on load *before* the gate is
answered, so even closing the tab on the gate left a permanent nameless record). `players-agg.js`
cannot prove two nameless, code-less devices are one person, so each stayed its own row forever —
20 devices, 20 rows, unmergeable.

The fix is a pair:

1. **`js/name-gate.js`** (+ `css/name-gate.css`, `js/name-gate-auto.js`) — the gate moved OUT of
   `hub.js` and became the one shared implementation, called by every entry point. `hub.js`'s
   `initFirstRun()` is now just a call site; each module game's standalone page does
   `await requireName()` **before** `init()`, so the game never mounts; the two classic-script apps
   load `name-gate-auto.js` as a deferred module, which overlays them (they boot but cannot be
   played). The overlay has no close button, no scrim handler and no Escape — that is the point.
   Offline it accepts the name locally and claims it on a later sync, exactly as the hub's gate
   always behaved.
2. **`isHiddenRow()`** in `leaderboard-ui.js` stops rendering nameless (and `'You'`-named) rows.

**Why this is not the stored-but-invisible bug again.** A nameless record can no longer be
*created*, so every one that exists is pre-gate history — and its owner is gated into naming
themselves the next time they open anything. The instant they do, `players-agg.js`'s identity graph
attaches that same untouched record to their real row and every play reappears on the board.
Nothing is deleted, nothing stops syncing, and in the meantime the owner still sees all of it on
their own My Stats. The 07-30 fix was right *for a world where a nameless device was reachable*;
this closes that world instead. `test-leaderboard-rank.mjs` asserts the round trip (hidden while
nameless → every play on the board, in the right person's row, once named).

**If you ever remove the gate, restore the 07-30 behaviour first** — hiding nameless rows without
it is the exact rule 1 violation `59f8e9b` fixed.

Two caveats worth knowing:

- **Parchís is built from the sibling `../Parchís/` folder** (root CLAUDE.md), which is not in this
  repo. Its gate `<script>` tag lives in the built `parchis/index.html` here and **will be lost on
  the next build** unless the same line is added to the source.
- **Monopoly Deal's nested SW is the exclusive controller of its page's fetches**, so the gate's
  root-scope module graph is listed in `business-deal/sw.js`'s own `ASSETS` (same reasoning as its
  in-scope `game-stats-global.js` copy, ARCH-REVIEW.md S4-1) — otherwise the gate would silently
  fail to load offline and BD would be ungated there.

---

## `GAME_META` is a registry, and a missing row zeroes a whole game (2026-08-11)

`js/leaderboard-ui.js`'s `GAME_META` is the leaderboard's own list of games, **separate from
`js/hub.js`'s `GAMES` and from `js/game-stats-ui.js`'s `TABS`**, keyed by STATS id. `ALL_IDS`,
`COMP_IDS`, `SOLO_IDS`, `winsOf()`, `playedOf()`, `labelOf()` and the whole By Game segment are all
derived from it. A game with no row here is not *partly* on the leaderboard — it is worth **zero
wins and zero plays** on every screen of it, while its own My Stats page shows the real numbers.

That is the worst shape a bug can take under THE LAW rule 1: nothing is lost, everything syncs, and
the player is simply told their history does not count. **Yahtzee shipped with no row** and stayed
that way until the first real report to arrive through Report a bug:

> "MY WINS ARE NOT COUNTING TO MY TOTAL WINS ON LEADERBOARD" — 14 wins in 15 Yahtzee matches,
> local store correct, `syncHealth` `ok` at 266 plays local and remote, My Stats showing all of it.

Believing him took thirty seconds (rule 8) and the fix was one line. Finding it needed the report,
because **no other surface shows the absence** — not the game, not My Stats, not sync health.
`players-agg.test.mjs`'s second `[KNOWN-BUG PROBE]` block now closes that: it reads the stats ids
out of `game-stats.js` and fails unless each one has a `GAME_META` row, or sits in `OFF_THE_BOARD`
with a reason — and an `OFF_THE_BOARD` entry must still be `devOnly` in `js/hub.js`, so releasing a
game that is off the board fails the suite the same day (that is the check Skeeball and Pinball
currently rest on). It was verified born red against the missing Yahtzee row.

One thing the fix does NOT change: Yahtzee records its `byDiff` bucket as `ai` (or `mp`), a MODE,
because the game has no difficulty setting at all. `tierOf('ai')` is `null`, so those wins count in
full under the **All** filter (the default, and where the cross-game number lives) and do not appear
under Easy/Medium/Hard/Expert. That is the documented behaviour for unrankable buckets, and it is
the honest one — mapping `ai` onto a tier would invent a difficulty claim the game never made.

## The leaderboard's rating model (2026-07-22)

**2026-07-23 redesign (wins-only display, rating retired from the UI):** Matt's call, third
mockup round approved same day (`HANDOFF-LEADERBOARD-REDESIGN.md`, now superseded by this section).
The Leaderboard overlay no longer shows W-L, win rate, or the 0-100 rating anywhere — every screen
leads with ONE big **wins** number (or a solo game's own metric: obstacles/longest/solved), because
Matt (the app's own builder) couldn't read the old four-table-per-game layout. **Losses and full
records stay visible on My Stats** (`game-stats-ui.js`) — that screen is what satisfies THE LAW
rule 1 for the raw breakdown now; the leaderboard is the bragging wall, not the ledger.

**The rating model is retired from display, not from the repo.** `js/leaderboard-rank.js` (Wilson
scoring, difficulty weighting, `rankPlayers`/`ratePlayer`/`soloRating`) and `test-leaderboard-rank.mjs`
are untouched and still green — kept in place for a possible future dedicated rating page. Only its
UI caller is gone. `js/leaderboard-ui.js` now imports just `bucketsOf`/`tierMix` from it, to sum wins
and detect which tiers a player has played; **do not delete leaderboard-rank.js's rating exports as
"unused"** — they are intentionally dormant, not dead.

**Everything here is still a read-time DISPLAY TRANSFORM.** `gamehub.stats` and `players/<deviceId>`
are read-only to this feature — nothing is stored, migrated or normalized.

- **A draw is NOT a win** (Matt, 2026-07-28: "Tictactoe ties are being counted as wins. That's
  wrong."). `record()`/`bucketsOf()` in `js/leaderboard-rank.js` return the STORED `won` counter,
  clamped, and nothing more; the old rule derived `wins = played - losses`, which promoted every
  tie. **This reversed the previous "a draw counts as a win" design** — do not reinstate it, and
  do not treat the reconciliation argument it rested on (that W + L should equal Plays) as a
  constraint: plays now legitimately exceed wins + losses by the draw count. Most visible in Tic
  Tac Toe (Classic Pro is unbeatable by design, so it is draw-heavy and a stalemate streak read as
  a winning streak), but the rule was and is shared by every competitive game. **Draws are NOT
  given their own leaderboard number** (Matt's call, same day): they stay visible on My Stats,
  which already renders explicit W/L/T for Tic Tac Toe, Dots and Boxes and Boggle straight from
  each game's own sub-counter — that is the rule-1 surface for them. Second site, kept in step by
  hand: `ttVariantWins()` in `js/leaderboard-ui.js`, the Ultimate/Classic split on Tic Tac Toe's
  own leaderboard card, which reads `tt.<variant>.won` (the `tt` sub-counter stores `tied`
  explicitly, so nothing is derived there). **DISPLAY-only, as ever — no stored counter changed**,
  no migration, no recorder edit. **Solo games (Ball Run/Snake/Nuts &
  Bolts) are counted and labeled as RUNS, separately from wins — not folded into the wins number
  (Matt, 2026-07-28, HANDOFF-LB-SOLO-RUNS.md).** `winsAtTier()` itself is unchanged and still
  works generically across every game's `total`/`byDiff` shape (solo games populate it identically
  to competitive ones, `lost` just never touched); what changed is which game ids the CALLERS feed
  it. `js/leaderboard-ui.js` derives two lists from `ALL_IDS`: `COMP_IDS` (competitive games,
  drives the cross-game wins number, the By Player sort, and the win tiles) and `SOLO_IDS`
  (Ball Run/Snake/Nuts & Bolts/Hill Climb, summed via `runsAtTier()` into a separate "N runs" line on the
  same card, via `playsAtTier`). `SOLO` in `js/players-agg.js` is the single source of that game
  membership — both id lists are derived from it, never hardcoded a second time. The By Player
  list FILTER still stays on `ALL_IDS` (a solo-only player is still listed, showing 0 wins plus
  their runs — narrowing that filter would make a real player vanish, THE LAW rule 1). My Stats'
  overview (`game-stats-ui.js`'s `overviewTotals`) makes the same split: a third "Runs" tally,
  shown only when > 0. **This is a DISPLAY split only — no stored counter changed**, no migration,
  no new storage key, no recorder edit; `recordBallRun`/`recordSnake`/`recordNutsBolts` and every
  stored `won` counter are byte-identical before and after. Each solo game's own game page (By
  Game row, game detail screen, "who leads what" chips) is untouched and still ranks by its real
  metric (best obstacles / longest / solved) — the fix was confined to the cross-game number that
  let volume alone top the board. The bullet that used to stand here ("solo volume inflates win
  counts... trading precision for legibility") described the OLD, now-fixed behavior; do not
  revive it as a design goal.
- **Difficulty is a single-select FILTER, chosen from a DROPDOWN (2026-07-29, HANDOFF-LB-FILTER-
  SORT.md — the old 5-pill row is gone).** All (default), Beginner, Intermediate, Pro, Expert —
  shared between By Player and By Game and carried into a game's own page; resets to All every
  time the overlay opens (not persisted, D7). Ski-slope shapes (circle/square/diamond/
  double-diamond, `diffShapeSVG()` in leaderboard-ui.js) still carry the tier on each menu item,
  color is secondary (colorblind rule); the selected item is marked by `aria-checked` plus a
  trailing checkmark (`.lb-mitem.is-sel::after`), never by hue alone. **Legacy/unknown buckets
  (`tierOf()` returns null) count in All ONLY** and appear under no tier item — dropping them from
  All would be a rule 1 regression on exactly the data `foldLegacy` exists to preserve.
  `difficulty-tiers.js` itself is untouched.
- **Ball Run, Snake and Hill Climb are the places "wins at a tier" and "the game's own metric"
  diverge** — their leaderboard number is a BEST (`bestObstaclesByDiff`/`bestLenByDiff`/
  `bestDistanceByStage`), not a play count, so `leaderboard-ui.js` special-cases
  `brBestAt()`/`snBestAt()`/`hcBestAt()` for them. Hill Climb's per-tier bucket is keyed by STAGE
  id rather than a difficulty word, because its four stages ARE its difficulty axis (1:1, in unlock
  order — `HC_STAGES` in `js/game-stats.js`); every other game (including
  Nuts & Bolts — a solve always increments both `played` and `won` by exactly 1) uses the generic
  `winsAtTier()`/`gameMetricAt()` path.
- **Everyone with any recorded play at the selected filter is listed** (`plays > 0` at that tier;
  under All, any play at all) — the same visibility bar as the old rating-based board, now applied
  per-filter instead of once. A Beginner-only player must still be visible under the default (All).
- **Sort is now a SEPARATE dropdown, also anchored under its trigger (D4), with three orders**
  (2026-07-29, HANDOFF-LB-FILTER-SORT.md; replaces the old single fixed wins-desc order):

  | Sort | By Player order | Game board order |
  |---|---|---|
  | Alphabetical | name → wins desc → `updatedAt` desc | name → this game's metric desc → `updatedAt` desc |
  | Games Played | `playedOf` desc → wins desc → `updatedAt` desc | plays desc → metric desc → `updatedAt` desc |
  | Wins (= the game's own metric on a board) | wins desc → **`playedOf` asc** (fewer plays wins ties) → `updatedAt` desc | untouched from before this redesign: Tic Tac Toe's ultimate→classic→recency; every other game's metric→plays→recency |

  By Player's `playedOf`/`winsOf` are thin wrappers (`playsAtTier`/`winsAtTier` over
  `ALL_IDS`/`COMP_IDS` respectively — see the solo-runs paragraph above for why they stay two
  different id lists). **Sort choice PERSISTS** (`gamehub.lb.sort.v1`, `{version,sort,updatedAt}`,
  a THE-LAW-rule-2-preference same class as favorites/theme/language — D6), unlike the difficulty
  filter. **By Game's top-level tab has no sort control at all** (D3) — it stays alphabetical by
  title, as it always has; a game's own drill-in board gets both filter AND sort, the third sort
  option labeled by that game's own metric (`unitKeyOf(id)` → the matching `lb_sort_*` string).
  Tic Tac Toe's and Snake's two-number split cards (`ttCardHTML`/`snCardHTML`) are left
  structurally alone — no big/small swap — but Alphabetical/Games Played still reorder them.
- **The card itself is two rows now** (`playerCardHTML`, replacing the old three-ish stack): row 1
  is rank/avatar/name/the metric CURRENTLY SORTED BY (large, its unit stacked underneath); row 2 is
  the tier tiles (unchanged — always wins-per-tier, never follows the sort) plus the OTHER metric,
  small and muted, right-aligned. The old **`N games · N runs` line is off this screen** (Matt,
  2026-07-29: "just don't show it on this screen") — `metaLine()` and `runsAtTier()` are UNUSED but
  left in place per THE LAW rule 9's spirit (nothing deleted, just not rendered; the helper is
  there if it's ever wanted back). The card's "played" number (`playedOf`) counts **all** plays,
  competitive + solo runs — this does **not** revive the pre-`HANDOFF-LB-SOLO-RUNS.md` behavior of
  folding runs into WINS; `winsOf` stays competitive-only, unchanged. The player detail screen
  (no sort control there) always leads with wins (D1's default) and shows a single `N played`
  meta line (`lb_played_count`) in `metaLine`'s place.

**`js/game-art.js`** is the single source for every hub-launcher tile's inline SVG art, keyed by the
HUB registry id (`GAMES[].id]` — moved out of `js/hub.js`'s GAMES array so the Leaderboard's By Game
screen can show the SAME real tile art as a thumbnail without importing hub.js itself (a
side-effectful module: it boots stats sync and first-run gates on import). `hub.js` now reads
`GAME_ART[id]`; `leaderboard-ui.js` and `game-stats-ui.js` both read `GAME_ART[hubIdOf(statsId)]`
via `hubIdOf`/`unitKeyOf`, which live in `game-stats-ui.js` (single source since the 2026-07-24
game-list redesign below) and are imported by `leaderboard-ui.js` — verify the underlying `HUB_ID`
map against the real `GAMES` registry if either changes ids.

**The unified chrome band spec** (hub top bar, Leaderboard overlay, My Stats overlay — Matt called
out that the three banners were clearly built independently): three CSS custom properties in
`css/hub.css`'s `:root`, consumed by all three (with a literal fallback, since Escoba-style
standalone pages never open the overlays but defensive costs nothing):
`--gh-band-title: 44px` (17px/600-weight title, `.hub-top-info` / `.lb-top-row` / `.gs-top-row` —
note the overlay's OUTER `.lb-top`/`.gs-top` only adds safe-area clearance and horizontal padding;
the measured 44px band is the INNER `-row` wrapper, mirroring how `.hub-top-info` is the measured
band inside the outer `.hub-top`), `--gh-band-controls: 36px` (the segmented pills — `.hub-top-right`,
`.lb-segs`), `--gh-band-filter: 34px` (the difficulty pill row, `.lb-pills`). If a future band
measures wrong, check whether the container still carries its OWN vertical padding on top of the
shared `min-height` — that was the bug the first draft of this redesign shipped with.

UI conventions worth keeping: two fixed segments (By Player / By Game, renamed from Standings/Games),
never the old plays-sorted tab strip — it re-ordered itself between visits and anything past the
fourth tab was undiscoverable. Games are alphabetical by title, matching the launcher. By Game's
number/unit stack is FIXED-WIDTH and right-aligned (`min-width:56px` on `.lb-gnum`) — the old
free-form gray metric text made the column ragged. "Who leads what" chips (`textureHTML`, unchanged
maths) are now tinted (amber/teal/blue rotation, `.lb-chip-a/b/c`) rather than plain cards, and are
filter-INDEPENDENT (several — Chinchón closes, Boggle words — have no per-tier storage at all).

### My Stats and the leaderboard's player page — the shared game-list drill-down (2026-07-24)

HANDOFF-FB2-STATS-NAV.md. Matt: the old My Stats 13-tab strip was "useless… difficult
understanding what info is even being shown," and the leaderboard's player detail was "a single,
scrollable screen, with every game and stat listed. This is very very bad." Both are now the SAME
structure the leaderboard's By Game screen already used: an identity header + a list (one row per
game WITH recorded plays — art thumbnail, title, a headline stat, chevron), alphabetical by
displayed title; tapping a row drills into that game's own tailored `screenFor` screen with a
`← Games` back row. Games with zero plays are omitted from the list (never shown as a padded
zero-row); nothing about the per-game `screenFor` screens themselves changed.

- **`gameListHTML(games)`, exported from `js/game-stats-ui.js`, is the ONE list builder both
  overlays use** — fed either the local viewer's `st.games` (My Stats) or an aggregated player's
  `games` (`players-agg.js`, the leaderboard's player detail), since both are the same canonical
  shape. `leaderboard-ui.js` imports it aliased as `gsGameListHTML` — **do not import it as a bare
  `gameListHTML`**, that name collides with leaderboard-ui.js's own pre-existing top-level By Game
  list builder (a real bug hit once during this milestone: the naming collision threw a
  module-load `SyntaxError` that silently broke every button opening the overlay, with no console
  error surfaced by the hub's own click handlers — always smoke-test a dynamic import in the
  browser console directly after touching either file's imports).
- **`hubIdOf`/`unitKeyOf` now live in `game-stats-ui.js`** (moved out of `leaderboard-ui.js`,
  which used to keep its own identical copy) — single source for the stats-id→hub-id art lookup
  and the per-game headline unit (`lb_unit_obstacles`/`lb_unit_longest`/`lb_unit_solved`, default
  `lb_unit_wins`), so My Stats and the leaderboard can never disagree on a game's thumbnail or
  unit label again.
- **My Stats' overview** (`overviewHTML`/`overviewTotals` in `game-stats-ui.js`): profile emoji +
  name, then two headline tallies — total games played and total wins — summed across every
  visible game via `record()` (imported from `js/leaderboard-rank.js`, the same maths the
  leaderboard uses: `wins` is the stored `won` counter, and a draw is NOT a win). Solo games
  (Ball Run/Snake/Nuts & Bolts/Hill Climb) count toward `plays` the same as competitive games, but their
  wins are shown as a separate third "Runs" tally rather than folded in (see "The leaderboard's
  rating model" above).
- **A game's presence in the list uses its OWN empty-state gate**, not a generic `total.played`
  check (`hasPlays()` in `game-stats-ui.js` mirrors each `screenFor` variant's own condition:
  Connect 4 sums `c4Totals(grid)`, Ball Run also checks the legacy-meters archive, Snake/Nuts &
  Bolts read their own sub-counter) — THE LAW rule 1: the visibility bar for "does this game show
  up" must match the bar each screen already uses to decide its own empty state, or a game could
  vanish from the list while its screen would still render real numbers if opened directly.
- **Leaderboard's player detail** (`playerDetail` in `leaderboard-ui.js`) gained its own drill
  state, `_playerGame` — independent of the top-level By Game drill's `_game`, since a viewer can
  be inside a player's detail AND that player's own game screen at once. `Esc` backs out
  game-first, then player, then closes, mirroring the top-level game/close order.
- Both overlays already inject the same `#gs-css` stylesheet (`ensureStatsCss` re-injection,
  id-guarded), so the new `.gs-glist`/`.gs-grow` list markup and `.gs-overview` header render
  identically in both, no new CSS mechanism needed. Light/dark: no new `:root.gh-dark` overrides
  were needed either — every new rule follows the existing `var(--hub-surface, #fff)`-style
  fallback pattern the rest of `#gs-css` already uses.

### Overlay scrolling — why the two overlays felt "glitchy" (2026-08-02)

Matt: *"sluggish and glitchy (esp. with scrolling on various screens)."* The service-worker half of
that report is in the root `CLAUDE.md`; this is the DOM half. Three separate causes, all in the
shared overlays, all display-only (no stored field, counter or key was touched):

1. **Scroll chaining.** `.lb-overlay` and `.gs-overlay` are `position:fixed; inset:0;
   overflow-y:auto` — a full-screen scroll container sitting on top of a scrollable hub, which is
   exactly the case a browser chains by default. A flick that reached either end kept going and
   scrolled the launcher underneath, so the board rubber-banded, the page behind moved, and closing
   the overlay landed somewhere the viewer never chose. **`overscroll-behavior: contain`** now sits
   on both, plus `.gh-overlay`/`.gh-modal` in `css/ui.css` (every game's how-to-play and win/lose
   modal), `.hub-confirm`, and `.ng-root`. The repo had exactly ONE `overscroll-behavior` before
   this (Monopoly Deal's) — when adding a new overlay, it is not optional.
2. **The live subscription rebuilt the whole board on every remote push.** `openLeaderboard()`
   subscribes with `watchPlayers` to the ENTIRE `players/` node, and `stats-net.js` re-mirrors each
   device on every hub load, tab-hide, return-to-launcher and reconnect — so in a family with
   several devices the callback fires often, and MOST of those pushes change nothing this screen
   renders. Each one used to `innerHTML`-replace the entire list. Mid-scroll that destroys and
   recreates every node under the reader's finger: momentum scrolling breaks and a tap in flight
   lands on nothing. `rerender()` now compares against the last rendered markup and does nothing at
   all when it matches.
3. **Scroll position was lost on the pushes that DID change something.** `rerender({ fromData:
   true })` (the `watchPlayers` callback, and only it) preserves `_host.scrollTop` across the swap —
   the container survives, but the browser clamps scrollTop while the replaced content momentarily
   has zero height, which is what threw the viewer back to the top of a long board. Navigation
   re-renders deliberately still start at the top; that is what drilling into a screen should do.

**`window.addEventListener('resize', …)` is a scroll-jank bug on mobile, and `js/viewport.js` now
exists so no game writes it again.** Eleven games each subscribed raw and re-laid-out the board
SYNCHRONOUSLY in the handler. On a desktop that fires a handful of times while you drag a window
edge; on a phone the browser fires `resize` continuously while the URL bar slides in and out — which
is to say, on essentially every scroll — so each of those games ran a full board re-layout on the
main thread several times per frame while the user was mid-scroll. Dominoes additionally subscribed
to `visualViewport`'s own resize, which fires on every frame of that animation and on every keyboard
show/hide. `onViewportResize(cb)` folds all three event sources into one callback, coalesces it to at
most once per animation frame, and skips it entirely when neither dimension actually changed. It is
semantically transparent because every one of these handlers is an idempotent "re-fit to whatever the
size is now" — running it once with the settled size is strictly better than five times with
intermediate ones. Converted: Chinchón, Yahtzee, Escoba, Mancala, Dominoes, Ball Run, Pool, poolv2,
Nuts & Bolts, Uno, and Hill Climb. The unsubscribe it returns must be called in `destroy()`.

**This rule, and the two below it, are now ENFORCED by `test-game-conventions.mjs`, and the reason
is worth knowing.** Hill Climb was written in a parallel session and shipped the raw-resize pattern
on the same day it was removed from every other game — not through carelessness, but because this
file only auto-loads for a session working inside `js/`. A session creating `newgame/` loads the
root `CLAUDE.md` and its own (nonexistent) game file, and nothing else. So the rule now lives in
BOTH places: a "USE WHAT EXISTS" table in the always-loaded root file, and a test that fails.
**When you change a convention here, update that table too** — it is the copy a new-game session
will actually read.

**A non-passive `touchmove` on `document` is a page-wide tax, not a local guard.** Snake installed
one to stop a D-pad drag panning the page. It works, but it tells the browser
that any touch scroll ANYWHERE might be cancelled, so compositor-thread scrolling is off for the
whole page, on every screen, for as long as the game is mounted. It is now bound to the game's
own root element instead, which loses no coverage (a `touchmove` is dispatched at the element the
touch STARTED on and bubbles from there). See `snake/CLAUDE.md` for the full note. If a future game
needs a scroll guard, scope it to the game root — never to `document`.

### Sync health, and why a leaderboard absence is not proof of anything (2026-07-22)

A player asked where their game history had gone: they were not on the leaderboard. The leaderboard
was correct. Their data was intact on their own device and had **never reached Firebase at all**.

`syncMyStats()` ended in a bare `catch { return false; }`, and `hub.js`'s `_syncStats()` called it
without `await` inside another bare `catch {}`. So a device that could not mirror - offline, blocked
anonymous auth, private browsing, a rejected write - failed **silently, every time, forever**. Nothing
reported it: not the device, not the hub, not the leaderboard. The first signal anyone got was a
person asking why they were missing. That is THE LAW rule 6 violated in the single place it matters
most, and rule 1 as a consequence (history that reaches no screen reads as deleted).

Now, per rule 6's own reference pattern:

- **Every attempt is recorded locally** in `gamehub.syncHealth.v1`, readable via `syncHealth()`:
  `{ ok, lastOkAt, lastErrAt, lastErr, localPlays, remotePlays }`. A silently-failing device can be
  diagnosed **from that device** instead of by noticing a gap on someone else's board.
- **Every failure path logs loudly** (`console.error`) and names the cost: how many local plays are
  not mirrored, and that the history is still safe locally.
- **The write is verified by a fresh re-read.** A resolved promise is not proof the data landed; the
  check compares total plays that landed against total plays stored, and fails the sync if short.
- **Retry on reconnect.** `hub.js` syncs on load, tab-hide, return-to-launcher, and now the `online`
  event. `syncMyStats` mirrors the whole store every time, so any retry repairs a missed period.

**Diagnosing "my history is missing" (do this before suspecting the leaderboard):** on the player's
own device, open the hub and run `JSON.parse(localStorage['gamehub.syncHealth.v1'])`. `ok:false`, or
`localPlays` well above `remotePlays`, means the data is fine locally and the SYNC is the problem.
`gamehub.stats` is the source of truth and is never touched by any of this.

**Warning, from an incident (2026-07-24, HANDOFF-FB2-STATS-NAV.md verification):** `hub.js` calls
`_syncStats()` unconditionally on every page load, with no gate for "this is a test/preview
browser" - there isn't one. Seeding fake `gamehub.stats`/`gamehub.profile` into `localStorage` to
eyeball a UI change (My Stats, the leaderboard, anything that reads stats) and then loading the
page **mirrors that fake data straight to the real production `players/<deviceId>` node** the
instant the page runs, exactly like a real device's play. This happened once: a fake profile named
"Matt" with invented stats synced and briefly rode the `matt`→`mattyice` name-alias union before
being overwritten by a follow-up sync under a harmless name; it was caught, backed up
(`node backups/rtdb-backup.mjs`), and removed by hand (zero the local store, reload, confirm the
remote node re-mirrors as empty, then delete the now-empty node with a name+play-count guard,
verifying with `players-agg.js` that no other player's row moved). **Never seed fake player stats
into a browser that can reach the real Firebase config** (`js/firebase-config.js`'s
`databaseURL`, which is this hub's only backend - there is no separate dev/staging project).
Seed only with sync unreachable (offline, or Firebase blocked in devtools) or inside a headless
test (`node run-all-tests.mjs`'s suites construct `gamehub.stats`-shaped fixtures directly in
Node, never through a browser that can reach the network).

**Fixed (2026-07-30), then SUPERSEDED (2026-07-31)** — read this entry together with "Nameless
devices" above, which reverses the display half of it. The diagnosis below is still correct and is
why the gate now exists; what changed is that a nameless device is no longer reachable, so the
leaderboard hides these rows again instead of labelling them:

the leaderboard used to list only players with a profile name
(`(g.name || '').trim()` gate in `currentBody()`, predating the 2026-07-22 overhaul). A device
that recorded real plays (e.g. Dots and Boxes wins vs the computer) without ever setting a
profile name was mirrored to Firebase but appeared on no screen at all - stored-but-invisible,
rule 1, and the reported symptom was literally "I won a bunch of times but it's not on the
leaderboard." `currentBody()` no longer filters on name presence (only `HIDDEN_NAMES`, the
test/debug list, still excludes a row); `rankName()` now returns the `lb_unnamed_player`
string ("Unnamed player" / "Jugador sin nombre") for a blank name instead of `''`, so a nameless
device's row renders with a `?` avatar and that label rather than being silently dropped by the
By Player and By Game lists (`currentBody()`'s `list` feeds both). **Display-time fix only** - no
stored field changed, no migration, `players-agg.js` untouched; the moment that device's owner
sets a real profile name, their existing rows already carry the same identity key and just relabel
themselves next render. The device still keeps whatever it recorded under `HIDDEN_NAMES` if a
name is later set to one of those (e.g. `zzztest`).

### Name aliases, and why a rename in Firebase does not stick (2026-07-31)

`players-agg.js` has two hand-maintained maps for a person whose devices disagree about their name:

- **`NAME_ALIAS`** (lowercased → lowercased) folds alternate spellings into one identity, used by
  `nameOf()` so the identity graph unions those devices. Currently `matt → mattyice`,
  `lill → lili`.
- **`DISPLAY_NAME`** (canonical lowercased → preferred label) pins what the merged row is CALLED.
  Grouping alone is not enough: `grp.name` takes the most recently active device's raw name, so a
  merged row would otherwise flip between spellings depending on which phone synced last. Currently
  `lili → 'Lili'`. A name with no entry displays exactly as the device wrote it, which is why
  `mattyice` has none — its behaviour is unchanged.

**Lili is the reason this section exists.** She appeared twice, "Lili" and "Lill". It was corrected
once by editing the record in Firebase, and it came back within days. That is not a fluke and it
will happen to any server-side rename: **`stats-net.js`'s `syncMyStats()` mirrors each device's OWN
`localStorage` profile up on every hub load, tab-hide, return-to-launcher and reconnect.** The phone
still spelling it "Lill" simply rewrote `players/<id>/profile.name` back to "Lill" the next time it
opened the app. The remote record is a MIRROR, not a master — nothing server-side survives contact
with the device that owns it.

So there are exactly three durable fixes, and only the first needs no access to her phone:

1. **Alias it here** (what was done) — read-time, applied on every render, immune to resync.
2. **Rename the profile ON the device** (profile page), so the device stops pushing the old spelling.
3. **Link both devices to one player code**, which makes the name irrelevant to grouping entirely.

Regression cases (both sync orderings, case/whitespace, and "Lilian" NOT being swallowed) are in
`players-agg.test.mjs`. When adding an alias, add its test alongside — a wrong alias silently merges
two real people, which is the one failure mode here that loses information.

### The Ana/Natalia correction (2026-07-23) — what was done, and how certain it actually is

Ana and Natalia shared one physical device (`players/1f75ff86-...`, code `89N3N`, "Anita Bonita")
for about a week before Natalia got her own phone. `js/game-stats.js` stores only running per-device
totals, so every play either of them made landed in the same counters and **there is no per-play log
to split them by.** Separately `usernames/natalia` held `{ code: "89N3N" }` — Ana's code — which is
why Natalia's brand-new phone answered "Taken. Use that code instead." the first time she tried to
claim her own name.

**Root cause of the stale registry entry** — `js/hub.js`'s first-run "fr-save" handler called
`claimUsername(name, code, '')`, a hardcoded empty *previous name*, so the gate could register a new
name but could never release the one it replaced. It only fired when a device's local profile was
reset and re-claimed through the hub's gate rather than the profile page (`profile/index.html`'s
rename flow always passed the real previous name and released correctly). **Fixed in `cdefd6c`
(2026-07-24)**, which started passing `cur.name || ''`; that fix moved with the gate into
`js/name-gate.js` (2026-07-31) and is still there — an earlier version of this paragraph said "still
unfixed" and was stale. `js/stats-net.js` exports `adminReleaseUsername(name)` for repairing a
registry entry already stranded by the old behaviour; nothing in the UI calls it.

**What was actually written** (`fix-natalia-record.mjs`, applied and verified):
`players/660e7098-85cf-4293-96ad-888dabc50773` = Natalia, player code **`C5PXN`**, holding 8 plays;
`usernames/natalia` repointed to `C5PXN`; the dev/test device `f8ad1b82-...` had `profile.name`
cleared so its 4 plays stop showing as a "test" row on the board (the old name is archived to
`profile.nameArchived`, **not** destroyed — a new, inert field, additive per rule 5).

**Ana was deliberately not touched.** An earlier version of this plan subtracted Natalia's share from
Ana's counters; Matt reversed it. So this was a pure ADDITION — no counter anywhere was decremented,
which is why rules 2 and 4 hold by construction and there was never a moment where a play existed
nowhere. **The accepted consequence: those 8 plays are now counted twice family-wide**, once inside
Ana's blended row and once in Natalia's. That is a known, deliberate tradeoff, not an error to
"fix" — and it is the strongest argument for the profile-code-keyed stats rework below.

**How certain the split is — do not overstate this.** Only two of the eight have real evidence:

| Attribution | Basis |
|---|---|
| Escoba 1 → Natalia | `escobaSettings.humanName: "Natalia"` and the in-progress `escobaSave` both name her (verified in that device's own Device Details report) |
| Chinchón 2 → Ana (left in place) | `chinchonSettings.humanName: "Ana"` in the same report |
| Boggle 1, Dots and Boxes 1, Filler 2, Mancala 1, Nuts & Bolts 1, Parchís 1 → Natalia | **No name tag exists.** Those games' settings keys carry no `humanName` field at all. Assigned by Matt's standing date rule (any play on that device between Natalia's 2026-07-18 username claim and the morning of 2026-07-22 is hers). **This is a policy decision, not a recovered fact.** |

Even the two "firm" tags are the *last configured* value for that game, not per-play provenance.
Two further gaps are known and unresolved, and any future work here must not paper over them:
**Ball Run 8** was left with Ana on timing alone, with no firmer evidence; and **Connect Four shows
zero plays ever** on every device tied to Ana despite the challenge system requiring real Connect
Four losses by design — most likely `connect-four/js/ui.js`'s `_statsDisqualified` flag excluded
them, which means **Ana's true lifetime total is higher than any counter can show.** Do not present
any total built on this ledger as complete.

**Prevention: done, same day.** See the next section — the store is now keyed by the active
profile's player code, and the `claimUsername(name, code, '')` release bug above is fixed.

### Whose stats are these — the per-player store split (2026-07-23)

The structural fix for the incident above. The full rationale lives in `js/game-stats.js`'s
"WHOSE stats these are" block; this is the summary and the rules a future session must not break.

**One rule makes the whole change free for every device that already exists:** the FIRST player code
ever seen on a device becomes its **owner** and keeps `gamehub.stats` and the `players/<deviceId>`
node, exactly as before. **Nothing is migrated, copied, moved or re-keyed.** There is no migration to
get wrong and no window where history is anywhere but where it already was, so THE LAW rules 1, 3 and
5 hold *by construction* rather than by careful handling — which, given rule 7's history in this repo,
was the whole point of choosing this shape over "copy the store into a new key".

| Concept | Where |
|---|---|
| `gamehub.stats` | unchanged: the OWNER's store on that device (and the only store on a device with no player code) |
| `gamehub.stats.p.<CODE>` | a second (third, …) player's own store on the same device |
| `gamehub.stats.owner.v1` | `{ code, name, at }` — who owns the device's original store. Claimed once, by the first code seen |
| `gamehub.stats.forks.v1` | append-only log of every additional player who has recorded here (`{code, at, prevKey, prevPlays}`). Diagnostic only; never pruned |
| `statsKey()` / `statsId()` | the resolved local key and the `players/<id>` sync node. `statsId()` is `deviceId()` for the owner, `<deviceId>-<CODE>` for anyone else |

- **No game's `recordX()` call site changed.** Every game already went through `loadStats()`/`persist()`,
  so the resolution happens entirely inside `game-stats.js`. Keep it that way: a game that reaches for
  a storage key directly re-opens exactly the hole this closed.
- **`deviceId()` is still the multiplayer identity** (`net.js` rooms, `recordHeadToHead` opponents) —
  that is genuinely per-device. Only the STATS node moved to `statsId()`. Callers updated:
  `stats-net.js`, `game-stats-ui.js`, `leaderboard-ui.js`, `device-report.js`.
- **The device-wide legacy stores (`chinchon-stats`, `bd-stats`) belong to the owner and are never
  folded into a forked store** — that would hand a second player the first player's history, the exact
  blending this prevents. `latchLegacyGuards`/`latchChinchonSeed` set the fold-once guards without
  folding. The legacy keys themselves are untouched (rule 5).
- **`js/game-stats-global.js` (and its verbatim-after-header BD copy (enforced by `test-recorder-contract.mjs`)) resolves the same key**, read-only: it
  never claims ownership, because it is a secondary writer. When no owner is recorded it uses the
  device-wide store, which is what the ES-module recorder does at the moment it claims — so the two
  always agree. This is a fourth must-stay-synced point between the two recorders.
- **`js/hub.js`'s first-run gate** reuses the owner's code when the name typed matches the owner's own
  name (the same person setting up again after losing their profile — minting a new code would fork
  them from their own history) and mints a fresh one otherwise (a different name is a different
  person). It also now passes the real previous name to `claimUsername`.

**Known gap, stated honestly:** if the SAME person loses their profile and is issued a brand-new code
under a DIFFERENT name, they fork away from their own history. The old store is untouched on disk and
the old node untouched in Firebase, and `players-agg.js` unions devices by name as well as by code, so
My Stats and the leaderboard still show everything whenever the device is online; offline, the local
view would show only the new store. Closing it completely means asking the player who they are, which
is a product decision, not a storage one.

`test-stats-identity.mjs` is the regression suite, and its rule 7 fixture is the real, unedited store
read out of `players/1f75ff86-...` — the actual device the incident happened on.

### Head-to-head capture

`recordHeadToHead(gameId, opponent, won)` (`js/game-stats.js`) writes a top-level
`h2h: { [gameId]: { [opponentDeviceId]: { name, w, l } } }` key. It was **capture only** from
2026-07-22 to 2026-08-11, deliberately: the opponent's identity only exists while the multiplayer
room is live, so it had to be stored long before there was a screen for it. Chinchón and Escoba both
knew exactly who they had just played (`_mpNewState` accepted the room participant as a parameter and
then *discarded* it) and threw it away at match end, so every MP match played before 2026-07-22 is
permanently unrecoverable. Both now store the roster on `this.mp.opps`, refresh it from the live room
in `_mpOnRoomUpdate` (the restore/rejoin path starts with none), and record **every** seat in
`_commitStats`. New key, additive counters, no migration — rules 2 and 5 hold by construction, and
`stats-net.js` mirrors `gamehub.stats` wholesale so it syncs with no change.

### Multiplayer on the leaderboard: on the GAME'S page, per game (2026-08-11)

**Shipped wrong first, corrected same day. Read this before adding anything h2h-shaped again.**

The first attempt put a "Multiplayer wins against" block on the PLAYER DETAIL screen, built from
`h2h` summed across every game. Matt: *"Why does it show the attached regardless of what game I
look at... I don't give a fuck about generic multiplayer wins or losses. I care about game specific
wins and losses."* He was right twice over: that screen is reached by drilling in from a game, so a
number that ignores which game you came from reads as a bug, and a cross-game head-to-head total is
not a fact anyone wanted. It was removed, along with `headToHeadRows()` and the `h2h`/`deviceIds`
aggregation in `players-agg.js` that existed only to feed it.

What replaced it is smaller and answers the actual question: **a fourth chip in the tier row on a
game's own board** (`mpTileHTML` in `js/leaderboard-ui.js`), reading `byDiff.mp.won` for THAT game.

- **It fixes a number that no longer added up.** `tierOf('mp')` is null, so a multiplayer win counts
  in a card's TOTAL but appears in none of its tier chips. On Escoba that meant "31 wins" over chips
  totalling 23, with the missing 8 explained nowhere — the documented unmapped-bucket convention,
  reading as an error on the one screen where the numbers sit side by side.
- **Labelled with a WORD, not a shape or a hue.** The tier chips' ski-slope shapes encode a 1-4
  scale multiplayer is deliberately not on, so borrowing one would claim a difficulty this bucket
  does not have. Colorblind-safe by construction for the same reason.
- **Not rendered at all for a game nobody has played online** (`anyMpPlays`), rather than adding a
  column of dashes to every card in every game. A player with no online plays in a game that HAS
  them gets the same em-dash an unplayed tier gets.
- **`h2h` is still WRITTEN** (`recordHeadToHead`) and is still the evidence the migration below
  depends on. Only its display and its aggregation were removed. Do not remove the writer.

### Extracting multiplayer plays back out of the AI bucket (2026-08-11)

**The `'mp'` bucket is what makes head-to-head legible, and Escoba was not using it** until
2026-08-11: `_commitStats` read `opp0.difficulty || 'normal'`, and a remote seat has no difficulty,
so every online Escoba match was filed as an Intermediate win over the AI. Fixing the writer only
helps future matches. Matt: *"Extract them and create a MP column for wins and losses."*

`splitEscobaMp()` in `js/game-stats.js` does it, once per store, from `loadStats()`. **The whole
question is what evidence exists**, and this is the part to understand before reusing the pattern:

- **`h2h` IS the evidence, and it is exact.** `recordHeadToHead` was called from the SAME
  `_commitStats` as the misfiled result, once per opponent, on every multiplayer match since h2h
  shipped. Escoba's multiplayer was two-seat throughout that period, so exactly one h2h increment
  exists per match and `sum(w)`/`sum(l)` across `h2h.escoba` IS that store's multiplayer record.
  Nothing is inferred, apportioned or estimated — every play moved is one the store can PROVE was
  multiplayer, which is the line rule 4 draws.
- **Matches older than h2h capture are NOT touched, and that is the honest answer, not a gap left
  open.** They left no trace on either device, so an Intermediate play that is really an old
  multiplayer play is indistinguishable from a genuine one. They stay in `normal`, fully visible,
  exactly where they have always been — nothing is archived away, so rule 3's "still SHOWN"
  obligation is met by not moving them at all.
- **`total` is never touched.** `byDiff` is a partition of it, so re-bucketing inside `byDiff`
  cannot change a play count, and `verifyEscobaMpSplit()` proves it by FRESH RE-READ after the
  write (rule 6) rather than trusting the object handed to `setItem`.
- **Every move is clamped** to what `normal` actually holds, so no counter can go negative if the
  two records ever disagree; the surplus is recorded as `esMpSplit.unresolved` and logged rather
  than invented somewhere else.
- **`escoba.esMpSplit`** archives the pre-migration numbers, the evidence used and anything
  unresolved, and is never pruned (rule 5) — the migration is reversible by hand from what it
  writes down.

**Rule 7 was satisfied with the real thing, not a fixture.** `test-stats-replay.mjs`'s scenario D
replays the ACTUAL escoba records of the only five devices in `players/` with any head-to-head
history, read out of Firebase on the day this shipped and pasted in unedited. All five fit inside
their own `normal` bucket with nothing unresolved: 32 matches recovered in total (5 + 15 + 9 + 2 + 1
across the five devices). Scenario E covers the edges no real device happens to exercise.

**Chinchón's `_commitStats` has the same `|| 'normal'` line**, so the same thing is true of its
online matches. Out of scope for that session; the pattern above ports directly if it is ever
wanted.

### Nothing should ever be able to be lost (2026-08-11)

Matt, on being told a multiplayer result could be dropped: *"Make it so that is impossible. Nothing
should ever be able to be lost. That's the rule."* Two layers, both in this milestone:

1. **Record at the moment of DECISION, from the engine.** `escoba/js/game.js`'s `checkMatchEnd()`
   fires a synchronous `onDecided` hook in the same statement that sets `winner`; `_bindGame` points
   it at `_commitStats`. There is no await, no `emit` and no abort check in between, so there is no
   gap left for a result to fall into. This replaced a UI-event-hook commit that sat several awaits
   and one human button-tap after the decision. **It required moving the escoba tally into the
   engine** (`player.matchEscobas`, folded in `scoreRound()` — i.e. before `checkMatchEnd`), because
   the UI's own accumulator was one round behind at exactly the moment the match was decided; a
   result recorded there would have been correct except for its escoba count. **If you move a
   game's recording earlier, check what else the recorder reads is ready that early.**
2. **A write that fails is QUEUED, not dropped.** `persistOrQueue()` parks the result in
   `gamehub.pendingResults.v1` — deliberately a tiny key separate from the stats blob, because the
   case it exists for is "the big object would not fit" — and `loadStats()` replays it.
   `drainPendingResults()` **does not clear the queue**; `clearPendingResults()` runs only after the
   write that absorbed it succeeded. Clearing at drain time looked equivalent and was not: a load
   whose own persist also fails (the likely case, since the queue exists because writes are failing)
   would drop the queue and the results with it — the exact loss the mechanism exists to prevent,
   reintroduced inside the fix. Caught by `test-stats-replay.mjs`'s scenario F, which drains once
   under a still-failing write before letting one through.

Wired into `recordEscoba` and `recordHeadToHead`. The queue is generic by shape
(`game`/`diff`/`won`/`extras`/`h2h`) — **any other recorder can be moved onto it** by routing its
failed `persist()` through `persistOrQueue()`, and should be.

---

---

## The shared profile — contract and consumers

The summary and the defaults-only rule live in the root `CLAUDE.md` ("The shared profile");
this is the full detail.

### Contract (`localStorage["gamehub.profile"]`)

```js
{ version:1, name, emoji, preferredColor:"yellow"|"blue"|"red"|"green"|null,
  opponents:[{name, emoji, skill:1|2|3}], message, messageAt, updatedAt }
```

- **The profile page is the primary writer; games stay read-only consumers.** One
  documented exception: `js/hub.js`'s first-run gate (name-or-code prompt) also calls
  `saveProfile()` to adopt a linked owner's name/emoji and mint/attach a `playerId` — this
  predates the "only the profile page writes it" wording in an earlier version of this file,
  which was simply stale. If you add another writer, update this line again rather than
  letting it drift back out of sync with the code.
- Readers **try/catch** and treat missing or malformed data as "no profile", falling back silently to
  built-in defaults. A profile must never crash a game.
- **Extend additively; never rename fields.** `skill` tolerates a future 4; the UI emits 1-3.
- **`message`/`messageAt` (HANDOFF-PROFILE-MESSAGE.md, 2026-07-28):** a free-text field (max 80
  chars), shown only on that player's own detail screen in the Leaderboard
  (`playerDetail()` in `js/leaderboard-ui.js`). `messageAt` is a separate epoch-ms edit
  stamp, NOT `rec.updatedAt` (the record's sync time) — `js/players-agg.js`'s merge picks the
  message from whichever device has the **newest `messageAt`**, so a device that merely
  re-syncs without touching the message (still `messageAt: 0`) can never blank out a message
  set elsewhere. This is a **preference, not history**: THE LAW rule 2's carve-out applies
  (same class as favorites/theme/language), so clearing the message to `''` with a newer
  `messageAt` is expected to win — no tombstone, no soft-delete.

### `js/profile-store.js`

ES module: `loadProfile()` returns a validated object or `null`; `saveProfile(p)` normalizes and stamps
`version`/`updatedAt`; `clearProfile()` deletes the key. In-hub module games `import` it directly;
single-file or non-ESM games (Monopoly Deal, Parchís) inline the small read-only subset, kept in sync
with this contract.

### Monopoly Deal's must-stay-synced duplicates

Monopoly Deal is global-JS, not ESM (a deliberate, bounded exception — see its games-table
row), so it can't `import` the shared modules directly. It carries three small inlined/copied
pieces that must be kept in sync by hand whenever their canonical source changes:

1. **Profile reader** (`business-deal/js/ui.js`, near the top): a read-only subset of
   `profile-store.js`'s `normalize()`. Already known to have drifted — its emoji fallback is
   `'🧑'` vs the canonical `'🙂'`/`'🤖'`, and it slices 4 opponents vs the contract's 3. Not
   worth fixing retroactively (bounded, cosmetic), but don't let it drift further: if the
   profile contract's *shape* changes (new required field, renamed key), update this copy too.
2. **Challenge crypto mirror** (`business-deal/js/challenge-hook.js`): inlines the
   hash/obfuscate/deobfuscate logic and salts from the retired `js/challenge/{crypt,secrets}.js`,
   explicitly commented as mirroring that file byte-for-byte. Changing the trigger hash, salt,
   or code blob in one place without the other breaks Monopoly Deal's challenge hook silently.
3. **Stats recorder** (`business-deal/js/game-stats-global.js`): a verbatim-after-header in-scope
   copy of `js/game-stats-global.js` — a 15-line header ending in a marker line, then the canonical
   file byte-for-byte; enforced by `test-recorder-contract.mjs`. Since 2026-07-23 that file also resolves WHICH player's
   store to write (see "Whose stats are these"), so a drift here now risks landing one player's
   Monopoly Deal plays in another player's store, not just a stale counter. It has to be a *copy*, not a shared reference, because
   Monopoly Deal's page is exclusively controlled by its own nested service worker
   (`business-deal/sw.js`) — a request for anything outside `business-deal/` (like the
   original `../js/game-stats-global.js`) is still routed through BD's own SW's fetch
   handler, so it can only be reachable offline if it's also in BD's own cache list. If you
   change `js/game-stats-global.js`, copy the change into
   `business-deal/js/game-stats-global.js` too and bump `business-deal/sw.js`'s `CACHE`.

### Consuming it in a game

- Read once at setup-screen load. **Precedence:** a game's own saved last-used settings (e.g.
  `chinchon-settings`) beat the profile, which beats built-in defaults. Games never write it back.
- **Skill maps 1:1** (1 Beginner, 2 Intermediate, 3 Pro) onto each game's difficulty. Connect Four's 4th
  "Expert" solver is not a profile tier (it is still chosen in Connect Four's own setup).
- Use the profile name/emoji only where a game already shows player identity; do not add new avatar
  surfaces to games that lack them.
- Prefills today: **every game**. All eleven in-repo game modules read the
  profile at setup (name/emoji/opponents/skill as each game's setup uses them), and Parchís's
  single-file build carries its own inlined reader (see `parchis/CLAUDE.md`). The per-game
  precedence rule above (own saved settings beat profile beats defaults) applies in each.
