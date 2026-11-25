// js/trip-wires/spellingbee.js - Spelling Bee's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no
// DOM, no network, no imports from the game's screen code (the server copies this file). Spelling Bee's own fair-play
// system (js/bee-fairplay.js over beeLog: copied days, log gaps) stays as it is; these judge the play log's Genius result
// with the touch log. The answers sat on `window` (`__sbTest.answers`) until 2026-11-24, so these look for a solver.
//
// What the log holds (spelling-bee/js/ui.js `_maybeRecord`, from 2026-11-25, on the Genius result): `words` = the day's
// words in the order found, `times.ts` = seconds after the first, and `sess` = every word submitted on THIS screen since its
// last recorded result: { t0, ev: [[word, 'ok' | 'bonus' | why refused, ms]], cut } (never saved).

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const RESULTS = new Set(['recordResult', 'recordSpellingBeeGenius']);
const sessOf = (x) => (x && x.sess && Array.isArray(x.sess.ev) && !(x.sess.cut | 0) ? x.sess.ev.filter(Array.isArray) : null);

export default [
  {
    // A word is `submit()`, from the Enter button or the Enter key, after its letters (each a tap on a cell or a key). Each
    // submitted word needs at least its Enter. The touch log starts again at every result; `sess` starts again with it
    // (countDays recording the day, the Genius result itself).
    id: 'spellingbee-words-without-presses',
    text: 'more words entered than real touches and key presses',
    proven: true,
    check(e, ctx) {
      const s = sessOf(ctx.x), p = presses(ctx.n);
      if (!s || p == null || !RESULTS.has(String(e.f))) return null;
      return s.length > p ? { v: `${s.length} words, ${p} presses`, lim: p } : null;
    },
  },
  {
    // A word takes its letters and Enter: a person needs at least a letter's tap per letter. Fewer presses than the letters
    // of the words entered here is impossible by hand; a script typing into the screen's state is not.
    id: 'spellingbee-letters-without-presses',
    text: 'more letters entered than real touches and key presses',
    proven: false,
    check(e, ctx) {
      const s = sessOf(ctx.x), p = presses(ctx.n);
      if (!s || p == null || !RESULTS.has(String(e.f)) || s.length < 5) return null;
      const need = s.reduce((t, q) => t + String(q[0] || '').length + 1, 0);
      return need > p ? { v: `${s.length} words need ${need} presses, ${p} made`, lim: need } : null;
    },
  },
  {
    // People find words as they see them. The answer list is sorted A to Z; a solver walks it. Over every real Genius and
    // Queen to 2026-11-25 (24 days) at most 73% of the steps from one word to the next went up the alphabet.
    id: 'spellingbee-alphabetical',
    text: 'the day\'s words found in A to Z order',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !RESULTS.has(String(e.f)) || !Array.isArray(x.words) || x.words.length < 15) return null;
      const w = x.words.map(String);
      let up = 0;
      for (let k = 1; k < w.length; k++) if (w[k] > w[k - 1]) up++;
      const f = up / (w.length - 1);
      return f >= 0.9 ? { v: `${w.length} words, ${Math.round(f * 100)}% in A to Z order`, lim: 0.9 } : null;
    },
  },
  {
    // Fifteen or more words on this screen with not one refused, under 2 s apart (middle gap): people mistype, try words
    // the puzzle does not take, and stop to look. Every real day's middle gap was 4 s or more.
    id: 'spellingbee-flawless-fast',
    text: 'words entered with no miss, faster than a person finds them',
    proven: false,
    check(e, ctx) {
      const s = sessOf(ctx.x);
      if (!s || !RESULTS.has(String(e.f)) || s.length < 15) return null;
      if (s.some((q) => q[1] !== 'ok' && q[1] !== 'bonus')) return null;
      const t = s.map((q) => Number(q[2]));
      const gaps = t.slice(1).map((v, k) => v - t[k]).sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      return med < 2000 ? { v: `${s.length} words, no miss, ${med} ms apart (middle value)`, lim: 2000 } : null;
    },
  },
];
