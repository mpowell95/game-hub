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
// The Gentleman's line (PRESETS.line2) is not a rerack and keeps its own placement.
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

/** Cups with no other cup touching them (brief: "island"). Touching = centres one cup apart. */
export function islandsOf(cups) {
  const pts = cups.map((k) => ({ id: k.id, ...cellXZ(k) }));
  return pts.filter((p) => !pts.some((o) => o !== p && Math.hypot(o.x - p.x, o.z - p.z) < CUP_D * 1.08)).map((p) => p.id);
}

/** How many touching pairs a rack has - the computer's measure of a tidy rack. */
export function touchingPairs(cups) {
  const pts = cups.map(cellXZ);
  let n = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < CUP_D * 1.08) n++;
  }
  return n;
}
