// swing.js : resolve one batter decision against one already-thrown pitch. Pure function of its
// inputs - no clock, no module-scope state, no direct RNG object (the caller owns advancing/
// snapshotting the stream via a plain `rand01` callback, same contract as pitch.js's `flyPitch`).
//
// Two independent axes, per doc §12 ([Tested] in the prototype):
//  1. TIMING (early/late, ms) decides contact quality (perfect/foul/miss) AND, per doc, "Early
//     contact pulls the ball. Late contact goes the opposite way" - so timing also drives spray
//     direction (pull vs opposite field).
//  2. PLACEMENT - R2 (docs/BASEBALL-3D-BUILD.md section 9): the batter drags a 2-D CURSOR over
//     the zone and the pitch either crosses inside its circle or it does not. The 2-D distance
//     from the crossing point to the cursor's centre scales contact quality
//     (`max(0, 1 - d / cursorR)`, and a ball outside the circle is a miss outright); the
//     HORIZONTAL offset sprays the ball; the VERTICAL offset decides the batted-ball KIND - under
//     the ball (it crossed above the cursor's centre) is a fly or a pop-up, over it is a
//     grounder, on it is a line drive. This replaces BB-1a's 1-D `sweetSpot`/`batReach` pair and
//     its "bat's end vs. the handle" sign convention, both deleted with the 1-D pad.
//     The CHARGED swing (hold to charge, `chargeTime`/`chargeWindowMult`/`chargePower`) is
//     deleted too: POWER mode is what replaces it - a smaller circle for more exit velocity, a
//     choice made before the pitch rather than a hold during it.
//     R5 (same doc, section 9): PLACEMENT STEERS THE BALL, IT NEVER SUBTRACTS POWER. The 2-D
//     distance still decides whether there is contact at all, but it no longer scales `q` and
//     there is no flat mph penalty either (`placementPenaltyMph`, deleted). What the outer half of
//     the circle costs is launch-angle TIGHTNESS - the line-drive band widens from the inner half
//     out to the rim. Why: the two deductions between them put a well-struck ball under
//     `CARRY_ZERO_MPH`, where `carryFt` returns zero feet, which is Matt's five Perfect swings and
//     five outs at his own feet.
//
// BB-2a (2026-09-12): the CONTACT-QUALITY AXIS. The shipped BB-2 engine made timing binary inside
// its own window - `absTiming` decided miss/foul/contact and then never appeared again, so a swing
// 3ms off and one 99ms off (both inside a 100ms window) produced identical exit velocity, and
// "Perfect" did not exist as a continuous quantity. `q` below is 1 inside `FEEL.engine.perfectMs`
// of dead-on timing, falling LINEARLY to 0 at the timing window's own edge; both exit velocity and
// launch angle read it now, and power only ever multiplies a good swing - it never rescues a bad
// one (`qualityFloor` is the floor exit velocity keeps with q=0, and power's own contribution is
// itself scaled by q, so a lousy-timed max-Power swing caps out at `qualityFloor` of the no-power
// base, plus nothing). This is one of three mechanisms the handoff named; the other two (spray
// geometry, `zones.js`'s line-through rule) are BB-2a step 3, in outcomes.js/zones.js.
export function qualityFor(absTimingMs, perfectMs, timingWindowMs) {
  if (absTimingMs <= perfectMs) return 1;
  const span = Math.max(1e-6, timingWindowMs - perfectMs);
  return Math.max(0, 1 - (absTimingMs - perfectMs) / span);
}

/** BB-3: maps a raw input-release timestamp (ms since the pitch left the pitcher's hand) to the
 *  swing decision's own `timingErrorMs`, honoring `FEEL.engine.swingDelay` (the motor delay
 *  between deciding to swing and the bat arriving) and `FEEL.ui.inputOffset` (a device/latency
 *  calibration). Pure - no clock reads, no state. The "ideal" release time is the crossing time
 *  pulled back by both delays; releasing exactly then reads as zero error. A tap at the exact
 *  crossing time with both delays at 0 (the synthetic-tap baseline) is therefore zero by
 *  construction - `swingDelayMs`/`inputOffsetMs` default to 0 for exactly that case. */
