# Baseball — CLAUDE.md

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file.

## Status: Phase 2f — the per-league weakest-slot floor, and a real resume bug found along the way

BB-2f (2026-09-14, continuing BB-2e the same day) landed design doc v11's fix for the exact
contradiction BB-2e's own `--ladder` proof surfaced: `SLOT_WINRATE_WEAKEST_MIN` (the "weakest
opponent beaten at X% or better" floor) was a single flat 0.85 shared by every league, which is
mathematically unsatisfiable in the Majors no matter what ladder shape or schedule is chosen (a
season averaging down to 41-51% cannot also beat its weakest opponent 85% of the time). Doc v11
replaces it with a per-league table and adds a new Locked rule: every league's CPU teams must
generate below that league's own cap, so the champion has room to be tougher than its league
mates - closing the "champion clamps to the exact same ceiling as everyone else" defect BB-2e's
own three-axis exhaustion (timing sigma, chase, behaviorMul) had already traced but could not fix
on its own, since none of those axes touch the skill clamp.

### Commit 1: re-proving the arithmetic, and a correction made within the same commit

`node sim-baseball.mjs --ladder` now reads the per-league floor
(`SLOT_WINRATE_WEAKEST_MIN_BY_LEAGUE`: little 0.95, highschool 0.85, college 0.78, minors 0.70,
majors 0.62 - doc v11 §8, verbatim) instead of the flat 0.85. The FIRST cut of this proof still
fixed the champion at its own band's exact midpoint (0.475) and only swept `slot0` - an
over-constrained check inherited from BB-2e's own version, and it reported Majors as having NO
satisfying shape at all under the new floor. That was a false negative, corrected within the same
commit: the champion band is a real RANGE (`[0.40, 0.55]`), not one point, and `weightedSeasonRate`
is affine (monotone) in both `slot0` and `champion` independently, so the achievable season-rate
interval over the full box is exactly `[rate at the low corner, rate at the high corner]`
(`achievableRangeBox`). Swept properly, **every league now has at least one satisfying shape**
under the shipped `SCHEDULE_SHAPE=repeatMiddle`:

| League | Satisfying shape | Overlap width | Note |
|---|---|---|---|
| little | cliff | 0.0162 | |
| highschool | cliff / spread / steep | 0.0138 / 0.0750 / 0.0771 | all three pass |
| college | spread | 0.0800 | |
| minors | spread | 0.0400 | |
| majors | spread | **0.0000** | knife-edge: only at slot0 exactly at its floor (0.62) AND champion exactly at its band's own floor (0.40) |

Majors' zero-width overlap is flagged rather than declared a clean win - a real margin needs real
measurement, which commit 3's actual simulation (not this arithmetic sanity check) is the true
test of.

### Commit 2: the per-league floor and the shortfall rule

`SLOT_WINRATE_WEAKEST_MIN` folded into the same per-league table everywhere (the main promise
scoreboard's weakest-slot check, not just `--ladder`). A new `DOC_FLOOR_TABLE_MATCHES` scoreboard
line parses doc v11 §8's own table straight out of the committed markdown and asserts it is
byte-identical to the hand-transcribed constant - the same discipline `test-new-badge.mjs`/
`test-emoji.mjs` apply to their own generated data, closing a gap `SEASON_WINRATE_BAND`'s own
table never had.

`CPU_LEVEL_SHORTFALL.little`/`.highschool`: `0` → `1` (Draft placeholder) → **`3` / `1`** after
commit 3's own measurement (see below). A new `CPU_LEVEL_SHORTFALL (no league generates every team
at its own cap)` scoreboard line, plus a structural `baseball/js/test.js` §1 assertion
(`CPU_LEVEL_SHORTFALL.${lg} is nonzero`), both enforce doc v11's new rule going forward.

### A real, pre-existing resume-correctness bug, found by retuning a constant

Bumping `CPU_LEVEL_SHORTFALL.highschool` off zero perturbed a roster's skill values just enough to
shift which pitch of `test.js`'s fixed `RESUME_SEED=909090` happened to be its scripted abort
point - and the new pitch landed exactly on one that ALSO concluded an at-bat, a case section 12's
resume test had never exercised before. `Game.fromSnapshot` set `_resumePending`/
`_resumeHalfPending` unconditionally to `true` on every resume, trusting a snapshot was always
taken mid-progress. It is not: when an at-bat or half-inning concludes, the "reset for whoever's up
next" step was deferred to the START of the next `playAtBat()`/`playHalfInning()` call - a call
that never happens on the aborted game object itself (the outer loop stops the instant `aborted`
is set). A snapshot taken right as a unit concluded carried that unit's own final (nonzero)
balls/strikes/outs, and resuming wrongly preserved them instead of resetting for the next
batter/half-inning. A related defect in the same family: `playAtBat`'s check right after
`emit('count', ...)` could fire after strikes/balls had just reached their own out/walk threshold
but before that threshold was checked, snapshotting an invalid stuck state.

Fixed with two new snapshot fields, `atBatOpen`/`halfInningOpen` (true from the moment a unit
starts, false the instant it genuinely concludes - unconditionally, regardless of `aborted`, since
`emit()` already self-guards notifications on its own). `fromSnapshot` now restores
`_resumePending`/`_resumeHalfPending` FROM these flags instead of a blanket `true`. **`SNAP_V`
bumped 1 → 2** (doc §15, [Locked]: forward-only, never reinterpreted) - an old v1 snapshot is
rejected outright, never resumed with a guessed value for the two new required fields. A new
`[KNOWN-BUG PROBE]` (`test.js` section 12b) sweeps 24 seeds × 40 stop-points, asserting
non-vacuously that the sweep actually exercises both an at-bat-conclusion and a
half-inning-conclusion abort, and that every one resumes byte-identically to its own
straight-through reference.

### Commit 3: the retune, and a genuine, measured structural ceiling

Per-league shortfall sweeps (1/2/3/5/7/9), `sim-baseball.mjs --assert` per league:
`teams.js`'s `makeLeague` clamps every slot's skill to `min(rawCap, baseCap * (1 + offset))` - the
champion's own `+0.25` offset only escapes the RAW cap once `baseCap * 1.25 < rawCap`. For Little
League (rawCap 10) that needs shortfall > 2; for High School (rawCap 14) it needs shortfall > 2.8.
Below those thresholds the champion was ALWAYS clamped to the exact same raw cap as a
zero-headroom generation, regardless of its offset - doc v11's own diagnosis confirmed correct by
direct measurement.

**`little: 3`** - best point on its own sweep (season/weakest both PASS; champion moves 0.93 →
0.90, the largest improvement any tested value bought; 5/7/9 fail the weakest floor for no further
champion gain). **`highschool: 1`** - best point on ITS sweep (season 0.75/weakest 0.81 both PASS;
2+ fails the weakest floor for no further champion gain - champion sits at 0.71-0.79 across the
whole 1-4 range, moving only ~2-8pp). **college/minors/majors unchanged** (3/4/4) - college's own
weakest-slot value (0.656) does not move with shortfall at all (byte-identical to BB-2e's own
report); that bottleneck is a different, shared axis (`LADDER_AXIS_ENDPOINTS`), out of this phase's
contract to retune without risking Little League's own now-passing bands.

**The genuine finding, measured rather than assumed**: Little League and High School's champion
band is NOT reachable within this phase's contract, even with `CPU_LEVEL_SHORTFALL` pushed far
past any shippable value. A sweep to shortfall 9 for Little League (an effective cap of 1 skill
point out of 10) still only moved its champion win rate to 0.87-0.93 - nowhere near `[0.40, 0.55]`.
Skill, now genuinely unclamped for the first time, joins timing sigma/chase/behaviorMul (BB-2e's
own three, each independently exhausted) as a FOURTH axis that cannot close this gap alone. Not
chased further: a shortfall large enough to matter would also fail `NUDGE_A_B` (a nearly
skill-less team cannot express "well-timed low-Power beats sloppy high-Power" either).

### The full scoreboard (`node sim-baseball.mjs --assert`, full sample, 44.9s)

```
[PASS] SEASON_WINRATE_BAND, all 5 leagues simultaneously (little 0.936, highschool 0.748,
       college 0.586, minors 0.566, majors 0.485) - unchanged from BB-2e, preserved.
[PASS] SEASONS_TO_GOLD_TARGET.little (1.19) / .highschool (1.81) - BOTH PASS, highschool
       crossing from FAIL (1.90 at BB-2e) to PASS (1.81) this commit.
