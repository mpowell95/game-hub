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
  fringe: '#96c04a',
  tee: '#bcd76a',
  sand: '#f0e4c8',             // [OBSERVED]
  sandDot: '#e2d2ae',
  treeCanopy: '#2c4718',
  treeRim: '#1d3110',
  path: '#6b7a63',
  tick: '#5c8038',             // the green's slope read
  aim: '#e02424',
  aimLine: '#2f6fe0',          // the line is BLUE up to the 100 % dot (Matt, 2026-09-04)
  aimRisk: '#e02424',          // ...and RED past it. Every DOT is red, whatever the line is doing.
  ball: '#ffffff',
  shadow: '#3b4a2a',
  pin: '#e01b1b',
  pinPole: '#f4f4f4',
  // The two ends of the setup screen's backdrop. It is chrome rather than course, but it belongs
  // to the theme: a desert course behind a forest-green wash reads as the wrong game.
  setupA: '#33501d',
  setupB: '#4a6b28',
};

/** THE COURSE THEME. `PALETTE` above is Pine Valley's, and it stays the module's default so
 *  nothing that only wants `PALETTE.pin` has to know a theme exists.
 *
 *  A theme is a PALETTE OVERLAY and nothing else - no new surface kinds, no new lie rows, no
 *  second renderer. That is deliberate and it is what makes a second course cheap: Red Mesa's
 *  desert is the same nine surfaces Pine Valley uses, painted in sun-bleached tan and terracotta
 *  with the base surface reading as desert floor rather than as deep rough. A theme that needed
 *  its own surface kind would need its own row in the lie table, its own validator entry and its
 *  own line in every test - for a colour.
 *
 *  `treeFill` is keyed by the TREE TYPE'S NAME, which is why the type tables name their species.
 *  An unknown name falls back to the theme's default canopy, so adding a specimen is a data
 *  change, not a renderer change. */
export const THEMES = {
  pine: PALETTE,
  desert: {
    ...PALETTE,
    water: '#2ba3dc',
    waterEdge: '#63c1ea',
    fairwayA: '#a3bd57',         // irrigated turf, yellower than parkland grass
    fairwayB: '#95b04b',
    lightRough: '#87954a',
    heavyRough: '#b06a35',       // THE DESERT FLOOR. This is `base` on every hole out here.
    green: '#a6d861',
    greenEdge: '#8fc44e',
    fringe: '#93bd50',
    tee: '#bcd76a',
    sand: '#f7efdc',             // whiter than the desert, so a bunker still reads as a bunker
    sandDot: '#e8dcc0',
    treeCanopy: '#3f6b34',
    treeRim: '#26431f',
    path: '#8a7a63',
    treesFloor: '#a4642f',       // scrub: the desert floor, a shade deeper
    setupA: '#8a4a24',
    setupB: '#b06a35',
  },
};

const TREE_FILL = {
  saguaro: ['#3f7a3a', '#22421f'],
  paloverde: ['#7f9a3f', '#4c6224'],
  boulder: ['#8b7f72', '#4d453d'],
};

/** The paint colour for every surface kind, in one theme. */
function fillsFor(pal) {
  return {
    fairway: pal.fairwayA,
    fringe: pal.fringe,
    lightRough: pal.lightRough,
    heavyRough: pal.heavyRough,
    green: pal.green,
    tee: pal.tee,
    water: pal.water,
    fairwayBunker: pal.sand,
    greensideBunker: pal.sand,
    trees: pal.treesFloor || '#4a6b28',   // the woods FLOOR; canopies are drawn on top of it
  };
}

export function paletteFor(theme) { return THEMES[theme] || PALETTE; }

