# BB-3b handoff: the art pass on the play screen

## 0. Before anything else: verify the inputs exist

Run these and paste the output into your first report. If any line is missing, stop and report; do not invent a replacement. Twice on this project a session could not see a file a handoff named, built a substitute, and cost a settings file and a field renderer.

```
git fetch origin main claude/baseball-mocks
git ls-tree -r --name-only origin/main reference/baseball/
git ls-tree -r --name-only origin/main docs/BASEBALL-DESIGN-DOC.md
git ls-tree -r --name-only origin/claude/baseball-mocks mocks/baseball/
```

Expected in `reference/baseball/`, exactly these twenty-nine: `SPEC.md`, `backdrop-overhead.jpg`, `backdrop-plate.jpg`, `ball-sheet.png`, `bat.png`, `batter-away.png`, `batter-home.png`, `batter-home-1.png` through `batter-home-8.png`, `batter-away-1.png` through `batter-away-8.png`, `mock-play-batting.jpg`, `mock-play-overhead.jpg`, `pitcher-release.png`, `pitcher-set.png`, `pitcher-sheet.png`, `pitcher-windup.png`. Expected on the mocks branch: fifteen files including `play-batting-tall.html`, `career-home.html`, `how-to.html`, `game-end.html`.

**Which batter files are the batters.** The sixteen numbered frames (`batter-home-1..8`, `batter-away-1..8`) are the batters. They are one character in a semi-realistic style, eight swing poses each, real transparency, drawn at one scale. `batter-home.png`, `batter-away.png` and `bat.png` are an earlier cartoon character and are NOT used anywhere; leave them in the folder and do not ship them. The pitcher and the backdrops are the cartoon style. Matt has looked at the mix and accepted it: ship as is, do not regenerate or restyle anything.

## 1. Read, in this order

1. Every picture in `reference/baseball/`, before a word of code. `mock-play-batting.jpg` is the target. `SPEC.md` beside it is the drawing instruction.
2. `baseball/CLAUDE.md`, the four sections dated 2026-09-14 (phase 3, the phone fix, the mocks port, the camera rebuild). That is what exists. Do not rebuild what they got right.
3. `docs/BUILDING-A-GAME.md` Part 0 and Part 3. Root `CLAUDE.md`: THE LAW, "Asking for a change means LIVE", "When Matt asks what you are doing, ANSWER HIM".
4. `baseball/js/ui.js`, `baseball/js/field.js`, `baseball/js/ring.js`, `baseball/js/engine/pitch.js` (the `pitchExtras` seam), `baseball/js/engine/game.js` lines 289 to 330 and 473 to 545 (the views and the pitch call order).
5. `test-baseball-device.mjs` and `test-visual.mjs`'s baseball entries.

The mocks branch's career-home, how-to and game-end mocks are phase 4 input. Do not build them here.

## 2. Context budget

This is nine commits with an asset pipeline, a homography, an engine seam and a deploy. Sessions on this project have hit auto-compact mid-phase. Commit and push at the end of every numbered commit below, and if you feel context running low, stop at the current commit boundary, push, and report which commit you reached and what the next one needs. Do not press on into a compaction.

## 3. Where the build is, and what the recording shows

Matt recorded `game-hub-v834` on his phone. Read against the spec:

| Right, keep it | Wrong, this pass fixes it |
|---|---|
| Four fixed bands (HUD 48, field remainder, strip 108, control 172), measured identical in both states | The field is three flat stripes and a third of the band is empty sky |
| The ring and button on one canvas from `ring.js`, 137 and 101 px, state driven | The two players are drawn silhouettes with no poses; no bat; SWING changes nothing on screen |
| Hill Climb's rapid-tap cure on the button | The pitch appears partway to the plate as a 3 px dot and floats in; no wind-up, no release moment |
| `_fitInsets()` clearing the hub's back pill; `test-baseball-device.mjs` | Nothing waits between pitches: measured 1.5 to 2.25 s pitch to pitch, against a tuned 3000 ms gap plus 1400 ms wind-up |
| The engine's hold, Nice, hang and steer seams, tested | The at-bat strip wraps to a second row after seven pitches and the control band jumps down |
| The overhead cut on contact (see section 4, not ratified) | Steering has no UI: `decidePitch` resolves with `steer: []` |
| The engine, untouched since phase 2 | Verdict words are Out/Hit only: no Ball, Strike, Foul, Early, Late, Perfect |

