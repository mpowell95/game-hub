// skeeball/js/test.js - headless assertions for the Skeeball engine and its boards.
// Run: node skeeball/js/test.js  (also in run-all-tests.mjs). No DOM, no canvas.

import { Game, resolveThrow, idealThrow, BALLS_PER_RACK, MULTIPLIER,
  flickToThrow, FLICK, SHORT_BELOW, OVER_ABOVE } from './game.js';
import { BOARDS, boardById, nextBoard, multTargetsFor, DEFAULT_BOARD } from './boards.js';

let fail = 0;
function ok(label, cond) {
  if (!cond) { fail++; console.log(`FAIL  ${label}`); } else console.log(`ok    ${label}`);
}
function eq(label, got, want) { ok(`${label} (got ${JSON.stringify(got)})`, got === want); }
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const classic = boardById('classic');

console.log('\n-- every board is well formed --');
for (const b of BOARDS) {
  ok(`${b.id}: has a name key and a palette`, !!b.nameKey && !!b.palette && !!b.palette.field);
  ok(`${b.id}: every target has an id, an ellipse and points`,
    b.targets.length > 0 && b.targets.every((t) => t.id && t.rx > 0 && t.ry > 0 && t.points > 0));
  ok(`${b.id}: target ids are unique`, new Set(b.targets.map((t) => t.id)).size === b.targets.length);
  ok(`${b.id}: ends with a catch-all ring, so a ball on the playfield always scores something`,
    b.targets[b.targets.length - 1].kind === 'ring');
  ok(`${b.id}: the badge never sits on the catch-all`, !multTargetsFor(b).includes(b.targets[b.targets.length - 1].id));
}
eq('the first board is the default', BOARDS[0].id, DEFAULT_BOARD);
eq('and it is free', BOARDS[0].unlockScore, 0);
ok('every later board costs something', BOARDS.slice(1).every((b) => b.unlockScore > 0));

console.log('\n-- throw resolution on classic --');
eq('a feeble flick never reaches the board', resolveThrow(0.04, 0, classic).kind, 'short');
eq('and scores nothing', resolveThrow(0.04, 0, classic).points, 0);
// The dead zone is DELIBERATELY tiny now. 0.1 used to be a total airball; after the 2026-08-11
// retune it is a real (weak) throw that trickles into the 10, which is what the machine does.
eq('but a merely weak one still reaches the 10', resolveThrow(0.11, 0, classic).target, '10');
eq('flat out sails over the back', resolveThrow(1, 0, classic).kind, 'over');
eq('and scores nothing either', resolveThrow(1, 0, classic).points, 0);
// The catch-all is excluded on purpose: its centre sits under the cup stack, which is tested
// FIRST, so "aim at the middle of the 10" correctly lands in a cup. That is the design, not a gap.
ok('every ideal throw lands on the target it names',
  classic.targets.filter((t) => t.kind !== 'ring').every((t) => {
    const { power, aim } = idealThrow(t.id, classic);
    return resolveThrow(power, aim, classic).target === t.id;
  }));
// Swept between the ENGINE's own band edges, not literals: these used to read `0.29 + i/300*0.64`,
// which was the old SHORT_BELOW/OVER_ABOVE pair frozen into the test, so after a retune they would
// have gone on testing a range the engine no longer uses.
const band = (n) => Array.from({ length: n }, (_, i) => SHORT_BELOW + ((i + 0.5) / n) * (OVER_ABOVE - SHORT_BELOW));
ok('the whole usable power range scores SOMETHING straight down the middle - no dead band',
  band(400).every((p) => resolveThrow(p, 0, classic).points > 0));
{
  // Power alone walks the stack front to back: 20 -> 30 -> 40 -> 50.
  const seen = [];
  for (const p of band(200)) {
    const r = resolveThrow(p, 0, classic);
    if (r.target && r.target !== seen[seen.length - 1]) seen.push(r.target);
  }
  ok(`power walks the stack in order (${seen.join(' -> ')})`,
    seen.indexOf('20') < seen.indexOf('30') && seen.indexOf('30') < seen.indexOf('40')
    && seen.indexOf('40') < seen.indexOf('50'));
}

