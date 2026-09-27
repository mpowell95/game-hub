// cup-pong/js/test.js - headless tests for the rack model and the real physics. `node cup-pong/js/test.js`
// (~15 s). Drives the SAME physics.js the game runs; nothing here is a model of it.
//
// What stage 1 promises, as numbers: every cup in the rack can be made by a straight-up throw
// somewhere on the dial, a throw always resolves, the dial is ordered (harder goes further), the
// middle of the natural swipe range lands in the rack, and the ball really bounces off rims.
import { simulateThrow, launchSpeed } from './physics.js';
import { makeRack, cupsXZ, validRack, isCell, inArea, cellXZ, PRESETS, AREA } from './rack.js';
import { CUP, CUP_D, ROW_H, RACK_Z0, TABLE } from './geom.js';
import { powerOf, SWIPE_SLOW, SWIPE_FAST } from '../../skeeball/js/swipe.js';

let fail = 0;
const ok = (label, cond, extra = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
};

// --- the rack --------------------------------------------------------------------------------
const rack = makeRack('tri10');
ok('the starting rack is 10 cups', rack.length === 10);
ok('it is a legal rack (real cells, inside the area, no two on one cell)', validRack(rack));
const rows = [0, 1, 2, 3].map((r) => rack.filter((k) => k.r === r).length);
ok('it is a 4-3-2-1 triangle', rows.join('-') === '4-3-2-1', rows.join('-'));
const apex = rack.find((k) => k.r === 3);
ok('its point faces the shooter (the single cup is the nearest one)',
  !!apex && apex.c === 0 && rack.every((k) => cellXZ(k).z <= cellXZ(apex).z));
{
  // every cup touches at least two others (a grid of TOUCHING positions), none overlap
  let minD = Infinity, lonely = 0;
  for (const a of rack) {
    let touching = 0;
    for (const b of rack) {
      if (a === b) continue;
      const pa = cellXZ(a), pb = cellXZ(b);
      const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
      minD = Math.min(minD, d);
      if (Math.abs(d - CUP_D) < 1e-9) touching++;
    }
    if (touching < 2) lonely++;
  }
  ok('no two cups overlap (closest centres one cup apart)', Math.abs(minD - CUP_D) < 1e-9, minD.toFixed(4));
  ok('every cup touches at least two neighbours', lonely === 0);
}
ok('a cell off the grid parity is refused', !isCell({ c: 0, r: 0 }) && isCell({ c: 1, r: 0 }));
ok('a cell outside the rack area is refused', !inArea({ c: AREA.cMax + 2, r: 1 }) && !inArea({ c: 1, r: -2 }));
ok('two cups on one cell is refused', !validRack([{ id: 'a', c: 1, r: 0 }, { id: 'b', c: 1, r: 0 }]));
ok('every preset is legal', Object.keys(PRESETS).every((p) => validRack(makeRack(p))));
ok('the whole rack area is on the table',
  AREA.cMax * CUP_D / 2 + CUP.topR <= TABLE.width / 2 && RACK_Z0 - CUP.topR >= -TABLE.len / 2);

