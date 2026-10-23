// eight-ball/js/test.js - headless checks for Pool's engine and computer. Not deployed, not precached.
//   node eight-ball/js/test.js
// Random shots in every mode (with obstacles too) stay on the table, never leave two balls
// overlapping at rest, always end; a shot replays identically; the rules of 8-ball, 9-ball and
// Cutthroat and of each option; whole computer matches finish and the stronger level wins.

import * as E from './engine.js';
import { plan, rngFrom } from './ai.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

// --- physics ------------------------------------------------------------------------------------
{
  const rnd = rngFrom(4242);
  let escaped = 0, overlaps = 0, endless = 0, inObst = 0;
  for (let n = 0; n < 1200; n++) {
    const mode = E.MODES[n % 3];
    const m = E.newMatch(mode, 1, 0, 1 + n, { obst: n % 4 === 0 });
    if (n % 2) { E.play(m, { x: E.HEAD_SPOT[0], y: E.HEAD_SPOT[1], dx: (rnd() - 0.5) * 0.2, dy: -1, p: 1 }); if (m.winner != null) continue; }
    const a = rnd() * Math.PI * 2;
    const c = m.b[0];
    const ev = E.begin(m, { ...(m.inHand ? { x: c.x, y: c.y } : {}), dx: Math.cos(a), dy: Math.sin(a), p: 0.2 + rnd() * 0.8, s: rnd() * 2 - 1 });
    if (!ev) continue;
    const steps = E.runToRest(m.b, ev, undefined, m.obs);
    E.settle(m, ev);
    if (steps >= E.maxShotSteps()) endless++;
    // Off the cloth is fine only hanging in a pocket's mouth (table 3's jaws stand off the cloth).
    const inMouth = (o) => E.POCKETS.some((p) => Math.hypot(o.x - p.cx, o.y - p.cy) < p.r + 2 * E.R);
    for (const o of m.b) if (o.on && (o.x < -0.01 || o.x > E.W + 0.01 || o.y < -0.01 || o.y > E.H + 0.01) && !inMouth(o)) { escaped++; console.log('escaped', mode, o.x, o.y); }
    for (let i = 0; i < m.b.length; i++) for (let j = i + 1; j < m.b.length; j++) {
      const p = m.b[i], q = m.b[j];
      if (p.on && q.on && Math.hypot(p.x - q.x, p.y - q.y) < 2 * E.R - 0.05) overlaps++;
    }
    for (const ob of m.obs) {
      if (ob.k !== 'can') continue;
      for (const o of m.b) if (o.on && Math.hypot(o.x - ob.x, o.y - ob.y) < E.R + ob.r - 0.05) inObst++;
    }
  }
  ok('1200 random shots, every mode: no ball leaves the table', escaped === 0, escaped);
  ok('...no two balls overlap at rest', overlaps === 0, overlaps);
  ok('...no ball rests inside an obstacle', inObst === 0, inObst);
  ok('...every shot comes to rest before the clock', endless === 0, endless);
}
{
  const shot = { x: 52, y: 165, dx: 0.013, dy: -1, p: 1, s: -0.2 };
  for (const mode of E.MODES) {
    const a = E.newMatch(mode, 1, 0, 99, { obst: true }), b = E.newMatch(mode, 1, 0, 99, { obst: true });
    E.play(a, shot); E.play(b, shot);
    ok(`${mode}: the same shot from the same table ends identically`, JSON.stringify(a) === JSON.stringify(b));
  }
}
{
  const m = E.newMatch('8', 1, 0, 7);
  ok('every pocket hole is the same size', new Set(E.POCKETS.map((p) => p.r)).size === 1);
  ok('the racks: 15 balls for 8-ball and Cutthroat, 9 for 9-ball, none overlapping',
    E.newMatch('8').b.length === 16 && E.newMatch('ct').b.length === 16 && E.newMatch('9').b.length === 10 && m.b.every((o) => o.on));
  const r9 = E.newMatch('9', 1, 0, 3).b, apex = r9.reduce((a, o, i) => (i && o.y > r9[a].y ? i : a), 1);
  ok('9-ball: the 1 is at the front of the diamond', apex === 1);
}

