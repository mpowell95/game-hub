// skeeball/js/render.js - every pixel of the machine. Pure drawing: hand it a context, a layout, a
// board and a scene, it paints. It owns no state, no timers and no input.
//
// THE LOOK IS MEASURED, NOT INVENTED. Geometry and colour come from reference/skeeball/SPEC.md,
// read off Matt's own recordings with raw-RGB scanlines rather than picked by eye. Read it before
// changing a number here.
//
// THE 2026-08-11 REBUILD. Matt, on watching this game next to the machine it clones: "SKEEBALL IS
// TERRIBLE... look at how horrible the gameplay is." His recordings (`Skeeball 2.MOV`,
// `Skeeball 3.MOV`) are the evidence, and four things in this file were why:
//   1. the playfield had 33% of the height and an empty lane had 44%     -> the Y anchors
//   2. it was painted GREEN AND SILVER; the reference cabinet is cream,
//      wood-brown and deep red, and contains no green at all             -> boards.js's palette
//   3. the bowl was a flat panel, so nothing read as a dish you throw
//      into - no concavity, no cast shadows, a rail with no thickness    -> drawMachine/drawTargets
//   4. the cups were small cold cylinders with floating labels; the
//      reference's are big cream tubes, overlapping, numbered on the
//      front face in dark ink                                            -> drawTube
// Each is fixed below and each carries its own note. The gameplay half of the same complaint is
// in game.js and boards.js.
//
// COORDINATES. Three spaces, and keeping them straight is most of this file:
//   design   the fixed DW x DH box everything is authored in; layoutFor() scales it to the screen
//   lane     v 0..1 along the lane (0 = foul line), u -1..1 across it
//   board    x -1..1 across the playfield, y 0..1 front-to-back - what boards.js targets live in
//
// PERSPECTIVE. One function does the lane: sc(v) = 1 / (1 + v * (NEAR_OVER_FAR - 1)), i.e. 1/z for
// a camera looking down the lane. Widths, ball radius and rail chevron spacing all multiply by it,
// and the screen y derives from it, so equal steps along the real lane compress toward the top.

import { LATERAL_GAIN } from './game.js';

export const DW = 480;
export const DH = 1000;

const NEAR_OVER_FAR = 1.988;       // lane half-width at the foul line / at the board (SPEC)

/** Vertical anchors, fractions of DH.
 *
 *  THE BOARD GETS THE SCREEN, THE LANE GETS WHAT IS LEFT. The first build gave the playfield
 *  33% of the height and the empty lane 44%, so the part you interact with was a strip at the
 *  top and most of the screen was flat nothing - clearly visible in Matt's `Skeeball 2.MOV`.
 *
 *  The reference frame, measured, splits as: back wall 11%, bowl 21%, ramp 10%, lane 34%. The
 *  bowl is not a huge share of the HEIGHT - what makes it read as the main event is that it is
 *  WIDE and SHALLOW with a lit back wall standing behind it, not a deep well. A first pass at
 *  this gave the field 48.5% and produced a dish deeper than it was wide, which no camera on a
 *  real cabinet would ever see. These anchors keep the reference's shape on a taller phone:
 *  wall 14.5%, bowl 31.5%, ramp 10%, lane 34%. */
const Y = {
  marqueeTop: 0.015,
  marqueeBot: 0.100,
  fieldTop: 0.245,      // where the playfield starts; above it is the back wall
  fieldBot: 0.560,      // the playfield's front lip
  rampBot: 0.660,       // where the flat lane ends and the ramp starts to rise
  laneTop: 0.660,
};

// THE RAMP. The lane used to stop dead at the playfield's front edge on a hard horizontal line,
// with the playfield ALSO being wider than the lane at that point - a colour step and a width step
// in the same pixel row. Matt: "the way the ramp meets the scoring area is abrupt and not
// realistic. It's significantly worse than any reference photo."
//
// A real cabinet has one continuous surface: the flat lane curves upward and flares outward into
// the playfield, and the ball rolls over the join without anything changing under it. So the band
// between `rampBot` and `fieldBot` is drawn as that curve - width eased from the lane's to the
// playfield's, colour eased from the lane's to the field's, and a lit crest where it levels off.
const RAMP_EASE = (k) => k * k * (3 - 2 * k);      // smoothstep: flat at both ends, so neither
                                                    // join shows a crease

/** The playfield's half-width in design units (board space x = +-1). */
const FIELD_HALF = 0.400 * DW;
/** How much of DH board space y spans, front lip to back wall. */
const FIELD_DEPTH = (Y.fieldBot - Y.fieldTop) * DH;

/** Board-space y is NOT linear on screen: the back of the bowl is further from the camera, so
 *  equal steps back get shorter. Measured off the reference frame - the cup pitch runs 110px,
 *  92px, 90px front to back, i.e. the far end is compressed about 20%. `bz` is that curve,
 *  pinned at bz(0)=0 and bz(1)=1 so the front lip and the back wall stay exactly where the Y
 *  anchors put them. Without it the cup stack reads as a flat ladder rather than a receding one. */
const BOARD_PERSP = 0.13;
const bz = (y) => y * ((1 + BOARD_PERSP) - BOARD_PERSP * y);

