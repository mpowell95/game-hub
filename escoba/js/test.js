// test.js : headless engine assertions (node) - not deployed/precached.
// Run: node escoba/js/test.js
//
// Covers deck construction (both numbering modes), capture/escoba invariants
// over many full AI-vs-AI matches, and a kill-and-resume round-trip through
// an actual JSON serialize/parse (mirroring what localStorage does) to make
// sure Game.snapshot()/Game.fromSnapshot() hold up mid-round.

import { Game, makePlayer } from './game.js';
import { AIAgent } from './ai.js';
import { makeDeck, shuffle, sumValues, captureOptions } from './deck.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('FAIL:', msg); } };
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; }

async function playMatch(seed, nPlayers, diffs, target, deckMode) {
  const players = [];
  for (let i = 0; i < nPlayers; i++) {
    players.push(makePlayer({ id: i, name: 'P' + i, avatar: 'x', agent: new AIAgent({ difficulty: diffs[i % diffs.length] }), difficulty: diffs[i % diffs.length] }));
  }
  const g = new Game({ players, config: { targetScore: target, deckMode }, rng: lcg(seed) });

  g.onEvent = async (type, p) => {
    if (type === 'initialEscoba') {
      const t = sumValues(p.cards);
      ok(t === 15 || t === 30, `initial escoba table sums to 15/30, got ${t}`);
      ok(p.count === (t === 30 ? 2 : 1), 'initial escoba count matches sum');
    }
    if (type === 'play') {
      if (p.captured.length) {
        ok(p.card.value + sumValues(p.captured) === 15, `capture sums to 15 (${p.card.id})`);
        if (p.escoba) ok(g.table.length === 0, 'escoba means empty table');
      } else {
        // Laying a card is only legal when it captures nothing (the engine
        // re-checks, but assert against the table state before the lay).
        const before = g.table.filter((c) => c.id !== p.card.id);
        ok(captureOptions(before, p.card).length === 0, `lay of ${p.card.id} had no capture`);
      }
    }
    if (type === 'roundScored') {
      const total = g.players.reduce((s, pl) => s + pl.captured.length, 0);
      ok(total === 40, `all 40 cards captured at round end, got ${total}`);
      ok(g.table.length === 0, 'table empty after round');
      for (const pl of g.players) {
        const items = pl.roundItems.reduce((s, it) => s + it.points, 0);
        ok(items === pl.roundScore, 'round items sum to round score');
      }
    }
  };

  await g.playMatch();
  ok(!!g.winner, 'match produced a winner');
  if (g.matchEndReason === 'target') {
    const sorted = g.players.slice().sort((a, b) => b.totalScore - a.totalScore);
    ok(sorted[0].totalScore >= target, 'winner reached target');
    ok(sorted[0].totalScore > sorted[1].totalScore, 'winner has sole lead');
  }
  return g;
}

// Deck construction sanity for both numbering modes.
for (const mode of ['spanish', 'american']) {
  const d = makeDeck(mode);
  ok(d.length === 40, `${mode}: 40 cards`);
  for (const suit of ['oros', 'copas', 'espadas', 'bastos']) {
    const vals = d.filter((c) => c.suit === suit).map((c) => c.value).sort((a, b) => a - b);
    ok(vals.join(',') === '1,2,3,4,5,6,7,8,9,10', `${mode}/${suit}: one card of each value 1-10`);
  }
  ok(d.every((c) => mode !== 'american' || c.value === c.rank), `${mode}: values as printed`);
  ok(d.some((c) => c.rank === 7 && c.suit === 'oros'), `${mode}: guindis present`);
}
ok(makeDeck('american').every((c) => c.rank <= 10), 'american: no Caballo/Rey');
ok(makeDeck('spanish').every((c) => c.rank !== 8 && c.rank !== 9), 'spanish: no 8s or 9s');

const wins = { easy: 0, hard: 0 };
for (let seed = 1; seed <= 60; seed++) {
  // 2 players, easy vs hard: the Pro should dominate over many matches.
  const g = await playMatch(seed, 2, ['easy', 'hard'], 21, seed % 2 ? 'american' : 'spanish');
  if (g.winner) wins[g.winner.id === 0 ? 'easy' : 'hard']++;
}
for (let seed = 100; seed < 112; seed++) {
  await playMatch(seed, 3, ['normal', 'normal', 'normal'], 21, 'american');
  await playMatch(seed + 50, 2, ['normal', 'normal'], 31, 'spanish');
}
console.log(`easy vs hard over 60 matches: easy ${wins.easy}, hard ${wins.hard}`);
ok(wins.hard > wins.easy, 'Pro AI beats Beginner AI overall');

