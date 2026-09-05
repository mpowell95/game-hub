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

import { polyOf, treesOf, greenBox, bboxOf, mulberry32 } from './holes.js';
// The cup's DRAWN size comes from the physics constant, never a copy of it: the whole point of the
// fix below is that the hole you see and the hole that captures are the same hole.
import { CUP_CAPTURE_YD } from './shot.js';

/** Course pixels per yard in the offscreen map. Low on purpose: this IS the pixel size. */
export const MAP_PPY = 2.4;

/** How wide a slice of the hole the player sees, in yards.
 *
 *  95 (Matt, 2026-09-04: "make the default view a little more zoomed out"). It was 70, which
 *  framed the fairway and its rough and almost nothing else - measured on Pine Valley 1 at
 *  393 x 852, the view was 152 yds deep, so a driver's landing area was off the top of the screen
 *  and two of the five aim dots had nowhere to be drawn. At 95 the view is 206 yds deep, the tree
 *  belts and the water down the left are both visible from the tee, and the map is still upscaled
 *  1.7x on screen (MAP_PPY is 2.4 px/yd) so the pixel-art look is untouched. Past about 164 the
 *  map would be DOWNscaled and start to shimmer; that is the real ceiling, not taste. */
/** The mow stripes, MEASURED off s1-tee frame 30: a 48 device px period at ~12.7 px/yd, split
 *  16 px dark to 32 px light. See PALETTE's fairway block for the colour half of the measurement. */
export const MOW_PERIOD_YD = 3.8;
/** Tree shadows, MEASURED off the same frame - see the block above the shadow pass in `buildMap`
 *  for the canopy/patch pairs these come from. The offset is a multiple of the tree's own HEIGHT;
 *  the radii are multiples of its canopy. */
export const SHADOW_LEN = 0.92;      // [MEASURED] yards left, per yard of tree height
export const SHADOW_DROP = 0.16;     // [MEASURED] yards down the hole, per yard of height
// The measured patches (180-241 x 102-123 px against a ~155 px crown) are each one or two trees'
// shadows already MERGED. Drawing every tree at the merged size and then merging them again turns
// a belt's shade into one flat haze across the fairway, which is not what the frame shows: the
// reference's band is a row of separate lumps with clean fairway between them. So the per-tree
// ellipse is a shade UNDER the crown, and the merge does the rest.
export const SHADOW_RX = 1.02;
export const SHADOW_RY = 0.62;
export const SHADOW_ALPHA = 0.15;    // [MEASURED] (124,151,63) / (155,177,92) = 0.85x

export const MOW_DARK_SHARE = 1 / 3;

export const VIEW_W_YDS = 95;

/** ...and how wide the view is ON THE GREEN.
 *
 *  A putt is measured in FEET. Reading a 6 ft putt across 95 yards of screen is reading it across
 *  2 % of the frame, and the break - one cup width over 20 ft - is then sub-pixel. The view has
 *  never tightened for putting; zooming the full-shot view out without this would have made every
 *  putt harder to read in exchange for a better tee shot. */
export const VIEW_W_GREEN_YDS = 34;

