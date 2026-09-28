// air-hockey/js/ai.js - the computer's mallet. It plays by the same physics as yours: the AI only
// chooses where its mallet should go, and physics.js moves it there. What makes it beatable is a
// SPEED LIMIT (how fast it can move its mallet) and a REACTION DELAY (it sees the puck as it was
// `react` seconds ago, re-sampled every `react` seconds, and extrapolates in between).
//
// Everything is worked out in the mallet's OWN frame - its own goal at y = 0, the opponent's at
// y = H - so the same code can drive either side (the headless test plays CPU vs CPU).

import { TABLE, clampTarget } from './physics.js';

const { W, H, PUCK_R: PR, MALLET_R: MR } = TABLE;
const SUM = PR + MR;

// RETUNED 2026-09-28. Matt, on the stage 2 levels: *"the computer player is way too good. i haven't
// been able to score a single goal, even on easy."* The stage 2 numbers had been tuned against
// scripted players that aim like a machine; the test's CHASER (a beginner's thumb: sees the puck
// late, chases it, whacks it upward, no aiming) reproduces what he saw (1.4 goals a match against
// the old Easy, never a win). The real cause was DEFENCE: the mallet waited in front of the middle
// of its goal (it covers about two thirds of the mouth) and slid across at full attack speed.
// Now each level has its own:
//   guard  how fast it moves when defending or getting back (was: the attack speed)
//   shade  how far it follows the puck sideways while waiting (1 = all the way, leaving the far
//          side of the goal open; was 0.3)
//   home   how far out it waits (further out = more angle to shoot past it)
// Numbers in air-hockey/CLAUDE.md, "The computer".
export const LEVELS = {
  easy:   { speed: 430, react: 0.38, aimErr: 0.8,  strike: 0.7, bank: 0,    misread: 0.55, guard: 200, shade: 0.95, home: 170 },
  medium: { speed: 650, react: 0.28, aimErr: 0.45, strike: 0.85, bank: 0.1, misread: 0.42, guard: 280, shade: 0.8,  home: 145 },
  hard:   { speed: 840, react: 0.21, aimErr: 0.3,  strike: 1.0, bank: 0.2,  misread: 0.3,  guard: 450, shade: 0.55, home: 125 },
  // Expert (2026-09-28, Matt: "an Expert level above Hard"): roughly the stage 2 Hard, which no
  // scripted beginner could score on - for once Hard is beaten.
  expert: { speed: 950, react: 0.16, aimErr: 0.27, strike: 1.05, bank: 0.25, misread: 0.25, guard: 800, shade: 0.35, home: 110 },
};
export const DIFFS = ['easy', 'medium', 'hard', 'expert'];

/** Small seeded PRNG, so a headless sim is repeatable. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G0 = (W - TABLE.GOAL_W) / 2, G1 = (W + TABLE.GOAL_W) / 2;

/** The x where a puck at (px,py) moving (vx,vy<0) crosses y = line, side walls folded in (a
 *  straight-line guess: with a misread vx it can be wrong, which is the point). Clamped to the
 *  goal mouth, since guarding anywhere wider than the goal is wasted travel. */
function crossX(px, py, vx, vy, line) {
  if (vy >= -1e-3) return W / 2;
  const t = (py - line) / -vy;
  const span = W - 2 * PR;
  let x = (px - PR + vx * t) % (2 * span);
  if (x < 0) x += 2 * span;
  if (x > span) x = 2 * span - x;
  x += PR;
  return Math.max(G0 + 10, Math.min(G1 - 10, x));
}

/** `guard`, `shade` and `home` arrived with the 2026-09-28 retune; a level (or a scripted test
 *  player) written without them defends the way every level did before it. */
function withDefaults(lv) {
  return { guard: lv.speed, shade: 0.3, home: 105, ...lv };
}

export function createCpu(level = 'medium', side = 1, seed = 1) {
  return {
    lv: withDefaults(typeof level === 'object' ? level : (LEVELS[level] || LEVELS.medium)), side, rand: rng(seed),
    clock: 1e9, sx: W / 2, sy: H / 2, svx: 0, svy: 0, age: 0,
    attacking: false, aimX: W / 2, bankSide: 0,
  };
}

