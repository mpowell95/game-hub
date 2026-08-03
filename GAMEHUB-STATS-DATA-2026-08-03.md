# Game Hub — Stats Data Extraction (2026-08-03)

**Purpose of this document.** This is a READ-ONLY data extraction and organization pass over the
Game Hub's player statistics. It gets the data and organizes it, without interpretation,
conclusions, or recommendations — a separate analysis pass is expected to work from this document
alone, with no other access to the repository or the live database. Every abbreviation is expanded,
every metric is defined where it appears, and every caveat is stated in place rather than in a
footnote.

**Hard constraints observed while producing this document:** every read against Firebase was
read-only (no write, no `--write` flag run, no `fix-natalia-record.mjs` execution); no app file,
`localStorage` schema, or stored record was modified; the raw RTDB snapshot (`backups/*.json`,
gitignored) was not committed and no player code appears anywhere in this document — player codes
are the 5-character alphanumeric strings issued by the app's own player-code system (e.g. the
kind of string stored in `profile.playerId`), and every place this document needed to show "does
this person have a code" it uses a plain yes/no instead of the code's value.

---

## 1. Provenance

- **Snapshot file:** `backups/rtdb-2026-08-03T15-13-00-738Z.json` (gitignored, never committed).
  Produced by running `node backups/rtdb-backup.mjs` from the repo root — a read-only script that
  signs in anonymously via the Firebase Identity Toolkit REST API and snapshots the entire
  Realtime Database to a timestamped local JSON file. Nothing was written to Firebase by this or
  any other step in this pass.
- **Snapshot timestamp:** captured 2026-08-03T15:13:00Z (the timestamp embedded in the filename by
  the backup script, which stamps `Date.now()` at capture time).
- **Snapshot file size:** 872,102 bytes (872 KB) of JSON on disk.
- **Device-record count:** 111 entries under the `players/` node (`backups/rtdb-backup.mjs`'s own
  reported count at capture time).
- **Raw total recorded plays:** 2,022 (`backups/rtdb-backup.mjs`'s own `totalPlays()` helper —
  the sum of every game's `total.played` counter across every one of the 111 device records,
  before any aggregation, hiding, or identity-graph merging). This document's per-person
  aggregation (Section 3 onward) reconciles exactly against this number — see the reconciliation
  note below.
- **Top-level nodes present in the snapshot and their reachability:**

  | Node | Reachable? | Entry count | Covered in this document |
  |---|---|---|---|
  | `players/` | yes | 111 device records | Sections 3-8 |
  | `usernames/` | yes | 20 entries | Section 9 (name registry, referenced) |
  | `deviceReports/` | yes | 5 device reports (each holding 1 captured push) | Section 1 (this section) and Section 9 |
  | `rooms/` | yes | 57 multiplayer room records | Section 7 |
  | `archive/players` | yes (found while exploring the snapshot; not named in the original task brief) | 4 archived device records | Section 9 |
  | `challenge/` | yes (found while exploring; not named in the task brief) | 2 entries, the retired gift/challenge system's own state (`js/challenge/`) | out of scope — this document is about game stats, and the challenge system is explicitly documented in the repo as retired. Noted here only for completeness: it holds no game-stats data. |
  | `admins/` | yes (found while exploring) | 2 entries, each a Firebase Auth UID mapped to `true` (an admin allow-list) | out of scope — access-control data, not player stats. Noted for completeness only; no names or codes involved. |

  **Nothing failed to load.** Every top-level node in the snapshot was reachable and is accounted
  for above.

- **Reconciliation.** This document's per-person aggregation was produced by importing the repo's
  own `js/players-agg.js` (`aggregatePlayers`) and `js/leaderboard-rank.js` into a throwaway Node
  script (kept outside the repo, in the session's scratch directory, never committed) and running
  them against the snapshot — not by hand-summing, because the identity graph (devices unioned by
  player code OR canonical name, transitively, plus the hand-maintained `NAME_ALIAS`/
  `DISPLAY_NAME` maps in `players-agg.js`) is genuinely non-obvious and hand-summing would
  silently diverge from what the app itself shows. Summing `total.played` across every one of the
  98 aggregated person-groups (i.e., across ALL devices, both hidden and visible) yields
  **2,022** — an exact match to the raw `totalPlays()` figure above, with nothing excluded. The
  reconciliation holds with zero discrepancy.

- **Archive node, noted honestly.** `archive/players` (4 records: the same four devices whose ids
  appear in `leaderboard-ui.js`'s `HIDDEN_PREFIX` list — see Section 9) is NOT part of the live
  `players/` node counted above; it appears to be a separate, manually-created copy/backup of
  those four specific device records (their content is near-identical to what `HIDDEN_PREFIX`
  targets: "Tester", "test1", "PreviewBot", and one blank-named "Random Player" record). It is
  not documented in any of the schema source files this pass was told to read
  (`js/game-stats.js`, `js/players-agg.js`, `js/leaderboard-rank.js`, `js/leaderboard-ui.js`,
  `js/game-stats-ui.js`, `js/CLAUDE.md`) and no script in the repo (`fix-natalia-record.mjs`,
  `backups/rtdb-backup.mjs`, etc.) was found to reference the string `"archive"`. Its origin is
  unknown to this pass; it is reported here rather than silently ignored, per the instruction that
  nothing found should be dropped without a note. It contributes ZERO to any total in this
  document — the reconciliation above is against the live `players/` node only.

## 2. Data dictionary

### 2.1 Game ids and display names

The hub stores stats under 19 internal game ids (the `GAMES` array in `js/game-stats.js`). Two ids
deliberately do not match their on-screen display name — this is documented and intentional in the
repo, not an error:

| Stats id | Display name (what a player sees) | Notes |
|---|---|---|
| `connect4` | Connect Four | |
| `chinchon` | Chinchón | |
| `business` | **Monopoly Deal** | Id/display split is intentional (`business-deal/` folder, `bd-stats` legacy key) — never "corrected" per the repo's own CLAUDE.md |
| `parchis` | Parchís | Separately deployed app, not an in-hub module |
| `nutsbolts` | Nuts & Bolts | Solo puzzle |
| `escoba` | Escoba | |
| `filler` | Filler | |
| `mancala` | Mancala | |
| `ballrun` | Ball Run | Solo endless runner |
| `tictactoe` | Tic Tac Toe | Has Classic and Ultimate variants |
| `dotsboxes` | Dots and Boxes | |
| `boggle` | Boggle | |
| `snake` | Snake | Solo |
| `uno` | Uno | |
| `pool` | Pool | |
| `poolv2` | Pool (v2) | A second, apparently newer/parallel Pool implementation; stats id is distinct from `pool` |
| `yahtzee` | Yahtzee | |
| `dominoes` | Dominoes | |
| `hillclimb` | Hill Climb | Solo endless driving run |

### 2.2 Solo vs. competitive games

A **solo** game has no opponent and no loss state: every finished run/solve records as BOTH
`played` and `won` (the app's own `recordX()` functions never touch `lost` for these games), so a
"win rate" is meaningless by construction for them — a 100% win rate is guaranteed, not earned.

- **Solo games (4):** `nutsbolts`, `ballrun`, `snake`, `hillclimb` (this is the exact `SOLO` set
  defined in `js/players-agg.js`).
- **Competitive games (15):** everything else — `connect4`, `chinchon`, `business`, `parchis`,
  `escoba`, `filler`, `mancala`, `tictactoe`, `dotsboxes`, `boggle`, `uno`, `pool`, `poolv2`,
  `yahtzee`, `dominoes`. These have a real win/loss (and in several cases, tie) axis.

For solo games, the honest headline numbers are the game's own score/best metrics (obstacles
passed, snake length, puzzle level, distance), not plays or "wins" — this document leads with
those in Section 6.

### 2.3 Every-game shared fields

Every one of the 19 games carries, at minimum:

- **`total: { played, won, lost }`** — cumulative counters, ADDITIVE ONLY (never decremented, never
  reset). `played` is every finished game/round/run; `won`/`lost` are self-explanatory for
  competitive games. For solo games, `won` always equals `played` and `lost` is always 0.
  A **draw/tie** is NOT double-counted or separately totaled here: for games that track ties
  explicitly (see 2.5), `played - won - lost` recovers the tie count; for games with no explicit
  tie field, the app's own display code treats a null `won` result (an explicit third outcome
  passed into `recordResult`) the same way.
- **`byDiff: { <label>: { played, won, lost } }`** — the same `{played,won,lost}` shape, broken
  out per difficulty/mode label. The **label vocabulary is NOT uniform across games** — see 2.4.
- **`updatedAt`** (top-level, one per device record, not per game) — an ISO-8601 timestamp of the
  last write to that device's whole stats store, refreshed on every recorded play.

### 2.4 The `byDiff` label vocabulary, as actually found in this snapshot

Difficulty/mode labels are free-form strings chosen by each game's own recorder, normalized only
by lowercasing/trimming (`normDiff()` in `js/game-stats.js`). This document reports the labels
exactly as stored, per game, rather than forcing them onto one shared 1-4 scale (that mapping
exists separately, read-only, in `js/difficulty-tiers.js`, and is used only for the retired rating
model in Section 8). Labels actually observed among VISIBLE players in this snapshot (Section 5
has the full per-game breakdown):

| Label | Meaning | Games it appears in (this snapshot) |
|---|---|---|
| `easy` / `medium` / `hard` / `expert` | A real difficulty tier, that game's own vocabulary | connect4, nutsbolts, ballrun, snake, hillclimb, uno |
| `extrahard` | Nuts & Bolts' fourth, hardest tier | nutsbolts |
| `beginner` / `intermediate` / `pro` | A real difficulty tier, a different game's own vocabulary | filler, mancala, tictactoe, dotsboxes, boggle |
| `normal` | Chinchón/Escoba/Monopoly Deal's single default-opponent-difficulty label | chinchon, business |
| `mp` | Multiplayer — NOT a difficulty tier. Recorded under its own bucket rather than whatever AI tier the local setup screen last showed, per the repo's own documented convention | filler, tictactoe, dotsboxes, boggle, mancala (mancala had none nonzero in this snapshot) |
| `ai` | Yahtzee's solo-vs-computer bucket (Yahtzee has no difficulty tiers at all; `ai` vs `mp` is its only split) | yahtzee |
| `legacy` | Pre-unified history folded in ONCE from an older, per-game-only stats store (`chinchon-stats`, `bd-stats`) when the unified `gamehub.stats` store was introduced. Real plays, just from before per-difficulty tracking existed | chinchon, business |

A `byDiff` bucket key that maps to none of the above (an "unrecognized" label) is still counted in
that game's `total` — it is simply not broken out per-tier. None were observed among visible
players in this snapshot.

### 2.5 Cumulative counters vs. bests, and explicit ties

Every additional per-game sub-counter (below) is one of exactly three kinds, and every field
below is labeled with which kind it is:

- **Cumulative** — only ever added to, never reset or decreased (e.g. escobas made, words found,
  coins earned).
- **Best** — replaced only when a new value is strictly better (`Math.max`, or "longer word wins"
  for text); never decreases.
- **Explicit tie** — some competitive games CAN end level (Tic Tac Toe's Pro Classic is an
  unbeatable solved game and therefore draw-heavy; Dots and Boxes' 4x4 board can end 8-8; Boggle
  is scored against the AI's own found-word total; Yahtzee and Dominoes matches can also land
  level). For these, `tied` is stored as its own explicit counter rather than derived, and
  `played - won - lost` equals `tied` exactly for these games.

Per-game sub-counters found in this snapshot's schema (`js/game-stats.js`'s own header comment is
the authoritative source; field-by-field detail and per-person values are in Section 6):

