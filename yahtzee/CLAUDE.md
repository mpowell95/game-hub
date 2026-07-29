# Yahtzee (`yahtzee/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

A pixel-exact reproduction of a mobile Yahtzee UI, built from a standalone spec
(`BUILD_INSTRUCTIONS.md` / `YAHTZEE_CLONE_SPEC.md` at the repo root, plus the reference images
`yahtzee.png` / `yahtzee_ref_409x729.png`) across three phases: a diffed static reference frame,
full game logic, then the full animation spec. Originally built and verified as a fully
self-contained `yahtzee-clone/index.html`, then wired into the hub as a proper module
(2026-07-28, Matt: "Wire it into the hub launcher now. ALWAYS" — see the root memory file this
session wrote, `always-wire-new-games-into-hub`, for the standing instruction that produced this).

Hub integration: in-hub `module:` (`yahtzee/js/ui.js`), **immersive** — the game draws its own
full-bleed header/scorecard/dice chrome exactly like Escoba/Mancala/Ball Run, so the hub's own
header row is wasted space while it's mounted. `isInProgress()` uses the **"no mid-game resume"**
literal meaning (same class as Ball Run/Snake, not the autosave/resume convention every other
module game follows): `true` once any roll has happened or any category has been filled, `false`
once the game reaches `gameOver` or hasn't started. **There is no save/resume key** — leaving
mid-game is a real abandonment, matching Ball Run's reasoning that a live-action/in-progress round
can't meaningfully pause across a hub navigation. If autosave/resume is ever added here, add a
`gamehub.yahtzee.save.v1` key and update this line — don't leave the next session to guess (per the
root CLAUDE.md's explicit instruction for this decision).

## Full-bleed sizing (position:fixed, not flowed)

`.yz-root` is `position:fixed; inset:0; height:100dvh`, exactly the pattern `ball-run/css/
ball-run.css` documents: the hub's own `.hub-main` is a padded, `max-width:720px` box, so a game
that needs true edge-to-edge full-bleed (this one's fixed 410×730 stage, centered and scaled to
fit) has to escape it via `position:fixed` rather than trying to fill a flowed container. This is
also why the game measures `window.innerWidth`/`innerHeight` for its own fit-scale (`fitStage()`
in `js/ui.js`) rather than the mounted container's box — the root already **is** the viewport.

## CSS scoping

Every rule is descendant-scoped under `.yz-root` with every class and custom property `yz-`
prefixed (`css/yahtzee.css`), following the "Adding a game" checklist's CSS-scoping axis
(Mancala's discipline, not Connect Four's prefix-only shortcut). One deliberate exception: the
internal data tag `'house'` (used in `RIGHT_ICON_KIND`/`rightIcon()`'s `kind` switch, unrelated to
CSS) happens to share a word with the CSS class for that icon's shape — the class is `.yz-house`,
the data tag stays the bare string `'house'`; they were kept from colliding by hand during the
rename, not by any structural guard, so don't assume every occurrence of the word "house" in this
file's JS is a class name.

## Module lifecycle (`js/ui.js`)

Ids inside the mounted markup (`#stage`, `#pod1`, `#scorecard`, `#rollBtn`, …) are **not**
`yz`-prefixed, unlike classes — confirmed collision-free against the rest of the hub shell (no
`js/*.js` or root `*.html` file uses any of them), and safe because of the same single-instance
invariant every module game relies on: `init()` always tears down any prior instance first, and
`destroy()` clears the container's `innerHTML`, so the ids never coexist with a second copy of
themselves.

