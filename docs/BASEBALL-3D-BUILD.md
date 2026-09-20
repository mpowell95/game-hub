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