| Game | Sub-object | Fields | Kind |
|---|---|---|---|
| Connect Four | `grid` | `{player,computer} x {easy,medium,hard,expert} x {w,l}` — win/loss broken out by WHICH SIDE MOVED FIRST | cumulative counters |
| Chinchón | `cc` | `closed`, `minusTen`, `chinchons` (three close-quality event counts) | cumulative |
| Escoba | `es` | `escobas` (captures that clear the table) | cumulative |
| Nuts & Bolts (solo) | `nb` | `solved`, `moves` (cumulative); `bestLevel` (best) | mixed |
| Ball Run (solo) | `br` (Classic map) | `runs` (cumulative); `bestObstacles`, `bestObstaclesByDiff` (bests) | mixed |
| Ball Run (solo) | `brOrbital` (Orbital map, a second/newer map) | same shape as `br`, entirely separate bucket | mixed |
| Ball Run (solo) | `brLegacyMeters` | `runs` (cumulative, carried forward), `bestDistance`/`bestByDiff` in METERS — see 2.6, never comparable to `br`'s obstacle counts | mixed, ARCHIVED |
| Tic Tac Toe | `tt` | `classic`/`ultimate`, each `{played,won,lost,tied}` | cumulative + explicit tie |
| Dots and Boxes | `db` | `{played,won,lost,tied}` (explicit tie) plus `boxes` (cumulative claimed-box count) and `bestChain` (best single-turn capture run) | mixed |
| Boggle | `bg` | `{played,won,lost,tied}` plus `words` (cumulative), `bestScore` (best), `longestWord: {word,len}` (best, moves as a unit) | mixed |
| Snake (solo) | `sn` | `runs` (cumulative), `bestLen`/`bestLenByDiff` (bests), plus a walls-on/walls-off split of all of the above (`bestLenByWalls`, `bestLenByDiffWalls`, `runsByWalls`) added 2026-07-28 | mixed |
| Yahtzee | `yz` | `{played,won,lost,tied}` plus `yahtzees` (cumulative count of scored Yahtzees, first + bonus) and `bestScore` (best single-game total) | mixed |
| Dominoes | `dm` | `{played,won,lost,tied}` plus `rounds`/`points` (cumulative) and `bestRound` (best) | mixed |
| Hill Climb (solo) | `hc` | `runs` (cumulative), `bestDistance`/`bestDistanceByStage` (bests, per one of 4 stages: countryside/desert/arctic/moon), `coins`/`flips` (cumulative lifetime totals — NOT the game's spendable coin wallet, see Section 10) | mixed |

**Games with no richer sub-counter than `total`/`byDiff`:** `business` (Monopoly Deal), `parchis`,
`filler`, `mancala`, `uno`, `pool`, `poolv2`.

### 2.6 THE LAW-relevant caveats, stated once here (and repeated in place wherever a number depends on them)

- **`brLegacyMeters` is archived pre-migration Ball Run history, measured in METERS.** It is
  never converted to the current obstacle-count metric (`br`/`brOrbital`) — meters and obstacle
  counts are not comparable units, and the repo's own documented policy (THE LAW rule 4) forbids
  fabricating a conversion. This document presents it in its own separate table (Section 6) and
  never sums it with `br`/`brOrbital`.
- **A solo game's `won === played` is not an achievement** — it reflects that the game has no
  loss state, not that every run succeeded at some challenge. Section 5's per-game hub-wide table
  shows this plainly (100% "win rate" for every solo game), and Section 6 leads solo games with
  their real score metrics instead.
- **There is no per-play event log anywhere in this data** — see Section 10 for the full
  implication (no timing, no session length, no sequencing, no time-of-day is recoverable from
  anything in this document).

---

## 3. Roster

One row per aggregated PERSON — every device in the `players/` node, unioned by the app's own
identity graph (`js/players-agg.js`'s `buildIdentity`: two devices are the same person when they
share a player code OR a canonical profile name, transitively, including the repo's hand-maintained
`NAME_ALIAS` map for `matt`→`mattyice` and `lill`→`lili`). This produced **98 person-groups** from
the 111 raw device records.

**Device ids are real** (truncated to the first 8 characters, as requested), so a row here can be
matched directly against the raw `players/<deviceId>` node in the snapshot or against a specific
device's own `localStorage`. **Player codes are not shown, on purpose** — the app's internal
identity-graph key for a code-linked person is literally `code:` followed by that person's real
5-character player code (the same code format found under `profile.playerId` and in the
`usernames/` registry); printing that, or a code by itself, would put a real player code in a file
committed to a public repo, which the task's explicit hard constraint forbids. The "Has player
code" column answers the only question a code actually needs to answer here (yes/no); if the
document's owner needs the codes themselves for follow-up (e.g. to look someone up in the
`usernames/` registry), that requires reading the ungitignored snapshot file directly, not this
document.

"Hidden from leaderboard" mirrors `js/leaderboard-ui.js`'s own two-stage hiding logic exactly (see
Section 9 for the full explanation of each reason code): a person is hidden if their device id(s)
are hit by `HIDDEN_PREFIX`, or if their (aggregated) display name is blank/"You" (nameless), or
matches `HIDDEN_NAMES`/`HIDDEN_NAME_PREFIX`. Hidden records are NOT deleted anywhere — they stay
fully synced and fully visible on their own device's My Stats screen; only the shared Leaderboard
overlay omits them.

### Generated: Roster (ALL aggregated persons)

| Display name | Device ids (truncated to 8 chars) | Devices | Has player code | First activity (UTC) | Last activity (UTC) | Total plays (all 19 games) | Hidden from leaderboard |
|---|---|---|---|---|---|---|---|
| *TP* | 01d14279 | 1 | yes | 2026-08-01T18:09:17.128Z | 2026-08-01T18:09:17.128Z | 466 | no |
| Jojopow | 3c595124 | 1 | yes | 2026-08-02T22:02:49.924Z | 2026-08-02T22:02:49.924Z | 321 | no |
| MattyIce | 2b0d7c05, 50bf8077, d2, dc1745bc, e0e63fde | 5 | yes | 2026-07-17T16:49:00.631Z | 2026-08-03T15:02:27.619Z | 313 | no |
| King of Games | 090215fa, 8829ec63 | 2 | yes | 2026-07-20T16:03:10.490Z | 2026-08-03T00:25:36.937Z | 252 | no |
| Lili | 288dc3cd, 85335c5a | 2 | yes | 2026-08-03T14:16:46.164Z | 2026-08-03T14:56:02.515Z | 126 | no |
| Brian Spalding | f46d2144 | 1 | yes | 2026-07-31T21:00:26.403Z | 2026-07-31T21:00:26.403Z | 110 | no |
| Andrew P | 8da7f9a7 | 1 | yes | 2026-08-01T01:26:49.298Z | 2026-08-01T01:26:49.298Z | 78 | no |
| Sam | 6fd441d8 | 1 | yes | 2026-07-28T14:35:49.927Z | 2026-07-28T14:35:49.927Z | 69 | no |
| Bego | 9217aeeb | 1 | yes | 2026-08-01T17:24:05.562Z | 2026-08-01T17:24:05.562Z | 62 | no |
| Liz | b033506a | 1 | yes | 2026-07-29T02:47:09.216Z | 2026-07-29T02:47:09.216Z | 53 | no |
| Allie | 4f452e7b | 1 | yes | 2026-07-31T04:14:49.659Z | 2026-07-31T04:14:49.659Z | 51 | no |
| Anita Bonita | 0b0473a8, 0feee28f, 1f75ff86 | 3 | yes | 2026-07-15T20:58:01.086Z | 2026-08-03T09:18:20.496Z | 36 | no |
| (blank) | 37c84737 | 1 | no | 2026-07-25T13:54:17.967Z | 2026-07-25T13:54:17.967Z | 16 | YES (nameless-or-placeholder) |
| Unai | a6a1f72b | 1 | yes | 2026-08-03T14:56:23.370Z | 2026-08-03T14:56:23.370Z | 15 | no |
| Rick | 65f8dfa9 | 1 | yes | 2026-07-31T01:34:10.482Z | 2026-07-31T01:34:10.482Z | 8 | no |
| Natalia | 660e7098 | 1 | yes | 2026-07-23T01:24:28.850Z | 2026-07-23T01:24:28.850Z | 8 | no |
| Tester | 86efbadc | 1 | yes | 2026-07-29T04:53:57.101Z | 2026-07-29T04:53:57.101Z | 6 | YES (hidden-name-prefix) |
| test | 081a6b45, f8ad1b82 | 2 | yes | 2026-07-18T19:35:27.295Z | 2026-07-28T23:47:07.661Z | 4 | YES (hidden-name-prefix) |
| Andrew Powell | ba27ea93 | 1 | yes | 2026-07-31T01:04:08.294Z | 2026-07-31T01:04:08.294Z | 4 | no |
| (blank) | 10278299 | 1 | no | 2026-07-22T03:49:03.785Z | 2026-07-22T03:49:03.785Z | 3 | YES (nameless-or-placeholder) |
| TestPlayer | 4919b72c, 4f7f8cd7, 71fc7c3e, 7f643c13 | 4 | no | 2026-07-29T02:57:56.006Z | 2026-07-29T04:11:34.286Z | 3 | YES (hidden-name-prefix) |
| (blank) | 51e9517a | 1 | no | 2026-07-22T05:07:54.614Z | 2026-07-22T05:07:54.614Z | 3 | YES (nameless-or-placeholder) |
| (blank) | 19bb8f1c | 1 | no | 2026-07-16T13:32:41.708Z | 2026-07-16T13:32:41.708Z | 2 | YES (nameless-or-placeholder) |
| hdj | 5ab40560 | 1 | yes | 2026-07-30T16:50:31.651Z | 2026-07-30T16:50:31.651Z | 2 | no |
| (blank) | 89721e62 | 1 | no | 2026-07-25T02:49:05.495Z | 2026-07-25T02:49:05.495Z | 2 | YES (nameless-or-placeholder) |
| (blank) | a525ed8c | 1 | no | 2026-07-22T06:19:47.764Z | 2026-07-22T06:19:47.764Z | 2 | YES (nameless-or-placeholder) |
| (blank) | df6d92dc | 1 | no | 2026-07-17T07:14:45.828Z | 2026-07-17T07:14:45.828Z | 2 | YES (nameless-or-placeholder) |
| (blank) | 1b3c162d | 1 | no | 2026-07-18T01:15:16.527Z | 2026-07-18T01:15:16.527Z | 1 | YES (nameless-or-placeholder) |
| Zed99 | b4f7e488 | 1 | no | 2026-07-29T03:04:46.303Z | 2026-07-29T03:04:46.303Z | 1 | no |
| (blank) | c0b6df4d | 1 | no | 2026-07-22T07:30:44.769Z | 2026-07-22T07:30:44.769Z | 1 | YES (nameless-or-placeholder) |
| (blank) | d9c472eb | 1 | no | 2026-07-18T02:40:13.422Z | 2026-07-18T02:40:13.422Z | 1 | YES (nameless-or-placeholder) |
| (blank) | f024b853 | 1 | no | 2026-07-17T07:21:04.832Z | 2026-07-17T07:21:04.832Z | 1 | YES (nameless-or-placeholder) |
| (blank) | 00939e56 | 1 | no | 2026-07-23T07:27:36.454Z | 2026-07-23T07:27:36.454Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 04df7b9b | 1 | no | 2026-07-19T13:55:26.283Z | 2026-07-19T13:55:26.283Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 074d6e7b | 1 | no | 2026-07-28T23:07:33.348Z | 2026-07-28T23:07:33.348Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 0b45be84 | 1 | no | 2026-07-25T19:57:32.645Z | 2026-07-25T19:57:32.645Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 12878682 | 1 | no | 2026-07-22T06:02:22.887Z | 2026-07-22T06:02:22.887Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 1692bfb8 | 1 | no | 2026-07-18T02:40:59.518Z | 2026-07-18T02:40:59.518Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 1a89d4de | 1 | no | 2026-07-22T05:34:02.826Z | 2026-07-22T05:34:02.826Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 1ac12a95 | 1 | no | 2026-07-18T18:03:17.463Z | 2026-07-18T18:03:17.463Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 1bfc0eea | 1 | no | 2026-07-21T23:34:08.399Z | 2026-07-21T23:34:08.399Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 212787a4 | 1 | no | 2026-07-18T02:23:12.381Z | 2026-07-18T02:23:12.381Z | 0 | YES (nameless-or-placeholder) |
| You | 224808a1, a8820abd | 2 | yes | 2026-07-22T19:07:18.931Z | 2026-07-29T04:56:22.386Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 22759ab3 | 1 | no | 2026-07-25T00:41:05.516Z | 2026-07-25T00:41:05.516Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 24227fb6 | 1 | no | 2026-07-25T01:12:36.285Z | 2026-07-25T01:12:36.285Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 263e23eb | 1 | no | 2026-07-18T02:17:12.500Z | 2026-07-18T02:17:12.500Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 29925583 | 1 | no | 2026-07-29T02:59:24.407Z | 2026-07-29T02:59:24.407Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 2ac83fb5 | 1 | no | 2026-07-22T07:30:39.908Z | 2026-07-22T07:30:39.908Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 355fadc1 | 1 | no | 2026-07-22T08:42:36.869Z | 2026-07-22T08:42:36.869Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 36cd7348 | 1 | no | 2026-07-18T19:51:18.016Z | 2026-07-18T19:51:18.016Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 393a3d10 | 1 | no | 2026-07-22T05:18:59.849Z | 2026-07-22T05:18:59.849Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 4e05656f | 1 | no | 2026-07-20T02:26:37.193Z | 2026-07-20T02:26:37.193Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 530597a1 | 1 | no | 2026-07-22T08:14:37.036Z | 2026-07-22T08:14:37.036Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 57bf1036 | 1 | no | 2026-07-22T17:17:48.727Z | 2026-07-22T17:17:48.727Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 57e7ce39 | 1 | no | 2026-07-18T19:25:57.103Z | 2026-07-18T19:25:57.103Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 5a78a05e | 1 | no | 2026-07-19T02:31:42.314Z | 2026-07-19T02:31:42.314Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 63c8e009 | 1 | no | 2026-07-19T07:06:30.755Z | 2026-07-19T07:06:30.755Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 726061a5 | 1 | no | 2026-07-18T19:48:41.120Z | 2026-07-18T19:48:41.120Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 744ee838 | 1 | no | 2026-07-22T19:43:04.477Z | 2026-07-22T19:43:04.477Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 7a391710 | 1 | no | 2026-07-18T17:48:02.679Z | 2026-07-18T17:48:02.679Z | 0 | YES (nameless-or-placeholder) |
| Ooo | 7c37ffa0 | 1 | yes | 2026-07-31T13:03:38.526Z | 2026-07-31T13:03:38.526Z | 0 | no |
| (blank) | 7ceceeac | 1 | no | 2026-07-18T06:03:21.603Z | 2026-07-18T06:03:21.603Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 7d5402cc | 1 | no | 2026-07-22T08:20:59.957Z | 2026-07-22T08:20:59.957Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 87bc2982 | 1 | no | 2026-07-17T16:12:42.958Z | 2026-07-17T16:12:42.958Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 87de6668 | 1 | no | 2026-07-29T15:43:36.568Z | 2026-07-29T15:43:36.568Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 8941017c | 1 | no | 2026-07-17T07:14:55.052Z | 2026-07-17T07:14:55.052Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 90cb441e | 1 | no | 2026-07-17T17:01:55.210Z | 2026-07-17T17:01:55.210Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 9bb69ca7 | 1 | no | 2026-07-19T06:03:33.982Z | 2026-07-19T06:03:33.982Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 9bdb922d | 1 | no | 2026-07-22T06:17:28.834Z | 2026-07-22T06:17:28.834Z | 0 | YES (nameless-or-placeholder) |
| (blank) | 9cf5610a | 1 | no | 2026-07-18T03:33:48.220Z | 2026-07-18T03:33:48.220Z | 0 | YES (nameless-or-placeholder) |
| Joe5 | a7944bd0 | 1 | yes | 2026-07-28T22:37:04.643Z | 2026-07-28T22:37:04.643Z | 0 | no |
| (blank) | aa2b5524 | 1 | no | 2026-07-18T02:23:58.372Z | 2026-07-18T02:23:58.372Z | 0 | YES (nameless-or-placeholder) |
| (blank) | acc42bee | 1 | no | 2026-07-18T19:51:24.141Z | 2026-07-18T19:51:24.141Z | 0 | YES (nameless-or-placeholder) |
| (blank) | b370fcf3 | 1 | no | 2026-07-17T16:44:05.196Z | 2026-07-17T16:44:05.196Z | 0 | YES (nameless-or-placeholder) |
| (blank) | b4507493 | 1 | no | 2026-07-19T18:49:58.837Z | 2026-07-19T18:49:58.837Z | 0 | YES (nameless-or-placeholder) |
| (blank) | b6aa2734 | 1 | no | 2026-07-18T02:18:09.375Z | 2026-07-18T02:18:09.375Z | 0 | YES (nameless-or-placeholder) |
| (blank) | bde5fb76 | 1 | no | 2026-07-18T01:20:19.898Z | 2026-07-18T01:20:19.898Z | 0 | YES (nameless-or-placeholder) |
| (blank) | beb378cf | 1 | no | 2026-07-22T19:44:00.680Z | 2026-07-22T19:44:00.680Z | 0 | YES (nameless-or-placeholder) |
| (blank) | c485bbb5 | 1 | no | 2026-07-22T07:20:33.899Z | 2026-07-22T07:20:33.899Z | 0 | YES (nameless-or-placeholder) |
| (blank) | c51221a9 | 1 | no | 2026-07-19T06:07:49.373Z | 2026-07-19T06:07:49.373Z | 0 | YES (nameless-or-placeholder) |
| (blank) | cdf49899 | 1 | no | 2026-07-22T05:01:01.828Z | 2026-07-22T05:01:01.828Z | 0 | YES (nameless-or-placeholder) |
| (blank) | d1967e15 | 1 | no | 2026-07-19T07:29:19.538Z | 2026-07-19T07:29:19.538Z | 0 | YES (nameless-or-placeholder) |
| (blank) | dbd49530 | 1 | no | 2026-07-22T09:05:58.930Z | 2026-07-22T09:05:58.930Z | 0 | YES (nameless-or-placeholder) |
| (blank) | dd2fd74d | 1 | no | 2026-07-29T21:03:06.690Z | 2026-07-29T21:03:06.690Z | 0 | YES (nameless-or-placeholder) |
| Joe | df18091c | 1 | yes | 2026-07-29T00:34:22.975Z | 2026-07-29T00:34:22.975Z | 0 | no |
| (blank) | dfcdc89e | 1 | no | 2026-07-22T06:01:13.649Z | 2026-07-22T06:01:13.649Z | 0 | YES (nameless-or-placeholder) |
| (blank) | e4c1f598 | 1 | no | 2026-07-19T07:15:52.021Z | 2026-07-19T07:15:52.021Z | 0 | YES (nameless-or-placeholder) |
| (blank) | e608877f | 1 | no | 2026-07-28T14:00:20.029Z | 2026-07-28T14:00:20.029Z | 0 | YES (nameless-or-placeholder) |
| (blank) | e6b670af | 1 | no | 2026-07-19T02:49:31.374Z | 2026-07-19T02:49:31.374Z | 0 | YES (nameless-or-placeholder) |
| (blank) | e92980cb | 1 | no | 2026-07-18T02:20:49.380Z | 2026-07-18T02:20:49.380Z | 0 | YES (nameless-or-placeholder) |
| (blank) | e9419a26 | 1 | no | 2026-07-29T01:13:50.832Z | 2026-07-29T01:13:50.832Z | 0 | YES (nameless-or-placeholder) |
| (blank) | ea838639 | 1 | no | 2026-07-17T23:36:55.393Z | 2026-07-17T23:36:55.393Z | 0 | YES (nameless-or-placeholder) |
| (blank) | edbe4b5f | 1 | no | 2026-07-29T00:02:25.569Z | 2026-07-29T00:02:25.569Z | 0 | YES (nameless-or-placeholder) |
| (blank) | f04fcc0f | 1 | no | 2026-07-15T20:34:15.364Z | 2026-07-15T20:34:15.364Z | 0 | YES (nameless-or-placeholder) |
| (blank) | f29d9f98 | 1 | no | 2026-07-19T18:54:29.709Z | 2026-07-19T18:54:29.709Z | 0 | YES (nameless-or-placeholder) |
| (blank) | f4dc1b50 | 1 | no | 2026-07-18T02:22:13.418Z | 2026-07-18T02:22:13.418Z | 0 | YES (nameless-or-placeholder) |
| (blank) | ff079dbe | 1 | no | 2026-07-18T01:00:23.235Z | 2026-07-18T01:00:23.235Z | 0 | YES (nameless-or-placeholder) |
| (blank) | ffa8db32 | 1 | no | 2026-07-29T02:57:19.101Z | 2026-07-29T02:57:19.101Z | 0 | YES (nameless-or-placeholder) |

