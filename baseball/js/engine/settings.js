// settings.js : every named constant the baseball engine plays by, in one pure, dependency-free
// module. No DOM, no storage, no network, no wall clock - a settings object is data, nothing else.
//
// STATUS: "Baseball Game Design Doc v8" (cited by BB-1-phase-1-handoff.md for the values below) is
// NOT present anywhere in this repository or session - confirmed by exhaustive search before this
// file was written. Every numeric table below that is not already frozen by
// `baseball/CLAUDE.md` (the stats shape, league ids, trophy/league integers) is therefore an
// INVENTED placeholder, not a transcription from a real source. Each such value is marked
// `// Draft [Open item N]` at the line it lives on, following this repo's own existing
// Draft/`[Open]` tagging convention (see the root CLAUDE.md and PARKS/PRESETS docs elsewhere in
// this codebase for the same pattern). A future phase with the real doc should replace every
// tagged line; nothing here should be assumed authoritative about how the game FEELS.
//
// RULES_V is this module's own schema version - bump it, and only it, when a shape below changes
// in a way old snapshots would misread (see game.js's validateSnapshot).

export const RULES_V = 1;

// ---------------------------------------------------------------------------------------------
// Leagues (frozen: baseball/CLAUDE.md's ladder order and BB_LEAGUE_MIN/MAX in js/game-stats.js)
export const LEAGUES = ['little', 'highschool', 'college', 'minors', 'majors'];

// ---------------------------------------------------------------------------------------------
// A season/career shape. Draft: how many games/innings a season plays, and how a career escalates.
export const SEASON = {
  gamesPerSeason: 12,          // Draft [Open item 1] - a full 162-game MLB season has no place in a phone game
  inningsPerGame: 6,           // Draft [Open item 2] - shorter than 9 for the same reason
  playoffTeams: 4,             // Draft [Open item 3]
};

// ---------------------------------------------------------------------------------------------
// Points/caps: the player-build economy referenced by the phase-1 handoff's own "Rules the doc
// does not settle" section as something this phase must invent if the doc is unavailable.
export const POINTS = {
  little: 40,       // Draft [Open item 4] - per-league point budget, rising with league difficulty
  highschool: 55,   // Draft [Open item 4]
  college: 70,      // Draft [Open item 4]
  minors: 85,       // Draft [Open item 4]
  majors: 100,      // Draft [Open item 4]
};

export const CAPS = {
  perSkill: 20,     // Draft [Open item 5] - no single skill may exceed this, any league
};

export const START_POINTS_PER_SIDE = POINTS.little;   // Draft [Open item 4] (derived, not separately invented)
export const START_CAP = CAPS.perSkill;                // Draft [Open item 5] (derived, not separately invented)

// A build preset: a ready-made point allocation for a player who does not want to hand-tune one.
export const PRESETS = {
  balanced:  { contact: 12, power: 12, speed: 12, arm: 12, fielding: 12 },  // Draft [Open item 6]
  slugger:   { contact: 8,  power: 20, speed: 6,  arm: 10, fielding: 10 },  // Draft [Open item 6]
  speedster: { contact: 14, power: 4,  speed: 20, arm: 8,  fielding: 14 },  // Draft [Open item 6]
  ace:       { contact: 10, power: 6,  speed: 8,  arm: 20, fielding: 10 },  // Draft [Open item 6]
};

export const SKILL_IDS = ['contact', 'power', 'speed', 'arm', 'fielding'];

// ---------------------------------------------------------------------------------------------
// Pitching. Which pitch types exist, when they unlock (by league), and their thrown profile
// (speed in mph, movement in inches, control difficulty as a spread in degrees of aim error).
export const PITCH_TYPES = ['fastball', 'curveball', 'slider', 'changeup', 'sinker', 'splitter'];

export const PITCH_UNLOCKS = {              // Draft [Open item 7] - which league unlocks which pitch
  little: ['fastball', 'changeup'],
  highschool: ['fastball', 'changeup', 'curveball'],
  college: ['fastball', 'changeup', 'curveball', 'slider'],
  minors: ['fastball', 'changeup', 'curveball', 'slider', 'sinker'],
  majors: ['fastball', 'changeup', 'curveball', 'slider', 'sinker', 'splitter'],
};

