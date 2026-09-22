// hoops4/js/boarddef.js - the CABINET, as data. Same shape as a skeeball `BOARDS` entry's
// `geom` block, because hoops4's engine is a copy of skeeball's brickcity engine and reads the
// same fields. This is NOT a skeeball machine: it is not in skeeball's BOARDS, it has no unlock,
// no rack of nine and no objectives. It only shares the physics.
//
// EVERY NUMBER BELOW THAT DIFFERS FROM HOT SHOT WAS MEASURED, NOT CHOSEN. Three tools produce
// them and all three must be re-run after touching anything in here:
//
//   reference/hoops/sweep-speed.mjs       the launch speed band, against THIS engine
//   hoops4/js/test.js                     Matt's four requirements, as numbers
//   reference/hoops/check-display.mjs     the machine as the PLAYER sees it, in a real browser
//
// reference/hoops/sweep-hoops-columns.mjs is the original FEASIBILITY sweep and is kept for the
// record only: it predates this folder and throws at a synthetic board through HOT SHOT's engine,
// so it cannot answer anything about the cabinet as built. The write-up is
// reference/hoops/FINDINGS.md.

const X = 1.00 / 6.875;            // the unit: one hole diameter, exactly as skeeball defines it

export const COLS = 7;             // 7 hoops, one per Connect 4 column
export const ROWS = 6;             // the grid is 7 x 6, the standard board
const PITCH = 1.30;                // X, MACHINE-SPEC.md holes.spacing minimum
const RIM = 0.5;                   // X, the spec's standard holeR. Never change without Matt.

// THE CABINET IS 52% WIDER THAN EVERY OTHER MACHINE, and every part of that is arithmetic.
//
// TWO rules set it, and the FIRST ONE ALONE IS NOT ENOUGH - which cost a measured round.
//
//   holes.spacing    6 gaps x 1.30X + a 0.5X margin each side  =  8.800X
//
// That is the number this started at, and at 8.800X the outer hoops' COLLARS STOOD 0.041X
// THROUGH THE SIDE RAILS. The spacing rule only constrains hole CENTRES; a collar is wider than
// a hole (0.541X radius) and a throat is wider still (0.916X). Measured consequence, on a
// 231-shot sweep: 4 captured balls escaped past the rail where their own throat was cut open by
// it and resolved as a 0 - every one of them at c1 or c7, which is what named the cause.
//
//   MACHINE-SPEC 12   |u| + collar radius + a ball-plus-margin wall gap (0.78X)
//                     3.900X + 0.541X + 0.78X, doubled           =  10.443X
//
// So 10.45X. THE HOLES DO NOT MOVE - the pitch is still 1.30X and the outer pair is still at
// +/-3.90X - only the rails go outward, which is why the aim mapping measured in
// reference/hoops/FINDINGS.md still stands.
//
// The 0.78X gap is not decoration: POPONGO's first draft put collars flush against the rails and
// 12% of ALL THROWS three-contact-locked in the crevice where a curved collar meets a flat wall.
const COLLAR_R = RIM + 0.0825 / 2;                      // collar radius, in X
const WALL_GAP = 0.78;                                  // MACHINE-SPEC 12, a ball plus margin
export const BOARD_W = Math.max(
  (COLS - 1) * PITCH + 2 * RIM,                         // holes.spacing:  8.800X
  2 * ((COLS - 1) / 2 * PITCH + COLLAR_R + WALL_GAP),   // collar vs rail: 10.443X  <- this wins
);

