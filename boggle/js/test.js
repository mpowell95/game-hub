// test.js - headless engine + dictionary + solver + AI assertions (Node, no
// DOM, no dependencies). Requires Node >= 22.7 (ESM syntax detection; there
// is no package.json), same as every other game's test.js in this repo.
//   node boggle/js/test.js
//
// Deliberately never fetches boggle/data/words.txt (the real ~170k-word,
// 1.6MB list) -- every dictionary/solver test below builds its own tiny
// in-memory trie via buildTrieFromWords(), per the build handoff's "load a
// small fixture word list" instruction, so this suite stays fast and has
// zero network/filesystem dependency.

import {
  BOARD_SIZE, MIN_WORD_LEN, DICE, newBoard, neighbors, isAdjacent,
  isValidPath, pathAction, wordForPath, scoreForWord, facesForDie,
} from './game.js';
import { step, isWord, buildTrieFromWords, isValidWord } from './dict.js';
import { solveBoard, shakePlayableBoard } from './solver.js';
import { selectAiWords, totalScore } from './ai.js';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; }

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); };

function makeGrid(rows) {
  return rows.map((row, r) => row.map((face, c) => ({ r, c, face })));
}

// === Board + scoring ==========================================================

// All 16 dice are used exactly once per shake; every tile's face genuinely
// belongs to the die newBoard() says landed there.
{
  const { tiles } = newBoard(lcg(1));
  ok('board: shakes exactly 16 tiles', tiles.length === BOARD_SIZE * BOARD_SIZE);
  const dieIndexes = tiles.map((t) => t.dieIndex);
  const usedOnce = new Set(dieIndexes).size === DICE.length
    && dieIndexes.every((i) => i >= 0 && i < DICE.length);
  ok('board: all 16 dice are used, each exactly once', usedOnce);
  const facesMatch = tiles.every((t) => facesForDie(t.dieIndex).includes(t.face));
  ok('board: every tile shows a face that belongs to its own die', facesMatch);
  // Different seeds shake different boards (sanity check it is not a fixed layout).
  const { tiles: tiles2 } = newBoard(lcg(2));
  const differs = tiles.some((t, i) => t.face !== tiles2[i].face || t.dieIndex !== tiles2[i].dieIndex);
  ok('board: two different seeds produce different shakes', differs);
}

// Scoring table exact at every named length; Qu tiles double-count via the
// 'QU' face string, so length here is always LETTERS, not tiles.
{
  const cases = [[3, 1], [4, 1], [5, 2], [6, 3], [7, 5], [8, 11], [9, 11]];
  for (const [len, expected] of cases) {
    const word = 'A'.repeat(len);
    ok(`scoring: ${len}-letter word scores ${expected}`, scoreForWord(word) === expected);
  }
  ok('scoring: under the 3-letter minimum scores 0', scoreForWord('AB') === 0);
}

// Adjacency: all 8 directions accepted, non-adjacent and self rejected.
{
  const deltas = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const allEight = deltas.every(([dr, dc]) => isAdjacent(1, 1, 1 + dr, 1 + dc));
  ok('adjacency: all 8 directions (incl. diagonals) accepted', allEight);
  ok('adjacency: a tile is not adjacent to itself', !isAdjacent(1, 1, 1, 1));
  ok('adjacency: two rows apart is rejected', !isAdjacent(0, 0, 2, 0));
  ok('adjacency: two columns apart is rejected', !isAdjacent(0, 0, 0, 2));
}

// A path reusing a tile is rejected by isValidPath.
{
  ok('path: a fresh adjacent path is valid', isValidPath([[0, 0], [0, 1], [1, 2]]));
  ok('path: revisiting an earlier tile is rejected', !isValidPath([[0, 0], [0, 1], [0, 0]]));
  ok('path: a non-adjacent step is rejected', !isValidPath([[0, 0], [2, 2]]));
  ok('path: an out-of-bounds tile is rejected', !isValidPath([[0, 0], [-1, 0]]));
}

