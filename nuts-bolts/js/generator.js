// Procedural level generation for Nuts & Bolts.
// Pure, no DOM. Levels are built by reverse-scrambling from a solved state,
// which guarantees solvability (see NUTS-BOLTS-GAME-BRIEF.md section 4 for the
// original proof; duplicate color sets do not change it, see buildSolvedStacks).

export const CAP = 4;

// 12-color palette. Order matters: Easy draws only from the first 7 (the most
// separable under red-green color vision deficiency); Medium+ draw from all 12,
// leaning on the embossed per-color symbol (see ui.js) to disambiguate hues
// that would otherwise be too close for CVD play (orange/red/green/lime/brown).
export const PALETTE = [
  { key: 'yellow', name: 'Yellow', hex: '#F2B705' },
  { key: 'blue', name: 'Blue', hex: '#1F5FA8' },
  { key: 'orange', name: 'Orange', hex: '#C24420' },
  { key: 'teal', name: 'Teal', hex: '#178A7A' },
  { key: 'purple', name: 'Purple', hex: '#7A3FE0' },
  { key: 'pink', name: 'Pink', hex: '#E88BC4' },
  { key: 'slate', name: 'Slate', hex: '#3A4454' },
  { key: 'sky', name: 'Sky', hex: '#4FC3F7' },
  { key: 'red', name: 'Red', hex: '#D32F2F' },
  { key: 'green', name: 'Green', hex: '#43A047' },
  { key: 'lime', name: 'Lime', hex: '#9CCC65' },
  { key: 'brown', name: 'Brown', hex: '#8D6E63' },
];
const EASY_POOL = PALETTE.slice(0, 7);

export const TIER_ORDER = ['easy', 'medium', 'hard', 'extraHard'];
export const TIER_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard', extraHard: 'Extra Hard' };
export const TIER_DESCRIPTIONS = {
  easy: '3 to 6 colors',
  medium: '8 to 11 bolts, duplicates appear',
  hard: 'Bigger boards, more hidden nuts',
  extraHard: 'Maximum chaos',
};

// F = full bolts, C = distinct colors (F >= C; F - C bolts get a duplicate
// color), E = empty bolts, S = scramble steps, H = hidden-nut fraction.
const TIERS = {
  easy: [
    { maxLevel: 3, F: 3, C: 3, E: 2, S: 8, H: 0 },
    { maxLevel: 8, F: 4, C: 4, E: 2, S: 14, H: 0 },
    { maxLevel: 15, F: 5, C: 5, E: 2, S: 20, H: 0.10 },
    { maxLevel: Infinity, F: 6, C: 6, E: 2, S: 24, H: 0.10 },
  ],
  medium: [
    { maxLevel: 5, F: 8, C: 7, E: 2, S: 30, H: 0.05 },
    { maxLevel: 15, F: 9, C: 8, E: 2, S: 36, H: 0.10 },
    { maxLevel: 30, F: 10, C: 8, E: 2, S: 42, H: 0.15 },
    { maxLevel: Infinity, F: 11, C: 9, E: 2, S: 48, H: 0.15 },
  ],
  hard: [
    { maxLevel: 5, F: 11, C: 9, E: 2, S: 48, H: 0.10 },
    { maxLevel: 15, F: 12, C: 10, E: 2, S: 56, H: 0.15 },
    { maxLevel: Infinity, F: 13, C: 10, E: 2, S: 64, H: 0.20 },
  ],
  extraHard: [
    { maxLevel: 5, F: 13, C: 10, E: 2, S: 64, H: 0.15 },
    { maxLevel: 15, F: 14, C: 11, E: 2, S: 72, H: 0.20 },
    { maxLevel: Infinity, F: 15, C: 12, E: 2, S: 80, H: 0.25 },
  ],
};

