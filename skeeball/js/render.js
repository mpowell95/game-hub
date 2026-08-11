// skeeball/js/render.js - every pixel of the machine. Pure drawing: hand it a context, a layout, a
// board and a scene, it paints. It owns no state, no timers and no input.
//
// THE LOOK IS MEASURED, NOT INVENTED. Geometry and colour come from reference/skeeball/SPEC.md's
// "CLASSIC" section, taken off Matt's IMG_3952 (Skee-Ball Collector's Edition). Read it before
// changing a number here. The single most important one: the ring's `ry/rx` is **0.66**, because
// that machine's camera looks well down onto the playfield. The first build of this game used 0.30
// - taken from a different app's much shallower recording - and that is exactly why it read as a
// stack of bands instead of an open ring you can see into.
//
// COORDINATES. Three spaces, and keeping them straight is most of this file:
//   design   the fixed DW x DH box everything is authored in; layoutFor() scales it to the screen
//   lane     v 0..1 along the lane (0 = foul line), u -1..1 across it
//   board    x -1..1 across the playfield, y 0..1 front-to-back - what boards.js targets live in
//
// PERSPECTIVE. One function does the lane: sc(v) = 1 / (1 + v * (NEAR_OVER_FAR - 1)), i.e. 1/z for
// a camera looking down the lane. Widths, ball radius and rail chevron spacing all multiply by it,
// and the screen y derives from it, so equal steps along the real lane compress toward the top.

export const DW = 480;
export const DH = 1000;

const NEAR_OVER_FAR = 1.988;       // lane half-width at the foul line / at the board (SPEC)

/** Vertical anchors, fractions of DH. */
const Y = {
  marqueeTop: 0.020,
  marqueeBot: 0.115,
  fieldTop: 0.135,      // where the playfield starts, under the cabinet head
  boardMid: 0.330,      // board space y=0.5 lands here
  fieldBot: 0.492,      // the playfield's front lip, where the lane begins
  laneTop: 0.492,
};

/** The playfield's half-width in design units (board space x = +-1). */
const FIELD_HALF = 0.375 * DW;
/** How much of DH board space y spans, front lip to back wall. */
const FIELD_DEPTH = (Y.fieldBot - Y.fieldTop) * DH;

const LANE_HALF_NEAR = 0.49;
const RAIL_W_NEAR = 0.085;
const BALL_R_NEAR = 0.070;
/** Rim height / rim width for every tube on the playfield - one camera, one foreshortening.
 *  Measured off IMG_3952: the 62px-wide 50 cup has a rim about 22px tall. */
