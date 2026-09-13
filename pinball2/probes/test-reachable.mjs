// CAN THE PLAYER REACH THE BALL? The probe this folder did not have, and the reason PIER NINE
// shipped unplayable with every other probe green.
//
// Matt, on the first real game of the shipped build: *"All I was able to do was press start. I did
// not have another chance to touch the ball before the game ended. Didn't flip the flipper once."*
// The table had 0 traps in 1,767 drops, 0 escapes in 42,984, 0 tunnels in 2,832 and 0 ambiguous
// gaps. Every one of those asks about the BALL. None of them asks about the PLAYER.
//
// Two numbers, and they are the two that would have caught it:
//
//   1. TIME TO FIRST REACHABLE - from the plunge, how long before the ball is on the deck, in the
//      lower third, and not in the shooter lane. On the shipped build this was 7.4 s of a 9.3 s
//      ball, because the ball was caged in the pop nest by a badly placed one-way gate.
//   2. DOES INPUT CHANGE THE OUTCOME - the same game played twice, once untouched and once with a
//      robot flipping whenever the ball is in range. If the two scores are equal the flippers are
//      not connected to anything, which was ALSO true: an instantaneous tap moved the bat for 0
//      frames because the press and the release landed in the same animation frame.
//
// **WHAT THIS PROBE CANNOT CATCH, measured rather than assumed.** It runs headless and calls
// `setFlipper` directly, which is exactly what the browser's tap bug did NOT do - so assertion 2
// PASSES against the shipped build (232,020 flipped against 45,120 idle) even though a real tap on
// a real phone moved the bat for zero frames. Only assertion 1 is born red there, at 7.4 s. The
// 75 ms minimum flip in `game.js` lives in the page and can only be checked in a browser; that is
// a hole in this file and it is named here rather than left implied.
//
//   node pinball2/probes/test-reachable.mjs

import { World } from '../machines/testbox/physics.js';
import { CONFIG } from '../machines/testbox/config.js';
import { makePierNine } from '../machines/testbox/tables/piernine.js';
import { createRules } from '../piernine/rules.js';

const cfg = CONFIG;
let pass = 0;
let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`ok    ${m}`); } else { fail++; console.log(`FAIL  ${m}`); } };

/** On the deck, in the lower third, and out of the shooter lane: somewhere a bat can be aimed. */
const reachable = (b) => !b.ribbon && !b.held && b.p.y > 0.78 && b.p.y < 0.99 && b.p.x > 0.06 && b.p.x < 0.44;

function game(useFlippers) {
  const table = makePierNine();
  const world = new World(table, cfg);
  const rules = createRules(world, table);
  rules.newGame();
  let first = null;
  let inReach = 0;
  const perBall = [];
  let ballStart = 0;
  let ball = 1;
  for (let k = 0; k < Math.round(180 / cfg.DT); k++) {
    if (useFlippers) {
      const b = world.balls.find((x) => x.alive && reachable(x));
      if (b && k % 20 === 0) world.setFlipper(b.p.x < 0.2325 ? 'L' : 'R', true);
      else if (k % 20 === 10) { world.setFlipper('L', false); world.setFlipper('R', false); }
    }
    world.step(cfg.DT);
    rules.update();
    const b = world.balls.find((x) => x.alive);
    if (b && reachable(b)) { if (first === null) first = world.time; inReach += cfg.DT; }
    if (rules.state.ball !== ball) { perBall.push(world.time - ballStart); ballStart = world.time; ball = rules.state.ball; }
    if (rules.state.over) { perBall.push(world.time - ballStart); break; }
  }
  return { first, inReach, score: rules.state.score, time: world.time, perBall };
}

const idle = game(false);
const played = game(true);

console.log(`untouched: first reachable ${idle.first === null ? 'NEVER' : idle.first.toFixed(1) + ' s'}`
  + `, in reach ${idle.inReach.toFixed(1)}s of ${idle.time.toFixed(1)}s, score ${idle.score}`);
console.log(`flipped:   first reachable ${played.first === null ? 'NEVER' : played.first.toFixed(1) + ' s'}`
  + `, in reach ${played.inReach.toFixed(1)}s of ${played.time.toFixed(1)}s, score ${played.score}`);
console.log(`ball times untouched: ${idle.perBall.map((t) => t.toFixed(1)).join(' / ')}\n`);

// 3 s is not a target, it is a floor: past it the player is watching, not playing. The shipped
// build measured 7.4 s and the number after the fix is about 1.5 s.
ok(idle.first !== null && idle.first < 3.0,
  `the ball is reachable by a flipper within 3 s of the plunge (${idle.first === null ? 'NEVER' : idle.first.toFixed(1) + ' s'})`);
ok(idle.inReach > 2.0, `an untouched ball spends more than 2 s in reach (${idle.inReach.toFixed(1)} s)`);
// THE ONE THAT MATTERS. Equal scores mean the flippers are decorative.
ok(played.score !== idle.score,
  `flipping changes the outcome (${played.score} against ${idle.score} untouched)`);
ok(played.score > idle.score,
  `and changes it for the better (${played.score} > ${idle.score})`);
ok(idle.perBall.every((t) => t > 2.0), `no untouched ball is over in under 2 s (${idle.perBall.map((t) => t.toFixed(1)).join(' / ')})`);

console.log(`\nReachability: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
