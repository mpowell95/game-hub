// shove-off/js/test.js - Shove Off's engine: collisions, falls, the shrink, sudden death, the draw ceiling,
// fairness of the start, and DETERMINISM (the same log replays to the same bits; no trig in the sim).
//   node shove-off/js/test.js
import { readFileSync } from 'node:fs';
import * as E from './engine.js';
const RV2_PIN = 8185.36135034083;   // rv 2's pinned round (section 10)

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

// --- 8. the computer (cpu.js, 2026-11-18) ------------------------------------------------------------
{
  const C = await import('./cpu.js');
  const valid = (m, s, aims) => {
    const str = E.aimsToString(aims);
    return !!E.parseAims(m, s, str) && E.slotsOf(m, s).every((i) => aims[i] && Number.isInteger(aims[i][0]) && Number.isInteger(aims[i][1]));
  };
  const m0 = E.newMatch();
  let allOk = true;
  for (const d of C.DIFFS) for (const s of ['a', 'b']) if (!valid(m0, s, C.chooseAims(m0, s, d, 7))) allOk = false;
  // a board with pieces out and a sudden-death board too
  const m1 = E.newMatch(); m1.pieces[1].alive = false; m1.pieces[6].alive = false;
  for (const d of C.DIFFS) if (!valid(m1, 'b', C.chooseAims(m1, 'b', d, 9)) || C.chooseAims(m1, 'b', d, 9)[2] !== null) allOk = false;
  const msd = E.newMatch(); msd.sd = 1; msd.H = E.SD_H; msd.pieces = [{ s: 'a', i: 0, x: -230, y: 0, alive: true }, { s: 'b', i: 0, x: 230, y: 0, alive: true }];
  for (const d of C.DIFFS) if (!valid(msd, 'b', C.chooseAims(msd, 'b', d, 3))) allOk = false;
  ok('the computer aims every living piece (integers, inside the cap, "-" for a piece that is out), every level, sudden death too', allOk);
  ok('the computer is deterministic for a seed', C.DIFFS.every((d) => JSON.stringify(C.chooseAims(m0, 'b', d, 42)) === JSON.stringify(C.chooseAims(m0, 'b', d, 42))));
  ok('...and a different seed can change Easy', JSON.stringify(C.chooseAims(m0, 'b', 'easy', 1)) !== JSON.stringify(C.chooseAims(m0, 'b', 'easy', 2)));
  // FAIR: the player's aims for this round (m.sent.a) never change the computer's choice; nor does chooseAims touch m
  const peek = E.newMatch();
  E.applyAims(peek, 'a', 1, '560,0;-560,0;0,560;0,-560');
  const before = JSON.stringify(peek);
  const withSent = C.chooseAims(peek, 'b', 'hard', 5);
  const clean = E.newMatch();
  ok('the computer never reads the player\'s aims: the same board with or without them sent gives the same choice',
    JSON.stringify(withSent) === JSON.stringify(C.chooseAims(clean, 'b', 'hard', 5)));
  ok('...and choosing leaves the match untouched', JSON.stringify(peek) === before);
  const src = readFileSync(new URL('./cpu.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('...by construction: cpu.js reads `sent` nowhere but where it empties its copy, and has no Math.random', !/\.sent\[/.test(src.replace(/m\.sent\[s\] = mine; m\.sent\[E\.other\(s\)\] = theirs;/, '')) && !/Math\.random/.test(src));
  ok('the computer plays its own look\'s other colour', C.cpuLook('sumo0') === 'sumo1' && C.cpuLook('car1') === 'car0' && C.cpuLook('puck0') === 'puck1');
  // Hard beats Easy over a seeded series of 40 games, sides alternating
  const play = (da, db, seed, rv = 1) => {
    const m = E.newMatch(rv);
    let n = 0;
    while (m.winner == null && n++ < 60) {
      const sa = C.chooseAims(m, 'a', da, C.roundSeed(seed, m.round)), sb = C.chooseAims(m, 'b', db, C.roundSeed(seed + 7, m.round));
      E.applyAims(m, 'a', m.round, E.aimsToString(sa));
      E.applyAims(m, 'b', m.round, E.aimsToString(sb));
    }
    return m.winner;
  };
  for (const rv of [1, 2]) {
    let hard = 0, easy = 0, draws = 0;
    for (let g = 0; g < 40; g++) {
      const hs = g % 2 ? 'a' : 'b';
      const w = play(hs === 'a' ? 'hard' : 'easy', hs === 'b' ? 'hard' : 'easy', 1000 + g, rv);
      if (w === hs) hard++; else if (w === E.DRAW || w == null) draws++; else easy++;
    }
    ok(`rv ${rv}: Hard beats Easy clearly in 40 seeded games (hard ${hard}, easy ${easy}, draws ${draws})`, hard > easy * 3 && hard > 28);
  }
  {
    const m2 = E.newMatch(2); m2.pieces[1].alive = false;
    ok('rv 2: the computer aims validly on the circle', C.DIFFS.every((d) => valid(m2, 'b', C.chooseAims(m2, 'b', d, 11))));
  }
}

// --- 9. RULES VERSIONS (2026-11-18): old matches replay EXACTLY as before; new ones play on the circle ----
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const digest = (m) => fnv(JSON.stringify(m.rounds.map((r) => [r.r, r.sd, r.H, r.H1, r.steps, r.falls, r.shrinkFalls, r.after])) + JSON.stringify(m.pieces) + m.winner + m.end + m.round + m.H + m.sd + m.sdr);
const parseLog = (str) => str.split(' ').map((e) => { const [by, r, aims] = e.split('|'); return { by, r: +r, aims }; });
const replayLog = (log, rv) => { const m = E.newMatch(rv); for (const e of log) if (!E.applyAims(m, e.by, e.r, e.aims)) return null; return m; };
{
  // Pinned with the engine and computer AS THEY WERE before rv 2 (commit ab25ff3): three computer-vs-computer
  // matches and one that went to sudden death. Digest = every round's after-positions, falls, steps, sizes, bit for bit.
  const OLD = [
    ['d718c1f7', 'a', 'off', 'a|1|-200,-522;58,393;177,531;-177,-531 b|1|491,-267;-497,234;-124,-119;122,108 a|2|281,31;-468,-217;-;- b|2|-;-;-413,378;220,-347'],
    ['893e715b', 'b', 'off', 'a|1|-181,-32;172,79;87,479;-152,162 b|1|522,-200;-522,200;279,-164;-531,177 a|2|-;-;-;29,369 b|2|-503,-246;227,65;-113,-548;237,86 a|3|-;-;-;-393,322 b|3|-;-;78,-116;473,-298'],
    ['fc7cfd8', 'b', 'off', 'a|1|-256,-498;269,451;116,-121;-183,-100 b|1|105,-404;-339,444;110,-548;81,119 a|2|-;-25,-532;492,162;- b|2|-192,428;-;-190,-58;-3,134 a|3|-;-;-24,-387;- b|3|-174,-531;-;-;269,-72'],
    ['1de50d1a', 'b', 'sudden', 'a|1|533,171;-533,-171;-395,395;395,-395 b|1|-171,533;171,-533;395,395;-395,-395 a|2|0,80 b|2|0,-80 a|3|120,30 b|3|-200,10 a|4|300,0 b|4|-90,40'],
  ];
  let same = true;
  for (const [dg, w, end, str] of OLD) {
    const m = replayLog(parseLog(str));                 // no rules version = rv 1
    if (!m || digest(m) !== dg || m.winner !== w || m.end !== end) { same = false; console.log('     old log drifted', dg, m && digest(m)); }
  }
  ok('pinned OLD logs (no rv) replay bit for bit to their old results, sudden death included', same);
  ok('newMatch() with no rules version is still the old square', E.newMatch().rv === 1 && E.newMatch().H === 1000 && E.rulesOf(E.newMatch()).shape === 'square');
  const diff = OLD.some(([dg, , , str]) => { const m = replayLog(parseLog(str), 2); return !m || digest(m) !== dg; });
  ok('...and the same logs under rv 2 come out differently (the version really changes the rules)', diff);
  ok('an unknown rules version falls back to nothing new: asRv(3) = 1, rulesOf({}) = rv 1', E.asRv(3) === 1 && E.rulesOf({}).shape === 'square');
}

// --- 10. rv 2: the circle and the 51% rule ---------------------------------------------------------
{
  // INDEPENDENT area: the exact two-circle lens formula (Math.acos is fine HERE, in the test), cross-checked
  // by a brute 2D grid count.
  const lens = (Rc, r, d) => {
    if (d >= Rc + r) return 0; if (d <= Rc - r) return 1;
    const a = r * r * Math.acos((d * d + r * r - Rc * Rc) / (2 * d * r)) + Rc * Rc * Math.acos((d * d + Rc * Rc - r * r) / (2 * d * Rc))
      - 0.5 * Math.sqrt((-d + r + Rc) * (d + r - Rc) * (d - r + Rc) * (d + r + Rc));
    return a / (Math.PI * r * r);
  };
  const grid = (Rc, r, d, n = 600) => {
    let all = 0, inn = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = -r + (i + 0.5) * 2 * r / n, y = -r + (j + 0.5) * 2 * r / n;
      if (x * x + y * y > r * r) continue;
      all++; if ((d + x) ** 2 + y * y <= Rc * Rc) inn++;
    }
    return inn / all;
  };
  const at = (Rc, share) => { let lo = Rc - E.R, hi = Rc + E.R; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (lens(Rc, E.R, mid) >= share) lo = mid; else hi = mid; } return lo; };
  const P2 = E.RULES[2];
  const sizes = []; for (let H = P2.H0, i = 0; i < 9; i++) { sizes.push(H); H = Math.max(P2.H_MIN, H * P2.SHRINK); } sizes.push(P2.SD_H);
  let okLine = true, worst = 0;
  for (const Rc of sizes) {
    const m = E.newMatch(2);
    const d50 = at(Rc, 0.50), d52 = at(Rc, 0.48);    // 50% off, 52% off
    if (E.isOff(m, d50, 0, Rc) || !E.isOff(m, d52, 0, Rc)) okLine = false;
    // diagonal too (only the distance may matter)
    if (E.isOff(m, d50 / Math.SQRT2, d50 / Math.SQRT2, Rc) || !E.isOff(m, d52 / Math.SQRT2, -d52 / Math.SQRT2, Rc)) okLine = false;
    worst = Math.max(worst, Math.abs(lens(Rc, E.R, E.fallDist(Rc)) - 0.49));
  }
  ok('rv 2: a piece 50% off the circle stays, 52% off falls (every circle size the game uses; exact lens area)', okLine);
  ok(`rv 2: the fall line is 51% off to within 0.01% of the area (worst ${worst.toExponential(2)})`, worst < 1e-4);
  const Rc = P2.H0, d = E.fallDist(Rc);
  ok('rv 2: ...and a brute grid count agrees on both sides of the line', grid(Rc, E.R, at(Rc, 0.50)) > 0.495 && grid(Rc, E.R, at(Rc, 0.48)) < 0.485 && Math.abs(grid(Rc, E.R, d) - 0.49) < 0.004);
  // during a slide: every piece still on has at most 51% off; every piece that fell was over 51% off where it fell
  let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let good = true, fell = 0, stayed = 0;
  for (let t = 0; t < 300; t++) {
    const m = E.newMatch(2);
    const ang = rnd() * Math.PI * 2, dist = Rc - 160 + rnd() * 150;
    m.pieces = [{ s: 'a', i: 0, x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, alive: true }];
    const sp = 15 + rnd() * 70;
    const aim = E.clampAim(Math.cos(ang) * sp + (rnd() - 0.5) * 60, Math.sin(ang) * sp + (rnd() - 0.5) * 60);
    E.slide(m, { a: [aim] });
    const p = m.pieces[0], share = lens(Rc, E.R, Math.sqrt(p.x * p.x + p.y * p.y));
    if (p.alive) { stayed++; if (share < 0.49 - 1e-6) good = false; } else { fell++; if (share > 0.49 + 1e-6) good = false; }
  }
  ok(`rv 2: in real slides, on = at most 51% off, fallen = over 51% off where it fell (${stayed} stayed, ${fell} fell)`, good && fell > 30 && stayed > 30);
}
{
  const P2 = E.RULES[2];
  const rot = ([x, y]) => [-y, x];
  const key = ([x, y]) => `${x},${y}`;
  const a = new Set(P2.START.a.map(key)), b = new Set(P2.START.b.map(key));
  ok('rv 2: the start ring is fair (a quarter turn swaps the sides\' spots)', P2.START.a.every((p) => b.has(key(rot(p)))) && P2.START.b.every((p) => a.has(key(rot(p)))));
  const all = P2.START.a.concat(P2.START.b);
  ok('rv 2: every start spot well inside the circle, none overlapping', all.every(([x, y], i) => Math.sqrt(x * x + y * y) + E.R < P2.H0 - 200 && all.every(([u, v], j) => j === i || (x - u) ** 2 + (y - v) ** 2 >= (2 * E.R) ** 2)));
  ok('rv 2: sudden-death spots are mirror images', P2.SD_START.a[0][0] === -P2.SD_START.b[0][0]);
  ok('rv 2: the circle starts bigger than the old square\'s half-size', P2.H0 > E.H0);
  for (const dir of [[1, 0], [0.6, 0.8], [-0.8, -0.6]]) {
    const m = E.newMatch(2); m.pieces = [{ s: 'a', i: 0, x: 0, y: 0, alive: true }];
    const r = E.slide(m, { a: [E.clampAim(dir[0] * 9999, dir[1] * 9999)] });
    if (!(r.falls.length === 1)) ok('rv 2: a full shove from the middle goes off in any direction', false);
  }
  ok('rv 2: a full shove from the middle goes off in any direction', true);
  const m3 = E.newMatch(2); m3.pieces = [{ s: 'a', i: 0, x: 0, y: 0, alive: true }];
  E.slide(m3, { a: [[E.MAX_AIM * 0.8 | 0, 0]] });
  ok('rv 2: a 4/5 shove from the middle stays on', m3.pieces[0].alive);
  // shrink: start, factor, floor, rounds to the floor
  const m = E.newMatch(2);
  let n = 0;
  while (m.winner == null && m.sd === 0 && n++ < 12) { E.applyAims(m, 'a', m.round, aimsFor(m, 'a', tiny)); E.applyAims(m, 'b', m.round, aimsFor(m, 'b', tiny)); }
  const firstFloor = m.rounds.findIndex((x) => x.H1 === P2.H_MIN) + 1;
  ok(`rv 2: the circle shrinks by ${P2.SHRINK} a round to ${P2.H_MIN} (reached after round ${firstFloor}, as rv 1's square after 7)`, Math.abs(m.rounds[0].H1 - P2.H0 * P2.SHRINK) < 1e-9 && firstFloor === 7 && m.rounds.every((x) => x.H1 >= P2.H_MIN));
  const o = E.newMatch(2);
  const out = (p) => { const d = Math.sqrt(p.x * p.x + p.y * p.y); return [p.x / d * 9999, p.y / d * 9999]; };
  E.applyAims(o, 'a', 1, aimsFor(o, 'a', out)); E.applyAims(o, 'b', 1, aimsFor(o, 'b', out));
  ok('rv 2: everyone off = sudden death on the small circle', o.sd === 1 && o.H === P2.SD_H && o.pieces.length === 2 && o.pieces[0].x === -240 && o.rv === 2);
  // determinism under rv 2, pinned on purpose (change an rv 2 number = re-pin it; NEVER for rv 1)
  const FIX = [['a', 1, '300,100;-300,-100;200,0;0,200'], ['b', 1, '-200,300;200,-300;-200,-200;200,200']];
  const f = E.newMatch(2); for (const [s2, r, a2] of FIX) E.applyAims(f, s2, r, a2);
  const sum = f.pieces.reduce((t, p) => t + (p.alive ? p.x * 3 + p.y * 7 : 1000), 0);
  const twice = E.newMatch(2); for (const [s2, r, a2] of FIX) E.applyAims(twice, s2, r, a2);
  ok('rv 2: a pinned round lands where it always has, and replays to the same bits', sum === RV2_PIN && digest(f) === digest(twice), String(sum) + ' steps ' + f.rounds[0].steps);
  console.log('     rv 2 pinned sum', sum, 'steps', f.rounds[0].steps);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
