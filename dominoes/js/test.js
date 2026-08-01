// dominoes/js/test.js — headless assertions for the engine (game.js), the board geometry
// (board.js) and the bot (ai.js). Run: `node dominoes/js/test.js`. Wired into run-all-tests.mjs.

import {
  TILES, tileSum, handSum, mulberry32, DominoesGame,
  openEnds, countEnds, countAfter, legalMoves, placeOn, scoreOf, branchesOpen,
} from './game.js';
import { layoutChain } from './board.js';
import { chooseMove } from './ai.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const idOf = (a, b) => TILES.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
const emptyChain = () => ({ line: [], up: [], down: [], spinnerId: null, originId: null });
function chainOf(moves) {           // moves: [[a,b,side], ...]
  const c = emptyChain();
  for (const [a, b, side] of moves) placeOn(c, idOf(a, b), side || 'right');
  return c;
}

// --- the set --------------------------------------------------------------------------------
eq(TILES.length, 28, 'double-six set is 28 tiles');
eq(new Set(TILES.map((t) => t.join('-'))).size, 28, 'no duplicate tiles');
eq(TILES.reduce((s, t) => s + t[0] + t[1], 0), 168, 'total pips in the set');

// --- counting the ends (All Fives) ------------------------------------------------------------
eq(countEnds(emptyChain()), 0, 'empty board counts nothing');
eq(countEnds(chainOf([[5, 5]])), 10, 'a lone double counts both halves ONCE (5-5 opener = 10)');
eq(countEnds(chainOf([[3, 5]])), 8, 'a lone non-double counts both ends');
eq(countEnds(chainOf([[5, 5], [5, 3, 'right']])), 13, 'double at an end contributes 10, other end 3');
eq(countEnds(chainOf([[5, 5], [5, 3, 'right'], [5, 4, 'left']])), 7,
  'an interior spinner contributes nothing of its own (4 + 3)');
ok(!branchesOpen(chainOf([[5, 5], [5, 3, 'right']])), 'branches shut while the spinner is at an end');
ok(branchesOpen(chainOf([[5, 5], [5, 3, 'right'], [5, 4, 'left']])), 'branches open once the line passes the spinner both ways');
eq(scoreOf(10), 10, 'a multiple of five scores');
eq(scoreOf(7), 0, 'a non-multiple scores nothing');
eq(scoreOf(0), 0, 'zero never scores');

{
  // Branch play: 4-5-5-3 with a 5-2 hung on the spinner's up side. Ends are 4, 3 and 2.
  const c = chainOf([[5, 5], [5, 3, 'right'], [5, 4, 'left']]);
  const ends = openEnds(c);
  eq(ends.length, 4, 'an open spinner exposes four ends');
  ok(ends.some((e) => e.side === 'up' && e.value === 5), 'both branch ends show the spinner value');
  placeOn(c, idOf(5, 2), 'up');
  eq(countEnds(c), 9, 'a branch end joins the count (4 + 3 + 2)');
  placeOn(c, idOf(5, 1), 'down');
  eq(countEnds(c), 10, 'the second branch joins too (4 + 3 + 2 + 1)');
}

{
  // A double hung on a branch counts both halves there as well.
  const c = chainOf([[6, 6], [6, 4, 'right'], [6, 2, 'left']]);
  placeOn(c, idOf(6, 6) === -1 ? 0 : idOf(2, 2), 'left');
  eq(countEnds(c), 8, 'a double at the left end counts 4 (2+2), right end 4');
}

// --- legality -------------------------------------------------------------------------------
{
  const c = emptyChain();
  eq(legalMoves(c, [idOf(0, 1), idOf(6, 6)]).length, 2, 'anything opens an empty board');
  placeOn(c, idOf(4, 6), 'right');
  const moves = legalMoves(c, [idOf(6, 2), idOf(4, 4), idOf(1, 3)]);
  ok(moves.some((m) => m.tileId === idOf(6, 2) && m.side === 'right'), '6-2 fits the 6 end');
  ok(moves.some((m) => m.tileId === idOf(4, 4) && m.side === 'left'), '4-4 fits the 4 end');
  ok(!moves.some((m) => m.tileId === idOf(1, 3)), '1-3 fits neither end');
  eq(moves.length, 2, 'exactly the two matching placements');
}
{
  // A tile matching BOTH ends yields both placements, which is what makes the end badges a
  // real choice rather than decoration.
  const c = chainOf([[3, 6], [6, 3, 'right']]);
  const moves = legalMoves(c, [idOf(3, 3)]);
  eq(moves.length, 2, 'a tile matching both ends offers both sides');
}