export const PITCH_PROFILE = {              // Draft [Open item 8] - speed/movement/control per pitch
  fastball:  { speedMph: 92, moveIn: 2,  controlDeg: 3.0 },
  sinker:    { speedMph: 89, moveIn: 6,  controlDeg: 3.6 },
  curveball: { speedMph: 76, moveIn: 12, controlDeg: 4.5 },
  slider:    { speedMph: 84, moveIn: 8,  controlDeg: 4.0 },
  changeup:  { speedMph: 80, moveIn: 5,  controlDeg: 3.4 },
  splitter:  { speedMph: 83, moveIn: 10, controlDeg: 4.8 },
};

// The pitch-speed readout the UI (a later phase) would show, in labeled mph bands.
export const READOUT = {                    // Draft [Open item 9]
  bands: [
    { max: 78, label: 'slow' },
    { max: 86, label: 'medium' },
    { max: 94, label: 'fast' },
    { max: Infinity, label: 'blazing' },
  ],
};

// ---------------------------------------------------------------------------------------------
// FEEL: timing constants. `engine` values are consumed by the simulation itself (fixed timestep,
// pitch-to-plate travel, swing windows); `ui` values are for a future rendering phase and are
// NOT consumed by anything in this phase - kept here so the shape exists once, not invented twice.
export const FEEL = {
  engine: {
    dtS: 1 / 120,                 // fixed timestep, seconds - matches Hill Climb's DT (1/120) and Pinball's tick family
    maxSteps: 5,                  // catch-up cap per advance() call: never spiral on a slow/batched tick
    pitchFlightS: 0.42,           // Draft [Open item 10] - release to plate, seconds, at a league-average fastball
    swingWindowMs: 180,           // Draft [Open item 11] - contact window half-width around the pitch's plate time
    fieldingReactionS: 0.25,      // Draft [Open item 12] - CPU fielder's reaction delay after a ball is put in play
  },
  ui: {
    pitchWindupS: 0.6,            // Draft [Open item 13] - not consumed this phase; for a future UI phase
    swingAnimS: 0.35,             // Draft [Open item 13]
  },
};

// ---------------------------------------------------------------------------------------------
// CPU: per-league AI parameters. Higher leagues throw more accurately and swing more selectively.
export const CPU = {                        // Draft [Open item 14]
  little:     { pitchControlMul: 1.6, swingDiscipline: 0.35, contactSkill: 0.35 },
  highschool: { pitchControlMul: 1.3, swingDiscipline: 0.50, contactSkill: 0.50 },
  college:    { pitchControlMul: 1.0, swingDiscipline: 0.62, contactSkill: 0.62 },
  minors:     { pitchControlMul: 0.8, swingDiscipline: 0.74, contactSkill: 0.74 },
  majors:     { pitchControlMul: 0.6, swingDiscipline: 0.85, contactSkill: 0.85 },
};

// How far a CPU batter/pitcher's effective skill trails a human of the same league, expressed as
// a flat point deduction from the league's own point budget - what CPU_LEVEL_SHORTFALL means.
export const CPU_LEVEL_SHORTFALL = 8;       // Draft [Open item 15]

// ---------------------------------------------------------------------------------------------
// Pattern memory: how a batter's recent pitch history is weighted when an agent decides whether
// to guess a pitch type. A short sliding window, most-recent pitches weighted highest.
export const PATTERN_WINDOW = 6;            // Draft [Open item 16]
export const PATTERN_WEIGHTS = [1.0, 0.85, 0.7, 0.55, 0.4, 0.3]; // Draft [Open item 16], length === PATTERN_WINDOW

// ---------------------------------------------------------------------------------------------
// Field geometry, in feet, home plate at the origin, center field straight out along +y.
export const FIELD = {                      // Draft [Open item 17]
  basePathFt: 90,
  pitcherDistFt: 60.5,
  foulLineDeg: 45,               // each foul line sits 45 degrees off the center-field axis
  outfieldWallFt: { left: 330, center: 400, right: 330 },
  infieldDirtRadiusFt: 95,
};

// Named ballparks, each an override of FIELD's outfield distances (and nothing else this phase -
// wall height/quirks are a later phase's concern). `default` is what an unnamed park resolves to.
export const PARKS = {                      // Draft [Open item 18]
  default:  { left: 330, center: 400, right: 330 },
  bandbox:  { left: 302, center: 375, right: 302 },
  canyon:   { left: 355, center: 430, right: 355 },
  asymmetric: { left: 315, center: 410, right: 340 },
};