const LANE_HALF_NEAR = 0.49;
const RAIL_W_NEAR = 0.085;
const BALL_R_NEAR = 0.070;
/** Rim height / rim width for every tube on the playfield - one camera, one foreshortening.
 *  Measured off the reference gameplay frame: the 20 cup is 205px wide with a 55px-tall rim. */
const RIM_RATIO = 0.27;

export function sc(v) { return 1 / (1 + v * (NEAR_OVER_FAR - 1)); }

export function laneY(v) {
  const top = Y.laneTop * DH;
  const k = (1 - sc(v)) / (1 - sc(1));
  return DH - (DH - top) * k;
}
export function laneHalf(v) { return LANE_HALF_NEAR * DW * sc(v); }
export function lanePoint(v, u) {
  return { x: DW / 2 + u * laneHalf(v), y: laneY(v), r: BALL_R_NEAR * DW * sc(v) };
}

/** Board space -> design space. y=0 is the front lip, y=1 the back wall; the playfield narrows
 *  slightly toward the back so it sits in the same world as the lane. */
export function boardPoint(x, y) {
  const z = bz(y);
  const yy = Y.fieldBot * DH - z * FIELD_DEPTH;
  const narrow = 1 - z * 0.155;
  return { x: DW / 2 + x * FIELD_HALF * narrow, y: yy, k: narrow };
}

/** Where a resolved target sits on screen - the point a ball animates INTO. */
export function targetPoint(board, id) {
  const t = board && board.targets ? board.targets.find((z) => z.id === id) : null;
  if (!t) { const p = boardPoint(0, 0.2); return { x: p.x, y: p.y, r: 0.1 * DW }; }
  const p = boardPoint(t.x, t.y);
  return { x: p.x, y: p.y, r: t.rx * FIELD_HALF * p.k };
}

export function layoutFor(cssW, cssH) {
  const scale = Math.min(cssW / DW, cssH / DH);
  return { scale, ox: (cssW - DW * scale) / 2, oy: (cssH - DH * scale) / 2, w: cssW, h: cssH };
}

// --- helpers -------------------------------------------------------------------------------

function ellipse(c, x, y, rx, ry) {
  c.beginPath(); c.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); c.closePath();
}

/** An open-topped white tube standing on the playfield: the motif every classic target is made of.
 *  `depth` is how tall the visible wall is. */
function drawTube(c, P, x, y, rx, ry, depth, label, labelPx) {
  // The shadow it drops onto the bowl floor, first, so every other tube sits on top of it.
  c.fillStyle = 'rgba(0,0,0,0.28)';
  ellipse(c, x, y + depth + ry * 0.35, rx * 1.02, ry * 0.85); c.fill();

  const wall = c.createLinearGradient(x - rx, 0, x + rx, 0);
  wall.addColorStop(0, P.targetDeep);
  wall.addColorStop(0.16, P.targetShade);
  wall.addColorStop(0.46, P.target);
  wall.addColorStop(0.78, P.targetFace);
  wall.addColorStop(1, P.targetShade);
  c.fillStyle = wall;
  c.beginPath();
  c.moveTo(x - rx, y);
  c.lineTo(x - rx, y + depth);
  c.ellipse(x, y + depth, rx, ry, 0, Math.PI, 0, true);
  c.lineTo(x + rx, y);
  c.closePath();
  c.fill();

  // The rim: a bright ellipse, then the opening cut out of it. The opening is 0.86 of the rim -
  // in the reference the wall of the tube is thin and the hole is most of what you see, which is
  // what makes it read as somewhere a ball can go rather than as a bollard.
  c.fillStyle = P.target;
  ellipse(c, x, y, rx, ry); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.55)';
  c.lineWidth = Math.max(1, rx * 0.05);
  ellipse(c, x, y - ry * 0.07, rx * 0.985, ry * 0.94); c.stroke();
  const mouth = c.createLinearGradient(0, y - ry, 0, y + ry);
  mouth.addColorStop(0, '#1A0803');
  mouth.addColorStop(1, P.hole);
  c.fillStyle = mouth;
  ellipse(c, x, y + ry * 0.08, rx * 0.86, ry * 0.78); c.fill();
  // A lit back lip inside the hole so it reads as a hole, not a flat blob.
  c.strokeStyle = 'rgba(255,225,180,0.30)';
  c.lineWidth = Math.max(1, rx * 0.055);
  c.beginPath();
  c.ellipse(x, y + ry * 0.08, rx * 0.86, ry * 0.78, 0, Math.PI * 1.06, Math.PI * 1.94);
  c.stroke();

  // The numeral, on the FRONT FACE of the tube in dark ink - the reference's own treatment, and
  // the reason its board is readable at a glance where a floating label is not.
  if (label) {
    c.save();
    c.font = `800 ${Math.round(labelPx)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const ly = y + ry * 0.30 + depth * 0.58;
    c.fillStyle = 'rgba(255,255,255,0.30)';
    c.fillText(label, x, ly + Math.max(1, labelPx * 0.045));
    c.fillStyle = P.ink;
    c.fillText(label, x, ly);
    c.restore();
  }
}

/** A flat star plate laid on the playfield (the stars machine). */
function drawStar(c, P, x, y, rx, ry, label, labelPx) {
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = (i % 2 ? 0.46 : 1) * rx;
    const fn = i ? 'lineTo' : 'moveTo';
    c[fn](Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.restore();
  const g = c.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
  g.addColorStop(0, P.target);
  g.addColorStop(0.6, P.targetFace);
  g.addColorStop(1, P.targetShade);
  c.fillStyle = g; c.fill();
  c.strokeStyle = P.targetDeep; c.lineWidth = Math.max(1.5, rx * 0.07); c.stroke();

  c.fillStyle = P.hole;
  ellipse(c, x, y, rx * 0.40, ry * 0.40); c.fill();
  if (label) {
    c.save();
    c.fillStyle = P.target;
    c.font = `800 ${Math.round(labelPx)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, x, y + labelPx * 0.04);
    c.restore();
  }
}

