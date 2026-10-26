// build-spelling-bee-data.mjs - GENERATOR for spelling-bee/data/bee.json (Spelling Bee's word list
// and daily puzzles). Run it, then `node tools/validate-sw-assets.mjs`, then commit both files.
//
//   NODE_USE_ENV_PROXY=1 node tools/build-spelling-bee-data.mjs [--cache <dir>] [--days 2000]
//
// SOURCES (downloaded, never committed; cached in --cache, default <os tmp>/spelling-bee-cache)
//   * SCOWL via the npm package wordlist-english 1.2.1 (Kevin Atkinson, permissive licence, notice in
//     spelling-bee/data/CREDITS.md): English + American words at size 60 and below = the ANSWERS
//     (what the hints and ranks count). (Size 40 refused ROVER, size 50 refused DUGONG and FUNGO and
//     gave 22-word days; Matt, 2026-10-26: "Obviously all words should count". Size 70 brought in
//     CEORL, ORLE, OCREA as words to find, so 60.)
//   * boggle/data/words.txt (ENABLE, public domain): a SCOWL word must also be here, which drops
//     proper nouns, abbreviations and odd spellings. Every OTHER ENABLE word that fits the rules is
//     written as `extra`: accepted and scored as a bonus word, never counted in hints or ranks.
//   * LDNOOBW English bad-word list (CC BY 4.0) plus BLOCK below: dropped entirely.
//
// RULES (the NYT game's): 4+ letters, no S anywhere, at most 7 different letters.
//
// WHAT IS WRITTEN
//   bee.json { v, epoch, words: "space separated", extra: "space separated", puzzles: ["c:abdeg", ...] }
//   A puzzle is its centre letter, ':', then the six outer letters. Answers are not stored: the game
//   works them out from `words` (spelling-bee/js/engine.js `answersFor`), which keeps the file small.
//   Puzzle #n (n = whole days since `epoch`, local time) is puzzles[n % count].
//
// THE FIRST KEEP PUZZLES NEVER CHANGE (days already played; 2026-10-26 the rest were re-picked once
// for the bigger list, 25-90 answers). After that the order is APPEND-ONLY. Saves are keyed by the puzzle's letters, not its
// number (spelling-bee/js/ui.js), so a regeneration never corrupts one, but it WOULD change what
// "today" is for everyone mid-day. To extend the list, keep the old entries and add to the end.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const CACHE = arg('--cache', path.join(os.tmpdir(), 'spelling-bee-cache'));
const DAYS = Number(arg('--days', 2000));
const EPOCH = '2026-10-22';
const SCOWL_TGZ = 'https://registry.npmjs.org/wordlist-english/-/wordlist-english-1.2.1.tgz';
const BAD_URL = 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en';
const LEVELS = [10, 20, 35, 40, 50, 55, 60];
const KEEP = 10;   // days 0-9 (Oct 22-31 2026): shipped before the 2026-10-26 re-pick, never touched

// Slurs and vulgarities LDNOOBW misses or lists only as phrases. A family hub: when in doubt, out.
const BLOCK = `nigger nigga negro faggot fagot dyke kike coon chink gook wetback retard retarded tranny whore
bitch bitchy crap crappy damn damned rape raped raping hooker boob booby titty porn porno horny dildo pecker
prick wank wanker bugger turd tard gyp gypped jap honky dago kraut cunt twat cock dick dickhead fuck fucked
fucker fucking pussy penile penial bimbo hell harlot trollop wench lynch heroin cocaine nazi`.split(/\s+/);

async function cached(url, file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return p;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  return p;
}

