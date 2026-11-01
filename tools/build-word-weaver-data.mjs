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
//   Each level picks a wheel (a letter multiset some grid word uses in full: the BASE word, always in
//   the grid), then lays out a crossword of grid words the wheel can make: words cross only on the
//   same letter, the whole grid is connected, no two letters touch unless one word runs through both
//   (no accidental 2-letter or junk words), no word twice, at most 9 x 9. A letter multiset is never
//   used twice anywhere. Seeded per level number: the same sources give the same levels.
//
// 2026-11-01: REMADE, ALL 2,000 (Matt, "Yes do all", after a review of the data). The old levels picked
//   grid words by what fit the layout, so common words were left as bonus words and rare ones filled
//   the grid (Medium: ~15 top-10,000 words a level left as bonus; level 502's grid had ELSE, EARL, LEER
//   while ARE, SEE, REAL, SEA, SALE were bonus; Matt found 20+ bonus words before the last grid word).
//   And the ramp had steps: late Easy = Medium, a cliff at 1001, Hard = Expert.
//   COMMON WORDS FIRST. A COMMON word is among the 10,000 most said (FrequencyWords 2018, its line
//   number). Every common grid-list word a wheel makes is placed first (longest first, then fill words
//   only into the slots left), and a common word left out may take a rarer word's place. When a wheel
//   has more common words than the grid holds (target + 1), the most said stay (Hard/Expert: the
//   longest too). Wheels are CHOSEN for it: few common words beyond what the grid holds, few common
//   words no list allows (HES, INS), then the most said words for the target, then (Medium on) long
//   words. Per band (BANDS below; word-weaver/js/data-test.js checks them): common words left as bonus
//   words, average / most on a level: Easy 1/3, Medium 2/4, Hard 3/5, Expert 4/6; a grid word's rank
//   at most Easy 10,000, Medium 10,000 -> 15,000, Hard 15,000 -> 30,000, Expert 30,000 -> 60,000
//   (rising level by level), and the median level's rarest grid word within Easy 8,000, Medium 15,000,
//   Hard 30,000. The block lists (GRID_BLOCK, EXPERT_BLOCK, bad words) all still apply.
//   ONE SMOOTH CLIMB (plan()): 1-10 an intro (3-4 letters, 3-4 words); Easy 4 letters rising to 5 by
//   ~200, ~4 -> ~6 grid words; Medium 6 letters (a few 5 at the start), ~6 -> ~9; Hard 7 (a few 6 at
//   the start), ~9 -> ~12; Expert 7, ~12 -> ~14. The Easy/Medium list is the old GRID list; Hard and
//   Expert keep their own wider lists (SCOWL <= 50 said 50+, SCOWL <= 60 said 30+; a 3- or 4-letter word
//   must be on the Easy/Medium list). The old caps on 3- and 4-letter words in Hard/Expert are gone: a
//   common short word belongs in the grid. So grid words are shorter than before (Expert ~4.2 letters,
//   was 5.0): with 12-14 words from 7 letters and nearly every common word placed, that is the price.
//   tools/build-word-weaver-es.mjs imports all of this (makeLadder).

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
// `--replace-from N` drops levels N.. before appending (the generator then remakes them). Used ONCE,
// 2026-10-29, with N = 1001, when Hard and Expert got their own lists: the game had been admin only
// since 2026-10-28 and played in order from level 1, so nobody could have reached level 1001.
// `--fresh` used 2026-11-01 for the remake above (Matt approved; the game is still admin only, and a
// finished level keeps its stars by number). Never again after release.
// Also written: tools/word-weaver-ranks-en.txt (the data test's offline copy of the ranks).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const CACHE = arg('--cache', path.join(os.tmpdir(), 'word-weaver-cache'));
const COUNT = Number(arg('--levels', 2000));
const FRESH = args.includes('--fresh');
const REPLACE_FROM = Number(arg('--replace-from', 0)) || 0;
const OUT = path.join(ROOT, 'word-weaver/data');
export const CHUNK = 250;
export const SEED = 20261028;

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
// Hard and Expert grid lists (see the header): SCOWL size and times said.
const HARD_LIST = { scowl: 50, said: 50 };
const EXPERT_LIST = { scowl: 60, said: 30 };

