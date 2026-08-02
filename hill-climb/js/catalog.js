// hill-climb/js/catalog.js — the static catalog: vehicles, stages, upgrade parts and the money
// maths that binds them. Pure data + pure functions, no DOM and no storage, so the economy is
// unit-testable headless (hill-climb/js/test.js) and the same numbers drive the garage screen,
// the physics tuning and the tests.
//
// Units are SI-ish game units: meters, seconds, kilograms, newtons. One world meter renders as
// PX_PER_M pixels at zoom 1 (render.js). Values are tuned for FEEL, not realism: gravity is
// stronger than Earth's so hops land quickly and the car feels planted.

/** The four upgradeable parts, in the order the TUNE screen lists them. */
export const PARTS = ['engine', 'suspension', 'tires', 'drive'];
/** Upgrades run 0 (stock) through MAX_LEVEL. Level 0 costs nothing and is where every car starts. */
export const MAX_LEVEL = 6;

/** Per-part base price. cost(level) = round(base * GROWTH^level), so the last level of a part
 *  costs roughly 24x the first — the classic "one more run" money sink. */
const PART_BASE = { engine: 600, suspension: 500, tires: 450, drive: 800 };
const GROWTH = 1.7;

/** Price of moving `part` from `level` to `level + 1`. Returns null at MAX_LEVEL (nothing to buy). */
export function upgradeCost(part, level) {
  if (!PART_BASE[part]) return null;
  const lvl = Math.max(0, Math.min(MAX_LEVEL, level | 0));
  if (lvl >= MAX_LEVEL) return null;
  return Math.round(PART_BASE[part] * Math.pow(GROWTH, lvl));
}

// --- vehicles ----------------------------------------------------------------------------------
//
// `body` is the physics spec (physics.js reads it through tunedSpec below); `paint` is the render
// spec (render.js). Wheel anchors are in chassis-local meters from the center of mass, x forward,
// y UP (the whole world is y-up; only render.js flips to screen coordinates).
//
// COM height vs wheel anchor is the single most load-bearing number for feel: the further the
// center of mass sits above the contact patch, the more eagerly the car pitches under throttle.
// The bike's is deliberately high (tippy, backflips easily), the monster truck's low (planted).

export const VEHICLES = [
  {
    id: 'jeep',
    nameKey: 'veh_jeep',
    price: 0,
    body: {
      mass: 400, inertia: 190,
      wheels: [
        { x: -1.02, y: -0.20, drive: 1.0 },   // rear
        { x: 1.02, y: -0.20, drive: 0.18 },   // front
      ],
      radius: 0.40, restLen: 0.46, travel: 0.30,
      spring: 24000, damp: 1750,
      power: 5200, reaction: 1150, airTorque: 2.6,
      grip: 1.05, fuel: 100,
      head: { x: -0.16, y: 1.02 },            // driver head, in chassis-local meters
      hull: { w: 2.5, h: 0.72 },
    },
    paint: { body: '#d8382b', trim: '#9a1f16', seat: '#7b1a12', rim: '#e8e2d6' },
  },
  {
    id: 'bike',
    nameKey: 'veh_bike',
    price: 2500,
    body: {
      mass: 240, inertia: 88,
      wheels: [
        { x: -0.74, y: -0.16, drive: 1.0 },
        { x: 0.74, y: -0.16, drive: 0.0 },
      ],
      radius: 0.36, restLen: 0.40, travel: 0.34,
      spring: 12600, damp: 820,
      power: 3700, reaction: 1050, airTorque: 3.2,
      grip: 0.98, fuel: 88,
      head: { x: -0.02, y: 1.06 },
      hull: { w: 1.7, h: 0.46 },
    },
    paint: { body: '#1F5FA8', trim: '#123c6c', seat: '#20242b', rim: '#d9d3c6' },
  },
  {
    id: 'truck',
    nameKey: 'veh_truck',
    price: 8000,
    body: {
      mass: 760, inertia: 430,
      wheels: [
        { x: -1.24, y: -0.30, drive: 1.0 },
        { x: 1.24, y: -0.30, drive: 0.45 },
      ],
      radius: 0.64, restLen: 0.62, travel: 0.44,
      spring: 44000, damp: 3000,
      power: 9200, reaction: 1900, airTorque: 2.1,
      grip: 1.18, fuel: 118,
      head: { x: -0.14, y: 1.16 },
      hull: { w: 2.8, h: 0.86 },
    },
    paint: { body: '#178A7A', trim: '#0d5a4f', seat: '#123', rim: '#efe9dc' },
  },
  {
    id: 'rover',
    nameKey: 'veh_rover',
    price: 18000,
    body: {
      mass: 330, inertia: 165,
      wheels: [
        { x: -1.16, y: -0.24, drive: 1.0 },
        { x: 1.16, y: -0.24, drive: 0.85 },
      ],
      radius: 0.46, restLen: 0.52, travel: 0.38,
      spring: 20000, damp: 1500,
      power: 4700, reaction: 950, airTorque: 2.9,
      grip: 1.1, fuel: 140,
      head: { x: -0.10, y: 1.04 },
      hull: { w: 2.6, h: 0.56 },
    },
    paint: { body: '#F2B705', trim: '#a67c04', seat: '#33383f', rim: '#cfd4da' },
  },
];

