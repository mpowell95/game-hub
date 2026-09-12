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

  let launchAngleDeg;
  let kind;
  if (centered) {
    // Centered: a line drive or a fly ball, drawn from a moderate positive spread.
    launchAngleDeg = 12 + rand01() * 30;
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

  // Exit velocity: power skill, a charged-swing bonus, and a quality penalty the further the
  // contact sat from dead center of the sweet spot (a topped/jammed ball carries less).
  const powerBonus = hitPowPts * effect.hitPow.exitVeloMphPerPt;
  const qualityFrac = Math.min(1, Math.abs(offset) / Math.max(sweetSpotWidth, batReach));
  const chargeMul = charged ? F.chargePower : 1;
  const baseExitVelo = (62 + powerBonus) * chargeMul;
  const exitVeloMph = Math.max(35, baseExitVelo - qualityFrac * 18 + (rand01() * 2 - 1) * 4);

  // Spray: "Early contact pulls the ball, late contact goes the opposite way" (doc §12). Sign is
  // this engine's own convention (negative = pull); magnitude scales with how early/late.
  const pullFrac = Math.max(-1, Math.min(1, -timingErrorMs / Math.max(1, timingWindowMs)));
  const sprayAngleDeg = pullFrac * 40 + (rand01() * 2 - 1) * 10;

  return { swung: true, contact: true, foul: false, inPlay: true, exitVeloMph, launchAngleDeg, sprayAngleDeg };
}

export default { swing };
