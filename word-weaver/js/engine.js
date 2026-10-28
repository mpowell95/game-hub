// word-weaver/js/engine.js - the whole word game, pure (no DOM): loading the level data, which
// cells a word covers, what a swiped word means, the hint, the stars and when a level is done.
// Used by the screens (ui.js) and by test.js.
//
// DATA CONTRACT (written by tools/build-word-weaver-data.mjs, never by hand):
//   data/index.json          { v: 1, count: N, chunk: 250 }
//   data/levels-<k>.json     { v: 1, first: 1 + 250 * k, levels: [ level, ... ] }   level n is in chunk floor((n-1)/250)
//   level = { l: 'ENORST', g: [rows, cols], w: [['STONE', r, c, 'a'], ['SNORE', r, c, 'd'], ...], x: ['ONSET', ...] }
//   `l` = the wheel's letters (a multiset, UPPERCASE), `w` = the grid words (0-based start, 'a' across /
//   'd' down), `x` = accepted extra words (sorted). The grid is at most 9 x 9.
//
// A level's STATE is { found: [grid words], extra: [extra words], hints: <count>, revealed: ['r,c', ...],
// recorded: <bool> }. It is the save (ui.js) minus the level number.

export const MIN_WORD = 3;

// --- loading ---------------------------------------------------------------------------------------

const cache = new Map();     // url -> Promise of parsed JSON; a failed fetch is dropped so a retry really retries

function getJSON(url) {
  let p = cache.get(url);
  if (!p) {
    p = Promise.resolve().then(() => fetch(url)).then((res) => {
      if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status) + ' ' + url);
      return res.json();
    });
    cache.set(url, p);
    p.catch(() => { if (cache.get(url) === p) cache.delete(url); });
  }
  return p;
}

/** The data folder's index, { v, count, chunk }, or null when it cannot be read. */
export async function loadIndex(base) {
  try {
    const idx = await getJSON(String(new URL('index.json', base)));
    if (!idx || idx.v !== 1 || !(idx.count >= 0) || !(idx.chunk > 0)) return null;
    return idx;
  } catch { return null; }
}

/** Level n (1-based) as { n, l, g, w, x }, or null: past the last level, unreadable, or malformed.
 *  `base` = the data folder's URL (new URL('../data/', import.meta.url)). */
export async function loadLevel(n, base) {
  n = Math.floor(Number(n));
  if (!(n >= 1)) return null;
  const idx = await loadIndex(base);
  if (!idx || n > idx.count) return null;
  try {
    const k = Math.floor((n - 1) / idx.chunk);
    const chunk = await getJSON(String(new URL(`levels-${k}.json`, base)));
    if (!chunk || chunk.v !== 1 || !Array.isArray(chunk.levels)) return null;
    return cleanLevel(chunk.levels[n - chunk.first], n);
  } catch { return null; }
}

/** Shape check: a level that does not add up is refused rather than drawn wrong. */
export function cleanLevel(lv, n) {
  if (!lv || typeof lv.l !== 'string' || !Array.isArray(lv.g) || !Array.isArray(lv.w) || !lv.w.length) return null;
  const rows = Math.floor(lv.g[0]), cols = Math.floor(lv.g[1]);
  if (!(rows >= 1 && cols >= 1 && rows <= 9 && cols <= 9)) return null;
  const w = [];
  for (const e of lv.w) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || (e[3] !== 'a' && e[3] !== 'd')) return null;
    const r = Math.floor(e[1]), c = Math.floor(e[2]);
    const end = e[3] === 'a' ? [r, c + e[0].length - 1] : [r + e[0].length - 1, c];
    if (!(r >= 0 && c >= 0 && end[0] < rows && end[1] < cols)) return null;
    w.push([e[0].toUpperCase(), r, c, e[3]]);
  }
  const x = Array.isArray(lv.x) ? lv.x.filter((s) => typeof s === 'string').map((s) => s.toUpperCase()) : [];
  return { n, l: lv.l.toUpperCase(), g: [rows, cols], w, x };
}

// --- words and cells ---------------------------------------------------------------------------------

/** The cells a grid word covers: [{ r, c, ch }, ...]. `word` is one entry of a level's `w`. */
export function cellsOf(word) {
  const [s, r, c, d] = word;
  return [...s].map((ch, i) => (d === 'a' ? { r, c: c + i, ch } : { r: r + i, c, ch }));
}

const keyOf = (r, c) => r + ',' + c;

