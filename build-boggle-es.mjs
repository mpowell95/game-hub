// build-boggle-es.mjs - GENERATOR for boggle/data/words-es.txt (Boggle's
// Spanish dictionary). Run it, then `node validate-sw-assets.mjs`, then commit
// both the word list and sw.js.
//
//   node build-boggle-es.mjs [--out boggle/data/words-es.txt] [--offline <dir>]
//
// WHY A GENERATOR AND NOT A CHECKED-IN LIST SOMEBODY FOUND
// -------------------------------------------------------
// English Boggle ships ENABLE, which is already a flat, public-domain list of
// exactly the word forms a word game wants. Spanish has no equivalent. The
// closest open source is RLA-ES (the LibreOffice/OpenOffice es_ES spelling
// dictionary, tri-licensed GPL-3+/LGPL-3+/MPL-1.1+; we use it under MPL 1.1 --
// see boggle/data/CREDITS.md), and that ships as hunspell's LEMMA list plus an
// affix rule file: 57k dictionary entries whose inflections are described by
// rules rather than written out. So the flat list has to be GENERATED, and
// this file is the reproducible recipe for it. Re-run it to pick up a newer
// RLA-ES release.
//
// WHAT GOES IN, AND WHY THIS SUBSET (Matt's call, 2026-09-11)
// ----------------------------------------------------------
// Expanding every hunspell paradigm would produce a full Spanish inflection
// dump: a regular verb alone carries ~50 conjugated forms, and the four verb
// paradigms in the affix file hold 2,183 rules between them. That is a
// multi-megabyte list of forms nobody traces on a 4x4 board, and every one of
// them is a word the solver has to search and the end-of-round reveal has to
// list. So the scope is deliberately narrower:
//
//   * VERBS: the infinitive, the gerund and the participle ONLY. No conjugated
//     forms at all -- no "hablo", no "hablaste", no "hablaria". A player who
//     traces a conjugated form gets the same "not in the dictionary" feedback
//     an English player gets for a word ENABLE does not carry. This is the
//     single biggest size decision in the file.
//   * PARTICIPLES INFLECT, because they are adjectives: hablado / hablada /
//     hablados / habladas, roto / rota / rotos / rotas.
//   * NOUNS AND ADJECTIVES: the lemma, its plural (hunspell flag S) and its
//     feminine forms (flag G, which carries both feminine singular and
//     feminine plural). "Adjectives in plural and both sexes should be good."
//   * PROPER NOUNS ARE EXCLUDED (any entry whose lemma is not entirely
//     lowercase), matching ENABLE, which carries none.
//
// SPELLING: NO ACCENTS, AND N STANDS IN FOR N-TILDE (also Matt's call)
// --------------------------------------------------------------------
// A Boggle die carries one plain letter. Rather than add accented faces or a
// 27th letter, every word is FOLDED to A-Z on the way in: accents are dropped
// (cancion, arbol, pais) and n-tilde becomes a plain N (anos, manana). This is
// what Spanish Boggle sets do in practice, it keeps the dice at 26 letters,
// and it means the existing QU tile, the trie, the solver and the scoring all
// work unchanged. The visible cost, accepted: "ano" and "anno"-style pairs
// collapse together, and a couple of thousand distinct Spanish spellings
// become the same board word. The folding also MERGES words, never invents
// them -- every entry here is a real RLA-ES form with its diacritics removed.
//
// The output format is exactly ENABLE's, because dict.js parses both with the
// same code: uppercase A-Z, one word per line, 3-16 letters, sorted, unique.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const SRC_BASE = 'https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/es/';
const MIN_LEN = 3;
const MAX_LEN = 16; // the longest word findable on a 4x4 board (ENABLE is cut the same way)

// ---------------------------------------------------------------------------
// Fold a Spanish spelling onto the 26 letters a Boggle die can carry.
// ---------------------------------------------------------------------------
export function fold(word) {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip every combining accent, n-tilde's included
    .toUpperCase();
}

/** Is this a word a Boggle board could ever spell? (A-Z only, right length,
 *  and at least one vowel.) The vowel test is a junk filter, not a linguistic
 *  rule: RLA-ES carries lowercase ABBREVIATIONS alongside real words (abc,
 *  adv, blv, dcha), and since every real Spanish word of 3+ letters contains a
 *  vowel, "has no vowel" removes them without a hand-maintained blocklist. */
