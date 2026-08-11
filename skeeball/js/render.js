// skeeball/js/render.js - every pixel of the alley. Pure drawing: hand it a context, a layout and
// a scene, it paints. It owns no state, no timers and no input, so the UI can call it from one rAF
// loop and `js/test.js` never has to touch it.
//
// COORDINATES. Everything is authored in a fixed DESIGN BOX (DW x DH below) whose proportions come
// straight from reference/skeeball/SPEC.md, then scaled to fit whatever box the game is mounted in
// ("contain", centred). That is what makes the fit checks pass in both hosts without a second
// layout: the hub's chrome makes the available area shorter, the whole alley just gets smaller,
// and the leftover margin is painted with the same dark side-wall grey the reference already has
// on both sides of the lane, so a letterbox reads as more arcade rather than as a bug.
//
// PERSPECTIVE. One scale function does all of it:
//
//     sc(v) = 1 / (1 + v * (NEAR_OVER_FAR - 1))     v: 0 = foul line (near), 1 = the board (far)
//
// which is just 1/z for a camera looking down the lane. Widths, ball radius and the spacing of the
// rail chevrons are all multiplied by it, and the screen y is derived from it too, so equal steps
// along the real lane compress toward the top exactly as they should. Getting this from one
// function rather than three hand-tuned curves is why the ball never looks like it is sliding
// against the lane it is rolling on.

// The design box. 0.48 is the reference recording's own aspect once the host app's chrome is off.
export const DW = 480;
export const DH = 1000;

const NEAR_OVER_FAR = 1.988;       // lane half-width at the foul line / at the board (SPEC)

// --- the palette, sampled off the recording (SPEC.md "Colors") -----------------------------------
// Nudged toward the cartoony end on purpose (Matt, 2026-08-11: "it's ok if it's a little more
// cartoony, like our other games"). The nudge is saturation and contrast only - every hue, and
// every position in the layout, is still the measured one.
const C = {
  wallTop: '#2A1215',
  wallBot: '#6B2B28',
  wallGlow: 'rgba(255, 176, 120, 0.16)',
  side: '#26262B',
  sideEdge: '#141417',
  woodFar: '#C87249',
  woodMid: '#A55C39',
  woodNear: '#6A3A24',
  railYellow: '#FBE36B',
  railYellowLit: '#FFF3A8',
  railDark: '#3A2E0C',
  railInner: '#241A06',
  cream: '#FFF6E2',
  creamMid: '#F2E4B8',
  creamShade: '#D8C48E',
  hole: '#3E1509',
  holeRim: '#7A4A2A',
  apronFloor: '#8C4A22',
  ink: '#4A1710',
  cupFace: '#F3DFB4',
  ballLit: '#FFE2EC',
  ballMid: '#F3AFC6',
  ballShade: '#D2789A',
  ballSpeck: '#B8517A',
  mult: '#2E7BD4',
  multLit: '#5FA6F0',
  pop: '#FF6A2B',
  popInk: '#7A2A00',
  gold: '#F2B705',
};

// --- geometry -------------------------------------------------------------------------------------

/** Vertical anchors, as fractions of DH. Straight from SPEC.md's "Vertical structure" table. */
const Y = {
  boardTop: 0.255,
  cup: 0.300,        // centre of the two 100 cups
  r50: 0.303,
  r40: 0.343,
  r30: 0.383,
  r20: 0.425,
  apronMid: 0.437,   // centre of the apron's RIM ellipse; its back edge clears the 30 ring
  ten: 0.470,        // the "10" numeral on the apron's front face
  apronLip: 0.492,   // the apron's front face runs all the way down to meet the lane
  laneTop: 0.492,
};

/** Ring stack, front lip up the ramp. `rx` is a fraction of DW. */
// `rx` is a fraction of DW. These sit just above SPEC.md's measured widths (0.0625 / 0.0715 /
// 0.077 / 0.0855) - chunkier reads better at phone size - but NOT by much: an earlier build
// inflated them ~18% and the extra width crowded the stack until the 20's rim covered the 30's
// number. The measured numbers are the floor, the spacing is the ceiling.
const RINGS = [
  { id: '50', y: Y.r50, rx: 0.066 },
  { id: '40', y: Y.r40, rx: 0.075 },
  { id: '30', y: Y.r30, rx: 0.084 },
  { id: '20', y: Y.r20, rx: 0.094 },
];
const CUPS = [
  { id: '100L', x: 0.259, y: Y.cup, rx: 0.055 },
  { id: '100R', x: 0.741, y: Y.cup, rx: 0.055 },
];

