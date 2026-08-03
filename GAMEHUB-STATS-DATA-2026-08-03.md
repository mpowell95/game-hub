# Game Hub Player Stats — Raw Data Extraction

**Prepared:** 2026-08-03. **Prepared by:** an automated, read-only extraction pass over the
`mpowell95/game-hub` repository (branch `claude/gamehub-stats-extraction-n93sbu`) and its
production Firebase Realtime Database. This document is meant to be self-contained: a second
model with no access to the repository or the database should be able to read it and reason
about the data without further lookups.

**This document does NOT interpret the data.** No conclusions, no recommendations, no
"who plays the most." It exists so a second pass can do that analysis from this alone.

---

## 1. Provenance

**THE PULL FAILED. This document contains NO live player data.**

- Attempted: `node backups/rtdb-backup.mjs` from the repo root (the repo's own read-only
  backup script — signs in anonymously via the Identity Toolkit REST API, then reads the
  whole Firebase Realtime Database over its plain REST API).
- **Anonymous sign-in to `identitytoolkit.googleapis.com` succeeded** (HTTP 200, a valid
  `idToken` was issued). This is not a credentials problem.
- **Every read against the database host, `game-hub-5b91c-default-rtdb.firebaseio.com`,
  was blocked by this environment's outbound network proxy** before it ever reached
  Firebase. `curl -v` against that host shows the proxy's CONNECT tunnel itself being
  refused:
  ```
  < HTTP/1.1 403 Forbidden
  ```
  The proxy's own documentation (`/root/.ccr/README.md`) states plainly: *"403/407 from the
  proxy: the destination host is not allowed by your organization's egress policy for this
  session. Do not retry or route around it — report the blocked host."* The same 403 was
  confirmed against `game-hub-5b91c.firebaseio.com` and the bare `firebaseio.com` domain, so
  this is a domain-level block on Firebase RTDB hosts generally in this environment, not a
  one-off.
- **No prior snapshot existed to fall back on.** `backups/` in this checkout contained only
  the script itself (`rtdb-backup.mjs`), no `.json` snapshots (they are gitignored and none
  were present in the working tree at session start).
- **Nodes reachable: none.** `players/`, `usernames/`, `deviceReports/`, and `rooms/` were
  all unreachable for the same reason — they all live under the same blocked RTDB host.
  There is no way to read one node and not another here; the block is at the hostname/TLS
  level, before any path is requested.
- **Per the task's own hard constraint** ("Never estimate, extrapolate, or fabricate a
  number to fill a gap"), no play counts, device counts, roster, or any other figure that
  would normally come from the database appears anywhere below. Every section that would
  normally hold live numbers instead says explicitly that it is empty and why.
- **Not attempted, because it is destructive/out of scope regardless:** nothing was written
  to Firebase, no `--write` flag was ever passed to any script, and no localStorage/app file
  was modified. This pass is, and remained, strictly read-only, even though the read itself
  did not succeed.

**What this means for the rest of the document:** Sections 3 (Roster), 4 (Person × game
matrix), 5 (Per-game hub-wide totals), 6 (Per-game deep tables), 7 (Head-to-head), 8
(Leaderboard as computed), 9 (Excluded/anomalous records), and 11 (Appendix data) are all
**EMPTY** below, each restated as empty at its own heading per the task's instruction not to
bury a caveat in a footnote. Section 2 (Data dictionary) and Section 10 (Blind spots) do not
depend on live data — they come from reading the repository's own source files, which were
fully reachable — and are complete.

---

## 2. Data dictionary

Everything in this section is derived from reading the repository's source, primarily
`js/game-stats.js` (the ~130-line header comment plus every `recordX()` writer),
`js/players-agg.js` (cross-device aggregation), `js/leaderboard-rank.js` and
`js/leaderboard-ui.js` (what the leaderboard actually shows), and `js/game-stats-ui.js`
(what "My Stats" actually shows), as of this repository checkout (2026-08-03).

### 2.1 Storage model, in brief

All unified play history lives in one JSON blob per **stats store**, under the key
`gamehub.stats` (or a per-second-player fork key, see 2.4), shaped:

