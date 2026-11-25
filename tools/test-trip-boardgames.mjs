// tools/test-trip-boardgames.mjs - the trip wires of Yahtzee, Dots and Boxes, Filler, Connect Four, Connect 4 Hoops, Tic Tac
// Toe, Mancala, Battleship and Battle Arena (js/trip-wires/<game>.js, 2026-11-25). Pure, no network.
// Every rule gets a passing case (a game played by the game's own engine, logged the way its ui.js logs it) and a failing
// one (the same log with one thing a person cannot do), plus its proven flag. The replay over real plays is
// tools/test-play-input.mjs --db.
//   node tools/test-trip-boardgames.mjs
import { runTripWires, TRIP_GAMES } from '../js/trip-wires/index.js';
import { mulberry32, autoPlace, shipSetFor } from '../battleship/js/fleet.js';
import { newGame as bsNew, setFleet, fireAndResolve, isShotLegal } from '../battleship/js/game.js';
import * as DB from '../dots-boxes/js/game.js';
import * as FL from '../filler/js/game.js';
import Game from '../connect-four/js/game.js';
import { Match } from '../hoops4/js/game.js';
import * as TT from '../tic-tac-toe/js/game.js';
import * as MC from '../mancala/js/game.js';
import * as BA from '../battle-arena/js/engine.js';

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fail++; };
const J = JSON.stringify;
const clone = (v) => JSON.parse(J(v));
const hits = (e, n = null) => runTripWires(e, n);
const has = (e, rule, n = null) => hits(e, n).some((h) => h.rule === rule);
const none = (e, n = null) => hits(e, n).length === 0;
const proven = (id) => Object.values(TRIP_GAMES).flat().find((r) => r.id === id)?.proven;
const T0 = 1795000000000;
/** A touch log (js/play-log-queue.js `n` format): `k` presses (down + up), 400 ms apart, starting at t0, a move each. */
const touches = (k, t0 = T0, extra = {}) => J({ v: 1, t0, w: 390, h: 844, pt: 'touch', ...extra, ev: Array.from({ length: k }, (_, i) => `${i ? 300 : 0}d100,200 50m101,201 50u101,201`).join(' ') });
const rnd = mulberry32(7);
const pick = (list) => list[Math.floor(rnd() * list.length)];
/** Human-like gaps: 400 ms to 4 s. */
const gap = () => 400 + Math.floor(rnd() * 3600);

// Every rule this file covers says proven or suspicious, and ids are unique.
const ids = ['yahtzee', 'dotsboxes', 'filler', 'connect4', 'hoops4', 'tictactoe', 'mancala', 'battleship', 'battlearena'].flatMap((g) => TRIP_GAMES[g].map((r) => r.id));
ok(`every game here has at least 3 rules (${ids.length} rules)`, ['yahtzee', 'dotsboxes', 'filler', 'connect4', 'hoops4', 'tictactoe', 'mancala', 'battleship', 'battlearena'].every((g) => TRIP_GAMES[g].length >= 3));
ok('rule ids are unique', new Set(ids).size === ids.length);
ok('every game has a proven and a suspicious rule', ['yahtzee', 'dotsboxes', 'filler', 'connect4', 'hoops4', 'tictactoe', 'mancala', 'battleship', 'battlearena'].every((g) => TRIP_GAMES[g].some((r) => r.proven) && TRIP_GAMES[g].some((r) => !r.proven)));

