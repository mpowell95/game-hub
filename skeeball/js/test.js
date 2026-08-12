// skeeball/js/test.js - headless assertions for the Skeeball engine and its boards.
// Run: node skeeball/js/test.js  (also in run-all-tests.mjs). No DOM, no canvas.

import { Game, resolveThrow, idealThrow, BALLS_PER_RACK, MULTIPLIER,
  flickToThrow, FLICK, SHORT_BELOW, WALL_AT, WALL_RETURN, RAIL_X, laneOffsetAt } from './game.js';
import { BOARDS, boardById, nextBoard, multTargetsFor, DEFAULT_BOARD } from './boards.js';
import * as R from './render.js';

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
  // The catch-all must CONTAIN every point a ball can land on - |x| up to the rails, y 0..1.
  // The old 1.05 x 0.55 ellipse quietly did not: a deep banked ball at (0.5, 0.98) fell outside
  // it and scored a zero "Missed!" on a ball that was sitting on the board.
  const ten = b.targets[b.targets.length - 1];
  let covered = true;
  for (let x = -RAIL_X; x <= RAIL_X; x += RAIL_X / 10) {
    for (let y = 0; y <= 1.0001; y += 0.05) {
      if (((x - ten.x) / ten.rx) ** 2 + ((y - ten.y) / ten.ry) ** 2 > 1) covered = false;
    }
  }
  ok(`${b.id}: the catch-all covers the WHOLE reachable board - no zero-scoring corner`, covered);
  // Nested zones must be ordered innermost first, or an outer ring would swallow the inner ones.
  const zones = b.targets.filter((t) => t.kind === 'zone');
  ok(`${b.id}: zones are hit-tested innermost first`,
    zones.every((t, i) => i === 0 || zones[i - 1].rx < t.rx));
  ok(`${b.id}: every zone has an aimY in its own front band (its centre is under the inner rings)`,
    zones.every((t) => Number.isFinite(t.aimY) && t.aimY > t.y - t.ry && t.aimY <= t.y));
}
eq('the first board is the default', BOARDS[0].id, DEFAULT_BOARD);
eq('and it is free', BOARDS[0].unlockScore, 0);
ok('every later board costs something', BOARDS.slice(1).every((b) => b.unlockScore > 0));

console.log('\n-- throw resolution on classic --');
eq('a feeble flick never reaches the board', resolveThrow(0.04, 0, classic).kind, 'short');
eq('and scores nothing', resolveThrow(0.04, 0, classic).points, 0);
// The dead zone is DELIBERATELY tiny. 0.1 used to be a total airball; it is a real (weak) throw
// that trickles into the 10, which is what the machine does.
eq('but a merely weak one still reaches the 10', resolveThrow(0.11, 0, classic).target, '10');
// EVERY target, the nested zones and the 10 included: aimY names a point in each target's own
// exclusive territory, so "aim at the 20" means the 20's front band, not the buried centre.
ok('every ideal throw lands on the target it names',
  classic.targets.every((t) => {
    const { power, aim } = idealThrow(t.id, classic);
    return resolveThrow(power, aim, classic).target === t.id;
  }));
// Swept between the ENGINE's own band edges, not literals: these used to read `0.29 + i/300*0.64`,
// which was an old retired pair frozen into the test, so after a retune they would have gone on
// testing a range the engine no longer uses.
const band = (n) => Array.from({ length: n }, (_, i) => SHORT_BELOW + ((i + 0.5) / n) * (1 - SHORT_BELOW));
{
  // Power alone walks the ladder front to back: 20 -> 30 -> 40 -> 50.
  const seen = [];
  for (const p of band(200)) {
    const r = resolveThrow(p, 0, classic);
    if (r.target && r.target !== seen[seen.length - 1]) seen.push(r.target);
  }
  ok(`power walks the rings in order (${seen.join(' -> ')})`,
    seen.indexOf('20') < seen.indexOf('30') && seen.indexOf('30') < seen.indexOf('40')
    && seen.indexOf('40') < seen.indexOf('50'));
}