// --- rules ----------------------------------------------------------------------------------------
/** A table with only the listed balls on, the cue ball at (cx, cy), seat `seat` to shoot. */
const lone = (mode, on, cx, cy, extra = {}) => {
  const m = E.newMatch(mode, extra.racks || 1, 0, 5, extra.opts || {});
  for (let i = 1; i < m.b.length; i++) m.b[i].on = false;
  for (const [i, x, y] of on) { m.b[i].on = true; m.b[i].x = x; m.b[i].y = y; }
  m.b[0].x = cx; m.b[0].y = cy;
  m.broke = true; m.inHand = null; m.turn = extra.seat || 0;
  if (mode === '8') m.groups = 'groups' in extra ? extra.groups : ['a', 'b'];
  return m;
};
{
  const m = lone('8', [[5, 20, 20]], 40, 40);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('8-ball: potting your own goes again', r.kind === 'again' && !m.b[5].on && m.turn === 0, JSON.stringify(r));
}
{
  const m = lone('8', [[10, 50, 100], [3, 20, 150]], 50, 140);
  const r = E.play(m, { dx: 0, dy: -1, p: 0.4 });
  ok('8-ball: hitting the other group first is a foul, ball in hand', r.kind === 'foul' && r.foul === 'wrong' && m.turn === 1 && m.inHand === 'any', JSON.stringify(r));
}
{
  const m = lone('8', [[3, 80, 40]], 20, 160);
  const r = E.play(m, { dx: 0, dy: 1, p: 0.05 });
  ok('missing every ball is a foul', r.kind === 'foul' && r.foul === 'nohit', JSON.stringify(r));
}
{
  const m = lone('8', [[3, 60, 100]], 4, 4.5);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.3 });
  ok('potting the cue ball is a foul, and it comes back on the table', r.kind === 'foul' && r.foul === 'scratch' && m.b[0].on, JSON.stringify(r));
}
{
  const m = lone('8', [[12, 20, 20], [2, 60, 150]], 40, 40, { groups: null });
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('8-ball: the first clean pot on an open table gives that group', r.kind === 'again' && m.groups && m.groups[0] === 'b' && m.groups[1] === 'a', JSON.stringify(m.groups));
}
{
  const m = lone('8', [[8, 20, 20], [2, 60, 150]], 40, 40);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5, c: 0 });
  ok('8-ball: the 8 potted while your group is still up loses', r.kind === 'win' && m.winner === 1, JSON.stringify(r));
}
{
  const m = lone('8', [[8, 20, 20], [11, 60, 150]], 40, 40);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5, c: 0 });
  ok('8-ball: the 8 into the called pocket, your group clear, wins', r.kind === 'win' && m.winner === 0, JSON.stringify(r));
}
{
  const m = lone('8', [[8, 20, 20], [11, 60, 150]], 40, 40);
  ok('8-ball: the 8 must be called', E.needCall(m, 0));
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5, c: 1 });
  ok('...into another pocket than the one called, it loses', r.kind === 'win' && m.winner === 1, JSON.stringify(r));
}
{
  const m = lone('8', [[8, 20, 20]], 40, 40, { racks: 2 });
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5, c: 0 });
  ok('first to 2: winning a rack is a rack, not the match', r.kind === 'rack' && m.scores[0] === 1 && m.winner == null, JSON.stringify(r));
  E.nextRack(m);
  ok('...the next rack is racked and the break passes', m.breaker === 1 && m.turn === 1 && m.b.every((o) => o.on) && !m.groups && m.inHand === 'kitchen');
}
{
  const m = lone('8', [[5, 20, 20], [2, 60, 150]], 40, 40, { opts: { call: true } });
  ok('call shots: every shot must be called', E.needCall(m, 0));
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5, c: 3 });
  ok('...a pot into another pocket stays down but ends the turn', r.kind === 'turn' && !m.b[5].on && m.turn === 1, JSON.stringify(r));
}
{
  const m = lone('8', [[5, 20, 20], [2, 60, 150]], 40, 40, { opts: { bank: true } });
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('banks only: a straight pot does not count', r.kind === 'turn' && !m.b[5].on && m.turn === 1, JSON.stringify(r));
  const m2 = lone('8', [[5, 50, 12], [2, 60, 150]], 50, 60, { opts: { bank: true } });
  // The 5 sent into the top cushion and back down the table: it bounced, so a pot would count.
  const ev = E.begin(m2, { dx: 0, dy: -1, p: 0.7 });
  E.runToRest(m2.b, ev, undefined, m2.obs);
  ok('...a ball that bounced off a cushion is marked as banked', ev.kiss[5] === true);
}
{
  const m = lone('9', [[1, 80, 100], [9, 20, 20]], 40, 40);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('9-ball: hitting the 9 before the lowest ball is a foul, and the 9 comes back', r.kind === 'foul' && m.b[9].on && Math.abs(m.b[9].x - E.W / 2) < 0.01, JSON.stringify(r));
}
{
  const m = lone('9', [[9, 20, 20]], 40, 40);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('9-ball: potting the 9 cleanly wins', r.kind === 'win' && m.winner === 0, JSON.stringify(r));
}
{
  const m = lone('9', [[3, 20, 20], [4, 70, 150]], 40, 40);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('9-ball: potting the lowest goes again', r.kind === 'again' && m.turn === 0, JSON.stringify(r));
}
{
  // Cutthroat: seat 0 owns 1-5. It pots the 7 (seat 1's): goes again.
  const m = lone('ct', [[7, 20, 20], [1, 70, 150], [12, 80, 60]], 40, 40);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('Cutthroat: potting someone else’s goes again', r.kind === 'again' && m.turn === 0, JSON.stringify(r));
  ok('...and that player is out (their last ball)', m.out[1] === true && !m.out[2], JSON.stringify(m.out));
}
{
  const m = lone('ct', [[2, 20, 20], [1, 70, 150], [7, 80, 60], [12, 80, 100]], 40, 40);
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('Cutthroat: potting your own ends the turn', r.kind === 'turn' && m.turn === 1 && !m.b[2].on, JSON.stringify(r));
}
{
  const m = lone('ct', [[1, 70, 150], [12, 80, 100]], 4, 4.5);
  m.b[7].on = false; m.b[9].on = false;       // seat 1 has nothing on; down: 6-10
  const r = E.play(m, { dx: -1, dy: -1, p: 0.3 });
  ok('Cutthroat: a foul puts one of each other player’s balls back', r.kind === 'foul' && m.b[6].on && m.b[11].on, JSON.stringify(r));
}
{
  const m = lone('ct', [[12, 20, 20], [1, 70, 150]], 40, 40);
  m.out[1] = true;
  const r = E.play(m, { dx: -1, dy: -1, p: 0.5 });
  ok('Cutthroat: the last player still in wins', r.kind === 'win' && m.winner === 0, JSON.stringify(r));
}
{
  const m = E.newMatch('8', 1, 0, 7);
  ok('the cue ball goes anywhere in the kitchen, not above the head string, never on a ball',
    E.canPlace(m, 30, 170, true) && !E.canPlace(m, 30, 100, true) && E.canPlace(m, 30, 100, false) && !E.canPlace(m, m.b[1].x, m.b[1].y + 1, false));
  ok('a shot placed somewhere illegal is refused', E.begin(m, { x: 30, y: 100, dx: 0, dy: -1, p: 0.5 }) === null);
  const o = E.newMatch('8', 1, 0, 7, { obst: true });
  ok('obstacles: three, one a spill, none on the rack or the head spot', o.obs.length === 3 && o.obs.some((x) => x.k === 'spill')
    && o.obs.every((x) => Math.hypot(x.x - 50, x.y - (E.FOOT_Y - 10)) >= 26 && Math.hypot(x.x - E.HEAD_SPOT[0], x.y - E.HEAD_SPOT[1]) >= 15));
  const solid = o.obs.find((x) => x.k !== 'spill');
  ok('...the cue ball cannot be put on one', !E.canPlace(o, solid.x, solid.y, false));
}