// --- the machine ------------------------------------------------------------------------------

/** Everything static: cabinet, playfield, targets, lane, rails. Cached by the UI into an
 *  offscreen canvas and blitted per frame; only the ball, badge, popups and the live marquee
 *  numbers are drawn on top. */
export function drawMachine(c, board) {
  const P = board.palette;

  // Cabinet head + marquee frame (the live numbers are drawn per frame by drawMarquee).
  c.fillStyle = P.wall;
  c.fillRect(0, 0, DW, Y.fieldTop * DH);
  const mTop = Y.marqueeTop * DH, mBot = Y.marqueeBot * DH;
  c.fillStyle = P.marqueeTrim;
  c.beginPath(); c.roundRect(0.045 * DW, mTop - 4, 0.91 * DW, (mBot - mTop) + 8, 10); c.fill();
  c.fillStyle = P.marquee;
  c.beginPath(); c.roundRect(0.055 * DW, mTop + 2, 0.89 * DW, (mBot - mTop) - 4, 7); c.fill();

  // THE THROAT: the space between the marquee and the back of the bowl. In the reference this is
  // not empty wall, it is the inside of the cabinet - a lit backboard with the machine's name on
  // it and two side panels converging toward it. Drawn flat, it is a quarter of the screen doing
  // nothing, which is exactly how it looked on the first pass at these proportions.
  drawThroat(c, board);

  // THE BOWL. Not a flat panel: a wooden dish you are looking down into. Three layers, and all
  // three are needed - the first build drew only the middle one and the board read as a sticker
  // on a wall.
  //
  //  1. the back wall standing behind the dish (P.wall, the reference's deep red)
  //  2. the floor, warm wood, LIT AT THE BACK where the cabinet light falls and darkening toward
  //     the player, which is the direction the reference's own gradient runs
  //  3. a vignette hugging the left, right and front edges, which is what actually makes it
  //     concave - without it the floor is just a lighter rectangle
  const fTop = Y.fieldTop * DH, fBot = Y.fieldBot * DH;
  c.fillStyle = P.wall;
  c.fillRect(0, fTop, DW, fBot - fTop);

  const tl = boardPoint(-1, 1), tr = boardPoint(1, 1), bl = boardPoint(-1, 0), br = boardPoint(1, 0);
  const floor = () => {
    c.beginPath();
    c.moveTo(bl.x, bl.y); c.lineTo(tl.x, tl.y); c.lineTo(tr.x, tr.y); c.lineTo(br.x, br.y);
    c.closePath();
  };
  floor();
  const glow = c.createLinearGradient(0, tl.y, 0, bl.y);
  glow.addColorStop(0, P.fieldLit);
  glow.addColorStop(0.30, P.field);
  glow.addColorStop(1, P.fieldShade);
  c.fillStyle = glow;
  c.fill();

  c.save();
  floor(); c.clip();
  // Side walls of the dish, curving in.
  for (const side of [-1, 1]) {
    const edgeX = side < 0 ? bl.x : br.x;
    const g = c.createLinearGradient(edgeX, 0, DW / 2 + side * FIELD_HALF * 0.35, 0);
    g.addColorStop(0, P.fieldDeep);
    g.addColorStop(0.42, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    floor(); c.fill();
  }
  // And the shadow the front lip casts back into the dish.
  const frontShade = c.createLinearGradient(0, bl.y, 0, bl.y - FIELD_DEPTH * 0.22);
  frontShade.addColorStop(0, 'rgba(0,0,0,0.34)');
  frontShade.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = frontShade;
  floor(); c.fill();
  c.restore();

  drawRamp(c, P);
  drawLane(c, P);

  // Side walls: black ball-return housings with a deep red inner trim. Their inner edge FOLLOWS
  // the ramp's own flare (same RAMP_EASE), so the cabinet narrows with the surface instead of
  // cutting a straight diagonal across it and leaving a black wedge either side of the throat.
  const rampBotY = Y.rampBot * DH;
  const halfBot = laneHalf(1);
  const halfTop = FIELD_HALF * boardPoint(0, 0).k;
  const edge = [];
  for (let i = 0; i <= 26; i++) {
    const k = i / 26;
    edge.push({ y: rampBotY + (fBot - rampBotY) * k, half: halfBot + (halfTop - halfBot) * RAMP_EASE(k) });
  }
  for (const side of [-1, 1]) {
    const inner = (x) => DW / 2 + side * x;
    const outer = side < 0 ? -6 : DW + 6;
    const wallPath = () => {
      c.beginPath();
      c.moveTo(inner(FIELD_HALF * boardPoint(0, 1).k), fTop);
      c.lineTo(inner(halfTop), fBot);
      for (let i = edge.length - 1; i >= 0; i--) c.lineTo(inner(edge[i].half), edge[i].y);
      c.lineTo(inner(laneHalf(1) + RAIL_W_NEAR * DW * sc(1)), rampBotY + 2);
      c.lineTo(outer, rampBotY + 2);
      c.lineTo(outer, fTop);
      c.closePath();
    };
    wallPath();
    c.fillStyle = P.wall;
    c.fill();
    // The red inner trim, a constant-width strip just inside that same contour.
    const TRIM = 0.020 * DW;
    c.save();
    wallPath();
    c.clip();
    c.beginPath();
    c.moveTo(inner(FIELD_HALF * boardPoint(0, 1).k), fTop);
    c.lineTo(inner(halfTop), fBot);
    for (let i = edge.length - 1; i >= 0; i--) c.lineTo(inner(edge[i].half), edge[i].y);
    c.lineTo(inner(edge[0].half + TRIM), edge[0].y);
    for (let i = 0; i < edge.length; i++) c.lineTo(inner(edge[i].half + TRIM), edge[i].y);
    c.lineTo(inner(halfTop + TRIM), fBot);
    c.lineTo(inner(FIELD_HALF * boardPoint(0, 1).k + TRIM), fTop);
    c.closePath();
    c.fillStyle = P.trim;
    c.fill();
    c.restore();
  }

  drawTargets(c, board);
}

/** The inside of the cabinet above the bowl: a backboard panel carrying the machine's name, with
 *  the two side walls converging onto it. Everything here is scenery - nothing is hit-tested. */
function drawThroat(c, board) {
  const P = board.palette;
  const top = Y.marqueeBot * DH + 0.012 * DH;
  const bot = Y.fieldTop * DH;
  const back = boardPoint(0, 1);
  const halfBack = FIELD_HALF * back.k;

  // The lit backboard the cup stack stands in front of.
  const g = c.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, P.trimDark);
  g.addColorStop(0.55, P.wall);
  g.addColorStop(1, P.trim);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(DW / 2 - halfBack, bot);
  c.lineTo(DW / 2 - halfBack * 0.86, top);
  c.lineTo(DW / 2 + halfBack * 0.86, top);
  c.lineTo(DW / 2 + halfBack, bot);
  c.closePath();
  c.fill();

  // The machine's name on it, in the cream the whole cabinet is trimmed in.
  const label = (board.nameKey === 'board_classic' ? 'SKEE-BALL' : String(board.id || '').toUpperCase());
  c.save();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `800 ${Math.round(0.062 * DW)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillText(label, DW / 2, (top + bot) / 2 + 2.5);
  c.fillStyle = P.targetFace;
  c.fillText(label, DW / 2, (top + bot) / 2);
  c.restore();

  // Side panels: darker, converging, so the throat has depth instead of being a flat band.
  for (const side of [-1, 1]) {
    const inner = (f) => DW / 2 + side * halfBack * f;
    c.beginPath();
    c.moveTo(inner(1), bot);
    c.lineTo(inner(0.86), top);
    c.lineTo(side < 0 ? -6 : DW + 6, top);
    c.lineTo(side < 0 ? -6 : DW + 6, bot);
    c.closePath();
    const sg = c.createLinearGradient(inner(1), 0, side < 0 ? -6 : DW + 6, 0);
    sg.addColorStop(0, P.wall);
    sg.addColorStop(1, P.trimDark);
    c.fillStyle = sg;
    c.fill();
  }
}

function drawTargets(c, board) {
  const P = board.palette;

  // The big open oval first: everything else stands inside or above it.
  if (board.ring) {
    const R = board.ring;
    const p = boardPoint(R.cx, R.cy);
    // BOTH axes come from board space, so the oval on screen is exactly the oval boards.js
    // describes. An earlier draft derived ry from rx by a ratio constant, which meant the drawn
    // ring and the numbers it was measured from could drift apart with nothing to catch it.
    const rx = R.rx * FIELD_HALF * p.k;
    const ry = R.ry * FIELD_DEPTH * p.k;
    // Drawn as a thick STROKE, not a fill - the playfield shows through the middle, which is the
    // whole character of the classic board. The rail has real THICKNESS: a dark underside offset
    // downward, then the lit cream band over it, then a highlight along its top. Three strokes,
    // because two of them is a flat donut and that is what the first build looked like.
    const W = rx * 0.155;
    c.lineWidth = W * 1.55;
    c.strokeStyle = 'rgba(0,0,0,0.30)';
    ellipse(c, p.x, p.y + W * 0.62, rx, ry); c.stroke();     // the shadow it casts on the floor
    c.lineWidth = W * 1.18;
    c.strokeStyle = P.targetDeep;
    ellipse(c, p.x, p.y + W * 0.34, rx, ry); c.stroke();     // its own shaded underside
    const g = c.createLinearGradient(0, p.y - ry, 0, p.y + ry);
    g.addColorStop(0, P.targetShade);
    g.addColorStop(0.38, P.target);
    g.addColorStop(1, P.targetFace);
    c.strokeStyle = g;
    c.lineWidth = W;
    ellipse(c, p.x, p.y, rx, ry); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.42)';
    c.lineWidth = Math.max(1, W * 0.18);
    ellipse(c, p.x, p.y - W * 0.34, rx, ry); c.stroke();     // the lit top edge

    // The 10, on the bowl floor in front of the 20 cup - where the reference puts it. It belongs
    // to the floor, not to the rail: the catch-all is "you stayed on the board and found no cup".
    const ten = board.targets.find((t) => t.kind === 'ring');
    if (ten) {
      const q = boardPoint(0, 0.115);
      c.save();
      c.fillStyle = P.ink;
      c.font = `800 ${Math.round(FIELD_HALF * 0.135)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(ten.points), q.x, q.y);
      c.restore();
    }
  }

  // Then every real target, BACK TO FRONT so nearer ones overlap the ones behind.
  const solid = board.targets.filter((t) => t.kind !== 'ring').slice().sort((a, b) => b.y - a.y);
  for (const t of solid) {
    const p = boardPoint(t.x, t.y);
    // WIDTH is the target's rx EXACTLY - no shrink factor. What you see is precisely what you can
    // hit (boards.js rule 1). It used to draw at 0.86 of the catch radius, so every cup was 16%
    // easier to hit than it looked, which is half of why the game felt magnetic.
    // HEIGHT does NOT come from the catch ry - every cup is seen at the same camera angle, so they
    // share one foreshortening ratio (RIM_RATIO, measured: a 62px-wide cup has a ~22px-tall rim).
    const rx = t.rx * FIELD_HALF * p.k;
    const ry = rx * RIM_RATIO;
    if (t.kind === 'star') {
      drawStar(c, P, p.x, p.y, rx, ry * 1.7, String(t.points), rx * 0.44);
    } else {
      // Tall enough that consecutive cups OVERLAP, which is how the reference stack reads as a
      // receding pyramid rather than a row of separate buttons. It costs nothing in fairness:
      // the catch ellipse is the mouth, and the mouth is still clear of the cup in front.
      const depth = rx * (t.kind === 'tube' ? 1.50 : 0.66);
      drawTube(c, P, p.x, p.y, rx, ry, depth, String(t.points), rx * (t.kind === 'tube' ? 0.42 : 0.50));
    }
  }
}

