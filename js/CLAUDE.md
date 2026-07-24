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
| `js/i18n.js` | (2026-07-23) the EN/ES language layer — see "Language support" below |
| `js/game-stats.js` | unified stats, keyed per PLAYER since 2026-07-23 (`statsKey()`/`statsId()`; see "Whose stats are these" — the device owner keeps `gamehub.stats`, anyone else gets `gamehub.stats.p.<CODE>`); one bespoke `recordX()` per game plus generic `recordResult`; a game with richer needs than played/won/lost carries its own sub-counter (`grid` Connect 4, `cc` Chinchón, `es` Escoba, `nb` Nuts & Bolts, `tt` Tic Tac Toe, `db` Dots and Boxes, `bg` Boggle) — `tt`/`db`/`bg` all track `tied` explicitly rather than deriving it (each game can genuinely draw/tie), and `db`/`bg` each carry Math.max-only (or longer-only) bests per THE LAW rule 2; legacy-store folds, the Ball Run metric migration, and the Monopoly Deal pending-stats drain (see "The shared profile" section) |
| `js/game-stats-global.js` | a non-ESM "classic" port of `game-stats.js`'s recorder, exposed as `window.__ghStats` for Monopoly Deal and Parchís — a second, parallel implementation of the stats-write path. **`business-deal/js/game-stats-global.js` is a verbatim-after-header in-scope copy — a 15-line header ending in a marker line, then the canonical file byte-for-byte; enforced by `test-recorder-contract.mjs`** (see "The shared profile" section for why) |
| `js/firebase-boot.js` | the ONE place that boots the named `'stats'` Firebase app + anonymous auth; `stats-net.js` and `net.js` both call `getStatsApp()` so there is only ever one init in flight, never a race between them |
| `js/stats-net.js` | Firebase mirror of profile+stats to `players/<deviceId>`; username reservation registry; `syncHealth()` (see "Sync health") |
| `js/players-agg.js` | pure identity-graph aggregation (code ∪ name union-find) of synced devices into per-person rows. **A game's sub-counter needs an explicit branch here or it is silently dropped** — see "Adding a game" item 7 |
| `js/game-stats-ui.js` | "My Stats" overlay; per-game tailored screens |
| `js/leaderboard-ui.js` | "Leaderboards" overlay; live `watchPlayers` subscription. DOM only — the ranking maths is in `leaderboard-rank.js`; read-only consumer of stored data |
| `js/leaderboard-rank.js` | pure, headless-testable ranking: draws-as-wins, difficulty-weighted Wilson rating, solo achievement scoring. See "The leaderboard's rating model" |
| `js/difficulty-tiers.js` | READ-path mapping of every game's difficulty vocabulary onto the shared 1-4 tier scale + weights. Deliberately separate from `normDiff()`, which is on the write path |
| `js/net.js` | multiplayer room layer (`rooms/<CODE>`, lockstep move log, heartbeat, recovery, SW-version match on join) used by Chinchón and Escoba |
| `js/a2hs.js` | add-to-home-screen bottom sheet; polls hub DOM state to avoid overlay collisions |
| `js/device-report.js` | (2026-07-22) the profile page's "Device details" diagnostic: `gatherDeviceReport()` reads every localStorage key this app has ever written (both by name - profile, stats, every game's own settings/saves/legacy stats - and exhaustively, a raw `{key, bytes}` dump of literally everything in `localStorage` so nothing is invisible to the page) plus two Firebase reads (`usernames/<name>` and `players/<deviceId>`) that catch a mixed-up profile immediately (registered owner disagrees with this device, or local/remote stats disagree). `uploadDeviceReport()` pushes the whole thing to its own new node, `deviceReports/<deviceId>/<pushId>` - see "The shared profile" for why this exists and why it deliberately excludes `js/challenge/` state |
| `js/challenge/` | retired gift/challenge system (~10 modules + assets). Still load-bearing: `hub.js` and `game-stats-ui.js` import `isDevProfile`/`isChallengeActive`/`isAdmin` from `js/challenge/hooks.js` on every load, and `isDevProfile` (the gate for unreleased `devOnly` games) is built on the challenge's `secrets.js` hash list. Deleting this directory would break the hub shell. |

Firebase layer: one project (`js/firebase-config.js`), anonymous auth, RTDB rules
`auth != null` (known-intentional, effectively open since anyone can sign in anonymously).
Two client layers now share one bootstrap (`js/firebase-boot.js`, named app `'stats'`):
`stats-net.js` and `net.js`. `js/challenge/challenge-net.js` boots Firebase's separate
DEFAULT (unnamed) app and is untouched by the shared bootstrap — it was never part of the
init race that motivated it. Node ownership is disciplined by convention: stats-net touches
`players/` + `usernames/`, net.js touches `rooms/` only, challenge-net touches its own
nodes, device-report.js touches `deviceReports/` only (read of the first two, write of
the third). Nothing enforces this but comments.

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

### Multiplayer lockstep — invariants (M1/M2b, hardened July 2026)

Chinchón and Escoba share one lockstep protocol over `js/net.js` (`rooms/<CODE>`: a
seq-keyed move log, per-round `round` records, a `recovery` field). Both engines apply
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

---

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