// --- the computer -------------------------------------------------------------------------------
function match(mode, diffs, seed, opts) {
  const m = E.newMatch(mode, 1, seed % E.seatsOf(mode), 1000 + seed, opts);
  const rng = rngFrom(77 + seed);
  while (m.winner == null && m.shots < 400) {
    const r = E.play(m, plan(m, m.turn, diffs[m.turn], rng));
    if (!r) return null;
    if (r.kind === 'rack') E.nextRack(m);
  }
  return m;
}
for (const [mode, diffs, opts] of [['8', ['hard', 'easy'], {}], ['9', ['hard', 'easy'], {}], ['ct', ['hard', 'easy', 'easy'], {}], ['8', ['medium', 'medium'], { call: true, bank: true, obst: true }]]) {
  // 8 games each: 9-ball on GamePigeon's pockets (table 5) is luckier (the 9 on a combo), so 5 was
  // too few to tell the levels apart (2026-10-23: Hard 5 of 8 there, 8 of 8 everywhere else).
  let finished = 0, strongWins = 0;
  for (let g = 0; g < 8; g++) {
    const m = match(mode, diffs, g, opts);
    if (m && m.winner != null) { finished++; if (m.winner === 0) strongWins++; }
  }
  const label = `${mode}${Object.keys(opts).length ? ' with every option' : ''}`;
  ok(`computer ${label}: every match finishes`, finished === 8, finished);
  if (diffs[0] === 'hard') ok(`...and Hard wins most of them`, strongWins >= 5, strongWins);
}