const RIM_RATIO = 0.35;

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
  const yy = Y.fieldBot * DH - y * FIELD_DEPTH;
  const narrow = 1 - y * 0.13;
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
  const wall = c.createLinearGradient(x - rx, 0, x + rx, 0);
  wall.addColorStop(0, P.targetShade);
  wall.addColorStop(0.35, P.target);
  wall.addColorStop(0.72, P.targetFace);
  wall.addColorStop(1, P.targetDeep);
  c.fillStyle = wall;
  c.beginPath();
  c.moveTo(x - rx, y);
  c.lineTo(x - rx, y + depth);
  c.ellipse(x, y + depth, rx, ry, 0, Math.PI, 0, true);
  c.lineTo(x + rx, y);
  c.closePath();
  c.fill();

  // The rim: a bright ellipse, then the opening cut out of it.
  c.fillStyle = P.target;
  ellipse(c, x, y, rx, ry); c.fill();
  c.fillStyle = P.hole;
  ellipse(c, x, y + ry * 0.06, rx * 0.80, ry * 0.72); c.fill();
  // A lit back lip inside the hole so it reads as a hole, not a flat blob.
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = Math.max(1, rx * 0.06);
  c.beginPath();
  c.ellipse(x, y + ry * 0.06, rx * 0.80, ry * 0.72, 0, Math.PI * 1.08, Math.PI * 1.92);
  c.stroke();

  if (label) {
    c.save();
    c.fillStyle = P.ink;
    c.font = `800 ${Math.round(labelPx)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, x, y + ry + depth * 0.46);
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

  // Playfield: teal with a soft radial light in the middle. The gradient is doing a lot of the
  // work here - a flat fill reads as cardboard (SPEC.md).
  const fTop = Y.fieldTop * DH, fBot = Y.fieldBot * DH;
  c.fillStyle = P.fieldDeep;
  c.fillRect(0, fTop, DW, fBot - fTop);
  const glow = c.createRadialGradient(DW / 2, fTop + (fBot - fTop) * 0.52, DW * 0.04,
    DW / 2, fTop + (fBot - fTop) * 0.52, DW * 0.55);
  glow.addColorStop(0, P.fieldLit);
  glow.addColorStop(0.55, P.field);
  glow.addColorStop(1, P.fieldShade);
  c.fillStyle = glow;
  c.beginPath();
  const tl = boardPoint(-1, 1), tr = boardPoint(1, 1), bl = boardPoint(-1, 0), br = boardPoint(1, 0);
  c.moveTo(bl.x, bl.y); c.lineTo(tl.x, tl.y); c.lineTo(tr.x, tr.y); c.lineTo(br.x, br.y);
  c.closePath(); c.fill();

  drawLane(c, P);

  // Side walls: black ball-return housings with a deep red inner trim, drawn OVER the lane's top
  // so the playfield sits inside the cabinet rather than floating on it.
  for (const side of [-1, 1]) {
    const inner = boardPoint(side * 1.02, 0).x;
    const outer = side < 0 ? -6 : DW + 6;
    c.fillStyle = P.wall;
    c.beginPath();
    c.moveTo(inner, fTop); c.lineTo(outer, fTop);
    c.lineTo(outer, fBot + 0.03 * DH); c.lineTo(boardPoint(side * 1.15, 0).x, fBot + 0.01 * DH);
    c.closePath(); c.fill();
    c.fillStyle = P.trim;
    c.beginPath();
    c.moveTo(inner, fTop);
    c.lineTo(inner - side * 0.022 * DW, fTop);
    c.lineTo(boardPoint(side * 1.15, 0).x - side * 0.022 * DW, fBot + 0.01 * DH);
    c.lineTo(boardPoint(side * 1.15, 0).x, fBot + 0.01 * DH);
    c.closePath(); c.fill();
  }

  drawTargets(c, board);
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
    // whole character of the classic board.
    c.lineWidth = rx * 0.30;
    c.strokeStyle = P.targetDeep;
    ellipse(c, p.x, p.y + rx * 0.05, rx, ry); c.stroke();
    const g = c.createLinearGradient(0, p.y - ry, 0, p.y + ry);
    g.addColorStop(0, P.targetShade);
    g.addColorStop(0.45, P.target);
    g.addColorStop(1, P.targetFace);
    c.strokeStyle = g;
    c.lineWidth = rx * 0.26;
    ellipse(c, p.x, p.y, rx, ry); c.stroke();

    // The 10, on the ring's front limb.
    const ten = board.targets.find((t) => t.kind === 'ring');
    if (ten) {
      c.save();
      c.fillStyle = P.ink;
      c.font = `800 ${Math.round(rx * 0.26)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      // On the ring's FRONT limb, clear of the 20 cup's body in front of it - which is why this
      // adds the stroke's own half-width rather than just sitting at the ellipse's edge.
      c.fillText(String(ten.points), p.x, p.y + ry + rx * 0.16);
      c.restore();
    }
  }

  // Then every real target, BACK TO FRONT so nearer ones overlap the ones behind.
  const solid = board.targets.filter((t) => t.kind !== 'ring').slice().sort((a, b) => b.y - a.y);
  for (const t of solid) {
    const p = boardPoint(t.x, t.y);
    // WIDTH comes from the target's own rx, so a target you can see is the target you can hit.
    // HEIGHT does NOT come from its catch ry - every cup on the machine is seen at the same camera
    // angle, so they all share one foreshortening ratio (RIM_RATIO, measured: a 62px-wide cup has
    // a ~22px-tall rim). Deriving the rim from the catch area instead made each cup as tall as the
    // gap to the next one, and the stack ate its own numbers.
    const rx = t.rx * FIELD_HALF * p.k * 0.86;
    const ry = rx * RIM_RATIO;
    if (t.kind === 'star') {
      drawStar(c, P, p.x, p.y, rx, ry * 1.7, String(t.points), rx * 0.44);
    } else {
      const depth = rx * (t.kind === 'tube' ? 1.45 : 0.85);
      drawTube(c, P, p.x, p.y, rx, ry, depth, String(t.points), rx * (t.kind === 'tube' ? 0.50 : 0.62));
    }
  }
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

  // A pale centre stripe, as on the real cabinet.
  c.save(); c.clip();
  c.strokeStyle = 'rgba(255,255,255,0.13)';
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

  c.save(); band(0.18, 1); c.clip();
  c.fillStyle = P.railDark;
  const STRIPE = 0.055, SLANT = 0.045;
  for (let a = -SLANT; a < 1 + STRIPE; a += STRIPE * 2) {
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

export function drawPopup(c, board, targetId, text, t) {
  const p = targetId ? targetPoint(board, targetId) : boardPoint(0, 0.2);
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

export function drawQueue(c, n) {
  const r = 0.028 * DW;
  for (let i = 0; i < Math.min(n, 9); i++) drawBall(c, 0.045 * DW, (0.60 + i * 0.043) * DH, r);
}

/** The aim/power guide, shown while a flick is in progress. OUR OWN ADDITION - no reference shows
 *  its input (SPEC.md) - and it runs the SAME fold maths the engine will apply, so it cannot lie
 *  about where the ball is going. */
export function drawAimGuide(c, power, aim) {
  const p = Math.max(0, Math.min(1, power));
  const a = Math.max(-1, Math.min(1, aim));
  c.save();
  c.globalAlpha = 0.85;
  c.strokeStyle = 'rgba(255,255,255,0.6)';
  c.lineWidth = 3.5;
  c.setLineDash([10, 9]);
  c.beginPath();
  for (let i = 0; i <= 24; i++) {
    const v = (i / 24) * Math.min(1, 0.25 + p);
    let u = a * 1.35 * v;
    while (Math.abs(u) > 1) u = Math.sign(u) * (2 - Math.abs(u));
    const q = lanePoint(v, u);
    if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y);
  }
  c.stroke();
  c.setLineDash([]);
  const barH = 0.20 * DH, barW = 0.050 * DW;
  const bx = 0.135 * DW, by = 0.955 * DH - barH;
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.beginPath(); c.roundRect(bx, by, barW, barH, barW / 2); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2;
  c.beginPath(); c.roundRect(bx, by, barW, barH, barW / 2); c.stroke();
  const fill = c.createLinearGradient(0, by + barH, 0, by);
  fill.addColorStop(0, '#5FD08A'); fill.addColorStop(0.6, '#F2B705'); fill.addColorStop(1, '#FF6A2B');
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(bx + 3, by + barH - (barH - 6) * p - 3, barW - 6, (barH - 6) * p, (barW - 6) / 2);
  c.fill();
  c.restore();
}

export default {
  DW, DH, sc, laneY, laneHalf, lanePoint, boardPoint, targetPoint, layoutFor,
  drawMachine, drawMarquee, drawBall, drawMultiplier, drawPopup, drawQueue, drawAimGuide,
};
