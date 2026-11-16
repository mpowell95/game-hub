# Ball Run UX review: Orbital first (2026-11-16)

Written by a session, not by Matt. Matt's words (2026-11-16): "Have an agent review ball run's UI/UX. It could be
improved significantly. especially orbital. you have no idea whats a hole andwhat's about to be a jump. jumps are
really impossible to detect. and drops look exactly like holes. Have the agent review this and give detailed
feedback, then mockup fixes". **A review and mockups only. Nothing here is cleared for players.**

- Mockup page (before/after pairs): `mockup.html` (images in `img/` beside it) and `mockup-embedded.html` (one file), made by the session in its scratchpad from `tools/ballrun-ux/shots.cjs` + `ui-shots.cjs` output; see "How the
  shots were made" at the end.
- Prototype code: `ball-run/js/render.js` (everything behind `UX_PROTO`, off unless the URL has `?uxproto=1`, or
  `?uxproto=cam` for the camera option) and the `UX_*` block at the end of `ball-run/js/config.js`. With the flag
  off the renderer draws exactly what `main` draws. No sim, track or scoring change.

Line numbers below are `main` at d67935d44 unless marked "branch".

## What the player is looking at (measured, not guessed)

- **Speeds.** Medium starts at 30 units/s (1 unit = 1 ball) and reaches 55; Hard reaches 78. The deck is generated
  72 units ahead (`SEGMENTS_AHEAD` 36 x 2, `config.js:21`).
- **What can be read, and when.** In the 402x874 frames, a hazard 45 units out sits in a band about 30 px tall just
  under the horizon (y about 370-440); at 22 units it is about 90 px; at 8 units it fills the lower middle. So with
  today's cues a jump becomes readable at about 15-20 units: **0.3 to 0.6 s at Medium, 0.2 to 0.3 s at Hard**. A
  phone player needs about 0.6-0.8 s to see, decide and drag. The fixes below aim for "readable at 45 units".
- **Jumps are short.** `gapMinSegs` 2 to `gapMaxSegs` 4 (`config.js:276`): 4 to 8 units, and the seeds sampled
  (1-12, Medium, first 1200 m) were 4 units in 55 of 60 jumps. A 4-unit gap at 30 units/s is a 0.13 s hop. The
  Split void is 5 units WIDE (`voidHalfBW` 2.5), i.e. bigger than most jump gaps. On screen both are "a band of
  nothing".
- **The ball jumps by itself.** `sim.js` `stepPlaying` launches the moment z enters a gap (`launchJump`); the
  player never presses anything. So a gap is never deadly, a void always is, and today they are drawn the same way:
  nothing.

## Findings, by severity

### S1. Drops look exactly like holes (Matt's report, confirmed: a render bug)

**Now:** after a drop the deck climbs back to 0 over 3 "recovery" segments (`track.js` `emitJump`, `rdY`). Every
floor segment is drawn as ONE flat quad at its MIDPOINT height (`render.js:458`, `:516-518`), so a slope becomes a
staircase of floating plates. On a staircase going UP, the riser of each step faces the camera and is not drawn, so
the player sees **three black bars across the track**, each one looking exactly like a hole. Shots: `drop-mid`,
`drop-close`, `drop-after` (before). On the lowered pad itself, `drop-after-before` shows the bars dead ahead.
The same staircase shows on every width change (Split widen/narrow, narrower landing pads): jagged "ziggurat"
edges, `split-far-before`, `split-mid-before`.

**Fix (prototyped):** draw each segment as a trapezoid whose corners follow `w0->w1`, `void0->void1`, `y0->y1`,
`wCenter` (branch `render.js` `_layoutUx`, `strip()`). The recovery becomes a smooth ramp, the bars vanish, edges
are straight. Built as one dynamic `BufferGeometry` per material (a `QuadBatch`, branch `render.js:156`): 12-33 draw
calls instead of 85-123 (SwiftShader count, same frames).

**Effort:** S-M (half a day to finish: hoist the per-segment closures, curves check with `CURVES_ENABLED`).

### S2. A hole and a jump look the same (Matt's report)

**Now:** a Split void (`render.js:476-511`) is a black band with two thin amber lines along it, drawn per segment
at constant lateral, so while the void opens they read as a dashed sawtooth (`split-mid-before`,
`split-close-before`). A jump gap (`render.js:445-454`) is a full-width black band with nothing at all. There is no
deck thickness anywhere (every floor is a zero-thickness plane), so both are "deck stops, black, deck again". The
only jump cue is 2-4 amber vertical posts at the landing pad (`render.js:555-575`), and amber is also the void's
colour, the obstacles' edge colour and the tunnel's colour. The deck ALSO stops in a hard edge at the end of the
72-unit window, mid-screen, every frame (`obstacles-before`): a third "black band" that means nothing.

**Fix (prototyped), two shape families, never hue alone:**

