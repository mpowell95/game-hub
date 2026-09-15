// pitch.js : one pitch, thrown. Pure function of its inputs (a pitcher's aim, their pitchAcc
// skill, the pitch type, the settings table, and a single [0,1) draw) - never a live clock,
// never module-scope state. Two pitches given the same inputs are identical.
//
// ONE FLAT PLANE (doc §1, [Locked]): "pitches vary left/right and speed. Height does not
// matter." So a pitch has exactly ONE spatial coordinate, `x` - a fraction of the plate's half
// width (doc §15's units note: "Lateral positions... are fractions of the plate's half width").
// `x` in [-1, 1] is inside the strike zone; anything further out is a ball. Phase 1 modeled a 2-D
// box with a height axis that the real design does not have at all - BB-1a corrects that.
//
// Phase 3 (BB-3): hold-and-release and steering, the two UI input mechanics FEEL.engine already
// carried constants for (meterTime/niceWidth/niceBoost/niceBreak) with nothing reading them until
// now. Both are read from an optional `pitchExtras` argument so every existing caller (which omits
// it) gets byte-identical output to before this phase.

import { PITCH_TRAVEL_MULT, SKILL_EFFECT, READOUT, HANG_GRACE_FRAC, HANG_SPEED_MULT,
  HANG_BREAK_MULT, HANG_CENTER_PULL, STEERABLE_PITCHES, STEER_MAX_OFFSET } from './settings.js';

/** The strike zone's lateral half-width, in the doc's own units (a fraction of the plate's half
 *  width, so the zone IS the unit: |x| <= 1 is a strike). Exported as an object for call-site
 *  symmetry with the rest of the engine's "pass settings.ZONE" convention. */
export const ZONE = { xMin: -1, xMax: 1 };

/** Resolve a `steer` array (`{step, dx}[]`, dx in the break direction, earlier steps weighted
 *  more) into one net offset, a fraction of the plate half-width. `stepFilter(step)` drops any
 *  sample the pitch type doesn't honor yet (e.g. a slider's own first-half steer). Pure. */
export function resolveSteer(steerArr, stepFilter) {
  if (!steerArr || !steerArr.length) return 0;
  let wSum = 0, dSum = 0;
  for (const s of steerArr) {
    if (!s || typeof s.dx !== 'number') continue;
    if (stepFilter && !stepFilter(s.step)) continue;
    const w = 1 / (1 + Math.max(0, s.step || 0)); // earlier steps (small step index) count more
    dSum += s.dx * w;
    wSum += w;
  }
  return wSum > 0 ? dSum / wSum : 0;
}

/**
 * Throw one pitch.
 * @param {string} type - a PITCH_TYPES entry
 * @param {number} aimX - where the pitcher is aiming, as a fraction of the plate half-width
 * @param {number} pitchAccSkill01 - 0..1, higher = tighter around `aimX` (resolved from the
 *   pitcher's pitchAcc skill points by the caller)
 * @param {object} settings - the settings module (or an object shaped like it)
 * @param {function} rand01 - () => next draw in [0,1); caller owns advancing/snapshotting state
 * @param {{pitchSpd?:number, pitchSpin?:number}} [pitcherSkills] - the pitcher's own raw skill
 *   points for §6's "Speed: pitch velocity" and "Spin: ...bigger speed gap on the changeup."
 * @param {{hold?:number|null, steer?:Array<{step:number,dx:number}>, scatter?:number}} [pitchExtras]
 *   - BB-3: a human pitcher's hold time in ms (null/omitted = a tap, i.e. a normal pitch) and any
 *   in-flight steer samples for a steerable type. BB-3b commit 4: `scatter`, a pre-rolled [0,1)
 *   draw (the SAME draw this function would otherwise make itself via `rand01()`) - lets a human
 *   pitcher's own UI preview the pitch's aim-scatter component before this function ever runs (see
 *   game.js's `previewsPitch` seam), so what the player watched during the throw is exactly what
 *   gets scored, not a second independent draw. Omit entirely for byte-identical prior behavior -
 *   every field here is optional and additive.
 * @returns {{type, x, isStrike, timeToPlateS, path, wasNice, wasHang}}
 */
