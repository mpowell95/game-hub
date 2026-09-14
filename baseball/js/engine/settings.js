// settings.js : every named constant the baseball engine plays by, in one pure, dependency-free
// module. No DOM, no storage, no network, no wall clock - a settings object is data, nothing else.
//
// SOURCE OF TRUTH: `docs/BASEBALL-DESIGN-DOC.md` ("Baseball Game Design Doc v8"), committed to
// this repo 2026-09-12 (BB-1a). Every value below that the doc gives directly is tagged with the
// doc's own status word ([Locked]/[Tested]/[Draft]) and its section number. Every value the doc
// does NOT give is tagged `// Draft [Open item N]` (my own numbering, continuing past the doc's
// own "17. Open items" list, which stops at 15) - still invented, not transcribed, and named as
// such in `baseball/CLAUDE.md`'s placeholder table. Do not re-invent a number that already has a
// [Locked]/[Tested]/[Draft] doc citation without reopening it with Matt first.
//
// RULES_V is this module's own schema version - bump it, and only it, when a shape below changes
// in a way old snapshots would misread (see game.js's validateSnapshot). Bumped 1 -> 2 for BB-1a:
// the five invented skill ids (contact/power/speed/arm/fielding) are replaced by the doc's real
// six (hitAcc/hitPow/hitSpd/pitchSpd/pitchAcc/pitchSpin) - an old snapshot's player skill objects
// would have the wrong keys entirely under the new shape. Bumped 2 -> 3 for phase 2 Step 3: a
// team's player objects drop `name` and gain `jersey`/`pos` (doc §9, [Locked]: "shown by jersey
// number and position... No names") - an old snapshot's roster would carry a field the UI no
// longer reads and be missing two it needs.

export const RULES_V = 3;

// ---------------------------------------------------------------------------------------------
// Leagues (frozen: baseball/CLAUDE.md's ladder order and BB_LEAGUE_MIN/MAX in js/game-stats.js;
// also doc section 4's ladder - little/highschool/college/minors/majors, [Locked]).
export const LEAGUES = ['little', 'highschool', 'college', 'minors', 'majors'];

// ---------------------------------------------------------------------------------------------
// Season/career shape (doc section 4).
export const SEASON = {
  gamesPerSeason: 12,       // [Draft] doc §4 - "12 regular season games per league across 8 opponents"
  inningsPerGame: 3,        // [Locked] doc §3 - "3 innings" (was invented at 6 in phase 1; corrected)
  cpuTeamsPerLeague: 8,     // [Locked] doc §4/§9 - "8 CPU teams per league"
  leagueSize: 9,            // [Locked] doc §4 - you + 8 CPU teams; "Top 4 of 9 make the playoffs"
  playoffTeams: 4,          // [Locked] doc §4 - "Top 4 of 9 make the playoffs"
  playoffRounds: ['semifinal', 'championship'], // [Locked] doc §4 - no quarterfinal, dropped by name
};

// ---------------------------------------------------------------------------------------------
// Points earned per Career result, by league (doc section 7). NOT a team-generation budget (that
// concept moved to CAPS/CPU_LEVEL_SHORTFALL below) - this is what a WIN/LOSS/trophy pays toward
// the player's own skill points. Not consumed by this phase's engine (no career/progression layer
// exists yet); kept here so a later phase has one source rather than re-deriving the doc's table.
export const POINTS = {                 // [Draft] doc §7 - "numbers, to tune after playtesting"
  little:     { win: 3, loss: 1, bronze: 3, silver: 5, gold: 8 },
  highschool: { win: 2, loss: 1, bronze: 2, silver: 4, gold: 6 },
  college:    { win: 1, loss: 0, bronze: 2, silver: 4, gold: 6 },
  minors:     { win: 1, loss: 0, bronze: 1, silver: 2, gold: 4 },
  majors:     { win: 1, loss: 0, bronze: 1, silver: 2, gold: 3 },
};
// [Locked] doc §7: playoff wins pay no per-win points; the trophy bonus is the entire playoff
// reward. [Locked]: points past a league's CAPS are lost - no banking. [Locked]: you can only
// earn points in your current league.

// ---------------------------------------------------------------------------------------------
// Per-skill point caps, by league (doc section 6). [Draft] - "was +5/league to 30, lowered because
// at Majors point rates the top caps were unreachable and therefore meaningless."
export const CAPS = {
  little: 10,
  highschool: 14,
  college: 18,
  minors: 22,
  majors: 26,
};

export const START_POINTS_PER_SIDE = 15;  // [Locked] doc §6 - "15 points in hitting and 15 in pitching"
export const START_CAP = 10;              // [Locked] doc §6 - "Cap of 10 per skill" at the start

// The six real skills (doc §6), replacing phase 1's invented five (contact/power/speed/arm/
// fielding - there is no "fielding" skill in the real design; defense is out-zone geometry, not a
// player stat, see FIELD/PARKS below and outcomes.js). Rejected labels per the doc: Contact, Break.
export const HIT_SKILL_IDS = ['hitAcc', 'hitPow', 'hitSpd'];
export const PITCH_SKILL_IDS = ['pitchSpd', 'pitchAcc', 'pitchSpin'];
export const SKILL_IDS = [...HIT_SKILL_IDS, ...PITCH_SKILL_IDS];

// A build preset: a ready-made point allocation for a player who does not want to hand-tune one.
// [Draft] doc §6 - every row sums to 15 per side with nothing over 10 (asserted in test.js).
export const PRESETS = {
  twoWayStar:  { hitAcc: 5, hitPow: 5, hitSpd: 5, pitchSpd: 5,  pitchAcc: 5, pitchSpin: 5 },
  tableSetter: { hitAcc: 8, hitPow: 2, hitSpd: 5, pitchSpd: 5,  pitchAcc: 6, pitchSpin: 4 },
  slugger:     { hitAcc: 3, hitPow: 10, hitSpd: 2, pitchSpd: 7, pitchAcc: 4, pitchSpin: 4 },
  speedster:   { hitAcc: 6, hitPow: 1, hitSpd: 8, pitchSpd: 5,  pitchAcc: 5, pitchSpin: 5 },
  flamethrower:{ hitAcc: 4, hitPow: 7, hitSpd: 4, pitchSpd: 10, pitchAcc: 3, pitchSpin: 2 },
  junkballer:  { hitAcc: 7, hitPow: 3, hitSpd: 5, pitchSpd: 2,  pitchAcc: 5, pitchSpin: 8 },
  painter:     { hitAcc: 6, hitPow: 4, hitSpd: 5, pitchSpd: 4,  pitchAcc: 9, pitchSpin: 2 },
};

// ---------------------------------------------------------------------------------------------
// Pitching: which types exist, when they unlock, how they travel.
//
// [Locked] doc §11: curve/slider break AWAY from the pitcher's throwing arm; screwball breaks the
// OTHER way. The player controls how much and when to steer a break, never which way - a phase 3
// UI mechanic (a hold-and-drag input) this headless phase does not model at all: no agent this
// phase steers a pitch, so no break-magnitude number is invented for one. flyPitch() only models
// travel time and aim scatter (below); see baseball/CLAUDE.md for what phase 3 must add.
export const PITCH_TYPES = ['fastball', 'changeup', 'curveball', 'slider', 'knuckleball', 'screwball', 'eephus', 'cutter'];

// Cumulative per-league unlock (doc §11, [Locked]). `unlockedPitchesFor` below folds in the two
// title-gated pitches, which are NOT a function of league at all.
const LEAGUE_UNLOCK_ADDS = {
  little: ['fastball', 'changeup'],
  highschool: ['curveball'],
  college: ['slider'],
  minors: ['knuckleball'],
  majors: ['screwball'],
};
export const PITCH_UNLOCKS = (() => {
  const out = {};
  let running = [];
  for (const lg of LEAGUES) {
    running = running.concat(LEAGUE_UNLOCK_ADDS[lg]);
    out[lg] = running.slice();
  }
  return out;
})();

// [Locked] doc §11: eephus unlocks on the first World Series title, cutter on the second.
export const TITLE_PITCH_UNLOCKS = [
  { titles: 1, pitch: 'eephus' },
  { titles: 2, pitch: 'cutter' },
];

/** Every pitch type unlocked for a league, plus whatever `wsTitles` titles have unlocked. Titles
 *  are a career-progress fact no CPU team ever carries (CPU rosters are fixed, doc §8), so CPU
 *  agents always call this with `wsTitles` omitted/0. */
export function unlockedPitchesFor(league, wsTitles = 0) {
  const list = (PITCH_UNLOCKS[league] || PITCH_UNLOCKS.majors).slice();
  for (const t of TITLE_PITCH_UNLOCKS) if (wsTitles >= t.titles) list.push(t.pitch);
  return list;
}

// Travel time as a multiple of the fastball (doc §14's "Pitch travel time as a multiple of the
// fastball" table). [Tested] for the four the prototype actually threw; [Draft, Open item 9] for
// the three the doc explicitly leaves open ("Screwball, Eephus, and Cutter movement and speed").
export const PITCH_TRAVEL_MULT = {
  fastball: 1.0,        // [Tested] doc §14 - baseline
  changeup: 1.4,         // [Tested] doc §14
  curveball: 1.3,        // [Tested] doc §14
  slider: 1.1,           // [Tested] doc §14
  knuckleball: 1.45,     // [Tested] doc §14
  screwball: 1.2,        // Draft [Open item 9] - doc leaves this open; invented, not measured
  eephus: 1.9,           // Draft [Open item 9] - a very slow "junk" pitch by name; invented
  cutter: 1.05,          // Draft [Open item 9] - a fast pitch by name; invented
};

// The mph readout by league (doc §11/§14) - DISPLAY ONLY. "How fast the ball actually travels is
// a separate tuned value" (PITCH_TRAVEL_MULT x FEEL.engine.fastballMs); nothing in the engine
// reads READOUT for physics. [Draft] doc §11 (fastball values based on published averages; "off-
// speed values are estimates"). Screwball/eephus/cutter have no readout row - doc Open item 9.
export const READOUT = {
  little:     { scale: 0.58, fastball: 55, changeup: 50, curveball: 46, slider: 50, knuckleball: 44 },
  highschool: { scale: 0.84, fastball: 80, changeup: 72, curveball: 67, slider: 73, knuckleball: 64 },
  college:    { scale: 0.93, fastball: 88, changeup: 80, curveball: 74, slider: 81, knuckleball: 71 },
  minors:     { scale: 0.98, fastball: 93, changeup: 84, curveball: 78, slider: 85, knuckleball: 74 },
  majors:     { scale: 1.00, fastball: 95, changeup: 86, curveball: 80, slider: 87, knuckleball: 76 },
};