console.log('\n-- the corner cups --');
{
  const L = idealThrow('100L', classic), Rr = idealThrow('100R', classic);
  eq('a hard, wide throw left finds the left cup', resolveThrow(L.power, L.aim, classic).target, '100L');
  eq('and right, the right cup', resolveThrow(Rr.power, Rr.aim, classic).target, '100R');
  eq('a cup pays 100', resolveThrow(L.power, L.aim, classic).points, 100);
  eq('wide but WEAK misses it', resolveThrow(0.45, L.aim, classic).target, '10');
  // Dead centre at the 50's OWN power is the 50; the cups' power and the cups' aim are separate
  // skills and neither one alone gets you a 100.
  eq('straight, at the 50\'s power, is the 50 - never a corner cup',
    resolveThrow(idealThrow('50', classic).power, 0, classic).target, '50');
  // A 100 is purely an AIM shot: it sits level with the 50, so its power alone just gives you the
  // 50. That is the design - the two skills are separated, and neither one alone pays 100.
  eq('the 100s power with NO aim is simply the 50',
    resolveThrow(L.power, 0, classic).target, '50');
}

console.log('\n-- the cups do NOT tile: there is room to miss (Matt: "the balls are guided in") --');
{
  const cups = classic.targets.filter((t) => t.kind === 'cup').sort((a, b) => a.y - b.y);
  for (let i = 0; i < cups.length - 1; i++) {
    const gap = (cups[i + 1].y - cups[i + 1].ry) - (cups[i].y + cups[i].ry);
    ok(`${cups[i].id} -> ${cups[i + 1].id}: a real gap between them (${gap.toFixed(3)})`, gap > 0.01);
  }
  // The observable consequence, and the one that actually makes it a game: sweeping power straight
  // down the middle must FALL OUT of the stack between cups, not slide seamlessly from one to the
  // next. If this goes green-to-red, the catch areas have started overlapping again.
  const seq = [];
  for (const p of band(400)) {
    const r = resolveThrow(p, 0, classic);
    const id = r.target || 'none';
    if (id !== seq[seq.length - 1]) seq.push(id);
  }
  const tens = seq.filter((x) => x === '10').length;
  ok(`the 10 is entered and left several times while sweeping power (${tens} times)`, tens >= 3);
  ok('every cup is still reachable straight down the middle',
    ['20', '30', '40', '50'].every((id) => seq.includes(id)));
}

