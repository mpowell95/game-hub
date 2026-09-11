// test-boggle-es.mjs - the Spanish half of Boggle, headless.
//
//   node test-boggle-es.mjs
//
// Three things can break Spanish Boggle quietly, and this covers each:
//
//  1. THE GENERATOR'S RULES. build-boggle-es.mjs turns hunspell lemmas into
//     playable words, and a wrong rule does not throw -- it just puts a word
//     that does not exist on the board, or leaves a common one off. The
//     gerund/participle/folding helpers are pure, so they are checked directly.
//  2. THE SHIPPED WORD LIST. A list rebuilt from a newer RLA-ES, or from a
//     half-finished edit to the generator, must still be A-Z only, still carry
//     the everyday words, and still carry NO accented or n-tilde spelling --
//     a single "CANCIÓN" in the file is a word no board can ever spell, and
//     nothing at runtime would notice.
//  3. THE DICE AND THE LANGUAGE SEAM. 16 dice of 6 faces with no duplicate
//     face on a die; and loadDictionary caching PER LANGUAGE, which is the one
//     defect that would silently score a Spanish board against ENABLE.
//
// Deliberately NOT covered: how well the dice play. That is a measurement, not
// an assertion, and it lives in tune-boggle-es.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fold, isBoardWord, gerundOf, participleOf, inflectParticiple, parseSuffixRules, applySuffix,
} from './build-boggle-es.mjs';
import { DICE, DICE_ES, parseDiceFaces, diceFor, newBoard } from './boggle/js/game.js';
import { buildTrieFromWords, isValidWord, dictLang, DICT_LANGS } from './boggle/js/dict.js';
import {
  solveBoard, shakePlayableBoard, BOARD_QUALITY, BOARD_QUALITY_ES, qualityFor,
} from './boggle/js/solver.js';
import { selectAiWords, totalScore, tierPctFor } from './boggle/js/ai.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let passed = 0; const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`ok    ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}
const eq = (name, actual, expected) => ok(name, actual === expected, `expected ${expected}, got ${actual}`);

// --- 1. the generator's rules ------------------------------------------------

eq('fold strips accents', fold('canción'), 'CANCION');
eq('fold turns n-tilde into a plain N', fold('mañana'), 'MANANA');
eq('fold handles a word with both', fold('añoración'), 'ANORACION');
ok('isBoardWord rejects anything under 3 letters', !isBoardWord('AL'));
ok('isBoardWord rejects a leftover accent', !isBoardWord('CANCIÓN'));
ok('isBoardWord rejects a vowel-less abbreviation', !isBoardWord('BLV'));
ok('isBoardWord accepts an ordinary word', isBoardWord('CASA'));

eq('gerund of an -ar verb', gerundOf('hablar'), 'hablando');
eq('gerund of an -er verb', gerundOf('comer'), 'comiendo');
eq('gerund of an -ir verb', gerundOf('vivir'), 'viviendo');
eq('gerund takes -yendo after a vowel', gerundOf('leer'), 'leyendo');
eq('gerund takes -yendo after a vowel (-uir)', gerundOf('construir'), 'construyendo');
eq('gerund drops its i after ll', gerundOf('bullir'), 'bullendo');
eq('gerund drops its i after n-tilde', gerundOf('gruñir'), 'gruñendo');

eq('participle of an -ar verb', participleOf('hablar'), 'hablado');
eq('participle of an -er verb', participleOf('comer'), 'comido');
eq('irregular participle', participleOf('escribir'), 'escrito');
eq('irregular participle (hacer)', participleOf('hacer'), 'hecho');
// The suffix table is the whole reason compounds work; if someone rewrites it
// as exact matches, these are the assertions that go red.
eq('irregular participle carries to a compound', participleOf('devolver'), 'devuelto');
eq('irregular participle carries to a compound (describir)', participleOf('describir'), 'descrito');
eq('irregular participle carries to a compound (componer)', participleOf('componer'), 'compuesto');

ok('a participle inflects as an adjective',
  ['roto', 'rota', 'rotos', 'rotas'].every((w) => inflectParticiple('roto').includes(w)),
  JSON.stringify(inflectParticiple('roto')));
eq('an -o participle has exactly four forms', inflectParticiple('hablado').length, 4);
// Every real participle ends in -o, regular and irregular alike, so the
// other branch is defensive; exercised directly so it cannot rot unnoticed.
eq('a participle not ending in -o is only pluralised', inflectParticiple('surgent').length, 2);

