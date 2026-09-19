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

## 2. The model

Filled in by the orchestrator after Matt's pick. Until then every stage uses the SCAFFOLD asset
(2.1) and nothing model-specific ships.

### 2.1 Scaffold asset (development only, never shipped)

`https://raw.githubusercontent.com/mrdoob/three.js/r185/examples/models/gltf/RobotExpressive/RobotExpressive.glb`
(CC0, by Tomás Laulhé; carries named clips and a humanoid-ish rig). Download it to
`/tmp/claude-0/-home-user-game-hub/095ae74e-dae2-559f-bba8-3be6914d286b/scratchpad/3d/scaffold.glb`.
It is used to prove the loader, the mixer, the camera and the tests. It is never copied under
`baseball/`, never committed, never in a screenshot sent to Matt as "the game".

### 2.2 The chosen model

```
MODEL_FILE      baseball/models/player.glb        (copied from the download; source URL in baseball/CLAUDE.md)
LICENCE         <filled in>                       (licence name + URL to the licence text)
SIZE            <filled in> bytes
RIG STYLE       <filled in>                       (Mixamo names / other)
HEIGHT UNITS    measured at load from Box3 of the bind pose; never hardcoded
FRONT AXIS      +Z in the file's own frame unless section 2.3 says otherwise
SHIRT MATERIAL  <filled in>                       (the material `Jersey` recolour targets)
CAP MATERIAL    <filled in or "none">
CLIPS IN FILE   <filled in>                       (used only for Idle if one fits; swing/pitch are authored)
```

### 2.3 The RIG map

`baseball/js/rig.js` exports `RIG`, semantic name to node name in the file. Stage 1 fills it by
reading the glb's node names (section 3.2's `glb-info.mjs` prints them) and verifies every entry
resolves with `root.getObjectByName`. A missing REQUIRED entry throws at load with the node
name in the message.

| Semantic | Required | Used for |
|---|---|---|
| `hips` | yes | root of the pose; weight shift |
| `spine` | yes | torso rotation in the swing and the pitch |
| `chest` | no | falls back to `spine` |
| `neck` | no | falls back to `head` |
| `head` | yes | looks at the pitcher / the plate |
| `shoulderL`, `shoulderR` | no | falls back to upper arm |
| `upperArmL`, `upperArmR` | yes | |
| `lowerArmL`, `lowerArmR` | yes | |
| `handL`, `handR` | yes | the bat is parented to `handR`; the ball leaves `handR` |
| `upperLegL`, `upperLegR` | yes | stride, leg lift |
| `lowerLegL`, `lowerLegR` | yes | |
| `footL`, `footR` | yes | |

---

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
 *  contact for Swing/Miss, release for Pitch. Times are the clip's own; actors.js rescales. */
