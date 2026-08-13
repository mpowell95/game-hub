// skeeball/js/render.js - every pixel of the machine. Pure drawing: hand it a context, a layout,
// a board and a scene, it paints. It owns no state, no timers and no input.
//
// THE LOOK IS THE CLASSIC MACHINE Matt attached on 2026-08-12 (reference/skeeball/SPEC.md, the
// 2026-08-12 section): teal walls and lane, WHITE tube rings, glossy yellow rails, black guard
// tubes over khaki netting, an LED BALL/SCORE marquee, and the neighbouring machines visible at
// the frame edges - a row in an arcade. The warm cream-and-wood look this file used to draw was
// a DIFFERENT machine skin; do not bring it back on `classic`.
//
// ONE PROJECTION, SHARED WITH THE PHYSICS. `proj(x, y, z)` maps physics.js's world metres to the
// design box, and every part of the machine is drawn THROUGH it from the same geometry the
// simulation collides with (js/boards.js). The ball is drawn at the simulation's own positions
// through the same function, so the ball and the machine cannot disagree - there is no separate
// "animation geometry" anywhere. Camera constants were solved numerically against the reference
// screenshot's measured fractions (the SPEC table); re-derive them if the geometry moves.
//
// The design box is DW x DH; layoutFor() scales it to the screen, "contain" and centred.

import { BALL_R, planeCoords } from './physics.js';
import { machineFor } from './game.js';

export const DW = 480;
export const DH = 1000;

// --- the camera (solved against SPEC fractions; see header) --------------------------------
const CAM = { f: 1830, ze: -3.3, ye: 1.99, phi: 0.006, YC: -112.2 };

/** World metres -> design px. `zc` is camera depth, kept for sizing (ball radius etc). */
export function proj(x, y, z) {
  const dy = y - CAM.ye, dz = z - CAM.ze;
  const yc = dy * Math.cos(CAM.phi) - dz * Math.sin(CAM.phi);
  const zc = dz * Math.cos(CAM.phi) + dy * Math.sin(CAM.phi);
  return { x: DW / 2 + (CAM.f * x) / zc, y: CAM.YC - (CAM.f * yc) / zc, zc };
}

/** The ball's on-screen radius at a world position. */
export const ballR = (zc) => (CAM.f * BALL_R) / Math.max(0.5, zc);

export function layoutFor(cssW, cssH) {
  const scale = Math.min(cssW / DW, cssH / DH);
  return { scale, ox: (cssW - DW * scale) / 2, oy: (cssH - DH * scale) / 2, w: cssW, h: cssH };
}

/** How far the ball turns per metre it travels: the plain rolling relation. */
export const spinPerM = 1 / BALL_R;

// Neighbouring machines' visual pitch. Closer than a physical cabinet, deliberately: the app
// itself crowds the row so the neighbours' rings peek in at the frame edges, and that framing
// is part of the look. Scenery only - the simulation's world stops at this machine's walls.
const NEIGHBOR_PITCH = 1.15;

const MARQ_H = 78;

// --- small helpers ---------------------------------------------------------------------------

function ellipse(c, x, y, rx, ry) {
  c.beginPath(); c.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); c.closePath();
}

/** A ring's circle on the board plane (optionally lifted `s` along the normal, radius scaled),
 *  as a projected path. Parametric through proj, so the drawn curve IS the physics curve. */
function ringPath(c, M, ring, radius, s, PJ) {
  const N = 40;
  c.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const w = M.world(ring.c[0] + radius * Math.cos(a), ring.c[1] + radius * Math.sin(a), s);
    const p = PJ(w.x, w.y, w.z);
    if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
  }
  c.closePath();
}

/** Projected centre of a ring's mouth. */
function ringCentre(M, ring, PJ, s = 0) {
  const w = M.world(ring.c[0], ring.c[1], s);
  return PJ(w.x, w.y, w.z);
}

// --- the machine -------------------------------------------------------------------------------

/**
 * Everything static: neighbours, walls, netting, tubes, board, lane, rails, marquee frame.
 * Cached by the UI into an offscreen canvas and blitted per frame; only the ball, badge, popup,
 * queue and the marquee DIGITS are drawn on top.
 */
