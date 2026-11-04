// cup-pong/js/rack.js - A RACK IS A SET OF CELLS ON A HEX GRID. Pure data, no DOM, no engine.
//
// Brief section 4c: "build this first, everything else sits on it". The table, the physics, a
// challenge record and a replay all read this one format, and a preset and a custom rack are the
// same thing - a list of cells.
//
// THE GRID: "doubled-width" hex coordinates. A cell is { c, r }:
//   r = row, 0 is the row furthest from the shooter, growing toward them
//   c = column in HALF cup-widths, so neighbours in a row are 2 apart
//   a cell is real only when (c + r) is ODD - the half-shift between rows falls out of that.
// So the 10-cup triangle (4-3-2-1, point toward the shooter) is
//   r0: c -3 -1 1 3     r1: c -2 0 2     r2: c -1 1     r3: c 0
// and every cup in it touches its neighbours, because the grid pitch IS one cup across.
//
// A cup keeps its id for the whole game (`k0`..`k9`); a rerack moves ids to new cells.
//
// STRAIGHT LINES DO NOT FIT A HEX GRID, so a cup may also sit at an EXACT spot: { u, v } in
// cup-widths (x = u cup-widths across, z = v cup-widths down the table from row 0's line). Two
// cups touching one directly behind the other are one cup-width apart ALONG the table, and hex rows
// are only 0.866 of one apart, so no two cells ever line up like that. Matt, 2026-09-27, on the
// Gentleman's line and the Line presets: "do whatever you have to do so that these racks are
// possible and look correct and are placed correctly." So the line shapes are exact positions,
// and every check below (overlap, the area) is done in real distance, which is correct for both.

import { CUP_D, ROW_H, RACK_Z0, TABLE, CUP } from './geom.js';

/** Rack-area bounds, in cells. Row 4 is one row nearer the shooter than the triangle's point, for
 *  shapes deeper than the triangle; |c| <= 5 keeps every rim on the table with a margin. */
export const AREA = { cMax: 5, rMax: 4 };

export const isCell = (cell) => !!cell && Number.isInteger(cell.c) && Number.isInteger(cell.r)
  && Math.abs(cell.c + cell.r) % 2 === 1;
/** An exact spot, for shapes the hex grid cannot hold (straight lines toward the shooter). */
export const isSpot = (k) => !!k && Number.isFinite(k.u) && Number.isFinite(k.v) && !('c' in k) && !('r' in k);

/** A cup's centre on the table, in metres (x across, z along; z is negative, the far end). */
export function cellXZ(cell) {
  if (isSpot(cell)) return { x: cell.u * CUP_D, z: RACK_Z0 + cell.v * CUP_D };
  return { x: cell.c * CUP_D / 2, z: RACK_Z0 + cell.r * ROW_H };
}

// The rack area in metres, which is what a spot is checked against: the same box the cells span.
const X_MAX = AREA.cMax * CUP_D / 2 + 1e-9;
const Z_MIN = RACK_Z0 - 1e-9;
const Z_MAX = RACK_Z0 + AREA.rMax * ROW_H + 1e-9;

export const inArea = (cell) => {
  if (isCell(cell)) return cell.r >= 0 && cell.r <= AREA.rMax && Math.abs(cell.c) <= AREA.cMax;
  if (!isSpot(cell)) return false;
  const p = cellXZ(cell);
  return Math.abs(p.x) <= X_MAX && p.z >= Z_MIN && p.z <= Z_MAX;
};

export const PRESETS = {
  // 10 cups, 4-3-2-1, point toward the shooter.
  tri10: [
    { c: -3, r: 0 }, { c: -1, r: 0 }, { c: 1, r: 0 }, { c: 3, r: 0 },
    { c: -2, r: 1 }, { c: 0, r: 1 }, { c: 2, r: 1 },
    { c: -1, r: 2 }, { c: 1, r: 2 },
    { c: 0, r: 3 },
  ],
  // STRAIGHT LINES pointing at the shooter, touching, centred, the front cup where the
  // triangle's point stands. `line2` is the Gentleman's (brief 4b). Exact spots, see above.
  line2: lineSpots(2),
  line3: lineSpots(3),
  line4: lineSpots(4),
};

/** n cups in a straight touching line toward the shooter, front cup on the triangle's point - or,
 *  for a line longer than the triangle is deep (4 cups is 3 cup-widths; the triangle is 2.6), with
 *  its BACK cup on the back row, so it never hangs off the far end of the rack area. */