console.log('\n-- the gesture: a swipe becomes a throw (Matt: "the flick is really bad and unnatural") --');
{
  // A REALISTIC GESTURE, parameterised the way a hand actually makes one: you flick at some speed
  // for some duration, so the distance you cover is speed x duration rather than a free variable.
  // 130ms is an ordinary thumb flick.
  const flick = (speed, deg = 0, ms = 130) => {
    const a = (deg * Math.PI) / 180;
    const d = speed * (ms / 1000);
    return flickToThrow({
      dx: d * Math.sin(a), dy: -d * Math.cos(a),
      vx: speed * Math.sin(a), vy: -speed * Math.cos(a),
    });
  };

  ok('a flick is a throw', !!flick(3.0));
  ok('a HARDER flick throws harder - speed is what power means now',
    flick(4.2).power > flick(3.0).power && flick(3.0).power > flick(1.6).power);
  ok('a slow deliberate push still throws, but gently (this is the old model\'s ONLY input)',
    flickToThrow({ dx: 0, dy: -0.5, vx: 0, vy: -0.2 }).power < flick(3.0).power);
  // The four failures the rewrite is FOR. Each one is a [KNOWN-BUG PROBE] against the old
  // distance-from-touch-down model, and each would pass trivially under it.
  ok('[KNOWN-BUG PROBE] the same DISTANCE thrown fast beats the same distance thrown slow',
    flickToThrow({ dx: 0, dy: -0.4, vx: 0, vy: -3.6 }).power
      > flickToThrow({ dx: 0, dy: -0.4, vx: 0, vy: -0.9 }).power + 0.2);
  ok('[KNOWN-BUG PROBE] you can WIND UP: pulling back first does not weaken the flick',
    // net displacement is small because the hand went down before it went up; only the release
    // window counts, so this must still be a strong throw.
    flickToThrow({ dx: 0, dy: -0.12, vx: 0, vy: -3.6 }).power > 0.5);
  ok('[KNOWN-BUG PROBE] aim is the swipe ANGLE, so it does not change with how hard you throw',
    Math.abs(flick(1.8, 12).aim - flick(4.4, 12).aim) < 0.001);
  ok('[KNOWN-BUG PROBE] yanking the finger back at the end is a cancelled throw, not a hard one',
    flickToThrow({ dx: 0, dy: -0.4, vx: 0, vy: +3.0 }) === null);
  ok('a tap is not a throw', flickToThrow({ dx: 0, dy: -0.004, vx: 0, vy: -0.02 }) === null);
  ok('and neither is nonsense', flickToThrow(null) === null
    && flickToThrow({ dx: NaN, dy: -1, vx: 0, vy: -1 }) === null);
  ok('a swipe left aims left, a swipe right aims right',
    flick(3.0, -14).aim < 0 && flick(3.0, 14).aim > 0);
  ok('every flick in the usable speed range produces a legal throw',
    Array.from({ length: 200 }, (_, i) => FLICK.MIN_SPEED + (i / 200) * (FLICK.MAX_SPEED - FLICK.MIN_SPEED))
      .every((sp) => { const f = flick(sp); return f && f.power >= 0 && f.power <= 1; }));
}

