// skeeball/js/game.js - the pure Skeeball engine. No DOM, no timers, no randomness of its own
// beyond the injected `rng`, so `js/test.js` can drive a whole match headlessly and the UI can
// replay any throw for animation without asking the engine twice.
//
// THE ONE IDEA WORTH UNDERSTANDING HERE: a throw is resolved from two numbers and nothing else.
//
//   power  0..1   how hard it was flicked  -> how far up the ramp it gets -> which ring
//   aim   -1..1   how far off straight     -> where across the lane it arrives
//
// `resolveThrow(power, aim)` is a PURE function of those two, with no random scatter at all. That
// is deliberate and it is the whole game: the player is judging a flick, and a hidden dice roll on
// top of their judgement would make practice pointless. The same pair always scores the same, so
// the animation the UI draws can be derived from the same numbers and can never disagree with the
// number that gets recorded.
//
// Geometry vocabulary matches reference/skeeball/SPEC.md: rings 10/20/30/40/50 stacked up the ramp
// (higher = further = worth more) plus two free-standing 100 cups in the top corners.

export const BALLS_PER_ROUND = 9;          // the classic skeeball rack
export const ROUND_OPTIONS = [1, 3];       // 3 is the reference app's format; 1 is a quick game
export const DIFFS = ['easy', 'medium', 'hard'];
export const MULTIPLIER = 3;               // the reference's badge is always x3

/** Every place a ball can come to rest, and what it pays. */
export const TARGET_POINTS = { 10: 10, 20: 20, 30: 30, 40: 40, 50: 50, '100L': 100, '100R': 100 };

/** Which targets the roaming multiplier badge can land on. Never the 10: multiplying the
 *  consolation ring would reward the throw that missed everything. */
export const MULT_TARGETS = ['20', '30', '40', '50', '100L', '100R'];

// --- the throw model --------------------------------------------------------------------------
//
// Energy bands. `e` is arrival energy: the flick's power, minus what a wall bounce cost it. The
// bands are contiguous and their edges ARE the difficulty of the game - each one is a window the
// player has to land a flick inside. They get NARROWER as they get more valuable (10 is 0.16 wide,
// 50 is 0.08), which is what makes the top of the ramp feel like a real target rather than "flick
// harder".
const SHORT_BELOW = 0.28;      // never made it up the ramp: rolls back, scores nothing
const BANDS = [               // [minEnergy, target]
  [0.28, '10'],
  [0.44, '20'],
  [0.58, '30'],
  [0.70, '40'],
  [0.80, '50'],
];
const OVER_ABOVE = 0.88;       // straight over the top of the ramp, drops back into the 10

// The corner cups. Checked BEFORE the energy bands, because a ball far enough out to reach a cup
// was never over the ring stack in the first place. Both conditions are needed: the cups sit level
// with the 50 at the outside edges of the board, so a 100 is a hard throw AND a wide one.
const CUP_MIN_OFFSET = 0.68;   // |u| at arrival, in half-lane-widths (1.0 = touching the rail)
const CUP_MIN_ENERGY = 0.74;
const CUP_MAX_ENERGY = 0.92;

// How far off centre a given aim drifts by the time the ball reaches the board. >1 means a
// full-tilt flick reaches the rail and banks off it, which is a legitimate (if lossy) way to line
// up a corner cup.
const LATERAL_GAIN = 1.35;
const BOUNCE_LOSS = 0.13;      // energy a wall bounce costs, per bounce

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Where a throw ends up. PURE - no rng, see the header.
 *
 * @param {number} power 0..1
 * @param {number} aim  -1..1 (negative = left)
 * @returns {{target: string|null, kind: string, points: number, offset: number,
 *            energy: number, bounces: number}}
 *          `target` is null only when nothing was scored. `kind` is why, for the UI's callout:
 *          'ring' | 'cup' | 'short' | 'over'. `offset`/`energy`/`bounces` are the resolved flight
 *          numbers, handed back so the renderer can animate the exact throw that was scored.
 */
