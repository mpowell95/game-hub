# HANDOFF — BRICK CITY: find the stuck ball

**Your job: run tests, find the bug, report what you find to Matt before changing anything.**

This is an investigation brief, not a fix spec. A previous session reached two confident
conclusions about this bug and **both were wrong**, so nothing below tells you what the answer is.
What it gives you is the symptom, how to reproduce it, the tools, and the experiments already run so
you don't repeat a day of them.

---

## 1. The symptom, in Matt's words

> "the ball sometimes gets stuck IN the negative baskets. Like instead of falling in, it's just
> stuck there."

> "the ball was NOT perched on the back of the rim against the backboard. It was IN the basket. Half
> of the ball out and half completely in. I've even seen a second ball fall into the same negative
> basket while one is stuck/frozen."

> "I don't want the balls that get stuck to vanish. I want them to not get stuck midway through the
> basket. There's nothing for them to get stuck on."

Machine: **HOT SHOT: BRICK CITY** (`brickcity`). It happens on the bottom row — the −20 / −10 / −20
penalty cups — and Matt has never reported it on the middle or top rows.

**What "fixed" means:** the ball falls into the basket. Not "the ball is deleted faster."

---

## 2. What is NOT the answer

**v495 (`137eaef`) shipped a band-aid and Matt rejected it.** It shortened the stall watchdog from
0.9s×3 to a single 0.6s window, so a stuck ball is declared jammed and vanishes after 0.57s instead
of 2.62s. It never addressed why the ball is stuck.

Do not measure how fast the ball disappears. Do not treat a short disappearance as success. If your
fix ends with the ball being removed rather than falling in, it is the same mistake again.

The same commit removed two "pops" that used to nudge a parked ball. Data behind that: over 861
throws the watchdog fired on 65, and the pops rescued **1 ball into a scoring hole — a −20**. They
are gone for good; don't bring them back.

---

## 3. Reproduce it first

Nothing below is worth doing until you have seen it yourself.

1. `node server.mjs`, open `http://localhost:8123/skeeball/`, pick BRICK CITY, play racks and watch
   the bottom row. Matt sees it often enough to have caught it repeatedly, including twice at once.
2. If you can get Matt to play a few racks while you watch, do that — he knows what it looks like
   and you don't.