// --- table versions (engine.js, TABLE VERSIONS) ------------------------------------------------------
{
  // A match started on table 1 replays exactly as the table-1 engine played it (the fingerprint was
  // taken from the engine before table 2 existed, commit 77835e6), whatever ran on table 2 between.
  const m = E.newMatch('8', 1, 0, 77, { obst: true }, 1, 1);
  let s = 99;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let k = 0; k < 30 && m.winner == null; k++) {
    E.newMatch('9', 1, 0, k + 1, {}, 2);
    const dx = rnd() * 2 - 1, dy = rnd() * 2 - 1, l = Math.sqrt(dx * dx + dy * dy);
    const shot = { dx: Math.round(dx / l * 1e6) / 1e6, dy: Math.round(dy / l * 1e6) / 1e6, p: Math.round(rnd() * 1e4) / 1e4, s: 0, c: 0 };
    if (m.inHand) { const p = E.nearestPlace(m, 50, 170, m.inHand === 'kitchen'); shot.x = p.x; shot.y = p.y; }
    const r = E.play(m, shot); if (r && r.kind === 'rack') E.nextRack(m);
  }
  const str = JSON.stringify(m.b.map((o) => [o.x, o.y, o.on])) + m.turn + m.scores;
  let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  ok('a table-1 match replays bit for bit as before table 2', h === 1534097046, h);
  {
    // ...and table 2 as it played before table 3 (fingerprint from commit cc2abe2).
    const m2 = E.newMatch('8', 1, 0, 77, { obst: true }, 2, 1);
    let s2 = 99;
    const rnd2 = () => (s2 = (Math.imul(s2, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let k = 0; k < 30 && m2.winner == null; k++) {
      E.newMatch('9', 1, 0, k + 1, {}, 3);
      const dx = rnd2() * 2 - 1, dy = rnd2() * 2 - 1, l = Math.sqrt(dx * dx + dy * dy);
      const shot = { dx: Math.round(dx / l * 1e6) / 1e6, dy: Math.round(dy / l * 1e6) / 1e6, p: Math.round(rnd2() * 1e4) / 1e4, s: 0, c: 0 };
      if (m2.inHand) { const p = E.nearestPlace(m2, 50, 170, m2.inHand === 'kitchen'); shot.x = p.x; shot.y = p.y; }
      const r = E.play(m2, shot); if (r && r.kind === 'rack') E.nextRack(m2);
    }
    const str2 = JSON.stringify(m2.b.map((o) => [o.x, o.y, o.on])) + m2.turn + m2.scores;
    let h2 = 2166136261; for (let i = 0; i < str2.length; i++) h2 = Math.imul(h2 ^ str2.charCodeAt(i), 16777619) >>> 0;
    ok('a table-2 match replays bit for bit as before table 3', h2 === 4190022641, h2);
  }
  {
    // ...and table 3 as it played before table 4 (fingerprint from commit 262f42c).
    const m3 = E.newMatch('8', 1, 0, 77, { obst: true }, 3, 1);
    let s3 = 99;
    const rnd3 = () => (s3 = (Math.imul(s3, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let k = 0; k < 30 && m3.winner == null; k++) {
      const dx = rnd3() * 2 - 1, dy = rnd3() * 2 - 1, l = Math.sqrt(dx * dx + dy * dy);
      const shot = { dx: Math.round(dx / l * 1e6) / 1e6, dy: Math.round(dy / l * 1e6) / 1e6, p: Math.round(rnd3() * 1e4) / 1e4, s: 0, c: 0 };
      if (m3.inHand) { const p = E.nearestPlace(m3, 50, 170, m3.inHand === 'kitchen'); shot.x = p.x; shot.y = p.y; }
      const r = E.play(m3, shot); if (r && r.kind === 'rack') E.nextRack(m3);
    }
    const str3 = JSON.stringify(m3.b.map((o) => [o.x, o.y, o.on])) + m3.turn + m3.scores;
    let h3 = 2166136261; for (let i = 0; i < str3.length; i++) h3 = Math.imul(h3 ^ str3.charCodeAt(i), 16777619) >>> 0;
    ok('a table-3 match replays bit for bit as before table 4', h3 === 207941596, h3);
  }
  {
    // ...and table 4 as it played before table 5 (fingerprint from commit bafc0f4).
    const m4 = E.newMatch('8', 1, 0, 77, { obst: true }, 4, 1);
    let s4 = 99;
    const rnd4 = () => (s4 = (Math.imul(s4, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let k = 0; k < 30 && m4.winner == null; k++) {
      const dx = rnd4() * 2 - 1, dy = rnd4() * 2 - 1, l = Math.sqrt(dx * dx + dy * dy);
      const shot = { dx: Math.round(dx / l * 1e6) / 1e6, dy: Math.round(dy / l * 1e6) / 1e6, p: Math.round(rnd4() * 1e4) / 1e4, s: 0, c: 0 };
      if (m4.inHand) { const p = E.nearestPlace(m4, 50, 170, m4.inHand === 'kitchen'); shot.x = p.x; shot.y = p.y; }
      const r = E.play(m4, shot); if (r && r.kind === 'rack') E.nextRack(m4);
    }
    const str4 = JSON.stringify(m4.b.map((o) => [o.x, o.y, o.on])) + m4.turn + m4.scores;
    let h4 = 2166136261; for (let i = 0; i < str4.length; i++) h4 = Math.imul(h4 ^ str4.charCodeAt(i), 16777619) >>> 0;
    ok('a table-4 match replays bit for bit as before table 5', h4 === 775933696, h4);
  }
  E.useTable(5);
  ok('table 5: table 4\'s balls, GamePigeon\'s pockets (84 px of 717)', Math.abs(E.R * 2 - 1.25 * 42 * 100 / 717) < 1e-9 && E.POCKETS.every((p) => p.rp === p.r && Math.abs(p.r * 2 - 84 * 100 / 717) < 1e-9));
  {
    // Rules 2 (2026-10-23): a soft touch that pots nothing and reaches no cushion is not a foul;
    // rules 1 (every match from before) still calls it one. A match with no `rv` is rules 1.
    const soft = (rv) => {
      const m = E.newMatch('8', 1, 0, 5, {}, 5, rv);
      E.play(m, { x: E.HEAD_SPOT[0], y: E.HEAD_SPOT[1], dx: 0, dy: -1, p: 1 });
      for (let i = 1; i < m.b.length; i++) m.b[i].on = false;
      m.b[1].on = true; m.b[1].x = 50; m.b[1].y = 100; m.b[0].x = 50; m.b[0].y = 112;
      m.inHand = null; m.groups = null; m.broke = true;
      E.play(m, { dx: 0, dy: -1, p: 0.2, s: 0 });
      return m.last && m.last.foul;
    };
    ok('rules 2: a soft touch with no cushion is not a foul; rules 1 still calls it', soft(2) == null && soft(1) === 'norail', soft(2) + '/' + soft(1));
    ok('a new match is on today\'s rules; one with none is rules 1', E.newMatch('8').rv === E.RULES_NOW && E.RULES_NOW === 2 && E.validMatch({ ...E.newMatch('8', 1, 0, 3, {}, 5, 1), rv: undefined }));
  }
  ok('a new match is on today\'s table', E.newMatch('8').tb === E.TABLE_NOW && E.TABLE_NOW === 5);
  ok('a saved match with no table reads as table 1', E.tableOf({}) === 1 && E.validMatch({ ...E.newMatch('8', 1, 0, 3, {}, 1), tb: undefined }));
  E.useTable(2);
  ok('table 2 is kept as it was: a ball of 41 px on 717 px of cloth', Math.abs(E.R * 2 - 41 * 100 / 717) < 1e-9);
  E.useTable(3);
  E.useTable(4);
  ok('table 4: balls 25% bigger than GamePigeon\'s, holes still 2 balls, drop only over the black', Math.abs(E.R * 2 - 1.25 * 42 * 100 / 717) < 1e-9 && E.POCKETS.every((p) => p.rp === p.r && Math.abs(p.r - 2 * E.R) < 1e-9));
  E.useTable(3);
  ok('table 3: a ball of 42 px, holes of 84 px, a ball drops only over the black', Math.abs(E.R * 2 - 42 * 100 / 717) < 1e-9 && E.POCKETS.every((p) => p.rp === p.r && Math.abs(p.r - 2 * E.R) < 1e-9));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
