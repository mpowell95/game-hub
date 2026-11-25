// js/trip-wires/dotsboxes.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network; imports only the game's pure engine (dots-boxes/js/game.js). The older rule (more boxes than the board has)
// lives in js/integrity.js checkPlayInput and is not repeated here.
// Data: the private log `x` (dots-boxes/js/ui.js _playLog): ev = ['m', seat, 'h'|'v', r, c, ms] edges, ['u', n, ms] an Undo
// of n edges, ['r', n, ms] a Redo; rows, cols, me (the player's seat), p0/p1 (boxes at the end), res (resumed), t0 (epoch
// ms the log began, 2026-11-25), end. Detail `d` = { mine, theirs, chain }; the recorder's arguments `a` = [difficulty, won, extras].
import { newGame, applyMove, score } from '../../dots-boxes/js/game.js';

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

const SIZES = new Set(['3x3', '4x4', '10x10', '5x5', '2x2']);
/** Replays the log from an empty board exactly as ui.js does (humanMove / undo / redo): edges in order, an Undo takes the
 *  last n edges off (onto the redo stack), a Redo puts the newest undone run back, any new edge clears the redo stack.
 *  Returns { s, bad } (bad = the first impossible step) or null when the log cannot be replayed from the start. */
function replay(x) {
  // x0 (2026-11-25) = edges already drawn when the log began: a game resumed on a new page logs from the resume (and
  // `res` alone did not say so: 5 real plays began at the player's first edge after the computer's opening).
  if (!x || !Array.isArray(x.ev) || !x.ev.length || x.res || Number(x.x0) > 0 || x.cut || x.ev.length >= 400) return null;
  const rows = Number(x.rows), cols = Number(x.cols);
  if (!SIZES.has(`${rows}x${cols}`)) return null;
  const moves = [], redo = [];
  const build = (list) => {
    const s = newGame(rows, cols);
    for (const m of list) { if (m[0] !== s.turn) return { s, bad: `seat ${m[0]} moved on seat ${s.turn}'s turn` }; const before = s.drawnEdges; applyMove(s, { type: m[1], r: m[2], c: m[3] }); if (s.drawnEdges === before) return { s, bad: `edge ${m[1]}${m[2]},${m[3]} drawn twice` }; }
    return { s, bad: null };
  };
  for (const q of x.ev) {
    if (!Array.isArray(q)) continue;
    if (q[0] === 'm') {
      const m = [q[1] === 1 ? 1 : 0, q[2] === 'v' ? 'v' : 'h', Number(q[3]), Number(q[4])];
      const lim = m[1] === 'h' ? [rows, cols - 1] : [rows - 1, cols];
      if (!(m[2] >= 0 && m[2] <= lim[0] && m[3] >= 0 && m[3] <= lim[1])) return { s: null, bad: `edge ${m[1]}${m[2]},${m[3]} off the board` };
      if (redo.length) redo.length = 0;
      moves.push(m);
    } else if (q[0] === 'u') {
      const k = Number(q[1]) | 0;
      if (k < 1 || k > moves.length) return null;
      redo.push(moves.splice(moves.length - k, k));
    } else if (q[0] === 'r') {
      const seg = redo.pop();
      if (!seg) return null;
      moves.push(...seg);
    }
  }
  // Without x0 (logs before 2026-11-25) only a log holding EVERY edge of the board is known to start at the first one.
  if (x.x0 == null && moves.length !== (rows + 1) * cols + rows * (cols + 1)) return null;
  return build(moves);
}

const own = (x) => (x.me === 1 ? 1 : 0);

export default [
  {
    // dots-boxes/js/game.js applyMove only lets the seat on turn draw an undrawn edge, and gives the turn back only when a
    // box closes; the log is written from that same state (ui.js _logMove). Replayed from an empty board, every logged edge
    // must be legal for the seat that drew it, and the boxes at the end must be the ones logged (p0/p1) and recorded (d).
    id: 'dotsboxes-moves-not-board',
    text: 'edges or a box count the rules of the board cannot give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, r = replay(x);
      if (!r) return null;
      if (r.bad) return { v: r.bad, lim: 'legal edges' };
      if (r.s.drawnEdges !== r.s.totalEdges) return null;   // not finished (a quit): the count is not judged
      const sc = score(r.s), me = own(x);
      if (x.p0 != null && (Number(x.p0) !== sc.p0 || Number(x.p1) !== sc.p1)) return { v: `log ${x.p0}-${x.p1}, board ${sc.p0}-${sc.p1}`, lim: `${sc.p0}-${sc.p1}` };
      const d = ctx.d;
      const mine = me === 0 ? sc.p0 : sc.p1, theirs = me === 0 ? sc.p1 : sc.p0;
      if (d && d.mine != null && (Number(d.mine) !== mine || Number(d.theirs) !== theirs)) return { v: `recorded ${d.mine}-${d.theirs}, board ${mine}-${theirs}`, lim: `${mine}-${theirs}` };
      return null;
    },
  },
  {
    // ui.js _commitStats: won = mine > theirs, null on a tie, from the finished board. A recorded win (or loss or tie) the
    // replayed board does not give is impossible.
    id: 'dotsboxes-win-not-board',
    text: 'a recorded win the boxes on the board do not give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a;
      if (!Array.isArray(a) || x == null || x.end !== 'over') return null;
      const r = replay(x);
      if (!r || r.bad || r.s.drawnEdges !== r.s.totalEdges) return null;
      const sc = score(r.s), me = own(x);
      const mine = me === 0 ? sc.p0 : sc.p1, theirs = me === 0 ? sc.p1 : sc.p0;
      const won = mine > theirs ? true : mine < theirs ? false : null;
      return a[1] !== won ? { v: `recorded ${a[1]}, board ${mine}-${theirs}`, lim: String(won) } : null;
    },
  },
  {
    // An edge is drawn only by a tap on that edge's button (ui.js onClick -> humanMove; a Redo is logged 'r', not 'm').
    // More of this player's edges after the touch log's first event than real presses in it means something else drew them.
    id: 'dotsboxes-edges-without-taps',
    text: 'more lines drawn than taps',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (!x || !Array.isArray(x.ev) || p == null || !(Number(x.t0) > 0)) return null;
      const me = own(x);
      const mine = x.ev.filter((q) => Array.isArray(q) && q[0] === 'm' && q[1] === me && Number(x.t0) + Number(q[5]) >= ctx.n.t0).length;
      return mine > p ? { v: `${mine} lines, ${p} presses`, lim: p } : null;
    },
  },
  {
    // Real plays (10+ lines): the gap before each of the player's lines has a middle-80% spread of at least 376 ms and a median of at
    // least 442 ms. An even, machine-like rhythm (spread under 100 ms) or a median under 150 ms is a script's. Suspicious.
    id: 'dotsboxes-machine-pace',
    text: 'lines drawn at a machine-like, even pace',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !Array.isArray(x.ev)) return null;
      const me = own(x);
      const pc = pace(x.ev.filter((q) => Array.isArray(q) && q[0] === 'm').map((q) => [q[1] === me, Number(q[5]) || 0]));
      if (pc.n < 10) return null;
      if (pc.spread < 100 || pc.med < 150) return { v: `${pc.n} lines, ${pc.med} ms apart (middle), spread ${pc.spread} ms`, lim: 'spread 100 ms, median 150 ms' };
      return null;
    },
  },
];