The gap is art plus four behaviours no art fixes: pacing, the wind-up, strip wrap, steering, verdicts. Band geometry, the ring and the input handling do not change.

## 4. Two camera decisions, and who owns them

**The pitching state's camera: this handoff reverses a decision of Matt's.** The 180-degree pitching camera in v834 (pitcher huge on the mound, batter small at the plate) was Matt's own call in the camera-rebuild round. This pass replaces it with one camera behind the plate in both states. The reasons: the reference art only exists for that camera (both batters drawn from behind, the pitcher facing the camera; a mirror needs a front-view batter and a back-view pitcher that do not exist); the spec's fixed-geometry rule (in one camera the two states differ only by which batter sprite stands at the near box and which label the button carries); and the mock Matt approved is this camera. Matt has said he is inclined to accept it. It is item 1 on the report-back list in section 11, so he sees it rather than discovers it. Build it this way unless he says otherwise before you reach commit 3.

**The overhead cut on contact was never ratified.** The camera-rebuild session put three options to Matt, he did not answer, it proceeded with the cut and recorded the choice as his. It is probably right (the reference game does the same) and he is likely to keep it, and the spec is written around it. Build it as specified. Do not describe it anywhere as Matt's decision; describe it as the spec's default awaiting his word. Item 2 on the report-back list.

## 5. Matt's three complaints, as requirements with their own tests

These are the first three things he said about the recording. Each commit below serves them, but they are stated here so they are tested as outcomes, not assumed as side effects.

**R1. The player can see the pitch coming and time it.** A fixed, visible wind-up precedes every pitch: the mound figure steps set to wind-up 400 ms before release, the ball leaves the hand at a definite release moment, and it is on screen from the hand to the plate, growing the whole way. No numerals, no countdown text; the pose steps are the countdown. Test: a frame capture at 30 fps across one pitch shows the wind-up pose at least 300 ms before the ball's first frame, the ball's first frame within 10 px of the pitcher's hand anchor, and the ball present in every frame until plate crossing.

**R2. The time between pitches is the tuned value.** After a pitch resolves: the verdict holds for `resultMs`, then `betweenMs` passes, then the wind-up runs for `windupMs`, then the flight. Test, headless: across ten consecutive pitches the interval from one plate crossing to the next equals `resultMs + betweenMs + windupMs + timeToPlateS` within 100 ms. Test, device: `test-baseball-device.mjs` gains the same check on the real hub mount for three pitches, and reports the measured numbers in its output.

**R3. The player knows a swing happened.** On a swing decision the bat visibly moves (commit 3), the button shows its released state, and Line 1 says Early, Late or Perfect on contact, or Strike on a miss, within one frame of the swing. On a take, Line 1 says Ball or Strike and the bat does not move. Test: a scripted swing and a scripted take, frame captured, differ in the bat layer's transform and in Line 1's text.

## 6. Scope

In: everything on the play screen that `SPEC.md` sections 2, 3, 5, 6, 7, 8, 9, 13 and 14 describe; R1 to R3; the assets pipeline; the steering loop; the Quick Play league picker's presentation (commit 6, below); the tests that pin it; docs; deploy.

Out: career home, player creation, skill spend, points, the career store, stats recording, leaderboard, trophies, the how-to sheet, steal, bunt and pickoff mechanics (the three slots stay drawn and disabled), screwball, eephus and cutter movement, park shapes, sound, the Tune panel's contents.

## 7. Contract

