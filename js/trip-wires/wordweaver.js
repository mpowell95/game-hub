// js/trip-wires/wordweaver.js - Word Weaver's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM,
// no network, no imports from the game's screen code (the server copies this file).
//
// What the log holds (word-weaver/js/ui.js `_wwLog`): `found` = the level's grid words found (saved, so a resumed level
// carries the earlier ones), `tried` = every word judged on THIS screen since the level opened, 'WORD:<kind>:<t>' (`_wwNote`,
// never saved, at most 600): g grid, f found already, e extra, ef extra found already, b bad, s short, c covered (filled by
// its crossings or a hint, no swipe), and from 2026-11-25 ':h:<t>' a hint or bought letter (a recorder runs there). From
// 2026-11-25 also `pre` (grid words already found when the level opened), `order` (the level's own word order) and
// `tu: 'ms'` (t in ms; seconds before).

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const RESULTS = new Set(['recordWordWeaver', 'recordWordWeaverDaily']);
const triedOf = (x) => {
  if (!x || !Array.isArray(x.tried) || x.tried.length >= 600) return null;
  return x.tried.map((s) => { const p = String(s).split(':'); return { w: p[0], k: p[1] || '', t: Number(p[2]) }; });
};
const SUBMIT = (q) => q.k !== 'c' && q.k !== 'h';

export default [
  {
    // Every judged word except 'c' is `_resolve` from `_submitSel`: a swipe's pointerup on the wheel (one touch) or Enter
    // (one key). A hint or a bought letter runs a recorder (recordWordWeaverHint / Buy), which starts the touch log again;
    // only lines after the last ':h:' count. Logs before 2026-11-25 have no hint lines, so a hinted level is skipped there.
    id: 'wordweaver-words-without-presses',
    text: 'more words swiped than real touches',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n), tr = triedOf(x);
      if (p == null || !tr || !RESULTS.has(String(e.f))) return null;
      let k = tr.length - 1;
      while (k >= 0 && tr[k].k !== 'h') k--;
      if (k < 0 && x.tu !== 'ms' && ((x.hints | 0) > 0 || (x.free | 0) > 0)) return null;
      const acts = tr.slice(k + 1).filter(SUBMIT).length;
      return acts > p ? { v: `${acts} words, ${p} touches`, lim: p } : null;
    },
  },
  {
    // A grid word joins `found` only in applyWord (word-weaver/js/engine.js, after `_resolve` logs it as 'g') or
    // claimCovered (logged as 'c' at every call in ui.js). On a level opened with nothing found (`pre` 0, from 2026-11-25)
    // every found word must be in this screen's log.
    id: 'wordweaver-found-without-trying',
    text: 'grid words found that were never swiped',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, tr = triedOf(x);
      if (!tr || !RESULTS.has(String(e.f)) || x.pre == null || Number(x.pre) !== 0 || !Array.isArray(x.found)) return null;
      const got = new Set(tr.filter((q) => q.k === 'g' || q.k === 'c').map((q) => q.w));
      const miss = x.found.map(String).filter((w) => !got.has(w));
      return miss.length ? { v: `${miss.length} of ${x.found.length} never swiped (${miss.slice(0, 3).join(', ')})`, lim: 0 } : null;
    },
  },
  {
    // A swipe across a wheel takes a person well over half a second, and almost everyone tries a wrong word now and then.
    // Five or more grid words in a row under 800 ms apart (middle gap) with not one miss is a machine. ms logs only.
    id: 'wordweaver-flawless-fast',
    text: 'every word right, faster than a finger can swipe',
    proven: false,
    check(e, ctx) {
      const x = ctx.x, tr = triedOf(x);
      if (!tr || !RESULTS.has(String(e.f)) || x.tu !== 'ms') return null;
      const sub = tr.filter(SUBMIT);
      const g = sub.filter((q) => q.k === 'g');
      if (g.length < 5 || sub.some((q) => q.k === 'b' || q.k === 's')) return null;
      const gaps = g.slice(1).map((q, k) => q.t - g[k].t).sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      return med < 800 ? { v: `${g.length} words, no miss, ${med} ms apart (middle value)`, lim: 800 } : null;
    },
  },
  {
    // The level's words are stored in the data's own order (`level.w`, not by length or place). A person finds them in
    // their own order; a script reading the level types them in the stored one.
    id: 'wordweaver-level-order',
    text: 'grid words found in the order they are stored in the puzzle',
    proven: false,
    check(e, ctx) {
      const x = ctx.x, tr = triedOf(x);
      if (!tr || !RESULTS.has(String(e.f)) || !Array.isArray(x.order)) return null;
      const g = tr.filter((q) => q.k === 'g').map((q) => q.w);
      if (g.length < 5) return null;
      const want = x.order.map(String).filter((w) => g.includes(w));
      return want.length === g.length && want.every((w, k) => w === g[k]) ? { v: `${g.length} words in the stored order`, lim: 5 } : null;
    },
  },
];
