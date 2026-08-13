# RETIRED BUILD - renamed to skeeball_old (2026-08-13)

> This is the ORIGINAL Skeeball build, retired when `skeeball/` was rewritten from scratch and
> kept in the hub, renamed, for side-by-side comparison (Matt: rename it, do not delete it).
> The document below is its original documentation, unedited, so its paths and names are the
> OLD ones. What actually changed in the rename - and nothing else did:
>
> - Folder: `skeeball/` -> `skeeball_old/`; hub id `skeeball-old`, display title **Skeeball_old**.
> - CSS: `css/skeeball_old.css`, every class/prefix `sk-` -> `sko-` (the rewritten game owns
>   `.sk-` now; two mounted games must never share a root class).
> - Storage: settings `gamehub.skeeball_old.v1`, autosave `gamehub.skeeball_old.save.v1`. The old
>   keys (`gamehub.skeeball.v1` / `.save.v1`) were left in place untouched (THE LAW rule 5) and
>   now belong to the rewritten game; this build's old v2-shaped saves are ignored by the new
>   build's v1-shape check, so the two cannot cross-contaminate.
> - In-game title strings say Skeeball_old.
>
> **Stats recording is deliberately UNCHANGED**: it still calls `recordSkeeball` with its own
> board ids into the shared `skeeball` stats id, exactly as it always did, so every play it ever
> recorded (and still records) stays part of the one skeeball history. Its `classic` board id is
> the same bucket the new build's classic machine uses - records on that machine are shared
> between the two builds by design; see `skeeball/CLAUDE.md`.

---

# Skeeball (`skeeball/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

## What this game IS (2026-08-12, the physics rebuild)

Matt: *"This should be the most basic, classic skeeball machine... this is the first of ~10
skeeball boards."* And, after three table-driven builds in a row failed him: *"I wanted it to be
able to miss a hole and bounce like in real life. And like in 'correct bouncing.mov'... The
physics is what I'm expecting you to be able to handle."*

So the engine is a real **physics simulation** (`js/physics.js`): a ball in metres and seconds,
under real gravity, against analytic colliders built from the machine's geometry. **Scoring is
EMERGENT — the score is whichever hole finally swallows the ball.** There is no scoring table,
no target windows, no `resolveThrow`. A near-miss clips a collar's lip and deflects; the basin
catches it; the big ring's curved wall funnels it down across the 20's mouth; it drops wherever
it really lands. That is the whole game, and it is the contract in
`reference/skeeball/SPEC.md`'s 2026-08-12 section (frame-timed from `Correct bouncing.MOV`).

The LOOK is the reference screenshot in that same SPEC section: TEAL walls and lane, WHITE tube
rings, glossy YELLOW rails, black guard tubes over khaki netting, an LED `BALL / SCORE` marquee,
and the neighbouring machines visible at the frame edges. The warm cream-and-wood machine this
folder used to draw is a DIFFERENT skin in the source app (`Skeeball 1.MOV`) — a later board in
the ladder, maybe, but not `classic`.

## Why the previous engines are gone (read before "simplifying" anything back)

Three builds in a row resolved throws with a lookup — power/aim in, table row out, canned
animation on top — and every one of Matt's complaints lived in the gap between those layers:
"Too hard!" zeros, balls guided in, balls deleted mid-air, speeds unrelated to the flick, and
finally *"Opus has had MAJOR issues with every aspect of the finger flick, to the speed of the
ball - literally every aspect has been a disappointing failure regarding realistic physics."*
A table cannot produce consequences; only simulation can. The old builds' tuning history is in
git and in this file's history; none of it applies to the physics engine.

## Layout & responsibilities

```
skeeball/js/physics.js   the simulation: colliders, gravity, restitution; simulate() -> frames + outcome
skeeball/js/boards.js    the machines as DATA: palette + 3D geometry (rings, drains) + unlock score
skeeball/js/game.js      the rules around the physics: flick mapping, the rack, x3, unlocks, save
skeeball/js/render.js    every pixel, through ONE projection shared with the physics geometry
skeeball/js/howto.js     the HOW TO PLAY carousel; every page's throw is a real simulate() run
skeeball/js/ui.js        DOM shell: picker, rAF loop, flick input, 1:1 playback of sim frames
skeeball/js/strings.js   every user-visible string, { en, es }
skeeball/js/test.js      headless physics + rules assertions (node skeeball/js/test.js)
skeeball/css/skeeball.css  all styles, .sk- prefixed, descendant-scoped under .sk-root
skeeball/index.html      standalone host (same init() as in-hub), name-gated before mount
```

