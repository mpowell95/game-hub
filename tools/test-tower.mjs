// tools/test-tower.mjs — Tower's engine rules (tower/js/engine.js) and its recorder
// (js/game-stats.js recordTower). Pure; no browser. Run: node tools/test-tower.mjs
import * as E from '../tower/js/engine.js';

let fails = 0;
const ok = (name, c) => { console.log((c ? 'PASS ' : 'FAIL ') + name); if (!c) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;

// A run starts with the base and a sliding block as wide as the base.
{
  const r = E.createRun('medium');
  ok('new run: score 0, base START_W wide', E.score(r) === 0 && r.stack[0].w === E.START_W);
  ok('first block slides in from the left, same width', r.mover.dir === 1 && r.mover.w === E.START_W);
}
// Perfect: within tolerance keeps the full width and the base x.
{
  const r = E.createRun('medium');
  r.mover.x = r.stack[0].x + 5;
  const res = E.drop(r);
  ok('perfect within 6 units on Medium', res.kind === 'perfect' && r.stack[1].w === E.START_W && r.stack[1].x === r.stack[0].x);
  ok('perfect counts streak and perfects', r.streak === 1 && r.perfects === 1);
}
// Cut: the overhang is cut, the next block is only as wide as what landed.
{
  const r = E.createRun('medium');
  const base = r.stack[0];
  r.mover.x = base.x + 60;
  const res = E.drop(r);
  ok('cut: kept width = 250 - 60', res.kind === 'cut' && near(r.stack[1].w, 190) && near(r.stack[1].x, base.x + 60));
  ok('cut piece is the right overhang, 60 wide', near(res.cut.w, 60) && near(res.cut.x, base.x + E.START_W) && res.cut.dir === 1);
  ok('next block is as wide as what landed, from the right', near(r.mover.w, 190) && r.mover.dir === -1);
  ok('a cut resets the streak', r.streak === 0);
  r.mover.x = r.stack[1].x - 30;
  const res2 = E.drop(r);
  ok('left overhang cut on the left', res2.kind === 'cut' && near(res2.cut.x, r.stack[1].x - 30) && near(res2.cut.w, 30) && near(r.stack[2].w, 160));
}
// Miss: no overlap ends the run, nothing pushed.
{
  const r = E.createRun('easy');
  r.mover.x = r.stack[0].x + E.START_W + 1;
  const res = E.drop(r);
  ok('miss ends the run, score stays 0', res.kind === 'miss' && r.over && E.score(r) === 0 && r.stack.length === 1);
  ok('no drop after the run is over', E.drop(r).kind === 'none');
}
// Never grows back (Matt, 2026-11-02): any number of perfects keeps a narrowed block's width.
{
  const r = E.createRun('easy');
  r.mover.x = r.stack[0].x + 50; E.drop(r);          // narrow to 200
  for (let i = 0; i < 12; i++) { r.mover.x = r.stack[r.stack.length - 1].x; E.drop(r); }
  ok('12 perfects in a row: the block never grows back', near(r.stack[r.stack.length - 1].w, 200) && near(r.mover.w, 200));
}
// Speed rises per block and caps; harder is faster.
// A Perfect needs the blocks to touch (2026-11-12 review): a 2-wide block, the next dropped 7.5 to the side on Easy
// (8 units of slack) is a MISS, not a Perfect.
{
  const r = E.createRun('easy');
  r.stack.push({ x: 200, w: 2 }); E.spawn(r);
  r.mover.x = 207.5;
  const res = E.drop(r);
  ok('no overlap is a miss even within the Perfect slack', res.kind === 'miss' && r.over === true);
  const r2 = E.createRun('easy');
  r2.mover.x = r2.stack[0].x + 7.5;
  ok('within the slack AND touching is still a Perfect', E.drop(r2).kind === 'perfect');
}
// A blind tap at the far end of the slide misses, even with the first, full-width block (play-test 2026-11-12).
{
  const r = E.createRun('easy');
  r.mover.x = -r.mover.w * 0.72;
  ok('a full-width block can miss at the far end', E.drop(r).kind === 'miss');
}
ok('speed rises with height', E.speedFor('medium', 10) > E.speedFor('medium', 1));
ok('no top speed: it keeps rising', E.speedFor('medium', 200) > E.speedFor('medium', 100) && E.speedFor('medium', 100) > 1000);
ok('harder difficulties are faster and tighter', E.DIFFS.every((d, i) => i === 0 || (E.TUNE[d].v0 > E.TUNE[E.DIFFS[i - 1]].v0 && E.TUNE[d].perfect < E.TUNE[E.DIFFS[i - 1]].perfect)));
// The mover stays in range on a long frame.
{
  const r = E.createRun('expert');
  for (let i = 0; i < 200; i++) E.stepMover(r, 0.05);
  ok('mover stays inside its range', r.mover.x >= -r.mover.w * 0.72 - 1e-9 && r.mover.x <= E.WORLD_W - r.mover.w * 0.28 + 1e-9);
}

// The recorder: additive counters, Math.max bests, mode recorded. A fake localStorage.
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i], get length() { return store.size; } };
  const GS = await import('../js/game-stats.js');
  GS.withMode({ look: 'city' }, 'hard', () => GS.recordTower(17, 'hard', { perfects: 5, bestStreak: 3 }), { hi: 17 });
  GS.withMode({ look: 'ice' }, 'hard', () => GS.recordTower(9, 'hard', { perfects: 2, bestStreak: 1 }), { hi: 9 });
  const g = GS.loadStats().games.tower;
  ok('recorder: two runs counted, played and won', g.tw.games === 2 && g.total.played === 2 && g.byDiff.hard.won === 2);
  ok('recorder: best is the max, blocks add', g.tw.best === 17 && g.tw.bestByDiff.hard === 17 && g.tw.blocks === 26 && g.tw.perfects === 7 && g.tw.bestStreak === 3);
  ok('recorder: the look and difficulty are recorded (byMode)', g.byMode && g.byMode['look=city'] && g.byMode['look=city'].hard.hi === 17 && g.byMode['look=ice'].hard.played === 1);
}

