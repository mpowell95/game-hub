// outcomes.js : turn a batted ball (exit velocity, launch angle, spray angle) into a result - out
// or a hit of 1-4 bases - using OUT-ZONE GEOMETRY (`zones.js`, doc §10) rather than phase 1's
// invented `fieldingSkill01` ramp. The real design has no "error" outcome at all (doc §10's list
// is singles/doubles/triples/homers/outs) - phase 1's `error` result is gone.

import { FOUL_LINE_DEG, CARRY_SCALE, LINE_THROUGH_Q, LINE_THROUGH_MAX_FT, BLOOP_BAND_FT,
  DOUBLE_DEPTH_FRAC, TRIPLE_DEPTH_FRAC, CARRY_ZERO_MPH, GROUND_CARRY_FACTOR, MIN_IN_PLAY_FT,
  CARRY_PEAK_DEG } from './settings.js';
import { angleSector } from './zones.js';

/** Rough carry distance in feet from exit velocity (mph) and launch angle (deg). A simplified,
 *  monotonic model (more speed and a mid-range angle carry further); not aerodynamically real,
 *  and not meant to be - there is no reference to calibrate against, so this stays a plain,
 *  reproducible function of its two inputs rather than a "realistic" model with invented drag
 *  coefficients. Draft [Open item 23]: the exact carry curve; CARRY_SCALE lives in settings.js.
 *
 *  R5 rule 3: NO BALL IN PLAY EVER CARRIES 0 FT, and both halves of that are here.
 *   - `GROUND_CARRY_FACTOR` floors the angle factor. The old `sin(2a)` was ~0 at 0 to 3 deg, so a
 *     topped ball stopped dead at the plate; a topped ball in fact ROLLS, and what this engine
 *     calls its distance is where a fielder meets it. The floor binds below 4.8 deg and above
 *     55.2 deg, which are `battedBallKind`'s grounder and pop-up bands, and nothing between.
 *   - `MIN_IN_PLAY_FT` is the flat floor under the result, whatever the angle.
 *
 *  `settings` (optional) lets a sweep measure a candidate CARRY_SCALE/floor without editing
 *  settings.js - `sim-baseball.mjs --set` passes a settings OBJECT, and this module's own imports
 *  are module-scope constants that such an override could never reach. `resolveContact` passes its
 *  own settings through, so the engine and a sweep read the same numbers by construction. */