## The physics, and the invariants that keep it honest

- **The world is metres**: x across, y up, z from the foul line toward the machine. Ball radius
  `BALL_R` 0.042 (a real skeeball ball), `G` 9.81. The lane runs 2.10m to a ramp that trades
  speed for its lip height and launches at `launchDeg`; the board is a plane tilted `tiltDeg`
  (60 from vertical = the real machine's ~30 degree incline).
- **Rings are HOLES with collars.** Inside an opening there is no floor — a ball whose centre
  drops through has been swallowed, and that ring's points are the score. The collar's lip is a
  torus that deflects grazing hits (the rim bounce). Cup collars are LOWER than the ball's
  centre on purpose: a slow ball rolling across a cup tips over the collar and falls in, which
  is exactly how the reference clip's throw ends in the 20.
- **The big ring is the basin's wall** (`wallHigh`), not a hole. Its curved inner wall funnels
  rattling balls down toward the bottom centre — across the 20's mouth first (the 20 sits flush
  with the basin bottom BY DESIGN); only what squeezes around drops through the narrow drain
  slot for the 10. The outer board's bottom trough is the other 10-mouth. Everything that
  reaches the board eventually drains somewhere: **the only zero in the game is a flick too
  feeble to climb the ramp, which visibly rolls back to the player.**
- **Deterministic.** Fixed timestep, no rng in the sim: the same flick always does the same
  thing, so practice is real. The one deliberate "imperfection" is `TILT_X`, a constant 0.2%
  lateral lean that breaks knife-edge equilibria (a ball balanced EXACTLY on a collar top would
  otherwise sit forever — the sweep caught it). Constant = still a pure function.
- **Rolling is not impacts.** Two hard-won rules inside the integrator: (1) resting contact
  keeps tangential velocity (impact damping applied 480x/sec to a resting ball freezes it on a
  rim); (2) a ball ROLLING on the board skips lip/wall impulses entirely — collars become
  smooth in-plane guides it rolls around — because alternating micro-impulses parked balls in
  chattering limit cycles. Both failure modes are pinned by the "zero timeouts" sweep in test.js.
- **Rolling resistance on the board is PROPORTIONAL damping, never a constant decel** — a
  constant decel is static friction, and static friction let a ball freeze mid-slope forever.

## The flick — nothing between the finger and the ball

`flickToThrow` (game.js): release speed (canvas-heights/second, sampled over the last ~100ms —
Android's VelocityTracker window) times ONE constant (`FLICK.MPS_PER_CHS`) IS the launch speed;
the swipe angle IS the direction, clamped to the lane. No power curves, no distance blending,
no normalisation. A soft flick VISIBLY rolls slower and dies on the ramp; a hard one visibly
flies; the ball goes where you pointed. The cancel rules survive from the gesture work that DID
land (a tap is not a throw; yanking back down cancels).

## The playback — the sim IS the animation

`simulate()` returns timestamped frames; `ui.js` interpolates them against the real clock, 1:1,
projected through `render.js`'s `proj`. There is no animation model, no durations, no paths -
what is drawn is what was simulated, bounce for bounce. The props (cups, basin band) draw in
two phases split around the ball's board position (`drawProps` 'behind'/'front'), so a rattling
ball passes behind the higher rings and in front of the lower ones instead of floating over a
picture. The ball is never deleted in mid-air and never fades (standing rule; see history).

## Rendering — one projection, solved against the reference

`render.js` authors in a DW x DH design box through a pinhole camera whose constants were solved
NUMERICALLY against the SPEC's measured fractions (big ring 0.48 W, 20-cup 0.11 W, the ~0.72
vertical squash). Everything on the board — rings, drains, ball — is drawn from the SAME
`boards.js` geometry the simulation collides with, through the same `proj`.