// Best tower shapes (2026-11-12): kept only for a best, only improving, never in the play log; merged tallest.
{
  const GS = await import('../js/game-stats.js');
  const tower = (n) => Array.from({ length: n + 1 }, (_, i) => ({ x: 75 + i * 0.4, w: 250 - i * 0.8 }));
  GS.withMode({ look: 'space' }, 'easy', () => GS.recordTower(12, 'easy', {}), { hi: 12 });
  ok('shape: kept for a new best', GS.keepTowerShape('easy', 12, tower(12), 'space') === true);
  const sh = GS.loadStats().games.tower.tw.shapes.easy;
  ok('shape: height, look, base first, rounded', sh.n === 12 && sh.l === 'space' && sh.s.split(';').length === 13 && sh.s.startsWith('75,250;'));
  GS.withMode({ look: 'city' }, 'easy', () => GS.recordTower(8, 'easy', {}), { hi: 8 });
  ok('shape: a shorter run never replaces it', GS.keepTowerShape('easy', 8, tower(8), 'city') === false && GS.loadStats().games.tower.tw.shapes.easy.n === 12);
  ok('shape: a stack of the wrong length is refused', GS.keepTowerShape('easy', 20, tower(5), 'city') === false);
  ok('shape: hard best 17 has no shape (set before shapes); a 9 is not a best', GS.keepTowerShape('hard', 9, tower(9), 'ice') === false);
  const q = JSON.parse(localStorage.getItem('gamehub.playlog.v1') || '[]');
  ok('shape: never in the play log (rows stay under 1600 chars)', q.every((r) => !r.a || r.a.length <= 1600) && !q.some((r) => r.f === 'keepTowerShape'));
  const { aggregatePlayers } = await import('../js/players-agg.js');
  const mk = (id, n) => ({ id, profile: { name: 'Zed', playerId: 'ZZZZ2' }, stats: { games: { tower: { total: { played: 1, won: 1, lost: 0 }, byDiff: {},
    tw: { games: 1, best: n, bestByDiff: { easy: n }, blocks: n, perfects: 0, bestStreak: 0, shapes: { easy: { n, s: tower(n).map((b) => Math.round(b.x) + ',' + Math.round(b.w)).join(';'), l: 'toy', t: 1 } } } } } } });
  let people = null;
  try { people = aggregatePlayers({ a: mk('a', 6), b: mk('b', 15) }); } catch (err) { console.log('aggregate threw', err); }
  const list = Array.isArray(people) ? people : (people && (people.list || Object.values(people))) || [];
  const zed = list.find((p) => p && p.games && p.games.tower);
  ok('agg: a person keeps the TALLEST shape across devices', !!zed && zed.games.tower.tw.shapes.easy.n === 15 && zed.games.tower.tw.bestByDiff.easy === 15);
}

