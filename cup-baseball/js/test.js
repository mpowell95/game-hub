// cup-baseball/js/test.js - the rules, and the computer on the real physics. Dev only, not in sw.js.
//   node cup-baseball/js/test.js          rules + a physics sanity sweep
//   node cup-baseball/js/test.js --cpu    also each skill's hit rates (slow, ~1 min)
import { Game, OUTS } from './game.js';
import { CUPS, hitOf } from './field.js';
import { cpuThrow } from './cpu.js';
import { aimAt, seeded } from '../../cup-pong/js/cpu.js';
import { simulateThrow } from '../../cup-pong/js/physics.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const play = (g, list) => { let ev = []; for (const h of list) ev = ev.concat(g.throwResult(h)); return ev; };

// --- rules ---------------------------------------------------------------------------------------
ok('two outs a half', OUTS === 2);
{
  const g = new Game({ innings: 3, first: 'a' });
  ok('a bats first', g.batting === 'a' && g.fielding === 'b');
  play(g, [0]);
  ok('one out: still batting', g.batting === 'a' && g.outs === 1);
  const ev = play(g, [0]);
  ok('two outs: sides switch', g.batting === 'b' && g.outs === 0 && ev.some((e) => e.type === 'side'));
}
{
  const g = new Game({ first: 'a' });
  play(g, [1]);
  ok('single: runner on first', g.bases.join() === 'true,false,false' && g.runs.a === 0);
  play(g, [2]);
  ok('double moves first to third', g.bases.join() === 'false,true,true' && g.runs.a === 0);
  play(g, [2]);
  ok('double scores second and third', g.runs.a === 2 && g.bases.join() === 'false,true,false');
  play(g, [4]);
  ok('home run clears the bases', g.runs.a === 4 && g.bases.join() === 'false,false,false');
  play(g, [1, 1, 1, 3]);
  ok('bases loaded triple scores 3, batter on third', g.runs.a === 7 && g.bases.join() === 'false,false,true');
  ok('line score carries the inning', g.line.a[0] === 7);
  play(g, [0, 0]);
  ok('bases clear at the switch', g.bases.join() === 'false,false,false' && g.batting === 'b');
}
{
  // Second side ahead after the top of the last: no bottom half.
  const g = new Game({ innings: 3, first: 'a' });
  play(g, [0, 0, 4, 0, 0]);                   // 1st: a 0, b 1
  play(g, [0, 0, 0, 0]);                      // 2nd
  const ev = play(g, [0, 0]);                 // top 3rd
  ok('home side ahead skips the last bottom half', g.over && g.winner === 'b' && ev.some((e) => e.type === 'win'));
}
{
  // Walk-off.
  const g = new Game({ innings: 3, first: 'a' });
  play(g, [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);  // a 1-0 into the bottom of the 3rd
  ok('bottom of the last is played when behind', !g.over && g.inning === 3 && g.batting === 'b');
  play(g, [4]);
  ok('tie, not over', !g.over && g.runs.b === 1);
  const ev = play(g, [4]);
  ok('walk-off ends it at once', g.over && g.winner === 'b' && ev.some((e) => e.type === 'win'));
}
{
  // Extra innings.
  const g = new Game({ innings: 3, first: 'a' });
  const ev = play(g, Array(12).fill(0));
  ok('tie after the last: extra innings', !g.over && g.inning === 4 && ev.some((e) => e.type === 'extra'));
  play(g, [4, 0, 0, 0, 0]);
  ok('first side wins after the bottom of the extra', g.over && g.winner === 'a');
}
{
  const g = new Game({ innings: 3, first: 'b' });
  ok('first can be b', g.batting === 'b' && g.line.b.length === 1 && g.line.a.length === 0);
  ok('bad innings falls back to 5', new Game({ innings: 7 }).innings === 5);
  g.over = true;
  ok('no throws after the end', g.throwResult(1).length === 0);
}
ok('cup ids map to hits', hitOf('h1') === 1 && hitOf('h4') === 4 && hitOf('x') === 0);

// --- physics: a perfect throw at each cup goes in that cup --------------------------------------
for (const c of CUPS) {
  const t = aimAt(c.x, c.z);
  const r = simulateThrow({ power: t.power, aim: t.aim, cups: CUPS });
  ok(`a perfect throw at ${c.id} goes in it (got ${r.outcome.kind} ${r.outcome.id || ''})`, r.outcome.kind === 'made' && r.outcome.id === c.id);
}

// --- the computer's rates --------------------------------------------------------------------------
if (process.argv.includes('--cpu')) {
  for (const skill of ['easy', 'medium', 'hard']) {
    const rnd = seeded(4242);
    const N = 600, got = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (let i = 0; i < N; i++) {
      const th = cpuThrow(skill, rnd);
      const r = simulateThrow({ power: th.power, aim: th.aim, cups: CUPS });
      got[r.outcome.kind === 'made' ? hitOf(r.outcome.id) : 0]++;
    }
    const pct = (n) => (100 * n / N).toFixed(0) + '%';
    console.log(`${skill.padEnd(6)} hit ${pct(N - got[0])}  1B ${pct(got[1])} 2B ${pct(got[2])} 3B ${pct(got[3])} HR ${pct(got[4])}`);
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
