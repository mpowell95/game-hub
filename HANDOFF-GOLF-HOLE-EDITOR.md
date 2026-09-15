# Handoff: a hole editor for Red Mesa and Oasis Sands (2026-09-15)

This is a HANDOFF, not an instruction set. It describes what Matt wants an editor to be able to
do and the context a building session needs to not rediscover it. It does not prescribe how to
build it, except where Matt made an explicit call (noted as such below). Where this doc is silent
on an implementation choice, that choice belongs to the session that builds it.

**Read first:** `golf/CLAUDE.md` in full, especially "The hole-data format," "Holes are DESIGNED,
not typed: `golf/js/holegen.js`," and "Two courses, thirty-six holes." This editor is a UI on top
of the vocabulary that already exists there (surfaces, `guard` tokens, `SLOPE_PRESETS`, `cross`
hazards, `treeBelts`, the design-spec layer `holegen.js` expands into hole objects) - it is not a
reason to invent a second one.

---

## Restriction lifted: the clone instruction was a starting point, not a lock

Earlier work on this repo (`golf/CLAUDE.md`, "Oasis Sands is NOT built, and why," and the reference-
clone instructions around Pine Valley holes 1-3) has been read by past sessions as "the courses must
match the reference exactly, forever." That is not what Matt means and it should stop being treated
that way for Red Mesa and Oasis Sands.

Matt, verbatim, on this: *"You've let the fact that I asked you to clone a course restrict yourself
in the past. So I want you to leave the courses as is but remove that restriction. I asked you to
clone the courses as exact copies as a starting point. That should not prevent you from making any
changes I request (like changing the order of the holes). This is my game. Nothing is locked to
me."*

**What this means concretely:** the original "clone the reference" instruction governed how those
courses got their first draft. It does not forbid reordering holes, changing a hole's length or par,
redesigning a hole's hazards, or anything else Matt asks for later. Nothing about Red Mesa or Oasis
Sands is frozen by virtue of having started as a clone or a from-scratch design. **This applies to
Red Mesa and Oasis Sands only** - Pine Valley is out of scope for this editor (see Scope, below).

This does not touch THE LAW or anything about player data - it is purely about course *design*
being editable. Confirmed with Matt: neither Red Mesa nor Oasis Sands has ever been live, so there
is no stored player history (`bestRoundByCourse`, `bestHole`, leaderboard rows) to worry about for
either course. That is a separate question from the course DATA being editable, and it does not
apply here regardless.

---

## Scope

- **In scope: Red Mesa and Oasis Sands.** Every hole of both.
- **Out of scope: Pine Valley.** Do not build editing support for it as part of this work.
- **Out of scope: anything about when these courses go live**, admin config, or the leaderboard.
  This is purely a course-design tool for Matt's own use before either course is released.

---

## Who uses this, and where it lives

This is Matt's own tool, not a player-facing screen. It should be gated the way this repo gates
every other Matt-only surface (the admin control page, dev-only tools) - not reachable by anyone
else. It should be built for **desktop use with a mouse**, the way Paint 3D is. None of this repo's
phone-fit rules (`docs/BUILDING-A-GAME.md` Part 0, "no game may scroll," fit-at-390x664) apply to
this tool - it is not a game screen and should not be built as if it needs to fit a phone.

---

## Core working model: originals are read-only, edits are a separate working copy

Matt: *"I want the original, as is, courses to be written into the tool and be unable to be saved
over. This way I can always reset it... anything I save should be saved into red mesa edit or oasis
sands edit or something."*

- The as-shipped Red Mesa and Oasis Sands data is loaded into the tool and **can never be
  overwritten**. It is always available to reset to or compare against.
- Anything Matt changes saves into a separate working copy per course (naming is the builder's
  call - "Red Mesa (edit)" / "Oasis Sands (edit)" is the working name used in this doc).
- **Nothing autosaves or runs a check on save.** Save just saves. Validation is a separate, explicit
  button Matt presses when he wants it - see "Verification tools" below. It should never block or
  delay a save.

### Getting an edited course back into the real game