// ---------------------------------------------------------------------------------------------
// FEEL: timing constants. `engine` is consumed by the simulation itself; `ui` is reserved for a
// future rendering phase and consumed by nothing here - both groupings and every value in them
// are the doc's own prototype-tuned numbers (section 14), [Tested], carried over verbatim.
export const FEEL = {
  engine: {
    dtS: 1 / 120,           // fixed timestep, seconds - matches Golf/Hill Climb (doc §15's own units note)
    maxSteps: 5,            // catch-up cap per advance() call: never spiral on a slow/batched tick
    fastballMs: 1500,       // [Tested] doc §14 - fastball travel time; every other pitch is this x PITCH_TRAVEL_MULT
    timingWindow: 100,      // [Tested] doc §14 - good-contact timing window, ms
    foulMult: 1.7,          // [Tested] doc §14 - foul margin, x timingWindow
    swingDelay: 60,         // [Tested] doc §14 - swing start delay, ms
    sweetSpot: 0.28,        // [Tested] doc §14 - sweet spot size, fraction of plate half-width
    batReach: 0.8,          // [Tested] doc §14 - bat reach
    chargeTime: 300,        // [Tested] doc §14 - hold needed to charge a swing, ms
    chargeWindowMult: 0.6,  // [Tested] doc §14 - charged swing timing window, x
    chargePower: 1.22,      // [Tested] doc §14 - charged swing power, x
    meterTime: 1100,        // [Tested] doc §14 - pitch meter fill time, ms (UI concept; not consumed headless)
    niceWidth: 0.12,        // [Tested] doc §14 - Nice zone width
    niceBoost: 1.06,        // [Tested] doc §14 - Nice pitch speed, x
    niceBreak: 1.3,         // [Tested] doc §14 - Nice pitch bend, x
    aimScatter: 0.12,       // [Tested] doc §14 - normal pitch miss from aim, fraction of plate half-width

    // ---- Contact-quality axis (BB-2a, 2026-09-12) -------------------------------------------
    // Draft, new. Fixes the mechanism the BB-2 handoff diagnosed: `absTiming` used to decide only
    // miss/foul/contact and then never appear again, so a swing 3ms off and one 99ms off (inside a
    // 100ms window) produced identical exit velocity - "Perfect" did not exist as a continuous
    // quantity. `q` (computed in swing.js) is 1 inside `perfectMs` of dead-on timing, falling
    // linearly to 0 at the timing window's own edge; exit velocity and launch angle both read it.
    perfectMs: 25,          // Draft, BB-2a - the "Perfect" band width (doc §12's popup wording)
    qualityFloor: 0.55,     // Draft, BB-2a - exit-velocity share kept by a swing barely inside the window (q=0); power contributes nothing at all here, only at q>0
    lineDriveCenterDeg: 20, // Draft, BB-2a - center of a CENTERED swing's launch-angle band
    lineDriveSpreadMinDeg: 8,  // Draft, BB-2a - launch-angle spread at q=1 (a tight, true line-drive band)
    lineDriveSpreadMaxDeg: 30, // Draft, BB-2a - launch-angle spread at q=0 (widens toward topped/popped)
    pullMaxDeg: 40,          // Draft, BB-2a - the largest pull/opposite-field spray a sloppy-timed (q near 0) swing can produce
    perfectSprayDeg: 22,     // Draft, BB-2a - where a perfectly-timed (q=1) swing centers its spray: one of the two GAPS (left or right of straightaway), never dead center - a squared-up ball is not aimed at the deepest part of the park nor at a fielder standing in it
    perfectSpraySpreadDeg: 8, // Draft, BB-2a - how narrow the q=1 spray band is around whichever gap it picked
  },
  ui: {
    betweenMs: 3000,        // [Tested] doc §14 - pause between pitches
    windupMs: 1400,         // [Tested] doc §14 - CPU pitcher windup
    resultMs: 1800,         // [Tested] doc §14 - how long a hit result shows
    inputOffset: 0,         // [Tested] doc §14 - input lag offset
  },
};

// Out-zone/field size multipliers (doc §14's outZoneMult/fieldScale). [Tested] as a flat baseline;
// the actual PER-LEAGUE escalation ("fields get bigger each league... out zones also grow", doc
// §10) is Open item 7 - see FIELD/PARKS below, which still carry phase 1's invented per-park
// distances untouched, tagged with that same open item per BB-1a's instruction to tag rather than
// rebuild them.
export const FIELD_SCALE = { outZoneMult: 1.0, fieldScale: 1.0 }; // [Tested] doc §14 baseline

// ---------------------------------------------------------------------------------------------
// CPU: per-league AI parameters (doc sections 8 and 14). The prototype only ever tuned ONE tier -
// copied here to all five leagues as an explicit placeholder, per BB-1a's own instruction, tagged
// [Open item 3] except at `college`, which IS the prototype's own tested tier.
// Step 2 (phase 2): doc §8's per-league behavior ladder, actually spread across the five leagues -
// phase 1/BB-1a only ever tuned ONE tier (`college`) and copied it everywhere else as an explicit
// placeholder. Every row below is Draft, measured/retuned by `sim-baseball.mjs` (Open item 3);
// `college`'s five original fields keep the prototype's own [Tested] values as their starting
// point, the four new per-league behavior fields (`pitchMix`, `cornerBias`, `patternWeight`,
// `weakSpotWeight`) are new this phase.
//
//   pitchMix        - relative weight per PITCH_TYPES entry (only the league's currently-unlocked
//                      types are ever drawn; `pickWeighted` normalizes). Doc §8, [Locked]:
//                      "Little League: mostly fastballs down the middle... each league up mixes
//                      pitches more."
//   cornerBias       - 0..1, how often/far a CpuPitcher's aim leaves the middle of the zone. Doc
//                      §8, [Locked]: "works the corners more" each league up.
//   patternWeight    - 0..1, how strongly `view.pitchHistory` (doc §8's last-3-pitches memory,
//                      PATTERN_WINDOW/PATTERN_WEIGHTS above) shifts a CpuBatter's timing AND aim
//                      read. Doc §8, [Locked]: "The window is the same in every league; how
//                      strongly it is used scales by league."
//   weakSpotWeight   - 0..1, how often a CpuPitcher aims at this batter's own recently-weak zone
//                      (WEAKSPOT_WINDOW below) instead of drawing an ordinary aim. Doc §8,
//                      [Locked]: "Majors: attacks your weak spots."
// BB-2c commit 2: `placementNoise` is new - the CpuBatter base bat-placement scatter, split OUT of
// the old `readNoise = (1 - guess) * 0.3` formula (see `CPU_PLACEMENT_MIN`/`guess`'s own note
// below for why). Every value here is at or above `CPU_PLACEMENT_MIN` (0.22, the median human's
// own placement noise) - College/Minors/Majors are pinned exactly at the floor (their old
// guess-derived values, 0.21/0.165/0.12, were all BELOW a median human's own placement precision);
// Little/High School keep their old guess-derived values (0.27/0.24) since those already sat above
// the floor on their own.
// BB-2c commit 5 retune: per-league `cornerBias`/`patternWeight` nudged, the first lever in the
// handoff's specified order, to close the `SEASON_WINRATE_BAND` gaps `--assert --quick` measured
// after commit 2-4's contract/flavor/schedule work landed (Little too easy overall at 0.833
// against a [0.92,0.98] target; College/Minors/Majors too easy at 0.675/0.633/0.575 against
// [0.57,0.67]/[0.49,0.59]/[0.41,0.51]): little cornerBias 0.08 -> 0.05, patternWeight 0.04 -> 0.02
// (less corner-aim/pattern-reading toughness, matching a season that should be nearly automatic);
// college cornerBias 0.33 -> 0.38, patternWeight 0.23 -> 0.27; minors cornerBias 0.50 -> 0.55,
// patternWeight 0.42 -> 0.47; majors cornerBias 0.68 -> 0.72, patternWeight 0.65 -> 0.70 (more of
// both, since the upper three leagues were all measuring an easier season than the band allows).
export const CPU = {
  little:     { timingSigmaMs: 115, placementNoise: 0.27, swingIn: 0.30, chase: 0.55, fool: 0.45, guess: 0.10,
    pitchMix: { fastball: 6, changeup: 1 }, cornerBias: 0.05, patternWeight: 0.02, weakSpotWeight: 0 },
  highschool: { timingSigmaMs: 95, placementNoise: 0.24, swingIn: 0.50, chase: 0.40, fool: 0.35, guess: 0.20,
    pitchMix: { fastball: 3, changeup: 2, curveball: 2 }, cornerBias: 0.20, patternWeight: 0.13, weakSpotWeight: 0 },
  college:    { timingSigmaMs: 80, placementNoise: 0.22, swingIn: 0.78, chase: 0.28, fool: 0.25, guess: 0.30,   // BB-2c commit 2: timingSigmaMs 65 -> 80 (CPU_SIGMA_MIN_MS.college); placementNoise floored at CPU_PLACEMENT_MIN (was 0.21 under the old guess-derived formula)
    pitchMix: { fastball: 2, changeup: 2, curveball: 2, slider: 2 }, cornerBias: 0.38, patternWeight: 0.27, weakSpotWeight: 0.06 },
  minors:     { timingSigmaMs: 70, placementNoise: 0.22, swingIn: 0.72, chase: 0.14, fool: 0.18, guess: 0.45,   // BB-2c commit 2: timingSigmaMs 60 -> 70 (CPU_SIGMA_MIN_MS.minors); placementNoise floored (was 0.165)
    pitchMix: { fastball: 2, changeup: 2, curveball: 2, slider: 2, knuckleball: 1.5 }, cornerBias: 0.55, patternWeight: 0.47, weakSpotWeight: 0.28 },
  majors:     { timingSigmaMs: 58, placementNoise: 0.22, swingIn: 1.00, chase: 0.02, fool: 0.10, guess: 0.20,   // BB-2d commit 7 retune: swingIn 0.65 -> 1.00, guess 0.60 -> 0.20 (measured - see baseball/CLAUDE.md); timingSigmaMs unchanged at the absolute floor (58)
    // Only the six pitches a CPU roster (never title-gated, doc §8: "CPU stats do not track or
    // react to your stats") actually has unlocked at Majors with 0 titles - eephus/cutter would
    // sit in this table forever unused, since `unlockedPitchesFor('majors', 0)` never grants them.
    pitchMix: { fastball: 1.5, changeup: 1.5, curveball: 1.5, slider: 1.5, knuckleball: 1.5, screwball: 1.5 },
    cornerBias: 0.72, patternWeight: 0.70, weakSpotWeight: 0.65 },
};
// BB-2c commit 2, doc §8, [Locked] (design doc v9): "CPU batters may never time or place better
// than a median human, in any league or any slot." `guess` (0.10..0.60 by league) no longer feeds
// `placementNoise` at all - it now drives ONLY how far a CpuBatter's aim leans toward its own
// `locationLean` read (see `CpuBatter.decideSwing` in agents.js), which is a PATTERN-READING skill
// (doc §8: "how much CPU leans to your recent spot"), not a placement-precision one. `guess`
// pushing the bat's own BASE precision below a human's was Lever Two of BB-2c's own diagnosis.
// [Locked] doc §8: each league up mixes pitches more, works corners more, chases less, reads
// patterns better; Majors rarely chases and attacks weak spots. Every number above is Draft,
// measured by `sim-baseball.mjs` (Open item 3).

