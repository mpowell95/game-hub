# Build spec: the Red Mesa hole editor (2026-09-16)

This is a BUILD SPEC. Every decision is made. Build what it says; where it is silent on a detail
that does not change what Matt sees or what gets exported, pick the plainest option and note it in
`hole-editor/CLAUDE.md`. Do not redesign, do not add features, do not "improve" the data model.
Matt's own decisions are marked **(Matt)** and are not negotiable.

**Read first:** `golf/CLAUDE.md` "The courses are EDITABLE" (top), "The hole-data format", and
"Holes are DESIGNED, not typed". Then `golf/js/holegen.js`'s `makeHole` header (the recipe
fields) and `golf/courses/redmesa.js` (the recipes themselves, exported as `SPECS`).

---

## 1. Scope

- **Red Mesa only (Matt).** Eighteen holes. Reorder, edit, never add or delete a hole.
- **Not** Oasis Sands (raw traced polygons, no recipe), **not** Pine Valley, **not** the tutorial.
- **Not** in the hub, **not** in `sw.js`, **not** gated, **not** phone-fit. A standalone desktop
  page (Matt).
- **Not** bucket fill, brush, eyedropper, add hole, difficulty measurement, playability sweep,
  reachability (Matt). Fairway slopes are `HANDOFF-GOLF-FAIRWAY-SLOPES.md`, built first.

---

## 2. Where it lives and how it runs

```
hole-editor/
  index.html          the page; imports ./js/main.js as a module
  editor.css          all styling; may @import ../css/ui.css for .gh-btn / .gh-field / .gh-seg
  js/main.js          boot, layout, keyboard, tool switching
  js/model.js         document, normalisation, regeneration, undo (pure, node-testable)
  js/canvas.js        the canvas: camera, drawing, hit-testing, drag handling
  js/panels.js        ribbon + panels (DOM)
  js/export.js        redmesa.js text generation (pure, node-testable)
  CLAUDE.md           what was built, the one-line notes allowed above
test-hole-editor.mjs  at the repo root, node, no browser (section 12)
```

- **No `js/ui.js` in this folder** - `test-game-conventions.mjs` treats any root folder with
  `index.html` + `js/ui.js` as a game.
- Add ONE exclusion to `validate-sw-assets.mjs`'s `EXCLUDED`:
  `{ re: /^hole-editor\//, why: 'Matt-only desktop design tool, never deployed - HANDOFF-GOLF-HOLE-EDITOR.md' }`.
  Nothing from this folder goes into `sw.js` `ASSETS`.
- Run: `node server.mjs`, open `http://localhost:8123/hole-editor/` in Chrome on Matt's PC.
  Design for 1920x1080; must work at 1280x800. No touch handling, no phone anything.
- Imports from the game, unchanged: `../golf/js/holegen.js` (`makeHole`, `SLOPE_PRESETS`,
  `GREEN_SHAPES`), `../golf/js/holes.js` (`validateHole`, `polySelfIntersects`, `distYd`,
  `treesOf`, `surfaceAt`), `../golf/js/render.js` (`buildMap`, `paletteFor`, `fillsFor`),
  `../golf/courses/redmesa.js` (`SPECS`, `RM_DEFAULTS`, `RED_MESA`).

---

## 3. Data model (`js/model.js`)

### 3.1 The document
```js
{
  version: 1,
  courseId: 'redmesa',
  order: ['rm-01', ..., 'rm-18'],          // slot order; index+1 is the hole number on export
  holes: { 'rm-01': { id: 'rm-01', spec: {...}, broken: null | 'error text' }, ... },
}
```
- **A hole's identity is its `id` (Matt).** `rm-NN` is minted from the ORIGINAL slot and never
  changes. Reorder changes `order` only. Reset, compare and the edited marker all go by `id`.
- `spec` is a `makeHole` recipe with `RM_DEFAULTS` NOT merged in (they are applied at
  regeneration and at export exactly as `rm()` does). `treeTypes` is course-level and never in
  a spec.

