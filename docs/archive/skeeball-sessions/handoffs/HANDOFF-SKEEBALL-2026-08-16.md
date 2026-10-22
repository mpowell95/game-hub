# Skeeball handoff — 2026-08-16

Decisions made and where things stand. Nothing speculative.

Live at **v364**. Everything below is deployed unless marked otherwise.

---

## Where we are

The **2×2 scoreboard (`?sb=L`) is the chosen layout.** It is NOT yet the default —
it still lives behind the `?sb=` trial flag. Making it the default is the next
piece of work.

Everything else below is settled and shipped.

---

## The board's geometry — settled, do not re-derive

Matt specified the whole face as multiples of **x, the diameter of one hole**.
`const X = 1.00 / 6.875` at the top of `boards.js`. Board is 6.875x wide by 9.5x
tall, which IS the 1 : 1.3818 ratio.

| Element | Size |
|---|---|
| hole | x |
| 100 ring | 1.0625x |
| 50 ring | 1.4375x |
| 40 ring | 1.5625x |
| 30 ring | 1.8125x |
| 20 ring | 4.875x |
| ball | 0.7x |
| ramp width | 5.375x (leaves a 0.75x wall each side) |
| every ring's height | x |

**Ring diameters are the INSIDE of the ring**, not the centreline and not the
outside. The ball's is measured the normal way, outermost to outermost.

**Three tangency rules define the layout.** `boards.js` states diameters only and
derives every ring centre and hole spacing from them, so no single number can be
edited into an inconsistent face:

1. every hole touches its own ring at exactly ONE point — the hole's bottom
2. the 30 ring's top touches the 40 ring's bottom
3. the 40 ring's top, the 50 ring's bottom and the 20 ring's top meet at one point

**One number in Matt's table cannot hold with the rest.** He gave
bottom-of-20-ring to bottom-of-30-ring as 1.25x; at 1.25x rule 3's single point
cannot exist. The 4.875x diameter was kept and that distance is 1.5x, because
4.875x at x = 4in is the 19.5in circle dimensioned on his reference drawing.
Matt was told and this is his call — do not silently re-resolve it the other way.

A ring may hide its own hole from the camera. That is intended, not a defect.

---

## Scoring — settled

- **Scoring is by falling through a hole.** The resting-position rule is gone.
- A ball that misses rolls back into the trough and takes what it lands on there.
- **No magnetism, ever.** Standing ban, predates this session.

---

## The throw — settled, and measured, not guessed

`skeeball/js/swipe.js` is the ONLY place the swipe maths exists. `ui.js` and
`skeeball/flick-test.html` both import it. They were two hand-copied copies once
and drifted inside a single edit; do not re-inline it.

**SWIPE_SLOW 0.65 / SWIPE_FAST 4.95**, in screen-heights per second, measured off
Matt's own thumb through flick-test.html:

```
 2 reach board  n=3  avg 0.65   -> power 0
 6 normal       n=9  avg 3.00   -> power 0.55
 9 for a 100    n=5  avg 4.95   -> power 1
10 hardest      n=3  avg 16.62  -> power 3.71
```

These two numbers describe a HAND. Four guessed pairs were all wrong in the same
direction. Measure them, never reason about them.

**Power is NOT clamped to 0..1.** 0 and 1 are the ends of the natural range, not
of what a throw can be. Below 0 falls short of the board; above 1 climbs the
backboard. There is **no upper bound at all** — a hard enough swipe launches the
ball clean over the machine, and that is intended.

The ceiling (`maxSpeed`, currently 6.60) and the swipe curve are ONE system.
Raising the ceiling makes every throw faster, not just the hardest. If the
complaint is about how a NORMAL throw feels, the curve in swipe.js is the knob.

---

## Things deleted on purpose — do not restore

- **The cage.** A wire canopy over the board that caught high lobs. It cannot
  coexist with "no limit on how high I can throw the ball." A ball thrown that
  hard is supposed to leave the machine, and it still resolves.
