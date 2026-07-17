// game.js - Filler engine: board generation, flood capture, turn rules, scoring.
// Pure logic, no DOM. The board is a COLS x ROWS grid; every tile has a color
// (0..COLOR_COUNT-1) and an owner (0 neutral, 1 or 2). Each player's territory
// is always one connected block of a single color (their "current color").
//
// Rules (classic Filler):
//   - Player 1 starts on the top-left tile, Player 2 on the bottom-right tile.
//   - On a turn you pick any color except your own current color and the
//     opponent's current color (4 options per turn).
//   - Your whole territory becomes the picked color, and every neutral tile of
//     that color touching your territory (orthogonally) is absorbed into it.
//   - The game ends when every tile is owned; most tiles wins. TILES is odd so
//     a full board can never tie.

export const COLS = 7;
export const ROWS = 9;
export const TILES = COLS * ROWS;
export const COLOR_COUNT = 6;
export const MAJORITY = Math.floor(TILES / 2) + 1;
export const P1 = 1;
export const P2 = 2;

// Consecutive captureless moves (both players cycling colors with nothing to
// gain) before the game is scored as-is. A safety valve; unreachable in normal
// play because capturing is always eventually possible.
const DRY_LIMIT = 24;

export const idx = (c, r) => r * COLS + c;
export const P1_START = idx(0, 0);
export const P2_START = idx(COLS - 1, ROWS - 1);

const NEIGHBORS = (() => {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const n = [];
      if (c > 0) n.push(idx(c - 1, r));
      if (c < COLS - 1) n.push(idx(c + 1, r));
      if (r > 0) n.push(idx(c, r - 1));
      if (r < ROWS - 1) n.push(idx(c, r + 1));
      out.push(n);
    }
  }
  return out;
})();

export const opponentOf = (p) => (p === P1 ? P2 : P1);

/** Random board where no two orthogonal neighbors share a color, and the two
 *  starting corners differ (each player must hold a distinct current color). */
export function generateColors(rng = Math.random) {
  const colors = new Uint8Array(TILES);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const banned = [];
      if (c > 0) banned.push(colors[idx(c - 1, r)]);
      if (r > 0) banned.push(colors[idx(c, r - 1)]);
      const options = [];
      for (let k = 0; k < COLOR_COUNT; k++) if (banned.indexOf(k) < 0) options.push(k);
      colors[idx(c, r)] = options[Math.floor(rng() * options.length)];
    }
  }
  if (colors[P1_START] === colors[P2_START]) {
    const banned = [colors[P2_START], colors[idx(1, 0)], colors[idx(0, 1)]];
    const options = [];
    for (let k = 0; k < COLOR_COUNT; k++) if (banned.indexOf(k) < 0) options.push(k);
    colors[P1_START] = options[Math.floor(rng() * options.length)];
  }
  return colors;
}

/** Fresh game. Player 1 (the human) always moves first. */
export function newGame(rng = Math.random) {
  const colors = generateColors(rng);
  const owner = new Uint8Array(TILES);
  owner[P1_START] = P1;
  owner[P2_START] = P2;
  return {
    colors,
    owner,
    turn: P1,
    counts: [0, 1, 1],                                     // counts[player]
    current: [0, colors[P1_START], colors[P2_START]],      // current[player]
    over: false,
    winner: 0,          // 0 until over; 0 when over = scored draw (stalemate guard only)
    moves: 0,
    dryMoves: 0,
  };
}

/** Cheap deep copy for AI simulation. */
export function cloneGame(s) {
  return {
    colors: s.colors.slice(),
    owner: s.owner.slice(),
    turn: s.turn,
    counts: s.counts.slice(),
    current: s.current.slice(),
    over: s.over,
    winner: s.winner,
    moves: s.moves,
    dryMoves: s.dryMoves,
  };
}

/** Colors available this turn: everything except both players' current colors. */
export function legalColors(s) {
  const out = [];
  for (let k = 0; k < COLOR_COUNT; k++) {
    if (k !== s.current[P1] && k !== s.current[P2]) out.push(k);
  }
  return out;
}

/** How many neutral tiles `player` would absorb by picking `color`. No mutation. */
export function captureGain(s, player, color) {
  const seen = new Uint8Array(TILES);
  const queue = [];
  for (let i = 0; i < TILES; i++) if (s.owner[i] === player) { seen[i] = 1; queue.push(i); }
  let gain = 0;
  for (let q = 0; q < queue.length; q++) {
    const around = NEIGHBORS[queue[q]];
    for (let j = 0; j < around.length; j++) {
      const n = around[j];
      if (!seen[n] && s.owner[n] === 0 && s.colors[n] === color) {
        seen[n] = 1;
        gain += 1;
        queue.push(n);
      }
    }
  }
  return gain;
}

/** Neutral tiles touching `player`'s territory (an AI mobility heuristic). */
export function frontierSize(s, player) {
  const seen = new Uint8Array(TILES);
  let size = 0;
  for (let i = 0; i < TILES; i++) {
    if (s.owner[i] !== player) continue;
    const around = NEIGHBORS[i];
    for (let j = 0; j < around.length; j++) {
      const n = around[j];
      if (!seen[n] && s.owner[n] === 0) { seen[n] = 1; size += 1; }
    }
  }
  return size;
}

/** Play the current player's move. Mutates `s`, advances the turn, and returns
 *  the newly captured tile indexes in BFS order (for the capture animation). */
export function applyMove(s, color) {
  const player = s.turn;
  const captured = [];
  const queue = [];
  for (let i = 0; i < TILES; i++) {
    if (s.owner[i] === player) { s.colors[i] = color; queue.push(i); }
  }
  for (let q = 0; q < queue.length; q++) {
    const around = NEIGHBORS[queue[q]];
    for (let j = 0; j < around.length; j++) {
      const n = around[j];
      if (s.owner[n] === 0 && s.colors[n] === color) {
        s.owner[n] = player;
        captured.push(n);
        queue.push(n);
      }
    }
  }
  s.current[player] = color;
  s.counts[player] += captured.length;
  s.moves += 1;
  s.dryMoves = captured.length ? 0 : s.dryMoves + 1;
  s.turn = opponentOf(player);

  const filled = s.counts[P1] + s.counts[P2] === TILES;
  if (filled || s.dryMoves >= DRY_LIMIT) {
    s.over = true;
    s.winner = s.counts[P1] > s.counts[P2] ? P1 : s.counts[P2] > s.counts[P1] ? P2 : 0;
  }
  return captured;
}

/** BFS distance of every tile in `player`'s territory from their starting
 *  corner. Drives the recolor ripple. Returns Int16Array (-1 = not owned). */
export function territoryDistances(s, player) {
  const start = player === P1 ? P1_START : P2_START;
  const dist = new Int16Array(TILES).fill(-1);
  const queue = [start];
  dist[start] = 0;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const around = NEIGHBORS[i];
    for (let j = 0; j < around.length; j++) {
      const n = around[j];
      if (dist[n] < 0 && s.owner[n] === player) {
        dist[n] = dist[i] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

export default {
  COLS, ROWS, TILES, COLOR_COUNT, MAJORITY, P1, P2, P1_START, P2_START,
  idx, opponentOf, generateColors, newGame, cloneGame, legalColors,
  captureGain, frontierSize, applyMove, territoryDistances,
};