// --- the bands and their caps (2026-11-01, Matt: "Yes do all"; see the header) --------------------
/** A COMMON word: among the 10,000 most said (FrequencyWords 2018, 50k list, its line number). */
export const COMMON = 10000;
/** The four bands (js/word-weaver-points.js). `list` = which grid list (bit) the band draws from;
 *  `rare` = [first level's, last level's] cap on a grid word's rank; `bonusAvg`/`bonusMax` = common
 *  words left as bonus words (top COMMON, not in the grid), on average and on any one level;
 *  `rarestMedian` = the band's median of each level's rarest grid word; `aim` = what the generator
 *  tries for first (it takes up to `bonusMax` only when no wheel does better). word-weaver/js/
 *  data-test.js and data-test-es.js check the same numbers (BANDS there). */
export const BANDS = [
  { name: 'easy', from: 1, to: 500, list: 1, rare: [10000, 10000], bonusAvg: 1, bonusMax: 3, rarestMedian: 8000, aim: 0 },
  { name: 'medium', from: 501, to: 1000, list: 1, rare: [10000, 15000], bonusAvg: 2, bonusMax: 4, rarestMedian: 15000, aim: 1 },
  { name: 'hard', from: 1001, to: 1500, list: 2, rare: [15000, 30000], bonusAvg: 3, bonusMax: 5, rarestMedian: 30000, aim: 2 },
  { name: 'expert', from: 1501, to: 2000, list: 4, rare: [30000, 60000], bonusAvg: 4, bonusMax: 6, rarestMedian: Infinity, aim: 3 },
];
export const bandOf = (n) => BANDS.find((b) => n >= b.from && n <= b.to) || BANDS[BANDS.length - 1];

// Short forms SCOWL 35 + ENABLE let through that nobody would put in a word puzzle's grid. Still
// accepted as extras (unless bad).
const GRID_BLOCK = new Set(`hes ins ups ifs ohs pis mas pas dos ova qua sic wot sop cox chi pap sup ope
ain ana ani ens ern ers ess oes ons ors ose rei res tis ted teds sen pes eds ids ads ares eras aves ayes
dis nus uns ays ohm ohms gal gals bani roman genii balder reals anon nth`.split(/\s+/).filter(Boolean));
// Real but odd Scrabble-list words the Hard/Expert lists let through (read by hand 2026-10-29). Still
// accepted as extras.
const EXPERT_BLOCK = new Set(`grans lades soever ligate ligated ligates engram engrams welkin suttee nisei
chorea stria striae septa tellies tallish meson mesons scrod snood snoods barbel lairds kopeck kopecks
daters horas bahts stoup cruse picot tromp caber serous ileum pleura hawed outdrew outrace refile carder
caner thous treys sheila sheilas medias gasman legman redcap verso tenon ampule ampules casein instar
isomer barres areal inmost frats prole proles conks sager vaster rater evilest tiler aerie aeries
pules sots matins welter swelter
felts breve bunts supra miler ivies cotes lames pedalo cavers smacker ropers wallies livest gladder whens
shays piddles turps washy ostler scrim rotas prate deeps senors shivs napper thanes wangler ponces moaner
sicked hided toddies lapin spinney blonder tuckers dater bests loafs stander pinny rawness dabbler varlet
drear oversea golfs twelves alums infra roughs daemons umbra saltier rials roans gloried burgs piste sabot
sarky anted tiddler curiae bruit wonted heteros septal larges realer lucks flied haled flacks burls treed
huger candler planer sharer haunter outstay hearers bloater
pusses welsher welshers mestizo mestizos ethnics gonad gonads falsies flatus estrus dopers doper`.split(/\s+/).filter(Boolean));
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
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sortKey = (w) => [...w].sort().join('');
const counts = (w) => { const c = new Uint8Array(26); for (const ch of w) c[ch.charCodeAt(0) - 97]++; return c; };
const maskOf = (w) => { let m = 0; for (const ch of w) m |= 1 << (ch.charCodeAt(0) - 97); return m; };
/** Can word (counts wc) be made from the wheel (counts lc)? */
const fitsIn = (wc, lc) => { for (let i = 0; i < 26; i++) if (wc[i] > lc[i]) return false; return true; };

