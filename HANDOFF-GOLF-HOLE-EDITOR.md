# Handoff: a hole editor for Red Mesa (2026-09-15, revised 2026-09-16)

This is a HANDOFF, not an instruction set. It describes what Matt wants the editor to do and the
context a building session needs. Where it says "recommended" the builder decides; everything else
is what Matt asked for and is the brief. Revised after Matt reviewed the first draft line by line;
every decision below that is his is marked **(Matt)**.

**Read first:** `golf/CLAUDE.md`, especially "The courses are EDITABLE" (top of the file), "The
hole-data format", and "Holes are DESIGNED, not typed: `golf/js/holegen.js`". The editor is a UI
on top of the vocabulary that already exists there. It is not a reason to invent a second one.

---

## Scope

- **Red Mesa only (Matt).** Every hole of it.
- **Oasis Sands is out.** Its holes are raw traced polygons (157 KB of coordinates, no recipe
  behind them), so none of the recipe editing below applies to it. If Matt later wants its back
  nine, build those nine as recipes with this editor rather than tracing them.
- **Pine Valley is out.**
- **No "add hole" (Matt).** Reordering existing holes, yes. Creating holes comes later, if ever.
- **Nothing about release, admin config or the leaderboard.**

The clone instruction that produced the first drafts is retired; nothing on Red Mesa is frozen.
The golf records in Firebase are Matt's own test data and are disposable (Matt). Both are recorded
in `golf/CLAUDE.md`, "The courses are EDITABLE".

---

## What it is and where it runs

- **A standalone tool, not part of the hub at all (Matt).** Not in `sw.js`, not a launcher game,
  not gated, not phone-fit. Its own folder at the repo root, served by `node server.mjs` on Matt's
  PC and opened in Chrome. **Do not give the folder `index.html` plus `js/ui.js`** or
  `test-game-conventions.mjs` will treat it as a game (that is its discovery rule).
- **Desktop, mouse, Paint 3D look (Matt).** Reference screenshots: `reference/paint3d/` on `main`
  (eight files). Look at them before building: big canvas, slim icon ribbon, small context panel.
  One deliberate departure: several panels visible at once (palette, hole stats, layers, ruler).
  Recommended: fixed docking bays (left/right/bottom), toggled from the ribbon, not free-floating
  windows.
- It imports the game's own code so what it draws is what the game draws: `golf/js/holegen.js`
  (`makeHole`), `golf/js/holes.js` (`validateHole`, `distYd`), `golf/js/render.js` (`buildMap`,
  `fillsFor`, `paletteFor('desert')`). `sheet-course.mjs` already draws every hole of a course
  through `buildMap` and is the working example for thumbnails.

---

## Data model

A Red Mesa hole is a **recipe** (a `makeHole` spec: centreline points, width profile, hazards,
green, belts). The editor edits recipes and regenerates through `makeHole`; it never edits the
generated polygons. Matt never sees the recipe: handles on the canvas, sliders, pickers. Numeric
readouts (length, width, par) are the right amount of numbers; a coordinate table is not.

Rules the recipe must follow, each one fixing a real problem:

1. **Every hole has its own identity (Matt).** Think eighteen pages you can shuffle. Reorder
   changes the page's position, never its content, and "Reset this hole" always restores THAT
   hole's original design whatever slot it sits in. Store holes by identity, not by number.
2. **Seed and difficulty travel with the hole.** `makeHole` derives its random seed
   (`seed`, `greenSeed`) and its difficulty (`hard`) from the hole number when they are absent, so
   a hole moved from slot 5 to slot 7 would re-roll its bunker shapes, edge wobble and green size.
   The editor writes all three explicitly onto every hole the first time it touches it, from the
   values the original slot implied. Then reordering is only reordering.
3. **Everything is placed in yards from the tee (Matt).** `makeHole` accepts `yd` on bunkers,
   water, trees and sentinels (added 2026-09-16; `cross` always had it). `at` (fraction of the
   hole) still works for the shipped specs but slides when a hole is lengthened, so the editor
   writes `yd` only and converts any `at` it reads to `yd` on load.
4. **A deleted bunker stays deleted (Matt).** `makeHole` auto-adds a fairway bunker at any
   undefended drive landing zone. When Matt deletes a bunker on a hole, the editor writes
   `defend: false` on that hole. Same for the default tree belts every Red Mesa hole gets from its
   `rm()` wrapper: switching a side off writes `belts: {left: false}` (or `right`).
5. **Sand is two kinds.** `fairwayBunker` and `greensideBunker` are authored, never derived from
   distance. Both are in the palette and a placed bunker shows which it is.