- **The tall cabinet side panels.** Two slabs 2.35m tall by 2.59m long at
  x = ±0.555. Not on any reference — frames from the low-angle POV clip show low
  padded rails at lane height and the arcade visible past them. They were also
  the cause of the odd blue patch above the machine: the background only showed
  through the gap between them. The low rail the references show is already in
  the machine (`laneRail`, 0.05m). If the cabinet looks flat now, that is
  LIGHTING — they were `receiveShadow: true`. Fix the light, do not put slabs back.
- **The TOP/BEST/TODAY strip in the header.** Those records live on the machine
  now. Do not show the same data twice.

---

## The scoreboard — decided

Four columns, Matt's labels exactly:

**Hub Wide Record** · **Your Best** · **Today** · **Last Game**

The Hub Wide Record shows the **username** of the player who holds it, alongside
their score. The username is **not a fifth category** — it is an attribute of
that one value and belongs next to that number. Detaching it and labelling it
was a mistake made twice.

Chosen layout: **2×2**, currently `?sb=L`.

### Constraints that killed every earlier attempt

- **The panel is 181 × 136 CSS pixels on a phone.** Four columns across gives each
  number 45px. No texture resolution fixes that; it is a layout constraint.
- **The texture must match the panel's shape.** It was 2048×1024 (2:1) on a panel
  that is 1.33:1, stretching everything 50% taller. Height is derived from the
  real solid now.
- **The panel has a safe area at BOTH ends.** The marquee covers the top; the
  board's own top rim covers the bottom. Painting to the texture's edges puts
  content behind both.
- **Plain bold sans, cyan label over amber value.** No seven-segment digits, no
  glow, no serif — none survived being shrunk.
- Growing the backboard does NOT help: the camera pulls back to fit it and the
  panel ends up with less screen area, not more.

---

## Naming — settled

- The machine is **THE CLASSIC** (`board.name`), on the marquee. The game is
  **Skeeball**. These are different things; never rename either.
- Folder/id naming stays as-is. Storage ids are frozen (THE LAW rule 5).

---

## Test state — known red, on purpose

`node skeeball/js/test.js` sits at roughly **43 passed / 10 failed**. Every
failure is a ladder-smoothness assertion written for the retired
roll-up-the-board design (dead zones, flips between adjacent power steps,
harder-goes-further). The board is now scored by where the ball LANDS, not how
far it rolls.

**Do not loosen these assertions to go green.** That is the "optimised a metric
pointing the wrong way" failure this game's docs already record once. They should
move when the open items below are fixed.

---

## The plan: batched and sequenced (2026-08-17)

Every open item, grouped into batches that share files and systems, in the order to do them.
The item numbers (2-19) are the ones from this doc's history so cross-references still resolve;
merged duplicates and the old "on hold" bugs are noted inline.

**The through-line: batches 1-5 (G, A, H, B, C) are UI and render only, carry zero ball-behaviour
risk, and are all shippable now. Only batch 6 (E) needs the new physics idea. Front-load everything
else while that idea gets worked out.**

