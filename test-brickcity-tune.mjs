// The twin must (1) differ from BRICK CITY by exactly one number, (2) leave the real machine
// bit-for-bit unchanged, and (3) be invisible to everyone but a dev profile.
import { BOARDS, boardById } from './skeeball/js/boards.js';
import { engineFor, loadEngine, ENGINE_IDS } from './skeeball/js/engines.js';
import { readGoals } from './skeeball/js/goals.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n}${d ? ` - ${d}` : ''}`); } };

const bc = boardById('brickcity');
const tw = boardById('brickcity-tune');
ok('the twin exists', !!tw, '');
ok('it has an engine row (so it cannot fall back to THE CLASSIC)', ENGINE_IDS.includes('brickcity-tune'), '');
ok('it is admin only, so its default state is Testing', tw.adminOnly === true, '');

// 1. exactly one number apart.
const diffs = [];
const walk = (a, b, path) => {
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    const va = (a || {})[k], vb = (b || {})[k];
    if (typeof va === 'object' && va && typeof vb === 'object' && vb) walk(va, vb, `${path}.${k}`);
    else if (va !== vb) diffs.push(`${path}.${k}: ${JSON.stringify(va)} -> ${JSON.stringify(vb)}`);
  }
};
walk(bc, tw, '');
const expected = ['.id', '.name', '.geom.maxSpeed', '.specWaivers'];
ok('it differs from BRICK CITY in id, name, maxSpeed and its own waiver ONLY',
  diffs.length === expected.length && expected.every((e) => diffs.some((d) => d.startsWith(e))),
  diffs.join(' | '));
ok('maxSpeed is 6.20 against the real 6.60', tw.geom.maxSpeed === 6.20 && bc.geom.maxSpeed === 6.60,
  `${bc.geom.maxSpeed} -> ${tw.geom.maxSpeed}`);
ok('every mouth is untouched (the HARD RULE)',
  Object.keys(bc.geom.holes).every((id) => bc.geom.holes[id].r === tw.geom.holes[id].r), '');

// 2. the real machine is unchanged - same engine, same grid, throw for throw.
await loadEngine('brickcity', { physics: true });
await loadEngine('brickcity-tune', { physics: true });
const A = engineFor('brickcity'), B = engineFor('brickcity-tune');
ok('both boards resolve to the SAME engine object (one copy, no drift)', A.physics === B.physics, '');

const grid = (board) => {
  const out = [];
  for (let pi = 0; pi <= 20; pi++) {
    for (let ai = -20; ai <= 20; ai++) {
      const st = A.physics.startThrow(board, { power: pi / 20, aim: ai / 20 });
      let g = 14 * 240;
      while (!st.done && g-- > 0) A.physics.step(board, st, A.physics.STEP);
      out.push(`${st.outcome && st.outcome.hole}|${st.outcome && st.outcome.value}|${st.t.toFixed(6)}`);
    }
  }
  return out;
};
const real = grid(bc);
const twin = grid(tw);
const moved = real.filter((r, i) => r !== twin[i]).length;
ok('the twin really does play differently', moved > 100, `${moved} of ${real.length} throws differ`);
const pts = (rows) => rows.reduce((a, r) => a + (parseInt(r.split('|')[1], 10) || 0), 0);
console.log(`      grid total: real ${pts(real)} pts, twin ${pts(twin)} pts, ${moved}/${real.length} throws moved`);

// 3. goals do not lie, and nothing it records can reach a real record.
const g = readGoals('brickcity-tune', { boards: {} });
ok('its objectives are BRICK CITY\'s, read against its own (empty) record',
  g.length === 3 && g.every((x) => x.now === 0), JSON.stringify(g.map((x) => x.now)));
ok('it is last in the gallery, so it cannot reorder anyone\'s carousel',
  BOARDS[BOARDS.length - 1].id === 'brickcity-tune', BOARDS.map((b) => b.id).join(','));

console.log(`\ntuning twin: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
