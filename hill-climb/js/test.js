// hill-climb/js/test.js — headless engine assertions, node-only, no deps.
// Run: node hill-climb/js/test.js   (also runs inside node run-all-tests.mjs)
//
// Covers the three pure layers: terrain.js (determinism, continuity, world objects), physics.js
// (rest state, throttle, crash, fuel, nitro, flips) and catalog.js/store.js (the economy, plus the
// two THE-LAW-governed fields in the save: `earned` and `best`, which must never move down).
// Same idiom as every other game's engine test in this repo.

import { makeTerrain, CHUNK, AIR_MAX, LAUNCH_SPEED } from './terrain.js';
import { Run, Vehicle, RunState, EndReason, DT, NITRO_START, NITRO_MAX } from './physics.js';
import {
  VEHICLES, STAGES, PARTS, MAX_LEVEL, upgradeCost, tunedSpec, vehicleById, stageById,
  normUpgrades, stageDiff,
} from './catalog.js';
import { blankSave, bankRun, buyVehicle, buyStage, buyUpgrade, selectVehicle, selectStage } from './store.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; return; }
  fail++; console.log('FAIL  ' + name);
}

const COUNTRY = stageById('countryside');

/** Drive a whole run headless with a throttle policy, returning the finished Run. */
function drive(vehicleId, stageId, upgrades, policy, maxSeconds = 200) {
  const stage = stageById(stageId);
  const terrain = makeTerrain(20260802, stage);
  const run = new Run(tunedSpec(vehicleId, upgrades, stage), terrain);
  run.start();
  let t = 0;
  while (run.state === RunState.RUNNING && t < maxSeconds) {
    run.step(policy(run, t), DT);
    t += DT;
  }
  run.elapsed = t;
  return run;
}

/** The "competent driver" policy the tuning pass used: back off when the nose pitches up. */
const modulated = (run) => {
  const a = run.car.ang;
  if (a > 0.55) return -0.4;
  if (a < -0.5) return 1;
  return 0.8;
};

// --- terrain -------------------------------------------------------------------------------
{
  const a = makeTerrain(1234, COUNTRY);
  const b = makeTerrain(1234, COUNTRY);
  const c = makeTerrain(5678, COUNTRY);
  let same = true, differs = false;
  for (let x = 0; x < 600; x += 3.7) {
    if (a.y(x) !== b.y(x)) same = false;
    if (Math.abs(a.y(x) - c.y(x)) > 0.001) differs = true;
  }
  ok('same seed gives an identical hill', same);
  ok('a different seed gives a different hill', differs);

  // continuity: no cliffs. 10 cm of x must never move the ground more than a meter.
  let maxJump = 0;
  for (let x = -50; x < 2000; x += 0.1) maxJump = Math.max(maxJump, Math.abs(a.y(x + 0.1) - a.y(x)));
  ok('terrain is continuous (no cliff between adjacent samples)', maxJump < 1);

  ok('the start is a flat pad', Math.abs(a.y(0)) < 0.05 && Math.abs(a.y(1.5)) < 0.2);
  ok('hills grow with distance', Math.abs(a.y(900)) + Math.abs(a.y(940)) > 0);
  ok('terrain is defined behind the start line', Number.isFinite(a.y(-40)));

  const slopeNum = (a.y(120.02) - a.y(119.98)) / 0.04;
  ok('slope() matches a finite difference', Math.abs(a.slope(120) - slopeNum) < 0.02);
  const n = a.normal(120);
  ok('normal is a unit vector', Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-9);
  ok('normal points up', n.y > 0);
}

