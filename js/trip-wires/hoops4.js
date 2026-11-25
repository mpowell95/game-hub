// js/trip-wires/hoops4.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network; imports only the game's pure rules (hoops4/js/game.js, which imports connect-four/js/board.js). The older rule
// (more baskets made than shots, from the detail) lives in js/integrity.js checkPlayInput and is not repeated here.
// Data: the private log `x` (hoops4/js/ui.js _xlData): kind ('cpu' | 'live' | 'pnp'), one (one shot a turn), first, me,
// winner, over, shots = [red, yellow], moves = [by, column, shots it took], shotLog = [player, power, aim, seed, column (-1 a
// miss), what happened, seconds] per shot, and from 2026-11-25 t0 (epoch ms the shot clock began) and cut. `a` =
// ['hoops4', difficulty, won].
import { Match } from '../../hoops4/js/game.js';

// --- shared shape of this group's board-game files (copied, not imported: one file per game) ----------------------------
/** Real presses (touch/mouse downs and keys) in the touch log; null when it might not hold them all
 *  (js/play-log-queue.js _tok drops a press only once no move token is left to drop, so any move left = none dropped). */
function presses(n) {
  if (!n || !Array.isArray(n.ev)) return null;
  if (n.cut && !n.moves) return null;
  return n.ev.filter((q) => !q.fake && (q.kind === 'd' || q.kind === 'k')).length;
}

const rowsOf = (x) => (x && Array.isArray(x.shotLog) ? x.shotLog.filter((q) => Array.isArray(q) && q.length >= 7) : null);
/** Replays every logged shot through the game's own Match (land / miss, the one-shot rule included). Only a log holding
 *  EVERY shot of the match (as many rows as the match counted shots) is replayed: an older save had none. */
function replay(x) {
  const rows = rowsOf(x);
  if (!rows || !rows.length || x.cut || rows.length >= 300 || !Array.isArray(x.shots)) return null;
  if (rows.length !== (Number(x.shots[0]) || 0) + (Number(x.shots[1]) || 0)) return null;
  const m = new Match({ vsCpu: x.kind === 'cpu', first: x.first === 1 ? 1 : 0, oneShot: !!x.one });
  for (const q of rows) {
    if (m.over) return { m, bad: 'a shot after the match was over' };
    if (q[0] !== m.turn) return { m, bad: `player ${q[0]} shot on player ${m.turn}'s turn` };
    const col = Number(q[4]);
    const res = col >= 0 && col < 7 ? m.land(col) : m.miss();
    if (String(q[5]) !== String(res.type)) return { m, bad: `a shot logged ${q[5]}, the board gives ${res.type}` };
  }
  return { m, bad: null };
}

export default [
  {
    // hoops4/js/game.js Match: a ball through hoop c is a disc in column c (a full column is a miss), four in a row wins,
    // and under one shot a miss passes the turn. Replayed shot by shot, every shot must be by the player on turn, land as
    // logged, and leave the logged discs, shot counts and winner.
    id: 'hoops4-shots-not-board',
    text: 'shots, discs or a winner the board cannot give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, r = replay(x);
      if (!r) return null;
      if (r.bad) return { v: r.bad, lim: 'the rules of the board' };
      const m = r.m;
      const mv = m.moves.map((q) => `${q.by}${q.col}${q.shots}`).join(' '), lg = (x.moves || []).map((q) => `${q[0]}${q[1]}${q[2]}`).join(' ');
      if (Array.isArray(x.moves) && mv !== lg) return { v: `logged discs ${lg}, replayed ${mv}`, lim: mv };
      if (m.shots[0] !== Number(x.shots[0]) || m.shots[1] !== Number(x.shots[1])) return { v: `logged shots ${x.shots.join('-')}, replayed ${m.shots.join('-')}`, lim: m.shots.join('-') };
      if (x.over && (m.winner ?? null) !== (x.winner ?? null)) return { v: `logged winner ${x.winner}, replayed ${m.winner}`, lim: String(m.winner) };
      return null;
    },
  },
  {
    // ui.js finish(): vs the computer won = the match's winner is red (the player); a live room's won = winner is this
    // phone's side. A recorded win the replayed match does not give is impossible.
    id: 'hoops4-win-not-board',
    text: 'a recorded win the board does not give',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, a = ctx.a;
      if (!Array.isArray(a) || typeof a[2] !== 'boolean' || !x || x.end !== 'end' || (x.kind !== 'cpu' && x.kind !== 'live')) return null;
      const r = replay(x);
      if (!r || r.bad || !r.m.over) return null;
      const won = r.m.winner === (x.me === 1 ? 1 : 0);
      return a[2] !== won ? { v: `recorded ${a[2]}, board winner ${r.m.winner == null ? 'none' : r.m.winner}`, lim: String(won) } : null;
    },
  },
  {
    // A shot is flown only from a finger's (or mouse's) upward swipe on the pad (ui.js the pad's touchstart/mousedown ->
    // end -> shoot); the one exception is a continued match's ball that was in the air, flown again once on resume
    // (shoot(seedIn)), so one shot of slack. More of the player's shots after the touch log's first event than presses + 1
    // means something else threw them.
    id: 'hoops4-shots-without-swipes',
    text: 'more shots than finger swipes',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, rows = rowsOf(x), p = presses(ctx.n);
      if (!rows || p == null || !(Number(x.t0) > 0)) return null;
      const me = x.me === 1 ? 1 : 0;
      const mine = rows.filter((q) => q[0] === me && q[1] != null && Number(x.t0) + Number(q[6]) * 1000 >= ctx.n.t0 - 100).length;
      return mine > p + 1 ? { v: `${mine} shots, ${p} presses`, lim: p + 1 } : null;
    },
  },
  {
    // A person's swipe never repeats exactly: power and aim come from the finger's path in pixels and milliseconds
    // (ui.js swipeSpeed / atan2), kept to 4 decimals. Four or more of the player's shots with the very same power AND aim
    // is a replayed or scripted flick. Suspicious only.
    id: 'hoops4-same-flick',
    text: 'the very same flick, again and again',
    proven: false,
    check(e, ctx) {
      const rows = rowsOf(ctx.x);
      if (!rows) return null;
      const me = ctx.x.me === 1 ? 1 : 0, seen = {};
      let most = 0, at = '';
      for (const q of rows) {
        if (q[0] !== me || q[1] == null || q[2] == null) continue;
        const k = `${q[1]}/${q[2]}`;
        seen[k] = (seen[k] || 0) + 1;
        if (seen[k] > most) { most = seen[k]; at = k; }
      }
      return most >= 4 ? { v: `${most} shots at power/aim ${at}`, lim: 3 } : null;
    },
  },
];