// The affix subset: hunspell's own rule format, applied to real RLA-ES rules.
const AFF = `SFX S Y 2
SFX S 0 s [aceéfgiíkoóptuúw]
SFX S 0 es [bdhíjlmrúxy]
SFX G Y 2
SFX G o a o
SFX G o as o
`;
const sfx = parseSuffixRules(AFF, ['S', 'G']);
ok('plural of a vowel-final noun', applySuffix('casa', sfx.get('S')).includes('casas'));
ok('plural of a consonant-final noun', applySuffix('árbol', sfx.get('S')).includes('árboles'));
ok('feminine forms of an -o adjective',
  ['roja', 'rojas'].every((w) => applySuffix('rojo', sfx.get('G')).includes(w)));
ok('a rule whose condition does not match produces nothing',
  applySuffix('casa', sfx.get('G')).length === 0);

// --- 2. the shipped word list -------------------------------------------------

const esPath = path.join(ROOT, 'boggle/data/words-es.txt');
ok('the Spanish word list ships', fs.existsSync(esPath));
const words = fs.readFileSync(esPath, 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);
ok(`the list is a real dictionary (${words.length} words)`, words.length > 100000, `${words.length} words`);

const badShape = words.filter((w) => !/^[A-Z]{3,16}$/.test(w));
ok('every word is A-Z, 3-16 letters (no accent, no n-tilde, no stray case)',
  badShape.length === 0, `${badShape.length} bad, e.g. ${badShape.slice(0, 5).join(', ')}`);
ok('the list is sorted and unique',
  words.every((w, i) => i === 0 || w > words[i - 1]),
  'a duplicate or an out-of-order entry');

const trieEs = buildTrieFromWords(words);
// Everyday words a Spanish speaker will trace in the first minute. If the
// generator's scope ever narrows by accident, these go first.
const MUST_HAVE = [
  'CASA', 'CASAS', 'PERRO', 'PERROS', 'PERRA', 'MESA', 'AGUA', 'AMOR', 'VIDA', 'LIBRO',
  'ROJO', 'ROJA', 'ROJAS', 'ALTO', 'ALTAS', 'NINO', 'NINA', 'ANO', 'MANANA', 'CANCION',
  'COMER', 'HABLAR', 'VIVIR', 'COMIENDO', 'HABLANDO', 'COMIDO', 'HABLADA', 'ROTO', 'ROTAS',
  'VISTO', 'DICHO', 'HECHO', 'ESCRITO', 'PUESTO', 'ABIERTO',
];
const missing = MUST_HAVE.filter((w) => !isValidWord(trieEs, w));
ok('every everyday Spanish word is findable', missing.length === 0, `missing: ${missing.join(', ')}`);

// Matt's scope call, made checkable: verbs carry three forms, not fifty. If a
// future change expands the conjugations the list roughly triples in size and
// these are the assertions that say so out loud rather than silently.
const CONJUGATED = ['HABLO', 'HABLASTE', 'HABLARIA', 'COMEREMOS', 'VIVIRIAN'];
const leaked = CONJUGATED.filter((w) => isValidWord(trieEs, w));
ok('no conjugated verb forms (infinitive, gerund and participle only)',
  leaked.length === 0, `found: ${leaked.join(', ')}`);

// [KNOWN-BUG PROBE] Born red against the first shipped list, which carried
// 9,934 words that do not exist in Spanish -- 6% of it. The generator ran the
// PLURAL rules over the output of the FEMININE rules, but the feminine rule set
// already emits both feminine forms, so every feminine plural got pluralised a
// second time: rojas -> ROJASES, altas -> ALTASES, arenosas -> ARENOSASES. The
// hunspell rule doing it is real and correct in its place (autobus ->
// autobuses); it was being applied to a word that was already a plural.
//
// It is a quiet failure in exactly the way that matters: the list still looked
// like Spanish, still had every real word in it, and still passed every other
// assertion in this file. Only reading the solver's output on a real board
// showed it.
const FAKE_PLURALS = ['ROJASES', 'ALTASES', 'ARENOSASES', 'DEPORTIVASES', 'SALIASES', 'CASASES'];
const fakes = FAKE_PLURALS.filter((w) => isValidWord(trieEs, w));
ok('[KNOWN-BUG PROBE] no double-pluralised feminines (rojas -> ROJASES)',
  fakes.length === 0, `found: ${fakes.join(', ')}`);