## 4. Person x game matrix

Restricted to the 21 VISIBLE (non-hidden) players, using their real display names (these are the
same 21 rows from Section 3 with "Hidden from leaderboard" = no). Plays are summed across ALL of a
person's devices (the identity-graph aggregation from Section 3), so a person with multiple devices
is counted once, not once per device.

### Generated: Person x Game plays matrix (visible players only)

| Player | Connect Four | Chinchón | Monopoly Deal | Parchís | Nuts & Bolts | Escoba | Filler | Mancala | Ball Run | Tic Tac Toe | Dots and Boxes | Boggle | Snake | Uno | Pool | Pool (v2) | Yahtzee | Dominoes | Hill Climb | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| *TP* | 0 | 0 | 0 | 0 | 22 | 0 | 0 | 1 | 280 | 157 | 1 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 466 |
| King of Games | 123 | 12 | 2 | 3 | 1 | 1 | 4 | 16 | 10 | 54 | 6 | 4 | 7 | 3 | 0 | 0 | 4 | 0 | 2 | 252 |
| Anita Bonita | 0 | 2 | 2 | 1 | 1 | 7 | 2 | 1 | 8 | 0 | 1 | 2 | 7 | 0 | 0 | 0 | 0 | 0 | 2 | 36 |
| Lili | 2 | 0 | 0 | 0 | 51 | 54 | 4 | 1 | 3 | 5 | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 126 |
| MattyIce | 45 | 4 | 11 | 0 | 41 | 7 | 35 | 18 | 80 | 20 | 16 | 8 | 11 | 4 | 1 | 0 | 0 | 0 | 12 | 313 |
| Jojopow | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 280 | 5 | 5 | 0 | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 321 |
| Allie | 8 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 25 | 0 | 10 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 51 |
| hdj | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| Rick | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Natalia | 0 | 0 | 0 | 1 | 1 | 1 | 2 | 1 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 |
| Sam | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 69 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 69 |
| Ooo | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Andrew P | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 73 | 0 | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 78 |
| Bego | 0 | 0 | 0 | 1 | 47 | 0 | 0 | 11 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 62 |
| Unai | 0 | 0 | 0 | 0 | 0 | 1 | 2 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 15 |
| Joe5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Liz | 2 | 0 | 0 | 0 | 3 | 0 | 1 | 0 | 34 | 0 | 6 | 3 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 53 |
| Zed99 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Andrew Powell | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| Joe | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Brian Spalding | 33 | 0 | 0 | 0 | 2 | 0 | 4 | 1 | 53 | 3 | 4 | 0 | 9 | 1 | 0 | 0 | 0 | 0 | 0 | 110 |

### Generated: Win / Loss / Tie matrix, competitive games only (W-L-T format; tie = played-won-lost when not explicitly tracked)

| Player | Connect Four | Chinchón | Monopoly Deal | Parchís | Escoba | Filler | Mancala | Tic Tac Toe | Dots and Boxes | Boggle | Uno | Pool | Pool (v2) | Yahtzee | Dominoes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| *TP* | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-1-0 | 150-5-2 | 0-1-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| King of Games | 70-52-1 | 3-9-0 | 1-1-0 | 1-2-0 | 1-0-0 | 2-2-0 | 8-7-1 | 14-4-36 | 4-1-1 | 0-4-0 | 1-2-0 | 0-0-0 | 0-0-0 | 4-0-0 | 0-0-0 |
| Anita Bonita | 0-0-0 | 1-1-0 | 1-1-0 | 0-1-0 | 6-1-0 | 2-0-0 | 0-1-0 | 0-0-0 | 1-0-0 | 0-2-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Lili | 0-2-0 | 0-0-0 | 0-0-0 | 0-0-0 | 22-32-0 | 0-4-0 | 0-1-0 | 0-5-0 | 2-2-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| MattyIce | 18-27-0 | 2-2-0 | 7-4-0 | 0-0-0 | 5-2-0 | 26-9-0 | 9-8-1 | 11-7-2 | 9-7-0 | 1-6-1 | 0-4-0 | 1-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Jojopow | 0-9-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-5 | 2-2-1 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Allie | 0-8-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 3-3-0 | 0-0-0 | 0-0-0 | 2-8-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| hdj | 0-1-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Rick | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Natalia | 0-0-0 | 0-0-0 | 0-0-0 | 0-1-0 | 1-0-0 | 2-0-0 | 0-1-0 | 0-0-0 | 1-0-0 | 0-1-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Sam | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Ooo | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Andrew P | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 1-2-1 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Bego | 0-0-0 | 0-0-0 | 0-0-0 | 1-0-0 | 0-0-0 | 0-0-0 | 4-6-1 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Unai | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 1-0-0 | 0-2-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Joe5 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Liz | 0-2-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-1-0 | 0-0-0 | 0-0-0 | 3-2-1 | 1-2-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Zed99 | 0-0-0 | 0-1-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Andrew Powell | 0-1-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 1-2-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Joe | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |
| Brian Spalding | 4-29-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 3-1-0 | 0-1-0 | 0-3-0 | 2-1-1 | 0-0-0 | 1-0-0 | 0-0-0 | 0-0-0 | 0-0-0 | 0-0-0 |

## 5. Per-game hub-wide totals

Summed across the 21 visible players only (hidden/test/nameless records excluded — see Section 9
for what they would add if included). "Unique players with >0 plays" counts only visible players
who have at least one recorded play of that game. The `byDiff` distribution is the raw label:count
pairs actually stored (see Section 2.4 for what each label means) — nothing here is remapped onto
a 1-4 tier scale.

Note the two solo games with the largest volumes (Ball Run and Nuts & Bolts, plus Snake and Hill
Climb) show `won` exactly equal to `played` and `lost` at 0 — this is the solo-game shape from
Section 2.2, not a skill claim.

### Generated: Per-game hub-wide totals (visible players only)