Matt raised a real concern here, from experience with a similar tool for pinball machines: having
an editor export a design and then having a session hand-reinterpret or retype it into the real
course file is exactly the kind of step where this repo's own history shows things go wrong (see
`golf/CLAUDE.md`'s many entries about `route`, `cardYards`, and `bounds` silently drifting from the
geometry they're supposed to describe).

**Recommended approach, for the building session to evaluate rather than treat as mandatory:** the
editor should export in the **same object shape** the real course files (`golf/courses/redmesa.js`,
`golf/courses/oasissands.js`) already use, so folding an edited course back in is a mechanical
replacement of that course's data, not a rewrite or reinterpretation. Whatever session does that
fold-back should run `validateHole()` against the result as a check, not treat the export as
trusted just because it came from the editor.

---

## Feature list

### Navigation
- Switch between Red Mesa and Oasis Sands.
- Select any hole of the selected course to edit.
- A side-by-side strip showing every hole of the current course at once (thumbnail view), so a
  change to one hole can be checked against the rest of the set at a glance - this repo's own
  history has repeatedly found bugs (repeated green shapes, identical cross-hazard placement,
  uniform tree walls) that were only visible with a whole course laid out together, never one hole
  at a time.
- A visible indicator of which holes in the current course have been edited vs. left at their
  original state.

### Hole-level structural editing
- Lengthen / shorten a hole.
- Widen / narrow a hole's corridor (as a whole, or in sections along its length).
- Add doglegs and other curves to a hole's routing, with a left/right (or general directional)
  choice, not just a single generic bend.
- Add a brand-new, blank hole, inserted at a chosen position in the course.
- Reorder holes within a course.

