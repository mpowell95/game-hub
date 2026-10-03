// cup-pong/js/physics.js - THE BALL, simulated by cannon-es. DOM-free, so node can run it.
//
// GUARD: NOTHING HERE SCRIPTS A REACTION. The table is a box, every cup is a real hollow cone
// (wall boxes round a circle, small spheres along the rim so it is round to the ball), and the
// ball is a real sphere with mass and spin. Rim rattles, a ball rolling round a rim and out,
// bounces off the table and off cups, a ball falling off the end - all of it is the contact
// solver. The brief says it plainly: "The ball is real physics (cannon-es), not a canned
// animation."
//
// THE ONE RULE THAT IS NOT THE ENGINE is what counts as MADE: the ball's centre below the rim by
// a full radius (so all of it is below the rim plane) while inside that cup's wall. Nothing can
// get there except by going in over the rim, because the walls are solid. It is decided, not
// predicted - no capture guess that can later be wrong (skeeball's HOT SHOT lesson).
//
// NO MAGNETISM, EVER (skeeball's standing ban): nothing steers a ball toward a cup.
//
// Deterministic: fixed 1/480 s step, fixed solver iterations, no rng. One fresh world per throw.
// Public surface: startThrow({ power, aim, cups }) -> st, step(st, dt), takeEvents(st),
// simulateThrow(params) for the tests.

import * as CANNON from '../../skeeball/js/vendor/cannon-es.js';
import { TABLE, CUP, BALL, THROW, DRAG_K, MAT, GRAVITY } from './geom.js';

// 1/480, not skeeball's 1/240: a cup wall is 6 mm and the ball is fast. At 1/240 a 6 m/s ball
// moves 2.5 cm per step, which can carry its centre past a wall's mid-plane in one step, and the
// solver then pushes it out the WRONG side - through the cup. At 1/480 it moves 1.25 cm.
const H = 1 / 480;
export const STEP = H;
const MAX_T = 6;                 // a throw that has not resolved by now is a miss (tests: never)
const REST_V = 0.06;             // below this for REST_T the ball is at rest
const REST_T = 0.35;
// Rolling resistance on the table. The solver has none, so without it a ball rolling at 10 cm/s
// never stops, and every soft miss ran to the 6 s cap.
const ROLL_DECEL = 0.8;          // m/s^2

// ONE cup's shapes, built once and reused by every world. A cup is a single BODY holding all its
// shapes, so the broadphase sees ~12 bodies, not ~400.
let _cupShapes = null;
function cupShapes() {
  if (_cupShapes) return _cupShapes;
  const { topR, botR, h, wall, segs } = CUP;
  const out = [];
  const tilt = Math.atan2(topR - botR, h);            // the wall leans OUT going up
  const slant = Math.hypot(h, topR - botR);
  const midR = (topR + botR) / 2 + wall / 2;          // box centre; its INNER face is the cone
  const halfW = (Math.PI * (topR + botR) / segs) / 2 * 1.08;   // a little overlap, no slits
  const box = new CANNON.Box(new CANNON.Vec3(halfW, slant / 2, wall / 2));
  const qx = new CANNON.Quaternion();
  qx.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tilt);
  for (let k = 0; k < segs; k++) {
    const phi = (k / segs) * Math.PI * 2;
    const qy = new CANNON.Quaternion();
    qy.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), phi);
    // local +z is radial after the y rotation: (sin phi, cos phi) in (x, z)
    out.push({
      shape: box,
      offset: new CANNON.Vec3(Math.sin(phi) * midR, h / 2, Math.cos(phi) * midR),
      orient: qy.mult(qx),
      part: 'wall',
    });
  }
  // THE RIM. Box tops meet in a polygon with corners; a ring of small spheres over them makes
  // the rim ROUND to the ball, which is what lets it roll round a rim and drop in or fall out.
  const rimR = topR + wall / 2;
  const bead = new CANNON.Sphere(wall / 2 + 0.0008);
  for (let k = 0; k < segs * 2; k++) {
    const phi = (k / (segs * 2)) * Math.PI * 2;
    out.push({ shape: bead, offset: new CANNON.Vec3(Math.sin(phi) * rimR, h, Math.cos(phi) * rimR), orient: null, part: 'rim' });
  }
  // The base. A made ball never reaches it (made fires higher up), but a cup is not a pipe.
  const base = new CANNON.Box(new CANNON.Vec3(botR * 0.72, 0.003, botR * 0.72));
  out.push({ shape: base, offset: new CANNON.Vec3(0, 0.003, 0), orient: null, part: 'base' });
  _cupShapes = out;
  return out;
}

