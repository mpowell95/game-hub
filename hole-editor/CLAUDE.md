# hole-editor/ - the Red Mesa hole editor / the Course Creator

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file. (This tool records no stats; its own data is course drafts and browser documents - never delete a draft.)

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Build spec: `docs/archive/HANDOFF-GOLF-HOLE-EDITOR.md` (repo root). Mobile spec: `docs/HANDOFF-GOLF-COURSE-CREATOR-MOBILE.md`.
Objects spec: `docs/HANDOFF-GOLF-OBJECTS.md`. Power lines: `docs/HANDOFF-GOLF-POWER-LINES.md`.

## What it is, and where it stands (2026-09-24)

- A desktop-first editor for Golf courses. `/hole-editor/` = Red Mesa (key `golf.holeEditor.redmesa.v1`, ids `rm-NN`, exports `redmesa.js`).
  `/hole-editor/?course=new` = the **Course Creator**, a blank 18-hole course (key `golf.holeEditor.custom.v1`, ids `h-NN`, exports `<slug>.js`).
  `?course=tutorial` = the Help guided practice run (throwaway course, wiped on every open, never reaches the cloud).
- It is a **Game Hub tile** (`course-creator` in `js/hub.js` `GAMES`): launch-out `href: 'hole-editor/?course=new'`, `devOnly`, opened to chosen players by player code from the admin page (`adminConfig/v1/games/course-creator/allow`; root `CLAUDE.md`, "The admin control page"). No stats, no `GAME_META` row. The tile hides the TILE, not the page.
- **`hole-editor/` is OUTSIDE the service worker on purpose** (`validate-sw-assets.mjs` `EXCLUDED`; a stale cached `render.js` was the reason). So editing here needs no CACHE bump, but the tile does not open offline, and GitHub Pages caches ~10 min (a hard refresh may be needed). Anything under `js/` that is in the shell DOES need a bump (Report bug did).
- **R5, the root rule of the tool: the editor never builds a hole itself.** It always calls the game's real `makeHole`/`buildMap`/`validateHole` and uses the real built hole as judge; it never re-derives holegen geometry. It never writes the game's files; the fold-back is a separate session step.

## File map

- `index.html`, `editor.css` (one `@media (max-width: 899px)` block at the end = the phone layout), `help.html` (redirect to `?course=tutorial`)
- `js/model.js` - document shape, `normalise()`, `buildHole()`, mutators (`deleteBunker`, `setBeltSide`, `movePathPoint`, `addDrawnShape`, `addLine`, ...), undo/redo, persistence, `setCourse`
- `js/course.js` - profiles (Red Mesa / custom / tutorial); `js/starter.js` - 18 plain holes + `THEME_DEFAULTS` per look
- `js/export.js` - `generateSource(doc, date)`, `generateJSON(doc)`; `js/drafts.js` - cloud drafts
- `js/canvas.js` - camera, hit-testing, tools, touch layer, ghost/FX; `js/iso.js` - the isometric projection; `js/panels.js` - panels; `js/palette.js`; `js/tray.js` (phone trays); `js/tour.js` (walkthrough); `js/main.js` (boot, ribbon, setup modal, phone bars)

## Tests

- `node test-hole-editor.mjs` (headless; 58/58 at last count) - round-trip, export, structural checks. `node test-hole-editor-ui.mjs` (Playwright, needs `node server.mjs`; 112/112) - NOT in `run-all-tests.mjs`. `node test-hole-editor-mobile.mjs` (390x844 touch + iPhone safe areas; 61/61). `node test-hole-editor-play.mjs` (Play override reaches the setup screen).
- Also run `node golf/js/test.js` after any engine-side change, and `node validate-sw-assets.mjs` after touching a game file.
- `test-hole-editor.mjs` is in `run-all-tests.mjs`. Each defect found by driving the tool is kept as a `[KNOWN-BUG PROBE]` in the UI suite.

## A decision the spec's formula didn't survive contact with: normalise() does NOT round `yd`

