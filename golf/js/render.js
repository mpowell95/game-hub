// golf/js/render.js - the top-down course view: the tilemap, the ball and its shadow, the aim
// ladder, and the camera. Canvas only; every readout is DOM (see ui.js).
//
// THE MAP IS PAINTED ONCE, not per frame. buildMap() rasterises the whole hole into an offscreen
// canvas at MAP_PPY pixels per yard; each frame blits the visible rectangle of it. That is what
// makes a course of arbitrary polygon complexity cost the same as one drawImage, and it is why
// point-in-polygon per shot (holes.js) is affordable - it happens once per stroke, never per frame.
//
// The chunky 16-bit look is free from the same decision: the map is rasterised at a LOW resolution
// and blitted with smoothing off, so every course pixel is several screen pixels and nothing
// tweens smoothly (golf-reference-spec.md §15.2, "everything animates in whole pixels").

import { polyOf, treesOf, greenBox, bboxOf } from './holes.js';

/** Course pixels per yard in the offscreen map. Low on purpose: this IS the pixel size. */
export const MAP_PPY = 2.4;

/** How wide a slice of the hole the player sees, in yards. A fairway is ~30 yds across, so 70
 *  frames the corridor plus its rough with room to see a ball pushed offline. */
export const VIEW_W_YDS = 70;

// Measured off a native reference frame (§15.1) where the source says so; the rest are ours,
// chosen to sit in the same 16-bit family.
export const PALETTE = {
  water: '#248cef',            // [MEASURED] 9.5 % of the frame
  waterEdge: '#4aa3f2',        // the lighter shoreline band
  fairwayA: '#b0cb46',         // [MEASURED]
  fairwayB: '#a0bd3c',         // the mow stripe. The measured pair (#aec944 / #b0cb46) is two
                               // values apart and reads as flat at this pixel size, so the darker
                               // stripe is widened deliberately. Narrow it back if it reads busy.
  lightRough: '#85a330',       // [MEASURED]
  heavyRough: '#6e812b',       // [MEASURED] deep shadow green
  green: '#a8d95e',
  greenEdge: '#93c74e',
  tee: '#bcd76a',
  sand: '#f0e4c8',             // [OBSERVED]
  sandDot: '#e2d2ae',
  treeCanopy: '#2c4718',
  treeRim: '#1d3110',
  path: '#6b7a63',
  tick: '#5c8038',             // the green's slope read
  aim: '#e02424',
  aimRisk: '#ff5a1f',
  ball: '#ffffff',
  shadow: '#3b4a2a',
  pin: '#e01b1b',
  pinPole: '#f4f4f4',
};

const FILL = {
  fairway: PALETTE.fairwayA,
  lightRough: PALETTE.lightRough,
  heavyRough: PALETTE.heavyRough,
  green: PALETTE.green,
  tee: PALETTE.tee,
  water: PALETTE.water,
  fairwayBunker: PALETTE.sand,
  greensideBunker: PALETTE.sand,
  trees: '#4a6b28',            // the woods FLOOR; the canopies are drawn on top of it
};