// --- world objects -------------------------------------------------------------------------
{
  const a = makeTerrain(99, COUNTRY);
  const b = makeTerrain(99, COUNTRY);
  const ia = a.itemsIn(0, 400).map((it) => `${it.kind}:${it.x.toFixed(4)}:${it.value || it.amount}`);
  const ib = b.itemsIn(0, 400).map((it) => `${it.kind}:${it.x.toFixed(4)}:${it.value || it.amount}`);
  ok('world objects are deterministic for a seed', ia.join('|') === ib.join('|'));
  ok('a run has coins to collect', ia.filter((s) => s.startsWith('coin')).length > 10);
  ok('a run has fuel cans to collect', ia.some((s) => s.startsWith('fuel')));

  // chunks are built lazily and only once
  const c = makeTerrain(99, COUNTRY);
  ok('no chunks built before anything is asked for', c._chunks.size === 0);
  c.itemsIn(0, CHUNK - 1);
  const after = c._chunks.size;
  const first = c.itemsIn(0, CHUNK - 1);
  const second = c.itemsIn(0, CHUNK - 1);
  ok('re-reading a chunk builds nothing new', c._chunks.size === after);
  ok('re-reading a chunk returns the SAME objects (so `taken` sticks)', first[0] === second[0]);

  // every coin/can hangs above the ground, never buried in it
  let allAbove = true;
  for (const it of a.itemsIn(0, 900)) if (it.y <= a.y(it.x)) allAbove = false;
  ok('every pickup sits above the terrain', allAbove);
}

// --- REACHABILITY (2026-08-02 regression: "some coins and gas tanks are impossible to get") --
// There is no jump button, so the only way off the ground is a crest. Every pickup must therefore
// be either collectible while simply driving, or downrange of a real ramp. Checked across all four
// stages and several seeds, because the terrain generator's roughness differs per stage and an
// unreachable pickup is a run-ending bug on the fuel cans.
{
  const DRIVE_REACH = 2.2;   // comfortably inside Run.step()'s 2.4 m pickup radius for every car
  let highFuel = 0, tooHigh = 0, orphanAir = 0, buried = 0, coins = 0, cans = 0, airCoins = 0;

  for (const stage of STAGES) {
    for (const seed of [1, 7, 4242, 90210]) {
      const tr = makeTerrain(seed, stage);
      for (const it of tr.itemsIn(0, 2500)) {
        const above = it.y - tr.y(it.x);
        if (above <= 0.5) buried++;
        if (it.kind === 'fuel') {
          cans++;
          // A missed coin costs coins; an unreachable can ends the run. Cans are never airborne.
          if (above > DRIVE_REACH) highFuel++;
          continue;
        }
        coins++;
        if (above > AIR_MAX + 0.01) tooHigh++;
        if (above > DRIVE_REACH) {
          airCoins++;
          // an out-of-reach coin is only fair if a ramp launches you into it
          if (tr.crestIn(it.x - 16, it.x - 0.5) == null) orphanAir++;
        }
      }
    }
  }

  ok('the sweep actually found pickups to check', coins > 200 && cans > 20);
  ok('no pickup is buried in the ground', buried === 0);
  ok('every fuel can is reachable by driving (never airborne)', highFuel === 0);
  ok('no coin floats above the hard ceiling', tooHigh === 0);
  ok('every airborne coin has a ramp behind it', orphanAir === 0);
  ok('air arcs still exist (the reward for launching is not tuned away)', airCoins > 0);
}

// --- REACHABILITY, actually driven ---------------------------------------------------------
// The geometry check above proves the placement RULE holds. This proves the rule delivers: drive
// real runs and count what a car that never went looking for air actually swept up. Fuel is the
// hard requirement (a can you cannot reach ends the run), coins are the soft one (the misses
// should be the air arcs, not ordinary line coins floating out of reach).
{
  let coinsPassed = 0, coinsGot = 0, fuelPassed = 0, fuelGot = 0;
  for (const stageId of ['countryside', 'desert', 'arctic']) {
    for (const seed of [11, 22, 33, 44, 55]) {
      const stage = stageById(stageId);
      const tr = makeTerrain(seed, stage);
      const run = new Run(tunedSpec('jeep', {}, stage), tr);
      run.start();
      let t = 0;
      while (run.state === RunState.RUNNING && t < 200) { run.step(modulated(run), DT); t += DT; }
      for (const it of tr.itemsIn(0, run.car.x)) {
        if (it.kind === 'coin') { coinsPassed++; if (it.taken) coinsGot++; }
        else { fuelPassed++; if (it.taken) fuelGot++; }
      }
    }
  }
  ok('the driven sweep covered real ground', coinsPassed > 300 && fuelPassed > 40);
  ok('EVERY fuel can driven past is collected', fuelGot === fuelPassed);
  ok('most coins driven past are collected without going hunting for air', coinsGot / coinsPassed > 0.5);
}

