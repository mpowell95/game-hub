// skeeball/js/test.js - headless assertions for the Skeeball engine. Run: node skeeball/js/test.js
// (also wired into run-all-tests.mjs). No DOM, no canvas - game.js is pure on purpose.

import {
  Game, resolveThrow, idealThrow, aiThrow,
  BALLS_PER_ROUND, MULT_TARGETS, MULTIPLIER, TARGET_POINTS,
} from './game.js';

let fail = 0;
function ok(label, cond) {
  if (!cond) { fail++; console.log(`FAIL  ${label}`); } else console.log(`ok    ${label}`);
}
function eq(label, got, want) { ok(`${label} (got ${JSON.stringify(got)})`, got === want); }

/** Deterministic rng so every assertion below is reproducible. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Box-Muller, for the simulated human in the whole-match block below. game.js keeps its own copy
 *  private (it is an implementation detail of the AI's hand); this one is the TEST's player. */
function gauss(rng) {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// --- resolveThrow: the bands ---------------------------------------------------------------------

console.log('\n-- throw resolution --');
eq('a feeble flick never reaches the board', resolveThrow(0.1, 0).kind, 'short');
eq('and scores nothing', resolveThrow(0.1, 0).points, 0);
eq('just enough power finds the 10', resolveThrow(0.32, 0).target, '10');
eq('a bit more finds the 20', resolveThrow(0.50, 0).target, '20');
eq('the 30', resolveThrow(0.64, 0).target, '30');
eq('the 40', resolveThrow(0.75, 0).target, '40');
eq('the 50', resolveThrow(0.84, 0).target, '50');
eq('flat out goes over the top', resolveThrow(1, 0).kind, 'over');
eq('and only pays 10 for it', resolveThrow(1, 0).points, 10);

ok('the bands are contiguous - no power between short and over scores nothing',
  Array.from({ length: 200 }, (_, i) => 0.28 + (i / 200) * 0.72)
    .every((p) => resolveThrow(p, 0).points > 0));

console.log('\n-- the corner cups --');
const cupL = resolveThrow(0.83, idealThrow('100L').aim);
const cupR = resolveThrow(0.83, idealThrow('100R').aim);
eq('a hard, wide throw to the left finds the left cup', cupL.target, '100L');
eq('and to the right, the right cup', cupR.target, '100R');
eq('a cup pays 100', cupL.points, 100);
eq('wide but WEAK misses the cup entirely', resolveThrow(0.45, idealThrow('100L').aim).target, '20');
eq('straight and hard is a ring, never a cup', resolveThrow(0.83, 0).target, '50');

console.log('\n-- banking off a rail --');
const banked = resolveThrow(0.95, 1);
ok('a full-tilt aim reaches the rail and bounces', banked.bounces >= 1);
ok('and the bounce costs it energy', banked.energy < 0.95);
ok('the arrival offset is always inside the lane after folding',
  Array.from({ length: 400 }, (_, i) => -1 + (i / 200))
    .every((a) => Math.abs(resolveThrow(0.8, a).offset) <= 1.0000001));

console.log('\n-- purity --');
ok('the same throw always scores the same',
  Array.from({ length: 50 }, () => resolveThrow(0.717, -0.313).target)
    .every((x, _, arr) => x === arr[0]));
ok('every ideal throw actually lands on the target it claims',
  ['20', '30', '40', '50', '100L', '100R'].every((id) => {
    const { power, aim } = idealThrow(id);
    return resolveThrow(power, aim).target === id;
  }));

// --- the multiplier -------------------------------------------------------------------------------

console.log('\n-- the multiplier --');
{
  const g = new Game({ rng: seeded(7) });
  ok('the badge always sits on a real target', MULT_TARGETS.includes(g.multTarget));
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(g.rollMultiplier());
  eq('and reaches every one of them over time', seen.size, MULT_TARGETS.length);
}
{
  // Force the badge onto the 50, then throw a 50 at it.
  const g = new Game({ rng: seeded(3) });
  g.multTarget = '50';
  const { power, aim } = idealThrow('50');
  const out = g.throwBall(power, aim);
  eq('hitting the multiplied target triples it', out.scored, TARGET_POINTS['50'] * MULTIPLIER);
  ok('and says so', out.multiplied === true);
}
{
  const g = new Game({ rng: seeded(3) });
  g.multTarget = '100L';
  const { power, aim } = idealThrow('40');
  const out = g.throwBall(power, aim);
  eq('missing it pays face value', out.scored, TARGET_POINTS['40']);
  ok('and says so', out.multiplied === false);
}

// --- match flow ------------------------------------------------------------------------------------

console.log('\n-- match flow --');
{
  const g = new Game({ rounds: 1, rng: seeded(11) });
  eq('you throw first', g.turn, 'you');
  for (let i = 0; i < BALLS_PER_ROUND; i++) g.throwBall(0.5, 0);
  eq('after your rack it is the opponent\'s turn', g.turn, 'opp');
  eq('and the ball counter restarts', g.ball, 1);
  ok('the match is not over yet', !g.over);
  for (let i = 0; i < BALLS_PER_ROUND; i++) g.throwBall(0.5, 0);
  ok('once both racks are thrown, a 1-round match is over', g.over);
  eq('and the round is banked', g.roundScores.length, 1);
}
{
  const g = new Game({ rounds: 3, rng: seeded(12) });
  for (let r = 0; r < 3; r++) {
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < BALLS_PER_ROUND; i++) {
        // Park the badge somewhere these throws cannot reach, so both sides really do score the
        // same. Identical throws are NOT otherwise worth the same - the badge moves every ball,
        // which is the point of it.
        g.multTarget = '100L';
        g.throwBall(0.5, 0);
      }
    }
  }
  ok('a 3-round match takes three full rounds', g.over);
  eq('and banks three of them', g.roundScores.length, 3);
  eq('equal play by both sides is a genuine tie', g.winner, 'tie');
}
{
  const g = new Game({ rounds: 1, rng: seeded(13) });
  const strong = idealThrow('50');
  for (let i = 0; i < BALLS_PER_ROUND; i++) g.throwBall(strong.power, strong.aim);
  for (let i = 0; i < BALLS_PER_ROUND; i++) g.throwBall(0.1, 0);       // opponent throws nine airballs
  eq('outscoring the opponent wins', g.winner, 'you');
  eq('nine 50s is 450', g.scores.you >= 450, true);
  eq('and nine short throws is nothing', g.scores.opp, 0);
}
{
  const g = new Game({ rounds: 1, rng: seeded(14) });
  for (let i = 0; i < BALLS_PER_ROUND * 2; i++) g.throwBall(0.5, 0);
  ok('a throw after the match ends is refused, not scored', g.throwBall(0.9, 0) === null);
}

