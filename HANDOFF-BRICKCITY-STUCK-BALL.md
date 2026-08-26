# HANDOFF — BRICK CITY: the ball that sits in the negative baskets

**Written 2026-08-26 by the cloud session that shipped v493–v495.** For a session running **on Matt's
laptop**, which is the point: it has a real GPU and Matt is sitting there. The cloud container that
did the work below renders WebGL in SwiftShader (software, no GPU at all), so every frame-rate
number it produced had to be caveated, and it could never drive the game the way a person does.

Read this whole file before running anything. **Most of the obvious experiments have already been
run and came back negative** — the value here is knowing what NOT to spend the afternoon on.

---

## 1. The task

Matt, 2026-08-26, playing HOT SHOT: BRICK CITY:

> "the ball sometimes gets stuck IN the negative baskets. Like instead of falling in, it's just
> stuck there."

and, correcting an earlier misreading:

> "the ball was NOT perched on the back of the rim against the backboard. It was IN the basket. Half
> of the ball out and half completely in. I've even seen a second ball fall into the same negative
> basket while one is stuck/frozen."

**Question 1 (do this first): does it still happen on v495?** A fix shipped at ~14:30 UTC on
2026-08-26 that bounds the known version of this from 2.62s to 0.57s. Matt reported the bug from a
build that may have been v494. **If it is gone, the job is to confirm that and close this file.**

**Question 2 (only if it still happens): root-cause it.** The cloud session could not reproduce a
ball freezing *inside a cup* in ~3,000 simulated throws. See §4 for everything already excluded.

---

## 2. What is already known and PROVEN — do not re-derive

### The stall that exists, and where it is

A 41×21 power/aim sweep found **59 of 861 throws (7%) park the ball dead still**, and every single
one is at the **same world position**: `z -2.289`, `y 0.579` or `y 0.627`.

```
bottom cup centre   y 0.439   z -2.235    rim top y 0.585   r 0.109   collar 0.146
riser behind it     top y 0.620           front face z -2.234
ball (r 0.0545)     rests at              y 0.579 / 0.627,  z -2.289
```

In face coordinates the parked ball is at `h = 0.0545` (exactly one ball radius off the local
surface) and `d ≈ 0.32` from the nearest cup centre — i.e. **it is resting against a riser, out on
the tread, ~32 cm from any basket**.

**BUT — and this is the thing that took two rounds to see — from the play camera that position
renders as a ball sitting HALF IN, HALF OUT of the −10.** The camera is low and behind the ball
looking up the lane, so the tread behind the bottom row is seen *through* the rims. Matt's
description is correct; the coordinate description ("perched on the rim") was the misleading one.

**Reproduce that picture in one command** — park a ball there and render through the real camera:

```js
// in the browser, on the play screen, with brickcity loaded
const R = window.__skTest.ui.renderer;
R.render = () => {};                                  // stop the loop overwriting it
const m = R._balls[0];
m.visible = true; m.position.set(0.0048, 0.579, -2.289); m.quaternion.set(0,0,0,1);
for (let i = 1; i < R._balls.length; i++) R._balls[i].visible = false;
R.renderer.shadowMap.needsUpdate = true;
R.renderer.render(R.scene, R.camera);
```

### Why the ball can rest there at all

BRICK CITY is a staircase: its treads are nearly flat (`tilt 0.1` rad) with vertical risers
(`tilt π/2`) between them. THE CLASSIC is one continuous slope, which is why `physics.js` section 3b
can say a ball at rest is "left alone" and "rolls back down into the trough like a real machine" —
on a slope that is true. **On a staircase it is not, and nothing replaced the guarantee.**

### Why capture cannot take it

`machines/brickcity/physics.js` section 2 gates capture on `f.h < G.ballR * 1.9` = **0.1036**. The
bottom row's collar is **0.1455** tall. So there is a 4 cm band inside every bottom cup that the
collar branch (`lip > 0 && f.h < lip`) can never be reached for, because the outer guard fails
first. **This looks like a real latent bug and was NOT changed** — it was not the cause of the
measured stall (the parked balls are outside the mouth entirely, `d ≈ 0.32`), so touching it would
have been a scoring change with no evidence behind it. **If Question 2 is live, start here.**

### What shipped in v495 (commit `137eaef`)

The stall watchdog in section 6 used to wait 0.9s, pop the ball, wait 0.9s, pop again, wait 0.9s,
then give up — **2.7s of dead ball plus two visible twitches**. Measured over 861 throws: it fired on
**65 (7.5%, about one ball every other rack)**, 57 went all the way to jammed, and the two pops
rescued **one ball in 861 — into a −20**.

