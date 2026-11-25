// js/trip-wires/battlearena.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM,
// no network; imports only the game's pure rules (battle-arena/js/engine.js, which imports monsters.js). The match is
// seeded and every move is logged, so a match vs the computer is REPLAYED whole: the strongest check this game has.
// Data: the private log `x` (battle-arena/js/ui.js _playLog): seed, team, foe, first, rv (rules version), arena, mv =
// [side, 's' swap | 'e' evolve | 'p' pass, cell a or monster, cell b, moves so far, ms] per move (both sides), n, win,
// sides (hp, turns, berries, monsters), via (null = vs the computer), res (the log missed the start), and from 2026-11-25
// t0 (epoch ms; moved by the time away after a resume), rzAt (moves already logged when the last resume began), seat, cut.
// Detail `d` = { moves, turns, hp, foeHp, evolved, end }; `a` = ['battlearena', level, won].
import { newMatch, apply } from '../../battle-arena/js/engine.js';

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

const ME = 0;   // ui.js: vs the computer the player is side 0
const teamOk = (t) => Array.isArray(t) && t.length >= 1 && t.length <= 3 && t.every((id) => typeof id === 'string');
/** Replays a match vs the computer from its seed and teams with the engine's own newMatch / apply (ui.js startMatch:
 *  newMatch({ seed, teams: [team, foe], first, rv })). { s, bad } or null when the log cannot be replayed whole. */
function replay(x) {
  if (!x || x.via != null || x.res || x.cut || !Number.isFinite(Number(x.seed)) || !teamOk(x.team) || !teamOk(x.foe)) return null;
  if (!Array.isArray(x.mv) || !x.mv.length || x.mv.length >= 300) return null;
  let s;
  try { s = newMatch({ seed: Number(x.seed) >>> 0, teams: [x.team, x.foe], first: x.first === 1 ? 1 : 0, arena: x.arena || 'boiler', rv: Number(x.rv) || 1 }); } catch { return null; }
  for (const q of x.mv) {
    if (!Array.isArray(q)) return null;
    const side = q[0] === 1 ? 1 : 0;
    const move = q[1] === 's' ? { type: 'swap', a: Number(q[2]), b: Number(q[3]), side } : q[1] === 'e' ? { type: 'evolve', mon: Number(q[2]), side } : q[1] === 'p' ? { type: 'pass', side } : null;
    if (!move) return null;
    const r = apply(s, move);
    if (!r.ok) return { s, bad: `move ${s.moveNo + 1} (${q[1]} by side ${side}) refused: ${r.error}` };
    s = r.state;
    if (q[1] !== 'p' && Number(q[4]) !== s.moveNo) return { s, bad: `logged move ${q[4]}, replayed ${s.moveNo}` };
  }
  return { s, bad: null };
}

export default [
  {
    // battle-arena/js/engine.js: the RNG lives in the match, so the same seed, teams and moves always give the same board,
    // damage and winner, and apply() refuses a move by the side not on turn, a swap of cells not side by side, or an
    // evolve without the berries. Replayed whole, every logged move must be accepted and the match must end on the logged
    // winner and HP and the recorded detail.
    id: 'battlearena-moves-not-match',
    text: 'moves, damage or a winner the seeded match cannot give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, r = replay(x);
      if (!r) return null;
      if (r.bad) return { v: r.bad, lim: 'the seeded match' };
      const s = r.s;
      if (x.end === 'over' && (s.winner ?? null) !== (x.win ?? null)) return { v: `logged winner ${x.win}, replayed ${s.winner}`, lim: String(s.winner) };
      if (Array.isArray(x.sides) && x.sides.length === 2 && x.sides.some((q, k) => q && Number(q.hp) !== (s.sides[k].hp | 0))) return { v: `logged HP ${x.sides.map((q) => q && q.hp).join('-')}, replayed ${s.sides.map((q) => q.hp | 0).join('-')}`, lim: 'the replayed HP' };
      const d = ctx.d;
      if (d && x.end === 'over' && d.hp != null && (Number(d.hp) !== Math.max(0, s.sides[ME].hp | 0) || Number(d.foeHp) !== Math.max(0, s.sides[1].hp | 0))) return { v: `recorded HP ${d.hp}-${d.foeHp}, replayed ${s.sides[ME].hp}-${s.sides[1].hp}`, lim: 'the replayed HP' };
      return null;
    },
  },
  {
    // ui.js finish: won = the engine's winner is side 0. A recorded win the replayed match does not give is impossible.
    id: 'battlearena-win-not-match',
    text: 'a recorded win the seeded match does not give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a;
      if (!Array.isArray(a) || typeof a[2] !== 'boolean' || !x || x.end !== 'over') return null;
      const r = replay(x);
      if (!r || r.bad || r.s.winner == null) return null;
      const won = r.s.winner === ME;
      return a[2] !== won ? { v: `recorded ${a[2]}, replayed winner side ${r.s.winner}`, lim: String(won) } : null;
    },
  },
  {
    // A swap is a drag or two taps on the board and an evolve a tap on the monster (ui.js the board's pointer handlers ->
    // commit(mine)); a pass is the turn timer, not counted. So each of the player's swaps and evolves needs at least one
    // press. Only moves made since the last resume (index >= rzAt) are counted: earlier ones were made on another page.
    id: 'battlearena-moves-without-touches',
    text: 'more swaps than touches',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (!x || !Array.isArray(x.mv) || p == null || !(Number(x.t0) > 0) || x.rzAt == null) return null;
      const seat = x.via == null ? ME : (x.seat === 1 ? 1 : 0);
      const mine = x.mv.filter((q, k) => Array.isArray(q) && k >= Number(x.rzAt) && q[0] === seat && q[1] !== 'p' && Number(x.t0) + Number(q[5]) >= ctx.n.t0).length;
      return mine > p ? { v: `${mine} swaps and evolves, ${p} presses`, lim: p } : null;
    },
  },
  {
    // A swap's own animation runs about half a second (ui.js SWAP_MS 190 x 2.6, then the fall), and people take seconds
    // to read the board (real plays: medians over 4.5 s, spreads over 5.8 s). Over 15+ moves, a median under 700 ms or
    // an even rhythm (spread under 150 ms) is a script's. Suspicious only.
    id: 'battlearena-machine-pace',
    text: 'swaps at a machine-like, even pace',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !Array.isArray(x.mv)) return null;
      const seat = x.via == null ? ME : (x.seat === 1 ? 1 : 0);
      const pc = pace(x.mv.filter((q) => Array.isArray(q) && q[1] !== 'p').map((q) => [q[0] === seat, Number(q[5]) || 0]));
      if (pc.n < 15) return null;
      if (pc.spread < 150 || pc.med < 700) return { v: `${pc.n} moves, ${pc.med} ms apart (middle), spread ${pc.spread} ms`, lim: 'spread 150 ms, median 700 ms' };
      return null;
    },
  },
];
