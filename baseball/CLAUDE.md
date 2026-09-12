# Baseball — CLAUDE.md

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file.

## Status: Phase 1 (BB-1) + BB-1a — the headless engine, now built against the real design doc

Phase 1 (BB-1-phase-1-handoff.md, 2026-09-12) added a pure, deterministic, seeded game simulation
engine under `baseball/js/engine/` — no DOM, no game-hub UI, no stats recording, no Firebase, and
it does not run through the placeholder tile. `baseball/js/ui.js` is untouched and still renders
the same one "coming soon" screen Phase 0 shipped. Phase 0's frozen stats shape, career sync store
and rules branch are also untouched.

**BB-1a (2026-09-12, same day) replaced every invented settings.js constant with the real ones.**
"Baseball Game Design Doc v8" — cited by Phase 1's own handoff but never available in this repo or
session — is now committed at **`docs/BASEBALL-DESIGN-DOC.md`**, byte-for-byte, and is the source
of truth for every number below. Read it before touching `settings.js` again. Where the doc gives a
value directly it is tagged with the doc's own status word ([Locked]/[Tested]/[Draft]) and section
number; where the doc is silent, the constant is still invented and tagged `// Draft [Open item N]`
(continuing past the doc's own numbered open-items list, which stops at 15).

Matt's instructions for both milestones: commit on the branch, do not push, do not open a PR. Named
constants everywhere, no magic numbers. Every commit that changes a numeric or versioned value
states the old and new value. Nothing under `js/`, `business-deal/js/game-stats-global.js`,
`baseball/js/ui.js`/`css/`/`strings.js`/`index.html`, another game's folder, or
`database.rules.json` was touched by either milestone.

### The engine (`baseball/js/engine/`)

| File | Role |
|---|---|
| `rng.js` | `mulberry32`/`stepRng` (seeded PRNG; `stepRng` is the pure step that makes the whole engine's randomness position resumable through a plain integer), `hashSeed`, `pickWeighted`, `gaussian`. The ONLY source of randomness anywhere in the engine |
| `settings.js` | every named constant the engine plays by, sourced from `docs/BASEBALL-DESIGN-DOC.md` where the doc gives one — leagues, season/playoff shape, per-league point/cap/preset tables, pitch types/unlocks/travel multiples, the mph readout (display-only), CPU tuning, pattern-memory window, field/park geometry (still invented, Open item 7), team-generation styles, skill effects, and the real game rules (3 innings, extra-inning ghost runner, double plays, walk-off, foul-never-K3). `RULES_V` is this file's own schema version (2 as of BB-1a — the skill-id shape changed) |
| `pitch.js` | `flyPitch()` — one pitch thrown, pure function of (type, aimX, pitchAcc skill, settings, a rand01 stream). **One flat plane** (doc §1, [Locked]): a pitch has ONE spatial coordinate (`x`, a fraction of the plate half-width), never a height axis — BB-1a dropped phase 1's invented 2-D zone. Owns `ZONE` (`{xMin:-1, xMax:1}`) |
| `swing.js` | `swing()` — resolves one batter decision against an already-thrown pitch on TWO independent doc-given axes: timing (early/late, ms) decides contact quality AND pull direction; lateral placement (bat sweet-spot position vs. the pitch's actual `x`) decides hit type (centered = line/fly, off-center = grounder or pop-up) |
| `outcomes.js` | `resolveContact()`/`carryFt()` — turns a batted ball into an out, an error, or a hit of 1-4 bases, reading the park's own wall distances. Takes a `fieldingSkill01` (0..1) rather than a per-player skill — the real design has no "fielding" stat at all (Open item 7) |
| `bases.js` | pure runner-advancement rules: `advanceAll` (hits), `advanceWalk` (forced advances only), `advanceSacFly`, `advanceDoublePlay` (BB-1a, doc §3), `emptyBases` |
| `game.js` | `Game` — the whole match: async turn loop (`await agent.decidePitch/decideSwing(view)`), `onEvent`/`onDecided` hooks (Escoba's pattern), `snapshot()`/`static fromSnapshot()`/`validateSnapshot()` (`SNAP_V`, forward-only against `RULES_V` since BB-1a — see below) |
| `agents.js` | `CpuPitcher`, `CpuBatter` (draw all their randomness from `view.rand01`, the same stream `game.js` snapshots — never `Math.random`; BB-1a wired them straight to the doc's own `swingIn`/`chase`/`timingSigmaMs`/`guess` fields), `ScriptedAgent` for deterministic test replay |
| `teams.js` | `makeTeam(league, index)` — deterministic roster generation from a hashed seed (golf's `holegen.js` pattern: same seed in, byte-identical team out, nothing persisted); `effectiveCapFor(league)` = `CAPS[league] - CPU_LEVEL_SHORTFALL[league]` (doc §8, [Locked]: CPU teams are generated below the raw cap, never at it), `teamStrength()` |

**The three constraints, and their tests (unchanged by BB-1a):**

1. **Seeded RNG only.** Every draw goes through `rng.js`'s `stepRng`; nothing in `engine/` calls
   `Math.random`, `Date.now`, touches the DOM, storage or the network. Enforced by
   `baseball/js/test.js` section 2, which reads every engine file as text (comments stripped) and
   fails if a forbidden API appears.
2. **Fixed timestep, no wall clock.** `FEEL.engine.dtS` is `1/120` (doc §15, [Locked]: "matching
   Golf and Hill Climb") and `maxSteps` is `5` — though this phase's turn-based match loop does not
   itself need a per-frame integrator (there is no continuous physics to step yet); the constants
   exist now so a future phase that animates a pitch/swing has them already named and tested.
3. **Pluggable async agents.** `Game` never assumes who is deciding — `await agent.decidePitch(view)`
   / `await agent.decideSwing(view)`, and the engine legalizes whatever comes back (an unknown pitch
   type falls back to a fastball; a missing decision is treated as a take) rather than trusting it,
   the same discipline Escoba's `legalize()` applies to a human or AI move. `ScriptedAgent` proves
   the seam works for a scripted replay; `CpuPitcher`/`CpuBatter` prove it for an AI.

**Resumability**: because a pitch is thrown and its swing decided within one pass of `playAtBat`'s
inner loop with no `await this.emit(...)` boundary the caller could act on in between, `abort()` is
honored only BETWEEN passes — never mid-pitch. `Game` carries two one-shot resume flags
(`_resumePending` for the at-bat's balls/strikes, `_resumeHalfPending` for the half-inning's outs),
consumed the first time `playAtBat`/`playHalfInning` run after a `fromSnapshot()` restore, so the
restored count/outs are never zeroed back out from under them — Escoba's `_resumeMidRound` pattern,
one level lower. **This was found by the resume gate itself, born red twice before it passed**: the
first defect was the mid-pitch abort point silently discarding a thrown-but-undecided pitch's
random draws (a resumed game then drew a brand-new pitch instead of deciding the one already
thrown, diverging from an uninterrupted game's draw sequence from that moment on); the second was
`playAtBat`/`playHalfInning` unconditionally zeroing the count/outs they had just been handed by
`fromSnapshot()`. **BB-1a made this forward-only, per doc §15** ("`SNAP_V` is bumped and migrated
forward-only, never reinterpreted"): `validateSnapshot()` now rejects any snapshot whose `rulesV`
does not exactly match the running code's `RULES_V`, rather than merely checking it is a number.

### Units and conventions

- Lateral positions (pitch/aim/bat placement) are FRACTIONS of the plate's half-width (doc §15,
  [Locked]) — `x` in `[-1, 1]` is inside the strike zone. This replaced phase 1's invented 2-D,
  feet-based zone: doc §1 is explicit that height never matters ("one flat plane").
  Field/park distances (carry, wall placement) stay in FEET — a separate axis, untouched by the
  1-D plate model.
- Speeds are expressed as travel-time MULTIPLES of the fastball (`PITCH_TRAVEL_MULT`, doc §14),
  not raw mph; `READOUT`'s mph table is DISPLAY ONLY and feeds nothing in the engine (doc §11,
  [Locked]: "It is display only; how fast the ball actually travels is a separate tuned value").
- Timing is in milliseconds (swing timing error, `FEEL.engine.timingWindow` etc.); engine-internal
  durations (`dtS`) are in seconds.
- A player id is a per-team slot string (`p0`..`p8`); `teams.js` never mints a game-wide unique id,
  since nothing this phase needs one.
- Every pure function takes its `rand01`/`rng` stream as an explicit parameter, never closes over
  one implicitly.

### Every settings.js constant, by source

Doc-given values (status + section per `docs/BASEBALL-DESIGN-DOC.md`): `LEAGUES` (§4), `SEASON.*`
except `gamesPerSeason` which is [Draft] §4, `START_POINTS_PER_SIDE`/`START_CAP`/`CAPS.*` (§6),
`PITCH_UNLOCKS`/`TITLE_PITCH_UNLOCKS` (§11, [Locked]), `PITCH_TRAVEL_MULT` for
fastball/changeup/curveball/slider/knuckleball ([Tested] §14), `READOUT.*` ([Draft] §11/§14),
`FEEL.engine.*` and `FEEL.ui.*` (all [Tested] §14, the prototype's own tuned values), `CPU.college`
([Tested] §14; the other four leagues are a copied placeholder), `PATTERN_WINDOW` ([Locked] §8),
`LEFTY_RATE` (§9), `MECHANICS.walkoffEndsImmediately`/`extraInningRunnerOnSecond`/
`doublePlayEnabled`/`foulNeverThirdStrike`/`maxExtraInnings` (all [Locked] §3 — the extra-innings
cap is explicitly a safety valve per the doc's own wording, never a stated rule), `HIT_SKILL_IDS`/
`PITCH_SKILL_IDS` (§6), `PRESETS.*` (§6, [Draft]), `TEAM_STYLES` NAMES (§9, [Locked] — the eight
styles), `SHIFTERS_ADJUST_OUT_ZONES` (§9, [Locked], not yet consumed anywhere).

Still invented, tagged Draft `[Open item N]` (my own numbering; the doc's own list stops at 15):

| Constant(s) | Open item | What it's for |
|---|---|---|
| `PITCH_TRAVEL_MULT.screwball/eephus/cutter` | 9 | doc explicitly leaves these three open |
| `CPU.little/highschool/minors/majors` | 3 | copied placeholders of the prototype's one tested (`college`) tier |
| `CPU_LEVEL_SHORTFALL.*` | 3 | per-skill, cumulative by league; for the phase 2 simulator to verify |
| `PATTERN_WEIGHTS` | — | doc gives the exact array (`[0.5,0.3,0.2]`), tagged [Draft] by the doc itself |
| `FIELD.*`/`PARKS.*` | 7 | doc §10 explicitly leaves "exact zone sizes and fence distances per league" open; phase 1's invented placeholder distances are unchanged, just tagged |
| `TEAM_STYLES`/`TEAM_STYLE_WEIGHTS` weight VECTORS | 25 | the doc names the 8 styles but gives no numbers for them at all |
| `SKILL_EFFECT.*`/`SKILL_EFFECT_MAX_PER_POINT` | 4 | doc §6 explicitly leaves "how much each skill point changes each effect" open |
| `MECHANICS.doublePlayChance` | 26 | doc locks that a double play CAN happen, not how often |
| `outcomes.js`'s `CARRY_SCALE` (carryFt) | 23 | calibrated so a 105mph/30deg swing carries ~400ft (a real, commonly-cited Statcast home-run swing) |
| `outcomes.js`'s ground/line/fly hit-through and drop-chance base rates | 24 | tuned by playing whole games out, not measured against anything |
| `_defenseLevel01()` in game.js | 7 | a placeholder league-ordered ramp standing in for the doc's out-zone geometry, which does not exist yet |

### Rules decided here, beyond what the doc and the handoffs' own text pre-decided

1. **A pitch/swing cycle is the atomic unit a snapshot can interrupt between, never inside** — see
   "Resumability" above.
2. **A pitcher's control skill is `pitchAcc`** (doc §6: "lands closer to your aim... bigger Nice
   zone, better pickoffs" — the Nice-zone and pickoff halves are not modeled this phase).
3. **Which side of "off-center" is the bat's end vs. the handle** (`swing.js`'s sign convention) is
   this engine's own invented choice — the doc states the qualitative rule ("grounder toward the
   bat's end, pop-up toward the handle") but not which lateral direction that is.
4. **CPU team skill allocation** (`teams.js`'s `allocateSkills`) — the doc names the 8 team styles
   and locks that CPU teams are generated at `effectiveCapFor(league)`, but gives no formula for
   turning a style's weights into six skill values under that ceiling (Open item 25).
5. **`_defenseLevel01()`'s league-ordered ramp** stands in for the doc's real defense model (out-
   zone geometry sized per league, §10) until that geometry is built (Open item 7).
6. **The ground/line/fly-ball hit-through and drop-chance constants (Open item 24) were tuned by
   playing whole games out** with the real CPU agents: the shipped values produce roughly a 24-27%
   hit rate and games finishing within a few innings of the scheduled length across all five
   leagues (see the report below).
7. **`CPU_LEVEL_SHORTFALL` was corrected (2026-09-12, same day) after its first version produced a
   NON-MONOTONIC effective-cap ladder.** The BB-1a handoff's first pass at this table
   (`{little:0, highschool:0, college:9, minors:11, majors:12}`) was a TOTAL across all six skills,
   not per-skill, and did not accumulate league to league — it resolved to effective caps of
   10, 14, 9, 11, 14: College's CPU teams generated WEAKER than Little League's, despite the ladder
   being harder each league up (doc §8, [Locked]). Flagged as a finding rather than silently fixed;
   Matt corrected it the same day to **per-skill, cumulative** values:
   `{little:0, highschool:0, college:1.5, minors:3.3, majors:5.3}`, giving effective per-skill caps
   of **10, 14, 16.5, 18.7, 20.7** — strictly rising. Still Draft, Open item 3 (the phase 2
   simulator's job to verify), but the shape is now correct. `test.js` section 8 carries a
   `[KNOWN-BUG PROBE]` asserting the effective-cap ladder is non-decreasing by league, so this
   exact regression cannot come back silently. `teams.js`'s `allocateSkills` floors the (now
   sometimes fractional, e.g. College's 16.5) effective cap only at the point it clamps an integer
   skill value — `effectiveCapFor()` itself keeps the exact fractional number, which is what the
   monotonicity check needs to be meaningful.
8. Every rule inherited from phase 1's own report and unchanged: no baserunning between pitches
   this phase (no steals/leads/pickoffs — doc §3/§17 names these Locked FEATURES with reserved
   input slots for phase 6, see `RESERVED_PHASE_6` in settings.js); a hit of N bases advances
   everyone exactly N bases; a sac fly scores only the runner from third; fielding defense has no
   per-position split.

### Verification

```
node baseball/js/test.js        # 705 assertions, 0 failed
node test-game-conventions.mjs  # 11 passed, 0 failed, no new known-gap entries
node validate-sw-assets.mjs     # every engine/*.js file present in ASSETS; REST_MANIFEST/version.json regenerated for game-hub-v808
node test-sw-strategy.mjs       # 107 passed, 0 failed
```

Measured median full-game time (40-game speed gate, majors): well under 1ms/game — this is a
turn-based simulation with no per-frame rendering cost. Per-league median (8 seeds each, section
10): 0-1ms across all five leagues. `DETERMINISM_SEED = 424242`; `RESUME_SEED = 909090` (stopped
after 15 pitches, restored, and proven to reach the exact same final `snapshot()` as an
uninterrupted game with the same seed).

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

**`docs/BASEBALL-DESIGN-DOC.md`** ("Baseball Game Design Doc v8") is committed to this repo as of
BB-1a (2026-09-12) and is the source of truth for `settings.js`. It was cited by the phase-1
handoff but was not present anywhere in this repository, in git history, or in any session before
that — confirmed by exhaustive search, twice (once for a "v6" citation, once for "v8"). Read it,
not this file, for how the game is actually meant to play; this file records which `settings.js`
constants come from it (with the doc's own [Locked]/[Tested]/[Draft] status and section number)
and which are still invented (`// Draft [Open item N]`, listed above). If a future revision of the
doc lands, update the committed copy, `settings.js`, and this pointer together in the same
milestone.
