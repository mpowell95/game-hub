// dominoes/js/board.js — the chain's GEOMETRY, recomputed from scratch on every render. PURE:
// takes game.js's line/up/down arrays, returns rectangles. No DOM, no px — the UI multiplies by
// one unit size and applies a single transform to the whole group.
//
// UNITS: one unit is HALF a domino's short side, which is the coarsest grid on which every legal
// placement lands on integers. A domino is 4x2 units laid along the run and 2x4 across it, and a
// double laid crosswise straddles the run by exactly one unit on each side — the reason a
// half-cell grid is needed at all.
//
// Growth: the SPINNER is the origin at (0,0) whenever one has been played (the round's first
// tile before that), and the main line grows both ways from it. Anchoring on the spinner rather
// than on the opening tile is what keeps the two branches in clear space: they leave the origin
// while the runs only fold near the extents, half a board away. The cost is a one-time glide
// when the first double lands and the anchor moves — which the container's transform animates
// for free.
//
// Folding: a run goes straight until it would pass its extent limit (or would overlap something
// already laid) and then takes a 90-degree elbow, preferring the direction that folds AWAY from
// the other run. A DOUBLE never turns a corner — it is laid crosswise in the current direction
// and the turn waits for the next tile, which keeps the corner rule to one shape instead of two.

const LONG = 4, SHORT = 2;

// Extent limits, in units, measured from the origin. Chosen so a run turns at roughly five
// dominoes — long enough that an ordinary round never elbows at all, short enough that a long
// one folds instead of shrinking the whole board to nothing.
export const LIMIT_X = 22;
export const LIMIT_Y = 20;

// Fold preference: the perpendicular directions a run tries, in order, when it has to elbow.
// The two halves of the main line fold OPPOSITE ways (right-hand run down, left-hand run up) so
// a long line becomes an S rather than doubling back over itself, and each branch folds away
// from the run that shares its side. The reverse direction is never a candidate.
const PERP = {
  right: ['down', 'up'],
  left: ['up', 'down'],
  down: ['right', 'left'],
  up: ['left', 'right'],
};

const overlaps = (r, s) => r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
const hits = (rects, r) => rects.some((s) => overlaps(r, s));

/** A tile laid in `dir` from attachment point P, continuing the run. */
function straight(P, dir, dbl) {
  switch (dir) {
    case 'right': return dbl
      ? { x: P.x, y: P.y - 2, w: SHORT, h: LONG, next: { x: P.x + SHORT, y: P.y } }
      : { x: P.x, y: P.y - 1, w: LONG, h: SHORT, next: { x: P.x + LONG, y: P.y } };
    case 'left': return dbl
      ? { x: P.x - SHORT, y: P.y - 2, w: SHORT, h: LONG, next: { x: P.x - SHORT, y: P.y } }
      : { x: P.x - LONG, y: P.y - 1, w: LONG, h: SHORT, next: { x: P.x - LONG, y: P.y } };
    case 'down': return dbl
      ? { x: P.x - 2, y: P.y, w: LONG, h: SHORT, next: { x: P.x, y: P.y + SHORT } }
      : { x: P.x - 1, y: P.y, w: SHORT, h: LONG, next: { x: P.x, y: P.y + LONG } };
    default: return dbl
      ? { x: P.x - 2, y: P.y - SHORT, w: LONG, h: SHORT, next: { x: P.x, y: P.y - SHORT } }
      : { x: P.x - 1, y: P.y - LONG, w: SHORT, h: LONG, next: { x: P.x, y: P.y - LONG } };
  }
}

/** A tile that turns the corner from `from` into `to`. Never called for a double. The tile sits
 *  alongside the previous one (its near half level with it) and the run continues in `to`. */
