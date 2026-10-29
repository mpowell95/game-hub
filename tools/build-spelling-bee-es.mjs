// build-spelling-bee-es.mjs - GENERATOR for spelling-bee/data/bee-es.json (Spelling Bee in Spanish,
// Matt, 2026-10-26: "make it ... similar results to the english version, in that it's fun to play").
// Run it, then `node tools/validate-sw-assets.mjs`, then commit both files.
//
//   node tools/build-spelling-bee-es.mjs [--cache <dir>] [--days 2000]
//
// THE SAME GAME AS ENGLISH (tools/build-spelling-bee-data.mjs), with Spanish sources:
//   * ACCEPTED = every word in boggle/data/words-es.txt (RLA-ES, MPL 1.1, folded; see
//     boggle/data/CREDITS.md) plus every inflected form in lemmatization-lists (Michal Boleslav
//     Mechura, ODbL) whose lemma or form is in that list. The second source brings the conjugations
//     ("tengo", "hacen") that Boggle's list leaves out on purpose: "all words should count".
//   * BONUS words: EVERY other accepted word, never a first name (the same two name lists as English,
//     MIT, plus NOT_ANSWERS) unless NAME_WORDS says it is also an ordinary word (luna, clara, julio).
//     Until 2026-10-28 a bonus word also had to be in the subtitle list and in lemmatization-lists:
//     that refused ~30,000 dictionary words (Ana: GONADA; "some normal words ... are not registered")
//     and DONDE, ALLI, LUNA, PALOMA. Spanish has no CRATCH problem: Boggle's list is a dictionary.
//   * ANSWERS (what hints and ranks count) = accepted words that are in BOTH sources and among the
//     20,000 most frequent words of FrequencyWords es 2018 (Hermit Dave, OpenSubtitles, CC BY-SA 4.0),
//     minus NOT_ANSWERS (names and loanwords that survive both lists). 20,000 gives ~48 answers a
//     puzzle, English's ~51. The rest of ACCEPTED is `extra` (bonus words).
//   * COMMON words Boggle's list lacks (2026-10-28: DEDO, RODILLA, TORTILLA were refused): every
//     lemmatization-lists word that is also in the subtitle list, is bonus too, except names, words that
//     are also English (city, drive: SPANISH_TOO keeps the Spanish ones) and SKIP (slang, places, brands).
//   * Ñ IS ITS OWN LETTER, accents are not (Ana, 2026-10-26: "Ñ is different from n. But for the vowels
//     it doesn't matter... For the rest do not use accents"). Every word is written without accents and
//     with its ñ ("nino" is not "niño"); a puzzle can have Ñ in the hive. Boggle's list folds ñ to n, so
//     its words get their ñ back from the two spelled sources (`variants`).
//   * LDNOOBW es (CC BY 4.0) plus BLOCK below: never answers. Since 2026-10-29 (Matt, after English refused
//     VAGINA: "Words like this and profanity should count") they are BONUS words, by the bonus rules above,
//     except SLURS. All 269 such words were read that day; the filter also caught ordinary
//     words (infierno, concha, folleto, follaje, coñac), now bonus too.
//   * RULES: 4+ letters, no S, at most 7 different letters (the NYT rules, as English).
//
// WHAT IS WRITTEN
//   bee-es.json { v, lang: 'es', epoch, words, extra, puzzles, retired } (letters a-z and ñ, no accents)
//   The game keys a Spanish puzzle "es:<c>:<outer>" (spelling-bee/js/engine.js), so it can never share
//   a save or a daily board with an English puzzle on the same letters.
//
// THE PUZZLE ORDER IS APPEND-ONLY once shipped (as English): a re-run keeps every shipped puzzle.
// One exception, made once: the first build folded Ñ to N; its list was dropped on 2026-10-26 (only
// day 0 had been shown, played by the test account alone) and day 0's letters kept under `retired`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const CACHE = arg('--cache', path.join(os.tmpdir(), 'spelling-bee-es-cache'));
const DAYS = Number(arg('--days', 2000));
const EPOCH = '2026-10-26';
const TOP = 20000;
export const FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt';
export const LEM_URL = 'https://raw.githubusercontent.com/michmech/lemmatization-lists/master/lemmatization-es.txt';
export const NAME_URLS = ['https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt',
  'https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/first%20names/us.txt'];