console.log('\n-- the corner cups --');
{
  const L = idealThrow('100L', classic), Rr = idealThrow('100R', classic);
  eq('a hard, wide throw left finds the left cup', resolveThrow(L.power, L.aim, classic).target, '100L');
  eq('and right, the right cup', resolveThrow(Rr.power, Rr.aim, classic).target, '100R');
  eq('a cup pays 100', resolveThrow(L.power, L.aim, classic).points, 100);
  ok('wide but WEAK never reaches it - it lands in a low ring instead',
    ['10', '20', '30'].includes(resolveThrow(0.30, L.aim, classic).target));
  // Dead centre at the 50's OWN power is the 50; the cups' power and the cups' aim are separate
  // skills and neither one alone gets you a 100.
  eq('straight, at the 50\'s power, is the 50 - never a corner cup',
    resolveThrow(idealThrow('50', classic).power, 0, classic).target, '50');
  // A 100 is purely an AIM shot: it sits level with the ring stack, so its power alone just gives
  // you a ring. The two skills are separated, and neither one alone pays 100.
  ok('the 100s power with NO aim is simply a ring',
    ['40', '50'].includes(resolveThrow(L.power, 0, classic).target));
}

console.log('\n-- [KNOWN-BUG PROBE] THE RINGS TILE: every ball on the board scores its ring --');
{
  // Matt's third set of recordings (`Skeeball - terrible 1..3.MOV`, 2026-08-12): ~24 throws,
  // virtually every one a 10, final rack 90. The cup-stack board those recordings caught had
  // dead 10-paying space between, below and beside every cup - roughly half the straight-line
  // power range - plus a zero above the top. The real machine has none of that: its rings are
  // NESTED, so every depth is inside exactly one ring and every ball that stays on the board
  // scores the ring it visibly lies in. This block is the permanent record of that requirement.
  //
  // 1. Every ball that REACHES the board scores. The only zero left in the whole game is a
  //    flick too feeble to make the ramp (kind 'short') - including one that arrived feeble
  //    because a full-tilt bank spent its energy on the rail.
  ok('every throw that reaches the board scores - zero now means "rolled back", nothing else',
    band(300).every((p) => [-1, -0.6, -0.3, 0, 0.3, 0.6, 1].every((a) => {
      const r = resolveThrow(p, a, classic);
      return r.points > 0 || r.kind === 'short';
    })));
  // 2. Straight down the middle, the ladder up to the 50 is strict - 10,20,30,40,50, never a 10
  //    sandwiched between two rings (that sandwich IS the dead space the recordings show). Past
  //    the 50 it walks back DOWN through the rings' back bands to the wall, in order - nested
  //    ovals, so long of the 50 is the 40's back arc, not a punishment bucket.
  const seq = [];
  for (const p of band(400)) {
    const r = resolveThrow(p, 0, classic);
    if (r.wall) break;                                  // the wall's walk-back is probe 3's job
    if (r.target !== seq[seq.length - 1]) seq.push(r.target);
  }
  const top = seq.indexOf('50');
  ok(`going up, the ladder is strict (${seq.join(' -> ')})`,
    top === 4 && ['10', '20', '30', '40', '50'].every((id, i) => seq.indexOf(id) === i));
  ok('and past the 50 it steps back down the nested rings, in order, no skips',
    seq.slice(top).every((id, i, a) => i === 0
      || ['50', '40', '30', '20', '10'].indexOf(id) === ['50', '40', '30', '20', '10'].indexOf(a[i - 1]) + 1));
  // 3. Past the wall the bounce WALKS BACK DOWN, strictly: more overshoot, shallower landing.
  //    This is what replaced "Too hard!" and its zero - a max flick is a bad throw that still
  //    scores, not a scolding.
  const wallPowers = band(300).filter((p) => resolveThrow(p, 0, classic).wall);
  ok(`enough of the top of the range hits the wall to matter (${wallPowers.length} samples)`, wallPowers.length > 20);
  ok('every wall hit still scores', wallPowers.every((p) => resolveThrow(p, 0, classic).points > 0));
  ok('and more overshoot lands strictly shallower - the reflection is monotonic',
    wallPowers.every((p, i) => i === 0
      || resolveThrow(p, 0, classic).y <= resolveThrow(wallPowers[i - 1], 0, classic).y + 1e-9));
  ok('flat out does NOT pay the top ring - slamming is legal but wrong',
    resolveThrow(1, 0, classic).points < 50);
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
    // As a percentage of the speed you need to reach that ring, which is the only scale a hand
    // understands: "about 15% harder than the last one". A person repeats a flick speed to about
    // +-15%, so a band below that is a coin toss. The cup-stack board Matt recorded gave ~10%
    // windows WITH dead space between them; the rings give 45%+ and tile.
    const mid = (() => {
      for (let sp = LO; sp <= HI; sp += 0.01) if (throwAt(sp).target === id) return sp;
      return NaN;
    })();
    const pct = (100 * (band[id] || 0)) / mid;
    ok(`the ${id} owns ${pct.toFixed(0)}% of the flick speed it takes to reach it (need >= 15%)`, pct >= 15);
  }
  const dead = (band.short || 0) + (band.none || 0) + (band.miss || 0);
  ok(`only a genuinely feeble flick scores nothing (${dead.toFixed(2)} of ${(HI - LO).toFixed(1)} ch/s, all at the bottom)`,
    dead < (HI - LO) * 0.22 && (band.miss || 0) === 0 && throwAt(FLICK.MAX_SPEED).points > 0);

  // Sideways, in DEGREES of swipe angle - also the units of the hand. Measured at the CENTRE of
  // each ring's FIRST speed band (the front band - rings also own a sliver at the back and a
  // second slice off the wall bounce, which are bonuses, not the aiming surface).
  const centreSpeed = (id) => {
    let lo = null, hi = null;
    for (let sp = LO; sp <= HI; sp += 0.005) {
      const k = throwAt(sp).target;
      if (k === id && lo === null) lo = sp;
      if (lo !== null) { if (k === id) hi = sp; else break; }
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
  // angle, aiming where a player actually aims - the 50. This is the number Matt experiences.
  // The build his recordings caught scored ~90 A RACK; the machine this clones plays at several
  // hundred, and so does this one now.
  let s = 4242;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const aimFor = centreSpeed('50');
  let sum = 0, zeros = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const r = throwAt(aimFor * (1 + gauss() * 0.12), gauss() * 4);
    sum += r.points; if (!r.points) zeros++;
  }
  const perRack = (sum / N) * BALLS_PER_RACK;
  ok(`a casual player (+-12% speed, +-4 degrees, aiming the 50) averages a real rack: ${Math.round(perRack)} (need 280-470)`,
    perRack >= 280 && perRack <= 470);
  ok(`and essentially never whiffs: ${(100 * zeros / N).toFixed(1)}% of throws (need < 2%)`,
    zeros / N < 0.02);
  // Control must still beat muscle: the same jittery hand slamming every ball flat out must
  // score meaningfully less than the one aiming the 50.
  let slam = 0;
  for (let i = 0; i < N; i++) slam += throwAt(FLICK.MAX_SPEED * (1 + Math.abs(gauss() * 0.12)), gauss() * 4).points;
  ok(`slamming every ball scores less than aiming (${Math.round((slam / N) * BALLS_PER_RACK)} vs ${Math.round(perRack)})`,
    slam / N < 0.8 * (sum / N));
}

