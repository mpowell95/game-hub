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