```
{
  version: 1,
  games: { <gameId>: { total: {played, won, lost}, byDiff: {...}, <sub-counters...> }, ... },
  h2h: { <gameId>: { <opponentDeviceId>: { name, w, l } }, ... },   // multiplayer head-to-head, capture-only
  updatedAt: <ISO timestamp>
}
```

This whole blob is mirrored, per player-identity, to Firebase RTDB at
`players/<statsId>` as `{ profile: {...}, stats: {...} }` (see 2.4 for what `statsId` is).
That mirrored copy is what the "Roster"/"matrix"/"deep tables" sections below would have
been built from, had the database been reachable.

### 2.2 Game ids → display names

19 game ids exist in the `GAMES` registry (`js/game-stats.js`). The id is the storage/stats
key; the display name is what a player sees (per root `CLAUDE.md`, the Monopoly Deal
id/display split is intentional, not an error).

| Game id | Display name | Solo or competitive |
|---|---|---|
| `connect4` | Connect Four | Competitive |
| `chinchon` | Chinchón | Competitive |
| `business` | **Monopoly Deal** (id says "business" on purpose — see root `CLAUDE.md`, "Monopoly Deal naming") | Competitive |
| `parchis` | Parchís | Competitive |
| `nutsbolts` | Nuts & Bolts | **Solo** |
| `escoba` | Escoba | Competitive |
| `filler` | Filler | Competitive |
| `mancala` | Mancala | Competitive |
| `ballrun` | Ball Run | **Solo** |
| `tictactoe` | Tic Tac Toe | Competitive |
| `dotsboxes` | Dots and Boxes | Competitive |
| `boggle` | Boggle | Competitive |
| `snake` | Snake | **Solo** |
| `uno` | Uno | Competitive |
| `pool` | Pool | Competitive |
| `poolv2` | Pool (v2 build) | Competitive |
| `yahtzee` | Yahtzee | Competitive |
| `dominoes` | Dominoes | Competitive |
| `hillclimb` | Hill Climb | **Solo** |

**Solo set** (`SOLO` constant, `js/players-agg.js`): `nutsbolts`, `ballrun`, `snake`,
`hillclimb`. **Competitive set** (`COMPETITIVE`): every other id in the list above.

**Why the solo/competitive split matters for reading any stats number:** a solo game has no
opponent and no loss state — a finished run always records as `played+1` AND `won+1` in the
same write. So "win rate" for `nutsbolts`/`ballrun`/`snake`/`hillclimb` is **always 100% by
construction** and is meaningless as a skill signal. The honest metric for a solo game is its
own score/best field (see 2.6), not `won`/`played`.

### 2.3 Core metric keys (present for every game)

- **`total.played`** — cumulative count of finished games/runs of that game, this store.
  Cumulative, additive only.
- **`total.won`** — cumulative count the human won. For a solo game, always equals
  `total.played`. Cumulative, additive only.
- **`total.lost`** — cumulative count the human lost. Always `0` for a solo game.
  Cumulative, additive only.
- **Draws/ties are NOT a separate field in `total`** — for a competitive game that can draw
  (Tic Tac Toe, Dots and Boxes, Boggle, Yahtzee, Dominoes), a draw is only counted in
  `total.played`, not in `won` or `lost`; those games separately track `tied` explicitly in
  their own sub-counter (2.6), because `total` alone can't distinguish "drew" from "some
  other event". **A draw is explicitly NOT counted as a win anywhere in this app** — a past
  design used `wins = played - losses` (which folds draws into "wins"); that was reversed
  2026-07-28 and the current, correct rule is: wins = the stored `won` counter, full stop.
- **`byDiff.<label>`** — the same `{played, won, lost}` shape, bucketed by a difficulty/mode
  label. The label vocabulary is **not uniform across games** — see 2.5.

### 2.4 Identity: whose stats these are

- **`gamehub.deviceId`** — a random UUID, one per physical device/browser install. Stable,
  survives profile renames.
- **`statsId`** — the id a device's ACTIVE player syncs under, i.e. the Firebase key under
  `players/`. Equals `deviceId` for the device's **owner** (the first player-code ever seen
  on that device); equals `<deviceId>-<CODE>` for anyone else who plays on that same
  physical device (a "fork"). This is the structural fix for two people sharing one phone
  writing into the same counters (the "Ana/Natalia" incident, `js/CLAUDE.md`).
