// test.js — headless assertions for the Chinchón engine (deck.js + meld.js).
// Run from the hub root:  node chinchon/js/test.js
// Not precached or deployed; pure-engine correctness only.

import { makeDeck, cardValue } from './deck.js';
import {
  bestDeadwood, bestPartition, canClose, isChinchon, isDoubleMeld,
  sixAndOne, classifyClosingHand, attachableCards, generateMelds,
} from './meld.js';

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

console.log(`\nChinchón engine tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