`destroy()` is leak-free by construction, not by convention alone — verified with a dedicated
Playwright test that destroys the game mid-AI-turn (async chain + pending `setTimeout`s +
in-flight WAAPI animations all live) and confirms zero errors fire afterward:
- Every `setTimeout` used for game pacing goes through a tracked `scheduleTimeout()` helper;
  `destroy()` clears every pending id. Any in-flight `await wait(ms)` inside `aiTakeTurn`/`doRoll`
  simply never resolves once its underlying timer is cleared, which quietly halts that async
  chain without needing an explicit `destroyed` check at every `await` (a few are still there as
  belt-and-suspenders, since WAAPI-driven resumption points aren't timer-gated).
- Every `requestAnimationFrame` loop (the header count-up ticker, the confetti physics loop) goes
  through a tracked `scheduleFrame()` helper for the same reason.
- The one `window`-level listener (`resize` → `fitStage`) is stored and explicitly removed in
  `destroy()` — everything else is scoped to elements the container removal already discards.
- `window.__yzTest` (the dev/test seam, see below) is deleted on `destroy()` so a torn-down
  instance can't be driven by a stale reference.

## Dev/test seam — `window.__yzTest`

Not part of the visible game; no UI references it. Sets `init()`-time so it always matches the
live instance. Lets Playwright drive deterministic rounds (`forceDice([...])` bypasses real
randomness/animation) to assert scoring math and full-game flow headlessly, and exposes `render`
so a test can force a synchronous re-render after mutating `getState()` directly. The verification
scripts that exercise it aren't checked into this repo (built ad hoc during the build phases); the
seam itself is small and harmless enough to leave in permanently rather than strip for shipping,
same spirit as any other in-repo dev-only hook.

## Game engine notes

- **Shared two-player scorecard, not a preview column**: the cream box always holds the viewer's
  (`state.players[0]`) committed score; the bare numeral to its right always holds
  `state.players[1]`'s committed score for the same category — verified in the original build
  phases (P1 box sum and P2 numeral sum must equal the header totals) and preserved through the
  hub-module rewrite (`renderScorecard()`'s `cell()` never swaps which slot either player's data
  renders into, regardless of whose turn it is).
- **Joker rule**: `availableCategories()` forces the matching upper box as the ONLY legal category
  when the current roll is a Yahtzee and the yahtzee box already holds 50 (a bonus situation) and
  that upper box is still open; once it's filled, joker opens the remaining lower categories at
  full value. `previewScore()` mirrors the same branching so the ghost preview a player sees always
  matches what committing would actually score.
- **AI** (`aiChooseHolds`/`pickCategoryForAI`) is a simple greedy heuristic: hold the largest
  matching group, or a 4-run toward a straight if one exists; after up to 3 rolls, pick the
  highest-scoring open category, breaking ties toward the lower section. `MODE` is a single
  top-of-file constant (`'ai'` | `'hotseat'`), same pattern as the spec called for — no UI toggle
  exists for it yet.

## Settings / persistence

None yet. `MODE` is a hardcoded constant, not a saved preference; there is no settings screen. If
one is added, use `gamehub.yahtzee.v1` per the standard convention (root CLAUDE.md item 4).

## Multiplayer

**Not yet implemented.** Requested (Matt, 2026-07-28: "Yahtzee must be MP compatible as well")
after the hub-wiring pass above shipped. This needs its own setup/lobby screen (this game
currently has none at all — it drops straight into a solo-vs-AI game on mount) plus a lockstep
design against `js/net.js`. The natural shape, closest to Pool's precedent (`js/CLAUDE.md`'s
"seventh consumer" section): a roll's dice VALUES are random, so — like a Pool shot's physics
parameters — the roller generates them locally and transmits the result as the move; the peer
applies the identical values and verifies a state hash, rather than trying to synchronize the RNG
itself. Category selection and hold-toggles are small, already-discrete moves that fit the
standard lockstep vocabulary directly. Not started as of this note; see `js/CLAUDE.md`'s
multiplayer-lockstep section before building it; add a `### The Nth consumer: Yahtzee` entry there
once it ships, per the documentation convention every prior MP game followed.

## Tests

No automated test files are checked into this repo for this game yet (the build-phase headless
Playwright scripts — scoring coverage, a full 13-round game, animation timing, `prefers-reduced-
motion`, module lifecycle/leak checks — were run ad hoc from a scratch directory during
development, not committed). If this game gains real regression coverage, follow the pattern of
`test-mp-lockstep.mjs`/`test-stats-identity.mjs` etc. — a checked-in, `run-all-tests.mjs`-wired
suite — rather than leaving verification to a session's own scratch scripts again.
