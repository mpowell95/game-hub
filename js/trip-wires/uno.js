// js/trip-wires/uno.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'uno-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
//
// What they read: the result recordResult('uno', diff, won) (a = ['uno', diff, won]) and its private log x
// (uno/js/ui.js `_playLog`): x.ev = every engine event in order, [type, seat, what, ms] where `what` is a card code
// (colour letter r/y/g/b, or w for a wild, then the number or the kind: 'r5', 'gskip', 'wwild4'), a colour name or an
// amount; x.left = every hand at the end; x.winner; x.res = 1 when the list starts at a resume; from 2026-11-25 x.t0
// (the epoch ms each event's last number counts from). Seat 0 is the player.

const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
const presses = (n) => n.ev.filter((q) => (q.kind === 'd' || q.kind === 'k') && !q.fake).length + (n.cut | 0);
const events = (x) => (x && Array.isArray(x.ev) ? x.ev.filter((q) => Array.isArray(q) && typeof q[0] === 'string') : null);
/** A card code as { col, kind, val }: 'r5' -> red number 5, 'bdraw2' -> blue draw2, 'wwild4' -> wild4. */
function card(code) {
  const s = String(code || ''), col = s.charAt(0), rest = s.slice(1);
  if (/^\d$/.test(rest)) return { col, kind: 'number', val: Number(rest) };
  return { col, kind: rest, val: null };
}
/** uno/js/game.js getLegalMoves / _matches, replayed over the event list. Returns the first play the rules refuse, or
 *  null. Unknown state (a list that starts at a resume, before the first play) is never judged. */
export function unoIllegalPlay(ev) {
  let top = null, color = null, pending = null;
  for (const q of ev) {
    const [type, seat, what] = q;
    if (type === 'gameStart') { top = card(what); color = top.col === 'w' ? null : top.col; pending = 0; continue; }
    if (type === 'colorChosen') { if (typeof what === 'string' && what) color = what.charAt(0); continue; }
    if (type === 'penaltyDraw') { pending = 0; continue; }
    if (type !== 'cardPlayed') continue;
    const c = card(what);
    if (top && color != null) {
      let ok;
      if (pending > 0) ok = c.kind === 'draw2';                       // only a +2 answers a +2 stack (no Wild +4)
      else if (c.kind === 'wild' || c.kind === 'wild4') ok = true;
      else if (c.col === color) ok = true;
      else if (c.kind === 'number') ok = top.kind === 'number' && top.val === c.val;
      else ok = c.kind === top.kind;
      if (!ok) return { seat, card: what, top: (top.col || '') + (top.val != null ? top.val : top.kind), color, pending };
    }
    if (c.kind === 'draw2') pending = (pending || 0) + 2;
    else pending = 0;
    top = c;
    color = c.col === 'w' ? null : c.col;
  }
  return null;
}

export default [
  // PROVEN. game.js play(): a hand is won only when the player's last card leaves it (phase 'over', winner = that seat,
  // 'handWon'); ui.js finish() records won = (winner === the player). A recorded win with cards still in the player's
  // hand, or another seat named the winner, cannot come from the game.
  { id: 'uno-won-with-cards', proven: true, text: 'a win with cards still in hand',
    check(e, { a, x }) {
      if (!a || a[2] !== true || !x || x.end !== 'over' || !Array.isArray(x.left) || !Array.isArray(x.left[0])) return null;
      if (x.left[0].length > 0 || (x.winner != null && Number(x.winner) !== 0)) return { v: `${x.left[0].length} cards left, winner seat ${x.winner}`, lim: 0 };
      return null;
    } },
  // PROVEN. game.js getLegalMoves is the only door to a play (play() throws on anything else): with a +2 stack only a
  // +2; otherwise a wild, the colour in force, the same number, or the same action. Replayed over every logged play.
  { id: 'uno-illegal-card', proven: true, text: 'a card played that the rules do not allow on the pile',
    check(e, { x }) {
      const ev = events(x);
      if (!ev || !ev.length) return null;
      const bad = unoIllegalPlay(ev);
      return bad ? { v: `seat ${bad.seat} played ${bad.card} on ${bad.top} (colour ${bad.color}${bad.pending ? `, +${bad.pending} owed` : ''})`, lim: '' } : null;
    } },
  // PROVEN. ui.js: the player's card leaves the hand only through _playHuman, reached from a card tap (a wild also
  // needs the colour tap); draws and penalty draws can be automatic, plays never are. So the player's plays while the
  // touch log was running cannot outnumber its real presses (2 spare for a press just before the log started).
  { id: 'uno-plays-without-taps', proven: true, text: 'more cards played than real taps',
    check(e, { x, n }) {
      const ev = events(x), t0 = Number(x && x.t0);
      if (!n || !ev || !(t0 > 0)) return null;
      const acts = ev.filter((q) => q[0] === 'cardPlayed' && q[1] === 0 && t0 + Number(q[3]) >= n.t0).length;
      const p = presses(n);
      return acts >= 3 && acts > p + 2 ? { v: `${acts} cards, ${p} presses`, lim: p + 2 } : null;
    } },
  // SUSPICIOUS. After the turn comes round (turnAdvanced to the player) a person has to look at the pile and the hand
  // and tap a card: the middle think time under 0.25 s over 12+ plays looks like a script.
  { id: 'uno-instant-plays', proven: false, text: 'cards played faster than a person can read the pile',
    check(e, { x }) {
      const ev = events(x);
      if (!ev) return null;
      const gaps = [];
      let turnAt = null;
      for (const q of ev) {
        if (q[0] === 'turnAdvanced') turnAt = q[1] === 0 ? Number(q[3]) : null;
        else if (q[0] === 'cardDrawn' && q[1] === 0) turnAt = null;      // a draw first: the next tap is not a fresh read
        else if (q[0] === 'cardPlayed' && q[1] === 0) { if (turnAt != null) gaps.push(Number(q[3]) - turnAt); turnAt = null; }
      }
      if (gaps.length < 12) return null;
      const md = median(gaps);
      return md < 250 ? { v: `${gaps.length} plays, ${md} ms (middle value)`, lim: 250 } : null;
    } },
];
