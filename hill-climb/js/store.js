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

/** Where a save that failed the audit below is kept, verbatim, for ever (THE LAW rule 5: old keys
 *  are never deleted and never repurposed; rule 3: a value that cannot be carried forward is
 *  archived and still readable). Nothing in the game reads it - it exists so that a rebuild is
 *  recoverable and so a bug report carries what was actually there. */
export const ARCHIVE_KEY = 'gamehub.hillclimb.archive.v1';
const ARCHIVE_MAX = 5;

/** How far the books may be out before the save is called impossible. The cheapest thing anybody
 *  can buy is a level-0 tire at 450 coins, so a gap under this cannot be a purchase that happened
 *  - it can only be rounding, or a future price tweak applied to an old save. Below it, nothing
 *  happens at all. */
export const TAMPER_SLACK = 400;

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
  // `earned` is seeded LAST, because a save written before the field existed still has real
  // spending history and the honest seed is "what is in the wallet PLUS what it already bought".
  // Seeding it from the balance alone (what this did until 2026-09-12) left every such save
  // permanently short by the price of its own garage - invisible then, but auditSave below reads
  // `earned` as the ceiling on every coin that ever existed, so it would have called a legitimate
  // old save impossible and rebuilt somebody's real garage. Order matters here; do not move it.
  out.earned = Number.isFinite(raw.earned)
    ? Math.max(0, Math.floor(raw.earned))
    : out.coins + spentOf(out);
  return out;
}

// --- THE BOOKS MUST BALANCE (2026-09-12) -------------------------------------------------------
//
// Matt, after a player told him he had opened devtools on the desktop and maxed out his coins to
// buy every upgrade: *"I want to reset all his upgrades and coins and prevent this going forward."*
//
// This save lives in localStorage and nowhere else, so there is no server to ask and no remote
// switch to flip - anybody can type a new number into it. What there IS, already, is a
// CONSERVATION LAW hiding in the two money fields, and until now nothing checked it:
//
//     coins + (everything you have bought)  ==  earned
//
// `earned` only ever increments and is never spent from (see this file's header), so it is the
// honest ceiling on every coin that has ever existed for this player. Add up the price of the
// vehicles, stages and upgrade levels a save claims to own, add the balance still in the wallet,
// and the total cannot exceed it. If it does, the save is arithmetically impossible and no
// sequence of real runs and real purchases could have produced it.
//
// This is deliberately NOT a checksum over the blob. A checksum's secret ships inside the very
// JavaScript being tampered with, so it only costs an attacker one more look at the source, and it
// buys a false sense of safety in exchange. The conservation law needs no secret: it is true
// whether or not you can read the code, and the only way around it is to also inflate `earned`,
// which ui.js cross-checks against the SYNCED lifetime coin count (reconcileEarned below).
//
// None of this PREVENTS anything, and it must not be described as if it does. A determined person
// with the shipped source can still edit both numbers consistently. It closes the casual edit -
// which is the one that actually happened - and makes anything past it self-correcting.

/** What a save's purchases actually cost, at today's prices. Vehicles and stages the player
 *  starts with are free by definition, so they never enter the sum. */
export function spentOf(s) {
  let n = 0;
  const owned = (s && s.owned) || {};
  const stages = (s && s.stages) || {};
  const upgrades = (s && s.upgrades) || {};
  for (const id of VEHICLE_IDS) if (id !== DEFAULT_VEHICLE && owned[id]) n += vehicleById(id).price | 0;
  for (const id of STAGE_IDS) if (id !== DEFAULT_STAGE && stages[id]) n += stageById(id).price | 0;
  for (const id of VEHICLE_IDS) {
    const u = upgrades[id] || {};
    for (const p of PARTS) {
      const lvl = Math.max(0, Math.min(MAX_LEVEL, u[p] | 0));
      for (let i = 0; i < lvl; i++) n += upgradeCost(p, i) | 0;
    }
  }
  return n;
}

/** Do the books balance? `gap` is how many coins the save has that it cannot account for; `ok` is
 *  false only once that exceeds TAMPER_SLACK. A NEGATIVE gap is fine and is not tampering - it is
 *  what a price cut or a refunded purchase would look like, and it means the player has LESS than
 *  they were entitled to, never more. Pure: reads no storage, writes nothing. */
export function auditSave(s) {
  const spent = spentOf(s);
  const earned = Math.max(0, (s && s.earned) | 0);
  const coins = Math.max(0, (s && s.coins) | 0);
  const gap = (coins + spent) - earned;
  return { spent, earned, coins, gap, ok: gap <= TAMPER_SLACK };
}

