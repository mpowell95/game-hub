# HANDOFF: Baseball BB-3c, real 3D rigged characters

Written 2026-09-15 for the build session. Matt chose this over sprite sheets and over a
2D skeletal rig, in these words: *"C definitely."* The sixteen-frame sprite path shipped in
BB-3b (v842) is what this replaces.

Read first, in this order: root `CLAUDE.md` (THE LAW; "asking for a change means LIVE"),
`baseball/CLAUDE.md`, `reference/baseball/SPEC.md`, `HANDOFF-BASEBALL-3B.md` (the sprite pass
this supersedes; its R1/R2/R3 requirements still bind), `docs/BUILDING-A-GAME.md` Part 0.

Matt's standing rules that shaped every line below:

- **Do not add features that are not discussed.** This handoff is the discussion. A bat in the
  batter's hands, a ball from the pitcher's hand, team colours on the jersey. Nothing else: no
  glove, no fielders in 3D, no crowd, no camera moves. The camera stays behind the plate in
  both states; the overhead cut on contact stays 2D and stays as it is.
- No em dashes anywhere. No helper text in the UI. Feedback where the player looks.
- **Every requirement of BB-3b still holds**: R1 (the wind-up is a real 1400 ms delivery before
  release), R2 (verdict to next release = resultMs + betweenMs + windupMs, pinned by
  `test-baseball-device.mjs`'s `r2-cadence` check at 6219-6225 ms), R3 (Early / Late / Perfect /
  Nice / Hung as the 44 px popup). The 3D pass changes how the figures are DRAWN. It must not
  change WHEN anything happens.

---

## 0. Before writing a line: existence checks

Report the result of each in your first message. Do not guess at any of them.

1. `ls reference/baseball/models/` shows Matt's files. Expected: `body.glb`, `swing.glb`,
   `pitch.glb`, optionally `miss.glb`, `set.glb`, `pitcher-body.glb`, and `README.md`. **If the folder is empty, do
   commits 1 and 2 against the scaffolding asset in section 1.4 and stop before commit 3 until
   Matt's file lands.** Never ship a stand-in character.
2. `grep -o '"185"' pinball/js/vendor/three.core.min.js` prints `"185"`: the vendored three.js
   is r185 (`three.core.min.js` 385,386 bytes + `three.module.min.js` 365,552 bytes, identical
   copies in `pinball/js/vendor/` and `skeeball/js/vendor/`). Ball Run's `ball-run/vendor/` is
   r169 single-file. Use the r185 pair.
3. `curl -sS -o /dev/null -w "%{http_code}" https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/loaders/GLTFLoader.js`
   prints 200 (it did from this container on 2026-09-15; 114,959 bytes). `SkeletonUtils.js`
   (11,535) and `BufferGeometryUtils.js` (37,621) under `examples/jsm/utils/` likewise.
4. `grep -rn "GLTFLoader" --include=*.js . | grep -v node_modules` finds nothing outside this
   handoff: no loader is vendored anywhere yet.
5. `baseball/js/ui.js` still has `_startSwingTimeline` (~line 395), `_stepWindup` (~418),
   `SWING_TIMELINE = [[0, 3], [40, 4], [80, 5], [120, 6], [160, 7], [200, 8]]` (~61),
   `_animatePitchFlight` (~855), and `HumanAgent` (~1100-1310). `baseball/js/field.js` still has
   `PLATE_ANCHORS` (~729) with `release {x: 0.493, y: 0.454}`, `nearBoxLeft {0.250, 0.922}`,
   `nearBoxRight {0.750, 0.922}`, `NEAR_BATTER_HEIGHT_FRAC = 0.50`,
   `MOUND_PITCHER_HEIGHT_FRAC = 0.11`, and `drawPlateView` (~887). Line numbers drift; names do
   not.
6. `pinball/js/render3d.js` lines ~78-93 hold the `isSoftGL()` swiftshader probe;
   `measure-gallery.mjs` launches Chromium with `--use-gl=swiftshader`. That is how the test in
   commit 6 gets pixels in this container.
7. `node_modules/playwright-core` resolves (symlink to
   `/opt/node22/lib/node_modules/playwright/node_modules/playwright-core`; gitignored, never
   committed). Chromium is at `/opt/pw-browsers/chromium`.

