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
      // Player's end of the lane to the foot of the hump. SHORTER than a real alley on purpose
      // (Matt, 2026-08-13: the board is the main aspect of the game and must dominate the
      // frame), and shortened again on 2026-08-14 when the camera moved behind the ball: from
      // back there a 1.15m lane put a third of the screen's height between the ball and the
      // board with nothing in it. It also decides how much a launch angle spreads sideways
      // before the ball reaches the face, so `aimMax` is tuned against this number.
      laneLen: 1.40,
      laneW: 0.53,
      bedThick: 0.06,         // slab thickness for every floor/wall box
      humpLen: 0.42,          // the rising kicker. SHORT as well as steep: the launch ANGLE is
                              // what creates the arc, but the ramp's HEIGHT decides whether the
                              // player can see past it. At 0.30 long this crest stood 0.20m up,
                              // 0.13m proud of the board's bottom edge, and from a camera behind
                              // the ball it hid the 20 and the 10 completely (sight.mjs measures
                              // the clearance: -0.088m). Halving the length halves the crest and
                              // keeps every angle. Re-run sight.mjs if this or the camera moves.
      // ...as segment angles; the last one IS the launch angle, and it is the most load-bearing
      // number on this machine.
      //
      // THE RULE: the launch angle must EXCEED `boardTilt`, or there is no arc at any power.
      // Range up the slope for a projectile onto an incline is
      //     R = 2 v^2 cos(t) sin(t - a) / (g cos^2(a))
      // which goes to zero at t = a and negative below it. A ball launched shallower than the
      // face it is flying at simply cannot get above that face: it meets the bottom edge and
      // rolls from there, at every power, forever.
      //
      // Which is exactly what shipped on 2026-08-14. Chasing a max-power ramp that threw the
      // ball clean over the board, this was flattened to 0.30 rad against a 0.56 rad board -
      // and `tune-ladder.mjs --touch` reported the result as "101 of 101 touched the scoring
      // face" and called it a win. Matt, next morning: *"The ball doesn't go in the air. It hits
      // a tiny bump rather than a ramp that shoots it in the air. Regardless of how hard I throw
      // the ball, it touches the very bottom of the scoring board 100% of the time."* Measured:
      // peak clearance over the face 0.6-3.5cm, airborne 0.00-0.01s, and 0 of 21 throws first
      // touched the board above v=0.10.
      //
      // 0.88 rad (50 degrees) clears the board's tilt by 18 and gives a real skeeball arc: the
      // ball leaves the lip, flies 20-35cm clear of the face for a third of a second, and comes
      // down between v=0.03 (weakest) and v=0.86 (hardest) - so more than half of all throws now
      // drop straight into a cup without touching the board at all, which is the shot the game
      // is FOR. Run `measure-arc.mjs` after touching these, not just `tune-ladder.mjs`.
      humpAngles: [0.1862, 0.3723, 0.5585, 0.7447, 0.9308, 1.117],
      troughLen: 0.18,        // the catch pit between the hump's crest and the board - wide
                              // enough that a ball flying back off the board's lip drops in and
                              // meets the hump's back side as a wall, instead of skipping the
                              // gap and rolling home down the lane
      troughDepth: 0.15,
      // The board's bottom edge height. RAISED from 0.07 on 2026-08-14: a ramp steep enough
      // to throw the ball has a crest, and at 0.07 that crest stood proud of the board and hid
      // the 20 and the 10 from a camera behind the ball. On a real cabinet the playfield starts
      // ABOVE the ramp's lip for exactly this reason. sight.mjs measures the clearance; keep it
      // positive whenever the ramp, the board or the camera moves.
      boardLipY: 0.42,
      boardTilt: 0.7854,        // ~32 degrees: a bowl to roll around, not a wall to fall down
      // DELIBERATELY WIDER THAN A REAL MACHINE, and not a mistake to correct back.
      // A real cabinet's target area is about 0.53m against a 79mm ball - 6.7:1. Ours is 10:1.
      // The reason is the phone: ball and board sit at very different distances from the camera,
      // so the on-screen ratio is the world ratio TIMES the distance ratio. At 6.2:1 the only
      // camera that filled the frame with the board sat 9.15m back at a 5032px focal length - a
      // telephoto, where the lane loses all convergence and stops reading as a lane. At 10:1 a
      // normal ~2m camera satisfies every screen check at once. Narrowing this toward realism
      // breaks the framing. See skeeball/CLAUDE.md.
      boardW: 1.00,           // wider than the lane, like the real cabinet's flared board - and
                              // wide enough that the channel between the ring and the rails
                              // passes a ball freely (the spacing rule below)
      // Metres up the slope. The extra above the 50 is not spare: it is the room the 50's
      // painted number needs (render.js puts each value up-slope of its own mouth, and at 0.95
      // the top one was sliced by the board's edge), and it is what lets a genuine slam run past
      // everything and reach the back wall - 9 of 101 straight throws do, which is the rare
      // hard-throw outcome it should be rather than the 25-of-51 the old ramp produced.
      // THE BOARD IS A RECTANGLE, NOT A SQUARE (2026-08-14, batch 3a). It was 1.00 x 1.00 -
      // literally square. Matt's reference diagram of a real machine gives a target board of
      // 27.5" wide x 38" tall, a ratio of 1 : 1.3818, so at boardW 1.00 the length is 1.3818.
      //
      // boardW is deliberately NOT the side that moved: its own comment above records that the
      // width is set by what the camera needs to frame, and narrowing it to reach the ratio
      // would undo that. Length is the free side.
      //
      // Holes and the ring were left exactly where they are by this change, which leaves them
      // sitting low on a now-taller board. That is expected and is batch 3b's job, not this one.
      boardLen: 1.3818,
      railH: 0.10,
      laneRailH: 0.05,
      backboardH: 0.8,        // tall, like the real cabinet's upper case: a max-power ball must
                              // hit its FACE and die there, never clip its top edge (a corner
                              // contact there once redirected the ball all the way home; the
                              // max-power arc tops out around y=1.25 and the top edge must clear it)
      ringSegments: 24,
      cupSegments: 14,
      collarThick: 0.012,
      // The big painted target circle. `solid: false` (2026-08-14) makes it PAINT, not a wall:
      // as a 7.5cm band it fenced the cup cluster off completely, so a rolling ball stopped dead
      // on its front arc and the only route to the 30/40/50 was over the top through the air.
      // machine.js emits no segments for it; render.js draws it into the field texture.
      ringH: 0.055,
      ringThick: 0.015,
      ring: { u: 0, v: 0.44, R: 0.29, solid: true },

      // How low a lipLow cup's DOWN-SLOPE lip sits, as a fraction of its wall height. Moot while
      // every cup is flush (collarH 0) but kept for the next machine, which may want walls.
      lipLowFrac: 0.50,

      // How far the ball must drop, as a fraction of its radius, to count as fallen IN
      // (physics.js's capture test). This is the ladder's master knob: bigger = harder to fall
      // in = the ball runs further up the board before a cup can take it. It trades against the
      // mouth radius (a wider mouth takes longer to cross, so it catches faster balls): 0.45
      // with r 0.060 and 0.80 with r 0.075 measure as the same ladder, and the smaller mouths
      // are the ones that leave room on the face for a number beside each hole.
      captureDrop: 0.35,

      // THE CLASSIC LADDER. Four flush openings up the centreline, evenly spaced, with the twin
      // 100s out in the top corners where only an aimed ball reaches them. The 10 is the
      // full-width slot the board's bottom edge feeds (physics.js scores the trough) and the 0s
      // are its corners.
      //
      // The cup a throw wins is chosen by HOW FAR UP THE FACE IT ROLLS, because a ball only
      // falls into a mouth it is crossing slowly enough to drop through (physics.js, section 2).
      // So these v positions ARE the power ladder: moving one moves a band. They were not
      // guessed - measure-reach.mjs runs the engine with the holes taken OUT and records how far
      // up the face each power setting gets, and these sit on that curve at even intervals.
      //
      // EVERY CUP IS FLUSH (collarH 0), which is the single biggest thing that made the ladder
      // learnable. Walls of 14-20mm read as nothing on screen and behaved as a step to a 50mm
      // ball: crossing three of them on the way to the 50 scattered the outcome, and the
      // measured ladder went from 34 flips with 20mm walls to 17 with none, on otherwise
      // identical geometry. A hole in a board is also what the reference photos show. The
      // numbers are painted on the FACE (render.js `_paintField`), so nothing needs a wall to
      // be legible either. Re-run tune-ladder.mjs after moving anything here.
      //
      // The old spacing rule (gaps either merged or >= 0.105, or a ball can jam in the pocket
      // between two pieces of furniture) is satisfied trivially now: with no walls there is no
      // furniture on the face to jam against, and tune-ladder.mjs reports 0/101 throws needing
      // the jam watchdog.
      holes: {
        '100L': { u: -0.320, v: 0.76, r: 0.085, value: 100, collarH: 0.028, lipLow: true },
        '100R': { u: 0.320, v: 0.76, r: 0.085, value: 100, collarH: 0.028, lipLow: true },
        c50: { u: 0, v: 0.88, r: 0.095, value: 50, collarH: 0.028, lipLow: true },
        c40: { u: 0, v: 0.66, r: 0.095, value: 40, collarH: 0.028, lipLow: true },
        c30: { u: 0, v: 0.44, r: 0.095, value: 30, collarH: 0.028, lipLow: true },
        // Kept as `h20`, not renamed: the id is written into the mid-rack autosave
        // (gamehub.skeeball.save.v1) and old keys are never repurposed (THE LAW rule 5).
        h20: { u: 0, v: 0.22, r: 0.095, value: 20, collarH: 0.028, lipLow: true },
      },
      troughTenHalfW: 0.26,   // |x| under this in the trough scores 10; wider is a corner 0

      // The swipe's speed range (m/s at the serve), and the whole reason the old build had dead
      // zones at both ends of the thumb: it ran 1.0 to 7.4, of which everything below 1.4 could
      // not reach the board and everything above ~3.5 flew off it. The useful window was a
      // sliver in the middle and the player's whole range mapped onto it at random. These two
      // numbers now bracket the LADDER: minSpeed just makes the 20, maxSpeed just clears the
      // 50 into the 100s' row.
      // numbers now bracket the LADDER exactly: at minSpeed the ball just reaches the 20, at
      // maxSpeed it just reaches the 100s' row. The window is narrow (0.98 m/s wide) and that is
      // the point - the whole of the player's swipe now lands inside it instead of most of it
      // landing past the top of the board.
      minSpeed: 3.39,
      maxSpeed: 5.47,
      aimMax: 0.1316,           // radians of lateral aim. Small because the lane is long: a launch
                              // angle is integrated over ~2.5m of travel before the ball reaches
                              // the top corners, so 0.15 rad already carries it the full 0.30m
                              // out to a 100. The old 0.32 put full aim a metre off the board.

      // Contact model overrides (defaults and the reasoning live in physics.js). A board that
      // the ball LANDS on and rolls up has to be dead, not lively.
      mat: {
        boardFric: 0.62,
        boardRest: 0.08,
        woodFric: 0.30,
        woodRest: 0.22,
        wallFric: 0.04,
        wallRest: 0.42,
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
