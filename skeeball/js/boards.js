// skeeball/js/boards.js - the MACHINE registry: every cabinet the game can put in front of the
// player, as data. Pure - no DOM, no storage. One machine per entry: its identity (id, name,
// vibe), its look (a palette the renderer reads), its physics tune, and its place in the unlock
// chain. Adding the next machine is adding an entry here plus its strings; nothing in game.js,
// physics.js or ui.js is classic-specific.
//
// THE LAW note on ids: a board's `id` is a STORAGE KEY. It buckets `byDiff` in the shared stats
// store, keys the per-machine records in `sk.boards` and the unlock set in `sk.unlocked`
// (js/arcade-scores.js), and is mirrored to Firebase per player. Once a machine has been played,
// its id is frozen forever (rule 5) - rename the display name freely, never the id. `classic` is
// also `recordSkeeball`'s fallback id in js/game-stats.js, so the first machine MUST keep it.
//
// The unlock chain: each machine after the first carries `unlock: { board, score }` - roll `score`
// or better in ONE game on `board` and this machine opens. The check itself lives in
// `unlockEarned()` below so it can be tested against a synthetic list; the write goes through
// `unlockSkeeballBoard()` in js/game-stats.js (additive, union-merged across devices - a machine
// earned anywhere is earned everywhere).

/** Balls in one game, the classic count. A rule of skeeball, not of one machine. */
export const BALLS_PER_GAME = 9;

