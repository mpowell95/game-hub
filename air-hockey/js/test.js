// air-hockey/js/test.js - headless engine probe. No browser: `node air-hockey/js/test.js`
// (node-only, never deployed; validate-sw-assets.mjs excludes every <game>/js/test.js).
//
// Checks, each as a number:
//   1. NO TUNNELLING: a mallet swung at full speed through a puck always HITS it (the puck never
//      ends up on the far side untouched), from every angle.
//   2. THE PUCK STAYS ON THE TABLE: across whole scripted-player-vs-CPU matches it is never outside the
//      rounded table except inside a goal slot, and nothing goes NaN.
//   3. MATCHES END: first to 7, the score adds up, both sides score.
//   3b. LEVELS IN ORDER: Easy < Medium < Hard against a scripted new player.
//   4. A FAST SWIPE IS A HARD SHOT: puck speed off a still-to-moving mallet scales with the swipe.
//   5. STUCK PUCK: a puck left still in a half moves to that player's serve spot after ~5 s.

import { TABLE, PHYS, GOAL_X0, GOAL_X1, createMatch, resetMatch, advance, clampTarget } from './physics.js';
import { createCpu, cpuThink } from './ai.js';

const { W, H, PUCK_R: PR, MALLET_R: MR, CORNER: C } = TABLE;
let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fail++;
};

// ---- 1. tunnelling -----------------------------------------------------------------------------
{
  let misses = 0, tries = 0;
  for (let ang = 0; ang < 360; ang += 7.5) {
    for (const puckSpeed of [0, 1200, PHYS.PUCK_MAX]) {
      const s = createMatch();
      const m = s.mallets[0];
      // Puck parked mid-own-half, mallet starts 150 units away on the far side of it, and is
      // yanked through the puck's position at MALLET_MAX in one frame.
      const a = ang * Math.PI / 180;
      const cx = W / 2, cy = H * 0.75;
      s.puck.x = cx; s.puck.y = cy;
      s.puck.vx = -Math.cos(a) * puckSpeed; s.puck.vy = -Math.sin(a) * puckSpeed;
      m.x = m.fx = m.tx = cx - Math.cos(a) * 150; m.y = m.fy = m.ty = cy - Math.sin(a) * 150;
      if (m.y < H / 2 + MR || m.y > H - MR || m.x < MR || m.x > W - MR) continue;
      tries++;
      clampTarget(m, cx + Math.cos(a) * 150, cy + Math.sin(a) * 150);
      s.ev.hit = 0;
      advance(s, 1 / 60);
      advance(s, 1 / 60);
      if (!s.ev.hit) misses++;
    }
  }
  ok(`full-speed mallet never passes through the puck (${tries} swings)`, misses === 0, `misses=${misses}`);
}

// ---- 2 + 3. CPU vs CPU matches -----------------------------------------------------------------
function onTable(p) {
  if (!p.live) return true;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  if (p.x < PR - 0.5 || p.x > W - PR + 0.5) return false;
  if (p.y < PR - 0.5 || p.y > H - PR + 0.5) {
    // Only allowed inside a goal mouth.
    return p.x >= GOAL_X0 + PR - 0.5 - PR && p.x <= GOAL_X1 + 0.5;
  }
  for (const [cx, cy] of [[C, C], [W - C, C], [C, H - C], [W - C, H - C]]) {
    const inX = cx === C ? p.x < C : p.x > W - C;
    const inY = cy === C ? p.y < C : p.y > H - C;
    if (inX && inY && Math.hypot(p.x - cx, p.y - cy) > C - PR + 0.5) return false;
  }
  return true;
}

// Two scripted players, driven by the same AI code with human-ish settings:
//   HUMAN - an "average player": quick hands, slow to read the puck, shoots anywhere at the goal
//           and banks a third of the time.
//   NEW   - a new player: slower hands, slower reads, wilder aim, hardly ever banks.
const HUMAN = { speed: 1800, react: 0.2, aimErr: 0.5, strike: 1.2, bank: 0.3, misread: 0.3 };
const NEW = { speed: 1300, react: 0.28, aimErr: 0.65, strike: 1.0, bank: 0.1, misread: 0.4 };

function playMatch(levelA, levelB, seed) {
  const s = createMatch();
  resetMatch(s, seed % 2);
  const a = createCpu(levelA, 0, seed * 7 + 1), b = createCpu(levelB, 1, seed * 13 + 5);
  const dt = 1 / 60;
  let t = 0, offTable = 0, goals = 0, stucks = 0, maxSpeed = 0;
  while (s.phase !== 'over' && t < 900) {
    cpuThink(s, a, dt); cpuThink(s, b, dt);
    s.ev.goal = -1; s.ev.stuck = -1;
    advance(s, dt);
    if (s.ev.goal >= 0) goals++;
    if (s.ev.stuck >= 0) stucks++;
    if (!onTable(s.puck)) offTable++;
    maxSpeed = Math.max(maxSpeed, Math.hypot(s.puck.vx, s.puck.vy));
    t += dt;
  }
  return { s, t, offTable, goals, stucks, maxSpeed };
}