- **A draw (or a solo run/solve) counts as a win**, for every player, in every game, derived at
  render time via `bucketsOf()`'s `wins = played - losses` (never stored). Solo games (Ball
  Run/Nuts & Bolts/Snake) populate `total`/`byDiff` with the same `{played,won,lost}` shape as
  every competitive game (`lost` just never gets touched), so `winsAtTier()` in `leaderboard-ui.js`
  works generically across ALL 13 games with no special-casing for "solo" — a solve/run at a tier
  IS a win at that tier, per Matt's explicit instruction. **Known, accepted property:** solo volume
  inflates win counts with no rating left to discount it; Matt is trading precision for legibility.
- **Difficulty is a single-select FILTER now, not a weighting.** Five pills — All (default),
  Beginner, Intermediate, Pro, Expert — shared between By Player and By Game and carried into a
  game's own page; resets to All every time the overlay opens (not persisted). Ski-slope shapes
  (circle/square/diamond/double-diamond, `diffShapeSVG()` in leaderboard-ui.js) carry the tier,
  color is secondary (colorblind rule). **Legacy/unknown buckets (`tierOf()` returns null) count in
  All ONLY** and appear under no tier pill — dropping them from All would be a rule 1 regression on
  exactly the data `foldLegacy` exists to preserve. `difficulty-tiers.js` itself is untouched.
- **Ball Run and Snake are the one place "wins at a tier" and "the game's own metric" diverge** —
  their leaderboard number is a BEST (`bestObstaclesByDiff`/`bestLenByDiff`), not a play count, so
  `leaderboard-ui.js` special-cases `brBestAt()`/`snBestAt()` for them; every other game (including
  Nuts & Bolts — a solve always increments both `played` and `won` by exactly 1) uses the generic
  `winsAtTier()`/`gameMetricAt()` path.
- **Everyone with any recorded play at the selected filter is listed** (`plays > 0` at that tier;
  under All, any play at all) — the same visibility bar as the old rating-based board, now applied
  per-filter instead of once. A Beginner-only player must still be visible under the default (All).
- Sort: wins (or metric) desc → fewer games wins ties (better economy) → `updatedAt` desc — same
  shape as the old rating tie-break, just without the rating.

**`js/game-art.js`** is the single source for every hub-launcher tile's inline SVG art, keyed by the
HUB registry id (`GAMES[].id]` — moved out of `js/hub.js`'s GAMES array so the Leaderboard's By Game
screen can show the SAME real tile art as a thumbnail without importing hub.js itself (a
side-effectful module: it boots stats sync and first-run gates on import). `hub.js` now reads
`GAME_ART[id]`; `leaderboard-ui.js` reads `GAME_ART[hubIdOf(statsId)]` via its own
`STATS_TO_HUB` map (verify that map against the real `GAMES` registry if either changes ids).

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

**Known gap, not yet fixed:** the leaderboard lists only players with a profile name
(`(g.name || '').trim()` in `leaderboard-ui.js`, predates the 2026-07-22 overhaul). Devices that
recorded plays without ever setting a profile name are mirrored to Firebase but appear on no screen -
16 plays across 9 devices as of 2026-07-22. That is stored-but-invisible, rule 1. Fixing it needs a
display identity for a nameless device, which is a product decision, not just a filter change.

### The Ana/Natalia correction (2026-07-23) — what was done, and how certain it actually is

Ana and Natalia shared one physical device (`players/1f75ff86-...`, code `89N3N`, "Anita Bonita")
for about a week before Natalia got her own phone. `js/game-stats.js` stores only running per-device
totals, so every play either of them made landed in the same counters and **there is no per-play log
to split them by.** Separately `usernames/natalia` held `{ code: "89N3N" }` — Ana's code — which is
why Natalia's brand-new phone answered "Taken. Use that code instead." the first time she tried to
claim her own name.

**Root cause of the stale registry entry** (verified in code, still unfixed): `js/hub.js`'s
first-run "fr-save" handler calls `claimUsername(name, code, '')` — a hardcoded empty *previous
name*, so the gate can register a new name but can never release the one it replaces.
`profile/index.html`'s rename flow passes the real previous name and releases correctly. The bug
only fires when a device's local profile is reset and then re-claimed through the hub's gate rather
than the profile page. `js/stats-net.js` already exports `adminReleaseUsername(name)` for exactly
this repair; nothing in the UI calls it.

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

`recordHeadToHead(gameId, opponent, won)` (`js/game-stats.js`) writes a new top-level
`h2h: { [gameId]: { [opponentDeviceId]: { name, w, l } } }` key. **Capture only — nothing displays
it yet, and that is deliberate.** The opponent's identity only exists while the multiplayer room is
live: Chinchón and Escoba both knew exactly who they had just played (`_mpNewState` accepted the
room participant as a parameter and then *discarded* it) and threw it away at match end, so every MP
match played before 2026-07-22 is permanently unrecoverable. Both now store it on `this.mp.opp`,
refresh it from the live room in `_mpOnRoomUpdate` (the restore/rejoin path starts with none), and
record it in `_commitStats`. New key, additive counters, no migration — rules 2 and 5 hold by
construction, and `stats-net.js` mirrors `gamehub.stats` wholesale so it syncs with no change.

---

---

## The shared profile — contract and consumers

The summary and the defaults-only rule live in the root `CLAUDE.md` ("The shared profile");
this is the full detail.

### Contract (`localStorage["gamehub.profile"]`)

```js
{ version:1, name, emoji, preferredColor:"yellow"|"blue"|"red"|"green"|null,
  opponents:[{name, emoji, skill:1|2|3}], updatedAt }
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
