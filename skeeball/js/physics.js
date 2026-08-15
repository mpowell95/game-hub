// skeeball/js/physics.js - the ball, simulated by cannon-es (skeeball/js/vendor/cannon-es.js, a
// battle-tested rigid-body engine; vendored 2026-08-13 on Matt's instruction after three rounds
// of hand-rolled collision code kept failing his eye test: "you can clearly tell it's being told
// to react a certain way"). Nothing here scripts a reaction any more. The machine is real
// geometry (machine.js), the ball is a real rigid sphere with mass, spin and contact friction,
// and rolling, hops, rim rattles and backboard bounces are all whatever the contact solver says.
//
// The ONE non-engine rule left is hole capture, and it is the same rule a real hole enforces:
// when the ball's centre is over an opening, the floor under it is gone. We implement exactly
// that - the ball's collision mask drops the board slab and GRAVITY takes it through the mouth,
// still colliding with the cup's collar on the way down. No teleport, no canned sink.
//
// Same public surface the old engine had, so game.js is untouched:
//   startThrow(board, {power, aim}) -> st      step(board, st, dt)
//   takeEvents(st) -> [...]                     st.outcome = {hole, value} | null
//   simulateThrow(board, params) for the tests. Deterministic: no rng anywhere, fixed timestep,
//   fixed solver iterations, naive broadphase (stable pair order).

import * as CANNON from './vendor/cannon-es.js';
import { buildMachine } from './machine.js';

const H = 1 / 240;               // fixed physics step; flight and thin collars need the rate
const MAX_T = 12;                // emergency settle cap; the tests assert it never fires
export const STEP = H;           // exposed for the headless tests' update loops

const GROUP_BALL = 1;
const GROUP_FLOOR = 2;           // the board slab only - what capture removes from under the ball
const GROUP_REST = 4;            // everything else: lane, hump, trough, collars, band, walls

// Machine descriptions are pure per-board data; build each once.
const machines = new Map();
function machineFor(board) {
  let m = machines.get(board.id);
  if (!m) { m = buildMachine(board.geom); machines.set(board.id, m); }
  return m;
}

/** One throw = one fresh world (cheap: ~150 static boxes) so every throw is a clean determinism
 *  boundary - nothing persists from the previous ball. */
function buildWorld(board) {
  const G = board.geom;
  const M = machineFor(board);
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.allowSleep = false;
  world.solver.iterations = 10;

  const matBall = new CANNON.Material('ball');
  const matWood = new CANNON.Material('wood');     // lane + hump: varnished, low bounce
  const matBoard = new CANNON.Material('board');   // the face: livelier
  const matWall = new CANNON.Material('wall');     // collars, band, rails: slick painted steel
  const matDead = new CANNON.Material('dead');     // backboard + kick: padded, kills the ball

  // The feel lives HERE and in boards.js's geom - nowhere else. Every number below is a DEFAULT
  // that a board's `geom.mat` block may override, so a tuning sweep can search the contact
  // model without editing this file.
  //
  // Wall friction is deliberately NEAR ZERO: the ring and collars are slick painted steel, and
  // low lateral grip is what makes a ball resting against the band on the slope always slide
  // around it and roll out - the termination guarantee is physics, not a watchdog. (0.16 was
  // enough grip to park a ball against the band's up-slope face in a three-contact wedge. Real
  // rings don't hold balls.)
  //
  // BOARD restitution and friction are what decide whether skeeball is LEARNABLE, and
  // 2026-08-14 measured how much. At restitution 0.26 the ball bounced off the face instead of
  // settling onto it, so a carom chose the cup and the straight-power ladder was noise: 43 of
  // 100 adjacent 0.01 power steps flipped the outcome and 30 of 44 bands were one step wide.
  // A ball that LANDS and then ROLLS makes distance up the slope a smooth function of arrival
  // speed, which is the entire game. Friction is high for the same reason: the face has to grab
  // the ball into a roll on contact rather than let it skid on.
  const MAT = G.mat || {};
  const pick = (v, dflt) => (typeof v === 'number' ? v : dflt);
  const contact = (a, b, friction, restitution) => world.addContactMaterial(
    new CANNON.ContactMaterial(a, b, { friction, restitution }));
  contact(matBall, matWood, pick(MAT.woodFric, 0.30), pick(MAT.woodRest, 0.22));
  contact(matBall, matBoard, pick(MAT.boardFric, 0.62), pick(MAT.boardRest, 0.08));
  contact(matBall, matWall, pick(MAT.wallFric, 0.04), pick(MAT.wallRest, 0.50));
  contact(matBall, matDead, pick(MAT.deadFric, 0.20), pick(MAT.deadRest, 0.12));

  for (const s of M.solids) {
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(s.half[0], s.half[1], s.half[2])),
      material: s.part === 'lane' || s.part === 'hump' ? matWood
        : s.part === 'board' || s.part === 'trough' ? matBoard
          : s.part === 'backboard' || s.part === 'kick' || s.part === 'keep' || s.part === 'cage' || s.part === 'glass' ? matDead : matWall,
      collisionFilterGroup: s.part === 'board' ? GROUP_FLOOR : GROUP_REST,
      collisionFilterMask: GROUP_BALL,
    });
    body.position.set(s.pos[0], s.pos[1], s.pos[2]);
    if (s.rot) body.quaternion.setFromAxisAngle(new CANNON.Vec3(...s.rot.axis), s.rot.angle);
    else if (s.faceRot) {
      const qx = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), s.faceRot.tilt);
      const qy = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), s.faceRot.phi);
      body.quaternion = qx.mult(qy);
    }
    body.userData = { part: s.part, cup: s.cup || null };
    world.addBody(body);
  }

  const ball = new CANNON.Body({
    mass: G.ballMass,
    shape: new CANNON.Sphere(G.ballR),
    material: matBall,
    linearDamping: 0.006,
    angularDamping: 0.015,
    collisionFilterGroup: GROUP_BALL,
    collisionFilterMask: GROUP_FLOOR | GROUP_REST,
    // Never let the engine put the ball to sleep: a slope roll can dip under the sleep speed
    // limit at its apex, and a sleeping body ignores gravity AND the watchdog's velocity pops.
    allowSleep: false,
  });
  world.addBody(ball);
  return { world, ball, M };
}