const LANE_HALF_NEAR = 0.49;       // fraction of DW at the foul line (SPEC: 0.01..0.99)
const RAIL_W_NEAR = 0.085;         // fraction of DW
const BALL_R_NEAR = 0.070;         // fraction of DW; halves at the board via sc(v)

/** Perspective scale at lane position v (0 = near, 1 = at the board). */
export function sc(v) { return 1 / (1 + v * (NEAR_OVER_FAR - 1)); }

/** Screen y (design units) for lane position v. */
export function laneY(v) {
  const top = Y.laneTop * DH;
  const k = (1 - sc(v)) / (1 - sc(1));
  return DH - (DH - top) * k;
}

/** Lane half-width (design units) at v. */
export function laneHalf(v) { return LANE_HALF_NEAR * DW * sc(v); }

/** Screen point (design units) for a ball at lane position v, lateral u (-1..1 = rail to rail). */
export function lanePoint(v, u) {
  return { x: DW / 2 + u * laneHalf(v), y: laneY(v), r: BALL_R_NEAR * DW * sc(v) };
}

/** Where a resolved target sits on screen (design units) - the point a ball animates INTO. */
export function targetPoint(id) {
  const ring = RINGS.find((r) => r.id === id);
  if (ring) return { x: DW / 2, y: ring.y * DH, r: ring.rx * DW };
  const cup = CUPS.find((c) => c.id === id);
  if (cup) return { x: cup.x * DW, y: cup.y * DH, r: cup.rx * DW };
  return { x: DW / 2, y: Y.apronMid * DH, r: 0.1 * DW };   // the 10, and anything unrecognised
}

/**
 * Fit the design box into a real pixel box, "contain" + centred.
 * @returns {{scale:number, ox:number, oy:number, w:number, h:number}}
 */
export function layoutFor(cssW, cssH) {
  const scale = Math.min(cssW / DW, cssH / DH);
  return { scale, ox: (cssW - DW * scale) / 2, oy: (cssH - DH * scale) / 2, w: cssW, h: cssH };
}

// --- drawing helpers ---------------------------------------------------------------------------

function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, Math.max(0.5, ry), 0, 0, Math.PI * 2); c.closePath(); }

/** A cylinder seen from slightly above: elliptical rim, a front skirt, a dark opening. This is the
 *  shape every ring and both 100 cups are made of - the reference's whole board is one motif. */
