// tools/sync-functions-shared.mjs - copy the app modules the Cloud Functions reuse into
// functions/shared/js/ (2026-10-22). Firebase deploys the functions/ folder only, so the server's
// leaderboard build (functions/boards.js) cannot import ../js directly. This copies players-agg.js,
// admin-config.js and hidden-players.js plus everything they statically import, byte for byte, so
// the server groups and corrects players with EXACTLY the phone's code. functions/shared/ is
// generated (git-ignored): the deploy workflow and tools/test-boards.mjs run this first.
//
//   node tools/sync-functions-shared.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'functions/shared');
const ENTRY = ['js/players-agg.js', 'js/admin-config.js', 'js/hidden-players.js', 'js/bee-fairplay.js'];

const seen = new Set();
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^import[^'"]*['"](\.[^'"]+)['"]/gm)) walk(resolve(dirname(file), m[1]));
}
for (const e of ENTRY) walk(resolve(ROOT, e));
rmSync(OUT, { recursive: true, force: true });
for (const f of seen) {
  const to = resolve(OUT, relative(ROOT, f));
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(f));
}
// Spelling Bee's puzzle map (2026-10-28, functions/bee.js): board key -> {lang, day, key, top} for
// every puzzle in both word lists, replaced ones included, so the server knows which day and language
// a beeDaily/beeLog node belongs to without loading the word lists. `top`: the 15 highest answer
// scores, high first (js/bee-fairplay.js "best words first").
{
  const E = await import('../spelling-bee/js/engine.js');
  const map = {};
  const bk = (k) => String(k).replace(/:/g, '-').replace(/ñ/g, '0');
  for (const [lang, file] of [['en', 'bee.json'], ['es', 'bee-es.json']]) {
    const d = E.parseData(JSON.parse(readFileSync(resolve(ROOT, 'spelling-bee/data', file), 'utf8')));
    for (let n = 0; n < d.puzzles.length; n++) {
      const day = E.dayKey(E.dateOfDay(d.epoch, n));
      const all = [E.puzzleAt(d, n)];
      if (d.retired && d.retired[n]) all.push(E.puzzleOf(d.retired[n], lang));
      for (const pz of all) {
        const top = E.answersFor(d, pz).map((w) => E.scoreWord(w, pz)).sort((a, b) => b - a).slice(0, 15);
        map[bk(pz.key)] = { lang, day, key: pz.key, top };
      }
    }
  }
  writeFileSync(resolve(OUT, 'bee-puzzles.json'), JSON.stringify(map));
  console.log(`functions/shared/bee-puzzles.json: ${Object.keys(map).length} puzzles`);
}
console.log(`functions/shared: ${seen.size} files (${[...seen].map((f) => relative(ROOT, f)).join(', ')})`);