export function drawMachine(c, board) {
  const P = board.palette;
  c.save();
  c.beginPath(); c.rect(0, 0, DW, DH); c.clip();
  c.fillStyle = '#101314';
  c.fillRect(0, 0, DW, DH);

  // Neighbours first, so the centre machine overlaps them. Same drawing, offset in world x.
  // The CENTRE machine's cups and basin band are NOT here: they are drawn per frame by
  // drawProps, split around the ball so a rolling ball passes BEHIND the lower rings and in
  // front of the higher ones - the z-order is what makes the basin read as a place.
  drawAlley(c, board, -NEIGHBOR_PITCH);
  drawAlley(c, board, NEIGHBOR_PITCH);
  drawAlley(c, board, 0, true);

  drawMarqueeFrame(c, board);
  c.restore();
}

/** One machine of the row at world-x offset `xOff`. `noProps` leaves the cups and basin band
 *  to drawProps (the centre machine's dynamic z-ordered layer). */
function drawAlley(c, board, xOff, noProps) {
  const P = board.palette;
  const M = machineFor(board.id);
  const PJ = (x, y, z) => proj(x + xOff, y, z);

  // Key projected anchors.
  const lipY = PJ(0, M.lipH, M.rampZ1).y;                    // where the lane meets the cabinet
  const wallL = PJ(-0.72, 0.4, 2.9).x, wallR = PJ(0.72, 0.4, 2.9).x;

  // --- the teal back wall, marquee to lane lip.
  const wg = c.createLinearGradient(0, MARQ_H, 0, lipY);
  wg.addColorStop(0, P.wallDark);
  wg.addColorStop(0.35, P.wall);
  wg.addColorStop(1, P.wallDark);
  c.fillStyle = wg;
  c.fillRect(wallL, MARQ_H, wallR - wallL, lipY - MARQ_H);

  // --- the SKEE-BALL arch + badge on the wall.
  drawLogo(c, P, (wallL + wallR) / 2, 180, (wallR - wallL) * 0.62);

  // --- netting panels + black guard tubes flanking the board.
  const bigRing = M.rings.find((r) => r.basin) || M.rings[M.rings.length - 1];
  const boardL = PJ(-(bigRing.R + bigRing.T) - 0.045, 0.4, 2.9).x;
  const boardR = PJ((bigRing.R + bigRing.T) + 0.045, 0.4, 2.9).x;
  drawNetting(c, P, wallL + 6, 96, boardL - (wallL + 6), lipY - 110);
  drawNetting(c, P, boardR, 96, (wallR - 6) - boardR, lipY - 110);
  drawGuardTubes(c, P, wallL, boardL, lipY, false);
  drawGuardTubes(c, P, boardR, wallR, lipY, true);

  // --- the board: basin, rings, drains.
  drawBoard(c, board, M, PJ, noProps);

  // --- the maroon borders between machines (over the netting edges).
  for (const bx of [-0.75, 0.75]) {
    const top = PJ(bx, 0.9, 3.4), bot = PJ(bx, 0, -0.4);
    const w0 = 7, w1 = 26;
    const g = c.createLinearGradient(top.x, 0, top.x + 30, 0);
    g.addColorStop(0, P.border);
    g.addColorStop(1, '#3A1114');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(top.x - w0, MARQ_H);
    c.lineTo(top.x + w0, MARQ_H);
    c.lineTo(bot.x + w1, DH);
    c.lineTo(bot.x - w1, DH);
    c.closePath();
    c.fill();
    c.strokeStyle = P.borderTrim;
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(top.x, MARQ_H); c.lineTo(bot.x, DH); c.stroke();
  }

  // --- the lip/hump where the lane climbs to the cabinet.
  const lipHalf = PJ(0.30, M.lipH, M.rampZ1).x - PJ(0, M.lipH, M.rampZ1).x;
  const lipCx = PJ(0, M.lipH, M.rampZ1).x;
  const lg = c.createLinearGradient(0, lipY - 10, 0, lipY + 14);
  lg.addColorStop(0, P.lip);
  lg.addColorStop(1, P.laneDark);
  c.fillStyle = lg;
  c.beginPath();
  c.moveTo(lipCx - lipHalf, lipY + 12);
  c.quadraticCurveTo(lipCx, lipY - 10, lipCx + lipHalf, lipY + 12);
  c.lineTo(lipCx + lipHalf, lipY + 2);
  c.quadraticCurveTo(lipCx, lipY - 18, lipCx - lipHalf, lipY + 2);
  c.closePath();
  c.fill();

  // --- the cabinet DECK between the rails and the borders: dark teal, so the space beside the
  // lane reads as machine rather than as a hole in the world.
  const zF = M.rampZ1 - 0.02, zN = -0.35;
  for (const side of [-1, 1]) {
    const a = PJ(side * (M.laneHW + 0.02), 0, zF), b = PJ(side * 0.75, 0, zF);
    const a2 = PJ(side * (M.laneHW + 0.02), 0, zN), b2 = PJ(side * 0.75, 0, zN);
    const g = c.createLinearGradient(a.x, 0, b.x, 0);
    g.addColorStop(0, P.laneDark);
    g.addColorStop(1, '#15221F');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(b2.x, b2.y); c.lineTo(a2.x, a2.y);
    c.closePath(); c.fill();
  }

  // --- the lane: teal, one-point perspective, centre seam.
  const fl = PJ(-M.laneHW, 0.0, zF), fr = PJ(M.laneHW, 0.0, zF);
  const nl = PJ(-M.laneHW, 0.0, zN), nr = PJ(M.laneHW, 0.0, zN);
  const laneG = c.createLinearGradient(0, fl.y, 0, DH);
  laneG.addColorStop(0, P.lane);
  laneG.addColorStop(1, P.laneDark);
  c.fillStyle = laneG;
  c.beginPath();
  c.moveTo(fl.x, fl.y); c.lineTo(fr.x, fr.y); c.lineTo(nr.x, nr.y); c.lineTo(nl.x, nl.y);
  c.closePath(); c.fill();
  c.strokeStyle = P.laneSeam;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(PJ(0, 0, zF).x, PJ(0, 0, zF).y);
  c.lineTo(PJ(0, 0, zN).x, PJ(0, 0, zN).y);
  c.stroke();

  // --- the glossy yellow rails, crown stripe and all.
  for (const side of [-1, 1]) drawRail(c, P, M, PJ, side, zF, zN);
}

