// js/trip-wires/tictactoe.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network; imports only the game's pure engine (tic-tac-toe/js/game.js).
// Data: the private log `x` (tic-tac-toe/js/ui.js _playLog): v (classic | ultimate), mv = [mark, cell (ultimate: board * 9 +
// cell), ms since the first move] per move, n (moves the game counted), part (the log missed some), me (the player's mark),
// win, draw, board, end, and from 2026-11-25 t0 (epoch ms of the first move) and cut. `a` = [variant, difficulty, won].
import { newGame, legalMoves, applyMove } from '../../tic-tac-toe/js/game.js';

// --- shared shape of this group's board-game files (copied, not imported: one file per game) ----------------------------
/** Real presses (touch/mouse downs and keys) in the touch log; null when it might not hold them all
 *  (js/play-log-queue.js _tok drops a press only once no move token is left to drop, so any move left = none dropped). */
function presses(n) {
  if (!n || !Array.isArray(n.ev)) return null;
  if (n.cut && !n.moves) return null;
  return n.ev.filter((q) => !q.fake && (q.kind === 'd' || q.kind === 'k')).length;
}
/** The gaps before each own action (actions = [[own, ms]] in order): count, median, spread of the middle 80%. */
function pace(actions) {
  const g = [];
  for (let k = 1; k < actions.length; k++) if (actions[k][0]) g.push(actions[k][1] - actions[k - 1][1]);
  if (!g.length) return { n: 0, med: 0, spread: 0 };
  g.sort((p, q) => p - q);
  const at = (f) => g[Math.floor(f * (g.length - 1))];
  return { n: g.length, med: at(0.5), spread: at(0.9) - at(0.1) };
}

/** Replays the logged moves with game.js's own newGame / legalMoves / applyMove, from the mark that moved first. */
function replay(x) {
  if (!x || (x.v !== 'classic' && x.v !== 'ultimate') || !Array.isArray(x.mv) || !x.mv.length || x.part || x.cut || x.mv.length >= 90) return null;
  if (Number(x.n) > 0 && Number(x.n) !== x.mv.length) return null;
  const ult = x.v === 'ultimate';
  const first = x.mv[0][0] === 'O' ? 'O' : 'X';
  const s = newGame(x.v, first);
  for (const q of x.mv) {
    if (!Array.isArray(q)) return null;
    const k = Number(q[1]);
    const move = ult ? { board: Math.floor(k / 9), cell: k % 9 } : k;
    if (q[0] !== s.turn) return { s, bad: `${q[0]} moved on ${s.turn}'s turn` };
    const ok = legalMoves(s).some((m) => (ult ? m.board === move.board && m.cell === move.cell : m === move));
    if (!ok) return { s, bad: `${q[0]} at ${k} was not a legal square` };
    applyMove(s, move);
  }
  return { s, bad: null };
}

export default [
  {
    // tic-tac-toe/js/game.js: marks alternate, a mark goes only on an empty square (in Ultimate, only on the board the last
    // move sent you to, or anywhere open when that board is decided), and the game ends at three in a row (in Ultimate,
    // three boards) or a full board. ui.js _commitStats: won = the winner is this player's mark, a draw = null. A replay
    // that breaks a rule, or a recorded result it does not give, is impossible.
    id: 'tictactoe-win-not-board',
    text: 'a recorded win, or moves, the board cannot give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a, r = replay(x);
      if (!r) return null;
      if (r.bad) return { v: r.bad, lim: 'the rules of the board' };
      if (x.win != null && r.s.over && (r.s.winner || null) !== (x.win || null)) return { v: `logged winner ${x.win}, board ${r.s.winner || 'none'}`, lim: String(r.s.winner) };
      if (!Array.isArray(a) || x.end !== 'over' || !r.s.over || (x.me !== 'X' && x.me !== 'O')) return null;
      const won = r.s.winner ? r.s.winner === x.me : null;
      return a[2] !== won ? { v: `recorded ${a[2]}, board ${r.s.winner || 'draw'}`, lim: String(won) } : null;
    },
  },
  {
    // A mark is placed for the player only by a tap on a square (ui.js the board's click -> the move). More of the
    // player's marks after the touch log's first event than real presses in it means something else placed them.
    id: 'tictactoe-marks-without-taps',
    text: 'more marks placed than taps',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (!x || !Array.isArray(x.mv) || p == null || !(Number(x.t0) > 0) || (x.me !== 'X' && x.me !== 'O')) return null;
      const mine = x.mv.filter((q) => Array.isArray(q) && q[0] === x.me && Number(x.t0) + Number(q[2]) >= ctx.n.t0).length;
      return mine > p ? { v: `${mine} marks, ${p} presses`, lim: p } : null;
    },
  },
  {
    // A person's gap before each mark varies. Over 12+ marks (Ultimate), an even rhythm (spread under 100 ms) or a median
    // under 150 ms is a script's. Suspicious only.
    id: 'tictactoe-machine-pace',
    text: 'marks placed at a machine-like, even pace',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !Array.isArray(x.mv) || (x.me !== 'X' && x.me !== 'O')) return null;
      const pc = pace(x.mv.filter(Array.isArray).map((q) => [q[0] === x.me, Number(q[2]) || 0]));
      if (pc.n < 12) return null;
      if (pc.spread < 100 || pc.med < 150) return { v: `${pc.n} marks, ${pc.med} ms apart (middle), spread ${pc.spread} ms`, lim: 'spread 100 ms, median 150 ms' };
      return null;
    },
  },
];
