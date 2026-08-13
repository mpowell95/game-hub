// skeeball/js/physics.js - the deterministic ball simulation. Pure: no DOM, no storage, no
// Math.random anywhere. Same throw parameters, same board, same outcome, every time - which is
// what makes the engine headless-testable (skeeball/js/test.js sweeps the whole power range) and
// keeps the tuning honest: a shot feels hard because the geometry makes it hard, never because a
// dice roll said so.
//
// REBUILT 2026-08-13 to the reference-footage contract (six stock clips of real machines in
// reference/Skeeball/, studied frame by frame; the approved list is summarized in
// skeeball/CLAUDE.md). The old model decided the score at the ball's first touch of the board
// and played a canned slide into a pre-chosen hole. The footage shows the opposite: touching the
// board is where the drama STARTS. So the board half of this file is now a real simulation, and
// THE OUTCOME IS WHEREVER THE BALL PHYSICALLY DRAINS:
//
//   LANE      rolls up the bed, slowed by rollFriction, banking off the side rails.
//   RAMP      the hump. A ball that cannot pay the climb rolls back to the player, unspent.
//   FLIGHT    off the lip at launchAngle, under gravity. A soft ball lands LOW on the board and
//             ROLLS up it (the footage's skim regime); a hard ball arcs high and drops onto the
//             upper board from the air. A total flub dies in the gutter void between hump and
//             board: the honest zero.
//   BOARD     face-plane coordinates (u lateral, v up-slope, w height off the plane). Gravity
//             pulls -v along the tilt and -w into the plane, always. The cups' collars and the
//             big ring's band are REAL WALLS the ball bounces off (rimRestitution) or grazes;
//             the board itself bounces (boardRestitution) until the hop is too small to matter,
//             then the ball ROLLS - decelerating uphill, accelerating back downhill, steering
//             around the furniture. Every bounce is smaller than the last; nothing caps how many
//             happen. A ball drops into a cup only by genuinely arriving over its mouth below
//             rim height; misses roll down and drain low - the 20 hole inside the ring, the 10
//             hole on the outer field, the corner gutters for a low wide fluke.
//   DROP      the short swallow once a mouth genuinely has the ball; the value was earned by
//             then, never chosen in advance.
//
// Termination is engineered, not hoped for: energy only ever decays, and a ball that has fully
// stalled (speed < stallSpeed for stallTime) picks up the board's gentle dishing toward its
// nearest drain (funnelAccel) - it visibly rolls there, it is never teleported.
//
// World coordinates: x lateral (0 = lane centre, +right), y depth away from the player, z up.
// The lane bed is z = 0; the ball centre rides at z = R on it. syncWorld() keeps the world
// position current during the board phase, so the renderer never needs to know the simulation
// changed frames; st.fw (height off the plane) is exposed for the board-phase shadow.

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
    // Face coordinates, live while phase === 'board'.
    fu: 0, fv: 0, fw: 0, fvu: 0, fvv: 0, fvw: 0,
    boardTime: 0,
    stall: 0,
    t: 0,
    acc: 0,                          // step accumulator (ui hands us frame dt)
    drop: null,
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
export function simulateThrow(board, params, maxSeconds = 16) {
  const st = startThrow(board, params);
  const steps = Math.ceil(maxSeconds / STEP);
  for (let i = 0; i < steps && st.phase !== 'done'; i++) subStep(board, st);
  return st;
}

// ---------------------------------------------------------------------------------------------

function subStep(board, st) {
  st.t += STEP;
  switch (st.phase) {
    case 'lane': return stepLane(board.physics, st);
    case 'ramp': return stepRamp(board.physics, st);
    case 'return': return stepReturn(board.physics, st);
    case 'flight': return stepFlight(board, st);
    case 'board': return stepBoard(board, st);
    case 'drop': return stepDrop(st);
    default: return undefined;
  }
}

