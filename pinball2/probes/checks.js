// The three checks, written once and run from two places: the editor's Check panel and the node
// CLI. One implementation is the point. A check that only runs in a terminal is a check nobody
// runs, and a check that only runs in the browser cannot gate a deploy.
//
// They report PLACES, not percentages. Four soaks passed a table that was unplayable in thirty
// seconds, because a soak samples where it happens to go. These do not sample.

import { World, ribbonGeom, ribbonAt, ribbonWorld } from '../machines/testbox/physics.js';
import { gravity } from '../machines/testbox/config.js';

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a) => Math.hypot(a.x, a.y);

/** On the floor and in the way. A drain is a sensor and a ribbon is a ramp overhead, so neither is
 *  something a ball rolling along the playfield can hit. */
const isSolid = (o) => o.kind !== 'drain' && o.kind !== 'ribbon';

/** Distance from a point to a shape's solid surface. Negative means inside it. */
export function distToShape(sh, p) {
  if (sh.kind === 'seg' || sh.kind === 'sling') {
    const d = sub(sh.b, sh.a);
    const L2 = d.x * d.x + d.y * d.y;
    const u = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - sh.a.x) * d.x + (p.y - sh.a.y) * d.y) / L2));
    const on = { x: sh.a.x + d.x * u, y: sh.a.y + d.y * u };
    return len(sub(p, on)) - sh.r;
  }
  if (sh.kind === 'circle' || sh.kind === 'bumper') return len(sub(p, sh.c)) - sh.r;
  if (sh.kind === 'arc') {
    const rel = sub(p, sh.c);
    const ang = Math.atan2(rel.y, rel.x);
    const twoPi = Math.PI * 2;
    let da = (ang - sh.a0) % twoPi; if (da < 0) da += twoPi;
    let span = (sh.a1 - sh.a0) % twoPi; if (span <= 0) span += twoPi;
    if (da <= span) return Math.abs(len(rel) - sh.radius) - sh.r;
    let best = Infinity;
    for (const a of [sh.a0, sh.a1]) {
      const e = { x: sh.c.x + sh.radius * Math.cos(a), y: sh.c.y + sh.radius * Math.sin(a) };
      best = Math.min(best, len(sub(p, e)) - sh.r);
    }
    return best;
  }
  if (sh.kind === 'flipper') {
    const tip = { x: sh.pivot.x + sh.len * Math.cos(sh.restAng), y: sh.pivot.y + sh.len * Math.sin(sh.restAng) };
    const d = sub(tip, sh.pivot);
    const L2 = d.x * d.x + d.y * d.y;
    const u = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - sh.pivot.x) * d.x + (p.y - sh.pivot.y) * d.y) / L2));
    const on = { x: sh.pivot.x + d.x * u, y: sh.pivot.y + d.y * u };
    return len(sub(p, on)) - (sh.r0 + (sh.r1 - sh.r0) * u);
  }
  // A ribbon is a RAMP: it is above the playfield and has no footprint on it at all. A ball on the
  // floor passes underneath. It is not "unknown", it is deliberately nowhere near everything.
  if (sh.kind === 'ribbon') return Infinity;
  if (sh.kind === 'drain') {
    const dx = Math.max(sh.x - p.x, 0, p.x - (sh.x + sh.w));
    const dy = Math.max(sh.y - p.y, 0, p.y - (sh.y + sh.h));
    return Math.hypot(dx, dy);
  }
  // A kind this function has not been taught is INVISIBLE to every probe in this file and to the
  // editor's hit testing, silently, because Infinity reads as "nowhere near". Bumpers and
  // slingshots spent one build in exactly that state. Add the kind here when you add the kind.
  throw new Error(`distToShape does not know the shape kind "${sh.kind}"`);
}

