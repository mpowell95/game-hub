// tools/test-trip-action.mjs - the action and sports games' own trip wires (js/trip-wires/<game>.js, 2026-11-25):
// snake, ballrun, tower, brickblitz, hillclimb, skeeball, golf, archery, airhockey, flicksoccer, eightball, cuppong,
// darts, shoveoff. Pure, no network, no server.
//   node tools/test-trip-action.mjs                                    unit cases: every rule passes a real-looking play
//                                                                      and fires on a made-up impossible one
//   node tools/test-trip-action.mjs --db <playLog.json> [--input <playInput.json>]
//                                                                      replay every rule over the real plays (read only)
import fs from 'node:fs';
import { TRIP_GAMES, runTripWires } from '../js/trip-wires/index.js';
import { Sim, RunLog } from '../ball-run/js/sim.js';
import { Game as SnakeGame } from '../snake/js/game.js';
import * as TW from '../tower/js/engine.js';
import * as AR from '../archery/js/engine.js';
import * as DT from '../darts/js/engine.js';

const GAMES = ['snake', 'ballrun', 'tower', 'brickblitz', 'hillclimb', 'skeeball', 'golf', 'archery', 'airhockey', 'flicksoccer', 'eightball', 'cuppong', 'darts', 'shoveoff'];
let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fail++; };
const J = JSON.stringify;
const hits = (e, n = null) => runTripWires(e, n);
const fires = (e, rule, n = null) => hits(e, n).some((h) => h.rule === rule);
const passes = (e, rule, n = null) => !fires(e, rule, n);
/** A touch log in play-log-queue.js's format from [[ms, kind, data]]. */
const touchLog = (evs, extra = {}) => {
  let last = 0;
  return J({ v: 1, t0: 1, w: 400, h: 800, pt: 'touch', ...extra, ev: evs.map(([t, k, d = '10,10']) => { const s = `${t - last}${k}${d}`; last = t; return s; }).join(' ') });
};

// --- every game in this group has at least 3 rules, a mix of proven and suspicious, each with text and a unique id
const ids = new Set();
for (const g of GAMES) {
  const rules = TRIP_GAMES[g] || [];
  ok(`${g}: at least 3 rules`, rules.length >= 3);
  ok(`${g}: a proven rule and every rule well formed`, rules.some((r) => r.proven === true)
    && rules.every((r) => typeof r.id === 'string' && r.id.startsWith(g === 'brickblitz' ? 'brick' : g === 'eightball' ? 'pool' : g === 'shoveoff' ? 'knockout' : g === 'flicksoccer' ? 'flick' : g === 'airhockey' ? 'airhockey' : g) && typeof r.text === 'string' && r.text && typeof r.check === 'function' && typeof r.proven === 'boolean'));
  for (const r of rules) { ok(`unique id ${r.id}`, !ids.has(r.id)); ids.add(r.id); }
  ok(`${g}: every rule returns null on an empty entry`, hits({ g, f: 'recordX' }).length === 0);
}

// ================= SNAKE (a real engine run, then tampered copies)
{
  const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const g = new SnakeGame('hard', rng, true);
  // a greedy player: head for the food, one press per change of direction
  const inp = []; let ms = 0;
  for (let k = 0; k < 3000 && !g.over; k++) {
    const h = g.body[0], f = g.food;
    const want = f.x !== h.x ? (f.x > h.x ? 'right' : 'left') : (f.y > h.y ? 'down' : 'up');
    if (want !== g.dir) { const acc = g.setDirection(want); inp.push(`${ms}p${want[0]}${acc ? '' : 'x'}`); if (!acc) { const w2 = f.y > h.y ? 'down' : 'up'; inp.push(`${ms}p${w2[0]}${g.setDirection(w2) ? '' : 'x'}`); } }
    g.step(); ms += 85 + (k % 7);
  }
  const x = { ...g.privateLog(), ms, diff: 'hard', inp: inp.join(' ') };
  const e = (xx, len = g.length) => ({ g: 'snake', f: 'recordSnake', a: J([len, 'hard', 'off']), x: J(xx) });
  const real = e(x);
  ok('snake: a real engine run (a greedy bot) passes every PROVEN rule', hits(real).every((h) => !h.proven));
  ok('snake: the greedy bot is too direct (suspicious)', g.eats.length < 30 || fires(real, 'snake-route-too-direct'));
  ok('snake: the greedy bot over 40 foods IS shortest every time (suspicious)', g.eats.length < 40 || fires(real, 'snake-always-shortest'));
  ok('snake: length above the food eaten is PROVEN', fires(e(x, g.length + 5), 'snake-length-not-food'));
  ok('snake: a food eaten too soon is PROVEN', fires(e({ ...x, eats: x.eats.map((t, k) => (k === 3 ? x.eats[2] + 1 : t)) }), 'snake-food-too-close'));
  ok('snake: ticks faster than the clock is PROVEN', fires(e({ ...x, ms: Math.round(x.ticks * 85 / 3) }), 'snake-faster-than-clock'));
  ok('snake: turns without presses is PROVEN', fires(e({ ...x, inp: '' }), 'snake-turns-without-press'));
  ok('snake: an old play (no eats, no inp) is not judged by the new rules', passes(e({ ...x, eats: undefined, inp: undefined }), 'snake-food-too-close') && passes(e({ ...x, eats: undefined, inp: undefined }), 'snake-turns-without-press'));
}