// --- the ramp (2026-11-01) ----------------------------------------------------------------------
const lerp = (n, a, b, v0, v1) => v0 + (v1 - v0) * Math.min(1, Math.max(0, (n - a) / (b - a)));
/** Level n's shape: wheel `size`, grid words wanted (`target`; up to `maxWords` when more common words
 *  fit), the rank cap on its grid words (`rcap`) and the biggest grid (`dims`). One smooth climb:
 *  each band starts where the last ended. */
export function plan(n, r) {
  const band = bandOf(n);
  let size, t;
  if (n <= 2) { size = 3; t = 3; }
  else if (n <= 10) { size = 4; t = n <= 6 ? 3 : 4; }
  else if (n <= 500) { size = r() < lerp(n, 11, 200, 0.1, 1) ? 5 : 4; t = lerp(n, 11, 500, 4, 6); }
  else if (n <= 1000) { size = r() < lerp(n, 501, 560, 0.3, 0) ? 5 : 6; t = lerp(n, 501, 1000, 5.5, 9); }
  else if (n <= 1500) { size = r() < lerp(n, 1001, 1060, 0.3, 0) ? 6 : 7; t = lerp(n, 1001, 1500, 9, 12); }
  else { size = 7; t = lerp(n, 1501, 2000, 12, 14); }
  const j = n <= 10 ? 0 : r() < 0.25 ? -1 : r() < 0.33 ? 1 : 0;
  const target = Math.min(14, Math.max(3, Math.round(t) + j));
  const rcap = Math.round(lerp(n, band.from, band.to, band.rare[0], band.rare[1]));
  const dims = size <= 3 ? [5, 5] : size === 4 ? [6, 6] : size === 5 ? [7, 7] : size === 6 && target < 8 ? [8, 8] : [9, 9];
  return { band, size, target, maxWords: target + (n <= 10 ? 0 : 1), rcap, dims };
}

// --- the crossword ------------------------------------------------------------------------------
const K = (r, c) => (r + 64) * 256 + (c + 64);

/** Lay out a crossword: `base` first, then every `must` word that fits (the level's common words,
 *  longest first; up to maxWords in all), then `fill` words in the order given until `target`
 *  (its first `nOver` are common words too). Last, a common word left out takes the place of a less
 *  wanted word when it then fits (never the base; only with `swaps`, the slow part). Returns the placed words [[w, r, c, 'a'|'d'], ...] inside maxR x maxC. */
export function layout(base, must, fill, target, maxWords, maxR, maxC, r, nOver = 0, swaps = false) {
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
  function tryPut(w) {
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
    if (best) put(w, best.r0, best.c0, best.dir);
    return !!best;
  }
  put(base, 0, 0, r() < 0.65 || maxR < base.length ? 'a' : 'd');
  // Longest first (they are hardest to fit), a little mixed.
  const M = must.filter((w) => w !== base).map((w) => ({ w, k: w.length + r() * 1.2 })).sort((a, b) => b.k - a.k).map((o) => o.w);
  const F = fill.filter((w) => w !== base);
  const todoM = new Set(M), todoF = new Set(F);
  const pass = (list, todo, room) => {
    let any = false;
    for (const w of list) {
      if (!todo.has(w) || !room()) continue;
      if (tryPut(w)) { todo.delete(w); any = true; }
    }
    return any;
  };
  // Common words first; fill words only into the slots the common words leave. Then one fill word
  // at a time up to the target, giving the common words another chance after each (a new word
  // opens new crossings).
  for (let go = true; go;) {
    go = pass(M, todoM, () => placed.length < maxWords);
    go = pass(F, todoF, () => placed.length + todoM.size < target) || go;
  }
  for (;;) {
    if (pass(M, todoM, () => placed.length < maxWords)) continue;
    let one = false;
    if (placed.length < target) for (const w of F) if (todoF.has(w) && tryPut(w)) { todoF.delete(w); one = true; break; }
    if (!one) break;
  }
  // Swaps: priority = must order, then fill order.
  const prio = new Map([...must, ...fill].map((w, i) => [w, i]));
  const rebuild = (list) => { cells.clear(); placed.length = 0; for (const [w, r0, c0, d] of list) put(w, r0, c0, d); };
  // Taking a word out can leave two others touching (it ran through both) or cut the grid in two.
  const sound = () => !gridProblems(placed.map(([w, r0, c0, d]) => [w, r0 - minR, c0 - minC, d]), maxRr - minR + 1, maxCc - minC + 1).length;
  const left = swaps ? [...must, ...fill.slice(0, nOver)].filter((w) => w !== base && (todoM.has(w) || todoF.has(w))) : [];
  for (const c of left) {
    for (let i = placed.length - 1; i >= 1; i--) {
      const f = placed[i][0];
      if ((prio.get(f) ?? -1) <= prio.get(c)) continue;
      const snap = placed.slice();
      rebuild(snap.filter((_, j) => j !== i));
      if (sound() && tryPut(c)) { todoM.delete(c); todoF.delete(c); break; }
      rebuild(snap);
    }
  }
  return placed.map(([w, r0, c0, d]) => [w, r0 - minR, c0 - minC, d]);
}