console.log('\n-- [KNOWN-BUG PROBE] THE HOLES DO NOT ATTRACT THE BALL --');
{
  // Matt, twice: "the balls are guided in. That's not fun", and then "the balls move slightly in
  // the air towards the holes. It's like the holes attract the ball. The ball deviates from the
  // path it should be on and moves towards the hole. Why? This is not realistic. It's dumb and it
  // ruins the game." Followed by: "Remove the below permanently. NEVER add them back."
  //
  // The ball never moved. What moved was the truth: the catch ellipse was bigger than the hole
  // being painted, so a ball that came to rest BESIDE a cup was scored into it and then drawn
  // sinking through the floor next to it. First `rx` was drawn at 0.86 of the catch; that was
  // fixed and `ry` was left at nearly TWICE the depth of the drawn mouth, which nothing noticed
  // because nobody had ever compared the two. Measured on that build: 62% of throws scored as a
  // cup landed outside the visible hole, the worst 3.1x its radius away.
  //
  // THIS IS THE ASSERTION THAT MAKES IT PERMANENT. Every throw that scores a target must come to
  // rest inside the ellipse render.js paints for that target. Not near it. Inside it.
  // Measured in DESIGN PIXELS past the drawn edge, not as a ratio: a board-space ellipse does not
  // project to an exact screen ellipse (bz is nonlinear in depth), so a few throws sit a fraction
  // of a pixel proud of the painted rim. The worst is 0.21 design px - about a sixth of a CSS
  // pixel on a phone. A threshold of 1px is therefore "the ball is in the hole" and would still
  // catch the 3.1x-radius miss this block exists for by a factor of hundreds.
  let checked = 0, outside = 0, worst = 0, worstId = '';
  for (const b of BOARDS) {
    for (let p = 0.03; p <= 1; p += 0.0015) {
      for (const a of [-1, -0.7, -0.4, -0.15, 0, 0.15, 0.4, 0.7, 1]) {
        const r = resolveThrow(p, a, b);
        if (r.kind !== 'hit' || !r.target) continue;
        const t = b.targets.find((z) => z.id === r.target);
        if (t.kind === 'ring') continue;          // the catch-all is the floor, not a hole
        checked += 1;
        if (t.kind === 'zone') {
          // A zone's drawn rim IS its scoring ellipse - render.js's zonePath traces the same
          // board-space boundary through the same projection, point for point - so the check is
          // containment in board space, where both live. And the innermost-first rule: the ball
          // must not also be inside a zone tested EARLIER (that would mean the order lies).
          const inside = ((r.x - t.x) / t.rx) ** 2 + ((r.y - t.y) / t.ry) ** 2 <= 1 + 1e-9;
          const zs = b.targets.filter((z) => z.kind === 'zone');
          const earlier = zs.slice(0, zs.indexOf(t));
          const inEarlier = earlier.some((z) => ((r.x - z.x) / z.rx) ** 2 + ((r.y - z.y) / z.ry) ** 2 <= 1 - 1e-9);
          if (!inside || inEarlier) { outside += 1; worstId = `${b.id}/${t.id}`; }
          continue;
        }
        const land = R.boardPoint(r.x, Math.min(0.97, r.y));
        const m = R.mouthOf(t);
        const d = Math.hypot((land.x - m.x) / m.rx, (land.y - m.y) / m.ry);
        const px = (d - 1) * Math.min(m.rx, m.ry);
        if (px > 1) { outside += 1; if (px > worst) { worst = px; worstId = `${b.id}/${t.id}`; } }
      }
    }
  }
  ok(`every one of ${checked} scoring throws comes to rest INSIDE the hole it scored`
    + (outside ? ` - ${outside} did not, worst ${worst.toFixed(1)}px out on ${worstId}` : ''),
    outside === 0);
}

