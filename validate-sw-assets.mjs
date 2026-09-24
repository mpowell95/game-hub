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
// EVERY GAME FOLDER, DISCOVERED FROM DISK - not a hand-written list (2026-09-22).
//
// It WAS a hand-written list, and it was thirteen entries written when there were thirteen things
// worth scanning. Everything added since - skeeball, boggle, baseball, yahtzee, hoops4 and the
// rest - was never scanned at all, so "every scanned file is in ASSETS" passed while saying
// nothing about most of the repo. Found the honest way: `hoops4/js/alert.js` shipped as a new
// file that js/hub.js imports on every launcher paint, was missing from ASSETS, and this script
// printed ok. A precache list with a hole in it is an offline launcher with a hole in it.
//
// Measured when this changed: across the WHOLE repo exactly 14 files were outside ASSETS, and
// all 14 are the four documented exclusions below. So widening the scan cost nothing and closed
// the gap - it is not a list anybody has to remember to extend again.
const SCAN_SKIP = new Set([
  'node_modules', 'backups', 'reference', 'docs', 'icons', '.visual-out', '.claude', '.github',
  // The Firebase Cloud Function (push notifications). Server code, deployed to Firebase, never
  // served to a phone - so never precached.
  'functions',
]);
const SCAN_DIRS = readdirSync('.', { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SCAN_SKIP.has(e.name))
  .map((e) => e.name);
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
  { re: /^hole-editor\//, why: 'Matt-only desktop design tool, never deployed - HANDOFF-GOLF-HOLE-EDITOR.md' },
  // Monopoly Deal is a LAUNCH-OUT game with its OWN nested service worker (root CLAUDE.md, the
  // games table) - its files are precached by that worker, not by this one.
  { re: /^business-deal\//, why: "launch-out game with its own nested service worker - root CLAUDE.md's games table" },
  // Design tools and mockups: opened by hand on a desktop, never reachable from the app.
  { re: /^pinball\/design\//, why: 'design tool, opened by hand, never linked from the app' },
  { re: /\/mockup-[^/]+\.html$/, why: 'a mockup, opened by hand, never linked from the app' },
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

let missingFailed = false;
if (missingFromAssets.length) {
  // A FAILURE, NOT A WARNING (2026-09-22). It was a warning with exit 0 for as long as this file
  // has existed, and a warning in a pre-deploy gate is a line of text nobody reads: `hoops4/js/
  // alert.js` shipped missing from ASSETS while this script printed WARN and exited clean.
  //
  // WHAT A MISSING ENTRY ACTUALLY COSTS, corrected the same day by Matt, who was right: the first
  // version of this comment said "the OFFLINE app", and for that particular file that was the
  // wrong headline - a turn-by-turn challenge needs the network anyway, so its alert module being
  // unreachable offline costs nothing that was not already gone. Matt: "This is multiplayer - of
  // course it breaks the offline functionality... But everything else still should."
  //
  // The real cost is on EVERY OPEN, online, and it is `CACHE_FIRST_PATHS` - built in sw.js from
  // ASSETS, exactly like `REST_MANIFEST`. A file outside ASSETS is therefore:
  //   - NOT cache-first, so it takes a network round trip on every single request rather than
  //     being served from the cache (js/hub.js imports alert.js on every launcher paint);
  //   - NOT in REST_MANIFEST, so it has no content hash and is not carried forward across a
  //     CACHE bump - it re-downloads after every deploy, at ~13 deploys a day;
  //   - NOT warmed by warmRest, so the first open after a deploy pays for it in front of the
  //     player.
  // That is the same trio root CLAUDE.md spells out for Boggle's word lists, in the entry
  // explaining why a LAZY tier had to exist instead of just dropping them from ASSETS.
  //
  // Offline still matters for everything that is NOT a network feature - a game's code, its CSS,
  // its art - which is most of what this list holds.
  //
  // It is safe to be a failure because the exclusion list below it is real: measured across the
  // whole repo the day this changed, exactly 14 files sat outside ASSETS and all 14 matched a
  // documented exclusion. If you are reading this because a deploy went red, the two honest fixes
  // are the two named in the message.
  console.error(`\nFAIL: ${missingFromAssets.length} deployed file(s) not in ASSETS (they will NOT work offline):`);
  for (const m of missingFromAssets) console.error('  ' + m);
  console.error('\n  Either add each one to ASSETS in sw.js, or, if it is genuinely never served'
    + '\n  to a player (a design tool, a mockup, a node-only script), add it to EXCLUDED in'
    + '\n  validate-sw-assets.mjs with the reason.');
  missingFailed = true;
} else {
  console.log('ok   every scanned .js/.css/.html file is in ASSETS (or a documented exclusion)');
}

// --- 4. The REST content manifest: verify against disk, rewrite in place when stale ------------
// The same executed-slice trick as step 1 gives the real SHELL/REST split (isShellAsset and the
// two filters are inside the slice), so this can never disagree with the worker about which tier
// a path is in.
// A text asset is hashed with its line endings NORMALISED to LF, never as it sits on disk.
// This repo has core.autocrlf=true, so a Windows checkout holds CRLF while the blob GitHub Pages
// actually serves is LF - and cloud/Linux sessions see LF both ways. Hashing raw bytes therefore
// gave a DIFFERENT manifest depending on which machine ran the deploy: on 2026-08-25 the shipped
// manifest was a 109/189 mix of the two, `test-sw-strategy.mjs` failed on any Windows checkout of
// main, and every platform flip marked ~190 unchanged files as changed - re-downloading ~11 MB
// per deploy, which is precisely the regression the manifest was added to end (see the sw.js
// caching notes in CLAUDE.md). Normalising makes the hash describe the DEPLOYED bytes, so the two
// platforms agree and an unchanged file stays unchanged.
//
// Binaries are hashed raw: a 0x0D 0x0A pair inside a PNG or a .webp is data, not a line ending.
const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.htm', '.json', '.txt', '.svg', '.md', '.webmanifest']);
function hashAsset(abs) {
  const buf = readFileSync(abs);
  const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
  const body = TEXT_EXT.has(ext) ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : buf;
  return createHash('sha256').update(body).digest('hex').slice(0, 10);
}

let manifestFailed = false;
{
  const { REST } = new Function(`${buildSrc}\nreturn { SHELL, REST };`)();
  const expected = {};
  for (const entry of REST) {
    const rel = resolveAssetPath(entry);
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue; // already reported as an offender in step 2
    expected[entry] = hashAsset(abs);
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

// --- version.json: the version pill's one-line answer (2026-09-01) -----------------------------
//
// js/hub.js's _latestVersion() used to fetch the whole of sw.js (52 KB, ~17 KB gzipped) on every
// single launch to read one string out of it, on top of the browser's own update check of the same
// file. This writes that string to a file of its own instead.
//
// GUARD: version.json IS DELIBERATELY NOT IN `ASSETS`. That is what keeps it out of sw.js's
// CACHE_FIRST_PATHS, which is an allow-list derived from ASSETS - a cached answer to "what is
// deployed?" freezes the pill on "up to date" for ever. The "deployed file not in the list"
// warning above is therefore CORRECT for this file and must stay.
//
// Generated, not hand-kept, for the same reason REST_MANIFEST is: a version.json that disagrees
// with CACHE is a pill that lies, and test-sw-strategy.mjs asserts the two match.
{
  const cache = /const CACHE = '([^']+)'/.exec(readFileSync(SW_PATH, 'utf8'))[1];
  const VERSION_PATH = join(ROOT, 'version.json');
  const want = `${JSON.stringify({ cache }, null, 2)}\n`;
  let have = null;
  try { have = readFileSync(VERSION_PATH, 'utf8'); } catch { /* first run */ }
  if (have !== want) {
    writeFileSync(VERSION_PATH, want);
    console.log(`ok   version.json written for ${cache} - commit it`);
  } else {
    console.log(`ok   version.json matches ${cache}`);
  }
}

process.exit(offenders.length || manifestFailed || missingFailed ? 1 : 0);