/** Inner radius of the cup at height y above the table. */
export function innerR(y) {
  const f = Math.max(0, Math.min(1, y / CUP.h));
  return CUP.botR + (CUP.topR - CUP.botR) * f;
}

function buildWorld(cups) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();   // ~12 bodies: nothing to gain, and stable order
  world.allowSleep = false;
  world.solver.iterations = 12;

  const matBall = new CANNON.Material('ball');
  const matTable = new CANNON.Material('table');
  const matCup = new CANNON.Material('cup');
  // A ping pong ball on a table bounces high (e ~0.8); on a thin plastic cup it loses more.
  const cmTable = new CANNON.ContactMaterial(matBall, matTable, { friction: MAT.tableFric, restitution: MAT.tableRest });
  world.addContactMaterial(cmTable);
  world.addContactMaterial(new CANNON.ContactMaterial(matBall, matCup, { friction: MAT.cupFric, restitution: MAT.cupRest }));

  const table = new CANNON.Body({ mass: 0, material: matTable });
  table.addShape(new CANNON.Box(new CANNON.Vec3(TABLE.width / 2, TABLE.thick / 2, TABLE.len / 2)));
  table.position.set(0, -TABLE.thick / 2, 0);
  table.userData = { kind: 'table' };
  world.addBody(table);

  const cupBodies = [];
  for (const k of cups) {
    const b = new CANNON.Body({ mass: 0, material: matCup });
    for (const s of cupShapes()) b.addShape(s.shape, s.offset, s.orient || undefined);
    b.position.set(k.x, 0, k.z);
    b.userData = { kind: 'cup', id: k.id };
    world.addBody(b);
    cupBodies.push(b);
  }

  const ball = new CANNON.Body({ mass: BALL.mass, material: matBall, shape: new CANNON.Sphere(BALL.r) });
  ball.linearDamping = 0;          // drag is applied by hand below: it is quadratic, not linear
  ball.angularDamping = 0.05;
  world.addBody(ball);
  return { world, ball, cupBodies, cmTable };
}

/** Swipe power -> launch speed, m/s. Power is NOT clamped to 0..1: those are the ends of the
 *  natural swipe range (skeeball/js/swipe.js), and a harder or softer swipe than that still means
 *  something. Spent as ENERGY (v^2 interpolated), because range goes as the square of speed. */
export function launchSpeed(power) {
  const p = Math.max(-1, power);
  const a = THROW.minSpeed, b = THROW.maxSpeed;
  return Math.sqrt(Math.max(1, a * a + p * (b * b - a * a)));
}

/** Aim (radians of swipe, already scaled by the caller) -> heading, clamped. */
export const heading = (aim) => Math.max(-THROW.aimMax, Math.min(THROW.aimMax, aim));

/**
 * Start one throw. `cups` is [{ id, x, z }] - the cups still standing on the rack being shot at.
 * `power` and `aim` come from the swipe (ui.js); `aim` is the HEADING in radians.
 */
export function startThrow({ power = 0.5, aim = 0, cups = [] } = {}) {
  const { world, ball, cupBodies, cmTable } = buildWorld(cups);
  const v = launchSpeed(power);
  const a = heading(aim);
  ball.position.set(0, THROW.y0, THROW.z0);
  const horiz = v * Math.cos(THROW.elev);
  ball.velocity.set(Math.sin(a) * horiz, v * Math.sin(THROW.elev), -Math.cos(a) * horiz);
  ball.angularVelocity.set(0, 0, 0);

  const st = {
    world, ball, cupBodies, cups,
    t: 0, acc: 0, done: false, outcome: null,
    events: [],
    restT: 0,
    tableHits: 0,        // table contacts BEFORE a cup is made - stage 4 reads this for bounce shots
    touchedCup: false,
    power, aim: a, speed: v,
  };
  ball.addEventListener('collide', (e) => {
    const u = e.body && e.body.userData;
    if (!u || st.done) return;
    let vn = 0;
    try { vn = Math.abs(e.contact.getImpactVelocityAlongNormal()); } catch {}
    if (vn < 0.08) return;                        // resting contact, not a bounce
    if (u.kind === 'table') {
      // A real ball bounce scrubs off forward speed (it grips and starts to spin). Without this a
      // bounced ball kept its full speed and skimmed across small racks instead of dropping in.
      const keep = MAT.tableSkid == null ? 1 : MAT.tableSkid;
      if (keep !== 1) { ball.velocity.x *= keep; ball.velocity.z *= keep; }
      // Only the FIRST bounce is the lively one (the bounce shot); after it the table goes back to
      // a dead bounce, or a ball dribbling on a 0.95 table never comes to rest.
      if (MAT.tableRestLater != null) cmTable.restitution = MAT.tableRestLater;
      st.tableHits++;
      st.events.push({ type: 'table', v: vn, x: ball.position.x, z: ball.position.z });
    } else if (u.kind === 'cup') {
      st.touchedCup = true;
      st.events.push({ type: 'cup', id: u.id, v: vn });
    }
  });
  return st;
}