export function flyPitch(type, aimX, pitchAccSkill01, settings, rand01, pitcherSkills = {}, pitchExtras = null) {
  const skillEffect = settings.SKILL_EFFECT || SKILL_EFFECT;
  let travelMult = (settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT)[type]
    ?? (settings.PITCH_TRAVEL_MULT || PITCH_TRAVEL_MULT).fastball;
  // doc §6, [Locked]: "Spin: ...bigger speed gap on the changeup" - pitchSpin widens the
  // changeup's own travel-multiple gap from the fastball's baseline of 1.0, per
  // `SKILL_EFFECT.pitchSpin.changeupGapPerPt` (named since BB-1a, never read until this phase).
  if (type === 'changeup') {
    const pitchSpinPts = Math.max(0, (pitcherSkills && pitcherSkills.pitchSpin) || 0);
    travelMult += pitchSpinPts * (skillEffect.pitchSpin.changeupGapPerPt || 0);
  }
  const skill = Math.max(0, Math.min(1, pitchAccSkill01));

  // ---- BB-3: hold-and-release ------------------------------------------------------------
  const F = settings.FEEL.engine;
  const meterTimeMs = F.meterTime;
  const hangGraceFrac = settings.HANG_GRACE_FRAC != null ? settings.HANG_GRACE_FRAC : HANG_GRACE_FRAC;
  const niceStartMs = meterTimeMs * (1 - F.niceWidth);
  const hangThresholdMs = meterTimeMs * (1 + hangGraceFrac);
  const hold = pitchExtras && typeof pitchExtras.hold === 'number' ? pitchExtras.hold : null;
  let wasNice = false, wasHang = false, speedMul = 1, breakMul = 1;
  if (hold != null) {
    if (hold >= niceStartMs && hold <= meterTimeMs) {
      wasNice = true;
      speedMul = 1 / F.niceBoost; // faster: less travel time
      breakMul = F.niceBreak;
    } else if (hold > hangThresholdMs) {
      wasHang = true;
      speedMul = (settings.HANG_SPEED_MULT != null ? settings.HANG_SPEED_MULT : HANG_SPEED_MULT);
      breakMul = (settings.HANG_BREAK_MULT != null ? settings.HANG_BREAK_MULT : HANG_BREAK_MULT);
    }
  }

  // FEEL.engine.aimScatter is the doc's own "normal pitch miss from aim" (§14, [Tested]) - a
  // fraction of the plate half-width. Higher pitchAcc tightens it; a perfectly-skilled arm
  // (skill=1) still keeps a third of it (a pitch is never a laser), same shape phase 1 used.
  // A Nice release lands EXACTLY on aim (no scatter); a normal or hung release keeps it.
  const scatter = wasNice ? 0 : F.aimScatter * (1 - skill * 0.67);
  // BB-3b commit 4: a pre-rolled scatter draw (see the header above) stands in for this
  // function's own rand01() call when present, so a human pitcher's UI-side preview and this
  // function's own scoring draw from the identical random value.
  const scatterDraw = pitchExtras && typeof pitchExtras.scatter === 'number' ? pitchExtras.scatter : rand01();
  let x = aimX + (scatterDraw * 2 - 1) * scatter;

  // ---- BB-3: steering (curveball/slider only, doc §11 [Locked] on WHICH way; how much/when is
  // the human's own input) --------------------------------------------------------------------
  const steerable = (settings.STEERABLE_PITCHES || STEERABLE_PITCHES)[type];
  if (steerable && pitchExtras && pitchExtras.steer && pitchExtras.steer.length) {
    // `steerFromFrac` needs the pitch's own total step count, which needs timeToPlateS - resolved
    // just below using the un-steered travelMult (steering never changes travel time, only break).
  }

  const zone = settings.ZONE || ZONE;

  const pitchSpdPts = Math.max(0, (pitcherSkills && pitcherSkills.pitchSpd) || 0);
  const baselineMph = (settings.READOUT || READOUT).majors.fastball;
  const extraMph = pitchSpdPts * (skillEffect.pitchSpd.throwMphPerPt || 0);
  const speedFromSkillMul = baselineMph / (baselineMph + extraMph);
  const timeToPlateS = (F.fastballMs / 1000) * travelMult * speedFromSkillMul * speedMul;

  const dtS = F.dtS;
  const totalSteps = Math.max(1, Math.round(timeToPlateS / dtS));
  if (steerable && pitchExtras && pitchExtras.steer && pitchExtras.steer.length) {
    const fromStep = Math.floor((steerable.steerFromFrac || 0) * totalSteps);
    const steerMaxOffset = settings.STEER_MAX_OFFSET != null ? settings.STEER_MAX_OFFSET : STEER_MAX_OFFSET;
    const netSteer = resolveSteer(pitchExtras.steer, (step) => step >= fromStep);
    x += netSteer * steerMaxOffset * breakMul;
  }

  // A hung pitch drifts toward the center of the zone rather than carrying to the pitcher's aim.
  if (wasHang) {
    const centerPull = settings.HANG_CENTER_PULL != null ? settings.HANG_CENTER_PULL : HANG_CENTER_PULL;
    x = x * (1 - centerPull);
  }

  const isStrike = x >= zone.xMin && x <= zone.xMax;

  // The per-step sample path the UI draws the truth from, rather than interpolating its own
  // curve - a straight line from mound to the pitch's own final x, sampled at the engine's own
  // fixed timestep. Real pitch curvature (the visual bend of a breaking ball) is a rendering
  // concern layered on top by the UI; this is the ground truth of where it starts and ends.
  const path = [];
  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    path.push({ t, x: t * x });
  }

  return { type, x, isStrike, timeToPlateS, path, wasNice, wasHang };
}

export default { ZONE, flyPitch, resolveSteer };