function corner(P, from, to) {
  const key = from + '>' + to;
  switch (key) {
    case 'right>down': return { x: P.x, y: P.y - 1, w: SHORT, h: LONG, next: { x: P.x + 1, y: P.y + 3 } };
    case 'right>up': return { x: P.x, y: P.y - 3, w: SHORT, h: LONG, next: { x: P.x + 1, y: P.y - 3 } };
    case 'left>down': return { x: P.x - SHORT, y: P.y - 1, w: SHORT, h: LONG, next: { x: P.x - 1, y: P.y + 3 } };
    case 'left>up': return { x: P.x - SHORT, y: P.y - 3, w: SHORT, h: LONG, next: { x: P.x - 1, y: P.y - 3 } };
    case 'down>right': return { x: P.x - 1, y: P.y, w: LONG, h: SHORT, next: { x: P.x + 3, y: P.y + 1 } };
    case 'down>left': return { x: P.x - 3, y: P.y, w: LONG, h: SHORT, next: { x: P.x - 3, y: P.y + 1 } };
    case 'up>right': return { x: P.x - 1, y: P.y - SHORT, w: LONG, h: SHORT, next: { x: P.x + 3, y: P.y - 1 } };
    default: return { x: P.x - 3, y: P.y - SHORT, w: LONG, h: SHORT, next: { x: P.x - 3, y: P.y - 1 } };
  }
}

/** Would this rect run past the play area's fold limit for `dir`? */
function pastLimit(r, dir) {
  if (dir === 'right') return r.x + r.w > LIMIT_X;
  if (dir === 'left') return r.x < -LIMIT_X;
  if (dir === 'down') return r.y + r.h > LIMIT_Y;
  return r.y < -LIMIT_Y;
}

/** Reading order of the two halves. A tile always reads left-to-right / top-to-bottom, so which
 *  half holds the value that MATCHED depends only on which way the run is now heading. */
const innerFirst = (dir) => dir === 'right' || dir === 'down';

/** Walk one run: `entries` are game.js chain entries in the order they leave the origin, each
 *  { id, a, b } with `a` the inner (matched) half and `b` the outer one. `startDir` is the
 *  direction it leaves the origin in; every later direction is chosen here.
 *
 *  Preference order for each tile, and the order matters — an earlier version folded on the
 *  first free corner and produced zig-zags, while folding only on the limit let long runs walk
 *  straight through a branch:
 *    1. straight, inside the extent limit and free
 *    2. an elbow, inside the limit and free (perpendiculars in PERP order)
 *    3. straight and free, limit be damned (running long beats a needless fold)
 *    4. any free elbow
 *    5. straight regardless — the fit-to-felt scale absorbs it rather than dropping a tile */
function walk(entries, startP, startDir, rects, out) {
  let P = startP, dir = startDir;
  for (const e of entries) {
    const dbl = e.a === e.b;
    const st = straight(P, dir, dbl);
    const stFree = !hits(rects, st);
    let r = null, usedDir = dir;
    if (stFree && !pastLimit(st, dir)) r = st;
    if (!r && !dbl) {
      for (const to of PERP[dir]) {
        const c = corner(P, dir, to);
        if (!hits(rects, c) && !pastLimit(c, to)) { r = c; usedDir = to; break; }
      }
    }
    if (!r && stFree) r = st;
    if (!r && !dbl) {
      for (const to of PERP[dir]) {
        const c = corner(P, dir, to);
        if (!hits(rects, c)) { r = c; usedDir = to; break; }
      }
    }
    if (!r) { r = st; usedDir = dir; }
    const vertical = r.h > r.w;
    const values = innerFirst(usedDir) ? [e.a, e.b] : [e.b, e.a];
    const rect = { x: r.x, y: r.y, w: r.w, h: r.h };
    rects.push(rect);
    out.push({ id: e.id, ...rect, vertical, values, dir: usedDir });
    P = r.next;
    dir = usedDir;
  }
  return { P, dir };
}

/**
 * Lay out a chain.
 * @param {{line:Array, up:Array, down:Array, spinnerId:?number, originId:?number}} chain
 * @returns {{ tiles: Array, ends: Array, bbox: {x,y,w,h} }}
 *   `tiles`  one entry per placed domino: { id, x, y, w, h, vertical, values:[first,second] }
 *   `ends`   one entry per OPEN end: { side, value, x, y } with x/y the badge anchor point,
 *            just past the last tile of that arm, in the same unit space.
 *   `bbox`   the group's bounding box, for the single centre-and-fit transform.
 */
