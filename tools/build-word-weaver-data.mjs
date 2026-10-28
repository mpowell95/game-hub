// build-word-weaver-data.mjs - GENERATOR for word-weaver/data/ (Word Weaver's ladder of crossword
// levels). Run it, then `node word-weaver/js/data-test.js`, then commit the data. Never hand-edit
// the files it writes.
//
//   NODE_USE_ENV_PROXY=1 node tools/build-word-weaver-data.mjs [--cache <dir>] [--levels 2000]
//
// SOURCES (downloaded, never committed; cached in --cache, default <os tmp>/word-weaver-cache)
//   * SCOWL via the npm package wordlist-english 1.2.1 (Kevin Atkinson, permissive licence, notice in
//     word-weaver/data/CREDITS.md), English + American.
//   * boggle/data/words.txt (ENABLE, public domain): every word must also be here, which drops proper
//     nouns, abbreviations and odd spellings.
//   * FrequencyWords en 2018 (Hermit Dave, OpenSubtitles, CC BY-SA 4.0): how often a word is SAID.
//   * First-name lists (dominictarr/random-name, smashew/NameDatabases, both MIT).
//   * LDNOOBW English bad-word list (CC BY 4.0) plus BLOCK below, with their plurals and verb forms.
//
// THE TWO LISTS
//   GRID words (what a level asks for) = SCOWL size <= GRID_LEVEL ∩ ENABLE, said at least
//     MIN_SAID_GRID times, not on GRID_BLOCK (odd short forms: HES, OHS, QUA...). A first name is a
//     grid word only if it is in SCOWL's core (size <= 20: BILL, MARK, ROSE, GRACE) or on NAME_OK
//     (read by hand 2026-10-28: plain words first, IVY, PEARL, CANDY); MARIA, PETER, MIKE are not.
//   EXTRA words (accepted, counted, no score) = every GRID word, plus SCOWL size <= EXTRA_LEVEL ∩
//     ENABLE that is not a first name. Matt has complained about names and junk words in Spelling
//     Bee: names are out, and the extras are never shown until found.
//   Bad words are out of both. S words are allowed (unlike Spelling Bee). 3 to 7 letters.
//
// THE LEVELS (rules checked again, level by level, by word-weaver/js/data-test.js)
//   Each level picks a BASE word (a grid word using every wheel letter; it is always in the grid),
//   then lays out a crossword of grid words that fit the wheel's letters: words cross only on the
//   same letter, the whole grid is connected, no two letters touch unless one word runs through both
//   (no accidental 2-letter or junk words), no word twice, at most 9 x 9. Several random layouts are
//   tried; the one with the target word count in the smallest, squarest box wins.
//   RAMP: levels 1-2 three letters, 3-10 four (3-4 grid words), then five, six, and seven letters
//   (from level 301, the majority by 500, mixed with six after). Grid words rise to about 15.
//   A letter multiset is never used twice anywhere (so never twice in a row).
//   Seeded per level number (rng(SEED + n)): the same sources give the same levels.
//
// WHAT IS WRITTEN
//   word-weaver/data/index.json      { v: 1, count, chunk: 250 }
//   word-weaver/data/levels-<k>.json { v: 1, first: 1 + 250k, levels: [ ...up to 250 ] }, one level a line
//   A level: { l: "EINORST" (wheel letters, sorted), g: [rows, cols],
//              w: [["STONE", r, c, "a"|"d"], ...] (0-based start, a = across, d = down; base first),
//              x: ["ONSET", ...] (sorted: every other EXTRA word the wheel can make) }
//
// APPEND-ONLY ONCE SHIPPED. A player's progress is per level number (js/word-weaver-points.js), so a
// changed level would change what they cleared. A re-run KEEPS every level already in the files and
// only appends up to --levels (no multiset is reused). `--fresh` throws the files away: only before
// release. data-test.js pins the shipped levels by hash.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const CACHE = arg('--cache', path.join(os.tmpdir(), 'word-weaver-cache'));
const COUNT = Number(arg('--levels', 2000));
const FRESH = args.includes('--fresh');
const OUT = path.join(ROOT, 'word-weaver/data');
const CHUNK = 250;
const SEED = 20261028;