// THE CABINET IS ONE STEP, NOT A STAIRCASE, and the screen is BELOW the hoops.
//
// The first build reused HOT SHOT's three-tread staircase verbatim because that was the geometry
// already measured, and hung the Connect 4 screen on the back wall above it. Matt, seeing it:
// "WHY did you put the connect 4 board way up on top of stairs? that is a bizarre choice. I can't
// even reach the top of the board by throwing the ball." Measured, he was describing it exactly -
// the hoops sat at 0.53 m and the screen at 1.13 m, TWO FULL STEPS above them, on a machine whose
// own mockup (and the real Bay Tek cabinet) put the hoops UP and the grid BELOW them.
//
// So: a short apron, then ONE riser carrying the grid screen face-on to the player, then the
// shelf the seven hoops are sunk into, then a back wall. The player throws up and over the
// screen into the hoops above it, which is the real machine's shot.
// THE DISPLAY IS A VERTICAL PANEL, FACE ON TO THE PLAYER, AND THAT IS THE WHOLE POINT OF IT.
//
// In the real cabinet the grid is a widescreen panel standing under the hoop row, square to the
// player, with a column directly beneath each hoop. Being able to READ it - which column a shot
// drops into, and who owns what - is the game.
//
// THE FIRST BUILD RAKED IT BACK AT 38 DEGREES and that is what made the machine unreadable. The
// reasoning was sound and the arithmetic was right: six rows at the column pitch is 7.80X, a
// panel that size standing vertical puts the hoops at 1.335 m, and the sweep says scoring there
// is 0.0-1.3% at every launch speed up to 8.8 m/s (the ball has to rise 1.14 m in the 0.26 m
// between the ramp crest and the board - a 75-degree launch off a 70-degree ramp). Raking it
// spends that height along the cabinet instead of up it, and the hoops come back down to 0.90 m.
//
// WHAT THAT MISSED IS THAT A RAKED PANEL IS SEEN EDGE ON. Measured through the real play camera
// (`reference/hoops/check-display.mjs`): at 38 degrees the display projected to 309 x 159 px on a
// 393 x 852 phone - 20% of the frame - every round cell an ellipse 1.7 times wider than tall, the
// whole bottom row hidden behind the ramp crest and the board's own front rail, and the hoop row
// fanned 15 px off its own columns by perspective. A Connect 4 board you cannot read is not a
// Connect 4 board.
//
// THE SIZE IS WHAT GIVES, NOT THE ANGLE. The panel stands vertical and is as tall as the space
// between the board's lip and the hoop shelf allows - 4.80X, which puts the shelf at exactly the
// height the rake did. Six rows in 4.80X is a row pitch of 0.80X against a column pitch of 1.30X,
// so the board is WIDE: round cells with more air between columns than between rows. That is what
// a widescreen panel showing a 7x6 grid looks like, and it is the reference cabinet's own shape.
//
//     rake   panel    hoops    the display, on a 393px phone
//      38    7.80X    0.95 m   309 x 159 px, cells 1.7:1, bottom row occluded
//      90    4.80X    0.95 m   face on, nothing occluded, no perspective fan   <- this
//
// The hoops do not move: 4.80X vertical rises the same 0.70 m the 7.80X rake did, so the shelf,
// the hoop row and every height the sweep measured are where they were. What DOES move is the
// shelf's DISTANCE - the rake's 0.89 m of horizontal run is gone, so the throw is 0.89 m shorter
// and `minSpeed`/`maxSpeed` were re-measured for it (see the throw section below).
const PANEL_RAKE = Math.PI / 2;        // vertical: the display faces the player
const PANEL_L = 4.80;                  // X, floor to shelf - the height the rake used to rise
const PANEL_W = (COLS - 1) * PITCH + PITCH;   // 9.10X - seven columns, edge to edge
const SHELF = 4.0;                     // X. Deep for control; see HOOP_FROM_BACK below.
const BACK_RISER = 1.8;                // X
// THE HOOPS SIT 0.75X FROM THE SHELF'S BACK EDGE, which is HOT SHOT's layout and Matt's explicit
// call on that machine. The shelf has to be DEEP (the ball lands in front of the row and the
// landing point is what picks the column) AND the row has to be at the BACK (nothing behind it to
// park on).
const HOOP_FROM_BACK = 0.75;

// The display owns the whole vertical face. Nothing occludes it: the ramp crest's sightline
// crosses the panel's own plane at 0.15 m, below the 0.20 m lip the panel stands on, which is
// what raking it away from the camera used to break. `reference/hoops/check-display.mjs`
// raycasts all 42 cells from the play camera and fails if one of them is hidden - re-run it
// after any change to the lip, the rails, the ramp or the camera.
export const SCREEN_V = [0, X * PANEL_L];
export const SCREEN_W = X * PANEL_W;
const ROW_V = X * (PANEL_L + SHELF - HOOP_FROM_BACK);

