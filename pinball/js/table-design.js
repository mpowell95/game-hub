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
import { FOOTPRINTS, TRANSITIONS, PARTS } from '../design/board.js';

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
// A RAMP IS A CLIMB, NOT A DESTINATION. `to` used to be a point in the MIDDLE OF THE DECK and the
// ball was moved there in one step. Matt: *"the ball teleports all over the place. When the ball
// goes down the right ramp, it teleports to the middle of the board on level 2."*
//
// `top` is where the ramp physically ENDS - its own mouth on the deck edge, on the ramp's own
// centre line - and js/design.js walks the ball from the foot to the top over RAMP_CLIMB seconds,
// lifting it as it goes. STARHUB's habitrail is scripted the same way and for the same reason;
// pinball/CLAUDE.md calls it *a scripted habitrail, not simulated*, which is far kinder than
// trying to solve a banked wire in 2D.
// THE MOUTH MOVED, AND THAT IS THE WHOLE FIX. It used to be x 45..150 at py 908, hard against the
// side wall, where a rising ball essentially never went: over 30 driven games exactly ONE upward
// crossing of py 908 landed in it, and none at all in the right one, out of 21 upward crossings
// at that height anywhere on the board. The mouth measured off the reference photo is 84 px
// further inboard and catches 15 of those 21.
export const RAMPS = [
  { id: 'rampL', x: [px(129), px(231)], y: px(933), foot: px(180), minEntry: 330, top: { x: px(92),  y: px(596), vx: 150, vy: -150 } },
  { id: 'rampR', x: [px(755), px(857)], y: px(933), foot: px(806), minEntry: 330, top: { x: px(894), y: px(596), vx: -150, vy: -150 } },
];

/**
 * THE ONE-WAY KICKERS, one just in front of each mouth, on level 1.
 *
 * Matt: *"maybe we put a little speed boost thing on level 1 just in front of the ramp so it can
 * make it up the incline. This boost would have to be 1-way functional ONLY. And allow for the
 * ball to roll down the ramp without being shot back up it."*
 *
 * `u` is the unit vector UP THE LANE, taken from the lane's own first segment (the mouth at
 * py 933 to the next measured point at py 886), not from vertical - the lane leaves the mouth at
 * 26 degrees off upright, so a kicker aimed up the page would fire the ball at the rail.
 *
 * ONE-WAY IS `minAlong`, NOT A FLAG. The push only happens when the ball's velocity ALREADY has
 * a component up the lane bigger than `minAlong`. A ball rolling back down has a negative
 * component and gets nothing, which is the behaviour asked for; a ball dribbling sideways across
 * the pad gets nothing either, so it cannot be used as a free ride.
 */
/**
 * HOW HIGH IS THE RAMP FLOOR UNDER A BALL AT (x, y)? 0 on the playfield, 1 at deck height,
 * null when the point is not inside a lane at all.
 *
 * Matt, twice: *"the ball still went through the ramp and disappeared."* It is not going
 * through anything. A ball on LEVEL 1 inside a ramp lane - one that dribbled into the mouth
 * too slowly to trigger the climb, or one that rolled off the deck edge at x 45..150, where
 * that edge IS the top of the ramp - is drawn at playfield height, while the ramp surface
 * over it climbs to deck height. Measured over 24 driven games: 5,391 of 115,019 frames, so
 * roughly one frame in twenty, the ball is underneath the lane it is rolling along. It comes
 * back into view at the mouth, where the surface returns to the playfield - which is exactly
 * the *"then popped back into existence"* half of the report.
 *
 * The bend and the ease below are the SAME two expressions rampCurved builds the surface from
 * and the footprint pass builds the walls from. Three copies would drift; this is the third
 * reader of one shape, not a fourth shape.
 */
/**
 * The lane under a point: its floor height (0 on the playfield, 1 at deck height) AND the x of
 * its two walls there. null when the point is not inside a lane at all.
 */
export function rampLane(x, y) {
  for (const p of PARTS) {
    if (p.type !== 'ramp') continue;
    const xf = p.xFoot || p.x;
    const t = (p.z[1] - y / px(1)) / (p.z[1] - p.z[0]);
    if (t < 0 || t > 1) continue;
    const bend = t * t * (3 - 2 * t) * 0.45 + t * 0.55;
    const x0 = xf[0] + (p.x[0] - xf[0]) * bend, x1 = xf[1] + (p.x[1] - xf[1]) * bend;
    const bx = x / px(1);
    if (bx < Math.min(x0, x1) || bx > Math.max(x0, x1)) continue;
    return { lift: t * t * (3 - 2 * t), x0: Math.min(x0, x1), x1: Math.max(x0, x1) };
  }
  return null;
}

/** Just the height, for the many callers that only want that. */
export function rampLift(x, y) {
  const lane = rampLane(x, y);
  return lane === null ? null : lane.lift;
}

