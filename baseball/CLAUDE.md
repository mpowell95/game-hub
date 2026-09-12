# Baseball — CLAUDE.md

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file.

## Status: Phase 0 — plumbing only, no game

This milestone (BB-0-phase-0-handoff.md, 2026-09-12) ships nothing a player can see: a `devOnly`
placeholder tile (`baseball/js/ui.js` renders one screen and nothing else), the frozen stats
shape, the career sync store, its headless test, the `careers/` rules branch, and this file. Do
not build gameplay against anything here without re-reading the design doc first — nothing below
is a commitment about how the game plays, only about how its data is shaped and kept safe.

Matt's instructions for this phase: commit on the branch, do not push, do not open a PR. Named
constants everywhere, no magic numbers. Every future commit that changes a numeric or versioned
value states the old and new value.

## Frozen identifiers (THE LAW rule 5 — never rename, never repurpose)

| Thing | Value |
|---|---|
| Stats id | `'baseball'` |
| Sub-counter key | `bb` (`js/game-stats.js`'s `ensureBb`) |
| Hub id | `baseball` |
| Folder | `baseball/` |
| CSS root / prefix | `.bb-root` / `.bb-` |
| Settings key | `gamehub.baseball.v1` |
| League ids, ladder order | `little`, `highschool`, `college`, `minors`, `majors` |
| Trophies | 0 none, 1 bronze, 2 silver, 3 gold |
| Leagues | 1 to 5 |
| Hands | `L`, `R` |

## The stats shape (`js/game-stats.js`)

`ensureBb(g)` builds `g.bb` with this exact key list — frozen, and the list `players-agg.js`'s
merge branch must stay in step with:

**Integer counters, additive, default 0:** `careersStarted`, `careersFinished`, `seasons`,
`forfeits`, `wsTitles`, `perfectSeasons`, `hits`, `doubles`, `triples`, `homers`, `atBats` (plate
appearances minus walks minus sacrifice flies), `runs` (scored), `walksDrawn`, `runsAllowed`,
`hitsAllowed`, `walksIssued`, `inningsPitchedOuts`, `strikeoutsBatting`, `strikeoutsPitched`,
`shutouts`, `walkoffWins`, `extraInningGames`.

**Max counters, Math.max only (THE LAW rule 2), default 0:** `bestRunsGame`,
`bestStrikeoutsPitchedGame`.

**Then:** `bestLeague` (0 until a career exists, the highest ladder rung 1-5 ever reached),
`bestTrophyByLeague` (one key per `BB_LEAGUES` entry, 0, Math.max per league), `hand` (`null` or
`{ v, at }` — a one-tap preference written ONCE, never overwritten once set — see
`setBaseballHand`), `history` (object keyed by careerId, empty until a career finishes, never
pruned).

`recordBaseball(league, won, extras)` is additive-only and idempotent BY CONTRACT ONLY: the
CALLER must call it at most once per finished game. The writer itself never de-duplicates. A write
that fails is queued (`gamehub.pendingResults.v1`) and replayed on the next load, same as every
other recorder in that file.

`setBaseballHand(hand)` writes `{ v, at: Date.now() }` only when no hand is stored yet; it warns
(`console.warn`) and returns the existing value on any later attempt, and rejects anything outside
`BB_HANDS`.

`recordBaseballCareerFinished(row)` unions one `history` row by `careerId` — an existing row is
replaced only if the incoming row's `endedAt` is later — then bumps `careersFinished`.

### The history row, frozen

```
{ v: 1, careerId, startedAt, endedAt, hand, finalLeague, bestLeague, bestTrophyByLeague,
  wsTitles, perfectSeasons, seasons, played, won, lost, forfeits, rulesV }
```

Timestamps are epoch milliseconds; every numeric field is an integer. **This row is a summary,
not the career.** The full career document lives under `careers/<CODE>/baseball/history/<careerId>`
in Firebase (see "Career sync" below) — `bb.history` exists so My Stats and the leaderboard have
something to read locally without a network round trip.

### careerId, frozen

`<CODE>-<startedAtMs>-<RAND>`, where `RAND` is `CAREER_ID_RANDOM_LEN` (4) characters drawn from
`CAREER_ID_ALPHABET` (the same alphabet as player codes: `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), via
`crypto.getRandomValues` with the same fallback `js/game-stats.js`'s `deviceId()` uses. Unique
across one person's devices without any coordination between them, and sortable by start time.
Minted by `js/career-store.js`'s `mintCareerId(code, now, rand)`.

## Career sync (`js/career-store.js`)

Shared, network-first, no DOM, no Firebase import at module scope (boots through
`getStatsApp()`, same as `js/stats-net.js`). Full contract, the reconcile rule and the node shape:
`js/CLAUDE.md`, "Career sync". Summary:

- **The node**: `careers/<CODE>/baseball/{live, history/<careerId>, forks/<deviceId>-<time>}`.
  `live` sits one level down from `baseball` because a node is a document or a parent, never both
  — `history` and `forks` are parents (collections of documents), `live` is one document.
- **The document**: `{ v, code, careerId, seq, baseSeq, updatedAt, device, rulesV, state }` —
  `state` is opaque to this module.
- **`reconcile(local, remote)`** returns `none` / `adopt` / `push` / `fork` by comparing each
  side's `seq` against the shared `baseSeq` — the same shape of decision `js/net.js`'s divergence
  handling makes for multiplayer, applied here to one person's own devices instead of two players.
- **A fork writes the local document to `forks/` before adopting the remote one** — nothing a
  player did locally is ever silently discarded (THE LAW rule 1), it is archived under its own
  path instead.
- **Retiring a career** (`retireCareer`) is one multi-path Firebase `update()` writing
  `history/<careerId>` and nulling `live` together, re-read to verify both landed, THEN
  `recordBaseballCareerFinished(row)` folds the summary into `js/game-stats.js`'s local store.
- **Sync health states**: `HEALTH_OK`, `HEALTH_PULLING`, `HEALTH_OFFLINE_LOCAL`, `HEALTH_FORK`,
  `HEALTH_DENIED` — recorded in `gamehub.careerSync.v1`, the same "never fail silently" habit
  `js/stats-net.js`'s `syncHealth()` established (THE LAW rule 6). A permission-denied write
  records `HEALTH_DENIED` and logs at `console.error`; nothing throws to the caller, and the store
  keeps playing locally regardless of what Firebase says.
- **Until `database.rules.json`'s `careers` branch is published** (Matt publishes rules by hand,
  app first — see `database.rules.README.md`), every write here is denied and the store says so
  loudly while continuing to work offline.

## Design doc

`Baseball Game Design Doc v6` (sections 4, 5, 6, 15, 16) is the source for everything about how
the game will actually play. Nothing in this phase builds against it beyond the frozen
identifiers and shapes above — read it before starting phase 1.
