# Handoff: fairway slopes for golf (2026-09-16)

Matt, reviewing the hole-editor handoff: *"we should add fairway slopes to the engine."* Today the
ball only breaks on the green. This is the engine job that changes that. It is an ENGINE handoff:
the hole editor (`HANDOFF-GOLF-HOLE-EDITOR.md`) gets a fairway-slope tool only once this exists.

**Read first:** `golf/CLAUDE.md`, "The hole-data format" (the green's slope grid is the model to
copy), "The break is no longer decoration (2026-09-07)" and "The Red Mesa playtest, 2. THE CROWN
GREENS DID NOTHING" (how the run-out came to read slope at all, and the physics argument it was
written on).

---

## What exists, exactly

- **`hole.green.slope`** is `{cols, rows, cells}`; each cell is `[dx, dy]` in -1..+1 pointing
  DOWNHILL; the grid covers the green polygon's bounding box, row-major, cells[0] front-left.
- **`slopeAt(hole, x, y)`** (`golf/js/holes.js`) returns the green cell under a point and `[0, 0]`
  anywhere outside the green's box. That one function is the ONLY place ground slope is read.
- **Three readers**, all in `golf/js/shot.js`: `simulatePutt` (a putt's break), `rollWatchingCup`
  (the run-out after ANY shot lands, which reads slope only inside `greenBox`), and `avgPuttDrag`.
  Both simulators use `BREAK_K` (0.90) for the along-slope speed change and the across-slope turn,
  so a run-out trickling onto a green bends exactly as a putt of that length would.
- **One drawer**: `drawSlope` in `golf/js/render.js`, chevrons per cell pointing downhill,
  clipped to the green polygon, skipped below `SLOPE_MIN_PX` on screen and below `SLOPE_FLAT`.
- **The recipe**: `makeHole` takes `slope` (a `SLOPE_PRESETS` name, a `{fall, spine, back}`, or a
  raw grid) plus `slopeK` strength, and writes `green.slope`.
- **The validator** checks `cells.length === cols * rows` and every component in -1..+1.
- **Sim harness**: `golf/js/test.js` section 15c plays every hole; sections on putting and the
  run-out pin the calibrated roll distances (driver 38.7 yd nominal and actual, on flat ground).

---

## What to build

1. **Format.** A second grid, `hole.slope`, optional, same cell shape as the green's, covering
   `hole.bounds` (not the green box). Coarse: about 10 yd cells, so an 18-hole course adds a few
   hundred pairs per hole, not thousands. Absent means flat everywhere off the green, which is
   exactly today, so every existing hole and every existing test is unchanged by construction.
2. **`slopeAt`** returns the green cell inside the green box (as now), else the fairway cell if
   `hole.slope` exists, else `[0, 0]`. One function, still the only reader.
3. **`rollWatchingCup`** drops its "only inside the green box" gate and asks `slopeAt` everywhere.
   Keep the cost bounded: the walk already has a step cap (`steps + 1200`); a long downhill run-out
   must hit it gracefully, not run for ever. Measure ms per shot before and after (it was 3.6 to
   5.7 ms when the green read was added; state the new number).
4. **The landing bounce** (`groundPoint` / the hop) stays as it is. Slope acts on the roll only.
   State that in the file; it is a decision.
5. **Drawing.** Chevrons on the fairway the way they are on the green, drawn only over
   `fairway` / `lightRough` / `fringe` surfaces (clip to those polygons, not the hole), same
   `SLOPE_FLAT` and `SLOPE_MIN_PX` rules so a zoomed-out hole is not a carpet of arrows. Same
   colour rule: a darker tint of the surface under it.
6. **Recipe input** in `makeHole`: `fairwaySlope` as either a preset name (`downhill`, `uphill`,
   `leftFall`, `rightFall`, `crossfall` that flips at the dogleg) with a strength, or a list of
   `{yd, w, fall}` sections along the hole, or a raw grid. Presets are written in the HOLE's
   frame (along / across the centreline) and turned into world vectors per cell from the
   station tangents, the way `guard` tokens are placed in the green's frame.
7. **Validator**: same two checks as the green grid, on `hole.slope`.
8. **Tests**, in `golf/js/test.js`:
   - flat default reproduces today's roll distances to the yard (the calibration is the contract);
   - a driver run-out on a `leftFall` fairway finishes left of the same shot on a flat one, and
     on `downhill` finishes longer, on `uphill` shorter, with the numbers printed;
   - the drawer is clipped to the surfaces named above (structural check on `render.js`);
   - section 15c re-run on both courses with NO fairway slopes authored: every number identical.
9. **Author nothing on the courses in this job.** The engine ships flat; Matt puts slopes on
   holes in the editor. Do not sprinkle slopes across Red Mesa to "show it off".

---

## Not in this job

- Uneven-lie effects on the SWING (ball above or below the feet). That is a lie-table change, a
  different feature.
- Any UI beyond the chevrons. The editor's tool is in the editor handoff.
- Fairway slope on the tutorial course or Pine Valley.

---

## Rules that bite here

- **What is painted is what the ball does.** The chevrons come from `cells`, never hand-drawn
  (the green's rule, same reason).
- **`BREAK_K` is one constant for putt and run-out.** Do not introduce a second one for the
  fairway; if the fairway needs to feel different, that is the grid's magnitude, authored per hole.
- **Measure, do not argue.** `test.js` 15c before and after is the evidence a slope change is
  neutral when none is authored.