function surfacePoints(sh, n) {
  const out = [];
  if (sh.kind === 'seg' || sh.kind === 'sling') {
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      out.push({ x: sh.a.x + (sh.b.x - sh.a.x) * u, y: sh.a.y + (sh.b.y - sh.a.y) * u });
    }
  } else if (sh.kind === 'circle' || sh.kind === 'bumper') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push({ x: sh.c.x + sh.r * Math.cos(a), y: sh.c.y + sh.r * Math.sin(a) });
    }
  } else if (sh.kind === 'arc') {
    let span = (sh.a1 - sh.a0) % (Math.PI * 2); if (span <= 0) span += Math.PI * 2;
    for (let i = 0; i <= n; i++) {
      const a = sh.a0 + span * (i / n);
      out.push({ x: sh.c.x + sh.radius * Math.cos(a), y: sh.c.y + sh.radius * Math.sin(a) });
    }
  } else if (sh.kind === 'flipper') {
    for (const ang of [sh.restAng, sh.endAng]) {
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        out.push({ x: sh.pivot.x + sh.len * u * Math.cos(ang), y: sh.pivot.y + sh.len * u * Math.sin(ang) });
      }
    }
  }
  return out;
}

/** Where a ball can actually BE. Every cell whose centre is a legal ball position, flood filled
 *  from the launch point, so the pockets behind a rail are excluded.
 *
 *  Both probes below need this and the first drafts did without it. The tunnel probe reported 64
 *  balls flying off the table, every one of them fired from the dead triangle behind an outer
 *  rail: the ball was never in play, so of course it left. A probe that cannot tell the playfield
 *  from the space behind it reports the table's own edges as bugs. */
export function playable(table, cfg, step) {
  const s = step || 0.003;
  const nx = Math.ceil(table.w / s);
  const ny = Math.ceil(table.h / s);
  const solid = table.shapes.filter(isSolid);
  const drains = table.shapes.filter((s2) => s2.kind === 'drain');
  const free = new Uint8Array(nx * ny);
  const sink = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const p = { x: (i + 0.5) * s, y: (j + 0.5) * s };
      if (p.x < cfg.BALL_R || p.x > table.w - cfg.BALL_R || p.y < cfg.BALL_R || p.y > table.h - cfg.BALL_R) continue;
      let ok = true;
      for (const o of solid) if (distToShape(o, p) < cfg.BALL_R) { ok = false; break; }
      if (!ok) continue;
      free[j * nx + i] = 1;
      // The drain absorbs. Without this the fill runs along the bottom of the table and back up
      // behind the rails, and every dead pocket down there is reported as part of the playfield.
      for (const d of drains) {
        if (p.x >= d.x && p.x <= d.x + d.w && p.y >= d.y && p.y <= d.y + d.h) { sink[j * nx + i] = 1; break; }
      }
    }
  }
  const seen = new Uint8Array(nx * ny);
  const start = { i: Math.floor(table.launch.x / s), j: Math.floor(table.launch.y / s) };
  const stack = [start.j * nx + start.i];
  seen[stack[0]] = 1;
  while (stack.length) {
    const k = stack.pop();
    if (sink[k]) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const m = b * nx + a;
      if (seen[m] || !free[m]) continue;
      seen[m] = 1;
      stack.push(m);
    }
  }
  return {
    step: s, nx, ny, mask: seen,
    at(p) {
      const i = Math.floor(p.x / s);
      const j = Math.floor(p.y / s);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
      return seen[j * nx + i] === 1;
    },
    // A grid cell is 3 mm and a ball can legally sit half a cell from a rail, so asking whether a
    // ball has ESCAPED has to allow for the rounding. Asking whether to fire a shot FROM a point
    // does not, which is why the strict test above is kept as well.
    near(p) {
      const h = s * 0.6;
      return this.at(p) || this.at({ x: p.x + h, y: p.y }) || this.at({ x: p.x - h, y: p.y })
        || this.at({ x: p.x, y: p.y + h }) || this.at({ x: p.x, y: p.y - h });
    },
    sunk(p) {
      const i = Math.floor(p.x / s);
      const j = Math.floor(p.y / s);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
      return sink[j * nx + i] === 1;
    },
    cells() {
      const out = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (seen[j * nx + i]) out.push({ x: (i + 0.5) * s, y: (j + 0.5) * s });
      return out;
    },
  };
}

/** WHAT DOES A FLIPPER DO TO A BALL THAT IS ALREADY TOUCHING IT?
 *
 *  The bat is the only driven part, so it is the only thing that can move a ball the ball did not
 *  move itself, and every other probe here starts with the flippers at rest. This one holds a
 *  flipper up on the first tick with the ball already in its path, over a grid of positions and a
 *  few speeds, and asks whether the ball is still in the machine afterwards.
 *
 *  Born red: a ball caught between the bat and the outer rail was pushed clear of the BAT without
 *  anything checking where it landed, so it went through the rail and out of the cabinet. */