// --- the ladder (shared with tools/build-word-weaver-es.mjs) -------------------------------------
/** Make levels from..count. `vocab` = [{ w, rank, lists }]: every word that may be a grid word in
 *  some band (`lists` bits: 1 Easy/Medium, 2 Hard, 4 Expert) plus every accepted word ranked within
 *  COMMON (lists 0 when it may never be a grid word). `extra` = every accepted word, sorted (a
 *  level's x = those its wheel makes, minus its grid). `kept` = levels already made (their multisets
 *  are never reused). `A` = the alphabet's { counts, maskOf, fitsIn, sortKey }. */
export function makeLadder({ count, seed, vocab, extra, kept = [], A, log = () => {} }) {
  const { counts, maskOf, fitsIn, sortKey } = A;
  const V = vocab.map((v) => ({ ...v, c: counts(v.w), m: maskOf(v.w) }));
  const EX = extra.map((w) => ({ w, c: counts(w), m: maskOf(w) }));
  // Every wheel: a multiset some band's word uses in full.
  const keys = new Map();
  for (const v of V) {
    if (!v.lists) continue;
    const k = sortKey(v.w);
    if (!keys.has(k)) keys.set(k, { key: k, size: k.length, lists: 0 });
    keys.get(k).lists |= v.lists;
  }
  const memo = new Map();
  /** A wheel's words, most said first, and per list bit: eligible ranks, common counts, base. */
  function info(key) {
    if (memo.has(key)) return memo.get(key);
    const lc = counts(key), lm = maskOf(key);
    const words = V.filter((v) => v.w.length <= key.length && !(v.m & ~lm) && fitsIn(v.c, lc)).sort((a, b) => a.rank - b.rank || (a.w < b.w ? -1 : 1));
    const commons = words.filter((v) => v.rank <= COMMON);
    const per = {};
    for (const bit of [1, 2, 4]) {
      const el = words.filter((v) => v.lists & bit);
      const full = el.filter((v) => v.w.length === key.length);
      const G = commons.filter((v) => v.lists & bit).length;
      // Prefix sums of word lengths: common words longest first (the order they are placed), then
      // the other words most said first (the fill).
      const pre = (xs) => xs.reduce((a, v) => (a.push(a[a.length - 1] + v.w.length), a), [0]);
      const cLens = pre(el.filter((v) => v.rank <= COMMON).sort((a, b) => b.w.length - a.w.length));
      const fLens = pre(el.filter((v) => v.rank > COMMON));
      per[bit] = { el, ranks: el.map((v) => v.rank), cLens, fLens, G, U: commons.length - G, base: full[0] || null };
    }
    const o = { key, words, per };
    memo.set(key, o);
    return o;
  }
  const upper = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };

  const used = new Set(kept.map((lv) => sortKey(lv.l.toLowerCase())));
  const levels = kept.slice(0, count);
  for (let n = levels.length + 1; n <= count; n++) {
    const r = rng(seed + n * 7919);
    const P = plan(n, r);
    const { band } = P;
    let { size, target } = P;
    const bit = band.list, hardish = bit !== 1;
    const lenW = bit === 4 ? 6 : bit === 2 ? 1.5 : n > 500 ? 1 : 0;
    let made = null, fallback = null;
    const failed = new Set();
    for (let round = 0; !made && round < 12; round++) {
      // The wheels that can hold `target` words within the rank cap, best first.
      const cands = [];
      for (const k of keys.values()) {
        if (k.size !== size || !(k.lists & bit) || used.has(k.key) || failed.has(k.key)) continue;
        const I = info(k.key), p = I.per[bit];
        if (!p.base || p.base.rank > P.rcap) continue;
        const pool = upper(p.ranks, P.rcap);
        if (pool < target) continue;
        const total = p.G + (p.base.rank <= COMMON ? 0 : 1);
        const est = p.U + Math.max(0, total - P.maxWords);
        if (est > band.bonusMax) continue;
        const kth = p.ranks[target - 1];
        // The grid this wheel would get: its common words up to maxWords (longest first), then fill.
        const nc = Math.min(p.G, P.maxWords), nf = Math.max(0, Math.min(target - nc, p.fLens.length - 1));
        const avgLen = (p.cLens[nc] + p.fLens[nf]) / Math.max(1, nc + nf);
        // Easy/Medium: the smallest wheel that does the job, so the richer ones are left for the
        // bigger targets later in the band (Spanish ran short of 5-letter wheels by level 450).
        const spare = bit === 1 ? 0.15 * (pool - target) : 0;
        const score = Math.max(0, est - band.aim) * 3 + est * 0.3 + Math.log10(kth) - lenW * avgLen + spare + r() * 0.35;
        cands.push({ I, p, est, score });
      }
      if (!cands.length) {
        // No wheel: one word fewer, or (at 3 words, or after six rounds) one letter more.
        if (size < 7 && (target <= 3 || round >= 6)) size++;
        else target = Math.max(3, target - 1);
        continue;
      }
      cands.sort((a, b) => a.score - b.score);
      const aim = Math.min(band.bonusMax, band.aim + Math.floor(round / 3));
      for (const c of cands.slice(0, 12)) {
        const { I, p } = c;
        const base = p.base.w;
        const elig = p.el.filter((v) => v.rank <= P.rcap);
        // More common words than the grid holds: the most said (Hard and Expert: and longest) are
        // the must words; the others go first in the fill.
        const key = (v) => Math.log10(v.rank) - lenW * 0.25 * v.w.length;
        const commons = elig.filter((v) => v.rank <= COMMON && v.w !== base).sort((x, y) => key(x) - key(y));
        const must = commons.slice(0, P.maxWords - 1).map((v) => v.w);
        const over = commons.slice(P.maxWords - 1).map((v) => v.w);
        let best = null;
        const score = (ws) => {
          const inGrid = new Set(ws.map(([w]) => w));
          const left = I.words.filter((v) => v.rank <= COMMON && !inGrid.has(v.w)).length;
          const rows = Math.max(...ws.map(([w, r0, , d]) => r0 + (d === 'd' ? w.length : 1)));
          const cols = Math.max(...ws.map(([w, , c0, d]) => c0 + (d === 'a' ? w.length : 1)));
          return { ws, rows, cols, left, score: left * 1000 + rows * cols + Math.abs(rows - cols) * 3 };
        };
        for (let a = 0; a < 40; a++) {
          // Fill words: most said first (Hard and Expert also like long words), a little mixed.
          const fill = over.concat(elig.filter((v) => v.rank > COMMON).map((v) => ({ w: v.w, k: Math.log10(v.rank) - lenW * 0.25 * v.w.length + r() * 0.3 }))
            .sort((x, y) => x.k - y.k).map((o) => o.w));
          const seedA = Math.floor(r() * 4294967296);
          const ws = layout(base, must, fill, target, P.maxWords, P.dims[0], P.dims[1], rng(seedA), over.length);
          if (ws.length < target) continue;
          const s = score(ws);
          if (!best || s.score < best.score) best = { ...s, fill, seedA };
          if (s.left === 0 && a >= 10) break;
        }
        // The best layout again, now letting a left-out common word take a less wanted word's place.
        if (best && best.left) {
          const s = score(layout(base, must, best.fill, target, P.maxWords, P.dims[0], P.dims[1], rng(best.seedA), over.length, true));
          if (s.ws.length >= target && s.left < best.left) best = s;
        }
        if (!best) { failed.add(I.key); continue; }
        if (best.left <= aim) { made = { I, best }; break; }
        if (best.left <= band.bonusMax && (!fallback || best.left < fallback.best.left)) fallback = { I, best };
        failed.add(I.key);
      }
      if (!made && fallback && round >= 5) made = fallback;
      if (!made && round % 3 === 2) target = Math.max(3, target - 1);
    }
    if (!made && fallback) made = fallback;
    if (!made) throw new Error(`level ${n}: no layout (size ${size}, target ${target})`);
    const { I, best } = made;
    const problems = gridProblems(best.ws, best.rows, best.cols);
    if (problems.length) throw new Error(`level ${n}: ${problems.join('; ')} ${JSON.stringify(best.ws)}`);
    const lc = counts(I.key), lm = maskOf(I.key);
    const inGrid = new Set(best.ws.map(([w]) => w));
    const x = EX.filter((e) => !inGrid.has(e.w) && e.w.length <= I.key.length && !(e.m & ~lm) && fitsIn(e.c, lc)).map((e) => e.w);
    levels.push({
      l: I.key.toUpperCase(),
      g: [best.rows, best.cols],
      w: best.ws.map(([w, r0, c0, d]) => [w.toUpperCase(), r0, c0, d]),
      x: x.map((w) => w.toUpperCase()),
    });
    used.add(I.key);
    if (n % 250 === 0) log(`  ${n} levels made`);
  }
  return levels;
}

