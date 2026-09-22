# Golf: more objects for the hole editor (2026-09-22)

Matt: *"we need more options for objects too. More trees, rocks, power lines, water, swamp, etc.
lots of stuff."* This is the spec for the first batch. Power lines are OUT of this batch (the
wire needs a new kind of blocker in the shot physics; separate handoff).

Two agents build it in parallel, in worktrees, on their own dev-server port
(`PORT=8124 node server.mjs`, `PORT=8125 ...`). **File ownership is strict and listed at the end.**
Neither agent touches `sw.js` or `version.json`, and neither pushes. The orchestrator merges,
bumps CACHE, runs suites, opens the PR and deploys.

Read first: `golf/CLAUDE.md` ("The hole-data format", "Trees are TWO separate things"),
`hole-editor/CLAUDE.md` (the Course Creator, the palette), `golf/js/holegen.js`'s `makeHole` header.

---

## 1. The obstacle catalogue (`golf/js/obstacles.js`, NEW, Opus)

Today every course carries its own three-entry `treeTypes` table and the renderer keys art by the
type's `name`. The catalogue is ONE shared table every course can draw from. Existing courses keep
their own tables untouched (Pine Valley, Red Mesa, Oasis Sands do not change).

```js
export const OBSTACLE_CATALOG = [
  // name        shape      trunk canopy height  looks (which themes list it first)
  { name: 'pine',      shape: 'fir',    trunk: 0.6, canopy: 4.5, height: 18, looks: ['parkland'] },
  { name: 'oak',       shape: 'canopy', trunk: 1.0, canopy: 8.0, height: 13, looks: ['parkland'] },
  { name: 'sentinel',  shape: 'fir',    trunk: 1.2, canopy: 5.0, height: 40, looks: ['parkland'] },
  { name: 'maple',     shape: 'canopy', trunk: 0.9, canopy: 7.0, height: 14, looks: ['parkland'] },
  { name: 'birch',     shape: 'canopy', trunk: 0.5, canopy: 3.5, height: 12, looks: ['parkland'] },
  { name: 'willow',    shape: 'willow', trunk: 1.0, canopy: 9.0, height: 12, looks: ['parkland'] },
  { name: 'cypress',   shape: 'cypress',trunk: 0.7, canopy: 2.5, height: 22, looks: ['parkland'] },
  { name: 'deadtree',  shape: 'dead',   trunk: 0.7, canopy: 3.0, height: 10, looks: ['parkland', 'desert'] },
  { name: 'bush',      shape: 'bush',   trunk: 0.4, canopy: 2.5, height: 2,  looks: ['parkland', 'desert'] },
  { name: 'palm',      shape: 'palm',   trunk: 0.5, canopy: 4.0, height: 16, looks: ['desert'] },
  { name: 'saguaro',   shape: 'cactus', trunk: 0.9, canopy: 1.8, height: 15, looks: ['desert'] },
  { name: 'paloverde', shape: 'canopy', trunk: 0.7, canopy: 6.5, height: 8,  looks: ['desert'] },
  { name: 'joshua',    shape: 'dead',   trunk: 0.6, canopy: 3.0, height: 9,  looks: ['desert'] },
  { name: 'boulder',   shape: 'rock',   trunk: 3.2, canopy: 3.2, height: 40, looks: ['desert', 'parkland'] },
  { name: 'smallrock', shape: 'rock',   trunk: 1.5, canopy: 1.5, height: 40, looks: ['desert', 'parkland'] },
  { name: 'rockpile',  shape: 'rocks',  trunk: 4.5, canopy: 4.5, height: 40, looks: ['desert', 'parkland'] },
  { name: 'log',       shape: 'log',    trunk: 1.2, canopy: 1.2, height: 1.5, looks: ['parkland'] },
];
```

Rules:

- **The order is frozen once shipped.** A Course Creator course exports `treeTypes: OBSTACLE_CATALOG`
  (the whole table, verbatim, in this order) and every placed tree stores an index into it. Append
  only, never reorder, never remove.
