// skeeball/js/machines/brickcity/physics.js - HOT SHOT: BRICK CITY's OWN physics. This file
// serves ONE machine (board id `brickcity`) and nothing else loads it - see skeeball/js/engines.js.
// It began as a verbatim copy of machines/basketball/ on 2026-08-24 and diverges freely from here;
// an edit made for BRICK CITY must never be carried back into HOT SHOT's copy "to keep them in
// sync." The drift is the point. Full spec: skeeball/MACHINE-BRICKCITY.md.
//
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

import * as CANNON from '../../skeeball/js/vendor/cannon-es.js';
import { buildMachine } from './machine.js';

const H = 1 / 240;               // fixed physics step; flight and thin collars need the rate
const MAX_T = 12;                // emergency settle cap; the tests assert it never fires
export const STEP = H;           // exposed for the headless tests' update loops

const GROUP_BALL = 1;
const GROUP_FLOOR = 2;           // the board slab only - what capture removes from under the ball
const GROUP_REST = 4;            // everything else: lane, hump, trough, band, walls
// EVERY BASKET'S COLLAR GETS ITS OWN GROUP BIT (2026-09-02). A captured ball stops colliding with
// the collar it was captured BY - and only that one; the other eight stay solid - because on this
// machine the collar was what threw a well-aimed ball back out. See section 2's "THE NET" note.
const CUP_BIT0 = 8;
const cupBit = (G, id) => CUP_BIT0 << Math.max(0, Object.keys(G.holes).indexOf(id));
// AND EVERY BASKET'S THROAT GETS ONE TOO (2026-09-04) - see machine.js's throat block. The throat
// is the mouth continued down through the tread; it is solid ONLY to a ball that hole has already
// captured, so it is invisible to every other throw on the machine and cannot change one. The bits
// sit immediately above the cup bits and are sized from the hole count, so the two can never
// overlap however many baskets a face grows.
const throatBit = (G, id) => {
  const ids = Object.keys(G.holes);
  return CUP_BIT0 << (ids.length + Math.max(0, ids.indexOf(id)));
};
const restMask = (G) => Object.keys(G.holes).reduce((m, id) => m | cupBit(G, id), GROUP_REST);
/** The ball's mask while hole `id` has it: the floor and that collar let go, its throat takes over. */
const capturedMask = (G, st, id) => (G.captureKeepsCollar ? st.restMask : (st.restMask & ~cupBit(G, id))) | throatBit(G, id);

// Machine descriptions are pure per-board data; build each once.
const machines = new Map();
function machineFor(board) {
  let m = machines.get(board.id);
  if (!m) { m = buildMachine(board.geom); machines.set(board.id, m); }
  return m;
}

/** THE BROADPHASE, SPECIALISED FOR THE ONE THING THIS WORLD HOLDS (2026-08-26): a single dynamic
 *  body - the ball - among 200 static ones.
 *
 *  `NaiveBroadphase` tests every pair, 20,100 of them, and throws all but ~200 away, because
 *  `needBroadphaseCollision` rejects static-against-static. At 240Hz that is 4.8 MILLION rejected
 *  pair tests a second, and it is the single biggest cost in a frame of this machine's physics.
 *  This walks the ball's own pairs instead: 200 tests, same answer.
 *
 *  DETERMINISM, which is the whole reason it is written this awkwardly. It emits pairs in
 *  NaiveBroadphase's EXACT order (`for i, for j < i`, so the ball is `bi` against everything
 *  before it and `bj` against everything after), because the solver's result depends on the order
 *  it is handed its pairs. Verified rather than assumed: the same 41x21 power/aim grid the
 *  reachability tests use, run against origin/main's engine side by side - 861 throws, 0 differ,
 *  on hole, value, settle time to six decimal places, bounce count, board contact and the full
 *  event sequence. It FALLS BACK to the naive sweep whenever the world does not hold exactly one
 *  non-static body, so a future mover here cannot silently get a different pair list than the one
 *  it was tuned against.
 *
 *  BRICK CITY ONLY, per the HARD RULE in skeeball/CLAUDE.md - the other four machines still run
 *  the naive sweep and are not to be "kept in sync" with this. */
class BallBroadphase extends CANNON.NaiveBroadphase {
  collisionPairs(world, pairs1, pairs2) {
    const bodies = world.bodies;
    const n = bodies.length;
    let k = -1, dynamic = 0;
    for (let i = 0; i < n; i++) if (bodies[i].type !== CANNON.Body.STATIC) { k = i; dynamic++; }
    if (dynamic !== 1) { super.collisionPairs(world, pairs1, pairs2); return; }
    const ball = bodies[k];
    for (let j = 0; j < k; j++) {
      if (this.needBroadphaseCollision(ball, bodies[j])) this.intersectionTest(ball, bodies[j], pairs1, pairs2);
    }
    for (let i = k + 1; i < n; i++) {
      if (this.needBroadphaseCollision(bodies[i], ball)) this.intersectionTest(bodies[i], ball, pairs1, pairs2);
    }
  }
}

/** One throw = one fresh world (cheap: ~150 static boxes) so every throw is a clean determinism
 *  boundary - nothing persists from the previous ball. */
