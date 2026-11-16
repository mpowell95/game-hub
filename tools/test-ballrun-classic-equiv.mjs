// tools/test-ballrun-classic-equiv.mjs - Ball Run: Orbital Hard scored like Classic Hard on Matt's admin
// device only (2026-11-16, Matt: "for admin, on ball run orbital on hard, make it so it awards the same
// points as classic"). ball-run/js/ui.js classicScoringOn + ClassicEquiv. Tests never use Matt's name or code.
//   node tools/test-ballrun-classic-equiv.mjs
import { readFileSync } from 'node:fs';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document = undefined;
const { Sim } = await import('../ball-run/js/sim.js');
const { Track } = await import('../ball-run/js/track.js');
const UI = await import('../ball-run/js/ui.js');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('ok   ', n); } else { fail++; console.log('FAIL ', n, x); } };

// 1. The equivalent = every Classic Hard obstacle row (same seed) whose far edge is behind z.
for (const seed of [11, 777, 4242]) {
  const eq = new UI.ClassicEquiv(seed);
  const ref = new Track('classic', 'hard', seed); ref.ensureAhead(3100);
  for (const z of [0, 250, 900, 1800, 3000]) {
    const want = ref.segments.filter((s) => s.type === 'obstacle' && s.z1 <= z).length;
    const got = eq.at(z);
    ok(`seed ${seed}: ${z} m = ${want} Classic rows`, got === want, `got ${got}`);
  }
}

// 2. Over many runs it pays like Classic, more than Orbital's own points.
let classic = 0, orbital = 0;
for (let s = 1; s <= 25; s++) {
  const sim = new Sim('orbital', 'hard', s * 7919); sim.lives = 1e9;
  const eq = new UI.ClassicEquiv(s * 7919);
  for (let i = 0; i < 120 * 40 && !sim.isOver(); i++) { sim.step(0, 0); if (sim.lives < 5) sim.lives = 1e9; }
  classic += eq.at(sim.z); orbital += sim.score;
}
ok(`40 s runs: Classic equivalent (${classic}) beats Orbital's own points (${orbital})`, classic > orbital);

// 3. The gate: Orbital Hard only, and only on an admin device with the admin's name.
localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', playerId: 'DREG5' }));
localStorage.setItem('gamehub.adminDevice.v1', '1');
ok('off for a non-admin name on an admin device', UI.classicScoringOn('orbital', 'hard') === false);
ok('off on Classic, and on Orbital Easy/Medium, whoever plays', ['easy', 'medium'].every((d) => !UI.classicScoringOn('orbital', d)) && !UI.classicScoringOn('classic', 'hard'));
const src = readFileSync(new URL('../ball-run/js/ui.js', import.meta.url), 'utf8');
ok('gate = admin device AND admin name (as Darts aim help)', /isAdminDevice\(\) && !!\(p && p\.name && isAdmin\(p\.name\)\)/.test(src));
ok('HUD and game over both use scoreNow; the raw Orbital score goes to the private log', (src.match(/const score = this\.scoreNow\(\);/g) || []).length === 2 && /detail\.raw = this\.sim\.score/.test(src));
ok('frozen at the crash', /if \(!sim\.crashReason\) this\._eqVal = this\._eq\.at\(sim\.z\)/.test(src));

console.log(`\nBall Run classic-equivalent tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