// === Swipe tracing (pathAction) ==============================================
//
// These are the rules a finger dragging across the board obeys. They live in
// game.js precisely so they can be asserted here with no DOM: ui.js's
// _pointerMove/_onKeyboardTile are thin wrappers that only translate these
// verdicts into push/pop, so a bug in the tracing rules shows up HERE rather
// than only under a real finger on a real phone.
{
  ok('trace: an empty path starts anywhere', pathAction([], 2, 2) === 'start');
  ok('trace: an adjacent unused tile is appended', pathAction([[0, 0]], 0, 1) === 'append');
  ok('trace: a DIAGONAL neighbour is appended (Boggle allows corners)', pathAction([[1, 1]], 2, 2) === 'append');
  ok('trace: staying on the head is a no-op mid-drag', pathAction([[0, 0], [0, 1]], 0, 1) === 'end');
  // Dragging back onto the previous tile is how a swipe undoes itself without
  // the finger ever lifting -- the single most important non-obvious rule here.
  ok('trace: moving back onto the previous tile backtracks', pathAction([[0, 0], [0, 1]], 0, 0) === 'backtrack');
  ok('trace: an earlier (non-previous) tile is blocked, never reused', pathAction([[0, 0], [0, 1], [0, 2]], 0, 0) === 'blocked');
  ok('trace: a non-adjacent tile is ignored, not an error', pathAction([[0, 0]], 3, 3) === 'far');
  // A backtrack must be distinguishable from a plain reuse: with only two tiles
  // the previous one is index 0, with three it is index 1.
  ok('trace: backtrack targets the PREVIOUS tile, not the first', pathAction([[0, 0], [0, 1], [1, 1]], 0, 1) === 'backtrack');
  ok('trace: the first tile of a 3-long path is blocked, not backtrack', pathAction([[0, 0], [0, 1], [1, 1]], 0, 0) === 'blocked');
}

// Replaying a full swipe through pathAction must produce a legal path, and
// backtracking must genuinely shorten it (the drag-in-drag-out case).
{
  const applyDrag = (steps) => {
    const path = [];
    for (const [r, c] of steps) {
      const a = path.length ? pathAction(path, r, c) : 'start';
      if (a === 'start') path.push([r, c]);
      else if (a === 'append') path.push([r, c]);
      else if (a === 'backtrack') path.pop();
    }
    return path;
  };
  const straight = applyDrag([[0, 0], [0, 1], [1, 2], [2, 3]]);
  ok('trace: a swiped path is a legal Boggle path', isValidPath(straight) && straight.length === 4);
  const overshot = applyDrag([[0, 0], [0, 1], [0, 2], [0, 1]]);
  ok('trace: swiping back out drops the overshot tile', overshot.length === 2 && isValidPath(overshot));
  const withFar = applyDrag([[0, 0], [3, 3], [0, 1]]);
  ok('trace: a far tile mid-swipe is skipped without breaking the trace', withFar.length === 2 && isValidPath(withFar));
}

// === Solver ===================================================================

// A hand-built 4x4 board against a small fixture dictionary: the solver must
// find EXACTLY the words the board's adjacency actually supports, no more
// (words present in the dictionary but not reachable on this board) and no
// less (every reachable, long-enough dictionary word).
{
  //   C A T S
  //   R Z Z Z
  //   Z Z Z Z
  //   Z Z Z Z
  // CAT/CATS run along row 0. RATS/STAR thread the diagonal R-A adjacency.
  // ACT and SCAT are in the dictionary but NOT adjacent on this board
  // (C-T and S-C are both two tiles apart). AT is adjacent and in the
  // dictionary but under the 3-letter minimum.
  const grid = makeGrid([
    ['C', 'A', 'T', 'S'],
    ['R', 'Z', 'Z', 'Z'],
    ['Z', 'Z', 'Z', 'Z'],
    ['Z', 'Z', 'Z', 'Z'],
  ]);
  const trie = buildTrieFromWords(['AT', 'CAT', 'CATS', 'ACT', 'RATS', 'STAR', 'SCAT']);
  const solved = solveBoard(grid, trie);
  const words = new Set(solved.map((e) => e.word));
  const expected = new Set(['CAT', 'CATS', 'RATS', 'STAR']);
  const exact = words.size === expected.size && [...expected].every((w) => words.has(w));
  ok('solver: finds exactly the board-reachable dictionary words, no more no less', exact);
  ok('solver: a too-short reachable dictionary word (AT) is never returned', !words.has('AT'));
  ok('solver: a dictionary word whose letters are not adjacent (ACT) is never returned', !words.has('ACT'));
  ok('solver: a dictionary word whose letters are not adjacent (SCAT) is never returned', !words.has('SCAT'));

  const allPathsValid = solved.every((e) => isValidPath(e.path) && wordForPath(grid, e.path) === e.word);
  ok('solver: every returned word\'s path is adjacent, non-reusing, and spells the word', allPathsValid);
}

