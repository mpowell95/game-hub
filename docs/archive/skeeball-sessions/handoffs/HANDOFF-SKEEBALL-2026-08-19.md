# HANDOFF — Skeeball, 2026-08-19

Current source of truth for Skeeball's open work. Supersedes the punch-list half of
`HANDOFF-SKEEBALL-2026-08-16.md` (that doc still holds the settled deep context — board geometry,
scoring, the throw/swipe curve, deleted-on-purpose, the scoreboard — which is all still valid and
NOT repeated here; read it before touching physics or geometry).

**Live at `game-hub-v386`.** Skeeball is `devOnly` (admin-only hub tile; the standalone URL
`https://mpowell95.github.io/game-hub/skeeball/` works for anyone). Deploying it cannot affect the
public hub, so it is deployed on every change — see "How to work on this" at the bottom.

---

## Where we are

**Batch G (the three release-blocker UI screens) is BUILT and DEPLOYED, but Matt has not reviewed
it on his phone yet — expect edits.** Everything else below is UNTOUCHED.

The three screens were rebuilt off Skeeball's bespoke chrome onto the hub's shared components so the
game finally matches the rest of the hub. They are the ONLY thing that was blocking go-live; the
remaining batches are quality/physics work, not launch blockers, except where Matt says otherwise.

---

## Batch G — DONE, pending Matt's review (may still change)

| Screen | State | Files |
|---|---|---|
| **Game over** (was "Rack complete") | live v380 | `_rackOver` in `ui.js`, `.sk-over-*` in `skeeball.css` |
| **Setup — machine carousel** | live v381, zoom v383 | `_renderSetup` + `_ensureMachineImg` + `renderMachineImage` in `ui.js`, `render.js` `framePreview`, `.sk-car*`/`.sk-slide*` in `skeeball.css` |
| **How to play — live throw** | live v386 | `_showHowTo` + `_startHpDemo`/`_stopHpDemo` in `ui.js`, `.sk-hp-*` in `skeeball.css` |

