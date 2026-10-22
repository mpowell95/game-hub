# HANDOFF — Skeeball, 2026-08-21

Current source of truth for Skeeball's open work. **Supersedes the punch-list half of
`HANDOFF-SKEEBALL-2026-08-19.md`**, whose batches A–G are all closed. The deep context in the
08-16 doc (board geometry, scoring, the throw/swipe curve, deleted-on-purpose, the scoreboard) is
still valid and NOT repeated here.

**Live at `game-hub-v405`** (`14bd7c8`). Still `devOnly` — admin-only on the hub; the standalone
URL `https://mpowell95.github.io/game-hub/skeeball/` works for anyone. Deploy on every change.

---

## THE ONE OPEN BUG — not yet investigated

Matt, 2026-08-21, having played v405:

> I throw the ball straight and get a 50. I aim for the 100 and throw it harder. It lands even
> shorter than the one thrown straight.

**Nothing has been measured on this yet.** I was one command into it when the session ended. Two
hypotheses, in the order I'd test them:

1. **Aim splits the launch velocity.** If aim rotates the velocity vector rather than adding to it,
   the forward component is `speed × cos(angle)` — so an angled throw travels less far up the board
   at the same power, and "harder" may not make up the difference. Check how `aimMax` is applied in
   `startThrow` (physics.js).
2. **The side rails were deadened TODAY, from restitution 0.50 to 0.25** (see below). A banked ball
   now loses far more energy at the wall than it used to. Every route to a 100 is a bank, so an
   angled throw could genuinely arrive slower than a straight one at the same power. If this is the
   cause, it is a self-inflicted regression from this session and the number to revisit is
   `mat.wallRest` in boards.js.

**How to test it:** throw at fixed power for aim 0 / 0.35 / 0.70 and record how far up the face the
ball ends up (`v` in face coordinates), not just which cup it found. Matt's claim is about
DISTANCE, so measuring outcomes alone will miss it.

---

## What shipped today

All merged, all deployed, none of it seen by Matt except the setup screen and a first go at the 100.

| | |
|---|---|
| **Board face** | 30 and 40 moved onto concave arcs of their own; the numbers finally read |
| **Hub tile** | generated from `boards.js` by `gen-skeeball-tile.mjs`, not drawn by eye |
| **Play screen** | per-throw stats readout gone; score cluster moved over the machine; hamburger to the right; score counts up |
| **Toasts** | "Too soft, have it back" deleted; "Gutter" → "MISS!"; arcade styling |
| **Batch C** | neighbouring machines either side, ball tray, instant next ball |
| **Next ball** | arrives when the last one TOUCHES DOWN, not when it settles. Longest wait 1.2s, was up to 12s |
| **Side walls** | carried forward over the trough — the exposed end face was eating good 100 attempts |
| **Bounce** | side rails 0.50 → 0.25, corner rings 0.18 → 0.10 |
| **100's ring** | 155mm → 173mm |
| **Goals** | three unlock goals + fireworks, counters wired through the shared store |
| **Test suite** | 44 passed/9 failed → 53/0, and 414s → 66s |

### The 100, end to end

Widest run of CONSECUTIVE swipe strengths that scores, at the best aim angle:

| | run |
|---|---|
| start of day | 1–2, and the scoring powers were not even adjacent |
| after the wall fix | 2 |
| after the wider ring | **5** |
| the 50, for scale | 8 |

Sweet spot is **aim ~0.34 (a third over), power 70–74%**, either side. ~27% conversion in the zone.
Matt has NOT confirmed this feels right — see the open bug above, which may undo the premise.

---

## Open work

### 1. The goals display — thrown out, needs a fresh design

