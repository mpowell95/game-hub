// js/trip-wires/boggle.js - Boggle's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). The older rule (boggle-word-not-on-board,
// js/integrity.js) already checks every found word traces on the dice; these add to it.
//
// What the log holds (boggle/js/ui.js `_playLog`): `faces`, `found` = [word, points] (saved with the round, so a resumed
// round carries the earlier ones), `ev` = every word submitted on THIS screen since the board was dealt or picked up,
// [word, v valid | i not a word | d already found, ms] (`_bgNote`, never saved, at most 300), `res` 1 = the round already
// had words when this screen's list began, `solved` = how many words the board holds.

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const evOf = (x) => (x && Array.isArray(x.ev) && x.ev.length < 300 ? x.ev.filter(Array.isArray) : null);
// A live room's leave is ARMED with its log and recorded later, maybe after a reload (js/live-leave.js): its touch log
// belongs to another visit, so only a round recorded as it ended ('over') or given up ('quit') is judged against touches.
const live = (x) => x && (x.end === 'over' || x.end === 'quit');

export default [
  {
    // A word is `onSubmitWord`: the end of a swipe over the dice (one touch), or the Submit button after tapping dice (one
    // press at least), or Enter. A round makes no result until it ends.
    id: 'boggle-words-without-presses',
    text: 'more words submitted than real touches',
    proven: true,
    check(e, ctx) {
      const ev = evOf(ctx.x), p = presses(ctx.n);
      if (!ev || p == null || e.f !== 'recordBoggle' || !live(ctx.x)) return null;
      return ev.length > p ? { v: `${ev.length} words, ${p} touches`, lim: p } : null;
    },
  },
  {
    // A word joins `_found` only in `onSubmitWord`, right after `_bgNote(word, 'v')`. On a round with no earlier words
    // (`res` 0) every found word is in this screen's list as valid.
    id: 'boggle-found-not-submitted',
    text: 'words counted that were never submitted',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, ev = evOf(x);
      if (!ev || e.f !== 'recordBoggle' || (x.res | 0) !== 0 || !Array.isArray(x.found)) return null;
      const got = new Set(ev.filter((q) => q[1] === 'v').map((q) => String(q[0])));
      const miss = x.found.map((q) => String(Array.isArray(q) ? q[0] : q)).filter((w) => !got.has(w));
      return miss.length ? { v: `${miss.length} of ${x.found.length} never submitted (${miss.slice(0, 3).join(', ')})`, lim: 0 } : null;
    },
  },
  {
    // A word is a swipe across the dice. Over every real round to 2026-11-25 the middle gap between valid words was never
    // under 1.3 s, and no two came under 630 ms apart. Ten or more under 600 ms apart (middle gap) is a machine.
    id: 'boggle-machine-pace',
    text: 'words submitted faster than a finger can trace them',
    proven: false,
    check(e, ctx) {
      const ev = evOf(ctx.x);
      if (!ev || e.f !== 'recordBoggle') return null;
      const t = ev.filter((q) => q[1] === 'v').map((q) => Number(q[2]));
      if (t.length < 10) return null;
      const gaps = t.slice(1).map((v, k) => v - t[k]).sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      return med < 600 ? { v: `${t.length} words, ${med} ms apart (middle value)`, lim: 600 } : null;
    },
  },
  {
    // A solver lists the board's words; a person tries words that are not words. Every real round with 11 or more words
    // had at least 6 refused. Twenty or more valid words with none refused, or in A to Z order, is a word list.
    id: 'boggle-word-list',
    text: 'twenty words or more with none refused, or in A to Z order',
    proven: false,
    check(e, ctx) {
      const ev = evOf(ctx.x);
      if (!ev || e.f !== 'recordBoggle') return null;
      const v = ev.filter((q) => q[1] === 'v').map((q) => String(q[0]));
      if (v.length < 20) return null;
      let up = 0;
      for (let k = 1; k < v.length; k++) if (v[k] > v[k - 1]) up++;
      const inv = ev.filter((q) => q[1] === 'i').length, f = up / (v.length - 1);
      if (inv === 0) return { v: `${v.length} words, none refused`, lim: 0 };
      return f >= 0.9 ? { v: `${v.length} words, ${Math.round(f * 100)}% in A to Z order`, lim: 0.9 } : null;
    },
  },
];