export function flipProbe(table, cfg, opts) {
  const step = (opts && opts.step) || 0.004;
  const flippers = table.shapes.filter((s2) => s2.kind === 'flipper');
  const solid = table.shapes.filter(isSolid);
  const fails = [];
  let shots = 0;
  for (const f of flippers) {
    const reach = f.len + f.r0 + cfg.BALL_R * 3;
    for (let dx = -reach; dx <= reach; dx += step) {
      for (let dy = -reach; dy <= reach; dy += step) {
        const p = { x: f.pivot.x + dx, y: f.pivot.y + dy };
        if (p.x < cfg.BALL_R || p.x > table.w - cfg.BALL_R || p.y < cfg.BALL_R || p.y > table.h - cfg.BALL_R) continue;
        let legal = true;
        for (const o of solid) if (distToShape(o, p) < cfg.BALL_R + 2e-4) { legal = false; break; }
        if (!legal) continue;
        for (const v of [{ x: 0, y: 0 }, { x: 0, y: 1.5 }, { x: -1.5, y: 1.0 }, { x: 1.5, y: 1.0 }]) {
          shots++;
          const w = new World(table, cfg);
          const b = w.addBall(p, v);
          w.setFlipper(f.side, true);
          for (let k = 0; k < 90 && b.alive; k++) w.step(cfg.DT);
          w.setFlipper(f.side, false);
          for (let k = 0; k < 270 && b.alive; k++) w.step(cfg.DT);
          if (w.escapes) fails.push({ flipper: f.id, from: p, v, end: { x: b.p.x, y: b.p.y } });
        }
      }
    }
  }
  return { shots, fails };
}

/** CAN A BALL LEAVE THE MACHINE? Fired hard from everywhere it can legally be, at every angle,
 *  with the flippers working, and run long enough to get out.
 *
 *  This is the probe that matters most, because it is the one that would have caught what Matt
 *  found by playing, and the three checks that shipped before it all missed:
 *    - the tunnel probe watched a quarter of a second, and the ball took two
 *    - the rest sweep starts every ball at rest, and this needs speed
 *    - a static "is the cabinet closed" test passed the broken table outright, which is why it is
 *      not in this file: a check that says OK about a table a ball can leave is worse than none
 *
 *  It leans on the solver counting its own escapes (`World.escapes`) rather than on a geometric
 *  argument, so it cannot be fooled by a hole nobody thought to look for. */
export function escapeProbe(table, cfg, opts) {
  const step = (opts && opts.step) || 0.02;
  const angles = (opts && opts.angles) || 12;
  const speeds = (opts && opts.speeds) || [4, cfg.MAX_SPEED];
  const solid = table.shapes.filter(isSolid);
  const play = (opts && opts.play) || playable(table, cfg);
  const fails = [];
  let shots = 0;
  for (let x = cfg.BALL_R; x < table.w; x += step) {
    for (let y = cfg.BALL_R; y < table.h; y += step) {
      // Reachable AND legal, both. The first run of this probe reported 532 escapes and every one
      // started at (14, 14) mm, the dead corner BEHIND the corner rail. Third time this file has
      // learned it: a ball that was never in play has not escaped anything.
      if (!play.at({ x, y })) continue;
      let legal = true;
      for (const o of solid) if (distToShape(o, { x, y }) < cfg.BALL_R + 2e-4) { legal = false; break; }
      if (!legal) continue;
      for (let a = 0; a < angles; a++) {
        const ang = (a / angles) * Math.PI * 2;
        for (const sp of speeds) {
          for (const hold of [null, 'L', 'R']) {
            shots++;
            const w = new World(table, cfg);
            const b = w.addBall({ x, y }, { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp });
            if (hold) w.setFlipper(hold, true);
            for (let k = 0; k < 240 && b.alive; k++) {
              if (hold && k === 40) w.setFlipper(hold, false);
              if (hold && k === 90) w.setFlipper(hold, true);
              w.step(cfg.DT);
            }
            if (w.escapes) fails.push({ from: { x, y }, deg: Math.round((ang * 180) / Math.PI), speed: sp, hold, end: { x: b.p.x, y: b.p.y } });
          }
        }
      }
    }
  }
  return { shots, fails };
}