export function isBoardWord(folded) {
  return folded.length >= MIN_LEN && folded.length <= MAX_LEN
    && /^[A-Z]+$/.test(folded) && /[AEIOU]/.test(folded);
}

// ---------------------------------------------------------------------------
// hunspell affix rules. We only ever apply two flags -- S (plural) and G
// (feminine + feminine plural) -- so this is a deliberately small subset of
// hunspell, not a general implementation: suffixes only, no prefixes, no
// cross-product, no flag-on-flag continuation.
// ---------------------------------------------------------------------------
export function parseSuffixRules(affText, flags) {
  const want = new Set(flags);
  const rules = new Map(flags.map((f) => [f, []]));
  for (const line of affText.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== 'SFX' || parts.length < 5) continue;
    const [, flag, strip, add, cond] = parts;
    if (!want.has(flag)) continue;
    // A hunspell condition is a regex fragment matched against the END of the
    // word; '.' means "no condition".
    rules.get(flag).push({
      strip: strip === '0' ? '' : strip,
      add: add === '0' ? '' : add,
      re: new RegExp(`${cond === '.' ? '' : cond}$`),
    });
  }
  return rules;
}

export function applySuffix(word, rules) {
  const out = [];
  for (const r of rules) {
    if (!r.re.test(word)) continue;
    if (r.strip && !word.endsWith(r.strip)) continue;
    out.push((r.strip ? word.slice(0, -r.strip.length) : word) + r.add);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verbs: infinitive -> gerund + participle.
//
// The four hunspell conjugation paradigms (R, E, I, X) are what marks an entry
// as a verb; we read them as a yes/no signal and generate the three forms
// ourselves rather than expanding 2,183 rules we would then throw away.
// ---------------------------------------------------------------------------
const VERB_FLAGS = ['R', 'E', 'I', 'X'];

// Irregular participles, matched as SUFFIXES of the infinitive so that every
// compound comes along for free: escribir/describir/transcribir -> -escrito,
// volver/devolver/envolver -> -vuelto, poner/componer/suponer -> -puesto.
// Order matters only in that the first match wins, so longer keys sit first.
const IRREGULAR_PARTICIPLES = [
  ['satisfacer', 'satisfecho'],
  ['escribir', 'escrito'],
  ['imprimir', 'impreso'],
  ['resolver', 'resuelto'],
  ['absolver', 'absuelto'],
  ['disolver', 'disuelto'],
  ['soltar', 'suelto'],
  ['cubrir', 'cubierto'],
  ['abrir', 'abierto'],
  ['volver', 'vuelto'],
  ['morir', 'muerto'],
  ['poner', 'puesto'],
  ['hacer', 'hecho'],
  ['decir', 'dicho'],
  ['romper', 'roto'],
  ['freír', 'frito'],
  ['freir', 'frito'],
  ['ver', 'visto'],
];

const VOWELS = 'aeiouáéíóú';

/** The gerund of an infinitive. Regular, plus the two spelling rules Spanish
 *  applies to the ending itself: -iendo becomes -yendo after a vowel (leer ->
 *  leyendo, construir -> construyendo) and loses its i after n-tilde or ll
 *  (grunir -> grunendo, bullir -> bullendo). Stem-changing gerunds (pedir ->
 *  pidiendo, dormir -> durmiendo) are NOT generated: they need a verb-by-verb
 *  table, and their regular form is what a player is most likely to trace. */
export function gerundOf(inf) {
  const stem = inf.slice(0, -2);
  const ending = inf.slice(-2);
  if (ending === 'ar') return `${stem}ando`;
  const last = stem.slice(-1);
  const last2 = stem.slice(-2);
  if (last === 'ñ' || last2 === 'll') return `${stem}endo`;
  if (VOWELS.includes(last)) return `${stem}yendo`;
  return `${stem}iendo`;
}

/** The participle of an infinitive, irregulars first. Returned WITHOUT its
 *  gender/number endings -- the caller inflects it, since a participle is an
 *  adjective (hablado/hablada/hablados/habladas). */
export function participleOf(inf) {
  for (const [suffix, form] of IRREGULAR_PARTICIPLES) {
    if (inf.endsWith(suffix)) return inf.slice(0, -suffix.length) + form;
  }
  const stem = inf.slice(0, -2);
  return inf.endsWith('ar') ? `${stem}ado` : `${stem}ido`;
}

/** A participle in all four adjective forms. Participles that do not end in
 *  -o (none of the regular ones, but an irregular table could grow one) are
 *  only pluralised. */
export function inflectParticiple(part) {
  if (!part.endsWith('o')) return [part, `${part}s`];
  const stem = part.slice(0, -1);
  return [`${stem}o`, `${stem}a`, `${stem}os`, `${stem}as`];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
async function readSource(name, offlineDir) {
  if (offlineDir) return fs.readFileSync(path.join(offlineDir, name), 'utf8');
  const res = await fetch(SRC_BASE + name);
  if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
  return res.text();
}

/** Every entry of the hunspell .dic as { lemma, flags:Set }, with duplicate
 *  lemmas UNIONED -- RLA-ES lists e.g. `perro/NS` and `perro/SG` as separate
 *  entries, and reading only the first would lose the feminine. */
export function parseDic(dicText) {
  const entries = new Map();
  const lines = dicText.split('\n');
  for (let i = 1; i < lines.length; i++) { // line 0 is the entry count
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const slash = line.indexOf('/');
    const lemma = slash === -1 ? line : line.slice(0, slash);
    const flags = slash === -1 ? '' : line.slice(slash + 1);
    if (!lemma) continue;
    // Proper nouns and abbreviations out: ENABLE has none, and a board that
    // scores "MADRID" is not playing the same game.
    if (lemma !== lemma.toLowerCase()) continue;
    if (!entries.has(lemma)) entries.set(lemma, new Set());
    for (const ch of flags) entries.get(lemma).add(ch);
  }
  return entries;
}

export function buildWordSet(entries, sfx) {
  const out = new Set();
  const add = (w) => {
    const f = fold(w);
    if (isBoardWord(f)) out.add(f);
  };

  for (const [lemma, flags] of entries) {
    add(lemma);

    const isVerb = VERB_FLAGS.some((f) => flags.has(f));
    if (isVerb && /(ar|er|ir|ír)$/.test(lemma)) {
      add(gerundOf(lemma));
      for (const form of inflectParticiple(participleOf(lemma))) add(form);
    }

    // A verb's own lemma takes no S/G: those flags are the noun/adjective
    // paradigms, and an entry can legitimately be both (decir/S the noun-ish
    // entry vs decir/X the verb), which the union above already merged.
    if (flags.has('S')) for (const w of applySuffix(lemma, sfx.get('S'))) add(w);
    // G is applied to the LEMMA only, and its output is never fed back through
    // S. The G rule set already carries BOTH feminine forms (nine singular
    // rules -- o->a, e->a, an->ana -- and nine plural ones -- o->as, e->as,
    // an->anas), so running S over a form that is already a plural produces
    // garbage: S's "add -es to a word ending in s" rule exists for autobus ->
    // autobuses, and applied to `rojas` it yields `rojases`. The first version
    // of this file did exactly that and put 9,934 non-words into the list --
    // ROJASES, ALTASES, ARENOSASES, DEPORTIVASES -- about 6% of it. Anything
    // that looks like it needs a second affix pass almost certainly does not;
    // test-boggle-es.mjs asserts these specific shapes stay out.
    if (flags.has('G')) for (const w of applySuffix(lemma, sfx.get('G'))) add(w);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const offIdx = args.indexOf('--offline');
  const outPath = path.resolve(ROOT, outIdx === -1 ? 'boggle/data/words-es.txt' : args[outIdx + 1]);
  const offlineDir = offIdx === -1 ? null : args[offIdx + 1];

  const [dicText, affText] = await Promise.all([
    readSource('index.dic', offlineDir),
    readSource('index.aff', offlineDir),
  ]);

  const entries = parseDic(dicText);
  const sfx = parseSuffixRules(affText, ['S', 'G']);
  const words = buildWordSet(entries, sfx);
  const sorted = [...words].sort();

  fs.writeFileSync(outPath, `${sorted.join('\n')}\n`, 'utf8');

  const bytes = fs.statSync(outPath).size;
  const byLen = new Map();
  for (const w of sorted) byLen.set(w.length, (byLen.get(w.length) || 0) + 1);
  console.log(`lemmas read:  ${entries.size}`);
  console.log(`words out:    ${sorted.length}`);
  console.log(`bytes:        ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`lengths:      ${[...byLen.keys()].sort((a, b) => a - b)
    .map((n) => `${n}:${byLen.get(n)}`).join(' ')}`);
  console.log(`-> ${path.relative(ROOT, outPath)}`);
  console.log('Now run: node validate-sw-assets.mjs   (and commit sw.js with the list)');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
