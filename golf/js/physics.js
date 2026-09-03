// golf/js/physics.js - pure (Node-safe): cannon-es world, full-shot simulation -> trajectory.
// A shot is simulated completely, up front, in one call. The UI plays the trajectory back.
// Deterministic: no Math.random, fixed dt, no accumulator, no variable substeps. The only
// randomness is rng(input.seed), used for the mishit direction. See §7 of GOLF-HANDOFF.md.

import * as CANNON from './vendor/cannon-es.js';
import { S, heightAt, normalAt, surfaceAt, rng } from './terrain.js';
import { clubById, LIE, lieSpeedMod, lieSpinMod } from './clubs.js';
import { airForce, SIDE_TILT } from './flight.js';

// dt is 1/960, not the originally-specced 1/240: cannon-es has no continuous collision
// detection, and sphere-vs-heightfield tunnels above ~10 m/s of impact speed at 1/240 (measured,
// ~50% of a sampled grid on real terrain). See DECISIONS.md#heightfield-tunneling-and-dt.
const H = 1 / 960;
const MAX_T = 20;
export const STEP = H;
const SAMPLE_EVERY = 16; // 16 * 1/960 = 1/60s, same real-time sample rate as before

const BALL_R = 0.02134;
const BALL_M = 0.04593;
const CUP_R = 0.054;

// (tune, Part 2): grounded backspin brake, m/s^2 of deceleration per rad/s of remaining
// backspin. Reset restitution/roll to realistic starting points and re-tuned with this - the
// missing club-distinguishing term was spin, not more rollout knobs. See
// DECISIONS.md#spin-brake-part2.
export const SPIN_BRAKE = 0.008;

// (tune, Part 2): spin bite at impact, m/s of tangential speed removed per rad/s of backspin,
// applied ONCE per land/bounce event. The grounded brake alone could not reach the 7 iron: its
// backspin was spent by the per-contact decay across several bounces before the ball ever
// settled into a continuous roll. The bite acts at the moment of contact instead, which is
// where a real ball's backspin does its work. See DECISIONS.md#spin-bite-part2.
export const SPIN_BITE = 0.005;

// Fraction of backspin surviving each ground contact (was 0.4 - raised Part 2 so an iron still
// has spin left to bite with on its second and third bounces).
const SPIN_RETAIN = 0.6;

// grip: fraction of TANGENTIAL (horizontal) velocity lost on every land/bounce impact - grass
// grips the ball's horizontal momentum on impact. rest/roll reset to realistic starting points
// Part 2 (2026-09-02) and re-tuned alongside SPIN_BRAKE above; GREEN untouched throughout
// (tuned Part 1: putter 100% -> 36m). See DECISIONS.md#spin-brake-part2.
//
// Frozen (both this object and every row) so a tuning script can never silently mutate shared
// state across measurements - part of tracking down Part 2's reproducibility problem. A script
// that needs different values must build its own terrain and pass the values through, never
// assign into these. See DECISIONS.md#reproducibility-part2.
export const SURF = {
  [S.OB]:      { rest: 0.30, fric: 0.60, roll: 0.10,    grip: 0.50 },
  [S.ROUGH]:   { rest: 0.25, fric: 0.70, roll: 0.80,    grip: 0.55 },
  [S.FAIRWAY]: { rest: 0.40, fric: 0.40, roll: 0.18,    grip: 0.35 },
  [S.FRINGE]:  { rest: 0.35, fric: 0.35, roll: 0.08,    grip: 0.35 },
  [S.GREEN]:   { rest: 0.35, fric: 0.30, roll: 0.03589, grip: 0.30 }, // tuned Part 1: putter 100% -> 36m
  [S.SAND]:    { rest: 0.08, fric: 0.90, roll: 0.30,    grip: 0.80 },
  [S.WATER]:   { rest: 0.00, fric: 1.00, roll: 1.00,    grip: 1.00 },
  [S.TEE]:     { rest: 0.40, fric: 0.40, roll: 0.18,    grip: 0.35 }, // mirrors FAIRWAY (same grass)
};
for (const key of Object.keys(SURF)) Object.freeze(SURF[key]);
Object.freeze(SURF);