// ================= BALL RUN (a real sim run with the run log, then tampered copies)
function ballRun(map, steer = (k) => (Math.sin(k / 23) > 0.3 ? 0.012 : Math.sin(k / 23) < -0.3 ? -0.012 : 0), key = () => 0) {
  const sim = new Sim(map, 'easy', 4242); const L = new RunLog(); let now = 0;
  for (let k = 0; k < 60 * 120 && !sim.isOver(); k++) {
    sim.invincibleUntil = 1e9;       // test only: survive, so the run scores
    const d = steer(k), kk = d ? 0 : key(k);
    L.before(sim, d, kk, now); sim.step(d, kk); L.after(sim);
    now += 1000 / 60 + ((k * 7919) % 5);
  }
  return { sim, x: { v: 2, map, diff: 'easy', score: sim.score, obst: sim.stats.obst, splits: sim.stats.splits, jumps: sim.stats.jumps, orbs: sim.orbsCollected, ms: Math.floor(sim.elapsed * 1000), ...L.out() } };
}
{
  const human = (k) => { const p = Math.sin(k / 17) + 0.6 * Math.sin(k / 7.3); return p > 0.5 ? 0.01 : p < -0.5 ? -0.01 : 0; };
  for (const map of ['classic', 'orbital']) {
    const { sim, x } = ballRun(map, human);
    const e = (xx, sc = sim.score) => ({ g: 'ballrun', f: 'recordBallRun', a: J([sc, 'easy', map]), x: J(xx) });
    const tl = touchLog([[0, 'd'], [50, 'm'], [100, 'm'], [120000, 'u']]);
    ok(`ball run ${map}: a run with real touches passes every rule (score ${sim.score})`, hits(e(x), tl).length === 0);
    ok(`ball run ${map}: x stays under 20,000 characters`, J(x).length < 20000);
    ok(`ball run ${map}: a score above what the run scored is PROVEN`, fires(e(x, sim.score + 30), 'ballrun-score-not-earned'));
    ok(`ball run ${map}: finger steering with no touch at all is PROVEN`, fires(e(x), 'ballrun-touch-steer-without-touch', touchLog([[0, 'k', 'Enter']])));
    ok(`ball run ${map}: a sim run faster than the clock is PROVEN`, fires(e({ ...x, wallMs: Math.round(x.wallMs / 4) }), 'ballrun-faster-than-clock'));
  }
  const keys = ballRun('classic', () => 0, (k) => (Math.floor(k / 30) % 2 ? 1 : -1));
  const ek = { g: 'ballrun', f: 'recordBallRun', a: J([keys.sim.score, 'easy', 'classic']), x: J(keys.x) };
  ok('ball run: arrow-key steering with no key press is PROVEN', fires(ek, 'ballrun-key-steer-without-keys', touchLog([[0, 'd'], [10, 'u']])));
  ok('ball run: arrow-key steering with key presses passes', passes(ek, 'ballrun-key-steer-without-keys', touchLog([[0, 'k', 'ArrowLeft'], [10, 'k', 'ArrowRight']])));
  ok('ball run: a metronome steer (every change the same gap) is suspicious', fires(ek, 'ballrun-steer-like-clockwork'));
  const h = ballRun('classic', (k) => { const p = Math.sin(k / 17) + 0.6 * Math.sin(k / 7.3); return p > 0.5 ? 0.01 : p < -0.5 ? -0.01 : 0; });
  ok('ball run: an irregular steer is not clockwork', passes({ g: 'ballrun', f: 'recordBallRun', a: J([h.sim.score, 'easy', 'classic']), x: J(h.x) }, 'ballrun-steer-like-clockwork'));
  ok('ball run: an old play (x = {hi}) is not judged', hits({ g: 'ballrun', f: 'recordBallRun', a: '[70,"hard","classic"]', x: '{"hi":70}' }).length === 0);
  ok('ball run: the admin Classic-equivalent score (eq) is not compared', passes({ g: 'ballrun', f: 'recordBallRun', a: J([999, 'hard', 'orbital']), x: J({ ...h.x, eq: 1 }) }, 'ballrun-score-not-earned'));
}