- A device with **no player code at all** still has a device-wide store and syncs under its
  bare `deviceId`.
- **Cross-device aggregation to one PERSON** is not stored anywhere — it's computed at read
  time by `js/players-agg.js`, which unions devices that share a player code OR a
  (lowercased, alias-resolved) profile name, transitively. Two hand-maintained maps exist in
  that file for this family's known name-spelling quirks:
  - `NAME_ALIAS`: `matt → mattyice`, `lill → lili` (folds alternate spellings into one
    identity for grouping).
  - `DISPLAY_NAME`: `lili → 'Lili'` (pins which spelling the merged row displays as, so it
    doesn't flip depending on which device synced most recently).
- A profile name of `''` (blank) or the literal string `'You'` is a **placeholder**, not a
  real name (`isPlaceholderName()`), and is deprioritized when picking a display name for a
  merged identity.

### 2.5 The `byDiff` label vocabulary is per-game, not one shared scale

Real difficulty-tier labels differ by game (`easy/medium/hard/expert`,
`beginner/intermediate/pro`, etc. — see each game's own setup screen), **plus these
special, non-tier labels that appear across multiple games**:

| Label | Meaning |
|---|---|
| `mp` | Multiplayer game (not a difficulty tier at all — used by Tic Tac Toe, Yahtzee, and any other MP-capable game's `byDiff` when the match was multiplayer) |
| `ai` | Yahtzee-specific: solo vs. the AI (Yahtzee has no separate difficulty tiers, so `ai` vs `mp` is its entire `byDiff` vocabulary) |
| `legacy` | Pre-unified-stats history folded in once from an old per-game store (`chinchon-stats`, `bd-stats`) when `gamehub.stats` was first introduced. A real play count, just with no difficulty label attached (the old stores didn't track one) |
| `unknown` | `normDiff()`'s fallback for any value that doesn't normalize to a recognized label (blank, unrecognized string, etc.) |

**A game's own `byDiff` vocabulary must be read from what actually appears in that game's
data** (which, in this pull, is nothing — see Section 1) — do not assume every game shares
one 4-tier scale. Hill Climb, for instance, uses its 4 stage names
(`countryside`/`desert`/`arctic`/`moon`) mapped 1:1 onto the shared
`easy`/`medium`/`hard`/`expert` slots, because its stages ARE its difficulty axis (no
separate picker exists).

### 2.6 Per-game richer sub-counters

A game with meaningful state beyond played/won/lost carries an additional key inside its
`games.<id>` object. All values below are **cumulative counters (add across devices) unless
marked "(best)", which take `Math.max` across devices, never a sum** — this is THE LAW rule 2
in the source repository (writes are additive only; bests only ever improve). A "(paired
best)" moves as a single unit (e.g. a word's text always matches its own stored length) —
never max the two halves independently.

| Game | Key | Fields | Definition |
|---|---|---|---|
| Connect Four | `grid` | `{player\|computer}.{easy\|medium\|hard\|expert}.{w,l}` | Win/loss counts split by **who moved first** (`player` = the human moved first) and difficulty. Not a `byDiff`-style bucket — a second, orthogonal breakdown. |
| Chinchón | `cc` | `closed, minusTen, chinchons` | `closed`: times the human closed the round. `minusTen`: times the human scored the -10 close bonus. `chinchons`: times the human got a literal Chinchón (the game's namesake special hand). All cumulative counts of in-round events, not per-match outcomes. |
| Escoba | `es` | `escobas` | Cumulative count of "escobas" (a clean table-sweep capture) the human made. |
| Nuts & Bolts (**solo**) | `nb` | `solved, moves, bestLevel, bestByTier` | `solved`: puzzles solved (= `total.won`, since a solve is the only outcome). `moves`: cumulative moves spent across all solves. `bestLevel` (best): furthest level ever reached. `bestByTier` (best, per difficulty tier): furthest level reached at each tier. |
| Ball Run (**solo**) | `br` | `runs, bestObstacles, bestObstaclesByDiff` | Classic map. `runs`: cumulative finished runs. `bestObstacles` (best): highest obstacle-row count passed in a single run, overall. `bestObstaclesByDiff` (best, per easy/medium/hard): same, per difficulty. **The score unit is "obstacle rows passed," not distance** (changed 2026, see `brLegacyMeters` below — never compare the two). |
| Ball Run (**solo**) | `brOrbital` | same shape as `br` | The second map ("Orbital"). A fresh, independent sibling counter — Orbital did not exist before this map shipped, so nothing was migrated into it; all older Ball Run history is Classic (`br`) history. `total`/`byDiff` at the game level are combined across both maps; only the best-score buckets are split by map. |
| Ball Run (**solo**) | `brLegacyMeters` | `runs, bestDistance, bestByDiff` | **Archived, pre-migration Ball Run history, in METERS — a different, incompatible unit from the current obstacle-count score.** Preserved verbatim, never converted, never deleted (THE LAW rule 4: never fabricate a conversion between incomparable metrics). Only present on devices that had Ball Run data before the metric changed. The archived `runs` count (unit-agnostic, unlike the meter-based bests) was folded back into the live `br.runs` once, so it isn't double-hidden. |
| Tic Tac Toe | `tt` | `{classic\|ultimate}.{played,won,lost,tied}` | Full W/L/T split, separately for the Classic and Ultimate variants. `tied` is explicit here (not derived) because Tic Tac Toe is draw-heavy by design (Pro-tier Classic is a solved, unbeatable game, so most Pro Classic games are draws). |
| Dots and Boxes | `db` | `played, won, lost, tied, boxes, bestChain` | Full W/L/T (Medium/4x4 boards can legitimately tie 8-8). `boxes`: cumulative boxes the human has claimed across all games. `bestChain` (best): longest single-turn capture chain ever made. |
| Boggle | `bg` | `played, won, lost, tied, words, bestScore, longestWord{word,len}` | Full W/L/T (scored against the AI's own found-word total, so a tie is possible). `words`: cumulative words the human has found. `bestScore` (best): highest single-round score. `longestWord` (**paired best**): the longest single word ever found, with its own length — replaced only when a new word is *strictly* longer, so the word and its length always match. |
| Yahtzee | `yz` | `played, won, lost, tied, yahtzees, bestScore` | Full W/L/T (a 13-round match scored against the opponent's total, so it can tie). `yahtzees`: cumulative count of every Yahtzee-box score of 50 the human has scored, PLUS every bonus Yahtzee, across all matches. `bestScore` (best): highest single-match total. |
| Dominoes | `dm` | `played, won, lost, tied, rounds, bestRound, points` | Full W/L/T (both players score the pips left in the opponent's hand at every round end, so both totals can cross the target score in the same settle and the match can end level — a real tie, not a rare edge case). `rounds`/`points` (cumulative): rounds played and the human's cumulative match-score total. `bestRound` (best): highest single round the human has ever scored. |
| Snake (**solo**) | `sn` | `runs, bestLen, bestLenByDiff, bestLenByWalls{on,off}, bestLenByDiffWalls{on,off}, runsByWalls{on,off}` | `runs`: cumulative finished runs. `bestLen` (best): the snake's final length (start length 3 + food eaten) in a single run — the classic "how long did it get" number. `bestLenByDiff` (best, per easy/medium/hard speed tier). **`walls` is a separate rule-variant axis, not a difficulty tier**: `on` = walls kill on contact (classic), `off` = wrap-around. All pre-2026-07-28 history (before this split existed) was seeded into the **`off`** bucket — this is Matt's explicit **policy decision** recorded in `js/game-stats.js` (`seedSnWallsLegacy`), treating all pre-split history as Walls-off play, not a recovered fact about how those games were actually played. |
| Hill Climb (**solo**) | `hc` | `runs, bestDistance, bestDistanceByStage, coins, bestCoins, flips` | `runs`: cumulative finished runs. `bestDistance` (best, whole meters): furthest distance reached in a single run. `bestDistanceByStage` (best, per `countryside/desert/arctic/moon`). `coins`/`flips` (cumulative, lifetime): coins collected and vehicle flips, across all runs — additive, never decrease. **Deliberately excludes the game's spendable coin wallet balance** (that lives only in Hill Climb's own local save, `gamehub.hillclimb.v1`, precisely so nothing that can go DOWN — a spent balance — is ever written into this shared, append-only store). `bestCoins` (best): highest single-run coin haul. |

### 2.7 Head-to-head (`h2h`)

`h2h: { <gameId>: { <opponentDeviceId>: { name, w, l } } }`. **Capture-only as of this
checkout — no UI displays it anywhere yet, that is deliberate** (`js/game-stats.js` /
`js/CLAUDE.md`). Records a multiplayer opponent's identity plus a running win/loss count
against them, per game, only for matches played after the recording code was added
(**2026-07-22** — see 2.8, "Blind spots," and Section 7 for the practical consequence: any
multiplayer match before that date is permanently unrecoverable, no exceptions).

### 2.8 `updatedAt`

ISO timestamp of the most recent write to that stats store. Used by `players-agg.js` to pick
the freshest profile name/emoji/message when merging a person's multiple devices, and is the
only per-record notion of "recency" available — **there is no per-play timestamp anywhere in
this system** (see Section 10).

### 2.9 What the leaderboard actually shows vs. what is stored (visibility gate)

Storing a number is not the same as a player being able to see it — root `CLAUDE.md`'s
THE LAW rule 1. The leaderboard (`js/leaderboard-ui.js`) applies its own filter on top of
everything above:

- **`visibleRecords()`** drops any device whose id starts with a hardcoded prefix in
  `HIDDEN_PREFIX` (currently `4392d978`, `f8ad1b82`, `zzz-prev` — specific known
  test/preview devices, identified by hand in past sessions).
- **`isHiddenRow()`** additionally drops a row if: the name is blank or exactly `'You'`
  (both placeholder, not identity); the lowercased name is in `HIDDEN_NAMES`
  (`qa`, `dev`, `demo`, `preview`, `prueba`); or the lowercased name starts with `test` or
  `zzz` (`HIDDEN_NAME_PREFIX`) — this catches `Test`, `Tester`, `test1`, `zzztest`, etc.
  without needing to know every literal spelling in advance.
- **None of this hiding deletes or un-syncs anything.** A hidden record's plays remain
  intact in Firebase and remain fully visible to that device's own owner on their own "My
  Stats" screen — only the shared leaderboard omits the row. Section 9 of this document (if
  data were reachable) would list every such excluded record explicitly, per the task's
  instruction that nothing is dropped silently.
- **A nameless device cannot be newly created as of 2026-07-31** — `js/name-gate.js` gates
  every entry point (hub and every standalone game page) on having a name before play is
  possible. Any nameless record that still exists is necessarily **pre-gate history**; it
  stays hidden from the leaderboard until its owner is gated into naming themselves on their
  next visit, at which point the SAME untouched record reattaches to their identity and
  reappears — nothing is migrated or rewritten to make that happen.

### 2.10 Rating/ranking maths that exists but is not currently displayed

`js/leaderboard-rank.js` implements a difficulty-weighted Wilson-score rating and a full
ranking model (`rankPlayers`/`ratePlayer`/`soloRating`). **As of the 2026-07-23 leaderboard
redesign, none of this is shown in the UI** — the leaderboard now leads with one raw "wins"
number (or, for a solo game, that game's own best/score metric) per Matt's own explicit
readability request. The rating code is kept in the repository, unused but not deleted, for
a possible future dedicated rating page. This document does not compute or reference that
rating anywhere, since it is not part of what a player currently sees.

---

## 3. Roster — one row per aggregated person

**EMPTY. The database could not be reached (Section 1).** No `players/` data was pulled, so
no per-device records exist to run `js/players-agg.js`'s identity-union over, and no roster
of real people, device counts, device ids, player codes, aliases, or activity dates can be
reported. Nothing here is estimated.

---

## 4. Person × game matrix

**EMPTY. The database could not be reached (Section 1).** No plays-per-person-per-game matrix
and no win/loss/tie matrix can be built without the underlying `players/` records.

---

## 5. Per-game hub-wide totals

**EMPTY. The database could not be reached (Section 1).** No plays, unique-player counts, win
rates, or difficulty distributions can be reported for any of the 19 games in Section 2.2.

---

## 6. Per-game deep tables

**EMPTY. The database could not be reached (Section 1).** None of the sub-counters defined in
Section 2.6 (Connect Four's first-move grid, Chinchón's closed/minusTen/chinchons, Boggle's
words/bestScore/longestWord, Yahtzee's yahtzees/bestScore, Dominoes' rounds/points/bestRound,
Hill Climb's per-stage bests/coins/flips, Ball Run's Classic vs. Orbital vs. archived-meters
split, Snake's walls-on/off split, Tic Tac Toe's classic vs. ultimate, etc.) have any real
values to report per person.

---

## 7. Head-to-head

**EMPTY. The database could not be reached (Section 1).** The `h2h` node (Section 2.7) could
not be read. Independent of that failure: per the source code, `h2h` capture only began
**2026-07-22** — any multiplayer match before that date was never recorded here regardless of
database access, and is permanently unrecoverable (no per-play log exists anywhere to
reconstruct it from; see Section 10).

---

## 8. Leaderboard as the app computes it

**EMPTY. The database could not be reached (Section 1).** No standings can be computed by
`js/leaderboard-rank.js` or filtered by the visibility gate described in Section 2.9 without
underlying player records. Section 2.9 describes the MECHANISM (what would be hidden and
why); it contains no live standings.

---

## 9. Excluded and anomalous records

**EMPTY. The database could not be reached (Section 1).** No records — hidden by
`HIDDEN_PREFIX`, `HIDDEN_NAMES`/`HIDDEN_NAME_PREFIX`, or the nameless gate — could be
enumerated, because no records were pulled at all. No anomaly scan (placeholder names,
duplicate-looking identities, apparently-forked devices, stale `updatedAt`) could be run.
Section 2.9 describes the exclusion RULES that exist in the code; it is not a list of which
real records, if any, those rules currently exclude.

---

## 10. Blind spots — what is NOT in this dataset (even when the database IS reachable)

This section does not depend on live data and is complete. It was built by reading the
per-game and per-module storage keys directly out of the source (grepped across `js/*.js`
and each game's own `ui.js`), per the task's instruction to grep rather than trust memory.

**There is no per-play event log anywhere in this system — only cumulative counters.**
Every number in Sections 2–9 (had they been populated) would be a running total or a running
best, never a timestamped individual play. Consequently, even with full database access,
this kind of analysis is structurally impossible from this data:
- Session length, time-of-day, day-of-week patterns, or any sequencing of plays.
- Win/loss streaks, or "what did this player's last 10 games look like."
- Exactly when a best score was set (only `updatedAt`, the timestamp of the most recent
  write to the WHOLE stats store, exists — and it is overwritten by every subsequent play of
  any game on that store, not just the one that set the best).
- A device that has never come back online since a given play is simply **absent** from
  Firebase, indistinguishable from a device that never played. **Absence never proves
  non-play** — it may just mean "hasn't synced."

**Per-game local settings/save keys — never mirrored to Firebase, invisible centrally:**

| Key(s) | Holds | Centrally observable? |
|---|---|---|
| `gamehub.<game>.v1` (the current convention — e.g. `gamehub.boggle.v1`, `gamehub.dotsboxes.v1`, `gamehub.filler.v1`, `gamehub.mancala.v1`, `gamehub.nutsbolts.v1`, `gamehub.tictactoe.v1`, `gamehub.uno.v1`) | Each game's own setup-screen preferences (last-used difficulty, opponent picks, house rules, etc.) | No — local only |
| `escoba-settings`, `chinchon-settings` (frozen gen-1 dashed keys, per THE LAW rule 5 — never renamed) | Same kind of per-game settings, older naming generation | No — local only |
| `ballrun.difficulty`, `ballrun.runLog.v1`, `ballrun.seenHelp` (frozen gen-1 dotted keys) | Ball Run's own settings + a local run log + a one-time help-seen flag | No — local only |
| `parchis_r2_prefs` | Parchís's own preferences (including its own in-game language setting, which overrides the hub-wide language preference on that page) | No — local only |
| Per-game **save/resume** keys (`gamehub.connect4.save.v1`, `gamehub.tictactoe.save.v1`, `gamehub.dotsboxes.save.v1`, `gamehub.filler.save.v1`, `gamehub.chinchon.solo.v1`, `gamehub.chinchon.mp.v1`, `gamehub.boggle.save.v1`, `gamehub.uno.save.v1`, `gamehub.mancala.game.v1`, and others per game) | Mid-game state so a player can leave and resume | No — local only, and by design ephemeral (overwritten by the next save) |

**Hub-wide preference keys — never mirrored, invisible centrally:**

| Key | Holds |
|---|---|
| `gamehub.favorites.v1` | Which games this device has starred as launcher favorites |
| `gamehub.lang.v1` | EN/ES language preference |
| `gamehub.theme.v1` | Light/dark/auto theme preference |
| `gamehub.lb.sort.v1` | The leaderboard's persisted sort-order choice on this device |
| `gamehub.syncHealth.v1` | This device's own diagnostic record of its last Firebase sync attempt (`ok`, `lastOkAt`, `lastErrAt`, `lastErr`, `localPlays`, `remotePlays`) — exists specifically so a device can self-diagnose a silent sync failure, but is itself never synced anywhere |

**Identity/ownership bookkeeping keys — local only:**

- `gamehub.stats.owner.v1` — who owns this device's original (un-forked) stats store.
- `gamehub.stats.forks.v1` — append-only diagnostic log of every additional player who has
  ever recorded on this device.

**Legacy keys, frozen in place per THE LAW rule 5 (never deleted, never repurposed), folded
into `gamehub.stats` exactly once and otherwise dormant:**

- `bd-stats` — pre-unification Monopoly Deal stats.
- `gamehub.bd.pendingStats.v1` — a queue of Monopoly Deal plays recorded while the shared
  stats bridge was unavailable (e.g. offline with a stale service worker); drained into
  `gamehub.stats` on the next hub load.

**Hill Climb's spendable coin wallet** — the current *balance* the player can spend
in-game — is deliberately kept ONLY in Hill Climb's own local save
(`gamehub.hillclimb.v1`), never in the shared stats store, specifically so that a number
which can legitimately go DOWN (spending) is never written into a store that THE LAW
requires to be strictly additive. Only the lifetime `coins`/`flips` counters and the
`bestCoins` best (Section 2.6) are shared/synced; the current wallet balance is not
observable centrally at all.

**Device diagnostics (`deviceReports/`)** — could not be characterized in this pass at all
(Section 1: unreachable), but per `js/device-report.js`'s own code, when reachable this node
holds a snapshot of a device's browser/storage/service-worker state plus a raw dump of every
localStorage key the app has ever written on that device — it is a diagnostic artifact, not
part of the stats data model, and is uploaded only when a player explicitly used the
profile page's "Device details" feature.

**Multiplayer room state (`rooms/<CODE>`)** — could not be characterized in this pass
(Section 1: unreachable), but by design (`js/net.js`) this node is ephemeral lockstep/session
state for an in-progress or very recently finished multiplayer match, not historical data —
any of it that matters for stats purposes should already have been captured into `h2h`
(Section 2.7) or into the normal per-game counters at match end.

---

## 11. Appendix — aggregated data

**EMPTY. The database could not be reached (Section 1).** There is no aggregated
person×game×metric data to include as CSV or JSON — the aggregation step (Step 3 of the
task, running the repository's own `js/players-agg.js` and `js/leaderboard-rank.js` against
a real snapshot) was never reached because Step 1 (the pull) failed first. A reconciliation
against the raw `totalPlays()` count from `backups/rtdb-backup.mjs` (Section 1) is likewise
impossible: that script itself never produced a count, because it failed at the network
layer before reading any path.

---

## Summary of what would need to change to complete this document

Re-running this task from a network context that can reach
`*.firebaseio.com` (specifically `game-hub-5b91c-default-rtdb.firebaseio.com`) would let
Step 1 (`node backups/rtdb-backup.mjs`) succeed, at which point Sections 3–9 and 11 could be
filled in exactly as specified in the task, using the schema fully documented in Section 2
above (which required no live data and is already complete and verified against the current
source).