// The z-mapping IS mirrored (verified in Part 1: with matrix[i][j] = height[i+j*nx] and
// position (x0,0,z0), the ball fell straight through - cannon-es's Heightfield rotates local Z
// (height) to world Y via quaternion(-PI/2,0,0), which sends local Y to world -Z. So position is
// shifted to z0+(nz-1) and j is read in reverse. See DECISIONS.md#heightfield-z-mirror.
function buildTerrainBody(t) {
  const matrix = [];
  for (let i = 0; i < t.nx; i++) {
    const col = [];
    for (let j = 0; j < t.nz; j++) col.push(t.height[i + (t.nz - 1 - j) * t.nx]);
    matrix.push(col);
  }
  const shape = new CANNON.Heightfield(matrix, { elementSize: 1 });
  const body = new CANNON.Body({ mass: 0 });
  body.addShape(shape);
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  body.position.set(t.x0, 0, t.z0 + (t.nz - 1));
  return body;
}

function len2(v) { return Math.sqrt(v.x * v.x + v.z * v.z); }

// Ground guard, §7.2 amendment: belt-and-braces over cannon-es's own contact resolution, which
// occasionally fails to catch a fast-falling sphere against the heightfield even at dt=1/960.
// Fires only when the ball's CENTER is at or below the terrain surface (pen > radius, ~21mm) -
// cannon's own contact settle penetrates a few mm, never that much; true tunneling is metres.
// Snapping the ball back above the surface means this can't re-fire on the same contact.
// Reflects only the normal component of velocity; tangential (rolling) velocity is untouched.
// Returns true if a correction was applied.
function applyGroundGuard(terrain, ballBody, restitution) {
  const surfH = heightAt(terrain, ballBody.position.x, ballBody.position.z);
  if (ballBody.position.y >= surfH) return false;
  ballBody.position.y = surfH + BALL_R;
  const n = normalAt(terrain, ballBody.position.x, ballBody.position.z);
  const vn = ballBody.velocity.x * n.x + ballBody.velocity.y * n.y + ballBody.velocity.z * n.z;
  if (vn < 0) {
    const factor = (1 + restitution) * vn;
    ballBody.velocity.x -= factor * n.x;
    ballBody.velocity.y -= factor * n.y;
    ballBody.velocity.z -= factor * n.z;
  }
  return true;
}

// Test-only: drop a ball with zero velocity from (x, 5, z) and settle it, to verify the
// heightfield mapping in isolation from any shot semantics. Used by test.js #1.
export function dropTest(terrain, x, z) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.solver.iterations = 10;
  world.broadphase = new CANNON.NaiveBroadphase();
  const groundMat = new CANNON.Material('ground');
  const ballMat = new CANNON.Material('ball');
  const contact = new CANNON.ContactMaterial(ballMat, groundMat, { friction: 0.4, restitution: 0.1 });
  world.addContactMaterial(contact);
  const terrainBody = buildTerrainBody(terrain);
  terrainBody.material = groundMat;
  world.addBody(terrainBody);
  const ballBody = new CANNON.Body({ mass: BALL_M, shape: new CANNON.Sphere(BALL_R) });
  ballBody.material = ballMat;
  // heavy damping: this is a vertical-placement check, not a rollout simulation. Without it,
  // the ground guard's frequent position correction interrupts cannon-es's own friction cadence
  // and the ball can slide tens of metres before settling, which only muddies this test.
  ballBody.linearDamping = 0.9;
  ballBody.position.set(x, 5, z);
  world.addBody(ballBody);
  let stopStreak = 0;
  let t = 0;
  while (t < 20) {
    world.step(H);
    t += H;
    applyGroundGuard(terrain, ballBody, 0.1);
    if (ballBody.velocity.length() < 0.02) {
      stopStreak += H;
      if (stopStreak >= 0.3) break;
    } else {
      stopStreak = 0;
    }
  }
  return { x: ballBody.position.x, y: ballBody.position.y, z: ballBody.position.z };
}

