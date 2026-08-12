// skeeball/js/physics.js - the real physics. One ball, real colliders, real holes; the score is
// whichever hole finally swallows the ball. No lookup tables, no predetermined outcome, no rng.
//
// WHY THIS FILE EXISTS (2026-08-12). Matt, after three rounds of tuned scoring tables: "I wanted
// it to be able to miss a hole and bounce like in real life. And like in 'correct bouncing.mov'...
// The physics is what I'm expecting you to be able to handle." That clip (SPEC.md, the 2026-08-12
// section) shows a ball CLIP THE RIM of the 40, deflect sideways, fall into the basin, roll down
// along the inside of the big ring and drop into the 20 - about 1.6 seconds of consequences. A
// table cannot produce consequences. A simulation is the only honest implementation, so scoring
// here is EMERGENT: resolveThrow does not decide the score, gravity does.
//
// THE MODEL. World frame in metres: x across (+right), y up, z from the foul line toward the
// machine. A sphere (radius BALL_R) integrated at a fixed timestep against a small set of
// analytic colliders described by the machine's `geom` (js/boards.js):
//
//   - the LANE: flat plane y=0 with rolling resistance; side RAILS are vertical walls that
//     reflect (a banked throw is a real bounce now, not a folded coordinate).
//   - the RAMP at the lane's end: the ball trades speed for the lip's height and leaves the
//     surface at `launchDeg`. Too slow to climb it = rolls back to the player. The only zero.
//   - the BOARD: a plane tilted `tiltDeg` back from vertical. Each ring is a HOLE in that plane
//     with a raised collar around it: the collar's lip is a torus that deflects grazing hits
//     (the rim bounce), and inside the opening there simply is no floor - a ball whose centre
//     drops below the plane inside an opening has been swallowed, and that ring's points are the
//     score. The big ring is a taller collar whose inner wall contains the basin; the basin
//     floor's lowest region and the outer board's bottom trough are 10-holes, so everything that
//     reaches the board eventually drains somewhere. Nothing snaps, nothing is deleted.
//
// DETERMINISM. Fixed dt, no randomness: the same flick always does the same thing, so practice
// is real (the same rule the old engine had, kept on purpose). The whole flight is simulated up
// front in a few milliseconds and returned as timestamped frames; the UI just plays them back,
// so what is drawn and what was scored are the same computation and can never disagree.
//
// UNITS. SI-ish on purpose: metres and seconds with real gravity, so a parabola looks like a
// parabola and a bounce loses the height a bounce loses. The flick maps release speed (canvas
// heights/second) LINEARLY to launch speed - see game.js's flickToThrow; every abstraction
// between the finger and the ball's velocity is gone.

export const BALL_R = 0.042;        // rust-brown wooden ball; opening/ball ratio per SPEC ~1.7
export const G = 9.81;

const DT = 1 / 480;                 // integration step
const FRAME_DT = 1 / 90;            // recorded playback resolution
const MAX_T = 8;                    // hard cap; tests assert real throws settle well under it

// Restitution / friction, tuned against Correct bouncing.MOV's choreography (rim hit -> settle
// in ~1.6s, each bounce visibly lower). Shared by all machines - a machine differs in LAYOUT.
const E_BOARD = 0.42;               // bouncing off the board plane
const E_LIP = 0.50;                 // off a collar's rim - the "so close" bounce
const E_WALL = 0.52;                // big ring inner wall / cabinet sides
const E_RAIL = 0.55;                // lane side rails
const TANGENT_KEEP = 0.88;          // tangential speed kept through any bounce
const LANE_RR = 0.75;               // lane rolling resistance, m/s^2 (constant - the lane is flat)
/** Board rolling resistance is PROPORTIONAL damping (per second), never a constant decel: a
 *  constant decel acts as static friction, and static friction on a 45-degree board let a ball
 *  freeze mid-slope forever - the sweep caught two. A rolling ball damps; a resting ball is
 *  free to be pulled off its perch by gravity (or the board's TILT_X lean). */