function buildWorld(board, closed = []) {
  const G = board.geom;
  const M = machineFor(board);
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new BallBroadphase();
  world.allowSleep = false;
  world.solver.iterations = 10;

  const matBall = new CANNON.Material('ball');
  const matWood = new CANNON.Material('wood');     // lane + hump: varnished, low bounce
  const matBoard = new CANNON.Material('board');   // the face: livelier
  const matWall = new CANNON.Material('wall');     // side rails: slick, so a ball banks off them
  // THE RISER AND THE TROUGH GOT THEIR OWN MATERIALS (2026-09-22). They used to share the
  // shelf's, which meant the display panel - the most-struck surface on the machine, 165 of 231
  // throws - and the catch pit could not be tuned apart from the floor a scored ball lands on.
  // The panel needs to come BACK at the player and the pit needs to swallow; one number cannot
  // be both. Defaults here are the old shared values, so a board that sets neither is unchanged.
  const matRiser = new CANNON.Material('riser');
  const matTrough = new CANNON.Material('trough');
  const matRing = new CANNON.Material('ring');     // the white plastic (PVC) rings: barely bounce
  const matDead = new CANNON.Material('dead');     // kick panel: padded, kills the ball
  // The BACK WALL gets its OWN material so it can rebound a hard throw at the player (the classic's
  // trick) without also making the front kick panel bouncy - they used to share matDead. Matt,
  // 2026-08-24: it was too easy to bank off the back wall into the 100.
  const matBack = new CANNON.Material('back');
  // The two corner 100s get their OWN ring material so they can be deadened without touching the
  // 10 through 50. See the ring100Rest note in boards.js.
  //
  // GUARD (2026-09-02): ON THIS MACHINE THAT MATERIAL IS NEVER USED. It is handed to 'ringSeg'
  // parts whose ring id starts with '100' - THE CLASSIC's rings. Every basket here is a 'cupSeg'
  // collar and takes matRing, so `ring100Rest` in this board's mat block is a dead knob: a sweep
  // with it overridden to 0.05 was bit-for-bit identical to the baseline (403 throws). If a 100's
  // rim ever needs its own bounce, route it by `G.holes[s.cup].value === 100` below - and know
  // that restitution was NOT what made the corner 100 unreliable (ringRest 0.05 on every collar
  // moved over-the-mouth scoring from 25% to 28%); the capture rules in section 2 were.
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
  contact(matBall, matRiser, pick(MAT.riserFric, 0.10), pick(MAT.riserRest, 0.08));
  contact(matBall, matTrough, pick(MAT.troughFric, 0.40), pick(MAT.troughRest, 0.06));
  contact(matBall, matWall, pick(MAT.wallFric, 0.04), pick(MAT.wallRest, 0.50));
  // GUARD: the rings are PVC, not steel - a ball that clips a rim loses its energy and drops or
  // dribbles down rather than bouncing across ring tops and back out. Low restitution kills the
  // bounce; friction stays low so a ball never wedges against a ring.
  contact(matBall, matRing, pick(MAT.ringFric, 0.06), pick(MAT.ringRest, 0.18));
  contact(matBall, matRing100, pick(MAT.ring100Fric, 0.06), pick(MAT.ring100Rest, 0.18));
  contact(matBall, matDead, pick(MAT.deadFric, 0.20), pick(MAT.deadRest, 0.12));
  // Bouncy and grip-free: a hard throw comes STRAIGHT back at the player. backFric 0 so the wall
  // can never turn serve topspin into climb (the classic's "back wall does not lift the ball").
  contact(matBall, matBack, pick(MAT.backFric, 0), pick(MAT.backRest, 0.60));

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
        : s.part === 'board' ? matBoard
          : s.part === 'riser' ? matRiser
            : s.part === 'trough' ? matTrough
              : s.part === 'ringSeg' && String(s.ring || '').startsWith('100') ? matRing100
                // THE FINS AND THE CHAMFERS ARE HOOP HARDWARE, so they bounce like the rims.
                // They used to fall through to matWall (0.03) and a near-miss that clipped one
                // simply died - which is 111 of 231 throws, and most of what "not very bouncy"
                // was. A ball kicking off a fin into the next basket is exactly the
                // unpredictability Matt asked for, and nothing steers it there.
                : s.part === 'ringSeg' || s.part === 'cupSeg' || s.part === 'throat' || s.part === 'rimCap'
                  || s.part === 'splitter' || s.part === 'fin' || s.part === 'finCap'
                  || s.part === 'chamfer' ? matRing
                  : s.part === 'backboard' ? matBack
                    // The SIDE RAILS stay dead on purpose (wallRest 0.03, measured): a live rail
                    // made the outer columns catch-alls for every over-aimed ball.
                    : s.part === 'kick' || s.part === 'keep' || s.part === 'cage' ? matDead : matWall,
      // GUARD: only 'board' (a tread the ball can fall THROUGH on capture) is GROUP_FLOOR. A
      // staircase's risers are walls - they stay solid for a captured ball, always.
      collisionFilterGroup: s.part === 'board' ? GROUP_FLOOR
        : s.part === 'throat' && s.cup ? throatBit(G, s.cup)
          : (s.part === 'cupSeg' || s.part === 'rimCap') && s.cup ? cupBit(G, s.cup) : GROUP_REST,
      collisionFilterMask: GROUP_BALL,
    });
    if (s.shape !== 'prism') {
      body.position.set(s.pos[0], s.pos[1], s.pos[2]);
      if (s.rot) body.quaternion.setFromAxisAngle(new CANNON.Vec3(...s.rot.axis), s.rot.angle);
      else if (s.faceRot) {
        const qx = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), s.faceRot.tilt);
        const qy = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), s.faceRot.phi);
        body.quaternion = qx.mult(qy);
        // A fin cap is a square section stood on its corner, so its TOP IS AN EDGE and a ball
        // cannot rest on it. The 45 is about the box's own v axis and must be applied AFTER the
        // face rotation in multiplication order (i.e. rightmost), or the diamond tips sideways.
        if (s.rimSpin) {
          const qr = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 4);
          body.quaternion = body.quaternion.mult(qr);
        }
        if (s.spin45) {
          const qz = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 4);
          body.quaternion = body.quaternion.mult(qz);
        }
      }
    }
    body.userData = { part: s.part, cup: s.cup || null };
    world.addBody(body);
  }

  // A FULL COLUMN'S HOOP IS CAPPED (2026-09-24). Matt: "Can you make it so a ball can't go in an
  // already filled column? Like cap it so the ball could bounce on or roll over it?" Before this a
  // ball went in and the rules called it a miss ('full'), which read as a basket that did not
  // count. Now the hoop has a solid LID at rim height: a static box lying in the shelf's plane,
  // covering the whole collar, with the rims' own material - so a ball landing on it bounces like
  // it hit the rim, and one rolling onto it rolls over and off (the shelf's forward tilt carries
  // it). The capture loop also skips a closed hole (st.closed), so nothing can score in it even
  // if the solver ever let a ball through. Not magnetism: it is a surface, and it steers nothing.
  for (const id of closed) {
    const H = G.holes[id];
    if (!H) continue;
    const lidT = G.ballR * 0.6;   // render.js setClosed draws the same size
    const half = H.r + G.collarThick * 1.5;
    const p = M.faceToWorld(H.u, H.v, (H.collarH || 0) + lidT / 2);
    const lid = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(half, lidT / 2, half)),
      material: matRing,
      collisionFilterGroup: GROUP_REST,
      collisionFilterMask: GROUP_BALL,
    });
    lid.position.set(p[0], p[1], p[2]);
    lid.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), M.tiltAt(H.v));
    lid.userData = { part: 'lid', cup: id };
    world.addBody(lid);
  }

  const ball = new CANNON.Body({
    mass: G.ballMass,
    shape: new CANNON.Sphere(G.ballR),
    material: matBall,
    linearDamping: 0.006,
    angularDamping: 0.015,
    collisionFilterGroup: GROUP_BALL,
    collisionFilterMask: GROUP_FLOOR | restMask(G),
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

// THE ONLY RANDOMNESS IN ANY ENGINE IN THIS REPO, and it is opt-in and reproducible.
// Matt, 2026-09-21: "add a little bit of unpredictability." MACHINE-SPEC.md section 9 bans
// STEERING a ball toward a hole; it does not ban an imperfect release, and an arcade basketball
// shot is not laser-straight. skeeball/CLAUDE.md already names the shape this must take: "thread
// a seeded rng through startThrow and keep simulateThrow deterministic - the test suite depends
// on it." So scatter is applied ONLY when a seed is passed. Every sweep, probe and regression
// test calls without one and gets the old, exactly-deterministic throw; the game passes a fresh
// seed per shot, and the same seed always replays the same shot.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function startThrow(board, { power = 0.5, aim = 0, seed = null, closed = [] } = {}) {
  const G = board.geom;
  const closedList = Array.isArray(closed) ? closed.filter((id) => G.holes[id]) : [];
  const { world, ball, M } = buildWorld(board, closedList);

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
  let speed = Math.sqrt(Math.max(0.4, s0 * s0 + p * (s1 * s1 - s0 * s0)));
  let a = Math.max(-1, Math.min(1, aim)) * G.aimMax;
  // The release is imperfect. Applied to the LAUNCH only - once the ball is rolling nothing
  // touches it, which is the standing no-magnetism ban. Gaussian-ish (two uniforms averaged) so
  // most shots are near-true and the occasional one is genuinely off, rather than a flat spread.
  if (seed !== null && (G.jitterAim || G.jitterSpeed)) {
    const rnd = mulberry32(seed | 0);
    const bell = () => (rnd() + rnd() - 1);
    a += bell() * (G.jitterAim || 0);
    speed *= 1 + bell() * (G.jitterSpeed || 0);
  }
  ball.position.set(0, G.ballR, -0.12);
  ball.velocity.set(Math.sin(a) * speed, 0, -Math.cos(a) * speed);
  // Served rolling, not skidding: contact-point velocity zero on the lane bed.
  //
  // GUARD (2026-09-02): FORWARD ROLL ONLY, ON PURPOSE - do not "correct" this to the full rolling
  // spin for an aimed serve, omega = (up x v) / R. That was tried and measured: with a z-spin on
  // the ball the 70-degree hump turns it into a LATERAL KICK, and a 4.5 deg serve landed 6-11 cm
  // right of the corner 100's axis (was 1-2 cm), against the side wall at 5 deg and off the wall
  // by 7. The forward-only serve lets the lane's friction bleed the sideways skid off in the first
  // 40 cm, which is what keeps an aimed ball close to the line it was rolled on.
  ball.angularVelocity.set(-speed / G.ballR, 0, 0);

  const st = {
    world, ball, M, G,
    closed: new Set(closedList),   // capped hoops (full columns): never captured, never scored
    t: 0,
    acc: 0,
    events: [{ type: 'launch' }],
    outcome: null,
    done: false,
    // A CUP BOARD (any hole wearing a collar - POPONGO) resolves its emergencies differently:
    // see the watchdog and the cap below. Decided once per throw, here.
    cupBoard: Object.values(G.holes).some((h) => h && h.collarH > 0),
    // The tallest collar on the face: section 2's capture gate is measured from the RIM, not the
    // tread, so a ball dropping toward a basket is seen while it is still above it.
    maxLip: Object.values(G.holes).reduce((m, h) => Math.max(m, (h && h.collarH) || 0), 0),
    restMask: restMask(G),
    captured: null,           // hole id once the mouth has the ball (a GUESS until `committed`)
    committed: null,          // hole id once the ball is THROUGH - wholly below the rim; never undone
    capturedFaceY: 0,
    touchedBoard: false,
    bounces: 0,
    nContacts: 0,             // contact events emitted so far, so the cap below can bite
    airborne: false,
    // The displacement-anchored stall watchdog (speed thresholds are jitter-blind - the pinball
    // lesson survives the engine swap). `nudges` lived here until 2026-08-26; this machine no
    // longer pops a parked ball, it ends it - see section 6.
    // `t0` is when the ball entered the CURRENT 3cm bubble; `t` is when it was last seen moving
    // inside it. The jam window is measured from `t`, the veto's rope from `t0` - see section 6.
    anchor: { x: 0, y: 0, z: 0, t: 0, t0: 0 },
    emergencyUsed: false,
    clamped: 0,
    troughAt: -1,
    // The part touched during the CURRENT step, for the sideways-bounce rule. Cleared every step.
    hitPart: null,
    // Has this throw already left its scuff on the back wall? One per throw - see the 'wall'
    // event below.
    wallMarked: false,
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
    // WHERE IT HIT THE BACK WALL (2026-09-03). Matt: "It's impossible to tell where on the back
    // wall a ball that's overthrown bounces off. Sometimes I'll throw it and it doesn't look like
    // it even touched the back wall, but based off how it lands I know it must have."
    //
    // The engine always knew; it just never said. The 'backboard' event above carries a SPEED and
    // no position, and ui.js only counts it for telemetry, so a bounce off the back of the machine
    // had no visual at all - the ball simply changed direction in front of a flat wall.
    //
    // THE BACK WALL ONLY, AND ONLY THE FIRST TOUCH OF A THROW. The first version of this also
    // marked the SIDE RAILS, on the measurement that a rail is hit four times as often. That was
    // true and it was the wrong call - Matt, with a recording: "the way it's shown on the side
    // walls is ridiculous". A rail runs nearly edge-on to the player, so a mark lying on one is a
    // sliver, and the version that turned to face the camera instead was worse: a perfect circle
    // floating on a wall it is not parallel to. One mark, on the one wall that squarely faces the
    // player, for the one contact the player is asking about.
    //
    // The 0.4 m/s threshold on the event above was NOT the problem and is not copied here: of 113
    // back-wall touches measured over 276 throws, only ONE was under it (they land at a median
    // 1.75 m/s). 0.1 catches that one and costs nothing.
    if (part === 'backboard' && vn > 0.1 && !st.wallMarked) {
      st.wallMarked = true;
      const q = ball.position;
      st.events.push({ type: 'wall', part, speed: +vn.toFixed(3), pos: { x: q.x, y: q.y, z: q.z } });
    }
    // Every real touch against every part, with where and how hard. vn > 0.05 drops the solver's
    // per-step resting contacts while keeping a soft side-wall graze; the cap stops a jammed ball
    // growing the array without bound. The throw log no longer carries these (see _logThrow in
    // ui.js), but the tests and the bench tools read them to work out where a ball actually went.
    // WHAT THE BALL JUST CAME OFF, for the sideways-bounce rule in substep. Set here because
    // `collide` is the only place the part is known; cleared at the top of every step.
    if (vn > 0.05 && part) st.hitPart = part;
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

// THE SIDEWAYS BOUNCE. The parts a bounce is turned on: the hoop shelf and the hoop row's own
// furniture. Deliberately NOT the display panel (a vertical wall below the hoops - a ball sliding
// sideways down a wall it cannot score from is nonsense), NOT the back wall (an overthrow coming
// back forward off it is a real shot save and must stay honest), NOT the side rails (dead), and
// NOT `throat`/`cupSeg` - a captured ball is committed to its column and nothing may touch it.
const SIDEWAYS_PARTS = new Set(['board', 'ringSeg', 'fin', 'finCap', 'chamfer', 'splitter']);
const RIM_PARTS = new Set(['ringSeg', 'cupSeg', 'throat', 'rimCap']);
// THE BACK WALL, TURNED TOO - PARTLY (2026-09-24). Matt: "a lot of mine have been bouncing back
// towards me i thought we made it so they bounce up or sideways?" ... "a bunch of mine have
// actually bounced back onto the ramp". Traced (thumb-realistic shots, 7 columns): the ball clips
// a fin cap, hits the short wall BEHIND the hoops (a `riser`, restitution 0.70) or the backboard,
// and leaves at ~2 m/s toward the player and ~2 m/s up - clean over the hoop row and the gap and
// back onto the ramp. The note above kept the back wall out of the TURN so an overthrow could
// still come back into a hoop - and measured, turning it cost 10+ points of right-column shots -
// so instead `backWallKeep` SOFTENS that wall's rebound toward the player (boarddef has the
// sweep). It only takes speed away, never adds or steers. The display panel below the shelf is
// told apart by position: it faces the player a whole shelf-depth further forward.
const BACK_PARTS = new Set(['riser', 'backboard']);
function backWallZ(M) {
  if (M._backMidZ == null) {
    const zs = M.solids.filter((x) => x.part === 'riser').map((x) => x.pos[2]);
    M._backMidZ = zs.length > 1 ? (Math.min(...zs) + Math.max(...zs)) / 2 : -Infinity;
  }
  return M._backMidZ;
}

function substep(st) {
  const { world, ball, M, G } = st;
  st.hitPart = null;
  const vyWas = ball.velocity.y;
  const vzWas = ball.velocity.z;
  world.step(H);
  st.t += H;

  // 0a. THE BOUNCE GOES SIDEWAYS, NOT FORWARDS (2026-09-22). Matt, having played the bouncy
  //     build: "can we make it so it only bounces sideways? Like right now it bounces forward and
  //     rolls off the front of the machine a lot... I want the bounce to add some randomness, not
  //     make the game measurably more difficult."
  //
  //     Those are two different things and the probe had to be taught to tell them apart
  //     (`reference/hoops/probe-bounce.mjs` now reports the lateral/forward split of every bounce
  //     and how many misses come back over the shelf's front edge). A bounce ACROSS the hoop row
  //     changes which column a shot finds, which is the randomness he asked for. A bounce toward
  //     the player only walks the ball off the front edge, which costs a shot and buys nothing.
  //     Both look identical on screen, which is how the previous build shipped 14 points of
  //     scoring rate for the wrong one.
  //
  //     THE RULE IS A ROTATION, NOT A KICK. The horizontal velocity vector is turned toward the
  //     u axis and its MAGNITUDE IS UNCHANGED - hypot(vx, vz) before equals hypot(vx, vz) after,
  //     and the vertical component is never touched. No energy is added, so a livelier rim cannot
  //     become a ball fired off the machine.
  //
  //     AND IT IS NOT MAGNETISM (MACHINE-SPEC section 9). It never reads `G.holes`, never asks
  //     where a hoop is, and never picks a side: the direction is the sign of the sideways drift
  //     the ball ALREADY had. A ball drifting left comes off the rim further left. That it more
  //     often finds a hoop is a consequence of the hoops being in a row along that axis, not of
  //     anything steering it - `hoops4/js/test.js` asserts the redirect reads no hole position.
  //
  //     Forward only (+z is toward the player). A ball still travelling INTO the machine needs
  //     that momentum to reach the row at all.
  const rimHit = RIM_PARTS.has(st.hitPart) && typeof G.rimSideways === 'number';
  const K = rimHit ? G.rimSideways : (typeof G.bounceSideways === 'number' ? G.bounceSideways : 0);
  // A captured ball is left alone - unless rimouts are on, where capture is only a guess and the
  // ball is not really in until it is THROUGH.
  if (K > 0 && !(G.rimout ? st.committed : st.captured) && st.hitPart
      && (rimHit || SIDEWAYS_PARTS.has(st.hitPart))
      && vyWas < -0.20 && ball.velocity.y > 0.15 && (rimHit ? Math.abs(ball.velocity.z) : ball.velocity.z) > 0.10
      // A ball with no sideways drift at all has no side to be sent to, and INVENTING one is
      // where this rule would stop being physics and start being a coin toss the machine makes
      // for the player. A dead-centre bounce is left exactly as it was.
      && Math.abs(ball.velocity.x) > 1e-4) {
    const v = ball.velocity;
    const hor = Math.hypot(v.x, v.z);
    const zKeep = v.z * (1 - K);
    const xMag = Math.sqrt(Math.max(0, hor * hor - zKeep * zKeep));
    // On a RIM the turned speed is also SOFTENED (`rimKeep`, 0..1 of it kept). Never raised.
    const keep = rimHit && typeof G.rimKeep === 'number' ? G.rimKeep : 1;
    v.x = (v.x > 0 ? 1 : -1) * xMag * keep;
    v.z = zKeep * keep;
  }

  // 0b. The back wall and backboard: see BACK_PARTS. Only a ball that was going INTO the machine
  //     and now comes OUT of it, above the shelf, and never a captured one. Its speed back toward
  //     the player (the wall's normal) is scaled by `backWallKeep` - a softer wall, not a turn.
  const KB = typeof G.backWallKeep === 'number' ? G.backWallKeep : 1;
  if (KB < 1 && !(G.rimout ? st.committed : st.captured) && BACK_PARTS.has(st.hitPart)
      && ball.position.z < backWallZ(M) && vzWas < -0.20 && ball.velocity.z > 0.10) {
    ball.velocity.z *= Math.max(0, KB);
  }

  // 0. THE SOLVER-ARTEFACT CEILING (2026-09-04). NOT a gameplay rule and NOT a brake: this
  //    machine cannot produce a ball this fast, so nothing a player throws can ever meet it. The
  //    hardest serve leaves at `maxSpeed` (6.60) and only loses energy after that - measured over
  //    a 21x41 grid, the fastest any ball ever goes is 7.04 m/s and not one of 861 throws passes
  //    9.90. What CAN produce it is cannon-es resolving a deep overlap with a position
  //    correction, which is what the rimout branch used to cause (see its guard in section 1):
  //    0.397 m/s to 10.807 m/s in one 1/240 s step, with no impact behind it. The condition up
  //    there is the fix; this is the floor under it, so a future overlap is a hard bounce rather
  //    than a ball fired through the cabinet. `st.clamped` is inert - nothing reads it but the
  //    bench tools, and it should stay zero.
  const vMax = (typeof G.maxSpeed === 'number' ? G.maxSpeed : 8) * 1.5;
  const vNow = ball.velocity.length();
  if (vNow > vMax) {
    ball.velocity.scale(vMax / vNow, ball.velocity);
    st.clamped = (st.clamped | 0) + 1;
  }

  const p = ball.position;

  // 1. Captured: the floor is gone under the mouth; ride gravity down through it.
  //
  // GUARD: THE CAPTURE RULE IS PER BOARD FAMILY, AND IT MUST STAY THAT WAY.
  //
  // A COLLARED CUP BOARD (POPONGO, HOT SHOT) treats capture as a PREDICTION, NOT A SCORE
  // (Matt, 2026-08-22: the machine paid a ball that rattled a rim and bounced OUT). Those mouths
  // have walls standing above the face, so a captured ball really can strike the far collar wall
  // and climb back out - nothing commits until it has ACTUALLY PASSED THROUGH the plane INSIDE
  // the mouth, and a ball that gets clear gets its floor back and plays on.
  //
  // THE CLASSIC KEEPS THE RULE IT SHIPPED WITH: flush, ringed holes and the 0.26m drop test it
  // was tuned against. The prediction rule was written for machine 3 and applied "on every
  // machine" (28299ac), which silently changed how THE CLASSIC played overnight - three days
  // after it went live, with its own boards.js entry untouched. Matt, 2026-08-23, on finding
  // POPONGO/HOT SHOT work inside the classic's physics: "WHAT THE FUCK". A machine nobody
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
    // In the CAPTURED HOLE'S OWN frame, never the nearest one - see machine.js worldToFaceIn.
    const fc = M.worldToFaceIn(M.frameAt(hDef.v), p);
    const d = Math.hypot(fc.u - hDef.u, fc.v - hDef.v);
    // THROUGH: THE BALL IS WHOLLY BELOW THE RIM, INSIDE THE MOUTH, AND GOING DOWN (2026-09-22).
    // This - not `capture` - is the moment the ball has gone in, and the moment the Connect 4 disc
    // starts to fall (ui.js). Matt, on a screen recording: "A ball can bounce around on a rim and
    // the ball falls down the column while the ball is still bouncing around the rim." It could:
    // `capture` fires while the ball is still UP AT RIM HEIGHT (the kinematic gate admits a ball
    // up to 1.9 ballR above the rim) and the drop was started there, 0.35 s median and 0.92 s
    // worst before the ball actually dropped. Below the rim, inside the collar, with no floor and
    // falling, nothing can send it back up: from here it is COMMITTED to this column, and
    // reference/hoops/probe-rim.mjs asserts that no through ever ends anywhere else.
    if (!st.committed && d < hDef.r && fc.h < (hDef.collarH || 0) - G.ballR
      && ball.velocity.y * Math.cos(fc.tilt) + ball.velocity.z * Math.sin(fc.tilt) < 0) {
      st.committed = st.captured;
      st.events.push({ type: 'through', hole: st.captured, value: hDef.value });
    }
    if (st.t > MAX_T) {
      finishAt(st, st.captured, hDef.value, 'hole');
    } else if (fc.h < -G.ballR * 1.2) {
      // Below the playing plane. Through the mouth = the score; through the slab anywhere
      // else (a bounce-out that slid under the intangible floor before escaping) = a miss.
      if (d < hDef.r + G.ballR) finishAt(st, st.captured, hDef.value, 'hole');
      else finishAt(st, 'corner0', 0, 'gutter');
    } else if (fc.h > (hDef.collarH || 0) + G.ballR * 1.05
      && ball.velocity.y * Math.cos(fc.tilt) + ball.velocity.z * Math.sin(fc.tilt) > 0) {
      // WHOLLY ABOVE THE RIM AND MOVING AWAY FROM THE FACE: it bounced out over the top, which is
      // the only way out of a throated basket. Give the floor and the collar back and let it play
      // on - this ball has scored nothing yet.
      //
      // GUARD (2026-09-04): THE HEIGHT IS MEASURED FROM THE RIM, AND THE `d > hDef.r` TERM IS
      // GONE, because between them they made this branch hand the geometry back UNDERNEATH A BALL
      // THAT WAS ALREADY INSIDE IT. `d > hDef.r` is the RIM radius: the ball's centre could be
      // 5.9 cm out on a 5.82 cm mouth while its surface was still 5 cm deep in the collar wall,
      // and `fc.h > ballR * 1.05` (5.7 cm above the TREAD) is met at half the depth of an 11.6 cm
      // collar. cannon-es then resolved that overlap the only way it can, with a position
      // correction. Traced step by step (power 0.50 / aim -0.45, midL): the ball is doing
      // 0.397 m/s at t 1.0417, this branch fires, and at t 1.0458 it is doing 10.807 m/s - a
      // 10.4 m/s jump in one 1/240 s step, against contact impacts the solver logged at 0.10 to
      // 0.37 m/s. It was not hit by anything; it was pushed out of a wall. It then re-captured,
      // flew through the treads and struck a riser at 6.37 m/s. Matt, 2026-09-04, on a machine
      // that has no throw faster than maxSpeed 6.60: the ball "hits something INSIDE the basket,
      // and Ricochets to the right super fast, then slow." 34 throws of 1,681 did this, worst
      // 10.4 m/s. Above the rim by a full ball radius, NOTHING can be overlapping: the collar's
      // top face is at collarH and the tread is another 11.6 cm below that.
      //
      // GUARD (2026-09-02), still load-bearing: the "moving away" term is not optional. A ball
      // captured over the corner 100 with 1.5 m/s of forward speed drifts off the mouth's axis
      // while it is STILL DESCENDING toward the riser 2 cm behind the rim - and that riser is
      // solid and about to push it forward into the basket. A ball that is still going down has
      // not bounced out.
      // ON THIS MACHINE THERE IS NO RIMOUT. Matt, 2026-09-21: "once it goes into a basket, it
      // goes down that column 100% of the time." On BRICK CITY this branch hands the floor and
      // the collar back so a ball that bounces out over the rim plays on - correct there, where a
      // rack is nine independent balls and a rattle-out is just a miss. Here a capture IS A MOVE
      // IN A CONNECT 4 GAME: the column has been chosen, the screen is about to show a disc
      // dropping into it, and a ball that climbed back out afterwards would mean the board and
      // the physics disagreed about whose turn it is and what the position is. So capture COMMITS.
      //
      // This costs nothing that Matt asked for, because the bounce he wants happens BEFORE
      // capture, not after: captureDrop 0.52 (the hardest in the repo) and ringRest 0.46 (the
      // bounciest) mean a shot that is not a swish rattles the rim and very often does NOT
      // capture at all. Under shoot-until-you-make-it that is simply another shot. What is
      // removed is only the case where the machine had already said "in".
      //
      // The throat (below, radius r + ballR on its own collision bit) is what makes the commit
      // physically honest rather than a teleport: the ball is confined to the mouth it entered
      // and falls through it.
      if (st.committed || !G.rimout) { st.events.push({ type: 'rattle', hole: st.captured }); return; }
      // A RIMOUT (restored 2026-09-22). Until the ball is THROUGH (above), capture is only the
      // engine's guess, and a ball that climbs back out over the rim gets its floor and the collar
      // back and plays on - into the next hoop, or nothing. Matt: "I want it to have to be a
      // perfect shot to go right in, otherwise it's like a 50-50 chance it bounces into the one
      // you wanted or into a different one." The earlier "no rimout" rule existed only because
      // the disc used to start falling at capture; now it starts at `through`, which can never
      // be undone, so the board and the physics still cannot disagree.
      st.events.push({ type: 'rimout', hole: st.captured });
      st.captured = null;
      ball.collisionFilterMask = GROUP_FLOOR | st.restMask;
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
  // GUARD (2026-09-02): THE GATE IS MEASURED FROM EACH BASKET'S RIM, NOT FROM THE TREAD. It used
  // to be `f.h < ballR * 1.9` (0.104) alone - THE CLASSIC's number, written for flush holes a ball
  // ROLLS over. The corner 100s' rims stand 0.116 above their tread, so a ball dropping onto one
  // out of the air was invisible to capture until its centre was already INSIDE the collar - by
  // which time the rim had had it. Measured (5.5 deg / power 0.70, stepped): the ball arrives
  // 2 cm off the basket's axis, dead centre by any standard, and descending at 2.4 m/s; at
  // h 0.179 the gate refuses it; at h 0.155 its underside grazes the rim's inner top EDGE, whose
  // 45-degree normal turns the descent into a 1.5 m/s kick ACROSS the mouth; the far edge turns
  // that into 1.6 m/s straight UP, and the ball leaves the basket it was dropped into. Over the
  // whole 4.5-7.5 deg x 0.62-0.92 grid, balls that arrived over the mouth scored 9 times in 36.
  // Matt: "a swipe that looks aimed at the basket sometimes scores, sometimes misses completely."
  // The outer test only has to let a ball NEAR a tall collar through; each hole applies its own
  // rim-relative gate below.
  if (f.v > 0 && f.v < G.boardLen && f.h < G.ballR * 1.9 + st.maxLip) {
    for (const id of Object.keys(G.holes)) {
      if (st.closed && st.closed.has(id)) continue;   // capped: a full column (see buildWorld)
      const hDef = G.holes[id];
      // GUARD: THIS HOLE'S OWN FRAME. f above is the nearest segment's, which on a staircase is
      // the RISER once the ball is deep in a bottom-row basket - and a riser-frame d comes out
      // 0.22 against a 0.09 mouth, so the cup the ball is sitting in gets skipped. Ask each
      // hole where the ball is relative to IT. See machine.js worldToFaceIn.
      const fh = M.worldToFaceIn(M.frameAt(hDef.v), p);
      const d = Math.hypot(fh.u - hDef.u, fh.v - hDef.v);
      const rEff = hDef.r - G.ballR * 0.28;
      if (d >= rEff) continue;
      const lip = hDef.collarH > 0 ? hDef.collarH : 0;
      // THE CLASSIC's 1.9 ballR - measured from THIS basket's RIM for a ball that is FALLING
      // INTO the mouth, and from the TREAD for anything else.
      //
      // GUARD, and the reason for the `falling` term (2026-09-02, second pass): the rim-relative
      // gate on its own is what let a ball that had merely COME TO REST on a collar's rim be
      // captured. A collar stands 0.116 above its tread, so raising the gate by `lip` for every
      // ball also admits one sitting still on top of the rim - and the kinematic test below
      // cannot refuse it, because a stationary ball trivially "falls past the lip before crossing
      // the mouth". In Matt's three recordings every 100 came in exactly that way: the ball went
      // up to the backboard, loitered, came down onto the top-right 100, settled on its rim, and
      // was paid. Deleting the explicit lip-rest rule did not fix it; this is where it was really
      // getting in.
      //
      // hDot is the ball's speed INTO the face (negative = descending onto it). A ball dropped
      // onto a basket off this machine's 70-degree launch arrives at 2 to 3 m/s; a ball resting
      // on a rim, or rolling across the tread, is at essentially zero. 0.8 m/s sits between them
      // with room on both sides. Below that threshold the gate is the tread-relative one THE
      // CLASSIC has always used, so a ball on top of a rim is what it looks like: on the wall,
      // not in the basket.
      const falling = hDot < -0.8;
      if (fh.h >= (falling ? lip : 0) + G.ballR * 1.9) continue;
      // how much mouth is left in front of it, along its own line
      const cross = rEff + Math.sqrt(Math.max(0, rEff * rEff - d * d));
      // GUARD: ON A COLLARED CUP, "past the lip" means BELOW THE RIM, not past the face plane.
      // The base `need` was calibrated for flush holes; a ball crossing a collar's mouth from
      // above must also descend to under the rim plane before the far side, or it is really
      // clipping the far rim and bouncing OUT - and it used to be scored anyway, which read as
      // points for merely hitting a cup (Matt, 2026-08-22). Pure kinematics per hole; a hole
      // with no collar (every hole on THE CLASSIC) keeps the original number exactly.
      //
      // THE NET (2026-09-02): ONCE CAPTURED, THE BALL NO LONGER COLLIDES WITH THIS BASKET'S OWN
      // COLLAR. A real basket has a net; this engine has a rigid 12 mm ring with 3.7 mm of
      // clearance around a 3.00 in ball, and that ring is what kicked captured balls back out
      // (the edge-graze mechanism in the guard above). Capture already means "the floor is gone
      // and gravity takes it through the mouth" - on a collar board the collar has to let go
      // with the floor, or the rule pays nothing. The other eight collars, the riser behind the
      // basket and everything else stay solid, so a captured ball still cannot leave the
      // basket sideways or through the wall; and the pass-through commit at the top of this
      // function still decides the score, so nothing pays without falling through the tread
      // inside the mouth. No magnetism, no steering: a ball that was never over the mouth is
      // never captured, and rattles the rim exactly as it always did.
      // A ball whose CENTRE is below the rim plane while inside the mouth is inside the cup's
      // VOLUME - a real basket has it at any rattle speed. Without this, a fast arrival that
      // failed the kinematic test below ended up sitting on the still-solid slab INSIDE the
      // collar - visibly "in the basket" - and could hop back out over the rim (Matt's clip,
      // 2026-08-22 23:42). Capture releases the slab; the pass-through commit at the top of
      // this function still decides the score, so nothing pays without falling through.
      if (lip > 0 && fh.h < lip) {
        st.captured = id;
        st.capturedFaceY = p.y;
        ball.collisionFilterMask = capturedMask(G, st, id);
        st.events.push({ type: 'capture', hole: id, value: hDef.value, pos: { x: p.x, y: p.y, z: p.z } });
        return;
      }
      // REMOVED, AND IT MUST NOT COME BACK: THE LIP-REST RULE (added and reverted 2026-09-02).
      // For a few hours this loop also captured a ball that was merely SITTING on a collar's rim
      // - centre inside a widened radius (r - ballR*0.10 instead of rEff), slower than 0.6 m/s,
      // anywhere under rim + ballR*1.15. It was written for one measured case (a ball sliding
      // down the riser onto the corner 100's rim, teetering, then rolling off into the -10) and
      // it paid for a completely different one.
      //
      // What it actually did, in Matt's three recordings: every single 100 in them was a ball
      // that went UP to the top of the machine, loitered against the backboard or the right rail
      // for half a second to a second, came back DOWN onto the top-right 100, came to rest on
      // its rim - and was paid 100. Same basket every time. Not one was a ball thrown into the
      // basket. His rack went 140 to 440 on it. Matt: "the machine is broken."
      //
      // It is also section 3b's guard, broken by the person who wrote this: A BALL THAT COMES TO
      // REST ON THE FACE IS NOT SCORED. The only way to score a hole's value is to fall through
      // its mouth. A ball balanced on a rim is on the wall, not in the basket, and what happens
      // next is gravity's business - it tips in and scores, or it rolls off and does not.
      const needH = lip > 0 ? need + Math.max(0, fh.h - lip) : need;
      // time to fall `needH` given the current inward speed: 0.5*gPerp*t^2 - hDot*t - needH = 0
      const tDrop = (hDot + Math.sqrt(hDot * hDot + 2 * gPerp * needH)) / gPerp;
      if (vFace * tDrop > cross) continue;            // too fast for this mouth: it rolls on
      st.captured = id;
      st.capturedFaceY = p.y;
      ball.collisionFilterMask = capturedMask(G, st, id);   // the slab and this collar let go
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

  // 6. The watchdog: anchored displacement, never speed (jitter fools speed). A ball that has
  //    not moved 3cm in 0.6s is PARKED, and on this machine parked means over: it scores nothing
  //    and it vanishes. Matt's rule, 2026-08-22: "Stuck balls should score ZERO. and not be
  //    moved. It should vanish."
  //
  //    THE PERCH, and why the two "nudges" that used to sit here are gone (2026-08-26). Matt,
  //    playing the fixed build: "the ball sometimes gets stuck IN the negative baskets. Like
  //    instead of falling in, it's just stuck there."
  //
  //    Measured, and it is geometry. Every stall in a 41x21 sweep landed at the SAME PLACE -
  //    world z -2.289, y 0.579 or 0.627 - which is the back rim of the -20/-10/-20 cups where
  //    they stand against the riser behind them (cup centre z -2.235, rim top y 0.585; riser
  //    front face z -2.234, top y 0.620). The bottom row's cups are the widest on the machine
  //    (r 0.109 against the mid row's 0.070) and sit 3in back against their riser, so rim and
  //    riser form a cradle a ball can balance in. THE CLASSIC never needed a rule for this: one
  //    continuous slope, so a resting ball always rolls back down. A STAIRCASE removed that
  //    guarantee and nothing replaced it - see section 3b, which still assumes a resting ball
  //    rolls home on its own.
  //
  //    Capture cannot save it either, and should not: the guard needs `f.h < ballR * 1.9`
  //    (0.104), and a ball perched on top of a 0.146 collar is at f.h ~ 0.20. It is not in the
  //    mouth. It is on the wall.
  //
  //    So the ball parks, and the OLD watchdog then took 0.9s + 0.9s + 0.9s to give up on it -
  //    two pops that visibly twitched it and 2.7s of a dead ball on screen. Measured over the
  //    same 861 throws: the watchdog fired on 65 (7.5% - about one ball every other rack), 57 of
  //    those went all the way to jammed, and the pops rescued ONE ball in 861 - into a -20. They
  //    bought nothing and cost the player a second and a half of staring at a stuck ball.
  //
  //    Straight to jammed at 0.6s. Effect on the same grid: worst dead-still stretch 2.62s ->
  //    0.57s, median settle 2.42s -> 2.12s, and exactly TWO of 861 outcomes move, both a -20
  //    becoming a 0 (a ball that was perched on a penalty rim now dies there instead of being
  //    poked in). GUARD: 0.6 is measured, not chosen. At 0.45s the sweep starts killing real
  //    throws - a 100 became a 0 - and shortening the window while KEEPING the pops is worse
  //    still: 63 outcomes move and 44 of them go against the player, because a pop near the
  //    bottom row mostly knocks the ball into a penalty cup. test-brickcity-stall.mjs pins it.
  //
  //    BRICK CITY ONLY, per the HARD RULE in skeeball/CLAUDE.md. The other four machines keep
  //    their pops; THE CLASSIC in particular has the slope that makes them harmless.
  //
  //    AND SPEED IS A VETO ON IT (2026-09-04). Matt, with a clip and the frames either side of
  //    it: a ball on the top step "vanishes and is counted as a MISS while it's still moving. It
  //    could have rolled down into another basket."
  //
  //    He is describing the anchor exactly. The clock only restarts once the ball has covered
  //    3 cm FROM THE ANCHOR POINT, so a ball that settles for half a second and then starts
  //    rolling is killed at 0.6 s having not yet earned a reset - while rolling. Measured over a
  //    21x41 grid: the watchdog fired on 77 of 861 throws, and 63 of those balls were moving
  //    faster than 10 cm/s at the instant it fired (median 0.19 m/s, still spinning at 4.4 rad/s,
  //    a median 7.4 cm of PATH travelled inside a 3 cm bubble). Half of them died at u ~ 0.44 on
  //    the top tread - the channel between an outer 100's collar (outer edge 0.371) and the side
  //    rail (0.500), 12.9 cm against a 10.9 cm ball - rolling home at 0.22 m/s in almost pure +z.
  //
  //    THE DISPLACEMENT ANCHOR IS STILL THE PRIMARY TEST and must stay that way: it is the only
  //    thing that catches a ball JITTERING in a cradle, which is what the 2026-08-26 rewrite was
  //    written for, and speed alone is jitter-blind (the pinball lesson). Speed only VETOES it.
  //    The case the rule exists for is untouched, and that is measured too, not argued: the
  //    -20 cradle kills read a median 0.00 to 0.01 m/s, three orders of magnitude under this
  //    threshold. `t0` bounds the veto - a ball that oscillates inside the bubble without ever
  //    leaving it still dies, at 2.0 s instead of never.
  const moved = Math.hypot(p.x - st.anchor.x, p.y - st.anchor.y, p.z - st.anchor.z);
  const stillish = ball.velocity.length() < 0.05 && ball.angularVelocity.length() < 1.0;
  if (moved > 0.03) st.anchor = { x: p.x, y: p.y, z: p.z, t: st.t, t0: st.t };
  else if (!stillish && st.t - (st.anchor.t0 != null ? st.anchor.t0 : st.anchor.t) <= 2.0) {
    st.anchor.t = st.t;                     // moving, and not yet out of rope: the clock restarts
  } else if (st.t - st.anchor.t > 0.6) {
    st.emergencyUsed = true;
    finishAt(st, 'corner0', 0, 'gutter');
    return;
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

// `substep` is exported for hoops4/js/test.js, which has to watch a throw MID-FLIGHT (which
// hole captured it, and whether a ball parked on a saddle ever leaves) - questions simulateThrow's
// summary cannot answer.
export { substep };
export default { startThrow, step, takeEvents, simulateThrow, substep };