// How many of a batter's own recent swing-and-miss pitch locations a "weak spot" CpuPitcher
// (weakSpotWeight above) remembers, before aiming there. Draft, new (not in the doc's own
// numbered open-items list) - a window rather than a single running average, same shape as
// PATTERN_WINDOW, so a batter who has recently improved at a spot is not haunted by it forever.
export const WEAKSPOT_WINDOW = 8;

// How far a CPU roster is generated below its league's raw CAPS (doc §8: "generated at the cap
// minus shortfall, not at the raw cap... difficulty comes from behavior, not bigger stats").
// PER-SKILL, cumulative league to league. Draft [Open item 3] - for the phase 2 simulator to
// verify. (The BB-1a handoff's first pass at this table - {little:0, highschool:0, college:9,
// minors:11, majors:12} - was a TOTAL across all six skills, not a per-skill number, and did not
// accumulate league to league: it produced a non-monotonic effective-cap ladder (10, 14, 9, 11,
// 14), where College's CPU teams were generated WEAKER than Little League's despite the ladder
// being harder each league up (doc §8, [Locked]). Corrected here to the per-skill, cumulative
// values below, which resolve to a strictly rising effective-cap ladder - see
// `effectiveCapFor`/section 8's test in test.js, which now asserts that directly so this cannot
// regress silently.)
//
// Reverted 2026-09-12 (BB-2a, step 1): {little:0, highschool:0, college:3, minors:6, majors:9}
// (effective caps 10/14/15/16/17) back to {little:0, highschool:0, college:1.5, minors:3.3,
// majors:5.3} (effective caps 10/14/16.5/18.7/20.7), pending the contact-model fix.
//
// BB-2a step 6 retune: back to {college:3, minors:6, majors:9} (effective caps 10/14/15/16/17) -
// measured against the NEW contact model with `sim-baseball.mjs --quick`. Widening this further
// (tried up to {college:5, minors:10, majors:15} and beyond) moved median-tier Gold odds only
// marginally and, at Minors/Majors, made the regular-season top4 rate WORSE, not better - the real
// bottleneck (confirmed under the new contact model, matching phase 2's own finding) is COMPOUND
// probability: `makeSchedule`'s 12-game season already plays the top HALF of the ladder (styles at
// slots 4-7) TWICE, so even a materially weaker CPU roster does not move the player's regular-
// season record much, and Gold additionally needs winning both a semifinal AND a championship
// against the single strongest team in the same season. GOLD_SEASONS_MAX_MEDIAN and
// GOLD_ONE_SEASON_MIN_MEDIAN still FAIL at College/Minors/Majors after this retune - see the
// pasted scoreboard below. Open item for Matt, unchanged from phase 2: loosen the two GOLD_*
// thresholds, or rework how Gold is reached (a bye, a weaker semifinal opponent, a shorter top-half
// repeat in the schedule) - this tool does not choose between them, and POINTS/SEASON are outside
// this phase's scope to retune on its own judgement.
//
// BB-2f commit 2, doc v11 §8, [Locked]: "every league's CPU teams are generated below that
// league's cap... no league may generate every team at the cap." `little`/`highschool` were the
// only two leagues still at 0 - BB-2e's own report measured WHY that mattered: with zero shortfall,
// `effectiveCapFor` equals the raw CAPS value, so the champion's own `+0.25` skill offset clamps to
// the exact same ceiling every other team in the league already sits at - the whole ladder there is
// forced to be behavior-only, and BB-2e independently exhausted three separate behavior axes
// (timing sigma, chase, behaviorMul) trying to widen the champion band without ever moving it.
// Draft placeholder values below (little:1, highschool:1 - the smallest nonzero shortfall, ~10%/7%
// of each league's own small cap) give the champion generation room to exceed its league mates for
// the first time; commit 3 measures whether they are enough and retunes them if not.
export const CPU_LEVEL_SHORTFALL = { little: 1, highschool: 1, college: 3, minors: 4, majors: 4 };

// ---------------------------------------------------------------------------------------------
// Pattern memory (doc §8's "CPU batters read your patterns"): the last N pitches to one batter,
// newest weighted most. [Locked] window; [Draft] weights.
export const PATTERN_WINDOW = 3;                    // [Locked] doc §8 - "the last 3 pitches"
export const PATTERN_WEIGHTS = [0.5, 0.3, 0.2];     // [Draft] doc §8, newest first, length === PATTERN_WINDOW

// ---------------------------------------------------------------------------------------------
// Field geometry, in feet (doc §15's units note), home plate at the origin, center field along +y.
// FOUL_LINE_DEG and PARK_GEOMETRY are league-independent facts about the diamond itself.
export const FOUL_LINE_DEG = 45; // each foul line sits 45 degrees off the center-field axis
export const PARK_GEOMETRY = { basePathFt: 90, pitcherDistFt: 60.5, infieldDirtRadiusFt: 95 };

// Per-league field/defense geometry (doc §10, phase 2 - replaces phase 1's single invented
// FIELD.outfieldWallFt and game.js's `_defenseLevel01()` league-ordered ramp). Still entirely
// INVENTED - doc §10 explicitly leaves "exact zone sizes and fence distances per league" open
// (Open item 7) - but now expressed as real geometry `zones.js` consumes, growing per league per
// the doc's own "fields get bigger each league... out zones also grow" (§10, [Locked] that both
// grow, Open item 7 for the exact numbers). `fenceFt` is the five-point named-distance shape
// (left/left-center/center/right-center/right) `outcomes.js`'s `fenceFtAt` interpolates across;
// `outZoneMult` scales how far a fielder's sector reaches (bigger league = better fielders =
// smaller "through the infield" gaps, so groundouts/flyouts get a LARGER reach - see zones.js);
// `fieldScale` scales the whole field (used to grow named PARKS distances too, in game.js's
// `_parkFt()`, so a named ballpark still means something at every league).
// `outZoneMult` scales a sector's COVERAGE DEPTH (zones.js), not its whole reach - kept in a
// narrow band (0.75-1.05) on purpose: compounding it with `fieldScale` onto the sector's outer
// edge directly, tried first, put a majors outfielder's reach past that league's own fence.
export const FIELD = {                      // Draft [Open item 7]
  little:     { fenceFt: { left: 180, leftCenter: 195, center: 210, rightCenter: 195, right: 180 }, outZoneMult: 0.75, fieldScale: 0.60 },
  highschool: { fenceFt: { left: 300, leftCenter: 330, center: 360, rightCenter: 330, right: 300 }, outZoneMult: 0.85, fieldScale: 0.85 },
  college:    { fenceFt: { left: 330, leftCenter: 365, center: 400, rightCenter: 365, right: 330 }, outZoneMult: 0.95, fieldScale: 1.00 },
  minors:     { fenceFt: { left: 335, leftCenter: 370, center: 405, rightCenter: 370, right: 335 }, outZoneMult: 1.00, fieldScale: 1.05 },
  // BB-2a step 8 [KNOWN-BUG PROBE]: majors' left/center/right were each SMALLER than minors'
  // (330/400/330 vs minors' 335/405/335) - a real pre-existing inconsistency with doc §10,
  // [Locked] ("Fields get bigger each league"), caught by test.js section 15's new fenceFtAt(0)
  // monotonicity check rather than by inspection. Corrected here to strictly exceed minors' in
  // every named point; still Draft [Open item 7] (exact distances remain fully invented).
  majors:     { fenceFt: { left: 337, leftCenter: 378, center: 408, rightCenter: 378, right: 337 }, outZoneMult: 1.05, fieldScale: 1.10 },
};

// How wide the fair-territory pattern-memory/shift window is, and how far a "shifters" team may
// rotate its out-zone sectors toward a batter's own spray tendency (doc §9, [Locked]: "some teams
// shift their out zones toward where you tend to hit" - SHIFTERS_ADJUST_OUT_ZONES below names the
// rule; these two numbers are how much, Draft, new (not in the doc's own open-items list).
export const SHIFT_WINDOW = 10;   // Draft - last N balls in play, per batter, averaged for the shift
// BB-2d commit 6: SHIFT_MAX_DEG halved from 15 to HALF OF GAP_DEG (computed relationally, never a
// second hand-typed number that could drift from it) - commit 1's own `--range` measurement found
// Shifters a large, real drag on the player's win rate at every league (median tier: -13.6pp at
// Little League down to -28.0pp at Majors, delta = shiftersRate - balancedRate), and the shift
// itself (not just STYLE_STRENGTH_DELTA under-compensating for it) was the largest single
// contributor - the `noShift` control measured 3.7-15.3pp of that same gap disappearing outright
// when SHIFT_MAX_DEG was forced to 0. Bounding it to at most half of GAP_DEG (the dead-zone width
// between adjacent sectors) keeps a shift from ever fully closing one gap while opening a new one
// the same size on the other side - a real, bounded nudge toward the batter's own tendency,
// never a full sector reassignment.
// (GAP_DEG itself is declared further down this file, after the BB-2b commit 3 mechanisms it
// belongs with - hardcoded here as GAP_DEG's own value / 2 to avoid a forward reference, with a
// test.js assertion pinning the two numbers together so they cannot silently drift apart.)
export const SHIFT_MAX_DEG = 3;
// BB-2d commit 6: a shift needs at least this many balls in play on file before it applies at all -
// before this commit, `game.js`'s `_shiftDegFor` fired off a SINGLE ball in play (`hist.length`
// checked only against 0), so the very first ball a batter ever hit could already trigger a shift
// off one data point - not "where you tend to hit," just where you hit once. Matches this
// mechanism's own intent (a TENDENCY, not a fluke).
export const SHIFT_MIN_SAMPLES = 5;

// Named ballparks (doc §10's "Majors parks" - fictional names, shapes inspired by famous parks;
// [Locked] that they exist and are wind/weather-free; [Open] which park FEATURES make v1). The
// actual wall distances below are still invented placeholders (Open item 7), not the doc's eight
// named parks (Boston/New York/Chicago/San Francisco/Houston/Detroit/Denver/Los Angeles) - that
// full roster is Open item 11 ("park features for version 1 vs later") and Open item 7 together,
// and belongs to whichever phase actually builds the park list.
export const PARKS = {                      // Draft [Open item 7]
  default:  { left: 330, center: 400, right: 330 },
  bandbox:  { left: 302, center: 375, right: 302 },
  canyon:   { left: 355, center: 430, right: 355 },
  asymmetric: { left: 315, center: 410, right: 340 },
};

