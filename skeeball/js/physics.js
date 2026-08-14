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

  // The feel lives HERE and in boards.js's geom - nowhere else. Wall friction is deliberately
  // NEAR ZERO: the ring and collars are slick painted steel, and low lateral grip is what makes
  // a ball resting against the band on the slope always slide around it and roll out - the
  // termination guarantee is physics, not a watchdog. (0.16 was enough grip to park a ball
  // against the band's up-slope face in a three-contact wedge. Real rings don't hold balls.)
  world.addContactMaterial(new CANNON.ContactMaterial(matBall, matWood, { friction: 0.3, restitution: 0.28 }));
  // Board restitution is the knob that decides whether skeeball is LEARNABLE: a livelier board
  // makes the carom, not the landing, choose the cup, and the straight-power ladder stops being
  // monotonic (0.35 landed the 40 while 0.45 landed the 30 - the sweep caught it). A real wooden
  // board is not bouncy; keep this low.
  world.addContactMaterial(new CANNON.ContactMaterial(matBall, matBoard, { friction: 0.34, restitution: 0.26 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matBall, matWall, { friction: 0.04, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matBall, matDead, { friction: 0.2, restitution: 0.18 }));

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

  const p = Math.max(0, Math.min(1, power));
  const speed = G.minSpeed + p * (G.maxSpeed - G.minSpeed);
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
  if (f.v > 0 && f.v < G.boardLen && f.h < G.ballR * 1.9) {
    for (const id of Object.keys(G.holes)) {
      const hDef = G.holes[id];
      const d = Math.hypot(f.u - hDef.u, f.v - hDef.v);
      if (d < hDef.r - G.ballR * 0.28) {
        st.captured = id;
        st.capturedFaceY = p.y;
        ball.collisionFilterMask = GROUP_REST;   // the slab lets go; gravity does the rest
        st.events.push({ type: 'capture', hole: id, value: hDef.value, pos: { x: p.x, y: p.y, z: p.z } });
        return;
      }
    }
  }

  // 3. The trough: where short lobs die and where the board's bottom edge feeds every spent
  //    ball. Centre band = the 10 slot, corners = the 0s, never-touched-the-board = plain 0.
  //    (p.y < -0.3 is the belt-and-braces catch: geometry should make it unreachable, but a
  //    ball that somehow leaves the world must still resolve, not fall forever.)
  const inTrough = p.z > st.M.troughZ[0] - 0.24 && p.z < st.M.troughZ[1] + 0.02 && p.y < M.troughY + G.ballR + 0.03;
  if (inTrough || p.y < -0.3) {
    if (st.troughAt < 0) st.troughAt = st.t;
    const speed = ball.velocity.length();
    if (speed < 0.55 || st.t - st.troughAt > 1.6 || p.y < -0.3) {
      // Score by WHERE the ball lies, exactly like the real slot: the centre band feeds the 10,
      // only the corners are the 0s. (No touched-the-board test: on a real machine a lob that
      // dies short rolls into the 10 slot too - the honest zero is the corner, not the lob.)
      if (Math.abs(p.x) <= G.troughTenHalfW) {
        st.events.push({ type: 'capture', hole: 'h10', value: 10, pos: { x: p.x, y: p.y, z: p.z } });
        finishAt(st, 'h10', 10, 'hole');
      } else finishAt(st, 'corner0', 0, 'gutter');
      return;
    }
  } else st.troughAt = -1;

  // 4. Rolled back home: the hump kept the ball. Not spent; the player just gets it back.
  if (p.z > -0.04 && ball.velocity.z > 0.05 && st.t > 0.4) {
    st.outcome = null;
    st.done = true;
    st.events.push({ type: 'returned' });
    return;
  }

  // 5. The dish. The real board's lower bowl is dished, so a slow ball inside the big ring
  //    always curls around the furniture and finds the 20. Our face is a flat slab, so the dish
  //    is applied as the force it exerts: a gentle, constant pull toward the 20's mouth, only
  //    for slow balls on the face inside the ring. Fast rattles are untouched - steering those
  //    is exactly the "told to react" look this rebuild exists to kill.
  const dRing = Math.hypot(f.u - G.ring.u, f.v - G.ring.v);
  const onFace = f.h < G.ballR * 1.6 && f.v > 0 && f.v < G.boardLen;
  if (onFace && dRing < G.ring.R - G.ballR * 0.5 && ball.velocity.length() < 1.2) {
    const du = G.holes.h20.u - f.u;
    const dv = G.holes.h20.v - f.v;
    const dd = Math.hypot(du, dv) || 1;
    const a = 1.5 * H;
    ball.velocity.x += (du / dd) * a;
    ball.velocity.y += (dv / dd) * a * Math.sin(M.tilt);
    ball.velocity.z += (dv / dd) * a * -Math.cos(M.tilt);
  }

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
