// hoops4/js/boarddef.js - the CABINET, as data. Same shape as a skeeball `BOARDS` entry's
// `geom` block, because hoops4's engine is a copy of skeeball's brickcity engine and reads the
// same fields. This is NOT a skeeball machine: it is not in skeeball's BOARDS, it has no unlock,
// no rack of nine and no objectives. It only shares the physics.
//
// EVERY NUMBER BELOW THAT DIFFERS FROM HOT SHOT WAS MEASURED, NOT CHOSEN. The sweep that
// produced them is reference/hoops/sweep-hoops-columns.mjs and the numbers are written up in
// reference/hoops/FINDINGS.md. Re-run both after touching anything in here.

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
// X, vertical - this face IS the Connect 4 display, and its height is set by TWO things at once.
//
// THE SCREEN HAS TO CLEAR THE RAMP CREST. The camera stands behind the ball, so the crest (top
// y 0.388) cuts a sight line straight across anything low on the board - the same occlusion
// sight.mjs exists to catch, and at 2.3X it hid 43% of the display. At 4.2X the shelf stands at
// 0.811 m and 0.42 m of screen clears the crest instead of 0.15 m.
//
// AND A TALLER MACHINE TURNED OUT TO PLAY BETTER, which is the opposite of what an earlier pass
// here concluded. That pass measured a 0.697 m shelf as unreachable (6-10% scoring, up to 73%
// parked) and blamed the HEIGHT. It was wrong: the fault was the shelf LAYOUT of the time (hoops
// 1.2X from the front edge, with bare shelf behind them to park on). Re-swept against the
// corrected back-of-shelf layout, height is a straight win - 4.2X scores 33.3% with 6.7% parked
// and the best column separation measured anywhere (2.11x the spread), against 36.3% / 7.4% /
// 0.92 at 2.3X. The speed range did not have to move for it.
const SCREEN_RISER = 4.2;
// THE SHELF IS 4.0X AND THE HOOPS SIT 0.75X FROM ITS BACK EDGE - which is HOT SHOT's layout,
// and Matt's explicit call on that machine ("the baskets sit at the back of each tread"). It
// took three measured attempts to arrive back at it:
//
//   shelf 3.2X, hoops 1.2X from the FRONT  ->  2.0X of bare shelf behind the row, and 119 of 325
//                                              throws parked on it after flying over the hoops
//   shelf 2.2X, hoops 1.2X from the front  ->  parking fixed, but the back wall was now so close
//                                              that shots caromed off it across columns: the
//                                              middle three columns' mean aims collapsed to
//                                              -0.03 / 0.00 / +0.06 and aim stopped choosing
//   shelf 4.0X, hoops 0.75X from the BACK  ->  38.9% scored, 9.3% parked, and the gap between
//                                              adjacent columns' mean aim is 1.68x their spread
//
// The shelf has to be DEEP for control (the ball lands in front of the row and the landing point
// is what picks the column) and the row has to be at the BACK so there is nowhere behind it to
// park. Both at once is the only thing that satisfies both.
const SHELF = 4.0;
const HOOP_FROM_BACK = 0.75;
const BACK_RISER = 1.8;     // X
//
// THERE IS NO APRON IN FRONT OF THE SCREEN, and that is a measured decision rather than a
// simplification. A first cut put a 1.0X near-flat tread at the board's bottom edge; it is a
// PARKING SPOT. A throw that fails to clear the riser lands on it, stops, and waits out the
// watchdog - 49% of throws parked, against 12% on the build before. The real cabinet has nothing
// there either: below the hoops is the display, and below that the ball return. So the screen
// riser now rises straight off the board's bottom edge and a short throw hits it, drops to the
// trough and is a clean fast miss.
//
// THE RISER'S HEIGHT IS SET BY REACH, NOT BY THE SCREEN. The shelf has to land near 0.53 m, the
// height the 861-throw sweep proved the dial can cover; at 3.2X it stood at 0.697 m and scoring
// collapsed to 6-10% with up to 73% of throws parking short. So the screen is WIDE rather than
// tall, which is also how the real cabinet's display is shaped.
// THE DISPLAY SITS ON THE UPPER PART OF THE RISER, NOT ALL OF IT. The ramp crest (top y 0.388)
// cuts a sight line across the bottom of the board from a camera standing behind the ball, so
// anything painted below about 0.42 m is not visible from where the game is actually played -
// the occlusion sight.mjs exists to catch. Starting the panel above that line is what lets it
// be large AND wholly on screen.
export const SCREEN_V = [X * SCREEN_RISER * 0.36, X * SCREEN_RISER * 0.99];
const ROW_V = X * (SCREEN_RISER + SHELF - HOOP_FROM_BACK);

export const BOARD = {
  id: 'hoops4',
  name: 'CONNECT 4 HOOPS',

  look: {
    wood: '#b8823f', woodDark: '#7c4d22',
    cabinet: '#1d1f24', cabinetEdge: '#101114',
    face: '#1f5fa8', faceEdge: '#164a86',
    ring: '#e8541f', ringLip: '#ff8a1f',
    value: '#ffffff', pocket: '#08121f',
    marquee: '#243044', marqueeText: '#ffce3a',
    bulb: '#ffce3a', glow: '#ff9d3d',
    wall: '#15171c', net: '#e6e2d8',
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
    troughLen: 0.225,
    troughDepth: 0.15,
    boardLipY: 0.20,
    boardTilt: 0.8726,              // unused while `steps` exists; kept for the spec's readers
    boardW: X * BOARD_W,
    // Sized to stop an overshoot and no more. At HOT SHOT's 0.85 it stood 1.7 m up from a shelf
    // that is itself 0.86 m high and filled the top third of the frame with a black slab.
    backboardH: 0.42,
    railH: X * 0.6875,
    laneRailH: X * 0.34375,

    // ONE STEP. apron -> the screen riser -> the hoop shelf -> the back wall.
    steps: [
      { len: X * SCREEN_RISER, tilt: Math.PI / 2 },   // the Connect 4 display, facing the player
      { len: X * SHELF, tilt: 0.10 },                 // the seven hoops are sunk into this
      { len: X * BACK_RISER, tilt: Math.PI / 2 },
    ],
    boardLen: X * (SCREEN_RISER + SHELF + BACK_RISER),

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
    // MEASURED, and re-measured for the one-step cabinet. It brackets the band that actually
    // reaches the hoop shelf: 13 of 13 powers score, all 7 columns, the best scoring rate of six
    // candidate ranges swept (27.4%). At HOT SHOT's 2.60/6.60 nothing scored below power 0.65 -
    // two thirds of the dial dead, which is a spec failure on its own.
    minSpeed: 4.40,
    maxSpeed: 5.60,
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
    // shaping and touches no physics. The columns now sit at aim -0.52 .. +0.54, so 0.85 spends
    // about +/-26 degrees of thumb arc on reaching them end to end.
    aimDiv: 0.85,

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
      boardFric: 0.12,
      boardRest: 0.05,
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
      ringRest: 0.46,
      ring100Fric: 0.06,
      ring100Rest: 0.46,
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
