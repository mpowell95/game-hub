// js/trip-wires/mancala.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network; imports only the game's pure engine (mancala/js/game.js).
// Data: the private log `x` (mancala/js/ui.js _playLog): mode ('bot' | 'friend'), mv = [seat, pit, stones sown, extra turn,
// capture, ms] per sowing, n (sowings the game counted), part (the log missed some), pits (14 numbers at the end), win, me,
// opener, end, and from 2026-11-25 t0 (epoch ms the log began) and cut. Detail `d` = { mine, theirs, speed };
// `a` = ['mancala', level, won].
import { P1, P2, newGame, applyMove, storeOf } from '../../mancala/js/game.js';

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

/** Replays the logged sowings with game.js's own applyMove from a fresh board, the first logged mover on turn. */
function replay(x) {
  if (!x || !Array.isArray(x.mv) || !x.mv.length || x.part || x.cut || x.mv.length >= 200) return null;
  if (Number(x.n) !== x.mv.length) return null;
  let s = newGame(x.mv[0][0] === P2 ? P2 : P1);
  for (const q of x.mv) {
    if (!Array.isArray(q)) return null;
    const seat = Number(q[0]), pit = Number(q[1]);
    if (s.over) return { s, bad: 'a sowing after the game was over' };
    if (seat !== s.turn) return { s, bad: `seat ${seat} sowed on seat ${s.turn}'s turn` };
    const res = applyMove(s, pit);
    if (!res) return { s, bad: `pit ${pit} could not be sown` };
    const ev = res.events;
    if (Number(q[2]) !== ev.path.length || Number(q[3]) !== (ev.extraTurn ? 1 : 0) || Number(q[4]) !== (ev.capture ? 1 : 0)) {
      return { s, bad: `pit ${pit} logged ${q[2]} stones/${q[3]} extra/${q[4]} capture, the board gives ${ev.path.length}/${ev.extraTurn ? 1 : 0}/${ev.capture ? 1 : 0}` };
    }
    s = res.state;
  }
  return { s, bad: null };
}

export default [
  {
    // mancala/js/game.js applyMove: the seat on turn sows one of its own non-empty pits counterclockwise (skipping the
    // other store), a last stone in its own store goes again, a last stone in its own empty pit captures, and an empty
    // side ends the game with a sweep. Replayed from a fresh board, every sowing must be legal, sow and capture as logged,
    // and end on the logged pits and the recorded stores.
    id: 'mancala-moves-not-board',
    text: 'sowings or a store count the board cannot give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, r = replay(x);
      if (!r) return null;
      if (r.bad) return { v: r.bad, lim: 'the rules of the board' };
      if (Array.isArray(x.pits) && x.pits.length === 14 && x.pits.some((v, k) => Number(v) !== r.s.pits[k])) return { v: `logged pits ${x.pits.join(',')}`, lim: r.s.pits.join(',') };
      const me = x.me === P2 ? P2 : P1, d = ctx.d;
      if (d && d.mine != null && r.s.over && (Number(d.mine) !== r.s.pits[storeOf(me)] || Number(d.theirs) !== r.s.pits[storeOf(me === P1 ? P2 : P1)])) {
        return { v: `recorded ${d.mine}-${d.theirs}, board ${r.s.pits[storeOf(me)]}-${r.s.pits[storeOf(me === P1 ? P2 : P1)]}`, lim: 'the replayed stores' };
      }
      return null;
    },
  },
  {
    // ui.js finish(): won = the engine's winner is this player's seat (vs the computer, P1), null on a tie. A recorded win
    // the replayed board does not give is impossible.
    id: 'mancala-win-not-board',
    text: 'a recorded win the board does not give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a;
      if (!Array.isArray(a) || !x || x.end !== 'over' || x.mode === 'friend') return null;
      const r = replay(x);
      if (!r || r.bad || !r.s.over) return null;
      const me = x.me === P2 ? P2 : P1;
      const won = r.s.winner == null ? null : r.s.winner === me;
      return a[2] !== won ? { v: `recorded ${a[2]}, board ${r.s.pits[storeOf(me)]}-${r.s.pits[storeOf(me === P1 ? P2 : P1)]}`, lim: String(won) } : null;
    },
  },
  {
    // A sowing is made for the player only by a tap on one of their pits (ui.js onClick -> playMove). More of the
    // player's sowings after the touch log's first event than real presses in it means something else made them.
    id: 'mancala-sowings-without-taps',
    text: 'more pits sown than taps',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (!x || !Array.isArray(x.mv) || p == null || !(Number(x.t0) > 0) || x.mode === 'friend') return null;
      const me = x.me === P2 ? P2 : P1;
      const mine = x.mv.filter((q) => Array.isArray(q) && q[0] === me && Number(x.t0) + Number(q[5]) >= ctx.n.t0).length;
      return mine > p ? { v: `${mine} sowings, ${p} presses`, lim: p } : null;
    },
  },
  {
    // A person's gap before each sowing varies; the board is locked while the last one's stones fly (ui.js playMove,
    // busy). Over 12+ sowings, an even rhythm (spread under 100 ms) or a median under 200 ms is a script's. Suspicious.
    id: 'mancala-machine-pace',
    text: 'pits sown at a machine-like, even pace',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !Array.isArray(x.mv) || x.mode === 'friend') return null;
      const me = x.me === P2 ? P2 : P1;
      const pc = pace(x.mv.filter(Array.isArray).map((q) => [q[0] === me, Number(q[5]) || 0]));
      if (pc.n < 12) return null;
      if (pc.spread < 100 || pc.med < 200) return { v: `${pc.n} sowings, ${pc.med} ms apart (middle), spread ${pc.spread} ms`, lim: 'spread 100 ms, median 200 ms' };
      return null;
    },
  },
];