/** World position -> face coordinates {u, v, h} (machine.js documents the basis). */
function worldToFace(M, G, p) {
  const dy = p.y - M.lipY;
  const dz = p.z - M.lipZ;
  const sin = Math.sin(M.tilt);
  const cos = Math.cos(M.tilt);
  return { u: p.x, v: dy * sin - dz * cos, h: dy * cos + dz * sin };
}

export function startThrow(board, { power = 0.5, aim = 0 } = {}) {
  const G = board.geom;
  const { world, ball, M } = buildWorld(board);

  // POWER IS NOT CLAMPED TO 0..1 (2026-08-14). 0 and 1 are the ends of the NATURAL swipe range,
  // not the ends of what is physically possible. Matt: *"An unnaturally fast one should be able
  // to hit like way higher up on the wall and an unnaturally slower one should be short of the
  // board for a 0 or roll back."* Clamping here made every over-hard flick identical to a normal
  // hard one and every feather-touch identical to a slow one, so the two most obvious things a
  // player tries both did nothing.
  //
  // THERE IS NO UPPER BOUND. Matt: *"there should be no limit on how high i can throw the ball.
  // If a swipe as hard as i can, the ball should launch like crazy high over the machine or
  // something."* So a 2.0 ceiling came out - swipe hard enough and the ball leaves the machine,
  // arcs over the back and resolves as the zero it deserves. The only remaining bound is at the
  // bottom, and it exists so the square root below cannot take a negative argument.
  const p = Math.max(-0.75, power);
  // Power is spent as ENERGY, not as speed (2026-08-14). How far a ball rolls up the face goes
  // as the SQUARE of how fast it gets there, so a power dial that mapped linearly onto speed
  // mapped quadratically onto the thing the player is actually aiming with: the bottom of the
  // dial did almost nothing and the top of it did everything, which is half of why the ladder
  // had a 25-step dead zone at the soft end. Interpolating v^2 instead makes travel up the
  // board very nearly linear in the swipe, so the bands come out even. This is the CONTROL
  // CURVE - what the dial means - not a force on the ball; nothing here touches the ball once
  // it is rolling.
  const s0 = G.minSpeed;
  const s1 = G.maxSpeed;
  // Extrapolates outside 0..1 by the same rule it interpolates inside it, so a swipe past either
  // end of the natural range keeps behaving like a swipe. `max(0.4, ...)` only guards the square
  // root against a negative argument at the very bottom.
  const speed = Math.sqrt(Math.max(0.4, s0 * s0 + p * (s1 * s1 - s0 * s0)));
  const a = Math.max(-1, Math.min(1, aim)) * G.aimMax;
  ball.position.set(0, G.ballR, -0.12);
  ball.velocity.set(Math.sin(a) * speed, 0, -Math.cos(a) * speed);
  // Served rolling, not skidding: contact-point velocity zero on the lane bed.
  ball.angularVelocity.set(-speed / G.ballR, 0, 0);

  const st = {
    world, ball, M, G,
    t: 0,
    acc: 0,
    events: [{ type: 'launch' }],
    outcome: null,
    done: false,
    captured: null,           // hole id once the mouth has the ball
    capturedFaceY: 0,
    touchedBoard: false,
    bounces: 0,
    airborne: false,
    // The displacement-anchored stall watchdog (speed thresholds are jitter-blind - the pinball
    // lesson survives the engine swap).
    anchor: { x: 0, y: 0, z: 0, t: 0 },
    nudges: 0,
    emergencyUsed: false,
    troughAt: -1,
    // `restAt` lived here until batch 3f removed the resting-position rule that read it.
  };

  ball.addEventListener('collide', (e) => {
    const part = e.body.userData && e.body.userData.part;
    const vn = e.contact ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 0;
    if (part === 'board') {
      if (!st.touchedBoard) { st.touchedBoard = true; st.events.push({ type: 'impact', speed: vn }); }
      if (vn > 0.5) { st.bounces += 1; st.events.push({ type: 'bounce', speed: vn }); }
    } else if (part === 'backboard' && vn > 0.4) {
      st.events.push({ type: 'backboard', speed: vn });
    }
  });

  return st;
}