// --- Yahtzee -----------------------------------------------------------------------------------------------------------
{
  const ev = [
    ['r', 0, [5, 4, 5, 4, 3], '00000', 1000], ['r', 0, [5, 4, 5, 4, 5], '11110', 2600], ['c', 0, 'fullHouse', 25, 4100],
    ['r', 1, [1, 2, 3, 4, 6], '00000', 5200], ['c', 1, 'smallStraight', 30, 6000],
    ['r', 0, [6, 6, 6, 6, 6], '00000', 8000], ['c', 0, 'yahtzee', 50, 9900],
    ['r', 1, [2, 2, 3, 5, 6], '00000', 11000], ['c', 1, 'twos', 4, 11800],
    ['r', 0, [3, 3, 3, 3, 3], '00000', 13500], ['c', 0, 'threes', 15, 16000],
  ];
  const yz = (x, a = ['ai', true, { yahtzees: 2, score: 0 }]) => ({ f: 'recordYahtzee', g: 'yahtzee', a: J(a), x: J({ end: 'x', me: 0, res: 0, t0: T0, ...x }) });
  ok('yahtzee: a real run of turns passes', none(yz({ ev })));
  const bad = clone(ev); bad[2][3] = 30;
  ok('yahtzee: a full house scored 30 is PROVEN (score-not-dice)', has(yz({ ev: bad }), 'yahtzee-score-not-dice') && proven('yahtzee-score-not-dice'));
  const joker = clone(ev); joker[10] = ['c', 0, 'chance', 15, 16000];
  ok('yahtzee: a bonus Yahtzee put in Chance while its Threes box is open is caught (joker rule)', has(yz({ ev: joker }), 'yahtzee-score-not-dice'));
  const twice = clone(ev); twice.push(['r', 0, [1, 1, 2, 2, 2], '00000', 18000], ['c', 0, 'fullHouse', 25, 19000]);
  ok('yahtzee: a box scored twice is caught', has(yz({ ev: twice }), 'yahtzee-score-not-dice'));
  ok('yahtzee: a resumed log with no cards at the resume is not judged', none(yz({ ev: bad, res: 1 })));
  ok('yahtzee: a resumed log judges from the cards at the resume', has(yz({ ev: bad, res: 1, cards0: [{}, {}] }), 'yahtzee-score-not-dice'));
  // The finished card vs the recorder.
  const full = (base) => Object.fromEntries(['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'].map((c, i) => [c, base + i]));
  const mine = full(5), theirs = full(1);   // upper 5..10 = 45 (no bonus); total 5*13+78 = 143
  const tot = (c) => Object.values(c).reduce((s, v) => s + v, 0);
  const card = (score, won) => yz({ end: 'over', ev: [], cards: [mine, theirs], bonus: [100, 0] }, ['ai', won, { yahtzees: 2, score }]);
  ok('yahtzee: a recorded score equal to the card passes', none(card(tot(mine) + 100, true)));
  ok('yahtzee: a recorded score the card does not give is PROVEN', has(card(tot(mine) + 150, true), 'yahtzee-score-not-card') && proven('yahtzee-score-not-card'));
  ok('yahtzee: a recorded win on a losing card is caught', has(yz({ end: 'over', ev: [], cards: [theirs, mine], bonus: [0, 0] }, ['ai', true, { yahtzees: 0, score: tot(theirs) }]), 'yahtzee-score-not-card'));
  // Taps.
  ok('yahtzee: 6 rolls and boxes from 9 presses pass', none(yz({ ev: ev.slice(0, 7) }), touches(9)));
  ok('yahtzee: 7 of the player\'s rolls and boxes from 3 presses is PROVEN', has(yz({ ev }), 'yahtzee-rolls-without-taps', touches(3)) && proven('yahtzee-rolls-without-taps'));
  ok('yahtzee: actions before the touch log began are not counted', none(yz({ ev, t0: T0 - 60000 }), touches(3)));
  ok('yahtzee: a touch log that may have lost presses (cut, no moves left) is not judged', none(yz({ ev }), J({ v: 1, t0: T0, cut: 40, ev: '0d1,1 10u1,1' })));
  ok('yahtzee: no touch log, no judgement', none(yz({ ev })));
  // Pace.
  const even = []; for (let k = 0; k < 40; k++) even.push(['r', k % 2, [1, 2, 3, 4, 6], '00000', k * 700]);
  ok('yahtzee: 20 rolls exactly 1.4 s apart is suspicious', has(yz({ ev: even }), 'yahtzee-machine-pace') && proven('yahtzee-machine-pace') === false);
  let t = 0; const human = []; for (let k = 0; k < 40; k++) { t += gap(); human.push(['r', k % 2, [1, 2, 3, 4, 6], '00000', t]); }
  ok('yahtzee: uneven human gaps pass', !has(yz({ ev: human }), 'yahtzee-machine-pace'));
}

