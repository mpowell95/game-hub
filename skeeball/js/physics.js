// skeeball/js/physics.js - the deterministic ball simulation. Pure: no DOM, no storage, no
// Math.random anywhere. Same throw parameters, same board, same outcome, every time - which is
// what makes the engine headless-testable (skeeball/js/test.js sweeps the whole power range) and
// keeps the tuning honest: a shot feels hard because the geometry makes it hard, never because a
// dice roll said so.
//
// The model, in the order the ball experiences it:
//
//   LANE      the ball rolls up the flat bed, slowed by rollFriction, banking off the side rails.
//   RAMP      the hump at the end. Climbing it costs g * lipHeight of speed^2/2; a ball that
//             cannot pay rolls back down the lane to the player (phase 'return' - the ball is
//             NOT spent, exactly like a real alley).
//   FLIGHT    off the lip at launchAngle, under gravity, drifting laterally with whatever aim
//             the swipe gave it.
//   The scoring FACE - an inclined plane (faceTilt from horizontal) rising from the pit floor.
//             Land on it softly (|normal speed| <= captureVn) and the zone under the ball takes
//             it: the twin 100 pockets first, then the concentric rings by distance from the ring
//             centre, then - off the outer edge - the gutter. Land hot and it bounces once
//             (restitution + tangentKeep) and the SECOND contact always settles.
//   SINK      a short scripted settle (roll to the hole, drop through) so the renderer has
//             something true to draw; the score was decided at capture.
//
// World coordinates: x lateral (0 = lane centre, +right), y depth away from the player,
// z up. The lane bed is z = 0; the ball centre rides at z = R on it.
//
// A short ball dies in the pit between the hump and the face (gutter, 0). A ball past the back
// net (cageY) is spent the same way. Both are honest zeroes: the ball was thrown and missed.

export const G = 9.81;
export const R = 0.041;              // ball radius - a 3.25 inch composite ball
export const STEP = 1 / 240;         // fixed physics step; ui and tests both accumulate into it
export const SERVE_Y = 0.55;         // where a fresh ball sits waiting on the lane

/** Start one throw. power and aim both come from the swipe, already normalised:
 *  power 0..1 maps onto the board's minSpeed..maxSpeed; aim -1..1 maps onto +-aimMax radians. */
export function startThrow(board, { power, aim }) {
  const P = board.physics;
  const p = Math.min(1, Math.max(0, +power || 0));
  const a = Math.min(1, Math.max(-1, +aim || 0)) * P.aimMax;
  const s0 = P.minSpeed + p * (P.maxSpeed - P.minSpeed);
  return {
    phase: 'lane',
    x: 0, y: SERVE_Y, z: R,
    vx: s0 * Math.sin(a), vy: s0 * Math.cos(a), vz: 0,
    bounces: 0,
    t: 0,
    acc: 0,                          // step accumulator (ui hands us frame dt)
    sink: null,
    outcome: null,                   // { value, hole } once decided
    events: [],
  };
}

export function takeEvents(state) {
  const out = state.events;
  state.events = [];
  return out;
}

/** Advance by a frame's worth of time, in fixed sub-steps. Returns the state for chaining. */
export function step(board, state, dt) {
  state.acc += Math.min(dt, 0.1);
  while (state.acc >= STEP && state.phase !== 'done') {
    state.acc -= STEP;
    subStep(board, state);
  }
  return state;
}

/** Run a throw to completion (headless: tests, tuning sweeps). */
export function simulateThrow(board, params, maxSeconds = 12) {
  const st = startThrow(board, params);
  const steps = Math.ceil(maxSeconds / STEP);
  for (let i = 0; i < steps && st.phase !== 'done'; i++) subStep(board, st);
  return st;
}

// ---------------------------------------------------------------------------------------------

function subStep(board, st) {
  const P = board.physics;
  st.t += STEP;
  switch (st.phase) {
    case 'lane': return stepLane(P, st, board);
    case 'ramp': return stepRamp(P, st);
    case 'return': return stepReturn(P, st);
    case 'flight': return stepFlight(board, st);
    case 'sink': return stepSink(st);
    default: return undefined;
  }
}

function stepLane(P, st, board) {
  // Rolling friction, applied against the direction of travel along the lane.
  const dir = st.vy >= 0 ? 1 : -1;
  st.vy -= dir * P.rollFriction * STEP;
  st.x += st.vx * STEP;
  st.y += st.vy * STEP;
  st.z = R;

  // Side rails.
  const wall = P.laneW / 2 - R;
  if (st.x > wall) { st.x = wall; st.vx = -Math.abs(st.vx) * P.wallRestitution; }
  else if (st.x < -wall) { st.x = -wall; st.vx = Math.abs(st.vx) * P.wallRestitution; }

  if (st.vy > 0 && st.y >= P.laneLen) {
    st.phase = 'ramp';
  } else if (st.vy <= 0) {
    // Friction won before the hump did - send it home.
    st.phase = 'return';
  }
}

