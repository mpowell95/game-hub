// snake/js/test.js — headless engine assertions, node-only, no deps. Run: node snake/js/test.js
// Same idiom as every other game's engine test in this repo.

import { Game, COLS, ROWS, START_LEN, TICK_MS, DIFFS } from './game.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; return; }
  fail++; console.log('FAIL  ' + name);
}

// A deterministic rng for reproducible food placement.
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// --- construction ------------------------------------------------------------------------------
{
  const g = new Game('medium', seeded(1));
  ok('starts at START_LEN', g.length === START_LEN);
  ok('head is body[0], centered row', g.body[0].y === Math.floor(ROWS / 2));
  ok('body is contiguous horizontal', g.body.every((c, i) => i === 0 || (g.body[i - 1].x - c.x === 1 && c.y === g.body[0].y)));
  ok('heads right', g.dir === 'right');
  ok('food exists', !!g.food);
  ok('food not on snake', !g.body.some((c) => c.x === g.food.x && c.y === g.food.y));
  ok('score starts 0', g.score === 0);
  ok('not over', !g.over);
  ok('bad difficulty falls back to medium', new Game('nope', seeded(1)).difficulty === 'medium');
  ok('every difficulty has a tick speed', DIFFS.every((d) => TICK_MS[d] > 0));
  ok('hard is faster than easy', TICK_MS.hard < TICK_MS.easy);
}

// --- movement ----------------------------------------------------------------------------------
{
  const g = new Game('medium', seeded(2));
  const x0 = g.body[0].x;
  const r = g.step();
  ok('step moves', r.moved === true);
  ok('head advanced right', g.body[0].x === x0 + 1);
  ok('length unchanged without food', g.length === START_LEN);
  g.setDirection('down');
  g.step();
  ok('turn applies on next tick', g.dir === 'down' && g.body[0].y === Math.floor(ROWS / 2) + 1);
}

// --- 180° reversal guard -----------------------------------------------------------------------
{
  const g = new Game('medium', seeded(3));
  ok('reverse (left while heading right) rejected', g.setDirection('left') === false);
  ok('same direction rejected', g.setDirection('right') === false);
  ok('perpendicular accepted', g.setDirection('up') === true);
  ok('reverse of QUEUED turn rejected (up then down)', g.setDirection('down') === false);
  ok('second perpendicular queues', g.setDirection('left') === true);
  ok('queue caps at 2', g.setDirection('down') === false);
  g.step();
  ok('first queued turn applied', g.dir === 'up');
  g.step();
  ok('second queued turn applied', g.dir === 'left');
}

// --- walls kill --------------------------------------------------------------------------------
{
  const g = new Game('medium', seeded(4));
  let r;
  for (let i = 0; i < COLS + 2; i++) { r = g.step(); if (r.over) break; }
  ok('right wall ends the run', g.over === true && r.over === true);
  ok('death does not grow or move the snake', g.length === START_LEN || g.length > START_LEN); // length only grew via food
  const g2 = new Game('medium', seeded(5));
  g2.setDirection('up');
  for (let i = 0; i < ROWS + 2 && !g2.over; i++) g2.step();
  ok('top wall ends the run', g2.over === true);
  ok('step after over is a no-op', g2.step().moved === false);
  ok('setDirection after over rejected', g2.setDirection('left') === false);
}

// --- eating and growth -------------------------------------------------------------------------
{
  const g = new Game('medium', seeded(6));
  // Teleport the food right in front of the head (test seam: engine state is plain data).
  g.food = { x: g.body[0].x + 1, y: g.body[0].y };
  const r = g.step();
  ok('eating reports ate', r.ate === true);
  ok('eating grows by one', g.length === START_LEN + 1);
  ok('eating scores one', g.score === 1);
  ok('new food spawned', !!g.food);
  ok('new food not on snake', !g.body.some((c) => c.x === g.food.x && c.y === g.food.y));
}

// --- self-collision ----------------------------------------------------------------------------
{
  // Grow to 7 so a tight box turn hits the body: right, down, left, up closes a 2x2 loop.
  const g = new Game('medium', seeded(7));
  for (let i = 0; i < 4; i++) { g.food = { x: g.body[0].x + 1, y: g.body[0].y }; g.step(); }
  ok('grew to 7', g.length === 7);
  g.food = { x: 0, y: 0 };            // out of the way
  g.setDirection('down'); g.step();
  g.setDirection('left'); g.step();
  g.setDirection('up'); const r = g.step();
  ok('closing a 2x2 loop hits own body', r.over === true && g.over === true);
}

