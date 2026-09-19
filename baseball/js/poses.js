// poses.js - clips authored as keyframed bone rotations (docs/BASEBALL-3D-BUILD.md section 3.4).
//
// A clip is a list of keyframes; a keyframe is `{ t, pose }` where `pose` maps semantic bone names
// (rig.js's RIG keys) to Euler rotations IN DEGREES applied ON TOP OF the bone's rest rotation.
// buildClip turns that into a real THREE.AnimationClip (one QuaternionKeyframeTrack per bone, plus
// one VectorKeyframeTrack for `hips` position when a keyframe carries `hipsOffset`), so everything
// downstream is the standard mixer: cross-fades, timeScale, LoopOnce, marks.
//
// Stage 1 ships this file with every CLIPS entry's `keys` EMPTY on purpose: it is infrastructure
// actors.js needs to import and run today, against poses authored later. Stage 2 fills Idle/Swing/
// Miss (matched to batter-home-1..8.png); stage 3 fills Set/Pitch (matched to Pitcher-home-1..4.png)
// and the bat/team-colour work. Until a clip has keys, actors.js falls back to a same-named clip
// carried by the GLB file itself (the scaffold's own 'Idle', 'Dance', 'Wave', ...), which is what
// lets the stage 1 dev screen show an idle figure with no authored poses yet.
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