| Game | Total plays | Total won | Total lost | Unique players with >0 plays | byDiff distribution (label:plays) |
|---|---|---|---|---|---|
| Connect Four (`connect4`) | 224 | 92 | 131 | 9 | easy:99, expert:12, hard:3, medium:110 |
| Chinchón (`chinchon`) | 19 | 6 | 13 | 4 | easy:5, hard:1, legacy:4, normal:9 |
| Monopoly Deal (`business`) | 15 | 9 | 6 | 3 | easy:1, legacy:4, normal:10 |
| Parchís (`parchis`) | 6 | 2 | 4 | 4 | beginner:1, intermediate:5 |
| Nuts & Bolts (`nutsbolts`) | 169 | 169 | 0 | 9 | easy:75, extrahard:3, hard:11, medium:8 |
| Escoba (`escoba`) | 71 | 36 | 35 | 6 | easy:7, hard:38, normal:26 |
| Filler (`filler`) | 60 | 38 | 22 | 9 | beginner:8, intermediate:28, mp:2, pro:22 |
| Mancala (`mancala`) | 50 | 21 | 26 | 8 | beginner:25, intermediate:11, pro:14 |
| Ball Run (`ballrun`) | 927 | 927 | 0 | 14 | easy:152, hard:566, medium:209 |
| Tic Tac Toe (`tictactoe`) | 247 | 176 | 26 | 7 | beginner:169, intermediate:42, mp:2, pro:34 |
| Dots and Boxes (`dotsboxes`) | 58 | 27 | 26 | 11 | beginner:8, intermediate:34, mp:12, pro:4 |
| Boggle (`boggle`) | 18 | 2 | 15 | 5 | beginner:4, intermediate:12, mp:2 |
| Snake (`snake`) | 72 | 72 | 0 | 11 | easy:36, hard:7, medium:29 |
| Uno (`uno`) | 8 | 2 | 6 | 3 | easy:3, hard:1, medium:4 |
| Pool (`pool`) | 1 | 1 | 0 | 1 | intermediate:1 |
| Pool (v2) (`poolv2`) | 0 | 0 | 0 | 0 | (none) |
| Yahtzee (`yahtzee`) | 4 | 4 | 0 | 1 | ai:4 |
| Dominoes (`dominoes`) | 0 | 0 | 0 | 0 | (none) |
| Hill Climb (`hillclimb`) | 26 | 26 | 0 | 5 | easy:26 |

## 6. Per-game deep tables

One subsection per game's own richer sub-counter (Section 2.5 defines each field and its kind:
cumulative, best, or explicit tie). Restricted to visible players with a NONZERO value in that
sub-counter — a player absent from one of these tables simply has all-zero values there, not
missing data. Games with no sub-counter richer than `total`/`byDiff` (Monopoly Deal, Parchís,
Filler, Mancala, Uno, Pool, Pool v2) have no subsection here; their totals are in Section 5 and
their W-L-T is in Section 4's second matrix.

### Generated: Per-game deep sub-counter dumps (visible players, nonzero rows only)

#### Connect Four — first-move grid (`grid`)

| Player | player-first easy | player-first medium | player-first hard | player-first expert | computer-first easy | computer-first medium | computer-first hard | computer-first expert |
|---|---|---|---|---|---|---|---|---|
| King of Games | 67-13 | 1-14 | 0-0 | 1-6 | 0-0 | 0-16 | 0-0 | 1-3 |
| Lili | 0-0 | 0-2 | 0-0 | 0-0 | 0-0 | 0-0 | 0-0 | 0-0 |
| MattyIce | 4-1 | 1-10 | 1-0 | 0-0 | 10-0 | 1-15 | 1-1 | 0-0 |
| Jojopow | 0-0 | 0-5 | 0-0 | 0-0 | 0-0 | 0-4 | 0-0 | 0-0 |
| Allie | 0-0 | 0-0 | 0-0 | 0-0 | 0-0 | 0-8 | 0-0 | 0-0 |
| hdj | 0-0 | 0-1 | 0-0 | 0-0 | 0-0 | 0-0 | 0-0 | 0-0 |
| Liz | 0-0 | 0-1 | 0-0 | 0-0 | 0-0 | 0-1 | 0-0 | 0-0 |
| Andrew Powell | 0-0 | 0-1 | 0-0 | 0-0 | 0-0 | 0-0 | 0-0 | 0-0 |
| Brian Spalding | 3-0 | 0-13 | 0-0 | 0-0 | 1-0 | 0-16 | 0-0 | 0-0 |

#### Chinchón — close-quality counters (`cc`)

| Player | closed | minusTen | chinchons |
|---|---|---|---|
| King of Games | 21 | 4 | 0 |
| Anita Bonita | 6 | 1 | 0 |
| MattyIce | 18 | 2 | 1 |

#### Escoba — escobas made (`es`)

| Player | escobas |
|---|---|
| King of Games | 7 |
| Anita Bonita | 61 |
| Lili | 382 |
| MattyIce | 41 |
| Natalia | 9 |
| Unai | 11 |

#### Nuts & Bolts — solo puzzle counters (`nb`)

| Player | solved | moves | bestLevel |
|---|---|---|---|
| *TP* | 22 | 280 | 21 |
| King of Games | 1 | 25 | 1 |
| Anita Bonita | 1 | 19 | 1 |
| Lili | 51 | 647 | 37 |
| MattyIce | 41 | 658 | 30 |
| Natalia | 1 | 19 | 1 |
| Bego | 47 | 978 | 18 |
| Liz | 3 | 18 | 3 |
| Brian Spalding | 2 | 46 | 2 |

#### Ball Run — Classic (`br`)

| Player | runs | bestObstacles | best easy | best medium | best hard |
|---|---|---|---|---|---|
| *TP* | 278 | 37 | 37 | 0 | 0 |
| King of Games | 10 | 209 | 209 | 56 | 82 |
| Anita Bonita | 8 | 39 | 0 | 20 | 39 |
| Lili | 3 | 19 | 0 | 19 | 0 |
| MattyIce | 52 | 164 | 164 | 109 | 129 |
| Jojopow | 262 | 76 | 39 | 55 | 76 |
| Allie | 25 | 76 | 19 | 41 | 76 |
| hdj | 1 | 7 | 7 | 0 | 0 |
| Rick | 8 | 41 | 13 | 41 | 0 |
| Sam | 69 | 44 | 0 | 18 | 44 |
| Andrew P | 73 | 181 | 181 | 120 | 120 |
| Unai | 3 | 48 | 0 | 48 | 0 |
| Liz | 34 | 57 | 21 | 57 | 19 |
| Brian Spalding | 53 | 111 | 0 | 0 | 111 |

#### Ball Run — Orbital map (`brOrbital`)

| Player | runs | bestObstacles | best easy | best medium | best hard |
|---|---|---|---|---|---|
| *TP* | 2 | 4 | 4 | 0 | 0 |
| MattyIce | 28 | 122 | 9 | 38 | 122 |
| Jojopow | 18 | 8 | 8 | 0 | 0 |

#### Ball Run — archived pre-migration METERS-based history (`brLegacyMeters`, NOT comparable to the obstacle-count metric above, THE LAW rule 4)

_No visible player has nonzero data here._

#### Tic Tac Toe — Classic vs Ultimate (`tt`)

| Player | classic W-L-T | ultimate W-L-T |
|---|---|---|
| *TP* | 150-5-2 | 0-0-0 |
| King of Games | 11-3-35 | 3-1-1 |
| Lili | 0-0-0 | 0-5-0 |
| MattyIce | 5-3-0 | 6-4-2 |
| Jojopow | 0-0-5 | 0-0-0 |
| Andrew Powell | 0-0-0 | 1-2-0 |
| Brian Spalding | 0-0-0 | 0-3-0 |

#### Dots and Boxes — match + capture stats (`db`)

| Player | W-L-T | boxesClaimed | bestChain |
|---|---|---|---|
| *TP* | 0-1-0 | 4 | 2 |
| King of Games | 4-1-1 | 66 | 9 |
| Anita Bonita | 1-0-0 | 13 | 10 |
| Lili | 2-2-0 | 39 | 10 |
| MattyIce | 9-7-0 | 98 | 15 |
| Jojopow | 2-2-1 | 33 | 6 |
| Allie | 2-8-0 | 63 | 5 |
| Natalia | 1-0-0 | 13 | 10 |
| Andrew P | 1-2-1 | 29 | 6 |
| Liz | 3-2-1 | 84 | 19 |
| Brian Spalding | 2-1-1 | 77 | 30 |

#### Boggle — words, best score, longest word (`bg`)

| Player | W-L-T | words | bestScore | longestWord |
|---|---|---|---|---|
| King of Games | 0-4-0 | 81 | 35 | GOOBER (6) |
| Anita Bonita | 0-2-0 | 29 | 18 | WORST (5) |
| MattyIce | 1-6-1 | 149 | 30 | CRANE (5) |
| Natalia | 0-1-0 | 13 | 16 | WORST (5) |
| Liz | 1-2-0 | 96 | 40 | SLATES (6) |

#### Snake — runs and length bests (`sn`)

| Player | runs | bestLen | runs walls-on | runs walls-off | bestLen walls-on | bestLen walls-off |
|---|---|---|---|---|---|---|
| *TP* | 5 | 28 | 0 | 5 | 0 | 28 |
| King of Games | 7 | 51 | 0 | 7 | 0 | 51 |
| Anita Bonita | 7 | 18 | 0 | 7 | 0 | 18 |
| Lili | 1 | 23 | 0 | 1 | 0 | 23 |
| MattyIce | 11 | 21 | 0 | 11 | 0 | 21 |
| Jojopow | 22 | 6 | 22 | 0 | 6 | 0 |
| Allie | 2 | 16 | 2 | 0 | 16 | 0 |
| Andrew P | 1 | 5 | 1 | 0 | 5 | 0 |
| Bego | 3 | 3 | 0 | 3 | 0 | 3 |
| Liz | 4 | 4 | 4 | 0 | 4 | 0 |
| Brian Spalding | 9 | 20 | 0 | 9 | 0 | 20 |

#### Yahtzee — Yahtzees scored and best game total (`yz`)

| Player | W-L-T | yahtzees | bestScore |
|---|---|---|---|
| King of Games | 4-0-0 | 0 | 255 |

#### Dominoes — rounds, points, best round (`dm`)

_No visible player has nonzero data here._

#### Hill Climb — per-stage bests, coins, flips (`hc`)

| Player | runs | bestDistance | countryside best | desert best | arctic best | moon best | coins | bestCoins | flips |
|---|---|---|---|---|---|---|---|---|---|
| King of Games | 2 | 522 | 522 | 0 | 0 | 0 | 895 | 695 | 0 |
| Anita Bonita | 2 | 165 | 165 | 0 | 0 | 0 | 250 | 190 | 0 |
| Lili | 1 | 253 | 253 | 0 | 0 | 0 | 360 | 360 | 0 |
| MattyIce | 12 | 2884 | 2884 | 0 | 0 | 0 | 10570 | 6035 | 0 |
| Unai | 9 | 1734 | 1734 | 0 | 0 | 0 | 6240 | 2520 | 0 |

## 7. Head-to-head

`recordHeadToHead()` (`js/game-stats.js`) writes a top-level `h2h: { [gameId]: { [opponentDeviceId]:
{ name, w, l } } }` node whenever Chinchón or Escoba's multiplayer engine finishes a match with a
known opponent. **Capture only started 2026-07-22.** Every multiplayer match played before that
date is permanently unrecoverable for head-to-head purposes — there is no way to reconstruct who
played whom from any other stored field. Rows are resolved to a display name where the opponent's
device is present in this snapshot; device ids are truncated to 8 characters (the same truncation
rule used throughout this document, not a player code).