// ---------------------------------------------------------------------------------------------
// Team generation styles (doc §9's named 8: Sluggers, Small Ball, Patient, Flamethrowers,
// Junkballers, Shifters, Balanced, Aces - [Locked] as names). The doc names the styles but never
// gives their skill-weight numbers, so the weights below are still invented - Draft [Open item 25]
// (a new item; the doc's own numbered open-items list stops at 15 and never reaches this one).
//
// BB-2a step 5 (2026-09-12): these are FLAVOR vectors now, not strength - measured and retuned by
// `sim-baseball.mjs --styles --tune` (CPU-vs-CPU, real Game, real CpuPitcher/CpuBatter on both
// sides, each style against `balanced` at the same league) so every style's win rate lands within
// STYLE_STRENGTH_BAND of 0.50 at the SAME effectiveCap. Phase 2's "the within-league ordering is
// noisy team to team - a sluggers-style CPU is reliably the hardest opponent" traced here: a
// spiky weight vector loses more to `allocateSkills`' integer clamp at the cap than a flat one, so
// two styles with the same MEAN weight (already normalized by `allocateSkills`) were not actually
// the same overall strength. The tuner compresses/expands each vector toward/away from all-1s by a
// single factor `s` (preserving its relative shape - which skills it favors) and keeps the largest
// `s` that still lands in-band, so a style keeps as much of its named emphasis as the measured
// numbers allow. `patient` and `shifters` compress hardest (s=0.5 and s=1.0-ish beyond only
// pitchAcc) because their doc-given identity is a BEHAVIOR, not a skill shape - see
// STYLE_BEHAVIOR below, which is where the rest of their flavor actually lives.
// Measured: sluggers 53.3%, smallBall 46.8%, patient 53.8%, flamethrowers 46.4%, junkballers
// 46.0%, shifters 51.3%, aces 46.3% (college, 3000 games each) - every style within +/-4pp of 50%.
export const TEAM_STYLES = {                          // Draft [Open item 25], measured 2026-09-12
  sluggers:      { hitAcc: 0.61, hitPow: 2.04, hitSpd: 0.48, pitchSpd: 1.00, pitchAcc: 0.87, pitchSpin: 0.87 },
  smallBall:     { hitAcc: 1.39, hitPow: 0.35, hitSpd: 1.78, pitchSpd: 0.87, pitchAcc: 1.00, pitchSpin: 0.87 },
  patient:       { hitAcc: 1.30, hitPow: 0.95, hitSpd: 0.95, pitchSpd: 0.95, pitchAcc: 1.00, pitchSpin: 0.95 },
  flamethrowers: { hitAcc: 0.92, hitPow: 0.92, hitSpd: 0.92, pitchSpd: 1.64, pitchAcc: 0.84, pitchSpin: 0.76 },
  junkballers:   { hitAcc: 0.91, hitPow: 0.82, hitSpd: 0.91, pitchSpd: 0.64, pitchAcc: 1.00, pitchSpin: 1.72 },
  shifters:      { hitAcc: 1.00, hitPow: 1.00, hitSpd: 1.00, pitchSpd: 1.00, pitchAcc: 1.26, pitchSpin: 1.00 },
  balanced:      { hitAcc: 1.00, hitPow: 1.00, hitSpd: 1.00, pitchSpd: 1.00, pitchAcc: 1.00, pitchSpin: 1.00 },
  aces:          { hitAcc: 0.93, hitPow: 0.93, hitSpd: 0.86, pitchSpd: 1.28, pitchAcc: 1.35, pitchSpin: 1.07 },
};
// "Shifters" also names a BEHAVIOR the doc locks - "some teams shift their out zones toward where
// you tend to hit" (doc §9). Consumed by game.js's `_shiftDegFor` via STYLE_BEHAVIOR.shift below
// (BB-2a step 5 - previously a hardcoded `styleId === 'shifters'` string check in game.js itself).
export const SHIFTERS_ADJUST_OUT_ZONES = true; // [Locked] doc §9

// BB-2a step 5 (2026-09-12): Patient and Shifters are BEHAVIORS the doc names (doc §9's "some
// teams shift their out zones"; doc §8's own CPU-batter chase-rate mechanic, applied here as one
// team's personality rather than a whole league's), not skill shapes - their TEAM_STYLES vectors
// above are compressed nearly to `balanced` on purpose, because their actual identity lives here.
// Draft, new. `chaseMul` multiplies a CpuBatter's own league `chase` rate (agents.js); `shift`
// enables the out-zone rotation `_shiftDegFor` already computed per batter spray history.
export const STYLE_BEHAVIOR = {
  patient: { chaseMul: 0.55 }, // lays off bad pitches noticeably more than its league's own baseline
  shifters: { shift: true },
};

// BB-2c commit 3: the flavor STRENGTH BUDGET. `--styles` measures each style's own win rate
// against `balanced` at a fixed middle slot (`effectiveCapFor(league)`, the same cap `makeLeague`'s
// own zero-offset slot 4 uses) with its full behavior on (STYLE_BEHAVIOR reads styleId regardless
// of ladder slot, so Shifters' shift and Patient's chaseMul are both live in this measurement, not
// just its skill weights). `delta = winRate - 0.5` is the style's own measured strength beyond what
// its TEAM_STYLES vector alone predicts - `teams.js`'s `makeLeague` now subtracts it from that
// style's own ladder-slot skill budget, so a flavor's behavior no longer has to be "paid for" by
// hand-picking which slot it occupies. Shifters measured furthest out (+0.072, [OUT OF BAND] on
// `STYLE_STRENGTH_BAND`) - its shift is a real, uncompressed edge; Shifters KEEPS its slot and its
// shift per Matt's confirmed `LEAGUE_LADDER_STYLES` order, and this delta is what pays for it
// instead. Draft, first measured 2026-09-13 (`node sim-baseball.mjs --styles`, league=college,
// games=3000 - the same default `STYLE_MEASURE_LEAGUE`/`STYLE_MEASURE_GAMES` BB-2a's own style
// tuning used). BB-2c commit 5 retune: re-measured after this commit's `CPU`/`TEAM_LADDER_OFFSETS`
// changes (delta is a measurement of the CURRENT settings, not a fixed constant, so it goes stale
// the moment the behavior it corrects for changes) - sluggers 0.0203 -> 0.0010, smallBall -0.0230
// -> -0.0333, patient 0.0133 -> 0.0160, flamethrowers -0.0047 -> -0.0070, junkballers -0.0143 ->
// -0.0150, shifters 0.0723 -> 0.0813 (still furthest out of band, and still the single biggest
// residual driver of `CHAMPION_IS_HARDEST`/`SLOT_WINRATE_BAND`'s within-league failures - see
// `baseball/CLAUDE.md`), aces -0.0053 -> 0.0043 (measured, not hand-tuned; the handoff's "do not
// hand-tune Aces" rule is about not hand-picking this number, not about never re-measuring it).
// BB-2d commit 6: STYLE_STRENGTH_DELTA no longer touches the skill cap at all - `makeLeague` used
// to subtract it from `slotCap` (BB-2c commit 3), which meant a style's own measured strength edge
// was paid for by making its ROSTER weaker, an axis the contact-quality fix (BB-2a) already left
// with very little effect on win rate (the same reason `TEAM_LADDER_OFFSETS` itself moved onto
// timing/chase in BB-2b commit 3). Converted instead through two measured slopes (commit 1's own
// `--range` per-lever table: CPU sigma 200ms->91.2% win rate down to 58ms->57.5%, a slope of about
// 4.2ms per win-rate percentage point; CPU chase 0.9->60.4% down to 0.02->56.0%, about 0.2 chase
// units per percentage point) into ADDITIVE `timingSigmaMs`/`chase` offsets on top of the team's
// own ladder-slot offset - the same two axes `TEAM_LADDER_OFFSETS` itself already moves. A style
// measuring TOUGHER than its skill weights predict (positive delta) gets a SLOPPIER, more chase-
// prone team instead of a weaker one; the skill cap is now `baseCap * (1 + offsets.skill)` alone.
export const SIGMA_MS_PER_WINRATE_PP = 4.2;  // Draft, measured (see above)
export const CHASE_PER_WINRATE_PP = 0.2;     // Draft, measured (see above)
// BB-2d commit 6 re-measurement (`node sim-baseball.mjs --styles --styles-games 1000`, vs the
// median human model at every league per commit 2, AFTER SHIFT_MAX_DEG halved and SHIFT_MIN_SAMPLES
// added): `delta = 0.5 - winRate` from the PLAYER's own point of view (commit 2's sign convention).
// Notably, Shifters (-0.1022) is no longer the largest outlier it was in BB-2c (0.0813 there, under
// the OLD CPU-vs-CPU-vs-balanced measurement and the OLD SHIFT_MAX_DEG=15/no minimum-samples gate) -
// smallBall/junkballers/aces all measure a larger cost to the player now. Real progress on the
// "Shifters anomaly" BB-2c's own report flagged as unresolved, from this commit's bounding alone.
export const STYLE_STRENGTH_DELTA = {
  sluggers: -0.0646,
  smallBall: -0.1530,
  patient: -0.1080,
  flamethrowers: -0.1176,
  junkballers: -0.1320,
  shifters: -0.1022,
  aces: -0.1252,
  balanced: 0,
};

// BB-2a step 5 (2026-09-12): STRENGTH comes from here, not from TEAM_STYLES or a post-hoc sort -
// `makeLeague` applies a per-slot SKILL offset of `effectiveCapFor(league)` and orders teams BY
// SLOT, never by a measured `teamStrength()`. weakest (slot 0) to strongest (slot 7). Clamped
// inside `teams.js`'s `makeLeague` to `[1, CAPS[league]]` (never above the raw league cap, per doc
// §8) - Little League and High School both carry a `CPU_LEVEL_SHORTFALL` of 0, so their
// effectiveCap already equals the raw cap and the top few slots there necessarily tie at the
// ceiling; this is a real structural limit of "difficulty from behavior, not stats" at the bottom
// of the ladder, not a bug in the offsets. A wider first attempt (+/-0.45/0.38) measured no better
// on the within-league win-rate check than the narrower `skill` values kept below - the remaining
// disorder traces to which SKILL a slot's style favors mattering more or less against a fixed
// human strategy than its aggregate offset alone predicts, not to the offset's magnitude.
//
// BB-2b commit 3 (2026-09-13): restructured from a bare number per slot into `{ skill,
// timingSigmaMs, chase }` - the `skill` column below is numerically UNCHANGED from BB-2a step 6;
// see the full definition and rationale for the two new columns further down this file, next to
// `CPU_SIGMA_MIN_MS`/`CPU_SIGMA_ABSOLUTE_FLOOR_MS`.