// --- placement bookkeeping ---------------------------------------------------------------------
{
  const c = chainOf([[4, 6], [6, 2, 'right'], [1, 4, 'left']]);
  eq(c.line.map((e) => `${e.a}${e.b}`).join(' '), '14 46 62', 'line stays end-to-end consistent');
  for (let i = 0; i + 1 < c.line.length; i++) eq(c.line[i].b, c.line[i + 1].a, 'adjacent halves match');
  eq(c.originId, idOf(4, 6), 'the origin is the first tile played');
  eq(c.spinnerId, null, 'no double played, no spinner');
}
{
  const c = chainOf([[4, 6], [6, 6, 'right'], [6, 1, 'right']]);
  eq(c.spinnerId, idOf(6, 6), 'the first double played becomes the spinner');
  placeOn(c, idOf(1, 1), 'right');
  eq(c.spinnerId, idOf(6, 6), 'a later double does not steal the spinner');
}

// --- countAfter is non-destructive ---------------------------------------------------------------
{
  const c = chainOf([[5, 5]]);
  const before = JSON.stringify(c);
  eq(countAfter(c, { tileId: idOf(5, 0), side: 'right' }), 10, 'preview counts the hypothetical board');
  eq(JSON.stringify(c), before, 'preview never mutates the live chain');
}

// --- round flow ------------------------------------------------------------------------------
{
  const g = new DominoesGame({ rng: mulberry32(7) });
  g.startMatch();
  eq(g.round, 1, 'match starts at round 1');
  eq(g.hands[0].length + g.hands[1].length + g.boneyard.length, 28, 'every tile is dealt somewhere');
  eq(g.hands[0].length, 7, 'seven tiles each');
  eq(g.boneyard.length, 14, 'fourteen in the boneyard');
  const all = new Set([...g.hands[0], ...g.hands[1], ...g.boneyard]);
  eq(all.size, 28, 'no tile is dealt twice');
  // The opener holds the highest double in play.
  const doubles = [...g.hands[0], ...g.hands[1]].filter((id) => TILES[id][0] === TILES[id][1]);
  if (doubles.length) {
    const top = doubles.sort((a, b) => TILES[b][0] - TILES[a][0])[0];
    ok(g.hands[g.turn].includes(top), 'the highest double leads round 1');
  }
}
{
  // A1: going out pays the raw pip total left in the other hand, NOT rounded to a five, and the
  // player who went out has nothing left for the opponent to score.
  const g = new DominoesGame({ rng: mulberry32(1) });
  g.startMatch();
  g.hands = [[idOf(3, 4)], [idOf(1, 2), idOf(6, 5)]];   // 3 + 11 = 14 pips against seat 0
  g.line = []; g.up = []; g.down = []; g.spinnerId = null; g.originId = null;
  g.openerTileId = idOf(3, 4);
  g.scores = [0, 0]; g.roundScore = [0, 0]; g.turn = 0; g.phase = 'playing';
  const res = g.play(0, idOf(3, 4), 'right');
  ok(res.wentOut, 'emptying the hand ends the round');
  eq(res.bonus, 14, 'the bonus is the raw remaining pip count');
  eq(g.scores[0], 14, 'the 3-4 opener counts 7, which is not a five, so only the leftovers score');
  eq(g.scores[1], 0, 'the player who went out leaves nothing for the opponent to score');
}