function stepRamp(P, st) {
  // The hump as a quadratic rise: z = lipHeight * u^2 over u = (y - laneLen)/rampLen.
  // Climbing costs slope decel g * dz/dy plus the rolling friction.
  const u = (st.y - P.laneLen) / P.rampLen;
  const slope = (2 * P.lipHeight * Math.max(0, Math.min(1, u))) / P.rampLen; // dz/dy
  const dir = st.vy >= 0 ? 1 : -1;
  st.vy -= (G * slope * Math.sin(Math.atan(slope)) + P.rollFriction) * dir * STEP;
  st.vy -= G * slope * Math.cos(Math.atan(slope)) * 0 * STEP; // (kept explicit: no normal-dir term on a followed surface)
  st.x += st.vx * STEP * 0.6;       // the hump's channel walls straighten the roll a little
  st.y += st.vy * STEP;
  const uu = Math.max(0, Math.min(1, (st.y - P.laneLen) / P.rampLen));
  st.z = R + P.lipHeight * uu * uu;

  if (st.vy <= 0) {
    // Could not pay the climb - back down it comes.
    st.phase = 'return';
    st.events.push({ type: 'shortramp' });
    return;
  }
  if (st.y >= P.laneLen + P.rampLen) {
    // Launch. The hump scrubs some speed (rampLoss) and converts the rest into the lob.
    const s1 = st.vy * P.rampLoss;
    st.vy = s1 * Math.cos(P.launchAngle);
    st.vz = s1 * Math.sin(P.launchAngle);
    st.vx *= P.rampLoss;
    st.z = R + P.lipHeight;
    st.phase = 'flight';
    st.events.push({ type: 'launch', speed: s1 });
  }
}

function stepReturn(P, st) {
  // Rolling back to the player. The bed has a whisper of tilt toward the front (real alleys
  // return dead balls the same way), so a returning ball never stalls mid-lane.
  const u = (st.y - P.laneLen) / P.rampLen;
  if (st.y > P.laneLen) {
    const slope = (2 * P.lipHeight * Math.max(0, Math.min(1, u))) / P.rampLen;
    st.vy -= G * slope * Math.sin(Math.atan(slope)) * STEP;   // the hump pushes it home
    const uu = Math.max(0, Math.min(1, u));
    st.z = R + P.lipHeight * uu * uu;
  } else {
    st.vy -= 0.25 * STEP;                                     // the gentle home tilt
    st.z = R;
  }
  st.y += st.vy * STEP;
  st.x += st.vx * STEP * 0.4;
  if (st.y <= SERVE_Y - 0.3) {
    st.phase = 'done';
    st.outcome = null;                                        // ball not spent - throw it again
    st.events.push({ type: 'returned' });
  }
}

function stepFlight(board, st) {
  const P = board.physics;
  st.vz -= G * STEP;
  st.x += st.vx * STEP;
  st.y += st.vy * STEP;
  st.z += st.vz * STEP;

  // The machine's inner walls, wider than the lane.
  const wall = P.faceW / 2 - R;
  if (st.x > wall) { st.x = wall; st.vx = -Math.abs(st.vx) * P.wallRestitution; }
  else if (st.x < -wall) { st.x = -wall; st.vx = Math.abs(st.vx) * P.wallRestitution; }

  // The pit floor in front of the face: a short ball dies here.
  if (st.z <= P.pitZ + R && st.y < P.faceY0 + 0.02) {
    st.events.push({ type: 'impact', vn: Math.abs(st.vz) });
    return startSinkGutterPit(st);
  }
  // The backstop. A ball thrown hard enough to smack it drops down onto the top of the
  // field and rolls away down the outer board - which is a 10, not a zero: on the real
  // machine power past the sweet spot stops paying, but it does not wipe you out.
  if (st.y >= P.cageY - R) {
    st.events.push({ type: 'cage' });
    return settleTo(board, st, { hole: '10', value: 10,
      cu: board.scoring.hole10.u, cv: board.scoring.hole10.v }, 0.95);
  }

  // The scoring face: plane through (0, faceY0, 0), tilted faceTilt from horizontal, normal
  // toward the player. Signed distance d > 0 in front of the face.
  const sinT = Math.sin(P.faceTilt), cosT = Math.cos(P.faceTilt);
  const d = -sinT * (st.y - P.faceY0) + cosT * st.z;
  const v = cosT * (st.y - P.faceY0) + sinT * st.z;       // metres up the slope
  const vn = -sinT * st.vy + cosT * st.vz;                // speed into the face (negative = into)
  if (d <= R && vn < 0 && v >= -R && v <= P.faceLen) {
    st.events.push({ type: 'impact', u: st.x, v, vn: Math.abs(vn) });
    if (Math.abs(vn) <= P.captureVn || st.bounces >= 1) return capture(board, st, st.x, v);
    // Too hot: one real bounce, then the next contact settles.
    st.bounces += 1;
    const dot = st.vy * -sinT + st.vz * cosT;
    st.vy = (st.vy - (1 + P.restitution) * dot * -sinT) * P.tangentKeep;
    st.vz = (st.vz - (1 + P.restitution) * dot * cosT) * P.tangentKeep;
    st.vx *= P.tangentKeep;
    // Push the ball just clear of the plane so the same contact cannot re-fire next step.
    st.y -= -sinT * (R - d + 0.002);
    st.z += cosT * (R - d + 0.002);
    st.events.push({ type: 'bounce' });
  }
}

