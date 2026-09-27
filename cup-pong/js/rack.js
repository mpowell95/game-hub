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

import { CUP_D, ROW_H, RACK_Z0, TABLE, CUP } from './geom.js';

/** Rack-area bounds, in cells. Row 4 is one row nearer the shooter than the triangle's point, for
 *  shapes deeper than the triangle; |c| <= 5 keeps every rim on the table with a margin. */
export const AREA = { cMax: 5, rMax: 4 };

export const isCell = (cell) => !!cell && Number.isInteger(cell.c) && Number.isInteger(cell.r)
  && Math.abs(cell.c + cell.r) % 2 === 1;

export const inArea = (cell) => isCell(cell)
  && cell.r >= 0 && cell.r <= AREA.rMax && Math.abs(cell.c) <= AREA.cMax;

/** A cell's centre on the table, in metres (x across, z along; z is negative, the far end). */
export function cellXZ(cell) {
  return { x: cell.c * CUP_D / 2, z: RACK_Z0 + cell.r * ROW_H };
}

export const PRESETS = {
  // 10 cups, 4-3-2-1, point toward the shooter.
  tri10: [
    { c: -3, r: 0 }, { c: -1, r: 0 }, { c: 1, r: 0 }, { c: 3, r: 0 },
    { c: -2, r: 1 }, { c: 0, r: 1 }, { c: 2, r: 1 },
    { c: -1, r: 2 }, { c: 1, r: 2 },
    { c: 0, r: 3 },
  ],
};

/** A fresh rack from a preset: [{ id, c, r }]. */
export function makeRack(preset = 'tri10') {
  const cells = PRESETS[preset];
  if (!cells) throw new Error('unknown rack preset ' + preset);
  return cells.map((cell, i) => ({ id: 'k' + i, c: cell.c, r: cell.r }));
}

/** Is this a legal rack? Every cup on a real cell inside the area, no two on the same cell. */
export function validRack(cups) {
  if (!Array.isArray(cups)) return false;
  const seen = new Set();
  for (const k of cups) {
    if (!k || typeof k.id !== 'string' || !inArea(k)) return false;
    const key = k.c + ',' + k.r;
    if (seen.has(key)) return false;
    seen.add(key);
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
