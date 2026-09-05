// test-brickcity-basket-lie.mjs - MATT'S RULE, made measurable:
//   "If a ball goes in, it must look like it goes in. If a ball didn't go in, it must not look
//    like it did."   (2026-09-05, after three clips of the corner 100)
//
// [KNOWN-BUG PROBE] The ball is DRAWN at its physics position (render.js's render() sets
// m.position from st.ball.position, with no hiding), so where the ball LOOKS is not a matter of
// opinion - it is the physics position against the DRAWN basket. And those two disagreed: the
// drawn basket tapered to 58% of its rim while machine.js built a straight tube at full width, so
// a ball perfectly inside the real basket was drawn up to 2.1 cm OUTSIDE the net it was falling
// through. That is what Matt filmed, and it is why it happened both on shots that scored and on
// shots that did not - it never had anything to do with scoring.
//
// The fix is one shape: machine.js's basketProfile() is read by the collar, by the throat and by
// render.js's _wireBasket, so the wall you see IS the wall the ball hits. The taper is clamped by
// the ball's own width, because a net that closes tighter than the ball is a net the ball cannot
// pass - on this face the clamp binds everywhere except the -20s.
//
// This measures the LIE directly: at every step a ball spends inside a basket's height, how far
// outside that basket's drawn wall is it? Run:  node test-brickcity-basket-lie.mjs   (~3 min)
import { boardById } from './skeeball/js/boards.js';
import { engineFor, loadEngine } from './skeeball/js/engines.js';
import { basketProfile } from './skeeball/js/machines/brickcity/machine.js';

const BOARD = 'brickcity';
await loadEngine(BOARD, { physics: true });
const { physics: P, buildMachine } = engineFor(BOARD);
const board = boardById(BOARD);
const G = board.geom;
const M = buildMachine(G);
const H = P.STEP;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log(`ok    ${n}`); } else { fail++; console.log(`FAIL  ${n}${d ? ` - ${d}` : ''}`); } };

const IDS = Object.keys(G.holes).filter((id) => G.holes[id].collarH > 0);
const NET = {};
for (const id of IDS) NET[id] = { ...basketProfile(G, G.holes[id]), fr: M.frameAt(G.holes[id].v), def: G.holes[id] };

// The drawn net's radius at height h: rTop at the rim, rBot at the face, rBot below it.
const netAt = (n, h) => {
  const t = Math.max(0, Math.min(1, h / (n.def.collarH || 1e-6)));
  return n.rBot + (n.rTop - n.rBot) * t;
};

let worst = 0, worstAt = null, samples = 0, outside = 0;
const perHole = {};
for (let pi = 0; pi <= 20; pi++) {
  for (let ai = -20; ai <= 20; ai++) {
    const st = P.startThrow(board, { power: pi / 20, aim: ai / 20 });
    let guard = 14 * 240;
    while (!st.done && guard-- > 0) {
      P.step(board, st, H);
      const p = st.ball.position;
      // ONLY the basket that actually HAS the ball. A ball resting on the tread beside a basket
      // is not "outside the basket it is inside" - it is outside a basket it never entered, which
      // is just a ball on a shelf. The case Matt filmed is a ball that WENT IN and was then drawn
      // leaving through the side, so the captured hole is the only one this question is about.
      if (!st.captured) continue;
      for (const id of [st.captured]) {
        const n = NET[id];
        if (!n) continue;
        const f = M.worldToFaceIn(n.fr, p);
        // Only while the ball is at a height where this basket is DRAWN.
        if (f.h > n.def.collarH || f.h < -G.ballR) continue;
        const d = Math.hypot(f.u - n.def.u, f.v - n.def.v);
        if (d > n.rTop + G.ballR) continue;           // nowhere near this basket
        samples++;
        // How far is the ball's CENTRE outside the wire it is being drawn against?
        const past = d - netAt(n, f.h);
        if (past > 0) {
          outside++;
          perHole[id] = Math.max(perHole[id] || 0, past);
          if (past > worst) { worst = past; worstAt = { id, power: pi / 20, aim: ai / 20, h: f.h }; }
        }
      }
    }
  }
}

console.log(`\n${samples} samples of a ball inside a basket's drawn height.`);
console.log(`  ${outside} of them had the ball's centre outside that basket's drawn wall.`);
console.log(`  worst overhang ${(worst * 100).toFixed(2)} cm`
  + (worstAt ? ` (${worstAt.id}, power ${worstAt.power.toFixed(2)}, aim ${worstAt.aim.toFixed(2)})` : ''));
for (const id of Object.keys(perHole)) console.log(`    ${id}: ${(perHole[id] * 100).toFixed(2)} cm`);

// The ball is 5.45 cm in radius, so its CENTRE being a few mm past the wire still draws as a ball
// sitting in the net's mouth. What the old build did was 2.1 cm, which draws as a ball beside it.
ok('a ball is never drawn more than 5 mm outside the basket it is inside', worst < 0.005,
  `worst ${(worst * 100).toFixed(2)} cm`);

// STRUCTURAL: one profile, read by all three.
import { readFileSync } from 'node:fs';
const mach = readFileSync(new URL('./skeeball/js/machines/brickcity/machine.js', import.meta.url), 'utf8');
const rend = readFileSync(new URL('./skeeball/js/machines/brickcity/render.js', import.meta.url), 'utf8');
const phys = readFileSync(new URL('./skeeball/js/machines/brickcity/physics.js', import.meta.url), 'utf8');
ok('machine: the profile is exported and clamped by the ball\'s width',
  /export function basketProfile/.test(mach) && /G\.ballR \* 1\.05 \+ G\.collarThick \/ 2/.test(mach), '');
ok('machine: the collar and the throat both read it',
  (mach.match(/basketProfile\(G, H\)/g) || []).length >= 2, '');
ok('render: the net reads the SAME profile, not its own taper',
  /basketProfile/.test(rend) && !/const Rbot = R \* 0\.58/.test(rend), '');
ok('physics: a leaning wall is actually built (a funnel, not a tube)',
  /s\.faceRot\.lean/.test(phys), '');
ok('every basket still lets the ball through', IDS.every((id) => NET[id].rBot >= G.ballR + G.collarThick / 2),
  IDS.filter((id) => NET[id].rBot < G.ballR + G.collarThick / 2).join(','));

console.log(`\nBRICK CITY basket-lie probe: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