/** One side rail: outer face, glossy top, pale crown stripe - projected quads. */
function drawRail(c, P, M, PJ, side, zF, zN) {
  const xIn = side * M.laneHW;
  const xOut = side * (M.laneHW + 0.13);
  const H = 0.06;
  const q = (x, y, z) => PJ(x, y, z);
  const inF = q(xIn, H, zF), inN = q(xIn, H, zN);
  const outF = q(xOut, H * 0.7, zF), outN = q(xOut, H * 0.7, zN);
  const baseF = q(xOut, 0, zF), baseN = q(xOut, 0, zN);

  // Outer face (dark underside).
  c.fillStyle = P.railDark;
  c.beginPath();
  c.moveTo(outF.x, outF.y); c.lineTo(outN.x, outN.y); c.lineTo(baseN.x, baseN.y); c.lineTo(baseF.x, baseF.y);
  c.closePath(); c.fill();

  // Top face, glossy yellow.
  const g = c.createLinearGradient(0, inF.y, 0, inN.y);
  g.addColorStop(0, P.rail);
  g.addColorStop(0.5, P.railLit);
  g.addColorStop(1, P.rail);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(inF.x, inF.y); c.lineTo(inN.x, inN.y); c.lineTo(outN.x, outN.y); c.lineTo(outF.x, outF.y);
  c.closePath(); c.fill();

  // The pale stripe along the crown.
  const sF = q(side * (M.laneHW + 0.038), H * 0.96, zF), sN = q(side * (M.laneHW + 0.038), H * 0.96, zN);
  c.strokeStyle = P.railStripe;
  c.lineWidth = Math.max(2, Math.abs(sN.x - sF.x) * 0.012 + 2.5);
  c.beginPath(); c.moveTo(sF.x, sF.y); c.lineTo(sN.x, sN.y); c.stroke();
}

/** The board: basin interior, drains, the big ring band, and every cup - all from the same
 *  geometry the simulation collides with, through the same projection. */
