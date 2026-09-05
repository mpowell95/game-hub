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
import { payingPower } from './swing.js';
import { surfaceAt, slopeAt, treesOf, distYd, mulberry32 } from './holes.js';

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

/** How long a rollout of `rollYd` takes, in ms. Constant deceleration: t = sqrt(2d/a).
 *
 *  `kind` is the surface it comes down ON, and it changes the deceleration. Matt, 2026-09-04:
 *  "the roll speed and distance should also depend on the surface type it's on." The DISTANCE
 *  already did (clubs.js's `rollFactor`); the SPEED did not, so a ball running out on a green and
 *  one dying in heavy rough took the same time to cover their different distances - which reads as
 *  the ball sliding to a scripted stop rather than being slowed by anything.
 *
 *  It reuses `PUTT_DRAG`, normalised so the FAIRWAY is 1.00 (the putting table is normalised on
 *  the green, because that is where putts happen). One table for both, so a surface cannot be
 *  fast for a putt and slow for a run-out. A green is about half the fairway's drag, so a ball
 *  running onto one keeps going; heavy rough is about 2.6x, so it stops dead. */
export function rollMs(rollYd, kind) {
  const a = ROLL_DECEL * (kind ? puttDrag(kind) / puttDrag('fairway') : 1);
  return rollYd > 0 ? Math.sqrt((2 * rollYd) / a) * 1000 : 0;
}

/** THE HOPS, AND HOW MUCH OF THE RUN-OUT THEY CARRY.
 *
 *  Three hops with geometrically decaying length, together covering `HOP_SHARE` of the run-out in
 *  `HOP_TIME` of its duration - so the ball is plainly FASTER while it is bouncing and then settles
 *  into a long, slowing roll. */
const HOP_DECAY = 0.55;
const HOP_SHARE = 0.55;
const HOP_TIME = 0.35;
const HOP_LENS = [1, HOP_DECAY, HOP_DECAY * HOP_DECAY];

/** Where the ball is, `p` (0..1) through its ROLLOUT: how far along, and how high it is hopping.
 *
 *  REWRITTEN 2026-09-05. Matt: "the roll looks unnatural... it lands then slides. it doesn't look
 *  like it's rolling, and it almost never bounces."
 *
 *  Both halves of that were one mistake. The old model was a SINGLE smooth deceleration curve for
 *  the whole run-out with a small sine wave laid on top for height - so the ball's forward speed
 *  never changed abruptly at any point, which is precisely what "sliding" looks like, and the
 *  wave's peaks did not line up with anything the distance was doing. A real ball does two
 *  different things one after the other, and they have to be two different curves:
 *
 *    - WHILE IT IS IN THE AIR IT DOES NOT SLOW DOWN. Each hop is LINEAR in distance and a parabola
 *      in height. The step change in speed at each landing is the whole reason a bounce reads as a
 *      bounce from directly overhead, where the only height cue is the shadow gap.
 *    - ONCE IT IS ROLLING IT DECELERATES SMOOTHLY to a stop.
 *
 *  The hop was also too small to SEE. It was `apex * 0.10` decayed, which for a driver is about
 *  4 px on a 393 px phone against a 6 px ball - under the renderer's own `lift > 1` shadow gate for
 *  most of its arc. It is now `apex * 0.14 + 0.8` yd, about 10 px for a driver, and it is capped at
 *  a third of the run-out so a lob wedge that runs 3 yds does not leap 4 yds into the air.
 *
 *  `landedOn` kills the hops where a ball does not bounce: sand swallows it, and deep rough traps
 *  it. Those surfaces roll from a standing start instead. */