export const BAD_URL = 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/es';

// Vulgarities and slurs LDNOOBW misses or lists only as phrases. A family hub: when in doubt, out.
export const BLOCK = `puta puto putas putos mierda cabron cabrona joder jodido jodida polla culo verga pendejo pendeja
pinche chingar chingada marica maricon follar zorra cono tetas teta pene vagina nazi cocaina heroina droga
drogas mamada paja pajero perra perro`.split(/\s+/).filter((w) => w !== 'perro');
// LDNOOBW es over-catches ordinary words; these stay in (contexto's allow-list does the same).
export const ALLOW = new Set(['martillo']);
// Accepted (bonus) but never answers: names and loanwords that both dictionaries happen to carry.
export const NOT_ANSWERS = new Set(`maria mariana martin martina rita atenea boom rain tate bane irene elena
diana alicia adela amelia andrea angela aurora carmen cecilia celia clara cora dora elisa ema emilia
eva flora gloria ina iria julia laura lola lucia luna marina marta mercedes nina nora olga paloma paula
pilar regina rina rocio rosa rosario teresa victoria alberto antonio benito carlos david felipe
gabriel ignacio juan julio lorenzo manuel mario pablo pedro ramon roberto ramiro tomas victor carla leila
lidia noemi raquel miriam karina nadia natalia yolanda irma lorena teo tito adan eden`.split(/\s+/).filter((w) => w !== 'tito'));
// Families of vulgar words.
// On a name list but ordinary Spanish words (hand-checked 2026-10-28): accepted as bonus words.
export const NAME_WORDS = new Set(`adore adorne alameda aleen aleta alexia alia alie alla alli amparo angelica arda
atlante aurea aurora aviva azucena beata bobina bobine brear brinda bula calandra camelia camella candida
carena carie chandal clara clemente codee concha concordia crin dale dalia diana dominica dora dore doro eden edita
elida emerita farra felicita filia fleta flora fonda gema germana gloria grata iluminada jacinto julio kelvin
lavada leda lian lien lira loan loma lucio luna magnolia malva mana mariano marina mella mica mora natividad
nereida ninfa nona opalina paloma petunia pilar randa refugia rema reta roda rubi tiara tilda trinidad
valencia veda veta victoria`.split(/\s+/));
// COMMON words (header) that English also has but are ordinary Spanish (hand-checked 2026-10-28).
export const SPANISH_TOO = new Set(`adorable banana banjo bilateral bipolar buffet bulldog cocktail corrector dandy derby
dharma dingo futon ghetto gigolo glaucoma graffiti henna inflexible inventor irregular irreparable irritable
jockey judo kamikaze karate kayak kimono kiwi koala lamentable lemur mahatma mozzarella nylon papilla poker
quark rally reactor reggae retina reunion rumba tarot terrier tortilla venerable yeti yoga yuan zeppelin`.split(/\s+/));
// COMMON words left out (hand-checked 2026-10-28): rude, slang, places, brands, names the lists missed.
export const SKIP = new Set(`perra droga pene zorra cocaina vagina paja teta playboy pedofilo culito picha cagon pajero
ninfomana drogata huevon macarra yonqui papi chachi cholo chapera paco online apache yankee yoda brando wichita
bora genova etiopia touche duce olimpo renard chechenia abba cardio valhalla thai colombo kame caprica fane buro
paulino vichy provo pullman ruanda maitre tintin polaroid trafalgar macon lando belcebu trullo albin rocha
cocker airbag titi letonia figaro egeo mahdi pepito dojo donut cucu`.split(/\s+/));
export const BLOCK_RE = /coñ|^put[aoe]|mierd|^jod[aeoi]|cabron|foll[aeo]|ching|^polla$|pendej|maric/;
// Blocked words that stay out even as bonus words (2026-10-29): slurs only (Matt: words with bad meanings are
// still words; PEDOFILO counts).
export const SLURS = new Set(`marica maricon amaricado amaricada marimarica bollera nazi cholo`.split(/\s+/));
// SKIP's rude words, bonus since 2026-10-29 (SKIP's places, brands and names stay out).
export const ADULT_SKIP = new Set(`perra droga pene zorra cocaina vagina paja teta playboy culito picha cagon pajero
ninfomana drogata huevon pedofilo`.split(/\s+/));
const FIRST_BUILD_DAY0 = 'o:aeimnt';   // the folded build's day 0 (see the header)

