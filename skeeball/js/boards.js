// skeeball/js/boards.js - the machines. Each board is DATA: a palette, a target layout, and the
// score that unlocks the next one. Adding a machine should mean adding an entry here and nothing
// else, which is the whole reason this file exists separately from render.js and game.js.
//
// Everything is authored in BOARD SPACE, a unit box over the playfield:
//
//     x: -1 (left edge of the playfield) .. +1 (right edge), 0 = centre
//     y:  0 (the front lip, nearest the player) .. 1 (the back wall)
//
// A throw resolves to one point in that space and the first target containing it wins (see
// game.js's resolveThrow). So a board's difficulty IS its target layout - no per-board fudge
// factors, no difficulty multiplier, nothing to keep in sync with the art.
//
// Geometry and colour for `classic` are measured, not invented: reference/skeeball/SPEC.md's
// "CLASSIC - measured" table, taken off Matt's IMG_3952. **Read that before changing any number
// here.** In particular `ringRatio: 0.66` is the measured ellipse of the real machine and is what
// makes the board read as an open ring you can see into rather than a stack of bands - the video
// this game was first built from was shot at a much shallower angle (0.30) and looked wrong.

/** The classic Skee-Ball palette, sampled off IMG_3952 (SPEC.md "CLASSIC - colours"). */
const CLASSIC_PALETTE = {
  fieldLit: '#7FBBA4',      // the radial light in the middle of the playfield
  field: '#618F7F',
  fieldShade: '#46655A',
  fieldDeep: '#2C4039',
  target: '#FFFFFF',
  targetFace: '#EDEAE8',
  targetShade: '#ACA7A6',
  targetDeep: '#7C8381',
  hole: '#1E2A26',
  ink: '#0A0A0A',
  wall: '#111111',
  trim: '#7D2324',
  trimDark: '#4C191A',
  rail: '#EBD653',
  railLit: '#F7EA9A',
  railDark: '#2A2A26',
  lane: '#5E9C86',
  laneLit: '#71A995',
  laneDeep: '#31554A',
  marquee: '#272424',
  marqueeTrim: '#F1D98F',
};

// A second machine. NOT a recolour: the reference's own locked boards change the target LAYOUT
// (stars scattered wide, cups on posts, tiers), and copying that is the difference between a
// ladder worth climbing and a palette swap. `stars` scatters six targets across the full width, so
// it rewards aim where classic rewards power control.
const STARS_PALETTE = {
  fieldLit: '#3F63C8',
  field: '#2F4CA6',
  fieldShade: '#22357A',
  fieldDeep: '#161F4F',
  target: '#FFD84D',
  targetFace: '#F5C733',
  targetShade: '#C9971A',
  targetDeep: '#8F6A10',
  hole: '#1A1330',
  ink: '#2A1B00',
  wall: '#0E0E1A',
  trim: '#6A2BA8',
  trimDark: '#421A6B',
  rail: '#E0E6FF',
  railLit: '#FFFFFF',
  railDark: '#2A2A46',
  lane: '#33499E',
  laneLit: '#4560C4',
  laneDeep: '#1D2A63',
  marquee: '#161634',
  marqueeTrim: '#B98BE8',
};

/**
 * `targets` are hit-tested IN ORDER, so put the small/valuable ones first and the big catch-all
 * last. Each is an ellipse in board space plus what it pays.
 *
 * `kind` tells the renderer how to DRAW it, and is presentation only - scoring never reads it:
 *   'cup'  an open-topped tube standing on the playfield (classic's 20/30/40/50)
 *   'tube' a taller free-standing tube (classic's two 100s)
 *   'star' a flat star plate laid on the playfield (the stars board)
 *   'ring' the big open oval; drawn as a ring, and its target is the area INSIDE it
 */