// BB-2a step 5 (2026-09-12): which style sits in which ladder slot, per league. Draft, new,
// PROPOSED - for Matt to confirm or edit (the handoff's own words). One order, reused across every
// league (a league's DIFFICULTY comes from `effectiveCapFor`/TEAM_LADDER_OFFSETS scaling with the
// league, not from which flavor is toughest) - weakest to strongest: Balanced, Small Ball, Patient,
// Junkballers, Shifters, Flamethrowers, Sluggers, Aces (the champion in every league).
const LADDER_STYLE_ORDER = ['balanced', 'smallBall', 'patient', 'junkballers', 'shifters', 'flamethrowers', 'sluggers', 'aces'];
export const LEAGUE_LADDER_STYLES = Object.fromEntries(LEAGUES.map((lg) => [lg, LADDER_STYLE_ORDER.slice()]));

// Per league, the relative weight of each style being picked for a generated team (weights, not
// probabilities - pickWeighted normalizes). Doc doesn't give this distribution either - Draft
// [Open item 25], same as the weight vectors above. Every league offers every style evenly as the
// simplest non-invented default; only the WEIGHT VECTORS per style differ.
export const TEAM_STYLE_WEIGHTS = Object.fromEntries(
  LEAGUES.map((lg) => [lg, Object.fromEntries(Object.keys(TEAM_STYLES).map((s) => [s, 1]))]),
); // Draft [Open item 25]

export const LEFTY_RATE = 0.25; // [Locked] doc §9 - "About 1 in 4 CPU players are lefties"

// ---------------------------------------------------------------------------------------------
// SKILL_EFFECT: how each bought skill point maps onto engine behavior. The doc names WHAT each
// skill does (§6) but explicitly leaves HOW MUCH open ("[Open] How much each skill point changes
// each effect. Must stay a small nudge" - doc §6, repeated as Open item 4). Every value below is
// therefore still invented - Draft [Open item 4] - constrained only by the doc's qualitative
// description of which effect each skill drives, renamed onto the six real skill ids.
export const SKILL_EFFECT = {                // Draft [Open item 4]
  hitAcc:    { contactRadiusInPerPt: 0.09, whiffReductionPerPt: 0.006 }, // "bigger timing window and sweet spot" - BB-2a step 6 retune (was 0.15/0.01, reverted-from-phase-2 value) against the NEW contact-quality axis, within `sim-baseball.mjs --contact-grid`'s own constraints; lowers the SKILL_EFFECT sensitivity experiment's win-rate gap
  hitPow:    { exitVeloMphPerPt: 0.07 },                                 // "more distance, stronger charged swings" - BB-2d commit 4 retune (was 0.35, BB-2a step 6's own value): the BASE_EXIT_VELO/CARRY_SCALE recalibration below could not hit both HR_CARRY_FRAC and MEDIAN_CARRY_FRAC at the old 0.35 without breaking the contact grid's TIMING_OVER_POWER/ceiling margins (power came to dominate a much-lower BASE_EXIT_VELO too heavily); 0.07 is the largest value (of a small candidate sweep - 0.35/0.21/0.14/0.105/0.07 measured against the real `--contact-grid` tool) that keeps both contact-grid ratio checks inside their own margins - see the BASE_EXIT_VELO/CARRY_SCALE comment below for the joint derivation
  hitSpd:    { sprintFtPerSPerPt: 0.08, stealSuccessPerPt: 0.01 },       // "beat out grounders, stretch hits, steal/bunt" - sprintFtPerSPerPt/stealSuccessPerPt still unused (no steal/bunt this phase, see RESERVED_PHASE_6); the beat-out HALF is now wired, via MECHANICS.beatOutPerPt in outcomes.js
  pitchSpd:  { throwMphPerPt: 0.5 },                                     // "pitch velocity"
  pitchAcc:  { throwAccuracyPerPt: 0.01, pickoffPerPt: 0.01 },           // "lands closer to aim, bigger Nice zone, better pickoffs" - pickoff unused this phase
  pitchSpin: { breakPerPt: 0.02, changeupGapPerPt: 0.01 },               // "more bend on curve/slider/screwball; bigger changeup speed gap" - unused this phase, no steering modeled yet
};
export const SKILL_EFFECT_MAX_PER_POINT = 0.03; // as given by BB-1a's handoff; a soft ceiling for future tuning, not yet enforced anywhere

// ---------------------------------------------------------------------------------------------
// Game rules (doc section 3, all [Locked] except the extra-innings safety valve, which the doc
// explicitly asks to keep only as a non-exposed safety valve: "No mercy rule and no cap on extra
// innings... keep one but set it high enough that it can never fire in a real game").
export const MECHANICS = {
  walkoffEndsImmediately: true,     // [Locked] doc §3
  extraInningRunnerOnSecond: true,  // [Locked] doc §3 - "every extra half-inning starts with a runner on second"
  doublePlayEnabled: true,          // [Locked] doc §3 - "can be a double play" with a runner on first, <2 outs
  doublePlayChance: 0.30,           // Draft [Open item 26] - BB-2b commit 5 retune: 0.40 -> 0.30, measured against the Gold-odds retune (a double play now snuffs out roughly 1-in-11 grounders with a runner on first and <2 outs, down from 1-in-8) - fewer of the player's own rallies end in two outs off one groundball, one of several small levers pulled toward the Gold thresholds alongside the CPU/ladder retune below
  maxExtraInnings: 50,              // [Locked] doc §3 - explicitly a safety valve only, never a stated rule
  outsPerInning: 3,
  strikesForOut: 3,
  ballsForWalk: 4,
  foulNeverThirdStrike: true,       // [Locked] doc §3 - "a foul can never be strike 3" (already the engine's behavior)
  basesLoadedForceAll: true,
  // How deep a fly out with a runner on third must carry to be a sac fly (doc §3, [Locked] that a
  // "deep fly out" scores the runner - the doc names it deep, not automatic; this is how deep,
  // Draft, new). Below it the runner holds - a shallow fly ball's throw home is live.
  sacFlyMinDepthFt: 180,
  // Step 1 (zones.js/outcomes.js): a grounder within this many feet of its infield sector's outer
  // edge is a close play, eligible for the batter's hitSpd to beat out the throw (doc §6, [Locked]:
  // "Batter Speed affects beating out grounders"). Draft, new.
  groundEdgeMarginFt: 15,
  // Chance PER hitSpd SKILL POINT that a close grounder (within groundEdgeMarginFt of the sector
  // edge) beats the throw for a single, rather than being fielded. Draft, new - for the phase 2
  // simulator to verify a reasonable beat-out rate results.
  beatOutPerPt: 0.02,
};

// BB-2d commit 4: home runs were measured IMPOSSIBLE in every league, not only from College up
// (commit 1's own `--range` census: p95 carry 150-166ft everywhere, nowhere near even Little
// League's 210ft fence) - the handoff's cap-only arithmetic (swing.js's ~75mph ceiling x carryFt's
// old CARRY_SCALE=6.2 tops out near 279ft) never survived measurement against real games, because
// BASE_EXIT_VELO(62)/CARRY_SCALE(6.2) together produced far LOWER real exit velocities than the
// ceiling implied. `BASE_EXIT_VELO`/`CARRY_SCALE` are recalibrated together (moved out of
// swing.js's own local const, which held BASE_EXIT_VELO before this commit) so that, at COLLEGE
// (`LEAGUE_POWER_SCALE.college` = 1.00, the identity case), a q=1 (perfectly-timed) swing at cap
// hitPow (18) carries `HR_CARRY_FRAC` (1.05) of the center fence, and at `MEDIAN_HIT_POW_FRAC`
// (0.5) of cap carries `MEDIAN_CARRY_FRAC` (0.80) of it - both evaluated at the centered-contact
// launch angle's own center (`FEEL.engine.lineDriveCenterDeg`, 20deg, angleFactor
// sin(40deg)=0.6428) since that is the launch angle a dead-center, perfectly-timed swing produces.
// Solving the two simultaneous equations (evaluated at the centered-swing carry angle 30deg,
// sin(60deg)=0.866 - the original CARRY_SCALE comment's own Statcast reference angle) gives
// BASE_EXIT_VELO and CARRY_SCALE as a function of `SKILL_EFFECT.hitPow.exitVeloMphPerPt` alone
// (the two hitPow reference points and both target fractions are fixed, so the per-point rate is
// the only remaining free knob): at the old 0.35, BASE_EXIT_VELO came out to 36.93, only slightly
// above swing.js's own exit-velocity floor - power's contribution became disproportionately large
// against so small a base, and the contact grid's TIMING_OVER_POWER/ceiling checks (doc §8, [Locked]:
// "a well-timed low-Power swing beats a sloppy high-Power swing") both failed for the first time
// since BB-2a. Retuning `exitVeloMphPerPt` down to 0.14 (see its own comment above) alongside this
// recalibration - not otherwise touching swing.js's contact-quality mechanism - restores both
// checks; BASE_EXIT_VELO=32.77, CARRY_SCALE=91.64 are the pair that value implies. Both are far
// from their old values (62/6.2), because the old pair produced real-game carries an order of
// magnitude short of any fence even though its OWN ceiling arithmetic looked plausible; this is
// what "measure, don't derive from a cap alone" means in practice.
export const BASE_EXIT_VELO = 31.39;
export const CARRY_SCALE = 183.29;
// `HR_CARRY_FRAC`/`MEDIAN_CARRY_FRAC`/`MEDIAN_HIT_POW_FRAC` are the calibration targets themselves,
// named so a future fence or SKILL_EFFECT change can re-derive BASE_EXIT_VELO/CARRY_SCALE from the
// same three named numbers rather than by re-deriving the algebra from scratch.
export const HR_CARRY_FRAC = 1.05;
export const MEDIAN_CARRY_FRAC = 0.80;
export const MEDIAN_HIT_POW_FRAC = 0.5;
// BB-2d commit 4: how far the field's own power scales per league (doc §10, [Locked]: "fields get
// bigger each league... out zones also grow" - the batted ball itself never scaled with the field
// before this commit, which is the root cause of the impossible-home-run finding above: a fixed
// exit-velocity ceiling against a growing fence guarantees the ceiling eventually stops reaching
// it). Started at `FIELD[lg].fieldScale`'s own five numbers (0.60/0.85/1.00/1.05/1.10) per the
// handoff; `little` measured far too low there (0.175 homers/game against the
// `LL_HR_PER_GAME_BAND` target of [0.3, 1.0], `sim-baseball.mjs --range`'s census) and needed a
// much larger push than expected to clear the band - the fly-ball population (swing.js's own
// launch-angle model) that can even become a home run is a small, fixed slice of centered contact
// regardless of exit velocity, so moving the fence closer (Little League's 210ft) does far less
// than moving the SAME multiplier does at a league with a farther fence; measured up through 1.2/
// 1.5/1.7/1.8, landing on 1.8 (0.329 homers/game, safely inside the band with margin). Kept as its
// OWN Draft table now, not a live derivation from `FIELD.fieldScale` - field SIZE and batted-ball
// POWER are different questions that happened to start from the same first-guess numbers. Applied
// in swing.js relative to `CARRY_ZERO_MPH` (see that constant's own comment for why a straight
// multiply on the raw mph broke both ends of the ladder), so the calibration above (done at
// College, where this is exactly 1) is untouched.
export const LEAGUE_POWER_SCALE = { little: 1.8, highschool: 0.85, college: 1.00, minors: 1.05, majors: 1.10 };
// BB-2d commit 4: the 250ft/320ft double/triple depth cutoffs used to be flat numbers regardless of
// league or spray angle - meaningless once the fence itself varies by both. Now fractions of the
// FENCE AT THAT SPRAY ANGLE (`fenceFtAt`, outcomes.js), chosen to reproduce the old cutoffs exactly
// at College's 400ft CENTER fence (250/400=0.625, 320/400=0.80) so this commit changes WHAT the
// cutoff scales with, not what it evaluates to at the league/spray-angle the old flat numbers were
// implicitly tuned against.
export const DOUBLE_DEPTH_FRAC = 0.625;
export const TRIPLE_DEPTH_FRAC = 0.80;
// swing.js's own floor on exit velocity (`Math.max(35, ...)` before this commit - a bare 35, never
// named). Its job is to stop a badly-timed swing's exit velocity going to zero or negative
// (`timedExitVelo` can fall as low as `BASE_EXIT_VELO * FEEL.engine.qualityFloor` at q=0/no power,
// minus a further lateral-offset penalty) - a floor is still needed with the recalibrated
// BASE_EXIT_VELO, but 35 was calibrated against the OLD base (62) and sat comfortably below it
// (ratio 0.5645); left at the old absolute value it now sits ABOVE where the new, lower base's own
// quality-scaled floor naturally lands, silently erasing the timing-quality gradient this whole
// axis exists to produce (a q=0 max-Power swing measured 35.0mph - the floor itself - against a
// q=1 swing's own ~40mph, nowhere near the qualityFloor share the axis is supposed to guarantee).
// Kept at the SAME ratio to BASE_EXIT_VELO (0.5645) rather than a second independently-chosen
// number, so a future BASE_EXIT_VELO change carries this floor along with it automatically.
export const MIN_EXIT_VELO_MPH = BASE_EXIT_VELO * (35 / 62);
// BB-2d commit 4: `carryFt`'s own "no carry below this speed" baseline (outcomes.js's
// `speedFactor = Math.max(0, exitVeloMph - 30)`), pulled out as its own name so swing.js's league
// scaling can be defined RELATIVE to it. A straight multiplicative `LEAGUE_POWER_SCALE * exitVelo`
// was tried first and measured broken: at Little League (0.60) it pushed the whole exit-velocity
// axis, baseline included, to around 19-23mph - BELOW this floor - so every batted ball carried
// ZERO feet regardless of timing or power (measured: p95 carry rounded to 0ft across the whole
// census), while at Majors (1.10) the same multiplication compounded onto the new, much larger
// CARRY_SCALE and produced carries past 700ft. Scaling the EXCESS above this baseline instead
// (`CARRY_ZERO_MPH + LEAGUE_POWER_SCALE * (rawExitVelo - CARRY_ZERO_MPH)`) keeps the baseline itself
// fixed and only stretches or compresses how far above it a swing can reach - the mechanism this
// axis needs, since carry is only ever a function of the excess above this number in the first
// place.
export const CARRY_ZERO_MPH = 30;

