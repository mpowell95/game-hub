// js/trip-wires/connect4.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network; imports only the game's pure engine (connect-four/js/game.js, which imports board.js).
// Data: the private log `x` (connect-four/js/ui.js _playLog): mv = every column played in order, first ('me' | 'them'), end
// ('win' | 'loss' | 'draw' | 'quit'), board (row 0 = bottom, h = the player, c = the computer), undo, and from 2026-11-25
// mt = [column, 'h' | 'c', ms since the game began] per disc as it landed, and t0 (epoch ms the game began). The recorder's
// arguments `a` = [difficulty, firstMove ('player' | 'computer'), won (true | false | null = draw)].
import Game from '../../connect-four/js/game.js';

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

const HUMAN = 0, CPU = 1;   // ui.js: humanPlayer = PLAYER_ONE (0) always

export default [
  {
    // connect-four/js/game.js Game.play refuses a full column and ends the game on four in a row or a full board; the
    // recorder's `won` is that game's winner (ui.js endGame). Replaying the logged columns from the logged opener must be
    // legal, give the logged board, and give the recorded result and opener.
    id: 'connect4-win-not-board',
    text: 'a recorded win, or moves, the board cannot give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a;
      if (!x || !Array.isArray(x.mv) || !x.mv.length || x.mv.length > 42 || (x.first !== 'me' && x.first !== 'them')) return null;
      const g = new Game(x.first === 'me' ? HUMAN : CPU);
      for (const col of x.mv) {
        if (!Number.isInteger(col) || g.isOver() || !g.board.canPlay(col)) return { v: `column ${col} after ${g.history.length} discs`, lim: 'a legal column' };
        g.play(col);
      }
      if (Array.isArray(x.board) && x.board.length === 6) {
        for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
          const want = r < g.board.heights[c] ? (g.board.cellAt(c, r) === HUMAN ? 'h' : 'c') : '.';
          if (String(x.board[r])[c] !== want) return { v: `board row ${r} ${x.board[r]}`, lim: 'the replayed board' };
        }
      }
      if (!Array.isArray(a) || x.end === 'quit') return null;
      const won = g.status === 'win' ? g.winner === HUMAN : g.status === 'draw' ? null : undefined;
      if (won === undefined) return { v: `recorded ${a[2]} on an unfinished board`, lim: 'a finished board' };
      if (a[2] !== won) return { v: `recorded ${a[2]}, board ${g.status}${g.status === 'win' ? ' ' + (g.winner === HUMAN ? 'player' : 'computer') : ''}`, lim: String(won) };
      if ((a[1] === 'player') !== (x.first === 'me')) return { v: `recorded first ${a[1]}, log ${x.first}`, lim: x.first };
      return null;
    },
  },
  {
    // A disc is dropped for the player only by a tap on the board or a 1-7 key (ui.js _onBoardClick / onKeyDown ->
    // humanMove). More of the player's discs after the touch log's first event than real presses in it means something
    // else dropped them. Needs mt (2026-11-25).
    id: 'connect4-discs-without-taps',
    text: 'more discs dropped than taps',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (!x || !Array.isArray(x.mt) || p == null || !(Number(x.t0) > 0)) return null;
      const mine = x.mt.filter((q) => Array.isArray(q) && q[1] === 'h' && Number(x.t0) + Number(q[2]) >= ctx.n.t0).length;
      return mine > p ? { v: `${mine} discs, ${p} presses`, lim: p } : null;
    },
  },
  {
    // The board is locked while the computer's disc falls (ui.js applyMove awaits dropPiece, DROP_MS 360), so a person's
    // reply comes well after it, at an uneven pace. A median reply under 300 ms or an even rhythm (spread under 100 ms)
    // over 10+ discs is a script's. Suspicious only (a reduced-motion phone shortens the fall).
    id: 'connect4-machine-pace',
    text: 'discs dropped at a machine-like, even pace',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !Array.isArray(x.mt)) return null;
      const pc = pace(x.mt.filter(Array.isArray).map((q) => [q[1] === 'h', Number(q[2]) || 0]));
      if (pc.n < 10) return null;
      if (pc.spread < 100 || pc.med < 300) return { v: `${pc.n} discs, ${pc.med} ms apart (middle), spread ${pc.spread} ms`, lim: 'spread 100 ms, median 300 ms' };
      return null;
    },
  },
];
