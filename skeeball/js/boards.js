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
        ringRest: 0.18,
        ring100Rest: 0.18,
        deadFric: 0.24,
        deadRest: 0.10,
      },
    },
  },

  {
    id: 'popongo',
    name: 'POPONGO',
    taglineKey: 'board_popongo_tag',
    // GOALS-BASED UNLOCK: { board, goals: true } means "complete every objective on <board>"
    // (js/goals.js's three, checked by ui.js via allGoalsMet). unlocksEarned() below only handles
    // score unlocks and correctly ignores this entry - no `score` field, so its comparison is
    // always false.
    unlock: { board: 'classic', goals: true },

    // Matched to the real product photos in skeeball/Machines/Machine 2 - Popongo/: bare light
    // wood board and lane, colored cups, a playful blue marquee. `glow`/`net` are required by
    // look.complete but currently painted by nothing.
    look: {
      wood: '#c9a36a',
      woodDark: '#96713f',
      cabinet: '#8a6a42',
      cabinetEdge: '#5f4527',
      face: '#d9b87f',
      faceEdge: '#b18f55',
      ring: '#f6f5f2',
      ringLip: '#2b5ea7',
      value: '#1c150c',
      pocket: '#171006',
      marquee: '#123a5e',
      marqueeText: '#ffd977',
      bulb: '#ffd977',
      glow: '#ffb02e',
      wall: '#161016',
      net: '#d9c9a8',
    },

    // THE ARRANGEMENT LAYER. The real Popongo's cups are loose hardware - identical cylinders
    // differing only in color and printed value, rearrangeable between games - so the SLOTS own
    // the geometry and the CUPS own the value and the paint:
    //   `cups`         the nine physical cups: value, color, printed label, ink color for the
    //                  label, and an optional `effect` ('equalizer': landing here wipes the
    //                  points the previous ball earned this rack - game.js applies it).
    //   `arrangement`  which cup sits in which slot. THE DEFAULT IS THE PRODUCT PHOTO's staging
    //                  (playpopongo.png), which also follows the rules sheet's own guidance
    //                  (like colors spaced apart). One arrangement ships; player rearrangement
    //                  is deferred, and when it comes it is a game-level remap over these same
    //                  slots - never a geometry change, because every cup is the same shape.
    // Hole VALUES are stamped from the arrangement at the bottom of this file, so physics and
    // the machine-spec test see ordinary valued holes and there is exactly ONE source of truth.
    // THE LAW rule 5: slot ids AND cup ids are storage (slot ids ride the mid-rack autosave;
    // cup values are frozen to cup ids forever). Slots are named for POSITION on purpose -
    // cups are the things that move.
    cups: {
      g6: { value: 6, color: '#2e9d4a', ink: '#ffffff', label: '6' },
      y4a: { value: 4, color: '#f2b705', ink: '#221a12', label: '4' },
      y4b: { value: 4, color: '#f2b705', ink: '#221a12', label: '4' },
      r2a: { value: 2, color: '#d3392e', ink: '#ffffff', label: '2' },
      r2b: { value: 2, color: '#d3392e', ink: '#ffffff', label: '2' },
      b1a: { value: 1, color: '#1f5fa8', ink: '#ffffff', label: '1' },
      b1b: { value: 1, color: '#1f5fa8', ink: '#ffffff', label: '1' },
      eqA: { value: 0, effect: 'equalizer', color: '#17140f', ink: '#ffffff', label: '−' },
      eqB: { value: 0, effect: 'equalizer', color: '#17140f', ink: '#ffffff', label: '−' },
    },
    arrangement: {
      top: 'g6',
      uppL: 'eqA', uppR: 'y4a',
      midL: 'r2a', midC: 'b1a', midR: 'r2b',
      lowL: 'b1b', lowR: 'eqB',
      bot: 'y4b',
    },

    // Part 1 of MACHINE-SPEC.md, copied from THE CLASSIC (same cabinet, same lane, same ramp,
    // same throw - the face is the only thing that changes). troughTenHalfW and ringSegments are
    // deliberately absent: both are classic-only vestiges (see the spec, sections 6 and 12).
    geom: {
      ballR: X * 0.35,
      ballMass: 0.18,
      laneLen: 1.40,
      laneW: X * 4.875,
      bedThick: 0.06,
      humpLen: 0.42,
      humpAngles: [0.1862, 0.3723, 0.5585, 0.7447, 0.9308, 1.117],
      troughLen: 0.225,
      troughDepth: 0.15,
      boardLipY: 0.42,
      boardTilt: 0.7854,
      boardW: 1.00,
      boardLen: 1.3818,
      railH: 0.10,
      laneRailH: 0.05,
      backboardH: 0.8,
      cupSegments: 14,
      collarThick: 0.012,
      ringH: X,
      ringThick: 0.015,
      lipLowFrac: 0.50,
      captureDrop: 0.35,

      // THE FACE: nine identical holes in a diamond (1-2-3-2-1), each wearing a raised cup
      // collar (collarH) instead of a ring - the collar system machine.js has carried since the
      // classic's flush rebuild, used here for the first time. No hole has a ringD.
      //
      // The lattice, and why these exact numbers (see DECISIONS.md#popongo-layout):
      //   row step t = 1.65X, lateral half-step s = 1.035X
      //   - NOTHING IS MERGED AND NOTHING IS TIGHT: every neighbour pair - same-row (2s),
      //     diagonal (sqrt(s^2+t^2) = 1.948X) and collar-to-rail - leaves a wall gap of at
      //     least 0.78X, over a ball (0.70X) plus margin. The first draft put midL/midR FLUSH
      //     against the rails (the classic-100s idea) and a measured sweep showed why that is
      //     wrong for a collar: a flat rail and a curved collar wall converge gradually, and
      //     every ball that entered the crevice three-contact-locked the solver - 12% of all
      //     throws ended in the watchdog's walkout, gifted to midL/midR. GUARD: a collar near
      //     a FLAT wall is a pocket even when their closest gap is zero; keep every collar a
      //     ball-width off the rails.
      //   - bot sits at v = 2.3125X (the classic 20's row - minSpeed's reach); top at
      //     v = 8.9125X, a touch above the classic 100s' row, which the raised top row of a
      //     diamond needs for its diagonals to clear - reachable because a collar (0.35X) asks
      //     for far less arrival clearance than the classic's X-tall rings did.
      // Values are NOT written here - they come from the arrangement (see the stamping loop at
      // the bottom of this file). collarH is a SLOT property (slots own geometry; cups own
      // value and paint), uniform across the face like the real product's identical cups.
      holeR: X * 0.5,
      holes: {
        top: { u: 0, v: X * 8.9125, r: X * 0.5, collarH: X * 0.35 },
        uppL: { u: -X * 1.035, v: X * 7.2625, r: X * 0.5, collarH: X * 0.35 },
        uppR: { u: X * 1.035, v: X * 7.2625, r: X * 0.5, collarH: X * 0.35 },
        midL: { u: -X * 2.07, v: X * 5.6125, r: X * 0.5, collarH: X * 0.35 },
        midC: { u: 0, v: X * 5.6125, r: X * 0.5, collarH: X * 0.35 },
        midR: { u: X * 2.07, v: X * 5.6125, r: X * 0.5, collarH: X * 0.35 },
        lowL: { u: -X * 1.035, v: X * 3.9625, r: X * 0.5, collarH: X * 0.35 },
        lowR: { u: X * 1.035, v: X * 3.9625, r: X * 0.5, collarH: X * 0.35 },
        bot: { u: 0, v: X * 2.3125, r: X * 0.5, collarH: X * 0.35 },
      },

      minSpeed: 2.60,
      maxSpeed: 6.60,
      aimMax: 0.45,

      mat: {
        boardFric: 0.62,
        boardRest: 0.08,
        woodFric: 0.30,
        woodRest: 0.22,
        wallFric: 0.04,
        wallRest: 0.42,
        ringFric: 0.06,
        ringRest: 0.18,
        ring100Fric: 0.06,
        ring100Rest: 0.18,
        deadFric: 0.24,
        deadRest: 0.10,
      },
    },
  },
];

// THE STAMPING LOOP: on a cup board, a hole's value IS the value of the cup sitting in its slot.
// Stamped once at module load so physics.js, the tests and every reader see ordinary valued
// holes, while the arrangement stays the single source of truth - a value edited by hand in
// `holes` would be overwritten here, which is the point.
for (const b of BOARDS) {
  if (!b.cups || !b.arrangement) continue;
  for (const slot of Object.keys(b.geom.holes)) {
    const cup = b.cups[b.arrangement[slot]];
    b.geom.holes[slot].value = cup ? cup.value | 0 : 0;
  }
}

/** The cup sitting in a slot, or null (every board without an arrangement layer - THE CLASSIC). */
export function cupAt(board, slotId) {
  if (!board || !board.cups || !board.arrangement) return null;
  return board.cups[board.arrangement[slotId]] || null;
}

/** The distinct colors a cup board pays for (scoring cups only - the equalizers are not a
 *  "color" to collect). Empty set on a board with no cups. */
export function scoringColors(board) {
  const out = new Set();
  if (board && board.cups) {
    for (const id of Object.keys(board.cups)) {
      const c = board.cups[id];
      if (c && (c.value | 0) > 0) out.add(c.color);
    }
  }
  return out;
}

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
