// hill-climb/js/store.js — the garage save file: wallet, what you own, what you have tuned, and
// the per-stage distance records. localStorage only; the shared cross-device stats store is a
// separate thing entirely (js/game-stats.js, written from ui.js at the end of every run).
//
// THE LAW (root CLAUDE.md) applies to the two fields that are earned history:
//   `earned`  lifetime coins collected. ONLY EVER INCREMENTS. It is never spent from and never
//             recomputed, so no shop purchase, refund or future rebalance can walk it backwards.
//   `best`    furthest meters per stage. Math.max only, same as every other best in this repo.
// `coins` is the SPENDABLE balance and is deliberately not monotonic: a wallet you can spend from
// is the game mechanic, and `earned` is the record of it that never moves down. Reads are
// defensive: a malformed or absent save reads as a fresh garage and never throws.

import {
  PARTS, MAX_LEVEL, upgradeCost, VEHICLE_IDS, STAGE_IDS,
  DEFAULT_VEHICLE, DEFAULT_STAGE, vehicleById, stageById, normUpgrades,
} from './catalog.js';

export const KEY = 'gamehub.hillclimb.v1';

function blankUpgrades() {
  const u = {};
  for (const p of PARTS) u[p] = 0;
  return u;
}

export function blankSave() {
  const upgrades = {};
  for (const id of VEHICLE_IDS) upgrades[id] = blankUpgrades();
  const best = {};
  for (const id of STAGE_IDS) best[id] = 0;
  return {
    v: 1,
    coins: 0,
    earned: 0,
    vehicle: DEFAULT_VEHICLE,
    stage: DEFAULT_STAGE,
    owned: { [DEFAULT_VEHICLE]: true },
    stages: { [DEFAULT_STAGE]: true },
    upgrades,
    best,
    seenHelp: false,
  };
}

/** Read the save, repairing anything missing or malformed. Never throws; never drops a field it
 *  does not recognize (a future version's extra keys ride along untouched, THE LAW rule 5). */
export function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  const s = blankSave();
  if (!raw || typeof raw !== 'object') return s;
  const out = { ...raw };
  out.v = 1;
  out.coins = Number.isFinite(raw.coins) ? Math.max(0, Math.floor(raw.coins)) : 0;
  // `earned` predates nothing, but an old save written before it existed still has real spending
  // history: seed it from the current balance rather than claiming a lifetime of zero.
  out.earned = Number.isFinite(raw.earned) ? Math.max(0, Math.floor(raw.earned)) : out.coins;
  out.vehicle = VEHICLE_IDS.includes(raw.vehicle) ? raw.vehicle : DEFAULT_VEHICLE;
  out.stage = STAGE_IDS.includes(raw.stage) ? raw.stage : DEFAULT_STAGE;
  out.owned = { ...(raw.owned && typeof raw.owned === 'object' ? raw.owned : {}) };
  out.owned[DEFAULT_VEHICLE] = true;
  out.stages = { ...(raw.stages && typeof raw.stages === 'object' ? raw.stages : {}) };
  out.stages[DEFAULT_STAGE] = true;
  out.upgrades = {};
  for (const id of VEHICLE_IDS) {
    out.upgrades[id] = normUpgrades((raw.upgrades || {})[id]);
  }
  out.best = {};
  for (const id of STAGE_IDS) {
    const b = (raw.best || {})[id];
    out.best[id] = Number.isFinite(b) ? Math.max(0, Math.floor(b)) : 0;
  }
  out.seenHelp = !!raw.seenHelp;
  // A selection pointing at something not owned (hand-edited save, or a catalog change) falls
  // back rather than launching a run in a car the player has not bought.
  if (!out.owned[out.vehicle]) out.vehicle = DEFAULT_VEHICLE;
  if (!out.stages[out.stage]) out.stage = DEFAULT_STAGE;
  return out;
}

/** Persist. Loud on failure (THE LAW rule 6: no silent write failures) and returns success. */
export function save(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch (err) {
    console.error('[hill-climb] save failed', err);
    return false;
  }
}

/** Bank a finished run. Coins are added to BOTH the spendable balance and the lifetime counter;
 *  the stage record only moves if the run beat it. Returns { save, isBest }. */
export function bankRun(s, stageId, result) {
  const out = { ...s };
  const coins = Math.max(0, result.coins | 0);
  const dist = Math.max(0, result.distance | 0);
  out.coins = (s.coins | 0) + coins;
  out.earned = (s.earned | 0) + coins;
  out.best = { ...s.best };
  const prev = out.best[stageId] | 0;
  const isBest = dist > prev;
  out.best[stageId] = Math.max(prev, dist);
  return { save: out, isBest };
}

/** Buy a vehicle. Returns the new save, or null if it is already owned or unaffordable. */
export function buyVehicle(s, id) {
  const v = vehicleById(id);
  if (!v || v.id !== id) return null;
  if (s.owned[id]) return null;
  if ((s.coins | 0) < v.price) return null;
  return { ...s, coins: s.coins - v.price, owned: { ...s.owned, [id]: true }, vehicle: id };
}

/** Buy a stage. Same contract as buyVehicle. */
export function buyStage(s, id) {
  const st = stageById(id);
  if (!st || st.id !== id) return null;
  if (s.stages[id]) return null;
  if ((s.coins | 0) < st.price) return null;
  return { ...s, coins: s.coins - st.price, stages: { ...s.stages, [id]: true }, stage: id };
}

/** Buy one level of `part` for `vehicleId`. Null when maxed, unowned or unaffordable. */
export function buyUpgrade(s, vehicleId, part) {
  if (!PARTS.includes(part) || !s.owned[vehicleId]) return null;
  const cur = (s.upgrades[vehicleId] || {})[part] | 0;
  if (cur >= MAX_LEVEL) return null;
  const cost = upgradeCost(part, cur);
  if (cost == null || (s.coins | 0) < cost) return null;
  return {
    ...s,
    coins: s.coins - cost,
    upgrades: { ...s.upgrades, [vehicleId]: { ...s.upgrades[vehicleId], [part]: cur + 1 } },
  };
}

export function selectVehicle(s, id) {
  if (!s.owned[id]) return null;
  return { ...s, vehicle: id };
}

export function selectStage(s, id) {
  if (!s.stages[id]) return null;
  return { ...s, stage: id };
}

export default { KEY, load, save, blankSave, bankRun, buyVehicle, buyStage, buyUpgrade, selectVehicle, selectStage };