export function resolveThrow(power, aim) {
  const p = clamp(Number.isFinite(power) ? power : 0, 0, 1);
  const a = clamp(Number.isFinite(aim) ? aim : 0, -1, 1);

  // Drift across the lane, folding at the rails. A ball can bank more than once on a wild throw,
  // so this is a loop rather than a single reflection.
  let u = a * LATERAL_GAIN;
  let bounces = 0;
  while (Math.abs(u) > 1 && bounces < 4) {
    u = Math.sign(u) * (2 - Math.abs(u));
    bounces += 1;
  }
  const energy = Math.max(0, p - bounces * BOUNCE_LOSS);

  if (energy < SHORT_BELOW) {
    return { target: null, kind: 'short', points: 0, offset: u, energy, bounces };
  }
  if (Math.abs(u) >= CUP_MIN_OFFSET && energy >= CUP_MIN_ENERGY && energy <= CUP_MAX_ENERGY) {
    const target = u < 0 ? '100L' : '100R';
    return { target, kind: 'cup', points: TARGET_POINTS[target], offset: u, energy, bounces };
  }
  if (energy > OVER_ABOVE) {
    // Over the back of the ramp and down into the outer ring. Scores, but only just - the
    // deliberate penalty for "flick as hard as possible" being a strategy.
    return { target: '10', kind: 'over', points: 10, offset: u, energy, bounces };
  }
  let target = '10';
  for (const [min, id] of BANDS) if (energy >= min) target = id;
  return { target, kind: 'ring', points: TARGET_POINTS[target], offset: u, energy, bounces };
}

/** The (power, aim) that lands dead centre of a target's window - the AI's intent before its own
 *  error is added, and the answer to "what does a perfect throw at this look like". */
export function idealThrow(target) {
  switch (String(target)) {
    case '20': return { power: 0.51, aim: 0 };
    case '30': return { power: 0.64, aim: 0 };
    case '40': return { power: 0.75, aim: 0 };
    case '50': return { power: 0.84, aim: 0 };
    case '100L': return { power: 0.83, aim: -0.80 / LATERAL_GAIN };
    case '100R': return { power: 0.83, aim: 0.80 / LATERAL_GAIN };
    default: return { power: 0.36, aim: 0 };
  }
}

// --- the opponent -------------------------------------------------------------------------------
//
// The AI is modelled as a HAND, not as a score: it picks a target and then throws at it with a
// per-tier error. It therefore misses the way a person misses - short, long, or into the wrong
// ring - instead of being handed a number. Easy genuinely cannot hit the cups reliably; Hard can.

const AI = {
  easy: { power: 0.155, aim: 0.30, greed: 0.15 },
  medium: { power: 0.095, aim: 0.17, greed: 0.5 },
  hard: { power: 0.05, aim: 0.085, greed: 0.9 },
};

/** Box-Muller, so the AI's error is normally distributed (clustered near its intent, occasional
 *  real miss) rather than uniform, which reads as random flailing. */