{
  // A1: a blocked round pays BOTH sides the pips left in the OTHER hand -- not the difference,
  // and not only the lighter hand.
  const g = new DominoesGame({ rng: mulberry32(2) });
  g.startMatch();
  g.line = [{ id: idOf(0, 0), a: 0, b: 0 }]; g.up = []; g.down = [];
  g.spinnerId = idOf(0, 0); g.originId = idOf(0, 0);
  g.hands = [[idOf(1, 2)], [idOf(6, 6), idOf(5, 4)]];   // 3 vs 21
  g.boneyard = []; g.scores = [0, 0]; g.roundScore = [0, 0]; g.turn = 0; g.phase = 'playing';
  eq(g.requiredAction(0), 'pass', 'no play and no boneyard means pass');
  g.pass(0);
  g.pass(1);
  eq(g.phase, 'roundOver', 'two passes in a row block the round');
  eq(g.roundWinner, 0, 'the lighter hand is named the blocked round\'s winner');
  eq(g.scores[0], 21, 'seat 0 scores the pips left in seat 1\'s hand');
  eq(g.scores[1], 3, 'and seat 1 scores the pips left in seat 0\'s hand');
  eq(g.roundEndReason, 'blocked', 'the reason is recorded for the modal');
}

{
  // A1: equal pips on a block still pay BOTH sides (equally); nobody is declared the winner.
  const g = new DominoesGame({ rng: mulberry32(3) });
  g.startMatch();
  // Ends of 6, so neither one-tile hand can play (0-3 would have matched a 0-0 spinner).
  g.line = [{ id: idOf(6, 6), a: 6, b: 6 }]; g.up = []; g.down = [];
  g.spinnerId = idOf(6, 6); g.originId = idOf(6, 6);
  g.hands = [[idOf(1, 2)], [idOf(3, 0)]];              // 3 vs 3
  g.boneyard = []; g.scores = [0, 0]; g.roundScore = [0, 0]; g.turn = 0; g.phase = 'playing';
  g.pass(0); g.pass(1);
  eq(g.roundWinner, null, 'equal pips leave a blocked round with no winner');
  eq([g.scores[0], g.scores[1]].join(), '3,3', 'and both sides still score the other\'s leftovers');
}

{
  // A1 + A4: both sides can cross the target in the same settle, so a match CAN end level.
  const g = new DominoesGame({ target: 50, rng: mulberry32(31) });
  g.startMatch();
  g.line = [{ id: idOf(0, 0), a: 0, b: 0 }]; g.up = []; g.down = [];
  g.spinnerId = idOf(0, 0); g.originId = idOf(0, 0);
  g.hands = [[idOf(6, 6)], [idOf(6, 6) === idOf(5, 5) ? idOf(6, 6) : idOf(5, 5)]];  // 12 vs 10
  g.boneyard = []; g.scores = [40, 42]; g.roundScore = [0, 0]; g.turn = 0; g.phase = 'playing';
  g.pass(0); g.pass(1);
  eq(g.phase, 'matchOver', 'both totals crossing the target ends the match');
  eq([g.scores[0], g.scores[1]].join(), '50,54', 'each side banked the other hand\'s pips');
  eq(g.matchWinner, 1, 'the higher total wins even though both passed the line');
}

{
  // A4: reaching the target is "reach OR PASS", so a final total above it is a normal win.
  const g = new DominoesGame({ target: 300, rng: mulberry32(32) });
  g.startMatch();
  g.line = [{ id: idOf(0, 0), a: 0, b: 0 }]; g.up = []; g.down = [];
  g.spinnerId = idOf(0, 0); g.originId = idOf(0, 0);
  g.hands = [[idOf(2, 3)], [idOf(4, 5)]];
  g.boneyard = []; g.scores = [295, 60]; g.roundScore = [0, 0]; g.turn = 0; g.phase = 'playing';
  g.pass(0); g.pass(1);
  eq(g.scores[0], 304, 'a winning total may overshoot the target');
  eq(g.matchWinner, 0, 'and it still wins');
}

{
  // A3: every round opens with the highest double in play, and the lead is FORCED.
  for (let seed = 1; seed <= 40; seed++) {
    const g = new DominoesGame({ rng: mulberry32(seed * 131) });
    g.startMatch();
    const doubles = [...g.hands[0], ...g.hands[1]].filter((id) => TILES[id][0] === TILES[id][1]);
    const seat = g.turn;
    ok(g.hands[seat].includes(g.openerTileId), `seed ${seed}: the opener holds the forced lead`);
    const moves = g.legalMoves(seat);
    eq(moves.length, 1, `seed ${seed}: the opening lead is the seat's ONLY legal move`);
    eq(moves[0].tileId, g.openerTileId, `seed ${seed}: and it is the forced tile`);
    eq(g.legalMoves(1 - seat).length, 0, `seed ${seed}: the other seat cannot open`);
    if (doubles.length) {
      const top = doubles.slice().sort((a, b) => TILES[b][0] - TILES[a][0])[0];
      eq(g.openerTileId, top, `seed ${seed}: the lead is the HIGHEST double in play`);
      // ...and that makes it the spinner the moment it lands, with no wait-for-a-double logic.
      g.play(seat, g.openerTileId, 'right');
      eq(g.spinnerId, top, `seed ${seed}: the opening double IS the spinner`);
    } else {
      ok(!isDouble(g.openerTileId), `seed ${seed}: with no double dealt, the heaviest tile leads`);
    }
  }
}

