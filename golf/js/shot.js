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
import { surfaceAt, slopeAt, treesOf, distYd, mulberry32, greenBox, polyOf, bboxOf, pointInPoly } from './holes.js';

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
// RE-SHAPED 2026-09-06. Matt, on the same run-out for the third time: "the drive doesn't bounce
// high enough, it comes in and bounces very low and a short distance then the roll stops short...
// Nothing truly rolls out." The DISTANCES are measured off the reference and are not the problem
// (a driver runs 38.7 yds on a fairway); the shape of the animation was. Two changes, both about
// what the player sees rather than where the ball ends up:
//   - the hops carry a bit more of the distance and decay more gently (0.55 -> 0.62 each), so the
//     first bounce is a real bounce and the second is still one;
//   - they take LESS of the time (0.35 -> 0.28), which leaves 72% of the run-out's duration for
//     the roll itself. That is the half Matt cannot see: a roll that owns two thirds of the
//     distance in a third of the time reads as a skid, not as a ball running out.
const HOP_DECAY = 0.62;
const HOP_SHARE = 0.62;
const HOP_TIME = 0.28;
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
  // 2026-09-06: `apex * 0.14 + 0.8` capped at a THIRD of the run-out, which is about 10 px for a
  // driver and 3 px for an iron pitching on a green - Matt: "it bounces very low". Raised to
  // `apex * 0.22 + 1.2`, and the cap given a floor of 1.2 yd, because the cap is what was killing
  // the bounce on exactly the shots a player watches most closely: an approach that lands on a
  // green runs only a few yards, and a ball landing on a green plainly bounces.
  const hopH = noHop ? 0 : Math.min(apex * 0.22 + 1.2, Math.max(1.2, rollYd * 0.45));
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

/** How far past a crown's edge a ball can still be played out from UNDER the branches. */
export const SKIRT_YD = 3;

/** How far a ball that hits a trunk finishes from where it was struck, at the least, and how far
 *  clear of that trunk it is dropped. A blocked shot is meant to cost a stroke and go nowhere -
 *  not to go NOWHERE AT ALL, which is a hole that cannot be finished. See resolveShot. */
export const MIN_BLOCKED_YD = 2.0;
export const BLOCK_CLEAR_YD = 1.0;

/** How far inside the hole's drawn bounds a ball is allowed to finish. The camera clamps to those
 *  bounds, so a ball outside them cannot be framed at all. */
export const EDGE_MARGIN_YD = 2.0;

/** How far a penalty drop must move the ball. A drop that lands on the divot the shot was played
 *  from costs a stroke and changes nothing, which is a hole that cannot be finished. */
export const MIN_DROP_YD = 2.5;

/** The hole's WATER polygons and their boxes, cached on the hole.
 *
 *  `surfaceAt` walks every surface of the hole and ray-casts each one, which is exactly right when
 *  the question is "what is the ball lying on" and far too expensive to ask a few hundred times
 *  inside one run-out. The run-out only needs one bit - is this water - so it asks that directly,
 *  and a bounding-box test rejects almost every sample before any ray is cast. */