// Release readiness (2026-11-12 review): Matt's "test plays count" needs a combiner, or loadStats would throw.
{
  const GS = await import('../js/game-stats.js');
  ok('release: Tower has a carry combiner', typeof GS.CARRY_COMBINE.tower === 'function');
  const real = { total: { played: 1, won: 1, lost: 0 }, byDiff: { hard: { played: 1, won: 1, lost: 0 } },
    tw: { games: 1, best: 5, bestByDiff: { hard: 5 }, blocks: 5, perfects: 1, bestStreak: 1, shapes: { hard: { n: 5, s: 'a', l: 'city', t: 1 } } } };
  const test = { total: { played: 2, won: 2, lost: 0 }, byDiff: { hard: { played: 2, won: 2, lost: 0 } },
    tw: { games: 2, best: 9, bestByDiff: { hard: 9, easy: 3 }, blocks: 12, perfects: 4, bestStreak: 3, shapes: { hard: { n: 9, s: 'b', l: 'toy', t: 2 } } } };
  const c = GS.combineTowerRecords(real, test);
  ok('release: counters add, bests max, taller shape kept', c.total.played === 3 && c.byDiff.hard.won === 3 && c.tw.games === 3 && c.tw.blocks === 17
    && c.tw.best === 9 && c.tw.bestByDiff.hard === 9 && c.tw.bestByDiff.easy === 3 && c.tw.bestStreak === 3 && c.tw.shapes.hard.s === 'b');
  ok('release: neither record is changed', real.tw.games === 1 && test.tw.games === 2);
  // A sliver never rounds to width 0 (it would void the whole shape).
  GS.withMode({ look: 'ice' }, 'medium', () => GS.recordTower(2, 'medium', {}), { hi: 2 });
  GS.keepTowerShape('medium', 2, [{ x: 75, w: 250 }, { x: 80.04, w: 3.26 }, { x: 81, w: 0.04 }], 'ice');
  const sm = GS.loadStats().games.tower.tw.shapes.medium.s;
  ok('shape: one decimal, a sliver kept above 0', sm === '75,250;80,3.3;81,0.1');
}

// The LOWEST run per difficulty (Matt, 2026-11-14: high, low and average for every difficulty).
{
  const GS = await import('../js/game-stats.js');
  // Runs so far in this file: hard 17, 9; easy 12, 8; medium 2.
  let lo = GS.loadStats().games.tower.tw.lowByDiff;
  ok('low: the least run per difficulty', lo.hard === 9 && lo.easy === 8 && lo.medium === 2 && !('expert' in lo));
  GS.withMode({ look: 'toy' }, 'hard', () => GS.recordTower(30, 'hard', {}), { hi: 30 });
  lo = GS.loadStats().games.tower.tw.lowByDiff;
  ok('low: a higher run never raises it', lo.hard === 9 && GS.loadStats().games.tower.tw.bestByDiff.hard === 30);
  GS.withMode({ look: 'toy' }, 'expert', () => GS.recordTower(0, 'expert', {}), { hi: 0 });
  ok('low: a 0-block run is a real low', GS.loadStats().games.tower.tw.lowByDiff.expert === 0);
  const c = GS.combineTowerRecords({ tw: { games: 1, lowByDiff: { hard: 4, easy: 0 } } }, { tw: { games: 1, lowByDiff: { hard: 2, medium: 7 } } });
  ok('low: release combine keeps the least, 0 included', c.tw.lowByDiff.hard === 2 && c.tw.lowByDiff.easy === 0 && c.tw.lowByDiff.medium === 7);
  ok('low: combine without lows adds none', !('lowByDiff' in GS.combineTowerRecords({ tw: { games: 1 } }, { tw: { games: 1 } }).tw));
  const { aggregatePlayers } = await import('../js/players-agg.js');
  const mk = (id, lows) => ({ id, profile: { name: 'Yan', playerId: 'YYYY2' }, stats: { games: { tower: { total: { played: 1, won: 1, lost: 0 }, byDiff: {},
    tw: { games: 1, best: 9, bestByDiff: { easy: 9 }, blocks: 9, perfects: 0, bestStreak: 0, ...(lows ? { lowByDiff: lows } : {}) } } } } });
  const people = aggregatePlayers({ a: mk('a', { easy: 5, hard: 0 }), b: mk('b', { easy: 3 }), c: mk('c', null) });
  const list = Array.isArray(people) ? people : (people && (people.list || Object.values(people))) || [];
  const yan = list.find((p) => p && p.games && p.games.tower && p.games.tower.tw.games === 3);
  ok('agg: a person keeps the LEAST low across devices, 0 included', !!yan && yan.games.tower.tw.lowByDiff.easy === 3 && yan.games.tower.tw.lowByDiff.hard === 0);
  const SC = await import('../js/stats-corrections.js');
  ok('TOWER_BEFORE: every low is a whole number, every pre run has a count and blocks', Object.values(SC.TOWER_BEFORE).every((e) =>
    Object.values(e.lo || {}).every((v) => Number.isInteger(v) && v >= 0) && Object.values(e.pre || {}).every((p) => p.n > 0 && p.s >= 0)));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