**What each is now (so a reviewer knows what they're looking at):**

- **Game over** — centered card on `css/ui.css`'s `.gh-overlay`/`.gh-modal`/`.gh-btn`/`.gh-chip`
  (follows the hub theme). "Hub-wide record" (renamed from "Top player") on its own full-width row
  so a long player name wraps rather than clips. Four tiles: Your best / Today / **Your average** /
  **Hub average**. "Play again", X closes to the machines. **Averages are read-time, no new
  counters**: Your average = `sk.points / sk.played`; Hub average sums points/games across the
  `players-agg` aggregate (`this.hubAvg`, computed in `_refreshTopRecords`, null offline → dash).
- **Setup** — a swipeable scroll-snap MACHINE CAROUSEL (Matt's call over Escoba's accordion). One
  slide per machine; THE CLASSIC name ABOVE the machine; no tagline. Each slide shows that machine's
  **actual board** — a throwaway `render.js` Renderer drawn to an off-DOM canvas, read back as a
  cached JPEG (`renderMachineImage`, cached per board in `this._machineImg`), zoomed to the board
  face by `framePreview` (re-aims the preview camera at the board's midpoint so the lane is cropped;
  the play camera is untouched). Hub-wide record full-width row + Your best / Today / Your average.
  With one machine it is a single centred card and the dots/arrows/hint are not rendered.
- **How to play** — Mancala's chrome (dark modal, white card, chunky orange OK, single page) with a
  **LIVE looped throw** as the illustration: a real Renderer + `SkeeballGame` in the card canvas
  throws a scoring roll (`power 0.60`, `aim 0` → the top-centre 50, measured) with the engine's own
  rim flash and +50 popup, re-thrown on a loop. Caption cross-fades "Swipe up to roll" → "Hit the
  target to unlock machines". Torn down by `_stopHpDemo` (cancels rAF, disposes the WebGL context).

**Likely review-tweak points (things Matt flagged along the way or may still change):**

- **How to play throw**: loop pacing (currently ~1.3s pause between throws), which cup it lands
  (currently the 50), whether it should occasionally miss for realism. All one-line changes in
  `_startHpDemo` (`power`/`aim`, the `pause`).
- **Setup zoom**: there is some dark margin around the board (board is centred, `framePreview` fits
  the board+marquee). Can crop tighter if Matt wants.
- **Game over stats**: Matt questioned whether stats are needed at all before we landed on the two
  averages. The tile set (Your best / Today / Your average / Hub average) may get trimmed.
- The retired four-panel how-to sheet (`skeeball/js/howto.js`, `_fitHelpLines`, the `.sk-ht-`/
  `.sk-hd-` CSS, the `howToMarkup` import) is now **dead code, retained** — safe to delete in a
  cleanup pass once Batch G is signed off.

---

## Open — everything NOT yet touched

Grouped into batches that share files/systems. Item numbers are the ones from this game's history.
**Batches A–D are UI/render with no ball-behaviour risk; batch E is the hard physics work.**

### Batch A — Board face repaint
- **14.** The rings are not white. Make them white. (PR #105 "white PVC" only set the physics
  bounce material; the rings still render grey.)
- **15.** The scores are in random places. Remove them all, then paint them directly onto the
  rings, exactly like every reference photo (`skeeball/References/`).

### Batch B — Stop showing junk / bad copy
- **11.** Too many words / toasts. Distracting. Cut the on-screen messaging.
- **6.** Faint diagonal streaks across the back wall. The cage is gone, so it is something else —
  most likely the front glass pane catching light. Not yet chased.
- **H5.** Missing a 100 by a hair drops you in a zero (`corner0`) that shows the same "Gutter"
  message as a 10. Give it an honest message of its own. (The corner0 geometry itself is batch E;
  this is just the copy.)

### Batch C — Arcade surroundings and ball flow
- **8.** Faded skeeball machines to the left and right as background. Real skeeball is always
  several machines in a row. Background, non-interactive.
- **9.** Add the alley the balls rest in, waiting to be picked up and thrown (the ball tray /
  return where the balls sit ready).
- **7.** New ball appears and is rollable much faster. Shorten the wait after a throw before the
  next ball is present and ready. Ties to 9.

### Batch D — Ramp screen-share
- **2.** The ramp takes up half the screen and doesn't look like a ramp. Partly addressed (it is a
  smooth curve at full lane width now); the screen-share half is not. Standalone geometry/camera.
  **Do NOT change the launch angle without asking Matt first** (see the long `humpAngles` comment
  in `boards.js`; it has been got wrong twice in opposite directions).

### Batch E — Ball settling and scoring reliability (the hard one)
One physics system. A bounce change moves all of these at once, so re-measure them together
(`node tune-ladder.mjs`, `node measure-arc.mjs`, and a throw grid) at every step. The fixed
deterministic timestep stays; fix behaviour in the geometry/materials, **never with rng or
magnetism (both are standing, permanent bans)**. Suggested order:
- **a. 10.** Too bouncy? Dial down restitution first — the likely root, probably clears much of
  12/13 and the hold items for free.
- **b.** Re-test everything below; several may already be gone after (a) and after the
  bankable-walls / scoring work.