export function carryFt(exitVeloMph, launchAngleDeg, settings) {
  const scale = (settings && settings.CARRY_SCALE != null) ? settings.CARRY_SCALE : CARRY_SCALE;
  const zeroMph = (settings && settings.CARRY_ZERO_MPH != null) ? settings.CARRY_ZERO_MPH : CARRY_ZERO_MPH;
  const groundFactor = (settings && settings.GROUND_CARRY_FACTOR != null) ? settings.GROUND_CARRY_FACTOR : GROUND_CARRY_FACTOR;
  const minFt = (settings && settings.MIN_IN_PLAY_FT != null) ? settings.MIN_IN_PLAY_FT : MIN_IN_PLAY_FT;
  const peakDeg = (settings && settings.CARRY_PEAK_DEG != null) ? settings.CARRY_PEAK_DEG : CARRY_PEAK_DEG;
  const clampedAngle = Math.max(0, Math.min(70, launchAngleDeg));
  // A half-sine that peaks at `CARRY_PEAK_DEG` and is back to zero at twice it. The old form was
  // `sin(2a)`, the vacuum parabola's own range curve, which peaks at 45 deg - see CARRY_PEAK_DEG
  // in settings.js for why a real batted ball peaks nearer 30 and why the difference mattered here.
  const angleFactor = Math.max(groundFactor, Math.sin((Math.PI * clampedAngle) / (2 * peakDeg)));
  const speedFactor = Math.max(0, exitVeloMph - zeroMph);
  return Math.max(minFt, speedFactor * angleFactor * scale);
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
  const distanceFt = carryFt(batted.exitVeloMph, batted.launchAngleDeg, settings);

  if (kind === 'popup') {
    // doc §10, [Locked]: "Pop-ups in the infield are outs."
    return { result: 'out', bases: 0, kind: 'popout', distanceFt, isFoul: false };
  }

  if (kind === 'ground') {
    const sector = angleSector(batted.sprayAngleDeg, zones.infield);
    if (!sector) {
      // BB-2b commit 3: an angle sitting in the GAP_DEG dead zone between two infield sectors has
      // no fielder positioned there at all - doc §10, [Locked]: "Singles go through gaps."
      return { result: 'hit', bases: 1, kind: 'ground-gap', distanceFt, isFoul: false };
    }
    if (distanceFt <= sector.toFt) {
      // A close play at the edge of the sector's reach: doc §6, [Locked], "Batter Speed affects
      // beating out grounders" - MECHANICS.beatOutPerPt/groundEdgeMarginFt name the roll.
      const nearEdge = distanceFt > sector.toFt - settings.MECHANICS.groundEdgeMarginFt;
      if (nearEdge) {
        const beatOutChance = Math.min(settings.MECHANICS.beatOutMax != null ? settings.MECHANICS.beatOutMax : 0.5, Math.max(0, hitSpd || 0) * settings.MECHANICS.beatOutPerPt);
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
  //
  // R5: a LINE DRIVE consults the fence too. This check used to read `kind === 'fly'` only, which
  // was invisible while `carryFt` returned 0 ft for almost everything; at R5's real distances the
  // line-drive band (`battedBallKind`, 8 to 26 deg) is where a squared-up swing actually lives, and
  // the hardest ball in the game - a 470 ft liner off a cap-power q=1 swing - was being scored a
  // TRIPLE because the fence was never asked. A ball that lands past the wall is over the wall,
  // whatever angle it left at. A grounder or a pop-up still never reaches this branch.
  const wallFt = fenceFtAt(batted.sprayAngleDeg, fenceFt);
  if ((kind === 'fly' || kind === 'line') && distanceFt >= wallFt) {
    return { result: 'hit', bases: 4, kind: 'homer', distanceFt, isFoul: false };
  }

  const sector = angleSector(batted.sprayAngleDeg, zones.outfield);
  // BB-2b commit 3: a ball hit through an outfield GAP_DEG dead zone has no fielder positioned at
  // that angle at all, at any depth - doc §10, [Locked]: "Doubles in the gaps." Falls straight
  // through to the depth-based bases logic below, same as a ball that carried past a MANNED
  // sector's own reach.
  if (sector) {
    if (distanceFt < sector.fromFt) {
      // Short of the outfield sector's own near edge - doc §10, [Locked]: "Singles go through
      // gaps AND AS BLOOPERS." Within BLOOP_BAND_FT of that near edge, nobody quite reaches it: a
      // modest bloop single. Shorter than that, it is close enough in that the ordinary out-zone
      // read applies (an infielder/generic short fielder has it). Phase 2/2a never checked a
      // sector's near edge at all, so every ball in this band was scored a flat out regardless of
      // how shallow the nearest outfielder actually stood.
      if (distanceFt >= sector.fromFt - BLOOP_BAND_FT) {
        return { result: 'hit', bases: 1, kind: 'blooper', distanceFt, isFoul: false };
      }
      return { result: 'out', bases: 0, kind: kind === 'line' ? 'lineout' : 'flyout', distanceFt, isFoul: false };
    }
    if (distanceFt <= sector.toFt) {
      // BB-2a step 3, [Draft]: a well-squared-up LINE DRIVE (contact quality `q` at or above
      // LINE_THROUGH_Q) still goes through for a hit up to LINE_THROUGH_MAX_FT - a "routine fly
      // into a sector" (the ordinary case below) stays an out, but a scorched line drive is not a
      // fly ball a fielder settles under; it is through the infielder's reach before an
      // outfielder can close.
      const lineQ = settings.LINE_THROUGH_Q != null ? settings.LINE_THROUGH_Q : LINE_THROUGH_Q;
      const lineMaxFt = settings.LINE_THROUGH_MAX_FT != null ? settings.LINE_THROUGH_MAX_FT : LINE_THROUGH_MAX_FT;
      if (kind === 'line' && (batted.q || 0) >= lineQ && distanceFt <= lineMaxFt) {
        return { result: 'hit', bases: 1, kind: 'line-through', distanceFt, isFoul: false };
      }
      return { result: 'out', bases: 0, kind: kind === 'line' ? 'lineout' : 'flyout', distanceFt, isFoul: false };
    }
  }
  // Through the outfield sector (or its gap): a single through a gap, or a double/triple the
  // deeper it carried (doc §10, [Locked]: "Doubles in the gaps and down the lines. Triples in deep
  // corners and deep center"). BB-2d commit 4: the cutoffs are now fractions of the FENCE AT THIS
  // SPRAY ANGLE (`wallFt`, already computed above) instead of two flat feet numbers - a flat 250/
  // 320 meant nothing once the fence itself varies by league and by spray angle; the fractions
  // reproduce the old cutoffs exactly at College's 400ft center fence (250/400=0.625, 320/400=0.80).
  // R19: A FAST BATTER STRETCHES THE HIT. Speed pulls both depth cutoffs in, so the same ball in a
  // gap is a double for a fast runner and a single for a slow one (doc §6: "beat out grounders,
  // stretch hits"). Before R19 the batter's own Speed decided nothing here, and the skill measured
  // +0.3 pp of win rate for 6 points.
  const stretchPerPt = (settings.SKILL_EFFECT && settings.SKILL_EFFECT.hitSpd && settings.SKILL_EFFECT.hitSpd.stretchDepthPerPt) || 0;
  const stretch = 1 - Math.min(0.5, Math.max(0, hitSpd || 0) * stretchPerPt);
  let bases = 1;
  if (distanceFt > wallFt * TRIPLE_DEPTH_FRAC * stretch) bases = 3;
  else if (distanceFt > wallFt * DOUBLE_DEPTH_FRAC * stretch) bases = 2;
  return { result: 'hit', bases, kind: `${kind}-hit`, distanceFt, isFoul: false };
}

/** RA (docs/BASEBALL-3D-BUILD.md section 9): A BUNT'S OWN OUTCOME. `resolveContact` above cannot
 *  answer this one - its whole model is out-zone geometry against a ball that CARRIED, and a bunt
 *  that dies 20 ft in front of the plate is not in anybody's sector at any depth. So the bunt gets
 *  its own three-line rule book, exactly as the spec writes it:
 *
 *    - Runners on and fewer than 2 outs: it is a SACRIFICE. Every runner moves up one (bases.js's
 *      `advanceSacBunt`, applied by game.js) and the batter is out - UNLESS he beats the throw,
 *      in which case it is a `bunt-single` and the runners still move up one, because a single
 *      advances everybody by one anyway.
 *    - Nobody on: a bunt for a hit. The same beat-out roll, and nothing else.
 *    - With runners on and 2 outs it falls through to the second case: a sacrifice with two outs
 *      trades the inning for a base, which is not a play anyone makes, so the batter is simply
 *      bunting for a hit with runners aboard.
 *
 *  THE BEAT-OUT ROLL IS THE ONE THAT ALREADY EXISTS - `MECHANICS.beatOutPerPt` x the batter's
 *  hitSpd, capped at 0.5, the identical line an infield grounder at the edge of a sector already
 *  runs (see `resolveContact`'s `nearEdge` branch). Doc §6, [Locked]: "Batter Speed raises steal
 *  and bunt success", and a second, differently-calibrated speed roll for the same question would
 *  be two answers to it.
 *
 *  Returns the same shape `resolveContact` does (plus the bunt's own `distanceFt`/`sprayAngleDeg`,
 *  which came off `swing.js` rather than out of `carryFt`), so `game.js`'s `_resolveBattedBall`
 *  reads it with no special case beyond the one kind name it has to recognise.
 *
 *  @param {{distanceFt:number, sprayAngleDeg:number}} batted - `swing.js`'s bunt result
 *  @param {Array} bases - `[first, second, third]`, ids or null
 *  @param {number} outs - outs BEFORE this play
 *  @param {number} hitSpd - the batter's hitSpd skill points
 */
export function resolveBunt(batted, bases, outs, hitSpd, settings, rand01) {
  const distanceFt = batted.distanceFt || 0;
  const sprayAngleDeg = batted.sprayAngleDeg || 0;
  const beatOutChance = Math.min(settings.MECHANICS.beatOutMax != null ? settings.MECHANICS.beatOutMax : 0.5, Math.max(0, hitSpd || 0) * settings.MECHANICS.beatOutPerPt);
  const beatOut = rand01() < beatOutChance;
  const runnersOn = bases.some((b) => b != null);
  const canSacrifice = runnersOn && outs < settings.MECHANICS.outsPerInning - 1;
  if (beatOut) {
    return { result: 'hit', bases: 1, kind: 'bunt-single', distanceFt, sprayAngleDeg, isFoul: false };
  }
  if (canSacrifice) {
    return { result: 'out', bases: 0, kind: 'sacrifice', distanceFt, sprayAngleDeg, isFoul: false };
  }
  return { result: 'out', bases: 0, kind: 'bunt-out', distanceFt, sprayAngleDeg, isFoul: false };
}

export default { carryFt, fenceFtAt, resolveContact, resolveBunt };
