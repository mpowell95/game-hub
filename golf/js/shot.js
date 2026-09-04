// golf/js/shot.js - what a struck ball does. PURE and DOM-free, so golf/js/test.js can measure it.
//
// Two quite different motions live here and they are deliberately not one function:
//
//   resolveShot()   a ball through the AIR - a parabola with a curve, then roll, then rest.
//   simulatePutt()  a ball on the DECK - decelerating, bending to the green's slope, holed or not.
//
// The reference measured the game for FEEL, not for coefficients, so almost everything below is
// ours (golf-reference-spec.md §20). The two numbers that are not are marked.

import { CLUBS, lieOf, rollFactor } from './clubs.js';
import { surfaceAt, slopeAt, treesOf, distYd } from './holes.js';

const DEG = Math.PI / 180;

/** Deceleration of a struck ball ROLLING OUT after it lands, yd/s^2.
 *
 *  MEASURED FROM THE REFERENCE (2026-09-04). The drive on `Pixel golf - hole 1.mp4` was sampled at
 *  30 fps across its whole life: the camera tracks the flight from 22.3 s to 25.0 s, and then keeps
 *  tracking a ball that is STILL MOVING until 28.4 s - the frame-to-frame motion decays in stages
 *  (4.5 -> 1.9 -> 0.66 -> 0) rather than stopping. So the ball spends 3.4 s on the ground against
 *  2.7 s in the air: HALF the shot is the bounce and roll.
 *
 *  Ours stopped dead the instant it landed, which is what Matt reported: "The ball doesn't bounce
 *  or roll out at all. The instant it first lands, it stops." 4.3 yd/s^2 puts a driver's 17 yd
 *  rollout at 2.8 s, which lands in the reference's range. */
export const ROLL_DECEL = 4.3;

/** How long a rollout of `rollYd` takes, in ms. Constant deceleration: t = sqrt(2d/a). */
export function rollMs(rollYd) {
  return rollYd > 0 ? Math.sqrt((2 * rollYd) / ROLL_DECEL) * 1000 : 0;
}

/** Where the ball is, `p` (0..1) through its ROLLOUT: how far along, and how high it is hopping.
 *
 *  Distance eases out (it is decelerating), and the first part of the rollout carries two or three
 *  visible BOUNCES whose height decays - the reference's ball clearly hops before it settles into a
 *  roll. The hop is small: this is a top-down view and the only height cue is the shadow gap. */
export function groundPoint(p, rollYd, apex) {
  const eased = 1 - (1 - p) * (1 - p);            // constant deceleration
  const HOPS = 3;
  const hopZone = 0.45;                            // bouncing is over by 45 % of the rollout
  let height = 0;
  if (p < hopZone) {
    const q = p / hopZone;                         // 0..1 across the bouncing part
    const decay = (1 - q) * (1 - q);
    height = Math.abs(Math.sin(q * Math.PI * HOPS)) * apex * 0.10 * decay;
  }
  return { along: rollYd * eased, height };
}

/** Flight time, DECIDED: 0.9 s + distance/60. A 215 yd drive is ~4.5 s, a 50 yd wedge ~1.7 s. The
 *  reference's own 7.5 s drive is too slow for a phone game, and its lack of a skip was the single
 *  worst thing about watching it (§13 flaw 7). A tap skips to the landing. */
export function flightMs(distanceYd) { return (0.9 + distanceYd / 60) * 1000; }

/** Peak height in yards, for the shadow gap.
 *
 *  The whole height model is the distance between the ball pixel and its shadow pixel - no arc
 *  line, no trail, no height bar - so this only has to be plausible and to make LOFT LEGIBLE.
 *
 *  Height-to-distance is deliberately NOT linear in loft. A first draft used
 *  `distance * (0.06 + loft * 0.20)`, which reads fine until you try to hit a wedge over a tree:
 *  because a wedge's distance is short, its apex came out short too, and the one club that should
 *  climb steeply could not clear a canopy a driver could not get under either - which collapses
 *  the punch-low-or-loft-over choice into no choice at all. The square makes the ratio itself rise
 *  with loft, so a lob wedge goes up almost as far as it goes out.
 *
 *  Sighting shots, against real golf: driver 215 yds peaks ~27 (real ~30), 6 iron 139 peaks ~32
 *  (real ~28), lob wedge 50 peaks ~20 (real ~20). */
export function apexYd(club, distanceYd) {
  return Math.max(2, distanceYd * (0.10 + 0.30 * club.loft * club.loft));
}