Now: parked 0.6s ⇒ jammed, scores zero, vanishes. (Matt's standing rule, 2026-08-22: *"Stuck balls
should score ZERO. and not be moved. It should vanish."*)

| | before | after |
|---|---|---|
| worst dead-still stretch | 2.62s | **0.57s** |
| median settle | 2.42s | 2.12s |
| outcomes changed, of 861 | — | **2, both a −20 becoming a 0** |

**GUARD: 0.6 is measured.** At 0.45s the sweep starts killing real throws (a 100 became a 0).
Shortening the window while KEEPING the pops is worse: 63 outcomes move, 44 against the player,
because a pop near the bottom row knocks the ball into a penalty cup.

`test-brickcity-stall.mjs` pins it (21×11 grid, ~30s) and was **born red** against the pre-fix
engine: 20 of 231 parked, worst 2.59s.

### Why a second ball joins the first

Not a bug in itself, and worth knowing before it sends you down a hole: `game.canThrow()` releases
the next ball as soon as the previous one has `arrived` (first contact at the board end), and
**every throw gets its OWN cannon world** (`buildWorld` per throw). Two live balls therefore cannot
collide — the second drops straight through/past the first into the same basket. Both are drawn.
This is by design; do not "fix" it without asking Matt.

---

## 3. Do this first (15 minutes)

1. **Confirm the build.** Version pill in the hub top bar must read **v495**. `v494 → v495` with an
   arrow means the new worker has not installed — reload, or force-close and reopen.
2. **Play 3–4 racks of BRICK CITY and watch the bottom row.** Specifically: when a ball hangs, does
   it clear in about half a second, or does it sit for seconds?
3. If it clears fast: **you are done.** Say so, and delete this file in the same commit.
4. If it still hangs for seconds, go to §5 and get the four measurements.

---

## 4. Already ruled out — do NOT repeat these

Every one of these was run to completion and came back negative. Re-running them is a wasted
afternoon.

| Hypothesis | How it was tested | Result |
|---|---|---|
| Physics freezes a ball inside a cup | 41×21 grid, per-frame speed + capture state | **0 of 861.** Worst time spent inside a cup after capture: **0.48s** |
| Frame rate / dt pattern causes it | Same grid at 60 / 30 / 20 / clamped-10 fps, plus two jittery-phone patterns | **Identical to 2 dp in every regime.** The accumulator makes physics frame-rate independent |
| Hard swipes (power > 1.0) do it | 1,281 throws, power 1.0 → 2.5 (power is deliberately unclamped in `startThrow`) | **0 hangs** |
| A ghost mesh — ball drawn with no physics ball behind it | Real Chromium, 28 balls, up to 5 live at once, 414 frames, comparing `R._balls` against `game.balls` every frame | **0 ghosts, 0 frozen meshes.** The renderer is faithful |
| The emergency 12s cap fires | `simulateThrow().emergencyUsed` across the grid | Fires, but the worst total settle is 6.24s — the cap itself is not what is being seen |
| The broadphase change (v493) altered physics | 861-throw grid, this engine vs `origin/main`'s, comparing hole, value, settle time to 6 dp, bounce count, board contact and the full event sequence | **861 of 861 identical.** It is a pure speedup |

**One thing NOT ruled out, because the cloud session could not do it: anything specific to iOS
Safari on an iPhone 16 Pro.** A laptop does not reproduce that either. If §5 comes back clean on
desktop and Matt still sees it on his phone, the answer is the instrumented build in §6.

---

## 5. If it still hangs: the four measurements to take

You have a real GPU and Matt in the room. Get these, in this order.

**(a) Is the hung ball real or drawn?** With the game on the play screen:

```js
const ui = window.__skTest.ui, R = ui.renderer;
setInterval(() => {
  const live = ui.game ? ui.game.balls : [];
  console.log('live', live.length,
    live.map(s => ({ y:+s.ball.position.y.toFixed(3), z:+s.ball.position.z.toFixed(3),
      sp:+Math.hypot(s.ball.velocity.x,s.ball.velocity.y,s.ball.velocity.z).toFixed(3),
      cap: s.captured || null })),
    'drawn', R._balls.filter(m => m.visible).length);
}, 250);
```

- Live ball present, `sp ≈ 0` → **physics.** Note `cap`: if non-null the ball is captured and the
  only escape is the 12s cap (the captured branch `return`s before the stall watchdog — see §7).
- No live ball but a mesh drawn → **renderer**, and that contradicts the table in §4, so capture the
  exact sequence.

**(b) Where is it, in face coordinates?** `h` and the distance to the nearest cup decide everything:

```js
const { buildMachine } = await import('/skeeball/js/machines/brickcity/machine.js');
const { boardById } = await import('/skeeball/js/boards.js');
const b = boardById('brickcity'), G = b.geom, M = buildMachine(G);
const s = window.__skTest.ui.game.balls[0];
const f = M.worldToFace(s.ball.position);
let near = null;
for (const [id,h] of Object.entries(G.holes)) {
  const d = Math.hypot(f.u-h.u, f.v-h.v); if (!near || d < near.d) near = { id, d, r: h.r, lip: h.collarH||0 };
}
console.log({ h: f.h, u: f.u, v: f.v, near, guard: G.ballR*1.9 });
```

- `d < near.r` and `h` between `0.1036` and `near.lip` → **the capture guard gap in §2 is the bug.**
  That is the fix: let the collar branch see a ball inside a tall cup. It is a SCORING change (a
  hung ball would start counting as the −20 it is sitting in), so put it to Matt before shipping.
- `d ≈ 0.32`, `h ≈ 0.0545` → it is the known tread/riser park, and the question is only whether
  0.6s is short enough.

**(c) How long, exactly.** Wall-clock from "stops moving" to "gone". Under ~0.6s = working as
shipped. Seconds = something the sweep cannot see.

**(d) Does it survive the rack?** Does the pip counter advance while it sits? Does it clear when the
next ball lands, or persist to the game-over card? A ball that outlives the rack is a renderer
problem, whatever §4 says.

---

## 6. If it only happens on the phone

Ship a dev-only probe rather than guessing. `js/bug-report.js` already collects and uploads a device
payload, and `js/error-log.js` is the pattern for a small ring buffer. Add: whenever a drawn ball has
not moved for >1s, record `{ live count, ball position, face h/u/v, nearest hole + d, captured,
st.t }` into a ring buffer that the bug report carries. Matt plays two minutes, files one report,
`node read-bug-reports.mjs` reads it back. That closes the loop without needing his device in a
harness.

---

## 7. Landmines in this area

- **BRICK CITY owns its own engine.** `skeeball/js/machines/brickcity/{physics,machine,render}.js`.
  A fix here must NOT be copied into the other four "to keep them in sync" — that rule is a
  HARD RULE in `skeeball/CLAUDE.md` and it was paid for (a change for one machine silently
  re-scored THE CLASSIC overnight and Matt pulled the game).
- **NEVER change the width or diameter of a basket** unless Matt specifically says so. Also frozen:
  the bottom row's 3in set-back against the riser (Matt, 2026-08-23: "do not move them forward
  again"). Both of those are what create the cradle — and both are still off-limits.
- **A captured ball never reaches the stall watchdog.** `if (st.captured) { … return; }` returns
  before section 6 and before the trough check. Its only escape is `st.t > MAX_T` = **12 seconds**.
  Nothing has been observed using it, but that window is real and indefensible; closing it is cheap
  insurance if you touch this file anyway.
- **Do not add a resting-position scoring rule.** Section 3b says why, and it has been removed once
  already. The only way to score a hole is to fall through its mouth.
- `node run-all-tests.mjs` is ~4.5 min and Matt has asked sessions not to run it unprompted. Run
  what your change touches: `test-brickcity-stall.mjs`, `skeeball/js/test.js`,
  `test-skeeball-machine-spec.mjs` (86 passed / 11 pre-existing waivers — that count matches
  `origin/main`, do not chase it), `test-visual.mjs skeeball`, `validate-sw-assets.mjs`.
- **Bump `CACHE` in `sw.js` past what is on `main` right now** and re-run `validate-sw-assets.mjs`
  to refresh `REST_MANIFEST` before any deploy that touches a precached file.
- "Commit / push / deploy" means **live on the site**: merge to `main` and verify the
  `pages build and deployment` run for that merge commit succeeds. A pushed branch is not done.

---

## 8. Where the session numbers came from

Every figure above is reproducible with short scripts against the real engine — no browser needed
for the physics ones:

```js
import { boardById } from './skeeball/js/boards.js';
import { engineFor } from './skeeball/js/engines.js';
const b = boardById('brickcity'), P = engineFor('brickcity').physics;
const st = P.startThrow(b, { power, aim });
while (!st.done) { P.step(b, st, 1/60); /* sample st.ball.velocity, st.captured, st.t */ }
```

`P.simulateThrow(b, {power, aim})` returns `{ outcome, time, bounces, touchedBoard, emergencyUsed,
events }` for a whole grid quickly. A 41×21 grid is ~100s. `M.worldToFace(pos)` converts a world
position into the `{u, v, h, tilt}` frame capture actually uses — that mapping is what turned a pile
of world coordinates into the answer, and it is the first tool to reach for.