function drawBoard(c, board, M, PJ, noProps) {
  const P = board.palette;
  const basin = M.rings.find((r) => r.basin);

  // Basin interior: slightly deeper teal so the big ring reads as a dish - still clearly the
  // machine's own colour, never a black pit.
  if (basin) {
    ringPath(c, M, basin, basin.R, 0, PJ);
    const cc = ringCentre(M, basin, PJ);
    const g = c.createRadialGradient(cc.x, cc.y + 14, 12, cc.x, cc.y, 135);
    g.addColorStop(0, P.wall);
    g.addColorStop(0.75, P.wallDark);
    g.addColorStop(1, 'rgba(18,34,30,1)');
    c.fillStyle = g;
    c.fill();
  }

  // Drain slots: the 10's real mouths, drawn dark exactly where the floor is missing. The
  // outer trough fades at its ends so it reads as a slot in the deck, not a black banner.
  for (const d of M.drains) {
    c.beginPath();
    const corners = [[d.u0, d.w0], [d.u1, d.w0], [d.u1, d.w1], [d.u0, d.w1]];
    let x0 = 1e9, x1 = -1e9;
    corners.forEach(([u, w], i) => {
      const wp = M.world(u, w, 0);
      const p = PJ(wp.x, wp.y, wp.z);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
    });
    c.closePath();
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(9,13,12,0.15)');
    g.addColorStop(0.18, P.hole);
    g.addColorStop(0.82, P.hole);
    g.addColorStop(1, 'rgba(9,13,12,0.15)');
    c.fillStyle = d.insideOf ? 'rgba(8,13,12,0.80)' : g;
    if (d.insideOf && basin) { c.save(); ringPath(c, M, basin, basin.R, 0, PJ); c.clip(); c.fill(); c.restore(); }
    else c.fill();
  }

  if (noProps) return;

  // Neighbours bake their props straight in; the centre machine's come from drawProps.
  if (basin) { drawBasinBand(c, P, M, basin, PJ, 'all'); }
  const cups = M.rings.filter((r) => !r.basin).slice().sort((a, b) => b.c[1] - a.c[1]);
  for (const r of cups) drawCup(c, P, M, r, PJ);
}

/**
 * The centre machine's PROPS - the basin band and the cups - drawn per frame in two phases so
 * the ball sits in the world instead of floating over it: props LOWER on the board than the
 * ball are in front of it (drawn after), higher ones behind. `ball` is the ball's world
 * position or null.
 */
export function drawProps(c, board, phase, ball) {
  const M = machineFor(board.id);
  const P = board.palette;
  const basin = M.rings.find((r) => r.basin);

  let ballW = -Infinity;                       // no ball: everything draws in 'behind'
  if (ball) {
    const pc = planeCoords(M, { x: ball.wx, y: ball.wy, z: ball.wz });
    // Only a ball ON the board (past the ramp, near the plane) gets occluded; in flight it is
    // above everything.
    ballW = (ball.wz > M.rampZ0 && pc.s < 0.20) ? pc.w : -Infinity;
  }

  const items = [];
  if (basin) {
    items.push({ w: Infinity, draw: () => drawBasinBand(c, P, M, basin, proj, 'top') });
    items.push({ w: 0.13, draw: () => drawBasinBand(c, P, M, basin, proj, 'bottom') });
  }
  for (const r of M.rings) {
    if (!r.basin) items.push({ w: r.c[1], draw: () => drawCup(c, P, M, r, proj) });
  }
  items.sort((a, b) => b.w - a.w);             // farthest first, always
  for (const it of items) {
    const inFront = it.w < ballW - 0.03;
    if ((phase === 'front') === inFront || phase === 'all') it.draw();
  }
}

/** The big ring: a fat white band around the basin, "10" on its bottom face. `half` clips to
 *  the top or bottom arc so the two can straddle the ball in z-order. */
function drawBasinBand(c, P, M, basin, PJ, half) {
  const cc = ringCentre(M, basin, PJ, basin.h * 0.5);
  c.save();
  if (half === 'top') { c.beginPath(); c.rect(0, 0, DW, cc.y); c.clip(); }
  if (half === 'bottom') { c.beginPath(); c.rect(0, cc.y, DW, DH); c.clip(); }

  c.lineWidth = 30;
  c.strokeStyle = 'rgba(0,0,0,0.30)';
  ringPath(c, M, basin, basin.R + basin.T * 0.5, 0, PJ);
  c.save(); c.translate(0, 5); c.stroke(); c.restore();
  const g = c.createLinearGradient(0, cc.y - 110, 0, cc.y + 110);
  g.addColorStop(0, P.ringShade);
  g.addColorStop(0.4, P.ring);
  g.addColorStop(0.85, P.ringLit);
  c.strokeStyle = g;
  c.lineWidth = 27;
  ringPath(c, M, basin, basin.R + basin.T * 0.5, basin.h * 0.5, PJ);
  c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.18)';
  c.lineWidth = 5;
  ringPath(c, M, basin, basin.R - basin.T * 0.4, basin.h, PJ);
  c.stroke();

  if (half !== 'top') {
    const b = M.world(0, basin.c[1] - basin.R - basin.T * 0.5, basin.h * 0.5);
    const bp = PJ(b.x, b.y, b.z);
    c.fillStyle = P.ink;
    c.font = '800 26px ui-rounded, "Trebuchet MS", system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('10', bp.x, bp.y - 1);
  }
  c.restore();
}

