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
    look: {
      wood: '#a86f38',        // varnished oak lane
      woodDark: '#7c4d22',
      cabinet: '#54301a',     // walnut cabinet body
      cabinetEdge: '#3a1f0f',
      face: '#f3e4c2',        // cream target face
      ring: '#c73a2e',        // painted ring bands
      ringLip: '#f8f2df',
      pocket: '#1d1712',      // the dark of an open hole
      marquee: '#28150b',
      marqueeText: '#ffd977',
      bulb: '#ffd977',
      glow: '#ff9d3d',        // celebration light
      wall: '#191019',        // arcade room behind the machine
      net: '#d9c9a8',
    },

    // The physics tune. All SI-ish units (metres, seconds); physics.js documents the model.
    physics: {
      laneLen: 2.55,          // player's end of the lane to the foot of the hump
      laneW: 0.62,
      rampLen: 0.34,          // the hump
      lipHeight: 0.17,        // lane bed to the launch lip
      launchAngle: 0.82,      // radians (~47 degrees) - a real skeeball lob, not a line drive
      minSpeed: 1.25,         // slowest roll the swipe can produce - too weak to clear the hump
      maxSpeed: 6.4,          // hardest fling
      rollFriction: 0.42,     // m/s^2 decel on the lane bed
      rampLoss: 0.88,         // multiplier on speed surviving the hump (scrub + rattle)
      wallRestitution: 0.42,  // side-rail bounce during the roll
      aimMax: 0.16,           // radians of lateral aim the swipe can put on the ball (~9 deg)

      faceY0: 3.28,           // where the scoring face meets the pit floor
      faceTilt: 1.13,         // radians (~65 degrees) from horizontal - the classic steep face
      faceLen: 1.18,          // metres up the slope
      faceW: 0.86,
      pitZ: -0.26,            // floor of the pit in front of the face (a short ball dies here)
      cageY: 4.15,            // the back net - past this the ball is spent
      captureVn: 3.4,         // hit the face softer than this (normal speed) and the hole takes it
      restitution: 0.42,      // face bounce when it comes in too hot
      tangentKeep: 0.72,      // tangential speed surviving a face bounce
    },

    // The scoring geometry, in FACE coordinates: u lateral (0 = centre), v metres up the slope.
    // Concentric rings centred high on the face, the twin 100 pockets in the top corners -
    // the classic layout. Zone edges are radii from the ring centre; inside r[0] scores 50,
    // between r[0] and r[1] scores 40, and so on out to 10. Off the outermost edge is the
    // gutter's ball return: zero.
    scoring: {
      ringCenterV: 0.60,
      rings: [
        { r: 0.058, value: 50 },
        { r: 0.125, value: 40 },
        { r: 0.198, value: 30 },
        { r: 0.272, value: 20 },
        { r: 0.352, value: 10 },
      ],
      // Where a near-full-power throw with about half the available aim actually lands
      // (verified by the reachability sweep in test.js): the genuine skill shot.
      pockets: [
        { id: '100L', u: -0.265, v: 0.83, r: 0.055, value: 100 },
        { id: '100R', u: 0.265, v: 0.83, r: 0.055, value: 100 },
      ],
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
