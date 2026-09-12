# Baseball — CLAUDE.md

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file.

## Status: Phase 1 — the headless engine only, still no UI

This milestone (BB-1-phase-1-handoff.md, 2026-09-12) adds a pure, deterministic, seeded game
simulation engine under `baseball/js/engine/` — no DOM, no game-hub UI, no stats recording, no
Firebase, and it does not run through the placeholder tile. `baseball/js/ui.js` is untouched and
still renders the same one "coming soon" screen Phase 0 shipped. Phase 0's frozen stats shape,
career sync store and rules branch are also untouched by this milestone.

**"Baseball Game Design Doc v8" is still not present anywhere in this repository or session** —
confirmed by exhaustive search before this phase's own settings file was written (the same search
Phase 0 already recorded for v6). Every numeric table in `js/engine/settings.js` that is not
already frozen elsewhere (the stats shape, the league ladder) is therefore an INVENTED Draft
placeholder, tagged `// Draft [Open item N]` at the line it lives on — see that file's own header
and the table below. Nothing about how the game FEELS should be assumed authoritative; a future
phase with the real doc should replace every tagged line.

Matt's instructions for this phase: commit on the branch, do not push, do not open a PR. Named
constants everywhere, no magic numbers. Every commit that changes a numeric or versioned value
states the old and new value. Nothing under `js/`, `business-deal/js/game-stats-global.js`,
`baseball/js/ui.js`/`css/`/`strings.js`/`index.html`, another game's folder, or
`database.rules.json` was touched — only `baseball/js/engine/*` (new), `baseball/js/test.js`
(new), `sw.js` and `run-all-tests.mjs`.

### The engine (`baseball/js/engine/`)