const ROLL_DAMP = 1.15;
const ROLL_SNAP = 0.35;             // below this normal speed a bounce becomes rolling contact

/** A real cabinet is never perfectly level. This constant, tiny lateral component of gravity
 *  (a 0.2% board tilt) exists to break knife-edge equilibria - a ball balanced EXACTLY on top
 *  of a collar dead-centre would otherwise sit there forever, because a simulation this clean
 *  has no imperfections to knock it off. Deterministic (always the same lean), so the engine
 *  stays a pure function of the throw. */
const TILT_X = 0.02;

const v3 = (x, y, z) => ({ x, y, z });
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });

/** Everything derived from a machine's geometry, precomputed once. */
export function buildMachine(geom) {
  const g = geom;
  const beta = (g.tiltDeg * Math.PI) / 180;           // back-tilt from vertical
  // Plane axes: U across, W up-slope, n out of the board toward the player (and slightly up).
  const U = v3(1, 0, 0);
  const W = v3(0, Math.cos(beta), Math.sin(beta));
  const n = v3(0, Math.sin(beta), -Math.cos(beta));
  const B = v3(0, g.base.y, g.base.z);                // plane origin (u=0, w=0)
  const world = (u, w, s = 0) => add(add(add(B, U, u), W, w), n, s);
  return {
    ...g, beta, U, W, n, B, world,
    launch: (g.launchDeg * Math.PI) / 180,
    rampZ0: g.laneLen,
    rampZ1: g.laneLen + g.rampLen,
    rings: g.rings.map((r) => ({ ...r })),
  };
}

/** Ball position -> board-plane coordinates: u across, w up-slope, s along the normal.
 *  Exported for the renderer's z-ordering (which props stand in front of the ball). */
export function planeCoords(M, p) {
  const d = add(p, M.B, -1);
  return { u: dot(d, M.U), w: dot(d, M.W), s: dot(d, M.n) };
}

/** Is the in-plane point inside ring k's OPENING (the hole itself)? A basin ring is a WALL, not
 *  a hole - the floor inside it is the basin floor - so it never swallows anything. */
const inOpening = (r, u, w) => {
  if (r.basin) return false;
  const du = u - r.c[0], dw = w - r.c[1];
  return du * du + dw * dw < (r.R - r.T * 0.5) * (r.R - r.T * 0.5);
};