export function simulateShot(terrain, input) {
  const { from, dirDeg, clubId, lie, power01, spin01, wind, seed } = input;
  // Part 9B: sidespin. -1 = hook (curves toward -x when travelling +z), +1 = slice (+x). Absent
  // or 0 -> bit-identical to the pre-9B model (the tilt below multiplies by cos(0) = 1 exactly
  // and adds sin(0) = 0 exactly). Ignored for putts, which carry no spin at all.
  const curve01 = Math.max(-1, Math.min(1, Number(input.curve01) || 0));
  const club = clubById(clubId);
  const isPutt = clubId === 'pt';
  const gen = rng((seed >>> 0) || 0);

  // mishit: if power01 < 0.6, lateral error (0.6 - power01) * 4 deg, direction from seeded rng
  let mishitErr = 0;
  if (power01 < 0.6) {
    const mag = (0.6 - power01) * 4;
    mishitErr = gen() < 0.5 ? -mag : mag;
  }

  const dir = dirDeg + mishitErr;
  const dirRad = dir * Math.PI / 180;
  const launchRad = (club.launch || 0) * Math.PI / 180;

  let speed, omega;
  if (isPutt) {
    speed = 6.5 * power01;
    omega = 0;
  } else {
    speed = club.speed * lieSpeedMod(lie, clubId) * power01;
    const spinMod = 1 - 0.6 * spin01; // spin01=-1 -> 1.6x, +1 -> 0.4x
    const rpm = club.spin * lieSpinMod(lie) * spinMod;
    omega = rpm * 2 * Math.PI / 60;
  }

  const v0 = {
    x: speed * Math.sin(dirRad) * Math.cos(launchRad),
    y: speed * Math.sin(launchRad),
    z: speed * Math.cos(dirRad) * Math.cos(launchRad),
  };
  // spin axis: horizontal, perpendicular to dir, positive = backspin.
  // = travelDir x up, so cross(spinAxis, vr) points UP at launch (Magnus lift). The old
  // (cos, 0, -sin) was the negation of this and made backspin act as DOWNFORCE - see
  // DECISIONS.md#spinaxis-sign-bug.
  //
  // Part 9B: the axis is then tilted about the TRAVEL direction by curve01 x SIDE_TILT (Rodrigues:
  // perp x cos(tilt) + up x sin(tilt), since travel x perp = -up). That gives the Magnus force a
  // lateral component of full strength (up x vr is horizontal and |vr| long, for the whole
  // flight) while its vertical component scales by cos(tilt). GOLF-PART9.md wrote
  // "rotateAboutY", which would keep the axis horizontal - and a horizontal axis crossed with a
  // near-horizontal vr gives a lateral force of only sin(launch) x that, which also flips sign
  // on the descent; it cannot reach the 25-45 m band at any SIDE_TILT. Sign: +curve01 -> +x
  // (slice) when travelling +z, checked by test 3c. See DECISIONS.md#part9b-sidespin.
  const tilt = isPutt ? 0 : curve01 * SIDE_TILT * Math.PI / 180;
  const spinAxis = {
    x: -Math.cos(dirRad) * Math.cos(tilt),
    y: Math.sin(tilt),
    z: Math.sin(dirRad) * Math.cos(tilt),
  };

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.solver.iterations = 10;
  world.broadphase = new CANNON.NaiveBroadphase();

  const groundMat = new CANNON.Material('ground');
  const ballMat = new CANNON.Material('ball');
  const contact = new CANNON.ContactMaterial(ballMat, groundMat, { friction: 0.4, restitution: 0.4 });
  world.addContactMaterial(contact);

  const terrainBody = buildTerrainBody(terrain);
  terrainBody.material = groundMat;
  world.addBody(terrainBody);

  const ballBody = new CANNON.Body({ mass: BALL_M, shape: new CANNON.Sphere(BALL_R) });
  ballBody.material = ballMat;
  ballBody.linearDamping = 0;
  ballBody.angularDamping = 0;
  const startY = isPutt ? heightAt(terrain, from.x, from.z) + BALL_R : heightAt(terrain, from.x, from.z) + BALL_R + 0.001;
  ballBody.position.set(from.x, startY, from.z);
  ballBody.velocity.set(v0.x, v0.y, v0.z);
  world.addBody(ballBody);

  const windVec = { x: (wind && wind.x) || 0, y: 0, z: (wind && wind.z) || 0 };

  const samples = [];
  const events = [];
  let t = 0;
  let stepCount = 0;
  let wasGrounded = isPutt;
  let carryM = null;
  let lipUsed = false;
  let obStreak = 0;
  let stopStreak = 0;
  let landingXZ = { x: from.x, z: from.z };
  let outcome = null;
  let rest = null;
  let spinMag = omega;

  const cupCenter = terrain.def.pin;

  function groundedNow() {
    const surfH = heightAt(terrain, ballBody.position.x, ballBody.position.z);
    return (ballBody.position.y - surfH) < (BALL_R + 0.01);
  }

  while (t < MAX_T) {
    const grounded = groundedNow();
    const surf = surfaceAt(terrain, ballBody.position.x, ballBody.position.z);
    const surfProps = SURF[surf] || SURF[S.ROUGH];

    contact.friction = surfProps.fric;
    contact.restitution = surfProps.rest;

    if (!grounded) {
      const f = airForce(ballBody.velocity, spinMag, spinAxis, windVec);
      ballBody.applyForce(new CANNON.Vec3(f.x, f.y, f.z));
      spinMag *= Math.exp(-H / 25);
    } else {
      const speedH = len2(ballBody.velocity);
      if (speedH >= 0.02) {
        const vhat = { x: ballBody.velocity.x / speedH, z: ballBody.velocity.z / speedH };
        const rollF = surfProps.roll * BALL_M * 9.81;
        ballBody.applyForce(new CANNON.Vec3(-rollF * vhat.x, 0, -rollF * vhat.z));
      }
      // grounded backspin brake, §7.4 amendment: while grounded and spinning, a horizontal
      // force opposing travel, proportional to remaining backspin. Fast grounded decay (tau
      // 0.6s) means this is mostly spent within a second of landing - what makes a wedge check
      // up while a driver, with much less relative backspin, does not. Backspin never goes
      // negative in this model. See DECISIONS.md#spin-brake-part2.
      if (spinMag > 1e-6) {
        const speedNow = len2(ballBody.velocity);
        if (speedNow > 1e-6) {
          const travelDir = { x: ballBody.velocity.x / speedNow, z: ballBody.velocity.z / speedNow };
          const brakeMag = BALL_M * SPIN_BRAKE * spinMag;
          ballBody.applyForce(new CANNON.Vec3(-brakeMag * travelDir.x, 0, -brakeMag * travelDir.z));
        }
        spinMag *= Math.exp(-H / 0.6);
        if (spinMag < 0) spinMag = 0;
      }
    }

    world.step(H);
    t += H;
    stepCount++;

    applyGroundGuard(terrain, ballBody, surfProps.rest);

    const nowGrounded = groundedNow();

    // ground-contact spin decay + landing/bounce events
    if (nowGrounded && !wasGrounded) {
      // horizontal impact loss (Part 2 amendment): grass grips the ball's tangential momentum
      // on impact - applies to every land/bounce transition regardless of whether cannon's own
      // contact or the ground guard produced it, since both funnel through this one transition
      // check. See DECISIONS.md#rollout-tuning-part2.
      const landSurf = surfaceAt(terrain, ballBody.position.x, ballBody.position.z);
      const grip = (SURF[landSurf] || SURF[S.ROUGH]).grip;
      ballBody.velocity.x *= (1 - grip);
      ballBody.velocity.z *= (1 - grip);

      // spin bite: backspin biting the turf at the moment of impact, removing tangential speed
      // in proportion to the spin the ball still carries. Clamped at the tangential speed
      // itself, so a bite can stop the ball dead but never reverse it - only the grounded
      // brake can pull a heavily-spinning wedge back. See DECISIONS.md#spin-bite-part2.
      if (spinMag > 1e-6) {
        const vt = len2(ballBody.velocity);
        if (vt > 1e-6) {
          const bite = Math.min(vt, SPIN_BITE * spinMag);
          const keep = (vt - bite) / vt;
          ballBody.velocity.x *= keep;
          ballBody.velocity.z *= keep;
        }
      }
      spinMag *= SPIN_RETAIN; // per-contact spin loss
      if (carryM === null) {
        carryM = Math.hypot(ballBody.position.x - from.x, ballBody.position.z - from.z);
        landingXZ = { x: ballBody.position.x, z: ballBody.position.z };
        events.push({ t, kind: 'land', x: ballBody.position.x, z: ballBody.position.z });
      } else {
        events.push({ t, kind: 'bounce', x: ballBody.position.x, z: ballBody.position.z });
      }
    }
    wasGrounded = nowGrounded;

    if (stepCount % SAMPLE_EVERY === 0) {
      samples.push({ t, x: ballBody.position.x, y: ballBody.position.y, z: ballBody.position.z });
    }

    const curSurf = surfaceAt(terrain, ballBody.position.x, ballBody.position.z);

    // 1. water
    if (nowGrounded && curSurf === S.WATER) {
      let restPos = { x: from.x, z: from.z };
      for (let k = samples.length - 1; k >= 0; k--) {
        const sp = samples[k];
        if (surfaceAt(terrain, sp.x, sp.z) !== S.WATER) { restPos = { x: sp.x, z: sp.z }; break; }
      }
      outcome = 'water';
      rest = { x: restPos.x, y: heightAt(terrain, restPos.x, restPos.z), z: restPos.z };
      events.push({ t, kind: 'water', x: ballBody.position.x, z: ballBody.position.z });
      break;
    }

    // 2. OB (20 consecutive steps on OB at the original dt=1/240, i.e. 1/12s - kept as a
    // real-time duration since dt changed; see the ground-guard/dt note above.
    if (nowGrounded && curSurf === S.OB) {
      obStreak += H;
      if (obStreak >= 20 / 240) {
        outcome = 'ob';
        rest = { x: from.x, y: heightAt(terrain, from.x, from.z), z: from.z };
        events.push({ t, kind: 'ob', x: ballBody.position.x, z: ballBody.position.z });
        break;
      }
    } else {
      obStreak = 0;
    }

    // 3. hole
    const dCup = Math.hypot(ballBody.position.x - cupCenter[0], ballBody.position.z - cupCenter[1]);
    const speedNow = len2(ballBody.velocity);
    if (dCup < CUP_R && nowGrounded) {
      if (speedNow < 1.6) {
        outcome = 'hole';
        rest = { x: ballBody.position.x, y: ballBody.position.y, z: ballBody.position.z };
        events.push({ t, kind: 'hole', x: ballBody.position.x, z: ballBody.position.z });
        break;
      } else if (!lipUsed) {
        lipUsed = true;
        events.push({ t, kind: 'lip', x: ballBody.position.x, z: ballBody.position.z });
        const vx = ballBody.velocity.x, vz = ballBody.velocity.z;
        const ang = 60 * Math.PI / 180;
        const nvx = (vx * Math.cos(ang) - vz * Math.sin(ang)) * 0.55;
        const nvz = (vx * Math.sin(ang) + vz * Math.cos(ang)) * 0.55;
        ballBody.velocity.x = nvx;
        ballBody.velocity.z = nvz;
      }
    }

    // 5. stop
    const speed3 = ballBody.velocity.length();
    if (nowGrounded && speed3 < 0.05) {
      stopStreak += H;
      if (stopStreak >= 0.5) {
        outcome = 'stop';
        rest = { x: ballBody.position.x, y: ballBody.position.y, z: ballBody.position.z };
        break;
      }
    } else {
      stopStreak = 0;
    }
  }

  if (outcome === null) {
    outcome = 'stop';
    rest = { x: ballBody.position.x, y: ballBody.position.y, z: ballBody.position.z };
  }

  if (carryM === null) carryM = Math.hypot(rest.x - from.x, rest.z - from.z);
  const totalM = Math.hypot(rest.x - from.x, rest.z - from.z);
  const restLie = surfaceAt(terrain, rest.x, rest.z);

  return { samples, events, rest, lie: restLie, outcome, carryM, totalM };
}