export function groundPoint(p, rollYd, apex, landedOn) {
  const noHop = landedOn === 'greensideBunker' || landedOn === 'fairwayBunker'
    || landedOn === 'heavyRough' || landedOn === 'water';
  const hopH = noHop ? 0 : Math.min(apex * 0.14 + 0.8, rollYd * 0.33);
  const share = noHop ? 0 : HOP_SHARE;
  const tHop = noHop ? 0 : HOP_TIME;

  if (p >= tHop) {
    // The roll: from `share` of the way along to all of it, decelerating to a stop.
    const q = tHop >= 1 ? 1 : (p - tHop) / (1 - tHop);
    const eased = 1 - (1 - q) * (1 - q);
    return { along: rollYd * (share + (1 - share) * eased), height: 0 };
  }

  // The hops. Each is linear in distance and a parabola in height; the lengths decay geometrically
  // and so does the time each one takes, so later hops are shorter AND quicker.
  const total = HOP_LENS[0] + HOP_LENS[1] + HOP_LENS[2];
  let t0 = 0;
  let d0 = 0;
  for (let i = 0; i < HOP_LENS.length; i++) {
    const frac = HOP_LENS[i] / total;
    const t1 = t0 + tHop * frac;
    const d1 = d0 + share * frac;
    if (p < t1 || i === HOP_LENS.length - 1) {
      const q = (p - t0) / Math.max(1e-6, t1 - t0);
      return {
        along: rollYd * (d0 + (d1 - d0) * Math.min(1, q)),
        height: hopH * Math.pow(HOP_DECAY, i) * 4 * q * (1 - q),
      };
    }
    t0 = t1; d0 = d1;
  }
  return { along: rollYd * share, height: 0 };
}

/** Flight time, DECIDED: 0.9 s + distance/60. A 215 yd drive is ~4.5 s, a 50 yd wedge ~1.7 s. The
 *  reference's own 7.5 s drive is too slow for a phone game, and its lack of a skip was the single
 *  worst thing about watching it (§13 flaw 7). A tap skips to the landing. */
// --- wind ----------------------------------------------------------------------------------------
//
// MEASURED off all four reference clips: the panel reads `wind`, a chunky white arrow, and `0.9` -
// IDENTICAL in every frame of every clip, so the wind is a CONSTANT FOR THE HOLE, one decimal
// place, with no unit named. That is the whole of what the footage can tell us. Its EFFECT could
// not be isolated (one clean shot, and 0.9 is a small number), which was already recorded in the
// batch 2 measuring pass.
//
// SO THE STRENGTH BELOW IS DECIDED, NOT MEASURED, and it is calibrated against what the PLAYER can
// do about it rather than against the footage: full wind (2.0) straight across moves a driver about
// 12 yds, which is 3.2 degrees at 215 yds - three taps of the aim arrow, now that a tap is 1.0
// degree. Small enough to be a correction, big enough to be worth making.
export const WIND_MAX = 2.0;
export const WIND_YD_PER_UNIT_SEC = 1.34;

/** The wind on a hole: `{ speed, bearing }`, speed 0.0-2.0 in tenths, bearing in radians measured
 *  the way `aimRad` is (0 = up the hole, clockwise positive), snapped to the eight compass points.
 *
 *  DETERMINISTIC PER HOLE, and deliberately not per round: the reference's wind does not change
 *  during a hole, a hole that plays differently every visit cannot be learned, and a test that has
 *  to stub the weather is a test that stops covering the weather. The seed is the hole number and
 *  its card yardage, which differ between the two courses, so no hole data had to change. */
export function windFor(hole) {
  if (!hole) return { speed: 0, bearing: 0 };
  // A hole may state its own wind. Nothing in the shipped course data does - the derivation below
  // is what every hole actually uses - but it is the honest default rather than the only rule, and
  // it is what lets a test assert a club's distance without the weather in the way.
  if (hole.wind) return hole.wind;
  const rnd = mulberry32((hole.n | 0) * 7919 + Math.round(hole.cardYards || 0));
  rnd();                                            // discard the first draw; mulberry32's is weak
  const r = rnd();
  // One hole in six is dead calm, which is what makes a windy one register as windy.
  const speed = r < 0.167 ? 0 : Math.round((0.3 + rnd() * (WIND_MAX - 0.3)) * 10) / 10;
  const bearing = Math.floor(rnd() * 8) * (Math.PI / 4);
  return { speed, bearing };
}

