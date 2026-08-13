# Skeeball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below
> overrides them. This game's specific obligations are under "Persistence and THE LAW" — read
> that before touching anything that stores or records.

A realistic arcade skeeball alley, rebuilt **from scratch on 2026-08-13** (Matt: the previous
build is thrown away; nothing of it — layout, art, physics, structure — was carried over or
consulted). One machine exists so far, **THE CLASSIC**: a boardwalk cabinet with a varnished oak
lane, a cream ring face, twin corner 100 pockets, and a marquee. The player swipes up the lane;
the swipe's speed is the roll's power and its angle is the aim. Nine balls to a rack.

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
`gamehub.skeeball.save.v1` after **every settled ball**, and the gallery's Play button becomes
"Resume rack · N/9" while a snapshot is banked. A ball actually in flight resolves in under two
seconds and is deliberately not part of the saved state — the throw a player abandons mid-air was
theirs to abandon, and the ball is only spent when it settles, so resuming re-serves it.

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

## The machine and its physics

World coords: x lateral, y down the alley, z up; the lane bed is z = 0. The model, in the order
the ball experiences it (all constants live in `boards.js`'s per-machine `physics`/`scoring`,
nothing is hardcoded in `physics.js`):

- **Lane** — rolls with friction, banks off the side rails.
- **The hump** — climbing costs `g·lipHeight` of speed²/2; a ball that cannot pay **rolls back
  to the player and is not spent** (`'returned'`), exactly like a real alley.
- **Flight** — off the lip at `launchAngle` (~47°), under gravity.
- **The face** — an inclined plane (~65°). Land softly (`|vn| <= captureVn`) and the zone under
  the ball takes it: the twin 100 pockets first, then the concentric rings by distance from the
  ring centre (50 innermost, 10 outermost), then the gutter. Land hot and it bounces once; the
  second contact always settles. Short balls die in the pit for zero; past the net is zero.

**The power curve is the game**, and `test.js`'s reachability sweep pins its shape: rings come up
in order (10 → 30 → 50) as power climbs, an overshoot descends the far side (40 → 30 → 20, never
more), the 100s need near-full power AND committed sideways aim (a straight ball can never score
100 — asserted), and a feeble roll comes back. Retune in `boards.js` freely, but run
`node skeeball/js/test.js` before anything else: it is the only thing that will tell you a tweak
quietly killed the 100 pockets or the rollback.

The renderer projects everything through one pinhole camera (`P()` in `render.js`), so the lane's
convergence, the ellipses the rings become, and the arc of a lob are the same geometry the
physics computed. Static machine art is cached per size (`paintStatic`); if you add art that
changes during play it does NOT belong there. Reduced motion drops particles and the flight
trail, never the ball.

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

- `node skeeball/js/test.js` — 36 assertions: determinism, the reachability sweep (every hole,
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
- The warm dark look is the same in both hub themes on purpose (Ball Run/Hill Climb/Pinball's
  class); there is no `:root.gh-dark` branch in `skeeball.css`.
- The swipe measures the RELEASE flick (the last ~130ms), not the whole gesture — the wind-up is
  grip, not power. Power normalises against the stage height so a phone and a desktop feel alike.
- `physics.js` has no randomness at all. If a future machine wants scatter, thread a seeded rng
  through `startThrow` and keep `simulateThrow` deterministic — the test suite depends on it.
- Machine names (`THE CLASSIC`) are proper nouns and stay untranslated, like STARHUB.
