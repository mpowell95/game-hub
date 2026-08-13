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

    // The machine's GEOMETRY, in metres (world y up, z toward the player; machine.js maps this
    // into the solids both engines share). Since 2026-08-13 the ball is simulated by cannon-es
    // (skeeball/js/vendor/, a real rigid-body engine) - there is no hand-rolled collision model
    // left to tune. Feel adjustments happen in exactly two places: this block (shapes, sizes,
    // angles, launch speeds) and the contact materials at the top of physics.js (friction /
    // restitution per surface pair). The lane is deliberately SHORTER than a real alley (Matt,
    // 2026-08-13: the board is the main aspect of the game and must dominate the frame).
    geom: {
      ballR: 0.05,
      ballMass: 0.18,
      laneLen: 1.15,          // player's end of the lane to the foot of the hump
      laneW: 0.66,
      bedThick: 0.06,         // slab thickness for every floor/wall box
      humpLen: 0.30,          // the rising quarter-pipe...
      humpAngles: [0.14, 0.30, 0.46, 0.62], // ...as segment angles; the last is the launch angle
      troughLen: 0.24,        // the catch pit between the hump's crest and the board - wide
                              // enough that a ball flying back off the board's lip drops in and
                              // meets the hump's back side as a wall, instead of skipping the
                              // gap and rolling home down the lane
      troughDepth: 0.17,
      boardLipY: 0.07,        // the board's bottom edge height
      boardTilt: 0.56,        // ~32 degrees: a bowl to roll around, not a wall to fall down
      boardW: 0.78,           // wider than the lane, like the real cabinet's flared board - and
                              // wide enough that the channel between the ring and the rails
                              // passes a ball freely (the spacing rule below)
      boardLen: 0.95,         // metres up the slope
      railH: 0.11,
      laneRailH: 0.05,
      backboardH: 0.8,        // tall, like the real cabinet's upper case: a max-power ball must
                              // hit its FACE and die there, never clip its top edge (a corner
                              // contact there once redirected the ball all the way home; the
                              // max-power arc tops out around y=1.25 and the top edge must clear it)
      ringSegments: 24,
      cupSegments: 12,
      collarThick: 0.014,
      ringH: 0.06,            // the big ring band's height off the board
      ringThick: 0.015,
      ring: { u: 0, v: 0.42, R: 0.27 },   // the big ring, low on the board

      // THE REAL CLASSIC LAYOUT (2026-08-13, from Matt's reference photos): the 30/40 cups
      // stacked inside the big ring, the 50 merged into its top arc, the twin 100s tucked into
      // the top corners AGAINST the rails, the 20 a flush hole low inside the ring. The 10 is
      // the full-width slot the board's bottom edge feeds (physics.js scores the trough), 0s are
      // its corners. Every hole is a REAL opening: capture drops the ball through the board.
      //
      // Spacing rule (learned from a parked ball, then re-learned from a solver-locked one):
      // every gap between two pieces of furniture is either MERGED (touching, like the 100s
      // into the top corners and the 50 into the band) or wider than a ball's diameter plus
      // margin (>= 0.105) - anything in between is a pocket that can jam a ball on the slope,
      // and a three-contact jam locks the solver completely. Every neighbour pair below has
      // been checked against this rule; re-check ALL of them before moving anything.
      holes: {
        '100L': { u: -0.32, v: 0.87, r: 0.068, value: 100, collarH: 0.085, lipLow: true },
        '100R': { u: 0.32, v: 0.87, r: 0.068, value: 100, collarH: 0.085, lipLow: true },
        c50: { u: 0, v: 0.64, r: 0.064, value: 50, collarH: 0.06 },
        c40: { u: 0, v: 0.49, r: 0.068, value: 40, collarH: 0.05 },
        c30: { u: 0, v: 0.37, r: 0.074, value: 30, collarH: 0.045 },
        h20: { u: 0, v: 0.22, r: 0.07, value: 20, collarH: 0 },
      },
      troughTenHalfW: 0.28,   // |x| under this in the trough scores 10; wider is a corner 0

      // The swipe's speed range (m/s at the serve). Slower than minSpeed cannot climb the hump
      // and rolls back unspent; maxSpeed deliberately overshoots the 50 so power costs points.
      minSpeed: 1.0,
      maxSpeed: 6.2,
      aimMax: 0.32,           // radians of lateral aim (~18 degrees) - the corner 100s need a
                              // genuine sideways fling that rides the rail into the corner
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