function lineSpots(n) {
  const point = 3 * ROW_H / CUP_D;                   // the point cell's depth, in cup-widths
  const front = Math.max(point, n - 1);
  return Array.from({ length: n }, (_, i) => ({ u: 0, v: front - i }));
}

/** A fresh rack from a preset: [{ id, c, r }]. */
export function makeRack(preset = 'tri10') {
  const cells = PRESETS[preset];
  if (!cells) throw new Error('unknown rack preset ' + preset);
  return cells.map((cell, i) => (isSpot(cell)
    ? { id: 'k' + i, u: cell.u, v: cell.v }
    : { id: 'k' + i, c: cell.c, r: cell.r }));
}

/** Is this a legal rack? Every cup on a real cell or spot inside the area, and no two closer than
 *  touching - measured in metres, so a cell and a spot are checked against each other correctly. */
export function validRack(cups) {
  if (!Array.isArray(cups)) return false;
  const ids = new Set();
  const pts = [];
  for (const k of cups) {
    if (!k || typeof k.id !== 'string' || ids.has(k.id) || !inArea(k)) return false;
    ids.add(k.id);
    pts.push(cellXZ(k));
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < CUP_D - 1e-6) return false;
    }
  }
  return true;
}

/** The cups as the engine needs them: world positions. */
export function cupsXZ(cups) {
  return cups.map((k) => ({ id: k.id, ...cellXZ(k) }));
}

// Guard, evaluated once at load: the widest cell in the area still has its rim on the table.
if (AREA.cMax * CUP_D / 2 + CUP.topR > TABLE.width / 2) {
  throw new Error('rack.js: AREA.cMax puts a cup off the table');
}

// --- RERACK PRESETS (brief 4c) -----------------------------------------------------------------
// Every shape is built from ROWS, back to front, and placed as exact spots so a shape the hex grid
// cannot hold (an aligned 3-3 wall, a 3-1 triangle) is still exact and touching. A row's cups are
// centred; `step` is the gap to the next row in cup-widths (hex rows are 0.866 apart and half a cup
// shifted, straight rows are 1.0 apart), `shift` slides one row sideways (the zippers).
// PLACEMENT: AGAINST THE BACK WALL (Matt, 2026-09-29: "everything is set against the back wall").
// The shape's BACK row stands on the rack's back row, so a rerack can never pull the cups closer to
// the shooter. Before that (2026-09-28) the FRONT row stood where the triangle's point is; that
// placement is kept, as `back = false`, only so a challenge made under it still replays the same.
// The Gentleman's line: PRESETS.line2 only for challenges made before 2026-10-23; since then GENT_BACK.
const HEX = ROW_H / CUP_D;
function shape(rows, back = true) {
  let v = 0;
  const pts = [];
  rows.forEach((row, i) => {
    const w = row.n;
    for (let j = 0; j < w; j++) pts.push({ u: j - (w - 1) / 2 + (row.shift || 0), v });
    if (i < rows.length - 1) v += row.step != null ? row.step : HEX;
  });
  const depth = v;
  if (back) return pts;                                  // v = 0 is the back row
  const front = Math.max(3 * HEX, depth);
  // v grows toward the shooter; the last row listed is the front row.
  return pts.map((p) => ({ u: p.u, v: p.v + (front - depth) }));
}
const R = (n, step, shift) => ({ n, step, shift });

/** A straight line of n touching cups toward the shooter, its back cup on the back row. */
const backLine = (n) => Array.from({ length: n }, (_, i) => ({ u: 0, v: i }));
/** The Gentleman's against the back wall (Matt, 2026-10-23: "as far back as possible"), `gentBack`. */
export const GENT_BACK = backLine(2);

