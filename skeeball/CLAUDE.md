# Skeeball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below
> overrides them. This game's specific obligations are under "Persistence and THE LAW" — read
> that before touching anything that stores or records.

A realistic arcade skeeball alley, rebuilt **from scratch on 2026-08-13** (nothing of the
previous build — layout, art, physics, structure — was carried over or consulted). The previous
build was then kept in the hub as **Skeeball_old** (`skeeball_old/`, hub id `skeeball-old`;
Matt's ask, same day) for side-by-side comparison while this machine is tuned — see that
folder's CLAUDE.md for exactly what its rename changed. Both builds record into the SHARED
`skeeball` stats id, and both use the board id `classic`, so that machine's records (bests, the
daily map, the top-score panel) are one continuous bucket across the two builds — deliberate,
so no play is ever orphaned. One machine exists so far, **THE CLASSIC**: a boardwalk cabinet with a varnished oak
lane, the burnt-orange board with the white cup ladder, twin corner 100 cups, and a marquee. The
player swipes up the lane; the swipe's speed is the roll's power and its angle is the aim. Nine
balls to a rack.

**The board was rebuilt to the REAL classic layout on 2026-08-13** against reference photos Matt
provided, after the first version shipped a wrong "bullseye" board invented from memory — the
exact failure `VISUAL-PROCESS.md` exists to prevent (look at the picture before you write code;
if there is no picture, ask for one). That rule was read and skipped anyway; do not repeat this.
The photos and researched behavior now live in this file and in `boards.js`'s `scoring` comment.