function waterOf(hole) {
  if (!hole._water) {
    const w = (hole.surfaces || [])
      .filter((s) => s.kind === 'water')
      .map((s) => { const poly = polyOf(s, hole); return { poly, bb: bboxOf(poly) }; });
    Object.defineProperty(hole, '_water', { value: w, enumerable: false });
  }
  return hole._water;
}
function isWater(hole, x, y) {
  for (const w of waterOf(hole)) {
    if (x < w.bb.minX || x > w.bb.maxX || y < w.bb.minY || y > w.bb.maxY) continue;
    if (pointInPoly([x, y], w.poly)) return true;
  }
  return false;
}

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
  //    ...AND THE LIE IS THE WRONG TEST FOR "IS THIS BALL WALLED IN". Measured 2026-09-06 by
  //    section 15c, which plays 432 Pine Valley rounds: 13 of them ended with the ball unable to
  //    move AT ALL, and three of those were standing on the FAIRWAY - cut grass, ringed by belt
  //    trees on both sides, every one of 45 club/aim/power options blocked, for ever. The `trees`
  //    lie is painted from the belt POLYGON, so a ball that runs a yard or two past its edge is
  //    surrounded by exactly the same stand and gets none of the relief.
  //
  //    So the escape is granted by WHAT IS AROUND THE BALL rather than by what it is sitting on:
  //    three or more canopies within reach means the ball is inside a stand, whatever the lie says.
  //    ONE tree ahead of you is not a stand and still blocks - which is deliberate, because that is
  //    Pine Valley 3's lone fairway oak, and being ten yards short of it is the whole hole.
  const near = trees.reduce((n, t) => {
    const ty = hole.treeTypes[t.type];
    const reach = Math.max(ESCAPE_YD, ty.canopy * (t.s || 1) * 1.6);
    return n + (Math.hypot(from[0] - t.x, from[1] - t.y) <= reach ? 1 : 0);
  }, 0);
  const inWood = near >= 3 || surfaceAt(hole, from[0], from[1]) === 'trees';

  // AND A BALL AT THE DRIPLINE IS AN UNDER-THE-BRANCHES QUESTION, NOT A FLY-OVER ONE. `treeHit`
  // models a canopy as a solid cylinder from the ground up to `height`, which is not what a tree
  // is: there is clear air under the crown, which is why the rules above already let a ball punch
  // out from UNDERNEATH one. The same is true a couple of yards outside it, and it has to be, or
  // the model softlocks - measured on Pine Valley 3, whose lone fairway oak (canopy 8) blocked
  // every shot from a ball resting 9.5 yds away on the fairway, in all 45 directions, for ever.
  // `SKIRT_YD` past the crown is where "step under the branches and punch it out" stops being
  // available and "carry it or go round" starts.
  //
  // THE HOLE'S OWN FEATURE SURVIVES THIS: the designed shot on 3 is played from ten yards further
  // back than that, where the oak still blocks exactly as it always has.
  // A TREE'S OWN SIZE (`t.s`, from holes.js's `treeScale`) SCALES ITS CANOPY AND TRUNK HERE TOO.
  // The renderer draws every crown at that same multiple, and this file's contract with it is that
  // what is painted is what stops the ball - applying the size in one place and not the other would
  // give the game trees you can see and fly through, and trees you cannot see and cannot pass.
  const state = trees.map((t) => {
    const ty = hole.treeTypes[t.type];
    const sc = t.s || 1;
    const type = sc === 1 ? ty : { ...ty, trunk: ty.trunk * sc, canopy: ty.canopy * sc };
    const d0 = Math.hypot(from[0] - t.x, from[1] - t.y);
    return { t, type, ignore: d0 <= type.trunk + 1.2, canopyOff: d0 <= type.canopy + SKIRT_YD || (inWood && d0 <= Math.max(ESCAPE_YD, type.canopy * 1.6)) };
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
/** WHERE A DROPPED BALL GOES, for every kind of drop this game takes.
 *
 *  Real golf drops within a club-length of where the ball crossed the margin, no nearer the hole.
 *  This is that, made deterministic: rings outward from the ball at MIN_DROP_YD and up, sixteen
 *  directions each, and takes the first spot that is on the map, not on a surface the caller has
 *  ruled out, and - preferred over anything else at the same radius - not closer to the pin.
 *
 *  The distance floor is the point of it. A drop that lands on the divot the shot was played from
 *  costs a stroke and changes nothing, which is a hole that cannot be finished; that was a real
 *  softlock (see MIN_DROP_YD).
 *
 *  `isBad(kind)` is what the caller cannot accept: water for the automatic hazard drop, water AND
 *  trees for a player who has chosen to drop out of a wood. Returns null when nothing within
 *  fourteen yards works, and the caller keeps the lie it had. */
export function dropNear(hole, from, isBad) {
  const b = hole.bounds;
  const wasTo = distYd(from, hole.pin);
  let best = null;
  for (let rad = MIN_DROP_YD; rad <= 14 && !best; rad += 1.5) {
    for (let a2 = 0; a2 < 16; a2++) {
      const th = (a2 / 16) * Math.PI * 2;
      const cand = [from[0] + Math.sin(th) * rad, from[1] + Math.cos(th) * rad];
      if (cand[0] < b.minX + EDGE_MARGIN_YD || cand[0] > b.maxX - EDGE_MARGIN_YD) continue;
      if (cand[1] < b.minY + EDGE_MARGIN_YD || cand[1] > b.maxY - EDGE_MARGIN_YD) continue;
      const on = surfaceAt(hole, cand[0], cand[1]);
      if (isBad(on)) continue;
      const nearer = distYd(cand, hole.pin) < wasTo - 0.5;
      if (!best || (best.nearer && !nearer)) best = { rest: cand, restOn: on, nearer };
      if (!nearer) break;
    }
  }
  return best;
}

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
  // A BLOCKED SHOT ALWAYS MOVES THE BALL. It used to be `Math.max(0, f.along - 2)`, and when the
  // trunk is within two yards that is a stroke that moves the ball 0.00 yd and leaves the identical
  // lie - so the same swing does the same nothing, for ever. Measured over 40 rounds of Pine Valley
  // with a human-shaped player: 66 zero-yard strokes, four holes that never finished at all, and
  // four spots the ball returned to three times running. That is a softlock, not a penalty.
  //
  // A ball that cannons off a trunk from two yards does not land on its own divot: it kicks out
  // and drops a couple of yards away. MIN_BLOCKED_YD is that couple of yards, and the clear-of-the
  // -trunk step below is what stops the new spot being inside the tree it just hit.
  const along = blocked ? Math.max(MIN_BLOCKED_YD, f.along - 2) : f.along;
  const landing = [from[0] + sin * along + cos * f.side, from[1] + cos * along - sin * f.side];
  if (blocked) {
    // WHERE A BLOCKED BALL ACTUALLY ENDS UP. Two rules, and both are needed:
    //
    //   1. never inside the trunk it just hit - the next shot would start inside a tree;
    //   2. never within MIN_BLOCKED_YD of where it was struck - that is the softlock this whole
    //      block exists for, and rule 1 on its own can CAUSE it (kicking the ball to the near
    //      side of a trunk it was already sitting beside moved it half a yard, which test 10c
    //      caught).
    //
    // The kick is PERPENDICULAR to the shot line, on the side the ball was already curving to,
    // because that is what a ball glancing off a trunk does.
    const bt = blocked.tree;
    const need = blocked.type.trunk + BLOCK_CLEAR_YD;
    if (Math.hypot(landing[0] - bt.x, landing[1] - bt.y) < need) {
      const side = f.side >= 0 ? 1 : -1;
      landing[0] = bt.x + cos * side * need;
      landing[1] = bt.y - sin * side * need;
    }
    let dx = landing[0] - from[0], dy = landing[1] - from[1];
    let d = Math.hypot(dx, dy);
    if (d < MIN_BLOCKED_YD) {
      if (d < 1e-6) { dx = cos; dy = -sin; d = 1; }
      landing[0] = from[0] + (dx / d) * MIN_BLOCKED_YD;
      landing[1] = from[1] + (dy / d) * MIN_BLOCKED_YD;
      // ...and if THAT walked it back into the trunk, step around the trunk instead.
      if (Math.hypot(landing[0] - bt.x, landing[1] - bt.y) < need) {
        const side = f.side >= 0 ? 1 : -1;
        landing[0] = bt.x + cos * side * need;
        landing[1] = bt.y - sin * side * need;
      }
    }
  }

  const landedOn = surfaceAt(hole, landing[0], landing[1]);
  const rollYd = blocked ? 0 : carry * rollFactor(landedOn, club);

  // A ball pitching straight into the cup is in, whatever club sent it.
  const holedOnTheFly = !blocked && cupCheck(hole, landing[0], landing[1], 0);
  // THE RUN-OUT FOLLOWS THE BALL, NOT THE AIM LINE (2026-09-08). `flightPoint` puts the lateral
  // miss on `p * p`, so a ball that has curved is not travelling along `aimRad` when it lands - its
  // heading is the slope of that curve at p = 1, `atan(2 * sideYd / carry)`. This did not matter
  // while `ui.js` folded the miss into `aimRad` and left `sideYd` at zero (the two were the same
  // line); it does now that a mishit is a genuine slice. A sliced drive keeps drifting as it runs,
  // which is what a sliced drive does.
  const rollRad = aimRad + Math.atan2(2 * sideYd, Math.max(1e-6, carry));
  const rolled = holedOnTheFly
    ? { rest: [...landing], holed: true }
    : rollWatchingCup(hole, landing, rollRad, rollYd);
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

    // AND THE DROP HAS TO MOVE THE BALL. Walking the flight line back finds the last dry point on
    // it - which, when the water starts a yard in front of the ball, is the ball itself. The
    // player then pays a stroke, the ball does not move, the same swing does the same thing, and
    // the hole cannot be finished: measured on Pine Valley 3, a wedge from the rough beside the
    // lake looping at "38,295" for stroke after stroke.
    //
    // Real golf drops within a club-length of the crossing point and no nearer the hole; this
    // searches outward from the ball for the nearest dry, in-bounds spot at least MIN_DROP_YD
    // away, preferring one that is not closer to the pin, and takes any dry spot rather than
    // none. The stroke is still charged - it is the ball being stuck that is the bug, not the
    // penalty.
    if (distYd(from, rest) < MIN_DROP_YD) {
      const moved = dropNear(hole, from, (k) => k === 'water');
      if (moved) { rest = moved.rest; restOn = moved.restOn; }
    }
  }

  // THE BALL NEVER FINISHES OFF THE MAP. `hole.bounds` is the drawn extent of the hole, and the
  // camera clamps to it - so a ball outside it is a ball the player CANNOT SEE and cannot frame,
  // with an aim line running off into blank colour. Measured over 40 rounds of Pine Valley: 14
  // shots finished outside, one of them 75 yds beyond the edge of hole 10.
  //
  // It is pulled back to the edge rather than penalised. There are no out-of-bounds stakes drawn
  // anywhere in this game, and a stroke for crossing a line nobody can see is a punishment the
  // player cannot learn from; the lie out there is trees or heavy rough already, which is the
  // real cost of the miss. EDGE_MARGIN_YD keeps it a little inside so the camera has something to
  // frame and the ball is not drawn half off the tilemap.
  if (!rolled.holed) {
    const b = hole.bounds;
    const cx = Math.min(b.maxX - EDGE_MARGIN_YD, Math.max(b.minX + EDGE_MARGIN_YD, rest[0]));
    const cy = Math.min(b.maxY - EDGE_MARGIN_YD, Math.max(b.minY + EDGE_MARGIN_YD, rest[1]));
    if (cx !== rest[0] || cy !== rest[1]) {
      rest = [cx, cy];
      restOn = surfaceAt(hole, cx, cy);
      // Pulling it in can land it in a pond at the edge; the water rule has already run, so this
      // walks out of it the same way rather than leaving a ball sitting in a lake.
      if (restOn === 'water') {
        penalty = 1;
        let out = null;
        for (let k = 1; k <= 30 && !out; k++) {
          for (const ang of [0, 90, 180, 270, 45, 135, 225, 315]) {
            const rad = ang * DEG;
            const cand = [cx + Math.sin(rad) * k, cy + Math.cos(rad) * k];
            if (cand[0] < b.minX + EDGE_MARGIN_YD || cand[0] > b.maxX - EDGE_MARGIN_YD) continue;
            if (cand[1] < b.minY + EDGE_MARGIN_YD || cand[1] > b.maxY - EDGE_MARGIN_YD) continue;
            const on = surfaceAt(hole, cand[0], cand[1]);
            if (on !== 'water') { out = { cand, on }; break; }
          }
        }
        if (out) { rest = out.cand; restOn = out.on; } else { rest = [...from]; restOn = lieKind; }
      }
    }
  }

  // NO BALL RESTS INSIDE A TREE. The blocked path already steps clear of the trunk it HIT; this
  // is the other way in - a ball that flew past the canopy and rolled to a stop inside a
  // different trunk, which the renderer then draws underneath a tree. One in a hundred rounds of
  // Pine Valley (hole 17, at 23.5/261.6), so rare enough to have been invisible and cheap enough
  // to make universal. Pushed radially out to the same clearance a blocked ball gets, and only if
  // that spot is dry and on the map - a trunk is a better place to be than a pond.
  if (!rolled.holed) {
    for (const t of treesOf(hole)) {
      const ty = hole.treeTypes[t.type];
      if (!ty) continue;
      const need = ty.trunk * (t.s || 1) + BLOCK_CLEAR_YD;
      const dx = rest[0] - t.x, dy = rest[1] - t.y;
      const d = Math.hypot(dx, dy);
      if (d >= need) continue;
      const ux = d < 1e-6 ? 1 : dx / d, uy = d < 1e-6 ? 0 : dy / d;
      const cand = [t.x + ux * need, t.y + uy * need];
      const b2 = hole.bounds;
      if (cand[0] < b2.minX + EDGE_MARGIN_YD || cand[0] > b2.maxX - EDGE_MARGIN_YD) continue;
      if (cand[1] < b2.minY + EDGE_MARGIN_YD || cand[1] > b2.maxY - EDGE_MARGIN_YD) continue;
      const on = surfaceAt(hole, cand[0], cand[1]);
      if (on === 'water') continue;
      // ...and never at the cost of the drop rule: a penalty drop that got pushed back onto the
      // divot would be the softlock this file just fixed, wearing a tree.
      if (penalty && distYd(from, cand) < MIN_DROP_YD) continue;
      rest = cand;
      restOn = on;
      break;
    }
  }

  return {
    carry, apex, sideYd, aimRad, blocked, wind, penalty,
    landing, landedOn, rollYd, rest, restOn,
    holed: rolled.holed,
    travelledYd: distYd(from, rest),
    flightMs: flightMs(carry) * (blocked ? p : 1),
    // The ground phase is a real, watchable part of the shot, not a jump to the rest position.
    // Timed off the distance the ball ACTUALLY covered, not the nominal `rollYd`: on a sloped
    // green the run-out is integrated and a downhill one genuinely runs further, and `ui.js`
    // animates from `landing` to `rest`, so timing the nominal would race the ball across the
    // extra yards. On flat ground the two are the same number.
    rollMs: rollMs(distYd(landing, rest), landedOn),
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
 *  would lie about where 50 % goes, and a putting read that lies is worse than none.
 *
 *  **1.6 -> 2.0 on 2026-09-06, AND REVERTED THE SAME DAY.** The number is not free: the arc's
 *  25/50/75/100 ticks sit at `f ** (1/gamma)` of the sweep, so raising it pushes every tick further
 *  round and crowds all four into the top half of the dial. Matt, with a photo of it: *"You also
 *  fucked up the power/aim meter while putting BIG TIME. REVERT."* At 1.6 the ticks sit at
 *  43/65/85/100 % of the sweep; at 2.0 they sit at 50/71/87/100 and the 25 is past halfway round a
 *  dial that starts at zero.
 *
 *  The problem that prompted it is real and is STILL OPEN. Measured through the real resolver
 *  (holing, not the distance estimate in the table above):
 *
 *      2 ft putt   holes for 8.4-25.9 % of power   =  132-411 ms after the first tap
 *
 *  A second tap inside ~300 ms is a DOUBLE TAP - iOS reads it as select-a-word, which is the copy
 *  bar Matt reported - so a tap-in's window is not merely narrow, it is somewhere the OS steals the
 *  gesture. Two levers have now been tried and rejected: this curve (it moves the arc's labels) and
 *  a slower putter backswing (`clubs.js`, tempo is one speed for the whole bag, twice now). Whatever
 *  fixes it must leave BOTH the dial and the tempo alone. */
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
 *  **0.12 -> 0.45 on 2026-09-07, and the reason is the size of the hole.** At 0.12 a 20 ft putt
 *  across a half-strength slope broke 3.3 in - and THE CUP CAPTURES WITHIN 10.8 in of its centre.
 *  A break smaller than the capture radius cannot change an outcome, so the slope was decoration:
 *  measured over all eighteen Pine Valley greens, a putt aimed dead straight at the cup from 20 ft
 *  dropped **93 %** of the time, on greens whose arrows are drawn for the player to read. Matt,
 *  told that number: *"make the break NOT decoration."*
 *
 *      K       half slope @ 20 ft   full slope @ 20 ft   straight-aim makes
 *      0.12          3.3 in               6.8 in               93 %
 *      0.30          8.9 in              20.4 in               61 %
 *      0.45         15.1 in              31.6 in               43 %
 *      0.60         20.4 in              44.4 in               30 %
 *
 *  0.45 is the first value where a half-slope putt breaks further than the cup can reach for it
 *  (15.1 in against 10.8), which is the whole property being bought: on a sloped green you now
 *  have to aim outside the hole. It is not a difficulty knob picked by feel - one notch lower and
 *  the arrows still mean nothing on the flatter greens.
 *
 *  Because the break is integrated the whole way down rather than applied as a formula at the end,
 *  a putt that dies at the hole bends MORE than one struck firm. That is correct golf and it costs
 *  nothing to get right. */
/** 0.45 -> 0.90 ON 2026-09-08. Matt, after playing Pine Valley: *"I don't think any of the slopes
 *  on the green are real. The ball seems to always go straight."*
 *
 *  He is right, and the number that proves it is not the bend, it is the MAKE RATE. Struck
 *  perfectly and aimed DEAD STRAIGHT at the cup from 15-30 ft - no break read at all - on Pine
 *  Valley's own greens:
 *
 *      hole            1     2     3     4     6     7     8    12    16    17
 *      BREAK_K 0.45   70 %  67 %  67 %  88 %  100 % 17 %  28 %  94 %   5 %   0 %
 *      BREAK_K 0.90   31 %  28 %  30 %  47 %  100 %  2 %  16 %  44 %   0 %   0 %
 *
 *  On the opening holes - the ones a player meets first, and the ones Matt played through - aiming
 *  straight at the hole was the right play two times in three. That is a green whose arrows are
 *  decoration, which is exactly the complaint, and it is the same complaint that took this constant
 *  from 0.12 to 0.45 on 2026-09-07: that pass fixed the HARD greens and left the easy ones.
 *
 *  Hole 6 stays at 100 % at every value, and that is correct - it is the one deliberately FLAT
 *  green on the property (golf/CLAUDE.md, "The front nine"). A course needs one hole that asks
 *  nothing of the read.
 *
 *  WHAT IT IS WORTH TO READ THE BREAK, measured over 40 rounds with a player who reads it perfectly
 *  against the same player aiming straight: **0.6 strokes at 0.45, 2.4 strokes at 0.90.** Before
 *  this the slope grids were worth about half a stroke a round.
 *
 *  A SHORT PUTT IS UNCHANGED, because break grows with the square of the distance: at 3 ft it is
 *  under an inch either way, and every number in section 17 holds. */
export const BREAK_K = 0.90;

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

/** HOW FAR PAST THE HOLE A BALL MAY STILL BE RUNNING AND STILL DROP, in feet.
 *
 *  **4.0 ft -> 8.0 ft on 2026-09-08.** Matt, from a playtest, with the screen in front of him:
 *  a 45.2 ft putt on Pine Valley 3 *"went over the hole and ended up here, 6.8 ft away. It should
 *  have gone in."*
 *
 *  Reproduced exactly: that putt is 94 % of the meter, the ball crossed the cup and finished
 *  6.8 ft past, and the 4.0 ft tolerance rejected it. The make window on that putt ran 85-91 % -
 *  **seven clicks of ninety-nine** - and the click immediately above it was a miss with nothing
 *  to show for a stroke that was on line and barely firm.
 *
 *  4.0 ft is the realistic number (a real cup stops holding a ball somewhere around there), and
 *  that is exactly why it was wrong here: the player is not rolling a ball, they are stopping a
 *  meter with a thumb. Measured make rate over the whole meter, aimed straight at the pin on
 *  Pine Valley 3, before -> after:
 *
 *    20 ft   9 % -> 14 %      30 ft   8 % -> 13 %      45 ft   7 % -> 11 %
 *
 *  Matt chose 8 ft from a table of 4/7/8/12 (12 ft made pace stop mattering at all on a long putt;
 *  he did not want that). **THE SPEED IS DERIVED FROM IT, NEVER TYPED** - `v^2 = 2 a d` against
 *  the putting deceleration, so the pair can never drift apart and the comment can never go stale.
 *
 *  THE OTHER TWO WAYS TO MISS ARE UNTOUCHED: a putt left short still never reaches the cup, and
 *  the line still has to be right. This only widens the over-hit side. Inside the first red dot
 *  there is no speed limit at all (`puttGimmeFt` below), and that rule is unchanged. */
export const CUP_PAST_FT = 8;
export const CUP_MAX_SPEED = Math.sqrt(2 * PUTT_DECEL * (CUP_PAST_FT / FT_PER_YD));

/** INSIDE THE FIRST RED DOT, A PUTT OVER THE HOLE IS IN, AT ANY PACE (Matt, 2026-09-07).
 *
 *  *"make it so putts within the 25% first red dot distance cannot go over the hole. ANY putt
 *  within that distance that goes over the hole counts."*
 *
 *  THE DISTANCE IS THE LADDER'S OWN FIRST DOT, DERIVED AND NOT TYPED. `render.js` draws the putt
 *  ladder at `[0.25, 0.5, 0.75, 1.0]` of `puttRangeFt()`, so dot 1 is a quarter of the putter's
 *  range - 15 ft against the fixed 60. Writing `15` here would be a second copy of a number the
 *  painter owns, and the two would drift the first time the range moved.
 *
 *  WHAT IT ACTUALLY CHANGES, measured: the speed gate rejects a putt that would run more than
 *  `CUP_PAST_FT` PAST the cup (`CUP_MAX_SPEED^2 / 2 PUTT_DECEL`, 8.0 ft since 2026-09-08). From
 *  2 ft that was any strike over 23.7 % of the meter against a target of 11.9 % - double the
 *  intended power, which is an ordinary over-hit - and the ball ran over the top and stayed out.
 *  Inside the first dot it drops instead, at any pace.
 *
 *  IT DOES NOT MAKE A SHORT PUTT FREE, and that is worth being straight about: a putt left SHORT
 *  never reaches the cup, so it still misses, and the LINE still has to be right. What it does is
 *  make "hit it firmly" the correct and learnable play on a short putt, which is real golf's own
 *  never-up-never-in - and before this, hitting it firmly was punished. */
export function puttGimmeFt() { return puttRangeFt() * 0.25; }

/** Does a ball passing this point, at this speed, drop? Close enough AND slow enough.
 *
 *  `maxSpeed` is the pace it may be doing and still drop; `simulatePutt` passes `Infinity` for a
 *  putt struck from inside `puttGimmeFt()`. Every other caller gets `CUP_MAX_SPEED`, so a wood
 *  running over the hole at pace still stays out - that rule is Matt's too and is unchanged. */
export function cupCheck(hole, x, y, speed, maxSpeed = CUP_MAX_SPEED) {
  return Math.hypot(x - hole.pin[0], y - hole.pin[1]) <= CUP_CAPTURE_YD && speed <= maxSpeed;
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

  // ============================================================================================
  // THE RUN-OUT IS ON THE GROUND, SO IT MEETS WHAT IS ON THE GROUND (2026-09-07, Red Mesa).
  //
  // This used to be a bare straight line that consulted nothing but the cup, and three things
  // fell out of that - all three measured on Red Mesa, a course whose whole identity is that a
  // boulder "blocks at any height, from any club":
  //
  //   1. 1.4 % of tee shots ROLLED STRAIGHT THROUGH A TRUNK. A 3 wood on hole 12 ran 31 yds and
  //      passed through a boulder after 7 of them.
  //   2. A drive on hole 13 pitching short of the gorge ran 33 yds ACROSS THE WATER and finished
  //      dry in the bunker beyond, with no penalty.
  //   3. THE GREEN'S SLOPE DID NOTHING TO IT. Red Mesa says out loud that four of its greens
  //      "crown in the middle, so a ball that lands anywhere but the plateau runs off it into
  //      one". Not one of them did anything at all: a ball pitching five yards from the pin and
  //      running four ran dead straight on all eight of that course's crown and steep greens. The
  //      slope decided how a PUTT behaved and had no effect whatever on the shot that arrived.
  //
  // The walk is stepped by DISTANCE and carries v SQUARED, which is what keeps it cheap enough to
  // run inside a tap handler: `d(v^2)/dd = -2a` is exact for constant deceleration, so on flat
  // ground the ball stops at exactly `rollYd` and every roll distance Matt calibrated off the
  // reference is reproduced to the yard (driver 38.7 nominal, 38.7 actual). The slope adds its own
  // ALONG component to that same expression - a downhill run-out really does run further, which is
  // the half of a crown that repels a ball - and turns the direction by its ACROSS one, using
  // `BREAK_K`, the putt's own constant, so a ball trickling the last few feet of a run-out bends
  // by exactly as much as a putt of that length would. That is the same argument this function was
  // written on: one physics model, so "a 3 wood can be holed" needs no second one.
  //
  // Off the green the gradient is zero and this is the straight line it always was. Measured cost:
  // 3.6 -> 5.7 ms per shot, well inside a frame.
  // ============================================================================================
  const near = [];
  for (const t of treesOf(hole)) {
    const ty = hole.treeTypes[t.type];
    if (!ty) continue;
    const r = ty.trunk * (t.s || 1);
    if (Math.hypot(t.x - start[0], t.y - start[1]) <= rollYd + r + 1) near.push({ t, r });
  }
  const gb = greenBox(hole);
  let x = start[0];
  let y = start[1];
  let dx = sin;
  let dy = cos;
  let v2 = v0 * v0;
  let travelled = 0;
  for (let i = 1; i <= steps + 1200; i++) {
    if (v2 <= 0) break;
    const speed = Math.sqrt(v2);
    if (cupCheck(hole, x, y, speed)) return { rest: [x, y], holed: true };
    // Only inside the green's own bounding box can the ground be anything but flat.
    if (x >= gb.minX && x <= gb.maxX && y >= gb.minY && y <= gb.maxY) {
      const g = slopeAt(hole, x, y);
      if (g[0] || g[1]) {
        const along = g[0] * dx + g[1] * dy;
        v2 += 2 * BREAK_K * along * STEP;
        if (v2 <= 0) break;
        const perpX = dy;                              // right of the direction of travel
        const perpY = -dx;
        const across = g[0] * perpX + g[1] * perpY;
        const dTheta = (BREAK_K * across * STEP) / Math.max(0.25, v2);
        const nx = dx + perpX * dTheta;
        const ny = dy + perpY * dTheta;
        const n = Math.hypot(nx, ny) || 1;
        dx = nx / n; dy = ny / n;
      }
    }
    v2 -= 2 * PUTT_DECEL * STEP;
    x += dx * STEP;
    y += dy * STEP;
    travelled += STEP;
    // A trunk stops it dead, short of the wood so the next shot does not start inside it. Checked
    // every fourth step: the narrowest trunk in either course is 0.6 yds across and STEP is 0.05.
    if ((i & 3) === 0) {
      for (const n of near) {
        if (Math.hypot(x - n.t.x, y - n.t.y) <= n.r) {
          const back = Math.max(0, travelled - (n.r + 0.6));
          return { rest: [start[0] + dx * back, start[1] + dy * back], holed: false };
        }
      }
      // And water stops it where it went in; `resolveShot`'s own drop rule takes it from there.
      // `surfaceAt` walks every surface of the hole, which is the expensive call in this loop, so
      // the water polygons are asked directly and a bounding box rejects almost every sample.
      if (isWater(hole, x, y)) return { rest: [x, y], holed: false };
    }
  }
  return { rest: [x, y], holed: false };
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

  // INSIDE THE FIRST RED DOT THERE IS NO SPEED LIMIT ON THE CUP (Matt, 2026-09-07): "ANY putt
  // within that distance that goes over the hole counts." See `puttGimmeFt` above. It is measured
  // from where the putt is STRUCK, not from where the ball happens to be as it arrives - every
  // putt is inside the cup's own radius by then, so the arrival distance would exempt all of them.
  const maxSpeed = distYd(from, hole.pin) * FT_PER_YD <= puttGimmeFt() ? Infinity : CUP_MAX_SPEED;

  // A ball already sitting over the cup is in. Checked BEFORE the speed break below, because a
  // putt with exactly enough pace to reach the hole and die there would otherwise stop on the lip
  // and be recorded as a miss - "as long as it goes over the hole at a reasonable speed" includes
  // stopping on it.
  if (cupCheck(hole, x, y, 0)) return { path, rest: [x, y], holed: true, ms: 0, restOn: 'green' };

  while (t < MAX_T) {
    v = Math.hypot(vx, vy);
    if (cupCheck(hole, x, y, v, maxSpeed)) { holed = true; break; }
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

    // The same test again at the END of the step, so a cup entered between two samples is not
    // missed. It goes through `cupCheck` rather than repeating its arithmetic: the two used to be
    // separate copies, and a rule added to one of them (the gimme above) would have applied on
    // half the frames.
    if (cupCheck(hole, x, y, Math.hypot(vx, vy), maxSpeed)) { holed = true; break; }
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
/** THE LADDER IS THE CLUB'S, AND IT NEVER MOVES (2026-09-06).
 *
 *  It used to be `club.carry * lieOf(lieKind).power`, so the whole ruler shrank to 82 % out of
 *  heavy rough. Matt: *"The power/aim line should never change. It should always be the same
 *  distance with the same spacing for the same club always... The game can't adjust and tell
 *  someone exactly how hard to swing. It's a game. you have to learn and get better at it."*
 *
 *  He is overruling the rationale this line shipped with - "the ladder re-scales for a bad lie, so
 *  it never lies about where a perfect strike lands" - and he is right that it was doing the
 *  player's thinking for them. A 7 iron's dots are a 7 iron's dots from anywhere; the lie's cost is
 *  shown honestly by the `Power: 82%` readout above the tile, and learning what that means from a
 *  given lie is the skill. Written down so the next session does not "fix" it back. */
export function aimDots(club, lieKind) {          // eslint-disable-line no-unused-vars
  if (!club || club.id === 'putter') return [];
  const reach = club.carry;
  return [0.25, 0.5, 0.75, 1.0, RISK_FRACTION].map((f) => ({ at: reach * f, risk: f > 1 }));
}
export const RISK_FRACTION = 1.10;

export { CLUBS };
