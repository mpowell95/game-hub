// test-lb-rules.mjs - js/lb-rules.js (Leaderboard v2's per-game (i) sheet, Matt's 12, 2026-11-02) against the code.
//   1. Every board game (js/leaderboard-ui.js GAME_META) has an entry, with a "Ranked by" line in EN and ES.
//   2. Every "Counts as" row is what the GAME records: each game's own statsDiff / soloDiff is called for every
//      difficulty on its ladder with a shortened match (one step down) and a standard one (unchanged).
//   3. A game whose own code takes a shortened match or a table of computers down a level HAS that entry
//      (a scan for oneTierDown / easiestDiff / parchisStatsDiff), so a new rule cannot ship without its line.
//   node tools/test-lb-rules.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(path.join(ROOT, p));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); } };

const { LB_RULES, rulesFor } = await imp('js/lb-rules.js');
const { oneTierDown } = await imp('js/game-stats.js');
const LB2 = (await imp('js/leaderboard2-strings.js')).default;

// 1. Every GAME_META id (read from the source: the module needs a browser).
const src = fs.readFileSync(path.join(ROOT, 'js/leaderboard-ui.js'), 'utf8');
const meta = src.slice(src.indexOf('const GAME_META = ['), src.indexOf('];', src.indexOf('const GAME_META = [')));
const ids = [...meta.matchAll(/\{ id: '([a-z0-9]+)'/g)].map((m) => m[1]);
ok('GAME_META parsed', ids.length > 30, ids.length);
for (const id of ids) {
  ok(`${id}: has a rule`, !!LB_RULES[id]);
  const r = rulesFor(id);
  if (!r) continue;
  for (const lang of ['en', 'es']) {
    ok(`${id}: "Ranked by" line (${lang})`, typeof LB2[lang]['lb2_rb_' + r.by] === 'string' && LB2[lang]['lb2_rb_' + r.by].length > 3, r.by);
    for (const c of r.counts) ok(`${id}: "Counts as" heading ${c.when} (${lang})`, typeof LB2[lang]['lb2_ca_' + c.when] === 'string', c.when);
  }
}
for (const id of Object.keys(LB_RULES)) ok(`${id}: a board game`, ids.includes(id));

// 2. The rows against each game's own record-time code.
const check = (id, f, shortArgs, stdArgs) => {
  const lad = LB_RULES[id].short.ladder;
  for (const d of lad) {
    for (const a of shortArgs) ok(`${id}: ${d} shortened (${a}) counts one down`, f(d, a) === oneTierDown(d, lad), [d, a, f(d, a)]);
    for (const a of stdArgs) ok(`${id}: ${d} standard (${a}) counts as itself`, f(d, a) === d, [d, a, f(d, a)]);
  }
  ok(`${id}: shows rows`, rulesFor(id).counts.some((c) => c.when === LB_RULES[id].short.when && c.rows.length));
};
check('flicksoccer', (await imp('flick-soccer/js/ui.js')).statsDiff, [1], [2, 3]);
check('eightball', (await imp('eight-ball/js/ui.js')).statsDiff, [1], [2, 3]);
check('darts', (await imp('darts/js/ui.js')).statsDiff, ['201', '101'], ['301', 'cricket']);
check('cuppong', (await imp('cup-pong/js/ui.js')).statsDiff, ['inf'], [0, 1, 2, 3]);
check('boggle', (await imp('boggle/js/ui.js')).statsDiff, [2], [1, 1.5]);
check('dominoes', (await imp('dominoes/js/ui.js')).statsDiff, [150], [300, 500]);
{
  const { soloDiff } = await imp('chinchon/js/ui.js');
  const one = (d) => [{ isHuman: true }, { isHuman: false, difficulty: d }];
  check('chinchon', (d, cfg) => soloDiff(one(d), cfg), [{ scoreLimit: 50 }, { victoryCondition: 'rounds', roundsLimit: 1 }], [{}, { scoreLimit: 100 }]);
  ok('chinchon: a table counts at the easiest computer', soloDiff([{ isHuman: true }, { difficulty: 'hard' }, { difficulty: 'easy' }], {}) === 'easy');
}

// 3. Every game whose code moves a result down a level has its entry.
const scan = { flicksoccer: 'flick-soccer/js/ui.js', eightball: 'eight-ball/js/ui.js', darts: 'darts/js/ui.js', cuppong: 'cup-pong/js/ui.js',
  boggle: 'boggle/js/ui.js', dominoes: 'dominoes/js/ui.js', chinchon: 'chinchon/js/ui.js', escoba: 'escoba/js/ui.js', hoops4: 'hoops4/js/ui.js' };
// Hoops' statsDiff is a method (needs the screen); its rule: one shot = as chosen, until you score = one down.
ok('hoops4: shows rows', rulesFor('hoops4').counts.some((c) => c.when === 'hoops4' && c.rows.length));
for (const [id, f] of Object.entries(scan)) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/oneTierDown\(/.test(s.replace(/import[^;]*;/g, ''))) ok(`${id}: shortened rule listed`, !!LB_RULES[id].short);
  if (/easiestDiff\(/.test(s.replace(/import[^;]*;/g, ''))) ok(`${id}: table rule listed`, !!LB_RULES[id].table);
}
ok('parchis: table rule listed', /parchisStatsDiff/.test(fs.readFileSync(path.join(ROOT, 'parchis/index.html'), 'utf8')) && !!LB_RULES.parchis.table);
// No other game's folder uses either helper without an entry.
for (const d of fs.readdirSync(ROOT)) {
  const f = path.join(ROOT, d, 'js', 'ui.js');
  if (!fs.existsSync(f) || Object.values(scan).includes(`${d}/js/ui.js`)) continue;
  const s = fs.readFileSync(f, 'utf8').replace(/import[^;]*;/g, '');
  ok(`${d}: no unlisted oneTierDown / easiestDiff`, !/oneTierDown\(|easiestDiff\(/.test(s), d);
}

console.log(`\nlb-rules tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
