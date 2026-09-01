// test-skeeball-capture-frame.mjs - can each machine's capture rule still SEE a basket once the
// ball is deep inside it? One check, every machine, discovered from BOARDS so a NEW machine is
// covered the day it ships.
//
// [KNOWN-BUG PROBE] BRICK CITY, 2026-08-26. Matt: "the ball sometimes gets stuck IN the negative
// baskets... There's nothing for them to get stuck on." What physically held that ball was a
// misplaced collar segment (see test-brickcity-stall.mjs), but what made it UNRESCUABLE was this:
//
//   `worldToFace(p)` returns the NEAREST staircase segment's coordinates. A ball deep in a
//   bottom-row basket is nearer the RISER plane standing behind the mouth (0.1085 m) than it is
//   to the tread the basket is sunk into (the cup is 0.1455 m deep). So above h 0.121 every
//   basket on a stepped machine resolved to a RISER frame, and physics.js section 2 then measured
//   that hole's distance as 0.22 against a 0.09 mouth - and skipped the cup the ball was in.
//
// The consequence is worth stating plainly, because it is not obvious from the symptom: the
// "a ball whose CENTRE is below the rim while inside the mouth is captured" rule, added
// 2026-08-22 for exactly this class of bug, COULD NOT FIRE on the deepest part of any basket on a
// staircase. The fix is machine.js's worldToFaceIn(fr, p): ask each hole where the ball is in
// THAT HOLE'S OWN frame, never in whichever frame the ball is nearest.
//
// This suite is deliberately GEOMETRIC, not a sweep. It walks each hole's own axis from the cup
// floor to the rim and asks the same question physics.js asks - is this hole within rEff? - so it
// costs nothing and cannot be fooled by a grid that happens to miss the conditions. A sweep DID
// miss them: the 41x21 grid reproduced the parked ball only 4 times in 861.
//
// Flat-faced machines (THE CLASSIC, POPONGO - one continuous surface) cannot have this and pass
// trivially. That is the point of running it on all of them.
//
//   node test-skeeball-capture-frame.mjs

import { BOARDS } from './skeeball/js/boards.js';
import { engineFor, loadEngine } from './skeeball/js/engines.js';

// Machines whose engine has NOT had the fix yet, each with the reason it is still open. A stale
// entry FAILS this suite, the same way test-game-conventions.mjs's KNOWN_GAPS does - a waiver
// that outlives its bug is worse than no waiver.
const KNOWN_GAPS = {
  // Empty, and it should stay that way. RUNAWAY was the last one, closed 2026-08-26.
};

let passed = 0;
let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log(`ok    ${name}`); }
  else { failed++; console.log(`not ok  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

console.log('Skeeball capture-frame probe: can each machine see a basket it has the ball in?\n');

const stillBroken = new Set();

for (const board of BOARDS) {
  const G = board.geom;
  // engines.js loads a machine's three files ON DEMAND since 2026-09-01 (the launch-weight
  // fix): engineFor() is synchronous and throws unless that machine has been loaded first.
  await loadEngine(board.id);
  const E = engineFor(board.id);
  const M = E.buildMachine(G);
  // The one question physics.js section 2 asks, in the frame it would ask it in.
  const seen = (H, h) => {
    const w = M.faceToWorld(H.u, H.v, h);
    const p = { x: w[0], y: w[1], z: w[2] };
    const fc = M.worldToFaceIn ? M.worldToFaceIn(M.frameAt(H.v), p) : M.worldToFace(p);
    return Math.hypot(fc.u - H.u, fc.v - H.v) < H.r - G.ballR * 0.28;
  };

  const blind = [];
  for (const id of Object.keys(G.holes)) {
    const H = G.holes[id];
    const depth = H.collarH > 0 ? H.collarH : G.ballR;
    for (let h = 0; h <= depth + 1e-9; h += depth / 200) {
      if (!seen(H, h)) {
        blind.push(`${id}: blind from h ${h.toFixed(3)} of a ${depth.toFixed(3)} deep mouth`);
        break;
      }
    }
  }

  const waived = Object.prototype.hasOwnProperty.call(KNOWN_GAPS, board.id);
  if (blind.length) stillBroken.add(board.id);
  const label = `${board.id} sees every basket at every depth`;
  if (waived) {
    if (blind.length) console.log(`WAIVED  ${label}\n        ${blind.length} hole(s) blind. ${KNOWN_GAPS[board.id]}`);
    else ok(`${label} - and its KNOWN_GAPS entry is now STALE, delete it`, false,
      KNOWN_GAPS[board.id]);
  } else {
    ok(label, blind.length === 0, blind.slice(0, 4).join('; '));
  }
}

// A waiver for a machine that is already clean, or for one that does not exist, is a lie.
for (const id of Object.keys(KNOWN_GAPS)) {
  if (!BOARDS.some((b) => b.id === id)) {
    ok(`KNOWN_GAPS entry '${id}' names a real machine`, false, 'no such board id - delete the entry');
  }
}

console.log(`\nSkeeball capture-frame probe: ${passed} passed, ${failed} failed, `
  + `${Object.keys(KNOWN_GAPS).length} machine(s) under waiver.`);
process.exit(failed ? 1 : 0);