{
  // A3, round 2+: the lead is decided by the new deal, NOT by who won the previous round --
  // the "previous round's winner leads" rule is deliberately gone (see dominoes/CLAUDE.md).
  const g = new DominoesGame({ rng: mulberry32(77) });
  g.startMatch();
  g.startRound();
  const doubles = [...g.hands[0], ...g.hands[1]].filter((id) => TILES[id][0] === TILES[id][1]);
  if (doubles.length) {
    const top = doubles.slice().sort((a, b) => TILES[b][0] - TILES[a][0])[0];
    eq(g.openerTileId, top, 'round 2 also opens on the highest double dealt');
    ok(g.hands[g.turn].includes(top), 'and the seat holding it leads');
  }
}

{
  // Drawing: only legal with no play and a stocked boneyard, and it never loses a tile.
  const g = new DominoesGame({ rng: mulberry32(4) });
  g.startMatch();
  g.line = [{ id: idOf(6, 6), a: 6, b: 6 }]; g.up = []; g.down = [];
  g.spinnerId = idOf(6, 6); g.originId = idOf(6, 6);
  g.hands = [[idOf(1, 2)], [idOf(0, 3)]];
  g.boneyard = [idOf(6, 0), idOf(4, 5)];
  g.turn = 0; g.phase = 'playing';
  eq(g.requiredAction(0), 'draw', 'no play but a stocked boneyard means draw');
  ok(!g.pass(0).ok, 'passing is refused while the boneyard has tiles');
  const before = g.hands[0].length + g.boneyard.length;
  const d = g.drawTile(0, idOf(6, 0));
  ok(d.ok && d.canPlay, 'drawing the matching tile makes the seat playable');
  eq(g.hands[0].length + g.boneyard.length, before, 'a draw moves a tile, never mints one');
  ok(!g.draw(0).ok, 'a seat that can play may not keep drawing');
  ok(g.voids[0].includes(6), 'a draw records the ends the seat was missing');
}

{
  // The match ends the moment a total reaches the target.
  const g = new DominoesGame({ target: 50, rng: mulberry32(5) });
  g.startMatch();
  g.hands = [[idOf(2, 3)], [idOf(6, 6), idOf(5, 5)]];
  g.line = []; g.up = []; g.down = []; g.spinnerId = null; g.originId = null;
  g.openerTileId = idOf(2, 3);
  g.scores = [40, 0]; g.roundScore = [0, 0]; g.turn = 0; g.phase = 'playing';
  const res = g.play(0, idOf(2, 3), 'right');
  ok(res.matchOver, 'crossing the target ends the match');
  eq(g.matchWinner, 0, 'and names the winner');
}

// --- snapshot round trip ------------------------------------------------------------------------
{
  const g = new DominoesGame({ rng: mulberry32(11) });
  g.startMatch();
  const m = g.legalMoves(g.turn)[0];
  g.play(g.turn, m.tileId, m.side);
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const g2 = DominoesGame.fromSnapshot(snap, { rng: mulberry32(11) });
  eq(JSON.stringify(g2.snapshot()), JSON.stringify(g.snapshot()), 'a snapshot round-trips exactly');
  eq(g2.countEnds(), g.countEnds(), 'and the restored board counts the same');
}

