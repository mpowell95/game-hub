// golf/js/obstacles.js - THE OBSTACLE CATALOGUE (2026-09-22).
//
// Matt: *"we need more options for objects too. More trees, rocks, power lines, water, swamp, etc.
// lots of stuff."* docs/HANDOFF-GOLF-OBJECTS.md section 1 is the spec.
//
// Until this file, every course carried its OWN three-entry `treeTypes` table (Pine Valley's
// pine/oak/sentinel, Red Mesa's saguaro/paloverde/boulder) and a hole's `trees[].type` indexed it.
// That is still true of the shipped courses and is deliberately left alone - they are frozen data
// files whose indices are baked into eighteen recipes each. This is the table a course built in the
// Course Creator draws from instead, so a designer gets seventeen things to place rather than three.
//
// WHAT THE ENGINE READS IS STILL ONLY {trunk, canopy, height}, all in yards (golf/CLAUDE.md,
// "Trees are TWO separate things"): `trunk` blocks at any height, `canopy` blocks a ball below
// `height`. Everything else here is for other layers:
//
//   - `shape` is the RENDERER'S word, and the engine never reads it. An entry whose shape the
//     renderer does not know must still build, validate and play - render.js falls back to
//     `canopy`. That is why the catalogue can grow without a renderer change.
//   - `looks` is the PALETTE'S ordering hint only: a theme's own species are listed first and the
//     rest after. Every entry is available on every look; nothing filters on this.
//   - the UI label is `t('obst_' + name)` (golf/js/strings.js), never `name` itself.
//
// A ROCK is `canopy === trunk` with `height: 40` - this engine's way of saying "solid to every
// club" (the highest-peaking club in the stock bag apexes at 32.3 yds, which is why 40 and not 30;
// golf/courses/redmesa.js records that measurement). A LOG is the opposite: 1.5 yds tall, so every
// club in the bag flies it and only a putt or a thinned shot ever meets one.
//
// ** THE ORDER IS FROZEN THE MOMENT THIS SHIPS. ** A Course Creator course exports
// `treeTypes: OBSTACLE_CATALOG` verbatim and every placed tree stores an INDEX into it, so
// reordering or removing an entry silently turns every saved draft's pines into oaks. APPEND ONLY.
// (hole-editor/js/model.js's `migrateDocument` exists because the pre-catalogue three-entry tables
// had to be re-indexed exactly once; there must never be a second one.)

export const OBSTACLE_CATALOG = [
  // name        shape      trunk canopy height  looks (which themes list it first)
  { name: 'pine', shape: 'fir', trunk: 0.6, canopy: 4.5, height: 18, looks: ['parkland'] },
  { name: 'oak', shape: 'canopy', trunk: 1.0, canopy: 8.0, height: 13, looks: ['parkland'] },
  { name: 'sentinel', shape: 'fir', trunk: 1.2, canopy: 5.0, height: 40, looks: ['parkland'] },
  { name: 'maple', shape: 'canopy', trunk: 0.9, canopy: 7.0, height: 14, looks: ['parkland'] },
  { name: 'birch', shape: 'canopy', trunk: 0.5, canopy: 3.5, height: 12, looks: ['parkland'] },
  { name: 'willow', shape: 'willow', trunk: 1.0, canopy: 9.0, height: 12, looks: ['parkland'] },
  { name: 'cypress', shape: 'cypress', trunk: 0.7, canopy: 2.5, height: 22, looks: ['parkland'] },
  { name: 'deadtree', shape: 'dead', trunk: 0.7, canopy: 3.0, height: 10, looks: ['parkland', 'desert'] },
  { name: 'bush', shape: 'bush', trunk: 0.4, canopy: 2.5, height: 2, looks: ['parkland', 'desert'] },
  { name: 'palm', shape: 'palm', trunk: 0.5, canopy: 4.0, height: 16, looks: ['desert'] },
  { name: 'saguaro', shape: 'cactus', trunk: 0.9, canopy: 1.8, height: 15, looks: ['desert'] },
  { name: 'paloverde', shape: 'canopy', trunk: 0.7, canopy: 6.5, height: 8, looks: ['desert'] },
  { name: 'joshua', shape: 'joshua', trunk: 0.6, canopy: 3.0, height: 9, looks: ['desert'] },
  { name: 'boulder', shape: 'rock', trunk: 3.2, canopy: 3.2, height: 40, looks: ['desert', 'parkland'] },
  { name: 'smallrock', shape: 'rock', trunk: 1.5, canopy: 1.5, height: 40, looks: ['desert', 'parkland'] },
  { name: 'rockpile', shape: 'rocks', trunk: 4.5, canopy: 4.5, height: 40, looks: ['desert', 'parkland'] },
  { name: 'log', shape: 'log', trunk: 1.2, canopy: 1.2, height: 1.5, looks: ['parkland'] },
];

/** The catalogue index of a named entry, or -1. Use it wherever an index is needed from code, so a
 *  later append never needs a hand-counted number changed (`OBSTACLE_INDEX.pine`, etc.). */
export const OBSTACLE_INDEX = Object.freeze(
  OBSTACLE_CATALOG.reduce((m, o, i) => { m[o.name] = i; return m; }, {}),
);

/** The catalogue ordered for one look: that look's own species first, in catalogue order, then
 *  everything else, in catalogue order. Returns `{ entry, index }` pairs, because the INDEX is
 *  what a hole stores and the palette must not re-derive it from a filtered array's position. */
export function catalogFor(look) {
  const mine = []; const rest = [];
  OBSTACLE_CATALOG.forEach((entry, index) => {
    ((entry.looks || []).includes(look) ? mine : rest).push({ entry, index });
  });
  return [...mine, ...rest];
}