[FAIL] SEASONS_TO_GOLD_TARGET.college (4.29) / .minors (5.00) / .majors (8.57) - the same
       compound-probability bottleneck every phase since BB-2b has reported, untouched
       (POINTS/SEASON out of this phase's contract).
[PASS] CHAMPION_GAME_WIN_MIN_MEDIAN (0.455), PERFECT_SEASON_REACHABLE (0.59 >= 0.02),
       LADDER_MONOTONE (across-league), NUDGE_A_B (every league, min margin 0.182 - no
       regression from the shortfall changes), CONTACT_GRID (all 5, byte-identical).
[FAIL] SLOT_WINRATE_BAND weakest: [0.942, 0.814, 0.656, 0.655, 0.594] vs
       [0.95, 0.85, 0.78, 0.7, 0.62] - every league now sits CLOSE to its own floor (little
       misses by 0.008, highschool by 0.036) rather than the old flat-0.85 target's much
       larger misses at college/minors/majors.
[FAIL] SLOT_WINRATE_BAND champion: [0.903, 0.712, 0.531, 0.54, 0.449] vs [0.40, 0.55] -
       college/minors/majors ALREADY PASS (unchanged from BB-2e); little/highschool fail,
       per the structural ceiling above.
[FAIL] CHAMPION_IS_HARDEST / within-league LADDER_MONOTONE: unchanged structural finding from
       BB-2c/2d/2e (a Sluggers/Shifters-style ordering anomaly; STYLE_STRENGTH_DELTA stale
       since BB-2d's own retune - re-measuring it is a separate job, per that commit's note).
[FAIL] CAP_BINDS_ONLY (highschool): 2.1 seasons vs <=2.0 - a 0.1-season miss present in every
       phase's own report back to BB-2b; POINTS out of this phase's scope, untouched.
```

### Measured per-league slot profiles beside their bands (full sample, weakest..strongest)

```
little      94.2  93.5  93.5  94.6  91.4  92.5  92.0  90.3   season 93.6%  weakest-floor 0.95  champion-band [0.40,0.55]
highschool  81.4  75.7  75.4  78.2  75.0  77.0  72.4  71.2   season 74.8%  weakest-floor 0.85
college     65.6  64.6  59.4  60.5  56.5  58.6  51.4  53.1   season 58.6%  weakest-floor 0.78
minors      65.5  60.0  57.1  57.7  57.1  55.9  43.6  54.0   season 56.6%  weakest-floor 0.70
majors      59.4  56.1  52.6  50.7  50.2  51.0  36.3  44.9   season 48.5%  weakest-floor 0.62
```

### Seasons-to-Gold, measured (not tuned to)

little 1.19, highschool 1.81 (both now inside their own target+tolerance), college 4.29, minors
5.00, majors 8.57 (all three still miss - the compound-probability bottleneck, reported not
forced, every phase since BB-2b).

### Constants touched this phase, by source

| Constant | Old | New |
|---|---|---|
| `SLOT_WINRATE_WEAKEST_MIN` (sim-baseball.mjs) | flat `0.85` | `SLOT_WINRATE_WEAKEST_MIN_BY_LEAGUE`, per doc v11 §8: `{little:0.95, highschool:0.85, college:0.78, minors:0.70, majors:0.62}` |
| `parseDocWeakestFloorTable`/`DOC_FLOOR_TABLE_MATCHES` (new) | - | doc-text parser + scoreboard line binding the table to its own source |
| `CPU_LEVEL_SHORTFALL.little` | `0` | `3` |
| `CPU_LEVEL_SHORTFALL.highschool` | `0` | `1` |
| `CPU_LEVEL_SHORTFALL.college`/`.minors`/`.majors` | `3`/`4`/`4` | unchanged |
| `Game.SNAP_V` | `1` | `2` (forward-only bump) |
| `Game` snapshot shape | - | `atBatOpen`/`halfInningOpen` booleans added |
| `sw.js` `CACHE` | `game-hub-v827` | `game-hub-v828` (past `origin/main`'s `v824` at time of this phase) |

Not touched: `POINTS`, `CAPS`, `SEASON`, trophies, the contact grid's own assertions,
`CPU_SIGMA_ABSOLUTE_FLOOR_MS`, `CPU_PLACEMENT_MIN`, `LEAGUE_LADDER_STYLES`, `js/`, `baseball/js/
ui.js`/`css/`/`strings.js`/`index.html`, any other game folder, the frozen `bb` stats shape,
BB-2d's carry calibration, the maxed tier, `LADDER_SHAPE`.

### The Locked-statement inventory, phase-implemented, with the test that proves each

| Locked statement (design doc v11) | Test |
|---|---|
| §8 per-league weakest-slot floor table (was a single flat value) | `sim-baseball.mjs --assert`'s `SLOT_WINRATE_BAND (weakest)` + `DOC_FLOOR_TABLE_MATCHES` |
| §8 "every league's CPU teams are generated below that league's cap... no league may generate every team at the cap" | `sim-baseball.mjs --assert`'s `CPU_LEVEL_SHORTFALL` line + `baseball/js/test.js` §1 |
| §8 the champion band is a real range, not a single point (arithmetic proof) | `sim-baseball.mjs --ladder`'s `achievableRangeBox` |
| §15 "SNAP_V is bumped and migrated forward-only, never reinterpreted" | `baseball/js/test.js` §12 (`bad4`/stale-`rulesV` rejection) + the `SNAP_V` bump itself |

### Self-review, answered line by line

- The per-league floor table matches the doc exactly: **yes** - `DOC_FLOOR_TABLE_MATCHES` parses
  the committed markdown directly, not a hand-copied literal.
- No league generates every team at its own cap: **yes** - `CPU_LEVEL_SHORTFALL` scoreboard line +
  `test.js` §1, both nonzero at every league.
- The resume bug fix does not regress any existing resume behavior: **yes** -
  `test.js` section 12 (the original fixed-seed probe) and the new section 12b sweep both pass,
  2536→2541 assertions total, 0 failed.
- `RULES_V` unchanged (no roster/team shape changed this phase); `SNAP_V` bumped because the
  snapshot's own field shape changed: **yes**.
- The champion/season bands were not reopened: **yes** - `SEASON_WINRATE_BAND`/
  `SLOT_WINRATE_CHAMPION_MIN`/`MAX` are byte-identical to BB-2e; only `CPU_LEVEL_SHORTFALL` (a
  lever, not a band) moved.
- The contact grid unchanged: **yes**, byte-identical (college league untouched this phase).

### Verification (Phase 2f, in order)

```
node validate-sw-assets.mjs           # ok, REST_MANIFEST/version.json regenerated for game-hub-v828
node baseball/js/test.js              # 2541 passed, 0 failed (was 2533 at the start of this phase)
node sim-baseball.mjs --ladder        # see commit 1's own table above
node sim-baseball.mjs --contact-grid  # PASS on all 5, byte-identical to before this phase
node sim-baseball.mjs --assert --quick   # FAILS - sampling noise at this sample size, same
                                          # caveat every phase has noted
node sim-baseball.mjs --assert           # see the full scoreboard above
node test-game-conventions.mjs           # 11 passed, 0 failed, no new known-gap entries
node validate-sw-assets.mjs               # re-run, unchanged
node test-sw-strategy.mjs                 # 107 passed, 0 failed
```

**`sim-baseball.mjs --assert` still fails, on real, reported findings - the same discipline every
phase of this effort has followed.** This phase's real, banked progress: doc v11's per-league
weakest-slot floor landed with an automated doc-to-code binding check; `CPU_LEVEL_SHORTFALL` moved
off zero for the two leagues doc v11 flagged, with the champion-clamp mechanism now genuinely
measured (not assumed) to respond to it; `SEASONS_TO_GOLD_TARGET.highschool` crossed from FAIL to
PASS; and a real, previously-latent resume-correctness bug was found and fixed with a
non-vacuous regression probe, purely because retuning a constant happened to shake it loose.
Little League/High School's champion band remains a measured structural ceiling - specific enough
for a future session to know that CPU_LEVEL_SHORTFALL alone cannot close it, rather than
re-deriving the diagnosis from scratch.

## Status: Phase 2e — the ladder SHAPE, not a hand-tuned array

BB-2e (2026-09-14) answered BB-2d's own open question - "Little League/High School's champion-slot
band is mathematically incompatible with their season band" - and found the claim wrong, exactly as
Matt said: it only held under an assumed EVEN SLOPE from slot 0 to slot 7 (`TEAM_LADDER_OFFSETS`'s
old flat, linear array), never a requirement of the doc or the schedule itself. `TEAM_LADDER_
OFFSETS` is now GENERATED per league from a named `LADDER_SHAPE` (`cliff`/`spread`/`steep`) and a
shared pair of endpoint magnitudes per axis, so a band change re-derives the ladder instead of
needing a hand-tuned array.

### Commit 1: proving the shape before building it (`node sim-baseball.mjs --ladder`)

Pure arithmetic over win rates (no games played), fixing the champion at its own band's midpoint
(0.475) and sweeping slot0 (the weakest opponent) over its own doc floor [0.85, 1.0], for each of
three named shapes, against the shipped `SCHEDULE_SHAPE` (`repeatMiddle`, champion plays 1 of 12
games):

| League | Season band | `cliff` achievable | `spread` achievable | `steep` achievable | Verdict |
|---|---|---|---|---|---|
| little | [0.92, 0.98] | [0.797, **0.926**] | [0.663, 0.738] | [0.744, 0.852] | `cliff` PASSES (slot0 in [0.993, 1.0]) |
| highschool | [0.70, 0.80] | [0.797, 0.926] | [0.663, 0.738] | [0.744, 0.852] | all three PASS |
| college | [0.57, 0.67] | [0.797, 0.926] | [0.663, **0.670**] | [0.744, 0.852] | `spread` PASSES (slot0 in [0.85, 0.865]) |
| minors | [0.49, 0.59] | [0.797, 0.926] | [0.663, 0.738] | [0.744, 0.852] | **no shape admits** |
| majors | [0.41, 0.51] | [0.797, 0.926] | [0.663, 0.738] | [0.744, 0.852] | **no shape admits** |

Little League and High School's champion-slot band **is** compatible with their own season band -
Matt's rejection of BB-2d's claim is confirmed algebraically, the same standard of proof BB-2d's
own (wrong) claim used. **New finding this commit surfaces**: Minors and Majors cannot be satisfied
by ANY of the three named shapes under ANY of the three schedule shapes (all nine combinations
checked explicitly - see the commit's own pasted output). Not a shape problem: `SLOT_WINRATE_
WEAKEST_MIN` (0.85) and the champion band ([0.40, 0.55]) are GLOBAL constants, identical at every
league, but `SEASON_WINRATE_BAND` drops much lower for the upper leagues (majors [0.41, 0.51]).
Since the schedule plays the champion only 1-2 of 12 games, even the theoretical floor of the
season average (slot0 at its own legal minimum 0.85, champion at its own legal minimum 0.40) cannot
go below roughly 0.81 under any schedule weighting - far above Majors' own upper band edge (0.51).
This is the exact algebraic-proof standard BB-2d used for Little League, applied here to a
DIFFERENT pair of bands (season vs. the weakest-slot floor, not vs. the champion band) and a
DIFFERENT pair of leagues - and it explains WHY BB-2d's own already-reported `SLOT_WINRATE_BAND`
weakest-slot failure at college/minors/majors cannot be retuned away by any ladder shape this
phase's contract allows.

### Commit 2: `LADDER_SHAPE` and the generator

`TEAM_LADDER_OFFSETS` is `TEAM_LADDER_OFFSETS[league][slot]` now, generated by `ladderOffsetsFor`
from `LADDER_SHAPE[league]` (Matt's own assignment: `cliff` for Little League/High School - "one
stacked team and seven that fall over"; `spread` for College/Minor League - "a field of real
teams"; `steep` for Major League) and a shared pair of slot0/slot7 endpoint magnitudes per axis,
UNCHANGED from the old flat table's own slot0/slot7 rows. `ladderGapWeights(shape)` (exported, and
imported by `sim-baseball.mjs --ladder` rather than duplicated) names each shape's own 7 gap
weights - `cliff`: the first 6 gaps small and equal (`CLIFF_TOP_GAP_FRAC`=0.02 each), the whole
rest of the range in the last gap alone; `spread`: all 7 gaps equal; `steep`: the first 5 gaps
shallow (`STEEP_SHALLOW_GAP_FRAC`=0.06 each), the last 2 steep.

Every consumer updated to index per-league: `teams.js`'s `makeLeague`, and `baseball/js/test.js`
sections 8b/16/17/18/19/21/22 (each per-slot/per-axis assertion now runs per league). One test
assumption broke and was fixed, not silently patched: "slot 4 carries no timing offset" was true
only by accident of the OLD table's linear symmetry - under `cliff`/`steep` the cumulative gap
fraction at slot 4 is not 0.5, so slot 4 no longer lands on a literal zero. The doc names no
requirement that slot 4 be a zero-offset "league median" - the assertion now checks what it
actually cares about (the measured sigma still clears `CPU_SIGMA_ABSOLUTE_FLOOR_MS`), not the
offset's own value.

### Commit 3: the retune, and a genuine structural ceiling found by exhaustion

New: `CHAMPION_SIGMA_HEADROOM_FRAC` (0.9) - `timingSigmaMs`'s own slot7 (champion) endpoint is now
PER-LEAGUE (`championSigmaOffset`), using 90% of each league's own headroom to `CPU_SIGMA_
ABSOLUTE_FLOOR_MS` instead of one flat `-4` shared by every league (a number calibrated to Majors'
own near-zero headroom, which left Little League's own 57ms of headroom almost entirely unused -
measured before this fix: 111ms effective champion sigma at Little League, nowhere near its own
58ms floor). Little League's champion sigma now sits exactly at the floor (58ms); College/Minors/
Majors are essentially unchanged (their own headroom was already narrow).

**Measured effect: none.** `SLOT_WINRATE_BAND`'s champion values are BYTE-IDENTICAL to before this
change - `[0.913, 0.712, 0.531, 0.54, 0.449]`, the same numbers BB-2d's own final report recorded.
Two further probes were tried and DISCARDED, not shipped: raising the shared `behaviorMul` slot7
endpoint from 1.60 to 4.00 (the largest value that does not exceed Little League's own `CHAMPION_
CEILING` - `0.05 * 4.00 = 0.20`, exactly High School's base row, the ceiling itself) moved Little
League's champion win rate by nothing measurable; the champion's own `chase` offset (already
`-2.624` once `STYLE_STRENGTH_DELTA.aces`'s converted penalty stacks on top) is already clamped to
effectively zero chase in `agents.js`, with no further headroom on that axis either.

**Little League and High School's champion band is a genuine, measured, structural ceiling under
this phase's contract, not a levers-not-tried gap.** THREE separate champion-toughening axes
(timing sigma, chase, cornerBias-via-`behaviorMul`) were independently pushed to their contractual
maximum at Little League and the champion's own win rate did not move outside the low-0.90s range.
The likely cause: Little League/High School's own `CPU_LEVEL_SHORTFALL` is 0 (doc-Locked), so
`effectiveCapFor` already equals the raw `CAPS` value with zero room - the champion's own `+0.25`
skill offset clamps to the SAME raw cap the weakest slot's ceiling sits at, so the champion carries
literally the same skill points as every other team at these two leagues. The entire ladder there
is behavior-only by construction, and this phase's own measurement shows that axis is already
exhausted. Not this phase's to fix (`CPU_SIGMA_ABSOLUTE_FLOOR_MS`/`CPU_PLACEMENT_MIN`/
`CHAMPION_CEILING` are all held fixed by the handoff's own contract).

### The full scoreboard (`node sim-baseball.mjs --assert`, full sample, 22.7s)

```
[PASS] SEASON_WINRATE_BAND, all 5 leagues simultaneously (little 0.938, highschool 0.745,
       college 0.586, minors 0.566, majors 0.485) - preserved through the shape restructuring,
       same simultaneous-pass achievement BB-2d first reached.
[PASS] SEASONS_TO_GOLD_TARGET.little (1.18) / .highschool (1.84)
[FAIL] SEASONS_TO_GOLD_TARGET.college (4.29 vs <=2.75) / .minors (5.00 vs <=3.75) /
       .majors (8.57 vs <=5.25) - the same compound-probability bottleneck BB-2b's own report
       first diagnosed, unresolved by this phase's contract, reported not forced.
[PASS] CHAMPION_GAME_WIN_MIN_MEDIAN (0.455), PERFECT_SEASON_REACHABLE (0.59 >= 0.02),
       LADDER_MONOTONE (across-league), NUDGE_A_B (every league), CONTACT_GRID (all 5,
       byte-identical to before this phase).
[FAIL] SLOT_WINRATE_BAND weakest: [0.95, 0.81, 0.656, 0.655, 0.594] vs >= 0.85 - little PASSES;
       highschool misses narrowly (0.81); college/minors/majors fail structurally, exactly as
       commit 1's own arithmetic proved impossible under the global 0.85 floor combined with
       these leagues' own much-lower SEASON_WINRATE_BAND.
[FAIL] SLOT_WINRATE_BAND champion: [0.913, 0.712, 0.531, 0.54, 0.449] vs [0.40, 0.55] -
       college/minors/majors ALREADY PASS; little/highschool fail, per the structural ceiling
       found above.
[FAIL] CHAMPION_IS_HARDEST / within-league LADDER_MONOTONE: college's own slot 6 (sluggers,
       51.4%) is tougher than its champion slot 7 (aces, 53.1%) - the same style-ordering
       anomaly this project has carried since BB-2c (previously traced to Shifters at slot 4;
       here it is Sluggers at slot 6), not re-chased this phase - STYLE_STRENGTH_DELTA is stale
       as of BB-2d's own retune, and re-measuring it is a separate job (BB-2d's own words).
[FAIL] CAP_BINDS_ONLY (highschool): 2.1 seasons vs <=2.0 - a 0.1-season miss present in every
       phase's own report back to BB-2b; POINTS is out of this phase's scope, untouched.