function tracePoly(ctx, poly, toPx) {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const [x, y] = toPx(p[0], p[1]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Rasterise a whole hole. Returns { canvas, ppy, minX, minY, w, h }. */
export function buildMap(hole, theme) {
  const pal = paletteFor(theme);
  const FILL = fillsFor(pal);
  const b = hole.bounds;
  const w = Math.ceil((b.maxX - b.minX) * MAP_PPY);
  const h = Math.ceil((b.maxY - b.minY) * MAP_PPY);
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cv.getContext('2d');
  // World y runs UP the hole; canvas y runs down. The flip lives here and nowhere else.
  const toPx = (x, y) => [(x - b.minX) * MAP_PPY, (b.maxY - y) * MAP_PPY];

  ctx.fillStyle = FILL[hole.base] || pal.heavyRough;
  ctx.fillRect(0, 0, w, h);

  for (const s of hole.surfaces) {
    const poly = polyOf(s, hole);
    ctx.save();
    tracePoly(ctx, poly, toPx);
    ctx.fillStyle = FILL[s.kind] || pal.heavyRough;
    ctx.fill();

    if (s.kind === 'fairway') {
      // Mown in vertical stripes of two alternating greens (§11). Clipped to the fairway so the
      // stripes end where the mower did.
      ctx.clip();
      const bb = bboxOf(poly);
      const stripe = 7 * MAP_PPY;                      // ~7 yards, a mower's width
      ctx.fillStyle = pal.fairwayB;
      const [x0] = toPx(bb.minX, 0);
      const [x1] = toPx(bb.maxX, 0);
      for (let x = x0, i = 0; x < x1; x += stripe, i++) if (i % 2) ctx.fillRect(x, 0, stripe, h);
    } else if (s.kind === 'water') {
      // Flat two-tone water with a lighter shoreline band.
      ctx.save(); ctx.clip();
      ctx.strokeStyle = pal.waterEdge;
      ctx.lineWidth = 3 * MAP_PPY * 0.6;
      tracePoly(ctx, poly, toPx); ctx.stroke();
      ctx.restore();
    } else if (s.kind === 'fairwayBunker' || s.kind === 'greensideBunker') {
      // Dithered speckle in the sand.
      ctx.clip();
      const bb = bboxOf(poly);
      ctx.fillStyle = pal.sandDot;
      for (let yy = bb.minY; yy < bb.maxY; yy += 1.4) {
        for (let xx = bb.minX; xx < bb.maxX; xx += 1.4) {
          if (((Math.round(xx) + Math.round(yy)) & 3) !== 0) continue;
          const [px, py] = toPx(xx, yy);
          ctx.fillRect(px, py, MAP_PPY, MAP_PPY);
        }
      }
    } else if (s.kind === 'green') {
      ctx.strokeStyle = pal.greenEdge;
      ctx.lineWidth = MAP_PPY * 1.2;
      tracePoly(ctx, poly, toPx); ctx.stroke();
    }
    ctx.restore();
  }

  for (const d of hole.decor || []) {
    tracePoly(ctx, d.poly, toPx);
    ctx.fillStyle = pal.path;
    ctx.fill();
  }

  // THE SLOPE TICKS ARE GENERATED FROM `green.slope`, never hand-drawn. If the art and the grid
  // can disagree, the read lies to the player, and a putting green that lies is worse than one
  // with no read at all (golf/CLAUDE.md, "The green and its slope grid").
  const gb = greenBox(hole);
  const sl = hole.green.slope;
  ctx.strokeStyle = pal.tick;
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
    const [fill, rim] = TREE_FILL[type.name] || [pal.treeCanopy, pal.treeRim];
    const [px, py] = toPx(t.x, t.y);
    // A saguaro is drawn at its TRUNK, not its canopy: it is a pillar, and a 1.8 yd disc is what
    // the ball actually has to miss. Everything else is drawn at the canopy it blocks with, so
    // what is painted is what stops the ball.
    const r = (type.name === 'saguaro' ? Math.max(type.trunk * 1.5, 1.2) : type.canopy) * MAP_PPY;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = Math.max(1, MAP_PPY * 0.7); ctx.strokeStyle = rim; ctx.stroke();
    if (type.name === 'saguaro') {                       // two arms, so it reads as a cactus
      ctx.fillStyle = fill;
      ctx.fillRect(px - r * 2.1, py - r * 0.4, r * 1.3, r * 0.8);
      ctx.fillRect(px + r * 0.8, py - r * 1.4, r * 0.8, r * 1.3);
    }
  }

  return { canvas: cv, ppy: MAP_PPY, minX: b.minX, minY: b.minY, maxY: b.maxY, w, h, pal };
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
  const pal = map.pal || PALETTE;
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
  ctx.fillStyle = pal.heavyRough;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.drawImage(map.canvas, srcX, srcY, srcW, srcH, 0, 0, viewW, viewH);

  // --- the pin ---------------------------------------------------------------
  const px = sx(hole.pin[0]);
  const py = sy(hole.pin[1]);
  if (!st.holed) {
    ctx.fillStyle = pal.pinPole;
    ctx.fillRect(Math.round(px) - 1, Math.round(py) - 22, 2, 22);
    ctx.fillStyle = pal.pin;
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
  if (!st.hideAim && ((st.aimDots && st.aimDots.length) || st.puttLine)) {
    const cos = Math.cos(st.aimRad);
    const sin = Math.sin(st.aimRad);
    const at = (d) => [sx(st.ball[0] + sin * d), sy(st.ball[1] + cos * d)];
    // On the green the ladder is the PUTTER's range, and like the reference's it runs straight
    // past the cup - the dots are what you gauge power against, so stopping them at the hole left
    // nothing to read.
    const dots = (st.aimDots && st.aimDots.length)
      ? st.aimDots
      : [0.25, 0.5, 0.75, 1.0].map((f) => ({ at: st.puttLine * f, risk: false }));
    const full = dots.find((d) => !d.risk && d.at === Math.max(...dots.filter((x) => !x.risk).map((x) => x.at)));
    const fullAt = full ? full.at : dots[dots.length - 1].at;
    const endAt = dots[dots.length - 1].at;

    // THE LINE IS BLUE UP TO THE 100 % DOT AND RED PAST IT. Matt's call, 2026-09-04.
    ctx.lineWidth = 2;
    ctx.strokeStyle = pal.aimLine;
    let [lx, ly] = at(0); ctx.beginPath(); ctx.moveTo(lx, ly);
    [lx, ly] = at(fullAt); ctx.lineTo(lx, ly); ctx.stroke();
    if (endAt > fullAt) {
      ctx.strokeStyle = pal.aimRisk;
      ctx.beginPath();
      [lx, ly] = at(fullAt); ctx.moveTo(lx, ly);
      [lx, ly] = at(endAt); ctx.lineTo(lx, ly); ctx.stroke();
    }
    // EVERY dot is red, on either side of 100 %.
    for (const d of dots) {
      const [dx, dy] = at(d.at);
      const sz = d.risk ? 5 : 7;
      ctx.fillStyle = '#5c0d0d';
      ctx.fillRect(Math.round(dx) - sz / 2 - 1, Math.round(dy) - sz / 2 - 1, sz + 2, sz + 2);
      ctx.fillStyle = pal.aim;
      ctx.fillRect(Math.round(dx) - sz / 2, Math.round(dy) - sz / 2, sz, sz);
    }
  }

  // --- the golfer -----------------------------------------------------------
  // A small pixel figure stands at the ball: white cap with a black outline, skin-tone face, grey
  // polo and trousers, a dark club down to its head. Measured off the reference at ~75x100 of a
  // 1206-wide frame, so about 6 % of the screen's width. It is hidden while the ball is away.
  if (st.golfer && !st.holed) {
    const gx = Math.round(sx(st.ball[0]));
    const gy = Math.round(sy(st.ball[1]));
    drawGolfer(ctx, gx, gy, Math.max(18, Math.min(34, viewW * 0.07)), st.swingPose || 0);
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
      ctx.fillStyle = pal.shadow;
      ctx.fillRect(bx - 2, by - 2, 4, 4);
    }
    ctx.fillStyle = pal.ball;
    ctx.fillRect(bx - 3, by - lift - 3, 6, 6);
  }

  ctx.restore();
}

/** The golfer, in whole pixels. `w` is the sprite's width; it is drawn standing to the LEFT of the
 *  ball with its feet on the ball's own ground line, so the ball is never hidden by it.
 *
 *  `pose` 0 is address; 1 and 2 are the backswing and the through-swing. The reference plays a
 *  real multi-pose animation as the camera starts to scroll - it is not a static sprite that
 *  vanishes - and the whole thing is four rectangles and a line, so there is no reason not to. */
export function drawGolfer(ctx, bx, by, w, pose) {
  const u = Math.max(1, Math.round(w / 8));          // one "pixel" of the sprite
  const x = bx - u * 6;                              // stand clear of the ball
  const y = by;
  const px = (cx, cy, cw, ch, fill) => { ctx.fillStyle = fill; ctx.fillRect(x + cx * u, y + cy * u, cw * u, ch * u); };

  // club: swings through three poses
  ctx.strokeStyle = '#1b1f14';
  ctx.lineWidth = Math.max(1.5, u * 0.7);
  ctx.beginPath();
  ctx.moveTo(x + 4 * u, y - 5 * u);
  if (pose === 1) ctx.lineTo(x - 1 * u, y - 11 * u);       // backswing, club up and behind
  else if (pose === 2) ctx.lineTo(x + 10 * u, y - 9 * u);  // through-swing, club up and ahead
  else ctx.lineTo(x + 7 * u, y - 0.2 * u);                 // address, club head at the ball
  ctx.stroke();

  px(1, -3, 4, 3, '#8e969e');        // trousers
  px(1, -7, 4, 4, '#e7ebef');        // polo
  px(1.5, -9.5, 3, 2.5, '#d9a06a');  // face
  px(0.5, -12, 5, 2.5, '#ffffff');   // cap
  px(0.5, -12, 5, 0.6, '#1b1f14');   // cap outline
  px(4.6, -11, 2, 0.9, '#ffffff');   // cap brim
}