// More games' cases are appended below.
// A seeded random number for the cases below.
const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
const downs = (k) => touchLog(Array.from({ length: k }, (_, i) => [i * 400, 'd']));

// ================= TOWER STACK (a real engine run on a simulated clock)
{
  const rnd = seeded(11), run = TW.createRun('medium');
  let T = 0;
  while (!run.over && run.stack.length < 40) {
    // a player: wait for the block to come over the stack, tap a little early or late
    const top = run.stack[run.stack.length - 1], aim = top.x + (rnd() - 0.5) * 14;
    let w = 0, prev = run.mover.x;
    for (; w < 8000; w += 16) { TW.stepMover(run, 0.016); const now = run.mover.x; if ((prev - aim) * (now - aim) <= 0) break; prev = now; }
    w += 16; TW.stepMover(run, 0.016);
    T += w; run.t0 = Date.now() - T;
    TW.drop(run);
  }
  const x = { hi: TW.score(run), drops: run.log, perfects: run.perfects };
  const e = (xx) => ({ g: 'tower', f: 'recordTower', a: J([TW.score(run), 'medium', {}]), m: 'look=city@medium', x: J(xx) });
  ok(`tower: a real engine run passes every rule (${run.log.length} drops)`, hits(e(x)).length === 0);
  const d = run.log.map((q) => q.slice());
  ok('tower: a block wider than the one below is PROVEN', fires(e({ ...x, drops: d.map((q, k) => (k === 3 ? [q[0], q[1], q[2] + 30, q[3]] : q)) }), 'tower-width-grew'));
  const c = d.findIndex((q) => q[1] === 'c');
  ok('tower: a cut that kept more than its overlap is PROVEN', c < 0 || fires(e({ ...x, drops: d.map((q, k) => (k === c ? [q[0], q[1], q[2] + 5, q[3]] : q)) }), 'tower-cut-not-offset'));
  ok('tower: a Perfect far off centre is PROVEN', fires(e({ ...x, drops: d.map((q, k) => (k === 0 ? [20, 'p', 250, q[3]] : q)) }), 'tower-cut-not-offset'));
  ok('tower: drops faster than the block slides is PROVEN', fires(e({ ...x, drops: d.map((q, k) => [q[0], q[1], q[2], k * 40]) }), 'tower-drop-before-arrival'));
}

// ================= BRICK BREAKER
{
  const x = { diff: 'medium', endless: false, lives: 0, ufo: [[500, 1, 40]], lost: [[1, 30, 900], [2, 80, 4000], [2, 95, 4300]], clr: [[1, 60, 2, 2600]], bricks: 40, combo: 6, bp: 5000, go: [[0, 'p'], [31, 'p'], [61, 'p'], [81, 'p'], [85, 'm']], ph: 90 };
  const sc = 5000 + 500 + 2 * 500;
  const e = (xx, s = sc) => ({ g: 'brickblitz', f: 'recordBrickBlitz', a: J([s, 'medium', {}]), x: J(xx) });
  ok('brick: a run whose numbers add up passes', hits(e(x), downs(10)).length === 0);
  ok('brick: a score the bricks did not earn is PROVEN', fires(e(x, sc + 100), 'brick-score-not-earned'));
  ok('brick: an older run (no bp) over every brick at the best price is PROVEN', fires(e({ ...x, bp: undefined, go: undefined }, 40 * 2170 + 2000), 'brick-score-not-earned'));
  ok('brick: an older run under that bound passes', passes(e({ ...x, bp: undefined, go: undefined }, 20000), 'brick-score-not-earned'));
  ok('brick: launches without presses is PROVEN', fires(e(x), 'brick-launch-without-press', downs(2)));
  ok('brick: a saucer worth 700 is PROVEN', fires(e({ ...x, ufo: [[700, 1, 4]] }, 5000 + 700 + 1000), 'brick-saucer-value'));
  ok('brick: four balls lost on 3 lives is PROVEN', fires(e({ ...x, lost: [...x.lost, [3, 99, 5000]] }), 'brick-more-balls-lost-than-lives'));
  ok('brick: 400 returns and no ball lost is suspicious', fires(e({ ...x, ph: 450, lost: [] }), 'brick-never-drops-a-ball'));
}

