// tune-boggle-es.mjs - ARE THE SPANISH DICE WORTH PLAYING? Shakes thousands of
// real boards through the real solver against the real Spanish word list and
// reports what a player would actually find.
//
//   node tune-boggle-es.mjs [--lang es|en] [--shakes 3000] [--faces "A15 O9 ..."]
//
// WHY THIS EXISTS
// ---------------
// English Boggle ships the authentic 1987 dice, and boggle/js/solver.js's
// quality gate cites a measurement over 3000 real shakes to justify its
// thresholds. Spanish has no authentic die set this repo can cite -- the dice
// in game.js's DICE_ES were DERIVED, from letter frequency in the generated
// Spanish word list weighted toward the short words that carry a round. A
// derived distribution is a guess until it is measured, and the failure mode
// is not subtle: Matt's own report on the English dice was boards that were
// "not worth playing", which turned out to be vowel starvation rather than
// rare letters. So the Spanish set gets the same treatment the English one
// got, and this is the file that produced the numbers in boggle/CLAUDE.md.
//
// It also runs against English (`--lang en`), which is the point: the Spanish
// numbers mean nothing on their own, only beside the set we already know plays
// well. Run it after ANY change to DICE_ES, BOARD_QUALITY_ES, or the word
// list generator.
//
// `--faces` re-runs the whole measurement against a candidate face multiset
// without editing game.js, which is how DICE_ES was chosen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrieFromWords } from './boggle/js/dict.js';
import { newBoard, DICE, DICE_ES, parseDiceFaces } from './boggle/js/game.js';
import {
  solveBoard, shakePlayableBoard, BOARD_QUALITY, BOARD_QUALITY_ES,
} from './boggle/js/solver.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}

/** Deal a face multiset ("A15 O9 E9 ...") into 16 dice of 6 faces. Vowels are
 *  dealt FIRST so every die carries its share of them -- a die of six
 *  consonants is a dead tile wherever it lands, which is the whole defect the
 *  English gate was written to catch. */
