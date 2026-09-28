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
import { Match, swapSides } from './match.js';
import { aimAt, cpuThrow, seeded } from './cpu.js';

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
{
  // THE GENTLEMAN'S LINE and the other lines: straight, touching, centred, pointing at the shooter,
  // front cup where the triangle's point stands (Matt: "look correct and are placed correctly").
  const apexZ = cellXZ({ c: 0, r: 3 }).z;
  const backZ = cellXZ({ c: 1, r: 0 }).z;
  for (const [name, n] of [['line2', 2], ['line3', 3], ['line4', 4]]) {
    const pts = makeRack(name).map(cellXZ).sort((a, b) => b.z - a.z);
    const straight = pts.every((p) => Math.abs(p.x) < 1e-9);
    const touching = pts.every((p, i) => i === 0 || Math.abs((pts[i - 1].z - p.z) - CUP_D) < 1e-9);
    // front on the point when the line fits behind it; otherwise its back cup on the back row
    const placed = Math.abs(pts[0].z - apexZ) < 1e-9 || Math.abs(pts[pts.length - 1].z - backZ) < 1e-9;
    ok(`${name}: ${n} cups, centred, one directly behind the other, touching, placed in the rack area`,
      pts.length === n && straight && touching && placed && validRack(makeRack(name)));
  }
  ok('the Gentleman\'s (line2) has its front cup exactly where the triangle\'s point is',
    Math.abs(Math.max(...makeRack('line2').map((k) => cellXZ(k).z)) - apexZ) < 1e-9);
  ok('a spot overlapping a cell is refused (real-distance check)',
    !validRack([{ id: 'a', c: 1, r: 0 }, { id: 'b', u: 0.5, v: 0.3 }]));
  ok('a spot off the rack area is refused', !inArea({ u: 0, v: 9 }) && !inArea({ u: 4, v: 1 }));
}
ok('the whole rack area is on the table',
  AREA.cMax * CUP_D / 2 + CUP.topR <= TABLE.width / 2 && RACK_Z0 - CUP.topR >= -TABLE.len / 2);