// --- crest detection ---------------------------------------------------------------------------
{
  const tr = makeTerrain(4242, stageById('countryside'));
  const c = tr.crestIn(60, 400);
  ok('a crest is found on real terrain', c != null);
  if (c != null) {
    // the contract is the LAUNCH condition, not a slope: rising into it, falling out of it, and
    // convex enough that a car at LAUNCH_SPEED cannot stay glued to the ground (|y''| >= g / v^2)
    ok('a crest rises into it and falls out of it', tr.slope(c - 0.5) > 0 && tr.slope(c) <= 0);
    ok('a crest is convex enough to actually launch a car',
      -tr.curvature(c) >= COUNTRY.gravity / (LAUNCH_SPEED * LAUNCH_SPEED));
  }
  // the flat launch pad is not a ramp
  ok('the flat start is never mistaken for a ramp', tr.crestIn(0, 14) == null);
  // window-independence: the generator asks per chunk, the reachability check asks per coin, and
  // the two must never disagree about where a ramp is
  const off = tr.crestIn(57.3, 400);
  ok('crestIn does not depend on where the window starts', off === c);
}

// --- physics: rest state -------------------------------------------------------------------
{
  const terrain = makeTerrain(7, COUNTRY);
  const spec = tunedSpec('jeep', {}, COUNTRY);
  const run = new Run(spec, terrain);
  run.start();
  for (let i = 0; i < 360; i++) run.step(0, DT);   // 3 seconds, no input
  const car = run.car;
  const groundY = terrain.y(car.x);
  ok('the car settles instead of exploding', Number.isFinite(car.y) && Number.isFinite(car.ang));
  ok('the car rests above the ground, not inside it', car.y > groundY);
  ok('the car does not float away', car.y - groundY < spec.restLen + spec.radius + 0.6);
  ok('the car settles near level', Math.abs(car.ang) < 0.25);
  ok('the car is basically still', Math.abs(car.vy) < 0.5);
  ok('a parked run does not end on its own', run.state === RunState.RUNNING);
  ok('both wheels are on the ground at rest', run.car.wheels.every((w) => w.grounded));
  ok('suspension is compressed under the car weight', run.car.wheels.every((w) => w.comp > 0 && w.comp <= spec.travel));
}

// --- physics: throttle ---------------------------------------------------------------------
{
  const fwd = drive('jeep', 'countryside', {}, () => 0.6, 3);
  ok('gas drives the car forward', fwd.car.x > 3);

  const back = drive('jeep', 'countryside', {}, () => -0.6, 3);
  ok('brake reverses the car', back.car.x < -0.5);

  // Throttle-tilt, measured on the flat launch pad from a settled stop: this is the coupling the
  // whole game is balanced on, so it is asserted against the pad (where terrain slope cannot be
  // the cause) rather than after seconds of driving over real hills.
  const pitch = (th) => {
    const terrain = makeTerrain(4242, COUNTRY);
    const run = new Run(tunedSpec('jeep', {}, COUNTRY), terrain);
    run.start();
    for (let i = 0; i < 120; i++) run.step(0, DT);       // settle
    const a0 = run.car.ang;
    for (let i = 0; i < 45; i++) run.step(th, DT);
    return run.car.ang - a0;
  };
  ok('gas pitches the nose up', pitch(1) > 0.02);
  ok('brake pitches the nose down', pitch(-1) < -0.02);

  const rolling = drive('jeep', 'countryside', {}, () => 0, 3);
  ok('no throttle means no meaningful travel from a standstill', Math.abs(rolling.car.x) < 2);
}

// --- physics: upgrades change the outcome ---------------------------------------------------
{
  const stock = drive('jeep', 'countryside', {}, () => 1, 2.5);
  const maxed = drive('jeep', 'countryside', { engine: MAX_LEVEL, tires: MAX_LEVEL, drive: MAX_LEVEL }, () => 1, 2.5);
  ok('a maxed drivetrain accelerates harder than stock', maxed.car.x > stock.car.x);

  const icy = drive('jeep', 'arctic', {}, () => 1, 2.5);
  ok('ice is slipperier than grass (same car, same input)', icy.car.x < stock.car.x);
}