```

### Measured per-league slot profiles beside their bands (full sample, weakest..strongest)

```
little      95.0  93.7  94.2  95.0  92.5  94.3  92.4  91.3   season 93.8%  slot0-floor 0.85  champion-band [0.40,0.55]
highschool  81.0  75.3  75.5  77.9  74.9  76.8  72.7  71.2   season 74.5%
college     65.6  64.6  59.4  60.5  56.5  58.6  51.4  53.1   season 58.6%
minors      65.5  60.0  57.1  57.7  57.1  55.9  43.6  54.0   season 56.6%
majors      59.4  56.1  52.6  50.7  50.2  51.0  36.3  44.9   season 48.5%
```

### Constants touched this phase, by source

| Constant | Old | New |
|---|---|---|
| `TEAM_LADDER_OFFSETS` shape | one flat array, shared by every league | `TEAM_LADDER_OFFSETS[league][slot]`, generated per league |
| `LADDER_SHAPE` (new) | - | `{little:'cliff', highschool:'cliff', college:'spread', minors:'spread', majors:'steep'}` |
| `CLIFF_TOP_GAP_FRAC` / `STEEP_SHALLOW_GAP_FRAC` (new) | - | `0.02` / `0.06` |
| `ladderGapWeights` (new, exported) | - | pure function, shared with `sim-baseball.mjs --ladder` |
| `TEAM_LADDER_OFFSETS[*].timingSigmaMs` slot7 endpoint | `-4` flat, every league | `championSigmaOffset(league)`, per-league (little: `-51.3`; highschool: `-33.3`; college/minors/majors: essentially unchanged, narrow headroom already) |
| `CHAMPION_SIGMA_HEADROOM_FRAC` (new) | - | `0.9` |
| every other `TEAM_LADDER_OFFSETS` axis endpoint (skill/chase/behaviorMul/changeupShare) | shared flat values | UNCHANGED numerically, now generated identically at every league (shape only respaces slots 1-6) |
| `sw.js` `CACHE` | `game-hub-v826` | `game-hub-v827` (past `origin/main`'s `v824` at time of this phase) |

Not touched: `POINTS`, `CAPS`, `SEASON`, trophies, the contact grid's own assertions,
`CPU_SIGMA_ABSOLUTE_FLOOR_MS`, `CPU_PLACEMENT_MIN`, `LEAGUE_LADDER_STYLES`, `js/`, `baseball/js/
ui.js`/`css/`/`strings.js`/`index.html`, any other game folder, the frozen `bb` stats shape, BB-2d's
carry calibration and the maxed tier.

### The Locked-statement inventory, phase-implemented, with the test that proves each

| Locked statement (design doc v10) | Test |
|---|---|
| §8 "the championship opponent is always the toughest team" - Matt's shape assignment (cliff/spread/steep per league) | `baseball/js/test.js` §24 |
| Every ladder slot's offset is generated, not hand-typed, and slot0/slot7 land exactly on the shared reference endpoints | `baseball/js/test.js` §24 |
| `cliff`'s own "slots 0-6 sit close together" promise, with a stated numeric tolerance | `baseball/js/test.js` §24 (`CLIFF_CLUSTER_TOLERANCE`) |
| `TEAM_LADDER_OFFSETS.skill` strictly rises, `.timingSigmaMs`/`.chase` strictly fall, weakest to strongest, at EVERY league (not one shared table) | `baseball/js/test.js` §8b |
| §8 per-league `SEASON_WINRATE_BAND` (all five leagues) | `sim-baseball.mjs --assert` - passing, all five, preserved through this phase's restructuring |
| The champion's own headroom to `CPU_SIGMA_ABSOLUTE_FLOOR_MS` is used per-league, not shared with Majors' narrow one | `baseball/js/test.js` §24 (`championSigmaOffset` restated from its own named inputs) |

### Self-review, answered line by line

- `TEAM_LADDER_OFFSETS` is per-league everywhere it is read: **yes** - `teams.js`'s `makeLeague`,
  every `baseball/js/test.js` site, and `sim-baseball.mjs`'s `--range` lever table all index
  `[league][slot]`; grepped for any remaining bare `TEAM_LADDER_OFFSETS[<number>]` and found none.
- The shape a league is ASSIGNED and the shape commit 1 PROVED compatible cannot drift apart:
  **yes** - `ladderGapWeights`/`CLIFF_TOP_GAP_FRAC`/`STEEP_SHALLOW_GAP_FRAC` live in settings.js
  once, exported, and `sim-baseball.mjs --ladder` imports them rather than carrying its own copy.
- No lever outside "the levers BB-2d used" was touched: **yes** - only `TEAM_LADDER_OFFSETS`'s own
  axes (the same table BB-2b/c/d each retuned); `POINTS`/`CAPS`/`SEASON`/`CPU_SIGMA_ABSOLUTE_
  FLOOR_MS`/`CPU_PLACEMENT_MIN`/`LEAGUE_LADDER_STYLES` all untouched.
- Every generated sequence is non-increasing/non-decreasing per its own axis, at every league:
  **yes** - `baseball/js/test.js` §8b, extended to loop every league.
- `RULES_V` bumped if any snapshot shape changed: **not bumped** - no persisted snapshot shape
  changed this phase (settings values and a generator function only).
- The contact grid unchanged: **yes**, byte-identical - `node sim-baseball.mjs --contact-grid`
  passes all 5, same measured values as before this phase (SKILL_EFFECT/swing.js untouched).
- Seasons-to-Gold measured and reported, not tuned to: **yes** - see the scoreboard above; three
  leagues still miss their target, reported honestly rather than chased with an unlisted lever.

### Verification (Phase 2e, in order)

```
node validate-sw-assets.mjs           # ok, REST_MANIFEST/version.json regenerated for game-hub-v827
node baseball/js/test.js              # 2533 passed, 0 failed (was 2397 at the start of this phase)
node sim-baseball.mjs --ladder        # see commit 1's own table above
node sim-baseball.mjs --contact-grid  # PASS on all 5, byte-identical to before this phase
node sim-baseball.mjs --assert --quick   # FAILS - sampling noise moves majors across its own SEASON_WINRATE_BAND edge at this sample size (0.522 vs [0.41,0.51]), same as BB-2d's own noted caveat; the other 4 leagues' bands pass
node sim-baseball.mjs --assert           # see the full scoreboard above
node test-game-conventions.mjs           # 11 passed, 0 failed, no new known-gap entries
node validate-sw-assets.mjs              # re-run, unchanged
node test-sw-strategy.mjs                # 107 passed, 0 failed
```

**`sim-baseball.mjs --assert` still fails, on real, reported findings - the same discipline every
phase of this effort has followed.** This phase's real, banked progress: BB-2d's own "mathematically
incompatible" claim for Little League/High School is DISPROVEN with the same rigor it was raised
(commit 1's arithmetic proof, both directions); `TEAM_LADDER_OFFSETS` is now a generated,
re-derivable table instead of a hand-tuned array, so a future band change does not need re-typing
eight rows by hand; and Little League/High School's remaining champion-band failure is now a
MEASURED structural ceiling (three axes independently exhausted) rather than an open question -
specific enough for a future session to know exactly what would have to change (`CPU_LEVEL_
SHORTFALL.little`/`.highschool`, currently 0 and doc-Locked) rather than re-deriving the diagnosis.

## Status: Phase 2d — the curve, the champion, and Shifters: mechanisms, not constants

BB-2d (2026-09-13) is the design doc's own v10 revision landing in code: home runs (and doubles and
triples) made possible in every league for the first time this whole effort, the champion given its
own pitching-behavior axis instead of sharing its league's flat row, Shifters bounded and priced on
the same axis the ladder itself uses, and one retune pass that clears every one of doc v10's own
per-league `SEASON_WINRATE_BAND` targets simultaneously — the first time in this effort's history.

### The diagnosis (commit 1's `--range`), and what didn't survive measurement

The handoff's own arithmetic diagnosis — swing.js's ~75mph exit-velocity ceiling times the old
`CARRY_SCALE` (6.2) tops out near 279ft, clearing Little League's 210ft fence — did **not** survive
measurement against real games: the census (`node sim-baseball.mjs --range`, RANGE_GAMES_N=1000)
found p95 carry at only 150-166ft in EVERY league, nowhere near even Little League's own fence.
Home runs were impossible everywhere, not only from College up. Little League's own ceiling (every
lever pushed to its easiest legal extreme) measured 99.6% — comfortably above the 0.92 floor the
handoff worried it might miss, so the "stop tuning, report the ceiling" escape clause never
triggered.

The human model's own defect was real and measured as diagnosed: copying the league's own CPU row
onto `mkModelAgent` taxed a human hardest exactly where the win-rate band wants near-total dominance
(Little League: `chase` 0.55) and least where it wants a real grind (Majors: `chase` 0.05). Fixed by
giving `MODEL_TIERS` its own `swingIn`/`chase` per tier (commit 2), independent of any league.

Shifters' shift was confirmed a large, real drag (commit 1: median tier, -13.6pp at Little League to
-28.0pp at Majors, `shiftersRate - balancedRate`) — bounded (`SHIFT_MAX_DEG` 15→3, half of `GAP_DEG`;
`SHIFT_MIN_SAMPLES` new, 5) in commit 6, which alone moved Shifters from the largest `--styles`
outlier to no longer the largest (four other styles now cost the player more).

### Batted-ball carry, recalibrated (commit 4)

`LEAGUE_POWER_SCALE` (new, per league) had to be applied RELATIVE to `CARRY_ZERO_MPH` (carryFt's own
"no carry below this speed" baseline), not as a straight multiply on the raw exit-velocity mph — a
straight multiply pushed Little League's whole axis, baseline included, below the point where ANY
ball carries at all (every census carry rounded to 0ft), while Majors' multiply compounded onto the
new, much larger `CARRY_SCALE` into carries past 700ft. `BASE_EXIT_VELO`/`CARRY_SCALE` recalibrated
together (62/6.2 → 31.39/183.29) so a q=1 swing at College carries `HR_CARRY_FRAC` (1.05) of the
fence at cap `hitPow` and `MEDIAN_CARRY_FRAC` (0.80) at half of cap — `SKILL_EFFECT.hitPow.
exitVeloMphPerPt` also retuned (0.35→0.07) alongside it, the smallest reduction (of a five-point
sweep measured against the real `--contact-grid` tool each time) that kept both of doc §8's own
TIMING_OVER_POWER/ceiling checks passing against the new, much-lower base. `MIN_EXIT_VELO_MPH` (new,
named) replaces a bare `35` that sat ABOVE where the new base's own quality-scaled floor naturally
lands — the exact regression a max-Power, worst-timed swing exposed (measured landing exactly on the
old floor, erasing the whole timing-quality gradient). `LEAGUE_POWER_SCALE.little` needed a much
larger push than its `fieldScale` starting guess (0.60→1.8) to clear `LL_HR_PER_GAME_BAND` — the
fly-ball population that can even become a home run is a small, fixed slice of centered contact
regardless of exit velocity, so a closer fence does far less than the same multiplier does at a
league with a farther one.

Measured after (median tier, player side, per game): little 0.329 HR (band [0.3, 1.0]), highschool
0.139, college 0.130, minors 0.127, majors 0.154 — all five leagues can now produce a home run, a
double, and a triple (test.js section 20's own existence probes, maxed power/timing, every league).

### The champion's own axis (commit 5)

Before this commit every pitching-behavior field (`cornerBias`, `pitchMix`, `patternWeight`,
`weakSpotWeight`) was per-LEAGUE only — a league's champion pitched with the exact same values as
its weakest team, and `CPU_SIGMA_MIN_MS` bound every slot to the same flat floor. `TEAM_LADDER_
OFFSETS[slot]` gains `behaviorMul` (0.50 at slot 0 to 1.60 at slot 7, multiplies cornerBias/
patternWeight/weakSpotWeight) and `changeupShare` (0 to 2.00, leans the pitch mix toward changeup),
both bounded by `CHAMPION_CEILING` (`'nextLeagueRow'`) so a league's champion can never out-pitch the
NEXT league's own base row — "easier season, harder champion" never turns a Little League champion
into a de facto Majors pitcher. `SLOT_SIGMA_DESCENT` lets slots 5-7 descend their own base sigma
floor linearly toward `CPU_SIGMA_ABSOLUTE_FLOOR_MS` (58) instead of sharing every other slot's flat
league floor — resolved per (league, slot) in `teams.js`'s `makeLeague` and attached as `team.
ladderOffset.sigmaFloorMs`. `CpuPitcher` gained a `ladderOffset` constructor param for the first
time this whole effort (it had none at all before this commit).

### Shifters, bounded and priced on the ladder's own axis (commit 6)

`STYLE_STRENGTH_DELTA` no longer touches the skill cap at all — converted through two measured
slopes (`SIGMA_MS_PER_WINRATE_PP` 4.2, `CHASE_PER_WINRATE_PP` 0.2, both from commit 1's own per-lever
range table) into additive `timingSigmaMs`/`chase` offsets stacked on the slot's own `TEAM_LADDER_
OFFSETS`, the same axis the ladder itself already moves. `zones.js`'s `shiftSectors` (replaces the
old per-sector `shiftSector`) shifts the WHOLE sector list together and snaps only the two outermost
edges to the foul lines, instead of clamping each sector independently — the old clamp could leave an
uncovered sliver on the trailing edge; the new rule keeps the total covered arc identical at every
shift angle (test.js section 22's own invariant check, every league, both infield/outfield, five
shift angles each).

### The retune (commit 7): the lever nobody had touched

The dominant, previously-untouched lever turned out to be `CPU[lg].swingIn` — free of the doc's own
cornerBias/patternWeight/chase monotonicity requirement (so it can move independently per league),
and measured (single-factor sweeps against the real season, not assumed) to move `SEASON_WINRATE_
BAND` far more than cornerBias/patternWeight/weakSpotWeight, which sometimes moved the WRONG
direction: raising cornerBias/patternWeight/guess past a point made Majors EASIER, not harder — an
aggressive corner-working pitcher against a disciplined model batter just walks more players, and a
CpuBatter over-committing to a location lean against a real ModelPitcher's own randomized variety
gets fooled worse, not better. Both real, measured findings this phase would have missed by tuning
on intuition alone.

Four values changed, nothing else in the CPU table touched: `CPU.little.swingIn` 0.90→0.30,
`CPU.highschool.swingIn` 0.85→0.50, `CPU.majors.swingIn` 0.65→1.00, `CPU.majors.guess` 0.60→0.20.

**All five of doc v10's own `SEASON_WINRATE_BAND` targets pass simultaneously for the first time
this whole effort** (`node sim-baseball.mjs --assert`, full sample, 43.8s wall clock):

```
League      Measured   Target          Verdict
little      0.934      [0.92, 0.98]    PASS
highschool  0.737      [0.70, 0.80]    PASS
college     0.589      [0.57, 0.67]    PASS
minors      0.569      [0.49, 0.59]    PASS
majors      0.481      [0.41, 0.51]    PASS
```

`CHAMPION_GAME_WIN_MIN_MEDIAN` (0.431 >= 0.40) and `PERFECT_SEASON_REACHABLE` (maxed tier, Majors,
0.6033 >= 0.02) both pass too.

**Still failing, reported honestly rather than forced:**

```
Check                                    Measured                       Target
SEASONS_TO_GOLD_TARGET.college           4.35 seasons                   <= 2.75
SEASONS_TO_GOLD_TARGET.minors            5.26 seasons                   <= 3.75
SEASONS_TO_GOLD_TARGET.majors            9.68 seasons                   <= 5.25
SLOT_WINRATE_BAND (weakest, all leagues) [0.95,0.81,0.656,0.655,0.594]   >= 0.85 everywhere
SLOT_WINRATE_BAND (champion, all leagues)[0.913,0.712,0.531,0.54,0.449]  [0.40,0.55] everywhere
CHAMPION_IS_HARDEST                       FAIL                          see within-league table
LADDER_MONOTONE (within-league)           FAIL                          see within-league table
CAP_BINDS_ONLY (highschool)               2.1 seasons                   <= 2.0
```

`SEASONS_TO_GOLD_TARGET` is a stated CONSEQUENCE of the win-rate band, not independently tunable
without moving the band itself (doc v10's own words: "measured by the simulator rather than set").
All three measured values are FINITE — Gold is reachable everywhere, just slower than the target
average implies — so "no league is unwinnable" (doc §8, [Locked]) still holds; this is the same
compound-probability bottleneck BB-2b's own report first diagnosed (a semifinal AND a championship
against the single strongest team, in the same season, on top of an already-tight regular season).

**Little League and High School's champion-slot band is mathematically incompatible with their own
season band, under the current schedule weighting — proven algebraically, not just observed:**
`SCHEDULE_SHAPE='repeatMiddle'` plays 12 games weighted `{slot0:1, 1:1, 2:2, 3:2, 4:2, 5:2, 6:1,
7:1}` (the champion, slot 7, exactly once). Season win rate is the weighted mean of all eight slots'
own win rates. Pinning the champion at its OWN band's most favorable edge (0.55) and solving for
what the other seven slots would need to average, at even Little League's band's LOW edge (0.92):
`(10*X + 0.55) / 12 = 0.92` implies `X = 1.049` — a required average win rate above 100%, impossible
by construction. This is BB-2c's own previously-flagged "Little League's specific tension" (season
needs easier, champion needs harder, every lever tried moved both the same direction) now proven
rather than merely observed — not fixable by any per-slot lever this phase's contract allows,
because it is a fact about the WEIGHTING, not the difficulty. Reopening `SCHEDULE_SHAPE` for these
two leagues specifically, or loosening one of the two bands for them specifically, are the two
options on the table — both Matt's call, not a retune lever.

`SLOT_WINRATE_BAND`'s "weakest opponent >= 0.85" also fails at College/Minors/Majors — `TEAM_
LADDER_OFFSETS[0]`'s own offset (one row shared by every league) is proportionally a much smaller
edge at these leagues' own tougher base CPU rows than at Little/High School's easier ones, the same
"one shared table, different relative effect per league" pattern this whole phase kept finding.

### `STYLE_STRENGTH_DELTA` is stale as of the retune (not re-measured this phase)

`node sim-baseball.mjs --styles` (vs median human, post-retune CPU rows) now measures deltas of
-0.11 to -0.20 across every style — a real shift from commit 6's own post-shift-bound values
(-0.06 to -0.15), since the measurement is against the CURRENT settings and `CPU[lg].swingIn`
changed underneath it in commit 7. Not re-applied to `STYLE_STRENGTH_DELTA` this phase — the retune
lever list (commit 7's own handoff) does not include it, and re-measuring it is a small, separate
job for whichever session next touches `TEAM_LADDER_OFFSETS`/`STYLE_STRENGTH_DELTA` together.

### Constants touched this phase, by source

| Constant | Old | New |
|---|---|---|
| `BASE_EXIT_VELO` (moved from swing.js's own local const) | `62` | `31.39` |
| `CARRY_SCALE` | `6.2` | `183.29` |
| `SKILL_EFFECT.hitPow.exitVeloMphPerPt` | `0.35` | `0.07` |
| `HR_CARRY_FRAC` / `MEDIAN_CARRY_FRAC` / `MEDIAN_HIT_POW_FRAC` (new) | - | `1.05` / `0.80` / `0.5` |
| `LEAGUE_POWER_SCALE` (new) | - | `{little:1.8, highschool:0.85, college:1.00, minors:1.05, majors:1.10}` |
| `MIN_EXIT_VELO_MPH` (new, was a bare `35` in swing.js) | - | `BASE_EXIT_VELO * (35/62)` |
| `CARRY_ZERO_MPH` (new, was a bare `30` in outcomes.js) | - | `30` |
| `DOUBLE_DEPTH_FRAC` / `TRIPLE_DEPTH_FRAC` (new, replace flat 250ft/320ft) | - | `0.625` / `0.80` |
| `TEAM_LADDER_OFFSETS[*].behaviorMul` (new) | - | `0.50` to `1.60`, linear by slot |
| `TEAM_LADDER_OFFSETS[*].changeupShare` (new) | - | `0` to `2.00`, linear by slot |
| `CHAMPION_CEILING` (new) | - | `'nextLeagueRow'` |
| `SLOT_SIGMA_DESCENT` (new) | - | `{bindThroughSlot: 4, descentToSlot: 7}` |
| `SHIFT_MAX_DEG` | `15` | `3` (= `GAP_DEG / 2`) |
| `SHIFT_MIN_SAMPLES` (new) | - | `5` |
| `SIGMA_MS_PER_WINRATE_PP` / `CHASE_PER_WINRATE_PP` (new) | - | `4.2` / `0.2` |
| `STYLE_STRENGTH_DELTA` | `{sluggers:0.0010, smallBall:-0.0333, patient:0.0160, flamethrowers:-0.0070, junkballers:-0.0150, shifters:0.0813, aces:0.0043}` | `{sluggers:-0.0646, smallBall:-0.1530, patient:-0.1080, flamethrowers:-0.1176, junkballers:-0.1320, shifters:-0.1022, aces:-0.1252}` (measured post-shift-bound, pre-retune - see above, now stale) |
| `CPU.little.swingIn` | `0.90` | `0.30` |
| `CPU.highschool.swingIn` | `0.85` | `0.50` |
| `CPU.majors.swingIn` | `0.65` | `1.00` |
| `CPU.majors.guess` | `0.60` | `0.20` |
| `sw.js` `CACHE` | `game-hub-v825` | `game-hub-v826` (past `origin/main`'s `v824` at time of this phase) |

Not touched: `POINTS`, `CAPS`, `SEASON`, trophy rules, the contact grid's own assertions,
`CPU_SIGMA_ABSOLUTE_FLOOR_MS`, `CPU_PLACEMENT_MIN`, `LEAGUE_LADDER_STYLES`, `js/`, `baseball/js/
ui.js`/`css/`/`strings.js`/`index.html`, any other game folder, the frozen `bb` stats shape.

### The Locked-statement inventory, phase-implemented, with the test that proves each

| Locked statement (design doc v10) | Test |
|---|---|
| §10 "Home runs over the wall" (every league, not only College up) | `baseball/js/test.js` §20 (existence probe, maxed power/timing) |
| §10 "Doubles in the gaps and down the lines" (every league) | `baseball/js/test.js` §20 |
| §10 "Triples in deep corners and deep center" (every league) | `baseball/js/test.js` §20 |
| §8 "CPU batters may never time or place better than a median human" (still holds; untouched this phase) | `baseball/js/test.js` §17/§19 (unchanged) |
| §8 "the championship opponent is always the toughest team" — a slot's pitching never exceeds the next league's own row | `baseball/js/test.js` §21 (`CHAMPION_CEILING`) |
| §9 "some teams shift their out zones toward where you tend to hit" — bounded, no uncovered sliver | `baseball/js/test.js` §22 (covered-arc invariant) |
| §5 "Perfect Season is meant to be achievable for a player who has already won the World Series and maxed every skill" | `sim-baseball.mjs --assert`'s `PERFECT_SEASON_REACHABLE` + `baseball/js/test.js` §23 |
| §8 per-league `SEASON_WINRATE_BAND` (all five leagues) | `sim-baseball.mjs --assert` — **passing, all five, for the first time this effort** |
| §8 "no league is unwinnable" | `sim-baseball.mjs --assert`'s `SEASONS_TO_GOLD_TARGET` all measuring FINITE (see above — the target tolerance itself still fails at three leagues) |

### Self-review, answered line by line

- No exit velocity or carry constant left absolute where the doc scales the field: **yes** —
  `LEAGUE_POWER_SCALE` is applied to every league's exit-velocity term via `scaleAboveZero`.
- The human model reads no league row: **yes** — `mkModelAgent` reads `tier.swingIn`/`tier.chase`
  only; `CPU[league].swingIn`/`.chase` are never read by it after commit 2.
- `STYLE_STRENGTH_DELTA` never touches a skill cap: **yes** — `teams.js`'s `slotCap` depends only
  on `TEAM_LADDER_OFFSETS[slot].skill`; verified by `baseball/js/test.js` §22.
- No uncovered sliver under any shift: **yes** — the covered-arc invariant holds at every league,
  every tested shift angle, both infield and outfield (`baseball/js/test.js` §22).
- The champion's effective sigma at or above 58 everywhere: **yes** — `baseball/js/test.js` §21
  sweeps every league x every slot.
- Every `TEAM_LADDER_OFFSETS` behavior value at or below the next league's row: **yes** —
  `CHAMPION_CEILING` enforced in `agents.js`, verified by `baseball/js/test.js` §21.
- `RULES_V` bumped if any snapshot shape changed: **not bumped** — no persisted snapshot shape
  changed this phase (settings values and scoreboard-only additions).
- The contact grid unchanged: **its ASSERTIONS are unchanged and still pass** — the measured
  VALUES changed (BASE_EXIT_VELO/CARRY_SCALE/exitVeloMphPerPt all moved, per commit 4), which the
  handoff's own "must not touch: the contact grid's assertions" always meant the test LOGIC, not a
  frozen number.
- The scoreboard bands equal the doc's table: **yes** — `SEASON_WINRATE_BAND`/`SEASONS_TO_GOLD_
  TARGET` in `sim-baseball.mjs` transcribe doc v10 §8's own table exactly, unchanged this phase.

### Little League's ceiling, in one sentence

Little League's own ceiling (every lever at its easiest legal extreme) measures 99.6% — well above
the 0.92 floor that would have triggered "stop tuning, report the ceiling" — so its remaining
`SEASON_WINRATE_BAND` pass (0.934, comfortably inside [0.92, 0.98]) reflects real headroom, not a
hard limit; the champion-band conflict documented above is a separate, structural fact about the
SCHEDULE's weighting, not about how easy the league itself can be made.

### Verification (Phase 2d, in order)

```
node validate-sw-assets.mjs           # ok, REST_MANIFEST/version.json regenerated for game-hub-v826
node baseball/js/test.js              # 2397 assertions, 0 failed (was 2133 at the start of this phase)
node sim-baseball.mjs --range --quick    # measurement only, see the per-commit reports above
node sim-baseball.mjs --contact-grid     # PASS on all 5 assertions
node sim-baseball.mjs --styles --quick   # measurement only, STYLE_STRENGTH_DELTA stale post-retune (see above)
node sim-baseball.mjs --assert --quick   # FAILS - sampling noise moves majors across its own band edge at this sample size
node sim-baseball.mjs --assert           # FAILS - see the promise scoreboard above; five SEASON_WINRATE_BAND lines PASS
node test-game-conventions.mjs           # 11 passed, 0 failed, no new known-gap entries
node validate-sw-assets.mjs              # re-run, unchanged
node test-sw-strategy.mjs                # 107 passed, 0 failed
```

**`sim-baseball.mjs --assert` still fails, on real, reported findings — the same discipline every
phase of this effort has followed.** But five checks that failed at the start of this phase now
pass, including every one of doc v10's own per-league `SEASON_WINRATE_BAND` targets simultaneously,
for the first time. The remaining fails are two structural facts (the Little/High School schedule-
weighting conflict, proven algebraically; the compound-probability Gold bottleneck, previously
diagnosed and still present) plus one shared-table cross-league tension (`TEAM_LADDER_OFFSETS[0]`'s
proportional effect), none of which a further retune pass within this phase's contract can resolve —
each is named plainly above for whoever picks this up next.

## Status: Phase 2c — the regular season was the bottleneck, and what CPU strength is allowed to be

BB-2c (2026-09-13) named the two CPU stat advantages behind the regular-season win-rate gap BB-2b's
own decomposition traced everything to, made "CPU batters may never time or place better than a
median human" (design doc v9, §8, [Locked]) a structural contract with its own tests, gave a
flavor style's own behavioral edge a measured strength budget so it never has to be paid for by
hand-picking its ladder slot, reopened and measured the schedule shape, and retuned once inside the
contract. This section is the schedule-shape proposal block, written the moment commit 4 measured
it; the full commit-6 report (attribution table, final scoreboard, constants-by-source table, and
the Locked-statement inventory) is below, at "Commit 6: the full report."

### The two CPU stat levers (commit 1's diagnosis)

BB-2b's own `--stages` decomposition already named the regular-season win rate as the dominant
bottleneck (majors ~10% at median). This handoff traced WHY: the CPU timing ladder
(`CPU.timingSigmaMs` 90/75/55/45/35 by league) put College at exact parity with a median human (55)
and Minors/Majors SHARPER than one - a stat advantage, not the doc's own "difficulty from behavior"
promise. A second, hidden advantage rode along in `guess`: `CpuBatter`'s placement noise
(`readNoise = (1 - guess) * 0.3`) fell to 0.21/0.165/0.12 from College up, all below a median
human's own 0.22 - `guess` was framed as a pattern-reading knob but coded as a swing-skill one.
`sim-baseball.mjs --attribute`'s one-factor counterfactuals confirmed a single GLOBAL sigma floor
is the wrong shape (it hurts Little/High School/College, which already sat above a human, and only
barely helps Majors) - the fix needed a PER-LEAGUE minimum, which commit 2 built.

### The schedule shape, measured and set (commit 4)

`node sim-baseball.mjs --stages`, median tier, SEASONS_N=300, one-season Gold rate under each
shape (bracket=asCoded, playoffHome=player, standings=rawWins7 throughout - isolating the schedule
shape alone):

| League | repeatTop (shipped) | repeatBottom | repeatMiddle |
|---|---|---|---|
| little | 70.3% | 64.3% | 68.0% |
| highschool | 50.7% | 52.3% | 49.0% |
| college | 34.7% | 43.0% | **45.7%** |
| minors | 30.3% | 33.3% | 29.7% |
| majors | 18.7% | 23.3% | 22.0% |

No shape dominates at every league - `repeatBottom` edges ahead at High School/Minors/Majors by a
few points, `repeatMiddle` is clearly best at College, `repeatTop` (still) wins at Little League
(already saturated near 100% top-4 regardless of shape). **`repeatMiddle` is set as the Draft
default**, per the handoff's own stated prior: it stays progressively harder without any early
plateau, halves the games against the top half of the ladder, and is the only shape that leaves
both of the two strongest teams faced once each before the playoffs - `repeatBottom`'s edge at the
other four leagues is small enough (1-5pp) that it does not outweigh that shape property.
`repeatTop`/`repeatBottom` stay fully selectable (`SCHEDULE_SHAPE` in settings.js,
`makeSchedule(league, seasonSeed, shape)` in season.js) for a future session to reopen.

Seasons-to-Gold under the chosen `repeatMiddle` default (1 / one-season rate, commits 1-4 combined,
before commit 5's own retune): little 1.47, highschool 2.04, college 2.19, minors 3.37, majors 4.55
- already close to design doc v9's own per-league targets (about 1 / 1.5 / 2 / 3 / 4.5) from the
contract and flavor-budget fixes alone, before any dedicated retune.

### Commit 6: the full report

**Attribution table (commit 1's `--attribute`, one cause per row):**

| Cause | Effect measured | One-line diagnosis |
|---|---|---|
| CPU timing sigma per league | College at parity with, Minors/Majors sharper than, a median human | `CPU.timingSigmaMs` had no per-league floor tied to a human reference; a global floor helps Majors but hurts Little/High School/College, so the fix had to be per-league (commit 2's `CPU_SIGMA_MIN_MS`) |
| `guess`-derived placement noise | College/Minors/Majors placement noise (0.21/0.165/0.12) below median human (0.22) | `guess` was framed as pattern-reading but coded as swing-precision; commit 2 split it into `placementNoise` (precision, floored) and a lean-only `guess` |
| `pitchingLikeLittle` counterfactual | Negative or flat everywhere (majors -6.9pp), not the expected positive/neutral | Unresolved surprise, flagged rather than chased in commit 1 since it was measurement-only; not revisited in commit 5 - `patternWeight`'s dual read (also drives CPU BATTING pattern-reads) is the live hypothesis for a future session |
| Shifters' shift behavior | +0.0723 (later +0.0813) measured strength edge, [OUT OF BAND] on `STYLE_STRENGTH_BAND` | A real, uncompressed positional edge no skill-weight vector predicts; commit 3's `STYLE_STRENGTH_DELTA` pays for it directly rather than moving Shifters off its confirmed ladder slot |

**Per-league win-rate bands, before (commit 4, pre-retune) vs after (commit 5, full `--assert`):**

| League | Target band | Before | After | Verdict |
|---|---|---|---|---|
| little | [0.92, 0.98] | 0.808 | 0.841 | still FAIL (too easy) |
| highschool | [0.70, 0.80] | 0.769 | 0.769 | PASS |
| college | [0.57, 0.67] | 0.667 | 0.694 | still FAIL (too easy) |
| minors | [0.49, 0.59] | 0.617 | 0.628 | still FAIL (too easy) |
| majors | [0.41, 0.51] | 0.564 | 0.561 | still FAIL (too easy) |

Seasons-to-Gold, before vs after (target with ±0.75 tolerance in parens):

| League | Before | After | Target |
|---|---|---|---|
| little | 1.67 | 1.52 | 1 (+0.75) - PASS |
| highschool | 2.14 | 1.90 | 1.5 (+0.75) - PASS |
| college | 2.73 | 2.50 | 2 (+0.75) - PASS |
| minors | 2.50 | 3.19 | 3 (+0.75) - PASS |
| majors | 3.75 | 5.36 | 4.5 (+0.75) - FAIL (moved the wrong way) |

**SLOT_WINRATE_BAND, after (full `--assert`):** weakest opponent measured
`[0.889, 0.828, 0.765, 0.735, 0.736]` against a `>= 0.85` floor at every league - little/highschool
pass, college/minors/majors do not (their weakest CPU is still too tough a first win). Champion
measured `[0.831, 0.743, 0.687, 0.579, 0.514]` against `[0.40, 0.55]` - only majors is in band;
every other league's champion is still too easy relative to the target.

**The Shifters anomaly (not resolved this phase):** at every league, ladder slot 4 (Shifters, zero
skill offset) measures as the single TOUGHEST slot, tougher than slot 7 (Aces, the intended
champion) - e.g. majors slot 4 42.5% player win rate vs slot 7's 51.4%. This survived both this
commit's ladder widening and a fresh `STYLE_STRENGTH_DELTA` re-measurement (0.0723 -> 0.0813, i.e.
it got MORE out of band, not less). `CHAMPION_IS_HARDEST` and the within-league `LADDER_MONOTONE`
check both fail because of this one slot, at every league. This is a genuine, reproducible
structural finding (confirmed at 1000 games/opponent, not sampling noise): Shifters' shift is a
large enough behavioral edge that a single skill-budget correction cannot fully cancel it while
still respecting the doc's own instruction not to move Shifters off its confirmed ladder slot or
hand-tune Aces. **Open for a future session**: either a second, non-skill correction for Shifters
specifically (a partial dampening of its shift magnitude at the correction's own discretion, not
Aces'), or accepting Shifters as a deliberately anomalous "wildcard" slot the doc's ladder shape
does not have to be strictly monotone through.

**Little League's specific tension:** the league needs simultaneously an EASIER overall season
(0.841, target up to 0.98) and a HARDER champion slot specifically (0.831, target down to 0.55).
Every lever tried moves both numbers in the same direction (softer CPU behavior eases the season
AND the champion; tougher ladder-only offsets sharpen both) - no combination found in this phase's
budget separates them. This may need a Little-League-specific mechanism (e.g. a much steeper
ladder curve concentrated only at the top slot) rather than a uniform per-league behavior nudge.

**Cap-binding measurement, no `POINTS` change proposed:** `CAP_BINDS_ONLY` after this commit's
retune: little/highschool bind fast (0.8/2.1 seasons), college/minors/majors do not (6.3/10.6/15.4)
- unchanged in pattern from BB-2b's own finding. None of this commit's levers (CPU behavior fields,
ladder timing/chase, `STYLE_STRENGTH_DELTA`) touch `POINTS`/`CAPS` at all, so this measurement is
reported as confirmation the pattern is stable, not as grounds for a `POINTS` proposal.

**Constants touched this phase, old -> new (full list):**

| Constant | Old | New |
|---|---|---|
| `CPU_SIGMA_FLOOR_MS` (removed) | `55` | (replaced by `CPU_SIGMA_MIN_MS` + `CPU_SIGMA_ABSOLUTE_FLOOR_MS`) |
| `GUESS_READ_NOISE_SCALE` (removed) | `0.3` | (removed; `placementNoise` replaces its role) |
| `CPU_SIGMA_MIN_MS` (new) | - | `{little:115, highschool:95, college:80, minors:70, majors:62}` |
| `CPU_SIGMA_ABSOLUTE_FLOOR_MS` (new) | - | `58` |
| `CPU_PLACEMENT_MIN` (new) | - | `0.22` |
| `CPU[lg].timingSigmaMs` | `90/75/55/45/35` | `115/95/80/70/62` |
| `CPU[lg].placementNoise` (new field) | (derived: `0.27/0.24/0.21/0.165/0.12`) | `0.27/0.24/0.22/0.22/0.22` |
| `CPU.college.cornerBias` / `patternWeight` | `0.33` / `0.23` | `0.38` / `0.27` |
| `CPU.minors.cornerBias` / `patternWeight` | `0.50` / `0.42` | `0.55` / `0.47` |
| `CPU.majors.cornerBias` / `patternWeight` | `0.68` / `0.65` | `0.72` / `0.70` |
| `CPU.little.cornerBias` / `patternWeight` | `0.08` / `0.04` | `0.05` / `0.02` |
| `STYLE_STRENGTH_DELTA` (new) | - | `{sluggers:0.0010, smallBall:-0.0333, patient:0.0160, flamethrowers:-0.0070, junkballers:-0.0150, shifters:0.0813, aces:0.0043, balanced:0}` (first measured 0.0203/-0.0230/0.0133/-0.0047/-0.0143/0.0723/-0.0053 in commit 3, re-measured in commit 5) |
| `SCHEDULE_SHAPE` (new) | - | `'repeatMiddle'` (Draft) |
| `TEAM_LADDER_OFFSETS[*].timingSigmaMs` | `{16,11,7,3,0,-0.8,-2,-3.5}` | `{20,14,9,4,0,-1,-2.5,-4}` |
| `TEAM_LADDER_OFFSETS[*].chase` | `{0.10,0.075,0.05,0.025,0,-0.025,-0.05,-0.075}` | `{0.15,0.11,0.07,0.03,0,-0.03,-0.06,-0.12}` |
| `SEASON_WINRATE_BAND` / `SEASONS_TO_GOLD_TARGET` / `SLOT_WINRATE_BAND` (new, `sim-baseball.mjs` only) | - | per design doc v9's own per-league table (see top of this milestone section) |
| `sw.js` `CACHE` | `game-hub-v822` | `game-hub-v825` (past `origin/main`'s `v824` at time of this commit) |

`POINTS`, `CAPS`, `SEASON.gamesPerSeason`, the trophy rules (`trophyFor`), the contact-quality
constants (`swing.js`/`outcomes.js`), and everything under `js/`/`baseball/js/ui.js`/`css/`/
`strings.js`/`index.html` were not touched.

**Locked-statement inventory, phase-implemented, with the test that proves each:**

| Locked statement (design doc v9) | Test |
|---|---|
| "CPU batters may never time better than a median human" | `baseball/js/test.js` §17 ladder-sweep test + §19 contract test 1 |
| "CPU batters may never place better than a median human" | `baseball/js/test.js` §17 raw-table check + §19 contract test 2 |
| "`guess` only ever weights a location lean, never base placement" | `baseball/js/test.js` §17 structural regex + §19 contract test 3 |
| "Each league up chases less and reads patterns better" | `baseball/js/test.js` §19 monotone tests (`chase`, `patternWeight`, `cornerBias`) |
| "The championship opponent is always the toughest team in the league" | `sim-baseball.mjs --assert`'s `CHAMPION_IS_HARDEST`/`SLOT_WINRATE_BAND` - **currently FAILING** (Shifters anomaly, see above); not yet proven by a passing test |
| "Per-league regular-season win-rate bands / seasons-to-Gold" | `sim-baseball.mjs --assert`'s `SEASON_WINRATE_BAND`/`SEASONS_TO_GOLD_TARGET` - partially passing (seasons-to-Gold: 4 of 5 leagues; win-rate band: 1 of 5 leagues), not fully proven |
| "A flavor style's own behavior is paid for by its own budget, not by hand-picking its slot" | `baseball/js/test.js` §18 |
| "The schedule always meets the champion exactly once, in game 12" | `baseball/js/test.js` §8d shape-agnostic + per-shape assertions |

**Self-review checklist:**
- No CPU sigma below its league minimum or the absolute floor anywhere in `settings.js`: **yes** - `baseball/js/test.js` §17/§19 sweep every league x every ladder slot.
- No CPU placement noise below the human's: **yes** - every `CPU[lg].placementNoise` is `>= CPU_PLACEMENT_MIN` (0.22), checked in §17/§19.
- `guess` no longer touches base placement: **yes** - `agents.js`'s base `aimX` line reads `placementNoise` only; `guess` is confined to the lean-weight blend (§17 structural check).
- `makeLeague` subtracts `STYLE_STRENGTH_DELTA`: **yes** - `teams.js`'s `slotCap` calculation subtracts it; verified against the shipped roster (§18).
- `LEAGUE_LADDER_STYLES` unchanged from Matt's order: **yes** - byte-identical check in §18, at every league.
- `SCHEDULE_SHAPE` monotone and the champion in game 12: **yes** - all three shapes assert this in §8d; `repeatMiddle` is the shipped default.
- No magic numbers left in `agents.js`: **yes** - the sigma/placement floors, lean weight, and pattern-bonus scales all read from named `settings.js` exports (`CPU_SIGMA_MIN_MS`, `CPU_SIGMA_ABSOLUTE_FLOOR_MS`, `CPU_PLACEMENT_MIN`, `LOCATION_LEAN_WEIGHT`, `FOOL_PENALTY_MS_SCALE`, `FOOL_BONUS_MS_SCALE`).
- `RULES_V` bumped if any snapshot shape changed: **not bumped** - no persisted snapshot shape changed this phase (only in-memory settings values and a new, non-persisted `sim-baseball.mjs` scoreboard).
- The contact grid unchanged: **yes** - `node sim-baseball.mjs --contact-grid` measures byte-identical constants and passes all five checks (unchanged from before this phase).

**What did not converge, reported honestly rather than forced:** `SEASON_WINRATE_BAND` (4 of 5
leagues), `SLOT_WINRATE_BAND` (both ends, every league), `CHAMPION_IS_HARDEST`, and the
within-league `LADDER_MONOTONE` check remain FAILING after this commit's retune, for the two
structural reasons above (the Shifters slot-4 anomaly, and Little League's opposite-direction
season/champion tension). `SEASONS_TO_GOLD_TARGET` moved from 4-of-5 passing to majors regressing
slightly (3.75 -> 5.36, now just outside its own tolerance) as a side effect of toughening majors'
`cornerBias`/`patternWeight` to chase the win-rate band, which is the kind of interaction this
phase's levers could not fully separate by hand. This phase's real, banked progress: the CPU
strength CONTRACT (no sub-human sigma or placement anywhere, at any slot, in any league) is fully
implemented and tested, `STYLE_STRENGTH_DELTA` and the schedule-shape question are both real,
measured, settings-driven features now rather than open items, and the diagnosis of WHY the
remaining bands don't converge (Shifters, Little League's tension) is specific enough for a future
session to act on without re-deriving it.

## Status: Phase 2b — why Gold is far away, then the fix

BB-2b (2026-09-13) diagnosed why BB-2a's own promise scoreboard still failed Gold at
College/Minors/Majors, fixed the simulator's own measuring defects, built four engine mechanisms
the doc requires that phase 2/2a still lacked (out-zone gaps and bloopers, the real per-league
fence, pitch speed actually reaching the batter, and the CPU ladder moved onto the timing/chase
axis instead of skill points alone), and retuned from a fixed base. Full report at the end of this
milestone (commit 6); this section is BB-2b commit 4's own proposal block, written the moment the
three Open item 13 settings were decided from measured numbers - see `sim-baseball.mjs --stages`.

### The stage eating the seasons (commit 1's decomposition, before any fix)

The handoff's own diagnosis named three causes: the player seeded low and fed the strongest CPU
team TWICE (semifinal, then the hardcoded final), both playoff games forced player-home while the
regular season alternates, and CPU batting strength pinned to a timing sigma no lever actually
reached. Measured with `--stages` (SEASONS_N=300, median tier, pre-fix engine): the bracket/home
mechanisms move Gold odds by only a few points at every league (e.g. college 20.3% -> 19.7% under
`strongestInFinal`, minors 1.3% -> 1.7%) - **the dominant bottleneck is the REGULAR SEASON win rate
itself** at College/Minors/Majors (top-4 odds 79.7%/29.3%/0.3%), because a median-tier player's
per-game win rate against an average opponent was only ~30% at Minors and ~10% at Majors before any
mechanism fix - confirming the handoff's own third cause (CPU timing sigma) as the one that
mattered most.

### Open item 13, decided (commit 4, measured on the commit-3 engine)

| Setting | Options measured | Decision | Why |
|---|---|---|---|
| `BRACKET_MODEL` | `asCoded` (positional 1v4/2v3) vs `strongestInFinal` (player's semifinal excludes the top qualifier) | **`strongestInFinal`** | The bracket doc §8's own wording implies; measured effect is small and mixed (little +2.3pp gold, majors +0.3pp from 0, highschool -1.3pp, college/minors unchanged) - kept for doc consistency, not because the numbers demanded it |
| `PLAYOFF_HOME` | `player` (forced, shipped) vs `higherSeed` vs `alternate` | **`higherSeed`** | Consistently helps where it matters (little +8.0pp gold, highschool +5.3pp, college +0.3pp from 0%); needs no invented tie-break of its own - the standings already say who is "better" |
| `STANDINGS_MODEL` | `rawWins7` (shipped, CPU caps at 7 wins) vs `scaledTo12` (CPU ranks scripted onto a 12-game scale, 0-2-3-5-7-9-10-12) | **`rawWins7`** (REVERSED from commit 2's initial guess) | `scaledTo12` reads fairer in the abstract but is measurably catastrophic: top-4 odds collapsed at every league (college 40.7% -> 0.3%, highschool 91.7% -> 35.7%, minors 38.0% -> 0.7%, majors 39.7% -> 1.3%) because it inflates the top few CPU qualifiers to near-perfect 12-game records (9-3 through 12-0) that a median player essentially cannot beat |

Schedule shape (also doc §4/§13 Open item 13, bundled with standings tie-breakers in the doc's own
wording) was measured too but is **not** changed in code: `season.js`'s own `OPPONENT_ORDER`
comment records that its exact current shape - every opponent once, then the top four (the
strongest half) a SECOND time, late - was **already confirmed by Matt**, not merely Draft-invented.
Measured anyway, because commit 1 was asked to: repeating the WEAKEST four early instead
(`repeatBottom`) measured a large, consistent improvement at every league (college top-4 40.7% ->
80.3%, gold 0% -> 0.3%; minors top-4 38.0% -> 70.7%; majors top-4 39.7% -> 78.0%, gold 0% -> 0.7%;
little/highschool gold also rise) without touching `POINTS`/`SEASON` at all - the single largest
lever this tool found, bigger than the retune below. **Flagged as a recommendation for Matt to
reopen, not applied**, since changing an already-confirmed shape is exactly the kind of decision
this tool does not get to make on its own.

### What else changed (commits 2, 3, 5)

- **Commit 2, simulator defects**: `experimentNudgeAB`'s Slugger/TableSetter tier wiring was
  checked and found already correct (fixed in BB-2a step 4, before this handoff was written - no
  change needed). The promise scoreboard's three "median tier, every league" lines now report the
  WORST league, not the median across leagues - a median across five leagues let Little/High
  School's easy numbers hide Majors' 0.3% top-4 rate. `season.js`'s `playoffs()`/
  `scriptedStandings()` gained real `BRACKET_MODEL`/`STANDINGS_MODEL` parameters (defaulting to new
  settings.js constants); both playoff games' home/away now follows a new `PLAYOFF_HOME` setting
  instead of being forced player-home.
- **Commit 3, engine mechanisms**: `zones.js` gained real angular GAPS between out-zone sectors
  (`GAP_DEG`) and `outcomes.js` gained a bloop-single band short of an outfield sector's own near
  edge (`BLOOP_BAND_FT`) - doc §10, [Locked]: "Singles go through gaps and as bloopers," neither of
  which existed before this phase. `game.js`'s `_parkFt()` now reads `FIELD[league].fenceFt`
  directly for every league instead of scaling `PARKS.default` by `fieldScale` - a real, found
  integration bug: `game.js`'s `_buildSwingView` never included `pitchHistory` at all, so
  `CpuBatter`'s whole pattern-following mechanism was written but NEVER FIRED in a real game, only
  in hand-built test fixtures. Fixed, and `pitch.js`'s `flyPitch()` now reads `pitchSpd`/`pitchSpin`
  skill points (named since BB-1a, unused until now) to shorten fastball travel and widen the
  changeup's own speed gap; `ModelBatter` gained the same "a changeup fools your timing" mechanic
  CpuBatter already had (`SPEED_SURPRISE_MS_PER_MULT`). `TEAM_LADDER_OFFSETS` restructured from a
  bare skill fraction per slot into `{skill, timingSigmaMs, chase}` - the skill-only ladder had
  gone nearly inert once the contact-quality fix made skill points barely move win rate; the new
  two axes are what the retune (commit 5) actually moves. `CPU_SIGMA_FLOOR_MS` (55) stops any
  league's own base sigma from being sharper than a median human. Ten more magic numbers in
  `agents.js` got named (values unchanged). `ModelPitcher.variety` is now continuous instead of
  binary.
- **Commit 5, the retune**: see the full old/new constant list in that commit's own message; summary
  above. `CPU.college.timingSigmaMs` 55->65, `CPU.minors.timingSigmaMs` 45->60,
  `CPU.majors.timingSigmaMs` 35->55 (the floor); `CPU.minors`/`CPU.majors` cornerBias/patternWeight/
  weakSpotWeight/chase widened; `CPU_LEVEL_SHORTFALL` `{college:3,minors:6,majors:9}` ->
  `{college:3,minors:4,majors:4}`; `TEAM_LADDER_OFFSETS.timingSigmaMs`/`.chase` widened (`.skill`
  unchanged from BB-2a); `MECHANICS.doublePlayChance` 0.40 -> 0.30.

### The promise scoreboard, as measured 2026-09-13 (`node sim-baseball.mjs --assert`, full default
### sweep, 400 games/cell, 300 seasons/cell, LADDER_GAMES_N=1000, ~29s wall clock)

```
  [FAIL] GOLD_SEASONS_MAX_MEDIAN (median tier, worst league): measured 12.00, threshold <= 2
  [FAIL] GOLD_ONE_SEASON_MIN_MEDIAN (worst league): measured 0.083, threshold >= 0.35
  [FAIL] CHAMPION_GAME_WIN_MIN_MEDIAN (worst league): measured 0.362, threshold >= 0.4
  [PASS] LADDER_MONOTONE (win rate falls each league up): measured [0.759,0.655,0.573,0.515,0.492]
  [FAIL] LADDER_MONOTONE (within-league, weakest..strongest opponent): see the table below
  [FAIL] CHAMPION_IS_HARDEST (new, BB-2b commit 5): the strongest ladder slot is NOT the lowest
         win rate of any opponent at any league - see below
  [PASS] NUDGE_A_B (well-timed low-Power beats sloppy high-Power, margin >= 0.10):
         measured [0.552,0.6,0.522,0.477,0.513]
  [FAIL] CAP_BINDS_ONLY (little/highschool cap within seasons): measured ["0.8","2.3"], <= 2
         (High School misses by 0.3 seasons, unchanged from BB-2a - POINTS out of scope)
  [PASS] CAP_BINDS_ONLY (college/minors/majors do NOT bind quickly): ["8.4","14.1","20.0"], > 2
  [PASS] SKILL_EFFECT sensitivity: unchanged from BB-2a (SKILL_EFFECT/swing.js untouched this phase)

  within-league ladder (median tier, 1000 games/opponent, weakest..strongest):
    little     80.2  79.2  78.7  78.8  64.8  74.5  71.9  69.6
    highschool 75.0  72.8  71.2  68.0  56.7  68.5  61.8  62.8
    college    70.8  66.1  57.6  61.5  45.1  55.1  48.0  51.6
    minors     64.9  63.9  58.6  53.2  37.9  47.6  41.3  42.0
    majors     68.1  62.8  55.4  49.4  34.5  44.5  35.0  37.5
