// poses.js - clips authored as keyframed bone rotations (docs/BASEBALL-3D-BUILD.md section 3.4).
//
// A clip is a list of keyframes; a keyframe is `{ t, pose }` where `pose` maps semantic bone names
// (rig.js's RIG keys) to Euler rotations IN DEGREES applied ON TOP OF the bone's rest rotation.
// buildClip turns that into a real THREE.AnimationClip (one QuaternionKeyframeTrack per bone, plus
// one VectorKeyframeTrack for `hips` position when a keyframe carries `hipsOffset`), so everything
// downstream is the standard mixer: cross-fades, timeScale, LoopOnce, marks.
//
// Stage 1 shipped this file with every CLIPS entry's `keys` EMPTY on purpose: it was
// infrastructure actors.js needed to import and run before any pose existed. Stage 2 filled
// Idle/Swing/Miss, authored against batter-home-1..8.png by rendering (render-actor.mjs) and
// comparing, never by imagining what a rotation does. Stage 3 fills Set/Pitch the same way,
// against Pitcher-home-1..4.png - see each clip's own comments for what keyframe matches which
// sprite frame, and actors.js for the team-colour/bat work done alongside it. Until a clip has
// keys, actors.js falls back to a same-named clip carried by the GLB file itself (player.glb's own
// "Idle") - true of nothing now that every CLIPS entry below carries real keys.
//
// STAGE 6 (2026-09-19, docs/BASEBALL-3D-BUILD.md section 7) re-authored the MOTION, after Matt
// watched the shipped build on his phone: "They look way too much like just flat images (because
// they are)... Timing is a huge issue as well." Stages 2 and 3 had matched every POSE to its sprite
// frame and never measured what moved BETWEEN them, and at the sizes these figures actually draw
// (the batter 214 px tall, 0.50 of the 429 px field band at 393x852; the pitcher 47 px, 0.11 of it)
// the answer was: almost nothing. Measured on the real model through the real mixer - Idle moved no
// bone at all, Set moved the pitcher's hand 0.4 px over its whole loop, and the entire Pitch
// delivery moved his throwing hand 20.1 px of path with 9.0 px of vertical, with the first 30% of
// the clip a held still. The rule this pass added, and the reason every clip below now quotes px
// rather than adjectives: A POSE IS GRADED AGAINST THE SPRITE, A MOTION IS GRADED IN PIXELS AT THE
// SIZE IT WILL BE SEEN. test-baseball-actors.mjs's own chromium block plays each clip at
// timeScale 1, steps the mixer in 1/60 s increments and samples RIG bone WORLD positions, so every
// number in the comments below is re-measured on every run and a clip that goes flat again fails.
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
  // THE IDLE LOOP (stage 6, 2026-09-19). Matt, on a screen recording of the shipped build: "They
  // look way too much like just flat images (because they are)." He was right about this one in the
  // most literal way available: Idle shipped with TWO keyframes holding the SAME pose, so the mixer
  // ran and not one bone moved. Measured on the real model at the batter's real on-screen height of
  // 214 px, handR's world position was constant to 0.0 px across the whole loop.
  //
  // It is a 2.4 s loop now (section 3.4's own "2 to 3 s"), and every number in it was rendered and
  // then MEASURED, not estimated. What carries the motion, and why it is those bones:
  //   1. The weight shift is `hipsOffset` local Z plus the two knees. At the batter's facing
  //      (BATTER_FACING_RAD, 95 degrees) the hips bone's LOCAL z is SCREEN X: measured, 0.25 units
  //      of local z moves the whole figure 14.1 px sideways at 214 px, and local x moves it into
  //      the screen where it is worth almost nothing. So the shift is +/-0.10 of local z (about
  //      +/-5.6 px), with lowerLegR/lowerLegL trading their bend so the weight reads as going onto
  //      one leg and then the other rather than the body sliding.
  //   2. The bat waggle is the WRIST (handR/handL Z), the same lever the load pose uses, swinging
  //      the barrel between 34 and about 50 degrees off vertical at the top of the loop. It is
  //      deliberately NOT part of the 8 px hand-travel budget and cannot be: a wrist rotation turns
  //      the hand bone about its own origin, so handR's world POSITION does not move by a
  //      measurable amount (measured: 0.0 px). The bat moves; the number comes from the body.
  //   3. The head holds at about -18 degrees of Y against a spine wound to +45, which is what keeps
  //      the face pointed at the pitcher instead of turning away with the shoulders (rendered at
  //      -20/0/+20 beside batter-home-1.png: -Y is the pitcher's side).
  // Measured after: handR travels 20.7 px over the loop and the hips 12.2 px, at 214 px. Every
  // frozen frame still reads as batter-home-1.png's stance, which is the constraint that keeps the
  // amplitudes where they are.
  //
  // t=0 is Swing's and Miss's first keyframe, bone for bone. Stage 7 starts the swing with NO
  // cross-fade, so the pose the swing opens on has to be the pose the batter is already standing
  // in. The residual, stated honestly because it cannot be designed away: a loop that moves is a
  // loop that is somewhere else at every other phase, and the worst case measured 10.7 px of hand
  // offset from the rest pose (5% of the figure's height), which is what a swing starting at the
  // far end of the weight shift will jump on its first frame.
  Idle:  { loop: true,  mark: null, keys: [
    { t: 0.00, pose: {
      spine: [4, 45, 0], head: [0, -18, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -50],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -50],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // Weight back onto the rear (right) leg: that knee folds, the front leg straightens, the body
    // settles 0.02 units lower and 5.6 px back along the stance line.
    { t: 0.60, pose: {
      spine: [5, 45, -5], head: [0, -21, 0],
      upperArmR: [62, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -56],
      upperArmL: [62, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -56],
      upperLegR: [-13, 0, 0], lowerLegR: [0, 0, 38],
      upperLegL: [12, 0, 0], lowerLegL: [0, 0, 12],
    }, hipsOffset: [0, 0.36, -0.10] },
    // The top of the loop: weight forward onto the front leg, the body its highest, and the waggle
    // at its widest (the wrist at -34 against the rest pose's -50).
    { t: 1.20, pose: {
      spine: [3, 46, 6], head: [0, -15, 0],
      upperArmR: [56, 0, 62], lowerArmR: [100, 0, 15], handR: [10, 0, -34],
      upperArmL: [56, 0, 62], lowerArmL: [100, 0, 15], handL: [10, 0, -34],
      upperLegR: [-5, 0, 0], lowerLegR: [0, 0, 22],
      upperLegL: [18, 0, 0], lowerLegL: [0, 0, 26],
    }, hipsOffset: [0, 0.28, 0.10] },
    // Back through the rear leg, with a smaller second waggle, so the loop is two uneven beats
    // rather than one metronome swing.
    { t: 1.80, pose: {
      spine: [5, 45, -3], head: [0, -21, 0],
      upperArmR: [61, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -58],
      upperArmL: [61, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -58],
      upperLegR: [-11, 0, 0], lowerLegR: [0, 0, 35],
      upperLegL: [13, 0, 0], lowerLegL: [0, 0, 15],
    }, hipsOffset: [0, 0.34, -0.06] },
    // Closes on the rest pose exactly, so the loop has no seam.
    { t: 2.40, pose: {
      spine: [4, 45, 0], head: [0, -18, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -50],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -50],
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
  //
  // STAGE 6 changed exactly two things about this clip and nothing else. The pose that used to sit
  // at t=0 (the load, batter-home-3) is now at t=0.10, with Idle's RESTING pose at t=0 in front of
  // it, and the old t=0.12 key moved to t=0.16 to leave room. Every keyframe from the mark on keeps
  // its shipped time, so the accepted swing's real timing is untouched: actors.js sets
  // `timeScale = mark / (markAtMs / 1000)` = 0.22 / 0.08 = 2.75 at the engine's 80 ms, which puts
  // the load 36 ms after the press and contact still at exactly 80 ms, and leaves the whole
  // follow-through (0.22 to 0.55 of clip time, 120 ms of real time) exactly as it shipped. The
  // reason for the lead-in is stage 7: it removes the 150 ms cross-fade, so the first frame of the
  // swing is whatever this clip says at t=0, and a clip that opens on the load pose would have
  // snapped the bat from the idle stance's 34 degrees to the load's 69 in a single frame. Rendered
  // against batter-home-1/3/4/5/6/7/8 at 0.00/0.10/0.16/0.22/0.30/0.42/0.55, the silhouettes still
  // agree frame for frame.
  Swing: { loop: false, mark: 0.22, keys: [
    // t=0.00: Idle's resting pose, bone for bone (see Idle's own note above).
    { t: 0.00, pose: {
      spine: [4, 45, 0], head: [0, -18, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -50],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -50],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.10 ~ batter-home-3 (loaded/cocked): torso wound up, hands together at the rear shoulder,
    // barrel back over that shoulder, front (left) leg already strode forward. Same arm and elbow
    // numbers as Idle (see the load-pose note above it); only the wrist differs, at [10,0,-10]
    // rather than Idle's [10,0,-50], because this is the frame where the barrel has flattened out
    // from 34 to 69 degrees off vertical in the sprites. The wrist unwinds to zero by t=0.16 and
    // stays there, so every keyframe from contact on is untouched by this.
    { t: 0.10, pose: {
      spine: [6, 60, 0], head: [0, -24, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -10],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -10],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    // t=0.16 ~ batter-home-4: torso unwinding, the arm swept out of the cock into the level reach.
    { t: 0.16, pose: {
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
    // t=0.30 ~ batter-home-6: just past contact, still level, arms unchanged from contact - the
    // torso alone carries it on toward square (see the dead-zone note above; this is as far as
    // spine.y goes before jumping past the zone between here and t=0.42).
    // Round 3 correction (coordinator review): the BAT vanished here. Measured, this keyframe was
    // the instant the barrel pointed almost straight at the camera (tip 34 px right of the knob and
    // 189 px toward the viewer), so it rendered as a stub behind the arm. The wrists roll over here
    // - handR/L [50,0,-30] - which carries the barrel on round the arc to 138 px of visible length,
    // level (2 px of screen rise over its whole length) and still 134 px toward the camera. It is
    // the direction the swing is already travelling, measured in the xz plane: 20 degrees at
    // contact, -46 here, -62 at t=0.42, so the barrel sweeps one way throughout with no hitch. The
    // wrist is back at zero by t=0.42, which is why the follow-through frames are unchanged.
    { t: 0.30, pose: {
      spine: [2, 0, 0], head: [0, 0, 0],
      upperArmR: [-8, 48, 0], lowerArmR: [0, 0, 10], handR: [50, 0, -30],
      upperArmL: [-8, 48, 0], lowerArmL: [0, 0, 10], handL: [50, 0, -30],
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
  // X rides 12-14deg higher through the reach-and-contact window (t=0.16/0.22/0.30) so the barrel
  // passes above where Swing connects, and `mark` sits on the t=0.30 keyframe instead of Swing's
  // t=0.22, so the whiff reads as a beat late as well as high. Stage 6 gave it the same t=0 rest
  // pose and the same t=0.10 load as Swing, for the same no-cross-fade reason.
  Miss:  { loop: false, mark: 0.30, keys: [
    // Same load pose as Swing, bone for bone (round 3): a batter has not decided to miss yet when
    // he loads, and the two clips cross-fade into each other from Idle.
    { t: 0.00, pose: {
      spine: [4, 45, 0], head: [0, -18, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -50],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -50],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.10, pose: {
      spine: [6, 60, 0], head: [0, -24, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -10],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -10],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 0.16, pose: {
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
    // t=0.30: the mark - bat swept through above and a beat later than where Swing connects. The
    // wrists carry the SAME [50,0,-30] roll as Swing's own t=0.30 (round 3), so the barrel is in
    // view at the whiff instant rather than end-on to the camera; measured on this clip's own
    // higher arm it renders 146 px long with the tip 24 px ABOVE the knob, against Swing's level
    // 138 px - the miss reads high, which is the whole point of the clip.
    { t: 0.30, pose: {
      spine: [2, 0, 0], head: [0, 0, 0],
      upperArmR: [8, 48, 0], lowerArmR: [0, 0, 5], handR: [50, 0, -30],
      upperArmL: [8, 48, 0], lowerArmL: [0, 0, 5], handL: [50, 0, -30],
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
  // STAGE 3: the pitcher, at PITCHER_FACING_RAD (actors.js - 0, the model's own front axis, since
  // the pitcher faces the camera square-on rather than sideways like the batter). Measured
  // rendering `probe`-style raw poses against Pitcher-home-1..4.png before these numbers were
  // ever written into a clip (same method as the batter's load-pose rounds): a bone-position
  // check (rotate just upperLegR, render, look) proved facingRad=0 does NOT mirror the model's own
  // R/L bones onto the SAME screen side you'd guess from "front axis is +Z" alone - `handR` and
  // `upperLegR` both land on the SCREEN-LEFT side, same convention as a real person facing you.
  // That is what fixes `handR` as the throwing hand per the brief ("the ball leaves handR"): the
  // hand you see extend forward at the release keyframe below is the model's RightHand, appearing
  // screen-left, exactly like Pitcher-home-3's visible throwing arm.
  //
  // ROUND 2 correction (coordinator review): the two-handed grip is NOT a case of "identical local
  // rotations always converge on the centerline" - that was round 1's claim, copied from the
  // batter's load pose, and it is false in general. Measured directly (a rest-pose printout,
  // `restQ` as Euler angles): the rig's L/R arm bones are NOT simple mirror images of each other in
  // their bind pose (`handR` rest reads `[0.9, 0, -3.8]` degrees, `handL` rest reads
  // `[-173.8, 87, 169.9]` - wildly different Euler triples, not a sign flip), so applying the SAME
  // local offset composes into a DIFFERENT world rotation per side. It only looked like a universal
  // rule because the batter's specific numbers happened to still converge; here they did not -
  // round 1 shipped a Set pose with `upperArmR:[65,0,-25]` reused verbatim from that batter number,
  // and it put handR ABOVE the head (world y=-77, HIGHER than head's own y=-128) while handL landed
  // at a normal chest height (y=-180) - exactly the reported "one hand up beside the head" defect.
  // The fix is empirical, not a formula: `upperArmR` was swept on its own (a bones-only probe, no
  // render, reading `handR`'s world position directly) until it reached roughly the SAME world
  // position handL already had (`[65,0,120]` lands handR at world `[237,-181,63]` against handL's
  // own `[234,-180,86]` - close enough that the two hands read as touching), then confirmed by
  // rendering beside Pitcher-home-1.png. `lowerArmR`/`handR` did not need to change, only
  // `upperArmR`'s own Z swung from -25 to +120 - this rig's mirror asymmetry lives in how far each
  // side's Z axis has to travel from its own rest, not in the other two axes.
  //
  // STAGE 6: the shipped Set moved handR 0.4 px over its whole loop at the pitcher's real 47 px, so
  // it read as a photograph. It carries a slow breath (the arms rise and the body lifts 0.06 units
  // over the first 0.9 s) and a glove tap (the elbows fold and the hands push down and out at
  // t=1.5, then settle) now: measured handR travel 5.0 px, hips 1.2 px. `hipsOffset` here is
  // relative to the BIND pose and stays near zero, unlike the batter's, whose crouched legs need a
  // constant 0.32 of drop to put his feet back on the anchor - the pitcher stands with his legs
  // straight, so any drop would bury his feet in the mound (measured: 0.32 of local y is 4.0 px at
  // 47 px, 8% of his height).
  Set:   { loop: true, mark: null, keys: [
    // The set itself (matches Pitcher-home-1), and the pose Pitch opens on, bone for bone.
    { t: 0.00, pose: {
      upperArmR: [65, 0, 120], lowerArmR: [55, 0, 15], handR: [10, 0, -15],
      upperArmL: [65, 0, -25], lowerArmL: [55, 0, 15], handL: [10, 0, -15],
    } },
    // The breath, at the top: the chest opens, the hands ride up with it, the knees soften.
    { t: 0.90, pose: {
      spine: [1, 0, 2],
      upperArmR: [78, 0, 123], lowerArmR: [48, 0, 15], handR: [10, 0, -15],
      upperArmL: [78, 0, -28], lowerArmL: [48, 0, 15], handL: [10, 0, -15],
      upperLegR: [-3, 0, 0], lowerLegR: [0, 0, 5],
      upperLegL: [3, 0, 0], lowerLegL: [0, 0, 5],
    }, hipsOffset: [0, -0.06, 0] },
    // The glove tap: both elbows fold hard and the hands push down and forward together. It is the
    // one beat in this loop big enough to see at 47 px, which is why it is a tap and not a sway.
    { t: 1.50, pose: {
      spine: [3, 0, 0],
      upperArmR: [50, 0, 138], lowerArmR: [95, 0, 15], handR: [10, 0, -24],
      upperArmL: [50, 0, -43], lowerArmL: [95, 0, 15], handL: [10, 0, -24],
    }, hipsOffset: [0, 0.04, 0] },
    // Settling back through the set, a little past it, so the loop does not read as a metronome.
    { t: 1.75, pose: {
      spine: [0, 0, -1],
      upperArmR: [72, 0, 114], lowerArmR: [46, 0, 15], handR: [10, 0, -15],
      upperArmL: [72, 0, -19], lowerArmL: [46, 0, 15], handL: [10, 0, -15],
    }, hipsOffset: [0, -0.02, 0] },
    { t: 2.40, pose: {
      upperArmR: [65, 0, 120], lowerArmR: [55, 0, 15], handR: [10, 0, -15],
      upperArmL: [65, 0, -25], lowerArmL: [55, 0, 15], handL: [10, 0, -15],
    } },
  ] },
  // mark=1.0 is the release keyframe (t=1.0 below); actors.js's `play()` sets `timeScale` so that
  // instant lands at exactly WINDUP_MS (1400ms) after the clip starts (R1). The leg lift keyframe
  // sits at t=0.45 - 45% of the way to the mark, per section 3.4's own rule - which the timeScale
  // rescale carries into real time unchanged (630ms into the 1400ms windup, still 45%). The
  // follow-through keyframe at t=1.3 is the clip's own tail, 300ms of clip time past the mark
  // (~420ms of real windup time at this clip's timeScale), then clamped and held (LoopOnce,
  // clampWhenFinished) until the next pitch's Set/Pitch crossfade takes over.
  //
  // Legs: rendering (not guessing) settled which of the rig's L/R legs plants and which trails.
  // Pitcher-home-2 (leg lift) shows the STANDING leg on screen-right and the RAISED leg on
  // screen-left; by the facingRad=0 mapping above (R bones -> screen-left), that is upperLegL
  // standing, upperLegR lifting - so upperLegR carries the whole lift/trail motion (leg lift ->
  // still swinging behind at release -> swung up high at follow-through) while upperLegL only
  // ever plants (neutral at the lift, forward and weight-bearing from release on).
  //
  // STAGE 6 REWROTE THE DELIVERY. Measured on the shipped clip at the pitcher's real 47 px: the
  // throwing hand travelled 20.1 px of path with 9.0 px of vertical over the WHOLE pitch, the first
  // 30% of the clip moved nothing at all, and the arm went from tucked to extended without ever
  // going up - which is why Matt's recording reads as a picture that slides. The delivery now has
  // the five beats a thrown ball actually has, and every one of them was measured on the real model
  // rather than imagined. handR's world position at each keyframe, in canvas px at 47 px tall, with
  // the body's centre line at x=18.5 and the head bone at y=25 to 29:
  //     t=0.00 set      (21.8, 31.9)  hands tucked together at the chest
  //     t=0.14 rock     (20.1, 32.1)  the weight goes back, the hands lift: the clip MOVES from
  //                                   its first keyframe, which is the defect this fixes
  //     t=0.45 kick     (16.9, 32.8)  the leg is up (footR rises 16.3 px, to hip height) and the
  //                                   torso is closed 40 degrees away from the plate
  //     t=0.68 break    (13.6, 44.5)  the hands separate and the throwing arm swings all the way
  //                                   DOWN past the hip - the lowest the arm can reach, and where
  //                                   most of the clip's vertical comes from
  //     t=0.86 cock     (20.2, 20.0)  over the top: the hand above the head, the highest point of
  //                                   the whole clip, the stride foot coming down
  //     t=1.00 release  ( 9.3, 27.4)  the mark. Screen-LEFT of the body by 9 px, above the head
  //                                   bone, and further toward the camera (z 12.8) than any other
  //                                   keyframe: hand forward and high, as Pitcher-home-3 has it
  //     t=1.30 follow   (26.1, 35.2)  across the body to the far side, the drive leg up behind
  // Measured over the clip: 92.9 px of hand path with 25.7 px of vertical, 17.4 px of front-foot
  // lift, 3.1 px of hand movement inside the first 20%, and a 68 degree spine Y sweep from closed
  // (-40) to open (+28). The numbers the brief set were 45 / 20 / 10 / 2.
  Pitch: { loop: false, mark: 1.0, keys: [
    // t=0: identical to Set's own base pose, so the Set->Pitch crossfade (actors.js CROSSFADE_S)
    // has nothing to blend across.
    { t: 0.00, pose: {
      upperArmR: [65, 0, 120], lowerArmR: [55, 0, 15], handR: [10, 0, -15],
      upperArmL: [65, 0, -25], lowerArmL: [55, 0, 15], handL: [10, 0, -15],
    } },
    // t=0.14, the rock: the weight settles back onto the rear leg, the hands lift, the torso starts
    // to close. Small, but it is the keyframe that stops the first third of the delivery being a
    // held still (the head turns with it, counter-rotating the spine at about half its angle so the
    // face keeps looking at the plate).
    { t: 0.14, pose: {
      spine: [-4, -14, 0], head: [0, 7, 0],
      upperArmR: [78, 0, 127], lowerArmR: [70, 0, 15], handR: [10, 0, -15],
      upperArmL: [78, 0, -32], lowerArmL: [70, 0, 15], handL: [10, 0, -15],
      upperLegR: [-14, 0, 0], lowerLegR: [0, 0, 14],
      upperLegL: [5, 0, 0], lowerLegL: [0, 0, 7],
    }, hipsOffset: [0, -0.06, 0] },
    // t=0.45 (45% to the mark): the leg kick, ~Pitcher-home-2. upperLegR to -105 with the shin
    // hanging at 95 puts the knee at chest height and the foot at the hip, 16.3 px of lift at a
    // 47 px figure. The torso is at its most closed here (spine Y -40) and the hands are still
    // together and high, exactly as the sprite has them.
    { t: 0.45, pose: {
      spine: [-2, -40, 0], head: [0, 20, 0],
      upperArmR: [82, 0, 128], lowerArmR: [72, 0, 15], handR: [10, 0, -15],
      upperArmL: [82, 0, -33], lowerArmL: [72, 0, 15], handL: [10, 0, -15],
      upperLegR: [-105, 0, 0], lowerLegR: [0, 0, 95],
      upperLegL: [0, 0, 0], lowerLegL: [0, 0, 4],
    }, hipsOffset: [0, -0.06, 0] },
    // t=0.68, the hand break: the glove goes out toward the plate and the throwing arm swings down
    // and back with the elbow straight, which is the lowest this rig's hand can reach (measured by
    // sweeping upperArmR's X and Z on their own and reading handR's world y: the hand bottoms out
    // at hip height whatever the combination, so the extra 2.8 px comes from the hips dipping).
    { t: 0.68, pose: {
      spine: [0, -38, 0], head: [0, 19, 0],
      upperArmR: [-95, 0, 10], lowerArmR: [12, 0, 0], handR: [0, 0, 0],
      upperArmL: [70, 0, -45], lowerArmL: [80, 0, 15], handL: [10, 0, -15],
      upperLegR: [-60, 0, 0], lowerLegR: [0, 0, 55],
      upperLegL: [8, 0, 0], lowerLegL: [0, 0, 12],
    }, hipsOffset: [0, 0.23, 0] },
    // t=0.86, over the top: the arm comes up past vertical with the elbow half folded, the hand
    // above the head, the torso starting to open. This is the keyframe that makes the throw read as
    // a throw - the shipped clip went straight from tucked to extended and never passed through it.
    { t: 0.86, pose: {
      spine: [3, -25, 0], head: [0, 12, 0],
      upperArmR: [112, -5, 0], lowerArmR: [40, 0, 0], handR: [0, 0, 0],
      upperArmL: [62, 0, -52], lowerArmL: [88, 0, 15], handL: [10, 0, -15],
      upperLegR: [-45, 0, 0], lowerLegR: [0, 0, 35],
      upperLegL: [18, 0, 0], lowerLegL: [0, 0, 22],
    }, hipsOffset: [0, -0.02, 0] },
    // t=1.00, the mark (~Pitcher-home-3): the release. 0.14 s of clip time after the cock, which is
    // the fastest segment in the clip by design. upperArmR's Y is the axis that reaches the hand
    // toward the camera, its X holds the hand above the shoulder, and its Z carries it across to
    // the screen-left side the sprite shows the throwing arm on. The glove tucks down to the chest.
    // The legs are at their widest: upperLegL planted and weight-bearing, upperLegR still trailing,
    // and the hips at their lowest (0.28) so the whole body drops into the stride.
    { t: 1.00, pose: {
      spine: [12, 15, 0], head: [0, -8, 0],
      upperArmR: [6, 38, 50], lowerArmR: [8, 0, 0], handR: [0, 0, 0],
      upperArmL: [60, 0, -60], lowerArmL: [95, 0, 15], handL: [10, 0, -15],
      upperLegR: [-30, 0, 0], lowerLegR: [0, 0, 45],
      upperLegL: [35, 0, 0], lowerLegL: [0, 0, 18],
    }, hipsOffset: [0, 0.28, 0] },
    // t=1.30: follow-through (~Pitcher-home-4), the clip's own tail, held after the mark. The
    // throwing arm sweeps down and ACROSS the body to decelerate (upperArmR's Z carries it past the
    // centre line to the far side, measured at x=26.1 against the body's 18.5) rather than staying
    // held out - rendering the release's own arm numbers un-changed here read as a frozen reach,
    // not a finished throw. upperLegR swings back up high behind, upperLegL settles into the plant,
    // and the spine finishes 68 degrees around from where the kick had it.
    { t: 1.30, pose: {
      spine: [30, 28, 0], head: [0, -16, 0],
      upperArmR: [40, -10, 175], lowerArmR: [55, 0, -15], handR: [0, 0, 0],
      upperArmL: [50, 0, -20], lowerArmL: [75, 0, 10], handL: [10, 0, -15],
      upperLegR: [-70, 0, 0], lowerLegR: [0, 0, 90],
      upperLegL: [28, 0, 0], lowerLegL: [0, 0, 30],
    }, hipsOffset: [0, 0.23, 0] },
  ] },
};