/** Where the ball is `p` (0..1) through its flight, in the shot's own frame: `along` yards down
 *  the launch line, `side` yards across it, `height` yards up.
 *
 *  The ball CURVES toward its miss over the flight rather than launching on a straight offset
 *  line - it reads far better and is how the genre does it (§17.9), so the lateral term is
 *  quadratic in p while the along term is linear. */
export function flightPoint(p, distanceYd, sideYd, apex) {
  return {
    along: distanceYd * p,
    side: sideYd * p * p,
    height: apex * 4 * p * (1 - p),
  };
}

/** Does a tree stop this shot? Returns the tree that blocks it, or null.
 *
 *  A TRUNK blocks at any height; a CANOPY blocks only a ball travelling below the canopy's own
 *  height. That pair is the entire punch-low-or-loft-over decision and needs no extra UI: take a
 *  long iron for the distance and risk the trunk, or loft a wedge over the top and give up most of
 *  the yardage.
 *
 *  Sampled along the flight rather than solved analytically: the path curves, and a sampled walk
 *  is both simpler to read and impossible to get subtly wrong for one particular geometry. The
 *  step is well under the narrowest trunk, which is how a fast ball is stopped from tunnelling
 *  straight through one (docs/BUILDING-A-GAME.md, Part 3). */
export function treeHit(hole, from, dirRad, distanceYd, sideYd, apex) {
  const trees = treesOf(hole);
  if (!trees.length) return null;
  const cos = Math.cos(dirRad);
  const sin = Math.sin(dirRad);
  const STEP = 0.4;                                  // yards; the narrowest trunk is 0.6 across
  const steps = Math.max(2, Math.ceil(distanceYd / STEP));
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const f = flightPoint(p, distanceYd, sideYd, apex);
    const x = from[0] + sin * f.along + cos * f.side;
    const y = from[1] + cos * f.along - sin * f.side;
    for (const t of trees) {
      const type = hole.treeTypes[t.type];
      const d = Math.hypot(x - t.x, y - t.y);
      if (d > type.canopy) continue;
      if (d <= type.trunk) return { tree: t, type, at: [x, y], p };
      if (f.height < type.height) return { tree: t, type, at: [x, y], p };
    }
  }
  return null;
}

/**
 * Resolve one full-swing shot.
 *
 * `aimRad` is the launch bearing, 0 = straight up the hole (+y), positive turning right.
 * `power` is the ring reading, 0..1.10 - it is NOT clamped to 1: over-100 % is a real band worth
 * up to +10 % distance, and the mishit angle handed in has already been multiplied by 1.5 for it.
 *
 * `lieFactor` SCALES the distance; it does not clamp the meter. The aim dots scale by the same
 * factor, so they keep telling the truth about where a perfect strike lands.
 */
export function resolveShot({ hole, from, aimRad, club, power, mishitDeg, distanceMul = 1 }) {
  const lieKind = surfaceAt(hole, from[0], from[1]);
  const lie = lieOf(lieKind);
  const carry = club.carry * power * lie.power * distanceMul;
  const apex = apexYd(club, carry);
  // The miss is expressed as a lateral offset at the landing point, so the curve above and the
  // straight-line geometry agree on where the ball ends up.
  const sideYd = Math.tan(mishitDeg * DEG) * carry;

  const blocked = treeHit(hole, from, aimRad, carry, sideYd, apex);
  const cos = Math.cos(aimRad);
  const sin = Math.sin(aimRad);

  // A blocked ball drops where it met the tree, killed - the trunk IS the penalty (§21.2).
  const p = blocked ? blocked.p : 1;
  const f = flightPoint(p, carry, sideYd, apex);
  const landing = [from[0] + sin * f.along + cos * f.side, from[1] + cos * f.along - sin * f.side];

  const landedOn = surfaceAt(hole, landing[0], landing[1]);
  const rollYd = blocked ? 0 : carry * rollFactor(landedOn);

  // A ball pitching straight into the cup is in, whatever club sent it.
  const holedOnTheFly = !blocked && cupCheck(hole, landing[0], landing[1], 0);
  const rolled = holedOnTheFly
    ? { rest: [...landing], holed: true }
    : rollWatchingCup(hole, landing, aimRad, rollYd);
  const rest = rolled.rest;
  const restOn = surfaceAt(hole, rest[0], rest[1]);

  return {
    carry, apex, sideYd, aimRad, blocked,
    landing, landedOn, rollYd, rest, restOn,
    holed: rolled.holed,
    travelledYd: distYd(from, rest),
    flightMs: flightMs(carry) * (blocked ? p : 1),
    // The ground phase is a real, watchable part of the shot, not a jump to the rest position.
    rollMs: rollMs(rolled.holed ? distYd(landing, rest) : rollYd),
    lieKind,
  };
}