/** Where on the face did it land, and what does that score? The real classic layout: cups
 *  first (100s, 50, 40, 30 - the 50 overlaps the big ring's top arc, so cups win), then the big
 *  ring's 20, then the corner gutters' 0, and everything else on the board rolls down the outer
 *  field for the 10. Every ball that reaches the board scores SOMETHING unless it lands in a
 *  bottom corner - that is what makes it skeeball. */
function zoneAt(board, u, v) {
  const S = board.scoring;
  for (const c of S.cups) {
    if (Math.hypot(u - c.u, v - c.v) <= c.r) return { hole: c.id, value: c.value, cu: c.u, cv: c.v };
  }
  if (Math.hypot(u - S.bigRing.u, v - S.bigRing.v) <= S.bigRing.R) {
    return { hole: '20', value: 20, cu: S.hole20.u, cv: S.hole20.v };
  }
  if (v <= S.corner0.vMax && Math.abs(u) >= S.corner0.uMin) {
    return { hole: 'corner0', value: 0, cu: Math.sign(u) * (board.physics.faceW / 2 - 0.06), cv: 0.02 };
  }
  return { hole: '10', value: 10, cu: S.hole10.u, cv: S.hole10.v };
}

function capture(board, st, u, v) {
  const zone = zoneAt(board, u, v);
  // A cup swallows the ball on the spot; a 20 / 10 / corner ball visibly rolls down the board
  // to its drain hole, so the roll gets a longer settle than a plunk.
  const isCup = zone.hole !== '10' && zone.hole !== '20' && zone.hole !== 'corner0';
  settleTo(board, st, zone, isCup ? 0.42 : 0.8);
  if (zone.value > 0) st.events.push({ type: 'capture', hole: zone.hole, value: zone.value, u, v });
  else st.events.push({ type: 'gutter' });
}

/** Begin the scripted settle: ease from where the ball is to its zone's hole, just below the
 *  face plane, and score on arrival. */
function settleTo(board, st, zone, dur) {
  const P = board.physics;
  const sinT = Math.sin(P.faceTilt), cosT = Math.cos(P.faceTilt);
  st.phase = 'sink';
  st.sink = {
    kind: 'hole',
    t: 0, dur,
    fx: st.x, fy: st.y, fz: st.z,
    tx: zone.cu,
    ty: P.faceY0 + zone.cv * cosT + 0.06 * sinT,           // just through the face
    tz: Math.max(zone.cv * sinT - 0.06 * cosT, P.pitZ),
    value: zone.value, hole: zone.hole,
  };
}

/** Died in the gutter void behind the hump: too weak a lob. The honest zero. */
function startSinkGutterPit(st) {
  st.phase = 'sink';
  st.sink = {
    kind: 'drop',
    t: 0, dur: 0.5,
    fx: st.x, fy: st.y, fz: st.z,
    tx: st.x, ty: st.y, tz: -0.34,
    value: 0, hole: 'gutter',
  };
  st.events.push({ type: 'gutter' });
}

function stepSink(st) {
  const s = st.sink;
  s.t += STEP;
  const k = Math.min(1, s.t / s.dur);
  const e = 1 - (1 - k) * (1 - k);                          // ease-out
  st.x = s.fx + (s.tx - s.fx) * e;
  st.y = s.fy + (s.ty - s.fy) * e;
  st.z = s.fz + (s.tz - s.fz) * e;
  if (k >= 1) {
    st.phase = 'done';
    st.outcome = { value: s.value, hole: s.hole };
    st.events.push({ type: 'done', value: s.value, hole: s.hole });
  }
}

export default { G, R, STEP, SERVE_Y, startThrow, step, takeEvents, simulateThrow };
