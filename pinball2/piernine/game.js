// PIER NINE, playable. Canvas, input, backglass, and the loop that ties the solver to the rules.
//
// This is a PAGE, not a hub game: `pinball2/` has no `GAMES` entry, no stats id and no recorder,
// and when it gets one it must be a NEW id (`pinball2`), never the existing `pinball` id, whose
// records belong to the four old machines (THE LAW rule 5, `pinball2/CLAUDE.md`).
//
// Nothing in here does physics. The solver is `machines/testbox/physics.js`, the geometry is
// `machines/testbox/tables/piernine.js` and the game is `rules.js`; this file is the shell.

import { CONFIG } from '../machines/testbox/config.js';
import { World } from '../machines/testbox/physics.js';
import { makePierNine } from '../machines/testbox/tables/piernine.js';
import { draw, fitView } from '../machines/testbox/render.js';
import { createRules } from './rules.js';

const cvs = document.getElementById('table');
const ctx = cvs.getContext('2d');
const el = {
  score: document.getElementById('score'),
  ballno: document.getElementById('ballno'),
  bonusx: document.getElementById('bonusx'),
  banner: document.getElementById('banner'),
  pier: document.getElementById('pier'),
  over: document.getElementById('over'),
  overline: document.getElementById('overline'),
  start: document.getElementById('start'),
  menu: document.getElementById('menu'),
  flipL: document.getElementById('flipL'),
  flipR: document.getElementById('flipR'),
  stage: document.getElementById('stage'),
};

const table = makePierNine();
const world = new World(table, CONFIG);
const rules = createRules(world, table);
let view = null;

// ---------------------------------------------------------------- view
// FIT BY MEASUREMENT, never by a guessed aspect ratio. `docs/BUILDING-A-GAME.md` Part 0: the one
// screen has to hold the whole table at every phone height, and the only way to know it does is to
// measure the box it is being put in.
function resize() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = el.stage.clientWidth;
  const h = el.stage.clientHeight;
  if (!w || !h) return;
  cvs.width = Math.round(w * dpr);
  cvs.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view = fitView(table, w, h, 6);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- input
// A FLIPPER IS HELD, NOT TAPPED, so every one of these is a pointer DOWN/UP pair and never a
// click. `setPointerCapture` is what stops a thumb that slides off the button leaving the bat up.
function bind(btn, side) {
  const down = (e) => {
    e.preventDefault();
    if (e.pointerId != null && btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (_) { /* not captured */ } }
    hold(side, true);
  };
  const up = (e) => { e.preventDefault(); hold(side, false); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
}
// **A FLIP HAS A MINIMUM LENGTH, BECAUSE A SOLENOID DOES.**
//
// Without this a tap does NOTHING AT ALL. The press and the release land in the same animation
// frame, so `setFlipper(true)` and `setFlipper(false)` both run before a single `world.step`, and
// the bat never moves - measured in a real browser: an instantaneous tap held the flipper for 0
// frames, while a 150 ms press held it for 5. Matt, on the first real game: *"Didn't flip the
// flipper once."* He was tapping, the way anybody taps a pinball button.
//
// A real flipper is not a switch either: the button closes a circuit and the coil fires for a
// fixed pulse whatever the finger does. 75 ms is that pulse - three times FLIP_UP_TIME, so the bat
// reaches its stop and stays there long enough to throw a ball - and holding longer than 75 ms
// still holds the bat up, so cradling is unaffected.
const MIN_FLIP_MS = 75;
const pressed = { L: false, R: false };
const downAt = { L: 0, R: 0 };
const pending = { L: null, R: null };

function apply(side, on) {
  world.setFlipper(side, on);
  (side === 'L' ? el.flipL : el.flipR).classList.toggle('on', on);
}

function hold(side, on) {
  if (on) {
    if (pending[side]) { clearTimeout(pending[side]); pending[side] = null; }
    pressed[side] = true;
    downAt[side] = performance.now();
    apply(side, true);
    // LANE CHANGE, on the press. It is free, it is the classic top-lane skill layer, and putting it
    // on the flipper button is what makes it a skill rather than a menu.
    rules.laneChange(side === 'L' ? -1 : 1);
    return;
  }
  pressed[side] = false;
  const left = MIN_FLIP_MS - (performance.now() - downAt[side]);
  if (left <= 0) { apply(side, false); return; }
  pending[side] = setTimeout(() => {
    pending[side] = null;
    if (!pressed[side]) apply(side, false);
  }, left);
}
bind(el.flipL, 'L');
bind(el.flipR, 'R');

// The playfield itself is a flipper button too, split down the middle: on a phone the thumbs are
// already there, and a player should never have to look for the control.
el.stage.addEventListener('pointerdown', (e) => {
  const r = el.stage.getBoundingClientRect();
  hold(e.clientX - r.left < r.width / 2 ? 'L' : 'R', true);
});
el.stage.addEventListener('pointerup', () => { hold('L', false); hold('R', false); });
el.stage.addEventListener('pointercancel', () => { hold('L', false); hold('R', false); });

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'z' || e.key === 'Z' || e.key === 'ArrowLeft') hold('L', true);
  if (e.key === '/' || e.key === '?' || e.key === 'ArrowRight') hold('R', true);
  if (e.key === 'Enter' && rules.state.over) newGame();
});
addEventListener('keyup', (e) => {
  if (e.key === 'z' || e.key === 'Z' || e.key === 'ArrowLeft') hold('L', false);
  if (e.key === '/' || e.key === '?' || e.key === 'ArrowRight') hold('R', false);
});