// --- putting -------------------------------------------------------------------------------------

export const FT_PER_YD = 3;

/** The putter's ABSOLUTE ceiling, in feet. Ours; the reference never showed a putter's range. */
export const MAX_PUTT_FT = 60;
/** The shortest full-power putt the meter will ever be scaled to. */
export const MIN_PUTT_FT = 6;
/** Full power overruns the hole by this much, so the hole is reachable well inside full power. */
export const PUTT_HEADROOM = 1.4;

/**
 * How far a FULL-POWER putt goes, for the putt in hand.
 *
 * THE BUG THIS EXISTS FOR (Matt's playtest, 2026-09-04, filmed): with a fixed 60 ft at full power,
 * required power was linear in distance against an 825 ms sweep, so the tap window for +/- 1.5 ft
 * was a CONSTANT +/- 19 ms - about ONE FRAME at 60fps - at every length. A 2.2 ft putt needed 3.7 %
 * power, reached 28 ms after tap 1. Measured consequences on his phone: 2.2 ft -> 12.6 ft,
 * 2.6 ft -> 10.7 ft, and a 7.9 ft putt struck clean off the green into heavy rough. He took 24
 * shots on a par 4 and quit without holing out.
 *
 * Scaling the range to the putt fixes it with no new UI: every putt now uses the whole meter, so
 * the hole always sits near 1/1.4 = 71 % power and the tolerance is proportional to the putt
 * rather than fixed. A 10 ft putt goes from +/- 19 ms to about +/- 80 ms (5 frames).
 */
export function puttRangeFt(distToPinFt) {
  return Math.max(MIN_PUTT_FT, Math.min(MAX_PUTT_FT, distToPinFt * PUTT_HEADROOM));
}

/** Constant rolling deceleration, in yards per second squared.
 *
 *  DERIVED FROM THE ONE MEASURED PUTT, not guessed: the reference's 17 ft putt decelerated to rest
 *  in about 2.5 s [MEASURED]. For constant deceleration, d = v0 t / 2 and a = 2d / t^2, so
 *  2 * (17/3) / 2.5^2 = 1.81 yd/s^2. Everything else about putting falls out of that: a 60 ft putt
 *  runs about 4.7 s, which is long, because 60 ft is a long way. */
export const PUTT_DECEL = 1.81;

/** Lateral acceleration per unit of green gradient, yd/s^2.
 *
 *  Tuned by measurement, not guessed: at 0.12 a 20 ft putt across a half-strength slope breaks
 *  4.0 in, which is one cup width, which is the feel §20 asks for. golf/js/test.js measures
 *  exactly that and fails if it drifts.
 *
 *  Because the break is integrated the whole way down rather than applied as a formula at the end,
 *  a putt that dies at the hole bends MORE than one struck firm. That is correct golf and it costs
 *  nothing to get right. */
export const BREAK_K = 0.12;

/** The cup. A real hole is 4.25 in across; the capture radius here is a little wider and speed
 *  limited, so a ball that rattles the rim at pace lips out instead of vanishing.
 *
 *  ANYTHING CAN BE HOLED (Matt, 2026-09-04): "a 1 ft putt, a 30 ft putt, a 200 yard 3 wood shot.
 *  Anything. as long as it goes over the hole at a reasonable speed (you can go over it if the
 *  ball is moving too fast)." That is the rule, and until this landed the game did not implement
 *  it: only simulatePutt ever looked at the cup, so a wedge or a wood could pass straight over the
 *  hole and roll on regardless. `cupCheck` below is now the ONE rule, used by both paths. */
export const CUP_RADIUS_YD = 0.12;
export const CUP_CAPTURE_YD = 0.30;
export const CUP_MAX_SPEED = 2.2;                    // yd/s past which the ball runs over the top

/** Does a ball passing this point, at this speed, drop? Close enough AND slow enough. */
export function cupCheck(hole, x, y, speed) {
  return Math.hypot(x - hole.pin[0], y - hole.pin[1]) <= CUP_CAPTURE_YD && speed <= CUP_MAX_SPEED;
}

/** Roll a ball from `start` along `dirRad` for `rollYd`, watching the cup the whole way.
 *  Returns { rest, holed }. Deceleration is the same constant a putt uses, so a ball trickling
 *  the last few feet of its roll behaves exactly like a putt of that length - which is what makes
 *  "a 3 wood can go in" true without a second physics model. */