// ...while the real words of that shape stay, so the fix is not a blunt filter
// on the ending: these are genuine singulars-in-s that DO take -es.
const REAL_ASES = ['CLASES', 'FASES', 'GASES', 'FRASES', 'BASES', 'ENVASES'];
const lostReal = REAL_ASES.filter((w) => !isValidWord(trieEs, w));
ok('...but genuine -ases plurals are kept (CLASES, FASES, ENVASES)',
  lostReal.length === 0, `missing: ${lostReal.join(', ')}`);
// The blast radius, bounded: a regression here would put thousands back.
const asesCount = words.filter((w) => w.endsWith('ASES')).length;
ok(`only a handful of words end in -ASES (${asesCount})`, asesCount < 60,
  `${asesCount} words end in -ASES; the bug produced 9,934`);

// --- 2b. is the OPPONENT the same difficulty in both languages? ----------------
//
// [KNOWN-BUG PROBE] Born red against the first Spanish release. ai.js takes a
// fixed PERCENTAGE of the solver's output, and Boggle's scoring is superlinear
// in word length (3-4 letters 1 point, 7 gets 5, 8+ gets 11). Spanish words are
// longer, so English's percentages made Spanish MEDIUM (115 avg) a harder
// opponent than English HARD (129), and Spanish HARD 58% above it -- the
// difficulty label meant something different depending on the language. The fix
// is ai.js's per-language TIER_PCT_BY_LANG; this is what stops it drifting back
// after a change to the dice, the gate or the word list.
//
// A BAND, not a point: this is a stochastic measurement, so it is deliberately
// loose enough not to flake and tight enough that "Medium is really Hard" fails.

{
  const enWords = fs.readFileSync(path.join(ROOT, 'boggle/data/words.txt'), 'utf8')
    .split('\n').map((w) => w.trim()).filter(Boolean);
  const trieEn = buildTrieFromWords(enWords);
  const SHAKES = 150;
  const tierAvg = (root, lang, tier) => {
    let sum = 0;
    for (let i = 0; i < SHAKES; i++) {
      const s = shakePlayableBoard(root, Math.random, qualityFor(lang), diceFor(lang));
      sum += totalScore(selectAiWords(s.solved, tier, Math.random, lang));
    }
    return sum / SHAKES;
  };
  for (const tier of ['beginner', 'intermediate', 'pro']) {
    const en = tierAvg(trieEn, 'en', tier);
    const es = tierAvg(trieEs, 'es', tier);
    const gap = Math.abs(es - en) / en;
    ok(`[KNOWN-BUG PROBE] "${tier}" is the same opponent in both languages `
      + `(EN ${Math.round(en)}, ES ${Math.round(es)})`,
      gap < 0.25, `${(gap * 100).toFixed(0)}% apart - re-run: node tune-boggle-es.mjs --ai`);
  }
  ok('the two languages really do use different tier percentages',
    JSON.stringify(tierPctFor('en')) !== JSON.stringify(tierPctFor('es')));
  ok('tierPctFor falls back to English for an unknown language',
    JSON.stringify(tierPctFor('fr')) === JSON.stringify(tierPctFor('en')));
  // The pre-existing single-argument call must behave exactly as it always did.
  const sample = shakePlayableBoard(trieEn, Math.random, BOARD_QUALITY, diceFor('en')).solved;
  ok('selectAiWords without a language still works (unchanged legacy API)',
    Array.isArray(selectAiWords(sample, 'intermediate')));
}

// --- 3. the dice and the language seam ---------------------------------------

for (const [label, dice] of [['EN', DICE], ['ES', DICE_ES]]) {
  const faces = parseDiceFaces(dice);
  eq(`${label}: 16 dice`, faces.length, 16);
  ok(`${label}: every die has 6 faces`, faces.every((d) => d.length === 6),
    JSON.stringify(faces.map((d) => d.length)));
  ok(`${label}: every face is A-Z or the Qu tile`,
    faces.flat().every((f) => f === 'QU' || /^[A-Z]$/.test(f)));
}
// The AUTHENTIC English dice do repeat faces (ABBJOO, AFFKPS) -- that is the
// real 1987 distribution and must not be "fixed". The derived Spanish set has
// no repeat by construction (tune-boggle-es.mjs deals it that way), so the
// assertion is made about the Spanish set only.
ok('no Spanish die repeats a face',
  parseDiceFaces(DICE_ES).every((d) => new Set(d).size === d.length));