| File | Role |
|---|---|
| `rng.js` | `mulberry32`/`stepRng` (seeded PRNG; `stepRng` is the pure step that makes the whole engine's randomness position resumable through a plain integer), `hashSeed`, `pickWeighted`, `gaussian`. The ONLY source of randomness anywhere in the engine |
| `settings.js` | every named constant the engine plays by — leagues, season shape, point budgets, pitch types/unlocks/profiles, CPU tuning, pattern-memory window, field/park geometry, team-generation styles, skill effects, and the rules the (unavailable) doc doesn't settle. `RULES_V` is this file's own schema version |
| `pitch.js` | `flyPitch()` — one pitch thrown, pure function of (type, aim, control skill, settings, a rand01 stream). Owns the strike zone (`ZONE`) |
| `swing.js` | `swing()` — resolves one batter decision against an already-thrown pitch: take/whiff/foul/in-play, plus exit velocity/launch angle/spray angle when the ball is hit |
| `outcomes.js` | `resolveContact()`/`carryFt()` — turns a batted ball into an out, an error, or a hit of 1-4 bases, reading the park's own wall distances |
| `bases.js` | pure runner-advancement rules: `advanceAll` (hits), `advanceWalk` (forced advances only), `advanceSacFly`, `emptyBases` |
| `game.js` | `Game` — the whole match: async turn loop (`await agent.decidePitch/decideSwing(view)`), `onEvent`/`onDecided` hooks (Escoba's pattern), `snapshot()`/`static fromSnapshot()`/`validateSnapshot()` (`SNAP_V`) |
| `agents.js` | `CpuPitcher`, `CpuBatter` (draw all their randomness from `view.rand01`, the same stream `game.js` snapshots — never `Math.random`), `ScriptedAgent` for deterministic test replay |
| `teams.js` | `makeTeam(league, index)` — deterministic roster generation from a hashed seed (golf's `holegen.js` pattern: same seed in, byte-identical team out, nothing persisted), `teamStrength()` |

**The three constraints, and their tests:**

1. **Seeded RNG only.** Every draw goes through `rng.js`'s `stepRng`; nothing in `engine/` calls
   `Math.random`, `Date.now`, touches the DOM, storage or the network. Enforced by
   `baseball/js/test.js` section 2, which reads every engine file as text (comments stripped) and
   fails if a forbidden API appears.
2. **Fixed timestep, no wall clock.** `FEEL.engine.dtS` is `1/120` and `maxSteps` is `5` — the same
   pair Hill Climb's `physics.js` and Pinball's solver use — though this phase's turn-based match
   loop does not itself need a per-frame integrator (there is no continuous physics to step yet);
   the constants exist now so a future phase that animates a pitch/swing has them already
   named and tested (section 1).
3. **Pluggable async agents.** `Game` never assumes who is deciding — `await agent.decidePitch(view)`
   / `await agent.decideSwing(view)`, and the engine legalizes whatever comes back (an unknown pitch
   type falls back to a fastball; a missing decision is treated as a take) rather than trusting it,
   the same discipline Escoba's `legalize()` applies to a human or AI move. `ScriptedAgent` proves
   the seam works for a scripted replay; `CpuPitcher`/`CpuBatter` prove it for an AI. Section 9.

**Resumability** (section 12): because a pitch is thrown and its swing decided within one pass of
`playAtBat`'s inner loop with no `await this.emit(...)` boundary the caller could act on in
between, `abort()` is honored only BETWEEN passes — never mid-pitch. `Game` carries two one-shot
resume flags (`_resumePending` for the at-bat's balls/strikes, `_resumeHalfPending` for the
half-inning's outs), consumed the first time `playAtBat`/`playHalfInning` run after a
`fromSnapshot()` restore, so the restored count/outs are never zeroed back out from under them —
Escoba's `_resumeMidRound` pattern, one level lower (an at-bat, not a round). **This was found by
the resume gate itself, born red twice before it passed**: the first defect was the mid-pitch
abort point silently discarding a thrown-but-undecided pitch's random draws (a resumed game then
drew a brand-new pitch instead of deciding the one already thrown, diverging from an uninterrupted
game's draw sequence from that moment on); the second was `playAtBat`/`playHalfInning` unconditionally
zeroing the count/outs they had just been handed by `fromSnapshot()`.

### Units and conventions

- Distances in FEET throughout (pitch/zone geometry, field/park dimensions, batted-ball carry).
- Speeds in mph (pitch speed, exit velocity); pitch movement in inches; timing in milliseconds
  (swing timing error) or seconds (`FEEL`'s durations).
- A player id is a per-team slot string (`p0`..`p8`); `teams.js` never mints a game-wide unique id,
  since nothing this phase needs one — a future phase touching stats would resolve identity the
  way `js/game-stats.js` already does for every other game, not invent a second scheme here.
- Every pure function takes its `rand01`/`rng` stream as an explicit parameter, never closes over
  one implicitly — the same discipline that makes `pitch.js`/`swing.js`/`outcomes.js` independently
  testable and keeps `game.js`'s `stepRng`-backed stream the only place a draw is ever consumed
  from inside a full match.

### Every settings.js constant this phase invented, tagged Draft (no design doc to source it from)

| Constant(s) | Open item | What it's for |
|---|---|---|
| `SEASON.gamesPerSeason/inningsPerGame/playoffTeams` | 1-3 | season/career shape |
| `POINTS.*` | 4 | per-league point budget |
| `CAPS.perSkill` | 5 | max points in any one skill |
| `PRESETS.*` | 6 | ready-made point allocations |
| `PITCH_UNLOCKS.*` | 7 | which league unlocks which pitch |
| `PITCH_PROFILE.*` | 8 | speed/movement/control per pitch type |
| `READOUT.bands` | 9 | mph-band labels for a future UI |
| `FEEL.engine.pitchFlightS/swingWindowMs/fieldingReactionS` | 10-12 | pitch/swing/fielding timing |
| `FEEL.ui.*` | 13 | not consumed this phase; reserved for a UI phase |
| `CPU.*` | 14 | per-league AI pitch control / swing discipline / contact skill |
| `CPU_LEVEL_SHORTFALL` | 15 | not yet consumed (no CPU-vs-human point handicap wired this phase) |
| `PATTERN_WINDOW`/`PATTERN_WEIGHTS` | 16 | pitch-history recency weighting |
| `FIELD.*` | 17 | field geometry in feet |
| `PARKS.*` | 18 | named ballpark wall-distance overrides |
| `TEAM_STYLES.*`/`TEAM_STYLE_WEIGHTS.*` | 19 | team-generation archetypes and their per-league likelihood |
| `LEFTY_RATE` | 20 | fraction of generated players who bat/throw left |
| `SKILL_EFFECT.*` | 21 | how each bought skill point maps onto engine behavior |
| `MECHANICS.maxExtraInnings` | 22 | a test/safety valve, not a rule exposed to a player |
| `outcomes.js`'s `CARRY_SCALE` (carryFt) | 23 | calibrated so a 105mph/30deg swing carries ~400ft (a real, commonly-cited Statcast home-run swing) — the one invented number anchored to a real external reference rather than picked from nothing |
| `outcomes.js`'s ground/line/fly hit-through and drop-chance base rates | 24 | tuned by PLAYING full games out (see below), not measured against anything, since nothing exists to measure them against |

### Rules decided here, beyond what the handoff's own text pre-decided

1. **A walk-off ends the game immediately** the instant the winning run scores in the bottom of the
   final scheduled inning or later — standard baseball, `MECHANICS.walkoffEndsImmediately`.
2. **Extra innings play in full** (both sides bat) until a winner exists, capped only by
   `MECHANICS.maxExtraInnings` as a safety valve for a headless/test context, never as a stated
   in-game rule. No invented "runner starts on second" tiebreaker — the design doc might specify
   one, and inventing it now would be exactly the kind of fabrication THE LAW's "never fabricate"
   principle warns against carried into gameplay.
3. **No baserunning between pitches this phase**: no steals, no leads, no pickoffs
   (`bases.js`'s header). A runner only ever moves as a direct consequence of the play being
   resolved.
4. **A hit of N bases advances the batter and every runner by exactly N bases** (single=1 ..
   homer=4) — a fixed simplification of real, speed-dependent baserunning, since nothing exists to
   calibrate a "realistic" per-runner advance against.
5. **A sacrifice fly** (a flyout with a runner on third and fewer than 2 outs) scores that runner and
   moves nobody else; a fielding error advances the batter to first exactly like a single.
6. **A pitcher's control skill is drawn from their `arm` point value** — the only one of the five
   bought skills that plausibly maps onto "commands a pitch" without inventing a sixth skill the
   real doc might name differently.
7. **Fielding defense is a team-average**, not a per-position assignment — there is no defensive
   alignment or per-position skill split this phase.
8. **A pitch/swing cycle is the atomic unit a snapshot can interrupt between, never inside** — see
   "Resumability" above.
9. **The ground/line/fly-ball hit-through and drop-chance constants (Open item 24) were tuned by
   playing whole games out** with the real CPU agents rather than by any measurement, since there is
   nothing to measure them against: the first pass produced a ~5% hit rate and most games running to
   the extra-innings cap at 0-0 (verified: 40+ trial games, mostly ties); the shipped values produce
   roughly a 24-27% hit rate and games finishing within a few innings of the scheduled length across
   all five leagues (see the report below). Still a Draft placeholder, just no longer an unplayable
   one.

### Verification

```
node baseball/js/test.js        # 603 assertions, 0 failed
node test-game-conventions.mjs  # 11 passed, 0 failed, no new known-gap entries
node validate-sw-assets.mjs     # every engine/*.js file present in ASSETS; REST_MANIFEST/version.json regenerated for game-hub-v807
node test-sw-strategy.mjs       # 107 passed, 0 failed
```

Measured median full-game time (40-game speed gate, majors): well under 1ms/game — this is a
turn-based simulation with no per-frame rendering cost, so "speed" here means "resolves instantly
enough that a phone could play through a whole season without a noticeable pause," not frame
budget. Per-league median (8 seeds each, section 10): little 2ms, highschool/college/minors/majors
1ms. `DETERMINISM_SEED = 424242`; `RESUME_SEED = 909090` (stopped after 15 pitches, restored, and
proven to reach the exact same final `snapshot()` as an uninterrupted game with the same seed).

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
merge branch must stay in step with. **28 keys → 42** as of the phase 0 "final bb key list"
amendment (2026-09-12): `runs` renamed to `runsScored`, ten new additive keys after
`strikeoutsPitched`, three more after `extraInningGames`, and one new Math.max best.

**Integer counters, additive, default 0, in this exact order:** `careersStarted`,
`careersFinished`, `seasons`, `forfeits`, `wsTitles`, `perfectSeasons`, `hits`, `doubles`,
`triples`, `homers`, `atBats`, `runsScored`, `walksDrawn`, `runsAllowed`, `hitsAllowed`,
`walksIssued`, `inningsPitchedOuts`, `strikeoutsBatting`, `strikeoutsPitched`, `sacFlies`,
`sacBunts`, `rbi`, `stolenBases`, `caughtStealing`, `pickoffs`, `homersAllowed`, `bronzes`,
`silvers`, `golds`, `shutouts`, `walkoffWins`, `extraInningGames`, `noHitters`, `perfectGames`,
`grandSlams`.

**Max counters, Math.max only (THE LAW rule 2), default 0:** `bestRunsGame`,
`bestStrikeoutsPitchedGame`, `bestWinStreak`.

**Then:** `bestLeague` (0 until a career exists, the highest ladder rung 1-5 ever reached),
`bestTrophyByLeague` (one key per `BB_LEAGUES` entry, 0, Math.max per league), `hand` (`null` or
`{ v, at }` — a one-tap preference written ONCE, never overwritten once set — see
`setBaseballHand`), `history` (object keyed by careerId, empty until a career finishes, never
pruned).

**Six facts pinned in `ensureBb`'s own header comment, verbatim:**

1. `atBats` is plate appearances minus `walksDrawn` minus `sacFlies` minus `sacBunts`.
2. `runsScored` is the player's own team; `runsAllowed` is the opponent's.
3. `seasons` increments when a season RESOLVES: after the championship game, or when the regular
   season ends with no playoff place. A missed playoff season still counts.
4. `forfeits` is a breakout of `total.lost` (`bumpTotals` already counts a forfeit as a loss) —
   it exists so "how many of my losses were forfeits" doesn't need a second store to answer.
5. **Derivable but stored, and never recomputed — do not add a third copy:** `careersFinished`
   equals the number of `history` rows; `bestLeague` is derivable from `byDiff`. Both are kept as
   their own stored fields because deriving them at read time would mean every reader (My Stats,
   the leaderboard, a future admin screen) has to agree on the derivation, and a third copy that
   has to agree with two others is exactly the trap rule 9 exists to name.
6. **Derivable but stored, and never recomputed — the second such pair:** `bronzes`/`silvers`/
   `golds` count TROPHIES WON, additively, because `bestTrophyByLeague` is a Math.max PER LEAGUE
   and loses every repeat (winning bronze in Minors twice only ever shows once there). Missed
   playoff seasons = `seasons` minus `(bronzes + silvers + golds)` — a fact worth knowing, not a
   field to add, since deriving it needlessly would be the same trap as fact 5.

`recordBaseball(league, won, extras)` is additive-only and idempotent BY CONTRACT ONLY: the
CALLER must call it at most once per finished game. The writer itself never de-duplicates. A write
that fails is queued (`gamehub.pendingResults.v1`) and replayed on the next load, same as every
other recorder in that file. Internally it folds `extras` through `applyBaseball(g, league,
extras)`, shared with the pending-results replay so the two paths cannot drift apart; `bronzes`/
`silvers`/`golds` are written there, on the same call that raises `bestTrophyByLeague`, from
`extras.trophy` — a caller cannot hand them a number directly, only earn them through a trophy
result.

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

`Baseball Game Design Doc v8` is cited by the phase-1 handoff as the source for everything about
how the game will actually play (sections 3, 6-14 by that handoff's own references). **It is not
present anywhere in this repository, in git history, or in any session to date** — confirmed by
exhaustive search both when this line named v6 and again for phase 1's v8. Every value in
`js/engine/settings.js` not already frozen by this file's own identifier table is therefore an
invented Draft placeholder (tagged `// Draft [Open item N]`, listed in full above), not a
transcription from a real source. Read the real doc before treating any of those numbers, or the
rules-decided-here list above, as settled — and update this pointer and the settings file together
the day it turns up.
