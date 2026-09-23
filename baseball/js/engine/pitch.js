// pitch.js : one pitch, thrown. Pure function of its inputs (a pitcher's aim, their pitchAcc
// skill, the pitch type, the settings table, and four [0,1) draws) - never a live clock, never
// module-scope state. Two pitches given the same inputs are identical.
//
// R2 (docs/BASEBALL-3D-BUILD.md section 9): THE ZONE IS 2-D. Phase 1 modelled a 2-D box, BB-1a
// flattened it to one axis on the doc's own "height does not matter" lock, and the reference game
// (docs/BASEBALL-REFERENCE-B9.md) settles it the other way: you drag a cursor anywhere in or
// around the zone and the pitch goes there. So a pitch has `x` AND `y`, both in zone units - 1 is
// the zone's own half width (0.708 ft) or half height (0.9 ft) - and a strike is
// `|x| <= 1 && |y| <= 1`.
//
// R2 also DELETES the hold-and-release meter and in-flight steering that phase 3 (BB-3) added
// here: `hold`/Nice/hang, `steer`, `resolveSteer`, `clampSteerDx` and `steerDirectionSign` are
// gone with the meter and the steer pad. What replaces steering is `BREAK_OFFSET` (settings.js) -
// the break is a fact of the pitch TYPE and the pitcher's own hand, applied at the plate, and the
// UI shows where it will end (the yellow point cursor) before the ball leaves the hand.

import { PITCH_TRAVEL_MULT, SKILL_EFFECT, READOUT, BREAK_OFFSET } from './settings.js';

/** The strike zone, in the doc's own units (the zone IS the unit: |x| <= 1 and |y| <= 1 is a
 *  strike). `y` is R2's addition; +1 is the top of the zone. Exported as an object for call-site
 *  symmetry with the rest of the engine's "pass settings.ZONE" convention. */
export const ZONE = { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };

/** A pitcher's arm sign: +1 for a right-handed arm, -1 for a left-handed one. `BREAK_OFFSET`'s
 *  `handed` entries multiply their own `x` by it, which is doc §11's [Locked] rule ("curve and
 *  slider break away from the pitcher's throwing arm... never which way") - the direction is a
 *  fact of the type and the hand, and the player never chooses it. Exported so the UI's point
 *  cursor and this file's own scoring read the same fact from the same place. */
export function handSign(hand) {
  return hand === 'L' ? -1 : 1;
}

/** The break one pitch of `type` from a `hand`ed pitcher takes at the plate, in zone units.
 *  `drawX`/`drawY` are [0,1) draws, used only by the knuckleball (whose whole character is that
 *  nobody, the pitcher included, knows which way it goes). Pure; exported so `ui.js` can draw the
 *  point cursor from the SAME function that scores the pitch, never a second copy of the table.
 *
 *  R14 (docs/BASEBALL-3D-BUILD.md section 9): `pitchSpinPts` wires `SKILL_EFFECT.pitchSpin.
 *  breakPerPt` ("more bend on curve/slider/screwball; bigger changeup speed gap" - settings.js's
 *  own doc citation) into the HANDED break only: `1 + pitchSpinPts * breakPerPt` multiplies both
 *  axes of `row.x`/`row.y` when `row.handed` is true (curveball, slider, screwball, cutter - the
 *  BREAK_OFFSET table's own four `handed: true` rows, and no others). It never touches the
 *  fastball (zero break either way) or the knuckleball's `random` wobble (no `handed` flag, no
 *  fixed direction for more spin to exaggerate). Default 0 keeps every existing caller (a fixture,
 *  a CPU/model agent that does not pass skills) at today's table exactly. */
export function breakOffsetFor(type, hand, drawX = 0.5, drawY = 0.5, settings = null, pitchSpinPts = 0) {
  const table = (settings && settings.BREAK_OFFSET) || BREAK_OFFSET;
  const row = table[type] || table.fastball;
  const sign = row.handed ? handSign(hand) : 1;
  const rnd = row.random || 0;
  const skillEffect = (settings && settings.SKILL_EFFECT) || SKILL_EFFECT;
  const breakPerPt = (skillEffect.pitchSpin && skillEffect.pitchSpin.breakPerPt) || 0;
  const spinMult = row.handed ? 1 + Math.max(0, pitchSpinPts) * breakPerPt : 1;
  return {
    x: row.x * sign * spinMult + (rnd ? (drawX * 2 - 1) * rnd : 0),
    y: row.y * spinMult + (rnd ? (drawY * 2 - 1) * rnd : 0),
  };
}