/** Is (u,w) over one of the plane's 10-drains (basin bottom or outer trough)? */
function overDrain(M, u, w) {
  for (const d of M.drains) {
    if (u >= d.u0 && u <= d.u1 && w >= d.w0 && w <= d.w1) {
      // The basin drain only exists INSIDE the big ring; the trough only OUTSIDE it.
      if (d.insideOf) {
        const big = M.rings.find((r) => r.id === d.insideOf);
        const du = u - big.c[0], dw = w - big.c[1];
        if (du * du + dw * dw > (big.R - big.T) * (big.R - big.T)) continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * One throw, simulated start to settle. PURE and deterministic.
 *
 * @param {number} v0   launch speed at the foul line, m/s (already clamped by the caller)
 * @param {number} dir  lateral angle of the throw in radians (0 = straight up the lane)
 * @param {object} M    a buildMachine() result
 * @returns {{ outcome: {kind:'hit'|'short', target:string|null, points:number},
 *             frames: Array<{t,x,y,z,spin}>, events: Array<{t,type,ring?}>, settleT: number }}
 */
export function simulate(v0, dir, M) {
  let p = v3(0, BALL_R, 0.02);
  let v = v3(Math.sin(dir) * v0, 0, Math.cos(dir) * v0);
  let grounded = true;                 // on the lane/ramp surface
  let rollingOn = null;                // 'board' when in rolling contact with the board plane
  let swallowed = null;                // ring or drain that took the ball
  let arc = 0;                         // arc length for the renderer's rolling relation
  const frames = [];
  const events = [];
  let t = 0, lastF = -1;

  const record = () => {
    if (t - lastF < FRAME_DT && swallowed === null) return;
    lastF = t;
    frames.push({ t, x: p.x, y: p.y, z: p.z, spin: arc / BALL_R });
  };
  const event = (type, ring) => events.push({ t, type, ring });

  // Reflect velocity about unit normal `nrm` with restitution e. A REAL impact damps the
  // tangential speed too; a RESTING contact (normal speed already tiny) must not - impact
  // damping applied 480 times a second to a ball sitting on a rim eats its tangential speed
  // before gravity can roll it off, and the ball hangs there forever. Resting contact just
  // cancels the normal component and lets gravity do the rolling.
  const bounce = (nrm, e) => {
    const vn = dot(v, nrm);
    if (vn >= 0) return false;
    const vN = scale(nrm, vn);
    const vT = add(v, vN, -1);
    if (-vn < ROLL_SNAP) {
      v = add(vT, scale(nrm, 0));            // resting: kill the normal speed, keep the slide
      return true;
    }
    v = add(scale(vT, TANGENT_KEEP), scale(nrm, -vn * e));
    return true;
  };

  while (t < MAX_T && swallowed === null) {
    const pPrev = { ...p };

    if (grounded) {
      // --- lane + ramp: constrained to the surface -------------------------------------------
      // Rolling resistance, on FORWARD motion only. A ball coming back is helped home instead -
      // the real lane has a return slope, and a ball dying flat halfway up the alley would
      // otherwise sit there for the rest of the game.
      if (v.z > 0) {
        const gs = Math.hypot(v.x, v.z);
        const k = Math.max(0, gs - LANE_RR * DT) / gs;
        v.x *= k; v.z *= k;
      } else {
        v.z -= 0.5 * DT;
        v.x *= 1 - 0.8 * DT;
      }
      // The ramp climb: trade speed for height continuously so the roll-back is real motion.
      if (p.z > M.rampZ0) {
        const k = (p.z - M.rampZ0) / (M.rampZ1 - M.rampZ0);
        const slope = (M.lipH / (M.rampZ1 - M.rampZ0));
        v.z -= G * slope * DT;               // decelerates the climb, accelerates the roll-back
        p.y = BALL_R + M.lipH * Math.max(0, Math.min(1, k));
      } else {
        p.y = BALL_R;
      }
      // Side rails.
      if (Math.abs(p.x) > M.laneHW - BALL_R) {
        p.x = Math.sign(p.x) * (M.laneHW - BALL_R);
        v.x = -v.x * E_RAIL;
        event('rail');
      }
      p.x += v.x * DT; p.z += v.z * DT;
      arc += Math.hypot(v.x * DT, v.z * DT);

      if (p.z >= M.rampZ1 && v.z > 0) {
        // Launch: the surface ends. Speed is what survived the climb, aimed up at launchDeg.
        const gs2 = Math.hypot(v.x, v.z);
        v = v3(v.x, gs2 * Math.sin(M.launch), Math.sqrt(Math.max(0.01, gs2 * gs2 - v.x * v.x)) * Math.cos(M.launch));
        grounded = false;
        event('launch');
      } else if (v.z <= 0 && p.z < 0.01) {
        // Rolled all the way back to the player: the throw was too soft. The only zero.
        record();
        return { outcome: { kind: 'short', target: null, points: 0 }, frames, events, settleT: t };
      }
    } else {
      // --- free flight & the board -----------------------------------------------------------
      v.y -= G * DT;
      v.x += TILT_X * DT;
      p = add(p, v, DT);
      arc += len(v) * DT;

      const pc = planeCoords(M, p);

      // Cabinet side walls (just beyond the board's width).
      if (Math.abs(p.x) > M.boardHW - BALL_R && p.z > M.rampZ0) {
        p.x = Math.sign(p.x) * (M.boardHW - BALL_R);
        v.x = -v.x * E_WALL;
        event('wall');
      }

      // Collar lips and walls - IMPULSES, for a ball in flight. A ball ROLLING on the board
      // skips these entirely: alternating lip/wall/floor impulses on a slow ball produce a
      // chattering limit cycle that can park it against a collar forever (the sweep caught it
      // at v=5.1, cycling through the same three velocities for six seconds). The rolling
      // branch below treats collars as smooth guides instead - the ball rolls AROUND them,
      // which is what a slow ball against a collar does on the real machine.
      for (const r of (rollingOn === 'board' ? [] : M.rings)) {
        const du = pc.u - r.c[0], dw = pc.w - r.c[1];
        const rho = Math.hypot(du, dw);
        // The lip: a torus at height r.h above the plane, ring radius R (+T/2 to its centre).
        const lipR = r.R + r.T * 0.5;
        const dRho = rho - lipR;
        const dS = pc.s - r.h;
        const dLip = Math.hypot(dRho, dS);
        if (dLip < BALL_R + r.T * 0.5 && dLip > 1e-6) {
          const eu = rho > 1e-6 ? du / rho : 1, ew = rho > 1e-6 ? dw / rho : 0;
          // The stacked collars OVERLAP (the app's own look). Where this collar's lip dips
          // inside a neighbour's opening there is no lip - the neighbour's hole is there - so
          // no contact. Without this, the crossing points of two lips form a pocket a ball can
          // wedge in forever, hanging over a hole it should have fallen into.
          const lu = r.c[0] + eu * lipR, lw = r.c[1] + ew * lipR;
          let clipped = false;
          for (const o of M.rings) if (o !== r && inOpening(o, lu, lw)) { clipped = true; break; }
          if (clipped) continue;
          // Normal from the nearest lip point to the ball centre, in world space.
          const nrm = add(add(scale(M.U, eu * (dRho / dLip)), scale(M.W, ew * (dRho / dLip))), M.n, dS / dLip);
          const nl = len(nrm);
          const unit = scale(nrm, 1 / nl);
          const impact = -dot(v, unit) >= ROLL_SNAP;
          if (bounce(unit, E_LIP)) {
            // Push out of penetration so the next step is clean.
            p = add(p, unit, (BALL_R + r.T * 0.5 - dLip) + 0.001);
            if (impact) event('rim', r.id);
          }
        }
        // The big ring's wall (tall collar): contains the basin from the inside, deflects from
        // the outside. Cup collars are lower than the ball's centre, so their lip does the work.
        if (r.wallHigh && pc.s > -BALL_R && pc.s < r.h && rho > 1e-6) {
          const inner = rho < r.R + r.T * 0.5;
          const wallRho = inner ? r.R : r.R + r.T;
          if (Math.abs(rho - wallRho) < BALL_R * 0.9) {
            const sgn = inner ? -1 : 1;      // inside: push toward the centre? No - away from wall
            const eu = du / rho, ew = dw / rho;
            const unit = add(scale(M.U, eu * sgn), scale(M.W, ew * sgn), 1);
            const ul = len(unit);
            const u2 = scale(unit, 1 / ul);
            if (bounce(u2, E_WALL)) event('wall', r.id);
          }
        }
      }

      // The board plane itself - EXCEPT where there is a hole. Falling through a hole is the
      // capture: once the centre is below the plane inside an opening, that ring has the ball.
      const pc2 = planeCoords(M, p);
      const onBoardArea = pc2.w > -0.02 && pc2.w < M.boardH && Math.abs(pc2.u) < M.boardHW && p.z > M.rampZ0;
      if (onBoardArea) {
        let hole = null;
        for (const r of M.rings) if (inOpening(r, pc2.u, pc2.w)) { hole = r; break; }
        const drained = !hole && overDrain(M, pc2.u, pc2.w);
        if ((hole || drained) && pc2.s < -BALL_R * 0.4) {
          swallowed = hole || { id: M.drainId, points: M.drainPoints };
          event('sunk', swallowed.id);
          break;
        }
        if (!hole && !drained && pc2.s < BALL_R) {
          // Contact with the plane.
          if (rollingOn === 'board' || Math.abs(dot(v, M.n)) < ROLL_SNAP) {
            // Rolling: constrain to the surface, gravity's in-plane component drives it.
            rollingOn = 'board';
            p = add(p, M.n, BALL_R - pc2.s);
            const vn = dot(v, M.n);
            v = add(v, M.n, -vn);
            // In-plane gravity: g projected onto the plane = -g * (y component of W) along W,
            // 5/7 of it because a rolling sphere spends the rest spinning up. Plus the lean.
            v = add(v, M.W, -G * M.W.y * DT * (5 / 7));
            v = add(v, M.U, TILT_X * DT);
            v = scale(v, Math.max(0, 1 - ROLL_DAMP * DT));
            // Tall collars as smooth guides: kill the in-plane velocity component INTO the
            // wall, keep the slide along it - the ball rolls around the collar toward the
            // bottom, never chattering against it. Low cup collars are shorter than the
            // ball's centre height, so a rolling ball simply tips over them (and the opening
            // check below swallows it if it crosses the mouth).
            for (const r of M.rings) {
              if (!r.wallHigh) continue;
              const du2 = pc2.u - r.c[0], dw2 = pc2.w - r.c[1];
              const rho2 = Math.hypot(du2, dw2);
              if (rho2 < 1e-6) continue;
              const inside = rho2 < r.R + r.T * 0.5;
              const clear = inside ? (r.R - r.T * 0.5 - BALL_R * 0.7) : (r.R + r.T + BALL_R * 0.7);
              const penetrating = inside ? rho2 > clear : rho2 < clear;
              if (!penetrating) continue;
              const eu2 = du2 / rho2, ew2 = dw2 / rho2;
              const radial = add(scale(M.U, eu2), scale(M.W, ew2), 1);
              const vr = dot(v, radial);
              // Only remove motion INTO the wall (outward when inside, inward when outside).
              if ((inside && vr > 0) || (!inside && vr < 0)) v = add(v, radial, -vr);
            }
          } else {
            p = add(p, M.n, BALL_R - pc2.s + 0.001);
            if (bounce(M.n, E_BOARD)) event('board');
          }
        } else if (rollingOn === 'board' && (hole || drained)) {
          // Rolling and the floor just disappeared: it falls in. Let gravity take it (no more
          // plane constraint); a step or two later the centre passes the plane and it is sunk.
          rollingOn = null;
        } else if (rollingOn === 'board' && pc2.s > BALL_R * 1.5) {
          rollingOn = null;                  // rolled off a edge into the air
        }
      }

      // Fell below the lane level in front of the machine (off the ramp gap, rare): drain 10.
      if (p.y < -0.2) {
        swallowed = { id: M.drainId, points: M.drainPoints };
        event('sunk', swallowed.id);
        break;
      }
    }

    t += DT;
    record();
  }

  if (swallowed === null) {
    // Timed out (should not happen - tests sweep for it). Drain honestly rather than hang.
    swallowed = { id: M.drainId, points: M.drainPoints };
    event('timeout');
  }
  record();
  // A short sink tail so the playback shows the drop into the hole.
  const last = frames[frames.length - 1];
  const nSink = scale(M.n, -1);
  for (let i = 1; i <= 6; i++) {
    frames.push({ t: last.t + i * FRAME_DT, x: last.x + nSink.x * 0.012 * i, y: last.y + nSink.y * 0.012 * i, z: last.z + nSink.z * 0.012 * i, spin: last.spin, sink: i / 6 });
  }
  return {
    outcome: { kind: 'hit', target: swallowed.id, points: swallowed.points },
    frames, events, settleT: t,
  };
}

export default { BALL_R, G, buildMachine, simulate };
