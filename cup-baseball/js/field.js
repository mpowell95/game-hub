// cup-baseball/js/field.js - WHERE THE FOUR CUPS STAND. Pure data, no DOM, no engine.
//
// Cup Pong's table, cups and ball are reused as they are (cup-pong/js/geom.js, physics.js): same
// sizes, same throw, same physics. Only the rack is this game's: four cups in a straight line down
// the middle of the table, single nearest the shooter, home run against the back edge. Cups stand
// apart (not touching), so a ball that is short of one cup can drop into the cup in front of it.
//
// Positions are in the SHOOTER'S frame, the way cup-pong's physics and render take them: the
// shooter's ball waits at z = 0 and throws toward -z.

import { RACK_Z0 } from '../../cup-pong/js/geom.js';

/** Centre-to-centre gap along the table, metres. A cup is 9.5 cm across, so ~8 cm of felt between. */
export const GAP = 0.175;

/** The four cups, far to near: id is the hit it is worth. */
export const CUPS = [
  { id: 'h4', hit: 4, x: 0, z: RACK_Z0 },
  { id: 'h3', hit: 3, x: 0, z: RACK_Z0 + GAP },
  { id: 'h2', hit: 2, x: 0, z: RACK_Z0 + GAP * 2 },
  { id: 'h1', hit: 1, x: 0, z: RACK_Z0 + GAP * 3 },
];

export const hitOf = (id) => { const k = CUPS.find((c) => c.id === id); return k ? k.hit : 0; };
export const cupFor = (hit) => CUPS.find((c) => c.hit === hit) || null;

/** The middle of the line, along the table: where the flick's aim is measured. */
export const MID_Z = RACK_Z0 + GAP * 1.5;

export default { CUPS, GAP, hitOf, cupFor, MID_Z };
