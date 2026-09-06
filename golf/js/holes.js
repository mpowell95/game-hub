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

/** A single tree's SIZE, as a multiple of its type's `canopy` and `trunk` (2026-09-06).
 *
 *  Matt: *"Make some trees bigger. Like their diameter and circumference. But keep them spread out
 *  and stuff."* Every tree in a belt was drawn at exactly its type's canopy, so a wood was one
 *  crown stamped a few hundred times - which is most of what makes a belt read as wallpaper rather
 *  than as woodland, and it is why the mottling and the seeded clumps were added to the RENDERER
 *  and still were not enough. Real woods are mature specimens with younger trees between them.
 *
 *  THE SCALE IS NOT COSMETIC AND MUST NOT BE APPLIED IN THE RENDERER ALONE. `shot.js`'s `treeHit`
 *  reads the same multiple, because this renderer's whole contract is that what is painted is what
 *  stops the ball - a crown drawn half again as wide that a ball flew through would be a worse bug
 *  than the uniformity being fixed.
 *
 *  THE DISTRIBUTION IS ROUGHLY CANOPY-AREA-NEUTRAL, which is the "keep them spread out" half.
 *  Coverage goes as the SQUARE of this, so a mix that merely averaged 1.0 would close a wood back
 *  up by about a fifth and undo the feather pass. Mean s^2 here is 1.09 - a touch more cover than
 *  before, and `BELT_SPREAD` below takes that back out of the step so the wood stays as open as it
 *  was measured to be.
 *
 *  Heights are deliberately NOT scaled. A canopy's height is the fly-over gate the whole
 *  punch-low-or-loft-over decision runs on, and it is tuned against the bag's measured apexes; a
 *  wood of randomly unflyable trees would be a gameplay change wearing an art change's clothes. */
export function treeScale(rnd) {
  const u = rnd();
  if (u < 0.12) return 1.30 + rnd() * 0.50;          // 12 % mature specimens
  if (u < 0.40) return 1.02 + rnd() * 0.26;          // 28 % a size up
  if (u < 0.78) return 0.82 + rnd() * 0.18;          // 38 % ordinary
  return 0.62 + rnd() * 0.18;                        // 22 % young
}

/** Taken back out of the belt step so the size mix does not close the wood up again. sqrt(1.09). */
const BELT_SPREAD = 1.044;

/** Distance from a point to a polygon's OUTLINE (not its interior) - the nearest point on any of
 *  its edges. Used by `expandBelt` to thin a wood out toward its own edge, which needs a distance
 *  rather than the in/out answer `pointInPoly` gives. */
export function distToPolyEdge(pt, poly) {
  const [px, py] = pt;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    const dx = xj - xi; const dy = yj - yi;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / l2));
    const ex = xi + dx * t - px; const ey = yi + dy * t - py;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** How far INSIDE the belt a tree has to be before the wood is fully closed up - CAPPED AT A THIRD
 *  OF THE BELT'S OWN DEPTH. A flat 13 yds was measured against a 24 yd belt and left it with no
 *  core at all (the deepest point in a 24 yd band is 12 yds from an edge), so hole 12's whole left
 *  wall came out as 29 trees. A feather has to be a fraction of the thing it is feathering. */
export const BELT_FEATHER_YD = 9;
/** How far OUTSIDE it strays are still scattered, thinning to nothing. */
export const BELT_BLEED_YD = 15;
/** The keep-rate exactly ON the edge - the value both sides of the boundary meet at. */
const EDGE_KEEP = 0.68;

