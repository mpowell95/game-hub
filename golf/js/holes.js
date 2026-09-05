// golf/js/holes.js - the hole-data geometry layer: containment, the lie lookup, deterministic
// tree-belt expansion, slope sampling, and validateHole().
//
// PURE and DOM-free, so golf/js/test.js can exercise all of it headless. The format itself is
// documented in golf/CLAUDE.md, "The hole-data format" - read that before changing anything here,
// because the renderer, the lie lookup, the tree collision test and the putting break all read
// these same objects and a change here moves all four.
//
// Units: YARDS everywhere, including tree and ball height. x runs across the hole (right
// positive), y runs up it away from the tee.

/** Every surface kind, and the only ones a hole may name. Each is a row in LIES (clubs.js). */
export const SURFACE_KINDS = new Set([
  'tee', 'fairway', 'fringe', 'lightRough', 'heavyRough',
  'fairwayBunker', 'greensideBunker', 'trees', 'green', 'water',
]);

/** Ray-cast point-in-polygon. Winding order is irrelevant, which is why hole data never states
 *  one. `poly` is [[x,y], ...]; a point exactly on an edge may land either way, and nothing here
 *  depends on which (a lie one yard either side plays the same). */
export function pointInPoly(pt, poly) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bboxOf(poly) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** The green's outline is written ONCE, in `hole.green.poly`, and referenced from `surfaces` by
 *  the string 'green'. Two copies of that outline would drift, and a green whose lie boundary
 *  differs from its drawn edge is the yards/feet readout flickering along the fringe. */
export function polyOf(surface, hole) {
  return surface.poly === 'green' ? hole.green.poly : surface.poly;
}

/** What is the ball lying on? The LAST surface polygon containing the point wins, so the same
 *  ordering drives the paint and the lie - what the player sees is what they are standing on.
 *  Anything no polygon covers is `hole.base`. */
export function surfaceAt(hole, x, y) {
  for (let i = hole.surfaces.length - 1; i >= 0; i--) {
    const s = hole.surfaces[i];
    if (pointInPoly([x, y], polyOf(s, hole))) return s.kind;
  }
  return hole.base;
}

// --- tree belts ---------------------------------------------------------------------------------
//
// A belt is a polygon filled with trees at a spacing, expanded at load into ordinary tree objects.
// The belts lining a hole are hundreds of trees and must not be hundreds of hand-written entries,
// but there must still be exactly ONE collision path - so this produces the same objects the
// `trees` list holds, and everything downstream sees one flat array.
//
// mulberry32, seeded per belt: the same belt is the same trees on every device and in every test
// run. A belt that reshuffled per load would make a hole play differently each visit and make any
// reachability measurement meaningless.
export function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far apart belt trees stand, as a multiple of their canopy RADIUS, when the authored spacing
 *  would leave them apart. [MEASURED] the reference's belt runs ~87 px between crowns against a
 *  ~155 px crown - a pitch of 0.56 diameters, so 1.12 radii. */
export const BELT_PITCH = 1.15;

export function expandBelt(belt, type) {
  const rnd = mulberry32(belt.seed);
  const { minX, minY, maxX, maxY } = bboxOf(belt.poly);
  const out = [];
  // A BELT HAS TO CLOSE UP INTO A WALL. Measured on the reference (s1-tee frame 30): a single
  // canopy is ~155 device px across and the belt beside the fairway is one continuous mass 246 px
  // wide by 1040 tall - individual crowns are only readable as bumps along its edge. Ours were
  // authored at 7-11 yds against a 9 yd pine canopy, so they touched at best and left daylight at
  // worst, which is what made a belt read as a row of buttons.
  //
  // The authored `spacing` is kept as a CEILING rather than replaced, so a deliberately sparse
  // belt (Red Mesa's palo verdes at 15 yds against a 13 yd canopy) still thins out; it is only
  // clamped down when the trees would not otherwise meet. BELT_PITCH is off the reference's own
  // pitch-to-diameter ratio.
  //
  // THE FLOOR IS NOT OPTIONAL. A saguaro's "canopy" is 1.8 yds - it is a pillar, not a crown - so
  // a bare canopy*PITCH clamp turned Red Mesa 10's two belts of 13 yd spacing into 2,812 cacti at
  // 2 yd centres: an impassable thicket that softlocked the ball on the first run of the 36-hole
  // test, and a rendering cost to match. A belt may be closed up, never past 55 % of the spacing
  // its author chose - so a wood becomes a wall and a stand of cactus stays a stand of cactus.
  const step = Math.max(belt.spacing * 0.55,
    Math.min(belt.spacing, (type && type.canopy ? type.canopy : belt.spacing) * BELT_PITCH));
  for (let y = minY; y < maxY; y += step) {
    for (let x = minX; x < maxX; x += step) {
      const jx = x + (rnd() - 0.5) * step;
      const jy = y + (rnd() - 0.5) * step;
      if (pointInPoly([jx, jy], belt.poly)) out.push({ x: jx, y: jy, type: belt.type });
    }
  }
  return out;
}

/** Every tree on the hole, hand-placed and belt-expanded, as one flat array. Cached on the hole so
 *  a belt is expanded once per session rather than per frame. */
export function treesOf(hole) {
  if (hole._trees) return hole._trees;
  const all = [...(hole.trees || [])];
  for (const belt of hole.treeBelts || []) all.push(...expandBelt(belt, (hole.treeTypes || [])[belt.type]));
  Object.defineProperty(hole, '_trees', { value: all, enumerable: false });
  return all;
}