const SCOWL_TGZ = 'https://registry.npmjs.org/wordlist-english/-/wordlist-english-1.2.1.tgz';
const BAD_URL = 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en';
const FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt';
const NAME_URLS = ['https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt',
  'https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/first%20names/us.txt'];
const LEVELS = [10, 20, 35, 40, 50, 55, 60];
const GRID_LEVEL = 35;
const CORE_LEVEL = 20;
const EXTRA_LEVEL = 60;
const MIN_SAID_GRID = 200;

// Short forms SCOWL 35 + ENABLE let through that nobody would put in a word puzzle's grid. Still
// accepted as extras (unless bad).
const GRID_BLOCK = new Set(`hes ins ups ifs ohs pis mas pas dos ova qua sic wot sop cox chi pap sup ope
ain ana ani ens ern ers ess oes ons ors ose rei res tis ted teds sen pes eds ids ads ares eras aves ayes
dis nus uns ays ohm ohms gal gals bani roman genii balder reals anon nth`.split(/\s+/).filter(Boolean));
// First names that are plain words first (read by hand from SCOWL 35, 2026-10-28). A name at size 35
// NOT on this list (MARIA, PETER, HARRY, MIKE, VICTOR) is not a grid word.
const NAME_OK = new Set(`adore aide angelic aura barb basil bee beret berry blanch blithe blossom bride
briny brook brooks bud buddy bunny camel candy cherish cherry chin china clay collie coral corny coy
curt daisy destiny diamond dimple doll dung earnest emerald fawn fern gala gale garland garnet genie gill
ginger glen gusty hazel heath herb holly hue hunter iris ivory ivy jade jewel kitty lacy lance laurel
lily lore maple marine marvel merrily misty modesty muffin nettle olive opal pansy pasty pearl peg pier
poppy raven reed rocky rosy ruby sage serene shin sparkle stormy tabby tally tawny tiara tiff velvet
violet willow windy wan yen rob eve jay lee earl dean sandy eddy carol robin tanner walker foster
warren mason jarred garret sari heather`.split(/\s+/).filter(Boolean));
// Slurs, vulgarities and grown-up words LDNOOBW misses or lists only as phrases (Spelling Bee's BLOCK,
// plus more). A family hub: when in doubt, out. Plurals and verb forms are caught by isBad().
const BLOCK = `nigger nigga negro faggot fagot fag dyke kike coon chink gook wetback retard tranny whore
bitch bitchy crap crappy damn rape hooker boob booby titty porn porno horny dildo pecker prick wank
wanker bugger turd tard gyp jap honky dago kraut cunt twat cock dick dickhead fuck pussy penile penial
bimbo hell harlot trollop wench lynch heroin cocaine nazi sex sexy ass arse tit tits piss pissed nude
nudes nudity slut spic wop homo queer booze poop puke barf pee sod bonk shag hump kinky lust lusty
breast bosom teat teats erotic orgy testes testis scrota scrotum frig glans nuder nudest
nudism nudist`.split(/\s+/).filter(Boolean);

