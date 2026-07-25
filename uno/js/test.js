// test.js - headless engine + AI assertions (Node, no DOM, no dependencies).
//   node uno/js/test.js
// Requires Node >= 22.7 (ESM syntax detection; there is no package.json), same as
// every other game's test.js in this repo.

import { UnoGame, makeDeck, seededRng, COLORS } from './game.js';
import { chooseAction } from './ai.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); };

function freshHiddenGame(playerCount, rng, startPlayer = 0) {
  const g = Object.create(UnoGame.prototype);
  g.rng = rng; g.onEvent = () => {}; g.n = playerCount; g._startPlayer = startPlayer;
  g.players = Array.from({ length: playerCount }, () => ({ hand: [] }));
  g.discard = []; g.direction = 1; g.pendingDraw = 0; g.phase = 'playing';
  g.winner = null; g.currentPlayer = 0; g.activeColor = null;
  g.pendingWild = null; g.mustPlayDrawn = null; g.deck = [];
  return g;
}

// === Deck composition ========================================================

{
  const deck = makeDeck();
  ok('deck: exactly 108 cards', deck.length === 108);
  for (const color of COLORS) {
    const zeros = deck.filter((c) => c.color === color && c.kind === 'number' && c.value === 0);
    ok(`deck: one 0 in ${color}`, zeros.length === 1);
    for (let v = 1; v <= 9; v++) {
      const n = deck.filter((c) => c.color === color && c.kind === 'number' && c.value === v);
      ok(`deck: two ${v}s in ${color}`, n.length === 2);
    }
    for (const kind of ['skip', 'reverse', 'draw2']) {
      const n = deck.filter((c) => c.color === color && c.kind === kind);
      ok(`deck: two ${kind}s in ${color}`, n.length === 2);
    }
  }
  ok('deck: four wilds', deck.filter((c) => c.kind === 'wild').length === 4);
  ok('deck: four wild+4s', deck.filter((c) => c.kind === 'wild4').length === 4);
}

// === +2 stacking accumulates and resolves ====================================

{
  const rng = seededRng(1);
  const g = freshHiddenGame(3, rng);
  g.discard = [{ id: 900, color: 'red', kind: 'number', value: 5 }];
  g.activeColor = 'red';
  g.players[0].hand = [{ id: 1, color: 'red', kind: 'draw2', value: null }, { id: 4, color: 'yellow', kind: 'number', value: 8 }];
  g.players[1].hand = [{ id: 2, color: 'blue', kind: 'draw2', value: null }, { id: 5, color: 'yellow', kind: 'number', value: 8 }];
  g.players[2].hand = [{ id: 3, color: 'green', kind: 'number', value: 1 }]; // no +2 to answer with
  g.deck = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, color: 'yellow', kind: 'number', value: 7 }));

  g.play(0, 1);
  ok('stacking: A plays +2, pile is 2', g.pendingDraw === 2 && g.currentPlayer === 1);
  g.play(1, 2);
  ok('stacking: B stacks +2, pile is 4', g.pendingDraw === 4 && g.currentPlayer === 2);

  const handBefore = g.players[2].hand.length;
  const res = g.draw(2);
  ok('stacking: C without a +2 draws the whole pile', res.drew === 4 && g.players[2].hand.length === handBefore + 4);
  ok('stacking: pile resets to 0 after resolution', g.pendingDraw === 0);
  ok('stacking: C is skipped, turn returns to A', g.currentPlayer === 0);
}

// === Penalty draws are a single lump draw, never draw-until-playable ========

{
  const rng = seededRng(2);
  const g = freshHiddenGame(2, rng);
  g.discard = [{ id: 900, color: 'red', kind: 'number', value: 5 }];
  g.activeColor = 'red';
  g.pendingDraw = 6;
  g.players[0].hand = [{ id: 1, color: 'blue', kind: 'number', value: 3 }]; // no +2
  // Every drawn card is illegal against the current top, but the penalty must still
  // stop at exactly 6 - never keep drawing looking for a playable one.
  g.deck = Array.from({ length: 6 }, (_, i) => ({ id: 200 + i, color: 'green', kind: 'number', value: 9 }));

  const res = g.draw(0);
  ok('penalty: draws exactly the pending amount, not draw-until-playable', res.drew === 6 && g.mustPlayDrawn === null);
  ok('penalty: hand grew by exactly the penalty amount', g.players[0].hand.length === 7);
}