3. On the deployed site the version pill must read **v495** or later (`v494 → v495` with an arrow
   means the worker hasn't installed; reload).

**When you catch one, the first question is whether the frozen ball is a real physics body or just a
mesh left drawn.** Everything else forks off that answer:

```js
// browser console, on the play screen
const ui = window.__skTest.ui, R = ui.renderer;
setInterval(() => {
  const live = ui.game ? ui.game.balls : [];
  console.log('live', live.length, live.map(s => ({
    y: +s.ball.position.y.toFixed(3), z: +s.ball.position.z.toFixed(3),
    sp: +Math.hypot(s.ball.velocity.x, s.ball.velocity.y, s.ball.velocity.z).toFixed(3),
    cap: s.captured || null })), 'meshes drawn', R._balls.filter(m => m.visible).length);
}, 250);
```

Write down the ball's **world position** while it is stuck. That single number is the anchor for
everything else, and it is where the previous session's reasoning went wrong — see §6.

---

## 4. The tools

Physics needs no browser. Everything is pure and deterministic (no rng):

```js
import { boardById } from './skeeball/js/boards.js';
import { engineFor } from './skeeball/js/engines.js';
const b = boardById('brickcity'), P = engineFor('brickcity').physics;

// a whole throw, no clock:
P.simulateThrow(b, { power, aim });   // { outcome, time, bounces, touchedBoard, emergencyUsed, events }

// or step it and watch:
const st = P.startThrow(b, { power, aim });
while (!st.done) { P.step(b, st, 1/60); /* st.ball.position, .velocity, st.captured, st.t */ }
```

A 41×21 power/aim grid is ~100s. **`power` is deliberately NOT clamped to 0..1** — a hard swipe goes
past 1.

Geometry:

```js
import { buildMachine } from './skeeball/js/machines/brickcity/machine.js';
const M = buildMachine(b.geom);
M.faceToWorld(u, v, h)   // face -> world
M.worldToFace(pos)       // world -> { u, v, h, tilt }
M.frames                 // the six staircase segments; tilt 0.1 = tread, 1.5708 = riser
M.solids                 // every collision body: part, pos, half
b.geom.holes             // per cup: u, v, r (mouth radius), collarH, value
```

**Read `machines/brickcity/physics.js` before you theorise.** The relevant parts are numbered:
section 1 is the captured branch, section 2 is hole capture (the mouths), section 3 the trough,
3b the deliberate absence of a resting-position rule, 4 the rollback, 6 the stall watchdog,
7 the 12s cap.

Browser hook: `window.__skTest.ui` gives `.game` and `.renderer` (`.renderer._balls` is the mesh
pool, `.renderer.scene`/`.camera` the three.js scene).

To see a specific position through the real play camera:

```js
const R = window.__skTest.ui.renderer;
R.render = () => {};                                   // stop the loop overwriting it
const m = R._balls[0];
m.visible = true; m.position.set(X, Y, Z); m.quaternion.set(0,0,0,1);
for (let i = 1; i < R._balls.length; i++) R._balls[i].visible = false;
R.renderer.shadowMap.needsUpdate = true;
R.renderer.render(R.scene, R.camera);
```

---

## 5. Experiments already run — results, so you don't repeat them

These are test outcomes, not conclusions. Each was run to completion.

| Experiment | Method | Result |
|---|---|---|
| Does frame rate cause it? | 41×21 grid at 60 / 30 / 20 / clamped-10 fps and two jittery-phone dt patterns | **Identical to 2 dp in every regime.** The accumulator makes physics frame-rate independent |
| Do hard swipes cause it? | 1,281 throws, power 1.0 → 2.5 | 0 hangs |
| Is the frozen ball a leftover mesh? | Real Chromium, 28 balls, up to 5 live at once, 414 frames, comparing `renderer._balls` against `game.balls` every frame | **0 ghosts, 0 frozen meshes.** Worth re-testing when you have a live repro — this run never landed a ball in a cup |
| Does a *captured* ball hang inside the cup? | 861 throws, time spent in the captured state | worst **0.48s** |
| Did the v493 broadphase change alter physics? | 861-throw grid, this engine vs `origin/main`'s: hole, value, settle time to 6 dp, bounce count, board contact, full event sequence | **861 of 861 identical.** Pure speedup, not a suspect |
| Does the 12s emergency cap fire? | `simulateThrow().emergencyUsed` across the grid | Fires, but worst total settle is 6.24s |

**Nothing in a 41×21 sweep ever reproduced a ball freezing inside a cup.** Either the grid misses the
conditions, or the sweep's own measurement is misleading (see §6). Treat "the sweep says it can't
happen" as a lead, not a fact — Matt watches it happen.

**Not testable from a cloud container, and still open:** anything specific to iOS Safari. Matt plays
on an iPhone 16 Pro. If desktop comes back clean and he still sees it, the route is a dev-only probe
that records ball state into the existing `js/bug-report.js` payload; he plays two minutes, files one
report, `node read-bug-reports.mjs` reads it back.

---

## 6. The trap that got the last session twice

Both wrong conclusions came from the same habit: **trusting a derived number over what Matt was
looking at.**

The sweep reported the stalled ball as `h = 0.0545`, `d = 0.32` from the nearest cup in face
coordinates, and the session concluded "it's resting on a tread, 32 cm from any basket, and Matt is
misreading perspective." Matt said no, it's in the basket. **Matt was right.** The same ball's
distance to that cup measured in plain world coordinates is `0.054` — half the mouth radius.

So: **`worldToFace()` and world space can disagree about where a ball is**, and on a staircase they
do. Whenever you use `f.u` / `f.v` / `f.h`, check which of `M.frames` that point resolved to and
whether it is the frame you meant. Cross-check anything important in world coordinates.

And: when a measurement contradicts what Matt is describing, the measurement is the thing to
re-examine.

---

## 7. Rules you cannot break

- **BRICK CITY owns its own engine** — `machines/brickcity/{physics,machine,render}.js`. A fix here
  must NOT be copied into the other four "to keep them in sync" (HARD RULE, `skeeball/CLAUDE.md`).
  It was paid for: a change written for one machine silently re-scored THE CLASSIC overnight and
  Matt pulled the game. HOT SHOT is the same cabinet and may share whatever you find — that is its
  own job, raise it with Matt.
- **NEVER change the width or diameter of a basket** unless Matt specifically says so. Also frozen:
  the bottom row's 3in set-back against the riser ("do not move them forward again", 2026-08-23).
- **No resting-position scoring rule.** Section 3b explains; it has been removed once already. The
  only way to score a hole is to fall through its mouth.
- **Anything that changes what a throw scores needs Matt's sign-off with the number in hand** — run
  the 41×21 grid before and after and tell him how many of 861 outcomes move and in which direction.
- `node run-all-tests.mjs` is ~4.5 min; Matt has asked sessions not to run it unprompted. Run what
  you touched: `test-brickcity-stall.mjs`, `skeeball/js/test.js` (expect 78/1 — that one failure is
  THE CLASSIC's and pre-existing on `origin/main`), `test-skeeball-machine-spec.mjs` (86 passed,
  0 failed, 11 waivers — the same count as `origin/main`, don't chase it), `test-visual.mjs skeeball`,
  `test-game-conventions.mjs`, `validate-sw-assets.mjs`.
- **Bump `CACHE` in `sw.js`** past what is on `main` right now, then re-run `validate-sw-assets.mjs`.
- "Commit / push / deploy" means **live on the site**: merge to `main` and verify the
  `pages build and deployment` run for that merge commit succeeds.

---

## 8. What to hand back

Before touching code, tell Matt:

1. Did you reproduce it, and how (power/aim, or the swipe).
2. The ball's **world position** while stuck, and whether it is a live physics body or a drawn mesh.
3. What is holding it up — which body in `M.solids` it is in contact with, or whether it is resting
   on nothing and the state machine simply is not resolving it.
4. Why capture does not take it.
5. Your proposed fix, and the before/after outcome diff over the 41×21 grid.

---

## Appendix — one session's unverified hypothesis

**Do not read this until you have formed your own conclusion.** It is recorded because the raw
measurements behind it are real, not because it is right — the same session was confidently wrong
twice before producing it, and it never reproduced the bug in a sweep.

Raw measurements, reproducible with §4's tools:

```
a stalled ball's world position       0.0048, 0.579, -2.289   (every stall in an 861-throw sweep)
lowC cup axis (world)                 0.000,  0.439, -2.235    mouth r 0.109   collar 0.1455
horizontal distance, ball to cup axis 0.0543
ball bottom y 0.524 · cup floor y 0.439 · rim top y 0.585 · ball top y 0.634
worldToFace resolves that ball to     the RISER frame (v 0.429, band 0.300..0.580)
   tread below it   0.140 away -> frame score 0.140
   riser behind it  0.054 away -> frame score 0.054  (lowest wins)
distance to lowC in that frame        0.238   vs mouth radius 0.109
bottom-row mouth spans                v 0.082 .. 0.300; the tread ends at v 0.300
```

The hypothesis drawn from those numbers was that `physics.js` section 2 measures hole distance in
whatever frame `worldToFace` picked, so a ball sitting high in a deep cup gets riser coordinates,
computes 0.238 against a 0.109 mouth, hits `if (d >= rEff) continue;` and skips the cup it is in.
**Verify or kill it with your own repro before acting on it.**