Three goals unlock the next machine (Matt's spec, values agreed): **land a ball in every point
value**, **score 300 in one game**, **score 2000 points lifetime**. `skeeball/js/goals.js` computes
them from the shared store and is correct. The fireworks exist and work.

**There is no display.** The first attempt was a panel on the setup screen. It pushed the PLAY
button to 851px in an 812px viewport — the game could not be started from a cold open. Matt's
reaction, and the rule that came out of it:

> **THE SETUP SCREEN NEVER SCROLLS.** Everything it needs fits on one screen. This is absolute.

**The budget is 77 pixels.** Measured at 375×812: everything else ends at 735. Anything added has
to fit in that, replace something already there, or live somewhere else. The panel was 146px.

Matt also said he does not want the next version to resemble the first — so this is a fresh design,
not a shrink. The open question I put to him and he has not answered: **a compact strip inside the
77px, or move it to the game-over card**, which has room and is arguably the better moment.

### 2. Machine 2

Held. `skeeball/CLAUDE.md`'s "Adding the next machine" section is accurate and current. Everything
downstream is board-driven and configures itself — ring numbering (`platedHoles`), the hub tile
(one `face()` call in `gen-skeeball-tile.mjs`), the setup carousel. The carousel has never run with
more than one slide; check the dots, arrows and swipe when it does.

**The goals currently lead nowhere.** All three can be completed with no second machine to unlock.
Worth deciding before launch whether machine 2 ships alongside or the goals read as "coming soon" —
it is the only thing on the list that would feel broken rather than unfinished.

### 3. Parked, waiting on Matt playing it

- **Rail springiness.** 0.25 now. If the bank looks dead rather than solid, 0.35 measured
  identically for hit rate — purely a looks call.
- **The junk patches.** Throwing straight, three stretches give nothing useful: a single step of 10
  at 30%, a scramble at 43–46%, a drop to 10s and 20s at 54–58%. Matt says these make sense (they
  are the ring walls between cups) and wants to discuss rather than fix.

### 4. Go-live

Drop `devOnly` in `js/hub.js` (~line 261). The code says that is the whole of releasing it. The My
Stats tab is already deliberately public; the leaderboard row is deliberately held back until the
flag goes.

---

## Things that cost me hours today — do not relearn them

**`physics.js` caches the built machine BY BOARD ID.** A tuning probe that overrides geometry on a
board still called `classic` silently measures the ORIGINAL geometry. Three different ring sizes
gave byte-identical results before I noticed. Overriding `mat` is fine (read per world build);
overriding anything in `geom` needs a unique `id`.

**Rings clip against the board's edges.** `machine.js` drops any ring segment whose centreline
falls outside the face. At 182mm the 100's ring loses 3 of 20 wall segments and a ball can roll out
the back of it. 173mm is the largest with margin; 174mm sits exactly on the line. Count segments
after any ring change: `M.solids.filter(s => s.part === 'ringSeg' && s.ring === id).length`.

**The engine tests are slow because they are real.** ~2000 simulated throws, each 240–2900 physics
steps against ~255 collision bodies. `node skeeball/js/test.js` runs the cheap half in ~66s;
`--full` adds the reachability sweep, the rollback bound, the power curve and the soak, and takes
~7 minutes. `run-all-tests.mjs` passes `--full` by itself when `physics.js`, `boards.js` or
`machine.js` differs from origin/main. **The runner kills any suite at 5 minutes**, so the cheap
half must stay under that.

**Comment discipline.** Matt did a cleanup pass on 08-17 to cut redundant comments. The throw
logging then acquired the label "remove before public" in nine separate places, which read as
nagging. `GUARD` appears 40 times in `skeeball/js` — that is the house pattern and it is fine
where it explains WHY code is as it is. Comments that instruct a future reader rather than describe
the code need saying once, at the top of the thing.

**Skeeball's player data is test data.** Matt's note, 2026-08-20: every Skeeball record in the store
today is his own testing and he expects to clear it before launch. THE LAW's weight here is about
`js/game-stats.js` and `js/players-agg.js` being SHARED with every other game, whose plays are real.
**This does not license deleting anything** — never delete player data without Matt asking in so
many words.

---

## How to work on this

### Deploy flow (this game deploys on every change)

1. Branch off `main`.
2. Bump `CACHE` in `sw.js` past what is on `origin/main` right now
   (`git fetch origin main -q; git show origin/main:sw.js | grep CACHE`) — other sessions bump it
   too, so re-check at commit time.
3. `node validate-sw-assets.mjs`, `node test-game-conventions.mjs`, `node test-skeeball-rings.mjs`.
   `node skeeball/js/test.js --full` for any physics or geometry change.
4. `git add` specific files by path — the repo has many untracked docs, never `git add -A`.
5. Commit, push, open a PR into `main`, **merge it**, and **watch `pages build and deployment`
   reach `completed / success`** before saying it is live. Merged ≠ deployed.

### Measuring instead of guessing

Every claim in this doc came from one of these, and the pattern is worth continuing:

- **Headless physics.** `simulateThrow(board, { power, aim })` returns the outcome; `startThrow` +
  `step` + `takeEvents` gives the whole journey with contact events (part, position, speed, time).
  This is how the wall's exposed edge was found and quantified.
- **Project world points through the camera** to measure framing without rendering:
  `camera.project(vec3)` → NDC → `left% = (x+1)/2*100`. This is how the neighbouring machines were
  placed and how the hub tile's clipping was diagnosed.
- **Measure layout in the browser** with `getBoundingClientRect`. rAF does not fire and screenshots
  time out in the in-app browser, but layout and `toDataURL` both work — which is how the setup
  screen overflow was caught and how every render in this session was checked.

### Key files

- `skeeball/js/boards.js` — all geometry and the contact-material overrides (`geom.mat`)
- `skeeball/js/machine.js` — geometry → the solids both engines read
- `skeeball/js/physics.js` — cannon-es sim, hole capture, materials, watchdog
- `skeeball/js/render.js` — three.js scene, board paint, ring numbers, neighbours, ball tray
- `skeeball/js/game.js` — the rules; `balls` is an array now, `ball` is a getter for the oldest
- `skeeball/js/goals.js` — the three unlock goals, computed from the shared store
- `skeeball/js/ui.js` — DOM shell, the swipe, the screens
- `gen-skeeball-tile.mjs` — regenerates the hub tile from `boards.js`
- Bench tools, no browser needed: `tune-ladder.mjs`, `measure-arc.mjs`, `measure-reach.mjs`,
  `sight.mjs`, `frame.mjs`

**Standing rules that bit us and must not be re-broken:** no magnetism ever; deterministic fixed
timestep; the setup screen never scrolls; use the blueprint's part names (Lane bed, Ramp/hump,
Board/scoring face, cups h10–c50); hole ids are frozen in the mid-rack save.