// --- board geometry ---------------------------------------------------------------------------
const overlap = (r, s) => r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
function firstOverlap(tiles) {
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    if (overlap(tiles[i], tiles[j])) return [i, j];
  }
  return null;
}
{
  const out = layoutChain(emptyChain());
  eq(out.tiles.length, 0, 'an empty chain lays out nothing');
  eq(out.ends.length, 0, 'and exposes no ends');
}
{
  const c = chainOf([[3, 4]]);
  const { tiles } = layoutChain(c);
  eq(tiles.length, 1, 'one tile placed');
  ok(!tiles[0].vertical, 'a non-double opener lies along the line');
  eq(tiles[0].values.join(''), '34', 'and reads left to right as played');
}
{
  const c = chainOf([[5, 5]]);
  const { tiles } = layoutChain(c);
  ok(tiles[0].vertical, 'a double opener lies CROSSWISE to the line');
  eq(tiles[0].h, 4, 'so it is the tall one');
}
{
  // Doubles inside a horizontal run stay crosswise; ordinary tiles stay along it.
  const c = chainOf([[4, 6], [6, 6, 'right'], [6, 1, 'right'], [4, 2, 'left']]);
  const { tiles } = layoutChain(c);
  const byId = Object.fromEntries(tiles.map((t) => [t.id, t]));
  ok(byId[idOf(6, 6)].vertical, 'an in-line double is crosswise');
  ok(!byId[idOf(6, 1)].vertical, 'the tile after it is not');
  ok(!byId[idOf(4, 2)].vertical, 'nor is the one prepended to the left end');
  eq(byId[idOf(4, 2)].values.join(''), '24', 'a left-end tile reads outer half first');
  ok(!firstOverlap(tiles), 'nothing overlaps');
}
{
  // Branches leave the spinner perpendicular to the run.
  const c = chainOf([[5, 5], [5, 3, 'right'], [5, 4, 'left']]);
  placeOn(c, idOf(5, 2), 'up');
  placeOn(c, idOf(5, 1), 'down');
  const { tiles, ends } = layoutChain(c);
  const up = tiles.find((t) => t.id === idOf(5, 2));
  const down = tiles.find((t) => t.id === idOf(5, 1));
  const spin = tiles.find((t) => t.id === idOf(5, 5));
  ok(up.vertical && down.vertical, 'branch tiles run across the main line');
  ok(up.y < spin.y, 'the up branch goes up');
  ok(down.y > spin.y, 'the down branch goes down');
  ok(!firstOverlap(tiles), 'branches do not collide with the line');
  eq(ends.length, 4, 'four open ends are anchored');
  ok(ends.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y)), 'every end has a badge anchor');
}
{
  // A run long enough to fold: the elbow keeps the bounding box from running away, and the
  // chain still never overlaps itself.
  const c = emptyChain();
  const line = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [0, 2], [2, 4], [4, 6], [6, 1], [1, 3]];
  for (const [a, b] of line) placeOn(c, idOf(a, b), 'right');
  const { tiles, bbox } = layoutChain(c);
  eq(tiles.length, line.length, 'every tile is laid out');
  ok(!firstOverlap(tiles), 'a folded run does not overlap itself');
  ok(bbox.w <= 2 * 22 + 8, 'the fold keeps the board inside its width limit');
  ok(tiles.some((t) => t.dir === 'down'), 'the run actually turned a corner');
}

