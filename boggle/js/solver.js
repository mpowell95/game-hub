// solver.js - exhaustive Boggle board solve against the dictionary trie.
// Pure, no DOM. This is deliberately the ONLY "AI" in this game -- see
// ai.js, which just samples from this module's output rather than searching
// -- so its output has to double as three things at once: the scoring word
// list, the end-of-round reveal (hence returning each word's PATH, not just
// the word), and the opponent's pool of candidate words.
//
// DFS from every tile, 8-way, never revisiting a tile within one path,
// pruned the instant the accumulated prefix leaves the trie (dict.js's
// `step` returning undefined). A word is recorded when the path is at least
// MIN_WORD_LEN letters and lands on a trie-terminal node.
//
// Qu handling (the classic Boggle solver bug): a tile's `face` is 'QU' for
// the Qu die, a two-character string. Landing on it must advance the trie by
// BOTH letters in one board step -- 'Q' then 'U' -- and prune if EITHER
// sub-step falls off the trie. Get this wrong (e.g. stepping only 'Q', or
// treating the tile as contributing one opaque symbol) and every Q word is
// either missed entirely or built with the wrong letters. test.js asserts
// this directly: a board with the Qu tile must find "QUIT" and must not find
// a malformed "QIT".

import { neighbors, scoreForWord, MIN_WORD_LEN } from './game.js';
import { step, isWord } from './dict.js';

function dfs(grid, r, c, path, visited, node, word, found) {
  const face = grid[r][c].face;
  let next = node;
  for (let i = 0; i < face.length; i++) {
    next = step(next, face[i]);
    if (!next) return; // prefix (incl. mid-Qu) has left the trie -- prune
  }
  const nextWord = word + face;
  if (nextWord.length >= MIN_WORD_LEN && isWord(next) && !found.has(nextWord)) {
    found.set(nextWord, path.slice());
  }
  for (const [nr, nc] of neighbors(r, c)) {
    const key = nr * grid.length + nc;
    if (visited.has(key)) continue;
    visited.add(key);
    path.push([nr, nc]);
    dfs(grid, nr, nc, path, visited, next, nextWord, found);
    path.pop();
    visited.delete(key);
  }
}

/** Solve every word findable on `grid` against `trieRoot`. Returns an array
 *  of `{ word, path, score }`, one entry per distinct word (its first
 *  discovered path -- Boggle scores the word, not the number of ways to
 *  trace it, so only one path is kept). `scoreForWord` is imported from
 *  `game.js` rather than duplicated here, so score can never drift from the
 *  engine's own scoring table. */
export function solveBoard(grid, trieRoot) {
  const found = new Map();
  const size = grid.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      dfs(grid, r, c, [[r, c]], new Set([r * size + c]), trieRoot, '', found);
    }
  }
  return [...found].map(([word, path]) => ({ word, path, score: scoreForWord(word) }));
}

export default { solveBoard };
