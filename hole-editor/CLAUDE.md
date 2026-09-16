# hole-editor/ - the Red Mesa hole editor

Build spec: `HANDOFF-GOLF-HOLE-EDITOR.md` at the repo root. Read it before changing anything here.
This file only records what step was built, what the tests say, and any plain-option decision the
spec was silent on (per the handoff's own instructions).

## Step 1 (2026-09-16): `js/model.js` + `test-hole-editor.mjs`

`js/model.js`: the document shape, `normalise()`, `buildHole()` (regeneration, R5), the pure
mutation helpers R2/R4 need (`deleteBunker`, `setBeltSide`, `movePathPoint`), undo/redo, and
persistence (serialise/load). No UI yet - nothing in `js/canvas.js`, `js/panels.js`, `js/main.js`,
`js/export.js` or `index.html` exists.

`test-hole-editor.mjs` (repo root, node, no browser): 14 tests, all green. Covers the section-12
items that don't need `export.js` yet: the normalise round-trip (all 18 holes JSON-identical to
`RED_MESA.holes` - the correctness contract), yd conversion, seed/hard/greenSeed pinning, reorder,
R2 (bunker delete, belt off), R4 (tee immovable), undo/redo, and persistence round-trip.

### A decision the spec's formula didn't survive contact with: normalise() does NOT round `yd`

Section 3.2 step 3 gives `yd = +(at * L).toFixed(1)`. Implemented literally, this fails the
round-trip test for two of the eighteen holes - not a bug in the conversion logic, a genuine
floating-point edge: `L` can only ever be `cardYards`, which `makeHole` itself rounds to 1 dp
before returning it (the raw arc length is never exposed). `at * L` using that rounded `L`, then
rounded again to 1 dp, can land a hair on the wrong side of `place()`'s station-index rounding -
measured on Red Mesa 5's fairway bunker (`at: 0.97`, off by ~0.02 yd) and Red Mesa 11's water
(`at: 0.5`, an exact-tie case), each silently relocating the hazard by one whole spline station
(~4 yd) after a round trip.

Section 3.2 is explicit that the round-trip is "the correctness contract of the whole tool - if it
fails, nothing else matters," which settles the conflict: `normalise()` keeps full float precision
when converting an ORIGINAL `at` to `yd`, and where even that isn't enough (the two holes above),
it re-verifies against the actual built hole and nudges the value by fractions of a yard until the
whole hole matches bit-for-bit (`fixStationRounding` in `model.js`) - always by calling the real
`makeHole` as the judge, never by re-deriving its geometry (R5).

The `.toFixed(1)` rule from the spec still stands, unchanged, for the OTHER place `yd` gets
written: a brand new placement from a canvas click (section 6), which has no prior exact value to
protect and where a tenth of a yard is plenty of precision. `roundYd()` in `model.js` is that path;
tools built in step 4 use it. The Hole/Objects panels display every `yd` field rounded to 1 dp
regardless of which path wrote it, so nothing about this is visible to Matt.

### Tests run and their result

- `node test-hole-editor.mjs` - 14/14 green.
- `node golf/js/test.js` - unchanged, still green (nothing in the game changed this step).
- `node validate-sw-assets.mjs` - unchanged, still green (the `hole-editor/` exclusion is added in
  step 2, alongside `js/export.js`, since nothing here is referenced by `sw.js` yet regardless).

## Step 2 (2026-09-16): `js/export.js` + export round-trip test

`js/export.js`: `generateSource(doc, date)` builds `redmesa.js` text from the document - the header
comment, `DESERT_TYPES`/`RM_DEFAULTS`/`rm` and the `RED_MESA` tail are copied verbatim as strings
(section 8.1/8.2); every `SPEC_i`/`HOLE_i` is generated from `doc.order`/`doc.holes` in the field
order section 8.3 gives. `generateJSON(doc)` is the "Copy JSON" button (just `serialiseDocument`).

Added the `hole-editor/` exclusion to `validate-sw-assets.mjs`'s `EXCLUDED` list, exactly as
section 2 specifies (the folder isn't in `SCAN_DIRS` either, so nothing here was ever going to be
scanned, but the exclusion is explicit per the spec and `test-hole-editor.mjs` checks for it).