export const CLIPS = {
  Idle:  { loop: true,  mark: null, keys: [ /* stage 2 */ ] },
  Swing: { loop: false, mark: 0.30, keys: [ /* stage 2: matches batter-home-3..8 */ ] },
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

const TEAM = { home: { jersey: 0xf4f1ea, cap: 0x1c2a4a }, away: { jersey: 0x1c2a4a, cap: 0x1c2a4a } }; // sampled from the sprite sets, stage 3 fixes the hexes
const CROSSFADE_S = 0.15;
const DPR_CAP = 2;
// The bat, in fractions of the model's own height; tuned by eye in the dev screen (stage 3).
export const BAT = { length: 0.48, knobR: 0.012, barrelR: 0.028, pos: [0, 0, 0], rot: [0, 0, 0], color: 0xc9a06a };

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
- Recolouring: after cloning, find the material whose name is section 2.2's SHIRT MATERIAL and set
  `material.color.setHex(TEAM[side].jersey)`; likewise the cap. If the model has a single texture
  atlas and no separable shirt material, stage 3 reports that and proposes the alternative (a
  colour tint on the whole texture is NOT acceptable; a second, recoloured copy of the atlas texture
  masked to the shirt's UV region is the usual answer).
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
   parses; not Draco; under 4 MB; every `RIG_REQUIRED` name is a node in the file; the shirt
   material named in section 2.2 exists; `CLIPS.Swing` and `CLIPS.Pitch` have keys and a `mark`
   inside `[0, lastKey.t]`; `buildClip` over a fake bones/restQ object yields one quaternion track
   per bone used and the right duration. Structural checks on `ui.js` once stage 4 lands: no
   `state.batterFrame` / `state.pitcherFrame` writes remain; `actors.dispose()` inside `destroy()`;
   `visibilitychange` handled; `plateCover`/`anchorPx` exported from `field.js`.
2. **Chromium under swiftshader** (SKIPs without playwright-core; NOT in `run-all-tests.mjs`):
   mount Baseball in the real hub at 393x852 dpr3 with `window.__bbTest = true` set in an init
   script, start Quick Play, wait for `actors.ready`, then: the actor canvas exists and sits above
   the field canvas; a pixel block around the batter anchor is non-transparent in idle; a second
   read-back 150 ms into `Swing` differs from the idle read-back; the `r2-cadence` numbers from
   `test-baseball-device.mjs` still hold (re-run that suite; do not reimplement it); after
   `destroy()` the actor canvas is gone and `renderer.info` is not reachable.

### 3.10 Service worker and docs (stage 5)

- `baseball/models/player.glb` into `ASSETS`; `LAZY_REST` widened to
  `/^\.\/(boggle\/data\/words[a-z-]*\.txt|baseball\/models\/[a-z-]+\.glb)$/`. `node test-sw-strategy.mjs`.
- Delete the sprite path: `drawBatterFigure`, `drawPitcherFigure`, `FRAME_Y_OFFSET_FRAC`,
  `PITCHER_FRAME_Y_OFFSET_FRAC`, `drawFrameCheck`, `SWING_TIMELINE`, `_startSwingTimeline`,
  `_schedulePitcherFollowThrough`, the `batterFrame`/`pitcherFrame` state, the 32 frame images
  `baseball/img/batter-*.webp` / `pitcher-*.webp` and their `ASSETS` lines. Art is not player data.
  The PNG originals stay in `reference/baseball/`.
- `baseball/CLAUDE.md`: a new top entry in the repo's voice with the decision, the model and its
  licence, the anchor/ortho mapping, the mark-time rule, the hand rule, what stays 2D, the LAZY
  decision and its cost, and the measured cadence. Root `CLAUDE.md`: the Baseball row and a
  `test-baseball-actors.mjs` row in the tooling table, plus `glb-info.mjs` and `render-actor.mjs`.
- The orchestrator bumps `CACHE`, runs `validate-sw-assets.mjs`, pushes, PRs, merges, verifies
  the Pages run, and tells Matt it is live.

---

## 4. Stages

Each stage is one sub-agent run. The model column is the orchestrator's default; it escalates
when a stage's pictures fail review twice.

| Stage | Owns | Builds | Checks that must pass | Model |
|---|---|---|---|---|
| **1 Foundation** | `baseball/js/vendor/*`, `glb-info.mjs`, `rig.js`, `actors.js` (skeleton as in 3.5, `load`/`resize`/`_place`/`start`/`pause`/`dispose` working, `play` working with any clip the FILE carries), `render-actor.mjs`, `test-baseball-actors.mjs` (node half + the load/dispose browser half), CSS for the actor canvas, the dev screen (3.7) mounted from `_openFrameCheck` showing both figures idle at the real anchors over the real backdrop | With the SCAFFOLD asset, then with `player.glb` once section 2.2 is filled | vendor import check (3.1); `node glb-info.mjs baseball/models/player.glb` prints the rig; `node test-baseball-actors.mjs`; `node render-actor.mjs` produces a PNG with a visible figure; `node test-game-conventions.mjs`; `node test-baseball-device.mjs` unchanged; no console error on mount | Sonnet |
| **2 The swing** | `poses.js` `Idle`, `Swing`, `Miss`; the batter's facing constant; the dev screen's clip buttons and scrubber | Pose keys matched to `batter-home-1..8.png` with `render-actor.mjs --beside` | A sheet, 3D over sprite, for frames 1 to 8 where every frame's silhouette agrees in lean, arm height, leg spread and bat angle (the orchestrator judges); `node test-baseball-actors.mjs` | Sonnet, Opus after two failed reviews |
| **3 The pitch, the bat, the colours** | `poses.js` `Set`, `Pitch`; `BAT` offsets; `TEAM` hexes and the recolour; the pitcher's facing | Matched to `Pitcher-home-1..4.png`; bat in both hands through the whole `Swing`; home white / away navy | Sheets as stage 2 for the pitch (4 frames) and for the swing WITH the bat (8 frames); a still of home and away side by side; `node test-baseball-actors.mjs` | Sonnet, Opus after two failed reviews |
| **4 The switch** | `ui.js` (3.6), `field.js` exports + `noFigures`, `strings.js` `load_model`, CSS, the `setBatter`/`setPitcher`/`setBall` bodies in `actors.js` | The live play screen on 3D, ball from the hand, load state, pause/resume, dispose | `node test-baseball-device.mjs` with r2-cadence inside 6219-6225 ms; `node test-baseball-actors.mjs` both halves; `node test-visual.mjs baseball` (open the sheet); `node check-no-scroll.mjs baseball`; `node test-game-conventions.mjs`; `node test-i18n-strings.mjs`; a screen recording substitute: 10 stills 100 ms apart through one pitch and one swing | Sonnet |
| **5 Delete, document, ship** | sprite-path deletion (3.10), `sw.js` `ASSETS`/`LAZY_REST`, `baseball/CLAUDE.md`, root `CLAUDE.md`, `HANDOFF-BASEBALL-3C.md` marked superseded by this file | | `node validate-sw-assets.mjs`; `node test-sw-strategy.mjs`; every stage 4 check again; `grep -c "batterFrame" baseball/js/ui.js` is 0 | Sonnet |

Stage 1 may start before section 2.2 is filled (scaffold asset). Stages 2 to 5 need the real model.

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
popup. If you think one is needed, say so in the report and build nothing for it.
