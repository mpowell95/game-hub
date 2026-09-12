// outcomes.js : turn a batted ball (exit velocity, launch angle, spray angle) into a result -
// out, error, or a hit of 1-4 bases. Pure function of its inputs; the only randomness is the
// single `rand01` stream the caller passes in and owns.

/** Rough carry distance in feet from exit velocity (mph) and launch angle (deg). A simplified,
 *  monotonic model (more speed and a mid-range angle carry further); not aerodynamically real,
 *  and not meant to be - there is no reference to calibrate against, so this stays a plain,
 *  reproducible function of its two inputs rather than a "realistic" model with invented drag
 *  coefficients. Draft [Open item 23]: the exact carry curve. */
export function carryFt(exitVeloMph, launchAngleDeg) {
  const clampedAngle = Math.max(0, Math.min(70, launchAngleDeg));
  // sin(2*angle) peaks at 45 degrees, which is where a real batted ball carries furthest for a
  // given speed - the same shape a real projectile's range curve has, without modeling drag.
  const angleFactor = Math.max(0, Math.sin((2 * clampedAngle * Math.PI) / 180));
  const speedFactor = Math.max(0, exitVeloMph - 30);
  // CARRY_SCALE calibrated so a Statcast-typical 105mph/30deg batted ball (a real, well-struck
  // home run swing) carries about 400ft: 6.2 -> (105-30) * sin(60deg) * 6.2 ~= 402ft.
  const CARRY_SCALE = 6.2; // Draft [Open item 23]
  return Math.max(0, speedFactor * angleFactor * CARRY_SCALE);
}

function battedBallKind(launchAngleDeg) {
  if (launchAngleDeg < 8) return 'ground';
  if (launchAngleDeg < 26) return 'line';
  if (launchAngleDeg < 52) return 'fly';
  return 'popup';
}

/**
 * @param {{exitVeloMph:number, launchAngleDeg:number, sprayAngleDeg:number}} batted
 * @param {number} fieldingSkill01 - 0..1, how good the responsible defense is. There is no
 *   per-player "fielding" skill in the real design (doc §6 names only hitAcc/hitPow/hitSpd and
 *   pitchSpd/pitchAcc/pitchSpin) - defense there is entirely OUT-ZONE GEOMETRY, sized per league
 *   (doc §10, "out zones also grow"). This parameter is this engine's own stand-in until that
 *   geometry is built (Draft [Open item 7], same tag as the invented FIELD/PARKS distances below).
 * @param {object} settings
 * @param {{left:number,center:number,right:number}} parkFt - the wall distances in play
 * @param {function} rand01
 * @returns {{result:'out'|'error'|'hit', bases?:number, kind:string, distanceFt:number, isFoul:boolean}}
 */
export function resolveContact(batted, fieldingSkill01, settings, parkFt, rand01) {
  // Foul territory: spray angle beyond the foul lines. Half the swept spray range is foul on
  // either side, symmetric with settings.FIELD.foulLineDeg defining the fair sector's half-width.
  const fairHalfWidth = settings.FIELD.foulLineDeg;
  const isFoul = Math.abs(batted.sprayAngleDeg) > fairHalfWidth;
  if (isFoul) {
    return { result: 'out', bases: 0, kind: 'foulout', distanceFt: 0, isFoul: true };
  }

  const kind = battedBallKind(batted.launchAngleDeg);
  const distanceFt = carryFt(batted.exitVeloMph, batted.launchAngleDeg);

  const defense01 = Math.max(0, Math.min(1, fieldingSkill01 || 0));
  const errorChance = Math.max(0.01, 0.06 - defense01 * 0.05); // Draft [Open item 7]

  // Which fence this spray angle would need to clear - a simple lerp across left/center/right.
  const t = (batted.sprayAngleDeg + fairHalfWidth) / (2 * fairHalfWidth); // 0 left .. 1 right
  const wallFt = parkFt.left + (parkFt.center - parkFt.left) * Math.min(1, t * 2)
    - Math.max(0, t - 0.5) * 2 * (parkFt.center - parkFt.right);

  if (kind === 'fly' && distanceFt >= wallFt) {
    return { result: 'hit', bases: 4, kind: 'homer', distanceFt, isFoul: false };
  }

  // An error can turn any ball in play into a free base, checked before the ordinary out/hit
  // split so a misplayed routine grounder is possible at any fielding level.
  if (rand01() < errorChance) {
    return { result: 'error', bases: 1, kind: 'error', distanceFt, isFoul: false };
  }

  if (kind === 'ground') {
    // A hard-hit, well-placed grounder can still get through; softer/more central ones are outs.
    // Draft [Open item 24]: base rate tuned by playing out whole games rather than measured
    // against a reference (none exists) - see baseball/CLAUDE.md's report for the numbers this
    // produces (hit rate, walk rate, median game length per league).
    const throughChance = Math.max(0.12, Math.min(0.62,
      0.30 + (batted.exitVeloMph - 55) / 110 + Math.abs(batted.sprayAngleDeg) / 90 - defense01 * 0.2));
    if (rand01() < throughChance) {
      return { result: 'hit', bases: 1, kind: 'ground-single', distanceFt, isFoul: false };
    }
    return { result: 'out', bases: 0, kind: 'groundout', distanceFt, isFoul: false };
  }

  if (kind === 'popup') {
    return { result: 'out', bases: 0, kind: 'popout', distanceFt, isFoul: false };
  }

  // Line drives and non-homer flies: outcome scales with how far it carried past a routine catch
  // radius (roughly 280ft is "shallow", beyond ~360 is deep) and how well-defended that patch of
  // outfield/infield is.
  const routineFt = kind === 'line' ? 220 : 330;
  const past = Math.max(0, distanceFt - routineFt) / 100;
  // Draft [Open item 24] (same tuning pass as the grounder threshold above): a floor high enough
  // that a routine-depth line drive or fly ball is still a real coin flip rather than an automatic
  // out, which is closer to how those actually play than a near-zero floor is.
  const dropChance = Math.max(0.30, Math.min(0.85, 0.22 + past * 0.7 - defense01 * 0.15));
  if (rand01() >= dropChance) {
    return { result: 'out', bases: 0, kind: kind === 'line' ? 'lineout' : 'flyout', distanceFt, isFoul: false };
  }
  let bases = 1;
  if (distanceFt > 320) bases = 3;
  else if (distanceFt > 250) bases = 2;
  return { result: 'hit', bases, kind: `${kind}-hit`, distanceFt, isFoul: false };
}

export default { carryFt, resolveContact };