// === Draw-until-playable stops at the first legal card and forces its play ===

{
  const rng = seededRng(3);
  const g = freshHiddenGame(2, rng);
  g.discard = [{ id: 900, color: 'red', kind: 'number', value: 5 }];
  g.activeColor = 'red';
  g.players[0].hand = [{ id: 1, color: 'blue', kind: 'number', value: 2 }]; // no legal move
  // pop() reads from the end: illegal card drawn first, legal (red) card drawn second.
  g.deck = [
    { id: 300, color: 'red', kind: 'number', value: 1 },   // drawn 2nd - legal
    { id: 301, color: 'blue', kind: 'number', value: 9 },  // drawn 1st - illegal
  ];

  let res = g.draw(0);
  ok('draw-until-playable: first illegal draw does not force a play', res.forcedPlay === null && g.mustPlayDrawn === null);
  res = g.draw(0);
  ok('draw-until-playable: stops at the first legal draw', res.forcedPlay === 300);
  ok('draw-until-playable: engine now forces that exact card', g.mustPlayDrawn && g.mustPlayDrawn.cardId === 300);

  let threw = false;
  try { g.play(0, 1); } catch { threw = true; } // hand's original card is no longer legal to substitute
  ok('draw-until-playable: cannot substitute a different card once forced', threw);

  g.play(0, 300);
  ok('draw-until-playable: forced card play succeeds and clears the force', g.mustPlayDrawn === null);
}

// === Reshuffle-on-exhaustion preserves total card count ======================

{
  const rng = seededRng(4);
  const g = freshHiddenGame(2, rng);
  g.discard = [
    { id: 900, color: 'red', kind: 'number', value: 5 },
    { id: 901, color: 'blue', kind: 'number', value: 1 },
    { id: 902, color: 'green', kind: 'number', value: 2 },
  ];
  g.activeColor = 'red';
  g.players[0].hand = [{ id: 1, color: 'blue', kind: 'number', value: 3 }];
  g.deck = []; // forces a reshuffle on the very first draw

  const totalBefore = g.totalCardCount();
  g.draw(0);
  ok('reshuffle: total card count is preserved across a reshuffle', g.totalCardCount() === totalBefore);
  ok('reshuffle: discard collapses to just its top card', g.discard.length === 1 && g.discard[0].id === 902);
}

// === Reverse acts as Skip with exactly 2 players ==============================

{
  const rng = seededRng(5);
  const g = freshHiddenGame(2, rng);
  g.discard = [{ id: 900, color: 'red', kind: 'number', value: 5 }];
  g.activeColor = 'red';
  g.players[0].hand = [{ id: 1, color: 'red', kind: 'reverse', value: null }, { id: 6, color: 'yellow', kind: 'number', value: 8 }];
  g.deck = [];

  g.play(0, 1);
  ok('reverse (2p): direction never flips', g.direction === 1);
  ok('reverse (2p): acts as a skip - same player goes again', g.currentPlayer === 0);
}

// Reverse flips direction with 3+ players (no skip).
{
  const rng = seededRng(6);
  const g = freshHiddenGame(3, rng);
  g.discard = [{ id: 900, color: 'red', kind: 'number', value: 5 }];
  g.activeColor = 'red';
  g.players[0].hand = [{ id: 1, color: 'red', kind: 'reverse', value: null }, { id: 7, color: 'yellow', kind: 'number', value: 8 }];
  g.deck = [];

  g.play(0, 1);
  ok('reverse (3p): flips direction', g.direction === -1);
  ok('reverse (3p): passes to the new "next" player (2), not a skip', g.currentPlayer === 2);
}

// === First-card rules, incl. the Wild +4 reflip ================================