// ================= HILL CLIMB
{
  const x = { reason: 'crash', secs: 120, fuelLeft: 30, maxFuel: 100, nitroLeft: 1, boosts: 3, cans: 4, coinPicks: 40, coins: 2000, flips: 2, dist: 900, ped: '0g 3000 400b 2000 500g 8000 700g', pedN: 7, nit: [5000, 30000, 60000], thSteps: 9000 };
  const e = (xx) => ({ g: 'hillclimb', f: 'recordHillClimb', a: J([xx.dist, 'countryside', { coins: xx.coins, flips: xx.flips }]), x: J(xx) });
  ok('hill climb: a real-looking run passes', hits(e(x), downs(10)).length === 0);
  ok('hill climb: coins above every coin a 100 is PROVEN', fires(e({ ...x, coins: 40 * 100 + 100 + 1 }), 'hillclimb-coins-not-earned'));
  ok('hill climb: coins below every coin a 5 is PROVEN', fires(e({ ...x, coins: 100 }), 'hillclimb-coins-not-earned'));
  ok('hill climb: more nitro than started + cans is PROVEN', fires(e({ ...x, boosts: 9 }), 'hillclimb-nitro-from-nowhere'));
  ok('hill climb: pedal presses without touches is PROVEN', fires(e(x), 'hillclimb-pedal-without-press', downs(2)));
  const tick = Array.from({ length: 100 }, (_, k) => (k % 2 ? '300g' : '300' + '0')).join(' ');
  ok('hill climb: clockwork pedal presses are suspicious', fires(e({ ...x, ped: tick }), 'hillclimb-pedal-like-clockwork'));
  ok('hill climb: an old run (no ped) is not judged by the pedal rules', passes(e({ ...x, ped: undefined }), 'hillclimb-pedal-without-press', downs(0)));
}

// ================= SKEEBALL
{
  const sw = Array.from({ length: 9 }, (_, k) => [0.6 + k * 0.03, k * 0.01, k * 2]);
  const th = [[10, 'c10'], [20, 'c20'], [30, 'c30'], [40, 'c40'], [50, 'c50'], [10, 'c10'], [0, 'g'], [20, 'c20'], [100, 'h100']];
  const total = th.reduce((s, q) => s + q[0], 0);
  const x = { swipes: sw, throws: th, score: total, balls: 9, thrown: 9 };
  const e = (xx, s = total) => ({ g: 'skeeball', f: 'recordSkeeball', a: J(['classic', { score: s, balls: 9 }]), x: J(xx) });
  ok('skeeball: a real-looking rack passes', hits(e(x), downs(9)).length === 0);
  ok('skeeball: a score above its balls is PROVEN', fires(e({ ...x, score: total + 50 }, total + 50), 'skeeball-score-not-throws'));
  ok('skeeball: more balls scored than thrown is PROVEN', fires(e({ ...x, swipes: sw.slice(0, 7) }), 'skeeball-ball-without-throw'));
  ok('skeeball: throws without touches is PROVEN', fires(e(x), 'skeeball-throw-without-touch', downs(3)));
  ok('skeeball: the same swipe six times is suspicious', fires(e({ ...x, swipes: sw.map((s, k) => (k < 6 ? [0.8, 0.9, k] : s)) }), 'skeeball-same-swipe'));
}