/** The curved throat joining the flat lane to the playfield. Drawn BEFORE the lane so the lane's
 *  own far edge overlaps its bottom, leaving no seam. */
function drawRamp(c, P) {
  const STEPS = 26;
  const yTop = Y.fieldBot * DH, yBot = Y.rampBot * DH;
  const halfBot = laneHalf(1);                       // the lane's half-width where it ends
  const halfTop = FIELD_HALF * boardPoint(0, 0).k;   // the playfield's half-width at its front
  const at = (i) => {
    const k = i / STEPS;
    const e = RAMP_EASE(k);
    return { y: yBot + (yTop - yBot) * k, half: halfBot + (halfTop - halfBot) * e, e };
  };

  c.beginPath();
  for (let i = 0; i <= STEPS; i++) { const a = at(i); const x = DW / 2 - a.half; if (i) c.lineTo(x, a.y); else c.moveTo(x, a.y); }
  for (let i = STEPS; i >= 0; i--) { const a = at(i); c.lineTo(DW / 2 + a.half, a.y); }
  c.closePath();
  const g = c.createLinearGradient(0, yBot, 0, yTop);
  g.addColorStop(0, P.laneLit);        // continues the lane's own colour at the bottom...
  g.addColorStop(0.55, P.field);       // ...and arrives at the playfield's at the top
  g.addColorStop(1, P.fieldLit);
  c.fillStyle = g;
  c.fill();

  // A lit crest right where the surface levels out, which is what actually sells the curve.
  c.save();
  c.clip();
  const crest = c.createLinearGradient(0, yTop - (yBot - yTop) * 0.28, 0, yTop);
  crest.addColorStop(0, 'rgba(255,255,255,0)');
  crest.addColorStop(1, 'rgba(255,255,255,0.16)');
  c.fillStyle = crest;
  c.fillRect(0, yTop - (yBot - yTop) * 0.28, DW, (yBot - yTop) * 0.28);
  c.restore();

  // The white front lip of the playfield, curving across the top of the ramp - the big white band
  // along the bottom of the board in IMG_3952.
  const lipH = 0.011 * DH;
  c.beginPath();
  c.moveTo(DW / 2 - halfTop, yTop + lipH);
  c.quadraticCurveTo(DW / 2, yTop + lipH * 2.6, DW / 2 + halfTop, yTop + lipH);
  c.lineTo(DW / 2 + halfTop, yTop - lipH * 0.2);
  c.quadraticCurveTo(DW / 2, yTop + lipH * 1.3, DW / 2 - halfTop, yTop - lipH * 0.2);
  c.closePath();
  const lip = c.createLinearGradient(0, yTop - lipH, 0, yTop + lipH * 2.6);
  lip.addColorStop(0, P.target);
  lip.addColorStop(1, P.targetShade);
  c.fillStyle = lip;
  c.fill();
}