function finishAt(st, hole, value, kind) {
  st.outcome = { hole, value: value | 0 };
  st.done = true;
  if (kind === 'gutter') st.events.push({ type: 'gutter' });
  st.events.push({ type: 'done' });
}

function substep(st) {
  const { world, ball, M, G } = st;
  world.step(H);
  st.t += H;
  const p = ball.position;

  // 1. Captured: the floor is gone under the mouth; ride gravity down through it.
  if (st.captured) {
    if (p.y < st.capturedFaceY - 0.26 || st.t > MAX_T) {
      const hDef = G.holes[st.captured];
      finishAt(st, st.captured, hDef.value, 'hole');
    }
    return;
  }

  const f = worldToFace(M, G, p);

  // 2. The mouths. Centre over an opening while at face level = the floor stops holding you -
  //    exactly what a hole is. The collar keeps collisions, so the drop stays guided and visible.
  //
  //    ...but only if the ball can ACTUALLY FALL IN, which is the rule this board is built on
  //    (2026-08-14). A ball rolling up the face crosses every lower mouth on its way to a higher
  //    one, and the old test - centre over the opening, full stop - meant the first mouth always
  //    swallowed it. Nothing above the bottom cup was reachable by rolling, which is why the
  //    shipped build could only score by lobbing balls in out of the air.
  //
  //    So ask the question a real hole asks: in the time this ball takes to cross the mouth,
  //    does it drop far enough to be past the lip? Its own inward velocity counts, so a ball
  //    dropping into a cup goes in even at speed, while a fast roll skims across and carries on
  //    UNCHANGED - it is not deflected, slowed or steered, it simply is not caught. That single
  //    test is what makes distance up the slope choose the cup, and it is pure kinematics: no
  //    magnetism, no assist, no correction (see the deleted section 5 below).
  const vel = ball.velocity;
  const sinT = Math.sin(M.tilt);
  const cosT = Math.cos(M.tilt);
  // the same linear map worldToFace applies to positions, applied to the velocity
  const vFace = Math.hypot(vel.x, vel.y * sinT - vel.z * cosT);
  const hDot = vel.y * cosT + vel.z * sinT;          // + = away from the face, - = into it
  const gPerp = 9.82 * cosT;                          // gravity's pull perpendicular to the face
  const need = G.ballR * (typeof G.captureDrop === 'number' ? G.captureDrop : 0.55);
  // time to fall `need` given the current inward speed: 0.5*gPerp*t^2 - hDot*t - need = 0
  const tDrop = (hDot + Math.sqrt(hDot * hDot + 2 * gPerp * need)) / gPerp;
  if (f.v > 0 && f.v < G.boardLen && f.h < G.ballR * 1.9) {
    for (const id of Object.keys(G.holes)) {
      const hDef = G.holes[id];
      const d = Math.hypot(f.u - hDef.u, f.v - hDef.v);
      const rEff = hDef.r - G.ballR * 0.28;
      if (d >= rEff) continue;
      // how much mouth is left in front of it, along its own line
      const cross = rEff + Math.sqrt(Math.max(0, rEff * rEff - d * d));
      if (vFace * tDrop > cross) continue;            // too fast for this mouth: it rolls on
      st.captured = id;
      st.capturedFaceY = p.y;
      ball.collisionFilterMask = GROUP_REST;   // the slab lets go; gravity does the rest
      st.events.push({ type: 'capture', hole: id, value: hDef.value, pos: { x: p.x, y: p.y, z: p.z } });
      return;
    }
  }

  // 3. The trough: where a short throw dies, and where the board's bottom edge feeds every ball
  //    that ran out of steam and came back down. IT IS WORTH NOTHING. Matt, 2026-08-15: *"it
  //    should be 0 points if the ball falls below the 10 ring into the nothing area. I'm getting
  //    10 points for that in my tests."*
  //
  //    It used to pay 10 across a centre band (`troughTenHalfW`) and 0 only in the corners, which
  //    was right when the 10 WAS this slot - the bottom-of-the-board catcher, exactly like a real
  //    cabinet's. It is not that any more: batch 3b made the 10 a real hole up on the face with
  //    its own ring, and batch 3f made falling through a hole the only way to score. A ball down
  //    here has missed every hole there is, including the 10, so paying it the 10's value both
  //    contradicts the rule and hands out the game's floor score for the game's worst throw.
  //
  //    (p.y < -0.3 is the belt-and-braces catch: geometry should make it unreachable, but a ball
  //    that somehow leaves the world must still resolve, not fall forever.)
  const inTrough = p.z > st.M.troughZ[0] - 0.24 && p.z < st.M.troughZ[1] + 0.02 && p.y < M.troughY + G.ballR + 0.03;
  if (inTrough || p.y < -0.3) {
    if (st.troughAt < 0) st.troughAt = st.t;
    const speed = ball.velocity.length();
    if (speed < 0.55 || st.t - st.troughAt > 1.6 || p.y < -0.3) {
      // `corner0` is kept as the id, not renamed: it is written into the mid-rack autosave and
      // old keys are never repurposed (THE LAW rule 5). It now covers the whole trough, not just
      // its corners.
      finishAt(st, 'corner0', 0, 'gutter');
      return;
    }
  } else st.troughAt = -1;

  // 3b. THE RESTING-POSITION RULE IS GONE (batch 3f, 2026-08-14). There is no section here on
  //     purpose, and putting one back would undo the whole point of batches 3b-3f.
  //
  //     It used to say: a ball that comes to rest ON THE FACE scores by where it stopped - inside
  //     the big circle 20, anywhere else 10. That was the right answer for the board it was
  //     written for, where the rings were flat paint and nothing stood up off the face, so a ball
  //     that stopped on the board had no other way to resolve.
  //
  //     This board is different. Every ring is a wall x tall, and a hole is entered by arcing
  //     over that wall and dropping in. Matt: "Scoring is by falling through a hole. The
  //     resting-position rule comes out." So the ONLY way to score a hole's value is section 2's
  //     capture - actually falling through the mouth.
  //
  //     A ball that does not fall in is not scored here at all. It is left alone, and on a face
  //     tilted 45 degrees it does what it does on a real machine: rolls back down, off the bottom
  //     edge, into the trough, where section 3 above scores it 10 in the centre band or 0 in a
  //     corner. That is the honest floor, and it is a REAL outcome the ball earned rather than a
  //     consolation the code handed it. The watchdog covers the rare ball that parks.
  //
  //     The removed block also carried the last reader of `st.restAt`, so that field went with it.

  // 4. Rolled back home: the hump kept the ball. Not spent; the player just gets it back.
  if (p.z > -0.04 && ball.velocity.z > 0.05 && st.t > 0.4) {
    st.outcome = null;
    st.done = true;
    st.events.push({ type: 'returned' });
    return;
  }

  // 5. (was "the dish": a constant pull toward the 20's mouth for slow balls inside the ring.
  //    DELETED 2026-08-14 and never to return. It was magnetism - a ball being steered into a
  //    hole it was not thrown at - which is a standing, permanent ban on this game. A ball that
  //    runs out of speed on the slope now does the honest thing: gravity takes it back down the
  //    face and it feeds the 10 slot at the bottom, exactly like the real machine. If a power
  //    band needs widening, widen it in the GEOMETRY, never by moving the ball.)

  // 6. The watchdog: anchored displacement, never speed (jitter fools speed). A parked ball
  //    gets popped off the face like the chatter that frees a real ball; a ball a pop cannot
  //    move is JAMMED (three contact normals can lock the solver completely - measured, not
  //    theory), and jams get walked out: a slow positional roll toward the nearest mouth until
  //    physics takes back over or the mouth captures it.
  if (st.walkout) {
    ball.velocity.set(0, 0, 0);
    ball.position.x += st.walkout.x * 0.0012;
    ball.position.y += st.walkout.y * 0.0012;
    ball.position.z += st.walkout.z * 0.0012;
    if (Math.hypot(p.x - st.anchor.x, p.y - st.anchor.y, p.z - st.anchor.z) > 0.06) st.walkout = null;
  }
  const moved = Math.hypot(p.x - st.anchor.x, p.y - st.anchor.y, p.z - st.anchor.z);
  if (moved > 0.03 && !st.walkout) st.anchor = { x: p.x, y: p.y, z: p.z, t: st.t };
  else if (!st.walkout && st.t - st.anchor.t > 0.9) {
    st.anchor = { x: p.x, y: p.y, z: p.z, t: st.t };
    st.nudges += 1;
    if (st.nudges <= 2) {
      const side = p.x >= 0 ? -1 : 1;
      ball.velocity.x += side * 0.3;
      ball.velocity.y += 0.55 * Math.cos(M.tilt);
      ball.velocity.z += 0.3 * Math.sin(M.tilt) + 0.15;
    } else {
      // Two pops did nothing: it is jammed. Aim the walk at the nearest mouth's centre.
      let best = null;
      for (const id of Object.keys(G.holes)) {
        const hDef = G.holes[id];
        const d = Math.hypot(f.u - hDef.u, f.v - hDef.v);
        if (!best || d < best.d) best = { id, d, hDef };
      }
      if (best) {
        const w1 = st.M.faceToWorld(best.hDef.u, best.hDef.v, G.ballR);
        const len = Math.hypot(w1[0] - p.x, w1[1] - p.y, w1[2] - p.z) || 1;
        st.walkout = { x: (w1[0] - p.x) / len, y: (w1[1] - p.y) / len, z: (w1[2] - p.z) / len };
        st.emergencyUsed = true;
      }
    }
  }

  // 7. The cap. Should be unreachable (tests assert it): score the ball where it stands.
  if (st.t > MAX_T) {
    st.emergencyUsed = true;
    let best = null;
    for (const id of Object.keys(G.holes)) {
      const hDef = G.holes[id];
      const d = Math.hypot(f.u - hDef.u, f.v - hDef.v);
      if (!best || d < best.d) best = { id, d, value: hDef.value };
    }
    if (f.v > 0 && best) finishAt(st, best.id, best.value, 'hole');
    else finishAt(st, 'gutter', 0, 'gutter');
  }
}

export function step(board, st, dt) {
  if (st.done) return;
  st.acc = Math.min(0.1, st.acc + dt);
  while (st.acc >= H && !st.done) {
    st.acc -= H;
    substep(st);
  }
}

export function takeEvents(st) {
  const out = st.events;
  st.events = [];
  return out;
}

/** Run one throw to its outcome without a clock. The tests' whole view of the machine. */
export function simulateThrow(board, params) {
  const st = startThrow(board, params);
  const events = [];
  let guard = Math.ceil((MAX_T + 2) / H);
  while (!st.done && guard-- > 0) {
    substep(st);
    if (st.events.length) { events.push(...st.events); st.events = []; }
  }
  return {
    outcome: st.outcome,
    time: st.t,
    bounces: st.bounces,
    touchedBoard: st.touchedBoard,
    emergencyUsed: st.emergencyUsed,
    events: events.map((e) => e.type),
  };
}

export default { startThrow, step, takeEvents, simulateThrow };