/**
 * One cup: an upright white TUBE standing on the board - the reference's own prop (its cups
 * read as tall cylinders with thin slit mouths and the number on the front face). The tube
 * stands exactly on the scoring hole, and the slit is the true opening radius seen edge-on, so
 * the drawn mouth can only ever UNDER-promise the capture area, never oversell it.
 */
function drawCup(c, P, M, r, PJ) {
  const HGT = r.points >= 100 ? 0.115 : 0.10;   // tube height, world-up
  const base = M.world(r.c[0], r.c[1], 0);
  const topY = base.y + HGT;
  const R2 = r.R + r.T + 0.008;                 // the tube's outer radius

  // A horizontal circle at height `y`, radius `radius`, centred on the tube's axis.
  const circ = (radius, y) => {
    c.beginPath();
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const p = PJ(base.x + radius * Math.cos(a), y, base.z + radius * Math.sin(a));
      if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
    }
    c.closePath();
  };
  const pTop = PJ(base.x, topY, base.z);
  const rx = PJ(base.x + R2, topY, base.z).x - pTop.x;

  // Soft shadow at the foot.
  const pBase = PJ(base.x, base.y, base.z);
  c.fillStyle = 'rgba(0,0,0,0.22)';
  ellipse(c, pBase.x + 2, pBase.y + 3, rx * 1.1, rx * 0.30);
  c.fill();

  // The tube's side: near half of the top rim down to the base.
  const bl = PJ(base.x - R2, base.y, base.z), br = PJ(base.x + R2, base.y, base.z);
  c.beginPath();
  for (let i = 0; i <= 18; i++) {
    const a = Math.PI + (i / 18) * Math.PI;     // the near (lower-screen) half of the top rim
    const p = PJ(base.x + R2 * Math.cos(a), topY, base.z + R2 * Math.sin(a) * -1);
    if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
  }
  c.lineTo(br.x, br.y);
  c.lineTo(bl.x, bl.y);
  c.closePath();
  const sg = c.createLinearGradient(bl.x, 0, br.x, 0);
  sg.addColorStop(0, P.ringShade);
  sg.addColorStop(0.28, P.ring);
  sg.addColorStop(0.55, P.ringLit);
  sg.addColorStop(1, P.ringShade);
  c.fillStyle = sg;
  c.fill();

  // The top: white rim ring, then the slit - THE EXACT OPENING RADIUS, edge-on.
  circ(R2, topY);
  const tg = c.createLinearGradient(0, pTop.y - rx * 0.4, 0, pTop.y + rx * 0.4);
  tg.addColorStop(0, P.ringLit);
  tg.addColorStop(1, P.ring);
  c.fillStyle = tg;
  c.fill();
  c.strokeStyle = P.ringDeep;
  c.lineWidth = 1.25;
  c.stroke();
  circ(r.R, topY);
  const og = c.createLinearGradient(0, pTop.y - rx * 0.25, 0, pTop.y + rx * 0.25);
  og.addColorStop(0, '#050707');
  og.addColorStop(0.75, P.hole);
  og.addColorStop(1, '#39423D');
  c.fillStyle = og;
  c.fill();

  // The number, on the tube's front face.
  const lp = PJ(base.x, base.y + HGT * 0.44, base.z - R2);
  c.fillStyle = P.ink;
  c.font = `800 ${Math.round(Math.max(11, rx * (r.points >= 100 ? 0.62 : 0.76)))}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(r.points), lp.x, lp.y);
}

/** The arched SKEE-BALL lettering with its badge - the wall's own branding. */
function drawLogo(c, P, cx, cy, width) {
  const text = 'SKEE-BALL';
  const R = width * 1.15;
  const arc = width / R;
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `900 ${Math.round(width * 0.16)}px "Trebuchet MS", system-ui, sans-serif`;
  for (let i = 0; i < text.length; i++) {
    const k = i / (text.length - 1) - 0.5;
    const a = k * arc;
    const x = cx + Math.sin(a) * R;
    const y = cy + R * 0.5 - Math.cos(a) * R * 0.5 - Math.abs(k) * width * 0.01;
    c.save();
    c.translate(x, y);
    c.rotate(a * 0.5);
    c.lineWidth = Math.max(3, width * 0.028);
    c.strokeStyle = P.logoDark;
    c.strokeText(text[i], 0, 0);
    c.fillStyle = P.logo;
    c.fillText(text[i], 0, 0);
    c.restore();
  }
  // The badge under the arch.
  c.font = `700 ${Math.round(width * 0.055)}px "Trebuchet MS", system-ui, sans-serif`;
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.beginPath();
  c.roundRect(cx - width * 0.24, cy + width * 0.075, width * 0.48, width * 0.085, 6);
  c.fill();
  c.fillStyle = P.lip;
  c.fillText('THE ORIGINAL ALLEY GAME', cx, cy + width * 0.075 + width * 0.045);
  c.restore();
}

/** Khaki diamond netting in a panel. */
function drawNetting(c, P, x, y, w, h) {
  if (w < 8) return;
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(x, y, w, h);
  c.strokeStyle = P.net;
  c.globalAlpha = 0.55;
  c.lineWidth = 1.5;
  const step = 13;
  for (let d = -h; d < w + h; d += step) {
    c.beginPath(); c.moveTo(x + d, y); c.lineTo(x + d + h, y + h); c.stroke();
    c.beginPath(); c.moveTo(x + d, y); c.lineTo(x + d - h, y + h); c.stroke();
  }
  c.restore();
}

/** The two black flexible guard tubes arcing down in front of the netting. */
function drawGuardTubes(c, P, x0, x1, bottomY, mirror) {
  const span = x1 - x0;
  if (span < 10) return;
  for (const k of [0.42, 0.72]) {
    const tx = x0 + span * (mirror ? 1 - k : k);
    const bow = span * 0.16 * (mirror ? 1 : -1);
    for (const [w, col] of [[11, P.tube], [3.5, P.tubeLit]]) {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(tx, 92);
      c.quadraticCurveTo(tx + bow, (92 + bottomY) / 2, tx + bow * 0.3, bottomY - 8);
      c.stroke();
    }
  }
}

// --- the marquee -------------------------------------------------------------------------------

/** The static marquee frame: black panel, gold trim, roundels, BALL/SCORE labels. */
function drawMarqueeFrame(c, board) {
  const P = board.palette;
  c.fillStyle = '#000';
  c.fillRect(0, 0, DW, MARQ_H + 6);
  c.fillStyle = P.marquee;
  c.beginPath(); c.roundRect(8, 6, DW - 16, MARQ_H - 10, 8); c.fill();
  c.strokeStyle = P.marqueeTrim;
  c.lineWidth = 3;
  c.beginPath(); c.roundRect(8, 6, DW - 16, MARQ_H - 10, 8); c.stroke();
  // Gold rail under the marquee.
  const g = c.createLinearGradient(0, MARQ_H - 2, 0, MARQ_H + 8);
  g.addColorStop(0, P.marqueeTrim);
  g.addColorStop(1, '#7A5E20');
  c.fillStyle = g;
  c.fillRect(0, MARQ_H - 2, DW, 9);

  // Roundel logos either side: white disc, double ring, a little flying ball.
  for (const x of [96, DW - 96]) {
    c.fillStyle = '#F4EFE2';
    ellipse(c, x, MARQ_H / 2 - 2, 24, 24); c.fill();
    c.strokeStyle = P.logo;
    c.lineWidth = 3;
    ellipse(c, x, MARQ_H / 2 - 2, 19, 19); c.stroke();
    c.fillStyle = P.logo;
    ellipse(c, x + 5, MARQ_H / 2 - 8, 5.5, 5.5); c.fill();
    c.strokeStyle = P.logoDark;
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(x - 2, MARQ_H / 2 + 2, 11, Math.PI * 1.15, Math.PI * 1.85);
    c.stroke();
  }

  // Labels; the digits are dynamic (drawMarquee).
  c.textAlign = 'center';
  c.font = '800 15px "Trebuchet MS", system-ui, sans-serif';
  c.fillStyle = P.ledBallLabel;
  c.fillText('BALL', DW / 2 - 60, 28);
  c.fillStyle = P.ledScoreLabel;
  c.fillText('SCORE', DW / 2 + 60, 28);
}

/** Seven-segment digit, LED style, with faint off-segments. */
function seg7(c, x, y, h, digit, color) {
  const ON = {
    0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
    5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcfgd',
  }[digit] || '';
  const w = h * 0.62, t = h * 0.13;
  const S = {
    a: [x, y, w, t], g: [x, y + h / 2 - t / 2, w, t], d: [x, y + h - t, w, t],
    f: [x, y + t * 0.6, t, h / 2 - t], b: [x + w - t, y + t * 0.6, t, h / 2 - t],
    e: [x, y + h / 2 + t * 0.4, t, h / 2 - t], c: [x + w - t, y + h / 2 + t * 0.4, t, h / 2 - t],
  };
  for (const [k, [sx, sy, sw, sh]] of Object.entries(S)) {
    c.fillStyle = ON.includes(k) ? color : 'rgba(255,255,255,0.06)';
    c.beginPath(); c.roundRect(sx, sy, sw, sh, t * 0.4); c.fill();
  }
}

/** The dynamic marquee readout: BALL and SCORE digits. */
export function drawMarquee(c, board, ballNo, score) {
  const P = board.palette;
  const h = 26;
  c.save();
  seg7(c, DW / 2 - 60 - h * 0.31, 36, h, Math.max(0, Math.min(9, ballNo | 0)), P.ledBall);
  const s = String(Math.max(0, score | 0));
  const w = h * 0.62 + 6;
  const x0 = DW / 2 + 60 - (s.length * w) / 2 + 3;
  for (let i = 0; i < s.length; i++) seg7(c, x0 + i * w, 36, h, Number(s[i]), P.ledScore);
  c.restore();
}

// --- the moving parts ---------------------------------------------------------------------------

/** The ball's markings, as points on a UNIT SPHERE rather than a flat pattern - 3D so the ball
 *  ROLLS instead of spinning like a sticker. */
const SPECKS = (() => {
  const out = []; let s = 1337;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 22; i++) {
    const z = 1 - 2 * ((i + 0.5) / 22);
    const rr = Math.sqrt(Math.max(0, 1 - z * z));
    const a = i * 2.39996 + rnd() * 0.5;
    out.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, z, r: 0.10 + rnd() * 0.05 });
  }
  return out;
})();

/**
 * The ball: rust-brown wood, the reference clip's own (SPEC.md 2026-08-12). `spin` in radians
 * about the horizontal axis. The wood-grain flecks rotate; the specular highlight does NOT -
 * it is a reflection of the room, so it stays where the light is while the surface turns.
 */
export function drawBall(c, x, y, r, spin = 0) {
  if (r <= 0.4) return;
  c.save();
  const g = c.createRadialGradient(x - r * 0.34, y - r * 0.40, r * 0.10, x, y, r);
  g.addColorStop(0, '#C98A57');
  g.addColorStop(0.55, '#8F5330');
  g.addColorStop(1, '#4E2612');
  c.fillStyle = g;
  ellipse(c, x, y, r, r); c.fill();

  const cs = Math.cos(spin), sn = Math.sin(spin);
  c.fillStyle = 'rgba(52,24,8,0.38)';
  for (const s of SPECKS) {
    const py = s.y * cs - s.z * sn;
    const pz = s.y * sn + s.z * cs;
    if (pz <= 0.06) continue;
    c.globalAlpha = Math.min(1, pz * 3.2);
    ellipse(c, x + s.x * r, y + py * r, s.r * r * pz, s.r * r * pz); c.fill();
  }
  c.globalAlpha = 1;
  c.fillStyle = 'rgba(255,240,220,0.65)';
  ellipse(c, x - r * 0.32, y - r * 0.38, r * 0.20, r * 0.15); c.fill();
  c.restore();
}

/** Ball shadow on the lane, fading with height. */
export function drawBallShadow(c, wx, wy, wz) {
  if (wz > 2.45 || wy > 0.5) return;
  const p = proj(wx, 0.001, wz);
  const r = ballR(p.zc);
  c.save();
  c.globalAlpha = Math.max(0, 0.34 - wy * 0.6);
  c.fillStyle = '#000';
  ellipse(c, p.x, p.y, r * 0.95, r * 0.32);
  c.fill();
  c.restore();
}

/** Where a ring sits on screen - the badge and popup anchor. */
export function targetPoint(board, id) {
  const M = machineFor(board.id);
  const r = M.rings.find((z) => z.id === id);
  if (!r) {
    const w = M.world(0, 0.05, 0);
    const p = proj(w.x, w.y, w.z);
    return { x: p.x, y: p.y, r: 20 };
  }
  // Anchor at the TUBE TOP the renderer draws (world-up), not the board-level hole, so the x3
  // badge hangs over the cup instead of sitting on its face.
  const base = M.world(r.c[0], r.c[1], 0);
  const topY = base.y + (r.points >= 100 ? 0.115 : 0.10);
  const p = proj(base.x, topY, base.z);
  const pe = proj(base.x + r.R + r.T, topY, base.z);
  return { x: p.x, y: p.y, r: Math.abs(pe.x - p.x) };
}

export function drawMultiplier(c, board, targetId, pulse) {
  const p = targetPoint(board, targetId);
  const w = 0.105 * DW * (1 + pulse * 0.07);
  const h = 0.046 * DW * (1 + pulse * 0.07);
  const x = p.x, y = p.y - p.r - h * 0.85;
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

/**
 * The score callout: a small number that rises and fades where the ball actually finished.
 * Deliberately quiet - the marquee is where the score lives (see skeeball/CLAUDE.md; the
 * starburst-and-vanish era is not coming back).
 */
export function drawPopup(c, at, text, t) {
  const p = { x: at.x, y: Math.max(at.y, MARQ_H + 40) };
  const rise = 0.055 * DH * t;
  const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  const size = 0.05 * DW;
  c.save();
  c.globalAlpha = Math.max(0, alpha);
  c.translate(p.x, p.y - rise - 0.022 * DH);
  c.font = `800 ${Math.round(size)}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = Math.max(2.5, size * 0.26);
  c.strokeStyle = 'rgba(10,10,10,0.85)'; c.lineJoin = 'round';
  c.strokeText(text, 0, 0);
  c.fillStyle = '#FFE45C';
  c.fillText(text, 0, 0);
  c.restore();
}

