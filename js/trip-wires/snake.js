// js/trip-wires/snake.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'snake-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` is snake/js/game.js privateLog() + ui.js _endRun: ticks, turns ['<tick><u|d|l|r>'], foods
// ['x,y' each food in the order it appeared], eats [tick each was eaten] (2026-11-25), cause, wrap, len, ms (wall time
// since the first steer), pauses, inp ('<ms><p|s|k><dir>[x]' every steer press, 2026-11-25).
const COLS = 15, ROWS = 17, START_LEN = 3;                    // snake/js/game.js
const START = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }; // game.js constructor: the head starts here
const TICK_MS = { easy: 170, medium: 120, hard: 85 };          // game.js TICK_MS (ui.js _startLoop setInterval)
const FOOD_CAP = 400, TURN_CAP = 600;                          // game.js keeps at most this many

const cell = (s) => { const m = /^(-?\d+),(-?\d+)$/.exec(String(s)); return m ? { x: +m[1], y: +m[2] } : null; };
const dist = (a, b, wrap) => {
  let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  if (wrap) { dx = Math.min(dx, COLS - dx); dy = Math.min(dy, ROWS - dy); }
  return dx + dy;
};
/** Each eaten food: { gap: ticks since the last one (or the start), need: the fewest moves to reach it }. */
function eatGaps(x) {
  const foods = Array.isArray(x && x.foods) ? x.foods.map(cell) : null, eats = Array.isArray(x && x.eats) ? x.eats : null;
  if (!foods || !eats || foods.some((f) => !f)) return null;
  const out = [];
  let at = START, t = 0;
  for (let k = 0; k < eats.length && k < foods.length; k++) {
    out.push({ gap: Number(eats[k]) - t, need: dist(at, foods[k], !!x.wrap) });
    at = foods[k]; t = Number(eats[k]);
  }
  return out;
}

export default [
  {
    // game.js step(): every food eaten adds 1 to the length and spawns the next food (foods = eaten + 1, or eaten
    // when the grid filled). So the recorded length is START_LEN + foods - 1, exactly.
    id: 'snake-length-not-food', proven: true,
    text: 'a snake longer than the food it ate',
    check(e, { a, x }) {
      if (!a || !x || !Array.isArray(x.foods) || x.foods.length >= FOOD_CAP || x.cause === 'won') return null;
      const len = Number(a[0]);
      if (!Number.isFinite(len)) return null;
      const want = START_LEN + x.foods.length - 1;
      return len > want ? { v: `length ${len}, ${x.foods.length - 1} food`, lim: want } : null;
    },
  },
  {
    // game.js step(): the head moves exactly one cell a tick, so food N cannot be eaten fewer ticks after food N-1
    // (or the start, START) than the cells between them (the short way round when walls are off).
    id: 'snake-food-too-close', proven: true,
    text: 'food eaten in fewer moves than the cells to it',
    check(e, { x }) {
      const g = eatGaps(x);
      if (!g) return null;
      const k = g.findIndex((q) => q.gap < q.need);
      return k >= 0 ? { v: `food ${k + 1}: ${g[k].gap} moves, ${g[k].need} cells away`, lim: g[k].need } : null;
    },
  },
  {
    // ui.js _startLoop: one tick per setInterval(TICK_MS[difficulty]), started at the first steer (_runT0) and
    // stopped while paused. A browser can run a timer late, never early, so ticks x TICK_MS cannot pass the wall
    // time since the first steer (5% and 1 s spare for timer jitter).
    id: 'snake-faster-than-clock', proven: true,
    text: 'the snake moved faster than its clock',
    check(e, { a, x }) {
      if (!x || !Number.isFinite(Number(x.ticks)) || !Number.isFinite(Number(x.ms)) || Number(x.ms) <= 0) return null;
      const tick = TICK_MS[String(x.diff || (a && a[1]) || '')];
      if (!tick) return null;
      const need = Number(x.ticks) * tick, lim = Math.round(Number(x.ms) * 1.05 + 1000);
      return need > lim ? { v: `${x.ticks} moves need ${need} ms, ${x.ms} ms played`, lim } : null;
    },
  },
  {
    // ui.js _steer -> game.js setDirection: a turn is taken off the queue only after a press it accepted, so the
    // turns cannot outnumber the accepted presses in `inp` (pad, swipe, key).
    id: 'snake-turns-without-press', proven: true,
    text: 'more turns than accepted presses',
    check(e, { x }) {
      if (!x || typeof x.inp !== 'string' || x.inpCut || !Array.isArray(x.turns) || x.turns.length >= TURN_CAP) return null;
      const ok = x.inp.split(' ').filter((s) => /^\d+[psk][udlr]$/.test(s)).length;
      return x.turns.length > ok ? { v: `${x.turns.length} turns, ${ok} presses`, lim: ok } : null;
    },
  },
  {
    // Suspicious: a route to every food in the fewest possible moves, over 40+ foods (a body in the way, a wall
    // or a late press makes a person take the long way some of the time).
    id: 'snake-always-shortest', proven: false,
    text: 'every food reached by the shortest route',
    check(e, { x }) {
      const g = eatGaps(x);
      if (!g || g.length < 40) return null;
      const exact = g.filter((q) => q.gap === q.need).length;
      return exact / g.length >= 0.97 ? { v: `${exact} of ${g.length} foods by the shortest route`, lim: '97%' } : null;
    },
  },
  {
    // Suspicious, and it reads plays from 2026-11-16 on (foods + ticks, no eats needed): the cells from food to food
    // added up, over all the moves made. People wander (8 real runs, 2026-11-16 to 11-24: 19% to 35%); the two
    // scripted 62s of Nov 17 (223 and 242 turns from one tap) went 83% and 87% straight.
    id: 'snake-route-too-direct', proven: false,
    text: 'a route from food to food almost without a wasted move',
    check(e, { a, x }) {
      if (!a || !x || !Array.isArray(x.foods) || !(Number(x.ticks) > 0)) return null;
      const eaten = Math.min(Number(a[0]) - START_LEN, x.foods.length);
      if (!(eaten >= 30)) return null;
      let at = START, need = 0;
      for (const s of x.foods.slice(0, eaten)) { const f = cell(s); if (!f) return null; need += dist(at, f, !!x.wrap); at = f; }
      const r = need / Number(x.ticks);
      return r >= 0.6 ? { v: `${need} cells of ${x.ticks} moves were needed (${Math.round(r * 100)}%)`, lim: '60%' } : null;
    },
  },
  {
    // Suspicious (2026-11-25, the red-team review): game.js keeps at most 400 foods and 600 turns, and every rule above
    // steps aside past that, so a script could simply play long. A run that long is shown to Matt (none so far: 8 real
    // runs, at most 259 turns).
    id: 'snake-too-long-to-check', proven: false,
    text: 'a run too long for every check',
    check(e, { x }) {
      if (!x) return null;
      const f = Array.isArray(x.foods) ? x.foods.length : 0, t = Array.isArray(x.turns) ? x.turns.length : 0;
      return f >= FOOD_CAP || t >= TURN_CAP || x.inpCut ? { v: `${t} turns, ${f} foods logged`, lim: `${TURN_CAP} / ${FOOD_CAP}` } : null;
    },
  },
];
