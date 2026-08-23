// validate-sw-assets.mjs - fails if the root sw.js's ASSETS precache list references a path that
// doesn't exist on disk (ARCH-REVIEW.md S4-5/S5-4/S6-day: `cache.addAll` is atomic, so ONE 404'd
// path silently kills the new worker's install and offline serves the previous build forever,
// with no visible symptom besides the version pill never advancing). Also warns (non-fatal) about
// deployed .js/.css/.html files that AREN'T in ASSETS, so a future addition isn't forgotten the
// way connect-four/index.html was.
//
// Since 2026-08-23 it ALSO maintains sw.js's REST_MANIFEST block: the content hash per REST-tier
// file that lets warmRest() carry unchanged files across a CACHE bump instead of re-downloading
// the whole ~11 MB tier on every deploy (GitHub Pages re-stamps every mtime/ETag per deploy, so
// only a content hash can prove "unchanged"). A stale manifest is REWRITTEN in place here - this
// script already runs before every deploy, so keeping it fresh is not a new step - and
// test-sw-strategy.mjs fails loudly if a stale one is ever about to ship anyway.
//
// Run: node validate-sw-assets.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, relative } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SW_PATH = join(ROOT, 'sw.js');

// --- 1. Extract the real, fully-computed ASSETS list from sw.js -------------------------------
// The Chinchón deck entries are appended by `for` loops, not written out by hand (see sw.js), so
// a plain string-literal scrape of the whole file would miss them, and hand-transcribing those
// loops here would silently drift the moment someone edits the real ones. Instead, pull the exact
// source slice that BUILDS the array - the literal plus its loops - and execute it for real. That
// slice is pure array/string code with no `self`/DOM/network reference until
// `self.addEventListener('install', ...)`, so running it standalone in Node is safe and it can
// never drift from what the worker itself actually precaches.
const swSrc = readFileSync(SW_PATH, 'utf8');

const cacheMatch = /const CACHE = '([^']+)'/.exec(swSrc);
if (!cacheMatch) {
  console.log('FAIL: could not find `const CACHE = \'...\'` in sw.js (marker moved?)');
  process.exit(1);
}
const CACHE = cacheMatch[1];

const startMarker = 'const ASSETS = [';
const endMarker = "self.addEventListener('install'";
const startIdx = swSrc.indexOf(startMarker);
const endIdx = swSrc.indexOf(endMarker);
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.log('FAIL: could not locate the ASSETS-build section in sw.js (markers moved?)');
  process.exit(1);
}
const buildSrc = swSrc.slice(startIdx, endIdx);
let ASSETS;
try {
  ASSETS = new Function(`${buildSrc}\nreturn ASSETS;`)();
} catch (err) {
  console.log('FAIL: could not execute the extracted ASSETS-build section:', err.message);
  process.exit(1);
}
if (!Array.isArray(ASSETS) || !ASSETS.length) {
  console.log('FAIL: extracted ASSETS is not a non-empty array');
  process.exit(1);
}

