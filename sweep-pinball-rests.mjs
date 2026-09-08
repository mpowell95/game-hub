// sweep-pinball-rests.mjs - WHERE CAN A PINBALL COME TO REST THAT IS NOT THE DRAIN?
//
// Run: node sweep-pinball-rests.mjs [rainbow|starhub] [--held] [--step N]
//
// WHY THIS EXISTS. Matt, on the third build of the RAINBOW board: *"The ball still gets stuck lots
// of places - see screenshot. You need to play it or something to prevent this. It's not a good use
// of my time if every test result is 'the ball gets stuck'."* He is right, and the reason the soak
// kept missing them is that a soak is a SAMPLE. A random flipper driver visits the parts of the
// table it happens to visit; a trap in a corner it never reaches is invisible however many games
// you run, and pinball/CLAUDE.md already records four separate wedges found only by staring at an
// occupancy histogram after the fact.
//
// So this does not sample. It drops a ball, at rest, on EVERY point of a grid over the whole
// playfield, runs the real solver for six seconds with nothing else moving, and asks one question:
// did it reach the drain? Anything that stops somewhere else is a trap, and the answer is a list of
// coordinates rather than a percentage.
//
// It is deliberately harder than the real game: a real ball arrives with speed and usually rolls
// through a pocket that a ball placed AT REST inside it cannot escape. So a point reported here is
// a place a ball CAN die, not a place it always will - which is the right way round for a probe
// whose job is to be exhaustive.
//
// `--held` runs the same sweep with both flippers raised, which is a different table: a raised
// paddle is a shelf, and the RAINBOW board's two UPPER flippers are on the same buttons as the main
// pair, so the geometry a player creates by holding a button has to be swept too.
//
// The flipper faces themselves are excluded from the count: a ball resting on a raised paddle is a
// CRADLE, which is the player aiming and not a fault.

import { step, makeBall, PHYS_DT, BALL_R } from './pinball/js/physics.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d;
};
const board = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'rainbow';
const held = process.argv.includes('--held');
const GRID = arg('--step', 10);

const T = board === 'starhub'
  ? await import('./pinball/js/table.js')
  : await import('./pinball/js/table-rainbow.js');
const GRAVITY = 515;
const SECS = 6;
const STEPS = Math.round(SECS / PHYS_DT);

const W = T.W, H = T.H, DRAIN = T.DRAIN_Y;

/** Is this start point inside a solid? Those are not drops, they are nonsense. */
function blocked(colliders, x, y) {
  for (const c of colliders) {
    if (!c.on) continue;
    if (c.t === 'circle') {
      if (Math.hypot(x - c.x, y - c.y) < c.r + BALL_R - 1) return true;
    } else if (c.t === 'seg') {
      const dx = c.bx - c.ax, dy = c.by - c.ay;
      const l2 = dx * dx + dy * dy || 1;
      let t = ((x - c.ax) * dx + (y - c.ay) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(x - (c.ax + dx * t), y - (c.ay + dy * t)) < c.r + BALL_R - 1) return true;
    } else if (c.t === 'arc') {
      const d = Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.rad);
      if (d < c.r + BALL_R - 1) return true;
    }
  }
  return false;
}

const built = T.buildTable({});
for (const f of built.flippers) {
  f.pressed = held;
  f.angle = held ? f.up : f.rest;
}
const world = {
  colliders: built.colliders, flippers: built.flippers,
  gravity: GRAVITY, drag: 0.16, nudgeX: 0, nudgeY: 0,
};

/** A ball resting ON a raised paddle is a cradle, not a trap. */
function onFlipper(x, y) {
  for (const f of built.flippers) {
    const tx = f.px + Math.cos(f.angle) * f.len;
    const ty = f.py + Math.sin(f.angle) * f.len;
    const dx = tx - f.px, dy = ty - f.py;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - f.px) * dx + (y - f.py) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(x - (f.px + dx * t), y - (f.py + dy * t)) <= f.r + BALL_R + 6) return true;
  }
  return false;
}

let dropped = 0, drained = 0, moving = 0, knife = 0;
const stuck = [];
for (let x = 12; x <= W - 12; x += GRID) {
  for (let y = 20; y <= DRAIN - 20; y += GRID) {
    if (blocked(built.colliders, x, y)) continue;
    dropped++;
    const b = makeBall(x, y, 0, 0);
    let out = false;
    const touched = new Set();
    for (let i = 0; i < STEPS; i++) {
      // Only the last half-second's contacts: what is HOLDING it, not what it met on the way.
      const late = i > STEPS - 120;
      step(world, [b], late ? (kind, id) => { if (id) touched.add(id); } : null);
      if (b.y > DRAIN + BALL_R * 2 || b.x < -40 || b.x > W + 40) { out = true; break; }
    }
    if (out) { drained++; continue; }
    if (onFlipper(b.x, b.y)) { drained++; continue; }   // a cradle, not a fault
    const v = Math.hypot(b.vx, b.vy);
    // STILL MOVING IS NOT STUCK. A ball bouncing round the bumper nest at 150 units/s after six
    // seconds is in play; only something that has actually come to rest is a trap.
    if (v > 25) { moving++; continue; }
    // A KNIFE EDGE IS NOT A TRAP. A ball placed with exactly zero velocity on the exact apex of a
    // single post will sit there; a real ball arrives moving and cannot. So every survivor is
    // re-run from where it stopped with a small sideways push, both ways, and only counted if it
    // STILL cannot get out. Without this the report is dominated by balances no player can make.
    let escapes = false;
    for (const push of [-16, 16]) {
      const c = makeBall(b.x, b.y, push, 0);
      for (let i = 0; i < STEPS && !escapes; i++) {
        step(world, [c], null);
        if (c.y > DRAIN + BALL_R * 2 || c.x < -40 || c.x > W + 40) escapes = true;
      }
      if (escapes) break;
    }
    if (escapes) { knife++; continue; }
    stuck.push([Math.round(b.x), Math.round(b.y), Math.round(v), [...touched].join('+')]);
  }
}

// Cluster the survivors, because one trap catches a whole neighbourhood of start points and a raw
// list of 300 coordinates hides how many DISTINCT places there are.
const clusters = [];
for (const [x, y, v, ids] of stuck) {
  const c = clusters.find((k) => Math.hypot(k.x - x, k.y - y) < 22);
  if (c) { c.n++; c.v = Math.min(c.v, v); c.ids.add(ids); continue; }
  clusters.push({ x, y, n: 1, v, ids: new Set([ids]) });
}
clusters.sort((a, b) => b.n - a.n);

console.log(`${board}${held ? ' [flippers HELD]' : ''}  grid ${GRID}  ${dropped} drops, ${SECS}s each`);
console.log(`  reached the drain: ${drained}  (${(100 * drained / dropped).toFixed(1)}%)`);
console.log(`  still in play at ${SECS}s: ${moving}`);
console.log(`  knife-edge balances a nudge frees: ${knife}`);
console.log(`  AT REST somewhere else: ${stuck.length} in ${clusters.length} distinct places`);
for (const c of clusters.slice(0, 18)) {
  const held = [...c.ids].filter(Boolean).slice(0, 2).join(' / ') || '(nothing)';
  console.log(`    (${c.x}, ${c.y})  ${c.n} starts, ${c.v} units/s   held by: ${held}`);
}
if (clusters.length > 18) console.log(`    ...and ${clusters.length - 18} more`);
process.exitCode = clusters.length ? 1 : 0;
