// meld.js — Chinchón rules engine. PURE: no DOM, no game state, no RNG.
//
// Everything the game needs to reason about a hand lives here:
//   - generateMelds: all candidate sets/runs over a hand (with wildcard fills)
//   - the partition search: choose disjoint melds minimising leftover deadwood
//   - derived queries: canClose, isChinchon, isDoubleMeld, sixAndOne, scoreHand
//   - classifyClosingHand: the 4-priority round-end resolver
//   - attachableCards: "place cards on ending" extension check
//
// A meld is 3+ cards that are either a SET (same rank, distinct suits) or a RUN
// (consecutive ranks in the config ladder, same suit). A wildcard (joker, or the
// Ace of Oros when enabled) substitutes for one missing card. Run adjacency is
// positional in the rank ladder (see deck.rankLadder) — never `rank - 1` — so in
// the 40-card deck the 7 is adjacent to the 10 (Sota). No wrap-around.

import { rankOrderMap, handValue } from './deck.js';

const SUITS = ['oros', 'copas', 'espadas', 'bastos'];

const bit = (i) => 1 << i;
function popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }
function isWildCard(c) { return c.isWild || c.isJoker; }

/** All size-`k` combinations of the array `arr` (small arrays only). */
function combinations(arr, k) {
  const out = [];
  (function rec(start, combo) {
    if (combo.length === k) { out.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop(); }
  })(0, []);
  return out;
}

/**
 * Generate every candidate meld over `hand`, deduplicated by the set of cards it
 * consumes. Each meld is `{ mask, value, kind, idx, ...descriptor }` where `mask`
 * is a bitmask over hand indices and `value` is the total point value of the
 * cards it consumes (melded cards leave the deadwood pile regardless of role).
 */
export function generateMelds(hand, cfg) {
  const n = hand.length;
  const order = rankOrderMap(cfg);
  const ladderLen = order.size;

  const wilds = [];
  for (let i = 0; i < n; i++) if (isWildCard(hand[i])) wilds.push(i);
  const maxWildsPerMeld = Math.min(2, wilds.length);

  const melds = [];
  const seen = new Set();
  const emit = (mask, kind, descriptor) => {
    if (seen.has(mask)) return;
    seen.add(mask);
    let value = 0; const idx = [];
    for (let i = 0; i < n; i++) if (mask & bit(i)) { value += hand[i].value; idx.push(i); }
    melds.push({ mask, value, kind, idx, ...descriptor });
  };

  // --- SETS: group natural cards by rank (jokers have no natural rank) ---
  const byRank = new Map();
  for (let i = 0; i < n; i++) {
    const c = hand[i];
    if (c.isJoker || c.suit == null) continue;
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(i);
  }
  for (const [rank, idxs] of byRank) {
    const m = idxs.length;
    for (let sub = 1; sub < (1 << m); sub++) {
      const chosen = [];
      for (let k = 0; k < m; k++) if (sub & (1 << k)) chosen.push(idxs[k]);
      const s = chosen.length;
      const suits = chosen.map((i) => hand[i].suit);
      // Natural-only set.
      if (s >= 3) {
        let mask = 0; for (const i of chosen) mask |= bit(i);
        emit(mask, 'set', { rank, suits: suits.slice(), size: s });
      }
      // Set completed/padded with wilds (a set tops out at 4 distinct suits).
      for (let w = 1; w <= maxWildsPerMeld; w++) {
        if (s + w < 3 || s + w > 4) continue;
        for (const combo of combinations(wilds, w)) {
          let mask = 0; for (const i of chosen) mask |= bit(i); for (const i of combo) mask |= bit(i);
          emit(mask, 'set', { rank, suits: suits.slice(), size: s + w });
        }
      }
    }
  }

  // --- RUNS: per suit, every window of consecutive ladder positions (len >= 3) ---
  for (const suit of SUITS) {
    const cell = new Array(ladderLen).fill(-1); // ladder pos -> hand idx of that natural card
    for (let i = 0; i < n; i++) {
      const c = hand[i];
      if (c.isJoker || c.suit !== suit) continue;
      const p = order.get(c.rank);
      if (p !== undefined) cell[p] = i;
    }
    for (let a = 0; a < ladderLen; a++) {
      for (let b = a + 2; b < ladderLen; b++) { // length = b-a+1 >= 3
        const realIdx = []; let gaps = 0;
        for (let p = a; p <= b; p++) { if (cell[p] >= 0) realIdx.push(cell[p]); else gaps++; }
        if (realIdx.length < 1) continue;          // a run needs at least one real anchor
        if (gaps > maxWildsPerMeld) continue;      // not enough wilds to fill the gaps
        const desc = { suit, minPos: a, maxPos: b, size: b - a + 1 };
        if (gaps === 0) {
          let mask = 0; for (const i of realIdx) mask |= bit(i);
          emit(mask, 'run', desc);
        } else {
          for (const combo of combinations(wilds, gaps)) {
            let mask = 0; for (const i of realIdx) mask |= bit(i); for (const i of combo) mask |= bit(i);
            emit(mask, 'run', { ...desc });
          }
        }
      }
    }
  }

  return melds;
}