Each row is one-directional as stored (device A's own record of its results against device B); the
same match, if both device A and B still hold their post-2026-07-22 record, shows up as one row on
each side, and the W/L should mirror each other (A's `w` against B should equal B's `l` against A).

**Cross-check result:** of the 18 h2h rows in this snapshot, 2 have no mirror record on the
opponent's side at all (device `0feee28f` and device `1f75ff86`, both currently named "Anita
Bonita" in their profile, each show a 1-0 Escoba result against MattyIce's device `dc1745bc`, but
`dc1745bc`'s own h2h has no corresponding entry against either of those two device ids — only
against `288dc3cd`/Lili). Of the 16 that do have a mirror, **14 are consistent (W/L exactly
swapped)** and **2 are inconsistent**: device `1f75ff86` (Anita Bonita) records 3-1 against
`288dc3cd` (Lili) in Escoba, while `288dc3cd` records 3-2 against `1f75ff86` (captured under the
opponent name "Natalia," not "Anita Bonita" — see below) for the same pairing; a perfect mirror
would need `1f75ff86`'s 1 loss to equal `288dc3cd`'s 1 win, but `288dc3cd` shows 3 wins there, not
1. **Likely mechanical cause, stated as an observation, not a fix:** `1f75ff86` is the same device
the repo's own CLAUDE.md documents as having been shared by two different people (Ana, then
Natalia) for about a week in July before Natalia got her own phone (see `js/CLAUDE.md`, "The
Ana/Natalia correction"). The h2h counters are per-DEVICE, not per-player-on-that-device, so a
week of matches recorded under one shared device id would blend whichever of the two people
actually played each match into one counter — exactly the same blending problem THE LAW's
per-player store split (Section 9, and `js/CLAUDE.md`) was built to prevent for the main stats
store, except `recordHeadToHead` predates that fix and was never retrofitted to it. This is also
almost certainly why the opponent name captured in `288dc3cd`'s own h2h record for this pairing
reads "Natalia" rather than "Anita Bonita" (the app captures whichever name was live on the
opposing device's profile at match time, and `1f75ff86` used to present as Natalia).

### Generated: Head-to-head (`h2h`) raw dump, resolved to owner name where known

| Owner device (owner name) | Game | Opponent deviceId (truncated) | Opponent name (as captured) | W | L |
|---|---|---|---|---|---|
| 0feee28f (Anita Bonita) | Escoba | dc1745bc | MattyIce | 1 | 0 |
| 1f75ff86 (Anita Bonita) | Escoba | 288dc3cd | Lili | 3 | 1 |
| 1f75ff86 (Anita Bonita) | Escoba | dc1745bc | MattyIce | 1 | 0 |
| 288dc3cd (Lili) | Escoba | 1f75ff86 | Natalia | 3 | 2 |
| 288dc3cd (Lili) | Escoba | a6a1f72b | Unai | 0 | 1 |
| 288dc3cd (Lili) | Escoba | dc1745bc | MattyIce | 1 | 0 |
| a6a1f72b (Unai) | Escoba | 288dc3cd | Lili | 1 | 0 |
| b033506a (Liz) | Boggle | dc1745bc | MattyIce | 1 | 0 |
| b033506a (Liz) | Dots and Boxes | dc1745bc | MattyIce | 2 | 1 |
| b033506a (Liz) | Dots and Boxes | f46d2144 | Brian Spalding | 1 | 1 |
| dc1745bc (MattyIce) | Boggle | b033506a | Liz | 0 | 1 |
| dc1745bc (MattyIce) | Dots and Boxes | b033506a | Liz | 1 | 2 |
| dc1745bc (MattyIce) | Escoba | 288dc3cd | Lili | 0 | 1 |
| dc1745bc (MattyIce) | Filler | f46d2144 | Brian Spalding | 1 | 0 |
| dc1745bc (MattyIce) | Tic Tac Toe | f46d2144 | Brian Spalding | 1 | 0 |
| f46d2144 (Brian Spalding) | Dots and Boxes | b033506a | Liz | 1 | 1 |
| f46d2144 (Brian Spalding) | Filler | dc1745bc | MattyIce | 0 | 1 |
| f46d2144 (Brian Spalding) | Tic Tac Toe | dc1745bc | MattyIce | 0 | 1 |


## 8. Leaderboard as the app computes it

The Game Hub's Leaderboard overlay (`js/leaderboard-ui.js`) redesigned itself 2026-07-23 to a
**wins-only display** — no win rate, no W-L record, no 0-100 rating anywhere in the live UI. Losses
and full records live on each player's own "My Stats" screen instead (Section 4's matrices are
this document's equivalent of that). Below is the actual live By Player board a player sees today
(the "All" difficulty filter, the default sort), reproduced by importing the app's own
`bucketsOf`/`winsAtTier`/`playedOf` logic against the visibility-filtered roster from Section 3.
`played` counts every game including solo runs; `wins` counts only the 15 competitive games (a
solo run is never a "win," by the repo's own explicit 2026-07-28 design decision).

### Generated: The ACTUAL live By Player Leaderboard (wins-only display, 2026-07-23 redesign, default sort = Games Played)

This is what a player opening the Leaderboard overlay today actually sees (all-tier "All" filter, default sort). Columns: `played` = plays across all 19 games including solo runs; `wins` = wins summed across COMPETITIVE games only (a solo run is never a win, HANDOFF-LB-SOLO-RUNS.md).

| Rank | Player | Played (all games) | Wins (competitive only) |
|---|---|---|---|
| 1 | *TP* | 466 | 150 |
| 2 | Jojopow | 321 | 2 |
| 3 | MattyIce | 313 | 89 |
| 4 | King of Games | 252 | 109 |
| 5 | Lili | 126 | 24 |
| 6 | Brian Spalding | 110 | 10 |
| 7 | Andrew P | 78 | 1 |
| 8 | Sam | 69 | 0 |
| 9 | Bego | 62 | 5 |
| 10 | Liz | 53 | 4 |
| 11 | Allie | 51 | 5 |
| 12 | Anita Bonita | 36 | 11 |
| 13 | Unai | 15 | 1 |
| 14 | Natalia | 8 | 4 |
| 15 | Rick | 8 | 0 |
| 16 | Andrew Powell | 4 | 1 |
| 17 | hdj | 2 | 0 |
| 18 | Zed99 | 1 | 0 |
| 19 | Ooo | 0 | 0 |
| 20 | Joe | 0 | 0 |
| 21 | Joe5 | 0 | 0 |

### 8.1 The retired 0-100 rating model (not shown in the live UI, included here for completeness)

`js/leaderboard-rank.js`'s Wilson-score/difficulty-weighted rating engine still exists in the repo
and is still exercised by its own test suite, but its output has not been shown on the Leaderboard
screen since the 2026-07-23 redesign above. It is included here only because the module is still
live code, not because a player can currently see it anywhere in the app.

### Generated: Leaderboard as leaderboard-rank.js computes it (visible players, rating model — NOTE: retired from the live UI display 2026-07-23, shown here for completeness since the module is still exercised)

| Rank | Player | Rating (0-100, null=unrated) | Total rated plays | Provisional (<5 plays)? |
|---|---|---|---|---|
| 1 | Andrew P | 72 | 78 | no |
| 2 | Bego | 64 | 62 | no |
| 3 | MattyIce | 54 | 285 | no |
| 4 | Lili | 52 | 126 | no |
| 5 | King of Games | 36 | 252 | no |
| 6 | *TP* | 35 | 464 | no |
| 7 | Jojopow | 28 | 303 | no |
| 8 | Brian Spalding | 27 | 110 | no |
| 9 | Anita Bonita | 24 | 36 | no |
| 10 | Unai | 22 | 15 | no |
| 11 | Natalia | 21 | 8 | no |
| 12 | Allie | 15 | 51 | no |
| 13 | Sam | 13 | 69 | no |
| 14 | Liz | 13 | 53 | no |
| 15 | Rick | 5 | 8 | no |
| 16 | Andrew Powell | 3 | 4 | yes |
| 17 | hdj | 0 | 2 | yes |
| 18 | Zed99 | 0 | 1 | yes |
| 19 | Ooo | n/a | 0 | no |
| 20 | Joe | n/a | 0 | no |
| 21 | Joe5 | n/a | 0 | no |


## 9. Excluded and anomalous records

Nothing described here is deleted anywhere — every record stays fully synced in Firebase and fully
visible on its own device's My Stats screen. "Excluded" means omitted from the shared Leaderboard
overlay only, exactly as `js/leaderboard-ui.js` behaves.

### 9.1 Excluded by device-id prefix (`HIDDEN_PREFIX`)

`js/leaderboard-ui.js`'s `HIDDEN_PREFIX` list is `['4392d978', 'f8ad1b82', 'zzz-prev']`. Of these,
only ONE matching device exists in the LIVE `players/` node in this snapshot (the other two prefix
targets exist only in the separate `archive/players` node — see 9.4):

| Device id (truncated) | Profile name at capture | Has player code | Total plays | Reason |
|---|---|---|---|---|
| `f8ad1b82` | test | yes | 4 | `HIDDEN_PREFIX` match (also independently matches the name-prefix rule below — this device is doubly excluded) |

### 9.2 Excluded by aggregated display name (`HIDDEN_NAMES` exact set, or `HIDDEN_NAME_PREFIX`)

`HIDDEN_NAMES` = `{qa, dev, demo, preview, prueba}` (exact match, case-insensitive). None of these
exact names appear in this snapshot's visible-candidate pool. `HIDDEN_NAME_PREFIX` = `{test, zzz}`
(prefix match) DID match three aggregated person-groups:

| Display name | Devices | Total plays (all games, all their devices) | Reason |
|---|---|---|---|
| Tester | 1 | 6 | starts with "test" |
| test | 2 | 4 | starts with "test" (includes the `f8ad1b82` device from 9.1) |
| TestPlayer | 4 | 3 | starts with "test" |

### 9.3 Excluded as nameless (blank name, or the literal placeholder "You")

`isHiddenRow()` treats a blank/whitespace-only name, or the exact placeholder "You" (the
`profile-store.js` default written when a name is left blank), as unrenderable. **74 of the 98
aggregated person-groups in this snapshot fall into this bucket** — nearly all of them are
single-device, all-zero or near-zero-play records, consistent with the repo's own documented
history: before the 2026-07-31 name-gate fix, every game's standalone page (and the two
classic-script apps) was reachable without ever setting a profile name, so a device could sync a
nameless record just by being opened. Full breakdown:

- **63 groups with ZERO total plays** — single devices that appear to have loaded the app (enough
  to sync an empty stats record and a profile) but never finished a single game. Full list with
  timestamps is in the Appendix (Section 11) and in the roster (Section 3); not reproduced row-by-
  row here since every one of them carries a `0` in every column.
- **11 groups with nonzero plays**, listed here in full since a nonzero record deserves its own
  line even though its owner never set a name:

  | Total plays (all their devices) | Devices |
  |---|---|
  | 16 | 1 |
  | 3 | 1 |
  | 3 | 1 |
  | 2 | 1 |
  | 2 | 1 |
  | 2 | 1 |
  | 2 | 1 |
  | 1 | 1 |
  | 1 | 1 |
  | 1 | 1 |
  | 1 | 1 |

- **1 group under the exact placeholder name "You"** (2 devices, 0 total plays) — the repo's own
  `profile-store.js` default when a name field is saved blank; explicitly checked for and hidden
  by `isHiddenRow()` regardless of the blank-name check (belt-and-suspenders in the app's own
  code).

Combined, these 74 nameless-or-placeholder groups account for **34 total plays** out of the
snapshot's 2,022 raw total (Section 1) — 1.7% of all recorded history, currently invisible to the
shared Leaderboard and permanently so unless their owner names themselves (at which point the
app's own identity graph reattaches the exact same untouched record to their real row — nothing
is migrated or copied to make that happen, per `js/CLAUDE.md`'s "Nameless devices" section).

### 9.4 The separate `archive/players` node (4 records, not part of the live `players/` node)

Found while exploring the snapshot (see Section 1); not documented in any schema source this pass
was told to read, and its origin/authorship is unknown to this pass. Reported here in full since
nothing found should be silently dropped:

| Device id (truncated) | Profile name | Player code | Total plays | Also present live? |
|---|---|---|---|---|
| `0fb1c3ff` | Random Player | no | 0 | no |
| `4392d978` | Tester | no | 6 | no — this is the SAME device id `HIDDEN_PREFIX` targets, but it does not exist in the live `players/` node in this snapshot |
| `f8ad1b82` | test1 | no | 0 | **yes** — same device id as 9.1's live "test" record, but this archived copy's name ("test1") and play count (0) DIFFER from the live record ("test", 4 plays). This is either a copy taken before that device's later activity, or two out-of-step copies of the same id; this pass cannot determine which without knowing what wrote the archive node |
| `zzz-preview-FRESH-DELETEME` | PreviewBot | yes (`ABCDE`, a placeholder-looking code) | 0 | no |

None of these four contribute to any total elsewhere in this document — they are outside the live
`players/` node this document's totals are built from.

### 9.5 Other anomalies observed (flagged, not corrected)

- **A hand-crafted-looking device id: `d2`.** Every other device id in this snapshot is either a
  `crypto.randomUUID()` string or the app's own fallback shape (`'d-' + random`) — see
  `js/game-stats.js`'s `deviceId()`. One record's id is the literal two characters `d2`, which
  matches neither pattern. It carries `profile: {name: "Mattyice", emoji: "🎯", playerId: ""}`
  (no player code) and **0 total plays**, and is folded into the "MattyIce" roster row (Section 3)
  purely by NAME match (the identity graph's name-based union, since it has no code to match on).
  It contributes nothing to any total in this document, but its id shape strongly suggests it was
  created outside the app's normal client flow (e.g. written directly into Firebase by hand, for
  testing) rather than by a real device. Flagged for awareness; not excluded by any existing rule,
  since `HIDDEN_PREFIX`/`HIDDEN_NAMES`/`HIDDEN_NAME_PREFIX` all key off name or a specific id
  prefix, neither of which this record matches.
- **A device-name-registry oddity: `*tp*`.** `usernames/` (the app's name-reservation registry)
  holds an entry for the literal string `*tp*` (asterisks included), reserved for a player code
  linked to a person displayed in this document as "*TP*" — the single highest-volume visible
  player in the whole snapshot (466 total plays across every game, one device). Every other
  registry entry in this snapshot is an ordinary first name. Whether the asterisks are a
  deliberate stylistic choice or a data-entry artifact cannot be determined from this data alone.
- **"Zed99"** appears in this snapshot as a visible, 1-play, single-device, code-less record. The
  repo's own `js/CLAUDE.md` ("Hiding test/debug accounts from the leaderboard") names "Zed99" as
  one of several stray test/debug records found and hand-added to `HIDDEN_PREFIX` "on 2026-07-29."
  No entry for it exists in the CURRENT `HIDDEN_PREFIX` list (`4392d978`, `f8ad1b82`, `zzz-prev`),
  so if this is the same stray record the earlier fix referenced, it is not (or no longer)
  excluded by the live code, and it currently renders on the shared Leaderboard.
- **`h2h` (head-to-head) count asymmetry** — see Section 7 for the full detail: two of Escoba's
  h2h rows for the shared device `1f75ff86` (the device the repo's CLAUDE.md documents as having
  been used by two different people, Ana then Natalia, before per-player store splitting existed)
  do not mirror their counterpart's W/L, most likely because `recordHeadToHead` writes per-DEVICE
  counters and was never retrofitted to the later per-player store split.
- **Duplicate-looking / multi-device identities are not necessarily errors** — MattyIce (5
  devices), Anita Bonita (3 devices), King of Games (2 devices), Lili (2 devices) are exactly the
  kind of multi-device consolidation `players-agg.js`'s identity graph exists to produce
  correctly (one person, several phones/browsers, linked by a shared player code). They are noted
  here only so the analyst does not mistake "multiple devices" itself for an anomaly; nothing
  about these four groups otherwise stood out.
- **Stale record (no `updatedAt` in over a week):** among the 21 VISIBLE players, only "Natalia"
  has not synced since more than 7 days before this snapshot (last activity 2026-07-23, 11.6 days
  before the 2026-08-03 capture). Every other visible player's most recent device sync falls
  within that same 7-day window. Per Section 10, a device that has never been online since a play
  is simply absent from Firebase entirely — this staleness note is about a device that IS present
  but hasn't synced recently, which is a different and much weaker signal than "hasn't played."

## 10. Blind spots — what is NOT in this dataset

This section exists so an analyst working from this document alone knows where its edges are.
Every key below was confirmed to exist by grepping the actual source (`grep -rl` for the literal
key strings across every `.js` file in the repo, excluding `node_modules` and `backups/`), not
assumed from memory.

- **Every per-game SETTINGS store is local-only and never reaches Firebase.** These hold UI
  preferences (difficulty picker last choice, sound on/off, board size, etc.), not history, and
  are never synced:
  - The current convention, `gamehub.<game>.v1`, used by: `filler`, `mancala`, `nutsbolts`,
    `dotsboxes`, `boggle`, `snake`, `uno`, `pool`, `dominoes`, `tictactoe`, `hillclimb`.
  - Three older, frozen (never renamed, per THE LAW rule 5) generations: `escoba-settings`,
    `chinchon-settings` (dashed, un-namespaced), and `ballrun.*` (dotted, un-namespaced).
  - `parchis_r2_prefs` (Parchís's own, from its separately-built source).
  - **None of these are observable centrally at all**, except for the 5 devices captured in
    `deviceReports/` (Section 1), whose reports include a raw dump of every `localStorage` key on
    that specific device at the moment it was captured — a narrow, one-time, opt-in exception, not
    a general channel.
- **Hub-level preferences, also local-only, also never synced:** `gamehub.favorites.v1` (launcher
  favorites), `gamehub.lang.v1` (EN/ES choice), `gamehub.theme.v1` (light/dark/auto),
  `gamehub.lb.sort.v1` (the Leaderboard's own sort-order preference). All four are explicitly
  documented in the repo as preferences, not history — THE LAW's rule-2 carve-out.
- **`gamehub.stats.owner.v1` and `gamehub.stats.forks.v1`** — device-local bookkeeping for the
  per-player store split (which player code "owns" a device's original stats store, and a log of
  every additional player who has ever recorded on that device). Diagnostic only; never synced to
  Firebase, so this document cannot show which of a device's game records belong to which
  co-located player beyond what the `players/<deviceId>-<CODE>` split already exposes for players
  who have their OWN player code.
- **Two frozen legacy stats keys, folded into the unified store exactly once and then left in
  place:** `bd-stats` (Monopoly Deal's pre-unification store) and `chinchon-stats` (Chinchón's).
  Both are local-only; their one-time fold into `gamehub.stats`'s `legacy` byDiff bucket (Section
  2.4) is the only trace of them that reaches this document.
- **`gamehub.bd.pendingStats.v1`** — a local-only queue Monopoly Deal writes to when its own stats
  recorder was unavailable at game-end (e.g. offline, or a stale service-worker cache); drained
  into the unified store on the next hub load. If a device is captured mid-queue, this document's
  numbers for that device would be short by whatever is still queued — invisible from Firebase
  alone.
- **Hill Climb's spendable coin WALLET is deliberately excluded from the shared store.**
  `gamehub.hillclimb.v1` (local-only) holds the player's current spendable coin balance, which can
  go DOWN (spent on upgrades) — by design, only monotonically-increasing lifetime totals
  (`hc.coins`, `hc.bestCoins`, both in this document's Section 6) are ever written to the synced
  store, specifically so nothing that can decrease is ever mirrored. This document therefore has
  no visibility into any player's current Hill Climb wallet balance or spending history at all.
- **No per-play event log exists anywhere in this system** — only cumulative counters and bests.
  Concretely, this means the following are permanently unrecoverable from any data source this
  pass had access to, for every game and every player: exact play timestamps (only a single
  whole-device `updatedAt`, refreshed on every write, survives — not one per play), session
  length, the sequence in which games/rounds were played, win/loss streaks, and time-of-day or
  day-of-week patterns.
- **Absence is not proof of non-play.** A device that has played real games but has never been
  online since (or was never online at all — offline play is fully supported) simply does not
  appear in `players/` yet. Every "0 plays" or missing-game entry in this document reflects
  "nothing has synced," which is not the same claim as "nothing was played."
- **Multiplayer room data (`rooms/`) is a live-session artifact, not a stats source, and is mostly
  stale by the time it is read.** Of the 57 room records in this snapshot: 42 are `status: ended`,
  8 `active`, 7 `waiting`; by game, 42 are Escoba, 7 Chinchón, 3 Dots and Boxes, 2 Tic Tac Toe, and
  1 each of Filler, Yahtzee, Boggle. 25 of the 57 contain a nonzero move log; 32 have none (likely
  abandoned before a first move, or a lobby that never started). Nothing in `rooms/` is additive
  history in the sense the rest of this document is — a room's own move log is the authoritative
  record of exactly one match and is superseded once that match's result is committed to the
  players' own `h2h`/`stats` nodes (Section 7). This document does not attempt to replay any room's
  move log into a result, since the outcome (if the match finished and stats were committed) is
  already captured properly in Section 4/6/7, and if it wasn't committed, the room record alone
  cannot prove why.
- **`deviceReports/` covers only 5 of the 111 devices in this snapshot** — an opt-in diagnostic a
  player or Matt triggers manually from the profile page, not a background collector. It is the
  ONLY source in this whole dataset that exposes local-only keys at all, and only for those 5
  devices, only as of whenever each report happened to be captured (this snapshot's 5 reports were
  each captured once, between 2026-07-22 and 2026-07-25). It is not a substitute for a general
  local-storage-to-Firebase channel, because none exists.

## 11. Appendix — full per-person, per-game, per-metric data

Compact JSON, ONE object per visible person (the same 21 rows as Sections 4/6/8), covering every
game and every sub-counter this document discusses. Field meanings are exactly as defined in
Section 2. `hasCode` is a boolean, never the code's own value, per this document's hard constraint
against printing player codes. This is the same aggregated data every table above was generated
from — an analyst can recompute any total, matrix, or per-game breakdown in this document directly
from this block, with no other access to the repository or database required.

```json
[{"name":"*TP*","devices":1,"hasCode":true,"updatedAt":1785607757128,"totalPlaysAllGames":466,"totalWonAllGames":457,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":22,"won":22,"lost":0},"byDiff":{"easy":{"played":21,"won":21,"lost":0},"hard":{"played":1,"won":1,"lost":0}},"nb":{"solved":22,"moves":280,"bestLevel":21}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"beginner":{"played":1,"won":0,"lost":1}}},"ballrun":{"total":{"played":280,"won":280,"lost":0},"byDiff":{"easy":{"played":43,"won":43,"lost":0},"hard":{"played":237,"won":237,"lost":0}},"br":{"runs":278,"bestObstacles":37,"bestObstaclesByDiff":{"easy":37,"hard":0,"medium":0}},"brOrbital":{"runs":2,"bestObstacles":4,"bestObstaclesByDiff":{"easy":4,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":157,"won":150,"lost":5},"byDiff":{"beginner":{"played":157,"won":150,"lost":5}},"tt":{"classic":{"played":157,"won":150,"lost":5,"tied":2},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"beginner":{"played":1,"won":0,"lost":1}},"db":{"played":1,"won":0,"lost":1,"tied":0,"boxes":4,"bestChain":2}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":5,"won":5,"lost":0},"byDiff":{"easy":{"played":5,"won":5,"lost":0}},"sn":{"runs":5,"bestLen":28,"bestLenByDiff":{"easy":28,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":28},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":28,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":5}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"King of Games","devices":2,"hasCode":true,"updatedAt":1785716736937,"totalPlaysAllGames":252,"totalWonAllGames":129,"games":{"connect4":{"total":{"played":123,"won":70,"lost":52},"byDiff":{"easy":{"played":80,"won":67,"lost":13},"expert":{"played":12,"won":2,"lost":9},"medium":{"played":31,"won":1,"lost":30}},"grid":{"player":{"easy":{"w":67,"l":13},"medium":{"w":1,"l":14},"hard":{"w":0,"l":0},"expert":{"w":1,"l":6}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":16},"hard":{"w":0,"l":0},"expert":{"w":1,"l":3}}}},"chinchon":{"total":{"played":12,"won":3,"lost":9},"byDiff":{"easy":{"played":5,"won":2,"lost":3},"normal":{"played":7,"won":1,"lost":6}},"cc":{"closed":21,"minusTen":4,"chinchons":0}},"business":{"total":{"played":2,"won":1,"lost":1},"byDiff":{"easy":{"played":1,"won":1,"lost":0},"normal":{"played":1,"won":0,"lost":1}}},"parchis":{"total":{"played":3,"won":1,"lost":2},"byDiff":{"beginner":{"played":1,"won":1,"lost":0},"intermediate":{"played":2,"won":0,"lost":2}}},"nutsbolts":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"hard":{"played":1,"won":1,"lost":0}},"nb":{"solved":1,"moves":25,"bestLevel":1}},"escoba":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"easy":{"played":1,"won":1,"lost":0}},"es":{"escobas":7}},"filler":{"total":{"played":4,"won":2,"lost":2},"byDiff":{"beginner":{"played":2,"won":2,"lost":0},"pro":{"played":2,"won":0,"lost":2}}},"mancala":{"total":{"played":16,"won":8,"lost":7},"byDiff":{"beginner":{"played":5,"won":5,"lost":0},"intermediate":{"played":3,"won":3,"lost":0},"pro":{"played":8,"won":0,"lost":7}}},"ballrun":{"total":{"played":10,"won":10,"lost":0},"byDiff":{"easy":{"played":5,"won":5,"lost":0},"hard":{"played":3,"won":3,"lost":0},"medium":{"played":2,"won":2,"lost":0}},"br":{"runs":10,"bestObstacles":209,"bestObstaclesByDiff":{"easy":209,"hard":82,"medium":56}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":54,"won":14,"lost":4},"byDiff":{"beginner":{"played":4,"won":3,"lost":0},"intermediate":{"played":16,"won":11,"lost":1},"pro":{"played":34,"won":0,"lost":3}},"tt":{"classic":{"played":49,"won":11,"lost":3,"tied":35},"ultimate":{"played":5,"won":3,"lost":1,"tied":1}}},"dotsboxes":{"total":{"played":6,"won":4,"lost":1},"byDiff":{"beginner":{"played":4,"won":4,"lost":0},"intermediate":{"played":2,"won":0,"lost":1}},"db":{"played":6,"won":4,"lost":1,"tied":1,"boxes":66,"bestChain":9}},"boggle":{"total":{"played":4,"won":0,"lost":4},"byDiff":{"intermediate":{"played":4,"won":0,"lost":4}},"bg":{"played":4,"won":0,"lost":4,"tied":0,"words":81,"bestScore":35,"longestWord":{"word":"GOOBER","len":6}}},"snake":{"total":{"played":7,"won":7,"lost":0},"byDiff":{"easy":{"played":2,"won":2,"lost":0},"hard":{"played":5,"won":5,"lost":0}},"sn":{"runs":7,"bestLen":51,"bestLenByDiff":{"easy":51,"hard":6,"medium":0},"bestLenByWalls":{"on":0,"off":51},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":51,"hard":6,"medium":0}},"runsByWalls":{"on":0,"off":7}}},"uno":{"total":{"played":3,"won":1,"lost":2},"byDiff":{"easy":{"played":2,"won":1,"lost":1},"hard":{"played":1,"won":0,"lost":1}}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":4,"won":4,"lost":0},"byDiff":{"ai":{"played":4,"won":4,"lost":0}},"yz":{"played":4,"won":4,"lost":0,"tied":0,"yahtzees":0,"bestScore":255}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"dm":{"played":0,"won":0,"lost":0,"tied":0,"rounds":0,"bestRound":0,"points":0}},"hillclimb":{"total":{"played":2,"won":2,"lost":0},"byDiff":{"easy":{"played":2,"won":2,"lost":0}},"hc":{"runs":2,"bestDistance":522,"bestDistanceByStage":{"arctic":0,"countryside":522,"desert":0,"moon":0},"coins":895,"bestCoins":695,"flips":0}}}},{"name":"Anita Bonita","devices":3,"hasCode":true,"updatedAt":1785748700496,"totalPlaysAllGames":36,"totalWonAllGames":29,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":2,"won":1,"lost":1},"byDiff":{"legacy":{"played":1,"won":1,"lost":0},"normal":{"played":1,"won":0,"lost":1}},"cc":{"closed":6,"minusTen":1,"chinchons":0}},"business":{"total":{"played":2,"won":1,"lost":1},"byDiff":{"normal":{"played":2,"won":1,"lost":1}}},"parchis":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"intermediate":{"played":1,"won":0,"lost":1}}},"nutsbolts":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"medium":{"played":1,"won":1,"lost":0}},"nb":{"solved":1,"moves":19,"bestLevel":1}},"escoba":{"total":{"played":7,"won":6,"lost":1},"byDiff":{"normal":{"played":6,"won":5,"lost":1},"easy":{"played":1,"won":1,"lost":0}},"es":{"escobas":61}},"filler":{"total":{"played":2,"won":2,"lost":0},"byDiff":{"intermediate":{"played":2,"won":2,"lost":0}}},"mancala":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"beginner":{"played":1,"won":0,"lost":1}}},"ballrun":{"total":{"played":8,"won":8,"lost":0},"byDiff":{"hard":{"played":2,"won":2,"lost":0},"medium":{"played":6,"won":6,"lost":0}},"br":{"runs":8,"bestObstacles":39,"bestObstaclesByDiff":{"easy":0,"hard":39,"medium":20}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"intermediate":{"played":1,"won":1,"lost":0}},"db":{"played":1,"won":1,"lost":0,"tied":0,"boxes":13,"bestChain":10}},"boggle":{"total":{"played":2,"won":0,"lost":2},"byDiff":{"intermediate":{"played":2,"won":0,"lost":2}},"bg":{"played":2,"won":0,"lost":2,"tied":0,"words":29,"bestScore":18,"longestWord":{"word":"WORST","len":5}}},"snake":{"total":{"played":7,"won":7,"lost":0},"byDiff":{"medium":{"played":7,"won":7,"lost":0}},"sn":{"runs":7,"bestLen":18,"bestLenByDiff":{"easy":0,"hard":0,"medium":18},"bestLenByWalls":{"on":0,"off":18},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":18}},"runsByWalls":{"on":0,"off":7}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"dm":{"played":0,"won":0,"lost":0,"tied":0,"rounds":0,"bestRound":0,"points":0}},"hillclimb":{"total":{"played":2,"won":2,"lost":0},"byDiff":{"easy":{"played":2,"won":2,"lost":0}},"hc":{"runs":2,"bestDistance":165,"bestDistanceByStage":{"arctic":0,"countryside":165,"desert":0,"moon":0},"coins":250,"bestCoins":190,"flips":0}}}},{"name":"Lili","devices":2,"hasCode":true,"updatedAt":1785768962515,"totalPlaysAllGames":126,"totalWonAllGames":80,"games":{"connect4":{"total":{"played":2,"won":0,"lost":2},"byDiff":{"medium":{"played":2,"won":0,"lost":2}},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":2},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":51,"won":51,"lost":0},"byDiff":{"easy":{"played":51,"won":51,"lost":0}},"nb":{"solved":51,"moves":647,"bestLevel":37}},"escoba":{"total":{"played":54,"won":22,"lost":32},"byDiff":{"hard":{"played":38,"won":11,"lost":27},"normal":{"played":16,"won":11,"lost":5}},"es":{"escobas":382}},"filler":{"total":{"played":4,"won":0,"lost":4},"byDiff":{"beginner":{"played":2,"won":0,"lost":2},"intermediate":{"played":2,"won":0,"lost":2}}},"mancala":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"intermediate":{"played":1,"won":0,"lost":1}}},"ballrun":{"total":{"played":3,"won":3,"lost":0},"byDiff":{"medium":{"played":3,"won":3,"lost":0}},"br":{"runs":3,"bestObstacles":19,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":19}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":5,"won":0,"lost":5},"byDiff":{"intermediate":{"played":5,"won":0,"lost":5}},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":5,"won":0,"lost":5,"tied":0}}},"dotsboxes":{"total":{"played":4,"won":2,"lost":2},"byDiff":{"intermediate":{"played":4,"won":2,"lost":2}},"db":{"played":4,"won":2,"lost":2,"tied":0,"boxes":39,"bestChain":10}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"medium":{"played":1,"won":1,"lost":0}},"sn":{"runs":1,"bestLen":23,"bestLenByDiff":{"easy":0,"hard":0,"medium":23},"bestLenByWalls":{"on":0,"off":23},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":23}},"runsByWalls":{"on":0,"off":1}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"dm":{"played":0,"won":0,"lost":0,"tied":0,"rounds":0,"bestRound":0,"points":0}},"hillclimb":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"easy":{"played":1,"won":1,"lost":0}},"hc":{"runs":1,"bestDistance":253,"bestDistanceByStage":{"arctic":0,"countryside":253,"desert":0,"moon":0},"coins":360,"bestCoins":360,"flips":0}}}},{"name":"MattyIce","devices":5,"hasCode":true,"updatedAt":1785769347619,"totalPlaysAllGames":313,"totalWonAllGames":233,"games":{"connect4":{"total":{"played":45,"won":18,"lost":27},"byDiff":{"easy":{"played":15,"won":14,"lost":1},"hard":{"played":3,"won":2,"lost":1},"medium":{"played":27,"won":2,"lost":25}},"grid":{"player":{"easy":{"w":4,"l":1},"medium":{"w":1,"l":10},"hard":{"w":1,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":10,"l":0},"medium":{"w":1,"l":15},"hard":{"w":1,"l":1},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":4,"won":2,"lost":2},"byDiff":{"hard":{"played":1,"won":0,"lost":1},"normal":{"played":1,"won":0,"lost":1},"legacy":{"played":2,"won":2,"lost":0}},"cc":{"closed":18,"minusTen":2,"chinchons":1}},"business":{"total":{"played":11,"won":7,"lost":4},"byDiff":{"normal":{"played":7,"won":3,"lost":4},"legacy":{"played":4,"won":4,"lost":0}}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":41,"won":41,"lost":0},"byDiff":{"extrahard":{"played":3,"won":3,"lost":0},"hard":{"played":6,"won":6,"lost":0},"medium":{"played":2,"won":2,"lost":0}},"nb":{"solved":41,"moves":658,"bestLevel":30}},"escoba":{"total":{"played":7,"won":5,"lost":2},"byDiff":{"easy":{"played":4,"won":3,"lost":1},"normal":{"played":3,"won":2,"lost":1}},"es":{"escobas":41}},"filler":{"total":{"played":35,"won":26,"lost":9},"byDiff":{"beginner":{"played":4,"won":3,"lost":1},"intermediate":{"played":10,"won":8,"lost":2},"mp":{"played":1,"won":1,"lost":0},"pro":{"played":20,"won":14,"lost":6}}},"mancala":{"total":{"played":18,"won":9,"lost":8},"byDiff":{"intermediate":{"played":6,"won":3,"lost":3},"beginner":{"played":6,"won":6,"lost":0},"pro":{"played":6,"won":0,"lost":5}}},"ballrun":{"total":{"played":80,"won":80,"lost":0},"byDiff":{"medium":{"played":18,"won":18,"lost":0},"easy":{"played":33,"won":33,"lost":0},"hard":{"played":29,"won":29,"lost":0}},"br":{"runs":52,"bestObstacles":164,"bestObstaclesByDiff":{"easy":164,"hard":129,"medium":109}},"brOrbital":{"runs":28,"bestObstacles":122,"bestObstaclesByDiff":{"easy":9,"hard":122,"medium":38}}},"tictactoe":{"total":{"played":20,"won":11,"lost":7},"byDiff":{"beginner":{"played":7,"won":7,"lost":0},"intermediate":{"played":12,"won":3,"lost":7},"mp":{"played":1,"won":1,"lost":0}},"tt":{"classic":{"played":8,"won":5,"lost":3,"tied":0},"ultimate":{"played":12,"won":6,"lost":4,"tied":2}}},"dotsboxes":{"total":{"played":16,"won":9,"lost":7},"byDiff":{"beginner":{"played":3,"won":2,"lost":1},"intermediate":{"played":6,"won":4,"lost":2},"mp":{"played":3,"won":1,"lost":2},"pro":{"played":4,"won":2,"lost":2}},"db":{"played":16,"won":9,"lost":7,"tied":0,"boxes":98,"bestChain":15}},"boggle":{"total":{"played":8,"won":1,"lost":6},"byDiff":{"beginner":{"played":4,"won":1,"lost":2},"intermediate":{"played":3,"won":0,"lost":3},"mp":{"played":1,"won":0,"lost":1}},"bg":{"played":8,"won":1,"lost":6,"tied":1,"words":149,"bestScore":30,"longestWord":{"word":"CRANE","len":5}}},"snake":{"total":{"played":11,"won":11,"lost":0},"byDiff":{"easy":{"played":7,"won":7,"lost":0},"hard":{"played":2,"won":2,"lost":0},"medium":{"played":2,"won":2,"lost":0}},"sn":{"runs":11,"bestLen":21,"bestLenByDiff":{"easy":21,"hard":8,"medium":18},"bestLenByWalls":{"on":0,"off":21},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":21,"hard":8,"medium":18}},"runsByWalls":{"on":0,"off":11}}},"uno":{"total":{"played":4,"won":0,"lost":4},"byDiff":{"easy":{"played":1,"won":0,"lost":1},"medium":{"played":3,"won":0,"lost":3}}},"pool":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"intermediate":{"played":1,"won":1,"lost":0}}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"dm":{"played":0,"won":0,"lost":0,"tied":0,"rounds":0,"bestRound":0,"points":0}},"hillclimb":{"total":{"played":12,"won":12,"lost":0},"byDiff":{"easy":{"played":12,"won":12,"lost":0}},"hc":{"runs":12,"bestDistance":2884,"bestDistanceByStage":{"arctic":0,"countryside":2884,"desert":0,"moon":0},"coins":10570,"bestCoins":6035,"flips":0}}}},{"name":"Jojopow","devices":1,"hasCode":true,"updatedAt":1785708169924,"totalPlaysAllGames":321,"totalWonAllGames":304,"games":{"connect4":{"total":{"played":9,"won":0,"lost":9},"byDiff":{"medium":{"played":9,"won":0,"lost":9}},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":5},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":4},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":280,"won":280,"lost":0},"byDiff":{"easy":{"played":58,"won":58,"lost":0},"hard":{"played":120,"won":120,"lost":0},"medium":{"played":102,"won":102,"lost":0}},"br":{"runs":262,"bestObstacles":76,"bestObstaclesByDiff":{"easy":39,"hard":76,"medium":55}},"brOrbital":{"runs":18,"bestObstacles":8,"bestObstaclesByDiff":{"easy":8,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":5,"won":0,"lost":0},"byDiff":{"intermediate":{"played":5,"won":0,"lost":0}},"tt":{"classic":{"played":5,"won":0,"lost":0,"tied":5},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":5,"won":2,"lost":2},"byDiff":{"intermediate":{"played":5,"won":2,"lost":2}},"db":{"played":5,"won":2,"lost":2,"tied":1,"boxes":33,"bestChain":6}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":22,"won":22,"lost":0},"byDiff":{"easy":{"played":22,"won":22,"lost":0}},"sn":{"runs":22,"bestLen":6,"bestLenByDiff":{"easy":6,"hard":0,"medium":0},"bestLenByWalls":{"on":6,"off":0},"bestLenByDiffWalls":{"on":{"easy":6,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":22,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"dm":{"played":0,"won":0,"lost":0,"tied":0,"rounds":0,"bestRound":0,"points":0}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"hc":{"runs":0,"bestDistance":0,"bestDistanceByStage":{"arctic":0,"countryside":0,"desert":0,"moon":0},"coins":0,"bestCoins":0,"flips":0}}}},{"name":"Allie","devices":1,"hasCode":true,"updatedAt":1785471289659,"totalPlaysAllGames":51,"totalWonAllGames":32,"games":{"connect4":{"total":{"played":8,"won":0,"lost":8},"byDiff":{"medium":{"played":8,"won":0,"lost":8}},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":8},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":6,"won":3,"lost":3},"byDiff":{"intermediate":{"played":6,"won":3,"lost":3}}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":25,"won":25,"lost":0},"byDiff":{"easy":{"played":5,"won":5,"lost":0},"hard":{"played":17,"won":17,"lost":0},"medium":{"played":3,"won":3,"lost":0}},"br":{"runs":25,"bestObstacles":76,"bestObstaclesByDiff":{"easy":19,"hard":76,"medium":41}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":10,"won":2,"lost":8},"byDiff":{"intermediate":{"played":10,"won":2,"lost":8}},"db":{"played":10,"won":2,"lost":8,"tied":0,"boxes":63,"bestChain":5}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":2,"won":2,"lost":0},"byDiff":{"medium":{"played":2,"won":2,"lost":0}},"sn":{"runs":2,"bestLen":16,"bestLenByDiff":{"easy":0,"hard":0,"medium":16},"bestLenByWalls":{"on":16,"off":0},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":16},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":2,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"hdj","devices":1,"hasCode":true,"updatedAt":1785430231651,"totalPlaysAllGames":2,"totalWonAllGames":1,"games":{"connect4":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"medium":{"played":1,"won":0,"lost":1}},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":1},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"easy":{"played":1,"won":1,"lost":0}},"br":{"runs":1,"bestObstacles":7,"bestObstaclesByDiff":{"easy":7,"hard":0,"medium":0}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Rick","devices":1,"hasCode":true,"updatedAt":1785461650482,"totalPlaysAllGames":8,"totalWonAllGames":8,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":8,"won":8,"lost":0},"byDiff":{"easy":{"played":1,"won":1,"lost":0},"medium":{"played":7,"won":7,"lost":0}},"br":{"runs":8,"bestObstacles":41,"bestObstaclesByDiff":{"easy":13,"hard":0,"medium":41}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Natalia","devices":1,"hasCode":true,"updatedAt":1784769868850,"totalPlaysAllGames":8,"totalWonAllGames":5,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"intermediate":{"played":1,"won":0,"lost":1}}},"nutsbolts":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"medium":{"played":1,"won":1,"lost":0}},"nb":{"solved":1,"moves":19,"bestLevel":1}},"escoba":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"easy":{"played":1,"won":1,"lost":0}},"es":{"escobas":9}},"filler":{"total":{"played":2,"won":2,"lost":0},"byDiff":{"intermediate":{"played":2,"won":2,"lost":0}}},"mancala":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"beginner":{"played":1,"won":0,"lost":1}}},"ballrun":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"br":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"intermediate":{"played":1,"won":1,"lost":0}},"db":{"played":1,"won":1,"lost":0,"tied":0,"boxes":13,"bestChain":10}},"boggle":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"intermediate":{"played":1,"won":0,"lost":1}},"bg":{"played":1,"won":0,"lost":1,"tied":0,"words":13,"bestScore":16,"longestWord":{"word":"WORST","len":5}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Sam","devices":1,"hasCode":true,"updatedAt":1785249349927,"totalPlaysAllGames":69,"totalWonAllGames":69,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":69,"won":69,"lost":0},"byDiff":{"hard":{"played":48,"won":48,"lost":0},"medium":{"played":21,"won":21,"lost":0}},"br":{"runs":69,"bestObstacles":44,"bestObstaclesByDiff":{"easy":0,"hard":44,"medium":18}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Ooo","devices":1,"hasCode":true,"updatedAt":1785503018526,"totalPlaysAllGames":0,"totalWonAllGames":0,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"br":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Andrew P","devices":1,"hasCode":true,"updatedAt":1785547609298,"totalPlaysAllGames":78,"totalWonAllGames":75,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":73,"won":73,"lost":0},"byDiff":{"easy":{"played":3,"won":3,"lost":0},"hard":{"played":54,"won":54,"lost":0},"medium":{"played":16,"won":16,"lost":0}},"br":{"runs":73,"bestObstacles":181,"bestObstaclesByDiff":{"easy":181,"hard":120,"medium":120}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":4,"won":1,"lost":2},"byDiff":{"intermediate":{"played":4,"won":1,"lost":2}},"db":{"played":4,"won":1,"lost":2,"tied":1,"boxes":29,"bestChain":6}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"medium":{"played":1,"won":1,"lost":0}},"sn":{"runs":1,"bestLen":5,"bestLenByDiff":{"easy":0,"hard":0,"medium":5},"bestLenByWalls":{"on":5,"off":0},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":5},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":1,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Bego","devices":1,"hasCode":true,"updatedAt":1785605045562,"totalPlaysAllGames":62,"totalWonAllGames":55,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"intermediate":{"played":1,"won":1,"lost":0}}},"nutsbolts":{"total":{"played":47,"won":47,"lost":0},"byDiff":{"hard":{"played":3,"won":3,"lost":0},"medium":{"played":2,"won":2,"lost":0}},"nb":{"solved":47,"moves":978,"bestLevel":18}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":11,"won":4,"lost":6},"byDiff":{"beginner":{"played":11,"won":4,"lost":6}}},"ballrun":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"br":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":3,"won":3,"lost":0},"byDiff":{"medium":{"played":3,"won":3,"lost":0}},"sn":{"runs":3,"bestLen":3,"bestLenByDiff":{"easy":0,"hard":0,"medium":3},"bestLenByWalls":{"on":0,"off":3},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":3}},"runsByWalls":{"on":0,"off":3}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Unai","devices":1,"hasCode":true,"updatedAt":1785768983370,"totalPlaysAllGames":15,"totalWonAllGames":13,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"normal":{"played":1,"won":1,"lost":0}},"es":{"escobas":11}},"filler":{"total":{"played":2,"won":0,"lost":2},"byDiff":{"intermediate":{"played":2,"won":0,"lost":2}}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":3,"won":3,"lost":0},"byDiff":{"medium":{"played":3,"won":3,"lost":0}},"br":{"runs":3,"bestObstacles":48,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":48}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"dm":{"played":0,"won":0,"lost":0,"tied":0,"rounds":0,"bestRound":0,"points":0}},"hillclimb":{"total":{"played":9,"won":9,"lost":0},"byDiff":{"easy":{"played":9,"won":9,"lost":0}},"hc":{"runs":9,"bestDistance":1734,"bestDistanceByStage":{"arctic":0,"countryside":1734,"desert":0,"moon":0},"coins":6240,"bestCoins":2520,"flips":0}}}},{"name":"Joe5","devices":1,"hasCode":true,"updatedAt":1785278224643,"totalPlaysAllGames":0,"totalWonAllGames":0,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"br":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Liz","devices":1,"hasCode":true,"updatedAt":1785293229216,"totalPlaysAllGames":53,"totalWonAllGames":45,"games":{"connect4":{"total":{"played":2,"won":0,"lost":2},"byDiff":{"medium":{"played":2,"won":0,"lost":2}},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":1},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":1},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":3,"won":3,"lost":0},"byDiff":{"easy":{"played":3,"won":3,"lost":0}},"nb":{"solved":3,"moves":18,"bestLevel":3}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"intermediate":{"played":1,"won":0,"lost":1}}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":34,"won":34,"lost":0},"byDiff":{"easy":{"played":3,"won":3,"lost":0},"hard":{"played":3,"won":3,"lost":0},"medium":{"played":28,"won":28,"lost":0}},"br":{"runs":34,"bestObstacles":57,"bestObstaclesByDiff":{"easy":21,"hard":19,"medium":57}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":6,"won":3,"lost":2},"byDiff":{"mp":{"played":6,"won":3,"lost":2}},"db":{"played":6,"won":3,"lost":2,"tied":1,"boxes":84,"bestChain":19}},"boggle":{"total":{"played":3,"won":1,"lost":2},"byDiff":{"intermediate":{"played":2,"won":0,"lost":2},"mp":{"played":1,"won":1,"lost":0}},"bg":{"played":3,"won":1,"lost":2,"tied":0,"words":96,"bestScore":40,"longestWord":{"word":"SLATES","len":6}}},"snake":{"total":{"played":4,"won":4,"lost":0},"byDiff":{"medium":{"played":4,"won":4,"lost":0}},"sn":{"runs":4,"bestLen":4,"bestLenByDiff":{"easy":0,"hard":0,"medium":4},"bestLenByWalls":{"on":4,"off":0},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":4},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":4,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Zed99","devices":1,"hasCode":false,"updatedAt":1785294286303,"totalPlaysAllGames":1,"totalWonAllGames":0,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"legacy":{"played":1,"won":0,"lost":1}},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"br":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Andrew Powell","devices":1,"hasCode":true,"updatedAt":1785459848294,"totalPlaysAllGames":4,"totalWonAllGames":1,"games":{"connect4":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"medium":{"played":1,"won":0,"lost":1}},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":1},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"br":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":3,"won":1,"lost":2},"byDiff":{"beginner":{"played":1,"won":1,"lost":0},"intermediate":{"played":2,"won":0,"lost":2}},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":3,"won":1,"lost":2,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Joe","devices":1,"hasCode":true,"updatedAt":1785285262975,"totalPlaysAllGames":0,"totalWonAllGames":0,"games":{"connect4":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"grid":{"player":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":0,"l":0},"medium":{"w":0,"l":0},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"nb":{"solved":0,"moves":0,"bestLevel":0}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"mancala":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"ballrun":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"br":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":0,"won":0,"lost":0,"tied":0}}},"dotsboxes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"db":{"played":0,"won":0,"lost":0,"tied":0,"boxes":0,"bestChain":0}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"sn":{"runs":0,"bestLen":0,"bestLenByDiff":{"easy":0,"hard":0,"medium":0},"bestLenByWalls":{"on":0,"off":0},"bestLenByDiffWalls":{"on":{},"off":{"easy":0,"hard":0,"medium":0}},"runsByWalls":{"on":0,"off":0}}},"uno":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}},{"name":"Brian Spalding","devices":1,"hasCode":true,"updatedAt":1785531626403,"totalPlaysAllGames":110,"totalWonAllGames":74,"games":{"connect4":{"total":{"played":33,"won":4,"lost":29},"byDiff":{"easy":{"played":4,"won":4,"lost":0},"medium":{"played":29,"won":0,"lost":29}},"grid":{"player":{"easy":{"w":3,"l":0},"medium":{"w":0,"l":13},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}},"computer":{"easy":{"w":1,"l":0},"medium":{"w":0,"l":16},"hard":{"w":0,"l":0},"expert":{"w":0,"l":0}}}},"chinchon":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"cc":{"closed":0,"minusTen":0,"chinchons":0}},"business":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"parchis":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"nutsbolts":{"total":{"played":2,"won":2,"lost":0},"byDiff":{"medium":{"played":2,"won":2,"lost":0}},"nb":{"solved":2,"moves":46,"bestLevel":2}},"escoba":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"es":{"escobas":0}},"filler":{"total":{"played":4,"won":3,"lost":1},"byDiff":{"intermediate":{"played":3,"won":3,"lost":0},"mp":{"played":1,"won":0,"lost":1}}},"mancala":{"total":{"played":1,"won":0,"lost":1},"byDiff":{"intermediate":{"played":1,"won":0,"lost":1}}},"ballrun":{"total":{"played":53,"won":53,"lost":0},"byDiff":{"hard":{"played":53,"won":53,"lost":0}},"br":{"runs":53,"bestObstacles":111,"bestObstaclesByDiff":{"easy":0,"hard":111,"medium":0}},"brOrbital":{"runs":0,"bestObstacles":0,"bestObstaclesByDiff":{"easy":0,"hard":0,"medium":0}}},"tictactoe":{"total":{"played":3,"won":0,"lost":3},"byDiff":{"intermediate":{"played":2,"won":0,"lost":2},"mp":{"played":1,"won":0,"lost":1}},"tt":{"classic":{"played":0,"won":0,"lost":0,"tied":0},"ultimate":{"played":3,"won":0,"lost":3,"tied":0}}},"dotsboxes":{"total":{"played":4,"won":2,"lost":1},"byDiff":{"intermediate":{"played":1,"won":1,"lost":0},"mp":{"played":3,"won":1,"lost":1}},"db":{"played":4,"won":2,"lost":1,"tied":1,"boxes":77,"bestChain":30}},"boggle":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"bg":{"played":0,"won":0,"lost":0,"tied":0,"words":0,"bestScore":0,"longestWord":{"word":"","len":0}}},"snake":{"total":{"played":9,"won":9,"lost":0},"byDiff":{"medium":{"played":9,"won":9,"lost":0}},"sn":{"runs":9,"bestLen":20,"bestLenByDiff":{"easy":0,"hard":0,"medium":20},"bestLenByWalls":{"on":0,"off":20},"bestLenByDiffWalls":{"on":{"easy":0,"hard":0,"medium":0},"off":{"easy":0,"hard":0,"medium":20}},"runsByWalls":{"on":0,"off":9}}},"uno":{"total":{"played":1,"won":1,"lost":0},"byDiff":{"medium":{"played":1,"won":1,"lost":0}}},"pool":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"poolv2":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"yahtzee":{"total":{"played":0,"won":0,"lost":0},"byDiff":{},"yz":{"played":0,"won":0,"lost":0,"tied":0,"yahtzees":0,"bestScore":0}},"dominoes":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}},"hillclimb":{"total":{"played":0,"won":0,"lost":0},"byDiff":{}}}}]
```
