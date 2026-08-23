// skeeball/js/physics.js - the ball, simulated by cannon-es (skeeball/js/vendor/cannon-es.js).
// GUARD: nothing here scripts a reaction. The machine is real geometry (machine.js), the ball is
// a real rigid sphere with mass, spin and contact friction, and rolling, hops, rim rattles and
// backboard bounces are all whatever the contact solver says. See DECISIONS.md#why-cannon-es.
//
// The ONE non-engine rule is hole capture, the same rule a real hole enforces: when the ball's
// centre is over an opening and slow enough, the floor under it is gone and GRAVITY takes it
// through the mouth. No teleport, no canned sink. See DECISIONS.md#hole-capture.
//
// Public surface: startThrow(board, {power, aim}) -> st, step(board, st, dt), takeEvents(st),
// simulateThrow(board, params) for tests. Deterministic: no rng, fixed timestep and solver
// iterations, naive broadphase (stable pair order).

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
  const matWall = new CANNON.Material('wall');     // side rails: slick, so a ball banks off them
  const matRing = new CANNON.Material('ring');     // the white plastic (PVC) rings: barely bounce
  const matDead = new CANNON.Material('dead');     // backboard + kick: padded, kills the ball
  // The two corner 100s get their OWN ring material so they can be deadened without touching the
  // 10 through 50. See the ring100Rest note in boards.js.
  const matRing100 = new CANNON.Material('ring100');

  // The feel lives HERE and in boards.js's geom - nowhere else. Every number below is a DEFAULT
  // that a board's `geom.mat` block may override, so a tuning sweep can search the contact
  // model without editing this file. GUARD: wall and ring friction stay NEAR ZERO - low lateral
  // grip is what makes a ball resting against a ring on the slope always slide off and roll out,
  // the termination guarantee is physics, not a watchdog. The board is deliberately low-bounce so
  // the ball LANDS and ROLLS rather than caroming unpredictably. See DECISIONS.md#contact-materials.
  const MAT = G.mat || {};
  const pick = (v, dflt) => (typeof v === 'number' ? v : dflt);
  const contact = (a, b, friction, restitution) => world.addContactMaterial(
    new CANNON.ContactMaterial(a, b, { friction, restitution }));
  contact(matBall, matWood, pick(MAT.woodFric, 0.30), pick(MAT.woodRest, 0.22));
  contact(matBall, matBoard, pick(MAT.boardFric, 0.62), pick(MAT.boardRest, 0.08));
  contact(matBall, matWall, pick(MAT.wallFric, 0.04), pick(MAT.wallRest, 0.50));
  // GUARD: the rings are PVC, not steel - a ball that clips a rim loses its energy and drops or
  // dribbles down rather than bouncing across ring tops and back out. Low restitution kills the
  // bounce; friction stays low so a ball never wedges against a ring.
  contact(matBall, matRing, pick(MAT.ringFric, 0.06), pick(MAT.ringRest, 0.18));
  contact(matBall, matRing100, pick(MAT.ring100Fric, 0.06), pick(MAT.ring100Rest, 0.18));
  contact(matBall, matDead, pick(MAT.deadFric, 0.20), pick(MAT.deadRest, 0.12));

  for (const s of M.solids) {
    // A 'prism' carries its own world-space vertices (a convex polyhedron); everything else is a
    // box at s.pos/s.rot. The triangular wedge above the 50 (machine.js) is the only prism.
    const shape = s.shape === 'prism'
      ? new CANNON.ConvexPolyhedron({
        vertices: s.verts.map((p) => new CANNON.Vec3(p[0], p[1], p[2])),
        faces: [[0, 2, 1], [3, 5, 4], [0, 3, 4, 1], [1, 2, 5, 4], [2, 0, 3, 5]],
      })
      : new CANNON.Box(new CANNON.Vec3(s.half[0], s.half[1], s.half[2]));
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape,
      material: s.part === 'lane' || s.part === 'hump' ? matWood
        : s.part === 'board' || s.part === 'riser' || s.part === 'trough' ? matBoard
          : s.part === 'ringSeg' && String(s.ring || '').startsWith('100') ? matRing100
            : s.part === 'ringSeg' || s.part === 'cupSeg' || s.part === 'splitter' ? matRing
            : s.part === 'backboard' || s.part === 'kick' || s.part === 'keep' || s.part === 'cage' ? matDead : matWall,
      // GUARD: only 'board' (a tread the ball can fall THROUGH on capture) is GROUP_FLOOR. A
      // staircase's risers are walls - they stay solid for a captured ball, always.
      collisionFilterGroup: s.part === 'board' ? GROUP_FLOOR : GROUP_REST,
      collisionFilterMask: GROUP_BALL,
    });
    if (s.shape !== 'prism') {
      body.position.set(s.pos[0], s.pos[1], s.pos[2]);
      if (s.rot) body.quaternion.setFromAxisAngle(new CANNON.Vec3(...s.rot.axis), s.rot.angle);
      else if (s.faceRot) {
        const qx = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), s.faceRot.tilt);
        const qy = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), s.faceRot.phi);
        body.quaternion = qx.mult(qy);
      }
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

