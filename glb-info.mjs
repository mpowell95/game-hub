// glb-info.mjs - a no-dependency reader of any .glb, for filling in baseball/js/rig.js and for
// the section 2.2 model facts in docs/BASEBALL-3D-BUILD.md. Prints byte size, generator, required
// extensions, skins (joint count and joint node names), every node name, mesh count, material
// names, animation names with durations (from the sampler input accessor's own max), and whether
// images are embedded. Measured against RobotExpressive.glb (the stage 1 scaffold asset) and a
// hand-built minimal glTF JSON with no BIN chunk.
//
//   node glb-info.mjs <file.glb> [--json]
//
// readGlb/summarize are also imported directly by test-baseball-actors.mjs's node half.
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
    console.log(`node names: ${s.nodeNames.join(', ')}`);
    console.log(`materials: ${s.materials.join(', ')}`);
    for (const a of s.animations) console.log(`animation "${a.name}" ${a.seconds.toFixed(2)} s`);
    console.log(`embedded images: ${s.embeddedImages}`);
  }
}