// Whole word FAMILIES, every form (2026-10-28 review: FAGGED, RAPER, SEXIER, GAYS got through the
// suffix rule). Anchored at both ends, so DRAPE, GRAPE, SCRAPE, SEXTET, SEXTON, SEXTANT stay.
// The rest of the alternatives come from reading both final lists for slurs, sexual, body-slang,
// drug-slang and crude words the same day (the full list is in the 2026-10-28 commit message).
const BLOCK_RE = new RegExp('^(' + [
  'fag\\w*', 'rap(e|es|ed|er|ers|ing|ist|ists)', 'sex(?!t(et|on|ant))\\w*', 'gay(s|er|est)', 'nigh(er|est)',
  // slurs and sound-alikes
  'wogs?', 'yids?', 'gyp(s|ped|per|pers|ping|ster|sters)?', 'gyps(y|ies)', 'negroid', 'nigg\\w*', 'coolies?', 'squaws?', 'rednecks?', 'gringos?',
  'poofters?', 'midgets?', 'mammy', 'limeys?', 'dikes?', 'diked', 'gimp\\w*', 'fatsos?', 'sissy', 'sissies',
  // sexual and body words
  'anally', 'condoms?', 'crotch(es)?', 'phall(i|ic|us|uses)', 'pubic', 'scrotal', 'sperms?', 'vagina[el]?', 'vulvae?',
  'erotica', 'fetish(es)?', 'pimp(s|ed|ing)?', 'whor(e|es|ed|ing|ish)', 'huss(y|ies)', 'flooz(y|ies)', 'bawd\\w*', 'lewd\\w*', 'lust(s|ed|ing|ful|fully|ier|iest|ily|y)?',
  'slutty', 'smutty', 'hooters?', 'buttocks?', 'hickeys?', 'dongs?', 'ballsy', 'hornier', 'horniest', 'cockier', 'cockily',
  'tarty', 'coit(al|us)', 'brothels?', 'lech(er|ers|ery|es|ed|ing)?', 'libidos?', 'molest\\w*', 'rectal', 'gropers?',
  'randier', 'randiest', 'panties?', 'buxom', 'carnal\\w*', 'wanton\\w*', 'enemas?', 'pissoirs?', 'pussier',
  // toilet words
  'fart(s|ed|ing)?', 'crapp(ed|er|ers|ing)', 'shitted', 'boogers?', 'douch(e|es|ed|ing)',
  // drug slang
  'potheads?', 'hashish', 'opium', 'tok(e|es|ed|ing)', 'meths?', 'junkies?', 'druggies?', 'reefers?', 'spliffs?', 'stoners?',
  // crude insults and oaths
  'scumbags?', 'gits?', 'jackass(es)?', 'goddamn\\w*', 'helluva', 'sodd(ed|ing)', 'shagged', 'frigged',
].join('|') + ')$');
// Plain words the plural/verb-form rule in isBad() would catch by accident (read 2026-10-28).
const STEM_OK = new Set('butter butters buttes butted butting spiced spices spicing spicy tardy luster monger mongers crapes'.split(' '));

async function cached(url, file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return p;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  return p;
}

// Small seeded PRNG (Spelling Bee's).
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sortKey = (w) => [...w].sort().join('');
const counts = (w) => { const c = new Uint8Array(26); for (const ch of w) c[ch.charCodeAt(0) - 97]++; return c; };
const maskOf = (w) => { let m = 0; for (const ch of w) m |= 1 << (ch.charCodeAt(0) - 97); return m; };
/** Can word (counts wc) be made from the wheel (counts lc)? */
const fitsIn = (wc, lc) => { for (let i = 0; i < 26; i++) if (wc[i] > lc[i]) return false; return true; };

// --- the ramp ----------------------------------------------------------------------------------
/** Wheel size for level n (the RNG mixes neighbouring sizes). */
function wheelSize(n, r) {
  if (n <= 2) return 3;
  if (n <= 10) return 4;
  const ramp = (a, b, p0, p1) => p0 + (p1 - p0) * Math.min(1, Math.max(0, (n - a) / (b - a)));
  if (n <= 40) return r() < ramp(11, 40, 0.25, 0.8) ? 5 : 4;
  if (n <= 100) return r() < ramp(70, 100, 0, 0.3) ? 6 : 5;
  if (n <= 250) return r() < ramp(101, 250, 0.4, 0.9) ? 6 : 5;
  if (n <= 300) return 6;
  if (n <= 500) return r() < ramp(301, 500, 0.15, 0.6) ? 7 : 6;
  return r() < ramp(501, 2000, 0.6, 0.7) ? 7 : 6;
}
/** Grid words wanted for level n with a wheel of `size` letters. */
function targetWords(n, size, r) {
  const jitter = r() < 0.3 ? -1 : r() < 0.5 ? 1 : 0;
  const t = (lo, hi, a, b) => Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, (n - a) / (b - a))));
  if (size === 3) return 3;
  if (size === 4) return n <= 10 ? (n <= 6 ? 3 : 4) : 4 + (r() < 0.4 ? 1 : 0);
  if (size === 5) return Math.max(4, t(4, 7, 11, 250) + jitter);
  if (size === 6) return Math.max(5, t(5, 10, 70, 1400) + jitter);
  return Math.max(7, t(7, 14, 301, 1800) + jitter + (r() < 0.25 ? 1 : 0));
}
/** The biggest grid allowed: [rows, cols]. */
function maxDims(n, size) {
  if (size <= 3) return [5, 5];
  if (size === 4) return [6, 6];
  if (size === 5) return [7, 7];
  if (size === 6) return [8, 8];
  return n < 800 ? [8, 9] : [9, 9];
}

