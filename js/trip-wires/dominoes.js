// js/trip-wires/dominoes.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'dominoes-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
//
// What they read: the result `recordDominoes(diff, won, extras)` (a = [diff, won, {...}]) and its private log x
// (dominoes/js/ui.js `_playLog`): x.target, x.scores, x.rd = one entry per round started on this page
// (dominoes/js/game.js startRound / _pl / _settleRound): { h0, h1, yard (the deal, tile ids 0..27), mv: [[seat, 'p', tile,
// side, count, scored, ms] | [seat, 'd', tile, ms] | [seat, 'x', ms]], rs (round score each), l0, l1 (hands left) }, and
// from 2026-11-25 x.t0 (the epoch ms every move's last number counts from). Seat 0 is the player.
// (The older stats-level rule 'dominoes-win-without-points' in js/integrity.js is not repeated here.)

// dominoes/js/game.js TILES: the double-six set, [a, b] with a <= b.
const TILES = (() => { const t = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b]); return t; })();
const pips = (id) => (TILES[id] ? TILES[id][0] + TILES[id][1] : NaN);
const MV_CAP = 400;     // game.js _pl keeps at most 400 moves a round
const rounds = (x) => (x && Array.isArray(x.rd) ? x.rd.filter((r) => r && typeof r === 'object') : null);
const timeOf = (m) => Number(m[m.length - 1]);
/** Real presses in a touch log: touch downs and key presses not made up by a script; a log that overflowed (`cut`)
 *  counts every dropped event as a press, so the number can only be too high, never too low. */
const presses = (n) => n.ev.filter((q) => (q.kind === 'd' || q.kind === 'k') && !q.fake).length + (n.cut | 0);
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };

export default [
  // PROVEN. game.js startRound deals ONE shuffle of the 28 tiles (7 + 7 + 14 in the boneyard), and play() / draw()
  // only move a tile from a hand (or the boneyard) once: every tile is in the deal exactly once, none is played twice
  // in a round, and nobody plays a tile they were not dealt or did not draw.
  { id: 'dominoes-tile-twice', proven: true, text: 'a tile dealt twice, played twice, or played without being held',
    check(e, { x }) {
      const rd = rounds(x);
      if (!rd || !rd.length) return null;
      for (const r of rd) {
        if (!Array.isArray(r.h0) || !Array.isArray(r.h1) || !Array.isArray(r.yard) || !Array.isArray(r.mv)) continue;
        const deal = [...r.h0, ...r.h1, ...r.yard];
        if (deal.length !== 28 || new Set(deal).size !== 28 || deal.some((id) => !TILES[id])) return { v: `round ${r.n}: ${deal.length} tiles, ${new Set(deal).size} different`, lim: 28 };
        const held = [new Set(r.h0), new Set(r.h1)], played = new Set();
        for (const m of r.mv) {
          if (!Array.isArray(m) || (m[0] !== 0 && m[0] !== 1)) continue;
          if (m[1] === 'd') held[m[0]].add(m[2]);
          if (m[1] !== 'p') continue;
          if (played.has(m[2]) || !held[m[0]].has(m[2])) return { v: `round ${r.n}: tile ${m[2]} by seat ${m[0]}`, lim: '' };
          played.add(m[2]);
        }
      }
      return null;
    } },
  // PROVEN. game.js: a play scores scoreOf(count), only a multiple of five; _settleRound adds the pips left in the
  // OTHER hand to each side. roundScore starts at 0 each round, so a settled round's score per seat is exactly its
  // scoring plays plus the other hand's leftovers (rounds whose move list hit the 400 cap are skipped).
  { id: 'dominoes-score-adds-wrong', proven: true, text: 'a round score the plays and the tiles left do not add up to',
    check(e, { x }) {
      const rd = rounds(x);
      if (!rd || !rd.length) return null;
      for (const r of rd) {
        if (!Array.isArray(r.mv) || r.mv.length >= MV_CAP || !Array.isArray(r.rs) || !Array.isArray(r.l0) || !Array.isArray(r.l1) || !Array.isArray(r.h0)) continue;
        const got = [0, 0];
        for (const m of r.mv) {
          if (!Array.isArray(m) || m[1] !== 'p') continue;
          const sc = Number(m[5]) || 0;
          if (sc % 5) return { v: `round ${r.n}: a play scored ${sc}`, lim: 'a multiple of 5' };
          if (m[0] === 0 || m[0] === 1) got[m[0]] += sc;
        }
        const want = [got[0] + r.l1.reduce((s, id) => s + pips(id), 0), got[1] + r.l0.reduce((s, id) => s + pips(id), 0)];
        for (const s of [0, 1]) if (Number(r.rs[s]) !== want[s]) return { v: `round ${r.n}: seat ${s} scored ${r.rs[s]}`, lim: want[s] };
      }
      return null;
    } },
  // PROVEN. game.js _settleRound: the match ends only when a total reaches the target, and matchWinner is the higher
  // total; ui.js records won = (matchWinner === the player). A recorded win under the target or not ahead is impossible.
  { id: 'dominoes-win-under-target', proven: true, text: 'a win without reaching the target or without the higher score',
    check(e, { a, x }) {
      if (!a || a[1] !== true || !x || x.end !== 'over' || !Array.isArray(x.scores) || !(Number(x.target) > 0)) return null;
      const me = Number(x.scores[0]), them = Number(x.scores[1]);
      if (me < Number(x.target) || me <= them) return { v: `${me} to ${them}`, lim: `${x.target}, ahead` };
      return null;
    } },
  // PROVEN. ui.js: the player's play (_commitPlay from a tile tap or an end badge tap) and draw (the boneyard drawer's
  // tile tap, drawTile) each need a press of their own; only a pass is automatic (later(() => g.pass(HUMAN))). So the
  // player's plays and draws made while the touch log was running cannot outnumber its real presses (2 spare for a
  // press that landed just before the log started).
  { id: 'dominoes-moves-without-taps', proven: true, text: 'more tiles played and drawn than real taps',
    check(e, { x, n }) {
      const rd = rounds(x), t0 = Number(x && x.t0);
      if (!n || !rd || !(t0 > 0)) return null;
      let acts = 0;
      for (const r of rd) for (const m of (Array.isArray(r.mv) ? r.mv : [])) {
        if (Array.isArray(m) && m[0] === 0 && (m[1] === 'p' || m[1] === 'd') && t0 + timeOf(m) >= n.t0) acts++;
      }
      const p = presses(n);
      return acts >= 3 && acts > p + 2 ? { v: `${acts} moves, ${p} presses`, lim: p + 2 } : null;
    } },
  // SUSPICIOUS. A person needs time to see the board after the computer's tile lands (ui.js animates it) and pick a
  // tile: the middle of the player's think times under 0.25 s over 15+ chosen plays looks like a script.
  { id: 'dominoes-instant-plays', proven: false, text: 'tiles played faster than a person can read the board',
    check(e, { x }) {
      const rd = rounds(x);
      if (!rd || !(Number(x.t0) > 0)) return null;
      const gaps = [];
      for (const r of rd) {
        const mv = (Array.isArray(r.mv) ? r.mv : []).filter(Array.isArray);
        for (let k = 1; k < mv.length; k++) if (mv[k][0] === 0 && mv[k][1] === 'p' && mv[k - 1][0] === 1) gaps.push(timeOf(mv[k]) - timeOf(mv[k - 1]));
      }
      if (gaps.length < 15) return null;
      const md = median(gaps);
      return md < 250 ? { v: `${gaps.length} plays, ${md} ms (middle value)`, lim: 250 } : null;
    } },
];