/** Can `word` be spelled from the wheel's letters (each used at most as often as it appears)? */
export function canMake(letters, word) {
  const left = {};
  for (const ch of letters) left[ch] = (left[ch] || 0) + 1;
  for (const ch of word) {
    if (!left[ch]) return false;
    left[ch]--;
  }
  return true;
}

/** An empty state for a fresh level. */
export function freshState() {
  return { found: [], extra: [], hints: 0, revealed: [], recorded: false };
}

/** What a swiped / typed word is, against the level and the state so far:
 *  'short' (under 3 letters), 'grid' (a grid word not found yet), 'found' (a grid word already found),
 *  'extra' (a new accepted extra word), 'extraFound' (one already found), 'bad' (anything else). */
export function checkWord(level, state, word) {
  const s = String(word || '').toUpperCase();
  if (s.length < MIN_WORD) return { kind: 'short' };
  if (!canMake(level.l, s)) return { kind: 'bad' };
  const g = level.w.find((e) => e[0] === s);
  if (g) return { kind: state.found.includes(s) ? 'found' : 'grid', word: g };
  if (level.x.includes(s)) return { kind: state.extra.includes(s) ? 'extraFound' : 'extra' };
  return { kind: 'bad' };
}

/** Record an accepted word in the state (mutates it); returns the check's result. */
export function applyWord(level, state, word) {
  const res = checkWord(level, state, word);
  const s = String(word).toUpperCase();
  if (res.kind === 'grid') state.found.push(s);
  else if (res.kind === 'extra') state.extra.push(s);
  return res;
}

/** Every cell a found word covers, as a Set of 'r,c'. */
export function foundCells(level, state) {
  const out = new Set();
  for (const e of level.w) if (state.found.includes(e[0])) for (const q of cellsOf(e)) out.add(keyOf(q.r, q.c));
  return out;
}

/** The hint: the first unrevealed cell (left to right, top to bottom) of the shortest unfound grid word
 *  (ties: the earlier word in `w`). A cell already shown (by a found word crossing it, or an earlier
 *  hint) is not unrevealed; a word with nothing left to reveal is passed over for the next shortest.
 *  Returns { r, c, ch } or null when there is nothing left to reveal. */
export function hintCell(level, state) {
  const shown = foundCells(level, state);
  for (const k of state.revealed) shown.add(k);
  const open = level.w.map((e, i) => ({ e, i })).filter(({ e }) => !state.found.includes(e[0]));
  open.sort((a, b) => a.e[0].length - b.e[0].length || a.i - b.i);
  for (const { e } of open) {
    const cells = cellsOf(e).filter((q) => !shown.has(keyOf(q.r, q.c)));
    if (!cells.length) continue;
    cells.sort((a, b) => a.r - b.r || a.c - b.c);
    return cells[0];
  }
  return null;
}

/** Stars for a level: no hint 3, one hint 2, two or more 1. */
export function starsFor(hints) {
  const h = Math.max(0, Math.floor(Number(hints) || 0));
  return h === 0 ? 3 : h === 1 ? 2 : 1;
}

/** Every grid word found. */
export function isDone(level, state) {
  return level.w.length > 0 && level.w.every((e) => state.found.includes(e[0]));
}

/** A saved state read back against its level: unknown words dropped, hints and cells sanity-checked.
 *  Never throws; anything unusable is just left out. */
export function cleanState(level, raw) {
  const st = freshState();
  if (!raw || typeof raw !== 'object') return st;
  const gridWords = new Set(level.w.map((e) => e[0]));
  const extras = new Set(level.x);
  const strs = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string').map((s) => s.toUpperCase()) : []);
  for (const s of strs(raw.found)) if (gridWords.has(s) && !st.found.includes(s)) st.found.push(s);
  for (const s of strs(raw.extra)) if (extras.has(s) && !gridWords.has(s) && !st.extra.includes(s)) st.extra.push(s);
  const inWord = new Set();
  for (const e of level.w) for (const q of cellsOf(e)) inWord.add(keyOf(q.r, q.c));
  if (Array.isArray(raw.revealed)) {
    for (const k of raw.revealed) if (typeof k === 'string' && inWord.has(k) && !st.revealed.includes(k)) st.revealed.push(k);
  }
  const h = Math.floor(Number(raw.hints));
  // Hints are never fewer than the letters this level has revealed (each reveal was one hint).
  st.hints = Math.max(st.revealed.length, h >= 0 && h < 1e6 ? h : 0);
  st.recorded = raw.recorded === true;
  return st;
}
