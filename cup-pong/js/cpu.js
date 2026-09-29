// cup-pong/js/cpu.js - THE COMPUTER. Pure: no DOM, no engine.
//
// Brief 5a: "an aim error model, not a different physics: it picks a target cup, computes the throw
// that lands in it, and adds noise scaled by skill." The throw it computes goes through the SAME
// physics.js as the player's, so a computer make is a real make.
//
// The aim: a ballistic table (the same launch point, angle, gravity and drag as physics.js) maps
// power to how far the ball has travelled when it comes down through rim height, and is inverted
// for the target cup's distance. Heading is the straight line to the cup (the ball flies straight in
// plan view: no spin, no wind). Then each throw is perturbed by a Gaussian error in power and in
// heading. The sigmas are the difficulty, and they were TUNED on the real physics by
// `node cup-pong/js/test.js --cpu` (the make rates are in cup-pong/CLAUDE.md), not picked.

import { THROW, CUP, GRAVITY, DRAG_K } from './geom.js';
import { launchSpeed } from './physics.js';
import { presetsFor, touchingPairs, applyPreset } from './rack.js';

export const SKILL = {
  easy:   { sPower: 0.30, sAim: 0.080 },
  medium: { sPower: 0.15, sAim: 0.040 },
  hard:   { sPower: 0.06, sAim: 0.025 },
};

/** Horizontal distance travelled when the ball comes back down through rim height. */
function rangeAtRim(power) {
  const v = launchSpeed(power);
  const H = 1 / 480;
  let y = THROW.y0, d = 0;
  let vy = v * Math.sin(THROW.elev), vh = v * Math.cos(THROW.elev);
  for (let i = 0; i < 6000; i++) {
    const s = Math.hypot(vy, vh), f = Math.max(0, 1 - DRAG_K * s * H);
    vy *= f; vh *= f;
    vy -= GRAVITY * H;
    y += vy * H; d += vh * H;
    if (vy < 0 && y <= CUP.h) return d;
  }
  return d;
}

let _table = null;
function table() {
  if (_table) return _table;
  _table = [];
  for (let p = -0.6; p <= 1.6001; p += 0.005) _table.push([p, rangeAtRim(p)]);
  return _table;
}

/** The power whose ball comes down through the rim plane `dist` metres away. */
export function powerFor(dist) {
  const T = table();
  if (dist <= T[0][1]) return T[0][0];
  for (let i = 1; i < T.length; i++) {
    if (T[i][1] >= dist) {
      const [p0, d0] = T[i - 1], [p1, d1] = T[i];
      return p0 + (p1 - p0) * (dist - d0) / (d1 - d0);
    }
  }
  return T[T.length - 1][0];
}

/** The perfect throw at a cup at (x, z) in the shooter's frame. */
export function aimAt(x, z) {
  // Aim a little PAST the centre: a ball coming down through the rim plane at the centre is still
  // travelling forward and meets the far wall; a hair beyond puts it in the middle of the cup.
  const dz = THROW.z0 - z, dist = Math.hypot(x, dz);
  return { power: powerFor(dist + CUP.topR * 0.15), aim: Math.atan2(x, dz) };
}

/** Standard normal, from a uniform source (Box-Muller). */
function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Pick a target and a throw. `cups` is [{ id, x, z }] in the shooter's frame. `rnd` is a
 * uniform [0, 1) source (Math.random in play; a seeded one in the tests).
 */
export function cpuThrow(skill, cups, rnd = Math.random, targetId = null) {
  const S = SKILL[skill] || SKILL.medium;
  if (!cups.length) return { power: 0.5, aim: 0, target: null };
  let target = targetId ? cups.find((k) => k.id === targetId) : null;
  if (target) {
    // a called island: aim at it
  } else if (skill === 'hard') {
    // The cup with the most neighbours: a near miss there still lands in a cup.
    const score = (k) => cups.filter((o) => o !== k && Math.hypot(o.x - k.x, o.z - k.z) < 0.11).length;
    const best = Math.max(...cups.map(score));
    const pool = cups.filter((k) => score(k) === best);
    target = pool[Math.floor(rnd() * pool.length)];
  } else {
    target = cups[Math.floor(rnd() * cups.length)];
  }
  const t = aimAt(target.x, target.z);
  return {
    power: t.power + gauss(rnd) * S.sPower,
    aim: t.aim + gauss(rnd) * S.sAim,
    target: target.id,
  };
}

/**
 * THE COMPUTER'S OPTIONS at the start of its turn, by the same rules as the player's (brief 5a).
 * Returns the actions to take, in order, as calls on the Match: Gentleman's whenever it is on offer
 * (it only ever helps the shooter), a rerack when a preset is clearly tidier than what is standing
 * ("CPU racks: it picks presets only"), then an island when there is one to call.
 */
export function cpuOptions(match) {
  const out = [];
  if (match.canGentlemans()) out.push({ type: 'gentlemans' });
  else if (match.canRerack()) {
    const rack = match.target();
    const now = touchingPairs(rack);
    let best = null;
    for (const p of presetsFor(rack.length, match.backRack)) {
      const score = touchingPairs(applyPreset(rack, p.spots));
      if (!best || score > best.score) best = { key: p.key, score };
    }
    if (best && best.score >= now + 2) out.push({ type: 'rerack', key: best.key });
  }
  return out;
}

/** After its options: the island to call, if any (the first one; aimed at by cpuThrow). */
export function cpuIsland(match) {
  if (!match.canIsland()) return null;
  return match.islands()[0] || null;
}

/** The computer owes a second cup after the player's island: the loneliest of its cups (a cup the
 *  player would find hardest to hit anyway), the back-most on a tie. */
export function cpuPick(cups) {
  const touching = (k) => cups.filter((o) => o !== k && Math.hypot(o.x - k.x, o.z - k.z) < 0.105).length;
  let best = null;
  for (const k of cups) {
    const t = touching(k);
    if (!best || t < best.t || (t === best.t && k.z < best.k.z)) best = { k, t };
  }
  return best ? best.k.id : null;
}

/** A seeded uniform source, for deterministic tests. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default { SKILL, powerFor, aimAt, cpuThrow, cpuOptions, cpuIsland, cpuPick, seeded };