{
  let off = 0, unfinished = 0, badScore = 0, winsA = 0, winsB = 0, totalT = 0, stucks = 0, maxSp = 0;
  const goals = [0, 0];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const r = playMatch(HUMAN, 'medium', i + 1);
    off += r.offTable; stucks += r.stucks; totalT += r.t; maxSp = Math.max(maxSp, r.maxSpeed);
    goals[0] += r.s.score[0]; goals[1] += r.s.score[1];
    if (r.s.phase !== 'over') unfinished++;
    else {
      if (Math.max(...r.s.score) !== PHYS.WIN || r.goals !== r.s.score[0] + r.s.score[1]) badScore++;
      if (r.s.winner === 0) winsA++; else winsB++;
    }
  }
  ok(`puck never leaves the table outside a goal slot (${N} player-vs-medium matches)`, off === 0, `frames off=${off}`);
  ok('every match reaches 7 inside 15 minutes', unfinished === 0, `unfinished=${unfinished}`);
  ok('the score always adds up', badScore === 0);
  ok('both sides score (the computer is beatable, and it scores too)', goals[0] > 0 && goals[1] > 0, `player ${goals[0]} - cpu ${goals[1]}, wins ${winsA}-${winsB}`);
  ok('puck speed never exceeds PUCK_MAX', maxSp <= PHYS.PUCK_MAX + 1e-6, `max=${maxSp.toFixed(0)}`);
  console.log(`      avg match ${(totalT / N).toFixed(0)} s, stuck-puck moves ${stucks}`);
}

// ---- 3b. the three levels are in order ---------------------------------------------------------
// Bars (2026-09-27, stage 2): a NEW player beats Easy nearly every time, Medium is a fair fight
// for them, Hard beats them; and each level concedes a smaller share of the goals than the last.
{
  const share = {}, newWins = {};
  const N = 8;
  for (const lv of ['easy', 'medium', 'hard']) {
    const g = [0, 0]; let w = 0;
    for (let i = 0; i < N; i++) {
      const r = playMatch(NEW, lv, 100 + i);
      g[0] += r.s.score[0]; g[1] += r.s.score[1]; if (r.s.winner === 0) w++;
    }
    share[lv] = g[1] / (g[0] + g[1]); newWins[lv] = w;
    console.log(`      new player vs ${lv.padEnd(6)} goals ${g[0]}-${g[1]}, new player wins ${w}/${N}`);
  }
  ok('each level scores a bigger share of the goals than the one below',
    share.easy < share.medium && share.medium < share.hard,
    ['easy', 'medium', 'hard'].map((k) => `${k} ${(share[k] * 100).toFixed(0)}%`).join(', '));
  ok('a new player beats Easy nearly every time', newWins.easy >= N - 1, `${newWins.easy}/${N}`);
  ok('Medium is a fair fight for a new player (they win some, lose some)', newWins.medium >= 2 && newWins.medium <= N - 1, `${newWins.medium}/${N}`);
  ok('Hard beats a new player', newWins.hard <= 1, `${newWins.hard}/${N}`);
}

// ---- 4. swipe speed -> shot speed --------------------------------------------------------------
{
  const shot = (swipe) => {
    const s = createMatch();
    const m = s.mallets[0];
    s.puck.x = W / 2; s.puck.y = H * 0.62; s.puck.vx = s.puck.vy = 0;
    m.x = m.fx = m.tx = W / 2; m.y = m.fy = m.ty = H * 0.62 + 140;
    const dt = 1 / 60;
    let best = 0;
    for (let i = 0; i < 30; i++) {
      clampTarget(m, W / 2, m.ty - swipe * dt); advance(s, dt);
      best = Math.max(best, Math.hypot(s.puck.vx, s.puck.vy));
    }
    return best;
  };
  const soft = shot(400), hard = shot(2400);
  ok('a fast swipe hits much harder than a slow one', hard > soft * 3, `slow=${soft.toFixed(0)} fast=${hard.toFixed(0)}`);
}

// ---- 5. stuck puck -----------------------------------------------------------------------------
{
  const s = createMatch();
  s.puck.x = 40; s.puck.y = H * 0.3; s.puck.vx = s.puck.vy = 0;   // still, in the CPU half
  s.mallets[1].x = s.mallets[1].tx = s.mallets[1].fx = W - 80;
  s.mallets[1].y = s.mallets[1].ty = s.mallets[1].fy = 80;
  let moved = -1, t = 0;
  while (t < 7) { s.ev.stuck = -1; advance(s, 1 / 60); t += 1 / 60; if (s.ev.stuck >= 0) { moved = t; break; } }
  ok('a puck sitting still for ~5 s moves to that half\'s serve spot', moved > 4.9 && moved < 5.2 && Math.abs(s.puck.x - W / 2) < 120,
    `after ${moved.toFixed(2)} s at (${s.puck.x.toFixed(0)},${s.puck.y.toFixed(0)})`);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