// BB-2a step 3 (2026-09-12): a well-squared-up LINE DRIVE (contact quality `q` at or above
// LINE_THROUGH_Q) that lands inside an outfield out-zone sector still goes through as a hit, up to
// LINE_THROUGH_MAX_FT - a "routine fly into a sector" stays an out (the ordinary out-zone check,
// untouched), but a scorched line drive through the same depth a lazy fly ball would have been
// caught at is what a squared-up ball actually does. Draft, new, BB-2a.
export const LINE_THROUGH_Q = 0.75;
export const LINE_THROUGH_MAX_FT = 220;

// Reserved for phase 6 (doc §3/§17 Open item 8): steal, bunt, and pickoff are [Locked] FEATURES
// with reserved input slots, but "how each works in play" is undecided and no baserunning happens
// between pitches this phase (bases.js's own header). Named here so a future phase does not have
// to rediscover that the hook is deliberately absent rather than forgotten.
export const RESERVED_PHASE_6 = ['steal', 'bunt', 'pickoff'];

// ---------------------------------------------------------------------------------------------
// BB-2b commit 2: doc §4/§13's own "Open item 13" (schedule shape and standings tie-breakers) -
// the three levers `sim-baseball.mjs --stages` (commit 1) measured against the real bottleneck.
// All three Draft, for Matt to confirm or edit via commit 4's proposal block; `season.js` reads
// them as its own default parameter, so a caller (this sim, and later phase 4's real career loop)
// can still override per-call without touching settings.js.
//
// BRACKET_MODEL: 'asCoded' is the shipped positional 1v4/2v3 bracket (season.js's original
// `playoffs()`) - a low-seeded player (seed 4, the common case) faces the single STRONGEST
// qualifier in the semifinal, then the hardcoded championship opponent is that same strongest team
// again. 'strongestInFinal' is the bracket doc §8's own wording implies ("the championship
// opponent is always the toughest team in the league") but nothing before this phase actually
// arranged: the player's semifinal opponent is chosen to EXCLUDE the strongest of the four
// qualifiers, so that team reaches the final by winning ITS OWN (scripted) semifinal instead of by
// being fed to the player twice. Commit 1's `--stages` measured this move Gold odds by only a few
// points at every league - not the dominant lever - but it is still the bracket the doc's own
// wording describes, so it is the default.
export const BRACKET_MODEL = 'strongestInFinal'; // Draft [Open item 13]

// PLAYOFF_HOME: 'player' is the shipped behavior (both the semifinal and the championship are
// forced player-home, while the 12-game regular season alternates 6/6) - a real, uncompared-against
// home-field edge in a 3-inning engine where the home side skips a pointless bottom of the third
// and owns the walk-off (baseball/CLAUDE.md's "both playoff games are forced player-home" finding).
// 'higherSeed' gives home to whichever side has more wins (the CPU's own scripted record under
// STANDINGS_MODEL, or the player's real one) - the ordinary sports convention, and what
// `scriptedStandings`'s own tie-break already treats as "better." 'alternate' flips home/away
// between the two playoff games by season, an even simpler in-between. Commit 1 measured this
// lever moves Gold odds only a few points too; 'higherSeed' is the default because it needs no
// invented tie-break rule of its own - the standings already decide who is "better."
export const PLAYOFF_HOME = 'higherSeed'; // Draft [Open item 13]

// STANDINGS_MODEL: 'rawWins7' is the shipped `scriptedStandings` (CPU team at ladder rank r plays a
// scripted 7-game round robin among the other 7 CPUs and finishes r-r wins, 0..7) compared directly
// against the PLAYER's real 12-game record - a 9-3 player is compared against CPU rows that can
// never exceed 7 wins, which structurally seeds the player low relative to what a 9-3 record
// "should" mean on a 12-game slate. 'scaledTo12' scripts each CPU rank r's win total as
// `round(12 * r / 7)` instead (0, 2, 3, 5, 7, 9, 10, 12 for ranks 0..7) - directly comparable to the
// player's own 12-game record, "like for like" per the handoff.
//
// BB-2b commit 4: measured with `--stages` on the commit-3 engine and REVERSED from commit 2's
// initial guess of `scaledTo12`. Scaling every CPU rank onto a 12-game scale means the STRONGEST
// few qualifiers now finish 9-3/10-2/12-0 - records a median-skill player essentially cannot beat -
// and top-4 odds collapsed at every league (college 40.7% -> 0.3%, highschool 91.7% -> 35.7%,
// minors 38.0% -> 0.7%, majors 39.7% -> 1.3%, measured at SEASONS_N=300). "Like for like" reads as
// fairer in the abstract but is measurably WORSE for every one of the doc's own Gold targets, for
// the same reason the original diagnosis named: Gold's bottleneck is compound probability against
// teams that are already close to a maximum record, and inflating that maximum by scaling makes it
// worse, not better. `rawWins7` is the default again.
export const STANDINGS_MODEL = 'rawWins7'; // Draft [Open item 13], BB-2b commit 4

// BB-2c commit 4: SCHEDULE_SHAPE, doc §4/§13 Open item 13 ("schedule shape... over 8 opponents").
// `season.js`'s own `OPPONENT_ORDER` used to be a single hardcoded array, its comment claiming it
// was "confirmed by Matt" - BB-2b measured an alternative (repeating the weakest four instead of
// the strongest) as the single largest lever this whole effort found for reaching Gold, and
// flagged it as a recommendation rather than touch an already-confirmed shape unilaterally. This
// handoff reopens it explicitly. All three shapes below are weakest to strongest on the FIRST pass
// over all 8 opponents and meet the champion (index 7) exactly once, in game 12 - doc §8, [Locked]:
// "the championship opponent is always the toughest team," which every shape here still honors on
// the very last regular-season game, whatever else repeats earlier.
//
//   repeatTop    - [0,1,2,3,4,5,6,7,4,5,6,7]: the shipped shape - every opponent once, then the
//                  four STRONGEST a second time, late. Plays the hardest half of the ladder twice.
//   repeatBottom - [0,0,1,1,2,2,3,3,4,5,6,7]: the four WEAKEST twice, early, then the top half once
//                  each late. Measured (`sim-baseball.mjs --stages`) as a large, consistent lift to
//                  top-4 odds and Gold at every league.
//   repeatMiddle - [0,1,2,2,3,3,4,4,5,5,6,7]: repeats the MIDDLE four (slots 2-5) instead of either
//                  extreme - still progressively harder, halves the games against the top half
//                  (slots 4-7 each played once except 4/5, which repeat), and meets both of the two
//                  strongest teams only once each before the playoffs.
//
// Measured (`node sim-baseball.mjs --stages`, median tier, SEASONS_N=300) and set as the Draft
// default: `repeatMiddle` - see the proposal block in `baseball/CLAUDE.md` for the full table.
// `repeatTop`/`repeatBottom` remain selectable for comparison.
export const SCHEDULE_SHAPE = 'repeatMiddle'; // Draft [Open item 13], BB-2c commit 4

// ---------------------------------------------------------------------------------------------
// BB-2b commit 3: engine mechanisms the doc requires that phase 2/2a still lacked.

// zones.js: angular GAPS between out-zone sectors (doc §10, [Locked]: "Singles go through gaps
// and as bloopers") - phase 2's sectors tiled the full -45..45 span with no gap at all, so nothing
// could ever be a "gap" hit; every batted ball fell inside exactly one sector or was clamped to
// one at the edges. Draft, new - degrees of dead zone between adjacent sectors (both infield and
// outfield), where `zones.js`'s `angleSector` now returns `null` instead of clamping.
export const GAP_DEG = 6;