// --- the crossword ------------------------------------------------------------------------------
const K = (r, c) => (r + 64) * 256 + (c + 64);

/** Try to lay out `target` of `pool`'s words (base first) inside maxR x maxC. Returns the placed words. */
function layout(base, pool, target, maxR, maxC, r) {
  const cells = new Map();   // key -> { ch, a, d }
  let minR = 0, maxRr = 0, minC = 0, maxCc = 0;
  const placed = [];
  const get = (rr, cc) => cells.get(K(rr, cc));
  function check(w, r0, c0, dir) {
    const dr = dir === 'd' ? 1 : 0, dc = dir === 'a' ? 1 : 0, n = w.length;
    if (get(r0 - dr, c0 - dc) || get(r0 + dr * n, c0 + dc * n)) return -1;
    let cross = 0;
    for (let i = 0; i < n; i++) {
      const rr = r0 + dr * i, cc = c0 + dc * i, cell = get(rr, cc);
      if (cell) {
        if (cell.ch !== w[i] || cell[dir]) return -1;
        cross++;
      } else if (get(rr + dc, cc + dr) || get(rr - dc, cc - dr)) return -1;
    }
    if (placed.length && (cross === 0 || cross === n)) return -1;
    const r1 = Math.min(minR, r0), r2 = Math.max(maxRr, r0 + dr * (n - 1));
    const c1 = Math.min(minC, c0), c2 = Math.max(maxCc, c0 + dc * (n - 1));
    if (r2 - r1 + 1 > maxR || c2 - c1 + 1 > maxC) return -1;
    return cross;
  }
  function put(w, r0, c0, dir) {
    const dr = dir === 'd' ? 1 : 0, dc = dir === 'a' ? 1 : 0;
    for (let i = 0; i < w.length; i++) {
      const k = K(r0 + dr * i, c0 + dc * i);
      const cell = cells.get(k) || { ch: w[i], a: false, d: false };
      cell[dir] = true;
      cells.set(k, cell);
    }
    if (!placed.length) { minR = maxRr = r0; minC = maxCc = c0; }
    minR = Math.min(minR, r0); maxRr = Math.max(maxRr, r0 + dr * (w.length - 1));
    minC = Math.min(minC, c0); maxCc = Math.max(maxCc, c0 + dc * (w.length - 1));
    placed.push([w, r0, c0, dir]);
  }
  put(base, 0, 0, r() < 0.65 || maxR < base.length ? 'a' : 'd');
  // Longer words first (they are hardest to fit), shuffled within a length, a little mixed.
  const rest = pool.filter((w) => w !== base).map((w) => ({ w, k: w.length + r() * 1.6 })).sort((a, b) => b.k - a.k).map((o) => o.w);
  let progress = true;
  while (placed.length < target && progress) {
    progress = false;
    for (let wi = 0; wi < rest.length && placed.length < target; wi++) {
      const w = rest[wi];
      if (!w) continue;
      let best = null;
      for (const [k, cell] of cells) {
        const rr = Math.floor(k / 256) - 64, cc = (k % 256) - 64;
        for (let i = 0; i < w.length; i++) {
          if (w[i] !== cell.ch) continue;
          for (const dir of ['a', 'd']) {
            if (cell[dir]) continue;
            const r0 = dir === 'd' ? rr - i : rr, c0 = dir === 'a' ? cc - i : cc;
            const cross = check(w, r0, c0, dir);
            if (cross < 0) continue;
            const dr = dir === 'd' ? 1 : 0, dc = dir === 'a' ? 1 : 0;
            const h = Math.max(maxRr, r0 + dr * (w.length - 1)) - Math.min(minR, r0) + 1;
            const wd = Math.max(maxCc, c0 + dc * (w.length - 1)) - Math.min(minC, c0) + 1;
            const score = h * wd + Math.abs(h - wd) * 2 - cross * 3 + r() * 3;
            if (!best || score < best.score) best = { r0, c0, dir, score };
          }
        }
      }
      if (best) { put(w, best.r0, best.c0, best.dir); rest[wi] = null; progress = true; }
    }
  }
  return placed.map(([w, r0, c0, d]) => [w, r0 - minR, c0 - minC, d]);
}