- `normalise()` converts an original `at` to `yd` at full float precision; where that still shifts a hazard one spline station (~4 yd; Red Mesa 5's fairway bunker, 11's water) it nudges by fractions of a yard until the whole hole matches bit-for-bit (`fixStationRounding`), always using the real `makeHole` as judge.
- `roundYd()` (1 dp) is only for NEW placements from a click. Export prints numbers as-is, so untouched values may show long float tails (`193.38000000000002`): cosmetic, do not "fix" by rounding (it relocates hazards).
- The round-trip (all 18 Red Mesa holes JSON-identical after normalise/export) is the correctness contract of the whole tool. (Full story: CLAUDE-HISTORY.md.)

## Rules still in force (engine side effects the editor depends on)

- **Placement is in yards from the tee** (`yd`); `place()` may run past the pin (`yd: length + 20`). Every waypoint is floored at tee + 10 yd (`clampAheadOfTee`); the tee is immovable (R4).
- **`dropLoops`** (`golf/js/holes.js`) cuts small self-crossing loops (<= 8 vertices) from `smoothPoly`/`offsetOutline`; bigger crossings are left for the validator. `validateHole` refuses self-crossing polygons, pins off the green, bad `lines`/hedges.
- **Order of built surfaces** (author bunkers, guard-token bunkers, cross-derived, auto-defend last): only author entries (`spec.bunkers/water/trees/sentinels/cross/lines`) are selectable objects; guard hazards are recipes (use "Detach guard presets"); cross hazards get an approximate selection outline only.
- **Width `w` is a HALF-width**; panels print the full width. Tree `s` (0.4-3) and `h` (1-60 yd) are engine fields read by `treeHit`, the renderer and `makeHole`; `angle` turns a stand. Wind per hole: `wind: { speed, deg }` or auto.
- **Greens/pins**: `greenOutline` (drawn), `fringe` (number or per side), `pins` (one = cup; 2+ = `hole.pins`, `ui.js` `_enterHole` picks one at random per play).
- **Slider wiring**: `slider(id, ...)` renders `#id-r` and `#id-n`; never guard `wireSlider` on the bare `#id` (pinch, rough, green ry and wind were dead for a day that way). `pruneSelection()` runs on every non-gesture change (undo/delete of a selected object). Clear selection BEFORE mutating on Delete. Single/Stand toggle drives the NEXT placement only.
- **Never add per-frame work to `afterChange`'s gesture path without measuring** (CDP `Profiler.start` around a scripted drag). During a live gesture the spec updates every event but rebuild/canvas/panels refresh once per animation frame; `mapFor(built)` WeakMap shares one painted map; `refreshPalette()` rebuilds only when its key changes; the holes bar is not redrawn mid-gesture. On a phone a finger drag uses `previewSpec` (no rebuild until release, `fingerDrag()`); the hidden holes bar is not painted on a phone.
- **Autosave/persistence**: browser copy first and always (300 ms debounced; `saveNow()` before Play/Hub); UI state `golf.holeEditor.ui.v1`; palette folds `golf.holeEditor.palFolds.v1`; designer code `golf.holeEditor.code.v1`; tour flags `golf.holeEditor.tourOffered.v1`, `.tourDone.v1`, `.helpNudgeOff.v1`. Space+drag pan must guard against focused text inputs.

## Phase 2: the three guarded game edits, and Play

1. `golf/js/rounds.js` `courseById(id)` returns `globalThis.__gfCourseOverride` only when its own `id` matches the one asked for.
2. `golf/index.html`: with `?editor=1` (Red Mesa) or `?editor=custom` (Course Creator), BEFORE `init()`, reads the editor's localStorage document, builds holes with the real `makeHole`/defaults, sets `__gfCourseOverride` and `__gfNoRecord = true`; custom is pushed onto `COURSES` for that load (`ui.js` treats `custom` as always open; strings `course_custom`/`blurb_custom`). Bad/missing document falls through to the shipped course, logged. `requireName()` still runs.
3. `golf/js/ui.js`: both `recordGolf` call sites return at the top when `__gfNoRecord` is set. **Nothing is recorded from an editor preview.**
- Play button (`he-play`) opens the game in a new tab; no deep link to a hole. The override is inert for anyone who never opened the editor.