console.log('\n-- [KNOWN-BUG PROBE] the rails are where the lane actually is --');
{
  // RAIL_X is the one number the engine and the renderer have to agree on: it says the lane's
  // edges are at board x +-0.616 because the lane is narrower than the bowl it feeds. Derive the
  // same ratio from the DRAWN geometry and check they match.
  //
  // They did not used to. The lateral model was in lane-fractions and the bowl reused those as
  // bowl-fractions, so crossing the ramp shifted the ball 63px further out - three times the size
  // of a bounce, and in the opposite direction, which is why Matt could not see the bounce at all:
  // "it bounces off the wall, but then continues on the line it originally was on."
  const laneTopHalf = R.lanePoint(1, 1).x - R.lanePoint(1, 0).x;
  const bowlLipHalf = R.boardPoint(1, 0).x - R.boardPoint(0, 0).x;
  const drawn = laneTopHalf / bowlLipHalf;
  ok(`RAIL_X ${RAIL_X} matches the drawn lane/bowl ratio ${drawn.toFixed(4)}`,
    Math.abs(drawn - RAIL_X) < 0.005);

  // And the consequence, which is the thing a player sees: a throw wide enough to bank must come
  // OFF the rail and keep coming, never turn round and head back into it.
  const xs = Array.from({ length: 400 }, (_, i) => laneOffsetAt(1, i / 399).u);
  const peak = Math.max(...xs.map(Math.abs));
  const peakAt = xs.findIndex((x) => Math.abs(x) === peak);
  ok(`a full-tilt aim reaches the rail (peaks at ${peak.toFixed(4)} against RAIL_X ${RAIL_X})`,
    Math.abs(peak - RAIL_X) < 0.005);
  ok('and then comes back off it', Math.abs(xs[xs.length - 1]) < peak - 1e-6);
  ok('every step after the bounce moves INWARD - never a reversal back toward the wall',
    xs.slice(peakAt).every((x, i, a) => i === 0 || Math.abs(x) <= Math.abs(a[i - 1]) + 1e-9));
  ok('the ball never ends up outside the rails', xs.every((x) => Math.abs(x) <= RAIL_X + 1e-6));

  // Every reachable target must actually be reachable, which is what +-0.75 stopped being.
  for (const b of BOARDS) {
    const maxX = Math.max(...Array.from({ length: 200 },
      (_, i) => Math.abs(laneOffsetAt(1, i / 199).u)));
    const unreachable = b.targets.filter((t) => t.kind !== 'ring' && Math.abs(t.x) - t.rx > maxX);
    ok(`${b.id}: no target sits outside the widest a throw can go (${unreachable.map((t) => t.id).join(',') || 'none'})`,
      unreachable.length === 0);
  }
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