/** The honest save this player is entitled to: every coin they ever EARNED, back in the wallet,
 *  and a garage bought with none of the money that never existed.
 *
 *  `earned` and `best` are untouched - they are the two THE-LAW-governed fields (this file's
 *  header) and they are also the two the cheat never needed to touch. Returning `earned` to the
 *  wallet rather than zeroing it is the point: the player really did drive those runs and really
 *  did collect those coins, and taking them away would punish the real play along with the fake
 *  purchases. What they lose is exactly what they did not pay for. Any key this build does not
 *  recognize rides along untouched (rule 5). */
export function rebuildHonest(s) {
  const blank = blankSave();
  return {
    ...s,
    coins: Math.max(0, (s && s.earned) | 0),
    vehicle: DEFAULT_VEHICLE,
    stage: DEFAULT_STAGE,
    owned: { ...blank.owned },
    stages: { ...blank.stages },
    upgrades: blank.upgrades,
  };
}

/** `earned` is the audit's ceiling, and it has an independent WITNESS: ui.js banks every run into
 *  this save and into js/game-stats.js in the same breath, so `earned` and the shared store's
 *  `hillclimb.hc.coins` are the same running total written twice - and the shared one is mirrored
 *  to Firebase, where Matt can see it.
 *
 *  This only ever takes the HIGHER of the two, never the lower, and that direction is deliberate:
 *
 *  - It REPAIRS a real, known understatement. `earned` was added after this game shipped, and a
 *    save written before it existed was seeded from the wallet BALANCE alone - so it is short by
 *    the price of a garage the player really did buy. Those saves are still out there. Audited
 *    against that understated ceiling they look impossible, and the rebuild below would empty a
 *    legitimate player's garage: a THE LAW rule 1 failure, and a far worse outcome than any cheat.
 *    The witness is not affected by that bug (game-stats.js has always kept its own counter), so
 *    taking the max hands those saves the number they should always have had.
 *  - Raising `earned` is additive, which is the only direction rule 2 permits at all. Lowering it
 *    would ALSO mean trusting the witness to be complete, and a device whose shared stats were
 *    cleared while this key survived would have its garage wrongly rebuilt on that evidence.
 *
 *  The cost, stated plainly: someone who edits BOTH numbers up, consistently, passes the audit.
 *  That is accepted. It cannot be closed from inside a file the cheater is already editing, and
 *  the discrepancy against the Firebase copy is visible to Matt either way - so it is worth
 *  detection, never worth risking one real player's history. */
export function effectiveEarned(s, lifetimeCoins) {
  return Math.max(0, (s && s.earned) | 0, lifetimeCoins | 0);
}

/** Append a verbatim copy of a save to the archive. Never throws, never drops what is already
 *  there, and keeps the oldest entries when the cap is hit (the FIRST rebuild is the interesting
 *  one; later ones are usually the same save being reopened). */
function archive(prev, why) {
  try {
    let list = [];
    try { const raw = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || 'null'); if (Array.isArray(raw)) list = raw; } catch { list = []; }
    if (list.length >= ARCHIVE_MAX) return true;
    list.push({ at: new Date().toISOString(), why, save: prev });
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[hill-climb] archive failed', err);
    return false;
  }
}

/** THE ONE the game mounts with: load, take the higher of the save's own lifetime earnings and
 *  the shared store's witness, audit the books, and rebuild the garage if they still do not
 *  balance. A rebuild archives the old save first, persists, and is LOUD (rule 6) - it is a
 *  correction to a player's own data and must never happen quietly.
 *
 *  `lifetimeCoins` is `gamehub.stats -> games.hillclimb.hc.coins`; pass 0 or omit it and the
 *  witness simply does not apply, leaving the conservation law to stand on its own. Plain `load()`
 *  is left alone so the headless tests, and any future caller that wants the raw save, still get
 *  one. */
export function loadVerified(lifetimeCoins) {
  const s = load();
  const earned = effectiveEarned(s, lifetimeCoins);
  const raised = earned !== (s.earned | 0) ? { ...s, earned } : s;
  const a = auditSave(raised);
  if (a.ok) {
    // The repair is worth persisting on its own: it is additive, and leaving it unsaved means
    // re-deriving it on every single load.
    if (raised !== s) save(raised);
    return raised;
  }
  const out = rebuildHonest(raised);
  out.tamper = { at: new Date().toISOString(), gap: a.gap, spent: a.spent, coins: a.coins, earned };
  console.error('[hill-climb] this save could not have been earned - garage rebuilt.', out.tamper);
  archive(s, 'audit');
  save(out);
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

export default {
  KEY, ARCHIVE_KEY, TAMPER_SLACK, load, loadVerified, save, blankSave, bankRun,
  buyVehicle, buyStage, buyUpgrade, selectVehicle, selectStage,
  spentOf, auditSave, rebuildHonest, effectiveEarned,
};
