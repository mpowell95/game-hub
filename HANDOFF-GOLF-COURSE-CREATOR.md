# Handoff: the Course Creator for the King of Games

Written 2026-09-22 at Matt's pause. This is the whole picture for whoever picks it up: what
exists, what is half-built, what is still to do, in what order, and how to work it. Read it
before `hole-editor/CLAUDE.md` (the running notes) and `HANDOFF-GOLF-HOLE-EDITOR.md` (the
original tool's spec). Repo rules apply: `CLAUDE.md` at the root, especially THE LAW, "asking
for a change means LIVE", and "Delegate to lesser-model subagents".

## 1. What this is

Matt: *"a tool I can send to the king of games and have him create a course... I don't wanna
send him the Red Mesa or Oasis Sands courses."* And: *"I want the king of games to be able to
make a brand new course. not one that's just like the existing one."*

The King of Games is a player in the hub (profile name "aa King of Games"). He gets a link to the
golf hole editor opened on a blank course, designs a course from pictures of objects, previews it
in the real game, and his work autosaves to Firebase so Matt can open it in his own editor,
review it, and have a session fold it into the game as a real course.

## 2. Links

| What | URL |
|---|---|
| The King's editor (blank course) | https://mpowell95.github.io/game-hub/hole-editor/?course=new |
| Matt's editor (Red Mesa) | https://mpowell95.github.io/game-hub/hole-editor/ |
| Play preview of the blank course | opened by the editor's Play button (`golf/?editor=custom`) |
| This branch | `claude/review-hole-editor-planning-vr8o94` |

Both links are public. Anyone with the King's link can change the URL and see Red Mesa; its
course file is public on the site anyway. Matt was told and did not ask for a gate.

## 3. What is DONE and live (v899, 2026-09-22)

- **The editor itself**: route, width, bunkers, water, trees and stands (size, height, angle),
  tree lines, green (preset or drawn outline, per-side fringe, several pins picked at random per
  round), slope (preset or painted), hazards across the hole, ruler, draw-your-own shapes, resize
  handles, duplicate, validate, compare, reset, undo/redo, export, Copy JSON, Play. All in
  `hole-editor/`; running notes in `hole-editor/CLAUDE.md`.
- **The Course Creator mode** (`?course=new`): 18 plain starter holes (par 72, no hazards), course
  name, Parkland/Desert look, add/delete holes (floor of three), its own storage key, export as a
  complete course module named after the course. `hole-editor/js/course.js`, `starter.js`.
- **Cloud drafts**: every edit autosaves to Firebase `courseDrafts/<PLAYER CODE>/<courseId>`
  under the designer's player code (the hub profile's, or one typed once); "Open a draft..."
  lists everyone's; Import file / Download backup. Rules are PUBLISHED and were verified against
  the live database (read, own-code write, cross-code denied). `hole-editor/js/drafts.js`.
- **The layout rebuild**: picture palette on the left (every object drawn by the game's own
  renderer), one inspector on the right (Selection, Hole with tree lines, Course & saving
  collapsed), actions-only ribbon, layer chips and a colour key over the map, levels in the dark
  chrome. `hole-editor/js/palette.js`, `editor.css`.
- **Engine additions the editor needed** (all in the game too): placement past the pin, runs-away
  green presets, drawn greens/fringe/pins, per-hole wind, tree size/height, the power putter,
  any-direction aim, drop prompt for any tree, blocked shots animated honestly, see-through
  crowns while putting, a followed long putt.
- **Tests**: `test-hole-editor.mjs` (headless, 48 on this branch), `test-hole-editor-ui.mjs`
  (browser, 66 on main), `test-hole-editor-play.mjs`.

## 4. DONE on resume (2026-09-22): the "more objects" batch

Finished and shipped; what the merge changed is in `hole-editor/CLAUDE.md`, "The more objects
batch". The original notes follow for the record.

### (as written at the pause)

Spec: `docs/HANDOFF-GOLF-OBJECTS.md`. Two agents built it in parallel; one finished, one was
stopped mid-verification when Matt paused.

