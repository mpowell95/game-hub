// js/trip-wires/chinchon.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'chinchon-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
//
// What they read: the result recordChinchon(diff, won, {...}) (a = [diff, won, {...}]; online = 'mp') and its private
// log x (chinchon/js/ui.js `_xnote` / `_playLog`): x.me (this phone's seat), x.winner, x.pl[seat].tot, x.rd = one entry
// per round: { deck: the round's deck order ('o1,c12,...'), ev: [['d', seat, 'S'|'D', card, ms] (a draw from the
// stock or the discard pile) | ['x', seat, card, ms] (a discard) | ['c', seat, ms] (a close)] (at most 300 a round) },
// and from 2026-11-25 x.t0 (the epoch ms each move's last number counts from).

const rounds = (x) => (x && Array.isArray(x.rd) ? x.rd.filter((r) => r && typeof r === 'object') : null);
const evs = (r) => (Array.isArray(r.ev) ? r.ev.filter((q) => Array.isArray(q)) : []);
const timeOf = (q) => Number(q[q.length - 1]);
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
const presses = (n) => n.ev.filter((q) => (q.kind === 'd' || q.kind === 'k') && !q.fake).length + (n.cut | 0);
const online = (a) => Array.isArray(a) && a[0] === 'mp';

export default [
  // PROVEN. chinchon/js/game.js drawFrom('discard') pops the TOP of the discard pile, and the top is always the card the
  // previous player just discarded (discardCard pushes it; tryResetStock keeps the top). So a draw from the discard
  // pile right after a discard takes exactly that card.
  { id: 'chinchon-draw-not-the-discard', proven: true, text: 'a card taken from the discard pile that was not on top',
    check(e, { x }) {
      const rd = rounds(x);
      if (!rd || !rd.length) return null;
      for (const r of rd) {
        const ev = evs(r);
        for (let k = 1; k < ev.length; k++) {
          const q = ev[k], p = ev[k - 1];
          if (q[0] === 'd' && q[2] === 'D' && p[0] === 'x' && q[3] != null && p[2] != null && q[3] !== p[2]) return { v: `round ${r.n}: took ${q[3]}, ${p[2]} was on top`, lim: p[2] };
        }
      }
      return null;
    } },
  // PROVEN. game.js deals each round from ONE shuffle of makeDeck(config) (lastDeckOrder): every card in it once.
  { id: 'chinchon-card-twice', proven: true, text: 'a deck with the same card in it twice',
    check(e, { x }) {
      const rd = rounds(x);
      if (!rd || !rd.length) return null;
      for (const r of rd) {
        if (typeof r.deck !== 'string' || !r.deck) continue;
        const d = r.deck.split(',');
        if (new Set(d).size !== d.length || d.length < 40) return { v: `round ${r.n}: ${d.length} cards, ${new Set(d).size} different`, lim: d.length };
      }
      return null;
    } },
  // PROVEN. ui.js: the player draws only from a pile tap (draw-stock / draw-discard) and discards only from a card tap
  // (a second tap confirms) or a drag onto the pile (a press of its own); only a close can be automatic
  // (meld.shouldAutoClose), and closes are not counted here. Online plays are not judged.
  { id: 'chinchon-moves-without-taps', proven: true, text: 'more draws and discards than real taps',
    check(e, { a, x, n }) {
      const rd = rounds(x), t0 = Number(x && x.t0);
      if (!n || !rd || !(t0 > 0) || online(a) || !Number.isInteger(x.me)) return null;
      let acts = 0;
      for (const r of rd) for (const q of evs(r)) if ((q[0] === 'd' || q[0] === 'x') && q[1] === x.me && t0 + timeOf(q) >= n.t0) acts++;
      const p = presses(n);
      return acts >= 3 && acts > p + 2 ? { v: `${acts} moves, ${p} presses`, lim: p + 2 } : null;
    } },
  // SUSPICIOUS. Between the player's draw and discard a person looks at the hand and picks a card (two taps or a drag):
  // the middle time under 0.35 s over 15+ turns looks like a script.
  { id: 'chinchon-instant-discards', proven: false, text: 'cards discarded faster than a person can read the hand',
    check(e, { a, x }) {
      const rd = rounds(x);
      if (!rd || online(a) || !Number.isInteger(x.me)) return null;
      const gaps = [];
      for (const r of rd) {
        const ev = evs(r);
        for (let k = 1; k < ev.length; k++) if (ev[k][0] === 'x' && ev[k][1] === x.me && ev[k - 1][0] === 'd' && ev[k - 1][1] === x.me) gaps.push(timeOf(ev[k]) - timeOf(ev[k - 1]));
      }
      if (gaps.length < 15) return null;
      const md = median(gaps);
      return md < 350 ? { v: `${gaps.length} discards, ${md} ms (middle value)`, lim: 350 } : null;
    } },
];
