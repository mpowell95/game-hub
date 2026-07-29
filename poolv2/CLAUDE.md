# Poolv2 (`poolv2/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys,
> saves, and stats written by this game are governed by it: writes additive, keys never
> repurposed, no silent write failures.

## The name (settled — do not change)

**Poolv2, everywhere**: display title (both languages), folder `poolv2/`, hub id `poolv2`, stats
id `'poolv2'`, storage keys `gamehub.poolv2.*`, room game tag `'poolv2'`, CSS root `.p2-root` and
prefix `.p2-`. Matt has a **second, separate pool game in development**, and the name exists so
the two can never collide — not in a folder, a URL, a stats bucket, a multiplayer room tag, or an
injected stylesheet (module stylesheets are injected into the shared `document.head` and never
removed on `destroy()`, so a shared CSS prefix between two pool games would genuinely cross-style
them). **The plain `pool` namespace is deliberately left free for that other game.** Do not
rename this to "Pool", do not treat the `v2` as a version number to tidy away, and do not
"align" the folder with the display name in the other direction.

Renamed from `pool`/`.pl-` on 2026-07-28. **Correction (2026-07-28, later the same day):** the
rename was originally justified as "this game never shipped, never merged to main" — that turned
out to be wrong. `pool/` (the original, unrenamed game) merged into `main` via PR #2/#3 in
parallel with this branch's own work, and `main` deploys straight to GitHub Pages with no separate
release step, so `pool/` has been live in production since 2026-07-28. **The actual reason this
folder is allowed to be separately named `poolv2/`, not a THE-LAW-rule-5 violation, is Matt's own
call**: Matt found the shipped `pool/` game bad and asked for a from-scratch rebuild to evaluate as
a possible replacement, named `v2` on purpose so he can review and play it before it replaces
anything. `poolv2/` is therefore its own independent game with its own identity
(`gamehub.poolv2.*`, stats id `'poolv2'`) — not a rename of `pool/`'s identity, and never merged
into `main`/deployed until Matt approves. `pool/`'s own ids/keys are untouched and stay that way;
if `poolv2` is ever approved to replace `pool`, that is a separate, deliberate decision (likely:
retire `pool/` from the hub while leaving its stats/keys frozen per THE LAW rule 5, not renaming
`poolv2/` back to `pool/`).

