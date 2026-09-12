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
// would have the wrong keys entirely under the new shape.

export const RULES_V = 2;

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
const CPU_PROTOTYPE_TIER = { timingSigmaMs: 55, swingIn: 0.78, chase: 0.28, fool: 0.25, guess: 0.3 };
export const CPU = {
  little: { ...CPU_PROTOTYPE_TIER },     // Draft [Open item 3] - copied placeholder, not yet spread by league
  highschool: { ...CPU_PROTOTYPE_TIER }, // Draft [Open item 3]
  college: { ...CPU_PROTOTYPE_TIER },    // [Tested] doc §14 - this IS the prototype's own tier
  minors: { ...CPU_PROTOTYPE_TIER },     // Draft [Open item 3]
  majors: { ...CPU_PROTOTYPE_TIER },     // Draft [Open item 3]
};
// [Locked] doc §8: Little League throws mostly fastballs down the middle and swings at almost
// anything; each league up mixes pitches more, works corners more, chases less; Majors attacks
// weak spots and rarely chases. Encoding THAT per-league spread (phase 2's simulator's job, per
// the doc's own "the phase 2 simulator spreads them") is Open item 3, not done here.

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
export const CPU_LEVEL_SHORTFALL = { little: 0, highschool: 0, college: 1.5, minors: 3.3, majors: 5.3 };

// ---------------------------------------------------------------------------------------------
// Pattern memory (doc §8's "CPU batters read your patterns"): the last N pitches to one batter,
// newest weighted most. [Locked] window; [Draft] weights.
export const PATTERN_WINDOW = 3;                    // [Locked] doc §8 - "the last 3 pitches"
export const PATTERN_WEIGHTS = [0.5, 0.3, 0.2];     // [Draft] doc §8, newest first, length === PATTERN_WINDOW

// ---------------------------------------------------------------------------------------------
// Field geometry, in feet (doc §15's units note), home plate at the origin, center field along +y.
// Still entirely INVENTED - doc §10 explicitly leaves "exact zone sizes and fence distances per
// league" open (Open item 7). Kept as phase 1 shipped it; tagged here rather than rebuilt, per
// BB-1a's own instruction.
export const FIELD = {                      // Draft [Open item 7]
  basePathFt: 90,
  pitcherDistFt: 60.5,
  foulLineDeg: 45,               // each foul line sits 45 degrees off the center-field axis
  outfieldWallFt: { left: 330, center: 400, right: 330 },
  infieldDirtRadiusFt: 95,
};

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
export const TEAM_STYLES = {                          // Draft [Open item 25]
  sluggers:     { hitAcc: 0.7, hitPow: 1.8, hitSpd: 0.6, pitchSpd: 1.0, pitchAcc: 0.9, pitchSpin: 0.9 },
  smallBall:    { hitAcc: 1.3, hitPow: 0.5, hitSpd: 1.6, pitchSpd: 0.9, pitchAcc: 1.0, pitchSpin: 0.9 },
  patient:      { hitAcc: 1.6, hitPow: 0.9, hitSpd: 0.9, pitchSpd: 0.9, pitchAcc: 1.0, pitchSpin: 0.9 },
  flamethrowers:{ hitAcc: 0.9, hitPow: 0.9, hitSpd: 0.9, pitchSpd: 1.8, pitchAcc: 0.8, pitchSpin: 0.7 },
  junkballers:  { hitAcc: 0.9, hitPow: 0.8, hitSpd: 0.9, pitchSpd: 0.6, pitchAcc: 1.0, pitchSpin: 1.8 },
  shifters:     { hitAcc: 1.0, hitPow: 1.0, hitSpd: 1.0, pitchSpd: 1.0, pitchAcc: 1.2, pitchSpin: 1.0 },
  balanced:     { hitAcc: 1.0, hitPow: 1.0, hitSpd: 1.0, pitchSpd: 1.0, pitchAcc: 1.0, pitchSpin: 1.0 },
  aces:         { hitAcc: 0.9, hitPow: 0.9, hitSpd: 0.8, pitchSpd: 1.4, pitchAcc: 1.5, pitchSpin: 1.1 },
};
// "Shifters" also names a BEHAVIOR the doc locks - "some teams shift their out zones toward where
// you tend to hit" (doc §9) - not a skill weighting at all, and not modeled this phase (there is
// no per-team out-zone adjustment mechanic yet). Flagged rather than silently dropped.
export const SHIFTERS_ADJUST_OUT_ZONES = true; // [Locked] doc §9 - not yet consumed by outcomes.js

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
  hitAcc:    { contactRadiusInPerPt: 0.15, whiffReductionPerPt: 0.01 }, // "bigger timing window and sweet spot"
  hitPow:    { exitVeloMphPerPt: 0.6 },                                  // "more distance, stronger charged swings"
  hitSpd:    { sprintFtPerSPerPt: 0.08, stealSuccessPerPt: 0.01 },       // "beat out grounders, stretch hits, steal/bunt" - unused this phase, no baserunning between pitches yet (see MECHANICS.reservedForPhase6 below)
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
  doublePlayChance: 0.45,           // Draft [Open item 26] - the doc locks that it CAN happen, not how often
  maxExtraInnings: 50,              // [Locked] doc §3 - explicitly a safety valve only, never a stated rule
  outsPerInning: 3,
  strikesForOut: 3,
  ballsForWalk: 4,
  foulNeverThirdStrike: true,       // [Locked] doc §3 - "a foul can never be strike 3" (already the engine's behavior)
  basesLoadedForceAll: true,
};

// Reserved for phase 6 (doc §3/§17 Open item 8): steal, bunt, and pickoff are [Locked] FEATURES
// with reserved input slots, but "how each works in play" is undecided and no baserunning happens
// between pitches this phase (bases.js's own header). Named here so a future phase does not have
// to rediscover that the hook is deliberately absent rather than forgotten.
export const RESERVED_PHASE_6 = ['steal', 'bunt', 'pickoff'];

export default {
  RULES_V, LEAGUES, SEASON, POINTS, CAPS, START_POINTS_PER_SIDE, START_CAP,
  HIT_SKILL_IDS, PITCH_SKILL_IDS, SKILL_IDS, PRESETS,
  PITCH_TYPES, PITCH_UNLOCKS, TITLE_PITCH_UNLOCKS, unlockedPitchesFor, PITCH_TRAVEL_MULT, READOUT,
  FEEL, FIELD_SCALE, CPU, CPU_LEVEL_SHORTFALL,
  PATTERN_WINDOW, PATTERN_WEIGHTS, FIELD, PARKS,
  TEAM_STYLES, SHIFTERS_ADJUST_OUT_ZONES, TEAM_STYLE_WEIGHTS, LEFTY_RATE,
  SKILL_EFFECT, SKILL_EFFECT_MAX_PER_POINT, MECHANICS, RESERVED_PHASE_6,
};