export const VEHICLE_IDS = VEHICLES.map((v) => v.id);
export const DEFAULT_VEHICLE = 'jeep';
export function vehicleById(id) { return VEHICLES.find((v) => v.id === id) || VEHICLES[0]; }

// --- stages ------------------------------------------------------------------------------------
//
// A stage is the terrain generator's parameter set plus its palette. `diff` is the stats
// difficulty bucket (js/game-stats.js's byDiff, js/difficulty-tiers.js's 1-4 tier scale): the
// four stages ARE this game's difficulty axis, 1:1 and in order, so the leaderboard's per-tier
// breakdown is the per-stage breakdown. There is no separate difficulty picker.

export const STAGES = [
  {
    id: 'countryside', nameKey: 'stage_countryside', diff: 'easy', price: 0,
    gravity: 22, rough: 1.0, ramp: 340, grip: 1.0,
    sky: '#8fd3f0', dirt: '#8d5a34', dirtDark: '#754828', grass: '#4caf3d', grassDark: '#2f7a26',
    tuft: '#2f7a26', far: '#6fa8c9',
  },
  {
    id: 'desert', nameKey: 'stage_desert', diff: 'medium', price: 3000,
    gravity: 22, rough: 1.35, ramp: 300, grip: 0.88,
    sky: '#ffd39a', dirt: '#c08a4a', dirtDark: '#a3703a', grass: '#e3c07a', grassDark: '#c39a52',
    tuft: '#9a7a3c', far: '#e0a86a',
  },
  {
    id: 'arctic', nameKey: 'stage_arctic', diff: 'hard', price: 9000,
    gravity: 22, rough: 1.6, ramp: 260, grip: 0.62,
    sky: '#cfe9f7', dirt: '#7f8fa6', dirtDark: '#6a798e', grass: '#f4fbff', grassDark: '#c7dced',
    tuft: '#a9c6dd', far: '#a8c6dc',
  },
  {
    id: 'moon', nameKey: 'stage_moon', diff: 'expert', price: 20000,
    gravity: 9.5, rough: 2.0, ramp: 220, grip: 0.8,
    sky: '#141a2e', dirt: '#8b8b93', dirtDark: '#70707a', grass: '#b7b7bf', grassDark: '#8f8f99',
    tuft: '#75757f', far: '#2a3350',
  },
];

export const STAGE_IDS = STAGES.map((s) => s.id);
export const DEFAULT_STAGE = 'countryside';
export function stageById(id) { return STAGES.find((s) => s.id === id) || STAGES[0]; }
/** Stage id -> stats difficulty bucket ('easy'|'medium'|'hard'|'expert'). See STAGES above. */
export function stageDiff(id) { return stageById(id).diff; }

// --- upgrades applied --------------------------------------------------------------------------

/** Normalize an upgrade record to {engine,suspension,tires,drive} of ints in [0, MAX_LEVEL]. */
export function normUpgrades(u) {
  const out = {};
  for (const p of PARTS) {
    const n = u && Number.isFinite(u[p]) ? Math.floor(u[p]) : 0;
    out[p] = Math.max(0, Math.min(MAX_LEVEL, n));
  }
  return out;
}

/** The physics spec a vehicle actually runs with, after its upgrades and the stage's surface.
 *  Pure: never mutates the catalog entry. Each part moves exactly one axis of feel, so the TUNE
 *  screen's four bars mean four different things on the hill:
 *    engine      raw drive force (climbs steeper, spins the wheels more on ice)
 *    suspension  spring rate, damping and travel (soaks up landings instead of bouncing)
 *    tires       grip, i.e. the friction cone the drive force is clamped into (traction)
 *    drive       front-wheel drive share, 4WD at the top (pulls as well as pushes) */
export function tunedSpec(vehicleId, upgrades, stage) {
  const v = vehicleById(vehicleId);
  const u = normUpgrades(upgrades);
  const st = stage || STAGES[0];
  const b = v.body;
  const frontBase = b.wheels[1].drive;
  const frontShare = frontBase + (1 - frontBase) * (u.drive / MAX_LEVEL);
  return {
    mass: b.mass,
    inertia: b.inertia,
    radius: b.radius,
    restLen: b.restLen,
    travel: b.travel * (1 + 0.06 * u.suspension),
    spring: b.spring * (1 + 0.10 * u.suspension),
    damp: b.damp * (1 + 0.12 * u.suspension),
    power: b.power * (1 + 0.17 * u.engine),
    reaction: b.reaction,
    airTorque: b.airTorque,
    grip: (b.grip + 0.12 * u.tires) * st.grip,
    fuel: b.fuel,
    gravity: st.gravity,
    head: b.head,
    hull: b.hull,
    wheels: [
      { x: b.wheels[0].x, y: b.wheels[0].y, drive: b.wheels[0].drive },
      { x: b.wheels[1].x, y: b.wheels[1].y, drive: frontShare },
    ],
  };
}

export default { PARTS, MAX_LEVEL, upgradeCost, VEHICLES, STAGES, tunedSpec };
