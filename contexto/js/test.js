// contexto/js/test.js - headless tests for the word model and rules. No DOM, no browser.
//
//   node contexto/js/test.js
//
// Reads the real generated data files from disk, so it also fails if the generator ever writes a
// .json and .bin that disagree. Not deployed (not in sw.js ASSETS).
import fs from 'node:fs';
import { buildModel, puzzleNumber, hintRank, band, CLOSE, NEAR } from './engine.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

function load(lang) {
  const dir = new URL('../data/', import.meta.url);
  const json = JSON.parse(fs.readFileSync(new URL(lang + '.json', dir), 'utf8'));
  const b = fs.readFileSync(new URL(lang + '.bin', dir));
  return buildModel(json, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

for (const lang of ['en', 'es']) {
  const m = load(lang);
  console.log(`\n--- ${lang}: ${m.size} words, ${m.count} secrets ---`);
  ok(`${lang}: a real vocabulary`, m.size > 20000 && m.count > 300, `${m.size} / ${m.count}`);

  // Every secret is a word, and its ranking is a permutation of 1..N.
  const s = m.secretFor(1);
  const seen = new Uint8Array(m.size + 1);
  let perm = true;
  for (let i = 0; i < m.size; i++) { const r = m.rankOf(s, i); if (r < 1 || r > m.size || seen[r]) { perm = false; break; } seen[r] = 1; }
  ok(`${lang}: puzzle #1 ranks every word exactly once`, perm);
  ok(`${lang}: the secret is rank 1`, m.rankOf(s, s) === 1 && m.wordAt(s, 1) === m.words[s]);
  ok(`${lang}: wordAt and rankOf agree`, [2, 50, 999, 1001, 1002, 5000, m.size].every((r) => m.rankOf(s, m.lookup(m.wordAt(s, r))) === r));

  // Puzzle numbers cycle through the secret list.
  ok(`${lang}: puzzle n+count is puzzle n`, m.secretFor(3) === m.secretFor(3 + m.count));
  ok(`${lang}: every puzzle word is a secret`, Array.from({ length: m.count }, (_, i) => m.secretFor(i + 1)).every((w) => m.isSecret(w)));

  // Lookup: case, whitespace, inflections, accents.
  const cases = lang === 'en'
    ? [['Cat', 'cat'], ['  dog ', 'dog'], ['cats', 'cat'], ['children', 'child'], ['mice', 'mouse'], ['went', 'go']]
    : [['Gato', 'gato'], ['gatos', 'gato'], ['cancion', 'canción'], ['arbol', 'árbol'], ['perros', 'perro']];
  for (const [input, want] of cases) {
    const i = m.lookup(input);
    ok(`${lang}: "${input}" -> "${want}"`, i >= 0 && m.words[i] === want, i < 0 ? 'not found' : m.words[i]);
  }
  ok(`${lang}: nonsense is not a word`, m.lookup('xqzvbnm') === -1 && m.lookup('') === -1 && m.lookup('two words') === -1);

  // Meaning actually works: a close word ranks far above an unrelated one.
  const [a, near, far] = lang === 'en' ? ['cat', 'dog', 'volcano'] : ['gato', 'perro', 'volcán'];
  const ai = m.lookup(a);
  if (m.isSecret(ai)) {
    const rn = m.rankOf(ai, m.lookup(near)), rf = m.rankOf(ai, m.lookup(far));
    ok(`${lang}: ${near} is close to ${a} and ${far} is not`, rn < 50 && rf > NEAR, `${near}=${rn} ${far}=${rf}`);
  }
}

// Puzzle numbering, local calendar.
ok('2026-09-28 is puzzle #1', puzzleNumber(new Date(2026, 8, 28, 0, 1)) === 1 && puzzleNumber(new Date(2026, 8, 28, 23, 59)) === 1);
ok('the next day is #2', puzzleNumber(new Date(2026, 8, 29, 8)) === 2);
ok('across a DST change it still counts days', puzzleNumber(new Date(2026, 10, 2, 12)) === 36);

// Hints.
ok('first hint is rank 300', hintRank(0, new Set()) === CLOSE);
ok('hint halves the best rank', hintRank(80, new Set([80])) === 40);
ok('a far best still hints at 300', hintRank(9000, new Set([9000])) === CLOSE);
ok('hint skips ranks already on the board', hintRank(80, new Set([80, 40, 39])) === 38);
ok('hint is never the word itself', hintRank(2, new Set([2])) === null);
ok('hint from 3 is 2', hintRank(3, new Set([3])) === 2);
ok('bands', band(1) === 'close' && band(CLOSE) === 'close' && band(CLOSE + 1) === 'near' && band(NEAR + 1) === 'far');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
