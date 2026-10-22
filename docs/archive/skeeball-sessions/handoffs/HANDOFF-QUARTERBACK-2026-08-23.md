# Quarterback session, 2026-08-23 — what happened and where everything is

A master session untangled the multi-session skeeball chaos. Read this before
assuming anything about branches, worktrees, or the main checkout's state.

## The state of the world after this session

- `main` = `792a374` (PR #187, docs architecture), deployed, CACHE **v441**.
- Skeeball is **admin-only** (`devOnly`) again, per Matt, until he re-releases it.
- **Every machine owns its own engine**: `skeeball/js/machines/<id>/physics.js`,
  `machine.js`, `render.js`. The shared three are DELETED on main (PR #186).
  Never restore them. Shared files that remain shared: `boards.js`, `game.js`,
  `goals.js`, `ui.js` — a change there reaches every machine; sweep all machines
  before committing one (see skeeball/CLAUDE.md's HARD RULE).
- The main checkout sits on `main`, clean. Do not park it on a feature branch.

## Branches that exist on purpose — do not merge, do not delete

- `archive/desk-2026-08-23` (`c287032`, pushed): every tracked edit that sat
  uncommitted in the main checkout while PRs 183–186 shipped from worktrees.
  Includes the ONLY copies of the "Skeebal final?" session's back-wall
  measurement harness (its `skeeball/js/physics.js` + `skeeball/js/test.js`,
  old layout — port into `machines/theclassic/` if that parked investigation
  resumes). Never merge; it holds superseded old-layout skeeball files.
- `pinball-friction-wip` (`6e297b6`, pushed): Matt's own in-progress pinball
  friction restore (mu 0 → 0.02, undoes PR #174). Parked UNREVIEWED at his
  request. Do not merge and do not delete until Matt reviews it.

## What was deleted, deliberately (Matt approved full cleanup)

- `skeeball-dev-sync-guard` (local+remote): the closed PR #182 built on a stale
  base that would have reverted other sessions' work. Its content shipped
  properly as PR #183. The landmine is gone.
- ~50 merged skeeball-scope branches, local and remote, plus the two worktrees
  `.claude/worktrees/skbb8` and `skbbBP` (skbbBP's scratch `_blueprint.mjs`
  copied to the session scratchpad first).

## Left alone on purpose (out of scope, possibly not merged)

- `wip/laptop-paused-2026-08-14`, `uno-visual-rebuild`, the snake d-pad
  branches, `yahtzee-pod-fix*`, misc `claude/*` remote branches, and the
  poolv2 worktree (`Game-Hub-poolv2`, active project).
- Leftover unregistered worktree husk folders under `.claude/worktrees/`
  (skbb2–6, skbball, skbcheck, practical-chaum-*): metadata pruned, folders
  not deleted in case they hold something. Safe to delete after a look inside.

## Open threads

- POPONGO design: Matt has not chosen between A (retune generosity),
  B (play-to-exactly-50 duel), C (park it). Any POPONGO work goes in
  `skeeball/js/machines/popongo/`.
- Back-wall-upward-velocity bug on THE CLASSIC: **RESOLVED 2026-08-23, PR #188
  (v442)** - do not resurrect the archived harness; the full story is in
  skeeball/DECISIONS.md, "The back wall does not lift the ball", and the rule
  is pinned by test.js's wall-only assertion.
- Pinball friction: parked on `pinball-friction-wip` until Matt reviews.
