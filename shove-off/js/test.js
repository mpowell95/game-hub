// shove-off/js/test.js - Shove Off's engine: collisions, falls, the shrink, sudden death, the draw ceiling,
// fairness of the start, and DETERMINISM (the same log replays to the same bits; no trig in the sim).
//   node shove-off/js/test.js
import { readFileSync } from 'node:fs';
import * as E from './engine.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };
const still = (m) => E.aimsToString(E.slotsOf(m, 'a').length ? Array.from({ length: E.slotCount(m) }, () => null) : []);
/** A side's aims: `f(piece)` -> [dx, dy] for each living piece (null = '-'). */
function aimsFor(m, s, f) {
  const list = Array.from({ length: E.slotCount(m) }, () => null);
  for (const p of E.alive(m, s)) list[p.i] = E.clampAim(...f(p));
  return E.aimsToString(list);
}
const tiny = (p) => [p.x > 0 ? -80 : 80, 0];   // a soft nudge toward the middle
void still;

// --- 1. the start is fair -----------------------------------------------------------------------
{
  const rot = ([x, y]) => [-y, x];
  const key = ([x, y]) => `${x},${y}`;
  const a = new Set(E.START.a.map(key)), b = new Set(E.START.b.map(key));
  ok('a quarter turn maps every a spot onto a b spot', E.START.a.every((p) => b.has(key(rot(p)))));
  ok('...and every b spot onto an a spot', E.START.b.every((p) => a.has(key(rot(p)))));
  ok('four pieces each, all on the platform, none overlapping',
    E.START.a.length === 4 && E.START.b.length === 4 && E.START.a.concat(E.START.b).every(([x, y], i, all) =>
      Math.abs(x) < E.H0 - E.R && Math.abs(y) < E.H0 - E.R && all.every(([u, v], j) => j === i || (x - u) ** 2 + (y - v) ** 2 >= (2 * E.R) ** 2)));
  ok('sudden death spots are mirror images', E.SD_START.a[0][0] === -E.SD_START.b[0][0] && E.SD_START.a[0][1] === E.SD_START.b[0][1]);
}

// --- 2. aims: format and caps ---------------------------------------------------------------------
{
  const m = E.newMatch();
  ok('a well-formed aim string parses', !!E.parseAims(m, 'a', '100,0;0,100;-100,0;0,-100'));
  ok('wrong number of parts refused', E.parseAims(m, 'a', '100,0;0,100') === null);
  ok('an arrow past the cap refused', E.parseAims(m, 'a', '561,0;0,0;0,0;0,0') === null);
  ok('junk refused', E.parseAims(m, 'a', '1.5,0;0,0;0,0;0,0') === null && E.parseAims(m, 'a', 'x;y;z;w') === null);
  ok('a dead piece must be "-"', (() => { const mm = E.newMatch(); mm.pieces[0].alive = false; return E.parseAims(mm, 'a', '1,1;0,0;0,0;0,0') === null && !!E.parseAims(mm, 'a', '-;0,0;0,0;0,0'); })());
  const c = E.clampAim(5000, 5000);
  ok('clampAim keeps an arrow inside the cap, as integers', Number.isInteger(c[0]) && c[0] * c[0] + c[1] * c[1] <= E.MAX_AIM ** 2 && c[0] > 380);
}