export const BOARDS = [
  {
    id: 'classic',
    nameKey: 'board_classic',
    // 0 = unlocked from the very first game. Every other board names the score you must reach on
    // the board BEFORE it (see game.js's unlock check), which is why the first one has none.
    unlockScore: 0,
    palette: CLASSIC_PALETTE,
    // The oval as DRAWN. Measured off IMG_3952: outer 236x156 in a 365-wide playfield 360 deep,
    // so rx 0.65 of the half-width and ry 0.22 of the depth.
    ring: { cx: 0, cy: 0.40, rx: 0.66, ry: 0.22 },
    targets: [
      // The two 100s stand above the ring's widest points - the measured position, and the reason
      // a 100 is a bank shot rather than just a hard throw. Tested FIRST, so they win where they
      // overlap the 50.
      { id: '100L', kind: 'tube', x: -0.65, y: 0.78, rx: 0.10, ry: 0.045, points: 100 },
      { id: '100R', kind: 'tube', x: 0.65, y: 0.78, rx: 0.10, ry: 0.045, points: 100 },
      // Cups up the middle, 20 nearest, on an even 0.14 pitch.
      //
      // TWO RULES HERE, both from Matt playing it (2026-08-11: "the balls jump into a hole even if
      // I don't throw it that close to them... the balls are guided in. That's not fun"):
      //
      // 1. `rx` IS the drawn width. render.js draws the rim at exactly this radius, so what you can
      //    see is what you can hit. It used to draw at 0.86 of it, making every catch area 16%
      //    wider than the cup it belonged to.
      // 2. `ry` (0.045) is DELIBERATELY smaller than half the pitch (0.07), so there is a real GAP
      //    between consecutive cups - about a third of the depth axis. Before, the catch areas
      //    overlapped and tiled the whole ramp, so every straight throw sank something and the only
      //    question was which cup. The gap is where the risk lives, and it is why a mistimed throw
      //    now rolls into the 10 instead of being caught.
      { id: '50', kind: 'cup', x: 0, y: 0.72, rx: 0.146, ry: 0.045, points: 50 },
      { id: '40', kind: 'cup', x: 0, y: 0.58, rx: 0.163, ry: 0.045, points: 40 },
      { id: '30', kind: 'cup', x: 0, y: 0.44, rx: 0.181, ry: 0.045, points: 30 },
      { id: '20', kind: 'cup', x: 0, y: 0.30, rx: 0.206, ry: 0.045, points: 20 },
      // THE CATCH-ALL, and deliberately NOT the same ellipse as `ring` above. `ring` is what gets
      // drawn; this is "stayed on the playfield but found no cup" - short of the 20, wide of the
      // stack, or over the back of the 50 - and it has to cover the whole field to do that job.
      // Do not "fix" the mismatch by making them equal: the oval is scenery, this is scoring.
      { id: '10', kind: 'ring', x: 0, y: 0.45, rx: 1.05, ry: 0.55, points: 10 },
    ],
  },
  {
    id: 'stars',
    nameKey: 'board_stars',
    // Reachable but not free: a good classic rack is ~450, so this asks for a genuinely good one.
    unlockScore: 500,
    palette: STARS_PALETTE,
    ring: null,                                     // no oval on this machine
    targets: [
      // Same two rules as classic: rx is the drawn width, and nothing tiles - these are scattered
      // plates with real space between them, which is the whole character of this machine.
      { id: 's100', kind: 'star', x: 0, y: 0.86, rx: 0.11, ry: 0.045, points: 100 },
      { id: 's50L', kind: 'star', x: -0.60, y: 0.68, rx: 0.16, ry: 0.055, points: 50 },
      { id: 's50R', kind: 'star', x: 0.60, y: 0.68, rx: 0.16, ry: 0.055, points: 50 },
      { id: 's30L', kind: 'star', x: -0.36, y: 0.46, rx: 0.18, ry: 0.06, points: 30 },
      { id: 's30R', kind: 'star', x: 0.36, y: 0.46, rx: 0.18, ry: 0.06, points: 30 },
      { id: 's20', kind: 'star', x: 0, y: 0.58, rx: 0.17, ry: 0.055, points: 20 },
      { id: 's10', kind: 'ring', x: 0, y: 0.45, rx: 1.05, ry: 0.55, points: 10 },
    ],
  },
];

export const BOARD_IDS = BOARDS.map((b) => b.id);
export const DEFAULT_BOARD = BOARDS[0].id;
export const boardById = (id) => BOARDS.find((b) => b.id === id) || BOARDS[0];
export const boardIndex = (id) => Math.max(0, BOARDS.findIndex((b) => b.id === id));

/** Which targets the roaming x3 badge may sit on: never the catch-all ring (multiplying the
 *  consolation target would reward the throw that missed everything). */
export const multTargetsFor = (board) => board.targets.filter((t) => t.kind !== 'ring').map((t) => t.id);

/** The board a given board unlocks, and what it costs. `null` when there is nothing after it. */
export function nextBoard(id) {
  const i = boardIndex(id);
  return i + 1 < BOARDS.length ? BOARDS[i + 1] : null;
}

export default { BOARDS, BOARD_IDS, DEFAULT_BOARD, boardById, boardIndex, nextBoard, multTargetsFor };
