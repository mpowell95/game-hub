// js/trip-wires/wayout.js - Arrow Maze's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). The older rule (arrowmaze-machine-taps,
// js/integrity.js) already alerts on taps under 120 ms apart; these add to it.
//
// What the log holds (way-out/js/ui.js): `taps` = every arrow tapped on THIS board object, '<id>g@<ms>' (it went out) or
// '<id>b@<ms>' (it bumped), 'h<id>@<ms>' a hint shown (`_tn`, `_hn`, kept on the board object, never saved, at most 1,500);
// `pre` (from 2026-11-25) = arrows already gone when the board was set up (`_resetBoard`, a resumed level).

/** Real presses in the touch log (touch downs and key presses a person made), or null when it is missing or cut. */
const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const TAP = /^(\d+)([gb])@(\d+)/;
const taps = (x) => (x && Array.isArray(x.taps) ? x.taps.map((s) => TAP.exec(String(s))).filter(Boolean) : null);
const RESULTS = new Set(['recordWayOut', 'recordWayOutReplay', 'recordWayOutRush']);

export default [
  {
    // Every logged tap is `_send` (way-out/js/ui.js), reached only from the canvas pointerdown handler (one touch, one arrow)
    // or the keyboard's Enter/Space on a focused arrow (one key). The touch log covers everything since the last result; a
    // hint calls noteWayOutSlips, a recorder, which starts it again, so a level with hints is not judged. A Rush run calls
    // no recorder until it ends. A saved Rush run settled later (`saved: 1`) carries no taps.
    id: 'wayout-taps-without-presses',
    text: 'more arrows tapped than real touches',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, p = presses(ctx.n);
      if (p == null || !x || !RESULTS.has(String(e.f)) || x.saved) return null;
      const t = taps(x);
      if (!t || !t.length || x.taps.length >= 1500) return null;
      if (e.f !== 'recordWayOutRush' && (x.hints | 0) > 0) return null;
      return t.length > p ? { v: `${t.length} arrows tapped, ${p} touches`, lim: p } : null;
    },
  },
  {
    // An arrow leaves the board only in `_send` (this.gone[id] = true, after the `_tn(id, true)` line), or was already gone
    // in the save the board was set up from (`_resetBoard`, logged as `pre`). A level counts only when every arrow is gone,
    // so the distinct arrows that went out plus `pre` must cover every arrow. Plays before 2026-11-25 carry no `pre`.
    id: 'wayout-cleared-without-taps',
    text: 'a level cleared with arrows that were never tapped out',
    proven: true,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || e.f !== 'recordWayOut' || !Number.isFinite(Number(x.pre)) || !Array.isArray(x.taps) || x.taps.length >= 1500) return null;
      const arrows = Number(x.arrows) || 0;
      if (arrows <= 0) return null;
      const out = new Set(taps(x).filter((m) => m[2] === 'g').map((m) => m[1]));
      const have = out.size + Number(x.pre);
      return have < arrows ? { v: `${out.size} tapped out + ${x.pre} already gone, ${arrows} arrows`, lim: arrows } : null;
    },
  },
  {
    // A person's taps come in an uneven rhythm: over every real play with taps (152, to 2026-11-25) the spread of the gaps
    // (standard deviation over mean) was never under 0.56. A script firing on a timer is nearly even.
    id: 'wayout-even-rhythm',
    text: 'arrows tapped in an almost perfectly even rhythm',
    proven: false,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !RESULTS.has(String(e.f))) return null;
      const t = taps(x);
      if (!t || t.length < 20) return null;
      const ms = t.map((m) => Number(m[3]));
      const gaps = ms.slice(1).map((v, k) => v - ms[k]).filter((g) => g >= 0);
      if (gaps.length < 19) return null;
      const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      if (!(mean > 0)) return null;
      const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
      const cv = sd / mean;
      return cv < 0.25 ? { v: `${t.length} taps, spread ${cv.toFixed(2)}`, lim: 0.25 } : null;
    },
  },
];