// Quality gate thresholds (WP2f). Easy skips the greedy-solver probe entirely.
// Retuned from the brief's suggested minAvgT 1.6/2.0/2.2 and maxMono 0: a
// standalone simulation (25-200 sample batches per row) showed avgT plateaus
// around ~1.7-1.9 regardless of board size at these scramble depths and never
// approaches 2.0-2.2, and requiring zero mono bolts on 9-15 bolt boards
// rejected the large majority of otherwise well-scrambled candidates; easy's
// tiny 3-bolt board (F=3) similarly hits 2+ untouched mono bolts by chance
// often enough that maxMono:1 alone flagged ~30%+ of runs. These values keep
// single-attempt pass rates high (mid-60s% to mid-90s%) so the 25-try retry
// loop essentially never runs dry, while still rejecting the clearly
// under-scrambled tail. See the round-4 handoff for the measurements.
const QUALITY_GATES = {
  easy: { minAvgT: 1.0, maxMono: 2, probeMoves: 0, probeTrials: 0 },
  medium: { minAvgT: 1.5, maxMono: 1, probeMoves: 30, probeTrials: 3 },
  hard: { minAvgT: 1.6, maxMono: 1, probeMoves: 40, probeTrials: 3 },
  extraHard: { minAvgT: 1.6, maxMono: 1, probeMoves: 50, probeTrials: 3 },
};

export function getDifficulty(tier, level) {
  const rows = TIERS[tier] || TIERS.easy;
  const row = rows.find((r) => level <= r.maxLevel);
  return { F: row.F, C: row.C, E: row.E, S: row.S, H: row.H };
}

function cloneStacks(stacks) {
  return stacks.map((s) => s.map((n) => ({ color: n.color, hidden: n.hidden, id: n.id })));
}

function topRun(stack) {
  if (!stack.length) return { length: 0, color: null };
  const color = stack[stack.length - 1].color;
  let len = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].color === color) len++;
    else break;
  }
  return { length: len, color };
}

function freeSpace(stack) {
  return CAP - stack.length;
}

function topColor(stack) {
  return stack.length ? stack[stack.length - 1].color : null;
}

// A bolt is complete only when it is full, every nut is the same color, AND
// no nut in it is still hidden (a hidden nut carries its true color in data,
// so a color-only check would wrongly treat a buried-but-matching hidden nut
// as complete). Shared by lock checks, completion celebration, and win
// detection so there is exactly one definition of "done" anywhere.
export function isBoltComplete(stack) {
  return stack.length === CAP && stack.every((n) => !n.hidden && n.color === stack[0].color);
}

export function isSolved(stacks) {
  return stacks.every((s) => s.length === 0 || isBoltComplete(s));
}

// Color-only version of the same check, ignoring hidden flags entirely. This
// is what the reverse-scramble proof actually guarantees (it operates purely
// on color arrangement); hidden-nut reveal is a separate, already-verified
// mechanic (game.js's revealTop) layered on top. Used by the generator's own
// scramble-phase checks and by the solvability self-test, so those aren't
// confused by orthogonal hidden-nut bookkeeping.
function isColorArrangementSolved(stacks) {
  return stacks.every((s) => s.length === 0 || (s.length === CAP && s.every((n) => n.color === s[0].color)));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// One reverse-scramble step. Returns the applied move {from, to, count, color}
// or null if no legal candidate exists. UNCHANGED from the single-color-set
// version: neither the count constraint nor the destination constraint ever
// referenced color uniqueness, so the solvability proof holds unmodified with
// duplicate color sets too.
function attemptReverseMove(stacks, prevMove) {
  const candidates = [];
  for (let Y = 0; Y < stacks.length; Y++) {
    const stackY = stacks[Y];
    if (!stackY.length) continue;
    const { length: g, color: c } = topRun(stackY);
    for (let j = 1; j <= g; j++) {
      if (j === g && stackY.length !== g) continue; // never lift a whole run off a taller mixed stack
      for (let X = 0; X < stacks.length; X++) {
        if (X === Y) continue;
        const stackX = stacks[X];
        if (freeSpace(stackX) < j) continue;
        const tc = topColor(stackX);
        if (stackX.length !== 0 && tc === c) continue; // never place onto matching color while scrambling
        if (prevMove && Y === prevMove.to && X === prevMove.from && j === prevMove.count && c === prevMove.color) {
          continue; // don't immediately invert the previous reverse move
        }
        candidates.push({ from: Y, to: X, count: j, color: c });
      }
    }
  }
  if (!candidates.length) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const stackY = stacks[pick.from];
  const moved = stackY.splice(stackY.length - pick.count, pick.count);
  stacks[pick.to].push(...moved);
  return pick;
}

// Builds F full bolts drawn from C distinct colors (F >= C), plus E empty
// bolts, in random position order. The first C bolts each get one of the C
// chosen colors (guaranteeing every chosen color owns at least one bolt); the
// remaining F - C bolts get a random duplicate color from that same set of C.
function buildSolvedStacks(F, C, E, tier) {
  let nextId = 0;
  const pool = tier === 'easy' ? EASY_POOL : PALETTE;
  const chosenColors = shuffle([...pool]).slice(0, C).map((p) => p.key);

  const boltColors = [...chosenColors];
  for (let i = C; i < F; i++) {
    boltColors.push(chosenColors[Math.floor(Math.random() * C)]);
  }
  shuffle(boltColors);

  const stacks = boltColors.map((color) => Array.from({ length: CAP }, () => ({ color, hidden: false, id: nextId++ })));
  for (let i = 0; i < E; i++) stacks.push([]);
  return shuffle(stacks);
}

function scramble(stacks, S) {
  const moves = [];
  let prevMove = null;
  for (let step = 0; step < S; step++) {
    const move = attemptReverseMove(stacks, prevMove);
    if (!move) break;
    moves.push(move);
    prevMove = move;
  }
  return moves;
}

// Replays a recorded reverse-move sequence backwards (the forward solution)
// against a deep clone of the scrambled stacks. Used by generateLevel's own
// sanity check and by the generator self-test. Mimics the real game's
// reveal-on-top rule at each step (whatever ends up topmost, on either
// affected stack, flips to revealed) so this accurately simulates what a
// real player achieves, hidden nuts included. Returns the resulting stacks.
export function replaySolutionBackward(scrambledStacks, moves) {
  const stacks = cloneStacks(scrambledStacks);
  const revealTopOf = (stack) => {
    if (stack.length) stack[stack.length - 1].hidden = false;
  };
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i];
    const stackTo = stacks[m.to];
    const moved = stackTo.splice(stackTo.length - m.count, m.count);
    stacks[m.from].push(...moved);
    revealTopOf(stackTo);
    revealTopOf(stacks[m.from]);
  }
  return stacks;
}