**"Numbers as-is" (section 8.3) means export does not re-round anything either.** The same
station-rounding trap that made `normalise()` keep full precision (see Step 1's note above) would
reopen the instant export rounded `yd` back down for tidiness - re-exporting the fresh document
would again relocate Red Mesa 5's bunker and 11's water. So a handful of `yd` values inherited
unchanged from the original `at`-based specs print with long float tails (e.g.
`yd: 193.38000000000002`) instead of a clean `193.4`. This is real but cosmetic: it only affects
values nobody has touched in the editor yet (anything placed or dragged through a tool uses
`roundYd()`, 1dp, same as always), and a hand cleanup pass is a one-line edit if the exported file
is ever committed over `golf/courses/redmesa.js` by hand. Not fixed further because fixing it would
mean re-deriving the same precision problem `fixStationRounding` already solves once, in a second
place, for a purely cosmetic gain (R5's spirit, if not its letter).

### Tests run and their result

- `node test-hole-editor.mjs` - 19/19 green: the 14 from step 1 plus the export round-trip (a
  fresh document's generated source, `import()`ed from a temp file written alongside
  `golf/courses/redmesa.js` so its own relative import resolves, builds all 18 holes identical to
  `RED_MESA.holes`), the Copy JSON round-trip, and the three structural checks (no `js/ui.js`, no
  `hole-editor/` path in `sw.js`'s `ASSETS`, the `validate-sw-assets.mjs` exclusion present).
- `node golf/js/test.js` - unchanged, still green.
- `node validate-sw-assets.mjs` - still green (`hole-editor/` isn't scanned; the exclusion is
  present regardless, per spec).

## Step 3 (2026-09-16): canvas, camera, thumbnails, hole switching, reorder

`index.html`, `editor.css`, `js/main.js`, `js/canvas.js`, `js/panels.js`. The screen layout from
section 4 (ribbon, left bay with Legend + Objects, canvas with the zoom slider/Fit, right bay with
a placeholder Tool panel + Hole + Layers, bottom strip with totals + 18 draggable thumbnails), the
camera (fit/pan/wheel-zoom, remembered per hole for the session), and the drawing order's
non-tool-dependent steps: the built map, trees (dimmed 60% for belt-origin ones, told apart from
hand-placed by `t.s` - `treesOf`'s belt entries carry a scale, hand-placed ones don't), slope
chevrons (copied construction from `render.js`'s `drawSlope`, since its own `cam` object is the
game's), the dashed route, the centreline/waypoints/tee/pin, bounds and the 50-yd grid.

**The 11 tools' ribbon buttons render (icon, label, keyboard hint) but are `disabled`** - section 6
is step 4. Undo/Redo are wired now because reorder needs them (section 3.5: "reorder is
undoable") and both round-tripped correctly in a real-browser check (drag `rm-01` onto `rm-03`,
`he-undo` restores `order`). Validate/Compare/Reset/Export stay disabled until steps 5/2(export UI)
land.

**Verification:** `node server.mjs` + a Playwright screenshot at 1920x1080, eyeballed hole-by-hole
against `node sheet-course.mjs redmesa`'s contact sheet - hole 1 (bend, fairway bunker, guard sand)
and hole 5 (saguaro corridor, greenside bunker) both match the reference picture. No console errors
except a browser-issued `favicon.ico` 404 (there is no favicon; harmless). `node test-hole-editor.mjs`
still 19/19 (nothing in `model.js`/`export.js` changed), `node golf/js/test.js` and
`node validate-sw-assets.mjs` still green.

**Plain-option decisions the spec was silent on (neither changes what Matt sees or exports):**
- Tool icons are single Unicode glyphs (arrows/shapes), not custom art - a Matt-only desktop tool
  doesn't need icon design, and the label under each one already carries the meaning.
- The bottom strip's dirty-total comparison uses `RED_MESA.par`/`RED_MESA.holes` cardYards sum
  directly as "the originals' totals" (section 4.2), rather than rebuilding the frozen originals -
  they are the same numbers by the round-trip contract, and this avoids a second `makeHole` pass
  over all 18 on every redraw.
- `renderMapThumbnail`/camera code lives in `canvas.js` rather than a new file, since the file
  layout (section 2) only names `canvas.js` as owning "the canvas" and the thumbnails share its one
  piece of real logic (`buildMap` + letterbox).

## Step 4 (2026-09-16): the 11 tools

All eleven ribbon tools (section 6), wired end to end: hit-testing (5.5), object outlines matched
by construction order (5.3), the local placement geometry section 6's preamble asks for (dense
stations off `built.route`, since `holegen.js`'s real spline isn't exported), width handles found
by ray-casting the fairway's own drawn edge (5.4/6.3, `fairwayEdgesAt`), the ruler, and undo
wired per section 3.5's rule (`instant` for one-shot actions, `liveBegin`/`liveUpdate`/`liveEnd`
for drags and sliders - one push per gesture, live-previewed throughout).

**Also upgraded in this step, not one of the 11 but directly enabled by their mutators:** the Hole
panel (section 4.3) went from step 3's read-only text to live controls - nickname, par (segmented),
difficulty ramp, landing-zone pinch (with its auto checkbox), the defend checkbox, rough collar
(with its auto checkbox) - since `setField` existed anyway and leaving core hole metadata
uneditable would have made the tool materially incomplete. "Width at cursor" is shown both ways
the spec mentions it: as a canvas-corner hover readout (5.2 step 9) and mirrored live into the Hole
panel's own field (4.3).

**The actual construction order for matching a spec entry to its built surface differs from
section 5.3's prose, and the code wins.** 5.3 says specBunkers are "pushed in spec order, then the
auto-defend bunkers, then the cross bands." Reading `holegen.js` directly: the real order is
author bunkers, then guard-token bunkers, then cross-derived bunkers, then auto-defend, last.
Author entries (the only ones this editor lets you select/drag/delete) still land at the FRONT of
the array in their own authored order either way, so `listObjects`' indexing (`spec.bunkers[i]`
maps to the built array's index `i`) is correct under the real order and would have been wrong
under the prose's order. Verified directly against `RED_MESA.holes[0]`'s built `surfaces`, not
assumed.

**Cross hazards get an approximate outline, not an exact one.** `holegen.js` builds a cross band
with its own wave maths (`stAt`/`faceS`/`across`), never `blob()`, so section 5.3's "draw it with
`blob()`" instruction doesn't apply to it. The editor draws a straight rectangle across the
corridor at the hazard's `yd` instead - enough to see and grab; the real wavy shape is still what
`buildMap` paints underneath it (R5 - the ground truth is never redrawn, only the SELECTION AID is
approximate).

**Guard-derived and cross-derived bunkers/water are not separately selectable objects.** Only
`spec.bunkers[]`/`spec.water[]`/`spec.trees[]`/`spec.sentinels[]`/`spec.cross[]` entries - the ones
a tool actually authored - appear in `listObjects`/the Objects list; a green's guard tokens are
checkboxes (section 6.8), never individual draggable shapes, and an auto-defend bunker is a
consequence of `defend`, not a thing with its own identity to select.

**Two real bugs found and fixed by interactive testing (not by reasoning about the code):**
1. Deleting a selected object crashed: the Delete-key handler ran the mutation (which shrinks the
   array) BEFORE clearing `selection`, so the context panel re-rendered against an index that no
   longer existed. Fixed by clearing selection first, mutating second.
2. A newly-placed object wasn't auto-selected, and - worse - the Tree panel's Single/Stand toggle
   went inert the moment a tree was selected (it briefly bound to "the selected thing's mode",
   which doesn't exist - you can't convert a placed tree into a stand). Fixed by making the
   Single/Stand toggle always drive the NEXT placement, never the current selection, and by
   selecting whatever a placement tool just created so its own edit controls appear immediately.

**Verification:** interactive Playwright passes (not screenshots alone) drove every tool at least
once: Select (click/drag/delete/undo on a bunker), Bunker/Water/Tree/Stand/Cross placement, Route
(dogleg left, waypoint drag), Width (handle drag, double-click insert, base-width slider), Green
(guard checkbox), Slope (preset swap), Belts (side off), Ruler (two clicks). Hole panel edits
(nickname, par, defend) verified the same way. `node test-hole-editor.mjs` stayed 19/19 throughout
(no model/export regressions).

**Fold-back, per section 11 step 4's own instruction** ("edit hole 1 with it, Export, fold the
export into a scratch copy and run `node golf/js/test.js` against it"): built a document with one
edit per tool applied to hole 1 (nickname, bunker, water, tree, slope preset, belt depth, width
scale), exported it, swapped it in for `golf/courses/redmesa.js` (backed up first via `cp`), ran
`node golf/js/test.js`, then restored the backup immediately (`git diff` clean afterward either
way) - this tool never writes to the game's own files (section 10), so the swap is always
temporary and local to the check.

- **First attempt, with a denser combination** (also adding a cross hazard and a stand near the
  green, stacked without any thought to reachability) **produced a hole the 36-hole playthrough
  test could not finish** and had to be killed after several minutes. This is not a bug in the
  editor: the handoff spec explicitly excludes "difficulty measurement, playability sweep,
  reachability" from scope (section 1), and `validateHole()` - which the editor's own future
  Validate button runs - passed that same hole with zero errors, because geometry validity and
  playability are different questions. Recorded here as confirmation that the tool will
  cheerfully let you build an unplayable hole, exactly as designed; catching that is Matt's job
  (or a future `sim`-style tool's), not this one's.
- **Second attempt, with the same seven edits spread out and non-overlapping**, passed clean:
  `node golf/js/test.js` → "all golf engine tests passed", including section 14's full 18-hole
  playthrough of the edited course.