export function computeSwingTiming({ releaseMs, timeToPlateS, swingDelayMs = 0, inputOffsetMs = 0, dtS }) {
  const crossMs = timeToPlateS * 1000;
  const idealReleaseMs = crossMs - swingDelayMs - inputOffsetMs;
  const timingErrorMs = releaseMs - idealReleaseMs;
  const swingStep = dtS ? Math.round(releaseMs / (dtS * 1000)) : null;
  return { timingErrorMs, swingStep };
}

/** The batting cursor a decision carries: `{x, y}` in zone units. R2 - a decision with no cursor
 *  at all swings at the middle of the zone rather than throwing, so a malformed agent decision
 *  can never crash a half-inning (game.js legalizes nothing here). */
function cursorOf(decision) {
  const c = decision && decision.cursor;
  return {
    x: c && typeof c.x === 'number' ? c.x : 0,
    y: c && typeof c.y === 'number' ? c.y : 0,
  };
}

/** The batting mode a decision carries - 'contact' (big circle, ordinary power) or 'power' (small
 *  circle, a few mph more exit velocity - `modeExitMult`). Anything else reads as CONTACT, which
 *  is the forgiving one. */
export function modeOf(decision) {
  return decision && decision.mode === 'power' ? 'power' : 'contact';
}

/** R16 (docs/BASEBALL-3D-BUILD.md section 9): A FAST PITCH IS HARDER TO TIME.
 *
 *  Until R16 the good-contact window was a flat number of milliseconds: a 95 mph Majors fastball
 *  and a 55 mph Little League one both gave the batter the same 100 ms, so the pitcher's own Speed
 *  skill bought NOTHING (measured: +5 points of pitchSpd moved a win rate by -0.9 pp, inside
 *  noise) and R11's "a slow pitch is slow" only ever changed how long the wait was.
 *
 *  The window now scales by the pitch's own time to the plate against `FEEL.engine.referenceFlightS`
 *  - the College fastball, so College is a true no-op, the same anchor `LEAGUE_TIMING_WINDOW_MULT`
 *  uses. It is a RATIO of flight times, not a second league table: a pitcher who has bought 22
 *  points of Speed at the Majors shortens the flight to 0.38 s and the window with it, and an
 *  eephus lengthens both. A pitch with no `timeToPlateS` at all (an old fixture, a hand-built
 *  pitchResult) scales by 1 and keeps its exact pre-R16 window.
 *
 *  It multiplies the window used for CONTACT QUALITY, and the foul boundary derived from it, on
 *  both the ordinary swing and the bunt - a bunt is timing alone, so leaving it out would have
 *  made the bunt the one swing a fast pitch could not punish. */
export function flightWindowMult(pitchResult, settings) {
  const t = pitchResult && pitchResult.timeToPlateS;
  if (!Number.isFinite(t) || t <= 0) return 1;
  const ref = (settings && settings.FEEL && settings.FEEL.engine && settings.FEEL.engine.referenceFlightS) || 0;
  if (!Number.isFinite(ref) || ref <= 0) return 1;
  return t / ref;
}