// --- Dots and Boxes ----------------------------------------------------------------------------------------------------
{
  const play = (rows = 3, cols = 3) => {
    const s = DB.newGame(rows, cols); const ev = []; let t = 0;
    while (!DB.isOver(s)) { const m = pick(DB.legalMoves(s)); t += gap(); ev.push(['m', s.turn, m.type, m.r, m.c, t]); DB.applyMove(s, m); }
    return { s, ev };
  };
  const { s, ev } = play();
  const sc = DB.score(s);
  const won = sc.p0 > sc.p1 ? true : sc.p0 < sc.p1 ? false : null;
  const db = (x, a = ['pro', won, {}], d = { mine: sc.p0, theirs: sc.p1 }) => ({ f: 'recordDotsBoxes', g: 'dotsboxes', a: J(a), d: J(d), x: J({ end: 'over', rows: 3, cols: 3, me: 0, p0: sc.p0, p1: sc.p1, res: 0, x0: 0, t0: T0, ...x }) });
  ok('dots and boxes: a whole game played by the engine passes', none(db({ ev })));
  const swapped = clone(ev); swapped[0][1] = 1;
  ok('dots and boxes: a line drawn out of turn is PROVEN (moves-not-board)', has(db({ ev: swapped }), 'dotsboxes-moves-not-board') && proven('dotsboxes-moves-not-board'));
  const dup = clone(ev); dup[dup.length - 1] = [...dup[0].slice(0, 5), dup[dup.length - 1][5]]; dup[dup.length - 1][1] = 0;
  ok('dots and boxes: the same line drawn twice is caught', has(db({ ev: dup }), 'dotsboxes-moves-not-board'));
  ok('dots and boxes: a recorded box count the board does not give is caught', has(db({ ev }, undefined, { mine: sc.p0 + 2, theirs: sc.p1 }), 'dotsboxes-moves-not-board'));
  ok('dots and boxes: a recorded win the board does not give is PROVEN', has(db({ ev }, ['pro', won === true ? false : true, {}]), 'dotsboxes-win-not-board') && proven('dotsboxes-win-not-board'));
  ok('dots and boxes: a log begun after a resume (x0 > 0) is not judged', none(db({ ev: swapped, x0: 2 })));
  ok('dots and boxes: an older log (no x0) missing the opening line is not judged', none(db({ ev: swapped.slice(1), x0: undefined })));
  // Undo + Redo replay: take the last 2 lines back, then put them back exactly (ui.js logs 'u' 2 then 'r' 2): the same game.
  const withUndo = [...ev.slice(0, ev.length - 2), ...ev.slice(ev.length - 2), ['u', 2, 99999], ['r', 2, 99999]];
  ok('dots and boxes: an Undo then a Redo replays to the same board', none(db({ ev: withUndo })));
  const mine = ev.filter((q) => q[1] === 0).length;
  ok('dots and boxes: lines from as many presses pass', none(db({ ev }), touches(mine)));
  ok('dots and boxes: more of the player\'s lines than presses is PROVEN', has(db({ ev }), 'dotsboxes-edges-without-taps', touches(mine - 1)) && proven('dotsboxes-edges-without-taps'));
  const robot = play(4, 4).ev.map((q, k) => [...q.slice(0, 5), k * 250]);
  ok('dots and boxes: lines exactly 250 ms apart are suspicious (4x4)', has(db({ ev: robot, rows: 4, cols: 4 }), 'dotsboxes-machine-pace') && proven('dotsboxes-machine-pace') === false);
}

