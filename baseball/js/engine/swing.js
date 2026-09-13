// swing.js : resolve one batter decision against one already-thrown pitch. Pure function of its
// inputs - no clock, no module-scope state, no direct RNG object (the caller owns advancing/
// snapshotting the stream via a plain `rand01` callback, same contract as pitch.js's `flyPitch`).
//
// Two independent axes, per doc §12 ([Tested] in the prototype):
//  1. TIMING (early/late, ms) decides contact quality (perfect/foul/miss) AND, per doc, "Early
//     contact pulls the ball. Late contact goes the opposite way" - so timing also drives spray
//     direction (pull vs opposite field).
//  2. LATERAL PLACEMENT (where the bat's sweet spot was dragged to, vs. where the pitch actually
//     crossed) decides hit TYPE: "Centered on the sweet spot: line drive or fly ball. Off-center:
//     grounder toward the bat's end, pop-up toward the handle."
// Which side of "off-center" is the bat's end vs. the handle is not given a number by the doc
// (only the qualitative rule) - the sign convention below (further from the batter = the end,
// closer = the handle) is this engine's own invented, but doc-consistent, choice.
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

export function swing(pitchResult, batterSkills, decision, settings, rand01) {
  if (!decision || decision.action !== 'swing') {
    return { swung: false, contact: false, foul: false, inPlay: false };
  }

  const F = settings.FEEL.engine;
  const hitAccPts = Math.max(0, batterSkills.hitAcc || 0);
  const hitPowPts = Math.max(0, batterSkills.hitPow || 0);
  const effect = settings.SKILL_EFFECT;

  const charged = !!decision.charged;
  const timingWindowMs = F.timingWindow * (charged ? F.chargeWindowMult : 1)
    * (1 + hitAccPts * (effect.hitAcc.whiffReductionPerPt || 0) * 4);
  const foulBoundaryMs = timingWindowMs * F.foulMult;
  const timingErrorMs = decision.timingErrorMs || 0;
  const absTiming = Math.abs(timingErrorMs);

  if (absTiming > foulBoundaryMs) {
    return { swung: true, contact: false, foul: false, inPlay: false };
  }

  // Lateral offset between where the bat's sweet spot was placed and where the pitch actually
  // crossed - both already in the doc's own unit (a fraction of the plate half-width).
  const aimX = decision.aimX != null ? decision.aimX : 0;
  const offset = pitchResult.x - aimX;
  const batReach = F.batReach;
  if (Math.abs(offset) > batReach) {
    // The bat was placed somewhere this pitch could never reach from - an automatic miss,
    // whatever the timing was. This is the "reach" half of the doc's bat model, not a timing miss.
    return { swung: true, contact: false, foul: false, inPlay: false };
  }

  if (absTiming > timingWindowMs) {
    return { swung: true, contact: true, foul: true, inPlay: false };
  }

  // Contact. sweetSpot widens with hitAcc ("bigger timing window and bigger sweet spot", doc §6).
  const sweetSpotWidth = F.sweetSpot * (1 + hitAccPts * (effect.hitAcc.contactRadiusInPerPt || 0));
  const centered = Math.abs(offset) <= sweetSpotWidth;

  // The contact-quality axis (BB-2a): 1 at dead-on timing, falling linearly to 0 at the window's
  // own edge. Independent of the lateral placement axis below - a batter can be perfectly timed
  // and still jammed, or sloppily timed and still centered.
  const q = qualityFor(absTiming, F.perfectMs, timingWindowMs);

  let launchAngleDeg;
  let kind;
  if (centered) {
    // Centered: a line drive or a fly ball. The band NARROWS toward a tight line-drive spread as
    // timing quality rises, and WIDENS toward topped (low angle) and popped-up (high angle) as it
    // falls - a squared-up ball flies true; a mistimed-but-centered one still gets under or over it.
    const spread = F.lineDriveSpreadMaxDeg - q * (F.lineDriveSpreadMaxDeg - F.lineDriveSpreadMinDeg);
    launchAngleDeg = Math.max(0, F.lineDriveCenterDeg + (rand01() * 2 - 1) * spread);
    kind = launchAngleDeg > 26 ? 'fly' : 'line';
  } else if (offset > 0) {
    // Toward the bat's end (this engine's sign convention, see header): a low, hard grounder.
    launchAngleDeg = rand01() * 8;
    kind = 'ground';
  } else {
    // Toward the handle: a weak pop-up.
    launchAngleDeg = 55 + rand01() * 15;
    kind = 'popup';
  }
  void kind; // outcomes.js re-derives its own kind from launchAngleDeg; kept here for callers/tests

  // Exit velocity: TIMING QUALITY (q) gates how much of the swing's power actually reaches the
  // ball - power multiplies a good swing, it never rescues a bad one. `qualityFloor` is the share
  // of the no-power base a swing barely inside the window (q=0) still keeps; the power skill's own
  // contribution is itself scaled by q, so a max-Power swing with q=0 caps at `qualityFloor` of
  // base and nothing more. The LATERAL placement penalty (how far off dead center of the sweet
  // spot) stays as its own, separate, flat-mph subtraction - placement and timing are two axes,
  // per doc §12, and neither substitutes for the other.
  const powerBonus = hitPowPts * effect.hitPow.exitVeloMphPerPt;
  const qualityFrac = Math.min(1, Math.abs(offset) / Math.max(sweetSpotWidth, batReach));
  const chargeMul = charged ? F.chargePower : 1;
  const BASE_EXIT_VELO = 62;
  const timingQualityMul = F.qualityFloor + (1 - F.qualityFloor) * q;
  const timedExitVelo = BASE_EXIT_VELO * timingQualityMul + powerBonus * q;
  const exitVeloMph = Math.max(35, (timedExitVelo - qualityFrac * 18) * chargeMul + (rand01() * 2 - 1) * 4);

  // Spray: "Early contact pulls the ball, late contact goes the opposite way" (doc §12), but a
  // PERFECTLY-timed swing must not spray toward the worst part of the field (BB-2a step 3 fixes
  // the geometry that made straightaway-center the deepest fence and the softest out-zone). The
  // pull/opposite-field magnitude a sloppy swing can reach SHRINKS toward zero as q rises
  // (`pullMaxDeg` at q=0, none of it at q=1); at q=1 the swing instead centers on whichever GAP its
  // timing sign points toward (`perfectSprayDeg`, one of the two, narrow spread) - a squared-up
  // ball is aimed at a gap, not at dead center where a fielder stands and the fence is deepest.
  const timingSign = timingErrorMs < 0 ? 1 : -1; // early (negative error) pulls; late goes opposite
  const pullFrac = Math.max(-1, Math.min(1, -timingErrorMs / Math.max(1, timingWindowMs)));
  const pullSprayDeg = pullFrac * F.pullMaxDeg * (1 - q);
  const gapSprayDeg = timingSign * F.perfectSprayDeg * q + (rand01() * 2 - 1) * F.perfectSpraySpreadDeg * q;
  const sprayAngleDeg = pullSprayDeg + gapSprayDeg + (rand01() * 2 - 1) * 10 * (1 - q);

  return { swung: true, contact: true, foul: false, inPlay: true, exitVeloMph, launchAngleDeg, sprayAngleDeg, q };
}

export default { swing, qualityFor };