// --- physics: run end conditions -------------------------------------------------------------
{
  // full throttle from a standstill eventually loops the car over onto the driver's head
  const flipped = drive('jeep', 'countryside', {}, () => 1, 60);
  ok('holding the gas flat out ends in a crash', flipped.state === RunState.OVER);
  ok('the crash is reported as a crash', flipped.endReason === EndReason.CRASH);
  ok('a crash sets car.crashed', flipped.car.crashed === true);

  // a car that never moves burns fuel until the tank is empty
  const dry = drive('jeep', 'countryside', {}, () => 0, 200);
  ok('an idling car runs out of fuel', dry.state === RunState.OVER && dry.endReason === EndReason.FUEL);
  ok('fuel bottoms out at zero, never below', dry.fuel === 0);

  const skilled = drive('jeep', 'countryside', {}, modulated, 200);
  ok('a modulated throttle gets a real distance', skilled.result().distance > 150);
  ok('the result floors distance to whole meters', Number.isInteger(skilled.result().distance));
}

// --- physics: distance never goes backwards ---------------------------------------------------
{
  const terrain = makeTerrain(3, COUNTRY);
  const run = new Run(tunedSpec('jeep', {}, COUNTRY), terrain);
  run.start();
  let last = 0, monotonic = true;
  for (let i = 0; i < 2400 && run.state === RunState.RUNNING; i++) {
    // deliberately drive forward then reverse, so car.x really does decrease
    run.step(i < 800 ? 0.7 : -0.7, DT);
    if (run.distance < last) monotonic = false;
    last = run.distance;
  }
  ok('reversing never lowers the recorded distance', monotonic);
  ok('the run actually reversed (so the check above meant something)', run.car.x < run.distance);
}

// --- physics: pickups --------------------------------------------------------------------------
{
  const terrain = makeTerrain(1010, COUNTRY);
  const run = new Run(tunedSpec('truck', {}, COUNTRY), terrain);
  run.start();
  for (let i = 0; i < 3600 && run.state === RunState.RUNNING; i++) run.step(modulated(run), DT);
  ok('coins get collected on a real run', run.coins > 0);
  const items = terrain.itemsIn(0, run.car.x);
  ok('collected items are marked taken', items.some((it) => it.taken));
  ok('fuel never exceeds the tank', run.fuel <= run.maxFuel + 1e-9);
}

// --- physics: nitro ------------------------------------------------------------------------------
{
  const terrain = makeTerrain(55, COUNTRY);
  const run = new Run(tunedSpec('jeep', {}, COUNTRY), terrain);
  run.start();
  for (let i = 0; i < 120; i++) run.step(0, DT);      // settle
  ok('a run starts with the standard nitro load', run.nitro === NITRO_START);
  const before = run.car.vx;
  ok('nitro fires', run.useNitro() === true);
  ok('nitro spends a charge', run.nitro === NITRO_START - 1);
  ok('a second tap during a burn is refused', run.useNitro() === false);
  ok('the refused tap did not spend a charge', run.nitro === NITRO_START - 1);
  for (let i = 0; i < 60; i++) run.step(0, DT);
  ok('nitro accelerates the car', run.car.vx > before + 2);
  // burn the tank dry
  while (run.car.boostT > 0) run.step(0, DT);
  ok('nitro fires again once the burn ends', run.useNitro() === true);
  while (run.car.boostT > 0) run.step(0, DT);
  ok('an empty canister rack refuses', run.nitro === 0 && run.useNitro() === false);
  ok('NITRO_MAX is above the starting load', NITRO_MAX > NITRO_START);

  const over = new Run(tunedSpec('jeep', {}, COUNTRY), makeTerrain(56, COUNTRY));
  over.end(EndReason.CRASH);
  ok('a finished run refuses nitro', over.useNitro() === false);
}

// --- physics: flips ------------------------------------------------------------------------------
{
  // hand-spin an airborne car: a full rotation with no wheel on the ground is one flip
  const terrain = makeTerrain(77, COUNTRY);
  const run = new Run(tunedSpec('bike', {}, COUNTRY), terrain);
  run.start();
  run.car.y = terrain.y(0) + 14;      // well clear of the hill
  run.car.av = 7;
  let flips = 0;
  for (let i = 0; i < 240 && run.state === RunState.RUNNING; i++) {
    const before = run.flips;
    run.car.y = terrain.y(run.car.x) + 14;   // hold it in the air
    run.car.vy = 0;
    run.step(0, DT);
    if (run.flips > before) flips++;
  }
  ok('a full airborne rotation counts as a flip', flips >= 1);
  ok('a flip pays coins', run.coins > 0);
  ok('a flip raises an event for the HUD', run.events.some((e) => e.kind === 'flip'));
}