```

**Read plainly, these are the open items for Matt**, largely reframed from phase 2/2a's own list
now that this phase has actually measured (not merely guessed) which lever moves what:

1. **Gold is still far away at the worst league** (College/Minors/Majors, worst measured at
   Majors). This phase's own `--stages` decomposition (commit 1) traced the dominant cost to the
   SCHEDULE, not the bracket, home field, or CPU tuning: the shipped 12-game season plays the
   strongest four opponents TWICE, so even a genuinely fair per-game win rate against the hardest
   quarter of the league is paid twice before the playoffs. Commit 4 measured the fix
   (`repeatBottom`, repeating the WEAKEST four instead) as a large, consistent win at every league
   (e.g. Majors top-4 39.7% -> 78.0%) but did not apply it, because `season.js`'s own
   `OPPONENT_ORDER` comment records the current shape as already confirmed by Matt specifically -
   reopening it is his call, not a retune-only decision. **This is the single highest-leverage open
   item**: loosening the `GOLD_*` thresholds themselves is the other option on the table, unchanged
   from phase 2's own framing.
2. **A new `CHAMPION_IS_HARDEST` check FAILS**: the league's own un-offset "slot 4" measures
   HARDER than slots 5-7 at every league, despite carrying none of the ladder's own skill/sigma/
   chase advantage. Traced to `LEAGUE_LADDER_STYLES` - slot 4 is occupied by the `shifters` style,
   whose real toughness is a BEHAVIOR (`STYLE_BEHAVIOR.shift`, rotating out-zones toward the
   batter's spray) that no ladder offset touches. `LEAGUE_LADDER_STYLES`'s own header already
   marks it PROPOSED, not confirmed - reordering which style sits at which slot (moving `shifters`
   off the median slot) is the fix this points to, flagged for Matt rather than changed here.
3. **High School's `CAP_BINDS_ONLY` misses by 0.3 seasons** (2.3 vs 2.0), unchanged from BB-2a -
   `POINTS.highschool` is untouched Draft and explicitly out of this phase's scope.
4. **The within-league ladder is still not strictly monotone** even after commit 5's widening -
   see the table above; the disorder traces to the same per-style behavioral effects as item 2.

### The Locked-statement inventory, new rows this phase

One row per Locked statement BB-2b implemented or newly tested, continuing BB-2a's table (see
below for the full inventory; `test.js` section numbers cited).

| Doc statement | Test |
|---|---|
| §10 Singles go through gaps | §16 (BB-2b commit 3, new) |
| §10 Singles as bloopers | §16 (BB-2b commit 3, new) |
| §10 Doubles in the gaps | §16 (BB-2b commit 3, new) |
| §10 Fields get bigger each league, at every named point (was center only) | §15 (extended, BB-2b commit 3) |
| §8 CPU batters read your patterns (now actually wired into real games) | §16 (BB-2b commit 3, new) |
| §6 Speed: pitch velocity (pitchSpd) | §16 (BB-2b commit 3, new) |
| §6 Spin: bigger speed gap on the changeup (pitchSpin) | §16 (BB-2b commit 3, new) |
| §8 the semifinal never holds the strongest qualifier (BRACKET_MODEL=strongestInFinal) | §8d (BB-2b commit 2, new, 1000 seeded seasons) |
| §8 difficulty from behavior not bigger stats (CPU_SIGMA_FLOOR_MS) | §16 (BB-2b commit 3, new) |

### Every settings.js constant, by source (updated for Phase 2b)

Phase 2b changes, restated: `BRACKET_MODEL`/`PLAYOFF_HOME`/`STANDINGS_MODEL` are new Draft [Open
item 13] constants (commit 2), each `season.js`'s own default parameter; `GAP_DEG`/`BLOOP_BAND_FT`
are new Draft constants powering the gap/blooper mechanism (commit 3, no doc-given numbers - §10
leaves exact zone sizes open, Open item 7); `SPEED_SURPRISE_MS_PER_MULT`/`CPU_SIGMA_FLOOR_MS`/
`VARIETY_REPEAT_BASE_CHANCE` are new Draft constants (commit 3); `AIM_CORNER_CHANCE_MULT`/
`AIM_INZONE_BIAS`/`AIM_CORNER_BIAS_BASE`/`AIM_CORNER_BIAS_SCALE`/`WEAKSPOT_AIM_SCATTER`/
`SPEED_DELTA_DEADBAND`/`FOOL_PENALTY_MS_SCALE`/`FOOL_BONUS_MS_SCALE`/`GUESS_READ_NOISE_SCALE`/
`LOCATION_LEAN_WEIGHT` are commit 3's naming pass over ten pre-existing `agents.js` magic numbers -
values unchanged, only now named. `TEAM_LADDER_OFFSETS` restructured from a bare per-slot number
into `{skill, timingSigmaMs, chase}` (commit 3, widened commit 5) - `.skill` numerically unchanged
from BB-2a step 6 throughout. `CPU.college/minors/majors.timingSigmaMs`, `CPU.minors/majors`'s
cornerBias/patternWeight/weakSpotWeight/chase, `CPU_LEVEL_SHORTFALL`, and
`MECHANICS.doublePlayChance` are all Draft, retuned (commit 5 - old/new values in that commit's own
message). `SKILL_EFFECT.*`/`FIELD.*`/`CARRY_SCALE`/`LINE_THROUGH_*` are UNCHANGED from BB-2a -
neither `swing.js` nor the contact-quality model was touched this phase.

### Verification (Phase 2b, in order)

```
node validate-sw-assets.mjs           # ok, REST_MANIFEST/version.json regenerated for game-hub-v822
node baseball/js/test.js              # 1911 assertions, 0 failed (was 1374 at start of phase)
node sim-baseball.mjs --contact-grid  # PASS on all 5 assertions, byte-identical to BB-2a (SKILL_EFFECT/swing.js untouched)
node sim-baseball.mjs --assert --quick   # FAILS - see the promise scoreboard; the tool reporting, not a build break
node sim-baseball.mjs --assert        # FAILS - full-sample confirmation of the same open items
node test-game-conventions.mjs        # 11 passed, 0 failed, no new known-gap entries
node validate-sw-assets.mjs           # re-run, unchanged
node test-sw-strategy.mjs             # 107 passed, 0 failed
```

**`sim-baseball.mjs --assert` fails on real, reported game-design findings, not on a broken
build.** This phase made real, measured progress (the across-league ladder now passes for the
first time; the champion-game win rate rose from ~6% to 36%) but did not reach Gold at the worst
league - the four open items above, and the schedule-shape proposal in particular, are Matt's to
resolve; nothing in this phase invents a passing number to paper over them.



BB-2a (2026-09-12, same day as BB-2) fixed the three mechanisms diagnosed in BB-2's own report as
the reason "well-timed low-Power beats sloppy high-Power" (doc §8, [Locked]) failed in every
league: timing was binary inside its own window, a perfectly-timed swing sprayed toward dead
center (the worst place on the field), and power was additive with no gate on quality. It also
separated team FLAVOR from STRENGTH (phase 2's "within-league ordering is noisy" open item), added
a Locked-statement test inventory, and did one retune pass from a reverted base. **Two standing
rules are now in force, written into this file per that instruction**:

1. Every Locked statement in the design doc has a test that fails if the code stops honoring it.
2. Every phase's report lists which Locked statements it implemented and the test that proves each.

### What changed

- **`baseball/js/engine/swing.js`**: a new continuous contact-quality axis, `q` (`qualityFor`),
  1 at dead-on timing (`FEEL.engine.perfectMs`) falling linearly to 0 at the timing window's own
  edge. Exit velocity now reads it — power's own contribution is scaled by `q` (it multiplies a
  good swing, never rescues a bad one) and a q=0 swing floors at `qualityFloor` of the no-power
  base. The centered-contact launch-angle band narrows toward a line-drive spread as `q` rises and
  widens toward topped/popped as it falls. Spray direction still pulls/opposes by timing sign, but
  the pull/opposite magnitude shrinks to zero as `q` rises; at `q`=1 the swing centers on one of the
  two GAPS (`perfectSprayDeg`) instead of dead center.
- **`baseball/js/engine/outcomes.js`/`settings.js`**: a well-squared-up line drive (`q` at or above
  `LINE_THROUGH_Q`) that lands inside an outfield sector's reach now goes through as a hit
  (`line-through`), up to `LINE_THROUGH_MAX_FT` — a routine fly into the same spot stays an out.
- **`sim-baseball.mjs --contact-grid`** (new): an isolated plate-appearance harness (a real college
  `CpuPitcher`, the real `swing.js`/`outcomes.js`/`zones.js` pipeline `game.js` itself calls, no
  full 3-inning game) measuring expected bases per SWING over a 3x3 grid of timing sigma
  {35,55,85} x hitPow {2,6,10}, 20000 swings/cell. Four assertions (monotone, ratio, cross,
  ceiling — see the pasted grid below). Also fixed a real pre-existing bug in the season A/B
  experiment: the comment and field names said Slugger should get sloppy timing and Table Setter
  precise timing, but the code passed the tiers SWAPPED — the exact reason `NUDGE_A_B` failed in
  every league throughout phase 2 regardless of the contact model underneath it.
- **`baseball/js/engine/teams.js`/`settings.js`**: `TEAM_STYLES` vectors are FLAVOR only now, not
  strength — measured and compressed toward `balanced` by `sim-baseball.mjs --styles --tune`
  (CPU-vs-CPU, real Game, both sides at the same effectiveCap) so every style's win rate lands
  within `STYLE_STRENGTH_BAND` (0.04) of 0.50. Patient and Shifters compress hardest because their
  real identity is a new `STYLE_BEHAVIOR` table (`chaseMul`, `shift`), not a skill shape — Patient's
  batters chase bad pitches less (`agents.js`'s `CpuBatter` now takes an optional `styleId`) and
  Shifters rotate their out-zones (`game.js`'s `_shiftDegFor` now reads `STYLE_BEHAVIOR.shift`
  instead of a hardcoded `'shifters'` string). STRENGTH now comes from `TEAM_LADDER_OFFSETS` — eight
  per-slot FRACTIONAL offsets of `effectiveCapFor(league)` — applied by SLOT in `makeLeague`, which
  orders teams by `LEAGUE_LADDER_STYLES`'s own table rather than a post-hoc sort by measured
  `teamStrength()`. `LEAGUE_LADDER_STYLES` is one PROPOSED order (Balanced weakest through Aces as
  champion, doc §8) — **for Matt to confirm or edit.**
- **The retune** (step 6, from the base step 1 reverted): `CPU_LEVEL_SHORTFALL`
  `{college:1.5,minors:3.3,majors:5.3}` → `{college:3,minors:6,majors:9}` (effective caps
  10/14/16.5/18.7/20.7 → 10/14/15/16/17); `SKILL_EFFECT.hitAcc.contactRadiusInPerPt` 0.15 → 0.09;
  `.whiffReductionPerPt` 0.01 → 0.006; `SKILL_EFFECT.hitPow.exitVeloMphPerPt` 0.6 → 0.35;
  `MECHANICS.doublePlayChance` 0.45 → 0.40. Two more aggressive experiments (shortfall up to
  `{college:5,minors:10,majors:15}`, softened majors/minors CPU behavior) were tried and discarded —
  both moved Gold odds only marginally and made Minors/Majors' regular-season top4 rate WORSE,
  reconfirming phase 2's own diagnosis under the new contact model: the bottleneck is COMPOUND
  probability (the 12-game schedule already plays the top half of the ladder twice, and Gold needs
  winning both a semifinal AND a championship against the single strongest team in one season).
- **The within-league `LADDER_MONOTONE` check** now has its own dedicated measurement
  (`LADDER_GAMES_N`=1000/opponent, median tier) and a real numeric `LADDER_TOLERANCE` (0.02),
  replacing phase 2's ad hoc "+0.15" fudge, which was hiding real disorder at only 400
  games/opponent. `TEAM_LADDER_OFFSETS` is a FRACTION of `effectiveCapFor(league)`, not a flat
  skill-point delta — a flat delta was a huge swing at Little League's cap of 10 but mild at Majors'
  20.7, and measurably flattened Little/High School's ladder into noise; step 6 corrected this.
- **A real, pre-existing bug found by a new test** (step 8): `FIELD.majors`' left/center/right
  (330/400/330) were each SMALLER than `FIELD.minors`' (335/405/335) — a violation of doc §10,
  [Locked] ("Fields get bigger each league") that nothing checked before test.js section 15's
  `fenceFtAt(0)` monotonicity assertion. Corrected to `{337/378/408/378/337}`, still Draft [Open
  item 7].

### The contact grid (`node sim-baseball.mjs --contact-grid`, 20000 swings/cell, league=college)

```
  E[bases/swing]   hitPow=2   hitPow=6   hitPow=10
  sigma=35ms         0.7154     0.7344     0.7521
  sigma=55ms         0.5151     0.5202     0.5448
  sigma=85ms         0.3507     0.3584     0.3685

  [PASS] monotone (E falls as sigma rises, every hitPow)
  [PASS] monotone (E rises with hitPow, every sigma - power is a nudge, never zero)
  [PASS] ratio (timing gap at hitPow=2 >= 2.0x the power gap at sigma=85): 0.3648 >= 2.0 x 0.0179
  [PASS] cross (well-timed low-Power beats sloppy high-Power by >= 0.05): 0.3469
  [PASS] ceiling (power gap at sigma=35 <= 0.5x the timing gap at hitPow=2): 0.0367 <= 0.5 x 0.3648