export const BOARD = {
  id: 'hoops4',
  name: 'CONNECT 4 HOOPS',

  look: {
    wood: '#b8823f', woodDark: '#7c4d22',
    cabinet: '#17181c', cabinetEdge: '#0c0d10',
    cabRed: '#c0392b', cabYellow: '#d9a520',   // the cabinet's player sides, as on the real one
    face: '#1668cf', faceEdge: '#0e4796',     // the lit display blue
    // THE RIMS ARE ORANGE. They were pale (#e6e2d8), read off the reference photo, and Matt -
    // looking at the machine on his phone - said the baskets "don't look like real baskets to
    // me". He is right and the photo reading was the wrong thing to optimise: at the size a hoop
    // occupies on a 393px screen the ONE thing that says "basketball hoop" is an orange ring with
    // a white net under it, and a pale ring with a pale net under it is a wire fence.
    ring: '#e8541f', ringLip: '#b83c10',
    value: '#ffffff', pocket: '#08121f',
    marquee: '#243044', marqueeText: '#ffce3a',
    bulb: '#ffce3a', glow: '#ff9d3d',
    wall: '#15171c', net: '#fbfaf7',
    red: '#e8463f', yellow: '#ffce3a',      // the two players, the real cabinet's colours
  },

  geom: {
    // --- Part 1 of MACHINE-SPEC.md, carried from HOT SHOT -------------------------------------
    ballR: X * 0.375,
    ballMass: 0.18,
    laneLen: 1.40,
    laneW: X * 4.875,
    bedThick: 0.06,
    humpLen: 0.42,
    // 70 degrees at the lip, HOT SHOT's - the throw has to read as a basketball SHOT, a high arc
    // dropping into a hoop from above, not a skeeball roll.
    humpAngles: [0.1995, 0.3990, 0.5985, 0.7980, 0.9975, 1.2217],
    // THE BOARD STANDS ABOVE THE RAMP CREST, AND THE GAP IN FRONT OF IT IS 0.70 m. Both numbers
    // are the same defect: the camera could not see the bottom of the display.
    //
    // The ramp crest is 0.464 m up (six segments to 70 degrees) and the board's lip used to be
    // 0.20 m up, 0.225 m behind it - so the crest stood 0.26 m PROUD of the foot of the display,
    // a quarter of a metre in front of it. Measured through the real play camera
    // (`reference/hoops/check-display.mjs` raycasts all 42 cells): the bottom row was hidden
    // behind the ramp, and on a board that FILLS FROM THE BOTTOM that is the row that matters.
    // The camera cannot solve it - the sightline from the serve spot's side of the crest only
    // clears it from 3.2 m up, which is a bird's eye view of a machine whose whole point is that
    // it faces you. This is skeeball's own lesson and its own fix: raise the BOARD, the way a
    // real cabinet is built (`skeeball/CLAUDE.md`, boardLipY 0.07 -> 0.20).
    //
    // Raising it costs distance, and that is what the trough buys. At 0.225 m of run a ball
    // leaving a 70-degree ramp can climb 0.62 m at the absolute best, and a board 0.32 m higher
    // needs 0.73 m - impossible, at any speed. At 0.70 m of run the same shot clears the panel's
    // top edge by 0.29 m and comes down on the shelf. The gap reads right too: on the real
    // cabinet there IS an open span between where you shoot and the backboard.
    troughLen: 0.70,
    troughDepth: 0.15,
    boardLipY: 0.52,
    boardTilt: 0.8726,              // unused while `steps` exists; kept for the spec's readers
    boardW: X * BOARD_W,
    // Sized to stop an overshoot and no more. At HOT SHOT's 0.85 it stood 1.7 m up from a shelf
    // that is itself 0.86 m high and filled the top third of the frame with a black slab.
    backboardH: 0.42,
    railH: X * 0.6875,
    laneRailH: X * 0.34375,

    // THE CABINET, three segments: the raked display, the hoop shelf, the back wall.
    steps: [
      { len: X * PANEL_L, tilt: PANEL_RAKE },   // the Connect 4 display, raked toward the player
      { len: X * SHELF, tilt: 0.10 },           // the seven hoops are sunk into this
      { len: X * BACK_RISER, tilt: Math.PI / 2 },
    ],
    boardLen: X * (PANEL_L + SHELF + BACK_RISER),

    holeR: X * RIM,
    ringH: X,
    ringThick: 0.015,
    collarThick: X * 0.0825,
    cupSegments: 14,
    lipLowFrac: 0.5,

    // CAPTURE IS HARDER HERE THAN ON ANY OTHER MACHINE, ON PURPOSE. Matt: "if you don't get a
    // swish it should bounce you know? add a little bit of unpredictability." captureDrop is a
    // DISTANCE the ball must fall to count as in, as a fraction of its own radius, and it is the
    // master knob for exactly that - bigger means a ball crossing the mouth off-centre or fast
    // rattles the rim instead of dropping through. HOT SHOT is 0.35.
    captureDrop: 0.52,

    // --- the throw ----------------------------------------------------------------------------
    // MEASURED, and re-measured for THIS cabinet - a speed band is the one number that a change
    // to the machine's DEPTH always invalidates, and this cabinet's depth has changed twice.
    // `reference/hoops/sweep-speed.mjs --scan` walks every launch speed and reports what reaches
    // a hoop; on the vertical build with the board raised and a 0.70 m trough, nothing at all
    // scores below 6.00 or above 6.65, and four candidate bands inside that window were scored
    // over the real power x aim grid:
    //
    //     band          scored    live powers   columns   ordered
    //     6.00 / 6.60   31.5%     11 of 11      7 of 7    yes
    //     6.05 / 6.50   39.2%     11 of 11      7 of 7    yes   <- this
    //     5.95 / 6.65   30.6%     11 of 11      7 of 7    yes
    //
    // "Live powers" is the one that would be a spec failure on its own: at HOT SHOT's 2.60/6.60
    // nothing scored below power 0.65, two thirds of the dial dead. Every band here lights the
    // whole dial; this one scores most often and spreads the columns widest.
    minSpeed: 6.05,
    maxSpeed: 6.50,
    aimMax: 0.45,

    // THE SWIPE MAPS STRAIGHT ONTO AIM HERE (skeeball's default is the SQUARE of it).
    // `aimCurve: 2` is forgiving near straight and steep at the edges, which is right for a
    // machine whose hard shots ARE the corners. It is wrong for this one: the seven columns sit
    // at measured aims of -0.42 .. +0.42 with gaps of 0.08 to 0.20, and squaring compresses the
    // OUTER columns into the narrowest slivers of thumb arc - so the columns would get harder to
    // pick the further out they are, on top of already being a smaller target. BRICK CITY set
    // this to 1 for the same reason (its own file: "a corner-basket shot is as forgiving as a
    // straight one"). Straight proportion spreads the seven evenly across the swipe.
    aimCurve: 1,
    // And the arc that spans them. skeeball divides the swipe angle by 0.38 so a full diagonal
    // reaches aim 1.0; nothing here needs past 0.42, so a bigger divisor spends the whole thumb
    // arc on the range that exists - +/-0.42 of aim over +/-26 degrees of swipe rather than
    // +/-9. THIS IS THE NUMBER TO TUNE FIRST if Matt finds the columns fiddly: it is pure input
    // shaping and touches no physics. The columns sit at aim -0.37 .. +0.38 on the raked
    // cabinet, so 1.00 spends about +/-22 degrees of thumb arc reaching them end to end.
    aimDiv: 1.00,

    // A SEEDED PER-THROW SCATTER, which is the ONLY randomness in this engine and the only one
    // in any engine in this repo. MACHINE-SPEC.md section 9 bans steering a ball toward a hole;
    // it does not ban an imperfect release, and Matt asked for one. physics.js threads a seeded
    // rng through startThrow and leaves simulateThrow deterministic, exactly as skeeball's
    // "Things a future session will want to know" says to, so every sweep and test still
    // reproduces. Radians of aim and a fraction of speed.
    jitterAim: 0.013,
    jitterSpeed: 0.012,

    // --- bounce and grip ------------------------------------------------------------------------
    mat: {
      // THE SHELF BOUNCES, AND THIS IS THE HALF OF "BOUNCIER" THAT WAS MISSING. Matt, twice:
      // "make sure the rims are a little bouncier than other skeeball games... if you don't get a
      // swish it should bounce", and then, having played the build that raised ringRest to 0.62:
      // "they're not very bouncy, like I asked."
      //
      // He was right and the rims were never the problem. MEASURED over 231 throws
      // (`probe-bounce.mjs`): only 47% of misses bounced at all, 0.60 bounces per miss, and the
      // mean best rebound was 0.38 m/s - a dribble. The rim is hit by half the throws, but what a
      // miss LANDS ON afterwards was dead: the shelf at 0.05, the display wall at 0.05 and the
      // fins at 0.03. A lively rim over a beanbag floor feels like a beanbag.
      boardFric: 0.12,
      boardRest: 0.58,
      // The vertical display panel is the single most-hit surface on the machine - 165 of 231
      // throws touch a riser, because a shot that falls short hits the face of the board. It is a
      // painted steel panel, so it plays like one: a short shot comes BACK at the player.
      riserFric: 0.10,
      riserRest: 0.70,
      // The trough is the catch pit and stays dead, deliberately: a bouncy trough throws a dead
      // ball back out onto the lane instead of ending the shot.
      troughFric: 0.40,
      troughRest: 0.06,
      woodFric: 0.30,
      woodRest: 0.22,
      // THE SIDE WALLS ARE DEAD, and this is a measured gameplay fix rather than a look. At HOT
      // SHOT's 0.15 the outer columns were catch-alls - hoops 1 and 7 took 91 and 95 hits against
      // 26-42 for the middle, because an over-aimed ball banked off the rail and fell into the end
      // column. A dead rail makes over-aim an honest miss, which under shoot-until-you-make-it
      // costs a shot and not a turn. Clean powers went 5 of 21 -> 8 of 21.
      wallFric: 0.04,
      wallRest: 0.03,
      // THE RIMS ARE THE BOUNCIEST IN THE REPO (HOT SHOT 0.30, THE CLASSIC 0.18). Matt: "make
      // sure the rims are a little bouncier than other skeeball games." This is the other half of
      // captureDrop above - together they are what turns a shot that is not a swish into a live
      // rattle that can still drop, or can still bounce out.
      ringFric: 0.06,
      // BOUNCIER AGAIN, 2026-09-22. Matt, having played it: "i'd like for them to be bouncier."
      // 0.46 -> 0.62, which is 3.4x THE CLASSIC (0.18) and more than twice HOT SHOT (0.30). What
      // makes that safe is the THROAT: a captured ball is contained by a wall 8 ball-radii tall,
      // so a livelier rim cannot cost the "100% of the time" promise the way it did at 2.4 and
      // 4.0 - and hoops4/js/test.js asserts that promise at exactly 100.00%, so a bounce number
      // that broke it would go red rather than quietly leak balls into the wrong column.
      ringRest: 0.72,
      ring100Fric: 0.06,
      ring100Rest: 0.72,
      deadFric: 0.06,
      deadRest: 0.32,
      backFric: 0,
      backRest: 0.60,
    },

    // --- the face: seven hoops in ONE row ---------------------------------------------------------
    holes: (() => {
      const h = {};
      for (let i = 0; i < COLS; i++) {
        h['c' + (i + 1)] = {
          u: X * ((i - (COLS - 1) / 2) * PITCH),
          v: ROW_V,
          r: X * RIM,
          collarH: X * 0.875,
          value: i + 1,              // the COLUMN this hoop drops into, 1-7
        };
      }
      return h;
    })(),

    // --- THE FINS: why a ball cannot balance between two rims -------------------------------------
    // Matt: "Make sure a ball can't get stuck balancing between two rims."
    //
    // It genuinely could. The rims sit 1.30X apart and are 1.0X across, so the clear gap between
    // two rim walls is 3.2 cm against a 10.9 cm ball - the ball cannot fall INTO the gap, so it
    // sits ON both rim tops, centred over the gap, in a stable saddle. That is a real resting
    // place, not a theoretical one.
    //
    // A fin is a divider standing in each gap and rising ABOVE the rim line, capped with a ridge
    // (a box rotated 45 degrees about the tread's own v axis, so its top is an edge and not a
    // face). It removes the saddle: there is no longer a flat pair of rim tops to sit across, and
    // a ball arriving there is on a ridge and sheds to one side - usually into one of the two
    // hoops, which is also where Matt's "little bit of unpredictability" comes from.
    //
    // The fin is NARROWER THAN THE GAP and never overhangs a rim. A mouth's width is Matt's
    // number and nothing here is allowed to narrow one.
    // See machine.js, "THE RAIL CHAMFERS". 67 of 231 throws parked against a square rail corner
    // before this existed; a chamfer is the spec's own prescribed fix for a right-angled pocket.
    railChamfer: X * 0.42,

    fins: {
      rise: X * 0.30,        // how far the ridge stands above the rim
      inset: 0.0035,         // clearance from each rim wall, so the fin cannot touch a mouth
      depth: X * 1.40,       // how far the fin runs along v (the tread's depth at the hoops)
    },
  },
};

export default BOARD;
