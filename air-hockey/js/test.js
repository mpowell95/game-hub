// air-hockey/js/test.js - headless engine probe. No browser: `node air-hockey/js/test.js`
// (node-only, never deployed; validate-sw-assets.mjs excludes every <game>/js/test.js).
//
// Checks, each as a number:
//   1. NO TUNNELLING: a mallet swung at full speed through a puck always HITS it (the puck never
//      ends up on the far side untouched), from every angle.
//   2. THE PUCK STAYS ON THE TABLE: across whole scripted-player-vs-CPU matches it is never outside the
//      rounded table except inside a goal slot, and nothing goes NaN.
//   3. MATCHES END: first to 7, the score adds up, both sides score.
//   3b. LEVELS IN ORDER: Easy < Medium < Hard against a scripted beginner (the CHASER).
//   4. A FAST SWIPE IS A HARD SHOT: puck speed off a still-to-moving mallet scales with the swipe,
//      and the shot-speed readout keeps rising past the puck's speed cap.
//   5. STUCK PUCK: a puck left still in a half moves to that player's serve spot after ~5 s.
//   6. ONLINE (js/live.js): two sessions over a fake network with delay, jitter and overwritten
//      messages. Both phones agree on every score, no goal is counted twice, the puck is never
//      owned by both or by neither for long, the match ends at 7 on both, and a rematch works.

import { TABLE, PHYS, GOAL_X0, GOAL_X1, createMatch, resetMatch, advance, clampTarget } from './physics.js';
import { createCpu, cpuThink, rng } from './ai.js';
import { createLiveSession } from './live.js';

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

// HUMAN: a scripted "average player" on the same AI code: quick hands, slow to read the puck,
// shoots anywhere at the goal, banks a third of the time. It aims like a machine, so it is used for
// what the engine must survive (whole matches, the online protocol), not for how hard a level
// feels - that is the CHASER's job, below.
const HUMAN = { speed: 1800, react: 0.2, aimErr: 0.5, strike: 1.2, bank: 0.3, misread: 0.3 };

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
// CHASER (2026-09-28): a beginner's thumb. Sees the puck late, chases it and whacks it roughly
// upward; no aiming, no going round it. Against the stage 2 Easy it scored 1.4 goals a match and
// never won, which is what Matt reported ("haven't been able to score a single goal, even on
// easy"), so it is the yardstick the levels are held to - not the scripted players above, which
// aim like machines and made every level look beatable.
function chaser(seed, speed = 1100, react = 0.3) {
  const r = rng(seed); let clock = 9, sx = W / 2, sy = H * 0.7, jit = 0;
  return (s, dt) => {
    const m = s.mallets[0], p = s.puck;
    clock += dt; if (clock >= react) { clock = 0; sx = p.x; sy = p.y; jit = (r() * 2 - 1) * 40; }
    let tx, ty;
    if (p.live && sy > H / 2 - 20) { tx = sx + jit; ty = sy + 10; } else { tx = W / 2 + (sx - W / 2) * 0.5; ty = H - 130; }
    let dx = tx - m.x, dy = ty - m.y; const d = Math.hypot(dx, dy), mx = speed * dt;
    if (d > mx) { dx *= mx / d; dy *= mx / d; }
    clampTarget(m, m.x + dx, m.y + dy);
  };
}
{
  const share = {}, wins = {}, perMatch = {};
  const N = 10;
  for (const lv of ['easy', 'medium', 'hard', 'expert']) {
    const g = [0, 0]; let w = 0;
    for (let i = 1; i <= N; i++) {
      const s = createMatch(); resetMatch(s, i % 2);
      const a = chaser(i * 7 + 1), b = createCpu(lv, 1, i * 13 + 5);
      let t = 0;
      while (s.phase !== 'over' && t < 900) { a(s, 1 / 60); cpuThink(s, b, 1 / 60); advance(s, 1 / 60); t += 1 / 60; }
      g[0] += s.score[0]; g[1] += s.score[1]; if (s.winner === 0) w++;
    }
    share[lv] = g[1] / (g[0] + g[1]); wins[lv] = w; perMatch[lv] = g[0] / N;
    console.log(`      beginner vs ${lv.padEnd(6)} goals ${g[0]}-${g[1]}, beginner wins ${w}/${N}`);
  }
  ok('each level scores a bigger share of the goals than the one below',
    share.easy < share.medium && share.medium < share.hard && share.hard < share.expert,
    ['easy', 'medium', 'hard', 'expert'].map((k) => `${k} ${(share[k] * 100).toFixed(0)}%`).join(', '));
  ok('Expert beats a beginner every time', wins.expert === 0, `${wins.expert}/${N}`);
  ok('a beginner wins most matches on Easy', wins.easy >= 6, `${wins.easy}/${N}`);
  ok('Medium is a fair fight for a beginner (wins some, loses some)', wins.medium >= 3 && wins.medium <= 8, `${wins.medium}/${N}`);
  ok('Hard beats a beginner', wins.hard <= 1, `${wins.hard}/${N}`);
  ok('...but a beginner still scores on Hard (at least 1.5 goals a match)', perMatch.hard >= 1.5, `${perMatch.hard.toFixed(1)} a match`);
}