- No em dashes anywhere you write. No helper sentences in the UI. Every string through `t()` at render time, both languages.
- Fixed geometry: the four band heights measure byte-identical in both states and across the between-innings swap. `test-baseball-device.mjs` keeps asserting it.
- Reduced motion thins garnish only. The pitch still flies, the ring still fills, the wind-up pose still steps.
- Every asset ships as WebP under `baseball/img/`, listed in `sw.js` `ASSETS` in the REST tier (never LAZY: a tile opens them), and `validate-sw-assets.mjs` is re-run so `REST_MANIFEST` carries them. Bump `CACHE` past what is on `main` at the moment you push.
- The engine's existing outputs stay byte-identical for every existing caller. New seams are optional arguments and new fields, the pattern `pitchExtras` already uses.
- No `window.confirm`.
- When Matt messages mid-run, answer where you are before the next tool call.
- Done means live: PR, merge, the `pages build and deployment` run for the merge commit at `completed` / `success`, then tell him it is live in those words.

## 8. Commits, in order, each with its own done test

**Commit 1: the assets.** Cut and convert with a small Python script using Pillow (`pip install pillow` if absent). Do not hand-edit pixels.

| Source in `reference/baseball/` | Ships as `baseball/img/` | Prep | Size target |
|---|---|---|---|
| `backdrop-plate.jpg` | `plate.webp` | Crop to the field band only: from the top of the sky to just below the near batter's boxes. Measure the crop once; its edges are the anchor frame for commit 2 | 1200 px wide, under 300 KB |
| `backdrop-overhead.jpg` | `overhead.webp` | Crop to the stadium region, same rule | 1200 px wide, under 300 KB |
| `batter-home-1.png` to `-8.png` | `batter-home-1.webp` to `-8.webp` | Do NOT trim, do NOT normalize heights. Resize every frame by ONE factor for the whole set (source canvases are 937 px tall; ship 800 px tall), keep each frame's full canvas so the feet stay where the generator put them | under 70 KB each |
| `batter-away-1.png` to `-8.png` | `batter-away-1.webp` to `-8.webp` | Same rule, same single factor | under 70 KB each |
| `pitcher-set.png`, `pitcher-windup.png`, `pitcher-release.png` | `pitcher-set.webp`, `pitcher-windup.webp`, `pitcher-release.webp` | Trim. Paint the small ball in the release hand transparent, since the game draws its own ball from that hand | 300 px tall each, under 30 KB each |
| `ball-sheet.png` | `ball-sheet.webp` | Ten frames in one row, 96 by 96 each, transparent | under 60 KB |

Done when: every file opens, every sprite composites over magenta with no halo, total under 2 MB (sixteen batter frames are most of it; that is accepted, REST tier), `validate-sw-assets.mjs` passes with all twenty-two entries and a fresh manifest.

**Commit 2: the plate view is a picture.** Replace `drawPlateView`'s drawn field with `plate.webp` fitted to the field band with cover behaviour anchored at the bottom center, so the plate sits at a fixed fraction of the band height at every band height. Export one `PLATE_ANCHORS` object from `field.js`, measured from the cropped picture as fractions of its width and height: plate center, mound center, the pitcher's hand release point, strike-zone width at the plate, near-box left and right centers. Everything drawn on top (strike zone, sweet-spot bar, aim crosshair, the two reserved lines, figures, ball) positions from those anchors. The old `projectPlate` camera math becomes dead code; remove it and its tests, and replace the plate-camera checks in `test-baseball-device.mjs` with anchor checks (plate below mound, both inside the canvas, strike zone at least 0.30 W wide). The overhead `project()` stays until commit 5. Done when: tall and short phone both render the picture with the plate pinned and nothing off canvas, `check-no-scroll.mjs baseball` at zero.

