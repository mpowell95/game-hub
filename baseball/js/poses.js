// poses.js - clips authored as keyframed bone rotations (docs/BASEBALL-3D-BUILD.md section 3.4).
//
// A clip is a list of keyframes; a keyframe is `{ t, pose }` where `pose` maps semantic bone names
// (rig.js's RIG keys) to Euler rotations IN DEGREES applied ON TOP OF the bone's rest rotation.
// buildClip turns that into a real THREE.AnimationClip (one QuaternionKeyframeTrack per bone, plus
// one VectorKeyframeTrack for `hips` position when a keyframe carries `hipsOffset`), so everything
// downstream is the standard mixer: cross-fades, timeScale, LoopOnce, marks.
//
// Stage 1 shipped this file with every CLIPS entry's `keys` EMPTY on purpose: it was
// infrastructure actors.js needed to import and run before any pose existed. Stage 2 fills
// Idle/Swing/Miss below, authored against batter-home-1..8.png by rendering (render-actor.mjs)
// and comparing, never by imagining what a rotation does - see each clip's own comments for what
// keyframe matches which sprite frame. Stage 3 still owes Set/Pitch (matched to
// Pitcher-home-1..4.png) and the bat/team-colour work; those two keep empty `keys` until then.
// Until a clip has keys, actors.js falls back to a same-named clip carried by the GLB file itself
// (player.glb's own "Idle"), which is what lets Set play something (the file's Idle) rather than
// nothing on the pitcher today.
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
  Idle:  { loop: true,  mark: null, keys: [
    { t: 0, pose: {
      spine: [4, 45, 0],
      upperArmR: [50, -40, 0], lowerArmR: [60, 0, 0],
      upperArmL: [50, -40, 0], lowerArmL: [60, 0, 0],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 1, pose: {
      spine: [4, 45, 0],
      upperArmR: [50, -40, 0], lowerArmR: [60, 0, 0],
      upperArmL: [50, -40, 0], lowerArmL: [60, 0, 0],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
  ] },
  // Legs/hips stay close to Idle's stance through the whole swing (a real batter's back heel
  // lifts and the front leg straightens on contact, but that foot-level detail doesn't move the
  // silhouette the sprite frames are graded on - lean, arm height, leg spread, bat angle - so it's
  // left for a later pass rather than guessed here).
  // The left hand rides along with the right (both grip the same bat): giving upperArmL/lowerArmL
  // the SAME numbers as upperArmR/lowerArmR - not a mirrored (sign-flipped) copy - is what brings
  // the two hands together. The rig's L/R shoulders are already mirrored in the bind pose (found
  // rendering: a sign-flipped "mirror" sent the left hand flying out to its own side instead of
  // converging on the bat), so an identical local rotation on both arms is the one that reads as
  // one two-handed grip.
  Swing: { loop: false, mark: 0.22, keys: [
    // t=0.00 ~ batter-home-3 (loaded/cocked): torso twisted further than Idle, bat pulled back
    // near the ear.
    { t: 0.00, pose: {
      spine: [6, 60, 0],
      upperArmR: [50, -40, 0], lowerArmR: [65, -10, 0],
      upperArmL: [50, -40, 0], lowerArmL: [65, -10, 0],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.12 ~ batter-home-4 (swinging through): hips/torso untwisting, arm sweeping the bat
    // forward and down out of the cock.
    { t: 0.12, pose: {
      spine: [4, 25, 0],
      upperArmR: [48, 0, 0], lowerArmR: [35, -10, 35],
      upperArmL: [48, 0, 0], lowerArmL: [35, -10, 35],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.22 ~ batter-home-5 (contact): the mark. Arm extended, bat roughly horizontal reaching
    // toward the pitcher.
    { t: 0.22, pose: {
      spine: [2, 5, 0],
      upperArmR: [42, 10, 0], lowerArmR: [0, 0, 62],
      upperArmL: [42, 10, 0], lowerArmL: [0, 0, 62],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.30 ~ batter-home-6: just past contact, arm still extended, hips continuing to open.
    { t: 0.30, pose: {
      spine: [0, -10, 0],
      upperArmR: [38, 15, 0], lowerArmR: [-15, 0, 55],
      upperArmL: [38, 15, 0], lowerArmL: [-15, 0, 55],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.42 ~ batter-home-7 (early follow-through): bat wrapping up over the far shoulder.
    { t: 0.42, pose: {
      spine: [-2, -30, 0],
      upperArmR: [42, 0, 0], lowerArmR: [-45, 0, -35],
      upperArmL: [42, 0, 0], lowerArmL: [-45, 0, -35],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.55 ~ batter-home-8 (full follow-through, held).
    { t: 0.55, pose: {
      spine: [-2, -38, 0],
      upperArmR: [55, -15, 0], lowerArmR: [45, 0, -80],
      upperArmL: [55, -15, 0], lowerArmL: [45, 0, -80],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
  ] },
  // A copy of Swing (section 3.4: "may start as a copy of Swing with a higher, later barrel") -
  // the arm rides higher through the contact window (upperArm X +12 at the three middle
  // keyframes, so the barrel passes above where Swing makes contact) and `mark` sits on the
  // t=0.30 keyframe instead of t=0.22, so the whiff reads as a beat late as well as high.
  Miss:  { loop: false, mark: 0.30, keys: [
    { t: 0.00, pose: {
      spine: [6, 60, 0],
      upperArmR: [50, -40, 0], lowerArmR: [65, -10, 0],
      upperArmL: [50, -40, 0], lowerArmL: [65, -10, 0],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.12, pose: {
      spine: [4, 25, 0],
      upperArmR: [60, 0, 0], lowerArmR: [35, -10, 35],
      upperArmL: [60, 0, 0], lowerArmL: [35, -10, 35],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.22, pose: {
      spine: [2, 5, 0],
      upperArmR: [54, 10, 0], lowerArmR: [0, 0, 62],
      upperArmL: [54, 10, 0], lowerArmL: [0, 0, 62],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.30: the mark - bat swept through above and a beat later than where Swing connects.
    { t: 0.30, pose: {
      spine: [0, -10, 0],
      upperArmR: [50, 15, 0], lowerArmR: [-15, 0, 55],
      upperArmL: [50, 15, 0], lowerArmL: [-15, 0, 55],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.42, pose: {
      spine: [-2, -30, 0],
      upperArmR: [42, 0, 0], lowerArmR: [-45, 0, -35],
      upperArmL: [42, 0, 0], lowerArmL: [-45, 0, -35],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.55, pose: {
      spine: [-2, -38, 0],
      upperArmR: [55, -15, 0], lowerArmR: [45, 0, -80],
      upperArmL: [55, -15, 0], lowerArmL: [45, 0, -80],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
  ] },
  Set:   { loop: true,  mark: null, keys: [ /* stage 3: matches Pitcher-home-1 */ ] },
  Pitch: { loop: false, mark: 0.80, keys: [ /* stage 3: matches Pitcher-home-2..4 */ ] },
};