Hub integration: in-hub `module:`, not immersive (keeps the hub header, unlike Escoba/Mancala/
Ball Run). `isInProgress()` is mode-split (root CLAUDE.md's "two legitimate meanings" note):
**solo (vs. computer) and practice both autosave/resume** (`gamehub.poolv2.save.v1`, silent restore
straight onto the table, no "resume?" prompt — same pattern as Mancala/Tic Tac Toe), so it returns
`false` for them; **MP returns `true`** for as long as a room is joined, since leaving is
consequential for the other person.

## One named rulebook: "Bar Rules 8-Ball" (`js/rules.js`)

Per the build guide's item 3 ("one game mode with one named rulebook"), this is the only mode
shipped. Simplified from full BCA "egyptian" 8-ball on purpose, to keep the rules engine's surface
small and unambiguous:

- **Ball-in-hand after any foul is anywhere on the table** (the common bar-table variant), not
  restricted to behind the head string. `rules.placeCueBall` refuses nothing itself; the UI's
  placement drag is the one that keeps the cue off other balls (`_commitCuePlacement` in `ui.js`).
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

## Controls (`ui.js`) — one continuous drag, corrected after a real playtest

**Corrected 2026-07-28.** The original design (still described in `BUILD-SPEC.md` §3, kept there
as build history) was a two-phase gesture: first touch aims, releasing "arms" a power-pull, a
second press-drag sets power. A first-playtest review (Chrome-in-Chrome, actual mobile-viewport
play) found this close to unplayable: a real touchscreen mints a **brand-new `pointerId` on every
fresh contact**, so the code's `primaryId` never recognized the second press as the same shot —
aim locked, the power meter never moved, and no shot ever fired. This is now the standard
mobile-pool-app pattern instead, **one continuous drag, no lift-then-repress**:

- While ONE finger is down, its live distance from the cue ball IS the power ("stretch and
  release" — farther = harder), and its live angle relative to the cue ball IS the aim, both
  continuously. A small dead zone near the cue ball (`DEADZONE_PX`) means light contact doesn't
  register as a shot yet.
- **Releasing above a small power threshold (`power > 0.35`) shoots.** Anything smaller (or no
  real drag at all) is just a tap and cancels cleanly on its own — no separate cancel gesture
  needed, unlike the old "drag sideways to cancel" rule this replaced.
- **A second finger held down while aiming switches to FINE mode**: the angle no longer snaps to
  the pointer's absolute position, it *integrates* small deltas at a reduced sensitivity
  (`× 0.22`), for the last small adjustment the build guide asks for — **but only once aiming has
  already committed with the first finger.** See pinch-zoom below for what a second finger means
  *before* that.

Spin (a small cue-ball-face picker, drag inside sets `{a, b}` in [-1,1], double-tap resets to
center) and cue elevation (a plain slider, capped at 28° to match `strikeCueBall`'s real clamp —
not a gesture, since raising the cue via drag would compete directly with aim/power on the same
touch surface) are separate controls with their own hit areas, never competing with the table's
own pointer stream. Camera (`🎥` toggle, top-down vs. a purely cosmetic `perspective()`/`rotateX()`
CSS tilt for "behind the cue") is visual only — the physics coordinate system never changes.

**Pinch-zoom/pan (added 2026-07-28, BUILD-SPEC.md §6 #10).** Two fingers already meant "fine aim"
(above), so a real tiebreak was required before this could be built — BUILD-SPEC.md §4 rule 6
demanded it be written down first: **two fingers only ever mean fine aim once aiming has already
committed with one finger down.** To make that distinction on the very first touch (a genuine
two-finger pinch vs. one finger about to aim, with a second about to arrive), aim commit is held
for a short window (`PINCH_WINDOW_MS`, 90ms) after the first touch; a second finger landing inside
that window reads as a pinch instead, and the pending aim is discarded. A single finger that moves
more than `PENDING_MOVE_COMMIT_PX` (6px) before the window elapses commits aim immediately, so
ordinary single-finger aiming never feels delayed. The pinch gesture itself works regardless of
whose turn it is (looking around the table is not gated on `_canShootNow()`), zooms `[1, 2.5]×`
around the pinch midpoint, and pans by the midpoint's screen delta converted to world units at the
current zoom (1:1 with the fingers). Panning is clamped so the table can't be pushed fully
off-screen. The gesture ends the moment either finger lifts — a fresh single-finger touch is
required to start aiming afterward, never a fallthrough from a pinch into aim/pull. Camera resets
to `{zoom: 1, pan: {0,0}}` at the start of every new game (solo start, practice re-rack, and MP
round record) so nobody starts a fresh rack still zoomed in on the last one. `_toCanvas`/`_toWorld`
fold zoom/pan in centrally, so drawing, aiming and cue placement never special-case the camera.

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

**Seeded and off-main-thread (added 2026-07-28, BUILD-SPEC.md §6 #8).** `chooseShot` now takes an
injected `rng` (`js/rng.js`'s `mulberry32`, defaulting to `Math.random` for callers that don't
care) instead of calling `Math.random()` itself, so a game's AI decisions are reproducible given a
seed. `ui.js` owns one seeded generator per AI game (`_ensureAiRng`/`_aiSeed`, persisted in the
solo autosave so a resumed game keeps the same seed), and draws one sub-seed per AI turn
(`_nextAiSubSeed`) — that sub-seed, not the live generator object, is what crosses to
`js/worker.js`, since a Worker can't receive a closure. The search itself (up to ~90 full
`simulateToRest` lookaheads per decision) now runs in a module worker
(`new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`, same pattern as
`connect-four/js/worker.js`) so it no longer stalls the table for the length of an AI turn;
`_chooseShotOffThread` falls back to an inline (main-thread) call on any worker failure, same
fallback discipline as Connect Four's `requestAIMove`.

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
  is repurposed as "the seat that breaks."
- **In-room rematch series (added 2026-07-28, BUILD-SPEC.md §6 #7).** One room now hosts a whole
  series, same vocabulary as Tic Tac Toe/Mancala/Filler/Dots and Boxes: `round.n` is the game
  number (`mp.gameNum`), `round.dealer` alternates every game via host-only `mp.nextDealer`
  (`_mpStartNextGameSeries`), and `mp.series.wins[seat]` is a seat-indexed tally (never
  device-relative), bumped idempotently per game number by `_mpAfterGameEnd`/`mp.lastScoredGame`.
  `net.js`'s `writeResult` is now deliberately NEVER called (it used to fire on every game-over) —
  it sets `status:'ended'`, which would have killed the room a rematch needs to keep living in;
  `status:'ended'` means exactly one thing in this room now, same as every other MP-capable game
  here: somebody abandoned it (`_confirmQuit`/the end-dialog's "New game"). The end-of-game dialog
  shows the running series (`_seriesLine`) and, for the host, a "Play again" button that starts the
  next game in place; the guest sees a waiting message. Series bookkeeping (gameNum/nextDealer/
  series/lastScoredGame) rides along in every MP autosave (`gamehub.poolv2.mp.v1`) and every
  recovery snapshot (`_mpSnapshot`/`_mpApplyRecovery`), so neither a rejoin nor a resync loses the
  tally mid-series — the same failure class Mancala's M6/Dots and Boxes' DB6 regression tests
  guard against. Poolv2's rules.js never produces a draw, so unlike those games there is no draws
  counter. Regression-tested by `test-mp-lockstep.mjs`'s P3 block (below).
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
  desync from each other. **(Corrected 2026-07-28, BUILD-SPEC.md §6 #1.)** This paragraph
  described the intended design from the start, but the code did not match it until this date:
  `_mpLocalShoot` sent `{g, dir, power, offset, elevation}` with no `place`, while
  `_commitCuePlacement` mutated only the local cue position, so after every foul the peer
  re-simulated the same strike from the wrong cue-ball position — a hash mismatch (and a
  host-authoritative recovery snapshot) on effectively every foul. Fixed by queuing the
  placement on `mp.pendingPlacement` in `_commitCuePlacement`, attaching it as `move.place` in
  `_mpLocalShoot`, and applying it via `rules.placeCueBall` in `_mpApplyNextEntry` **before**
  re-running the strike.
- **MP results record under a `'mp'` difficulty bucket**, matching every other MP game in this
  repo, via the generic `recordResult('poolv2', 'mp', won)` (Poolv2 has no per-game sub-counter, so
  no `players-agg.js` branch was needed — see "Adding a game" item 7's three-edit rule, which only
  applies to a game that stores something richer than played/won/lost). `recordHeadToHead('poolv2',
  opp, won)` runs alongside, guarded so it can never block the ordinary result.
- **Status: proven by a headless lockstep test suite as of 2026-07-28** —
  `test-mp-lockstep.mjs`'s P1 (a scripted rally against a `FakeRoom`, hash-verified every applied
  move, with a `[KNOWN-BUG PROBE]` asserting every ball-in-hand placement sent is also applied on
  the peer — the regression guard for the #1 fix above), P2 (forced hash mismatch → detection →
  host-authoritative recovery → re-convergence), and P3 (the rematch series: a game-1 win tallies
  on both sides, starting game 2 does NOT end the room, the dealer alternates, and a recovery
  snapshot carries the series tally/round number through a mid-series resync), mirroring
  `poolv2/js/ui.js`'s real MP glue method-for-method the same way the six reference games' blocks
  do. **Still not played on two real devices** — that remains open (BUILD-SPEC.md §6 #5), flagged
  honestly rather than claimed as verified.

## Settings and keys

- `gamehub.poolv2.v1` — settings (currently just `difficulty`).
- `gamehub.poolv2.save.v1` — solo/practice autosave (the whole `rules.js` state, cleared on game
  end or an explicit Quit).
- `gamehub.poolv2.mp.v1` — MP rejoin snapshot (role, room code, applied seq, state), separate key
  per the repo's established three-key convention (settings / solo save / MP save never share a
  key).
- Recorder: `recordResult('poolv2', difficulty, won)`; MP additionally calls
  `recordHeadToHead('poolv2', opp, won)`.

## Known limitations (stated honestly, not hidden)

- Camera is top-down plus a cosmetic tilt toggle, now with pinch-zoom/pan (2026-07-28); still no
  real 3D perspective — the physics coordinate system itself never rotates or moves.
- No shot clock, no jump shots (elevation currently only drives curve/masse, not an actual
  vertical launch), no called-shot/safety-specific fouls beyond the generic rulebook above. These
  are deliberate (BUILD-SPEC.md §6 #12): if wanted, they belong in a second named rulebook, not
  edits to Bar Rules 8-Ball.
- Corner pockets use the same plain capture circle as side pockets — no jaw geometry (a real
  corner pocket has a narrower, diagonally-cut mouth). A small, known fidelity gap, not modeled.
- **Multiplayer has still never been played on two real devices** (BUILD-SPEC.md §6 #5) — the
  headless lockstep suite (P1-P3 below) proves the protocol is self-consistent, not that it holds
  up over a real network between two phones. Keep this stated honestly until it's actually true.

### Fixed 2026-07-28 (BUILD-SPEC.md §6 items, in that doc's own ranking)

- **#1 MP ball-in-hand placement now travels with the move that follows it** — see
  "Multiplayer" above; this was the "fix before anyone plays online" item.
- **#2 headless MP lockstep test added** — `test-mp-lockstep.mjs`'s P1/P2 blocks; see
  "Multiplayer" above.
- **#3 practice-mode scratch no longer strands the cue ball.** `_settleLocal`'s practice branch
  never ran `rules.resolveShot`, so the scratch scrub that un-pockets the cue ball never ran
  either — the cue stayed `pocketed: true` until a full re-rack. Now a practice scratch drops
  straight into ball-in-hand placement instead.
- **#4 the elevation slider is capped at 28°**, matching `strikeCueBall`'s real clamp
  (`0.5` rad ≈ 28.6°) — the slider used to run to 45° with the top third doing nothing.
- **#6 the no-rail foul now requires a rail strictly AFTER the cue ball's first contact**, not
  merely a rail contact anywhere in the shot. `physics.js`'s `tick()`/`simulateToRest()` now also
  return an ordered `log` (hits/rails/pockets in resolution order); `rules.js`'s
  `railAfterFirstCueContact()` walks it to find any rail after the first cue hit. Before this, a
  cue ball that clipped a rail before touching anything, then touched a ball and nothing else,
  was incorrectly scored legal.
- **#9 the foul warning icon clears once `_foulMsg` is null** (it used to persist into later
  shots once shown), and tapping it now opens a non-blocking toast (`_showFoulToast`) instead of a
  native `alert()` — a native `alert()` blocks the whole page's input pipeline until dismissed, a
  real correctness bug, not just a UX wart.
- **#11 the unused `CORNER_JAW` constant was removed** rather than left declared-but-unread (see
  the fidelity gap above — it is not modeled, on purpose, until someone implements it for real).
- **#13 live language re-render**: the setup and game views now re-render on `onLangChange`
  (`_startLoop()` cancels any prior RAF loop first, so a re-render mid-game can't leak a second
  animation loop against a detached canvas).

### Ported from Pool v1's first-playtest fixes (2026-07-28, CiC UI/UX review)

Pool v1 (`pool/`) got a real-device/CiC playtest review the same day, independently of this game's
own gap-closing pass above, and found it "close to unplayable" (Matt's words). Poolv2 was built
before that review and shares the same original code, so it had the identical bugs; these fixes
were ported over (with `.p2-`/`poolv2` naming) rather than re-discovered from scratch:

- **The table rendered as a squeezed strip and the rack as an unscaled blob — a CSS layout bug.**
  `.hub-game` (`css/hub.css`) sets no explicit `height` on the container a module mounts into, so
  `.p2-root`'s old `height:100%` had nothing definite to resolve against, which collapsed the
  whole `.p2-table-wrap`/canvas chain toward the canvas element's bare 300×150 default. Fixed with
  `min-height:100dvh` on `.p2-root` (Escoba's precedent for the same shared-shell gap) plus
  `flex:1` (not a percentage height) down the chain, a `<20px` zero-size guard + `requestAnimationFrame`
  retry in `_resizeCanvas()`, and a `ResizeObserver` (not just `window.resize`) so a flex settle or
  orientation change is caught too.
- **The gesture rewrite** — see "Controls" above; this was the more severe of the two bugs, since
  it meant shots simply never fired on a real touchscreen.
- **A ball could settle into an imperceptible but perpetual creep and never actually stop.**
  `physics.js`'s sliding/rolling friction applied a FIXED per-step decrement regardless of how
  small the residual slip already was — correct in magnitude (kinetic friction is genuinely
  constant while sliding) but wrong as an *integrator*: a fixed-magnitude step can overshoot past
  zero slip at low speed, flip sign, and get "corrected" by an equally oversized decrement next
  step, a stable limit cycle that never reaches true zero. `isMoving()` would then never return
  `false`, so a shot could just sit there with no visible symptom. Fixed by deriving the exact,
  finite slide-to-roll crossing time analytically (`|u|` shrinks at the constant rate
  `(7/2)·mu_slide·g`) and clamping both branches to that crossing point instead of a naive fixed
  step.
- Smaller ports from the same review: the spin picker's `setPointerCapture` reordered after the
  visual update and wrapped in `try/catch` (a capture failure could otherwise suppress the tap
  entirely); the quit confirmation now renders real on-screen text
  (`p2-quit-confirm`/`quit_confirm`) instead of a `title=` tooltip, which never shows on a touch
  device; transient aim/power/camera state resets at the top of every `_renderGame()` so nothing
  stale bleeds into a fresh game; balls and pockets gained radial-gradient shading so they read as
  spheres/depth rather than flat discs.

### Fixed 2026-07-28, second pass (BUILD-SPEC.md §6 items, remaining ranked gaps)

- **#7 in-room rematch series** — see "Multiplayer" above; regression-tested by
  `test-mp-lockstep.mjs`'s P3 block.
- **#8 the AI's RNG is now seeded and its search runs off the main thread** — see "AI opponent"
  above.
- **#10 pinch-zoom and pan** — see "Controls" above.

Still open, ranked per BUILD-SPEC.md §6: **#5 (two-real-device MP play — the one item here that
genuinely cannot be verified without two physical phones; see "Known limitations")** and #12
(deliberately deferred rules features — a second named rulebook, not edits to Bar Rules 8-Ball).
