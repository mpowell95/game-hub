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
//      concentric with its hole; each hangs above it. (The ring wall's INNER face kisses the
//      mouth's edge - the wall stands outside its own opening, never over it.)
//   2. Where two rings meet, they touch at their OUTER faces (Matt, 2026-08-23: "OBVIOUSLY the
//      rings should be tangent along their outermost point - not the inside"): the 30/40 and
//      40/50 junctions, h(n+1) = h(n) + ringD(n) + 2 * RING_T. The first build met these at the
//      wall CENTRELINES, a one-wall-thickness overlap that put the 40's ring 1.5cm inside the
//      50's mouth - impossible on a real board.
//   3. RETIRED (2026-08-23). The old "40 top, 50 bottom, 20 top meet at ONE point" was the
//      2026-08-14 session's resolution of a spec-table conflict, and Matt has now resolved it
//      the other way WITH A TAPE MEASURE: H (30-ring bottom outer to 20-ring bottom inner) is
//      the table's 1.25x = 5in, and at 1.25x the triple cannot exist. The 20's ring top now
//      stops 8.6mm short of the 50's ring - a gap, never an overlap (test.js asserts both).
//      Measurement I (20-ring bottom outer to the 10 arc's inner edge) = 1.375x = 5.5in fixes
//      the 10 the same way.
const X = 1.00 / 6.875;
const RING_T = 0.015;             // the ring wall's thickness; geom.ringThick and the v shifts share it

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
      // 3.0in on Matt's real cabinet at x = 4in (measured 2026-08-23): 0.75x across, so ballR
      // is 0.375X. ball.ratio is waived below - the spec's 0.350X predates the measurement.
      ballR: X * 0.375,
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
      ringThick: RING_T,

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
      //   THE ANCHOR IS THE 50'S CAP, derived top-down (Matt, 2026-08-23, in two steps): "the
      //     top of the 50 should be like the center of the 100 rings at the highest", so the
      //     50-ring's outer top sits EXACTLY at the 100 rings' centre (8.78125x), and the rest
      //     of the column chains DOWN from it. The bottom then lands where it lands: the 10
      //     arc's outer base at 0.51875x (~2.1in) from the edge - Matt saw that strip and chose
      //     to spend it ("There's space between the bottom of the semi circle and the end of
      //     the board now. Can't you use that? Edit the constraint you just made"), accepting
      //     the arc rim's plan-view lean over the front strip (~1.4in) in exchange. The earlier
      //     rim-plumb anchor (h10 = 1.5x + RING_T) put the 50 against the back wall; before
      //     that, the unmeasured 08-14 anchor (h20 = 2.3125x) hung the rim ~3in off the board.
      //   h50 = 7.84375x - RING_T                  (the cap: ring top outer = 8.78125x exactly)
      //   h40 = h50 - ringD40 - 2*RING_T           (rule 2, outer faces)
      //   h30 = h40 - ringD30 - 2*RING_T           (rule 2 again; rule 3's triple is retired)
      //   h20 = h30 - 1.25x - RING_T               (measurement H, 2026-08-23: 5in)
      //   h10 = h20 - 1.375x - RING_T              (measurement I, 2026-08-23: 5.5in)
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
        // 2026-08-23: 1.0625 (4.25in) again - MEASURED off the real cabinet by Matt, with the
        // ball also corrected to its real 0.75x. The 1.19 story above stays as history of why
        // 1.0625 once read as a pinhole; the measured pair is what ships, re-swept together.
        '100L': { u: -X * 2.75, v: X * 8.75, r: X * 0.5, value: 100, ringD: X * 1.0625 },
        '100R': { u: X * 2.75, v: X * 8.75, r: X * 0.5, value: 100, ringD: X * 1.0625 },
        // The column, derived from Matt's 2026-08-23 measurements (the X-block comment): H and
        // I fix the 30 and the 10 against the anchored 20; rule 2's outer tangency chains the
        // 40 and 50 up from the 30. Rule 3's triple point is retired - see the X block.
        c50: { u: 0, v: X * 7.84375 - RING_T, r: X * 0.5, value: 50, ringD: X * 1.4375 },
        c40: { u: 0, v: X * 6.28125 - RING_T * 3, r: X * 0.5, value: 40, ringD: X * 1.5625 },
        c30: { u: 0, v: X * 4.46875 - RING_T * 5, r: X * 0.5, value: 30, ringD: X * 1.8125 },
        // GUARD, THE LAW rule 5: kept as `h20`, not renamed - the id is written into the
        // mid-rack autosave (gamehub.skeeball.save.v1) and old keys are never repurposed.
        h20: { u: 0, v: X * 3.21875 - RING_T * 6, r: X * 0.5, value: 20, ringD: X * 4.875 },
        h10: { u: 0, v: X * 1.84375 - RING_T * 7, r: X * 0.5, value: 10, ringD: X * 7.125, ringOpen: true },
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
        // The backboard's own pair (matBack in machines/classic/physics.js). Zero grip: the wall
        // must never convert serve topspin into climb (DECISIONS.md, "The back wall does not
        // lift the ball"). 0.60 restitution: Matt, 2026-08-23, after a wall ball dropped into
        // the 50 - "make it way bouncier, so it bounces way back towards the user". Measured at
        // 0.60 over 34 hard wall throws: the 100s-off-the-wall fall 6 -> 0, dead-drop 50s gone,
        // 27 of 34 end in the honest 10 or 0, and the rebound is visible. The kicker keeps
        // deadFric/deadRest above.
        backFric: 0,
        backRest: 0.60,
      },
    },

    specWaivers: {
      'ball.ratio': 'Matt measured the real cabinet, 2026-08-23: the ball is 3.0in against '
        + 'x = 4in, so ballR is 0.375X (0.75x across). The spec sheet\'s 0.350X predates the '
        + 'measurement; the real ball wins. Reach, dial and mat re-swept on this exact ball.',
    },
  },

  {
    id: 'basketball',
    name: 'HOT SHOT',
    taglineKey: 'board_basketball_tag',
    // Render dressing (Matt, 2026-08-22: "cups instead of basketball baskets... shooting a
    // basketball"): render.js branches on this to draw the ball as a basketball, the collars as
    // orange wire baskets, and each value on a white mini backboard behind its hoop. Physics is
    // untouched - the wall the ball hits is still machine.js's collar.
    dressing: 'basketball',
    // Complete THE CLASSIC's three objectives (js/goals.js). unlocksEarned() ignores it (no
    // `score` field) and ui.js applies it.
    unlock: { board: 'classic', goals: true },
    // ADMIN ONLY right now (Matt, 2026-08-24, still tuning this machine): ui.js never unlocks it
    // by play and shows it locked to non-dev profiles; the dev bypass still opens it. NOTHING is
    // deleted - a player who already earned it keeps sk.unlocked.basketball, and access returns
    // the moment this flag comes off. Drop this line to release the machine.
    adminOnly: true,

    // Matched to the reference photos in skeeball/Machines/Machine 4 - Basketball/ (the real
    // cabinet, sold as Basket Fever): yellow-and-black cabinet, blue face, orange wire
    // hoops, red LED glow, white nets. `glow`/`net` are required by look.complete but
    // currently painted by nothing.
    look: {
      wood: '#5b5b66',
      woodDark: '#191a1e',
      cabinet: '#f2c526',
      cabinetEdge: '#1a1a1a',
      face: '#2560bd',
      faceEdge: '#143564',
      ring: '#e8541f',
      ringLip: '#ffd23f',
      value: '#ffffff',
      pocket: '#0a0705',
      marquee: '#1e63b8',
      marqueeText: '#ffd23f',
      bulb: '#ffd23f',
      glow: '#ff3b1f',
      wall: '#161016',
      net: '#f2f2f2',
    },

    // The hoops ride the ARRANGEMENT LAYER even though nothing about them is movable in real
    // life: on a collar board the cup layer is what carries a printed value onto the collar's
    // far wall (render.js _cupPlate) - a collar hole with a hand-written value would render
    // with no number at all. The arrangement is FIXED (the real machine's 10/20/10, 30/60/30,
    // 50/100/50 grid) and there is no rearrangement story here. Every hoop is the same orange;
    // game.js's colorSweep is gated on need > 1, so a one-color board can never count a
    // "color sweep" into sk.colorSweeps (which would falsely satisfy POPONGO's colors goal).
    cups: {
      h10a: { value: 10, color: '#e8541f', ink: '#ffffff', label: '10' },
      h10b: { value: 10, color: '#e8541f', ink: '#ffffff', label: '10' },
      h20: { value: 20, color: '#e8541f', ink: '#ffffff', label: '20' },
      h30a: { value: 30, color: '#e8541f', ink: '#ffffff', label: '30' },
      h30b: { value: 30, color: '#e8541f', ink: '#ffffff', label: '30' },
      h50a: { value: 50, color: '#e8541f', ink: '#ffffff', label: '50' },
      h50b: { value: 50, color: '#e8541f', ink: '#ffffff', label: '50' },
      h60: { value: 60, color: '#e8541f', ink: '#ffffff', label: '60' },
      h100: { value: 100, color: '#e8541f', ink: '#ffffff', label: '100' },
    },
    arrangement: {
      lowL: 'h10a', lowC: 'h20', lowR: 'h10b',
      midL: 'h30a', midC: 'h60', midR: 'h30b',
      topL: 'h50a', topC: 'h100', topR: 'h50b',
    },

    // Part 1 of MACHINE-SPEC.md, copied from THE CLASSIC (same cabinet, same lane, same ramp,
    // same throw - the face is the only thing that changes). troughTenHalfW and ringSegments are
    // deliberately absent: both are classic-only vestiges (see the spec, sections 6 and 12).
    geom: {
      // THE BALL is THE CLASSIC's ball (Matt, 2026-08-24: the small ball read too small; make
      // it the same as the classic). ballR X*0.375 = 0.75X diameter, the classic's measured
      // 3in-at-x=4in. The eight standard hoops stay 1.0X across (mouth ~1.33x the ball); only the
      // 100 shrinks (below).
      ballR: X * 0.375,
      ballMass: 0.18,
      laneLen: 1.40,
      laneW: X * 4.875,
      bedThick: 0.06,
      humpLen: 0.42,
      // STEEPER THAN THE CLASSIC'S RAMP, deliberately (Matt, 2026-08-22: the throw must read as
      // SHOOTING A BASKETBALL, not rolling a skeeball). Final segment 70 degrees - the spec's
      // allowed maximum (section 5, 55-70) - in six even steps so the ball can track the
      // surface. Range up the face barely moves (R goes as cos(t)sin(t - tilt)/cos^2(tilt))
      // but the peak is higher and the descent steeper, so the ball drops INTO a basket from
      // above instead of skimming up the face. Re-swept after: all nine hoops clean-capturable,
      // 0 emergencies.
      humpAngles: [0.2036, 0.4072, 0.6109, 0.8145, 1.0181, 1.2217],
      troughLen: 0.225,
      troughDepth: 0.15,
      boardLipY: 0.42,
      // Nominal only on this machine: `steps` below replaces the single tilted face entirely
      // (machine.js builds the staircase from it and never reads boardTilt when steps exist).
      // Kept in the allowed range for the spec check and the camera's fallback maths.
      boardTilt: 0.8726,
      boardW: 1.00,
      // THE STAIRCASE (Matt, 2026-08-22, from his real-machine footage: "3 stairs... a
      // horizontal board with 3 holes, a vertical wall... then the back wall"): three TIERS,
      // each a near-flat TREAD carrying three basket mouths followed by a VERTICAL RISER, and
      // the back wall above the third riser. Face coordinates unroll along the whole surface
      // (machine.js), so v runs tread 1 -> riser 1 -> tread 2 -> ... Each tread leans 0.10 rad
      // toward the player ("slightly angled back towards the player so balls don't get stuck") -
      // a missed ball rolls forward off the tread's front edge and drops to the tier below,
      // exactly the footage's miss. boardLen is the unrolled total; board.dims is waived for it.
      // Risers 0.28 m (Matt, tuning pass: "everything seems a little low... the back wall seems
      // larger than in the other games") - the staircase now tops out at ~1.35 m, near the
      // classic face's 1.40 m, so the cabinet reads the same height as its neighbours and the
      // back wall shrinks back to the other machines' proportion.
      steps: [
        { len: X * 2.0625, tilt: 0.10 },       // tread 1 (0.30 m)
        { len: X * 1.925, tilt: Math.PI / 2 }, // riser 1 (0.28 m)
        { len: X * 2.0625, tilt: 0.10 },       // tread 2
        { len: X * 1.925, tilt: Math.PI / 2 }, // riser 2
        { len: X * 2.0625, tilt: 0.10 },       // tread 3
        { len: X * 1.925, tilt: Math.PI / 2 }, // riser 3 (the back wall rises behind it)
      ],
      boardLen: X * 11.9625,
      railH: 0.10,
      laneRailH: 0.05,
      // Back at the other machines' proportion (Matt: the wall read oversized). The vertical-pop
      // guard that briefly pushed this to 1.10 is carried by the staircase itself now (no steep
      // face to ski-jump off) plus the slick dead wall below; the probe stays the check.
      backboardH: 0.85,
      cupSegments: 14,
      collarThick: 0.012,
      ringH: X,
      ringThick: RING_T,
      lipLowFrac: 0.50,
      captureDrop: 0.35,

      // THE HOLES: three per tread, sunk into the TREAD itself - the real machine's baskets
      // funnel into holes in the shelf, and the only way in is through the basket's mouth from
      // above (a full-circle collar walls off every rolling entry). MOUTHS ARE 1.0X (r 0.5X)
      // against the 0.28X ball - tightened from 1.125X at Matt's tuning pass ("a little too
      // easy").
      //
      // THE BASKETS SIT AT THE BACK OF EACH TREAD (0.75X from the tread's back edge, against
      // the riser like the real cabinet's hanging baskets), and this is MATT'S EXPLICIT CALL,
      // 2026-08-23: a front-of-tread placement shipped briefly to stop wall-killed and
      // tier-falling balls dropping in, and he ordered it undone - "a horrible fix that creates
      // significantly more problems than it fixes." Do NOT move these forward again. The known
      // consequence is accepted: a ball the back wall kills, or one falling from the tier
      // above, can land in a basket - that is how the real machine plays. Tread starts in
      // unrolled v: 0 / 3.9875X / 7.975X; the mouths lean 0.10 rad with their tread.
      // THE BASKETS ARE A FULL 1.0X DEEP - as deep as the mouth is wide, which is the real
      // basket's proportion. They were 0.35X until 2026-08-24 and read as wire rings rather
      // than baskets. MEASURED BEFORE IT SHIPPED, on the 41x21 grid, basketball only: 0.35X
      // scored 167/861, 1.0X scores 146/861, both with all nine mouths capturable, 0
      // emergencies and the slowest settle a shade FASTER (5.51s -> 5.39s). Depth costs 13% of
      // the scoring rate and buys a better row spread - the low row took 46% of every score at
      // 0.35X and takes 40% at 1.0X.
      //
      // WHY DEPTH IS NEARLY FREE, so a future session does not "fix" the collar back down: a
      // taller rim cuts both ways in physics.js. It rejects more approaches on the outer wall,
      // but capture is "centre below the RIM plane inside the mouth", and a rim 1.0X up trips
      // that condition far earlier in the descent. The two effects very nearly cancel. 0.55X
      // and 0.75X were measured too (48 and 45 per 231) - the curve is flat, so pick the depth
      // that looks right, not the one that scores best.
      // RIM DIAMETERS ARE MATT'S SPEC, verbatim (2026-08-24): the eight standard rims are 1.5X
      // (6in) and the 100 rim is 1.0625X (4.25in), against the X (4in) hole and the 0.75X (3in)
      // ball. Every rim clears the ball; the 100 is the one small, hard basket. `r` is the RIM
      // radius (half the diameter): standard 0.75X, the 100 0.53125X. Depth (collarH) is ~2/3 of
      // each rim's diameter, a shade shallower than the reference basket and swept to keep the
      // stall watchdog rare (a rim as DEEP as it is wide traps the ball - measured 38% emergencies).
      holeR: X * 0.75,
      holes: {
        lowL: { u: -X * 2.07, v: X * 1.3125, r: X * 0.75, collarH: X * 1.0 },
        lowC: { u: 0, v: X * 1.3125, r: X * 0.75, collarH: X * 1.0 },
        lowR: { u: X * 2.07, v: X * 1.3125, r: X * 0.75, collarH: X * 1.0 },
        midL: { u: -X * 2.07, v: X * 5.3, r: X * 0.75, collarH: X * 1.0 },
        midC: { u: 0, v: X * 5.3, r: X * 0.75, collarH: X * 1.0 },
        midR: { u: X * 2.07, v: X * 5.3, r: X * 0.75, collarH: X * 1.0 },
        topL: { u: -X * 2.07, v: X * 9.2875, r: X * 0.75, collarH: X * 1.0 },
        // THE 100 IS THE SMALL RIM: 1.0625X (4.25in) across vs the eight 1.5X (6in) hoops - Matt's
        // spec. Still 1.42x the 0.75X ball, so it fits; it is just the tight, hard target.
        topC: { u: 0, v: X * 9.2875, r: X * 0.53125, collarH: X * 0.708 },
        topR: { u: X * 2.07, v: X * 9.2875, r: X * 0.75, collarH: X * 1.0 },
      },

      minSpeed: 2.60,
      maxSpeed: 6.60,
      aimMax: 0.45,

      // SLICK AND DEAD almost everywhere, unlike every other board (Matt's footage: on the real
      // machine the ball is in the air, in a basket, or falling - never rolling around or
      // caroming). Treads are slick so a miss rolls off the front edge; the back wall's grip is
      // near zero (deadFric) because a fast ball sliding down a gripping wall gets flicked
      // upward by the friction impulse - the measured cause of half the remaining vertical
      // pops; and the side walls are deadened (wallRest) because their horizontal tops bounced
      // steep descents straight up (the other half).
      mat: {
        boardFric: 0.12,
        boardRest: 0.05,
        woodFric: 0.30,
        woodRest: 0.22,
        wallFric: 0.04,
        wallRest: 0.15,
        ringFric: 0.06,
        ringRest: 0.30,
        ring100Fric: 0.06,
        ring100Rest: 0.30,
        deadFric: 0.06,
        // Livelier than the other machines' dead wall on purpose (Matt, tuning pass): a hard
        // straight throw should BOUNCE BACK toward the player off the back wall, not die
        // against it and drip down onto the top tier.
        deadRest: 0.32,
        // The back wall gets the classic's rebound (its own matBack in basketball/physics.js), so
        // a hard throw comes back at the player rather than banking into the 100. Kick panel keeps
        // deadRest above.
        backFric: 0,
        backRest: 0.60,
      },
    },

    specWaivers: {
      'ball.ratio': 'The ball is THE CLASSIC\'s (0.375X = 0.75X diameter, Matt 2026-08-24: the '
        + 'small ball read too small). Eight hoops stay 1.0X across; only the 100 is smaller '
        + '(0.7083X), the design\'s tighter top-centre rim. Sweep re-run: all nine hoops '
        + 'clean-capturable, emergencies within budget.',
      'board.dims': 'Matt ordered the stepped rebuild, 2026-08-22: "change the board from a '
        + 'single board with a back wall to... 3 stairs", even if new physics had to be built. '
        + 'boardLen is the UNROLLED length of three treads plus three risers (11.1375X), which '
        + 'necessarily exceeds the flat-board 10.5X ceiling. Sweep re-run on the staircase.',
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
    unlock: { board: 'basketball', goals: true },
    // ADMIN ONLY right now (Matt, 2026-08-24, testing): same as basketball above - never unlocked
    // by play, shown locked to non-dev profiles, dev bypass still opens it, nothing deleted. Drop
    // this line to release.
    adminOnly: true,

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
    // same throw - the face is the only thing that changes) EXCEPT the ball, under the waiver
    // below. troughTenHalfW and ringSegments are deliberately absent: both are classic-only
    // vestiges (see the spec, sections 6 and 12).
    geom: {
      // THE PING-PONG BALL (Matt, 2026-08-22): the real Popongo is a ping pong ball thrown into
      // solo cups - mouth about 2.4x the ball - and at the classic's 0.35X ball our cups read
      // tiny and could not grow (the 3-across row caps cup size against the rails). Shrinking
      // the ball is what buys mouth/ball ~2.0 AND lets the cups sit closer. ball.ratio is
      // waived for it, below.
      ballR: X * 0.28,
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
      ringThick: RING_T,
      lipLowFrac: 0.50,
      captureDrop: 0.35,

      // THE FACE: nine identical holes in a diamond (1-2-3-2-1), each wearing a raised cup
      // collar (collarH) instead of a ring - the collar system machine.js has carried since the
      // classic's flush rebuild, used here for the first time. No hole has a ringD.
      //
      // The lattice, and why these exact numbers (see DECISIONS.md#popongo-layout):
      //   row step t = 1.63X, lateral half-step s = 1.075X, cups r = 0.5625X, ball 0.28X
      //   - NOTHING IS MERGED AND NOTHING IS TIGHT: every neighbour pair - same-row (2s),
      //     diagonal (sqrt(s^2+t^2) = 1.953X) and collar-to-rail - leaves a wall gap of at
      //     least 0.64X, over the ball (0.56X) plus margin. The first draft put midL/midR FLUSH
      //     against the rails (the classic-100s idea) and a measured sweep showed why that is
      //     wrong for a collar: a flat rail and a curved collar wall converge gradually, and
      //     every ball that entered the crevice three-contact-locked the solver - 12% of all
      //     throws ended in the watchdog's walkout, gifted to midL/midR. GUARD: a collar near
      //     a FLAT wall is a pocket even when their closest gap is zero; keep every collar a
      //     ball-width off the rails.
      //   - THE CUPS ARE AS BIG AS THIS DIAMOND CAN HOLD. The 3-across row binds them: three
      //     collars plus four ball-passing gaps must fit inside boardW, so at the classic's
      //     0.35X ball the mouths could never exceed ~1.0X (measured: the first ship read as
      //     tiny cups, Matt 2026-08-22). The ping-pong ball (0.28X, waived below) is what buys
      //     mouth 1.125X at mouth/ball ~2.0 - the solo-cup feel - AND visibly closer cups.
      //   - bot sits at v = 2.3125X (the classic 20's row - minSpeed's reach); top at
      //     v = 8.8325X, above the classic 100s' row, which the raised top row of a diamond
      //     needs for its diagonals to clear - reachable because a collar (0.35X) asks for far
      //     less arrival clearance than the classic's X-tall rings did.
      // Values are NOT written here - they come from the arrangement (see the stamping loop at
      // the bottom of this file). collarH is a SLOT property (slots own geometry; cups own
      // value and paint), uniform across the face like the real product's identical cups.
      holeR: X * 0.5625,
      holes: {
        top: { u: 0, v: X * 8.8325, r: X * 0.5625, collarH: X * 0.35 },
        uppL: { u: -X * 1.075, v: X * 7.2025, r: X * 0.5625, collarH: X * 0.35 },
        uppR: { u: X * 1.075, v: X * 7.2025, r: X * 0.5625, collarH: X * 0.35 },
        midL: { u: -X * 2.15, v: X * 5.5725, r: X * 0.5625, collarH: X * 0.35 },
        midC: { u: 0, v: X * 5.5725, r: X * 0.5625, collarH: X * 0.35 },
        midR: { u: X * 2.15, v: X * 5.5725, r: X * 0.5625, collarH: X * 0.35 },
        lowL: { u: -X * 1.075, v: X * 3.9425, r: X * 0.5625, collarH: X * 0.35 },
        lowR: { u: X * 1.075, v: X * 3.9425, r: X * 0.5625, collarH: X * 0.35 },
        bot: { u: 0, v: X * 2.3125, r: X * 0.5625, collarH: X * 0.35 },
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

    specWaivers: {
      'ball.ratio': 'Matt asked for the real Popongo feel, 2026-08-22: a ping pong ball into '
        + 'solo cups (mouth ~2.4x the ball). At the classic 0.35X ball the 3-across row caps '
        + 'the mouths at ~1.0X, so the BALL shrinks to 0.28X and the cups grow to 0.5625X '
        + '(mouth/ball ~2.0). Sweep re-run: every cup still scores, zero emergencies.',
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