### 3.2 Normalisation, on first load and on every reset
`normalise(rawSpec, slot)` returns the spec the editor works on. Applied to every entry of
`SPECS`; the results are the ORIGINALS, deep-frozen, kept in memory only (never stored).
1. `n` removed from the spec (it is `order.indexOf(id) + 1` at regeneration and export).
2. Build the hole once with `makeHole({...RM_DEFAULTS, ...rawSpec})` to get `cardYards` (= L).
3. **Every `at` becomes `yd` (Matt):** on each entry of `bunkers`, `water`, `trees`, `sentinels`,
   `yd = +(at * L).toFixed(1)`, `at` deleted. `cross` already uses `yd`; an `at` cross converts
   the same way. `fw`/`fwL`/`fwR` control points keep `at` (they are a profile over the hole,
   not a placed thing).
4. **Seed and difficulty pinned:** if absent, `seed = n*977+13`, `greenSeed = n*6151+991`,
   `hard = (n-1)/17`, using the ORIGINAL `n`. (These are `makeHole`'s own defaults; pinning
   them is what makes a moved hole keep its shapes.)
5. `defend` left as is (absent = true). `belts` left as is.

**Test (section 12):** for all 18, `makeHole({...RM_DEFAULTS, ...normalise(spec), n})` is
`JSON.stringify`-identical to `RED_MESA.holes[n-1]`. This is the correctness contract of the
whole tool. If it fails, nothing else matters.

### 3.3 Regeneration
`build(doc, id)` = `makeHole({ ...RM_DEFAULTS, ...spec, n: slot })` wrapped in try/catch. On
throw: keep the previous built hole for drawing, set `broken` to the message, show it in the
Hole panel in red. Never blocks an edit, never validates (Matt). Built holes are cached per id
and invalidated on any change to that spec or to `order`.

### 3.4 The rules that must hold on every edit
- **R1 yards.** The editor writes `yd` only. Any `at` on a placed thing is a bug.
- **R2 deleted stays deleted (Matt).** Deleting a bunker on a hole writes `defend: false` on that
  spec (once; it stays false). Switching a belt side off writes `belts: {left: false}` /
  `{right: false}` (the other side's object preserved; a hole with no `belts` key gets both
  sides copied in from `RM_DEFAULTS` first so the untouched side does not change).
- **R3 both sand kinds.** A bunker object always carries `kind: 'fairwayBunker' |
  'greensideBunker'`. Never omitted.
- **R4 tee fixed.** `path[0]` is never moved by any tool. Lengthening moves the pin end (Matt).
- **R5 nothing derived twice.** The editor never computes its own fairway polygon, route,
  bounds or yardage. It reads them off the built hole.

### 3.5 Undo
One document-level stack of snapshots `{order, holes}` (JSON), pushed BEFORE each committed
change (a drag pushes once, on pointer-up; a slider pushes on change, not input). Cap 200.
Redo stack cleared on a new change. Reset-hole and reorder are undoable. Undo never crosses a
page reload.

### 3.6 Persistence
- `localStorage['golf.holeEditor.redmesa.v1']` = the document JSON, written 300 ms after the
  last change (debounced). Loaded on boot if present and `version === 1`; otherwise a fresh
  document from the originals. **(Matt: local storage is acceptable.)**
- Originals are never written anywhere. They come from `SPECS` every boot.
- "Discard ALL edits" (Course panel) = confirm dialog, then the fresh document.

---

## 4. Screen layout

Paint 3D is the reference (`reference/paint3d/` on `main`, eight screenshots - look at them).
Fixed docking bays, no floating windows, no panel reordering.

