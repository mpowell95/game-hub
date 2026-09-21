# Baseball 3D characters: the build document

Written 2026-09-19 by the orchestrating session for the SUB-AGENT sessions that build it. It
supersedes `HANDOFF-BASEBALL-3C.md`'s section 1 (the Mixamo route, which Matt has NOT taken) and
carries its sections 0 and 2 forward in more detail. Where the two disagree, this file wins.

Matt's decisions that shape it (2026-09-15 to 09-19, his words where quoted):

- Real 3D rigged characters replace the sixteen-frame sprites: *"C definitely."*
- **Self-serve route**: nobody hand-animates in Mixamo or Blender. A free, licence-verified rigged
  body is downloaded and the swing and pitch are AUTHORED IN CODE, bone by bone, against the
  shipped sprite frames as the visual target.
- Matt picks the body from rendered candidates before the game is switched to it.
- *"Do not add features that are not discussed."* Scope: two figures, one bat, one ball, team
  colours. No glove, no catcher, no fielders in 3D, no crowd, no camera moves. The camera stays
  behind the plate in both states. The overhead cut on contact stays 2D and stays as it is.
- No em dashes in anything written. No helper text in the UI. No swing cue of any kind.
- Every BB-3b requirement still holds: **R1** the wind-up is a real 1400 ms delivery before
  release; **R2** verdict to next release = resultMs + betweenMs + windupMs, pinned by
  `test-baseball-device.mjs`'s `r2-cadence` (6219 to 6225 ms measured); **R3** the 44 px popup.
  The v843 flight rule holds too: the ball follows `field.js`'s exported `plateBallPos` and crosses
  at the zone's centre, and the batter moves across the box with the pad (`batterAimX`).
- "Asking for a change means LIVE" (root `CLAUDE.md`). The ORCHESTRATOR ships. A sub-agent never
  pushes, never opens a PR, never merges. It commits on the current branch and reports.

---

## 0. How this document is used

There is one orchestrator (the session that wrote this) and one sub-agent per STAGE (section 4).
Each sub-agent is started with: this file, the stage number, and nothing else it needs to ask
for. It works in the repo checkout at `/home/user/game-hub` on the branch already checked out,
commits when its stage's checks pass, and ends with the REPORT in section 5. The orchestrator
reviews the diff and the pictures, then either starts the next stage or sends the same agent back
with corrections.

Rules for every sub-agent, all of them hard:

1. **Read before writing**: root `CLAUDE.md` (THE LAW, the games table), `baseball/CLAUDE.md` (its
   top three entries), `docs/BUILDING-A-GAME.md` Part 0, and this file end to end.
2. **Stay inside your stage.** Files another stage owns are read-only for you. If your stage needs
   a change there, write it in your report as a request; do not make it.
3. **Never touch `baseball/js/engine/`.** Presentation only.
4. **Never push, never open or merge a PR, never bump `CACHE` in `sw.js`** (the orchestrator does
   that last, past whatever is on `main` at that moment). Commit locally with a clear message.
5. **Never run `run-all-tests.mjs`.** Run the checks your stage lists, nothing wider.
6. **Screenshots are the deliverable of every visual stage**, not descriptions of them. Write them
   under `/tmp/claude-0/-home-user-game-hub/095ae74e-dae2-559f-bba8-3be6914d286b/scratchpad/3d/`
   and put the absolute paths in your report. Full page or a stated crop, never a description.
7. **Say what you could not verify.** A check that did not run is reported as not run. A number
   you did not measure is not written down.
8. If the stage's own checks fail after three honest attempts, stop and report the failure with the
   evidence. Do not weaken a check to pass it.
9. Every comment and doc line you write follows the repo's voice: what, why, what it was measured
   against. No em dashes.

---

## 1. Repo facts the code below relies on (verified 2026-09-19 unless stated)

| Fact | Where |
|---|---|
| three.js **r185** is vendored as a two-file pair, `three.core.min.js` (385,386 B) + `three.module.min.js` (365,552 B), identical copies in `pinball/js/vendor/` and `skeeball/js/vendor/`; `three.module.min.js` does `import ... from "./three.core.min.js"` | `pinball/js/vendor/` |
| `examples/jsm/loaders/GLTFLoader.js` (114,959 B), `examples/jsm/utils/SkeletonUtils.js` (11,535 B), `examples/jsm/utils/BufferGeometryUtils.js` (37,621 B) are fetchable from `https://cdn.jsdelivr.net/npm/three@0.185.0/...` (200 on 2026-09-15). They import bare `'three'` and each other by relative path | jsdelivr |
| `raw.githubusercontent.com` and `cdn.jsdelivr.net` work from the container; `github.com` pages and `api.github.com` return 403 through the proxy; `poly.pizza` 403 | measured |
| No GLTFLoader, no import map, no build step anywhere in the repo. A bare `import 'three'` is a 404 at runtime | grep |
| Chromium: `/opt/pw-browsers/chromium`; `playwright-core` resolves only when a script runs from the repo root (`node_modules/playwright-core` is a gitignored symlink there). Headless WebGL works with `--use-gl=swiftshader` (`measure-gallery.mjs` does this) | repo |
| `baseball/js/ui.js`: `BaseballPlayScreen` class; `_sizeCanvas` (~line 320) sizes `.bb-field-canvas` with DPR; `_drawStaticField` (~349) calls `drawPlateView` with `{pitcherFrame, pitcherFlip, batterFrame, batterFlip, batterAimX}`; `SWING_TIMELINE = [[0,3],[40,4],[80,5],[120,6],[160,7],[200,8]]` (~61); `_startSwingTimeline` (~395); `_stepWindup` (~418, frames 1,2,3 over `WINDUP_MS`); `_schedulePitcherFollowThrough` (~437, frame 4 at +120 ms); `_animatePitchFlight` (~855, sets `this._flightActive`); `HumanAgent.decidePitch` (~1104, its own flight loop ~1190-1225, `state.pitcherFrame` 1/2 during hold, 3 at release, 4 after) and `decideSwing` (~1240, charge loop sets `batterFrame` 1/2, `_startSwingTimeline()` on release); `this.dev = isDevProfile()` (~116) gates the Tune panel and the Frames check (`_openFrameCheck`, ~1030); `destroy()` cancels `_rafBall`, `_pitchRaf`, `_flightRaf` (~158) | ui.js |
| `baseball/js/field.js` exports `PLATE_ANCHORS` (`plate {0.500,0.879}`, `mound {0.500,0.505}`, `release {0.493,0.454}`, `nearBoxLeft {0.250,0.922}`, `nearBoxRight {0.750,0.922}`), `zoneRect(w, cover)`, `plateBallPos(w, h, cover, xFt, yFt)`, `drawPlateView`, `drawPlateBall`. Module-private today: `plateCover(w, h)`, `anchorPx(frac, cover)`, `NEAR_BATTER_HEIGHT_FRAC = 0.50`, `MOUND_PITCHER_HEIGHT_FRAC = 0.11`, `BATTER_AIM_TRAVEL_FRAC = 0.06`, `PLATE_CAMERA_FT = 24` | field.js |
| The reference swing and delivery, frame by frame: `reference/baseball/batter-home-1..8.png` (idle 1, load 2, frames 3..8 the swing, contact at 5), `batter-away-1..8.png` (same poses, navy), `Pitcher-home-1..4.png` / `Pitcher-away-1..4.png` (set 1, leg lift 2, release 3, follow-through 4). Shipped copies: `baseball/img/*.webp` | reference/ |
| The painted backdrop the figures stand on: `baseball/img/plate.webp` (1200x1585), fitted `cover, bottom center` by `plateCover` | img/ |
| Team art: home is white jersey with navy trim; away is navy jersey with grey pants (from the sprite sets) | reference/ |
| Load-error pattern to copy: `boggle/js/ui.js` `renderLoadError()` with strings `load_error` in EN and ES | boggle/ |
| Service worker tiers: `sw.js` `ASSETS` list (REST tier for game files, ~line 363 for baseball's block), `LAZY_REST` regex at ~548 (`/^\.\/boggle\/data\/words[a-z-]*\.txt$/`), `validate-sw-assets.mjs` regenerates `REST_MANIFEST` + `version.json`, `test-sw-strategy.mjs` pins the tiers | sw.js |
| Test runners that already bind: `node test-baseball-device.mjs` (needs `node server.mjs` up; r2-cadence, plate-camera, plate-flight probes), `node test-visual.mjs baseball`, `node check-no-scroll.mjs baseball`, `node test-game-conventions.mjs`, `node test-i18n-strings.mjs`, `node baseball/js/test.js`, `node test-sw-strategy.mjs` | root |
| `js/viewport.js` `onViewportResize(cb)` is the ONLY allowed resize subscription; `test-game-conventions.mjs` fails a raw `resize` listener | js/ |

---

## 2. The model: Kenney "Animated Characters Protagonists" (Matt's pick, 2026-09-19)

Matt, shown renders of every licence-verified candidate this container could reach (three.js's
robot, KayKit's knight and rogue, Cesium Man, Quaternius's Universal Base Characters and Modular
Men, and this pack): *"Let's use this pack then. The Kenney."* Chibi proportions, the Backyard
Baseball feel he asked for.

### 2.1 Facts, all measured from the files

```
SOURCE          https://kenney.nl/assets/animated-characters-protagonists  (zip archived at
                reference/baseball/models/kenney/, with the pack's own License.txt and Preview.png)
LICENCE         CC0 1.0, from the pack's License.txt ("You can use this content for personal,
                educational, and commercial purposes")
SHIPPED         baseball/models/player.glb (544,936 B) + baseball/models/skins/{skaterMaleA,
                criminalMaleA, skaterFemaleA, cyborgFemaleA}.png (35 to 52 KB each, 1024x1024)
BUILT BY        node convert-kenney.mjs (repo root; FBX -> glb through three's own FBXLoader +
                GLTFExporter in headless Chromium, no Blender). Re-run it, never hand-edit the glb.
BODY            ONE mesh, "characterMedium", 4,812 vertices, one material named "Skin" with NO
                texture in the file. The four skins are painted textures for that one body: the
                outfit is in the picture, not in the geometry. Faces differ per skin too.
SKELETON        58 bones as loaded (45 in the glTF skin, the rest are IK helper bones the pack's
                rig carries: *Ctrl, *IK, *Roll; harmless, never animate them). Standard names.
HEIGHT UNITS    376.5 in the file's own units (feet at y=0.07); actors.js measures it at load
FRONT AXIS      +Z (the face is seen from a camera on +Z)
CLIPS IN FILE   "Idle" only (1.07 s, the pack's own; run/jump were dropped). Swing/Miss/Set/Pitch
                are authored in poses.js.
TEXTURE RULE    three's TextureLoader default (flipY = true) is CORRECT for these skins on this
                glb; the UVs came through FBXLoader in three's own convention. Do not set flipY
                false the way a glTF-embedded texture would need.
```

### 2.2 Skins and team colours

There is no "Jersey" material to recolour. The uniform is painted into the skin PNG, in flat
colours, so a team colour is a **colour-key remap of the texture**: load the PNG, draw it to a 2D
canvas once per (skin, side), replace every pixel whose colour matches a source key (within a small
tolerance) with the team's colour, and use the result as a `CanvasTexture`. The most common
colours per skin, measured (RGB hex, pixel count), so stage 3 has something to start from:

| Skin | Main colours | Reads as |
|---|---|---|
| `criminalMaleA` | `#ffffff` 373k (suit), `#220f0f` (hair), `#202020` (shoes), `#f58c6a` (skin), `#009f78` 48k (collar/cuff trim) | a white uniform with green trim already; home as is, away by keying white to navy and the trim to the away accent |
| `skaterMaleA` | `#4d160e` (hair), `#ffffff` (sleeves/undershirt), `#f2654c` 59k + `#f59170` (shirt), `#e4783e` (?), `#ccdde7` (knee pads), `#252525`, `#ea3031`, `#38bb96` (shoes) | a red-orange tee; key the shirt reds to the team colour |
| `skaterFemaleA` | `#220f0f`, `#ea3031` 105k (sleeves), `#252525` (top), `#f58c6a`, `#e4783e`, `#d22223`, `#ccdde7` | black top, red sleeves |
| `cyborgFemaleA` | `#252525`, `#202020`, `#e2472b` (hair), `#b7cedd`, `#85a3ba` (chrome), `#f59574` | half chrome; least uniform-like |

Skin tones are the `#f5xxxx` gradient family and hair the dark browns; never key those. Stage 3
picks the exact key tables by rendering, and the dev screen shows home and away side by side.

**Corrected against the real stage 3 build (2026-09-19)**: `skaterMaleA`'s `#f59170` above is NOT
actually keyed. Re-measured against the shipped `KEYS` table in `actors.js`, `#f59170` sits only
`(0,5,6)` away from the skin-tone anchor `#f58c6a` - well inside the default `COLOR_TOL` of 6 - so
keying it would also recolour a sliver of skin every time a jersey changes colour. Left out on
purpose; the tee's own gradient is covered by `#f2654c` and its neighbours instead (see
`actors.js`'s own comment on that skin's per-column-sampled palette).

Default casting: the human's batter and pitcher are `skaterMaleA` recoloured to the home colours;
the CPU's are `criminalMaleA` recoloured to the away colours. The other two skins are available
for later casting at no cost (same body, same skeleton).

### 2.3 The RIG map (already in `baseball/js/rig.js`)

| Semantic | Node | | Semantic | Node |
|---|---|---|---|---|
| `hips` | `Hips` | | `handL` / `handR` | `LeftHand` / `RightHand` |
| `spine` | `Spine` | | `upperLegL` / `upperLegR` | `LeftUpLeg` / `RightUpLeg` |
| `chest` | `Chest` (an `UpperChest` also exists) | | `lowerLegL` / `lowerLegR` | `LeftLeg` / `RightLeg` |
| `neck` / `head` | `Neck` / `Head` | | `footL` / `footR` | `LeftFoot` / `RightFoot` |
| `shoulderL` / `shoulderR` | `LeftShoulder` / `RightShoulder` | | fingers | `*HandIndex1..3`, `*HandThumb1..2` (unused) |
| `upperArmL` / `upperArmR` | `LeftArm` / `RightArm` | | | |
| `lowerArmL` / `lowerArmR` | `LeftForeArm` / `RightForeArm` | | | |

Every REQUIRED entry resolves against the shipped glb (`node test-baseball-actors.mjs`, node half).

### 2.4 Scaffold asset (no longer needed)

Stage 1 was built against three.js's RobotExpressive.glb before the pick. It is not used by any
later stage; `render-actor.mjs --model` still accepts any file.

## 3. The code, module by module

All paths are under `baseball/js/` unless stated. Every new file opens with a header comment in
the repo's voice: what it is, why it exists, what it was measured against.

### 3.1 `vendor/` (stage 1)