function assignHiddenNuts(stacks, hiddenFraction) {
  if (!hiddenFraction) return;
  const eligible = [];
  let totalNuts = 0;
  for (const stack of stacks) {
    totalNuts += stack.length;
    for (let i = 0; i < stack.length - 1; i++) eligible.push(stack[i]); // all but the top nut
  }
  const target = Math.floor(hiddenFraction * totalNuts);
  shuffle(eligible);
  for (let i = 0; i < target && i < eligible.length; i++) eligible[i].hidden = true;
}

// Gate part 1: mixedness. T = total adjacent-pair color transitions across
// every bolt (hidden nuts count by their true color); M = count of non-empty
// bolts that are all one color at any height (not just full ones).
function mixednessMetrics(stacks) {
  let T = 0;
  let M = 0;
  for (const stack of stacks) {
    if (!stack.length) continue;
    let mono = true;
    for (let i = 1; i < stack.length; i++) {
      if (stack[i].color !== stack[i - 1].color) T++;
      if (stack[i].color !== stack[0].color) mono = false;
    }
    if (mono) M++;
  }
  return { T, M };
}

// Gate part 2: a tiny greedy solver probe. Not a player-facing hint feature,
// un-exported from the UI; purely a difficulty filter run at generation time.
// Uses the same max-move semantics as real play (min(run, space)) and the
// real WP1 completion predicate, including reveal-on-top, so hidden nuts
// behave exactly as they would for an actual player.
function greedyTopRun(stack) {
  if (!stack.length) return { length: 0, color: null };
  const color = stack[stack.length - 1].color;
  let len = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].hidden) break;
    if (stack[i].color === color) len++;
    else break;
  }
  return { length: len, color };
}

function greedyLegalMoves(stacks) {
  const moves = [];
  for (let from = 0; from < stacks.length; from++) {
    const source = stacks[from];
    if (!source.length || isBoltComplete(source)) continue;
    const run = greedyTopRun(source);
    if (!run.length) continue;
    for (let to = 0; to < stacks.length; to++) {
      if (to === from) continue;
      const dest = stacks[to];
      if (dest.length === CAP) continue;
      if (dest.length && dest[dest.length - 1].color !== run.color) continue;
      const count = Math.min(run.length, CAP - dest.length);
      const willComplete = dest.length + count === CAP && (dest.length === 0 || dest.every((n) => n.color === run.color));
      const isSweep = dest.length === 0 && run.length === source.length;
      moves.push({ from, to, count, willComplete, isSweep, ontoNonEmpty: dest.length > 0 });
    }
  }
  return moves;
}