function stepLane(P, st) {
  const dir = st.vy >= 0 ? 1 : -1;
  st.vy -= dir * P.rollFriction * STEP;
  st.x += st.vx * STEP;
  st.y += st.vy * STEP;
  st.z = R;

  const wall = P.laneW / 2 - R;
  if (st.x > wall) { st.x = wall; st.vx = -Math.abs(st.vx) * P.wallRestitution; }
  else if (st.x < -wall) { st.x = -wall; st.vx = Math.abs(st.vx) * P.wallRestitution; }

  if (st.vy > 0 && st.y >= P.laneLen) st.phase = 'ramp';
  else if (st.vy <= 0) st.phase = 'return';
}

function stepRamp(P, st) {
  const u = (st.y - P.laneLen) / P.rampLen;
  const slope = (2 * P.lipHeight * Math.max(0, Math.min(1, u))) / P.rampLen;
  const dir = st.vy >= 0 ? 1 : -1;
  st.vy -= (G * slope * Math.sin(Math.atan(slope)) + P.rollFriction) * dir * STEP;
  st.x += st.vx * STEP * 0.6;
  st.y += st.vy * STEP;
  const uu = Math.max(0, Math.min(1, (st.y - P.laneLen) / P.rampLen));
  st.z = R + P.lipHeight * uu * uu;

  if (st.vy <= 0) {
    st.phase = 'return';
    st.events.push({ type: 'shortramp' });
    return;
  }
  if (st.y >= P.laneLen + P.rampLen) {
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
  const u = (st.y - P.laneLen) / P.rampLen;
  if (st.y > P.laneLen) {
    const slope = (2 * P.lipHeight * Math.max(0, Math.min(1, u))) / P.rampLen;
    st.vy -= G * slope * Math.sin(Math.atan(slope)) * STEP;
    const uu = Math.max(0, Math.min(1, u));
    st.z = R + P.lipHeight * uu * uu;
  } else {
    st.vy -= 0.25 * STEP;
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

// --- flight: projectile until the board plane takes over ---------------------------------------

function stepFlight(board, st) {
  const P = board.physics;
  st.vz -= G * STEP;
  st.x += st.vx * STEP;
  st.y += st.vy * STEP;
  st.z += st.vz * STEP;

  const wall = P.faceW / 2 - R;
  if (st.x > wall) { st.x = wall; st.vx = -Math.abs(st.vx) * P.wallRestitution; }
  else if (st.x < -wall) { st.x = -wall; st.vx = Math.abs(st.vx) * P.wallRestitution; }

  // The gutter void between the hump and the board: a lob too weak to reach the board.
  if (st.z <= P.pitZ + R && st.y < P.faceY0 + 0.02) {
    st.phase = 'drop';
    st.drop = { t: 0, dur: 0.5, fx: st.x, fy: st.y, fz: st.z, tx: st.x, ty: st.y, tz: -0.34, value: 0, hole: 'gutter' };
    st.events.push({ type: 'gutter' });
    return;
  }
  // The far safety wall (the board's own net is closer; this should be unreachable).
  if (st.y >= P.cageY - R) {
    st.y = P.cageY - R;
    st.vy = -Math.abs(st.vy) * 0.3;
  }

  // Hand over to the board simulation the moment the plane is within reach and the ball is
  // moving into it - whether that first touch becomes a bounce or a roll is stepBoard's call.
  const sinT = Math.sin(P.faceTilt), cosT = Math.cos(P.faceTilt);
  const w = -sinT * (st.y - P.faceY0) + cosT * st.z;
  const v = cosT * (st.y - P.faceY0) + sinT * st.z;
  const vw = -sinT * st.vy + cosT * st.vz;
  if (w <= R && vw < 0 && v >= -R) {
    st.fu = st.x;
    st.fv = Math.max(v, 0.001);
    st.fw = R;
    st.fvu = st.vx;
    st.fvv = cosT * st.vy + sinT * st.vz;
    st.fvw = vw;
    st.phase = 'board';
    st.events.push({ type: 'impact', u: st.fu, v: st.fv, vn: Math.abs(vw) });
    syncWorld(board, st);
  }
}

// --- the board: a live simulation in face coordinates ------------------------------------------

function stepBoard(board, st) {
  const P = board.physics;
  const S = board.scoring;
  st.boardTime += STEP;

  // Gravity: down the slope, and into the plane. The tilt never stops applying.
  const sinT = Math.sin(P.faceTilt), cosT = Math.cos(P.faceTilt);
  st.fvv -= G * sinT * STEP;
  st.fvw -= G * cosT * STEP;

  st.fu += st.fvu * STEP;
  st.fv += st.fvv * STEP;
  st.fw += st.fvw * STEP;

  // 1. MOUTHS BEFORE THE FLOOR. A ball coming down over an open mouth is falling INTO it -
  // there is no board there to bounce off. (The first draft bounced balls out of the very cups
  // they had landed in; the trace tool caught it.)
  if (st.fvw <= 0.1 && st.fw <= R + 0.012) {
    for (const cup of S.cups) {
      const h = cup.value >= 100 ? P.collar100H : P.collarH;
      const d = Math.hypot(st.fu - cup.u, st.fv - cup.v);
      if (d < cup.r - R * 0.3 && st.fw < h + R * 0.5) {
        return swallow(board, st, cup.id, cup.value, cup.u, cup.v);
      }
    }
    const sp2 = Math.hypot(st.fvu, st.fvv);
    if (sp2 < P.drainSpeedMax) {
      for (const [hole, mouth, value] of [['20', S.hole20, 20], ['10', S.hole10, 10]]) {
        if (Math.hypot(st.fu - mouth.u, st.fv - mouth.v) < P.drainR) {
          return swallow(board, st, hole, value, mouth.u, mouth.v);
        }
      }
    }
  }

  // 2. The board plane itself: bounce while the hops still matter, then roll.
  if (st.fw < R && st.fvw < 0) {
    st.fw = R;
    if (-st.fvw > P.bounceMin) {
      st.fvw = -st.fvw * P.boardRestitution;
      st.fvu *= P.bounceKeep;
      st.fvv *= P.bounceKeep;
      st.events.push({ type: 'bounce' });
    } else {
      st.fvw = 0;
    }
  }
  const onFloor = st.fw <= R + 0.003 && Math.abs(st.fvw) < 0.05;
  if (onFloor) {
    const sp = Math.hypot(st.fvu, st.fvv);
    if (sp > 0) {
      const k = Math.max(0, sp - P.boardRollFriction * STEP) / sp;
      st.fvu *= k;
      st.fvv *= k;
    }
  }

  // 2. The cups' collars and the big ring's band: real walls the ball bounces off or grazes.
  for (const cup of S.cups) {
    const h = cup.value >= 100 ? P.collar100H : P.collarH;
    collideRing(P, st, cup.u, cup.v, cup.r, h, true);
  }
  // Wherever a cup stands on or beside the band, the CUP owns the contact: two nearly-touching
  // convex walls otherwise mint a ball-sized crevice that pins a slow ball between alternating
  // contacts (pinball/CLAUDE.md's wedge lesson - met twice on this board's first soaks, at the
  // 50/band junction and in the 100L/band gap).
  const nearCup = S.cups.some((c) => Math.hypot(st.fu - c.u, st.fv - c.v) < c.r + R * 1.35);
  if (!nearCup) collideRing(P, st, S.bigRing.u, S.bigRing.v, S.bigRing.R, P.ringH, false, P.ringThick);

  // 3. The bottom edge: corner gutters for a low wide ball, the 10 trough for the rest.
  if (st.fv < 0.015 && st.fvv <= 0) {
    if (Math.abs(st.fu) >= S.corner0.uMin) {
      return swallow(board, st, 'corner0', 0, Math.sign(st.fu) * (P.faceW / 2 - 0.06), 0.02);
    }
    return swallow(board, st, '10', 10, S.hole10.u, S.hole10.v);
  }

  // 4. Side walls, and the net above the board's top edge.
  const wall = P.faceW / 2 - R;
  if (st.fu > wall) { st.fu = wall; st.fvu = -Math.abs(st.fvu) * 0.5; }
  else if (st.fu < -wall) { st.fu = -wall; st.fvu = Math.abs(st.fvu) * 0.5; }
  if (st.fv > P.backstopV) {
    st.fv = P.backstopV;
    st.fvv = -Math.abs(st.fvv) * 0.3;
    st.fvu *= 0.7;
    st.events.push({ type: 'bounce' });
  }

  // 5a. The absolute backstop on settle time: if some future geometry ever mints a wedge the
  // slide contact cannot escape, the nearest drain takes the ball rather than the rack hanging.
  // The engine tests assert this never actually fires (max board time stays well under it).
  if (st.boardTime > 10) {
    const inR = Math.hypot(st.fu - S.bigRing.u, st.fv - S.bigRing.v) < S.bigRing.R;
    const m = inR ? S.hole20 : S.hole10;
    return swallow(board, st, inR ? '20' : '10', inR ? 20 : 10, m.u, m.v);
  }

  // 5b. The stall funnel: a fully spent ball picks up the board's dishing toward its drain and
  // visibly rolls there. Guarantees a rack never waits on a perfectly balanced ball.
  // Stall is detected by DISPLACEMENT FROM AN ANCHOR, not speed - a ball jittering against a
  // wall crosses any speed threshold many times a second while going precisely nowhere
  // (pinball/CLAUDE.md's ball-search lesson, re-learned on this board's wall pockets).
  if (st.anchorT === undefined) { st.anchorT = 0; st.anchorU = st.fu; st.anchorV = st.fv; }
  st.anchorT += STEP;
  if (st.anchorT >= 0.7) {
    const moved = Math.hypot(st.fu - st.anchorU, st.fv - st.anchorV);
    st.stall = moved < 0.03 ? st.stall + st.anchorT : 0;
    st.anchorT = 0; st.anchorU = st.fu; st.anchorV = st.fv;
  }
  if (st.stall > P.stallTime) {
    // While funnelling, also bleed the jitter so the bias wins over the wall chatter.
    st.fvu *= 0.96;
    st.fvv *= 0.96;
    const inRing = Math.hypot(st.fu - S.bigRing.u, st.fv - S.bigRing.v) < S.bigRing.R;
    const target = inRing ? S.hole20 : S.hole10;
    const du = target.u - st.fu, dv = target.v - st.fv;
    const dl = Math.hypot(du, dv) || 1;
    st.fvu += (du / dl) * P.funnelAccel * STEP;
    st.fvv += (dv / dl) * P.funnelAccel * STEP;
  }

  syncWorld(board, st);
}

/** Collar / ring-band collision: a cylindrical wall standing h off the board. A `solid` cup
 *  keeps the ball out below rim height (entry is over the top only - that is what a collar IS);
 *  the big ring is a thin band with an inside and an outside face. A ball sailing above the
 *  wall's top clears it untouched, and a rim kiss near the top edge pops the ball up a little -
 *  the footage's rim-out. */
function collideRing(P, st, cu, cv, r, h, solid, thick = 0) {
  // The ring band reaches higher for a DESCENDING ball: the real basin is dished, and a rattler
  // hopping back down the slope funnels along the bowl instead of ballooning out over the band.
  // Climbers and cup traffic use the true wall height.
  const reach = !solid && st.fvv < -0.2 ? h + R * 1.7 : h + R * 0.55;
  if (st.fw > reach) return;                              // clear over the top
  const du = st.fu - cu, dv = st.fv - cv;
  const d = Math.hypot(du, dv) || 1e-6;
  const eu = du / d, ev = dv / d;
  const vr = st.fvu * eu + st.fvv * ev;                   // radial velocity (+ = outward)

  const hitOutside = d > r && d - r < R * 0.95 && vr < 0;
  const inner = r - (thick || 0);
  const hitInside = !solid && d < inner && inner - d < R * 0.95 && vr > 0;
  const hitCupInner = solid && d < r && r - d < R * 0.4 && vr > 0 && st.fw < h;
  if (!hitOutside && !hitInside && !hitCupInner) return;

  // The band is hopped, not fought - but only by a ball moving UP the slope with real speed
  // (the footage's entries, and climbers heading for the top cups). A ball plunging back DOWN
  // into the band's inner face smacks it and stays in the basin, which is what keeps rattlers
  // circulating inside the ring the way the clips show.
  if (!solid && st.fw <= R + 0.01 && st.fvv > 0.3 && Math.abs(vr) >= P.bandHopSpeed) {
    st.fvw = Math.max(st.fvw, 1.35);
    st.fvu *= 0.9;
    st.fvv *= 0.9;
    st.events.push({ type: 'bounce' });
    return;
  }

  // The teeter: a slow ball meeting a CUP's rim top does not slam away - it tips over the edge
  // and in (the footage's lip-in). Fast rim hits still kick out below.
  if (solid && hitOutside && st.fw > h - R * 0.6 && -vr < 0.35 && Math.hypot(st.fvu, st.fvv) < 0.8) {
    st.fu = cu + eu * (r - R * 0.45);
    st.fv = cv + ev * (r - R * 0.45);
    st.fvu *= 0.4;
    st.fvv *= 0.4;
    st.events.push({ type: 'bounce' });
    return;
  }

  // Grazing or resting contact is a SLIDE, not a bounce: kill the inward push, keep the
  // tangential motion whole, and let gravity walk the ball along the wall. (Treating every
  // touch as a bounce parked balls against walls forever - per-step damping ate the slide.)
  if (Math.abs(vr) < 0.3) {
    const tu0 = st.fvu - vr * eu, tv0 = st.fvv - vr * ev;
    st.fvu = tu0;
    st.fvv = tv0;
    const clear0 = hitOutside ? r + R * 0.96 : (hitCupInner ? r - R * 0.42 : inner - R * 0.96);
    st.fu = cu + eu * clear0;
    st.fv = cv + ev * clear0;
    return;
  }

  const bounceVr = -vr * P.rimRestitution;
  const tu = st.fvu - vr * eu, tv = st.fvv - vr * ev;
  st.fvu = tu * P.rimTangentKeep + bounceVr * eu;
  st.fvv = tv * P.rimTangentKeep + bounceVr * ev;
  if (st.fw > h - R * 0.6 && st.fvw < 0) st.fvw = Math.abs(st.fvw) * 0.25;
  const clear = hitOutside ? r + R * 0.96 : (hitCupInner ? r - R * 0.42 : inner - R * 0.96);
  st.fu = cu + eu * clear;
  st.fv = cv + ev * clear;
  st.events.push({ type: 'bounce' });
}

/** A mouth genuinely has the ball: the short swallow, then done. The value was EARNED by the
 *  simulation getting here - nothing above ever pre-chose it. */
function swallow(board, st, hole, value, cu, cv) {
  const P = board.physics;
  const sinT = Math.sin(P.faceTilt), cosT = Math.cos(P.faceTilt);
  syncWorld(board, st);
  st.phase = 'drop';
  st.drop = {
    t: 0, dur: 0.32,
    fx: st.x, fy: st.y, fz: st.z,
    tx: cu,
    ty: P.faceY0 + cv * cosT + 0.07 * sinT,
    tz: Math.max(cv * sinT - 0.07 * cosT, P.pitZ),
    value, hole,
  };
  if (value > 0) st.events.push({ type: 'capture', hole, value, u: cu, v: cv });
  else st.events.push({ type: 'gutter' });
}

function stepDrop(st) {
  const s = st.drop;
  s.t += STEP;
  const k = Math.min(1, s.t / s.dur);
  const e = 1 - (1 - k) * (1 - k);
  st.x = s.fx + (s.tx - s.fx) * e;
  st.y = s.fy + (s.ty - s.fy) * e;
  st.z = s.fz + (s.tz - s.fz) * e;
  if (k >= 1) {
    st.phase = 'done';
    st.outcome = { value: s.value, hole: s.hole };
    st.events.push({ type: 'done', value: s.value, hole: s.hole });
  }
}

/** Face coordinates (fw is the ball CENTRE's height off the plane) back to world, every board
 *  step, so the renderer never needs to know the simulation changed frames. */
function syncWorld(board, st) {
  const P = board.physics;
  const sinT = Math.sin(P.faceTilt), cosT = Math.cos(P.faceTilt);
  st.x = st.fu;
  st.y = P.faceY0 + st.fv * cosT - st.fw * sinT;
  st.z = st.fv * sinT + st.fw * cosT;
}

export default { G, R, STEP, SERVE_Y, startThrow, step, takeEvents, simulateThrow };
