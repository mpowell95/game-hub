// rig.js - semantic bone names for the 3D actor's skeleton (section 2.3 of docs/BASEBALL-3D-BUILD.md).
//
// SCAFFOLD VALUES, STAGE 1 ONLY: the names below are for RobotExpressive.glb (the section 2.1
// scaffold). They exist to prove resolveRig() and the dev screen against a real skinned file.
// Section 2.2/2.3 fills this in again against baseball/models/player.glb once Matt picks the
// model; these values are then wrong and must be replaced, not extended.
//
// THESE ARE NOT `glb-info.mjs`'s printed names. glb-info.mjs reads the raw glTF JSON, but
// three.js's GLTFLoader SANITIZES every node name on load - dots are stripped (`Foot.L` becomes
// `FootL`) and a name that collides with another node anywhere in the file gets a numeric suffix
// in discovery order (`Torso`, the first node with that name, keeps it bare; the second becomes
// `Torso_1`, and so on) - so a name read straight out of the file can point at the wrong node, or
// none, once loaded. Verified empirically: `root.getObjectByName('Torso')` on this file returns a
// MESH (the raw file's node 7), not the spine bone (the raw file's node 10, which loads as
// `Torso_1`). The values below are the POST-LOAD names, read by loading the file with the real
// GLTFLoader and walking `gltf.scene` - not by reading `glb-info.mjs`'s output. `chest` is left
// null rather than the fragile `Torso_1` suffix; it is optional and falls back to `spine`
// (`Abdomen`), which has no collision. The scaffold also has no single wrist/hand bone - the arm
// splits straight into three finger-root "Palm" bones - so `handL`/`handR` use `Palm2L`/`Palm2R`,
// the middle-finger root, as the nearest stand-in.
export const RIG = {
  hips: 'Hips', spine: 'Abdomen', chest: null, neck: 'Neck', head: 'Head',
  shoulderL: 'ShoulderL', shoulderR: 'ShoulderR',
  upperArmL: 'UpperArmL', upperArmR: 'UpperArmR', lowerArmL: 'LowerArmL', lowerArmR: 'LowerArmR',
  handL: 'Palm2L', handR: 'Palm2R',
  upperLegL: 'UpperLegL', upperLegR: 'UpperLegR', lowerLegL: 'LowerLegL', lowerLegR: 'LowerLegR',
  footL: 'FootL', footR: 'FootR',
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