```
baseball/js/vendor/three.core.min.js        copied byte for byte from pinball/js/vendor/
baseball/js/vendor/three.module.min.js      copied byte for byte from pinball/js/vendor/
baseball/js/vendor/GLTFLoader.js            three@0.185.0 examples/jsm/loaders/GLTFLoader.js, imports rewritten
baseball/js/vendor/SkeletonUtils.js         three@0.185.0 examples/jsm/utils/SkeletonUtils.js, imports rewritten
baseball/js/vendor/BufferGeometryUtils.js   three@0.185.0 examples/jsm/utils/BufferGeometryUtils.js, imports rewritten
```

The rewrite, exactly:

```sh
cd baseball/js/vendor
for f in GLTFLoader SkeletonUtils BufferGeometryUtils; do
  curl -sS -o $f.js "https://cdn.jsdelivr.net/npm/three@0.185.0/examples/jsm/$( [ $f = GLTFLoader ] && echo loaders || echo utils )/$f.js"
  sed -i "s#from 'three'#from './three.module.min.js'#; s#from '../utils/BufferGeometryUtils.js'#from './BufferGeometryUtils.js'#; s#from '../utils/SkeletonUtils.js'#from './SkeletonUtils.js'#" $f.js
done
grep -n "from '" GLTFLoader.js SkeletonUtils.js BufferGeometryUtils.js   # every import must be ./something
```

Check: from the repo root,
`node --input-type=module -e "import('./baseball/js/vendor/GLTFLoader.js').then(m => console.log(Object.keys(m)))"`
prints `[ 'GLTFLoader' ]`. All three add-ons import in node with no error. Add all five files to
`sw.js` `ASSETS` inside baseball's block (REST tier, plain entries; they are game code, never LAZY).

### 3.2 `glb-info.mjs` (repo root, stage 1; dev tooling, not deployed)

A no-dependency reader of any `.glb`: header (magic `glTF`, version 2), the JSON chunk, then
prints: byte size, `asset.generator`, `extensionsRequired`, skins (joint count), the joint node
names, every node name, mesh count, material names, animation names with durations (from the
sampler input accessor max), and whether images are embedded. `node glb-info.mjs <file> [--json]`.
The test in 3.9 imports its `readGlb(path)` export. It is also how stage 1 fills `RIG`.

Skeleton:

```js
// glb-info.mjs
import { readFileSync } from 'node:fs';
export function readGlb(path) {
  const buf = readFileSync(path);
  const magic = buf.toString('ascii', 0, 4);
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  if (magic !== 'glTF' || version !== 2) throw new Error(`${path}: not a glTF 2 binary (magic=${magic}, version=${version})`);
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4E4F534A) throw new Error(`${path}: first chunk is not JSON`);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  return { json, bytes: buf.length, declaredBytes: total };
}
export function summarize({ json, bytes }) {
  const nodes = json.nodes || [];
  const name = (i) => nodes[i]?.name ?? `#${i}`;
  return {
    bytes,
    generator: json.asset?.generator || '',
    extensionsRequired: json.extensionsRequired || [],
    skins: (json.skins || []).map((s) => ({ joints: s.joints.length, names: s.joints.map(name) })),
    nodeNames: nodes.map((n, i) => n.name ?? `#${i}`),
    meshes: (json.meshes || []).length,
    materials: (json.materials || []).map((m) => m.name ?? ''),
    animations: (json.animations || []).map((a) => ({
      name: a.name ?? '',
      seconds: Math.max(...a.samplers.map((s) => (json.accessors[s.input].max || [0])[0])),
    })),
    embeddedImages: (json.images || []).filter((im) => im.bufferView != null).length,
  };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node glb-info.mjs <file.glb> [--json]'); process.exit(2); }
  const s = summarize(readGlb(file));
  if (process.argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
  else {
    console.log(`${file}: ${s.bytes} bytes, generator "${s.generator}"`);
    console.log(`extensionsRequired: ${s.extensionsRequired.join(', ') || 'none'}`);
    for (const sk of s.skins) console.log(`skin: ${sk.joints} joints: ${sk.names.join(', ')}`);
    console.log(`materials: ${s.materials.join(', ')}`);
    for (const a of s.animations) console.log(`animation "${a.name}" ${a.seconds.toFixed(2)} s`);
    console.log(`embedded images: ${s.embeddedImages}`);
  }
}
```

### 3.3 `rig.js` (stage 1)

```js
// rig.js - semantic bone names for baseball/models/player.glb (section 2.3 of docs/BASEBALL-3D-BUILD.md).
export const RIG = {
  hips: '<node name>', spine: '<node name>', chest: null, neck: null, head: '<node name>',
  shoulderL: null, shoulderR: null,
  upperArmL: '<node name>', upperArmR: '<node name>', lowerArmL: '<node name>', lowerArmR: '<node name>',
  handL: '<node name>', handR: '<node name>',
  upperLegL: '<node name>', upperLegR: '<node name>', lowerLegL: '<node name>', lowerLegR: '<node name>',
  footL: '<node name>', footR: '<node name>',
};
export const RIG_REQUIRED = ['hips', 'spine', 'head', 'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR',
  'handL', 'handR', 'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR', 'footL', 'footR'];
/** Resolve every RIG entry against a loaded scene. Throws naming the first REQUIRED bone that is
 *  missing; optional ones resolve to their fallback (chest->spine, neck->head, shoulder->upperArm). */
export function resolveRig(root) {
  const find = (n) => (n ? root.getObjectByName(n) : null);
  const out = {};
  for (const k of Object.keys(RIG)) out[k] = find(RIG[k]);
  for (const k of RIG_REQUIRED) if (!out[k]) throw new Error(`rig: required bone "${k}" (${RIG[k]}) not found in model`);
  out.chest = out.chest || out.spine;
  out.neck = out.neck || out.head;
  out.shoulderL = out.shoulderL || out.upperArmL;
  out.shoulderR = out.shoulderR || out.upperArmR;
  return out;
}
```

### 3.4 `poses.js` (stages 2 and 3): clips authored as keyframed bone rotations

The idea: a clip is a list of keyframes; a keyframe is `{ t, pose }` where `pose` maps semantic
bone names to Euler rotations IN DEGREES applied ON TOP OF the bone's rest rotation. The builder
turns that into a real `THREE.AnimationClip` (one `QuaternionKeyframeTrack` per bone, plus one
`VectorKeyframeTrack` for `hips` position when a keyframe carries `hipsOffset`), so everything
downstream is the standard mixer: cross-fades, `timeScale`, `LoopOnce`, marks.

```js
// poses.js
import * as THREE from './vendor/three.module.min.js';

const DEG = Math.PI / 180;
/** `restQ[semantic]` is each bone's quaternion as loaded (the bind pose), captured ONCE at load by
 *  actors.js. A pose rotation is composed on top of it, so a pose of all zeros is the bind pose and
 *  every clip below is written relative to that, whatever the model's own rest happens to be. */