// ---- 4. swipe speed -> shot speed --------------------------------------------------------------
{
  const shot = (swipe) => {
    const s = createMatch();
    const m = s.mallets[0];
    s.puck.x = W / 2; s.puck.y = H * 0.62; s.puck.vx = s.puck.vy = 0;
    m.x = m.fx = m.tx = W / 2; m.y = m.fy = m.ty = H * 0.62 + 140;
    const dt = 1 / 60;
    let best = 0, read = 0;
    for (let i = 0; i < 30; i++) {
      s.ev.shot = 0;
      clampTarget(m, W / 2, m.ty - swipe * dt); advance(s, dt);
      best = Math.max(best, Math.hypot(s.puck.vx, s.puck.vy));
      if (s.ev.shotBy === 0) read = Math.max(read, s.ev.shot);
    }
    return { best, read };
  };
  const soft = shot(400).best, hard = shot(2400).best;
  ok('a fast swipe hits much harder than a slow one', hard > soft * 3, `slow=${soft.toFixed(0)} fast=${hard.toFixed(0)}`);
  // The shot-speed READOUT is taken before the speed cap, so it keeps telling hard from harder
  // after the puck itself has hit its top speed (else "fastest shot" would saturate).
  const r1 = shot(1800).read, r2 = shot(3600).read;
  ok('the shot readout still rises past the puck\'s top speed', r1 > 0 && r2 > r1 * 1.3 && r2 > PHYS.PUCK_MAX,
    `1800 swipe=${r1.toFixed(0)}, 3600 swipe=${r2.toFixed(0)}, cap ${PHYS.PUCK_MAX}`);
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

// ---- 6. online protocol over a fake network -----------------------------------------------------
// The channel is a VALUE in Firebase (each write overwrites the last), so the fake delivers each
// message after `delay` +- jitter and, when several are due at once, sometimes only the newest.
function fakeNet(delayMs, jitterMs, rand) {
  const q = [[], []];
  return {
    channel(side) {
      return { send(msg) { q[1 - side].push({ at: now + delayMs + (rand() * 2 - 1) * jitterMs, msg: JSON.parse(JSON.stringify(msg)) }); }, failed: 0, close() {} };
    },
    deliver(side, session) {
      const due = q[side].filter((e) => e.at <= now).sort((a, b) => a.msg.q - b.msg.q);
      q[side] = q[side].filter((e) => e.at > now);
      due.forEach((e, i) => { if (i === due.length - 1 || rand() > 0.3) session.onPeer(e.msg, now); });
    },
  };
}
let now = 0;
function playOnline(delayMs, seed) {
  const rand = rng(seed);
  const net = fakeNet(delayMs, delayMs * 0.3, rand);
  const m = [createMatch(), createMatch()];
  resetMatch(m[0], 0); resetMatch(m[1], 1);
  const goals = [0, 0], overs = [0, 0], rounds = [0, 0];
  const ses = [0, 1].map((side) => createLiveSession(m[side], side, net.channel(side), {
    onGoal: () => { goals[side]++; }, onOver: () => { overs[side]++; }, onRound: () => { rounds[side]++; },
  }));
  const cpu = [createCpu(HUMAN, 0, seed), createCpu(HUMAN, 0, seed + 99)];
  const dt = 1 / 60;
  let t = 0, bothOwn = 0, noneRun = 0, noneMax = 0, round2 = false, mismatch = 0;
  now = 1000;
  while (t < 2400) {
    for (let i = 0; i < 2; i++) { cpuThink(m[i], cpu[i], dt); m[i].ev.hit = 0; }
    now += dt * 1000; t += dt;
    for (let i = 0; i < 2; i++) { net.deliver(i, ses[i]); ses[i].frame(dt, now, false); }
    const o0 = ses[0].owns, o1 = ses[1].owns;
    if (o0 && o1) bothOwn++;
    if (!o0 && !o1 && m[0].phase !== 'over' && m[1].phase !== 'over') { noneRun += dt; noneMax = Math.max(noneMax, noneRun); } else noneRun = 0;
    if (m[0].phase === 'over' && m[1].phase === 'over' && (!round2 || (rounds[0] && rounds[1]))) {
      if (m[0].score[0] !== m[1].score[1] || m[0].score[1] !== m[1].score[0]) mismatch++;
      if (round2) break;
      round2 = { a: m[0].score.slice(), b: m[1].score.slice(), goals: goals.slice(), overs: overs.slice() };
      ses[0].rematch(now); ses[1].rematch(now);
    }
  }
  return { m, goals, overs, rounds, bothOwn, noneMax, round1: round2, t, mismatch, handoffs: ses[0].handoffs + ses[1].handoffs };
}
{
  for (const delay of [40, 150]) {
    let bad = 0, maxNone = 0, maxBoth = 0, twice = 0, notEnded = 0, noRematch = 0, passes = 0;
    const N = 4;
    for (let i = 0; i < N; i++) {
      const r = playOnline(delay, 500 + i);
      passes += r.handoffs;
      maxNone = Math.max(maxNone, r.noneMax); maxBoth = Math.max(maxBoth, r.bothOwn);
      const r1 = r.round1;
      if (!r1) { notEnded++; continue; }
      if (r.mismatch || r1.a[0] !== r1.b[1] || r1.a[1] !== r1.b[0]) bad++;
      if (Math.max(...r1.a) !== PHYS.WIN) bad++;
      // Each goal announced exactly once per phone.
      if (r1.goals[0] !== r1.a[0] + r1.a[1] || r1.goals[1] !== r1.b[0] + r1.b[1]) twice++;
      if (r1.overs[0] !== 1 || r1.overs[1] !== 1) twice++;
      if (r.rounds[0] !== 1 || r.rounds[1] !== 1 || r.m[0].phase !== 'over' || Math.max(...r.m[0].score) !== PHYS.WIN) noRematch++;
    }
    console.log(`      online, ${delay} ms each way: ${passes} passes in ${N} x 2 matches`);
    ok(`online ${delay} ms: both phones reach 7 and agree on every score`, bad === 0 && notEnded === 0, `bad=${bad} unfinished=${notEnded}`);
    ok(`online ${delay} ms: every goal and the match end announced exactly once per phone`, twice === 0, `problems=${twice}`);
    ok(`online ${delay} ms: the puck is never owned by both phones`, maxBoth === 0, `frames=${maxBoth}`);
    ok(`online ${delay} ms: never owned by neither for more than 1 s`, maxNone < 1, `longest ${maxNone.toFixed(2)} s`);
    ok(`online ${delay} ms: a rematch starts a fresh match that also reaches 7 on both`, noRematch === 0, `problems=${noRematch}`);
  }
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