{
  const rng = seededRng(7);
  const g = freshHiddenGame(2, rng);
  // pop() reads from the end: three normal fillers, then a wild+4 on top.
  g.deck = [
    { id: 400, color: 'red', kind: 'number', value: 4 },
    { id: 401, color: 'blue', kind: 'number', value: 6 },
    { id: 402, color: 'green', kind: 'number', value: 8 },
    { id: 403, color: 'wild', kind: 'wild4', value: null },
  ];
  const totalBefore = g.deck.length;
  g._flipFirstCard();
  ok('first-card: a flipped Wild+4 is never left as the starting discard', g.discard[g.discard.length - 1].kind !== 'wild4');
  ok('first-card: the reflip preserves total card count', g.deck.length + g.discard.length === totalBefore);
}

{
  const rng = seededRng(8);
  const g = freshHiddenGame(2, rng);
  g.deck = [{ id: 500, color: 'red', kind: 'skip', value: null }];
  g._flipFirstCard();
  ok('first-card: a Skip is applied to the first player (player 1 opens)', g.currentPlayer === 1);
}

{
  const rng = seededRng(9);
  const g = freshHiddenGame(2, rng);
  g.deck = [
    { id: 550, color: 'yellow', kind: 'number', value: 3 },
    { id: 551, color: 'yellow', kind: 'number', value: 4 },
    { id: 501, color: 'red', kind: 'draw2', value: null },
  ];
  g._flipFirstCard();
  ok('first-card: a +2 makes player 0 draw and player 1 opens', g.players[0].hand.length === 2 && g.currentPlayer === 1);
}

{
  const rng = seededRng(10);
  const g = freshHiddenGame(2, rng);
  g.deck = [{ id: 502, color: 'wild', kind: 'wild', value: null }];
  g._flipFirstCard();
  ok('first-card: a Wild lets player 0 choose the color', g.phase === 'chooseColor' && g.pendingWild.playerIndex === 0);
  g.chooseColor(0, 'blue');
  ok('first-card: after choosing, player 0 still opens (no skip)', g.activeColor === 'blue' && g.currentPlayer === 0);
}

// === First-card rules are RELATIVE to startPlayer, never hardcoded seat 0 ======
//
// The constructor's `startPlayer` option is what ui.js rotates every game so the same
// seat doesn't always open. Every branch above must be re-provable with a non-zero
// starting seat: the effect always lands ON startPlayer, never on seat 0.

{
  const rng = seededRng(20);
  const g = freshHiddenGame(4, rng, 2);   // seat 2 opens
  g.deck = [{ id: 600, color: 'blue', kind: 'number', value: 4 }];
  g._flipFirstCard();
  ok('startPlayer relative: a plain number opens on the given start seat, not seat 0', g.currentPlayer === 2);
}

{
  const rng = seededRng(21);
  const g = freshHiddenGame(4, rng, 2);   // seat 2 opens
  g.deck = [{ id: 601, color: 'blue', kind: 'skip', value: null }];
  g._flipFirstCard();
  ok('startPlayer relative: a Skip is applied to the START seat (2), seat 3 opens', g.currentPlayer === 3);
}

{
  const rng = seededRng(22);
  const g = freshHiddenGame(2, rng, 1);   // seat 1 (not the human/seat 0) opens
  g.deck = [{ id: 602, color: 'blue', kind: 'reverse', value: null }];
  g._flipFirstCard();
  ok('startPlayer relative (2p): reverse still acts as skip - the OTHER seat opens (0), not the start seat', g.currentPlayer === 0);
  ok('startPlayer relative (2p): direction never flips', g.direction === 1);
}

{
  const rng = seededRng(23);
  const g = freshHiddenGame(4, rng, 2);   // seat 2 opens, 3+ players
  g.deck = [{ id: 603, color: 'blue', kind: 'reverse', value: null }];
  g._flipFirstCard();
  ok('startPlayer relative (4p): reverse flips direction', g.direction === -1);
  ok('startPlayer relative (4p): the seat BEFORE start (1) opens, per the flipped order', g.currentPlayer === 1);
}

{
  const rng = seededRng(24);
  const g = freshHiddenGame(4, rng, 2);   // seat 2 opens
  g.deck = [
    { id: 650, color: 'yellow', kind: 'number', value: 3 },
    { id: 651, color: 'yellow', kind: 'number', value: 4 },
    { id: 604, color: 'blue', kind: 'draw2', value: null },
  ];
  g._flipFirstCard();
  ok('startPlayer relative: a first-flip +2 hits the START seat (2), not seat 0', g.players[2].hand.length === 2 && g.players[0].hand.length === 0);
  ok('startPlayer relative: seat 3 opens after the +2', g.currentPlayer === 3);
}

