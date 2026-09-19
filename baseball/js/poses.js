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
  // THE LOAD POSE (round 3 correction, coordinator review). Rounds 1 and 2 held the bat straight
  // up out of the top of the frame with the hands at head height; batter-home-1/2/3 hold it BEHIND
  // the rear (right) shoulder, hands together at shoulder height, elbows bent. Three measured facts
  // got it there, all read off render-actor/probe renders of the real glb, never guessed:
  //   1. The arm bones reach the load from upperArm Z, not X. upperArmR/L [50,-40,0] (rounds 1-2)
  //      puts the hand 72 px ABOVE the shoulder bone at a 400 px figure. A grid over X and Y alone
  //      cannot get it down: the best of 3,500 such poses still left the hand about 50 px above the
  //      shoulder. upperArm Z is the axis that drops the arm - [60, 0, 60] with the elbow folded
  //      hard (lowerArm [100, 0, 15]) lands the hand at the rear shoulder, and the two hands 3 px
  //      apart on screen instead of 109, so this is also the first pose where the two-handed grip
  //      is real rather than just hidden by the camera.
  //   2. The bat's angle is the WRIST, and the wrist is handR/handL Z. The bat is a rigid cylinder
  //      along the hand bone's own Y (so hand Y rotation only spins it about its own axis, measured:
  //      zero screen change), and BAT.rot is a fixed offset shared by every frame of every clip -
  //      changing it would move the bat at contact and through the follow-through, which already
  //      agree with the sprites. So the angle is posed per keyframe on the hands instead.
  //   3. The sprite's own bat angles, measured from the PNG's wood pixels (a principal-axis fit over
  //      batter-home-1 and -3 above the hands): 34 degrees off vertical at the load, 69 degrees by
  //      the last cocked frame as the barrel flattens out. handR/L [10,0,-50] renders 38 degrees and
  //      [10,0,-10] renders 67, which is what the two keyframes below carry.
  Idle:  { loop: true,  mark: null, keys: [
    { t: 0, pose: {
      spine: [4, 45, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -50],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -50],
      upperLegR: [-8, 0, 0], lowerLegR: [0, 0, 30],
      upperLegL: [15, 0, 0], lowerLegL: [0, 0, 20],
    }, hipsOffset: [0, 0.32, 0] },
    { t: 1, pose: {
      spine: [4, 45, 0],
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
  Swing: { loop: false, mark: 0.22, keys: [
    // t=0.00 ~ batter-home-3 (loaded/cocked): torso wound up, hands together at the rear shoulder,
    // barrel back over that shoulder, front (left) leg already strode forward. Same arm and elbow
    // numbers as Idle (see the load-pose note above it); only the wrist differs, at [10,0,-10]
    // rather than Idle's [10,0,-50], because this is the frame where the barrel has flattened out
    // from 34 to 69 degrees off vertical in the sprites. The wrist unwinds to zero by t=0.12 and
    // stays there, so every keyframe from contact on is untouched by this.
    { t: 0.00, pose: {
      spine: [6, 60, 0], head: [0, -24, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -10],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -10],
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
  // X rides 12-14deg higher through the reach-and-contact window (t=0.12/0.22/0.30) so the barrel
  // passes above where Swing connects, and `mark` sits on the t=0.30 keyframe instead of Swing's
  // t=0.22, so the whiff reads as a beat late as well as high.
  Miss:  { loop: false, mark: 0.30, keys: [
    // Same load pose as Swing, bone for bone (round 3): a batter has not decided to miss yet when
    // he loads, and the two clips cross-fade into each other from Idle.
    { t: 0.00, pose: {
      spine: [6, 60, 0], head: [0, -24, 0],
      upperArmR: [60, 0, 60], lowerArmR: [100, 0, 15], handR: [10, 0, -10],
      upperArmL: [60, 0, 60], lowerArmL: [100, 0, 15], handL: [10, 0, -10],
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
  Set:   { loop: true, mark: null, keys: [
    // Static hands-tucked stance, held (matches Pitcher-home-1). hipsOffset/spine only move at the
    // middle keyframe (see below) so the loop is a small bob and weight shift, not a held freeze -
    // small enough that a screenshot still reads as "standing still" (section 3.4's own rule for
    // Idle/Set), same discipline as the batter's Idle loop.
    { t: 0, pose: {
      upperArmR: [65, 0, 120], lowerArmR: [55, 0, 15], handR: [10, 0, -15],
      upperArmL: [65, 0, -25], lowerArmL: [55, 0, 15], handL: [10, 0, -15],
    } },
    // Mid-loop: a hair of lift (hipsOffset Y) and a hair of side lean (spine Z) - a breathing bob
    // and a weight shift, per section 3.4's own line for this clip. Arms untouched: the grip itself
    // doesn't need to move for this to read as "alive."
    { t: 1, pose: {
      upperArmR: [65, 0, 120], lowerArmR: [55, 0, 15], handR: [10, 0, -15],
      upperArmL: [65, 0, -25], lowerArmL: [55, 0, 15], handL: [10, 0, -15],
      spine: [0, 0, 3],
    }, hipsOffset: [0, 0.01, 0] },
    { t: 2, pose: {
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
  // ever plants (neutral at the lift, forward and weight-bearing from release on). This also means
  // the leg that lifts and drives is the SAME side as the throwing arm (`handR`), and the leg that
  // plants and strides is the opposite (glove) side - real pitching mechanics, not a coincidence.
  Pitch: { loop: false, mark: 1.0, keys: [
    // t=0: identical to Set's own base pose, so the Set->Pitch crossfade (actors.js CROSSFADE_S)
    // has nothing to blend across.
    { t: 0.00, pose: {
      upperArmR: [65, 0, 120], lowerArmR: [55, 0, 15], handR: [10, 0, -15],
      upperArmL: [65, 0, -25], lowerArmL: [55, 0, 15], handL: [10, 0, -15],
    } },
    // t=0.45 (45% to the mark): leg lift, ~Pitcher-home-2. Hands stay tucked exactly as in Set -
    // the delivery hasn't started yet, only the leg has moved. upperLegR down to -80 (big hip
    // flexion, knee up near the chest) with lowerLegR bent to 65 (shin hanging, not tucked flat
    // under the thigh - a first pass at 90 read as a runner's stride, not a pitcher's balanced
    // lift; rendered both and 65 is the one that reads as the sprite's relaxed hanging shin).
    { t: 0.45, pose: {
      upperArmR: [65, 0, 120], lowerArmR: [55, 0, 15], handR: [10, 0, -15],
      upperArmL: [65, 0, -25], lowerArmL: [55, 0, 15], handL: [10, 0, -15],
      upperLegR: [-80, 0, 0], lowerLegR: [0, 0, 65],
      upperLegL: [0, 0, 0], lowerLegL: [0, 0, 5],
    } },
    // t=1.0, the mark (~Pitcher-home-3): the release. upperArmR/lowerArmR/handR carry the whole
    // throw - Y is the axis that extends the arm forward (section 3.4's own note, from the
    // batter's contact keyframe), so upperArmR.y=50 reaches the hand out toward the camera; a
    // little Z keeps it above level ("high", per the brief). handL/lowerArmL/upperArmL are left
    // exactly as Set - the glove stays tucked at the chest through the whole release, only the
    // throwing arm moves. Legs: upperLegL now the planted stride leg (forward, weight-bearing),
    // upperLegR still trailing behind mid-swing (same numbers a real drive leg would still be
    // carrying through, not yet fully extended - that's the follow-through's job). spine/head lean
    // into the throw.
    { t: 1.00, pose: {
      upperArmR: [0, 50, 15], lowerArmR: [10, 0, 0], handR: [0, 0, 0],
      upperArmL: [65, 0, -25], lowerArmL: [55, 0, 15], handL: [10, 0, -15],
      upperLegL: [35, 0, 0], lowerLegL: [0, 0, 15],
      upperLegR: [-25, 0, 0], lowerLegR: [0, 0, 40],
      spine: [15, 0, 0], head: [-10, 0, 0],
    } },
    // t=1.3: follow-through (~Pitcher-home-4), the clip's own tail, held after the mark. The
    // throwing arm sweeps down and across the body to decelerate (upperArmR.y goes negative,
    // opposite sign from the release keyframe) rather than staying held out - rendering the
    // release's own arm numbers un-changed here read as a frozen reach, not a finished throw.
    // upperLegR keeps swinging up high behind (the drive leg's follow-through); upperLegL settles
    // deeper into the plant. spine/head lean further forward.
    { t: 1.30, pose: {
      upperArmR: [10, -40, -30], lowerArmR: [20, 0, -10], handR: [0, 0, 0],
      upperArmL: [55, 0, -15], lowerArmL: [70, 0, 10], handL: [10, 0, -15],
      upperLegL: [25, 0, 0], lowerLegL: [0, 0, 30],
      upperLegR: [-55, 0, 0], lowerLegR: [0, 0, 70],
      spine: [28, 0, 0], head: [-18, 0, 0],
    } },
  ] },
};