// --- the dial --------------------------------------------------------------------------------
const cups = cupsXZ(rack);
ok('power is spent as energy: launch speed rises with power, and is defined past both ends',
  launchSpeed(-0.5) < launchSpeed(0) && launchSpeed(0) < launchSpeed(0.5) && launchSpeed(0.5) < launchSpeed(1.5));
{
  // Straight throws on an EMPTY table: where does the ball first land?
  const land = [];
  for (let p = -0.2; p <= 1.2001; p += 0.1) {
    const r = simulateThrow({ power: p, aim: 0, cups: [] });
    land.push({ p, z: r.firstTable ? r.firstTable.z : -Infinity });
  }
  const ordered = land.every((x, i) => i === 0 || x.z < land[i - 1].z || (x.z === -Infinity && land[i - 1].z === -Infinity));
  ok('harder goes further (first landing moves down the table as power rises)', ordered,
    land.map((x) => `${x.p.toFixed(1)}:${Number.isFinite(x.z) ? x.z.toFixed(2) : 'off'}`).join(' '));
  const front = RACK_Z0 + 3 * ROW_H + CUP.topR;     // front edge of the triangle's point
  const back = RACK_Z0 - CUP.topR;                  // back edge of the back row
  const at = (p) => land.reduce((b, x) => (Math.abs(x.p - p) < Math.abs(b.p - p) ? x : b));
  ok('power 0 (the softest natural swipe) falls well short of the rack', at(0).z > front + 0.3, at(0).z.toFixed(2));
  ok('power 1 (the hardest natural swipe) flies past the back row', at(1).z < back, String(at(1).z));
  const mid = simulateThrow({ power: 0.55, aim: 0, cups: [] });
  // At rim height, the ball crosses the rack when power is mid-dial: check the empty-table landing
  // is just behind it (a ball that would pass the rim plane over the rack lands a little further on).
  ok('the middle of the natural swipe range lands at the rack', mid.firstTable && mid.firstTable.z < front && mid.firstTable.z > back - 0.25,
    mid.firstTable ? mid.firstTable.z.toFixed(2) : 'none');
  ok('skeeball\'s measured swipe ends are power 0 and 1 here too',
    Math.abs(powerOf(SWIPE_SLOW)) < 1e-9 && Math.abs(powerOf(SWIPE_FAST) - 1) < 1e-9);
}

// --- determinism -----------------------------------------------------------------------------
{
  const a = simulateThrow({ power: 0.5, aim: 0.02, cups });
  const b = simulateThrow({ power: 0.5, aim: 0.02, cups });
  ok('the same throw twice gives the same outcome, to the step',
    JSON.stringify(a.outcome) === JSON.stringify(b.outcome) && a.time === b.time && a.events.join() === b.events.join());
}

// --- reach: the full grid --------------------------------------------------------------------
const per = {};
let n = 0, made = 0, rimOut = 0, capped = 0, maxT = 0;
const firstMake = {};
for (let p = 0.30; p <= 0.8001; p += 0.02) {
  for (let a = -0.08; a <= 0.08001; a += 0.005) {
    const r = simulateThrow({ power: p, aim: a, cups });
    n++;
    maxT = Math.max(maxT, r.time);
    if (r.outcome.capped) capped++;
    if (r.outcome.kind === 'made') {
      made++;
      per[r.outcome.id] = (per[r.outcome.id] || 0) + 1;
      if (!firstMake[r.outcome.id]) firstMake[r.outcome.id] = { power: p, aim: a };
    } else if (r.touchedCup) rimOut++;
  }
}
const missing = rack.filter((k) => !per[k.id]).map((k) => k.id);
ok(`every one of the 10 cups can be made (${n}-throw power x aim grid)`, missing.length === 0,
  missing.length ? 'never made: ' + missing.join(',') : Object.entries(per).map(([k, v]) => `${k}:${v}`).join(' '));
ok('every throw resolves on its own (none hit the 6 s cap)', capped === 0, `slowest ${maxT.toFixed(2)} s`);
ok('balls really come off the rims (plenty touch a cup and stay out)', rimOut > made, `${rimOut} touched and missed, ${made} made`);
{
  const rate = made / n;
  ok('the grid is not a gimme: under a quarter of an even sweep scores', rate < 0.25, (rate * 100).toFixed(1) + '%');
}

// --- a made cup is gone ----------------------------------------------------------------------
{
  const id = Object.keys(firstMake)[0];
  const shot = firstMake[id];
  const without = cups.filter((k) => k.id !== id);
  const again = simulateThrow({ power: shot.power, aim: shot.aim, cups: without });
  ok('a made cup is gone: the same throw at the rack without it cannot make it again',
    !(again.outcome.kind === 'made' && again.outcome.id === id), `${id} -> ${JSON.stringify(again.outcome)}`);
}

// --- bounce shots exist in the physics (stage 4 reads `bounced`) ------------------------------
{
  let bounced = 0;
  for (let p = -0.3; p <= 0.3001; p += 0.02) {
    for (let a = -0.06; a <= 0.06001; a += 0.01) {
      const r = simulateThrow({ power: p, aim: a, cups });
      if (r.outcome.kind === 'made' && r.outcome.bounced) bounced++;
    }
  }
  ok('a throw that bounces off the table can still go in, and is flagged as a bounce', bounced > 0, `${bounced} found`);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