console.log('\n-- [KNOWN-BUG PROBE] a HAND can actually hit these (Matt: "SKEEBALL IS TERRIBLE") --');
{
  // THE TEST THAT WAS MISSING, now in the units the player actually controls.
  //
  // This game has been mistuned twice, and both times because its difficulty was judged in
  // board-space fractions - numbers that say nothing about whether a person can hit anything.
  // First the cups tiled and every throw sank ("the balls are guided in"); then the fix made each
  // cup a sliver and six balls scored 40 points.
  //
  // So: sweep the thing a hand varies - FLICK SPEED - and check each cup owns a band of it wide
  // enough to aim for. A person can repeat a flick speed to roughly +-15%, so a cup whose band is
  // narrower than that is a coin toss however good the numbers look in board space.
  const MS = 130;
  const throwAt = (speed, deg = 0) => {
    const a = (deg * Math.PI) / 180;
    const d = speed * (MS / 1000);
    const f = flickToThrow({
      dx: d * Math.sin(a), dy: -d * Math.cos(a),
      vx: speed * Math.sin(a), vy: -speed * Math.cos(a),
    });
    return f ? resolveThrow(f.power, f.aim, classic) : { kind: 'none', target: null, points: 0 };
  };

  const band = {};
  const LO = 0.2, HI = 7.0, STEP = 0.002;
  for (let sp = LO; sp <= HI; sp += STEP) {
    const r = throwAt(sp);
    const k = r.kind === 'hit' ? r.target : r.kind;
    band[k] = (band[k] || 0) + STEP;
  }
  for (const id of ['20', '30', '40', '50']) {
    // As a percentage of the speed you need to reach that cup, which is the only scale a hand
    // understands: "about 15% harder than the last one".
    const mid = (() => {
      for (let sp = LO; sp <= HI; sp += 0.01) if (throwAt(sp).target === id) return sp;
      return NaN;
    })();
    const pct = (100 * (band[id] || 0)) / mid;
    ok(`the ${id} owns ${pct.toFixed(0)}% of the flick speed it takes to reach it (need >= 12%)`, pct >= 12);
  }
  const dead = (band.short || 0) + (band.none || 0);
  ok(`throwing too softly to score wastes a narrow slice of the speed range (${dead.toFixed(2)} of ${(HI - LO).toFixed(1)})`,
    dead < (HI - LO) * 0.22);
  ok(`"Too hard!" needs a genuinely hard flick (${(band.over || 0).toFixed(2)} wide, and only at the top)`,
    (band.over || 0) > 0 && throwAt(FLICK.MAX_SPEED * 0.86).kind !== 'over');

  // Sideways, in DEGREES of swipe angle - also the units of the hand. Measured at the CENTRE of
  // each cup's speed band, not at its leading edge: a target is an ellipse, so sampling just
  // inside the near rim reports almost no sideways room and blames the aim axis for what is
  // really the depth axis. (It did exactly that on the first run of this block.)
  const centreSpeed = (id) => {
    let lo = null, hi = null;
    for (let sp = LO; sp <= HI; sp += 0.005) {
      if (throwAt(sp).target === id) { if (lo === null) lo = sp; hi = sp; }
    }
    return lo === null ? NaN : (lo + hi) / 2;
  };
  for (const id of ['20', '30', '40', '50']) {
    const mid = centreSpeed(id);
    let lo = null, hi = null;
    for (let deg = -40; deg <= 40; deg += 0.05) {
      if (throwAt(mid, deg).target === id) { if (lo === null) lo = deg; hi = deg; }
    }
    ok(`the ${id} tolerates +-${(((hi - lo) / 2) || 0).toFixed(1)} degrees of swipe angle (need >= 4)`,
      (hi - lo) / 2 >= 4);
  }

  // And the whole rack, thrown by a hand with ordinary jitter: +-12% on speed, +-4 degrees on
  // angle. This is the number Matt experiences. The build he recorded scored about 60.
  let s = 4242;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const aimFor = centreSpeed('40');
  let sum = 0, zeros = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const r = throwAt(aimFor * (1 + gauss() * 0.12), gauss() * 4);
    sum += r.points; if (!r.points) zeros++;
  }
  const perRack = (sum / N) * BALLS_PER_RACK;
  ok(`a casual player (+-12% speed, +-4 degrees) averages a real rack: ${Math.round(perRack)} (need 150-450)`,
    perRack >= 150 && perRack <= 450);
  ok(`and almost never whiffs entirely: ${(100 * zeros / N).toFixed(1)}% of throws (need < 5%)`,
    zeros / N < 0.05);
}

console.log('\n-- banking off a rail --');
{
  const banked = resolveThrow(0.95, 1, classic);
  ok('a full-tilt aim reaches the rail and bounces', banked.bounces >= 1);
  ok('and the bounce costs it energy', banked.energy < 0.95);
  ok('the arrival offset always folds back inside the lane',
    Array.from({ length: 400 }, (_, i) => -1 + (i / 200))
      .every((a) => Math.abs(resolveThrow(0.8, a, classic).offset) <= 1.0000001));
}

console.log('\n-- purity --');
ok('the same throw always scores the same',
  Array.from({ length: 50 }, () => resolveThrow(0.717, -0.313, classic).target)
    .every((x, _, arr) => x === arr[0]));
ok('a throw resolves differently on a different board (the layout IS the difficulty)',
  BOARDS.length < 2 || resolveThrow(0.62, 0, BOARDS[0]).points !== resolveThrow(0.62, 0, BOARDS[1]).points
    || resolveThrow(0.62, 0.5, BOARDS[0]).target !== resolveThrow(0.62, 0.5, BOARDS[1]).target);