**Recommended approach, for the building session to evaluate rather than treat as mandatory:**
implement these as edits to the same **parametric design-spec inputs `golf/js/holegen.js` already
takes** (a centerline of waypoints, a width profile along it, hazards placed "at this fraction of
the route") and always regenerate the hole through the existing `holegen.js` pipeline, rather than
letting the editor manipulate raw fairway/rough polygons directly. Lengthening a hole becomes
adding/moving a centerline waypoint or rescaling the route; widening becomes raising the width
profile at a point or over a range; a dogleg becomes bending the centerline. `holegen.js` already
recomputes `route`, `bounds`, `cardYards`, and tree-belt insets from these inputs correctly - this
is the class of bug (`golf/CLAUDE.md` has many entries: stale `route`, hazards drawn outside the
hole, self-intersecting corridor polygons on tight bends) that reusing the existing pipeline avoids,
where hand-editing raw geometry would reintroduce it. This constrains editing to the vocabulary
`holegen.js` already understands rather than arbitrary freehand fairway-edge dragging - accepted as
a deliberate trade for correctness and much lower implementation cost.

### Surface and obstacle editing
- A paint-can / flood-fill tool: click a region, fill it to a chosen surface type (fairway, rough,
  sand, water, green, etc.), the same interaction model as a bucket-fill tool in a painting app.
- A brush with adjustable size/radius for painting a patch of a surface, not just filling one
  bounded region at a time.
- Add and remove: water, trees, bunkers, fairway, greens, and other obstacles.
- Two distinct ways to place trees, matching how the underlying data already models them
  (`golf/CLAUDE.md`, "Trees are TWO separate things"): painting a wooded area/belt (procedural,
  many trees), and placing a single individual specimen tree by hand (e.g. a signature fairway
  tree like Pine Valley 3's oak).
- An eyedropper tool: click an existing surface on the hole to pick it up as the active paint,
  mirroring a standard paint app's eyedropper.
- A Select mode, distinct from Paint mode: click an existing placed object (a bunker, an individual
  tree, the green) to select it and edit its properties (size, type, position) rather than only
  being able to paint new surface over it.

### Presets
- One-click preset moves for common design patterns this repo's own hole-design vocabulary already
  has names for (see `golf/js/holegen.js`'s `guard` tokens, `SLOPE_PRESETS`, `cross` hazards,
  `sentinels`), rather than only free-form editing. Confirmed with Matt: presets should offer a
  direction/side choice (e.g. dogleg left vs. dogleg right) rather than one generic version of each
  preset.

### Verification tools (on-demand button, not automatic on save)
- **Validate Hole button** - runs the existing hole-shape validation (`golf/js/holes.js`'s
  `validateHole()` covers the class of checks: pin inside green, polygons well-formed, slope grid
  shaped correctly, hole reachable). Should report *where* a problem is, not just pass/fail.

**Explicitly not part of this editor, by decision:**
- **Difficulty feedback** (strokes-vs-par measurement, in the spirit of `golf/js/test.js` section
  15c) is not a button in the tool. When Matt wants a difficulty read on a hole, he asks a session
  to run it directly, the same way this repo already runs that suite manually rather than
  automatically.
- **A playability sweep** (the realistic-timing playtest harness described in `golf/CLAUDE.md`'s
  2026-09-07/09 playtest sections) is not built as part of this editor at all, on demand or
  otherwise.

### Compare and reset
- A Compare button: view the original (unedited) version of the current hole and the edited version
  side by side. A visual comparison is sufficient - no true data diff is required.
- A Reset This Hole button: discard edits on the hole currently open and restore it to the baked-in
  original, without touching any other hole in the course.

### Measurement and feedback while editing
- Numeric readouts alongside the visual editing - current hole length, current width at whatever
  point is being edited, current par - rather than only eyeballing a shape with no numbers. This
  repo's own history is full of cases where something "looked fine" and measured badly.
- A tee-to-pin (or point-to-point) ruler/measure tool: click two points on the canvas, see the
  yardage between them, without leaving the canvas.
- Layer-style visibility toggles - show/hide trees, show/hide slope arrows, show/hide the green's
  collar, etc. - so a busy hole doesn't become unreadable while working on one aspect of it.
- Canvas zoom and pan, the way Paint 3D has (its bottom-left zoom slider is the reference point) -
  a whole hole runs hundreds of yards, and placing an individual tree precisely needs to zoom in.
- Undo/redo (or a version history) while editing a hole.

---

## Interface style: Paint 3D as the reference, with one deliberate departure

Matt uploaded reference screenshots to `reference/paint3d/` in this repo and asked that the
interface follow that style closely: a big canvas as the main focus, a slim icon-first top ribbon
of tools (not dense text menus), and a simple, uncluttered context panel for whatever tool is
active. **Look at those screenshots before building the UI** - they are the actual reference, this
description is not a substitute for them.

**The one deliberate departure from Paint 3D:** Paint 3D only ever shows one tool-options panel at a
time, because it only ever has one active tool. This editor needs more than one thing visible at
once (surface palette, hole stats, layer toggles, the ruler readout could all be wanted
simultaneously), so it needs multiple panels open at the same time, which Paint 3D's own model
doesn't support directly.

**Recommended approach, for the building session to evaluate:** fixed docking bays (left, right,
bottom - the same pattern used by Photoshop, VS Code, and most creative/dev tools) rather than a
true free-floating window manager. Each panel toggles on/off from the top ribbon and can be
reordered within its bay, but always snaps into one of a small number of fixed slots rather than
being positioned anywhere on screen. This gets Matt's actual requirement - multiple panels visible
at once - without building the much larger amount of engineering a true floating/snap-to-any-edge
window system requires (drag positioning, overlap/z-order handling, position persistence). True
free-floating panels are a reasonable nice-to-have if the builder wants to go further, but should
not be treated as required to meet the brief.

Use this repo's existing course color palettes (`golf/js/render.js`'s `THEMES`) for painted
surfaces, so a hole painted in the editor looks like what it will actually look like in the game,
not a placeholder palette.

---

## What this doc deliberately does not decide

- **Exact persistence mechanism** (in-app tool that writes to disk/repo vs. a standalone tool vs.
  something else) - left to the building session, per Matt.
- **Exact naming/location of the working-copy data** ("Red Mesa (edit)" is a placeholder name, not
  a requirement).
- **Exact docking/panel implementation details** - the fixed-bay approach above is a
  recommendation, not a mandate.
- **The exact fold-back mechanism** from an edited working copy into the real `golf/courses/*.js`
  files - the same-object-shape approach above is a recommendation to reduce the risk Matt flagged,
  not a mandate.

Where this doc recommends something, it says so explicitly. Everything else in the Feature List is
what Matt actually asked for and should be treated as the brief.