/**
 * Core partition search. Processes cards in index order; each card is either
 * covered by exactly one disjoint meld or left as deadwood — enumerating every
 * partition. Hands are <= 8 cards, so this resolves in microseconds.
 *
 * Returns aggregates computed at each leaf (we never store all partitions):
 *   best            — the minimum-deadwood partition { deadwood, melds, leftoverMask }
 *   minLeftoverLE1  — min leftover value among solutions leaving <= 1 card (Infinity if none)
 *   doubleMeldMelds — a full-cover partition using >= 2 melds, or null
 *   sixAndOne       — { leftoverValue, melds } for a 6-in-2-melds + 1 low leftover, or null
 */
function search(hand, cfg) {
  const n = hand.length;
  const melds = generateMelds(hand, cfg);
  const meldsByCard = Array.from({ length: n }, () => []);
  for (const m of melds) for (const i of m.idx) meldsByCard[i].push(m);

  const valueOfMask = (mask) => { let v = 0; for (let i = 0; i < n; i++) if (mask & bit(i)) v += hand[i].value; return v; };

  let best = { deadwood: Infinity, melds: [], leftoverMask: (n ? (1 << n) - 1 : 0) };
  let minLeftoverLE1 = Infinity;
  let doubleMeldMelds = null;
  let sixAndOne = null;

  function consider(chosen, leftoverMask) {
    const lvCount = popcount(leftoverMask);
    const lvValue = valueOfMask(leftoverMask);
    if (lvValue < best.deadwood) best = { deadwood: lvValue, melds: chosen.slice(), leftoverMask };
    if (lvCount <= 1 && lvValue < minLeftoverLE1) minLeftoverLE1 = lvValue;
    if (lvCount === 0 && chosen.length >= 2 && !doubleMeldMelds) doubleMeldMelds = chosen.slice();
    if (lvCount === 1 && chosen.length === 2 && lvValue >= 1 && lvValue <= 3
      && (!sixAndOne || lvValue < sixAndOne.leftoverValue)) {
      sixAndOne = { leftoverValue: lvValue, melds: chosen.slice() };
    }
  }

  function rec(coveredMask, leftoverMask, chosen) {
    const decided = coveredMask | leftoverMask;
    let i = -1;
    for (let k = 0; k < n; k++) { if (!(decided & bit(k))) { i = k; break; } }
    if (i === -1) { consider(chosen, leftoverMask); return; }
    for (const m of meldsByCard[i]) {
      if ((m.mask & decided) === 0) {
        chosen.push(m);
        rec(coveredMask | m.mask, leftoverMask, chosen);
        chosen.pop();
      }
    }
    rec(coveredMask, leftoverMask | bit(i), chosen);
  }

  rec(0, 0, []);
  return { best, minLeftoverLE1, doubleMeldMelds, sixAndOne };
}

/** Min-deadwood arrangement: { melds, leftover:[idx], deadwood }. */
export function bestPartition(hand, cfg) {
  const r = search(hand, cfg);
  const leftover = [];
  for (let i = 0; i < hand.length; i++) if (r.best.leftoverMask & bit(i)) leftover.push(i);
  return { melds: r.best.melds, leftover, deadwood: r.best.deadwood };
}

/** Minimum total deadwood achievable for `hand`. */
export function bestDeadwood(hand, cfg) {
  return search(hand, cfg).best.deadwood;
}

/** Non-closers always score this way: their minimum deadwood. */
export function scoreHand(hand, cfg) {
  return bestDeadwood(hand, cfg);
}

/**
 * Can this (post-discard, 7-card) hand close? True when some arrangement leaves
 * at most one card and (if one) its value is <= cfg.maxClose (inclusive).
 */
export function canClose(hand, cfg) {
  const threshold = cfg && cfg.maxClose != null ? cfg.maxClose : 3;
  return search(hand, cfg).minLeftoverLE1 <= threshold;
}