Done, for the record: item 1 (2×2 default) shipped in PR #99 (`d4d43a3`). The 50-ring anti-perch
feature (PRs #107-110) was removed as broken on 2026-08-17 and folded back into item 12.

### 1. Batch G: Hub-standard screens (RELEASE BLOCKER)

The game cannot go live until these three match the rest of the hub. Pure DOM/CSS, no physics.
Design approved by Matt via mockups (artifact `99805ed1`). **Two rules settled for all three:**
the theme FOLLOWS the hub (never hardcode dark), and the machine shown on setup and how-to MUST be
the actual 3D Classic machine (a render/snapshot of what `render.js` draws), never a new drawing.

- **16. Game over — DONE, live v380 (PR #114, 2026-08-18).** Rebuilt on `css/ui.css`'s
  `.gh-overlay` / `.gh-modal` / `.gh-btn` / `.gh-chip` (`.sk-over-*` skin in `skeeball.css`,
  `_rackOver` in `ui.js`). Settled: titled "Game over", centered; "Hub-wide record" on its OWN
  full-width row so a long name wraps rather than clips; tiles are Your best / Today / Your average
  / Hub average (the best-ball/100s/50s brag tiles are gone); "Play again"; X closes to the
  machines. Averages are read-time, NO new counters: Your average = `sk.points / sk.played`; Hub
  average sums points/games across the `players-agg` aggregate (`this.hubAvg`, computed in
  `_refreshTopRecords`, null offline so the tile shows a dash).
- **17. Setup — DONE, live v381 (PR #115, 2026-08-18).** The accordion picker is now a scroll-snap
  MACHINE CAROUSEL (`_renderSetup` in `ui.js`, `.sk-car*` / `.sk-slide*` in `skeeball.css`). One
  slide per machine, THE CLASSIC name ABOVE the actual machine, no tagline, card centred, Hub-wide
  record on its own full-width row (long names wrap), then Your best / Today / Your average; follows
  the hub theme via `--sks-*`. With one machine it is a single centred card and the dots/arrows/hint
  are not rendered. **The actual machine comes from `renderMachineImage(board)` in `ui.js`** — a
  throwaway `render.js` Renderer drawn to an off-DOM canvas and read back as a cached JPEG
  (`preserveDrawingBuffer`), the WebGL context disposed at once; cached per board in
  `this._machineImg`. **#18 reuses this same helper for the how-to card's machine.**
- **18. How to play — DONE, live v386 (PRs #119/#120/#121, 2026-08-18).** `_showHowTo` +
  `_startHpDemo` / `_stopHpDemo` in `ui.js`, `.sk-hp-*` in `skeeball.css`. Mancala's chrome (dark
  modal, white card, chunky orange OK, single page) but the illustration is a **LIVE looped throw**:
  a real `Renderer` + `SkeeballGame` in the card canvas throws a measured scoring roll (`power 0.60`,
  `aim 0` → the top-centre 50, verified by stepping the physics headlessly), with the engine's own
  rim flash and +50 popup on capture. It uses the PLAY framing (`resize`, lane visible), not the
  setup thumbnail's zoomed `framePreview`, so the arc up the lane reads. **A CSS ball overlay (v384)
  then a faster CSS arc (v385) were both rejected by Matt** ("floats up in a straight line, then
  disappears") - a flat overlay on a static image cannot look like a thrown ball, so it had to BE
  the engine. The caption still cross-fades "Swipe up to roll" → "Hit the target to unlock machines".
  Torn down by `_stopHpDemo` (cancels the rAF, disposes the WebGL context) on OK / scrim / navigate /
  destroy; reduced-motion renders one still frame with a ready ball. Own `.sk-hp-` prefix; the
  retired four-panel sheet (`howto.js` / `_fitHelpLines` / `.sk-ht-` / `.sk-hd-`) is dead but retained.

**BATCH G COMPLETE (2026-08-18):** Game over (v380), Setup machine carousel (v381) + zoomed
thumbnail (v383, `framePreview` re-aims the preview camera at the board face so the lane is
cropped), How to play (v384). The three release-blocker screens now match the hub. Verified: the
game-over and how-to modals open cleanly and the setup carousel renders the real machine on a
device (the in-app test browser cannot composite frames, so its `requestAnimationFrame`-deferred
machine render and CSS animations never run there — real devices are the only visual check, per
`VISUAL-PROCESS.md`).

### 2. Batch A: Board face repaint

One board-texture / render pass. Highest visible payoff, matches the reference photos, no physics.

- **14.** The rings are not white. Make them white. (PR #105 "white PVC" addressed the bounce
  material; the rings still do not render white.)
- **15.** The scores are in random places. Remove them all, paint them directly onto the rings,
  exactly like every reference photo.

### 3. Batch H: Ball and render smoothness

- **19.** The ball is choppy, especially coming off the ramp. Smooth the motion and raise the
  graphics quality. **Render-side only**: the physics timestep is fixed and deterministic and the
  tests depend on it, so smooth it with render-frame interpolation, a better ball mesh, or frame
  timing, and NEVER by changing the physics tick rate.

### 4. Batch B: Stop showing junk

Cheap cosmetic cleanup, low risk.

- **11.** Too many words / toasts. Distracting. Cut the on-screen messaging.
- **6.** Faint diagonal streaks across the back wall (the cage is gone, so most likely the front
  glass pane catching light). Not yet chased.
- **H5** (old hold list). Missing a 100 by a hair drops you in a zero that shows the same "Gutter"
  message as a 10. Give it an honest message of its own. (The underlying corner0 geometry belongs
  to Batch E; this is only the copy.)

### 5. Batch C: Arcade surroundings and ball flow

Render / DOM, no physics.

- **8.** Faded skeeball machines to the left and right as background. Real skeeball is always
  several machines in a row. Background, non-interactive.
- **9.** Add the alley the balls rest in, waiting to be picked up and thrown (the ball tray /
  return where the balls sit ready).
- **7.** New ball appears and is rollable much faster. Ties to 9: shorten the wait after a throw
  before the next ball is present and ready to roll.

### 6. Batch E: Ball settling and scoring reliability (the hard one)

One physics system. A bounce change moves all of these at once, so re-measure them together
(`tune-ladder.mjs`, `measure-arc.mjs`, the 441-throw grid) at every step. The fixed deterministic
timestep stays; fix behaviour in the geometry and materials, never with rng or magnetism (both are
standing bans). **Gated on designing a brand-new anti-perch idea for 12.** Suggested sequence:

- **a. 10.** Too bouncy? Dial down restitution first. This is the likely root and probably clears
  much of 12, 13 and the old hold items for free.
- **b.** Re-test everything below. Several may already be gone after (a) and after the
  bankable-walls / scoring work.
- **c. 12.** The ball stalls behind the 50 ring before rolling down to the 10. Needs a brand-new
  idea (the splitter / shorter / ramp / ridge attempts, PRs #107-110, were all removed as broken).
- **d. 13.** It can take so long for a ball to find a hole.
- **e. 3** (= old hold "soft throw can't score the 10"). A soft/slow throw clips the 10's ring and
  cannot score the 10.
- **f.** Balls disappear without going into any hole, not even the 10.
- **g.** Max power always scores a 50.
- **h.** Max sideways aim always scores a 100 and the walls can't be reached (retest: bankable side
  walls shipped in PR #100).
- **i. 5.** Measure the 100 hit rate (was 1.4%). This is the yardstick that says whether the batch
  worked.

### 7. Batch D: Ramp screen-share

- **2.** The ramp takes up half the screen and doesn't look like a ramp. Partly addressed (a smooth
  curve at full lane width); the screen-share half is not. Standalone geometry / camera. **Do not
  change the launch angle without asking Matt first** (see the `humpAngles` comment in `boards.js`;
  it has been got wrong twice in opposite directions).

### 8. Batch F: Test cleanup

- **4.** Delete the test that forces harder swipes to score more points. Do this after E lands (the
  test is red because of E's design). Read the "known-red, on purpose" note above and in
  `skeeball/CLAUDE.md` before touching `skeeball/js/test.js`.

---

## How to actually look at it

The preview pane stops compositing intermittently, and screenshots time out. When
that happens, do NOT fall back to "the texture generated and there were no
console errors" and call it verified — three layouts shipped that way and every
one was clipped.

Chrome is on the box and works headlessly:

```
chrome.exe --headless=new --disable-gpu --use-angle=swiftshader \
  --window-size=420,900 --virtual-time-budget=8000 \
  --screenshot=out.png "http://localhost:8123/skeeball/?sb=L"
```

Two gotchas: seed `gamehub.profile` in localStorage or the name gate blocks it,
and cancel the game's rAF loop after a few frames or virtual time never goes idle
and Chrome hangs. Then open the PNG.

The same trick reads the reference videos — load one in a page, seek, draw to a
canvas, screenshot. That is how the side panels were disproved.

---

## Deploy

"Commit", "push" and "deploy" all mean LIVE on the deployed hub. Merge to main,
watch the pages workflow reach success, then verify the deployed file itself.
Bump `CACHE` in `sw.js` past what is on main RIGHT NOW — another session bumped it
mid-work twice today and both times we nearly shipped two builds with the same
cache name.