console.log('\n-- the human tally (what the stats recorder reads) --');
{
  const g = new Game({ rounds: 1, rng: seeded(15) });
  g.multTarget = '20';                      // keep the badge off everything thrown below
  const cup = idealThrow('100L');
  g.throwBall(cup.power, cup.aim);
  g.multTarget = '20';
  const fifty = idealThrow('50');
  g.throwBall(fifty.power, fifty.aim);
  eq('balls thrown counts only YOUR balls', g.tally.balls, 2);
  eq('cups are counted', g.tally.hundreds, 1);
  eq('so are 50s', g.tally.fifties, 1);
  eq('best throw is the biggest single one', g.tally.bestThrow, 100);
  while (g.turn === 'you') g.throwBall(0.5, 0);
  g.throwBall(0.9, 0);                       // an OPPONENT throw
  eq('the opponent\'s balls are not in your tally', g.tally.balls, BALLS_PER_ROUND);
}

// --- save / restore -----------------------------------------------------------------------------------

console.log('\n-- save and resume --');
{
  const g = new Game({ rounds: 3, difficulty: 'hard', rng: seeded(21) });
  for (let i = 0; i < 5; i++) g.throwBall(0.7, 0.1);
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const back = Game.restore(snap);
  ok('a snapshot round-trips', !!back);
  eq('the score survives', back.scores.you, g.scores.you);
  eq('the ball number survives', back.ball, g.ball);
  eq('the round survives', back.round, g.round);
  eq('the rules survive', back.rounds, 3);
  eq('so does the difficulty', back.difficulty, 'hard');
  eq('and so does the tally the recorder reads', back.tally.balls, g.tally.balls);
}
ok('a corrupt save is "no game to resume", never a crash', Game.restore({ v: 9, junk: true }) === null);
ok('so is nonsense', Game.restore(null) === null && Game.restore('nope') === null);
{
  const half = Game.restore({ v: 1, rounds: 1, difficulty: 'medium', round: 1, ball: 4, turn: 'you' });
  ok('a save missing its scores restores at zero rather than NaN',
    half && half.scores.you === 0 && half.scores.opp === 0);
}