function drawLane(c, P) {
  const STEPS = 40;
  const pt = (v, s) => ({ x: DW / 2 + s * laneHalf(v), y: laneY(v) });
  c.beginPath();
  for (let i = 0; i <= STEPS; i++) { const p = pt(i / STEPS, -1); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
  for (let i = STEPS; i >= 0; i--) { const p = pt(i / STEPS, 1); c.lineTo(p.x, p.y); }
  c.closePath();
  const g = c.createLinearGradient(0, laneY(1), 0, DH);
  g.addColorStop(0, P.laneLit);
  g.addColorStop(0.5, P.lane);
  g.addColorStop(1, P.laneDeep);
  c.fillStyle = g; c.fill();

  // Wood grain, then the pale centre stripe. Both run ALONG the lane in (v,s) space and are only
  // then projected, so they converge with it. Without the grain the lane is one flat brown fill
  // covering a third of the screen, which is a big part of why the old build read as empty.
  c.save(); c.clip();
  for (const [s0, alpha] of [[-0.82, 0.05], [-0.55, 0.07], [-0.30, 0.04], [0.30, 0.04], [0.55, 0.07], [0.82, 0.05]]) {
    c.strokeStyle = `rgba(0,0,0,${alpha})`;
    c.lineWidth = 2.5;
    c.beginPath();
    for (let i = 0; i <= STEPS; i++) { const p = pt(i / STEPS, s0); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
    c.stroke();
  }
  c.strokeStyle = 'rgba(255,240,210,0.10)';
  c.lineWidth = 3;
  c.beginPath();
  for (let i = 0; i <= STEPS; i++) { const p = pt(i / STEPS, 0); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
  c.stroke();
  c.restore();

  for (const side of [-1, 1]) drawRail(c, P, side);
}

/** One side rail: a flat band with diagonal hazard chevrons, laid out in (v, s) lane space and
 *  only then projected, so the chevrons foreshorten with the lane. */
function drawRail(c, P, side) {
  const STEPS = 34;
  const railW = (v) => RAIL_W_NEAR * DW * sc(v);
  const pt = (v, s) => ({ x: DW / 2 + side * (laneHalf(v) + s * railW(v)), y: laneY(v) });
  const band = (s0, s1) => {
    c.beginPath();
    for (let i = 0; i <= STEPS; i++) { const p = pt(i / STEPS, s0); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
    for (let i = STEPS; i >= 0; i--) { const p = pt(i / STEPS, s1); c.lineTo(p.x, p.y); }
    c.closePath();
  };
  band(0, 0.18); c.fillStyle = P.railDark; c.fill();
  band(0.18, 1);
  const g = c.createLinearGradient(0, laneY(1), 0, DH);
  g.addColorStop(0, P.railLit);
  g.addColorStop(1, P.rail);
  c.fillStyle = g; c.fill();

  // Sparse, low-contrast chevrons. They used to be STRIPE 0.055 in solid railDark, which read as
  // hazard tape stuck down the side of a bowling lane; the reference's rails are a bright yellow
  // board with a thin dark chevron every so often, and the difference is most of why the old lane
  // looked like a warning sign.
  c.save(); band(0.18, 1); c.clip();
  c.fillStyle = 'rgba(65,45,9,0.55)';
  const STRIPE = 0.030, SLANT = 0.055;
  for (let a = -SLANT; a < 1 + STRIPE; a += STRIPE * 3.4) {
    const q = [pt(a, 0.18), pt(a + STRIPE, 0.18), pt(a + STRIPE + SLANT, 1), pt(a + SLANT, 1)];
    c.beginPath(); c.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) c.lineTo(q[i].x, q[i].y);
    c.closePath(); c.fill();
  }
  c.restore();
}

/** The cabinet-head readout: the three scores, on the marquee. IMG_3960's own `BALL SCORE` LED
 *  panel is the precedent for putting them here rather than in a floating HUD.
 *  `rows` is [{label, value, tone}] - tone 'lit' for the live score, 'dim' for records. */
export function drawMarquee(c, board, rows) {
  const P = board.palette;
  const mTop = Y.marqueeTop * DH, mBot = Y.marqueeBot * DH;
  const h = mBot - mTop;
  const n = Math.max(1, rows.length);
  const colW = (0.86 * DW) / n;
  c.save();
  c.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const cx = 0.07 * DW + colW * (i + 0.5);
    c.fillStyle = 'rgba(255,255,255,0.52)';
    c.font = `700 ${Math.round(h * 0.20)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
    c.textBaseline = 'top';
    c.fillText(r.label, cx, mTop + h * 0.16);
    c.fillStyle = r.tone === 'lit' ? '#FFE45C' : 'rgba(255,255,255,0.86)';
    c.font = `800 ${Math.round(h * 0.42)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
    c.textBaseline = 'middle';
    c.fillText(String(r.value), cx, mTop + h * 0.64);
  }
  c.restore();
}

// --- the moving parts ---------------------------------------------------------------------------

const SPECKS = (() => {
  const out = []; let s = 1337;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.70;
    out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.09 + rnd() * 0.06 });
  }
  return out;
})();