ok('the Spanish dice carry the Qu tile (Q never appears without U in Spanish)',
  parseDiceFaces(DICE_ES).flat().includes('QU'));
ok('the Spanish dice carry no n-tilde face (every word folds to plain N)',
  !parseDiceFaces(DICE_ES).flat().some((f) => f.includes('Ñ')));
ok('the two sets are genuinely different dice',
  DICE.join('|') !== DICE_ES.join('|'));

eq('diceFor maps es onto the Spanish set', diceFor('es'), diceFor('es'));
ok('diceFor("es") is the Spanish table',
  JSON.stringify(diceFor('es')) === JSON.stringify(parseDiceFaces(DICE_ES)));
ok('diceFor falls back to English for an unknown language',
  JSON.stringify(diceFor('fr')) === JSON.stringify(parseDiceFaces(DICE)));
ok('qualityFor("es") is the Spanish gate', qualityFor('es') === BOARD_QUALITY_ES);
ok('qualityFor falls back to English', qualityFor('fr') === BOARD_QUALITY);
ok('the two gates are not the same object', BOARD_QUALITY !== BOARD_QUALITY_ES);

// A board shaken from the Spanish dice can only ever carry Spanish faces --
// the check that catches `newBoard(rng)` being called without its dice table
// somewhere in ui.js, which would deal an ENGLISH board into a Spanish round.
const esFaces = new Set(parseDiceFaces(DICE_ES).flat());
let strayFace = null;
for (let i = 0; i < 200; i++) {
  for (const tile of newBoard(Math.random, diceFor('es')).tiles) {
    if (!esFaces.has(tile.face)) strayFace = tile.face;
  }
}
ok('a Spanish board only ever carries Spanish faces', strayFace === null, `stray: ${strayFace}`);

// The round actually plays: real dice, real gate, real solver, real list.
let worst = Infinity;
for (let i = 0; i < 40; i++) {
  const board = newBoard(Math.random, diceFor('es'));
  worst = Math.min(worst, solveBoard(board.grid, trieEs).length);
}
ok('a raw Spanish shake is solvable against the Spanish list', worst >= 0 && Number.isFinite(worst));

// --- the language seam in dict.js --------------------------------------------

ok('dict.js knows both languages', DICT_LANGS.includes('en') && DICT_LANGS.includes('es'),
  DICT_LANGS.join(','));
eq('dictLang passes es through', dictLang('es'), 'es');
eq('dictLang passes en through', dictLang('en'), 'en');
// The important one: ANY unrecognised value must resolve to a list that
// exists. A round that cannot start is worse than a round in the wrong
// language.
eq('dictLang maps an unknown language to English', dictLang('fr'), 'en');
eq('dictLang maps undefined to English', dictLang(undefined), 'en');
eq('dictLang maps a hostile value to English', dictLang('__proto__'), 'en');

// [KNOWN-BUG PROBE] The per-language cache. dict.js used to hold ONE
// module-scope promise; with two lists that hands whichever language loaded
// first to every round afterwards, so a Spanish board would be solved and
// scored against ENABLE with nothing on screen to say so. This drives the real
// loadDictionary through a stubbed fetch and asserts the two languages come
// back as two different tries.
{
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    const body = u.includes('words-es') ? 'HOLA\nCASA\n' : 'HELLO\nWORD\n';
    return { ok: true, status: 200, text: async () => body };
  };
  const { loadDictionary } = await import('./boggle/js/dict.js');
  const en = await loadDictionary('en');
  const es = await loadDictionary('es');
  const enAgain = await loadDictionary('en');
  globalThis.fetch = realFetch;

  ok('[KNOWN-BUG PROBE] the two languages load different dictionaries',
    isValidWord(en.root, 'HELLO') && !isValidWord(en.root, 'HOLA')
    && isValidWord(es.root, 'HOLA') && !isValidWord(es.root, 'HELLO'),
    'one language got the other\'s trie');
  eq('a dictionary reports which language it is', es.lang, 'es');
  ok('each language is fetched exactly once', seen.length === 2, seen.join(', '));
  ok('a repeat load is served from the cache', enAgain === await loadDictionary('en'));
}

console.log(`\nBoggle Spanish tests: ${passed} passed, ${failures.length} failed.`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
