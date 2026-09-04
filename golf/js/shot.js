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
  const rest = [landing[0] + sin * rollYd, landing[1] + cos * rollYd];
  const restOn = surfaceAt(hole, rest[0], rest[1]);

  return {
    carry, apex, sideYd, aimRad, blocked,
    landing, landedOn, rollYd, rest, restOn,
    travelledYd: distYd(from, rest),
    flightMs: flightMs(carry) * (blocked ? p : 1),
    lieKind,
  };
}

// --- putting -------------------------------------------------------------------------------------

export const FT_PER_YD = 3;
/** Full power rolls 60 ft. Ours: the reference never showed a putter's range. */
export const MAX_PUTT_FT = 60;

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
 *  limited, so a ball that rattles the rim at pace lips out instead of vanishing. */
export const CUP_RADIUS_YD = 0.12;
export const CUP_CAPTURE_YD = 0.30;
export const CUP_MAX_SPEED = 2.2;                    // yd/s past which the ball runs over the top

/**
 * Roll a putt. Returns { path, rest, holed, ms }.
 *
 * The path is sampled at a fixed timestep so the caller can just play it back - the break is not a
 * formula applied at the end, it is integrated the whole way down, which is why a putt that dies
 * near the hole bends more than one struck firm. That is the correct behaviour and it is free.
 */
export function simulatePutt({ hole, from, aimRad, power }) {
  const distYdWanted = ((MAX_PUTT_FT * power) / FT_PER_YD);
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

  while (t < MAX_T) {
    v = Math.hypot(vx, vy);
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