/** What the wind does to one shot, as an ALONG and a SIDE displacement in yards.
 *
 *  It is folded into the carry and the lateral offset BEFORE the tree test, not added to the
 *  landing point afterwards - a ball blown into a tree has to hit the tree. */
export function windEffect(hole, aimRad, flightSeconds) {
  const w = windFor(hole);
  if (!(w.speed > 0)) return { alongYd: 0, sideYd: 0 };
  const rel = w.bearing - aimRad;                   // wind direction relative to the shot
  const push = w.speed * WIND_YD_PER_UNIT_SEC * flightSeconds;
  return { alongYd: push * Math.cos(rel), sideYd: push * Math.sin(rel) };
}

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
/** How far around a ball lying IN the trees the stand stops blocking it overhead. Roughly two
 *  crowns of a parkland pine: far enough that the ring of trunks you are standing among cannot
 *  wall a ball in, close enough that the wood twenty yards ahead is still a wood.
 *
 *  IT SCALES WITH THE CANOPY DOING THE WALLING. A fixed 11 yds is two crowns of a pine and barely
 *  one and a half of a sentinel (canopy 9), so a ball standing in a stand of the big ones was
 *  still walled in - measured as a run of dead ends on Pine Valley 10 and 17 after the sentinels
 *  went in. The escape has to be a property of the stand, not a constant. */
export const ESCAPE_YD = 13;

