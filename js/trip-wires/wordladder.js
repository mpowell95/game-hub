// js/trip-wires/wordladder.js - Word Ladder's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM,
// no network, no imports from the game's screen code (the server copies this file). The older rules (wordladder-under-par,
// wordladder-bad-step on the level's own path, js/integrity.js) stay; these add to them.
//
// What the log holds (word-ladder/js/ui.js `playData`): `chain` = the ladder as played, `start`/`target`, `moves`, and
// `seq` = every line of the attempt with its ms since the attempt began (`_wlNote`): 'p<i>' a letter picked, 'k:'/'K:' a
// key (on-screen / keyboard), 'w:' a word stepped to, 'R:'/'r:' a redo, 'h:' a hint, 'u:' undo, 'x:'/'o:' refused, 'B:' the
// attempt opened again (a resume: the seq is SAVED with the attempt), `cut` = lines dropped from the front. Logs before
// 2026-11-19 (no `wall`) held only words, in seconds.

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const RESULTS = new Set(['recordWordLadder', 'recordWordLadderDaily']);
const fullLog = (x) => x && Array.isArray(x.seq) && Number.isFinite(Number(x.wall)) && (x.cut | 0) === 0;
const oneLetter = (p, q) => {
  if (typeof p !== 'string' || typeof q !== 'string' || p.length !== q.length) return false;
  let d = 0;
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) d++;
  return d === 1;
};

export default [
  {
    // A key line ('k:'/'K:') is `_letter`, called from an on-screen key's tap or a physical key; a pick ('p<i>') is a tap on
    // a letter or an arrow key. Each needs its own press. The touch log starts again at every result and at a hint (it calls
    // recordWordLadderHint) and at a reload; 'B:' (the attempt opened again) and 'h' lines mark those, so only lines after
    // the last of them count.
    id: 'wordladder-keys-without-presses',
    text: 'more letters typed than real touches and key presses',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (p == null || !RESULTS.has(String(e.f)) || !fullLog(x)) return null;
      const s = x.seq.map(String);
      let k = s.length - 1;
      while (k >= 0 && !/^(B:|h)/.test(s[k])) k--;
      const acts = s.slice(k + 1).filter((q) => /^(k:|K:|p\d)/.test(q)).length;
      return acts > p ? { v: `${acts} keys and picks, ${p} touches`, lim: p } : null;
    },
  },
  {
    // A typed step ('w:', or 'R:' the undone word typed again) is `_step(next, 'word')`, called only from `_letter`, which
    // logs its key line first. The whole attempt's seq is kept (saved across resumes), so on an uncut log every typed step
    // has a key line before it.
    id: 'wordladder-word-without-key',
    text: 'a ladder word that no key typed',
    proven: true,
    check(e, ctx) {
      const x = ctx.x;
      if (!RESULTS.has(String(e.f)) || !fullLog(x)) return null;
      let keys = 0;
      for (const q of x.seq.map(String)) {
        if (/^(k:|K:)/.test(q)) keys++;
        else if (/^(w:|R:)/.test(q)) { if (keys <= 0) return { v: `${q.split('@')[0]} with no key before it` }; keys--; }
      }
      return null;
    },
  },
  {
    // `_step` adds one word to `chain`, always a word one letter from the last (E.checkMove, or a hint/redo of one); a solve
    // ends on the target, and Moves never falls below the steps on the ladder (a redo sets it to at least chain - 1).
    id: 'wordladder-chain-broken',
    text: 'a solved ladder that does not join the start to the target one letter at a time',
    proven: true,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !RESULTS.has(String(e.f)) || !Array.isArray(x.chain) || !x.start || !x.target) return null;
      const ch = x.chain.map((w) => String(w).toUpperCase());
      if (ch[0] !== String(x.start).toUpperCase()) return { v: `starts at ${ch[0]}, not ${x.start}` };
      if (ch[ch.length - 1] !== String(x.target).toUpperCase()) return { v: `ends at ${ch[ch.length - 1]}, not ${x.target}` };
      for (let k = 1; k < ch.length; k++) if (!oneLetter(ch[k - 1], ch[k])) return { v: `${ch[k - 1]} to ${ch[k]}` };
      if (Number.isFinite(Number(x.moves)) && Number(x.moves) < ch.length - 1) return { v: `${x.moves} moves, ${ch.length - 1} steps`, lim: ch.length - 1 };
      return null;
    },
  },
  {
    // Every real ladder so far (182 logs to 2026-11-25): the middle gap between key presses was never under 1.4 s, as a
    // person reads the ladder, picks a letter and finds the key. Six or more under 400 ms apart is a machine.
    id: 'wordladder-machine-typing',
    text: 'letters typed faster than a person reads the ladder',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!RESULTS.has(String(e.f)) || !fullLog(x)) return null;
      const t = x.seq.map(String).filter((q) => /^(k:|K:)/.test(q)).map((q) => Number(q.split('@').pop())).filter(Number.isFinite);
      if (t.length < 6) return null;
      const gaps = t.slice(1).map((v, k) => v - t[k]).sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      return med < 400 ? { v: `${t.length} keys, ${med} ms apart (middle value)`, lim: 400 } : null;
    },
  },
];
