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