export const BOARDS = [
  {
    id: 'classic',
    // Machine names are proper nouns, painted on the marquee - never routed through t()
    // (the same standing rule that keeps STARHUB and Oros/Copas untranslated).
    name: 'THE CLASSIC',
    // Vibe/tagline ARE translated - keys into strings.js, resolved at render time.
    taglineKey: 'board_classic_tag',
    unlock: null,             // the first machine is always open (js/arcade-scores.js isUnlocked)

    // The look, as tokens the renderer reads. A future machine restyles by swapping these.
    // Palette matched to the reference photos of the real classic board (2026-08-13):
    // burnt-orange field, white rings with a navy trim line, black stencilled values.
    look: {
      wood: '#a86f38',        // varnished oak lane
      woodDark: '#7c4d22',
      cabinet: '#54301a',     // walnut cabinet body
      cabinetEdge: '#3a1f0f',
      face: '#c96f2e',        // burnt-orange target field
      faceEdge: '#8f4c1d',
      ring: '#f2ece0',        // the white raised rings
      ringLip: '#2b5ea7',     // the navy trim painted on every ring's lip
      value: '#221a12',       // stencilled numbers
      pocket: '#221a12',      // the dark of an open hole
      marquee: '#28150b',
      marqueeText: '#ffd977',
      bulb: '#ffd977',
      glow: '#ff9d3d',        // celebration light
      wall: '#191019',        // arcade room behind the machine
      net: '#d9c9a8',
    },

    // The physics tune. All SI-ish units (metres, seconds); physics.js documents the model.
    // The lane is deliberately SHORTER than a real alley (Matt, 2026-08-13: the board is the
    // main aspect of the game and must dominate the frame) - a real 10 ft alley shows the board
    // at the size it appears from 10 ft away, which is exactly what a game must not do.
    physics: {
      laneLen: 1.5,           // player's end of the lane to the foot of the hump
      laneW: 0.62,
      rampLen: 0.32,          // the hump
      lipHeight: 0.16,        // lane bed to the launch lip
      launchAngle: 0.95,      // radians (~54 degrees) - a real skeeball lob, not a line drive
      minSpeed: 1.2,          // slowest roll the swipe can produce - too weak to clear the hump
      maxSpeed: 6.6,          // hardest fling
      rollFriction: 0.42,     // m/s^2 decel on the lane bed
      rampLoss: 0.88,         // multiplier on speed surviving the hump (scrub + rattle)
      wallRestitution: 0.42,  // side-rail bounce during the roll
      aimMax: 0.2,            // radians of lateral aim the swipe can put on the ball (~11 deg)

      faceY0: 2.12,           // where the scoring face meets the gutter void's floor
      faceTilt: 1.19,         // radians (~68 degrees) from horizontal - steep, nearly facing you
      faceLen: 1.2,           // metres up the slope
      faceW: 1.0,
      pitZ: -0.24,            // floor of the gutter void behind the hump (a weak lob dies here)
      cageY: 3.15,            // the backstop - see physics.js: hitting it DROPS the ball, for 10
      captureVn: 3.6,         // hit the face softer than this (normal speed) and it settles
      restitution: 0.42,      // face bounce when it comes in too hot
      tangentKeep: 0.72,      // tangential speed surviving a face bounce
    },

    // The scoring geometry, in FACE coordinates: u lateral (0 = centre), v metres up the slope.
    // THE REAL CLASSIC LAYOUT (rebuilt 2026-08-13 against Matt's reference photos, replacing a
    // wrong bullseye design): one BIG RING low on the board with the 30 and 40 cups stacked
    // inside it, the 50 cup at its top arc, the twin 100 cups in the top corners. Zones:
    //   in a cup                        -> that cup's value (30 / 40 / 50 / 100)
    //   inside the big ring, no cup     -> 20 (rolls to the 20 hole at the ring's inner bottom)
    //   anywhere else on the board      -> 10 (rolls down the outer field to the 10 hole)
    //   the bottom corners              -> 0 (the corner gutters; a low, wide fluke)
    //   the gutter void / the backstop  -> physics.js: void = 0, backstop drops the ball = 10
    scoring: {
      bigRing: { u: 0, v: 0.44, R: 0.335 },
      cups: [
        // Checked in this order, so the 50 (overlapping the ring's top arc) wins over the ring.
        // labelV is where the renderer stencils each value: on the cup's front collar, in the
        // sliver the next cup down leaves visible - the same place the real cups are painted.
        { id: '100L', u: -0.335, v: 0.90, r: 0.062, value: 100, labelV: 0.806 },
        { id: '100R', u: 0.335, v: 0.90, r: 0.062, value: 100, labelV: 0.806 },
        { id: 'c50', u: 0, v: 0.75, r: 0.068, value: 50, labelV: 0.652 },
        { id: 'c40', u: 0, v: 0.50, r: 0.075, value: 40, labelV: 0.399 },
        { id: 'c30', u: 0, v: 0.27, r: 0.082, value: 30, labelV: 0.163 },
      ],
      // The corner gutters: landing this low AND this wide is the fluke zero.
      corner0: { vMax: 0.16, uMin: 0.34 },
      // The drain holes: where a 20 / a 10 physically rolls to (the sink animation's targets,
      // painted by the renderer - both are visible on the real board).
      hole20: { u: 0, v: 0.145 },
      hole10: { u: 0, v: 0.03 },
    },
  },

  // The next machine goes here: { id: '...', name: '...', taglineKey: '...',
  //   unlock: { board: 'classic', score: 450 }, look: {...}, physics: {...}, scoring: {...} }.
  // See skeeball/CLAUDE.md, "Adding the next machine".
];

export const DEFAULT_BOARD = 'classic';

export function boardById(id, list = BOARDS) {
  return list.find((b) => b.id === id) || list[0];
}

/**
 * Which machines does a single game's score newly earn? Returns the ids of every LOCKED machine
 * whose unlock names this board and is met by this score. Pure over the list so the single-board
 * present can still be tested against a synthetic future (skeeball/js/test.js does).
 */
export function unlocksEarned(boardId, score, list = BOARDS) {
  return list
    .filter((b) => b.unlock && b.unlock.board === boardId && (score | 0) >= b.unlock.score)
    .map((b) => b.id);
}

export default { BALLS_PER_GAME, BOARDS, DEFAULT_BOARD, boardById, unlocksEarned };