- **Engine half (Opus): DONE, merged on this branch** (`92862d3`). `golf/js/obstacles.js` (the
  17-entry catalogue: pine, oak, sentinel, maple, birch, willow, cypress, dead tree, bush, palm,
  saguaro, palo verde, joshua tree, boulder, small rock, rock pile, log), swamp as a real ground
  type (ball stops dead, half power out, no penalty), sprite decor in the model/validator/export,
  migration of existing custom drafts to catalogue indices, `main.js` wiring for a `decor` tool
  and `waterKind`/`decorKind`. 48 headless tests green; golf engine suite green apart from the
  five known Red Mesa layout failures (section 7). `sw.js` has `golf/js/obstacles.js` in ASSETS.
- **Art half (Sonnet): STOPPED just before its test runs.** Its work is saved on branch
  `worktree-agent-afbe2793454a75d38` (two WIP commits, last `4195455`; unreviewed, untested by
  the orchestrator). It owns `golf/js/render.js` (the silhouettes for every shape, swamp paint and
  reeds, bench/sign/flagpole sprites), `hole-editor/js/palette.js`, `canvas.js`, `panels.js`,
  `editor.css`, `test-hole-editor-ui.mjs`, `hole-editor/CLAUDE.md`, and a still under
  `reference/golf/`. Its last message before the stop: placement, dragging and deletion of the
  new objects all worked in its browser probes; it was about to clean up and run the suites.

