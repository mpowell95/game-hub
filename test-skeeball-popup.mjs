// test-skeeball-popup.mjs - the score popup must pay what the RACK scored, never what the
// CAPTURE predicted.
//
// THE INCIDENT (2026-09-02). Matt, with a screen recording of HOT SHOT: "The 100 appears when I
// don't get a 100." The lane says MISS!, the score does not move, and a gold +100 floats up the
// backboard with a particle burst and a celebration behind it.
//
// THE MECHANISM, and why it is a HOT SHOT/POPONGO bug and not a THE CLASSIC one: on a COLLARED cup
// board the `capture` event is explicitly a PREDICTION, not a score (skeeball/js/machines/classic/
// physics.js says so in its own guard - those mouths have walls standing above the face, so a ball
// really can strike the far collar and climb back out). The UI stashed that prediction in
// `_pending` at capture and only cleared it on `returned` or `ballDone`, so a rattle-out - which
// fires `rimout`, then `gutter`, then `ballDone` with value 0 at `corner0` - reached the popup with
// a stale 100 still in hand.
//
// TWO PARTS, because the bug needed both halves to be understood:
//
//   A. THE ENGINE PART proves the sequence is real and common, by throwing at the real machines.
//      It is not a re-derivation of the fix: it is the evidence that capture and the final outcome
//      genuinely disagree, which is the whole premise. A machine where they never disagreed would
//      make part B pointless.
//   B. THE STRUCTURAL PART reads the shipped skeeball/js/ui.js and pins the two rules that close
//      it: `gutter` drops the pending capture, and a popup is drawn only when the ball finished in
//      the hole it was predicted for, printing the ballDone event's OWN value. Structural rather
//      than behavioural because the drain lives inside a DOM-bound class with a WebGL renderer;
//      the value of the check is that it fails the day someone reaches for `at.value` again.
//
// Born red against the pre-fix ui.js: part A passed (the rattle-outs were always there) and every
// part B assertion failed.
//
// node test-skeeball-popup.mjs   (~40s, no browser)

import { readFileSync } from 'node:fs';
import { loadEngine, engineFor } from './skeeball/js/engines.js';
import { boardById } from './skeeball/js/boards.js';

let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `   (${detail})` : ''}`);
  if (!cond) fails++;
};

// --- A. the engine: capture is a prediction, and it really does get broken -------------------

/** Throw `n` times at `boardId` and count the throws whose capture prediction did NOT survive:
 *  the ball was captured and the rack still scored nothing (or scored a DIFFERENT hole). */
async function rattleOuts(boardId, n) {
  const board = boardById(boardId);
  await loadEngine(board.id, { physics: true });
  const { physics: { startThrow, step, STEP } } = engineFor(board.id, { physics: true });
  let seed = 3;
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let broken = 0, captured = 0, sawRimout = false, sample = null;
  for (let i = 0; i < n; i++) {
    const st = startThrow(board, { power: 0.30 + rng() * 0.68, aim: (rng() * 2 - 1) });
    const evs = [];
    let guard = 240 * 14;
    while (!st.done && guard-- > 0) {
      step(board, st, STEP);
      for (const e of st.events.splice(0)) evs.push(e);
    }
    for (const e of st.events.splice(0)) evs.push(e);
    const cap = evs.find((e) => e.type === 'capture');
    if (!cap) continue;
    captured++;
    if (evs.some((e) => e.type === 'rimout')) sawRimout = true;
    const out = st.outcome || { hole: null, value: 0 };
    if (out.hole !== cap.hole) {
      broken++;
      if (!sample) sample = { predicted: `${cap.hole}=${cap.value}`, finished: `${out.hole}=${out.value | 0}`,
        gutter: evs.some((e) => e.type === 'gutter') };
    }
  }
  return { broken, captured, sawRimout, sample };
}

console.log('--- A. capture vs. the final outcome, at the real machines');

const hot = await rattleOuts('basketball', 400);
ok('HOT SHOT: a captured ball can still finish somewhere else', hot.broken > 0,
  `${hot.broken} of ${hot.captured} captures broken`);
ok('HOT SHOT: it is common enough to be seen in ordinary play', hot.broken / Math.max(1, hot.captured) > 0.02,
  `${(100 * hot.broken / Math.max(1, hot.captured)).toFixed(1)}% of captures`);
ok('HOT SHOT: the broken ones score nothing, at another hole', !!hot.sample && (hot.sample.finished.endsWith('=0')),
  hot.sample ? `predicted ${hot.sample.predicted}, finished ${hot.sample.finished}` : 'no sample');
ok('HOT SHOT: the engine announces the rim-out', hot.sawRimout);

const pg = await rattleOuts('popongo', 300);
ok('POPONGO (the other collared board) breaks predictions too', pg.broken > 0,
  `${pg.broken} of ${pg.captured} captures broken`);

const cl = await rattleOuts('classic', 300);
ok('THE CLASSIC is unaffected: its capture rule commits', cl.broken === 0,
  `${cl.broken} of ${cl.captured} captures broken`);

// --- B. the shipped UI honours the outcome, not the prediction -------------------------------

console.log('\n--- B. skeeball/js/ui.js, structurally');

const ui = readFileSync(new URL('./skeeball/js/ui.js', import.meta.url), 'utf8');

const gutterCase = ui.slice(ui.indexOf("case 'gutter':"), ui.indexOf("case 'returned':"));
ok('the gutter case drops the pending capture', /_pending\s*=\s*null/.test(gutterCase),
  'a rattled-out ball must not leave a prediction in hand');

const doneCase = ui.slice(ui.indexOf("case 'ballDone': {"), ui.indexOf('this._paintHud();', ui.indexOf("case 'ballDone': {")));
ok('capture stashes the HOLE it predicted', /this\._pending = \{ pos: ev\.pos, value: ev\.value, hole: ev\.hole \}/.test(ui));
ok('ballDone only pops when the ball finished in the predicted hole',
  /const landed = !!at && at\.hole === ev\.hole/.test(doneCase));
ok('the popup number comes from the ballDone event, not the capture',
  /const value = ev\.value \| 0/.test(doneCase) && /signedValue\(value\)/.test(doneCase));
ok('no branch still reads the prediction\'s value', !/\bat\.value\b/.test(doneCase),
  'at.value is the field that printed +100 on a miss');
ok('gold / burst / celebrate all key off the scored value',
  /gold = value > 0 && value >= topValue, big = value >= topValue \/ 2/.test(doneCase));

// The how-to-play demo runs its own miniature drain over the same events.
const demo = ui.slice(ui.indexOf('Minimal event drain'), ui.indexOf('this._hpRenderer.render('));
ok('the how-to-play demo drain carries the same guard',
  /at\.hole === ev\.hole/.test(demo) && /ev\.type === 'gutter'/.test(demo) && !/\bat\.value\b/.test(demo));

console.log(`\n${fails} failure(s)`);
process.exit(fails ? 1 : 0);