function gauss(rng) {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * What the opponent goes for on this throw, and how accurately.
 * `greed` is the chance it chases the multiplied target instead of its safe default.
 */
export function aiThrow(rng, difficulty, multTarget) {
  const cfg = AI[difficulty] || AI.medium;
  const safe = difficulty === 'easy' ? '30' : difficulty === 'hard' ? '50' : '40';
  const goingFor = (multTarget && rng() < cfg.greed) ? multTarget : safe;
  const ideal = idealThrow(goingFor);
  return {
    power: clamp(ideal.power + gauss(rng) * cfg.power, 0, 1),
    aim: clamp(ideal.aim + gauss(rng) * cfg.aim, -1, 1),
    goingFor,
  };
}

// --- the match ------------------------------------------------------------------------------------

/** One skeeball match: `rounds` racks of BALLS_PER_ROUND balls each, you throwing a whole rack
 *  then the opponent throwing theirs (the reference app's per-round handover, not per-ball).
 *  Highest total after the last rack wins; equal totals are a genuine tie. */
export class Game {
  constructor(opts = {}) {
    const o = opts || {};
    this.rounds = ROUND_OPTIONS.includes(o.rounds) ? o.rounds : 1;
    this.difficulty = DIFFS.includes(o.difficulty) ? o.difficulty : 'medium';
    this.rng = typeof o.rng === 'function' ? o.rng : Math.random;

    this.round = 1;
    this.ball = 1;                 // 1..BALLS_PER_ROUND within the current rack
    this.turn = 'you';             // 'you' | 'opp'
    this.scores = { you: 0, opp: 0 };
    this.roundScores = [];         // [{you, opp}] one per COMPLETED round
    this.over = false;
    this.winner = null;            // 'you' | 'opp' | 'tie', set once over
    // Per-side running tallies, for the stats recorder. Counted here rather than in the UI so a
    // restored save carries them (the UI's own counters would restart at zero on resume).
    this.tally = { balls: 0, hundreds: 0, fifties: 0, bestThrow: 0 };
    this.multTarget = null;
    this.rollMultiplier();
  }

  /** Move the badge before every throw, as the reference does (it is over the 40, above the 50 and
   *  on the left cup in three different frames of one recording). */
  rollMultiplier() {
    this.multTarget = MULT_TARGETS[Math.floor(this.rng() * MULT_TARGETS.length)] || '50';
    return this.multTarget;
  }

  /** Resolve one throw for whoever's turn it is, apply it, and advance the match.
   *  @returns the throw result plus `scored` (points AFTER the multiplier) and `multiplied`. */
  throwBall(power, aim) {
    if (this.over) return null;
    const thrower = this.turn;
    const res = resolveThrow(power, aim);
    const multiplied = !!(res.target && res.target === this.multTarget);
    const scored = res.points * (multiplied ? MULTIPLIER : 1);
    this.scores[thrower] += scored;

    if (thrower === 'you') {
      this.tally.balls += 1;
      if (res.kind === 'cup') this.tally.hundreds += 1;
      if (res.target === '50') this.tally.fifties += 1;
      this.tally.bestThrow = Math.max(this.tally.bestThrow, scored);
    }

    const out = { ...res, scored, multiplied, thrower, round: this.round, ballNo: this.ball };
    this._advance();
    return out;
  }

  _advance() {
    if (this.ball < BALLS_PER_ROUND) { this.ball += 1; this.rollMultiplier(); return; }
    // Rack finished.
    this.ball = 1;
    if (this.turn === 'you') { this.turn = 'opp'; this.rollMultiplier(); return; }
    // Both sides have thrown this round.
    this.turn = 'you';
    this.roundScores.push({ you: this.scores.you, opp: this.scores.opp });
    if (this.round >= this.rounds) {
      this.over = true;
      this.winner = this.scores.you > this.scores.opp ? 'you'
        : this.scores.opp > this.scores.you ? 'opp' : 'tie';
      return;
    }
    this.round += 1;
    this.rollMultiplier();
  }

  /** The opponent's next throw parameters (the UI animates them, then feeds them back in). */
  aiPlan() { return aiThrow(this.rng, this.difficulty, this.multTarget); }

  /** True while a rack is part-thrown - used by the UI to decide whether a handover card is due. */
  get ballsLeft() { return BALLS_PER_ROUND - this.ball + 1; }

  /** Everything needed to rebuild this match. The rng is deliberately NOT captured: a restored
   *  match re-rolls its multipliers and the AI's error from a fresh stream, which changes nothing
   *  a player could notice and keeps the save a plain JSON object. */
  snapshot() {
    return {
      v: 1,
      rounds: this.rounds, difficulty: this.difficulty,
      round: this.round, ball: this.ball, turn: this.turn,
      scores: { ...this.scores }, roundScores: this.roundScores.map((r) => ({ ...r })),
      over: this.over, winner: this.winner, tally: { ...this.tally }, multTarget: this.multTarget,
    };
  }

  /** Rebuild from a snapshot. Returns null (never throws) on anything malformed, so a corrupt or
   *  truncated save can only ever mean "no game to resume", never a crash on mount. */
  static restore(snap, rng) {
    try {
      if (!snap || snap.v !== 1) return null;
      const g = new Game({ rounds: snap.rounds, difficulty: snap.difficulty, rng });
      g.round = Math.max(1, snap.round | 0);
      g.ball = Math.min(BALLS_PER_ROUND, Math.max(1, snap.ball | 0));
      g.turn = snap.turn === 'opp' ? 'opp' : 'you';
      g.scores = { you: Math.max(0, snap.scores?.you | 0), opp: Math.max(0, snap.scores?.opp | 0) };
      g.roundScores = Array.isArray(snap.roundScores)
        ? snap.roundScores.map((r) => ({ you: r?.you | 0, opp: r?.opp | 0 })) : [];
      g.over = !!snap.over;
      g.winner = ['you', 'opp', 'tie'].includes(snap.winner) ? snap.winner : null;
      g.tally = {
        balls: Math.max(0, snap.tally?.balls | 0),
        hundreds: Math.max(0, snap.tally?.hundreds | 0),
        fifties: Math.max(0, snap.tally?.fifties | 0),
        bestThrow: Math.max(0, snap.tally?.bestThrow | 0),
      };
      if (MULT_TARGETS.includes(snap.multTarget)) g.multTarget = snap.multTarget;
      return g;
    } catch { return null; }
  }
}

export default { Game, resolveThrow, idealThrow, aiThrow, BALLS_PER_ROUND, ROUND_OPTIONS, DIFFS, MULTIPLIER, TARGET_POINTS, MULT_TARGETS };