/** Preset shapes by cup count: [{ key, label (EN/ES label keys live in strings.js), spots }]. */
const buildReracks = (back) => {
  const shape_ = (rows) => shape(rows, back);
  const line = (n) => (back ? backLine(n) : PRESETS['line' + n]);
  return {
    10: [{ key: 'tri', spots: shape_([R(4), R(3), R(2), R(1)]) }],
    9: [
      { key: 'diamond', spots: shape_([R(1), R(2), R(3), R(2), R(1)]) },
      { key: 'wall333', spots: shape_([R(3, 1), R(3, 1), R(3)]) },
    ],
    8: [
      { key: 'zipper', spots: shape_([R(2, HEX, -0.25), R(2, HEX, 0.25), R(2, HEX, -0.25), R(2, HEX, 0.25)]) },
      { key: 'r323', spots: shape_([R(3), R(2), R(3)]) },
    ],
    7: [{ key: 'honeycomb', spots: shape_([R(2), R(3), R(2)]) }],
    6: [
      { key: 'tri', spots: shape_([R(3), R(2), R(1)]) },
      { key: 'zipper', spots: shape_([R(2, HEX, -0.25), R(2, HEX, 0.25), R(2, HEX, -0.25)]) },
      { key: 'wall33', spots: shape_([R(3, 1), R(3)]) },
    ],
    5: [
      { key: 'house', spots: shape_([R(2), R(1), R(2)]) },
      { key: 'r32', spots: shape_([R(3), R(2)]) },
    ],
    4: [
      { key: 'diamond', spots: shape_([R(1), R(2), R(1)]) },
      { key: 'tri31', spots: shape_([R(3, 1), R(1)]) },
      { key: 'line', spots: line(4) },
      { key: 'square', spots: shape_([R(2, HEX, -0.25), R(2, HEX, 0.25)]) },
    ],
    3: [
      { key: 'tri', spots: shape_([R(2), R(1)]) },
      { key: 'line', spots: line(3) },
    ],
    2: [
      { key: 'line', spots: line(2) },
      { key: 'side', spots: shape_([R(2)]) },
    ],
    1: [{ key: 'center', spots: shape_([R(1)]) }],
  };
};
export const RERACKS = buildReracks(true);
const RERACKS_POINT = buildReracks(false);   // the 2026-09-28 placement, for old challenges


/** The presets that fit `n` cups. */
export const presetsFor = (n, back = true) => (back ? RERACKS : RERACKS_POINT)[n] || [];

/** Stand these cups (keeping their ids) on a preset's spots. */
export function applyPreset(cups, spots) {
  return cups.map((k, i) => ({ id: k.id, u: spots[i].u, v: spots[i].v }));
}

/** Two cups count as TOUCHING when their centres are closer than this (metres): one cup across, with
 *  8% slack. The island test, the computer's tidy-rack count and the all-touching rule share it. */
const TOUCHING = CUP_D * 1.08;

/** Cups with no other cup touching them (brief: "island"). Touching = centres one cup apart. */
export function islandsOf(cups) {
  const pts = cups.map((k) => ({ id: k.id, ...cellXZ(k) }));
  return pts.filter((p) => !pts.some((o) => o !== p && Math.hypot(o.x - p.x, o.z - p.z) < TOUCHING)).map((p) => p.id);
}

/** ALL CUPS TOUCHING (Matt, 2026-11-04: "we need to add a rule so that all cups are touching"): every
 *  cup joined to every other through cups that touch, one group, no cup or group standing apart. */
export function allTouching(cups) {
  if (!Array.isArray(cups) || cups.length <= 1) return true;
  const pts = cups.map((k) => cellXZ(k));
  const seen = new Set([0]);
  const todo = [0];
  while (todo.length) {
    const i = todo.pop();
    for (let j = 0; j < pts.length; j++) {
      if (!seen.has(j) && Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < TOUCHING) { seen.add(j); todo.push(j); }
    }
  }
  return seen.size === pts.length;
}

/** How many touching pairs a rack has - the computer's measure of a tidy rack. */
export function touchingPairs(cups) {
  const pts = cups.map(cellXZ);
  let n = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < TOUCHING) n++;
  }
  return n;
}

// --- MAKE YOUR OWN, ANYWHERE (2026-11-03, Matt: "I want to be able to move the cups however I want. Not in
// this exact grid. I want a stop light with two to the left filling the gaps you know?") -------------------
// A custom rack is a list of exact SPOTS ({ u, v }, cup-widths, the same spots the presets use), anywhere
// inside the rack area, no two overlapping, at least one against the back wall (v = 0). The old hex-cell
// custom racks still replay as cells (challenges made before). The editor drops a cup with `settleSpot`:
// near another cup or the back wall it slides into contact (so a cup put in a gap nestles touching both
// sides of it); on top of a cup it moves to the nearest place it fits.

/** The rack area for a spot, in cup-widths: the same box the cells span. */
export const FREE = { uMax: AREA.cMax / 2, vMax: AREA.rMax * HEX };
const TOUCH = 1;            // centres one cup-width (the pitch) apart = touching
const SNAP = 0.3;           // a drop this close to touching (cup-widths) slides into contact
const SNUG = 0.4;           // ...and this close to a snug or straight-line place, into that