/** Every rule a level's grid must keep; returns a list of problems (empty = good). Same checks as
 *  word-weaver/js/data-test.js. */
export function gridProblems(words, rows, cols) {
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
  const said = new Map(), rankOf = new Map();
  for (const [i, line] of fs.readFileSync(await cached(FREQ_URL, 'en_full.txt'), 'utf8').split('\n').entries()) {
    const [w, n] = line.split(' ');
    if (w && !said.has(w)) { said.set(w, Number(n) || 0); rankOf.set(w, i + 1); }
  }
  const names = new Set();
  for (const [i, u] of NAME_URLS.entries()) {
    for (const n of fs.readFileSync(await cached(u, `names-${i}.txt`), 'utf8').split(/\r?\n/)) if (n.trim()) names.add(n.trim().toLowerCase());
  }
  const ok = (w) => /^[a-z]{3,7}$/.test(w) && enable.has(w) && !isBad(w) && !BLOCK_RE.test(w);
  const grid = [...level.keys()].filter((w) => level.get(w) <= GRID_LEVEL && ok(w) && !GRID_BLOCK.has(w)
    && (said.get(w) || 0) >= MIN_SAID_GRID && (!names.has(w) || level.get(w) <= CORE_LEVEL || NAME_OK.has(w))).sort();
  const extra = [...new Set([...grid, ...[...level.keys()].filter((w) => level.get(w) <= EXTRA_LEVEL && ok(w) && !names.has(w))])].sort();
  const rank = (w) => rankOf.get(w) || Infinity;

  // The grid lists, one bit each: 1 Easy/Medium (`grid`), 2 Hard, 4 Expert. Short words are where the
  // junk is (ERST, PSIS, SETT, THEW): a 3- or 4-letter Hard/Expert grid word must be an Easy/Medium
  // grid word. Plus every accepted COMMON word (lists 0 if it may never be a grid word), so the
  // generator can count the common words a wheel would leave as bonus words.
  const inGrid = new Set(grid);
  const hardOk = (w, L) => level.get(w) <= L.scowl && (said.get(w) || 0) >= L.said && (w.length >= 5 || inGrid.has(w))
    && !GRID_BLOCK.has(w) && !EXPERT_BLOCK.has(w);
  const vocab = [];
  for (const w of extra) {
    const lists = (inGrid.has(w) ? 1 : 0) | (hardOk(w, HARD_LIST) ? 2 : 0) | (hardOk(w, EXPERT_LIST) ? 4 : 0);
    if (lists || rank(w) <= COMMON) vocab.push({ w, rank: rank(w), lists });
  }
  console.log(`grid words ${grid.length}, hard ${vocab.filter((v) => v.lists & 2).length}, expert ${vocab.filter((v) => v.lists & 4).length}, extra ${extra.length}, common extras never in a grid ${vocab.filter((v) => !v.lists).length}`);

  // Keep what has shipped (append-only).
  const kept = [];
  if (!FRESH && fs.existsSync(path.join(OUT, 'index.json'))) {
    const idx = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
    for (let k = 0; k * CHUNK < idx.count; k++) kept.push(...JSON.parse(fs.readFileSync(path.join(OUT, `levels-${k}.json`), 'utf8')).levels);
  }
  if (REPLACE_FROM > 0 && kept.length >= REPLACE_FROM) kept.length = REPLACE_FROM - 1;
  const levels = makeLadder({ count: COUNT, seed: SEED, vocab, extra, kept, A: { counts, maskOf, fitsIn, sortKey }, log: console.log });
  writeLevels(OUT, levels);
  writeRanks(path.join(ROOT, 'tools/word-weaver-ranks-en.txt'), levels, (w) => rank(w.toLowerCase()), 'FrequencyWords en 2018 (en_full.txt line number)');
  console.log(`levels ${levels.length} (kept ${kept.length})`);
  report(levels, (w) => rank(w.toLowerCase()), console.log);
}

