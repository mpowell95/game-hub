// test.js — headless assertions for the Chinchón engine (deck.js + meld.js).
// Run from the hub root:  node chinchon/js/test.js
// Not precached or deployed; pure-engine correctness only.

import { makeDeck, cardValue, shuffle } from './deck.js';
import {
  bestDeadwood, bestPartition, canClose, isChinchon, isDoubleMeld,
  sixAndOne, classifyClosingHand, attachableCards, generateMelds,
} from './meld.js';
import { Game, makePlayer } from './game.js';
import { AIAgent } from './ai.js';
import { stateHash } from './hash.js';

const DEF = { extended: false, joker: false, aceOrosWild: false, figuresFaceValue: false, maxClose: 3, winWithChinchon: true, chinchonNegative: -25 };
const EXT = { ...DEF, extended: true };
const JOK = { ...DEF, joker: true };
const ACE = { ...DEF, aceOrosWild: true };

const SI = { oros: 'o', copas: 'c', espadas: 'e', bastos: 'b' };
const C = (suit, rank, cfg = DEF) => ({
  id: SI[suit] + rank, suit, rank, value: cardValue(rank, cfg),
  isJoker: false, isWild: !!cfg.aceOrosWild && suit === 'oros' && rank === 1,
});
const JK = (n) => ({ id: 'jk' + n, suit: null, rank: 0, value: 25, isJoker: true, isWild: true });

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  FAIL:', name); }
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error(`  FAIL: ${name} — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// --- deck ---
eq('40-card deck size', makeDeck(DEF).length, 40);
eq('48-card deck size', makeDeck(EXT).length, 48);
eq('40 + 2 jokers', makeDeck(JOK).length, 42);
eq('pip value', cardValue(5, DEF), 5);
eq('figure flat 10', cardValue(11, DEF), 10);
eq('figure own value', cardValue(11, { ...DEF, figuresFaceValue: true }), 11);

// --- basic melds ---
eq('set deadwood 0', bestDeadwood([C('oros', 3), C('copas', 3), C('espadas', 3)], DEF), 0);
eq('run deadwood 0', bestDeadwood([C('oros', 5), C('oros', 6), C('oros', 7)], DEF), 0);
eq('two singles deadwood', bestDeadwood([C('oros', 4), C('copas', 9)], DEF), 13);

// --- 7↔10 adjacency depends on the ladder ---
eq('7-10 adjacent in 40-card', bestDeadwood([C('bastos', 6), C('bastos', 7), C('bastos', 10)], DEF), 0);
eq('7-10 NOT adjacent in 48-card',
  bestDeadwood([C('bastos', 6, EXT), C('bastos', 7, EXT), C('bastos', 10, EXT)], EXT), 6 + 7 + 10);

// --- wildcards ---
eq('joker completes a run', bestDeadwood([C('oros', 5), C('oros', 6), JK(1)], JOK), 0);
eq('joker completes a set', bestDeadwood([C('oros', 3), C('copas', 3), JK(1)], JOK), 0);
eq('ace-of-oros as wild completes run',
  bestDeadwood([C('oros', 1, ACE), C('copas', 6), C('copas', 7)], ACE), 0);

// --- chinchón ---
const chinchon = [1, 2, 3, 4, 5, 6, 7].map((r) => C('oros', r));
assert('isChinchon true', isChinchon(chinchon, DEF));
assert('chinchon not double-meld', !isDoubleMeld(chinchon, DEF));
eq('chinchon classify score (win=0)', classifyClosingHand(chinchon, DEF).score, 0);
assert('chinchon endsMatch', classifyClosingHand(chinchon, DEF).endsMatch === true);
eq('chinchon negative when configured',
  classifyClosingHand(chinchon, { ...DEF, winWithChinchon: false }).score, -25);
assert('almost-chinchon (gap) is not chinchon',
  !isChinchon([1, 2, 3, 4, 5, 6, 10].map((r) => C('oros', r)), DEF));
assert('7 same-suit but mixed is not chinchon (different suit)',
  !isChinchon([C('oros', 1), C('oros', 2), C('oros', 3), C('oros', 4), C('oros', 5), C('oros', 6), C('copas', 7)], DEF));

// --- double meld (-10): set(3) + run(4) ---
const dbl = [C('oros', 3), C('copas', 3), C('espadas', 3), C('bastos', 4), C('bastos', 5), C('bastos', 6), C('bastos', 7)];
assert('isDoubleMeld true', isDoubleMeld(dbl, DEF));
eq('double meld score -10', classifyClosingHand(dbl, DEF).score, -10);
eq('double meld category', classifyClosingHand(dbl, DEF).category, 'doubleMeld');

// --- six-and-one: set(3)+run(3)+leftover(2) ---
const sao = [C('oros', 4), C('copas', 4), C('espadas', 4), C('bastos', 5), C('bastos', 6), C('bastos', 7), C('oros', 2)];
assert('sixAndOne detected', !!sixAndOne(sao, DEF));
eq('sixAndOne leftover value', sixAndOne(sao, DEF).leftoverValue, 2);
eq('sixAndOne classify score', classifyClosingHand(sao, DEF).score, 2);
eq('sixAndOne classify category', classifyClosingHand(sao, DEF).category, 'sixAndOne');

// --- closing eligibility + threshold ---
const close3 = [C('oros', 5), C('copas', 5), C('espadas', 5), C('bastos', 6), C('bastos', 7), C('bastos', 10), C('oros', 3)];
assert('canClose with leftover 3 (maxClose 3)', canClose(close3, DEF));
const close4 = [C('oros', 5), C('copas', 5), C('espadas', 5), C('bastos', 6), C('bastos', 7), C('bastos', 10), C('oros', 4)];
assert('cannot close with leftover 4 (maxClose 3)', !canClose(close4, DEF));
assert('can close leftover 4 when maxClose 4', canClose(close4, { ...DEF, maxClose: 4 }));

// canClose is about leftover COUNT, not just deadwood: low total deadwood but 2 leftovers => cannot close.
const twoLeft = [C('oros', 2), C('oros', 3), C('oros', 4), C('oros', 5), C('oros', 6), C('copas', 1), C('espadas', 1)];
eq('two-leftover hand has deadwood 2', bestDeadwood(twoLeft, DEF), 2);
assert('cannot close despite deadwood<=3 (2 cards left)', !canClose(twoLeft, DEF));

// --- standard scoring (figures flat 10) ---
const std = [C('oros', 4), C('copas', 4), C('espadas', 4), C('bastos', 5), C('bastos', 6), C('bastos', 7), C('oros', 12)];
eq('standard deadwood = figure flat 10', classifyClosingHand(std, DEF).score, 10);
eq('standard category', classifyClosingHand(std, DEF).category, 'standard');

// --- bestPartition returns the leftover indices ---
const bp = bestPartition(std, DEF);
eq('bestPartition leftover is the 12', bp.leftover.map((i) => std[i].rank), [12]);

// --- place cards on ending ---
const lockedSet = [{ kind: 'set', rank: 3, suits: ['oros', 'copas', 'espadas'] }];
const place1 = attachableCards([C('bastos', 3), C('oros', 9)], lockedSet, DEF);
eq('attach 4th card to a set', place1.attached.map((c) => c.id), ['b3']);
eq('place-cards deadwood removed', place1.deadwoodRemoved, 3);
const lockedRun = [{ kind: 'run', suit: 'bastos', minPos: 3, maxPos: 6 }]; // bastos 4..7 (ladder pos 3..6)
const place2 = attachableCards([C('bastos', 10), C('bastos', 3)], lockedRun, DEF); // 10 extends top, 3 extends bottom
eq('attach to both ends of a run (chained)', place2.attached.map((c) => c.id).sort(), ['b10', 'b3']);

// --- generateMelds sanity ---
assert('generateMelds finds the set', generateMelds([C('oros', 3), C('copas', 3), C('espadas', 3)], DEF).some((m) => m.kind === 'set'));

// --- M2a: multiplayer groundwork (snapshot, preset deck, state hash) --------
// 'hard' tier AI (blunder 0, closeEagerness 1.0) is deterministic purely from
// game state -- neither threshold actually depends on the rng's value, only
// on it being < those constants (always/never true) -- so two independently
// constructed 'hard' AIAgent instances make byte-identical decisions given
// identical state, with no shared seed required.
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; }
const hardAgents = () => [
  makePlayer({ id: 0, name: 'A', avatar: 'x', agent: new AIAgent({ difficulty: 'hard' }) }),
  makePlayer({ id: 1, name: 'B', avatar: 'x', agent: new AIAgent({ difficulty: 'hard' }) }),
];

// T4.1 — presetDeck: two Games, same preset + same (deterministic) agent
// decisions -> identical hands, stock, discard at round end. `rng` is also
// shared (not just the deck order): a long round can exhaust the stock and
// trigger tryResetStock()'s own shuffle, which reads this.rng -- without a
// shared seed there, two otherwise-identical games could diverge on a reset
// the same way two default-Math.random() instances would.
async function playOneRoundWithPreset(seed) {
  const order = shuffle(makeDeck(DEF), lcg(seed)).map((c) => c.id);
  const g = new Game({ players: hardAgents(), config: { ...DEF, presetDeck: order }, rng: lcg(seed + 1) });
  g.onEvent = async (type) => { if (type === 'roundScored') g.abort(); };
  await g.playMatch();
  return g;
}

for (const seed of [11, 202, 3003]) {
  const g1 = await playOneRoundWithPreset(seed);
  const g2 = await playOneRoundWithPreset(seed);
  eq(`presetDeck: identical lastDeckOrder (seed ${seed})`, g1.lastDeckOrder, g2.lastDeckOrder);
  eq(`presetDeck: identical stock (seed ${seed})`, g1.stock.map((c) => c.id), g2.stock.map((c) => c.id));
  eq(`presetDeck: identical discard (seed ${seed})`, g1.discard.map((c) => c.id), g2.discard.map((c) => c.id));
  for (let i = 0; i < g1.players.length; i++) {
    eq(`presetDeck: identical hand for player ${i} (seed ${seed})`,
      g1.players[i].hand.map((c) => c.id).sort(), g2.players[i].hand.map((c) => c.id).sort());
  }
}

// T4.2 — snapshot roundtrip: play N scripted turns, snapshot, fromSnapshot
// into two independent instances, then drive each and compare stateHash
// after every subsequent turn (a mismatch anywhere means the restore lost
// state the resumed match actually depends on).
async function playScriptedTurns(seed, n) {
  const order = shuffle(makeDeck(DEF), lcg(seed)).map((c) => c.id);
  // maxResets: 0 -- fromSnapshot() hardcodes a fresh Math.random() rng (same
  // as Escoba's), same as production would (a restored engine has no reason
  // to reproduce the ORIGINAL's rng stream). That's fine for everything
  // except tryResetStock()'s own reshuffle, which reads it; disabling resets
  // for this test keeps gA/gB's post-restore continuation deterministic
  // without weakening what's actually being verified (turn/discard/hand
  // state, not the reset-shuffle path, which is out of scope for M2a).
  const g = new Game({ players: hardAgents(), config: { ...DEF, presetDeck: order, maxResets: 0 } });
  let turns = 0;
  g.onEvent = async (type) => {
    // Abort at the START of turn n+1 (turnStart fires before any card moves)
    // -- a genuine between-turns boundary: turn n is already fully committed
    // (hasHadTurn included), turn n+1 hasn't touched state yet. Aborting
    // mid-turn instead (e.g. right after 'discard') would skip the
    // hasHadTurn=true commit for that turn -- exactly the mid-turn snapshot
    // this module's snapshot() doc comment says never to take.
    if (type === 'turnStart') { turns++; if (turns === n + 1) g.abort(); }
  };
  await g.playMatch();
  return g;
}

async function collectHashesToOneRoundEnd(g) {
  const hashes = [];
  g.onEvent = async (type) => {
    if (type === 'discard') hashes.push(stateHash(g));
    if (type === 'roundScored') g.abort();
  };
  await g.playMatch();
  return hashes;
}

for (const [seed, n] of [[7, 3], [77, 6], [777, 9]]) {
  const scripted = await playScriptedTurns(seed, n);
  assert(`resume: aborted mid-round after ${n} turns (seed ${seed})`, scripted._midRound);
  const snap = JSON.parse(JSON.stringify(scripted.snapshot()));   // mirrors localStorage's round trip

  const mkAgents = () => { const m = {}; for (const sp of snap.players) m[sp.id] = new AIAgent({ difficulty: 'hard' }); return m; };
  const gA = Game.fromSnapshot(JSON.parse(JSON.stringify(snap)), mkAgents());
  const gB = Game.fromSnapshot(JSON.parse(JSON.stringify(snap)), mkAgents());

  const hashesA = await collectHashesToOneRoundEnd(gA);
  const hashesB = await collectHashesToOneRoundEnd(gB);
  assert(`resume: at least one further turn played (seed ${seed})`, hashesA.length > 0);
  eq(`resume: identical hash sequence after restoring from snapshot (seed ${seed})`, hashesA, hashesB);
  eq(`resume: identical final stock/discard (seed ${seed})`,
    { stock: gA.stock.map((c) => c.id), discard: gA.discard.map((c) => c.id) },
    { stock: gB.stock.map((c) => c.id), discard: gB.discard.map((c) => c.id) });
  for (let i = 0; i < gA.players.length; i++) {
    eq(`resume: identical final hand for player ${i} (seed ${seed})`,
      gA.players[i].hand.map((c) => c.id).sort(), gB.players[i].hand.map((c) => c.id).sort());
  }
}

// T4.3 — hash stability: identical state -> identical hash; one card moved -> different hash.
{
  const mkGame = (hand0) => {
    const g = new Game({ players: hardAgents(), config: DEF });
    g.players[0].hand = hand0;
    g.players[1].hand = [C('espadas', 5)];
    g.stock = [C('bastos', 6)];
    g.discard = [C('oros', 7)];
    return g;
  };
  const g1 = mkGame([C('oros', 3), C('copas', 4)]);
  const h1a = stateHash(g1);
  const h1b = stateHash(g1);
  eq('hash stability: identical state -> identical hash', h1a, h1b);

  const g3 = mkGame([C('oros', 3), C('copas', 4), C('bastos', 1)]);
  assert('hash stability: a moved/added card changes the hash', h1a !== stateHash(g3));

  // Cosmetic hand-order drift (same cards, different array order) must NOT
  // change the hash -- hands are sorted by id before hashing.
  const g2 = mkGame([C('copas', 4), C('oros', 3)]);   // same two cards, reversed
  eq('hash stability: hand order is cosmetic, not part of the hash', h1a, stateHash(g2));
}

// --- M2b T0: deterministic stock reset --------------------------------------
// A direct unit test of tryResetStock()'s two hooks (no full match needed):
// the host shuffles and reports; the guest, given that exact reported order,
// reaches byte-identical stock/discard with no shuffle of its own.
{
  const startDiscard = () => [C('oros', 1), C('copas', 2), C('espadas', 3), C('bastos', 4)];

  const gHost = new Game({ players: hardAgents(), config: { ...DEF, maxResets: 2 }, rng: lcg(999) });
  gHost.discard = startDiscard();
  let reported = null;
  gHost.config.onStockReset = (order) => { reported = order; };
  assert('T0: host-style reset succeeds', gHost.tryResetStock());
  assert('T0: host reset reports an order (discard minus its top)', Array.isArray(reported) && reported.length === 3);
  eq('T0: host stock matches what it reported', gHost.stock.map((c) => c.id), reported);
  eq('T0: discard left with only the top card', gHost.discard.map((c) => c.id), ['b4']);
  eq('T0: resetsUsed incremented', gHost.resetsUsed, 1);

  const gGuest = new Game({ players: hardAgents(), config: { ...DEF, maxResets: 2, presetStockResets: [reported] } });
  gGuest.discard = startDiscard();
  assert('T0: guest-style (preset) reset succeeds', gGuest.tryResetStock());
  eq('T0: guest stock matches host exactly (no independent shuffle)', gGuest.stock.map((c) => c.id), gHost.stock.map((c) => c.id));
  eq('T0: guest discard matches host', gGuest.discard.map((c) => c.id), gHost.discard.map((c) => c.id));

  // config.onStockReset must NOT fire when a preset order is consumed (the
  // guest never actually shuffles, so there is nothing new to report).
  let guestReported = false;
  gGuest.config.onStockReset = () => { guestReported = true; };
  gGuest.discard = [C('oros', 5), C('copas', 6)];
  gGuest.resetsUsed = 0;
  gGuest.config.presetStockResets = [['o5']];   // 2nd-call shape irrelevant; just needs an entry
  gGuest.tryResetStock();
  assert('T0: onStockReset is not called when a preset order was consumed', !guestReported);
}

// --- M2b T0: full-match scenario -- same presetDeck + scripted (deterministic
// hard-AI) moves, stock forced near-empty so a reset actually fires mid-match.
// Host shuffles+reports; guest consumes the report via presetStockResets;
// both reach identical post-reset stock/discard/hands with no shared rng. ---
async function playForcingOneReset(seed, opts = {}) {
  const order = shuffle(makeDeck(DEF), lcg(seed)).map((c) => c.id);
  const cfg = { ...DEF, presetDeck: order, maxResets: 1, ...opts };
  const g = new Game({ players: hardAgents(), config: cfg, rng: lcg(seed + 1) });
  g.onEvent = async (type) => {
    // Force exhaustion soon after the deal (stock is fully dealt by the time
    // 'roundStart' fires, before any turn plays) so the reset fires within a
    // handful of turns instead of needing to script ~25 real draws.
    if (type === 'roundStart') g.stock = g.stock.slice(0, 2);
    if (type === 'roundScored') g.abort();
  };
  await g.playMatch();
  return g;
}

for (const seed of [55, 555]) {
  const reported = [];
  const gHost = await playForcingOneReset(seed, { onStockReset: (o) => reported.push(o) });
  assert(`T0: a reset actually fired mid-match (seed ${seed})`, gHost.resetsUsed === 1);
  eq(`T0: exactly one order was reported (seed ${seed})`, reported.length, 1);

  const gGuest = await playForcingOneReset(seed, { presetStockResets: reported });
  eq(`T0: identical stock after a shared-order reset (seed ${seed})`, gHost.stock.map((c) => c.id), gGuest.stock.map((c) => c.id));
  eq(`T0: identical discard (seed ${seed})`, gHost.discard.map((c) => c.id), gGuest.discard.map((c) => c.id));
  for (let i = 0; i < gHost.players.length; i++) {
    eq(`T0: identical hand for player ${i} (seed ${seed})`,
      gHost.players[i].hand.map((c) => c.id).sort(), gGuest.players[i].hand.map((c) => c.id).sort());
  }
  eq(`T0: identical stateHash post-reset (seed ${seed})`, stateHash(gHost), stateHash(gGuest));
}

console.log(`\nChinchón engine tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
