// js/trip-wires/contexto.js - Contexto's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). The older Contexto checks
// (contexto-far-jump, contexto-solved-elsewhere, contexto-hints-not-counted, js/integrity.js checkContextoWin) stay; these
// add to them. The answer sat on `window` until 2026-11-24 (test seams), so these look for a looked-up answer.
//
// What the log holds (contexto/js/ui.js `_recordFinished`, from 2026-11-25): `guesses`/`hints` as counted, `all` = the
// puzzle's guesses in order [word, hint 0|1], and `sess` = every guess, hint and give-up made on THIS screen since it
// opened that puzzle: { t0, ev: [[g guess | h hint | q give-up, word, rank | 'unknown' | 'again', ms]], cut } (`_log`, never saved).

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const sessOf = (x) => (x && x.sess && Array.isArray(x.sess.ev) && !(x.sess.cut | 0) ? x.sess.ev.filter(Array.isArray) : null);
const won = (e, a) => e.f === 'recordContexto' && Array.isArray(a) && a[1] === true;

export default [
  {
    // A guess is `submitGuess`, from the guess box's Enter or its button (one press each, after typing); a hint is the Hint
    // button, a give-up its button. The puzzle makes no result until it ends, and a new screen starts a new `sess`.
    id: 'contexto-guesses-without-presses',
    text: 'more guesses than real touches and key presses',
    proven: true,
    check(e, ctx) {
      const s = sessOf(ctx.x), p = presses(ctx.n);
      if (!s || p == null || e.f !== 'recordContexto') return null;
      return s.length > p ? { v: `${s.length} guesses and hints, ${p} presses`, lim: p } : null;
    },
  },
  {
    // A person reads where the last word landed, thinks of a word and types it: over 1,937 real guesses (to 2026-11-25) none
    // came under 785 ms after the one before, and no winning word under 1.4 s. The answer typed under a second after the
    // guess before it was not thought of.
    id: 'contexto-answer-typed-at-once',
    text: 'the answer typed within a second of the guess before it',
    proven: false,
    check(e, ctx) {
      const s = sessOf(ctx.x);
      if (!s || !won(e, ctx.a) || s.length < 2) return null;
      const last = s[s.length - 1], prev = s[s.length - 2];
      if (last[0] !== 'g' || String(last[2]) !== '1') return null;
      const gap = Number(last[3]) - Number(prev[3]);
      return gap >= 0 && gap < 1000 ? { v: `answer ${gap} ms after the guess before`, lim: 1000 } : null;
    },
  },
  {
    // A win in 3 typed guesses or fewer with no hint: the puzzles have tens of thousands of words, and no real win to
    // 2026-11-25 took fewer than 6.
    id: 'contexto-lucky-solve',
    text: 'solved in 3 guesses or fewer with no hint',
    proven: false,
    check(e, ctx) {
      const a = ctx.a;
      if (!won(e, a)) return null;
      const ex = a[2] && typeof a[2] === 'object' ? a[2] : {};
      const g = Number(ex.guesses), h = Number(ex.hints) || 0;
      return Number.isFinite(g) && g > 0 && g <= 3 && h === 0 ? { v: `${g} guesses, no hint`, lim: 3 } : null;
    },
  },
  {
    // Ten or more guesses on this screen under a second apart (middle gap): a person cannot read, think and type that fast.
    id: 'contexto-machine-pace',
    text: 'guesses typed faster than a person can read and think',
    proven: false,
    check(e, ctx) {
      const s = sessOf(ctx.x);
      if (!s || e.f !== 'recordContexto') return null;
      const t = s.filter((q) => q[0] === 'g').map((q) => Number(q[3]));
      if (t.length < 10) return null;
      const gaps = t.slice(1).map((v, k) => v - t[k]).sort((p, q) => p - q);
      const med = gaps[gaps.length >> 1];
      return med < 1000 ? { v: `${t.length} guesses, ${med} ms apart (middle value)`, lim: 1000 } : null;
    },
  },
];