---

## 1. Matt's part: producing the character (Windows PC)

This is the one step the build session cannot do: there is no headless Blender in the
container (`pip download bpy` timed out) and Mixamo is a browser tool behind an Adobe login.
Everything here is free. **Budget: about an hour the first time.**

The shape of it: one file holds the BODY (mesh + skeleton + the Idle clip); four small files
hold the other clips as skeleton-only animation. The code applies those clips to the body at
runtime by bone name, which works because every file comes off the same Mixamo skeleton. This
avoids merging animations inside Blender, which is the step people get stuck on.

### 1.1 Pick a character

Any humanoid mesh in a T-pose or A-pose. Cartoon proportions match the Gemini art better than a
realistic scan at the sizes these figures draw (the pitcher is 11% of the field height).
Options, in order of least effort:

- **Mixamo's own stock characters.** Log in, "Characters" tab, pick one. Rigged already. Adobe's
  terms let you use Mixamo characters and animations in your own projects, games included; *read
  the Mixamo FAQ on adobe.com for the current wording before shipping.*
- **Quaternius** (quaternius.com), a solo 3D artist who publishes low-poly game asset packs,
  CC0. "CC0" is the Creative Commons public-domain dedication: no credit required, no licence
  text to carry, use for anything. *I have not re-checked that site's current licence text;
  confirm it still says CC0 before shipping.* Download the character as fbx or glb, upload to
  Mixamo, auto-rig (1.2).
- Any other T-posed humanoid you like the look of, same auto-rig step.

### 1.2 Mixamo (mixamo.com, free Adobe account)

1. **Character.** Stock: click it, done. Uploaded: "Upload character", drop the file. The
   auto-rigger shows the figure and asks you to drag five markers onto it: chin, both wrists,
   both elbows, both knees, groin. "Use symmetry" on. Skeleton LOD: standard (65 bones). Wait a
   minute; it plays a test walk when it is done.
2. **Clips.** "Animations" tab, search **baseball**. *I believe the library has clips with names
   like "Baseball Idle", "Baseball Hit", "Baseball Strike", "Baseball Pitching"; I cannot confirm
   the exact names from here.* Pick five:

   | # | Role | Purpose | Likely search | Notes |
   |---|---|---|---|---|
   | 1 | Batter | Idle | baseball idle | loops; the stance at the plate |
   | 2 | Batter | Swing | baseball hit | contact happens somewhere in it |
   | 3 | Batter | Miss | baseball strike | optional; skip if nothing fits, Swing is reused |
   | 4 | Pitcher | Set | idle | loops; standing on the mound; any calm idle works |
   | 5 | Pitcher | Pitch | baseball pitching | release happens somewhere in it |

   If a clip has an **"In Place"** checkbox in its right-hand panel, tick it. It stops the figure
   walking off its spot on the field.
3. **Download each clip.** The Download button, top right. Settings:
   - Format **FBX Binary**, **30** frames per second, keyframe reduction **none**.
   - Skin: **"With Skin"** for clip 1 (Idle) ONLY. **"Without Skin"** for clips 2 to 5.
   "With Skin" means the body comes along; "Without Skin" is just the skeleton moving, a much
   smaller file. One body is enough; the other four clips are applied to it by the code.
4. Note whether the swing and the pitch are animated right- or left-handed. Either is fine; the
   code mirrors for the other hand. Write it down for the README (1.4).

### 1.3 Blender (blender.org, Windows installer, version 4.x; free)

Five small conversions, the same steps each time. Blender is only being used as an
FBX-to-glb converter here; no modelling, no animation editing.

For **clip 1** (the body):
1. File > New > General. Delete the default cube (click it, X, Delete).
2. File > Import > FBX (.fbx), pick the "With Skin" file. The character appears.
3. In the Outliner (top right list) find the material on the shirt: click the character mesh,
   Material Properties tab (the red sphere icon, bottom right panel), and rename the shirt's
   material to exactly **`Jersey`**. If there is a cap material, rename it **`Cap`**. Leave the
   rest alone. The code recolours those two by team.
4. Timeline at the bottom: the imported action is already on the armature. In the Dope Sheet >
   Action Editor, rename the action to exactly **`Idle`**.