// --- Filler ------------------------------------------------------------------------------------------------------------
{
  const s = FL.newGame(mulberry32(11));
  const start = Array.from(s.colors).join('');
  const mv = []; let t = 0;
  while (!s.over && mv.length < 150) { const mover = s.turn, c = pick(FL.legalColors(s)); t += gap(); mv.push([mover, c, FL.applyMove(s, c).length, t]); }
  const won = s.winner === FL.P1;
  const fl = (x, a = ['filler', 'pro', won], d = { mine: s.counts[1], theirs: s.counts[2] }) => ({ f: 'recordResult', g: 'filler', a: J(a), d: J(d), x: J({ end: 'over', start, mv, n: mv.length, part: 0, counts: [s.counts[1], s.counts[2]], win: s.winner, me: FL.P1, t0: T0, ...x }) });
  ok(`filler: a whole game played by the engine passes (${mv.length} picks, winner ${s.winner})`, none(fl({})));
  const greedy = clone(mv); greedy[1][2] += 5;
  ok('filler: a pick logged with more squares than the board gives is PROVEN', has(fl({ mv: greedy }), 'filler-moves-not-board') && proven('filler-moves-not-board'));
  const illegal = clone(mv); illegal[2][1] = illegal[0][1];   // the colour the other player holds, or its own: never on offer
  ok('filler: a colour not on offer is caught', has(fl({ mv: illegal }), 'filler-moves-not-board'));
  ok('filler: recorded squares the board does not give are caught', has(fl({}, undefined, { mine: 40, theirs: 23 }), 'filler-moves-not-board'));
  ok('filler: a recorded win the board does not give is PROVEN', s.winner !== 0 && has(fl({}, ['filler', 'pro', !won]), 'filler-win-not-board') && proven('filler-win-not-board'));
  ok('filler: a partial log is not judged', none(fl({ mv: greedy, part: 1 })));
  const mine = mv.filter((q) => q[0] === FL.P1).length;
  ok('filler: picks from as many presses pass', none(fl({}), touches(mine)));
  ok('filler: more picks than presses is PROVEN', has(fl({}), 'filler-picks-without-taps', touches(mine - 1)) && proven('filler-picks-without-taps'));
  ok('filler: picks exactly 180 ms apart are suspicious', has(fl({ mv: mv.map((q, k) => [q[0], q[1], q[2], k * 180]) }), 'filler-machine-pace'));
}

// --- Connect Four ------------------------------------------------------------------------------------------------------
{
  let g, mt;
  for (let k = 0; k < 50; k++) {   // a game the player (0) wins
    g = new Game(0); mt = []; let t = 0;
    while (!g.isOver()) { const c = pick(g.legalMoves()); t += gap(); mt.push([c, g.currentPlayer === 0 ? 'h' : 'c', t]); g.play(c); }
    if (g.status === 'win' && g.winner === 0) break;
  }
  const board = []; for (let r = 0; r < 6; r++) { let line = ''; for (let c = 0; c < 7; c++) line += r < g.board.heights[c] ? (g.board.cellAt(c, r) === 0 ? 'h' : 'c') : '.'; board.push(line); }
  const c4 = (x, a = ['hard', 'player', true]) => ({ f: 'recordConnect4', g: 'connect4', a: J(a), x: J({ end: 'win', mv: g.history.slice(), first: 'me', board, t0: T0, mt, ...x }) });
  ok('connect four: a game the player won passes', none(c4({})));
  ok('connect four: the same game recorded as a loss is PROVEN', has(c4({}, ['hard', 'player', false]), 'connect4-win-not-board') && proven('connect4-win-not-board'));
  ok('connect four: the right result with the wrong opener is caught', has(c4({}, ['hard', 'computer', true]), 'connect4-win-not-board'));
  const tampered = clone(board); tampered[0] = tampered[0].replace(/c/, 'h');
  ok('connect four: a logged board the columns do not give is caught', has(c4({ board: tampered }), 'connect4-win-not-board'));
  const full = g.history.slice(); full.push(...Array(7).fill(full[0]));
  ok('connect four: a disc in a full column is caught', has(c4({ mv: full }), 'connect4-win-not-board'));
  ok('connect four: a quit is not judged on its result', none(c4({ end: 'quit' }, ['hard', 'player', false])));
  const mine = mt.filter((q) => q[1] === 'h').length;
  ok('connect four: discs from as many presses pass', none(c4({}), touches(mine)));
  ok('connect four: more discs than presses is PROVEN', has(c4({}), 'connect4-discs-without-taps', touches(mine - 1)) && proven('connect4-discs-without-taps'));
  ok('connect four: logs without the 2026-11-25 disc times are not judged for taps', none(c4({ mt: undefined }), touches(0)));
  const fast = []; for (let k = 0; k < 30; k++) fast.push([k % 7, k % 2 ? 'h' : 'c', k * 150]);
  ok('connect four: discs dropped 150 ms apart are suspicious', has(c4({ mt: fast }), 'connect4-machine-pace'));
}