export function expandBelt(belt, type) {
  const rnd = mulberry32(belt.seed);
  const bb = bboxOf(belt.poly);
  // The sampling box reaches PAST the belt, because the wood has to bleed out of its own polygon.
  // A HAND-AUTHORED BELT GETS NEITHER, and that is deliberate. Holes 1 and 3 are the reference
  // clones: their belts are hand-drawn polygons with no `inner` edge and no matching INSET lie
  // surface (see holegen.js), so feathering them would expose the dark woodland ground the inset
  // exists to hide, and bleeding them would scatter strays across the fairway side. `inner` is the
  // marker for "this belt was generated and the surface under it has been inset to suit".
  const authored = !(belt.inner && belt.inner.length > 1);
  const bleed = belt.bleed != null ? belt.bleed : (authored ? 0 : BELT_BLEED_YD);
  const feather = belt.feather != null ? belt.feather
    : (authored ? 3 : Math.min(BELT_FEATHER_YD, Math.max(3, (belt.depth == null ? 22 : belt.depth) / 3)));
  const minX = bb.minX - bleed; const minY = bb.minY - bleed;
  const maxX = bb.maxX + bleed; const maxY = bb.maxY + bleed;
  const out = [];

  // A WOOD IS NOT A SLAB OF UNIFORM TREES THAT STOPS AT A LINE (2026-09-06).
  //
  // Matt, having played both courses: *"The fairway is lined by extremely dense forest that's
  // impossible to hit out of on every single hole. And the tree line abruptly just ends on every
  // hole."* Both halves were this function: it filled the belt polygon with a JITTERED UNIFORM
  // GRID, so the density was identical from the fairway edge to the back of the wood and from the
  // tee to the green, and it dropped to zero at the polygon boundary in the space of one step.
  //
  // Two things change, and they are one continuous function of SIGNED DISTANCE to the belt's edge
  // so there is no seam at the boundary itself:
  //
  //  - **The edge feathers, both ways.** Inside, the keep-rate ramps from EDGE_KEEP at the boundary
  //    to 1 at `feather` yards in, so the first few yards of wood are scattered trunks a ball can
  //    be played through and only the core is a wall. Outside, it decays from the same EDGE_KEEP to
  //    nothing over `bleed` yards, so the wood ENDS IN STRAYS rather than at a ruled line - at its
  //    sides and, which is the visible half, at the tee and green ends of every belt.
  //  - **The density breathes ALONG the hole.** Two harmonics, seeded per belt, so a wood has
  //    thick stretches and near-clearings instead of being the same wood for 400 yards. The
  //    wavelengths (about 34 and 89 yds) are long enough that a clearing is somewhere you can aim
  //    at, not a gap you find by luck.
  //
  // THE STRAYS ARE OUTSIDE THE `trees` LIE, and that is correct rather than an oversight: the belt
  // polygon is also the lie surface, so a ball among the strays is standing in ROUGH with trees
  // around it - which is what the edge of a wood is. `shot.js`'s escape rules already handle a ball
  // ringed by canopies whatever it is standing on (`near >= 3`), so this cannot wall anything in.
  const wphase = [rnd() * 6.283, rnd() * 6.283];
  // `y` is up the hole by the hole-format's own definition, so a wave in y is a wave ALONG the
  // hole for most belts; the small x term stops it degenerating into stripes on a belt that runs
  // sideways round a dogleg.
  // A GENTLE TEXTURE, NOT CLEARINGS. The first version of this ran 0.10 to 1.0, which really did
  // give a wood thick stretches and near-clearings - and a clearing SHOWS THE SLAB UNDERNEATH,
  // because the belt polygon is also the `trees` lie surface and it is painted as a dark ground.
  // Hollowing out the wood exposed a hard-edged dark rectangle on holes 12 and 16, which is a worse
  // version of the problem being fixed. Between-hole variety comes from the authored `spacing`
  // (which is a real dial again, see `step` below); this is only a bit of unevenness on top.
  const density = (x, y) => {
    const u = y + x * 0.35;
    const w = 0.90 + 0.11 * Math.sin(u / 34 + wphase[0]) + 0.07 * Math.sin(u / 89 + wphase[1]);
    return Math.max(0.76, Math.min(1, w));
  };
  // STRAYS NEVER BLEED TOWARD THE FAIRWAY. `belt.inner` is the belt's own fairway-facing edge, and
  // a tree outside the polygon is dropped if that is the edge it is nearest to. Without this the
  // bleed scattered specimens into the light rough on both sides of every hole and MADE THE GAME
  // HARDER - measured, Pine Valley's closing block went from +1.6 to +4.1 and four holes became
  // unfinishable, which is the exact opposite of the complaint being fixed. Past the ENDS of a belt
  // there is no inner edge nearby, so the strays that fix the abrupt tree line are unaffected.
  const innerEdge = belt.inner && belt.inner.length > 1 ? belt.inner : null;
  const keepAt = (x, y) => {
    const d = distToPolyEdge([x, y], belt.poly);
    const inside = pointInPoly([x, y], belt.poly);
    if (!inside) {
      if (d > bleed) return 0;
      if (innerEdge && distToPolyEdge([x, y], innerEdge) <= d + 0.01) return 0;
      return EDGE_KEEP * (1 - d / bleed) ** 2 * density(x, y);
    }
    return (EDGE_KEEP + (1 - EDGE_KEEP) * Math.min(1, d / feather)) * density(x, y);
  };
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
  // THE AUTHORED `spacing` WAS VERY NEARLY INERT, and that is most of why every hole's wood looked
  // the same (2026-09-06). The old clamp was `max(spacing * 0.55, min(spacing, canopy * PITCH))`,
  // and for a pine (canopy 4.5) the second term is 5.17 - so authored spacings of 7, 8 AND 9 all
  // produced a step of 5.17, i.e. THE IDENTICAL WOOD. Those three values are what almost every belt
  // on both courses uses. An author turning the dial from 7 to 9 changed nothing at all, which is
  // exactly the "every single hole" Matt was describing.
  //
  // `canopy * BELT_PITCH` is now a FLOOR ON HOW TIGHT a belt may be closed - the thing it was
  // written for, keeping a wood a solid mass rather than a row of buttons - and the authored
  // spacing drives the step above it. A belt authored at 7 is the wall it always was; one at 13 is
  // genuinely open woodland you can see and play through. That range is the between-hole variety,
  // and it lives in the course data where a designer can see it.
  const step = Math.max((type && type.canopy ? type.canopy : belt.spacing) * BELT_PITCH,
    belt.spacing * 0.72) * BELT_SPREAD;
  for (let y = minY; y < maxY; y += step) {
    for (let x = minX; x < maxX; x += step) {
      const jx = x + (rnd() - 0.5) * step;
      const jy = y + (rnd() - 0.5) * step;
      // rnd() is drawn UNCONDITIONALLY, before the cheap bbox reject, so the sequence a belt walks
      // does not depend on which candidates survive - the same belt is the same wood on every
      // device, which is the whole reason this is seeded.
      const r = rnd();
      if (jx < minX || jx > maxX || jy < minY || jy > maxY) continue;
      if (r >= keepAt(jx, jy)) continue;
      // `stray` marks a tree OUTSIDE the belt polygon. `treesOf` uses it to keep the bleed off
      // ground that is being played over - see there.
      const t = { x: jx, y: jy, type: belt.type, s: treeScale(rnd) };
      if (!pointInPoly([jx, jy], belt.poly)) t.stray = true;
      out.push(t);
    }
  }
  return out;
}