```

### The style-strength check (`node sim-baseball.mjs --styles`, college, 3000 games/style)

Every style within +/-4pp of 50% except Sluggers, which drifted to 54.5% after step 6's
`CPU_LEVEL_SHORTFALL` change moved `effectiveCapFor('college')` (the tuning in step 5 measured
against 16.5, step 6 landed on 15) — a small, known residual, not re-chased past one targeted
attempt (moving its compression from s=1.3 to s=1.15 measured 54.4%, indistinguishable from 54.5%
at this sample size, so the original s=1.3 vector was kept): sluggers 54.5%, smallBall 48.9%,
patient 52.6%, flamethrowers 49.5%, junkballers 48.4%, shifters 51.7%, aces 48.3%.

### The promise scoreboard (`node sim-baseball.mjs --assert`, 400 games/cell, 300 seasons/cell,
### LADDER_GAMES_N=1000, ~22.5s wall clock)

```
  [FAIL] GOLD_SEASONS_MAX_MEDIAN (median tier, every league): measured 6.38, threshold <= 2
  [FAIL] GOLD_ONE_SEASON_MIN_MEDIAN: measured 0.157, threshold >= 0.35
  [PASS] CHAMPION_GAME_WIN_MIN_MEDIAN: measured 0.706, threshold >= 0.4
  [PASS] LADDER_MONOTONE (win rate falls each league up): measured [0.813,0.719,0.507,0.293,0.111]
  [FAIL] LADDER_MONOTONE (within-league, weakest..strongest opponent): see the table below
  [PASS] NUDGE_A_B (well-timed low-Power beats sloppy high-Power, margin >= 0.10):
         measured [0.455,0.52,0.693,0.718,0.527]
  [FAIL] CAP_BINDS_ONLY (little/highschool cap within seasons): measured ["0.8","2.2"], <= 2
  [PASS] CAP_BINDS_ONLY (college/minors/majors do NOT bind quickly): ["8.9","26.7","103.6"], > 2
  [PASS] SKILL_EFFECT sensitivity: measured ["0.050","0.040","0.013","0.018","0.025"], <= 0.08

  within-league ladder (median tier, 1000 games/opponent, weakest..strongest):
    little     81.4  81.5  82.2  80.7  78.7  79.4  77.2  80.9
    highschool 74.5  75.2  71.8  72.3  70.6  70.8  69.5  73.5
    college    54.8  52.5  51.6  53.6  50.5  50.2  45.3  50.1
    minors     31.6  31.0  32.4  30.7  28.6  30.7  24.6  27.6
    majors     12.7  12.6  12.8   9.4  11.3   8.2   6.0   9.3
