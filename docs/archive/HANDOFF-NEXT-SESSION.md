# Handoff: state of the hub as of 2026-07-23 (commit `ca7e299`)

For whichever session picks this repo up next. Everything below was verified at write time —
tests run, tree checked, live board read — not inherited from summaries. Root `CLAUDE.md`
auto-loads and is current; `js/CLAUDE.md` auto-loads when you touch shared modules; each game
has its own `<game>/CLAUDE.md`. **This doc is the state-of-play and open-threads layer those
files deliberately don't carry.** When it conflicts with the code, the code wins — verify,
don't trust (that rule is this repo's whole recurring lesson).

## Verified state at handoff

- Branch `main`, in sync with `origin/main` at `ca7e299`, working tree CLEAN.
- `node run-all-tests.mjs`: 18 suites, 0 failed (2 skipped, optional jsdom — normal).
- Deployed build: SW `game-hub-v186`.
- Live leaderboard (fresh read the same day): Bego 48 plays, MattyIce 156, King of Games 178,
  Natalia 8 (code `C5PXN`), Anita Bonita 20. No Test row.

## What shipped in the 2026-07-22/23 arc (newest last)

1. **Ana/Natalia correction** — Natalia is her own player (`C5PXN`, 8 reconstructed plays);
   `usernames/natalia` repointed; Ana deliberately untouched; the dev/test device's name cleared
   (archived to `profile.nameArchived`, not deleted). Applied by `fix-natalia-record.mjs` (kept
   for audit; re-running refuses to duplicate). Full record + how certain the split is:
   `js/CLAUDE.md` "The Ana/Natalia correction".
2. **Per-player stats keying** ("whose stats are these") — a second player code on a device gets
   `gamehub.stats.p.<CODE>` + `players/<deviceId>-<CODE>`; the first code owns the legacy keys
   untouched. Plus the `claimUsername` release-bug fix in the first-run gate.
   `test-stats-identity.mjs` guards it with the real incident device's store as fixture.
3. **CLAUDE.md restructure** — per-game files, `js/CLAUDE.md` for shared-module depth, THE LAW
   restored to Matt's own two sentences + nine one-line derived rules (full rationale in
   `js/CLAUDE.md`). `repeat-the-law.mjs` is retired/deleted. Root is ~330 lines.
4. **i18n** — `js/i18n.js` (`gamehub.lang.v1`), first-run English/Español chooser, Matt's
   flag-knob toggle (inline SVG, between the hub title and version pill). Full extraction done:
   hub chrome, profile page, My Stats, Leaderboards, and nine games. `test-i18n-strings.mjs` is
   the drift tripwire (at handoff: 156 en keys, 0 missing from es).
5. **Snake** — full game, born bilingual (the `strings.js` reference implementation), solo-axis
   stats/leaderboard wiring, on-screen D-pad (several Sonnet iterations; Matt's own "compass"
   style is the default — see `snake/CLAUDE.md`).
6. **Leaderboard redesign** — wins-only display (losses live in My Stats, satisfying rule 1),
   unified 44/36/34px chrome bands shared with the hub, segments renamed **By Player / By
   Game**, ski-slope difficulty pills (● ■ ◆ ◆◆ + All) as a real filter, game-tile-art
   thumbnails (`js/game-art.js`), every player card in the mini-tile style. **The 0-100 rating
   was REMOVED from display** — `js/leaderboard-rank.js` and its test suite are deliberately
   kept for a possible future dedicated rating page; don't delete them as dead code.
7. **Game titles translate** (Spain Spanish, Matt's explicit reversal of the earlier
   titles-stay decision): Conecta 4, Tres en Raya, Puntos y Cajas, Tuercas y Tornillos, Carrera
   de Bolas, Serpiente. One name, three synced places — `game_title_*` keys in `js/strings.js`
   (leaderboard + stats tabs), `{en,es}` titles in the hub `GAMES` registry, each game's own
   `strings.js` title. Sort is by DISPLAYED title at render time — never at module scope.

All the executed handoff docs (`HANDOFF-LEADERBOARD-CORRECTION`, `-CLAUDEMD-SPLIT`, `-LAW-DEDUP`,
`-SNAKE-DPAD`, `-I18N-EXTRACTION`, `-LEADERBOARD-REDESIGN`, plus older game ones) are HISTORY —
reference material, not instructions. Do not re-execute any of them.

## Open threads, roughly prioritized