## The Course Creator (2026-09-22): the same editor on a blank course, with cloud drafts

- The Course panel: name, look, hole count (add/delete, floor of three, undoable), designer line, cloud status, "Open a draft...", "Import file...", "Download backup". Red Mesa's editor shows only the last four.
- **Export** writes a complete course module named after the course with its own obstacle table and `RM_DEFAULTS` (`OBSTACLE_CATALOG` imported, never inlined). **Fold-back recipe**: drop it in `golf/courses/`, register in `rounds.js` `COURSES`, add `course_<id>` / `blurb_<id>` strings and a `GOLF_COURSE_PAR` row (`js/leaderboard-rank.js`) plus `js/game-stats-ui.js` `GOLF_COURSES`/`GOLF_COURSE_HOLES`, bump CACHE, `node golf/js/test.js`, validate, deploy. Red Mesa's fold-back (CACHE v852): replace the file, `node golf/js/test.js`, check par against `GOLF_COURSE_PAR`, bump, validate, deploy.
- **Cloud drafts (`drafts.js`)**: autosave 2.5 s after the last edit to Firebase `courseDrafts/<PLAYER CODE>/<courseId>` as `{ docJson, name, theme, holes, by, updatedAt }` - `docJson` is ONE STRING (RTDB rewrites nested arrays); verified by re-read, reported on the panel, never thrown. Designer = hub profile's player code (else typed once, kept under `golf.holeEditor.code.v1`); the device claims it in `msgAuth/<uid>`. "Load" replaces the local doc (confirmed) and autosaves under the REVIEWER's code, so nobody's draft is overwritten. **Nothing deletes a draft.**
- **Rules** (`database.rules.json`, published by hand): `courseDrafts` readable by any signed-in user; `$code` writable by the device that claimed it, or an admin. `backups/rtdb-backup.mjs` backs it up. The cloud write was never verified in the dev container (dev never writes to the family DB); first real proof is "Saved to cloud" on Matt's editor.
- **Setup modal first** (`openSetupModal`): an unnamed Course Creator document opens on name + six terrain tiles (drawn by the real renderer showing a hole EDGE: pond, bunker, woods) + player code if unknown; `course.named` stamped on Start. `applyLook()` is the one place a look is switched. **Changing terrain later asks first** (`confirmLookChange()`): it recolours every hole and untouched tree line, placed objects keep their type, it is NOT on the undo stack, but picking the old terrain restores it exactly.
- **The first visit IS the walkthrough**: never-offered + not finished + no named course -> `location.replace('?course=tutorial&first=1')`; last step "Start my course" / x both go to `?course=new`. Every later visit goes straight to the tool.
- **Help = guided practice run** (`js/tour.js`, 23 steps, `window.__he` + DOM only; steps with `done()` advance themselves; a step that points at settings opens its panel first; `TOPICS` menu after the first completion). Wording rule: one short sentence per step; on a phone "Click" -> "Tap". When the editor's screen changes, walk the tour again in Chromium.
- **Report bug** ribbon button opens the hub's own form (`js/bug-report-ui.js`, same `bugReports/` node) with `where: {value,label}` (preselected) and `context` (one line, max 500 chars). Copy JSON hidden on the Course Creator.

## Two new looks: Links and Tropical (2026-09-22)

