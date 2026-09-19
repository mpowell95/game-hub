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
  // The back (right) leg stays close to Idle's stance throughout; the front (left) leg strides
  // forward (upperLegL.x 15 -> 28) through the load and contact window, per the sprite frames -
  // batter-home-3/4/5 all show that foot planted ahead of its Idle position. It eases back toward
  // Idle's 15deg by the follow-through (t=0.42/0.55), once the swing is decided and the sprite's
  // own stance relaxes again. A real batter's back heel also lifts on contact, but that foot-level
  // detail doesn't move the silhouette the sprite frames are graded on, so it's left for later.
  // The left hand rides along with the right (both grip the same bat): giving upperArmL/lowerArmL
  // the SAME numbers as upperArmR/lowerArmR - not a mirrored (sign-flipped) copy - is what brings
  // the two hands together. The rig's L/R shoulders are already mirrored in the bind pose (found
  // rendering: a sign-flipped "mirror" sent the left hand flying out to its own side instead of
  // converging on the bat), so an identical local rotation on both arms is the one that reads as
  // one two-handed grip.
  // Round 2 correction (coordinator review): round 1 tried to get the whole sweep out of the arm
  // bones alone, which only has so much reach before the elbow folds back on itself (found
  // rendering - upperArmR.y past ~50-55deg stops extending the arm further and starts curling it
  // back toward the chest instead). The torso (spine Y) now carries most of the sweep - it winds
  // up to 60deg at the load and unwinds toward zero by contact - while the arm's OWN local pose
  // stays inside its safe, non-folding range throughout and just holds a level, extended reach;
  // the two compose into the swing's full turn. `head` counter-rotates against `spine` at roughly
  // 0.4x, so the face keeps reading as looking toward the pitcher instead of snapping fully around
  // with the shoulders. spine.y=-10ish is a DEAD ZONE at this facing (found rendering a plain
  // sweep of it in isolation): the torso reads as facing the CAMERA there, not the pitcher, before
  // coming back around on the other side - t=0.30 stops at 0deg rather than continuing negative,
  // and 0.42/0.55 jump straight to -30/-38, so no rendered keyframe ever lands inside that zone
  // (the mixer still sweeps through it between keyframes, just never holds a still there).
  Swing: { loop: false, mark: 0.22, keys: [
    // t=0.00 ~ batter-home-3 (loaded/cocked): torso wound up, bat pulled back near the ear, front
    // (left) leg already strode forward.
    { t: 0.00, pose: {
      spine: [6, 60, 0], head: [0, -24, 0],
      upperArmR: [50, -40, 0], lowerArmR: [60, 0, 0],
      upperArmL: [50, -40, 0], lowerArmL: [60, 0, 0],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.12 ~ batter-home-4: torso unwinding, the arm swept out of the cock into the level reach.
    { t: 0.12, pose: {
      spine: [4, 35, 0], head: [0, -14, 0],
      upperArmR: [15, 10, 0], lowerArmR: [15, 0, 25],
      upperArmL: [15, 10, 0], lowerArmL: [15, 0, 25],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.22 ~ batter-home-5 (contact): the mark. Both arms extended away from the torso, bat
    // level at belt-to-chest height, pointing toward the pitcher.
    { t: 0.22, pose: {
      spine: [2, 10, 0], head: [0, -4, 0],
      upperArmR: [-8, 48, 0], lowerArmR: [0, 0, 10],
      upperArmL: [-8, 48, 0], lowerArmL: [0, 0, 10],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.30 ~ batter-home-6: just past contact, still level, arm/bat unchanged from contact - the
    // torso alone carries it on toward square (see the dead-zone note above; this is as far as
    // spine.y goes before jumping past the zone between here and t=0.42).
    { t: 0.30, pose: {
      spine: [2, 0, 0], head: [0, 0, 0],
      upperArmR: [-8, 48, 0], lowerArmR: [0, 0, 10],
      upperArmL: [-8, 48, 0], lowerArmL: [0, 0, 10],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [22, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.42 ~ batter-home-7 (early follow-through): bat wrapping up over the far shoulder.
    { t: 0.42, pose: {
      spine: [-2, -30, 0], head: [0, 12, 0],
      upperArmR: [42, 0, 0], lowerArmR: [-45, 0, -35],
      upperArmL: [42, 0, 0], lowerArmL: [-45, 0, -35],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.55 ~ batter-home-8 (full follow-through, held).
    { t: 0.55, pose: {
      spine: [-2, -38, 0], head: [0, 15, 0],
      upperArmR: [55, -15, 0], lowerArmR: [45, 0, -80],
      upperArmL: [55, -15, 0], lowerArmL: [45, 0, -80],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
  ] },
  // A copy of Swing (section 3.4: "may start as a copy of Swing with a higher, later barrel") -
  // same spine/head/leg timing (the body commits to the same swing either way), but upperArmR/L's
  // X rides 12-14deg higher through the reach-and-contact window (t=0.12/0.22/0.30) so the barrel
  // passes above where Swing connects, and `mark` sits on the t=0.30 keyframe instead of Swing's
  // t=0.22, so the whiff reads as a beat late as well as high.
  Miss:  { loop: false, mark: 0.30, keys: [
    { t: 0.00, pose: {
      spine: [6, 60, 0], head: [0, -24, 0],
      upperArmR: [50, -40, 0], lowerArmR: [60, 0, 0],
      upperArmL: [50, -40, 0], lowerArmL: [60, 0, 0],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.12, pose: {
      spine: [4, 35, 0], head: [0, -14, 0],
      upperArmR: [29, 10, 0], lowerArmR: [15, 0, 25],
      upperArmL: [29, 10, 0], lowerArmL: [15, 0, 25],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.22, pose: {
      spine: [2, 10, 0], head: [0, -4, 0],
      upperArmR: [6, 48, 0], lowerArmR: [0, 0, 10],
      upperArmL: [6, 48, 0], lowerArmL: [0, 0, 10],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.30: the mark - bat swept through above and a beat later than where Swing connects.
    { t: 0.30, pose: {
      spine: [2, 0, 0], head: [0, 0, 0],
      upperArmR: [8, 48, 0], lowerArmR: [0, 0, 5],
      upperArmL: [8, 48, 0], lowerArmL: [0, 0, 5],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [22, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.42, pose: {
      spine: [-2, -30, 0], head: [0, 12, 0],
      upperArmR: [42, 0, 0], lowerArmR: [-45, 0, -35],
      upperArmL: [42, 0, 0], lowerArmL: [-45, 0, -35],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.55, pose: {
      spine: [-2, -38, 0], head: [0, 15, 0],
      upperArmR: [55, -15, 0], lowerArmR: [45, 0, -80],
      upperArmL: [55, -15, 0], lowerArmL: [45, 0, -80],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
  ] },
  Set:   { loop: true,  mark: null, keys: [ /* stage 3: matches Pitcher-home-1 */ ] },
  Pitch: { loop: false, mark: 0.80, keys: [ /* stage 3: matches Pitcher-home-2..4 */ ] },
};
