// js/trip-wires/brickblitz.js - Brick Breaker's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no
// DOM, no network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'brick-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (brick-blitz/js/game.js privateLog + ui.js end): diff, endless, stage, lives (left), secs, pw
// (capsules caught), ufo [[points, by ball 1|0, time]], lost [[stage, time, score]] (each ball lost), clr [[stage, time,
// lives, score]] (each stage cleared, before its bonus), bricks, combo; from 2026-11-25 score, bp (points from bricks),
// go [[time, p|m]] (every launch: p = the player, m = a multi-ball capsule), ph (paddle hits).
const UFO_VALUES = [300, 500, 1000];           // brick-blitz/js/game.js UFO_VALUES
const BRICK_MAX = 160 * 12 + 250;             // game.js hitBrick: (two-hit 160) x combo (at most 12) + alien bonus 250
const LIVES = { easy: 5, medium: 3, hard: 3 }; // game.js DIFF_TUNING lives; no capsule gives a life
const arr = (v) => (Array.isArray(v) ? v : null);

export default [
  {
    // game.js: the score moves only in hitBrick (pts), hitUfo (v) and stageClear (lives x 500). From 2026-11-25 the
    // log adds the brick points (bp), so the score must be exactly bp + saucers + clear bonuses; before that, at
    // most every brick at the best price.
    id: 'brick-score-not-earned', proven: true,
    text: 'a Brick Breaker score the bricks, saucers and clears do not add up to',
    check(e, { x, score }) {
      if (!x || score == null || !arr(x.ufo) || !arr(x.clr) || x.ufo.length >= 40 || x.clr.length >= 60) return null;
      const ufo = x.ufo.reduce((s, q) => s + (Number(q && q[0]) || 0), 0);
      const bonus = x.clr.reduce((s, q) => s + (Number(q && q[2]) || 0) * 500, 0);
      if (Number.isFinite(Number(x.bp)) && x.go) {
        const want = Number(x.bp) + ufo + bonus;
        return score !== want ? { v: `${score} points, the run earned ${want}`, lim: want } : null;
      }
      if (!Number.isFinite(Number(x.bricks))) return null;
      const most = Number(x.bricks) * BRICK_MAX + ufo + bonus;
      return score > most ? { v: `${score} points from ${x.bricks} bricks`, lim: most } : null;
    },
  },
  {
    // ui.js: the player launches the ball only by a mouse press (_pointerDown), a tap (pointerup after a down) or a
    // key (_keyDown); each press launches once (game.js launch() needs the serve). So the player's launches cannot
    // outnumber the presses and key presses in the touch log.
    id: 'brick-launch-without-press', proven: true,
    text: 'balls launched without a tap or key press',
    check(e, { x, n }) {
      if (!x || !arr(x.go) || x.go.length >= 300 || !n || n.cut > 0) return null;
      const launches = x.go.filter((q) => Array.isArray(q) && q[1] === 'p').length, presses = n.downs + n.keys;
      return launches > presses ? { v: `${launches} launches, ${presses} presses`, lim: presses } : null;
    },
  },
  {
    // game.js hitUfo: a saucer pays one of UFO_VALUES, nothing else.
    id: 'brick-saucer-value', proven: true,
    text: 'a saucer worth points it never pays',
    check(e, { x }) {
      const u = x && arr(x.ufo);
      if (!u) return null;
      const bad = u.find((q) => Array.isArray(q) && !UFO_VALUES.includes(Number(q[0])));
      return bad ? { v: `a saucer for ${bad[0]}`, lim: UFO_VALUES.join('/') } : null;
    },
  },
  {
    // game.js startRun: lives = DIFF_TUNING lives and nothing adds one (continueEndless keeps them), so no run loses
    // more balls than that.
    id: 'brick-more-balls-lost-than-lives', proven: true,
    text: 'more balls lost than the run had lives',
    check(e, { a, x }) {
      const lost = x && arr(x.lost), lives = LIVES[String((x && x.diff) || (a && a[1]) || '')];
      if (!lost || lost.length >= 30 || !lives) return null;
      return lost.length > lives ? { v: `${lost.length} balls lost, ${lives} lives`, lim: lives } : null;
    },
  },
  {
    // Suspicious: 400+ paddle returns without dropping a single ball.
    id: 'brick-never-drops-a-ball', proven: false,
    text: 'hundreds of returns without losing a ball',
    check(e, { x }) {
      if (!x || !Number.isFinite(Number(x.ph)) || !arr(x.lost)) return null;
      return Number(x.ph) >= 400 && x.lost.length === 0 ? { v: `${x.ph} returns, no ball lost`, lim: 400 } : null;
    },
  },
];