/** DOES A FLIP ACTUALLY HIT THE BALL? Measured as TRAVEL, not speed.
 *
 *  A ball is placed at rest on the bat, the flipper is tapped, and the probe reports how far UP the
 *  table the ball gets. Travel is the number a player feels and it is the only one that stayed
 *  honest: while this was broken, a faster flip, bouncier rubber, a higher restitution floor and an
 *  explicit push all moved the ball's top SPEED from 1.8 to 6.4 m/s and not one of them moved how
 *  far it went. Four candidate fixes were rejected on that basis before the real cause was found.
 *
 *  Born red at 56 / 53 / 922 / 921 mm: only the outer third of the bat threw the ball at all. */
export function flipPower(table, cfg, opts) {
  const spots = (opts && opts.spots) || [0.3, 0.5, 0.7, 0.9];
  const out = [];
  for (const f of table.shapes.filter((s2) => s2.kind === 'flipper')) {
    for (const u of spots) {
      const dir = { x: Math.cos(f.restAng), y: Math.sin(f.restAng) };
      const nrm = { x: -dir.y, y: dir.x };
      const sign = f.side === 'L' ? -1 : 1;
      const rad = f.r0 + (f.r1 - f.r0) * u + cfg.BALL_R;
      const p = {
        x: f.pivot.x + dir.x * f.len * u + sign * nrm.x * rad,
        y: f.pivot.y + dir.y * f.len * u + sign * nrm.y * rad,
      };
      const w = new World(table, cfg);
      const b = w.addBall(p, { x: 0, y: 0 });
      for (let k = 0; k < 24 && b.alive; k++) w.step(cfg.DT);
      const y0 = b.p.y;
      w.setFlipper(f.side, true);
      let top = b.p.y;
      for (let k = 0; k < 720 && b.alive; k++) {
        if (k === 20) w.setFlipper(f.side, false);
        w.step(cfg.DT);
        if (b.p.y < top) top = b.p.y;
      }
      out.push({ flipper: f.id, side: f.side, u, travel: y0 - top });
    }
  }
  return out;
}

/** THE RAMP PROBE. A ramp is the one place the old game lost balls, so this asks the hard questions.
 *
 *  Structural, on the geometry itself:
 *    - both ends are at z = 0, because a ball leaving a mouth in mid air has nowhere honest to land
 *    - NO SEGMENT IS LEVEL. A run flat in height and square to the table has no force along it, so
 *      a ball that stops there stops for ever. The first ramp built here had a flat top and the
 *      rest sweep parked three balls on it.
 *
 *  Then it fires a ball at the mouth across the whole speed range and checks, for every shot:
 *    - the ball still exists at the end. Never vanished
 *    - its world position never JUMPS. Getting on and off a ramp is a change of coordinates, and
 *      this is the assertion that says so: no step may move the ball further than it travelled
 *    - a shot too slow to climb rolls back out of the mouth it came in
 *    - a shot with enough speed reaches the far end and comes out there
 *    - it is never still on the ramp when the clock runs out */
