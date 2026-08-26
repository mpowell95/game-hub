# HANDOFF — BRICK CITY: the ball that sits half-in the negative baskets

**Written 2026-08-26. ROOT CAUSE FOUND — this is a fix spec, not an investigation.**

Matt:

> "the ball sometimes gets stuck IN the negative baskets. Like instead of falling in, it's just
> stuck there... It was IN the basket. Half of the ball out and half completely in. I've even seen a
> second ball fall into the same negative basket while one is stuck/frozen."

and, on the first attempt at a fix:

> "I don't want the balls that get stuck to vanish. I want them to not get stuck midway through the
> basket. There's nothing for them to get stuck on."

**He is right, and the first fix (v495) was a band-aid.** It shortened how long the stuck ball sits
before being deleted (2.62s → 0.57s). It did nothing about why the ball is stuck. Do not treat "it
vanishes quickly now" as success — that is the thing Matt explicitly rejected.

---

## 1. The bug, in one paragraph

**Capture is blind to a ball resting in the mouth of a bottom-row cup, because `worldToFace()` hands
that ball RISER coordinates instead of the tread the cup lives on.**

`machine.js`'s `worldToFace` chooses among the staircase's six frames by **proximity** — it scores
each frame `(inSeg ? 0 : 1000) + |lh|` and takes the lowest. A ball sitting high inside a 0.1455 m
deep collar is **closer to the riser wall behind it than to the tread beneath it**, so the riser
wins. Everything downstream then measures in the wrong frame.

Measured, for the position every stall in an 861-throw sweep lands on:

```
ball centre (world)      0.0048, 0.579, -2.289
lowC cup axis (world)    0.000,  0.439, -2.235      mouth radius 0.109   collar 0.1455
horizontal distance to the cup axis   0.0543        <-- HALF the mouth radius. It is IN the cup.
ball bottom y 0.524 · cup floor y 0.439 · rim top y 0.585 · ball top y 0.634
                                                    <-- equator at the rim: "half in, half out"

frame chosen by worldToFace   RISER (v 0.300..0.580), because:
    tread below it   0.140 away  -> score 0.140
    riser behind it  0.054 away  -> score 0.054   WINS

distance to lowC in the chosen (riser) frame:  0.238   vs mouth radius 0.109
=> physics.js section 2 runs `if (d >= rEff) continue;` and SKIPS THE CUP THE BALL IS SITTING IN.
```

