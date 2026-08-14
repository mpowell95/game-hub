// Can the camera SEE the bottom of the board over the ramp's crest?
import { buildMachine } from './skeeball/js/machine.js';
import { BOARDS } from './skeeball/js/boards.js';
const CAM = { y: 0.42, z: 0.62 };            // render.js's camera
for (const humpLen of [0.30, 0.22, 0.18, 0.15, 0.14, 0.12]) {
  const g = { ...BOARDS[0].geom, humpLen };
  const M = buildMachine(g);
  const segLen = humpLen / g.humpAngles.length;
  const crestY = g.humpAngles.reduce((a, t) => a + segLen * Math.tan(t), 0);
  const crestZ = -(g.laneLen + humpLen);
  const lipY = g.boardLipY, lipZ = M.lipZ;
  // height of the camera->lip sightline where it passes over the crest
  const f = (CAM.z - crestZ) / (CAM.z - lipZ);
  const sight = CAM.y + (lipY - CAM.y) * f;
  const clear = sight - crestY;
  console.log(`humpLen=${humpLen.toFixed(2)}  crest y=${crestY.toFixed(3)} @z=${crestZ.toFixed(2)}   sightline at crest y=${sight.toFixed(3)}   clearance=${clear >= 0 ? '+' : ''}${clear.toFixed(3)}m  ${clear > 0.01 ? 'board bottom VISIBLE' : '** BOARD BOTTOM HIDDEN **'}`);
}
