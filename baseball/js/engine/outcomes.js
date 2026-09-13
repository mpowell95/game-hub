// outcomes.js : turn a batted ball (exit velocity, launch angle, spray angle) into a result - out
// or a hit of 1-4 bases - using OUT-ZONE GEOMETRY (`zones.js`, doc §10) rather than phase 1's
// invented `fieldingSkill01` ramp. The real design has no "error" outcome at all (doc §10's list
// is singles/doubles/triples/homers/outs) - phase 1's `error` result is gone.

import { FOUL_LINE_DEG, CARRY_SCALE, LINE_THROUGH_Q, LINE_THROUGH_MAX_FT } from './settings.js';
import { angleSector } from './zones.js';

/** Rough carry distance in feet from exit velocity (mph) and launch angle (deg). A simplified,
 *  monotonic model (more speed and a mid-range angle carry further); not aerodynamically real,
 *  and not meant to be - there is no reference to calibrate against, so this stays a plain,
 *  reproducible function of its two inputs rather than a "realistic" model with invented drag
 *  coefficients. Draft [Open item 23]: the exact carry curve; CARRY_SCALE lives in settings.js. */
export function carryFt(exitVeloMph, launchAngleDeg) {
  const clampedAngle = Math.max(0, Math.min(70, launchAngleDeg));
  // sin(2*angle) peaks at 45 degrees, which is where a real batted ball carries furthest for a
  // given speed - the same shape a real projectile's range curve has, without modeling drag.
  const angleFactor = Math.max(0, Math.sin((2 * clampedAngle * Math.PI) / 180));
  const speedFactor = Math.max(0, exitVeloMph - 30);
  return Math.max(0, speedFactor * angleFactor * CARRY_SCALE);
}

function battedBallKind(launchAngleDeg) {
  if (launchAngleDeg < 8) return 'ground';
  if (launchAngleDeg < 26) return 'line';
  if (launchAngleDeg < 52) return 'fly';
  return 'popup';
}

/** Piecewise-linear fence distance at a spray angle, across the doc's five named points (doc §10:
 *  fences differ left/left-center/center/right-center/right, and grow per league - `FIELD[league]
 *  .fenceFt` in settings.js). A three-point park shape (the existing `PARKS` entries' plain
 *  {left,center,right}) still works unmodified: the two center points are filled in by averaging
 *  when absent, so no named ballpark needed to change for this to land. */
export function fenceFtAt(sprayDeg, fenceFt) {
  const left = fenceFt.left, center = fenceFt.center, right = fenceFt.right;
  const leftCenter = fenceFt.leftCenter != null ? fenceFt.leftCenter : (left + center) / 2;
  const rightCenter = fenceFt.rightCenter != null ? fenceFt.rightCenter : (center + right) / 2;
  const pts = [left, leftCenter, center, rightCenter, right];
  const t = Math.max(0, Math.min(1, (sprayDeg + FOUL_LINE_DEG) / (2 * FOUL_LINE_DEG)));
  const segT = t * 4;
  const i = Math.min(3, Math.floor(segT));
  const frac = segT - i;
  return pts[i] + (pts[i + 1] - pts[i]) * frac;
}

/**
 * @param {{exitVeloMph:number, launchAngleDeg:number, sprayAngleDeg:number, q?:number}} batted -
 *   `q` (BB-2a) is swing.js's contact-quality axis, 0..1; used only by the line-through rule below
 * @param {{infield:Array, outfield:Array}} zones - `zonesFor(league, shiftDeg)` from zones.js
 * @param {object} settings
 * @param {{left:number, leftCenter?:number, center:number, rightCenter?:number, right:number}} fenceFt
 * @param {number} hitSpd - the batter's hitSpd skill points (doc §6, [Locked]: "Batter Speed
 *   affects beating out grounders and stretching hits" - the beat-out half, this phase)
 * @param {function} rand01
 * @returns {{result:'out'|'hit', bases?:number, kind:string, distanceFt:number, isFoul:boolean}}
 */
export function resolveContact(batted, zones, settings, fenceFt, hitSpd, rand01) {
  const isFoul = Math.abs(batted.sprayAngleDeg) > FOUL_LINE_DEG;
  if (isFoul) {
    return { result: 'out', bases: 0, kind: 'foulout', distanceFt: 0, isFoul: true };
  }

  const kind = battedBallKind(batted.launchAngleDeg);
  const distanceFt = carryFt(batted.exitVeloMph, batted.launchAngleDeg);

  if (kind === 'popup') {
    // doc §10, [Locked]: "Pop-ups in the infield are outs."
    return { result: 'out', bases: 0, kind: 'popout', distanceFt, isFoul: false };
  }

  if (kind === 'ground') {
    const sector = angleSector(batted.sprayAngleDeg, zones.infield);
    if (distanceFt <= sector.toFt) {
      // A close play at the edge of the sector's reach: doc §6, [Locked], "Batter Speed affects
      // beating out grounders" - MECHANICS.beatOutPerPt/groundEdgeMarginFt name the roll.
      const nearEdge = distanceFt > sector.toFt - settings.MECHANICS.groundEdgeMarginFt;
      if (nearEdge) {
        const beatOutChance = Math.min(0.5, Math.max(0, hitSpd || 0) * settings.MECHANICS.beatOutPerPt);
        if (rand01() < beatOutChance) {
          return { result: 'hit', bases: 1, kind: 'ground-single-beatout', distanceFt, isFoul: false };
        }
      }
      return { result: 'out', bases: 0, kind: 'groundout', distanceFt, isFoul: false };
    }
    return { result: 'hit', bases: 1, kind: 'ground-single', distanceFt, isFoul: false };
  }

  // Line drives and non-homer flies. Check the fence before the out-zone: a ball that clears the
  // wall was never catchable regardless of where the sector's reach ends.
  const wallFt = fenceFtAt(batted.sprayAngleDeg, fenceFt);
  if (kind === 'fly' && distanceFt >= wallFt) {
    return { result: 'hit', bases: 4, kind: 'homer', distanceFt, isFoul: false };
  }

  const sector = angleSector(batted.sprayAngleDeg, zones.outfield);
  if (distanceFt <= sector.toFt) {
    // BB-2a step 3, [Draft]: a well-squared-up LINE DRIVE (contact quality `q` at or above
    // LINE_THROUGH_Q) still goes through for a hit up to LINE_THROUGH_MAX_FT - a "routine fly into
    // a sector" (the ordinary case below) stays an out, but a scorched line drive is not a fly ball
    // a fielder settles under; it is through the infielder's reach before an outfielder can close.
    if (kind === 'line' && (batted.q || 0) >= LINE_THROUGH_Q && distanceFt <= LINE_THROUGH_MAX_FT) {
      return { result: 'hit', bases: 1, kind: 'line-through', distanceFt, isFoul: false };
    }
    return { result: 'out', bases: 0, kind: kind === 'line' ? 'lineout' : 'flyout', distanceFt, isFoul: false };
  }
  // Through the outfield sector: a single through a gap, or a double/triple the deeper it carried
  // (doc §10, [Locked]: "Doubles in the gaps and down the lines. Triples in deep corners and deep
  // center" - the exact depth cutoffs are still invented, Open item 24, unchanged from phase 1).
  let bases = 1;
  if (distanceFt > 320) bases = 3;
  else if (distanceFt > 250) bases = 2;
  return { result: 'hit', bases, kind: `${kind}-hit`, distanceFt, isFoul: false };
}

export default { carryFt, fenceFtAt, resolveContact };