// Measured off a native reference frame (§15.1) where the source says so; the rest are ours,
// chosen to sit in the same 16-bit family.
export const PALETTE = {
  // WATER, MEASURED DOWN A COLUMN THROUGH A SHORELINE (2026-09-05, s1-tee frame 30, x=560). It is
  // not one blue and it does not meet the grass directly:
  //   the grass lip     (158,179,73) -> (175,177,103)   ~6 device px of pale grass
  //   the DIRT BANK     (117,58,56) -> (153,82,100)     ~12 px of red-brown
  //   the mud line      (56,42,33) -> (51,46,72)        ~6 px, nearly black
  //   then the water    (14,77,119) deep, (25,144,231) bright, (17,109,188) mid, in BANDS
  water: '#1990e7',            // [MEASURED] the bright ripple band
  waterBand: '#116cbc',        // [MEASURED] the mid band between ripples
  waterEdge: '#0e4d77',        // [MEASURED] the deep water hugging the shore
  bank: '#6b3330',             // [MEASURED] the red-brown dirt shoreline, a shade off the raw
                               // (117,58,56): at our scale the measured value reads hot against blue
  bankMud: '#38291f',          // [MEASURED] the near-black mud line at the water's lip
  // THE MOW STRIPES, RE-MEASURED 2026-09-05 off s1-tee frame 30 at 1:1, because Matt's read was
  // "too wide and too contrasty" and both halves of that measured true.
  //   the pair            (155,177,92) light / (148,171,83) dark - SEVEN levels apart, ~4 %
  //   the period          48 device px: 16 px of dark against 32 px of light
  // An earlier pass recorded #b0cb46/#a0bd3c as measured and then WIDENED the darker stripe on
  // purpose, reasoning that the real pair "reads as flat at this pixel size". It does not read as
  // flat, it reads as mown - and the widened pair was 16 levels apart on a 14 yd period, which is
  // 2.3x the contrast on 3.7x the width. Where the two readings disagree this one wins: it comes
  // off the same frame as the fairway geometry, the water column and the seam, so the whole course
  // is now sampled from one image rather than from three.
  fairwayA: '#9bb15c',         // [MEASURED] (155,177,92)
  fairwayB: '#94ab53',         // [MEASURED] (148,171,83) - the mow stripe
  lightRough: '#8aa348',       // [MEASURED] (138,163,72), the step outside the seam
  heavyRough: '#6e812c',       // [MEASURED] (110,129,44) deep shadow green
  green: '#a8d95e',
  greenEdge: '#93c74e',
  fringe: '#96c04a',
  tee: '#bcd76a',
  sand: '#f0e4c8',             // [OBSERVED]
  sandDot: '#e2d2ae',
  treeCanopy: '#2c4718',
  treeRim: '#1d3110',
  path: '#6b7a63',
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
    waterBand: '#1a86bc',
    bank: '#8a4a24',             // the arroyo's own banks are the desert floor, cut
    bankMud: '#4a3020',
    setupA: '#8a4a24',
    setupB: '#b06a35',
  },
};

const TREE_FILL = {
  saguaro: ['#3f7a3a', '#22421f'],
  paloverde: ['#7f9a3f', '#4c6224'],
  boulder: ['#8b7f72', '#4d453d'],
};

/** The paint colour for every surface kind, in one theme. Exported since 2026-09-05: the HUD's
 *  lie tile paints the surface itself and must use the same colour the ground is drawn in. */
export function fillsFor(pal) {
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

/** THE DARK SEAM WHERE TWO SURFACES MEET.
 *
 *  MEASURED (2026-09-05) by scanning a row straight across a fairway edge on the reference
 *  (s1-tee frame 30, y=1150, left to right out of the rough):
 *
 *      x 230-250   (110,129,44)   heavy rough
 *      x 252-256   (98,119,41)    A DARKER LINE, about 5 device px - darker than BOTH sides
 *      x 258-274   (117,144,58)   a step lighter
 *      x 276-280   (134,161,72)   another step
 *      x 282+      (154,177,92)   fairway
 *
 *  The line measures about 0.87x the rough's own brightness, so it is a DARKENING rather than a
 *  colour: that is why it is drawn as translucent black and not as a fourth green. One rule then
 *  covers every pair - sand against grass, water against grass, green against its collar - and it
 *  cannot be a shade that disagrees with the surfaces either side of it, because it is made of
 *  them. */
const SEAM_ALPHA = 0.16;                    // 0.84x, against the measured 0.87x
const SEAM_PX = 0.7;                        // in MAP_PPY units, so ~1.7 map px

/** Scattered grass tufts, the rough's own texture.
 *
 *  MEASURED off the reference at 1:1: the rough is a flat mid-olive with small `V`/`Y` tuft glyphs
 *  in a LIGHTER tint scattered sparsely across it - roughly one every 3.4 yards, each about
 *  0.65 yd across. They are not noise dots; they read as grass.
 *
 *  Seeded per surface, so the same hole grows the same grass on every device and in every test run
 *  - the same reason `expandBelt` is seeded. A pattern that reshuffled per load would make the
 *  course look subtly different every visit for no gain at all. */
function scatterTufts(ctx, bb, toPx, colour, seed) {
  const rnd = mulberry32(seed);
  const STEP = 3.4;                          // yards between tufts, before jitter
  const SIZE = 0.65;                         // the glyph's width in yards
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, MAP_PPY * 0.32);
  ctx.lineCap = 'butt';
  for (let y = bb.minY; y < bb.maxY; y += STEP) {
    for (let x = bb.minX; x < bb.maxX; x += STEP) {
      if (rnd() < 0.35) continue;            // not every cell, or it reads as a grid
      const jx = x + (rnd() - 0.5) * STEP;
      const jy = y + (rnd() - 0.5) * STEP;
      const [px, py] = toPx(jx, jy);
      const a = SIZE * MAP_PPY;
      // A `V`: two short strokes meeting at the bottom. Leaning a little, at random, so a field of
      // them does not read as a printed character.
      const lean = (rnd() - 0.5) * 0.5;
      ctx.beginPath();
      ctx.moveTo(px - a * 0.5 + lean * a, py - a);
      ctx.lineTo(px, py);
      ctx.lineTo(px + a * 0.5 + lean * a, py - a);
      ctx.stroke();
    }
  }
}