// ================= GOLF
{
  const shot = (k, club, pos, flags = '') => [k, club, 'fairway', 0, 0.9, pos, 0, 1, 0, 0, 10, 100, 150, flags, 0, k * 8];
  const x = { v: 1, end: 'end', n: 1, par: 4, strokes: 5, pickedUp: false, shots: [shot(1, 'driver', 0.04), shot(2, '7i', -0.02), shot(3, 'pw', 0.06), shot(4, 'P', 0.01), shot(5, 'P', 0.0, 'h')] };
  const e = (xx) => ({ g: 'golf', f: 'recordGolf', a: J(['pinevalley', { holeOnly: true, holeScores: { 'pinevalley:1': xx.strokes } }]), x: J(xx) });
  ok('golf: a real-looking hole passes', hits(e(x), downs(15)).length === 0);
  ok('golf: fewer strokes than swings is PROVEN', fires(e({ ...x, strokes: 3 }), 'golf-fewer-strokes-than-swings'));
  ok('golf: over double par plus one is PROVEN', fires(e({ ...x, strokes: 10 }), 'golf-over-the-cap'));
  ok('golf: swings without touches is PROVEN', fires(e(x), 'golf-swing-without-touch', downs(2)));
  const round = { v: 1, scores: [4, 3, 5], holes: [[1, 4, 0, 4, 0, 2, 0], [2, 3, 0, 3, 0, 1, 0], [3, 5, 0, 5, 0, 2, 0]] };
  const er = (s) => ({ g: 'golf', f: 'recordGolf', a: J(['pinevalley', { courseId: 'pinevalley3', holes: 3, strokes: s }]), x: J(round) });
  ok('golf: a round that adds up passes', hits(er(12)).length === 0);
  ok('golf: a round total its holes do not give is PROVEN', fires(er(9), 'golf-round-not-its-holes'));
  const perfect = { ...x, strokes: 10, shots: Array.from({ length: 9 }, (_, k) => shot(k + 1, 'driver', 0.001)) };
  ok('golf: nine swings dead on the line is suspicious', fires(e({ ...perfect, par: 5, strokes: 9 }), 'golf-needle-dead-centre'));
}

// ================= ARCHERY (a real engine match vs the computer)
{
  const rnd = seeded(5), m = AR.newMatch(12345, 0);
  while (m.winner == null) { const p = AR.cpuShot(m, m.turn === 0 ? 'medium' : 'easy', rnd); AR.shoot(m, p.x, p.y); }
  const arrows = AR.shotOrder(m).map((q) => [q.seat, q.x, q.y, q.s, q.st]);
  const x = { v: 1, end: 'end', mode: 'cpu', diff: 'easy', seed: 12345, winner: m.winner, arrows };
  const e = (xx, won = m.winner === 0) => ({ g: 'archery', f: 'recordResult', a: J(['archery', 'easy', won]), x: J(xx) });
  ok('archery: a real engine match passes every rule', hits(e(x), downs(40)).length === 0);
  const k = arrows.findIndex((q) => q[3] < 10);
  ok('archery: an arrow scored above where it hit is PROVEN', fires(e({ ...x, arrows: arrows.map((q, i) => (i === k ? [q[0], q[1], q[2], 10, q[4]] : q)) }), 'archery-score-not-where-it-hit'));
  ok('archery: a fourth arrow in a round is PROVEN', fires(e({ ...x, arrows: [arrows[0], ...arrows] }), 'archery-match-not-its-arrows'));
  const t = [0, 1].map((s) => arrows.filter((q) => q[0] === s && q[4] < 3).reduce((n, q) => n + q[3], 0));
  ok('archery: a win the totals give to the computer is PROVEN', t[0] === t[1] || fires(e(x, !(t[0] > t[1])), 'archery-match-not-its-arrows'));
  ok('archery: arrows without touches is PROVEN', fires(e(x), 'archery-arrows-without-touch', downs(2)));
  ok('archery: nine 10s is suspicious', fires(e({ ...x, arrows: arrows.map((q) => (q[0] === 0 ? [0, 0, 0, 10, q[4]] : q)) }), 'archery-every-arrow-a-ten'));
}

// ================= AIR HOCKEY
{
  const x = { goals: [[0, 4], [1, 9.5], [0, 17], [0, 30], [0, 41], [0, 50], [0, 66], [0, 80]], secs: 80, myBest: 6000, shots: 100, cont: 0 };
  const e = (xx, gf = 7, ga = 1, shot = 6000) => ({ g: 'airhockey', f: 'recordAirHockey', m: 'to=7@medium', a: J(['medium', true, { goalsFor: gf, goalsAgainst: ga, shot }]), x: J(xx) });
  ok('air hockey: a real-looking match passes', hits(e(x)).length === 0);
  ok('air hockey: a score its goals do not give is PROVEN', fires(e(x, 7, 0), 'airhockey-goals-not-logged'));
  ok('air hockey: a resumed match may have fewer logged goals', passes(e({ ...x, cont: 1, goals: x.goals.slice(3) }), 'airhockey-goals-not-logged'));
  ok('air hockey: goals 0.5 s apart is PROVEN', fires(e({ ...x, goals: x.goals.map((g, k) => [g[0], k * 0.5]) }), 'airhockey-goals-faster-than-serve'));
  ok('air hockey: a shot faster than the table allows is PROVEN', fires(e(x, 7, 1, 20000), 'airhockey-shot-too-fast'));
  ok('air hockey: 7 goals from 12 hits is suspicious', fires(e({ ...x, shots: 12 }), 'airhockey-goal-every-hit'));
}