/**
 * Throw one pitch.
 * @param {string} type - a PITCH_TYPES entry
 * @param {{x:number,y:number}|number} aim - where the pitcher is aiming, in zone units. R2 takes
 *   an `{x, y}` object; a plain NUMBER is still accepted and means x (y = 0), so a caller that
 *   only has a lateral aim - every CPU/model agent before R2, and any test fixture - keeps
 *   working and simply aims at the middle of the zone's height.
 * @param {number} pitchAccSkill01 - 0..1, higher = tighter around `aim` (resolved from the
 *   pitcher's pitchAcc skill points by the caller)
 * @param {object} settings - the settings module (or an object shaped like it)
 * @param {function} rand01 - () => next draw in [0,1); caller owns advancing/snapshotting state
 * @param {{pitchSpd?:number, pitchSpin?:number}} [pitcherSkills] - the pitcher's own raw skill
 *   points for §6's "Speed: pitch velocity" and "Spin: ...bigger speed gap on the changeup."
 * @param {{scatter?:object|number, pitcherHand?:string}} [pitchExtras]
 *   - `scatter`: PRE-ROLLED draws (see game.js's `previewsPitch` seam) - the SAME four this
 *   function would otherwise take from `rand01` itself, so a human pitcher's own UI can draw the
 *   pitch it is about to throw and be certain the engine scores exactly what the player watched.
 *   `{x, y, bx, by}`: the two aim-scatter draws and the knuckleball's two break draws. A plain
 *   number is read as the x draw alone (the BB-3b shape), the rest coming from `rand01`.
 *   `pitcherHand` ('L'/'R', default 'R') - which way a handed break goes (`breakOffsetFor`).
 * @param {string} [league] - R11 (docs/BASEBALL-3D-BUILD.md section 9): which READOUT row this
 *   pitch's travel time is measured against - see `timeToPlateS`'s own comment below. Defaults to
 *   'majors', the fastest league, so every existing caller that does not pass one (a CPU/model
 *   fixture with no league of its own) keeps its exact old fastball travel time unchanged.
 * @returns {{type, x, y, isStrike, timeToPlateS, straightX, straightY, path}} - `straightX`/
 *   `straightY` are where the pitch WOULD have crossed with no break at all: the batting-side
 *   target marker starts there at release and slides to `(x, y)` over the flight, which is what
 *   makes an off-speed pitch readable (docs/BASEBALL-REFERENCE-B9.md, batting step 3).
 */