/** 7 natural cards of one suit in an unbroken ladder sequence (no wild). */
export function isChinchon(hand, cfg) {
  if (hand.length !== 7) return false;
  const order = rankOrderMap(cfg);
  let suit = null; const pos = [];
  for (const c of hand) {
    if (c.isJoker || c.suit == null) return false;
    if (suit == null) suit = c.suit; else if (c.suit !== suit) return false;
    const p = order.get(c.rank);
    if (p === undefined) return false;
    pos.push(p);
  }
  pos.sort((a, b) => a - b);
  for (let i = 1; i < pos.length; i++) if (pos[i] !== pos[i - 1] + 1) return false;
  return true;
}

/** Exactly 7 cards split into two complete melds (3+4), no leftover. */
export function isDoubleMeld(hand, cfg) {
  if (hand.length !== 7 || isChinchon(hand, cfg)) return false;
  return !!search(hand, cfg).doubleMeldMelds;
}

/** 6 cards in two melds + one leftover of value 1–3: { leftoverValue, melds } or null. */
export function sixAndOne(hand, cfg) {
  if (hand.length !== 7) return null;
  return search(hand, cfg).sixAndOne;
}

/**
 * The round-end resolver for the CLOSER's final 7 cards. Priority order:
 *   chinchón -> double meld (-10) -> six-and-one (leftover value) -> standard (deadwood).
 * Returns { category, score, endsMatch, partition, leftover?, lockedMelds? }.
 */
export function classifyClosingHand(hand, cfg) {
  if (isChinchon(hand, cfg)) {
    const order = rankOrderMap(cfg);
    const positions = hand.map((c) => order.get(c.rank));
    return {
      category: 'chinchon',
      score: cfg.winWithChinchon ? 0 : (cfg.chinchonNegative != null ? cfg.chinchonNegative : -25),
      endsMatch: !!cfg.winWithChinchon,
      partition: [{ kind: 'run', suit: hand[0].suit, minPos: Math.min(...positions), maxPos: Math.max(...positions), size: 7 }],
      leftover: [],
    };
  }
  const r = search(hand, cfg);
  if (r.doubleMeldMelds) {
    return { category: 'doubleMeld', score: -10, endsMatch: false, partition: r.doubleMeldMelds, leftover: [], lockedMelds: r.doubleMeldMelds };
  }
  // Standard deadwood. (A "six-and-one" hand scores the same leftover value as
  // standard; we surface the nicer label when it applies.)
  const leftover = [];
  for (let i = 0; i < hand.length; i++) if (r.best.leftoverMask & bit(i)) leftover.push(i);
  return {
    category: r.sixAndOne ? 'sixAndOne' : 'standard',
    score: r.best.deadwood,
    endsMatch: false,
    partition: r.best.melds,
    leftover,
    lockedMelds: r.best.melds,
  };
}

/**
 * "Place cards on ending": given the closer's locked meld descriptors
 * ({kind:'set',rank,suits} or {kind:'run',suit,minPos,maxPos}), greedily attach
 * as many of `playerHand`'s cards as possible (highest value first, chaining run
 * extensions), to shed deadwood. Returns { attached, remainingHand, deadwoodRemoved }.
 */
export function attachableCards(playerHand, lockedMelds, cfg) {
  const order = rankOrderMap(cfg);
  const melds = lockedMelds.map((m) => m.kind === 'set'
    ? { kind: 'set', rank: m.rank, suits: (m.suits || []).slice() }
    : { kind: 'run', suit: m.suit, minPos: m.minPos, maxPos: m.maxPos });
  const remaining = playerHand.slice();
  const attached = [];

  let changed = true;
  while (changed) {
    changed = false;
    remaining.sort((a, b) => b.value - a.value);
    for (let k = 0; k < remaining.length; k++) {
      const c = remaining[k];
      const wild = isWildCard(c);
      let did = false;
      for (const m of melds) {
        if (m.kind === 'set') {
          if (m.suits.length >= 4) continue;
          if (wild || (c.rank === m.rank && !m.suits.includes(c.suit))) {
            m.suits.push(wild ? null : c.suit); did = true; break;
          }
        } else {
          const p = wild ? null : order.get(c.rank);
          if (wild) {
            if (m.minPos - 1 >= 0) { m.minPos--; did = true; break; }
            if (m.maxPos + 1 < order.size) { m.maxPos++; did = true; break; }
          } else if (c.suit === m.suit) {
            if (p === m.minPos - 1) { m.minPos--; did = true; break; }
            if (p === m.maxPos + 1) { m.maxPos++; did = true; break; }
          }
        }
      }
      if (did) { attached.push(c); remaining.splice(k, 1); changed = true; break; }
    }
  }

  return { attached, remainingHand: remaining, deadwoodRemoved: handValue(attached), updatedMelds: melds };
}