// outcomes.js: how many feet short of an outfield sector's own near edge (`fromFt`) a fly/line
// ball is still a "bloop" single rather than an ordinary out (doc §10, [Locked]: "...and as
// bloopers") - phase 2/2a's `resolveContact` never checked an outfield sector's near edge at all,
// so a modestly-hit ball landing between the infield's own reach and an outfielder's own position
// was scored as a flat "flyout"/"lineout" no matter how shallow the outfielder actually was.
// Draft, new.
export const BLOOP_BAND_FT = 25;

// swing.js/agents.js: how much a pitch's actual travel-time MULTIPLE (relative to what the batter
// was expecting, from `PITCH_TRAVEL_MULT`) shrinks or widens the batter's effective timing sigma -
// a faster-than-expected pitch (changeup after fastballs, or vice versa) should fool a HUMAN
// exactly the way it already fools a CpuBatter's own pattern read (doc §8: "Change speeds and he
// swings early or late"), but `ModelBatter` (sim-baseball.mjs's human stand-in) never read
// `pitchHistory` at all before this phase. Draft, new - ms of extra timing sigma per full unit of
// travel-multiple surprise (e.g. a changeup at 1.4x thrown after an unbroken run of 1.0x fastballs
// is a 0.4-multiple surprise).
export const SPEED_SURPRISE_MS_PER_MULT = 60;

// agents.js's `CpuBatter`/`ModelPitcher`: named constants for every magic number that governed a
// CPU decision, per CLAUDE.md's own instruction ("no magic numbers, name every constant you
// touch"). Draft, unchanged VALUES from what shipped in BB-2/BB-2a - only their names are new.
export const AIM_CORNER_CHANCE_MULT = 0.5;   // how much cornerBias raises the chance of an off-middle aim (`1 - cornerBias * this`)
export const AIM_INZONE_BIAS = 0.4;          // how far off-middle an ordinary (non-corner) aim scatters
export const AIM_CORNER_BIAS_BASE = 0.9;     // the floor of an aim that DID go for the corner
export const AIM_CORNER_BIAS_SCALE = 0.9;    // how much further cornerBias itself pushes a corner aim
export const WEAKSPOT_AIM_SCATTER = 0.15;    // scatter around a remembered weak zone (doc §8: "attacks your weak spots")
export const SPEED_DELTA_DEADBAND = 0.05;    // travel-multiple delta below which a repeated pitch speed counts as "the same"
export const FOOL_PENALTY_MS_SCALE = 400;    // ms of extra timing sigma per unit of speed-delta surprise, scaled by patternWeight/fool
export const FOOL_BONUS_MS_SCALE = 200;      // ms of REDUCED timing sigma per unit of speed consistency, scaled by patternWeight/fool
export const LOCATION_LEAN_WEIGHT = 0.5;     // how far patternWeight pulls a CPU batter's aim toward its own location read

// agents.js's `ModelPitcher.variety` (sim-baseball.mjs's human stand-in): the probability of
// repeating the immediately-previous pitch type, at variety=0, falling LINEARLY to 0 at variety=1.
// Before this phase `variety` was BINARY (>0 drew a weighted random type every time; <=0 always
// threw the unlocked list's first entry, forever, with no randomness at all) - doc §8's own
// framing ("mixes pitches more" each league up) is a continuous quantity, not an on/off switch.
// Draft, new.
export const VARIETY_REPEAT_BASE_CHANCE = 0.85;

// BB-2c commit 2: the CPU strength CONTRACT, doc §8, [Locked] (design doc v9): "CPU batters may
// never time or place better than a median human, in any league or any slot." BB-2b's single flat
// `CPU_SIGMA_FLOOR_MS` (55, exactly the median human's own sigma) turned out to be parity, not a
// floor - and worse, `cpuBaseTimingSigmaMs()` applied it to the league's own BASE only, then added
// the per-slot ladder offset AFTER, so a tough slot's own effective sigma could still fall well
// below it (BB-2b commit 5's own report: the champion slot measured 30ms at its first draft,
// sharper than even a modeled "strong" human at 35ms). BB-2c commit 1's `--attribute` counterfactual
// confirmed a single GLOBAL floor is also the wrong shape - it is a big net negative at Little
// League/High School/College (their own natural sigma already sits comfortably above a human's) and
// only a small positive at Majors (whose natural sigma sat below it). Two constants replace the one:
//
// `CPU_SIGMA_MIN_MS`: a PER-LEAGUE floor for that league's own BASE sigma (before any ladder
// offset), so Little League can still be far sloppier than a median human while Majors' base can't
// be far off it. Values Draft, per the handoff.
export const CPU_SIGMA_MIN_MS = { little: 115, highschool: 95, college: 80, minors: 70, majors: 58 };
// `CPU_SIGMA_ABSOLUTE_FLOOR_MS`: the one number NOTHING may cross - not a league's own base, not a
// ladder slot's offset, not the pattern-read timing bonus - a hard backstop above the median
// human's own 55ms. `cpuBaseTimingSigmaMs()` and `CpuBatter`'s own pattern-bonus clamp both apply
// it AFTER every other adjustment, not before, closing the gap BB-2b's ordering left open.
export const CPU_SIGMA_ABSOLUTE_FLOOR_MS = 58;
// `CPU_PLACEMENT_MIN`: the least bat-placement noise (a fraction of the plate half-width) any CPU
// batter may ever place with - the median human's own placement noise (`sim-baseball.mjs`'s
// `MODEL_TIERS.median.placementSigma`). Enforced on `CPU[league].placementNoise` directly (every
// row above sits at or above it) rather than at read time, since placement noise has no per-slot
// ladder offset to re-violate it after the fact.
export const CPU_PLACEMENT_MIN = 0.22;