function drawCup(c, x, y, rx, depth, opts) {
  const o = opts || {};
  const ry = rx * 0.30;
  const rim = Math.max(3, rx * (o.rimFrac || 0.26));

  // Front skirt: the band of cream you see between the rim's front edge and the ramp behind it.
  const skirt = c.createLinearGradient(0, y, 0, y + depth + ry);
  skirt.addColorStop(0, C.cream);
  skirt.addColorStop(0.55, C.creamMid);
  skirt.addColorStop(1, C.creamShade);
  c.fillStyle = skirt;
  c.beginPath();
  c.moveTo(x - rx, y);
  c.lineTo(x - rx, y + depth);
  c.ellipse(x, y + depth, rx, ry, 0, Math.PI, 0, true);
  c.lineTo(x + rx, y);
  c.closePath();
  c.fill();

  // Rim: the flat top of the cylinder.
  const top = c.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
  top.addColorStop(0, C.creamMid);
  top.addColorStop(0.45, C.cream);
  top.addColorStop(1, C.creamShade);
  c.fillStyle = top;
  ellipse(c, x, y, rx, ry); c.fill();

  // The opening, with a lit back lip so the hole reads as a hole and not a flat dark blob.
  c.fillStyle = C.holeRim;
  ellipse(c, x, y, rx - rim, ry - rim * 0.30); c.fill();
  c.fillStyle = C.hole;
  ellipse(c, x, y + Math.max(1, ry * 0.14), rx - rim, Math.max(1, ry - rim * 0.42)); c.fill();

  if (o.label) {
    c.save();
    c.fillStyle = C.ink;
    c.font = `800 ${Math.round(rx * (o.labelScale || 0.66))}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(o.label, x, y + ry + depth * 0.50);
    c.restore();
  }
}

/** The alley's static furniture: back wall, side walls, the board, the lane, the rails.
 *  Everything here is a pure function of the layout, so the UI caches it into an offscreen
 *  canvas and only repaints the moving parts each frame. */
export function drawAlley(c) {
  // Back wall.
  const wall = c.createLinearGradient(0, 0, 0, Y.apronLip * DH);
  wall.addColorStop(0, C.wallTop);
  wall.addColorStop(1, C.wallBot);
  c.fillStyle = wall;
  c.fillRect(0, 0, DW, Y.apronLip * DH);

  // A soft glow behind the board, so the cream rings have something to sit against.
  const glow = c.createRadialGradient(DW / 2, Y.r40 * DH, DW * 0.05, DW / 2, Y.r40 * DH, DW * 0.62);
  glow.addColorStop(0, C.wallGlow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, DW, Y.apronLip * DH);

  // Side walls (also what the letterbox margin is painted with).
  c.fillStyle = C.side;
  c.fillRect(0, Y.apronLip * DH - 1, DW, DH - Y.apronLip * DH + 1);

  drawLane(c);
  drawBoard(c);
}

function drawLane(c) {
  const STEPS = 48;
  const pt = (v, s) => ({ x: DW / 2 + s * laneHalf(v), y: laneY(v) });

  // The wood, as one path from the foul line to the board.
  c.beginPath();
  c.moveTo(pt(0, -1).x, pt(0, -1).y);
  for (let i = 0; i <= STEPS; i++) { const p = pt(i / STEPS, -1); c.lineTo(p.x, p.y); }
  for (let i = STEPS; i >= 0; i--) { const p = pt(i / STEPS, 1); c.lineTo(p.x, p.y); }
  c.closePath();
  const wood = c.createLinearGradient(0, laneY(1), 0, DH);
  wood.addColorStop(0, C.woodFar);
  wood.addColorStop(0.45, C.woodMid);
  wood.addColorStop(1, C.woodNear);
  c.fillStyle = wood;
  c.fill();

  // Grain: a handful of long, very low-contrast lines converging with the lane.
  c.save();
  c.clip();
  c.strokeStyle = 'rgba(60, 26, 12, 0.16)';
  for (let i = 1; i < 9; i++) {
    const s = -1 + (i / 4.5);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let k = 0; k <= STEPS; k++) { const p = pt(k / STEPS, s); if (k) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
    c.stroke();
  }
  c.restore();

  drawRail(c, -1);
  drawRail(c, 1);
}

/** One side rail: a flat inclined band carrying diagonal hazard chevrons. `side` is -1 or 1.
 *  Both the band and its stripes are laid out in (v, s) lane space and only then projected, so
 *  the chevrons foreshorten with the lane instead of staying evenly spaced up the screen. */
function drawRail(c, side) {
  const STEPS = 40;
  const railW = (v) => RAIL_W_NEAR * DW * sc(v);
  // s: 0 at the lane edge, 1 at the outer edge of the rail.
  const pt = (v, s) => ({ x: DW / 2 + side * (laneHalf(v) + s * railW(v)), y: laneY(v) });

  const band = (s0, s1) => {
    c.beginPath();
    for (let i = 0; i <= STEPS; i++) { const p = pt(i / STEPS, s0); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
    for (let i = STEPS; i >= 0; i--) { const p = pt(i / STEPS, s1); c.lineTo(p.x, p.y); }
    c.closePath();
  };

  // Dark inner lip, then the yellow field.
  band(0, 0.2);
  c.fillStyle = C.railInner;
  c.fill();

  band(0.2, 1);
  const y0 = laneY(1), y1 = DH;
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, C.railYellowLit);
  g.addColorStop(1, C.railYellow);
  c.fillStyle = g;
  c.fill();

  // Chevrons, drawn as slanted quads in lane space and clipped to the yellow field.
  c.save();
  band(0.2, 1);
  c.clip();
  c.fillStyle = C.railDark;
  const STRIPE = 0.055;      // stripe pitch in v
  const SLANT = 0.045;       // how far along v the stripe shifts across the rail
  for (let a = -SLANT; a < 1 + STRIPE; a += STRIPE * 2) {
    const q = [pt(a, 0.2), pt(a + STRIPE, 0.2), pt(a + STRIPE + SLANT, 1), pt(a + SLANT, 1)];
    c.beginPath();
    c.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) c.lineTo(q[i].x, q[i].y);
    c.closePath();
    c.fill();
  }
  c.restore();
}

function drawBoard(c) {
  const apronRx = 0.357 * DW;
  // Same 0.30 flattening as every ring (drawCup), so the apron sits in the SAME projection as the
  // stack it surrounds. It was 0.078 * DH for one build and read as a salad bowl swallowing the
  // 20/30/40 rings whole - the ellipse has to follow the camera, not a hand-picked number.
  const apronRy = apronRx * 0.30;
  const apronCy = Y.apronMid * DH;

  // The apron: one big cream ring around everything, its front face carrying the 10.
  c.fillStyle = C.creamShade;
  c.beginPath();
  c.moveTo(DW / 2 - apronRx, apronCy);
  c.lineTo(DW / 2 - apronRx, Y.apronLip * DH);
  c.ellipse(DW / 2, Y.apronLip * DH, apronRx, apronRy, 0, Math.PI, 0, true);
  c.lineTo(DW / 2 + apronRx, apronCy);
  c.closePath();
  c.fill();

  const lip = c.createLinearGradient(0, apronCy - apronRy, 0, Y.apronLip * DH + apronRy);
  lip.addColorStop(0, C.creamMid);
  lip.addColorStop(0.5, C.cream);
  lip.addColorStop(1, C.creamShade);
  c.fillStyle = lip;
  ellipse(c, DW / 2, apronCy, apronRx, apronRy); c.fill();

  // The 10 floor: the tan area a short throw comes to rest on.
  c.fillStyle = C.apronFloor;
  ellipse(c, DW / 2, apronCy, apronRx * 0.86, apronRy * 0.82); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.20)';
  ellipse(c, DW / 2, apronCy - apronRy * 0.22, apronRx * 0.82, apronRy * 0.62); c.fill();

  // The two corner cups sit BEHIND the ring stack, so they are drawn first.
  for (const cup of CUPS) {
    drawCup(c, cup.x * DW, cup.y * DH, cup.rx * DW, 0.026 * DH, { label: '100', labelScale: 0.52 });
  }

  // Ring stack, back (50) to front (20), so each overlaps the one behind it.
  for (const r of RINGS) {
    drawCup(c, DW / 2, r.y * DH, r.rx * DW, 0.017 * DH, { label: r.id, labelScale: 0.70 });
  }

  // The 10 numeral, on the apron's own front face.
  c.save();
  c.fillStyle = C.ink;
  c.font = `800 ${Math.round(0.050 * DW)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('10', DW / 2, Y.ten * DH);
  c.restore();
}

// --- the moving parts ------------------------------------------------------------------------------

const SPECKS = (() => {
  // Fixed speckle layout: the reference ball is a sprinkled donut, and the sprinkles must not
  // crawl from frame to frame, so they are generated once here rather than per draw.
  const out = [];
  let s = 1337;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.72;
    out.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.10 + rnd() * 0.07 });
  }
  return out;
})();