1. **Parchís language wiring** — Parchís has its own working ES setting but ignores
   `gamehub.lang.v1`. The fix is a small precedence edit in its `getLang` bootstrap, but it must
   go through the sibling `../Parchís/` source + `recombine.mjs` rebuild (see
   `parchis/CLAUDE.md`), so it needs a session with that folder available. Small, contained.
2. **Boggle Spanish — UI half EXECUTED 2026-07-23** (`HANDOFF-BOGGLE-SPANISH.md`), answering the
   open design question from `HANDOFF-I18N-EXTRACTION.md` decision 8 with Ana's own 2026-07-23
   report: an all-English screen inside an otherwise-Spanish app read as broken to her, and
   likely caused her phone's browser to auto-translate the page (rewriting single-letter tiles
   into words), so UI translation was the fix, not just a nice-to-have. `boggle/js/strings.js`
   now covers all UI chrome; `.bg-root` carries `translate="no"` so no translator can touch the
   board again; the Spanish invalid-word feedback and help sheet both name the dictionary as
   English. **Remaining open item, unchanged in scope:** a REAL Spanish Boggle needs a Spanish
   word list + dice distribution — a sizable standalone project if Matt ever wants it.
3. **Dedicated rating page** — Matt's stated maybe. The maths (`leaderboard-rank.js`) and its
   tests are intact and current; only the display was retired. If built, the known solo-axis
   property (field-max holder rates high on any sample) is documented in `js/CLAUDE.md`.
4. **Nameless-device gap** — 16 plays across 9 devices (as of 2026-07-22) are synced but appear
   on no screen because the leaderboard lists named players only. Stored-but-invisible, rule 1.
   Needs a product decision on display identity for nameless devices, not just a filter change.
5. **Data-history caveats that must not be papered over** (full detail `js/CLAUDE.md`):
   Ball Run 8 attributed to Ana on timing alone; Ana's Connect Four shows zero plays ever
   (probably `_statsDisqualified`) so her true lifetime total is understated; Natalia's 8 are
   double-counted family-wide (inside Ana's blended row AND her own) — accepted tradeoff, fixed
   forward by the per-player keying, never to be "corrected" retroactively without Matt.
6. **Test-device profile resurrection** — the physical test device's LOCAL profile still says
   "test"; if that browser ever opens the hub it will re-sync the name and reappear on the
   board. Only fixable from that device. (Its Firebase name was cleared and archived.)
7. **Housekeeping candidates, Matt's call**: `Leaderboard (2).jpeg` at repo root and
   `filler/Leaderboard issues1.jpg` (screenshot accidentally inside a game folder) are committed
   to a PUBLIC repo and contain family names — consider deleting or gitignoring; also
   `HANDOFF-NEXT-SESSION.md` itself should be updated or superseded, not left stale.

## Working conventions this arc proved out (beyond what CLAUDE.md records)

- **Handoff → Sonnet execution → independent verification.** Opus-tier sessions write
  HANDOFF-*.md docs with every decision made and an explicit recommended effort level; Sonnet
  sessions execute; the authoring session verifies with fresh, independently-written checks
  (not the executor's own scripts). This caught real bugs both directions.
- **Parallel sessions in one working tree work**, with two rules: `sw.js` CACHE bumps are
  applied as the LAST edit before each commit (read current `vN`, write `N+1` — never hold it
  dirty), and any file dirty with changes you didn't make belongs to another session — wait for
  its commit.
- **Commit ≠ push.** Sessions commit; Matt reviews and says push. Matt makes image assets
  (ChatGPT) and does phone-side steps himself — give him exact click-by-click instructions.
- **Translations**: Spain Spanish only, minimal functional text (no invented narrative —
  standing rule), labels translate / stored values never (difficulty ids, stats keys, byDiff
  buckets are storage vocabulary; `normDiff` and `difficulty-tiers.js` are read/write-path
  separated on purpose).
- **Before any Firebase write**: `node backups/rtdb-backup.mjs` first, dry-run scripts default,
  verify by fresh re-read, simulate the post-write leaderboard with the repo's own aggregation
  modules and abort if any bystander row moves. `fix-natalia-record.mjs` is the worked example.

## THE LAW

It's Matt's, verbatim, at the top of root `CLAUDE.md`: *"You must never delete or lose or risk
deleting or losing any player data. You must always verify this."* Every incident in this repo's
history traces to a session that skipped the second sentence.
