// js/trip-wires/hillclimb.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM,
// no network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'hillclimb-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (hill-climb/js/physics.js Run.privateLog + ui.js): reason, secs, air, fuelLeft, maxFuel,
// nitroLeft, boosts, cans, coinPicks, coins, flips, dist, veh, up; from 2026-11-25 ped ('<ms><g|b|0>' every pedal
// change), pedN, pedCut, nit (each nitro's ms), thSteps. js/integrity.js already has hillclimb-more-cans-than-road
// and hillclimb-fuel-from-nowhere.
const COIN_MIN = 5, COIN_MAX = 100;     // hill-climb/js/terrain.js COIN_VALUES [5, 25, 100]
const FLIP_BONUS = 50;                  // physics.js FLIP_BONUS: coins for each landed flip
const NITRO_START = 2;                  // physics.js NITRO_START; each fuel can adds one (Run.step)
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function pedTokens(s) {
  const out = [];
  let t = 0;
  for (const tok of String(s || '').split(' ')) {
    const m = /^(\d+)([gb0])$/.exec(tok);
    if (m) { t += Number(m[1]); out.push({ ms: t, c: m[2] }); }
  }
  return out;
}

export default [
  {
    // physics.js Run.step: coins come only from a coin (5, 25 or 100, coinN counts them) and FLIP_BONUS per landed
    // flip, so coins sit between picks x 5 and picks x 100, plus flips x 50; and the recorder's coins are the same.
    id: 'hillclimb-coins-not-earned', proven: true,
    text: 'coins the coins picked up and flips do not give',
    check(e, { a, x }) {
      if (!x) return null;
      const coins = num(x.coins), picks = num(x.coinPicks), flips = num(x.flips);
      if (coins == null || picks == null || flips == null) return null;
      const lo = picks * COIN_MIN + flips * FLIP_BONUS, hi = picks * COIN_MAX + flips * FLIP_BONUS;
      if (coins > hi || coins < lo) return { v: `${coins} coins from ${picks} coins and ${flips} flips`, lim: `${lo}-${hi}` };
      const rec = a && a[2] && typeof a[2] === 'object' ? num(a[2].coins) : null;
      return rec != null && rec !== coins ? { v: `${rec} coins recorded, the run had ${coins}`, lim: coins } : null;
    },
  },
  {
    // physics.js: a run starts with NITRO_START charges and each fuel can adds one (capped), useNitro spends one; so
    // boosts used + charges left cannot pass NITRO_START + cans.
    id: 'hillclimb-nitro-from-nowhere', proven: true,
    text: 'more nitro boosts than the run had',
    check(e, { x }) {
      if (!x) return null;
      const b = num(x.boosts), left = num(x.nitroLeft), cans = num(x.cans);
      if (b == null || left == null || cans == null) return null;
      return b + left > NITRO_START + cans ? { v: `${b} boosts + ${left} left, ${cans} cans`, lim: NITRO_START + cans } : null;
    },
  },
  {
    // ui.js get throttle: the pedal is down only while a pedal is pressed (pointerdown / touchstart) or an arrow key
    // held (keydown). Going from off to gas or brake needs a press (letting go of one of two held pedals also needs the
    // second press first), so those changes cannot outnumber the presses in the touch log.
    id: 'hillclimb-pedal-without-press', proven: true,
    text: 'the pedal pressed more times than the screen or keys were',
    check(e, { x, n }) {
      if (!x || typeof x.ped !== 'string' || x.pedCut || !n || n.cut > 0) return null;
      const tk = pedTokens(x.ped);
      let on = 0, prev = '0';
      for (const q of tk) { if (prev === '0' && q.c !== '0') on++; prev = q.c; }
      const presses = n.downs + n.keys;
      return on > presses ? { v: `${on} pedal presses, ${presses} touches and keys`, lim: presses } : null;
    },
  },
  {
    // Suspicious: 40+ pedal presses with near-identical gaps between them.
    id: 'hillclimb-pedal-like-clockwork', proven: false,
    text: 'pedal presses timed like a machine',
    check(e, { x }) {
      if (!x || typeof x.ped !== 'string') return null;
      const t = pedTokens(x.ped).filter((q) => q.c !== '0').map((q) => q.ms);
      if (t.length < 41) return null;
      const gaps = t.slice(1).map((v, k) => v - t[k]);
      const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((s, v) => s + (v - mean) ** 2, 0) / gaps.length);
      return mean > 0 && sd / mean < 0.1 ? { v: `${gaps.length} presses, ${Math.round(mean)} ms apart, spread ${Math.round(sd)} ms`, lim: '10%' } : null;
    },
  },
];
