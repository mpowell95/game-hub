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
 *  circle, x1.12 exit velocity). Anything else reads as CONTACT, which is the forgiving one. */
export function modeOf(decision) {
  return decision && decision.mode === 'power' ? 'power' : 'contact';
}

/** RA (docs/BASEBALL-3D-BUILD.md section 9): THE BUNT. A different swing entirely, so it is its own
 *  branch rather than a flag threaded through the one above: a bunt has no cursor, no mode, no
 *  spray geometry off the bat and no exit velocity worth modelling - the batter holds the bat out
 *  and the ball dies in front of the plate. What it DOES have is timing, on a window widened by
 *  `BUNT_WINDOW_MULT`, and that timing is the whole of its quality.
 *
 *  Three facts, all the spec's: the ball is always `kind: 'ground'`; it travels `BUNT_DIST_FT` feet
 *  and sprays inside `+/-BUNT_SPRAY_DEG` (both uniform, both well inside `FOUL_LINE_DEG`, so a
 *  bunt that makes contact is never in foul ground); and `q` comes from timing ALONE.
 *
 *  A mistimed bunt is a FOUL, never a swinging miss - a bat held in the zone nicks the ball rather
 *  than passing under it, and the spec names only two outcomes for a bunt attempt. What makes that
 *  a real cost rather than a free pitch is game.js's own rule: a foul bunt with two strikes is
 *  strike three (`swingResult.bunt` is what tells it apart from an ordinary foul, which can never
 *  be strike three - `MECHANICS.foulNeverThirdStrike`).
 *
 *  `distanceFt`/`sprayAngleDeg` are returned here rather than derived by `outcomes.js`'s `carryFt`
 *  because a bunt has no carry: 8 to 40 ft is the fact, and an exit-velocity-and-launch-angle model
 *  asked to produce it would be arithmetic invented to justify a number already known. */
function buntSwing(batterSkills, decision, settings, rand01) {
  const F = settings.FEEL.engine;
  const hitAccPts = Math.max(0, batterSkills.hitAcc || 0);
  const effect = settings.SKILL_EFFECT;
  const baseWindowMs = F.timingWindow * (1 + hitAccPts * (effect.hitAcc.whiffReductionPerPt || 0) * 4);
  const windowMs = baseWindowMs * (settings.BUNT_WINDOW_MULT != null ? settings.BUNT_WINDOW_MULT : 1.6);
  const timingErrorMs = decision.timingErrorMs || 0;
  const absTiming = Math.abs(timingErrorMs);
  if (absTiming > windowMs) {
    return { swung: true, contact: true, foul: true, inPlay: false, bunt: true };
  }
  const q = qualityFor(absTiming, F.perfectMs, windowMs);
  const dist = settings.BUNT_DIST_FT || [8, 40];
  const sprayMax = settings.BUNT_SPRAY_DEG != null ? settings.BUNT_SPRAY_DEG : 30;
  const distanceFt = dist[0] + rand01() * (dist[1] - dist[0]);
  const sprayAngleDeg = (rand01() * 2 - 1) * sprayMax;
  return { swung: true, contact: true, foul: false, inPlay: true, bunt: true,
    kind: 'ground', launchAngleDeg: 0, exitVeloMph: 0, distanceFt, sprayAngleDeg, q, centered: false,
    mode: 'bunt' };
}

export function swing(pitchResult, batterSkills, decision, settings, rand01, league) {
  if (!decision || decision.action !== 'swing') {
    return { swung: false, contact: false, foul: false, inPlay: false };
  }
  // RA: a bunt is decided before the pitch and resolved on its own terms (see `buntSwing` above).
  if (decision.bunt) return buntSwing(batterSkills, decision, settings, rand01);

  const F = settings.FEEL.engine;
  const hitAccPts = Math.max(0, batterSkills.hitAcc || 0);
  const hitPowPts = Math.max(0, batterSkills.hitPow || 0);
  const effect = settings.SKILL_EFFECT;

  const mode = modeOf(decision);
  const timingWindowMs = F.timingWindow * (1 + hitAccPts * (effect.hitAcc.whiffReductionPerPt || 0) * 4);
  const foulBoundaryMs = timingWindowMs * F.foulMult;
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
  const cursorR = (F.cursorR[mode] || F.cursorR.contact) * (1 + hitAccPts * (effect.hitAcc.contactRadiusInPerPt || 0));
  // The placement half of contact quality. A ball that crosses outside the circle is a MISS,
  // whatever the timing was - the R2 statement of the old `batReach` rule, in two axes.
  const placeQ = Math.max(0, 1 - d / cursorR);
  if (placeQ <= 0) {
    return { swung: true, contact: false, foul: false, inPlay: false };
  }

  if (absTiming > timingWindowMs) {
    return { swung: true, contact: true, foul: true, inPlay: false };
  }

  // The contact-quality axis (BB-2a), now with R2's placement term folded in: `qualityFor` is 1 at
  // dead-on timing falling to 0 at the window's own edge, and `placeQ` is 1 dead centre in the
  // circle falling to 0 at its rim. Both have to be good for the ball to be squared up.
  const q = qualityFor(absTiming, F.perfectMs, timingWindowMs) * placeQ;
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
    const spread = F.lineDriveSpreadMaxDeg - q * (F.lineDriveSpreadMaxDeg - F.lineDriveSpreadMinDeg);
    launchAngleDeg = Math.max(0, F.lineDriveCenterDeg + (rand01() * 2 - 1) * spread);
    kind = launchAngleDeg > 26 ? 'fly' : 'line';
  }

  // Exit velocity: TIMING QUALITY (q) gates how much of the swing's power actually reaches the
  // ball - power multiplies a good swing, it never rescues a bad one. `qualityFloor` is the share
  // of the no-power base a swing barely inside the window (q=0) still keeps; the power skill's own
  // contribution is itself scaled by q. The PLACEMENT penalty stays as its own, separate, flat-mph
  // subtraction (`placementPenaltyMph`, the 18 the 1-D model already charged) - placement and
  // timing are two axes, per doc §12, and neither substitutes for the other.
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
  const baseExitVelo = settings.BASE_EXIT_VELO != null ? settings.BASE_EXIT_VELO : 36.93;
  const timingQualityMul = F.qualityFloor + (1 - F.qualityFloor) * q;
  const rawTimedExitVelo = baseExitVelo * timingQualityMul + powerBonus * q;
  const timedExitVelo = scaleAboveZero(rawTimedExitVelo);
  const rawMinExitVelo = settings.MIN_EXIT_VELO_MPH != null ? settings.MIN_EXIT_VELO_MPH : baseExitVelo * (35 / 62);
  const minExitVelo = scaleAboveZero(rawMinExitVelo);
  const exitVeloMph = Math.max(minExitVelo,
    (timedExitVelo - placeFrac * F.placementPenaltyMph) * modeMul + (rand01() * 2 - 1) * 4);

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

export default { swing, qualityFor, computeSwingTiming, modeOf };