/** Every tree on the hole, hand-placed and belt-expanded, as one flat array. Cached on the hole so
 *  a belt is expanded once per session rather than per frame. */
/** Ground a BELT-expanded tree may never land on. A wood thins out into rough, never onto mown
 *  grass or into a hazard - a pine standing in the middle of the fairway is not a soft edge, it is
 *  a bug, and one growing out of a bunker or a lake is worse.
 *
 *  IT APPLIES TO EVERY BELT TREE, not only to the strays outside the polygon. A hand-drawn belt can
 *  overlap the corridor or a hazard it was never checked against - hole 3's right belt has clipped
 *  the fairway bunker at y 166-186 since Stage B - and the fix is the same wherever the tree came
 *  from. HAND-PLACED `trees` ENTRIES ARE NEVER FILTERED: hole 3's signature oak stands ON THE
 *  FAIRWAY on purpose, and an author who writes a coordinate means it. */
const NO_BELT_TREE = new Set(['fairway', 'lightRough', 'green', 'fringe', 'tee', 'water',
  'fairwayBunker', 'greensideBunker']);

export function treesOf(hole) {
  if (hole._trees) return hole._trees;
  const all = [...(hole.trees || [])];
  for (const belt of hole.treeBelts || []) {
    for (const t of expandBelt(belt, (hole.treeTypes || [])[belt.type])) {
      // The belt's own `inner` edge keeps strays off the fairway side on a GENERATED hole, but
      // holes 1 and 3 are hand-authored and their belts carry no `inner` - so the bleed put a pine
      // out in hole 3's light rough, 47 yards up the shot line, and section 10's lob-wedge probe
      // went from clearing the oak to being stopped by it. The surface test covers both authoring
      // paths and says the rule directly rather than by proxy.
      if (NO_BELT_TREE.has(surfaceAt(hole, t.x, t.y))) continue;
      all.push(t);
    }
  }
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