// --- the opponent ---------------------------------------------------------------------------------------

console.log('\n-- the opponent --');
{
  const score = (diff) => {
    const rng = seeded(99);
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const plan = aiThrow(rng, diff, '50');
      total += resolveThrow(plan.power, plan.aim).points;
    }
    return total / 400;
  };
  const easy = score('easy'), medium = score('medium'), hard = score('hard');
  console.log(`      avg points per ball: easy ${easy.toFixed(1)}, medium ${medium.toFixed(1)}, hard ${hard.toFixed(1)}`);
  ok('harder opponents score more per ball than easier ones', easy < medium && medium < hard);
  ok('even Hard is beatable - it does not throw a perfect 50 every time', hard < 50);
  ok('even Easy gets on the board', easy > 5);
}
// The per-ball averages above are measured WITHOUT the x3 badge, which understates every tier -
// the AI chases the badge, and chasing it is worth up to 300 a ball. So the tiers are also checked
// where it actually matters: full matches, multiplier applied, against a fixed simulated human.
// This is the check that caught Easy being a 57% coin flip for a player who had not yet worked out
// that the badge IS the game. Ranges are wide on purpose - this is a "the tiers are still in the
// right order and still in the right ballpark" tripwire, not a pin on the exact tuning.
console.log('\n-- the opponent, over whole matches (the multiplier changes everything) --');
{
  const winRate = (diff, human) => {
    let won = 0;
    for (let n = 0; n < 300; n++) {
      const rng = seeded(4000 + n);
      const g = new Game({ rounds: 1, difficulty: diff, rng });
      while (!g.over) {
        if (g.turn === 'you') {
          const ideal = idealThrow(human.chases ? g.multTarget : '40');
          g.throwBall(ideal.power + gauss(rng) * human.pw, ideal.aim + gauss(rng) * human.aim);
        } else { const p = g.aiPlan(); g.throwBall(p.power, p.aim); }
      }
      if (g.winner === 'you') won++;
    }
    return Math.round((won / 300) * 100);
  };
  const casual = { chases: false, pw: 0.13, aim: 0.22 };
  const decent = { chases: true, pw: 0.075, aim: 0.13 };
  const ce = winRate('easy', casual), cm = winRate('medium', casual), ch = winRate('hard', casual);
  const de = winRate('easy', decent), dm = winRate('medium', decent), dh = winRate('hard', decent);
  console.log(`      casual player wins: easy ${ce}%, medium ${cm}%, hard ${ch}%`);
  console.log(`      player who chases the badge wins: easy ${de}%, medium ${dm}%, hard ${dh}%`);
  ok('the tiers stay in order for a casual player', ce > cm && cm > ch);
  ok('and for a player who chases the badge', de > dm && dm > dh);
  ok('EASY is actually easy for someone who has not learned the badge yet (>65%)', ce > 65);
  ok('MEDIUM is a real contest for them, not a wall (15-60%)', cm > 15 && cm < 60);
  ok('HARD is beatable by a player who HAS learned it (>20%)', dh > 20);
  ok('but Hard is not a pushover even for them (<80%)', dh < 80);
  ok('learning to chase the badge is worth a lot on every tier',
    de > ce && dm > cm && dh > ch);
}

{
  const rng = seeded(5);
  ok('every AI throw is within the legal input range',
    Array.from({ length: 500 }, () => aiThrow(rng, 'medium', '100L'))
      .every((p) => p.power >= 0 && p.power <= 1 && p.aim >= -1 && p.aim <= 1
        && Number.isFinite(p.power) && Number.isFinite(p.aim)));
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
