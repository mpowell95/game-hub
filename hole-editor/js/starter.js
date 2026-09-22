// hole-editor/js/starter.js - THE BLANK COURSE a new designer starts from (2026-09-22).
//
// Matt: *"I have a request for the hole editor/hole creator to be a tool I can send to the king of
// games and have him create a course... We'd have to set up or create basic holes for him to start
// with."* So: eighteen plain holes that every one of the editor's tools can then shape. Nothing on
// them but tee, fairway, rough, a round green and the course's default tree belts - no bunkers, no
// water, no hand-placed trees, no guard presets. Par 72 (36 out, 36 in), lengths in the middle of
// each par's range, and a gentle bend on a few so the strip is not eighteen identical sticks.
//
// Every spec here must build and validate on BOTH themes (test-hole-editor.mjs checks it): the
// theme only swaps the belt species and the rough collar, never the geometry.

import { OBSTACLE_CATALOG, OBSTACLE_INDEX } from '../../golf/js/obstacles.js';

/** THE PRE-CATALOGUE TABLES, kept for the migration ONLY (2026-09-22).
 *
 *  Until the obstacle catalogue these WERE the Course Creator's two obstacle tables - three entries
 *  each, copied from Pine Valley and Red Mesa - and every tree a designer placed stored an index
 *  0-2 into whichever one their theme had selected. `migrateDocument` in model.js re-indexes those
 *  saved drafts onto the catalogue, and these arrays are the record of what index 0, 1 and 2 meant.
 *  Nothing builds a hole from them any more. Do not delete them and do not reorder them: they are
 *  the only statement anywhere of what a pre-catalogue draft's numbers referred to (THE LAW rule 5). */
export const PARKLAND_TYPES = [
  { name: 'pine', trunk: 0.6, canopy: 4.5, height: 18 },
  { name: 'oak', trunk: 1.0, canopy: 8.0, height: 13 },
  { name: 'sentinel', trunk: 1.2, canopy: 5.0, height: 40 },
];

export const DESERT_TYPES = [
  { name: 'saguaro', trunk: 0.9, canopy: 1.8, height: 15 },
  { name: 'paloverde', trunk: 0.7, canopy: 6.5, height: 8 },
  { name: 'boulder', trunk: 3.2, canopy: 3.2, height: 40 },
];

/** BOTH LOOKS NOW DRAW FROM THE WHOLE CATALOGUE (2026-09-22, docs/HANDOFF-GOLF-OBJECTS.md s1).
 *
 *  `treeTypes` is the same array on both, so a theme switch no longer re-points every placed tree
 *  at a different species - it only changes what the BELTS default to and how the palette orders
 *  its tiles. What the look actually carries is the belt species: pines line a parkland hole,
 *  saguaros a desert one.
 *
 *  `type` sits on each SIDE, not on `belts` itself, because that is where holegen.js reads it
 *  (`b.type || 0`, one `b` per side). A single `belts.type` would be silently ignored. */
const BELT = (name) => ({
  left: { depth: 20, spacing: 14, type: OBSTACLE_INDEX[name] },
  right: { depth: 20, spacing: 14, type: OBSTACLE_INDEX[name] },
});

export const THEME_DEFAULTS = {
  parkland: {
    treeTypes: OBSTACLE_CATALOG,
    belts: BELT('pine'),
  },
  desert: {
    treeTypes: OBSTACLE_CATALOG,
    rough: 7,
    belts: BELT('saguaro'),
  },
  // Links and Tropical (2026-09-22): the render.js palettes of the same names, lined with gorse
  // and with palms. Every catalogue entry is still available on every look.
  links: {
    treeTypes: OBSTACLE_CATALOG,
    rough: 6,
    belts: BELT('gorse'),
  },
  tropical: {
    treeTypes: OBSTACLE_CATALOG,
    belts: BELT('palm'),
  },
  // Mountain and Swamp (2026-09-22): spruce woods; willows standing in flooded ground.
  mountain: {
    treeTypes: OBSTACLE_CATALOG,
    belts: BELT('spruce'),
  },
  swamp: {
    treeTypes: OBSTACLE_CATALOG,
    rough: 7,
    belts: BELT('willow'),
  },
};

/** [par, length in yards, bend in yards (+ right, - left, 0 straight)] for the 18 starters. */
const PLAN = [
  [4, 380, 0], [3, 165, 0], [4, 400, 18], [5, 520, -22], [4, 360, 0], [4, 415, -16], [3, 150, 0], [5, 505, 20], [4, 390, 0],
  [4, 370, 14], [5, 535, 0], [3, 180, 0], [4, 405, -18], [4, 355, 0], [3, 160, 0], [4, 420, 16], [5, 515, -20], [4, 395, 0],
];

const SLOPES = ['gentle', 'crown', 'bowl', 'tier', 'saddle', 'quarters'];

/** One starter recipe for a slot (1-based). Cycles through PLAN past 18, so "add a hole" has one. */
export function starterSpec(slot) {
  const [par, len, bend] = PLAN[(slot - 1) % PLAN.length];
  const path = bend
    ? [[0, 5], [bend * 0.35, Math.round(len * 0.55)], [bend, len]]
    : [[0, 5], [0, len]];
  const w0 = par === 3 ? 12 : 17;
  const w1 = par === 3 ? 10 : 14;
  return {
    par,
    nickname: `Hole ${slot}`,
    path,
    fw: [{ at: 0, w: w0 }, { at: 0.5, w: w1 }, { at: 1, w: 13 }],
    hard: +((slot - 1) / 17).toFixed(3),
    seed: 1000 + slot * 97,
    greenSeed: 5000 + slot * 131,
    defend: false,
    slope: SLOPES[(slot - 1) % SLOPES.length],
  };
}

export const STARTER_SPECS = PLAN.map((_, i) => starterSpec(i + 1));