// The classic Boggle solver bug: a Qu tile must advance the trie by BOTH
// letters in one board step. A board whose only route to "QUIT" passes
// through the Qu tile must find QUIT and must NEVER find the malformed
// "QIT" -- which is structurally impossible to spell correctly here (the Qu
// tile always contributes the substring "QU", never a bare "Q"), so its
// presence in the result would only mean the solver incorrectly stepped
// just 'Q' and treated the next tile's 'I' as immediately following it.
{
  const grid = makeGrid([
    ['QU', 'I', 'T', 'S'],
    ['Z', 'Z', 'Z', 'Z'],
    ['Z', 'Z', 'Z', 'Z'],
    ['Z', 'Z', 'Z', 'Z'],
  ]);
  const trie = buildTrieFromWords(['QUIT', 'QUITS', 'QIT']);
  const solved = solveBoard(grid, trie);
  const words = new Set(solved.map((e) => e.word));
  ok('solver: Qu tile finds QUIT', words.has('QUIT'));
  ok('solver: Qu tile finds QUITS (both letters carried through a longer word too)', words.has('QUITS'));
  ok('solver: Qu tile never produces the malformed QIT', !words.has('QIT'));
  const quitEntry = solved.find((e) => e.word === 'QUIT');
  ok('solver: QUIT (4 letters) is spelled from exactly 3 tiles (Qu, I, T)', quitEntry && quitEntry.path.length === 3);
}

// Words shorter than MIN_WORD_LEN are never returned, even from a
// permissive dictionary and a fully-connected board.
{
  const grid = makeGrid([
    ['A', 'B', 'Z', 'Z'],
    ['Z', 'Z', 'Z', 'Z'],
    ['Z', 'Z', 'Z', 'Z'],
    ['Z', 'Z', 'Z', 'Z'],
  ]);
  const trie = buildTrieFromWords(['A', 'AB', 'B', 'BA']);
  const solved = solveBoard(grid, trie);
  ok('solver: never returns anything shorter than MIN_WORD_LEN', solved.every((e) => e.word.length >= MIN_WORD_LEN) && solved.length === 0);
}

// === Board playability gate ===================================================
//
// The dice stay authentic (see game.js); this gate only rejects the measured
// bad tail -- vowel-starved boards with almost nothing findable on them.
{
  // A dictionary rich in short words built from common letters, so an ordinary
  // board clears the bar and the gate's accept path is what gets exercised.
  const trie = buildTrieFromWords([
    'AT', 'ATE', 'EAT', 'TEA', 'SEA', 'SET', 'SAT', 'RAT', 'TAR', 'ART', 'EAR', 'ERA',
    'RATE', 'TEAR', 'SEAT', 'EAST', 'RATS', 'STAR', 'TARE', 'TEAS', 'ATES', 'ETAS',
  ]);
  // A bar of 1 word is trivially clearable, so this asserts the CONTRACT
  // (shape, bounded attempts, solved list matches the board) rather than the
  // production thresholds, which depend on the full 170k dictionary.
  const res = shakePlayableBoard(trie, Math.random, { minWords: 1, minShortWords: 1, minVowels: 1, maxAttempts: 8 });
  ok('gate: returns a board, its solve, and an attempt count', !!res && !!res.board && Array.isArray(res.solved) && res.attempts >= 1);
  ok('gate: never exceeds maxAttempts', res.attempts <= 8);
  ok('gate: the returned solve really is this board\'s solve',
    res.solved.every((e) => wordForPath(res.board.grid, e.path) === e.word));
  ok('gate: the returned board is a real 16-dice shake', res.board.tiles.length === 16
    && new Set(res.board.tiles.map((t) => t.dieIndex)).size === 16);

  // An IMPOSSIBLE bar must still terminate and still hand back a usable board
  // (the best one seen), never null and never an infinite loop -- a player must
  // always get a board, even on a freak run of bad shakes.
  const forced = shakePlayableBoard(trie, Math.random, { minWords: 1e9, minShortWords: 1e9, minVowels: 17, maxAttempts: 5 });
  ok('gate: an unreachable bar still returns the best board seen', !!forced && !!forced.board && forced.board.tiles.length === 16);
  ok('gate: an unreachable bar stops at maxAttempts (no infinite loop)', forced.attempts <= 5);
}