**Why only the bottom row.** Those cups are the widest on the machine (`r 0.109` against the middle
row's `0.070`). The cup sits at `v 0.191` on a tread that ends at `v 0.300`, so its mouth spans
`v 0.082 → 0.300` — the back edge of the mouth lands exactly on the frame boundary. The mid and top
rows' mouths never reach theirs, which is why Matt only ever sees this in the negative baskets.

**Why a second ball joins it.** `game.canThrow()` releases the next ball once the previous one has
`arrived`, and every throw gets its OWN cannon world (`buildWorld` per throw), so two live balls
cannot collide. The second drops straight past the first into the same cup. By design; do not
"fix" it.

---

## 2. The fix

**Measure the holes in WORLD space, not in whatever frame `worldToFace` happened to pick.**

In `skeeball/js/machines/brickcity/physics.js`, section 2 (the mouths), the hole loop currently does:

```js
const d = Math.hypot(f.u - hDef.u, f.v - hDef.v);
```

`f.u`/`f.v` are only meaningful if `f` resolved to the frame that hole is on. Replace the distance
and height tests with frame-independent ones built off each hole's world position and axis:

- Cache each hole's world centre once per board: `M.faceToWorld(hDef.u, hDef.v, 0)`.
- Its axis is the tread's normal — derive it from that frame's tilt, not from `f.tilt`.
- `d` becomes the ball's distance from that axis; the height term becomes its distance along it.

Everything else in section 2 — `rEff`, the kinematic `vFace * tDrop > cross` test, the
`lip > 0 && f.h < lip` collar branch — keeps its meaning once `d` and the height are measured
against the right cup.

**This is a scoring change and it needs Matt's sign-off before it ships.** A ball that today freezes
and then vanishes for 0 will, after the fix, fall into the cup it is sitting in and score it —
usually **−20 or −10**, because that is the row this happens on. That is the correct behaviour and
it is what he asked for ("I want them to not get stuck midway through the basket"), but he should
see the number before it goes live, not after.

**Then reconsider the v495 watchdog.** With capture fixed, the 0.6s jam window may be doing nothing
useful, or may be firing before capture gets its chance. Re-measure; do not assume. The window
before v495 was 0.9s with two "pops", and the pops are gone for good (they rescued 1 ball in 861,
into a −20).

---

## 3. How to verify — the exact numbers to reproduce

**Before you change anything**, confirm you can see the bug. Park a ball at the measured position
and check what capture thinks:

```js
// node, from the repo root
import { boardById } from './skeeball/js/boards.js';
import { buildMachine } from './skeeball/js/machines/brickcity/machine.js';
const b = boardById('brickcity'), G = b.geom, M = buildMachine(G);
const p = { x: 0.0048, y: 0.579, z: -2.289 };
const f = M.worldToFace(p);
const low = G.holes.lowC, cw = M.faceToWorld(low.u, low.v, 0);
console.log({ faceFrameV: f.v, faceH: f.h,
  dInFaceCoords: Math.hypot(f.u - low.u, f.v - low.v),      // 0.238 - "outside"
  dInWorld:      Math.hypot(p.x - cw[0], p.z - cw[2]),      // 0.054 - INSIDE
  mouthRadius:   low.r });                                  // 0.109
```

**And look at it**, so nobody re-argues what "half in" means. This renders the exact position through
the real play camera — it puts the ball visibly half-sunk in the −10:

```js
// in the browser, play screen, brickcity loaded
const R = window.__skTest.ui.renderer;
R.render = () => {};
const m = R._balls[0];
m.visible = true; m.position.set(0.0048, 0.579, -2.289); m.quaternion.set(0,0,0,1);
for (let i = 1; i < R._balls.length; i++) R._balls[i].visible = false;
R.renderer.shadowMap.needsUpdate = true;
R.renderer.render(R.scene, R.camera);
```

**After the fix**, all of these must hold:

1. A ball placed at that position is **captured** and falls through — no jam, no vanish.
2. `node test-brickcity-stall.mjs` is green (nothing sits dead still past 0.75s).
3. `node skeeball/js/test.js --full` — THE CLASSIC must be **untouched**. Expect 78 passed / 1
   failed; that one failure (*missing the corner costs the ball*) is pre-existing and fails
   identically on a clean `origin/main`. Do not chase it.
4. `node test-skeeball-machine-spec.mjs` — 86 passed, 0 failed, **11 waivers**. That waiver count
   matches `origin/main`; do not chase it either.
5. Re-run the 41×21 outcome grid old vs new and **report the diff to Matt**: how many of 861
   outcomes move, and in which direction. He needs that number before it ships.
6. `node test-visual.mjs skeeball`, `node test-game-conventions.mjs`, `node validate-sw-assets.mjs`.

Add a probe to `test-brickcity-stall.mjs` for the real bug, born red against today's engine:
**a ball whose centre is within a cup's mouth in WORLD space must be captured, from every frame the
staircase can assign it.**

---

## 4. Already ruled out — do NOT repeat these

Each was run to completion and came back negative. Re-running them is a wasted afternoon.

| Hypothesis | How it was tested | Result |
|---|---|---|
| Frame rate / dt pattern causes it | 41×21 grid at 60 / 30 / 20 / clamped-10 fps, plus two jittery-phone patterns | **Identical to 2 dp in every regime.** The accumulator makes physics frame-rate independent |
| Hard swipes (power > 1.0) | 1,281 throws, power 1.0 → 2.5 (power is deliberately unclamped in `startThrow`) | **0 hangs** |
| A ghost mesh — a ball drawn with no physics ball behind it | Real Chromium, 28 balls, up to 5 live at once, 414 frames, comparing `R._balls` against `game.balls` every frame | **0 ghosts, 0 frozen meshes.** The renderer is faithful — the frozen ball you see is a real physics body |
| A captured ball hanging inside the cup | 861 throws, time in the captured state | Worst **0.48s**. The problem is upstream: capture never fires |
| The v493 broadphase change altered physics | 861-throw grid, this engine vs `origin/main`'s, comparing hole, value, settle time to 6 dp, bounce count, board contact, full event sequence | **861 of 861 identical.** Pure speedup |
| The 12s emergency cap | `simulateThrow().emergencyUsed` across the grid | Fires, but worst total settle is 6.24s |

**The one thing that misled the session that wrote this**: it trusted `worldToFace`'s `d` (0.238,
"outside the mouth") over the world geometry (0.054, inside), and concluded the ball was resting on
a tread 32 cm from any cup. It is not. **When a number disagrees with what Matt is looking at, check
the number.**

---

## 5. Landmines

- **BRICK CITY owns its own engine** — `machines/brickcity/{physics,machine,render}.js`. A fix here
  must NOT be copied into the other four "to keep them in sync" (HARD RULE, `skeeball/CLAUDE.md`).
  It was paid for: a change for one machine silently re-scored THE CLASSIC overnight and Matt pulled
  the game. **The other four may well have this same blind spot — HOT SHOT is the same cabinet.
  Raise it with Matt as its own job; do not fix it here.**
- **NEVER change the width or diameter of a basket** unless Matt specifically says so. Also frozen:
  the bottom row's 3in set-back against the riser (Matt, 2026-08-23: "do not move them forward
  again"). The fix above needs neither.
- **Do not add a resting-position scoring rule** (section 3b says why; it has been removed once).
  The only way to score a hole is to fall through its mouth. The fix above does not add one — it
  makes capture see a mouth it was already supposed to see.
- **A captured ball never reaches the stall watchdog.** `if (st.captured) { … return; }` returns
  before section 6 and before the trough check; its only escape is `st.t > MAX_T` = 12s. Nothing has
  been seen using it, but it is worth closing while you are in this file.
- `node run-all-tests.mjs` is ~4.5 min and Matt has asked sessions not to run it unprompted.
- **Bump `CACHE` in `sw.js` past what is on `main` right now** and re-run `validate-sw-assets.mjs`.
- "Commit / push / deploy" means **live on the site**: merge to `main` and verify the
  `pages build and deployment` run for that merge commit succeeds. A pushed branch is not done.

---

## 6. Tools

`M.worldToFace(pos)` → `{u, v, h, tilt}`, and `M.faceToWorld(u, v, h)` back. `M.frames` lists the
six staircase segments (`tilt 0.1` = tread, `1.5708` = riser). Physics needs no browser:

```js
const st = P.startThrow(b, { power, aim });
while (!st.done) { P.step(b, st, 1/60); /* sample st.ball.position, .velocity, st.captured, st.t */ }
```

`P.simulateThrow(b, {power, aim})` returns `{ outcome, time, bounces, touchedBoard, emergencyUsed,
events }`. A 41×21 grid is ~100s.