5. File > Export > glTF 2.0: Format **glTF Binary (.glb)**, Include > Animation **on**,
   Animation > **Group by NLA Track on** (harmless here), **Compression off** (no Draco; the
   game has no decoder). Save as **`body.glb`**. If it is over 3 MB, go to Data > Images and set
   the image size limit to 1024, or export images as JPEG.

For **clips 2 to 5** (skeleton only), each one:
1. File > New > General, delete the cube.
2. File > Import > FBX, pick the "Without Skin" file. Only a skeleton appears. That is correct.
3. Dope Sheet > Action Editor: rename the action to exactly **`Swing`**, **`Miss`**, **`Set`**
   or **`Pitch`**.
4. Export glTF 2.0 with the same settings, saved as **`swing.glb`**, **`miss.glb`**,
   **`set.glb`**, **`pitch.glb`**. Each should be well under 1 MB.

### 1.4 The mark frames, and where to upload

Two frame numbers matter, and your eye is better than the code's guess. With `swing.glb`'s scene
open in Blender, drag the timeline scrubber until the hands pass the front of the body, where a
bat would be over the plate. Read the frame number. Do the same in `pitch.glb` for the frame
where the throwing hand is furthest forward. Write both, plus the hand, plus the clip lengths
(the timeline's End value), into `reference/baseball/models/README.md`, for example:

```
Swing: contact frame 14 of 38. Miss: contact frame 14 of 38.
Pitch: release frame 22 of 41.
Clips are right-handed.
Character: <name, where it came from>
```

Upload the five glb files and the README to `reference/baseball/models/` on GitHub (the web
uploader is fine; every file is under GitHub's 25 MB web limit).

If you would rather have two different-looking people (a distinct pitcher), repeat 1.3 clip 1
for the second character and name it `pitcher-body.glb`; the code takes either layout (C2).

### 1.4 Scaffolding asset (build session only, never shipped)

Until `body.glb` lands, the build session may develop against three's example
`RobotExpressive.glb` fetched from jsdelivr into the scratchpad (it carries named clips and a
Mixamo-style rig, which is enough to prove the loader, the mixer, the camera and the test). It
is never copied into `baseball/`, never committed, and never appears in a screenshot sent to
Matt. Matt's words on stand-ins: *"we're straying farther and farther from what I want."*

---

## 2. The build, in commits

One PR per commit or one PR for the lot, your call; each commit must leave `main` playable if
merged alone (the sprite path stays live until C3 switches, and C3 only switches once C2 is
proven). Bump `CACHE` in `sw.js` past what is on `main` at the moment you push, not past your
working copy.

### C1. Vendor three r185 + the three add-ons into `baseball/js/vendor/`

- Copy `three.core.min.js` and `three.module.min.js` byte-for-byte from `pinball/js/vendor/`.
- Fetch `examples/jsm/loaders/GLTFLoader.js`, `examples/jsm/utils/SkeletonUtils.js`,
  `examples/jsm/utils/BufferGeometryUtils.js` from `three@0.185.0` on jsdelivr into the same
  folder. **Rewrite their bare imports**: `from 'three'` becomes
  `from './three.module.min.js'`, and GLTFLoader's `'../utils/BufferGeometryUtils.js'` /
  `'../utils/SkeletonUtils.js'` become `'./BufferGeometryUtils.js'` / `'./SkeletonUtils.js'`.
  There is no import map in this repo and no build step; a bare specifier is a hard 404.
- Add all five files to `sw.js` `ASSETS` (REST tier, plain; they are game CODE, never LAZY: root
  `CLAUDE.md`, the 2026-09-11 LAZY bullet).
- Check: `node --input-type=module -e "import('./baseball/js/vendor/GLTFLoader.js').then(m => console.log(Object.keys(m)))"`
  prints `[ 'GLTFLoader' ]` with no error. All three add-ons import cleanly in node; that is the
  structural test that the rewrite is complete.
- `node validate-sw-assets.mjs` regenerates `REST_MANIFEST` and `version.json`; commit `sw.js`.

### C2. `baseball/js/actors.js`: the character layer

One module, one class, no engine knowledge. It owns a WebGL canvas and two actors. Nothing in
`field.js` changes in this commit.

**Canvas.** A second `<canvas class="bb-actor-canvas">` inside `.bb-field-wrap`, absolutely
positioned over `.bb-field-canvas` (same size, same DPR handling as `_sizeCanvas`), with
`alpha: true`, `premultipliedAlpha: true`, `antialias: true`, `powerPreference: 'low-power'`,
`setPixelRatio(Math.min(2, devicePixelRatio))` (Ball Run's cap), `setClearColor(0, 0)`. The
painted `plate.webp` stays where it is, on the 2D canvas underneath; the WebGL canvas holds only
the figures, the bat and (from C4) the ball. `.bb-pop` keeps `z-index: 3` and stays above both.
`pointer-events: none` on the new canvas: nothing in the field is tappable and the game's
`touchmove` binding must keep going to the root.

**Camera.** Orthographic, not perspective, on purpose: each actor is placed in screen space
against the anchors that already exist, so the 3D layer cannot drift from the painted picture.
For an actor with target height `hPx` at anchor point `(ax, ay)` (feet position, px):
- `uniformScale = hPx / modelHeightWorld` (measure `modelHeightWorld` once at load from the
  bounding box of the `Idle` pose; never hardcode it).
- position so the model's feet sit at `(ax, ay)`. With an ortho camera spanning exactly the
  canvas in px (`left 0, right w, top 0, bottom -h` and the actor's `y` negated), the mapping is
  the identity and the same `anchorPx(PLATE_ANCHORS.*, cover)` values `drawPlateView` uses feed
  straight in.
- Batter: `anchorPx(nearBoxLeft or nearBoxRight)`, `hPx = h * NEAR_BATTER_HEIGHT_FRAC` (0.50 H).
  Pitcher: `anchorPx(mound)`, `hPx = h * MOUND_PITCHER_HEIGHT_FRAC` (0.11 H). These are the
  numbers the sprites were fitted to and Matt approved the composition; do not retune them.
- Export `anchorPx` and `plateCover` from `field.js` if they are not exported already (they are
  module-private today). Do not duplicate the maths.
- Facing: the batter faces the pitcher (toward the top of the screen), turned about 80 degrees so
  the camera behind the plate sees them from behind and to the side, the way the Gemini frames
  are drawn. The pitcher faces the camera. Set each actor's `rotation.y` once and tune by eye
  against `reference/baseball/mock-play-batting.jpg`, which is the target picture.

**Lighting.** One `HemisphereLight` (sky warm white, ground green-grey) + one `DirectionalLight`
from upper left, no shadow maps. A **blob shadow** per actor: a flat dark ellipse
(`CircleGeometry`, `opacity 0.35`) at the feet, scaled with the actor. Shadow maps on a phone GPU
for two figures are not worth their cost, and the painted backdrop already has its own light.

**Loading.** `GLTFLoader.loadAsync(url)` per file. Layout, matching section 1:
`body.glb` (mesh + skeleton + `Idle`) plus `swing.glb`, `miss.glb`, `set.glb`, `pitch.glb`
(skeleton-only clips). Both actors are `SkeletonUtils.clone(body.scene)`; an optional
`pitcher-body.glb` replaces the pitcher's clone. Clips come from each file's `animations[0]`
(fall back to a name match if a file carries more than one) and are applied to the body's
skeleton by bone name, which works because every file came off the same Mixamo rig; the
loader's `sanitizeNodeName` strips the `mixamorig:` colon identically in every file, so track
names line up. `miss.glb` missing falls back to `Swing`; `set.glb` missing falls back to `Idle`.
A missing `swing.glb` or `pitch.glb` throws with the file name in the message. Also find the
throwing-hand bone: the first bone whose name ends in `RightHand` (Mixamo: `mixamorigRightHand`);
throw likewise if absent.

**Team colour.** After load, traverse materials; the one named `Jersey` gets `color.set(hex)`
per team, `Cap` likewise if present. Home and away hexes: take them from the two shipped sprite
sets (sample `reference/baseball/batter-home-1.png` and `batter-away-1.png`'s shirt; write the
two hexes as constants with a comment saying where they came from). Clone the material per actor
before recolouring or both figures change together.

**The bat.** Built in code, not in the model: a `CylinderGeometry` tapered from knob (radius
0.012 of model height) to barrel (0.028), length 0.48 of model height, wood-coloured, parented to
the batter's right-hand bone with a position/rotation offset tuned by eye so it sits in the
hands through the whole `Swing`. Expose the offset as one constant object at the top of the file.
The pitcher gets no bat, no glove.

**Public surface** (all synchronous after `ready`):

```js
const actors = new Actors(wrapEl);           // creates the canvas, nothing loaded yet
await actors.load({ body, swing, miss, set, pitch, pitcherBody });  // urls; miss/set/pitcherBody optional
actors.resize(w, h, cover);                  // called from _sizeCanvas after the 2D canvas
actors.setBatter({ side: 'home'|'away', bats: 'R'|'L' });
actors.setPitcher({ side, throws });
actors.play('batter', 'Swing', { markAtMs: 80 });   // the clip's contact mark lands 80 ms from now
actors.play('pitcher', 'Pitch', { markAtMs: 1400 });// the release mark lands 1400 ms from now
actors.idle('batter'); actors.idle('pitcher');      // back to the loop
actors.setBall({ visible, x, y, z } | null);        // C4
actors.pause(); actors.resume();                    // visibilitychange
actors.dispose();                                    // renderer.dispose + forceContextLoss + geometries/materials
```

`play` with `markAtMs`: the clip's mark time (contact or release, from
`reference/baseball/models/README.md`, held as constants `SWING_CONTACT_S` / `PITCH_RELEASE_S`
in this file) sets `action.timeScale = markTimeS / (markAtMs / 1000)` so the mark lands exactly
when the engine says it happens. After the mark the rest of the clip plays at the same scale and
holds its last frame (`clampWhenFinished = true`, `LoopOnce`); `idle()` cross-fades back
(`crossFadeTo`, 150 ms).

**Hand.** `bats === 'L'` or `throws === 'L'`: mirror the actor with `root.scale.x = -1` AND place
the batter at `nearBoxRight`. three.js flips face winding for negative-determinant matrices on its
own, so no material change is needed. Matt's correction from BB-3b, still true: **both shipped
teams' art is right-handed; the model must follow `bats`/`throws` from `teams.js`, never a
hardcoded side.**

**Render loop.** One `requestAnimationFrame` loop while the play screen is mounted; `mixer.update`
+ `renderer.render` each frame. Stop it in `pause()` (document hidden) and `dispose()`.
Use `js/viewport.js`'s `onViewportResize`, never a raw resize listener
(`test-game-conventions.mjs` fails on one).

**Dev screen.** Replace `drawFrameCheck`'s "frame check" dev screen with a 3D one that shows both
actors at their anchors, cycles clips on tap, and lets the bat offset be nudged with four buttons
whose values print to console. Dev-profile only, as the old one was.

Check for this commit: the scaffolding asset (or Matt's) loads, both actors stand at the right
height and place over `plate.webp`, `play('batter','Swing',{markAtMs:80})` visibly swings, no
console error, `dispose()` leaves no WebGL context (Chromium's `--enable-precise-memory-info` is
not needed; `renderer.info.memory` reads zero geometries after dispose).

### C3. `ui.js`: switch the figures to the 3D layer

- `_sizeCanvas` also calls `actors.resize`. `drawPlateView` gets `opts.noFigures = true` and
  skips `drawBatterFigure` / `drawPitcherFigure` when set (one flag; the sprite code is deleted
  in C7, not here).
- Every write to `state.pitcherFrame` / `state.batterFrame` becomes an `actors` call. The mapping,
  and it must preserve R1 and R2 exactly:

  | Today | Becomes |
  |---|---|
  | `_stepWindup` sets frame 1 at 0, 2 at ~55%, 3 (release) at `WINDUP_MS` | `actors.play('pitcher','Pitch',{markAtMs: WINDUP_MS})` at the start; the code still awaits the same `WINDUP_MS` before releasing the ball |
  | frame 4 at +120 ms after release | nothing; the clip's own follow-through |
  | `HumanAgent` pitching (~1126-1210): frames 1/2 during the hold, 3 on release, 4 after | `Set` loop during the hold; `play('pitcher','Pitch',{markAtMs: ...})` at release with the mark set so the hand is forward at the release instant; the simplest honest value is the clip's release time itself (`markAtMs = PITCH_RELEASE_S * 1000`), starting the clip that far BEFORE the release; if the human releases sooner, start the clip at the release with `markAtMs: 0` (seek to the mark) |
  | `_startSwingTimeline` frames 3..8 over 0..200 ms, contact at 80 ms | `actors.play('batter','Swing',{markAtMs: 80})` (a miss uses `Miss`); the engine's swing event and the popup timing are untouched |
  | charge loop frames 1/2 | `Idle` (a charging batter holds the stance; no half-cock pose exists in the clip set, and inventing one is a feature not discussed) |
  | `_settleAtBat` / new at-bat resets to frame 1 | `actors.idle('batter')` + `actors.setBatter(next)` at the same moment the fade swap runs today |

- Batter side/hand per at-bat: `setBatter({ side, bats })` from the engine's current batter,
  `setPitcher({ side, throws })` from the current pitcher, at the same place `drawPlateView`'s
  `flip` is computed today.
- `pause()`/`resume()` on `visibilitychange`; `dispose()` in `destroy()`.
- Overhead state: the actor canvas is hidden (`display: none`, loop stopped) while the field is
  in the overhead cut and shown again when the plate view returns. The overhead picture keeps its
  painted players.

Check: `node test-baseball-device.mjs` passes with the `r2-cadence` numbers unchanged (6219-6225
ms). If they move, the timeline changed and the commit is wrong.

### C4. The ball, from the hand

- Pitch flight: at release, read the throwing-hand bone's world position
  (`bone.getWorldPosition`) and use it as the ball's start point in the actor scene instead of
  `PLATE_ANCHORS.release`. The end point is the plate crossing, at the screen position
  `drawPlateBall` computes for `t=1` today (same `pitchResult.x`, same `pitchBendFrac` bend).
  The ball is a `SphereGeometry` with a red-seam texture (`ball-sheet.webp` frame 1 mapped once;
  no spin sheet needed in 3D, rotate the mesh instead), scaled from `0.011` of the pitcher's
  height at release to `0.06` of the batter's height at the plate, following the same
  `timeToPlateS` and the same `_animatePitchFlight` step. The 2D `drawPlateBall` and its trail
  are no longer called on the plate view; `_animatePitchFlight` drives `actors.setBall` instead.
- After contact: the overhead cut is 2D and unchanged; hide the 3D ball at the cut.
- A pitch nobody swings at: the ball passes the batter and is hidden at the plate crossing, as
  today.

Check: the ball leaves the pitcher's hand (not a fixed anchor), on both hands, both sides.

### C5. Loading, the setup screen and the service worker

- `baseball/models/*.glb` (body + the four clip files) is the shipped copy. `reference/baseball/models/`
  is the archive and stays.
- `sw.js`: add the glb path(s) to `ASSETS`, and widen `LAZY_REST` to
  `/^\.\/(boggle\/data\/words[a-z-]*\.txt|baseball\/models\/[a-z-]+\.glb)$/`. A model of a few MB
  is exactly the LAZY case (large, useless to anyone not playing this game). `test-sw-strategy.mjs`
  pins the carry-forward ordering; run it.
- The setup screen starts `actors.load` the moment Baseball mounts, so by the time the player has
  chosen a league the model is usually in cache. Play waits on the load; while waiting, the Play
  button shows the existing loading state (find the pattern in another game's `renderLoadError` /
  `load_error` string; add `load_model` to `strings.js` in EN and ES if no fitting string exists).
  On failure: the game's load-error screen, translated, never a silent blank field.
- Regenerate `REST_MANIFEST` + `version.json` (`node validate-sw-assets.mjs`) and commit `sw.js`.

### C6. Tests

`test-baseball-actors.mjs`, new, two halves, and the header says which is which:

1. **Node, no browser** (runs in `run-all-tests.mjs`): read each shipped glb's 12-byte header and
   JSON chunk (no loader; the format is a length-prefixed JSON chunk), assert magic `glTF`, version
   2, that `body.glb` has a node named `*RightHand` and a material named `Jersey`, that every
   clip file has at least one animation, no `KHR_draco_mesh_compression`
   in `extensionsRequired`, and file size under 4 MB. Structural checks on `ui.js`: no remaining
   `state.batterFrame` / `state.pitcherFrame` writes; `actors.dispose()` inside `destroy()`;
   `visibilitychange` handled.
2. **Chromium under swiftshader** (SKIPs without playwright-core; deliberately NOT in
   `run-all-tests.mjs`, same call as `test-brickcity-throat.mjs`): mount Baseball in the real hub
   at 393x852 dpr3 with `--use-gl=swiftshader`, start Quick Play, wait for `actors.ready`, then
   read back the actor canvas (`toDataURL` on the WebGL canvas requires
   `preserveDrawingBuffer: true`; set it only when a test flag is present, e.g.
   `window.__bbTest`), and assert: the pixel block at the batter anchor is non-transparent in
   idle; a second read-back 100 ms into `Swing` differs from the idle read-back (the figure
   moved); after `destroy()` the canvas is gone from the DOM.

Then the suites that already exist and still bind: `node test-baseball-device.mjs`
(`r2-cadence` unchanged), `node test-visual.mjs baseball` (open the contact sheet in
`.visual-out/` and look), `node check-no-scroll.mjs baseball`, `node test-game-conventions.mjs`,
`node test-i18n-strings.mjs`, `node test-sw-strategy.mjs`, `node baseball/js/test.js`. Do not
run `run-all-tests.mjs` (Matt's rule, root `CLAUDE.md`).

### C7. Delete the sprite path, docs, ship

- Delete `drawBatterFigure`, `drawPitcherFigure`, `FRAME_Y_OFFSET_FRAC`,
  `PITCHER_FRAME_Y_OFFSET_FRAC`, `NEAR_BATTER_HEIGHT_FRAC`/`MOUND_PITCHER_HEIGHT_FRAC` move to
  `actors.js` (or stay exported from `field.js`; one home), `drawFrameCheck`, `SWING_TIMELINE`,
  `_startSwingTimeline`, the `batterFrame`/`pitcherFrame` state, and the 32 frame images
  `baseball/img/batter-*.webp` / `pitcher-*.webp` with their `ASSETS` lines. Art files are not
  player data; THE LAW does not cover them. The PNG originals stay in `reference/baseball/`.
- `baseball/CLAUDE.md`: a new top entry, "BB-3c: real 3D characters", stating the decision (Matt:
  "C definitely"), the anchor/ortho mapping, the mark-time rule (`timeScale` from the README's
  frame numbers), the hand rule (`scale.x = -1`, follow `bats`/`throws`), what stays 2D
  (backdrop, overhead cut, HUD, popup), the LAZY tier decision for the glb and its accepted cost
  (first Baseball round needs a connection), and the measured cadence after the switch.
- Root `CLAUDE.md`: the Baseball row in "The games" becomes
  `**Quick Play playable, 3D characters (BB-3c); career is phase 4; devOnly**`, and the
  Dev tooling table gets a `test-baseball-actors.mjs` row.
- `sw.js` `CACHE` bumped past `main`; `node validate-sw-assets.mjs`; commit; push; PR into
  `main`; merge; **verify the `pages build and deployment` run for the merge commit completes
  with `conclusion: success`**; only then tell Matt it is live.

---

## 3. Report back, in this order

1. Section 0 results, verbatim.
2. Which files Matt supplied, the clip names actually present, the
   README's mark frames, the file size, and the hand the clips are animated in.
3. A screenshot of the plate view with both actors idle, and one mid-swing, at 393x852.
4. `r2-cadence` numbers before and after C3.
5. The bat offset constants you settled on, and how they were tuned.
6. Anything in this handoff that turned out wrong against the real files. Say so plainly; do not
   quietly work around it.

## 4. Not in scope (do not build; note it here if you think it is needed)

Fielders in 3D, base runners in 3D, a glove, a catcher, camera movement of any kind, shadow
maps, a swing cue of any kind (removed 2026-09-15, never re-added), the Career/Quick Play setup
screen (held by Matt; phase 4), Draco compression, any change to the engine, the ring, the
strip, the HUD or the timings in `settings.js`.
