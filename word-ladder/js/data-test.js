// word-ladder/js/data-test.js - `node word-ladder/js/data-test.js`: every level and daily puzzle of both languages
// checked against the shipped word list, plus the engine's rules. Not precached (a dev file).
//   * start, target and every word of the hint path are on the list; each step changes exactly one letter;
//   * PAR IS THE TRUE MINIMUM: a breadth-first search over EVERY accepted word finds no shorter path (so no player
//     can beat par) and the stored path has exactly par steps;
//   * the ramp: levels 1-100 have 3-4 letter words, every band's pars are in range; no start/target pair repeats.
import fs from 'node:fs';
import path from 'node:path';
import * as E from './engine.js';

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };

for (const lang of ['en', 'es']) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, lang, f), 'utf8'));
  const dict = E.makeDict(read('words.json'));
  const alpha = E.ALPHABET[lang];
  const levels = read('levels.json');
  const daily = read('daily.json');
  ok(levels.count === levels.levels.length && levels.count >= 500, `${lang}: level count`);
  ok(daily.count === daily.levels.length && daily.count >= 730 && /^\d{4}-\d{2}-\d{2}$/.test(daily.epoch), `${lang}: daily count / epoch`);
  const pairs = new Set();
  const check = (raw, where, n) => {
    const l = E.cleanLevel(raw);
    if (!l) { ok(false, `${where}: does not add up`); return; }
    let good = true;
    for (let i = 0; i < l.h.length; i++) {
      if (!dict.has(l.h[i])) good = false;
      if (i && E.diffCount(l.h[i - 1], l.h[i]) !== 1) good = false;
    }
    ok(good, `${where}: path ${l.h.join(' ')} is not legal`);
    const d = E.distancesTo(dict, l.t, alpha);
    ok(d.get(l.s) === l.p, `${where}: par ${l.p} but the shortest is ${d.get(l.s)}`);
    const key = [l.s, l.t].sort().join('-');
    ok(!pairs.has(key), `${where}: pair ${key} repeats`);
    pairs.add(key);
    if (n) {
      const band = E.bandOf(n);
      const [lo, hi] = { easy: [3, 4], medium: [4, 5], hard: [4, 8], expert: [3, 8] }[band];
      ok(l.p >= lo && l.p <= hi, `${where}: par ${l.p} outside ${band} ${lo}-${hi}`);
    }
  };
  levels.levels.forEach((l, i) => check(l, `${lang} level ${i + 1}`, i + 1));
  daily.levels.forEach((l, i) => check(l, `${lang} day ${i}`, 0));
}

// The engine's rules.
ok(E.starsFor(4, 4, 0) === 3 && E.starsFor(6, 4, 0) === 2 && E.starsFor(7, 4, 0) === 1, 'stars by moves');
ok(E.starsFor(4, 4, 1) === 2 && E.starsFor(4, 4, 2) === 1, 'stars capped by hints');
ok(E.bandRange('easy').join() === '1,100' && E.bandRange('expert').join() === '401,500' && E.bandOf(1) === 'easy' && E.bandOf(101) === 'medium' && E.bandOf(251) === 'hard' && E.bandOf(401) === 'expert', 'bands');
const dict = E.makeDict({ w: { 4: 'COLD CORD WORD WARD WARM CARD' } });
ok(E.checkMove(dict, 'COLD', 'CORD') === 'ok' && E.checkMove(dict, 'COLD', 'WORD') === 'two' && E.checkMove(dict, 'COLD', 'COLX') === 'word', 'checkMove');
ok(E.hintFrom(dict, 'COLD', 'WARM', E.ALPHABET.en) === 'CORD', 'hint is the next word on a shortest path');
const lv = E.cleanLevel({ s: 'COLD', t: 'WARM', p: 4, h: 'COLD CORD WORD WARD WARM' });
const a = E.cleanAttempt({ chain: ['COLD', 'CORD', 'XXXX', 'WORD'], moves: 1, hints: 2 }, lv, dict);
ok(a.chain.join(' ') === 'COLD CORD' && a.moves === 1 && a.hints === 2 && !a.done, 'a bad saved word ends the chain there');
ok(E.cleanAttempt(null, lv, dict).chain.join() === 'COLD', 'no save = the start word');
const other = E.cleanAttempt({ chain: ['CARD', 'CORD'], moves: 1, hints: 1 }, lv, dict);
ok(other.chain.join() === 'COLD' && other.moves === 0 && other.hints === 0, 'a save from another puzzle counts no moves or hints here');
const kept = E.cleanAttempt({ chain: ['COLD', 'CORD', 'GONE', 'WARM'], moves: 3, hints: 1, done: true, recorded: true }, lv, dict);
ok(kept.done && kept.chain.length === 4 && kept.moves === 3, 'a finished, recorded save is kept even if a word left the list');

console.log(`word-ladder data tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