// --- 3. physics: a lone full shove from the middle goes off; a soft one stays ----------------------
{
  const m = E.newMatch(); m.pieces = [{ s: 'a', i: 0, x: 0, y: 0, alive: true }];
  const r = E.slide(m, { a: [[E.MAX_AIM, 0]] });
  ok('a full shove from the middle goes off the edge', r.falls.length === 1 && !m.pieces[0].alive);
  const m2 = E.newMatch(); m2.pieces = [{ s: 'a', i: 0, x: 0, y: 0, alive: true }];
  E.slide(m2, { a: [[200, 0]] });
  ok('a soft shove stops on the platform, in line', m2.pieces[0].alive && m2.pieces[0].x > 200 && m2.pieces[0].x < 600 && m2.pieces[0].y === 0);
}
// --- 4. collisions: head-on equal masses swap speed (less the bounce loss) ------------------------
{
  const m = E.newMatch();
  m.pieces = [{ s: 'a', i: 0, x: -300, y: 0, alive: true }, { s: 'b', i: 0, x: 0, y: 0, alive: true }];
  E.slide(m, { a: [[400, 0]], b: [null] });
  const [p, q] = m.pieces;
  ok('the hit piece moves on, the hitter nearly stops', q.x > 300 && p.x < -50 + 200 && p.x > -300, `${p.x} ${q.x}`);
  ok('no overlap after the slide', (q.x - p.x) >= 2 * E.R - 1e-9);
  ok('a dead-straight hit stays on its line', p.y === 0 && q.y === 0);
  const m2 = E.newMatch();
  m2.pieces = [{ s: 'a', i: 0, x: -300, y: 0, alive: true }, { s: 'b', i: 0, x: 0, y: 60, alive: true }];
  E.slide(m2, { a: [[400, 0]], b: [null] });
  ok('a glancing hit sends the other piece off at an angle', m2.pieces[1].y > 60 && m2.pieces[0].y < 0);
  // momentum conservation (equal masses): the sum of speeds' x stays put through the hit (no friction step in it)
  const m3 = E.newMatch(); m3.pieces = [{ s: 'a', i: 0, x: -150, y: 0, alive: true }, { s: 'b', i: 0, x: 0, y: 0, alive: true }];
  const fr = [];
  E.slide(m3, { a: [[300, 0]], b: [[-300, 0]] }, fr);
  ok('two pieces shoved into each other head on bounce apart, symmetrically', Math.abs(m3.pieces[0].x + m3.pieces[1].x + 150) < 1e-6, `${m3.pieces[0].x} ${m3.pieces[1].x}`);
}
// --- 5. falls, shrink, rounds ----------------------------------------------------------------------
{
  const m = E.newMatch();
  ok('round 1, both owe', m.round === 1 && E.owes(m).a && E.owes(m).b);
  ok('the first side to send waits', E.applyAims(m, 'a', 1, aimsFor(m, 'a', tiny)) === 'sent' && !E.owes(m).a && E.owes(m).b);
  ok('the same side cannot send twice', E.applyAims(m, 'a', 1, aimsFor(m, 'a', tiny)) === null);
  ok('a wrong round is refused', E.applyAims(m, 'b', 2, aimsFor(m, 'b', tiny)) === null);
  ok('the second side resolves the round', E.applyAims(m, 'b', 1, aimsFor(m, 'b', tiny)) === 'resolved');
  ok('round 2 begins, both owe again', m.round === 2 && E.owes(m).a && E.owes(m).b);
  ok('the platform shrank by SHRINK', Math.abs(m.H - E.H0 * E.SHRINK) < 1e-9);
  // shrink down to the floor
  for (let r = 2; r < 12 && m.winner == null; r++) { E.applyAims(m, 'a', r, aimsFor(m, 'a', tiny)); E.applyAims(m, 'b', r, aimsFor(m, 'b', tiny)); }
  ok('the platform never shrinks below H_MIN', m.H >= E.H_MIN && m.rounds.some((x) => x.H1 === E.H_MIN));
}
{
  // pieces left outside after a shrink fall
  const m = E.newMatch();
  m.pieces = [{ s: 'a', i: 0, x: 950, y: 0, alive: true }, { s: 'b', i: 0, x: 0, y: 0, alive: true }];
  m.sent = { a: [null], b: [null] };
  // (two-piece test match: hand the sent aims in directly)
  const rec = E.resolveRound(m);
  ok('a piece outside the shrunk platform falls at the edge', rec.shrinkFalls.length === 1 && !m.pieces[0].alive && m.winner === 'b');
}
// --- 6. winning, sudden death, the draw ceiling ---------------------------------------------------
{
  const m = E.newMatch();
  // a shoves everything outward at full power; b too: everyone flies off = sudden death
  const out = (p) => { const d = Math.sqrt(p.x * p.x + p.y * p.y); return [p.x / d * 9999, p.y / d * 9999]; };
  E.applyAims(m, 'a', 1, aimsFor(m, 'a', out));
  E.applyAims(m, 'b', 1, aimsFor(m, 'b', out));
  ok('everyone off in one round = sudden death, not a result', m.winner == null && m.sd === 1 && m.H === E.SD_H);
  ok('sudden death: one piece each at the mirrored spots', m.pieces.length === 2 && m.pieces[0].x === -230 && m.pieces[1].x === 230 && E.slotCount(m) === 1);
  ok('sudden death aims are one part', !!E.parseAims(m, 'a', '100,0') && E.parseAims(m, 'a', '100,0;0,0') === null);
  // a shoves b off (a pushes right hard at b, b sits still... b must aim: aim it a little toward a)
  E.applyAims(m, 'a', m.round, '560,0');
  E.applyAims(m, 'b', m.round, '-80,0');
  ok('a sudden-death round with one piece left decides it', m.winner === 'a' && m.end === 'sudden', `${m.winner} ${JSON.stringify(m.pieces)}`);
}
{
  const m = E.newMatch();
  const out = (p) => { const d = Math.sqrt(p.x * p.x + p.y * p.y); return [p.x / d * 9999, p.y / d * 9999]; };
  E.applyAims(m, 'a', 1, aimsFor(m, 'a', out)); E.applyAims(m, 'b', 1, aimsFor(m, 'b', out));
  // keep both in: both nudge sideways a little, every sudden-death round
  let guard = 0;
  while (m.winner == null && guard++ < 40) { E.applyAims(m, 'a', m.round, '0,80'); E.applyAims(m, 'b', m.round, '0,-80'); }
  ok(`SD_MAX (${E.SD_MAX}) sudden-death rounds with no winner = a draw`, m.winner === E.DRAW && m.sdr === E.SD_MAX && m.end === 'draw');
  ok('a finished match refuses more aims', E.applyAims(m, 'a', m.round, '0,80') === null);
}
{
  // the round cap: nobody ever shoves anyone off
  const m = E.newMatch();
  let guard = 0;
  while (m.winner == null && m.sd === 0 && guard++ < 60) { E.applyAims(m, 'a', m.round, aimsFor(m, 'a', (p) => [p.x > 0 ? -75 : 75, 0])); E.applyAims(m, 'b', m.round, aimsFor(m, 'b', (p) => [p.x > 0 ? -75 : 75, 0])); }
  ok(`ROUND_MAX (${E.ROUND_MAX}): more pieces wins, equal goes to sudden death`, (m.winner != null && m.end === 'count') || (m.sd === 1 && m.rounds.length === E.ROUND_MAX) || m.rounds.length < E.ROUND_MAX, `${m.rounds.length} ${m.winner} ${m.sd}`);
}