export function dealDice(spec, dieCount = 16, faceCount = 6) {
  const counts = spec.trim().split(/\s+/).map((s) => {
    const m = /^([A-Z]+?)(\d+)$/.exec(s);
    if (!m) throw new Error(`bad face spec: ${s}`);
    return [m[1], Number(m[2])];
  });
  const total = counts.reduce((n, [, c]) => n + c, 0);
  if (total !== dieCount * faceCount) {
    throw new Error(`face spec totals ${total}, need ${dieCount * faceCount}`);
  }
  const VOWEL = new Set(['A', 'E', 'I', 'O', 'U', 'QU']);
  // Interleave the pool by LETTER rather than emitting all 15 A faces in a
  // row: dealt in blocks, round-robin hands the first fifteen dice an A and
  // then repeats itself, which is how the first draft produced three
  // identical dice. Taking one face from each letter per pass spreads every
  // letter across the set instead.
  const pool = (want) => {
    const rem = counts.filter(([L]) => VOWEL.has(L) === want).map(([L, c]) => [L, c]);
    const out = [];
    while (rem.some(([, c]) => c > 0)) {
      for (const row of rem) if (row[1] > 0) { out.push(row[0]); row[1]--; }
    }
    return out;
  };

  // Greedy placement: each face goes to the emptiest die that does not already
  // carry it. Plain round-robin drops faces -- with A on 15 of 96 faces, it
  // reaches a point where every die with room already has an A and the face
  // has nowhere to go, which is how the first draft dealt two dice with only
  // five faces. `leftover` is the escape hatch for a spec so lopsided that a
  // duplicate face on one die is unavoidable; it has never fired for a real
  // one, and the caller-visible invariant (16 dice, 6 faces each) holds either
  // way.
  const dice = Array.from({ length: dieCount }, () => []);
  const leftover = [];
  for (const face of [...pool(true), ...pool(false)]) {
    const open = dice.filter((d) => d.length < faceCount && !d.includes(face));
    if (!open.length) { leftover.push(face); continue; }
    open.sort((a, b) => a.length - b.length)[0].push(face);
  }
  for (const face of leftover) dice.find((d) => d.length < faceCount).push(face);
  for (const d of dice) {
    if (d.length !== faceCount) throw new Error(`dealt a die with ${d.length} faces`);
  }
  return dice;
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function measure(root, dice, shakes, quality) {
  const words = [], shorts = [], vowels = [], scores = [];
  const VOWEL_FACES = new Set(['A', 'E', 'I', 'O', 'U', 'QU']);
  let pass = 0;
  const letterHits = new Map();
  for (let i = 0; i < shakes; i++) {
    const board = newBoard(Math.random, dice);
    const solved = solveBoard(board.grid, root);
    const short = solved.reduce((n, e) => n + (e.word.length <= 5 ? 1 : 0), 0);
    const v = board.tiles.reduce((n, t) => n + (VOWEL_FACES.has(t.face) ? 1 : 0), 0);
    words.push(solved.length);
    shorts.push(short);
    vowels.push(v);
    scores.push(solved.reduce((n, e) => n + e.score, 0));
    if (solved.length >= quality.minWords && short >= quality.minShortWords
      && v >= quality.minVowels) pass++;
    for (const t of new Set(board.tiles.map((x) => x.face))) {
      letterHits.set(t, (letterHits.get(t) || 0) + 1);
    }
  }
  const s = (a) => a.slice().sort((x, y) => x - y);
  return {
    words: s(words), shorts: s(shorts), vowels: s(vowels), scores: s(scores),
    passRate: pass / shakes, letterHits, shakes,
  };
}

function report(label, m, quality) {
  const row = (name, a) => `  ${name.padEnd(12)} p10 ${String(pct(a, 10)).padStart(5)}`
    + `   p25 ${String(pct(a, 25)).padStart(5)}`
    + `   median ${String(pct(a, 50)).padStart(5)}`
    + `   p90 ${String(pct(a, 90)).padStart(5)}`;
  console.log(`\n${label}  (${m.shakes} shakes)`);
  console.log(row('words', m.words));
  console.log(row('short (<=5)', m.shorts));
  console.log(row('vowel tiles', m.vowels));
  console.log(row('board score', m.scores));
  console.log(`  gate ${JSON.stringify(quality)}`);
  console.log(`  boards passing the gate FIRST shake: ${(m.passRate * 100).toFixed(1)}%`);
  const bad = m.words.filter((n) => n < 40).length / m.words.length;
  console.log(`  boards under 40 words (the "not worth playing" tail): ${(bad * 100).toFixed(1)}%`);
  const rare = [...m.letterHits.entries()].sort((a, b) => a[1] - b[1]).slice(0, 6)
    .map(([L, n]) => `${L} ${(n / m.shakes * 100).toFixed(0)}%`).join('  ');
  console.log(`  rarest faces, share of boards carrying one:  ${rare}`);
}

async function main() {
  const lang = arg('lang', 'es');
  const shakes = Number(arg('shakes', 3000));
  const facesSpec = arg('faces', null);

  const file = lang === 'en' ? 'boggle/data/words.txt' : 'boggle/data/words-es.txt';
  const words = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);
  const root = buildTrieFromWords(words);
  console.log(`${file}: ${words.length} words`);

  const quality = lang === 'en' ? BOARD_QUALITY : BOARD_QUALITY_ES;
  const dice = facesSpec
    ? dealDice(facesSpec).map((d) => d.slice())
    : parseDiceFaces(lang === 'en' ? DICE : DICE_ES);

  if (facesSpec) console.log(`candidate dice:\n${dice.map((d) => `  ${d.join(' ')}`).join('\n')}`);
  report(`${lang.toUpperCase()} dice, RAW shakes`, measure(root, dice, shakes, quality), quality);

  // What the player actually gets: the gate re-shakes a bad board, so the raw
  // distribution above is not the one that reaches a screen. This is the
  // number that matters, and the one boggle/CLAUDE.md quotes.
  const gated = [], attempts = [];
  const t0 = Date.now();
  for (let i = 0; i < shakes; i++) {
    const r = shakePlayableBoard(root, Math.random, quality, dice);
    gated.push(r.solved.length);
    attempts.push(r.attempts);
  }
  const gs = gated.slice().sort((a, b) => a - b);
  const under40 = gated.filter((n) => n < 40).length / gated.length;
  console.log(`\nAFTER the playability gate  (${shakes} shakes)`);
  console.log(`  words        p10 ${String(pct(gs, 10)).padStart(5)}   p25 ${String(pct(gs, 25)).padStart(5)}`
    + `   median ${String(pct(gs, 50)).padStart(5)}   p90 ${String(pct(gs, 90)).padStart(5)}`);
  console.log(`  boards under 40 words: ${(under40 * 100).toFixed(1)}%`);
  console.log(`  shakes needed, mean: ${(attempts.reduce((a, b) => a + b, 0) / attempts.length).toFixed(2)}`
    + `   hit maxAttempts: ${attempts.filter((a) => a === quality.maxAttempts).length}`);
  console.log(`  cost per board: ${(Date.now() - t0) / shakes}ms`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