/** One ball at a screen point. `r` is its radius in design units. */
export function drawBall(c, x, y, r) {
  if (r <= 0.4) return;
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.28)';
  ellipse(c, x, y + r * 0.62, r * 0.92, r * 0.34); c.fill();

  const g = c.createRadialGradient(x - r * 0.34, y - r * 0.40, r * 0.10, x, y, r);
  g.addColorStop(0, C.ballLit);
  g.addColorStop(0.55, C.ballMid);
  g.addColorStop(1, C.ballShade);
  c.fillStyle = g;
  ellipse(c, x, y, r, r); c.fill();

  c.fillStyle = C.ballSpeck;
  for (const s of SPECKS) { ellipse(c, x + s.x * r, y + s.y * r, s.r * r, s.r * r); c.fill(); }

  c.fillStyle = 'rgba(255,255,255,0.75)';
  ellipse(c, x - r * 0.32, y - r * 0.38, r * 0.20, r * 0.15); c.fill();
  c.restore();
}

/** The roaming x3 badge, over whichever target it is marking this throw. */
export function drawMultiplier(c, targetId, pulse) {
  const p = targetPoint(targetId);
  const w = 0.115 * DW * (1 + pulse * 0.07);
  const h = 0.050 * DW * (1 + pulse * 0.07);
  // The reference parks the badge right on top of its target and happily covers the number
  // underneath. It gets away with that because its rings are further apart than ours; here the
  // stack is tight enough that a centred badge hides the very number it is pointing at. So a CUP
  // (which has clear air above it) keeps the reference's placement, and a RING gets it beside the
  // stack instead - on the right, where the ball queue never is.
  const cup = targetId.startsWith('100');
  const x = cup ? p.x : p.x + p.r + w * 0.5 + 2;
  const y = p.y - (cup ? h * 1.20 : 0);

  c.save();
  c.translate(x, y);
  c.beginPath();
  c.roundRect(-w / 2, -h / 2, w, h, h * 0.42);
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.fill();
  c.beginPath();
  c.roundRect(-w / 2 + 2.5, -h / 2 + 2.5, w - 5, h - 5, h * 0.34);
  const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, C.multLit);
  g.addColorStop(1, C.mult);
  c.fillStyle = g;
  c.fill();
  c.fillStyle = '#fff';
  c.font = `800 ${Math.round(h * 0.62)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('x3', 0, h * 0.03);
  c.restore();
}

/** The score callout: gold starburst + the value, at the hole it was scored in.
 *  `t` is 0..1 through the popup's life. */
export function drawPopup(c, targetId, text, t) {
  const p = targetPoint(targetId);
  const rise = 0.045 * DH * t;
  const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
  const pop = t < 0.22 ? t / 0.22 : 1;
  const size = 0.072 * DW * (0.5 + pop * 0.5);

  c.save();
  c.globalAlpha = Math.max(0, alpha);
  c.translate(p.x, p.y - rise - 0.018 * DH);

  // Starburst.
  c.save();
  c.rotate(t * 0.9);
  c.fillStyle = C.gold;
  c.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rr = (i % 2 ? 0.44 : 1) * size * 1.85 * pop;
    const fn = i ? 'lineTo' : 'moveTo';
    c[fn](Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
  c.restore();

  c.font = `800 ${Math.round(size)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = Math.max(3, size * 0.20);
  c.strokeStyle = C.popInk;
  c.lineJoin = 'round';
  c.strokeText(text, 0, 0);
  c.fillStyle = C.pop;
  c.fillText(text, 0, 0);
  c.restore();
}