6. **Width is a half-width in the recipe, and the drawn fairway is not the number.** `fw` is
   half-width, and the drawn edge adds the landing-zone pinch, the bend asymmetry, wobble,
   breathing and a 4.5 yd floor. Readouts show the MEASURED on-screen width at the cursor, and a
   width slider is labelled as the base width it controls.
7. **Autosave never validates.** Regeneration can throw (unknown guard or slope name, a path with
   fewer than two points). The editor catches it, keeps the last good picture and marks the hole,
   and never blocks an edit on it.

---

## Working model

- **Originals are read-only (Matt).** The as-shipped Red Mesa recipes are loaded and can never be
  written over. Always available to reset to or compare against.
- **Edits go to a separate working copy** ("Red Mesa (edit)" is a placeholder name) that
  **autosaves on every change**. `localStorage` in Matt's Chrome is acceptable (Matt). No manual
  save step.
- **Export** writes the working copy as a file in exactly the shape `golf/courses/redmesa.js`
  uses (recipes plus the `rm()` wrapper), so folding it back into the game is a file replacement,
  not a retype. The export is also the backup.

### Fold-back (a later session, not the editor)

Replace the course data with the export. Then: `node golf/js/test.js` (it plays every hole), and
if any par changed, update the hand copy in `js/leaderboard-rank.js`'s `GOLF_COURSE_PAR` (the
suite fails if it disagrees). Treat the export as untrusted until the suite is green.

---

## Features

### Navigation
- Select any hole. A thumbnail strip of all eighteen at once, so a change is checked against the
  set (repeated greens and identical hazard placement were only ever found this way).
- An edited-vs-original marker per hole. Running totals: total par and total yardage, computed
  from the data.
- Reorder holes (drag in the strip).

### Structural editing (visual, on the canvas)
- Lengthen / shorten: drag the tee or the pin end. **Open: which end moves by default.** Make it
  unambiguous on screen, never a silent default.
- Widen / narrow: whole hole or a section (the width profile's control points, drawn as handles).
- Doglegs and curves: drag centreline waypoints; a dogleg preset with a left/right choice.

### Objects (place, select, edit, delete)
- Bunkers (two kinds), water, individual specimen trees, sentinel stands. Click to place, drag to
  move, drag to size, delete key to remove.
- Tree belts: on/off per side with depth and spacing sliders (they are generated to hug the
  fairway with soft edges; a hand-drawn belt would get hard edges, so there is no drawing tool).
- Green: shape family (`GREEN_SHAPES`), angle, size on both axes, position follows the pin.
- Green slope: pick a preset (`SLOPE_PRESETS`) plus strength, OR paint the 8x8 downhill arrows
  directly (Matt). Both write the same `slope` field.
- Guard presets (`guard` tokens) with a side choice where one exists: front/left/right/back sand,
  jaws, ring, front/left/right/back water, front/left/right trees.
- Cross hazards (water or waste band at a yardage, with depth).
- An eyedropper (click a surface to make it the active kind) and a Select mode distinct from
  Place mode.

### Verification (a button, never automatic)
- **Validate Hole**: `validateHole()` plus a **self-intersection check written for the editor**
  (the shipped validator does not detect a bow-tie polygon, and the generator's backward-point
  guard is the only thing preventing one today). Report WHERE, on the canvas, not pass/fail.
- Not in the tool (Matt): difficulty measurement (`test.js` 15c is run by a session on request),
  the playability sweep, hole reachability.

### Compare and reset
- Compare: original and edited side by side. Visual only.
- Reset This Hole: confirm first (Matt). Restores the hole's own original, by identity.

### Feedback while editing
- Readouts: hole length, measured width at the cursor, par. A two-point ruler in yards
  (`distYd`). Layer toggles (trees, slope arrows, collar, belts, route). Zoom and pan (Paint 3D's
  bottom-left slider is the reference). Undo/redo. An always-visible legend of surface colours.
  Keyboard shortcuts for undo/redo, tool switching, panel toggles.

### Phase 2: Play this hole
Worth building, after the editor works: a Play button that mounts the real golf module on the
edited course so Matt can hit it immediately instead of edit, export, fold-back, deploy, play.

---

## Dropped from the first draft (Matt)
Bucket fill, brush painting, add hole, Oasis Sands.

---

## Separate engine job, not this editor: fairway slopes (Matt wants them)

The ball only breaks on the green today (`slopeAt` reads `green.slope` and returns flat outside
the green's box; the run-out in `shot.js` ignores ground slope). Fairway slopes need: a slope
field for the fairway in the hole format, a read in the run-out and bounce, a slope read drawn
on the fairway, a `makeHole` recipe input, a validator entry and a test. Write it as its own
handoff and build it before or alongside the editor's slope tools; the editor then offers the
same preset-or-paint control on the fairway.