// --- 7. determinism ---------------------------------------------------------------------------------
{
  // a long random-but-seeded log, replayed twice: identical bits
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const log = [];
  const m = E.newMatch();
  while (m.winner == null && log.length < 120) {
    for (const s of ['a', 'b']) {
      const str = aimsFor(m, s, () => [Math.round((rnd() - 0.5) * 1200), Math.round((rnd() - 0.5) * 1200)]);
      log.push([s, m.round, str]);
      E.applyAims(m, s, m.round, str);
      if (m.winner != null) break;
    }
  }
  const run = () => { const x = E.newMatch(); for (const [s, r, a] of log) E.applyAims(x, s, r, a); return x; };
  const x1 = run(), x2 = run();
  const bits = (x) => JSON.stringify(x.rounds.map((r) => r.after)) + JSON.stringify(x.pieces) + x.winner + x.round + x.H;
  ok(`the same log replays to the same bits (${m.rounds.length} rounds, winner ${m.winner})`, bits(x1) === bits(x2) && bits(x1) === bits(m));
  // a fixed log's outcome, pinned: any change to the physics shows up here
  const FIX = [['a', 1, '300,100;-300,-100;200,0;0,200'], ['b', 1, '-200,300;200,-300;-200,-200;200,200']];
  const f = E.newMatch(); for (const [s, r, a] of FIX) E.applyAims(f, s, r, a);
  const sum = f.pieces.reduce((t, p) => t + (p.alive ? p.x * 3 + p.y * 7 : 1000), 0);
  ok('a pinned round lands where it always has (change a physics number = re-pin on purpose)', sum === 7984.899647207166 && f.rounds[0].steps === 166, String(sum));
  console.log('     pinned sum', sum, 'steps', f.rounds[0].steps);
}
{
  const src = readFileSync(new URL('./engine.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('no trig, exp, pow, hypot or random in the simulation', !/Math\.(sin|cos|tan|atan2?|asin|acos|exp|pow|hypot|log|random|cbrt)\b/.test(src) && !/\*\*/.test(src));
  ok('no clock in the simulation', !/Date\.|performance\./.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