```
+-------------------------------------------------------------------------------+
| RIBBON  48 px: tool buttons, icon over 10 px label, 64 px wide each            |
+---------------+---------------------------------------------+-----------------+
| LEFT 240 px   | CANVAS (fills)                              | RIGHT 320 px    |
|  Legend       |                                             |  Context panel  |
|  Objects list |                                             |  Hole panel     |
|               |                          [zoom slider][Fit] |  Layers panel   |
+---------------+---------------------------------------------+-----------------+
| BOTTOM 150 px: totals | 18 hole thumbnails, horizontal, drag to reorder          |
+-------------------------------------------------------------------------------+
```
- Every panel has a header; clicking it collapses to the header. Collapsed state in
  `localStorage['golf.holeEditor.ui.v1']`.
- Colours: dark chrome (`#1e1e1e` bays, `#2b2b2b` panels, `#e8e8e8` text, accent `#ffce3a` for
  the selected tool and selected object, paired with an outline, never colour alone).
- The canvas background outside the hole's bounds is `#0b0f07`.

### 4.1 Ribbon, left to right
`Select` `Route` `Width` `Bunker` `Water` `Tree` `Belts` `Green` `Slope` `Cross` `Ruler` |
`Undo` `Redo` | `Validate` `Compare` `Reset hole` | `Export`.
Keys: `V R W B H T L G S C M` in that order; `Ctrl+Z` undo, `Ctrl+Y` / `Ctrl+Shift+Z` redo;
`Delete`/`Backspace` deletes the selection; `F` fit; `+`/`-` zoom; `Space`+drag pans; `Esc`
deselects then clears the ruler; `[` / `]` previous / next hole; `Ctrl+E` export.

### 4.2 Bottom strip
- Left: `Par 71 · 6,140 yds` computed live: `sum(par)` and `Math.round(sum(cardYards))` over
  the built holes in `order`. Turns `#ffce3a` with a `Δ` suffix (`Par 71 (+1)`) while it
  differs from the originals' totals.