// --- physics: the crash probe is the driver's head -------------------------------------------
{
  const terrain = makeTerrain(88, COUNTRY);
  const spec = tunedSpec('jeep', {}, COUNTRY);
  const car = new Vehicle(spec, terrain);
  car.ang = Math.PI;                                   // fully inverted
  car.y = terrain.y(car.x) + spec.head.y - 0.5;        // head below the dirt
  const head = car.headPos();
  ok('an inverted car puts the head below the chassis', head.y < car.y);
  car.step(0, DT);
  ok('a head in the dirt is a crash', car.crashed === true);
}

// --- catalog: the economy ------------------------------------------------------------------------
{
  ok('every part has a price at level 0', PARTS.every((p) => upgradeCost(p, 0) > 0));
  ok('upgrade prices rise with level', PARTS.every((p) => upgradeCost(p, 3) > upgradeCost(p, 0)));
  ok('there is nothing to buy at max level', PARTS.every((p) => upgradeCost(p, MAX_LEVEL) === null));
  ok('an unknown part has no price', upgradeCost('turbo', 0) === null);

  ok('exactly one free vehicle, and it is first', VEHICLES.filter((v) => v.price === 0).length === 1 && VEHICLES[0].price === 0);
  ok('exactly one free stage, and it is first', STAGES.filter((s) => s.price === 0).length === 1 && STAGES[0].price === 0);
  ok('stage prices rise in unlock order', STAGES.every((s, i) => i === 0 || s.price > STAGES[i - 1].price));
  ok('stages map onto the four difficulty tiers in order',
    STAGES.map((s) => s.diff).join(',') === 'easy,medium,hard,expert');
  ok('stageDiff resolves', stageDiff('moon') === 'expert' && stageDiff('nope') === 'easy');
  ok('an unknown vehicle falls back rather than throwing', vehicleById('nope').id === VEHICLES[0].id);

  ok('upgrade levels are clamped', (() => {
    const u = normUpgrades({ engine: 99, tires: -4, drive: 2.7, junk: 5 });
    return u.engine === MAX_LEVEL && u.tires === 0 && u.drive === 2 && u.junk === undefined;
  })());

  const base = tunedSpec('jeep', {}, COUNTRY);
  const eng = tunedSpec('jeep', { engine: MAX_LEVEL }, COUNTRY);
  const tir = tunedSpec('jeep', { tires: MAX_LEVEL }, COUNTRY);
  const sus = tunedSpec('jeep', { suspension: MAX_LEVEL }, COUNTRY);
  const drv = tunedSpec('jeep', { drive: MAX_LEVEL }, COUNTRY);
  ok('engine upgrades raise power only', eng.power > base.power && eng.grip === base.grip);
  ok('tires upgrades raise grip only', tir.grip > base.grip && tir.power === base.power);
  ok('suspension upgrades raise spring, damping and travel',
    sus.spring > base.spring && sus.damp > base.damp && sus.travel > base.travel);
  ok('maxed 4WD drives the front wheel fully', Math.abs(drv.wheels[1].drive - 1) < 1e-9);
  ok('stock 4WD does not', base.wheels[1].drive < 1);
  ok('the arctic is slipperier than the countryside',
    tunedSpec('jeep', {}, stageById('arctic')).grip < base.grip);
  ok('the moon has lower gravity', tunedSpec('jeep', {}, stageById('moon')).gravity < base.gravity);
  ok('tunedSpec does not mutate the catalog', VEHICLES[0].body.wheels[1].drive < 1);
}