**Commit 3: the figures.** The batter is an eight-frame sprite, one image per frame, bat drawn in the hands in every frame. There is no separate bat layer and no bat rotation anywhere. The home set stands at the near box on your hand's side; the frames are drawn as a left-handed batter, so flip the whole frame horizontally for a right-hander. The away set stands at the same anchor on the CPU batter's side in the pitching state (`teams.js` carries a lefty rate). Anchor rule: every frame is drawn at the same scale and anchored by its canvas bottom-center at the box anchor; never scale a frame to match another frame's height, because a crouch at contact is legitimately shorter than the stance and normalizing it makes the batter bounce. Build a dev-only page that flips through the eight frames in place; if the feet drift more than 4 px between frames, add a per-frame x/y offset table beside `PLATE_ANCHORS`, measured once, and stop there. Size: the stance frame's figure is about 0.50 of the field band height (measure from the mock, store the number). Pitcher at the mound anchor, three cartoon poses, set by default, about 0.11 of the band height. Wind-up per R1.

The swing timeline, both batters, from the swing decision at time 0: frame 3 at 0 ms, 4 at 40, 5 at 80 (this is contact: bat flat over the plate), 6 at 120, 7 at 160, 8 at 200, hold 8 through the result beat, back to frame 1 with the next pitch. While the Swing button is held past `chargeTime`, show frame 2 instead of frame 1 (the two stance frames differ slightly, which makes the charged state visible on the figure as well as on the ring). A take never leaves frame 1. Under reduced motion the timeline is unchanged; it is gameplay. Done when: a screenshot of each state shows the right batter and the pitcher at the mock's sizes, the flip-through page shows no foot drift, and R1's and R3's frame captures pass.

**Commit 4: the ball flies the truth, in both states, with steering.** The one engine change of the pass, and it is small.

- Batting: `view.pitch.path` carries the per-step lateral position. Draw the ball from the hand anchor to the plate anchor over `timeToPlateS`, lateral offset from `path`, radius 4 px to 14 px, a short fading trail, frames cycling through `ball-sheet`. Break shape as presentation only (curveball bends from release, slider from `steerFromFrac`); the engine's `x` is the truth at the plate.
- Pitching: the engine computes the pitch the instant `decidePitch` resolves, so any flight drawn after release is a guess the engine has already overruled. Fix the seam additively in `game.js` and `pitch.js`: the pitch view gains a pre-rolled `scatter` (the same random draw `flyPitch` makes today, pulled before `decidePitch` is called), and `flyPitch` accepts `pitchExtras.scatter` and uses it instead of rolling its own when present. Every existing caller omits it and gets byte-identical output; write the test that proves it. Then `HumanAgent.decidePitch` resolves at plate crossing, not at release: it owns the flight clock (travel time is `PITCH_TRAVEL_MULT` times `fastballMs`, deterministic), samples the pad each animation frame into `steer` for curveball and slider, draws the ball along aim plus scatter plus `resolveSteer` of the samples so far (import it; it is pure), and resolves with `{type, aim, hold, steer, scatter}`. What the player watched is what the engine scores. The pad shows a break-direction arrow from release to plate crossing on those two pitch types only.
- The CPU batter's swing: when you pitch, the engine decides the CPU's swing inside `playAtBat` and nothing tells the UI. Add one additive event, `swing`, emitted right after `decideSwing` returns, with `{side, action, charged}`. No existing listener breaks (there is none). `HumanAgent` ignores it on its own at-bats; in the pitching state the UI plays the away batter's frames 3 to 8 on `action: 'swing'` and leaves frame 1 on a take. Add the event to `baseball/js/test.js`'s event assertions.
- Both: R2's cadence wraps every pitch. `windupMs` finally does something.

Done when: twenty curveballs with a scripted pad drag land the engine's `x` within one path step of the last drawn position; twenty fastballs with no drag land where `scatter` says; the batting flight ends at `view.pitch.x`; R2's headless timing check passes.

