# Pool (`pool/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys,
> saves, and stats written by this game are governed by it: writes additive, keys never
> repurposed, no silent write failures.

Hub integration: in-hub `module:`, **immersive** (visual rebuild, 2026-07-29 — the hub header
collapses to a floating back button, matching Escoba/Mancala/Ball Run; see "The visual rebuild"
below for why). `isInProgress()` is mode-split (root CLAUDE.md's "two legitimate meanings" note):
**solo (vs. computer) and practice both autosave/resume** (`gamehub.pool.save.v2`, silent restore
straight onto the table, no "resume?" prompt — same pattern as Mancala/Tic Tac Toe), so it returns
`false` for them; **MP returns `true`** for as long as a room is joined, since leaving is
consequential for the other person.

## The rulebook: standard 8-ball ball-in-hand (`js/rules.js`)

**Changed 2026-07-29** (visual rebuild, spec §13.5 / `HANDOFF-POOL-VISUAL-REBUILD.md` §6.4,
Matt's call). v1 shipped "Bar Rules 8-Ball" — ball-in-hand anywhere, always, after any foul. That
is now replaced:

- **Ball-in-hand after any ordinary foul is anywhere on the table.** Only a **scratch on the very
  first shot (the break)** restricts it to behind the head string (screen `u < 0.25`, i.e. physics
  `y < HEAD_SPOT.y`). A scratch on any LATER shot is anywhere, same as every other foul.
  `resolveShot` computes this as `headStringRestricted = ballInHand && cueScratched && isBreakShot`,
  where `isBreakShot` reads `!state.broken` from the shot's INPUT state (before `broken` flips to
  `true` at the end of every `resolveShot` call). `rules.placeCueBall` itself still refuses
  nothing — the UI (`ui.js`'s `_placementLegal`) is what keeps the cue off other balls, out of
  pockets, on the felt, and (new) behind the head string when restricted; the placement ghost
  renders a white ring when the pointer's current spot is legal, red when it isn't, and
  `_commitCuePlacement` silently refuses an illegal drop. The AI's own placement search
  (`_aiPlacementSpot`) respects the same restriction.
- Legal-shot gate: the cue ball's FIRST contact must be a ball of the shooter's own group (or
  either group while the table is open, or the 8-ball once the shooter's group is fully cleared);
  after that, either a ball must be pocketed or something must touch a rail, or it's a foul.
- **Groups are assigned at the first legal, non-foul pot of a money ball** while the table is
  open — whichever group that ball belongs to becomes the shooter's for the rest of the game.
- **The 8-ball**: pocketing it while it isn't yet a legal target, or on a foul shot (including a
  simultaneous scratch), is an instant loss for the shooter; pocketing it cleanly once the
  shooter's own group is clear is an instant win. A player may keep shooting only while they keep
  legally pocketing a ball from their own group (or, while the table is open, any money ball).
- No 4-rails-on-the-break rule, no called shots/pockets beyond the 8-ball itself, no safety-specific
  fouls beyond the generic contact/rail gate above. These are known, deliberate simplifications,
  not oversights — a fuller ruleset is a separate future mode, not a change to this one.
- `pool/js/test-rules.mjs` (wired into `run-all-tests.mjs`) is the regression suite for the
  head-string restriction specifically: break scratch restricted, later scratch not, break
  no-contact foul not (must be a scratch specifically), later wrong-ball foul not.

## The visual rebuild (2026-07-29)

v1's engine (physics/table/rules/ai/hash) survived untouched except for two real,
narrowly-scoped changes below; everything else in this section is `js/ui.js` and
`css/pool.css` being replaced wholesale to match a reference screenshot
(`8ball-pool-build-spec.md`, amended by `HANDOFF-POOL-VISUAL-REBUILD.md` — read the
handoff first, it wins where the two disagree). Full context, including six phase-by-phase
verification writeups, lives in the session that did this work; the durable facts:

- **`TABLE` shrank to a 6-ft bar box, `{ w: 0.9144, h: 1.8288 }`** (was 7-ft, `0.9906 x 1.9812`).
  The build spec's `ballRadius = feltW/64` only holds exactly at the 6-ft size (regulation
  `R = 0.028575` x 64 = 1.8288m); at the old size the balls rendered ~8% small against the
  reference. Still exactly 2:1, still SI meters, the collision/friction MODEL is byte-identical —
  two constants moved, nothing else.
- **Pockets gained a real side/corner split**: `POCKET_R` (corners) stays `1.90R`; a new
  `POCKET_R_SIDE = 2.05R` applies to the two pockets at the midpoints of the long rails
  (`pocketCenters()` now tags each entry `{side: bool}`; `tick()`'s capture check reads the right
  radius per pocket). Previously one `POCKET_R` applied to all six.
- **The renderer is now felt-fraction space, not the old center-origin/scale-factor space.**
  Canvas drawing (table, balls, cue) works in `u,v` (0-1 across the felt, left-right / top-bottom
  on screen) via `_feltLocalRect()`/`_uvToLocal()`/`_ballRadiusLocal()` in `ui.js`. **The ONE place
  screen space converts to/from physics.js's table-local meters is `_toCanvas`/`_toWorld`**
  (handoff §5's explicit ask) — screen `u` tracks physics `y` (TABLE's long axis, matching the
  rack sitting at `u~0.75` against `FOOT_SPOT.y = +TABLE.h*0.25`), screen `v` tracks physics `x`
  (the short axis, an arbitrary but fixed left/right choice). Nothing else in the file should ever
  do this conversion its own way.
- **A separate `loadScreenshotState()` path** (bound to `?debug=1` and Shift+S, spec §11) renders
  the exact reference ball layout and cue angle from `SCREENSHOT_STATE` — plain `u,v` fractions,
  entirely bypassing `this.game`/physics. It's a verification tool, not gameplay; `_drawFrame`
  branches on `this._screenshotBalls` being set to pick it over the real `this.game.balls` render.
- **Hard constraint, unchanged from the spec and worth restating: no aim-assist, ever.** No
  guideline, no ghost-ball circle, no deflection/tangent line, no cushion-bounce prediction. v1's
  `_drawAimLine` drew a dashed forward guideline alongside the cue stick — that violated this and
  was deleted outright when the cue renderer was rewritten as `_drawLiveCue` (stick only).
- **Game-economy chrome is gone**: the green menu button, gold rank star, chat bubble, coin
  pot/stake display, and red rank badge (spec §4.1/4.2/4.3/4.7/4.10) are none of them rebuilt —
  this hub has no currency/XP/chat. The remaining HUD elements (name plate, ball row, avatar x2,
  name plate, ball row, turn indicator) are re-spaced with flexbox rather than the spec's literal
  fractions, since those fractions accounted for the removed elements. Quit/camera/new-game moved
  to a small text-button dock BELOW the stage (not in the spec, which assumes a native app shell
  with its own external chrome) — provisional, flagged to Matt, not reversed as of this writing.
  **Stats still record exactly as before** (`recordResult('pool', ...)`) even though nothing shows
  them during play.
- **No shot clock at all** (spec §13.8 removed per Matt's call) — the turn-indicator's cue-ball
  socket stays static, whose-turn is communicated only by the avatar frame's active glow (green)
  plus a small triangle badge (colorblind rule: never color alone).
- **Storage keys moved to `.v2`** (`gamehub.pool.v2` settings, `.save.v2` solo/practice autosave,
  `.mp.v2` MP rejoin) because the rulebook change makes a v1 save genuinely incompatible with the
  current code. **The v1 keys stay on disk, untouched, never read, never deleted** (THE LAW rule 5).
- **The end-of-game overlay** (spec §15, minus the coins §6.2 removes) dims the table specifically
  (not the whole stage), puts a small gold "WINNER" plate on the winning avatar
  (`.pl-avatar-winner::before`), and centers a green Play Again button below the table — plus a
  close (X), which the spec omits but every win/lose popup in this hub gets (root `CLAUDE.md`).
- **Palette is sampled from the reference PNG directly** (`pool best.png`, repo root), not eyeballed
  from the spec's own hex list (spec §19 says sampled values win). Two real deviations from the
  spec worth knowing: the HUD bar has a blue-purple cast and a faint diagonal weave, not a flat
  neutral grey; the rails are darker/duller than the spec's brighter red-brown, brightest at the
  felt-facing bevel rather than following a simple top-lit gradient.
- **A second height-trap bug, distinct from the one below, was found and fixed during this
  rebuild**: with the stage as a plain (non-absolutely-positioned) flex child, its fixed 1202x744
  intrinsic size pushed `.pl-root` to 789px tall against a 375px viewport when mounted immersive on
  a landscape phone — 552px unreachable by scroll — even though every ancestor already had
  `min-height:0`/`flex:1` set correctly. Fixed by taking `.pl-stage` out of flow entirely
  (`position:absolute`, centered via `top/left:50%` + `translate(-50%,-50%) scale(s)` in
  `_resizeStage()`), so its fixed size can never inflate a flex ancestor. `.pl-root`'s own
  `min-height` also moved from a blind `100dvh` to `calc(100dvh - 98px)`, matching immersive mode's
  own top-padding budget (`css/hub.css`'s `.hub-main-immersive` rule) — see `.pl-root`'s own CSS
  comment in `pool.css` for the full writeup and how to re-measure if either budget changes.

## Physics (`js/physics.js`) — grounded in published billiards physics, not tuned by feel

Per the build guide's explicit instruction. SI units throughout (meters/seconds/kg/radians). The
sliding-friction / rolling-friction split and the contact-point relative-slip formula
(`u = v + R·(ẑ×ω)`) follow the standard treatment used in Marlow's *The Physics of Pocket
Billiards* (1994) and Dr. Dave Alciatore's published technical proofs (billiards.colostate.edu):
a struck ball slides (higher friction, `MU_SLIDE = 0.2`, bleeding spin into roll) while its cloth
contact point still slips, then rolls (`MU_ROLL = 0.011`) once slip reaches zero. Side-spin
(english, the vertical-axis component `wz`) decays independently under its own spin-friction term
(`MU_SPIN = 0.044`). Cushion restitution is **not a constant** — it decays with impact speed
(`cushionRestitution()`), matching the published observation that harder rail hits lose
relatively more energy. Every one of these is a documented constant in `physics.js`'s own header,
not a magic number tuned until a shot "felt right."

**Determinism (build guide §4, "no hidden randomness"): given the same balls, the same
`strikeCueBall` inputs, and the same fixed timestep, `simulateToRest`/`tick` produce byte-identical
results every time.** This is not just a fairness requirement — it is the entire reason
multiplayer here is cheap: a "move" only ever needs to carry the shot's parameters, never a
trajectory, because both devices reach the same table by re-running the same physics (see
"Multiplayer" below).

- **Follow/draw/stun emerge from the physics itself, not from scripted animations.** A cue strike
  above/below center imparts real topspin/backspin (`strikeCueBall`'s `offset.b`); an equal-mass
  ball-ball collision transfers the incoming ball's velocity component along the line of centers
  and leaves it only its tangential component (the real "stun" mechanic) — the STRIKING ball's
  retained spin, now paired with a smaller (or zero) velocity, is what makes it visibly follow
  through or draw back after contact once cloth friction re-engages it.
  `resolveBallCollision`'s small `throwAmt` term (friction-during-contact) is what nudges the
  struck ball a little off the pure line of centers when the striker carries side-spin, per the
  build guide's explicit ask ("side spin... nudges the object ball slightly off line").
- **Squirt and masse are both modeled, both minimally.** An off-center hit deflects the cue ball's
  initial path slightly opposite the offset (`SQUIRT_COEFF`, real cue/ball moment-of-inertia
  effect) and, with the cue raised (`elevation > 0`), residual side-spin curves the path while
  still sliding (`stepBall`'s masse term) — the build guide's "curve back if the cue is raised."
  Neither is a full 3D rigid-body treatment; both are the standard first-order approximations used
  by the same published sources above.
- **`physics.js`/`table.js`/`rules.js`/`ai.js`/`hash.js` are pure — no DOM, no `import.meta`,
  fully importable from plain Node** (this is what makes the AI's lookahead and any future
  headless test cheap: `simulateToRest` on a cloned ball array is the same function the UI drives
  frame-by-frame, just called in a tight loop with no rendering in between).

## Controls (`ui.js`) — the gesture-priority rule the build guide asks to be written down

One continuous drag on the table does three things depending on phase, and **the phase, not the
finger count alone, decides which gesture wins**:

1. **First touch-down starts AIM.** The aim line points from the cue ball away from the finger
   (a "slingshot" pull, the same convention as the mainstream mobile pool apps this guide is
   describing) and recomputes directly off the pointer's absolute angle to the cue ball — fast,
   coarse. **A second finger held down while aiming switches to FINE mode**: the angle no longer
   snaps to the pointer's absolute position, it *integrates* small deltas at a reduced
   sensitivity (`× 0.22`), for the last small adjustment the build guide asks for.
2. **Releasing the first finger (with aim locked) arms POWER-PULL, it does not fire.** A second
   press-drag along the (now fixed) aim axis sets power by how far it's pulled; **drifting too far
   sideways off that axis cancels the pull and drops power to zero** (`perp > 46px`) rather than
   firing — the build guide's explicit "drag sideways to cancel" rule.
3. **Releasing during an armed pull with `power > 0.15` shoots.** Anything smaller is treated as
   "didn't really mean to shoot" and just resets, so a light accidental tap never fires a shot.

Spin (a small cue-ball-face picker, drag inside sets `{a, b}` in [-1,1], double-tap resets to
center) and cue elevation (a plain slider, not a gesture — raising the cue via drag would compete
directly with aim/power on the same touch surface, so it was deliberately kept off the shared
gesture stream) are separate controls with their own hit areas, never competing with the table's
own pointer stream. Camera (`🎥` toggle, top-down vs. a purely cosmetic `perspective()`/`rotateX()`
CSS tilt for "behind the cue") is visual only — the physics coordinate system never changes.

## AI opponent (`js/ai.js`)

Enumerates ghost-ball aims at every legal target ball × every pocket, rejects any aim whose
straight-line path (cue→ghost or target→pocket) passes within `1.95R` of another ball
(`pathBlocked`), then **scores every remaining candidate with a real physics lookahead** —
`simulateToRest` on a cloned ball array, the exact same deterministic engine the player shoots
with — rather than a geometric approximation. Skill tiers (`beginner`/`intermediate`/`pro`) vary
aiming/power error and how often the AI settles for a merely-good candidate instead of the best
one found (`topN`); **the physics itself never changes per tier**. Ball-in-hand placement for the
AI (`_aiPlacementSpot` in `ui.js`) scans a small fixed grid for the first non-overlapping spot —
deterministic, no attempt at "smart" safety placement.

## Multiplayer (2 human seats, `js/net.js`)

Same `rooms/<CODE>` lockstep protocol as Chinchón/Escoba/Tic Tac Toe/Mancala/Filler/Dots and
Boxes (`js/CLAUDE.md`'s "Multiplayer lockstep — invariants"). `js/net.js` itself is untouched.

- **`_localSeat()` was built in from the first line** (root CLAUDE.md's explicit instruction for
  this game): host = seat 0, guest = seat 1; solo vs. computer is the degenerate case (human
  always seat 0, computer always seat 1). Every "whose turn / did I win / which ball group is
  mine" read goes through `_localSeat()`/`_isMySeat()` — nothing assumes the local player is
  always seat 0 the way some earlier games in this repo had to be rewritten to stop doing.
- **A move is just the shot's parameters** (`{g, dir, power, offset, elevation}`), never a
  trajectory — physics.js's determinism is what makes this safe. The room's `round.dealer` field
  is repurposed as "the seat that breaks" (one game per room; a rematch is a fresh room, no
  in-room rematch series, unlike the reference games — kept out of scope for this first pass).
- **The shooter applies its own shot immediately** (no round-trip wait to see your own shot
  land — `_mpLocalShoot`), computes the resulting `hash.js` state hash, and appends
  `{move, hash}` to the room's move log. **The peer applies the identical shot params on
  delivery** (`_mpApplyNextEntry`) and compares its own resulting hash — a mismatch (which, given
  float non-associativity across two different JS engines running hundreds of fixed physics
  steps, is the realistic failure mode here rather than a logic bug) triggers the same
  host-authoritative recovery snapshot the reference games use (`writeRecovery`/`requestRecovery`/
  `clearRecovery`, unchanged from `net.js`).
- **Ball-in-hand is part of the same move**, not a separate lockstep entry — placement (if any)
  is applied before the strike, both locally and on delivery, so the two are never allowed to
  desync from each other.
- **MP results record under a `'mp'` difficulty bucket**, matching every other MP game in this
  repo, via the generic `recordResult('pool', 'mp', won)` (Pool has no per-game sub-counter, so
  no `players-agg.js` branch was needed — see "Adding a game" item 7's three-edit rule, which only
  applies to a game that stores something richer than played/won/lost). `recordHeadToHead('pool',
  opp, won)` runs alongside, guarded so it can never block the ordinary result.
- **Status: proven only by construction/inline reasoning, not by a headless lockstep test suite**
  (unlike the six reference games, which each have a `test-mp-lockstep.mjs` block). Nothing here
  has been played on two real devices or against a `FakeRoom` harness yet — flagged honestly
  rather than claimed as verified.

## Settings and keys

**`.v2` since the 2026-07-29 visual rebuild** (the rulebook change makes a v1 save shape
genuinely incompatible — THE LAW rule 5: `gamehub.pool.v1` / `.save.v1` / `.mp.v1` stay on disk,
untouched, never read, never deleted):

- `gamehub.pool.v2` — settings (currently just `difficulty`).
- `gamehub.pool.save.v2` — solo/practice autosave (the whole `rules.js` state, cleared on game
  end or an explicit Quit).
- `gamehub.pool.mp.v2` — MP rejoin snapshot (role, room code, applied seq, state), separate key
  per the repo's established three-key convention (settings / solo save / MP save never share a
  key).
- Recorder: `recordResult('pool', difficulty, won)`; MP additionally calls
  `recordHeadToHead('pool', opp, won)`. **Unchanged by the rebuild** — the stats id `'pool'` is
  frozen (THE LAW rules 1/5) and results record exactly as before even though the HUD no longer
  displays anything during play (the game-economy chrome that used to imply a win counter is gone,
  see "The visual rebuild" above).

## First-playtest fixes (2026-07-28, CiC UI/UX review)

The initial ship was, in Matt's words, "really really bad" — a real-device/CiC review (mobile
viewport, actual play vs. computer) found the game close to unplayable. Every finding was
root-caused and fixed rather than patched over; the two worth understanding for future work:

- **The table rendered as a squeezed strip and the rack as an unscaled blob — a CSS layout bug,
  not a rendering bug.** `.hub-game` (`css/hub.css`) sets no explicit `height` on the container a
  module mounts into; it's a plain block child sized to content, not to the hub's available
  viewport. `.pl-root`'s original `height:100%` had nothing definite to resolve against, which
  collapsed the whole `.pl-table-wrap`/canvas chain down toward the bare HTML canvas element's
  default 300×150 intrinsic size — then CSS stretched that tiny raster to fill a differently-shaped
  box, which is what read as a low-fidelity/placeholder table. Two-part fix: `.pl-root` now sets
  `min-height:100dvh` (Escoba's own precedent for the same shared-shell gap, `css/escoba.css`) so
  it has a real, self-sufficient height regardless of the ancestor chain; **and**, since a
  `min-height` on an ancestor still doesn't give a *percentage-height* child (`.pl-game{height:100%}`)
  anything definite to resolve against per spec, `.pl-game` and the flex chain below it use
  `flex:1` (flex-grow) instead, which doesn't have that restriction. `_resizeCanvas()` also now
  guards against a `<20px` rect (the real first-layout-pass race that triggered this even after
  the CSS was right) with a `requestAnimationFrame` retry, and a `ResizeObserver` replaced the
  `window.resize`-only listener so an internal flex settle or orientation change is caught too.
- **Shots did not reliably fire, and once fired, the game could hang indefinitely — two separate
  bugs, both in `ui.js`/`physics.js`, not one.** (1) The original aim/power gesture required a
  *lift*, then a *second, separate press* to charge power — but a real touchscreen mints a brand
  new `pointerId` on every fresh contact, and the code's `primaryId` never got reassigned to it,
  so the second press was silently ignored: the power meter never moved and no shot ever fired.
  Replaced with the standard single continuous-drag "slingshot" model (`_bindTablePointer`): aim
  angle and power both derive live from the current pointer's distance/angle to the cue ball while
  ONE press is held; release above a small threshold shoots. (2) Separately — and the more
  serious bug — `physics.js`'s sliding/rolling friction applied a FIXED per-step decrement
  regardless of how small the residual slip/speed already was. Kinetic friction is genuinely
  constant-magnitude while sliding (correct physics), but a fixed-magnitude-per-step *integrator*
  can overshoot PAST zero slip at low speed, flip its sign, and get "corrected" by an equally
  oversized decrement next step — a stable limit cycle that never actually reached zero. A ball
  would settle into an imperceptible but perpetual creep instead of stopping, so `isMoving()`
  never returned `false`, `resolveShot()` never ran, and the game just sat there after a shot with
  no visible symptom beyond "nothing happens" (which is exactly how the reviewer read it). Fixed
  by deriving the exact, finite slide-to-roll crossing time analytically (`|u|` shrinks at the
  constant rate `(7/2)·mu_slide·g`, a real result of combining the linear and angular equations of
  motion — see `physics.js`'s comment above the fix) and clamping both the sliding and rolling
  branches to that crossing point instead of a naive fixed step. Verified with a 30-shot varied
  batch (`simulateToRest`) — every one settles to exact zero velocity, none hang or run past a few
  physics-seconds. **This is the class of bug `test-mp-lockstep.mjs`-style regression coverage
  would catch early; Pool still has none (see "Multiplayer" above) — adding a settle-time
  assertion to a future headless Pool test suite is the concrete next step, not just an aspiration.**
- Smaller fixes from the same review, each real but lower-severity: a native `alert()` on the foul
  icon replaced with a non-blocking DOM toast (a blocking dialog freezes the whole page's input
  pipeline until dismissed — a correctness bug, not just a UX wart, and the most likely explanation
  for the reviewer's separate note about input appearing to "stall"); the spin picker's
  `setPointerCapture` call reordered after the visual update and wrapped in `try/catch` so a
  capture failure can no longer suppress the tap entirely; the quit confirmation now renders real
  on-screen text (`leave_game_confirm`/`quit_confirm`) instead of a `title=` tooltip, which never
  shows on a touch device (no hover) and could let a second tap quit with nothing ever visibly
  confirmed; transient aim/power state is now reset at the top of every `_renderGame()` so a
  stale aim line from a quit game never bleeds into a fresh one; balls and pockets gained cheap
  radial-gradient shading so they read as spheres/depth rather than flat placeholder discs.
- **Not yet addressed, flagged for a future pass**: the hub's own "Add to Home Screen" bottom
  sheet (`js/a2hs.js`, shared shell code, out of this game's scope) can cover the setup screen's
  Start/How to Play buttons on a first visit — a real obstacle, but a hub-wide component issue,
  not specific to Pool.

## Known limitations (stated honestly, not hidden)

- Camera is top-down plus a cosmetic tilt toggle; no real 3D perspective, no working pinch-zoom/
  pan yet (the build guide's controls section asks for both — deferred, not silently dropped).
- No shot clock (removed on purpose, see "The visual rebuild"), no jump shots (elevation currently
  only drives curve/masse, not an actual vertical launch), no called-shot/safety-specific fouls
  beyond the generic rulebook above.
- **No cue-elevation UI control** — `this._elevation` stays `0` always; the build spec has no
  elevation control either (curve/masse only shows up via side-spin + a raised cue in the physics
  model, and nothing in this UI raises the cue). A known, deliberate gap, not an oversight.
- **The quit/camera/new-game dock below the stage is provisional** — the reference is a native app
  shell with its own external chrome, so this hub needed *something* for those affordances that
  the spec doesn't speak to. Flagged to Matt during the rebuild; not yet revisited.
- **Shot-settle animation is unverified in the in-house preview browser** — its `requestAnimationFrame`
  essentially never fires when the pane isn't actively composited (confirmed: a 2-second rAF-counting
  loop returned zero callbacks), so the `_startLoop` render/simulation-drain loop, while unchanged
  standard code, could only be verified by direct state inspection (pointer gesture → correct
  `_power`/`_aiming` transitions → `_simulating` flips true), not by watching an actual shot settle
  on screen. `physics.js`'s own settle behavior IS verified headless (`test-physics.mjs`, no rAF
  dependency). Confirm the actual animation on a real device before assuming it's smooth.
- No i18n live re-render via `onLangChange` (strings resolve at render time only, same minimum
  bar every other game meets — see root CLAUDE.md item 9).
