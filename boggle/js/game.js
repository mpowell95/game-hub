// game.js - Boggle engine. Pure, no DOM (same deliberate seam as every other
// pure-engine game in this repo -- Mancala, Filler, Tic Tac Toe, Dots and
// Boxes -- so solver.js can search freely and test.js can run headless).
//
// Board is a fixed 4x4 grid of tiles. Each tile's `face` is a single
// uppercase letter, OR the two-character string 'QU' for the Qu tile --
// storing 'QU' (not a single symbol) means word-building via string
// concatenation naturally counts it as TWO letters, matching both the
// dictionary's spelling and the "Qu counts as two letters" scoring rule with
// no extra bookkeeping. ui.js renders 'QU' as "Qu" for display; the engine
// never does display formatting.
//
// The 16 dice below are the real, decades-tuned classic Boggle (1987+)
// letter distribution -- random-letter boards are frequently unplayable, so
// this repo does not generate one. One correction from the handoff's dice
// table: the Qu die was transcribed there as `HIMNQu` (5 faces: H, I, M, N,
// Qu), one face short of a real cube. Cross-referenced against the published
// 1987+ distribution, the die is `HIMNUQu` (6 faces: H, I, M, N, U, Qu) --
// used here so every die has the same 6 faces as the other 15.

export const BOARD_SIZE = 4;
export const MIN_WORD_LEN = 3;

export const DICE = [
  'AAEEGN', 'ABBJOO', 'ACHOPS', 'AFFKPS',
  'AOOTTW', 'CIMOTU', 'DEILRX', 'DELRVY',
  'DISTTY', 'EEGHNW', 'EEINSU', 'EHRTVW',
  'EIOSST', 'ELRTTY', 'HIMNUQu', 'HLNNRZ',
];

/** Split a die's letter string into its faces. A capital 'Q' immediately
 *  followed by lowercase 'u' is the single combined Qu face; every other
 *  character is its own single-letter face. */
function parseDieFaces(dieStr) {
  const faces = [];
  for (let i = 0; i < dieStr.length; i++) {
    if (dieStr[i] === 'Q' && dieStr[i + 1] === 'u') { faces.push('QU'); i++; }
    else faces.push(dieStr[i].toUpperCase());
  }
  return faces;
}

const DIE_FACES = DICE.map(parseDieFaces);

/** The faces (in a stable order, not shuffled) of die `dieIndex`. Exported
 *  for test.js so it can verify a shaken tile's face genuinely belongs to
 *  the die newBoard() says landed there, using the same parse the engine
 *  itself uses (not a re-implementation that could quietly drift from it). */
export function facesForDie(dieIndex) {
  return DIE_FACES[dieIndex].slice();
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shake a fresh board: shuffle the 16 dice into the 16 positions, then pick
 *  a random face from each. Returns { grid, tiles } -- `grid[r][c]` and the
 *  flat `tiles` list both point at the same tile objects
 *  `{ r, c, face, dieIndex }`; `dieIndex` (which physical die landed here)
 *  is kept so tests can verify a tile's face actually belongs to its die. */
export function newBoard(rng = Math.random) {
  const order = shuffle([...Array(DICE.length).keys()], rng);
  const grid = Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(null));
  const tiles = [];
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    const r = Math.floor(i / BOARD_SIZE), c = i % BOARD_SIZE;
    const dieIndex = order[i];
    const faces = DIE_FACES[dieIndex];
    const face = faces[Math.floor(rng() * faces.length)];
    const tile = { r, c, face, dieIndex };
    grid[r][c] = tile;
    tiles.push(tile);
  }
  return { grid, tiles };
}

/** The (up to 8) in-bounds neighbor coordinates of (r, c), diagonals included. */
export function neighbors(r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) out.push([nr, nc]);
    }
  }
  return out;
}

export function isAdjacent(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 && !(r1 === r2 && c1 === c2);
}

/** True iff `path` (array of [r, c]) stays in bounds, never repeats a tile,
 *  and each step is adjacent (incl. diagonal) to the last. */
export function isValidPath(path) {
  if (!path.length) return false;
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const [r, c] = path[i];
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    const key = `${r},${c}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (i > 0) {
      const [pr, pc] = path[i - 1];
      if (!isAdjacent(pr, pc, r, c)) return false;
    }
  }
  return true;
}

/** What tapping/dragging onto tile (r, c) means for the current `path`.
 *  Pure, so the swipe-tracing rules in ui.js are unit-testable without a DOM:
 *    'start'     - nothing selected yet, begin a path here
 *    'end'       - already the head of the path (a no-op while dragging;
 *                  ui.js treats a TAP here as "remove the last letter")
 *    'backtrack' - dragged back onto the previous tile, so drop the head
 *                  (this is what lets a swipe undo itself without lifting)
 *    'blocked'   - a tile already used earlier in this word: Boggle forbids
 *                  reusing a tile, so it can never be appended
 *    'append'    - a legal next step (adjacent, unused)
 *    'far'       - not adjacent to the head; ignored mid-swipe rather than
 *                  breaking the trace, so a fast diagonal drag that overshoots
 *                  just does nothing until the finger comes back */
export function pathAction(path, r, c) {
  if (!path || !path.length) return 'start';
  const [lr, lc] = path[path.length - 1];
  if (lr === r && lc === c) return 'end';
  if (path.length >= 2) {
    const [pr, pc] = path[path.length - 2];
    if (pr === r && pc === c) return 'backtrack';
  }
  if (path.some(([pr, pc]) => pr === r && pc === c)) return 'blocked';
  return isAdjacent(lr, lc, r, c) ? 'append' : 'far';
}

/** The uppercase word spelled by walking `path` over `grid` (Qu tiles
 *  contribute both letters). Does not validate the path -- callers that need
 *  legality should check `isValidPath` first. */
export function wordForPath(grid, path) {
  return path.map(([r, c]) => grid[r][c].face).join('');
}

/** Standard Boggle scoring by LETTER length (a Qu tile's two letters both
 *  count). 0 for anything under the 3-letter minimum. */
export function scoreForWord(word) {
  const len = word.length;
  if (len < MIN_WORD_LEN) return 0;
  if (len <= 4) return 1;
  if (len === 5) return 2;
  if (len === 6) return 3;
  if (len === 7) return 5;
  return 11;
}

export default {
  BOARD_SIZE, MIN_WORD_LEN, DICE, newBoard, neighbors, isAdjacent,
  isValidPath, pathAction, wordForPath, scoreForWord, facesForDie,
};