// --- Connect 4 Hoops ---------------------------------------------------------------------------------------------------
{
  let m, rows;
  for (let k = 0; k < 50; k++) {
    m = new Match({ vsCpu: true, first: 0, oneShot: true }); rows = []; let t = 0;
    while (!m.over && rows.length < 250) {
      const by = m.turn, miss = rnd() < 0.3, col = Math.floor(rnd() * 7);
      const res = miss ? m.miss() : m.land(col);
      t += 2 + Math.round(rnd() * 30) / 10;
      rows.push([by, Math.round(rnd() * 1e4) / 1e4, Math.round((rnd() - 0.5) * 1e4) / 1e4, 1, miss ? -1 : col, res.type, Math.round(t * 10) / 10]);
    }
    if (m.over && m.winner === 0) break;
  }
  const h4 = (x, a = ['hoops4', 'medium', true]) => ({ f: 'recordResult', g: 'hoops4', a: J(a), x: J({ v: 1, end: 'end', kind: 'cpu', one: 1, first: 0, me: 0, winner: m.winner, over: true, shots: m.shots.slice(), moves: m.moves.map((q) => [q.by, q.col, q.shots]), shotLog: rows, t0: T0, ...x }) });
  ok(`hoops: a match played by the rules passes (${rows.length} shots)`, none(h4({})));
  const out = clone(rows); out[0][0] = 1;
  ok('hoops: a shot out of turn is PROVEN (shots-not-board)', has(h4({ shotLog: out }), 'hoops4-shots-not-board') && proven('hoops4-shots-not-board'));
  ok('hoops: logged shot counts the shots do not give are caught', has(h4({ shots: [m.shots[0] + 1, m.shots[1] - 1] }), 'hoops4-shots-not-board'));
  ok('hoops: a log missing shots (an older save) is not judged', none(h4({ shotLog: out.slice(2) })));
  ok('hoops: a recorded loss on a won board is PROVEN', has(h4({}, ['hoops4', 'medium', false]), 'hoops4-win-not-board') && proven('hoops4-win-not-board'));
  const mine = rows.filter((q) => q[0] === 0).length;
  ok('hoops: shots from as many swipes pass (and one more, the resumed ball)', none(h4({}), touches(mine - 1)));
  ok('hoops: two more shots than swipes is PROVEN', has(h4({}), 'hoops4-shots-without-swipes', touches(mine - 2)) && proven('hoops4-shots-without-swipes'));
  const same = rows.map((q) => (q[0] === 0 ? [q[0], 0.6, -0.1, ...q.slice(3)] : q));
  ok('hoops: the very same flick 4+ times is suspicious', mine >= 4 && has(h4({ shotLog: same }), 'hoops4-same-flick') && proven('hoops4-same-flick') === false);
}

