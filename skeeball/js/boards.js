// skeeball/js/boards.js - the MACHINE registry: every cabinet the game can put in front of the
// player, as data. Pure - no DOM, no storage. One machine per entry: identity, look (a palette
// the renderer reads), physics tune, and unlock chain position. Nothing in game.js, physics.js
// or ui.js is classic-specific.
//
// THE LAW rule 5: a board's `id` is a STORAGE KEY (buckets `byDiff`, keys `sk.boards` and
// `sk.unlocked` in js/arcade-scores.js, mirrors to Firebase). Once played, an id is frozen
// forever - rename the display name freely, never the id. `classic` is also `recordSkeeball`'s
// fallback id in js/game-stats.js, so the first machine MUST keep it.
//
// Unlock chain: `unlock: { board, score }` on a locked machine. `unlocksEarned()` below does the
// check (testable against a synthetic list); the write goes through `unlockSkeeballBoard()` in
// js/game-stats.js, additive and union-merged across devices.

/** Balls in one game, the classic count. A rule of skeeball, not of one machine. */
export const BALLS_PER_GAME = 9;

// THE BOARD'S UNIT: x, the diameter of a hole. Every hole, every ring and both board dimensions
// are given as a multiple of it (`X * 4.875`, never a decimal) - decimals would be rounded copies
// of exact sixteenths, and the tangency rules below only hold if the numbers are exact.
//
// THE TANGENCY RULES define the layout and are not decoration - `skeeball/js/test.js` asserts
// all three so this cannot drift. See DECISIONS.md#ring-geometry for the derivation and a
// deliberate exception to the original spec table.
//   1. Every hole touches its own ring at EXACTLY ONE point - the hole's bottom. No ring is
//      concentric with its hole; each hangs above it.
//   2. The 30 ring's top touches the 40 ring's bottom.
//   3. The 40 ring's top, the 50 ring's bottom and the 20 ring's top all meet at ONE point.
// Rules 2 and 3 make hole spacing a CONSEQUENCE of ring diameters, not a free number:
// h(n+1) = h(n) + ringD(n). Move a diameter and the holes above it move with it.
const X = 1.00 / 6.875;

