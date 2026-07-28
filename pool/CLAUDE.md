# Pool (`pool/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys,
> saves, and stats written by this game are governed by it: writes additive, keys never
> repurposed, no silent write failures.

Hub integration: in-hub `module:`, not immersive (keeps the hub header, unlike Escoba/Mancala/
Ball Run). `isInProgress()` is mode-split (root CLAUDE.md's "two legitimate meanings" note):
**solo (vs. computer) and practice both autosave/resume** (`gamehub.pool.save.v1`, silent restore
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

- `gamehub.pool.v1` — settings (currently just `difficulty`).
- `gamehub.pool.save.v1` — solo/practice autosave (the whole `rules.js` state, cleared on game
  end or an explicit Quit).
- `gamehub.pool.mp.v1` — MP rejoin snapshot (role, room code, applied seq, state), separate key
  per the repo's established three-key convention (settings / solo save / MP save never share a
  key).
- Recorder: `recordResult('pool', difficulty, won)`; MP additionally calls
  `recordHeadToHead('pool', opp, won)`.

## Known limitations (stated honestly, not hidden)

- Camera is top-down plus a cosmetic tilt toggle; no real 3D perspective, no working pinch-zoom/
  pan yet (the build guide's controls section asks for both — deferred, not silently dropped).
- No shot clock, no jump shots (elevation currently only drives curve/masse, not an actual
  vertical launch), no called-shot/safety-specific fouls beyond the generic rulebook above.
- No i18n live re-render via `onLangChange` (strings resolve at render time only, same minimum
  bar every other game meets — see root CLAUDE.md item 9).
