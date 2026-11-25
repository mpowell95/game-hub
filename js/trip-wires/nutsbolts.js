// js/trip-wires/nutsbolts.js - Nuts & Bolts' own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM,
// no network; imports only the game's pure rules (nuts-bolts/js/game.js and generator.js), never its screen.
//
// What the log holds (nuts-bolts/js/game.js `privateLog`): `start` = each bolt's nuts bottom to top, 'lime.pink.pink', from
// 2026-11-25 `hid` = which of them start hidden ('0110'), `seq` = every move '<from>><to>@<t>', 'u' undo, 'r' restart on THIS
// game object (`_lg`, never saved: a resumed board, `res` 1, starts a new list), `moves`; t ms from 2026-11-25
// (`tu: 'ms'`), seconds before.
import { NutsBoltsGame } from '../../nuts-bolts/js/game.js';

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const MOVE = /^(\d+)>(\d+)@(\d+)$/;
const seqOf = (x) => (x && Array.isArray(x.seq) && x.seq.length < 1500 && !(x.cut | 0) ? x.seq.map(String) : null);

/** The logged moves played on the logged start with the game's own rules: 'ok' (legal and solved), 'illegal', 'unsolved'. */
export function replayBolts(x, out = null) {
  if (!Array.isArray(x.start) || !Array.isArray(x.hid) || x.hid.length !== x.start.length) return null;
  let id = 0;
  const stacks = x.start.map((s, b) => (s ? String(s).split('.') : []).map((color, k) => ({ color, hidden: String(x.hid[b])[k] === '1', id: id++ })));
  const g = new NutsBoltsGame(x.tier, x.level, { stacks, initial: stacks, moves: 0, history: [], revealedIds: [] });
  for (const q of seqOf(x)) {
    if (q.startsWith('u')) { g.undo(); continue; }
    if (q.startsWith('r')) { g.restart(); continue; }
    const m = MOVE.exec(q);
    if (!m) continue;
    const r = g.tryMove(Number(m[1]), Number(m[2]));
    if (!r || !r.legal) return 'illegal';
  }
  if (out) out.game = g;
  return g.isWon() ? 'ok' : 'unsolved';
}

export default [
  {
    // A move is `tryMove` from `select`: a tap on the source bolt, then a tap on the target (`handleBoltTap`, from a click);
    // `selected` is cleared after every move, so each move takes two taps. Undo and Restart are a tap each. A level makes
    // no other result while it is open.
    id: 'nutsbolts-moves-without-taps',
    text: 'more moves than the taps they need',
    proven: true,
    check(e, ctx) {
      const s = seqOf(ctx.x), p = presses(ctx.n);
      if (!s || p == null || e.f !== 'recordNutsBolts') return null;
      const mv = s.filter((q) => MOVE.test(q)).length, other = s.length - mv, need = mv * 2 + other;
      return need > p ? { v: `${mv} moves need ${need} taps, ${p} touches`, lim: p } : null;
    },
  },
  {
    // `tryMove` logs only a legal move, and the solve is `isWon()` after the last one. Replayed on the logged start (hidden
    // nuts included) with the game's own NutsBoltsGame, every logged move must be legal and the bolts end solved.
    id: 'nutsbolts-moves-do-not-solve',
    text: 'a solve the logged moves cannot make',
    proven: true,
    check(e, ctx) {
      const x = ctx.x;
      if (!seqOf(x) || e.f !== 'recordNutsBolts' || (x.res | 0) !== 0 || !Array.isArray(x.hid)) return null;
      const r = replayBolts(x);
      return r && r !== 'ok' ? { v: r === 'illegal' ? 'a logged move breaks the rules' : `${x.seq.length} moves leave the bolts unsolved` } : null;
    },
  },
  {
    // The recorder's move count is `game.moves`, which each logged move adds one to and undo/restart take back. On a level
    // opened fresh it can never exceed the moves logged.
    id: 'nutsbolts-moves-not-logged',
    text: 'more moves recorded than made',
    proven: true,
    check(e, ctx) {
      const s = seqOf(ctx.x), x = ctx.x;
      if (!s || e.f !== 'recordNutsBolts' || (x.res | 0) !== 0) return null;
      const mv = s.filter((q) => MOVE.test(q)).length, rec = Number((ctx.a || [])[1]);
      return Number.isFinite(rec) && rec > mv ? { v: `${rec} moves recorded, ${mv} made`, lim: mv } : null;
    },
  },
  {
    // Two taps a move, each on a bolt: a person needs well over half a second a move. Ten or more under 400 ms apart
    // (middle gap) is a machine. ms logs only.
    id: 'nutsbolts-machine-pace',
    text: 'moves made faster than two taps allow',
    proven: false,
    check(e, ctx) {
      const s = seqOf(ctx.x);
      if (!s || e.f !== 'recordNutsBolts' || ctx.x.tu !== 'ms') return null;
      const t = s.map((q) => MOVE.exec(q)).filter(Boolean).map((m) => Number(m[3]));
      if (t.length < 10) return null;
      const gaps = t.slice(1).map((v, k) => v - t[k]).sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      return med < 400 ? { v: `${t.length} moves, ${med} ms apart (middle value)`, lim: 400 } : null;
    },
  },
];
