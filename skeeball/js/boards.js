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

/** The classic Skee-Ball palette. **Every one of these is a sampled pixel**, not a taste call -
 *  read out of `reference/skeeball/Skeeball 1.MOV` frame-by-frame with raw-RGB scanlines across
 *  the bowl (y=420/330/520), the back wall (y=60) and the lane (abs y=1400/1700/2100). SPEC.md
 *  records the method.
 *
 *  THE BOARD IS WARM. Cream, wood brown and a deep red back wall. The first build painted it
 *  green-and-silver, which is the single biggest reason Matt's own recording of it
 *  (`reference/skeeball/Skeeball 2.MOV`, 2026-08-11) looks nothing like the machine beside it.
 *  Green appears NOWHERE in the reference cabinet. Do not reintroduce it. */
const CLASSIC_PALETTE = {
  fieldLit: '#C68764',      // the lit crown of the bowl floor, behind the cup stack
  field: '#98502F',         // the bowl floor proper (#915233/#984E39/#9A5235 across the scanline)
  fieldShade: '#6E3113',
  fieldDeep: '#481B08',     // the bowl's rim shadow, where the floor meets the ring
  target: '#FBF6DA',        // cream highlight on a rim (#F8F7D5/#FFFAD4/#F6F3D2)
  targetFace: '#EED9AE',    // the lit front face of a tube (#EED1A1/#E9C79D)
  targetShade: '#C79A6A',   // its shaded side (#BE885E/#C49466)
  targetDeep: '#8E5A32',    // the underside shadow a tube casts on itself
  hole: '#35150A',          // the dark opening in the top of a tube
  ink: '#4A160F',           // the numerals. Dark RED-brown, sampled off the "10" glyph - not black
  wall: '#592225',          // the back wall behind the playfield, dead consistent across y=60
  trim: '#7A2A22',
  trimDark: '#3E1512',
  rail: '#F6E791',          // the lane rails: bright yellow, sampled at abs y=1700
  railLit: '#FFF8C4',
  railDark: '#412D09',
  lane: '#7C4429',          // lane wood. Lighter toward the board (#8B5036) than at the foul line
  laneLit: '#8B5036',
  laneDeep: '#5C3320',
  marquee: '#241413',
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
 *   'tube' a tall free-standing tube (classic's two 100s)
 *   'zone' a NESTED scoring ring: the ellipse is the ring's own cream rim, drawn exactly on this
 *          boundary, and scoring inside it (innermost-first) is what makes the rings TILE
 *   'star' a flat star plate laid on the playfield (the stars board)
 *   'ring' the whole-field catch-all (the 10): the floor itself, not a hole
 *
 * THE RINGS TILE, AND THAT IS THE WHOLE 2026-08-12 REBUILD. The previous classic was four small
 * cups on a 0.19 pitch with dead space between, below and beside them that all paid 10 - plus a
 * zero above the top. Swept straight down the middle, roughly HALF the usable power range paid the
 * consolation 10, and a hand's natural spread across the rest hit cups only by luck. Matt's
 * recordings of it (`reference/skeeball/Skeeball - terrible 1..3.MOV`) are ~24 throws for a 90:
 * virtually every ball a 10. The real machine - and the game in `Skeeball 1.MOV` this clones -
 * has NESTED RINGS: every ball that stays on the board lands in exactly one ring, so every depth
 * is a score and deeper is better. That is what these zones are. resolveThrow tests innermost
 * first, so "the smallest ring containing the landing point" wins, exactly like the machine.
 *
 * `aimY` on a zone is the middle of its FRONT band - the depth that is inside this ring and
 * outside the next one in. A nested zone's centre is underneath the rings stacked behind it, so
 * "aim at the 20" has to mean the 20's own territory. idealThrow reads it; scoring never does.
 *
 * WHAT YOU SEE IS STILL EXACTLY WHAT YOU SCORE. That rule survives the rebuild unchanged: a
 * zone's ellipse IS its drawn rim (render.js draws the rim parametrically along this exact
 * boundary), so making a ring easier still means drawing it bigger. The "holes do not attract the
 * ball" incident and its rules are in skeeball/CLAUDE.md; test.js pins containment.
 */
export const BOARDS = [
  {
    id: 'classic',
    nameKey: 'board_classic',
    // 0 = unlocked from the very first game. Every other board names the score you must reach on
    // the board BEFORE it (see game.js's unlock check), which is why the first one has none.
    unlockScore: 0,
    palette: CLASSIC_PALETTE,
    targets: [
      // The two 100s, in the back corners, tested FIRST so they win over the zones they stand in.
      // The reference draws them at x +-0.75, but the lane's RAILS are at board x +-0.616
      // (game.js's RAIL_X - the lane is narrower than the bowl it feeds), so a ball cannot arrive
      // out there; they sit at the widest a hard diagonal actually gets. Reaching one takes a
      // deliberate ~15-degree swipe AND deep power - the two skills together, which is what makes
      // 100 the skill shot.
      { id: '100L', kind: 'tube', x: -0.50, y: 0.78, rx: 0.145, ry: 0.075, points: 100 },
      { id: '100R', kind: 'tube', x: 0.50, y: 0.78, rx: 0.145, ry: 0.075, points: 100 },
      // The nested rings, innermost (50) first. Fronts step down the board on a near-even pitch,
      // backs converge near the wall, the way the reference's stacked ovals do. On the centre
      // line the ladder reads 10 20 30 40 50 going up - and past the wall the bounce walks it
      // back DOWN (game.js), so every power is a score and control beats muscle.
      //
      // Judged in the units a hand controls (test.js's "a HAND can actually hit these"): each
      // ring owns a band of flick SPEED at least ~15% of the speed it takes to reach it, against
      // a human repeatability of about +-15%. The cup-stack build these replace gave ~10% windows
      // with 10-paying gaps between them, which is why Matt's rack was a 90.
      { id: '50', kind: 'zone', x: 0, y: 0.705, rx: 0.30, ry: 0.130, aimY: 0.705, points: 50 },
      { id: '40', kind: 'zone', x: 0, y: 0.640, rx: 0.50, ry: 0.255, aimY: 0.480, points: 40 },
      { id: '30', kind: 'zone', x: 0, y: 0.580, rx: 0.66, ry: 0.355, aimY: 0.305, points: 30 },
      { id: '20', kind: 'zone', x: 0, y: 0.520, rx: 0.82, ry: 0.450, aimY: 0.147, points: 20 },
      // THE CATCH-ALL: the apron in front of the 20, the slivers behind the rings at the wall,
      // and anything wide of the stack. It is the floor, not a hole - a ball here comes to rest
      // visibly on the apron (ui.js), which is the reference's own behaviour.
      //
      // Its ellipse must contain EVERY point a ball can land on: |x| <= RAIL_X, y 0..1. The old
      // 1.05 x 0.55 quietly did not - a deep banked ball at (0.5, 0.98) fell outside it and
      // scored a zero "Missed!", which a 17%-of-throws simulation caught on stars. test.js now
      // sweeps the whole reachable rectangle on every board.
      { id: '10', kind: 'ring', x: 0, y: 0.45, rx: 1.45, ry: 0.80, aimY: 0.030, points: 10 },
    ],
  },
  {
    id: 'stars',
    nameKey: 'board_stars',
    // Reachable but not free: a good classic rack is ~450, so this asks for a genuinely good one.
    unlockScore: 500,
    palette: STARS_PALETTE,
    targets: [
      // Scattered plates with real space between them - the character of this machine is AIM,
      // where classic's is power control. The floor between plates pays 10, so a miss here is a
      // consolation rather than a zero, and the wall bounce applies the same as anywhere. Sizes
      // were widened in the 2026-08-12 rebuild for the same reason classic's rings were: the old
      // plates gave windows a thumb could not hit twice.
      { id: 's100', kind: 'star', x: 0, y: 0.90, rx: 0.17, ry: 0.075, points: 100 },
      { id: 's50L', kind: 'star', x: -0.55, y: 0.68, rx: 0.24, ry: 0.105, points: 50 },
      { id: 's50R', kind: 'star', x: 0.55, y: 0.68, rx: 0.24, ry: 0.105, points: 50 },
      { id: 's30L', kind: 'star', x: -0.34, y: 0.42, rx: 0.26, ry: 0.115, points: 30 },
      { id: 's30R', kind: 'star', x: 0.34, y: 0.42, rx: 0.26, ry: 0.115, points: 30 },
      { id: 's20', kind: 'star', x: 0, y: 0.62, rx: 0.26, ry: 0.115, points: 20 },
      // Same full-coverage rule as classic's 10: the floor catches everything the plates miss.
      { id: 's10', kind: 'ring', x: 0, y: 0.45, rx: 1.45, ry: 0.80, aimY: 0.150, points: 10 },
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
