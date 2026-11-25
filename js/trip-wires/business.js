// js/trip-wires/business.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'business-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// Monopoly Deal (stats id 'business', intentional; root CLAUDE.md "Monopoly Deal naming").
//
// What they read: the result __ghStats.record('business', diff, won, ...) (js/game-stats-global.js; a = ['business',
// diff, won]) and its private log x (business-deal/js/ui.js `_privateLog`): x.why ('end' | 'discard'), x.win (the
// winner's player id; the player is 0), x.deck / x.disc (cards left in the draw and discard piles), x.pl[i] = { hand,
// bank, props: { colour: [cards, house 0/1, hotel 0/1] }, sets (complete colours) }, x.logs (every engine line), and
// from 2026-11-25 x.t0 + x.hm = the player's moves on that page, [ms since t0, move type].

const DECK = 106;     // business-deal/js/deck.js: "the 106 playable Monopoly Deal cards"
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
const presses = (n) => n.ev.filter((q) => (q.kind === 'd' || q.kind === 'k') && !q.fake).length + (n.cut | 0);
const ended = (a, x) => Array.isArray(a) && a[0] === 'business' && x && typeof x === 'object' && x.why === 'end' && Array.isArray(x.pl);

export default [
  // PROVEN. business-deal/js/game.js: a player WINS only with 3 complete sets ("*** X WINS with 3 complete sets"), and
  // ui.js records won = (the winner is the player, id 0). A recorded win the final board does not give (another
  // winner, or fewer than 3 complete colours on the player's side) is impossible.
  { id: 'business-win-without-three-sets', proven: true, text: 'a win without three complete sets on the board',
    check(e, { a, x }) {
      if (!ended(a, x) || a[2] !== true) return null;
      if (x.win != null && Number(x.win) !== 0) return { v: `winner ${x.win}`, lim: 'the player' };
      const sets = x.pl[0] && Array.isArray(x.pl[0].sets) ? x.pl[0].sets : null;
      return sets && sets.length < 3 ? { v: `${sets.length} complete sets`, lim: 3 } : null;
    } },
  // PROVEN. deck.js builds 106 cards and game.js only MOVES them (draw, play, bank, pay, steal, discard, reshuffle):
  // at the end the draw pile, the discard pile, every hand, bank and property pile (houses and hotels included) hold
  // exactly 106. More or fewer means a card was made or removed outside the game.
  { id: 'business-cards-not-106', proven: true, text: 'cards on the table that do not add up to the deck',
    check(e, { a, x }) {
      if (!ended(a, x) || !Number.isFinite(Number(x.deck)) || !Number.isFinite(Number(x.disc))) return null;
      let n = Number(x.deck) + Number(x.disc);
      for (const p of x.pl) {
        if (!p || !Array.isArray(p.hand) || !Array.isArray(p.bank) || !p.props || typeof p.props !== 'object') return null;
        n += p.hand.length + p.bank.length;
        for (const g of Object.values(p.props)) if (Array.isArray(g)) n += (Array.isArray(g[0]) ? g[0].length : 0) + (Number(g[1]) || 0) + (Number(g[2]) || 0);
      }
      return n !== DECK ? { v: `${n} cards`, lim: DECK } : null;
    } },
  // PROVEN. ui.js: every move of the player's (a card's Bank / Play button after tapping the card, a target or colour
  // pick, Pass) is resolved from a tap (_resolveMove), never on its own. So the moves chosen while the touch log ran
  // cannot outnumber its real presses (2 spare for a press just before the log started).
  { id: 'business-moves-without-taps', proven: true, text: 'more moves than real taps',
    check(e, { a, x, n }) {
      if (!n || !ended(a, x) || !Array.isArray(x.hm) || !(Number(x.t0) > 0)) return null;
      const t0 = Number(x.t0);
      const acts = x.hm.filter((q) => Array.isArray(q) && t0 + Number(q[0]) >= n.t0).length;
      const p = presses(n);
      return acts >= 3 && acts > p + 2 ? { v: `${acts} moves, ${p} presses`, lim: p + 2 } : null;
    } },
  // SUSPICIOUS. Back-to-back moves of the player's in one turn each need a card tapped and an action chosen (two taps
  // and a card to read): the middle gap under 0.3 s over 15+ such moves looks like a script.
  { id: 'business-instant-moves', proven: false, text: 'moves faster than a person can tap a card and choose',
    check(e, { a, x }) {
      if (!ended(a, x) || !Array.isArray(x.hm)) return null;
      const hm = x.hm.filter(Array.isArray), gaps = [];
      for (let k = 1; k < hm.length; k++) { const g = Number(hm[k][0]) - Number(hm[k - 1][0]); if (g >= 0 && g < 20000) gaps.push(g); }
      if (gaps.length < 15) return null;
      const md = median(gaps);
      return md < 300 ? { v: `${gaps.length} moves, ${md} ms (middle value)`, lim: 300 } : null;
    } },
];