export function rampProbe(table, cfg, opts) {
  const tilt = (cfg.TILT_DEG * Math.PI) / 180;
  const g = gravity(cfg);
  const fails = [];
  const runs = [];
  for (const sh of table.shapes.filter((s2) => s2.kind === 'ribbon')) {
    const geom = ribbonGeom(sh);
    const first = sh.pts[0];
    const last = sh.pts[sh.pts.length - 1];
    if ((first.z || 0) > 1e-6) fails.push({ ramp: sh.id, why: `starts at z = ${first.z}, not 0` });
    if ((last.z || 0) > 1e-6) fails.push({ ramp: sh.id, why: `ends at z = ${last.z}, not 0` });
    // A CREST IS ALLOWED; A PLATEAU IS NOT. Along-lane force is the table's own slope resolved
    // along the lane minus the cost of the climb, and at the top of a ramp those balance - which is
    // just a hilltop, and a ball balanced on a hilltop is a knife edge, not a trap. What cannot be
    // allowed is a RUN of it: a stretch where nothing moves a ball that stops, which is where three
    // balls parked in the first version. So the run length is what gets measured.
    let flat = 0;
    let worstFlat = 0;
    for (const sg of geom.segs) {
      const as = g * sg.dir.y - cfg.G * Math.cos(tilt) * sg.slope;
      flat = Math.abs(as) < 0.05 ? flat + sg.L : 0;
      if (flat > worstFlat) worstFlat = flat;
    }
    if (worstFlat > 0.040) {
      fails.push({ ramp: sh.id, why: `${(worstFlat * 1000).toFixed(0)}mm of lane where nothing moves a ball that stops on it (40mm allowed, a crest is a point)` });
    }
    // No kinks. A junction turns the lane's sideways axis, so a sharp one MOVES a ball riding off
    // the centre line, by q times the turn, in a single step. A real wireform cannot kink.
    for (let i = 1; i < geom.segs.length; i++) {
      const a = geom.segs[i - 1].dir;
      const b = geom.segs[i].dir;
      const turn = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * 180 / Math.PI;
      if (turn > 20) fails.push({ ramp: sh.id, why: `a ${turn.toFixed(0)} degree kink at s = ${geom.segs[i].s0.toFixed(3)}, over the 20 degree limit` });
    }

    // Fire at the mouth, from just outside it, straight up the lane.
    const at = ribbonAt(geom, 0);
    const speeds = (opts && opts.speeds) || [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 8.0];
    for (const sp of speeds) {
      const from = { x: at.x - at.dir.x * 0.05, y: at.y - at.dir.y * 0.05 };
      const w = new World(table, cfg);
      const b = w.addBall(from, { x: at.dir.x * sp, y: at.dir.y * sp });
      let got = false;
      let maxJump = 0;
      let prev = { x: b.p.x, y: b.p.y };
      let exitEnd = null;
      for (let k = 0; k < 1800 && b.alive; k++) {
        const wasOn = !!b.ribbon;
        // The speed BEFORE the tick matters as much as the speed after it. A ball can leave a ramp
        // at 3.86 m/s, travel the 15mm that entitles it to, and hit something before the tick ends:
        // measured against its END speed of 1.89 that reads as a 3.2mm teleport, and it is not one.
        // What it may never do is cover more ground than its fastest speed during the tick allows.
        const vBefore = Math.hypot(b.v.x, b.v.y);
        w.step(cfg.DT);
        if (b.ribbon) got = true;
        if (wasOn && !b.ribbon) exitEnd = b.s <= 0 ? 'near' : 'far';
        const moved = Math.hypot(b.p.x - prev.x, b.p.y - prev.y);
        const could = Math.max(vBefore, Math.hypot(b.v.x, b.v.y)) * cfg.DT + 0.004;
        if (moved - could > maxJump) maxJump = moved - could;
        prev = { x: b.p.x, y: b.p.y };
      }
      const ridingSpeed = b.ribbon ? Math.abs(b.vs) : 0;
      runs.push({ ramp: sh.id, speed: sp, got, exitEnd, maxJump, stillOn: !!b.ribbon, riding: ridingSpeed, alive: b.alive, escapes: w.escapes, broken: w.broken });
      if (maxJump > 0.001) fails.push({ ramp: sh.id, speed: sp, why: `position jumped ${(maxJump * 1000).toFixed(1)}mm further than it travelled` });
      if (w.escapes) fails.push({ ramp: sh.id, speed: sp, why: 'left the machine' });
      if (w.broken) fails.push({ ramp: sh.id, speed: sp, why: 'its numbers stopped being numbers' });
      // Still ON the ramp is fine if it is still MOVING: a ball can shuttle up and back down one
      // for a while, and that is a ramp doing its job. Still on it and stopped is a trap.
      if (b.ribbon && ridingSpeed < 0.05) fails.push({ ramp: sh.id, speed: sp, why: `parked on the ramp at s = ${b.s.toFixed(3)}` });
    }
    const onRamp = runs.filter((r) => r.ramp === sh.id && r.got);
    if (!onRamp.some((r) => r.exitEnd === 'far')) fails.push({ ramp: sh.id, why: 'no shot at any speed made it all the way round' });
    if (!onRamp.some((r) => r.exitEnd === 'near')) fails.push({ ramp: sh.id, why: 'no shot was weak enough to roll back out of the mouth' });
  }
  return { runs, fails };
}