export function buildClip(name, keyframes, bones, restQ, opts = {}) {
  const order = opts.eulerOrder || 'XYZ';
  const names = new Set();
  for (const kf of keyframes) for (const b of Object.keys(kf.pose || {})) names.add(b);
  const tracks = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const b of names) {
    const bone = bones[b];
    if (!bone) continue;
    const times = [], values = [];
    for (const kf of keyframes) {
      const r = (kf.pose && kf.pose[b]) || [0, 0, 0];
      e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, order);
      q.copy(restQ[b]).multiply(new THREE.Quaternion().setFromEuler(e));
      times.push(kf.t); values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
  }
  if (keyframes.some((kf) => kf.hipsOffset) && bones.hips) {
    const base = bones.hips.position;
    const times = [], values = [];
    for (const kf of keyframes) {
      const o = kf.hipsOffset || [0, 0, 0];
      times.push(kf.t); values.push(base.x + o[0], base.y + o[1], base.z + o[2]);
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${bones.hips.name}.position`, times, values));
  }
  const duration = keyframes[keyframes.length - 1].t;
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Every authored clip. `mark` is the instant (seconds) actors.js lines up with the engine:
 *  contact for Swing/Miss, release for Pitch. Times are the clip's own; actors.js rescales.
 *  Corrected against the real stage 2 build (2026-09-19): `Swing.mark` shipped as `0.22`, not the
 *  `0.30` this template guessed - stage 2's own render-and-compare loop against
 *  `batter-home-3..8.png` is what set the real number; `Miss.mark` did land on `0.30`. */
export const CLIPS = {
  Idle:  { loop: true,  mark: null, keys: [ /* stage 2 */ ] },
  Swing: { loop: false, mark: 0.22, keys: [ /* stage 2: matches batter-home-3..8 */ ] },
  Miss:  { loop: false, mark: 0.30, keys: [ /* stage 2: Swing with a higher, later barrel */ ] },
  Set:   { loop: true,  mark: null, keys: [ /* stage 3: matches Pitcher-home-1 */ ] },
  Pitch: { loop: false, mark: 0.80, keys: [ /* stage 3: matches Pitcher-home-2..4 */ ] },
};
```

Pose authoring is done by rendering, never by imagination. Stage 2 and 3 use `render-actor.mjs`
(3.8) to draw the 3D figure at a given clip time beside the sprite frame it must match and iterate
until the silhouettes agree: same lean, same arm height, same leg spread, same bat angle. The
sprite frames are the target; the numbers in `CLIPS` are whatever makes the pictures agree.

The keyframe timings that the ENGINE needs (these are fixed, not tuned):

| Clip | What must be true |
|---|---|
| `Swing` | `mark` = the contact pose (sprite frame 5). Frames 3..8 in the sprites span 0..200 ms at the UI's `SWING_TIMELINE`; the clip is authored at its own natural length (say 0.6 s) and actors.js sets `timeScale` so `mark` lands where the engine's contact instant is (80 ms after the swing decision today). Last keyframe holds (follow-through, sprite frame 8). |
| `Miss` | same shape as `Swing`, barrel a little higher and later so it reads as a whiff. May start as a copy of `Swing`. |
| `Pitch` | `mark` = the release pose (sprite frame 3). Authored so that leg lift (frame 2) is about 45% of the way to the mark. actors.js sets `timeScale` so `mark` lands at exactly `WINDUP_MS` (1400 ms) after the clip starts, which is R1. The follow-through (frame 4) is the clip's own tail. |
| `Idle` / `Set` | loops of 2 to 3 s, a breathing bob and a small weight shift, small enough that the figure reads as still in a screenshot. |

### 3.5 `actors.js` (stage 1 skeleton, stages 2 to 4 fill it): the WebGL layer

One class, no engine knowledge. It owns a second canvas over the painted field and the two
figures. `field.js` keeps painting the backdrop, the zone, the ball's trail and the overhead cut
on the 2D canvas underneath.

```js
// actors.js
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkinned } from './vendor/SkeletonUtils.js';
import { RIG, resolveRig } from './rig.js';
import { CLIPS, buildClip } from './poses.js';
import { onViewportResize } from '../../js/viewport.js';

const TEAM = { home: { jersey: 0xf4f1ea, accent: 0x1c2a4a }, away: { jersey: 0x1c2a4a, accent: 0xf4f1ea } }; // sampled from the sprite sets; stage 3 fixes the hexes and writes the per-skin colour-key tables (section 2.2)
const CROSSFADE_S = 0.15;
const DPR_CAP = 2;
// The bat, in fractions of the model's own height; tuned by eye in the dev screen (stage 3).
// Corrected against the real stage 2/3 build (2026-09-19): `pos` shipped as `[0, 0.24, 0]`, not
// `[0, 0, 0]` - a bat gripped at the model's own origin drew inside the hand with no visible
// barrel past contact; actors.js's own comment records the fix as "one number... fixed now
// because the sheet was unreadable without it."
export const BAT = { length: 0.48, knobR: 0.012, barrelR: 0.028, pos: [0, 0.24, 0], rot: [0, 0, 0], color: 0xc9a06a };

export class Actors {
  constructor(wrapEl) {
    this.wrapEl = wrapEl;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bb-actor-canvas';
    this.canvas.style.pointerEvents = 'none';
    wrapEl.appendChild(this.canvas);
    this.renderer = null; this.scene = null; this.camera = null;
    this.actors = { batter: null, pitcher: null };   // each: { root, bones, restQ, mixer, actions, current, heightWorld, side, mirrored }
    this.ball = null;
    this.ready = false;
    this._raf = 0; this._last = 0; this._running = false;
    this._offResize = null;
    this._w = 0; this._h = 0; this._cover = null;
    this._preserve = !!(globalThis.__bbTest);   // the test reads pixels back; nobody else pays for it
  }

  /** Create the renderer. Separate from the constructor so a missing WebGL context is a value the
   *  caller can branch on, not a throw during mount. Returns false when WebGL is unavailable. */
  initGL() {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true,
        powerPreference: 'low-power', preserveDrawingBuffer: this._preserve });
    } catch { this.renderer = null; return false; }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a7a3a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-300, 500, 400); this.scene.add(sun);
    // Orthographic, in CANVAS PIXELS: world (x, -y) is screen (x, y). Every position below is fed
    // straight from field.js's anchorPx(), so the figures cannot drift from the painted picture.
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -2000, 2000);
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);
    this._offResize = onViewportResize(() => { /* ui.js calls resize() with the real size */ });
    return true;
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    this._proto = gltf.scene;
    this._fileClips = gltf.animations || [];
    for (const role of ['batter', 'pitcher']) this.actors[role] = this._makeActor(role);
    this.ready = true;
  }

  _makeActor(role) {
    const root = cloneSkinned(this._proto);
    const bones = resolveRig(root);
    const restQ = {}; for (const k of Object.keys(bones)) if (bones[k]) restQ[k] = bones[k].quaternion.clone();
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const heightWorld = box.max.y - box.min.y;
    const footY = box.min.y;   // so the feet, not the origin, sit on the anchor
    // Recolour by team: clone the materials this actor touches so the two figures stay independent.
    root.traverse((o) => { if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); o.frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const [name, def] of Object.entries(CLIPS)) {
      if (!def.keys.length) continue;
      const clip = buildClip(name, def.keys, bones, restQ);
      const a = mixer.clipAction(clip);
      a.setLoop(def.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !def.loop;
      actions[name] = a;
    }
    const pivot = new THREE.Group();       // pivot carries position/scale/mirror; root carries facing
    pivot.add(root);
    this.scene.add(pivot);
    const actor = { role, pivot, root, bones, restQ, mixer, actions, current: null, heightWorld, footY, side: 'home', mirrored: false, shadow: null };
    actor.shadow = this._makeShadow(); pivot.add(actor.shadow);
    if (role === 'batter') this._attachBat(actor);
    return actor;
  }

  _makeShadow() {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; return m;   // scaled per actor in _place
  }

  _attachBat(actor) {
    const h = actor.heightWorld;
    const g = new THREE.CylinderGeometry(BAT.barrelR * h, BAT.knobR * h, BAT.length * h, 12);
    const bat = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: BAT.color, roughness: 0.6 }));
    bat.position.set(BAT.pos[0] * h, BAT.pos[1] * h, BAT.pos[2] * h);
    bat.rotation.set(BAT.rot[0] * Math.PI / 180, BAT.rot[1] * Math.PI / 180, BAT.rot[2] * Math.PI / 180);
    actor.bones.handR.add(bat); actor.bat = bat;
  }

  /** Called by ui.js from _sizeCanvas with the 2D canvas's CSS size and field.js's plateCover(). */
  resize(w, h, cover) {
    if (!this.renderer) return;
    this._w = w; this._h = h; this._cover = cover;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.camera.left = 0; this.camera.right = w; this.camera.top = 0; this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
    this._placeAll();
  }

  /** anchor {x,y} in canvas px (feet), heightPx the figure's on-screen height. */
  _place(actor, anchor, heightPx, facingRad) {
    const s = heightPx / actor.heightWorld;
    actor.pivot.position.set(anchor.x, -anchor.y, actor.role === 'batter' ? 10 : 0);
    actor.pivot.scale.set(actor.mirrored ? -s : s, s, s);
    actor.root.position.y = -actor.footY;
    actor.root.rotation.y = facingRad;
    actor.shadow.scale.set(actor.heightWorld * 0.22, actor.heightWorld * 0.10, 1);
    actor.shadow.position.y = 0.5;
  }
  _placeAll() { /* stage 4: ui.js supplies anchors via setBatter/setPitcher; re-place both with the last values */ }

  setBatter({ side, bats, aimX, anchor, heightPx }) { /* stage 4: recolour, mirror on 'L', place at anchor + aim shift, facing */ }
  setPitcher({ side, throws, anchor, heightPx }) { /* stage 4 */ }

  /** Play `name` on `role` so that the clip's mark lands `markAtMs` from now (0 = seek straight to the mark). */
  play(role, name, { markAtMs = null } = {}) {
    const actor = this.actors[role]; const a = actor && actor.actions[name];
    if (!a) return;
    const def = CLIPS[name];
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    if (def.mark != null && markAtMs != null) {
      if (markAtMs <= 0) { a.time = def.mark; a.timeScale = 1; }
      else a.timeScale = def.mark / (markAtMs / 1000);
    } else a.timeScale = 1;
    if (actor.current && actor.current !== a) actor.current.crossFadeTo(a, CROSSFADE_S, false);
    a.play(); actor.current = a;
  }
  idle(role) { this.play(role, role === 'pitcher' ? 'Set' : 'Idle'); }

  setBall(b) { /* stage 4: {x, y, r} in canvas px from field.js plateBallPos, or null to hide */ }

  start() { if (this._running) return; this._running = true; this._last = performance.now(); const tick = (now) => { if (!this._running) return; const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now; for (const a of Object.values(this.actors)) if (a) a.mixer.update(dt); this.renderer.render(this.scene, this.camera); this._raf = requestAnimationFrame(tick); }; this._raf = requestAnimationFrame(tick); }
  pause() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; }
  resume() { if (this.ready) this.start(); }

  dispose() {
    this.pause();
    if (this._offResize) this._offResize();
    for (const a of Object.values(this.actors)) if (a) { a.mixer.stopAllAction(); a.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); }); }
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss(); }
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.renderer = null; this.scene = null; this.ready = false;
  }
}
```

Facts to keep straight while filling it in:

- A negative `scale.x` on the pivot mirrors the figure and three.js flips face winding itself
  (`WebGLRenderer` checks the world matrix determinant), so no material change is needed.
- `frustumCulled = false` on skinned meshes: their bounding spheres are computed from the bind
  pose, and a swing takes the bat outside it.
- `mixer.update(dt)` with `dt` clamped to 50 ms so a tab that was hidden does not fast-forward a
  clip past its mark on the first frame back.
- Recolouring is the colour-key remap of section 2.2: `skinTexture(skinName, side)` loads
  `models/skins/<skin>.png` once, remaps the keyed colours for `side` on a 2D canvas, caches the
  `CanvasTexture` per (skin, side), and assigns it as `material.map` on the actor's cloned
  material (`material.color` stays white so the texture shows true). `flipY` stays at three's
  default (section 2.1, TEXTURE RULE). A tint on the whole texture is NOT acceptable: it would
  colour skin and hair.
- The CSS: `.bb-actor-canvas { position: absolute; inset: 0; z-index: 2; pointer-events: none; }`
  with `.bb-field-canvas` at `z-index: 1` and `.bb-pop` staying at 3, in `baseball/css/baseball.css`.

### 3.6 `ui.js` integration (stage 4)

Every write to `state.pitcherFrame` / `state.batterFrame` becomes an `actors` call. The mapping,
which must preserve R1 and R2 exactly:

| Today | Becomes |
|---|---|
| `_stepWindup` sets frame 1 at 0, 2 at ~55%, 3 (release) at `WINDUP_MS` | `actors.play('pitcher', 'Pitch', { markAtMs: WINDUP_MS })` at the start of `_stepWindup`; the awaits inside stay exactly as they are |
| frame 4 at +120 ms after release | nothing; the clip's own follow-through |
| `HumanAgent.decidePitch`: frames 1/2 during the hold, 3 on release, 4 after | `Set` during the hold; at the human's release `actors.play('pitcher', 'Pitch', { markAtMs: 0 })` (seek to the mark: the hand is forward at the instant the ball leaves) |
| `_startSwingTimeline` frames 3..8 over 0..200 ms, contact at 80 ms | `actors.play('batter', hit ? 'Swing' : 'Miss', { markAtMs: 80 })`; the swing decision and the popup timing are untouched. `hit` is not known at the press; play `Swing` at the press and let a miss be the same swing (the ball simply passes), which is what the sprites do today |
| charge loop frames 1/2 | `Idle` (no half-cock pose exists; inventing one is a feature not discussed) |
| `_settleAtBat` / a new at-bat resetting to frame 1 | `actors.idle('batter')` + `actors.setBatter(next)` where the fade swap runs today |
| `_drawStaticField`'s `batterFrame`/`pitcherFrame` opts | dropped; `drawPlateView` gets `opts.noFigures = true` and skips the sprite figures (stage 5 deletes the sprite code) |

Plus:

- `_sizeCanvas` calls `actors.resize(w, h, plateCover(w, h))` after sizing the 2D canvas
  (`plateCover` and `anchorPx` become exports of `field.js`).
- `setBatter` is called with `{ side, bats, aimX: this.state.batterAimX, anchor: anchorPx(bats === 'L' ? nearBoxRight : nearBoxLeft, cover), heightPx: h * NEAR_BATTER_HEIGHT_FRAC }`
  on every pad move in the batting state and at every new at-bat; `setPitcher` with the mound
  anchor and `h * MOUND_PITCHER_HEIGHT_FRAC` at every pitcher change. The aim shift is
  `aimX * BATTER_AIM_TRAVEL_FRAC * cover.drawW`, same sign as today.
- The ball: `_animatePitchFlight` and `decidePitch`'s flight loop call `actors.setBall(plateBallPos(...))`
  every frame instead of `drawPlateBall`; the trail stays on the 2D canvas via `drawPlateBall`
  with `alpha` as today, or is dropped if it reads wrong under the 3D ball (report which). At the
  crossing the ball hides. The overhead cut is untouched.
- Overhead state: `actors.pause()` and `canvas.style.display = 'none'` while the overhead cut is
  on screen; `resume()` and `display = ''` when the plate view returns.
- `visibilitychange`: hidden -> `pause()`, visible -> `resume()`. `destroy()` -> `dispose()`.
- If `initGL()` returns false (no WebGL), the sprite path keeps running unchanged. Stage 5 removes
  the sprite path only if the orchestrator says so after seeing the WebGL failure rate is nil.
- Loading: `actors.load('./models/player.glb')` starts when Baseball mounts (setup screen). Play
  awaits `actors.ready`; while waiting the Play button is disabled with `t('load_model')` on Line 1
  (add `load_model` to `strings.js` EN + ES). On rejection: a load-error screen in the Boggle
  pattern with `load_error` copy, translated. Never a silent empty field.

### 3.7 The dev screen (stage 1, extended in stages 2 and 3)

`_openFrameCheck` (dev-profile only) becomes the 3D check: both figures at their real anchors over
the real backdrop, a row of buttons that play each clip, a scrubber that seeks the current clip to
a time (so a pose can be compared against a sprite frame on the phone), and for the bat four
nudge buttons per axis whose current values print to the console as a `BAT` literal to paste back.
Nothing on it is reachable without the dev profile.

### 3.8 `render-actor.mjs` (repo root, stage 1; dev tooling)

The pose-authoring loop's instrument. Serves the repo (needs `node server.mjs` up), opens a
minimal page that imports `actors.js` directly, loads a given glb, places one actor at a given
height, plays a clip to a given time, and writes a PNG. Options:

```
node render-actor.mjs --model <path-or-url> --clip Swing --t 0.30 --height 400 --facing 80 --out x.png
node render-actor.mjs --model ... --clip Swing --sheet 0,0.1,0.2,0.3,0.4,0.5,0.6 --beside reference/baseball/batter-home-3.png,...  --out sheet.png
```

`--sheet` renders several times and lays them in one row; `--beside` puts the named sprite frames
under them, scaled to the same height, so the agent (and the orchestrator) compare silhouettes in
one picture. Chromium flags: `['--no-sandbox', '--use-gl=swiftshader']`; `preserveDrawingBuffer`
on; read back via `canvas.toDataURL()`. Runs from the repo root.

### 3.9 `test-baseball-actors.mjs` (repo root, stage 1, extended per stage)

Two halves, and the header says which is which.

1. **Node, no browser** (add to `run-all-tests.mjs`): `readGlb('baseball/models/player.glb')`
   parses; not Draco; under 4 MB; every `RIG_REQUIRED` name is a node in the file; the four
   skin PNGs in section 2.1 exist and are 1024x1024; `CLIPS.Swing` and `CLIPS.Pitch` have keys and a `mark`
   inside `[0, lastKey.t]`; `buildClip` over a fake bones/restQ object yields one quaternion track
   per bone used and the right duration. Structural checks on `ui.js` once stage 4 lands:
   `actors.dispose()` inside `destroy()`; `visibilitychange` handled; `plateCover`/`anchorPx`
   exported from `field.js`. **Corrected against the real stage 4 build (2026-09-19)**: "no
   `state.batterFrame`/`state.pitcherFrame` writes remain" was NOT checkable at stage 4 - those
   writes are the required sprite-path fallback (section 3.6's own "if `initGL()` returns false,
   the sprite path keeps running unchanged"), and cannot work without them, and
   `test-baseball-device.mjs`'s r2-cadence probe watched `state.pitcherFrame` reach 3 as its
   release signal until stage 5. The literal zero-writes check only becomes true, and is only
   checked, once stage 5 deletes the sprite path (section 3.10) and replaces the release signal
   with `actors.play('pitcher', 'Pitch', ...)`'s own call time + `markAtMs`.
2. **Chromium under swiftshader** (SKIPs without playwright-core; NOT in `run-all-tests.mjs`):
   mount Baseball in the real hub at 393x852 dpr3 with `window.__bbTest = true` set in an init
   script, start Quick Play, wait for `actors.ready`, then: the actor canvas exists and sits above
   the field canvas; a pixel block around the batter anchor is non-transparent in idle; a second
   read-back 150 ms into `Swing` differs from the idle read-back; the `r2-cadence` numbers from
   `test-baseball-device.mjs` still hold (re-run that suite; do not reimplement it); after
   `destroy()` the actor canvas is gone and `renderer.info` is not reachable.

### 3.10 Service worker and docs (stage 5)

- `baseball/models/player.glb` and `baseball/models/skins/*.png` into `ASSETS` (plain REST tier, see
  section 3.6's loading note). `node test-sw-strategy.mjs`.
- Delete the sprite path: `drawBatterFigure`, `drawPitcherFigure`, `FRAME_Y_OFFSET_FRAC`,
  `PITCHER_FRAME_Y_OFFSET_FRAC`, `drawFrameCheck`, `SWING_TIMELINE`, `_startSwingTimeline`,
  `_schedulePitcherFollowThrough`, the `batterFrame`/`pitcherFrame` state, the 32 frame images
  `baseball/img/batter-*.webp` / `pitcher-*.webp` and their `ASSETS` lines. Art is not player data.
  The PNG originals stay in `reference/baseball/`.
- `baseball/CLAUDE.md`: a new top entry in the repo's voice with the decision, the model and its
  licence, the anchor/ortho mapping, the mark-time rule, the hand rule, what stays 2D, and the
  measured cadence. Root `CLAUDE.md`: the Baseball row and a
  `test-baseball-actors.mjs` row in the tooling table, plus `glb-info.mjs` and `render-actor.mjs`.
- The orchestrator bumps `CACHE`, runs `validate-sw-assets.mjs`, pushes, PRs, merges, verifies
  the Pages run, and tells Matt it is live.

---

## 4. Stages

Each stage is one sub-agent run. The model column is the orchestrator's default; it escalates
when a stage's pictures fail review twice.

| Stage | Owns | Builds | Checks that must pass | Model |
|---|---|---|---|---|
| **1 Foundation** (done) | `baseball/js/vendor/*`, `glb-info.mjs`, `rig.js`, `actors.js` (skeleton as in 3.5, `load`/`resize`/`_place`/`start`/`pause`/`dispose` working, `play` working with any clip the FILE carries), `render-actor.mjs`, `test-baseball-actors.mjs` (node half + the load/dispose browser half), CSS for the actor canvas, the dev screen (3.7) mounted from `_openFrameCheck` showing both figures idle at the real anchors over the real backdrop | Built against the scaffold; verified against `player.glb` by the orchestrator | vendor import check (3.1); `node glb-info.mjs baseball/models/player.glb` prints the rig; `node test-baseball-actors.mjs`; `node render-actor.mjs` produces a PNG with a visible figure; `node test-game-conventions.mjs`; `node test-baseball-device.mjs` unchanged; no console error on mount | Sonnet |
| **2 The swing** | `poses.js` `Idle`, `Swing`, `Miss`; the batter's facing constant; the dev screen's clip buttons and scrubber | Pose keys matched to `batter-home-1..8.png` with `render-actor.mjs --beside` | A sheet, 3D over sprite, for frames 1 to 8 where every frame's silhouette agrees in lean, arm height, leg spread and bat angle (the orchestrator judges); `node test-baseball-actors.mjs` | Sonnet, Opus after two failed reviews |
| **3 The pitch, the bat, the colours** | `poses.js` `Set`, `Pitch`; `BAT` offsets; `TEAM` hexes and the recolour; the pitcher's facing | Matched to `Pitcher-home-1..4.png`; bat in both hands through the whole `Swing`; home white / away navy | Sheets as stage 2 for the pitch (4 frames) and for the swing WITH the bat (8 frames); a still of home and away side by side; `node test-baseball-actors.mjs` | Sonnet, Opus after two failed reviews |
| **4 The switch** | `ui.js` (3.6), `field.js` exports + `noFigures`, `strings.js` `load_model`, CSS, the `setBatter`/`setPitcher`/`setBall` bodies in `actors.js` | The live play screen on 3D, ball from the hand, load state, pause/resume, dispose | `node test-baseball-device.mjs` with r2-cadence inside 6219-6225 ms; `node test-baseball-actors.mjs` both halves; `node test-visual.mjs baseball` (open the sheet); `node check-no-scroll.mjs baseball`; `node test-game-conventions.mjs`; `node test-i18n-strings.mjs`; a screen recording substitute: 10 stills 100 ms apart through one pitch and one swing | Sonnet |
| **5 Delete, document, ship** | sprite-path deletion (3.10), `sw.js` `ASSETS`, `baseball/CLAUDE.md`, root `CLAUDE.md`, `HANDOFF-BASEBALL-3C.md` marked superseded by this file | | `node validate-sw-assets.mjs`; `node test-sw-strategy.mjs`; every stage 4 check again; `grep -c "batterFrame" baseball/js/ui.js` is 0 | Sonnet |

Stage 1 is done (commit 5bc2694, against the scaffold; `rig.js` now carries the Kenney names). Stages 2 to 5 run against `baseball/models/player.glb`.

---

## 5. The report every stage ends with

In this order, and nothing before it:

1. Stage number and the commit hash(es) on the branch.
2. Every check in the stage's row, each with its exact output line (pass/fail/not run and why).
3. Absolute paths of the pictures, one line each saying what the picture shows.
4. Anything in this document that was wrong against the real files, quoted, and what you did
   instead. Silence here means "the document was right".
5. Requests for other stages' files (rule 2).
6. Facts the next stage needs that are not in this document yet (a bone name, a measured height,
   a material name), as a list the orchestrator can paste into section 2.

## 6. Out of scope for every stage

Fielders, runners, a catcher, a glove, a crowd, any camera motion, shadow maps, Draco, a swing
cue, the Career/Quick Play setup screen (phase 4, held by Matt), any change under
`baseball/js/engine/`, any change to `settings.js` timings, the ring, the strip, the HUD, the
popup. If you think one is needed, say so in the report and build nothing for it. **Stage 8
(section 8) is the one exception: it owns the ring, the strip and the popup by Matt's request.**

---

## 7. Stages 6 and 7: motion and flow (2026-09-19, after Matt's recordings of v857 and v858)

Matt, on two screen recordings of the shipped 3D build: *"They look way too much like just flat
images (because they are)... Timing is a huge issue as well, timing of everything. Nothing really
makes sense."* Measured frame by frame (every frame of both clips diffed; the live game probed
for clip clocks and bone positions), the causes, each with its fix and its stage:

| # | Measured | Fix | Stage |
|---|---|---|---|
| 1 | The batter's `Idle` loops but moves no bone: hand world position constant to the pixel for the whole loop | A visible idle: weight shift foot to foot, bat waggle, head turn to the pitcher. Hand travel at the batter's real size (214 px tall) at least 8 px | 6 |
| 2 | The pitcher's throwing hand travels ~20 px across the whole `Pitch` at his real size (47 px tall), no visible leg kick or body turn; the first 30% of the clip moves nothing | An exaggerated, game-style delivery: leg kick to hip height, full body turn, the arm over the top. At 47 px: hand path length at least 45 px with at least 20 px vertical; front foot lift at least 10 px; motion from the first keyframe | 6 |
| 3 | After the throw the pitcher holds the follow-through for ~5.5 s until the next `Pitch` snaps him back; there is no return to set | A `Set` return: cross-fade back to `Set` 400 ms after the ball crosses (both the CPU's and the human's pitch) | 7 |
| 4 | On a ball in play the cut to the overhead comes 1 to 2 frames after contact and `Swing` starts with a 150 ms cross-fade, so the swing is never seen on contact | `Swing` and `Miss` start with NO cross-fade; the plate view holds 400 ms after contact (swing follow-through, 3D ball leaving up and away from the bat) before the cut | 7 |
| 5 | The overhead is a still picture for ~5.5 s (0.7 s flight, then the 1.8 s result beat and 3.0 s between beat on top of it) | Overhead: flight 1.0 s, marker hold 1.0 s, then cut BACK to the plate view where the rest of the between beat runs (batter idle, pitcher to set). The verdict-to-next-release cadence stays 6.2 s (R2): 0.4 hold + 1.0 flight + 1.0 marker + 2.4 plate + 1.4 wind-up | 7 |
| 6 | On a hit the batter appears over the overhead: a slider touch during the cutaway redraws the plate view underneath and re-shows the layer (v858 fixed one path only) | One `this._cutawayUp` flag set by the cutaway and cleared only when the flow itself returns to the plate view; `_drawStaticField()` is a no-op while it is set | 7 |
| 7 | ~1.1 s of flat green after Play on the phone, and the first wind-up starts under it | Preload `plate.webp` at Baseball's mount (the setup screen), and the first wind-up waits until the plate picture has painted once | 7 |

Timings above are Matt's numbers ("Sounds good", 2026-09-19). `settings.js` is untouched: the 4.8 s
of result + between is re-partitioned by `ui.js`, not changed.

**Stage 6 (Opus): motion.** Owns `poses.js` and the facing constants only. Deliverables: (a) each
clip rendered at 15 fps at its REAL on-screen height (batter 214 px, pitcher 47 px, plus 4x
enlargements for review) as one sheet per clip; (b) the measured numbers in the table, from a
new chromium check in `test-baseball-actors.mjs` that plays each clip and samples bone world
positions at the real heights; (c) the batter sheet against `batter-home-1..8.png` and the
pitcher sheet against `Pitcher-home-1..4.png` still agree at the marks (contact, release). Bigger
than the sprites is the point; the sprites are the pose reference, not the motion budget.

**Stage 7 (Sonnet): flow.** Owns `ui.js`, `actors.js`'s `play()` fade option and a `toSet()`
helper, `test-baseball-device.mjs` and `test-baseball-actors.mjs`'s cutaway probe. Deliverables:
the cutaway state flag with the probe extended (a pad move during the cutaway must NOT re-show
the layer; the plate view must return on its own before the next wind-up); the contact hold; the
re-partitioned overhead; the set return; the preload; r2-cadence unchanged at 6.2 s; ten stills
100 ms apart through one ball in play on the real play screen showing swing, ball leaving, cut,
flight, marker, return to plate, pitcher to set.

## 8. Stage 8: the pitch meter, the verdict, and the overhead (2026-09-20, after Matt's recordings of v859)

Matt, on two recordings of v859: *"It's better, but it still needs improvement. It's not obvious if
something is a ball or a strike. After contact, it goes to the Birds Eye view, but you can't see
where the ball goes or lands or anything at all. It tells me the type of pitch before it's even
pitched. What does 'Hung' mean when I'm pitching? And that pitch meter thing starts with no
warning. I should tap it to start it then tap again to stop it. And even if it's perfect, it
doesn't show perfect. It's always like right past the perfect zone thing."* Every frame of both
clips was read; the causes, each with its fix:

| # | Measured | Fix |
|---|---|---|
| 1 | `ring.js` draws the Nice zone centred at 12 o'clock, which is 0.667 of the fill sweep (`START` = 4 o'clock, a full 360 deg lap = `meterTime`). `pitch.js` scores Nice at hold 0.88 to 1.00 of `meterTime` (`1 - niceWidth` to 1). So a release inside the drawn zone is an ordinary pitch, and a release the engine calls Nice draws its marker about 80 deg PAST the zone. Present since the ring shipped | The fill sweeps from `START` (4 o'clock) clockwise to 12 o'clock and THAT is 1.0 of `meterTime`; the Nice zone is the last `niceWidth` of that sweep, ending exactly at the top; `niceWidth` is read from `SETTINGS.FEEL.engine`, never a second literal. The hang grace (1.0 to `1 + HANG_GRACE_FRAC`) continues clockwise past the top in the hung colour, then drains. A node test asserts, for a sweep of hold times, that `ring.js`'s zone contains the marker angle exactly when `flyPitch` reports `wasNice` |
| 2 | The meter starts filling by itself the instant the pitching turn begins; the player's one tap ENDS it | Tap to start, tap to release. Ring idle (with the Nice zone ticks and diamond visible so the target is known) until the first `touchstart`/`pointerdown` on the button; the fill starts on that event; the SECOND down event releases. The pitcher's wind-up plays during the fill: `play('pitcher','Pitch',{markAtMs: meterTime, holdAtMark: true})`, so the delivery reaches the release keyframe at the top of the meter and HOLDS there; the release tap resumes the clip from the mark (`actors.release('pitcher')`). A release before the mark seeks to the mark and plays on (the existing `markAtMs: 0` path). Nothing else in the beat changes: the ring returns to idle when the next pitching turn starts |
| 3 | A take's Ball/Strike goes only to the 13 px `line1`; the big word is reserved for the timing words. The 3D ball is hidden the instant it crosses, so it is never seen inside or outside the box | Ball, Strike, Foul (a take, a swinging miss's strike, a foul) become big words through `_showPop`, with the SAME shapes the strip already uses (● ball, ■ strike; foul keeps the word alone), never colour alone. The crossing ball HOLDS at its crossing point (`setBall` left visible) for `CROSSING_HOLD_MS` = 600 ms after every crossing that is not a ball in play, then hides. A swing's timing word still wins on a swing (a miss reads Early/Late, as before) |
| 4 | Overhead: the ball is `drawBall(..., baseRadius 7)` times the picture scale, about 2 px on a phone, straight line, no height, no trail; the landing marker is an 8 px disc with 10 px text | Overhead flight drawn to be SEEN: ground shadow on the straight path plus the ball lifted on a parabola whose apex is `min(0.22, distanceFt / 1800) * canvasH` for a fly ball or line drive and `0.03 * canvasH` for a grounder (`battedKind`), radius 9 px at canvas scale with a 2 px dark outline, a fading 6-sample trail; landing marker radius 14 px with 13 px bold text (1B/2B/3B, HR gold, OUT red X at 14 px arms), and a ring that pulses outward twice during `MARKER_HOLD_MS`. Both drawn through the existing `project()` |
| 5 | While batting, `decideSwing` pushes the incoming pitch into `state.lastPitches` and repaints the strip BEFORE the wind-up, so the tile (type, mph AND the ●/■ result mark) is on screen before the pitch is thrown | The strip tile is pushed and painted at plate crossing, from the `count`/`atBatEnd` handlers (the same moment Line 2 already paints), never at the decision |
| 6 | "Hung" is the word for a release past the meter's fill (slow, straight, drifts to the middle); nobody knows the word | The word is "Late" with the ▶ chevron, the same vocabulary batting already teaches (EN `v_hung: 'Late'`, ES `v_hung: 'Tarde'`; the key stays `v_hung`, rule 5 for strings is not needed but there is no reason to churn the key). Nice ★ stays for the power pitch; an ordinary release shows no word, as now |

**Stage 8 (Sonnet).** Owns `ring.js`, `ui.js` (HumanAgent.decidePitch, the 'count'/'atBatEnd'
handlers, `_animateBattedBall`, `_animatePitchFlight` and the human pitch's `finishFlight`,
`decideSwing`'s strip push), `actors.js` (`holdAtMark` on `play()` and a `release(role)`),
`field.js` (`drawBall` arc/trail, `drawLandingMarker`), `strings.js`, a new `test-baseball-ring.mjs`
(node, in `run-all-tests.mjs`), and `test-baseball-device.mjs` (a tap-tap pitching probe). Nothing
in `settings.js` changes. Deliverables: (a) the ring/engine agreement test, born red against the
shipped `ring.js`; (b) a device probe that drives the human pitching turn with two taps and asserts
the ring was idle before the first tap, filling after it, and that the release came on the second
tap (the `actors.play('pitcher','Pitch')`/`release` call), with the pitcher's hand held at the
release pose between the top of the meter and the second tap when the tap is late; (c) stills:
the ring at 0.5, 0.88, 0.94, 1.0 and 1.15 of the fill with the release marker; ten stills 100 ms
apart through one ball in play on the overhead showing ball, shadow, trail and marker; the plate
view 300 ms after a called ball and a called strike with the ball held at its crossing point and
the big word up; the batting strip before and after a crossing; (d) r2-cadence unchanged at 6.2 s;
(e) every suite named in section 5 green.

## 9. The clone: rebuilding Baseball around the reference game (2026-09-20)

Matt, with a recording of Baseball 9's tutorial: *"does exactly what I want our game to look like...
Ours should be as close to a clone of this game as possible."* `docs/BASEBALL-REFERENCE-B9.md` is the
measured catalogue of that recording and the gap list; read it first. Decisions, all Matt's
("Yes go", 2026-09-20): **portrait** stays; the field becomes **real three.js geometry** with three
cameras; the controls become **tap-then-drag-during-wind-up** with **2-D cursors**; **our own art
and words**, nothing lifted from the recording. Stages R1 to R4, in order, each shipped and
reviewed on its own.

### R1: the field in 3D, three cameras, actors in world units

**World.** Feet. Home plate's rear point at the origin. `+x` toward first base, `+y` up, `-z`
toward the mound and centre field (three.js cameras look down `-z`). The engine's batted-ball
`(xFt, yFt)` (`+y` toward centre) maps to world `(xFt, 0, -yFt)`. The rubber is at `(0, 0.83, -60.5)`
(mound crown 10 in above the grass, a shallow cone of radius 9 ft); bases at 90 ft along the
lines; the strike zone is a vertical rectangle in the plane `z = 0.7` (the front of the plate),
width 1.417 ft (17 in) with the engine's `x` in `[-1, 1]` mapping to `[-0.708, +0.708]` ft, bottom
1.6 ft, top 3.4 ft. A right-handed batter stands with his feet centred at `(-2.6, 0, 0.4)`, facing
`+x`; left-handed mirrors `x` (the existing mirror flag). Pitcher's feet on the rubber, facing
`+z`. Catcher crouched at `(0, 0, 5.5)` facing `-z`, umpire standing at `(0.8, 0, 8)` in dark
clothes: both are static figures for R1 (a `Crouch` loop for the catcher goes in `poses.js`, one
keyframe pair, no motion floor; the umpire uses `Idle`). Fielders and runners are R3.

**Geometry (all generated in code, no image files; low triangle counts, one material each).**
Grass: a plane 900 x 900 ft with a procedural canvas texture (two greens in 12 ft mowing stripes
parallel to the foul lines' bisector). Infield dirt: the 90 ft diamond's skin as a flat shape
(base paths 6 ft wide plus the dirt arc of radius 95 ft from the mound, the standard shape),
brown; grass inside the diamond. Home plate area: a 26 ft dirt circle. Mound: the cone. Foul
lines, batter's boxes, base bags, the plate: white geometry 0.02 ft above the ground. Fence: a
wall 8 ft high following each league's five-point `FIELD[league].fenceFt` shape through
`fenceFtAt` sampled every 2 deg, blue-green with a yellow top rail. Behind it, a stadium ring:
three stepped tiers of stands 12 ft deep each rising to 40 ft, from foul pole to foul pole plus
30 deg behind the plate, faced with a procedural crowd texture (random dots of six colours on
dark grey). Sky: a large half-sphere with a vertical gradient (light horizon to blue zenith), no
clouds. Two lights: hemisphere plus one directional with no shadow maps (the existing blob
shadows under the actors stay). Everything sized off the league's `fieldScale` where the engine
already scales.

**Cameras (perspective, aspect = the field canvas's portrait aspect, fov 50).**
- `batterCam` (batting): position `(1.5, 5.5, 13)`, look at `(0, 3.2, -30)`. The batter fills
  about 45% of the frame height, right of centre; the mound sits just above the middle of the
  frame with the pitcher about 8% tall. Match the reference's composition, not its numbers.
- `pitcherCam` (pitching): position `(-3.5, 7, -76)`, look at `(0, 2.5, 0)`. The pitcher is about
  55% tall, left of centre, back to the camera; catcher and batter about 30% at centre-right with
  the zone box drawn in the world between them.
- `chaseCam` (ball in play, R3 finishes it; R1 uses it for the batted-ball flight): follows the
  ball at an offset `(0, 12, +28)` from it, smoothed with a 0.15 lerp per frame, looking at the
  ball. For R1 the batted ball flies a world parabola (apex from `distanceFt` as stage 8's rule,
  in feet: `apexFt = min(120, distanceFt * 0.35)` for fly/line/popup, 4 ft for a grounder) to
  its landing point over `FLIGHT_MS`; the landing marker is a flat disc in the world at the
  landing point (14 in radius, the stage 8 colours, pulse kept), and the plate view returns
  after `MARKER_HOLD_MS` exactly as now. Home run: the ball clears the fence and the marker sits
  where it lands beyond it.

**Actors.** `actors.js` drops the orthographic canvas-px camera and anchors: `place(role, {pos,
facingRad, heightFt})` puts a figure at a world position with its feet on the ground and scales it
to `heightFt` (6.0 for every figure; the model's own height units are already measured). Ball:
`setBall({x, y, z})` in feet, radius 0.36 ft (bigger than a real ball on purpose, the reference
draws it large). `handWorldPx` becomes `handWorld(role)` returning feet. The pitch flight is a
straight line from the pitcher's hand at release to the crossing point `(zoneX, zoneY, 0.7)` over
`timeToPlateS`, with the presentation-only lateral bend (`pitchBendFrac`) applied to `x` and a
small gravity sag on `y` (0.8 ft over the flight); no pinhole law, no `plateBallPos`. Everything
the old plate camera measured in px (batter aim shift, ball radius) is gone.

**Rendering.** One WebGL canvas (the existing actor canvas) draws the whole scene; the 2-D field
canvas keeps only the strike-zone-box and cursor overlays, drawn by projecting world points
through the active camera (`camera.project`). `_drawStaticField()` becomes `_setCamera(which)` +
a redraw of the overlay; the paintings, `plateCover`, `projectOverhead`, the homography and the
sprite-era anchors are deleted with their tests. `plate.webp`, `overhead.webp` and
`ball-sheet.webp` are deleted from disk and from `sw.js`'s `ASSETS` list (the ONLY edit to
`sw.js` this stage; `CACHE` is the orchestrator's). Render-rate cap unchanged (`isSoftGL()`).

**Not in R1.** No control changes (the meter, pads and beats stay exactly as v860); no fielders,
runners, chase logic beyond the offset follow; no verdict re-layout; no bunt/power modes. R1 is
"the same game, in a real stadium, seen from the reference's cameras".

**Deliverables.** (a) Stills at 393x852 mounted in the hub: batting idle, pitching idle, the
pitch mid-flight from each camera, a batted ball mid-chase, the landing marker, a home run
clearing the fence, in light mode. (b) `test-baseball-device.mjs`: the plate-flight and homography
probes replaced by world-space ones (crossing lands in the zone rectangle; `x = +1/-1` lands on
the zone's edges; the ball's projected radius grows monotonically toward the batter camera; the
fence wall passes through each league's five named distances within 1 ft); r2-cadence and the
tap-tap probe unchanged and green. (c) `test-baseball-actors.mjs`: motion floors re-measured
through the batter camera's projection at the on-screen sizes R1 produces (report the new px
numbers; floors scale with the new sizes, ratios kept). (d) The frame time on the container's
software renderer for each camera, and the scene's triangle count. (e) All suites in section 5
green, `validate-sw-assets.mjs` clean.
### R1 record (shipped v861, 2026-09-20)

Where the R1 spec was wrong against the real files, from the stage's report: the batter and the
zone cannot both be centred (the zone is, the righty lands at 24% across); the pitcher camera's
55% and 30% figures were incompatible at fov 50 (pitcher 54%, batter 9%); the doc's camera x
signs put both figures on the wrong side (pitcher camera flipped to x = -2.4); the umpire at
z = 8 filled the batter camera (he is hidden from that camera; catcher moved to z = 7.8, umpire
to 10.2); the true zone box is 9 px wide from the pitcher camera (drawn box floored to 13% of
the canvas, the ball never scaled); `fieldScale` never scaled the diamond in the engine, so the
diamond is regulation at every league; the apex rule `min(120, 0.35 * distanceFt)` is ~40% too
high and puts the wall out of the chase frame on a home run (R2 halves the coefficient); the
chase offset `(0, 12, 28)` drew a 5 px ball (now `(0, 10, 22)` with a ground shadow).

### R2: the controls, re-timed to the reference

Everything below replaces the design doc's section 12 and the meter (stage 8's ring geometry test
retires with it). The engine's timing window and contact-quality model stay; the zone and the aim
become 2-D.

**The zone is 2-D.** `pitch.js` gets `y` in `[-1, 1]` beside `x` (the engine's zone unit: 1 = the
zone's half height, 0.9 ft); a strike is `|x| <= 1 && |y| <= 1`. `swing.js`'s sweet spot is the
batting cursor's centre `(cx, cy)`; contact quality multiplies the existing timing quality by a
distance term `max(0, 1 - d / cursorR)` where `d` is the 2-D distance from the crossing point to
the cursor centre and `cursorR` is the mode's circle radius (contact 0.55, power 0.35 zone units).
The horizontal offset adds to pull/opposite direction exactly as `aimX` did; the vertical offset
sets the batted-ball kind (ball above the centre by more than 0.3 = fly or pop, below by more
than 0.3 = grounder, between = line drive), replacing the sweet-spot centred/off-centre rule.
The charged swing (hold) is removed; POWER mode replaces it (exit velocity x1.12, circle 0.35).
CPU agents aim in 2-D with the same scatter model in `y` as in `x`. `sim-baseball.mjs` must run
and its scoreboard is pasted into `baseball/CLAUDE.md`, passing or not.

**Pitching.** Idle: pitcher on Set, the zone box drawn in the world at the plate through
`pitcherCam`, the control cursor (a ring with a crosshair) at the last aim. The strip shows the
pitch types with the readout mph. LEFT button = select pitch type (cycles) or tap a strip tile.
RIGHT = PITCH. Tap PITCH once: the wind-up plays (`Pitch` clip, mark at `PITCH_DRAG_MS` = 700 ms,
no hold) and the LEFT button becomes a 2-D pad: drag moves the control cursor over the zone
(travel x ±1.6, y ±1.4 units; the cursor moves 1:1 with the finger in pad units mapped to zone
units). For a breaking pitch a second, yellow point cursor sits at cursor + break vector (type x
pitcher hand, `BREAK_OFFSET[type]` in zone units, replacing STEER_MAX_OFFSET/steer samples) and
the ball ends there. At the mark the aim is sampled and the pitch scatters from it by the
existing skill-based `aimScatter` (Nice, hang, the meter and steering after release are all
deleted from settings, pitch.js, ui.js, ring.js's throw mode, and the design doc). The ball
flies `fastballMs` x `PITCH_TRAVEL_MULT` (fastball 650 ms). The verdict shows at the crossing.

**Batting.** Idle: batter in stance, the zone square and the mode's circle cursor drawn in the
world at the plate through `batterCam`. LEFT = change batting mode (CONTACT, POWER; BUNT I and
II stay locked wells as now). RIGHT = READY. Tap READY: the CPU wind-up plays (`windupMs` 1000)
and LEFT becomes the 2-D batting pad (drag moves the circle, travel ±1.5 units), RIGHT becomes
SWING. At release the pitch's TARGET marker (a small ring) appears at the pitch's final `(x, y)`;
for a breaking pitch it appears at the straight-line spot and slides to the final spot over the
flight, matching the ball's bend. Swing = one tap; timing is scored as now against the crossing.

**Batted-ball apex.** `_battedApexFt` becomes `min(80, distanceFt * 0.22)` for fly/line/popup, 4 ft for a grounder, so a home run's wall stays in the chase frame.

**Beats (FEEL.ui / FEEL.engine).** `fastballMs` 650, `windupMs` 1000, `resultMs` 1200,
`betweenMs` 800, `PITCH_DRAG_MS` 700. Pitch tap to next ready about 3.0 s; verdict to next
release about 3.0 s. r2-cadence's expected sum follows the constants, not a literal.

**Deliverables.** Stills: pitching idle with cursor, mid-drag with a breaking-pitch point cursor,
batting idle with the contact circle and the power circle, mid-flight with the target marker,
a breaking pitch's marker sliding. Probes: `pitch-drag` (tap, drag, release: the engine's `x, y`
equal the cursor within scatter=0 when the pitcher's accuracy is at cap), `target-marker`
(appears at release, ends at the pitch's `(x, y)`), `two-d-strike` (engine: `y = 1.2` is a ball
at `x = 0`). Engine tests updated for 2-D; sim-baseball scoreboard pasted.

### R2 record (shipped v862, 2026-09-20)

From the stage's report: the pop-up threshold (0.7 zone units above the cursor) sat outside the
CONTACT circle's own radius (0.55), so a pop-up could never happen; the thresholds are fractions
of the cursor radius instead (`flyOffsetFrac` 0.545, `popupOffsetFrac` 0.85). `game.js`'s
`previewsPitch` seam pre-rolls four draws now (two scatter axes, two knuckleball reads) so the
human's drawn pitch and the scored pitch are the same `flyPitch` call. `test-baseball-ring.mjs`
is deleted with the meter. Sim scoreboard after R2 is in `baseball/CLAUDE.md`: the league spread
compressed by 0.02 to 0.03 (Little League 0.904 against a 0.92 floor, Majors 0.516 against a
0.51 ceiling); CPU/CAPS/SKILL_EFFECT untouched, re-tuning is its own job.

### R3: fielders, runners, the chase, and the diamond widget

The nine fielders and the runners are the same Kenney rig at 6 ft, in the fielding team's colour.
Fielders stand at their positions (P on the rubber already; C already; 1B `(63, 0, -63)`, 2B
`(30, 0, -100)`, SS `(-30, 0, -100)`, 3B `(-63, 0, -63)`, LF `(-150, 0, -215)`, CF `(0, 0, -265)`,
RF `(150, 0, -215)`, scaled by the league's fence: multiply the outfielders' depth by
`fenceFt.center / 405`) on the `Idle` loop, facing the plate. `game.js`'s shift (`_shiftDegFor`)
rotates the outfielders' plan positions by the shift angle. No fielding AI: the ENGINE has already
decided the outcome; the fielder nearest the landing point (or the fence, for a homer) jogs toward
it during the chase (`Run` loop in poses.js: a two-key leg cycle, arms pumping) and stops there.

Runners: a runner on a base is a figure standing on that bag on `Idle` (a runner's own team
colour); on a hit the runners and the batter RUN the base paths (`Run` loop, 27 ft/s, so 90 ft
takes 3.3 s, sped up to fit the chase + marker window if longer) to the bases `bases.js` decided;
a scoring runner runs home and disappears at the plate; an out runner disappears at the base he
was out at. The batter-runner on an out jogs to first and disappears. Between pitches the runner
figures stand on their bags. All of it is driven from the `atBatEnd` payload's before/after bases
(add `basesBefore` to the payload, additive) so the UI never decides baserunning.

The chase camera (R1) is kept but now frames the PLAY, not only the ball: it follows the ball to
its apex, then eases to a spot behind and above the landing point looking at the fielder there;
on a home run it follows the ball over the wall and then holds on the stands for the marker. The
overhead cut is gone for good.

The diamond widget: a small rotated-square widget (four cells HOME/1B/2B/3B, the `basesSvg`
already in the HUD grows into it) fixed at the top-right of the field band during the chase and
the marker hold, runners shown as filled cells, the runner moving between cells as the figure
runs; outs shown as the HUD's dots. Fixed geometry, no reflow.

Deliverables: stills of a single with a runner advancing, a double play, a sac fly, a home run
with two on, the widget; a device probe that plays until a hit with a runner on and asserts the
runner figure moved from one bag to the next and the widget cell followed; every suite green.

### R3 record (shipped v863, 2026-09-20)

From the stage's report: the pitcher camera at z = -72 never frames an infielder (2B/SS stand
behind the lens, 1B/3B are 9 ft in front of it at 63 ft of offset) and the batter camera frames
two or three at a time; `fielders-placed` proves the nine are placed, no single frame shows them.
`_attachBat` was already keyed on the batter role, so no `noBat` flag was needed. The diamond
widget's rotated cell rotated its label with it and pushed "3B" past the right edge at 393 px;
the rotation lives on a shape child now. A role is a base SLOT (`r1` is whoever is on first),
never a person. `RUN_WINDOW_MS` = 2000 ms is the shared budget every runner and fielder move
fits inside. renderStats: 18 to 20k triangles, 19 to 24 draw calls, under 1 ms per frame on the
software renderer.
### RA: steal, bunt, pickoff, and every pitch type in Quick Play

The design doc locks the three buttons, their slots and "tap, never hold", and leaves how each
works open. These rules close it (Matt, 2026-09-20: *"We need the other buttons like bunt, steal,
pick off to work. And we need the other pitch types."*). `RESERVED_PHASE_6` retires.

**Steal (batting, enabled when a runner is on a base whose next base is empty, before READY).**
Tap STEAL: the lead eligible runner goes on the next pitch. Resolved at the crossing, before the
swing result: success probability `clamp(0.45 + 0.01 * runner.hitSpd - 0.005 * pitcher.pitchAcc,
0.20, 0.90)` (`SKILL_EFFECT.hitSpd.stealSuccessPerPt` is the 0.01). Success: runner +1 base.
Caught: runner out (an out is recorded, at-bat continues). If the batter puts the ball in play,
the steal is moot and the play resolves as normal (the runner was already moving; `advanceAll`
as now). The CPU batting side steals with probability `0.12 + 0.004 * hitSpd` per pitch when
eligible, never with 2 outs and a 3-ball count. Emitted as `steal` `{runnerId, from, to, safe}`.

**Bunt (batting, always enabled before READY).** Tap BUNT: bunt mode for this pitch (the mode
bar highlights BUNT; the batter squares at the wind-up, a `Bunt` loop in poses.js: bat level,
hands apart). On a swing tap in bunt mode: contact is timing-only with the window x1.6, always
`kind: 'ground'`, distance 8 to 40 ft, spray within ±30 deg. With runners on and fewer than 2
outs it is a sacrifice: runners +1, batter out unless the beat-out roll (`MECHANICS.beatOutPerPt`
x hitSpd) succeeds (then a single). With nobody on: bunt for a hit, the same roll. A foul bunt
with 2 strikes is a strikeout. A take in bunt mode is an ordinary take. Bunt mode clears after
the pitch. Emitted as `atBatEnd` with `outcome: 'bunt-out' | 'bunt-single' | 'sacrifice'`.

**Pickoff (pitching, enabled when a runner is on first).** Tap PICKOFF instead of PITCH: no
pitch is thrown; the pitcher turns and throws to first (a `Pickoff` clip: quick turn, 0.5 s).
Success `clamp(0.06 + 0.01 * pitcher.pitchAcc, 0.06, 0.35)` (`pickoffPerPt`): the runner is out.
Otherwise nothing changes. Either way a CPU steal planned for that pitch is cancelled. The beat
is 1.5 s and the count is untouched. Emitted as `pickoff` `{runnerId, out}`. The CPU pitcher
throws over with probability 0.08 per pitch when the human has a runner on first.

**Pitch types.** Quick Play unlocks all eight for both sides (`unlockedPitchesFor(league, 0,
{quickPlay: true})` returns `PITCH_TYPES`); the CPU's `pitchMix` for Quick Play weights every
type. Career keeps the ladder's unlocks.

**Deliverables.** Engine tests for each rule (success bands at cap and at zero skill, the
2-out/3-ball guard, the foul-bunt strikeout, sacrifice vs beat-out); a device probe that taps
each button in the right state and asserts the event and the widget; stills of each action.


### RA record (shipped v864, 2026-09-20)

From the stage's report: a steal is eligible from first and second only (a "next base empty"
rule would offer a steal of home on every pitch with a runner on third, which no number here is
calibrated for). Quick Play's CPU mix is one distribution, `QUICK_PLAY_PITCH_MIX` (College's four
renormalised to 0.76 plus the four named weights), the per-league career rows untouched. The
swing view carries `steal {runnerId, from, to, hitSpd}` because the CPU batter has no roster.
The swing is scored first, then the steal resolved, then the count applied, so "void when in
play" is decidable; a third out on a caught steal needs the same half-inning guard as a
pickoff's. An `if (aborted) return` between the steal and the count broke the at-bat's atomic
resume unit (2 of 960 seed pairs); the line is gone with a comment. The Pickoff clip's turn was
first authored toward third; only a rendered frame caught it. First base is outside the pitcher
camera's frame and a steal from first is outside the batter camera's, so the widget carries both
plays. `sacrifice` is an out whose name does not end in "out"; every `/out$/` branch has a fourth
case. Sim drift with the CPU stealing, bunting and picking off: every league 0.01 to 0.07 harder
for the player (Majors and Minors moved INTO their bands, High School out), nothing tuned.

### R4: presentation, the reference's feedback layer

Everything here is DOM or 2-D overlay over the scene; no engine change, no timing change beyond
what each element's own animation needs inside the existing beats.

- **The verdict over the batter.** The big word (`.bb-pop`) moves from the band's fixed top to a
  point projected from the world: 1.2 ft above the batter's head through the active camera
  (batting: above the near batter; pitching: above the far batter, so it sits over the zone box).
  Two lines under it: pitch name + mph (`Fastball 84 mph`), and the swing line (`Swing and a miss`,
  `Late swing`, `Early swing`, `Foul`) when there was one. Ball / Strike keep their ● ■ shapes.
  Italic 900 weight, white with the dark stroke; STRIKE on a swinging miss flashes once.
- **Fire trail on a strike, burst on contact.** A short additive-blend trail (6 to 8 sprite quads
  of an orange-white gradient, fading) follows the pitch ball over the last 40% of its flight
  when the engine says strike; a radial burst (12 short lines flying out, 250 ms) at the bat at
  contact. Both on the 2-D overlay canvas, projected; reduced motion draws neither.
- **HOMERUN.** On a homer, after the chase reaches the wall: a full-band word `HOME RUN` in the
  hub's gold, letter-spaced, scaling 0.6 to 1.0 over 300 ms with 40 confetti rectangles (six
  colours) falling for 2 s; then a stats strip under it for the rest of the marker hold:
  `421 ft  99 mph  38°` (distance from the engine, exit velocity from the payload, launch angle
  from the engine's own `launchAngleDeg`; add it to the `atBatEnd` payload, additive). Reduced
  motion: word and strip only.
- **The pitch bar carries a number.** Each unlocked pitch tile shows its readout mph under the
  code (`FB 92`), locked ones the padlock as now; the selected tile highlighted as now.
- **The batting mode toggle** (R2's two-tile CONTACT/POWER) gets the strip's tile styling.
- **The batting box reads bigger.** On `batterCam` the drawn zone box and both cursors (circle, target marker) are scaled about the box's centre by `BATTING_ZONE_SCALE` = 1.6 (51 px to ~82 px wide), the same rule `PITCHING_ZONE_MIN_W_FRAC` applies on the other camera; the ball is never scaled and the engine's units are untouched; `zone-world` keeps measuring the true box through a helper that reports the unscaled rectangle.
- **Sound.** None this stage (Matt has not asked).

Deliverables: stills of a called strike, a swinging miss, a contact burst frame, the fire trail
mid-flight, HOME RUN with confetti, the stats strip, the pitch bar with numbers; `test-visual`
motion probe for the pop; reduced-motion stills showing no trail, burst or confetti; every
suite green.

### R4 record (shipped v865, 2026-09-20)

From the stage's report: the pop is centred on the batter's head point (place position + 6.9 ft,
the doc's extra 1.2 ft was not added on top) and clamped into the band; `.bb-lines` go empty on
every pitch (the verdict, pitch line and swing line live in the pop; Line 1 keeps only the
at-bat outcome word). `_zoneBoxPx()` is the one true unscaled box and `_zoneMap(mode)` applies
`BATTING_ZONE_SCALE` 1.6 or the pitcher camera's floor; any probe that hand-derives a batting
camera pixel from field.js alone is off by 1.6x. `_pitchWorldPoint(xNorm, yNorm, frac)` is the
one pitch-to-world function the ball and the fire trail share. `timingWord` is set on every real
swing, so the `'foul'` pop branch was already dead; "Foul" and "Swing and a miss" are said by the
swing line only. The reduced-motion check in `test-visual.mjs` is structural (source regex), not
a call-count probe. r2-cadence watches `_showPop` now, not Line 1.

### R5: contact and carry, so a Perfect swing is never an out at the plate

Matt's recording of v865: five "★ Perfect" swings, five outs at the batter's feet, 0 ft. Measured
through the real engine (`swing.js` + `outcomes.js`, Quick Play's preset roster, College park):
perfect timing with the cursor dead centre carries 0 ft on 15% of swings; the cursor 0.2 zone
units off centre (about two inches at the plate) carries 0 ft on 100%. Two causes, both numbers,
not rules: `BASE_EXIT_VELO` (31.39) sits 1.4 mph above `CARRY_ZERO_MPH` (30), so every deduction
between them (`placeFrac x placementPenaltyMph` 18, the ±4 mph noise, `placeQ` folded into `q`)
drops the ball below the line where `carryFt` returns 0; and `carryFt`'s angle factor `sin(2a)` is
near 0 for a grounder at 0 to 3 deg, so a topped ball stops at the plate. R5 owns
`baseball/js/engine/` for this stage (section 6's blanket exclusion does not apply, exactly as R2's
did not). It also owns item 11 of the same analysis: the season scoreboard drifted when RA gave the
CPU its new plays and nothing was re-tuned.

**Rules.**

1. **Placement steers the ball, it never subtracts power.** `q` is timing quality alone
   (`qualityFor`); `placeQ` stops multiplying it, and `placementPenaltyMph` is deleted. The vertical
   offset still picks the kind (grounder / line / fly / pop-up) and the horizontal offset still
   sprays, as R2 wrote them. A ball crossing outside the circle is still a miss. The one thing the
   outer half of the circle may cost is launch-angle tightness (the spread widens from the inner
   half to the rim), never mph. `centered` keeps its meaning for the sim's attribution.
2. **Exit velocity is a real number.** The pop and the HOME RUN strip print it, so it has to read
   like a broadcast: a barely-timed contact around 50 mph, a perfectly-timed swing with no power
   points around 80, a perfectly-timed swing at cap power around 105 at College, POWER mode a few
   mph over CONTACT, noise a few mph either way. `BASE_EXIT_VELO`, `MIN_EXIT_VELO_MPH`,
   `SKILL_EFFECT.hitPow.exitVeloMphPerPt`, `modeExitMult` and `CARRY_SCALE` are all re-derived
   together; `LEAGUE_POWER_SCALE` keeps scaling the excess above `CARRY_ZERO_MPH`. Write the
   derivation in `settings.js` the way BB-2d's comment does, from named targets, so the next
   fence change can redo it.
3. **No ball in play ever carries 0 ft.** `carryFt` gets a grounder floor on its angle factor
   (a ball hit at 2 deg rolls; its distance is where a fielder meets it, roughly 40 to 150 ft),
   pop-ups land at least on the infield grass, and a new `MIN_IN_PLAY_FT` names the floor every
   in-play result must clear. `resolveContact`'s geometry (sectors, bloop band, line-through,
   double/triple fractions, the fence) stays; only what feeds it changes.
4. **Perfect means something.** Measured at Quick Play's preset roster against Quick Play's CPU,
   at the College park, 20,000 swings per cell (the `--contact-grid` harness, or a sibling
   `--perfect` mode): a perfectly-timed swing (inside `perfectMs`) with the ball in the inner half
   of the CONTACT circle is a hit at least 55% of the time and a home run at least 8%; the same
   swing with the ball in the outer half is a hit at least 30%; a swing at the edge of the timing
   window (q near 0) is still in play and a hit at most 25%. The existing contact-grid checks
   (TIMING_OVER_POWER and the ceiling) must stay green: timing beats power is the doc's own lock.
5. **The season scoreboard.** `node sim-baseball.mjs --quick --assert` before any change, pasted;
   then the full `--assert` after. Every league's SEASON_WINRATE_BAND and SEASONS_TO_GOLD are the
   targets. Knobs allowed: `CPU`, `CPU_LEVEL_SHORTFALL`, `SKILL_EFFECT`, the exit-velocity and
   carry constants above, `LEAGUE_POWER_SCALE`, `zones.js`'s depths if the report says why. Not
   allowed: any `FEEL.ui` beat, `cursorR`, `timingWindow`, `perfectMs`, `foulMult`, the steal /
   bunt / pickoff constants, anything in `ui.js` beyond what the new numbers force (check
   `_battedApexFt` and the chase against a 150 ft grounder and a 60 ft pop-up; they must still
   look like a grounder and a pop-up).

**Deliverables.** `baseball/js/test.js` section 32: (a) 20,000 random in-play swings per league
and per mode, none under `MIN_IN_PLAY_FT`; (b) a perfectly-timed dead-centre swing is never 0 ft
and its exit velocity is inside [70, 115] at every league; (c) with the same seed, cursor offset
0 and cursor offset 0.3 produce the same exit velocity (placement does not subtract power);
(d) q=1 beats q=0 in exit velocity on the same seed; (e) a grounder at 1 deg carries at least
40 ft; (f) the eight existing contact-quality tests updated, none deleted. The sim scoreboard
before and after, the contact-grid lines, and the rule-4 census, all pasted into
`baseball/CLAUDE.md` exactly as run, passing or not. Every suite the stage touches green:
`node baseball/js/test.js`, `node sim-baseball.mjs --contact-grid`, `node sim-baseball.mjs
--assert`, `node test-baseball-device.mjs` (with `BB_DEVICE_QUICK=1`), `node test-visual.mjs
baseball`. Stills: the pop and strip after a real homer showing a broadcast-looking mph, and a
grounder chase ending in the infield, not at the plate.

### R6: figures and runners, the team a figure wears and who stands at the plate

Matt's recording of v865, items 2 to 4 of the analysis. Presentation only: no engine change, no
beat change, no camera change (R7 owns the cameras).

- **Every figure wears the team the inning half says.** `_syncActors` picks the batter's and the
  pitcher's side from `mode` (`'pitching'` = away batter), which is inverted for the human (the
  human is `away`; in the pitching state the CPU, `home`, bats) and disagrees with the runners and
  fielders, which already derive from `this.game.half`. One rule for all fifteen roles:
  `battingSide = half === 'top' ? 'away' : 'home'`, the defense is the other one, the umpire is
  his own; the batter, pitcher, catcher, fielders and runners all read it. Before `this.game`
  exists (the first `_drawStaticField()`), the human bats, so the batter is `away`.
- **One batter at the plate, always.** After a play ends at or near home (a 0 ft out today, any
  short out after R5), the batter-runner figure (`rb`) is still standing on the plate when the
  next batter is placed, so two figures share the box for a beat. Find the exact path (the
  `_animateRunners` mover whose run was cut by `_returnToPlate()`, or an `rb` never hidden when
  `raw` skipped him) and close it: `rb` is hidden the moment his play resolves as an out at home
  or when the cutaway returns to the plate, whichever comes first, and `_syncActors` hides `rb`
  whenever no runner animation owns him. A fresh at-bat never inherits a visible `rb`.
- **The diamond widget reads from behind the plate.** `.bb-diamond-cell[data-cell="1b"]` is at
  `left: 12%` and `3b` at `88%`; from behind home, and in the reference, first base is on the
  RIGHT. Swap the two. Check `_paintDiamondWidget`'s moving dot follows (it positions by cell, so
  it should for free) and that no test pins the old sides.

**Deliverables.** Two probes in `test-baseball-device.mjs`: `sides-match` (mount, force each
half through `__bbForceHalfNext`, read every visible actor's `side` from `inst.actors` and assert
the batter, the runners and the fielders agree with the half, at both halves) and `one-batter`
(force a short out at home through the dev seams, wait for the next at-bat's first pitch, assert
exactly one visible figure inside 4 ft of the batter's box and that `rb` is hidden). Stills: the
batting state and the pitching state with a runner on base, showing the colours agree; the
widget with a runner on first, dot on the right. `node test-baseball-device.mjs` (with
`BB_DEVICE_QUICK=1`), `node test-visual.mjs baseball`, `node check-no-scroll.mjs baseball`,
`node test-game-conventions.mjs` green.

### R7: camera and presentation, what the recording showed against the reference

Matt's recording of v865, items 5 to 10 of the analysis. Presentation and cameras only: no
engine change, no beat change, no control change. Every still is taken beside the reference
frame for the same moment (`docs/BASEBALL-REFERENCE-B9.md`'s catalogue; the orchestrator supplies
the frames).

- **The verdict word stays on screen and stays put.** `_positionPop` clamps the CENTRE 12 px from
  the band's edge, so a wide word ("Perfect" for a left-handed batter) runs half off the right
  edge; and it re-projects through whichever camera is live, so the word jumps across the screen
  when the chase cuts in. Clamp by the element's own measured width and height (half of each
  plus the margin); position ONCE per `_showPop` and never re-project it; hide the pop the moment
  the camera cuts to the chase (the reference shows no word over the chase; the outcome word
  is the marker hold's job).
- **The chase never starts inside the catcher.** On a short ball the first chase frames are the
  catcher's head filling the foreground. Give the chase a minimum start: the camera's first
  position is at least `CHASE_MIN_HEIGHT_FT` up and `CHASE_MIN_BACK_FT` behind the ball
  (numbers chosen by measurement, written in `field.js`'s CAMERAS comment), and the catcher and
  umpire are hidden from the chase camera (`_applyCameraVisibility` already hides the umpire
  from the batter camera; same mechanism).
- **The pitch is visible from the pitcher camera.** During the human's own pitch the ball at
  60 ft draws about 3 px and no frame of the recording shows it. A pixel-size floor for the ball
  on the pitcher camera (scale the sphere so it never draws under `BALL_MIN_PX`, the same
  about-the-centre idea `PITCHING_ZONE_MIN_W_FRAC` uses for the box; never on the batter or
  chase cameras), and the fire trail (`_maybeDrawFireTrail`) drawn on that camera too.
- **The batting target marker is something you can steer onto.** `TARGET_MARKER_R` 0.12 draws a
  5 px ring; the reference's is a clear square about 30 px across on a 393 px phone. A square
  marker with the existing crosshair, about `0.3` zone units on a side (through `_zoneMap`, so
  it scales with the batting camera's 1.6 x), drawn UNDER the cursor circle; the `target-marker`
  probe reads `_targetMarkerPx` and must still pass.
- **Stands behind home plate.** From the pitcher camera there is grass to the horizon behind the
  batter. `standsPoints` runs -75 to +75 deg and tapers; close the ring: a short backstop
  section of stands behind the plate (two tiers, about 20 ft behind the umpire, spanning the
  angles the pitcher camera sees), with the same crowd texture. The batter camera must still
  see the field, not a wall (it sits at z 13.1; keep the backstop behind it or make it
  invisible on that camera).
- **No flat green frame at the half-inning swap.** Between halves the scene shows an empty
  field for a beat with "Side retired" over it. `_crossFadeSwap` fades every element out, swaps,
  fades in; the empty frame is the swap's own `_drawStaticField()` before the actors are
  re-placed. Cross-fade over the LAST RENDERED FRAME: snapshot the WebGL canvas to an image
  before the fade (`toDataURL` or a copy canvas), hold it over the scene through the swap, fade
  it out once the new half's first frame has painted.

**Deliverables.** Stills, each beside its reference frame: the pop for a left-handed batter's
"Perfect" fully on screen; the first chase frame after a short grounder (no catcher); the ball
mid-flight from the pitcher camera with the trail; the batting idle with the square marker; the
pitcher camera with stands behind the plate; the batter camera unchanged. Probes in
`test-baseball-device.mjs`: `pop-onscreen` (a left-handed batter, the pop's bounding rect
inside the band), `chase-start` (the chase camera's first position at least the minimum height
and distance from the ball), `ball-visible-pitcher` (the ball's projected radius on the pitcher
camera at 60 ft is at least `BALL_MIN_PX`). `node test-baseball-device.mjs` (with
`BB_DEVICE_QUICK=1`), `node test-visual.mjs baseball`, `node check-no-scroll.mjs baseball` green.

### R5 record (shipped v866, 2026-09-20)

From the stage's report: on the shipped v865 engine 96.5% to 98.6% of all balls in play carried
0 ft (median exit velocity 16 to 20 mph), so every hit was decided by spray angle alone. After
R5 the zero-feet rate is 0.0% in every cell measured; exit velocity reads 77 to 103 mph. The
rule-4 census passes all seven lines. Rule 4's home-run floor and the contact grid's three
ratio lines cannot both hold: the grid was green on v865 only because home runs were 0.1% of
balls in play, so the grid's `ratio`, `cross` and `ceiling` lines are red and the sweep that
shows why is in `baseball/CLAUDE.md`. Two things the spec said would stay had to move once
balls carried: `zones.js`'s depths (in feet, never reached before) and `LINE_THROUGH_MAX_FT`
(220 to 280); a line drive over the wall is now a homer, not a triple. `carryFt`'s angle curve
peaks at `CARRY_PEAK_DEG` 30 instead of the vacuum curve's 45. `_battedApexFt` draws a pop-up
as a pop-up. **Item 11 (the season re-tune) was NOT delivered**: the player is about 0.09
stronger at every league and Gold is slower everywhere but Little League and High School; four
knobs were tried and reverted, all written up. The `CPU`, `CPU_SIGMA_MIN_MS` and
`CPU_LEVEL_SHORTFALL` tables are byte-identical to v865. That re-tune is its own stage, after
R7. Also found: `zonesFor` ignores its settings argument, so `--set FIELD.*.outZoneMult` never
reached a full-game sim; `--set` for top-level keys and `--contact-grid`'s `--set` are fixed.

### R6 record (shipped v867, 2026-09-20)

From the stage's report: `_syncActors()` takes no argument now; every figure's side comes from
`this.game.half` (batting side `top` = away), the umpire is his own. The double batter was a race:
`RUN_WINDOW_MS` (2000) equals `CONTACT_HOLD_MS + FLIGHT_MS + MARKER_HOLD_MS`, so the batter-runner's
own run loop and the cutaway's return were independently clocked and the return could land first,
leaving `rb` mid-run at the plate; it did not reproduce under auto-play in the container and was
forced by calling `_returnToPlate()` early. `this._rbActive` is the one truth for "a batter-runner
is running"; `_returnToPlate()` clears it and hides `rb`, and `_syncActors` hides `rb` whenever it
is false. `DIAMOND_PCT` (ui.js), the `.bb-diamond-cell` CSS and `basesSvg()` (the HUD's
mini-diamond, un-mirrored at ship review) are three copies of which side first base is on. The
batter camera's frustum shows second base only at 393 px; first projects at x 577 and third at
x -170. Probes `sides-match` and `one-batter` are synthetic and run under `BB_DEVICE_QUICK=1`.

### R7 record (shipped v868, 2026-09-20)

From the stage's report: `_positionPop` clamps by the element's own measured half-size plus the
12 px margin and `_hidePop()` runs at the cut to the chase. `_applyCameraVisibility` hides the
catcher and the umpire from the chase camera (the umpire from the batter camera as before), and
`_place()`'s auto-show excludes both; a minimum start offset (`CHASE_MIN_HEIGHT_FT` 11,
`CHASE_MIN_BACK_FT` 24) applies to the first snap only, because no offset alone keeps a camera
whose z tracks the ball's from passing through the catcher's fixed z. The ball's projected
radius is floored to `BALL_MIN_PX` 8 on the pitcher camera only and the fire trail's base radius
reads the same floor (the trail was already drawn on that camera). The target marker is a square
drawn under the cursor circle; the stage set the side to the spec's 0.3 zone units (12 px on the
1.6x box) and ship review raised it to 0.64 (26 px, the reference's own size). A backstop
(`backstopPoints`, 30 ft behind the plate, ±60 deg, two tiers) is merged into the existing stands
mesh; the batter camera sits inside it and never sees it. The half-inning swap fades over a
snapshot canvas (`.bb-crossfade-snap`, z 6) of both game canvases; `.bb-lines` needed an explicit
z 7 or "Side retired" vanished under it, caught by a still, not a probe. Probes `pop-onscreen`,
`chase-start`, `ball-visible-pitcher`.

### R8: controls and HUD, from Matt's recording of v868 (2026-09-21)

Matt, on the recording: *"The pitching movement is inverted. When I move left, it goes right. The
strike zone when pitching is massive. When batting, the type of pitch is way too prominent, it
takes up a ton of space, meanwhile the current count and the overall score is difficult to find
or see. When batting, there's no indication of where the pitch is going other than the actual
ball; a spot should appear in the strike zone (or outside of it) indicating where it's going."*
All four are measured in the frames (`scratchpad/rec5/pad-vs-zone.png`: at 59.5 s the pad dot is
top-LEFT and the cursor is top-RIGHT of the zone). No engine change, no beat change.

1. **The pad follows the finger on screen, on both cameras.** The batter camera looks toward
   -z, so world +x (first base) is screen RIGHT; the pitcher camera looks toward +z, so world +x
   is screen LEFT. `_setCursorFromPad` maps pad x straight to engine x for both, so in the
   pitching state a drag right moves the cursor left. One per-state sign (pitching -1) in the
   pad-to-cursor and cursor-to-pad-marker mapping; the engine's units are untouched (its +x is
   still first base). The `pitch-drag` probe becomes a screen test: a drag RIGHT on the pad ends
   with the cursor's projected pixel RIGHT of the zone box's centre, on the pitcher camera, and
   the engine's sampled aim is the mirrored value; add the same drag on the batter camera.
2. **The pitcher camera frames the plate like the reference.** Today the box at 72 ft is 15 px
   tall so `PITCHING_ZONE_MIN_W_FRAC` floors it to 13% of the width while the figures stay true
   size: a huge box over tiny men. The reference (`scratchpad/ref/reference-key-frames.jpg`, top
   row) is a long lens from well behind the mound: the pitcher's back fills about half the band's
   height, the batter and catcher are about 40% of his height, and the zone box at TRUE scale is
   about 10% of the band's height. Move the camera back along the mound-to-plate line and narrow
   its fov until those three proportions hold (measure them in a still, write the numbers beside
   `CAMERAS.pitcher`), then delete the min-width floor; the box is drawn at true scale on both
   cameras. `BALL_MIN_PX` may become unnecessary; keep it if the ball still draws under 8 px.
   Probe `pitcher-frame`: the true box's projected height is between 8% and 13% of the band and
   the batter figure's projected height is between 30% and 50% of the pitcher's.
3. **The pitch's target is unmistakable.** The square marker from R7 is 26 px of thin red line
   on brown dirt, drawn under the cursor circle; Matt could not see it. Replace it with a filled
   marker: a white disc with a dark outline and a red centre, about 0.5 zone units across on the
   1.6x batting box (about 40 px), drawn OVER the zone box and UNDER the cursor circle, at the
   pitch's crossing point the moment the pitcher releases (sliding for a breaking pitch as now),
   and never clipped when the pitch is a ball outside the box. Probe `target-marker` keeps its
   position assertions; add a size assertion (at least 36 px across) and one ball outside the
   box whose marker is still drawn.
4. **The scoreboard is the most legible thing over the field.** The 48 px HUD bar (12 px text)
   becomes a scoreboard block at the top-left of the field band, over the scene, like the
   reference's: YOU and CPU runs in numerals at least 18 px, the inning arrow and number, and
   three rows B / S / O of filled dots at least 10 px with their letters, plus the mini-diamond.
   Nothing else in the band moves (pop, widget, HOME RUN). Probe `hud-legible`: the runs and
   count numerals' computed font size, and the dots' size, at or above those floors.
5. **The pitch history stops shouting.** In the BATTING state the 108 px strip of 92 px tiles
   (one per pitch of the at-bat) becomes one 32 px row of small chips (code and mph, 11 px
   text), and the field band takes the freed 76 px. The PITCHING state keeps its 108 px strip
   (it is the pitch selector). This deliberately breaks BB-3b's "nothing moves between states"
   rule for the strip, because the two states are separated by a cross-fade and the batting
   state has no use for a selector-sized band; write that down in the CLAUDE.md entry. Every
   fit check and `check-no-scroll` must stay green at both phone heights in both hosts.

Deliverables: stills beside the reference frames: pitching idle (framing), a drag right on the
pad with the cursor right of centre, the batting view with the marker at release, the scoreboard,
the batting strip as chips. Probes as above. `BB_DEVICE_QUICK=1 node test-baseball-device.mjs`,
`node test-visual.mjs baseball`, `node check-no-scroll.mjs baseball`, `node test-game-conventions.mjs`,
`node baseball/js/test.js` green.

### R9: figures and stadium, from the same recording

Matt: *"There's still the problem of multiple batters appearing and glitches like that. The
opposing team should be red. And can you add baseball hats? The stadium backdrop should be
changed. It's bland right now."* Measured (`scratchpad/rec5/glitch-sheet.jpg`, 28.6 s and 46.4 s):
at contact the batter-runner figure `rb` is placed at the plate and starts running while the
BATTER figure is still standing in the box, so two navy figures share the plate for the first
half second of every ball in play. R6 closed the other half of this (the return); this is the
start.

1. **The batter becomes the runner.** The instant `rb` is placed for a ball in play, the
   `batter` actor is hidden; he reappears at `_returnToPlate()` for the next at-bat. Never two
   figures in the box. The `one-batter` probe samples every frame for the first 800 ms after
   `atBatEnd` and asserts at most one visible figure within 6 ft of the batter's box, as well
   as its existing after-return check.
2. **The CPU team is red.** The `home` colour keys in `actors.js` (both skins) send the shirt to
   a red (about #c62828), pants to white, trim to a darker red; the human stays navy. Runners,
   fielders, batter, pitcher and catcher all follow, since every figure reads its side from the
   half (R6). `test-baseball-actors.mjs`'s colour-key check (never a skin tone) must stay green.
3. **Baseball caps.** A low-poly cap per figure, parented to the head bone from `rig.js` so it
   rides every clip: a dome (a sphere cut at about 45% height) plus a brim (a flattened short
   cylinder segment forward of the face), in the figure's team colour, black for the umpire,
   scaled and offset by measuring the head bone once (`render-actor.mjs --sheet` against
   Idle, Swing, Pitch, Run, Crouch: the cap sits on the head in all five, never floats, never
   sinks). Shared geometry, one material per colour. The catcher keeps his cap (backwards is a
   bonus, not required). Structural check in `test-baseball-actors.mjs`: every placed actor has
   a child named `cap` under its head bone.
4. **The stadium reads like a ballpark, not a diagram.** Today: flat green, a grey ribbon of
   stands whose crowd texture renders near-black, a bare sky. Build, with merged geometry and
   no new textures over 256 px: a sky gradient with a few soft clouds; the outfield wall as a
   padded green wall with a yellow line and a row of coloured ad panels (plain colour blocks
   with simple shapes, no text); a crowd texture that reads as a crowd (dense multicolour
   specks on a light ground, with aisle gaps); four light towers; a centre-field scoreboard
   block; the backstop from R7 with the same treatment. The batter camera's framing is
   unchanged in position; only what it looks at changes. Take stills from all three cameras
   beside the reference's; the pitcher camera still shows stands behind the plate.

Deliverables: stills of each camera before and after, a cap sheet from `render-actor.mjs`,
the probes above. `BB_DEVICE_QUICK=1 node test-baseball-device.mjs`, `node test-visual.mjs baseball`,
`node test-baseball-actors.mjs`, `node check-no-scroll.mjs baseball` green.

### R8 record (shipped v870, 2026-09-21)

From the stage's report: `PAD_X_SIGN = { pitching: -1, batting: 1 }` (ui.js) is the one place the
pad's screen-to-engine sign lives; the engine's +x is still first base. The pitcher camera is at
(-2.4, 7.0, -116), 55.6 ft behind the rubber, with its own `fov` 10.35 (`makeCameras` now honours
a per-camera fov; batter and chase still share 50); measured: pitcher 59.5% of the band, batter
47.8% of the pitcher, the true box 8.5% of the band. The three prose targets could not all hold
at once because the box is a fixed fraction of the batter's height at this depth (box ≈ 0.3 x
ratio x pitcher), so "about half" for the pitcher became 59.5%. `PITCHING_ZONE_MIN_W_FRAC` is
gone. The marker is `TARGET_MARKER_R` 0.4 (radius), 41.7 x 50.6 px, filled white with a red
centre, drawn over the box and under the cursor, outside the box for a ball. The HUD bar is gone;
the scoreboard is an absolute card at the band's top-left (`.bb-sb-*`, strings `sb_b/sb_s/sb_o`).
The batting strip is a 32 px chip row (`.bb-strip--compact`), so the BATTING band is 553 px tall
and the PITCHING band 477 px (both were 429): BB-3b's "nothing moves between states" is broken
for the strip on purpose. Probes `pitch-drag` (screen direction on both cameras), `pitcher-frame`,
`hud-legible`, and `target-marker` (size, outside the box; end budget widened to 4 px at ship
review after a 2.28 px sample). `pop-anchor`'s budget is 45 px.

### R9 record (shipped v871, 2026-09-21)

From the stage's report: the double batter's start half was `_animateRunners` placing `rb` and
starting his Run while the batter still stood in the box (`_settleAtBat`'s `idle('batter')` only
ran for a walk or strikeout). `Actors.setForceHidden(role, hidden)` is a new general primitive;
`_animateRunners` hides the batter the instant `_rbActive` is set, `_syncBatterRunner()` backstops
it, `_returnToPlate()` clears it; the `one-batter` probe samples every frame for 800 ms after
`atBatEnd` (red against the unfixed code on 6 of 39 frames). Home wears `HOME_RED` #c62828 with
`HOME_RED_TRIM` and white pants; away is byte-unchanged (navy, grey pants). Caps are a dome plus
brim group named `cap` under the head bone, `CAP_SCALE` 0.115, `CAP_OFFSET` [0, 0.205, 0.01],
divided by the head bone's ~100x world scale (the same correction `_attachBat` makes); cap parts
carry `isCapPart` so the jersey recolour traverse skips them; every one of 15 roles has one
(actors suite). Stadium: a 256 x 128 sky with clouds, an unlit crowd material on a light ground
(the old one was Lambert on a vertical face the overhead sun barely lit), a padded wall texture
with four ad panels tiled x7, four light towers, a centre-field scoreboard; +4 draw calls per
camera. The backstop was rebuilt at ship review: the first version carried the outfield crowd
texture from the ground up and read as static at the pitcher camera's lens; it is now one wall in
three bands (padded #24406a to 12 ft with a white rail, brick to 28 ft, crowd above at repeat
4.5 on a darker ground). Two crowd textures are tuned independently now.

### R10: the play unfolds in real time (2026-09-21)

Matt, on v871: *"When I make contact, it immediately says 'out' or 'Homerun!' or whatever the
result is. That's too fast. Wait for the ball to stop moving before announcing the result. The
whole thing is too fast too, it's like I'm speed playing. Hitting a homerun is like 0.25 seconds
from swinging to it landing. The ball should move at like a relatively realistic speed through
the air and on the ground."* Measured in `ui.js`: `_settleAtBat` writes the outcome word to Line 1
on its FIRST line, at contact, before the cutaway; the batted ball's flight is a fixed
`FLIGHT_MS` 900 whatever the distance, the whole in-play cutaway is 0.4 + 0.9 + 0.7 = 2.0 s, and
the runners are squeezed into that same window. Presentation only: no engine change, no change to
the pitch beats (`fastballMs`, `windupMs`, `resultMs`, `betweenMs`; the r2-cadence probe measures
those and must not move).

1. **The batted ball takes as long as a ball takes.** Flight time from the ball's own arc, not a
   constant: for a fly, line drive or pop-up the hang time of its apex (`t = 2 * sqrt(2 * apex /
   32.2)` seconds, apex from `_battedApexFt`, with a line drive's apex capped so a 200 ft liner
   is about 2.5 s and a 400 ft fly about 4.5 s); for a grounder, distance over a decelerating
   roll starting at about 60 ft/s (a 40 ft dribbler under a second, a 150 ft grounder about
   2.7 s). Clamp 0.8 to 5.5 s. `FLIGHT_MS` becomes a function of the play, not a constant.
2. **Nothing is announced until the play is over.** At contact the pop shows the timing word and
   the pitch line only. The outcome word (Line 1: Single, Out, and the rest) appears when the ball
   is fielded or lands: a caught fly or line drive at the catch; a grounder when the fielder has
   it and, for an out, after a throw beat of about a second to first; a hit when the ball lands and
   the fielder reaches it; HOME RUN (word, confetti, strip) the moment the ball crosses the wall,
   which the chase already computes (`homerCrossFrac`). Never before.
3. **Runners and fielders move at their real speed for the whole play.** `RUN_WINDOW_MS` stops
   being a constant: each runner's leg runs at `RUNNER_SPEED_FT_S` and the play holds until the
   last runner arrives or is out, and the chasing fielder runs at a fielder's speed to where the
   ball comes down. The cutaway's length is `max(flight + fielding + a 0.8 s settle, the last
   runner's arrival)`; the marker hold is the settle. After the return to the plate, the between
   beat is the same `BETWEEN_MS` as today (the pitch cadence is untouched); the in-play at-bat is
   simply longer, by however long the play took.
4. **The stats strip under HOME RUN stays for the trot.** Keep it up until the return to the plate.

Deliverables. Probe `play-clock` in `test-baseball-device.mjs`, driving `_settleAtBat` with
synthetic payloads the way `homerun-strip` does: a 420 ft homer shows no outcome word at contact +
300 ms, shows HOME RUN no earlier than 3.0 s after contact, and returns to the plate no earlier
than the last runner's real arrival; a 120 ft groundout shows no outcome word at contact + 300 ms
and shows Out between 1.8 and 4.5 s after contact; a 250 ft fly out shows Out only at the catch.
`r2-cadence`, `runners-move` (run it once without `BB_DEVICE_QUICK`, it is the real-play check),
`one-batter`, `homerun-strip` and the PLAY probe stay green. Stills: contact + 300 ms with no word,
the ball mid-flight on a homer with the runners underway, HOME RUN at the wall.
`BB_DEVICE_QUICK=1 node test-baseball-device.mjs`, `node test-visual.mjs baseball`,
`node check-no-scroll.mjs baseball` green.

### R11: the league ladder is real in Quick Play (2026-09-21)

Matt, same message: *"I also think you've forgotten to code the difficulties. Little league should
be easy and the pitches slow and only 'fastballs' should be able to be thrown."* Measured:
`unlockedPitchesFor(league, 0, {quickPlay: true})` returns all eight types for both sides (RA's
own decision, now overruled); `pitch.js`'s time to the plate scales only by the pitcher's skill
points off the MAJORS baseline, so a Little League 55 mph readout flies to the plate in the same
650 ms as a 95 mph Majors fastball (`READOUT[league].scale` is never applied to travel); and the
human's timing window is the same 100 ms at every league. The CPU ladder (`CPU[league]`) already
exists and stays.

1. **Pitch types follow the league in Quick Play too.** Drop the all-eight override; both sides
   throw the league's own ladder (`PITCH_UNLOCKS[league]`, titles 0). Little League is FASTBALL
   ONLY, career included (`LEAGUE_UNLOCK_ADDS.little = ['fastball']`, `CPU.little.pitchMix` fastball
   only); the doc's section 11 ladder is updated to say so. Locked wells stay locked wells.
2. **A slow pitch is slow.** Time to the plate is `fastballMs x PITCH_TRAVEL_MULT[type] x
   (READOUT.majors.fastball / readout mph of this pitch at this league, with the pitcher's skill
   points added as now)`, so Little League's 55 mph fastball takes about 1.1 s and a Majors 95 mph
   fastball the 650 ms it takes today. The target marker, fire trail and timing window all key off
   the real flight already; check the eephus at Little League does not exceed 2.5 s.
3. **Little League is forgiving, Majors is tight.** `LEAGUE_TIMING_WINDOW_MULT` = { little 1.6,
   highschool 1.3, college 1.0, minors 0.9, majors 0.8 } multiplies the human's timing window
   (`swing.js`, both places `F.timingWindow` is read) and the CPU's `timingSigmaMs` is untouched.
4. **Tests.** `baseball/js/test.js` section 33: Quick Play at Little League unlocks only the
   fastball and Majors its six; travel time is monotone in readout mph and equals today's value
   at Majors; the window multipliers apply. `node sim-baseball.mjs --quick --assert` before and
   after, pasted (Little League will move; report it, do not tune). `test-baseball-device.mjs`:
   `actions-live (d)` asserts the ladder instead of eight unlocked; any probe that throws a
   curveball on the human's turn (`pitch-drag`, `target-marker`) picks a league where it is
   unlocked or uses the dev seam, and says which.

Deliverables: the tests above, the sim scoreboard, a still of Little League's strip (one unlocked
well) and of a Little League fastball's marker mid-flight with the elapsed time.

### R12: the scoreboard's count and the figures themselves (2026-09-21)

Matt, on v871: *"For the scoreboard: the outs should be red dots, that's important. The small
diamond that shows if people are on base should be to the right of the count and a little bigger;
it can be larger if it's to the right of the count and not change the size of that whole
rectangle. Increase the font size a little bit. For the 3D assets, the players: double check
everything. I can't see the batter's feet; when you're pitching, the catcher's legs are bent weird;
the hats do not look like hats; and the baseball bat should be improved."*

1. **Scoreboard.** Filled OUT dots are the palette's vermilion (#E0532F) with the O label they
   already carry; balls and strikes keep their colours. The mini-diamond moves to the RIGHT of the
   three count rows (a two-column layout inside the card) and grows to about 1.6x, and the card's
   outer size does not grow. Runs, labels and inning go up about 2 px each. CSS only (`.bb-sb-*`,
   `.bb-hud`); the markup in `_paintHud` is not touched (R10 owns `ui.js` this hour). The
   `hud-legible` floors still hold.
2. **The batter's feet.** On the batting camera the batter is cut off at the shins by the band's
   bottom edge. Re-aim `CAMERAS.batter` (look point, and position only if the look alone cannot
   do it) so the whole batter, feet and bat, is inside the field band in both hosts at both phone
   heights, while the pitcher, the zone box and the target marker stay where the reference has
   them. Write the measured before and after beside the constant.
3. **The catcher's crouch.** The `Crouch` clip in `poses.js` bends the legs wrong (the R9 cap
   sheet's fifth figure shows it: knees splayed, feet off the ground line). A real squat: feet
   flat and about shoulder width, knees bent forward and out a little, thighs near horizontal,
   torso upright and leaning slightly forward, glove arm forward at knee height, throwing hand
   behind the back. Tune it with `render-actor.mjs --sheet` against the reference frame's catcher
   (`scratchpad/ref/reference-key-frames.jpg`, top row).
4. **Caps that read as caps.** The R9 cap is a dome with a stub; it reads as a beanie. A cap: a
   crown that sits down over the hair line (not floating on the crown of the head), slightly
   flattened, with a top button, and a bill that projects forward about a third of the head's
   width with a gentle downward curve and a visible underside, in a slightly darker shade of the
   team colour. The catcher wears his backwards. Same attachment (head bone), same `cap` name.
5. **The bat.** `_attachBat`'s cylinder becomes a lathe: a knob, a thin handle, a taper to the
   barrel, a rounded end; wood colour with a darker grip band on the handle. Same `BAT.length`,
   same hand attachment, same `swing.js` contact point.

Deliverables: `render-actor.mjs --sheet` sheets of the batter (Idle, Swing), the catcher (Crouch)
and the pitcher (Set, Pitch) with the new caps and bat beside the reference crops; a full-screen
batting still showing the feet; the scoreboard still. `node test-baseball-actors.mjs`,
`node test-visual.mjs baseball`, `node check-no-scroll.mjs baseball` green, and the device suite's
`zone-world`, `zone-scale`, `pop-anchor`, `hud-legible`, `pitcher-frame` re-measured against the
new batter camera.

### R10 record (shipped v880, 2026-09-21)

From the stage's report: `FLIGHT_MS` and `RUN_WINDOW_MS` are gone; `_flightMsFor(kind,
distanceFt)` gives the flight from the arc (hang time of `_battedApexFt`, a line drive's apex
capped by `BATTED_LINE_APEX_FRAC` 0.126 / `BATTED_LINE_APEX_MAX_FT` 40; a grounder as a
decelerating roll), clamped 0.8 to 5.5 s. `_animateRunners` returns `{promise, longestMs}` and
`_animateBattedBall` is async and takes the outcome word and the longest runner; the outcome
word is written when the ball is fielded, lands, or is caught, and HOME RUN at the wall
crossing (`_homerCrossMs`). Measured: a 420 ft homer's HOME RUN at 4.4 s; a 120 ft groundout's
Out at 3.4 s; a 250 ft fly out's Out at the catch, 3.8 s. Ship review: the real trot made a solo
homer's cutaway 13.3 s, so after the wall crossing every runner finishes at `HOMER_RUNNER_SPEEDUP`
3x, landing the 420 ft solo homer at 7.5 s from contact; every other play keeps real speed.
`MARKER_HOLD_MS` 800 is a floor now. Probe `play-clock` (three synthetic plays). The visual PLAY
probe fails under container load (a 700 ms wind-up drag lands late) and passes on an idle
machine; three failures in a row during R12's parallel suites were exactly that.

### R12 record (shipped v880, 2026-09-21)

From the stage's report: the scoreboard is a two-column grid (count rows left, the mini-diamond
right at about 1.6x) inside the same card; outs are vermilion, strikes yellow (ship review: the
stage had made both red), balls blue, each row keeping its letter; runs and labels +2 px.
`CAMERAS.batter.look.y` is -1.0 (was 2.3) so the batter's feet are in frame; the position is
unchanged and every device probe held its baseline. Crouch rebuilt (legs, glove low and forward,
throwing hand behind the back), improved not finished: the glove hand is 0.93 ft against the
knee's 0.33, and a stance-width asymmetry remains, both written up in `poses.js`. This rig's leg
bind poses are not mirrors of each other past about 35 deg of flexion. Caps: a deeper dome past
the equator, a wider tilted darker bill, a top button, the catcher's backwards. The bat is a
`LatheGeometry` profile (knob, thin handle, taper, rounded barrel, grip band). Ship review: the
catcher is drawn on the pitcher camera only, the same rule as the umpire, because his cap filled
the bottom of the batting frame once caps arrived. `render-actor.mjs` honours `BB_BASE`.
