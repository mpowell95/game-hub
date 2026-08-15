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

// THE BOARD'S UNIT (2026-08-14, batch 3b). Matt specified the whole face as multiples of ONE
// number: x, the diameter of a hole. Every hole, every ring and both board dimensions are given
// as a multiple of it, so the layout below is written that way too - `X * 4.875`, never 0.709.
// Decimals here would be rounded copies of exact sixteenths, and the tangency rules that hold the
// face together (below) only hold if the numbers are exact.
//
//   board 6.875x wide by 9.5x tall  ->  9.5 / 6.875 = 1.3818, which IS boardLen/boardW (batch 3a)
//   at boardW 1.00m, x = 0.1455m; a hole is 0.0727m in radius against a 0.05m ball
//
// THE TANGENCY RULES, which are the shape of the board and not decoration:
//   1. Every hole touches its own ring at EXACTLY ONE point - the hole's bottom. So a ring's
//      lowest point IS its hole's lowest point, which is the whole placement rule: no ring is
//      concentric with its hole, each hangs above it.
//   2. The 30 ring's top touches the 40 ring's bottom.
//   3. The 40 ring's top, the 50 ring's bottom and the 20 ring's top all meet at ONE point.
// Rules 2 and 3 make the hole spacings a CONSEQUENCE of the ring diameters, not free numbers:
// h(n+1) = h(n) + ringD(n). Move a diameter and the holes above it move with it.
//
// One number in Matt's table cannot hold with the rest: he gave bottom-of-20-ring to
// bottom-of-30-ring as 1.25x, but at 1.25x the 40 ring's top and the 20 ring's top miss each
// other by 0.25x and rule 3's single point cannot exist. Kept the 4.875x diameter and let the
// distance be 1.5x, because 4.875x at x = 4in is 19.5in - the circle actually dimensioned on the
// reference drawing. `skeeball/js/test.js` asserts all three rules, so this cannot drift.
const X = 1.00 / 6.875;

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
      // THE BALL IS 0.7x ACROSS (Matt, 2026-08-14), measured the normal way - outermost point to
      // outermost point. Part of the same proportion set as the face; see the X block at the top.
      // Started at 0.78125x and came down to 0.7x to open the holes up: against a hole of 0.5x
      // radius the ball now clears the mouth by 0.15x all round instead of 0.11x.
      ballR: X * 0.35,
      ballMass: 0.18,
      // Player's end of the lane to the foot of the hump. SHORTER than a real alley on purpose
      // (Matt, 2026-08-13: the board is the main aspect of the game and must dominate the
      // frame), and shortened again on 2026-08-14 when the camera moved behind the ball: from
      // back there a 1.15m lane put a third of the screen's height between the ball and the
      // board with nothing in it. It also decides how much a launch angle spreads sideways
      // before the ball reaches the face, so `aimMax` is tuned against this number.
      laneLen: 1.40,
      // THE RAMP IS 5.375x WIDE (Matt, 2026-08-15), which with a 0.75x wall down each side is
      // exactly the 6.875x board. So the alley, its walls and the scoring face all share one
      // width, and the whole machine is one object.
      //
      // It was 0.53m - 68% of spec - and that was the single worst thing about how the ramp read:
      // a narrow plank running into a board nearly twice its width, so the ramp looked like a
      // separate part stuck on the end rather than the bottom of the machine.
      laneW: X * 5.375,
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
      // EVERY RING STANDS x TALL (Matt, 2026-08-14: "the height of Every ring is also equal to
      // x"). That is 0.1455m against a 0.10m ball, so a ring is not a rim to be crossed - it is a
      // wall to be cleared, and the only way into a hole is over the top of its ring and down.
      // This is the point of the whole rebuild and it REVERSES the 2026-08-14 note below about
      // flush cups: that note was right for a board scored by how far the ball ROLLS, and this
      // board is scored by where the ball LANDS.
      //
      // Matt also settled the visual question up front: a ring may hide its own hole from the
      // camera. "It is ok and normal if a ring blocks the view of the hole. The hole must be
      // there still, but the ring may block visibility." So do not shrink a ring, lower it, or
      // move a camera to keep every mouth in view.
      ringH: X,
      ringThick: 0.015,

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

      // THE FACE, to Matt's proportions (batch 3b). Seven holes, all one size (x across), each
      // with its OWN ring - see the tangency rules in the X block at the top of this file. Every
      // number below is a multiple of x and none of them is free: the diameters are Matt's, and
      // the v positions fall straight out of the tangency chain.
      //
      //   ring bottom = hole bottom = v - r        (rule 1: tangent at the hole's lowest point)
      //   h20 = 2.3125x is the one placement choice, and it sets the bottom margin
      //   h30 = h20 + 1.5x     (the 1.25x in Matt's table cannot hold - see the X block)
      //   h40 = h30 + ringD30  (rule 2)
      //   h50 = h40 + ringD40  (rule 3)
      //   h10 = h20 - 1.3125x  (Matt's bottom-of-10 to bottom-of-20 distance)
      //
      // machine.js derives each ring's centre from its hole; nothing here states a ring centre,
      // so the tangency cannot be broken by editing one number in isolation.
      //
      // THE 10 IS NOW A REAL HOLE. It used to be the trough's centre band (a ball that rolled
      // back off the face scored 10 by where it landed in the pit). The trough scoring is still
      // there and still the honest floor for a ball that never reaches the face - batch 3f is
      // what retires the resting-position rule - but the 10 the player AIMS at is this opening.
      //
      // `ringD` is the ring's DIAMETER, and `ringOpen` marks the 10's: it is not a closed circle
      // but an arc that runs from the left wall, across the bottom, to the right wall, and stops
      // (batch 3c). machine.js emits only its lower half, clipped at the rails. Without that clip
      // its upper arc would come back onto the board and cross the 50's mouth.
      holeR: X * 0.5,
      holes: {
        '100L': { u: -X * 2.75, v: X * 8.75, r: X * 0.5, value: 100, ringD: X * 1.0625 },
        '100R': { u: X * 2.75, v: X * 8.75, r: X * 0.5, value: 100, ringD: X * 1.0625 },
        c50: { u: 0, v: X * 7.1875, r: X * 0.5, value: 50, ringD: X * 1.4375 },
        c40: { u: 0, v: X * 5.625, r: X * 0.5, value: 40, ringD: X * 1.5625 },
        c30: { u: 0, v: X * 3.8125, r: X * 0.5, value: 30, ringD: X * 1.8125 },
        // Kept as `h20`, not renamed: the id is written into the mid-rack autosave
        // (gamehub.skeeball.save.v1) and old keys are never repurposed (THE LAW rule 5).
        h20: { u: 0, v: X * 2.3125, r: X * 0.5, value: 20, ringD: X * 4.875 },
        // The 10's ring diameter is the ONE number Matt's table does not give. 7.125x puts the
        // arc's ends on the side rails at v = 3.13x, which is where they sit in his drawing.
        h10: { u: 0, v: X * 1.0, r: X * 0.5, value: 10, ringD: X * 7.125, ringOpen: true },
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
      //
      // RE-BRACKETED 2026-08-14 for batch 3b's layout, and the reason is a NEW constraint that
      // did not exist on the old board: a ring now stands x tall, so a ball has to be
      // `ringH + ballR` = 0.195m above the face AT THE MOMENT IT ARRIVES to drop into a hole
      // rather than bounce off the outside of its wall. Reaching a hole's v is no longer enough.
      // The 100s sit highest (v 1.27), which is exactly where the arc has already come down, so
      // they are the binding case: measured clearance at their row is 0.188m at maxSpeed 5.47 -
      // seven millimetres short, and both corners were unreachable at EVERY aim because of it.
      // At 6.00 the same row gets 0.290m and they open up. (Clearance there is not monotonic in
      // speed - 6.50 measures 0.174 - because the arc's peak walks past the row and back; do not
      // "improve" this by pushing the number higher.)
      // 6.00 -> 6.20 when the ball grew to its specified 0.78125x: a bigger ball has to clear a
      // ring by its own radius, so the bar at the 100s' row went from 0.195m to 0.202m and both
      // corners closed again. Clearance at that row is NOT monotonic in speed (the arc's peak
      // walks past it and back), so this was measured, not extrapolated: 5.80 and 6.40 both score
      // zero 100s over a 66-cell power/aim grid, 6.20 scores two.
      //
      // WIDENED AT BOTH ENDS 2026-08-14, on Matt actually playing it: *"the whole thing requires
      // flicks that are way too slow. a natural flick is always at the max speed you've set. to
      // try and get a 10, i have to barely touch the ball. it's unnatural."* One window set too
      // narrow AND too slow: an ordinary flick was pinned against the ceiling, so the top of the
      // board could not be reached however hard he threw, and the floor sat so high that the
      // nearest hole needed a tap instead of a throw.
      //
      // THE RULE THESE TWO MUST SATISFY, and the one the old pair broke: a comfortable, natural
      // flick belongs in the MIDDLE of the range. Every previous pair was chosen to bracket the
      // ladder exactly - minSpeed just reaches the nearest hole, maxSpeed just reaches the
      // furthest - which reads well in a bench measurement and is precisely what makes a real
      // thumb saturate it. Do not re-tighten these to bracket a ladder again.
      // maxSpeed 8.60 -> 6.20. 8.60 was raised at the same time as the ui.js saturation fix, and
      // the two multiplied: once a natural flick correctly landed MID-dial, mid-dial against an
      // 8.60 ceiling came out at ~6.35 m/s - faster than the old ceiling was - so an ordinary
      // throw slammed the backboard and bounced all the way home. Matt: *"A natural flick shoots
      // the ball straight into the top of the backboard, which causes it to bounce all the way
      // back down the ramp."*
      //
      // The lesson, since this is twice now: the ceiling and the swipe curve in ui.js are ONE
      // system. Raising the ceiling makes every throw faster, not just the hardest one. If the
      // complaint is about how a NORMAL throw feels, the curve is the knob; the ceiling is only
      // the knob for what the very hardest throw is worth. 6.20 is where the top corners open up.
      minSpeed: 2.60,
      maxSpeed: 6.20,
      // HOW FAR SIDEWAYS A BALL CAN BE THROWN, in radians. Matt: *"you heavily restrict the angle
      // i can throw the ball. that's the fucked part... If i want to slam it directly into the
      // wall, i must be able to."*
      //
      // 0.17 was chosen to thread the ball into the top corners, and it bought that by making
      // every other angle impossible - the side walls could not be reached at all, at any power.
      // Throwing at a wall and getting nothing for it is a legitimate thing to want to do, and a
      // game that forbids it is only smaller. Wide enough now to hit either side wall on purpose.
      aimMax: 0.45,

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
