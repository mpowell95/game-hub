// word-weaver/js/test.js - headless checks of the engine against a small hand-written fixture
// (levels in the data contract's format; the real data is built by tools/build-word-weaver-data.mjs).
// Run: node word-weaver/js/test.js
import {
  loadIndex, loadLevel, cleanLevel, cellsOf, canMake, checkWord, applyWord, hintCell, starsFor, isDone, cleanState, freshState, foundCells,
} from './engine.js';

let fails = 0;
const ok = (label, cond) => { if (!cond) { fails++; console.log('FAIL ', label); } };
const eq = (label, a, b) => ok(`${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));

// --- the fixture: 4 levels, two chunks of 2 ---------------------------------------------------------
const L1 = { l: 'ENORST', g: [6, 7],
  w: [['STONE', 0, 0, 'a'], ['SORT', 0, 0, 'd'], ['NEST', 0, 3, 'd'], ['ROES', 2, 0, 'a'], ['TONE', 3, 3, 'a'], ['STERN', 1, 6, 'd']],
  x: ['NOTES', 'ONSET', 'SNORE'] };
const L2 = { l: 'ARST', g: [4, 4], w: [['ARTS', 0, 0, 'a'], ['RATS', 0, 1, 'd'], ['STAR', 0, 3, 'd']], x: ['ART', 'TSAR'] };
const L3 = { l: 'ATE', g: [3, 3], w: [['EAT', 0, 0, 'a'], ['TEA', 0, 2, 'd']], x: ['ATE', 'ETA'] };
const L4 = { l: 'DOGG', g: [3, 3], w: [['DOG', 0, 0, 'a'], ['GOD', 0, 2, 'd']], x: [] };
const DATA = {
  'index.json': { v: 1, count: 4, chunk: 2 },
  'levels-0.json': { v: 1, first: 1, levels: [L1, L2] },
  'levels-1.json': { v: 1, first: 3, levels: [L3, L4] },
};
const hits = [];
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  hits.push(name);
  if (/nowhere/.test(String(url)) || !(name in DATA)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(DATA[name])) };
};
const BASE = new URL('http://localhost/word-weaver/data/');

// --- loading -------------------------------------------------------------------------------------
{
  const idx = await loadIndex(BASE);
  eq('index', idx, { v: 1, count: 4, chunk: 2 });
  const a = await loadLevel(1, BASE), b = await loadLevel(2, BASE), c = await loadLevel(3, BASE), d = await loadLevel(4, BASE);
  eq('level 1 letters', a.l, 'ENORST');
  eq('level 2 comes from chunk 0', b.l, 'ARST');
  eq('level 3 comes from chunk 1 (floor((n-1)/chunk))', c.l, 'ATE');
  eq('level 4 is the second in chunk 1', d.w[0][0], 'DOG');
  eq('a level carries its number', c.n, 3);
  ok('a chunk is fetched once', hits.filter((h) => h === 'levels-0.json').length === 1 && hits.filter((h) => h === 'levels-1.json').length === 1);
  ok('past the last level is null', (await loadLevel(5, BASE)) === null);
  ok('level 0 is null', (await loadLevel(0, BASE)) === null);
  ok('a non-number is null', (await loadLevel('x', BASE)) === null);
  // An unreadable folder is null, and a later try can succeed (a failed fetch is not cached).
  const bad = new URL('http://localhost/nowhere/');
  ok('missing index reads as null', (await loadIndex(bad)) === null);
  ok('missing data reads as null level', (await loadLevel(1, bad)) === null);
  DATA.__late = true;
  const late = new URL('http://localhost/late/');
  let up = false;
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => (!up && /late/.test(String(url)) ? { ok: false, status: 503, json: async () => ({}) } : real(String(url).replace('/late/', '/word-weaver/data/')));
  ok('offline: null', (await loadLevel(2, late)) === null);
  up = true;
  ok('back online: the retry works', (await loadLevel(2, late)).l === 'ARST');
  globalThis.fetch = real;
}

// --- cleanLevel ----------------------------------------------------------------------------------
{
  ok('a good level is kept', cleanLevel(L1, 1) && cleanLevel(L1, 1).w.length === 6);
  ok('a word off the grid is refused', cleanLevel({ ...L2, g: [2, 2] }, 2) === null);
  ok('no words is refused', cleanLevel({ ...L2, w: [] }, 2) === null);
  ok('a 10x10 grid is refused', cleanLevel({ ...L2, g: [10, 10] }, 2) === null);
  ok('a bad direction is refused', cleanLevel({ ...L2, w: [['ARTS', 0, 0, 'x']] }, 2) === null);
  eq('lower case is upper-cased', cleanLevel({ ...L3, l: 'ate', w: [['eat', 0, 0, 'a']], x: ['ate'] }, 3).w[0][0], 'EAT');
}

// --- cellsOf -------------------------------------------------------------------------------------
eq('across cells', cellsOf(['EAT', 0, 0, 'a']), [{ r: 0, c: 0, ch: 'E' }, { r: 0, c: 1, ch: 'A' }, { r: 0, c: 2, ch: 'T' }]);
eq('down cells', cellsOf(['TEA', 1, 2, 'd']), [{ r: 1, c: 2, ch: 'T' }, { r: 2, c: 2, ch: 'E' }, { r: 3, c: 2, ch: 'A' }]);

// --- the fixture's crossings agree (a level whose words disagree about a cell is broken) -----------
for (const [i, lv] of [L1, L2, L3, L4].entries()) {
  const m = new Map();
  let agree = true;
  for (const e of lv.w) for (const q of cellsOf(e)) {
    const k = q.r + ',' + q.c;
    if (m.has(k) && m.get(k) !== q.ch) agree = false;
    m.set(k, q.ch);
  }
  ok(`fixture level ${i + 1}: crossings agree`, agree);
  ok(`fixture level ${i + 1}: every word is made from the wheel`, lv.w.every((e) => canMake(lv.l, e[0])) && lv.x.every((w) => canMake(lv.l, w)));
}

// --- canMake counts letters ---------------------------------------------------------------------
ok('canMake: uses each letter once', canMake('ATE', 'EAT') && !canMake('ATE', 'TEAT'));
ok('canMake: a repeated letter may repeat', canMake('DOGG', 'GOD') && canMake('DOGG', 'GGO') && !canMake('DOGG', 'GGGO'));
ok('canMake: a letter that is not there', !canMake('ATE', 'TAB'));

// --- checkWord ---------------------------------------------------------------------------------
{
  const lv = cleanLevel(L1, 1), st = freshState();
  eq('grid word', checkWord(lv, st, 'STONE').kind, 'grid');
  eq('lower case works', checkWord(lv, st, 'stone').kind, 'grid');
  eq('extra word', checkWord(lv, st, 'ONSET').kind, 'extra');
  eq('not a word', checkWord(lv, st, 'RONTS').kind, 'bad');
  eq('a word the wheel cannot make', checkWord(lv, st, 'STONES').kind, 'bad');
  eq('two letters is short', checkWord(lv, st, 'ON').kind, 'short');
  eq('empty is short', checkWord(lv, st, '').kind, 'short');
  eq('the grid word is returned', checkWord(lv, st, 'SORT').word, ['SORT', 0, 0, 'd']);
  eq('apply: grid is recorded', applyWord(lv, st, 'STONE').kind, 'grid');
  eq('apply: now it is found', checkWord(lv, st, 'STONE').kind, 'found');
  eq('apply: found does not duplicate', (applyWord(lv, st, 'STONE'), st.found), ['STONE']);
  eq('apply: extra is recorded', applyWord(lv, st, 'ONSET').kind, 'extra');
  eq('apply: now it is extraFound', checkWord(lv, st, 'ONSET').kind, 'extraFound');
  applyWord(lv, st, 'ONSET');
  eq('apply: extra does not duplicate', st.extra, ['ONSET']);
  applyWord(lv, st, 'XYZZY');
  eq('apply: bad changes nothing', [st.found, st.extra], [['STONE'], ['ONSET']]);
}

// --- hintCell: the first unrevealed cell of the shortest unfound word -------------------------------
{
  const lv = cleanLevel(L1, 1), st = freshState();
  // Shortest unfound is SORT/NEST (4); the tie goes to the earlier in `w`: SORT. Its first cell is (0,0).
  eq('hint 1: SORT, first cell', hintCell(lv, st), { r: 0, c: 0, ch: 'S' });
  st.revealed.push('0,0');
  eq('hint 2: SORT, next cell', hintCell(lv, st), { r: 1, c: 0, ch: 'O' });
  st.revealed.push('1,0', '2,0', '3,0');
  // SORT is fully revealed (not found): move on to NEST, whose first cell is (0,3).
  eq('hint 3: a fully revealed word is passed over', hintCell(lv, st), { r: 0, c: 3, ch: 'N' });
  // A found word crossing NEST reveals its cells for free: find STONE (covers (0,3)); NEST then starts at (1,3).
  applyWord(lv, st, 'STONE');
  eq('found words count as revealed', hintCell(lv, st), { r: 1, c: 3, ch: 'E' });
  // Now the order within a word is top-to-bottom, left-to-right across a mix of shapes.
  const st2 = freshState();
  applyWord(lv, st2, 'STONE'); applyWord(lv, st2, 'SORT'); applyWord(lv, st2, 'NEST');
  // Left: ROES (4), TONE (4), STERN (5). ROES first in `w`; its cells (2,0) R (found via SORT), (2,1) O, ...
  eq('a crossing found letter is skipped', hintCell(lv, st2), { r: 2, c: 1, ch: 'O' });
  // Everything found: nothing to reveal.
  for (const e of lv.w) applyWord(lv, st2, e[0]);
  ok('nothing to reveal when done', hintCell(lv, st2) === null);
  // The shortest wins over an earlier longer word.
  const lv2 = cleanLevel({ l: 'ABCDE', g: [5, 5], w: [['ABCDE', 0, 0, 'a'], ['ACE', 2, 0, 'a']], x: [] }, 9);
  eq('shortest word first', hintCell(lv2, freshState()), { r: 2, c: 0, ch: 'A' });
}

// --- stars, done ------------------------------------------------------------------------------------
eq('0 hints = 3 stars', starsFor(0), 3);
eq('1 hint = 2 stars', starsFor(1), 2);
eq('2 hints = 1 star', starsFor(2), 1);
eq('9 hints = 1 star', starsFor(9), 1);
eq('junk hints = 3 stars', starsFor(undefined), 3);
{
  const lv = cleanLevel(L3, 3), st = freshState();
  ok('not done at the start', !isDone(lv, st));
  applyWord(lv, st, 'EAT');
  ok('not done with one of two', !isDone(lv, st));
  applyWord(lv, st, 'ATE'); // an extra does not finish it
  ok('extras do not finish a level', !isDone(lv, st));
  applyWord(lv, st, 'TEA');
  ok('done when every grid word is found', isDone(lv, st));
  eq('found cells', [...foundCells(lv, st)].sort(), ['0,0', '0,1', '0,2', '1,2', '2,2']);
}

// --- cleanState: a save read back against its level ---------------------------------------------------
{
  const lv = cleanLevel(L1, 1);
  eq('null save is fresh', cleanState(lv, null), freshState());
  eq('a string save is fresh', cleanState(lv, 'junk'), freshState());
  const s = cleanState(lv, { found: ['STONE', 'NOPE', 7, 'stone'], extra: ['ONSET', 'STONE', 'ZZZ'], hints: 2, revealed: ['0,0', '9,9', 'x', '1,0'], recorded: true });
  eq('unknown and duplicate words are dropped', s.found, ['STONE']);
  eq('only real extras survive (a grid word is not an extra)', s.extra, ['ONSET']);
  eq('cells outside the words are dropped', s.revealed, ['0,0', '1,0']);
  eq('hints and recorded survive', [s.hints, s.recorded], [2, true]);
  eq('hints are never fewer than the cells revealed', cleanState(lv, { revealed: ['0,0', '1,0', '2,0'], hints: 1 }).hints, 3);
  eq('negative hints read as none', cleanState(lv, { hints: -4 }).hints, 0);
  eq('NaN hints read as none', cleanState(lv, { hints: 'x' }).hints, 0);
  eq('recorded must be exactly true', cleanState(lv, { recorded: 'yes' }).recorded, false);
}

console.log(fails ? `\n${fails} check(s) FAILED` : 'word-weaver engine: all checks passed');
process.exit(fails ? 1 : 0);