{
  const rng = seededRng(25);
  const g = freshHiddenGame(3, rng, 2);   // seat 2 opens
  g.deck = [{ id: 605, color: 'wild', kind: 'wild', value: null }];
  g._flipFirstCard();
  ok('startPlayer relative: a first-flip Wild is chosen by the START seat, not seat 0', g.phase === 'chooseColor' && g.pendingWild.playerIndex === 2);
  g.chooseColor(2, 'green');
  ok('startPlayer relative: after choosing, the start seat still opens (no skip)', g.activeColor === 'green' && g.currentPlayer === 2);
}

// A full UnoGame construction (not just the isolated _flipFirstCard helper) also honors
// startPlayer end to end, for every seat in a 3-player game, holding presetDeck fixed so
// only startPlayer varies between runs.
{
  // deck.pop() consumes from the END: the 21 fillers deal out first (7 per player x 3),
  // leaving the front element - the flip card - for the very last pop.
  const deckTail = [
    { id: 799, color: 'green', kind: 'number', value: 9 }, // the card that gets flipped
    ...Array.from({ length: 21 }, (_, i) => ({ id: 700 + i, color: 'yellow', kind: 'number', value: 1 })),
  ];
  const openers = [0, 1, 2].map((sp) => {
    const g = new UnoGame({ playerCount: 3, rng: seededRng(30), presetDeck: deckTail.slice(), startPlayer: sp });
    return g.currentPlayer;
  });
  ok('startPlayer end-to-end: a real construction opens on the requested seat for every seat', openers.every((o, i) => o === i));
}

// === Win detection ==============================================================

{
  const rng = seededRng(11);
  const g = freshHiddenGame(2, rng);
  g.discard = [{ id: 900, color: 'red', kind: 'number', value: 5 }];
  g.activeColor = 'red';
  g.players[0].hand = [{ id: 1, color: 'red', kind: 'number', value: 5 }];
  g.deck = [];

  g.play(0, 1);
  ok('win: emptying your hand ends the game', g.phase === 'over' && g.winner === 0);
}

// === Full random games (seeded rng, easy AI) terminate for 2, 3 and 4 players ===

function playRandomGame(playerCount, seed) {
  const rng = seededRng(seed);
  const game = new UnoGame({ playerCount, rng });
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 20000) {
    if (game.phase === 'chooseColor') {
      const chooser = game.pendingWild.playerIndex;
      game.chooseColor(chooser, COLORS[Math.floor(rng() * 4)]);
      continue;
    }
    const pi = game.currentPlayer;
    const action = chooseAction(game, pi, 'easy', rng);
    if (action.type === 'draw') {
      const res = game.draw(pi);
      if (res.forcedPlay) {
        const card = game.players[pi].hand.find((c) => c.id === res.forcedPlay);
        const color = (card.kind === 'wild' || card.kind === 'wild4') ? COLORS[Math.floor(rng() * 4)] : undefined;
        game.play(pi, res.forcedPlay, color);
      }
    } else {
      game.play(pi, action.cardId, action.color);
    }
  }
  return { game, guard };
}

for (const playerCount of [2, 3, 4]) {
  let finished = 0, threw = false;
  for (let seed = 0; seed < 20; seed++) {
    try {
      const { game, guard } = playRandomGame(playerCount, 1000 * playerCount + seed);
      if (game.phase === 'over' && guard < 20000) finished++;
      if (game.totalCardCount() !== 108) { threw = true; console.error(`  total card count drifted for seed ${seed}: ${game.totalCardCount()}`); }
    } catch (err) {
      threw = true;
      console.error(`  random game threw (players=${playerCount}, seed=${seed}):`, err);
    }
  }
  ok(`random games (${playerCount}p): all 20 terminate`, finished === 20);
  ok(`random games (${playerCount}p): none threw, card count always 108`, !threw);
}