// --- Tic Tac Toe -------------------------------------------------------------------------------------------------------
{
  const game = (variant) => {
    for (let k = 0; k < 200; k++) {
      const s = TT.newGame(variant, 'X'); const mv = []; let t = 0;
      while (!s.over) { const m = pick(TT.legalMoves(s)); t += gap(); mv.push([s.turn, variant === 'ultimate' ? m.board * 9 + m.cell : m, t]); TT.applyMove(s, m); }
      if (s.winner === 'X') return { s, mv };
    }
    return null;
  };
  for (const v of ['classic', 'ultimate']) {
    const { s, mv } = game(v);
    const tt = (x, a = [v, 'pro', true]) => ({ f: 'recordTicTacToe', g: 'tictactoe', a: J(a), x: J({ end: 'over', v, mv, n: mv.length, part: 0, me: 'X', win: s.winner, draw: 0, t0: T0, ...x }) });
    ok(`tic tac toe ${v}: a game X won passes`, none(tt({})));
    ok(`tic tac toe ${v}: the same game recorded as a loss is PROVEN`, has(tt({}, [v, 'pro', false]), 'tictactoe-win-not-board') && proven('tictactoe-win-not-board'));
    const twice = clone(mv); twice[2][1] = twice[0][1];
    ok(`tic tac toe ${v}: a mark on a taken square is caught`, has(tt({ mv: twice }), 'tictactoe-win-not-board'));
    const mine = mv.filter((q) => q[0] === 'X').length;
    ok(`tic tac toe ${v}: marks from as many presses pass`, none(tt({}), touches(mine)));
    ok(`tic tac toe ${v}: more marks than presses is PROVEN`, has(tt({}), 'tictactoe-marks-without-taps', touches(mine - 1)) && proven('tictactoe-marks-without-taps'));
    if (v === 'ultimate') {
      const wrongBoard = clone(mv); wrongBoard[1][1] = ((Math.floor(wrongBoard[1][1] / 9) + 1) % 9) * 9 + (wrongBoard[1][1] % 9);
      ok('tic tac toe ultimate: a mark on a board the last move did not send you to is caught', has(tt({ mv: wrongBoard }), 'tictactoe-win-not-board'));
      const robot = []; for (let k = 0; k < 40; k++) robot.push([k % 2 ? 'O' : 'X', k, k * 120]);
      ok('tic tac toe: marks 120 ms apart are suspicious', has(tt({ mv: robot, n: 40 }), 'tictactoe-machine-pace'));
    }
  }
}

// --- Mancala -----------------------------------------------------------------------------------------------------------
{
  let s, mv;
  for (let k = 0; k < 100; k++) {
    s = MC.newGame(MC.P1); mv = []; let t = 0;
    while (!s.over) { const p = pick(MC.legalMoves(s)), r = MC.applyMove(s, p); t += gap(); mv.push([s.turn, p, r.events.path.length, r.events.extraTurn ? 1 : 0, r.events.capture ? 1 : 0, t]); s = r.state; }
    if (s.winner === MC.P1) break;
  }
  const mc = (x, a = ['mancala', 'pro', true], d = { mine: s.pits[6], theirs: s.pits[13] }) => ({ f: 'recordResult', g: 'mancala', a: J(a), d: J(d), x: J({ end: 'over', mode: 'bot', mv, n: mv.length, part: 0, pits: s.pits, win: s.winner, me: MC.P1, t0: T0, ...x }) });
  ok('mancala: a game played by the engine passes', none(mc({})));
  const lie = clone(mv); lie[3][4] = lie[3][4] ? 0 : 1;
  ok('mancala: a sowing logged with a capture the board does not give is PROVEN', has(mc({ mv: lie }), 'mancala-moves-not-board') && proven('mancala-moves-not-board'));
  ok('mancala: recorded stores the board does not give are caught', has(mc({}, undefined, { mine: s.pits[6] + 5, theirs: s.pits[13] }), 'mancala-moves-not-board'));
  ok('mancala: a recorded loss on a won board is PROVEN', has(mc({}, ['mancala', 'pro', false]), 'mancala-win-not-board') && proven('mancala-win-not-board'));
  ok('mancala: a partial (resumed) log is not judged', none(mc({ mv: lie, part: 1 })));
  const mine = mv.filter((q) => q[0] === MC.P1).length;
  ok('mancala: sowings from as many presses pass', none(mc({}), touches(mine)));
  ok('mancala: more sowings than presses is PROVEN', has(mc({}), 'mancala-sowings-without-taps', touches(mine - 1)) && proven('mancala-sowings-without-taps'));
  ok('mancala: sowings 100 ms apart are suspicious', has(mc({ mv: mv.map((q, k) => [...q.slice(0, 5), k * 100]) }), 'mancala-machine-pace'));
}