/** Any cup's place as a spot: a cell becomes the same place. */
export function spotOf(k) {
  return isSpot(k) ? { u: k.u, v: k.v } : { u: k.c / 2, v: k.r * HEX };
}

/** Inside the area and clear of every other cup. */
export function freeOk(p, others) {
  return !!p && Number.isFinite(p.u) && Number.isFinite(p.v)
    && Math.abs(p.u) <= FREE.uMax + 1e-9 && p.v >= -1e-9 && p.v <= FREE.vMax + 1e-9
    && others.every((q) => Math.hypot(p.u - q.u, p.v - q.v) >= TOUCH - 1e-9);
}

/** Where a cup dropped at `p` comes to rest among `others` (spots), or null if it fits nowhere near.
 *  SNUG places pull from further (`SNUG`): touching two things (two cups, or a cup and the back wall),
 *  or IN A STRAIGHT LINE (Matt, 2026-11-04: "I'd like the new one to be easier to put them in a straight
 *  line"): right in front of, behind or beside a cup, or carrying on the line two touching cups make.
 *  Otherwise a drop near one cup or the back wall slides into contact (`snap`); else it stays put. */
export function settleSpot(p, others, snap = SNAP) {
  const cl = (x, a, b) => Math.min(b, Math.max(a, x));
  const c = { u: cl(+p.u || 0, -FREE.uMax, FREE.uMax), v: cl(+p.v || 0, 0, FREE.vMax) };
  const dist = (q) => Math.hypot(q.u - c.u, q.v - c.v);
  const near = others.filter((q) => dist(q) < 2 * TOUCH + SNUG);
  const snug = [];
  const one = [{ u: c.u, v: 0 }];                                  // against the back wall
  for (const q of near) {
    snug.push({ u: q.u, v: q.v + TOUCH }, { u: q.u, v: q.v - TOUCH }, { u: q.u + TOUCH, v: q.v }, { u: q.u - TOUCH, v: q.v });
    const d = dist(q);
    const du = d > 1e-9 ? (c.u - q.u) / d : 0, dv = d > 1e-9 ? (c.v - q.v) / d : 1;
    one.push({ u: q.u + du * TOUCH, v: q.v + dv * TOUCH });       // touching this cup
    if (q.v <= TOUCH) {                                            // touching it AND the back wall
      const w = Math.sqrt(TOUCH * TOUCH - q.v * q.v);
      snug.push({ u: q.u - w, v: 0 }, { u: q.u + w, v: 0 });
    }
  }
  for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) {
    const a = others[i], b = others[j];
    const d = Math.hypot(b.u - a.u, b.v - a.v);
    if (d < 1e-9 || d > 2 * TOUCH) continue;
    const eu = (b.u - a.u) / d, ev = (b.v - a.v) / d;
    if (d < TOUCHING / CUP_D) {                                    // a touching pair: carry its line on
      snug.push({ u: b.u + eu * TOUCH, v: b.v + ev * TOUCH }, { u: a.u - eu * TOUCH, v: a.v - ev * TOUCH });
    }
    const h = Math.sqrt(Math.max(0, TOUCH * TOUCH - (d / 2) ** 2));  // in the gap, touching both
    const mu = (a.u + b.u) / 2, mv = (a.v + b.v) / 2;
    snug.push({ u: mu - ev * h, v: mv + eu * h }, { u: mu + ev * h, v: mv - eu * h });
  }
  const fit = (list) => list.filter((q) => freeOk(q, others)).sort((x, y) => dist(x) - dist(y));
  const okS = fit(snug), okO = fit(one);
  if (okS.length && dist(okS[0]) <= SNUG) return okS[0];
  if (okO.length && dist(okO[0]) <= snap) return okO[0];
  if (freeOk(c, others)) return c;
  const any = okS.concat(okO).sort((x, y) => dist(x) - dist(y));
  if (any.length && dist(any[0]) <= 1.2) return any[0];
  for (let r = 0.1; r <= 1.5 + 1e-9; r += 0.1) {                   // squeezed: the nearest free place
    for (let k = 0; k < 24; k++) {
      const q = { u: c.u + r * Math.cos(k * Math.PI / 12), v: c.v + r * Math.sin(k * Math.PI / 12) };
      if (freeOk(q, others)) return q;
    }
  }
  return null;
}
