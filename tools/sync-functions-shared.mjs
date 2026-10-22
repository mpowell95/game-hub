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
const ENTRY = ['js/players-agg.js', 'js/admin-config.js', 'js/hidden-players.js'];

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
console.log(`functions/shared: ${seen.size} files (${[...seen].map((f) => relative(ROOT, f)).join(', ')})`);