/** Decide where the mallet goes this frame. Allocation-free. */
export function cpuThink(s, c, dt) {
  const m = s.mallets[c.side];
  const p = s.puck;
  const flip = c.side === 1 ? 1 : -1;           // own frame: y' = side1 ? y : H - y
  const toOwnY = (y) => (c.side === 1 ? y : H - y);

  // Reaction delay: look at the puck only every `react` seconds.
  c.clock += dt;
  if (c.clock >= c.lv.react) {
    c.clock = 0; c.age = 0;
    // MISREAD: it judges the puck's sideways speed a little wrong (a fresh error per look), so an
    // angled or banked shot can beat it, the way it beats a person.
    c.sx = p.x; c.sy = toOwnY(p.y); c.svy = p.vy * flip;
    c.svx = p.vx + (c.rand() * 2 - 1) * c.lv.misread * Math.abs(p.vy);
  } else c.age += dt;

  // Where it thinks the puck is now (straight-line guess, side walls folded back in).
  let px = c.sx + c.svx * c.age;
  const py = c.sy + c.svy * c.age;
  if (px < PR) px = 2 * PR - px; else if (px > W - PR) px = 2 * (W - PR) - px;
  const pvy = c.svy;
  const mx = m.x, my = toOwnY(m.y);

  let tx = W / 2, ty = 100, speed = c.lv.speed;

  if (!p.live) {
    c.attacking = false;
  } else if (py < H / 2 + PR) {
    // The puck is on its side.
    const pSpeed = Math.hypot(c.svx, pvy);
    if (pvy < -300 && pSpeed > 500 && py > my) {
      // DEFEND: a fast puck coming at the goal. Go where it will cross the guard line.
      c.attacking = false;
      tx = crossX(px, py, c.svx, pvy, c.lv.home); ty = c.lv.home; speed = c.lv.guard;
    } else {
      // ATTACK: go behind the puck, then drive through it toward the far goal.
      if (!c.attacking) {
        c.attacking = true;
        c.aimX = W / 2 + (c.rand() * 2 - 1) * c.lv.aimErr * (TABLE.GOAL_W);
        c.bankSide = c.rand() < c.lv.bank ? (c.rand() < 0.5 ? -1 : 1) : 0;
      }
      // A bank shot aims at the goal's mirror image behind a side wall.
      let ax = c.aimX;
      if (c.bankSide < 0) ax = -c.aimX; else if (c.bankSide > 0) ax = 2 * W - c.aimX;
      let dx = ax - px, dy = H - py;
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const rx = mx - px, ry = my - py;
      const along = rx * dx + ry * dy;         // < 0: the mallet is behind the puck
      const side = rx * -dy + ry * dx;         // lateral offset from the shot line
      if (along < -SUM * 0.6 && Math.abs(side) < SUM * 0.55) {
        tx = px + dx * 140; ty = py + dy * 140; speed = c.lv.speed * c.lv.strike;
      } else if (along > -SUM * 0.2) {
        // Beside or in front of it: go round, staying on the side it is already on.
        const sg = side >= 0 ? 1 : -1;
        tx = px - dy * sg * (SUM + 18) - dx * SUM; ty = py + dx * sg * (SUM + 18) - dy * SUM;
      } else {
        tx = px - dx * (SUM + 16); ty = py - dy * (SUM + 16);
      }
    }
  } else {
    c.attacking = false;
    speed = c.lv.guard;
    if (pvy < 0) {
      // Coming this way: go where it will cross the guard line.
      tx = crossX(px, py, c.svx, pvy, c.lv.home); ty = c.lv.home;
    } else {
      // Waiting: follow the puck across (`shade`), which leaves the far side of the goal open.
      tx = W / 2 + (px - W / 2) * c.lv.shade; ty = c.lv.home;
    }
  }

  // Speed limit: move at most `speed * dt` toward the target this frame.
  let ddx = tx - mx, ddy = ty - my;
  const dd = Math.hypot(ddx, ddy), max = speed * dt;
  if (dd > max) { ddx *= max / dd; ddy *= max / dd; }
  const nx = mx + ddx, ny = my + ddy;
  clampTarget(m, nx, c.side === 1 ? ny : H - ny);
}