// TEAM_LADDER_OFFSETS (BB-2a step 5) used to be a single fractional SKILL offset per slot - the
// only axis it moved. BB-2b commit 3: "within-league monotone still noisy" traced to the ladder
// moving a lever (skill points) that the contact-quality fix left with very little effect on win
// rate, while the axis that actually decides most outcomes - a CPU BATTER'S OWN timing/chase
// behavior - had no ladder at all (every team in a league shared one flat `CPU[league]` row
// regardless of slot). Each entry is now `{ skill, timingSigmaMs, chase }`: `skill` is the
// unchanged fractional offset of `effectiveCapFor(league)` from BB-2a step 6; `timingSigmaMs` is
// an ADDITIVE ms offset applied on top of `cpuBaseTimingSigmaMs()` (negative = a sharper-timed,
// tougher slot; positive = a sloppier, easier one); `chase` is an additive offset on
// `CPU[league].chase` (negative = chases less/tougher; positive = chases more/easier). Values
// mirror the existing skill-offset SHAPE (roughly proportional, slot 0 easiest to slot 7 hardest)
// so slot 0 bats sloppier and chases more than slot 7 within the same league, at every league -
// `teams.js`'s `makeLeague` applies `skill` to roster generation exactly as before and attaches
// `timingSigmaMs`/`chase` directly onto the returned team object for `agents.js`'s `CpuBatter` to
// read. Draft, new axis; the skill column's own values are unchanged from BB-2a step 6.
// BB-2b commit 5 retune: `timingSigmaMs`/`chase` compressed from their commit-3 first draft
// ({25,18,12,6,0,-6,-14,-25} / {0.20,...,-0.15}) - the champion (slot 7) at that draft measured an
// effective batting sigma of `cpuBaseTimingSigmaMs` (55, the floor) `+ (-25)` = 30ms at every
// league, SHARPER than even `sim-baseball.mjs`'s own "strong" human tier (35ms) - `CPU_SIGMA_FLOOR_MS`
// only bounds a league's own MEDIAN (slot-4, zero-offset) base, by design, so nothing stopped the
// ladder's own offset from pushing a tougher slot back under the floor it exists to enforce.
// Measured: `CHAMPION_GAME_WIN_MIN_MEDIAN` was as low as 6-12% at College/Minors/Majors with the
// first-draft offsets - nowhere near reachable, because the doc's own [Locked] rule (the
// championship opponent IS the toughest team) makes that one matchup's own win rate the hard floor
// under Gold. Compressed here to `skill/chase` unchanged from the first draft's SHAPE but
// `timingSigmaMs` scaled to 30% of it - still strictly monotone slot to slot (doc's own "team
// strength rises by league at the same style" and the within-league ladder both still hold), but
// the champion slot no longer bats sharper than a strong HUMAN, only sharper than a median one.
// BB-2c commit 5 retune: `timingSigmaMs`/`chase` widened from BB-2b's compressed draft
// ({16,11,7,3,0,-0.8,-2,-3.5} / {0.10,0.075,0.05,0.025,0,-0.025,-0.05,-0.075}) toward
// `{20,14,9,4,0,-1,-2.5,-4}` / `{0.15,0.11,0.07,0.03,0,-0.03,-0.06,-0.12}` to widen
// `SLOT_WINRATE_BAND`'s weakest-to-champion spread within a league - `SLOT_WINRATE_BAND`, doc
// §13 Open item 13, needs the weakest slot near-automatic (>=0.85 everywhere) and the champion a
// real fight (0.40-0.55 everywhere), which the BB-2b spread (tuned only for
// `CHAMPION_GAME_WIN_MIN_MEDIAN`, a single flat threshold) never had to produce. The champion row's
// `timingSigmaMs: -4` is the largest magnitude this table may ever hold at Majors:
// `cpuBaseTimingSigmaMs('majors')` is `62 + offset`, and `CPU_SIGMA_ABSOLUTE_FLOOR_MS` is 58, so
// `-4` lands EXACTLY on the floor with no headroom left on this axis - any further Majors-champion
// difficulty has to come from `chase`/`cornerBias`/`patternWeight`/`weakSpotWeight`/
// `outZoneMult`/`fieldScale`, not sigma.
// BB-2d commit 5: two new per-slot columns, `behaviorMul`/`changeupShare` - the champion's own
// axis. Before this commit, every PITCHING-behavior field (cornerBias, pitchMix, patternWeight,
// weakSpotWeight) was per-LEAGUE only, with no per-slot ladder at all: a Little League champion
// pitched with the exact same cornerBias/patternWeight/weakSpotWeight as that league's weakest
// team, and `CPU_SIGMA_MIN_MS` bound EVERY slot's own base sigma to the same per-league floor,
// so a league's champion could never bat/pitch meaningfully differently from its weakest team on
// these axes - only `skill`/`timingSigmaMs`/`chase` varied by slot. `behaviorMul` (Draft, linear
// 0.5 at slot 0 to 1.6 at slot 7) multiplies `cornerBias`/`patternWeight`/`weakSpotWeight`
// (agents.js's `CpuPitcher`/`CpuBatter` both read it now); `changeupShare` (Draft, linear 0 at
// slot 0 to 2.0 at slot 7) is an ADDITIVE pitch-mix weight added to `changeup`'s own entry, a
// slot-scaled lean toward off-speed per the doc's own "mixes pitches more" framing. Both are
// capped by `CHAMPION_CEILING` (see below) - the effective value can never make a league's
// champion pitch tougher on these axes than the NEXT league's own base row, so "easier season,
// harder champion" never turns a Little League champion into a de facto Majors pitcher.
//
// BB-2e commit 2: `TEAM_LADDER_OFFSETS` is now a PER-LEAGUE table, generated from a per-league
// `LADDER_SHAPE` rather than one flat array shared by every league. BB-2d's own report proved
// Little League/High School's champion-slot band "mathematically incompatible" with their season
// band ONLY under an assumed EVEN SLOPE from slot 0 to slot 7 (`sim-baseball.mjs --ladder`'s own
// `spread` shape) - a shape nothing in this table actually requires. `--ladder`'s arithmetic
// (commit 1) confirmed both bands DO hold for Little League and High School under `cliff` (slots
// 0-6 clustered near the top, one steep drop to the champion) and for College under `spread`.
// Matt's own instruction assigns the three shapes: `cliff` for Little League/High School
// (one stacked team and seven that fall over - "what Little League actually looks like"),
// `spread` for College/Minor League (a field of real teams, descending roughly evenly), `steep`
// for Major League (a shallow descent across slots 0-5, a sharper drop across 6-7).
export const LADDER_SHAPE = {
  little: 'cliff', highschool: 'cliff', college: 'spread', minors: 'spread', majors: 'steep',
};
// Named per-shape GAP weights - 7 gaps between the 8 slots, summing to 1, each naming how much of
// the total slot0->slot7 RANGE that gap consumes (direction-agnostic: works the same whether an
// axis rises or falls from slot 0 to slot 7). Shared, byte-identical logic with
// `sim-baseball.mjs --ladder`'s own arithmetic proof (commit 1) - that tool imports these two
// constants and this function directly, so the shape a league is ASSIGNED and the shape commit 1
// PROVED compatible can never silently drift apart.
export const CLIFF_TOP_GAP_FRAC = 0.02;     // each of the first 6 gaps, under `cliff`
export const STEEP_SHALLOW_GAP_FRAC = 0.06; // each of the first 5 gaps, under `steep`
export function ladderGapWeights(shape) {
  if (shape === 'cliff') return [...Array(6).fill(CLIFF_TOP_GAP_FRAC), 1 - 6 * CLIFF_TOP_GAP_FRAC];
  if (shape === 'steep') {
    const rest = (1 - 5 * STEEP_SHALLOW_GAP_FRAC) / 2;
    return [...Array(5).fill(STEEP_SHALLOW_GAP_FRAC), rest, rest];
  }
  return Array(7).fill(1 / 7); // spread
}
// The reference ENDPOINT magnitudes per axis - slot 0 (weakest) and slot 7 (champion) - UNCHANGED
// from the flat table's own slot0/slot7 rows (BB-2c/2d's own retuned values, confirmed reachable
// at every league by `sim-baseball.mjs --assert`'s own SLOT_WINRATE_BAND champion check before
// this commit). A league's assigned SHAPE decides only how slots 1-6 are SPACED between these two
// endpoints - the endpoints themselves are commit 3's lever, not commit 2's; generating a
// per-league table from a shared endpoint pair is what "a band change re-derives the ladder
// instead of needing a hand-tuned array" (the handoff's own words) means in practice.
const LADDER_AXIS_ENDPOINTS = {
  skill:         { slot0: -0.25, slot7: 0.25 },
  timingSigmaMs: { slot0: 20,    slot7: -4 },
  chase:         { slot0: 0.15,  slot7: -0.12 },
  behaviorMul:   { slot0: 0.50,  slot7: 1.60 },
  changeupShare: { slot0: 0,     slot7: 2.00 },
};
// BB-2e commit 3: `timingSigmaMs`'s own slot7 (champion) endpoint is PER-LEAGUE now, not the flat
// -4 every league shared before this commit. Measured (`node sim-baseball.mjs --assert --quick
// --league little`, before this change): the flat -4 offset left the champion's effective sigma at
// 111ms at Little League - nowhere near CPU_SIGMA_ABSOLUTE_FLOOR_MS (58) - while Majors' champion
// already sat EXACTLY on the floor (`cpu.timingSigmaMs` 58 minus 4, clamped up to 58 by the floor
// itself, so -4 was already moot there). The flat endpoint was calibrated to Majors' own narrow
// headroom (CPU_SIGMA_MIN_MS.majors - CPU_SIGMA_ABSOLUTE_FLOOR_MS = 0) and left every other
// league's much larger headroom (Little League: 115-58 = 57ms) almost entirely unused - a real
// contributor to Little League's champion measuring 0.93 win rate against a [0.40, 0.55] target.
// `CHAMPION_SIGMA_HEADROOM_FRAC` names how much of a league's OWN headroom to the absolute floor
// the champion's offset uses; `championSigmaOffset` resolves it to an actual ms number per league.
export const CHAMPION_SIGMA_HEADROOM_FRAC = 0.9;
function championSigmaOffset(league) {
  const leagueMin = CPU_SIGMA_MIN_MS[league] != null ? CPU_SIGMA_MIN_MS[league] : CPU_SIGMA_ABSOLUTE_FLOOR_MS;
  const headroom = leagueMin - CPU_SIGMA_ABSOLUTE_FLOOR_MS;
  return -headroom * CHAMPION_SIGMA_HEADROOM_FRAC;
}
function ladderAxisProfile(shape, slot0, slot7) {
  const weights = ladderGapWeights(shape);
  const range = slot7 - slot0;
  const out = [slot0];
  let cum = 0;
  for (const w of weights) { cum += w; out.push(slot0 + cum * range); }
  return out;
}
function ladderOffsetsFor(league) {
  const shape = LADDER_SHAPE[league] || 'spread';
  const perAxis = {};
  for (const axis of Object.keys(LADDER_AXIS_ENDPOINTS)) {
    const { slot0, slot7 } = LADDER_AXIS_ENDPOINTS[axis];
    const resolvedSlot7 = axis === 'timingSigmaMs' ? championSigmaOffset(league) : slot7;
    perAxis[axis] = ladderAxisProfile(shape, slot0, resolvedSlot7);
  }
  return Array.from({ length: 8 }, (_, slot) => ({
    skill: perAxis.skill[slot],
    timingSigmaMs: perAxis.timingSigmaMs[slot],
    chase: perAxis.chase[slot],
    behaviorMul: perAxis.behaviorMul[slot],
    changeupShare: perAxis.changeupShare[slot],
  }));
}
// PER-LEAGUE now: `TEAM_LADDER_OFFSETS[league][slot]`, never a bare `TEAM_LADDER_OFFSETS[slot]`.
export const TEAM_LADDER_OFFSETS = Object.fromEntries(LEAGUES.map((lg) => [lg, ladderOffsetsFor(lg)]));
// The ceiling rule itself: every effective per-slot pitching-behavior value (after `behaviorMul`)
// is clamped to the NEXT league's own BASE row for that same field - Majors (no next league) is
// its own ceiling, so its champion is bounded only by its own row. A single named mode string
// (rather than a bare boolean) so a future session can add a different ceiling rule without
// renaming this constant out from under callers that just check its value.
export const CHAMPION_CEILING = 'nextLeagueRow';
// BB-2d commit 5: slots 0-4 keep the existing per-league `CPU_SIGMA_MIN_MS` floor unchanged (BB-2c
// commit 2's own contract, untouched); slots 5-7 DESCEND linearly from that same floor (at slot 4)
// toward `CPU_SIGMA_ABSOLUTE_FLOOR_MS` (at slot 7), never below it - the mechanism that actually
// lets a champion's own BASE sigma sharpen past its league's median floor, which before this
// commit only the additive `timingSigmaMs` ladder offset could do (and BB-2c commit 5's own
// comment already noted Majors' champion row sat with zero headroom left on that axis alone).
export const SLOT_SIGMA_DESCENT = { bindThroughSlot: 4, descentToSlot: 7 };

export default {
  RULES_V, LEAGUES, SEASON, POINTS, CAPS, START_POINTS_PER_SIDE, START_CAP,
  HIT_SKILL_IDS, PITCH_SKILL_IDS, SKILL_IDS, PRESETS,
  PITCH_TYPES, PITCH_UNLOCKS, TITLE_PITCH_UNLOCKS, unlockedPitchesFor, PITCH_TRAVEL_MULT, READOUT,
  FEEL, FIELD_SCALE, CPU, CPU_LEVEL_SHORTFALL, WEAKSPOT_WINDOW,
  PATTERN_WINDOW, PATTERN_WEIGHTS, FOUL_LINE_DEG, PARK_GEOMETRY, FIELD, SHIFT_WINDOW, SHIFT_MAX_DEG, SHIFT_MIN_SAMPLES, PARKS,
  TEAM_STYLES, SHIFTERS_ADJUST_OUT_ZONES, STYLE_BEHAVIOR, STYLE_STRENGTH_DELTA, SIGMA_MS_PER_WINRATE_PP, CHASE_PER_WINRATE_PP,
  TEAM_LADDER_OFFSETS, LEAGUE_LADDER_STYLES,
  TEAM_STYLE_WEIGHTS, LEFTY_RATE,
  SKILL_EFFECT, SKILL_EFFECT_MAX_PER_POINT, BASE_EXIT_VELO, CARRY_SCALE, HR_CARRY_FRAC, MEDIAN_CARRY_FRAC,
  MEDIAN_HIT_POW_FRAC, LEAGUE_POWER_SCALE, DOUBLE_DEPTH_FRAC, TRIPLE_DEPTH_FRAC, MIN_EXIT_VELO_MPH, CARRY_ZERO_MPH,
  LINE_THROUGH_Q, LINE_THROUGH_MAX_FT, MECHANICS, RESERVED_PHASE_6,
  BRACKET_MODEL, PLAYOFF_HOME, STANDINGS_MODEL, SCHEDULE_SHAPE,
  GAP_DEG, BLOOP_BAND_FT, SPEED_SURPRISE_MS_PER_MULT,
  AIM_CORNER_CHANCE_MULT, AIM_INZONE_BIAS, AIM_CORNER_BIAS_BASE, AIM_CORNER_BIAS_SCALE,
  WEAKSPOT_AIM_SCATTER, SPEED_DELTA_DEADBAND, FOOL_PENALTY_MS_SCALE, FOOL_BONUS_MS_SCALE,
  LOCATION_LEAN_WEIGHT, VARIETY_REPEAT_BASE_CHANCE,
  CPU_SIGMA_MIN_MS, CPU_SIGMA_ABSOLUTE_FLOOR_MS, CPU_PLACEMENT_MIN, CHAMPION_CEILING, SLOT_SIGMA_DESCENT,
  LADDER_SHAPE, CLIFF_TOP_GAP_FRAC, STEEP_SHALLOW_GAP_FRAC, ladderGapWeights, CHAMPION_SIGMA_HEADROOM_FRAC,
};