/** THE CANOPY'S SILHOUETTE: a union of circles, as [x, y, r] triples.
 *
 *  EVERY CIRCLE MUST FIT INSIDE `r` OF THE CENTRE. `shot.js`'s `treeHit` tests the ball against
 *  `type.canopy`, and the whole contract of this renderer is that what is painted is what stops the
 *  ball - a bump that stuck out past `r` would be a tree the ball flies straight through. That is
 *  why this is an exported pure function with a test rather than four literals inside a draw loop.
 *
 *  A cactus is one circle: it is a pillar, drawn at its trunk. */
export function treeShapes(px, py, r, cactus) {
  if (cactus) return [[px, py, r]];
  return [
    [px, py, r * 0.94],
    [px - r * 0.50, py + r * 0.32, r * 0.40],
    [px, py + r * 0.45, r * 0.42],
    [px + r * 0.50, py + r * 0.32, r * 0.40],
  ];
}

/** A lighter or darker version of a hex colour, as a fraction of its own brightness. */
function tintOf(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
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

  // The base's own texture, laid down before any surface is painted over it - which is what makes
  // this cheap: a tuft that lands where the fairway will be is simply covered up.
  if (hole.base === 'lightRough' || hole.base === 'heavyRough' || hole.base === 'trees') {
    scatterTufts(ctx, b, toPx, tintOf(FILL[hole.base] || pal.heavyRough, 1.18), (hole.n | 0) * 733 + 11);
  }

  for (const s of hole.surfaces) {
    const poly = polyOf(s, hole);
    ctx.save();
    tracePoly(ctx, poly, toPx);
    ctx.fillStyle = FILL[s.kind] || pal.heavyRough;
    ctx.fill();

    if (s.kind === 'fairway') {
      // Mown in vertical stripes of two alternating greens (§11). Clipped to the fairway so the
      // stripes end where the mower did.
      // MEASURED: a 48 device px period on the reference, 16 px dark against 32 px light. At its
      // 12.7 px/yd that is a 3.8 yd period - one narrow dark band every two and a half light ones,
      // not the even 7-on-7-off this used to draw.
      ctx.clip();
      const bb = bboxOf(poly);
      const period = MOW_PERIOD_YD * MAP_PPY;
      const dark = period * MOW_DARK_SHARE;
      ctx.fillStyle = pal.fairwayB;
      const [x0] = toPx(bb.minX, 0);
      const [x1] = toPx(bb.maxX, 0);
      for (let x = x0; x < x1; x += period) ctx.fillRect(x, 0, dark, h);
    } else if (s.kind === 'lightRough' || s.kind === 'heavyRough' || s.kind === 'trees') {
      ctx.clip();
      scatterTufts(ctx, bboxOf(poly), toPx, tintOf(FILL[s.kind] || pal.heavyRough, 1.18),
        (hole.n | 0) * 733 + s.kind.length * 97 + Math.round(bboxOf(poly).minX));
    } else if (s.kind === 'water') {
      // WATER IS BANDED, AND IT DOES NOT MEET THE GRASS DIRECTLY. See PALETTE's water block for the
      // column that was measured. Painted from the outside in: the dirt bank first, wide, so the
      // fill covers its inner half and leaves a shoreline; then the mud line; then the ripples.
      ctx.restore();
      ctx.strokeStyle = pal.bank;
      ctx.lineWidth = MAP_PPY * 2.4;
      tracePoly(ctx, poly, toPx); ctx.stroke();
      ctx.save();
      tracePoly(ctx, poly, toPx);
      // The BODY of the water is the mid band; the bright one is the ripple laid over it. Doing it
      // the other way round - which the first attempt did - turns a pond into a barcode, because
      // the bright tone then covers most of the surface.
      ctx.fillStyle = pal.waterBand; ctx.fill();
      ctx.clip();
      ctx.strokeStyle = pal.bankMud;
      ctx.lineWidth = MAP_PPY * 1.0;
      tracePoly(ctx, poly, toPx); ctx.stroke();
      ctx.strokeStyle = pal.waterEdge;
      ctx.lineWidth = MAP_PPY * 1.4;
      tracePoly(ctx, poly, toPx); ctx.stroke();
      // The ripples: wide, soft horizontal bands. Horizontal on purpose - it is a top-down view,
      // and a band that followed the shoreline would read as a contour map.
      //
      // THEY ARE DELIBERATELY FAINT. The measured column (bright / mid / bright, 6-18 px each)
      // was taken in SHALLOW water right at the shore, where the contrast is at its highest; a
      // band drawn at that strength across a whole pond reads as a barcode, which is exactly what
      // the first attempt looked like. Half alpha over a 10 yd period is the same rhythm without
      // the shout.
      const wb = bboxOf(poly);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = pal.water;
      for (let yy = wb.minY; yy < wb.maxY; yy += 10) {
        const [, py] = toPx(0, yy);
        ctx.fillRect(0, py - 3.4 * MAP_PPY, w, 3.4 * MAP_PPY);
      }
      ctx.globalAlpha = 1;
    } else if (s.kind === 'fairwayBunker' || s.kind === 'greensideBunker') {
      // Dithered speckle in the sand, and a BANK: the reference's bunkers have a stepped darker
      // rim a couple of art pixels wide inside their edge, which is what makes them read as a dish
      // rather than as a puddle of cream.
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
      ctx.strokeStyle = tintOf(pal.sandDot, 0.9);
      ctx.lineWidth = MAP_PPY * 1.6;
      tracePoly(ctx, poly, toPx); ctx.stroke();
    } else if (s.kind === 'green') {
      ctx.strokeStyle = pal.greenEdge;
      ctx.lineWidth = MAP_PPY * 1.2;
      tracePoly(ctx, poly, toPx); ctx.stroke();
    }
    ctx.restore();

    // THE SEAM, outside the clip so it lands on BOTH surfaces (see SEAM_ALPHA above). Water paints
    // its own dirt bank and does not want a black line on top of it.
    if (s.kind !== 'water') {
      ctx.strokeStyle = `rgba(0,0,0,${SEAM_ALPHA})`;
      ctx.lineWidth = MAP_PPY * SEAM_PX;
      tracePoly(ctx, poly, toPx); ctx.stroke();
    }
  }

  for (const d of hole.decor || []) {
    tracePoly(ctx, d.poly, toPx);
    ctx.fillStyle = pal.path;
    ctx.fill();
  }

  // THE SLOPE READ IS NOT IN THE MAP ANY MORE. It is drawn per frame, at screen resolution, by
  // `drawSlope` below - see its header for why a raster at MAP_PPY could not carry it.

  // TREE SHADOWS, MEASURED 2026-09-05 off s1-tee frame 30 by pairing isolated canopies against the
  // dark patches lying on the fairway beside them:
  //
  //   canopy (909,1221) -> patch (668,1244)     -241 px across, +23 down
  //   canopy (912,1409) -> patch (705,1450)     -207 px,        +41
  //   canopy (877,1510) -> patch (680,1558)     -197 px,        +48
  //
  // So the sun is low and off to the RIGHT and the shadow is thrown LEFT and a little DOWN the
  // hole. The patches measure 180-241 px wide by 102-123 tall against a ~155 px canopy, and their
  // average colour is (124,151,63) against the fairway's (155,177,92): 0.85x its brightness, a
  // flat darkening rather than a colour of its own. Ours had none at all, which is most of why a
  // belt read as stickers laid on grass rather than as trees standing in it.
  //
  // THE OFFSET FOLLOWS THE TREE'S OWN HEIGHT, not a fixed number of yards. ~210 px at 12.7 px/yd
  // is 16.5 yds, which is 0.92 of a pine's 18 yd `height` - and a shadow whose length ignores the
  // thing casting it makes a belt of mixed specimens look pasted on. It needs no new field:
  // `height` is already there, doing the canopy-clearance job.
  //
  // IT IS COMPOSITED IN ONE PASS at SHADOW_ALPHA, not drawn per tree. Two overlapping shadows at
  // 0.15 each would stack to 0.28 and a wood would come out blotched with its own darker seams;
  // the measurement says a flat 15 %, so the ellipses are drawn opaque onto their own layer and
  // that layer is laid down once.
  {
    const sh = document.createElement('canvas');
    sh.width = w; sh.height = h;
    const sc = sh.getContext('2d');
    sc.fillStyle = '#000';
    for (const t of treesOf(hole)) {
      const type = hole.treeTypes[t.type];
      const rr = (type.name === 'saguaro' ? Math.max(type.trunk * 1.5, 1.2) : type.canopy) * MAP_PPY;
      const [tx, ty] = toPx(t.x, t.y);
      sc.beginPath();
      sc.ellipse(tx - type.height * SHADOW_LEN * MAP_PPY, ty + type.height * SHADOW_DROP * MAP_PPY,
        rr * SHADOW_RX, rr * SHADOW_RY, 0, 0, Math.PI * 2);
      sc.fill();
    }
    ctx.save();
    ctx.globalAlpha = SHADOW_ALPHA;
    ctx.drawImage(sh, 0, 0);
    ctx.restore();
  }

  // (see `treeShapes` above for the silhouette)
  // TREES LAST, drawn over whatever they stand on.
  //
  // REBUILT 2026-09-05 FROM A 1:1 CROP OF THE REFERENCE. Ours was a flat disc with a slightly
  // darker rim; the original's canopy is four things at once, and all four are what make a tree
  // belt read as woodland rather than as a row of buttons:
  //
  //   - a HARD BLACK OUTLINE, not a dark-green rim. That key line is what holds a canopy together
  //     against grass at this pixel size, and it is the same trick the swing meter needs.
  //   - a MOTTLED two-tone canopy: measured (104,105,22) as the body against (146,152,18)
  //     highlights, scattered in clumps rather than dithered.
  //   - a highlight biased to the UPPER LEFT, so the whole belt is lit from one direction.
  //   - a SCALLOPED underside - the bottom of the canopy is a row of bumps, not an arc.
  //
  // The clumps are seeded from the tree's own position, so a belt is the same wood every load (the
  // same reason `expandBelt` is seeded) and two trees standing side by side are not identical.
  //
  // THE WHOLE WOOD IS DRAWN IN THREE PASSES, not tree by tree. Once belts overlap - which they now
  // do, because the reference's belt is one continuous mass rather than a row of crowns - a
  // per-tree loop paints tree B's black key straight over tree A's finished canopy, and the
  // mushroom ring this file already warns about comes back at every seam. Keys first, then every
  // canopy over all of them, then the clumps: one wood, one outline.
  const stand = treesOf(hole).map((t) => {
    const type = hole.treeTypes[t.type];
    const cactus = type.name === 'saguaro';
    const [px, py] = toPx(t.x, t.y);
    const r = (cactus ? Math.max(type.trunk * 1.5, 1.2) : type.canopy) * MAP_PPY;
    return { t, type, cactus, px, py, r, shapes: treeShapes(px, py, r, cactus) };
  });
  {
    const key = Math.max(1.2, MAP_PPY * 0.75);
    for (const s of stand) {
      const [, rim] = TREE_FILL[s.type.name] || [pal.treeCanopy, pal.treeRim];
      ctx.fillStyle = tintOf(rim, 0.45);
      for (const [cx, cy, cr] of s.shapes) { ctx.beginPath(); ctx.arc(cx, cy, cr + key, 0, Math.PI * 2); ctx.fill(); }
    }
    for (const s of stand) {
      const [fill] = TREE_FILL[s.type.name] || [pal.treeCanopy, pal.treeRim];
      ctx.fillStyle = fill;
      for (const [cx, cy, cr] of s.shapes) { ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  for (const st of stand) {
    const t = st.t;
    const type = st.type;
    const [fill, rim] = TREE_FILL[type.name] || [pal.treeCanopy, pal.treeRim];
    const px = st.px, py = st.py;
    // A saguaro is drawn at its TRUNK, not its canopy: it is a pillar, and a 1.8 yd disc is what
    // the ball actually has to miss. Everything else is drawn at the canopy it blocks with, so
    // what is painted is what stops the ball.
    const cactus = st.cactus;
    const r = st.r;
    const rnd = mulberry32(Math.round(t.x * 977) ^ Math.round(t.y * 31));

    // THE SILHOUETTE IS A UNION OF CIRCLES, and the black key is drawn UNDER it at a slightly
    // larger radius rather than stroked over it. Stroking a multi-arc path outlines every
    // sub-path, so the first attempt drew a black ring around each bump and the belt came out
    // looking like a row of mushrooms - visible in the very first screenshot of this pass.
    // The bumps stay INSIDE `r`, because what is painted has to be what stops the ball.
    const shapes = st.shapes;
    ctx.save();
    if (!cactus) {
      // The clumps, clipped to the canopy so nothing spills onto the grass.
      ctx.beginPath();
      for (const [cx, cy, cr] of shapes) { ctx.moveTo(cx + cr, cy); ctx.arc(cx, cy, cr, 0, Math.PI * 2); }
      ctx.clip();
      const hi = tintOf(fill, 1.35);
      const lo = tintOf(fill, 0.82);
      for (let i = 0; i < 8; i++) {
        // Biased upper-left: the light comes from there, so the highlights cluster there.
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * r * 0.8;
        const cx = px + Math.cos(a) * d - r * 0.1;
        const cy = py + Math.sin(a) * d - r * 0.1;
        ctx.fillStyle = (cx - px) + (cy - py) < 0 ? hi : lo;
        ctx.beginPath(); ctx.arc(cx, cy, r * (0.2 + rnd() * 0.16), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    if (cactus) {                                        // two arms, so it reads as a cactus
      ctx.fillStyle = fill;
      ctx.fillRect(px - r * 2.1, py - r * 0.4, r * 1.3, r * 0.8);
      ctx.fillRect(px + r * 0.8, py - r * 1.4, r * 0.8, r * 1.3);
    }
  }

  return { canvas: cv, ppy: MAP_PPY, minX: b.minX, minY: b.minY, maxY: b.maxY, w, h, pal };
}

/** The camera: what world point sits at the centre of the view, and how many px a yard is.
 *
 *  It keeps the ELEMENT's pixel size so it can re-derive its own scale: `setWidth(yds)` is how the
 *  view tightens on the green and opens back up for a full shot, without ui.js having to know the
 *  arithmetic or re-measure the canvas. */
export function makeCamera(hole, viewW, viewH, widthYds = VIEW_W_YDS) {
  const b = hole.bounds;
  const ppy = viewW / widthYds;
  const halfW = viewW / 2 / ppy;
  const halfH = viewH / 2 / ppy;
  return {
    viewW, viewH, widthYds,
    ppy, halfW, halfH,
    x: hole.tee[0], y: hole.tee[1],
    setWidth(yds) {
      this.widthYds = yds;
      this.ppy = this.viewW / yds;
      this.halfW = this.viewW / 2 / this.ppy;
      this.halfH = this.viewH / 2 / this.ppy;
    },
    // READS `this.halfW` / `this.halfH`, NOT THE CAPTURED LOCALS. It used to close over the
      // constructor's values, which was invisible while the camera's scale could never change -
      // and wrong the instant `setWidth` existed: tightening to 30 yds on the green left the clamp
      // still enforcing a 95-yd frame, so it dragged the view 30 yds off the ball and pinned the
      // pin off the top of the screen. Measured: cam.y clamped to 332 against a ball at 363.5.
    clamp() {
      const spanX = b.maxX - b.minX;
      this.x = spanX <= this.halfW * 2 ? (b.minX + b.maxX) / 2
        : Math.min(b.maxX - this.halfW, Math.max(b.minX + this.halfW, this.x));
      this.y = Math.min(b.maxY - this.halfH, Math.max(b.minY + this.halfH, this.y));
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
  // THE CUP IS DRAWN AT THE RADIUS THAT ACTUALLY CAPTURES, so what you see is what goes in.
  //
  // Matt: "the ball rolls over the hole without going in - and leaves a 1-3 ft putt after", and
  // separately "the hole needs to be a little larger. it's a tiny tiny dot right now that does not
  // get bigger when you zoom into the green". Those are one bug. Measured at the green view
  // (34 yds across a 393 px screen, 11.6 px/yd):
  //
  //     cup drawn      radius 2.8 px   (0.24 yd, and floored at 2.5 px so it did not scale)
  //     ball sprite    radius 3.0 px
  //     capture        radius 3.5 px   (CUP_CAPTURE_YD = 0.30 yd)
  //
  // The ball was BIGGER THAN THE HOLE. Two sprites that size visibly overlap out to about 0.52 yd
  // of centre separation, but capture needs 0.30 - so between those two numbers the ball plainly
  // covers the hole on screen, does not drop, and finishes one to three feet away. Exactly the
  // report. Drawing the cup at CUP_CAPTURE_YD closes the gap from the honest side: the hole is
  // bigger, it scales with the zoom, and a ball that looks like it went in did.
  //
  // A rim, because a flat disc at this size reads as a dot rather than a hole.
  const cupR = Math.max(2.5, CUP_CAPTURE_YD * cam.ppy);
  ctx.fillStyle = '#0f1508';
  ctx.beginPath(); ctx.arc(px, py, cupR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2c3a1e';
  ctx.beginPath(); ctx.arc(px, py, Math.max(1.5, cupR - 1.5), 0, Math.PI * 2); ctx.fill();

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

  // --- the green's slope read -----------------------------------------------
  drawSlope(ctx, hole, cam, sx, sy, pal);

  // --- the golfer -----------------------------------------------------------
  // A small pixel figure stands at the ball: white cap with a black outline, skin-tone face, grey
  // polo and trousers, a dark club down to its head. Measured off the reference at ~75x100 of a
  // 1206-wide frame, so about 6 % of the screen's width. It is hidden while the ball is away.
  if (st.golfer && !st.holed) {
    // `golferAt` is where the ball was AT ADDRESS, not where it is now. Drawing him at `st.ball`
    // made him slide down the fairway behind his own shot - see ui.js's _frame for the report.
    const anchor = st.golferAt || st.ball;
    const gx = Math.round(sx(anchor[0]));
    const gy = Math.round(sy(anchor[1]));
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

/** A darker shade of a colour, as a fraction of its own brightness. */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** THE GREEN'S SLOPE READ: one fixed-size CHEVRON per slope cell, pointing DOWNHILL, in a darker
 *  tint of the putting surface.
 *
 *  Matt: "all of the greens you've created have dots all over them. I think you mistook the arrows
 *  indicating slope from the example game for decoration."
 *
 *  He was right, and it was two separate mistakes:
 *
 *  1. OURS DREW A LINE SEGMENT WHOSE LENGTH WAS THE SLOPE MAGNITUDE. On real hole data that is 1 to
 *     4 px, so it rendered as a field of dots with no readable direction. MEASURED off the
 *     reference's putt frame at 1:1: the glyph is a FIXED 18 x 18 device px on a 96 x 96 px grid -
 *     0.19 of the spacing - and the direction is the whole of what it encodes.
 *  2. IT WAS RASTERISED INTO THE MAP at MAP_PPY (2.4 px/yd), where a 3.5 yd slope cell is 8.4 px and
 *     a faithful 0.19 glyph would be 1.6 px. There is no drawing that survives that. It is a screen
 *     -space overlay now, so it grows with the zoom - which is also when it is USED, since the
 *     camera tightens to 34 yds for a putt.
 *
 *  MEASURED COLOUR: the chevron is (94,114,48) against a green of (174,199,82) - about 57 % of the
 *  surface's own brightness in every channel. So it is derived from the palette rather than being a
 *  fourth green somebody has to keep in step.
 *
 *  A cell with no meaningful gradient gets NO glyph. An arrow has to point somewhere, and "flat" is
 *  a real thing for the read to say. */
export const SLOPE_TINT = 0.57;
/** The glyph's full width as a fraction of the grid spacing. MEASURED at 18-30 device px on a
 *  96 px grid - 0.19 to 0.31 depending on which way the chevron is turned, since a V spans wider
 *  than an L. Ours is one size, at the top of that range. */
export const SLOPE_GLYPH_FRAC = 0.30;
const SLOPE_MIN_PX = 3.5;                 // below this a chevron is a smudge; draw nothing
const SLOPE_FLAT = 0.06;                  // gradients under this have no direction worth drawing

/** The screen angle a cell's chevron points, from its world gradient.
 *
 *  THE SCREEN Y AXIS IS FLIPPED (`sy` is `cam.y - y`), so the world gradient has to be flipped with
 *  it. Getting this wrong points every arrow UPHILL while looking entirely plausible, which is the
 *  exact failure `holes.js` warns about for the grid itself - and it is why this is a named pure
 *  function with a test rather than an expression inside a draw loop. */
export function slopeGlyphAngle(g) { return Math.atan2(-g[1], g[0]); }

export function drawSlope(ctx, hole, cam, sx, sy, pal) {
  const sl = hole.green && hole.green.slope;
  if (!sl || !sl.cells) return;
  const gb = greenBox(hole);
  const cellYd = Math.min((gb.maxX - gb.minX) / sl.cols, (gb.maxY - gb.minY) / sl.rows);
  const cellPx = cellYd * cam.ppy;
  const size = cellPx * SLOPE_GLYPH_FRAC;         // the glyph's full width, in screen px
  if (size < SLOPE_MIN_PX) return;

  ctx.save();
  ctx.beginPath();
  const poly = hole.green.poly;
  ctx.moveTo(sx(poly[0][0]), sy(poly[0][1]));
  for (let i = 1; i < poly.length; i++) ctx.lineTo(sx(poly[i][0]), sy(poly[i][1]));
  ctx.closePath();
  ctx.clip();

  ctx.strokeStyle = shade(pal.green, SLOPE_TINT);
  ctx.lineWidth = Math.max(1.5, size * 0.28);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  const arm = size / 2;
  for (let r = 0; r < sl.rows; r++) {
    for (let c = 0; c < sl.cols; c++) {
      const g = sl.cells[r * sl.cols + c] || [0, 0];
      const mag = Math.hypot(g[0], g[1]);
      if (mag < SLOPE_FLAT) continue;
      const cxw = gb.minX + ((c + 0.5) * (gb.maxX - gb.minX)) / sl.cols;
      const cyw = gb.minY + ((r + 0.5) * (gb.maxY - gb.minY)) / sl.rows;
      const px = sx(cxw); const py = sy(cyw);
      // The chevron points DOWNHILL. `a` is the screen angle of the gradient; the two arms come
      // back from the point at +/- 135 deg, which is the V in the reference.
      const a = slopeGlyphAngle(g);
      const tipX = px + Math.cos(a) * arm * 0.55;
      const tipY = py + Math.sin(a) * arm * 0.55;
      ctx.beginPath();
      for (const d of [2.356, -2.356]) {
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX + Math.cos(a + d) * arm, tipY + Math.sin(a + d) * arm);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The golfer, in whole pixels. `w` is the sprite's width; it is drawn standing to the LEFT of the
 *  ball with its feet on the ball's own ground line, so the ball is never hidden by it.
 *
 *  `pose` 0 is address, 1 the top of the backswing, 2 through impact, 3 THE FINISH - which is the
 *  one that is on screen longest. Measured off the reference (ui.js's _frame carries the trace):
 *  the sprite is completely still for 265 ms after the third tap, the swing itself is four frames
 *  over about 100 ms, and the finish is then HELD for ~440 ms before the ball leaves. So the
 *  animation is a quick flourish and a long hold, not a smooth arc.
 *
 *  He does not move. Not one pixel of him, in any pose - the cap centroid was identical to two
 *  decimal places across all 45 frames of the address hold - so every pose keeps the head, torso
 *  and legs where they are and moves only the club and the arms. */
export function drawGolfer(ctx, bx, by, w, pose) {
  const u = Math.max(1, Math.round(w / 8));          // one "pixel" of the sprite
  const x = bx - u * 6;                              // stand clear of the ball
  const y = by;
  const px = (cx, cy, cw, ch, fill) => { ctx.fillStyle = fill; ctx.fillRect(x + cx * u, y + cy * u, cw * u, ch * u); };

  // The club, and the club ONLY. Four poses, one line each.
  ctx.strokeStyle = '#1b1f14';
  ctx.lineWidth = Math.max(1.5, u * 0.7);
  ctx.beginPath();
  ctx.moveTo(x + 4 * u, y - 5 * u);
  if (pose === 1) ctx.lineTo(x - 1 * u, y - 11 * u);       // top of the backswing, up and behind
  else if (pose === 2) ctx.lineTo(x + 9 * u, y - 2 * u);   // through impact, low and ahead
  else if (pose === 3) ctx.lineTo(x + 8 * u, y - 12 * u);  // the finish, up over the front shoulder
  else ctx.lineTo(x + 7 * u, y - 0.2 * u);                 // address, club head at the ball
  ctx.stroke();

  px(1, -3, 4, 3, '#8e969e');        // trousers
  px(1, -7, 4, 4, '#e7ebef');        // polo
  px(1.5, -9.5, 3, 2.5, '#d9a06a');  // face
  px(0.5, -12, 5, 2.5, '#ffffff');   // cap
  px(0.5, -12, 5, 0.6, '#1b1f14');   // cap outline
  px(4.6, -11, 2, 0.9, '#ffffff');   // cap brim
}