// --- Battleship --------------------------------------------------------------------------------------------------------
{
  const set = shipSetFor('quick');
  const f0 = autoPlace('quick', set, mulberry32(3)), f1 = autoPlace('quick', set, mulberry32(4));
  let s = setFleet(setFleet(bsNew(8, 'quick', false, 0), 0, f0), 1, f1);
  const mv = []; let t = 0;
  while (!s.over) {
    const target = 1 - s.turn; let r, c;
    do { r = Math.floor(rnd() * 8); c = Math.floor(rnd() * 8); } while (!isShotLegal(s, target, r, c));
    const res = fireAndResolve(s, target, r, c); s = res.state; t += gap();
    mv.push([target, r, c, res.answer.result === 'hit' ? 'h' : 'm', res.answer.sunk ? 1 : 0, t]);
  }
  const fl = (f) => f.ships.map((q) => [q.id, q.r, q.c, q.dir, q.cells.length]);
  const grids = s.shots.map((g) => Array.from(g.cells).join(''));
  const won = s.winner === 0;
  const hitsOn1 = Array.from(grids[1]).filter((v) => v === '2' || v === '3').length;
  const bs = (x, a = ['pro', won, { shots: s.shotCount[0], hits: hitsOn1 }]) => ({ f: 'recordBattleship', g: 'battleship', a: J(a), x: J({ end: 'over', size: 'quick', me: 0, mv, n: s.shotCount, win: s.winner, grids, fleets: [fl(f0), fl(f1)], res: 0, diff: 'pro', t0: T0, ...x }) });
  ok(`battleship: a battle played by the engine passes (${mv.length} shots, winner ${s.winner})`, none(bs({})));
  const lie = clone(mv); const k = lie.findIndex((q) => q[3] === 'm'); lie[k][3] = 'h';
  ok('battleship: a hit logged on open water is PROVEN', has(bs({ mv: lie }), 'battleship-shots-not-fleet') && proven('battleship-shots-not-fleet'));
  const g2 = clone(grids); const i = g2[1].indexOf('1'); g2[1] = g2[1].slice(0, i) + '2' + g2[1].slice(i + 1);
  ok('battleship: a hit on the final grid where no ship is, is caught', has(bs({ grids: g2 }), 'battleship-shots-not-fleet'));
  const twice = clone(mv); twice.push([...twice[0].slice(0, 5), t + 1000]);
  ok('battleship: the same square shot twice is caught (vs the computer)', has(bs({ mv: twice }), 'battleship-shots-not-fleet'));
  ok('battleship: ... but not in a live room (a recovery may replay a shot)', !has(bs({ mv: twice, diff: undefined }), 'battleship-shots-not-fleet'));
  const g3 = clone(grids); g3[1] = g3[1].replace(/[23]/, '0');
  ok('battleship: a win with a ship square still afloat is PROVEN', has(bs({ grids: g3, fleets: [null, null] }, ['pro', true, { shots: 30 }]), 'battleship-win-not-sunk') && proven('battleship-win-not-sunk'));
  ok('battleship: recorded hits the grid does not show are caught', has(bs({}, ['pro', won, { shots: 30, hits: hitsOn1 + 3 }]), 'battleship-win-not-sunk'));
  const mine = mv.filter((q) => q[0] === 1).length;
  ok('battleship: shots from as many presses pass', none(bs({}), touches(mine)));
  ok('battleship: more shots than presses is PROVEN', has(bs({}), 'battleship-shots-without-taps', touches(mine - 1)) && proven('battleship-shots-without-taps'));
  ok('battleship: shots 200 ms apart are suspicious', has(bs({ mv: mv.map((q, j) => [...q.slice(0, 5), j * 200]) }), 'battleship-machine-pace'));
}