/** Ambiguous gaps: a space near one ball wide is where a ball wedges. A gap must be clearly shut
 *  or clearly open. Overlaps are reported separately and are often deliberate (a rail meeting a
 *  flipper pivot is how you SHUT a gap), so they are a note, not a failure. */
export function checkGaps(table, cfg) {
  const d = cfg.BALL_R * 2;
  const lo = d * 0.75;
  const hi = d * 1.15;
  const solid = table.shapes.filter(isSolid);
  const flags = [];
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const A = solid[i];
      const B = solid[j];
      let best = Infinity;
      let at = null;
      for (const p of surfacePoints(A, 24)) {
        const g = distToShape(B, p) - (A.r != null ? 0 : 0);
        if (g < best) { best = g; at = p; }
      }
      const gap = best - (A.r != null ? A.r : Math.max(A.r0 || 0, A.r1 || 0));
      if (gap > lo && gap < hi) flags.push({ kind: 'gap', a: A.id, b: B.id, gap, at });
      else if (gap < -1e-4) flags.push({ kind: 'overlap', a: A.id, b: B.id, gap, at, note: true });
    }
  }
  return flags;
}

/** Is gravity a TILTED PLANE and is anything secretly braking the ball?
 *
 *  A ball dropped straight down the middle of an empty table meets nothing, so its time is pure
 *  free fall: sqrt(2h/g sin tilt), 1.31 s over this playfield. That analytic number is the honest
 *  assertion. "It should take about three seconds" is not: three seconds is how long a ball lives
 *  on a real machine, and it lives that long because it keeps hitting things, not because gravity
 *  is weak. The two were confused when this file was written, so it is written down.
 *
 *  `alive` is the feel number beside it: released into the top left corner, so the ball rides the
 *  rails and the flippers the way a real one does. It is reported, never gated. */
export function drainTime(table, cfg) {
  const g = gravity(cfg);
  const drop = table.shapes.find((s) => s.kind === 'drain');
  const y0 = 0.05;
  const h = (drop ? drop.y : table.h) - y0;
  // Gravity is a property of the CONFIG, not of the table, so it is measured on a table with
  // nothing in it but the drain. Measuring it on the real one worked until the day the table got a
  // pop bumper in the middle of the drop, and then reported NEVER DRAINED: a true statement about
  // a ball bouncing happily between three bumpers, and nothing at all about gravity.
  const bare = { w: table.w, h: table.h, launch: table.launch, shapes: drop ? [drop] : [] };
  const w = new World(bare, cfg);
  const b = w.addBall({ x: table.w / 2, y: y0 }, { x: 0, y: 0 });
  let t = 0;
  while (b.alive && t < 20) { w.step(cfg.DT); t += cfg.DT; }

  const w2 = new World(table, cfg);
  const b2 = w2.addBall({ x: 0.032, y: 0.08 }, { x: 0, y: 0 });
  let t2 = 0;
  while (b2.alive && t2 < 60) { w2.step(cfg.DT); t2 += cfg.DT; }

  return {
    seconds: b.alive ? null : t,
    analytic: Math.sqrt((2 * h) / g),
    alive: b2.alive ? null : t2,
    gravity: g,
    jams: w.jams + w2.jams,
  };
}

/** Fire a ball at every collider, hard, from every side. Anything that ends up outside the
 *  playfield or inside a solid went THROUGH something. */