- Thumbnails: one `<canvas>` per hole, 120x120 css px at dpr 2, drawn from `buildMap(built,
  'desert').canvas` letterboxed (`Math.min(w/map.w, h/map.h)`, never cropped, same rule as
  `ui.js`'s `_paintHoleStrip`). Caption under: `7 · par 4 · 412` (slot, par, rounded yards).
  Marks: a 8 px `#ffce3a` dot top-left when `spec` differs from the original (deep-equal);
  a red `!` top-right when `broken`. Click selects the hole. Drag horizontally to reorder
  (HTML5 drag or pointer-based; the drop target is the slot index); push undo on drop.
  Thumbnails are redrawn only for the ids whose built hole changed.

### 4.3 Right bay
- **Context panel**: the active tool's controls (section 6).
- **Hole panel**: slot and id (`Hole 7 · rm-05`), `nickname` (text), `par` (segmented 3/4/5),
  `Length` (cardYards, 1 dp, read-only), `Width at cursor` (section 5.4, read-only), `Difficulty
  ramp` (`hard`, slider 0..1 step 0.01), `Landing-zone pinch` (`pinchTo`, slider 0.40..1.00,
  with an "auto" checkbox that deletes the key), `Auto-bunker at landing zone` (`defend`
  checkbox; unchecked once any bunker is deleted, R2), `Rough collar` (`rough`, 3..20),
  `broken` message in red if any, and the Validate results list (section 7).
- **Layers panel**: checkboxes, all on by default: Centreline & handles, Route, Objects
  outlines, Trees, Belts, Slope arrows, Bounds, Tee & pin, 50-yd grid.

### 4.4 Left bay
- **Legend**: one swatch per surface kind from `fillsFor(paletteFor('desert'))`, in the order
  fairway, lightRough, heavyRough (labelled "desert floor"), fringe, green, tee, fairwayBunker,
  greensideBunker, water, trees (labelled "scrub floor"). Always visible.
- **Objects list**: every placed thing on the current hole, one row each, grouped: Waypoints
  (index, x/y), Width points, Bunkers (kind, yd), Water (yd), Trees (type, yd), Stands (yd),
  Cross hazards (kind, yd), Guards (token). Clicking a row selects it on the canvas and switches
  to Select. The selected row is highlighted.

---

## 5. The canvas (`js/canvas.js`)

### 5.1 Camera
- World is yards, y UP the hole; screen y down. `sx = (x - cx) * ppy + W/2`, `sy = H/2 - (y - cy) * ppy`.
- `ppy` (px per yard) 0.5..12, default = fit (whole `bounds` visible with 24 px margin).
  Wheel zooms about the cursor by 1.1 per notch. The slider (bottom-right of the canvas, Paint
  3D's bottom-left slider is the reference) is logarithmic over the same range; `Fit` beside it.
- Pan: middle-drag, or `Space`+left-drag. The camera is per hole and remembered in memory for
  the session; switching hole restores that hole's camera or fits.

### 5.2 Drawing order per frame
1. `buildMap(built, 'desert').canvas` (cached with the built hole) drawn with `drawImage`
   scaled from `bounds`; `imageSmoothingEnabled = false` above 3 ppy.
2. Trees: every entry of `treesOf(built)` as a filled circle of radius `canopy * (s||1)` in
   the type's `TREE_FILL` colour (copy the three desert values from `render.js`), trunk as a
   darker dot. Layer "Trees". Belt trees dimmer (60 % alpha) than hand-placed ones.
3. Slope chevrons on the green: same construction as `render.js`'s `drawSlope` (cell centres
   over the green's bounding box, chevron pointing downhill, skipped under `SLOPE_FLAT` 0.06).
   Draw it locally rather than calling `drawSlope` (its camera object is the game's).
4. Route (`built.route`) as a dashed white line, 1 px, 40 % alpha.
5. Centreline: `spec.path` as a solid white line, 1.5 px; waypoints as 10 px squares, tee as
   a 12 px triangle (never draggable), pin as a 12 px circle.
6. Objects outlines: each placed thing's generated polygon (matched by construction order, see
   5.3) stroked 1 px in `#ffffff` 70 %; the selected one in `#ffce3a` 2 px plus its handles.
7. Width handles (Width tool only): section 6.3.
8. Bounds as a dotted rectangle; 50-yd grid as 1 px lines 12 % alpha; tee/pin labels.
9. Ruler line and label; hover readouts.

### 5.3 Matching a spec entry to its polygon
`makeHole` pushes surfaces in a fixed order. Do NOT guess by geometry. Rebuild the mapping the
way `makeHole` builds it: `specBunkers` are pushed in spec order, then the auto-defend bunkers,
then the `cross` bands; `specWater` likewise. The editor computes each placed thing's world
point exactly as `makeHole`'s `place()` does (nearest station by `yd / cardYards`, offset along
the station normal) and draws its own blob outline from `blob(cx, cy, rx, ry, seed, n)` with
the same arguments `makeHole` uses (import `blob`). That is the outline the user sees and
grabs. Its correctness test: for a hole with no edits, every outline coincides with a surface
polygon of the built hole (max vertex distance under 0.2 yd).

### 5.4 Width at cursor
When the cursor is over the hole: find the nearest station of `built.route` (use the route
points as the stations; interpolate), take its normal, and cast both ways to the first crossing
of the built `fairway` polygon's edges. Report `left + right` in yards to 1 dp as `Width at
cursor: 23.4 yd (fairway)`. If the cursor is not between fairway edges, report `-`. This is the
DRAWN width, which includes the pinch, the bend asymmetry, the wobble and the 4.5 yd floor;
the Width tool's slider is labelled "base width" for exactly that reason.

### 5.5 Hit-testing
Handles first (12 px squares), then object outlines (point-in-polygon on the outline), then
nothing. One selection at a time. A drag that starts on nothing pans if `Space` is held,
otherwise does nothing.

---

## 6. Tools and their context panels

Every numeric control is a slider with a number box beside it. Every placement converts the
click point to `{yd, side, off}` via the nearest station of the built hole's dense centreline
(recompute the spline: import `makeHole` only; there is no exported `spline`, so build the
stations from `built.route` densified at 2 yd - the route is the fairway middle, offset from
the centreline by the bend asymmetry; that is acceptable for placement because `yd`/`off` are
authored numbers and the outline drawn back is exact).

### 6.1 Select (V)
Click selects; drag moves a placed thing (bunker, water, tree, stand, cross) by converting the
new point back to `{yd, side, off}`; `Delete` removes it (R2 for bunkers). The context panel
shows the selected thing's own controls (the same controls as its tool, 6.4-6.9).

### 6.2 Route (R)
- Waypoints are draggable except index 0 (the tee, R4). The last one is the pin.
- **Lengthen/shorten = drag the pin (Matt).** While dragging, the Hole panel's Length updates
  live and a label at the pin reads the yardage.
- Double-click on the centreline inserts a waypoint at that point. `Delete` on a selected
  middle waypoint removes it; a path always keeps at least 2 points.
- Context panel: `Dogleg left` / `Dogleg right` buttons. Each inserts one waypoint at the
  drive landing distance (215 yd for par 4 and 5, 55 % of length for par 3) offset 28 yd to
  that side of the straight tee-pin line, replacing any existing waypoint within 40 yd of that
  station. `Straighten` removes every middle waypoint.

### 6.3 Width (W)
- `fw` is shown as control points on BOTH fairway edges at each point's `at` (the drawn edge,
  not `w` itself). Dragging a handle away from the centreline raises that point's `w` (range
  5..30, 0.5 steps); either side's handle edits the same symmetric `fw` point. Double-click on an
  edge inserts a point at that `at`; `Delete` removes one (minimum 2, `at` 0 and 1 always
  present). If the spec has `fwL`/`fwR`, the panel shows a "sides differ" note and edits each
  side's own profile.
- Panel: `Base width, whole hole` slider that scales every `w` by the same factor; the list of
  points as `at · width` rows (width = 2w).

### 6.4 Bunker (B)
Click places `{yd, side, off, r: 10, ry: 7, kind, seed}`, kind = `greensideBunker` if within
40 yd of the pin else `fairwayBunker`, seed = the next integer above the hole's highest used
bunker seed (start `seed0 + 80`). Panel: kind (segmented), `r` 3..18, `ry` 3..14, `Reroll
shape` (seed + 1). Deleting: R2.

### 6.5 Water (H)
Click places `{yd, side, off, rx: 12, ry: 9, seed}`. Panel: `rx`, `ry` 4..30, `Reroll shape`.

### 6.6 Tree (T)
Panel: `Single tree` / `Stand` segmented; type picker (saguaro, palo verde, boulder). Single:
click places `{yd, side, off, type}`. Stand: click places a sentinel `{yd, side, off, n: 5,
spread: 7, type}`; panel adds `n` 2..9, `spread` 3..15.

### 6.7 Belts (L)
Panel only, per side: On/Off, `depth` 8..40, `spacing` 6..20, type. Off writes `false` (R2).
Turning a side back on restores `RM_DEFAULTS.belts[side]`.

### 6.8 Green (G)
Panel: shape (`round`, `long`, `kidney`, `peanut`, `teardrop`, `clover`), `greenAngle` 0..359,
`greenR` and `greenRy` 8..22 (checkbox "same"), `Reroll` (`greenSeed` + 1). Guards: fourteen
checkboxes in two columns, `frontSand`, `frontJaws`, `frontWater`, `frontTrees`, `leftSand`,
`rightSand`, `backSand`, `ringSand`, `leftWater`, `rightWater`, `backWater`, `leftTrees`,
`rightTrees`; order in `guard` = the order checked. Guard tree type picker (`guardTree`).
The green cannot be dragged: it sits at the pin, which the Route tool moves.

### 6.9 Slope (S)
Panel: `Preset` / `Paint` segmented.
- Preset: dropdown of the eleven `SLOPE_PRESETS` names, `Strength` (`slopeK`) 0.3..2.0. Writes
  `slope: '<name>'`, `slopeK`.
- Paint (Matt): the 8x8 grid is drawn over the green's box; dragging inside a cell sets that
  cell's vector to the drag direction with magnitude `min(1, dragPx / 24)`; a click without
  drag zeroes it. Entering Paint from Preset first bakes the preset into cells (`slopeFrom`)
  after a confirm ("Painting replaces the preset"), then writes `slope: {cols: 8, rows: 8,
  cells}` and deletes `slopeK`. `Flatten` zeroes all cells.

### 6.10 Cross (C)
Click on the hole places `{yd, kind: 'water', depth: 22}` at that yardage. Panel: kind
(`water`, `waste`, `fairwayBunker` labelled sand), `depth` 10..40, `over` 0..20 (how far past
the rough it reaches; default absent = 8). Drag along the hole changes `yd`.

### 6.11 Ruler (M)
Click A, click B: a line with `distYd` in yards (1 dp) at its midpoint. A third click starts
over. `Esc` clears.

---

## 7. Validate, Compare, Reset (ribbon)

- **Validate** runs `validateHole(built)` for the current hole and lists every message in the
  Hole panel. Each row is clickable: the canvas pans to the offending point (parsed from the
  message's `[x, y]`), or to the two crossing edges for a `crosses itself` message, and draws
  a red 14 px ring there until the next click. A `broken` hole reports its throw message as the
  only row. A green "No problems" row otherwise. Never runs on its own (Matt).
- **Compare** opens a modal with two canvases side by side, original (built from the frozen
  original spec at the ORIGINAL slot) and current, both letterboxed to the same scale, labelled,
  with each one's par and length. Visual only.
- **Reset hole**: confirm dialog (Matt), then the current hole's spec is replaced by its
  original (by id); pushes undo; the slot is unchanged.

---

## 8. Export (`js/export.js`)

`Export` downloads `redmesa.js`. The text is generated, not templated from the current file:
1. The header comment block of the shipped file, verbatim (copy it into `export.js` as a
   string constant, with a line added: `// EDITED IN THE HOLE EDITOR on <date> - see
   HANDOFF-GOLF-HOLE-EDITOR.md`).
2. `import { makeHole } from '../js/holegen.js';`, `DESERT_TYPES` verbatim, `RM_DEFAULTS`
   verbatim, `const rm = ...` verbatim.
3. For each slot i: `export const SPEC_i = { n: i, ...spec fields... };` then
   `export const HOLE_i = rm(SPEC_i);`. Fields printed in this order: `n, par, nickname, path,
   fw, fwL, fwR, rough, hard, seed, greenSeed, pinchTo, defend, greenR, greenRy, greenShape,
   greenAngle, slope, slopeK, guard, guardTree, cross, bunkers, water, trees, sentinels,
   belts, base, decor`; absent keys omitted; numbers as-is; arrays of points on one line; one
   object per line inside arrays. Two-space indent, single quotes, trailing commas.
4. `SPECS` and `HOLES` arrays in slot order, `RED_MESA` verbatim.
Also a `Copy JSON` button that copies the document.

**Test:** exporting the fresh (unedited, normalised) document and importing the result builds
18 holes identical to `RED_MESA.holes` (write the export to a temp file and `import()` it).

### Fold-back (a session, not the tool)
Replace `golf/courses/redmesa.js` with the export. Run `node golf/js/test.js`. If any par
changed, update `GOLF_COURSE_PAR` in `js/leaderboard-rank.js` (the suite fails until it agrees).
Bump `CACHE`, `validate-sw-assets.mjs`, deploy. The Firebase golf records are Matt's test data
and do not block a renumbering (`golf/CLAUDE.md`, "The courses are EDITABLE").

---

## 9. Phase 2: Play this hole (build after sections 1-8 are done and tested)

Three small game-side changes, all guarded so the shipped game is untouched unless the editor
asked:
1. `golf/js/rounds.js`: `courseById(id)` returns `globalThis.__gfCourseOverride` when that
   object exists and its `id` matches, before searching `COURSES`.
2. `golf/index.html`: if `location.search` contains `editor=1`, before `init()`: read
   `localStorage['golf.holeEditor.redmesa.v1']`, build the course object (`{ id: 'redmesa',
   name: 'Red Mesa (edit)', theme: 'desert', blurbKey: 'blurb_redmesa', holes: [...built in
   order...], get par() {...} }`) with `makeHole` and `RM_DEFAULTS`, and set
   `globalThis.__gfCourseOverride` and `globalThis.__gfNoRecord = true`. Skip `requireName()`
   is NOT allowed; it runs as normal.
3. `golf/js/ui.js`: both `recordGolf` call sites return early when `globalThis.__gfNoRecord`
   is true (an edited hole must never write `bestHole` or a round best).
The editor's `Play` button (ribbon, after Export) opens `/golf/?editor=1` in a new tab. Matt
then picks the hole from the game's own Practice list, which already lists every hole of the
course. No deep-link into a hole: that would be a fourth game change and the setup screen is one
tap away. Test: a `test-visual.mjs`-style Playwright run that opens the page with the override
and asserts the setup screen's course strip shows the editor's `cardYards` for hole 1.

---

## 10. What Sonnet must not do

- Invent a second data format, a second polygon drawer, or its own yardage maths (R5).
- Store `at` on a placed thing (R1). Move the tee (R4). Let a deleted bunker return (R2).
- Add features not listed here, however small. Add touch support. Make it fit a phone.
- Put anything from `hole-editor/` into `sw.js`, or give the folder `js/ui.js`.
- Validate on save, on load, or on a timer.
- Write to the originals, to `golf/courses/redmesa.js`, or to Firebase.
- Change `holegen.js`, `holes.js` or `render.js` (phase 2's three edits are the only game
  changes, and they are listed in full).

---

## 11. Order of work

1. `model.js` + `test-hole-editor.mjs` sections 3.2 and 8 tests green (no UI yet).
2. `export.js` + its round-trip test.
3. Canvas: map, camera, thumbnails, hole switching, reorder. Screenshot every hole and compare
   against `sheet-course.mjs`'s output for Red Mesa by eye.
4. Tools in ribbon order. After each tool, edit hole 1 with it, Validate, Export, fold the
   export into a scratch copy and run `node golf/js/test.js` against it.
5. Validate / Compare / Reset. 6. Keyboard, layers, legend, persistence. 7. Phase 2.
Commit after each numbered step. Deploy nothing until phase 2 (the tool itself is never
deployed; phase 2's game edits are).

---

## 12. Tests (`test-hole-editor.mjs`, node, no browser, in `run-all-tests.mjs`)

- Normalise round-trip: all 18 holes identical to `RED_MESA.holes` (3.2).
- `yd` conversion: a normalised spec has no `at` on any bunker/water/tree/sentinel/cross.
- Pinning: every normalised spec has numeric `seed`, `greenSeed`, `hard`.
- Reorder: swapping two ids changes only `n` and nothing else in either built hole's
  surfaces, trees or green (compare with `n` stripped).
- R2: deleting the last bunker sets `defend: false`; the built hole has no auto bunker.
  Belt off writes `false` and preserves the other side.
- R4: the model rejects a move of `path[0]`.
- Undo: 3 edits, 3 undos returns the original document; redo returns the edited one.
- Export round-trip (section 8).
- Persistence: a document serialises and reloads equal.
- Structural: `hole-editor/` has no `js/ui.js`; `sw.js` `ASSETS` contains no `hole-editor/`
  path; `validate-sw-assets.mjs` carries the exclusion.
