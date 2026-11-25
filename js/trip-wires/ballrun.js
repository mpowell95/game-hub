// js/trip-wires/ballrun.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'ballrun-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (ball-run/js/ui.js trySyncRunEntry, v 2, 2026-11-25): the run's numbers (runDetail: m, ms, obst,
// tiers, topSpd, orbs, splits, jumps, ...), seed, and sim.js RunLog.out(): steps, tSteps (steps steered by a finger
// drag), kSteps (by an arrow key), steerN, wallMs (real time first step to last), steer ('<ms><L|R|l|r|0>'), pass
// ('<ms><o|s|j|b><lateral x10>' every point), cut. Plays before 2026-11-25 have x = { hi } and are never judged here
// (the older rule ballrun-score-without-touch in js/integrity.js covers them).
const SIM_MS = 1000 / 60;            // ball-run/js/config.js SIM_HZ 60: one sim step = 1/60 s
const ARROWS = /^Arrow(Left|Right)$/; // ball-run/js/input.js: only these two keys steer

function tokens(s) {
  const out = [];
  let t = 0;
  for (const tok of String(s || '').split(' ')) {
    const m = /^(\d+)([A-Za-z0])(-?\d*)$/.exec(tok);
    if (!m) continue;
    t += Number(m[1]);
    out.push({ ms: t, c: m[2] });
  }
  return out;
}
const isV2 = (x) => x && x.v === 2 && Number.isFinite(Number(x.steps));
const cut = (n) => !n || n.cut > 0;

export default [
  {
    // sim.js: the score moves only in updateScore (+1 an obstacle row, stats.obst; +1 a split, stats.splits),
    // stepAirborne (+1 a landed jump, stats.jumps) and collectPickup (+orbValue 1 an orb, orbsCollected); RunLog logs
    // each as a `pass` token. So the recorded score cannot pass obst + splits + jumps + orbs, nor the pass tokens.
    // Not judged when the admin Classic-equivalent score is on (eq: ui.js classicScoringOn).
    id: 'ballrun-score-not-earned', proven: true,
    text: 'a Ball Run score the run never scored',
    check(e, { x, score }) {
      if (!isV2(x) || x.eq || score == null) return null;
      const sum = ['obst', 'splits', 'jumps', 'orbs'].reduce((s, k) => s + (Number(x[k]) || 0), 0);
      if (x.obst != null && score > sum) return { v: `${score} points, the run scored ${sum}`, lim: sum };
      const passed = tokens(x.pass).length;
      if (!(x.cut && x.cut.pass) && score > passed) return { v: `${score} points, ${passed} logged`, lim: passed };
      return null;
    },
  },
  {
    // input.js: a finger steers only between its pointerdown and pointerup on the game (dragging), by pointermove.
    // js/play-log-queue.js logs every down and a move every 50 ms while pressed, so a run steered by a finger has
    // at least one down and one move in its touch log.
    id: 'ballrun-touch-steer-without-touch', proven: true,
    text: 'steered by a finger that never touched the screen',
    check(e, { x, n }) {
      if (!isV2(x) || cut(n) || !(Number(x.tSteps) > 0)) return null;
      return n.downs === 0 || n.moves === 0 ? { v: `${x.tSteps} finger-steered steps, ${n.downs} touches, ${n.moves} moves`, lim: 1 } : null;
    },
  },
  {
    // input.js: an arrow key steers only while held (keydown ArrowLeft / ArrowRight); play-log-queue.js logs every
    // keydown, so a run steered by a key has at least one ArrowLeft or ArrowRight press in its touch log.
    id: 'ballrun-key-steer-without-keys', proven: true,
    text: 'steered by arrow keys that were never pressed',
    check(e, { x, n }) {
      if (!isV2(x) || cut(n) || !(Number(x.kSteps) > 0)) return null;
      const arrows = n.ev.filter((q) => q.kind === 'k' && ARROWS.test(String(q.key))).length;
      return arrows === 0 ? { v: `${x.kSteps} key-steered steps, no arrow key pressed`, lim: 1 } : null;
    },
  },
  {
    // ui.js frame(): each sim step uses SIM_DT of real time from requestAnimationFrame's clock (a stall is clamped to
    // 0.25 s, at most 8 steps a frame), so the steps run cannot add up to more time than passed. 2% and 1 s spare.
    id: 'ballrun-faster-than-clock', proven: true,
    text: 'the run went faster than real time',
    check(e, { x }) {
      if (!isV2(x) || !(Number(x.wallMs) > 0)) return null;
      const simMs = Math.round(Number(x.steps) * SIM_MS), lim = Math.round(Number(x.wallMs) * 1.02 + 1000);
      return simMs > lim ? { v: `${simMs} ms of play in ${x.wallMs} ms`, lim } : null;
    },
  },
  {
    // Suspicious: 40+ changes of steer with near-identical gaps between them (a person's timing wanders; a script's
    // does not).
    id: 'ballrun-steer-like-clockwork', proven: false,
    text: 'steering changes timed like a machine',
    check(e, { x }) {
      if (!isV2(x)) return null;
      const t = tokens(x.steer).filter((q) => q.c !== '0').map((q) => q.ms);
      if (t.length < 41) return null;
      const gaps = t.slice(1).map((v, k) => v - t[k]);
      const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((s, v) => s + (v - mean) ** 2, 0) / gaps.length);
      return mean > 0 && sd / mean < 0.1 ? { v: `${gaps.length} steers, ${Math.round(mean)} ms apart, spread ${Math.round(sd)} ms`, lim: '10%' } : null;
    },
  },
];