export function drawBall(c, x, y, r) {
  if (r <= 0.4) return;
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.30)';
  ellipse(c, x, y + r * 0.62, r * 0.92, r * 0.32); c.fill();
  const g = c.createRadialGradient(x - r * 0.34, y - r * 0.40, r * 0.10, x, y, r);
  g.addColorStop(0, '#FFE7B0');
  g.addColorStop(0.55, '#E9A94C');
  g.addColorStop(1, '#A96A22');
  c.fillStyle = g;
  ellipse(c, x, y, r, r); c.fill();
  c.fillStyle = 'rgba(120,60,10,0.30)';
  for (const s of SPECKS) { ellipse(c, x + s.x * r, y + s.y * r, s.r * r, s.r * r); c.fill(); }
  c.fillStyle = 'rgba(255,255,255,0.75)';
  ellipse(c, x - r * 0.32, y - r * 0.38, r * 0.20, r * 0.15); c.fill();
  c.restore();
}

export function drawMultiplier(c, board, targetId, pulse) {
  const p = targetPoint(board, targetId);
  const w = 0.115 * DW * (1 + pulse * 0.07);
  const h = 0.050 * DW * (1 + pulse * 0.07);
  const x = p.x, y = p.y - h * 1.15;
  c.save();
  c.translate(x, y);
  c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, h * 0.42);
  c.fillStyle = 'rgba(255,255,255,0.94)'; c.fill();
  c.beginPath(); c.roundRect(-w / 2 + 2.5, -h / 2 + 2.5, w - 5, h - 5, h * 0.34);
  const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, '#5FA6F0'); g.addColorStop(1, '#2E7BD4');
  c.fillStyle = g; c.fill();
  c.fillStyle = '#fff';
  c.font = `800 ${Math.round(h * 0.62)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('x3', 0, h * 0.03);
  c.restore();
}

/** `at` is a design-space point - where the ball actually came to rest (ui.js). Deliberately NOT
 *  a target id: the callout belongs to the throw, not to whatever the throw happened to score. */
export function drawPopup(c, at, text, t) {
  // Never let a callout ride up under the cabinet head. A throw that sails over the back lands at
  // board y=1, which is the highest point on the playfield, and the rise then carries the burst
  // into the marquee - where it is drawn on top but half-legible over the score readout.
  const p = { x: at.x, y: Math.max(at.y, (Y.marqueeBot + 0.085) * DH) };
  const rise = 0.045 * DH * t;
  const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
  const pop = t < 0.22 ? t / 0.22 : 1;
  const size = 0.072 * DW * (0.5 + pop * 0.5);
  c.save();
  c.globalAlpha = Math.max(0, alpha);
  c.translate(p.x, p.y - rise - 0.018 * DH);
  c.save(); c.rotate(t * 0.9);
  c.fillStyle = '#F2B705';
  c.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rr = (i % 2 ? 0.44 : 1) * size * 1.85 * pop;
    const fn = i ? 'lineTo' : 'moveTo';
    c[fn](Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath(); c.fill(); c.restore();
  c.font = `800 ${Math.round(size)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = Math.max(3, size * 0.20);
  c.strokeStyle = '#7A2A00'; c.lineJoin = 'round';
  c.strokeText(text, 0, 0);
  c.fillStyle = '#FF6A2B';
  c.fillText(text, 0, 0);
  c.restore();
}