// Accents off, ñ kept (engine.js `fold` does the same to what a player types).
export const fold = (w) => w.toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0001/g, 'ñ');
export const flat = (w) => fold(w).replace(/ñ/g, 'n');   // Boggle's form, to match its list
const WORD = /^[a-zñ]+$/;
const idx = (c) => (c === 'ñ' ? 26 : c.charCodeAt(0) - 97);
const chr = (k) => (k === 26 ? 'ñ' : String.fromCharCode(97 + k));
const maskOf = (w) => { let m = 0; for (const c of w) m |= 1 << idx(c); return m; };
const bits = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const score = (w, pangram) => (w.length === 4 ? 1 : w.length) + (pangram ? 7 : 0);
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function cached(url, file) {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const txt = await res.text();
  fs.writeFileSync(p, txt);
  return txt;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const bad = new Set((await cached(BAD_URL, 'bad-es.txt')).split('\n').map((w) => fold(w.trim())).filter((w) => w && !ALLOW.has(w)));
  for (const w of BLOCK) bad.add(w);

  const A = new Set(fs.readFileSync(path.join(ROOT, 'boggle/data/words-es.txt'), 'utf8').split('\n').map((w) => w.trim().toLowerCase()).filter(Boolean));
  const L = new Set();             // every lemma and form in lemmatization-lists (accents off, ñ kept)
  const B = new Set();             // forms it brings in (its lemma or the form is in A)
  const variants = new Map();      // Boggle form -> the ñ-spellings seen in a source ("nino" -> niño)
  const seenAs = (w) => { const k = flat(w); if (!variants.has(k)) variants.set(k, new Set()); variants.get(k).add(w); };
  for (const line of (await cached(LEM_URL, 'lemmatization-es.txt')).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const [lemma, form] = line.split('\t');
    if (!form) continue;
    for (const raw of [lemma, form]) {
      const f = fold(raw);
      if (!WORD.test(f)) continue;
      L.add(f);
      seenAs(f);
    }
    const ff = fold(form);
    if (WORD.test(ff) && (A.has(flat(lemma)) || A.has(flat(ff)))) B.add(ff);
  }
  const names = new Set();
  for (const [i, u] of NAME_URLS.entries()) {
    for (const n of (await cached(u, `names-${i}.txt`)).split(/\r?\n/)) if (n.trim()) names.add(fold(n.trim()));
  }
  const rank = new Map();
  for (const [i, line] of (await cached(FREQ_URL, 'es_50k.txt')).split(/\r?\n/).entries()) {
    const f = fold(line.split(' ')[0] || '');
    if (!f || !WORD.test(f) || rank.has(f)) continue;
    rank.set(f, i);   // subtitles often drop the tilde ("nino"), so they rank words but never spell them
  }
  // Boggle's words, with their ñ restored where a source spells them so ("pena" -> pena and peña).
  const fromA = [];
  for (const w of A) { const v = variants.get(w); if (v) fromA.push(...v); else fromA.push(w); }

  const shape = (w) => w.length >= 4 && WORD.test(w) && !w.includes('s') && bits(maskOf(w)) <= 7;
  const clean = (w) => !bad.has(w) && !BLOCK_RE.test(w);
  const fits = (w) => shape(w) && clean(w);
  const accepted = [...new Set([...fromA, ...B])].filter(fits).sort();
  const words = accepted.filter((w) => L.has(w) && rank.has(w) && rank.get(w) < TOP && !NOT_ANSWERS.has(w));
  const answerSet = new Set(words);
  // Bonus words: every other accepted word, never a name unless it is also an ordinary word (header).
  const isName = (w) => (names.has(w) || NOT_ANSWERS.has(w)) && !NAME_WORDS.has(w);
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'spelling-bee/data/bee.json'), 'utf8'));
  const english = new Set(`${en.words} ${en.extra}`.split(' '));
  const acceptedSet = new Set(accepted);
  const common = [...L].filter((w) => fits(w) && !acceptedSet.has(w) && rank.has(w) && !names.has(w) && !SKIP.has(w) && (!english.has(w) || SPANISH_TOO.has(w)));
  // Adult words and profanity (header): the bonus rules without the bad-word filter, never answers.
  const adultOk = (w) => shape(w) && !clean(w) && !SLURS.has(w) && !isName(w);
  const adult = [...new Set([...fromA, ...B])].filter(adultOk)
    .concat([...L].filter((w) => adultOk(w) && rank.has(w) && (!SKIP.has(w) || ADULT_SKIP.has(w))));
  const extra = [...new Set([...accepted.filter((w) => !answerSet.has(w) && !isName(w)), ...common, ...adult])].sort();

  const masks = words.map(maskOf);
  const sets = [...new Set(masks.filter((m) => bits(m) === 7))].sort((a, b) => a - b);
  const candidates = [];
  for (const pm of sets) {
    const options = [];
    for (let b = 0; b < 27; b++) {
      const cm = 1 << b;
      if (!(pm & cm)) continue;
      let n = 0, pts = 0;
      for (let i = 0; i < words.length; i++) {
        if ((masks[i] & ~pm) || !(masks[i] & cm)) continue;
        n++; pts += score(words[i], masks[i] === pm);
      }
      // As English: 25-90 answers, 80-450 points.
      if (n >= 25 && n <= 90 && pts >= 80 && pts <= 450) options.push(b);
    }
    if (options.length) candidates.push({ pm, options });
  }
  // Spanish has fewer pangram sets than English, so a set may come back with a second centre letter
  // (a different puzzle: different answers), at least a year after the first.
  const rand = rng(20261026);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  shuffle(candidates);
  const pick = (c, b) => { let outer = ''; for (let k = 0; k < 27; k++) if ((c.pm & (1 << k)) && k !== b) outer += chr(k); return chr(b) + ':' + outer; };
  const firsts = candidates.map((c) => { shuffle(c.options); return pick(c, c.options[0]); });
  const seconds = shuffle(candidates.filter((c) => c.options.length > 1).map((c) => pick(c, c.options[1])));
  const fresh = [...firsts, ...seconds];

  const file = path.join(ROOT, 'spelling-bee/data/bee-es.json');
  let puzzles = [];
  let retired = {};
  try { const prev = JSON.parse(fs.readFileSync(file, 'utf8')); puzzles = prev.puzzles || []; retired = prev.retired || {}; } catch { /* first run */ }
  if (puzzles[0] === FIRST_BUILD_DAY0 && !retired[0]) { retired = { 0: FIRST_BUILD_DAY0 }; puzzles = []; }   // once (header)
  const setOf = (q) => q;   // a puzzle is its letters AND its centre here
  const seen = new Set(puzzles.map(setOf));
  for (const q of fresh) {
    if (puzzles.length >= DAYS) break;
    if (!seen.has(setOf(q))) { puzzles.push(q); seen.add(setOf(q)); }
  }
  // Only bonus words some puzzle (shipped or retired) can make: 133 KB gzipped instead of 218.
  const hives = [...puzzles, ...Object.values(retired)].map((q) => { const [c, o] = q.split(':'); return { c: maskOf(c), all: maskOf(c + o) }; });
  const playable = extra.filter((w) => { const m = maskOf(w); return hives.some((h) => (m & h.c) && !(m & ~h.all)); });
  const out = { v: 1, lang: 'es', epoch: EPOCH, words: words.join(' '), extra: playable.join(' '), puzzles, retired };
  fs.writeFileSync(file, JSON.stringify(out) + '\n');
  console.log(`words ${words.length}, extra ${playable.length}, pangram sets ${sets.length}, fair ${candidates.length}, puzzles ${puzzles.length}, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

// Word Weaver's Spanish generator (tools/build-word-weaver-es.mjs) imports the lists above; main runs only when called.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err); process.exit(1); });