// --- Battle Arena ------------------------------------------------------------------------------------------------------
{
  const team = ['cinderwing', 'thornpaw'], foe = ['stormhorn', 'sproutle'];
  let s, mv, seed;
  for (let k = 0; k < 40; k++) {
    seed = 1000 + k; s = BA.newMatch({ seed, teams: [team, foe], first: 0, rv: 5 }); mv = []; let t = 0;
    while (s.winner == null && mv.length < 280) {
      const lm = BA.legalMoves(s); const m = lm.length ? pick(lm) : { a: 0, b: 1 };
      const side = s.turn; const r = BA.apply(s, { type: 'swap', a: m.a, b: m.b, side }); if (!r.ok) break;
      s = r.state; t += gap(); mv.push([side, 's', m.a, m.b, s.moveNo, t]);
    }
    if (s.winner === 0) break;
  }
  const ba = (x, a = ['battlearena', 'hard', true], d = { hp: Math.max(0, s.sides[0].hp), foeHp: Math.max(0, s.sides[1].hp) }) => ({ f: 'recordResult', g: 'battlearena', a: J(a), d: J(d), x: J({ end: 'over', seed, team, foe, first: 0, rv: 5, arena: 'boiler', mv, n: s.moveNo, win: s.winner, sides: s.sides.map((q) => ({ hp: q.hp })), via: null, res: 0, t0: T0, rzAt: 0, ...x }) });
  ok(`battle arena: a match played by the engine passes (${mv.length} moves, winner ${s.winner})`, s.winner === 0 && none(ba({})));
  ok('battle arena: the same moves on another seed are PROVEN (moves-not-match)', has(ba({ seed: seed + 1 }), 'battlearena-moves-not-match') && proven('battlearena-moves-not-match'));
  const far = clone(mv); far[0][3] = far[0][2] + 3;
  ok('battle arena: a swap of cells not side by side is caught', has(ba({ mv: far }), 'battlearena-moves-not-match'));
  ok('battle arena: recorded HP the match does not give is caught', has(ba({}, undefined, { hp: 80, foeHp: 0 }), 'battlearena-moves-not-match'));
  ok('battle arena: a recorded loss on a won match is PROVEN', has(ba({}, ['battlearena', 'hard', false]), 'battlearena-win-not-match') && proven('battlearena-win-not-match'));
  ok('battle arena: an online match (via set) is not replayed here', none(ba({ seed: seed + 1, via: 'mp' })));
  const mine = mv.filter((q) => q[0] === 0).length;
  ok('battle arena: swaps from as many presses pass', none(ba({}), touches(mine)));
  ok('battle arena: more swaps than presses is PROVEN', has(ba({}), 'battlearena-moves-without-touches', touches(mine - 1)) && proven('battlearena-moves-without-touches'));
  ok('battle arena: swaps made before the last resume are not counted', none(ba({ rzAt: mv.length }), touches(0)));
  ok('battle arena: swaps 300 ms apart are suspicious', has(ba({ mv: mv.map((q, j) => [...q.slice(0, 5), j * 300]) }), 'battlearena-machine-pace'));
}

process.exit(fail ? 1 : 0);
