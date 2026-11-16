// Monopoly Deal: the stronger table computers (cv 2, 2026-11-16) are gated, and the old computer is untouched.
//   node tools/test-bd-table-ai.mjs            the checks
//   node tools/test-bd-table-ai.mjs --golden   print the golden hash for the ai.js on disk (no cv)
// 1. Without cv, seeded games (1-4 computers, every level) play move for move as the pre-2026-11-16 ai.js
//    (GOLDEN: the hash of every engine log line, taken from that file).
// 2. cv 2 with ONE computer plays exactly as without cv.
// 3. cv 2 with 2-4 computers plays differently, and every game still ends with all 106 cards.
// 4. ui.js: the gate constant is false, newAI() reads the admin device key, a result carries cv: 2 only
//    with the new computers at 2+ computers, and a save keeps cv.
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AI = require(join(ROOT, 'business-deal/js/ai.js'));
const GM = require(join(ROOT, 'business-deal/js/game.js'));

const GOLDEN = '6fda97c4ba15a613b5f10e61db098bd2683ec60aa23a2ec27c5327c594b27809';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok   ' + m); } else { fail++; console.log('FAIL ' + m); } };

async function play(diff, n, seed, cv) {
  const rng = GM.mulberry32(seed);
  const players = [];
  for (let i = 0; i <= n; i++) {
    const o = { rng, difficulty: i === 0 ? 'hard' : diff };
    if (cv && i > 0) o.cv = cv;
    players.push({ name: 'P' + i, agent: new AI.AIAgent(o) });
  }
  const g = new GM.Game({ rng, verbose: false, players });
  g.setup();
  let t = 0;
  while (!g.winner && t < 1500) { await g.playTurn(); t++; }
  const ids = new Set();
  const add = a => a.forEach(c => ids.add(c.id));
  for (const p of g.players) {
    add(p.hand); add(p.bank);
    for (const col of Object.keys(p.properties)) { const gr = p.properties[col]; add(gr.cards); if (gr.house) ids.add(gr.house.id); if (gr.hotel) ids.add(gr.hotel.id); }
  }
  add(g.deck); add(g.discard);
  return { log: g.logs.join('\n'), winner: g.winner ? g.winner.id : -1, cards: ids.size };
}

async function oldHash() {
  const h = createHash('sha256');
  for (const d of ['easy', 'normal', 'hard']) for (let n = 1; n <= 4; n++) for (let s = 1; s <= 15; s++) {
    h.update((await play(d, n, s * 4099 + n * 31 + d.length)).log);
  }
  return h.digest('hex');
}

if (process.argv.includes('--golden')) { console.log(await oldHash()); process.exit(0); }

ok(await oldHash() === GOLDEN, 'no cv: 180 seeded games play move for move as the old computer');

let same = true;
for (const d of ['easy', 'normal', 'hard']) for (let s = 1; s <= 20; s++) {
  if ((await play(d, 1, s * 7 + 1)).log !== (await play(d, 1, s * 7 + 1, 2)).log) same = false;
}
ok(same, 'cv 2 with one computer = the old computer (60 games)');

let differ = 0, whole = true, ended = true;
for (const d of ['easy', 'normal', 'hard']) for (let n = 2; n <= 4; n++) for (let s = 1; s <= 10; s++) {
  const a = await play(d, n, s * 13 + n), b = await play(d, n, s * 13 + n, 2);
  if (a.log !== b.log) differ++;
  if (b.cards !== 106) whole = false;
  if (b.winner < 0) ended = false;
}
ok(differ >= 80, `cv 2 with 2-4 computers plays differently (${differ} of 90 games)`);
ok(whole && ended, 'cv 2 games end with a winner and all 106 cards');

// The winning-move guard still holds for cv 2 (business-deal/CLAUDE.md, "The AI declined to win").
let declined = 0;
for (const d of ['easy', 'normal', 'hard']) for (let s = 1; s <= 30; s++) {
  const rng = GM.mulberry32(s * 17 + 3);
  const probe = new AI.AIAgent({ difficulty: d, rng, cv: 2 });
  const orig = probe.chooseMove.bind(probe);
  probe.chooseMove = (v, l) => {
    let top = 0;
    for (const m of l) if (m.type !== 'pass') { const sc = probe.scoreMove(v, m); if (sc > top) top = sc; }
    const out = orig(v, l);
    if (top >= probe.tiers.WIN && (out.type === 'pass' || probe.scoreMove(v, out) < probe.tiers.WIN)) declined++;
    return out;
  };
  const players = [{ name: 'P0', agent: probe }];
  for (let i = 1; i <= 3; i++) players.push({ name: 'P' + i, agent: new AI.AIAgent({ difficulty: 'hard', rng, cv: 2 }) });
  const g = new GM.Game({ rng, verbose: false, players });
  g.setup();
  let t = 0;
  while (!g.winner && t < 1500) { await g.playTurn(); t++; }
}
ok(declined === 0, `cv 2 never declines an available winning move (${declined})`);

const ui = readFileSync(join(ROOT, 'business-deal/js/ui.js'), 'utf8');
ok(/const NEW_AI_RELEASED = false;/.test(ui), 'ui.js: NEW_AI_RELEASED is false (admin devices only)');
ok(/localStorage\.getItem\('gamehub\.adminDevice\.v1'\) === '1'/.test(ui), "ui.js: newAI() reads 'gamehub.adminDevice.v1'");
ok(/if \(this\._cv === 2 && m\.ai >= 2\) m\.cv = 2;/.test(ui), 'ui.js: the result mode carries cv: 2 only with the new computers at 2+ computers');
ok(/if \(this\._cv === 2\) data\.cv = 2;/.test(ui) && /save\.cv === 2 \? 2 : 0/.test(ui), 'ui.js: a save keeps cv and resumes with it');
ok(/cv: 2 \}\s*:\s*\{ name: nm, difficulty: this\.difficulty \}/.test(ui), 'ui.js: without the gate the computer is built exactly as before');

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
process.exit(fail ? 1 : 0);