/** Playtest 1, batch 2 (2026-09-23): THE BUNT, rebuilt from timing to a HELD POSITION. Matt: "if I
 *  hold it down, the bat should stay there. A bunt isn't a swing... you hold the bat horizontal and
 *  move it up/down/side to side to hit the ball." `ui.js`'s HumanAgent only ever calls this branch
 *  once the pitch has actually CROSSED while the bunt button was still held - "no timing tap" - so
 *  there is no window to be inside or outside of any more; there is only where the bar was.
 *
 *  Reused, unchanged: the 2-D cursor a decision carries is the SAME `cursor` an ordinary swing
 *  reads (`cursorOf`), so a CPU bunt (`agents.js`'s `CpuBatter`, which already builds `cursor:
 *  {x: aimX, y: aimY}` for every decision, bunt or not) needs no changes here at all - it is aiming
 *  at where it thinks the ball is going exactly as it always has, and that aim is now what the bat
 *  bar is "held" at.
 *
 *  Contact is BAT-VS-BALL POSITION: `offX`/`offY` are the same "ball minus cursor" measurement
 *  `swing()` takes below, just against a BAR instead of a circle - wide across the plate
 *  (`BUNT_BAR_HALF_X`), thin top to bottom (`BUNT_BAR_HALF_Y`), because a bat is a bar, not a
 *  circle. Outside either half-width the bat never reaches the ball at all: `swung: false` reads
 *  through `game.js`'s own `!swingResult.swung` branch exactly like a batter who let a pitch go by
 *  - an ordinary ball or strike, never a foul (a bat that was never near the ball cannot nick it).
 *
 *  Inside the bar, HOW CENTRED the contact was is what `outcomes.js`'s `resolveBunt` decides fair,
 *  foul or pop-up from - `offY`/the bar's own half-height ride along on the returned object for
 *  exactly that (a bat sitting too far under the ball is what pops a real bunt up); a mishit near
 *  either END of the bar is a foul, decided right here since a foul bunt (unlike a fair one) never
 *  reaches `resolveBunt` at all - `game.js`'s own foul branch fires before that call, exactly as it
 *  did for the old timing-window foul. `MECHANICS.foulNeverThirdStrike`'s one exception (a foul
 *  BUNT with two strikes is strike three) still reads `swingResult.bunt`, unchanged by this stage.
 *
 *  `distanceFt`/`sprayAngleDeg` (a fair bunt only) are still `BUNT_DIST_FT`/`+/-BUNT_SPRAY_DEG` -
 *  the spec's own numbers, untouched: a bunt has no carry to derive them from. */
function buntSwing(decision, settings, rand01, pitchResult) {
  const cursor = cursorOf(decision);
  const offX = pitchResult.x - cursor.x;
  const offY = (pitchResult.y || 0) - cursor.y;
  const halfX = settings.BUNT_BAR_HALF_X != null ? settings.BUNT_BAR_HALF_X : 0.95;
  const halfY = settings.BUNT_BAR_HALF_Y != null ? settings.BUNT_BAR_HALF_Y : 0.28;
  if (Math.abs(offX) > halfX || Math.abs(offY) > halfY) {
    return { swung: false, contact: false, foul: false, inPlay: false };
  }
  const foulX = halfX * (settings.BUNT_FOUL_X_FRAC != null ? settings.BUNT_FOUL_X_FRAC : 0.62);
  if (Math.abs(offX) > foulX) {
    return { swung: true, contact: true, foul: true, inPlay: false, bunt: true };
  }
  const dist = settings.BUNT_DIST_FT || [8, 40];
  const sprayMax = settings.BUNT_SPRAY_DEG != null ? settings.BUNT_SPRAY_DEG : 30;
  const distanceFt = dist[0] + rand01() * (dist[1] - dist[0]);
  const sprayAngleDeg = (rand01() * 2 - 1) * sprayMax;
  return { swung: true, contact: true, foul: false, inPlay: true, bunt: true,
    kind: 'ground', launchAngleDeg: 0, exitVeloMph: 0, distanceFt, sprayAngleDeg,
    offY, barHalfY: halfY, q: 1 - Math.abs(offX) / foulX, centered: Math.abs(offX) <= foulX * 0.5,
    mode: 'bunt' };
}

/** R19: how much of the good-contact timing window survives where this pitch crossed. 1 inside
 *  `EDGE_CONTACT.start` of the middle, falling linearly to `1 - penalty` at the zone edge, and
 *  `1 - penalty` for anything outside it. */
