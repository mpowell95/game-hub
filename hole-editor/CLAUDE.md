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

## Step 5 (2026-09-16): Validate / Compare / Reset (+ Export/Copy JSON wiring)

- **Validate** runs `validateHole(built)` (or reports `broken` as the only row) into a new section
  of the Hole panel - never on its own, only on the ribbon button, per section 7's rule. Each row
  is clickable: `pointsInMessage()` (panels.js) pulls every `[x,y]` a message cites - one point for
  most messages, two for a "crosses itself" report - and `EditorCanvas.panTo()` centres the camera
  there and rings every cited point in red (plus a dashed line between the two, for a self-cross)
  until the next canvas click, which already clears `validateRing` (wired in step 4).
- **Compare** opens a plain DOM modal (not a canvas overlay) with two `buildMap` renders side by
  side at one shared scale - the original (`buildOriginalHole()`, new in `model.js`: builds an id's
  frozen original spec at its ORIGINAL slot, never its current position in `order`) and the
  current hole - each labelled with par and length. Closes on the X, a click outside, or Escape.
- **Reset hole**: `window.confirm`, then the spec is replaced by a deep copy of the frozen
  original (by id - the slot, i.e. `order`, is untouched), one undo push, `validateResults`
  cleared (a stale list belongs to the edit that's gone).

**Export and Copy JSON were wired too, though section 11 doesn't name a step for it.** Both were
already built and tested in step 2 (`export.js`); leaving the ribbon button dead through steps 3-5
would leave the tool unable to do the one thing it exists for. Export triggers a browser download
of `generateSource(doc)` as `redmesa.js` (also on Ctrl+E); Copy JSON writes `generateJSON(doc)` to
the clipboard. Neither writes to the game's own files - the fold-back (golf/CLAUDE.md's "Fold-back
(a session, not the tool)") is still a deliberate, separate step.

### Tests run and their result

- `node test-hole-editor.mjs` - 19/19 green throughout (Validate/Compare/Reset touch no model
  invariant the existing suite doesn't already cover; `buildOriginalHole` is exercised indirectly
  by every `originalSpecs()`-based test already in the file).
- Interactive Playwright: Validate on a clean hole shows "No problems"; `panTo`/`validateRing`
  verified directly; Compare modal opens with both canvases and closes on its own button; editing
  the nickname then Reset restores it and the confirm dialog gates the action; Export produces a
  real download starting with the copied header comment and containing `SPEC_1`.
- `node validate-sw-assets.mjs` - still green.

## Step 6 (2026-09-16): keyboard, layers, legend, persistence

Keyboard, layers, legend and persistence were already fully built and tested as each earlier step
needed them (the tool switcher needed its keys in step 4; thumbnails/reorder needed persistence and
the legend in step 3), so this step is mostly a check that section 4.1's full key list and section
3.6's rules are ALL actually there, plus two real gaps it found:

- **`Space`+drag-to-pan didn't guard against a focused text input.** Holding Space while typing a
  space character into Nickname (or any future text field) would also arm the pan - harmless in
  practice (panning only fires on a canvas pointerdown) but wrong on principle, and every other
  keydown handler in the file already guards the same way. Fixed with the same
  input/textarea/select check the Delete/Escape handler uses.
- **"Discard ALL edits" (section 3.6) had no control anywhere.** The screen layout in section 4
  doesn't name a "Course panel" the way 3.6's prose does, and there is nowhere else in the
  documented layout for a whole-course action to live - the bottom strip's totals area is the one
  place already showing course-wide (not per-hole) state, so that is where the button went,
  confirm-gated exactly like Reset hole. Rebuilds the document from `createDocument()`, resets the
  undo/redo stacks, and re-selects hole 1.

Everything else in section 4.1's key list was already wired: `V R W B H T L G S C M` (step 4),
`Ctrl+Z`/`Ctrl+Y`/`Ctrl+Shift+Z` (step 3), `Delete`/`Backspace` (step 4), `F` fit (step 3), `+`/`-`
zoom (step 4), `[`/`]` previous/next hole (step 3), `Esc` deselect-then-clear-ruler (step 4),
`Ctrl+E` export (step 5, added alongside the Export button).

### Tests run and their result

- `node test-hole-editor.mjs` - 19/19 green.
- Interactive Playwright: edited the nickname, reloaded the page, and read it back from
  `localStorage` unchanged; collapsed the Legend panel, reloaded, confirmed it stayed collapsed
  (`golf.holeEditor.ui.v1`); Discard ALL edits (confirmed) restored hole 1's nickname to the
  original; `Space`+drag moved the camera.
- `node validate-sw-assets.mjs` - still green.

Sections 1-8 (scope, layout, model, canvas, tools, validate/compare/reset, export, keyboard/
layers/legend/persistence) are now built and tested end to end. Only section 9 (Phase 2 - the
three guarded game-side edits and the editor's Play button) remains.

## Phase 2 (2026-09-16): the three guarded game edits, and the Play button

Exactly the three edits section 9 lists, nothing more:

1. `golf/js/rounds.js`'s `courseById(id)` returns `globalThis.__gfCourseOverride` when it exists
   AND its own `id` matches the one asked for - so the override can only ever substitute for the
   course it was actually built from, never leak into a request for a different one.
2. `golf/index.html`: if `location.search` contains `editor=1`, BEFORE `init()`, reads
   `localStorage['golf.holeEditor.redmesa.v1']`, builds every hole with the real `makeHole`/
   `RM_DEFAULTS` (R5 - no second course-builder), and sets `globalThis.__gfCourseOverride` and
   `globalThis.__gfNoRecord = true`. A missing/malformed/wrong-version document is caught and
   falls through to the shipped course, logged rather than silent. `requireName()` still runs
   exactly as before - it is not skipped.
3. `golf/js/ui.js`: both `recordGolf` call sites (`_recordRound`, `_recordHole`) return at the top
   when `globalThis.__gfNoRecord` is true, before touching anything else.

**The editor's Play button** (ribbon, after Export - `he-play`) opens `../golf/?editor=1` in a new
tab. It flushes the debounced localStorage save FIRST (`saveNow()`, new in `main.js` - the normal
save is 300ms debounced, and a click right after an edit must not open the game on the previous
save). No deep link into a specific hole - Matt picks it from the game's own Practice list, exactly
as section 9 specifies ("that would be a fourth game change and the setup screen is one tap away").

**Test, per section 9's own instruction**: `test-hole-editor-play.mjs` (repo root, Playwright,
`test-visual.mjs`'s conventions - profile seeded via `addInitScript` since every standalone page is
name-gated). It builds a document with hole 1 lengthened by a real dogleg edit (so its `bounds` -
and so `holeAspect()`, what the setup screen's course strip actually keys off - measurably differ
from the shipped hole), seeds it into `localStorage` alongside a profile and `gamehub.golf.v1`
pointing `lastCourse` at `redmesa` (Red Mesa is locked-by-default for a fresh ladder, per
`golf/CLAUDE.md`'s "Who can play it right now" - going through `data-course` chip click would need
a dev-hashed name; setting the setup screen's own initial-course setting has no such lock and is
exactly what a preview button needs), then asserts the strip's hole-1 thumbnail's `--gf-ar` custom
property equals the EDITED hole's aspect, not the shipped one - proving the override actually
reached the setup screen rather than merely not crashing it.

### Tests run and their result

- `node test-hole-editor-play.mjs` - green: "the setup screen course strip reflects the hole
  editor override, not the shipped course."
- `node golf/js/test.js` - unaffected by these three edits (none of them run when `editor=1` is
  absent from the URL, and `courseById`'s new branch is a no-op with no override set) - full suite
  still "all golf engine tests passed."
- `node test-hole-editor.mjs` - still 19/19 (model/export untouched this step).
- `node validate-sw-assets.mjs` - rewrote `sw.js`'s `REST_MANIFEST` for the three changed golf
  files (expected and required per its own header: "re-run it... and commit sw.js after changing
  any game file"); committed alongside.

This is real game code, unlike the tool itself, so it follows the root CLAUDE.md's normal rule:
committed, pushed, and taken to a merged, deployed `main` rather than left on the branch - the
handoff spec's own text says so directly ("Deploy nothing until phase 2... phase 2's game edits
are [deployed]"). The override is inert for every player who has never opened the hole editor -
`__gfCourseOverride` is only ever set by code that runs after `?editor=1` finds a matching
document in that browser's own `localStorage`, which nothing else ever writes.

## First use (2026-09-16): "very slow/delayed", drag-to-pan, and a bigger UI

Matt, on opening it for the first time: *"it's very slow/delayed. why?"* Measured in a real
browser with a PerformanceObserver on a 30-step drag of the pin: **long tasks of 460-530 ms on
every single pointermove**, and ~450 ms per hole switch. Cause, two layers of the same thing:

1. `renderMapThumbnail` called `buildMap` fresh on every call, and `refreshStrip()` re-rendered
   all 18 thumbnails on every `afterChange()` - so each mouse move re-painted eighteen holes
   (~17 ms each) that had not changed. Fixed with `mapFor(built)` in `canvas.js`: one painted map
   per built hole in a WeakMap, shared by the thumbnails, the Compare modal and the main canvas.
   `buildHole()` returns the same object for an unchanged hole, so this IS spec 4.2's "redraw only
   the ids whose built hole changed".
2. `afterChange()` rebuilt the hole and re-rendered every panel synchronously per event. Now, during
   a live gesture (`liveBeforeSpec != null`), the spec is updated on every event but the rebuild,
   the canvas, the Hole panel, the Objects list and the strip refresh once per animation frame,
   and the context panel is left alone until `liveEnd()` (re-rendering it under a slider mid-drag
   is how a drag gets dropped). Outside a gesture nothing changed.

After: **70-85 ms per frame during a drag** (the floor is `makeHole` + `buildMap` + the tree
expansion for the changed hole, ~30 ms, plus the draw), slider drags one frame. Measured with
`scratchpad/pw/perf2.mjs`-style Playwright runs, before and after, same drag.

Two asks from the same message, both done:
- **Select-tool drag pans.** *"if my cursor is set to Select, i should be able to drag the hole
  around while zoomed in."* A left-drag that starts on empty ground with Select active pans, same
  as middle-drag / Space+drag; a plain click on empty ground still deselects. Verified in
  Playwright: camera centre moves, selection stays null.
- **Bigger everything.** *"the tool options and text and everything can be larger. Use more of the
  screen."* Base font 13 -> 16 px, ribbon 48 -> 66 px with 22 px icons, left bay 240 -> 310, right
  bay 320 -> 420, strip 150 -> 200 with 150x140 thumbnails, every panel size scaled to match.
  Still fits 1920x1080 with the strip's captions on one line.

Also from the same review: `run-all-tests.mjs` now includes `test-hole-editor.mjs` (spec section
12), and `test-hole-editor-play.mjs` launches Chromium with `--no-sandbox --headless=new` like
`test-visual.mjs`, so it runs on the cloud image instead of skipping. Phase 2's three game edits
had shipped under the SAME `CACHE` name (v846); a device already warmed on v846 would never have
fetched them (the REST tier is cache-first and `warmRest()` skips paths already cached). Bumped
to v847 with that fix. This one touches only `hole-editor/`, which is not in `sw.js`, so no bump.

## Tree size and height; the Belts sliders were dead; slope arrows (2026-09-16)

Matt: *"Can i edit the size and height of trees?"* Now yes. A placed tree or stand carries `s`
(a multiple of its type's trunk and canopy, 0.4-3) and `h` (its own height in yards, 1-60),
two sliders in the Tree panel when one is selected. **This is an engine change, not just an
editor one**: `makeHole` carries both through (`trees` and `sentinels`), `shot.js`'s `treeHit`
uses `h` as the canopy's top and `s` as before, `render.js` offsets the shadow by `h`, and
`validateHole` refuses a non-positive value. `golf/js/test.js` section 10 proves a lob wedge that
clears the 13 yd oak is stopped by the same oak at `h: 40`, and a driver that a full-size oak
stops passes a 0.3x one. CACHE v848.

Matt: *"double check how the slope and belt tools work. I can't get them to work."* Driven in
Playwright, both:
- **Belts: depth and spacing were never wired.** `renderBelts` guarded each `wireSlider` call on
  `el.querySelector('#he-belt-left-depth')`, an id that does not exist (`slider()` renders `-r`
  and `-n`), so only the On/Off checkbox ever did anything. Measured before: depth +10 and
  spacing 7 left the tree count at 120; after: the same edits change it. Fixed by dropping the
  guard (`wireSlider` already no-ops on a missing slider).
- **Slope presets worked, but the arrows were invisible at the fit zoom.** The editor copied the
  game's `SLOPE_MIN_PX` gate (3.5 px), and at the fit zoom a Red Mesa green's chevron is 2.2 px,
  so nothing was drawn until you zoomed in. The editor now floors the glyph at 7 px and always
  draws the read.
- **Steeper is denser (Matt).** `render.js` exports `slopeChevronGrid(mag)`: a cell draws a 1x1,
  2x2 or 3x3 grid of chevrons by its gradient's magnitude (thirds). The GAME draws it that way
  now too, so the player's read and the editor's are the same rule.

## Review pass (2026-09-16): five defects found by driving every tool, all fixed

Matt: *"Please review the tool for more bugs. Correct all that you find."* Read every file, then
drove every tool in Chromium with assertions. `test-hole-editor-ui.mjs` (repo root, Playwright,
needs `node server.mjs`) now carries each finding as a `[KNOWN-BUG PROBE]` and 28 checks in all;
it is deliberately NOT in `run-all-tests.mjs`, like every other browser suite.

1. **A Width handle dragged by ZERO pixels doubled the fairway.** `fw`'s `w` is a HALF-width
   (holegen.js says so); the drag stored `half * 2`. Measured: w 16 -> 30 on hole 1 from a
   no-op drag. Now stores the half-width, clamped 4.5-30. The Width panel and Objects list print
   it as the full width ("32 yd wide") because that is what a person reads a fairway as.
2. **Place a bunker, press Ctrl+Z: page error** ("Cannot read properties of undefined (reading
   'kind')"). Placing selects the new object; undo removed it; the context panel rendered the
   selection against a list one shorter. `pruneSelection()` in `afterChange` drops any selection
   whose object no longer exists, on every non-gesture change (undo, redo, reset, delete).
3. **Slope Paint mode did nothing.** The panel offered it, `setSlopeCell` existed, and no canvas
   code called it. A press inside the green's 8x8 box (drawn as a grid while the tool is
   active) picks the cell; the drag's direction sets the downhill vector, its length the
   magnitude (saturating at 24 px); a plain click zeroes the cell.
4. **The Cross panel's `over` never reached a placed hazard** (`_place` did not pass it). It does;
   `addCross` writes it only when it differs from holegen's default of 8.
5. **The zoom slider sat at its HTML default until the first wheel event**, and the +/- keys never
   moved it. `syncZoomSlider()` after boot, hole switch, Fit and the keys.

Also: the Validate list is cleared by the next edit (it described the hole before the edit);
after a slider release the context panel is left in place (`afterChange({ keepContext })`) so
arrow keys keep working on it; the nickname is HTML-escaped properly.

## Past the pin, runs-away greens, Duplicate, resize handles, drawn shapes (2026-09-16)

Matt, designing hole 3: *"It doesn't let me place a bunker behind the green."* Everything is
placed in yards from the tee and `holegen.js`'s `place()` clamped the fraction to 0..1, so a click
past the pin snapped back onto it. `place()` now carries on along the end station's tangent
(`yd: length + 20` is twenty yards past the pin); `nearestPlacement`/`placeLocal` here do the
same. And *"make the green slope away from the tee"*: every preset fell toward the tee, so
`runsAway` / `runsAwaySteep` were added to `SLOPE_PRESETS`; the dropdown lists them itself.

Then three asks in one message, all built:
- **Duplicate** (ribbon, `D`, and a button in the Bunker/Water panels): the selected bunker,
  lake, tree, stand or cross hazard, 12 yd further up the hole, with a fresh seed, selected.
- **Resize handles**: a selected bunker or lake (Select tool) shows a dashed box with eight
  white squares; sides scale one axis, corners both, about the box centre. A blob scales its
  `r`/`ry` (`rx`/`ry`), a drawn shape scales its points. The factor is measured against the
  CURRENT box on every move, never compounded.
- **Draw shape**: Bunker/Water panel -> "Draw shape" (or "Redraw shape" on a selected one). Click
  each corner, double-click or Enter closes, Esc cancels. The clicked outline is rounded with two
  passes of Chaikin (`smoothPoly`, a 4-click square -> 16 points) and stored as `{poly, kind}` /
  `{poly}`, the form holegen.js always accepted beside a blob. World yards = yards from the tee
  while the tee never moves (R4), so R1 holds. A drawn shape is dragged by translation and has
  no reroll. Bunker placement also gained an Auto / Fairway / Greenside choice before the click.

Tests: five headless cases (smoothing, build + validate + export of a drawn bunker, scale,
duplicate/translate, chosen kind) and four browser probes (D, a handle drag growing `r`, four
clicks + Enter making a 16-point lake that paints and validates).

## Matt's second list (2026-09-16): draw undo, exact outlines, guard hazards, S-bend, readout, stand angle

- **Delete last point while drawing**: Backspace, or the button in the drawing panel.
- **Outlines sat beside their objects.** The editor rebuilt its stations from the coarse `route`
  (a point every 25 yd, and the fairway MIDDLE, not the centreline), so `placeLocal` disagreed
  with holegen's `place()`. `holegen.js` now exports `routeStations(path)` - the same `spline()`
  `makeHole` uses - and the canvas builds its stations from it. `buildStations` stays as the
  fallback and for tests.
- **Guard hazards** (a green's `guard` tokens: `frontJaws`, `ringSand`...) are recipes, not
  objects, so hole 6's greenside bunkers could not be selected. Clicking one now selects it as a
  `guard` hit and offers **Detach guard presets**, also in the Green panel: `detachGuards()`
  builds the hole with and without the tokens and turns every hazard in the DIFFERENCE into a
  drawn bunker / lake / placed tree, then removes the tokens. Proven: hole 6 paints the identical
  bunker polygons before and after.
- **Route**: S-bend presets (left-then-right, right-then-left) and a plain-words hint.
- **Readout**: "From tee: N yd" above the width, live with the cursor.
- **Stands can be turned**: `angle` (degrees from the hole's direction) on a sentinel stand,
  engine-side in `holegen.js` (the line pivots about the stand's centre); a slider in the Tree
  panel. Duplicate copies a stand with its size, height and angle.

Wind, for the record (Matt asked): `shot.js` `windFor()` - fixed per hole, seeded from the hole
number and its yardage, one hole in six calm; never random per round. A hole may state `wind`
explicitly; none does.

## Drawn greens, fringe widths, pins (2026-09-16)

Matt: *"I need to be able to draw green shapes as well. And determine how wide i want the fringe
to be... I really need to be able to set the pin location on each hole... 3-4 possible pin
locations that the course randomly chooses from each time it's played."* All three, engine and
editor:

- **Green -> Draw the outline instead**: click corners, Enter/double-click closes; the rounded
  outline is `greenOutline` (world yards) and IS the putting surface (`golf/js/holegen.js`).
  Guards find its edge by ray-cast; the fringe is `offsetOutline` (each vertex along its own
  outward normal). "Use a preset shape instead" clears it.
- **Fringe width**: one slider, or per side (front/back/left/right) - `fringe`, blended by
  bearing in the green's frame. Works for preset greens too (`fringePoly` takes a function).
- **Pins**: Green -> Add pin, then click on the green; flags are numbered, draggable, Delete
  removes. One pin = the cup; two or more = `hole.pins`, and `golf/js/ui.js` `_enterHole` picks
  one at random each time the hole is played. `validateHole` refuses a pin off the green.
  Export prints all three fields. CACHE v851.

## The first real fold-back (2026-09-16, CACHE v852)

Matt exported after a full editing session and sent the file. `golf/courses/redmesa.js` IS that
export, with three repairs the validator demanded - all of them shapes the editor let through:

- **Hole 7 had a waypoint at y 3.6 on a tee at y 5**, dragged behind the tee, which folded the
  fairway, rough and belt polygons over on themselves at the tee box. Dropped the waypoint.
  Guard: `clampAheadOfTee` in `model.js` - `movePathPoint` (now what the canvas drag calls too)
  floors every waypoint at tee + 10 yd.
- **Hole 9's traced bunker doubled back on its last three points**, and **hole 7's drawn green
  fringe folded over inside a notch** (the outline pushed out 6 yd across a dip narrower than
  that). Guard: `dropLoops` in `golf/js/holes.js` - a crossing whose loop is 8 vertices or fewer
  is cut out; `smoothPoly` and `offsetOutline` both run it, so a drawn shape or a fringe cannot
  ship a kink again. Bigger crossings are still left for the validator to report.
- **Hole 6's ring of sand was drawn as a spiral**: inner loop, bridge, outer loop, bridge, both
  loops the same way round, so the two bridges had to cross. Rebuilt in the file as outer loop +
  inner loop reversed, joined at their nearest vertices (5.6 yd apart); `surfaceAt` is even-odd,
  so the middle is not sand and the green on top wins anyway. The editor cannot draw a ring on
  purpose; if that becomes a want, it is a two-outline feature, not a drawing trick.

Par stayed 71, so `GOLF_COURSE_PAR` was untouched. `golf/js/test.js` and `test-hole-editor.mjs`
pass on the folded file (three editor tests were re-pointed: hole 6 no longer has guard tokens,
hole 3 already carries three pins). **Matt's browser copy still holds the pre-repair shapes** -
the editor loads from `localStorage`, not from the file, so those three holes differ from what
shipped until he resets the editor or re-imports.

## Wind (2026-09-16)

Matt: *"what's up with the wind? did you allow me to control that via the editor or what?"* Not
until now - it was derived from the hole number and yardage, one hole in six calm. The Hole panel
has **Wind: auto** (that derivation) or a speed slider (0-2, 0 = calm) and eight directions,
labelled by where it blows: toward the green, right, toward the tee, left, and the diagonals.
Exported as `wind: { speed, deg }`; `golf/js/holegen.js` turns it into the `hole.wind` that
`shot.js`'s `windFor` has always honoured. Unset = exactly what the course did before.

## Tree shadows are drawn (2026-09-16)

The game offsets a tree's shadow by 0.92 yds per yard of HEIGHT; the editor drew crowns only,
so Matt's hole 7 - palo verde stands set to 39.5-47 yds tall on the Height slider - looked
nothing like the game, where their shade lay across the whole green and nothing in the bag
could fly them. `canvas.js` now paints the same ellipses at the same alpha before the crowns.
The Height slider's units are yards; a palo verde is 8, a saguaro 15, a boulder 40, and the 8
iron's apex, the highest in the bag, is 32.

## The Hole panel's sliders were never wired (fixed 2026-09-17)

Matt: *"when i slide the scale on the wind, the number doesnt change. when i manually input a
number, it reverts to 1."* `slider(id, ...)` renders `#id-r` and `#id-n`; every optional slider's
guard queried the bare `#id`, which never exists, so **pinch, rough, green ry and wind** were
drawn and dead since the day each shipped. `test-hole-editor-ui.mjs` now types into wind and
rough and reads the spec back. The editor is not in `sw.js`, so no CACHE bump - but GitHub Pages
caches for ten minutes and a browser holds the old `panels.js` until a hard refresh.

## The Course Creator (2026-09-22): the same editor on a blank course, with cloud drafts

Matt: *"I have a request for the hole editor/hole creator to be a tool I can send to the king of
games and have him create a course... I don't wanna send him the Red Mesa or Oasis Sands courses.
We'd have to set up or create basic holes for him to start with."* And: *"we should be able to
have his edits autosave and be saved in the repo or something for me to review later, right?"*

**The link: `/hole-editor/?course=new`.** The plain link is still Red Mesa, untouched.

- **`course.js`** picks the profile from the URL: Red Mesa (recipes from `redmesa.js`, key
  `golf.holeEditor.redmesa.v1`, ids `rm-NN`, exports `redmesa.js`) or the custom course (recipes
  from `starter.js`, key `golf.holeEditor.custom.v1`, ids `h-NN`, exports `<slug>.js`). `model.js`
  keeps one active profile (`setCourse`); its `RM_DEFAULTS` is now "the active course's defaults"
  and follows the custom document's **theme** (parkland or desert obstacle table).
- **`starter.js`**: eighteen plain holes, par 72, no hazards, a gentle bend on a few. Every one
  builds and validates on both looks (`test-hole-editor.mjs`). `starterSpec(slot)` is also what
  "+ Add hole" appends.
- **The Course panel** (top of the right column): name, Parkland/Desert, hole count with add /
  delete (floor of three, undoable), the designer line, the cloud status, "Open a draft...",
  "Import file..." and "Download backup". Red Mesa's editor shows only the last four.
- **Play** opens `golf/?editor=custom`; `golf/index.html` builds the course from the document with
  the theme's defaults, pushes it onto `COURSES` for that page load (static imports evaluate before
  the inline script, so `rounds.js` cannot do it) and points the setup screen at it. `ui.js`
  treats a `custom` course as always open. Nothing is recorded (`__gfNoRecord`).
- **Export** writes a complete course module named after the course (`kingslanding.js`) with its
  own obstacle table and `RM_DEFAULTS`, so the fold-back is the same recipe as Red Mesa's: drop it
  in `golf/courses/`, register it in `rounds.js`'s `COURSES`, add `course_<id>` / `blurb_<id>`
  strings and a `GOLF_COURSE_PAR` row, bump CACHE, validate, deploy.

**Cloud drafts (`drafts.js`).** Not the repo: GitHub Pages is static, and a page can only write to
the repo with a token that would be public. The hub's Firebase can. Every edit autosaves (2.5 s
after the last one) to `courseDrafts/<PLAYER CODE>/<courseId>` as `{ docJson, name, theme, holes,
by, updatedAt }` - the document as ONE STRING, because RTDB rewrites nested arrays - verified by
re-read, reported on the panel, never thrown. The browser copy is written first and always; the
cloud is the review copy. **The designer is the hub profile's player code** when this browser has
one (same origin, same localStorage), otherwise a code typed once into the panel and kept under
`golf.holeEditor.code.v1`; the device claims it in `msgAuth/<uid>` exactly as messages do. "Open a
draft..." lists every draft for this editor's course, newest first, with who and when; Load
replaces the local document (confirmed) and from then on autosaves under the REVIEWER's code, so
nobody's draft is ever overwritten by somebody else's edits. Nothing deletes a draft.

**The rules** (`database.rules.json`, published by hand in the console): `courseDrafts` readable
by anyone signed in; `$code` writable by the device that claimed that code, or an admin.
`backups/rtdb-backup.mjs` backs the node up with the rest.

**Not verified in this container**: the cloud write itself. Firebase does not boot on the dev
origin here and dev never writes to the family database (`writesAllowed`), so the panel reads
"Offline: saved on this device only" locally by design. The first real proof is Matt's own
editor showing "Saved to cloud" after the rules are published.

## The "more objects" batch (2026-09-22, finished and shipped on resume)

Spec: `docs/HANDOFF-GOLF-OBJECTS.md`. Engine half (Opus) was merged at the pause; the art half's
WIP branch (`worktree-agent-afbe2793454a75d38`) was merged on resume and finished by the
orchestrator. What changed at that merge, beyond the agent's own work:

- **`palette.js` imports `OBSTACLE_CATALOG` from `golf/js/obstacles.js`**; the TEMP copy and its
  try/catch are gone. Labels are `t('obst_' + name)`, with a capitalised-name fallback only for an
  older course's own type that has no catalogue entry (Oasis Sands' `tall palm`).
- **A single's tile is drawn at ONE common size, not true scale** (`SINGLE_R = 7` yd, through the
  tree's own `s`). At true scale a saguaro, a log or a small rock was a few pixels on a 34-yd tile
  and did not read. Stand tiles keep true relative scale (lifted to a 3-yd floor for the smallest
  things), so the oak/bush size difference still shows somewhere.
- **Decor sprites are painted over the tile at tile resolution** (`drawDecorSprite`, 4x the tile's
  own yards-to-pixels), not into the sampler map: at `MAP_PPY` (2.4 px/yd) a 3-yd bench is eight
  pixels. The same limit applies in the game itself; a bench on a real hole is small, by design.
- **The joshua tree got its own shape, `joshua`** (catalogue and spec updated before the catalogue
  ever shipped, so the frozen-order rule was not broken): with `dead` it was the dead tree's exact
  picture. It is `dead`'s branches plus a spiky olive tuft at each tip.
- **The sampler's swamp is a real `kind: 'swamp'` water recipe** and the post-build relabel and
  post-build decor push (both workarounds for the engine half not being there yet) are gone.
- `test-hole-editor-ui.mjs` gained: every catalogue entry has a single AND a stand tile, the Swamp
  tile places a swamp, the Bench tile places a bench sprite. The Desert-look check now asserts every
  belt tree is a saguaro (with the catalogue, `treeTypes[0]` is `pine` on both looks).
- Reference stills: `reference/golf/palette-2026-09-22-{parkland,desert}.png` (the palette's top,
  in each look). The agent's own contact-sheet script cropped neighbouring objects into every tile
  and was dropped.

## Power lines: the drawing half (2026-09-22, `docs/HANDOFF-GOLF-POWER-LINES.md`)

Built against the ENGINE half once it landed (branch `worktree-agent-a0c026cf7aa1d8bcb`, not
merged into this worktree - built by reading its diff, not by importing it): `golf/js/obstacles.js`
gets an 18th entry, `pole` (`trunk: 0.3, canopy: 0.3, height: 40`); a hole's recipe carries
`lines: [{pts, h}]`; the BUILT hole carries `hole.lines[i] = {pts, lo, hi}` (`lo = h - 1.0, hi = h +
0.6` - the band `shot.js`'s `wireHit` reads) plus an ordinary `'pole'`-type tree at every point.

- **`golf/js/render.js`**: `treeShapes`/`treeAccent` case `'pole'` - a small grey disc with a dark
  crossarm, both FLOORED (`Math.max(1.1, r*0.5)` / `Math.max(2.2, r*1.7)`) because the catalogue's
  own `canopy: 0.3` rasterises to a sub-pixel 0.36 px disc at `MAP_PPY` (2.4 px/yd) - honest to the
  pole's real width and invisible, not small. `drawWire()` draws two thin parallel strokes per span
  (offset in RASTER space off `toPx`'d points, so the y-flip can't put them on the wrong side) plus
  a shadow offset by `SHADOW_LEN`/`SHADOW_DROP` x wire height, the same rule a tree's canopy shadow
  uses. Drawn straight onto the map canvas AFTER the tree layer is composited (poles are ordinary
  trees and are already in it) - a wire has no canopy to fade for a putt underneath it, so unlike a
  tree it is never drawn translucent. `h = ln.lo + 1` when the built shape is present, falling back
  to `ln.h` for a hand-built stand-in hole that skips holegen entirely (a browser probe, or the
  palette's own sampler, below).
- **`hole-editor/js/canvas.js`**: `listObjects()` gets a `lines` entry per spec line -
  `{group:'lines', index, pts, h, center: <midpoint>, drawn: true}`, deliberately no `poly` key (a
  polyline is not a closed shape). `drawn: true` is the whole trick: the EXISTING generic
  select-and-drag code (`objDrag.kind === 'object' && objDrag.drawn`) already calls
  `translateDrawn`, and the engine's `translateDrawn` was extended to move `pts` when there is no
  `poly` - so a whole line drags with no new drag branch. `hitTest()` adds its own two checks (a
  line's SPAN, 1.5 yd tolerance, point-to-segment distance; and, only when a line is already
  selected, a POINT HANDLE at each pole, checked first so it wins over "drag the whole line" - the
  same precedence a bunker's resize handle gets over its outline) and returns `{group:'linePoint',
  index, k}` for the latter, handled by its own `objDrag.kind === 'linePoint'` branch calling
  `moveLinePoint`. `finishDraw()`'s only change is the minimum point count (2 for `group ===
  'lines'`, 3 for a closed shape) - the actual add goes through the SAME `addDrawnShape` call every
  other drawn group uses, because the engine's `addDrawnShape` routes `group === 'lines'` straight
  to `addLine` (unsmoothed - Chaikin-rounding a clicked pole position would move the pole). The
  render loop's object-outline pass gets its own `o.group === 'lines'` branch (the polyline plus, if
  selected, a gold point handle per pole) and the generic "selected -> centre dot" code is skipped
  for lines, since the point handles already mark every pole.
- **`hole-editor/js/panels.js`**: `renderLine()` (wired into `renderSelect`'s `byGroup` AND into
  `renderContextPanel`'s `byTool.line`, for the moment between picking the tool and placing the
  first pole) shows the wire height (a 4-20 yd slider) and the pole count; there is no shape control
  here at all - a line's SHAPE is edited by dragging its point handles on the map, the same way a
  route waypoint is. `drawingHint()` gets line-aware wording ("click each pole... Enter or
  double-click to finish") instead of "close the shape".
- **`hole-editor/js/palette.js`**: a new "Structures" section, one tile, `{kind: 'tool', tool:
  'line'}` (not a `kind: 'draw'` tile - picking the RIBBON TOOL is what starts the line, per
  `main.js`'s `setTool('line')`). Its sampler stamps `hole.lines` on the BUILT sampler hole by hand,
  AFTER `makeHole()` (which never sees a `lines` field this way - a sampler is hand-built, not a
  recipe, so this is not a stand-in and stays this shape even after the merge), in the real
  `{pts, lo, hi}` form. The matching "Power pole" single-tree tile needs no code at all - it falls
  out of the catalogue loop that already builds one tile per `treeTypes` entry.
- **Tests**: `test-hole-editor-ui.mjs`'s "Power line" block (Power line tile + three map clicks +
  Enter -> `spec.lines` with 3 points; select + Delete removes it) and the catalogue-size assertion
  (18 entries, `pole` last). The two halves were built in parallel; at merge the palette's TEMP
  pole markers (drawn while the catalogue had no `pole`) were deleted.
- **Still**: `reference/golf/power-line-2026-09-22.png` - a hand-built three-pole line (bypassing
  holegen.js entirely, in the real `{pts, lo, hi}` shape) rendered in both themes at map resolution,
  the palette's own "Power line" tile in both themes, and a 6x nearest-neighbour crop over the
  centre pole so the raster can be judged by eye rather than guessed at from a thumbnail. Looked at
  directly: the pole reads as a solid dark knob where its crossarm (drawn along the wire's own
  direction here, since the span is dead straight and horizontal) merges with the two wire strokes;
  the wire itself is unambiguous as two thin parallel dark lines the whole span. That merge is
  realistic, not a probe artefact - a power line usually crosses a fairway close to perpendicular to
  the hole's own direction, which is exactly the layout drawn here.

## Two new looks: Links and Tropical (2026-09-22)

The Course Creator's Look control is now a list of four (`LOOKS` in `main.js`): Parkland, Desert,
Links, Tropical. A look is two data entries and nothing else:

- a palette in `golf/js/render.js` `THEMES` (keyed by the look's own name; `paletteFor` falls back
  to Pine Valley's for `parkland`, which has no entry of its own);
- a default in `hole-editor/js/starter.js` `THEME_DEFAULTS` (belt species, optional `rough`).

Links: fescue fairways, straw rough, dune-grass base, darker pot-bunker sand, a grey sea with a
sandy bank; belts of **gorse**, a new catalogue entry (index 18, appended after the pole; `shape:
'gorse'` = the bush's circles plus yellow flower dots in `treeAccent`). Tropical: saturated turf, a
dark jungle floor (palm fronds vanished on anything lighter, measured by eye on a zoomed still),
white sand, a turquoise lagoon with a beach bank; belts of palms. Catalogue `looks` hints were
widened so each look lists its own species first (ordering only; the table order is unchanged).
`export.js` now accepts any `THEME_DEFAULTS` key as the exported theme and prints that look's
`rough`, instead of hard-coding desert. Wind was NOT made a property of a look: per-hole wind is
already in the editor. Still: `reference/golf/looks-2026-09-22.png`. Mountain and Swamp looks are
the next two if Matt wants them.

## Help page (2026-09-22)

`hole-editor/help.html`, opened by the ribbon's **? Help** link (new tab). Plain words for someone
who has never seen the tool: start here, the screen, adding things, drawing, one card per ribbon
tool, the green, a tree-height rule of thumb, Validate/Play, saving and sending, keys. Pictures are
STILL screenshots of the real Course Creator (`hole-editor/help/*.jpg`, ~125 KB each), not looping
recordings: much smaller and cheaper to make. Re-take them when the screen changes. The whole
`hole-editor/` folder is outside the service worker (`validate-sw-assets.mjs` EXCLUDED), so
changing it needs no CACHE bump. Written alongside it: the drawing panel's corner count now
refreshes on every click (`canvas.js` calls `onDrawChange` after each point; it read "0 corners"
with three placed). UI suite: a probe for that and one that the Help link loads.

### Mountain and Swamp (2026-09-22, same day)

Two more looks, same two-entry recipe. **Mountain**: cool alpine greens, glacial blue water with a
stone bank, granite-grey sand; belts of **spruce**, a new catalogue entry (index 19, `shape: 'fir'`
in a blue-green `TREE_FILL`, height 20). **Swamp**: olive turf, murky green water with a mud bank;
belts of weeping willows standing on a FLOODED floor (`treesFloor` is the swamp-water tone).
Cypress belts were tried first and vanished: dark narrow crowns on a dark floor. The Look control
is six buttons in two columns. Wind stays per hole (Hole panel, untick "Wind: auto"); no look
changes it. Still: `reference/golf/looks-2026-09-22.png`, all six looks.

## The setup screen comes first (2026-09-23)

Matt: *"Course and Savings needs to be easy and obvious as a first selection... it's the first thing
he should do - name the course and choose the terrain type."* A Course Creator document that has
never been named (`course.named` unset) opens on a modal (`openSetupModal` in `main.js`): course
name (required), six terrain tiles each drawn by the real renderer, and the player code if the
editor does not know it yet. `named: true` is stamped on Start, or when the Course & saving panel's
name field is filled. The ribbon's first item on the Course Creator is a course button ("name ·
terrain") that reopens it. Ribbon tools may now shrink to 60px (`.he-tool`) so that button and Help
still fit at 1280px. `applyLook()` is the one place a look is switched. UI suite: six probes.

## Tidying the screen (2026-09-23)

- **Terrain pictures show the EDGE of a hole** (a pond, a bunker, that look's woods on its own
  ground), not the fairway: every fairway is nearly the same green, so the first version's six
  tiles looked alike (Matt: *"why do all of these look the same?"*). `lookPicture()` in `main.js`.
- **Palette groups fold** (click a section or sub-head; `golf.holeEditor.palFolds.v1`, per browser).
- **Layer checkboxes live behind a Layers chip** beside Key; opening one closes the other.
- **The holes bar minimises** to one thin row (totals + Show holes); `uiState.stripMin`.

## Help is a guided practice run (2026-09-23)

Matt: *"way too much text on the Help page... should be a test (or fakeish) version of the tool, that
has arrows and pop ups."* The ribbon's Help opens `?course=tutorial`: the REAL Course Creator on a
throwaway course (`PROFILES.tutorial` in `course.js`: same document type, its own storage key wiped on
every open, `getDesigner` returns null so it never reaches the cloud, status reads "Practice: nothing
here is saved"), with `js/tour.js` over it: a pulsing ring round the thing to use, a yellow pop-up
with an arrow, one sentence per step, 17 steps. A step with `done()` moves on by itself once the
player has done it (typed a name, picked the bunker tile, placed a bunker, planted a tree); the rest
have Next. The tour only reads `window.__he` and the DOM. `help.html` is now just a redirect so old
links work; the text page and its screenshots are gone. When the editor's screen changes, walk the
tour again (`reference`-style: drive it in Chromium and look at each step).

## "It's laggy" (2026-09-23)

Measured with a CPU profile of a 15-step bunker drag (Chromium, software rendering): every frame
was a 120-230 ms long task. Three things ran per frame: the hole's own map build (~45 ms, needed),
**the whole palette** (~75 canvas tiles, ~30 ms - it grew from ~20 tiles to ~75 this week), and
**the holes bar's thumbnail of this hole** (~14 ms). Now `refreshPalette()` rebuilds only when its
key changes (look, highlighted item, guards, type names) and the holes bar is not redrawn mid-
gesture (it catches up at the end of the drag). Measured after: 20-step drag 3.7 s -> 1.8 s, long
tasks 120-230 ms -> ~50 ms, and a tool switch that re-renders the palette 38 ms -> 3 ms. What is
left is `buildMap` itself; do not add per-frame work to `afterChange`'s gesture path without
measuring it (the profiling script pattern: CDP `Profiler.start` around a scripted drag).

### Matt's review of the walkthrough (2026-09-23), all 14 points

22 steps now. What changed and why, so nobody re-derives it:
- **Every "do this" step moves on by itself** when it is done: name typed, terrain tile clicked,
  Start pressed, bunker tile picked, bunker placed, bunker DRAGGED (the step switches to Select
  first: after placing, the tool is still Bunker, so a drag placed another bunker instead - that
  was "dragging to move doesn't work"), tree planted, Route/Green tools clicked.
- **A step that points at settings opens the Selection panel first** (`openPanel('context')`); a
  folded panel made "Its settings show up here" point at nothing. Same for Course & saving.
- **New steps**: the tree's settings, the Route panel's dogleg/S-bend buttons, the green's settings,
  and SAVING ("saves by itself... open the same link any time... Download backup").
- **Wording**: fold -> "hide that group"; "Click anywhere on the hole to add the bunker there";
  Route says double-click adds a dot; Select says drag an empty spot to move around (that pan
  already existed on Select); Validate names real problems; the course button says the terrain
  changes EVERY hole. The Route panel's paragraph of text was cut to one line.
- **Layout**: fold arrows are 18 px and gold; the green's six shapes wrap instead of clipping
  "teardrop"/"clover"; the tour ring is clipped to the visible part of a tall panel; the last
  pop-up is wider and centred with nowrap buttons (it wrapped "Start my course" in two).
- **After the walkthrough** (`golf.holeEditor.tourDone.v1`, set on the last step), Help opens a
  menu: nine topics (`TOPICS` in tour.js, each `?course=tutorial&topic=<id>` - the tour fills the
  setup screen with "Practice" and jumps in) plus "Replay the whole walkthrough".
- **Before it**, the real Course Creator nudges toward Help: a "New here? Take the guided tour"
  button on the setup screen and a yellow note under Help ("No thanks" dismisses it for good,
  `golf.holeEditor.helpNudgeOff.v1`). Neither shows in Red Mesa's editor or in practice.

### Changing the terrain later asks first (2026-09-23)

Matt: the course-button step should warn that a terrain change can "mess it up". What it really
does: every hole's colours and every untouched tree line switch to the new terrain; placed objects
keep their type. It is NOT on the undo stack (undo snapshots `order`/`holes`, not `course`), but
nothing is lost - picking the old terrain again restores the exact same course. So once a course
is named, `confirmLookChange()` asks before switching (setup screen and Course & saving panel), and
the tour step says the same thing in one sentence. The final tour step now says to close the Help
tab (its button tries `window.close()` and falls back to opening `?course=new`), and the saving
step says it is the practice course *in Help* that is not saved.

### The first visit IS the walkthrough (2026-09-23)

Matt: *"the link should auto open the help walkthrough the first time someone visits... then after
that it just goes straight to the tool."* `main.js`, right after the stored document is read: on
the Course Creator, if this browser has never been offered the tour (`golf.holeEditor.tourOffered.v1`),
has not finished it, and has no NAMED course, it sets the flag and `location.replace`s to
`?course=tutorial&first=1` (a top-level `await` on a never-resolving promise stops the rest of the
module). In `first` mode the tour's last step says "Now start your own course" with a **Start my
course** button, and its x means "skip the tour and start my course" - both go to `?course=new`,
same tab. The order is therefore always: link -> walkthrough -> name and terrain -> the tool; every
later visit goes straight to the tool. `test-hole-editor-ui.mjs` walks both paths (finish, and skip
with x) end to end, including that the practice course never touches the real one.

## Report bug (2026-09-23)

Matt: *"we need a report bug option so i can fix things that are broken."* The ribbon's **Report
bug** opens the HUB's own form (`js/bug-report-ui.js`): same `bugReports/` node, same inbox Matt
reads in Messages, same screenshots and offline outbox - not a second pipeline. Two small additive
options were added to it: `where: {value, label}` puts a place the hub list lacks at the top of
the picker, preselected ("Course Creator", "Red Mesa hole editor", or "Course Creator (Help
practice run)"), and `context` saves one line on the record (`report.context`, max 500 chars,
shown under the description in the inbox): designer, course and terrain, hole, tool, selection.
Copy JSON is hidden on the Course Creator (Download backup does its job) so Report bug and Help fit
at 1280 px. The walkthrough has a step for it. `js/` is in the service worker's shell, so this one
bumped CACHE.

## On a phone, stage 1: the layout (2026-09-23, `docs/HANDOFF-GOLF-COURSE-CREATOR-MOBILE.md`)

Matt chose REFLOW (one editor, a phone layout under a breakpoint) over a separate phone mode, on
the condition that the desktop editor does not change. Under 900 px wide (`PHONE_MQ` in
`main.js`, the one `@media (max-width: 899px)` block at the end of `editor.css`):

- **Viewport meta is `width=device-width`** (was `width=1280`). Desktop browsers ignore it.
- **Ribbon**: course button, Undo, Redo, **Tools**, Bug, Help. Tools (`#he-m-tools`) unfolds the
  whole ribbon as a four-column grid over the map; picking anything in it folds it again.
- **Palette = the Add sheet, inspector = the Edit sheet**: `.he-left` / `.he-right` become bottom
  sheets (`openSheet('add' | 'edit' | null)`) with a close bar (`.he-sheet-bar`) and a scrim.
  Picking a tile closes Add so the map can be tapped; a new selection opens Edit with Selection
  unfolded.
- **Holes bar = `#he-mbar`**: previous, a hole `<select>`, next, + Add, Edit. Reordering holes by
  drag and Discard ALL edits are desktop-only.
- **Every phone-only element is `display:none` above the breakpoint**, and the few behaviour
  changes are gated on `isPhone()`. Proof it held: `test-hole-editor-ui.mjs` 108/108, and 8
  desktop screens (Red Mesa, setup, Course Creator, Route; 1920x1080 and 1280x800) pixel-identical
  before and after (0 pixels changed).
- Inputs are 16 px on the phone (iOS zooms the page into anything smaller).

Not yet: touch gestures (stage 2), on-screen Delete/Finish (stage 3), setup screen and walkthrough
at 390 px (stage 4), measured speed on a phone profile (stage 5).


## On a phone, stage 2: touch (2026-09-23)

`canvas.js`'s four mouse handlers are now named (`onDown`/`onMove`/`onUp`/`onDbl`, bodies
unchanged) and a MOUSE still goes straight to them. A FINGER (`pointerType === 'touch'`) goes
through a touch layer first, because nothing may happen on touch-DOWN: a placement tool placed on
pointerdown, so the first finger of a pinch dropped a bunker.

- **Tap** (up within 10 px): replayed as a click at the start point (down + up).
- **Drag** (moved > 10 px): replayed as a mouse drag when it started on something the mouse could
  drag (`wouldGrab`: an object with Select, a route dot, a width handle, a pin, a pole, a resize
  handle, a slope cell); otherwise one finger PANS. Nothing is placed by a drag.
- **Two fingers**: pinch zoom about the midpoint plus pan. A second finger cancels (ends) the first
  finger's action; the rest of that touch sequence is ignored until every finger is up.
- **Long press** (500 ms): replayed as a double-click - route dot, width dot, closes a drawing.
  A browser's own synthesised `dblclick` is ignored after a touch.
- **Hit sizes**: `_tolPx()` is 22 screen px for a finger, 12 for a mouse (`touchMode`).
- The readout keeps the last touch (a finger has no hover); `#he-canvas` has `touch-action: none`.
- **The Edit sheet** no longer auto-opens mid-drag (`touchDragging`), has no scrim (the map above
  it stays live), and pans the map so the thing just selected sits above it (`keepAboveSheet`).

`test-hole-editor-mobile.mjs` (repo root, 390x844, CDP touch): 23 checks; against the stage-1
canvas it failed 10 of them. `test-hole-editor-ui.mjs`'s topic-link check now waits 15 s, not 5:
it failed 2 runs in 3 on UNCHANGED code, because on a reload headless software rendering spends
3-6 s in `drawImage` (buildMap for the palette and the holes bar) before the tour paints.

## On a phone, stage 4: the setup screen, modals and walkthrough (2026-09-23)

Done BEFORE stage 3 on purpose: Matt had already sent the King the link, and the walkthrough plus
the setup screen are the first two things a phone meets.

- **Modals** get class hooks only (`.he-setup-box/-head/-foot`, `.he-modal-box`, `.he-drafts`,
  `.he-cmp-row/-frame`); every rule on them sits in the phone `@media` block. Setup: two terrain
  columns, the guided-tour link on its own row, Start designing full width above the note.
  Compare: the two holes side by side at half width each. Drafts: one stacked card per draft.
- **`tour.js` on a phone**: a step may carry `m: {at, say, start, done, side}`, used in place of
  its own fields when `window.__he.isPhone()`; `at` may be a function (`viaTools(sel)`: the Tools
  button, then the tool inside the open grid). Steps open the right sheet themselves (`sheet('add'
  | 'edit' | null)` via `window.__he.openSheet`). Every other step's words get "Click" -> "Tap".
  Placement: never beside a target; above or below it, or across the top of a target taller than
  45% of the screen (the map, a sheet); pop-up width `min(300, 100vw - 24)`.
- `test-hole-editor-mobile.mjs` walks the whole run from a first visit on a 390x844 touch
  screen: it reaches the last step, every pop-up is on screen, none says "click". 30 checks.

## On a phone, stage 3: on-screen stand-ins for the keys (2026-09-23)

- **Edit sheet bar: Duplicate and Delete** (`#he-m-dup`, `#he-m-del`), shown only when the
  selection allows it. Delete goes through `EditorCanvas.deleteSelection()`, which is the Delete
  key's own code moved into a method (the key now calls it too); `canDeleteSelection()` says when
  (never the tee's or the last route dot, a width handle, or a guard hazard).
- **Drawing bar** over the map (`#he-m-drawbar`, shown by `.he-root--drawing`): Undo point,
  Cancel, Finish (n) - Backspace, Esc and Enter. Finish is disabled below the minimum (3 corners, 2
  poles). Starting a drawing closes any open sheet. The map's own "double-click or Enter" hint is
  not drawn for a finger (`touchMode`).
- **The Tools grid** ends with one line: width handles, slope painting and drawn outlines are
  easier on a tablet or computer (the handoff's "say which tools are tablet/desktop recommended").
- `syncPhoneBars()` runs at the end of every `refreshContext()`.

`test-hole-editor-mobile.mjs`: 40 checks (stage 3 adds Duplicate, Delete, and a lake drawn with
five taps, Undo point, Finish, then a Cancel).

## On a phone, stage 5: measured on a phone profile (2026-09-23)

Profile: 390x844, deviceScaleFactor 3, touch, CDP `Emulation.setCPUThrottlingRate` 4, a
long-task PerformanceObserver, and a CDP CPU profile around the gesture (scratch script, the same
pattern as "It's laggy").

| Gesture (4x throttle) | Before | After |
|---|---|---|
| 20-step finger drag of a bunker | 4.4 s, 18 long tasks, median 159 ms | 1.2 s, 1 long task (128 ms, the release rebuild) |
| Tap to place a bunker | one 433-490 ms task | one 342 ms task |
| 20-step pan / pinch / hole switch | no long tasks | unchanged |

- **A finger drag on the map, on a phone, no longer rebuilds the hole per frame**
  (`fingerDrag()` in `main.js`: `isPhone() && editorCanvas.touchDragging`). `buildMap` was ~70% of
  each frame. The frame calls `EditorCanvas.previewSpec(spec)` instead: the object's outline moves
  over the UNCHANGED map (the old sand stays painted where it was until the finger lifts), and
  `liveEnd()` rebuilds once. `liveUpdate` passes the last built hole instead of building one (no
  canvas drag reads it). A mouse, and every slider, keep the full live rebuild.
- **The hidden holes bar is not painted on a phone** (`refreshStrip()` only refreshes the hole
  picker; it paints the bar when the screen widens). It cost a map build per edit.
- What is left per edit is the edit's own rebuild (makeHole + buildMap), about 85 ms unthrottled.
