# TODO

Running list. Newest asks at the top of each section. Delete a line when it ships.

## Asked for

- **Turn-based multiplayer.** Matt, 2026-08-29: "finally create the turn based multiplayer mode."
  Scope decided by Matt the same day: **async / play-by-mail, on the direct 2-player games** -
  Connect Four, Battleship, Mancala and the like. Explicitly **NOT** the card games (Uno,
  Chinchon, Escoba, Monopoly Deal) and **not** the N-seat path-B roadmap in
  `HANDOFF-MP-ROADMAP.md`, which stays parked.
  - Also wanted: **Skeeball as a challenge.** One round vs one round, or three vs three. This is
    a different shape from the board games - it is solo play whose RESULT is compared, so it
    needs no move-by-move protocol, only a posted score and a deadline. Likely the cheapest of
    the set to ship, and a good first slice.
  - The real work: `js/net.js` today is a LIVE room. It pings presence every ~10s so peers can
    detect a peer going away, and nothing persists a game for a player who is not there. Async
    needs the game state to survive both players being gone, plus an "it's your turn" surface on
    the launcher (there is no push notification story in this app yet).
  - THE LAW applies to any stored game state: a half-finished challenge is player data.

- **New game: Pipes.** Matt, 2026-08-29: water flows in one end, a grid of pipe pieces sits
  misrotated, rotate them to build an unbroken path to the exit. "similar puzzle vibe as nuts and
  bolts."
  - Closest existing model is `nuts-bolts/` (~1,960 lines): a **generator** that builds a
    guaranteed-solvable board, a small pure game core, a UI, and headless tests. Copy that shape.
  - The generator is the whole game: build the solution path FIRST, then scatter rotations, and
    assert solvability in `test.js` rather than trusting it.
  - Standing rules that apply from line one: full hub module-contract wiring by default, the
    `game-ui` skill and `docs/BUILDING-A-GAME.md` before any UI, `onViewportResize`, `makeT` with
    an `{en, es}` dictionary, a stats recorder plus a `GAME_META` row, `js/game-art.js` tile art,
    `css/ui.css` `.gh-*` primitives (a new game is the cheapest place to adopt them), a
    `pipes/CLAUDE.md`, and `node test-game-conventions.mjs` before the commit.
  - **The water ANIMATES along the path on a solve - decided by Matt, 2026-08-29, and it is not a
    nice-to-have.** "Animations are what really impresses people playing the games. the king of
    games is really WOWed by the key animation. Stuff like that is valuable to me." Budget the
    solve animation as a first-class feature, not polish at the end, and let it drive the render
    approach. Look at Nuts & Bolts' key animation as the bar to clear.