**Commit 5: the overhead view is the painted stadium.** `overhead.webp` fills the field band on the cut. Fit a homography from field feet to picture pixels on the four painted bases (measure home, first, second, third in the cropped picture once, store beside the anchors, solve once at load). Over it, in order: the seven hatched out-zone sectors from `zonesFor(league)`, the current league's fence as a white arc from `FIELD[league].fenceFt` (the painted wall is scenery; the arc is the truth, and it sits well inside the wall at Little League on purpose), runners as profile-color diamonds sliding base to base, the ball's dotted trail from the plate to the landing point from `atBatEnd`'s `sprayAngleDeg` and `distanceFt`, then the landing marker (X in a sector, filled circle with 1B, 2B, 3B in a gap, the arc flashing with HR). The painted fielder nearest the landing sector hops once on an out, transform only. Cut back to the plate view at the next `decidePitch` or `decideSwing`, as today. Done when: a scripted single, double, home run, flyout and groundout each land on the right marker over the picture, and the four base diamonds land on the four painted bases in every league.

**Commit 6: words, strip, HUD, the league picker, leaving.**

- Line 1 gets the full vocabulary: Ball, Strike, Foul on a take or a miss; Early, Late, Perfect after contact from `timingErrorMs` (Perfect inside `perfectMs`, sign decides the other two), each with its chevron or star per `SPEC.md` section 3; the outcome word after the result beat. Line 2 is the pitch name and mph at plate crossing. Both stay reserved elements.
- The strip is eight fixed tiles in one row, 44 wide, 92 tall, 1 px gaps, in both states. Batting shows the last eight pitches of this at-bat in those tiles, never a second row. Pitching shows the selector, locked pitches as empty wells with a lock glyph.
- HUD count as B S O dot rows, bases as three squares filling with the profile color, inning as triangle plus number, teams as marker plus three-letter code.
- "Side retired" becomes the "End of the 2nd" form (`SPEC.md` section 13), and the state swap happens inside the 3000 ms beat with nothing moving.
- **The Quick Play league picker.** Matt: the five-segment control reads as a difficulty menu, and baseball is tier-blind by the doc's own lock. Quick Play must still pick a league (doc: pick a league, everything else random), so the picker stays; its reading changes. Default: replace the `.gh-seg` with five rows in ladder order, Little League at the top and selected by default, each row the league name and its center-field fence distance as the only number ("210 ft"), no shapes, no tier words, `Play` below. The distance reframes the choice as a place. Item 3 on the report-back list; Matt may want a different treatment after seeing it.
- `isInProgress()` returns true while a Quick Play game is running, so the hub's own leave dialog (`hub_confirm_*`) fires from the back pill. Remove `window.confirm`. Forfeit wording is phase 4's, when a career game exists.

Done when: `test-i18n-strings.mjs` clean, a scripted at-bat produces every Line 1 word, the strip measures one row of eight at both phone heights, and the setup screen fits both heights without scrolling.

**Commit 7: tests.** Update `test-baseball-device.mjs` per commits 2 and R2. Add to `baseball/js/test.js`: the pre-rolled scatter identity, `decidePitch` steer samples reaching `flyPitch`, and a structural check that every `baseball/img/` file is in `sw.js` `ASSETS`. Run `test-visual.mjs baseball` and open the contact sheet. Run only the suites covering files you touched, plus `validate-sw-assets.mjs` and `test-sw-strategy.mjs` because `sw.js` changes. Never `run-all-tests.mjs`. If `playwright-core` is missing, the earlier round used a symlink to the global package; do the same and do not commit it.

**Commit 8: docs.** `baseball/CLAUDE.md` gets a "Phase 3b complete" status at the top in the shape of the phase 3 entry: what shipped, what was simplified and why, the verification block with real numbers including R2's measured intervals. The root `CLAUDE.md` games-table row for Baseball still says "phase 0: plumbing only, no game"; correct it. `reference/baseball/SPEC.md` section 15 gets rows for the camera reversal, the unratified overhead cut, and the league picker default. The design doc's "No fielders drawn" line is Matt's document; note it and leave it to him.