The cups are drawn as upright TUBES standing on their holes (the reference app's own prop):
slit mouths, tall white faces carrying the numbers. **The drawn slit is the true opening radius
seen edge-on, so the visible mouth can only ever UNDER-promise the capture area** — a cup can
surprise you by catching a ball, never rob you. That is the surviving form of the old
"what you see is what you score" law; test.js's containment block asserts every scoring throw's
final position is inside its own hole in board coordinates, which is the form that cannot drift.

The marquee is the app's LED readout — `BALL` (red 7-seg) and `SCORE` (pale green) — not a
RECORD/BEST panel; those live on the picker and the end card. Neighbouring machines are drawn
at a visual pitch of 1.15m (closer than physical, like the app's own crowded row); they are
scenery — the sim's world ends at this machine's walls.

## Machines, unlocking, the ladder of ~10

A machine is a `boards.js` entry: palette + geometry + `unlockScore`. `classic` is machine one.
`stars` is the placeholder second machine (same basin physics, values placed for AIM instead of
power) so the unlock path stays exercised; expect it to be replaced as Matt sends references
for the real ladder. Unlock rule unchanged: beat the NEXT machine's `unlockScore` on the one
before it; `js/arcade-scores.js` owns unlock storage/merge (union, additive, synced - THE LAW).

Measured expectations (test.js pins the casual number): casual hand ~200 a rack, skilled ~290,
expert ~330 before multipliers; a deliberate hard diagonal lands a 100 roughly 9-13% of
attempts. `stars` unlocks at 400. Matt's recordings of the old build averaged ~90 a rack with
~all 10s; if the casual number drifts out of 140-340 the game has been detuned.

## Settings & persistence

| Key | Holds |
|---|---|
| `gamehub.skeeball.v1` | `{ board }` - the machine you last picked |
| `gamehub.skeeball.save.v1` | the in-progress rack snapshot (v2 shape, UNCHANGED by the physics rebuild); removed on game over |

Unlocks live in `gamehub.stats` under `sk.unlocked` (earned history, synced, union-merged),
never in settings. `Game.restore()` returns null on anything malformed; a v1 (vs-computer) save
is declined, not misread.

## Stats

Unchanged surface: `recordSkeeball(boardId, extras)` once per finished rack in `_finish()`;
`sk` sub-counters (`played/won/lost/tied/balls/points/bestGame/bestThrow/hundreds/fifties/
boards/unlocked`) with `won/lost/tied` FROZEN from the vs-computer era (THE LAW rule 5). All
three mandatory surfaces exist (`game-stats.js`, `players-agg.js` `src.sk` branch,
`game-stats-ui.js`); `players-agg.test.mjs`'s structural guard fails the build if any goes
missing. Skeeball is in the `SOLO` set and off the leaderboard while `devOnly`.

## Tests

```
node skeeball/js/test.js        the physics and the rules (81 assertions)
node test-arcade-scores.mjs     the shared score/unlock layer
node test-visual.mjs skeeball   light/dark/reduced, both hosts, and a real touch flick that must score
```

`test.js`'s heart is the **[KNOWN-BUG PROBE] CORRECT BOUNCING** block, the reference clip as
assertions: rim hits on 25%+ of a throw grid, every rimmed ball still ends in a hole, deflections
that change the outcome exist (the clip's 40-rim into the 20), a high-ring clip that rattles
0.8s+ and settles low exists, and no bounce ever adds energy. Around it: determinism
frame-for-frame, ZERO timeouts across dense (v, dir) sweeps of every machine, every scoring
throw ending inside its own hole, the hand-units ladder (order, step sizes, casual rack
140-340, zeros < 4%, slam < aim), every ring winnable via `findThrow`, and the rack/multiplier/
unlock/save rules.

`test-visual.mjs`'s skeeball PLAY probe asks the ENGINE (through the real flick mapping) for the
40's speed band and flicks with real touch; it must land real points.

## History that still binds (kept from the pre-physics builds)

- **The ball is never deleted in mid-air, never fades** (Matt, 2026-08-11: *"you just have it
  disappear... I HATE that"*). The sim ends every flight in a hole or back at the player's feet.
- **The score callout is a small rising number at the ball's actual final position**, never a
  starburst, never over a target's centre.
- **The how-to is the animated carousel pattern** (`yahtzee/js/howto.js` is the model), and its
  demo throws are real `simulate()` runs — the tutorial physically cannot demonstrate a flight
  the game would resolve differently. Don't reintroduce a static sheet (*"Yours is dogshit"*).
- **The aim guide shows direction only.** Power is decided at the instant of release; a live
  power gauge is wrong at the only moment that matters.
- **No random scatter on the player's throw.** Determinism is what makes practice real. The
  sim's variety comes from real dynamics, not dice.
- **isInProgress() is the AUTOSAVE/RESUME meaning and always returns false** (root CLAUDE.md,
  "The module contract"): leaving mid-rack is lossless.

## Not done, on purpose

- **No multiplayer** — same standing note as before: Matt's stated end goal is a hub-wide
  turn-based multiplayer layer with direct challenges; do not build a one-off here.
- **`stars` is a placeholder** for machine two until the real ladder's references arrive.
  Machines three through ten are boards.js entries waiting on references.
- **No sound.** Nothing in this repo ships audio yet; the rim clack wants a hub-wide decision.