/** Every rule a level's grid must keep; returns a list of problems (empty = good). Same checks as
 *  word-weaver/js/data-test.js. */
function gridProblems(words, rows, cols) {
  const bad = [];
  const cells = new Map();
  for (const [w, r0, c0, d] of words) {
    for (let i = 0; i < w.length; i++) {
      const rr = d === 'd' ? r0 + i : r0, cc = d === 'a' ? c0 + i : c0;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) bad.push(`${w} off the grid`);
      const k = rr * 16 + cc, cell = cells.get(k);
      if (cell && cell.ch !== w[i]) bad.push(`${w} clashes at ${rr},${cc}`);
      if (cell && cell[d]) bad.push(`${w} overlaps along ${d} at ${rr},${cc}`);
      const nc = cell || { ch: w[i] };
      nc[d] = w;
      cells.set(k, nc);
    }
  }
  const starts = new Set(words.map(([w, r0, c0, d]) => `${d}${r0},${c0},${w.length}`));
  for (const d of ['a', 'd']) {
    for (let x = 0; x < (d === 'a' ? rows : cols); x++) {
      let run = 0;
      for (let y = 0; y <= (d === 'a' ? cols : rows); y++) {
        const k = d === 'a' ? x * 16 + y : y * 16 + x;
        if (y < (d === 'a' ? cols : rows) && cells.has(k)) { run++; continue; }
        if (run >= 2) {
          const s = y - run;
          if (!starts.has(d === 'a' ? `a${x},${s},${run}` : `d${s},${x},${run}`)) bad.push(`junk run ${d} at ${x},${s}`);
        }
        run = 0;
      }
    }
  }
  // Connected: walk from the first word through shared cells.
  const seen = new Set([0]), todo = [0];
  const cellsOf = words.map(([w, r0, c0, d]) => [...w].map((_, i) => (d === 'd' ? r0 + i : r0) * 16 + (d === 'a' ? c0 + i : c0)));
  while (todo.length) {
    const i = todo.pop();
    for (let j = 0; j < words.length; j++) if (!seen.has(j) && cellsOf[j].some((k) => cellsOf[i].includes(k))) { seen.add(j); todo.push(j); }
  }
  if (seen.size !== words.length) bad.push('not connected');
  return bad;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const tgz = await cached(SCOWL_TGZ, 'wordlist-english.tgz');
  const dir = path.join(CACHE, 'scowl');
  if (!fs.existsSync(path.join(dir, 'package'))) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['xzf', tgz, '-C', dir]);
  }
  const bad = new Set(fs.readFileSync(await cached(BAD_URL, 'bad-en.txt'), 'utf8').split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean));
  for (const w of BLOCK) bad.add(w);
  const isBad = (w) => bad.has(w) || !STEM_OK.has(w) && ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'y', 'ies'].some((x) => w.endsWith(x) && bad.has(w.slice(0, -x.length)))
    || !STEM_OK.has(w) && w.endsWith('ies') && bad.has(w.slice(0, -3) + 'y');
  const enable = new Set(fs.readFileSync(path.join(ROOT, 'boggle/data/words.txt'), 'utf8').split('\n').map((w) => w.trim().toLowerCase()));
  const level = new Map();
  for (const l of LEVELS) {
    for (const p of ['english', 'american']) {
      for (const w of JSON.parse(fs.readFileSync(path.join(dir, 'package', `${p}-words-${l}.json`), 'utf8'))) if (!level.has(w)) level.set(w, l);
    }
  }
  const said = new Map();
  for (const line of fs.readFileSync(await cached(FREQ_URL, 'en_full.txt'), 'utf8').split('\n')) {
    const [w, n] = line.split(' ');
    if (w && !said.has(w)) said.set(w, Number(n) || 0);
  }
  const names = new Set();
  for (const [i, u] of NAME_URLS.entries()) {
    for (const n of fs.readFileSync(await cached(u, `names-${i}.txt`), 'utf8').split(/\r?\n/)) if (n.trim()) names.add(n.trim().toLowerCase());
  }
  const ok = (w) => /^[a-z]{3,7}$/.test(w) && enable.has(w) && !isBad(w) && !BLOCK_RE.test(w);
  const grid = [...level.keys()].filter((w) => level.get(w) <= GRID_LEVEL && ok(w) && !GRID_BLOCK.has(w)
    && (said.get(w) || 0) >= MIN_SAID_GRID && (!names.has(w) || level.get(w) <= CORE_LEVEL || NAME_OK.has(w))).sort();
  const extra = [...new Set([...grid, ...[...level.keys()].filter((w) => level.get(w) <= EXTRA_LEVEL && ok(w) && !names.has(w))])].sort();
  const gridC = grid.map(counts), gridM = grid.map(maskOf);
  const extraC = extra.map(counts), extraM = extra.map(maskOf);
  const coreScore = (w) => (level.get(w) <= CORE_LEVEL ? 2 : 0) + Math.log10(said.get(w) || 1);

  // Every base candidate: a grid word, by its multiset, with the grid words it can make.
  const bases = new Map();   // sortKey -> { key, words: [base words], pool: [grid words] }
  for (const w of grid) {
    const k = sortKey(w);
    if (!bases.has(k)) bases.set(k, { key: k, words: [], pool: null });
    bases.get(k).words.push(w);
  }
  for (const b of bases.values()) {
    const lc = counts(b.key), lm = maskOf(b.key);
    b.pool = [];
    for (let i = 0; i < grid.length; i++) if (grid[i].length <= b.key.length && !(gridM[i] & ~lm) && fitsIn(gridC[i], lc)) b.pool.push(grid[i]);
    b.common = Math.max(...b.words.map(coreScore));
  }
  const bySize = {};
  for (const b of bases.values()) (bySize[b.key.length] ||= []).push(b);
  for (const s of Object.keys(bySize)) bySize[s].sort((a, b) => (a.key < b.key ? -1 : 1));

  // Keep what has shipped (append-only).
  const kept = [];
  if (!FRESH && fs.existsSync(path.join(OUT, 'index.json'))) {
    const idx = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
    for (let k = 0; k * CHUNK < idx.count; k++) kept.push(...JSON.parse(fs.readFileSync(path.join(OUT, `levels-${k}.json`), 'utf8')).levels);
  }
  const used = new Set(kept.map((lv) => sortKey(lv.l.toLowerCase())));
  const levels = kept.slice(0, COUNT);
  for (let n = levels.length + 1; n <= COUNT; n++) {
    const r = rng(SEED + n * 7919);
    let size = wheelSize(n, r);
    let target = targetWords(n, size, r);
    const [mr, mc] = maxDims(n, size);
    let made = null;
    const failed = new Set();
    for (let tries = 0; !made && tries < 400; tries++) {
      // Unused multisets that can supply the target; early levels take the commonest bases.
      const cands = (bySize[size] || []).filter((b) => !used.has(b.key) && !failed.has(b.key) && b.pool.length >= target + (size >= 6 ? 2 : 0));
      if (!cands.length) {
        if (tries > 300) { size = size === 7 ? 6 : size + 1; continue; }
        target = Math.max(3, target - 1); continue;
      }
      const from = n <= 400 ? [...cands].sort((x, y) => y.common - x.common || (x.key < y.key ? -1 : 1)).slice(0, Math.max(8, Math.ceil(cands.length * (n <= 60 ? 0.2 : 0.4)))) : cands;
      const b = from[Math.floor(r() * from.length)];
      // The base word: the most common of its anagrams.
      const base = [...b.words].sort((x, y) => coreScore(y) - coreScore(x) || (x < y ? -1 : 1))[0];
      let best = null;
      for (let a = 0; a < 60; a++) {
        const ws = layout(base, b.pool, target, mr, mc, r);
        if (ws.length < target) continue;
        const rows = Math.max(...ws.map(([w, r0, , d]) => r0 + (d === 'd' ? w.length : 1)));
        const cols = Math.max(...ws.map(([w, , c0, d]) => c0 + (d === 'a' ? w.length : 1)));
        const score = rows * cols + Math.abs(rows - cols) * 3;
        if (!best || score < best.score) best = { ws, rows, cols, score };
      }
      if (!best) { failed.add(b.key); continue; }
      const problems = gridProblems(best.ws, best.rows, best.cols);
      if (problems.length) throw new Error(`level ${n}: ${problems.join('; ')}`);
      const lc = counts(b.key), lm = maskOf(b.key);
      const inGrid = new Set(best.ws.map(([w]) => w));
      const x = [];
      for (let i = 0; i < extra.length; i++) if (!inGrid.has(extra[i]) && extra[i].length <= b.key.length && !(extraM[i] & ~lm) && fitsIn(extraC[i], lc)) x.push(extra[i]);
      made = {
        l: b.key.toUpperCase(),
        g: [best.rows, best.cols],
        w: best.ws.map(([w, r0, c0, d]) => [w.toUpperCase(), r0, c0, d]),
        x: x.map((w) => w.toUpperCase()),
      };
      used.add(b.key);
    }
    if (!made) throw new Error(`level ${n}: no layout (size ${size}, target ${target})`);
    levels.push(made);
  }

  fs.mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (let k = 0; k * CHUNK < levels.length; k++) {
    const part = levels.slice(k * CHUNK, (k + 1) * CHUNK);
    const body = `{"v":1,"first":${1 + k * CHUNK},"levels":[\n${part.map((lv) => JSON.stringify(lv)).join(',\n')}\n]}\n`;
    fs.writeFileSync(path.join(OUT, `levels-${k}.json`), body);
    total += body.length;
  }
  // A --fresh run with fewer levels leaves no stale chunk behind.
  for (let k = Math.ceil(levels.length / CHUNK); fs.existsSync(path.join(OUT, `levels-${k}.json`)); k++) fs.rmSync(path.join(OUT, `levels-${k}.json`));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: 1, count: levels.length, chunk: CHUNK }) + '\n');

  // A small report: the ramp per 100 levels.
  console.log(`grid words ${grid.length}, extra words ${extra.length}, levels ${levels.length} (kept ${kept.length}), ${(total / 1024).toFixed(0)} KB`);
  for (let s = 0; s < levels.length; s += s < 100 ? 10 : 100) {
    const part = levels.slice(s, s + (s < 100 ? 10 : 100));
    const sizes = {}; for (const lv of part) sizes[lv.l.length] = (sizes[lv.l.length] || 0) + 1;
    const nw = part.map((lv) => lv.w.length);
    const maxR = Math.max(...part.map((lv) => lv.g[0])), maxC = Math.max(...part.map((lv) => lv.g[1]));
    console.log(`${String(s + 1).padStart(4)}-${String(s + part.length).padEnd(4)} letters ${JSON.stringify(sizes)} words ${Math.min(...nw)}-${Math.max(...nw)} (avg ${(nw.reduce((a, b) => a + b, 0) / nw.length).toFixed(1)}) grid max ${maxR}x${maxC} extras avg ${(part.reduce((a, lv) => a + lv.x.length, 0) / part.length).toFixed(0)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
