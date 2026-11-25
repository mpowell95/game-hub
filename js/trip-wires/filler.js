// js/trip-wires/filler.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network; imports only the game's pure engine (filler/js/game.js). The older rule (more squares than the board has) lives
// in js/integrity.js checkPlayInput and is not repeated here.
// Data: the private log `x` (filler/js/ui.js _playLog): start = the 63 starting colours, mv = [mover, colour, squares won,
// ms] per pick, n (picks the game counted), part (the log missed some), counts = [player 1, player 2] at the end, win, me,
// t0 (epoch ms the log began, 2026-11-25). Detail `d` = { mine, theirs, ... }; `a` = ['filler', level, won].
import { TILES, COLOR_COUNT, P1, P2, P1_START, P2_START, legalColors, applyMove } from '../../filler/js/game.js';

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

/** Replays the logged picks from the logged starting board with game.js's own applyMove (the board newGame() builds:
 *  player 1 bottom-left, player 2 top-right, whoever made the first logged pick on turn). { s, bad } or null. */
function replay(x) {
  if (!x || typeof x.start !== 'string' || x.start.length !== TILES || !/^[0-5]+$/.test(x.start)) return null;
  if (!Array.isArray(x.mv) || !x.mv.length || x.part || x.cut || x.mv.length >= 200) return null;
  const colors = Array.from(x.start, Number);
  const owner = new Uint8Array(TILES);
  owner[P1_START] = P1; owner[P2_START] = P2;
  const first = x.mv[0][0] === P2 ? P2 : P1;
  const s = { colors, owner, turn: first, counts: [0, 1, 1], current: [0, colors[P1_START], colors[P2_START]], over: false, winner: 0, moves: 0, dryMoves: 0 };
  for (const q of x.mv) {
    if (!Array.isArray(q)) return null;
    const mover = Number(q[0]), color = Number(q[1]), won = Number(q[2]);
    if (s.over) return { s, bad: 'a pick after the game was over' };
    if (mover !== s.turn) return { s, bad: `player ${mover} picked on player ${s.turn}'s turn` };
    if (!(color >= 0 && color < COLOR_COUNT) || !legalColors(s).includes(color)) return { s, bad: `colour ${color} was not on offer` };
    const got = applyMove(s, color).length;
    if (got !== won) return { s, bad: `a pick logged ${won} squares, the board gives ${got}` };
  }
  return { s, bad: null };
}

export default [
  {
    // filler/js/game.js applyMove floods the mover's block with the picked colour, takes every touching neutral square of
    // it, and passes the turn; only legalColors() (not either player's current colour) may be picked (ui.js onClick checks
    // it too). Replayed from the logged starting board, every pick must be legal for the player on turn, win exactly the
    // squares logged, and end on the logged counts and the recorded ones.
    id: 'filler-moves-not-board',
    text: 'picks or a square count the board cannot give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, r = replay(x);
      if (!r) return null;
      if (r.bad) return { v: r.bad, lim: 'the rules of the board' };
      const c = r.s.counts, me = x.me === P2 ? P2 : P1;
      if (Array.isArray(x.counts) && (Number(x.counts[0]) !== c[P1] || Number(x.counts[1]) !== c[P2])) return { v: `log ${x.counts.join('-')}, board ${c[P1]}-${c[P2]}`, lim: `${c[P1]}-${c[P2]}` };
      const d = ctx.d;
      if (d && d.mine != null && (Number(d.mine) !== c[me] || Number(d.theirs) !== c[me === P1 ? P2 : P1])) return { v: `recorded ${d.mine}-${d.theirs}, board ${c[me]}-${c[me === P1 ? P2 : P1]}`, lim: `${c[me]}-${c[me === P1 ? P2 : P1]}` };
      return null;
    },
  },
  {
    // ui.js finish(): won = the engine's winner is this player's seat (game.js: most squares at a full board or after 24
    // dry picks). A recorded win or loss the replayed board does not give is impossible.
    id: 'filler-win-not-board',
    text: 'a recorded win the board does not give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a;
      if (!Array.isArray(a) || typeof a[2] !== 'boolean' || !x || x.end !== 'over') return null;
      const r = replay(x);
      if (!r || r.bad || !r.s.over || !r.s.winner) return null;
      const me = x.me === P2 ? P2 : P1, won = r.s.winner === me;
      return a[2] !== won ? { v: `recorded ${a[2]}, board ${r.s.counts[me]}-${r.s.counts[me === P1 ? P2 : P1]}`, lim: String(won) } : null;
    },
  },
  {
    // A pick is a tap on a colour button (ui.js onClick -> the move); nothing else picks for the player. More of this
    // player's picks after the touch log's first event than real presses in it means something else made them.
    id: 'filler-picks-without-taps',
    text: 'more colours picked than taps',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (!x || !Array.isArray(x.mv) || p == null || !(Number(x.t0) > 0)) return null;
      const me = x.me === P2 ? P2 : P1;
      const mine = x.mv.filter((q) => Array.isArray(q) && q[0] === me && Number(x.t0) + Number(q[3]) >= ctx.n.t0).length;
      return mine > p ? { v: `${mine} picks, ${p} presses`, lim: p } : null;
    },
  },
  {
    // Real plays: the gap before each pick has a middle-80% spread of at least 1 s and a median of at least 715 ms. An
    // even rhythm (spread under 100 ms) or a median under 200 ms is a script's. Suspicious only.
    id: 'filler-machine-pace',
    text: 'colours picked at a machine-like, even pace',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !Array.isArray(x.mv)) return null;
      const me = x.me === P2 ? P2 : P1;
      const pc = pace(x.mv.filter(Array.isArray).map((q) => [q[0] === me, Number(q[3]) || 0]));
      if (pc.n < 12) return null;
      if (pc.spread < 100 || pc.med < 200) return { v: `${pc.n} picks, ${pc.med} ms apart (middle), spread ${pc.spread} ms`, lim: 'spread 100 ms, median 200 ms' };
      return null;
    },
  },
];