/** The remaining balls, racked in the return tray at the bottom right (the left corner belongs
 *  to the balls-left HUD text). */
export function drawQueue(c, n) {
  const r = 13;
  for (let i = 0; i < Math.min(n, 9); i++) {
    drawBall(c, DW - 26 - (i % 3) * (r * 1.9), DH - 28 - Math.floor(i / 3) * (r * 1.8), r, i * 1.7);
  }
}

/**
 * The aim guide: a dashed line up the lane showing WHERE the throw is pointed. Direction only -
 * power is decided at the instant of release, and a gauge that is wrong at the only moment that
 * matters is worse than no gauge (see skeeball/CLAUDE.md history).
 */
export function drawAimGuide(c, dir) {
  c.save();
  c.globalAlpha = 0.8;
  c.strokeStyle = 'rgba(255,250,235,0.62)';
  c.lineWidth = 3.5;
  c.setLineDash([10, 9]);
  c.beginPath();
  for (let i = 0; i <= 24; i++) {
    const d = 0.15 + (i / 24) * 2.1;
    const p = proj(Math.sin(dir) * d, 0.001, 0.02 + Math.cos(dir) * d);
    if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
  }
  c.stroke();
  c.restore();
}

// --- the picker's machine art (chains + padlock kept from the previous build) -------------------

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