// --- the green's slope grid ---------------------------------------------------------------------

/** The downhill gradient under a point on the green, as [dx, dy] in -1..+1. Outside the green's
 *  bounding box it is flat.
 *
 *  The grid covers the AABB of `green.poly`, cells[0] is the front-left cell (lowest x, lowest y)
 *  and it is row-major. That anchoring is stated here and in golf/CLAUDE.md because getting it
 *  flipped puts every break backwards while looking entirely plausible on screen. */
export function slopeAt(hole, x, y) {
  const g = hole.green;
  const bb = greenBox(hole);
  if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) return [0, 0];
  const { cols, rows, cells } = g.slope;
  const c = Math.min(cols - 1, Math.max(0, Math.floor(((x - bb.minX) / (bb.maxX - bb.minX)) * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(((y - bb.minY) / (bb.maxY - bb.minY)) * rows)));
  return cells[r * cols + c] || [0, 0];
}

export function greenBox(hole) {
  if (!hole._greenBox) {
    Object.defineProperty(hole, '_greenBox', { value: bboxOf(hole.green.poly), enumerable: false });
  }
  return hole._greenBox;
}

// --- validation ---------------------------------------------------------------------------------

/** Every check golf/CLAUDE.md's "What the validator asserts" promises. Returns an array of
 *  problem strings; empty means valid.
 *
 *  A hole that fails must fail LOUDLY at load. A malformed green silently flattens the break, and
 *  that gets diagnosed as "putting feels wrong" for a week rather than as a broken data file. */
export function validateHole(hole) {
  const errs = [];
  const at = (m) => errs.push(`hole ${hole && hole.n}: ${m}`);
  if (!hole || typeof hole !== 'object') return ['hole is not an object'];

  if (!Number.isInteger(hole.par) || hole.par < 3 || hole.par > 5) at(`par ${hole.par} is not 3-5`);
  if (!(hole.cardYards > 0)) at(`cardYards ${hole.cardYards} is not positive`);
  if (!SURFACE_KINDS.has(hole.base)) at(`base "${hole.base}" is not a surface kind`);

  const b = hole.bounds;
  if (!b || !(b.maxX > b.minX) || !(b.maxY > b.minY)) { at('bounds are missing or inside out'); return errs; }

  const checkPoly = (poly, what) => {
    if (!Array.isArray(poly) || poly.length < 3) { at(`${what} has fewer than 3 points`); return; }
    for (const p of poly) {
      if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        at(`${what} has a malformed point ${JSON.stringify(p)}`); return;
      }
      if (p[0] < b.minX || p[0] > b.maxX || p[1] < b.minY || p[1] > b.maxY) {
        at(`${what} has a point outside bounds: ${JSON.stringify(p)}`);
      }
    }
  };

  for (const [i, s] of (hole.surfaces || []).entries()) {
    if (!SURFACE_KINDS.has(s.kind)) at(`surfaces[${i}] kind "${s.kind}" is not a surface kind`);
    checkPoly(polyOf(s, hole), `surfaces[${i}] (${s.kind})`);
  }
  checkPoly(hole.green && hole.green.poly, 'green.poly');
  for (const [i, d] of (hole.decor || []).entries()) checkPoly(d.poly, `decor[${i}]`);

  const sl = hole.green && hole.green.slope;
  if (!sl || !Array.isArray(sl.cells)) at('green.slope.cells is missing');
  else {
    if (sl.cells.length !== sl.cols * sl.rows) {
      at(`green.slope has ${sl.cells.length} cells, expected ${sl.cols} x ${sl.rows} = ${sl.cols * sl.rows}`);
    }
    for (const [i, c] of sl.cells.entries()) {
      if (!Array.isArray(c) || c.length !== 2 || Math.abs(c[0]) > 1 || Math.abs(c[1]) > 1) {
        at(`green.slope.cells[${i}] is not a [dx,dy] pair within -1..+1`);
      }
    }
  }

  if (!hole.pin || !pointInPoly(hole.pin, (hole.green || {}).poly || [])) at('pin is not inside green.poly');
  const teeSurf = (hole.surfaces || []).filter((s) => s.kind === 'tee');
  if (!teeSurf.some((s) => pointInPoly(hole.tee, polyOf(s, hole)))) at('tee is not inside a tee surface');

  const types = hole.treeTypes || [];
  for (const [i, t] of (hole.trees || []).entries()) if (!types[t.type]) at(`trees[${i}] type ${t.type} does not exist`);
  for (const [i, t] of (hole.treeBelts || []).entries()) {
    if (!types[t.type]) at(`treeBelts[${i}] type ${t.type} does not exist`);
    if (!(t.spacing > 0)) at(`treeBelts[${i}] spacing must be positive`);
    checkPoly(t.poly, `treeBelts[${i}]`);
  }
  for (const [i, t] of types.entries()) {
    if (!(t.trunk > 0) || !(t.canopy >= t.trunk) || !(t.height > 0)) {
      at(`treeTypes[${i}] (${t.name}) needs trunk > 0, canopy >= trunk, height > 0`);
    }
  }
  return errs;
}

/** Straight-line 2-D distance in yards. This - never `cardYards` - is what the HUD shows: a shot
 *  that finishes offline leaves more than "tee yardage minus shot distance" (the spec's own
 *  arithmetic: 360.7 - 251.6 is not 136.0). */
export function distYd(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