console.log('\n-- the multiplier --');
{
  const g = new Game({ rng: seeded(7) });
  ok('the badge sits on a real, non-catch-all target', multTargetsFor(classic).includes(g.multTarget));
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(g.rollMultiplier());
  eq('and reaches every one of them over time', seen.size, multTargetsFor(classic).length);
}
{
  const g = new Game({ rng: seeded(3) });
  g.multTarget = '50';
  const { power, aim } = idealThrow('50', classic);
  const out = g.throwBall(power, aim);
  eq('hitting the multiplied target triples it', out.scored, 50 * MULTIPLIER);
  ok('and says so', out.multiplied === true);
}
{
  const g = new Game({ rng: seeded(3) });
  g.multTarget = '100L';
  const { power, aim } = idealThrow('40', classic);
  eq('missing it pays face value', g.throwBall(power, aim).scored, 40);
}

console.log('\n-- a rack --');
{
  const g = new Game({ rng: seeded(11) });
  eq('nine balls', g.ballsLeft, BALLS_PER_RACK);
  for (let i = 0; i < BALLS_PER_RACK; i++) g.throwBall(0.5, 0);
  ok('the rack ends after nine', g.over);
  eq('and none are left', g.ballsLeft, 0);
  ok('a throw after the end is refused, not scored', g.throwBall(0.9, 0) === null);
}
{
  const g = new Game({ rng: seeded(13) });
  g.multTarget = '20';
  const cup = idealThrow('100L', classic);
  g.throwBall(cup.power, cup.aim);
  g.multTarget = '20';
  const fifty = idealThrow('50', classic);
  g.throwBall(fifty.power, fifty.aim);
  eq('cups are tallied', g.tally.hundreds, 1);
  eq('so are 50s', g.tally.fifties, 1);
  eq('best throw is the biggest single one', g.tally.bestThrow, 100);
  eq('balls thrown counts every ball', g.tally.balls, 2);
}

console.log('\n-- unlocking --');
{
  const nxt = nextBoard('classic');
  ok('classic leads somewhere', !!nxt);
  const low = new Game({ rng: seeded(21) });
  for (let i = 0; i < BALLS_PER_RACK; i++) low.throwBall(0.03, 0);   // nine airballs
  eq('a rack of nothing scores nothing', low.score, 0);
  ok('and unlocks nothing', low.unlocks() === null);

  const high = new Game({ rng: seeded(22) });
  high.multTarget = '20';
  const cup = idealThrow('100L', classic);
  for (let i = 0; i < BALLS_PER_RACK; i++) { high.multTarget = '20'; high.throwBall(cup.power, cup.aim); }
  eq('nine 100s is 900', high.score, 900);
  ok('which clears the target and unlocks the next machine', high.unlocks() === nxt);
  ok('the target is reachable but not trivial (a perfect rack is well over it)',
    nxt.unlockScore > 0 && nxt.unlockScore < 900);
  const last = new Game({ board: BOARDS[BOARDS.length - 1].id, rng: seeded(23) });
  ok('the final board unlocks nothing (no phantom next machine)', last.unlocks() === null);
}

console.log('\n-- save and resume --');
{
  const g = new Game({ board: 'stars', rng: seeded(31) });
  for (let i = 0; i < 4; i++) g.throwBall(0.7, 0.1);
  const back = Game.restore(JSON.parse(JSON.stringify(g.snapshot())));
  ok('a snapshot round-trips', !!back);
  eq('the score survives', back.score, g.score);
  eq('the ball number survives', back.ball, g.ball);
  eq('the MACHINE survives', back.board.id, 'stars');
  eq('and so does the tally the recorder reads', back.tally.balls, g.tally.balls);
}
ok('a corrupt save is "no game to resume", never a crash', Game.restore({ v: 9, junk: true }) === null);
ok('so is nonsense', Game.restore(null) === null && Game.restore('nope') === null);
ok('a v1 save from the vs-computer build is declined, not misread',
  Game.restore({ v: 1, rounds: 1, difficulty: 'medium', scores: { you: 100, opp: 0 } }) === null);
{
  const half = Game.restore({ v: 2, board: 'classic', ball: 4 });
  ok('a save missing its score restores at zero rather than NaN', half && half.score === 0);
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
process.exit(fail ? 1 : 0);