| Means | Shape | Colour |
|---|---|---|
| Deadly hole (Split void, split landing pad's gap) | diagonal **stripes** on both lips and down the void's walls; a striped centre strip from the first widening segment, before the void opens | amber `#ffce3a` + near-black |
| Jump you fly over | forward **chevrons** on the 8 units before the gap, a solid **lip** on the edge, a **dotted arc** to the pad, a pad with a lit front edge, a front face and **pillars** | cyan `#5fe3ff` |
| Ordinary deck edge | thin pale rim + a slab side face fading into the void | steel `#8ea3c8` |

Amber vs cyan sits on the blue-yellow axis, which red/green colourblind players see; the pattern (stripes vs
arrows/dots) carries it on its own. Shots: `split-close` and `jump-flat-close` pairs. The deck also gets a 1.1-unit
slab (side and front faces) so a void has depth and a landing pad reads as a separate platform.

**Effort:** M (1-2 days incl. tuning stripe scale and chevron count with Matt; all in `render.js` + `config.js`).

### S3. Jumps are unreadable until too late (Matt's report)

**Now:** at 45 units the jump is a 2-3 px dark line under two amber posts (`jump-flat-far-before`); at 22 units the
posts look like goal posts or a doorway (`jump-flat-mid-before`). The landing pad has no front face, so a pad at
the same height is invisible behind the near edge, and a RAISED pad is a thin dark sliver floating in black
(`rise-mid-before`, `rise-close-before`).

**Fix (prototyped):** the cues in S2, plus:
- the **dotted arc** (branch `_layoutUxArc`) uses the same formula as `Sim.launchJump` with the ball's current speed,
  from the ball's lateral to each landing lane's centre (two arcs on a split pad). It stands up off the deck, so it
  survives foreshortening; it also shows offset pads (the arc bends sideways) and drops/rises (it ends low/high);
- **pillars** under the pad's near corners (and a split pad's inner edges) and a cyan rim round the landing hold;
- the amber gate posts are removed (they spoke the hazard colour for a safe thing).

Shots: `jump-flat-far`, `jump-flat-mid`, `rise-mid`, `rise-close`, `offset-close`, `splitpad-close`,
`splitpad-air`.

**Effort:** M (arc + pad: 1 day; the arc is the item to try on a phone first).

### S4. Drops cannot be seen at all from the chase camera

**Now:** a 2-unit drop over a 4-unit gap is hidden behind the launch deck's edge: the camera (3.6 high, 7.5 back)
cannot see down into it. Even with S1-S3 fixed, `drop-close-after` shows the pad mostly hidden.

**Fix (prototyped):** a sign on a post either side of the lip, outside the deck: a **down triangle** for a drop, an
**up triangle** for a rise, nothing for level (branch `_layoutUx`, "Height sign"). Vertical, so it is readable from
45 units (`rise-far-after`, `drop-mid-after`). The arc also dips. Optional: the higher camera (S8).

**Effort:** S.

### S5. Falling off a lowered pad snaps the ball up to height 0 first (render bug)

`render.js:378`: while FALLING, `ballY = fallY + radius` with `fallY` starting at 0, ignoring `sim.y`. Off the edge
of a dropped pad (y = -2) the ball jumps up 2 units, then falls. Fix: `sim.y + fallY` (branch `render.js:753`).
Found by reading the code; not captured as a frame. **Effort:** XS.

### S6. The deck barely separates from the void

Orbital's deck `#1c2333` on `#03060f` (`config.js:335-337`), grid lines `#3c4a66`. On a phone in daylight the deck's
edge, the only thing that kills you on a plain straight, is a soft dark-on-black boundary. The spec's
"continuous amber edge stripe" (`config.js` Orbital colour comment) was never built. **Fix (prototyped):** deck
`#242e45`, grout `#52648a`, a pale rim on every outer edge, a slab face under it (`orb`, `obstacles` pairs).
**Effort:** XS (colours) + the S1 slab.

### S7. The far end of the track is a hard edge

Covered under S2: the generated window ends 72 units out in a straight black cut, every frame, and reads like a gap
or a cliff. **Fix (prototyped):** `THREE.Fog` in the void colour, 56 to 74 units (`UX_FOG_NEAR/FAR`), so the deck
dissolves before it ends. 56 keeps hazards at 45 units fully lit (44 dimmed them; tried). **Effort:** XS.

### S8. The camera spends 40% of the screen on empty sky

`CAMERA_HEIGHT` 3.6, `CAMERA_LOOK_HEIGHT_FRAC` 0.42 (`config.js:171-174`) put the horizon at about 43% from the top;
everything above it is black. **Option (prototyped, `?uxproto=cam`):** height 4.8, look fraction 0.24: horizon at
about 32%, a hazard at 45 units is roughly a third bigger on screen, more of a drop is visible (`cam-*` pairs).
This changes the feel Matt tuned (camera item 3), so it is offered separately, never bundled. **Effort:** XS to
change, needs Matt to play it.

### S9. HUD text is below the hub's floor

`.br-hud-distance` and `.br-hud-orbs` are 0.82rem (13px) in `--br-ink-dim` `#b9bad0` (`ball-run.css:232`, `:290`);
the game-over distance is 0.85rem dim (`:414`). Root rule: secondary text at least 15px, near white. **Mockup
(CSS injected in `ui-shots.cjs` only, not in `ball-run.css`):** 17px, `#eef0ff`, 800 weight; score 2rem.
**Effort:** XS.

