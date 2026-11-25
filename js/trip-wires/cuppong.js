// js/trip-wires/cuppong.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'cuppong-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (cup-pong/js/ui.js): vs the computer (_xlData) end, cfg, winner, racks, tally {throws, made, ...},
// throws [[side a = this player | b, power, aim, cupMade, bounced, outcome, cupsA, cupsB, events, reflown, sec]];
// solo (_xlSoloData) end, throws, cupsLeft, rows [[n, power, aim, outcome, cupMade, bounced, cupsBefore, sec]].
// js/integrity.js already has cuppong-more-made-than-thrown and cuppong-solo-under-10.
const CAP = 300;   // ui.js keeps at most 300 throws
const solo = (e, x) => (e.f === 'recordCupPongSolo' && x && Array.isArray(x.rows) && x.rows.length < CAP ? x.rows.filter(Array.isArray) : null);
const vsCpu = (e, x) => (e.f === 'recordCupPong' && x && Array.isArray(x.throws) && x.throws.length < CAP ? x.throws.filter(Array.isArray) : null);

export default [
  {
    // ui.js solo: each throw logs one row (_xlSolo) and adds one to this.throws, which the recorder is handed; a made
    // cup leaves the rack (so no cup is made twice), and a cleared rack has had every one of its cups made.
    id: 'cuppong-solo-not-its-throws', proven: true,
    text: 'a solo rack its throws do not add up to',
    check(e, { a, x }) {
      const r = solo(e, x);
      if (!r || !r.length) return null;
      const rec = Number(a && a[0]);
      if (Number.isFinite(rec) && rec !== r.length) return { v: `${rec} throws recorded, ${r.length} thrown`, lim: r.length };
      const made = r.filter((q) => q[3] === 'made'), ids = new Set(made.map((q) => q[4]));
      if (ids.size < made.length) return { v: `${made.length} cups made, ${ids.size} different`, lim: ids.size };
      const cups = Number(r[0][6]);
      return x.end === 'cleared' && Number.isFinite(cups) && made.length !== cups ? { v: `cleared with ${made.length} of ${cups} cups made`, lim: cups } : null;
    },
  },
  {
    // ui.js: the player's throw is a swipe (a pointerdown, a flick, a release); every throw is one row, so the
    // player's throws cannot outnumber the touches in the touch log.
    id: 'cuppong-throws-without-touch', proven: true,
    text: 'throws without a finger on the screen',
    check(e, { x, n }) {
      if (!n || n.cut > 0) return null;
      const r = solo(e, x), t = vsCpu(e, x);
      const mine = r ? r.length : t ? t.filter((q) => q[0] === 'a' && !q[9]).length : null;
      return mine != null && mine > n.downs ? { v: `${mine} throws, ${n.downs} touches`, lim: n.downs } : null;
    },
  },
  {
    // ui.js: every one of the player's throws vs the computer is a logged row and a count in the tally
    // (_tally.throws, the detail's `throws`), the same throw counted twice over.
    id: 'cuppong-tally-not-throws', proven: true,
    text: 'more throws counted than were thrown',
    check(e, { x, d }) {
      const t = vsCpu(e, x);
      if (!t) return null;
      const mine = t.filter((q) => q[0] === 'a').length;
      const told = Math.max(Number(x.tally && x.tally.throws) || 0, Number(d && d.throws) || 0);
      return told > mine ? { v: `${told} throws counted, ${mine} thrown`, lim: mine } : null;
    },
  },
  {
    // Suspicious: a solo rack cleared in exactly 10 throws, or 10 or more of the player's throws vs the computer and
    // every one in a cup (real racks 2026-11-16 to 11-24: 14 throws at best; matches: about 40% made).
    id: 'cuppong-every-throw-in', proven: false,
    text: 'every throw in a cup',
    check(e, { x }) {
      const r = solo(e, x);
      if (r) return x.end === 'cleared' && r.length === 10 && r.every((q) => q[3] === 'made') ? { v: 'a rack in 10 throws', lim: 10 } : null;
      const t = vsCpu(e, x);
      if (!t) return null;
      const mine = t.filter((q) => q[0] === 'a');
      return mine.length >= 10 && mine.every((q) => q[5] === 'made') ? { v: `${mine.length} throws, every one made`, lim: 10 } : null;
    },
  },
];