// === AI ========================================================================

// A synthetic solved-board list (not a real board -- ai.js only reads
// .word.length/.score) spanning a range of word lengths, so the length/score
// bias each tier applies actually has something to bite into.
function syntheticSolved() {
  const lens = [3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10];
  return lens.map((len, i) => {
    const word = String.fromCharCode(65 + (i % 26)).repeat(len);
    return { word, path: [], score: scoreForWord(word) };
  });
}

{
  const solved = syntheticSolved();
  const SEEDS = 25;
  const avg = (tier) => {
    let sum = 0;
    for (let s = 0; s < SEEDS; s++) sum += totalScore(selectAiWords(solved, tier, lcg(1000 + s)));
    return sum / SEEDS;
  };
  const beginnerAvg = avg('beginner'), intermediateAvg = avg('intermediate'), proAvg = avg('pro');
  console.log(`  (AI avg score over ${SEEDS} seeds -- beginner ${beginnerAvg.toFixed(1)}, intermediate ${intermediateAvg.toFixed(1)}, pro ${proAvg.toFixed(1)})`);
  ok('AI: Beginner scores less than Intermediate on average', beginnerAvg < intermediateAvg);
  ok('AI: Intermediate scores less than Pro on average', intermediateAvg < proAvg);

  // Every AI word is a genuine element of the solver's own output -- the AI
  // can never invent a word not actually found on the board.
  let allGenuine = true;
  for (const tier of ['beginner', 'intermediate', 'pro']) {
    const picked = selectAiWords(solved, tier, lcg(42));
    if (!picked.every((entry) => solved.includes(entry))) allGenuine = false;
  }
  ok('AI: every selected word is a real solver hit (same object, never invented)', allGenuine);
}

// === Dictionary ================================================================

// Prefix pruning: a prefix that continues in the trie keeps stepping; one
// that does not (whether from the root or mid-trie) stops immediately.
{
  const trie = buildTrieFromWords(['CAT', 'CATS', 'DOG']);
  const c = step(trie, 'C');
  ok('dict: a live first letter continues', !!c);
  const ca = step(c, 'A');
  const cat = step(ca, 'T');
  ok('dict: a live prefix continues multiple steps', !!ca && !!cat);
  ok('dict: CAT is a complete word', isWord(cat));
  ok('dict: CA is a valid prefix but not itself a complete word', !isWord(ca));
  const cats = step(cat, 'S');
  ok('dict: a prefix can both BE a word and continue further (CAT -> CATS)', isWord(cat) && !!cats && isWord(cats));
  ok('dict: a dead first letter stops immediately', step(trie, 'X') === undefined);
  ok('dict: a dead prefix stops mid-trie (no word starts CZ)', step(c, 'Z') === undefined);

  ok('dict: isValidWord accepts a complete word', isValidWord(trie, 'CAT'));
  ok('dict: isValidWord rejects a valid prefix that is not a complete word', !isValidWord(trie, 'CA'));
  ok('dict: isValidWord rejects a word that leaves the trie', !isValidWord(trie, 'CATZ'));
  ok('dict: isValidWord rejects a word absent from the very first letter', !isValidWord(trie, 'DOGGY'.slice(0, 3) + 'X'.repeat(2)));
}

console.log(`\nBoggle tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
