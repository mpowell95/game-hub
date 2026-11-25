// js/trip-wires/escoba.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'escoba-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
//
// What they read: the result recordEscoba(diff, won, { escobas }) (a = [diff, won, {...}]; online = 'mp') and its
// private log x (escoba/js/ui.js `_xnote` / `_playLog`): x.deck ('spanish' | 'american'), x.target, x.winner, x.why,
// x.me (this phone's seat), x.pl[seat].tot, x.rd = one entry per round: { deck: the round's 40 cards in order ('o7,b10,
// ...', one-letter suit), mv: [[seat, played card, cards taken ('', or 'es4,or8'), escoba 0/1, ms]] (two-letter suit
// codes: or co es ba + rank) }, and from 2026-11-25 x.t0 (the epoch ms each play's last number counts from).

const SUITS1 = { o: 1, c: 1, e: 1, b: 1 }, SUITS2 = { or: 1, co: 1, es: 1, ba: 1 };
const RANKS = { spanish: [1, 2, 3, 4, 5, 6, 7, 10, 11, 12], american: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };   // escoba/js/deck.js RANKS
const modeOf = (x) => (x && x.deck === 'american' ? 'american' : 'spanish');
/** escoba/js/deck.js captureValue: American as printed, Spanish figures (10, 11, 12) count 8, 9, 10. */
const valueOf = (rank, mode) => (mode === 'american' ? rank : rank >= 10 ? rank - 2 : rank);
const rankOf = (code) => Number(String(code).slice(2));
const rounds = (x) => (x && Array.isArray(x.rd) ? x.rd.filter((r) => r && typeof r === 'object') : null);
const plays = (r) => (Array.isArray(r.mv) ? r.mv.filter((m) => Array.isArray(m) && typeof m[1] === 'string') : []);
const taken = (m) => (m[2] ? String(m[2]).split(',').filter(Boolean) : []);
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
const presses = (n) => n.ev.filter((q) => (q.kind === 'd' || q.kind === 'k') && !q.fake).length + (n.cut | 0);
const online = (a) => Array.isArray(a) && a[0] === 'mp';