### S10. Score label says "obstacles" but counts more; "1 obstacles"

On Orbital the HUD number and the game-over line "{n} obstacles passed" (`strings.js:33`) include orbs, Splits and
jumps (`sim.js` `collectPickup`, `updateScore`, `stepAirborne`). An orb visibly bumps "obstacles passed". And n = 1
prints "1 obstacles passed" (`ui-gameover` shots). Fix: a plural key, and on Orbital just the number (the cube icon
already says what it is), or no noun at all. **Effort:** XS. No stats change: display only.

### S11. How to play has nothing about Orbital

`HELP_PAGES` (`ui.js:362-367`) is 4 pages drawn in Classic's colours (magenta ball, purple cubes) even when Orbital
is selected: no hole, jump, landing pad, heart or orb. **Mockup:** two extra pages, shown only for Orbital: stripes =
hole, arrows + arc = jump (SVG on the mockup page). **Effort:** S.

### S12. Setup screen sits at the top, under the Hub button area

`.br-setup` (`ball-run.css:61-71`) pins to the top with 24px padding; the hub's rule is a centred card below the
floating "‹ Hub" (`max(safe top, 54px)`). **Mockup:** centred, top padding 54px (`ui-setup` pair). **Effort:** XS.

### S13. Smaller items

- **Heart spins edge-on half the time** (`render.js:668`, a full Y turn): it reads as a pink sliver. Mockup: a
  +-0.55 rad wobble (`heart` pair). XS.
- **Words on the game screen:** "SPEED UP" painted on the tunnel floor (`render.js:110`, `:520`) and the "Extra
  life used!" pill. The floor label is removed in the prototype (`tunnel` pair); the pill was Matt's own ask
  ("obvious"), left as is. XS.
- **Tunnel chevrons are squashed** to thin lines: the 256x512 texture is stretched over each 5x2 floor quad
  (`render.js:85-116`, `:520`). Use world-space UVs (the `QuadBatch` already does this for the deck). S.
- **"Back to hub" goes to the setup screen** (`ui.js:589` calls `showSetup()`); either relabel or leave the game. XS.
- **Game over does not say what killed you.** `sim.crashCause` already knows obstacle / edge / void / landing
  (`sim.js`), the title only says "Crashed!" or "You fell off!" (`ui.js:874`). An icon per cause (block, edge,
  striped hole, missed pad) would teach the hazards with zero words. S.
- **Gate posts at full height right in front of the camera** after landing (`drop-after-before`, the big amber bar).
  Gone with S3.

### Frame rate and cost

- Measured in SwiftShader (software GL, so relative only, never a phone fps): CPU submit time per frame unchanged
  (0.2-0.6 ms either way); draw calls drop from 85-123 to 12-33 because the deck is 4 batched meshes instead of up to
  92 floor quads + 92 accent quads + gates; triangles rise from about 1.1-1.4k to 1.5-5.1k (the arc's 26 small
  spheres are most of it; 6-segment spheres would cut that to under 2k). On an iPhone 16 Pro this is well inside
  budget; fewer draw calls is the bigger win on WebGL.
- The prototype's `_layoutUx` creates a few closures per segment per frame; a real build must hoist them (the rest
  is preallocated: `Float32Array`s, `setDrawRange`, one reused `Matrix4`).
- Fog adds a per-fragment mix; negligible.

### What I could not capture

- A real iPhone (frame rate, sunlight readability, the 120 Hz feel). Every frame is SwiftShader at 402x874, DPR 1.
- S5 (the fall from a lowered pad) is from code reading; no frame.
- Live motion: every hazard frame is a still from the harness (autopilot, the camera settled), not a recording.
- The HUD with hearts banked: no unsteered run lives long enough; the HUD shots show the orb counter only.

## Suggested order

1. S1 + S5 + S6 + S7 (pure render fixes, nothing new to learn): about a day.
2. S2 + S3 + S4 (the two cue families): 2 days with Matt reviewing on his phone.
3. S9-S13 screens and copy: half a day.
4. S8 camera, only if Matt wants to try it.

## How the shots were made (dev only, `tools/ballrun-ux/`)

- `harness.html`: the real `Sim` + `Renderer` for a fixed seed; steps with an autopilot (invincible while stepping),
  stops at a chosen z, draws one frame; `H.bench()` for the cost numbers.
- `shots.cjs`: every hazard pair, same seed and z, prototype off then on (seeds: Split 2, flat jump 7, drop 6, rise 3,
  offset 11, split pad 2, Split with blocks 4, heart/orb 1; Medium).
- `ui-shots.cjs`: the real page (help, setup, HUD, game over) as test1 / DREG5 with sync off; `UX=1` adds
  `?uxproto=1` and the mockup CSS.
- Run: `PORT=8127 node server.mjs`, then `BASE=http://localhost:8127 node tools/ballrun-ux/shots.cjs <outDir>`.