// Small seeded PRNG so the daily order is the same on every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const maskOf = (w) => { let m = 0; for (const c of w) m |= 1 << (c.charCodeAt(0) - 97); return m; };
const bits = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const score = (w, pangram) => (w.length === 4 ? 1 : w.length) + (pangram ? 7 : 0);

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const tgz = await cached(SCOWL_TGZ, 'wordlist-english.tgz');
  const dir = path.join(CACHE, 'scowl');
  if (!fs.existsSync(path.join(dir, 'package'))) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['xzf', tgz, '-C', dir]);
  }
  const bad = new Set(fs.readFileSync(await cached(BAD_URL, 'bad-en.txt'), 'utf8').split('\n').map((w) => w.trim().toLowerCase()));
  for (const w of BLOCK) bad.add(w);
  const enable = new Set(fs.readFileSync(path.join(ROOT, 'boggle/data/words.txt'), 'utf8').split('\n').map((w) => w.trim().toLowerCase()));

  const set = new Set();
  for (const p of ['english', 'american']) {
    for (const l of LEVELS) {
      const f = path.join(dir, 'package', `${p}-words-${l}.json`);
      if (fs.existsSync(f)) for (const w of JSON.parse(fs.readFileSync(f, 'utf8'))) set.add(w);
    }
  }
  const words = [...set]
    .filter((w) => /^[a-z]{4,}$/.test(w) && !w.includes('s') && enable.has(w) && !bad.has(w) && bits(maskOf(w)) <= 7)
    .sort();
  const answerSet = new Set(words);
  const extra = [...enable]
    .filter((w) => /^[a-z]{4,}$/.test(w) && !w.includes('s') && !answerSet.has(w) && !bad.has(w) && bits(maskOf(w)) <= 7)
    .sort();
  const masks = words.map(maskOf);

  // Every 7-letter set that makes a pangram, each with every centre letter that gives a fair puzzle.
  const sets = [...new Set(masks.filter((m) => bits(m) === 7))].sort((a, b) => a - b);
  const candidates = [];
  for (const pm of sets) {
    const options = [];
    for (let b = 0; b < 26; b++) {
      const cm = 1 << b;
      if (!(pm & cm)) continue;
      let n = 0, pts = 0, pangrams = 0;
      for (let i = 0; i < words.length; i++) {
        if ((masks[i] & ~pm) || !(masks[i] & cm)) continue;
        const pg = masks[i] === pm;
        n++; pts += score(words[i], pg); if (pg) pangrams++;
      }
      // NYT-like size: 25-90 answers (90 is what the Yesterday sheet fits), 80-450 points.
      if (n >= 25 && n <= 90 && pts >= 80 && pts <= 450) options.push(b);
    }
    if (options.length) candidates.push({ pm, options });
  }

  const rand = rng(20261022);
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  const puzzles = [];
  for (const c of candidates.slice(0, DAYS + KEEP)) {
    const centre = c.options[Math.floor(rand() * c.options.length)];
    let outer = '';
    for (let b = 0; b < 26; b++) if ((c.pm & (1 << b)) && b !== centre) outer += String.fromCharCode(97 + b);
    puzzles.push(String.fromCharCode(97 + centre) + ':' + outer);
  }

  const file = path.join(ROOT, 'spelling-bee/data/bee.json');
  // The first KEEP puzzles keep their days; the rest come from this run, appended after them.
  let kept = [];
  try { kept = (JSON.parse(fs.readFileSync(file, 'utf8')).puzzles || []).slice(0, KEEP); } catch { /* first run */ }
  if (kept.length) {
    const setOf = (q) => [...q.replace(':', '')].sort().join('');   // the 7 letters, whatever the centre
    const seen = new Set(kept.map(setOf));
    for (const q of puzzles) {
      if (kept.length >= DAYS) break;
      if (!seen.has(setOf(q))) { kept.push(q); seen.add(setOf(q)); }
    }
    puzzles.length = 0;
    puzzles.push(...kept);
  }
  const out = { v: 1, epoch: EPOCH, words: words.join(' '), extra: extra.join(' '), puzzles };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out) + '\n');
  console.log(`words ${words.length}, extra ${extra.length}, pangram sets ${sets.length}, fair ${candidates.length}, puzzles ${puzzles.length}, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
