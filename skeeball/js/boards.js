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

// ============================================================================================
// MATT'S RULE, 2026-08-24, in his own words:
//
//   "NEVER CHANGE THE WIDTH OR DIAMETER OF A BASKET UNLESS I SPECIFICALLY TELL YOU TO."
//
// A basket's `r` (and so its mouth diameter) is HIS number on every machine. Not a default, not
// a starting point, not something to re-derive from a proportion or trade away to make a sweep
// come out nicer. If a change would move a mouth and he has not asked for that mouth to move,
// the change is wrong - find another way or go back and ask.
//
// This is the one rule about basket sizing. Depth, position, colour and paint are ordinary work;
// the WIDTH is not.
// ============================================================================================

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
    // LIVE AND UNLOCKABLE since 2026-08-25 (Matt: "leave as is and go live"). No `adminOnly`, so
    // the code default is no longer Testing: the family earns this machine the normal way, off
    // THE CLASSIC's three objectives, via the unlock above. The Admin page can still override it
    // either way - to Open for everyone, or back to Testing - with no commit and no deploy.
    //
    // ITS HISTORY CAME WITH IT, KNOWINGLY. The board id `basketball` is frozen and predates the
    // rename from BASKET FEVER, so every play ever thrown on this machine still counts: at
    // release, MattyIce held 28 plays / 9,480 points / best 710 and King of Games 18 / 5,120 /
    // 540, which is why Single game reads complete for one of them from the first load. Matt was
    // shown those numbers and chose to keep them rather than void them from the Admin page.
    // Only `slots` starts clean - it began recording 2026-08-24 - so "every basket" is 0/9 for
    // everyone.

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
      // THE SIGN IS A GRADIENT, and these two are Matt's exact values (2026-08-25, after two
      // wrong guesses from me - `face`, then the star risers' bright top). `marquee` is the top
      // of the sign, `marqueeBottom` its foot; render.js's _paintMarquee ramps between them.
      marquee: '#436496',
      marqueeBottom: '#334a75',
      marqueeText: '#ffd23f',
      bulb: '#ffd23f',
      glow: '#ff3b1f',
      // A DEEP NAVY, not the neutral near-black it was (#161016). The cabinet is blue and gold;
      // a grey-black wall behind it read as a different room. This sits under the board's own
      // blue family so the machine and its backdrop belong together.
      wall: '#12203a',
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
      // A VALUE RAMP, NOT A PALETTE (Matt, 2026-08-25: "it should be obvious what the best target
      // is without having to read anything. Just by glancing at the design"). Every hoop was the
      // same orange, so the face said nothing about where to aim.
      //
      // IT RAMPS BY LIGHTNESS, NOT BY HUE, and that is the whole design. Matt is red/green
      // colorblind (root CLAUDE.md), and dull-orange -> bright-gold is exactly the axis that
      // collapses for him if hue is doing the work. So the 10 is the darkest thing on the face
      // and the 100 is the brightest, and the ordering survives with no colour vision at all.
      // The value card above each basket carries the number, which is the shape-not-hue marker
      // the accessibility rule asks for. The 100 lands on the machine's own gold - the same
      // colour as the marquee bulbs and its lettering - so the best target reads as the prize.
      //
      // `ink` is the number printed on the collar wall (render.js _cupPlate) and flips to dark
      // on the three bright rims, where white would wash out.
      h10a: { value: 10, color: '#7d3b22', ink: '#ffffff', label: '10' },
      h10b: { value: 10, color: '#7d3b22', ink: '#ffffff', label: '10' },
      h20: { value: 20, color: '#a8451f', ink: '#ffffff', label: '20' },
      h30a: { value: 30, color: '#e8541f', ink: '#ffffff', label: '30' },
      h30b: { value: 30, color: '#e8541f', ink: '#ffffff', label: '30' },
      h50a: { value: 50, color: '#ff8a1f', ink: '#241610', label: '50' },
      h50b: { value: 50, color: '#ff8a1f', ink: '#241610', label: '50' },
      h60: { value: 60, color: '#ffb020', ink: '#241610', label: '60' },
      h100: { value: 100, color: '#ffd23f', ink: '#241610', label: '100' },
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
      // DEPTHS ARE MATT'S NUMBERS, ROW BY ROW (2026-08-24, after seeing this machine beside BRICK
      // CITY): bottom 4.00in, middle 3.88in, top 3.50in - BRICK CITY's own depths, which is
      // exactly what he asked for: "the baskets in brickcity are taller than regular hot shot -
      // make the same adjustment to hot shot". They were 2.83in / 2.83in / 2.33in before that,
      // and 1.40in before those.
      //
      // THEY ARE NOT DERIVED FROM ANYTHING - not from the mouth, not from each other, not from a
      // ratio. A "a basket is as deep as its mouth is wide" line was written into this file by a
      // session Matt never asked it from, and he threw it out: "You wrote that rule. You invented
      // that rule. I did not tell you to, nor will I respect it." If a depth needs to change, it
      // is his call to make.
      //
      // WHY DEPTH IS NEARLY FREE, so a future session does not "fix" the collar back down: a
      // taller rim cuts both ways in physics.js. It rejects more approaches on the outer wall,
      // but capture is "centre below the RIM plane inside the mouth", and a rim standing high
      // trips that condition far earlier in the descent. The two effects very nearly cancel.
      // Measured back when every mouth was 1.0X: 0.35X depth scored 167/861 and 1.0X scored
      // 146/861, both with all nine mouths capturable and 0 emergencies and the slowest settle a
      // shade faster at the deeper one; 0.55X and 0.75X came in at 48 and 45 per 231. The curve
      // is flat, so depth is a LOOK decision, not a scoring one.
      // MEASURED ON THE DEPTH CHANGE ABOVE, 41x21 = 861 throws, basketball's engine only:
      // all nine mouths still clean-capturable, ZERO watchdog walkouts either way, scoring
      // rate 158/861 -> 131/861 and the slowest settle 6.00s -> 6.86s (the cap is 12s). The
      // top row's share of the points fell 34.6% -> 28.1% and the middle row's rose 48.2% ->
      // 52.7%, so the deep baskets cost the high shots a little - which is the same trade the
      // 0.35X -> 1.0X pass measured, and it is a look decision, not a scoring one. THE CLASSIC,
      // POPONGO and BRICK CITY came back byte-identical on the same grid (boards.js is shared).
      // RIM DIAMETERS ARE MATT'S SPEC, IN DIAMETER, verbatim (2026-08-24, second pass): the six
      // baskets on the bottom and middle rows are 4.25in, the two top-row 50s are 4in, and the
      // top-row 100 is 3.5in - against the X (4in) hole and the 0.75X (3in) ball. `r` in the
      // table below is a RADIUS, so it is always HALF the diameter Matt states: 4.25in -> X *
      // 0.53125, 4in -> X * 0.5, 3.5in -> X * 0.4375.
      //
      // WHY THEY CAME DOWN FROM 6in (Matt, on the shipped 6in build: "They're massive now. The
      // ball can't fit between them at all"). The columns are 2.07X apart, so neighbouring rims
      // are 8.28in centre to centre, and the collar wall adds 0.33in to each outer diameter. At
      // 6in that leaves a 1.95in gap against a 3in ball - the ball physically cannot pass
      // between two columns, so it can only sit on the rims or drop in one. At 4.25in the gap is
      // 3.70in, so the ball travels the face again. ANY future rim change must re-check that
      // number: gap = 8.28in - (rim diameter + 0.33in), and it has to stay above 3in.
      //
      // DEPTH (collarH) IS PER ROW, NOT PER BASKET, and that is Matt's rule: "all the hoops on a
      // row should be the same height, regardless of the diameter of the basket". So the top row
      // runs one depth across its 4in and 3.5in baskets, and 3.50in is the number he picked.
      //
      // holeR is the board's nominal hole radius and no longer matches any rim here, which is
      // what the holes.uniform waiver below is for.
      holeR: X * 0.75,
      holes: {
        lowL: { u: -X * 2.07, v: X * 1.3125, r: X * 0.53125, collarH: X * 1.0 },
        lowC: { u: 0, v: X * 1.3125, r: X * 0.53125, collarH: X * 1.0 },
        lowR: { u: X * 2.07, v: X * 1.3125, r: X * 0.53125, collarH: X * 1.0 },
        midL: { u: -X * 2.07, v: X * 5.3, r: X * 0.53125, collarH: X * 0.97 },
        midC: { u: 0, v: X * 5.3, r: X * 0.53125, collarH: X * 0.97 },
        midR: { u: X * 2.07, v: X * 5.3, r: X * 0.53125, collarH: X * 0.97 },
        topL: { u: -X * 2.07, v: X * 9.2875, r: X * 0.5, collarH: X * 0.875 },
        // THE 100 IS THE SMALL RIM: 3.5in across vs the top row's 4in 50s - Matt's spec. Still
        // 1.17x the 3in ball, so it fits; it is just the tight, hard target. Its depth is the
        // ROW's depth, not its own, so the three top hoops stand at one height.
        topC: { u: 0, v: X * 9.2875, r: X * 0.4375, collarH: X * 0.875 },
        topR: { u: X * 2.07, v: X * 9.2875, r: X * 0.5, collarH: X * 0.875 },
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
      'holes.uniform': 'Matt\'s spec, 2026-08-24 (second pass), stated in DIAMETER: the bottom '
        + 'and middle rows are 4.25in, the top-row 50s are 4in, and the top-row 100 is 3.5in. '
        + 'Mouth size is the difficulty marker on this face, so a uniform holeR cannot express '
        + 'it. Every rim still clears the 3in ball, and the gap between neighbouring rims is '
        + 'back above 3in so the ball can travel the face - the 6in build it replaced left only '
        + '1.95in and the ball could not pass between the columns at all.',
      'ball.ratio': 'The ball is THE CLASSIC\'s (0.375X = 0.75X diameter, Matt 2026-08-24: the '
        + 'small ball read too small), against rims of 4.25in, 4in and 3.5in. Sweep re-run: all '
        + 'nine hoops clean-capturable, emergencies within budget.',
      'board.dims': 'Matt ordered the stepped rebuild, 2026-08-22: "change the board from a '
        + 'single board with a back wall to... 3 stairs", even if new physics had to be built. '
        + 'boardLen is the UNROLLED length of three treads plus three risers (11.1375X), which '
        + 'necessarily exceeds the flat-board 10.5X ceiling. Sweep re-run on the staircase.',
    },
  },

  {
    id: 'brickcity',
    // FROZEN FROM FIRST PLAY (THE LAW rule 5). The marquee says HOT SHOT: BRICK CITY; the id is
    // `brickcity` and stays `brickcity` however the sign is repainted later.
    name: 'HOT SHOT: BRICK CITY',
    taglineKey: 'board_brickcity_tag',
    // Same render dressing as HOT SHOT (hoops, nets, backboards, a basketball for a ball) - this
    // is that cabinet's sibling, wearing a brick sign and a different face. render.js branches on
    // this string; physics never reads it.
    dressing: 'basketball',
    // Complete HOT SHOT's three objectives (js/goals.js). Matt confirmed the chain 2026-08-24:
    // THE CLASSIC -> HOT SHOT -> BRICK CITY -> POPONGO, so POPONGO's own unlock was re-pointed at
    // this machine. unlocksEarned() ignores a goals unlock (no `score` field); ui.js applies it.
    //
    // THE LAW rule 2: moving POPONGO further down the chain takes NOTHING away from anyone who
    // already has it. Unlocks are an additive set in js/arcade-scores.js, union-merged across
    // devices - unlockSkeeballBoard() only ever adds an id, and nothing anywhere removes one. A
    // player holding sk.unlocked.popongo keeps it whatever the chain says today. Replayed against
    // a real store before this shipped; the numbers are in skeeball/MACHINE-BRICKCITY.md.
    unlock: { board: 'basketball', goals: true },
    // ADMIN ONLY at ship (Matt, 2026-08-24, same as its two neighbours while he plays it): ui.js
    // never unlocks it by play and shows it locked to non-dev profiles; the dev bypass still opens
    // it. NOTHING is deleted by this flag. It comes off from the in-app Admin page (js/admin-ui.js)
    // with no commit and no deploy - `adminOnly` is only the code DEFAULT now.
    adminOnly: true,

    // THE BRICK SIGN, from the design Matt handed over (skeeball/MACHINE-BRICKCITY.md carries the
    // hexes and what each one paints). The face keeps HOT SHOT's court blue on purpose so the two
    // cabinets read as siblings; everything else is the brick-and-chalk palette.
    look: {
      // Carried from HOT SHOT unchanged - the cabinet, lane and side walls are that machine's.
      wood: '#5b5b66',
      woodDark: '#191a1e',
      cabinet: '#f2c526',
      ring: '#e8541f',
      ringLip: '#ffd23f',
      faceEdge: '#143564',
      wall: '#161016',
      // HOT SHOT's court blue, kept so the two read as siblings.
      face: '#1e63b8',
      // The brick sign.
      marquee: '#a33427',      // the brick panel
      marqueeText: '#ffc53d',  // HOT SHOT lettering
      bulb: '#ffc53d',
      glow: '#ff6b2c',         // the ember halo behind the letters, and the ball
      net: '#ede6da',          // the nets, and the BRICK CITY plate
      value: '#ede6da',        // printed values
      cabinetEdge: '#14161b',
      pocket: '#14161b',
    },

    // THE ARRANGEMENT LAYER, HOT SHOT's pattern: on a collar board the cup is what carries a
    // printed value onto the collar wall (render.js _cupPlate), so the nine baskets are "cups"
    // even though nothing here is movable. The arrangement is FIXED. THE LAW rule 5: a cup's
    // value is frozen to its id forever - `p100a` is 100 for as long as this machine exists.
    //
    // THE PENALTY ROW is what makes this machine different from HOT SHOT: the three baskets
    // nearest the player TAKE points. They are the easiest things on the face to hit, and the
    // whole shot selection follows from wanting to clear them. See game.js's `_settle` for the
    // floor - a rack can be eaten back down to 0 but never below it.
    cups: {
      p100a: { value: 100, color: '#e8541f', ink: '#ede6da', label: '100' },
      p100b: { value: 100, color: '#e8541f', ink: '#ede6da', label: '100' },
      p50: { value: 50, color: '#e8541f', ink: '#ede6da', label: '50' },
      p40a: { value: 40, color: '#e8541f', ink: '#ede6da', label: '40' },
      p40b: { value: 40, color: '#e8541f', ink: '#ede6da', label: '40' },
      p20: { value: 20, color: '#e8541f', ink: '#ede6da', label: '20' },
      // The penalty row. One colour for the whole face is deliberate (see colorSweep's guard in
      // game.js) - these read as penalties from the printed number and the asphalt collar, not
      // from a hue, which is the repo's colorblind-safe rule.
      m20a: { value: -20, color: '#14161b', ink: '#ede6da', label: '-20' },
      m20b: { value: -20, color: '#14161b', ink: '#ede6da', label: '-20' },
      m10: { value: -10, color: '#14161b', ink: '#ede6da', label: '-10' },
    },
    arrangement: {
      lowL: 'm20a', lowC: 'm10', lowR: 'm20b',
      midL: 'p40a', midC: 'p20', midR: 'p40b',
      topL: 'p100a', topC: 'p50', topR: 'p100b',
    },

    // Part 1 of MACHINE-SPEC.md, copied from HOT SHOT verbatim - the ball, the lane, the hump,
    // the 70-degree launch, the three-tier staircase, the board dimensions, the back wall, the
    // speeds, the aim and the whole `mat` block. THE FACE IS THE ONLY THING THAT CHANGES on this
    // machine, and inside the face only `holes` moves: column positions, row heights and the
    // 0.75X set-back from each tread's rear edge are HOT SHOT's too.
    geom: {
      // THE BALL is HOT SHOT's, which is THE CLASSIC's: ballR X*0.375, so 0.75X = 3.00 in across.
      // Every mouth on this face is measured against that 3.00 in ball and nothing else.
      ballR: X * 0.375,
      ballMass: 0.18,
      laneLen: 1.40,
      laneW: X * 4.875,
      bedThick: 0.06,
      humpLen: 0.42,
      // HOT SHOT's 70-degree launch, unchanged: the throw reads as SHOOTING, so the ball drops
      // into a basket from above instead of skimming up the face. That is what makes a mouth
      // barely wider than the ball reachable at all on this machine.
      humpAngles: [0.2036, 0.4072, 0.6109, 0.8145, 1.0181, 1.2217],
      troughLen: 0.225,
      troughDepth: 0.15,
      boardLipY: 0.42,
      // Nominal only: `steps` replaces the single tilted face, exactly as on HOT SHOT.
      boardTilt: 0.8726,
      boardW: 1.00,
      // HOT SHOT's staircase, unchanged: three near-flat TREADS (X*2.0625 = 8.25 in = 0.30 m,
      // leaning 0.10 rad toward the player) alternating with three VERTICAL RISERS (X*1.925 =
      // 7.7 in = 0.28 m), the back wall above the third. Face coordinates unroll along it.
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
      backboardH: 0.85,
      cupSegments: 14,
      collarThick: 0.012,
      ringH: X,
      ringThick: RING_T,
      lipLowFrac: 0.50,
      captureDrop: 0.35,

      // THE FACE. Three baskets per tread, at HOT SHOT's positions exactly: columns u = -2.07X /
      // 0 / +2.07X (-8.28 in / 0 / +8.28 in), rows v = 1.3125X / 5.3X / 9.2875X unrolled, each
      // basket 0.75X (3 in) back from its tread's rear edge, against the riser. What changes is
      // the SIZE of each mouth and what it pays, and the two vary together: the deeper into the
      // machine a basket sits, the smaller its mouth and the more it pays.
      //
      // `r` is the MOUTH RADIUS, so a mouth is 2r across; `collarH` is its depth. The depths
      // below are just the depths Matt wanted, not a proportion anything is derived from.
      // The outer diameter of a collar is the mouth plus two collarThick (0.012 m = 0.0825X =
      // 0.33 in), which is what the gap arithmetic below is measured on.
      //
      //   row 3, v 9.2875X   100 | 50 | 100   mouths 0.8X (3.20 in) and 0.875X (3.50 in)
      //   row 2, v 5.3X       40 | 20 |  40   mouths 0.97X (3.88 in)
      //   row 1, v 1.3125X   -20 |-10 | -20   mouths 1.5X (6.00 in)
      //
      // ROW 3 IS THE SKILL ROW. The 100s are 0.8X = 3.20 in against a 3.00 in ball - 0.10 in of
      // clearance on each side. That is the tightest opening in the game by a wide margin and it
      // is meant to be: it is the one shot on the machine that has to be aimed rather than
      // ranged. It is also the FLOOR for a real opening - anything narrower than the ball is a
      // painted dot, not a basket, and cannot be scored at all. The 50 between them is 0.875X =
      // 3.50 in, still tight, as the consolation for a 100 attempt that drifts to the middle.
      //
      // THE LADDER RUNS BIG-TO-SMALL FROM THE PLAYER OUTWARD, AND THAT IS THE WHOLE POINT.
      // Matt, 2026-08-24, on the first build: "The ball can't roll down to the bottom row because
      // you made the middle row so large... The baskets in the bottom row should be the size of
      // what you put in the middle row. And vice versa." He is right, and the first build had it
      // exactly backwards - a 6.00 in middle row is a wall, and nothing that clears the top rows
      // can get down past it to the penalty row it is supposed to threaten.
      //
      //   row 1  1.5X   (6.00 in)  the penalty row - the biggest mouths on the face, nearest the
      //                            player, and the easiest things to fall into. That is what
      //                            makes -20 a real risk rather than a decoration.
      //   row 2  0.97X  (3.88 in)  the 40s and the 20 - a genuine shot, and OPEN: a ball that
      //                            misses one can pass by it and carry on down the face.
      //   row 3  0.8X / 0.875X     the skill row.
      //
      // THE GAPS, which are what decide whether a miss can travel (this file's spacing rule: a
      // gap is either MERGED or wider than a ball plus margin, and an IN-BETWEEN gap is a pocket
      // that jams the solver):
      //
      //   row 1 at 1.665X (6.66 in) outer   rail 2.14 in, between baskets 1.62 in - both MERGED,
      //                                     far under the 3.00 in ball, so it cannot enter either
      //                                     and cannot wedge. A ball reaching this row lands in a
      //                                     basket or is stopped by one; the clear tread strip in
      //                                     front of the row, the risers and the trough are the
      //                                     routes to a plain 0.
      //   row 2 at 1.135X (4.54 in) outer   rail 3.20 in, between baskets 3.74 in - both CLEAR
      //                                     the ball, so a miss here really does carry on down.
      //
      // The 1.085X (4.34 in) row 1 this machine was first drawn with is the one size that must
      // not come back: at 1.25X outer it leaves a 2.97 in rail channel against a 3.00 in ball -
      // the in-between case - and the full 41x21 grid measured 111 of 861 throws (12.89%) walked
      // out by the watchdog, 83 of them wedged in exactly that channel. Depth was never the
      // cause; a 2/3-depth variant still measured 8.66%.
      //
      // DO NOT RESIZE EITHER ROW without redoing all four of those gap numbers and re-running
      // the sweep. There is not much room - it is three collars and four gaps across 27.5 in, and
      // the sizes that work are the ones that are either comfortably bigger than the ball or
      // comfortably too small for it.
      holeR: X * 0.75,
      holes: {
        // The penalty row, and the BIGGEST mouths on the face: 1.5X (6.00 in), outer 1.665X
        // (6.66 in), depth 1.0X. Nearest the player and the easiest thing to fall into.
        lowL: { u: -X * 2.07, v: X * 1.3125, r: X * 0.75, collarH: X * 1.0 },
        lowC: { u: 0, v: X * 1.3125, r: X * 0.75, collarH: X * 1.0 },
        lowR: { u: X * 2.07, v: X * 1.3125, r: X * 0.75, collarH: X * 1.0 },
        // The 40s and the 20: 0.97X (3.88 in), outer 1.135X (4.54 in), depth 0.97X. Both of this
        // row's gaps clear the ball, so a miss here travels on down instead of being walled.
        midL: { u: -X * 2.07, v: X * 5.3, r: X * 0.485, collarH: X * 0.97 },
        midC: { u: 0, v: X * 5.3, r: X * 0.485, collarH: X * 0.97 },
        midR: { u: X * 2.07, v: X * 5.3, r: X * 0.485, collarH: X * 0.97 },
        // The skill row: the 100s at mouth 0.8X (3.20 in), outer 0.965X (3.86 in), depth 0.8X;
        // the 50 at mouth 0.875X (3.50 in), outer 1.04X (4.16 in), depth 0.875X.
        //
        // PUSHED BACK AGAINST THE RISER, 2026-08-25, MATT'S NUMBER: every rim on this row sits
        // 0.73 in from the wall it is bolted to - the same clearance the 40s on the row below
        // already had. It was 1.07 in on the 100s and 0.92 in on the 50. The top tread's back
        // edge is at v 40.15 in, so each basket's v is (40.15 - its outer radius - 0.73) and the
        // three are NOT on one v: matching the GAP with three different mouths puts the wider 50
        // 0.15 in forward of the 100s. That is what "0.73 in" means here; it is a gap, not a line.
        // Recompute both numbers if a mouth or the tread ever moves.
        topL: { u: -X * 2.07, v: X * 9.3725, r: X * 0.4, collarH: X * 0.8 },
        topC: { u: 0, v: X * 9.335, r: X * 0.4375, collarH: X * 0.875 },
        topR: { u: X * 2.07, v: X * 9.3725, r: X * 0.4, collarH: X * 0.8 },
      },

      minSpeed: 2.60,
      maxSpeed: 6.60,
      aimMax: 0.45,

      // HOT SHOT's materials, verbatim and for its reasons: slick treads so a miss rolls off the
      // front edge, a near-frictionless back wall (a fast ball sliding down a GRIPPING wall gets
      // flicked upward by the friction impulse), deadened side-wall tops, and the classic's
      // rebound on the backboard so a hard throw comes back at the player.
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
        deadRest: 0.32,
        backFric: 0,
        backRest: 0.60,
      },
    },

    specWaivers: {
      'ball.ratio': 'The ball is HOT SHOT\'s, which is THE CLASSIC\'s measured ball: ballR '
        + '0.375X, so 0.75X (3.00 in) across against the spec sheet\'s 0.350X. This machine is '
        + 'HOT SHOT\'s sibling and shares its cabinet, ramp and ball; only the face differs. The '
        + 'spec sheet\'s ratio predates Matt\'s tape-measure pass, 2026-08-23.',
      'board.dims': 'HOT SHOT\'s staircase, carried over unchanged (Matt ordered it 2026-08-22, '
        + '"3 stairs" instead of one tilted face). boardLen is the UNROLLED length of three '
        + 'treads plus three risers (11.9625X), which necessarily exceeds the flat-board 10.5X '
        + 'ceiling, and boardTilt is nominal because `steps` replaces the single face.',
      'holes.uniform': 'Matt\'s layout for this machine, 2026-08-24: mouth size IS the difficulty '
        + 'ladder here, and it runs BIG TO SMALL from the player outward - 1.5X penalty mouths '
        + 'nearest him (the easiest thing on the face to fall into, which is what makes -20 a '
        + 'real risk), 0.97X for the 40s and the 20, and 0.8X / 0.875X skill mouths at the top. '
        + 'A uniform face cannot express that ladder, and a face that is widest in the MIDDLE is '
        + 'a wall - his words, on the build that had it backwards.',
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
    // Re-pointed at BRICK CITY 2026-08-24 when machine 3 landed between them: the chain now
    // reads THE CLASSIC -> HOT SHOT -> BRICK CITY -> POPONGO. THE LAW rule 2 - this takes
    // NOTHING from anyone who has already earned POPONGO. sk.unlocked is an additive set
    // (js/arcade-scores.js union-merges it across devices) and nothing anywhere removes an
    // id from it, so an earned machine stays earned however the chain is rearranged later.
    unlock: { board: 'brickcity', goals: true },
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
    //   `arrangement`  which cup sits in which slot. One arrangement ships; player rearrangement
    //                  is deferred, and when it comes it is a game-level remap over these same
    //                  slots - never a geometry change, because every cup is the same shape.
    //                  IT SHIPPED as the product photo's staging (playpopongo.png) and was
    //                  RE-DEALT 2026-08-27 by measured slot difficulty - see the block above
    //                  `arrangement` below, and DECISIONS.md#popongo-rearrangement-and-the-70-degree-ramp-2026-08-27.
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
    // RE-DEALT BY MEASURED DIFFICULTY, 2026-08-27. Matt, after playing it: *"It's not super easy,
    // but it's easiest to get the 6 which is an issue."* He is right, and the grid says so. A
    // 56 x 41 sweep (power 0..1.10 x aim -1..1, the real engine) asked the only question that
    // matters for shot selection: on a STRAIGHT throw (|aim| <= 0.10), how wide an unbroken power
    // band does each slot own? That is what "repeatable" means to a thumb.
    //
    //   top   5 steps (.66-.74), AND it keeps catching at .80 .86 .94 .98 1.08
    //   midC  5 steps (.42-.50)
    //   bot   5 steps (.18-.26)
    //   lowL / lowR  2 steps        uppL / uppR  1 step        midL / midR  ZERO
    //
    // So exactly three shots on this machine repeat, `top` owns the widest band AND the most
    // natural swipe speed AND scores again all over the top of the dial - and it was carrying the
    // 6. The old deal also put both equalizers where no straight throw ever finds them, so the
    // risk half of the machine never fired at all.
    //
    // THE NEW DEAL RUNS THE VALUES DOWN THE MEASURED LADDER, hardest slot paid most:
    //   midL   the 6      the one slot no straight throw has ever reached; aim is the only way in
    //   midR   equalizer  the 6's mirror at the same reach - drift the wrong way and you lose
    //                     what your last ball earned. This is the risk/reward the black cups
    //                     were built for.
    //   uppL / uppR  the 4s   1-step flickers, a genuine shot
    //   lowL / lowR  the 2s   2-step bands
    //   midC / bot   the 1s   the two easy repeatable shots pay the least
    //   top    equalizer  BRICK CITY's logic (root CLAUDE.md: the easiest thing on the face is
    //                     what takes points), and it is the gentlest possible version of it -
    //                     an equalizer wipes the PREVIOUS ball's earnings, and 78% of straight
    //                     throws score nothing, so it costs a missing player nothing at all and
    //                     only bites the one pattern this change exists to kill.
    //
    // THE LAW rule 5 is untouched: no cup id moved value, no slot id changed, and a mid-rack
    // autosave stores each throw's own `value`, so a rack banked under the old deal restores
    // with the numbers it was actually scored with (`game.js` restore reads `t.value`).
    arrangement: {
      top: 'eqA',
      uppL: 'y4a', uppR: 'y4b',
      midL: 'g6', midC: 'b1a', midR: 'eqB',
      lowL: 'r2a', lowR: 'r2b',
      bot: 'b1b',
    },

    // Part 1 of MACHINE-SPEC.md, copied from THE CLASSIC (same cabinet, same lane) EXCEPT the
    // ball, under the waiver below, and THE RAMP, which is HOT SHOT's 70 degrees since
    // 2026-08-27 (see `humpAngles`). troughTenHalfW and ringSegments are deliberately absent:
    // both are classic-only vestiges (see the spec, sections 6 and 12).
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
      // HOT SHOT's 70-degree ramp, adopted 2026-08-27. This machine shipped on THE CLASSIC's 64
      // degrees because it was built the same day HOT SHOT worked out that CUPS NEED A DROP-IN,
      // and the lesson landed one machine over. It was the only cup board still on 64: the ball
      // met a 45-degree face at 19 degrees and SKIMMED it, where HOT SHOT's arrives at ~64 to a
      // near-flat tread and drops in. Measured on the 56 x 41 grid, 64 -> 70 degrees:
      //
      //   watchdog walkouts at the 12s emergency cap   9 of 2296  ->  ZERO
      //   slowest settle                               12.00s     ->  4.88s
      //
      // That cap is what skeeball/js/test.js asserts is unreachable, and this machine was
      // hitting it about once every three racks - twelve seconds of a ball doing nothing.
      // It also turns the straight-throw ladder into a clean staircase (bot .24-.32, lowL/lowR
      // .38-.42, midC .48-.58, uppL/uppR .64-.66, top .74-.84) where the 64-degree version had
      // `top` scoring both above and below `midC`.
      //
      // WHAT IT DOES NOT FIX, so nobody re-runs this hoping: the hit rate. 8.9% -> 9.1% of all
      // throws score, and 84% still roll back to the trough. That is this machine's real open
      // problem and it is written up in DECISIONS.md#popongo-rearrangement-and-the-70-degree-ramp-2026-08-27.
      humpAngles: [0.2036, 0.4072, 0.6109, 0.8145, 1.0181, 1.2217],
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

  {
    // FROZEN FROM FIRST PLAY (THE LAW rule 5). The marquee says HOT SHOT: RUNAWAY; the id is
    // `runaway` and stays `runaway` however the sign is repainted later.
    id: 'runaway',
    name: 'HOT SHOT: RUNAWAY',
    taglineKey: 'board_runaway_tag',
    // HOT SHOT's render dressing - hoops, nets, backboards, a basketball for a ball. This is that
    // cabinet's third sibling. render.js branches on this string; physics never reads it.
    dressing: 'basketball',
    // Complete POPONGO's three objectives (js/goals.js). The chain is
    // THE CLASSIC -> HOT SHOT -> BRICK CITY -> POPONGO -> RUNAWAY, so this machine goes on the
    // end and takes nothing away from anyone: unlocks are an additive set in js/arcade-scores.js
    // and nothing anywhere removes one (THE LAW rule 2).
    unlock: { board: 'popongo', goals: true },
    // ADMIN ONLY at ship, same as its three siblings while Matt plays it. ui.js never unlocks it
    // by play and shows it locked to non-dev profiles; the dev bypass still opens it. NOTHING is
    // deleted by this flag, and it comes off from the in-app Admin page (js/admin-ui.js) with no
    // commit and no deploy - `adminOnly` is only the code DEFAULT now.
    adminOnly: true,

    // HOT SHOT's cabinet and court blue, kept so the family reads as a family. What changes is
    // the sign and the light: a cyan-on-indigo marquee and a cyan glow, for the one machine on
    // the floor with something moving on it.
    look: {
      wood: '#5b5b66',
      woodDark: '#191a1e',
      cabinet: '#f2c526',
      cabinetEdge: '#1a1a1a',
      face: '#2560bd',
      faceEdge: '#143564',
      ring: '#e8541f',
      ringLip: '#39e0d0',      // also paints the two end stops on the mover's track (render.js)
      value: '#ffffff',
      pocket: '#0a1418',       // the mouth interior, and the track groove
      marquee: '#241a4d',
      marqueeText: '#39e0d0',
      bulb: '#39e0d0',
      glow: '#39e0d0',
      wall: '#141018',
      net: '#f2f2f2',
    },

    // THE ARRANGEMENT LAYER, HOT SHOT's pattern: on a collar board the cup is what carries a
    // printed value onto the basket (render.js _hoopBackboard), so these are "cups" even though
    // nothing here is rearrangeable. THE LAW rule 5: a cup's value is frozen to its id forever.
    //
    // SEVEN baskets, not nine - the top row is ONE. Rows 1 and 2 are HOT SHOT's exactly, values
    // included; the whole difference between the two machines is what is standing on row 3.
    cups: {
      r10a: { value: 10, color: '#e8541f', ink: '#ffffff', label: '10' },
      r10b: { value: 10, color: '#e8541f', ink: '#ffffff', label: '10' },
      r20: { value: 20, color: '#e8541f', ink: '#ffffff', label: '20' },
      r30a: { value: 30, color: '#e8541f', ink: '#ffffff', label: '30' },
      r30b: { value: 30, color: '#e8541f', ink: '#ffffff', label: '30' },
      r60: { value: 60, color: '#e8541f', ink: '#ffffff', label: '60' },
      // THE TWIN 100s. Both start standing still, at HOT SHOT's proven topL/topR marks. Hit one
      // and it DOMES OVER; the survivor comes off its mark and sweeps the whole width for the
      // rest of the rack, faster every time you catch it.
      //
      // One colour for the whole face is deliberate and is also the colourblind-safe answer here:
      // the runaway is told apart by MOVING, which is the strongest non-colour indicator there
      // is, and a capped basket by being a smooth dome where a cup used to be - never by a hue.
      //
      // THE LAW rule 5: two cup ids where there was one. `r100` is NOT reused for either of them.
      // It was the single moving 100's id and it is retired rather than repointed, because a cup
      // id is frozen to its value forever and the thing it named no longer exists.
      r100a: { value: 100, color: '#e8541f', ink: '#ffffff', label: '100' },
      r100b: { value: 100, color: '#e8541f', ink: '#ffffff', label: '100' },
    },
    arrangement: {
      lowL: 'r10a', lowC: 'r20', lowR: 'r10b',
      midL: 'r30a', midC: 'r60', midR: 'r30b',
      topL: 'r100a', topR: 'r100b',
    },

    geom: {
      // Part 1 of MACHINE-SPEC.md, carried from HOT SHOT verbatim: the ball, the lane, the hump,
      // the 70-degree launch, the three-tier staircase, the board dimensions, the back wall, the
      // speeds, the aim and the whole `mat` block.
      ballR: X * 0.375,
      ballMass: 0.18,
      laneLen: 1.40,
      laneW: X * 4.875,
      bedThick: 0.06,
      humpLen: 0.42,
      humpAngles: [0.2036, 0.4072, 0.6109, 0.8145, 1.0181, 1.2217],
      troughLen: 0.225,
      troughDepth: 0.15,
      boardLipY: 0.42,
      boardTilt: 0.8726,       // nominal: `steps` replaces the single tilted face
      boardW: 1.00,
      steps: [
        { len: X * 2.0625, tilt: 0.10 },       // tread 1
        { len: X * 1.925, tilt: Math.PI / 2 }, // riser 1
        { len: X * 2.0625, tilt: 0.10 },       // tread 2
        { len: X * 1.925, tilt: Math.PI / 2 }, // riser 2
        { len: X * 2.0625, tilt: 0.10 },       // tread 3
        { len: X * 1.925, tilt: Math.PI / 2 }, // riser 3 (the back wall rises behind it)
      ],
      boardLen: X * 11.9625,
      railH: 0.10,
      laneRailH: 0.05,
      backboardH: 0.85,
      cupSegments: 14,
      collarThick: 0.012,
      ringH: X,
      ringThick: RING_T,
      lipLowFrac: 0.50,
      captureDrop: 0.35,

      // ============================================================================
      // THE TWIN 100s, THE RUNAWAY, AND THE ONE-SHOT FACE - the only reason this machine exists.
      // ============================================================================
      //
      // THE RACK IS A SEQUENCE, NOT A FIXED FACE. Three rules, all of them driven by js/game.js's
      // `closed` / `sweep` rack state and evaluated in machines/runaway/machine.js:
      //
      //   1. The top row starts as TWO STILL 100s, at topL / topR below.
      //   2. Cap one and the survivor becomes THE RUNAWAY: it comes off its mark and sweeps the
      //      full width for the rest of the rack.
      //   3. Every basket except the runaway is a ONE-SHOT. Land in it and it CLOSES - its collar
      //      is removed and the mouth is plated flush, so a later ball rolls straight over it.
      //      The runaway is the one thing on this face that never closes; catching it makes it
      //      FASTER instead (the ladder below).
      //
      // So a rack funnels: six easy baskets shut one by one, and what is left standing at the end
      // is a 100 moving faster than it was at the start. Nine balls against seven baskets, and
      // only one of them refills.
      //
      // THE HANDOFF IS FREE, AND THAT IS WHY THE TOP ROW SITS WHERE IT DOES. topL / topR are at
      // -/+2.07X, which is EXACTLY the amplitude below - so the survivor is already standing at a
      // turnaround of the travel it is about to run. machine.js anchors a COSINE there, which
      // starts it on its own mark with zero velocity: it eases away from a standstill instead of
      // teleporting to the centre of the sweep or taking a step change in wall velocity. Move
      // either mark and that stops being true - the survivor would jump.
      //
      // (-/+2.07X is also exactly where HOT SHOT's topL and topR sit, so both marks are positions
      // that machine already proves are cleanly capturable. The static half of this face needed
      // no reachability fight.)
      //
      // AMPLITUDE 2.07X is not a taste call. It is bounded by two rules, and BOTH have to be
      // re-derived if the amplitude, the mouth or the collar thickness ever change - THE MOUTH
      // IS AN INPUT TO THIS ARITHMETIC, which is exactly what the 4in change proved:
      //
      //   1. MACHINE-SPEC.md section 12's collar-near-a-wall rule. A curved collar converging on
      //      a flat rail makes a pinch that three-contact-locks the solver; the measured cost on
      //      POPONGO's first draft was 12% of ALL throws walked out by the watchdog. The rule is
      //      a wall gap wider than 0.78X. At the ends of this travel the gap is
      //      0.500 - 2.07X - (0.5X + 0.0825X) = 0.7850X (3.14 in against the 3.00 in ball).
      //      A MOVING COLLAR IS THE WORST POSSIBLE CASE FOR THAT RULE - a static one merely sits
      //      in a pinch, this one can drive a ball into it.
      //
      //      GUARD: THAT MARGIN IS 0.005X, essentially nothing. It was 0.0675X at the 3.5in mouth
      //      this machine shipped with; widening the 100 to 4in (Matt, 2026-08-25) spent almost
      //      all of it, because a wider mouth grows the collar's OUTER diameter against a rail
      //      that did not move. It was kept at 2.07X only because the sweep MEASURED zero
      //      watchdog walkouts at the new size - the rule is a threshold, the sweep is the
      //      evidence. ANY further widening of this mouth, or any increase in collarThick, goes
      //      under the rule and MUST be paid for by shrinking the amplitude:
      //          amp <= 0.500 - (r + collarThick) - 0.78X
      //      Do not simply raise the mouth and re-run; work out the amplitude first.
      //   2. holes.inside: |u| + holeR at the extreme is 2.07X + 0.75X = 2.82X, inside the
      //      3.4375X half-width. test-skeeball-machine-spec.mjs tests the ENVELOPE, not the
      //      resting u, precisely so this cannot be got wrong quietly. Unaffected by the mouth,
      //      because it is measured against the board's nominal holeR, not this basket's rim.
      //
      // GUARD: THE RUNAWAY SWEEPS STRAIGHT OVER THE 100 YOU CAPPED. The capped mark is one end of
      // the travel, so the surviving collar passes through it twice a period. That is why a
      // closed top-row basket is plated FLUSH and never raised - see machine.js's capFor().
      //
      // THE ESCALATION LADDER. `periods[n]` is the sweep's period after n catches of the runaway,
      // and the last rung holds for every catch after it. 6.0s is Matt's shipped number
      // (2026-08-25, "instead of 7s, make it 6s"); the rest of the ladder is MEASURED, not
      // guessed - see MACHINE-RUNAWAY.md's ladder table and sweep-mover.mjs.
      //
      // GUARD: A SHORTER PERIOD DOES NOT SIMPLY MEAN HARDER, AND THE INTUITION SAYS OTHERWISE.
      // Measured on the 7s -> 6s change: 70% MORE catching cells (46/2583 against 27/2583 on the
      // dense probe), because during the ball's ~0.45s flight a faster basket sweeps through MORE
      // positions, so a wider set of (power, aim) pairs coincide with it on arrival. It is a
      // bigger target in TIME while being the same target in space. What pushes back the other
      // way, further down the ladder, is the RELATIVE-VELOCITY capture rule: a fast rim means a
      // fast crossing speed, and a ball that cannot fall past the lip in the time it takes to
      // cross the mouth rattles out instead of dropping. The ladder is where those two effects
      // trade off, and only sweep-mover.mjs can say where. NEVER state which way a rung moved the
      // difficulty without measuring it; the first draft of this comment got it backwards from
      // the lead percentage alone.
      //
      // GUARD: THE PERIOD DOES NOT TOUCH THE RAIL-GAP ARITHMETIC ABOVE. Only the amplitude, the
      // mouth and collarThick feed that; a faster sweep covers the same ground in less time. It
      // DOES need a re-sweep (MACHINE-SPEC section 28), because a faster kinematic wall meets the
      // ball differently, and because reachability is a function of phase.
      mover: {
        // THE TOP ROW: two 100s, and whichever one you do NOT close first becomes the runaway.
        holes: ['topL', 'topR'],
        // EVERY ROW PLAYS "LAST ONE STANDING" (Matt, 2026-08-27: "when there's 1 basket left,
        // regardless of which one it is, it starts moving"). Close two of a row's three and the
        // survivor comes off its mark and sweeps the full width of that row. Up to THREE baskets
        // can be moving at once, and every one of them is a one-shot - catch it and the row is
        // empty. Only the top row's survivor refuses to close.
        //
        // GUARD: THE OUTER BASKETS OF THESE ROWS REST AT +/-2.07X, WHICH IS THE AMPLITUDE, so an
        // outer survivor gets the same free cosine handoff the top row does - on its own mark at
        // zero velocity. A CENTRE survivor cannot: no cosine starts from 0. machine.js gives it a
        // RAMPED sine instead, which is at its mark AND at zero speed at t0 and winds up to the
        // full travel over its first period. Both modes exist for that one reason.
        //
        // GUARD: THESE MOUTHS ARE WIDER THAN THE TOP ROW'S (0.53125X against 0.5X), so a moving
        // one runs closer to the rail. At +/-2.07X the wall gap is
        //     0.50 - 2.07X - (0.53125X + 0.0825X) = 0.7538X
        // which is UNDER the 0.78X collar-near-a-flat-wall rule (MACHINE-SPEC.md section 12) that
        // the top row clears at 0.7850X. Those baskets have always sat there and swept clean as
        // STATIC furniture; a MOVING collar is the worst case for that rule, because it can drive
        // a ball into the pinch rather than merely sitting in one. The rule is a threshold and the
        // SWEEP is the evidence - sweep-mover.mjs --stage rows measures the jam
        // rate at exactly this configuration, and it is the number to check before touching any
        // of these three: the mouths, collarThick, or the amplitude.
        rows: [['lowL', 'lowC', 'lowR'], ['midL', 'midC', 'midR']],
        amp: X * 2.07,
        // The top row's escalation ladder: periods[n] after n catches, last rung holds forever.
        periods: [6.0, 5.0, 4.2, 3.6, 3.1, 2.7],
        // A row survivor does not escalate - it is a one-shot, so it is only ever caught once.
        // Slower than the top row's first rung because these are the cheap baskets: the reward
        // for clearing a row down to one is a shot that is worth taking, not a punishment.
        rowPeriod: 5.0,
      },

      // How high a CLOSED basket's cap stands, in ball-radii. 0 = plated flush with the face,
      // which is the shipped setting and the safe one. machine.js's capFor() carries both reasons
      // it is not raised (the runaway drives over the top row's cap; a raised cap on rows 1 and 2
      // would deflect balls thrown PAST it at the 100, on a face that closes as the rack goes on).
      // Raise it and re-run test-runaway-capped.mjs, or leave it alone.
      capRise: 0,

      // THE FACE. Rows 1 and 2 are HOT SHOT's, unchanged down to the last digit: same columns
      // (u = -2.07X / 0 / +2.07X), same rows (v = 1.3125X / 5.3X unrolled), same 4.25in mouths,
      // same per-row depths. What is different is that on this machine they are ONE-SHOTS - each
      // closes for the rest of the rack the moment a ball goes in (see the mover block above).
      //
      // ROW 3 IS TWO 100s, AT -/+2.07X. They start still; cap one and the other runs. Their marks
      // are the amplitude exactly, which is what makes the handoff seamless - see the mover block.
      //
      // EACH 100 IS 4.00 in ACROSS (r = 0.5X), MATT'S NUMBER, 2026-08-25: "increase the diameter
      // of the 100 to 4"". The single moving 100 shipped at 3.50 in (0.4375X), HOT SHOT's 100
      // exactly, and 4in is this machine's own size now - HOT SHOT's and BRICK CITY's 100s were
      // deliberately NOT touched. Still the tightest opening here (rows 1 and 2 are 4.25in) and
      // 1.33x the 3.00 in ball. See the amplitude note above for what this cost at the ends of the
      // travel; the depth is unchanged at the top row's 0.875X, per Matt's rule that a row runs
      // one depth across whatever diameters are on it.
      //
      // A top-row hole's `u` here is its RESTING mark, not a fixed position: whichever one
      // survives the first catch sweeps away from it. Everything that reads a hole's u at
      // simulation time goes through machine.js's holeU(); everything that reads it as DATA (the
      // spec test, the tile generator) has to account for `mover` or it is measuring a basket that
      // only sits there until the first 100 drops.
      //
      // NO topC. Two static baskets 4.14X apart clear holes.spacing (1.30X) comfortably, and once
      // one closes the survivor has the whole shelf to itself - which is what makes the amplitude
      // legal. A THIRD basket up here would violate spacing against the sweep at nearly every step
      // of any travel worth having. The top row of this machine is two baskets by construction.
      holeR: X * 0.75,
      holes: {
        lowL: { u: -X * 2.07, v: X * 1.3125, r: X * 0.53125, collarH: X * 1.0 },
        lowC: { u: 0, v: X * 1.3125, r: X * 0.53125, collarH: X * 1.0 },
        lowR: { u: X * 2.07, v: X * 1.3125, r: X * 0.53125, collarH: X * 1.0 },
        midL: { u: -X * 2.07, v: X * 5.3, r: X * 0.53125, collarH: X * 0.97 },
        midC: { u: 0, v: X * 5.3, r: X * 0.53125, collarH: X * 0.97 },
        midR: { u: X * 2.07, v: X * 5.3, r: X * 0.53125, collarH: X * 0.97 },
        topL: { u: -X * 2.07, v: X * 9.2875, r: X * 0.5, collarH: X * 0.875 },
        topR: { u: X * 2.07, v: X * 9.2875, r: X * 0.5, collarH: X * 0.875 },
      },

      minSpeed: 2.60,
      maxSpeed: 6.60,
      aimMax: 0.45,

      // HOT SHOT's materials, verbatim and for its reasons: slick treads so a miss rolls off the
      // front edge, a near-frictionless back wall (a fast ball sliding down a GRIPPING wall gets
      // flicked upward by the friction impulse), deadened side-wall tops, and the classic's
      // rebound on the backboard so a hard throw comes back at the player.
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
        deadRest: 0.32,
        backFric: 0,
        backRest: 0.60,
      },
    },

    specWaivers: {
      'ball.ratio': 'The ball is HOT SHOT\'s, which is THE CLASSIC\'s measured ball: ballR '
        + '0.375X, so 0.75X (3.00 in) across against the spec sheet\'s 0.350X. This machine is '
        + 'HOT SHOT\'s sibling and shares its cabinet, ramp and ball; only the top row differs. '
        + 'The spec sheet\'s ratio predates Matt\'s tape-measure pass, 2026-08-23.',
      'board.dims': 'HOT SHOT\'s staircase, carried over unchanged (Matt ordered it 2026-08-22, '
        + '"3 stairs" instead of one tilted face). boardLen is the UNROLLED length of three '
        + 'treads plus three risers (11.9625X), which necessarily exceeds the flat-board 10.5X '
        + 'ceiling, and boardTilt is nominal because `steps` replaces the single face.',
      'holes.uniform': 'HOT SHOT\'s mouth ladder, carried over: the six baskets on rows 1 and 2 '
        + 'are 4.25in and the moving 100 on row 3 is 4in, which are Matt\'s numbers for those '
        + 'baskets on that cabinet (2026-08-24, second pass). A uniform holeR cannot express a '
        + 'face where mouth size IS the difficulty marker, and this machine changes what is on '
        + 'the top row, not how big any basket is.',
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