```

**Read plainly, these are the open items for Matt** (largely unchanged in substance from phase 2,
now measured against the FIXED contact model rather than the broken one):

1. **Gold is still too rare at College/Minors/Majors median skill.** The mechanism fix (steps 2-4)
   and the retune (step 6) did not move this - the bottleneck is COMPOUND probability, not contact
   quality or CPU strength. Loosening `GOLD_SEASONS_MAX_MEDIAN`/`GOLD_ONE_SEASON_MIN_MEDIAN`, or
   reworking how Gold is reached (a bye, a weaker semifinal opponent, a shorter top-half schedule
   repeat), are both on the table - this tool does not choose.
2. **High School's `CAP_BINDS_ONLY` misses by 0.2 seasons** (2.2 vs 2.0) - `POINTS.highschool` is
   untouched Draft and explicitly out of this phase's scope ("do not touch POINTS").
3. **The within-league ladder is far tighter than phase 2** (mostly within a few points at 1000
   games/opponent, down from swings as wide as 25+ points) **but still not strictly monotone.** The
   remaining disorder traces to which skill a slot's style favors mattering more or less against a
   fixed human strategy than its raw ladder offset predicts - not to sampling noise, and not to
   offset magnitude (a wider spread measured no better than the narrower one kept).
4. **Sluggers sits at 54.5% vs `balanced`**, 0.5pp outside `STYLE_STRENGTH_BAND` - a small drift
   from step 6's `CPU_LEVEL_SHORTFALL` change after step 5's tuning pass, not re-chased.

### The Locked-statement inventory (the two standing rules above, applied)

One row per Locked statement the engine can honor, with the test that proves it. `test.js`'s own
section numbers are cited; run `node baseball/js/test.js` to see them all pass.

| Doc statement | Test |
|---|---|
| §1 One flat plane (pitch varies x and speed only) | §4 `pitch.js` - `ZONE`/`flyPitch` |
| §3 3 innings, 3 outs/half, 4 balls/3 strikes, foul never K3 | §10 rules correctness |
| §3 Extra innings: runner on second every extra half | §10 extra-innings probes |
| §3 Walk-off ends immediately; skip a pointless bottom half | §10 walkoff/scheduled-skip probes |
| §3 Ground-out double play possible, runner on 1st, <2 outs | §10 double-play probes |
| §3 Deep fly out can be a sac fly | §10 sac-fly probes (incl. shallow-fly negative) |
| §3 **No mercy rule** | §15 (BB-2a step 8, new) |
| §3 Batter Speed affects beating out grounders | §15 (BB-2a step 8, new) |
| §6 Exactly six real skill ids | §15 (BB-2a step 8, new) |
| §6 Start 15/15 points, cap 10 | §15 (BB-2a step 8, new) |
| §6 Presets sum to 15/side, nothing over 10 | §1 settings integrity |
| §7 Win pays >= loss; trophies rise bronze<silver<gold | §1 settings integrity |
| §8 CPU generated below the raw cap, per league | §8 `effectiveCapFor` |
| §8 Effective-cap ladder strictly rising by league | §8 `[KNOWN-BUG PROBE]` |
| §8 Little League mostly fastballs | §15 (BB-2a step 8, new) |
| §8 Each league up mixes more/works corners more/chases less | §8c CPU table monotonicity |
| §8 Majors attacks your weak spots (highest weakSpotWeight) | §15 (BB-2a step 8, new) |
| §8 CPU batter reads pattern memory (speed narrows, location leans) | §9b |
| §8 Rosters fixed - same (league,index) is byte-identical | §8 `makeTeam` determinism |
| §8 8 teams ordered weakest to strongest, no forced replays, the A/B | `sim-baseball.mjs --assert` (NUDGE_A_B, LADDER_MONOTONE) |
| §8 **Well-timed low-Power beats sloppy high-Power, by a margin** | `sim-baseball.mjs --contact-grid` (this phase's own gate) |
| §9 8 teams, one per style | §8b `makeLeague` |
| §9 9 distinct batters, 1 pitcher per game | §15 (BB-2a step 8, new) |
| §9 No names, jersey + position only | §8 |
| §9 ~1 in 4 CPU players are lefties | §15 (BB-2a step 8, new) |
| §9 Shifters shift their out-zones toward your spray | §9a2 (BB-2a step 5, new) |
| §9 Team strength rises by league at the same style | §8b |
| §10 4 infield / 3 outfield out-zones | §15 (BB-2a step 8, new) |
| §10 Pop-ups in the infield are always outs | §15 (BB-2a step 8, new) |
| §10 Fields/out-zones get bigger each league | §6 (depth) + §15 (fence distance, new) |
| §10 No "error" outcome anywhere | §2 `[KNOWN-BUG PROBE]` |
| §11 Pitch unlock table, cumulative by league | §1 settings integrity |
| §11 Title-gated eephus/cutter | §1 settings integrity |
| §15 Fixed 1/120s timestep | §1 settings integrity |
| §15 Forward-only snapshot migration (rulesV mismatch rejected) | §12 resume gate |

**Not yet implementable, listed as such, with the phase that owns it:**

- Break direction by arm, hidden readout until the ball crosses the plate (phase 3 - no rendering
  or player-facing UI exists yet).
- Steal, bunt, pickoff (phase 6, per `RESERVED_PHASE_6` in settings.js - no baserunning between
  pitches exists this phase).
- Points/caps flow into a real career loop (phase 4 - `POINTS`/`CAPS` are computed by the
  simulator's own experiments but nothing in the shipped engine spends them yet).

### Verification (Phase 2a, in order)

```
node validate-sw-assets.mjs           # ok, REST_MANIFEST/version.json regenerated for game-hub-v812
node baseball/js/test.js              # 1374 assertions, 0 failed (was 1317 before this phase)
node sim-baseball.mjs --contact-grid  # PASS on all 5 assertions (see grid above)
node sim-baseball.mjs --assert --quick   # FAILS - see the promise scoreboard; the tool reporting, not a build break
node sim-baseball.mjs --assert        # FAILS - full-sample confirmation of the same three open items
node test-game-conventions.mjs        # 11 passed, 0 failed, no new known-gap entries
node validate-sw-assets.mjs           # re-run, unchanged
node test-sw-strategy.mjs             # 107 passed, 0 failed
```

**`sim-baseball.mjs --assert` fails on real, reported game-design findings, not on a broken
build**, exactly as phase 2's own report noted - now measured against a contact model that no
longer contradicts itself, and with a within-league ladder check tight enough to trust. Every other
suite is green. The four open items above are Matt's to resolve.

## Status: Phase 2 — mechanisms and simulator

BB-2 (2026-09-12, same day as BB-1a) landed the three mechanisms the shipped engine still faked
(out-zone defense, per-league CPU behavior, no fixed CPU team names/rosters) and a new pure season
module plus `sim-baseball.mjs`, the repo-root simulator that measures the doc's five promises
against the real engine. **It reports; it does not lock** — every retuned constant below is still
Draft, now tagged "measured by `sim-baseball.mjs` 2026-09-12" instead of an invented Open item
number, and several of the doc's own promises measure as FAILING under this build. That is the
tool doing its job, not a bug in it: the scoreboard is pasted verbatim below for Matt to read and
decide from.

### What changed

- **`baseball/js/engine/zones.js`** (new): out-zone geometry (doc §10, [Locked] — four infield
  ground-out sectors, three outfield fly-out sectors) replacing `game.js`'s invented
  `_defenseLevel01()` league-ordered ramp, which is gone. `outcomes.js`'s `resolveContact` now
  takes a `zones` object and a `fenceFt` shape (piecewise-interpolated across the doc's five named
  points via the new `fenceFtAt`) instead of a bare `fieldingSkill01` number, and there is no
  "error" outcome anywhere in the engine any more — the real design's outcome list is
  singles/doubles/triples/homers/outs (doc §10) and phase 1 invented the fifth one.
  `SETTINGS.FIELD` is now per-league (`fenceFt`/`outZoneMult`/`fieldScale`); `FOUL_LINE_DEG` and
  `PARK_GEOMETRY` hold the league-independent facts that used to live inside the old flat `FIELD`.
  A "shifters" team (doc §9, [Locked]) genuinely rotates its zones now, toward a batter's own
  recent spray tendency (`game.js`'s new `sprayHistory`, snapshotted, windowed by `SHIFT_WINDOW`
  and clamped by `SHIFT_MAX_DEG`).
- **`baseball/js/engine/agents.js`**: `CpuPitcher` draws from a real per-league `pitchMix` and aims
  by `cornerBias`; at a league with `weakSpotWeight` above zero it sometimes aims at the batter's
  own recent whiff locations (`game.js`'s new `weakZoneLog`, windowed by `WEAKSPOT_WINDOW`) — doc
  §8, [Locked]: "Majors: attacks your weak spots." `CpuBatter` now actually reads
  `view.pitchHistory` (`{type, x}` per entry, not a bare type string) through the existing
  `PATTERN_WEIGHTS`/`patternWeight`: a repeated pitch SPEED narrows its timing spread, a changed
  one widens it; a consistently-thrown LOCATION pulls its aim toward it. `settings.js`'s `CPU`
  table carries these four new per-league fields for the first time — the prototype only ever
  tuned `college`, and BB-1a copied that one tier to every other league as an explicit
  placeholder; every row is spread for real now.
- **`baseball/js/engine/teams.js`**: players carry no `name` any more — `jersey` (1-99) and `pos`
  (one of the real nine defensive positions) instead, doc §9, [Locked]: "Players are shown by
  jersey number and position... No names." `makeLeague(league)` is new: the doc's fixed
  eight-team, one-style-each league (doc §9), ordered weakest to strongest (doc §8, [Locked]),
  fixed forever by `hashSeed('bb-league', league, styleId)` — never by array position, so
  reordering `TEAM_STYLES`' keys can never reseed a team. `makePlayerTeam({skills, hand})` is new:
  nine clones of the one player who always bats and always pitches (doc §6, [Locked]).
  **`RULES_V` bumped 2 → 3** for the player-shape change; an old snapshot's roster would carry a
  field the UI no longer reads and be missing two it needs, so it is rejected outright
  (`validateSnapshot`), never silently resumed.
- **`baseball/js/engine/season.js`** (new): pure, no `game.js` dependency, reusable by a later
  phase's real career loop. `makeSchedule(league, seasonSeed)` — 12 games over 8 opponents, every
  opponent once then the four strongest a second time, weakest-to-strongest with the repeats late,
  6 home/6 away shuffled by seed (doc §4, [Draft], confirmed by Matt). `scriptedStandings(teams,
  playerResults)` — the 8 CPU teams' own round-robin is entirely determined by strength (doc §8,
  [Locked]: "each CPU team beats every weaker CPU team"), no game actually played among them; the
  player's real record folds in as a ninth row. `playoffs(standings)` — top 4, 1v4/2v3 semifinals,
  the strongest team wins any semifinal it is in that the player is not also in (resolved by
  actually playing it otherwise). `trophyFor(result)` — 0/1/2/3 per `baseball/CLAUDE.md`'s frozen
  scale.
- **`baseball/js/engine/agents.js`**: `ModelBatter`/`ModelPitcher` (new) — `sim-baseball.mjs`'s own
  stand-in for a human at a given skill tier, same pluggable-agent call shape as every other agent.
- **`sim-baseball.mjs`** (new, repo root): see "The simulator" below.
- **`MECHANICS.doublePlayChance`**: 0.45 → **0.40**, measured by `sim-baseball.mjs` 2026-09-12
  (puts a double play at roughly 1-in-8 grounders once P(runner on first, <2 outs) is folded in).
- **`SKILL_EFFECT.hitAcc.contactRadiusInPerPt`**: 0.15 → **0.12**; **`.whiffReductionPerPt`**:
  0.01 → **0.008**; **`SKILL_EFFECT.hitPow.exitVeloMphPerPt`**: 0.6 → **0.5** — all measured by
  `sim-baseball.mjs` 2026-09-12 against the ten-point win-rate-gap experiment below.
- **`CPU_LEVEL_SHORTFALL`**: `{little:0, highschool:0, college:1.5, minors:3.3, majors:5.3}` →
  **`{little:0, highschool:0, college:3, minors:6, majors:9}`**, measured by `sim-baseball.mjs`
  2026-09-12 — giving a strictly-rising effective-cap ladder of 10/14/15/16/17 (was
  10/14/16.5/18.7/20.7). Pushed further in two intermediate attempts (shortfalls up to
  `{college:6, minors:11, majors:15}`) trying to raise median-tier Gold odds; the effect measured
  small (roughly +15 percentage points of gold rate for roughly 3x the shortfall), so the smaller,
  ladder-preserving values below were kept instead of chasing the Gold thresholds by brute force.
- **`CPU` table**: every row now carries `pitchMix`/`cornerBias`/`patternWeight`/`weakSpotWeight`
  (see above); `cornerBias`/`patternWeight` were softened once from their first draft after the
  same shortfall-chasing pass moved them too far in one commit — final values are in
  `settings.js`, all tagged "Draft, measured by `sim-baseball.mjs` 2026-09-12."

### The simulator (`sim-baseball.mjs`, repo root)

`node sim-baseball.mjs [--league <id>] [--tier weak|median|strong] [--games N] [--seasons N]
[--quick] [--set outZoneMult=0.9,1.0,1.1] [--json <path>] [--assert]`. Plays real games through the
real `Game`, real agents, `makeLeague`, `makeSchedule` and `scriptedStandings` — nothing in its
report is invented. For every league/team/tier it records wins, runs, hits/doubles/triples/homers,
strikeouts, walks, pitches/at-bats per game and an estimated phone minutes (`FEEL.ui` pacing); for
every league/tier it plays whole seasons and reports standings odds, trophy odds, expected seasons
to Gold, points/season and seasons to cap. Two extra experiments: doc §8's "well-timed low-Power
beats sloppy high-Power" as an A/B, and a `SKILL_EFFECT` sensitivity sweep (win rate at cap vs. ten
points below). `MODEL_TIERS` (its own assumption, not game code — median 55ms timing sigma/0.22
placement sigma/0.6 pitch variety, weak 85/0.35/0.3, strong 35/0.12/0.85) is printed at the top of
every report and overridable with `--tier-sigma`. `--assert` exits non-zero on any FAIL — the phase
gate, deliberately not wired into `run-all-tests.mjs` (same call as the Brick City suites: this is
minutes, not seconds, and Matt's own instruction is not to run the full suite on games nobody is
touching). Re-run after any change to `settings.js`'s CPU/CAPS/CPU_LEVEL_SHORTFALL/SKILL_EFFECT
tables, `zones.js`, or `season.js`.

### The promise scoreboard, as measured 2026-09-12 (`node sim-baseball.mjs`, full default sweep,
### 400 games/cell, 300 seasons/cell, ~23s wall clock)

```
  [FAIL] GOLD_SEASONS_MAX_MEDIAN (median tier, every league): measured 4.05, threshold <= 2
  [FAIL] GOLD_ONE_SEASON_MIN_MEDIAN: measured 0.247, threshold >= 0.35
  [PASS] CHAMPION_GAME_WIN_MIN_MEDIAN: measured 0.503, threshold >= 0.4
  [FAIL] LADDER_MONOTONE (win rate falls each league up): measured [0.597,0.529,0.557,0.516,0.486], threshold non-increasing
  [FAIL] LADDER_MONOTONE (within-league, weakest..strongest opponent): noisy per-team, see the tool's own table
  [FAIL] NUDGE_A_B (well-timed low-Power beats sloppy high-Power): measured [false,false,false,false,false], threshold true in every league
  [FAIL] CAP_BINDS_ONLY (little/highschool cap within seasons): measured ["1.0","2.6"], threshold <= 2 (highschool misses by 0.6 seasons)
  [PASS] CAP_BINDS_ONLY (college/minors/majors do NOT bind quickly): measured ["7.7","12.4","15.6"], threshold > 2
  [PASS] SKILL_EFFECT sensitivity (reported, not gated pre-retune): measured ["0.085","0.037","0.008","0.090","0.020"], threshold <= 0.08