// ================= FLICK SOCCER
{
  const f = [[0, 3, 0.6, -0.8, 0.9, -1, 0, [0, 0], 0], [1, 7, -0.6, 0.8, 0.7, -1, 0, [0, 0], 3], [0, 2, 0, -1, 1, 0, 0, [1, 0], 6], [1, 8, 0.8, 0.6, 0.95, 1, 0, [1, 1], 9], [0, 4, 0.28, -0.96, 0.5, 0, 0, [2, 1], 12]];
  const x = { v: 1, end: 'end', mode: 'cpu', diff: 'medium', goals: 2, winner: 0, scores: [2, 1], fromShot: 0, flicks: f };
  const e = (xx, won = true) => ({ g: 'flicksoccer', f: 'recordResult', a: J(['flicksoccer', 'medium', won]), x: J(xx) });
  ok('flick soccer: a real-looking match passes', hits(e(x), downs(5)).length === 0);
  ok('flick soccer: a score the flicks do not give is PROVEN', fires(e({ ...x, scores: [3, 1] }), 'flick-score-not-flicks'));
  ok('flick soccer: a win the score does not give is PROVEN', fires(e(x, false), 'flick-score-not-flicks'));
  ok('flick soccer: a flick over full power is PROVEN', fires(e({ ...x, flicks: f.map((q, k) => (k === 0 ? [0, 3, 0.6, -0.8, 1.6, -1, 0, [0, 0], 0] : q)) }), 'flick-impossible-pull'));
  ok('flick soccer: a flick of the other side\'s disc is PROVEN', fires(e({ ...x, flicks: f.map((q, k) => (k === 0 ? [0, 8, 0.6, -0.8, 0.9, -1, 0, [0, 0], 0] : q)) }), 'flick-wrong-piece'));
  ok('flick soccer: flicks without touches is PROVEN', fires(e(x), 'flick-without-drag', downs(1)));
  ok('flick soccer: one flick three times is suspicious', fires(e({ ...x, flicks: [...f, f[0], f[0]] }), 'flick-same-flick-again'));
}

// ================= POOL
{
  const s = (seat, pots, foul = 0) => [1, seat, 0.6, -0.8, 0.7, 0.1, null, null, -1, pots, [], pots, foul, pots.length ? 'again' : 'turn', 1];
  const log = [s(0, [3]), s(0, []), s(1, [9]), s(1, []), s(0, [1, 2]), s(0, [8])];
  const x = { v: 1, end: 'end', mode: 'cpu', diff: 'easy', game: '8', racks: 1, n: 2, winner: 0, scores: [1, 0], fromShot: 0, more: 0, shotLog: log };
  const e = (xx, won = true) => ({ g: 'eightball', f: 'recordResult', a: J(['eightball', 'easy', won]), x: J(xx) });
  ok('pool: a real-looking match passes', hits(e(x), downs(6)).length === 0);
  ok('pool: more racks than first-to is PROVEN', fires(e({ ...x, scores: [2, 0] }), 'pool-racks-not-won'));
  ok('pool: a recorded win for the computer\'s rack is PROVEN', fires(e({ ...x, winner: 1, scores: [0, 1] }), 'pool-racks-not-won'));
  ok('pool: a shot over full power is PROVEN', fires(e({ ...x, shotLog: [[1, 0, 0.6, -0.8, 1.5, 0, null, null, -1, [], [], [], 0, 'turn', 0], ...log] }), 'pool-impossible-shot'));
  ok('pool: shots without touches is PROVEN', fires(e(x), 'pool-shots-without-touch', downs(1)));
  ok('pool: fifteen shots all potting is suspicious', fires(e({ ...x, shotLog: Array.from({ length: 15 }, () => s(0, [5])) }), 'pool-never-misses'));
}