**Commit 9: ship.** `validate-sw-assets.mjs` last, `CACHE` bumped past `main`'s current number, PR, merge, verify the Pages run, say it is live. Then ask Matt for a phone recording, since every round today found something the headless suites could not.

## 9. Numbers to carry

| Item | Value | Source |
|---|---|---|
| Bands | HUD 48, strip 108, control 172, field remainder with floor 0.28 H | `SPEC.md` section 5, already in `ui.js` |
| Ring, button | 137, 101, 10 thick | `ring.js` |
| Charge | 300 ms (`chargeTime`), window times 0.6 when charged | `FEEL.engine` |
| Meter | `meterTime`, Nice width 0.12 centered at 12 o'clock, hang past `HANG_GRACE_FRAC` | `pitch.js`, `ring.js` |
| Beats | between 3000, wind-up 1400, result 1800 ms, all three applied per pitch per R2 | `FEEL.ui` |
| Recording, v834 | 1.5 to 2.25 s pitch to pitch; `betweenMs` applied only at half-inning end, `windupMs` never applied | measured off the strip chips at 4 fps; `ui.js` lines 48 to 50, 488, 510 |
| Steerable | curveball from step 0, slider from 0.5 of flight, max offset 0.35 | `settings.js` |
| Perfect | inside 25 ms | `FEEL.engine.perfectMs` |
| Ball radius, plate view | 4 px at the hand to 14 px at the plate | this handoff |
| Strip tiles | 8 by 44 by 92, 1 px gaps | this handoff, from the mock |
| Swing frames | 3 at 0 ms, 4 at 40, 5 at 80 (contact), 6 at 120, 7 at 160, 8 at 200, hold 8; frame 2 while charged | this handoff |
| Batter frame source | 937 px tall canvases, one scale factor per set, anchored bottom-center, never height-normalized | measured from the files |

## 10. Self-review before the PR, answered in the CLAUDE.md entry

1. Does anything move between the batting and pitching states other than the near sprite, the button label, the strip contents and the action-slot contents? Measure, do not reason.
2. Does the ball the pitcher watches land where the count says it landed? Twenty pitches, logged.
3. Does a curveball with the pad dragged the wrong way do nothing, as the doc locks?
4. Can a player watching the screen tell a pitch is about to come, and afterwards tell that they swung? R1 and R3's captures, attached.
5. Is the pitch-to-pitch interval the tuned one on the device mount? R2's measured numbers.
6. Is any text on the play screen an instruction to the player? Remove it.
7. Does every new image answer 200 on the live site after deploy? Check one URL.
8. Did `test-visual.mjs baseball` produce a contact sheet, and did you look at it?

## 11. Report back to Matt, in this order, in the final message

1. The pitching camera reversal (section 4): built one camera behind the plate in both states, replacing his 180-degree mirror, and why. Ask him to confirm or reverse.
2. The overhead cut on contact: built as the spec's default, never ratified by him. Ask him to confirm or choose otherwise.
3. The league picker treatment: what you built, with a screenshot, for his reaction.
4. R2's measured intervals before and after, on the device mount.
5. Anything you simplified against the spec, and why.
6. If compaction forced a stop: which commit you reached, what is pushed, what the next commit needs.

## 12. Do not

- Do not touch `baseball/js/engine/` beyond the additive scatter seam and the additive `swing` event in commit 4.
- Do not use `batter-home.png`, `batter-away.png` or `bat.png`. Do not add a bat layer. Do not normalize frame heights.
- Do not regenerate, restyle or edit any picture. The art ships exactly as it is in the folder; that is Matt's decision.
- Do not present either camera choice as Matt's settled decision anywhere in code comments or docs.
- Do not put any image in the LAZY tier.
- Do not build career home, the how-to sheet or the game-end ceremony from the mocks branch. Phase 4.
- Do not delete or rename any `gamehub.*` key or any `bb` counter. Nothing in this pass writes stats.
- Do not stop at a pushed branch. The recording came from a deployed build; the fix is judged the same way.
