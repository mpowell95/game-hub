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
// theme only swaps the obstacle table and the rough collar, never the geometry.

/** Parkland's obstacle table, the same three Pine Valley uses (golf/courses/pinevalley.js keeps
 *  its own copy un-exported; these numbers are that file's, copied on purpose so a change there
 *  is a decision to make here too). */
export const PARKLAND_TYPES = [
  { name: 'pine', trunk: 0.6, canopy: 4.5, height: 18 },
  { name: 'oak', trunk: 1.0, canopy: 8.0, height: 13 },
  { name: 'sentinel', trunk: 1.2, canopy: 5.0, height: 40 },
];

/** Desert's, copied from Red Mesa for the same reason. */
export const DESERT_TYPES = [
  { name: 'saguaro', trunk: 0.9, canopy: 1.8, height: 15 },
  { name: 'paloverde', trunk: 0.7, canopy: 6.5, height: 8 },
  { name: 'boulder', trunk: 3.2, canopy: 3.2, height: 40 },
];

export const THEME_DEFAULTS = {
  parkland: {
    treeTypes: PARKLAND_TYPES,
    belts: { left: { depth: 20, spacing: 14 }, right: { depth: 20, spacing: 14 } },
  },
  desert: {
    treeTypes: DESERT_TYPES,
    rough: 7,
    belts: { left: { depth: 20, spacing: 14 }, right: { depth: 20, spacing: 14 } },
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