export function tunnelProbe(table, cfg, opts) {
  const angles = (opts && opts.angles) || 24;
  const speed = (opts && opts.speed) || cfg.MAX_SPEED;
  const play = (opts && opts.play) || playable(table, cfg);
  const fails = [];
  let shots = 0;
  const solid = table.shapes.filter(isSolid);
  for (const sh of solid) {
    for (const p of surfacePoints(sh, 6)) {
      for (let i = 0; i < angles; i++) {
        const a = (i / angles) * Math.PI * 2;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        const from = { x: p.x - dir.x * 0.06, y: p.y - dir.y * 0.06 };
        // Two tests, and both are needed. The mask says the point is REACHABLE, which a bare
        // clearance test cannot (it would happily fire from a sealed pocket). The exact distance
        // says the point is LEGAL, which the mask cannot: a 3 mm cell can sit a millimetre inside
        // a rail and still round to free, and four shots launched from inside a rail were reported
        // as tunnelling through it.
        if (!play.at(from)) continue;
        let legal = true;
        for (const o of solid) if (distToShape(o, from) < cfg.BALL_R + 2e-4) { legal = false; break; }
        if (!legal) continue;
        shots++;
        const w = new World(table, cfg);
        const b = w.addBall(from, { x: dir.x * speed, y: dir.y * speed });
        for (let k = 0; k < 60 && b.alive; k++) w.step(cfg.DT);
        if (!b.alive) continue;
        let inside = null;
        for (const o of solid) if (distToShape(o, b.p) < cfg.BALL_R - 5e-4) { inside = o.id; break; }
        const escaped = !play.near(b.p);
        if (escaped || inside) fails.push({ shape: sh.id, from, dir, end: { x: b.p.x, y: b.p.y }, out: escaped, inside });
      }
    }
  }
  return { shots, fails };
}

/** Every place a ball can come to rest that is not the drain. A list of coordinates, because a
 *  percentage tells you nothing about where to go and fix the table. */
export function restSweep(table, cfg, opts) {
  const step = (opts && opts.step) || 0.012;
  const seconds = (opts && opts.seconds) || 6;
  const play = (opts && opts.play) || playable(table, cfg);
  const stuck = [];
  const alive = [];
  let drops = 0;
  for (let x = cfg.BALL_R; x < table.w; x += step) {
    for (let y = cfg.BALL_R; y < table.h; y += step) {
      const p = { x, y };
      if (!play.at(p)) continue;
      let legal = true;
      for (const o of table.shapes) if (isSolid(o) && distToShape(o, p) < cfg.BALL_R + 2e-4) { legal = false; break; }
      if (!legal) continue;
      drops++;
      const w = new World(table, cfg);
      const b = w.addBall(p, { x: 0, y: 0 });
      const ticks = Math.round(seconds / cfg.DT);
      for (let k = 0; k < ticks && b.alive; k++) w.step(cfg.DT);
      if (b.alive) {
        // STILL ALIVE IS NOT STUCK, and it stopped being the same question the day this table got
        // bumpers. A ball ricocheting between three pop bumpers at 2.8 m/s has not reached the
        // drain in six seconds and never will on that timescale, which is the POINT of a bumper. A
        // trap is a ball that has stopped: the speed is what separates them, not the clock.
        const speed = Math.hypot(b.v.x, b.v.y);
        let on = null;
        for (const o of table.shapes) {
          if (isSolid(o) && distToShape(o, b.p) < cfg.BALL_R + 0.002) on = o.id;
        }
        const rec = { from: p, at: { x: b.p.x, y: b.p.y }, speed, on };
        if (speed < 0.05) stuck.push(rec); else alive.push(rec);
      }
    }
  }
  // A KNIFE EDGE IS NOT A TRAP. A ball balanced on the apex of a post or along the spine of a bat
  // is a real equilibrium in the maths and an impossible one on a table: the smallest disturbance
  // ends it, and a real machine has nothing but disturbances. So every survivor is re-run with a
  // nudge no bigger than a nudge, and the ones that then drain are reported separately. This is
  // the same call `sweep-pinball-rests.mjs` makes for the old game, and for the same reason.
  const real = [];
  const edges = [];
  for (const st of stuck) {
    let freed = 0;
    for (const push of [{ x: 0.05, y: 0 }, { x: -0.05, y: 0 }]) {
      const w = new World(table, cfg);
      const b = w.addBall(st.at, push);
      const ticks = Math.round(seconds / cfg.DT);
      for (let k = 0; k < ticks && b.alive; k++) w.step(cfg.DT);
      if (!b.alive) freed++;
    }
    if (freed === 2) edges.push(st); else real.push(st);
  }
  return { drops, stuck: real, edges, alive };
}
