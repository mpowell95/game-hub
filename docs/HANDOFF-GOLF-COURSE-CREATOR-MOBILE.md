# Handoff: the Course Creator on a phone (written 2026-09-23)

Matt: *"how much work would it be to make this mobile friendly? so the tool could actually be used
and holes built in a cell phone? If it's a lot, we should create a handoff doc for a new session to
start from scratch to do it."* It is a lot. This is that doc. Read it, then `hole-editor/CLAUDE.md`
(the whole editor's history; the last ten sections are the Course Creator), then the root
`CLAUDE.md` rules (live-means-deployed, subagents-save-usage).

## 1. What exists (all live, v919)

- The editor: `hole-editor/` (~5,700 lines: `js/main.js`, `canvas.js`, `panels.js`, `palette.js`,
  `model.js`, `course.js`, `starter.js`, `drafts.js`, `export.js`, `tour.js`, `editor.css`).
- Links: the King's `hole-editor/?course=new`; Matt's Red Mesa `hole-editor/`; the Help practice
  run `hole-editor/?course=tutorial` (`&topic=<id>` jumps in; `&first=1` is the first-visit run).
- Built for a desktop mouse and keyboard, on purpose. Nothing about it works on a phone today.

## 2. Why it does not work on a phone (measured facts, not guesses)

| Area | Today | Why it breaks on a phone |
|---|---|---|
| Page width | `<meta name="viewport" content="width=1280">` | A phone renders a shrunk 1280 px desktop: unreadable, untappable |
| Layout | Three fixed columns: palette `--he-left-w: 316px`, map, inspector `--he-right-w: 400px`; ribbon 64 px; holes bar ~196 px | ~716 px of side panels on a 390 px screen |
| Zoom | mouse `wheel` (`canvas.js`) | No wheel; needs pinch |
| Pan | Select + drag on empty ground, middle-drag, Space+drag | One-finger drag must be split between "move this object" and "move the view" |
| Adding points | `dblclick` adds a route dot / width dot (`canvas.js`); drawing closes on double-click or Enter | Double-tap zooms the page on phones; no Enter key |
| Keyboard-only actions | `keydown` in `main.js` and `canvas.js`: Delete, Backspace (last corner), Enter (finish shape/line), Esc (cancel), D (duplicate), Ctrl+Z/Y, tool letters, `[` `]` holes, F fit, +/- zoom | None of these exist on a phone. Undo/Redo/Duplicate have ribbon buttons; **Delete and Finish do not** |
| Hover | "From tee / Width at cursor" readout follows the mouse | No hover on touch |
| Hit sizes | Handles and white squares sized for a mouse (a few px) | A finger needs ~44 px targets (`docs/BUILDING-A-GAME.md` Part 0) |
| Modals | Setup screen 760 px wide, 3-column terrain grid; Compare two canvases side by side; drafts list a wide table | Overflow at 390 px |
| Walkthrough | `tour.js` pop-ups 300-380 px, placed left/right of targets | No room beside anything on a phone; targets move when panels become sheets |
| Performance | Each drag frame rebuilds the hole map (`buildMap`, ~45 ms in software rendering) | A phone CPU is slower; must be measured on a real-phone-sized profile |

Pointer events (not mouse events) are already used for canvas input (`pointerdown/move/up`), which
helps: touch arrives through the same handlers. But the canvas has no `touch-action: none`, so the
browser will scroll/zoom the page under a finger.

## 3. The decision to make FIRST (ask Matt, one question)

**A. One editor that reflows** (same files; a phone layout under a width breakpoint), or
**B. A separate phone mode** (`?course=new` detects a phone and shows a simpler "phone editor":
fewer tools, bigger buttons, same document and cloud save).

Recommendation: **A, reflow**, because the document, cloud drafts, tour and every mutator are
shared and already tested; B doubles the UI to maintain. But B is honest about one thing A hides:
some tools (Slope Paint's 8x8 grid, the Width handles, drawing a green outline corner by corner)
are fiddly with a finger at any size. Whatever is chosen, say which tools are "tablet/desktop
recommended" rather than pretending they are comfortable on a phone.

## 4. The work, in stages (each ends live, per the root CLAUDE.md)

Stage estimates are rough (I believe, not measured): each is roughly one focused session.

1. **Layout (Sonnet, CSS + main.js markup).** Real viewport meta (`width=device-width`); under
   ~900 px: ribbon becomes a compact top bar (course button, Undo, Redo, a "Tools" menu, Help,
   Report bug); the palette becomes a bottom sheet opened by an **Add** button; the inspector
   becomes a bottom sheet that opens when something is selected; the holes bar becomes a
   hole-number picker; Layers/Key stay chips. The map gets the whole screen between them. Desktop
   layout must be pixel-identical above the breakpoint (the UI suite is the check).
2. **Touch input (Opus, canvas.js).** `touch-action: none` on the canvas; pinch to zoom and
   two-finger drag to pan (track two active pointers); one finger on an object drags it, one finger
   on empty ground pans; **long-press** replaces double-click (add a route dot / width dot); hit
   tolerance in SCREEN pixels (≥ 22 px radius) for handles and objects when `pointerType === 'touch'`;
   the "from tee / width" readout follows the last touch instead of hover.
3. **On-screen replacements for every keyboard action (Sonnet).** In the selection sheet: Delete,
   Duplicate. While drawing: a floating bar with **Finish**, **Undo point**, **Cancel**. Hole
   prev/next arrows. Fit button already exists.
4. **Modals and the walkthrough (Sonnet).** Setup screen, drafts list, Compare, bug form (the hub's
   form is already phone-sized) at 390 px. `tour.js`: on narrow screens place the pop-up at the
   top or bottom edge with the arrow pointing up/down, and re-target steps at the sheets (e.g. "Tap
   Add" before "Tap the Fairway bunker"). Tour step wording: "tap" not "click" on touch.
5. **Measure on a phone profile (Opus or Sonnet).** Playwright with a 390x844 iPhone-ish viewport,
   `hasTouch: true`, CPU throttling 4x; the same CDP profile pattern as "It's laggy" in
   `hole-editor/CLAUDE.md`. If a drag frame is over ~50 ms, the fix is a cheaper live preview
   during a gesture (e.g. redraw only the moved object's outline and rebuild the map on release),
   not a smaller map.

## 5. How to test it

- `test-hole-editor-ui.mjs` must stay green at desktop size (it is the no-regression proof).
- A new `test-hole-editor-mobile.mjs`: 390x844, `hasTouch`, drive with `page.touchscreen.tap` and
  CDP touch events for pinch/drag. Cover: open the setup screen, name + terrain, open Add, place a
  bunker, drag it, delete it from the sheet, draw a lake with Finish, bend the route with a
  long-press dot, switch holes, Play, the walkthrough start to finish, Report bug opens.
- `check-no-scroll.mjs`-style check: the page itself never scrolls sideways at 390 px.
- Stills at 390x844 of every stage, looked at, sent to Matt with the image + HTML rule in the root
  `CLAUDE.md` ("Send the Claude.ai handoff files").
- Real device: ask Matt to open the live link on his own phone after stage 2; a headless touch
  emulation is not a finger.

## 6. Rules that apply

- The `hole-editor/` folder is outside the service worker: no CACHE bump for editor-only changes.
  A change to `js/` (shared hub code) does need one.
- Every edit Matt asks for is not done until it is merged, the Pages run is `success`, and he is
  told it is live.
- Subagents only for big stages, cheapest model that can do it, one agent per stage, worktree,
  never push, never touch `sw.js`/`version.json`.
- Nothing here may risk the King's saved course: the document format, storage keys
  (`golf.holeEditor.custom.v1`) and cloud path (`courseDrafts/<CODE>/custom`) do not change.