export function layoutChain(chain) {
  const tiles = [], rects = [];
  const line = chain.line || [];
  if (!line.length) return { tiles, ends: [], bbox: { x: 0, y: 0, w: 0, h: 0 } };

  // Anchor on the spinner when there is one, so the branches always leave from the middle of
  // the board; otherwise on the round's opening tile.
  const anchorId = chain.spinnerId != null ? chain.spinnerId : chain.originId;
  const oi = Math.max(0, line.findIndex((e) => e.id === anchorId));
  const origin = line[oi];
  const oDbl = origin.a === origin.b;
  const oRect = oDbl
    ? { x: 0, y: -2, w: SHORT, h: LONG }
    : { x: 0, y: -1, w: LONG, h: SHORT };
  rects.push(oRect);
  tiles.push({ id: origin.id, ...oRect, vertical: oRect.h > oRect.w, values: [origin.a, origin.b], dir: 'right' });

  // Right of the origin: entries already read inner-then-outer left to right.
  const rightEntries = line.slice(oi + 1).map((e) => ({ id: e.id, a: e.a, b: e.b }));
  // Left of the origin: walked outward, so the half facing the origin (`b`) is the inner one.
  const leftEntries = line.slice(0, oi).reverse().map((e) => ({ id: e.id, a: e.b, b: e.a }));

  const rightStart = { x: oRect.x + oRect.w, y: 0 };
  const leftStart = { x: oRect.x, y: 0 };
  const rEnd = walk(rightEntries, rightStart, 'right', rects, tiles);
  const lEnd = walk(leftEntries, leftStart, 'left', rects, tiles);

  // Branches hang off the spinner's two free sides. The spinner is laid crosswise to whatever
  // direction its own run was heading, so "perpendicular" is read off its rendered shape rather
  // than assumed to be up/down — after an elbow it genuinely is left/right.
  const ends = [
    { side: 'left', value: line[0].a, ...endAnchor(lEnd) },
    { side: 'right', value: line[line.length - 1].b, ...endAnchor(rEnd) },
  ];
  const spin = chain.spinnerId == null ? null : tiles.find((t) => t.id === chain.spinnerId);
  const spinIdx = chain.spinnerId == null ? -1 : line.findIndex((e) => e.id === chain.spinnerId);
  const open = spinIdx > 0 && spinIdx < line.length - 1;
  if (spin && (open || chain.up.length || chain.down.length)) {
    const upStart = spin.vertical ? { x: spin.x + spin.w / 2, y: spin.y } : { x: spin.x, y: spin.y + spin.h / 2 };
    const downStart = spin.vertical ? { x: spin.x + spin.w / 2, y: spin.y + spin.h } : { x: spin.x + spin.w, y: spin.y + spin.h / 2 };
    const upDir = spin.vertical ? 'up' : 'left';
    const downDir = spin.vertical ? 'down' : 'right';
    const uEnd = walk(chain.up.map((e) => ({ ...e })), upStart, upDir, rects, tiles);
    const dEnd = walk(chain.down.map((e) => ({ ...e })), downStart, downDir, rects, tiles);
    const spinVal = spin.values[0];
    if (chain.up.length) ends.push({ side: 'up', value: chain.up[chain.up.length - 1].b, ...endAnchor(uEnd) });
    else if (open) ends.push({ side: 'up', value: spinVal, ...endAnchor({ P: upStart, dir: upDir }) });
    if (chain.down.length) ends.push({ side: 'down', value: chain.down[chain.down.length - 1].b, ...endAnchor(dEnd) });
    else if (open) ends.push({ side: 'down', value: spinVal, ...endAnchor({ P: downStart, dir: downDir }) });
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  // The badges sit outside the tiles, so the fit has to know about them or they clip.
  for (const e of ends) {
    minX = Math.min(minX, e.x - 1.6); minY = Math.min(minY, e.y - 1.6);
    maxX = Math.max(maxX, e.x + 1.6); maxY = Math.max(maxY, e.y + 1.6);
  }
  return { tiles, ends, bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

/** Badge anchor: one unit past the run's attachment point, along the run's own direction. */
function endAnchor({ P, dir }) {
  const d = { right: [1.4, 0], left: [-1.4, 0], down: [0, 1.4], up: [0, -1.4] }[dir] || [0, 0];
  return { x: P.x + d[0], y: P.y + d[1] };
}

/** Every rect, for the overlap assertions in test.js. */
export function rectsOf(chain) {
  return layoutChain(chain).tiles.map(({ x, y, w, h }) => ({ x, y, w, h }));
}

export default { layoutChain, rectsOf, LIMIT_X, LIMIT_Y };