// --- resume/snapshot round-trip -------------------------------------------
// Simulates the real app's kill-and-resume flow: abort the live game,
// JSON round-trip its snapshot() (exactly what localStorage does), rebuild
// via Game.fromSnapshot() with fresh agents, and keep playing. Every engine
// invariant must still hold across the seam, up to 3 resumes per match.
async function playMatchWithResume(seed, nPlayers, diffs, target, deckMode) {
  const players = [];
  for (let i = 0; i < nPlayers; i++) {
    players.push(makePlayer({ id: i, name: 'P' + i, avatar: 'x', agent: new AIAgent({ difficulty: diffs[i % diffs.length] }), difficulty: diffs[i % diffs.length] }));
  }
  let currentGame = new Game({ players, config: { targetScore: target, deckMode }, rng: lcg(seed) });
  let qualifyingCount = 0, resumesDone = 0, pauseRequested = false;

  const makeHandler = (game) => async (type, p) => {
    if (type === 'play' || type === 'deal') qualifyingCount++;
    if (type === 'initialEscoba') {
      const t = sumValues(p.cards);
      ok(t === 15 || t === 30, `resume: initial escoba sums to 15/30, got ${t}`);
    }
    if (type === 'play' && p.captured.length) {
      ok(p.card.value + sumValues(p.captured) === 15, `resume: capture sums to 15 (${p.card.id})`);
    }
    if (type === 'roundScored') {
      const total = game.players.reduce((s, pl) => s + pl.captured.length, 0);
      ok(total === 40, `resume: all 40 cards accounted at round end, got ${total}`);
      ok(game.table.length === 0, 'resume: table empty after round');
    }
    // A snapshot taken on the FIRST deal of a round can't safely resume mid
    // initial-escoba-check (same reason the real UI skips saving there), so
    // the test mirrors that and never picks a first-deal event to pause at.
    const eligible = type === 'play' || (type === 'deal' && !p.first);
    if (resumesDone < 3 && eligible && qualifyingCount % 7 === 0 && !pauseRequested) {
      pauseRequested = true;
      game.aborted = true;
    }
  };

  currentGame.onEvent = makeHandler(currentGame);
  await currentGame.playMatch();

  while (pauseRequested && !currentGame.winner) {
    const snap = JSON.parse(JSON.stringify(currentGame.snapshot()));   // mirrors localStorage's round trip
    const agentsById = {};
    for (const sp of snap.players) agentsById[sp.id] = new AIAgent({ difficulty: sp.difficulty });
    const restored = Game.fromSnapshot(snap, agentsById);
    resumesDone++;
    pauseRequested = false;
    restored.onEvent = makeHandler(restored);
    currentGame = restored;
    await currentGame.playMatch();
  }
  ok(resumesDone > 0, 'resume: at least one kill-and-resume actually happened');
  ok(!!currentGame.winner, 'resume: match still produced a winner');
  return currentGame;
}

for (let seed = 500; seed < 520; seed++) {
  await playMatchWithResume(seed, 2, ['easy', 'hard'], 21, seed % 2 ? 'american' : 'spanish');
}
for (let seed = 600; seed < 610; seed++) {
  await playMatchWithResume(seed, 3, ['normal', 'normal', 'normal'], 31, 'spanish');
}

// --- preset deck determinism (multiplayer lockstep) -----------------------
// Two independent Game instances, given the identical deck order and dealer,
// must deal identical hands/table and record the identical lastDeckOrder --
// the guarantee the multiplayer pilot's host->guest deck transmission relies on.
async function playOneRoundWithPreset(seed, deckMode) {
  const order = shuffle(makeDeck(deckMode), lcg(seed)).map((c) => c.id);
  const makePlayers = () => [
    makePlayer({ id: 0, name: 'A', avatar: 'x', agent: new AIAgent({ difficulty: 'normal' }), difficulty: 'normal' }),
    makePlayer({ id: 1, name: 'B', avatar: 'x', agent: new AIAgent({ difficulty: 'normal' }), difficulty: 'normal' }),
  ];
  const g1 = new Game({ players: makePlayers(), config: { targetScore: 21, deckMode, presetDeck: order } });
  const g2 = new Game({ players: makePlayers(), config: { targetScore: 21, deckMode, presetDeck: order } });
  g1.dealer = 0; g2.dealer = 0;
  g1.onEvent = async (type) => { if (type === 'roundScored') g1.abort(); };
  g2.onEvent = async (type) => { if (type === 'roundScored') g2.abort(); };
  await g1.playMatch();
  await g2.playMatch();
  return { g1, g2 };
}

for (const deckMode of ['spanish', 'american']) {
  const { g1, g2 } = await playOneRoundWithPreset(4242, deckMode);
  ok(g1.lastDeckOrder.join(',') === g2.lastDeckOrder.join(','), `preset deck: identical lastDeckOrder (${deckMode})`);
  for (let i = 0; i < g1.players.length; i++) {
    const h1 = g1.players[i].hand.map((c) => c.id).sort().join(',');
    const h2 = g2.players[i].hand.map((c) => c.id).sort().join(',');
    ok(h1 === h2, `preset deck: identical hand for player ${i} (${deckMode})`);
    const c1 = g1.players[i].captured.map((c) => c.id).sort().join(',');
    const c2 = g2.players[i].captured.map((c) => c.id).sort().join(',');
    ok(c1 === c2, `preset deck: identical captured pile for player ${i} (${deckMode})`);
  }
  ok(g1.table.map((c) => c.id).sort().join(',') === g2.table.map((c) => c.id).sort().join(','),
    `preset deck: identical table (${deckMode})`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
