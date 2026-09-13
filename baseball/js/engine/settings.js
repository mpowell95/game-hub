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
export const CPU = {
  little:     { timingSigmaMs: 90, swingIn: 0.90, chase: 0.55, fool: 0.45, guess: 0.10,
    pitchMix: { fastball: 6, changeup: 1 }, cornerBias: 0.08, patternWeight: 0.04, weakSpotWeight: 0 },
  highschool: { timingSigmaMs: 75, swingIn: 0.85, chase: 0.40, fool: 0.35, guess: 0.20,
    pitchMix: { fastball: 3, changeup: 2, curveball: 2 }, cornerBias: 0.20, patternWeight: 0.13, weakSpotWeight: 0 },
  college:    { timingSigmaMs: 55, swingIn: 0.78, chase: 0.28, fool: 0.25, guess: 0.30,   // [Tested] doc §14 - the prototype's own tier, five original fields unchanged
    pitchMix: { fastball: 2, changeup: 2, curveball: 2, slider: 2 }, cornerBias: 0.33, patternWeight: 0.23, weakSpotWeight: 0.06 },
  minors:     { timingSigmaMs: 45, swingIn: 0.72, chase: 0.18, fool: 0.18, guess: 0.45,
    pitchMix: { fastball: 2, changeup: 2, curveball: 2, slider: 2, knuckleball: 1.5 }, cornerBias: 0.46, patternWeight: 0.36, weakSpotWeight: 0.20 },
  majors:     { timingSigmaMs: 35, swingIn: 0.65, chase: 0.08, fool: 0.10, guess: 0.60,
    // Only the six pitches a CPU roster (never title-gated, doc §8: "CPU stats do not track or
    // react to your stats") actually has unlocked at Majors with 0 titles - eephus/cutter would
    // sit in this table forever unused, since `unlockedPitchesFor('majors', 0)` never grants them.
    pitchMix: { fastball: 1.5, changeup: 1.5, curveball: 1.5, slider: 1.5, knuckleball: 1.5, screwball: 1.5 },
    cornerBias: 0.55, patternWeight: 0.52, weakSpotWeight: 0.40 },
};
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
// majors:5.3} (effective caps 10/14/16.5/18.7/20.7). That Phase 2 retune was tuned against a
// contact model swing.js is about to change (timing quality is about to become continuous and
// multiply power, per this phase's contact-quality axis) - retuning this lever again happens once,
// AFTER the new contact model lands, from this reverted base (BB-2a step 6).
export const CPU_LEVEL_SHORTFALL = { little: 0, highschool: 0, college: 1.5, minors: 3.3, majors: 5.3 };

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
  majors:     { fenceFt: { left: 330, leftCenter: 375, center: 400, rightCenter: 375, right: 330 }, outZoneMult: 1.05, fieldScale: 1.10 },
};

// How wide the fair-territory pattern-memory/shift window is, and how far a "shifters" team may
// rotate its out-zone sectors toward a batter's own spray tendency (doc §9, [Locked]: "some teams
// shift their out zones toward where you tend to hit" - SHIFTERS_ADJUST_OUT_ZONES below names the
// rule; these two numbers are how much, Draft, new (not in the doc's own open-items list).
export const SHIFT_WINDOW = 10;   // Draft - last N balls in play, per batter, averaged for the shift
export const SHIFT_MAX_DEG = 15;  // Draft - the shift can never rotate a sector past this many degrees

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

// BB-2a step 5 (2026-09-12): STRENGTH now comes from here, not from TEAM_STYLES or a post-hoc sort.
// Eight per-slot skill-point OFFSETS around `effectiveCapFor(league)`, weakest (slot 0) to
// strongest (slot 7) - `makeLeague` applies one per slot and orders teams BY SLOT, never by a
// measured `teamStrength()`. Draft, new - an even spread with a slightly steeper final two slots,
// so the top of the ladder (the semifinal/championship teams, doc §8: "the championship opponent
// is always the toughest team in the league") is more clearly separated from the pack than the
// slots below it. Clamped against the league's own CAPS in `effectiveCapFor`'s own style (never
// above the raw league cap, per doc §8) inside `teams.js`'s `makeLeague`.
export const TEAM_LADDER_OFFSETS = [-6, -4, -3, -2, -1, 0, 2, 4];

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
  hitAcc:    { contactRadiusInPerPt: 0.15, whiffReductionPerPt: 0.01 },  // "bigger timing window and sweet spot" - reverted 2026-09-12 (BB-2a step 1) from 0.12/0.008 (measured against the pre-contact-model swing.js); retuned again once from this base after the contact model lands (BB-2a step 6)
  hitPow:    { exitVeloMphPerPt: 0.6 },                                  // "more distance, stronger charged swings" - reverted 2026-09-12 (BB-2a step 1) from 0.5, same reason
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
  doublePlayChance: 0.45,           // Draft [Open item 26] - reverted 2026-09-12 (BB-2a step 1) from 0.40 (measured 2026-09-12 against the pre-contact-model swing.js) back to 0.45; the doc locks that a double play CAN happen, not how often; retuned again once from this base after the contact model lands (BB-2a step 6)
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

// Calibrated so a Statcast-typical 105mph/30deg batted ball (a real, well-struck home run swing)
// carries about 400ft: 6.2 -> (105-30) * sin(60deg) * 6.2 ~= 402ft. Draft [Open item 23] - moved
// here from outcomes.js's own local const so every magic number in the engine has one home.
export const CARRY_SCALE = 6.2;

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

export default {
  RULES_V, LEAGUES, SEASON, POINTS, CAPS, START_POINTS_PER_SIDE, START_CAP,
  HIT_SKILL_IDS, PITCH_SKILL_IDS, SKILL_IDS, PRESETS,
  PITCH_TYPES, PITCH_UNLOCKS, TITLE_PITCH_UNLOCKS, unlockedPitchesFor, PITCH_TRAVEL_MULT, READOUT,
  FEEL, FIELD_SCALE, CPU, CPU_LEVEL_SHORTFALL, WEAKSPOT_WINDOW,
  PATTERN_WINDOW, PATTERN_WEIGHTS, FOUL_LINE_DEG, PARK_GEOMETRY, FIELD, SHIFT_WINDOW, SHIFT_MAX_DEG, PARKS,
  TEAM_STYLES, SHIFTERS_ADJUST_OUT_ZONES, STYLE_BEHAVIOR, TEAM_LADDER_OFFSETS, LEAGUE_LADDER_STYLES,
  TEAM_STYLE_WEIGHTS, LEFTY_RATE,
  SKILL_EFFECT, SKILL_EFFECT_MAX_PER_POINT, CARRY_SCALE, LINE_THROUGH_Q, LINE_THROUGH_MAX_FT, MECHANICS, RESERVED_PHASE_6,
};
