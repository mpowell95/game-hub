// validate-sw-assets.mjs - fails if the root sw.js's ASSETS precache list references a path that
// doesn't exist on disk (ARCH-REVIEW.md S4-5/S5-4/S6-day: `cache.addAll` is atomic, so ONE 404'd
// path silently kills the new worker's install and offline serves the previous build forever,
// with no visible symptom besides the version pill never advancing). Also warns (non-fatal) about
// deployed .js/.css/.html files that AREN'T in ASSETS, so a future addition isn't forgotten the
// way connect-four/index.html was.
//
// Run: node validate-sw-assets.mjs

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, relative } from 'node:path';

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
  'connect-four', 'chinchon', 'escoba', 'filler', 'mancala', 'nuts-bolts', 'ball-run',
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

process.exit(offenders.length ? 1 : 0);