**Admin only for now**, exactly like Pinball: the hub entry carries `devOnly: true`. Unlike
Pinball, the stats id already has REAL family history (the game was live for a couple of hours
on 2026-08-11 under the previous build), which drives every storage decision below.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../skeeball/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `skeeball` |
| Stats id | `skeeball` (recorder `recordSkeeball`, sub-counter `sk`) — **pre-existing, frozen** |
| CSS root / prefix | `.sk-root` / `.sk-` |
| Settings key | `gamehub.skeeball.v1` (one preference: the selected machine) |
| Save key | `gamehub.skeeball.save.v1` (the mid-rack snapshot) |
| Difficulty axis | none — `byDiff` is keyed by BOARD ID (Hill Climb's stages-as-the-axis precedent) |
| `isInProgress()` | the **autosave/resume** meaning: always `false`; see below |

`isInProgress()` returns `false` even mid-rack (Escoba's class of the contract, not Ball Run's):
the between-throws state is the stable state of skeeball, `ui.js` snapshots it to
`gamehub.skeeball.save.v1` after **every settled ball**. While a snapshot is banked the setup
screen offers BOTH actions: "Resume rack · N/9" (primary) AND "New game" (ghost) — never only
one. New game discards the snapshot (`clearSave()` before `_startGame(null)`): the snapshot is a
resume convenience, not earned history, and the player pressed the button that says so with
Resume sitting directly above it (Matt, 2026-08-13: a save must never trap the player into
resuming). A ball actually in flight resolves in under two seconds and is deliberately not part
of the saved state — the throw a player abandons mid-air was theirs to abandon, and the ball is
only spent when it settles, so resuming re-serves it.

`immersive: true`: `.sk-root` is `position: fixed; inset: 0` at `z-index: 1` (Pinball's shape),
so the hub's floating back button rides on top; `.sk-hud` carries `padding-left: 76px` and the
gallery `padding-top: 84px` to clear it.

## Files

| File | Role |
|---|---|
| `js/boards.js` | the machine registry: identity, look tokens, physics tune, scoring geometry, unlock chain. Pure |
| `js/physics.js` | the deterministic ball simulation: lane roll, the hump, flight, face capture, sink. Pure, no rng at all |
| `js/game.js` | the rules of a rack: nine balls, scoring, the event stream, snapshot/restore, the recorder payload. Pure |
| `js/render.js` | the canvas: one perspective camera, cached static machine art, live ball/flash/popup layer |
| `js/howto.js` | the How To Play sheet content (repo pattern, `tic-tac-toe/CLAUDE.md`) |
| `js/strings.js` | the EN/ES dictionary |
| `js/ui.js` | DOM shell, the swipe, storage, records panel, the hub module contract |
| `js/test.js` | headless engine tests incl. the reachability sweep and the soak (wired into `run-all-tests.mjs`) |

The first three are DOM-free and that is load-bearing: `node skeeball/js/test.js` plays hundreds
of throws without constructing an element, and the same determinism is why the tuning is testable
at all.

## The setup screen and How To Play (rebuilt 2026-08-13 to the repo patterns)

The first versions of both were designed from scratch and Matt threw them out ("start the design
over" / "throw out 100% of it"). The rebuilds follow the documented references EXACTLY; a future
redesign starts from those documents, not from taste:

- **Setup** follows Escoba's page order (`escoba/js/ui.js`, the repo's setup reference): title →
  Resume button if a save exists → one stats line (Best · Today · Top · Last) → the settings card
  as a collapsed `.gh-acc` accordion row ("Machine / THE CLASSIC"; open it to pick a machine,
  each unlocked machine a card with its four records) → the How-to-play text link → ONE primary
  action (Play, or New game as a ghost when Resume is the primary). Built on `css/ui.css`'s
  `.gh-*` primitives (`ui.js` injects `css/ui.css` idempotently before its own sheet, the same
  marker `bug-report-ui.js` uses) — the accordion is `.gh-acc`, the buttons are `.gh-btn`; only
  the skeeball-specific bits (`.sk-statline`, `.sk-mrow`, `.sk-howto-link`) are local CSS.
- **How To Play** follows `tic-tac-toe/CLAUDE.md`'s five-part pattern, restated in `howto.js`'s
  header: one bold goal line, ONE diagram of the one non-obvious mechanic (swipe strength =
  landing height, drawn as a side view with three numbered arcs), a caption, an X = Y example
  ("Half strength = the 50 cup"), then the edge cases one sentence each. Every text line is
  measured and shrunk to fit ONE row before nowrap locks it (`_fitHelpLines` in `ui.js`); the
  arcs are told apart by dash pattern AND numbered markers, never colour alone.

## The machine and its physics

**Rebuilt again on 2026-08-13, same day, to the reference-footage contract.** Matt supplied six
stock clips of real machines (`reference/Skeeball/*.mp4`); studied frame by frame they showed the
board rebuild's remaining lie: the score was decided at the ball's first touch and a canned slide
played it out. On a real machine, touching the board is where the drama STARTS. The approved gap
list (rims are real, outcomes emerge, misses roll downhill, two flight regimes, the ring is
geometry, rattle takes seconds) is implemented in `physics.js`'s board phase:

- **Lane / hump / rollback / flight** as before: swipe rolls the ball up the shortened lane, the
  hump launches it (~52 degrees), a ball too weak for the climb comes back unspent, a total flub
  dies in the gutter void for the honest zero.
- **The board is a live simulation in face coordinates** (u lateral, v up-slope, w height off
  the plane). Gravity pulls down-slope and into the plane, always. The cups' collars and the big
  ring's band are REAL WALLS (bounce, graze, slide); the board bounces until the hops stop
  mattering, then the ball rolls - decelerating uphill, accelerating back down, steering around
  the furniture. Nothing caps the bounce count. **The outcome is wherever the ball physically
  drains**: a cup mouth it genuinely arrives over, the 20 hole inside the ring, the 10 hole on
  the outer field, a corner gutter for a low wide fluke.
- **Two flight regimes fall out of one launch angle**: soft balls land low and roll up (the
  footage's skim); hard balls arc onto the upper board from the air. Max power straight
  overshoots the 50 and rattles down for scraps - asserted, so power is never a strategy.
- **Feel rules encoded from the clips**: a climbing ball HOPS the ring's band (entry over the
  front lip); a descending rattler is caught by the dished basin and circulates inside; a slow
  ball teetering on a cup rim tips in; a fast one rims out with a pop.
- **Termination is engineered**: energy only decays; a stalled ball (displacement-anchored
  detection - speed thresholds are jitter-blind, pinball's watchdog lesson) picks up a gentle
  funnel toward its drain and visibly rolls there. A 10s emergency cap exists and the tests
  assert it never fires.
- **Wedge lesson, twice**: where a cup stands on or beside the band, the CUP owns the contact -
  two nearly-touching convex walls otherwise pin a slow ball forever (pinball/CLAUDE.md's
  parking-space failure, met at the 50/band junction and the 100L/band gap).

**Slope, not wall (same day, Matt's eye test):** the first emergent build kept the real
machine's steep face and read as "a vertical wall... the ball only falls." The fix is three
coordinated pieces, and they only work together: `faceTilt: 0.6` rad (~34 degrees — a BOWL; the
comment in `boards.js` marks it), a camera raised and pulled back to look DOWN into it
(`render.js`: `eyeY -0.9`, `eyeZ 0.95`, `F = w*2.2`), and the cups drawn as real 3D cylinders
(collar wall + rim annulus + dark mouth) so depth is visible. Retilting without moving the
camera just makes the board look shorter; moving the camera without the 3D collars makes the
cups read as flat stickers again.

Still deterministic: no rng anywhere; rim deflections are purely geometric. Retune in
`boards.js` freely, but run `node skeeball/js/test.js` first: the sweep pins reachability of
every hole (100s never straight), the void, the rollback, the overshoot price, the >1.5s rattle,
real bounce events, and that nothing ever rides the settle cap. The rules test plays throws the
sweep itself found, so it can never drift from the engine's real behavior.

The renderer projects everything through one pinhole camera (`P()` in `render.js`); the
board-phase shadow reads the hop height (`st.fw`), which is what makes a bounce readable. Static
machine art is cached per size (`paintStatic`); art that changes during play does NOT belong
there. Reduced motion drops particles and the flight trail, never the ball.

## The records panel (the four numbers every machine shows)

Per Matt's spec, each machine displays: the **top score by ANY player**, the current player's
**all-time best**, their **best today**, and **the score they just rolled**. Where each one lives:

- **Top score (anyone)**: derived at read time — `readPlayersOnce()` → `aggregatePlayers()` →
  `appWideBest(rows, 'skeeball', 'sk', boardId)` (`js/arcade-scores.js`; there is deliberately no
  shared `highscores/` node — see that file's header). Local history is merged over it so an
  unsynced device still shows its own truth. Async; the panel renders local-first and fills in.
- **Your best / today**: `bestOn` / `todayBestOn` over the player's own `sk.boards[boardId]`
  (the daily best is a date-keyed map that never resets — arcade-scores' header explains why).
- **Just rolled**: the rack-over sheet, plus a session-only "Last game" slot on the machine card
  (deliberately not persisted: the durable copies already live in the daily map and bests).

"NEW BEST" pills on the rack-over sheet compare against what stood BEFORE the rack was recorded.

## Persistence and THE LAW

**The stats id `skeeball` and sub-counter `sk` predate this rewrite and carry real plays.**
Everything this build writes goes through the SAME shared plumbing the old one used, so that
history keeps accumulating rather than being orphaned:

- `recordSkeeball(boardId, { score, balls, hundreds, fifties, bestThrow, at })` in
  `js/game-stats.js` — called exactly once per finished rack (`recorded` guard; every write in
  the store is additive, so a double call would silently inflate). `byDiff` buckets by board id;
  the first machine's id is **`classic`**, which is also `recordSkeeball`'s own fallback id —
  frozen forever (rule 5). Rename a machine's display name freely; never its id.
- Per-machine records and unlocks ride `sk.boards` / `sk.unlocked` via `js/arcade-scores.js`
  (counters add, bests `Math.max`, each DAY takes the max, unlocks union across devices).
- The frozen vs-computer fields (`sk.won`/`lost`/`tied`, from the pre-2026-08-11 build) are
  untouched: never incremented, never cleared, still shown by My Stats when non-zero.
- This game's own keys hold nothing earned: `gamehub.skeeball.v1` is one preference and
  `gamehub.skeeball.save.v1` is a mid-rack snapshot that is cleared only AFTER the rack it
  describes has been recorded to the shared store. Nothing in this folder's storage can lose
  anything, because nothing earned lives in it (Pinball's model).
- Item 7's three edits (`ensureSk`/`recordSkeeball`, the My Stats screen, the `players-agg.js`
  branch) all predate this rewrite and were left as they are; `players-agg.test.mjs` carries the
  regression case.

The leaderboard row is deliberately absent while the game is admin-only (`GAME_META` in
`js/leaderboard-ui.js` says so in place; `players-agg.test.mjs`'s `OFF_THE_BOARD` checks the
claim). The My Stats tab is deliberately PRESENT and not devOnly — family members may have real
plays from the hours the old build was live, and hiding the tab would make their own history
invisible (rule 1; the comment on the `TABS` row records this).

## Adding the next machine

1. Add an entry to `BOARDS` in `js/boards.js`: new frozen `id`, marquee `name` (a proper noun,
   untranslated), `taglineKey` (+ its `{en,es}` strings), `look`, `physics`, `scoring`, and
   `unlock: { board: '<previous id>', score: N }`.
2. Run `node skeeball/js/test.js` — the sweep and soak run against every board in the list, and
   the unlock chain tests are already written (they currently exercise a synthetic future list).
3. `ui.js` needs nothing: the gallery, unlock checks (`unlocksEarned` → `unlockSkeeballBoard`),
   records panel and renderer are all board-generic. The unlock write is additive and merged as
   a union across devices, so a machine earned anywhere is earned everywhere.
4. Nothing in `sw.js` changes (no per-board assets). Update THIS file's header, which currently
   says one machine exists.

## Testing

- `node skeeball/js/test.js` — 42 assertions: determinism, the reachability sweep (every hole,
  gutter, rollback), the power-curve shape, left/right symmetry, a 600-throw soak (settles, in
  bounds, legal values only), the nine-ball rules through the real API, the recorder payload
  shape, snapshot/restore, and the unlock chain.
- `node test-game-conventions.mjs` — the shared checklist (viewport, touch, overlays, name gate,
  module contract, listener balance, dictionary, the layout-class collision rule).
- `node test-visual.mjs skeeball` — the only suite that LOOKS at it. Its PLAY probe swipes the
  real lane with real touch through full racks and asserts the score moved and the rack recorded.
  There is no separate MOTION probe for the same reason as Pinball: everything that moves is
  drawn into one canvas, so the canvas-sampling check lives inside the PLAY probe.

## Things a future session will want to know

- **No sound, no audio layer** — the arcade-cabinet precedent (Matt on Pinball, 2026-08-11:
  "Delete the sound option. No sound."). Nothing here constructs an AudioContext.
- **`skeeball.css` is two skins and the split is deliberate** (2026-08-13, the setup overhaul):
  the SETUP and HOW-TO screens belong to the hub — light `--sks-*` tokens on `.sk-root` with a
  `:root.gh-dark .sk-root` override, skeeball_old's lines 9-35 pattern — while the PLAY screen
  keeps the warm dark arcade look in both themes (Ball Run/Hill Climb/Pinball's class). The
  header comment in the CSS marks where one skin ends and the other begins. Do not "unify" them.
- The swipe measures the RELEASE flick (the last ~130ms), not the whole gesture — the wind-up is
  grip, not power. Power normalises against the stage height so a phone and a desktop feel alike.
- `physics.js` has no randomness at all. If a future machine wants scatter, thread a seeded rng
  through `startThrow` and keep `simulateThrow` deterministic — the test suite depends on it.
- Machine names (`THE CLASSIC`) are proper nouns and stay untranslated, like STARHUB.
