// snake/js/game.js — the classic phone Snake engine. Pure state machine: no DOM, no timers, no
// rendering — the UI owns the clock and calls step() per tick, which is what makes this file
// headless-testable (snake/js/test.js) the same way every other engine in this repo is.
//
// Classic rules (the old phone kind, deliberately):
//   - The arena is a walled COLS x ROWS grid. Hitting a wall ends the run. No wrap-around.
//   - Eating food grows the snake by one and scores one. Food never spawns on the snake.
//   - Running into your own body ends the run.
//   - A 180° reversal is impossible: a queued direction opposite to the current heading is
//     dropped (classic behavior — the snake can never eat its own neck).
//
// Difficulty is SPEED only (tick interval, owned by the UI via TICK_MS) — the rules never change.
// The engine exposes an input QUEUE (up to 2 pending turns) so two quick taps within one tick both
// land, one per tick, which is what makes tight corners playable at Hard's tick rate.

export const COLS = 15;
export const ROWS = 17;
export const START_LEN = 3;

/** Difficulty -> tick interval (ms). The UI's loop uses these; tests ignore them. */
export const TICK_MS = { easy: 170, medium: 120, hard: 85 };
export const DIFFS = ['easy', 'medium', 'hard'];

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

export class Game {
  /** `rng` is injectable (tests pass a seeded one); defaults to Math.random.
   *  `wrap`: when true, walls don't kill — the head re-enters on the opposite side instead
   *  (self-collision still kills either way). */
  constructor(difficulty = 'medium', rng = Math.random, wrap = false) {
    this.difficulty = DIFFS.includes(difficulty) ? difficulty : 'medium';
    this.rng = rng;
    this.wrap = !!wrap;
    // Snake starts horizontal, centered, heading right; head is body[0].
    const cy = Math.floor(ROWS / 2);
    const cx = Math.floor(COLS / 2);
    this.body = [];
    for (let i = 0; i < START_LEN; i++) this.body.push({ x: cx - i, y: cy });
    this.dir = 'right';
    this.queue = [];            // pending direction changes, max 2
    this.food = null;
    this.score = 0;             // food eaten
    this.over = false;
    this.won = false;           // filled the whole grid (theoretical, but handle it)
    this._spawnFood();
  }

  get length() { return this.body.length; }

  /** Queue a turn. Ignored when it would reverse the LAST EFFECTIVE heading (current direction,
   *  or the newest queued turn if there is one) or repeat it. Queue caps at 2. */
  setDirection(dir) {
    if (!DIRS[dir] || this.over) return false;
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if (dir === last || dir === OPPOSITE[last]) return false;
    if (this.queue.length >= 2) return false;
    this.queue.push(dir);
    return true;
  }

  /** Advance one tick. Returns { moved, ate, over, won } for the UI's per-tick effects. */
  step() {
    if (this.over) return { moved: false, ate: false, over: true, won: this.won };
    if (this.queue.length) this.dir = this.queue.shift();
    const d = DIRS[this.dir];
    let head = { x: this.body[0].x + d.x, y: this.body[0].y + d.y };

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      if (this.wrap) {
        // Re-enter on the opposite side; self-collision below still applies normally.
        head = { x: (head.x + COLS) % COLS, y: (head.y + ROWS) % ROWS };
      } else {
        // Walls kill (classic phone rules).
        this.over = true;
        return { moved: false, ate: false, over: true, won: false };
      }
    }

    const ate = !!(this.food && head.x === this.food.x && head.y === this.food.y);
    // Self-collision: the tail cell is vacated THIS tick unless we grow, so stepping into the
    // current tail square is legal when not eating — the classic "chase your tail" move.
    const solid = ate ? this.body : this.body.slice(0, -1);
    if (solid.some((c) => c.x === head.x && c.y === head.y)) {
      this.over = true;
      return { moved: false, ate: false, over: true, won: false };
    }

    this.body.unshift(head);
    if (ate) {
      this.score += 1;
      this.food = null;
      if (this.body.length >= COLS * ROWS) { this.over = true; this.won = true; }
      else this._spawnFood();
    } else {
      this.body.pop();
    }
    return { moved: true, ate, over: this.over, won: this.won };
  }

  /** Place food on a uniformly random FREE cell (never on the snake). */
  _spawnFood() {
    const taken = new Set(this.body.map((c) => c.x + ',' + c.y));
    const free = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!taken.has(x + ',' + y)) free.push({ x, y });
    }
    this.food = free.length ? free[Math.floor(this.rng() * free.length) % free.length] : null;
  }
}

export default { Game, COLS, ROWS, START_LEN, TICK_MS, DIFFS };
