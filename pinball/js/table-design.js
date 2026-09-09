// pinball/js/table-design.js - the FOUNDRY board, adapted from the Claude Design export.
//
// WHERE IT CAME FROM. `pinball/design/board.js` is a three.js model of the wooden reference table
// plus a `FOOTPRINTS` list - the top-down collision shape of every part a ball can touch, per level.
// This file is the adapter: footprints in, js/physics.js colliders out. The export is NOT hand-
// edited into the engine's own vocabulary, because that would be a second copy of the geometry that
// could drift; `design/board.js` stays the one source and this reads it.
//
// UNITS. The export is metres with a 0.027 m ball. This engine is table units with `BALL_R` 9, so
// one metre is 666.67 units - the same K STARHUB was converted at - and one reference pixel is
// 0.3513 units. Nothing about the solver is re-tuned.
//
// TWO LEVELS, as ROYAL FLUSH and RAINBOW already do: one world each, every ball carrying the level
// it is on. Level 1 is the main playfield (it runs UNDER the upper deck); level 2 is the deck.
//
// THE LAUNCH CHUTE IS BESIDE THE BOARD, NOT PART OF IT. Matt: *"the chute is BESIDE the game board.
// NOT part of it. The left wall of the chute is the rightmost - final - wall of the actual playing
// board."* Three builds went wrong carving it out of the playfield's width; the cabinet is wider
// instead, and the chute hangs off the outboard face of the board's right wall.

import { seg, circle, flipper, BALL_R } from './physics.js';
import { FOOTPRINTS, TRANSITIONS } from '../design/board.js';

export const NAME = 'FOUNDRY';

const K = 666.67;                        // units per metre
const S = 0.000527, CX = 493, CY = 995;  // the export's own pixel scale and origin
/** One reference pixel, in table units. Every number below that came off the reference image is
 *  quoted in PIXELS, because that is what the export measured in. */
export const U = S * K;
const ux = (m) => (m / S + CX) * U;
const uy = (m) => (m / S + CY) * U;
/** Reference pixel -> table unit, for anything this file has to place itself. */
export const px = (p) => p * U;

export const W = px(1100);
export const H = px(1990);
export const DRAIN_Y = px(1880);
/** The PLAY AREA's centre, which is not the cabinet's: the chute takes the right-hand 160 px. */
export const AXIS = px(493);

export const PLUNGER = { x: px(1020), y: px(1840) };
/** THERE IS NO LAUNCH DESTINATION ANY MORE, AND THAT IS THE POINT. The plunged ball is served
 *  on LEVEL 2 and rides the shooter lane the whole way up under the solver; the board right wall
 *  stops at py 300 on that level, so the ball rolls out of the lane and onto the deck through a
 *  real opening. Two earlier builds teleported it instead - first into the chute itself (it fell
 *  off the deck and a 60-second game scored zero), then 140 px sideways through a solid wall,
 *  which is what Matt saw: "the ball goes up the launch chute then magically appears on the other
 *  side of the wood wall." */
export const LAUNCH_LEVEL = 2;

/** The two ramp mouths, measured off the shot map rather than chosen - see the header of
 *  design/_shots.mjs. A ball reaching one is handed up to level 2. */
// A ramp DELIVERS INTO THE DECK, not back out through its own opening. Landing the ball at the
// mouth (x 87 or 901, just above the deck edge) put it straight back through the same gap it came
// up: it fell out, dropped to the mouth again and re-fired, 1,056 times in six driven games. Each
// one now arrives well inside the deck, heading across it, the way a habitrail hands a ball off.
export const RAMPS = [
  { id: 'rampL', x: [px(45), px(129)], y: px(908), to: { x: px(230), y: px(380), vx: 260, vy: 120 } },
  { id: 'rampR', x: [px(866), px(936)], y: px(908), to: { x: px(756), y: px(380), vx: -260, vy: 120 } },
];
/** The gap in the deck's front lip between the upper flipper tips: the way DOWN to level 1. */
export const DROP_HOLE = { x: [px(455), px(545)], y: px(724), to: { x: px(500), y: px(785) } };

/** The capture saucer under the centre arch's crown. */
export const SAUCER = { x: px(500), y: px(656), r: px(30) };

/**
 * Build one level's world.
 *
 * `down` is the set of drop-target ids currently knocked over; the level is REBUILT rather than
 * mutated when the bank changes, the same discipline js/table.js uses.
 */
export function buildLevel(n, opts = {}) {
  const down = opts.down || new Set();
  const colliders = [];
  const flippers = [];
  for (const f of FOOTPRINTS[n] || []) {
    if (f.dynamic) {
      flippers.push(flipper(ux(f.pivot[0]), uy(f.pivot[1]), f.length * K,
        f.restAngle, f.restAngle + f.sweep, { id: f.name, r: f.rPivot * K }));
      continue;
    }
    if (down.has(f.name)) continue;
    // A slingshot face that kicks, and a pop bumper, are the only parts that push back.
    const kicks = !!f.kicks;
    const o = {
      id: f.name,
      e: kicks ? 0.5 : 0.42,
      // A surface the ball RIDES must not brake it - the rule pinball/CLAUDE.md states for STARHUB.
      mu: /rail|ledge|ramp|apron|chute|wall/.test(f.name) ? 0 : 0.05,
      kick: kicks ? (/bumper/.test(f.name) ? 300 : 250) : 0,
    };
    if (f.shape === 'circle') colliders.push(circle(ux(f.c[0]), uy(f.c[1]), f.r * K, o));
    else colliders.push(seg(ux(f.a[0]), uy(f.a[1]), ux(f.b[0]), uy(f.b[1]), { ...o, r: f.r * K }));
  }
  return { colliders, flippers };
}

/** Sensors: the saucer, and the rollover inserts painted on the lower playfield. */
export const SWITCHES = [{ id: 'saucer', kind: 'saucer', x: SAUCER.x, y: SAUCER.y, r: SAUCER.r }];
{
  // The insert rows, as the export lays them out. They are paint on the model and rollovers here.
  const ROWS = {
    magenta: [[405, 845], [465, 838], [525, 838], [590, 850]],
    blue: [[255, 970], [315, 945], [375, 925], [435, 910], [495, 910], [555, 912], [620, 925], [680, 950], [735, 985]],
    red: [[395, 995], [455, 982], [520, 982], [575, 1005]],
  };
  for (const row of Object.keys(ROWS)) {
    ROWS[row].forEach((p, i) => SWITCHES.push({ id: `${row}${i}`, row, x: px(p[0]), y: px(p[1]), r: px(34) }));
  }
  SWITCHES.push({ id: 'centre', kind: 'yellow', x: px(505), y: px(765), r: px(30) });
}
export const ROW_NAMES = ['magenta', 'blue', 'red'];
export const ROW_SIZE = { magenta: 4, blue: 9, red: 4 };

/** The drop-target bank across the top of the deck. */
export const DROP_IDS = ['target_bank'];

export default {
  NAME, W, H, DRAIN_Y, AXIS, PLUNGER, LAUNCH_LEVEL, RAMPS, DROP_HOLE, SAUCER,
  SWITCHES, ROW_NAMES, ROW_SIZE, DROP_IDS, buildLevel, BALL_R, U, px, TRANSITIONS,
};