export default [
  // PROVEN. escoba/js/game.js playTurn takes cards only from captureOptions (deck.js: the played card's value plus the
  // cards taken is exactly 15; a human pick that is not is refused by ui.js _confirmCapture, and legalize() coerces
  // anything else to a real option). A capture that does not make 15 cannot come from the game.
  { id: 'escoba-capture-not-15', proven: true, text: 'a capture that does not add up to 15',
    check(e, { x }) {
      const rd = rounds(x);
      if (!rd || !rd.length) return null;
      const mode = modeOf(x);
      for (const r of rd) for (const m of plays(r)) {
        const tk = taken(m);
        if (!tk.length) continue;
        const sum = [m[1], ...tk].reduce((s, c) => s + valueOf(rankOf(c), mode), 0);
        if (sum !== 15) return { v: `round ${r.n}: ${m[1]} took ${m[2]} (${sum})`, lim: 15 };
      }
      return null;
    } },
  // PROVEN. game.js playRound deals one shuffle of makeDeck(mode)'s 40 cards; a card is played once from a hand and
  // taken once from the table. So a round's deck is 40 different cards of that numbering, no card is played twice,
  // taken twice, played after it was taken, or taken after it took cards itself (only a card LAID on the table can
  // be taken later), and every card played or taken is in the deck.
  { id: 'escoba-card-twice', proven: true, text: 'a card dealt twice, played twice, or taken twice in one round',
    check(e, { x }) {
      const rd = rounds(x);
      if (!rd || !rd.length) return null;
      const ranks = RANKS[modeOf(x)];
      for (const r of rd) {
        if (typeof r.deck === 'string' && r.deck) {
          const d = r.deck.split(',');
          const good = d.every((c) => SUITS1[c.charAt(0)] && ranks.includes(Number(c.slice(1))));
          if (d.length !== 40 || new Set(d).size !== 40 || !good) return { v: `round ${r.n}: ${d.length} cards, ${new Set(d).size} different`, lim: 40 };
        }
        // A card laid on the table (played, nothing taken) may be taken later; nothing else moves twice.
        const played = new Set(), tookSet = new Set(), captor = new Set();
        for (const m of plays(r)) {
          const tk = taken(m);
          for (const c of [m[1], ...tk]) if (!SUITS2[c.slice(0, 2)] || !ranks.includes(rankOf(c))) return { v: `round ${r.n}: ${c}`, lim: 'a card of the deck' };
          if (played.has(m[1]) || tookSet.has(m[1])) return { v: `round ${r.n}: ${m[1]} played again`, lim: '' };
          played.add(m[1]);
          if (tk.length) captor.add(m[1]);
          for (const c of tk) {
            if (tookSet.has(c) || captor.has(c)) return { v: `round ${r.n}: ${c} taken again`, lim: '' };
            tookSet.add(c);
          }
        }
      }
      return null;
    } },
  // PROVEN. ui.js _commitStats: won = (game.winner is this phone's player); game.js checkMatchEnd names a winner only
  // on a whitewash or when the top total reaches the target AND is alone on top. A recorded win the logged totals
  // deny cannot come from the game.
  { id: 'escoba-win-the-scores-deny', proven: true, text: 'a win the match scores do not give',
    check(e, { a, x }) {
      if (!a || a[1] !== true || online(a) || !x || x.end !== 'over' || !Array.isArray(x.pl) || !Number.isInteger(x.me)) return null;
      if (x.winner != null && x.winner !== x.me) return { v: `winner seat ${x.winner}, this player seat ${x.me}`, lim: '' };
      if (x.why === 'target') {
        const mine = Number(x.pl[x.me] && x.pl[x.me].tot), best = Math.max(...x.pl.filter((_, k) => k !== x.me).map((p) => Number(p && p.tot) || 0));
        if (mine < Number(x.target) || mine <= best) return { v: `${mine} to ${best}`, lim: `${x.target}, ahead` };
      }
      return null;
    } },
  // PROVEN. ui.js: the player's card is played only from _confirmCapture / _confirmLay (the hand card tap, then the
  // Capture or Lay button), never by itself; a challenge's earlier plays replayed from its log are online ('mp') and
  // not judged. So this phone's plays while the touch log ran cannot outnumber its real presses (2 spare).
  { id: 'escoba-plays-without-taps', proven: true, text: 'more cards played than real taps',
    check(e, { a, x, n }) {
      const rd = rounds(x), t0 = Number(x && x.t0);
      if (!n || !rd || !(t0 > 0) || online(a) || !Number.isInteger(x.me)) return null;
      let acts = 0;
      for (const r of rd) for (const m of plays(r)) if (m[0] === x.me && t0 + Number(m[4]) >= n.t0) acts++;
      const p = presses(n);
      return acts >= 3 && acts > p + 2 ? { v: `${acts} cards, ${p} presses`, lim: p + 2 } : null;
    } },
  // SUSPICIOUS. After the computer's card lands a person reads the table, picks a card and taps Capture or Lay: the
  // middle think time under 0.4 s over 15+ plays looks like a script (King of Games' real plays: 1.3 to 13 s).
  { id: 'escoba-instant-plays', proven: false, text: 'cards played faster than a person can read the table',
    check(e, { a, x }) {
      const rd = rounds(x);
      if (!rd || online(a) || !Number.isInteger(x.me)) return null;
      const gaps = [];
      for (const r of rd) {
        const mv = plays(r);
        for (let k = 1; k < mv.length; k++) if (mv[k][0] === x.me && mv[k - 1][0] !== x.me) gaps.push(Number(mv[k][4]) - Number(mv[k - 1][4]));
      }
      if (gaps.length < 15) return null;
      const md = median(gaps);
      return md < 400 ? { v: `${gaps.length} plays, ${md} ms (middle value)`, lim: 400 } : null;
    } },
];