export function rollWatchingCup(hole, start, dirRad, rollYd) {
  if (!(rollYd > 0)) {
    return { rest: [...start], holed: cupCheck(hole, start[0], start[1], 0) };
  }
  const v0 = Math.sqrt(2 * PUTT_DECEL * rollYd);
  const sin = Math.sin(dirRad);
  const cos = Math.cos(dirRad);
  const STEP = 0.05;                                  // yards; well under the cup's own radius
  const steps = Math.ceil(rollYd / STEP);
  for (let i = 1; i <= steps; i++) {
    const d = Math.min(rollYd, i * STEP);
    const x = start[0] + sin * d;
    const y = start[1] + cos * d;
    // Speed remaining after rolling `d` of a total `rollYd`, under constant deceleration.
    const speed = Math.sqrt(Math.max(0, v0 * v0 - 2 * PUTT_DECEL * d));
    if (cupCheck(hole, x, y, speed)) return { rest: [x, y], holed: true };
  }
  return { rest: [start[0] + sin * rollYd, start[1] + cos * rollYd], holed: false };
}

/**
 * Roll a putt. Returns { path, rest, holed, ms }.
 *
 * The path is sampled at a fixed timestep so the caller can just play it back - the break is not a
 * formula applied at the end, it is integrated the whole way down, which is why a putt that dies
 * near the hole bends more than one struck firm. That is the correct behaviour and it is free.
 */
export function simulatePutt({ hole, from, aimRad, power, rangeFt }) {
  // `rangeFt` is what a full-power putt covers. The caller passes puttRangeFt(distance to the pin);
  // it falls back to the old fixed ceiling only so a bare call still runs.
  const full = rangeFt || MAX_PUTT_FT;
  const distYdWanted = ((full * power) / FT_PER_YD);
  let v = Math.sqrt(Math.max(0, 2 * PUTT_DECEL * distYdWanted));
  let x = from[0];
  let y = from[1];
  let vx = Math.sin(aimRad) * v;
  let vy = Math.cos(aimRad) * v;

  const DT = 1 / 120;
  const path = [[x, y]];
  let holed = false;
  let t = 0;
  const MAX_T = 12;

  // A ball already sitting over the cup is in. Checked BEFORE the speed break below, because a
  // putt with exactly enough pace to reach the hole and die there would otherwise stop on the lip
  // and be recorded as a miss - "as long as it goes over the hole at a reasonable speed" includes
  // stopping on it.
  if (cupCheck(hole, x, y, 0)) return { path, rest: [x, y], holed: true, ms: 0, restOn: 'green' };

  while (t < MAX_T) {
    v = Math.hypot(vx, vy);
    if (cupCheck(hole, x, y, v)) { holed = true; break; }
    if (v <= 0.02) break;
    const g = slopeAt(hole, x, y);
    // The gradient points DOWNHILL, so the ball is pulled along it. Both components apply: a putt
    // up a back-to-front green is slowed as well as bent, which is what makes an uphill putt need
    // more power without any separate rule for it.
    vx += g[0] * BREAK_K * DT;
    vy += g[1] * BREAK_K * DT;
    // Rolling friction, opposing the direction of travel.
    const dec = PUTT_DECEL * DT;
    if (v > dec) { vx -= (vx / v) * dec; vy -= (vy / v) * dec; } else { vx = 0; vy = 0; }

    x += vx * DT;
    y += vy * DT;
    t += DT;
    path.push([x, y]);

    const dh = Math.hypot(x - hole.pin[0], y - hole.pin[1]);
    if (dh <= CUP_CAPTURE_YD && Math.hypot(vx, vy) <= CUP_MAX_SPEED) { holed = true; break; }
  }
  return { path, rest: [x, y], holed, ms: t * 1000, restOn: surfaceAt(hole, x, y) };
}

/** The five aim dots (§21.1). NOT decoration and NOT evenly spaced filler: dot N is where the ball
 *  LANDS at 25/50/75/100 % of this club's distance FROM THIS LIE, and dot 5 marks the over-swing
 *  risk band. Their spacing is the label - nothing on screen names them - and they re-scale the
 *  moment the club changes, which is what makes club choice legible on the ground.
 *
 *  They are a starting point, not a promise: a mishit moves the ball off them. That is exactly the
 *  right contract - an honest plan the player then has to execute. */
export function aimDots(club, lieKind) {
  if (!club || club.id === 'putter') return [];
  const reach = club.carry * lieOf(lieKind).power;
  return [0.25, 0.5, 0.75, 1.0, RISK_FRACTION].map((f) => ({ at: reach * f, risk: f > 1 }));
}
export const RISK_FRACTION = 1.10;

export { CLUBS };