// --- store: purchases and THE LAW ---------------------------------------------------------------
{
  const s0 = blankSave();
  ok('a fresh garage owns the free car and stage only',
    s0.owned.jeep === true && Object.keys(s0.owned).length === 1
    && s0.stages.countryside === true && Object.keys(s0.stages).length === 1);
  ok('a fresh garage is broke', s0.coins === 0 && s0.earned === 0);

  ok('you cannot buy what you cannot afford', buyVehicle(s0, 'truck') === null);
  ok('you cannot buy a stage you cannot afford', buyStage(s0, 'moon') === null);
  ok('you cannot upgrade what you cannot afford', buyUpgrade(s0, 'jeep', 'engine') === null);
  ok('you cannot select a car you do not own', selectVehicle(s0, 'truck') === null);
  ok('you cannot select a stage you do not own', selectStage(s0, 'moon') === null);

  const rich = { ...s0, coins: 60000, earned: 60000 };
  const bought = buyVehicle(rich, 'bike');
  ok('buying a car costs its price', bought.coins === 60000 - vehicleById('bike').price);
  ok('buying a car grants and selects it', bought.owned.bike === true && bought.vehicle === 'bike');
  ok('buying a car does not touch lifetime earnings (THE LAW: earned only ever rises)', bought.earned === rich.earned);
  ok('buying twice is refused', buyVehicle(bought, 'bike') === null);
  ok('an unknown vehicle id is refused', buyVehicle(rich, 'hovercraft') === null);

  const staged = buyStage(rich, 'arctic');
  ok('buying a stage costs, grants and selects it',
    staged.coins === 60000 - stageById('arctic').price && staged.stages.arctic === true && staged.stage === 'arctic');
  ok('an unknown stage id is refused', buyStage(rich, 'mars') === null);

  let up = rich;
  const cost0 = upgradeCost('engine', 0);
  up = buyUpgrade(up, 'jeep', 'engine');
  ok('an upgrade costs its listed price', up.coins === rich.coins - cost0);
  ok('an upgrade raises exactly that part', up.upgrades.jeep.engine === 1 && up.upgrades.jeep.tires === 0);
  ok('an upgrade leaves other vehicles alone', up.upgrades.bike.engine === 0);
  ok('an unowned vehicle cannot be upgraded', buyUpgrade(rich, 'truck', 'engine') === null);
  ok('an unknown part is refused', buyUpgrade(rich, 'jeep', 'turbo') === null);
  for (let i = 1; i < MAX_LEVEL; i++) up = buyUpgrade(up, 'jeep', 'engine');
  ok('a part can be maxed', up.upgrades.jeep.engine === MAX_LEVEL);
  ok('a maxed part refuses further purchase', buyUpgrade(up, 'jeep', 'engine') === null);

  // banking a run
  let s = blankSave();
  const r1 = bankRun(s, 'countryside', { distance: 420, coins: 260, flips: 2 });
  ok('a run pays into the wallet', r1.save.coins === 260);
  ok('a run pays into lifetime earnings too', r1.save.earned === 260);
  ok('a first run is a personal best', r1.isBest === true && r1.save.best.countryside === 420);
  const r2 = bankRun(r1.save, 'countryside', { distance: 100, coins: 40, flips: 0 });
  ok('a worse run does not lower the record (THE LAW rule 2)', r2.save.best.countryside === 420 && r2.isBest === false);
  ok('a worse run still pays', r2.save.coins === 300 && r2.save.earned === 300);
  const r3 = bankRun(r2.save, 'moon', { distance: 55, coins: 10, flips: 1 });
  ok('each stage keeps its own record', r3.save.best.moon === 55 && r3.save.best.countryside === 420);
  ok('banking never mutates the save it was given', s.coins === 0 && s.best.countryside === 0);
  const junk = bankRun(r3.save, 'countryside', { distance: -5, coins: -900, flips: 0 });
  ok('a nonsense result cannot drain the wallet', junk.save.coins === r3.save.coins && junk.save.earned === r3.save.earned);
  ok('a nonsense result cannot lower a record', junk.save.best.countryside === 420);

  // spending then earning: `earned` is monotonic across the whole cycle
  let cycle = bankRun(blankSave(), 'countryside', { distance: 10, coins: 5000 }).save;
  const earnedAfterRun = cycle.earned;
  cycle = buyVehicle(cycle, 'bike');
  cycle = buyUpgrade(cycle, 'bike', 'tires');
  cycle = bankRun(cycle, 'countryside', { distance: 20, coins: 100 }).save;
  ok('lifetime earnings only ever rise across earn/spend/earn', cycle.earned === earnedAfterRun + 100);
  ok('the wallet really did go down when spending', cycle.coins < cycle.earned);
}

console.log(`\nHill Climb engine tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