// --- the bot ----------------------------------------------------------------------------------
{
  // Medium takes the points on offer.
  const g = new DominoesGame({ rng: mulberry32(21) });
  g.startMatch();
  g.line = [{ id: idOf(5, 5), a: 5, b: 5 }]; g.up = []; g.down = [];
  g.spinnerId = idOf(5, 5); g.originId = idOf(5, 5);
  g.hands = [[idOf(0, 1)], [idOf(5, 0), idOf(5, 6)]];
  g.turn = 1; g.phase = 'playing';
  // 5-0 leaves 10 + 0 = 10 (scores); 5-6 leaves 10 + 6 = 16 (nothing).
  const m = chooseMove(g, 1, 'medium', mulberry32(1));
  eq(m.tileId, idOf(5, 0), 'medium plays the scoring tile');
}
{
  // With no score available, medium sheds the heaviest tile.
  const g = new DominoesGame({ rng: mulberry32(22) });
  g.startMatch();
  g.line = [{ id: idOf(3, 1), a: 3, b: 1 }]; g.up = []; g.down = [];
  g.spinnerId = null; g.originId = idOf(3, 1);
  // Ends are 3 and 1. Neither 1-4 (3+4=7) nor 1-6 (3+6=9) scores, so weight decides.
  g.hands = [[idOf(0, 2)], [idOf(1, 4), idOf(1, 6)]];
  g.turn = 1; g.phase = 'playing';
  const m = chooseMove(g, 1, 'medium', mulberry32(1));
  eq(m.tileId, idOf(1, 6), 'medium sheds the heavier tile when nothing scores');
}
{
  // Every tier returns a legal move, or null only when there genuinely is none.
  for (const diff of ['easy', 'medium', 'hard']) {
    const g = new DominoesGame({ rng: mulberry32(31) });
    g.startMatch();
    let guard = 0;
    while (g.phase === 'playing' && guard++ < 400) {
      const seat = g.turn;
      const need = g.requiredAction(seat);
      if (need === 'play') {
        const m = chooseMove(g, seat, diff, mulberry32(guard));
        ok(!!m, `${diff}: a playable seat gets a move`);
        const legal = g.legalMoves(seat).some((x) => x.tileId === m.tileId && x.side === m.side);
        ok(legal, `${diff}: the chosen move is legal`);
        g.play(seat, m.tileId, m.side);
      } else if (need === 'draw') g.draw(seat);
      else g.pass(seat);
    }
    ok(g.phase !== 'playing', `${diff}: the round terminates`);
  }
}

// --- full-match integrity sweep -----------------------------------------------------------------
{
  let matches = 0, overlapSeen = 0, badCount = 0, lostTiles = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = mulberry32(seed * 977);
    const g = new DominoesGame({ target: 300, rng: rnd });
    g.startMatch();
    let guard = 0;
    while (g.phase !== 'matchOver' && guard++ < 4000) {
      if (g.phase === 'roundOver') { g.startRound(); continue; }
      const seat = g.turn;
      const need = g.requiredAction(seat);
      if (need === 'play') {
        const diff = ['easy', 'medium', 'hard'][seat === 0 ? seed % 3 : (seed + 1) % 3];
        const m = chooseMove(g, seat, diff, rnd);
        g.play(seat, m.tileId, m.side);
        // Every tile ever dealt is still accounted for, and the chain still lays out cleanly.
        const placed = g.line.length + g.up.length + g.down.length;
        if (placed + g.hands[0].length + g.hands[1].length + g.boneyard.length !== 28) lostTiles++;
        const { tiles } = layoutChain(g.chain);
        if (tiles.length !== placed) badCount++;
        if (firstOverlap(tiles)) overlapSeen++;
      } else if (need === 'draw') g.draw(seat);
      else g.pass(seat);
    }
    ok(g.phase === 'matchOver', `seed ${seed}: the match reaches a winner`);
    ok(Math.max(g.scores[0], g.scores[1]) >= 300, `seed ${seed}: the winner actually crossed 300`);
    matches++;
  }
  eq(lostTiles, 0, 'no tile is ever lost or duplicated mid-match');
  eq(badCount, 0, 'the layout always renders every placed tile');
  eq(overlapSeen, 0, 'no chain in 60 full matches ever overlaps itself');
  ok(matches === 60, 'all 60 matches ran');
}

// --- scoring only ever happens on a five ---------------------------------------------------------
{
  let plays = 0, bad = 0;
  const rnd = mulberry32(4242);
  for (let seed = 0; seed < 20; seed++) {
    const g = new DominoesGame({ rng: rnd });
    g.startMatch();
    let guard = 0;
    while (g.phase === 'playing' && guard++ < 400) {
      const seat = g.turn;
      const need = g.requiredAction(seat);
      if (need === 'play') {
        const m = chooseMove(g, seat, 'medium', rnd);
        const before = g.scores.slice();
        const res = g.play(seat, m.tileId, m.side);
        plays++;
        const gained = g.scores[seat] - before[seat];
        const fromPlay = gained - (res.bonus || 0);
        if (fromPlay !== 0 && fromPlay % 5 !== 0) bad++;
        if (g.scores[1 - seat] !== before[1 - seat]) bad++;
      } else if (need === 'draw') g.draw(seat);
      else g.pass(seat);
    }
  }
  ok(plays > 100, 'the sweep actually played a lot of tiles');
  eq(bad, 0, 'in-play scores are always multiples of five, and only the mover ever scores');
}

console.log(`\ndominoes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