/** Write index.json and levels-<k>.json (one level a line); a shorter run leaves no stale chunk. */
export function writeLevels(out, levels) {
  fs.mkdirSync(out, { recursive: true });
  for (let k = 0; k * CHUNK < levels.length; k++) {
    const part = levels.slice(k * CHUNK, (k + 1) * CHUNK);
    fs.writeFileSync(path.join(out, `levels-${k}.json`), `{"v":1,"first":${1 + k * CHUNK},"levels":[\n${part.map((lv) => JSON.stringify(lv)).join(',\n')}\n]}\n`);
  }
  for (let k = Math.ceil(levels.length / CHUNK); fs.existsSync(path.join(out, `levels-${k}.json`)); k++) fs.rmSync(path.join(out, `levels-${k}.json`));
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ v: 1, count: levels.length, chunk: CHUNK }) + '\n');
}

/** The data tests' copy of the ranks (they run offline): every word in the levels ranked within
 *  RANKS_KEPT, one "WORD RANK" a line, most said first. A word not listed is rarer. */
export const RANKS_KEPT = 60000;
export function writeRanks(file, levels, rank, source) {
  const ws = new Set(levels.flatMap((lv) => [...lv.w.map((e) => e[0]), ...lv.x]));
  const rows = [...ws].map((w) => [w, rank(w)]).filter(([, k]) => k <= RANKS_KEPT).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  fs.writeFileSync(file, `# GENERATED by tools/build-word-weaver-data.mjs / build-word-weaver-es.mjs: never hand-edit.\n# ${source}; words of the levels ranked within ${RANKS_KEPT}.\n${rows.map(([w, k]) => `${w} ${k}`).join('\n')}\n`);
}