export const KICKERS = [
  { id: 'kickL', x: px(242), y: px(1059), r: px(34), u: [-0.44, -0.90], boost: 250, minAlong: 120 },
  { id: 'kickR', x: px(744), y: px(1059), r: px(34), u: [0.44, -0.90], boost: 250, minAlong: 120 },
];
/**
 * WHERE THE DECK ENDS, AT A GIVEN x - read off the deck_L2 polygon itself.
 *
 * The rules used to decide a ball had left the deck with `y > px(760)` and two hardcoded x
 * bands, and the deck MESH is not that shape: it runs to py 760 across the middle, but only to
 * py 596 outboard of x 150 and x 836, where the ramps are, and it is cut back to py 724 for the
 * drop hole. So the drawing and the rule disagreed in four places at once. The worst of them:
 * between x 150 and 200 the rule kept the ball ON level 2 while the mesh had already ended, so a
 * ball rode down past the flippers on nothing at all and drained where no flipper could reach it.
 *
 * Asking the polygon means they cannot disagree again, whatever shape the deck becomes.
 */
const DECK_POLY = (PARTS.find((p) => p.name === 'deck_L2') || { pts: [] }).pts;
export function deckEdge(x) {
  const bx = x / px(1);                       // back to reference pixels, which is what pts are in
  let edge = null;
  for (let i = 0; i < DECK_POLY.length; i++) {
    const a = DECK_POLY[i], b = DECK_POLY[(i + 1) % DECK_POLY.length];
    if ((a[0] > bx) === (b[0] > bx)) continue;   // this edge does not span x
    const t = (bx - a[0]) / (b[0] - a[0]);
    const y = a[1] + (b[1] - a[1]) * t;
    if (edge === null || y > edge) edge = y;     // the FRONT edge is the lowest crossing
  }
  return edge === null ? null : px(edge);
}

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
    // A footprint's `oneWay` is already a unit normal in table axes, which is what physics.js wants.
    if (f.oneWay) o.oneWay = f.oneWay;
    // ...and a slingshot's kickN, which says WHICH face the coil is behind. Without it the
    // guard in physics.js is dead and the face fires from both sides.
    if (f.kickN) o.kickN = f.kickN;
    if (f.shape === 'circle') colliders.push(circle(ux(f.c[0]), uy(f.c[1]), f.r * K, o));
    else colliders.push(seg(ux(f.a[0]), uy(f.a[1]), ux(f.b[0]), uy(f.b[1]), { ...o, r: f.r * K }));
  }
  return { colliders, flippers };
}

/**
 * Sensors: the saucer, and the rollover inserts.
 *
 * EVERY ONE IS READ OFF THE PART IT BELONGS TO. These used to be a hand-copied list of
 * coordinates, written when the inserts were first laid out - and then the inserts moved. The
 * symmetry pass respaced the blue and red rows, and Matt moved all four magenta inserts to the
 * UPPER DECK. The switches stayed where they were, so every painted insert had slid out from
 * under its own sensor: the magenta row was drawn on level 2 while its switches sat on the
 * playfield, and the blue row's ends were 60 px adrift. A player rolled over paint and scored
 * nothing, or scored from bare wood.
 *
 * Deriving them means the light and the switch cannot disagree again, whatever the editor does
 * next. The LEVEL comes from the part too, so a level-2 insert is only tripped by a level-2 ball.
 */
export const SWITCHES = [{ id: 'saucer', kind: 'saucer', level: 1, x: SAUCER.x, y: SAUCER.y, r: SAUCER.r }];
export const ROW_NAMES = ['magenta', 'blue', 'red'];
export const ROW_SIZE = {};
{
  const num = (n) => Number(n.split('_').pop()) || 0;
  const levelOf = (p) => (p.levels && p.levels.length === 1 ? p.levels[0] : 1);
  for (const row of ROW_NAMES) {
    const parts = PARTS.filter((p) => p.type === 'disc' && p.name.startsWith(`insert_${row}_`))
      .sort((a, b) => num(a.name) - num(b.name));
    ROW_SIZE[row] = parts.length;
    parts.forEach((p, i) => SWITCHES.push({
      id: `${row}${i}`, row, level: levelOf(p), x: px(p.at[0]), y: px(p.at[1]), r: px(34),
    }));
  }
  // The gold inserts - one originally, three since Matt duplicated it. Each is its own rollover.
  PARTS.filter((p) => p.type === 'disc' && p.name.startsWith('insert_yellow_center'))
    .forEach((p, i) => SWITCHES.push({
      id: i ? `centre${i}` : 'centre', kind: 'yellow', level: levelOf(p), x: px(p.at[0]), y: px(p.at[1]), r: px(30),
    }));
}

/** The drop-target bank across the top of the deck. */
// One id per target, matching the four colliders board.js now emits for the bank.
export const DROP_IDS = [0, 1, 2, 3].map((i) => `target_bank_${i}`);

export default {
  rampLift,
  rampLane,
  NAME, W, H, DRAIN_Y, AXIS, PLUNGER, LAUNCH_LEVEL, RAMPS, KICKERS, DROP_HOLE, SAUCER,
  SWITCHES, ROW_NAMES, ROW_SIZE, DROP_IDS, buildLevel, BALL_R, U, px, TRANSITIONS, deckEdge,
};