/** The balls still to throw, racked beside the lane. Kept BELOW the ramp on purpose: run up the
 *  side of the cabinet and they sit on top of the board art, which is where they were. */
export function drawQueue(c, n) {
  const r = 0.023 * DW;
  for (let i = 0; i < Math.min(n, 9); i++) drawBall(c, 0.034 * DW, (0.960 - i * 0.036) * DH, r);
}

/**
 * The aim guide: a dashed line up the lane showing WHERE the throw is pointed.
 *
 * It shows direction and nothing else, and that is a deliberate narrowing. It used to be a
 * predicted landing path plus a live power bar, which made sense when power was the distance you
 * had dragged so far - the bar was reading a number you had already committed to. Since the
 * gesture became speed-and-angle (game.js's flickToThrow) that is no longer true: your power is
 * decided at the instant you let go, so a live bar shows a value that is not the one about to be
 * used. A gauge that is wrong at the only moment that matters is worse than no gauge.
 *
 * The ANGLE is different - it is stable, it is the thing you steer continuously, and it is the
 * axis a player most needs help with (the 100s are pure aim). So that is what is drawn, and it
 * runs the ENGINE'S OWN fold maths (LATERAL_GAIN, imported, never copied) so it cannot promise a
 * line the ball will not take.
 */
export function drawAimGuide(c, aim) {
  const a = Math.max(-1, Math.min(1, aim));
  c.save();
  c.globalAlpha = 0.8;
  c.strokeStyle = 'rgba(255,240,210,0.62)';
  c.lineWidth = 3.5;
  c.setLineDash([10, 9]);
  c.beginPath();
  for (let i = 0; i <= 26; i++) {
    const v = i / 26;
    let u = a * LATERAL_GAIN * v;
    while (Math.abs(u) > 1) u = Math.sign(u) * (2 - Math.abs(u));
    const q = lanePoint(v, u);
    if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y);
  }
  c.stroke();
  c.setLineDash([]);
  c.restore();
}

// --- the picker's machine art --------------------------------------------------------------