export function flyPitch(type, aim, pitchAccSkill01, settings, rand01, pitcherSkills = {}, pitchExtras = null, league = 'majors') {
  const skillEffect = settings.SKILL_EFFECT || SKILL_EFFECT;
  let travelMult = (settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT)[type]
    ?? (settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT).fastball;
  // doc §6, [Locked]: "Spin: ...bigger speed gap on the changeup" - pitchSpin widens the
  // changeup's own travel-multiple gap from the fastball's baseline of 1.0, per
  // `SKILL_EFFECT.pitchSpin.changeupGapPerPt`.
  if (type === 'changeup') {
    const pitchSpinPts = Math.max(0, (pitcherSkills && pitcherSkills.pitchSpin) || 0);
    travelMult += pitchSpinPts * (skillEffect.pitchSpin.changeupGapPerPt || 0);
  }
  const skill = Math.max(0, Math.min(1, pitchAccSkill01));
  const aimX = typeof aim === 'number' ? aim : ((aim && aim.x) || 0);
  const aimY = typeof aim === 'number' ? 0 : ((aim && aim.y) || 0);

  const F = settings.FEEL.engine;

  // FEEL.engine.aimScatter is the doc's own "normal pitch miss from aim" (§14, [Tested]) - a
  // fraction of the zone's own half size. Higher pitchAcc tightens it; a perfectly-skilled arm
  // (skill=1) still keeps a third of it (a pitch is never a laser), same shape phase 1 used.
  // R2: the SAME model on both axes, per the spec - height is not a second, looser thing.
  const scatter = F.aimScatter * (1 - skill * 0.67);
  // FOUR DRAWS, ALWAYS, whatever the pitch type is: two for the aim scatter and two the
  // knuckleball's break reads (`breakOffsetFor`). Taking them unconditionally is deliberate - the
  // number of draws a pitch costs the seeded stream must not depend on which pitch it was, or a
  // replayed game would diverge the moment a different type came up.
  const pre = pitchExtras && pitchExtras.scatter;
  const preObj = pre && typeof pre === 'object' ? pre : null;
  const preNum = typeof pre === 'number' ? pre : null;
  const drawX = preObj && typeof preObj.x === 'number' ? preObj.x : (preNum != null ? preNum : rand01());
  const drawY = preObj && typeof preObj.y === 'number' ? preObj.y : rand01();
  const drawBX = preObj && typeof preObj.bx === 'number' ? preObj.bx : rand01();
  const drawBY = preObj && typeof preObj.by === 'number' ? preObj.by : rand01();

  // THE BREAK (R2): a fact of the type and the pitcher's own hand, applied at the plate.
  // R14: the pitcher's own pitchSpin points widen it (breakOffsetFor's own spinMult, handed
  // types only).
  const hand = (pitchExtras && pitchExtras.pitcherHand) || 'R';
  const pitchSpinPtsForBreak = Math.max(0, (pitcherSkills && pitcherSkills.pitchSpin) || 0);
  const brk = breakOffsetFor(type, hand, drawBX, drawBY, settings, pitchSpinPtsForBreak);

  // R16 (docs/BASEBALL-3D-BUILD.md section 9): THE PITCH IS AIMED AT `aim - break`, SO THE BREAK
  // LANDS ON THE AIM. Until R16 the break was added ON TOP of the aim and the strike was judged on
  // where the ball finished, so a pitcher who bought Spin points did not get a nastier strike - he
  // got a BALL, every time, further outside the more he had paid for (measured: +5 points of
  // pitchSpin cost -4.1 pp of win rate, the worst of the six skills). Aiming at the target minus
  // the break is also what the reference game's own end-point cursor already implies: the yellow
  // point you drag is where the pitch ENDS, not where it starts.
  //
  // Nothing else in the meaning changes. `x`/`y` are still the real crossing and the strike is
  // still judged on them; `straightX`/`straightY` are still where the pitch APPEARS to be headed
  // at release (now aim minus break, plus the same scatter), which is exactly what the batting-side
  // target marker needs to slide FROM so that where it ends up is the truth.
  // R19: A MISSED SPOT CATCHES MORE PLATE. Symmetric scatter alone could not make Accuracy a
  // skill: a miss is as likely to land further out (onto the edge, which R19's EDGE_CONTACT makes
  // harder to hit) as further in, so 0 and 26 points measured the same runs allowed. Below full
  // Accuracy the aim itself is drawn toward the middle of the plate by `AIM_PULL x (1 - skill)`, so
  // a pitcher without control cannot live on the corners. No new random draw (the four above are
  // the pitch's whole budget).
  const pull = Math.max(0, Math.min(1, (F.aimPull || 0) * (1 - skill)));
  const aimXe = aimX * (1 - pull);
  const aimYe = aimY * (1 - pull);
  const straightX = (aimXe - brk.x) + (drawX * 2 - 1) * scatter;
  const straightY = (aimYe - brk.y) + (drawY * 2 - 1) * scatter;
  const x = straightX + brk.x;
  const y = straightY + brk.y;

  const zone = settings.ZONE || ZONE;

  // R11 (docs/BASEBALL-3D-BUILD.md section 9): A SLOW PITCH IS SLOW. Until this stage
  // `timeToPlateS` scaled ONLY by the pitcher's own skill points off a flat Majors-fastball
  // baseline (95 mph, on both sides of the ratio, for every type at every league) - so a Little
  // League 55 mph readout flew to the plate in the same 650 ms as a Majors 95 mph one.
  // `readoutMph` is this league's own READOUT row for the type actually being thrown; three types
  // (screwball, eephus, cutter) have no readout row of their own (doc §11, Open item 9 - "movement
  // and speed" left open), so they fall back to this SAME league's own fastball row - the league
  // still slows them down, they just do not get a second, invented per-type mph.
  const pitchSpdPts = Math.max(0, (pitcherSkills && pitcherSkills.pitchSpd) || 0);
  const readoutTable = settings.READOUT || READOUT;
  const referenceMph = readoutTable.majors.fastball; // the one fixed anchor, unchanged by league or type
  const readoutRow = readoutTable[league] || readoutTable.majors;
  // Ship review (R11): the LEAGUE's fastball readout is the denominator for every type. The type's
  // own slowness is already `travelMult` (PITCH_TRAVEL_MULT, the doc's own table); dividing by the
  // type's readout as well counted it twice and moved a Majors changeup from 910 to 1006 ms. With
  // the league fastball alone, every Majors pitch keeps the travel time it had before R11, and a
  // lower league scales all of its pitches by one factor (Little League: 95 / 55 = 1.73).
  const readoutMph = readoutRow.fastball;
  const extraMph = pitchSpdPts * (skillEffect.pitchSpd.throwMphPerPt || 0);
  const speedFromSkillMul = referenceMph / (readoutMph + extraMph);
  const timeToPlateS = (F.fastballMs / 1000) * travelMult * speedFromSkillMul;

  const isStrike = x >= zone.xMin && x <= zone.xMax && y >= (zone.yMin != null ? zone.yMin : -1) && y <= (zone.yMax != null ? zone.yMax : 1);

  // The per-step sample path the UI draws the truth from, rather than interpolating its own
  // curve - the straight-line spot at t=0 sliding to the pitch's own final (x, y) at t=1, sampled
  // at the engine's own fixed timestep. The SHAPE of the bend between them (a curveball bends
  // early, a slider late) is a rendering concern layered on top by the UI; this is the ground
  // truth of where it starts and where it ends.
  const dtS = F.dtS;
  const totalSteps = Math.max(1, Math.round(timeToPlateS / dtS));
  const path = [];
  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    path.push({ t, x: straightX + (x - straightX) * t, y: straightY + (y - straightY) * t });
  }

  return { type, x, y, isStrike, timeToPlateS, straightX, straightY, path };
}

export default { ZONE, flyPitch, breakOffsetFor, handSign };
