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
// Grow back: 5 perfects in a row grow a narrowed block by GROW, never past START_W.
{
  const r = E.createRun('easy');
  r.mover.x = r.stack[0].x + 50; E.drop(r);          // narrow to 200
  let grew = false;
  for (let i = 0; i < 5; i++) { r.mover.x = r.stack[r.stack.length - 1].x; grew = E.drop(r).grew || grew; }
  ok('5 perfects in a row grow the block by GROW', grew && near(r.stack[r.stack.length - 1].w, 200 + E.GROW));
  const r2 = E.createRun('easy');
  for (let i = 0; i < 5; i++) { r2.mover.x = r2.stack[r2.stack.length - 1].x; E.drop(r2); }
  ok('a full-width block never grows past START_W', r2.stack[r2.stack.length - 1].w === E.START_W);
}
// Speed rises per block and caps; harder is faster.
ok('speed rises with height', E.speedFor('medium', 10) > E.speedFor('medium', 1));
ok('no top speed: it keeps rising', E.speedFor('medium', 200) > E.speedFor('medium', 100) && E.speedFor('medium', 100) > 1000);
ok('harder difficulties are faster and tighter', E.DIFFS.every((d, i) => i === 0 || (E.TUNE[d].v0 > E.TUNE[E.DIFFS[i - 1]].v0 && E.TUNE[d].perfect < E.TUNE[E.DIFFS[i - 1]].perfect)));
// The mover stays in range on a long frame.
{
  const r = E.createRun('expert');
  for (let i = 0; i < 200; i++) E.stepMover(r, 0.05);
  ok('mover stays inside its range', r.mover.x >= -r.mover.w * 0.6 - 1e-9 && r.mover.x <= E.WORLD_W - r.mover.w * 0.4 + 1e-9);
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

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