/** World position -> face coordinates {u, v, h, tilt}. machine.js owns the mapping now (it is
 *  piecewise on a stepped machine); this wrapper keeps the old call shape. */
function worldToFace(M, G, p) {
  return M.worldToFace(p);
}

export function startThrow(board, { power = 0.5, aim = 0 } = {}) {
  const G = board.geom;
  const { world, ball, M } = buildWorld(board);

  // GUARD: POWER IS NOT CLAMPED TO 0..1. 0 and 1 are the ends of the NATURAL swipe range, not
  // the ends of what is physically possible - a harder-than-normal swipe reaches higher up the
  // wall, a softer one falls short for a 0 or rolls back. THERE IS NO UPPER BOUND: swipe hard
  // enough and the ball leaves the machine entirely and resolves as the zero it earns. The only
  // bound is at the bottom, so the square root below cannot take a negative argument.
  const p = Math.max(-0.75, power);
  // GUARD: power is spent as ENERGY, not as speed - interpolating v^2 rather than v, because
  // distance up the face scales with the SQUARE of arrival speed. This is the CONTROL CURVE -
  // what the dial means - not a force on the ball; nothing here touches the ball once rolling.
  // See DECISIONS.md#power-curve-rebuild.
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
    // A CUP BOARD (any hole wearing a collar - POPONGO) resolves its emergencies differently:
    // see the watchdog and the cap below. Decided once per throw, here.
    cupBoard: Object.values(G.holes).some((h) => h && h.collarH > 0),
    captured: null,           // hole id once the mouth has the ball
    capturedFaceY: 0,
    touchedBoard: false,
    bounces: 0,
    nContacts: 0,             // contact events emitted so far, so the cap below can bite
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
    const ud = (e.body && e.body.userData) || {};
    const part = ud.part;
    const vn = e.contact ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 0;
    // ARRIVED: the ball has reached the far end of the machine and hit something there. game.js
    // hands the player their next ball on this rather than on the ball SETTLING, which can take
    // up to MAX_T - twelve seconds is an absurd time to stand holding nothing (Matt, 2026-08-20).
    // GUARD: the lane and the hump do not count. The ball is touching those from the moment it is
    // served, so counting them would arm the next throw before this one had gone anywhere.
    if (!st.arrived && part && part !== 'lane' && part !== 'hump') st.arrived = true;
    // Game-feel events (UNCHANGED): the scoring face (H) registers first-touch and hard bounces,
    // the backboard (M) its own knocks. render/rules and the tests key off exactly these.
    if (part === 'board') {
      if (!st.touchedBoard) { st.touchedBoard = true; st.events.push({ type: 'impact', speed: vn }); }
      if (vn > 0.5) { st.bounces += 1; st.events.push({ type: 'bounce', speed: vn }); }
    } else if (part === 'backboard' && vn > 0.4) {
      st.events.push({ type: 'backboard', speed: vn });
    }
    // Every real touch against every part, with where and how hard. vn > 0.05 drops the solver's
    // per-step resting contacts while keeping a soft side-wall graze; the cap stops a jammed ball
    // growing the array without bound. The throw log no longer carries these (see _logThrow in
    // ui.js), but the tests and the bench tools read them to work out where a ball actually went.
    if (vn > 0.05 && st.nContacts < 300) {
      st.nContacts += 1;
      const p = ball.position;
      st.events.push({ type: 'contact', part: part || '?', cup: ud.cup || null, speed: +vn.toFixed(3),
        x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), t: +st.t.toFixed(3) });
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
  //
  // GUARD: THE CAPTURE RULE IS PER BOARD FAMILY, AND IT MUST STAY THAT WAY.
  //
  // A COLLARED CUP BOARD (POPONGO, BASKET FEVER) treats capture as a PREDICTION, NOT A SCORE
  // (Matt, 2026-08-22: the machine paid a ball that rattled a rim and bounced OUT). Those mouths
  // have walls standing above the face, so a captured ball really can strike the far collar wall
  // and climb back out - nothing commits until it has ACTUALLY PASSED THROUGH the plane INSIDE
  // the mouth, and a ball that gets clear gets its floor back and plays on.
  //
  // THE CLASSIC KEEPS THE RULE IT SHIPPED WITH: flush, ringed holes and the 0.26m drop test it
  // was tuned against. The prediction rule was written for machine 3 and applied "on every
  // machine" (28299ac), which silently changed how THE CLASSIC played overnight - three days
  // after it went live, with its own boards.js entry untouched. Matt, 2026-08-23, on finding
  // POPONGO/BASKET FEVER work inside the classic's physics: "WHAT THE FUCK". A machine nobody
  // asked you to touch does not change.
  //
  // ALL THREE MACHINES SHARE THIS ONE FILE. boards.js is the only per-machine data there is, so
  // an engine rule with no gate hits every machine by default. Gate the next one the way
  // st.cupBoard gates this one (set once per throw in startThrow), and name in the commit
  // message which machines you changed.
  if (st.captured) {
    const hDef = G.holes[st.captured];
    // THE CLASSIC: the original rule, unchanged since it went live. A flush hole has no wall to
    // bounce a captured ball back out of, so the 0.26m drop below the capture point IS the score.
    if (!st.cupBoard) {
      if (p.y < st.capturedFaceY - 0.26 || st.t > MAX_T) finishAt(st, st.captured, hDef.value, 'hole');
      return;
    }
    const fc = worldToFace(M, G, p);
    const d = Math.hypot(fc.u - hDef.u, fc.v - hDef.v);
    if (st.t > MAX_T) {
      finishAt(st, st.captured, hDef.value, 'hole');
    } else if (fc.h < -G.ballR * 1.2) {
      // Below the playing plane. Through the mouth = the score; through the slab anywhere
      // else (a bounce-out that slid under the intangible floor before escaping) = a miss.
      if (d < hDef.r + G.ballR) finishAt(st, st.captured, hDef.value, 'hole');
      else finishAt(st, 'corner0', 0, 'gutter');
    } else if (fc.h > G.ballR * 1.05 && d > hDef.r) {
      // Clear of the slab's surface and outside the mouth: it bounced out. Give the floor
      // back and let it play on - this ball has scored nothing yet.
      st.events.push({ type: 'rimout', hole: st.captured });
      st.captured = null;
      ball.collisionFilterMask = GROUP_FLOOR | GROUP_REST;
    }
    return;
  }

  const f = worldToFace(M, G, p);

  // 2. The mouths. Centre over an opening while at face level = the floor stops holding you -
  //    exactly what a hole is, but only if the ball can ACTUALLY FALL IN. GUARD: this is a
  //    KINEMATIC test, never a "centre over the hole" test - in the time this ball takes to
  //    cross the mouth, does it drop far enough to be past the lip? A ball dropping into a cup
  //    goes in even at speed; a fast roll skims across and carries on UNCHANGED, not deflected,
  //    slowed or steered. No magnetism, no assist, no correction (see the banned section 5
  //    below). See DECISIONS.md#hole-capture.
  const vel = ball.velocity;
  // The LOCAL surface frame - on a stepped machine each tread has its own tilt, and capture's
  // kinematics answer to the surface the ball is actually over.
  const sinT = Math.sin(f.tilt);
  const cosT = Math.cos(f.tilt);
  // the same linear map worldToFace applies to positions, applied to the velocity
  const vFace = Math.hypot(vel.x, vel.y * sinT - vel.z * cosT);
  const hDot = vel.y * cosT + vel.z * sinT;          // + = away from the face, - = into it
  const gPerp = 9.82 * cosT;                          // gravity's pull perpendicular to the face
  const need = G.ballR * (typeof G.captureDrop === 'number' ? G.captureDrop : 0.55);
  if (f.v > 0 && f.v < G.boardLen && f.h < G.ballR * 1.9) {
    for (const id of Object.keys(G.holes)) {
      const hDef = G.holes[id];
      const d = Math.hypot(f.u - hDef.u, f.v - hDef.v);
      const rEff = hDef.r - G.ballR * 0.28;
      if (d >= rEff) continue;
      // how much mouth is left in front of it, along its own line
      const cross = rEff + Math.sqrt(Math.max(0, rEff * rEff - d * d));
      // GUARD: ON A COLLARED CUP, "past the lip" means BELOW THE RIM, not past the face plane.
      // The base `need` was calibrated for flush holes; a ball crossing a collar's mouth from
      // above must also descend to under the rim plane before the far side, or it is really
      // clipping the far rim and bouncing OUT - and it used to be scored anyway, which read as
      // points for merely hitting a cup (Matt, 2026-08-22). Pure kinematics per hole; a hole
      // with no collar (every hole on THE CLASSIC) keeps the original number exactly.
      const lip = hDef.collarH > 0 ? hDef.collarH : 0;
      // A ball whose CENTRE is below the rim plane while inside the mouth is inside the cup's
      // VOLUME - a real basket has it at any rattle speed. Without this, a fast arrival that
      // failed the kinematic test below ended up sitting on the still-solid slab INSIDE the
      // collar - visibly "in the basket" - and could hop back out over the rim (Matt's clip,
      // 2026-08-22 23:42). Capture releases the slab; the pass-through commit at the top of
      // this function still decides the score, so nothing pays without falling through.
      if (lip > 0 && f.h < lip) {
        st.captured = id;
        st.capturedFaceY = p.y;
        ball.collisionFilterMask = GROUP_REST;
        st.events.push({ type: 'capture', hole: id, value: hDef.value, pos: { x: p.x, y: p.y, z: p.z } });
        return;
      }
      const needH = lip > 0 ? need + Math.max(0, f.h - lip) : need;
      // time to fall `needH` given the current inward speed: 0.5*gPerp*t^2 - hDot*t - needH = 0
      const tDrop = (hDot + Math.sqrt(hDot * hDot + 2 * gPerp * needH)) / gPerp;
      if (vFace * tDrop > cross) continue;            // too fast for this mouth: it rolls on
      st.captured = id;
      st.capturedFaceY = p.y;
      ball.collisionFilterMask = GROUP_REST;   // the slab lets go; gravity does the rest
      st.events.push({ type: 'capture', hole: id, value: hDef.value, pos: { x: p.x, y: p.y, z: p.z } });
      return;
    }
  }

  // 3. The trough: where a short throw dies, and where the board's bottom edge feeds every ball
  //    that ran out of steam and came back down. GUARD: IT IS WORTH NOTHING - the 10 is a real
  //    hole on the face now, so a ball down here has missed every hole there is, including the
  //    10, and must not be paid the 10's value. See DECISIONS.md#trough-and-lip.
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

  // 3b. GUARD: THERE IS NO RESTING-POSITION SCORING RULE, and there must not be one again. A
  //     ball that comes to rest on the face without falling through a hole is not scored here at
  //     all - it is left alone, and rolls back down into the trough like a real machine, where
  //     section 3 above gives it the honest floor score. The ONLY way to score a hole's value is
  //     section 2's capture - actually falling through the mouth. See
  //     DECISIONS.md#removed-features-and-why-they-stay-removed.

  // 4. Rolled back home: the ball is not spent, the player just gets it back. GUARD: THIS APPLIES
  //    TO EVERY BALL THAT COMES BACK DOWN THE RAMP, however hard it was thrown - a soft one the
  //    hump kept and a hard one that cleared the board, hit the back and ran all the way home are
  //    both returned. Do not split them again. On 2026-08-21 an `st.arrived` test was added here
  //    so that the hard one resolved as a zero and spent the ball; that was a gameplay rule
  //    nobody asked for, and Matt reverted it the same day. If a returned ball needs to stop
  //    reading as the game ignoring you, that is a FEEDBACK problem, not a scoring one.
  if (p.z > -0.04 && ball.velocity.z > 0.05 && st.t > 0.4) {
    st.outcome = null;
    st.done = true;
    st.events.push({ type: 'returned' });
    return;
  }

  // 5. GUARD: NO MAGNETISM, EVER. There is no pull toward any hole for a slow ball - a ball is
  //    never steered toward a hole it was not thrown at. A ball that runs out of speed on the
  //    slope does the honest thing: gravity takes it back down the face into the trough. If a
  //    power band needs widening, widen it in the GEOMETRY, never by moving the ball. See
  //    DECISIONS.md#removed-features-and-why-they-stay-removed.

  // 6. The watchdog: anchored displacement, never speed (jitter fools speed). A parked ball
  //    gets popped off the face like the chatter that frees a real ball; a ball a pop cannot
  //    move is JAMMED (three contact normals can lock the solver completely - measured, not
  //    theory), and jams get walked out: a slow positional roll toward the nearest mouth until
  //    physics takes back over or the mouth captures it.
  const moved = Math.hypot(p.x - st.anchor.x, p.y - st.anchor.y, p.z - st.anchor.z);
  if (moved > 0.03) st.anchor = { x: p.x, y: p.y, z: p.z, t: st.t };
  else if (st.t - st.anchor.t > 0.9) {
    st.anchor = { x: p.x, y: p.y, z: p.z, t: st.t };
    st.nudges += 1;
    if (st.nudges <= 2) {
      const side = p.x >= 0 ? -1 : 1;
      const tLoc = typeof f.tilt === 'number' ? f.tilt : M.tilt;
      ball.velocity.x += side * 0.3;
      ball.velocity.y += 0.55 * Math.cos(tLoc);
      ball.velocity.z += 0.3 * Math.sin(tLoc) + 0.15;
    } else {
      // Two pops did nothing: it is JAMMED, on every machine. It scores nothing and it is over.
      // It is NOT walked toward a mouth - that was a scripted score, and it paid a player for
      // touching a cup rather than falling through one (Matt, 2026-08-22: "Stuck balls should
      // score ZERO. and not be moved. It should vanish.").
      st.emergencyUsed = true;
      finishAt(st, 'corner0', 0, 'gutter');
      return;
    }
  }

  // 7. The cap. Should be unreachable (tests assert it): score the ball where it stands - except
  //    on a cup board, where a ball that never fell through a mouth earned nothing (the same
  //    honesty as the jam branch above).
  if (st.t > MAX_T) {
    st.emergencyUsed = true;
    if (st.cupBoard) { finishAt(st, 'corner0', 0, 'gutter'); return; }
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
