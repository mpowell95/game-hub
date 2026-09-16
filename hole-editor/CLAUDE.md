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
