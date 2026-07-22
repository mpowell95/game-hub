// game.js - Dots and Boxes engine. Pure, no DOM (same deliberate seam as
// every other pure-engine game in this repo -- Mancala, Filler, Tic Tac Toe
// -- so ai.js can search freely and test.js can run headless).
//
// rows x cols BOXES. Dots are (rows+1) x (cols+1).
//   hEdges[r][c]   r in 0..rows,    c in 0..cols-1   horizontal segments
//   vEdges[r][c]   r in 0..rows-1,  c in 0..cols     vertical segments
//   boxes[r][c]    null | 0 | 1                      owner (player index)
//
// Edges store null | 0 | 1 too (the player who drew them, not just a drawn
// flag) so the UI can render each player's lines in their own color -- real
// Dots and Boxes is played that way, and it's how a player reads the board
// at a glance mid-chain. Never truthy-check an edge cell (owner 0 is
// falsy); always compare `!== null`.
//
// The extra-turn rule is the whole game: completing a box's 4th side grants
// another turn to the SAME player, so a single turn can chain-capture many
// boxes. applyMove() only flips `turn` when a move claims nothing -- as long
// as a caller (ui.js, ai.js) keeps calling applyMove for the same player
// while `again` is true, the chain plays out correctly with no extra
// bookkeeping needed here. An edge shared by two boxes (rare: the last edge
// of a chain closing a loop back on itself, or simply the shared wall
// between two boxes both reaching 3 sides) can complete BOTH boxes at once;
// that still grants exactly one extra turn, never two.

export function newGame(rows, cols) {
  return {
    rows,
    cols,
    hEdges: Array.from({ length: rows + 1 }, () => new Array(cols).fill(null)),
    vEdges: Array.from({ length: rows }, () => new Array(cols + 1).fill(null)),
    boxes: Array.from({ length: rows }, () => new Array(cols).fill(null)),
    turn: 0,
    drawnEdges: 0,
    totalEdges: (rows + 1) * cols + rows * (cols + 1),
  };
}

export function cloneGame(s) {
  return {
    ...s,
    hEdges: s.hEdges.map((row) => row.slice()),
    vEdges: s.vEdges.map((row) => row.slice()),
    boxes: s.boxes.map((row) => row.slice()),
  };
}

function edgeDrawn(s, edge) {
  return (edge.type === 'h' ? s.hEdges[edge.r][edge.c] : s.vEdges[edge.r][edge.c]) !== null;
}
function setEdge(s, edge, owner) {
  if (edge.type === 'h') s.hEdges[edge.r][edge.c] = owner;
  else s.vEdges[edge.r][edge.c] = owner;
}

/** Stable string key for an edge, for use in Sets/Maps (ai.js chain analysis, ui.js legality checks). */
export function edgeKey(edge) { return `${edge.type}:${edge.r}:${edge.c}`; }

export function legalMoves(s) {
  const out = [];
  for (let r = 0; r <= s.rows; r++) for (let c = 0; c < s.cols; c++) if (s.hEdges[r][c] === null) out.push({ type: 'h', r, c });
  for (let r = 0; r < s.rows; r++) for (let c = 0; c <= s.cols; c++) if (s.vEdges[r][c] === null) out.push({ type: 'v', r, c });
  return out;
}

/** Drawn-side count (0-4) of box (r,c). */
export function edgeCount(s, r, c) {
  let n = 0;
  if (s.hEdges[r][c] !== null) n++;          // top
  if (s.hEdges[r + 1][c] !== null) n++;      // bottom
  if (s.vEdges[r][c] !== null) n++;          // left
  if (s.vEdges[r][c + 1] !== null) n++;      // right
  return n;
}

/** The four edges bounding box (r,c), fixed order [top, bottom, left, right]. */
export function boxEdges(r, c) {
  return [
    { type: 'h', r, c },
    { type: 'h', r: r + 1, c },
    { type: 'v', r, c },
    { type: 'v', r, c: c + 1 },
  ];
}

/** The box or boxes touching `edge` (a board-boundary edge touches only one). */
export function adjacentBoxes(s, edge) {
  const out = [];
  if (edge.type === 'h') {
    if (edge.r > 0) out.push([edge.r - 1, edge.c]);
    if (edge.r < s.rows) out.push([edge.r, edge.c]);
  } else {
    if (edge.c > 0) out.push([edge.r, edge.c - 1]);
    if (edge.c < s.cols) out.push([edge.r, edge.c]);
  }
  return out;
}

/** The box on the other side of `edge` from (r,c), or null at a board boundary
 *  (the "outer" virtual node used by ai.js's chain walk). */
export function neighborAcross(s, edge, r, c) {
  const other = adjacentBoxes(s, edge).find(([rr, cc]) => !(rr === r && cc === c));
  return other || null;
}

/** Draws `edge` for the current player; a no-op if already drawn. Claims any
 *  adjacent box that reaches 4 sides (0-2 of them) and grants exactly one
 *  extra turn if anything was claimed. Mutates `s` in place. */
export function applyMove(s, edge) {
  if (edgeDrawn(s, edge)) return { claimed: 0, again: false, boxes: [] };
  setEdge(s, edge, s.turn);
  s.drawnEdges += 1;
  const claimedBoxes = [];
  for (const [r, c] of adjacentBoxes(s, edge)) {
    if (s.boxes[r][c] === null && edgeCount(s, r, c) === 4) {
      s.boxes[r][c] = s.turn;
      claimedBoxes.push([r, c]);
    }
  }
  const again = claimedBoxes.length > 0;
  if (!again) s.turn = 1 - s.turn;
  return { claimed: claimedBoxes.length, again, boxes: claimedBoxes };
}

export function isOver(s) { return s.drawnEdges >= s.totalEdges; }

export function score(s) {
  let p0 = 0, p1 = 0;
  for (const row of s.boxes) for (const owner of row) { if (owner === 0) p0++; else if (owner === 1) p1++; }
  return { p0, p1 };
}

export default {
  newGame, cloneGame, edgeKey, legalMoves, edgeCount, boxEdges,
  adjacentBoxes, neighborAcross, applyMove, isOver, score,
};