function greedyPick(moves) {
  const completing = moves.filter((m) => m.willComplete);
  if (completing.length) return completing[Math.floor(Math.random() * completing.length)];
  const ontoMatch = moves.filter((m) => m.ontoNonEmpty);
  if (ontoMatch.length) return ontoMatch[Math.floor(Math.random() * ontoMatch.length)];
  const sweeps = moves.filter((m) => m.isSweep);
  if (sweeps.length) return sweeps[Math.floor(Math.random() * sweeps.length)];
  return moves[Math.floor(Math.random() * moves.length)];
}

function greedyApply(stacks, move) {
  const source = stacks[move.from];
  const dest = stacks[move.to];
  const moved = source.splice(source.length - move.count, move.count);
  dest.push(...moved);
  if (source.length) source[source.length - 1].hidden = false; // reveal-on-top
}

// Returns true if the greedy player solves the board within `maxMoves`.
function greedyProbe(stacks, maxMoves) {
  for (let i = 0; i < maxMoves; i++) {
    if (isSolved(stacks)) return true;
    const moves = greedyLegalMoves(stacks);
    if (!moves.length) return false;
    greedyApply(stacks, greedyPick(moves));
  }
  return isSolved(stacks);
}

const MAX_GEN_ATTEMPTS = 25;

// The anti-invert plus destination legality rules mean actual scramble yield
// averages well under S once boards have only a few colors' worth of free
// space to work with (measured via standalone simulation). 30% is the floor
// that is comfortably reachable in practice while still rejecting near-trivial
// scrambles.
const MIN_STEP_RATIO = 0.3;

export function generateLevel(tier, level) {
  const diff = getDifficulty(tier, level);
  const gate = QUALITY_GATES[tier] || QUALITY_GATES.easy;
  const minSteps = Math.ceil(diff.S * MIN_STEP_RATIO);

  let best = null;
  let attempts = 0;
  for (; attempts < MAX_GEN_ATTEMPTS; attempts++) {
    const stacks = buildSolvedStacks(diff.F, diff.C, diff.E, tier);
    const moves = scramble(stacks, diff.S);
    if (moves.length < minSteps) continue;
    if (isColorArrangementSolved(stacks)) continue;

    assignHiddenNuts(stacks, diff.H);

    // A level must start with zero complete bolts (WP2a).
    if (stacks.some((s) => s.length > 0 && isBoltComplete(s))) continue;

    const { T, M } = mixednessMetrics(stacks);
    const avgT = T / diff.F;
    const passesMixedness = avgT >= gate.minAvgT && M <= gate.maxMono;

    let passesProbe = true;
    if (gate.probeTrials > 0) {
      let wins = 0;
      for (let t = 0; t < gate.probeTrials; t++) {
        if (greedyProbe(cloneStacks(stacks), gate.probeMoves)) wins++;
      }
      passesProbe = wins < 2;
    }

    const score = avgT - M * 2;
    if (!best || score > best.score) {
      best = { stacks: cloneStacks(stacks), moves, score };
    }

    if (passesMixedness && passesProbe) {
      const initial = cloneStacks(stacks);
      return {
        level,
        tier,
        stacks,
        initial,
        capacity: CAP,
        colorsUsed: [...new Set(stacks.flatMap((s) => s.map((n) => n.color)))],
        difficulty: diff,
        solution: moves,
        regenAttempts: attempts + 1,
      };
    }
  }

  // Gate never satisfied within the cap: serve the best-scoring candidate
  // seen rather than looping forever or crashing.
  if (best) {
    const initial = cloneStacks(best.stacks);
    return {
      level,
      tier,
      stacks: best.stacks,
      initial,
      capacity: CAP,
      colorsUsed: [...new Set(best.stacks.flatMap((s) => s.map((n) => n.color)))],
      difficulty: diff,
      solution: best.moves,
      regenAttempts: MAX_GEN_ATTEMPTS,
      gateFallback: true,
    };
  }
  throw new Error('nuts-bolts: failed to generate a valid level after ' + MAX_GEN_ATTEMPTS + ' attempts');
}