function finish(st, outcome) {
  st.done = true;
  st.outcome = outcome;
  st.events.push({ type: 'done', outcome });
}

function substep(st) {
  const { world, ball } = st;
  // Quadratic air drag, applied as a velocity change: a = -k |v| v.
  const vx = ball.velocity.x, vy = ball.velocity.y, vz = ball.velocity.z;
  const sp = Math.hypot(vx, vy, vz);
  if (sp > 0) {
    const f = Math.max(0, 1 - DRAG_K * sp * H);
    ball.velocity.set(vx * f, vy * f, vz * f);
  }
  world.step(H);
  st.t += H;
  const p = ball.position;
  if (p.y < BALL.r + 0.002 && Math.abs(ball.velocity.y) < 0.2 && Math.abs(p.x) < TABLE.width / 2
    && Math.abs(p.z) < TABLE.len / 2) {
    const hv = Math.hypot(ball.velocity.x, ball.velocity.z);
    if (hv > 0) {
      const k = Math.max(0, hv - ROLL_DECEL * H) / hv;
      ball.velocity.x *= k; ball.velocity.z *= k;
      ball.angularVelocity.scale(k, ball.angularVelocity);
    }
  }

  // MADE: all of the ball below the rim plane, inside a cup's wall.
  if (p.y < CUP.h - BALL.r) {
    for (const k of st.cups) {
      const d = Math.hypot(p.x - k.x, p.z - k.z);
      if (d < innerR(p.y) - BALL.r * 0.25) {
        const bounced = st.tableHits > 0;
        st.events.push({ type: 'made', id: k.id, bounced });
        finish(st, { kind: 'made', id: k.id, bounced, t: st.t });
        return;
      }
    }
  }
  // OFF THE TABLE: below the top by more than the ball, or long gone.
  if (p.y < -BALL.r * 3 || Math.abs(p.z) > TABLE.len / 2 + 1.5 || Math.abs(p.x) > 1.5) {
    finish(st, { kind: 'off', t: st.t });
    return;
  }
  // AT REST (on the table, or sat on top of the cups).
  const speed = ball.velocity.length();
  st.restT = speed < REST_V ? st.restT + H : 0;
  if (st.restT >= REST_T) { finish(st, { kind: 'miss', t: st.t }); return; }
  if (st.t >= MAX_T) finish(st, { kind: 'miss', t: st.t, capped: true });
}

export function step(st, dt) {
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

/** One throw to its outcome without a clock. The tests' whole view of the table. */
export function simulateThrow(params) {
  const st = startThrow(params);
  const events = [];
  let guard = Math.ceil((MAX_T + 1) / H);
  let maxZ = -Infinity, minZ = Infinity, firstTable = null;
  while (!st.done && guard-- > 0) {
    substep(st);
    for (const e of st.events) {
      events.push(e);
      if (e.type === 'table' && !firstTable) firstTable = { x: e.x, z: e.z };
    }
    st.events = [];
    maxZ = Math.max(maxZ, st.ball.position.z);
    minZ = Math.min(minZ, st.ball.position.z);
  }
  return {
    outcome: st.outcome, time: st.t, tableHits: st.tableHits, touchedCup: st.touchedCup,
    firstTable, minZ, events: events.map((e) => e.type),
  };
}

export { substep };
export default { startThrow, step, takeEvents, simulateThrow, launchSpeed, heading, innerR, STEP };
