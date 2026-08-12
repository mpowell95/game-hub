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
    // The oval as DRAWN. Measured off the reference gameplay frame: the cream ring's outer edge
    // spans 760px across a 760-wide playfield and 420px deep, i.e. an on-screen ry/rx of 0.553.
    // ry here is in DEPTH units, which are not square with x, so render.js's job is to land that
    // 0.553 on screen - see its RING note.
    ring: { cx: 0, cy: 0.40, rx: 0.95, ry: 0.314 },
    targets: [
      // The two 100s, in the back corners. The reference draws them at x +-0.75, but the lane's
      // RAILS are at board x +-0.616 (game.js's RAIL_X - the lane is narrower than the bowl it
      // feeds), so a ball simply cannot arrive out there: +-0.75 would be a target no throw can
      // reach. They sit at the widest a hard diagonal actually gets instead. Tested FIRST, so they
      // win where they overlap the 50.
      { id: '100L', kind: 'tube', x: -0.54, y: 0.93, rx: 0.19, ry: 0.058, points: 100 },
      { id: '100R', kind: 'tube', x: 0.54, y: 0.93, rx: 0.19, ry: 0.058, points: 100 },
      // Cups up the middle, 20 nearest, on an even 0.19 pitch, with the stack sitting back off
      // the front lip so the bowl has a real cream APRON in front of it - that apron is where the
      // 10 is printed on the reference machine, and with the stack any further forward the 20's
      // base lands on top of the numeral.
      //
      // THE SIZE OF THESE IS THE DIFFICULTY OF THE GAME, so it is set from measurement and then
      // checked in flick-pixels. Two rules, and the second one has now been wrong in BOTH
      // directions, so read the history before nudging it:
      //
      // 1. **`rx` AND `ry` ARE THE HOLE.** render.js draws the dark opening at exactly this
      //    ellipse - `mouthOf()` projects it, nothing scales it - so what you can see is precisely
      //    what you can hit. This has been broken twice. First `rx` was drawn at 0.86 of the catch
      //    ("the balls are guided in"). Then, unnoticed, `ry` stayed nearly TWICE the depth of the
      //    drawn mouth: 62% of throws scored as a cup were landing outside the hole on screen, up
      //    to 3.1x the mouth's radius away, so the ball visibly stopped BESIDE a cup and the game
      //    said it went in. Matt: "It's like the holes attract the ball. The ball deviates from the
      //    path it should be on and moves towards the hole." Nothing here may ever again be a
      //    different size from what is painted.
      // 2. `ry` is the mouth's half-DEPTH, and it is 61% of half the pitch. The fix for "guided in"
      //    once cut it to 0.045 against a 0.14 pitch, which left each cup owning 5.9% of the power
      //    range - a ~21px flick window on an 852px phone, and the reason Matt's recordings of that
      //    build are six balls for 40 points. Setting it without converting it into something a
      //    thumb can repeat is how both mistakes happened.
      //
      // The units to check it in are the ones a HAND controls, which since the gesture rewrite
      // means flick SPEED: `test.js`'s "a HAND can actually hit these" block reports each cup as a
      // percentage of the flick speed needed to reach it, and fails under 12% (a person repeats a
      // flick speed to roughly +-15%). These values give 14-24%. The 0.045 that Matt's recordings
      // caught gave a ~5% band, which is a coin toss.
      { id: '50', kind: 'cup', x: 0, y: 0.91, rx: 0.21, ry: 0.058, points: 50 },
      { id: '40', kind: 'cup', x: 0, y: 0.72, rx: 0.24, ry: 0.058, points: 40 },
      { id: '30', kind: 'cup', x: 0, y: 0.53, rx: 0.27, ry: 0.058, points: 30 },
      { id: '20', kind: 'cup', x: 0, y: 0.34, rx: 0.30, ry: 0.058, points: 20 },
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
      // plates with real space between them, which is the whole character of this machine. The
      // depths are the SAME 0.066-and-up family as classic's cups for the same reason: a plate
      // shallower than that is a flick window a thumb cannot hit twice.
      { id: 's100', kind: 'star', x: 0, y: 0.90, rx: 0.15, ry: 0.062, points: 100 },
      { id: 's50L', kind: 'star', x: -0.62, y: 0.70, rx: 0.21, ry: 0.075, points: 50 },
      { id: 's50R', kind: 'star', x: 0.62, y: 0.70, rx: 0.21, ry: 0.075, points: 50 },
      { id: 's30L', kind: 'star', x: -0.40, y: 0.44, rx: 0.24, ry: 0.082, points: 30 },
      { id: 's30R', kind: 'star', x: 0.40, y: 0.44, rx: 0.24, ry: 0.082, points: 30 },
      { id: 's20', kind: 'star', x: 0, y: 0.60, rx: 0.23, ry: 0.078, points: 20 },
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
