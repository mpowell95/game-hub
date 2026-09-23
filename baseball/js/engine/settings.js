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

// Bumped 3 -> 4 for R16 (the career economy, rebuilt from measurement): the season shape itself
// moved (per-league game counts, a 4-team Little League, per-league playoff formats) and the
// contact/flight-time constants an in-flight at-bat is scored against moved with it, so a mid-game
// snapshot taken under RULES_V 3 is not a game this build can finish honestly. THE LAW: the CAREER
// document is untouched by this - `career.js` reads a season's own snapshotted shape, an old
// season keeps playing to its own 12 games, and only the mid-AT-BAT engine snapshot is refused
// (game.js's own [Locked] forward-only rule), which costs one game's progress and no history.
export const RULES_V = 4;

// ---------------------------------------------------------------------------------------------
// Leagues (frozen: baseball/CLAUDE.md's ladder order and BB_LEAGUE_MIN/MAX in js/game-stats.js;
// also doc section 4's ladder - little/highschool/college/minors/majors, [Locked]).
export const LEAGUES = ['little', 'highschool', 'college', 'minors', 'majors'];

// ---------------------------------------------------------------------------------------------
// Season/career shape (doc section 4).
export const SEASON = {
  // R16, measured (old value: the only season length, 12 everywhere). FROZEN FALLBACK, never
  // deleted (THE LAW rule 5): a season document written before R16 carries a 12-entry schedule and
  // no `games` of its own, and `career.js` falls back to this number for it so an in-progress
  // season still plays to its own end.
  gamesPerSeason: 12,       // [Draft] doc §4 - "12 regular season games per league across 8 opponents"
  // R16, measured (old value: none - every league played `gamesPerSeason`). Matt, 2026-09-22:
  // "Little league should have a shorter season." Little League is five games at most (three
  // regular, a semifinal, a final); the slate lengthens every rung up.
  gamesPerLeague: { little: 3, highschool: 8, college: 10, minors: 12, majors: 14 },
  // R16, measured (old value: none - every league was all eight slots of `makeLeague`). Matt:
  // "And all teams should make the playoffs... just little league." A 4-team Little League is the
  // player plus makeLeague slots 1, 4 and 7 - a weak, a middle and the champion - so the tutorial
  // still meets the whole spread in three games. Every other league is all eight.
  leagueSlots: {
    little: [1, 4, 7],
    highschool: [0, 1, 2, 3, 4, 5, 6, 7],
    college: [0, 1, 2, 3, 4, 5, 6, 7],
    minors: [0, 1, 2, 3, 4, 5, 6, 7],
    majors: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  // R16, measured (old value: none - every league was 'top4'). 'all' is the everyone-in bracket
  // (semifinal + final over a 4-team league, so the tutorial can never end in "missed the
  // playoffs"); 'top4' is doc §4's own "Top 4 of 9 make the playoffs", unchanged above it.
  playoffFormat: { little: 'all', highschool: 'top4', college: 'top4', minors: 'top4', majors: 'top4' },
  inningsPerGame: 3,        // [Locked] doc §3 - "3 innings" (was invented at 6 in phase 1; corrected)
  cpuTeamsPerLeague: 8,     // [Locked] doc §4/§9 - "8 CPU teams per league"
  leagueSize: 9,            // [Locked] doc §4 - you + 8 CPU teams; "Top 4 of 9 make the playoffs"
  playoffTeams: 4,          // [Locked] doc §4 - "Top 4 of 9 make the playoffs"
  playoffRounds: ['semifinal', 'championship'], // [Locked] doc §4 - no quarterfinal, dropped by name
};

/** R16: how many regular-season games a league plays, with `SEASON.gamesPerSeason` as the frozen
 *  fallback for a league id this table does not name. `career.js` snapshots the answer at
 *  `startSeason`, so a tuning deploy applies from the NEXT season and never rewrites one in
 *  progress (doc §15, [Locked]). */
export function gamesForLeague(league) {
  const n = SEASON.gamesPerLeague && SEASON.gamesPerLeague[league];
  return Number.isFinite(n) && n > 0 ? n : SEASON.gamesPerSeason;
}
/** R16: which `makeLeague` slots this league's season is played against (0 weakest .. 7 champion).
 *  All eight for every league but Little League. */
export function slotsForLeague(league) {
  const s = SEASON.leagueSlots && SEASON.leagueSlots[league];
  return Array.isArray(s) && s.length ? s.slice() : [0, 1, 2, 3, 4, 5, 6, 7];
}
/** R16: 'all' (everyone in) or 'top4'. */
export function playoffFormatFor(league) {
  const f = SEASON.playoffFormat && SEASON.playoffFormat[league];
  return f === 'all' ? 'all' : 'top4';
}

// ---------------------------------------------------------------------------------------------
// Points earned per Career result, by league (doc section 7). NOT a team-generation budget (that
// concept moved to CAPS/CPU_LEVEL_SHORTFALL below) - this is what a WIN/LOSS/trophy pays toward
// the player's own skill points. Not consumed by this phase's engine (no career/progression layer
// exists yet); kept here so a later phase has one source rather than re-deriving the doc's table.
// R16, measured: the whole table moved, because a season's LENGTH moved under it. Little
// League's 3-0 sweep plus a Gold pays 6+6+6+12 = 30, which is exactly the 30 of cap room a start
// build has (6 skills, 15 + 15 spent, cap 10) - the tutorial ends with every skill at the cap and
// a point after every single game. Every other row is set so a good season roughly fills the rung
// it opens (the study's "seasons to fill the cap room" column: 1.0 / 1.1 / 1.4 / 1.7 / 3.6).
export const POINTS = {                 // [Draft] doc §7 - "numbers, to tune after playtesting"
  little:     { win: 6, loss: 2, bronze: 4, silver: 8, gold: 12 },  // R16, measured (was 3 / 1 / 3 / 5 / 8)
  highschool: { win: 3, loss: 1, bronze: 3, silver: 5, gold: 8 },   // R16, measured (was 2 / 1 / 2 / 4 / 6)
  college:    { win: 2, loss: 0, bronze: 3, silver: 5, gold: 8 },   // R16, measured (was 1 / 0 / 2 / 4 / 6)
  minors:     { win: 2, loss: 0, bronze: 2, silver: 4, gold: 7 },   // R16, measured (was 1 / 0 / 1 / 2 / 4)
  majors:     { win: 1, loss: 1, bronze: 2, silver: 4, gold: 6 },   // R16, measured (was 1 / 0 / 1 / 2 / 3)
};
// R19 (docs/BASEBALL-3D-BUILD.md section 9): LEAGUES WHERE POINTS ARE SPENT BETWEEN SEASONS. Matt
// chose it, 2026-09-23. In the Majors the points a season pays can be spent once that season is
// over, never mid-season. Measured with sim-baseball-career.mjs: spending mid-season let a strong
// player climb toward the 26 cap before his first World Series and win it first try 54% of the
// time; banked to the season's end it is 32%, the median player's first title stays at 11 seasons,
// and a maxed Perfect Season is untouched. Nothing is lost: the points wait in `unspent`.
export const SPEND_AFTER_SEASON = { majors: true };
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
//
// R18 (docs/BASEBALL-3D-BUILD.md section 9): cut from seven to three. Matt, on the shipped seven:
// "Simplify the presets. Those names don't help at all. They make it way more confusing." Balanced
// is the old twoWayStar row unchanged; Hitter and Pitcher are a simple lean (7/7/1) on their own
// side while the OTHER side stays balanced (5/5/5), so a player choosing "Hitter" still pitches
// competently and vice versa. Order within a side is Accuracy/Power/Speed for hitting,
// Speed/Accuracy/Spin for pitching (`HIT_SKILL_IDS`/`PITCH_SKILL_IDS` above).
export const PRESETS = {
  balanced: { hitAcc: 5, hitPow: 5, hitSpd: 5, pitchSpd: 5, pitchAcc: 5, pitchSpin: 5 },
  hitter:   { hitAcc: 7, hitPow: 7, hitSpd: 1, pitchSpd: 5, pitchAcc: 5, pitchSpin: 5 },
  pitcher:  { hitAcc: 5, hitPow: 5, hitSpd: 5, pitchSpd: 7, pitchAcc: 7, pitchSpin: 1 },
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
//
// R11 (docs/BASEBALL-3D-BUILD.md section 9): LITTLE LEAGUE IS FASTBALL ONLY, career included.
// Matt, 2026-09-21: "Little league should be easy and the pitches slow and only 'fastballs'
// should be able to be thrown." Changeup moves down to High School, alongside curveball - it does
// not vanish, it is simply no longer the very first thing a brand-new career unlocks alongside
// the fastball.
//
// Playtest 1 (Matt, 2026-09-23): the changeup is back at Little League, for the player AND the
// CPU (overrules R11's fastball-only rule; no sim run, Matt's call).
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
 *  agents always call this with `wsTitles` omitted/0.
 *
 *  R11 (docs/BASEBALL-3D-BUILD.md section 9): THE ALL-EIGHT QUICK PLAY OVERRIDE IS GONE. RA's own
 *  reasoning ("a Quick Play game is not career progress, so gating an exhibition behind titles
 *  nobody in it has earned only ever hid six pitches") is overruled by Matt, 2026-09-21: "only
 *  'fastballs' should be able to be thrown" at Little League, which all-eight directly
 *  contradicted - a Little League Quick Play game handed the human a curveball no Little League
 *  pitcher has ever thrown. Quick Play now plays the SAME ladder career does. `opts` is kept, not
 *  removed, purely for call-site compatibility: every existing `{ quickPlay: true }` caller
 *  (`ui.js`, `agents.js`, test fixtures) still runs unmodified, it is simply a no-op now. */
export function unlockedPitchesFor(league, wsTitles = 0, opts = null) {
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
  screwball: 1.2,        // Locked 2026-09-23 (doc item 9, Matt kept today's feel)
  eephus: 1.9,           // Locked 2026-09-23 (doc item 9); shown to players as "Blooper"
  cutter: 1.05,          // Locked 2026-09-23 (doc item 9)
};

// The mph readout by league (doc §11/§14). Was DISPLAY ONLY until R11 (docs/BASEBALL-3D-BUILD.md
// section 9): "How fast the ball actually travels is a separate tuned value" was Matt's own
// measured bug, not a rule to keep - `pitch.js`'s `timeToPlateS` scaled ONLY by the pitcher's
// skill points off a flat Majors-fastball baseline, so a Little League 55 mph readout flew to the
// plate in the same time as a Majors 95 mph one. `pitch.js` now reads READOUT[league][type] (or
// this league's own fastball row, for a type with none - see the comment there) as the real
// travel-time divisor, alongside PITCH_TRAVEL_MULT. [Draft] doc §11 (fastball values based on
// published averages; "off-speed values are estimates"). Screwball/eephus/cutter rows added
// 2026-09-23 (doc item 9, Matt): Majors 82/55/91, every other league the Majors row x its scale.
// Before that they fell back to the fastball's mph, so a 55 mph lob read "95". Display only.
export const READOUT = {
  little:     { scale: 0.58, fastball: 55, changeup: 50, curveball: 46, slider: 50, knuckleball: 44, screwball: 48, eephus: 32, cutter: 53 },
  highschool: { scale: 0.84, fastball: 80, changeup: 72, curveball: 67, slider: 73, knuckleball: 64, screwball: 69, eephus: 46, cutter: 76 },
  college:    { scale: 0.93, fastball: 88, changeup: 80, curveball: 74, slider: 81, knuckleball: 71, screwball: 76, eephus: 51, cutter: 85 },
  minors:     { scale: 0.98, fastball: 93, changeup: 84, curveball: 78, slider: 85, knuckleball: 74, screwball: 80, eephus: 54, cutter: 89 },
  majors:     { scale: 1.00, fastball: 95, changeup: 86, curveball: 80, slider: 87, knuckleball: 76, screwball: 82, eephus: 55, cutter: 91 },
};

// ---------------------------------------------------------------------------------------------
// FEEL: timing constants. `engine` is consumed by the simulation itself; `ui` is reserved for a
// future rendering phase and consumed by nothing here - both groupings and every value in them
// are the doc's own prototype-tuned numbers (section 14), [Tested], carried over verbatim.
export const FEEL = {
  engine: {
    dtS: 1 / 120,           // fixed timestep, seconds - matches Golf/Hill Climb (doc §15's own units note)
    maxSteps: 5,            // catch-up cap per advance() call: never spiral on a slow/batched tick
    // R2 (docs/BASEBALL-3D-BUILD.md section 9): 1500 -> 650. The reference game's pitch is in the
    // air for 0.35 to 0.45 s (docs/BASEBALL-REFERENCE-B9.md's measured table); ours took a second
    // and a half, which is most of why "their beats are 2 to 3x faster than ours everywhere".
    // 650 ms is the fastball at the SLOWEST league's own travel multiple of 1.0 and lands the
    // faster pitches inside the reference's window once PITCH_TRAVEL_MULT and the pitcher's own
    // speed skill are applied. The timing window (below) is unchanged, so a shorter flight does
    // NOT make contact harder - it only shortens the wait.
    //
    // R11 (docs/BASEBALL-3D-BUILD.md section 9): fastballMs itself DOES NOT MOVE - it stays the
    // Majors reference (a Majors 95 mph fastball still flies in exactly 650 ms). What changes is
    // `pitch.js`'s `timeToPlateS`, which now also divides by this league's own READOUT mph for
    // the type being thrown (see READOUT's own header): a Little League 55 mph fastball takes
    // about 1.1 s, not 650 ms - "a slow pitch is slow" (Matt, 2026-09-21).
    fastballMs: 650,        // R2 - fastball travel time; every other pitch is this x PITCH_TRAVEL_MULT
    // R11: LEAGUE_TIMING_WINDOW_MULT (below) multiplies this at both places swing.js reads it, so
    // "100 ms" is the MAJORS number now, not a flat constant - "Little League is forgiving,
    // Majors is tight" (Matt, 2026-09-21).
    timingWindow: 100,      // [Tested] doc §14 - good-contact timing window, ms
    foulMult: 1.7,          // [Tested] doc §14 - foul margin, x timingWindow
    swingDelay: 60,         // [Tested] doc §14 - swing start delay, ms
    // R16, measured (was 0.12): an aim that lands within an eighth of the plate half-width of
    // where it was aimed leaves pitch Accuracy nothing to tighten - measured at +5 points on the
    // skill, pitchAcc moved a win rate by -0.3 pp, inside noise. At 0.30 the skill has room.
    aimScatter: 0.30,
    // R19: how far below-full Accuracy pulls the aim toward the middle of the plate (pitch.js).
    aimPull: 2,       // [Tested] doc §14 - normal pitch miss from aim, fraction of plate half-width
    // R16, measured: THE FLIGHT-TIME REFERENCE. `swing.js` scales the good-contact timing window
    // by `pitchResult.timeToPlateS / referenceFlightS`, so a slow pitch really is easier to time
    // and a fast one really is harder - until R16 a 95 mph and a 55 mph pitch bought the batter
    // exactly the same milliseconds, which is why pitch Speed measured -0.9 pp (a skill that did
    // nothing). This is the COLLEGE fastball's own time to plate today (0.650 s x 95/88), so
    // College is a true no-op, the same anchor LEAGUE_TIMING_WINDOW_MULT's own 1.0 uses.
    referenceFlightS: 0.7017,

    // ---- R2: the 2-D batting cursor (docs/BASEBALL-3D-BUILD.md section 9) --------------------
    // The batter no longer has a 1-D "sweet spot" on a line (`sweetSpot`/`batReach`, deleted with
    // the 1-D pad): he has a CIRCLE he drags over the zone, and the pitch either crosses inside it
    // or it does not. `cursorR` is that circle's radius in zone units (1 = the zone's own half
    // width / half height) per batting mode, and `modeExitMult` is what the mode pays or earns for
    // it - CONTACT is the big circle at ordinary power, POWER is the small circle at a few mph
    // more. That trade IS the mode choice; it replaces the charged swing (hold-to-charge) entirely.
    //
    // R5: `modeExitMult.power` 1.12 -> 1.05. R2 wrote x1.12 against a BASE_EXIT_VELO of 31.39, where
    // it bought 3.8 mph; against R5's broadcast-real base of 80 it would buy 9.6, and R5 rule 2 asks
    // for "POWER mode a few mph over CONTACT". 1.05 buys 4.0 mph at the 80 mph reference and 5.3 at
    // College's cap-power 105. POWER's real cost is unchanged and is the circle, not the mph.
    // R16, measured (was 0.55 / 0.35): at 0.55 plus hitAcc's own widening the contact circle at
    // 22 skill points is 1.64 zone units - WIDER THAN THE STRIKE ZONE, so a maxed bat could not
    // miss and three-inning games ended 26-1. 0.34 / 0.22 is the College-and-up circle; the two
    // leagues below get it back through LEAGUE_CONTACT_MULT (below), which is what keeps Little
    // League a tutorial for a weak player instead of making it the hardest rung.
    cursorR: { contact: 0.34, power: 0.22 },
    modeExitMult: { contact: 1.0, power: 1.05 },
    // How far off the cursor's centre, VERTICALLY, the ball has to cross before the contact stops
    // being a line drive: past `flyOffsetFrac` above the centre the batter got under it (fly),
    // past `popupOffsetFrac` he got right under it (pop-up), past `flyOffsetFrac` below it he
    // topped it (grounder).
    //
    // FRACTIONS OF THE CURSOR'S OWN RADIUS, not the absolute zone units R2's spec names (0.3 and
    // 0.7). Absolute numbers cannot work: the CONTACT circle's radius is 0.55, so a ball crossing
    // 0.7 above the cursor's centre is OUTSIDE the circle and is already a miss - a pop-up could
    // never happen at all, and `outcomes.js`'s whole `popout` branch would be dead code. As
    // fractions the rule scales with the circle it is measured against, which is the honest
    // reading of "off centre": 0.545 x 0.55 is 0.30, exactly the spec's own fly threshold in
    // CONTACT mode, and the pop-up band sits inside the rim at 0.47 instead of past it. In POWER
    // mode (radius 0.35) the same fractions give 0.19 and 0.30 - a smaller circle makes every
    // part of it proportionally closer to the rim, which is what the mode is buying.
    flyOffsetFrac: 0.545,
    popupOffsetFrac: 0.85,
    // A fly ball's own launch-angle band (deg). `outcomes.js`'s `battedBallKind` calls 26 to 52
    // a fly, so this sits inside it with room at both ends; the line-drive band below it is the
    // existing lineDriveCenterDeg/Spread pair, unchanged, and the pop-up and grounder bands are
    // the ones swing.js already used. R2's choice, not measured - `sim-baseball.mjs` is what
    // measures what it does to the batted-ball census.
    flyCenterDeg: 39,
    flySpreadDeg: 9,
    // How far a ball crossing off the cursor's centre HORIZONTALLY sprays, at the edge of the
    // circle (deg). The doc's own rule ("the horizontal offset adds to pull/opposite direction
    // exactly as aimX did") gives no number; 18 deg is about half of `pullMaxDeg`, so where you
    // meet the ball matters, and matters less than when. R2's choice.
    offsetSprayDeg: 18,
    // R5 rule 1: PLACEMENT STEERS THE BALL, IT NEVER SUBTRACTS POWER. `placementPenaltyMph` (the
    // flat 18 mph a rim-edge ball used to lose, carried over from the 1-D model's own
    // `qualityFrac * 18`) IS DELETED, and `placeQ` no longer multiplies `q` either. Between them
    // those two deductions are why a "Perfect" swing 0.2 zone units off centre carried 0 ft 100% of
    // the time: they pulled exit velocity below `CARRY_ZERO_MPH`, where `carryFt` returns nothing.
    // What the outer half of the circle costs instead is LAUNCH-ANGLE TIGHTNESS - the line-drive
    // band widens from `lineDriveSpreadMinDeg` to `lineDriveSpreadMaxDeg` as the contact point
    // moves from the inner half (`rimSpreadStartFrac`) out to the rim, so a ball met off the sweet
    // spot is hit just as hard and flies less true. Vertical offset still picks the KIND and
    // horizontal offset still sprays, both exactly as R2 wrote them.
    rimSpreadStartFrac: 0.5,
    // The +/- mph of noise on every batted ball's exit velocity, named (swing.js held a bare 4).
    // R5's floor derivation below quotes it, so the two cannot drift apart.
    exitVeloNoiseMph: 4,

    // ---- Contact-quality axis (BB-2a, 2026-09-12) -------------------------------------------
    // Draft, new. Fixes the mechanism the BB-2 handoff diagnosed: `absTiming` used to decide only
    // miss/foul/contact and then never appear again, so a swing 3ms off and one 99ms off (inside a
    // 100ms window) produced identical exit velocity - "Perfect" did not exist as a continuous
    // quantity. `q` (computed in swing.js) is 1 inside `perfectMs` of dead-on timing, falling
    // linearly to 0 at the timing window's own edge; exit velocity and launch angle both read it.
    perfectMs: 25,          // Draft, BB-2a - the "Perfect" band width (doc §12's popup wording)
    qualityFloor: 0.625,    // R5 (was 0.55, BB-2a's own guess) - exit-velocity share kept by a swing barely inside the window (q=0); power contributes nothing at all here, only at q>0. DERIVED: rule 2's two named targets, BARELY_TIMED_EXIT_VELO_MPH (50) / PERFECT_EXIT_VELO_MPH (80) = 0.625
    lineDriveCenterDeg: 20, // Draft, BB-2a - center of a CENTERED swing's launch-angle band
    lineDriveSpreadMinDeg: 8,  // Draft, BB-2a - launch-angle spread at q=1 (a tight, true line-drive band)
    lineDriveSpreadMaxDeg: 30, // Draft, BB-2a - launch-angle spread at q=0 (widens toward topped/popped)
    pullMaxDeg: 40,          // Draft, BB-2a - the largest pull/opposite-field spray a sloppy-timed (q near 0) swing can produce
    perfectSprayDeg: 22,     // Draft, BB-2a - where a perfectly-timed (q=1) swing centers its spray: one of the two GAPS (left or right of straightaway), never dead center - a squared-up ball is not aimed at the deepest part of the park nor at a fielder standing in it
    perfectSpraySpreadDeg: 8, // Draft, BB-2a - how narrow the q=1 spray band is around whichever gap it picked
  },
  ui: {
    // R2 (docs/BASEBALL-3D-BUILD.md section 9): re-timed to docs/BASEBALL-REFERENCE-B9.md's own
    // measured table (verdict ~1.2 s, pitch tap to next ready ~2.2 s, READY to release ~1.0 s).
    // Was 3000 / 1400 / 1800. `test-baseball-device.mjs`'s r2-cadence probe computes its expected
    // sum from these three, never from a literal, so it follows a change here.
    betweenMs: 800,         // R2 - pause between pitches
    windupMs: 1000,         // R2 - CPU pitcher windup
    resultMs: 1200,         // R2 - how long a hit result shows
    inputOffset: 0,         // [Tested] doc §14 - input lag offset
  },
};

// R11 (docs/BASEBALL-3D-BUILD.md section 9): THE LEAGUE LADDER'S OWN FORGIVENESS. Matt, 2026-09-21:
// "Little league should be easy." Multiplies `FEEL.engine.timingWindow` at both places swing.js
// reads it (the ordinary swing and the bunt), so the good-contact window is wider at a low league
// and narrower at a high one - Majors (0.8) is TIGHTER than the flat 100 ms every league used to
// share, and Little League (1.6) is nearly double it. `college`'s own 1.0 is a true no-op: this
// table changes nothing at the league the rest of the engine's own numbers were derived against.
// The CPU's own `timingSigmaMs` (how far off-centre a CPU batter's swing tends to land) is a
// SEPARATE mechanism and is untouched by this - this multiplies how forgivingly THAT error (or a
// human's) is SCORED, not how large it tends to be.
export const LEAGUE_TIMING_WINDOW_MULT = { little: 1.6, highschool: 1.3, college: 1.0, minors: 0.9, majors: 0.8 };

// R16, measured (new): the SAME shape one axis over. `FEEL.engine.cursorR` is now the College-and-up
// circle; this multiplies it per league where `swing.js` reads it, so Little League's bat covers
// 0.544 zone units and High School's 0.442 while College up covers 0.34. It exists for the reason
// LEAGUE_TIMING_WINDOW_MULT exists - the bottom of the ladder is a tutorial - and it is measured,
// not assumed: at a flat 0.34 the WEAK tier (85 ms timing) wins Little League first time 93% of
// the time with it and far less without. College's 1.0 is a true no-op.
export const LEAGUE_CONTACT_MULT = { little: 1.6, highschool: 1.3, college: 1.0, minors: 1.0, majors: 1.0 };

// R19 (docs/BASEBALL-3D-BUILD.md section 9): THE EDGE OF THE ZONE IS HARDER TO SQUARE UP. Until
// R19 where a pitch crossed changed nothing about how well it could be hit (the batter's cursor
// follows the ball, and only ball-or-strike read the location), so pitch Accuracy measured +0.1 pp
// of win rate for 6 points: a pitcher gained nothing by hitting a spot. Now the good-contact
// timing window shrinks as the crossing moves out from `start` (zone units, the zone edge is 1) to
// the edge, by up to `penalty`, and stays at the full penalty outside the zone (a chase). The foul
// boundary is left where it was, so an edge pitch is fouled off more, not whiffed more. Accuracy
// is what lets a pitcher live on the edge without missing off the plate. Applies to every batter,
// human and CPU. Absent (a fixture's own settings object), nothing changes.
export const EDGE_CONTACT = { start: 0.3, penalty: 0.5 };

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
  // R11: pitchMix fastball only - LEAGUE_UNLOCK_ADDS.little dropped changeup (moved to
  // highschool), and `unlockedPitchesFor` no longer lets Quick Play draw a type the league has
  // not unlocked, so this row can only ever be asked for the one type it names.
  little:     { timingSigmaMs: 115, placementNoise: 0.27, swingIn: 0.30, chase: 0.55, fool: 0.45, guess: 0.10,
    // Playtest 1 (Matt, 2026-09-23): changeup added back, both sides.
    pitchMix: { fastball: 3, changeup: 1 }, cornerBias: 0.05, patternWeight: 0.02, weakSpotWeight: 0 },
  highschool: { timingSigmaMs: 95, placementNoise: 0.24, swingIn: 0.50, chase: 0.40, fool: 0.35, guess: 0.20,
    pitchMix: { fastball: 3, changeup: 2, curveball: 2 }, cornerBias: 0.20, patternWeight: 0.13, weakSpotWeight: 0 },
  college:    { timingSigmaMs: 80, placementNoise: 0.22, swingIn: 0.78, chase: 0.28, fool: 0.25, guess: 0.30,   // BB-2c commit 2: timingSigmaMs 65 -> 80 (CPU_SIGMA_MIN_MS.college); placementNoise floored at CPU_PLACEMENT_MIN (was 0.21 under the old guess-derived formula)
    pitchMix: { fastball: 2, changeup: 2, curveball: 2, slider: 2 }, cornerBias: 0.38, patternWeight: 0.27, weakSpotWeight: 0.06 },
  minors:     { timingSigmaMs: 62, placementNoise: 0.22, swingIn: 0.72, chase: 0.14, fool: 0.18, guess: 0.45,   // BB-2c commit 2: timingSigmaMs 60 -> 70 (CPU_SIGMA_MIN_MS.minors); placementNoise floored (was 0.165)
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
//
// BB-2f commit 3 retune, measured (`sim-baseball.mjs --assert`, per-league sweeps of shortfall
// 1/2/3/5/7/9): `teams.js`'s `makeLeague` clamps every slot's skill to
// `min(rawCap, baseCap * (1 + offset))` - the champion's own `+0.25` offset only escapes the RAW
// cap once `baseCap * 1.25 < rawCap`, i.e. once shortfall is large enough that `baseCap < rawCap /
// 1.25`. For Little League (rawCap 10) that needs shortfall > 2 (shortfall 3: baseCap 7, champion
// slot cap 8.75 - genuinely below the raw 10 for the first time); for High School (rawCap 14) it
// needs shortfall > 2.8 (shortfall 3: baseCap 11, champion slot cap 13.75). `little: 3` measured as
// the best point on its own sweep (season/weakest both PASS; champion moves 0.93 -> 0.89, the
// largest improvement any tested value bought, at shortfall 5/7/9 the weakest floor starts failing
// too while champion barely moves further - diminishing returns past 3). `highschool: 1` measured
// as ITS best point (season 0.76/weakest 0.85 both PASS at shortfall 1; shortfall 2+ fails the
// weakest floor for no further champion gain - champion sits at 0.77-0.79 across the whole 1-4
// range tested, moving only ~2pp). `college`/`minors`/`majors` are UNCHANGED (3/4/4, BB-2a/2b
// values) - swept college 3/5/7/9 and found its own weakest-slot value (0.656) does not move with
// shortfall at all (byte-identical to BB-2e's own report, since this constant was already 3 there);
// its bottleneck is a different axis, out of this phase's contract to retune (LADDER_AXIS_ENDPOINTS
// itself, shared across every league, is not this phase's lever - reopening it risks Little
// League's own now-passing weakest/season bands).
//
// The measured result at little/highschool: CPU_LEVEL_SHORTFALL genuinely widens the champion's
// available skill range for the first time (proving doc v11's own diagnosis correct - the ceiling
// WAS purely `effectiveCapFor` clamping the champion to the same value as every other slot), but
// SKILL alone is not enough to move either league's champion win rate into [0.40, 0.55]: even an
// extreme, unshippable shortfall (9, leaving little league's CPU teams an effective cap of 1 skill
// point) only moved little's champion from 0.93 to 0.87-0.93 (noisy, no clear trend past shortfall
// 3) - nowhere near the band. Reported honestly below rather than chased with an unreasonable
// shortfall value that would also break `NUDGE_A_B`'s "well-timed low-Power beats sloppy high-
// Power" contract by leaving every team without enough skill range to express it.
export const CPU_LEVEL_SHORTFALL = { little: 3, highschool: 1, college: 3, minors: 4, majors: 4 };

// ---------------------------------------------------------------------------------------------
// R16, measured (new): HOW STRONG A CPU ROSTER ACTUALLY IS, replacing the literal 0.5 that sat in
// `teams.js`'s `allocateSkills` and generated every CPU team at HALF its stated level. Measured
// roster means before R16: 2.9 / 5.4 / 7.5 / 8.9 / 9.9, against a career player who arrives
// holding 5 / 10 / 14 / 18 / 22 per skill - so doc §8's "CPU teams at the player's expected
// level" had never once been true, and the career was trivially easy (first-attempt Gold
// 99 / 97 / 79 / 68 / 51 percent at the median tier, a World Series in six seasons, every time).
//
// `CPU_ROSTER_LEVEL` is the MEAN skill points per CPU player a league's eight rosters land on, and
// `teams.js` solves for the per-slot scale that achieves it AFTER the ceiling clamp (the ceiling
// bites hard at the Minors, where nearly every value sits on it). The slot ladder's own relative
// offsets (`TEAM_LADDER_OFFSETS`) are preserved exactly, so the champion still sits at the top of
// each spread and the weakest team is still the weakest.
//
// `CPU_ROSTER_CEILING` is the per-skill ceiling: one point under each league's raw CAP, so the
// champion is never generated AT the player's own ceiling (the study measured Minors' champion at
// 22 of 22 and this is the "ceiling it at 21 by hand" that answers it).
//
// THE MINORS CEILING IS 22, NOT THE 21 THE R16 SPEC NAMED, and this is the one number in the
// stage that was re-measured rather than transcribed. Two reasons, both measured with
// `sim-baseball-career.mjs` (N=150, median tier): at 21 the table's own 21.0 mean is ARITHMETICALLY
// UNREACHABLE (21 is the ceiling, so a mean of 21 needs every drawn value pinned on it, which
// would flatten TEAM_LADDER_OFFSETS at that league entirely), and the roster it does produce
// (20.23) made the Minors EASIER than College - first-attempt Gold 52.7% against College's 52.0%,
// an inversion of the ladder Matt's own brief asks for ("each league after that should feel like a
// real step up"). At 22, which is what the study's own 3.3x roster multiplier actually clamped
// against, the realised mean is 20.96 (the table's number), the ladder keeps its shape
// (18.7 .. 22.0 by slot) and the Minors reads 48.7% against College's 52.0%.
export const CPU_ROSTER_LEVEL = { little: 4.1, highschool: 10.7, college: 16.4, minors: 21.0, majors: 23.0 };
export const CPU_ROSTER_CEILING = { little: 9, highschool: 13, college: 17, minors: 22, majors: 26 };

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
  // Doc item 11, Matt 2026-09-23: "fence shapes + tall walls" for version 1. The eight Majors parks,
  // fictional names, shapes inspired by the doc's eight cities. Spray angle: -45 = the left-field
  // line, +45 = the right-field line (`outcomes.js` `fenceFtAt`). `walls` are the tall sections:
  // a ball that would clear a normal fence but not this height is a double off the wall
  // (`WALL_RULE`). `ivy` is LOOKS ONLY (field.js tints the wall green). Majors only.
  boston:       { name: 'Harbor Yard',     left: 310, leftCenter: 379, center: 390, rightCenter: 380, right: 302,
                  walls: [{ fromDeg: -45, toDeg: -17, heightFt: 37 }] },   // tall, short left wall
  newyork:      { name: 'Empire Grounds',  left: 318, leftCenter: 399, center: 408, rightCenter: 385, right: 314 }, // short right porch
  chicago:      { name: 'Lakeshore Park',  left: 355, leftCenter: 368, center: 400, rightCenter: 368, right: 353, ivy: true },
  sanfrancisco: { name: 'Bayview Field',   left: 339, leftCenter: 364, center: 391, rightCenter: 415, right: 309 }, // deep right-center
  houston:      { name: 'Launchpad Park',  left: 315, leftCenter: 362, center: 409, rightCenter: 373, right: 326,
                  walls: [{ fromDeg: -45, toDeg: -22, heightFt: 21 }] },   // short left, tall wall
  detroit:      { name: 'Assembly Park',   left: 345, leftCenter: 370, center: 420, rightCenter: 365, right: 330 }, // deep center
  denver:       { name: 'Summit Field',    left: 347, leftCenter: 390, center: 415, rightCenter: 375, right: 350 }, // huge outfield
  losangeles:   { name: 'Sunset Park',     left: 330, leftCenter: 375, center: 395, rightCenter: 375, right: 330 }, // even
};

// Which park a Majors CPU team plays at home, by style (the style is what places each team in its
// city - `ui.js` `TEAM_NAMES.majors`). The player's own home park is Boston's (Matt, 2026-09-23),
// shared with the Boston Harbormasters. Below the Majors every game is on the league's own field.
export const PARK_BY_STYLE = {
  sluggers: 'newyork', smallBall: 'denver', patient: 'sanfrancisco', flamethrowers: 'houston',
  junkballers: 'detroit', shifters: 'chicago', balanced: 'boston', aces: 'losangeles',
};
export const PLAYER_HOME_PARK = 'boston';
/** The park for a game, from the league, the HOME team's style and whether the player is home. */
export function parkFor(league, homeIsPlayer, homeStyleId) {
  if (league !== 'majors') return 'default';
  if (homeIsPlayer) return PLAYER_HOME_PARK;
  return PARK_BY_STYLE[homeStyleId] || 'default';
}
// A tall wall: a fly/line that clears the fence distance but lands less than
// (heightFt - baseHeightFt) * carryFtPerFt past it hit the wall, and is a double. baseHeightFt is
// the ordinary fence (field.js FENCE.height). 1 ft of extra carry per ft of wall = a ~45 deg descent.
export const WALL_RULE = { baseHeightFt: 8, carryFtPerFt: 1.0, cornerTripleDeg: 40 };
// Playtest 1 (Matt, 2026-09-23): a fly/line that reaches the fence BELOW the wall's height (the
// ordinary 8 ft, or a tall section's own) hits it: a double, or a triple within `cornerTripleDeg`
// of a foul line (+/-45). `carryFtPerFt` is the pre-playtest rule, kept for older saves only.

// The batted ball's drawn arc (moved from ui.js, playtest 1, so outcomes.js can read the ball's
// height at the wall from the SAME arc the player watches - `outcomes.js` `battedApexFt`).
// R1: the batted ball's apex, in feet, from the engine's own distance - stage 8's rule, restated in
// world units by section 9. A grounder barely leaves the ground; anything else arcs.
// R2: halved (0.35 -> 0.22, cap 120 -> 80). R1's own record: the old rule is "about 40% too high
// for a real fly ball and puts the wall out of the chase camera's frame on a home run".
export const BATTED_APEX_MAX_FT = 80;
export const BATTED_APEX_FRAC = 0.22;
export const BATTED_GROUNDER_APEX_FT = 4;
// R5: a POP-UP is the one kind whose height is not a function of how far it went - it is the kind
// where ALL of the swing went up. `distanceFt * 0.22` drew a 60 ft pop-up as a 13 ft liner, which
// was invisible while `carryFt` returned 0 ft for it and is not once R5's `MIN_IN_PLAY_FT` puts it
// on the infield grass (40 to 120 ft out). Height is taken from the distance too, but on its own
// much steeper fraction and with a floor, so the shortest pop-up still goes up rather than across.
export const BATTED_POPUP_APEX_FRAC = 0.9;
export const BATTED_POPUP_APEX_MIN_FT = 55;
// R10: a LINE DRIVE gets its own, flatter apex - unlike a fly ball, a liner does not arc; sharing
// BATTED_APEX_FRAC/BATTED_APEX_MAX_FT with 'fly' put a 200ft liner 44ft up (a 3.3s hang time)
// where the spec's own worked example wants "about 2.5s" (~25ft). Solved from the same
// `t = 2*sqrt(2*apex/32.2)` the flight-time formula uses: apex = (t/2)^2 * 32.2, so
// apex(2.5s) = 25.16ft, frac = 25.16 / 200 = 0.126 - baseball/CLAUDE.md's R10 entry has the check.
export const BATTED_LINE_APEX_FRAC = 0.126;
export const BATTED_LINE_APEX_MAX_FT = 40; // a liner that arced as high as a fly ball's own 80ft cap would read as one


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
// BB-2g commit 2 re-measurement (`node sim-baseball.mjs --styles`, vs the median human model at
// every league, against the CURRENT settings after BB-2e/2f's own retunes - the BB-2d values above
// were stale against those changes, per BB-2d's own note). Every style measured tougher than
// before (mean delta moved -0.06..-0.15 to -0.12..-0.20) because BB-2e/2f's own sigma/chase/
// shortfall retuning already sharpened the underlying ladder these deltas stack on top of.
export const STYLE_STRENGTH_DELTA = {
  sluggers: -0.1155,
  smallBall: -0.1989,
  patient: -0.1559,
  flamethrowers: -0.1632,
  junkballers: -0.1677,
  shifters: -0.1573,
  aces: -0.1671,
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
  hitAcc:    { contactRadiusInPerPt: 0.045, whiffReductionPerPt: 0.006 }, // R16, measured (contactRadiusInPerPt was 0.09): 0.09 saturated the circle - 22 points made it 2.98x its base, so every extra point bought nothing a player could feel. At 0.045 hitAcc measures +5.3 pp per 5 points, the second-most noticeable skill after hitPow. Previously: "bigger timing window and sweet spot" - BB-2a step 6 retune (was 0.15/0.01, reverted-from-phase-2 value) against the NEW contact-quality axis, within `sim-baseball.mjs --contact-grid`'s own constraints; lowers the SKILL_EFFECT sensitivity experiment's win-rate gap
  hitPow:    { exitVeloMphPerPt: 1.3889 },                               // "more distance, stronger charged swings" - R5 (was 0.07, BB-2d commit 4's own value). DERIVED, not swept: rule 2's two broadcast targets, (CAP_POWER_EXIT_VELO_MPH 105 - PERFECT_EXIT_VELO_MPH 80) / CAPS.college 18 = 1.3889 mph per point. BB-2d's 0.07 was the largest value that kept the contact grid's margins against a BASE_EXIT_VELO of 31.39, where power was competing with a 1.4 mph-wide axis; at a base of 80 the same 18 points buy 25 mph and the grid's own "E rises with hitPow, every sigma" check passes for the first time since that retune (it was FAILING before R5, measured: 0.293/0.291/0.302 at sigma=35). It is far above SKILL_EFFECT_MAX_PER_POINT (0.03, a soft ceiling nothing enforces) because that ceiling was written for fractional multipliers, not for a value in mph
  hitSpd:    { sprintFtPerSPerPt: 0.08, stealSuccessPerPt: 0.02, stretchDepthPerPt: 0.015 },       // "beat out grounders, stretch hits, steal/bunt" - RA wired stealSuccessPerPt (game.js's steal roll, with STEAL_BASE/STEAL_MIN/STEAL_MAX below) and the BUNT reads the same beat-out roll the infield grounder does (MECHANICS.beatOutPerPt, outcomes.js); sprintFtPerSPerPt is still unused (nothing here models a runner's speed over the ground)
  pitchSpd:  { throwMphPerPt: 3.0 },                                     // R16, measured (was 0.5): "pitch velocity" - inert until R16's flight-time window (FEEL.engine.referenceFlightS) made travel time matter at all, and 0.5 mph a point is invisible beside a league readout that moves 40 mph. 3.0 buys 66 mph across a Majors cap.
  pitchAcc:  { throwAccuracyPerPt: 0.038, pickoffPerPt: 0.01 },          // R16, measured (throwAccuracyPerPt was 0.01). HONEST NOTE: nothing reads `throwAccuracyPerPt` today - `game.js`'s `_controlSkillFor` resolves pitchAcc against the league CAP and hands `flyPitch` a 0..1 skill, so what actually made the skill matter in R16 is `FEEL.engine.aimScatter` (0.12 -> 0.30) plus the corner aim landing inside the zone (AIM_CORNER_BIAS_BASE/_SCALE). The value is moved with them so a later session wiring it does not start from a number set against the old scatter. Previously: "lands closer to aim, bigger Nice zone, better pickoffs" - RA wired pickoffPerPt (game.js's pickoff roll, with PICKOFF_BASE/PICKOFF_MAX below)
  pitchSpin: { breakPerPt: 0.05, changeupGapPerPt: 0.025 },              // R16, measured (was 0.02 / 0.01): more break USED TO COST the pitcher walks, because pitch.js judged the strike on the post-break position - R16 aims at target minus break, so break is an edge again and the numbers can be worth paying for. Previously: "more bend on curve/slider/screwball; bigger changeup speed gap" - unused this phase, no steering modeled yet
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
  groundEdgeMarginFt: 60,   // R19, measured (was 15): wide enough that Speed decides a real share of grounders
  // Chance PER hitSpd SKILL POINT that a close grounder (within groundEdgeMarginFt of the sector
  // edge) beats the throw for a single, rather than being fielded. Draft, new - for the phase 2
  // simulator to verify a reasonable beat-out rate results.
  beatOutPerPt: 0.03,        // R19, measured (was 0.02)
  // R19: the ceiling on that chance (was a literal 0.5 in outcomes.js, twice).
  beatOutMax: 0.9,
};

// R5 (docs/BASEBALL-3D-BUILD.md section 9): THE CONTACT AND CARRY MODEL, RE-DERIVED FROM BROADCAST
// NUMBERS. Matt's recording of v865: five "Perfect" swings, five outs at the batter's feet, 0 ft.
// Measured through the real swing.js/outcomes.js at Quick Play's preset roster and the College
// park, before this change: a perfectly timed dead-centre CONTACT swing carried 0 ft on 27.9% of
// swings, and the same swing with the cursor 0.2 zone units off centre carried 0 ft on 100% of
// them. Two causes, both numbers:
//
//   1. `BASE_EXIT_VELO` was 31.39 and `CARRY_ZERO_MPH` is 30, so the WHOLE exit-velocity axis lived
//      inside a 1.4 mph window above the speed at which `carryFt` returns nothing. Every deduction
//      in swing.js - `placeFrac x placementPenaltyMph` (18), `placeQ` multiplying `q`, the +/-4 mph
//      noise - pushed the ball under that line, where the ball is in play and travels zero feet.
//      Those measured "exit velocities" (27 to 36 mph) were also printed on screen by R4's HOME RUN
//      strip, which is what made the number visibly wrong as well as mechanically wrong.
//   2. `carryFt`'s `sin(2a)` angle factor is ~0 for a grounder at 0 to 3 deg, so a topped ball
//      stopped at the plate no matter how hard it was hit. See GROUND_CARRY_FACTOR below.
//
// EXIT VELOCITY IS NOW A REAL NUMBER (rule 2). Three named targets, all at COLLEGE (where
// `LEAGUE_POWER_SCALE` is 1 by construction), CONTACT mode, no noise:
//
//   PERFECT_EXIT_VELO_MPH     80   q=1, no power points     -> BASE_EXIT_VELO = 80
//   BARELY_TIMED_EXIT_VELO_MPH 50  q=0 (window edge)        -> FEEL.engine.qualityFloor = 50/80 = 0.625
//   CAP_POWER_EXIT_VELO_MPH  105   q=1 at CAPS.college (18) -> SKILL_EFFECT.hitPow.exitVeloMphPerPt
//                                                              = (105 - 80) / 18 = 1.3889
//
// CARRY_SCALE is then the ONE remaining free number, and `HR_CARRY_FRAC` fixes it: a q=1 swing at
// cap power carries 1.05 of the College centre fence (400 ft) at the centred-contact launch angle
// (`FEEL.engine.lineDriveCenterDeg` = 20 deg, whose angle factor under `CARRY_PEAK_DEG` = 30 is
// sin(60 deg) = 0.86603):
//
//   CARRY_SCALE = HR_CARRY_FRAC * 400 / ((CAP_POWER_EXIT_VELO_MPH - CARRY_ZERO_MPH) * sin(60 deg))
//               = 420 / (75 * 0.86603) = 6.466
//
// The product `CARRY_SCALE * angleFactor(20 deg)` is 5.600 ft per mph of excess either way, which
// is why changing the curve's PEAK (45 -> 30, see CARRY_PEAK_DEG) moved CARRY_SCALE and moved
// nothing else in this derivation: every line below is written in that product.
//
// `MEDIAN_CARRY_FRAC` is REPORTED at College and APPLIED at the other four. BB-2d solved two
// simultaneous equations (HR_CARRY_FRAC and MEDIAN_CARRY_FRAC) for BASE_EXIT_VELO and CARRY_SCALE
// because exit velocity itself had no external anchor. It has one now - rule 2's three broadcast
// targets pin the whole mph axis - so at College the carry of the REFERENCE SWING (q=1 at
// `MEDIAN_HIT_POW_PTS`, 5 skill points) is whatever that axis implies: 80 + 5 * 1.3889 = 86.9 mph,
// (86.9 - 30) * 5.600 = 319 ft = 0.797 of the 400 ft fence. Writing a rounder number there and
// "solving" for it would be inventing a second answer to a question the mph targets have already
// answered. What that fraction IS for is the LEAGUE_POWER_SCALE table below, which holds it fixed
// league to league.
export const BASE_EXIT_VELO = 80;
export const CARRY_SCALE = 6.466;
// The three broadcast targets above, named so the next fence or SKILL_EFFECT change can redo the
// derivation from them instead of re-deriving the algebra. Nothing reads them at runtime;
// `baseball/js/test.js` section 32 asserts the engine still produces them.
export const PERFECT_EXIT_VELO_MPH = 80;
export const BARELY_TIMED_EXIT_VELO_MPH = 50;
export const CAP_POWER_EXIT_VELO_MPH = 105;
// `HR_CARRY_FRAC` is the carry target that fixes CARRY_SCALE (and, per league, LEAGUE_POWER_SCALE);
// `MEDIAN_CARRY_FRAC`/`MEDIAN_HIT_POW_FRAC` now REPORT what that model produces at half of cap
// power, they no longer constrain it (see the note above).
export const HR_CARRY_FRAC = 1.05;
export const MEDIAN_CARRY_FRAC = 0.797;
export const MEDIAN_HIT_POW_FRAC = 0.5;   // kept: BB-2d's own name for "half of cap", unused by R5's table
export const MEDIAN_HIT_POW_PTS = 5;      // R5: the reference swing's power, in skill points (PRESETS' own average)
// R5: how far the batted ball's own power scales per league (doc §10, [Locked]: "fields get bigger
// each league... out zones also grow"). DERIVED, one rule for all five: a q=1 swing at
// `MEDIAN_HIT_POW_FRAC` of THAT LEAGUE'S OWN cap carries `MEDIAN_CARRY_FRAC` of THAT LEAGUE'S OWN
// centre fence - the same reference swing the College anchor above is written at, moved league to
// league. `MEDIAN_HIT_POW_PTS` (5) is that swing's power: the preset roster's own average (PRESETS
// run 1 to 10) and a number no league's cap moves.
//
//   LEAGUE_POWER_SCALE[lg] = (MEDIAN_CARRY_FRAC * fenceFt.center[lg] / 5.600)
//                            / (BASE_EXIT_VELO - CARRY_ZERO_MPH + MEDIAN_HIT_POW_PTS * 1.3889)
//
//   little      0.797*210 / 5.600 = 29.89  /  (50 + 5*1.3889 = 56.94)  = 0.525
//   highschool  0.797*360 / 5.600 = 51.24  /  56.94                    = 0.900
//   college     0.797*400 / 5.600 = 56.93  /  56.94                    = 1.000
//   minors      0.797*405 / 5.600 = 57.64  /  56.94                    = 1.012
//   majors      0.797*408 / 5.600 = 58.07  /  56.94                    = 1.020
//
// WRITING THE REFERENCE AT HALF OF EACH LEAGUE'S OWN CAP INSTEAD WAS TRIED AND MEASURED (it gives
// 0.576/0.942/1.000/0.969/0.937, and at full cap 0.616/0.972/1.000/0.943/0.888): both produced a
// LOPSIDED home-run census - 17.1% and 25.7% of balls in play at Little League against 6.2% at
// College - because Quick Play's preset roster IS at Little League's own cap of 10 while it is at
// 38% of the Majors' 26, so a cap-relative reference is a swing the player makes all game at the
// bottom of the ladder and almost never at the top. At a FIXED 5 points the measured home-run rate
// is 8.0/6.3/6.3/6.2/6.0% across the five leagues, which is the table's whole job.
//
// This INVERTS BB-2d's own table (little 1.8, majors 1.10), and the reason is that the table was
// fitted while `exitVeloMphPerPt` was 0.07: the league CAP bought 1.8 mph at the Majors and 0.7 at
// Little League, so power did not scale with the league at all and the multiplier had to do that
// job by itself (BB-2d's comment records pushing `little` up through 1.2/1.5/1.7 to 1.8 to get any
// home runs at all). At 1.3889 mph per point the cap ladder (10/14/18/22/26) carries the league
// scaling on its own, and what is left for this table is the OPPOSITE correction: a Little League
// bat on a 210 ft field must be held back, or every fly ball clears it. The printed mph follows:
// Little League tops out near 67 mph, the Majors near 111, which is what those two leagues should
// read like on a broadcast strip.
export const LEAGUE_POWER_SCALE = { little: 0.525, highschool: 0.900, college: 1.000, minors: 1.012, majors: 1.020 };
// BB-2d commit 4: the 250ft/320ft double/triple depth cutoffs used to be flat numbers regardless of
// league or spray angle - meaningless once the fence itself varies by both. Now fractions of the
// FENCE AT THAT SPRAY ANGLE (`fenceFtAt`, outcomes.js), chosen to reproduce the old cutoffs exactly
// at College's 400ft CENTER fence (250/400=0.625, 320/400=0.80) so this commit changes WHAT the
// cutoff scales with, not what it evaluates to at the league/spray-angle the old flat numbers were
// implicitly tuned against.
export const DOUBLE_DEPTH_FRAC = 0.625;
export const TRIPLE_DEPTH_FRAC = 0.80;
// swing.js's own floor on exit velocity. Its job is to stop a badly-timed swing's exit velocity
// going to zero or negative, and NOTHING ELSE: BB-2d's own comment records what happens when a
// floor is set above where the model's own worst swing lands (it erases the timing gradient the
// whole contact-quality axis exists to produce). So it is derived to sit CLEAR BELOW that point:
// the lowest the model can go is `BARELY_TIMED_EXIT_VELO_MPH` (q=0, no power) minus one noise draw
// (`FEEL.engine.exitVeloNoiseMph`), 46 mph, and this sits two noise draws below the target instead
// of one - 42 mph, 4 mph of clearance, and it can only ever catch the bottom of the noise band.
export const MIN_EXIT_VELO_MPH = BARELY_TIMED_EXIT_VELO_MPH - 2 * FEEL.engine.exitVeloNoiseMph;
// R5 rule 3: NO BALL IN PLAY EVER CARRIES 0 FT, and the two numbers that guarantee it.
//
// `GROUND_CARRY_FACTOR` is the floor under `carryFt`'s angle factor. A topped ball is not a ball
// that goes nowhere, it is a ball that ROLLS, and its "distance" in this engine is where a fielder
// meets it. The angle factor (a half-sine peaking at CARRY_PEAK_DEG, below) crosses this value at
// 4.8 deg on the way up and 55.2 deg on the way down, so the floor binds on exactly the two kinds
// rule 3 names: GROUNDERS (`battedBallKind` < 8 deg) and POP-UPS (> 52 deg), and on nothing in
// between. What it produces, at the mph axis above: 32 ft for a barely-timed 50 mph grounder
// (`MIN_IN_PLAY_FT` catches it), 81 ft for a perfectly-timed 80 mph one, 121 ft at cap power, and
// a pop-up that lands on the infield instead of in an outfielder's glove.
//
// `MIN_IN_PLAY_FT` is the flat floor every in-play result clears, whatever the angle.
// `baseball/js/test.js` section 32 asserts no in-play swing at any league or mode comes back
// under it.
export const GROUND_CARRY_FACTOR = 0.25;
export const MIN_IN_PLAY_FT = 40;
// R5: the launch angle a batted ball carries FURTHEST at. `carryFt`'s angle factor was `sin(2a)`,
// the range curve of a projectile in a VACUUM, which peaks at 45 deg and is still climbing at 39 -
// the exact centre of this engine's own fly-ball band (`FEEL.engine.flyCenterDeg`). So a lazy fly
// ball carried HALF AGAIN AS FAR as a scorched line drive off the same bat (at 81 mph: 434 ft at
// 39 deg against 286 ft at 20), and the census it produced at R5's real exit velocities was 28%
// TRIPLES and 10% home runs per ball in play. A real batted ball peaks near 28 to 30 deg, because
// drag takes more from a high, slow-falling ball than lift gives it. 30 deg, as a half-sine that
// reaches 1 there and returns to 0 at 60: it keeps the line-drive band (12 to 28 deg) at nearly
// full carry, brings the fly band back under it, and lets a pop-up at 55 to 70 deg fall on the
// infield the way rule 3 asks - with MIN_IN_PLAY_FT underneath it. Draft [Open item 23], which
// names "the exact carry curve" as open; this is the same open item BB-2d's CARRY_SCALE sits in.
export const CARRY_PEAK_DEG = 30;
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
// place. R5 keeps it at 30: with exit velocity now running 42 to 110 mph it is a real floor again
// (a 42 mph dribbler has 12 mph of carry in it) rather than a line the whole axis sat on top of.
export const CARRY_ZERO_MPH = 30;

// BB-2a step 3 (2026-09-12): a well-squared-up LINE DRIVE (contact quality `q` at or above
// LINE_THROUGH_Q) that lands inside an outfield out-zone sector still goes through as a hit, up to
// LINE_THROUGH_MAX_FT - a "routine fly into a sector" stays an out (the ordinary out-zone check,
// untouched), but a scorched line drive through the same depth a lazy fly ball would have been
// caught at is what a squared-up ball actually does. Draft, new, BB-2a.
//
// R5: `LINE_THROUGH_MAX_FT` 220 -> 280, which is 0.70 of the College centre fence. The MECHANISM is
// untouched; the DEPTH is in feet, and until R5 nothing carried, so 220 was never really measured
// against anything. With real carry a perfectly-timed swing's line drives go 300 to 400 ft and were
// all being caught: `sim-baseball.mjs --perfect` measured an inner-half perfect swing as a hit
// 39.2% of the time against R5 rule 4's own 55% floor, and 280 measured 59.2%. Swept at 220 / 280 /
// 340 / 400 (39.7 / 59.2 / 87.5 / 94.9%) - 280 is the lowest value that clears the floor, so the
// rule stays a reward for squaring a ball up rather than a licence.
//
// WHAT THIS NUMBER STILL GETS WRONG, for whoever touches it next: it is ABSOLUTE, and Little
// League's whole park is 210 ft. So at that league every squared-up line drive falls in, which is
// most of why its batting average on balls in play measures 0.697 against 0.44 to 0.53 everywhere
// else. Making it a fraction of the league's own fence is the obvious fix, the same move BB-2d made
// for the double/triple cutoffs; R5 did not make it because one value change here was already more
// than its own spec allowed for.
export const LINE_THROUGH_Q = 0.75;
export const LINE_THROUGH_MAX_FT = 280;

// ---------------------------------------------------------------------------------------------
// RA (docs/BASEBALL-3D-BUILD.md section 9): STEAL, BUNT, PICKOFF. `RESERVED_PHASE_6` (the marker
// that said these three were [Locked] FEATURES with no rules yet) RETIRES here - doc §3's own
// [Open] line "how each works in play" is closed by the constants below and by the branches in
// game.js/swing.js/outcomes.js/agents.js that read them. bases.js's header no longer describes
// this engine: a runner CAN now move between pitches.
//
// Every number here is RA's own, either the spec's or (where it left one to this stage) chosen and
// said so at its own definition. None of them touch CPU/CAPS/SKILL_EFFECT, which stay exactly as
// the ladder tuning left them.

// THE STEAL. Success is `clamp(STEAL_BASE + SKILL_EFFECT.hitSpd.stealSuccessPerPt * runner.hitSpd
// - STEAL_PER_ACC * pitcher.pitchAcc, STEAL_MIN, STEAL_MAX)` - the runner's own legs against the
// pitcher's ability to hold him, which is the doc §6 [Locked] pair ("Batter Speed raises steal and
// bunt success. Pitcher Accuracy improves pickoffs", and a quick pitcher's accuracy is what a
// catcher throws behind).
export const STEAL_BASE = 0.45;
export const STEAL_PER_ACC = 0.005;
export const STEAL_MIN = 0.20;
export const STEAL_MAX = 0.90;

// THE PICKOFF. `clamp(PICKOFF_BASE + SKILL_EFFECT.pitchAcc.pickoffPerPt * pitcher.pitchAcc,
// PICKOFF_BASE, PICKOFF_MAX)`; at the Majors cap (26 points) that is 0.32, just inside the ceiling.
export const PICKOFF_BASE = 0.06;
export const PICKOFF_MAX = 0.35;
// RA's own choice, not the spec's: a SAFETY VALVE, not a rule. Nothing in the at-bat loop advances
// the count on a pickoff (that is the whole point of it), so an agent that answered `pickoff` every
// time would spin `playAtBat`'s pitch loop for ever. Three throws to the same bag inside one at-bat
// is already more than any real pitcher gets (MLB's own disengagement limit is two), so a cap here
// can never bind on honest play while it makes the loop provably terminate.
export const PICKOFF_MAX_PER_AT_BAT = 3;

// THE BUNT (playtest 1, batch 2, 2026-09-23: rebuilt from a timing window to a HELD POSITION -
// Matt: "if I hold it down, the bat should stay there. A bunt isn't a swing... you hold the bat
// horizontal and move it up/down/side to side to hit the ball"). Contact is now bat-vs-ball
// POSITION, read the same way an ordinary swing's cursor-vs-crossing offset is (`swing.js`'s own
// `offX`/`offY`, `cursorOf`) - never timing, which BUNT_WINDOW_MULT used to widen and no longer
// exists. `BUNT_BAR_HALF_X`/`BUNT_BAR_HALF_Y` are the held bar's own reach in zone units (wide
// across the plate, thin top to bottom - a bat, not a circle); a pitch outside both axes never
// meets it at all, and `swing.js`'s `buntSwing` reads `swung: false` back through it, which
// `game.js`'s own `!swingResult.swung` branch scores as an ordinary ball/strike - a bunt that
// never touches the ball is a take, not a foul. Inside the bar, `BUNT_FOUL_X_FRAC` and
// `BUNT_POPUP_Y_FRAC` (fractions of the bar's own half-reach) are how CENTRED the contact was:
// too far to either side of the bar's centre is a foul (a real mishit toward the side); too high
// (the bat sat under the ball) is a pop-up - `outcomes.js`'s `resolveBunt` is where both are
// actually decided, off the position `buntSwing` hands it. A bunt in play is still always a
// grounder, still travels BUNT_DIST_FT[0]..[1] feet and still sprays inside +/-BUNT_SPRAY_DEG -
// the spec's own numbers, untouched. The beat-out roll a bunt for a hit turns on is still
// `MECHANICS.beatOutPerPt` - the SAME roll an infield grounder already uses, never a second one.
// CPU bunts read the identical positional check off the cursor `agents.js`'s `CpuBatter` already
// builds for every swing (`aimX`/`aimY`) - nothing in agents.js changed for this.
export const BUNT_BAR_HALF_X = 0.95;
export const BUNT_BAR_HALF_Y = 0.28;
export const BUNT_FOUL_X_FRAC = 0.62;
export const BUNT_POPUP_Y_FRAC = 0.55;
export const BUNT_DIST_FT = [8, 40];
export const BUNT_SPRAY_DEG = 30;
export const BUNT_POPUP_DIST_FT = [15, 45];

// WHAT THE CPU DOES WITH THEM (doc §3's [Open] half, for the side the player does not control).
export const CPU_STEAL_BASE = 0.12;
export const CPU_STEAL_PER_SPD = 0.004;
export const CPU_PICKOFF_RATE = 0.08;
// The spec's own bunt rate, plus the two conditions it names. `CPU_BUNT_POW_FRAC` is RA's own
// reading of "the batter's hitPow is in the bottom third": the bottom third OF THIS LEAGUE'S CAP
// (`CAPS[league]`), which is the only scale a hitPow number here can be compared against - a
// Majors 8 and a Little League 8 are not the same batter.
export const CPU_BUNT_RATE = 0.06;
export const CPU_BUNT_POW_FRAC = 1 / 3;

// R11 (docs/BASEBALL-3D-BUILD.md section 9): QUICK_PLAY_PITCH_MIX IS DELETED. It existed only to
// give the CPU a distribution over all eight types for RA's now-overruled all-eight override
// (Matt, 2026-09-21: "only 'fastballs' should be able to be thrown" at Little League - the exact
// thing this constant let the Little League CPU do). Quick Play and career now share one ladder
// AND one pitch mix - `CPU[league].pitchMix` - so there is nothing left for a second distribution
// to supply. `agents.js`'s `CpuPitcher.decidePitch` no longer branches on `quickPlay` for either
// the unlock list or the mix.

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
// R16, measured: 'scaledToSeason' generalises 'scaledTo12' to whatever length the season actually
// is (CPU rank r finishes `round(n * r / (size - 1))` of n games). 'rawWins7' capped every CPU
// record at 7 wins however long the season was - meaningless at 3 games and at 14 alike - and
// 'scaledTo12' hardcoded the one length R16 removed. Both are kept and still work (THE LAW rule 5).
// 2026-09-23, Matt ("make them match"): 'withResults' - each CPU team's games against the player
// count as they actually went, the rest are scripted at its 'scaledToSeason' rate. Snapshotted per
// season (`season.standingsModel`), so a season already in progress keeps 'scaledToSeason'.
export const STANDINGS_MODEL = 'withResults'; // was 'scaledToSeason' (R16). Locked, doc item 13

// R16, measured (new): who wins a tie in the standings. 'cpu' is the shipped behaviour - the
// player's `strengthRank` is -1, so they lose every tie to every CPU team, which at 12 games put
// the top-4 cut at "more than 4 wins" rather than at 4. 'player' puts them above every CPU team
// on equal wins, which is the ordinary sports reading of a tie-break and the only one that makes
// sense at Little League, where a 3-0 player and the champion's scripted 3-0 would otherwise
// leave the player seeded below a team they never lost to.
export const STANDINGS_TIEBREAK = 'player'; // Draft [Open item 13]

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
// R16, measured (0.9 / 0.9): a corner aim used to resolve as far as 0.9 + 0.9 x cornerBias = up
// to 1.24 zone units - OFF THE PLATE - so "working the corners" meant aiming at a ball, and the
// pitcher's own Accuracy skill made it WORSE by hitting that spot more often (measured -1.3 pp
// per 5 points). 0.62 / 0.30 keeps the hardest corner aim at 0.92, inside the zone with room for
// the scatter, which is what the phrase was always supposed to mean.
export const AIM_CORNER_BIAS_BASE = 0.62;    // R16, measured (was 0.9) - the floor of an aim that DID go for the corner
export const AIM_CORNER_BIAS_SCALE = 0.30;   // R16, measured (was 0.9) - how much further cornerBias itself pushes a corner aim
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
export const CPU_SIGMA_MIN_MS = { little: 115, highschool: 95, college: 80, minors: 62, majors: 58 }; // R16 ship review: minors 70 -> 62 (measured: the only Minors-only lever that puts a step between College and the Minors; still above the 55 ms human floor)
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

// ---------------------------------------------------------------------------------------------
// R2 (docs/BASEBALL-3D-BUILD.md section 9): HOW EACH PITCH TYPE BREAKS.
//
// This block REPLACES phase 3's hold-and-release and steering seams (HANG_GRACE_FRAC,
// HANG_SPEED_MULT, HANG_BREAK_MULT, HANG_CENTER_PULL, STEERABLE_PITCHES, STEER_MAX_OFFSET, and
// FEEL.engine's meterTime/niceWidth/niceBoost/niceBreak), all deleted with the meter they served.
// The reference game has no meter and no steering after release: you tap once, aim during the
// wind-up, and the pitch's own break carries it from where you aimed to where it ends
// (docs/BASEBALL-REFERENCE-B9.md section 1, pitching steps 2 and 3 - "a second, yellow point
// cursor... shows where the pitch will END; the ball goes to the point cursor").
//
// So a break is now a FACT OF THE PITCH TYPE, in zone units (1 = the zone's own half width or
// half height), applied at the plate: the pitch crosses at aim + scatter + break. `handed: true`
// multiplies `x` by the pitcher's own arm sign (+1 right, -1 left), which is doc §11's [Locked]
// rule - "curve and slider break away from the pitcher's throwing arm. Screwball breaks the other
// way. You control how much and when, never which way" - now expressed as the one thing the
// player never chooses rather than as a drag the engine had to clamp.
export const BREAK_OFFSET = {
  fastball:    { x: 0,     y: 0 },                    // it is the baseline; it does not break
  changeup:    { x: 0,     y: -0.25 },                // dies straight down
  curveball:   { x: 0.45,  y: -0.35, handed: true },  // the biggest break in both axes
  slider:      { x: 0.35,  y: -0.10, handed: true },  // mostly sideways
  screwball:   { x: -0.35, y: -0.15, handed: true },  // the mirror of a slider, doc §11
  cutter:      { x: 0.18,  y: 0,     handed: true },  // a late, small cut
  knuckleball: { x: 0,     y: 0, random: 0.3 },       // +-0.3 both axes, from the pitch's own draws
  eephus:      { x: 0,     y: -0.1, hump: 0.5 },      // `hump` is PRESENTATION only (ui.js arcs it
                                                      // up 0.5 then down 0.6 through the flight);
                                                      // the engine only ever scores the -0.1 end.
};

export default {
  RULES_V, LEAGUES, SEASON, gamesForLeague, slotsForLeague, playoffFormatFor,
  POINTS, CAPS, START_POINTS_PER_SIDE, START_CAP,
  HIT_SKILL_IDS, PITCH_SKILL_IDS, SKILL_IDS, PRESETS,
  PITCH_TYPES, PITCH_UNLOCKS, TITLE_PITCH_UNLOCKS, unlockedPitchesFor, PITCH_TRAVEL_MULT, READOUT,
  FEEL, LEAGUE_TIMING_WINDOW_MULT, LEAGUE_CONTACT_MULT, FIELD_SCALE, CPU, CPU_LEVEL_SHORTFALL,
  CPU_ROSTER_LEVEL, CPU_ROSTER_CEILING, WEAKSPOT_WINDOW,
  PATTERN_WINDOW, PATTERN_WEIGHTS, FOUL_LINE_DEG, PARK_GEOMETRY, FIELD, SHIFT_WINDOW, SHIFT_MAX_DEG, SHIFT_MIN_SAMPLES, PARKS, PARK_BY_STYLE, PLAYER_HOME_PARK, parkFor, WALL_RULE,
  TEAM_STYLES, SHIFTERS_ADJUST_OUT_ZONES, STYLE_BEHAVIOR, STYLE_STRENGTH_DELTA, SIGMA_MS_PER_WINRATE_PP, CHASE_PER_WINRATE_PP,
  TEAM_LADDER_OFFSETS, LEAGUE_LADDER_STYLES,
  TEAM_STYLE_WEIGHTS, LEFTY_RATE,
  SKILL_EFFECT, SKILL_EFFECT_MAX_PER_POINT, BASE_EXIT_VELO, CARRY_SCALE, HR_CARRY_FRAC, MEDIAN_CARRY_FRAC,
  MEDIAN_HIT_POW_FRAC, LEAGUE_POWER_SCALE, DOUBLE_DEPTH_FRAC, TRIPLE_DEPTH_FRAC, MIN_EXIT_VELO_MPH, CARRY_ZERO_MPH,
  PERFECT_EXIT_VELO_MPH, BARELY_TIMED_EXIT_VELO_MPH, CAP_POWER_EXIT_VELO_MPH, GROUND_CARRY_FACTOR, MIN_IN_PLAY_FT,
  MEDIAN_HIT_POW_PTS,
  CARRY_PEAK_DEG,
  LINE_THROUGH_Q, LINE_THROUGH_MAX_FT, MECHANICS,
  STEAL_BASE, STEAL_PER_ACC, STEAL_MIN, STEAL_MAX, PICKOFF_BASE, PICKOFF_MAX, PICKOFF_MAX_PER_AT_BAT,
  BUNT_BAR_HALF_X, BUNT_BAR_HALF_Y, BUNT_FOUL_X_FRAC, BUNT_POPUP_Y_FRAC, BUNT_DIST_FT, BUNT_SPRAY_DEG, BUNT_POPUP_DIST_FT,
  CPU_STEAL_BASE, CPU_STEAL_PER_SPD, CPU_PICKOFF_RATE, CPU_BUNT_RATE, CPU_BUNT_POW_FRAC,
  BRACKET_MODEL, PLAYOFF_HOME, STANDINGS_MODEL, STANDINGS_TIEBREAK, SCHEDULE_SHAPE,
  GAP_DEG, BLOOP_BAND_FT, SPEED_SURPRISE_MS_PER_MULT,
  AIM_CORNER_CHANCE_MULT, AIM_INZONE_BIAS, AIM_CORNER_BIAS_BASE, AIM_CORNER_BIAS_SCALE,
  WEAKSPOT_AIM_SCATTER, SPEED_DELTA_DEADBAND, FOOL_PENALTY_MS_SCALE, FOOL_BONUS_MS_SCALE,
  LOCATION_LEAN_WEIGHT, VARIETY_REPEAT_BASE_CHANCE,
  CPU_SIGMA_MIN_MS, CPU_SIGMA_ABSOLUTE_FLOOR_MS, CPU_PLACEMENT_MIN, CHAMPION_CEILING, SLOT_SIGMA_DESCENT,
  LADDER_SHAPE, CLIFF_TOP_GAP_FRAC, STEEP_SHALLOW_GAP_FRAC, ladderGapWeights, CHAMPION_SIGMA_HEADROOM_FRAC,
  BREAK_OFFSET,
};