// ---------------------------------------------------------------------------------------------
// Team generation styles: a named weighting of how a generated team's points lean across skills.
// teams.js's makeTeam samples one of these (weighted by a league's TEAM_STYLES entry) per team.
export const TEAM_STYLES = {                // Draft [Open item 19]
  balanced:    { contact: 1, power: 1, speed: 1, arm: 1, fielding: 1 },
  powerHouse:  { contact: 0.8, power: 1.6, speed: 0.7, arm: 1, fielding: 0.9 },
  smallBall:   { contact: 1.3, power: 0.6, speed: 1.5, arm: 0.9, fielding: 1.1 },
  defenseFirst:{ contact: 0.9, power: 0.8, speed: 1.0, arm: 1.3, fielding: 1.4 },
};

// Per league, the relative weight of each style being picked for a generated team (weights, not
// probabilities - pickWeighted normalizes). Every league offers every style; the league only
// shifts which is likeliest.
export const TEAM_STYLE_WEIGHTS = {         // Draft [Open item 19]
  little:     { balanced: 3, powerHouse: 1, smallBall: 2, defenseFirst: 1 },
  highschool: { balanced: 3, powerHouse: 1.5, smallBall: 1.5, defenseFirst: 1 },
  college:    { balanced: 2, powerHouse: 2, smallBall: 1.5, defenseFirst: 1.5 },
  minors:     { balanced: 2, powerHouse: 2, smallBall: 1.5, defenseFirst: 2 },
  majors:     { balanced: 2, powerHouse: 2.5, smallBall: 1, defenseFirst: 2.5 },
};

export const LEFTY_RATE = 0.15;             // Draft [Open item 20] - fraction of generated players batting/throwing left

// ---------------------------------------------------------------------------------------------
// SKILL_EFFECT: how each of the five point-bought skills maps onto engine behavior. Every entry
// is a per-point delta from a level-0 baseline; a player's actual skill value (0..CAPS.perSkill)
// multiplies it. Kept as flat linear deltas deliberately - a curve is a tuning decision with
// nothing here to measure it against.
export const SKILL_EFFECT = {               // Draft [Open item 21]
  contact:  { contactRadiusInPerPt: 0.15, whiffReductionPerPt: 0.01 },
  power:    { exitVeloMphPerPt: 0.6 },
  speed:    { sprintFtPerSPerPt: 0.08, stealSuccessPerPt: 0.01 },
  arm:      { throwMphPerPt: 0.5, throwAccuracyPerPt: 0.01 },
  fielding: { rangeFtPerPt: 0.3, errorReductionPerPt: 0.012 },
};

// ---------------------------------------------------------------------------------------------
// Rules the doc does not settle, decided here (in addition to whatever the phase-1 handoff's own
// text already pre-decided, which lives in the handoff document itself, not in this file):
//
// 1. A walk-off ends the game the instant the winning run scores, mid-inning, without finishing
//    the batting team's turn - the standard rule, applied because nothing suggested otherwise.
// 2. Extra innings play full innings (both sides bat) until a winner exists; no tiebreaker-runner
//    rule (no invented "ghost runner on second") is modeled this phase, since the design doc might
//    specify one and inventing one now would be exactly the kind of thing rule 4 (THE LAW, "never
//    fabricate") warns against transplanted into gameplay - simpler to leave it real-rules-standard
//    until told otherwise.
// 3. A tie after the scheduled innings goes to one further inning, repeating rule 2, forever if
//    needed (bounded in practice by MECHANICS.maxExtraInnings below, a safety valve for a
//    deterministic test harness, not a rule the game exposes to a player as a hard stop).
export const MECHANICS = {
  walkoffEndsImmediately: true,
  maxExtraInnings: 20,          // Draft [Open item 22] - a safety valve, not a stated game rule
  outsPerInning: 3,
  strikesForOut: 3,
  ballsForWalk: 4,
  basesLoadedForceAll: true,
};

export default {
  RULES_V, LEAGUES, SEASON, POINTS, CAPS, START_POINTS_PER_SIDE, START_CAP, PRESETS, SKILL_IDS,
  PITCH_TYPES, PITCH_UNLOCKS, PITCH_PROFILE, READOUT, FEEL, CPU, CPU_LEVEL_SHORTFALL,
  PATTERN_WINDOW, PATTERN_WEIGHTS, FIELD, PARKS, TEAM_STYLES, TEAM_STYLE_WEIGHTS, LEFTY_RATE,
  SKILL_EFFECT, MECHANICS,
};