el.start.addEventListener('click', newGame);
el.menu.addEventListener('click', () => {
  el.over.hidden = false;
  el.overline.textContent = 'Paused. Starting over resets the score.';
  el.start.textContent = rules.state.started ? 'RESTART' : 'START';
  paused = true;
});

let paused = true;
function newGame() {
  el.over.hidden = true;
  paused = false;
  rules.newGame();
}

// ---------------------------------------------------------------- the loop
// A FIXED-STEP ACCUMULATOR, and the catch-up is BOUNDED. A tab that has been backgrounded for a
// minute hands back a 60 second frame, and stepping that in one go is 14,400 ticks of solver in
// front of a paint - which is a hang, and on a physics table it is also a completely different
// game than the one the player left.
const DT = CONFIG.DT;
let acc = 0;
let last = performance.now();
const trail = [];

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 240) { world.step(DT); acc -= DT; steps++; }
    if (acc > DT) acc = 0;
    rules.update();
  }
  paint();
}

function paint() {
  if (!view) resize();
  const st = rules.state;
  const b0 = world.balls.find((b) => b.alive);
  if (b0 && !paused) {
    trail.push({ x: b0.p.x, y: b0.p.y });
    if (trail.length > 26) trail.shift();
  } else if (trail.length) trail.length = 0;

  draw(ctx, table, view, {
    balls: world.balls,
    ballR: CONFIG.BALL_R,
    flipperAngles: Object.fromEntries(world.flippers.map((f) => [f.def.id, f.ang])),
    lamps: st.lamps,
    locks: st.locks,
    wheelAng: st.locks * (Math.PI * 2 / 3),
    trail,
  });
  glass(st);
}

let lastFlash = null;
function glass(st) {
  el.score.textContent = st.score.toLocaleString('en-US');
  el.ballno.textContent = st.multiball > 1 ? `MULTIBALL x${st.multiball}` : `BALL ${st.ball} / ${st.ballsTotal}`;
  el.bonusx.textContent = st.hurry
    ? `HURRY ${Math.round(st.hurry.value).toLocaleString('en-US')}`
    : `BONUS x${st.bonusX}`;
  [...el.pier.children].forEach((n, i) => n.classList.toggle('on', !!st.lanesLit[i]));

  const f = st.flash[0];
  const key = f ? `${f.t}|${f.text}` : null;
  if (key !== lastFlash) {
    lastFlash = key;
    el.banner.textContent = f ? (f.pts ? `${f.text}  +${f.pts.toLocaleString('en-US')}` : f.text) : '';
  }
  if (st.mode) el.banner.textContent = `${st.mode.name}  ${Math.max(0, st.mode.until - world.time).toFixed(0)}s`;

  if (st.over && el.over.hidden) {
    el.over.hidden = false;
    paused = true;
    el.overline.textContent = `Game over. ${st.score.toLocaleString('en-US')} points.`;
    el.start.textContent = 'PLAY AGAIN';
  }
}

requestAnimationFrame(frame);

// A seam for the probes and for a future `test-visual.mjs` PLAY probe, the same shape every other
// game in this repo exposes. Read-only apart from `flip`.
window.__pnTest = { world, table, rules, hold, newGame, cfg: CONFIG };