// A './' or './dir/' entry precaches the directory's index.html (mirrors server.mjs's own
// trailing-slash -> index.html resolution, and how the fetch handler actually serves it).
function resolveAssetPath(entry) {
  let rel = entry.replace(/^\.\//, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  return rel;
}

// --- 2. Every precached path must exist on disk ------------------------------------------------
const offenders = [];
for (const entry of ASSETS) {
  const rel = resolveAssetPath(entry);
  const abs = join(ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) offenders.push(entry);
}

console.log(`sw.js: ${CACHE}, ${ASSETS.length} precached entries`);

if (offenders.length) {
  console.log(`\nFAIL: ${offenders.length} ASSETS entr${offenders.length === 1 ? 'y' : 'ies'} missing on disk:`);
  for (const o of offenders) console.log('  ' + o);
} else {
  console.log('ok   every ASSETS entry exists on disk');
}

// --- 3. Warn (non-fatal) about deployed source files NOT in ASSETS -----------------------------
// Scope: the game modules + shared js/ that the ROOT service worker is responsible for. Business
// Deal is excluded entirely - it ships its OWN nested service worker with its own ASSETS list
// (business-deal/sw.js), by design (CLAUDE.md: "launch-out... its own nested service worker, not
// ESM. A precedent, not the preferred pattern."). Parchís is a compiled single-file build from the
// sibling ../Parchís/ repo; only its index.html lives in this repo and is already precached.
const SCAN_DIRS = [
  'connect-four', 'chinchon', 'escoba', 'filler', 'mancala', 'nuts-bolts', 'ball-run', 'tic-tac-toe',
  'js', 'profile', 'css',
];
const SCAN_EXT = new Set(['.js', '.css', '.html']);

// Deliberate exclusions, transcribed from the comments already in this repo (not re-invented
// here - see the cited source of each):
const EXCLUDED = [
  // Every game's headless engine test/sim runner is node-only and explicitly "not
  // deployed/precached" (escoba/js/test.js and chinchon/js/sim.js say so in their own header
  // comments; connect-four/js/test.js and nuts-bolts/js/test.js follow the identical
  // `node js/test.js` convention).
  { re: /(^|\/)js\/test\.js$/, why: "headless engine test (node-only, not deployed) - e.g. escoba/js/test.js's own header comment" },
  { re: /(^|\/)js\/sim\.js$/, why: "headless match simulation (node-only, not deployed) - e.g. chinchon/js/sim.js's own header comment" },
  // "Reference screenshots in mancala/reference/ (gitignored)" - CLAUDE.md, Mancala row.
  { re: /^mancala\/reference\//, why: 'design reference screenshots, gitignored - CLAUDE.md Mancala row' },
];
function excludedWhy(relPath) {
  const hit = EXCLUDED.find((x) => x.re.test(relPath));
  return hit ? hit.why : null;
}

const assetSet = new Set(ASSETS.map((e) => resolveAssetPath(e)));

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (SCAN_EXT.has(extname(name))) out.push(abs);
  }
}

const missingFromAssets = [];
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d);
  if (!existsSync(abs)) continue;
  const files = [];
  walk(abs, files);
  for (const f of files) {
    const rel = relative(ROOT, f).split('\\').join('/'); // normalize on Windows
    if (excludedWhy(rel)) continue;
    if (!assetSet.has(rel)) missingFromAssets.push(rel);
  }
}

if (missingFromAssets.length) {
  console.log(`\nWARN: ${missingFromAssets.length} deployed file(s) not in ASSETS (won't be cached offline):`);
  for (const m of missingFromAssets) console.log('  ' + m);
} else {
  console.log('ok   every scanned .js/.css/.html file is in ASSETS (or a documented exclusion)');
}

// --- 4. The REST content manifest: verify against disk, rewrite in place when stale ------------
// The same executed-slice trick as step 1 gives the real SHELL/REST split (isShellAsset and the
// two filters are inside the slice), so this can never disagree with the worker about which tier
// a path is in.
let manifestFailed = false;
{
  const { REST } = new Function(`${buildSrc}\nreturn { SHELL, REST };`)();
  const expected = {};
  for (const entry of REST) {
    const rel = resolveAssetPath(entry);
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue; // already reported as an offender in step 2
    expected[entry] = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 10);
  }
  const START = '// __REST_MANIFEST_START__';
  const END = '// __REST_MANIFEST_END__';
  const a = swSrc.indexOf(START);
  const b = swSrc.indexOf(END);
  if (a < 0 || b < 0 || b <= a) {
    console.log('\nFAIL: could not locate the REST_MANIFEST markers in sw.js (markers moved?)');
    manifestFailed = true;
  } else {
    let current = {};
    try {
      const block = swSrc.slice(a, b);
      current = new Function(`${block.split('\n').filter((l) => !l.startsWith('//')).join('\n')}\nreturn REST_MANIFEST;`)();
    } catch { /* unparseable block: treat as fully stale and rewrite */ }
    const changed = REST.filter((p) => current[p] !== expected[p]);
    const removed = Object.keys(current).filter((p) => !(p in expected));
    if (changed.length || removed.length) {
      const lines = REST.filter((p) => p in expected).map((p) => `  '${p}': '${expected[p]}',`);
      const block = `${START}\nconst REST_MANIFEST = {\n${lines.join('\n')}\n};\n${END}`;
      writeFileSync(SW_PATH, swSrc.slice(0, a) + block + swSrc.slice(b + END.length));
      console.log(`\nok   REST_MANIFEST rewritten: ${changed.length} added/changed, ${removed.length} removed - commit sw.js`);
    } else {
      console.log('ok   REST_MANIFEST matches the bytes on disk');
    }
  }
}

process.exit(offenders.length || manifestFailed ? 1 : 0);