- (Mountain and Swamp followed the same day: "Mountain and Swamp (2026-09-22, same day)" in CLAUDE-HISTORY.md.) Six looks in `LOOKS` (`main.js`): Parkland, Desert, Links, Tropical, Mountain, Swamp. **A look is two data entries**: a palette in `golf/js/render.js` `THEMES` (keyed by name; Parkland falls back to Pine Valley's) and a default in `hole-editor/js/starter.js` `THEME_DEFAULTS` (belt species, optional `rough`). Wind is NOT a property of a look. Export accepts any `THEME_DEFAULTS` key.
- Belt species per look: gorse (Links), palms (Tropical), spruce (Mountain), weeping willow on a flooded floor (Swamp). Dark crowns on a dark floor vanish - check by eye on a zoomed still. Reference stills: `reference/golf/looks-2026-09-22.png`.

## The "more objects" batch (2026-09-22, finished and shipped on resume)

- `palette.js` imports `OBSTACLE_CATALOG` from `golf/js/obstacles.js` (labels `t('obst_' + name)`; capitalised-name fallback only for an older course's own type with no catalogue entry, e.g. Oasis Sands' `tall palm`). **The catalogue order is FROZEN - append only** (55 entries now; engine side: `golf/CLAUDE.md`, "The obstacle catalogue (2026-09-22)"). The one re-index ever allowed is `migrateDocument` (`catalog: 1`).
- A single's tile is drawn at one common size (`SINGLE_R = 7` yd); stand tiles keep relative scale. Decor sprites are painted over the tile at tile resolution (`drawDecorSprite`). Swamp sampler is a real `kind: 'swamp'` recipe. Benches/signs/flagpoles are not offered on the phone (Matt) but still exist on desktop and still draw.
- A wide variety of trees (2026-09-23, CACHE v937): 35 entries appended; twelve new renderer shapes (top-down in `render.js`, standing in `iso.js` `drawIsoTree`); an ACCENT colour is `TREE_FILL`'s optional third entry (paint only; nothing may rely on red-vs-green; autumn trees are gold). Grasses/reeds are short (1-2.5 yd): every club flies them.
- **Wildflowers** (decor `kind: 'flowerbed'`, id kept; sprite or drawn shape): decor only, never touches play (`test-hole-editor.mjs` proves the lie under one is unchanged).

## Power lines: the drawing half (2026-09-22, `docs/HANDOFF-GOLF-POWER-LINES.md`)

- Recipe `lines: [{pts, h}]`; built `hole.lines[i] = {pts, lo, hi}` plus an ordinary `'pole'` tree (catalogue index 17) at every point. The wire is drawn by `render.js` `drawWire` (two strokes + shadow); the pole shape is FLOORED because its real width is sub-pixel.
- `listObjects()` gives a line `{group:'lines', center, drawn: true}` and no `poly`; the generic drag path then calls `translateDrawn` (extended to move `pts`). `hitTest` checks a span (1.5 yd) and, only when selected, a point handle per pole first (`linePoint`). `finishDraw` minimum is 2 points for lines, 3 for a closed shape; `addDrawnShape` routes `lines` to `addLine` UNSMOOTHED (rounding would move a pole). A line's SHAPE is edited by dragging its pole handles. Palette: "Structures" -> one `{kind:'tool', tool:'line'}` tile.

## Tall grass and the island green (2026-09-23, CACHE v944)

- `tallGrass` is a SURFACE KIND (engine in `golf/CLAUDE.md`); it rides the `water` list and the `cross` list as `kind: 'tallGrass'` exactly like a swamp, so place/draw/across/duplicate/redraw/export come free. `island` is a guard token (40-point water ring round green + fringe + ~9 yd; the water drop searches 14 yd, wider than the moat). No bridges (Matt). Desktop palette: "Tall grass" group + "Island green"; phone: bottom of the TREES tray / GREEN tray. (Full story: CLAUDE-HISTORY.md.)

## Hedges and out of bounds (2026-09-24)

- A hedge is a drawn LINE with `kind: 'hedge'` (`spec.lines`; `h` 0.8-4 yd default 2, `clampHedgeH`); holegen builds `hole.hedges = [{pts, h}]`, NOT `hole.lines`, no poles. `oob` is a surface kind drawn like a swamp (a `water` entry with `kind: 'oob'`); a ball that STOPS there is stroke and distance. Stakes via `stakesAlong` (iso editor stands them up). Palette: Structures -> Hedge / Out of bounds; phone: More -> Add & draw. (Engine: `golf/CLAUDE.md`, "Hedges and out of bounds (2026-09-24)".)

## The isometric look (stages 1-3, 2026-09-23/24)

- Matt chose **new look, same hole format**: only the camera and paint changed. **The projection is one formula in `js/iso.js`** (`px = W/2 + (u+v)k`, `py = H/2 + (u-v)k/2 - z*k*Z`); `toWorld` = `isoUnproject`; **`toScreen(x, y, z)` is the ONE way anything maps world to screen - never re-derive the projection in a caller.** Camera shape stays `{ppy, cx, cy}`. Flat overlays (slope chevrons) draw inside `isoGroundMatrix`.
- `buildMap` is handed `bareHole(built)` (no trees/belts/wires; `_trees: []`) and `bareMapFor` caches it; thumbnails/Compare/terrain pictures keep the full top-down map. Trees stand up (`drawIsoTree`); shadows are 30% of the game's offset (`SHADOW_SHARE`; the game is unchanged); belt trees are no longer transparent; colours lifted toward soft leaf green (hue order unchanged). Slope Paint reads the drag on the GROUND (`isoScreenDelta`). Hit tolerance `_tolPx()/ppy` yards.
- Motion (paint only, nothing touches the document): pop-in (`FX_POP_MS` 420), dust (`FX_DUST_MS` 560), ghost preview of what the armed tool would place (built by running the real `_place` on a spec copy). One loop (`_kick`) runs only while animating. Reduced motion keeps the ghost, drops pop-in and dust. Finger: long press shows the ghost, lift places; a tap still places instantly, a quick drag still pans.

## On a phone (stages 1-5 + pastel redesign, 2026-09-23/24)

- Matt chose REFLOW (one editor, a layout under `PHONE_MQ` 900 px) on the condition **the desktop editor does not change** (proved by 8 pixel-identical desktop screens). Every phone-only element is `display:none` above the breakpoint; behaviour changes are gated on `isPhone()`. Inputs are 16 px on the phone. Viewport meta is `width=device-width`.
- Pastel phone: top bar `#he-ptop` (Home `#he-p-hub`, hole select, Undo/Redo/Play), bottom bar `#he-pbar` (Move, Trees, Sand, Water, Green, Fairway, More; `TABS` in `tray.js`), trays of drawn iso tiles from `palette.js` (`pickItem()` in `main.js` is the ONE pick handler for desktop and phone), More menu, one Settings card at a time (`.he-right[data-show]`). The phone block redefines the `--gh-*`/`--he-*` tokens. Tour phone steps use `m: {at, say, start, done, side}`, `viaTools`/`viaTray`; pop-ups sit ABOVE or BELOW a target (never beside), across the top only if neither fits, clamped between `safeTop()`/`safeBottom()`.
- Touch layer (`canvas.js`): nothing happens on touch-DOWN; tap = click; drag = mouse drag only if `wouldGrab`, else one-finger pan; two fingers = pinch + pan (cancels the first finger); long press 500 ms = double-click; hit size 22 px finger / 12 px mouse; `#he-canvas` has `touch-action: none`; Edit sheet has no scrim and no mid-drag auto-open. Edit-sheet Duplicate/Delete (`deleteSelection()`, `canDeleteSelection()`), drawing bar (Undo point / Cancel / Finish).
- **iPhone safe areas**: top bar, readout, overlays and tour placement add `env(safe-area-inset-top)`; phone `.he-root` is `position: fixed; inset: 0` (100vh is one status bar SHORT in an installed app). Check without a phone: CDP `Emulation.setSafeAreaInsetsOverride` (top 59, bottom 34). Under 380 px the top bar tightens (measured).
- Tour walked for real on an emulated iPhone doing each step (Skip hides bugs).

## Open items

- A true L-shaped green or a deliberate ring of sand cannot be drawn by the editor (two-outline feature, not a drawing trick).
- Matt's browser copy of Red Mesa held the pre-repair shapes of holes 6/7/9 after the first fold-back (editor loads from `localStorage`, not the file): reset or re-import.
- Mountain/Swamp done; further looks only if Matt asks. Agreed next list (look-only objects: fountain, lighthouse, windmill, ducks/deer, waterfall; walls/buildings/cliffs; hills) - Matt said "only flower beds" from the look-only list and "no bridges".