export function edgeWindowMult(pitchResult, settings) {
  const E = settings && settings.EDGE_CONTACT;
  if (!E || !E.penalty) return 1;
  const zone = settings.ZONE || { xMax: 1, yMax: 1 };
  const e = Math.max(Math.abs(pitchResult.x || 0) / (zone.xMax || 1), Math.abs(pitchResult.y || 0) / (zone.yMax || 1));
  const t = Math.max(0, Math.min(1, (e - E.start) / Math.max(1e-6, 1 - E.start)));
  return 1 - E.penalty * t;
}

export function swing(pitchResult, batterSkills, decision, settings, rand01, league) {
  if (!decision || decision.action !== 'swing') {
    return { swung: false, contact: false, foul: false, inPlay: false };
  }
  // RA: a bunt is decided before the pitch and resolved on its own terms (see `buntSwing` above).
  if (decision.bunt) return buntSwing(decision, settings, rand01, pitchResult);

  const F = settings.FEEL.engine;
  const hitAccPts = Math.max(0, batterSkills.hitAcc || 0);
  const hitPowPts = Math.max(0, batterSkills.hitPow || 0);
  const effect = settings.SKILL_EFFECT;

  const mode = modeOf(decision);
  // R11 (docs/BASEBALL-3D-BUILD.md section 9): "Little League is forgiving, Majors is tight"
  // (Matt, 2026-09-21) - LEAGUE_TIMING_WINDOW_MULT widens or narrows the good-contact window
  // itself, on top of hitAcc's own per-point widening. `college`'s 1.0 is a true no-op: every
  // number this engine was derived against (R5's exit-velocity/carry targets included) stays
  // exactly where it was measured.
  const windowMult = (settings.LEAGUE_TIMING_WINDOW_MULT && settings.LEAGUE_TIMING_WINDOW_MULT[league]) || 1;
  // R16: THE PITCH'S OWN FLIGHT TIME scales the window too (see `flightWindowMult`) - this is the
  // whole of what makes pitch Speed a skill rather than a readout.
  const flightMult = flightWindowMult(pitchResult, settings);
  const baseWindowMs = F.timingWindow * windowMult * flightMult * (1 + hitAccPts * (effect.hitAcc.whiffReductionPerPt || 0) * 4);
  const foulBoundaryMs = baseWindowMs * F.foulMult;
  // R19: an edge pitch narrows the good-contact window, never the foul boundary (settings.js's
  // EDGE_CONTACT has why).
  const timingWindowMs = baseWindowMs * edgeWindowMult(pitchResult, settings);
  const timingErrorMs = decision.timingErrorMs || 0;
  const absTiming = Math.abs(timingErrorMs);

  if (absTiming > foulBoundaryMs) {
    return { swung: true, contact: false, foul: false, inPlay: false };
  }

  // R2: the 2-D offset between where the cursor was and where the pitch actually crossed, both in
  // zone units. `offX`/`offY` are measured BALL MINUS CURSOR - a positive `offY` means the ball
  // crossed ABOVE the middle of the circle, i.e. the batter swung under it.
  const cursor = cursorOf(decision);
  const offX = pitchResult.x - cursor.x;
  const offY = (pitchResult.y || 0) - cursor.y;
  const d = Math.hypot(offX, offY);
  // The cursor's own radius widens with hitAcc, the same skill that already widened the 1-D sweet
  // spot ("bigger timing window and bigger sweet spot", doc §6) - the mode sets the base.
  // R16: `LEAGUE_CONTACT_MULT` widens the circle at the two bottom rungs, the same shape
  // `LEAGUE_TIMING_WINDOW_MULT` has on the timing axis - `FEEL.engine.cursorR` is the College-and-up
  // circle now, and College's own 1.0 is a true no-op.
  const contactMult = (settings.LEAGUE_CONTACT_MULT && settings.LEAGUE_CONTACT_MULT[league]) || 1;
  const cursorR = (F.cursorR[mode] || F.cursorR.contact) * contactMult * (1 + hitAccPts * (effect.hitAcc.contactRadiusInPerPt || 0));
  // The placement half of contact quality. A ball that crosses outside the circle is a MISS,
  // whatever the timing was - the R2 statement of the old `batReach` rule, in two axes.
  const placeQ = Math.max(0, 1 - d / cursorR);
  if (placeQ <= 0) {
    return { swung: true, contact: false, foul: false, inPlay: false };
  }

  if (absTiming > timingWindowMs) {
    return { swung: true, contact: true, foul: true, inPlay: false };
  }

  // The contact-quality axis (BB-2a). R5 rule 1: `q` IS TIMING QUALITY ALONE - `placeQ` no longer
  // multiplies it. Placement has already had its say (a ball outside the circle is a miss, above),
  // and everything downstream that reads `q` is about how well the ball was TIMED: exit velocity,
  // the line-drive band's tightness, the spray model's pull-vs-gap blend, and `outcomes.js`'s
  // LINE_THROUGH_Q. Folding placement in as a second multiplier is half of why a Perfect swing
  // 0.2 zone units off centre carried 0 ft every time (settings.js's R5 block has the measurement).
  const q = qualityFor(absTiming, F.perfectMs, timingWindowMs);
  const placeFrac = Math.min(1, d / cursorR);
  // "Centered" is now "inside the inner half of the circle" - the R2 statement of the sweet spot,
  // kept because `sim-baseball.mjs --attribute` measures the share of centered contact.
  const centered = d <= cursorR * 0.5;

  // The vertical bands, in zone units, from this cursor's own radius (settings.js's
  // `flyOffsetFrac`/`popupOffsetFrac` carry why they are fractions and not the spec's absolutes).
  const flyOffY = cursorR * F.flyOffsetFrac;
  const popupOffY = cursorR * F.popupOffsetFrac;

  let launchAngleDeg;
  let kind;
  if (offY > popupOffY) {
    // Right under it: a weak pop-up (the band swing.js has always used for one).
    launchAngleDeg = 55 + rand01() * 15;
    kind = 'popup';
  } else if (offY > flyOffY) {
    // Under it: a fly ball, inside `outcomes.js`'s own 26-to-52 deg fly band.
    launchAngleDeg = F.flyCenterDeg + (rand01() * 2 - 1) * F.flySpreadDeg;
    kind = 'fly';
  } else if (offY < -flyOffY) {
    // Over it: a low, hard grounder (the band swing.js has always used for one).
    launchAngleDeg = rand01() * 8;
    kind = 'ground';
  } else {
    // On it: a line drive or a fly ball. The band NARROWS toward a tight line-drive spread as
    // timing quality rises, and WIDENS toward topped (low angle) and popped-up (high angle) as it
    // falls - a squared-up ball flies true; a mistimed-but-centered one still gets under or over
    // it. Unchanged from BB-2a, which is what keeps this branch's own calibration.
    // R5 rule 1: and the ONE thing the outer half of the circle costs is this band's tightness.
    // `rimFrac` is 0 anywhere in the inner half (`rimSpreadStartFrac`, the same 0.5 `centered`
    // uses) and 1 at the rim, and it spends the swing's timing quality: a perfectly-timed ball met
    // on the rim flies as HARD as one met dead centre (rule 1) and as TRUE as a badly-timed one.
    const rimFrac = Math.max(0, (placeFrac - F.rimSpreadStartFrac) / Math.max(1e-6, 1 - F.rimSpreadStartFrac));
    const trueness = q * (1 - Math.min(1, rimFrac));
    const spread = F.lineDriveSpreadMaxDeg - trueness * (F.lineDriveSpreadMaxDeg - F.lineDriveSpreadMinDeg);
    launchAngleDeg = Math.max(0, F.lineDriveCenterDeg + (rand01() * 2 - 1) * spread);
    kind = launchAngleDeg > 26 ? 'fly' : 'line';
  }

  // Exit velocity: TIMING QUALITY (q) gates how much of the swing's power actually reaches the
  // ball - power multiplies a good swing, it never rescues a bad one. `qualityFloor` is the share
  // of the no-power base a swing barely inside the window (q=0) still keeps; the power skill's own
  // contribution is itself scaled by q. R5 rule 1: THERE IS NO PLACEMENT TERM HERE AT ALL any more.
  // `placementPenaltyMph` is deleted from settings.js; where the ball was met steers it (spray,
  // kind, launch-angle tightness) and never how hard it was hit. R5 rule 2: the three numbers this
  // produces are broadcast-real (about 50 mph barely timed, 80 perfectly timed with no power
  // points, 105 perfectly timed at College's cap), because R4's HOME RUN strip prints them.
  const powerBonus = hitPowPts * effect.hitPow.exitVeloMphPerPt;
  const modeMul = (F.modeExitMult && F.modeExitMult[mode]) || 1;
  // BB-2d commit 4: the batted ball itself now scales with the league's own field
  // (`LEAGUE_POWER_SCALE`, settings.js). Scaled relative to `CARRY_ZERO_MPH` (carryFt's own "no
  // carry below this speed" baseline), not multiplied against the raw mph value - see settings.js's
  // own CARRY_ZERO_MPH comment for the measured comparison.
  const leaguePowerScale = (settings.LEAGUE_POWER_SCALE && settings.LEAGUE_POWER_SCALE[league]) != null
    ? settings.LEAGUE_POWER_SCALE[league] : 1;
  const carryZeroMph = settings.CARRY_ZERO_MPH != null ? settings.CARRY_ZERO_MPH : 30;
  const scaleAboveZero = (mph) => carryZeroMph + leaguePowerScale * (mph - carryZeroMph);
  const baseExitVelo = settings.BASE_EXIT_VELO != null ? settings.BASE_EXIT_VELO : 80;
  const timingQualityMul = F.qualityFloor + (1 - F.qualityFloor) * q;
  const rawTimedExitVelo = baseExitVelo * timingQualityMul + powerBonus * q;
  const timedExitVelo = scaleAboveZero(rawTimedExitVelo);
  const rawMinExitVelo = settings.MIN_EXIT_VELO_MPH != null ? settings.MIN_EXIT_VELO_MPH : 42;
  const minExitVelo = scaleAboveZero(rawMinExitVelo);
  const noiseMph = F.exitVeloNoiseMph != null ? F.exitVeloNoiseMph : 4;
  const exitVeloMph = Math.max(minExitVelo, timedExitVelo * modeMul + (rand01() * 2 - 1) * noiseMph);

  // Spray: "Early contact pulls the ball, late contact goes the opposite way" (doc §12), but a
  // PERFECTLY-timed swing must not spray toward the worst part of the field. The pull/opposite
  // magnitude a sloppy swing can reach SHRINKS toward zero as q rises (`pullMaxDeg` at q=0); at
  // q=1 the swing instead centers on whichever GAP its timing sign points toward
  // (`perfectSprayDeg`). R2 adds the third term: WHERE ON THE CURSOR the ball was met - a ball
  // crossing off the circle's centre goes that way, which is what "the horizontal offset adds to
  // pull/opposite direction exactly as aimX did" means in two axes.
  const timingSign = timingErrorMs < 0 ? 1 : -1; // early (negative error) pulls; late goes opposite
  const pullFrac = Math.max(-1, Math.min(1, -timingErrorMs / Math.max(1, timingWindowMs)));
  const pullSprayDeg = pullFrac * F.pullMaxDeg * (1 - q);
  const gapSprayDeg = timingSign * F.perfectSprayDeg * q + (rand01() * 2 - 1) * F.perfectSpraySpreadDeg * q;
  const offsetSprayDeg = Math.max(-1, Math.min(1, offX / cursorR)) * F.offsetSprayDeg;
  const sprayAngleDeg = pullSprayDeg + gapSprayDeg + offsetSprayDeg + (rand01() * 2 - 1) * 10 * (1 - q);

  return { swung: true, contact: true, foul: false, inPlay: true, exitVeloMph, launchAngleDeg, sprayAngleDeg, q, centered, kind, mode };
}

export default { swing, qualityFor, computeSwingTiming, modeOf, flightWindowMult };
