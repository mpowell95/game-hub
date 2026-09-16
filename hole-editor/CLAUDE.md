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