```

**Read plainly, these are the open items for Matt**, not bugs to be silently patched:

1. **Gold is too rare at median skill.** A median-tier player's expected seasons to a first Gold
   trophy is ~4-5, not the doc's own ≤2 target, and the per-season Gold rate (~20-25%) is well
   under the ≥35% target. The lever tried (widening `CPU_LEVEL_SHORTFALL` up to 3x) moved this
   only modestly — the real bottleneck is COMPOUND probability: reaching the playoffs is easy
   (80-93% at median across leagues) but the championship is always against the single strongest
   CPU team, so winning a semifinal AND that championship in the same season is a much harder
   two-in-a-row than either single game. Loosening the two `GOLD_*` thresholds, or reworking how
   Gold is reached (e.g. a bye, or a weaker semifinal opponent), are both on the table — this tool
   does not choose between them.
2. **The "well-timed low-Power beats sloppy high-Power" promise (doc §8, [Locked]) currently
   FAILS in every league**, and by a wide margin — a Slugger swung with the WEAK tier's sloppy
   timing wins 84-96% of games against a Table Setter swung with the STRONG tier's precise timing.
   This is not a `settings.js` constant to retune: it is `swing.js`'s own contact-quality model
   (untouched by this phase, per the handoff's scope), where raw exit velocity currently dominates
   outcome far more than timing precision does. Flagged rather than "fixed" by inventing a
   settings knob that doesn't actually govern this trade-off.
3. **`CAP_BINDS_ONLY` misses at High School by 0.6 seasons** (2.6 measured against a 2.0
   threshold) — `POINTS.highschool` is untouched Draft from BB-1a/the doc's own worked example and
   was not in this phase's retune list; a median-tier player here simply earns fewer points per
   season (~21) than the doc's own hypothetical 9-3 season (27) implies, because the real CPU
   opposition (even after retuning) holds the win rate under what a 9-3 record needs.
4. **Within-league ordering is noisy team to team** (a `sluggers`-style CPU is reliably the
   hardest opponent in every league at every tier, sometimes harder than the schedule's own
   "weakest to strongest by style-generation order" would predict) — `TEAM_STYLES`' weight vectors
   (Open item 25) are still fully invented, and a proper reordering would need the SCHEDULE itself
   built from measured per-team difficulty rather than fixed alphabetical/generation order. Not
   attempted this phase.

### Every settings.js constant, by source (updated for Phase 2)

Everything Phase 1/BB-1a already sourced from the doc is unchanged (see the original table below,
kept for history). Phase 2 changes, restated: `FIELD` restructured per-league (still Draft, Open
item 7 — the doc leaves exact zone/fence sizes open); `FOUL_LINE_DEG`/`PARK_GEOMETRY`/`CARRY_SCALE`
pulled out as their own top-level constants (unchanged values, just relocated so every magic number
has one home — CLAUDE.md's own instruction); `SHIFT_WINDOW`/`SHIFT_MAX_DEG`/`WEAKSPOT_WINDOW` are
new Draft constants with no doc citation; `CPU`'s four new fields per league are Draft, measured;
`CPU_LEVEL_SHORTFALL`/`MECHANICS.doublePlayChance`/`SKILL_EFFECT.hitAcc.*`/`SKILL_EFFECT.hitPow.*`
are Draft, measured (old values in "What changed" above); `MECHANICS.sacFlyMinDepthFt` (180) and
`MECHANICS.groundEdgeMarginFt` (15) / `.beatOutPerPt` (0.02) are new Draft constants powering the
sac-fly depth check and the grounder beat-out roll, neither of which existed before this phase.

### Verification (Phase 2, in order)

```
node validate-sw-assets.mjs      # zones.js/season.js added to ASSETS; REST_MANIFEST/version.json for game-hub-v812
node baseball/js/test.js         # 1317 assertions, 0 failed
node sim-baseball.mjs --assert --quick   # FAILS - see the promise scoreboard above; this is the tool reporting, not a build break
node test-game-conventions.mjs   # 11 passed, 0 failed, no new known-gap entries
node validate-sw-assets.mjs      # re-run, unchanged
node test-sw-strategy.mjs        # 107 passed, 0 failed
```

**`sim-baseball.mjs --assert` fails on real, reported game-design findings, not on a broken
build.** Every other suite is green. The four open items above are Matt's to resolve; nothing in
this phase invents a passing number to paper over them.

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
| `teams.js` | `makeTeam(league, index)` — deterministic roster generation from a hashed seed (golf's `holegen.js` pattern: same seed in, byte-identical team out, nothing persisted); `effectiveCapFor(league)` = `CAPS[league] - CPU_LEVEL_SHORTFALL[league]` (doc §8, [Locked]: CPU teams are generated below the raw cap, never at it), `teamStrength()`. Phase 2: `makeLeague(league)` (the fixed 8-style league, weakest to strongest), `makePlayerTeam({skills,hand})` (nine clones of the one player); players carry `jersey`/`pos`, never a `name` (doc §9) |
| `zones.js` | Phase 2 (new): out-zone geometry (`zonesFor(league, shiftDeg)`, `angleSector`) - four infield ground-out sectors, three outfield fly-out sectors, scaled per league by `FIELD[league].outZoneMult`/`fieldScale`. Replaces `game.js`'s old `_defenseLevel01()` |
| `season.js` | Phase 2 (new): pure season/standings/playoff model - `makeSchedule`, `scriptedStandings`, `playoffs`, `trophyFor`. No `game.js` dependency; reusable by a later phase's real career loop |

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

Still invented, tagged Draft `[Open item N]` (my own numbering; the doc's own list stops at 15).
**Rows marked "SUPERSEDED, Phase 2" describe what shipped in BB-1a; see the Phase 2 section above
for what replaced them and the measured values now in place:**

| Constant(s) | Open item | What it's for |
|---|---|---|
| `PITCH_TRAVEL_MULT.screwball/eephus/cutter` | 9 | doc explicitly leaves these three open |
| `CPU.little/highschool/minors/majors` | 3 | SUPERSEDED, Phase 2 — was a copied placeholder of `college`'s tier; every league now carries its own `pitchMix`/`cornerBias`/`patternWeight`/`weakSpotWeight`, measured by `sim-baseball.mjs` |
| `CPU_LEVEL_SHORTFALL.*` | 3 | SUPERSEDED, Phase 2 — measured and retuned by `sim-baseball.mjs` (see above); still Draft |
| `PATTERN_WEIGHTS` | — | doc gives the exact array (`[0.5,0.3,0.2]`), tagged [Draft] by the doc itself |
| `FIELD.*`/`PARKS.*` | 7 | `FIELD` restructured per-league in Phase 2 (`zones.js`'s geometry, `outZoneMult`/`fieldScale`) — still Draft, doc §10 still leaves "exact zone sizes and fence distances per league" fully open; `PARKS` itself is unchanged |
| `TEAM_STYLES`/`TEAM_STYLE_WEIGHTS` weight VECTORS | 25 | the doc names the 8 styles but gives no numbers for them at all; Phase 2's "within-league ordering is noisy" open item traces back to this |
| `SKILL_EFFECT.*`/`SKILL_EFFECT_MAX_PER_POINT` | 4 | doc §6 explicitly leaves "how much each skill point changes each effect" open; `hitAcc`/`hitPow` retuned by `sim-baseball.mjs` in Phase 2 (see above), the rest still untouched |
| `MECHANICS.doublePlayChance` | 26 | SUPERSEDED, Phase 2 — measured by `sim-baseball.mjs` (0.45 → 0.40); doc still only locks that a double play CAN happen, not how often |
| `outcomes.js`'s `CARRY_SCALE` (carryFt) | 23 | calibrated so a 105mph/30deg swing carries ~400ft (a real, commonly-cited Statcast home-run swing); moved into settings.js in Phase 2, value unchanged |
| `outcomes.js`'s ground/line/fly hit-through and drop-chance base rates | 24 | SUPERSEDED, Phase 2 — the probabilistic through-chance/drop-chance model is gone; outs/hits are now decided by `zones.js`'s out-zone geometry instead |
| `_defenseLevel01()` in game.js | 7 | REMOVED, Phase 2 — replaced by `zones.js`'s real out-zone geometry (still Draft; see above) |
| `zones.js`'s `BASE_INFIELD_SECTORS`/`BASE_OUTFIELD_SECTORS` | 7 | new, Phase 2 — the actual invented sector geometry `outZoneMult`/`fieldScale` now scale; calibrated by hand against measured contact-carry distributions (median ~165-220ft for fly/line, ~20-40ft for grounders) rather than against anything real |
| `SHIFT_WINDOW`/`SHIFT_MAX_DEG` | — | new, Phase 2 — how many recent balls-in-play a "shifters" team averages, and how far it may rotate its zones toward the result |
| `MECHANICS.sacFlyMinDepthFt`/`.groundEdgeMarginFt`/`.beatOutPerPt` | — | new, Phase 2 — how deep a fly out must carry to be a sac fly, and the grounder beat-out roll (doc §6: "Batter Speed affects beating out grounders") |
| `WEAKSPOT_WINDOW` | — | new, Phase 2 — how many recent whiffs a `weakSpotWeight` CpuPitcher remembers before aiming at them |

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