function tracePoly(ctx, poly, toPx) {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const [x, y] = toPx(p[0], p[1]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Rasterise a whole hole. Returns { canvas, ppy, minX, minY, w, h }. */
export function buildMap(hole) {
  const b = hole.bounds;
  const w = Math.ceil((b.maxX - b.minX) * MAP_PPY);
  const h = Math.ceil((b.maxY - b.minY) * MAP_PPY);
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cv.getContext('2d');
  // World y runs UP the hole; canvas y runs down. The flip lives here and nowhere else.
  const toPx = (x, y) => [(x - b.minX) * MAP_PPY, (b.maxY - y) * MAP_PPY];

  ctx.fillStyle = FILL[hole.base] || PALETTE.heavyRough;
  ctx.fillRect(0, 0, w, h);

  for (const s of hole.surfaces) {
    const poly = polyOf(s, hole);
    ctx.save();
    tracePoly(ctx, poly, toPx);
    ctx.fillStyle = FILL[s.kind] || PALETTE.heavyRough;
    ctx.fill();

    if (s.kind === 'fairway') {
      // Mown in vertical stripes of two alternating greens (§11). Clipped to the fairway so the
      // stripes end where the mower did.
      ctx.clip();
      const bb = bboxOf(poly);
      const stripe = 7 * MAP_PPY;                      // ~7 yards, a mower's width
      ctx.fillStyle = PALETTE.fairwayB;
      const [x0] = toPx(bb.minX, 0);
      const [x1] = toPx(bb.maxX, 0);
      for (let x = x0, i = 0; x < x1; x += stripe, i++) if (i % 2) ctx.fillRect(x, 0, stripe, h);
    } else if (s.kind === 'water') {
      // Flat two-tone water with a lighter shoreline band.
      ctx.save(); ctx.clip();
      ctx.strokeStyle = PALETTE.waterEdge;
      ctx.lineWidth = 3 * MAP_PPY * 0.6;
      tracePoly(ctx, poly, toPx); ctx.stroke();
      ctx.restore();
    } else if (s.kind === 'fairwayBunker' || s.kind === 'greensideBunker') {
      // Dithered speckle in the sand.
      ctx.clip();
      const bb = bboxOf(poly);
      ctx.fillStyle = PALETTE.sandDot;
      for (let yy = bb.minY; yy < bb.maxY; yy += 1.4) {
        for (let xx = bb.minX; xx < bb.maxX; xx += 1.4) {
          if (((Math.round(xx) + Math.round(yy)) & 3) !== 0) continue;
          const [px, py] = toPx(xx, yy);
          ctx.fillRect(px, py, MAP_PPY, MAP_PPY);
        }
      }
    } else if (s.kind === 'green') {
      ctx.strokeStyle = PALETTE.greenEdge;
      ctx.lineWidth = MAP_PPY * 1.2;
      tracePoly(ctx, poly, toPx); ctx.stroke();
    }
    ctx.restore();
  }

  for (const d of hole.decor || []) {
    tracePoly(ctx, d.poly, toPx);
    ctx.fillStyle = PALETTE.path;
    ctx.fill();
  }

  // THE SLOPE TICKS ARE GENERATED FROM `green.slope`, never hand-drawn. If the art and the grid
  // can disagree, the read lies to the player, and a putting green that lies is worse than one
  // with no read at all (golf/CLAUDE.md, "The green and its slope grid").
  const gb = greenBox(hole);
  const sl = hole.green.slope;
  ctx.strokeStyle = PALETTE.tick;
  ctx.lineWidth = Math.max(1, MAP_PPY * 0.5);
  ctx.save();
  tracePoly(ctx, hole.green.poly, toPx);
  ctx.clip();
  for (let r = 0; r < sl.rows; r++) {
    for (let c = 0; c < sl.cols; c++) {
      const g = sl.cells[r * sl.cols + c];
      const cx = gb.minX + ((c + 0.5) * (gb.maxX - gb.minX)) / sl.cols;
      const cy = gb.minY + ((r + 0.5) * (gb.maxY - gb.minY)) / sl.rows;
      const [ax, ay] = toPx(cx, cy);
      const [bx, by] = toPx(cx + g[0] * 3.2, cy + g[1] * 3.2);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }
  ctx.restore();

  // Trees last: chunky dark canopies with a darker rim, drawn over whatever they stand on.
  for (const t of treesOf(hole)) {
    const type = hole.treeTypes[t.type];
    const [px, py] = toPx(t.x, t.y);
    ctx.beginPath(); ctx.arc(px, py, type.canopy * MAP_PPY, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.treeCanopy; ctx.fill();
    ctx.lineWidth = Math.max(1, MAP_PPY * 0.7); ctx.strokeStyle = PALETTE.treeRim; ctx.stroke();
  }

  return { canvas: cv, ppy: MAP_PPY, minX: b.minX, minY: b.minY, maxY: b.maxY, w, h };
}

/** The camera: what world point sits at the centre of the view, and how many px a yard is. */
export function makeCamera(hole, viewW, viewH) {
  const ppy = viewW / VIEW_W_YDS;
  const halfW = viewW / 2 / ppy;
  const halfH = viewH / 2 / ppy;
  const b = hole.bounds;
  return {
    ppy, halfW, halfH,
    x: hole.tee[0], y: hole.tee[1],
    clamp() {
      const spanX = b.maxX - b.minX;
      this.x = spanX <= halfW * 2 ? (b.minX + b.maxX) / 2
        : Math.min(b.maxX - halfW, Math.max(b.minX + halfW, this.x));
      this.y = Math.min(b.maxY - halfH, Math.max(b.minY + halfH, this.y));
    },
  };
}

/** Draw one frame. `st` is the whole view state; this function reads it and never writes it. */
export function drawFrame(ctx, map, hole, cam, st) {
  const { width: W, height: H } = ctx.canvas;
  const dpr = st.dpr || 1;
  const viewW = W / dpr;
  const viewH = H / dpr;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  // World -> screen. One place, used by everything below.
  const sx = (x) => (x - cam.x) * cam.ppy + viewW / 2;
  const sy = (y) => (cam.y - y) * cam.ppy + viewH / 2;

  const srcX = (cam.x - cam.halfW - map.minX) * map.ppy;
  const srcY = (map.maxY - (cam.y + cam.halfH)) * map.ppy;
  const srcW = cam.halfW * 2 * map.ppy;
  const srcH = cam.halfH * 2 * map.ppy;
  ctx.fillStyle = PALETTE.heavyRough;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.drawImage(map.canvas, srcX, srcY, srcW, srcH, 0, 0, viewW, viewH);

  // --- the pin ---------------------------------------------------------------
  const px = sx(hole.pin[0]);
  const py = sy(hole.pin[1]);
  if (!st.holed) {
    ctx.fillStyle = PALETTE.pinPole;
    ctx.fillRect(Math.round(px) - 1, Math.round(py) - 22, 2, 22);
    ctx.fillStyle = PALETTE.pin;
    ctx.beginPath();
    ctx.moveTo(Math.round(px) + 1, Math.round(py) - 22);
    ctx.lineTo(Math.round(px) + 13, Math.round(py) - 17);
    ctx.lineTo(Math.round(px) + 1, Math.round(py) - 12);
    ctx.closePath(); ctx.fill();
  }
  // The cup is always drawn: it is where the ball has to go, and it must not vanish with the flag.
  ctx.fillStyle = '#2c3a1e';
  ctx.beginPath(); ctx.arc(px, py, Math.max(2.5, 0.12 * cam.ppy * 2), 0, Math.PI * 2); ctx.fill();

  // --- the aim ladder (§21.1) ------------------------------------------------
  // Dot N is where the ball LANDS at 25/50/75/100 % of the club's distance from this lie; dot 5
  // marks the over-swing risk band, and the line turns red past dot 4. Their spacing is the
  // label - nothing on screen names them.
  if (st.aimDots && st.aimDots.length && !st.hideAim) {
    const cos = Math.cos(st.aimRad);
    const sin = Math.sin(st.aimRad);
    const at = (d) => [sx(st.ball[0] + sin * d), sy(st.ball[1] + cos * d)];
    const last = st.aimDots[st.aimDots.length - 2];
    ctx.lineWidth = 2;
    ctx.strokeStyle = PALETTE.aim;
    ctx.beginPath();
    let [lx, ly] = at(0); ctx.moveTo(lx, ly);
    [lx, ly] = at(last.at); ctx.lineTo(lx, ly); ctx.stroke();
    ctx.strokeStyle = PALETTE.aimRisk;
    ctx.beginPath();
    [lx, ly] = at(last.at); ctx.moveTo(lx, ly);
    [lx, ly] = at(st.aimDots[st.aimDots.length - 1].at); ctx.lineTo(lx, ly); ctx.stroke();
    for (const d of st.aimDots) {
      const [dx, dy] = at(d.at);
      ctx.fillStyle = d.risk ? PALETTE.aimRisk : PALETTE.aim;
      const s = d.risk ? 5 : 6;
      ctx.fillRect(Math.round(dx) - s / 2, Math.round(dy) - s / 2, s, s);
    }
  } else if (st.puttLine && !st.hideAim) {
    // On the green the ladder becomes smaller dots along the putt's line (§4).
    const cos = Math.cos(st.aimRad);
    const sin = Math.sin(st.aimRad);
    ctx.fillStyle = PALETTE.aim;
    for (let d = 0.6; d <= st.puttLine; d += 0.7) {
      const dx = sx(st.ball[0] + sin * d);
      const dy = sy(st.ball[1] + cos * d);
      ctx.fillRect(Math.round(dx) - 1.5, Math.round(dy) - 1.5, 3, 3);
    }
  }

  // --- the ball, and its shadow ---------------------------------------------
  // ONE white pixel, with a separate dark pixel for its shadow offset below it. The GAP BETWEEN
  // THEM IS THE ENTIRE HEIGHT MODEL - there is no arc line, no trail, no dotted trajectory and no
  // height bar (§9.1). It is cheap, it reads perfectly, and it is the single most transferable
  // trick in the reference.
  if (!st.holed) {
    const bx = Math.round(sx(st.ball[0]));
    const by = Math.round(sy(st.ball[1]));
    const lift = Math.round((st.height || 0) * cam.ppy * 0.55);
    if (lift > 1) {
      ctx.fillStyle = PALETTE.shadow;
      ctx.fillRect(bx - 2, by - 2, 4, 4);
    }
    ctx.fillStyle = PALETTE.ball;
    ctx.fillRect(bx - 3, by - lift - 3, 6, 6);
  }

  ctx.restore();
}