export function treeHit(hole, from, dirRad, distanceYd, sideYd, apex) {
  const trees = treesOf(hole);
  if (!trees.length) return null;
  const cos = Math.cos(dirRad);
  const sin = Math.sin(dirRad);
  const STEP = 0.4;                                  // yards; the narrowest trunk is 0.6 across
  const steps = Math.max(2, Math.ceil(distanceYd / STEP));

  // WHERE THE BALL ALREADY IS CANNOT BE AN OBSTACLE TO LEAVING IT. Without this the game
  // SOFTLOCKS, and it did: a ball that finished under a canopy was blocked on the very first
  // sample of its next shot, dropped where it stood, and was blocked again - for ever, with the
  // meter working perfectly and the ball travelling 0 yards every time. Measured on Pine Valley
  // 3 and 10, where a hand-placed oak sits in the fairway: fourteen shots, zero yards.
  //
  //  - A tree the ball is basically TOUCHING (inside trunk + 1.2 yds) is ignored outright. You are
  //    against it; in this game you get to play it, rather than be permanently stuck.
  //  - A tree the ball is merely UNDER (inside the canopy) still blocks with its TRUNK, but its
  //    canopy no longer stops a low ball: the ball is already beneath it and exits in the first
  //    yard. Punching out from under a tree is real golf; being unable to move is not.
  //
  // Everything else - the tree you are 10 yards short of, which is the whole point of the hole -
  // is unchanged.
  //  - AND A BALL STANDING IN THE WOOD PLAYS OUT OF IT. Once tree belts were closed up to the
  //    density the reference's woodland actually has (holes.js's BELT_PITCH, 2026-09-05), the two
  //    rules above stopped being enough: a ball inside a belt is under one crown and surrounded by
  //    the next ring of them, so every low escape was blocked by a neighbour it was standing among.
  //    Pine Valley 15 softlocked on the 36-hole test the day the belts closed. Which hole broke
  //    depended on the seed, so a pitch that happened to pass was luck rather than a fix.
  //
  //    So: when the ball's own lie is the trees, the CANOPIES of the stand immediately around it
  //    (inside ESCAPE_YD) do not stop the shot. Trunks still do, every tree beyond the stand still
  //    does, and a ball on the fairway is completely unaffected - this reads only on a ball that is
  //    already in the wood. It is the punch-out that the rule above already grants from under one
  //    tree, granted from under the stand, which is what playing out of trees is.
  const inWood = surfaceAt(hole, from[0], from[1]) === 'trees';
  const state = trees.map((t) => {
    const type = hole.treeTypes[t.type];
    const d0 = Math.hypot(from[0] - t.x, from[1] - t.y);
    return { t, type, ignore: d0 <= type.trunk + 1.2, canopyOff: d0 <= type.canopy || (inWood && d0 <= Math.max(ESCAPE_YD, type.canopy * 1.6)) };
  });

  // ...and the walk starts clear of the ball for the same reason.
  const startAt = Math.min(0.35, 1.2 / Math.max(1, distanceYd));
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    if (p < startAt) continue;
    const f = flightPoint(p, distanceYd, sideYd, apex);
    const x = from[0] + sin * f.along + cos * f.side;
    const y = from[1] + cos * f.along - sin * f.side;
    for (const st of state) {
      if (st.ignore) continue;
      const { t, type } = st;
      const d = Math.hypot(x - t.x, y - t.y);
      if (d > type.canopy) continue;
      if (d <= type.trunk) return { tree: t, type, at: [x, y], p };
      if (!st.canopyOff && f.height < type.height) return { tree: t, type, at: [x, y], p };
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
  // `payingPower` is the power that becomes DISTANCE. Past the over-swing block's edge only a
  // fraction of each extra unit pays, so holding to the top of the arc is worth far less than the
  // raw number suggests - see swing.js's BLOCK_KEEPS_DIST.
  const struck = club.carry * payingPower(power) * lie.power * distanceMul;
  // THE WIND, folded in before anything else looks at where the ball goes. The flight time is taken
  // from the UNWINDED carry: a headwind that shortens the shot also shortens the time it has to act
  // over, and solving that properly would need an iteration to buy a fraction of a yard.
  const wind = windEffect(hole, aimRad, flightMs(struck) / 1000);
  const carry = Math.max(1, struck + wind.alongYd);
  const apex = apexYd(club, carry);
  // The miss is expressed as a lateral offset at the landing point, so the curve above and the
  // straight-line geometry agree on where the ball ends up. The wind's cross component joins it,
  // for the same reason: one number for "how far off the aim line did it finish".
  const sideYd = Math.tan(mishitDeg * DEG) * carry + wind.sideYd;

  const blocked = treeHit(hole, from, aimRad, carry, sideYd, apex);
  const cos = Math.cos(aimRad);
  const sin = Math.sin(aimRad);

  // A blocked ball drops where it met the tree, killed - the trunk IS the penalty (§21.2). It
  // drops a couple of yards SHORT of the contact point rather than on it, because a ball resting
  // exactly on a trunk is a ball whose next shot starts inside that trunk. It never comes back
  // behind where it was struck from.
  const p = blocked ? blocked.p : 1;
  const f = flightPoint(p, carry, sideYd, apex);
  const along = blocked ? Math.max(0, f.along - 2) : f.along;
  const landing = [from[0] + sin * along + cos * f.side, from[1] + cos * along - sin * f.side];

  const landedOn = surfaceAt(hole, landing[0], landing[1]);
  const rollYd = blocked ? 0 : carry * rollFactor(landedOn, club);

  // A ball pitching straight into the cup is in, whatever club sent it.
  const holedOnTheFly = !blocked && cupCheck(hole, landing[0], landing[1], 0);
  const rolled = holedOnTheFly
    ? { rest: [...landing], holed: true }
    : rollWatchingCup(hole, landing, aimRad, rollYd);
  let rest = rolled.rest;
  let restOn = surfaceAt(hole, rest[0], rest[1]);

  // THE PENALTY DROP. Until now a ball that finished in water simply STAYED there and was played
  // from a water lie, because the drop prompt was left for Stage C. Once the courses gained real
  // water that became a shipping loop: measured on Pine Valley 3, 10 and 17, a ball in a pocket
  // beside a lake had no dry shot at all, so every attempt went back in and the hole ran to 16, 17
  // and 24 strokes. A player cannot get out of that by playing better, which is the definition of
  // a stuck ball.
  //
  // The rule is real golf's and it needs no UI: the ball is dropped WHERE IT LAST CROSSED DRY
  // GROUND on its own flight line, one stroke on. Walking the path backwards is what makes it the
  // crossing point rather than an arbitrary spot, and the tee is the floor, so a drop can never
  // finish behind where the shot was struck from. `penalty` is returned rather than applied here,
  // because strokes are the caller's business - `resolveShot` stays a pure function of its inputs.
  let penalty = 0;
  if (restOn === 'water' && !rolled.holed) {
    penalty = 1;
    let found = null;
    for (let k = 40; k >= 0; k--) {
      const q = k / 40;
      const fp = flightPoint(q * p, carry, sideYd, apex);
      const cand = [from[0] + sin * fp.along + cos * fp.side, from[1] + cos * fp.along - sin * fp.side];
      const on = surfaceAt(hole, cand[0], cand[1]);
      if (on !== 'water') { found = { cand, on }; break; }
    }
    if (found) { rest = found.cand; restOn = found.on; }
    else { rest = [...from]; restOn = lieKind; }
  }

  return {
    carry, apex, sideYd, aimRad, blocked, wind, penalty,
    landing, landedOn, rollYd, rest, restOn,
    holed: rolled.holed,
    travelledYd: distYd(from, rest),
    flightMs: flightMs(carry) * (blocked ? p : 1),
    // The ground phase is a real, watchable part of the shot, not a jump to the rest position.
    rollMs: rollMs(rolled.holed ? distYd(landing, rest) : rollYd, landedOn),
    lieKind,
  };
}

// --- putting -------------------------------------------------------------------------------------

export const FT_PER_YD = 3;

/** THE PUTTER'S RANGE. A full-power putt goes this far, from anywhere, always.
 *
 *  It is the club's own stat, exactly like every other club's `carry` in clubs.js. That is the
 *  whole point, and it was briefly not true.
 *
 *  WHAT WENT WRONG, AND WHY THE FIX WAS WORSE THAN THE BUG. The first playtest found putting
 *  unplayable: against the old 825 ms power ring, the tap window for +/- 1.5 ft was a constant
 *  +/- 19 ms - about ONE FRAME at 60fps - at every length, because required power was linear in
 *  distance over a fixed 60 ft. A 2.2 ft putt needed 3.7 % power, reached 28 ms after tap 1. On
 *  Matt's phone: 2.2 ft -> 12.6 ft, and a 7.9 ft putt struck clean off the green.
 *
 *  The fix then was to SCALE the range to the putt in hand (distance x 1.4, floored at 6 ft), so
 *  every putt used the whole meter. It worked, and it was the wrong thing. Matt, playing it:
 *  "regardless of how far the putt is, it changes the max distance i can hit the putter so that
 *  100% is equal to the hole. If i'm 30 feet away, a 100% power putt will go exactly 30 feet. If
 *  i'm 2 feet away, a 100% power putt will go 2 feet." A meter whose scale moves under you means
 *  nothing: no feel transfers from one putt to the next, because 60 % power is a different putt
 *  every time. That is a rubber band, not a skill.
 *
 *  IT IS FIXED AGAIN NOW, AND THE ORIGINAL PROBLEM IS GONE ON ITS OWN. The two-meter ring that
 *  made short putts a one-frame stop is gone; power is set on the three-click BACKSWING, which is
 *  1650 ms per power unit against the old ring's 750 ms. Measured, by sweeping real putts through
 *  `simulatePutt` and counting the powers that drop:
 *
 *      fixed 60 ft   1 ft: 9.5 frames   4 ft: 9.3   10 ft: 9.3   25 ft: 9.5   40 ft: 9.3
 *      scaled (old)  1 ft: 95.8         4 ft: 46.5  10 ft: 33.3  25 ft: 16.2  40 ft: 10.1
 *
 *  The window is now CONSTANT at every distance - which is exactly what a fixed scale should give
 *  you, and it is what makes the meter learnable. It is also BETTER than the scaled version at the
 *  long end, where putts are actually hard; the scaled version only looked generous because it was
 *  spending the entire meter on a tap-in.
 *
 *  A putt longer than this cannot be holed in one, and the aim ladder shows that honestly by
 *  putting its 100 % dot short of the cup. Lagging it close is the right play, as in real golf.
 *  (The usable maximum is a yard or so under the nominal: the ball has to still be moving when it
 *  reaches the cup to be captured.)
 */
export const MAX_PUTT_FT = 60;

/** How far a FULL-POWER putt goes. A constant - see MAX_PUTT_FT above for why it must be.
 *
 *  Kept as a function because the aim ladder, the shot resolver and the tests all ask the same
 *  question, and a single place to answer it is what stops the ladder and the physics disagreeing
 *  about where full power lands. */
export function puttRangeFt() { return MAX_PUTT_FT; }

/** THE PUTTER'S POWER CURVE IS NOT LINEAR, and that is the whole reason short putts are makeable.
 *
 *  Matt, 2026-09-05: *"Short putts are impossible to make. It goes over the hole."* Measured, and
 *  he is exactly right - it was never about the line:
 *
 *      a 2 ft putt drops for any power between 2.0 % and 11.4 %
 *      at 1585 ms per power unit that window is 32 ms to 181 ms after the first tap
 *
 *  So the entire makeable window for a tap-in sat in the first fifth of a second of the backswing,
 *  before the needle has visibly moved. Late by a fraction and the ball runs past the hole - which
 *  is precisely what he described. The window was a perfectly respectable 8.9 frames wide; it was
 *  in the wrong PLACE.
 *
 *  A LINEAR scale cannot fix that. Distance is proportional to power, so a 2 ft putt on a 60 ft
 *  range needs 3.3 % of the meter no matter how the meter is timed, and the first 3 % of anything
 *  is unhittable. Making the range follow the putt in hand does fix it and is what an earlier build
 *  did - and it was reverted on purpose, because a scale that moves under the player is a rubber
 *  band: 60 % power meant a different putt every time and nothing learned on one transferred to the
 *  next.
 *
 *  So the scale stays FIXED and gets a curve. `distance = range * power^PUTT_GAMMA` spends more of
 *  the meter on the short end while 100 % is still 60 ft on every green in the game:
 *
 *      putt     linear power / when      curved power / when
 *       2 ft      3.3 %  /  53 ms         11.9 %  /  189 ms
 *       3 ft      5.0 %  /  79 ms         15.4 %  /  244 ms
 *      10 ft     16.7 %  / 264 ms         32.7 %  /  518 ms
 *      30 ft     50.0 %  / 793 ms         64.8 %  / 1027 ms
 *      60 ft    100.0 %  /1585 ms        100.0 %  / 1585 ms
 *
 *  The tap for a tap-in moves from 53 ms to 189 ms after the first tap, and its make window widens
 *  from 149 ms to about 400. Long putts barely move, because that end of the curve is nearly
 *  straight - which is what makes this a fix rather than a trade.
 *
 *  THE AIM LADDER USES THE SAME CURVE (`render.js` draws its dots at `f ** PUTT_GAMMA`), because
 *  the dots are what a player gauges power against. Dots at even distances over a curved meter
 *  would lie about where 50 % goes, and a putting read that lies is worse than none. */
export const PUTT_GAMMA = 1.6;
export function puttDistanceFt(power, rangeFt) {
  return (rangeFt || MAX_PUTT_FT) * Math.pow(Math.max(0, Math.min(1, power)), PUTT_GAMMA);
}

/** The inverse: what power the meter needs for a putt of `ft`. Nothing in the GAME calls this - the
 *  player sets the power by stopping the needle - but every test and probe that has to play a putt
 *  does, and each one that computed `ft / rangeFt` by hand was silently a different putt from the
 *  one the meter would give. */
export function puttPowerFor(ft, rangeFt) {
  const full = rangeFt || MAX_PUTT_FT;
  return Math.min(1, Math.pow(Math.max(0, ft) / full, 1 / PUTT_GAMMA));
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

/** HOW MUCH A ROLLING BALL IS SLOWED BY WHAT IT IS ROLLING ON, as a multiple of `PUTT_DECEL`
 *  (which is the green, and so is 1.00 by definition).
 *
 *  This exists because the putter can be taken from the fairway and the collar (Matt, 2026-09-04:
 *  "long putts from off the green (from the fairway or fringe) should be possible"), and a ball
 *  putted across a fairway that ran exactly as far as one putted across the green would make the
 *  green mean nothing.
 *
 *  DECIDED, NOT MEASURED, and said so plainly: the reference is never once seen putting from off
 *  the green, so there is no footage to measure. The ordering is the part that matters and it is
 *  the ordering of real golf - collar a little slower than the putting surface, mown fairway
 *  slower again. Anything the putter cannot legally be taken from gets a large number rather than
 *  no entry, so a ball that RUNS onto rough at the end of a putt still stops in it.
 *
 *  The full-power distance is normalised against the lie the ball STARTS on (see `simulatePutt`),
 *  so the power meter still means "60 ft at 100 %" wherever it is swung - what changes is what
 *  happens to the ball once it is rolling, including speeding up as it runs onto the green. */
export const PUTT_DRAG = {
  green: 1.00,
  fringe: 1.55,
  tee: 1.90,
  fairway: 1.90,
  lightRough: 3.40,
  heavyRough: 5.00,
  fairwayBunker: 6.00,
  greensideBunker: 6.00,
  trees: 3.40,
  water: 8.00,
};
export function puttDrag(kind) { return PUTT_DRAG[kind] || PUTT_DRAG.fairway; }

/** The average drag over the ground a putt is ABOUT to cross, sampled along the aim line.
 *
 *  This is what makes "full power covers `rangeFt`" hold on a MIXED path. Normalising against the
 *  lie the ball sits on alone is wrong in both directions and measurably so: a putt struck from the
 *  collar was given enough pace for 60 ft of collar, then reached the green after 6 yds and ran
 *  85 ft; a putt from the fairway to a green mostly on the fairway came up short. Weighting the
 *  whole path fixes both, and it is what a player is doing by eye anyway - looking at what the ball
 *  has to travel over, not at what it is sitting on. */
export function avgPuttDrag(hole, from, aimRad, distanceYd) {
  if (!(distanceYd > 0)) return puttDrag(surfaceAt(hole, from[0], from[1]));
  const N = 24;
  const sin = Math.sin(aimRad);
  const cos = Math.cos(aimRad);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const d = ((i + 0.5) / N) * distanceYd;
    sum += puttDrag(surfaceAt(hole, from[0] + sin * d, from[1] + cos * d));
  }
  return sum / N;
}


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
  const distYdWanted = puttDistanceFt(power, full) / FT_PER_YD;
  let x = from[0];
  let y = from[1];
  // Full power covers `rangeFt` OVER THE GROUND THE BALL IS ABOUT TO CROSS - so the meter reads the
  // same whether the ball is on the green or 15 yds short of it, and the surface shows up in the
  // pace the stroke needs rather than in a power scale that silently changes under the player.
  const dec0 = PUTT_DECEL * avgPuttDrag(hole, [x, y], aimRad, distYdWanted);
  let v = Math.sqrt(Math.max(0, 2 * dec0 * distYdWanted));
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
    // Rolling friction, opposing the direction of travel - sampled at the ball's CURRENT position,
    // so a putt from the fairway drags until it reaches the green and then runs out on it.
    const dec = PUTT_DECEL * puttDrag(surfaceAt(hole, x, y)) * DT;
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
