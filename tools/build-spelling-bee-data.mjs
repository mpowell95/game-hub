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
//     proper nouns, abbreviations and odd spellings.
//   * BONUS words (`extra`: accepted and scored, never in hints or ranks) = ENABLE words that are ALSO
//     in SCOWL size 70, not a first name, AND on the hand-checked BONUS_KEEP list. (The candidates read
//     for BONUS_KEEP were picked by how often FrequencyWords en 2018 (Hermit Dave, OpenSubtitles, CC BY-SA
//     4.0) says them: MIN_SAID+ first, 10-49 on 2026-10-28; the count no longer gates a kept word.) Until 2026-10-26 it was every ENABLE word, and Matt found CRATCH,
//     CRANCH, HANT, ANNA, CARL ("Why are you allowing so many names?... words that I'm pretty sure
//     aren't words"). Words a player already found keep counting (spelling-bee/js/ui.js `_kept`).
//   * NAMES: a word in either first-name list (dominictarr/random-name, smashew/NameDatabases, both
//     MIT) is never a BONUS word (ANNA, CARL). The answers are left alone: their names are words first
//     (TEDDY, JOEY, GRAHAM).
//   * LDNOOBW English bad-word list (CC BY 4.0) plus BLOCK below: dropped entirely, EXCEPT the hand-checked
//     ADULT_KEEP (2026-10-29), which are bonus words.
//
// RULES (the NYT game's): 4+ letters, no S anywhere, at most 7 different letters.
//
// WHAT IS WRITTEN
//   bee.json { v, epoch, words: "space separated", extra: "space separated", puzzles: ["c:abdeg", ...] }
//   A puzzle is its centre letter, ':', then the six outer letters. Answers are not stored: the game
//   works them out from `words` (spelling-bee/js/engine.js `answersFor`), which keeps the file small.
//   Puzzle #n (n = whole days since `epoch`, local time) is puzzles[n % count].
//
// THE PUZZLE ORDER IS APPEND-ONLY (2026-10-26 the days after Oct 31 were re-picked once for the bigger
// list, 25-90 answers). REPLACE swaps a too-small day once; the old puzzle is written under `retired`
// (day -> old letters) so the game still shows anyone's progress on it. Saves are keyed by the puzzle's letters, not its
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
const BONUS_LEVEL = 70;
const MIN_SAID = 50;
// HAND-CHECKED (2026-10-26): every candidate the filters below let through (789) was read, and only
// these real, recognisable words were kept. Place names (COLORADO), foreign words (VIER), surnames,
// archaic forms (AFORE) and odd Scrabble words were left out. A candidate NOT on this list is not a bonus
// word, so a re-run with newer sources never lets new junk in unseen: read the new ones, add the good.
// 2026-10-28 (after Spanish refused GONADA; Matt: "do what you think is best"): a hand-checked word no longer
// also needs MIN_SAID (FUNGO, said 7 times, was refused), and the 824 SCOWL-70 words said 10-49 times were
// read; the recognisable ones are the block added at the end (slurs, archaic and Scrabble words left out).
const BONUS_KEEP = new Set(`
  accelerant actin aikido airboat airframe albedo alchemical alginate alopecia amygdala anabolic angiogram
  apnea arcana armoire arnica attaboy auteur axeman backbeat bambino bechamel bedouin bellflower belvedere
  bended bigfoot billabong bioengineering biogenic birdman brachial brumby brut bubonic cabernet cacciatore
  calzone campion candela cannoli cannula cantina capybara caracara carioca cartoony cautery celadon celiac
  cellblock challah charnel chewable chinook chorizo chroma citrate corniche corrida creatine creatinine
  croaker cubby cupbearer cutwater cyanotic daikon decoction decrypt decrypted deltoid diazepam doornail
  doozy doughboy dozer dreidel duffel dugong durian earthman earthmen ecotone ectopic eidetic electro
  empanada epically everyman evite expander fakery falafel fatted firebird flathead flytrap focaccia frag
  frittata froggy gamelan gawker genomic glitchy glom glutamate goby goldeneye golem gonzo gothic grappa
  grappler grayling grift grifter gunplay hadron handoff hardwired heartbreaker hearted hellhound hematoma
  henbane hypoxia icefall ideation igniter iguanodon ikebana iliac illuminati impaler intubate jillion
  jodhpur jughead juju juke kahuna kakapo keycard kimchi klatch koto kraken kremlin kudu kulak latino lockbox
  lollapalooza loverly lurker luxe mako mandragora manhattan manicotti marmite martian matchup medevac
  meerkat meltwater merengue mezuzah midline minke mojo multimillion muncher norepinephrine occipital olivine
  opioid orca oryx outthink oxytocin pandit panzer papilloma penne peridot photonic picklock pika pineal
  playa pleural polenta porkpie porphyria pouty ranchero rancho recut recycler redline reflux regenerator
  rehydrate relatable remora retractor revenant riddler ringtail roulade tach taipan tantric tarnation
  taverna telluride tetherball tiffin tiki tinhorn titrate torero trattoria trebuchet tuff tupelo turndown
  unburied unclench undead unelected untethered untuck unturned valerian veiny venetian wahoo warfarin
  wendigo wheelman whirly witchy woodruff yenta yippie youngling ziggurat zirconia ziti
  adenoma adoptee aglet aldehyde allocator alveoli atlatl avocet backbend ballade beanball bialy biotic boreal
  brio bubbler bulgur calendula caracal certiorari chador chilidog chitter cichlid cioppino citrine clubby coati
  coatrack collegial comparator corkboard cordwood cuke curette danceable datable deadeye deadfall examinee
  fader fennec freeform fungo germy gluteal googol grippy groaner growly halvah headachy hepcat hiatal hoopoe
  illiquid incapacitation jitter kayaker keloid kelpie koan latke leaker lethality liger liminal loupe luffa
  menhir minyan muon mudra myelin nitrile nudnik octillion oiler orangy orrery orthotic overeater panettone
  pantaloon peacoat peplum perlite phyllo piercer pomelo precut propylene puffery qualia ragtop rebook recode
  recoded redbud redlined repro retune rewrap rocketeer tahini tamari tamarin tannic tartlet taurine techy
  tefillin tempeh terraform trinary tuatara unglue unlink untaxed updo varicella wildling wobbler`.split(/\s+/).filter(Boolean));
const FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt';
const NAME_URLS = ['https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt',
  'https://raw.githubusercontent.com/smashew/NameDatabases/master/NamesDatabases/first%20names/us.txt'];
const KEEP = 10;   // days 0-9 (Oct 22-31 2026): shipped before the 2026-10-26 re-pick
// Days swapped for a fuller puzzle (Matt, 2026-10-26: "I hate today's puzzle", 23 words). day -> the
// letters it had; swapped only while it still has them, so a re-run never swaps twice.
const REPLACE = { 2: 'o:hilprw', 4: 'u:dfgino', 6: 'e:ijlnuv' };

// ADULT WORDS AND PROFANITY (2026-10-29, Matt, refused VAGINA: "Words like this and profanity should count"):
// BONUS words only, never answers (hints, ranks and Yesterday's Answers never show them), HAND-CHECKED like
// BONUS_KEEP, and they skip the bad-word, name (DICK, WILLY) and ENABLE/SCOWL filters. Slurs stay out (never add
// one here), and so do RAPE, RAPED, RAPING, PEDOPHILE, JAILBAIT.
const ADULT_KEEP = new Set(`
  anal bareback bimbo bitch bitchy blowjob bondage boner boob boobie booby bugger bullcrap butt butthead
  butthole clit cocaine cock crap crapper crappy cunt dammit damn damned damnit dick dickhead dildo domination
  douchebag erotic eunuch fecal fellatio fingering fuck fucked fucker fuckhead fuckin fucking fuckup gangbang
  goddam goddamn grope handjob hardcore harlot hell heroin hooker horny humping jizz kinky lynch nipple nude
  nudity nympho orgy panty pecker pegging penial penile playboy porn porno prick queef rectum rimming titty
  trollop turd twat vagina vibrator voyeur vulva wank wanker wench`.split(/\s+/).filter(Boolean));

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

  const level = new Map();   // word -> the smallest SCOWL size that has it
  for (const l of [...LEVELS, BONUS_LEVEL]) {
    for (const p of ['english', 'american']) {
      const f = path.join(dir, 'package', `${p}-words-${l}.json`);
      if (fs.existsSync(f)) for (const w of JSON.parse(fs.readFileSync(f, 'utf8'))) if (!level.has(w)) level.set(w, l);
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
  const fits = (w) => /^[a-z]{4,}$/.test(w) && !w.includes('s') && enable.has(w) && !bad.has(w) && bits(maskOf(w)) <= 7;
  const words = [...level.keys()].filter((w) => level.get(w) <= LEVELS[LEVELS.length - 1] && fits(w)).sort();
  const answerSet = new Set(words);
  const extra = [...level.keys()]
    .filter((w) => !answerSet.has(w) && level.get(w) <= BONUS_LEVEL && !names.has(w) && BONUS_KEEP.has(w) && fits(w))
    .concat([...ADULT_KEEP].filter((w) => /^[a-z]{4,}$/.test(w) && !w.includes('s') && bits(maskOf(w)) <= 7 && !answerSet.has(w)))
    .filter((w, i, a) => a.indexOf(w) === i)
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
      if (n >= 25 && n <= 90 && pts >= 80 && pts <= 450) options.push({ b, n });
    }
    if (options.length) candidates.push({ pm, options });
  }

  const rand = rng(20261022);
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  const puzzles = [];
  for (const c of candidates.slice(0, DAYS + KEEP)) {
    const centre = c.options[Math.floor(rand() * c.options.length)].b;
    let outer = '';
    for (let b = 0; b < 26; b++) if ((c.pm & (1 << b)) && b !== centre) outer += String.fromCharCode(97 + b);
    puzzles.push(String.fromCharCode(97 + centre) + ':' + outer);
  }

  const file = path.join(ROOT, 'spelling-bee/data/bee.json');
  // Every shipped puzzle keeps its day; this run only appends (and makes the REPLACE swaps once).
  let kept = [];
  let retired = {};
  try {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    kept = prev.puzzles || [];
    retired = prev.retired || {};
  } catch { /* first run */ }
  if (kept.length) {
    const setOf = (q) => [...q.replace(':', '')].sort().join('');   // the 7 letters, whatever the centre
    const seen = new Set([...kept, ...Object.values(retired)].map(setOf));
    for (const q of puzzles) {
      if (kept.length >= DAYS) break;
      if (!seen.has(setOf(q))) { kept.push(q); seen.add(setOf(q)); }
    }
    // Replacements: unused letter sets, the centre with the most answers in 45-70.
    const spare = [];
    for (const c of candidates.slice(DAYS + KEEP)) {
      const best = c.options.filter((o) => o.n >= 45 && o.n <= 70).sort((a, b) => b.n - a.n)[0];
      if (!best) continue;
      let outer = '';
      for (let b = 0; b < 26; b++) if ((c.pm & (1 << b)) && b !== best.b) outer += String.fromCharCode(97 + b);
      const q = String.fromCharCode(97 + best.b) + ':' + outer;
      if (!seen.has(setOf(q))) spare.push(q);
    }
    for (const [day, old] of Object.entries(REPLACE)) {
      if (kept[day] !== old || retired[day]) continue;
      const q = spare.shift();
      retired[day] = old;
      kept[day] = q;
      seen.add(setOf(q));
    }
    puzzles.length = 0;
    puzzles.push(...kept);
  }
  const out = { v: 1, epoch: EPOCH, words: words.join(' '), extra: extra.join(' '), puzzles, retired };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out) + '\n');
  console.log(`words ${words.length}, extra ${extra.length}, pangram sets ${sets.length}, fair ${candidates.length}, puzzles ${puzzles.length}, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