// ================= CUP PONG
{
  const rows = Array.from({ length: 14 }, (_, k) => [k + 1, 0.6, 0.01, k < 10 ? 'made' : 'miss', k < 10 ? `k${k}` : '', 0, 10 - Math.min(k, 10), k * 2]);
  rows.sort((p, q) => (p[3] === q[3] ? 0 : p[3] === 'miss' ? -1 : 1));
  const xs = { v: 1, end: 'cleared', throws: 14, cupsLeft: 0, rows: rows.map((r, k) => [k + 1, ...r.slice(1, 6), 10 - rows.slice(0, k).filter((q) => q[3] === 'made').length, k * 2]) };
  const es = (xx, n = 14) => ({ g: 'cuppong', f: 'recordCupPongSolo', a: J([n]), x: J(xx) });
  ok('cup pong: a real-looking solo rack passes', hits(es(xs), downs(14)).length === 0);
  ok('cup pong: a recorded count not its throws is PROVEN', fires(es(xs, 12), 'cuppong-solo-not-its-throws'));
  ok('cup pong: one cup made twice is PROVEN', fires(es({ ...xs, rows: xs.rows.map((r) => (r[3] === 'made' ? [...r.slice(0, 4), 'k0', ...r.slice(5)] : r)) }), 'cuppong-solo-not-its-throws'));
  ok('cup pong: solo throws without touches is PROVEN', fires(es(xs), 'cuppong-throws-without-touch', downs(5)));
  const ten = { ...xs, throws: 10, rows: xs.rows.filter((r) => r[3] === 'made') };
  ok('cup pong: a rack in 10 throws is suspicious', fires(es(ten, 10), 'cuppong-every-throw-in'));
  const th = Array.from({ length: 12 }, (_, k) => [k % 2 ? 'b' : 'a', 0.6, 0, k % 4 === 0 ? 'k1' : '', 0, k % 4 === 0 ? 'made' : 'miss', 10, 10, '', 0, k]);
  const ec = (xx, d = { throws: 6 }) => ({ g: 'cuppong', f: 'recordCupPong', a: J(['hard', false, 0]), d: J(d), x: J(xx) });
  const xc = { v: 1, end: 'end', tally: { throws: 6, made: 3 }, throws: th };
  ok('cup pong: a real-looking match passes', hits(ec(xc), downs(6)).length === 0);
  ok('cup pong: more throws counted than thrown is PROVEN', fires(ec({ ...xc, tally: { throws: 9 } }, { throws: 9 }), 'cuppong-tally-not-throws'));
  ok('cup pong: match throws without touches is PROVEN', fires(ec(xc), 'cuppong-throws-without-touch', downs(2)));
}

// ================= DARTS (a real engine match vs the computer)
{
  const rnd = seeded(9), m = DT.newMatch(0, '301', true, true), rows = [];
  for (let k = 0; k < 400 && m.winner == null; k++) {
    const seat = m.turn, p = DT.computerThrow(m, seat === 0 ? 'hard' : 'medium', rnd);
    const res = DT.throwDart(m, p.x, p.y);
    rows.push([...DT.dartRow(seat, p.x, p.y, res), k]);
    if (m.winner != null) break;
    if (['end', 'bust', 'out'].includes(res.event)) DT.nextTurn(m);
  }
  const x = { v: 1, end: 'end', mode: 'cpu', diff: 'medium', kind: '301', winner: m.winner, scores: m.scores.slice(), bo: m.bo || null, fromTurn: 0, darts: rows };
  const e = (xx, won = m.winner === 0) => ({ g: 'darts', f: 'recordResult', a: J(['darts', 'medium', won]), x: J(xx) });
  ok(`darts: a real engine match passes every rule (${rows.length} darts)`, hits(e(x), downs(200)).length === 0);
  const k = rows.findIndex((q) => q[4] === 1 && q[3] !== 20);
  ok('darts: a dart scored as a treble it did not hit is PROVEN', fires(e({ ...x, darts: rows.map((q, i) => (i === k ? [q[0], q[1], q[2], q[3], 3, q[5] * 3, q[6], q[7], q[8]] : q)) }), 'darts-score-not-where-it-hit'));
  ok('darts: four darts in one turn is PROVEN', fires(e({ ...x, darts: [rows[0], rows[0], rows[0], ...rows] }), 'darts-match-not-its-darts'));
  ok('darts: a 301 winner not on zero is PROVEN', m.bo || fires(e({ ...x, scores: x.scores.map((v, i) => (i === m.winner ? 40 : v)) }), 'darts-match-not-its-darts'));
  ok('darts: darts without touches is PROVEN', fires(e(x), 'darts-without-touch', downs(3)));
  ok('darts: nine trebles is suspicious', fires(e({ ...x, darts: Array.from({ length: 9 }, (_, i) => [0, 0, -0.6, 20, 3, 60, 0, 'score', i]) }), 'darts-every-dart-a-treble'));
}