/** The ramp, band by band and across each band's edges (the numbers in the 2026-11-01 review). */
export function report(levels, rank, log) {
  const avg = (xs) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : 0);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
  const fmt = (k) => (k === Infinity ? 'rare' : String(Math.round(k)));
  const row = (name, part) => {
    const ws = part.flatMap((lv) => lv.w.map((e) => e[0]));
    return `${name.padEnd(16)} letters ${avg(part.map((lv) => lv.l.length)).toFixed(1)}  grid ${avg(part.map((lv) => lv.w.length)).toFixed(1)}  len ${avg(ws.map((w) => w.length)).toFixed(2)}`
      + `  bonus ${avg(part.map((lv) => lv.x.length)).toFixed(1)}  common bonus ${avg(part.map((lv) => lv.x.filter((w) => rank(w) <= COMMON).length)).toFixed(2)}`
      + ` (max ${Math.max(...part.map((lv) => lv.x.filter((w) => rank(w) <= COMMON).length))})  grid median rank ${fmt(med(ws.map(rank)))}`
      + `  rarest median ${fmt(med(part.map((lv) => Math.max(...lv.w.map((e) => rank(e[0]))))))}`;
  };
  for (const [name, a, z] of [['Easy 1-100', 1, 100], ['Easy 101-500', 101, 500], ['Medium 501-750', 501, 750], ['Medium 751-1000', 751, 1000],
    ['Hard 1001-1250', 1001, 1250], ['Hard 1251-1500', 1251, 1500], ['Expert 1501-1750', 1501, 1750], ['Expert 1751-2000', 1751, 2000]]) {
    if (levels.length >= z) log(row(name, levels.slice(a - 1, z)));
  }
  for (const e of [500, 1000, 1500]) {
    if (levels.length < e + 25) continue;
    log(row(`${e - 24}-${e}`, levels.slice(e - 25, e)));
    log(row(`${e + 1}-${e + 25}`, levels.slice(e, e + 25)));
  }
}

// tools/build-word-weaver-es.mjs imports the ramp and the crossword layout above; main runs only when called.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err); process.exit(1); });
