// bases.js : runner-advancement rules. Pure - takes a bases array and a play, returns a new bases
// array plus how many runs scored. Nothing here reads the clock, the RNG, or any engine state
// beyond what is passed in.
//
// Bases are represented as `[first, second, third]`, each either `null` or the runner's player id
// (the batter becomes a runner id the instant they reach base). Home is not a "base" here - a
// runner leaving third for home is simply removed from the array and counted as a run.
//
// Rules decided here, because the (unavailable) design doc does not settle them and a real-rules
// baseline is the least invented choice available (see settings.js's own "Rules the doc does not
// settle" block for the sibling list of decisions made in that file):
//   - No baserunning between pitches is modeled this phase: no steals, no leads, no pickoffs. A
//     runner only ever moves as a direct consequence of the CURRENT play being resolved.
//   - A hit of N bases (single=1 .. homer=4) advances the batter AND every existing runner by
//     exactly N bases. This is a simplification of real baserunning (a real runner's advance on a
//     single depends on their speed, the fielder, the game situation) - deliberately fixed rather
//     than invented as a "realistic" dial with nothing to calibrate it against.
//   - A walk/HBP force-advances only the runners actually forced (first is always forced by a
//     walk; second only if first is occupied; third only if first and second are both occupied).
//   - A fielder's choice or a fielding error advances the batter to first exactly like a single,
//     and existing runners are NOT force-advanced beyond what a single implies, and are not
//     automatically credited to score without actually reaching home.
//   - A sacrifice fly (a flyout with a runner on third and fewer than 2 outs) scores that runner;
//     no other runner may advance on it this phase (a real sac fly can also let a runner from
//     first or second try for the next base - omitted rather than guessed at).
//   - A ground-out double play (doc §3, [Locked]: possible with a runner on first and fewer than
//     2 outs) removes ONLY the runner forced at second; nobody else moves, and the batter's own
//     out is credited separately by the caller (game.js adds the second out itself).

export function emptyBases() { return [null, null, null]; }

/** Advance every runner (and the batter, entering at base `0`) by `n` bases. A runner who would
 *  pass base index 2 (third) scores and leaves the array. Returns `{ bases, runsScored }`.
 *  `n` is 1..4; n===4 clears the bases and scores the batter too (a home run). */
export function advanceAll(bases, batterId, n) {
  const next = emptyBases();
  let runsScored = 0;

  // Existing runners, from third down to first, each moves n bases from their own base index.
  for (let i = 2; i >= 0; i--) {
    const runner = bases[i];
    if (runner == null) continue;
    const dest = i + n; // 0=first,1=second,2=third,>=3=home
    if (dest >= 3) runsScored += 1;
    else next[dest] = runner;
  }
  // The batter starts at "base -1" (home plate) and moves n bases.
  const batterDest = -1 + n;
  if (batterDest >= 3) runsScored += 1;
  else if (batterDest >= 0) next[batterDest] = batterId;

  return { bases: next, runsScored };
}

/** A walk or hit-by-pitch: force only the runners actually forced. */
export function advanceWalk(bases, batterId) {
  const next = bases.slice();
  let runsScored = 0;
  const firstOccupied = bases[0] != null;
  const secondOccupied = bases[1] != null;
  const thirdOccupied = bases[2] != null;

  if (firstOccupied && secondOccupied && thirdOccupied) {
    runsScored += 1; // runner forced home from third
    next[2] = bases[1];
    next[1] = bases[0];
    next[0] = batterId;
  } else if (firstOccupied && secondOccupied) {
    next[2] = bases[1];
    next[1] = bases[0];
    next[0] = batterId;
  } else if (firstOccupied) {
    next[1] = bases[0];
    next[0] = batterId;
  } else {
    next[0] = batterId;
  }
  return { bases: next, runsScored };
}

/** A sacrifice fly: the runner on third scores (if fewer than 2 outs, checked by the caller
 *  before calling this), nobody else moves, the batter is out (the caller records the out). */
export function advanceSacFly(bases) {
  if (bases[2] == null) return { bases, runsScored: 0, wasSacFly: false };
  const next = bases.slice();
  next[2] = null;
  return { bases: next, runsScored: 1, wasSacFly: true };
}

/** An out on a batted ball with nobody sacrificing: nobody advances. */
export function noAdvance(bases) {
  return { bases, runsScored: 0 };
}

/** A ground-out double play: the runner on first is forced out at second and removed; second and
 *  third are untouched. Caller must have already confirmed a runner is on first. */
export function advanceDoublePlay(bases) {
  const next = bases.slice();
  next[0] = null;
  return next;
}

export default { emptyBases, advanceAll, advanceWalk, advanceSacFly, noAdvance, advanceDoublePlay };