// ================= KNOCKOUT (Shove Off)
{
  const x = { v: 1, rv: 2, cpu: 'medium', end: 'off', winner: 'a', sd: 0,
    sent: [['a', 1, '-216,-402;559,-28;281,-484;-88,552'], ['b', 1, '509,-231;-462,241;-117,-104;-486,66'], ['a', 2, '-559,29;-;-230,-464;-206,341'], ['b', 2, '-;-;215,-516;299,308']],
    rounds: [{ r: 1, sd: 0, before: 'a0:560,180 a1:-560,-180 a2:-230,230 a3:230,-230 b0:-180,560 b1:180,-560 b2:230,230 b3:-230,-230', after: 'a0:383,-825 a2:31,600 a3:481,-375 b2:266,185 b3:43,-808' },
      { r: 2, sd: 0, before: 'a0:383,-825 a2:31,600 a3:481,-375 b2:266,185 b3:43,-808', after: 'a2:-608,401' }] };
  const e = (xx, won = true) => ({ g: 'shoveoff', f: 'recordResult', a: J(['shoveoff', 'medium', won]), x: J(xx) });
  ok('knockout: a real match passes (Nov 20 shape)', hits(e(x), downs(7)).length === 0);
  ok('knockout: an arrow past the longest is PROVEN', fires(e({ ...x, sent: [['a', 1, '900,0;559,-28;281,-484;-88,552'], ...x.sent.slice(1)] }), 'knockout-aim-too-long'));
  ok('knockout: a shove for a fallen piece is PROVEN', fires(e({ ...x, sent: [...x.sent.slice(0, 2), ['a', 2, '-559,29;100,100;-230,-464;-206,341']] }), 'knockout-aim-for-a-fallen-piece'));
  ok('knockout: a recorded loss while only this player is left is PROVEN', fires(e(x, false), 'knockout-result-not-rounds'));
  ok('knockout: aims without touches is PROVEN', fires(e(x), 'knockout-aims-without-touch', downs(2)));
  ok('knockout: the same arrow three rounds is suspicious', fires(e({ ...x, sent: [['a', 1, '10,10;-;-;-'], ['a', 2, '10,10;-;-;-'], ['a', 3, '10,10;-;-;-']] }), 'knockout-same-aim-again'));
  ok('knockout: an online match (no cpu) is not judged', hits({ ...e(x, false), x: J({ ...x, cpu: undefined }) }, downs(0)).length === 0);
}

// --- replay over the real plays
const i = process.argv.indexOf('--db');
if (i > 0) {
  const log = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  const ii = process.argv.indexOf('--input');
  const input = ii > 0 && fs.existsSync(process.argv[ii + 1]) ? JSON.parse(fs.readFileSync(process.argv[ii + 1], 'utf8')) : null;
  const per = {}, seen = {};
  for (const [code, rows] of Object.entries(log || {})) for (const [id, e] of Object.entries(rows || {})) {
    if (!e || !GAMES.includes(e.g) || !/^record/.test(String(e.f || ''))) continue;
    seen[e.g] = (seen[e.g] || 0) + 1;
    const nRaw = input && input[code] && input[code][id] ? input[code][id].n : null;
    for (const h of runTripWires(e, nRaw)) {
      per[h.rule] = (per[h.rule] || 0) + 1;
      console.log(`HIT ${h.proven ? 'PROVEN    ' : 'suspicious'} ${code} ${id} ${new Date(e.t || 0).toLocaleString('en-US', { timeZone: 'America/New_York' })} ${e.g} ${h.rule}: ${h.v} (limit ${h.lim})`);
    }
  }
  console.log('entries per game:', J(seen));
  for (const g of GAMES) for (const r of TRIP_GAMES[g] || []) console.log(`  ${r.proven ? 'PROVEN    ' : 'suspicious'} ${r.id}: ${per[r.id] || 0} hits`);
}
process.exit(fail ? 1 : 0);
