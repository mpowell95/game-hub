// js/trip-wires/holdem.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'holdem-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
//
// What they read:
//  - every hand: recordHoldemHand({ won, amt, score, cat, cards }) (holdem/js/ui.js _handEnd): cards = the player's best
//    five (ints 0..51, rank = c >> 2, suit = c & 3), score = engine.js evaluate of them, cat = categoryOf(score) (9 for a
//    royal flush), amt = chips won, won = amt > 0.
//  - the match: recordResult('holdem', diff, won) and its private log x (ui.js matchLog): x.my (the player's seat),
//    x.winner, x.cfg.chips (every seat's starting stack), x.seats[i].c (chips at the end), x.solo, and from 2026-11-25
//    x.t0 + x.acts = the player's decisions [ms since the first, action, 1 = the ticked Check / Fold, ms since the turn
//    came up].
// The older stats-level rule 'holdem-ledger' (js/integrity.js, the bankroll) is not repeated here.
import { evaluate, categoryOf, scoreRanks } from '../../holdem/js/engine.js';

const handOf = (e, a) => (e.f === 'recordHoldemHand' && Array.isArray(a) && a[0] && typeof a[0] === 'object' ? a[0] : null);
const matchOf = (e, a, x) => (e.f === 'recordResult' && Array.isArray(a) && a[0] === 'holdem' && x && typeof x === 'object' ? x : null);
const median = (v) => { const s = v.slice().sort((p, q) => p - q); return s[s.length >> 1]; };

export default [
  // PROVEN. ui.js _handEnd: cards = bestFive(hole + board).cards (five different cards of one 52-card deck), score =
  // its evaluate(), cat = categoryOf(score) (9 for an ace-high straight flush). A hand whose five cards do not make the
  // score and category recorded was not dealt by the game.
  { id: 'holdem-hand-not-the-cards', proven: true, text: 'a poker hand recorded that its own five cards do not make',
    check(e, { a }) {
      const h = handOf(e, a);
      if (!h || !Array.isArray(h.cards) || !h.cards.length) return null;
      const c = h.cards.map(Number);
      if (c.length !== 5 || c.some((v) => !Number.isInteger(v) || v < 0 || v > 51) || new Set(c).size !== 5) return { v: `cards ${c.join(',')}`, lim: '5 different cards' };
      const sc = evaluate(c);
      let cat = categoryOf(sc);
      if (cat === 8 && scoreRanks(sc)[0] === 12) cat = 9;
      if (Number(h.score) !== sc || Number(h.cat) !== cat) return { v: `score ${h.score}, category ${h.cat}`, lim: `${sc}, ${cat}` };
      return null;
    } },
  // PROVEN. ui.js _handEnd records won: amt > 0, and amt is a sum of whole pot shares (never negative); a hand that
  // says it was won with nothing taken, or lost while taking chips, was not written by the game.
  { id: 'holdem-hand-won-without-chips', proven: true, text: 'a hand marked won with no chips won, or lost with chips won',
    check(e, { a }) {
      const h = handOf(e, a);
      if (!h || typeof h.won !== 'boolean' || !Number.isFinite(Number(h.amt))) return null;
      const amt = Number(h.amt);
      return h.won !== (amt > 0) || amt < 0 ? { v: `won ${h.won}, ${amt} chips`, lim: '' } : null;
    } },
  // PROVEN. ui.js _maybeRecord: won = (pub.over && pub.winner === this seat); engine.js ends the tournament only when
  // one seat holds chips. A recorded win where the log names another winner, or another seat still has chips, is
  // impossible.
  { id: 'holdem-win-not-last', proven: true, text: 'a tournament win with someone else still holding chips',
    check(e, { a, x }) {
      const m = matchOf(e, a, x);
      if (!m || a[2] !== true || !Array.isArray(m.seats) || !Number.isInteger(m.my)) return null;
      if (m.winner != null && m.winner !== m.my) return { v: `winner seat ${m.winner}, player seat ${m.my}`, lim: '' };
      const others = m.seats.filter((s, k) => k !== m.my && s && Number(s.c) > 0);
      return others.length ? { v: `${others.length} other seats with chips`, lim: 0 } : null;
    } },
  // PROVEN (solo tables). engine.js: newGame gives every seat cfg.chips and chips only move between seats (blinds, bets,
  // pots); no chip is made or lost. At a finished solo tournament the seats' chips add up to seats x cfg.chips.
  { id: 'holdem-chips-from-nowhere', proven: true, text: 'chips at the table that were never dealt',
    check(e, { a, x }) {
      const m = matchOf(e, a, x);
      if (!m || m.solo !== 1 || !Array.isArray(m.seats) || !m.cfg || !(Number(m.cfg.chips) > 0) || m.why === 'giveup') return null;
      const sum = m.seats.reduce((t, s) => t + (Number(s && s.c) || 0), 0), want = m.seats.length * Number(m.cfg.chips);
      return sum !== want ? { v: `${sum} chips`, lim: want } : null;
    } },
  // SUSPICIOUS. A decision of the player's own (not the ticked Check / Fold) needs the cards read and a button tapped;
  // the middle think time under 0.3 s over 20+ decisions in a tournament looks like a script.
  { id: 'holdem-instant-decisions', proven: false, text: 'poker decisions faster than a person can read the cards',
    check(e, { a, x }) {
      const m = matchOf(e, a, x);
      if (!m || !Array.isArray(m.acts)) return null;
      const lat = m.acts.filter((q) => Array.isArray(q) && q[2] === 0 && Number.isFinite(q[3])).map((q) => q[3]);
      if (lat.length < 20) return null;
      const md = median(lat);
      return md < 300 ? { v: `${lat.length} decisions, ${md} ms (middle value)`, lim: 300 } : null;
    } },
];