// === AI-vs-AI win-rate harness (measured acceptance for the Hard heuristics) ==========
//
// Both seats are driven by chooseAction at two different difficulties. Hard must be
// MEASURABLY stronger, so the suite fails if it doesn't clear the thresholds below. Two
// guards keep this honest (no fudging the harness in Hard's favour):
//   - Seat parity is alternated every game (Hard is seat 0 on even seeds, seat 1 on odd),
//     so the opener's tempo advantage - seat 0 opens every default-startPlayer game -
//     averages out and cannot be mistaken for AI skill.
//   - Both seats draw from the SAME seeded rng stream, so neither gets "better" randomness;
//     the only asymmetry is the difficulty label.
// A wild colour chosen outside chooseAction's normal play path (the first-card-flip wild,
// and a forced-drawn wild) uses one shared majority helper for BOTH seats, so that path is
// symmetric too. The per-game `memory` (opponent wild colours) is rebuilt from every colour
// actually applied, feeding Hard's wild-colour tie-break exactly as the UI does.

function bestColorFor(hand, rng) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (counts[c.color] != null) counts[c.color]++;
  let best = null, bestN = -1;
  for (const col of COLORS) if (counts[col] > bestN) { bestN = counts[col]; best = col; }
  return bestN > 0 ? best : COLORS[Math.floor(rng() * 4)];
}

function playMatchup(diffs, seed) {
  const rng = seededRng(seed);
  const game = new UnoGame({ playerCount: diffs.length, rng });
  const memory = { byPlayer: {} };
  const remember = (pi, color) => { (memory.byPlayer[pi] = memory.byPlayer[pi] || {})[color] = true; };
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 20000) {
    if (game.phase === 'chooseColor') {
      const chooser = game.pendingWild.playerIndex;
      const color = bestColorFor(game.players[chooser].hand, rng);
      game.chooseColor(chooser, color);
      remember(chooser, color);
      continue;
    }
    const pi = game.currentPlayer;
    const action = chooseAction(game, pi, diffs[pi], rng, memory);
    if (action.type === 'draw') {
      const res = game.draw(pi);
      if (res.forcedPlay) {
        const card = game.players[pi].hand.find((c) => c.id === res.forcedPlay);
        const color = (card.kind === 'wild' || card.kind === 'wild4')
          ? bestColorFor(game.players[pi].hand.filter((c) => c.id !== res.forcedPlay), rng) : undefined;
        game.play(pi, res.forcedPlay, color);
        if (color) remember(pi, color);
      }
    } else {
      game.play(pi, action.cardId, action.color);
      if (action.color) remember(pi, action.color);
    }
  }
  return game;
}

/** `games` two-player matchups of hard vs `other`, Hard's seat alternated each game to
 *  cancel the opener advantage. Returns Hard's win fraction. `seedBase` disjoint per call. */
function hardWinRate(other, games, seedBase) {
  let hardWins = 0;
  for (let i = 0; i < games; i++) {
    const hardSeat = i % 2;                       // alternate which seat is Hard
    const diffs = hardSeat === 0 ? ['hard', other] : [other, 'hard'];
    const game = playMatchup(diffs, seedBase + i);
    if (game.phase === 'over' && game.winner === hardSeat) hardWins++;
  }
  return hardWins / games;
}

{
  const GAMES = 500;
  const vsEasy = hardWinRate('easy', GAMES, 100000);
  const vsMedium = hardWinRate('medium', GAMES, 900000);
  console.log(`\nUno AI win-rate (2p, ${GAMES} games each):`);
  console.log(`  Hard vs Easy   : ${(vsEasy * 100).toFixed(1)}%  (threshold >= 65%)`);
  console.log(`  Hard vs Medium : ${(vsMedium * 100).toFixed(1)}%  (threshold >= 55%)`);
  ok(`AI: Hard beats Easy >= 65% over ${GAMES} games (was ${(vsEasy * 100).toFixed(1)}%)`, vsEasy >= 0.65);
  ok(`AI: Hard beats Medium >= 55% over ${GAMES} games (was ${(vsMedium * 100).toFixed(1)}%)`, vsMedium >= 0.55);
}

console.log(`\nUno tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