// --- the rules (match.js), as Matt set them 2026-09-27/28 ----------------------------------------
{
  const types = (ev) => ev.map((e) => e.type);
  const ids = (m, side) => m.racks[side].map((k) => k.id);
  const miss = { made: null };
  let m = new Match({ first: 'a' });
  m.startTurn();
  let ev = m.throwResult({ made: 'k0' });
  ok('a make removes that cup at once', !ids(m, 'b').includes('k0') && types(ev).join() === 'made');
  ev = m.throwResult(miss);
  ok('two balls, then the turn passes', types(ev).join() === 'miss,turnOver' && m.shooter === 'b');
  // Balls back.
  m = new Match({ first: 'a' });
  m.startTurn(); m.throwResult({ made: 'k0' });
  ev = m.throwResult({ made: 'k1' });
  ok('make both balls: balls back', types(ev).includes('ballsBack') && m.shooter === 'a' && m.queue.join() === '0,1');
  // HEATING UP AND ON FIRE ARE PER BALL. Matt's own counter-example first.
  m = new Match({ first: 'a' });
  m.startTurn(); m.throwResult({ made: 'k0' }); m.throwResult(miss);   // a: ball 1 in, ball 2 out
  m.startTurn(); m.throwResult(miss); m.throwResult(miss);             // b
  m.startTurn(); m.throwResult(miss);
  ev = m.throwResult({ made: 'k1' });                                    // a: ball 1 out, ball 2 in
  ok('ball 1 in, then ball 2 in next turn: NOT heating up (Matt\'s example)', !types(ev).includes('heatingUp') && m.heat('a', 0) === 0 && m.heat('a', 1) === 1);
  m = new Match({ first: 'a' });
  const pass = () => { m.startTurn(); m.throwResult(miss); m.throwResult(miss); };
  m.startTurn(); m.throwResult({ made: 'k0' }); m.throwResult(miss); pass();
  m.startTurn(); ev = m.throwResult({ made: 'k1' });
  ok('the SAME ball in on 2 turns running: heating up', types(ev).includes('heatingUp') && m.heat('a', 0) === 2);
  m.throwResult(miss); pass();
  m.startTurn(); ev = m.throwResult({ made: 'k2' });
  ok('the same ball a 3rd time: on fire, and that ball comes straight back', types(ev).includes('onFire') && m.ball === 0 && m.queue.join() === '0,1');
  m.throwResult({ made: 'k3' });
  ok('on fire: it keeps coming back while it makes cups', m.ball === 0);
  ev = m.throwResult(miss);
  ok('on fire: a miss cools it, then the other ball throws', types(ev).includes('cooled') && m.heat('a', 0) === 0 && m.ball === 1);
  m = new Match({ first: 'a' });
  m.startTurn(); m.throwResult({ made: 'k0' }); m.throwResult({ made: 'k1' });   // balls back
  ev = m.throwResult({ made: 'k2' });
  ok('balls-back throws count toward that ball\'s streak (Matt, 2026-09-28)', types(ev).includes('heatingUp') && m.heat('a', 0) === 2);
  // THE LAST CUP.
  const oneLeft = (first) => { const mm = new Match({ first }); mm.racks[first === 'a' ? 'b' : 'a'] = [{ id: 'k9', c: 0, r: 3 }]; mm.startTurn(); return mm; };
  m = oneLeft('a');
  ev = m.throwResult({ made: 'k9' });
  ok('the last cup made with ball 1: it stays for ball 2', !m.over && m.lastCup === 'k9' && m.ball === 1 && ids(m, 'b').join() === 'k9');
  ev = m.throwResult({ made: 'k9' });
  ok('ball 2 in the SAME last cup: win, no rebuttal', m.over && m.winner === 'a' && ev.some((e) => e.type === 'win' && e.how === 'sameCup'));
  m = oneLeft('a'); m.throwResult({ made: 'k9' });
  ev = m.throwResult(miss);
  ok('ball 2 misses: the cup goes and the other side gets a rebuttal', !m.over && m.phase === 'rebuttal' && m.shooter === 'b' && ids(m, 'b').length === 0 && types(ev).includes('rackCleared'));
  // THE REBUTTAL: both balls, each until it misses.
  ev = m.startTurn();
  ok('the rebuttal is announced', types(ev).includes('rebuttal'));
  m.throwResult({ made: 'k0' });
  ok('rebuttal: a make gives that ball back', m.ball === 0);
  m.throwResult(miss);
  ok('rebuttal: after ball 1 misses, ball 2 shoots', !m.over && m.ball === 1);
  m.throwResult({ made: 'k1' }); ev = m.throwResult(miss);
  ok('rebuttal: both balls missed, the side that cleared wins', m.over && m.winner === 'a');
  m = oneLeft('a'); m.throwResult({ made: 'k9' }); m.throwResult(miss); m.startTurn();
  for (const id of ids(m, 'a')) ev = m.throwResult({ made: id });
  ok('a rebuttal that clears everything goes to overtime', m.phase === 'overtime' && !m.over && types(ev).includes('overtime'));
  ok('overtime: 3 cups each in a 2-1 triangle, the first to clear opens', m.racks.a.length === 3 && m.racks.b.length === 3 && m.shooter === 'a');
  m.startTurn(); m.racks.b = m.racks.b.slice(0, 2);
  ok('overtime: no Gentleman\'s and no rerack (Matt)', !m.canGentlemans() && !m.canRerack());
  // GENTLEMAN'S AND RERACK ARE THE SHOOTER'S OPTIONS.
  m = new Match({ first: 'a', gentlemans: true });
  m.racks.b = m.racks.b.slice(0, 2); m.startTurn();
  ok('Gentleman\'s is offered, not applied', m.canGentlemans() && m.racks.b.every((k) => 'c' in k));
  ev = m.applyGentlemans();
  ok('Gentleman\'s: taken, the 2 cups stand in a line', types(ev).join() === 'gentlemans' && m.racks.b.every((k) => k.u === 0) && !m.canGentlemans());
  m = new Match({ first: 'a', gentlemans: false }); m.racks.b = m.racks.b.slice(0, 2); m.startTurn();
  ok('Gentleman\'s off: never offered', !m.canGentlemans());
  m = new Match({ first: 'a', reracks: 1 }); m.racks.b = m.racks.b.slice(0, 6); m.startTurn();
  ok('rerack offered before the first throw', m.canRerack());
  ev = m.rerack('zipper');
  ok('rerack: preset applied, ids kept, one spent', types(ev).join() === 'rerack' && m.reracksLeft.a === 0 && ids(m, 'b').join() === 'k0,k1,k2,k3,k4,k5' && !m.canRerack());
  m = new Match({ first: 'a', reracks: 2 }); m.racks.b = m.racks.b.slice(0, 6); m.startTurn(); m.throwResult(miss);
  ok('no rerack after the turn\'s first throw', !m.canRerack());
  m = new Match({ first: 'a', reracks: Infinity }); m.racks.b = m.racks.b.slice(0, 6); m.startTurn(); m.rerack('tri');
  ok('one rerack a turn', !m.canRerack());
  m.startTurn();
  ok('unlimited reracks never run out', m.canRerack());
  // MAKE YOUR OWN.
  m = new Match({ first: 'a', reracks: 1 }); m.racks.b = m.racks.b.slice(0, 3); m.startTurn();
  ok('custom rerack: a cell off the grid is refused', m.rerackCustom([{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 3, r: 0 }]).length === 0 && m.reracksLeft.a === 1);
  ok('custom rerack: two cups on one cell is refused', m.rerackCustom([{ c: 1, r: 0 }, { c: 1, r: 0 }, { c: 3, r: 0 }]).length === 0);
  ok('custom rerack: outside the rack area is refused', m.rerackCustom([{ c: 7, r: 0 }, { c: 1, r: 0 }, { c: 3, r: 0 }]).length === 0);
  ev = m.rerackCustom([{ c: -5, r: 0 }, { c: 5, r: 0 }, { c: 0, r: 3 }]);
  ok('custom rerack: cups need not touch, keep their ids, and it costs a rerack',
    ev.length === 1 && ev[0].key === 'custom' && ids(m, 'b').join() === 'k0,k1,k2' && m.racks.b[2].r === 3 && m.reracksLeft.a === 0 && !m.canRerack());
  // ISLAND.
  m = new Match({ first: 'a' });
  m.racks.b = [{ id: 'k0', c: -3, r: 0 }, { id: 'k1', c: -1, r: 0 }, { id: 'k9', c: 0, r: 3 }]; m.startTurn();
  ok('an island is a cup touching no other', m.islands().join() === 'k9' && m.canIsland());
  ok('you must call a specific island', m.callIsland('k0').length === 0 && !m.islandUsed.a);
  m.callIsland('k9');
  ev = m.throwResult({ made: 'k9' });
  ok('hit the called island: the defender owes a second cup', types(ev).includes('islandPick') && m.pendingPick.picker === 'b' && ids(m, 'b').join() === 'k0,k1');
  ok('nothing can be thrown until they pick', m.throwResult({ made: 'k0' }).length === 0);
  ev = m.pickCup('k1');
  ok('the defender\'s pick goes too, then play carries on', ids(m, 'b').join() === 'k0' && types(ev)[0] === 'picked' && !m.pendingPick);
  m = new Match({ first: 'a' });
  m.racks.b = [{ id: 'k0', c: -3, r: 0 }, { id: 'k9', c: 0, r: 3 }]; m.startTurn();
  m.callIsland('k9'); m.throwResult(miss); m.startTurn(); m.startTurn();
  ok('island is once per game: calling spends it even on a miss', m.islandUsed.a && !m.canIsland());
  // A CHALLENGE'S ISLAND: the second cup is OWED, taken by the defender at its own next turn.
  m = new Match({ first: 'a', async: true });
  m.racks.b = [{ id: 'k0', c: -3, r: 0 }, { id: 'k1', c: -1, r: 0 }, { id: 'k9', c: 0, r: 3 }]; m.startTurn();
  m.callIsland('k9');
  ev = m.throwResult({ made: 'k9' });
  ok('challenge: an island hit owes a cup instead of waiting for a pick', types(ev).includes('islandOwed') && !m.pendingPick && m.owed.b === 1 && ids(m, 'b').join() === 'k0,k1');
  m.throwResult(miss);
  ok('challenge: the turn carries on and passes', m.shooter === 'b');
  m.startTurn();
  ok('challenge: the owing side can do nothing until it pays', m.mustPickOwed() && m.throwResult(miss).length === 0 && !m.canRerack());
  ev = m.pickOwed('k1');
  ok('challenge: the owed cup comes off its OWN rack', types(ev)[0] === 'owedPicked' && ids(m, 'b').join() === 'k0' && !m.mustPickOwed());
  m = new Match({ first: 'a', async: true });
  m.racks.b = [{ id: 'k0', c: -3, r: 0 }, { id: 'k9', c: 0, r: 3 }]; m.startTurn();
  m.callIsland('k9');
  ev = m.throwResult({ made: 'k9' });
  ok('challenge: owed cups that are all the cups left clear the rack at once', types(ev).includes('owedCleared') && types(ev).includes('rackCleared') && m.phase === 'rebuttal');
  // SAVING A MATCH: whole, round trip, and turned round.
  m = new Match({ first: 'a', reracks: Infinity, async: true, gentlemans: false });
  m.startTurn(); m.throwResult({ made: 'k0' }); m.throwResult({ made: 'k1' }); m.throwResult({ made: 'k2' });
  const snap = JSON.parse(JSON.stringify(m.toJSON()));
  const back = Match.fromJSON(snap);
  ok('a saved match comes back the same (JSON round trip, unlimited reracks too)',
    JSON.stringify(back.toJSON()) === JSON.stringify(m.toJSON()) && back.reracksLeft.a === Infinity);
  const sw = Match.fromJSON(swapSides(snap));
  ok('turned round, each side keeps its own cups, streaks and turn',
    ids(sw, 'a').join() === ids(m, 'b').join() && sw.streak.b.join() === m.streak.a.join() && sw.shooter === 'b');
  ok('turned round twice is the same match', JSON.stringify(swapSides(swapSides(snap))) === JSON.stringify(snap));
}

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
  for (let a = -0.20; a <= 0.20001; a += 0.0125) {
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

// --- the computer (cpu.js): a real throw through the same physics, missed by a skill-sized error --
{
  let own = 0;
  for (const k of cups) {
    const r = simulateThrow({ ...aimAt(k.x, k.z), cups });
    if (r.outcome.kind === 'made' && r.outcome.id === k.id) own++;
  }
  ok('the computer\'s perfect aim lands in the cup it aimed at, every cup', own === 10, own + '/10');
  const rate = (skill) => {
    const rnd = seeded(5); let m = 0; const n = 150;
    for (let i = 0; i < n; i++) {
      const th = cpuThrow(skill, cups, rnd);
      if (simulateThrow({ power: th.power, aim: th.aim, cups }).outcome.kind === 'made') m++;
    }
    return m / n;
  };
  const e = rate('easy'), me = rate('medium'), h = rate('hard');
  ok('Easy < Medium < Hard at a full rack', e < me && me < h,
    `easy ${(e * 100).toFixed(0)}%, medium ${(me * 100).toFixed(0)}%, hard ${(h * 100).toFixed(0)}%`);
}

// --- bounce shots: MEASURED, NOT ASSERTED (yet) ------------------------------------------------
// Bounce shots are brief section 5d, stage 4, and that stage turns this into an assertion. Build 2's
// flat throw made them impossible (0 of 969); the fitted lob makes them possible again. Printed so
// a change to the arc that loses them again is visible.
{
  let bounced = 0, tried = 0;
  for (let p = -0.3; p <= 0.3001; p += 0.02) {
    for (let a = -0.15; a <= 0.15001; a += 0.025) {
      tried++;
      const r = simulateThrow({ power: p, aim: a, cups });
      if (r.outcome.kind === 'made' && r.outcome.bounced) bounced++;
    }
  }
  console.log(`info bounce shots that went in: ${bounced} of ${tried} soft throws (stage 4 owns this)`);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
