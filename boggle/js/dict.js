// dict.js - Boggle dictionary: lazy word-list fetch + a trie of nested Maps.
// Pure/DOM-free (ui.js owns the loading-state UI; this module just resolves
// a promise).
//
// A trie is required, not a Set of every prefix: prefix-pruning solver.js's
// DFS needs a live "does this partial path still lead anywhere" check on
// every step, and a Set of every prefix of every one of ~170k words would
// duplicate ~170k strings many times over (a Set entry per prefix length) --
// too memory-hungry for a phone. A trie stores each shared prefix exactly
// once. Nodes are plain `Map`s so the DFS in solver.js can hold a live node
// reference and descend by one child lookup per letter, no per-step re-walk
// from the root and no wrapper class.
//
// A node's children live at its normal Map entries (one per next letter);
// whether the node is also a complete word is recorded in the SAME Map under
// the TERMINAL symbol key, which can never collide with a real ('A'-'Z')
// character key. This means "is this prefix a word" and "does this prefix
// continue" are both a single Map lookup on the same node.

const TERMINAL = Symbol('terminal');

const WORDS_URL = new URL('../data/words.txt', import.meta.url).href;

let dictPromise = null;

function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now());
}

/** Advance one letter from trie node `node`; returns the child node, or
 *  undefined if no word in the dictionary continues with `ch` from here. */
export function step(node, ch) {
  return node instanceof Map ? node.get(ch) : undefined;
}

/** True iff `node` marks the end of a complete dictionary word (a prefix can
 *  be both a complete word AND continue further, e.g. "CAT" under "CATS"). */
export function isWord(node) {
  return node instanceof Map && node.has(TERMINAL);
}

/** Build a trie of nested Maps from a flat word list. Pure -- takes no
 *  network/DOM dependency, so tests can build one from a small in-memory
 *  fixture list with no fetch involved. */
export function buildTrieFromWords(words) {
  const root = new Map();
  for (const word of words) {
    let node = root;
    for (const ch of word) {
      let next = node.get(ch);
      if (!next) { next = new Map(); node.set(ch, next); }
      node = next;
    }
    node.set(TERMINAL, true);
  }
  return root;
}

/** Is `word` (already uppercase) in the dictionary. Used for human-typed
 *  input validation, as distinct from solver.js's node-by-node DFS descent. */
export function isValidWord(root, word) {
  let node = root;
  for (const ch of word) {
    node = step(node, ch);
    if (!node) return false;
  }
  return isWord(node);
}

async function fetchWords(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load word list (${res.status}): ${url}`);
  const text = await res.text();
  return text.split('\n').map((w) => w.trim()).filter(Boolean);
}

/** Lazily fetch and parse the dictionary into a trie, once, caching the
 *  in-flight/resolved promise in module scope -- hub navigation away from and
 *  back into Boggle must never re-fetch the ~1.6MB word list or rebuild the
 *  trie. Returns `{ root, wordCount, buildMs }`; `buildMs` is the trie
 *  construction time alone (excludes the fetch), for the perf checkpoint in
 *  the build handoff. */
export function loadDictionary(url = WORDS_URL) {
  if (!dictPromise) {
    dictPromise = (async () => {
      const words = await fetchWords(url);
      const t0 = now();
      const root = buildTrieFromWords(words);
      const buildMs = now() - t0;
      return { root, wordCount: words.length, buildMs };
    })().catch((err) => { dictPromise = null; throw err; });
  }
  return dictPromise;
}

export default { step, isWord, buildTrieFromWords, isValidWord, loadDictionary };