**To finish this batch** (the orchestrator does this itself, per the repo's delegation rule):

1. `git merge worktree-agent-afbe2793454a75d38` into this branch. Expect no conflicts: the two
   halves own disjoint files and `main.js` was edited only by the engine half.
2. In `hole-editor/js/palette.js`, delete the TEMP copy of the catalogue (marked `// TEMP until
   obstacles.js lands`) and import from `golf/js/obstacles.js`; replace the `NICE` label map
   with `t('obst_' + name)` (the strings exist in EN and ES).
3. Open the still (`reference/golf/obstacles-2026-09-22.png` if it was written; else render one
   through `paintTile`) and judge every silhouette at tile size. Fix anything that does not read.
4. `node test-hole-editor.mjs`, `node test-hole-editor-ui.mjs` (server up),
   `node test-game-conventions.mjs`, `node validate-sw-assets.mjs`. Bump `CACHE` past whatever
   `main` is on at that moment (it was v899 at the pause), commit `sw.js` + `version.json`.
5. PR, merge, verify the Pages run, tell Matt it is live, hard-refresh reminder.

## 5. What is still TO DO, in Matt's order

1. **Finish the objects batch** (section 4).
2. **Power lines.** DONE 2026-09-22 (v910); `docs/HANDOFF-GOLF-POWER-LINES.md`. Out of the objects batch on purpose: the poles are ordinary obstacles, but
   the WIRE needs a new kind of blocker in `golf/js/shot.js` that stops a ball only within a band
   of heights (today a canopy blocks from the ground up to `height`). Write a short spec first
   (engine: a `band: [lo, hi]` on an obstacle or a new `lines` recipe group; `treeHit` samples
   it; validator; renderer draws the wire between poles). Opus for the engine, Sonnet for the
   drawing and the palette tile.
3. **New looks.** Links and Tropical DONE 2026-09-22 (`hole-editor/CLAUDE.md`, "Two new looks"). Matt: *"it sounds like we need more engines."* A look is a palette for every
   surface in `golf/js/render.js` `THEMES` plus a default obstacle set and belt species in
   `hole-editor/js/starter.js` `THEME_DEFAULTS`. Start with **Links** (coastal: gorse, dunes,
   wind) and **Tropical** (palms, lagoons, sand); then Mountain and Swamp if he wants them. Each
   is about half a day of Sonnet art plus the two-line data entries. The Course Creator's Look
   control (`renderCoursePanel` in `main.js`) is a two-button segment today; make it a list.
4. **The Help page.** DONE 2026-09-22 (`hole-editor/help.html`). Matt asked for instructions for the tool and agreed to a Help button in the
   ribbon opening `/hole-editor/help.html`, deployed with the editor. Plain words for someone who
   has never seen it: start here (code, name, look, export often), one card per tool with a short
   looping recording, shapes, the green, trees (height rule of thumb: a palo verde is 8 yards,
   nothing flies a 40-yard tree), test it (Validate, Play, what the messages mean), saving and
   sending. Sonnet. Do it AFTER the objects batch and the looks so the pictures are current.
5. **The fold-back of the King's course** when he is done: Matt loads the draft in his editor,
   presses Export, sends the file; a session drops it in `golf/courses/<slug>.js`, registers it
   in `golf/js/rounds.js` `COURSES`, adds `course_<id>` / `blurb_<id>` strings and a
   `GOLF_COURSE_PAR` row in `js/leaderboard-rank.js`, adds the file to `sw.js` ASSETS, runs
   `node golf/js/test.js`, bumps CACHE, deploys. The course is admin-only until Matt releases it
   on the Admin page. Same recipe as Red Mesa's first fold-back (`hole-editor/CLAUDE.md`).

## 6. How to work it (the repo's rules, applied here)

- The session that reads this is the ORCHESTRATOR. Write the spec into a doc first (as
  `docs/HANDOFF-GOLF-OBJECTS.md` was), commit it, then launch agents with `model` set explicitly:
  Sonnet for render art, palette, CSS, docs, stills, browser probes; Opus for `shot.js`,
  `holegen.js`, `model.js`, persistence, anything measured. One agent per non-overlapping file
  set; sequence overlapping work. Agents run in worktrees on their own port (`PORT=8124 node
  server.mjs`, `HOLE_EDITOR_URL=http://localhost:8124/hole-editor/` for the browser suite), never
  touch `sw.js`/`version.json`/`golf/courses/*`, never push, commit on their branch.
- The orchestrator merges, deletes any TEMP shims, reviews stills, re-runs the key checks, bumps
  CACHE, runs the suites that cover the changed files (never `run-all-tests.mjs`), opens the PR,
  merges, verifies the Pages run, and only then says "live".
- Playwright in this container: `ln -sfn <scratchpad>/pw/node_modules node_modules` before a
  browser script and `rm -f node_modules` after; Chromium at `/opt/pw-browsers/chromium` with
  `--no-sandbox --headless=new`. Headless Chromium sometimes drops a drag's mouse-up; the UI suite
  guards for it.
- Every editor change to Matt's tool applies to the King's too; they are one codebase with two
  profiles (`hole-editor/js/course.js`).

## 7. Known issues, not bugs to fix in the tool

- The golf engine suite has five failing assertions about Matt's own Red Mesa layout: hole 7
  plays out in 7 with clean strikes (his 47-yard palo verde stands short-right of the green),
  hole 3's back fringe is under 3 yards, four pins sit beyond their route end, and the front nine
  comes out harder than the back. Editor work on Matt's side. Any OTHER golf suite failure is new.
- Matt's browser holds pre-repair shapes for Red Mesa holes 6, 7 and 9 (the first fold-back fixed
  three self-crossing outlines in the file). He should reset those or re-import before exporting
  Red Mesa again.
- The cloud write was verified with a REST probe, not from Matt's own editor. First real proof is
  his panel reading "Saved to cloud".

## 8. Files, in one place

| Area | Files |
|---|---|
| Editor shell | `hole-editor/index.html`, `js/main.js`, `editor.css` |
| Model and persistence | `hole-editor/js/model.js`, `course.js`, `starter.js`, `drafts.js`, `export.js` |
| Screens | `hole-editor/js/canvas.js`, `panels.js`, `palette.js` |
| Engine | `golf/js/holegen.js`, `holes.js`, `shot.js`, `clubs.js`, `render.js`, `obstacles.js`, `strings.js`, `ui.js` (`_enterHole`), `rounds.js`, `golf/index.html` |
| Database | `database.rules.json` (`courseDrafts`), `backups/rtdb-backup.mjs` BRANCHES |
| Tests | `test-hole-editor.mjs`, `test-hole-editor-ui.mjs`, `test-hole-editor-play.mjs`, `golf/js/test.js` |
| Docs | this file, `HANDOFF-GOLF-HOLE-EDITOR.md`, `docs/HANDOFF-GOLF-OBJECTS.md`, `hole-editor/CLAUDE.md`, `golf/CLAUDE.md` |