/** One link of a chain, drawn along a segment. */
function chainLink(c, x, y, len, thick, angle, flat) {
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  if (flat) c.scale(1, 0.42);
  const g = c.createLinearGradient(0, -thick, 0, thick);
  g.addColorStop(0, '#D8DCE2');
  g.addColorStop(0.45, '#9AA1AB');
  g.addColorStop(1, '#5A6069');
  c.strokeStyle = g;
  c.lineWidth = thick;
  c.lineCap = 'round';
  c.beginPath();
  c.ellipse(0, 0, len / 2, thick * 0.95, 0, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

/** A steel chain from A to B. Links alternate face-on and edge-on, which is the whole reason a
 *  chain reads as a chain rather than as a dotted line. */
function drawChain(c, x0, y0, x1, y1, thick) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const len = thick * 3.1;
  const step = len * 0.62;
  const n = Math.max(1, Math.round(dist / step));
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.5)';
  c.shadowBlur = thick * 0.8;
  c.shadowOffsetY = thick * 0.3;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    chainLink(c, x0 + dx * k, y0 + dy * k, len, thick * 0.34, angle, i % 2 === 1);
  }
  c.restore();
}

/** The padlock hanging over a locked machine - IMG_3960's, which is the whole visual language
 *  Matt asked for: "the chains and a lock on the [locked] ones, just like in the reference
 *  photos". */
function drawPadlock(c, cx, cy, w) {
  const h = w * 0.86;
  const shackleR = w * 0.30;
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.55)';
  c.shadowBlur = w * 0.18;
  c.shadowOffsetY = w * 0.06;

  // Shackle first, so the body overlaps its feet.
  c.strokeStyle = '#C9CED6';
  c.lineWidth = w * 0.155;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(cx, cy - h * 0.30, shackleR, Math.PI, 0);
  c.stroke();
  c.strokeStyle = '#8B9099';
  c.lineWidth = w * 0.07;
  c.beginPath();
  c.arc(cx, cy - h * 0.30, shackleR, Math.PI * 1.05, Math.PI * 1.55);
  c.stroke();
  c.shadowColor = 'transparent';

  const bodyW = w * 0.86, bodyH = h * 0.62;
  const g = c.createLinearGradient(cx - bodyW / 2, 0, cx + bodyW / 2, 0);
  g.addColorStop(0, '#F2A32B');
  g.addColorStop(0.48, '#FFD24A');
  g.addColorStop(0.52, '#F7B62E');
  g.addColorStop(1, '#D2831A');
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(cx - bodyW / 2, cy - bodyH * 0.18, bodyW, bodyH, w * 0.11);
  c.fill();
  c.strokeStyle = 'rgba(120,70,0,0.55)';
  c.lineWidth = Math.max(1, w * 0.03);
  c.stroke();

  // Keyhole.
  c.fillStyle = '#5A3200';
  ellipse(c, cx, cy + bodyH * 0.16, w * 0.085, w * 0.085); c.fill();
  c.beginPath();
  c.moveTo(cx - w * 0.045, cy + bodyH * 0.18);
  c.lineTo(cx + w * 0.045, cy + bodyH * 0.18);
  c.lineTo(cx + w * 0.028, cy + bodyH * 0.44);
  c.lineTo(cx - w * 0.028, cy + bodyH * 0.44);
  c.closePath(); c.fill();
  c.restore();
}

/**
 * The picker's artwork for one machine, drawn into a `w` x `h` box.
 *
 * **It is the REAL machine, drawn by the real renderer**, scaled into the box - not a separate
 * illustration. Matt asked for "a carousel with an image of the board you're selecting", and the
 * only way a picture of the board cannot drift away from the board is for it to BE the board.
 * A locked machine gets the reference's own treatment: dimmed, chained, padlocked.
 */
export function drawThumb(c, board, w, h, locked) {
  const P = board.palette;
  // The CABINET, whole: head, throat, bowl and front lip - design y 0 to CAB. Fitted "contain"
  // rather than cropped, because a crop of a tall cabinet into a wide box shows the marquee and
  // half a cup, which is not a picture of a machine. The margin is painted in the cabinet's own
  // dark trim so it reads as the machine standing in a room, which is how IMG_3952 frames it.
  const CAB = 0.62 * DH;
  c.save();
  c.beginPath(); c.rect(0, 0, w, h); c.clip();
  c.fillStyle = P.trimDark;
  c.fillRect(0, 0, w, h);
  const scale = Math.min(w / DW, h / CAB);
  c.translate((w - DW * scale) / 2, (h - CAB * scale) / 2);
  c.scale(scale, scale);
  c.beginPath(); c.rect(0, 0, DW, CAB); c.clip();
  drawMachine(c, board);
  drawMarquee(c, board, [{ label: 'BALL', value: '9' }, { label: 'SCORE', value: '0' }]);
  c.restore();

  if (!locked) return;
  c.save();
  c.fillStyle = 'rgba(10,4,2,0.52)';
  c.fillRect(0, 0, w, h);
  const thick = Math.max(9, w * 0.055);
  drawChain(c, -w * 0.05, h * 0.10, w * 1.05, h * 0.72, thick);
  drawChain(c, w * 1.05, h * 0.10, -w * 0.05, h * 0.72, thick);
  drawPadlock(c, w / 2, h * 0.44, w * 0.30);
  c.restore();
}

export default {
  DW, DH, sc, laneY, laneHalf, lanePoint, boardPoint, targetPoint, layoutFor,
  drawMachine, drawMarquee, drawBall, drawMultiplier, drawPopup, drawQueue, drawAimGuide, drawThumb,
};