/** Balls still to throw, queued on the left rail as in the reference. */
export function drawQueue(c, n) {
  const r = 0.030 * DW;
  for (let i = 0; i < Math.min(n, 9); i++) {
    drawBall(c, 0.045 * DW, (0.60 + i * 0.043) * DH, r);
  }
}

/** The aim/power guide shown while a flick is in progress. OUR OWN ADDITION - the reference never
 *  shows its input at all (SPEC.md, "What it does NOT show"), and a throw with no feedback is a
 *  guess rather than a skill. Deliberately drawn ON the lane, so reading it does not pull the
 *  player's eye off the board. */
export function drawAimGuide(c, power, aim) {
  const p = Math.max(0, Math.min(1, power));
  const a = Math.max(-1, Math.min(1, aim));
  c.save();
  c.globalAlpha = 0.85;

  // Predicted path: the same lateral drift the engine will apply, so the guide never lies.
  c.strokeStyle = 'rgba(255,255,255,0.55)';
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

  // Power bar, up the left side of the lane.
  const barH = 0.20 * DH, barW = 0.050 * DW;
  const bx = 0.135 * DW, by = 0.955 * DH - barH;
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.beginPath(); c.roundRect(bx, by, barW, barH, barW / 2); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2;
  c.beginPath(); c.roundRect(bx, by, barW, barH, barW / 2); c.stroke();
  const fill = c.createLinearGradient(0, by + barH, 0, by);
  fill.addColorStop(0, '#5FD08A');
  fill.addColorStop(0.6, C.gold);
  fill.addColorStop(1, '#FF6A2B');
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(bx + 3, by + barH - (barH - 6) * p - 3, barW - 6, (barH - 6) * p, (barW - 6) / 2);
  c.fill();
  c.restore();
}

export default { DW, DH, sc, laneY, laneHalf, lanePoint, targetPoint, layoutFor, drawAlley, drawBall, drawMultiplier, drawPopup, drawQueue, drawAimGuide };