function drawPadlock(c, cx, cy, w) {
  const h = w * 0.86;
  const shackleR = w * 0.30;
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.55)';
  c.shadowBlur = w * 0.18;
  c.shadowOffsetY = w * 0.06;
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

/** The picker's artwork: the REAL machine, drawn by the real renderer, scaled into the box.
 *  A locked machine is dimmed, chained and padlocked (the reference's own treatment). */
export function drawThumb(c, board, w, h, locked) {
  const CAB = 0.56 * DH;                       // marquee + wall + board + lip
  c.save();
  c.beginPath(); c.rect(0, 0, w, h); c.clip();
  c.fillStyle = '#101314';
  c.fillRect(0, 0, w, h);
  const scale = Math.min(w / DW, h / CAB);
  c.translate((w - DW * scale) / 2, (h - CAB * scale) / 2);
  c.scale(scale, scale);
  c.beginPath(); c.rect(0, 0, DW, CAB); c.clip();
  drawMachine(c, board);
  drawProps(c, board, 'all', null);
  drawMarquee(c, board, 9, 0);
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
  DW, DH, proj, ballR, spinPerM, layoutFor, targetPoint,
  drawMachine, drawProps, drawMarquee, drawBall, drawBallShadow, drawMultiplier, drawPopup, drawQueue,
  drawAimGuide, drawThumb,
};
