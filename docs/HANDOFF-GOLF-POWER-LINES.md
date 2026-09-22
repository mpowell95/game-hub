# Golf: power lines (2026-09-22)

Out of the objects batch on purpose (`docs/HANDOFF-GOLF-OBJECTS.md`): the poles are ordinary
obstacles, but the WIRE stops a ball only inside a band of heights, and nothing in `shot.js` can
say that today (a canopy blocks from the ground up to `height`).

Two agents, in worktrees, own ports (`PORT=8124` Opus, `PORT=8125` Sonnet). Neither touches `sw.js`,
`version.json` or `golf/courses/*`; neither pushes.

## 1. The data (Opus)

**Pole**: append ONE entry to `OBSTACLE_CATALOG` (append-only rule; it becomes index 17):

```js
{ name: 'pole', shape: 'pole', trunk: 0.3, canopy: 0.3, height: 40, looks: ['parkland', 'desert'] },
```

Plus `obst_pole: 'Power pole'` / `'Poste de luz'` in `golf/js/strings.js`.

**Recipe**: a new optional hole field, `lines`:

```js
lines: [{ pts: [[x, y], [x, y], ...], h: 10 }]   // yards; 2+ points; h = wire height, default 10
```

`makeHole` builds, per entry:
- a pole TREE at every point (type = the index of the entry named `'pole'` in the hole's own
  `treeTypes`), so poles block exactly like any trunk and draw like any tree;
- `hole.lines = [{ pts, lo: h - 1.0, hi: h + 0.6 }]`, the band the wire occupies.

A hole with `lines` whose `treeTypes` has no `'pole'` entry: `validateHole` names it and refuses.
(Only Course Creator courses carry the catalogue; Pine Valley / Red Mesa / Oasis Sands never get
`lines`.) `validateHole` also refuses: fewer than 2 points, any point off the map, `h` outside 4..20.

## 2. The rule (Opus, `golf/js/shot.js`)

`wireHit(hole, from, dirRad, distanceYd, sideYd, apex)`, same signature and sampling as `treeHit`
(`flightPoint`, the same STEP). Between each pair of consecutive samples, test the 2-D segment
against every wire span; where they cross, interpolate the ball's height there. **Blocked iff
`lo <= height <= hi`.** Returns `{ wire: lineIndex, at: [x, y], p }` or null.

- Over the wire (a high shot) and under it (a low runner, any putt, a chip still climbing) are
  both clear. That is the whole point of a band.
- At the call site (`shot.js` line ~468) take whichever of `treeHit` / `wireHit` comes first
  (smaller `p`). A wire block resolves exactly like a canopy block: the ball falls where it met the
  wire. **No penalty stroke** (real golf's local rule is a replay; a drop-at-the-wire is the
  simpler version and matches the trees Matt already knows).
- The ball's own position cannot block leaving it (the same principle as `treeHit`'s `ignore`):
  skip samples with `p < startAt`, as `treeHit` does.
- The HUD's blocked message: reuse the tree message path; add `blocked_wire: 'Hit the power line'`
  / `'Golpeó el cable'` if `ui.js` keys it by kind (check; otherwise leave the generic one).

## 3. The editor model (Opus)

`hole-editor/js/model.js`: `addLine(spec, pts, h = 10)`, `setLineField(spec, i, field, value)`
(`h`, or `pts`), `moveLinePoint(spec, i, k, x, y)`, `deleteLine(spec, i)`. Copy JSON and
`export.js` print `lines`. `hole-editor/js/main.js`: a tool `'line'` that uses the existing drawing
flow (click points, Enter or double-click finishes, Esc cancels) and calls `addLine`. That wiring
line is Opus's.

## 4. The drawing (Sonnet)

- `golf/js/render.js`: `treeShapes`/`treeAccent` case `'pole'`: a small grey disc with a short dark
  crossarm stroke across it (reads as a pole from above). The WIRE: after the trees, two thin
  parallel dark strokes (about 0.25 yd apart) along each span, plus its shadow offset by
  `SHADOW_LEN`/`SHADOW_DROP` times `h`, like a tree's.
- `hole-editor/js/canvas.js`: draw lines the same way; hit-test a span (within 1.5 yd) for
  selection, drag a point handle to move it, Delete removes the line.
- `hole-editor/js/panels.js`: a selected line shows its height (number, 4..20) and point count.
- `hole-editor/js/palette.js`: a "Power line" tile (a drawn tile with the pencil, sampler shows a
  three-pole line) and a single "Power pole" tile comes for free from the catalogue.

## 5. Tests

- Opus: `golf/js/test.js` - a shot crossing the wire inside the band is blocked where it crosses;
  the same line with a high apex is clear; a putt under it is clear; a pole trunk blocks; each
  validator refusal. `test-hole-editor.mjs` - the four mutators, export prints `lines`, the built
  hole validates. `golf/CLAUDE.md`, "The hole-data format": `lines`.
- Sonnet: `test-hole-editor-ui.mjs` - the Power line tile + three clicks + Enter makes a line with
  3 points and 3 poles; selecting it and pressing Delete removes it. `hole-editor/CLAUDE.md`.

## 6. File ownership

| Opus | Sonnet |
|---|---|
| `golf/js/obstacles.js`, `shot.js`, `holegen.js`, `holes.js`, `strings.js`, `ui.js` (message only) | `golf/js/render.js` |
| `hole-editor/js/model.js`, `export.js`, `main.js` (tool wiring) | `hole-editor/js/canvas.js`, `panels.js`, `palette.js`, `editor.css` |
| `golf/js/test.js`, `test-hole-editor.mjs`, `golf/CLAUDE.md` | `test-hole-editor-ui.mjs`, `hole-editor/CLAUDE.md`, a still under `reference/golf/` |

The contract neither changes alone: the catalogue entry above, `hole.lines[i] = { pts, lo, hi }`,
the recipe field `lines: [{ pts, h }]`, the tool name `'line'`, the mutator names in section 3.