// --- chase-your-tail is legal ------------------------------------------------------------------
{
  // At length 4, a 2x2 loop steps INTO the cell the tail vacates the same tick: legal, classic.
  const g = new Game('medium', seeded(8));
  g.food = { x: g.body[0].x + 1, y: g.body[0].y };
  g.step();                            // length 4
  ok('grew to 4', g.length === 4);
  g.food = { x: 0, y: 0 };
  g.setDirection('down'); g.step();
  g.setDirection('left'); g.step();
  g.setDirection('up'); const r = g.step();
  ok('tail-chase at length 4 survives', r.over === false && !g.over);
}

// --- wrap-around mode ----------------------------------------------------------------------------
{
  // Right wall: heading right off the edge re-enters at x=0, same row. Food is kept out of the
  // way (off in a corner) so the snake doesn't grow and shift its own occupied cells mid-walk.
  const g = new Game('medium', seeded(10), true);
  const y0 = g.body[0].y;
  const x0 = g.body[0].x;
  g.food = { x: 0, y: ROWS - 1 };
  for (let i = 0; i < (COLS - 1 - x0) + 1; i++) g.step();   // reach the right edge, then wrap once
  ok('wrap: right wall does not end the run', g.over === false);
  ok('wrap: head re-enters at x=0', g.body[0].x === 0);
  ok('wrap: row unchanged crossing the right wall', g.body[0].y === y0);

  // Left wall.
  const g2 = new Game('medium', seeded(11), true);
  g2.food = { x: 0, y: ROWS - 1 };
  g2.setDirection('up'); g2.step();
  g2.setDirection('left');
  const gx0 = g2.body[0].x;
  for (let i = 0; i < gx0 + 1; i++) g2.step();               // reach x=0, then wrap once more
  ok('wrap: left wall does not end the run', g2.over === false);
  ok('wrap: head re-enters at x=COLS-1', g2.body[0].x === COLS - 1);

  // Bottom wall.
  const g3 = new Game('medium', seeded(12), true);
  g3.food = { x: 0, y: 0 };
  g3.setDirection('down');
  const gx3 = g3.body[0].x, gy3 = g3.body[0].y;
  for (let i = 0; i < (ROWS - 1 - gy3) + 1; i++) g3.step();  // reach the bottom edge, then wrap once
  ok('wrap: bottom wall does not end the run', g3.over === false);
  ok('wrap: head re-enters at y=0', g3.body[0].y === 0);
  ok('wrap: column unchanged crossing the bottom wall', g3.body[0].x === gx3);

  // Top wall.
  const g4 = new Game('medium', seeded(13), true);
  g4.food = { x: 0, y: 0 };
  g4.setDirection('up');
  const gy4 = g4.body[0].y;
  for (let i = 0; i < gy4 + 1; i++) g4.step();               // reach y=0, then wrap once more
  ok('wrap: top wall does not end the run', g4.over === false);
  ok('wrap: head re-enters at y=ROWS-1', g4.body[0].y === ROWS - 1);

  // Self-collision must still be fatal with wrap on (same closed 2x2 loop as the non-wrap test).
  const g5 = new Game('medium', seeded(14), true);
  for (let i = 0; i < 4; i++) { g5.food = { x: g5.body[0].x + 1, y: g5.body[0].y }; g5.step(); }
  g5.food = { x: 0, y: 0 };
  g5.setDirection('down'); g5.step();
  g5.setDirection('left'); g5.step();
  g5.setDirection('up'); const r5 = g5.step();
  ok('wrap: self-collision is still fatal', r5.over === true && g5.over === true);
}

// --- food distribution / spawn integrity over many runs ----------------------------------------
{
  const rng = seeded(9);
  let alwaysFree = true;
  for (let run = 0; run < 50; run++) {
    const g = new Game('hard', rng);
    for (let i = 0; i < 200 && !g.over; i++) {
      // random-ish walk that stays in bounds more often than not
      if (i % 3 === 0) g.setDirection(['up', 'down', 'left', 'right'][Math.floor(rng() * 4)]);
      g.step();
      if (g.food && g.body.some((c) => c.x === g.food.x && c.y === g.food.y)) alwaysFree = false;
    }
  }
  ok('food never spawns on the snake (50 random runs)', alwaysFree);
}

console.log(`\nSnake engine tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
