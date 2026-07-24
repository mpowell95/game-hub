// test.js - headless engine + AI assertions (Node, no DOM, no dependencies).
//   node uno/js/test.js
// Requires Node >= 22.7 (ESM syntax detection; there is no package.json), same as
// every other game's test.js in this repo.

import { UnoGame, makeDeck, seededRng, COLORS } from './game.js';
import { chooseAction } from './ai.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); };

function freshHiddenGame(playerCount, rng) {
  const g = Object.create(UnoGame.prototype);
  g.rng = rng; g.onEvent = () => {}; g.n = playerCount;
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

console.log(`\nUno tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