- **Skeeball: see where everyone stands on the objectives.** Matt, 2026-08-29: "on the
  leaderboard or on my admin page, I want to be able to see where everyone is in skeeball,
  their progress on the objectives. Just out of curiosity."
  - Partly built already: the admin page's **Player scores** section renders each person's three
    objectives per machine with `now / target` and a met tick (`js/admin-ui.js` `goalsHTML()` ->
    `skeeball/js/goals.js` `readGoals()`).
  - The gap: `playerBlocks()` filters to machines a person has actually PLAYED, so a player who
    has not reached a machine shows nothing for it. You cannot see who is stuck one objective
    short of the next unlock, which is the question being asked.
  - Decide where it lives: extend the admin section, or put a read-only version on the
    leaderboard (public means everyone sees everyone's progress).

- **Skeeball: consider making the objectives easier.** Matt, 2026-08-29: King of Games has
  cleared everything up to RUNAWAY while nobody else has unlocked much, so the unlock chain may
  be gated too hard for the rest of the family. Do the progress view above FIRST - it is the
  data this decision needs. Note the standing rule: Matt's goal numbers get beaten far sooner
  than expected, so the current bars were deliberately set high; the fix may be pacing, not
  lower numbers.

- **Pinball: get it working.** Matt, 2026-08-29: "It'd be nice to get pinball to work too" and
  "our pinball is FAR from being finished... they don't work." Matt's judgement on the 08-22
  pitch/friction commits: "You tried, but it didn't make the game better." Treat the game as
  UNFIXED regardless of what those commit messages claim. Still `devOnly: true`.
  - **Outside engines, checked 2026-08-29. None are adoptable:**
    - VPE / VisualPinball.Engine - genuinely excellent and actively developed (release
      v0.0.1-preview.194, 2026-08-23), but C# on Unity + HDRP, GPL-3.0, desktop targets only,
      and Unity WebGL is unsupported on mobile browsers.
    - Mission Pinball Framework - Python that drives REAL hardware (coils, switches, FAST /
      P-ROC / Stern SPIKE). No ball physics to borrow. Wrong category.
    - Future Pinball - closed source, Windows only, last release 2010-12-31.
    - **vpx-js - DEAD.** Last real commit and last release (v1.3.4) are both 2020-11-12; all 30
      branches since are dependabot. 60 stars, GPLv2, scripting engine left WIP, wants a `.vpx`
      table file.
    - The hobby HTML5 pinball games (pinball-wizard, Astro-Pinball, pinballjs) are all dead
      2011-2018, tiny, and carry **no LICENSE file at all** - legally unusable, and all worse
      than what we have.
  - **The recommendation: replace the SOLVER, not the game.** `pinball/js/physics.js` is 340
    hand-rolled lines of contact resolution, and that is where the badness lives - sticking,
    mushy flippers, tunnelling. The other ~3,600 lines (`table.js`, `game.js`, `render.js`,
    `ui.js`) are hub-specific work no outside project supplies: the module contract, immersive
    layout, DMD, missions, i18n, stats.
    - **planck.js** (MIT, 5.3k stars, last commit 2026-04-07) is a Box2D port and the strongest
      fit: continuous collision detection kills ball tunnelling outright, and a flipper becomes a
      motorised revolute joint with a torque limit - which is what a real flipper IS - instead of
      a hand-swung kinematic bat.
    - matter.js (MIT, 18.4k stars) is the better-known alternative but has been quiet since
      2024-06 and lacks planck's continuous collision.
    - Cost: one vendored ESM file in the REST cache tier. It IS a dependency, which the repo has
      none of by design - Matt's call to make, and worth making for this one game.
  - `claude/pinball-physics-layout-vf9z5q` (08-14) is stale; mine `flipperGap()` out of it, then
    delete it. `pinball-friction-wip` becomes moot if the solver is replaced.

## Already open, carried

- **The emoji does not follow the player everywhere.** Paused by Matt 2026-08-25. Needs a shared
  `chipHTML({name, emoji})` primitive plus a sweep; the immersive games go last. See the shared
  profile section of the root CLAUDE.md.
- **POPONGO is the only Skeeball machine still admin-only.** Everything else is Open or
  Unlockable. Releasing it is one control on the admin page, no commit.
- **Sam / Sam1 player records need merging.** Waiting on Sam being online when he next opens the
  app. `fix-sam-merge.mjs` is untracked in the repo root.
- **Desk clutter.** ~47 MB untracked in the working tree: `skeeball/Machines/` (36 MB) and
  `skeeball/References/` (5.7 MB) are the reference media PR #244 deliberately untracked and
  should be gitignored, not deleted; `.gitignore`'s `.claude/*` is root-anchored so
  `skeeball/.claude/` slips past it; ~30 finished July handoff docs belong in the sibling
  `Game-Hub-Docs/` archive.
- **Two small leaderboard residuals** from the deleted `claude/skeeball-leaderboard-ui-9y2b8r`
  branch (head was `e11818d`, recoverable by SHA if wanted):
  - a best-metric board should default to ranking on that best, not on the device's last-picked
    sort (the branch called it `effSort`);
  - `test-skeeball-machine-spec.mjs` should assert `SK_MACHINES` in `js/game-stats-ui.js` still
    matches `skeeball/js/boards.js`, so a new machine cannot leak a raw i18n key onto the player
    screen. ~20 lines, and two machines have been added since.
- **Ten dead July branches** plus three orphaned git worktrees (`gh-lb-wt`, `gh-main-check`,
  `gh-strip`) that `git worktree prune` cannot remove (permission denied every fetch).

## Maybes - pinball, if the gravity fix is not enough

Checked 2026-08-29. In rough order of how much they change.

- **Replace the SOLVER, keep the game.** `pinball/js/physics.js` is 340 hand-rolled lines of
  contact resolution and that is where sticking, mushy flippers and tunnelling live. The other
  ~3,600 lines (`table.js`, `game.js`, `render.js`, `ui.js`) are hub-specific work nothing
  external supplies. **planck.js** (MIT, 5.3k stars, last commit 2026-04-07) is a Box2D port with
  continuous collision detection and motorised revolute joints - which is what a real flipper IS.
  matter.js (MIT, 18.4k stars) is better known but quiet since 2024-06 and has no continuous
  collision. Cost: one vendored ESM file in the REST cache tier. Offline is unaffected - it is a
  committed file like any other. The real cost is that it breaks the root CLAUDE.md's opening
  line ("no build step, no dependencies, no framework") and leaves us with 150 KB we cannot
  easily debug.

- **GDevelop, the way Car Race was done.** `8e0af58` added `car-race/` as an admin-only launch-out
  game on 2026-08-16; `c93fad2` removed it four days later, and that message says the demo
  "served its purpose (proving the GDevelop -> export -> hub workflow); recoverable from history
  if wanted." GDevelop is open source, has a Box2D physics behavior, and exports a self-contained
  static HTML5 bundle. Trade-offs: it lands as a **launch-out** game, not an in-hub module, so
  stats need `window.__ghStats` glue like Monopoly Deal and Parchis; and because it is authored
  in a visual editor, Matt iterates on the feel directly instead of describing it.

- **Flipper correction curves (nFozzy).** The thing Visual Pinball has that no physics library
  gives you. Two curves - corrected velocity magnitude, and corrected x-velocity - indexed by
  where along the bat the ball struck and normalised to flipper length, plus a millisecond cutoff
  after the flipper fires. VPE ships three profiles measured off real solid-state machines. This
  is why VP flippers feel right: a bare rigid-body flipper is physically correct and still feels
  wrong. Worth doing whatever solver we end up on.

- **Physics rate.** Visual Pinball runs at **1000 Hz** (`PhysicsStepTime = 1000` usec). We run at
  480. Not obviously the problem, but it is the gap most likely to matter for flipper contact.

- **Ball rotation is not simulated at all.** `ball.spin` is advanced from `vx` for the renderer
  and never fed back. Every rolling behaviour - the 5/7, spin off a rubber, English round the
  orbit - is therefore absent or faked. A real solver gives this for free.
