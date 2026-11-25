// js/trip-wires/parchis.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'parchis-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
//
// What they read: the result __ghStats.record('parchis', diff, won, ...) (a = ['parchis', diff, won]) and its private
// log x (parchis/index.html `parchisPrivate`, a hub-side patch of the built file): x.mode ('american' two dice |
// 'spanish' one die), x.vs ('cpu' | 'local'), x.me (the player's colour), x.humans, x.moves = every line in order:
//   "<C>r56" C rolled 5 and 6 (A amarillo, Z azul, R rojo, V verde)    "<C>-" no move   "<C>b-" bonus lost
//   "<C>!<pawn>" three sixes / doubles   "<pawn>><zone><pos>+<steps>x<captured>" a move (pawn = colour letter + 1..4)
// and from 2026-11-25 each line ends "@<ms since x.t0>" and x.t0 is the epoch ms.

const LETTER = { amarillo: 'A', azul: 'Z', rojo: 'R', verde: 'V' };
const ROLL = /^([AZRV])r(\d+)$/, MOVE = /^([AZRV])\d>[tpm]\d*(?:\+(\d+))?(?:x\S*)?$/;
const split = (line) => { const s = String(line), k = s.lastIndexOf('@'); return k > 0 && /^\d+$/.test(s.slice(k + 1)) ? [s.slice(0, k), Number(s.slice(k + 1))] : [s, null]; };
const lines = (x) => (x && Array.isArray(x.moves) && !x.movesCut ? x.moves.map(split) : null);
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
const presses = (n) => n.ev.filter((q) => (q.kind === 'd' || q.kind === 'k') && !q.fake).length + (n.cut | 0);

/** The first logged line the dice and the turn order cannot produce, or null. index.html rollForMode rolls one die
 *  (Spanish) or two (American), each 1..6; a move belongs to whoever rolled last (bonus moves included), and moves
 *  `amount` = one die, both dice (entering on a sum of 5), a Spanish 6 counted as 7 (every pawn out), or a bonus of
 *  10 (reaching home) or 20 (a capture). */
export function parchisBadLine(x) {
  const L = lines(x);
  if (!L) return null;
  const want = x.mode === 'spanish' ? 1 : x.mode === 'american' ? 2 : 0;
  let who = null, dice = null;
  for (const [s] of L) {
    const r = ROLL.exec(s);
    if (r) {
      who = r[1]; dice = r[2].split('').map(Number);
      if ((want && dice.length !== want) || dice.some((d) => d < 1 || d > 6)) return `${s}: not a roll of ${want || '1 or 2'} dice`;
      continue;
    }
    const m = MOVE.exec(s);
    if (!m) continue;
    if (who != null && m[1] !== who) return `${s}: moved on ${who}'s roll`;
    if (m[2] == null || !dice) continue;
    const st = Number(m[2]), sum = dice.reduce((t, d) => t + d, 0);
    const ok = dice.includes(st) || st === sum || st === 10 || st === 20 || (st === 7 && dice.includes(6) && x.mode === 'spanish');
    if (!ok) return `${s}: ${st} steps on a roll of ${dice.join('+')}`;
  }
  return null;
}

export default [
  // PROVEN. parchis/index.html: rollForMode makes the only dice, afterRoll logs them, and Engine.legalMoves only offers
  // moves of the roller's pawns by a die, the two dice together (a sum-of-5 entry), a Spanish 6-as-7, or a 10 / 20
  // bonus. Replayed over all 2,445 real moves (six games) with no other step count.
  { id: 'parchis-move-not-on-dice', proven: true, text: 'a move or a roll the dice cannot give',
    check(e, { x }) {
      if (!x || !Array.isArray(x.moves)) return null;
      const bad = parchisBadLine(x);
      return bad ? { v: bad, lim: '' } : null;
    } },
  // PROVEN. index.html onRollTap: the player's roll happens only from a tap on the dice (the computer's from its own
  // timer); moves can be automatic (a single choice), rolls never. So the player's rolls while the touch log ran cannot
  // outnumber its real presses (2 spare). Only games against the computer with one person.
  { id: 'parchis-rolls-without-taps', proven: true, text: 'more dice rolls than real taps',
    check(e, { x, n }) {
      const L = x && Array.isArray(x.moves) ? x.moves.map(split) : null, t0 = Number(x && x.t0), me = LETTER[x && x.me];
      if (!n || !L || !(t0 > 0) || !me || x.vs !== 'cpu' || (Array.isArray(x.humans) && x.humans.length !== 1)) return null;
      const acts = L.filter(([s, t]) => t != null && s.charAt(0) === me && ROLL.test(s) && t0 + t >= n.t0).length;
      const p = presses(n);
      return acts >= 3 && acts > p + 2 ? { v: `${acts} rolls, ${p} presses`, lim: p + 2 } : null;
    } },
  // SUSPICIOUS. When the turn comes back a person sees it is theirs and taps the dice: the middle time from the
  // previous player's last line to the player's roll under 0.25 s over 20+ turns looks like a script.
  { id: 'parchis-instant-rolls', proven: false, text: 'dice rolled faster than a person can see the turn',
    check(e, { x }) {
      const L = x && Array.isArray(x.moves) ? x.moves.map(split) : null, me = LETTER[x && x.me];
      if (!L || !me || x.vs !== 'cpu') return null;
      const gaps = [];
      for (let k = 1; k < L.length; k++) {
        const [s, t] = L[k], [p, tp] = L[k - 1];
        if (t != null && tp != null && s.charAt(0) === me && ROLL.test(s) && p.charAt(0) !== me) gaps.push(t - tp);
      }
      if (gaps.length < 20) return null;
      const md = median(gaps);
      return md < 250 ? { v: `${gaps.length} rolls, ${md} ms (middle value)`, lim: 250 } : null;
    } },
];