- `trunk`, `canopy`, `height` mean exactly what they mean today (`golf/CLAUDE.md`, "Trees are TWO
  separate things"): the engine's `treeHit` reads only those three. A rock is `canopy === trunk`
  with `height: 40` (solid to everything). A log is a low round obstacle for now (flyable by
  every club; blocks a putt or a thin shot). Nothing in `shot.js` changes for this batch.
- `shape` is the RENDERER's word (section 3). The engine never reads it. Adding an entry with an
  unknown `shape` must still build, validate and play (the renderer falls back to `canopy`).
- `looks` is the PALETTE's ordering hint only: a theme's own species come first, the rest after.
  Every entry is available on every look.
- `label` for the UI comes from `golf/js/strings.js`: `obst_<name>` in `en` and `es` (Opus adds
  them). The palette shows `t('obst_' + name)`; the tree panel's type picker too.
- `validateHole` gains nothing new for these; the existing `treeTypes[i]` sanity check covers them.
- The Course Creator (`hole-editor/js/starter.js`, `course.js`, `model.js`): a custom document's
  defaults use `treeTypes: OBSTACLE_CATALOG` for BOTH looks; `THEME_DEFAULTS[look].belts.type`
  points at the catalogue index of `pine` (parkland) or `saguaro` (desert). Existing custom
  drafts (indices 0-2 into the old 3-entry tables) are migrated on load: parkland 0/1/2 →
  pine/oak/sentinel indices, desert 0/1/2 → saguaro/paloverde/boulder indices. Write the
  migration in `model.js` (`migrateDocument`) and a headless test for it. `export.js` prints the
  catalogue as `TREE_TYPES` in the exported course file (import it from `obstacles.js` rather than
  inlining, so a later catalogue append reaches exported courses too).

## 2. Swamp: a new ground type (Opus, engine + data; Sonnet, its paint)

A new surface kind `'swamp'`. **It is not water**: no penalty stroke, no drop prompt, the ball
just stops dead where it lands and comes out at half power.

Engine (Opus):

- `golf/js/holes.js`: add `'swamp'` to `SURFACE_KINDS`.
- `golf/js/clubs.js`: `LIES.swamp = { power: 0.55, zone: 0.35, roll: 0 }`. `mustPutt`/`canPutt`
  unchanged (never a putt from swamp).
- `golf/js/shot.js`: `PUTT_DRAG.swamp = 7.0`; `groundPoint`'s `noHop` list includes `'swamp'`
  (it plugs like sand). No penalty path, no water branch. `amongTrees` untouched.
- `golf/js/holegen.js`: a `water` recipe entry may carry `kind: 'swamp'` (blob or `poly`, exactly
  like a lake); it becomes a surface of kind `'swamp'` at the same layer as water. Cross bands
  (`cross`) may also take `kind: 'swamp'`. `makeHole` header comment updated.
- `golf/js/strings.js`: `lie_swamp: 'Swamp'` / `'Pantano'`.
- `golf/js/ui.js`: nothing, if the HUD reads `t('lie_' + kind)` and `fillsFor(pal)[kind]` (it does).
- `golf/js/test.js`: `SURFACE_KINDS` assertion still passes; add: a ball landing in swamp has
  `rollYd === 0`, `lieOf('swamp').power === 0.55`, a swamp hole validates, and a swamp cross band
  builds. Add to `validateHole` whatever the poly checks need (nothing beyond the existing).
- Editor model (Opus): `addWater(spec, placement, kind)` accepts `'swamp'`; `addDrawnShape` for
  group `'water'` accepts a `kind`; `setWaterField` can flip `kind`; Copy JSON / export print it.
  Headless tests for each.

Paint (Sonnet): `render.js` `THEMES`: `swamp` and `swampEdge` per theme (parkland: dark
olive-brown water `#3d5a3a` / edge `#5c7a4a`; desert: `#4f6b3a` / `#6f8a4a`); `fillsFor` maps
`swamp`; the map painter fills a swamp poly like water but with a mottled texture (reeds:
short vertical dashes in a darker tone, seeded from the poly like the sand dots are). The editor's
`canvas.js` fill table gets `swamp` too.

## 3. Drawing the new shapes (`golf/js/render.js`, Sonnet)

`treeShapes(px, py, r, cactus)` becomes `treeShapes(px, py, r, shape)` and the three-pass wood
painter dispatches on `shape`:

| shape | top-down silhouette (all inside radius `r`, which is the canopy the ball hits) |
|---|---|
| `canopy` | today's four-circle crown (unchanged) |
| `fir` | a crown of 6-7 small circles in a ring plus one centre, darker; reads as a pointed tree seen from above |
| `willow` | today's crown plus 8-10 thin drooping strokes from the centre past the rim, lighter |
| `cypress` | one tall narrow oval (r × 0.55 wide), dark, with a lighter spine |
| `dead` | a small trunk disc plus 5-6 bare branch strokes radiating, brown-grey, NO green |
| `bush` | three small overlapping circles, brighter green |
| `palm` | a small trunk disc plus 7-8 frond strokes radiating to the rim, each a tapered wedge |
| `cactus` | today's saguaro (unchanged) |
| `rock` | an angular 6-7 sided polygon, grey with a lighter top-left facet and a dark rim |
| `rocks` | three rocks of different sizes overlapping |
| `log` | a rounded rectangle 2.4r long × 0.9r wide, brown, with two ring lines at one end |

`TREE_FILL` gains a colour pair per NAME in the catalogue (shape decides the drawing, name decides
the colour). Shadows keep using `canopy` for their ellipse; a `log` gets no shadow. The editor's
`canvas.js` draws the same silhouettes (import `treeShapes` from `render.js`, do not copy it) and
its `TREE_FILL` copy is replaced by an export from `render.js`.

Stills: after the art, render one contact image of every catalogue entry at r = 40 px on fairway
and on desert floor (`paintTile` from `palette.js` does this for free) and save it to
`reference/golf/obstacles-<date>.png`. The orchestrator reviews it.

## 4. Decor: cosmetic things that never affect play (Sonnet paints, Opus stores)

`decor` entries today are `{ poly }` painted in `pal.path`. Extend:

- `{ poly, kind: 'path' }` (the default, unchanged).
- `{ at: [x, y], kind: 'bench' | 'sign' | 'flagpole', rot }` - a sprite, 3-4 yds across, drawn on
  top of the ground and under the trees. `rot` in degrees, default 0.

Opus: `model.js` mutators `addDecor(spec, kind, x, y)`, `setDecorField`, `deleteDecor`; the
editor's `listObjects` in `canvas.js` is Sonnet's, so agree on the object shape here:
`{ group: 'decor', index, x, y, r: 2 }` for sprites. `validateHole` accepts sprite decor (no
poly). Export/JSON print them. "Cart path" is a DRAWN polygon (the existing draw flow with
group `'decor'`), no polyline tool this batch.

Sonnet: the three sprites in `render.js` (bench: a brown slab with two legs; sign: a post with a
small board; flagpole: a pole with a triangular pennant), the palette tiles for them and for
"Draw a cart path", and their hit-testing/dragging in `canvas.js` like a placed tree.

## 5. The palette (`hole-editor/js/palette.js`, Sonnet)

- "Trees & rocks" lists the whole catalogue: single AND stand for each, ordered by `looks`
  (the current look's species first). Thirty-four tiles is a lot; group them under two sub-heads,
  "Trees" and "Rocks & logs", and give stands their own third sub-head so a designer scrolls past
  what they do not want.
- "Water & waste" gains "Swamp" (blob), "Draw a swamp", "Swamp across".
- A new section "Decor": Bench, Sign, Flagpole, Draw a cart path.
- The sampler hole grows to fit (it is one long par 5 with a row per object; keep every item
  ≥ 40 yds from the next so crops never overlap).

## 6. Tests and docs

- Opus: `golf/js/test.js` (swamp), `test-hole-editor.mjs` (migration, swamp/decor mutators,
  export prints them), `golf/CLAUDE.md` (the catalogue and swamp, under "The hole-data format").
- Sonnet: `test-hole-editor-ui.mjs` (a swamp tile places a swamp; a bench tile places a bench;
  the palette shows every catalogue entry), `hole-editor/CLAUDE.md` (the palette sections).
- Both: `node test-hole-editor.mjs` and `node test-game-conventions.mjs` green before reporting.
  Sonnet also runs `node test-hole-editor-ui.mjs` (needs the agent's own server port; it reads
  `HOLE_EDITOR_URL`).

## 7. File ownership

| Opus (engine, persistence) | Sonnet (screens, art, stills) |
|---|---|
| `golf/js/obstacles.js` (new) | `golf/js/render.js` |
| `golf/js/holes.js`, `clubs.js`, `shot.js`, `holegen.js`, `strings.js` | `hole-editor/js/palette.js`, `canvas.js`, `panels.js`, `editor.css` |
| `hole-editor/js/model.js`, `starter.js`, `course.js`, `export.js` | `test-hole-editor-ui.mjs`, `hole-editor/CLAUDE.md` |
| `golf/js/test.js`, `test-hole-editor.mjs`, `golf/CLAUDE.md` | `reference/golf/obstacles-*.png` |

`hole-editor/js/main.js` is nobody's unless a one-line wiring change is unavoidable; say so in the
report. `sw.js`, `version.json`, `golf/courses/*` are untouchable. Do not push.

Contract both sides depend on and neither may change alone: the catalogue's `name` and `shape`
values in section 1, the surface kind name `'swamp'`, the theme keys `swamp`/`swampEdge`, and
the decor object shapes in section 4.