- **c. 12.** The ball stalls behind the 50 ring for a few seconds before rolling down to the 10.
  **NEEDS A BRAND-NEW IDEA** — the splitter / shorter-splitter / ramp / ridge anti-perch attempts
  (PRs #107–110) were all removed as broken. Do not reintroduce a variation on those.
- **d. 13.** It can take too long for a ball to find a hole.
- **e. 3 (= old hold "soft throw can't score the 10").** A soft/slow throw clips the 10's ring and
  cannot score the 10.
- **f. H1.** Balls disappear without going into any hole, not even the 10.
- **g. H2.** Max power always scores a 50 (everything above ~60% power lands the same).
- **h. H3.** Max sideways aim always scores a 100 and the walls can't be reached (retest: bankable
  side walls shipped in PR #100).
- **i. 5.** Measure the 100 hit rate (was 1.4% before the swipe rework, unmeasured since). This is
  the yardstick that says whether the batch worked.

### Batch F — Test cleanup
- **4.** Delete the test that forces harder swipes to score more points. Do this after E lands (the
  `skeeball/js/test.js` known-red assertions are ladder-smoothness checks for the retired
  roll-up-the-board design; see "Test state — known red, on purpose" in the 08-16 doc before
  touching them).

### Done, for the record
- Item **1** (2×2 scoreboard default, retire `?sb=`) shipped in PR #99.
- The 50-ring anti-perch feature (PRs #107–110) was removed as broken 2026-08-17 (folds into 12).

---

## How to work on this

### Deploy flow (per this game's "deploy every change" convention)
1. Branch off `main`.
2. Bump `CACHE` in `sw.js` **past what is on `origin/main` right now** (`git fetch origin main -q;
   git show origin/main:sw.js | grep CACHE`) — other sessions bump it too, so re-check at commit
   time.
3. `node validate-sw-assets.mjs` (and `node test-game-conventions.mjs` for a code change).
4. `git add` the specific files by path (the repo has many untracked docs; never `git add -A`).
5. Commit, push, open a PR into `main`, **merge it**, and **watch the `pages build and deployment`
   run reach `completed / success`** before telling Matt it's live. Merged ≠ deployed.

### Verifying without a phone — what works and what doesn't
The in-app test browser (and the preview pane) **cannot composite frames**: `computer` screenshots
time out AND `requestAnimationFrame` never fires, so the setup machine image and the how-to live
throw will not visually render there, and CSS animations won't run. **A real device is the only
VISUAL check** (VISUAL-PROCESS.md's first rule). But two headless techniques carried the whole of
Batch G and are worth reusing:
- **Project world points through the camera to measure framing.** `camera.project(vec3)` gives NDC;
  `left% = (x+1)/2*100`, `bottom% = (y+1)/2*100`. This is how the zoom was tuned (board bottom at
  the frame edge, lane off-screen) and how the how-to ball was aimed at the real 50-cup position.
  Import the deployed modules with a cache-buster: `import('/game-hub/skeeball/js/render.js?b='+Date.now())`.
- **Step the physics headlessly to find/verify outcomes.** `new SkeeballGame('classic');
  g.throwBall({power, aim}); while (g.ball) g.update(1/60);` then read `g.score` and drain
  `g.takeEvents()`. This is how `power 0.60 → 50` was found, and how the how-to demo path was
  verified (renders clean, capture+ballDone fire) before shipping. `toDataURL` on a WebGL canvas
  DOES work in that browser (`preserveDrawingBuffer` is set), even though rAF does not.
- When seeding a profile to get past the name gate in a browser that can reach Firebase, use the
  standing QA name **`zzztest`** (hidden from the leaderboard, auto-grouped) and never a real name.

### Key files
- `skeeball/js/boards.js` — all geometry (sizes, angles, speeds, rings, holes as an OBJECT keyed by
  id: `c50`/`c40`/`c30`/`h20`/`h10`/`100L`/`100R`, each `{u,v,r,value,ringD}`).
- `skeeball/js/machine.js` — geometry → solids both engines read.
- `skeeball/js/physics.js` — cannon-es sim, hole capture, trough scoring, watchdog.
- `skeeball/js/render.js` — three.js scene, board texture, camera. `resize()` = play framing (whole
  machine); `framePreview()` = zoomed board thumbnail. `render(game, dt)` draws the live ball;
  `render(null, 0)` draws the machine with no ball.
- `skeeball/js/game.js` — `SkeeballGame`: `throwBall`/`update`/`canThrow`/`ball`/`takeEvents`/`score`.
- `skeeball/js/ui.js` — DOM shell, the three Batch-G screens, the swipe, `window.__skTest`.
- Bench tools (need no browser): `tune-ladder.mjs`, `measure-arc.mjs`, `measure-reach.mjs`,
  `sight.mjs`, `frame.mjs`.

**Standing rules that bit us and must not be re-broken:** no magnetism ever; deterministic fixed
timestep; use the blueprint's exact part names (Lane bed, Ramp/hump, Board/scoring face, cups
h10–c50); THE LAW governs the `skeeball` stats id and `sk` sub-counter (real family history — never
touch `js/game-stats.js`, `sk.boards`, or storage keys; hole ids are frozen in the mid-rack save).