export const BOARDS = [
  {
    id: 'classic',
    // Machine names are proper nouns and are never routed through t() (same standing rule
    // as STARHUB).
    name: 'THE CLASSIC',
    // Vibe/tagline ARE translated - keys into strings.js, resolved at render time.
    taglineKey: 'board_classic_tag',
    unlock: null,             // the first machine is always open (js/arcade-scores.js isUnlocked)

    // The look, as tokens the renderer reads. A future machine restyles by swapping these.
    // Matched to reference photos of the real classic board.
    look: {
      wood: '#a86f38',
      woodDark: '#7c4d22',
      cabinet: '#54301a',
      cabinetEdge: '#3a1f0f',
      face: '#c96f2e',
      faceEdge: '#8f4c1d',
      ring: '#f6f5f2',
      ringLip: '#2b5ea7',
      value: '#221a12',
      pocket: '#221a12',
      marquee: '#28150b',
      marqueeText: '#ffd977',
      bulb: '#ffd977',
      glow: '#ff9d3d',
      wall: '#191019',
      net: '#d9c9a8',
    },

    // The machine's GEOMETRY, in metres (world y up, z toward the player; machine.js maps this
    // into the solids both engines share). Feel adjustments happen in exactly two places: this
    // block (shapes, sizes, angles, launch speeds) and the contact materials at the top of
    // physics.js (friction/restitution per surface pair).
    geom: {
      // Ball diameter, measured outermost point to outermost point. Part of the same
      // proportion set as the face - see the X block at the top. See DECISIONS.md#ball-size.
      ballR: X * 0.35,
      ballMass: 0.18,
      // Player's end of the lane to the foot of the hump. Shorter than a real alley so the
      // board dominates the frame; also sets how much a launch angle spreads sideways before
      // the ball reaches the face, so `aimMax` is tuned against this number.
      // See DECISIONS.md#lane-length.
      laneLen: 1.40,
      // Ramp width. See DECISIONS.md#ramp-width-and-hump.
      laneW: X * 4.875,
      bedThick: 0.06,
      // The rising kicker. Short as well as steep - a taller crest blocks the camera's view of
      // the lower holes. See DECISIONS.md#ramp-width-and-hump. Re-run sight.mjs if this, the
      // board, or the camera move.
      humpLen: 0.42,
      // Segment angles; the last one IS the launch angle, the most load-bearing number on this
      // machine. GUARD: launch angle must EXCEED `boardTilt` or no arc is possible at any power
      // - range up an incline goes to zero at t = boardTilt and negative below it, so a shallower
      // launch meets the board's bottom edge and rolls from there forever. See
      // DECISIONS.md#launch-angle-history. Run `measure-arc.mjs` after touching any of this.
      humpAngles: [0.1862, 0.3723, 0.5585, 0.7447, 0.9308, 1.117],
      // The catch pit between the hump's crest and the board's bottom edge, wide enough that a
      // ball rebounding off the board's lip drops in rather than skipping the gap and rolling
      // home. See DECISIONS.md#trough-and-lip.
      troughLen: 0.225,
      troughDepth: 0.15,
      // The board's bottom edge height, kept above the hump's crest so the crest doesn't block
      // the view of the lowest holes. See DECISIONS.md#trough-and-lip. sight.mjs measures the
      // clearance; keep it positive whenever the ramp, the board or the camera move.
      boardLipY: 0.42,
      // GUARD: 0.7854 is PI/4, i.e. 45 degrees. This line said "~32 degrees" until 2026-08-20;
      // the comment was wrong, not the value, and it had already been copied into render.js and
      // CLAUDE.md. A bowl to roll around, not a wall to fall down.
      boardTilt: 0.7854,
      // GUARD: deliberately wider than a real machine's proportions, not a mistake to correct
      // toward realism. See DECISIONS.md#board-dimensions-and-aspect-ratio.
      boardW: 1.00,           // wider than the lane, like the real cabinet's flared board - and
                              // wide enough that the channel between the ring and the rails
                              // passes a ball freely (the spacing rule below)
      // Metres up the slope. The extra above the 50 leaves room for its painted number and lets
      // a genuine slam run past everything to the back wall. Board is a rectangle (1 : 1.3818),
      // not a square - boardW is fixed by camera framing, so length is the side that moved.
      // See DECISIONS.md#board-dimensions-and-aspect-ratio.
      boardLen: 1.3818,
      railH: 0.10,
      laneRailH: 0.05,
      // Tall like the real cabinet's upper case. GUARD: a max-power ball must hit its FACE and
      // die there, never clip its top edge - a corner contact there once redirected the ball
      // all the way home.
      backboardH: 0.8,
      ringSegments: 24,
      cupSegments: 14,
      collarThick: 0.012,
      // GUARD: every ring stands x tall - not a rim to cross but a wall to clear, and the only
      // way into a hole is over the top and down. A ring may hide its own mouth from the camera;
      // that is fine. Do not shrink a ring, lower it, or move a camera to keep every mouth in
      // view. See DECISIONS.md#ring-geometry.
      ringH: X,
      ringThick: 0.015,

      // How low a lipLow cup's DOWN-SLOPE lip sits, as a fraction of its wall height. Moot while
      // every cup is flush (collarH 0) but kept for the next machine, which may want walls.
      lipLowFrac: 0.50,

      // How far the ball must drop, as a fraction of its radius, to count as fallen IN
      // (physics.js's capture test). This is the ladder's master knob: bigger = harder to fall
      // in. Trades against mouth radius - a wider mouth takes longer to cross, so it catches
      // faster balls. See DECISIONS.md#ring-geometry.
      captureDrop: 0.35,

      // THE CONTACT MODEL, overriding the defaults at the top of physics.js. Everything the ball
      // touches is soft except the side rails, which were left at 0.50 - by a distance the
      // springiest surface on the machine, when the board is 0.08 and the rings 0.18.
      //
      // That mattered because the ONLY route to a corner 100 is a bank off a side rail. The ball
      // came off it fast, arrived at a cup whose ring leaves just 26mm around the ball, caught one
      // rim, crossed to the other and bounced out. Matt, playing it: "it hits both sides of the
      // rim of the 100 ring and bounces out."
      //
      // ring100Rest deadens the two corner rings ONLY. Not so a rim clip always drops - it should
      // not - just often enough that a good line is rewarded. The 10 through 50 keep ringRest and
      // play exactly as they did.
      mat: {
        wallRest: 0.25,
        ring100Rest: 0.10,
      },

      // THE FACE. Seven holes, all one size (x across), each with its OWN ring - see the
      // tangency rules in the X block at the top of this file. Positions are derived, not free:
      //   ring bottom = hole bottom = v - r        (rule 1: tangent at the hole's lowest point)
      //   h20 = 2.3125x is the one placement choice, and it sets the bottom margin
      //   h30 = h20 + 1.5x, h40 = h30 + ringD30 (rule 2), h50 = h40 + ringD40 (rule 3)
      //   h10 = h20 - 1.3125x
      // machine.js derives each ring's centre from its hole; nothing here states a ring centre,
      // so tangency cannot be broken by editing one number in isolation.
      //
      // `ringD` is a ring's DIAMETER, and `ringOpen` marks the 10's as an arc (left wall, across
      // the bottom, to the right wall) rather than a closed circle - a full circle at that
      // diameter would cross the 50's mouth. machine.js emits only its lower half, clipped at
      // the rails. Falling through a hole is the only way to score it; a ball that misses rolls
      // back into the trough. See DECISIONS.md#ring-geometry.
      holeR: X * 0.5,
      holes: {
        // GUARD: 1.19 is the WIDEST RING THAT STILL FITS WHOLE. Past about 1.198 the ring runs off
        // the top edge of the board and machine.js drops the segments that fall outside it - at 1.25
        // three of its twenty wall segments are missing and a ball can roll out the back of it. It
        // was 1.0625, which left
        // just 26mm around the ball and made the 100 a pinhole rather than a shot: measured across
        // nine aim angles, the longest run of consecutive swipe strengths that scored was 1 to 4,
        // against 8 for the 50. Matt, playing it: the gap between landing short and hitting the
        // back wall felt like the gap between a 40 and a 50. At 1.25 three ADJACENT angles open up
        // (0.34/0.36/0.38, runs of 8/6/6 over powers 70-77) - one learnable sweet spot, with the
        // angles either side still noisy, which is what a risk shot should look like.
        '100L': { u: -X * 2.75, v: X * 8.75, r: X * 0.5, value: 100, ringD: X * 1.19 },
        '100R': { u: X * 2.75, v: X * 8.75, r: X * 0.5, value: 100, ringD: X * 1.19 },
        c50: { u: 0, v: X * 7.1875, r: X * 0.5, value: 50, ringD: X * 1.4375 },
        c40: { u: 0, v: X * 5.625, r: X * 0.5, value: 40, ringD: X * 1.5625 },
        c30: { u: 0, v: X * 3.8125, r: X * 0.5, value: 30, ringD: X * 1.8125 },
        // GUARD, THE LAW rule 5: kept as `h20`, not renamed - the id is written into the
        // mid-rack autosave (gamehub.skeeball.save.v1) and old keys are never repurposed.
        h20: { u: 0, v: X * 2.3125, r: X * 0.5, value: 20, ringD: X * 4.875 },
        h10: { u: 0, v: X * 1.0, r: X * 0.5, value: 10, ringD: X * 7.125, ringOpen: true },
      },
      // GUARD: retired, kept only so an old saved rack still parses (THE LAW rule 5). Pays
      // nothing anywhere now - the 10 is a real hole on the face. physics.js no longer reads
      // this; delete only alongside a save-format version bump.
      troughTenHalfW: 0.26,

      // The swipe's speed range at the serve, in m/s. GUARD: a comfortable, natural flick must
      // land in the MIDDLE of this range, never bracketed tightly to the ladder's endpoints -
      // see DECISIONS.md#speed-range-standing-rule for what bracketing costs.
      minSpeed: 2.60,
      maxSpeed: 6.60,
      // How far sideways a ball can be thrown, in radians. Wide enough to hit either side wall
      // on purpose - see DECISIONS.md#aim-angle.
      aimMax: 0.45,

      // Contact model overrides (defaults and the reasoning live in physics.js). A board the
      // ball LANDS on and rolls up has to be dead, not lively.
      mat: {
        boardFric: 0.62,
        boardRest: 0.08,
        woodFric: 0.30,
        woodRest: 0.22,
        wallFric: 0.04,
        wallRest: 0.42,
        ringFric: 0.06,
        ringRest: 0.15,
        ring100Rest: 0.15,
        deadFric: 0.24,
        deadRest: 0.10,
      },
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
